/**
 * 유니온 레이드 (BETA) — 유니온원 각자의 실제 스펙으로 같은 보스·같은 덱을 돌려
 * «누가 얼마나 기여할 수 있나»를 견준다.
 *
 * 데이터가 오는 길이 둘로 갈린다. 그 이유를 여기 적어 둔다:
 *
 *   명단(닉네임·openid·싱크로) → **본인 브라우저에서만** 온다.
 *       `Game/GetGuildMembers`는 호출자가 게임 계정에 묶인 로그인이어야 한다.
 *       우리 프록시 계정은 게임 롤이 없어 `user no bind role`로 거부된다(실측
 *       2026-08-27). 그래서 붙여넣기로 받는다 — 쿠키를 우리가 만지지 않는 길이다.
 *
 *   유니온원 스펙(니케·장비·오버로드·콘솔) → 기존 프록시로 온다.
 *       공개 계정은 그대로 오고, 비공개는 `1301002`로 막힌다. 그 갈림이 곧 «공개여부»다.
 *
 * 보스와 덱은 **공유 코드**로 채운다(전투 조건 `NK3-`, 조합 `NK2-`). 이미 있는 문법을
 * 그대로 쓰면 유니온원끼리 세팅을 주고받기도 쉽고, 이 탭이 편집기를 새로 만들지 않아도 된다.
 */

import {
  decodeBattleCode, decodeShareCode, decodeUnionCode, encodeShareCode, encodeUnionCode,
  type UnionShare,
} from './share-code';
import { DEFAULT_SYNCHRO_LEVEL, SYNCHRO_MAX, SYNCHRO_MEASURED_MAX } from './model';
import { parseExiaBatch, stripExiaProfile } from './exia-import';
import { UnionSquadPicker } from './union-squad';
import type { BattleSettings, DeckState, SimulationResult } from './types';

/** 유니온원 한 명. `GetGuildMembers`가 주는 것만 담는다. */
export interface UnionMember {
  name: string;
  /** `member_id` — 프로필 조회에 쓰는 intl_open_id다. */
  openid: string;
  /** 싱크로 디바이스 레벨. 계산에 그대로 반영한다(400 고정이 아니다). */
  synchro: number;
  /** 계정 레벨. 화면 참고용이다. */
  level: number;
  /** `bind_area_id` — 서버. 스펙 조회에 넣어야 5개 서버를 다 뒤지지 않는다. */
  area: number;
}

/** 공개여부 스캔 결과. */
export type MemberState = 'unknown' | 'scanning' | 'public' | 'private' | 'error';

export interface MemberRow extends UnionMember {
  state: MemberState;
  /** 공개일 때 계산기가 다루는 니케 수. */
  owned?: number;
  /** 비공개·오류일 때 사람에게 보여 줄 한 줄. */
  note?: string;
  /** 계산에 넣을지. 공개인 사람만 켤 수 있다. */
  picked: boolean;
  /**
   * 이 사람에게 어느 보스를 맡길지. 보스 번호(0~4) → 켬/끔이고, 안 적힌 보스는 켠 것으로 친다.
   * 풍압엔 강한데 전격엔 약한 사람이 있어서, 보스별로 사람을 갈라 맡길 수 있어야 한다.
   */
  bossPicks?: Record<number, boolean>;
}

/** 보스 한 칸. 체크를 끄면 그 보스는 통째로 건너뛴다. */
export interface BossSlot {
  name: string;
  code: string;
  enabled: boolean;
  battle?: BattleSettings;
  /** 코드가 잘못됐을 때의 사유. */
  error?: string;
  decks: DeckSlot[];
}

/** 덱 한 칸. 니케 이름 다섯만 쓴다 — 수치는 유니온원 각자의 것을 쓴다. */
export interface DeckSlot {
  code: string;
  squad?: string[];
  error?: string;
}

/**
 * 보스 칸 수.
 *
 * 유니온 레이드의 보스는 다섯이지만 **여섯 칸**을 둔다. 모든 단계를 깬 뒤 다섯 번째
 * 보스가 «무한 단계»(체력 상한 없음)로 열리고, 그때는 유니온원 전원이 그 하나만 친다.
 * 회차 표에서도 그 칸이 따로 한 줄을 차지한다(공회 배정표의 «철1·철2»가 그것이다).
 * 다섯 번째와 같은 랩처지만 조건과 편성을 따로 잡으므로 칸을 나눠 둔다.
 *
 * 안 쓰는 칸은 비워 두면 그만이고, 판 코드(NK4)는 채운 칸 수만 싣는다 —
 * 다섯 칸 시절의 코드도 그대로 읽힌다.
 */
export const BOSS_SLOTS = 6;
export const DECK_SLOTS = 3;

/**
 * 명단을 뜨는 한 줄. 유니온 스퀘어에 **로그인한 채로** 콘솔에 붙여넣으면
 * 명단 JSON이 클립보드에 담긴다. 여기서 하는 일은 그 페이지가 이미 하는 호출 하나뿐이고,
 * 쿠키는 브라우저가 알아서 싣는다 — 우리가 받아 보관하는 값이 아니다.
 */
/**
 * 클립보드가 둘 다 막혔을 때 페이지에 띄우는 상자. 두 스니펫이 같이 쓴다.
 *
 * 닫는 길을 **눈에 보이게** 둔다 — Esc만 두면 상자 밖을 눌러 포커스를 잃은 사람은
 * 닫을 방법이 없다(실제로 그런 제보가 왔다). ✕ 단추, Esc, 바깥 누르기 셋 다 받는다.
 */
const COPY_BOX = `
  const wrap = document.createElement('div');
  wrap.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:rgba(2,7,13,.72);display:flex;align-items:center;justify-content:center');
  const card = document.createElement('div');
  card.setAttribute('style', 'width:90%;max-width:900px;background:#0b1420;border:2px solid #45d6d0;padding:12px;box-shadow:0 20px 60px rgba(0,0,0,.5)');
  const head = document.createElement('div');
  head.setAttribute('style', 'display:flex;align-items:center;gap:10px;margin-bottom:8px;color:#cfeceb;font:700 13px system-ui,sans-serif');
  const title = document.createElement('span');
  title.textContent = '要貼進計算機的內容 — Ctrl+A → Ctrl+C';
  const close = document.createElement('button');
  close.textContent = '✕';
  close.setAttribute('style', 'margin-left:auto;width:30px;height:30px;cursor:pointer;background:transparent;border:1px solid rgba(146,176,201,.4);color:#cfeceb;font:700 14px system-ui,sans-serif');
  close.title = '關閉 (Esc)';
  head.appendChild(title); head.appendChild(close);
  const holder = document.createElement('textarea');
  holder.value = text;
  holder.setAttribute('style', 'width:100%;height:52vh;padding:10px;font:12px ui-monospace,monospace;background:#03090f;color:#e8f1f8;border:1px solid rgba(146,176,201,.25);resize:vertical');
  card.appendChild(head); card.appendChild(holder); wrap.appendChild(card);
  document.body.appendChild(wrap);
  holder.focus(); holder.select();
  try { document.execCommand('copy'); } catch (e) {}
  const shut = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); shut(); } };
  close.addEventListener('click', shut);
  wrap.addEventListener('mousedown', (ev) => { if (ev.target === wrap) shut(); });
  document.addEventListener('keydown', onKey, true);
`;

export const MEMBER_SNIPPET = `await (async () => {
  const call = async (route, body) => (await fetch('https://api.blablalink.com/api/game/proxy/' + route, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Channel-Type': '2', 'X-Language': 'ko',
      'X-Common-Params': JSON.stringify({ game_id: '29080', area_id: 'global', source: 'pc_web', intl_game_id: '29080', language: 'ko', env: 'prod' }) },
    body: JSON.stringify(body),
  })).json();
  const mine = await call('Game/GetMyGuildInfo', { latest: false });
  const box = mine.data || {};
  const info = box.card || box.guild_info || box.guild_detail || box;
  if (!info.guild_id) { console.error('找不到聯盟:', mine.msg || mine.code, '— 請在登入狀態下於聯盟廣場執行。'); return; }
  const members = await call('Game/GetGuildMembers', { guild_id: String(info.guild_id), nikke_area_id: String(info.nikke_area_id || '') });
  const items = (members.data || {}).items || [];
  if (!items.length) { console.error('名單是空的:', members.msg || members.code); return; }
  const text = JSON.stringify({ guild_name: info.guild_name, items: items });
  const done = (how) => console.log(info.guild_name + ' · 聯盟成員 ' + items.length + ' 人' + how);
  try { copy(text); done('已複製到剪貼簿,請貼進計算機。'); return; } catch (e) {}
  try { await navigator.clipboard.writeText(text); done('已複製到剪貼簿,請貼進計算機。'); return; } catch (e) {}
  // 클립보드가 둘 다 막히면(콘솔에 포커스가 있으면 그렇다) 페이지에 상자를 띄우고
  // 내용을 통째로 골라 둔다 — 브라우저마다 이름이 다른 우클릭 메뉴를 찾을 필요가 없다.
  ${COPY_BOX}
  done('已顯示在頁面對話框中。請用 Ctrl+A → Ctrl+C 複製後貼進計算機,再用 ✕ 或 Esc 關閉。');
})();`;

/**
 * 직접 긁기 스니펫. **저희 프록시를 거치지 않고** 지휘관님 세션으로 유니온원 스펙을
 * 그대로 받아 온다. 이 길이 따로 있어야 하는 이유는 하나다 —
 * 「유니온원에게만 공개」로 둔 사람은 우리 프록시 계정(그 유니온 소속이 아니다)이
 * 영원히 못 본다. 같은 유니온인 지휘관님 브라우저만 볼 수 있다.
 *
 * 200종 상세를 32명치 받으면 12MB가 넘는다. 계산에 쓰는 칸만 남기고(26%) gzip으로
 * 눌러 base64로 옮긴다 — 한 명에 9KB, 32명이면 300KB쯤이라 붙여넣기로 옮길 수 있다.
 */
