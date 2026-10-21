import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import adminHtml from './admin.html';
import { FAVICON_SVG } from './favicon';
import { ICONS, loginPage, MANIFEST } from './pwa';
import { cleanup, deleteRule, deleteSettings, getSetting, listRules, saveRule, setSettings } from './db';
import * as ig from './instagram';
import { findRule } from './match';
import type { Env, Rule } from './types';
import { dispatch, TASK_PATH, verifyTask, type Task } from './tasks';
import { errorMessage, hmacSha256Hex, randomToken, safeEqual } from './util';
import * as yt from './youtube';

const app = new Hono<{ Bindings: Env }>();

// ---------- Public: webhook, OAuth callbacks, privacy ----------

app.get('/webhooks/instagram', (c) => {
  const q = c.req.query();
  if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === c.env.IG_VERIFY_TOKEN) {
    return c.text(q['hub.challenge'] ?? '');
  }
  return c.text('forbidden', 403);
});

app.post('/webhooks/instagram', async (c) => {
  const raw = await c.req.arrayBuffer();
  const header = c.req.header('x-hub-signature-256') ?? '';
  const secrets = [c.env.IG_APP_SECRET, c.env.META_APP_SECRET].filter((s): s is string => Boolean(s));
  const valid = await Promise.all(secrets.map(async (s) => safeEqual(header, `sha256=${await hmacSha256Hex(s, raw)}`)));
  if (!valid.includes(true)) {
    console.warn('webhook rejected: bad signature');
    return c.text('bad signature', 401);
  }
  const payload = JSON.parse(new TextDecoder().decode(raw));
  // Ack fast; Meta retries (and eventually disables the subscription) on slow responses.
  c.executionCtx.waitUntil(ig.handleWebhook(c.env, payload));
  return c.text('ok');
});

// Fan-out target: each task runs in its own invocation with a fresh D1/subrequest budget.
async function runTask(env: Env, task: Task): Promise<void> {
  if (task.type === 'poll_media') {
    const comments = await ig.newCommentsForPost(env, task.mediaId);
    await dispatch(env, comments.map((comment) => ({ type: 'comment', comment, mediaId: task.mediaId })), (t) => runTask(env, t));
  } else if (task.type === 'comment') {
    await ig.processComment(env, task.comment, task.mediaId);
  } else if (task.type === 'retry') {
    await ig.retryOne(env, task.id);
  } else if (task.type === 'yt_poll') {
    const comments = await yt.newComments(env);
    await dispatch(env, comments.map((comment): Task => ({ type: 'yt_comment', comment })), (t) => runTask(env, t));
  } else if (task.type === 'yt_comment') {
    await yt.processComment(env, task.comment);
  }
}

app.post(TASK_PATH, async (c) => {
  if (!(await verifyTask(c.env, c.req.header('x-autodm-task')))) return c.text('forbidden', 403);
  const task = await c.req.json<Task>();
  // Do the work before responding: background work in a service-binding callee is canceled when the
  // caller finishes. The caller awaits every dispatched task.
  try {
    await runTask(c.env, task);
    return c.text('done');
  } catch (err) {
    console.error('task failed', task.type, errorMessage(err));
    return c.text('failed', 500);
  }
});

const redirectUri = (c: { req: { url: string } }, platform: string) =>
  `${new URL(c.req.url).origin}/auth/${platform}/callback`;

app.get('/auth/:platform/callback', async (c) => {
  const platform = c.req.param('platform');
  const { code, state, error } = c.req.query();
  const saved = await getSetting(c.env, `oauth_state_${platform}`);
  if (error || !code || !state || !saved || !safeEqual(state, saved)) {
    return c.html(resultPage(`Falha ao conectar: ${error ?? 'state inválido'}`), 400);
  }
  await deleteSettings(c.env, `oauth_state_${platform}`);
  try {
    const name =
      platform === 'instagram'
        ? await ig.completeOAuth(c.env, code, redirectUri(c, platform))
        : await yt.completeOAuth(c.env, code, redirectUri(c, platform));
    return c.html(resultPage(`Conectado: ${name}`));
  } catch (err) {
    return c.html(resultPage(`Falha ao conectar: ${errorMessage(err)}`), 500);
  }
});

