import { t, tName } from './i18n';
import type { CubeSelection, DeckState, SettingsCatalog } from './types';

export type UnionCubes = Record<string, CubeSelection>;

/** 편성에서 빠진 니케나 손상된 저장값은 계산에 보내지 않는다. */
export function cleanUnionCubes(raw: unknown, squad: string[], settings?: SettingsCatalog): UnionCubes | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const result: UnionCubes = {};
  for (const name of squad.filter(Boolean)) {
    const cube = (raw as UnionCubes)[name];
    if (!cube || typeof cube.name !== 'string' || !Number.isInteger(cube.level)) continue;
    if (cube.name === '없음') result[name] = { name: '없음', level: 0 };
    else if (cube.level >= 1 && cube.level <= 15 && (!settings || settings.cubes[cube.name]?.levels[String(cube.level)])) {
      result[name] = { name: cube.name, level: cube.level };
    }
  }
  return Object.keys(result).length ? result : undefined;
}

/** 원본 계정의 양성값을 바꾸지 않고 이 시뮬레이션의 큐브만 덮는다. */
export function applyUnionCubes(deck: DeckState, cubes: UnionCubes | undefined, settings: SettingsCatalog): void {
  for (const [name, cube] of Object.entries(cleanUnionCubes(cubes, deck.squad, settings) ?? {})) {
    deck.characters[name] = { ...deck.characters[name], cube: { ...cube } };
  }
}

export function createUnionCubeEditor(
  squad: string[], current: UnionCubes | undefined, settings: SettingsCatalog,
  labelOf: (name: string) => string, onChange: (next: UnionCubes | undefined) => void,
): HTMLDetailsElement {
  const fold = document.createElement('details'); fold.className = 'union-deck-code union-cube-editor';
  const summary = document.createElement('summary'); summary.textContent = t('큐브 테스트 설정');
  fold.append(summary);
  const note = document.createElement('p'); note.className = 'field-note';
  note.textContent = t('각 계정의 큐브를 그대로 쓰거나 이 덱에서만 종류와 레벨을 바꿉니다. 지정한 큐브는 이 덱을 계산하는 모든 계정에 적용되며 원본 양성값은 바꾸지 않습니다.');
  fold.append(note);
  let cubes = cleanUnionCubes(current, squad, settings) ?? {};
  for (const name of squad.filter(Boolean)) {
    const row = document.createElement('div'); row.className = 'union-cube-row';
    const label = document.createElement('span'); label.textContent = labelOf(name);
    const select = document.createElement('select'); select.dataset.unionCubeName = name;
    select.ariaLabel = t('{name} 큐브', { name: labelOf(name) });
    select.append(new Option(t('계정 큐브 유지'), ''), new Option(t('큐브 없음'), '없음'));
    for (const cube of Object.keys(settings.cubes)) select.append(new Option(tName(cube), cube));
    select.value = cubes[name]?.name ?? '';
    const levels = document.createElement('select'); levels.dataset.unionCubeLevel = name;
    levels.ariaLabel = t('{name} 큐브 레벨', { name: labelOf(name) });
    const warning = document.createElement('p'); warning.className = 'field-note';
    const paint = () => {
      const cube = cubes[name]; const meta = cube ? settings.cubes[cube.name] : undefined;
      levels.replaceChildren();
      for (const value of Object.keys(meta?.levels ?? {}).map(Number).sort((a,b) => a-b)) {
        levels.append(new Option(`Lv${value}`, String(value)));
      }
      levels.disabled = !meta;
      if (cube && meta) levels.value = String(cube.level);
      warning.hidden = !meta?.unsupported;
      warning.textContent = meta?.unsupported
        ? t('이 큐브의 고유 효과는 아직 지원하지 않습니다. 기본 능력치와 공통 우월 코드 효과만 적용됩니다.') : '';
    };
    const save = () => { paint(); onChange(cleanUnionCubes(cubes, squad, settings)); };
    select.addEventListener('change', () => {
      if (!select.value) delete cubes[name];
      else if (select.value === '없음') cubes[name] = { name: '없음', level: 0 };
      else {
        const available = Object.keys(settings.cubes[select.value]!.levels).map(Number);
        const prior = cubes[name]?.level ?? settings.characters[name]?.cube.level;
        cubes[name] = { name: select.value, level: prior && available.includes(prior) ? prior : Math.max(...available) };
      }
      save();
    });
    levels.addEventListener('change', () => {
      cubes[name] = { name: select.value, level: Number(levels.value) }; save();
    });
    paint(); row.append(label, select, levels, warning); fold.append(row);
  }
  const saved = document.createElement('p'); saved.className = 'field-note';
  saved.textContent = t('큐브 테스트 설정은 이 브라우저에 저장됩니다. NK2·NK4 공유 코드에는 포함되지 않습니다.');
  fold.append(saved);
  return fold;
}
