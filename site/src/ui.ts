import { ResultCache, type StorageLike, type StorageSource } from './cache';
import { renderCharacterSettings, type CharPanelKind } from './character-settings';
import {
  BLABLA_SERVERS,
  areaToOverrides,
  blablaServerLabel,
  consoleFrom,
  looksLikeProfileUrl,
  pickArea,
  synchroFrom,
  type RawProfile,
} from './blablalink';
import { parseRosterCsv } from './csv-import';
import {
  formatEok,
  loadEnikkComps,
  WEAKNESS_KO,
  type EnikkImport,
  type EnikkPlayer,
} from './enikk';
import { buildIndex, filterByQuery } from './nikke-search';
import {
  buildAddPrompt,
  CUSTOM_KEY,
  customToMeta,
  customToSettings,
  loadCustom,
  parseCustomInput,
  unsupportedEffects,
} from './custom-nikke';
import {
  canvasToBlob,
  copyImage,
  downloadImage,
  loadPortraits,
  renderReport,
  reportFilename,
  type ReportMeta,
} from './report';
import { csvBlob, csvFileName, csvText, damageCsv } from './export-csv';
import {
  applyShareToDecks, decodeBattleCode, decodeShareCode, encodeBattleCode, encodeShareCode,
} from './share-code';
import { LATEST_NOTICE_ID, NOTICES, noticeFragment, noticeToShow } from './notices';
import { mountSharePanel, squadPreview, type SharePanel } from './share-panel';
import { startPresence } from './presence';
import { mountUnionRaid, type UnionHandle } from './union-raid';
import { EXTERNAL_LINKS, hostOf } from './external-links';
import { termZh, FILTER_TITLE_ZH } from './i18n-terms';
import { statName } from './stat-names';
import {
  BURST_STAGES,
  candidatesFor, cycleLine, cyclesFromTimeline, estimateCycles, HOTKEYS, MAX_CYCLES,
  picksFrom, progressOf, sequenceForDeck, sequenceFrom, stepKey, stepsFor, trimSequence,
  type BurstStage, type BurstStep,
} from './burst-order';
import { ShareServer, summarizeBattle, summarizeSquad } from './share-server';
import { createTimelineBlock } from './timeline';

// 화면 표시용 이름 해석기 — mountCalculator에서 catalog로 채운다.
// 그 전(모듈 로드 직후)에는 원래 이름을 그대로 돌려준다.
let resolveDisplayName = (name: string): string => name;

/**
 * 엔진이 만든 이탈 보고에 적힌 이름을 화면 이름으로. 블록은 그대로 두고
 * **`[이름]`만** 바꾼다 — 엔진 키 경로(`console.class_level.화력형`)는 데이터다.
 */
const shownDeviations = (text: string): string =>
  text.replace(/\[([^\][\n]+)\]/g, (whole, name: string) => {
    const shown = resolveDisplayName(name);
    return shown === name ? whole : `[${shown}]`;
  });
import {
  aggregateDeckResults,
  cacheKey,
  DEFAULT_BURST_REACTION,
  DEFAULT_SYNCHRO_LEVEL,
  SYNCHRO_MAX,
  SYNCHRO_MEASURED_MAX,
  formatDamage,
  formatDps,
  formatExactDamage,
  formatExactDps,
  requestForDeck,
  resetEnemy,
  validateDecks,
  validateRequest,
} from './model';
import type {
  BatchResult,
  BattleSettings,
  BuffTargetRow,
  CombatPowerRequest,
  ElementWindow,
  PhaseWindow,
  RngMode,
  CharacterMeta,
  CharacterOverrides,
  DeckResultEntry,
  DeckState,
  SettingsCatalog,
  SimulationRequest,
  SimulationResult,
} from './types';

const DEFAULT_SQUAD = ['리타', '크라운', '라피 : 레드 후드', '앨리스', '나가'];

export interface CalculatorClientLike {
  prepare(): Promise<void>;
  simulate(request: SimulationRequest): Promise<SimulationResult>;
  /** 목록 정렬용 전투력. 없는 구현(테스트 대역)도 있어 선택으로 둔다. */
  combatPower?(request: CombatPowerRequest): Promise<Record<string, number>>;
  /** 병렬 계산. 풀이 아닌 구현(테스트 대역·워커 하나)도 있어 전부 선택으로 둔다. */
  setPoolSize?(size: number): void;
  defaultPoolSize?(): number;
  maxPoolSize?: number;
  dispose(): void;
}

interface CalculatorDependencies {
  catalog: CharacterMeta[];
  settings: SettingsCatalog;
  version: string;
  client: CalculatorClientLike;
  storage: StorageSource;
  // 완전 초기화는 저장소를 비운 뒤 페이지를 다시 띄워 메모리 상태까지 확실히
  // 되돌린다. 테스트에서는 이 자리에 가짜 함수를 넣는다.
  reload?: () => void;
  /** 테스트·자체 호스팅에서 빌드 환경값 대신 쓸 BlablaLink 프록시 주소. */
  blablaProxy?: string;
}

const element = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`找不到畫面元素:${selector}`);
  return found;
};

const createText = (tag: keyof HTMLElementTagNameMap, value: string, className?: string) => {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
};

// 속성(코드) 아이콘 — 그림은 `image/icon/icon-code-*.png`가 정본이다.
// 직접 추가한 니케가 목록에 없는 코드를 쓰면 조용히 아이콘을 생략한다.
const ELEMENT_ICON: Record<string, string> = {
  작열: 'fire', 수냉: 'water', 풍압: 'wind', 전격: 'electronic', 철갑: 'iron',
};

const createElementIcon = (elementCode: string, className: string): HTMLElement | null => {
  const slug = ELEMENT_ICON[elementCode];
  if (!slug) return null;
  const icon = document.createElement('span');
  icon.className = `${className} element-icon is-${slug}`;
  // 그림만으로는 속성을 못 읽는 사람이 있어 이름을 붙인다 — 화면 말로 붙여야 한다.
  icon.title = termZh(elementCode);
  icon.ariaLabel = termZh(elementCode);
  return icon;
};

// Pyodide 오류는 긴 파이썬 트레이스백으로 온다. 마지막 줄(실제 오류 메시지)만 보여준다.
const cleanEngineError = (raw: string): string => {
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? raw;
  return last.length <= 300 ? last : `${last.slice(0, 300)}…`;
};

function initialSquad(catalog: CharacterMeta[]): string[] {
  const available = new Set(catalog.map((char) => char.name));
  const defaults = DEFAULT_SQUAD.filter((name) => available.has(name));
  const fallback = catalog.map((char) => char.name).filter((name) => !defaults.includes(name));
  return [...defaults, ...fallback].slice(0, 5);
}

const emptyDeck = (id: number): DeckState => ({
  id,
  squad: ['', '', '', '', ''],
  characters: {},
});

/** 딜 1·2위 이름. 순서는 그대로 두고 «표시»만 얹기 위해 이름만 뽑는다. */
function topScorers(entry: DeckResultEntry): Map<string, number> {
  const ranked = [...new Set(entry.request.squad)]
    .map((name) => [name, entry.result.charTotals[name] ?? 0] as const)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  return new Map(ranked.slice(0, 2).map(([name], index) => [name, index + 1]));
}

/**
 * 캐릭터별 결과 줄. 초상화 오른쪽에 막대와 총딜이 선다 — 덱을 갈아 가며 볼 때는
 * 카드보다 이쪽이 짧고, 막대 길이로 «누가 캐리했나»가 곧바로 읽힌다.
 * 여기서도 **편성 순서 그대로**이고, 딜 1·2위는 뱃지와 테두리로만 표시한다.
 */
/** 대미지를 어떻게 적을지. 「자세히 보기」로 갈린다 — 값이 아니라 표기만 바뀐다. */
interface DamageFormat {
  dmg(value: number): string;
  dps(value: number): string;
}

function renderCharacterRows(
  container: HTMLElement,
  entry: DeckResultEntry,
  imageOf: (name: string) => string | undefined,
  fmt: DamageFormat,
): void {
  const rows = document.createElement('div');
  rows.className = 'result-rows';
  const tops = topScorers(entry);
  const best = Math.max(...entry.request.squad.map((name) => entry.result.charTotals[name] ?? 0), 0);

  for (const name of entry.request.squad) {
    const value = entry.result.charTotals[name] ?? 0;
    const share = entry.result.squadTotal > 0 ? value / entry.result.squadTotal * 100 : 0;
    const rank = tops.get(name);
    const row = document.createElement('article');
    row.className = 'character-result result-row'
      + (rank === 1 ? ' is-first' : rank === 2 ? ' is-second' : '');
    row.dataset.characterResult = name;
    if (rank) row.dataset.dmgRank = String(rank);

    const portrait = document.createElement('div');
    portrait.className = 'result-row-face';
    const source = imageOf(name);
    if (source) {
      const image = document.createElement('img');
      image.src = source;
      image.alt = '';
      image.loading = 'lazy';
      portrait.append(image);
    }
    if (rank) portrait.append(createText('b', String(rank), 'result-rank-badge'));
    row.append(portrait);

    const body = document.createElement('div');
    body.className = 'result-row-body';
    const head = document.createElement('p');
    head.className = 'result-row-name';
    head.append(
      createText('b', resolveDisplayName(name)),
      createText('span', `${share.toFixed(1)}% · ${fmt.dps(value / entry.result.duration)}`),
    );
    const track = document.createElement('div');
    track.className = 'share-track';
    const bar = document.createElement('i');
    bar.style.width = `${best > 0 ? Math.max(2, value / best * 100) : 2}%`;
    track.append(bar);
    body.append(head, track);
    row.append(body);

    row.append(createText('strong', Math.round(value).toLocaleString('ko-KR'), 'result-row-total'));
    rows.append(row);
  }
  container.append(rows);
}

/**
 * 캐릭터별 결과 카드. **편성 순서 그대로** 왼쪽에서 오른쪽으로 선다 — 위 편성 카드와
 * 자리가 맞아야 «누가 얼마나»를 눈으로 그대로 잇는다. 딜 1·2위는 자리를 옮기지 않고
 * 뱃지와 테두리로만 표시한다.
 */
function renderCharacterCards(
  container: HTMLElement,
  entry: DeckResultEntry,
  imageOf: (name: string) => string | undefined,
  fmt: DamageFormat,
): void {
  const grid = document.createElement('div');
  grid.className = 'result-cards';
  const tops = topScorers(entry);
  const best = Math.max(...entry.request.squad.map((name) => entry.result.charTotals[name] ?? 0), 0);

  for (const name of entry.request.squad) {
    const value = entry.result.charTotals[name] ?? 0;
    const share = entry.result.squadTotal > 0 ? value / entry.result.squadTotal * 100 : 0;
    const rank = tops.get(name);
    const card = document.createElement('article');
    card.className = 'character-result result-card'
      + (rank === 1 ? ' is-first' : rank === 2 ? ' is-second' : '');
    card.dataset.characterResult = name;
    if (rank) card.dataset.dmgRank = String(rank);

    const portrait = document.createElement('div');
    portrait.className = 'result-card-face';
    const source = imageOf(name);
    if (source) {
      const image = document.createElement('img');
      image.src = source;
      image.alt = '';
      image.loading = 'lazy';
      portrait.append(image);
    }
    if (rank) portrait.append(createText('b', `第 ${rank} 名`, 'result-rank-badge'));
    card.append(portrait);

    card.append(createText('h3', resolveDisplayName(name)));
    card.append(createText('span', `${share.toFixed(1)}% 貢獻`, 'result-card-share'));
    card.append(createText('strong', fmt.dmg(value)));
    card.append(createText('small', fmt.dps(value / entry.result.duration)));

    const track = document.createElement('div');
    track.className = 'share-track';
    const bar = document.createElement('i');
    // 막대는 «1위 대비»로 그린다 — 기여%로 그리면 다섯이 다 짧아 차이가 안 보인다.
    bar.style.width = `${best > 0 ? Math.max(2, value / best * 100) : 2}%`;
    track.append(bar);
    card.append(track);

    // 평타/스킬 분해와 스킬별 내역. 카드가 좁으니 접어 둔다.
    const breakdown = entry.result.charBreakdown?.[name];
    if (breakdown && value > 0) {
      const details = document.createElement('details');
      details.className = 'dmg-split';
      details.dataset.dmgSplit = '';
      const normalPct = breakdown.normal / value * 100;
      const skillPct = breakdown.skill / value * 100;
      const summary = document.createElement('summary');
      summary.append(createText('span', `普攻 ${normalPct.toFixed(0)}%`, 'legend-normal'));
      summary.append(createText('span', `技能 ${skillPct.toFixed(0)}%`, 'legend-skill'));
      details.append(summary);

      const splitTrack = document.createElement('div');
      splitTrack.className = 'split-track';
      const normalBar = document.createElement('i');
      normalBar.className = 'split-normal';
      normalBar.style.width = `${normalPct}%`;
      const skillBar = document.createElement('i');
      skillBar.className = 'split-skill';
      skillBar.style.width = `${skillPct}%`;
      splitTrack.append(normalBar, skillBar);
      details.append(splitTrack);

      const legend = document.createElement('p');
      legend.className = 'split-legend';
      legend.append(
        createText('span', `普攻 ${fmt.dmg(breakdown.normal)}`, 'legend-normal'),
        createText('span', `技能 ${fmt.dmg(breakdown.skill)}`, 'legend-skill'),
      );
      details.append(legend);

      if (breakdown.skills.length > 0) {
        const list = document.createElement('ul');
        list.className = 'skill-breakdown';
        for (const skill of breakdown.skills) {
          const item = document.createElement('li');
          item.append(
            createText('span', skill.name),
            createText('span', `${fmt.dmg(skill.damage)} · ${(skill.damage / value * 100).toFixed(1)}% · ${skill.hits} 命中`),
          );
          list.append(item);
        }
        details.append(list);
      }
      card.append(details);
    }
    grid.append(card);
  }
  container.append(grid);
}

// 블라블라링크 조회 프록시. 빌드 때 `VITE_BLABLA_PROXY`로 박히고, 비어 있으면 연동 UI를
// 그리지 않는다 — 프록시 없이 브라우저에서 직접 부르면 CORS와 로그인 세션 두 가지가 동시에
// 막아 반드시 실패한다(`worker/README.md`).
const BLABLA_PROXY = (import.meta.env.VITE_BLABLA_PROXY ?? '').trim().replace(/\/+$/, '');
// 설정 공유 서버(`worker-share/`). 비어 있으면 공유 모달이 코드 주고받기만 그린다 —
// 서버 없이 부르면 반드시 실패하므로 탭을 만들어 두는 쪽이 더 헷갈린다.
const SHARE_API = (import.meta.env.VITE_SHARE_API ?? '').trim().replace(/\/+$/, '');

