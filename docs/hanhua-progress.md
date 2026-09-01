# 漢化進度與交接筆記

> 給接手的人(其他 Cowork session 或未來的自己)。搭配 `docs/hanhua-glossary.md`(術語表)一起看。

## 一句話現況
NIKKE 隊伍計算機的**繁體中文化**。核心流程、`ui.ts`、效果名對照表、更新公告與聯盟突襲已全中文;角色名先用**官方英文**(CDN 無中文,繁中之後補)。剩幾個次要檔案的字串未翻。

- **倉庫 / 分支**:`farly6966/nikke-calc-t1`,目前主線是 `master`
  (原 `claude/github-fork-location-vgx61m` 已合併)
- **原版來源**:fork 自 `Moris-kr/nikke-calc`
- 部署 base 已修正為 `/nikke-calc-t1/`(fork 改名後 GitHub Pages 空白頁的成因)

## 已完成 ✅
- **L1 分類名**:屬性/職業/企業/爆裂階(見 `site/src/i18n-terms.ts`)
- **L2 角色名(英文版)**:`data/i18n/names.en.json`(韓→英,199 角色)。
  `sync-runtime` 產 catalog 時掛 `displayName`;前端顯示用 `displayName ?? name`,
  引擎/鍵/搜尋仍用韓文 `name`。模組級 `resolveDisplayName()`(ui.ts)供字串型顯示點。
- **L3 介面**:`ui.ts` 全部(HTML 模板 + 所有分頁/對話框 + 動態字串)、
  `character-settings.ts`(角色設定面板,含 `CONTROL_NAMES` 操作名)、
  `share-server.ts`(戰鬥摘要)、`blablalink.ts` 的 notes、`main.ts` 開機字。
- **`stat-names.ts`**(159 個效果名 + `statText` 的「秒」單位)。
  這檔原本沒被列進待辦,但它是 buff 詳細與時間軸每一列的顯示名,可見度很高。
- **`notices.ts`**(22 則公告、117 個項目)。`NoticeTag` 的 union 值一併改成
  `'新功能' | '改善' | '修正'`(只有 `notices.test.ts` 引用,已同步)。
  公告內文的角色名改用 `names.en.json` 的英文表記,與畫面顯示一致。
- **`union-raid.ts`**(92 處,含注入 blablalink console 的提示字)。
  `'X-Language': 'ko'` 與 `language: 'ko'` 是 API 參數,**維持韓文**。

## 待辦(剩下的 L3)⬜
翻譯這些檔案裡的**使用者可見字串**(每個都是 `.ts`,在 `site/src/`):
- `timeline.ts`(戰鬥時間軸)
- `custom-nikke.ts`(新增妮姬:注意內含 LLM 提示詞與 schema,**enum 值/英文 key 不可翻**)
- `share-panel.ts`(分享/預設面板)
- `report.ts`(PNG 報告標籤)
- `enikk.ts`、`csv-import.ts`、`share-code.ts`(較少)
- `model.ts`、`export-csv.ts`、`external-links.ts`、`burst-order.ts`、`presence.ts`、
  `worker-client.ts`(各數處,多為錯誤訊息與欄位標籤)
- 收尾:各檔剩餘的長 tooltip

> 注意:`share-code.ts` 的「공유 코드를 해석하지 못했습니다」目前是
> `union-raid.test.ts` 的 `/해석/` 斷言所依賴的字串 — 翻它時要一併改那個斷言。

## 之後可選
- **繁中角色名**:已有英文橋樑(`names.en.json`)。做 English→官方繁中 → 建 `data/i18n/names.zh-TW.json`,
  改 `sync-runtime` 讀它(或優先於 en)。使用者(玩家)複審。
- 推薦操作句/部分訊息中的**隊友名**目前經 `resolveDisplayName`,但少數純函式(`recommendedControlText`/`controlRuleNotes`)無 catalog,隊友名仍是韓文 — 可傳入對照表修。

## 鐵則(務必遵守)
1. **只翻「顯示的字」,不翻「識別鍵/資料值」**。不可碰:
   - 下拉 `value="풍압"` 等 enum 值、`NO_CUBE='없음'`、`DEFAULT_SQUAD` 韓文名、
     裝備部位鍵 `머리/몸통/팔/다리`、element→icon map(`작열:'fire'`)、
     `custom-nikke` schema 裡使用者要輸入的 enum(전격/스킬1 等)與英文 key、技能名(skill.name)。
2. 顯示角色名一律用 `displayName ?? name` 或 `resolveDisplayName(name)`,**絕不改 name 本身**。
3. 用詞照 `docs/hanhua-glossary.md`(魔方、珍藏品、免疫、屬濾、普攻…)。
4. **改完必跑測試**:很多測試寫死韓文斷言,翻譯後要同步改測試的預期值(這是正常的,不是弄壞測試)。

## 開發/驗證/提交流程(在 `site/` 目錄)
```bash
cd site
npm install                 # 第一次
npm test -- --run           # 跑全部測試(約 50 秒,410 個)
npx tsc --noEmit            # 型別檢查
npm run build               # 正式建置(含 sync-runtime + check-runtime)
```
翻一批 → `npm test -- --run` → 依失敗訊息把測試的韓文預期改成新中文 → 綠燈 → commit → push。

## 提交慣例
- commit 訊息用中文,結尾兩行 trailer 照現有提交(`Co-Authored-By` + `Claude-Session`)。
- 開分支 → PR → 合併回 `master`。

## 上線
推上 `master` → GitHub Actions 自動 build 部署到 GitHub Pages
(`https://farly6966.github.io/nikke-calc-t1/`)。**合併前先問使用者。**
（Pages 需在該 fork 的 Settings → Pages 啟用。）

`site/vite.config.ts` 的 `base` 必須等於 repo 名(`/nikke-calc-t1/`)。
改 repo 名或再 fork 一次時要跟著改,否則 JS/CSS 會 404、頁面全白而 CI 仍是綠燈。
