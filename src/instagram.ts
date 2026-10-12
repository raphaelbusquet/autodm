import { claim, getRule, getSetting, listRules, logEvent, recentlyTriggered, setSettings, touchContact } from './db';
import { fill, findRule, pick } from './match';
import type { Env, Rule } from './types';
import { errorMessage, fetchJson } from './util';

const GRAPH_VERSION = 'v24.0';
const SCOPES = 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments';
const BUTTON_PREFIX = 'R:';

function graphBase(env: Env): string {
  return `${env.IG_GRAPH_BASE ?? 'https://graph.instagram.com'}`;
}

async function token(env: Env): Promise<string> {
  const t = await getSetting(env, 'ig_token');
  if (!t) throw new Error('Instagram não conectado');
  return t;
}

async function graph<T = any>(
  env: Env,
  path: string,
  opts: { method?: 'GET' | 'POST'; params?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  const url = new URL(`${graphBase(env)}/${GRAPH_VERSION}/${path}`);
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
  url.searchParams.set('access_token', await token(env));
  return fetchJson<T>(url.toString(), {
    method: opts.method ?? 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

// ---------- OAuth ----------

export function authorizeUrl(env: Env, redirectUri: string, state: string): string {
  const u = new URL('https://www.instagram.com/oauth/authorize');
  u.searchParams.set('enable_fb_login', '0');
  u.searchParams.set('force_authentication', '1');
  u.searchParams.set('client_id', env.IG_APP_ID);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('state', state);
  return u.toString();
}

export async function completeOAuth(env: Env, code: string, redirectUri: string): Promise<string> {
  const short = await fetchJson<any>('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.IG_APP_ID,
      client_secret: env.IG_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    }),
  });
  const shortToken: string = short.access_token ?? short.data?.[0]?.access_token;
  const long = await fetchJson<{ access_token: string }>(
    `${graphBase(env)}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(env.IG_APP_SECRET)}&access_token=${encodeURIComponent(shortToken)}`,
  );
  await setSettings(env, { ig_token: long.access_token, ig_token_at: String(Math.floor(Date.now() / 1000)) });
  const me = await graph<{ user_id: string; username: string }>(env, 'me', { params: { fields: 'user_id,username' } });
  await setSettings(env, { ig_user_id: String(me.user_id), ig_username: me.username });
  await graph(env, 'me/subscribed_apps', {
    method: 'POST',
    params: { subscribed_fields: 'comments,messages,messaging_postbacks' },
  });
  return me.username;
}

/** Long-lived tokens last 60 days; refresh weekly. */
export async function refreshTokenIfNeeded(env: Env): Promise<void> {
  const [tok, at] = await Promise.all([getSetting(env, 'ig_token'), getSetting(env, 'ig_token_at')]);
  if (!tok) return;
  const now = Math.floor(Date.now() / 1000);
  if (now - Number(at ?? 0) < 7 * 86400) return;
  try {
    const res = await fetchJson<{ access_token: string }>(
      `${graphBase(env)}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(tok)}`,
    );
    if (!res.access_token) throw new Error('resposta sem access_token');
    await setSettings(env, { ig_token: res.access_token, ig_token_at: String(now) });
  } catch (err) {
    await logEvent(env, { platform: 'instagram', type: 'error', detail: `token refresh: ${errorMessage(err)}` });
  }
}

export async function listMedia(env: Env) {
  const res = await graph<{ data: any[] }>(env, 'me/media', {
    params: { fields: 'id,caption,permalink,media_type,media_product_type,thumbnail_url,media_url,timestamp', limit: '50' },
  });
  return res.data.map((m) => ({
    id: m.id,
    title: (m.caption ?? '').slice(0, 120) || '(sem legenda)',
    thumbnail: m.thumbnail_url ?? (m.media_type === 'VIDEO' ? '' : m.media_url) ?? '',
    url: m.permalink,
    date: m.timestamp,
    type: m.media_product_type ?? m.media_type,
  }));
}

/** Cover + link for specific posts (automation list). Thumbnail URLs expire, so they are fetched live. */
export async function mediaInfo(env: Env, ids: string[]) {
  const results = await Promise.allSettled(
    ids.slice(0, 40).map((id) =>
      graph<any>(env, id, { params: { fields: 'id,caption,permalink,media_type,thumbnail_url,media_url' } }),
    ),
  );
  return results.flatMap((r) =>
    r.status === 'fulfilled'
      ? [{
          id: r.value.id,
          title: (r.value.caption ?? '').slice(0, 120),
          thumbnail: r.value.thumbnail_url ?? (r.value.media_type === 'VIDEO' ? '' : r.value.media_url) ?? '',
          url: r.value.permalink,
        }]
      : [],
  );
}

// ---------- Messaging ----------

type Recipient = { id: string } | { comment_id: string };
type Button = { type: 'postback'; title: string; payload: string } | { type: 'web_url'; title: string; url: string };

function buttons(text: string, btns: Button[]) {
  return { attachment: { type: 'template', payload: { template_type: 'button', text, buttons: btns } } };
}

async function send(env: Env, recipient: Recipient, message: unknown) {
  return graph(env, 'me/messages', { method: 'POST', body: { recipient, message } });
}

function confirmButton(rule: Rule): Button {
  return { type: 'postback', title: (rule.button_label || 'Quero o link!').slice(0, 20), payload: `${BUTTON_PREFIX}${rule.id}` };
}

/** Button shown with the "follow me first" messages. Same payload, so tapping it re-checks the follow. */
function followButton(rule: Rule): Button {
  return { type: 'postback', title: (rule.follow_button_label || 'Já segui!').slice(0, 20), payload: `${BUTTON_PREFIX}${rule.id}` };
}

/** First DM. With follow gate it asks for a click (opens the 24h window and lets us check follow status). */
function openingMessage(rule: Rule, username: string) {
  const text = fill(rule.dm_text, { username });
  if (rule.require_follow) return buttons(text, [confirmButton(rule)]);
  if (rule.link_url) {
    return buttons(text, [{ type: 'web_url', url: rule.link_url, title: (rule.link_button_label || 'Abrir link').slice(0, 20) }]);
  }
  return text ? { text } : undefined;
}

function linkMessage(rule: Rule, username: string, name = '') {
  const text = fill(rule.link_text || rule.dm_text, { username, name });
  if (rule.link_url) {
    return buttons(text, [{ type: 'web_url', url: rule.link_url, title: (rule.link_button_label || 'Abrir link').slice(0, 20) }]);
  }
  return text ? { text } : undefined;
}

// ---------- Retry queue: locked conversations and Meta rate limits ----------

const RETRY_EVERY = 5 * 60;
const DM_WINDOW = 24 * 60 * 60; // DM triggers: Meta's 24h messaging window
const COMMENT_WINDOW = 7 * 24 * 60 * 60 - 3600; // private replies: 7 days after the comment, minus margin
const RETRIES_PER_RUN = 10; // ~600/h, under Meta's 750 private replies/hour

/** Another app (or Meta's inbox) owns the thread. These locks expire on their own. */
function isThreadLocked(err: unknown): boolean {
  const msg = errorMessage(err);
  return /thread owner/i.test(msg) || msg.includes('2534037');
}

/** Meta throttling (e.g. 750 private replies/hour): wait and send later. */
function isRateLimited(err: unknown): boolean {
  return /\b429\b|rate limit|request limit|too many|limit reached|\(#(4|17|32|613)\)/i.test(errorMessage(err));
}

const isRetryable = (err: unknown) => isThreadLocked(err) || isRateLimited(err);

type PendingKind = 'dm' | 'reply' | 'link';

async function enqueue(
  env: Env,
  kind: PendingKind,
  ruleId: number,
  recipient: Recipient,
  message: unknown,
  user: { id: string; username: string },
  ref: string,
  error: string,
) {
  const window = 'comment_id' in recipient ? COMMENT_WINDOW : DM_WINDOW;
  await env.DB.prepare(
    `INSERT INTO pending_sends (kind, rule_id, recipient, message, user_id, username, ref, last_error, next_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch() + ?, unixepoch() + ?)`,
  ).bind(kind, ruleId, JSON.stringify(recipient), JSON.stringify(message), user.id, user.username, ref, error.slice(0, 500), RETRY_EVERY, window).run();
}

/** Cron: pick due retries; each runs in its own invocation. */
export async function duePendingIds(env: Env): Promise<number[]> {
  const { results } = await env.DB.prepare(
    'SELECT id FROM pending_sends WHERE next_at <= unixepoch() ORDER BY id LIMIT ?',
  ).bind(RETRIES_PER_RUN).all<{ id: number }>();
  // Push them forward right away so an overlapping run doesn't pick them again.
  if (results.length) {
    await env.DB.prepare(`UPDATE pending_sends SET next_at = unixepoch() + ? WHERE id IN (${results.map(() => '?').join(',')})`)
      .bind(RETRY_EVERY, ...results.map((r) => r.id)).run();
  }
  return results.map((r) => r.id);
}

export async function retryOne(env: Env, id: number): Promise<void> {
  const p = await env.DB.prepare('SELECT * FROM pending_sends WHERE id = ?').bind(id).first<{
    id: number; kind: PendingKind; rule_id: number; recipient: string; message: string; user_id: string; username: string; ref: string; expires_at: number;
  }>();
  if (!p) return;
  const ev = { ruleId: p.rule_id, platform: 'instagram' as const, userId: p.user_id, username: p.username, ref: p.ref };
  const recipient = JSON.parse(p.recipient) as Recipient;
  if (p.kind === 'link') return sendScheduledLink(env, p);
  try {
    if (p.kind === 'reply' && 'comment_id' in recipient) {
      await graph(env, `${recipient.comment_id}/replies`, { method: 'POST', params: { message: JSON.parse(p.message) } });
      await logEvent(env, { ...ev, type: 'public_reply', detail: 'enviada após nova tentativa' });
    } else {
      await send(env, recipient, JSON.parse(p.message));
      await logEvent(env, { ...ev, type: 'dm_sent', detail: 'enviada após nova tentativa' });
    }
    await env.DB.prepare('DELETE FROM pending_sends WHERE id = ?').bind(p.id).run();
  } catch (err) {
    if (!isRetryable(err) || Math.floor(Date.now() / 1000) >= p.expires_at) {
      await env.DB.prepare('DELETE FROM pending_sends WHERE id = ?').bind(p.id).run();
      await logEvent(env, { ...ev, type: 'gave_up', detail: errorMessage(err) });
    } else {
      await env.DB.prepare('UPDATE pending_sends SET attempts = attempts + 1, last_error = ? WHERE id = ?')
        .bind(errorMessage(err).slice(0, 500), p.id).run();
    }
  }
}

/**
 * Skip the button when we can already see the person follows. Meta only answers for people who have
 * messaged or tapped before (otherwise "User consent is required"), so most first-timers still get the button.
 */
async function alreadyFollowsLink(env: Env, rule: Rule, userId: string) {
  if (!rule.require_follow) return undefined;
  try {
    const p = await graph<{ name?: string; username?: string; is_user_follow_business?: boolean }>(env, userId, {
      params: { fields: 'name,username,is_user_follow_business' },
    });
    if (p.is_user_follow_business !== true) return undefined;
    await logEvent(env, { ruleId: rule.id, platform: 'instagram', type: 'link_sent', userId, username: p.username ?? '', detail: 'já seguia' });
    return linkMessage(rule, p.username ?? '', p.name ?? '');
  } catch {
    return undefined;
  }
}

async function runRule(env: Env, rule: Rule, recipient: Recipient, user: { id: string; username: string }, ref: string, text: string) {
  if (await recentlyTriggered(env, rule.id, user.id)) {
    await logEvent(env, { ruleId: rule.id, platform: 'instagram', type: 'skipped_repeat', userId: user.id, username: user.username, ref });
    return;
  }
  await logEvent(env, { ruleId: rule.id, platform: 'instagram', type: 'triggered', userId: user.id, username: user.username, ref, detail: text });
  const ev = { ruleId: rule.id, platform: 'instagram' as const, userId: user.id, username: user.username, ref };

  const msg = (await alreadyFollowsLink(env, rule, user.id)) ?? openingMessage(rule, user.username);
  if (msg) {
    try {
      await send(env, recipient, msg);
      await logEvent(env, { ...ev, type: 'dm_sent' });
    } catch (err) {
      if (isRetryable(err)) {
        await enqueue(env, 'dm', rule.id, recipient, msg, user, ref, errorMessage(err));
        await logEvent(env, { ...ev, type: 'dm_queued', detail: isRateLimited(err) ? 'limite da Meta' : 'conversa travada' });
      } else {
        await logEvent(env, { ...ev, type: 'error', detail: `dm: ${errorMessage(err)}` });
      }
    }
  }

  const reply = 'comment_id' in recipient ? pick(rule.public_replies) : undefined;
  if (reply && 'comment_id' in recipient) {
    const message = fill(reply, { username: user.username });
    try {
      await graph(env, `${recipient.comment_id}/replies`, { method: 'POST', params: { message } });
      await logEvent(env, { ...ev, type: 'public_reply' });
    } catch (err) {
      if (isRateLimited(err)) {
        await enqueue(env, 'reply', rule.id, recipient, message, user, ref, errorMessage(err));
        await logEvent(env, { ...ev, type: 'reply_queued', detail: 'limite da Meta' });
      } else {
        await logEvent(env, { ...ev, type: 'error', detail: `reply: ${errorMessage(err)}` });
      }
    }
  }
}

async function onComment(env: Env, accountId: string, v: any) {
  const userId: string | undefined = v?.from?.id;
  if (!userId || userId === accountId || !v.id) return;
  if (!(await claim(env, `ig:c:${v.id}`))) return;
  const username: string = v.from.username ?? '';
  await touchContact(env, 'instagram', userId, username);
  const rule = findRule(await listRules(env), { platform: 'instagram', trigger: 'comment', text: v.text ?? '', mediaId: v.media?.id });
  if (rule) await runRule(env, rule, { comment_id: v.id }, { id: userId, username }, v.id, v.text ?? '');
}

export async function processComment(env: Env, comment: any, mediaId: string): Promise<void> {
  const accountId = (await getSetting(env, 'ig_user_id')) ?? '';
  await onComment(env, accountId, { ...comment, media: { id: mediaId } });
}

const RECENT_POSTS = 5;
const COMMENT_PAGES = 10; // up to 500 comments per post per minute
const DISPATCH_PER_RUN = 38; // stays under 50 subrequests with the page fetches

/**
 * Cron: which posts to poll. Works with Standard Access, so comment automations run before App
 * Review grants the comments webhook. Shares the dedup key with the webhook.
 */
export async function postsToPoll(env: Env): Promise<string[]> {
  if (!(await getSetting(env, 'ig_user_id'))) return [];
  const rules = (await listRules(env)).filter((r) => r.platform === 'instagram' && r.trigger === 'comment' && r.active);
  if (rules.length === 0) return [];
  const mediaIds = new Set(rules.flatMap((r) => r.media_ids));
  if (rules.some((r) => r.media_ids.length === 0)) {
    try {
      const recent = await graph<{ data: { id: string }[] }>(env, 'me/media', { params: { fields: 'id', limit: String(RECENT_POSTS) } });
      for (const m of recent.data) mediaIds.add(m.id);
    } catch (err) {
      await logEvent(env, { platform: 'instagram', type: 'error', detail: `poll media: ${errorMessage(err)}` });
    }
  }
  return [...mediaIds];
}

/**
 * One post: page through comments newer than this post's cursor (newest first from the API), then
 * return the oldest DISPATCH_PER_RUN of them. A spike bigger than that carries over to the next minute.
 */
export async function newCommentsForPost(env: Env, mediaId: string): Promise<any[]> {
  const cursorKey = `ig_cursor_${mediaId}`;
  // Posts polled before per-post cursors existed continue from the old global cursor.
  const cursor = Number((await getSetting(env, cursorKey)) ?? (await getSetting(env, 'ig_last_comment_poll')) ?? 0);
  if (!cursor) {
    // First time we see this post: start from now, never mass-reply to the backlog.
    await setSettings(env, { [cursorKey]: String(Date.now()) });
    return [];
  }
  const fresh: any[] = [];
  let after: string | undefined;
  try {
    for (let page = 0; page < COMMENT_PAGES; page++) {
      const res = await graph<{ data: any[]; paging?: { cursors?: { after?: string }; next?: string } }>(env, `${mediaId}/comments`, {
        params: { fields: 'id,text,timestamp,from', limit: '50', ...(after ? { after } : {}) },
      });
      const newer = res.data.filter((c) => Date.parse(c.timestamp) >= cursor);
      fresh.push(...newer);
      after = res.paging?.cursors?.after;
      if (newer.length < res.data.length || !res.paging?.next || !after) break;
    }
  } catch (err) {
    await logEvent(env, { platform: 'instagram', type: 'error', detail: `poll comments ${mediaId}: ${errorMessage(err)}` });
    return [];
  }
  const batch = fresh.reverse().slice(0, DISPATCH_PER_RUN); // oldest first
  // Comments in the same second as the cursor are re-fetched next time; claim() dedups them.
  const next = batch.length === fresh.length ? Date.now() - 5000 : Date.parse(batch[batch.length - 1].timestamp);
  await setSettings(env, { [cursorKey]: String(Math.max(cursor, next)) });
  return batch;
}

const FOLLOW_CHECK_DELAYS = [0, 1500, 3000, 5000];

/**
 * Right after the first tap Meta may still answer "User consent is required" — consent lands a few
 * seconds later — so retry before deciding. Returns undefined if it never answers.
 */
async function checkFollow(env: Env, rule: Rule, userId: string): Promise<{ follows: boolean; username: string; name: string } | undefined> {
  let lastError = '';
  for (const delay of FOLLOW_CHECK_DELAYS) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      const profile = await graph<{ name?: string; username?: string; is_user_follow_business?: boolean }>(env, userId, {
        params: { fields: 'name,username,is_user_follow_business' },
      });
      return { follows: profile.is_user_follow_business === true, username: profile.username ?? '', name: profile.name ?? '' };
    } catch (err) {
      lastError = errorMessage(err);
    }
  }
  await logEvent(env, { ruleId: rule.id, platform: 'instagram', type: 'error', userId, detail: `follow check: ${lastError}` });
  return undefined;
}

