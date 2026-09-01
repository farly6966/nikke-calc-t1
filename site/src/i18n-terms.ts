/**
 * 분류명 표시용 한국어→중국어(번체) 사전.
 *
 * 계산 엔진과 데이터(`catalog.json`, `parsed_nikke.json` 등)는 한국어 값을 그대로
 * 키·코드로 쓴다. 여기서 바꾸는 건 **화면에 보이는 라벨뿐**이다 — 필터 값이나
 * 직렬화 코드는 절대 건드리지 않는다.
 *
 * 모르는 값은 그대로 돌려준다. 새 속성·기업이 생겨도 빈칸이 되는 대신 한국어로
 * 남으므로 화면이 깨지지 않는다.
 *
 * Display-only Korean→Traditional-Chinese dictionary for category labels.
 * The engine and data keep the Korean values as their canonical keys; only the
 * on-screen label is swapped. Unknown values fall through unchanged.
 */

/** 속성(원소) 코드 */
export const ELEMENT_ZH: Record<string, string> = {
  작열: '燃燒',
  수냉: '水冷',
  풍압: '風壓',
  전격: '電擊',
  철갑: '鐵甲',
};

/** 클래스 */
export const CLASS_ZH: Record<string, string> = {
  화력형: '火力型',
  방어형: '防禦型',
  지원형: '支援型',
};

/** 기업(제조사) */
export const CORP_ZH: Record<string, string> = {
  엘리시온: '極樂淨土',
  미실리스: '米西利斯',
  테트라: '泰特拉',
  필그림: '朝聖者',
  어브노말: '反常',
};

/** 필터 그룹 제목 (FilterKey 기준) */
export const FILTER_TITLE_ZH: Record<string, string> = {
  rarity: '稀有度',
  class: '職業',
  code: '屬性',
  weapon: '武器',
  corp: '企業',
  burst: '爆裂',
};

/** 모든 분류 사전을 한데 모아 한 번에 조회한다. */
const ALL_TERMS: Record<string, string> = { ...ELEMENT_ZH, ...CLASS_ZH, ...CORP_ZH };

/** 한국어 분류 값 → 중국어 라벨. 사전에 없으면 원래 값을 그대로 돌려준다. */
export function termZh(value: string): string {
  return ALL_TERMS[value] ?? value;
}
