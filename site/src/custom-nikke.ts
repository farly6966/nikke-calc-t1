import type {
  CharacterMeta,
  CharacterSettingsDefaults,
  CustomCharacter,
  GrowthOption,
} from './types';

export const CUSTOM_KEY = 'nikke-custom-v1';

const WEAPONS = ['AR', 'SMG', 'MG', 'SR', 'RL', 'SG'];
const CODES = ['전격', '작열', '수냉', '풍압', '철갑'];
const CLASSES = ['화력형', '방어형', '지원형'];

// 다른 LLM에 붙여넣을 프롬프트. 우리 엔진이 요구하는 JSON 스키마 + 실제 예시.
export function buildAddPrompt(): string {
  return `你是一個把手機遊戲《勝利女神:妮姬》的角色資料轉成 JSON 的工具。
讀我接下來貼上的 1 名妮姬的名稱・數值・技能說明,只輸出一個完全符合下面 schema 的 JSON 物件(不要程式碼區塊、不要說明,只要 JSON)。

**下面 schema 裡的韓文值(전격・화력형・스킬1 等)是引擎的識別值,要原樣照抄,不可翻譯。**

## nikke(數值)欄位
共通(所有武器):
  "rarity": "SSR | SR | R",
  "element_code": "전격 | 작열 | 수냉 | 풍압 | 철갑",
  "class": "화력형 | 방어형 | 지원형",
  "manufacturer": "엘리시온 | 미실리스 | 테트라 | 필그림 | 어브노멀",
  "weapon_type": "AR | SMG | MG | SR | RL | SG",
  "burst_stage": 1 | 2 | 3,
  "burst_cooldown": 秒(例:20、40),
  "max_ammo": 基本裝彈數,
  "reload_time": 裝填秒數,
  "fire_rate": 每秒發射數,
  "pellets": 散彈數(只有 SG 會 2 以上,否則為 1),
  "muzzles": 槍口數(通常為 1),
  "damage_coeff": 單發傷害係數(照 % 標示直接寫數字)
依武器類型的追加欄位(重要):
  · 連射型(AR・SMG・MG・SG): "core_dmg_mult": 核心傷害倍率(%,例 200)
  · 蓄力型(SR・RL): "charge_time": 到滿蓄力所需秒數(例 Alice 1.5,多數 RL 1.0),
                   "full_charge_mult": 滿蓄力傷害倍率(%,例 250・350)
    (蓄力型一定要有 charge_time 與 full_charge_mult。)

## skills(技能陣列)欄位
每個元素:
  "source": "스킬1 | 스킬2 | 버스트스킬",
  "type": "buff | damage",
  "name": "效果名稱",
  "trigger": { "timing": ["發動時機"], "condition": ["條件(沒有就給空陣列)"] },
  "target": "對象",
  "stat": "效果種類",
  "polarity": "beneficial | harmful",
  "max_stack": 1,
  "values": { "1": 最低等級值, "10": 滿級值 }   // 有分等級的值時
  // 與等級無關的固定值,就用 "fixed_value": 數字 取代 "values"
  "duration": 持續秒數(即時發動/永久則省略或填 -1)

**引擎會忽略不在下列清單中的 stat・timing・target(視為沒有效果)。務必只用下面的值。**
不確定時就對應到最接近的值;真的對不上的效果(量表・模式切換・複雜的疊層條件等特殊機制)
**請把那個效果整個拿掉**(不要硬塞)。

timing(發動時機): battle_start, full_burst_start, full_burst_start_count:N, full_burst_start_exact:N, full_burst_end, burst_cast, burst_cast_count:N, last_bullet, last_bullet_fire, hit_count:N, full_charge_hit, passive
target(對象): self, all_allies, all_allies_excl_self, all_enemies, target, same_target, allies:N, allies_top_atk:N, allies_weapon:<武器>, allies_class:공격|방어|지원, allies_code:<屬性>, allies_code_weapon:<屬性>:<武器>, enemies_top_atk:N
buff stat(type "buff"): atk_pct, atk_flat, atk_dmg_pct, normal_atk_dmg_pct, crit_rate, crit_dmg, core_dmg_pct, element_bonus_pct, burst_dmg_pct, pierce_dmg_pct, charge_dmg_pct, charge_dmg_mag_pct, charge_speed_pct, max_ammo_pct, max_ammo_flat, reload_speed_pct, attack_speed_pct, accuracy_pct, def_pct, def_ignore_pct, enemy_def_down_pct, received_dmg(敵人受到的傷害增加 %), burst_cooldown(秒,減少填負數)
damage stat(type "damage",values 是傷害係數 %): bonus_damage, burst_damage, damage
注意:「受到的傷害增加」是 received_dmg(不是 received_dmg_pct)。武器名對應 — 步槍=AR, 狙擊槍=SR, 機槍=MG, 衝鋒槍=SMG, 霰彈槍=SG, 火箭筒=RL。
※ allies_class 的值 공격|방어|지원 即「攻擊|防禦|支援」,但要原樣寫韓文。

## 參考範例
連射型(Privaty, AR):
{"name":"프리바티","nikke":{"rarity":"SSR","element_code":"수냉","class":"화력형","manufacturer":"테트라","weapon_type":"AR","burst_stage":3,"burst_cooldown":40,"max_ammo":60,"reload_time":1.0,"fire_rate":12.0,"pellets":1,"muzzles":1,"damage_coeff":13.65,"core_dmg_mult":200.0},"skills":[
{"source":"스킬1","type":"buff","name":"EX 매거진","trigger":{"timing":["full_burst_start"],"condition":[]},"target":"all_allies","stat":"atk_pct","polarity":"beneficial","max_stack":1,"values":{"1":18.77,"10":23.61},"duration":10.0},
{"source":"버스트스킬","type":"damage","name":"AK 미사일","trigger":{"timing":["burst_cast"],"condition":[]},"target":"all_enemies","stat":"burst_damage","values":{"1":831.79,"10":1407.64}}
]}
蓄力型(Alice, SR):
{"name":"앨리스 예시","nikke":{"rarity":"SSR","element_code":"작열","class":"화력형","manufacturer":"테트라","weapon_type":"SR","burst_stage":3,"burst_cooldown":40,"max_ammo":6,"reload_time":2.0,"fire_rate":1.0,"pellets":1,"muzzles":1,"damage_coeff":41.36,"charge_time":1.5,"full_charge_mult":350.0},"skills":[
{"source":"버스트스킬","type":"buff","name":"공격 버프","trigger":{"timing":["burst_cast"],"condition":[]},"target":"self","stat":"atk_pct","polarity":"beneficial","max_stack":1,"values":{"1":50.0,"10":90.0},"duration":10.0}
]}

現在請轉換下面這名妮姬。不確定的值可以合理推估,但 schema 一定要遵守:

[請在這裡貼上妮姬的名稱與技能說明]`;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// 엔진이 인식하는 어휘(접두사 기준). 여기 없는 stat·timing·target은 시뮬에서 무시된다.
const BUFF_STATS = new Set([
  'atk_pct', 'atk_flat', 'atk_dmg_pct', 'normal_atk_dmg_pct', 'crit_rate', 'crit_dmg',
  'core_dmg_pct', 'element_bonus_pct', 'burst_dmg_pct', 'burst_dmg_aoe_pct', 'pierce_dmg_pct',
  'dot_dmg_pct', 'armor_break_dmg_pct', 'sequential_dmg_pct', 'split_dmg_pct', 'part_dmg_pct',
  'charge_dmg_pct', 'charge_dmg_mag_pct', 'charge_speed_pct', 'max_ammo_pct', 'max_ammo_flat',
  'reload_speed_pct', 'attack_speed_pct', 'accuracy_pct', 'def_pct', 'def_ignore_pct',
  'enemy_def_down_pct', 'received_dmg', 'burst_cooldown', 'max_hp_pct', 'lifesteal_pct',
  'pellet_count', 'fullburst_duration', 'skill_cooldown_pct', 'mg_warmup_speed_pct',
]);
const DAMAGE_STATS = new Set(['bonus_damage', 'burst_damage', 'damage']);
const KNOWN_TIMINGS = new Set([
  'battle_start', 'full_burst_start', 'full_burst_start_count', 'full_burst_start_exact',
  'full_burst_end', 'full_burst_end_count', 'burst_cast', 'burst_cast_count', 'last_bullet',
  'last_bullet_fire', 'hit_count', 'full_charge_hit', 'passive', 'every',
]);
const KNOWN_TARGETS = new Set([
  'self', 'all_allies', 'all_allies_excl_self', 'all_enemies', 'target', 'same_target',
  'allies', 'allies_top_atk', 'allies_top_atk_excl', 'allies_top_def', 'allies_lowest_hp',
  'allies_adjacent', 'allies_random', 'allies_weapon', 'allies_weapon_excl_self',
  'allies_class', 'allies_code', 'allies_code_weapon', 'allies_code_weapon_leftmost',
  'enemies_top_atk', 'enemies_top_def', 'enemies_code', 'enemies_lowest_hp_code',
]);

const prefix = (value: string): string => value.split(':')[0] ?? value;

/** 스킬 중 엔진이 인식하지 못하는(=시뮬에 반영 안 되는) 효과 이름 목록. */
export function unsupportedEffects(skills: unknown[]): string[] {
  const bad: string[] = [];
  for (const skill of skills) {
    if (!isRecord(skill)) continue;
    const stat = String(skill.stat ?? '');
    const target = String(skill.target ?? '');
    const trigger = isRecord(skill.trigger) ? skill.trigger : {};
    const timings = Array.isArray(trigger.timing) ? trigger.timing.map(String) : [];
    const name = String(skill.name ?? '(未命名)');
    const statOk = skill.type === 'damage'
      ? DAMAGE_STATS.has(prefix(stat))
      : BUFF_STATS.has(stat);
    const timingOk = timings.length === 0 || timings.every((t) => KNOWN_TIMINGS.has(prefix(t)));
    const targetOk = target === '' || KNOWN_TARGETS.has(prefix(target));
    if (!statOk || !timingOk || !targetOk) bad.push(name);
  }
  return [...new Set(bad)];
}

/** 붙여넣은 JSON을 검증해 CustomCharacter로. 실패하면 사람이 읽을 오류를 던진다. */
export function parseCustomInput(text: string): CustomCharacter {
  let data: unknown;
  try {
    data = JSON.parse(text.trim());
  } catch {
    throw new Error('這不是 JSON 格式。請只貼上 LLM 給的 JSON。');
  }
  if (!isRecord(data)) throw new Error('最外層必須是物件。');
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) throw new Error('需要 name(名稱)。');
  if (!isRecord(data.nikke)) throw new Error('需要 nikke(數值)物件。');
  if (!Array.isArray(data.skills)) throw new Error('需要 skills(技能陣列)。');

  const nikke = data.nikke;
  const required = ['rarity', 'element_code', 'class', 'weapon_type', 'burst_stage',
    'burst_cooldown', 'max_ammo', 'reload_time', 'fire_rate', 'damage_coeff'];
  const missing = required.filter((f) => nikke[f] === undefined || nikke[f] === null);
  if (missing.length > 0) throw new Error(`nikke 缺少這些項目:${missing.join(', ')}`);
  if (!WEAPONS.includes(String(nikke.weapon_type))) {
    throw new Error(`weapon_type 必須是 ${WEAPONS.join('/')} 其中之一。`);
  }
  if (!CODES.includes(String(nikke.element_code))) {
    throw new Error(`element_code 必須是 ${CODES.join('/')} 其中之一。`);
  }
  if (!CLASSES.includes(String(nikke.class))) {
    throw new Error(`class 必須是 ${CLASSES.join('/')} 其中之一。`);
  }
  if (![1, 2, 3].includes(Number(nikke.burst_stage))) {
    throw new Error('burst_stage 必須是 1、2、3 其中之一。');
  }

  // 엔진 기본값 보정 (누락 허용 필드)
  const filled: Record<string, unknown> = {
    pellets: 1, muzzles: 1, core_dmg_mult: 100.0, squad: '', squad_name: '',
    ...nikke,
    burst_stage: Number(nikke.burst_stage),
    manufacturer: typeof nikke.manufacturer === 'string' ? nikke.manufacturer : '',
  };
  // 차지형(SR·RL)은 charge_time(풀차지까지 초)·full_charge_mult(풀차지 대미지 %)를
  // 엔진이 직접 읽는다. 누락 시 크래시 대신 합리적 기본값으로 채운다.
  if (nikke.weapon_type === 'SR' || nikke.weapon_type === 'RL') {
    if (filled.charge_time === undefined) filled.charge_time = 1.0;
    if (filled.full_charge_mult === undefined) filled.full_charge_mult = 250.0;
  }
  return { name, nikke: filled, skills: data.skills };
}