const resultPage = (msg: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;padding:40px">
  <p>${msg.replace(/</g, '&lt;')}</p><p><a href="/admin">Voltar ao painel</a></p>`;

app.get('/favicon.svg', (c) =>
  c.body(FAVICON_SVG, 200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' }),
);
app.get('/manifest.webmanifest', (c) => c.body(JSON.stringify(MANIFEST), 200, { 'content-type': 'application/manifest+json' }));
app.get('/:file{(apple-touch-icon|icon-192|icon-512)\\.png}', (c) => {
  const data = ICONS[c.req.param('file')];
  return data ? c.body(data, 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }) : c.notFound();
});

// ---------- Login: cookie session so the panel works as a Home Screen app on iPhone ----------

const SESSION_COOKIE = 'autodm_session';
const SESSION_DAYS = 365;
// Derived from the password: changing ADMIN_PASSWORD signs every device out.
const sessionValue = (env: Env) => hmacSha256Hex(env.ADMIN_PASSWORD, 'autodm-session-v1');

app.get('/login', (c) => c.html(loginPage()));
app.post('/login', async (c) => {
  const form = await c.req.parseBody();
  const password = typeof form.password === 'string' ? form.password : '';
  if (!c.env.ADMIN_PASSWORD || !safeEqual(password, c.env.ADMIN_PASSWORD)) return c.html(loginPage(true), 401);
  setCookie(c, SESSION_COOKIE, await sessionValue(c.env), {
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400,
  });
  return c.redirect('/admin');
});
app.get('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.redirect('/login');
});

app.get('/favicon.ico', (c) => c.redirect('/favicon.svg', 301));

app.get('/privacy', (c) =>
  c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><title>Política de Privacidade</title>
<body style="font:16px/1.6 system-ui;max-width:680px;margin:40px auto;padding:0 16px">
<h1>Política de Privacidade</h1>
<p>Este aplicativo automatiza respostas a comentários e mensagens nas contas do próprio operador no Instagram e no YouTube.</p>
<p><b>Dados tratados:</b> ID e nome de usuário de quem comenta ou envia mensagem, texto do comentário/mensagem e se a pessoa segue a conta. Usados apenas para enviar a resposta solicitada e gerar métricas internas.</p>
<p><b>Compartilhamento:</b> nenhum dado é vendido ou compartilhado com terceiros.</p>
<p><b>Retenção:</b> registros de eventos são apagados após 180 dias.</p>
<p><b>Exclusão de dados:</b> envie um e-mail para <a href="mailto:${c.env.CONTACT_EMAIL}">${c.env.CONTACT_EMAIL}</a> com seu nome de usuário e todos os seus dados serão removidos em até 30 dias.</p>
</body>`),
);

// ---------- Admin (password-protected) ----------

const admin = new Hono<{ Bindings: Env }>();
admin.use('*', async (c, next) => {
  if (!c.env.ADMIN_PASSWORD) return c.text('ADMIN_PASSWORD não configurada', 500);
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie && safeEqual(cookie, await sessionValue(c.env))) return next();
  // Basic auth still works for scripts (curl -u admin:...).
  if (c.req.header('authorization')) return basicAuth({ username: 'admin', password: c.env.ADMIN_PASSWORD })(c, next);
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'Sessão expirada' }, 401);
  return c.redirect('/login');
});

admin.get('/admin', (c) => c.html(adminHtml));

