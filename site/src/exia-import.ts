/**
 * Exia（ExiaInvasion R 擴充）匯出檔 → 計算機認得的養成規格。
 *
 * 這條路的存在理由：聯盟三十幾個人的規格，不可能要三十幾份登入。每個人用自己的
 * 工具匯出一個檔案交出來，這裡把它翻成計算機的話。
 *
 * ## 為什麼輸出 `RawArea` 而不是直接輸出 override
 *
 * `blablalink.ts` 的 `areaToOverrides()` 已經把「遊戲欄位 → 計算機設定」這件事做完了，
 * 而且 `csv-import.ts`（樂島 CSV）也刻意讓結果落在同一個位置。第三條路要是自己再翻一次，
 * 同一個帳號就會有三種規格，而且沒人知道哪個對。
 *
 * 所以這裡只做「Exia 的欄位名 → blablalink 的欄位名」這一層，翻譯規則一律交給既有的
 * `areaToOverrides` / `consoleFrom` / `synchroFrom`。那三個函式一行都不用改。
 *
 * ## 不讀的東西
 *
 * 匯出檔裡有 `cookie`（內含 game_token）和 `game_uid` —— 那是帳號的登入憑證。
 * 計算完全用不到，而且只要抄進來一次，這支程式就成了它可能外洩的地方。
 * 這裡從頭到尾不碰那兩個欄位，有一條測試釘住這件事。
 *
 * ## 兩種格式都吃
 *
 * Exia 的匯出格式改過版，而且聯盟成員的擴充版本不會一致。實際觀測到兩種：
 *
 *   新（2026-08 起）  equipments: { head: { tier, lv, options: [[線], [線], [線]] }, ... }
 *                     recycleRoomResearches: { "1001": { Level: n }, ... }
 *   舊（~2026-09-02） equipments: { "0": [線, 線, 線], ... }
 *                     researchLevels: { general: n, attacker: n, ... }
 *
 * 兩種都收。分辨方式是看鍵名，不是看版本號 —— 匯出檔沒有版本號。
 */

import { FUNCTION_TO_OVERLOAD, type RawArea } from './blablalink';
import type { SettingsCatalog } from './types';

/** 一份匯出檔讀完的樣子。`raw` 直接餵給 `areaToOverrides`。 */
export interface ExiaProfile {
  /** 遊戲暱稱。成員表上顯示的就是這個，也是同名檔案的去重鍵。 */
  name: string;
  /** 同步器等級。整隊都會變成這個等級，所以傷害差很多。 */
  synchro: number;
  /** 伺服器代號。`area_id` 是字串，這裡轉成數字。 */
  area: number;
  /** 檔案裡有幾隻妮姬。成員表上顯示用。 */
  owned: number;
  raw: RawArea;
  /** 讀不到的東西。給人看的一行一句，不是錯誤。 */
  notes: string[];
}

/** 一般裝備是 T1~T9，10 以上是企業裝備（強化 0~5）。跟 `blablalink.ts` 同一個界線。 */
const CORP_TIER = 10;

/** 新格式的部位鍵 → blablalink 回應的欄位前綴。順序就是遊戲裡的顯示順序。 */
const PART_KEYS: Array<[string, string]> = [
  ['head', 'head'],
  ['torso', 'torso'],
  ['arm', 'arm'],
  ['leg', 'leg'],
];

/**
 * 舊格式的部位鍵。**0·1·2·3 = 頭·身·手·腳**，這是 Exia 那邊確認過的順序（`profile_import.py`
 * 的 `SLOT_TO_PART` 同一張表）。這個弄反不會報錯，只會讓部位裝備等級整組錯位，
 * 而總和看起來還很合理 —— 所以錯了也不會有人發現。
 */
const LEGACY_PART_KEYS: Array<[string, string]> = [
  ['0', 'head'],
  ['1', 'torso'],
  ['2', 'arm'],
  ['3', 'leg'],
];

/**
 * 舊格式的回收室英文鍵 → 遊戲內部 tid。新格式直接就是 tid，不用這張表。
 * tid 的意義由 `blablalink.ts` 的 `CONSOLE_TIDS` 定義，這裡只負責把名字換成號碼。
 */
const RESEARCH_NAME_TO_TID: Record<string, number> = {
  general: 1001,
  attacker: 1101, defender: 1102, supporter: 1103,
  elysion: 1201, missilis: 1202, tetra: 1203, pilgrim: 1204, abnormal: 1205,
};