const growthOptionsFor = (rarity: string): { options: GrowthOption[]; max: number; def: number } => {
  const label = (v: number): string =>
    v === 0 ? '無突破' : v <= 3 ? `${v}突破` : `核心強化 ${v - 3}`;
  const affinity = (v: number): number => (v === 0 ? 10 : v === 1 ? 20 : 30);
  if (rarity === 'R') {
    return { options: [{ value: 0, label: '無突破', affinity: 10 }], max: 0, def: 0 };
  }
  const max = rarity === 'SR' ? 2 : 10;
  const options = Array.from({ length: max + 1 }, (_, v) => ({ value: v, label: label(v), affinity: affinity(v) }));
  return { options, max, def: rarity === 'SR' ? 2 : 3 };
};

export function customToMeta(custom: CustomCharacter): CharacterMeta {
  const n = custom.nikke;
  return {
    name: custom.name,
    burstStage: String(n.burst_stage ?? ''),
    elementCode: String(n.element_code ?? ''),
    weaponType: String(n.weapon_type ?? ''),
    className: String(n.class ?? ''),
    manufacturer: String(n.manufacturer ?? ''),
    preview: false,
    image: null,
    // 직접 추가한 니케는 블라블라링크·enikk 사전에 없다 — 그쪽 가져오기가 건너뛴다.
    nameCode: null,
    resourceId: null,
    // 직접 추가한 니케에는 별칭이 없다 — 별칭 표는 유저가 손으로 채운다.
    aliases: [],
  };
}

