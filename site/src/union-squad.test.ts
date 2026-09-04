// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnionSquadPicker } from './union-squad';
import type { CharacterMeta } from './types';

const char = (name: string, over: Partial<CharacterMeta> = {}): CharacterMeta => ({
  name, displayName: name, burstStage: '3', elementCode: '작열', weaponType: 'AR',
  className: '화력형', manufacturer: '엘리시온', preview: false, image: null,
  nameCode: null, resourceId: null, aliases: [], ...over,
});

const catalog: CharacterMeta[] = [
  char('크라운', { burstStage: '2', elementCode: '철갑', weaponType: 'MG', className: '방어형' }),
  char('리타', { burstStage: '1', elementCode: '수냉', weaponType: 'SMG', className: '지원형' }),
  char('앨리스', { burstStage: '3', elementCode: '수냉', weaponType: 'SR' }),
  char('나가', { burstStage: '2', elementCode: '전격', weaponType: 'SG', className: '방어형' }),
];

/** 덱 줄 하나를 세운다. 판은 이 줄 **바로 뒤에** 끼어들므로 부모가 있어야 한다. */
function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const row = document.createElement('div');
  root.append(row);
  const host = document.createElement('div');
  row.append(host);

  let squad: string[] = [];
  const redraw = vi.fn();
  const picker = new UnionSquadPicker({
    catalog,
    labelOf: (name) => name,
    imageOf: () => undefined,
    onRedraw: () => { redraw(); draw(); },
  });
  const draw = () => picker.renderSlots(host, 'b0-d0', squad, (next) => { squad = next; draw(); });
  draw();

  return {
    picker, host, redraw,
    get squad() { return squad; },
    slots: () => [...host.querySelectorAll<HTMLButtonElement>('.union-slot-pick')],
    panel: () => document.querySelector<HTMLElement>('.union-picker'),
    cards: () => [...(document.querySelectorAll<HTMLButtonElement>('.union-picker .roster-cell'))],
  };
}

beforeEach(() => { document.body.replaceChildren(); });

describe('슬롯', () => {
  it('언제나 다섯 칸이고 빈 칸은 빈 칸이라고 적는다', () => {
    const ui = mount();
    expect(ui.slots()).toHaveLength(5);
    expect(ui.slots()[0]!.textContent).toContain('空格');
  });

  it('이름이 들어간 칸은 버스트·클래스·무기를 함께 적는다', () => {
    const ui = mount();
    ui.slots()[0]!.click();
    ui.cards().find((card) => card.textContent?.includes('크라운'))!.click();
    const slot = ui.slots()[0]!;
    expect(slot.textContent).toContain('크라운');
    expect(slot.textContent).toContain('B2');
    expect(slot.textContent).toContain('MG');
  });

  it('✕는 그 칸만 비운다', () => {
    const ui = mount();
    ui.slots()[0]!.click();
    ui.cards().find((card) => card.textContent?.includes('크라운'))!.click();
    ui.slots()[1]!.click();
    ui.cards().find((card) => card.textContent?.includes('리타'))!.click();
    expect(ui.squad.filter(Boolean)).toEqual(['크라운', '리타']);

    ui.host.querySelectorAll<HTMLButtonElement>('.union-slot-clear')[0]!.click();
    expect(ui.squad[0]).toBe('');
    expect(ui.squad[1]).toBe('리타');
  });
});

describe('판', () => {
  it('칸을 누르면 그 줄 바로 아래에 열린다', () => {
    const ui = mount();
    expect(ui.panel()).toBeNull();
    ui.slots()[0]!.click();
    expect(ui.panel()).not.toBeNull();
    // 다른 덱 줄 아래에 열리면 «어디를 채우는지»를 읽을 수 없다.
    expect(ui.panel()!.previousElementSibling).toBe(ui.host);
    expect(ui.host.querySelectorAll('.union-slot.is-aiming')).toHaveLength(1);
  });

  it('같은 칸을 다시 누르면 접힌다', () => {
    const ui = mount();
    ui.slots()[0]!.click();
    ui.slots()[0]!.click();
    expect(ui.panel()).toBeNull();
  });

  it('고르고 나면 닫힌다 — 다음 칸은 스스로 고르게 둔다', () => {
    const ui = mount();
    ui.slots()[0]!.click();
    ui.cards()[0]!.click();
    expect(ui.panel()).toBeNull();
  });

  it('다시 그려도 판은 그 자리에 남는다', () => {
    // 판을 여는 즉시 호출부가 전체를 다시 그린다. 붙이는 일을 그리기와 함께 하지 않으면
    // 판이 옛 줄과 함께 뜯겨 «눌렀는데 아무 일도 안 일어났다»가 된다.
    const ui = mount();
    ui.slots()[0]!.click();
    expect(ui.redraw).toHaveBeenCalled();
    expect(ui.panel()).not.toBeNull();
    expect(ui.panel()!.previousElementSibling).toBe(ui.host);
  });
});

describe('중복 편성', () => {
  it('이미 있는 니케는 다른 칸에서 고를 수 없다', () => {
    const ui = mount();
    ui.slots()[0]!.click();
    ui.cards().find((card) => card.textContent?.includes('크라운'))!.click();
    ui.slots()[1]!.click();
    const crown = ui.cards().find((card) => card.textContent?.includes('크라운'))!;
    expect(crown.disabled).toBe(true);
  });

  it('겨눈 칸 자신은 고를 수 있다 — 같은 것을 다시 넣는 것뿐이다', () => {
    const ui = mount();
    ui.slots()[0]!.click();
    ui.cards().find((card) => card.textContent?.includes('크라운'))!.click();
    ui.slots()[0]!.click();
    const crown = ui.cards().find((card) => card.textContent?.includes('크라운'))!;
    expect(crown.disabled).toBe(false);
  });
});

describe('찾기와 좁히기', () => {
  it('검색어로 좁힌다', () => {
    const ui = mount();
    ui.slots()[0]!.click();
    expect(ui.cards()).toHaveLength(catalog.length);
    const search = ui.panel()!.querySelector<HTMLInputElement>('.roster-search')!;
    search.value = '크라운';
    search.dispatchEvent(new Event('input'));
    expect(ui.cards()).toHaveLength(1);
  });

  it('칩으로 속성·클래스·버스트를 좁힌다', () => {
    const ui = mount();
    ui.slots()[0]!.click();
    const chips = [...ui.panel()!.querySelectorAll<HTMLButtonElement>('.union-chip')];
    const water = chips.find((chip) => chip.textContent === '水冷')!;
    water.click();
    expect(ui.cards().map((card) => card.textContent)).toHaveLength(2);   // 리타·앨리스
    water.click();
    expect(ui.cards()).toHaveLength(catalog.length);
  });
});
