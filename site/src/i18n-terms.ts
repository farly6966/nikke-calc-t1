/**
 * 속성 아이콘.
 *
 * 예전에는 이 파일이 분류명·큐브 이름을 중국어로 옮기는 사전이기도 했다. 그 일은
 * 이제 언어층이 한다(`i18n.ts`) — 분류명은 상류 사전에 열세 개가 다 있고, 큐브·캐릭터
 * 이름은 게임사 CDN 표(`data/locale_text.json`)가 정본이다. 부르는 자리에서 미리
 * 옮기지 않고 한국어를 그대로 두면 **영어·일본어도 함께** 되므로 그쪽으로 옮겼다.
 *
 * 남은 것은 사전이 아니라 그림이라 여기 있다.
 */

// 속성(코드) 아이콘 — 그림은 `image/icon/icon-code-*.png`가 정본이다.
// 목록에 없는 코드(직접 추가한 니케)는 조용히 아이콘을 생략한다.
const ELEMENT_ICON: Record<string, string> = {
  작열: 'fire', 수냉: 'water', 풍압: 'wind', 전격: 'electronic', 철갑: 'iron',
};

/**
 * 속성 아이콘 한 조각. 계산기의 편성 슬롯과 유니온 탭의 편성기가 함께 쓴다 —
 * 같은 그림이 두 자리에서 다르게 생기면 같은 것으로 안 보인다.
 */
export function createElementIcon(elementCode: string, className: string): HTMLElement | null {
  const slug = ELEMENT_ICON[elementCode];
  if (!slug) return null;
  const icon = document.createElement('span');
  icon.className = `${className} element-icon is-${slug}`;
  // 그림만으로는 속성을 못 읽는 사람이 있어 이름을 붙인다. 한국어로 붙여 두면
  // 화면을 훑는 쪽이 그 사람 말로 바꾼다(`title`·`aria-label` 둘 다 본다).
  icon.title = elementCode;
  icon.ariaLabel = elementCode;
  return icon;
}