export function customToSettings(custom: CustomCharacter): CharacterSettingsDefaults {
  const rarity = String(custom.nikke.rarity ?? 'SSR');
  const growth = growthOptionsFor(rarity);
  return {
    weaponType: String(custom.nikke.weapon_type ?? ''),
    recommendedControl: {},
    hasConditionalControl: false,
    growthStage: growth.def,
    rarity,
    maxGrowthStage: growth.max,
    growthOptions: growth.options,
    skillLevels: { '1': 10, '2': 10, '3': 10 },
    skillLevelsLocked: false,
    // 직접 추가한 니케는 애장품 데이터가 없으므로 소장품만 기본 스펙(SR15)으로 둔다.
    collection: { stage: 'SR15', favorite: 0 },
    overload: {
      element_bonus: 88.6, atk_pct: 22.22, def_pct: 0, max_ammo_pct: 129.64,
      crit_rate: 0, crit_dmg: 0, charge_speed_pct: 0, charge_dmg_pct: 0, accuracy_pct: 0,
    },
    // 기본 스펙과 같은 큐브다(`context/spec.py` DEFAULT_CHAR). 큐브 이름이 짧은
    // 통칭에서 인게임 정식 명칭으로 바뀔 때 여기만 옛 이름으로 남아, 직접 추가한
    // 니케는 카탈로그에 없는 큐브를 가리키고 있었다.
    cube: { name: '렐릭 베어 큐브', level: 15 },
  };
}

export function loadCustom(getItem: (key: string) => string | null): Record<string, CustomCharacter> {
  try {
    const raw = getItem(CUSTOM_KEY);
    return raw ? (JSON.parse(raw) as Record<string, CustomCharacter>) : {};
  } catch {
    return {};
  }
}