const num = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** 超載一條線。Exia 已經把效果名和數值攤開了，不像 blablalink 要另外查 id。 */
interface OverloadLine {
  function_type: string;
  function_value: number;
}

/**
 * 一個部位的超載線。新格式包了兩層（`options` 是「線的陣列」的陣列，一格一條線），
 * 舊格式只有一層。兩層都攤平 —— 反正一格最多一條線，攤平不會弄丟資訊。
 */
function linesOf(slot: unknown): OverloadLine[] {
  const raw = Array.isArray(slot) ? slot
    : isObject(slot) && Array.isArray(slot.options) ? slot.options
    : [];
  const out: OverloadLine[] = [];
  for (const entry of raw) {
    for (const line of Array.isArray(entry) ? entry : [entry]) {
      if (!isObject(line)) continue;
      const type = String(line.function_type ?? '');
      if (!type) continue;
      out.push({ function_type: type, function_value: num(line.function_value) });
    }
  }
  return out;
}

/** 這個檔案用新格式還是舊格式的部位鍵。看哪一組鍵真的存在，不猜版本。 */
function partKeysOf(equipments: Record<string, unknown>): Array<[string, string]> {
  const hasNew = PART_KEYS.some(([key]) => key in equipments);
  return hasNew ? PART_KEYS : LEGACY_PART_KEYS;
}

/**
 * 收藏品等級 → 一個對得上的 tid。
 *
 * `areaToOverrides` 是拿 tid 去 `settings.favoriteItems` 查等級的，但 Exia 直接就給了
 * 等級（`item_rare`）。這裡反過來找一個同等級的 tid 交回去 —— 查表只用得到等級，
 * 是哪一個 tid 不影響結果。這樣就不必為了這一格去改 `areaToOverrides`。
 */
function tidByGrade(favoriteItems: Record<string, string>): Map<string, number> {
  const map = new Map<string, number>();
  for (const [tid, grade] of Object.entries(favoriteItems)) {
    if (!map.has(grade)) map.set(grade, Number(tid));
  }
  return map;
}

/**
 * 回收室等級。新舊兩種形狀都收，回傳 blablalink 的 `recycle_room_researches` 樣子。
 *
 *   新  { "1001": { Level: 366 }, ... }   ← tid 當鍵，值是物件
 *   舊  { general: 372, ... }             ← 英文名當鍵，值是數字
 */
function researchesOf(src: Record<string, unknown>): Array<{ tid: number; lv: number }> {
  const out: Array<{ tid: number; lv: number }> = [];

  const modern = src.recycleRoomResearches;
  if (isObject(modern)) {
    for (const [key, value] of Object.entries(modern)) {
      const tid = Number(key);
      if (!Number.isFinite(tid)) continue;
      // 值可能是 { Level: n } 也可能直接是 n。兩種都認。
      const lv = isObject(value) ? num(value.Level ?? value.level) : num(value);
      out.push({ tid, lv });
    }
    if (out.length > 0) return out;
  }

  const legacy = src.researchLevels;
  if (isObject(legacy)) {
    for (const [key, value] of Object.entries(legacy)) {
      const tid = RESEARCH_NAME_TO_TID[key];
      if (tid === undefined) continue;
      out.push({ tid, lv: num(value) });
    }
  }
  return out;
}

/**
 * 匯出檔一份 → `RawArea`。
 *
 * 丟出例外的情況只有「這根本不是 Exia 匯出檔」。欄位缺東少西不算錯 —— 格式還在長，
 * 等它齊了才動就什麼都做不了。缺的記在 `notes` 裡給人看。
 */
