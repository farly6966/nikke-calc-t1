import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UNION_BOSS_SEASONS, bossWeakness, recommendedUnionBattle, unionBossArt } from './union-bosses';
import { decodeBattleCode, encodeBattleCode } from './share-code';
import { decodeUnionDraft, encodeUnionDraft, readBossCode, readUnionCode, unionCodeOf } from './union-raid';
import { requestForDeck } from './model';
import { setLang, t } from './i18n';
import source from './data/union-s44-recommendation.json';

afterEach(() => setLang('ko'));
describe('union boss catalogue', () => {
  it('maps official weaknesses to enemy codes and ships all images', () => {
    const bosses = UNION_BOSS_SEASONS[0]!.bosses;
    expect(bosses.map(b => b.weakness)).toEqual(['철갑', '수냉', '작열', '전격', '풍압']);
    for (const boss of bosses) {
      expect(bossWeakness(boss.enemyCode)).toBe(boss.weakness);
      const path = fileURLToPath(new URL(`../public/bosses/${boss.art}.webp`, import.meta.url));
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path).subarray(8, 12).toString()).toBe('WEBP');
      expect(unionBossArt(boss)).toContain('/bosses/');
    }
  });
  it('preserves every recommended phase including duplicate parts through request and share', () => {
    for (const preset of UNION_BOSS_SEASONS[0]!.bosses) {
      const battle = recommendedUnionBattle(preset);
      const raw = source.cfg.bosses[preset.enemyCode];
      const phases = raw.phases.map(w => ({ kind: w.kind, from: w.t0, to: w.t1 }));
      expect(battle.bossPhases).toEqual(phases);
      // 이 회차가 쓰는 타이밍은 엔진 기본값과 같다.
      expect([raw.first_burst_time, raw.burst_reenter_delay, raw.max_burst_count]).toEqual([3, .5, 0]);
      const code = encodeBattleCode(battle);
      const decoded = decodeBattleCode(code);
      expect(decoded.bossPhases ?? []).toEqual(phases);
      const slot = readBossCode({ bossId: preset.id, name: preset.name, code, enabled: true, decks: [] });
      const shared = readUnionCode(unionCodeOf([slot]), [])[0]!;
      expect(shared.bossId).toBe(preset.id);
      expect(shared.battle?.bossPhases ?? []).toEqual(phases);
      const draft = Array.from({ length: 6 }, () => slot);
      expect(decodeUnionDraft(encodeUnionDraft(draft), [])[0]!.bossId).toBe(preset.id);
      const request = requestForDeck({ id: 1, squad: [], characters: {} }, shared.battle!);
      expect(request.bossPhases ?? []).toHaveLength(phases.length);
      expect(request.enemyCode).toBe(preset.enemyCode);
      expect(request.corePx).toBe(raw.core_px);
      expect(request.normalHitCoeff?.MG ?? 1).toBe(raw.weapon_coeff.MG);
      expect(request.burstReaction).toBe(0);
      expect(request.burstSwitchDelay ?? 0.1).toBe(raw.burst_switch_delay);
    }
  });
  it('keeps reaction time separate from stage switching through sharing and requests', () => {
    const battle = recommendedUnionBattle(UNION_BOSS_SEASONS[0]!.bosses[0]!);
    battle.burstSwitchDelay = 0.35;
    const shared = { ...battle, ...decodeBattleCode(encodeBattleCode(battle)) };
    const request = requestForDeck({ id: 1, squad: [], characters: {} }, shared);
    expect(request.burstSwitchDelay).toBe(0.35);
    expect(request.burstReaction).toBe(0);
    expect(decodeBattleCode('NK3-e30').burstReaction).toBe(0.05);
  });
  it('uses the fork dictionary for names and interpolated labels in all languages', () => {
    for (const lang of ['zh-TW', 'en', 'ja'] as const) {
      setLang(lang);
      for (const boss of UNION_BOSS_SEASONS[0]!.bosses) expect(t(boss.name)).not.toMatch(/[가-힣]/);
      expect(t('약점: {code}', { code: t('철갑') })).not.toMatch(/[가-힣]/);
      expect(t('최고 피해 {damage} · {n}개 결과', { damage: '123', n: 2 })).not.toMatch(/[가-힣]/);
    }
  });
});
