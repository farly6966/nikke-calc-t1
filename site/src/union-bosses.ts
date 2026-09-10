import type { BattleSettings, BossPhase, ElementCode } from './types';
import { decodeBattleCode } from './share-code';
import recommendation from './data/union-s44-recommendation.json';
import { DEFAULT_SYNCHRO_LEVEL } from './model';

/** 회차의 식별 정보. 전투 조건은 아래의 고정된 추천 자료에서 읽는다. */
export interface UnionBossPreset {
  id: string;
  name: string;
  art: string;
  enemyCode: ElementCode;
  weakness: ElementCode;
}

// 출처와 갱신 절차: docs/union-boss-catalog.md.
// 공지의 약점과 엔진에 넘기는 적 코드를 혼동하지 않는다.
export const UNION_BOSS_SEASONS = [{
  id: 's44',
  label: 'S44 · 2026-09-04',
  bosses: [
    { id: 's44-laitance', name: '레이턴스 [Z.E.U.S.]', art: 'bcg002',
      enemyCode: '전격', weakness: '철갑' },
    { id: 's44-tombstone', name: '툼스톤 [H.S.T.A.]', art: 'tombstone',
      enemyCode: '작열', weakness: '수냉' },
    { id: 's44-modernia', name: '모더니아 [A.N.M.I.]', art: 'mbg004_anmi',
      enemyCode: '풍압', weakness: '작열' },
    { id: 's44-stout', name: '리빌드 빅 토르소 [P.S.I.D.]', art: 'ecg005_re',
      enemyCode: '수냉', weakness: '전격' },
    { id: 's44-annihilio', name: '애니힐리오 [D.M.T.R.]', art: 'annihilio',
      enemyCode: '철갑', weakness: '풍압' },
  ] satisfies UnionBossPreset[],
}];

export function unionBossPreset(id: unknown): UnionBossPreset | undefined {
  return UNION_BOSS_SEASONS.flatMap(season => season.bosses).find(boss => boss.id === id);
}

export function unionBossArt(preset: UnionBossPreset): string {
  return `${import.meta.env.BASE_URL}bosses/${preset.art}.webp`;
}

export function bossWeakness(code: ElementCode): ElementCode {
  return ({ 전격: '철갑', 작열: '수냉', 풍압: '작열', 수냉: '전격', 철갑: '풍압', '': '' } as const)[code];
}

/** 검토해 고정한 회차 추천값. 실행 중 외부 서버 값이 바뀌어도 계산 조건은 바뀌지 않는다. */
export function recommendedUnionBattle(preset: UnionBossPreset): BattleSettings {
  const source = recommendation.cfg.bosses[preset.enemyCode as keyof typeof recommendation.cfg.bosses];
  return {
    ...decodeBattleCode('NK3-e30'),
    synchroLevel: DEFAULT_SYNCHRO_LEVEL,
    console: { common_level: 0, class_level: {}, company_level: {} },
    duration: recommendation.cfg.duration,
    enemyCode: preset.enemyCode,
    enemyDef: source.def,
    coreEnabled: source.core_px > 0,
    corePx: source.core_px,
    hasParts: source.has_parts,
    optimalRangeWeapons: [...source.optimal_range_weapons],
    normalHitCoeff: { ...source.weapon_coeff },
    // 원본은 단계 사이의 간격만 둔다. 우리 엔진의 누르는 반응 시간을 더하지 않는다.
    burstSwitchDelay: source.burst_switch_delay,
    burstReaction: 0,
    immuneBlocksBurst: false,
    bossPhases: source.phases.map(w => ({ kind: w.kind as BossPhase['kind'], from: w.t0, to: w.t1 })),
  };
}
