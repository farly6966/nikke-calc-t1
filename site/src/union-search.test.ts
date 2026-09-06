import { describe, expect, it, vi } from 'vitest';
import { ownedSSR, hasBurstChain, searchSquads, candidateKey, preferredElement, type SquadCandidate } from './union-search';
import type { CharacterMeta, SettingsCatalog } from './types';

const pool = Array.from({ length: 20 }, (_, i) => ({ name: `unit${i}`, burstStage: String(i % 3 + 1), elementCode: i % 2 ? '水' : '火' } as CharacterMeta));
const seed = { squad: pool.slice(0, 5).map(c => c.name) };

describe('SSR automatic squad search', () => {
  it('prefers the counter element, not the boss own element', () => {
    expect(preferredElement('작열')).toBe('수냉');
    expect(preferredElement('')).toBe('');
  });
  it('requires owned supported SSR, excludes previews, SR, unknown rarity and user exclusions', () => {
    const settings = { characters: Object.fromEntries(pool.map((c, i) => [c.name, { rarity: i === 1 ? 'SR' : 'SSR' }])) } as SettingsCatalog;
    const roster = Object.fromEntries(pool.slice(0, 8).map(c => [c.name, {}]));
    const catalog = pool.map(c => ({ ...c })); catalog[2]!.preview = true;
    delete settings.characters.unit3;
    expect(ownedSSR(catalog, settings, roster, ['unit4']).map(c => c.name)).toEqual(['unit0', 'unit5', 'unit6', 'unit7']);
  });
  it('validates five distinct members and stage coverage, respecting no-burst', () => {
    expect(hasBurstChain(seed, pool)).toBe(true);
    expect(hasBurstChain({ ...seed, noBurst: ['unit2'] }, pool)).toBe(false);
    expect(hasBurstChain({ squad: ['unit0', 'unit0', 'unit1', 'unit2', 'unit3'] }, pool)).toBe(false);
    expect(hasBurstChain({ squad: seed.squad.slice(0, 4) }, pool)).toBe(false);
  });
  it('tests seeds first, obeys budget, deduplicates and never invents roster members', async () => {
    const tested: SquadCandidate[] = [];
    const seeds = [{ ...seed, noBurst: ['unit3'], cycle: { burstReaction: 0.1, burstRegenTime: 2 } }];
    const before = JSON.stringify(seeds);
    const result = await searchSquads({ pool, seeds, budget: 30, stopped: () => false, progress: () => {},
      evaluate: async candidate => { tested.push(candidate); return tested.length; } });
    expect(result).toHaveLength(30); expect(tested[0]).toEqual(seeds[0]);
    expect(new Set(tested.map(candidateKey)).size).toBe(30);
    expect(tested.every(c => hasBurstChain(c, pool) && c.squad.every(n => pool.some(p => p.name === n)))).toBe(true);
    expect(JSON.stringify(seeds)).toBe(before);
  });
  it('stops after the active evaluation, retaining successes and counting errors', async () => {
    let done = 0;
    const progress = vi.fn();
    const result = await searchSquads({ pool, seeds: [seed], budget: 30, stopped: () => done >= 3, progress,
      evaluate: async () => { done++; if (done === 2) throw new Error('failure'); return 10; } });
    expect(result).toHaveLength(2); expect(progress.mock.lastCall?.slice(0, 2)).toEqual([3, 1]);
  });
  it('terminates impossible pools without simulations', async () => {
    const evaluate = vi.fn();
    await searchSquads({ pool: pool.map(c => ({ ...c, burstStage: '1' })), seeds: [], budget: 30, stopped: () => false, progress: () => {}, evaluate });
    expect(evaluate).not.toHaveBeenCalled();
  });
});