export const DIRECT_SNIPPET = `await (async () => {
  const call = async (route, body) => (await fetch('https://api.blablalink.com/api/game/proxy/' + route, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Channel-Type': '2', 'X-Language': 'ko',
      'X-Common-Params': JSON.stringify({ game_id: '29080', area_id: 'global', source: 'pc_web', intl_game_id: '29080', language: 'ko', env: 'prod' }) },
    body: JSON.stringify(body),
  })).json();
  const gap = (ms) => new Promise((done) => setTimeout(done, ms));

  const mine = await call('Game/GetMyGuildInfo', { latest: false });
  const box0 = mine.data || {};
  const info = box0.card || box0.guild_info || box0.guild_detail || box0;
  if (!info.guild_id) { console.error('找不到聯盟:', mine.msg || mine.code); return; }
  const list = await call('Game/GetGuildMembers', { guild_id: String(info.guild_id), nikke_area_id: String(info.nikke_area_id || '') });
  const roster = (list.data || {}).items || [];
  if (!roster.length) { console.error('名單是空的:', list.msg || list.code); return; }

  const PARTS = ['head', 'torso', 'arm', 'leg'];
  const KEEP = ['name_code', 'skill1_lv', 'skill2_lv', 'ulti_skill_lv', 'favorite_item_tid',
    'favorite_item_lv', 'harmony_cube_tid', 'harmony_cube_lv'];
  for (const part of PARTS) {
    KEEP.push(part + '_equip_tier', part + '_equip_lv',
      part + '_equip_option1_id', part + '_equip_option2_id', part + '_equip_option3_id');
  }
  const slimDetail = (detail) => {
    const out = {};
    for (const key of KEEP) if (detail[key]) out[key] = detail[key];
    return out;
  };

  const members = [];
  for (let i = 0; i < roster.length; i += 1) {
    const person = roster[i];
    const area = person.bind_area_id;
    const row = { name: person.nickname, openid: String(person.member_id),
      synchro: person.synchro_level || 0, level: person.level || 0, area: area, state: 'private' };
    try {
      await gap(500);
      const chars = await call('Game/GetUserCharacters', { intl_open_id: row.openid, nikke_area_id: area });
      const characters = chars.code === 0 ? ((chars.data || {}).characters || []) : [];
      if (characters.length === 0) {
        row.note = chars.msg || String(chars.code || '');
      } else {
        const codes = characters.map((c) => c.name_code);
        const details = [], effects = [];
        for (let at = 0; at < codes.length; at += 60) {
          await gap(500);
          const chunk = await call('Game/GetUserCharacterDetails',
            { intl_open_id: row.openid, nikke_area_id: area, name_codes: codes.slice(at, at + 60) });
          const data = chunk.data || {};
          for (const d of data.character_details || []) details.push(slimDetail(d));
          for (const e of data.state_effects || []) {
            const first = (e.function_details || [])[0] || {};
            effects.push({ id: e.id, function_details: [{ function_type: first.function_type, function_value: first.function_value }] });
          }
        }
        let outpost = null;
        try {
          await gap(500);
          const info2 = await call('Game/GetUserProfileOutpostInfo', { intl_open_id: row.openid, nikke_area_id: area });
          const got = (info2.data || {}).outpost_info;
          if (got) outpost = { recycle_room_researches: (got.recycle_room_researches || []).map((r) => ({ tid: r.tid, lv: r.lv })), synchro_level: got.synchro_level };
        } catch (e) {}
        row.state = 'public';
        row.profile = { openid: row.openid, areas: [{ area: area,
          characters: characters.map((c) => ({ name_code: c.name_code, grade: c.grade, core: c.core })),
          details: details, stateEffects: effects, outpost: outpost }] };
      }
    } catch (e) { row.state = 'error'; row.note = String(e).slice(0, 80); }
    members.push(row);
    console.log((i + 1) + '/' + roster.length + ' ' + row.name + ' · ' + (row.state === 'public' ? '公開' : row.state === 'error' ? '錯誤' : '未公開'));
  }

  const packed = JSON.stringify({ v: 1, guild_name: info.guild_name, members: members });
  let text = packed;
  if (typeof CompressionStream === 'function') {
    const gz = new Blob([packed]).stream().pipeThrough(new CompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(gz).arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    text = 'NKU1-' + btoa(binary);
  }
  const open = members.filter((m) => m.state === 'public').length;
  const done = (how) => console.log('聯盟成員 ' + members.length + ' 人(公開 ' + open + ' 人)' + how);
  try { copy(text); done('已複製到剪貼簿,請貼進計算機。'); return; } catch (e) {}
  try { await navigator.clipboard.writeText(text); done('已複製到剪貼簿,請貼進計算機。'); return; } catch (e) {}
  ${COPY_BOX}
  done('已顯示在頁面對話框中。請用 Ctrl+A → Ctrl+C 複製後貼進計算機,再用 ✕ 或 Esc 關閉。');
})();`;

/** 직접 긁어 온 유니온원 한 명. `profile`은 `areaToOverrides`가 그대로 먹는 모양이다. */
export interface DirectMember {
  name: string;
  openid: string;
  synchro: number;
  level: number;
  area: number;
  state: 'public' | 'private' | 'error';
  note?: string;
  profile?: { openid: string; areas: unknown[] };
}

/** 직접 긁기 결과를 푼다. `NKU1-`은 gzip+base64, 아니면 날 JSON이다. */
export async function parseDirectScan(text: string): Promise<DirectMember[]> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('貼上的內容是空的。');
  let json = trimmed;
  if (trimmed.startsWith('NKU1-')) {
    try {
      const binary = atob(trimmed.slice(5));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      json = await new Response(stream).text();
    } catch {
      throw new Error('無法解開直接抓取的資料。請確認複製時是否中途被截斷。');
    }
  }
  let box: { members?: unknown };
  try {
    box = JSON.parse(json) as { members?: unknown };
  } catch {
    throw new Error('無法辨識直接抓取的資料。請把程式碼片段給的內容整份貼上。');
  }
  const rows = Array.isArray(box.members) ? box.members : [];
  const out: DirectMember[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, any>;
    const openid = String(row.openid ?? '').trim();
    const name = String(row.name ?? '').trim();
    if (!name || !/^\d+$/.test(openid)) continue;
    out.push({
      name,
      openid,
      synchro: num(row.synchro, 0),
      level: num(row.level, 0),
      area: num(row.area, 0),
      state: row.state === 'public' ? 'public' : row.state === 'error' ? 'error' : 'private',
      note: typeof row.note === 'string' && row.note ? row.note : undefined,
      profile: row.profile,
    });
  }
  if (out.length === 0) throw new Error('在直接抓取的資料裡找不到聯盟成員。');
  return out;
}

const num = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * 붙여넣은 것을 명단으로 읽는다. 받아들이는 모양 셋:
 *   `{data:{items:[...]}}`  — API 응답 그대로 (스니펫이 주는 것)
 *   `{items:[...]}` / `[...]` — 안쪽만 떼어 온 경우
 *   탭·쉼표로 나눈 표 — 손으로 정리해 온 경우 (이름, openid, 싱크로)
 * 사람이 옮겨 붙이다 어디까지 집었는지 알 수 없으니, 셋 다 받아 준다.
 */
export function parseMemberList(text: string): UnionMember[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('貼上的內容是空的。');

  let items: unknown[] | null = null;
  try {
    const raw = JSON.parse(trimmed) as unknown;
    if (Array.isArray(raw)) items = raw;
    else if (raw && typeof raw === 'object') {
      const box = raw as Record<string, any>;
      if (box.code !== undefined && box.code !== 0 && !box.data) {
        throw new Error(`Blablalink 回傳了 «${box.msg ?? box.code}»。請在登入狀態下重新抓取。`);
      }
      const found = box.data?.items ?? box.items ?? box.data?.members ?? box.members;
      if (Array.isArray(found)) items = found;
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Blablalink')) throw error;
    items = null;                                  // JSON이 아니면 표로 읽어 본다
  }

  if (items) {
    const rows = items
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({
        name: String(item.nickname ?? item.name ?? '').trim(),
        openid: String(item.member_id ?? item.intl_open_id ?? item.openid ?? '').trim(),
        synchro: num(item.synchro_level ?? item.synchro, 0),
        level: num(item.level, 0),
        area: num(item.bind_area_id ?? item.nikke_area_id ?? item.area, 0),
      }))
      .filter((row) => row.name && /^\d+$/.test(row.openid));
    if (rows.length === 0) throw new Error('在名單裡找不到聯盟成員。請把程式碼片段提示的內容原樣貼上。');
    return dedupe(rows);
  }

  const rows: UnionMember[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const cells = line.split(/\t|,/).map((cell) => cell.trim());
    const openid = cells.find((cell) => /^\d{6,}$/.test(cell));
    const name = cells.find((cell) => cell && cell !== openid);
    if (!openid || !name) continue;
    const numbers = cells.filter((cell) => cell !== openid && /^\d+$/.test(cell)).map(Number);
    rows.push({ name, openid, synchro: numbers[0] ?? 0, level: numbers[1] ?? 0, area: numbers[2] ?? 0 });
  }
  if (rows.length === 0) {
    throw new Error('無法辨識名單。請貼上在聯盟廣場執行下方程式碼片段後得到的結果。');
  }
  return dedupe(rows);
}

const dedupe = (rows: UnionMember[]): UnionMember[] => {
  const seen = new Set<string>();
  return rows.filter((row) => (seen.has(row.openid) ? false : (seen.add(row.openid), true)));
};

/**
 * 공개여부 스캔에 걸리는 시간(초). 실측(2026-08-27, 3명 동시)에서
 * 비공개는 0.7초, 공개는 니케 200종 상세까지 받느라 4~6초였다.
 * 몇 명이 공개인지는 해 봐야 아는 값이라, 절반이 공개라고 보고 어림한다.
 */
export function estimateScanSeconds(count: number, concurrency = 2): number {
  if (count <= 0) return 0;
  const perMember = (0.7 + 5.0) / 2 + 0.7;      // 조회 + 간격 벌리기
  return Math.max(1, Math.round((count * perMember) / concurrency));
}

/** 「1분 20초」처럼 읽히게. 초 단위는 1분 아래에서만 적는다. */
export function humanSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}秒`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes}分` : `${minutes}分${rest}秒`;
}

