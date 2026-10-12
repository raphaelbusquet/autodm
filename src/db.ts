import type { Env, Platform, Rule } from './types';

const JSON_FIELDS = ['media_ids', 'keywords', 'public_replies'] as const;
const BOOL_FIELDS = ['require_follow', 'active'] as const;

function rowToRule(row: Record<string, unknown>): Rule {
  const r: Record<string, unknown> = { ...row };
  for (const f of JSON_FIELDS) r[f] = JSON.parse(String(row[f] ?? '[]'));
  for (const f of BOOL_FIELDS) r[f] = Boolean(row[f]);
  return r as unknown as Rule;
}

export async function listRules(env: Env): Promise<Rule[]> {
  const { results } = await env.DB.prepare('SELECT * FROM rules ORDER BY id').all();
  return results.map(rowToRule);
}

export async function getRule(env: Env, id: number): Promise<Rule | undefined> {
  const row = await env.DB.prepare('SELECT * FROM rules WHERE id = ?').bind(id).first();
  return row ? rowToRule(row) : undefined;
}

const EDITABLE = [
  'name', 'platform', 'trigger', 'media_ids', 'keywords', 'match_mode', 'public_replies',
  'dm_text', 'button_label', 'require_follow', 'not_following_text', 'follow_button_label',
  'still_not_following_text', 'link_text', 'wait_text', 'link_delay_minutes',
  'link_url', 'link_button_label', 'active', 'priority',
] as const;

function ruleValues(input: Partial<Rule>): unknown[] {
  return EDITABLE.map((f) => {
    const v = input[f as keyof Rule];
    if ((JSON_FIELDS as readonly string[]).includes(f)) return JSON.stringify(v ?? []);
    if ((BOOL_FIELDS as readonly string[]).includes(f)) return v ? 1 : 0;
    return v ?? (f === 'priority' || f === 'link_delay_minutes' ? 0 : '');
  });
}

export async function saveRule(env: Env, input: Partial<Rule>, id?: number): Promise<number> {
  const values = ruleValues(input);
  if (id) {
    const sets = EDITABLE.map((f) => `${f} = ?`).join(', ');
    await env.DB.prepare(`UPDATE rules SET ${sets}, updated_at = unixepoch() WHERE id = ?`).bind(...values, id).run();
    return id;
  }
  const res = await env.DB.prepare(
    `INSERT INTO rules (${EDITABLE.join(', ')}) VALUES (${EDITABLE.map(() => '?').join(', ')})`,
  ).bind(...values).run();
  return Number(res.meta.last_row_id);
}

export async function deleteRule(env: Env, id: number): Promise<void> {
  await env.DB.prepare('DELETE FROM rules WHERE id = ?').bind(id).run();
}

export async function getSetting(env: Env, key: string): Promise<string | undefined> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value;
}

export async function setSettings(env: Env, values: Record<string, string>): Promise<void> {
  const stmt = env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  await env.DB.batch(Object.entries(values).map(([k, v]) => stmt.bind(k, v)));
}

export async function deleteSettings(env: Env, prefix: string): Promise<void> {
  await env.DB.prepare('DELETE FROM settings WHERE key LIKE ?').bind(`${prefix}%`).run();
}

/** Returns true the first time an id is seen. Guards against webhook retries and poll overlap. */
export async function claim(env: Env, id: string): Promise<boolean> {
  const res = await env.DB.prepare('INSERT OR IGNORE INTO processed (id) VALUES (?)').bind(id).run();
  return res.meta.changes > 0;
}

export async function touchContact(env: Env, platform: Platform, userId: string, username = ''): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO contacts (platform, user_id, username) VALUES (?, ?, ?)
     ON CONFLICT(platform, user_id) DO UPDATE SET last_seen = unixepoch(),
       username = CASE WHEN excluded.username != '' THEN excluded.username ELSE contacts.username END`,
  ).bind(platform, userId, username).run();
}

export interface EventInput {
  ruleId?: number | null;
  platform: Platform;
  type: string;
  userId?: string;
  username?: string;
  ref?: string;
  detail?: string;
}

export async function logEvent(env: Env, e: EventInput): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO events (rule_id, platform, type, user_id, username, ref, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(e.ruleId ?? null, e.platform, e.type, e.userId ?? '', e.username ?? '', e.ref ?? '', (e.detail ?? '').slice(0, 1000)).run();
}

/** Anti-spam: one successful automation run per user per rule per 24h (failed sends can retry). */
export async function recentlyTriggered(env: Env, ruleId: number, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM events WHERE rule_id = ? AND user_id = ? AND type IN ('dm_sent', 'dm_queued', 'public_reply')
     AND created_at > unixepoch() - 86400 LIMIT 1`,
  ).bind(ruleId, userId).first();
  return row !== null;
}

export async function cleanup(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM processed WHERE created_at < unixepoch() - 30 * 86400'),
    env.DB.prepare('DELETE FROM pending_sends WHERE expires_at > 0 AND expires_at < unixepoch() - 86400'),
    env.DB.prepare('DELETE FROM events WHERE created_at < unixepoch() - 180 * 86400'),
  ]);
}