const DEFAULT_WAIT = 'Follow confirmado ✅ Já já te mando o link por aqui!';
const DEFAULT_STILL = 'Hmm, parece que você ainda não me segue 🤔 Segue e toca no botão de novo!';

/**
 * Follow confirmed: say the link is coming and send it after the rule's delay. The follow is checked
 * again at send time, so following, tapping and unfollowing right away doesn't get the link.
 */
async function scheduleLink(env: Env, rule: Rule, userId: string, username: string) {
  await send(env, { id: userId }, { text: fill(rule.wait_text || DEFAULT_WAIT, { username }) });
  // The tap opened a 24h messaging window; keep an hour of margin.
  await env.DB.prepare(
    `INSERT INTO pending_sends (kind, rule_id, recipient, message, user_id, username, ref, last_error, next_at, expires_at)
     VALUES ('link', ?, ?, '{}', ?, ?, '', '', unixepoch() + ?, unixepoch() + ?)`,
  ).bind(rule.id, JSON.stringify({ id: userId }), userId, username, rule.link_delay_minutes * 60, DM_WINDOW - 3600).run();
  await logEvent(env, { ruleId: rule.id, platform: 'instagram', type: 'link_scheduled', userId, username, detail: `${rule.link_delay_minutes} min` });
}

async function sendScheduledLink(env: Env, p: { id: number; rule_id: number; user_id: string; username: string; expires_at: number }) {
  const ev = { ruleId: p.rule_id, platform: 'instagram' as const, userId: p.user_id, username: p.username };
  const done = () => env.DB.prepare('DELETE FROM pending_sends WHERE id = ?').bind(p.id).run();
  const expired = Math.floor(Date.now() / 1000) >= p.expires_at;
  const rule = await getRule(env, p.rule_id);
  if (!rule) return void (await done());
  try {
    const result = await checkFollow(env, rule, p.user_id);
    if (!result) {
      // Meta didn't answer; the cron picks it up again in a few minutes.
      if (expired) { await done(); await logEvent(env, { ...ev, type: 'gave_up', detail: 'follow check' }); }
      return;
    }
    if (!result.follows) {
      await done();
      await send(env, { id: p.user_id }, buttons(fill(rule.still_not_following_text || DEFAULT_STILL, result), [followButton(rule)]));
      await logEvent(env, { ...ev, type: 'unfollowed' });
      return;
    }
    const msg = linkMessage(rule, result.username, result.name);
    if (msg) await send(env, { id: p.user_id }, msg);
    await done();
    await logEvent(env, { ...ev, type: 'link_sent' });
  } catch (err) {
    if (!isRetryable(err) || expired) {
      await done();
      await logEvent(env, { ...ev, type: 'gave_up', detail: errorMessage(err) });
    }
  }
}

