import { candidatesFor } from './burst-order';
import type { BurstSequence } from './burst-order';
import type { BattleSettings, CharacterMeta, CharacterOverrides, SettingsCatalog } from './types';

export interface SquadCandidate { squad: string[]; noBurst?: string[]; burstSequence?: BurstSequence; cycle?: Pick<BattleSettings, 'burstReaction' | 'burstRegenTime'> }
export interface ScoredCandidate extends SquadCandidate { damage: number }

/** Exploration preference only; actual elemental damage stays in calculator/damage.py. */
export function preferredElement(enemy: string = ''): string {
  return ({ '전격': '철갑', '수냉': '전격', '작열': '수냉', '풍압': '작열', '철갑': '풍압' } as Record<string, string>)[enemy] ?? '';
}

/** Missing rarity is not an SSR. Never fill an unowned character with defaults. */
export function ownedSSR(catalog: CharacterMeta[], settings: SettingsCatalog, roster: Record<string, CharacterOverrides>, excluded: string[] = []): CharacterMeta[] {
  return catalog.filter(char => !char.preview && Object.hasOwn(roster, char.name)
    && settings.characters[char.name]?.rarity?.toUpperCase() === 'SSR' && !excluded.includes(char.name));
}

/** Stage coverage is only a structural gate, not a claim about cooldown continuity. */
export function hasBurstChain(candidate: SquadCandidate, catalog: CharacterMeta[]): boolean {
  if (candidate.squad.length !== 5 || new Set(candidate.squad).size !== 5) return false;
  const source = { squad: candidate.squad, skipped: new Set(candidate.noBurst), metaOf: (name: string) => catalog.find(c => c.name === name) };
  const choices = ['1', '2', '3'].map(stage => candidatesFor(stage as '1' | '2' | '3', source));
  // Conservative default: don't assume one all-stage character can cast all three in succession.
  return choices[0]!.some(a => choices[1]!.some(b => a !== b && choices[2]!.some(c => c !== a && c !== b)));
}

export const candidateKey = (candidate: SquadCandidate): string => JSON.stringify([
  candidate.squad, [...(candidate.noBurst ?? [])].sort(), candidate.burstSequence ?? null, candidate.cycle ?? null,
]);

/** Bounded, reproducible exploration + simulated-score-guided local replacement.
 * Every owned SSR stays eligible; no popularity blacklist or fabricated damage score.
 * Cooldowns, buffs and equipment interactions are evaluated by the real simulator.
 */
export async function searchSquads(options: {
  pool: CharacterMeta[]; seeds: SquadCandidate[]; budget: number; element?: string;
  evaluate: (candidate: SquadCandidate) => Promise<number>;
  stopped: () => boolean;
  progress: (done: number, failures: number, best: ScoredCandidate[]) => void;
}): Promise<ScoredCandidate[]> {
  const { pool } = options;
  if (pool.length < 5) return [];
  const names = new Set(pool.map(c => c.name));
  const valid = (c: SquadCandidate) => c.squad.every(n => names.has(n)) && hasBurstChain(c, pool);
  const queue = options.seeds.filter(valid).map(c => structuredClone(c));
  const seen = new Set<string>();
  const scored: ScoredCandidate[] = [];
  let state = 1729, failures = 0, done = 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const pick = <T>(items: T[]): T | undefined => items[Math.floor(random() * items.length)];
  const stages = ['1', '2', '3'].map(stage => pool.filter(c => c.burstStage === stage || c.burstStage.toUpperCase() === 'A'));
  if (stages.some(s => !s.length)) return [];
  const budget = Math.max(1, Math.min(1000, Math.floor(options.budget) || 1));
  for (let attempt = 0; done < budget && attempt < budget * 50 && !options.stopped(); attempt++) {
    let candidate = queue.shift();
    if (!candidate) {
      if (scored.length && attempt % 2 === 0) {
        // Keep non-overlapping alternatives in the breeding pool, not just one dominant core.
        const leaders = [...scored].sort((a, b) => b.damage - a.damage);
        const diverse = leaders.slice(0, 8);
        const used = new Set(leaders[0]!.squad);
        for (const row of leaders) if (row.squad.every(n => !used.has(n))) {
          diverse.push(row); row.squad.forEach(n => used.add(n));
        }
        const parent = pick(diverse)!;
        candidate = { squad: [...parent.squad], noBurst: [...(parent.noBurst ?? [])], cycle: parent.cycle };
        if (attempt % 6 === 0) {
          const a = Math.floor(random() * 5), b = Math.floor(random() * 5);
          [candidate.squad[a], candidate.squad[b]] = [candidate.squad[b]!, candidate.squad[a]!];
        } else if (attempt % 6 === 2) {
          const name = pick(candidate.squad)!;
          candidate.noBurst = candidate.noBurst!.includes(name) ? candidate.noBurst!.filter(n => n !== name) : [...candidate.noBurst!, name];
        } else {
          candidate.squad[Math.floor(random() * 5)] = pick(pool)!.name;
          candidate.noBurst = candidate.noBurst!.filter(n => candidate!.squad.includes(n));
        }
      } else {
        const squad: string[] = [];
        for (const stage of stages) {
          const name = pick(stage.filter(c => !squad.includes(c.name)))?.name;
          if (name) squad.push(name);
        }
        // Rotate an anchor through the complete pool; mix elemental preference with broad exploration.
        const anchor = pool[Math.floor(attempt / 2) % pool.length]!.name;
        if (!squad.includes(anchor) && squad.length < 5) squad.push(anchor);
        while (squad.length < 5) {
          const available = pool.filter(c => !squad.includes(c.name));
          const elemental = available.filter(c => c.elementCode === preferredElement(options.element));
          squad.push(pick(random() < 0.5 && elemental.length ? elemental : available)!.name);
        }
        candidate = { squad };
      }
    }
    if (!valid(candidate) || seen.has(candidateKey(candidate))) continue;
    seen.add(candidateKey(candidate));
    try {
      const damage = await options.evaluate(candidate);
      if (!Number.isFinite(damage) || damage < 0) throw new Error('Invalid simulation damage');
      scored.push({ ...candidate, damage });
    } catch { failures++; }
    done++;
    options.progress(done, failures, scored);
    // Let cancel and input events run even when evaluation hits a synchronous cache.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return scored;
}
