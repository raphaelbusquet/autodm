import type { Platform, Rule, Trigger } from './types';

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Whole-word match so "link" does not fire on "linkedin". Empty keyword list matches anything. */
export function textMatches(rule: Pick<Rule, 'keywords' | 'match_mode'>, text: string): boolean {
  const keywords = rule.keywords.map(normalize).filter(Boolean);
  if (keywords.length === 0) return true;
  const norm = normalize(text);
  if (rule.match_mode === 'exact') return keywords.includes(norm);
  const padded = ` ${norm} `;
  return keywords.some((kw) => padded.includes(` ${kw} `));
}

/** Most specific rule wins: higher priority, then post-scoped over global, then oldest. */
export function findRule(
  rules: Rule[],
  input: { platform: Platform; trigger: Trigger; text: string; mediaId?: string },
): Rule | undefined {
  return rules
    .filter(
      (r) =>
        r.active &&
        r.platform === input.platform &&
        r.trigger === input.trigger &&
        (r.media_ids.length === 0 || (input.mediaId !== undefined && r.media_ids.includes(input.mediaId))),
    )
    .sort((a, b) => b.priority - a.priority || b.media_ids.length - a.media_ids.length || a.id - b.id)
    .find((r) => textMatches(r, input.text));
}

/** Whole handle with a capital first letter: "m.alvos" → "M.alvos", "coincubo" → "Coincubo". */
export function nameFromUsername(username: string): string {
  const handle = username.replace(/^@/, '');
  return handle ? handle[0].toUpperCase() + handle.slice(1) : '';
}

/**
 * {username} → handle. {nome} → real first name when Meta has released it (after the person's first
 * tap/DM), otherwise a name derived from the handle.
 */
export function fill(template: string, vars: { username?: string; name?: string }): string {
  const username = vars.username ?? '';
  const first = vars.name?.trim().split(/\s+/)[0] || nameFromUsername(username);
  return template.replaceAll('{username}', username).replaceAll('{nome}', first);
}

export function pick<T>(items: T[]): T | undefined {
  return items.length ? items[Math.floor(Math.random() * items.length)] : undefined;
}