/** The link went out already, or is scheduled. Also covers the account owner tapping the button in their own inbox,
 * which Meta reports with the customer as sender. */
async function linkAlreadySent(env: Env, ruleId: number, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM events WHERE rule_id = ? AND user_id = ? AND type = 'link_sent'
     AND created_at > unixepoch() - 86400 LIMIT 1`,
  ).bind(ruleId, userId).first();
  if (row) return true;
  const pending = await env.DB.prepare(
    "SELECT 1 FROM pending_sends WHERE kind = 'link' AND rule_id = ? AND user_id = ? LIMIT 1",
  ).bind(ruleId, userId).first();
  return pending !== null;
}

async function onButton(env: Env, userId: string, payload: string) {
  if (!payload.startsWith(BUTTON_PREFIX)) return;
  const rule = await getRule(env, Number(payload.slice(BUTTON_PREFIX.length)));
  if (!rule) return;
  if (await linkAlreadySent(env, rule.id, userId)) {
    await logEvent(env, { ruleId: rule.id, platform: 'instagram', type: 'button_repeat', userId });
    return;
  }
  let username = '';
  let name = '';
  if (rule.require_follow) {
    // Fail closed: without a confirmed follow, ask to follow and tap again (the next tap usually passes).
    const result = await checkFollow(env, rule, userId);
    username = result?.username ?? '';
    name = result?.name ?? '';
    await logEvent(env, { ruleId: rule.id, platform: 'instagram', type: 'button_click', userId, username });
    if (!result?.follows) {
      // Second and later misses get their own message ("looks like you haven't followed yet").
      const askedBefore = await env.DB.prepare(
        `SELECT 1 FROM events WHERE rule_id = ? AND user_id = ? AND type = 'not_following'
         AND created_at > unixepoch() - 86400 LIMIT 1`,
      ).bind(rule.id, userId).first();
      const template = askedBefore
        ? rule.still_not_following_text || DEFAULT_STILL
        : rule.not_following_text || 'Me segue primeiro e depois toca no botão de novo 😉';
      await send(env, { id: userId }, buttons(fill(template, { username, name }), [followButton(rule)]));
      await logEvent(env, { ruleId: rule.id, platform: 'instagram', type: 'not_following', userId, username });
      return;
    }
    if (rule.link_delay_minutes > 0) return scheduleLink(env, rule, userId, username);
  } else {
    try {
      const profile = await graph<{ name?: string; username?: string }>(env, userId, { params: { fields: 'name,username' } });
      username = profile.username ?? '';
      name = profile.name ?? '';
    } catch {
      // Name is cosmetic; send the link anyway.
    }
    await logEvent(env, { ruleId: rule.id, platform: 'instagram', type: 'button_click', userId, username });
  }
  const msg = linkMessage(rule, username, name);
  if (msg) {
    await send(env, { id: userId }, msg);
    await logEvent(env, { ruleId: rule.id, platform: 'instagram', type: 'link_sent', userId, username });
  }
}

async function onMessaging(env: Env, accountId: string, m: any) {
  const userId: string | undefined = m?.sender?.id;
  if (!userId || userId === accountId || m.message?.is_echo) return;
  const mid: string = m.postback?.mid ?? m.message?.mid ?? `${userId}:${m.timestamp}`;
  if (!(await claim(env, `ig:m:${mid}`))) return;
  await touchContact(env, 'instagram', userId);

  const payload: string | undefined = m.postback?.payload ?? m.message?.quick_reply?.payload;
  if (payload) return onButton(env, userId, payload);

  const text: string | undefined = m.message?.text;
  if (!text) return;
  const rule = findRule(await listRules(env), { platform: 'instagram', trigger: 'dm', text });
  if (rule) await runRule(env, rule, { id: userId }, { id: userId, username: '' }, mid, text);
}

export async function handleWebhook(env: Env, payload: any): Promise<void> {
  const accountId = (await getSetting(env, 'ig_user_id')) ?? '';
  for (const entry of payload?.entry ?? []) {
    const self = accountId || String(entry.id);
    for (const change of entry.changes ?? []) {
      try {
        if (change.field === 'comments') await onComment(env, self, change.value);
        else if (change.field === 'messages') await onMessaging(env, self, change.value);
      } catch (err) {
        await logEvent(env, { platform: 'instagram', type: 'error', detail: `webhook ${change.field}: ${errorMessage(err)}` });
      }
    }
    for (const m of [...(entry.messaging ?? []), ...(entry.standby ?? [])]) {
      try {
        await onMessaging(env, self, m);
      } catch (err) {
        await logEvent(env, { platform: 'instagram', type: 'error', detail: `webhook messaging: ${errorMessage(err)}` });
      }
    }
  }
}
