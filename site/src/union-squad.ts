/**
 * 聯盟分頁專用的視覺化排隊器 —— 五格 + 角色格柵。
 *
 * ## 為什麼另寫一個，而不是共用計算機那個
 *
 * 計算機的 `renderSquad` 有 248 行，牽連 15 個閉包（`renderEditor`、
 * `renderCharacterSettings`、`openCharPanel`、`saveState`…），每個又各自往下牽。
 * 把它抽成共用元件等於對整個 app 的核心動手術。
 *
 * 而聯盟其實不需要那些：**這裡的隊伍只要五個名字**。等級、裝備、超載、魔方、收藏品
 * 全部來自各成員自己的匯出檔，不是隊伍的屬性 —— 在這裡放養成編輯器反而是錯的
 * （會讓人以為改了有用）。這也是既有設計用 `NK2-` 代碼的原因：那個代碼裡只有名字。
 *
 * 所以這支只做「挑名字」，一行都不碰 `ui.ts`。樣式沿用計算機那邊既有的
 * `.roster-*` 類別，兩處看起來才像同一個東西。
 *
 * ## 操作（戰術）是例外
 *
 * 點射・換彈・掩體・蓄力保持和爆裂順序**是隊伍層級的打法**，不是個人養成 ——
 * 同一套隊誰來打都是那樣打。所以那些留在這裡，跟著隊伍走，套用到每一個成員。
 * 詳見 `union-tactics.ts`。
 */

import { filterByQuery, buildIndex } from './nikke-search';
import { createElementIcon, termZh } from './i18n-terms';
import type { CharacterMeta } from './types';

export const SQUAD_SIZE = 5;

export interface UnionSquadDeps {
  catalog: CharacterMeta[];
  /** 정본 이름 → 화면에 적을 이름. */
  labelOf: (name: string) => string;
  /** 초상화 주소. 없으면 빈 칸으로 둔다. */
  imageOf: (name: string) => string | undefined;
  /**
   * 겨눈 칸이 바뀌었으니 슬롯을 다시 그려 달라는 신호.
   * «지금 고르는 중»인 칸에 테두리를 주려면 호출부가 다시 그려야 한다.
   */
  onRedraw: () => void;
}

/** 어느 칸을 겨누고 있는가. 판이 하나뿐이라 «어디를 채우는지»를 이걸로 기억한다. */
interface Aim {
  key: string;
  index: number;
  squad: string[];
  commit: (squad: string[]) => void;
  /** 판을 붙일 자리. 그 덱 줄 바로 아래에 뜬다. */
  anchor: HTMLElement;
}

type FilterKey = 'code' | 'class' | 'burst';

const FILTERS: Array<[FilterKey, string, (char: CharacterMeta) => string]> = [
  ['code', '屬性', (char) => char.elementCode],
  ['class', '職業', (char) => char.className],
  ['burst', '爆裂', (char) => char.burstStage],
];

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * 판 하나를 여럿이 나눠 쓴다.
 *
 * 덱 줄이 열다섯이나 되므로(보스 5 × 덱 3) 줄마다 격자를 그리면 니케 200명 × 15벌이
 * 한 화면에 깔린다. 판은 하나만 두고 **겨눈 줄 아래로 옮겨 다닌다** — 인게임 편성 화면과
 * 같은 모양이고, dildoro도 그렇게 생겼다.
 */
export class UnionSquadPicker {
  private readonly panel: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly chipBox: HTMLElement;
  private readonly picked: Record<FilterKey, Set<string>> =
    { code: new Set(), class: new Set(), burst: new Set() };
  private aim: Aim | null = null;