/** 보스 칸 하나를 코드에서 읽는다. 빈 칸은 조용히 비운다 — 아직 안 채운 것뿐이다. */
export function readBossCode(slot: BossSlot, synchro = DEFAULT_SYNCHRO_LEVEL): BossSlot {
  const code = slot.code.trim();
  if (!code) return { ...slot, battle: undefined, error: undefined };
  try {
    const share = decodeBattleCode(code);
    // 싱크로와 콘솔은 코드에 담기지 않는다(계정 육성 상태다). 유니온원마다 자기 것으로 덮으므로
    // 여기서는 자리만 채워 둔다.
    return {
      ...slot,
      battle: { ...share, synchroLevel: synchro, console: emptyConsole() },
      error: undefined,
    };
  } catch (error) {
    return { ...slot, battle: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 덱 칸 하나를 조합 코드에서 읽는다. 첫 덱만 쓴다 — 이 칸이 곧 덱 하나다. */
export function readDeckCode(slot: DeckSlot, catalogNames: string[]): DeckSlot {
  const code = slot.code.trim();
  if (!code) return { ...slot, squad: undefined, error: undefined };
  try {
    const payload = decodeShareCode(code, catalogNames);
    const squad = (payload.decks[0]?.squad ?? []).map((name) => name.trim());
    const filled = squad.filter(Boolean);
    if (filled.length === 0) return { ...slot, squad: undefined, error: '代碼裡沒有妮姬。' };
    return { ...slot, squad, error: undefined };
  } catch (error) {
    return { ...slot, squad: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 지금 짜 둔 판을 유니온 판 코드(NK4)로 옮길 모양으로 바꾼다.
 *
 * 코드 문자열만 옮긴다 — 해석된 `battle`·`squad`는 코드에서 다시 나오므로 담지 않는다.
 * **유니온원 명단은 여기 들어가지 않는다.** 닉네임과 openid는 남의 계정 정보다.
 */
export function unionShareOf(bosses: BossSlot[]): UnionShare {
  return {
    bosses: bosses.map((boss) => ({
      name: boss.name,
      enabled: boss.enabled,
      battleCode: boss.code,
      deckCodes: boss.decks.map((deck) => deck.code),
    })),
  };
}

/**
 * 받은 판을 보스 칸으로 편다.
 *
 * 코드에 든 보스가 다섯보다 적으면 **남은 칸은 비운다** — 「지난 시즌 것을 통째로
 * 불러온다」는 뜻인데 이전 판의 3·4번 보스가 남아 있으면 섞인 판이 된다.
 */
export function applyUnionShare(
  share: UnionShare,
  catalogNames: string[],
  synchro = DEFAULT_SYNCHRO_LEVEL,
): BossSlot[] {
  return Array.from({ length: BOSS_SLOTS }, (_, index) => {
    const shared = share.bosses[index];
    const decks = Array.from({ length: DECK_SLOTS }, (_, deckIndex) =>
      readDeckCode({ code: shared?.deckCodes[deckIndex] ?? '' }, catalogNames));
    const slot: BossSlot = {
      name: shared?.name ?? '',
      code: shared?.battleCode ?? '',
      // 코드에 없는 칸은 끈 채로 둔다 — 빈 보스가 켜져 있으면 실행 단추가 헷갈린다.
      enabled: shared?.enabled ?? false,
      decks,
    };
    return { ...readBossCode(slot, synchro), decks };
  });
}

/** 지금 판을 코드 한 줄로. 유니온방에 붙여넣으면 그대로 옮겨진다. */
export function unionCodeOf(bosses: BossSlot[]): string {
  return encodeUnionCode(unionShareOf(bosses));
}

/** 받은 코드를 보스 칸으로. 코드가 잘못되면 던진다 — 잡아서 한 줄로 알린다. */
export function readUnionCode(
  code: string,
  catalogNames: string[],
  synchro = DEFAULT_SYNCHRO_LEVEL,
): BossSlot[] {
  return applyUnionShare(decodeUnionCode(code), catalogNames, synchro);
}

/** 시뮬레이션 한 칸. 유니온원 × 보스 × 덱. */
export interface Job {
  member: MemberRow;
  bossIndex: number;
  bossName: string;
  deckIndex: number;
  squad: string[];
  battle: BattleSettings;
}

/**
 * 돌릴 것을 늘어놓는다. 순서는 **유니온원 → 보스 → 덱**이다 — 결과가 사람 단위로
 * 완성돼 가는 편이, 보스별로 흩어져 채워지는 것보다 기다리는 동안 읽을 것이 된다.
 */
export function buildJobs(members: MemberRow[], bosses: BossSlot[]): Job[] {
  const jobs: Job[] = [];
  for (const member of members) {
    if (!member.picked || member.state !== 'public') continue;
    bosses.forEach((boss, bossIndex) => {
      if (!boss.enabled || !boss.battle) return;
      // 아래 보스 체크가 켜져 있어도, 이 사람에게서 뺐으면 돌리지 않는다.
      if (member.bossPicks?.[bossIndex] === false) return;
      boss.decks.forEach((deck, deckIndex) => {
        if (!deck.squad) return;
        jobs.push({
          member,
          bossIndex,
          bossName: boss.name.trim() || `王 ${bossIndex + 1}`,
          deckIndex,
          squad: deck.squad,
          battle: boss.battle!,
        });
      });
    });
  }
  return jobs;
}

/** 한 칸의 결과. 못 돌린 이유도 결과의 하나로 남긴다 — 빈칸은 «왜»를 못 말한다. */
export interface JobResult {
  job: Job;
  damage?: number;
  /** 못 돌렸을 때: 미보유 니케 이름들, 또는 오류 한 줄. */
  missing?: string[];
  error?: string;
}

/**
 * 유니온원의 로스터로 덱을 짠다. 안 가진 니케가 하나라도 있으면 **돌리지 않는다** —
 * 없는 니케를 기본 스펙으로 채워 넣으면 «이 사람이 낼 수 있는 딜»이 아니게 된다.
 */
export function deckForMember(
  squad: string[],
  roster: Record<string, DeckState['characters'][string]>,
  allowDefaults = false,
): { deck: DeckState; missing: string[] } {
  const missing: string[] = [];
  const characters: DeckState['characters'] = {};
  for (const name of squad) {
    if (!name) continue;
    const found = roster[name];
    // `allowDefaults`는 «로스터 자체가 없다»는 뜻이다(개인용인데 CSV를 안 넣은 경우).
    // 그때는 못 가진 게 아니라 **모르는** 것이므로 기본 스펙으로 돌린다.
    if (!found) { if (!allowDefaults) missing.push(name); continue; }
    characters[name] = found;
  }
  return { deck: { id: 1, squad: [...squad], characters }, missing };
}

/** 결과를 화면 뼈대대로 «유니온원 → 보스 → 덱»으로 접는다. */
export interface MemberReport {
  member: MemberRow;
  bosses: Array<{ name: string; rows: JobResult[] }>;
}

export function groupResults(results: JobResult[]): MemberReport[] {
  const byMember = new Map<string, MemberReport>();
  for (const result of results) {
    const key = result.job.member.openid;
    let report = byMember.get(key);
    if (!report) {
      report = { member: result.job.member, bosses: [] };
      byMember.set(key, report);
    }
    let boss = report.bosses.find((entry) => entry.name === result.job.bossName);
    if (!boss) {
      boss = { name: result.job.bossName, rows: [] };
      report.bosses.push(boss);
    }
    boss.rows.push(result);
  }
  for (const report of byMember.values()) {
    for (const boss of report.bosses) boss.rows.sort((a, b) => a.job.deckIndex - b.job.deckIndex);
    report.bosses.sort((a, b) => {
      const ai = a.rows[0]?.job.bossIndex ?? 0;
      const bi = b.rows[0]?.job.bossIndex ?? 0;
      return ai - bi;
    });
  }
  return [...byMember.values()];
}

/**
 * 배정표 한 칸. 공회 배정표(스프레드시트)의 «1·0.5·빈칸» 자리에 실제 수치가 들어간다.
 *
 * 빈칸의 뜻이 둘이라 나눠 적는다 — «안 맡겼다»와 «맡겼지만 못 친다(미보유)»는
 * 배정을 다시 짤 때 완전히 다른 뜻이다.
 */
export interface GridCell {
  /** 그 보스에서 낸 딜. 덱이 여럿이면 가장 높은 것. */
  damage?: number;
  /** 어느 덱이 그 값을 냈는지(0부터). 같은 보스에 덱이 여럿일 때만 뜻이 있다. */
  deckIndex?: number;
  /** 못 친 이유. 미보유 니케 이름들, 또는 오류 한 줄. */
  note?: string;
}

export interface GridRow {
  member: MemberRow;
  /** 보스 칸 번호(0부터) → 그 칸의 결과. 안 맡긴 보스는 아예 없다. */
  cells: Map<number, GridCell>;
  /** 맡은 보스들의 딜 합. 정렬 기본값이다 — 공회가 보고 싶은 것은 «총 기여»다. */
  total: number;
}

export interface Grid {
  /** 실제로 쓰는 보스 칸만, 판에 놓인 순서대로. */
  bosses: Array<{ index: number; name: string }>;
  rows: GridRow[];
}

/**
 * 결과를 «유니온원 × 보스» 표로 접는다.
 *
 * 한 보스에 덱이 셋까지 있는데 표는 칸이 하나다. **가장 높은 것**을 적는다 —
 * 배정표가 답하려는 물음이 「이 사람을 이 보스에 넣으면 얼마나 나오나」이고,
 * 그 답은 그 사람이 낼 수 있는 최선이기 때문이다. 어느 덱이었는지는 함께 남긴다.
 */
export function buildGrid(results: JobResult[], bosses: BossSlot[]): Grid {
  const used = new Map<number, string>();
  const rows = new Map<string, GridRow>();

  for (const result of results) {
    const { member, bossIndex, bossName } = result.job;
    if (!used.has(bossIndex)) used.set(bossIndex, bossName);

    let row = rows.get(member.openid);
    if (!row) {
      row = { member, cells: new Map(), total: 0 };
      rows.set(member.openid, row);
    }
    const cell = row.cells.get(bossIndex) ?? {};
    if (result.damage !== undefined) {
      if (cell.damage === undefined || result.damage > cell.damage) {
        cell.damage = result.damage;
        cell.deckIndex = result.job.deckIndex;
        delete cell.note;                       // 한 덱이라도 되면 «못 친다»가 아니다
      }
    } else if (cell.damage === undefined) {
      cell.note = result.missing ? `缺 ${result.missing.join('、')}` : (result.error ?? '計算失敗');
    }
    row.cells.set(bossIndex, cell);
  }

  for (const row of rows.values()) {
    row.total = [...row.cells.values()]
      .reduce((sum, cell) => sum + (cell.damage ?? 0), 0);
  }

  return {
    // 판에 놓인 순서 그대로 — 사람이 짜 둔 순서가 곧 읽는 순서다.
    bosses: [...used.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, name]) => ({ index, name: name || bosses[index]?.name || `王 ${index + 1}` })),
    rows: [...rows.values()].sort((a, b) => b.total - a.total),
  };
}

/**
 * 표를 스프레드시트에 그대로 붙일 수 있는 글자로. **BOM을 앞에 단다** —
 * 없으면 엑셀이 UTF-8을 못 알아보고 한자·한글이 통째로 깨진다(더블클릭으로 열 때).
 */
export function gridToCsv(grid: Grid): string {
  const quote = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines: string[] = [];
  lines.push(['名稱', '同步器等級', ...grid.bosses.map((boss) => boss.name)].map(quote).join(','));
  for (const row of grid.rows) {
    const cells = grid.bosses.map((boss) => {
      const cell = row.cells.get(boss.index);
      if (!cell) return '';                     // 안 맡긴 보스 — 배정표의 빈칸과 같다
      // 수치는 **날것 그대로** 낸다. 「12.3億」으로 적으면 스프레드시트가 글자로 읽어
      // 합계도 정렬도 안 된다.
      return cell.damage !== undefined ? String(Math.round(cell.damage)) : (cell.note ?? '');
    });
    lines.push([row.member.name, String(row.member.synchro || ''), ...cells].map(quote).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** 시뮬 한 판이 얼마나 걸리는지는 기기마다 달라 **재 보고** 알린다. */
export function remainingSeconds(done: number, total: number, elapsedMs: number): number {
  if (done <= 0) return 0;
  return ((elapsedMs / done) * (total - done)) / 1000;
}

export type Simulate = (squad: string[], characters: DeckState['characters'],
  battle: BattleSettings) => Promise<SimulationResult>;

// ── 화면 ────────────────────────────────────────────────────────────────────

import { areaToOverrides, consoleFrom, emptyConsole, pickArea } from './blablalink';
import type { RawProfile } from './blablalink';
import { requestForDeck } from './model';
import { mountSharePanel, squadPreview, type SharePanel } from './share-panel';
import { summarizeBattle, summarizeSquad, summarizeUnion, type ShareItem, type ShareKind, type ShareServer } from './share-server';
import type { CharacterMeta, CharacterOverrides, SettingsCatalog } from './types';

export interface UnionHosts {
  panel: HTMLElement;
}

export interface UnionDeps {
  /** 블라블라링크 조회 프록시. 비어 있으면 이 탭 자체를 띄우지 않는다. */
  proxy: string;
  settings: SettingsCatalog;
  catalog: CharacterMeta[];
  simulate: (request: ReturnType<typeof requestForDeck>) => Promise<SimulationResult>;
  imageOf: (name: string) => string | undefined;
  /** 정본 이름 → 화면에 적을 이름. 초상화 딱지와 이름 조각에만 쓴다. */
  labelOf: (name: string) => string;
  /** 지금 계산기에 잡아 둔 전투 조건을 코드로. 「가져오기」 단추가 쓴다. */
  currentBattleCode: () => string;
  /** 지금 계산기 덱 하나를 코드로. 인자는 0부터. */
  currentDeckCode: (index: number) => string;
  /** 계산기가 아는 니케 이름 전부 — 조합 코드 해석에 쓴다. */
  catalogNames: () => string[];
  /**
   * 설정 공유 서버. 없으면(주소를 안 잡아 뒀으면) «공유에서 고르기»를 아예 그리지 않는다 —
   * 누를 수 없는 단추를 남겨 두는 쪽이 더 헷갈린다.
   */
  shareServer?: ShareServer | null;
  /** 한 번에 몇 판을 함께 돌릴지(병렬 설정). 1이면 한 판씩. */
  concurrency?: () => number;
  /**
   * 개인용 모드에서 쓰는 «나». 명단·공개여부를 건너뛰고 계산기에 잡아 둔 내 스펙으로
   * 보스×덱을 돈다 — 「남의 딜은 궁금하지 않고 내 것만 보고 싶다」는 요청에서 나왔다.
   */
  me: () => { name: string; synchro: number; console: BattleSettings['console'];
    roster: Record<string, CharacterOverrides>; owned: number };
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const pick = <T extends HTMLElement>(root: HTMLElement, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`聯盟分頁中沒有 ${selector}。`);
  return found;
};

const DAMAGE = new Intl.NumberFormat('ko-KR');

/** 엔진 오류는 파이썬 트레이스백째로 온다 — 줄마다 쏟지 않고 마지막 한 줄만 적는다. */
export function lastLine(message: string): string {
  const lines = message.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? message;
}

/** 조회 시작 사이의 최소 간격(ms). 상류가 «너무 잦다»고 되던지는 선을 피한다. */
const REQUEST_GAP_MS = 700;
/** 실패했을 때 물러서는 간격. 세 번까지 더 해 보고 포기한다. */
const BACKOFF_MS = [1500, 4000, 9000];

/** 유니온 탭 전체를 배선한다. 상태는 이 안에만 산다 — 탭을 떠나도 남는다. */
/** 탭 밖에서 부를 수 있는 손잡이. 지금은 «내 스펙 다시 읽기» 하나뿐이다. */
export interface UnionHandle {
  /**
   * 개인용이면 계산기에 잡아 둔 내 스펙(싱크로·콘솔·로스터)을 다시 읽는다.
   * 탭을 옮겨 다니며 싱크로를 고치는 흐름이 흔한데, 모드를 켤 때 한 번만 읽으면
   * 그 뒤에 바꾼 값이 반영되지 않는다.
   */
  refreshMe(): void;
}

export function mountUnionRaid(hosts: UnionHosts, deps: UnionDeps): UnionHandle {
  const { panel } = hosts;
  let members: MemberRow[] = [];
  let rosters = new Map<string, Record<string, CharacterOverrides>>();
  let consoles = new Map<string, BattleSettings['console']>();
  let bosses: BossSlot[] = Array.from({ length: BOSS_SLOTS }, () => ({
    name: '', code: '', enabled: true,
    decks: Array.from({ length: DECK_SLOTS }, () => ({ code: '' } as DeckSlot)),
  }));
  let results: JobResult[] = [];
  let running = false;
  let cancelled = false;

  // 模式 —— 掃過每個聯盟成員的「聯盟」，和只用自己規格的「個人用」。
  //
  // 成員規格有三條路進來：代理伺服器掃描、瀏覽器自行擷取、以及匯出檔匯入。**只有第一條
  // 需要代理伺服器**，所以沒設代理的部署（不自架伺服器的 fork）仍然可以用「聯盟」，
  // 只是那個掃描按鈕按了一定失敗，所以把它整塊藏起來。
  const canScan = Boolean(deps.proxy);
  let personal = false;
  const modeButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-union-mode]')];
  if (!canScan) {
    const scanBox = panel.querySelector<HTMLElement>('[data-union-scan-box]');
    if (scanBox) scanBox.hidden = true;
  }

  /** 내 로스터를 실제로 가져다 뒀는가. 없으면 개인용은 기본 스펙으로 돈다. */
  const hasMyRoster = () => (rosters.get('me') ? Object.keys(rosters.get('me')!).length > 0 : false);

  /** 계산기에 잡아 둔 내 스펙을 «유니온원 한 명»처럼 세운다 — 뒤 단계가 그대로 돈다. */
  /** 계산기에서 마지막으로 읽어 온 싱크로. 손으로 고친 값과 가려내는 데 쓴다. */
  let lastLoadedSynchro = 0;
  const loadMe = () => {
    const me = deps.me();
    lastLoadedSynchro = me.synchro;
    members = [{
      name: me.name, openid: 'me', synchro: me.synchro, level: 0, area: 0,
      state: 'public', picked: true, owned: me.owned,
      note: me.owned > 0 ? undefined : '沒有帶入規格,以預設規格計算',
    }];
    rosters = new Map([['me', me.roster]]);
    consoles = new Map([['me', me.console]]);
    results = [];
  };

  const setMode = (next: boolean) => {
    // 以前沒有代理伺服器時，這裡會強制退回「個人用」。現在有了匯出檔匯入，
    // 聯盟模式不再綁著代理伺服器，所以按什麼就是什麼。
    personal = next;
    for (const button of modeButtons) {
      const on = (button.dataset.unionMode === 'personal') === personal;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));
    }
    if (personal) loadMe();
    else { members = []; rosters = new Map(); consoles = new Map(); results = []; }
    const unionLede = panel.querySelector<HTMLElement>('[data-union-lede-union]');
    const personalLede = panel.querySelector<HTMLElement>('[data-union-lede-personal]');
    if (unionLede) unionLede.hidden = personal;
    if (personalLede) personalLede.hidden = !personal;
    showStep('1', !personal);
    showStep('2', !personal && members.length > 0);
    showStep('3', personal || members.some((row) => row.state === 'public'));
    renderMembers();
    renderReport();
    refreshRunGate();
  };

  const steps = new Map<string, HTMLElement>();
  for (const step of panel.querySelectorAll<HTMLElement>('[data-union-step]')) {
    steps.set(step.dataset.unionStep!, step);
  }
  const showStep = (id: string, on: boolean) => {
    const step = steps.get(id);
    if (step) step.hidden = !on;
  };

  // ── 1단계 · 명단 ─────────────────────────────────────────────────────────
  const snippetBox = pick<HTMLTextAreaElement>(panel, '[data-union-snippet]');
  const copyButton = pick<HTMLButtonElement>(panel, '[data-union-copy]');
  const pasteBox = pick<HTMLTextAreaElement>(panel, '[data-union-paste]');
  const readButton = pick<HTMLButtonElement>(panel, '[data-union-read]');
  const listStatus = pick(panel, '[data-union-list-status]');
  snippetBox.value = MEMBER_SNIPPET;

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(MEMBER_SNIPPET);
      listStatus.textContent = '已複製。請在 Blablalink 聯盟廣場的主控台(F12)貼上。';
    } catch {
      snippetBox.select();
      listStatus.textContent = '複製被封鎖 — 請自行複製上方對話框的內容。';
    }
  });

  readButton.addEventListener('click', () => {
    try {
      const parsed = parseMemberList(pasteBox.value);
      members = parsed.map((row) => ({ ...row, state: 'unknown', picked: false }));
      results = [];
      renderMembers();
      renderReport();
      showStep('2', true);
      listStatus.textContent = `已讀取 ${members.length} 位聯盟成員。`
        + `確認公開狀態約需 ${humanSeconds(estimateScanSeconds(members.length))}。`;
    } catch (error) {
      listStatus.textContent = error instanceof Error ? error.message : String(error);
    }
  });

  // ── 2단계 · 공개여부 ─────────────────────────────────────────────────────
  const scanButton = pick<HTMLButtonElement>(panel, '[data-union-scan]');
  const scanStop = pick<HTMLButtonElement>(panel, '[data-union-scan-stop]');
  const scanStatus = pick(panel, '[data-union-scan-status]');
  const scanBar = pick(panel, '[data-union-scan-progress]');
  const memberBox = pick(panel, '[data-union-members]');
  const ask = pick(panel, '[data-union-ask]');
  const askText = pick(panel, '[data-union-ask-text]');

  const setBar = (bar: HTMLElement, done: number, total: number) => {
    bar.hidden = total === 0;
    const fill = bar.firstElementChild as HTMLElement | null;
    if (fill) fill.style.width = `${total === 0 ? 0 : Math.round((done / total) * 100)}%`;
  };

  /**
   * 싱크로 칸. 실측 스탯표는 1000까지라 그 위는 이어 붙인 추정치다 — 그 사실을
   * 딜 옆이 아니라 **사람 옆에** 적는다. 왜 이 사람 숫자만 덜 미더운지가 거기서 읽힌다.
   */
  const syncCell = (row: MemberRow): HTMLElement => {
    if (row.synchro <= 0) return el('span', 'union-sync', '同步器 ?');
    const cell = el('span', 'union-sync', `同步器 ${row.synchro}`);
    if (row.synchro > SYNCHRO_MEASURED_MAX) {
      cell.classList.add('is-estimated');
      cell.append(el('b', 'union-est', '推估'));
      cell.title = `實測只到 ${SYNCHRO_MEASURED_MAX} 級為止。`
        + '再往上是沿用同一條成長曲線推算。';
    }
    return cell;
  };

  /**
   * 개인용의 싱크로 칸 — **여기서 바로 고친다.** 값은 계산기 전투 조건에서 가져오지만,
   * 「싱크로만 올리면 얼마나 오르나」를 보려고 오는 자리라 전투 조건 창까지 다녀오게
   * 하면 번거롭다. 고친 값은 이 표를 도는 데만 쓰고 계산기 쪽은 건드리지 않는다.
   */
  const syncInput = (row: MemberRow): HTMLElement => {
    const wrap = el('label', 'union-sync-edit');
    wrap.append(el('span', undefined, '同步器'));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = String(SYNCHRO_MAX);
    input.step = '1';
    input.value = String(row.synchro > 0 ? row.synchro : DEFAULT_SYNCHRO_LEVEL);
    input.dataset.unionSynchro = '';
    input.title = '這是透過 Blablalink 連動取得的帳號同步器(未連動時為戰鬥條件的值)。'
      + ' 在這裡修改的話,只有這張表會用該值計算。'
      + ` 實測到 ${SYNCHRO_MEASURED_MAX} 級為止,再往上是接續推算的估計值。`;
    input.addEventListener('change', () => {
      const next = Math.round(Number(input.value));
      if (!Number.isFinite(next) || next < 1 || next > SYNCHRO_MAX) {
        input.value = String(row.synchro);
        return;
      }
      row.synchro = next;
      renderMembers();
    });
    wrap.append(input);
    if (row.synchro > SYNCHRO_MEASURED_MAX) {
      const mark = el('b', 'union-est', '推估');
      mark.title = `實測只到 ${SYNCHRO_MEASURED_MAX} 級為止。`;
      wrap.append(mark);
    }
    return wrap;
  };

  /**
   * 유니온원 줄 오른쪽의 보스 칩. **아래 보스 체크와 연동한다** — 꺼 둔 보스는 칩 자체가
   * 안 나온다. 여기서 끄면 그 사람만 그 보스를 건너뛴다(풍압은 되는데 전격은 아닌 사람).
   */
  const bossChips = (row: MemberRow): HTMLElement => {
    const wrap = el('div', 'union-boss-picks');
    const live = bosses.filter((boss) => boss.enabled);
    if (live.length === 0 || row.state !== 'public') return wrap;
    bosses.forEach((boss, index) => {
      if (!boss.enabled) return;
      const chip = el('label', 'union-boss-chip');
      const mark = document.createElement('input');
      mark.type = 'checkbox';
      mark.checked = row.bossPicks?.[index] !== false;
      mark.dataset.unionBossPick = String(index);
      const label = boss.name.trim() || `王 ${index + 1}`;
      chip.title = `${row.name} — ${label}`;
      chip.classList.toggle('is-off', !mark.checked);
      mark.addEventListener('change', (event) => {
        event.stopPropagation();
        row.bossPicks = { ...(row.bossPicks ?? {}), [index]: mark.checked };
        chip.classList.toggle('is-off', !mark.checked);
        refreshRunGate();
      });
      chip.append(mark, el('span', '', String(index + 1)));
      wrap.append(chip);
    });
    return wrap;
  };

  function renderMembers(): void {
    memberBox.replaceChildren();
    if (members.length === 0) return;
    const table = el('div', 'union-table');
    for (const row of members) {
      const line = el('label', 'union-row');
      line.dataset.unionMember = row.openid;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = row.picked;
      box.disabled = row.state !== 'public';
      box.addEventListener('change', () => {
        row.picked = box.checked;
        refreshRunGate();
      });
      const state = el('span', `union-state is-${row.state}`, {
        unknown: '未確認', scanning: '確認中', public: '公開', private: '未公開', error: '錯誤',
      }[row.state]);
      // 개인용은 «나» 한 줄뿐이다 — 고를 것도, 공개여부를 따질 것도 없어 아예 안 그린다
      // (`hidden`만으로는 격자 자리가 남아 줄이 어긋난다).
      const owned = row.owned !== undefined && row.owned > 0 ? `妮姬 ${row.owned} 種` : '';
      const note = el('span', 'union-note', [owned, row.note ?? ''].filter(Boolean).join(' · '));
      if (personal) {
        line.classList.add('is-personal');
        line.append(el('span', 'union-name', row.name), syncInput(row), note, bossChips(row));
      } else {
        line.append(box, el('span', 'union-name', row.name), syncCell(row), state, note, bossChips(row));
      }
      table.append(line);
    }
    memberBox.append(table);

    const open = members.filter((row) => row.state === 'public');
    const done = members.filter((row) => row.state !== 'unknown' && row.state !== 'scanning');
    ask.hidden = done.length !== members.length || members.length === 0;
    if (!ask.hidden) {
      askText.textContent = open.length > 0
        ? `要以已公開的 ${open.length} 位聯盟成員做測試嗎?`
        : '沒有已公開的聯盟成員。請把「我的妮姬」改為公開後再掃描一次。';
    }
    refreshRunGate();
  }

  // 호출 간격을 벌리는 문지기. 한 사람을 여는 데 상류 호출이 예닐곱 번 나가서,
  // 그냥 몰아치면 «212000 request too frequently»가 돌아온다(실측 2026-08-27).
  let nextStart = 0;
  const spaced = async (): Promise<void> => {
    const now = Date.now();
    const wait = Math.max(0, nextStart - now);
    nextStart = Math.max(now, nextStart) + REQUEST_GAP_MS;
    if (wait > 0) await new Promise((done) => { setTimeout(done, wait); });
  };

  /**
   * 한 명을 조회한다. 상류가 흔들리거나 «너무 잦다»고 하면 **간격을 벌려 다시** 부른다 —
   * 여럿을 훑는 동안 잠깐 튄 것을 «비공개»로 굳혀 버리면, 실제로 공개한 사람이
   * 계산에서 빠진다. 비공개는 상류가 그렇게 말한 것이므로 다시 부르지 않는다.
   */
  const scanOne = async (row: MemberRow, attempt = 0): Promise<void> => {
    await spaced();
    row.state = 'scanning';
    try {
      const response = await fetch(`${deps.proxy}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileUrl: row.openid,
          ...(row.area > 0 ? { area: row.area } : {}),
        }),
      });
      const payload = await response.json() as RawProfile & { error?: string; reason?: string };
      if (!response.ok) {
        if (payload.reason !== 'private' && attempt < BACKOFF_MS.length) {
          await new Promise((done) => { setTimeout(done, BACKOFF_MS[attempt]); });
          return scanOne(row, attempt + 1);
        }
        row.state = payload.reason === 'private' ? 'private' : 'error';
        row.note = payload.reason === 'private' ? '妮姬清單未公開' : (payload.error ?? `查詢失敗 (${response.status})`);
        return;
      }
      const area = pickArea(payload, row.area > 0 ? row.area : undefined);
      if (!area) { row.state = 'private'; row.note = '妮姬清單是空的'; return; }
      const { overrides, matched } = areaToOverrides(area, deps.settings, deps.catalog);
      if (matched.length === 0) { row.state = 'private'; row.note = '沒有計算機認得的妮姬'; return; }
      rosters.set(row.openid, overrides);
      const levels = consoleFrom(area);
      if (levels) consoles.set(row.openid, levels);
      row.state = 'public';
      row.owned = matched.length;
      // 전초기지가 비공개면 콘솔을 모른다. 0으로 치고 계산하되, 그 사실을 줄에 적는다 —
      // 딜이 낮게 나온 이유가 스펙이 아니라 «못 본 값»일 수 있어서다.
      row.note = levels ? undefined : '主控台未公開 · 以 0 計算';
      row.picked = true;
    } catch (error) {
      if (attempt < BACKOFF_MS.length) {
        await new Promise((done) => { setTimeout(done, BACKOFF_MS[attempt]); });
        return scanOne(row, attempt + 1);
      }
      row.state = 'error';
      row.note = error instanceof Error ? error.message : String(error);
    }
  };

  const runScan = async () => {
    if (running || members.length === 0) return;
    running = true;
    cancelled = false;
    scanButton.disabled = true;
    scanStop.hidden = false;
    const total = members.length;
    let done = 0;
    const started = Date.now();
    const queue = [...members];
    const worker = async () => {
      while (queue.length > 0 && !cancelled) {
        const row = queue.shift()!;
        await scanOne(row);
        done += 1;
        setBar(scanBar, done, total);
        scanStatus.textContent = `${done}/${total} · 剩餘時間約 `
          + humanSeconds(remainingSeconds(done, total, Date.now() - started));
        renderMembers();
      }
    };
    // 둘씩만 동시에 부른다. 셋으로 돌렸더니 공개한 사람이 실패로 튀어 «비공개»로
    // 잘못 잡히는 일이 실제로 났다(2026-08-27). 조금 느려도 맞는 답이 낫다.
    await Promise.all([worker(), worker()]);
    running = false;
    scanButton.disabled = false;
    scanStop.hidden = true;
    const open = members.filter((row) => row.state === 'public').length;
    scanStatus.textContent = cancelled
      ? `已中止 (已確認 ${done}/${total})。`
      : `已確認 ${total} 人 · 公開 ${open} 人 · 耗時 ${humanSeconds((Date.now() - started) / 1000)}。`;
    renderMembers();
    if (open > 0) showStep('3', true);
  };

  scanButton.addEventListener('click', () => { void runScan(); });

  // 직접 긁기 — 저희 프록시를 거치지 않는 길. 「유니온원에게만 공개」는 이쪽으로만 보인다.
  const directSnippet = pick<HTMLTextAreaElement>(panel, '[data-union-direct-snippet]');
  const directCopy = pick<HTMLButtonElement>(panel, '[data-union-direct-copy]');
  const directPaste = pick<HTMLTextAreaElement>(panel, '[data-union-direct-paste]');
  const directRead = pick<HTMLButtonElement>(panel, '[data-union-direct-read]');
  const directStatus = pick(panel, '[data-union-direct-status]');
  directSnippet.value = DIRECT_SNIPPET;

  directCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(DIRECT_SNIPPET);
      directStatus.textContent = '已複製。請在 Blablalink 的主控台(F12)貼上 — 32 人約需 2~3 分鐘。';
    } catch {
      directSnippet.select();
      directStatus.textContent = '複製被封鎖 — 請自行複製上方對話框的內容。';
    }
  });

  directRead.addEventListener('click', () => {
    directStatus.textContent = '解析中…';
    void (async () => {
      try {
        const rows = await parseDirectScan(directPaste.value);
        members = rows.map((row) => ({
          name: row.name, openid: row.openid, synchro: row.synchro, level: row.level, area: row.area,
          state: row.state, picked: false, note: row.note,
        }));
        rosters = new Map();
        consoles = new Map();
        results = [];
        let open = 0;
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index]!;
          const seat = members[index]!;
          if (row.state !== 'public' || !row.profile) continue;
          const area = pickArea(row.profile as never, row.area > 0 ? row.area : undefined);
          if (!area) { seat.state = 'private'; seat.note = '妮姬清單是空的'; continue; }
          const { overrides, matched } = areaToOverrides(area, deps.settings, deps.catalog);
          if (matched.length === 0) { seat.state = 'private'; seat.note = '沒有計算機認得的妮姬'; continue; }
          rosters.set(seat.openid, overrides);
          const levels = consoleFrom(area);
          if (levels) consoles.set(seat.openid, levels);
          seat.owned = matched.length;
          seat.note = levels ? undefined : '主控台未公開 · 以 0 計算';
          seat.picked = true;
          open += 1;
        }
        renderMembers();
        renderReport();
        showStep('2', true);
        if (open > 0) showStep('3', true);
        directStatus.textContent = `已讀取 ${members.length} 位聯盟成員 · 公開 ${open} 人。`
          + '不必掃描伺服器就能直接挑選。';
      } catch (error) {
        directStatus.textContent = error instanceof Error ? error.message : String(error);
      }
    })();
  });

  // 匯出檔匯入 —— 三條路裡唯一不需要任何登入的。每位成員各自匯出一個檔案交出來，
  // 指揮官一次全部拖進來。設「僅對聯盟成員公開」甚至完全不公開的人也算得到，
  // 因為資料是他自己給的，不是我們去查的。
  const fileInput = pick<HTMLInputElement>(panel, '[data-union-files]');
  const fileDrop = pick<HTMLElement>(panel, '[data-union-drop]');
  const fileStatus = pick(panel, '[data-union-file-status]');

  /**
   * 讀進來的檔案 → 成員表。
   *
   * `openid` 這裡沒有真的 openid（那是 blablalink 的東西），拿暱稱當代號。
   * 後面每一步都只把它當成「這一列是誰」的鍵，不會拿去查詢，所以夠用。
   */
  const takeFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    fileStatus.textContent = `讀取中… (${files.length} 個檔案)`;
    try {
      const texts = await Promise.all(files.map(async (file) => ({
        name: file.name, text: await file.text(),
      })));
      const { profiles, failed } = parseExiaBatch(texts, deps.settings);

      members = [];
      rosters = new Map();
      consoles = new Map();
      results = [];
      let usable = 0;

      for (const profile of profiles) {
        const { overrides, matched } = areaToOverrides(profile.raw, deps.settings, deps.catalog);
        const seat: MemberRow = {
          name: profile.name,
          openid: `file:${profile.name}`,
          synchro: profile.synchro || DEFAULT_SYNCHRO_LEVEL,
          level: 0,
          area: profile.area,
          state: matched.length > 0 ? 'public' : 'error',
          owned: matched.length,
          picked: matched.length > 0,
          note: matched.length > 0
            ? (profile.notes.length > 0 ? profile.notes.join(' ') : undefined)
            : '檔案裡沒有計算機認得的妮姬',
        };
        members.push(seat);
        if (matched.length === 0) continue;
        rosters.set(seat.openid, overrides);
        const levels = consoleFrom(profile.raw);
        if (levels) consoles.set(seat.openid, levels);
        usable += 1;
      }

      // 讀不起來的檔案也留一列。靜靜地少一個人，會讓人以為那個人的檔案傳丟了。
      for (const bad of failed) {
        members.push({
          name: bad.file, openid: `bad:${bad.file}`, synchro: 0, level: 0, area: 0,
          state: 'error', picked: false, note: bad.reason,
        });
      }

      renderMembers();
      renderReport();
      showStep('2', true);
      if (usable > 0) showStep('3', true);
      refreshRunGate();

      const parts = [`已讀取 ${usable} 人`];
      if (failed.length > 0) parts.push(`${failed.length} 個檔案讀不起來`);
      fileStatus.textContent = `${parts.join(' · ')}。`;
    } catch (error) {
      fileStatus.textContent = error instanceof Error ? error.message : String(error);
    }
  };

  /** 選檔和拖放走同一條路。拖放要擋掉瀏覽器預設的「直接開啟檔案」。 */
  const wireDrop = (
    zone: HTMLElement, input: HTMLInputElement, take: (files: File[]) => void,
  ): void => {
    input.addEventListener('change', () => {
      take([...(input.files ?? [])]);
      input.value = '';                 // 清空才能重選同一個檔案時仍然觸發 change
    });
    for (const type of ['dragenter', 'dragover'] as const) {
      zone.addEventListener(type, (event) => {
        event.preventDefault();
        zone.classList.add('is-over');
      });
    }
    for (const type of ['dragleave', 'drop'] as const) {
      zone.addEventListener(type, () => zone.classList.remove('is-over'));
    }
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      take([...(event.dataTransfer?.files ?? [])]);
    });
  };

  wireDrop(fileDrop, fileInput, (files) => { void takeFiles(files); });

  // 清洗工具 —— 傳檔之前用的。瀏覽器改不了硬碟上的原檔，所以這裡是「另存一份乾淨的」。
  const washInput = pick<HTMLInputElement>(panel, '[data-union-wash-files]');
  const washDrop = pick<HTMLElement>(panel, '[data-union-wash-drop]');
  const washStatus = pick(panel, '[data-union-wash-status]');

  const washFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return;
    let done = 0;
    const bad: string[] = [];
    for (const file of files) {
      try {
        const clean = stripExiaProfile(await file.text());
        const url = URL.createObjectURL(new Blob([clean], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name.replace(/(\.json)?$/i, '-clean.json');
        link.click();
        // 給瀏覽器一點時間真的開始存檔，再放掉這個網址。
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        done += 1;
      } catch {
        bad.push(file.name);
      }
    }
    washStatus.textContent = bad.length === 0
      ? `已清洗 ${done} 個檔案並下載。傳這些 -clean.json 就好。`
      : `已清洗 ${done} 個。讀不起來的：${bad.join('、')}`;
  };

  wireDrop(washDrop, washInput, (files) => { void washFiles(files); });

  scanStop.addEventListener('click', () => { cancelled = true; });
  pick<HTMLButtonElement>(panel, '[data-union-pick-all]').addEventListener('click', () => {
    for (const row of members) row.picked = row.state === 'public';
    renderMembers();
  });
  pick<HTMLButtonElement>(panel, '[data-union-pick-none]').addEventListener('click', () => {
    for (const row of members) row.picked = false;
    renderMembers();
  });

  // ── 3단계 · 보스와 덱 ────────────────────────────────────────────────────
  const bossBox = pick(panel, '[data-union-bosses]');

  // 視覺排隊器。판은 **하나뿐**이고 겨눈 덱 줄 아래로 옮겨 다닌다 — 덱 줄이 열다섯이라
  // 줄마다 격자를 그리면 니케 200명이 열다섯 벌 깔린다.
  const picker = new UnionSquadPicker({
    catalog: deps.catalog,
    labelOf: deps.labelOf,
    imageOf: deps.imageOf,
    onRedraw: () => renderBosses(),
  });

  // ── 공유에서 고르기 ──────────────────────────────────────────────────────
  // 보스 조건·덱·판 전체가 같은 목록 구조를 쓰므로 창 하나에 판 셋을 얹고 필요한 것만
  // 보인다. 「어디에 넣을지」는 창을 열 때 정하고, 아래 콜백들이 그 값을 읽는다.
  type ShareTarget =
    | { kind: 'boss'; boss: number }
    | { kind: 'squad'; boss: number; deck: number }
    | { kind: 'union' };

  const shareModal = panel.querySelector<HTMLElement>('[data-union-share-modal]');
  const sharePanels = new Map<ShareKind, SharePanel>();
  const shareHosts = new Map<ShareKind, HTMLElement>();
  let shareTarget: ShareTarget = { kind: 'union' };
  let openSharePicker: ((target: ShareTarget) => void) | null = null;

  const shareMsg = shareModal?.querySelector<HTMLElement>('[data-union-share-msg]') ?? null;
  const notifyShare = (message: string, ok = false): void => {
    if (!shareMsg) return;
    shareMsg.textContent = message;
    shareMsg.hidden = message === '';
    shareMsg.classList.toggle('is-ok', ok);
  };

  /** 지금 그 칸에 있는 것을 「올리기」 탭에 넘긴다. 창을 열 때 정한 자리를 본다. */
  const currentFor = (kind: ShareKind): { code: string; auto: string } => {
    if (kind === 'union') {
      return { code: unionCodeOf(bosses), auto: summarizeUnion(unionShareOf(bosses).bosses) };
    }
    if (kind === 'boss' && shareTarget.kind === 'boss') {
      const boss = bosses[shareTarget.boss];
      return {
        code: boss?.code ?? '',
        auto: boss?.battle ? summarizeBattle(boss.battle) : '無條件',
      };
    }
    if (kind === 'squad' && shareTarget.kind === 'squad') {
      const deck = bosses[shareTarget.boss]?.decks[shareTarget.deck];
      return {
        code: deck?.code ?? '',
        auto: summarizeSquad([{ squad: deck?.squad ?? [] }], false),
      };
    }
    return { code: '', auto: '' };
  };

  /** 목록에서 고른 것을 그 자리에 넣는다. 코드가 깨졌으면 던져서 창이 알리게 둔다. */
  const applyShared = (kind: ShareKind, item: ShareItem): void => {
    if (kind === 'union') {
      bosses = readUnionCode(item.code, deps.catalogNames(), DEFAULT_SYNCHRO_LEVEL);
      renderBosses();
      renderMembers();
      notifyShare(`已鋪上 «${item.name}» 盤面。`, true);
      return;
    }
    if (kind === 'boss' && shareTarget.kind === 'boss') {
      const at = shareTarget.boss;
      const boss = bosses[at];
      if (!boss) return;
      bosses[at] = { ...readBossCode({ ...boss, code: item.code }), decks: boss.decks };
      const failed = bosses[at]!.error;
      renderBosses();
      if (failed) throw new Error(failed);
      notifyShare(`已把 «${item.name}» 條件填入王 ${at + 1} 格。`, true);
      return;
    }
    if (kind === 'squad' && shareTarget.kind === 'squad') {
      const { boss: at, deck: deckAt } = shareTarget;
      const boss = bosses[at];
      if (!boss) return;
      boss.decks[deckAt] = readDeckCode({ code: item.code }, deps.catalogNames());
      const failed = boss.decks[deckAt]!.error;
      renderBosses();
      if (failed) throw new Error(failed);
      notifyShare(`已把 «${item.name}» 填入王 ${at + 1} 的第 ${deckAt + 1} 隊。`, true);
    }
  };

  if (shareModal && deps.shareServer) {
    const server = deps.shareServer;
    const body = pick(shareModal, '[data-union-share-body]');
    const title = pick(shareModal, '[data-union-share-title]');
    const desc = pick(shareModal, '[data-union-share-desc]');

    const closeShare = (): void => { shareModal.hidden = true; };
    pick<HTMLButtonElement>(shareModal, '[data-union-share-close]')
      .addEventListener('click', closeShare);
    shareModal.addEventListener('click', (event) => {
      if (event.target === shareModal) closeShare();
    });

    for (const kind of ['boss', 'squad', 'union'] as ShareKind[]) {
      const host = el('div', 'union-share-host');
      host.hidden = true;
      const tabs = el('div', 'share-tabs');
      const upload = el('div', 'share-pane');
      const list = el('div', 'share-pane');
      const code = el('div', 'share-pane');
      host.append(tabs, upload, list, code);
      body.append(host);
      shareHosts.set(kind, host);

      sharePanels.set(kind, mountSharePanel({ tabs, upload, list, code }, {
        kind,
        server,
        // 코드 칸은 보스·덱 칸에 이미 나와 있다 — 창 안에 또 두지 않는다.
        tabs: ['upload', 'list'],
        current: () => currentFor(kind),
        apply: (item) => applyShared(kind, item),
        notify: notifyShare,
        preview: kind === 'squad' ? (item) => {
          try {
            const payload = decodeShareCode(item.code, deps.catalogNames());
            const squads = payload.decks
              .map((entry) => entry.squad.filter((name) => name.trim() !== ''))
              .filter((squad) => squad.length > 0);
            return squads.length > 0 ? squadPreview(squads, deps.imageOf, deps.labelOf) : null;
          } catch {
            return null;
          }
        } : undefined,
      }));
    }

    const LABELS: Record<ShareKind, { title: string; desc: string }> = {
      boss: {
        title: '選擇王的條件',
        desc: '這些是別人上傳的<b>戰鬥條件</b>。選取後會原樣填入這個王格 — 同步器與主控台不會包含在內,因此各聯盟成員仍使用自己的值。',
      },
      squad: {
        title: '選擇組合',
        desc: '這些是別人上傳的<b>組合</b>。選取後會填入這個隊伍格 — 只包含編成了誰,數值仍使用各聯盟成員自己的。',
      },
      union: {
        title: '選擇聯盟突襲盤面',
        desc: '這是把五個王與各格的隊伍<b>整個盤面</b>一起收錄的內容。選取後會覆蓋目前排好的盤面。<b>聯盟成員名單不會包含在內。</b>',
      },
    };

    openSharePicker = (target: ShareTarget): void => {
      shareTarget = target;
      title.textContent = LABELS[target.kind].title;
      desc.innerHTML = LABELS[target.kind].desc;
      for (const [kind, host] of shareHosts) host.hidden = kind !== target.kind;
      notifyShare('');
      shareModal.hidden = false;
      sharePanels.get(target.kind)?.open();
    };
  }

  // ── 판 코드 (NK4) ────────────────────────────────────────────────────────
  const setStatus = pick(panel, '[data-union-set-status]');
  const setBox = pick(panel, '[data-union-set-box]');
  const setCode = pick<HTMLTextAreaElement>(panel, '[data-union-set-code]');

  const sayBoard = (message: string, ok = false): void => {
    setStatus.textContent = message;
    setStatus.classList.toggle('is-ok', ok);
  };

  pick<HTMLButtonElement>(panel, '[data-union-set-copy]').addEventListener('click', async () => {
    const code = unionCodeOf(bosses);
    setBox.hidden = false;
    setCode.value = code;
    try {
      await navigator.clipboard.writeText(code);
      sayBoard('已複製盤面代碼。直接貼到聯盟群即可。', true);
    } catch {
      setCode.select();
      sayBoard('自動複製被封鎖,已為你選取代碼。請用 Ctrl+C 複製。');
    }
  });

  pick<HTMLButtonElement>(panel, '[data-union-set-paste]').addEventListener('click', () => {
    setBox.hidden = false;
    setCode.value = '';
    setCode.focus();
    sayBoard('貼上收到的盤面代碼(NK4-…)後,按「套用此盤面」。');
  });

  pick<HTMLButtonElement>(panel, '[data-union-set-apply]').addEventListener('click', () => {
    try {
      bosses = readUnionCode(setCode.value, deps.catalogNames(), DEFAULT_SYNCHRO_LEVEL);
      renderBosses();
      renderMembers();
      const live = bosses.filter((boss) => boss.enabled).length;
      sayBoard(`已鋪上盤面 — 共 ${live} 個王。`, true);
      setBox.hidden = true;
    } catch (error) {
      sayBoard(error instanceof Error ? error.message : String(error));
    }
  });

  pick<HTMLButtonElement>(panel, '[data-union-set-close]').addEventListener('click', () => {
    setBox.hidden = true;
    sayBoard('');
  });

  const setShare = panel.querySelector<HTMLButtonElement>('[data-union-set-share]');
  if (setShare) {
    if (openSharePicker) {
      const open = openSharePicker;
      setShare.addEventListener('click', () => open({ kind: 'union' }));
    } else {
      setShare.hidden = true;
    }
  }

  function renderBosses(): void {
    bossBox.replaceChildren();
    bosses.forEach((boss, index) => {
      const card = el('div', 'union-boss');
      if (!boss.enabled) card.classList.add('is-off');

      const head = el('div', 'union-boss-head');
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = boss.enabled;
      toggle.title = '關閉後這個王不會納入計算';
      toggle.addEventListener('change', () => {
        boss.enabled = toggle.checked;
        renderBosses();
        renderMembers();       // 줄 오른쪽 칩이 보스 체크를 따라간다
      });
      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'union-boss-name';
      name.placeholder = `王 ${index + 1} 名稱`;
      name.value = boss.name;
      name.addEventListener('input', () => {
        boss.name = name.value;
        refreshRunGate();
        for (const chip of memberBox.querySelectorAll<HTMLElement>('.union-boss-chip')) {
          const at = Number(chip.querySelector<HTMLInputElement>('[data-union-boss-pick]')?.dataset.unionBossPick);
          if (at === index) chip.title = `${chip.title.split(' — ')[0]} — ${boss.name.trim() || `王 ${index + 1}`}`;
        }
      });
      head.append(toggle, name, el('span', 'union-boss-summary', battleSummary(boss)));
      card.append(head);

      const codeRow = el('div', 'union-code-row');
      const code = document.createElement('input');
      code.type = 'text';
      code.className = 'union-code';
      code.placeholder = '戰鬥條件代碼 (NK3-…)';
      code.value = boss.code;
      code.addEventListener('input', () => {
        bosses[index] = { ...readBossCode({ ...boss, code: code.value }), decks: boss.decks };
        boss = bosses[index]!;
        renderBosses();
      });
      const grab = el('button', 'roster-import', '目前條件');
      (grab as HTMLButtonElement).type = 'button';
      grab.title = '直接帶入計算機裡設定的戰鬥條件';
      grab.addEventListener('click', () => {
        bosses[index] = { ...readBossCode({ ...boss, code: deps.currentBattleCode() }), decks: boss.decks };
        renderBosses();
      });
      codeRow.append(code, grab);
      if (openSharePicker) {
        const open = openSharePicker;
        const fromShare = el('button', 'roster-import', '從分享選取');
        (fromShare as HTMLButtonElement).type = 'button';
        fromShare.title = '從別人上傳的王條件清單中挑選';
        fromShare.addEventListener('click', () => open({ kind: 'boss', boss: index }));
        codeRow.append(fromShare);
      }
      card.append(codeRow);
      if (boss.error) card.append(el('p', 'union-error', boss.error));

      const deckBox = el('div', 'union-decks');
      boss.decks.forEach((deck, deckIndex) => {
        const row = el('div', 'union-deck');
        row.append(el('p', 'union-deck-label', `第 ${deckIndex + 1} 隊`));

        // 視覺排隊 —— 點頭像放入。代碼欄仍在下面的「代碼」摺疊裡，因為盤面碼(NK4)
        // 是靠它組出來的，而且貼別人給的組合代碼還是最快的路。
        const slots = el('div', 'union-slots');
        // **먼저 붙이고 그린다.** 판은 `host.after(...)`로 이 줄 아래에 끼어드는데,
        // 아직 부모가 없는 동안 그리면 그 호출이 조용히 아무 일도 하지 않는다.
        row.append(slots);
        picker.renderSlots(slots, `${index}-${deckIndex}`, deck.squad ?? [], (squad) => {
          // 이름 다섯을 코드로 되돌려 둔다 — 판 코드(NK4)와 «지금 무엇이 들어 있나»의
          // 정본이 둘로 갈리면 어느 쪽이 맞는지 알 수 없게 된다.
          const filled = squad.filter(Boolean);
          boss.decks[deckIndex] = filled.length > 0
            ? readDeckCode({ code: encodeShareCode(
              [{ id: 1, squad: [...squad], characters: {} } as DeckState], false) },
            deps.catalogNames())
            : { code: '', squad: undefined, error: undefined };
          renderBosses();
        });

        const tools = el('div', 'union-deck-tools');
        const take = el('button', 'roster-import', `帶入計算機第 ${deckIndex + 1} 隊`);
        (take as HTMLButtonElement).type = 'button';
        take.title = '直接帶入計算機裡目前排好的這一隊';
        take.addEventListener('click', () => {
          boss.decks[deckIndex] = readDeckCode({ code: deps.currentDeckCode(deckIndex) }, deps.catalogNames());
          renderBosses();
        });
        tools.append(take);
        if (openSharePicker) {
          const open = openSharePicker;
          const fromShare = el('button', 'roster-import', '從分享選取');
          (fromShare as HTMLButtonElement).type = 'button';
          fromShare.title = '從別人上傳的組合清單中挑選';
          fromShare.addEventListener('click', () =>
            open({ kind: 'squad', boss: index, deck: deckIndex }));
          tools.append(fromShare);
        }
        if (deck.squad) {
          const clear = el('button', 'roster-import', '清空');
          (clear as HTMLButtonElement).type = 'button';
          clear.addEventListener('click', () => {
            boss.decks[deckIndex] = { code: '', squad: undefined, error: undefined };
            renderBosses();
          });
          tools.append(clear);
        }
        row.append(tools);

        const codeFold = document.createElement('details');
        codeFold.className = 'union-deck-code';
        const codeSummary = document.createElement('summary');
        codeSummary.textContent = '組合代碼 (NK2-)';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'union-code';
        input.placeholder = `第 ${deckIndex + 1} 隊組合代碼 (NK2-…)`;
        input.value = deck.code;
        input.addEventListener('input', () => {
          boss.decks[deckIndex] = readDeckCode({ code: input.value }, deps.catalogNames());
          renderBosses();
        });
        codeFold.append(codeSummary, input);
        row.append(codeFold);

        if (deck.error) row.append(el('p', 'union-error', deck.error));
        deckBox.append(row);
      });
      card.append(deckBox);
      bossBox.append(card);
    });
    refreshRunGate();
  }

  const battleSummary = (boss: BossSlot): string => {
    if (!boss.battle) return '無條件';
    const parts = [`${boss.battle.duration}秒`, boss.battle.enemyCode || '無屬性',
      `防禦 ${DAMAGE.format(boss.battle.enemyDef)}`];
    const decks = boss.decks.filter((deck) => deck.squad).length;
    parts.push(decks > 0 ? `${decks} 隊` : '無隊伍');
    return parts.join(' · ');
  };

  // ── 4단계 · 실행 ─────────────────────────────────────────────────────────
  const runButton = pick<HTMLButtonElement>(panel, '[data-union-run]');
  const runStop = pick<HTMLButtonElement>(panel, '[data-union-stop]');
  const runStatus = pick(panel, '[data-union-run-status]');
  const runBar = pick(panel, '[data-union-run-progress]');
  const reportBox = pick(panel, '[data-union-report]');
  const gridBox = pick(panel, '[data-union-grid]');

  function refreshRunGate(): void {
    const jobs = buildJobs(members, bosses);
    const ready = jobs.length > 0 && !running;
    runButton.disabled = !ready;
    showStep('4', jobs.length > 0 || results.length > 0);
    if (!running) {
      const people = new Set(jobs.map((job) => job.member.openid)).size;
      runStatus.textContent = jobs.length === 0
        ? (personal ? '要先填好王與隊伍才能執行。' : '要有選取的聯盟成員與王・隊伍才能執行。')
        : (personal
          ? `將執行 ${jobs.length} 盤 — 等於王・隊伍的組合數。`
          : `將執行 ${jobs.length} 盤 — 聯盟成員 ${people} 人 × 王・隊伍。`);
    }
  }

  const runAll = async () => {
    // 개인용은 돌리기 직전에 내 스펙을 다시 읽는다 — 그 사이 싱크로나 로스터를
    // 바꿨을 수 있고, 그때 화면에 적힌 값과 계산이 어긋나면 안 된다.
    if (personal) { loadMe(); renderMembers(); }
    const jobs = buildJobs(members, bosses);
    if (jobs.length === 0 || running) return;
    running = true;
    cancelled = false;
    runButton.disabled = true;
    runStop.hidden = false;
    results = [];
    renderReport();
    const started = Date.now();
    let done = 0;
    const runJob = async (job: Job) => {
      const roster = rosters.get(job.member.openid) ?? {};
      const { deck, missing } = deckForMember(job.squad, roster, personal && !hasMyRoster());
      if (missing.length > 0) {
        results.push({ job, missing });
      } else {
        try {
          const battle: BattleSettings = {
            ...job.battle,
            // 싱크로와 콘솔은 **그 사람 것**을 쓴다 — 400 고정이 아니다.
            synchroLevel: job.member.synchro > 0 ? job.member.synchro : job.battle.synchroLevel,
            console: consoles.get(job.member.openid) ?? job.battle.console,
          };
          const result = await deps.simulate(requestForDeck(deck, battle));
          results.push({ job, damage: result.squadTotal });
        } catch (error) {
          results.push({ job, error: lastLine(error instanceof Error ? error.message : String(error)) });
        }
      }
      done += 1;
      setBar(runBar, done, jobs.length);
      runStatus.textContent = `${done}/${jobs.length} · ${job.member.name} · ${job.bossName} `
        + `· 剩餘時間約 ${humanSeconds(remainingSeconds(done, jobs.length, Date.now() - started))}`;
      renderReport();     // 도착 순서와 무관하게 사람→보스→덱으로 다시 세운다
    };
    // 판마다 서로 독립이라 나눠 돌려도 결과가 같다. 여기가 병렬로 가장 크게 덕을 보는
    // 자리다 — 유니온원 × 보스 × 덱이라 수십 판이 쌓인다.
    const lanes = Math.max(1, Math.trunc(deps.concurrency?.() ?? 1));
    const queue = [...jobs];
    const lane = async () => {
      while (queue.length > 0 && !cancelled) await runJob(queue.shift()!);
    };
    await Promise.all(Array.from({ length: Math.min(lanes, jobs.length) }, lane));
    running = false;
    runStop.hidden = true;
    runButton.disabled = false;
    // 문지기가 «몇 판을 돌립니다»로 되돌리기 전에 부르고, 마무리 문구를 마지막에 적는다.
    refreshRunGate();
    runStatus.textContent = cancelled
      ? `已中止 (${results.length}/${jobs.length} 盤)。`
      : `${jobs.length} 盤已在 ${humanSeconds((Date.now() - started) / 1000)} 內完成。`;
  };

  runButton.addEventListener('click', () => { void runAll(); });
  runStop.addEventListener('click', () => { cancelled = true; });

  /**
   * 배정표 — 공회가 실제로 보는 모양. 줄이 사람, 칸이 보스다.
   *
   * 아래의 «사람 한 장씩» 보고서는 그대로 둔다. 표는 «누구를 어디에 넣나»를 정하는
   * 자리이고, 카드는 «왜 그 숫자인가»(어느 덱, 무엇이 없어서 못 치나)를 보는 자리다.
   */
  function renderGrid(): void {
    gridBox.replaceChildren();
    if (results.length === 0) return;
    const grid = buildGrid(results, bosses);
    if (grid.bosses.length === 0) return;

    const head = el('div', 'union-grid-head');
    head.append(el('h4', undefined, '分配表'));
    const save = el('button', 'roster-import', '下載 Excel (CSV)');
    (save as HTMLButtonElement).type = 'button';
    save.title = '下載後可直接用 Excel 開啟,或貼進現有的分配表';
    save.addEventListener('click', () => {
      const blob = new Blob([gridToCsv(grid)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const day = new Date().toISOString().slice(0, 10);
      link.download = `聯盟突襲分配表_${day}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
    head.append(save);
    gridBox.append(head);

    const table = document.createElement('table');
    table.className = 'union-grid';
    const thead = document.createElement('thead');
    const hrow = document.createElement('tr');
    for (const label of ['名稱', '同步器', ...grid.bosses.map((boss) => boss.name)]) {
      const th = document.createElement('th');
      th.textContent = label;
      hrow.append(th);
    }
    thead.append(hrow);
    table.append(thead);

    const tbody = document.createElement('tbody');
    for (const row of grid.rows) {
      const tr = document.createElement('tr');
      const name = document.createElement('th');
      name.scope = 'row';
      name.textContent = row.member.name;
      tr.append(name);
      const sync = document.createElement('td');
      sync.className = 'union-grid-sync';
      sync.textContent = row.member.synchro ? String(row.member.synchro) : '';
      tr.append(sync);
      for (const boss of grid.bosses) {
        const td = document.createElement('td');
        const cell = row.cells.get(boss.index);
        if (!cell) {
          // 안 맡긴 보스. 배정표의 빈칸과 같은 뜻이라 비워 둔다.
          td.className = 'union-grid-off';
        } else if (cell.damage !== undefined) {
          td.className = 'union-grid-num';
          td.textContent = DAMAGE.format(Math.round(cell.damage));
        } else {
          td.className = 'union-grid-miss';
          td.textContent = cell.note ?? '—';
          td.title = cell.note ?? '';
        }
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    gridBox.append(table);
  }

  function renderReport(): void {
    renderGrid();
    reportBox.replaceChildren();
    for (const report of groupResults(results)) {
      const card = el('div', 'union-report-card');
      const head = el('div', 'union-report-head');
      head.append(el('b', 'union-report-name', report.member.name),
        el('span', 'union-report-sync', `同步器 ${report.member.synchro}`));
      card.append(head);
      for (const boss of report.bosses) {
        card.append(el('h4', 'union-report-boss', boss.name));
        for (const row of boss.rows) {
          const line = el('div', 'union-report-row');
          line.append(squadPreview([row.job.squad.filter(Boolean)], deps.imageOf, deps.labelOf));
          if (row.damage !== undefined) {
            line.append(el('b', 'union-report-damage', DAMAGE.format(Math.round(row.damage))));
          } else if (row.missing) {
            line.append(el('span', 'union-report-skip', `未持有 · ${row.missing.join(', ')}`));
          } else {
            line.append(el('span', 'union-report-skip', row.error ?? '計算失敗'));
          }
          card.append(line);
        }
      }
      reportBox.append(card);
    }
  }

  for (const button of modeButtons) {
    button.addEventListener('click', () => setMode(button.dataset.unionMode === 'personal'));
  }

  renderBosses();
  // 開起來就停在「聯盟」。匯出檔匯入不需要代理伺服器，所以沒設代理也一樣從這裡開始。
  setMode(false);

  return {
    refreshMe() {
      if (!personal) return;
      // 여기서 손으로 고쳐 둔 싱크로가 있으면 그것을 존중한다 — 계산기 값으로
      // 되돌리면 방금 적어 넣은 숫자가 탭을 옮길 때마다 지워진다.
      const edited = members[0]?.synchro;
      loadMe();
      const fresh = members[0];
      if (fresh && edited !== undefined && edited > 0 && edited !== lastLoadedSynchro) {
        fresh.synchro = edited;
      }
      lastLoadedSynchro = fresh?.synchro ?? lastLoadedSynchro;
      renderMembers();
    },
  };
}
