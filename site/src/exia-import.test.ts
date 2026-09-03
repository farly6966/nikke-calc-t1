import { describe, expect, it } from 'vitest';
import { parseExiaBatch, parseExiaProfile, stripExiaProfile } from './exia-import';
import { areaToOverrides, consoleFrom, synchroFrom } from './blablalink';
import type { CharacterMeta, SettingsCatalog } from './types';

const catalog: CharacterMeta[] = [
  {
    name: '라피', burstStage: '1', elementCode: '작열', weaponType: 'AR',
    className: '화력형', manufacturer: '엘리시온', preview: false, image: null,
    nameCode: 5001, resourceId: null, aliases: [],
  },
  {
    name: '앨리스', burstStage: '3', elementCode: '수냉', weaponType: 'SR',
    className: '화력형', manufacturer: '필그림', preview: false, image: null,
    nameCode: 5002, resourceId: null, aliases: [],
  },
];

const settings = {
  characters: {
    라피: { maxGrowthStage: 11, skillLevelsLocked: false },
    앨리스: { maxGrowthStage: 11, skillLevelsLocked: false },
  },
  cubes: {
    '택티컬 베어 큐브': { id: 1000304 },
    '렐릭 어설트 큐브': { id: 1000301 },
  },
  overloadFields: {
    element_bonus: {}, atk_pct: {}, max_ammo_pct: {}, charge_speed_pct: {},
    charge_dmg_pct: {}, accuracy_pct: {}, crit_rate: {}, crit_dmg: {}, def_pct: {},
  },
  favoriteItems: { '100601': 'R', '100602': 'SR', '200101': 'SSR' },
} as unknown as SettingsCatalog;

/** 새 형식의 부위 한 칸. 옵션은 «줄의 배열»의 배열로 온다(한 칸에 한 줄). */
const slot = (tier: number, lv: number, lines: Array<[string, number]>) => ({
  tier, lv,
  options: lines.map(([function_type, function_value]) => [{ function_type, function_value }]),
});

/** 새 형식 匯出檔 한 벌. 필요한 것만 덮어 쓴다. */
function exportFile(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'NOIR',
    game_uid: '4344331436314217',
    cookie: 'game_token=deadbeef; game_uid=4344331436314217',
    synchroLevel: 787,
    area_id: '81',
    recycleRoomResearches: {
      '1001': { Level: 366, Exp: 0 },
      '1101': { Level: 145, Exp: 0 },
      '1204': { Level: 162, Exp: 0 },
    },
    elements: {
      Fire: [{
        name_code: 5001,
        name_en: 'Rapi',
        lv: 787,
        limit_break: { grade: 3, core: 7 },
        skill1_level: 10, skill2_level: 9, skill_burst_level: 8,
        item_rare: 'SR', item_level: 15,
        cube_id: 1000304, cube_level: 15,
        equipments: {
          head: slot(10, 5, [['StatCritical', 6.73], ['StatAtk', 12.52]]),
          torso: slot(10, 3, [['IncElementDmg', 29.16]]),
          arm: slot(9, 0, []),
          leg: slot(0, 0, []),
        },
        attractive_lv: 20,
      }],
      Water: [{
        name_code: 5002,
        name_en: 'Alice',
        lv: 1,
        limit_break: { grade: 0, core: 0 },
        skill1_level: 1, skill2_level: 1, skill_burst_level: 1,
        item_rare: '', item_level: 0,
        equipments: {
          head: slot(0, 0, []), torso: slot(0, 0, []),
          arm: slot(0, 0, []), leg: slot(0, 0, []),
        },
      }],
      Utility: [],
    },
    ...over,
  };
}

const overridesOf = (file: Record<string, unknown>) =>
  areaToOverrides(parseExiaProfile(file, settings).raw, settings, catalog).overrides;

