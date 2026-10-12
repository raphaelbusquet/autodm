import { claim, getSetting, listRules, logEvent, recentlyTriggered, setSettings, touchContact } from './db';
import { fill, findRule, pick } from './match';
import type { Env } from './types';
import { errorMessage, fetchJson } from './util';

const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const MAX_PAGES = 3;

const apiBase = (env: Env) => env.YT_API_BASE ?? 'https://www.googleapis.com/youtube/v3';
const tokenUrl = (env: Env) => env.GOOGLE_TOKEN_URL ?? 'https://oauth2.googleapis.com/token';

export function authorizeUrl(env: Env, redirectUri: string, state: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', state);
  return u.toString();
}

export async function completeOAuth(env: Env, code: string, redirectUri: string): Promise<string> {
  const tok = await fetchJson<{ access_token: string; refresh_token?: string; expires_in: number }>(tokenUrl(env), {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    }),
  });
  if (!tok.refresh_token) throw new Error('Google não devolveu refresh_token; remova o acesso do app na conta Google e conecte de novo');
  await setSettings(env, {
    yt_refresh_token: tok.refresh_token,
    yt_access_token: tok.access_token,
    yt_access_exp: String(Date.now() + (tok.expires_in - 60) * 1000),
  });
  const ch = await api<{ items: any[] }>(env, 'channels', { part: 'snippet,contentDetails', mine: 'true' });
  const channel = ch.items[0];
  if (!channel) throw new Error('Conta Google sem canal do YouTube');
  await setSettings(env, {
    yt_channel_id: channel.id,
    yt_channel_title: channel.snippet.title,
    yt_uploads: channel.contentDetails.relatedPlaylists.uploads,
    // Start from now: never mass-reply to the backlog of old comments.
    yt_last_poll: new Date().toISOString(),
  });
  return channel.snippet.title;
}

async function accessToken(env: Env): Promise<string> {
  const [tok, exp, refresh] = await Promise.all([
    getSetting(env, 'yt_access_token'),
    getSetting(env, 'yt_access_exp'),
    getSetting(env, 'yt_refresh_token'),
  ]);
  if (tok && Number(exp) > Date.now()) return tok;
  if (!refresh) throw new Error('YouTube não conectado');
  const res = await fetchJson<{ access_token: string; expires_in: number }>(tokenUrl(env), {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }),
  });
  await setSettings(env, { yt_access_token: res.access_token, yt_access_exp: String(Date.now() + (res.expires_in - 60) * 1000) });
  return res.access_token;
}

async function api<T = any>(env: Env, path: string, params: Record<string, string>, body?: unknown): Promise<T> {
  const url = new URL(`${apiBase(env)}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return fetchJson<T>(url.toString(), {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${await accessToken(env)}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function listMedia(env: Env) {
  const uploads = await getSetting(env, 'yt_uploads');
  if (!uploads) throw new Error('YouTube não conectado');
  const res = await api<{ items: any[] }>(env, 'playlistItems', { part: 'snippet', playlistId: uploads, maxResults: '50' });
  return res.items.map((i) => ({
    id: i.snippet.resourceId.videoId,
    title: i.snippet.title,
    thumbnail: i.snippet.thumbnails?.medium?.url ?? i.snippet.thumbnails?.default?.url ?? '',
    url: `https://youtube.com/shorts/${i.snippet.resourceId.videoId}`,
    date: i.snippet.publishedAt,
    type: 'VIDEO',
  }));
}

export type YtComment = { threadId: string; id: string; userId: string; username: string; text: string; videoId: string; publishedAt: string };

const DISPATCH_PER_RUN = 30; // each reply costs 50 of the 10k daily quota units, ~190 replies/day

/** Cron: comments newer than the cursor across the whole channel (1 quota unit per page), oldest first. */
export async function newComments(env: Env): Promise<YtComment[]> {
  const [channelId, lastPoll] = await Promise.all([getSetting(env, 'yt_channel_id'), getSetting(env, 'yt_last_poll')]);
  if (!channelId) return [];
  const rules = (await listRules(env)).filter((r) => r.platform === 'youtube' && r.active);
  if (rules.length === 0) return [];

  const since = lastPoll ?? new Date().toISOString();
  const startedAt = new Date().toISOString();
  const fresh: YtComment[] = [];
  let pageToken: string | undefined;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await api<{ items: any[]; nextPageToken?: string }>(env, 'commentThreads', {
        part: 'snippet',
        allThreadsRelatedToChannelId: channelId,
        order: 'time',
        maxResults: '100',
        textFormat: 'plainText',
        ...(pageToken ? { pageToken } : {}),
      });
      const newer = res.items.filter((t) => t.snippet.topLevelComment.snippet.publishedAt > since);
      for (const t of newer) {
        const c = t.snippet.topLevelComment;
        fresh.push({
          threadId: t.id,
          id: c.id,
          userId: c.snippet.authorChannelId?.value ?? '',
          username: c.snippet.authorDisplayName ?? '',
          text: c.snippet.textOriginal ?? c.snippet.textDisplay ?? '',
          videoId: t.snippet.videoId,
          publishedAt: c.snippet.publishedAt,
        });
      }
      if (newer.length < res.items.length || !res.nextPageToken) break;
      pageToken = res.nextPageToken;
    }
  } catch (err) {
    await logEvent(env, { platform: 'youtube', type: 'error', detail: `poll: ${errorMessage(err)}` });
    return [];
  }
  const batch = fresh
    .reverse()
    .filter((c) => c.userId && c.userId !== channelId)
    .slice(0, DISPATCH_PER_RUN);
  // Backlog bigger than one run: resume from the last comment taken (claim() dedups the overlap).
  const next = batch.length === DISPATCH_PER_RUN ? batch[batch.length - 1].publishedAt : startedAt;
  await setSettings(env, { yt_last_poll: next > since ? next : since });
  return batch;
}

export async function processComment(env: Env, c: YtComment): Promise<void> {
  if (!(await claim(env, `yt:c:${c.id}`))) return;
  await touchContact(env, 'youtube', c.userId, c.username);
  const rule = findRule(await listRules(env), { platform: 'youtube', trigger: 'comment', text: c.text, mediaId: c.videoId });
  if (!rule) return;
  const ev = { ruleId: rule.id, platform: 'youtube' as const, userId: c.userId, username: c.username, ref: c.id };
  if (await recentlyTriggered(env, rule.id, c.userId)) {
    await logEvent(env, { ...ev, type: 'skipped_repeat' });
    return;
  }
  await logEvent(env, { ...ev, type: 'triggered', detail: c.text });
  const reply = pick(rule.public_replies);
  if (!reply) return;
  try {
    await api(env, 'comments', { part: 'snippet' }, { snippet: { parentId: c.threadId, textOriginal: fill(reply, { username: c.username }) } });
    await logEvent(env, { ...ev, type: 'public_reply' });
  } catch (err) {
    await logEvent(env, { ...ev, type: 'error', detail: `reply: ${errorMessage(err)}` });
  }
}