export function parseExiaProfile(
  input: string | Record<string, unknown>,
  settings: SettingsCatalog,
): ExiaProfile {
  let src: Record<string, unknown>;
  if (typeof input === 'string') {
    try {
      src = JSON.parse(input) as Record<string, unknown>;
    } catch {
      throw new Error('這不是有效的 JSON 檔。');
    }
  } else {
    src = input;
  }
  if (!isObject(src)) throw new Error('這不是有效的 JSON 檔。');

  const elements = src.elements;
  if (!isObject(elements)) {
    throw new Error('檔案裡沒有 elements —— 這看起來不是 Exia 的匯出檔。');
  }

  const roster: Array<Record<string, unknown>> = [];
  for (const group of Object.values(elements)) {
    if (!Array.isArray(group)) continue;
    for (const entry of group) if (isObject(entry)) roster.push(entry);
  }
  if (roster.length === 0) {
    throw new Error('檔案裡一隻妮姬都沒有。請確認匯出時有等它跑完。');
  }

  const gradeToTid = tidByGrade(settings.favoriteItems);
  const notes: string[] = [];

  // 合成的超載選項 id。blablalink 是「裝備欄存 id、另一張表查效果」，Exia 是把效果直接
  // 寫在裝備欄裡。這裡替每一種（效果, 數值）發一個流水號，再組回那張表，
  // `areaToOverrides` 就能照原本的方式讀。**從 1 開始** —— 0 在那邊代表空欄。
  const optionIds = new Map<string, number>();
  const stateEffects: RawArea['stateEffects'] = [];
  const idFor = (line: OverloadLine): number => {
    const key = `${line.function_type}|${line.function_value}`;
    const known = optionIds.get(key);
    if (known !== undefined) return known;
    const id = optionIds.size + 1;
    optionIds.set(key, id);
    stateEffects.push({
      id,
      // blablalink 的數值是百分點的一百倍（18.02% 來的是 1802），而 `buildOptionMap`
      // 會除以 100。Exia 給的已經是 18.02，所以這裡先乘回去，換算才會對。
      // 少了這一步，全部的超載會變成實際值的百分之一。
      function_details: [{
        function_type: line.function_type,
        function_value: Math.round(line.function_value * 100),
      }],
    });
    return id;
  };

  const characters: RawArea['characters'] = [];
  const details: RawArea['details'] = [];
  let noCube = 0;
  const unknownOptions = new Set<string>();

  for (const char of roster) {
    const code = num(char.name_code);
    if (!code) continue;

    const limitBreak = isObject(char.limit_break) ? char.limit_break : {};
    characters.push({
      name_code: code,
      grade: num(limitBreak.grade),
      core: num(limitBreak.core),
      lv: num(char.lv),
    });

    const detail: Record<string, number> = {
      name_code: code,
      skill1_lv: num(char.skill1_level),
      skill2_lv: num(char.skill2_level),
      ulti_skill_lv: num(char.skill_burst_level),
    };

    // 收藏品／愛藏品。兩者共用一格，所以只會來一邊。
    // 等級認不得就整格不寫 —— `areaToOverrides` 會留預設值，那比亂猜好。
    const rare = String(char.item_rare ?? '');
    const tid = rare ? gradeToTid.get(rare) : undefined;
    if (tid !== undefined) {
      detail.favorite_item_tid = tid;
      detail.favorite_item_lv = num(char.item_level);
    }

    // 魔方。Exia 的 `cube_id` 就是遊戲內部 tid，跟 `settings.cubes` 的 id 是同一套。
    const cubeId = num(char.cube_id);
    if (cubeId) {
      detail.harmony_cube_tid = cubeId;
      detail.harmony_cube_lv = num(char.cube_level);
    } else {
      noCube += 1;
    }

    const equipments = isObject(char.equipments) ? char.equipments : {};
    for (const [srcKey, prefix] of partKeysOf(equipments)) {
      const slot = equipments[srcKey];
      const lines = linesOf(slot);

      // 等級和強化階段。新格式寫在格子裡，舊格式沒有。
      let tier = isObject(slot) ? num(slot.tier, -1) : -1;
      const level = isObject(slot) ? num(slot.lv ?? slot.level) : 0;
      if (tier < 0) {
        // 沒給等級時：超載選項只長在企業裝備上，所以「有選項 = 企業裝備」。
        // 強化階段不知道就當 0 —— 那是最低的已裝備狀態，會低估而不是高估。
        tier = lines.length > 0 ? CORP_TIER : 0;
      }
      detail[`${prefix}_equip_tier`] = tier;
      detail[`${prefix}_equip_lv`] = level;

      lines.slice(0, 3).forEach((line, index) => {
        // 計算機不認得的效果會在 `areaToOverrides` 裡被靜靜丟掉。遊戲哪天出了新的超載屬性，
        // 那一整條就會消失而畫面上不會有任何跡象 —— 所以在這裡數起來。
        if (!(line.function_type in FUNCTION_TO_OVERLOAD)) {
          unknownOptions.add(line.function_type);
          return;
        }
        detail[`${prefix}_equip_option${index + 1}_id`] = idFor(line);
      });
    }

    details.push(detail);
  }

  if (details.length === 0) {
    throw new Error('檔案裡的妮姬都沒有 name_code，無法對應到計算機。');
  }
  if (noCube > 0) notes.push(`沒裝魔方的妮姬 ${noCube} 種 —— 那些以預設魔方計算。`);
  if (unknownOptions.size > 0) {
    notes.push(`計算機還不認得的超載屬性已略過：${[...unknownOptions].join('、')}。`);
  }

  const researches = researchesOf(src);
  if (researches.length === 0) {
    notes.push('檔案裡沒有回收室等級 —— 主控台一律以 0 計算，傷害會低估。');
  }

  const synchro = num(src.synchroLevel);
  if (synchro <= 0) notes.push('檔案裡沒有同步器等級 —— 會用計算機的預設值。');

  const name = String(src.name ?? '').trim();

  return {
    name: name || '（無名）',
    synchro,
    area: num(src.area_id),
    owned: details.length,
    notes,
    raw: {
      area: num(src.area_id),
      characters,
      details,
      stateEffects,
      outpost: {
        recycle_room_researches: researches,
        // 同步器等級在匯出檔的最上層，不在回收室裡。`synchroFrom` 讀的是這個位置。
        synchro_level: synchro > 0 ? synchro : undefined,
      },
    },
  };
}

