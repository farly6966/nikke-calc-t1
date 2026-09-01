// 다른 사람이 만든 니케 도구들로 나가는 고리.
//
// **여기 적힌 곳은 우리가 운영하지 않는다.** 주소도 내용도 저쪽 사정으로 언제든 바뀌므로,
// 링크를 계산기 화면 곳곳에 흩뿌리지 않고 이 표 하나에 모아 둔다 — 고칠 곳이 한 군데다.
//
// 새 고리를 들일 때는 이 배열에 한 줄만 더하면 된다. `label`은 **그 사이트가 자기 주소에
// 쓰는 이름**을 그대로 적는다 — 중국어 화면에 한글 이름이 서 있으면 읽을 수가 없고,
// 억지로 옮겨 지으면 검색해서 찾아갈 수도 없다. 무엇을 하는 곳인지는 `note`가 말한다.

export interface ExternalLink {
  /** 사람들이 부르는 이름. 화면에 그대로 나온다. */
  label: string;
  /** 무엇을 하는 곳인지 한 줄. 들어가 보기 전에 판단할 수 있어야 한다. */
  note: string;
  url: string;
}

export const EXTERNAL_LINKS: ExternalLink[] = [
  {
    label: "Let's Doro",
    note: '韓國妮姬社群的協同作戰與養成綜合管理系統',
    url: 'https://letsdoro.com/',
  },
  {
    label: 'Dildoro',
    note: '另一個傷害計算機網站',
    url: 'https://dildoro.com/',
  },
  {
    label: 'Solo Raid History',
    note: '單人突襲的紀錄保管所',
    url: 'https://soloraidhistory.vercel.app/',
  },
  {
    label: 'Doro Party',
    note: '聯盟突襲的管制輔助網站',
    url: 'https://doroparty.com/',
  },
];

/** 주소에서 사람이 알아보는 부분만. 카드에 «letsdoro.com»으로 적어 어디로 가는지 보인다. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
