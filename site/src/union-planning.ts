import type { JobResult } from './union-raid';

/** Exact search over one account's completed, full five-character candidates. */
export function bestThreeShots(rows: JobResult[]): JobResult[] {
  if (new Set(rows.map(row => row.job.member.openid)).size > 1) {
    throw new Error('最佳三刀必須使用同一個帳號的結果。');
  }
  const valid = rows.filter(row => {
    const names = row.job.squad.filter(Boolean);
    return row.damage !== undefined && Number.isFinite(row.damage) && row.damage >= 0
      && !row.error && !row.missing && names.length === 5 && new Set(names).size === 5;
  });
  // For the same five characters only the highest score can improve this objective.
  const unique = new Map<string, JobResult>();
  for (const row of valid) {
    const key = JSON.stringify([...row.job.squad].sort());
    if (!unique.has(key) || row.damage! > unique.get(key)!.damage!) unique.set(key, row);
  }
  const candidates = [...unique.values()].sort((a, b) => b.damage! - a.damage!);
  let best: JobResult[] = [];
  let bestDamage = 0;
  const visit = (start: number, chosen: JobResult[], used: Set<string>, damage: number): void => {
    if (damage > bestDamage || (damage === bestDamage && chosen.length > best.length)) {
      best = [...chosen]; bestDamage = damage;
    }
    if (chosen.length === 3) return;
    for (let i = start; i < candidates.length; i++) {
      const upper = damage + candidates.slice(i, i + 3 - chosen.length).reduce((sum, row) => sum + row.damage!, 0);
      if (upper < bestDamage) break;
      const row = candidates[i]!;
      if (row.job.squad.some(name => used.has(name))) continue;
      visit(i + 1, [...chosen, row], new Set([...used, ...row.job.squad]), damage + row.damage!);
    }
  };
  visit(0, [], new Set(), 0);
  return best;
}