describe('parseExiaProfile — 새 형식', () => {
  it('계정 정보를 그대로 읽는다', () => {
    const profile = parseExiaProfile(exportFile(), settings);
    expect(profile.name).toBe('NOIR');
    expect(profile.synchro).toBe(787);
    expect(profile.area).toBe(81);
    expect(profile.owned).toBe(2);
  });

  it('싱크로와 콘솔이 기존 경로로 그대로 흘러간다', () => {
    const { raw } = parseExiaProfile(exportFile(), settings);
    expect(synchroFrom(raw)).toBe(787);
    const levels = consoleFrom(raw);
    expect(levels?.common_level).toBe(366);
    expect(levels?.class_level['화력형']).toBe(145);
    expect(levels?.company_level['필그림']).toBe(162);
    // 응답에 없는 소속은 «안 올렸다»는 뜻으로 0이 채워져야 한다 — 빠진 채로 두면 엔진이 끊는다.
    expect(levels?.company_level['엘리시온']).toBe(0);
  });

  it('오버로드가 퍼센트 그대로 합산된다', () => {
    const rapi = overridesOf(exportFile()).라피!;
    // 匯出檔은 12.52(%)를 그대로 준다. blablalink는 1252로 주고 /100 되므로,
    // 어느 길로 와도 계산기에는 같은 숫자가 떨어져야 한다.
    expect(rapi.overload?.atk_pct).toBeCloseTo(12.52, 4);
    expect(rapi.overload?.crit_rate).toBeCloseTo(6.73, 4);
    expect(rapi.overload?.element_bonus).toBeCloseTo(29.16, 4);
    expect(rapi.overload?.max_ammo_pct).toBe(0);
  });

  it('같은 효과·같은 수치가 여러 캐릭터에 있어도 한 옵션으로 모인다', () => {
    const file = exportFile();
    const water = (file.elements as any).Water[0];
    water.equipments.head = slot(10, 5, [['StatAtk', 12.52]]);
    const { raw } = parseExiaProfile(file, settings);
    // 라피의 StatAtk 12.52와 같은 줄이므로 새 id가 생기지 않는다.
    const atkIds = raw.stateEffects.filter(
      (e) => e.function_details?.[0]?.function_type === 'StatAtk');
    expect(atkIds).toHaveLength(1);
    expect(overridesOf(file).앨리스!.overload?.atk_pct).toBeCloseTo(12.52, 4);
  });

  it('장비 등급을 부위마다 구분한다', () => {
    const rapi = overridesOf(exportFile()).라피!;
    expect(rapi.equipLevels?.['머리']).toBe(5);      // 기업 장비 강화 5
    expect(rapi.equipLevels?.['몸통']).toBe(3);
    expect(rapi.equipLevels?.['팔']).toBe('T9');     // 일반 장비
    expect(rapi.equipLevels?.['다리']).toBe('없음'); // 미장착
  });

  it('큐브·소장품·돌파·스킬을 옮긴다', () => {
    const rapi = overridesOf(exportFile()).라피!;
    expect(rapi.cube).toEqual({ name: '택티컬 베어 큐브', level: 15 });
    expect(rapi.collection).toEqual({ stage: 'SR15', favorite: 0 });
    expect(rapi.growthStage).toBe(10);               // 돌파 3 + 코어 7
    expect(rapi.skillLevels).toEqual({ '1': 10, '2': 9, '3': 8 });
  });

  it('애장품은 SR15 스탯에 단계만 따로 넘어간다', () => {
    const file = exportFile();
    (file.elements as any).Fire[0].item_rare = 'SSR';
    (file.elements as any).Fire[0].item_level = 2;
    expect(overridesOf(file).라피!.collection).toEqual({ stage: 'SR15', favorite: 3 });
  });

  it('소장품이 없으면 «없음»으로 둔다 — 기본값이 남으면 과대평가된다', () => {
    expect(overridesOf(exportFile()).앨리스!.collection).toEqual({ stage: '없음', favorite: 0 });
  });

  it('큐브를 안 낀 사람은 한 줄로 알린다', () => {
    expect(parseExiaProfile(exportFile(), settings).notes.join()).toContain('魔方');
  });
});

