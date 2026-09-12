import type { SettingsCatalog, SimulationRequest, SimulationResult } from './types';

export function randomTrials(request: SimulationRequest, count: number): SimulationRequest[] {
  if (!Number.isInteger(count) || count < 2 || count > 20) throw new Error('模擬次數需為 2–20 的整數');
  return Array.from({ length: count }, (_, i) => ({ ...structuredClone(request), rngMode: 'random', seed: (request.seed + i) % 2147483648 }));
}

export function summarizeTrials(rows: { seed: number; damage: number }[]) {
  if (!rows.length || rows.some(r => !Number.isFinite(r.damage) || r.damage < 0)) throw new Error('沒有有效的模擬結果');
  const sorted = [...rows].sort((a, b) => a.damage - b.damage);
  return { min: sorted[0]!, max: sorted.at(-1)!, mean: sorted.reduce((sum, r) => sum + r.damage, 0) / rows.length, count: rows.length };
}

/** 一次只改一個技能；不修改匯入資料，不猜測技能書成本。 */
export function skillTrials(request: SimulationRequest, name: string, settings: SettingsCatalog): { label: string; request: SimulationRequest }[] {
  if (!request.squad.includes(name)) throw new Error('角色不在此隊伍');
  const defaults = settings.characters[name];
  if (!defaults || defaults.skillLevelsLocked) return [];
  const levels = request.characters?.[name]?.skillLevels ?? defaults.skillLevels;
  return (['1', '2', '3'] as const).flatMap(skill => {
    const current = levels[skill];
    if (!Number.isInteger(current) || current < 1 || current >= 10) return [];
    const trial = structuredClone(request); trial.rngMode = 'expected';
    trial.characters = { ...trial.characters, [name]: { ...trial.characters?.[name], skillLevels: { ...levels, [skill]: current + 1 } } };
    return [{ label: `技能 ${skill}：${current} → ${current + 1}`, request: trial }];
  });
}