export function mountCalculator(root: HTMLElement, deps: CalculatorDependencies): () => void {
  const { catalog, settings, version, client, storage, reload } = deps;
  const blablaProxy = (deps.blablaProxy ?? BLABLA_PROXY).trim().replace(/\/+$/, '');
  /** 유니온 탭 손잡이. 프록시가 없어 탭을 안 만든 배포에서는 끝까지 비어 있다. */
  let unionHandle: UnionHandle | null = null;
  const cache = new ResultCache(storage, version, 30);
  const catalogByName = new Map(catalog.map((char) => [char.name, char]));
  resolveDisplayName = (name) => catalogByName.get(name)?.displayName ?? name;
  const decks = Array.from({ length: 5 }, (_, index) => emptyDeck(index + 1));
  decks[0]!.squad = initialSquad(catalog);
  let activeDeckId = 1;
  let activeSlot = 0;
  /**
   * 「니케 고르기」 판을 펴 두었는가. **기본은 접힘**이다 — 고를 상황이 아니면 볼 일이
   * 없는 판인데 늘 펴 두면 화면을 차지하고, 마우스를 가운데 두고 굴리다 목록만
   * 스크롤되는 일이 생긴다. 칸을 누르면 펴지고, 빈 곳을 누르거나 Esc면 접힌다.
   */
  let pickerOpen = false;
  // 겨냥한 칸을 화면으로 끌어오는 것은 **사용자가 칸을 바꿨을 때만** 한다.
  // 결과가 도착해도 편성은 다시 그려지는데, 그때마다 끌어오면 결과를 보던 사람이
  // 편성 쪽으로 튕겨 올라간다.
  let pullActiveSlot = false;
  // 다른 덱에 만들어 둔 개별 설정을 편성할 때 따라오게 할지. 기본은 켬이다.
  let carryOverSettings = true;
  let fiveDeckMode = false;
  let activity: 'preparing' | 'ready' | 'running' | 'complete' | 'cached' | 'error' = 'preparing';

  const ROSTER_KEY = 'nikke-roster-v1';
  const resolveStorage = (): StorageLike | null => {
    const source = typeof storage === 'function' ? storage() : storage;
    return source ?? null;
  };
  // jsdom에는 scrollIntoView가 없다. 화면을 끌어오는 건 편의라, 없는 환경에서는
  // 건너뛰어도 렌더가 깨지지 않는다 — 직접 부르면 테스트가 처리되지 않은 오류로 끊긴다.
  const scrollTo = (el: HTMLElement) => {
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  };

  const cloneOverride = (value: object): CharacterOverrides =>
    JSON.parse(JSON.stringify(value)) as CharacterOverrides;
  // 예전 판(육성 프로필 불러오기)이 저장한 오버로드는 값이 **줄별 배열**일 수 있다.
  // 지금은 스칼라만 다루므로 합계로 옮긴다 — 두면 요약을 그릴 때 toFixed에서 끊긴다.
  const migrateOverloadLines = (overrides: CharacterOverrides | undefined) => {
    const overload = overrides?.overload as Record<string, unknown> | undefined;
    if (!overload) return;
    for (const [key, value] of Object.entries(overload)) {
      if (Array.isArray(value)) {
        overload[key] = value.reduce((sum: number, v) => sum + (Number(v) || 0), 0);
      }
    }
  };

  const loadRoster = (): Record<string, CharacterOverrides> => {
    try {
      const raw = resolveStorage()?.getItem(ROSTER_KEY);
      const stored = raw ? (JSON.parse(raw) as Record<string, CharacterOverrides>) : {};
      for (const overrides of Object.values(stored)) migrateOverloadLines(overrides);
      return stored;
    } catch {
      return {};
    }
  };
  const saveRoster = () => {
    try {
      resolveStorage()?.setItem(ROSTER_KEY, JSON.stringify(roster));
    } catch {
      /* 저장 실패는 무시 (용량·프라이빗 모드 등) */
    }
  };
  let roster = loadRoster();

  // 임의 니케(커스텀). localStorage에만 저장되고 요청마다 엔진에 주입된다.
  const customChars = loadCustom((key) => resolveStorage()?.getItem(key) ?? null);
  const saveCustom = () => {
    try {
      resolveStorage()?.setItem(CUSTOM_KEY, JSON.stringify(customChars));
    } catch {
      /* 무시 */
    }
  };
  const registerCustom = (name: string) => {
    const custom = customChars[name];
    if (!custom) return;
    if (!catalogByName.has(name)) {
      const meta = customToMeta(custom);
      catalog.push(meta);
      catalogByName.set(name, meta);
    }
    settings.characters[name] = customToSettings(custom);
  };
  const customPayload = (): Record<string, { nikke: Record<string, unknown>; skills: unknown[] }> =>
    Object.fromEntries(Object.entries(customChars).map(([n, c]) => [n, { nikke: c.nikke, skills: c.skills }]));

  // 편성·설정·전투 조건을 localStorage에 저장해 새로고침해도 마지막 상태로 복원한다.
  const STATE_KEY = 'nikke-state-v1';
  interface SavedState {
    decks: DeckState[];
    fiveDeckMode: boolean;
    activeDeckId: number;
    /** 다른 덱의 개별 설정을 편성할 때 이어받을지. 옛 저장본에는 없다. */
    carryOverSettings: boolean;
    battle: BattleSettings;
    buffTargets: Array<{ id: number; sig: string; rows: Record<string, BuffTargetRow[]> }>;
  }
  // 큐브 이름이 짧은 통칭에서 인게임 정식 명칭으로 바뀌었다. 이전 버전에서 저장된
  // 편성에는 옛 이름이 남아 있어 그대로 두면 엔진이 요청을 거부한다. 불러올 때 한 번
  // 옮겨주고, 카탈로그에 없는 이름은 캐릭터 기본값으로 되돌아가도록 지운다.
  const LEGACY_CUBE_NAMES: Record<string, string> = {
    재장: '렐릭 베어 큐브',
    탄충: '택티컬 베어 큐브',
    체력: '렐릭 비고르 큐브',
    차속: '렐릭 부스트 큐브',
    파츠: '렐릭 디스트로이 큐브',
    분배: '렐릭 디바이드 큐브',
  };
  const migrateSavedCubes = (state: Partial<SavedState>): Partial<SavedState> => {
    for (const deck of state.decks ?? []) {
      for (const overrides of Object.values(deck.characters ?? {})) {
        const cube = overrides.cube;
        if (!cube) continue;
        const renamed = LEGACY_CUBE_NAMES[cube.name];
        if (renamed) cube.name = renamed;
        if (!settings.cubes[cube.name]) delete overrides.cube;
      }
      for (const overrides of Object.values(deck.characters ?? {})) migrateOverloadLines(overrides);
    }
    return state;
  };
  const loadSavedState = (): Partial<SavedState> | null => {
    try {
      const raw = resolveStorage()?.getItem(STATE_KEY);
      return raw ? migrateSavedCubes(JSON.parse(raw) as Partial<SavedState>) : null;
    } catch {
      return null;
    }
  };
  const savedState = loadSavedState();
  // 실제 구현은 refs·readBattle이 준비된 뒤 할당한다. 그전 호출은 no-op.
  let saveState: () => void = () => undefined;

  root.innerHTML = `
    <div class="site-shell">
      <p class="site-notice"><a href="https://gall.dcinside.com/mgallery/board/view/?id=gov&amp;no=6038781" target="_blank" rel="noreferrer">查看說明、詢問、意見回饋、鼓勵的話都往這裡 →</a></p>
      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">BROWSER SIM <span>·</span> 60 FPS TIMELINE</p>
          <h1><span>NIKKE</span> 隊伍計算機</h1>
          <p class="hero-lede">依各角色的超載、魔方與戰鬥條件,以每幀為單位計算預期傷害。</p>
          <div class="trust-row" aria-label="服務特色"><span>支援 ${catalog.length} 名</span><span class="online-now" data-online hidden title="最近 1~2 分鐘內開啟這個計算機的人數。隱藏分頁就不計入"><b class="online-dot" aria-hidden="true"></b><span data-online-text></span></span><button type="button" class="notice-open" data-notice-open title="看看到目前為止改了些什麼">更新紀錄</button><a class="credit-link" href="https://github.com/Jgaram/nikke-calc" target="_blank" rel="noreferrer noopener" title="這個計算機的原始儲存庫">向原始演算法開發者致上無限感謝</a></div>
        </div>
        <div class="hero-orbit" aria-hidden="true"><span>01</span><strong>LOCAL<br />SIM</strong></div>
      </header>

      <nav class="view-tabs" aria-label="畫面切換">
        <button type="button" class="view-tab is-on" data-view-tab="calc" aria-pressed="true">計算機</button>
        <button type="button" class="view-tab" data-view-tab="union" aria-pressed="false">聯盟突襲<b class="tab-beta">BETA</b></button>
        <button type="button" class="view-tab" data-view-tab="enikk" aria-pressed="false">匯入 ENIKK 組合</button>
        <button type="button" class="view-tab" data-view-tab="links" aria-pressed="false">外部連結</button>
      </nav>

      <section class="panel links-panel" data-view="links" aria-labelledby="links-heading" hidden>
        <div class="section-heading">
          <div><p class="step">LINKS</p><h2 id="links-heading">外部連結</h2></div>
        </div>
        <p class="links-lede">玩妮姬會用到的<b>其他人做的工具</b>。會在新分頁開啟。</p>
        <p class="links-warn"><b>這裡列出的地方不是我們營運的。</b>計算機裡填的值或帳號資訊不會傳到那邊;那邊的內容・網址變了我們也不會知道。</p>
        <div class="links-grid" data-links-grid></div>
      </section>

      <section class="panel union-panel" data-view="union" aria-labelledby="union-heading" hidden>
        <div class="section-heading">
          <div><p class="step">UNION</p><h2 id="union-heading">聯盟突襲 <b class="beta-tag">BETA</b></h2></div>
        </div>
        <div class="union-modes" role="group" aria-label="計算對象">
          <button type="button" class="union-mode is-on" data-union-mode="union" aria-pressed="true">聯盟</button>
          <button type="button" class="union-mode" data-union-mode="personal" aria-pressed="false">個人用</button>
        </div>
        <p class="union-lede" data-union-lede-union>用聯盟成員<b>各自的實際規格與同步器等級</b>,跑同一個 Boss・同一套隊伍,比較誰能貢獻多少。只有公開妮姬清單的人才能計算。</p>
        <p class="union-lede" data-union-lede-personal hidden>只用<b>我自己的規格</b>。不必匯入名單,每個 Boss 掛不同戰鬥條件、最多跑三套隊伍一眼比較 — 沿用計算機裡的同步器・主控台・妮姬養成。<b>同步器可以直接在這張表裡改</b>(有連動 Blablalink 的話會帶入帳號值)。</p>

        <div class="union-step" data-union-step="1">
          <h3>匯入成員資料</h3>

          <div class="union-source">
            <p class="union-source-head">從匯出檔匯入<b class="union-pick">推薦</b></p>
            <p class="field-note">請每位成員各自用 <b>ExiaInvasion</b> 擴充匯出一個 JSON 交給你,一次全部拖進來就好。這條路<b>不需要任何登入</b>,設「僅對聯盟成員公開」甚至完全不公開的人也算得到。</p>
            <label class="union-drop" data-union-drop>
              <input type="file" multiple accept=".json,application/json" data-union-files hidden>
              <b>把 JSON 檔拖到這裡</b>
              <span>或點一下選擇檔案 — 可一次選 32 個</span>
            </label>
            <p class="union-status" data-union-file-status></p>
            <p class="field-note union-warn"><b>匯出檔裡有登入憑證(cookie)。</b>計算機從頭到尾不會讀它,但那個檔案躺在群組裡的那一份還是有。請成員<b>傳給你之前</b>先用下面的清洗工具過一次。</p>
            <details class="union-wash">
              <summary>清洗工具 — 傳檔前先過這裡</summary>
              <p class="field-note">洗掉登入憑證,只留計算用得到的欄位。檔案也會小十倍左右,傳起來輕鬆。洗過的檔案一樣可以直接匯入。</p>
              <label class="union-drop union-drop-sm" data-union-wash-drop>
                <input type="file" multiple accept=".json,application/json" data-union-wash-files hidden>
                <span>把要清洗的檔案拖進來,或點一下選擇</span>
              </label>
              <p class="union-status" data-union-wash-status></p>
            </details>
          </div>

          <details class="union-source">
            <summary class="union-source-head">改從 Blablalink 撈名單 — 需要指揮官本人登入</summary>
          <p class="field-note">聯盟成員名單<b>只能用指揮官本人的登入</b>取得(我們的伺服器擋著)。所以請你自己撈一次就好 — cookie 或密碼我們都不會碰。</p>
          <ol class="union-guide">
            <li>在登入 Blablalink 的狀態下,打開<b>聯盟廣場</b>。</li>
            <li><kbd>F12</kbd> → 在 <b>Console</b> 分頁貼上下面的內容,按 <kbd>Enter</kbd>。</li>
            <li>名單會複製到剪貼簿。貼到下面的框裡。</li>
            <li>如果剪貼簿被擋住,<b>頁面會跳出一個框、內容已全選</b> — 用 <kbd>Ctrl</kbd>+<kbd>A</kbd> → <kbd>Ctrl</kbd>+<kbd>C</kbd> 複製後,按 <b>✕</b> 或 <kbd>Esc</kbd>、或點框外即可關閉。</li>
          </ol>
          <textarea class="union-snippet" data-union-snippet rows="3" readonly spellcheck="false"></textarea>
          <div class="union-actions">
            <button type="button" class="roster-import" data-union-copy>複製程式碼片段</button>
          </div>
          <textarea class="union-paste" data-union-paste rows="3" placeholder="把名單貼在這裡" spellcheck="false"></textarea>
          <div class="union-actions">
            <button type="button" class="roster-import" data-union-read>讀取名單</button>
            <span class="union-status" data-union-list-status></span>
          </div>
          </details>
        </div>

        <div class="union-step" data-union-step="2" hidden>
          <h3>確認要算誰</h3>
          <div data-union-scan-box>
          <p class="field-note">要一個一個實際查詢才知道。每次同時查三個,公開的人會連妮姬詳情一起收下。</p>
          <div class="union-actions">
            <button type="button" class="roster-import" data-union-scan>掃描公開狀態</button>
            <button type="button" class="roster-import" data-union-scan-stop hidden>中斷</button>
            <span class="union-status" data-union-scan-status></span>
          </div>
          <div class="union-progress" data-union-scan-progress hidden><i></i></div>
          </div>

          <details class="union-direct">
            <summary>用我的瀏覽器自行擷取 — 連「僅對聯盟成員公開」也看得到</summary>
            <p class="field-note">上面的掃描會經過我們的伺服器。我們的帳號不屬於這個聯盟,所以<b>設「僅對聯盟成員公開」的人會永遠顯示為未公開</b>。用指揮官的瀏覽器自行擷取就連他們也看得到 — 不想經過伺服器的人也建議走這條路。</p>
            <p class="field-note">會依聯盟人數逐一查詢,<b>32 人約 2~3 分鐘</b>,進度會在 console 一行一行印出。完成後用上面同樣的方法複製,貼到下面。</p>
            <textarea class="union-snippet" data-union-direct-snippet rows="3" readonly spellcheck="false"></textarea>
            <div class="union-actions">
              <button type="button" class="roster-import" data-union-direct-copy>複製自行擷取程式碼</button>
            </div>
            <textarea class="union-paste" data-union-direct-paste rows="3" placeholder="把自行擷取的資料貼在這裡 (NKU1-…)" spellcheck="false"></textarea>
            <div class="union-actions">
              <button type="button" class="roster-import" data-union-direct-read>讀取自行擷取的資料</button>
              <span class="union-status" data-union-direct-status></span>
            </div>
          </details>

          <div class="union-members" data-union-members></div>
          <div class="union-ask" data-union-ask hidden>
            <p data-union-ask-text></p>
            <button type="button" class="roster-import" data-union-pick-all>選擇所有公開的人</button>
            <button type="button" class="roster-import" data-union-pick-none>全部取消</button>
          </div>
        </div>

        <div class="union-step" data-union-step="3" hidden>
          <h3>Boss 與隊伍</h3>
          <p class="field-note">Boss 用<b>戰鬥條件代碼</b>(NK3-)、隊伍用<b>組合代碼</b>(NK2-)填入。可以帶入計算機裡的設定,或<b>從分享清單選</b>。取消勾選的 Boss 不計算 — 因為有人對風壓強、對電擊弱。</p>
          <div class="union-board-bar">
            <span class="union-board-label">整個盤面</span>
            <button type="button" class="roster-import" data-union-set-share>從分享選盤面</button>
            <button type="button" class="roster-import" data-union-set-paste>貼上盤面代碼</button>
            <button type="button" class="roster-import" data-union-set-copy>複製此盤面代碼</button>
            <span class="union-status" data-union-set-status></span>
          </div>
          <p class="field-note">五個 Boss 與每格的隊伍都裝進<b>一個代碼</b>(NK4-) — 整套搬移上季盤面、或發到聯盟群時,不必貼二十次。<b>聯盟成員名單不會被包含。</b></p>
          <div class="union-set-box" data-union-set-box hidden>
            <textarea class="custom-json" data-union-set-code rows="3" placeholder="盤面代碼 (NK4-…)"></textarea>
            <div class="deck-copy-actions">
              <button type="button" class="deck-copy-apply" data-union-set-apply>套用此盤面</button>
              <button type="button" class="deck-copy-cancel" data-union-set-close>關閉</button>
            </div>
          </div>
          <div class="union-bosses" data-union-bosses></div>

          <div class="custom-modal" data-union-share-modal hidden>
            <div class="custom-card share-card" role="dialog" aria-label="從分享選擇">
              <div class="custom-head"><h2 data-union-share-title>從分享選擇</h2><button type="button" class="custom-close" data-union-share-close aria-label="關閉">✕</button></div>
              <p class="custom-desc" data-union-share-desc></p>
              <div data-union-share-body></div>
              <p class="custom-msg" data-union-share-msg hidden></p>
            </div>
          </div>
        </div>

        <div class="union-step" data-union-step="4" hidden>
          <h3>模擬</h3>
          <p class="field-note">聯盟成員 × Boss × 隊伍逐一計算。<b>會花不少時間,請開著視窗等候</b> — 結果會一邊算一邊往下累積。</p>
          <div class="union-actions">
            <button type="button" class="roster-import union-run" data-union-run disabled>執行模擬</button>
            <button type="button" class="roster-import" data-union-stop hidden>中斷</button>
            <span class="union-status" data-union-run-status></span>
          </div>
          <div class="union-progress" data-union-run-progress hidden><i></i></div>
          <div class="union-report" data-union-report></div>
        </div>
      </section>

      <section class="panel enikk-panel" data-view="enikk" aria-labelledby="enikk-heading" hidden>
        <div class="section-heading">
          <div><p class="step">ENIKK</p><h2 id="enikk-heading">匯入 ENIKK 組合</h2></div>
        </div>
        <p class="enikk-lede">從 enikk.app 單人突襲排行榜,<b>整套匯入那個人實際用的 5 隊</b>。對象是最新賽季前 <b>300 名</b>(KR・JP・GLOBAL・NA・TW-HK・SEA 各 50 名),按下去就直接鋪到我們的 5 隊。</p>
        <p class="enikk-warn" data-enikk-warn>載入約需 <b>5~10 秒</b> — 因為要從 enikk 一次拿 300 人份。拿到之後會存在這個瀏覽器,不會再重抓。</p>
        <div class="enikk-actions">
          <button type="button" class="roster-import" data-enikk-load>匯入組合</button>
          <button type="button" class="roster-import" data-enikk-refresh hidden>重新取得</button>
          <span class="enikk-status" data-enikk-status></span>
        </div>
        <div class="enikk-exclude">
          <label class="enikk-exclude-label" for="enikk-exclude">要排除的妮姬</label>
          <div class="enikk-exclude-row">
            <input id="enikk-exclude" type="search" list="enikk-exclude-list" placeholder="輸入你沒有的妮姬名稱" autocomplete="off" data-enikk-exclude-input />
            <datalist id="enikk-exclude-list" data-enikk-exclude-options></datalist>
            <button type="button" class="roster-import" data-enikk-exclude-add>新增</button>
          </div>
          <div class="enikk-exclude-chips" data-enikk-exclude-chips></div>
          <p class="field-note">含有你填入妮姬的隊伍會<b>從匯入中排除</b>。目的是只留下沒有那隻妮姬也能組出的隊伍。</p>
        </div>
        <div class="enikk-summary" data-enikk-summary hidden></div>
        <div class="enikk-compare" data-enikk-compare hidden></div>
        <div class="enikk-list" data-enikk-list hidden></div>
      </section>

      <form class="calculator-layout" data-view="calc" novalidate>
        <section class="panel squad-panel" aria-labelledby="squad-heading">
          <div class="section-heading">
            <div><h2 id="squad-heading">編成與角色設定</h2></div>
            <div class="squad-tools">
              <span class="roster-import-group">
                <label class="roster-import" title="匯入 Let's Doro 妮姬資訊 CSV,套用到所有妮姬設定">
                  <input id="roster-csv" type="file" accept=".csv,text/csv" hidden />
                  <span>匯入 Let's Doro CSV</span>
                </label>
                <button type="button" class="roster-info" data-doro-open aria-label="取得 Let's Doro CSV 的方法" title="在 Let's Doro 取得 CSV 的方法">i</button>
              </span>
              ${blablaProxy ? '<button type="button" class="roster-import" data-blabla-open title="用 Blablalink 個人檔案網址,一次匯入持有妮姬的養成狀態">Blablalink 連動</button>' : ''}
              <button type="button" class="roster-import" data-add-nikke title="手動新增未上市・未收錄的妮姬">新增妮姬</button>
              <button type="button" class="roster-import" data-share-open title="把編成在這個瀏覽器裡命名儲存,或用代碼・連結互相傳送。個人規格與戰鬥條件不會包含在內">預設 / 組合分享</button>
              <button type="button" class="roster-import danger" data-reset-all title="清除編成・設定・CSV 名單・新增的妮姬・已儲存的結果,全部回到初始狀態">完全重置</button>
              <label class="toggle-field mode-toggle" title="編成時沿用其他隊伍已調整過的個別設定"><input id="carry-settings" type="checkbox" checked /><span class="toggle"></span><span>沿用設定</span></label>
              <label class="toggle-field mode-toggle"><input id="squad-mode" type="checkbox" /><span class="toggle"></span><span>5隊模式</span></label>
            </div>
            <p class="roster-note" data-roster-note hidden></p>
          </div>
          <div class="deck-tabs" data-deck-tabs hidden></div>
          <div class="deck-controls">
            <button type="button" class="burst-order-open" data-burst-order-open title="每個循環由誰放 1爆・2爆・3爆,由你自己決定。只依照你指定的部分,之後回到平常的順序"><span class="burst-order-mark" aria-hidden="true">1·2·3</span><span>爆裂順序</span><b class="burst-order-badge" data-burst-order-badge hidden></b></button>
            <span class="deck-moves" data-deck-moves hidden></span>
            <button type="button" class="deck-clear" data-deck-clear title="清空目前檢視隊伍的編成與個別設定">清空隊伍</button>
            <button type="button" class="deck-clear" data-deck-clear-all hidden title="一次清空五個隊伍的編成・個別設定・名稱">清空 5 隊</button>
          <div class="deck-copy" data-deck-copy hidden>
            <button type="button" class="deck-copy-open" data-deck-copy-open>複製目前隊伍</button>
            <div class="deck-copy-panel" data-deck-copy-panel hidden>
              <p class="deck-copy-title" data-deck-copy-title></p>
              <div class="deck-copy-targets" data-deck-copy-targets></div>
              <div class="deck-copy-actions">
                <button type="button" class="deck-copy-apply" data-deck-copy-apply>複製</button>
                <button type="button" class="deck-copy-cancel" data-deck-copy-cancel>取消</button>
              </div>
            </div>
          </div>
          </div>
          <p class="deck-note" data-deck-note hidden>不同隊伍之間可以重複編成同一個角色。</p>
          <div class="squad-grid" data-squad-grid></div>

          <!-- 니케 고르기. 창을 띄우지 않고 늘 펼쳐 두고, 검색은 이 판을 거른다.
               「이름을 쳤는데 아무 일도 안 일어난다」가 지적된 지점이라, 결과를
               감추는 자리를 없앴다. -->
          <section class="picker" aria-label="選擇妮姬" data-picker hidden>
            <div class="picker-head">
              <h3>選擇妮姬 <span data-roster-count></span></h3>
              <p class="picker-target" data-roster-desc></p>
              <button type="button" class="picker-close" data-picker-close aria-label="關閉選擇妮姬" title="關閉 (Esc)">✕</button>
            </div>
            <input type="search" class="roster-search" data-roster-search placeholder="搜尋妮姬(名稱・屬性;也支援韓文/別名)" autocomplete="off" aria-label="搜尋妮姬名稱" />
            <!-- 정렬·필터는 판을 눌러 펼친다. 칩을 늘 깔아 두면 목록이 화면 밖으로
                 밀리고, 필터가 몇 개 걸렸는지도 한눈에 안 들어온다. -->
            <div class="picker-bar">
              <button type="button" class="filter-open" data-filter-open aria-expanded="false">
                <span>排序與篩選</span>
                <b class="filter-badge" data-filter-badge hidden></b>
                <span class="filter-caret" aria-hidden="true">▾</span>
              </button>
              <!-- 버스트는 가장 자주 거르는 축이라 판 안에 넣지 않는다 — 판을 펼치지
                   않고 바로 누를 수 있어야 한다. -->
              <div class="filter-chips burst-chips" data-burst-group></div>
              <button type="button" class="filter-reset" data-filter-reset hidden>清除篩選</button>
              <span class="filter-summary" data-filter-summary></span>
            </div>
            <!-- 판은 목록을 밀어내지 않고 그 «위에» 얹힌다. 밀어내면 펼칠 때마다
                 목록이 화면 밖으로 내려가 무엇을 고르는 중이었는지 놓친다. -->
            <div class="picker-body">
              <div class="filter-panel" data-filter-panel hidden>
                <div class="filter-section">
                  <p class="filter-title">排序</p>
                  <div class="filter-chips" data-sort-group></div>
                </div>
                <div class="filter-rule"></div>
                <p class="filter-title">篩選</p>
                <div class="filter-groups" data-filter-groups></div>
              </div>
              <div class="picker-scroll"><div class="roster-grid" data-roster-grid></div></div>
            </div>
            <p class="roster-empty" data-roster-empty hidden>沒有符合搜尋的妮姬。</p>
          </section>
        </section>

        <section class="panel settings-panel" aria-labelledby="settings-heading">
          <div class="section-heading compact target-heading">
            <div><h2 id="settings-heading">戰鬥條件</h2></div>
            <div class="target-actions">
              <button type="button" class="reset-enemy" data-battle-share-open title="把戰鬥條件做成代碼分享,或貼上收到的代碼套用">戰鬥條件分享</button>
              <button type="button" class="reset-enemy" data-reset-enemy>重置敵方數值</button>
              <button type="button" class="reset-enemy" data-clear-cache title="清除相同條件下已儲存的結果,下次執行起重新計算">清除已存結果</button>
            </div>
          </div>
          <!-- 조건은 한 번 정해 두면 계속 쓰는 값이다. 그 자리에서 펼치면 편성이 화면
               밖으로 밀리므로 창으로 띄우고, 이 줄에는 무엇으로 재는지만 한 줄로 남긴다. -->
          <!-- 조건과 실행을 한 막대로 붙인다. 패널 사이에 단추만 덩그러니 뜨는 자리를
               없애고, «이 조건으로 → 실행»이 한 줄로 읽히게 하려는 것이다. -->
          <!-- 적 코드와 코어는 보스가 바뀔 때마다 손대는 둘이라 창 밖에 꺼내 둔다.
               나머지 조건은 한 번 정해 두면 그대로 쓰는 값이라 창 안에 남는다. -->
          <div class="quick-cond" data-quick-cond>
            <label class="quick-code">
              <span>Boss 代碼</span>
              <select data-quick-enemy-code title="敵人的屬性代碼。剋制該屬性的妮姬會多打 10% 傷害">
                <option value="">無</option>
                <option value="풍압">風壓(燃燒優勢)</option>
                <option value="수냉">水冷(電擊優勢)</option>
                <option value="작열">燃燒(水冷優勢)</option>
                <option value="전격">電擊(鐵甲優勢)</option>
                <option value="철갑">鐵甲(風壓優勢)</option>
              </select>
            </label>
            <label class="toggle-field mode-toggle quick-core" title="有核心時,命中該部位的彈會吃到核心倍率">
              <input type="checkbox" data-quick-core /><span class="toggle"></span><span>有核心</span>
            </label>
          </div>
          <div class="cond-bar">
            <button type="button" class="battle-open" data-battle-open aria-expanded="false">
              <span class="battle-open-label">戰鬥條件</span>
              <span class="battle-summary" data-battle-summary></span>
              <span class="disclosure-hint" aria-hidden="true">展開 ›</span>
            </button>
            <button class="calculate-button run-inline" type="submit"><span>執行模擬</span><b aria-hidden="true">→</b></button>
          </div>
          <!-- 계산이 얼마나 빨리 끝나는지를 정하는 설정이라 실행 단추 바로 아래에 둔다. -->
          <div class="parallel-row">
            <label class="toggle-field mode-toggle parallel-pick" title="把計算分散到多個工作執行緒。多用這台裝置的核心,換來 5 隊計算快上數倍 — 計算是在你這台裝置上跑,與伺服器成本無關">
              <input type="checkbox" data-parallel-toggle checked /><span class="toggle"></span><span>並行計算</span>
              <select data-parallel-size></select>
            </label>
          </div>
          <p class="status" data-status aria-live="polite">計算引擎準備中…</p>
          <p class="battle-first-note" data-battle-first-note>計算前請<b>先確認一次戰鬥條件</b> — 依戰鬥長度是幾秒、敵人代碼是什麼,結果會完全不同。</p>
          <!-- 막힌 이유는 누른 단추 바로 아래에서 읽혀야 한다. -->
          <div class="error-box" data-errors hidden role="alert"></div>

          <!-- 창은 조건 패널 «안»에 둔다 — 설정 입력을 지켜보는 리스너가 이 패널을
               기준으로 걸려 있어, 밖으로 빼면 값을 바꿔도 저장되지 않는다. -->
          <div class="custom-modal" data-battle-modal hidden>
          <div class="custom-card battle-card" role="dialog" aria-label="戰鬥條件">
          <div class="custom-head"><h2>戰鬥條件</h2><button type="button" class="custom-close" data-battle-modal-close aria-label="關閉">✕</button></div>
          <div class="battle-body" data-battle-body>
          <div class="field-grid">
            <label><span>戰鬥時間</span><div class="input-unit"><input id="duration" type="number" min="10" max="180" step="1" value="180" /><em>秒</em></div></label>
            <label><span>敵代碼</span><select id="enemy-code"><option value="">無</option><option value="풍압">風壓(弱燃燒)</option><option value="수냉">水冷(弱電擊)</option><option value="작열">燃燒(弱水冷)</option><option value="전격">電擊(弱鐵甲)</option><option value="철갑">鐵甲(弱風壓)</option></select></label>
            <label><span>同步器等級</span><div class="input-unit"><input id="synchro-level" type="number" min="1" max="${SYNCHRO_MAX}" step="1" value="${DEFAULT_SYNCHRO_LEVEL}" title="放進同步器裝置小隊的妮姬,全員都會是這個等級。屬帳號養成狀態,不會包含在戰鬥條件分享代碼裡。${SYNCHRO_MEASURED_MAX} 級以下是實測值,以上以相同成長曲線延伸計算" /><em>Lv</em></div></label>
            <label class="toggle-field"><input id="has-core" type="checkbox" /><span class="toggle"></span><span>有核心</span></label>
            <label data-core-size><span>核心直徑</span><div class="input-unit"><input id="core-px" type="number" min="0" max="1000" step="1" value="52" disabled /><em>px</em></div></label>
            <label class="toggle-field"><input id="has-parts" type="checkbox" /><span class="toggle"></span><span>可破壞部位</span></label>
          </div>
          <fieldset class="range-field">
            <legend>適正距離</legend>
            <div class="range-options" data-optimal-range></div>
            <p class="field-note">只有所選武器類型的<b>一般攻擊</b>會加 +30% 傷害加成 — 技能傷害不加。這是取決於與敵人距離的條件,以武器類型為單位開啟。</p>
          </fieldset>

          <!-- 고급 설정 — 자주 손대지 않는 값과 보스 페이즈를 한자리에 접어 둔다. -->
          <button type="button" class="disclosure" data-advanced-battle aria-expanded="false">
            <span class="disclosure-label">進階設定</span><span class="disclosure-hint">展開</span>
          </button>
          <div class="disclosure-panel" data-advanced-battle-panel hidden>
            <div class="field-grid">
              <label><span>敵方防禦力</span><input id="enemy-def" type="number" min="0" max="999999" step="1" value="31784" /></label>
              <label><span>隨機種子</span><input id="seed" type="number" min="0" max="2147483647" step="1" value="42" /></label>
              <label title="這只是量表充能的時間。再加上階段切換 0.3 秒與爆裂冷卻的餘裕,實際空檔更長。"><span>爆裂量表充能</span><div class="input-unit"><input id="burst-regen" type="number" min="0" max="20" step="0.1" value="2" /><em>秒</em></div></label>
              <label class="toggle-field deck-regen-toggle" title="只想對爆裂冷卻被拖延的隊伍用不同值測量時開啟"><input id="burst-regen-per-deck" type="checkbox" /><span class="toggle"></span><span>爆裂充能各隊分開</span></label>
              <label title="條件齊備後到實際按下爆裂所需的時間。每個爆裂各自累加,用到 3 階就慢三倍。"><span>爆裂反應速度</span><div class="input-unit"><input id="burst-reaction" type="number" min="0" max="3" step="0.01" value="${DEFAULT_BURST_REACTION}" /><em>秒</em></div></label>
              <label><span>隨機處理</span><select id="rng-mode"><option value="expected">期望值(推薦)</option><option value="random">隨機</option></select></label>
              <label class="toggle-field" title="免疫區間普攻會 miss,所以量表也視為不充能計算。開啟後爆裂會相應被拖延。"><input id="immune-blocks-burst" type="checkbox" checked /><span class="toggle"></span><span>免疫期間停止爆裂充能</span></label>
            </div>
            <div class="deck-regen-grid" data-deck-regen hidden></div>
            <p class="field-note">期望值以期望取代機率,<b>相同設定永遠得到相同值</b>。隨機則重現遊戲內的分散,結果會隨種子浮動。</p>

            <fieldset class="range-field">
              <legend>普攻係數</legend>
              <div class="coeff-options" data-hit-coeff></div>
              <p class="field-note">校正實戰中因彈道散布而 miss 的彈。<b>只乘在普攻上</b>,技能・爆裂與變身模式射擊屬瞄準判定,不動它。預設值由實測對照取得(SG 0.90),1.00 則無校正。</p>
            </fieldset>

            <fieldset class="range-field phase-field">
              <legend>Boss 階段</legend>
              <div class="phase-head">
                <button type="button" class="phase-add" data-phase-add="immune">新增免疫 <b>+</b></button>
                <button type="button" class="phase-add" data-phase-add="element">新增屬濾 <b>+</b></button>
              </div>
              <div class="phase-list" data-phase-list></div>
              <p class="field-note"><b>免疫</b>只讓普攻 miss。持續傷害・技能傷害與普攻觸發的後續攻擊仍會命中。<b>屬濾</b>只讓對所選屬性<b>剋制</b>的角色傷害通過 — 設風壓時只有燃燒角色進得去。和遊戲一樣,靠<b>剋制代碼 buff</b>取得剋制的角色也能通過(Rapi: Red Hood 的《附著型榴彈》等)。</p>
            </fieldset>
          </div>
          <section class="console-editor">
            <h3>主控台 <span>前哨基地 回收研究室</span></h3>
            <div class="console-grid" data-console-grid></div>
            <p class="field-note">屬帳號設定,會一起套用到隊伍全員。職業・企業在遊戲內依所屬分別成長,所以各自輸入。企業提升攻擊力,共通・職業提升生命 — 用生命係數的角色(灰姑娘等)共通・職業也會反映到傷害。</p>
          </section>
          </div>
          </div>
          </div>
        </section>

        <section class="panel result-panel" aria-labelledby="result-heading" data-result-panel>
          <div class="result-empty"><h2 id="result-heading">戰鬥結果</h2><div class="radar-mark" aria-hidden="true"><i></i><i></i><i></i></div><p>確認編成與條件後<br />請執行模擬。</p></div>
        </section>
      </form>

      <section class="panel timeline-panel" data-view="calc" aria-labelledby="timeline-heading" data-timeline-panel hidden>
        <div class="section-heading compact"><div><h2 id="timeline-heading">戰鬥時間軸</h2></div></div>
        <div data-timeline-body></div>
      </section>
      <footer><p>非官方粉絲製作工具・與實際戰鬥環境可能有差異。</p><a href="https://github.com/Moris-kr/nikke-calc" target="_blank" rel="noreferrer">SOURCE / GITHUB ↗</a></footer>

      <div class="custom-modal" data-history-modal hidden>
        <div class="custom-card roster-card" role="dialog" aria-label="計算紀錄">
          <div class="custom-head"><h2>計算紀錄</h2><button type="button" class="custom-close" data-history-close aria-label="關閉">✕</button></div>
          <p class="custom-desc">在結果按下「儲存結果」的當下,那時的編成與數值會留在這個瀏覽器。可以復原編成、回到當時的組合。<b>數值是用當時的規格・戰鬥條件算出來的</b>,和現在設定不同時要重新計算才準。</p>
          <div class="history-list" data-history-list></div>
        </div>
      </div>

      <div class="custom-modal" data-battle-share-modal hidden>
        <div class="custom-card share-card" role="dialog" aria-label="戰鬥條件分享">
          <div class="custom-head"><h2>戰鬥條件分享</h2><button type="button" class="custom-close" data-battle-share-close aria-label="關閉">✕</button></div>
          <p class="custom-desc">交換的是<b>「在什麼情況下測的」</b>,像戰鬥時間・敵代碼・核心・免疫・屬濾・隨機處理。<b>主控台與同步器等級不會被包含</b> — 那是帳號養成狀態,帶了別人的值就不是用自己規格測的結果了。編成與個人規格也不包含(那要用「組合分享」)。</p>
          ${SHARE_API ? '<div class="share-tabs" data-battle-share-tabs></div>' : ''}
          <div class="share-pane" data-battle-share-pane="upload" hidden></div>
          <div class="share-pane" data-battle-share-pane="list" hidden></div>
          <div class="share-pane" data-battle-share-pane="code">
            <div class="squad-code-block">
              <h4>我的戰鬥條件代碼</h4>
              <textarea class="share-out" data-battle-share-out readonly rows="3"></textarea>
              <button type="button" class="share-copy" data-battle-share-copy>複製代碼</button>
            </div>
            <div class="squad-code-block">
              <h4>套用收到的代碼</h4>
              <textarea class="share-in" data-battle-share-in rows="3" placeholder="貼上以 NK3- 開頭的代碼"></textarea>
              <button type="button" class="share-apply" data-battle-share-apply>套用</button>
            </div>
          </div>
          <p class="share-msg" data-battle-share-msg hidden></p>
        </div>
      </div>

      <!-- 업데이트 공지. 새 내용이 있을 때 처음 들어오면 한 번 뜨고, 닫으면 그 판을
           본 것으로 적어 다시 뜨지 않는다. 「업데이트 내역」으로 언제든 다시 연다. -->
      <div class="custom-modal" data-notice-modal hidden>
        <div class="custom-card notice-card" role="dialog" aria-label="更新紀錄">
          <div class="custom-head"><h2>更新紀錄</h2><button type="button" class="custom-close" data-notice-close aria-label="關閉">✕</button></div>
          <div class="notice-body" data-notice-body></div>
          <div class="deck-copy-actions">
            <button type="button" class="deck-copy-apply" data-notice-dismiss>確認・不再顯示</button>
          </div>
        </div>
      </div>

      <!-- 캐릭터 설정 뭉치를 띄우는 창. 카드가 좁아 그 자리에서 펼치면 다섯 장이
           서로를 밀어낸다 — 필터 판과 같은 방식으로 창을 띄운다. -->
      <div class="custom-modal" data-char-panel-modal hidden>
        <div class="custom-card char-panel-card" role="dialog" aria-label="角色設定">
          <div class="custom-head"><h2 data-char-panel-title>角色設定</h2><button type="button" class="custom-close" data-char-panel-close aria-label="關閉">✕</button></div>
          <div class="char-panel-body" data-char-panel-body></div>
        </div>
      </div>

      <div class="custom-modal" data-buff-order-modal hidden>
        <div class="custom-card buff-order-card" role="dialog" aria-label="Buff 對象順序">
          <div class="custom-head"><h2 data-buff-order-title>Buff 對象順序</h2><button type="button" class="custom-close" data-buff-order-close aria-label="關閉">✕</button></div>
          <p class="custom-desc" data-buff-order-desc></p>
          <div class="buff-order-list" data-buff-order-list></div>
        </div>
      </div>

      <div class="custom-modal" data-burst-order-modal hidden>
        <div class="custom-card burst-order-card" role="dialog" aria-label="爆裂順序">
          <div class="custom-head"><h2>爆裂順序</h2><button type="button" class="custom-close" data-burst-order-close aria-label="關閉">✕</button></div>
          <p class="custom-desc">每個循環由你自己決定<b>1爆 → 2爆 → 3爆</b>由誰放。<b>只依照你指定的循環數</b> — 戰鬥更長時,之後由計算機照平常順序選。點頭像或用 <b>A・S・D・F・G</b> 鍵選,<b>←</b> 退回一格。</p>
          <div class="burst-order-bar">
            <label class="burst-cycles">滿爆裂次數
              <button type="button" class="burst-step-btn" data-burst-cycles-down aria-label="減少一個循環">−</button>
              <output data-burst-cycles>0</output>
              <button type="button" class="burst-step-btn" data-burst-cycles-up aria-label="增加一個循環">+</button>
            </label>
            <span class="burst-order-progress" data-burst-progress></span>
            <button type="button" class="roster-import" data-burst-order-reset>從頭開始</button>
          </div>
          <p class="burst-order-hint" data-burst-cycles-note></p>
          <div class="burst-now" data-burst-now></div>
          <div class="burst-picks" data-burst-picks></div>
          <div class="burst-order-list" data-burst-list></div>
          <p class="custom-msg" data-burst-order-msg hidden></p>
          <div class="deck-copy-actions">
            <button type="button" class="deck-copy-apply" data-burst-order-save>就用這個順序</button>
            <button type="button" class="deck-copy-cancel" data-burst-order-clear>清除順序(自動)</button>
          </div>
        </div>
      </div>

      <div class="custom-modal" data-share-modal hidden>
        <div class="custom-card share-card" role="dialog" aria-label="預設 / 組合分享">
          <div class="custom-head"><h2>預設 / 組合分享</h2><button type="button" class="custom-close" data-share-close aria-label="關閉">✕</button></div>
          <p class="custom-desc">只交換誰被編成(角色組合)。<b>超載・攻擊力・突破等個人規格與戰鬥條件不會被包含</b> — 套用後只換角色,規格仍用各自的設定(有匯入 CSV 名單的話就用那個值)。${SHARE_API ? '<b>只有按「上傳」時才會傳到伺服器。</b>' : '不會傳到伺服器。'}</p>
          <div class="share-scope" data-share-scope>
            <span class="share-scope-label">範圍</span>
            <button type="button" class="share-scope-pick is-on" data-share-scope-pick="one">只有這隊</button>
            <button type="button" class="share-scope-pick" data-share-scope-pick="all">全部 5 隊</button>
            <span class="share-scope-note" data-share-scope-note></span>
          </div>
          ${SHARE_API ? '<div class="share-tabs" data-share-tabs></div>' : ''}
          <div class="share-pane" data-share-pane="upload" hidden></div>
          <div class="share-pane" data-share-pane="list" hidden></div>
          <div class="share-pane" data-share-pane="code">
          <div class="squad-code-block">
            <h4>我的組合代碼</h4>
            <textarea class="custom-json" data-share-out rows="3" readonly></textarea>
            <div class="deck-copy-actions"><button type="button" class="deck-copy-apply" data-share-copy>複製代碼</button></div>
          </div>
          <div class="squad-code-block">
            <h4>分享連結</h4>
            <textarea class="custom-json" data-share-url rows="2" readonly></textarea>
            <div class="deck-copy-actions"><button type="button" class="deck-copy-apply" data-share-url-copy>複製連結</button></div>
          </div>
          <div class="squad-code-block">
            <h4>套用收到的代碼</h4>
            <textarea class="custom-json" data-share-in rows="3" placeholder="貼上收到的組合代碼或分享連結"></textarea>
            <div class="deck-copy-actions"><button type="button" class="deck-copy-apply" data-share-apply>套用此組合</button></div>
          </div>
          <div class="squad-code-block">
            <h4>儲存到這個瀏覽器</h4>
            <div class="preset-row">
              <input type="text" class="preset-name" data-preset-name placeholder="預設名稱 (例: 水冷單刷 1隊)" maxlength="40" />
              <button type="button" class="deck-copy-apply" data-preset-save>儲存</button>
            </div>
            <div class="preset-list" data-preset-list></div>
          </div>
          </div>
          <p class="custom-msg" data-share-msg hidden></p>
        </div>
      </div>

      <div class="custom-modal" data-report-modal hidden>
        <div class="custom-card report-card" role="dialog" aria-label="報告圖片">
          <div class="custom-head"><h2>報告圖片</h2><button type="button" class="custom-close" data-report-close aria-label="關閉">✕</button></div>
          <p class="custom-desc">可以複製下面的圖片直接貼到社群。複製被擋時,可以存成 PNG,或對圖片按右鍵複製。只在這個瀏覽器裡產生。</p>
          <div class="report-preview" data-report-preview></div>
          <p class="report-msg" data-report-msg hidden></p>
          <div class="deck-copy-actions">
            <button type="button" class="deck-copy-apply" data-report-copy>複製圖片</button>
            <button type="button" class="deck-copy-cancel" data-report-save>儲存 PNG</button>
          </div>
        </div>
      </div>

      <div class="custom-modal" data-reset-modal hidden>
        <div class="custom-card reset-card" role="dialog" aria-label="完全重置確認">
          <div class="custom-head"><h2>完全重置</h2><button type="button" class="custom-close" data-reset-close aria-label="關閉">✕</button></div>
          <p class="custom-desc">清除以下所有項目,回到初始狀態。無法復原。</p>
          <ul class="reset-list">
            <li>所有隊伍的編成與各角色設定</li>
            <li>用 CSV 匯入的名單</li>
            <li>手動新增的妮姬</li>
            <li>已儲存的計算結果</li>
            <li>戰鬥條件</li>
          </ul>
          <div class="deck-copy-actions">
            <button type="button" class="deck-copy-apply danger" data-reset-confirm>重置</button>
            <button type="button" class="deck-copy-cancel" data-reset-cancel>取消</button>
          </div>
        </div>
      </div>

      ${blablaProxy ? `
      <div class="custom-modal" data-blabla-modal hidden>
        <div class="custom-card doro-card" role="dialog" aria-label="Blablalink 連動">
          <div class="custom-head"><h2>Blablalink 連動</h2><button type="button" class="custom-close" data-blabla-close aria-label="關閉">✕</button></div>
          <p class="custom-desc">在 Blablalink 複製<b>我的個人檔案網址</b>貼進來,就能一次匯入持有妮姬的養成狀態。除了突破・核心強化・技能・超載・裝備強化,還包含 CSV 沒有的<b>魔方與收藏品</b>。</p>
          <p class="custom-desc">進入 <a href="https://www.blablalink.com/user" target="_blank" rel="noreferrer noopener">blablalink.com/user</a>,網址列出現的網址就是它。要在 Blablalink 把<b>個人檔案與妮姬清單設為公開</b>才查得到 — 有一項未公開就會被擋。連前哨基地都公開的話,主控台(回收研究室)等級也會一起帶入。</p>
          <div class="blabla-row">
            <select class="blabla-server" data-blabla-server aria-label="Blablalink 伺服器">
              <option value="">自動(持有妮姬最多的伺服器)</option>
              ${BLABLA_SERVERS.map(({ area, label }) => `<option value="${area}">${label}</option>`).join('')}
            </select>
            <input type="url" class="blabla-url" data-blabla-url placeholder="https://www.blablalink.com/user?openid=..." spellcheck="false" />
            <button type="button" class="roster-import" data-blabla-sync>同步</button>
          </div>
          <p class="custom-desc blabla-status" data-blabla-status hidden></p>
          <p class="custom-desc">取得的值只存在這個瀏覽器。好感度由計算機從突破階段推導,不另外反映。</p>
        </div>
      </div>` : ''}
      <div class="custom-modal" data-doro-modal hidden>
        <div class="custom-card doro-card" role="dialog" aria-label="取得 Let's Doro CSV 的方法">
          <div class="custom-head"><h2>取得 Let's Doro CSV 的方法</h2><button type="button" class="custom-close" data-doro-close aria-label="關閉">✕</button></div>
          <p class="custom-desc">在 Let's Doro <b>妮姬資訊</b>頁面,按清單右下的<b>下載圖示</b>就會存下 CSV。把那個檔用<b>匯入 Let's Doro CSV</b>放進來,持有妮姬的設定就會一次套用。</p>
          <p class="doro-link"><a href="https://letsdoro.com/mypage?tab=nikke" target="_blank" rel="noreferrer">開啟 letsdoro.com 妮姬資訊 ↗</a></p>
          <p class="field-note">CSV 裡<b>不含魔方與好感度</b> — 這兩者以預設值(預設魔方・各突破最大好感度)計算,可在卡片的<b>個別設定</b>改成實際值。</p>
          <img class="doro-shot" src="${import.meta.env.BASE_URL}letsdoro-csv.png" alt="Let's Doro 妮姬資訊頁面的 CSV 下載位置" loading="lazy" />
        </div>
      </div>

      <div class="custom-modal" data-custom-modal hidden>
        <div class="custom-card" role="dialog" aria-label="新增妮姬">
          <div class="custom-head"><h2>新增妮姬</h2><button type="button" class="custom-close" data-custom-close aria-label="關閉">✕</button></div>
          <p class="custom-desc">手動新增未上市・未收錄的妮姬。不會傳到伺服器,只存在這個瀏覽器。</p>
          <ol class="custom-steps">
            <li>按下面的<b>複製提示詞</b>貼到別的 LLM(聊天機器人),再在下面附上妮姬名稱・技能說明,取得結果 JSON。</li>
            <li>把拿到的 JSON 貼到下面的框,按<b>新增</b>。或看<b>手動輸入說明</b>自己寫也可以。</li>
          </ol>
          <div class="custom-caution">
            <b>請注意</b>
            <ul>
              <li>特殊或複雜的技能(條件發動・量表・模式切換・堆疊條件等)<b>不會反映到計算</b>。只以基本射擊・buff・爆裂為主做近似。這類技能是主力輸出的角色(例:靠量表放大傷害的角色)<b>結果會比實際低很多</b>,僅供參考。</li>
              <li>依 LLM 效能,<b>可能難以精準轉換,請當參考用</b>,建議自行確認・校正數值。</li>
              <li>可以的話,看下面的<b>手動輸入說明</b>由人親自填值最準。</li>
            </ul>
          </div>
          <details class="custom-help">
            <summary>手動輸入說明(schema・人工填寫時)</summary>
            <div class="custom-help-body">
              <p><b>最上層</b>: <code>{ "name": "正式名稱", "nikke": {…數值}, "skills": [ …效果 ] }</code></p>
              <p><b>nikke 共通</b>: rarity(SSR/SR/R) · element_code(전격/작열/수냉/풍압/철갑) · class(화력형/방어형/지원형) · manufacturer(엘리시온/미실리스/테트라/필그림/어브노멀) · weapon_type(AR/SMG/MG/SR/RL/SG) · burst_stage(1~3) · burst_cooldown(秒) · max_ammo · reload_time(秒) · fire_rate(每秒發射) · pellets(僅 SG 2↑) · muzzles(通常 1) · damage_coeff(單發係數 %)</p>
              <p><b>各武器額外</b>: 連射型(AR·SMG·MG·SG)用 <code>core_dmg_mult</code>(核心 %,例 200)。蓄力型(SR·RL)用 <code>charge_time</code>(滿蓄力秒,例 1.0~1.5)與 <code>full_charge_mult</code>(滿蓄力 %,例 250·350)。蓄力型不填時各自以 1.0・250 為預設。</p>
              <p><b>skills 各元素</b>: source(스킬1/스킬2/버스트스킬) · type(buff 或 damage) · name · trigger:{ timing:[…], condition:[…] } · target · stat · polarity(beneficial/harmful) · max_stack(通常 1) · values:{ "1":值, "10":值 } 或 fixed_value:值 · duration(持續秒,即發/永久可省略或 -1)</p>
              <p><b>可辨識的 timing</b>: battle_start · full_burst_start · full_burst_start_count:N · full_burst_end · burst_cast · burst_cast_count:N · last_bullet · last_bullet_fire · hit_count:N · full_charge_hit · passive</p>
              <p><b>可辨識的 target</b>: self · all_allies · all_allies_excl_self · all_enemies · target · same_target · allies:N · allies_top_atk:N · allies_weapon:&lt;武器&gt; · allies_class:공격|방어|지원 · allies_code:&lt;屬性&gt; · allies_code_weapon:&lt;屬性&gt;:&lt;武器&gt; · enemies_top_atk:N</p>
              <p><b>可辨識的 buff stat</b>: atk_pct · atk_flat · atk_dmg_pct · normal_atk_dmg_pct · crit_rate · crit_dmg · core_dmg_pct · element_bonus_pct · burst_dmg_pct · pierce_dmg_pct · charge_dmg_pct · charge_speed_pct · max_ammo_pct · max_ammo_flat · reload_speed_pct · attack_speed_pct · accuracy_pct · def_pct · def_ignore_pct · enemy_def_down_pct · received_dmg(敵方受到傷害增加) · burst_cooldown(秒)</p>
              <p><b>damage stat</b>(type 為 damage): bonus_damage · burst_damage · damage (values 為傷害係數)</p>
              <p class="custom-help-note">清單中沒有的 stat・timing・target 會在計算中被忽略。不確定時請用最接近的標準值。</p>
            </div>
          </details>
          <button type="button" class="custom-btn" data-copy-prompt>① 複製提示詞</button>
          <textarea class="custom-json" data-custom-json placeholder="② 把結果 JSON 貼在這裡,或看說明自己寫" rows="8"></textarea>
          <div class="custom-actions"><button type="button" class="custom-btn primary" data-custom-submit>新增</button></div>
          <p class="custom-msg" data-custom-msg hidden></p>
          <div class="custom-list" data-custom-list></div>
        </div>
      </div>
    </div>
  `;

  const form = element<HTMLFormElement>(root, 'form');
  const squadGrid = element<HTMLElement>(root, '[data-squad-grid]');
  const deckTabs = element<HTMLElement>(root, '[data-deck-tabs]');
  const deckNote = element<HTMLElement>(root, '[data-deck-note]');
  const deckCopy = element<HTMLElement>(root, '[data-deck-copy]');
  const deckMoves = element<HTMLElement>(root, '[data-deck-moves]');
  const deckCopyOpen = element<HTMLButtonElement>(root, '[data-deck-copy-open]');
  const deckCopyPanel = element<HTMLElement>(root, '[data-deck-copy-panel]');
  const deckCopyTitle = element<HTMLElement>(root, '[data-deck-copy-title]');
  const deckCopyTargets = element<HTMLElement>(root, '[data-deck-copy-targets]');
  const deckCopyApply = element<HTMLButtonElement>(root, '[data-deck-copy-apply]');
  const deckCopyCancel = element<HTMLButtonElement>(root, '[data-deck-copy-cancel]');
  const status = element<HTMLElement>(root, '[data-status]');
  const errors = element<HTMLElement>(root, '[data-errors]');
  const submit = element<HTMLButtonElement>(root, 'button[type="submit"]');
  const resultPanel = element<HTMLElement>(root, '[data-result-panel]');
  const timelinePanel = element<HTMLElement>(root, '[data-timeline-panel]');
  // 타임라인은 «계산 결과가 있는가»와 «지금 계산기 화면인가» 둘 다 만족할 때만 보인다.
  let timelineHasContent = false;
  const timelineBody = element<HTMLElement>(root, '[data-timeline-body]');
  const coreToggle = element<HTMLInputElement>(root, '#has-core');
  const corePxInput = element<HTMLInputElement>(root, '#core-px');
  const rosterInput = element<HTMLInputElement>(root, '#roster-csv');
  const rosterNote = element<HTMLElement>(root, '[data-roster-note]');

  const activeDeck = () => decks[activeDeckId - 1]!;

  const showErrors = (messages: string[]) => {
    errors.replaceChildren();
    errors.hidden = messages.length === 0;
    for (const message of messages) errors.append(createText('p', message));
  };

  /** 덱 탭끼리 끌어 옮길 때 쓰는 종류. 니케 끌기와 섞이지 않게 따로 둔다. */
  const DRAG_DECK = 'application/x-nikke-deck';

  /**
   * 덱을 부르는 이름. 「0장 · 1장 · 2장」처럼 무엇을 바꿔 본 판인지 적어 두면
   * 결과·CSV·보고서에서 그대로 읽힌다. 이름을 붙여도 **번호는 남긴다** — 다섯 개가
   * 늘어서면 번호가 자리 이름 노릇을 한다.
   */
  const deckLabelFull = (deck: DeckState): string =>
    (deck.name?.trim() ? `${deck.id}. ${deck.name.trim()}` : `隊 ${deck.id}`);

  /** 결과·보고서가 쓰는 이름. 결과는 덱 객체가 아니라 번호만 들고 있다. */
  const deckNameOf = (id: number): string => {
    const deck = decks.find((entry) => entry.id === id);
    return deck ? deckLabelFull(deck) : `隊 ${id}`;
  };

  /** 탭 자리에서 이름을 고친다. Enter로 정하고, Esc로 되돌린다. */
  const renameDeck = (deck: DeckState, tab: HTMLElement) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'deck-name-input';
    input.dataset.deckName = String(deck.id);
    input.maxLength = 24;
    input.value = deck.name ?? '';
    input.placeholder = `隊 ${deck.id}`;
    input.title = '記下這是改了什麼的盤面(例:0階・1階・2階)';
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      if (save) {
        const next = input.value.trim();
        if (next) deck.name = next; else delete deck.name;
        saveState();
      }
      renderDeckTabs();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    tab.replaceChildren(input);
    input.focus();
    input.select();
  };

  /**
   * 덱을 다른 자리로 옮긴다. **번호는 자리 이름이라 그대로 두고 내용만 옮긴다** —
   * ‹ › 단추와 같은 규칙이다. 이름도 내용의 일부라 함께 따라간다.
   */
  const moveDeckTo = (fromId: number, toId: number) => {
    const from = decks.findIndex((deck) => deck.id === fromId);
    const to = decks.findIndex((deck) => deck.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const carried = decks.map((deck) => ({ name: deck.name, squad: deck.squad, characters: deck.characters, burstSequence: deck.burstSequence }));
    const [moved] = carried.splice(from, 1);
    carried.splice(to, 0, moved!);
    decks.forEach((deck, index) => {
      const next = carried[index]!;
      if (next.name === undefined) delete deck.name; else deck.name = next.name;
      deck.squad = next.squad;
      deck.characters = next.characters;
      if (next.burstSequence === undefined) delete deck.burstSequence;
      else deck.burstSequence = next.burstSequence;
    });
    // 옮긴 편성을 계속 보고 있게 한다 — 번호가 아니라 «그 편성»을 따라간다.
    activeDeckId = decks[to]!.id;
    closeDeckCopy();
    saveState();
    renderDeckTabs();
    renderSquad();
  };

  const renderDeckTabs = () => {
    deckTabs.replaceChildren();
    for (const deck of decks) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.deckTab = String(deck.id);
      button.className = deck.id === activeDeckId ? 'is-active' : '';
      const count = deck.squad.filter(Boolean).length;
      button.textContent = `${deckLabelFull(deck)}${count ? ` · ${count}` : ''}`;
      button.title = '按兩下可以命名。拖曳可以改變順序';
      // 이름 붙이기 — 두 번 누르면 그 자리에서 고친다. 창을 띄우면 다섯 개를
      // 연달아 이름 붙일 때 창을 다섯 번 여닫아야 한다.
      button.addEventListener('dblclick', (event) => {
        event.preventDefault();
        renameDeck(deck, button);
      });
      // 끌어서 순서 바꾸기. ‹ › 단추는 그대로 둔다 — 손가락으로 쓸 때는 그쪽이 낫다.
      button.draggable = true;
      button.addEventListener('dragstart', (event) => {
        (event as DragEvent).dataTransfer?.setData(DRAG_DECK, String(deck.id));
        if ((event as DragEvent).dataTransfer) (event as DragEvent).dataTransfer!.effectAllowed = 'move';
        button.classList.add('is-dragging');
      });
      button.addEventListener('dragend', () => button.classList.remove('is-dragging'));
      button.addEventListener('dragover', (event) => {
        if (!(event as DragEvent).dataTransfer?.types.includes(DRAG_DECK)) return;
        event.preventDefault();
        button.classList.add('is-drop');
      });
      button.addEventListener('dragleave', () => button.classList.remove('is-drop'));
      button.addEventListener('drop', (event) => {
        event.preventDefault();
        button.classList.remove('is-drop');
        const from = Number((event as DragEvent).dataTransfer?.getData(DRAG_DECK));
        if (Number.isFinite(from) && from !== deck.id) moveDeckTo(from, deck.id);
      });
      button.addEventListener('click', () => {
        // 보고 있던 덱을 다시 누르면 아무것도 하지 않는다. 여기서 탭을 다시 그리면
        // 방금 누른 단추가 사라져, 두 번 누르기(이름 고치기)가 성립하지 않는다.
        if (activeDeckId === deck.id) return;
        activeDeckId = deck.id;
        // 덱을 옮기면 판이 겨냥하는 칸도 그 덱 기준으로 다시 잡는다.
        const empty = deck.squad.findIndex((member) => !member);
        activeSlot = empty < 0 ? 0 : empty;
        // 패널은 '현재 덱' 기준이라 덱을 옮기면 닫는다 (열린 채로 두면 대상이 헷갈린다).
        closeDeckCopy();
        saveState();
        renderDeckTabs();
        renderSquad();
      });
      deckTabs.append(button);
      // 보고 있는 덱에만 연필을 붙인다. 다섯 개에 다 붙이면 줄이 두 배로 길어지고,
      // 이름은 «지금 보고 있는 덱»에 붙이는 것이라 그 자리에 있는 게 맞다.
      // (두 번 누르기로도 되지만, 그 방법만 두면 있는 줄을 모른다.)
      if (deck.id === activeDeckId) {
        const rename = document.createElement('button');
        rename.type = 'button';
        rename.className = 'deck-rename';
        rename.dataset.deckRename = String(deck.id);
        rename.textContent = '✎';
        rename.title = `為 ${deckLabelFull(deck)} 命名`;
        rename.ariaLabel = `為 ${deckLabelFull(deck)} 命名`;
        rename.addEventListener('click', () => renameDeck(deck, button));
        deckTabs.append(rename);
      }
    }

    // 여러 덱에 겹쳐 편성된 니케를 알린다. 막지는 않는다 — 딜러 하나만 바꿔 견주려고
    // 일부러 겹치는 쓰임이 정석이기 때문이다. 다만 실제 콘텐츠(유니온 레이드처럼 팀을
    // 동시에 내보내는 곳)에서는 같은 니케를 두 팀에 넣을 수 없어, 모르고 짜면 낭패다.
    if (fiveDeckMode) {
      const seen = new Map<string, number[]>();
      for (const deck of decks) {
        for (const name of new Set(deck.squad.filter(Boolean))) {
          seen.set(name, [...(seen.get(name) ?? []), deck.id]);
        }
      }
      const shared = [...seen].filter(([, ids]) => ids.length > 1);
      if (shared.length > 0) {
        deckNote.replaceChildren(
          createText('b', `多隊重複的妮姬 ${shared.length} 名:`),
          createText('span', shared.map(([name, ids]) => `${resolveDisplayName(name)}(隊 ${ids.join('·')})`).join(', ')),
          createText('em', ' — 若是為了比較故意重複,保留也沒關係。若是一次匯出的編成則不能重複。'),
        );
        deckNote.classList.add('is-dup');
      } else {
        deckNote.textContent = '不同隊伍之間可以重複編成同一個角色。';
        deckNote.classList.remove('is-dup');
      }
    }

    const moves = element<HTMLElement>(root, '[data-deck-moves]');
    moves.replaceChildren();

    // 덱 순서 바꾸기. 덱 «번호»는 자리 이름이라 그대로 두고 **내용만** 맞바꾼다 —
    // 번호까지 따라 움직이면 지금 보던 덱이 어디로 갔는지 알 수 없다.
    const swapDeck = (delta: number) => {
      const index = decks.findIndex((deck) => deck.id === activeDeckId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= decks.length) return;
      const a = decks[index]!;
      const b = decks[target]!;
      [a.squad, b.squad] = [b.squad, a.squad];
      [a.characters, b.characters] = [b.characters, a.characters];
      // 방금 옮긴 편성을 따라간다.
      activeDeckId = b.id;
      closeDeckCopy();
      saveState();
      renderDeckTabs();
      renderSquad();
    };
    for (const [delta, label, title] of [
      [-1, '‹', '往前'], [1, '›', '往後'],
    ] as const) {
      const move = document.createElement('button');
      move.type = 'button';
      move.className = 'deck-move';
      move.dataset.deckMove = String(delta);
      move.textContent = label;
      move.title = `把目前隊伍 ${title} 移動`;
      move.ariaLabel = `把隊伍 ${activeDeckId} ${title} 移動`;
      const index = decks.findIndex((deck) => deck.id === activeDeckId);
      move.disabled = index + delta < 0 || index + delta >= decks.length;
      move.addEventListener('click', () => swapDeck(delta));
      moves.append(move);
    }
  };

  // 덱 복사 — 같은 편성을 여러 덱에 깔아두고 딜러 한 자리만 바꿔 비교하는 용도다.
  // 편성(squad)과 캐릭터별 설정(characters)을 함께 복사해야 비교가 공정하다.
  const closeDeckCopy = () => {
    deckCopyPanel.hidden = true;
    deckCopyOpen.setAttribute('aria-expanded', 'false');
  };

  const renderDeckCopy = () => {
    const source = activeDeck();
    deckCopyTitle.textContent = `要把 ${deckLabelFull(source)} 的編成與角色設定複製到的對象`;
    deckCopyTargets.replaceChildren();
    for (const deck of decks) {
      if (deck.id === source.id) continue;
      const count = deck.squad.filter(Boolean).length;
      const label = document.createElement('label');
      label.className = 'deck-copy-target';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.deckCopyTarget = String(deck.id);
      // 비어 있는 덱은 잃을 게 없으므로 기본 선택. 이미 짜둔 덱은 사용자가 직접 고른다.
      box.checked = count === 0;
      label.append(
        box,
        createText('span', count === 0 ? `${deckLabelFull(deck)} · 空的` : `${deckLabelFull(deck)} · ${count} 名(覆寫)`,
          count === 0 ? undefined : 'deck-copy-warn'),
      );
      deckCopyTargets.append(label);
    }
  };

  const applyDeckCopy = () => {
    const source = activeDeck();
    const targets = Array.from(
      deckCopyTargets.querySelectorAll<HTMLInputElement>('[data-deck-copy-target]'),
    ).filter((box) => box.checked).map((box) => Number(box.dataset.deckCopyTarget));
    if (targets.length === 0) {
      showErrors(['請至少選擇一個要複製的目標隊伍。']);
      return;
    }
    for (const id of targets) {
      const target = decks[id - 1];
      if (!target) continue;
      target.squad = [...source.squad];
      target.characters = Object.fromEntries(
        Object.entries(source.characters).map(([name, value]) => [name, cloneOverride(value)]),
      );
    }
    // 슬롯별 캐릭터 필터는 화면 상태일 뿐이라 같이 옮겨 검색어가 남지 않게 한다.

    closeDeckCopy();
    showErrors([]);
    saveState();
    renderDeckTabs();
    status.textContent = `已把隊伍 ${source.id} 複製到 ${targets.map((id) => `隊 ${id}`).join(' · ')}。`;
  };

  deckCopyOpen.addEventListener('click', () => {
    if (deckCopyPanel.hidden) {
      renderDeckCopy();
      deckCopyPanel.hidden = false;
      deckCopyOpen.setAttribute('aria-expanded', 'true');
    } else {
      closeDeckCopy();
    }
  });
  deckCopyCancel.addEventListener('click', closeDeckCopy);
  deckCopyApply.addEventListener('click', applyDeckCopy);

  // 최근 계산에서 나온 「누가 이 버프를 받았나」. 덱 단위로 들고 있다가 카드에 얹는다.
  // 계산 전에는 비어 있고, 그때는 빈 괄호로 자리만 잡는다.
  // 값과 함께 **무엇을 계산한 결과인가**(편성 + 개별 설정)를 적어 둔다. 편성이나
  // 스펙을 바꾸면 대상이 달라질 수 있으므로, 서명이 어긋나면 지난 값을 쓰지 않는다.
  const buffTargetsByDeck = new Map<number, { sig: string; rows: Record<string, BuffTargetRow[]> }>();

  const deckSignature = (deck: DeckState): string =>
    JSON.stringify([deck.squad, deck.characters]);

  // ── 버프 대상 미리 계산 ──────────────────────────────────────────────────
  // 수령자는 실제 발동 로그에서만 나온다(대상이 최종 공격력으로 갈리고 전투 중
  // 바뀌기도 한다). 그래서 계산 버튼을 누르기 전에 **배경으로 한 번 돌려** 미리
  // 채운다. 결과는 정식 계산과 같은 캐시를 쓰므로 이어서 «실행»을 눌러도 덤이 없다.
  let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
  let prefetching = false;
  // 배경 계산이 도는 덱. 그 사이 화면에는 `[계산중]`으로 나온다.
  let prefetchingDeckId: number | undefined;

  const needsPrefetch = (deck: DeckState): boolean => {
    if (!deck.squad.some((name) => name && settings.buffTargetWatch?.[name])) return false;
    return buffTargetsByDeck.get(deck.id)?.sig !== deckSignature(deck);
  };

  const prefetchBuffTargets = () => {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(async () => {
      // 정식 계산이 도는 중이면 워커를 뺏지 않는다 — 끝나면 어차피 채워진다.
      if (prefetching || submit.disabled) return;
      const deck = activeDeck();
      if (!needsPrefetch(deck)) return;
      prefetching = true;
      prefetchingDeckId = deck.id;
      renderSquad();
      try {
        await prepared;
        const custom = customPayload();
        const request = requestForDeck(deck, readBattle(),
          Object.keys(custom).length > 0 ? custom : undefined);
        // 화면이 «값이 잘못됐다»고 막을 편성은 미리 계산도 하지 않는다. 요청 검증만
        // 보면 스킬 레벨 0 같은 값이 그대로 통과해, 사람이 실행을 막힌 사이에 미리
        // 계산만 몰래 한 번 도는 일이 생긴다.
        if (validateRequest(request).length > 0) return;
        if (validateCharacterValues(deck).length > 0) return;
        const key = cacheKey(request, version);
        let result = cache.get(key);
        if (!result) {
          result = await client.simulate(request);
          cache.set(key, result);
        }
        // 기다리는 사이 편성이 바뀌었을 수 있다 — 서명이 맞을 때만 반영한다.
        const now = activeDeck();
        if (now.id !== deck.id || deckSignature(now) !== deckSignature(deck)) return;
        if (result.buffTargets) {
          buffTargetsByDeck.set(deck.id, { sig: deckSignature(deck), rows: result.buffTargets });
          saveState();
          renderSquad();
        }
      } catch {
        /* 미리 계산은 편의 기능이다 — 실패해도 조용히 넘어간다 */
      } finally {
        prefetching = false;
        prefetchingDeckId = undefined;
        renderSquad();
      }
    }, 700);
  };


  /** 이 덱에서 감시 대상 버프를 가진 캐릭터의 표시 줄. 아직 안 돌렸으면 빈 대상. */
  const buffTargetRowsFor = (deckId: number, name: string): BuffTargetRow[] | undefined => {
    const deck = decks.find((d) => d.id === deckId);
    const saved = buffTargetsByDeck.get(deckId);
    const known = deck && saved && saved.sig === deckSignature(deck)
      ? saved.rows[name] : undefined;
    if (known) return known;
    const watched = settings.buffTargetWatch?.[name];
    if (!watched) return undefined;
    const pending = prefetchingDeckId === deckId;
    return watched.map((w) => ({ ...w, targets: [] as string[], count: 0, pending }));
  };

  // 「순서보기」 — 버프가 발동할 때마다 누가 받았는지 초상화로 죽 편다.
  // 대상이 갈리는 편성에서는 이 순서 자체가 정보다(앨리스-홍련-앨리스-홍련…).
  const buffOrderModal = element<HTMLElement>(root, '[data-buff-order-modal]');
  const showBuffOrder = (caster: string, row: BuffTargetRow) => {
    element<HTMLElement>(root, '[data-buff-order-title]').textContent =
      `${resolveDisplayName(caster)} · ${row.label}`;
    element<HTMLElement>(root, '[data-buff-order-desc]').textContent =
      row.targets.length > 1
        ? `${row.buff} — 發動 ${row.count} 次。對象在 ${row.targets.length} 人之間分配。`
        : `${row.buff} — 發動 ${row.count} 次。整場戰鬥都是同一對象。`;
    const list = element<HTMLElement>(root, '[data-buff-order-list]');
    list.replaceChildren();
    for (const [index, step] of (row.sequence ?? []).entries()) {
      const item = document.createElement('div');
      item.className = 'buff-order-step';
      item.dataset.buffOrderStep = String(index);
      const meta = catalogByName.get(step.target);
      const shot = document.createElement('div');
      shot.className = 'buff-order-portrait';
      if (meta?.image) {
        const img = document.createElement('img');
        img.src = `${import.meta.env.BASE_URL}${meta.image}`;
        img.alt = '';
        img.loading = 'lazy';
        shot.append(img);
      }
      item.append(shot);
      item.append(createText('strong', step.target));
      item.append(createText('span', `${step.t.toFixed(2)}秒`));
      list.append(item);
    }
    buffOrderModal.hidden = false;
  };
  element<HTMLButtonElement>(root, '[data-buff-order-close]').addEventListener('click', () => {
    buffOrderModal.hidden = true;
  });
  buffOrderModal.addEventListener('click', (event) => {
    if (event.target === buffOrderModal) buffOrderModal.hidden = true;
  });

  // ── 업데이트 공지 ───────────────────────────────────────────────────────
  // 본 적 있는 공지 id를 적어 둔다. 새 공지가 올라오면 id가 달라져 다시 뜬다.
  const NOTICE_KEY = 'nikke-notice-seen';
  const noticeModal = element<HTMLElement>(root, '[data-notice-modal]');
  const noticeBody = element<HTMLElement>(root, '[data-notice-body]');

  const renderNotices = () => {
    noticeBody.replaceChildren();
    for (const notice of NOTICES) {
      const block = document.createElement('section');
      block.className = 'notice-entry';
      block.dataset.notice = notice.id;
      const head = document.createElement('div');
      head.className = 'notice-head';
      head.append(createText('b', notice.date), createText('span', notice.title));
      block.append(head);
      const list = document.createElement('ul');
      for (const item of notice.items) {
        const row = document.createElement('li');
        const tag = createText('em', item.tag, 'notice-tag');
        tag.dataset.noticeTag = item.tag;
        const body = document.createElement('span');
        body.append(noticeFragment(item.text));
        row.append(tag, body);
        list.append(row);
      }
      block.append(list);
      noticeBody.append(block);
    }
  };

  const openNotice = () => {
    renderNotices();
    noticeModal.hidden = false;
  };
  /** 닫으면 최신 공지를 본 것으로 적는다 — 새 공지가 나오기 전까지 다시 뜨지 않는다. */
  const closeNotice = () => {
    noticeModal.hidden = true;
    try {
      resolveStorage()?.setItem(NOTICE_KEY, LATEST_NOTICE_ID);
    } catch {
      /* 저장 실패는 무시 — 다음에 한 번 더 뜰 뿐이다 */
    }
  };
  element<HTMLButtonElement>(root, '[data-notice-open]').addEventListener('click', openNotice);
  element<HTMLButtonElement>(root, '[data-notice-close]').addEventListener('click', closeNotice);
  element<HTMLButtonElement>(root, '[data-notice-dismiss]').addEventListener('click', closeNotice);
  noticeModal.addEventListener('click', (event) => {
    if (event.target === noticeModal) closeNotice();
  });
  {
    let seen: string | null = null;
    try {
      seen = resolveStorage()?.getItem(NOTICE_KEY) ?? null;
    } catch {
      /* 못 읽으면 처음 온 것으로 본다 */
    }
    if (noticeToShow(seen)) openNotice();
  }

  // ── 캐릭터 설정 창 ──────────────────────────────────────────────────────
  // 어떤 캐릭터의 어느 뭉치를 보고 있는지 기억한다. 값을 바꾸면 카드가 다시 그려지고
  // 뭉치도 새로 만들어지므로, 그때마다 새 뭉치를 창에 다시 넣어 준다.
  const charPanelModal = element<HTMLElement>(root, '[data-char-panel-modal]');
  const charPanelBody = element<HTMLElement>(root, '[data-char-panel-body]');
  const charPanelTitle = element<HTMLElement>(root, '[data-char-panel-title]');
  let openCharPanel: { name: string; kind: CharPanelKind } | null = null;

  const placeCharPanel = (panel: HTMLElement, name: string, label: string) => {
    panel.hidden = false;
    charPanelBody.replaceChildren(panel);
    charPanelTitle.textContent = `${resolveDisplayName(name)} · ${label}`;
    charPanelModal.hidden = false;
  };
  const closeCharPanel = () => {
    openCharPanel = null;
    charPanelBody.replaceChildren();
    charPanelModal.hidden = true;
  };
  element<HTMLButtonElement>(root, '[data-char-panel-close]').addEventListener('click', closeCharPanel);
  charPanelModal.addEventListener('click', (event) => {
    if (event.target === charPanelModal) closeCharPanel();
  });

  // ── 끌어다 놓기 ─────────────────────────────────────────────────────────
  // 누르는 길(칸을 고르고 카드를 누른다)은 그대로 두고 «끌어다 놓기»를 더한다.
  // 손가락에서는 HTML 끌기가 동작하지 않으므로, 누르는 길이 없어지면 안 된다.
  const DRAG_NAME = 'application/x-nikke-name';   // 니케 고르기 → 칸
  const DRAG_SLOT = 'application/x-nikke-slot';   // 칸 → 칸 (자리 맞바꾸기)

  /** 이 끌기가 우리 것인가. `dragover`에서는 값이 아니라 종류만 볼 수 있다. */
  const dragKind = (event: DragEvent): 'name' | 'slot' | null => {
    const types = event.dataTransfer?.types;
    if (!types) return null;
    const has = (type: string) => Array.prototype.includes.call(types, type);
    if (has(DRAG_NAME)) return 'name';
    if (has(DRAG_SLOT)) return 'slot';
    return null;
  };

  /** 칸 하나를 받는 자리로 만든다. */
  const makeDropTarget = (card: HTMLElement, index: number) => {
    const lit = (on: boolean) => card.classList.toggle('is-drop', on);
    card.addEventListener('dragover', (event) => {
      const kind = dragKind(event as DragEvent);
      if (!kind) return;
      event.preventDefault();                  // 이걸 해야 놓을 수 있다
      (event as DragEvent).dataTransfer!.dropEffect = kind === 'slot' ? 'move' : 'copy';
      lit(true);
    });
    card.addEventListener('dragleave', () => lit(false));
    card.addEventListener('drop', (event) => {
      const drag = event as DragEvent;
      const kind = dragKind(drag);
      if (!kind) return;
      event.preventDefault();
      lit(false);
      const deck = activeDeck();
      if (kind === 'slot') {
        const from = Number(drag.dataTransfer!.getData(DRAG_SLOT));
        if (!Number.isInteger(from) || from < 0 || from > 4 || from === index) return;
        // 자리만 맞바꾼다. 개별 설정은 이름에 걸려 있어 슬롯과 무관하다.
        [deck.squad[index], deck.squad[from]] = [deck.squad[from] ?? '', deck.squad[index] ?? ''];
        showErrors([]);
        saveState();
        renderDeckTabs();
        renderSquad();
        renderRosterGrid();
        return;
      }
      const name = drag.dataTransfer!.getData(DRAG_NAME);
      if (!name || !catalogByName.has(name)) return;
      // 한 덱에 같은 니케를 두 번 넣을 수 없다 — 누르는 길에서 막는 것과 같은 규칙이다.
      const already = deck.squad.indexOf(name);
      if (already >= 0 && already !== index) {
        showErrors([`${resolveDisplayName(name)} 已經在第 ${already + 1} 格。`]);
        return;
      }
      pickCharacter(name, index);
    });
  };

  /**
   * 「다른 니케에서 베껴오기」 — 아직 못 뽑았거나 안 키운 니케를 재 볼 때, 이미 키운
   * 니케의 육성값을 그대로 옮겨 온다. 하나씩 다시 입력하는 게 가장 잦은 수고였다.
   *
   * 옮기는 것은 **육성값뿐**이다 — 돌파·스킬·오버로드·장비 강화·소장품. 컨트롤과
   * 버스트 운용은 그 캐릭터의 조작이라 건드리지 않고, 큐브도 각자 고르는 것이라 둔다.
   */
  const copyFromControl = (name: string): HTMLElement => {
    const box = document.createElement('details');
    box.className = 'copy-from';
    box.dataset.copyFrom = name;
    const head = document.createElement('summary');
    head.textContent = '從其他妮姬複製';
    head.title = '沿用已養成妮姬的突破・技能・超載・裝備強化・收藏品';
    box.append(head);

    // 후보 = 어딘가에 설정이 잡혀 있는 니케(불러온 로스터 · 다섯 덱 어디든).
    const sources = new Map<string, CharacterOverrides>();
    for (const [who, value] of Object.entries(roster)) {
      if (who !== name && value) sources.set(who, value);
    }
    for (const deck of decks) {
      for (const [who, value] of Object.entries(deck.characters)) {
        if (who !== name && value) sources.set(who, value);
      }
    }
    if (sources.size === 0) {
      box.append(createText('p', '還沒有可複製的設定 — 請先用 CSV・Blablalink 匯入,或先設定其他妮姬。', 'field-note'));
      return box;
    }

    const pick = document.createElement('select');
    pick.dataset.copyFromPick = '';
    for (const who of [...sources.keys()].sort((a, b) => a.localeCompare(b, 'ko'))) {
      const option = document.createElement('option');
      option.value = who;
      option.textContent = who;
      pick.append(option);
    }
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'copy-from-apply';
    apply.dataset.copyFromApply = '';
    apply.textContent = '複製';
    apply.addEventListener('click', () => {
      const from = sources.get(pick.value);
      if (!from) return;
      const deck = activeDeck();
      const target = settings.characters[name];
      const next: CharacterOverrides = { ...cloneOverride(deck.characters[name] ?? {}) };
      const carried: string[] = [];
      if (from.growthStage !== undefined && target) {
        // 돌파 상한은 등급마다 다르다 — SSR 값을 SR에 그대로 부으면 안 된다.
        next.growthStage = Math.min(from.growthStage, target.maxGrowthStage);
        carried.push('突破');
      }
      // 수치 미공개(임시·프리뷰) 캐릭터는 스킬 Lv10 고정이라 건너뛴다.
      if (from.skillLevels && !target?.skillLevelsLocked) {
        next.skillLevels = { ...from.skillLevels };
        carried.push('技能');
      }
      if (from.overload) { next.overload = { ...from.overload }; carried.push('超載'); }
      if (from.equipLevels) { next.equipLevels = { ...from.equipLevels }; carried.push('裝備強化'); }
      if (from.collection) {
        // 애장품이 없는 캐릭터에 애장품 단계를 옮기면 없는 물건을 낀 셈이 된다.
        next.collection = target?.favoriteItem
          ? { ...from.collection }
          : { stage: from.collection.stage, favorite: 0 };
        carried.push('收藏品');
      }
      if (carried.length === 0) {
        status.textContent = `${resolveDisplayName(pick.value)} 沒有可複製的養成值。`;
        return;
      }
      deck.characters[name] = next;
      saveState();
      renderSquad();
      status.textContent = `已把 ${resolveDisplayName(pick.value)} 的 ${carried.join(' · ')} 複製給 ${resolveDisplayName(name)}。`;
    });
    const row = document.createElement('div');
    row.className = 'copy-from-row';
    row.append(pick, apply);
    box.append(row, createText('p', '沿用突破・技能・超載・裝備強化・收藏品。操作・爆裂運用・魔方維持不變。', 'field-note'));
    return box;
  };

  const renderSquad = () => {
    const deck = activeDeck();
    // 버스트 순서는 편성에 매여 있다 — 편성이 바뀌면 배지도 따라간다.
    renderBurstBadge();
    squadGrid.replaceChildren();
    for (let index = 0; index < 5; index += 1) {
      const name = deck.squad[index] ?? '';
      const char = catalogByName.get(name);
      const card = document.createElement('article');
      card.className = 'squad-slot';
      card.dataset.slotCard = String(index);
      card.classList.toggle('is-preview', Boolean(char?.preview));
      makeDropTarget(card, index);
      if (name) {
        // 채워진 칸은 집어서 다른 칸에 놓을 수 있다 — ‹ › 단추와 같은 «자리 맞바꾸기»다.
        card.draggable = true;
        card.addEventListener('dragstart', (event) => {
          const drag = event as DragEvent;
          drag.dataTransfer?.setData(DRAG_SLOT, String(index));
          drag.dataTransfer?.setData('text/plain', name);
          if (drag.dataTransfer) drag.dataTransfer.effectAllowed = 'move';
          card.classList.add('is-dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
      }

      const top = document.createElement('div');
      top.className = 'slot-top';
      const portrait = document.createElement('div');
      portrait.className = 'portrait-wrap';
      // 슬롯 번호와 속성 아이콘은 좌상단에 나란히 선다. 번호 폭이 자릿수에 따라
      // 달라져도 아이콘이 겹치지 않도록 절대배치 대신 한 줄로 묶는다.
      const tags = document.createElement('div');
      tags.className = 'slot-tags';
      tags.append(createText('span', `0${index + 1}`, 'slot-number'));
      if (char) {
        const codeIcon = createElementIcon(char.elementCode, 'slot-code');
        if (codeIcon) tags.append(codeIcon);
      }
      portrait.append(tags, createText('div', '', 'portrait-fallback'));

      // 자리 이동. 니케는 배치 순서가 전투에 영향을 주므로 캐릭터를 다시 고르지 않고
      // 자리만 맞바꿀 수 있어야 한다. 이름으로 걸린 설정(deck.characters)은 슬롯과
      // 무관하니 그대로 두고, 슬롯에 매인 편성과 검색어만 맞바꾼다.
      const moves = document.createElement('div');
      moves.className = 'slot-moves';
      for (const [delta, label, title] of [
        [-1, '‹', '往左'], [1, '›', '往右'],
      ] as const) {
        const move = document.createElement('button');
        move.type = 'button';
        move.className = 'slot-move';
        move.dataset.slotMove = `${index}:${delta}`;
        move.textContent = label;
        move.title = `${title} 移動`;
        move.ariaLabel = `格 ${index + 1} ${title} 移動`;
        const target = index + delta;
        move.disabled = target < 0 || target > 4;
        move.addEventListener('click', () => {
          [deck.squad[index], deck.squad[target]] = [deck.squad[target] ?? '', deck.squad[index] ?? ''];
          showErrors([]);
          saveState();
          renderDeckTabs();
          renderSquad();
        });
        moves.append(move);
      }
      portrait.append(moves);
      if (char?.image) {
        const image = document.createElement('img');
        image.src = `${import.meta.env.BASE_URL}${char.image}`;
        image.alt = `${char.displayName ?? char.name} 肖像`;
        image.loading = 'lazy';
        portrait.append(image);
      }
      const identity = document.createElement('div');
      identity.className = 'slot-identity';

      // 이름 검색과 드롭다운, 교체 버튼을 걷어냈다. 카드는 «지금 채울 칸»을 정하는
      // 역할만 하고, 고르는 일은 아래 상시 판이 맡는다. 검색 결과가 어디에도 숨지
      // 않게 하는 것이 이 화면의 요점이다.
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'slot-choose';
      choose.dataset.slotChoose = String(index);
      // 판이 닫혀 있으면 어느 칸도 고른 상태로 보이지 않는다 — 고를 상황이 아니면
      // 겨냥한 칸도 없는 게 맞다.
      choose.setAttribute('aria-pressed', String(pickerOpen && activeSlot === index));
      choose.append(createText('strong', char ? (char.displayName ?? char.name) : '空格'));
      choose.append(createText(
        'span',
        char ? `B${char.burstStage} · ${termZh(char.elementCode)} · ${char.weaponType}` : '點此放入此格',
      ));
      choose.addEventListener('click', () => {
        // 같은 칸을 다시 누르면 접는다 — 켜고 끄는 자리가 한 곳이면 헷갈리지 않는다.
        const same = pickerOpen && activeSlot === index;
        activeSlot = index;
        pullActiveSlot = !same;
        setPickerOpen(!same);
      });
      // 좁은 화면에서는 슬롯 줄이 옆으로 밀린다. 겨냥한 칸이 화면 밖에 있으면
      // 판이 어디를 채우는지 알 수 없으므로 끌어다 보여 준다.
      // jsdom에는 scrollIntoView가 없다. 없다고 렌더가 깨질 일은 아니므로 건너뛴다.
      if (pullActiveSlot && activeSlot === index && typeof choose.scrollIntoView === 'function') {
        requestAnimationFrame(() => choose.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      }

      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'slot-clear';
      clear.textContent = '✕';
      clear.title = `清空第 ${index + 1} 格`;
      clear.ariaLabel = `清空第 ${index + 1} 格`;
      clear.hidden = !name;
      clear.addEventListener('click', () => {
        if (name) delete deck.characters[name];
        deck.squad[index] = '';
        activeSlot = index;
        showErrors([]);
        saveState();
        renderDeckTabs();
        // 비운 칸은 다시 채우려는 참이다 — 판을 열어 둔다.
        setPickerOpen(true);
        renderRosterGrid();
      });

      identity.append(choose, clear);
      top.append(portrait, identity);
      card.append(top);
      if (char) {
        const editor = document.createElement('div');
        const cname = char.name;
        /**
         * 창 안의 뭉치를 카드가 방금 그린 새 것으로 바꾼다. 값 하나를 바꾸면
         * `renderCharacterSettings`가 스스로 카드를 다시 그리는데, 그때 창에는 **옛
         * 뭉치**가 남아 있어 «직접 설정»으로 켠 체크박스가 여전히 잠겨 보였다.
         */
        const syncOpenPanel = () => {
          if (openCharPanel?.name !== cname || charPanelModal.hidden) return;
          const kind = openCharPanel.kind;
          // 그 뭉치를 여는 단추가 사라졌으면(개별 설정을 껐다) 창도 닫는다.
          const opener = editor.querySelector<HTMLElement>(`[data-char-panel-open="${kind}"]`);
          if (!opener) { closeCharPanel(); return; }
          // 없으면 이미 창에 있는 것이 최신이다 — 두 번 불려도 닫지 않는다.
          const fresh = editor.querySelector<HTMLElement>(`[data-char-panel="${kind}"]`);
          if (!fresh) return;
          placeCharPanel(fresh, cname, opener.querySelector('.disclosure-label')?.getAttribute('title') ?? '');
        };
        const renderEditor = () => {
          renderCharacterSettings(editor, cname, settings, deck.characters[cname], (next) => {
            if (next) deck.characters[cname] = next;
            else delete deck.characters[cname];
            saveState();
            // 개별 설정 안 드롭다운으로 돌파를 바꿔도 초상화의 별이 따라가게 한다.
            renderGrowthStepper();
            // 이 콜백은 카드가 다시 그려지기 **직전**에 불린다 — 다 그린 뒤에 창을 맞춘다.
            queueMicrotask(syncOpenPanel);
          }, buffTargetRowsFor(deck.id, cname), (row) => showBuffOrder(cname, row),
          (kind, panel, label) => {
            openCharPanel = { name: cname, kind };
            placeCharPanel(panel, cname, label);
          },
          // 조합 조건부 컨트롤(아인 + 에이다 = 홀드)을 카드가 스스로 판정하게 한다.
          deck.squad.filter((slot): slot is string => Boolean(slot)));
          syncOpenPanel();
        };

        // 초상화 우측하단의 돌파·코어 강화 스테퍼. blablalink 도감처럼 별 + 진화 숫자로
        // 명함~풀코를 한눈에 보이고, 좌우 −/+로 바로 조절한다. 개별 설정을 펼치지 않아도
        // 손이 닿는 자리다. R(성장 없음)은 조절할 게 없으니 아예 그리지 않는다.
        const growthDefaults = settings.characters[cname];
        const maxStage = growthDefaults?.maxGrowthStage ?? 0;
        const defStage = growthDefaults?.growthStage ?? 0;
        const stepper = document.createElement('div');
        stepper.className = 'growth-stepper';
        stepper.dataset.growthStepper = String(index);
        const stars = document.createElement('div');
        stars.className = 'growth-stars';
        const minus = document.createElement('button');
        minus.type = 'button';
        minus.className = 'growth-step';
        minus.dataset.growthStep = 'minus';
        minus.textContent = '−';
        const plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'growth-step';
        plus.dataset.growthStep = 'plus';
        plus.textContent = '+';
        const stageOf = (): number => deck.characters[cname]?.growthStage ?? defStage;
        const labelOf = (stage: number): string =>
          growthDefaults?.growthOptions.find((option) => option.value === stage)?.label
          ?? `階段 ${stage}`;
        function renderGrowthStepper(): void {
          const stage = stageOf();
          const slots = Math.min(maxStage, 3);
          const core = Math.max(0, stage - 3);
          stars.replaceChildren();
          for (let i = 0; i < slots; i += 1) {
            // 별 그림은 blablalink 도감의 스프라이트(25프레임)를 그대로 쓴다 — CSS에서
            // 채워진 별/빈 별 프레임을 background-position으로 고른다.
            const star = document.createElement('span');
            star.className = i < Math.min(stage, 3) ? 'growth-star is-on' : 'growth-star';
            stars.append(star);
          }
          // 진화 뱃지는 도감처럼 0일 때도 자리를 지킨다 — 켜졌다 꺼졌다 하면
          // 별 줄의 폭이 흔들려 카드가 들썩인다.
          const badge = document.createElement('span');
          badge.className = 'growth-core';
          badge.append(createText('span', String(core)));
          stars.append(badge);
          minus.disabled = stage <= 0;
          plus.disabled = stage >= maxStage;
          const text = labelOf(stage);
          minus.ariaLabel = `把 ${resolveDisplayName(cname)} 突破降一階(目前 ${text})`;
          plus.ariaLabel = `把 ${resolveDisplayName(cname)} 突破升一階(目前 ${text})`;
          stepper.title = `突破・核心強化 · ${text}`;
        }
        const setStage = (next: number) => {
          const clamped = Math.max(0, Math.min(maxStage, next));
          if (clamped === stageOf()) return;
          const base = deck.characters[cname];
          const override = base ? cloneOverride(base) : {};
          if (clamped === defStage) delete override.growthStage;
          else override.growthStage = clamped;
          if (Object.keys(override).length === 0) delete deck.characters[cname];
          else deck.characters[cname] = override;
          saveState();
          renderGrowthStepper();
          renderEditor();
        };
        minus.addEventListener('click', () => setStage(stageOf() - 1));
        plus.addEventListener('click', () => setStage(stageOf() + 1));
        if (maxStage > 0) {
          stepper.append(minus, stars, plus);
          renderGrowthStepper();
          portrait.append(stepper);
        }

        renderEditor();
        card.append(editor);
        card.append(copyFromControl(cname));
      }
      squadGrid.append(card);
    }
    pullActiveSlot = false;
    // 편성·개별 설정·덱 전환이 모두 이 함수를 지난다 — 미리 계산 예약은 여기 한 곳.
    prefetchBuffTargets();
  };

  // ── 콘솔 ────────────────────────────────────────────────────────────────
  // 클래스·기업은 소속별로 따로 큰다. 목록은 카탈로그가 정본이라(로스터에서 뽑는다)
  // 신규 기업·클래스가 생겨도 코드는 그대로다.
  //
  // 만든 입력을 Map으로 들고 읽고 쓴다 — 소속명이 그대로 들어가는 선택자를 쓰면
  // 이스케이프에 기대게 되고(`CSS.escape`), 그 API가 없는 환경에서 통째로 깨진다.
  const CONSOLE_DEFAULTS = { common: 180, class: 100, company: 100 } as const;
  const consoleInputs: Record<'class' | 'company', Map<string, HTMLInputElement>> = {
    class: new Map(),
    company: new Map(),
  };
  let consoleCommon!: HTMLInputElement;

  const consoleBuckets = (axis: 'class' | 'company'): string[] =>
    axis === 'class' ? settings.consoleClasses : settings.consoleCompanies;

  const renderConsole = () => {
    const grid = element<HTMLElement>(root, '[data-console-grid]');
    grid.replaceChildren();
    consoleInputs.class.clear();
    consoleInputs.company.clear();

    const field = (label: string, value: number): [HTMLLabelElement, HTMLInputElement] => {
      const wrap = document.createElement('label');
      const text = document.createElement('span');
      text.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '1000';
      input.step = '1';
      input.value = String(value);
      wrap.append(text, input);
      return [wrap, input];
    };
    const group = (title: string, nodes: HTMLElement[]) => {
      const box = document.createElement('div');
      box.className = 'console-group';
      box.append(createText('h4', title), ...nodes);
      return box;
    };

    const [commonWrap, commonInput] = field('全部', CONSOLE_DEFAULTS.common);
    commonInput.id = 'console-common';
    consoleCommon = commonInput;

    const axisGroup = (axis: 'class' | 'company', title: string) => group(
      title,
      consoleBuckets(axis).map((bucket) => {
        // 값(엔진에 보내는 한국어 소속명)은 그대로 두고 보이는 글자만 바꾼다.
        const [wrap, input] = field(termZh(bucket), CONSOLE_DEFAULTS[axis]);
        input.dataset.consoleBucket = `${axis}:${bucket}`;
        consoleInputs[axis].set(bucket, input);
        return wrap;
      }),
    );

    grid.append(
      // 인게임·블라블라링크와 같은 순서 — 공통 → 기업 → 클래스.
      group('共通', [commonWrap]),
      axisGroup('company', '企業'),
      axisGroup('class', '職業'),
    );
  };
  renderConsole();

  const readConsoleBuckets = (axis: 'class' | 'company'): Record<string, number> =>
    Object.fromEntries([...consoleInputs[axis]].map(([bucket, input]) => [bucket, Number(input.value)]));

  const writeConsoleBuckets = (axis: 'class' | 'company', levels: Record<string, number>) => {
    for (const [bucket, input] of consoleInputs[axis]) {
      const level = levels[bucket];
      if (level !== undefined) input.value = String(level);
    }
  };

  // ── 적정거리 ────────────────────────────────────────────────────────────
  // 무기군마다 적과의 적정 사거리가 달라, 같은 전투에서도 어떤 무기군은 적정거리에
  // 들고 어떤 무기군은 못 든다 → 여럿을 함께 켤 수 있어야 한다.
  // 목록 정본은 `data/weapon_mechanics.json`(설정으로 내려온다). 콘솔과 같은 이유로
  // 선택자 대신 Map으로 들고 읽고 쓴다.
  const rangeInputs = new Map<string, HTMLInputElement>();

  const renderOptimalRange = () => {
    const box = element<HTMLElement>(root, '[data-optimal-range]');
    box.replaceChildren();
    rangeInputs.clear();
    // 적정거리가 없는 무기군(런처)은 아예 그리지 않는다 — 켤 수 있게 두면
    // 인게임에 없는 보정을 켜게 된다. 목록의 정본은 무기 데이터다.
    for (const weapon of settings.optimalRangeWeapons ?? settings.weaponTypes) {
      const label = document.createElement('label');
      label.className = 'range-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.optimalRangeWeapon = weapon;
      label.append(input, createText('span', weapon));
      box.append(label);
      rangeInputs.set(weapon, input);
    }
  };
  renderOptimalRange();

  // ── 평타 계수 ───────────────────────────────────────────────────────────
  // 시뮬은 쏜 탄이 전부 맞는다고 보지만 인게임은 탄퍼짐으로 빗나간다. 무기군마다
  // 퍼짐이 다르므로 무기군 단위로 받고, 기본값은 설정(데이터)에서 내려온다.
  const coeffInputs = new Map<string, HTMLInputElement>();

  const renderHitCoeff = () => {
    const box = element<HTMLElement>(root, '[data-hit-coeff]');
    box.replaceChildren();
    coeffInputs.clear();
    for (const weapon of settings.weaponTypes) {
      const label = document.createElement('label');
      label.className = 'coeff-option';
      label.append(createText('span', weapon));
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '2';
      input.step = '0.01';
      input.dataset.hitCoeffWeapon = weapon;
      input.value = String(settings.normalHitCoeff?.[weapon] ?? 1);
      label.append(input);
      box.append(label);
      coeffInputs.set(weapon, input);
    }
  };
  renderHitCoeff();

  const readHitCoeff = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [weapon, input] of coeffInputs) out[weapon] = Number(input.value);
    return out;
  };

  const writeHitCoeff = (values: Record<string, number> | undefined) => {
    for (const [weapon, input] of coeffInputs) {
      const v = values?.[weapon] ?? settings.normalHitCoeff?.[weapon] ?? 1;
      input.value = String(v);
    }
  };

  // ── 보스 페이즈 (족자 · 속저) ───────────────────────────────────────────
  // 구간은 개수가 정해지지 않아 입력을 미리 만들어 둘 수 없다 — 배열을 정본으로
  // 들고 그릴 때마다 새로 만든다. 입력값이 잘못돼도(시작>끝) 지우지 않고 그대로
  // 두고, 실행할 때 검증 메시지로 알린다.
  let immuneWindows: PhaseWindow[] = [];
  let elementWindows: ElementWindow[] = [];

  const renderPhases = () => {
    const list = element<HTMLElement>(root, '[data-phase-list]');
    list.replaceChildren();

    const numberField = (value: number, onInput: (v: number) => void) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '180';
      input.step = '0.1';
      input.value = String(value);
      input.addEventListener('input', () => onInput(Number(input.value)));
      return input;
    };

    const row = (kind: 'immune' | 'element', index: number, from: number, to: number) => {
      const box = document.createElement('div');
      box.className = `phase-row is-${kind}`;
      box.dataset.phaseRow = `${kind}:${index}`;
      box.append(createText('span', kind === 'immune' ? '免疫' : '屬濾', 'phase-tag'));
      box.append(numberField(from, (v) => {
        if (kind === 'immune') immuneWindows[index]!.from = v;
        else elementWindows[index]!.from = v;
        saveState();
      }));
      box.append(createText('span', '~', 'phase-sep'));
      box.append(numberField(to, (v) => {
        if (kind === 'immune') immuneWindows[index]!.to = v;
        else elementWindows[index]!.to = v;
        saveState();
      }));
      box.append(createText('span', '秒', 'phase-sep'));
      return box;
    };

    immuneWindows.forEach((w, index) => {
      const box = row('immune', index, w.from, w.to);
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'phase-drop';
      drop.dataset.phaseDrop = `immune:${index}`;
      drop.textContent = '✕';
      drop.ariaLabel = `刪除 免疫 ${index + 1}`;
      drop.addEventListener('click', () => {
        immuneWindows.splice(index, 1);
        saveState();
        renderPhases();
      });
      box.append(drop);
      list.append(box);
    });

    elementWindows.forEach((w, index) => {
      const box = row('element', index, w.from, w.to);
      const code = document.createElement('select');
      code.dataset.phaseCode = String(index);
      for (const value of ['풍압', '수냉', '작열', '전격', '철갑']) {
        const option = document.createElement('option');
        option.value = value;          // 값은 엔진이 받는 코드 그대로
        option.textContent = termZh(value);
        code.append(option);
      }
      code.value = w.code || '풍압';
      code.addEventListener('change', () => {
        elementWindows[index]!.code = code.value as ElementWindow['code'];
        saveState();
      });
      box.append(code);
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'phase-drop';
      drop.dataset.phaseDrop = `element:${index}`;
      drop.textContent = '✕';
      drop.ariaLabel = `刪除 屬濾 ${index + 1}`;
      drop.addEventListener('click', () => {
        elementWindows.splice(index, 1);
        saveState();
        renderPhases();
      });
      box.append(drop);
      list.append(box);
    });
  };

  for (const kind of ['immune', 'element'] as const) {
    element<HTMLButtonElement>(root, `[data-phase-add="${kind}"]`).addEventListener('click', () => {
      // 마지막 구간 뒤를 기본값으로 잡아, 겹치지 않는 구간을 이어 붙이기 쉽게 한다.
      const all = [...immuneWindows, ...elementWindows];
      const start = all.length > 0 ? Math.max(...all.map((w) => w.to)) : 0;
      const from = Math.min(start, 178);
      if (kind === 'immune') immuneWindows.push({ from, to: Math.min(from + 2, 180) });
      else elementWindows.push({ from, to: Math.min(from + 2, 180), code: '풍압' });
      saveState();
      renderPhases();
    });
  }

  const advancedBattle = element<HTMLButtonElement>(root, '[data-advanced-battle]');
  const advancedBattlePanel = element<HTMLElement>(root, '[data-advanced-battle-panel]');
  advancedBattle.addEventListener('click', () => {
    const next = advancedBattle.getAttribute('aria-expanded') !== 'true';
    advancedBattle.setAttribute('aria-expanded', String(next));
    advancedBattlePanel.hidden = !next;
    const hint = advancedBattle.querySelector('.disclosure-hint');
    if (hint) hint.textContent = next ? '收合' : '展開';
  });

  const readOptimalRange = (): string[] =>
    [...rangeInputs].filter(([, input]) => input.checked).map(([weapon]) => weapon);

  const writeOptimalRange = (weapons: string[]) => {
    const on = new Set(weapons);
    for (const [weapon, input] of rangeInputs) input.checked = on.has(weapon);
  };

  // ── 덱마다 다른 버스트 게이지 충전 ──────────────────────────────────────
  // 버스트 쿨이 밀리는 덱이 있어 하나로 묶으면 그 덱만 계속 틀린다. 기본은 일괄이고,
  // 켤 때만 다섯 칸이 나온다 — 켜는 순간 지금 값으로 다섯을 채워 두므로 «켰더니 값이
  // 사라졌다»가 없다.
  const deckRegenBox = element<HTMLElement>(root, '[data-deck-regen]');
  const deckRegenToggle = element<HTMLInputElement>(root, '#burst-regen-per-deck');
  const readDeckRegen = (): Record<number, number> => {
    const out: Record<number, number> = {};
    for (const input of deckRegenBox.querySelectorAll<HTMLInputElement>('[data-deck-regen-input]')) {
      out[Number(input.dataset.deckRegenInput)] = Number(input.value);
    }
    return out;
  };
  const renderDeckRegen = (values: Record<number, number>) => {
    deckRegenBox.replaceChildren();
    for (let id = 1; id <= 5; id += 1) {
      const label = document.createElement('label');
      label.append(createText('span', `隊 ${id}`));
      const wrap = document.createElement('div');
      wrap.className = 'input-unit';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '20';
      input.step = '0.1';
      input.value = String(values[id] ?? 2);
      input.dataset.deckRegenInput = String(id);
      wrap.append(input, createText('em', '秒'));
      label.append(wrap);
      deckRegenBox.append(label);
    }
  };
  const writeDeckRegen = (values: Record<number, number> | undefined, fallback: number) => {
    const on = values !== undefined && Object.keys(values).length > 0;
    deckRegenToggle.checked = on;
    deckRegenBox.hidden = !on;
    renderDeckRegen(values ?? { 1: fallback, 2: fallback, 3: fallback, 4: fallback, 5: fallback });
  };
  deckRegenToggle.addEventListener('change', () => {
    if (deckRegenToggle.checked) {
      const now = Number(element<HTMLInputElement>(root, '#burst-regen').value);
      renderDeckRegen({ 1: now, 2: now, 3: now, 4: now, 5: now });
    }
    deckRegenBox.hidden = !deckRegenToggle.checked;
    saveState();
    refreshBattleSummary();
  });

  const readBattle = (): BattleSettings => ({
    duration: Number(element<HTMLInputElement>(root, '#duration').value),
    synchroLevel: Number(element<HTMLInputElement>(root, '#synchro-level').value),
    enemyDef: Number(element<HTMLInputElement>(root, '#enemy-def').value),
    enemyCode: element<HTMLSelectElement>(root, '#enemy-code').value as BattleSettings['enemyCode'],
    coreEnabled: coreToggle.checked,
    corePx: Number(corePxInput.value),
    hasParts: element<HTMLInputElement>(root, '#has-parts').checked,
    seed: Number(element<HTMLInputElement>(root, '#seed').value),
    optimalRangeWeapons: readOptimalRange(),
    // 배열은 화면이 아니라 이 변수가 정본이다 — 입력이 잘못돼도 지우지 않고
    // 그대로 실어 실행 시 검증 메시지로 알린다.
    immuneWindows: immuneWindows.map((w) => ({ ...w })),
    elementWindows: elementWindows.map((w) => ({ ...w })),
    rngMode: element<HTMLSelectElement>(root, '#rng-mode').value as RngMode,
    immuneBlocksBurst: element<HTMLInputElement>(root, '#immune-blocks-burst').checked,
    normalHitCoeff: readHitCoeff(),
    burstRegenTime: Number(element<HTMLInputElement>(root, '#burst-regen').value),
    ...(element<HTMLInputElement>(root, '#burst-regen-per-deck').checked
      ? { burstRegenPerDeck: readDeckRegen() } : {}),
    burstReaction: Number(element<HTMLInputElement>(root, '#burst-reaction').value),
    console: {
      common_level: Number(consoleCommon.value),
      class_level: readConsoleBuckets('class'),
      company_level: readConsoleBuckets('company'),
    },
  });

  const writeBattle = (battle: BattleSettings) => {
    element<HTMLInputElement>(root, '#duration').value = String(battle.duration);
    // 싱크로 레벨이 없던 시절에 저장된 설정을 되살릴 때가 있다 — 기본값으로 채운다.
    element<HTMLInputElement>(root, '#synchro-level').value =
      String(battle.synchroLevel ?? DEFAULT_SYNCHRO_LEVEL);
    element<HTMLInputElement>(root, '#enemy-def').value = String(battle.enemyDef);
    element<HTMLSelectElement>(root, '#enemy-code').value = battle.enemyCode;
    coreToggle.checked = battle.coreEnabled;
    corePxInput.value = String(battle.corePx);
    corePxInput.disabled = !battle.coreEnabled;
    element<HTMLInputElement>(root, '#has-parts').checked = battle.hasParts;
    element<HTMLInputElement>(root, '#seed').value = String(battle.seed);
    writeOptimalRange(battle.optimalRangeWeapons ?? []);
    immuneWindows = (battle.immuneWindows ?? []).map((w) => ({ ...w }));
    elementWindows = (battle.elementWindows ?? []).map((w) => ({ ...w }));
    renderPhases();
    element<HTMLSelectElement>(root, '#rng-mode').value = battle.rngMode ?? 'expected';
    element<HTMLInputElement>(root, '#immune-blocks-burst').checked = Boolean(battle.immuneBlocksBurst);
    writeHitCoeff(battle.normalHitCoeff);
    if (battle.burstRegenTime !== undefined) {
      element<HTMLInputElement>(root, '#burst-regen').value = String(battle.burstRegenTime);
    }
    // 이 항목이 생기기 전에 저장된 설정에는 없다 — 기본값으로 채운다.
    element<HTMLInputElement>(root, '#burst-reaction').value =
      String(battle.burstReaction ?? DEFAULT_BURST_REACTION);
    writeDeckRegen(battle.burstRegenPerDeck, battle.burstRegenTime);
    if (battle.console) {
      consoleCommon.value = String(battle.console.common_level);
      writeConsoleBuckets('class', battle.console.class_level);
      writeConsoleBuckets('company', battle.console.company_level);
    }
    // 조건이 창으로 들어간 뒤로 화면에 남는 표시는 요약 한 줄뿐이다. 프로그램이 값을
    // 써넣을 때는 change가 나지 않아 그 줄이 갱신되지 않았고, 「적 수치 초기화」와
    // 「받은 코드 적용」이 아무 일도 안 한 것처럼 보였다. 쓰는 자리에서 함께 끌고 간다.
    refreshBattleSummary();
  };

  // ── 전투 조건 접이판 ────────────────────────────────────────────────────
  // 조건은 한 번 정해 두면 계속 쓰는 값이라 접어 두고, 접힌 채로도 «무엇으로 재는지»를
  // 한 줄로 남긴다. 요약 문구는 공유 목록에 쓰는 것과 같은 함수를 쓴다.
  const battleOpen = element<HTMLButtonElement>(root, '[data-battle-open]');
  const battleModal = element<HTMLElement>(root, '[data-battle-modal]');
  const battleSummary = element<HTMLElement>(root, '[data-battle-summary]');
  const battleFirstNote = element<HTMLElement>(root, '[data-battle-first-note]');
  // 창 밖에 꺼내 둔 둘. 창 안의 값과 **같은 하나**를 보는 거울이라, 어느 쪽을
  // 만져도 반대쪽이 따라온다 — 두 벌로 두면 무엇이 진짜인지 알 수 없게 된다.
  const quickCode = element<HTMLSelectElement>(root, '[data-quick-enemy-code]');
  const quickCore = element<HTMLInputElement>(root, '[data-quick-core]');
  const refreshBattleSummary = () => {
    const battle = readBattle();
    battleSummary.textContent = summarizeBattle(battle);
    quickCode.value = battle.enemyCode;
    quickCore.checked = battle.coreEnabled;
  };
  quickCode.addEventListener('change', () => {
    element<HTMLSelectElement>(root, '#enemy-code').value = quickCode.value;
    element<HTMLSelectElement>(root, '#enemy-code').dispatchEvent(new Event('change', { bubbles: true }));
    refreshBattleSummary();
  });
  quickCore.addEventListener('change', () => {
    coreToggle.checked = quickCore.checked;
    coreToggle.dispatchEvent(new Event('change', { bubbles: true }));
    refreshBattleSummary();
  });
  /** 첫 계산 전 강조. 한 번이라도 열어 봤거나 계산을 돌렸으면 더 붙잡지 않는다. */
  const settleBattleNote = () => { battleFirstNote.hidden = true; };
  const setBattleOpen = (open: boolean) => {
    battleOpen.setAttribute('aria-expanded', String(open));
    battleModal.hidden = !open;
    refreshBattleSummary();
    if (open) settleBattleNote();
  };
  battleOpen.addEventListener('click', () => { setBattleOpen(true); });
  element<HTMLButtonElement>(root, '[data-battle-modal-close]')
    .addEventListener('click', () => setBattleOpen(false));
  battleModal.addEventListener('click', (event) => {
    if (event.target === battleModal) setBattleOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !battleModal.hidden) setBattleOpen(false);
  });

  const validateCharacterValues = (deck: DeckState): string[] => {
    const messages: string[] = [];
    for (const [name, custom] of Object.entries(deck.characters)) {
      const characterDefaults = settings.characters[name];
      if (custom.growthStage !== undefined && (
        !Number.isInteger(custom.growthStage)
        || custom.growthStage < 0
        || custom.growthStage > (characterDefaults?.maxGrowthStage ?? -1)
      )) {
        messages.push(
          `隊 ${deck.id} · ${resolveDisplayName(name)}:突破階段必須是 0~${characterDefaults?.maxGrowthStage ?? 0} 的整數。`,
        );
      }
      if (custom.skillLevels) {
        const keys = Object.keys(custom.skillLevels);
        const hasExactKeys = keys.length === 3
          && keys.every((key) => key === '1' || key === '2' || key === '3');
        const values = Object.values(custom.skillLevels);
        if (!hasExactKeys || values.some((value) => !Number.isInteger(value) || value < 1 || value > 10)) {
          messages.push(`隊 ${deck.id} · ${resolveDisplayName(name)}:技能等級必須是 1~10 的整數。`);
        } else if (characterDefaults?.skillLevelsLocked
          && values.some((value) => value !== 10)) {
          messages.push(`隊 ${deck.id} · ${resolveDisplayName(name)}:數值未公開的角色只能使用技能 Lv10。`);
        }
      }
      for (const [key, value] of Object.entries(custom.overload ?? {})) {
        const meta = settings.overloadFields[key];
        if (!meta || !Number.isFinite(value) || value < meta.min || value > meta.max) {
          messages.push(`隊 ${deck.id} · ${resolveDisplayName(name)}:${statName(key)} 的值超出允許範圍。`);
        }
      }
      if (custom.cube && (!settings.cubes[custom.cube.name] || !Number.isInteger(custom.cube.level)
        || custom.cube.level < 1 || custom.cube.level > 15)) {
        messages.push(`隊 ${deck.id} · ${resolveDisplayName(name)}:請確認魔方設定。`);
      }
      if (custom.weaponModeSwapAt !== undefined && (
        !Number.isFinite(custom.weaponModeSwapAt)
        || custom.weaponModeSwapAt < 0
        || custom.weaponModeSwapAt > 180
      )) {
        messages.push(`隊 ${deck.id} · ${resolveDisplayName(name)}:狙擊模式切換時點必須是 0~180 秒。`);
      }
      for (const [key, value] of Object.entries(custom.manualStats ?? {})) {
        const meta = settings.manualStats[key];
        if (!meta || !Number.isFinite(value) || value < meta.min || value > meta.max) {
          messages.push(`隊 ${deck.id} · ${resolveDisplayName(name)}:${statName(key)} 的值超出允許範圍。`);
        }
      }
    }
    return messages;
  };

  // ── 설정 공유 서버 ──────────────────────────────────────────────────────
  // 전투 조건과 조합이 같은 서버·같은 판을 쓴다. 주소가 없으면 판을 아예 만들지
  // 않고 코드 주고받기만 남는다.
  const shareServer = SHARE_API ? new ShareServer(SHARE_API) : null;
  const sharePanelHosts = (prefix: 'share' | 'battle-share') => ({
    tabs: element<HTMLElement>(root, `[data-${prefix}-tabs]`),
    upload: element<HTMLElement>(root, `[data-${prefix}-pane="upload"]`),
    list: element<HTMLElement>(root, `[data-${prefix}-pane="list"]`),
    code: element<HTMLElement>(root, `[data-${prefix}-pane="code"]`),
  });

  // ── 조합 공유 코드 ──────────────────────────────────────────────────────
  const shareModal = element<HTMLElement>(root, '[data-share-modal]');
  const shareOut = element<HTMLTextAreaElement>(root, '[data-share-out]');
  const shareIn = element<HTMLTextAreaElement>(root, '[data-share-in]');
  const shareUrl = element<HTMLTextAreaElement>(root, '[data-share-url]');
  const shareMsg = element<HTMLElement>(root, '[data-share-msg]');
  const showShareMsg = (message: string, ok = false) => {
    shareMsg.hidden = message === '';
    shareMsg.textContent = message;
    shareMsg.classList.toggle('is-ok', ok);
  };
  // 편성 프리셋 — 자주 쓰는 조합을 이름 붙여 이 브라우저에 둔다. 담는 건 공유 코드
  // 하나뿐이라(=편성만) 스펙이 바뀌어도 그대로 쓸 수 있고, 저장 용량도 거의 안 든다.
  const PRESET_KEY = 'nikke-presets-v1';
  const PRESET_MAX = 50;
  interface Preset { name: string; code: string; at: string; }
  const presetName = element<HTMLInputElement>(root, '[data-preset-name]');
  const presetList = element<HTMLElement>(root, '[data-preset-list]');
  let presets: Preset[] = (() => {
    try {
      const raw = resolveStorage()?.getItem(PRESET_KEY);
      const parsed = raw ? (JSON.parse(raw) as Preset[]) : [];
      return Array.isArray(parsed) ? parsed.filter((p) => p && p.name && p.code) : [];
    } catch {
      return [];
    }
  })();
  const savePresets = () => {
    try {
      resolveStorage()?.setItem(PRESET_KEY, JSON.stringify(presets));
    } catch {
      /* 저장 실패는 무시 */
    }
  };
  const renderPresets = () => {
    presetList.replaceChildren();
    if (presets.length === 0) {
      presetList.append(createText('p', '沒有已儲存的預設。', 'preset-empty'));
      return;
    }
    for (const preset of presets) {
      const row = document.createElement('div');
      row.className = 'preset-item';
      row.dataset.preset = preset.name;
      const load = document.createElement('button');
      load.type = 'button';
      load.className = 'preset-load';
      load.textContent = preset.name;
      load.title = `${preset.at.slice(0, 10)} 儲存・點擊載入`;
      load.addEventListener('click', () => {
        applyShareText(preset.code);
        refreshShareFields();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'preset-remove';
      remove.textContent = '刪除';
      remove.setAttribute('aria-label', `刪除 ${preset.name}`);
      remove.addEventListener('click', () => {
        presets = presets.filter((item) => item.name !== preset.name);
        savePresets();
        renderPresets();
      });
      row.append(load, remove);
      presetList.append(row);
    }
  };
  element<HTMLButtonElement>(root, '[data-preset-save]').addEventListener('click', () => {
    const name = presetName.value.trim();
    if (!name) {
      showShareMsg('請填寫預設名稱。');
      presetName.focus();
      return;
    }
    if (!decksInScope().some((deck) => deck.squad.some(Boolean))) {
      showShareMsg(shareScope === 'all'
        ? '編成是空的,沒有可儲存的內容。'
        : `隊伍 ${activeDeckId} 是空的。要收其他隊伍,請在上面選「全部 5 隊」。`);
      return;
    }
    if (presets.length >= PRESET_MAX && !presets.some((p) => p.name === name)) {
      showShareMsg(`預設最多儲存 ${PRESET_MAX} 個。請刪除不用的。`);
      return;
    }
    const code = shareScopeCode();
    presets = [{ name, code, at: new Date().toISOString() },
      ...presets.filter((item) => item.name !== name)];
    savePresets();
    renderPresets();
    presetName.value = '';
    showShareMsg(`已儲存為「${name}」`
      + `(${shareScope === 'all' ? '全部 5 隊' : `僅隊伍 ${activeDeckId}`})。`
      + ' 只裝編成,規格改變也照用。', true);
  });

  // 계산 기록 — 그때의 편성(공유 코드)과 수치·조건을 남긴다. 편성만 되살릴 수 있게
  // 코드로 담아, 스펙이 바뀌어도 조합은 그대로 복원된다.
  const HISTORY_KEY = 'nikke-history-v1';
  const HISTORY_MAX = 30;
  interface HistoryEntry {
    at: string; code: string; total: number; duration: number;
    decks: Array<{ id: number; total: number; squad: string[] }>;
    conditions: string;
  }
  const historyModal = element<HTMLElement>(root, '[data-history-modal]');
  const historyList = element<HTMLElement>(root, '[data-history-list]');
  let calcHistory: HistoryEntry[] = (() => {
    try {
      const raw = resolveStorage()?.getItem(HISTORY_KEY);
      const parsed = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
      return Array.isArray(parsed) ? parsed.filter((item) => item && item.code) : [];
    } catch {
      return [];
    }
  })();
  const persistHistory = () => {
    try {
      resolveStorage()?.setItem(HISTORY_KEY, JSON.stringify(calcHistory));
    } catch {
      /* 저장 실패는 무시 */
    }
  };
  const saveHistory = (batch: BatchResult) => {
    const battle = readBattle();
    const entry: HistoryEntry = {
      at: new Date().toISOString(),
      code: encodeShareCode(decks, fiveDeckMode),
      total: batch.total,
      duration: batch.decks[0]?.result.duration ?? 0,
      decks: batch.decks.map((deck) => ({
        id: deck.deckId,
        total: deck.result.squadTotal,
        squad: deck.request.squad.filter(Boolean),
      })),
      conditions: `${battle.duration}秒 · 防禦力 ${battle.enemyDef.toLocaleString('en-US')}`
        + `${battle.enemyCode ? ` · ${termZh(battle.enemyCode)}` : ' · 無代碼'}`
        + `${battle.coreEnabled ? ` · 核心 ${battle.corePx}px` : ''} · 種子 ${battle.seed}`,
    };
    calcHistory = [entry, ...calcHistory].slice(0, HISTORY_MAX);
    persistHistory();
    renderHistory();
    historyModal.hidden = false;
  };
  const renderHistory = () => {
    historyList.replaceChildren();
    if (calcHistory.length === 0) {
      historyList.append(createText('p', '還沒有已儲存的結果。請在結果按「儲存結果」。', 'preset-empty'));
      return;
    }
    for (const entry of calcHistory) {
      const row = document.createElement('article');
      row.className = 'history-item';
      row.dataset.historyItem = entry.at;
      const head = document.createElement('div');
      head.className = 'history-head';
      head.append(
        createText('strong', formatDamage(entry.total)),
        createText('span', new Date(entry.at).toLocaleString('ko-KR')),
      );
      row.append(head, createText('p', entry.conditions, 'history-cond'));
      for (const deck of entry.decks) {
        row.append(createText(
          'p',
          `隊 ${deck.id} · ${formatDamage(deck.total)} — ${deck.squad.map(resolveDisplayName).join(', ') || '空隊'}`,
          'history-deck',
        ));
      }
      const actions = document.createElement('div');
      actions.className = 'history-actions';
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'preset-load';
      restore.textContent = '復原這個編成';
      restore.addEventListener('click', () => {
        // 기록은 «그때 그 판»이다 — 범위 고르개와 무관하게 판 전체를 되살린다.
        applyShareText(entry.code, 'all');
        historyModal.hidden = true;
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'preset-remove';
      remove.textContent = '刪除';
      remove.addEventListener('click', () => {
        calcHistory = calcHistory.filter((item) => item.at !== entry.at);
        persistHistory();
        renderHistory();
      });
      actions.append(restore, remove);
      row.append(actions);
      historyList.append(row);
    }
  };
  element<HTMLButtonElement>(root, '[data-history-close]').addEventListener('click', () => {
    historyModal.hidden = true;
  });
  historyModal.addEventListener('click', (event) => {
    if (event.target === historyModal) historyModal.hidden = true;
  });

  /**
   * 주고받을 범위. 「이 덱만」이 기본이다 — 덱 하나를 옮기는 일이 판 전체를 옮기는
   * 일보다 훨씬 잦은데, 예전에는 그것도 5덱 코드로 나가고 받는 쪽에서는 판을 통째로
   * 덮었다(2~5덱이 조용히 지워졌다).
   *
   * 저장·복사·올리기와 **적용까지 같은 값을 본다** — 「이 덱만」으로 받으면 코드에 든
   * 첫 덱이 지금 보고 있는 덱에 들어가고 나머지 덱은 그대로 남는다.
   */
  type ShareScope = 'one' | 'all';
  let shareScope: ShareScope = 'one';
  const scopeBox = element<HTMLElement>(root, '[data-share-scope]');
  const scopeNote = element<HTMLElement>(root, '[data-share-scope-note]');

  /** 지금 보고 있는 덱의 자리(0부터). 덱 순서를 바꿔도 따라간다. */
  const activeDeckIndex = (): number => {
    const at = decks.findIndex((deck) => deck.id === activeDeckId);
    return at >= 0 ? at : 0;
  };

  /** 범위에 맞춰 담을 덱들. 「이 덱만」이면 지금 덱 하나다. */
  const decksInScope = (): DeckState[] =>
    (shareScope === 'all' ? decks : [decks[activeDeckIndex()]!]);

  const shareScopeCode = (): string =>
    (shareScope === 'all'
      ? encodeShareCode(decks, fiveDeckMode)
      : encodeShareCode([decks[activeDeckIndex()]!], false));

  const renderScope = () => {
    for (const button of scopeBox.querySelectorAll<HTMLButtonElement>('[data-share-scope-pick]')) {
      button.classList.toggle('is-on', button.dataset.shareScopePick === shareScope);
    }
    scopeNote.textContent = shareScope === 'all'
      ? '把 5 隊裝進一個代碼,收到後整個盤面會改變。'
      : `只裝隊伍 ${activeDeckId},收到後只進入隊伍 ${activeDeckId}。`;
  };

  for (const button of scopeBox.querySelectorAll<HTMLButtonElement>('[data-share-scope-pick]')) {
    button.addEventListener('click', () => {
      shareScope = button.dataset.shareScopePick === 'all' ? 'all' : 'one';
      renderScope();
      refreshShareFields();
      showShareMsg('');
    });
  }

  const refreshShareFields = () => {
    const code = shareScopeCode();
    shareOut.value = code;
    // 코드가 짧아져 링크로도 무리가 없다 — 받는 쪽은 열기만 하면 적용된다.
    shareUrl.value = `${location.origin}${location.pathname}#deck=${encodeURIComponent(code)}`;
  };
  const openShareModal = (focusPreset = false) => {
    renderScope();
    refreshShareFields();
    renderPresets();
    shareIn.value = '';
    showShareMsg('');
    shareModal.hidden = false;
    squadSharePanel?.open();
    // 프리셋은 «코드» 탭 안에 있다 — 겨냥해 열었으면 그 탭으로 간다.
    if (focusPreset) {
      root.querySelector<HTMLButtonElement>('[data-share-tab="code"]')?.click();
      presetName.focus();
    }
  };
  element<HTMLButtonElement>(root, '[data-share-open]').addEventListener('click', () => {
    openShareModal();
  });
  element<HTMLButtonElement>(root, '[data-share-close]').addEventListener('click', () => {
    shareModal.hidden = true;
  });
  shareModal.addEventListener('click', (event) => {
    if (event.target === shareModal) shareModal.hidden = true;
  });
  element<HTMLButtonElement>(root, '[data-share-copy]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareOut.value);
      showShareMsg('已複製組合代碼。就這樣分享即可。', true);
    } catch {
      shareOut.select();
      showShareMsg('自動複製被擋,已幫你選取代碼。請用 Ctrl+C 複製。');
    }
  });
  // 링크째 붙여넣어도 되게, #deck= 뒤의 코드만 뽑아 쓴다.
  const shareCodeFrom = (text: string): string => {
    const hit = text.match(/#deck=([^&\s]+)/);
    return hit ? decodeURIComponent(hit[1]!) : text;
  };
  /**
   * 받은 코드를 덱에 얹는다.
   *
   * `scope`를 안 주면 모달의 범위 고르개를 따른다. 공유 링크와 계산 기록은 «그때 그
   * 판을 통째로»라는 뜻이므로 `'all'`을 못 박아 넘긴다 — 링크를 연 사람이 덱 하나만
   * 받으면 판을 잃는다.
   */
  const applyShareText = (text: string, scope: ShareScope = shareScope) => {
    try {
      // 카탈로그 이름을 넘겨야 해시에서 캐릭터를 되찾는다(커스텀 니케도 카탈로그에 있다).
      const payload = decodeShareCode(shareCodeFrom(text), catalog.map((char) => char.name));
      const into = scope === 'all' ? 'all' : activeDeckIndex();
      const landed = scope === 'all' ? 1 : activeDeckId;
      // 스펙은 내 것을 쓴다 — CSV 로스터를 넣어 뒀으면 그대로 얹힌다.
      const { applied, skipped } = applyShareToDecks(
        payload, decks,
        (name) => catalogByName.has(name),
        (name) => (roster[name] ? cloneOverride(roster[name]!) : undefined),
        into,
      );
      if (scope === 'all') {
        fiveDeckMode = payload.fiveDeckMode || applied > 1;
        element<HTMLInputElement>(root, '#squad-mode').checked = fiveDeckMode;
        deckTabs.hidden = !fiveDeckMode;
        deckMoves.hidden = !fiveDeckMode;
        clearAllButton.hidden = !fiveDeckMode;
        deckNote.hidden = !fiveDeckMode;
        activeDeckId = 1;
      }
      saveState();
      renderDeckTabs();
      renderSquad();
      showErrors([]);
      const missing = skipped.length > 0
        ? ` · 已排除清單外的妮姬 ${skipped.length} 名(${skipped.slice(0, 3).map(resolveDisplayName).join(', ')}${skipped.length > 3 ? '…' : ''})`
        : '';
      // 5덱짜리를 한 칸에 받았으면 나머지가 어디 갔는지 반드시 말해 준다.
      const carried = payload.decks.filter((deck) => deck.squad.some((n) => n.trim() !== '')).length;
      if (scope === 'all') {
        showShareMsg(`已套用 ${applied} 隊${missing}。`, skipped.length === 0);
      } else if (carried > 1) {
        showShareMsg(`代碼裡有 ${carried} 隊,只把第一隊放進隊伍 ${landed}`
          + `${missing}。要收整個盤面,請在上面選「全部 5 隊」。`);
      } else {
        showShareMsg(`已套用到隊伍 ${landed}${missing}。其他隊伍不變。`,
          skipped.length === 0);
      }
    } catch (error) {
      showShareMsg(error instanceof Error ? error.message : String(error));
    }
  };
  element<HTMLButtonElement>(root, '[data-share-apply]').addEventListener('click', () => {
    applyShareText(shareIn.value);
  });
  const squadSharePanel: SharePanel | null = shareServer && mountSharePanel(
    sharePanelHosts('share'),
    {
      kind: 'squad',
      server: shareServer,
      current: () => ({
        code: shareScopeCode(),
        auto: summarizeSquad(decksInScope(), shareScope === 'all' && fiveDeckMode),
      }),
      // applyShareText가 제외된 니케까지 세어 자기 말로 알린다 — 그대로 쓴다.
      apply: (item) => {
        applyShareText(item.code);
        refreshShareFields();
      },
      notify: showShareMsg,
      // 조합은 이름을 늘어놓는 것보다 초상화가 빠르다. 코드를 그 자리에서 풀어
      // 덱마다 한 줄씩 세운다 — 못 풀면 설명 줄로 물러난다.
      preview: (item) => {
        try {
          const payload = decodeShareCode(item.code, catalog.map((char) => char.name));
          const decks = payload.decks
            .map((deck) => deck.squad.filter((name) => name.trim() !== ''))
            .filter((squad) => squad.length > 0);
          if (decks.length === 0) return null;
          return squadPreview(decks, (name) => {
            const image = catalogByName.get(name)?.image;
            return image ? `${import.meta.env.BASE_URL}${image}` : undefined;
          }, resolveDisplayName);
        } catch {
          return null;
        }
      },
    },
  );
  element<HTMLButtonElement>(root, '[data-share-url-copy]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl.value);
      showShareMsg('已複製連結。對方只要打開就會載入編成。', true);
    } catch {
      shareUrl.select();
      showShareMsg('自動複製被擋,已幫你選取連結。請用 Ctrl+C 複製。');
    }
  });
  // ── 보고서 이미지 ────────────────────────────────────────────────────────
  let lastBatch: BatchResult | null = null;
  let reportBlob: Blob | null = null;
  const reportModal = element<HTMLElement>(root, '[data-report-modal]');
  const reportPreview = element<HTMLElement>(root, '[data-report-preview]');
  const reportMsg = element<HTMLElement>(root, '[data-report-msg]');

  const showReportMsg = (message: string, ok = false) => {
    reportMsg.hidden = message === '';
    reportMsg.textContent = message;
    reportMsg.classList.toggle('is-ok', ok);
  };

  /**
   * 정밀 수치 CSV. **같은 계산을 0.1초 칸으로 한 번 더 받아** 표로 만든다.
   *
   * 결과에 늘 실어 두지 않는 이유는 무게다 — 칸이 열 배가 되면 저장되는 결과도
   * 그만큼 무거워지는데, 정작 쓰는 사람은 드물다. 다시 받는 데 실패하면(옛 결과를
   * 불러온 경우 등) 손에 있는 1초 표로 내보낸다 — 수치 자체는 어느 쪽이든 정확하다.
   */
  const exportDamageCsv = async (batch: BatchResult, button: HTMLButtonElement) => {
    const label = button.textContent ?? '精密數值 CSV';
    button.disabled = true;
    button.textContent = '正在彙整數值…';
    try {
      const parts: string[] = [];
      let coarseOnly = false;
      for (const entry of batch.decks) {
        let result = entry.result;
        try {
          result = await client.simulate({ ...entry.request, fineTimeline: true });
        } catch {
          coarseOnly = true;   // 다시 못 받았으면 손에 있는 것으로 낸다
        }
        const timeline = result.fineTimeline ?? result.timeline;
        if (!result.fineTimeline) coarseOnly = true;
        const names = entry.request.squad.filter(Boolean);
        const note = `${entry.request.duration}秒 · 敵方防禦力 ${entry.request.enemyDef}`;
        if (batch.decks.length > 1) parts.push(csvText([[deckNameOf(entry.deckId)]]));
        parts.push(damageCsv({ ...result, timeline }, names, note));
      }
      downloadImage(csvBlob(parts.join('\r\n\r\n')),
        csvFileName(batch.decks.length > 1 ? '5隊' : `隊 ${batch.decks[0]?.deckId ?? 1}`));
      status.textContent = coarseOnly
        ? '已下載精密數值 CSV(1 秒單位 — 0.1 秒的表需重新計算才會出現)。'
        : '已下載精密數值 CSV(0.1 秒單位)。';
    } catch (error) {
      status.textContent = `無法產生精密數值 CSV:${(error as Error).message}`;
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  };

  const openReport = async () => {
    if (!lastBatch) return;
    const batch = lastBatch;
    showReportMsg('');
    reportPreview.replaceChildren(createText('p', '正在繪製報告…', 'report-loading'));
    reportModal.hidden = false;
    try {
      const names = batch.decks.flatMap((entry) => entry.request.squad);
      const portraits = await loadPortraits(names, catalogByName, import.meta.env.BASE_URL);
      const battle = readBattle();
      const meta: ReportMeta = {
        enemyDef: battle.enemyDef,
        enemyCode: battle.enemyCode,
        corePx: battle.coreEnabled ? battle.corePx : 0,
        hasParts: battle.hasParts,
        siteUrl: 'farly6966.github.io/nikke-calc-t1',
        // 덱에 붙인 이름을 이미지에도 잇는다 — 자료를 모을 때 한 장으로 끝나게.
        deckNames: Object.fromEntries(decks.map((deck) => [deck.id, deckLabelFull(deck)])),
        // 그림에도 화면과 같은 이름이 적혀야 한다 — 커뮤니티에 그대로 붙여넣는 그림이다.
        displayNames: Object.fromEntries(
          [...new Set(names)].filter(Boolean)
            .map((name) => [name, catalogByName.get(name)?.displayName ?? name]),
        ),
      };
      const canvas = renderReport(batch, meta, portraits);
      reportBlob = await canvasToBlob(canvas);
      const image = document.createElement('img');
      image.src = URL.createObjectURL(reportBlob);
      image.alt = '戰鬥結果報告';
      image.dataset.reportImage = '';
      reportPreview.replaceChildren(image);
    } catch (error) {
      reportBlob = null;
      reportPreview.replaceChildren();
      showReportMsg(error instanceof Error ? error.message : '無法產生報告。');
    }
  };

  const closeReport = () => { reportModal.hidden = true; };
  element<HTMLButtonElement>(root, '[data-report-close]').addEventListener('click', closeReport);
  reportModal.addEventListener('click', (event) => {
    if (event.target === reportModal) closeReport();
  });
  element<HTMLButtonElement>(root, '[data-report-copy]').addEventListener('click', () => {
    void (async () => {
      if (!reportBlob) return;
      // 이미지 클립보드 쓰기를 막는 브라우저가 있어 실패하면 저장으로 안내한다.
      const outcome = await copyImage(reportBlob);
      const message = {
        copied: '已複製圖片。貼到社群貼文即可。',
        unsupported: '這個瀏覽器不支援複製圖片。請用儲存 PNG。',
        blocked: '複製被擋。請先點一下這個視窗再按一次。若持續被擋,請用儲存 PNG。',
      }[outcome];
      showReportMsg(message, outcome === 'copied');
    })();
  });
  element<HTMLButtonElement>(root, '[data-report-save]').addEventListener('click', () => {
    if (!reportBlob || !lastBatch) return;
    downloadImage(reportBlob, reportFilename(lastBatch));
    showReportMsg('已儲存為 PNG。', true);
  });

  // ── 자세히 보기 ─────────────────────────────────────────────────────────
  // 켠 상태는 이 브라우저에 남는다 — 한 번 켜 둔 사람은 늘 그 눈으로 본다.
  const DETAIL_KEY = 'nikke-detail-damage-v1';
  let detailDamage = false;
  try {
    detailDamage = resolveStorage()?.getItem(DETAIL_KEY) === '1';
  } catch { /* 저장된 값을 못 읽으면 줄여 쓰기(기본)로 간다 */ }

  /**
   * 「자세히 보기」 — 결과의 대미지를 줄이지 않고 1의 자리까지 적는다.
   *
   * 두 덱이 「1.24억」으로 똑같이 보이는데 실제로는 수십만이 갈리는 일이 있다.
   * 켠 상태는 이 브라우저에 남는다. 타임라인 눈금과 보고서 이미지는 자리가 좁아
   * 늘 줄여 적는다 — 여기서 바뀌는 것은 결과 패널뿐이다.
   */
  const dmg = (value: number): string =>
    (detailDamage ? formatExactDamage(value) : formatDamage(value));
  const dps = (value: number): string =>
    (detailDamage ? formatExactDps(value) : formatDps(value));

  const renderBatchResult = (batch: BatchResult) => {
    // 한 번이라도 돌렸으면 «조건부터 보라»는 강조는 물러난다.
    settleBattleNote();
    // 수령자는 실제 발동 로그에서 온다 — 결과가 들어와야 카드에 채울 수 있다.
    let touchedActiveDeck = false;
    for (const entry of batch.decks) {
      const targets = entry.result.buffTargets;
      const deck = decks.find((d) => d.id === entry.deckId);
      if (!targets || !deck) continue;
      buffTargetsByDeck.set(entry.deckId, { sig: deckSignature(deck), rows: targets });
      if (entry.deckId === activeDeckId) touchedActiveDeck = true;
    }
    if (touchedActiveDeck) { saveState(); renderSquad(); }

    resultPanel.replaceChildren();
    const duration = batch.decks[0]?.result.duration ?? 1;
    const header = document.createElement('div');
    header.className = 'result-header';
    const copy = document.createElement('div');
    copy.append(createText('h2', batch.decks.length > 1 ? '5 隊戰鬥結果' : '戰鬥結果'));
    const summary = document.createElement('div');
    summary.className = 'total-block';
    const total = createText('strong', dmg(batch.total));
    total.dataset.resultTotal = '';
    total.dataset.batchTotal = '';
    summary.append(createText('span', batch.decks.length > 1 ? '全部隊伍總傷害' : '隊伍總傷害'), total, createText('small', dps(batch.total / duration)));
    header.append(copy, summary);
    resultPanel.append(header);

    // 보고서는 마지막으로 그려진 결과를 그대로 쓴다.
    lastBatch = batch;
    const reportTools = document.createElement('div');
    reportTools.className = 'report-tools';
    const reportButton = document.createElement('button');
    reportButton.type = 'button';
    reportButton.className = 'report-open';
    reportButton.dataset.reportOpen = '';
    reportButton.textContent = '製作報告圖片';
    reportButton.title = '把結果做成一張 PNG 複製或儲存';
    reportButton.addEventListener('click', () => { void openReport(); });
    const historySave = document.createElement('button');
    historySave.type = 'button';
    historySave.className = 'report-open';
    historySave.dataset.historySave = '';
    historySave.textContent = '儲存結果';
    historySave.title = '把此時的編成與數值留在這個瀏覽器';
    historySave.addEventListener('click', () => saveHistory(batch));
    const historyOpen = document.createElement('button');
    historyOpen.type = 'button';
    historyOpen.className = 'report-open';
    historyOpen.dataset.historyOpen = '';
    historyOpen.textContent = '載入結果';
    historyOpen.addEventListener('click', () => { renderHistory(); historyModal.hidden = false; });
    // 정밀 수치 — 화면은 「1.24억」으로 줄여 적지만 엔진은 처음부터 정수로 정확히 센다.
    // 1의 자리까지 놓고 따지려는 사람에게 그 정수를 표로 내준다.
    const csvButton = document.createElement('button');
    csvButton.type = 'button';
    csvButton.className = 'report-open';
    csvButton.dataset.csvExport = '';
    csvButton.textContent = '精密數值 CSV';
    csvButton.title = '下載含各區間・最終傷害到個位數的表(0.1 秒單位)';
    csvButton.addEventListener('click', () => { void exportDamageCsv(batch, csvButton); });
    // 자세히 보기 — 「1.24억」 대신 1의 자리까지. 내려받지 않고 그 자리에서 본다.
    const detailLabel = document.createElement('label');
    detailLabel.className = 'inline-check detail-toggle';
    const detailBox = document.createElement('input');
    detailBox.type = 'checkbox';
    detailBox.dataset.detailDamage = '';
    detailBox.checked = detailDamage;
    detailLabel.title = '傷害不縮寫,寫到個位數';
    detailBox.addEventListener('change', () => {
      detailDamage = detailBox.checked;
      try {
        resolveStorage()?.setItem(DETAIL_KEY, detailDamage ? '1' : '0');
      } catch { /* 저장 실패는 무시한다 — 이번 판만 못 기억할 뿐이다 */ }
      renderBatchResult(batch);
    });
    detailLabel.append(detailBox, createText('span', '詳細顯示'));
    reportTools.append(historySave, historyOpen, reportButton, csvButton, detailLabel);
    resultPanel.append(reportTools);

    // 덱 순위 — 딜 내림차순으로 «등수»만 구한다. 세우는 순서는 끝까지 덱 번호 그대로다.
    const ordered = [...batch.decks].sort((a, b) => b.result.squadTotal - a.result.squadTotal);
    const ranking = new Map(ordered.map((entry, index) => [entry.deckId, index + 1]));
    const best = ordered[0]?.result.squadTotal ?? 0;
    const portraitOf = (name: string): string | undefined => {
      const image = catalogByName.get(name)?.image;
      return image ? `${import.meta.env.BASE_URL}${image}` : undefined;
    };

    /** 덱 하나의 속. 캐릭터 카드와 사실 줄, 이탈 목록. */
    const renderDeckDetail = (host: HTMLElement, entry: DeckResultEntry) => {
      host.replaceChildren();
      const section = document.createElement('section');
      section.className = 'deck-result';
      section.dataset.deckResult = String(entry.deckId);
      const deckHeader = document.createElement('div');
      deckHeader.className = 'deck-result-header';
      deckHeader.append(
        createText('h3', deckNameOf(entry.deckId)),
        createText('strong', dmg(entry.result.squadTotal)),
        createText('small', dps(entry.result.squadTotal / entry.result.duration)),
      );
      section.append(deckHeader);
      if (ranking.size > 1) {
        const rank = ranking.get(entry.deckId)!;
        const gap = best > 0 ? (entry.result.squadTotal / best - 1) * 100 : 0;
        const badge = createText(
          'p',
          rank === 1
            ? '第 1 名 · 基準'
            : `第 ${rank} 名 · 對比第 1 名 ${gap.toFixed(1)}% (${dmg(entry.result.squadTotal - best)})`,
          'deck-rank',
        );
        badge.dataset.deckRank = String(rank);
        if (rank === 1) badge.classList.add('is-best');
        section.append(badge);
      }
      if (entry.result.previewNote) section.append(createText('p', entry.result.previewNote, 'preview-warning'));
      // 덱을 갈아 가며 볼 때는 줄이 짧고 비교가 쉽다. 한 덱만 볼 때는 카드가 편성과
      // 자리가 맞아 낫다 — 화면의 목적이 달라서 모양도 다르다.
      const fmt: DamageFormat = { dmg, dps };
      if (batch.decks.length > 1) renderCharacterRows(section, entry, portraitOf, fmt);
      else renderCharacterCards(section, entry, portraitOf, fmt);
      const facts = document.createElement('div');
      facts.className = 'result-facts';
      facts.append(
        createText('span', `${entry.result.duration}秒 戰鬥`),
        createText('span', `${entry.result.hitCount.toLocaleString('zh-TW')} 次命中`),
        createText('span', `種子 ${entry.request.seed}`),
      );
      section.append(facts, createText('pre', shownDeviations(entry.result.deviations), 'deviations'));
      host.append(section);
    };

    const detail = document.createElement('div');
    detail.className = 'deck-detail';
    if (batch.decks.length > 1) {
      // 덱마다 탭 하나. **덱 번호 순서 그대로** 왼쪽에서 오른쪽으로 세우고, 딜 1·2위는
      // 자리를 옮기지 않고 뱃지로만 표시한다. 고른 덱만 아래에 자세히 편다.
      const tabs = document.createElement('div');
      tabs.className = 'deck-result-tabs';
      tabs.dataset.deckResultTabs = '';
      const buttons = new Map<number, HTMLButtonElement>();
      const show = (entry: DeckResultEntry) => {
        for (const [id, button] of buttons) {
          button.classList.toggle('is-on', id === entry.deckId);
          button.setAttribute('aria-pressed', String(id === entry.deckId));
        }
        renderDeckDetail(detail, entry);
      };
      for (const entry of batch.decks) {
        const rank = ranking.get(entry.deckId)!;
        const tab = document.createElement('button');
        tab.type = 'button';
        // 순위는 다섯 덱 모두에 적고, 1·2위만 색으로 강조한다. 자리는 덱 번호 순 그대로다.
        tab.className = 'deck-result-tab'
          + (rank === 1 ? ' is-first' : rank === 2 ? ' is-second' : '');
        tab.dataset.deckResultTab = String(entry.deckId);
        tab.dataset.deckRank = String(rank);
        const head = document.createElement('b');
        head.append(document.createTextNode(deckNameOf(entry.deckId)));
        head.append(createText('em', `第 ${rank} 名`, 'deck-tab-rank'));
        // 덱끼리 견주는 자리라 줄이지 않고 온전한 숫자를 적는다 — «1.14억»으로는
        // 2위와의 차이가 읽히지 않는다.
        tab.append(head, createText('span', Math.round(entry.result.squadTotal).toLocaleString('ko-KR')));
        tab.addEventListener('click', () => show(entry));
        buttons.set(entry.deckId, tab);
        tabs.append(tab);
      }
      resultPanel.append(tabs);
      show(batch.decks[0]!);
    } else if (batch.decks[0]) {
      renderDeckDetail(detail, batch.decks[0]);
    }
    resultPanel.append(detail);

    // 타임라인도 한 번에 하나만 본다 — 다섯을 세로로 쌓으면 어느 덱을 보고 있는지
    // 스크롤 중에 놓친다. 탭은 결과와 같이 **덱 번호 순서 그대로** 선다.
    timelineBody.replaceChildren();
    const blocks = new Map<number, HTMLElement>();
    for (const entry of batch.decks) {
      // 버스트 핀에 쓸 초상화. 캔버스가 직접 그리므로 URL만 넘긴다.
      const portraitUrls: Record<string, string> = {};
      // 타임라인은 카탈로그를 모르므로 화면 이름을 함께 넘긴다 — 범례·툴팁이
      // 한국어 정본 이름을 그대로 적으면 화면에서 그 사람만 낯설어진다.
      const timelineNames: Record<string, string> = {};
      for (const name of entry.request.squad) {
        const meta = catalogByName.get(name);
        if (meta?.image) portraitUrls[name] = `${import.meta.env.BASE_URL}${meta.image}`;
        if (meta?.displayName) timelineNames[name] = meta.displayName;
      }
      const timelineBlock = createTimelineBlock(entry, portraitUrls, timelineNames);
      if (timelineBlock) blocks.set(entry.deckId, timelineBlock);
    }
    if (blocks.size > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'deck-result-tabs timeline-tabs';
      tabs.dataset.timelineTabs = '';
      const stage = document.createElement('div');
      stage.dataset.timelineStage = '';
      const buttons = new Map<number, HTMLButtonElement>();
      const show = (deckId: number) => {
        for (const [id, button] of buttons) {
          button.classList.toggle('is-on', id === deckId);
          button.setAttribute('aria-pressed', String(id === deckId));
        }
        stage.replaceChildren(blocks.get(deckId)!);
      };
      for (const deckId of blocks.keys()) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'deck-result-tab';
        tab.dataset.timelineTab = String(deckId);
        tab.append(createText('b', `隊 ${deckId}`));
        tab.addEventListener('click', () => show(deckId));
        buttons.set(deckId, tab);
        tabs.append(tab);
      }
      timelineBody.append(tabs, stage);
      show([...blocks.keys()][0]!);
    } else {
      for (const block of blocks.values()) timelineBody.append(block);
    }
    timelineHasContent = blocks.size > 0;
    timelinePanel.hidden = !timelineHasContent || currentView !== 'calc';
  };

  // ── 버스트 순서 ─────────────────────────────────────────────────────────
  /** 이 판에서만 쓰는 요소 만들기. union-raid의 같은 이름 도우미와 짝이다. */
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K, className?: string, text?: string,
  ): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // 사이클마다 단계별로 누구를 쓸지 손으로 정한다. 창을 쓰는 이유는 **키보드를
  // 통째로 가져가기 때문**이다 — 탭 안에 두면 A·S·D·F·G가 검색칸과 부딪친다.
  const burstModal = element<HTMLElement>(root, '[data-burst-order-modal]');
  const burstOpenButton = element<HTMLButtonElement>(root, '[data-burst-order-open]');
  const burstBadge = element<HTMLElement>(root, '[data-burst-order-badge]');
  const burstNow = element<HTMLElement>(root, '[data-burst-now]');
  const burstPicksBox = element<HTMLElement>(root, '[data-burst-picks]');
  const burstList = element<HTMLElement>(root, '[data-burst-list]');
  const burstProgress = element<HTMLElement>(root, '[data-burst-progress]');
  const burstCyclesOut = element<HTMLOutputElement>(root, '[data-burst-cycles]');
  const burstCyclesNote = element<HTMLElement>(root, '[data-burst-cycles-note]');
  const burstMsg = element<HTMLElement>(root, '[data-burst-order-msg]');

  /** 창이 열려 있는 동안의 작업본. 「이 순서로 두기」를 눌러야 덱에 남는다. */
  let burstPicks: Record<string, string> = {};
  let burstCycles = 1;
  let burstAt = 0;          // 지금 서 있는 걸음
  let burstSteps: BurstStep[] = [];

  const showBurstMsg = (message: string, ok = false) => {
    burstMsg.hidden = message === '';
    burstMsg.textContent = message;
    burstMsg.classList.toggle('is-ok', ok);
  };

  /** 「버스트 안 씀」으로 잡아 둔 사람. 후보에서 뺀다. */
  const burstSkipped = (deck: DeckState): Set<string> => new Set(
    Object.entries(deck.characters)
      .filter(([, value]) => value.burst?.mode === 'skip')
      .map(([name]) => name),
  );

  const burstCandidates = (stage: BurstStage): string[] => {
    const deck = activeDeck();
    return candidatesFor(stage, {
      squad: deck.squad,
      metaOf: (name) => catalogByName.get(name),
      skipped: burstSkipped(deck),
    });
  };

  /** 덱 도구 줄의 단추에 「9사이클」처럼 적어 둔다 — 열지 않아도 걸려 있는지 보인다. */
  function renderBurstBadge(): void {
    const kept = sequenceForDeck(activeDeck());
    burstBadge.hidden = kept === null;
    burstBadge.textContent = kept ? `${kept.length}` : '';
    // 순서를 걸어 두면 단추 자체가 색을 바꾼다 — 열어 보지 않아도 걸린 게 보인다.
    burstOpenButton.classList.toggle('is-on', kept !== null);
  }

  /** 아직 안 고른 첫 칸으로 옮긴다. 창을 다시 열면 하던 자리에서 이어진다. */
  const firstUnpicked = (): number => {
    const at = burstSteps.findIndex((step) => !burstPicks[stepKey(step)]);
    return at >= 0 ? at : Math.max(0, burstSteps.length - 1);
  };

  function renderBurstOrder(): void {
    burstSteps = stepsFor(burstCycles);
    burstAt = Math.min(Math.max(0, burstAt), Math.max(0, burstSteps.length - 1));
    burstCyclesOut.textContent = String(burstCycles);

    const { done, total } = progressOf(burstPicks, burstSteps);
    burstProgress.textContent = `${done} / ${total} 格`;

    // ── 지금 걸음 ──
    burstNow.replaceChildren();
    burstPicksBox.replaceChildren();
    const step = burstSteps[burstAt];
    if (!step) {
      burstNow.append(el('p', 'burst-empty', '請至少設定一個循環。'));
    } else {
      const head = el('div', 'burst-now-head');
      head.append(
        el('span', 'burst-now-cycle', `第 ${step.cycle} 次滿爆裂`),
        el('span', `burst-now-stage stage-${step.stage}`, `${step.stage} 爆`),
      );
      const picked = burstPicks[stepKey(step)];
      head.append(el('span', 'burst-now-pick', picked ? `→ ${resolveDisplayName(picked)}` : '→ 自動'));
      burstNow.append(head);

      const candidates = burstCandidates(step.stage);
      if (candidates.length === 0) {
        burstPicksBox.append(el('p', 'burst-empty',
          `編成中沒有 ${step.stage} 爆。這個階段會跳過。`));
      }
      candidates.forEach((name, index) => {
        const button = el('button', 'burst-pick' + (picked === name ? ' is-on' : ''));
        (button as HTMLButtonElement).type = 'button';
        const key = HOTKEYS[index];
        const face = document.createElement('div');
        face.className = 'burst-pick-face';
        const image = catalogByName.get(name)?.image;
        if (image) {
          const img = document.createElement('img');
          img.src = `${import.meta.env.BASE_URL}${image}`;
          img.alt = '';
          img.loading = 'lazy';
          face.append(img);
        } else {
          face.textContent = name.slice(0, 2);
        }
        button.append(face, el('span', 'burst-pick-name', name));
        if (key) button.append(el('b', 'burst-pick-key', key));
        button.addEventListener('click', () => pickBurst(name));
        burstPicksBox.append(button);
      });
      // 「이 단계는 자동으로」 — 고른 것을 무르는 자리다.
      const auto = el('button', 'burst-pick is-auto' + (picked ? '' : ' is-on'));
      (auto as HTMLButtonElement).type = 'button';
      auto.append(el('span', 'burst-pick-name', '自動'));
      auto.append(el('b', 'burst-pick-key', '0'));
      auto.addEventListener('click', () => pickBurst(null));
      burstPicksBox.append(auto);
    }

    // ── 적어 둔 것 ──
    // 사이클마다 **빈 칸 셋**이고, 고를 때마다 초상화가 채워진다. 글줄로 적으면
    // 스물일곱 칸 중 어디까지 왔는지가 안 읽힌다 — 빈 칸이 남아 있는 게 보여야 한다.
    burstList.replaceChildren();
    const sequence = sequenceFrom(burstPicks, burstCycles);
    sequence.forEach((cycle, index) => {
      const cycleNo = index + 1;
      const row = el('div', 'burst-row' + (burstSteps[burstAt]?.cycle === cycleNo ? ' is-now' : ''));
      row.title = cycleLine(cycle);
      row.append(el('span', 'burst-row-no', `${cycleNo}`));

      const slots = el('div', 'burst-row-slots');
      for (const stage of BURST_STAGES) {
        const name = (cycle[stage] ?? [])[0];
        const here = burstSteps[burstAt]?.cycle === cycleNo && burstSteps[burstAt]?.stage === stage;
        const slot = el('button', 'burst-slot'
          + (name ? ' is-filled' : '') + (here ? ' is-here' : ''));
        (slot as HTMLButtonElement).type = 'button';
        slot.append(el('span', `burst-slot-stage stage-${stage}`, `${stage} 爆`));

        const face = el('span', 'burst-slot-face');
        if (name) {
          const image = catalogByName.get(name)?.image;
          if (image) {
            const img = document.createElement('img');
            img.src = `${import.meta.env.BASE_URL}${image}`;
            img.alt = name;
            img.loading = 'lazy';
            face.append(img);
          } else {
            face.textContent = name.slice(0, 2);
          }
          slot.title = `第 ${cycleNo} 次 ${stage} 爆 — ${resolveDisplayName(name)}`;
        } else {
          slot.title = `第 ${cycleNo} 次 ${stage} 爆 — 尚未指定(自動)`;
        }
        slot.append(face);
        slot.addEventListener('click', () => {
          const at = burstSteps.findIndex((s) => s.cycle === cycleNo && s.stage === stage);
          if (at >= 0) burstAt = at;
          renderBurstOrder();
        });
        slots.append(slot);
      }
      row.append(slots);
      burstList.append(row);
    });
  }

  /** 한 칸 고르고 다음으로. `null`이면 그 칸을 자동으로 되돌린다. */
  function pickBurst(name: string | null): void {
    const step = burstSteps[burstAt];
    if (!step) return;
    if (name === null) delete burstPicks[stepKey(step)];
    else burstPicks[stepKey(step)] = name;
    if (burstAt < burstSteps.length - 1) burstAt += 1;
    showBurstMsg('');
    renderBurstOrder();
  }

  function openBurstOrder(): void {
    const deck = activeDeck();
    if (!deck.squad.some((name) => name.trim())) {
      showErrors(['要設定爆裂順序,請先填滿編成。']);
      return;
    }
    const kept = sequenceForDeck(deck);
    burstPicks = picksFrom(kept ?? undefined);
    // 사이클 수: 적어 둔 게 있으면 그만큼, 아니면 지난 계산의 **실제 횟수**,
    // 그것도 없으면 전투 시간으로 어림한다.
    const measured = cyclesFromTimeline(
      lastBatch?.decks.find((entry) => entry.deckId === deck.id)?.result.timeline);
    burstCycles = kept?.length ?? measured ?? estimateCycles(readBattle().duration);
    burstCyclesNote.textContent = kept
      ? '已載入先前記下的順序。'
      : (measured !== null
        ? `上次計算滿爆裂跑了 ${measured} 次。`
        : `以戰鬥 ${readBattle().duration} 秒估算的值。計算一次後會校準為實際次數。`);
    burstSteps = stepsFor(burstCycles);
    burstAt = firstUnpicked();
    showBurstMsg('');
    renderBurstOrder();
    burstModal.hidden = false;
  }

  const closeBurstOrder = () => { burstModal.hidden = true; };

  burstOpenButton.addEventListener('click', openBurstOrder);
  element<HTMLButtonElement>(root, '[data-burst-order-close]').addEventListener('click', closeBurstOrder);
  burstModal.addEventListener('click', (event) => {
    if (event.target === burstModal) closeBurstOrder();
  });
  element<HTMLButtonElement>(root, '[data-burst-cycles-up]').addEventListener('click', () => {
    burstCycles = Math.min(MAX_CYCLES, burstCycles + 1);
    renderBurstOrder();
  });
  element<HTMLButtonElement>(root, '[data-burst-cycles-down]').addEventListener('click', () => {
    burstCycles = Math.max(1, burstCycles - 1);
    renderBurstOrder();
  });
  element<HTMLButtonElement>(root, '[data-burst-order-reset]').addEventListener('click', () => {
    burstPicks = {};
    burstAt = 0;
    showBurstMsg('');
    renderBurstOrder();
  });
  element<HTMLButtonElement>(root, '[data-burst-order-save]').addEventListener('click', () => {
    const deck = activeDeck();
    const sequence = trimSequence(sequenceFrom(burstPicks, burstCycles));
    if (sequence) deck.burstSequence = sequence;
    else delete deck.burstSequence;
    saveState();
    renderBurstBadge();
    closeBurstOrder();
    showErrors([]);
  });
  element<HTMLButtonElement>(root, '[data-burst-order-clear]').addEventListener('click', () => {
    delete activeDeck().burstSequence;
    burstPicks = {};
    burstAt = 0;
    saveState();
    renderBurstBadge();
    renderBurstOrder();
    showBurstMsg('已清除順序。計算機會照平常順序選。', true);
  });

  // 키보드는 창이 열려 있을 때만 가져간다. 조합키가 눌린 입력은 브라우저 것이다.
  document.addEventListener('keydown', (event) => {
    if (burstModal.hidden) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') { closeBurstOrder(); return; }
    if (event.key === 'ArrowLeft') {
      burstAt = Math.max(0, burstAt - 1);
      renderBurstOrder();
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowRight') {
      burstAt = Math.min(Math.max(0, burstSteps.length - 1), burstAt + 1);
      renderBurstOrder();
      event.preventDefault();
      return;
    }
    if (event.key === '0') { pickBurst(null); event.preventDefault(); return; }
    const at = HOTKEYS.indexOf(event.key.toUpperCase() as typeof HOTKEYS[number]);
    if (at < 0) return;
    const step = burstSteps[burstAt];
    if (!step) return;
    const name = burstCandidates(step.stage)[at];
    if (!name) return;
    pickBurst(name);
    event.preventDefault();
  });

  element<HTMLButtonElement>(root, '[data-deck-clear]').addEventListener('click', () => {
    const deck = activeDeck();
    deck.squad = ['', '', '', '', ''];
    deck.characters = {};
    activeSlot = 0;
    closeDeckCopy();
    showErrors([]);
    saveState();
    renderDeckTabs();
    renderSquad();
    renderRosterGrid();
  });

  // 5덱 비우기 — 다섯을 한 번에 지우는 일이라 «한 번 더 누르면» 지운다. 창을 띄우는
  // 대신 단추가 스스로 확인을 받는다(잘못 눌렀으면 다른 데를 누르면 그만이다).
  const clearAllButton = element<HTMLButtonElement>(root, '[data-deck-clear-all]');
  let clearAllArmed = false;
  const disarmClearAll = () => {
    clearAllArmed = false;
    clearAllButton.textContent = '清空 5 隊';
    clearAllButton.classList.remove('is-armed');
  };
  clearAllButton.addEventListener('click', () => {
    if (!clearAllArmed) {
      clearAllArmed = true;
      clearAllButton.textContent = '確定清空';
      clearAllButton.classList.add('is-armed');
      return;
    }
    for (const deck of decks) {
      deck.squad = ['', '', '', '', ''];
      deck.characters = {};
      delete deck.name;
      delete deck.burstSequence;
    }
    activeSlot = 0;
    disarmClearAll();
    closeDeckCopy();
    showErrors([]);
    saveState();
    renderDeckTabs();
    renderSquad();
    renderRosterGrid();
    status.textContent = '已清空全部五隊。';
  });
  clearAllButton.addEventListener('blur', disarmClearAll);

  element<HTMLInputElement>(root, '#squad-mode').addEventListener('change', (event) => {
    fiveDeckMode = (event.currentTarget as HTMLInputElement).checked;
    // 5덱을 끄면 «지금 보고 있던 덱»이 1덱 자리로 온다 — 2~5덱 중 하나만 계산하려고
    // 끄는 경우가 많은데, 그때마다 편성을 손으로 옮기는 건 번거롭다(유저 피드백).
    if (!fiveDeckMode && activeDeckId !== 1) {
      const picked = decks.find((deck) => deck.id === activeDeckId);
      const first = decks[0]!;
      if (picked) {
        [first.squad, picked.squad] = [picked.squad, first.squad];
        [first.characters, picked.characters] = [picked.characters, first.characters];
      }
    }
    activeDeckId = 1;
    deckTabs.hidden = !fiveDeckMode;
    deckMoves.hidden = !fiveDeckMode;
    clearAllButton.hidden = !fiveDeckMode;
    deckNote.hidden = !fiveDeckMode;
    deckCopy.hidden = !fiveDeckMode;
    closeDeckCopy();
    saveState();
    renderDeckTabs();
    renderSquad();
    showErrors([]);
  });
  coreToggle.addEventListener('change', () => {
    corePxInput.disabled = !coreToggle.checked;
  });
  // 전투 조건 입력이 바뀌면 저장한다.
  form.addEventListener('change', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.settings-panel')) { saveState(); refreshBattleSummary(); }
  });
  // ── 전투 조건 공유 ──────────────────────────────────────────────────────
  const battleShareModal = element<HTMLElement>(root, '[data-battle-share-modal]');
  const battleShareOut = element<HTMLTextAreaElement>(root, '[data-battle-share-out]');
  const battleShareIn = element<HTMLTextAreaElement>(root, '[data-battle-share-in]');
  const battleShareMsg = element<HTMLElement>(root, '[data-battle-share-msg]');
  const showBattleShareMsg = (message: string, ok = false) => {
    battleShareMsg.hidden = message === '';
    battleShareMsg.textContent = message;
    battleShareMsg.classList.toggle('is-ok', ok);
  };

  /** 받은 전투 조건을 얹는다. 콘솔과 싱크로 레벨은 코드에 없으므로 내 값을 그대로 둔다. */
  const applyBattleCode = (code: string): void => {
    const applied = decodeBattleCode(code);
    const mine = readBattle();
    writeBattle({ ...applied, console: mine.console, synchroLevel: mine.synchroLevel });
    corePxInput.disabled = !applied.coreEnabled;
    saveState();
    showErrors([]);
  };
  const battleSharePanel: SharePanel | null = shareServer && mountSharePanel(
    sharePanelHosts('battle-share'),
    {
      kind: 'boss',
      server: shareServer,
      current: () => ({
        code: encodeBattleCode(readBattle(), settings.normalHitCoeff ?? {}),
        auto: summarizeBattle(readBattle()),
      }),
      apply: (item) => {
        applyBattleCode(item.code);
        showBattleShareMsg(`已套用「${item.name}」。主控台維持我的值。`, true);
      },
      notify: showBattleShareMsg,
    },
  );

  element<HTMLButtonElement>(root, '[data-battle-share-open]').addEventListener('click', () => {
    battleShareOut.value = encodeBattleCode(readBattle(), settings.normalHitCoeff ?? {});
    battleShareIn.value = '';
    showBattleShareMsg('');
    battleShareModal.hidden = false;
    battleSharePanel?.open();
  });
  element<HTMLButtonElement>(root, '[data-battle-share-close]').addEventListener('click', () => {
    battleShareModal.hidden = true;
  });
  battleShareModal.addEventListener('click', (event) => {
    if (event.target === battleShareModal) battleShareModal.hidden = true;
  });
  element<HTMLButtonElement>(root, '[data-battle-share-copy]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(battleShareOut.value);
      showBattleShareMsg('已複製代碼。', true);
    } catch {
      battleShareOut.select();
      showBattleShareMsg('自動複製被擋,已幫你選取代碼。請用 Ctrl+C 複製。');
    }
  });
  element<HTMLButtonElement>(root, '[data-battle-share-apply]').addEventListener('click', () => {
    try {
      applyBattleCode(battleShareIn.value);
      showBattleShareMsg('已套用戰鬥條件。主控台維持我的值。', true);
    } catch (error) {
      showBattleShareMsg(error instanceof Error ? error.message : String(error));
    }
  });

  element<HTMLButtonElement>(root, '[data-reset-enemy]').addEventListener('click', () => {
    writeBattle(resetEnemy(readBattle()));
    saveState();
    showErrors([]);
  });
  // 니케 고르기 판. 창이 아니라 편성 바로 아래 늘 펼쳐져 있고, 검색은 이 판을 거른다.
  const rosterGrid = element<HTMLElement>(root, '[data-roster-grid]');
  const rosterSearch = element<HTMLInputElement>(root, '[data-roster-search]');
  const rosterEmpty = element<HTMLElement>(root, '[data-roster-empty]');
  const rosterCount = element<HTMLElement>(root, '[data-roster-count]');
  const rosterDesc = element<HTMLElement>(root, '[data-roster-desc]');
  const pickerPanel = element<HTMLElement>(root, '[data-picker]');

  /** 고르기 판을 펴거나 접는다. 접으면 겨냥한 칸 표시도 함께 풀린다. */
  const setPickerOpen = (on: boolean) => {
    if (pickerOpen === on) { if (on) { renderSquad(); renderRosterGrid(); } return; }
    pickerOpen = on;
    pickerPanel.hidden = !on;
    renderSquad();
    if (on) renderRosterGrid();
  };

  element<HTMLButtonElement>(root, '[data-picker-close]')
    .addEventListener('click', () => setPickerOpen(false));

  // 빈 곳을 누르면 접는다. 편성·판·덱 줄 안쪽은 «고르는 중»이라 그대로 둔다.
  //
  // **누르는 순간(캡처)에 판정한다.** 버튼 제 손으로 편성을 다시 그리는 자리가 많아,
  // 거품 단계까지 오면 눌린 요소가 이미 DOM에서 떨어져 나가 조상이 없다 — 그러면
  // 편성 안을 눌러도 «바깥»으로 읽혀 판이 곧바로 닫힌다.
  const KEEP_OPEN = '[data-picker], .squad-grid, .deck-tabs, .deck-controls, .custom-modal';
  root.addEventListener('click', (event) => {
    if (!pickerOpen) return;
    const hit = event.target as HTMLElement | null;
    if (!hit || hit.closest(KEEP_OPEN)) return;
    setPickerOpen(false);
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !pickerOpen) return;
    // 창이 열려 있으면 그쪽이 먼저다 — 판은 그다음 Esc에 접힌다.
    if (root.querySelector('.custom-modal:not([hidden])')) return;
    setPickerOpen(false);
  });
  // 필터는 **그룹 안에서는 OR, 그룹 사이에서는 AND**다. 무기 SG·SMG를 함께 켜면
  // 둘 중 하나면 통과하고, 거기에 클래스 화력형을 더하면 «화력형이면서 SG나 SMG»가 된다.
  // 인게임 도감이 이 방식이라 익숙하고, 하나만 고르는 것보다 훨씬 빨리 좁혀진다.
  type FilterKey = 'burst' | 'rarity' | 'class' | 'code' | 'weapon' | 'corp';
  const picked: Record<FilterKey, Set<string>> = {
    burst: new Set(), rarity: new Set(), class: new Set(),
    code: new Set(), weapon: new Set(), corp: new Set(),
  };
  type SortKey = 'power' | 'name' | 'element' | 'elementAtk';
  // 처음 보이는 순서는 전투력 높은 순이다 — 목록에서 먼저 찾는 것이 «내가 키운
  // 니케»라, 가나다순으로 세워 두면 매번 스크롤해서 찾아야 한다.
  const DEFAULT_SORT: SortKey = 'power';
  let sortKey: SortKey = DEFAULT_SORT;
  // 같은 항목을 다시 누르면 뒤집는다. 항목마다 «자연스러운» 방향이 달라서
  // (이름은 가나다순, 수치는 높은 순) 처음 고를 때는 그 방향으로 잡는다.
  let sortDesc = true;

  // ── 정렬 · 필터 판 ──────────────────────────────────────────────────────
  // 정렬은 «내 로스터에서 이 캐릭터가 얼마나 굴려졌나»를 본다. 오버로드 수치가
  // 그 척도라, CSV·프로필로 불러온 내 값이 있으면 그걸 쓰고 없으면 기본 스펙을 쓴다.
  const SORTS: Array<{ key: SortKey; label: string; hint: string }> = [
    { key: 'power', label: '戰鬥力', hint: '遊戲內戰力 — 再按一次反轉' },
    { key: 'name', label: '名稱', hint: '依名稱 — 再按一次反轉' },
    { key: 'element', label: '剋制代碼', hint: '超載剋制代碼傷害 — 再按一次反轉' },
    { key: 'elementAtk', label: '剋攻合', hint: '剋制代碼 + 攻擊力增加之和 — 再按一次反轉' },
  ];

  /** 처음 고를 때의 방향. 이름은 오름차순, 수치는 높은 순이 자연스럽다. */
  const defaultDesc = (key: SortKey): boolean => key !== 'name';

  /** 이 캐릭터에게 실제로 적용될 오버로드 — 내 로스터 값이 우선이다. */
  const overloadOf = (name: string): Record<string, number> =>
    roster[name]?.overload ?? settings.characters[name]?.overload ?? {};

  // 전투력은 엔진이 기본 스탯까지 계산해야 나온다 — 워커를 한 번 돌려 받아 둔다.
  // 로스터를 바꾸면 값이 달라지므로 서명이 어긋나면 다시 받는다.
  let combatPower: Record<string, number> = {};
  let powerSig = '';
  let powerLoading = false;

  const loadCombatPower = async () => {
    if (!client.combatPower) return;
    const sig = JSON.stringify(roster);
    if (powerLoading || powerSig === sig) return;
    powerLoading = true;
    try {
      await prepared;
      const custom = customPayload();
      const got = await client.combatPower({
        names: catalog.map((meta) => meta.name),
        characters: roster,
        ...(Object.keys(custom).length > 0 ? { customCharacters: custom } : {}),
      });
      combatPower = got;
      powerSig = sig;
      renderFilterState();
      renderRosterGrid();
    } catch {
      /* 전투력은 정렬 편의 기능이다 — 실패해도 목록은 그대로 쓴다 */
    } finally {
      powerLoading = false;
    }
  };

  /** 버스트만 판 밖에 있다 — 값은 여기 두고 그리는 자리만 다르다. */
  const BURST_VALUES = ['1', '2', '3', 'A'];
  const FILTER_GROUPS: Array<{ key: FilterKey; title: string; values: string[] }> = [
    { key: 'rarity', title: '稀有度', values: ['SSR', 'SR', 'R'] },
    { key: 'class', title: '職業', values: ['화력형', '방어형', '지원형'] },
    { key: 'code', title: '屬性', values: ['작열', '수냉', '풍압', '전격', '철갑'] },
    { key: 'weapon', title: '武器', values: ['AR', 'SMG', 'SG', 'SR', 'RL', 'MG'] },
    { key: 'corp', title: '企業', values: ['엘리시온', '미실리스', '테트라', '필그림', '어브노말'] },
  ];

  // 값(필터·직렬화에 쓰는 한국어)은 그대로 두고, 보이는 라벨만 중국어로 바꾼다.
  const labelOf = (key: FilterKey, value: string) =>
    key === 'burst' ? `B${value}` : termZh(value);

  /** 고른 필터 개수. 0이면 뱃지를 감춘다. */
  const pickedCount = (): number =>
    Object.values(picked).reduce((sum, set) => sum + set.size, 0);

  function sortRoster(list: CharacterMeta[]): void {
    // 화면에 보이는 이름으로 세운다 — 영어 이름이 적혀 있는데 한국어 가나다순으로
    // 늘어서면 「이름순」이라는 말이 거짓이 된다.
    const byName = (a: CharacterMeta, b: CharacterMeta) =>
      (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name, 'zh-Hant');
    const flip = sortDesc ? -1 : 1;
    if (sortKey === 'name') { list.sort((a, b) => flip * byName(a, b)); return; }
    const scoreOf = (char: CharacterMeta): number => {
      if (sortKey === 'power') return combatPower[char.name] ?? 0;
      const over = overloadOf(char.name);
      const element = over.element_bonus ?? 0;
      return sortKey === 'element' ? element : element + (over.atk_pct ?? 0);
    };
    // 같은 값 안에서는 늘 이름순 — 정렬 방향을 바꿔도 동점끼리 요동치지 않는다.
    list.sort((a, b) => flip * (scoreOf(a) - scoreOf(b)) || byName(a, b));
  }

  const filterPanel = element<HTMLElement>(root, '[data-filter-panel]');
  const filterOpen = element<HTMLButtonElement>(root, '[data-filter-open]');
  const filterBadge = element<HTMLElement>(root, '[data-filter-badge]');
  const filterReset = element<HTMLButtonElement>(root, '[data-filter-reset]');
  const filterSummary = element<HTMLElement>(root, '[data-filter-summary]');

  const renderFilterState = () => {
    const count = pickedCount();
    filterBadge.hidden = count === 0;
    filterBadge.textContent = String(count);
    filterReset.hidden = count === 0;
    // 판을 접어도 무엇이 걸려 있는지 알 수 있게 요약을 남긴다.
    // 정렬은 늘 적혀 있다 — 기본이 전투력순이라, 안 적어 두면 «왜 가나다순이
    // 아닌가»를 판을 펼쳐야만 알 수 있다.
    const parts: string[] = [];
    const label = SORTS.find((s) => s.key === sortKey)?.label;
    const pending = sortKey === 'power' && Object.keys(combatPower).length === 0;
    parts.push(`${label}${pending ? ' 計算中' : sortDesc ? ' ▼' : ' ▲'}`);
    for (const key of ['burst', ...FILTER_GROUPS.map((group) => group.key)] as FilterKey[]) {
      const set = picked[key];
      if (set.size > 0) {
        parts.push([...set].map((value) => labelOf(key, value)).join('·'));
      }
    }
    filterSummary.textContent = parts.join(' · ');
  };

  /** 필터 칩 하나. 같은 칩을 다시 누르면 꺼진다 — 「전체」 칩을 따로 두지 않아도 된다. */
  const filterChip = (key: FilterKey, value: string): HTMLButtonElement => {
    const chip = document.createElement('button');
    chip.type = 'button';
    const on = picked[key].has(value);
    chip.className = 'filter-chip' + (on ? ' is-on' : '');
    chip.dataset.filterChip = `${key}:${value}`;
    chip.setAttribute('aria-pressed', String(on));
    chip.textContent = labelOf(key, value);
    chip.addEventListener('click', () => {
      if (on) picked[key].delete(value);
      else picked[key].add(value);
      renderFilterPanel();
      renderFilterState();
      renderRosterGrid();
    });
    return chip;
  };

  const renderFilterPanel = () => {
    const burstBox = element<HTMLElement>(root, '[data-burst-group]');
    burstBox.replaceChildren(...BURST_VALUES.map((value) => filterChip('burst', value)));

    const sortBox = element<HTMLElement>(root, '[data-sort-group]');
    sortBox.replaceChildren();
    for (const option of SORTS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      const active = sortKey === option.key;
      chip.className = 'filter-chip' + (active ? ' is-on' : '');
      chip.dataset.sort = option.key;
      chip.dataset.sortDir = active ? (sortDesc ? 'desc' : 'asc') : '';
      chip.append(createText('span', option.label));
      // 삼각형으로 방향을 알린다 — 켜진 항목에만 붙는다.
      if (active) chip.append(createText('b', sortDesc ? '▼' : '▲', 'sort-caret'));
      chip.title = option.hint;
      chip.addEventListener('click', () => {
        // 같은 항목을 다시 누르면 뒤집고, 다른 항목이면 그 항목의 기본 방향으로 간다.
        if (active) sortDesc = !sortDesc;
        else { sortKey = option.key; sortDesc = defaultDesc(option.key); }
        // 전투력은 무거우니 고를 때 받는다. 오는 동안은 이름순으로 서 있는다.
        if (sortKey === 'power') void loadCombatPower();
        renderFilterPanel();
        renderFilterState();
        renderRosterGrid();
      });
      sortBox.append(chip);
    }

    const box = element<HTMLElement>(root, '[data-filter-groups]');
    box.replaceChildren();
    for (const group of FILTER_GROUPS) {
      const section = document.createElement('div');
      section.className = 'filter-section';
      section.append(createText('p', FILTER_TITLE_ZH[group.key] ?? group.title, 'filter-title'));
      const chips = document.createElement('div');
      chips.className = 'filter-chips';
      chips.append(...group.values.map((value) => filterChip(group.key, value)));
      section.append(chips);
      box.append(section);
    }
  };

  const setFilterPanel = (open: boolean) => {
    filterOpen.setAttribute('aria-expanded', String(open));
    filterPanel.hidden = !open;
  };
  filterOpen.addEventListener('click', () => {
    setFilterPanel(filterOpen.getAttribute('aria-expanded') !== 'true');
  });
  // 목록 위에 얹히는 판이라 드롭다운과 같은 규칙을 따른다 — 바깥을 누르거나
  // Esc면 닫힌다. 판 안과 판을 여는 줄(«필터 지우기» 포함)은 바깥이 아니다.
  const pickerBar = element<HTMLElement>(root, '.picker-bar');
  document.addEventListener('pointerdown', (event) => {
    if (filterPanel.hidden) return;
    const target = event.target as Node | null;
    if (target && (filterPanel.contains(target) || pickerBar.contains(target))) return;
    setFilterPanel(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !filterPanel.hidden) setFilterPanel(false);
  });
  filterReset.addEventListener('click', () => {
    for (const set of Object.values(picked)) set.clear();
    sortKey = DEFAULT_SORT;
    sortDesc = defaultDesc(DEFAULT_SORT);
    renderFilterPanel();
    renderFilterState();
    renderRosterGrid();
  });

  const renderRosterGrid = () => {
    // 직접 추가한 니케까지 포함해 지금 고를 수 있는 전체를 보여준다.
    const all = [...catalogByName.values()]
      .sort((a, b) => (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name, 'zh-Hant'));
    const narrowed = all.filter((char) => {
      const meta = settings.characters[char.name];
      const hit = (key: FilterKey, value: string | undefined) =>
        picked[key].size === 0 || (value !== undefined && picked[key].has(value));
      return hit('burst', char.burstStage)
        && hit('rarity', meta?.rarity)
        && hit('class', char.className)
        && hit('code', char.elementCode)
        && hit('weapon', char.weaponType)
        && hit('corp', char.manufacturer);
    });
    sortRoster(narrowed);
    // 칩으로 먼저 좁히고 검색어로 세운다. 검색은 초성과 구분자까지 받아
    // 「ㅋㄹㅇ」·「라피레드」가 걸리고, 친 이름이 맨 앞에 온다.
    const shown = filterByQuery(narrowed, rosterSearch.value, buildIndex);
    rosterCount.textContent = shown.length === all.length
      ? `${all.length} 名` : `${shown.length} / ${all.length} 名`;
    const deck = activeDeck();
    rosterGrid.replaceChildren();
    for (const char of shown) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'roster-cell';
      cell.dataset.rosterCell = char.name;
      // 이미 이 덱에 있으면 중복 편성이 안 되므로 눌리지 않게 둔다.
      const takenAt = deck.squad.indexOf(char.name);
      if (takenAt >= 0 && takenAt !== activeSlot) {
        cell.disabled = true;
        cell.classList.add('is-taken');
        cell.title = `已在隊伍 ${deck.id} 的第 ${takenAt + 1} 格`;
      }
      const portrait = document.createElement('div');
      portrait.className = 'roster-portrait';
      if (char.image) {
        const img = document.createElement('img');
        img.src = `${import.meta.env.BASE_URL}${char.image}`;
        img.alt = '';
        img.loading = 'lazy';
        portrait.append(img);
      }
      const badge = document.createElement('span');
      badge.className = 'roster-burst';
      badge.textContent = `B${char.burstStage}`;
      portrait.append(badge);
      // 버스트 단계 맞은편(우상단)에 속성 아이콘.
      const codeIcon = createElementIcon(char.elementCode, 'roster-code');
      if (codeIcon) portrait.append(codeIcon);
      if (char.preview) {
        // (임시) — 스킬 미공개라 창작한 값으로 도는 캐릭터. 고르기 전에 보여야 한다.
        const temp = createText('i', '暫定', 'roster-temp');
        temp.title = '技能尚未公開,以任意創作的值計算';
        portrait.append(temp);
      }
      cell.append(
        portrait,
        createText('strong', char.preview ? `${char.displayName ?? char.name}(暫定)` : (char.displayName ?? char.name)),
        createText('span', [termZh(char.elementCode), char.weaponType, termZh(char.className)].filter(Boolean).join(' · ')),
      );
      cell.addEventListener('click', () => pickCharacter(char.name));
      // 끌어다 칸에 놓을 수도 있다. 이미 이 덱에 있는 니케는 누를 수 없으니 끌 수도 없다.
      if (!cell.disabled) {
        cell.draggable = true;
        cell.addEventListener('dragstart', (event) => {
          const drag = event as DragEvent;
          drag.dataTransfer?.setData(DRAG_NAME, char.name);
          drag.dataTransfer?.setData('text/plain', char.name);
          if (drag.dataTransfer) drag.dataTransfer.effectAllowed = 'copy';
          cell.classList.add('is-dragging');
        });
        cell.addEventListener('dragend', () => cell.classList.remove('is-dragging'));
      }
      rosterGrid.append(cell);
    }
    rosterEmpty.hidden = shown.length > 0;
    updatePickerTarget();
  };

  /**
   * 다른 덱에 남아 있는 그 캐릭터의 개별 설정. 지금 보고 있는 덱은 빼고, 가장
   * 가까운 덱부터 찾는다 — 방금 만진 덱의 값이 가장 그럴듯하기 때문이다.
   */
  const settingsFromOtherDeck = (name: string): CharacterOverrides | undefined => {
    const others = [...decks].sort((a, b) =>
      Math.abs(a.id - activeDeckId) - Math.abs(b.id - activeDeckId));
    for (const other of others) {
      if (other.id === activeDeckId) continue;
      const found = other.characters[name];
      if (found) return cloneOverride(found);
    }
    return undefined;
  };

  const carryToggle = element<HTMLInputElement>(root, '#carry-settings');
  carryToggle.addEventListener('change', () => {
    carryOverSettings = carryToggle.checked;
    saveState();
  });

  const pickCharacter = (name: string, targetSlot = activeSlot) => {
    const deck = activeDeck();
    const slot = Math.max(0, Math.min(4, targetSlot));
    const previous = deck.squad[slot] ?? '';
    deck.squad[slot] = name;
    if (previous && previous !== name) delete deck.characters[previous];
    if (!deck.characters[name]) {
      // 다른 덱에서 이미 만져 둔 설정이 있으면 그것을 가져온다. 없으면 CSV·프로필로
      // 불러온 내 로스터 값을 쓴다. 덱을 옮길 때마다 같은 수치를 다시 넣는 일이
      // 가장 잦은 불편이었다 — 끄면 예전처럼 덱마다 따로 논다.
      const borrowed = carryOverSettings ? settingsFromOtherDeck(name) : undefined;
      if (borrowed) deck.characters[name] = borrowed;
      else if (roster[name]) deck.characters[name] = cloneOverride(roster[name]!);
    }
    // 연달아 채울 수 있게 다음 빈 칸으로 옮겨 간다. 다 찼으면 방금 넣은 칸에 머문다.
    const next = deck.squad.findIndex((member) => !member);
    activeSlot = next < 0 ? slot : next;
    pullActiveSlot = true;
    showErrors([]);
    saveState();
    renderDeckTabs();
    renderSquad();
    renderRosterGrid();
    // (임시) 캐릭터는 넣는 순간 바로 알린다 — 결과까지 가서야 알면 이미 늦다.
    if (catalogByName.get(name)?.preview) {
      status.textContent = `${resolveDisplayName(name)} 目前仍是(暫定)登錄 — 技能尚未公開,`
        + '以任意創作的值計算。與實際性能無關,僅供參考。';
    }
  };

  /** 판이 어느 칸을 겨냥하는지 알려 준다. 창이 없으니 이 한 줄이 유일한 안내다. */
  const updatePickerTarget = () => {
    const deck = activeDeck();
    const filled = deck.squad.filter(Boolean).length;
    const current = deck.squad[activeSlot];
    rosterDesc.textContent = current
      ? `填入第 ${activeSlot + 1} 格,取代 ${resolveDisplayName(current)} · ${filled}/5 名`
      : `填入第 ${activeSlot + 1} 個空格 · ${filled}/5 名`;
  };

  // 접힌 채로 시작한다 — 무엇으로 재는지 한 줄은 처음부터 적혀 있어야 한다.
  refreshBattleSummary();
  renderFilterPanel();
  renderFilterState();
  rosterSearch.addEventListener('input', renderRosterGrid);

  // 완전 초기화 — 이 브라우저에 쌓인 저장 상태를 전부 버린다. 메모리 변수까지
  // 하나씩 되돌리는 대신 저장소를 비우고 페이지를 다시 띄워, 새로 방문한 것과
  // 같은 상태임을 보장한다.
  const resetModal = element<HTMLElement>(root, '[data-reset-modal]');
  const closeResetModal = () => { resetModal.hidden = true; };
  element<HTMLButtonElement>(root, '[data-reset-all]').addEventListener('click', () => {
    resetModal.hidden = false;
  });
  element<HTMLButtonElement>(root, '[data-reset-close]').addEventListener('click', closeResetModal);
  element<HTMLButtonElement>(root, '[data-reset-cancel]').addEventListener('click', closeResetModal);
  resetModal.addEventListener('click', (event) => {
    if (event.target === resetModal) closeResetModal();
  });
  element<HTMLButtonElement>(root, '[data-reset-confirm]').addEventListener('click', () => {
    cache.clear();
    const store = resolveStorage();
    for (const key of [STATE_KEY, ROSTER_KEY, CUSTOM_KEY]) {
      try {
        store?.removeItem(key);
      } catch {
        // 저장소를 못 쓰는 브라우저에서도 나머지 초기화는 계속한다.
      }
    }
    closeResetModal();
    (reload ?? (() => window.location.reload()))();
  });

  element<HTMLButtonElement>(root, '[data-clear-cache]').addEventListener('click', () => {
    cache.clear();
    showErrors([]);
    status.textContent = '已清除已儲存的結果。再執行會重新計算。';
  });
  const applyRosterToDecks = () => {
    for (const deck of decks) {
      for (const member of deck.squad) {
        if (member && roster[member] && !deck.characters[member]) {
          deck.characters[member] = cloneOverride(roster[member]!);
        }
      }
    }
  };
  const updateRosterNote = (message?: string) => {
    const count = Object.keys(roster).length;
    if (message) rosterNote.textContent = message;
    else if (count > 0) rosterNote.textContent = `套用 CSV 名單 ${count} 名中`;
    rosterNote.hidden = !message && count === 0;
  };
  rosterInput.addEventListener('change', async () => {
    const file = rosterInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { overrides, matched, unmatched } = parseRosterCsv(text, settings);
      if (matched.length === 0) {
        updateRosterNote('在 CSV 找不到支援的角色。請確認正式名稱是否一致。');
        return;
      }
      roster = overrides;
      saveRoster();
      void loadCombatPower();
      applyRosterToDecks();
      saveState();
      renderDeckTabs();
      renderSquad();
      const skipped = unmatched.length > 0 ? ` · 已排除不支援的 ${unmatched.length} 名` : '';
      updateRosterNote(`套用 CSV 名單 ${matched.length} 名${skipped}`
        + ' · 魔方與好感度 CSV 沒有,以預設值計算(可在卡片個別設定修改)');
    } catch (error) {
      updateRosterNote(`CSV 匯入失敗:${error instanceof Error ? error.message : String(error)}`);
    } finally {
      rosterInput.value = '';
    }
  });

  // 블라블라링크 연동. 프록시가 설정된 빌드에서만 마크업이 있으므로 없으면 통째로 건너뛴다.
  if (blablaProxy) {
    const blablaModal = element<HTMLElement>(root, '[data-blabla-modal]');
    const blablaServer = element<HTMLSelectElement>(root, '[data-blabla-server]');
    const blablaUrl = element<HTMLInputElement>(root, '[data-blabla-url]');
    const blablaSync = element<HTMLButtonElement>(root, '[data-blabla-sync]');
    const blablaStatus = element<HTMLElement>(root, '[data-blabla-status]');

    const setStatus = (message: string) => {
      blablaStatus.textContent = message;
      blablaStatus.hidden = message === '';
    };

    const runSync = async () => {
      const url = blablaUrl.value.trim();
      if (!looksLikeProfileUrl(url)) {
        setStatus('請貼上 Blablalink 個人檔案網址。');
        return;
      }
      const selectedArea = blablaServer.value === '' ? undefined : Number(blablaServer.value);
      blablaSync.disabled = true;
      blablaServer.disabled = true;
      setStatus('正在從 Blablalink 取得… 妮姬多時會花幾秒。');
      try {
        const response = await fetch(`${blablaProxy}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profileUrl: url,
            ...(selectedArea === undefined ? {} : { area: selectedArea }),
          }),
        });
        const payload = await response.json() as RawProfile & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `同步失敗 (${response.status})。`);

        const area = pickArea(payload, selectedArea);
        if (!area) throw new Error('妮姬清單是空的。');
        const serverLabel = blablaServerLabel(area.area);
        const { overrides, matched, unmatched, notes } = areaToOverrides(area, settings, catalog);
        if (matched.length === 0) {
          setStatus('找不到計算機支援的妮姬。請確認個人檔案是否公開。');
          return;
        }

        roster = overrides;
        saveRoster();
        void loadCombatPower();
        applyRosterToDecks();

        // 콘솔은 계정 단위라 전투 설정 쪽에 있다. 전초기지가 비공개면 안 오고, 그때는
        // 손대지 않는 게 맞다 — 0으로 덮으면 멀쩡하던 값이 사라진다.
        const consoleLevels = consoleFrom(area);
        // 싱크로도 계정 값으로 맞춘다. 기본값 400은 «솔로레이드 기준» 자리채움이라,
        // 내 계정으로 재려면 실제 레벨이어야 한다 — 소대에 든 니케는 전원이 이 레벨이다.
        const accountSynchro = synchroFrom(area);
        if (consoleLevels || accountSynchro !== null) {
          writeBattle({
            ...readBattle(),
            ...(consoleLevels ? { console: consoleLevels } : {}),
            ...(accountSynchro !== null ? { synchroLevel: accountSynchro } : {}),
          });
        }

        saveState();
        renderDeckTabs();
        renderSquad();

        const parts = [`套用 Blablalink ${serverLabel} ${matched.length} 名`];
        if (unmatched.length > 0) parts.push(`排除不支援的 ${unmatched.length} 名`);
        if (consoleLevels) parts.push('一併套用主控台等級');
        if (accountSynchro !== null) parts.push(`套用同步器 ${accountSynchro}`);
        updateRosterNote(parts.join(' · '));
        setStatus([`已從 ${serverLabel} 伺服器載入 ${matched.length} 名。`, ...notes].join(' '));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        blablaSync.disabled = false;
        blablaServer.disabled = false;
      }
    };

    element<HTMLButtonElement>(root, '[data-blabla-open]').addEventListener('click', () => {
      blablaModal.hidden = false;
      blablaUrl.focus();
    });
    element<HTMLButtonElement>(root, '[data-blabla-close]').addEventListener('click', () => {
      blablaModal.hidden = true;
    });
    blablaModal.addEventListener('click', (event) => {
      if (event.target === blablaModal) blablaModal.hidden = true;
    });
    blablaSync.addEventListener('click', () => { void runSync(); });
    blablaUrl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); void runSync(); }
    });
  }

  // ── ENIKK 조합 가져오기 ─────────────────────────────────────────────────
  // enikk.app 솔로레이드 랭킹 상위 300명(서버당 50명 × 6서버)의 1~5덱을 받아
  // 같은 편성끼리 묶는다. 페이지를 넘길 필요가 없다 — GraphQL이 한 번에 다 준다.
  // v1은 조합으로 묶어 저장했다(`players`가 숫자였다). 사람 단위로 바꾸면서 모양이
  // 달라졌으므로 키를 올린다 — 안 올리면 예전 캐시를 새 코드가 읽다 터진다.
  const ENIKK_KEY = 'nikke-enikk-v2';
  const enikkStatus = element<HTMLElement>(root, '[data-enikk-status]');
  const enikkSummary = element<HTMLElement>(root, '[data-enikk-summary]');
  const enikkList = element<HTMLElement>(root, '[data-enikk-list]');
  const enikkCompare = element<HTMLElement>(root, '[data-enikk-compare]');
  const enikkLoad = element<HTMLButtonElement>(root, '[data-enikk-load]');
  const enikkRefresh = element<HTMLButtonElement>(root, '[data-enikk-refresh]');
  let enikkData: EnikkImport | null = null;
  // 300명을 한 줄로 늘어놓으면 스크롤이 끝없다 — 열 명씩 끊어 쪽으로 넘긴다.
  const ENIKK_PER_PAGE = 10;
  let enikkPage = 0;
  let currentView: 'calc' | 'union' | 'enikk' | 'links' = 'calc';

  const readEnikkCache = (): EnikkImport | null => {
    try {
      const raw = resolveStorage()?.getItem(ENIKK_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as EnikkImport;
      // 키를 올려도 남의 브라우저에는 무엇이 들어 있을지 모른다. 쓰기 전에 모양을 본다.
      if (!Array.isArray(data?.players) || !data.season) return null;
      return data;
    } catch { return null; }
  };
  const writeEnikkCache = (data: EnikkImport) => {
    try { resolveStorage()?.setItem(ENIKK_KEY, JSON.stringify(data)); } catch { /* 용량 초과면 그냥 안 남긴다 */ }
  };

  /** 초상화 다섯 장. 이름을 모르는 사람도 눈으로 알아보게. */
  const enikkPortraits = (squad: string[]): HTMLElement => {
    const box = document.createElement('div');
    box.className = 'enikk-faces';
    for (const name of squad) {
      const char = catalogByName.get(name);
      const cell = document.createElement('span');
      cell.className = 'enikk-face';
      cell.title = name;
      if (char?.image) {
        const img = document.createElement('img');
        img.src = `${import.meta.env.BASE_URL}${char.image}`;
        img.alt = name;
        img.loading = 'lazy';
        cell.append(img);
      }
      cell.append(createText('em', name));
      box.append(cell);
    }
    return box;
  };

  /** 한 플레이어의 다섯 덱을 우리 5덱에 그대로 깐다. */
  const applyPlayerToDecks = (player: EnikkPlayer) => {
    const usable = player.decks.filter(enikkDeckUsable);
    if (usable.length === 0) return;
    for (const deck of decks) { deck.squad = ['', '', '', '', '']; deck.characters = {}; }
    usable.slice(0, 5).forEach((source, index) => {
      const deck = decks[index]!;
      deck.squad = [...source.squad];
      for (const name of source.squad) {
        if (roster[name]) deck.characters[name] = cloneOverride(roster[name]!);
      }
    });
    // 다섯 덱을 한 번에 받았으니 5덱 모드가 아니면 볼 수가 없다.
    if (usable.length > 1 && !fiveDeckMode) {
      const toggle = element<HTMLInputElement>(root, '#squad-mode');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change'));
    }
    activeDeckId = 1;
    activeSlot = 0;
    showErrors([]);
    saveState();
    renderDeckTabs();
    renderSquad();
    renderRosterGrid();
    switchView('calc');
    scrollTo(squadGrid);
  };

  // ── 제외 니케 ───────────────────────────────────────────────────────────
  // 안 가진 니케가 낀 덱은 가져와도 못 쓴다. enikk 데이터 자체가 아니라 «내 사정»이라
  // 계산 결과가 아닌 **화면 층**에서 거른다.
  const EXCLUDE_KEY = 'nikke-enikk-excluded-v1';
  let enikkExcluded: string[] = [];
  try {
    const raw = resolveStorage()?.getItem(EXCLUDE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    if (Array.isArray(parsed)) {
      enikkExcluded = parsed.filter((n): n is string =>
        typeof n === 'string' && catalogByName.has(n));
    }
  } catch { /* 못 읽으면 빈 목록으로 시작한다 */ }

  const saveExcluded = () => {
    try {
      resolveStorage()?.setItem(EXCLUDE_KEY, JSON.stringify(enikkExcluded));
    } catch { /* 저장 실패 무시 */ }
  };

  /** 이 덱을 쓸 수 있나 — 계산기가 다룰 수 있고, 제외 니케가 안 껴 있어야 한다. */
  const enikkDeckUsable = (deck: { squad: string[]; usable: boolean }): boolean =>
    deck.usable && !deck.squad.some((name) => enikkExcluded.includes(name));

  const renderExcludeChips = () => {
    const box = element<HTMLElement>(root, '[data-enikk-exclude-chips]');
    box.replaceChildren();
    for (const name of enikkExcluded) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'enikk-exclude-chip';
      chip.dataset.enikkExcludeChip = name;
      chip.title = `解除排除 ${resolveDisplayName(name)}`;
      chip.append(createText('span', name));
      chip.append(createText('b', '✕'));
      chip.addEventListener('click', () => {
        enikkExcluded = enikkExcluded.filter((n) => n !== name);
        saveExcluded();
        renderExcludeChips();
        if (enikkData) renderEnikk(enikkData);
      });
      box.append(chip);
    }
  };

  const addExcluded = () => {
    const input = element<HTMLInputElement>(root, '[data-enikk-exclude-input]');
    const name = input.value.trim();
    if (!name) return;
    if (!catalogByName.has(name)) {
      setEnikkStatus(`「${name}」不在清單裡。`);
      return;
    }
    if (!enikkExcluded.includes(name)) {
      enikkExcluded.push(name);
      enikkExcluded.sort((a, b) => a.localeCompare(b, 'ko'));
      saveExcluded();
      renderExcludeChips();
      if (enikkData) renderEnikk(enikkData);
    }
    input.value = '';
  };

  // 이름 자동완성 — 오타로 «목록에 없는 이름»을 만나는 일을 줄인다.
  {
    const options = element<HTMLElement>(root, '[data-enikk-exclude-options]');
    for (const meta of catalog) {
      const option = document.createElement('option');
      option.value = meta.name;
      options.append(option);
    }
    renderExcludeChips();
  }

  element<HTMLButtonElement>(root, '[data-enikk-exclude-add]').addEventListener('click', addExcluded);
  element<HTMLInputElement>(root, '[data-enikk-exclude-input]').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); addExcluded(); }
  });

  const renderEnikk = (data: EnikkImport) => {
    enikkData = data;
    enikkPage = 0;
    const weakness = WEAKNESS_KO[data.season.weakness] ?? data.season.weakness;
    enikkSummary.hidden = false;
    enikkSummary.replaceChildren();
    enikkSummary.append(createText('strong', `賽季 ${data.season.raid} · ${data.season.boss}`));
    enikkSummary.append(createText('span',
      `弱點 ${weakness} · 玩家 ${data.players.length} 名 · 隊伍 ${data.decks.toLocaleString('ko-KR')} 套`));
    if (data.unknownNames.length > 0) {
      enikkSummary.append(createText('span',
        `含有計算機不認識的妮姬 ${data.unknownNames.length} 種的隊伍無法匯入 — ${data.unknownNames.slice(0, 5).join(', ')}`,
        'enikk-note'));
    }

    enikkList.hidden = false;
    enikkList.replaceChildren();
    const head = document.createElement('div');
    head.className = 'enikk-list-head';
    head.append(createText('h3', `玩家 ${data.players.length} 名 · 依總傷害排序`));
    const compareBtn = document.createElement('button');
    compareBtn.type = 'button';
    compareBtn.className = 'roster-import';
    compareBtn.textContent = `製作前 ${COMPARE_TOP} 名對照表`;
    compareBtn.title = '把前 10 名的隊伍用我們的計算機跑,和 enikk 實測並排 — 50 套隊伍,要幾分鐘';
    compareBtn.addEventListener('click', () => {
      compareBtn.disabled = true;
      void renderCompare().finally(() => { compareBtn.disabled = false; });
    });
    head.append(compareBtn);
    enikkList.append(head);

    const pagerTop = document.createElement('div');
    pagerTop.className = 'enikk-pager';
    const cards = document.createElement('div');
    const pagerBottom = document.createElement('div');
    pagerBottom.className = 'enikk-pager';
    enikkList.append(pagerTop, cards, pagerBottom);

    const pages = Math.max(1, Math.ceil(data.players.length / ENIKK_PER_PAGE));
    if (enikkPage >= pages) enikkPage = 0;

    const drawCards = () => {
      cards.replaceChildren();
      const from = enikkPage * ENIKK_PER_PAGE;
      for (const [offset, player] of data.players.slice(from, from + ENIKK_PER_PAGE).entries()) {
        const index = from + offset;
      const card = document.createElement('article');
      card.className = 'enikk-player';

      const top = document.createElement('div');
      top.className = 'enikk-player-head';
      top.append(createText('span', `${index + 1}`, 'enikk-rank'));
      top.append(createText('b', player.server, 'enikk-server'));
      top.append(createText('span', `總 ${formatEok(player.damage)}`, 'enikk-total'));
      const take = document.createElement('button');
      take.type = 'button';
      take.className = 'enikk-use';
      const usable = player.decks.filter(enikkDeckUsable).length;
      take.textContent = `匯入 ${usable} 隊`;
      take.disabled = usable === 0;
      take.title = usable < player.decks.length
        ? '會略過含計算機不支援或被排除妮姬的隊伍再匯入'
        : '把這個人的隊伍原樣鋪到我們的 5 隊';
      take.addEventListener('click', () => applyPlayerToDecks(player));
      top.append(take);
      card.append(top);

      for (const [n, deck] of player.decks.entries()) {
        const row = document.createElement('div');
        const blocked = !enikkDeckUsable(deck);
        row.className = 'enikk-deck' + (blocked ? ' is-blocked' : '');
        if (blocked && deck.usable) {
          row.title = `含有被排除的妮姬 — ${deck.squad.filter((n) => enikkExcluded.includes(n)).map(resolveDisplayName).join(', ')}`;
        }
        row.append(createText('span', `${n + 1}`, 'enikk-deckno'));
        row.append(enikkPortraits(deck.squad));
        row.append(createText('span', formatEok(deck.damage), 'enikk-deckdmg'));
        card.append(row);
      }
      cards.append(card);
      }
    };

    /** 페이지 이동 줄. 위·아래 양쪽에 둔다 — 열 명을 훑고 나면 아래가 가깝다. */
    const drawPager = (box: HTMLElement) => {
      box.replaceChildren();
      const jump = (page: number) => {
        enikkPage = Math.max(0, Math.min(pages - 1, page));
        drawCards();
        drawPager(pagerTop);
        drawPager(pagerBottom);
        scrollTo(enikkList);
      };
      const step = (label: string, page: number, disabled: boolean) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'enikk-page-step';
        b.textContent = label;
        b.disabled = disabled;
        b.addEventListener('click', () => jump(page));
        box.append(b);
      };
      step('‹ 上一頁', enikkPage - 1, enikkPage === 0);

      // 번호는 현재 쪽 둘레만 편다. 서른 개를 다 늘어놓으면 폰에서 줄이 넘친다.
      const window_ = new Set<number>([0, pages - 1]);
      for (let i = enikkPage - 1; i <= enikkPage + 1; i += 1) {
        if (i >= 0 && i < pages) window_.add(i);
      }
      let previous = -1;
      for (const page of [...window_].sort((a, b) => a - b)) {
        if (previous >= 0 && page - previous > 1) box.append(createText('span', '…', 'enikk-page-gap'));
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'enikk-page' + (page === enikkPage ? ' is-on' : '');
        b.textContent = String(page + 1);
        b.setAttribute('aria-current', page === enikkPage ? 'page' : 'false');
        b.addEventListener('click', () => jump(page));
        box.append(b);
        previous = page;
      }
      step('下一頁 ›', enikkPage + 1, enikkPage === pages - 1);
      box.append(createText('span', `第 ${enikkPage + 1} 頁,共 ${pages} 頁`, 'enikk-page-info'));
    };

    drawCards();
    drawPager(pagerTop);
    drawPager(pagerBottom);
  };

  const setEnikkStatus = (message: string) => { enikkStatus.textContent = message; };

  // ── 상위 10 대조판 ──────────────────────────────────────────────────────
  // 실사용 조합을 우리 시뮬로 돌려 enikk 실측 평균과 나란히 놓는다. 계산기가 어느
  // 조합에서 얼마나 어긋나는지가 표본 열 개로 한눈에 보인다.
  //
  // **같은 잣대가 아니다.** enikk 평균은 사람마다 다른 육성·조작이 섞인 값이고 우리
  // 시뮬은 지금 화면의 전투 조건과 스펙으로 돈다. 배율은 «얼마나 다른가»를 보는
  // 눈금이지 정답과의 오차가 아니다 — 그 사실을 표에 적어 둔다.
  const COMPARE_TOP = 10;

  const renderCompare = async () => {
    if (!enikkData) return;
    const targets = enikkData.players.slice(0, COMPARE_TOP);
    if (targets.length === 0) return;
    const total = targets.reduce((sum, p) => sum + p.decks.filter((d) => d.usable).length, 0);

    enikkCompare.hidden = false;
    enikkCompare.replaceChildren();
    enikkCompare.append(createText('h3', `前 ${targets.length} 名對照表`));
    enikkCompare.append(createText('p',
      `把 ${total} 套隊伍以目前戰鬥條件與我的規格計算,和那個人的實際傷害並排。`
      + '因為是規格不同者的紀錄,倍率是看「差多少」的刻度。'
      + '相同編成會重用已儲存的結果,所以越後面越快。',
      'enikk-note'));

    const table = document.createElement('div');
    table.className = 'enikk-table';
    enikkCompare.append(table);

    const battle = readBattle();
    const custom = customPayload();
    await prepared;
    let done = 0;
    for (const [index, player] of targets.entries()) {
      let simTotal = 0;
      let realTotal = 0;
      for (const source of player.decks) {
        if (!enikkDeckUsable(source)) continue;
        done += 1;
        setEnikkStatus(`對照計算中 · 隊 ${done}/${total}`);
        const deck: DeckState = { id: 1, squad: [...source.squad], characters: {} };
        for (const name of source.squad) {
          if (roster[name]) deck.characters[name] = cloneOverride(roster[name]!);
        }
        const request = requestForDeck(deck, battle, Object.keys(custom).length > 0 ? custom : undefined);
        const key = cacheKey(request, version);
        let result = cache.get(key);
        if (!result) {
          result = await client.simulate(request);
          cache.set(key, result);
        }
        simTotal += result.squadTotal;
        realTotal += source.damage;
      }
      const ratio = realTotal > 0 ? simTotal / realTotal : 0;

      const row = document.createElement('div');
      row.className = 'enikk-trow';
      row.append(createText('span', `${index + 1}`, 'enikk-rank'));
      const who = document.createElement('div');
      who.className = 'enikk-who';
      who.append(createText('b', player.server, 'enikk-server'));
      who.append(createText('span', `${player.decks.filter((d) => d.usable).length} 隊`));
      row.append(who);
      const nums = document.createElement('div');
      nums.className = 'enikk-nums';
      nums.append(createText('span', `實際 ${formatEok(realTotal)}`));
      nums.append(createText('span', `模擬 ${formatEok(simTotal)}`, 'enikk-sim'));
      if (ratio > 0) {
        const tag = createText('b', `${ratio.toFixed(2)} 倍`, 'enikk-ratio');
        tag.classList.add(ratio > 1.15 || ratio < 0.85 ? 'is-off' : 'is-near');
        nums.append(tag);
      }
      row.append(nums);
      table.append(row);
    }
    setEnikkStatus(`前 ${targets.length} 名對照完成。`);
  };

  const loadEnikk = async (force: boolean) => {
    if (!force) {
      const cached = readEnikkCache();
      if (cached) {
        renderEnikk(cached);
        setEnikkStatus('這是已儲存的結果。要重新取得請按「重新取得」。');
        enikkLoad.hidden = true;
        enikkRefresh.hidden = false;
        return;
      }
    }
    enikkLoad.disabled = true;
    enikkRefresh.disabled = true;
    try {
      const supported = new Set(catalog.map((char) => char.name));
      const data = await loadEnikkComps(catalog, supported, setEnikkStatus);
      writeEnikkCache(data);
      renderEnikk(data);
      setEnikkStatus(`已讀取玩家 ${data.players.length} 名 · 隊伍 ${data.decks} 套。`);
      enikkLoad.hidden = true;
      enikkRefresh.hidden = false;
    } catch (error) {
      setEnikkStatus(error instanceof Error ? error.message : String(error));
    } finally {
      enikkLoad.disabled = false;
      enikkRefresh.disabled = false;
    }
  };

  enikkLoad.addEventListener('click', () => { void loadEnikk(false); });
  enikkRefresh.addEventListener('click', () => { void loadEnikk(true); });

  // ── 지금 보는 사람 수 ───────────────────────────────────────────────────
  // 공유 서버가 세 준다. 주소가 없으면 아예 띄우지 않는다 — 0명이라고 적어 두면
  // «아무도 없다»로 읽히는데 사실은 «셀 곳이 없다»이기 때문이다.
  if (SHARE_API) {
    const onlineBox = element<HTMLElement>(root, '[data-online]');
    const onlineText = element<HTMLElement>(root, '[data-online-text]');
    startPresence(SHARE_API, (online) => {
      onlineText.textContent = `目前 ${online.toLocaleString('ko-KR')} 名`;
      onlineBox.hidden = false;
    });
  }

  // ── 병렬 계산 ───────────────────────────────────────────────────────────
  // 계산은 이 기기에서 돈다. 워커를 여럿 띄우면 덱을 나눠 돌려 빨라지지만, 워커마다
  // 계산 런타임이 하나씩 떠서 메모리를 먹는다 — 그래서 끌 수 있고 개수도 고를 수 있다.
  // 결과는 몇 개로 나누든 같다(판마다 독립·결정론적).
  const PARALLEL_KEY = 'nikke-parallel-v1';
  const parallelToggle = element<HTMLInputElement>(root, '[data-parallel-toggle]');
  const parallelSize = element<HTMLSelectElement>(root, '[data-parallel-size]');
  const poolDefault = client.defaultPoolSize ? client.defaultPoolSize() : 1;
  const poolMax = client.maxPoolSize ?? 1;
  let parallelOn = true;
  let parallelCount = poolDefault;
  try {
    const saved = JSON.parse(resolveStorage()?.getItem(PARALLEL_KEY) ?? 'null') as
      { on?: boolean; count?: number } | null;
    if (saved) {
      if (typeof saved.on === 'boolean') parallelOn = saved.on;
      if (typeof saved.count === 'number') parallelCount = saved.count;
    }
  } catch { /* 저장된 값이 깨졌으면 기본값으로 간다 */ }
  parallelCount = Math.max(1, Math.min(poolMax, Math.trunc(parallelCount) || 1));

  for (let n = 1; n <= poolMax; n += 1) {
    const option = document.createElement('option');
    option.value = String(n);
    option.textContent = `${n} 個`;
    parallelSize.append(option);
  }
  // 권장값은 칸을 넓히지 않게 설명 쪽에만 적는다 — 토글 줄이 길어지면 줄이 접힌다.
  parallelSize.title = `要開的工作執行緒數。這台裝置建議 ${poolDefault} 個。`
    + '每一個都會開一份計算執行環境,各吃 50~80MB 記憶體。';
  const applyParallel = (save: boolean) => {
    parallelToggle.checked = parallelOn;
    parallelSize.value = String(parallelCount);
    parallelSize.disabled = !parallelOn;
    client.setPoolSize?.(parallelOn ? parallelCount : 1);
    if (!save) return;
    try {
      resolveStorage()?.setItem(PARALLEL_KEY, JSON.stringify({ on: parallelOn, count: parallelCount }));
    } catch { /* 저장 실패는 무시한다 — 이번 판만 못 기억할 뿐이다 */ }
  };
  parallelToggle.addEventListener('change', () => {
    parallelOn = parallelToggle.checked;
    applyParallel(true);
  });
  parallelSize.addEventListener('change', () => {
    parallelCount = Number(parallelSize.value) || 1;
    applyParallel(true);
  });
  applyParallel(false);

  // ── 유니온 레이드 (BETA) ────────────────────────────────────────────────
  // 프록시는 «유니온원 스펙 받아 오기»에만 필요하다. 없으면 그 두 단계(명단·공개여부)만
  // 접고 «개인용»은 그대로 쓴다 — 보스마다 다른 전투 조건으로 덱 셋을 견주는 자리는
  // 남의 계정과 아무 상관이 없기 때문이다. 예전에는 탭 자체를 안 그려 통째로 사라졌다.
  const unionPanel = root.querySelector<HTMLElement>('[data-view="union"]');
  if (unionPanel) {
    unionHandle = mountUnionRaid({ panel: unionPanel }, {
      proxy: blablaProxy,
      shareServer,
      settings,
      catalog: [...catalogByName.values()],
      simulate: (request) => client.simulate(request),
      imageOf: (name) => {
        const image = catalogByName.get(name)?.image;
        return image ? `${import.meta.env.BASE_URL}${image}` : undefined;
      },
      labelOf: resolveDisplayName,
      currentBattleCode: () => encodeBattleCode(readBattle(), settings.normalHitCoeff),
      currentDeckCode: (index) => {
        const deck = decks[index];
        return deck ? encodeShareCode([deck], false) : '';
      },
      catalogNames: () => [...catalogByName.keys()],
      concurrency: () => (parallelOn ? parallelCount : 1),
      me: () => {
        const battle = readBattle();
        return {
          name: '我的設定',
          synchro: battle.synchroLevel,
          console: battle.console,
          // 가져온 로스터(CSV·블라블라링크)가 내 스펙이다. 없으면 기본 스펙으로 돈다.
          roster: Object.fromEntries(Object.entries(roster)
            .filter(([name]) => catalogByName.has(name))),
          owned: Object.keys(roster).length,
        };
      },
    });
  }

  // ── 화면 전환 ───────────────────────────────────────────────────────────
  // 유니온 탭이 없는 배포(프록시 미설정)에서는 손잡이도 없다.
  /** 위쪽 탭이 고를 수 있는 화면. 「외부고리」는 우리 것이 아닌 곳으로 나가는 판이다. */
  type ViewName = 'calc' | 'union' | 'enikk' | 'links';

  function switchView(view: ViewName) {
    currentView = view;
    // 개인용은 계산기에 잡아 둔 내 스펙으로 돈다 — 탭에 들어올 때 다시 읽는다.
    // 모드를 켤 때 한 번만 읽으면, 그 뒤 전투 조건에서 싱크로를 바꿔도 옛 값으로 돈다.
    if (view === 'union') unionHandle?.refreshMe();
    for (const section of root.querySelectorAll<HTMLElement>('[data-view]')) {
      const mine = section.dataset.view === view;
      // 타임라인은 계산 결과가 있을 때만 보이므로 여기서 켜지 않는다.
      if (section === timelinePanel) { section.hidden = !mine || !timelineHasContent; continue; }
      section.hidden = !mine;
    }
    for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-view-tab]')) {
      const on = tab.dataset.viewTab === view;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-pressed', String(on));
    }
    if (view === 'enikk' && !enikkData) {
      const cached = readEnikkCache();
      if (cached) {
        renderEnikk(cached);
        setEnikkStatus('這是先前儲存的結果。想重新取得請按《重新取得》。');
        enikkLoad.hidden = true;
        enikkRefresh.hidden = false;
      }
    }
  }
  for (const tab of root.querySelectorAll<HTMLButtonElement>('[data-view-tab]')) {
    tab.addEventListener('click', () => switchView(tab.dataset.viewTab as ViewName));
  }

  // ── 외부고리 ────────────────────────────────────────────────────────────
  // 표(`external-links.ts`)를 그대로 편다. 주소를 HTML에 박지 않는 이유는 고칠 곳을
  // 한 군데로 두기 위해서다 — 새 고리는 그 배열에 한 줄만 더하면 여기 나온다.
  const linksGrid = element<HTMLElement>(root, '[data-links-grid]');
  for (const link of EXTERNAL_LINKS) {
    const card = document.createElement('a');
    card.className = 'link-card';
    card.href = link.url;
    card.target = '_blank';
    // 남의 페이지에 우리 창을 넘기지 않는다.
    card.rel = 'noopener noreferrer';

    const head = document.createElement('div');
    head.className = 'link-head';
    const name = document.createElement('h3');
    name.className = 'link-name';
    name.textContent = link.label;
    const host = document.createElement('span');
    host.className = 'link-host';
    host.textContent = hostOf(link.url);
    head.append(name, host);

    const note = document.createElement('p');
    note.className = 'link-note';
    note.textContent = link.note;

    const go = document.createElement('span');
    go.className = 'link-go';
    go.setAttribute('aria-hidden', 'true');
    go.textContent = '在新分頁開啟 ↗';

    card.append(head, note, go);
    linksGrid.append(card);
  }

  // 렛츠도로 CSV 받는 법 안내. 스크린샷이 아직 없으면 이미지만 숨긴다 — 링크·설명은 남는다.
  const doroModal = element<HTMLElement>(root, '[data-doro-modal]');
  const doroShot = element<HTMLImageElement>(root, '.doro-shot');
  doroShot.addEventListener('error', () => { doroShot.hidden = true; });
  element<HTMLButtonElement>(root, '[data-doro-open]').addEventListener('click', () => {
    doroModal.hidden = false;
  });
  element<HTMLButtonElement>(root, '[data-doro-close]').addEventListener('click', () => {
    doroModal.hidden = true;
  });
  doroModal.addEventListener('click', (event) => {
    if (event.target === doroModal) doroModal.hidden = true;
  });

  const customModal = element<HTMLElement>(root, '[data-custom-modal]');
  const customJson = element<HTMLTextAreaElement>(root, '[data-custom-json]');
  const customMsg = element<HTMLElement>(root, '[data-custom-msg]');
  const customList = element<HTMLElement>(root, '[data-custom-list]');
  const showCustomMsg = (text: string, ok = false) => {
    customMsg.textContent = text;
    customMsg.hidden = !text;
    customMsg.classList.toggle('is-ok', ok);
  };
  const renderCustomList = () => {
    customList.replaceChildren();
    const names = Object.keys(customChars);
    if (names.length === 0) return;
    customList.append(createText('p', '已新增的妮姬', 'custom-list-title'));
    for (const name of names) {
      const meta = customToMeta(customChars[name]!);
      const row = document.createElement('div');
      row.className = 'custom-list-row';
      row.append(createText('span', `${name} · B${meta.burstStage} · ${termZh(meta.elementCode)} · ${meta.weaponType}`, 'custom-list-name'));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'custom-remove';
      remove.textContent = '刪除';
      remove.addEventListener('click', () => {
        delete customChars[name];
        saveCustom();
        const index = catalog.findIndex((char) => char.name === name);
        if (index >= 0) catalog.splice(index, 1);
        catalogByName.delete(name);
        delete settings.characters[name];
        for (const deck of decks) {
          deck.squad = deck.squad.map((member) => (member === name ? '' : member));
          delete deck.characters[name];
        }
        saveState();
        renderCustomList();
        renderDeckTabs();
        renderSquad();
      });
      row.append(remove);
      customList.append(row);
    }
  };
  element<HTMLButtonElement>(root, '[data-add-nikke]').addEventListener('click', () => {
    customModal.hidden = false;
    showCustomMsg('');
    renderCustomList();
  });
  element<HTMLButtonElement>(root, '[data-custom-close]').addEventListener('click', () => {
    customModal.hidden = true;
  });
  customModal.addEventListener('click', (event) => {
    if (event.target === customModal) customModal.hidden = true;
  });
  element<HTMLButtonElement>(root, '[data-copy-prompt]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildAddPrompt());
      showCustomMsg('已複製提示詞。貼到別的 LLM,再接上妮姬說明。', true);
    } catch {
      showCustomMsg('自動複製失敗。請確認瀏覽器權限或自行複製。');
    }
  });
  element<HTMLButtonElement>(root, '[data-custom-submit]').addEventListener('click', () => {
    try {
      const custom = parseCustomInput(customJson.value);
      customChars[custom.name] = custom;
      saveCustom();
      registerCustom(custom.name);
      renderCustomList();
      renderDeckTabs();
      renderSquad();
      customJson.value = '';
      const ignored = unsupportedEffects(custom.skills);
      if (ignored.length > 0) {
        showCustomMsg(
          `已新增「${custom.name}」。但有無法辨識的效果不會反映:`
          + `${ignored.join(', ')}。若這些效果是角色的主力輸出,結果會比實際低很多`
          + `(量表・模式切換・條件堆疊型技能難以用這種方式重現)。`
          + `對照說明的詞彙修改 stat・timing・target,部分可被反映。`,
        );
      } else {
        showCustomMsg(`已新增「${custom.name}」· 可在隊伍格選擇。`, true);
      }
    } catch (error) {
      showCustomMsg(error instanceof Error ? error.message : String(error));
    }
  });

  saveState = () => {
    try {
      resolveStorage()?.setItem(STATE_KEY, JSON.stringify({
        decks, fiveDeckMode, activeDeckId, carryOverSettings, battle: readBattle(),
        // 새로고침해도 「누가 이 버프를 받았나」가 남게 한다 — 다시 계산하기 전까지
        // 빈 괄호만 보이면 기능이 꺼진 것처럼 보인다.
        buffTargets: [...buffTargetsByDeck].map(([id, v]) => ({ id, ...v })),
      }));
    } catch {
      /* 저장 실패 무시 */
    }
  };
  const applySavedState = () => {
    if (!savedState) return;
    if (typeof savedState.carryOverSettings === 'boolean') {
      carryOverSettings = savedState.carryOverSettings;
      carryToggle.checked = carryOverSettings;
    }
    if (Array.isArray(savedState.decks)) {
      savedState.decks.forEach((saved, index) => {
        const deck = decks[index];
        if (!deck || !saved) return;
        // 덱에 붙인 이름도 되살린다 — 새로고침에 이름이 날아가면 붙일 이유가 없다.
        if (typeof saved.name === 'string' && saved.name.trim()) deck.name = saved.name.trim();
        else delete deck.name;
        deck.squad = (saved.squad ?? ['', '', '', '', ''])
          .map((name) => (name && catalogByName.has(name) ? name : ''));
        deck.characters = {};
        for (const [name, override] of Object.entries(saved.characters ?? {})) {
          if (deck.squad.includes(name)) deck.characters[name] = override;
        }
      });
    }
    // 「누가 이 버프를 받았나」는 서명이 지금 편성·설정과 맞을 때만 되살린다.
    // 어긋나면 지난 계산의 값이라 그대로 믿을 수 없다.
    for (const saved of savedState.buffTargets ?? []) {
      const deck = decks.find((d) => d.id === saved.id);
      if (deck && saved.sig === deckSignature(deck)) {
        buffTargetsByDeck.set(saved.id, { sig: saved.sig, rows: saved.rows });
      }
    }

    const savedActive = savedState.activeDeckId;
    if (typeof savedActive === 'number' && savedActive >= 1 && savedActive <= 5) {
      activeDeckId = savedActive;
    }
    if (savedState.fiveDeckMode) {
      fiveDeckMode = true;
      element<HTMLInputElement>(root, '#squad-mode').checked = true;
      deckTabs.hidden = false;
      deckMoves.hidden = false;
      clearAllButton.hidden = false;
      deckNote.hidden = false;
      deckCopy.hidden = false;
    }
    if (savedState.battle) writeBattle(savedState.battle);
  };

  for (const name of Object.keys(customChars)) registerCustom(name);
  applySavedState();
  applyRosterToDecks();
  updateRosterNote();
  renderDeckTabs();
  renderSquad();
  // 판은 창이 아니라 늘 펼쳐져 있으므로 처음부터 그려 둔다.
  const firstEmpty = activeDeck().squad.findIndex((member) => !member);
  activeSlot = firstEmpty < 0 ? 0 : firstEmpty;
  renderSquad();
  renderRosterGrid();

  // 공유 링크로 들어왔으면 저장 상태 위에 그 편성을 얹는다 — 순서가 반대면
  // applySavedState가 링크로 넣은 편성을 도로 덮어쓴다. 주소는 정리해 두어
  // 새로고침할 때마다 다시 덮어쓰지 않게 한다.
  if (location.hash.startsWith('#deck=')) {
    const linked = location.hash;
    history.replaceState(null, '', location.pathname + location.search);
    applyShareText(linked, 'all');
    refreshShareFields();
    renderPresets();
    shareIn.value = linked;
    shareModal.hidden = false;
  }

  const prepared = client.prepare()
    .then(() => {
      if (activity !== 'preparing') return;
      activity = 'ready';
      status.textContent = '計算準備完成 · 所有運算在這台裝置上執行。';
    })
    .catch((error: unknown) => {
      if (activity !== 'preparing') return;
      activity = 'error';
      status.textContent = `初始化失敗 · ${error instanceof Error ? error.message : String(error)}`;
    });

  // 기본 정렬이 전투력이라 목록을 열기 전에 미리 받아 둔다. 오는 동안은 이름순으로
  // 서 있고, 도착하면 그 자리에서 다시 세운다.
  void loadCombatPower();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const battle = readBattle();
    const selectedDecks = (fiveDeckMode ? decks : [decks[0]!])
      .filter((deck) => deck.squad.some((name) => name.trim()));
    const validation = [
      ...validateDecks(selectedDecks),
      ...selectedDecks.flatMap((deck) => validateCharacterValues(deck)),
    ];
    const custom = customPayload();
    const requests = selectedDecks.map((deck) => ({
      deck,
      request: requestForDeck(deck, battle, Object.keys(custom).length > 0 ? custom : undefined),
    }));
    for (const { deck, request } of requests) {
      validation.push(...validateRequest(request).map((message) => `隊 ${deck.id}:${message}`));
    }
    showErrors([...new Set(validation)]);
    if (validation.length > 0) return;

    submit.disabled = true;
    submit.classList.add('is-running');
    activity = 'running';
    const completed: DeckResultEntry[] = [];
    let cachedCount = 0;
    let failedIndex = -1;
    try {
      await prepared;
      // 덱 하나하나는 서로 독립이라 나눠 돌려도 결과가 같다. 도착 순서만 뒤섞이므로
      // 화면에 세울 때 **덱 번호 순으로 다시 정렬**한다 — 좌→우가 곧 1→5덱이어야 한다.
      let done = 0;
      const runOne = async (index: number) => {
        const { deck, request } = requests[index]!;
        const key = cacheKey(request, version);
        let result = cache.get(key);
        if (result) {
          cachedCount += 1;
        } else {
          result = await client.simulate(request);
          cache.set(key, result);
        }
        done += 1;
        status.textContent = `計算中 · ${done}/${requests.length} 隊`;
        completed.push({ deckId: deck.id, request, result });
        completed.sort((a, b) => a.deckId - b.deckId);
        renderBatchResult(aggregateDeckResults(completed));
      };
      // 병렬을 꺼 뒀으면 한 판씩. 켜져 있으면 풀이 알아서 워커에 나눠 준다.
      const guarded = async (index: number) => {
        try {
          await runOne(index);
        } catch (error) {
          // 어느 덱이 깨졌는지 아래 catch가 알아야 한다 — 병렬에서는 «몇 개 끝났나»로
          // 짚을 수 없다(끝난 순서와 덱 번호가 다르다).
          if (failedIndex < 0) failedIndex = index;
          throw error;
        }
      };
      if (parallelOn && requests.length > 1) {
        const settled = await Promise.allSettled(requests.map((_, index) => guarded(index)));
        const broke = settled.find((outcome) => outcome.status === 'rejected');
        if (broke && broke.status === 'rejected') throw broke.reason;
      } else {
        for (let index = 0; index < requests.length; index += 1) await guarded(index);
      }
      activity = cachedCount === requests.length ? 'cached' : 'complete';
      status.textContent = cachedCount === requests.length
        ? '已載入儲存的結果。'
        : `${requests.length} 個隊伍計算完成 · 相同條件會存在這台裝置上。`;
    } catch (error) {
      if (completed.length > 0) renderBatchResult(aggregateDeckResults(completed));
      const failedEntry = requests[failedIndex >= 0 ? failedIndex : completed.length];
      const failed = failedEntry?.deck.id;
      const detail = cleanEngineError(error instanceof Error ? error.message : String(error));
      const messages = [`隊 ${failed ?? '?'} 計算失敗:${detail}`];
      const hasBurstOverride = failedEntry
        ? Object.values(failedEntry.deck.characters).some((custom) => custom.burst)
        : false;
      if (hasBurstOverride) {
        messages.push('這個組合可能不支援指定爆裂運用。請把該角色的爆裂運用改回《自動》後再執行一次。');
      }
      showErrors(messages);
      activity = 'error';
      status.textContent = '計算失敗。請確認輸入值後再執行一次。';
    } finally {
      submit.disabled = false;
      submit.classList.remove('is-running');
    }
  });

  return () => client.dispose();
}