describe('parseExiaProfile — 옛 형식', () => {
  const legacy = () => ({
    name: 'MEI',
    synchroLevel: 742,
    area_id: '81',
    researchLevels: { general: 300, attacker: 120, pilgrim: 90 },
    elements: {
      Fire: [{
        name_code: 5001,
        limit_break: { grade: 2, core: 0 },
        skill1_level: 7, skill2_level: 7, skill_burst_level: 7,
        item_rare: 'R', item_level: 5,
        equipments: {
          '0': [{ function_type: 'StatAtk', function_value: 10.5 }],
          '1': [], '2': [], '3': [],
        },
      }],
    },
  });

  it('0~3 슬롯과 영문 연구실 키를 알아본다', () => {
    const profile = parseExiaProfile(legacy(), settings);
    expect(profile.name).toBe('MEI');
    expect(consoleFrom(profile.raw)?.common_level).toBe(300);
    expect(consoleFrom(profile.raw)?.class_level['화력형']).toBe(120);

    const rapi = areaToOverrides(profile.raw, settings, catalog).overrides.라피!;
    expect(rapi.overload?.atk_pct).toBeCloseTo(10.5, 4);
    expect(rapi.collection).toEqual({ stage: 'R5', favorite: 0 });
  });

  it('등급이 없으면 «옵션이 있다 = 기업 장비»로 보고 강화는 0으로 둔다', () => {
    const profile = parseExiaProfile(legacy(), settings);
    const rapi = areaToOverrides(profile.raw, settings, catalog).overrides.라피!;
    expect(rapi.equipLevels?.['머리']).toBe(0);      // 옵션이 붙은 칸
    expect(rapi.equipLevels?.['몸통']).toBe('없음'); // 빈 칸
  });
});

describe('계정 접근권은 어디에도 남지 않는다', () => {
  it('변환 결과에 cookie·game_uid가 없다', () => {
    const profile = parseExiaProfile(exportFile(), settings);
    const dumped = JSON.stringify(profile);
    expect(dumped).not.toContain('deadbeef');
    expect(dumped).not.toContain('game_token');
    expect(dumped).not.toContain('4344331436314217');
  });

  it('씻어 낸 파일에도 없다', () => {
    const washed = stripExiaProfile(exportFile());
    expect(washed).not.toContain('deadbeef');
    expect(washed).not.toContain('game_token');
    expect(washed).not.toContain('4344331436314217');
    // 계산에 쓰는 것은 그대로 살아 있어야 한다.
    expect(JSON.parse(washed).synchroLevel).toBe(787);
    expect(JSON.parse(washed).recycleRoomResearches['1001'].Level).toBe(366);
    // 好感度는 웹에서는 안 쓰지만 `scraper/profile_import.py`가 읽는다. 씻은 파일이
    // 본체를 대신하므로 여기서 지우면 그쪽만 조용히 추정값으로 떨어진다.
    expect(JSON.parse(washed).elements.Fire[0].attractive_lv).toBe(20);
  });

  it('씻어 낸 파일을 다시 읽어도 같은 규격이 나온다', () => {
    const direct = overridesOf(exportFile());
    const washed = areaToOverrides(
      parseExiaProfile(stripExiaProfile(exportFile()), settings).raw, settings, catalog).overrides;
    expect(washed).toEqual(direct);
  });
});

describe('parseExiaProfile — 못 읽는 파일', () => {
  it('JSON이 아니면 그렇게 말한다', () => {
    expect(() => parseExiaProfile('<html>', settings)).toThrow('JSON');
  });

  it('다른 도구의 파일은 elements가 없다고 말한다', () => {
    expect(() => parseExiaProfile('{"foo":1}', settings)).toThrow('elements');
  });

  it('니케가 하나도 없으면 끊는다', () => {
    expect(() => parseExiaProfile(exportFile({ elements: { Fire: [] } }), settings))
      .toThrow('一隻妮姬都沒有');
  });
});

describe('parseExiaBatch', () => {
  const file = (name: string, body: unknown) =>
    ({ name, text: typeof body === 'string' ? body : JSON.stringify(body) });

  it('한 파일이 깨져도 나머지는 읽는다', () => {
    const batch = parseExiaBatch([
      file('a.json', exportFile()),
      file('broken.json', 'not json'),
      file('c.json', exportFile({ name: 'MEI' })),
    ], settings);
    expect(batch.profiles.map((p) => p.name)).toEqual(['NOIR', 'MEI']);
    expect(batch.failed).toHaveLength(1);
    expect(batch.failed[0]!.file).toBe('broken.json');
  });

  it('같은 사람이 두 번 오면 나중 것을 쓰고 그렇게 적는다', () => {
    const batch = parseExiaBatch([
      file('old.json', exportFile({ synchroLevel: 700 })),
      file('new.json', exportFile({ synchroLevel: 787 })),
    ], settings);
    expect(batch.profiles).toHaveLength(1);
    expect(batch.profiles[0]!.synchro).toBe(787);
    expect(batch.profiles[0]!.notes.join()).toContain('同名檔案');
  });
});