admin.get('/auth/:platform/start', async (c) => {
  const platform = c.req.param('platform');
  const state = randomToken();
  await setSettings(c.env, { [`oauth_state_${platform}`]: state });
  const uri = redirectUri(c, platform);
  if (platform === 'instagram') return c.redirect(ig.authorizeUrl(c.env, uri, state));
  if (platform === 'youtube') return c.redirect(yt.authorizeUrl(c.env, uri, state));
  return c.notFound();
});

admin.post('/api/disconnect/:platform', async (c) => {
  await deleteSettings(c.env, c.req.param('platform') === 'instagram' ? 'ig_' : 'yt_');
  return c.json({ ok: true });
});

admin.get('/api/status', async (c) => {
  const s = (k: string) => getSetting(c.env, k);
  const [igUser, ytTitle, ytPoll] = await Promise.all([s('ig_username'), s('yt_channel_title'), s('yt_last_poll')]);
  const origin = new URL(c.req.url).origin;
  return c.json({
    instagram: { connected: Boolean(igUser), username: igUser ?? null },
    youtube: { connected: Boolean(ytTitle), title: ytTitle ?? null, lastPoll: ytPoll ?? null },
    urls: {
      webhook: `${origin}/webhooks/instagram`,
      igRedirect: `${origin}/auth/instagram/callback`,
      ytRedirect: `${origin}/auth/youtube/callback`,
      privacy: `${origin}/privacy`,
    },
    configured: {
      instagram: Boolean(c.env.IG_APP_ID && c.env.IG_APP_SECRET && c.env.IG_VERIFY_TOKEN),
      youtube: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    },
  });
});

admin.get('/api/rules', async (c) => c.json(await listRules(c.env)));

// Welcome offer for new followers (not a comment automation; see ig.getWelcome).
admin.get('/api/welcome', async (c) => c.json(await ig.getWelcome(c.env)));

admin.put('/api/welcome', async (c) => {
  const b = await c.req.json<Partial<Record<keyof ig.WelcomeSettings, string>>>();
  const w = { ...(await ig.getWelcome(c.env)), ...b };
  const delay = Number(w.welcome_delay_minutes);
  if (!Number.isInteger(delay) || delay < 1 || delay > 600) return c.json({ error: 'Espera: de 1 a 600 minutos' }, 400);
  if (w.welcome_text.length > 1000) return c.json({ error: 'Mensagem muito longa (máx. 1000 caracteres)' }, 400);
  if (!w.welcome_button.trim() || w.welcome_button.length > 20) return c.json({ error: 'Botão: de 1 a 20 caracteres' }, 400);
  if (w.welcome_link !== '{oferta_ebook}' && !/^https?:\/\//.test(w.welcome_link)) return c.json({ error: 'Link precisa começar com http(s):// (ou {oferta_ebook})' }, 400);
  if (w.welcome_active === '1' && !w.welcome_text.trim()) return c.json({ error: 'Escreva a mensagem antes de ligar' }, 400);
  await setSettings(c.env, {
    welcome_active: w.welcome_active === '1' ? '1' : '0',
    welcome_delay_minutes: String(delay),
    welcome_text: w.welcome_text,
    welcome_button: w.welcome_button.trim(),
    welcome_link: w.welcome_link.trim(),
  });
  return c.json(await ig.getWelcome(c.env));
});

function validate(body: Partial<Rule>): string | undefined {
  if (!body.name?.trim()) return 'Nome obrigatório';
  if (body.platform !== 'instagram' && body.platform !== 'youtube') return 'Plataforma inválida';
  if (body.platform === 'youtube') {
    if (body.trigger === 'dm') return 'YouTube não tem DM';
    if (!body.public_replies?.length) return 'YouTube precisa de pelo menos uma resposta pública';
  }
  if (body.platform === 'instagram' && !body.dm_text?.trim() && !body.public_replies?.length) {
    return 'Defina uma DM ou uma resposta pública';
  }
  if (body.require_follow && !body.link_url && !body.link_text) return 'Com "exigir seguir", defina o link ou a mensagem final';
  const delay = body.link_delay_minutes ?? 0;
  if (!Number.isInteger(delay) || delay < 0 || delay > 600) return 'Espera do link: de 0 a 600 minutos';
  if (body.link_url && body.link_url !== '{oferta_ebook}' && !/^https?:\/\//.test(body.link_url)) return 'Link precisa começar com http(s):// (ou {oferta_ebook})';
  return undefined;
}

admin.post('/api/rules', async (c) => {
  const body = await c.req.json<Partial<Rule>>();
  const err = validate(body);
  if (err) return c.json({ error: err }, 400);
  return c.json({ id: await saveRule(c.env, body) });
});

admin.put('/api/rules/:id', async (c) => {
  const body = await c.req.json<Partial<Rule>>();
  const err = validate(body);
  if (err) return c.json({ error: err }, 400);
  return c.json({ id: await saveRule(c.env, body, Number(c.req.param('id'))) });
});

admin.delete('/api/rules/:id', async (c) => {
  await deleteRule(c.env, Number(c.req.param('id')));
  return c.json({ ok: true });
});

admin.get('/api/media/:platform', async (c) => {
  try {
    const media = c.req.param('platform') === 'instagram' ? await ig.listMedia(c.env) : await yt.listMedia(c.env);
    return c.json(media);
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 502);
  }
});

admin.get('/api/media-info/instagram', async (c) => {
  const ids = (c.req.query('ids') ?? '').split(',').filter(Boolean);
  try {
    return c.json(await ig.mediaInfo(c.env, ids));
  } catch (err) {
    return c.json({ error: errorMessage(err) }, 502);
  }
});

admin.get('/api/stats', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT rule_id, type, COUNT(*) AS n FROM events WHERE rule_id IS NOT NULL GROUP BY rule_id, type',
  ).all<{ rule_id: number; type: string; n: number }>();
  const stats: Record<number, Record<string, number>> = {};
  for (const r of results) (stats[r.rule_id] ??= {})[r.type] = r.n;
  const contacts = await c.env.DB.prepare('SELECT platform, COUNT(*) AS n FROM contacts GROUP BY platform').all();
  return c.json({ rules: stats, contacts: contacts.results });
});

