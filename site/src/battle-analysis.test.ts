// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createBattleAnalysis, randomTrials, skillTrials, summarizeTrials } from './battle-analysis';
import type { SettingsCatalog, SimulationRequest, SimulationResult } from './types';
const request: SimulationRequest = { squad: ['unit'], seed: 2147483647, rngMode: 'random', characters: { unit: { skillLevels: { 1: 5, 2: 10, 3: 8 }, growthStage: 2 } }, duration: 180, enemyDef: 31784, enemyCode: '', corePx: 0, hasParts: false };
const settings = { characters: { unit: { skillLevels: { 1: 10, 2: 10, 3: 10 } } } } as unknown as SettingsCatalog;
describe('battle analysis', () => {
  it('bounds sampling and uses reproducible distinct seeds without changing the request', () => {
    const trials = randomTrials(request, 3);
    expect(trials.map(t => t.seed)).toEqual([2147483647, 0, 1]);
    expect(() => randomTrials(request, 21)).toThrow();
    trials[0]!.squad.push('other'); expect(request.squad).toEqual(['unit']);
    expect(summarizeTrials([{ seed: 1, damage: 5 }, { seed: 2, damage: 15 }])).toMatchObject({ mean: 10, min: { damage: 5 }, max: { damage: 15 } });
  });
  it('changes exactly one skill, preserves equipment and ignores maxed skills', () => {
    const trials = skillTrials(request, 'unit', settings);
    expect(trials.map(t => t.request.characters!.unit!.skillLevels)).toEqual([{ 1: 6, 2: 10, 3: 8 }, { 1: 5, 2: 10, 3: 9 }]);
    expect(trials.every(t => t.request.rngMode === 'expected' && t.request.characters!.unit!.growthStage === 2)).toBe(true);
    expect(request.characters!.unit!.skillLevels![1]).toBe(5);
  });
  it('shows partial results on cancellation and restores busy state', async () => {
    const busy = vi.fn(); let finish!: (r: SimulationResult) => void;
    const simulate = vi.fn(() => new Promise<SimulationResult>(resolve => { finish = resolve; }));
    const box = createBattleAnalysis({ request, settings, simulate, labelOf: n => n, isBusy: () => false, setBusy: busy }); document.body.append(box);
    box.querySelectorAll('button')[0]!.click(); box.querySelectorAll('button')[2]!.click();
    finish({ squadTotal: 100, charTotals: { unit: 100 }, duration: 180, hitCount: 1, previewNote: '', deviations: '' });
    await vi.waitFor(() => expect(box.textContent).toContain('已停止 · 1/5'));
    expect(simulate).toHaveBeenCalledTimes(1); expect(busy.mock.calls.map(c => c[0])).toEqual([true, false]); box.remove();
  });
  it('recomputes an expected baseline and reports paired skill deltas', async () => {
    const original = structuredClone(request), busy = vi.fn();
    const simulate = vi.fn(async (trial: SimulationRequest): Promise<SimulationResult> => ({
      squadTotal: 100 + (trial.characters!.unit!.skillLevels![1] - 5) * 10 + (trial.characters!.unit!.skillLevels![3] - 8) * 20,
      charTotals: { unit: 60 + (trial.characters!.unit!.skillLevels![1] - 5) * 5 }, duration: 180,
      hitCount: 1, previewNote: '[preview]', deviations: 'skill settings',
    }));
    const box = createBattleAnalysis({ request, settings, simulate, labelOf: n => n, isBusy: () => false, setBusy: busy }); document.body.append(box);
    box.querySelectorAll('button')[1]!.click();
    await vi.waitFor(() => expect(box.textContent).toContain('比較完成 · 2/2'));
    expect(simulate.mock.calls.map(([r]) => r.rngMode)).toEqual(['expected', 'expected', 'expected']);
    expect(box.textContent).toContain('期望值基準：全隊 100');
    expect(box.textContent).toContain('技能 1：5 → 6：全隊 110（增加 10）；角色增加 5');
    expect(box.textContent).toContain('技能 3：8 → 9：全隊 120（增加 20）');
    expect(box.textContent).toContain('[preview]'); expect(box.textContent).toContain('skill settings');
    expect(request).toEqual(original); expect(busy).toHaveBeenLastCalledWith(false); box.remove();
  });
  it('retains successful trials when one sample fails', async () => {
    let calls = 0;
    const simulate = vi.fn(async (): Promise<SimulationResult> => {
      if (++calls === 2) throw new Error('sample failed');
      return { squadTotal: calls * 100, charTotals: {}, duration: 180, hitCount: 1, previewNote: '', deviations: '' };
    });
    const box = createBattleAnalysis({ request, settings, simulate, labelOf: n => n, isBusy: () => false, setBusy: () => {} }); document.body.append(box);
    box.querySelector('input')!.value = '3'; box.querySelectorAll('button')[0]!.click();
    await vi.waitFor(() => expect(box.textContent).toContain('比較完成 · 3/3 盤，失敗 1'));
    expect(box.textContent).toContain('2 盤樣本：最小 100'); expect(box.textContent).toContain('平均 200');
    expect(box.querySelectorAll('button')[0]!.disabled).toBe(false); box.remove();
  });
  it('does not submit trials while another calculation is busy', () => {
    const simulate = vi.fn();
    const box = createBattleAnalysis({ request, settings, simulate, labelOf: n => n, isBusy: () => true, setBusy: () => {} }); document.body.append(box);
    box.querySelectorAll('button')[0]!.click(); expect(simulate).not.toHaveBeenCalled();
    expect(box.textContent).toContain('請先等目前的計算完成'); box.remove();
  });
});
