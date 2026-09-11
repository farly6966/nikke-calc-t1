import { describe, expect, it } from 'vitest';
import { cleanUnionCubes, applyUnionCubes } from './union-cubes';
import { candidateKey } from './union-search';
import { decodeUnionDraft, encodeUnionDraft, readBossCode, readDeckCode } from './union-raid';
import { encodeShareCode } from './share-code';
import type { DeckState, SettingsCatalog } from './types';

const settings = { cubes: { 재장: { levels: { '1': {}, '15': {} } } } } as unknown as SettingsCatalog;
describe('union cube overrides', () => {
  it('changes only the selected cube, leaving imported stats and other squad members intact', () => {
    const imported = { cube: { name: '재장', level: 1 }, growthStage: 7 };
    const deck: DeckState = { id: 1, squad: ['리타', '크라운'], characters: { 리타: imported } };
    applyUnionCubes(deck, { 리타: { name: '재장', level: 15 }, 크라운: { name: '없음', level: 0 } }, settings);
    expect(imported.cube.level).toBe(1);
    expect(deck.characters.리타).toEqual({ cube: { name: '재장', level: 15 }, growthStage: 7 });
    expect(deck.characters.크라운?.cube).toEqual({ name: '없음', level: 0 });
  });
  it('keeps cube comparisons distinct and rejects absent characters, unknown cubes and invalid levels', () => {
    const squad = ['리타'];
    const cubes = { 리타: { name: '재장', level: 15 }, 크라운: { name: '재장', level: 1 } };
    expect(cleanUnionCubes(cubes, squad, settings)).toEqual({ 리타: cubes.리타 });
    expect(cleanUnionCubes({ 리타: { name: '잘못된 큐브', level: 15 } }, squad, settings)).toBeUndefined();
    expect(cleanUnionCubes({ 리타: { name: '재장', level: 8 } }, squad, settings)).toBeUndefined();
    expect(candidateKey({ squad, cubes })).not.toBe(candidateKey({ squad }));
    expect(candidateKey({ squad, cubes })).toBe(candidateKey({ squad, cubes: { 리타: cubes.리타 } }));
  });
  it('restores per-squad cube settings from the local board draft', () => {
    const squad = ['리타'];
    const code = encodeShareCode([{ id: 1, squad, characters: {} }], false);
    const deck = readDeckCode({ code, cubes: { 리타: { name: '재장', level: 15 } } }, squad);
    const board = Array.from({length: 6}, () => readBossCode({name:'',code:'NK3-e30',enabled:true,decks:[deck]}));
    const restored = decodeUnionDraft(encodeUnionDraft(board), squad);
    expect(restored[0]!.decks[0]!.cubes).toEqual(deck.cubes);
  });
});
