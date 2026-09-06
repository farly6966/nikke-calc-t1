// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanUnionSequence, compileUnionSequence, createUnionBurstEditor, applyUnionBurst, cleanNoBurst } from './union-burst';
import type { CharacterMeta } from './types';

const catalog = ['1', '2', '3', '3', 'A'].map((burstStage, i) => ({ name: `unit${i}`, burstStage } as CharacterMeta));
const squad = catalog.map(char => char.name);

describe('union burst sequence', () => {
  it('keeps permanent bans out of manual and automatic rounds without mutating roster', () => {
    const original = { growthStage: 3 };
    const deck = { id: 1, squad, characters: { unit4: original } };
    applyUnionBurst(deck, [{ 1: ['unit4'], 2: [], 3: ['unit2'] }], catalog, ['unit4']);
    expect(original).toEqual({ growthStage: 3 });
    expect(deck.characters.unit4).toEqual({ growthStage: 3, burst: { mode: 'skip' } });
    expect(compileUnionSequence([{ 1: ['unit4'], 2: [], 3: ['unit2'] }], squad, catalog, ['unit4']))
      .toEqual([{ 1: ['unit0'], 2: ['unit1'], 3: ['unit2'] }]);
    expect(cleanNoBurst(['unit4', 'unit4', 'gone', null], squad)).toEqual(['unit4']);
  });
  it('fills automatic stages, preserves explicit picks, and supports all-stage characters', () => {
    const sequence = compileUnionSequence([{ 1: [], 2: [], 3: ['unit3'] }], squad, catalog)!;
    expect(sequence).toEqual([{ 1: ['unit0', 'unit4'], 2: ['unit1', 'unit4'], 3: ['unit3'] }]);
    expect(compileUnionSequence([{ 1: [], 2: [], 3: [] }], squad, catalog)).toBeUndefined();
  });
  it('prunes removed names, strips unexpected fields and bounds corrupt stored input', () => {
    expect(cleanUnionSequence([{ 1: ['gone', 'unit0', 'unit0'], 2: null, 3: 'bad', cookie: 'secret' }], squad))
      .toEqual([{ 1: ['unit0'], 2: [], 3: [] }]);
    expect(cleanUnionSequence(null, squad)).toBeUndefined();
    expect(cleanUnionSequence(Array(40).fill({ 1: ['unit0'] }), squad)).toHaveLength(30);
    expect(compileUnionSequence([{ 1: ['unit3'], 2: [], 3: ['unit2'] }], squad, catalog)![0]![1])
      .toEqual(['unit0', 'unit4']);
  });
  it('edits, repeats without aliasing cycles, bounds rounds, and resets to auto', () => {
    const onChange = vi.fn();
    const editor = createUnionBurstEditor({ squad, catalog, duration: 60, labelOf: name => name, onChange });
    const select = editor.querySelector<HTMLSelectElement>('[aria-label="第 1 輪 B3"]')!;
    select.value = 'unit2'; select.dispatchEvent(new Event('change'));
    editor.querySelector<HTMLButtonElement>('button')!.click();
    expect(onChange.mock.lastCall![0]).toHaveLength(3);
    const second = editor.querySelector<HTMLSelectElement>('[aria-label="第 2 輪 B3"]')!;
    second.value = 'unit3'; second.dispatchEvent(new Event('change'));
    expect(onChange.mock.lastCall![0].map((cycle: Record<string, string[]>) => cycle[3])).toEqual([['unit2'], ['unit3'], ['unit2']]);
    const count = editor.querySelector<HTMLInputElement>('input')!;
    count.value = '4'; count.dispatchEvent(new Event('input'));
    expect(editor.querySelector('[aria-label="第 4 輪 B3"]')).not.toBeNull();
    count.value = '3'; count.dispatchEvent(new Event('input'));
    count.value = '31'; count.dispatchEvent(new Event('change')); expect(count.value).toBe('3');
    editor.querySelectorAll<HTMLButtonElement>('button')[1]!.click();
    expect(onChange.mock.lastCall![0]).toBeUndefined();
  });
});