admin.get('/api/events', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, r.name AS rule_name FROM events e LEFT JOIN rules r ON r.id = e.rule_id
     ORDER BY e.id DESC LIMIT 100`,
  ).all();
  return c.json(results);
});

admin.post('/api/test', async (c) => {
  const body = await c.req.json<{ platform: 'instagram' | 'youtube'; trigger: 'comment' | 'dm'; text: string; mediaId?: string }>();
  // Ignore post scoping so a rule tied to specific posts still shows up in the tester.
  const rules = (await listRules(c.env)).map((r) => ({ ...r, media_ids: [] }));
  const rule = findRule(rules, body);
  return c.json({ rule: rule ? { id: rule.id, name: rule.name } : null });
});

app.route('/', admin);
app.get('/', (c) => c.redirect('/admin'));

export default {
  fetch: app.fetch,
  // Runs every minute: Instagram comments and retries each run, everything else every 5 minutes.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const inline = (t: Task) => runTask(env, t);
    const fanOut = async () => {
      const [posts, retries] = await Promise.all([ig.postsToPoll(env), ig.duePendingIds(env)]);
      await dispatch(env, [
        ...posts.map((mediaId): Task => ({ type: 'poll_media', mediaId })),
        ...retries.map((id): Task => ({ type: 'retry', id })),
      ], inline);
    };
    const jobs = [fanOut()];
    if (new Date(event.scheduledTime).getUTCMinutes() % 5 === 0) {
      jobs.push(dispatch(env, [{ type: 'yt_poll' }], inline), ig.refreshTokenIfNeeded(env), cleanup(env));
    }
    ctx.waitUntil(Promise.allSettled(jobs));
  },
} satisfies ExportedHandler<Env>;