/** 一個檔案讀失敗的樣子。整批匯入時，壞掉的那個不該讓其他 31 個一起停下來。 */
export interface ExiaFailure {
  file: string;
  reason: string;
}

export interface ExiaBatch {
  profiles: ExiaProfile[];
  failed: ExiaFailure[];
}

/**
 * 一次讀一整批。
 *
 * 同一個人的檔案給了兩份（改名重傳很常見）就留**後面那份**，並記一行。
 * 靜靜地留前面那份會讓人以為新檔沒生效，那比明講難查得多。
 */
export function parseExiaBatch(
  files: Array<{ name: string; text: string }>,
  settings: SettingsCatalog,
): ExiaBatch {
  const byName = new Map<string, ExiaProfile>();
  const failed: ExiaFailure[] = [];
  const replaced: string[] = [];

  for (const file of files) {
    try {
      const profile = parseExiaProfile(file.text, settings);
      if (byName.has(profile.name)) replaced.push(profile.name);
      byName.set(profile.name, profile);
    } catch (error) {
      failed.push({
        file: file.name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const profiles = [...byName.values()];
  if (replaced.length > 0) {
    const who = [...new Set(replaced)].join('、');
    for (const profile of profiles) {
      if (replaced.includes(profile.name)) {
        profile.notes.push(`同名檔案有多份，採用最後讀到的那份（${who}）。`);
      }
    }
  }
  return { profiles, failed };
}

/**
 * 把匯出檔洗成「只剩計算用得到的欄位」的乾淨版。
 *
 * 這是給**傳檔之前**用的。瀏覽器改不了硬碟上的原檔，所以計算機這邊不讀 cookie
 * 只保護了計算機自己；真正的破口是那個檔案躺在群組裡的那一份。成員先用這個洗過再傳，
 * 憑證就不會離開他自己的電腦。
 *
 * 順帶把檔案縮小一個數量級（實測 489KB → 約 103KB），傳起來也輕鬆。
 */
export function stripExiaProfile(input: string | Record<string, unknown>): string {
  const src = typeof input === 'string'
    ? JSON.parse(input) as Record<string, unknown>
    : input;
  if (!isObject(src)) throw new Error('這不是有效的 JSON 檔。');

  const elements: Record<string, unknown[]> = {};
  for (const [element, group] of Object.entries(src.elements ?? {})) {
    if (!Array.isArray(group)) continue;
    elements[element] = group.filter(isObject).map((char) => {
      const kept: Record<string, unknown> = {
        name_code: char.name_code,
        name_en: char.name_en,
        lv: char.lv,
        limit_break: char.limit_break,
        skill1_level: char.skill1_level,
        skill2_level: char.skill2_level,
        skill_burst_level: char.skill_burst_level,
        item_rare: char.item_rare,
        item_level: char.item_level,
        equipments: char.equipments,
        // 好感度網站這邊用不到（它從突破階段推導）。但還是留著：洗過的檔會取代本體，
        // 而讀本體的另一條路（scraper/profile_import.py）真的會用這個值。
        // 在這裡刪掉，就只有那邊會靜靜地掉回推估值。
        attractive_lv: char.attractive_lv,
      };
      if (char.cube_id) { kept.cube_id = char.cube_id; kept.cube_level = char.cube_level; }
      return kept;
    });
  }

  // 白名單，不是黑名單。用「刪掉 cookie」的寫法，工具下次多帶一個憑證欄位就漏了。
  return JSON.stringify({
    name: src.name,
    synchroLevel: src.synchroLevel,
    area_id: src.area_id,
    recycleRoomResearches: src.recycleRoomResearches,
    researchLevels: src.researchLevels,
    elements,
  });
}
