import { describe, expect, it } from 'vitest';
import { fill, findRule, nameFromUsername, textMatches } from '../src/match';
import type { Rule } from '../src/types';

const base: Rule = {
  id: 1, name: 'r', platform: 'instagram', trigger: 'comment', media_ids: [], keywords: ['link'],
  match_mode: 'contains', public_replies: [], dm_text: 'x', button_label: '', require_follow: false,
  not_following_text: '', follow_button_label: '', still_not_following_text: '', link_text: '', wait_text: '', link_delay_minutes: 0, link_url: '', link_button_label: '', active: true, priority: 0,
};

describe('textMatches', () => {
  it('matches whole words, case and accent insensitive', () => {
    expect(textMatches(base, 'Quero o LINK!!')).toBe(true);
    expect(textMatches({ ...base, keywords: ['eu quero'] }, 'EU QUÉRO 🙏')).toBe(true);
    expect(textMatches(base, 'meu linkedin')).toBe(false);
  });
  it('exact mode requires the whole comment', () => {
    const r = { ...base, match_mode: 'exact' as const };
    expect(textMatches(r, ' Link! ')).toBe(true);
    expect(textMatches(r, 'me manda o link')).toBe(false);
  });
  it('empty keywords match anything', () => {
    expect(textMatches({ ...base, keywords: [] }, 'qualquer coisa')).toBe(true);
  });
});

describe('findRule', () => {
  const global = { ...base, id: 1 };
  const scoped = { ...base, id: 2, media_ids: ['m1'] };
  const paused = { ...base, id: 3, priority: 10, active: false };
  const input = { platform: 'instagram' as const, trigger: 'comment' as const, text: 'link' };

  it('prefers post-scoped rule over global', () => {
    expect(findRule([global, scoped, paused], { ...input, mediaId: 'm1' })?.id).toBe(2);
    expect(findRule([global, scoped, paused], { ...input, mediaId: 'm2' })?.id).toBe(1);
  });
  it('respects priority, platform and trigger', () => {
    const high = { ...base, id: 4, priority: 5 };
    expect(findRule([global, high], input)?.id).toBe(4);
    expect(findRule([global], { ...input, trigger: 'dm' })).toBeUndefined();
    expect(findRule([global], { ...input, platform: 'youtube' })).toBeUndefined();
  });
});

describe('fill', () => {
  it('derives a first name from the handle when the real name is unknown', () => {
    expect(nameFromUsername('m.alvos')).toBe('M.alvos');
    expect(nameFromUsername('coincubo')).toBe('Coincubo');
    expect(fill('Boa, {nome}! @{username}', { username: 'coincubo' })).toBe('Boa, Coincubo! @coincubo');
  });
  it('prefers the real first name', () => {
    expect(fill('Opa, {nome}!', { username: 'rb', name: 'Raphael Busquet' })).toBe('Opa, Raphael!');
  });
});