export function createBattleAnalysis(options: {
  request: SimulationRequest; settings: SettingsCatalog; labelOf: (name: string) => string;
  simulate: (request: SimulationRequest) => Promise<SimulationResult>;
  isBusy: () => boolean; setBusy: (busy: boolean) => void;
}): HTMLDetailsElement {
  const box = document.createElement('details'); box.className = 'union-deck-code battle-analysis';
  const summary = document.createElement('summary'); summary.textContent = '傷害範圍／技能升級比較'; box.append(summary);
  const note = document.createElement('p'); note.className = 'field-note';
  note.textContent = '以這筆結果的隊伍、養成與王條件為基準，不改帳號資料。隨機樣本最小／最大不是理論上下限；升級比較使用期望值，只改一個技能，不換算技能書成本。'; box.append(note);
  const count = document.createElement('input'); count.type = 'number'; count.min = '2'; count.max = '20'; count.value = '5'; count.ariaLabel = '隨機模擬次數';
  const target = document.createElement('select'); target.ariaLabel = '技能升級比較角色';
  for (const name of options.request.squad) target.append(new Option(options.labelOf(name), name));
  const field = (text: string, control: HTMLElement) => {
    const label = document.createElement('label'); label.textContent = text; label.append(control); return label;
  };
  const button = (text: string) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'roster-import'; b.textContent = text; return b; };
  const random = button('測試隨機傷害範圍'), skills = button('比較技能升一級'), stop = button('停止並保留結果'); stop.hidden = true;
  const progress = document.createElement('p'); progress.setAttribute('aria-live', 'polite');
  const controls = document.createElement('div'); controls.className = 'battle-analysis-controls';
  controls.append(field('隨機模擬次數', count), random, field('技能升級比較角色', target), skills, stop);
  const output = document.createElement('div'); box.append(controls, progress, output);
  let running = false, stopped = false;
  stop.addEventListener('click', () => { stopped = true; progress.textContent = '等待目前一盤完成後停止…'; });
  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  const appendNotes = (result: SimulationResult) => {
    if (result.previewNote) { const p = document.createElement('p'); p.textContent = result.previewNote; output.append(p); }
    if (result.deviations) {
      const detail = document.createElement('details'), title = document.createElement('summary'), pre = document.createElement('pre');
      title.textContent = '本盤條件差異'; pre.textContent = result.deviations; pre.className = 'deviations';
      detail.append(title, pre); output.append(detail);
    }
  };
  const run = async (kind: 'random' | 'skills') => {
    if (running || options.isBusy()) { progress.textContent = '請先等目前的計算完成。'; return; }
    const name = target.value;
    let trials: { label: string; request: SimulationRequest }[];
    try {
      trials = kind === 'random' ? randomTrials(options.request, Number(count.value)).map(request => ({ label: `種子 ${request.seed}`, request }))
        : skillTrials(options.request, name, options.settings);
    } catch (error) { progress.textContent = String(error); return; }
    if (!trials.length) { progress.textContent = '此角色技能已滿級，或技能等級不能調整。'; return; }
    running = true; stopped = false; options.setBusy(true);
    random.disabled = skills.disabled = target.disabled = count.disabled = true; stop.hidden = false; output.replaceChildren();
    progress.textContent = kind === 'skills' ? '正在計算期望值基準…' : `正在模擬第 1/${trials.length} 盤…`;
    const rows: { seed: number; damage: number }[] = [];
    let failures = 0, completed = 0;
    try {
      const baseline = kind === 'skills' ? await options.simulate({ ...structuredClone(options.request), rngMode: 'expected' }) : undefined;
      if (baseline) {
        if (!Number.isFinite(baseline.squadTotal) || baseline.squadTotal < 0) throw new Error('無效基準結果');
        const p = document.createElement('p'); p.textContent = `期望值基準：全隊 ${fmt(baseline.squadTotal)}；${options.labelOf(name)} ${fmt(baseline.charTotals[name] ?? 0)}`; output.append(p);
        appendNotes(baseline);
      }
      for (const trial of trials) {
        if (stopped || !box.isConnected) break;
        try {
          const result = await options.simulate(trial.request);
          if (!Number.isFinite(result.squadTotal) || result.squadTotal < 0) throw new Error('無效結果');
          rows.push({ seed: trial.request.seed, damage: result.squadTotal });
          const p = document.createElement('p');
          p.textContent = `${trial.label}：全隊 ${fmt(result.squadTotal)}` + (baseline
            ? `（增加 ${fmt(result.squadTotal - baseline.squadTotal)}）；角色增加 ${fmt((result.charTotals[name] ?? 0) - (baseline.charTotals[name] ?? 0))}` : '');
          output.append(p);
          appendNotes(result);
        } catch (error) { failures++; const p = document.createElement('p'); p.textContent = `${trial.label}：失敗（${error instanceof Error ? error.message : String(error)}）`; output.append(p); }
        completed++; progress.textContent = `已完成 ${completed}/${trials.length}，失敗 ${failures}`;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (kind === 'random' && rows.length) {
        const stats = summarizeTrials(rows), p = document.createElement('p');
        p.textContent = `${stats.count} 盤樣本：最小 ${fmt(stats.min.damage)}（種子 ${stats.min.seed}）／平均 ${fmt(stats.mean)}／最大 ${fmt(stats.max.damage)}（種子 ${stats.max.seed}）`;
        output.prepend(p);
      }
      progress.textContent = `${stopped ? '已停止' : '比較完成'} · ${completed}/${trials.length} 盤，失敗 ${failures}；結果保留於此頁。`;
    } catch (error) { progress.textContent = `比較失敗：${error instanceof Error ? error.message : String(error)}`; }
    finally { running = false; options.setBusy(false); random.disabled = skills.disabled = target.disabled = count.disabled = false; stop.hidden = true; }
  };
  random.addEventListener('click', () => { void run('random'); }); skills.addEventListener('click', () => { void run('skills'); });
  return box;
}