  constructor(private readonly deps: UnionSquadDeps) {
    this.panel = el('div', 'union-picker');
    this.panel.hidden = true;

    const head = el('div', 'union-picker-head');
    const title = el('strong', 'union-picker-title', '選擇妮姬');
    const close = el('button', 'union-picker-close', '✕');
    (close as HTMLButtonElement).type = 'button';
    close.title = '關閉 (Esc)';
    close.addEventListener('click', () => this.close());
    this.count = el('span', 'union-picker-count');
    head.append(title, this.count, close);

    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.className = 'roster-search';
    this.search.placeholder = '搜尋妮姬(名稱・屬性;也支援韓文/別名)';
    this.search.addEventListener('input', () => this.renderGrid());

    this.chipBox = el('div', 'union-picker-filters');
    this.buildChips();

    this.grid = el('div', 'roster-grid');
    this.panel.append(head, this.search, this.chipBox, this.grid);

    // Esc로 닫는다. 판이 열려 있을 때만 가로챈다 — 닫혀 있는데 Esc를 먹으면
    // 바깥의 다른 창이 안 닫힌다.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.panel.hidden) {
        event.stopPropagation();
        this.close();
      }
    }, true);
  }

  private buildChips(): void {
    for (const [key, label, valueOf] of FILTERS) {
      const values = [...new Set(this.deps.catalog.map(valueOf))].filter(Boolean).sort();
      if (values.length === 0) continue;
      const row = el('div', 'union-picker-filter');
      row.append(el('span', 'union-picker-filter-label', label));
      for (const value of values) {
        const chip = el('button', 'union-chip', key === 'burst' ? `B${value}` : termZh(value));
        (chip as HTMLButtonElement).type = 'button';
        chip.addEventListener('click', () => {
          const set = this.picked[key];
          if (set.has(value)) set.delete(value); else set.add(value);
          chip.classList.toggle('is-on', set.has(value));
          this.renderGrid();
        });
        row.append(chip);
      }
      this.chipBox.append(row);
    }
  }

  /** 겨눈 칸이 이 줄인가. 슬롯이 «지금 고르는 중»인지 표시하는 데 쓴다. */
  private aiming(key: string, index: number): boolean {
    return !this.panel.hidden && this.aim?.key === key && this.aim.index === index;
  }

  close(): void {
    this.panel.hidden = true;
    this.aim = null;
    this.panel.remove();
  }

  /**
   * 판을 연다. **여기서 DOM에 붙이지 않는다** — 여는 즉시 호출부가 전체를 다시 그리므로
   * (겨눈 칸에 테두리를 주려면 그래야 한다) 여기서 붙여 봐야 그 줄과 함께 뜯긴다.
   * 붙이는 일은 `renderSlots`가 «이 줄이 겨눈 줄이면» 하고 맡는다.
   */
  private open(aim: Aim): void {
    this.aim = aim;
    this.panel.hidden = false;
  }

  private renderGrid(): void {
    const aim = this.aim;
    if (!aim) return;
    const all = [...this.deps.catalog].sort((a, b) =>
      this.deps.labelOf(a.name).localeCompare(this.deps.labelOf(b.name), 'zh-Hant'));
    const narrowed = all.filter((char) => FILTERS.every(([key, , valueOf]) =>
      this.picked[key].size === 0 || this.picked[key].has(valueOf(char))));
    const shown = filterByQuery(narrowed, this.search.value, buildIndex);
    this.count.textContent = shown.length === all.length
      ? `${all.length} 名` : `${shown.length} / ${all.length} 名`;

    this.grid.replaceChildren();
    for (const char of shown) {
      const cell = el('button', 'roster-cell');
      (cell as HTMLButtonElement).type = 'button';
      // 이미 이 덱에 있으면 누르지 못하게 둔다 — 같은 니케를 두 칸에 넣을 수 없다.
      const takenAt = aim.squad.indexOf(char.name);
      if (takenAt >= 0 && takenAt !== aim.index) {
        (cell as HTMLButtonElement).disabled = true;
        cell.classList.add('is-taken');
        cell.title = `已在第 ${takenAt + 1} 格`;
      }

      const portrait = el('div', 'roster-portrait');
      const src = this.deps.imageOf(char.name);
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.loading = 'lazy';
        portrait.append(img);
      }
      portrait.append(el('span', 'roster-burst', `B${char.burstStage}`));
      const icon = createElementIcon(char.elementCode, 'roster-code');
      if (icon) portrait.append(icon);

      cell.append(portrait);
      cell.append(el('strong', undefined, this.deps.labelOf(char.name)));
      cell.append(el('span', undefined, `${termZh(char.className)} · ${char.weaponType}`));
      cell.addEventListener('click', () => {
        const next = [...aim.squad];
        // 다른 칸에 이미 있으면 자리를 맞바꾼다 — 지우고 다시 넣게 하면 두 번 일한다.
        const from = next.indexOf(char.name);
        if (from >= 0) next[from] = next[aim.index] ?? '';
        next[aim.index] = char.name;
        aim.commit(next);
        this.close();
      });
      this.grid.append(cell);
    }
  }

  /**
   * 덱 한 줄의 슬롯 다섯 칸을 그린다.
   *
   * `key`는 이 줄을 가리키는 이름(보스·덱 번호)이고, 어느 줄을 겨누고 있는지 기억하는 데만
   * 쓴다. `commit`은 바뀐 이름 다섯을 받는다 — 여기서 저장까지 하지는 않는다.
   */
  renderSlots(
    host: HTMLElement, key: string, squad: string[], commit: (squad: string[]) => void,
  ): void {
    host.replaceChildren();
    const filled = Array.from({ length: SQUAD_SIZE }, (_, i) => squad[i] ?? '');
    for (let index = 0; index < SQUAD_SIZE; index += 1) {
      const name = filled[index]!;
      const char = name ? this.deps.catalog.find((entry) => entry.name === name) : undefined;

      const cell = el('div', 'union-slot');
      cell.classList.toggle('is-empty', !name);
      cell.classList.toggle('is-aiming', this.aiming(key, index));

      const choose = el('button', 'union-slot-pick');
      (choose as HTMLButtonElement).type = 'button';
      choose.setAttribute('aria-pressed', String(this.aiming(key, index)));

      const portrait = el('div', 'roster-portrait');
      const src = name ? this.deps.imageOf(name) : undefined;
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.loading = 'lazy';
        portrait.append(img);
      }
      if (char) {
        portrait.append(el('span', 'roster-burst', `B${char.burstStage}`));
        const icon = createElementIcon(char.elementCode, 'roster-code');
        if (icon) portrait.append(icon);
      }
      choose.append(portrait);
      choose.append(el('strong', undefined, name ? this.deps.labelOf(name) : '空格'));
      choose.append(el('span', undefined,
        char ? `${termZh(char.className)} · ${char.weaponType}` : '點此放入'));

      choose.addEventListener('click', () => {
        // 같은 칸을 다시 누르면 접는다 — 켜고 끄는 자리가 한 곳이면 헷갈리지 않는다.
        if (this.aiming(key, index)) { this.close(); this.deps.onRedraw(); return; }
        this.open({ key, index, squad: filled, commit, anchor: host });
        this.deps.onRedraw();
      });
      cell.append(choose);

      if (name) {
        const clear = el('button', 'union-slot-clear', '✕');
        (clear as HTMLButtonElement).type = 'button';
        clear.title = `清空第 ${index + 1} 格`;
        clear.ariaLabel = `清空第 ${index + 1} 格`;
        clear.addEventListener('click', (event) => {
          event.stopPropagation();
          const next = [...filled];
          next[index] = '';
          commit(next);
        });
        cell.append(clear);
      }
      host.append(cell);
    }

    // 이 줄이 지금 겨눈 줄이면 판을 여기 다시 붙인다. 다시 그릴 때마다 옛 줄이 사라지므로
    // «붙이는 일»은 그릴 때 함께 해야 한다. 겨눈 칸의 편성도 새것으로 갈아 끼운다 —
    // 옛 배열을 들고 있으면 방금 넣은 니케가 «이미 있음»으로 안 잡힌다.
    if (!this.panel.hidden && this.aim?.key === key) {
      this.aim = { ...this.aim, squad: filled, commit, anchor: host };
      host.after(this.panel);
      this.renderGrid();
      // 판이 화면 밖에 열리면 «눌렀는데 아무 일도 안 일어났다»로 보인다.
      if (typeof this.panel.scrollIntoView === 'function') {
        this.panel.scrollIntoView({ block: 'nearest' });
      }
    }
  }
}
