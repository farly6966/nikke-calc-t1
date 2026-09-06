import { describe, expect, it } from 'vitest';
import { bestThreeShots } from './union-planning';
import type { JobResult } from './union-raid';

const row = (id: string, damage: number, shared?: string): JobResult => ({
  job: { member: { openid: 'same' }, squad: [shared ?? `${id}0`, ...[1, 2, 3, 4].map(n => `${id}${n}`)] },
  damage,
} as JobResult);

describe('exact best-three-shot search', () => {
  it('beats greedy top-damage selection and never reuses a character', () => {
    const a = row('a', 100); a.job.squad = ['b0', 'c0', 'd0', 'x', 'y'];
    const others = [row('b', 60), row('c', 60), row('d', 60)];
    expect(bestThreeShots([a, ...others])).toEqual(others);
  });
  it('selects at most three, breaks ties deterministically, and supports fewer', () => {
    const rows = [row('a', 10), row('b', 10), row('c', 10), row('d', 10)];
    expect(bestThreeShots(rows)).toEqual(rows.slice(0, 3));
    expect(bestThreeShots([rows[0]!])).toEqual([rows[0]!]);
    expect(bestThreeShots([])).toEqual([]);
  });
  it('rejects mixed accounts and ignores invalid, incomplete and failed candidates', () => {
    const invalid = [row('a', NaN), row('b', Infinity), row('c', -1),
      { ...row('d', 100), error: 'failed' }, { ...row('e', 100), missing: ['missing'] }];
    const short = row('f', 100); short.job.squad.pop();
    const duplicate = row('g', 100); duplicate.job.squad[1] = duplicate.job.squad[0]!;
    expect(bestThreeShots([...invalid, short, duplicate])).toEqual([]);
    const other = row('z', 2); other.job.member.openid = 'other';
    expect(() => bestThreeShots([row('a', 1), other])).toThrow(/同一個帳號/);
  });
  it('matches an exhaustive subset oracle on deterministic overlapping inputs', () => {
    for (let trial = 0; trial < 12; trial++) {
      const rows = Array.from({ length: 9 }, (_, i) => row(String(i), (i * 17 + trial * 11) % 101, `shared${(i + trial) % 4}`));
      let expected = 0;
      for (let mask = 0; mask < 1 << rows.length; mask++) {
        const picked = rows.filter((_, i) => mask & (1 << i));
        const names = picked.flatMap(item => item.job.squad);
        if (picked.length > 3 || new Set(names).size !== names.length) continue;
        expected = Math.max(expected, picked.reduce((sum, item) => sum + item.damage!, 0));
      }
      expect(bestThreeShots(rows).reduce((sum, item) => sum + item.damage!, 0)).toBe(expected);
    }
  });
});
