# 漢化進度與交接筆記

> 給接手的人(其他 Cowork session 或未來的自己)。搭配 `docs/hanhua-glossary.md`(術語表)一起看。

## 一句話現況
NIKKE 隊伍計算機的**繁體中文化**。L3 待辦**已全部翻完**,魔方名稱與效果句也補上了。
用**實際出貨的 `catalog.json` / `settings.json`** 把畫面掛在 jsdom 上整個走過一遍
(主畫面、角色設定面板、各分頁與所有能點開的面板),掃出來的殘留韓文只剩
`렐릭 커버 큐브` 一個魔方名(使用者判斷可暫緩)與**引擎資料鍵/識別值本身**。
角色名用**官方英文**顯示(CDN 沒有中文,見下方調查結果)。

- **倉庫 / 分支**:`farly6966/nikke-calc-t1`,主線 `master`
- **原版來源**:fork 自 `Moris-kr/nikke-calc`
- 部署 base 為 `/nikke-calc-t1/`

## 已完成 ✅

### L1 / L2(既有)
- **分類名**:屬性/職業/企業/爆裂階(`site/src/i18n-terms.ts`)
- **角色名(英文)**:`data/i18n/names.en.json`(韓→英,**200 角色**;
  本次補上 `드레이크 : 그레이트 빌런` → `Drake: Great Villain`)。
  `레이`/`레이 (가칭)` 改用官方全名 `Rei Ayanami` / `Rei Ayanami (Tentative Name)` —
  原本只寫 `Rei`,和另一名角色 `라이`(泰特拉 水冷 SMG)的英文名**撞名**,
  清單上會並排兩個一模一樣的 `Rei`。對照來源是使用者自己的
  `farly6966/HARSH_nikke_urDMGdist`(日服前 100 公會樣本),
  它的 93 個英文名和我們這份表其餘 91 個完全吻合。
  `runtime-assets.test.ts` 新增一條**顯示名不得重複**的測試,
  `사쿠라`(SSR)與 `사쿠라 (SR)` 目前都叫 `Sakura`,放在 `pending` 允許清單裡待處理。
  `sync-runtime` 產 catalog 時掛 `displayName`;前端顯示用 `displayName ?? name`,
  引擎/鍵仍用韓文 `name`。

### L3 介面(全數完成)
既有:`ui.ts`、`character-settings.ts`、`share-server.ts`、`blablalink.ts` notes、
`main.ts`、`stat-names.ts`、`notices.ts`、`union-raid.ts`。

本次補完:
- `timeline.ts`(時間軸:標題、控制鈕、tooltip、免疫/屬濾帶、buff 列)
- `custom-nikke.ts`(**含 LLM 提示詞全文**;enum 值 `전격`/`화력형`/`스킬1` 等原樣保留,
  並在提示詞開頭明講「這些韓文是識別值,不可翻譯」)
- `share-panel.ts`(分享面板全部,含相對時間「3 天前」)
- `report.ts`(PNG 報告圖全部標籤)
- `enikk.ts`、`share-code.ts`、`model.ts`(驗證訊息)、`export-csv.ts`(CSV 欄位與檔名)
- `external-links.ts`、`burst-order.ts`、`worker-client.ts`、`main.ts`
- `blablalink.ts` 伺服器名(韓國/日本/全球/北美/東南亞)
- `site/index.html` — **分頁標題、og/twitter 分享預覽**。原本整份是韓文,
  而且 `og:url`/`og:image` 還指向上游 `moris-kr.github.io/nikke-calc`,已改成本 fork。
- `ui.ts` 漏網:插槽左右移動 tooltip、刪除鈕、命中數/種子、主控台的企業・職業標籤、
  驗證錯誤前綴(`隊 N:`)、計算完成/失敗狀態列、報告圖的 `siteUrl`

### 引擎側(Python)顯示字串
只翻**顯示用**的字,識別值一律不動:
- `context/growth.py` `growth_stage_label()` — `명함/1돌/코강 N` → `無突破/1突破/核心強化 N`。
  這個標籤經 `export-settings.py` 進 `settings.json`,是突破下拉與卡片摘要的來源。
- `context/spec.py` — 偏離報告(結果區塊底下的 `<pre class="deviations">`)的敘述句與
  `레이어/지정` → `分層/指定`;`preview_note` 的預覽/暫定警告。
  **`_fmt` 與 `char_deviations` 的回傳值沒有動** — `context/baseline/*.json` 的
  `spec_deviations` 直接存那些字串,動了 29 個基準線會全部假性失敗。
- `calculator/customization.py` `BUFF_TARGET_WATCH` 的 `label`(`크확 대상` → `暴擊率對象`)。

### 收尾掃描補的漏(2026-09-02)
靜態 grep 看不出來的五處 — 都是**資料值混進畫面**或**翻譯時選擇器沒跟上**:

- `styles.css` 的 `.notice-tag[data-notice-tag="새 기능"/"개선"/"고침"]`
  在 `NoticeTag` 改成 `新功能`/`改善`/`修正` 後**全部對不上**,更新公告的標籤
  靜靜地掉了顏色(CI 照樣綠燈)。已改成中文值,並在 `notices.test.ts` 加一條
  把 CSS 選擇器和 `NoticeTag` 對起來的測試,之後再改字就會紅燈。
- `createElementIcon()` 的 `title` / `aria-label` 直接放屬性代碼(`철갑`…),
  滑過屬性圖示與螢幕閱讀器都會讀到韓文。已改走 `termZh()`。
- 進階設定的**屬濾(屬性階段)下拉**把選項文字設成代碼本身。
  `option.value` 保持韓文(引擎識別值),`textContent` 改走 `termZh()`。
- 超載/追加數值**超出範圍的驗證訊息**用的是引擎下來的韓文 `meta.label`。
  已改用 `stat-names.ts` 的 `statName(key)`,和設定面板的欄位名同一份表。
- `styles.css` 兩個 `content:` 的韓文標籤:預覽插槽的 `임시 · 창작 스킬` → `暫定 · 自訂技能`、
  ENIKK 不支援組合的 ` 미지원` → ` 不支援`。CSS 產生的字不在 DOM 文字節點裡,
  只用 grep TS 檔是掃不到的。

### 順手修掉的一個真 bug(不是翻譯)
`custom-nikke.ts` 的 `customToSettings()` 把自訂妮姬的預設魔方寫成舊通稱 `재장`。
魔方改用遊戲正式名稱之後 `settings.cubes` 裡**沒有這個鍵**,`ui.ts` 的
`LEGACY_CUBE_NAMES` 遷移又只在讀取舊存檔時跑,所以自訂妮姬拿到的是一顆不存在的魔方。
已改成 `렐릭 베어 큐브`(與 `context/spec.py` 的 `DEFAULT_CHAR` 一致)。
測試大量使用 `재장` 的假目錄查不到這件事 — 新加的迴歸測試改讀**實際的 `public/settings.json`**。

### 顯示名的通道(新增)
角色名原本只在 `ui.ts` 裡解析,以下地方本來還是韓文,現在都接上了:
- `timeline.ts`:`TimelineSeries.displayNames`,由 `createTimelineBlock(entry, portraits, displayNames)` 傳入。
  圖例、tooltip、施放者、受益者頭像都走 `this.label()`。
- `report.ts`:`ReportMeta.displayNames`,畫圖時經 `shownName(meta, name)`。
- `share-panel.ts`:`squadPreview(decks, imageOf, labelOf)` 第三參數(union-raid 由 `deps.labelOf` 供給)。
- `ui.ts`:偏離報告的 `[名字]` 經 `shownDeviations()` 換成顯示名。
- **排序**:角色清單的「名稱」排序改用 `displayName` + `zh-Hant` 定序。
  原本用韓文注音排,在英文/中文畫面上等於亂序。

### 搜尋(本次修的 bug)
`nikke-search.ts` 的索引原本只吃韓文 `name` 與別名 → **打 `rapi` 結果是 0**。
現在 `SearchIndex.keys` 同時含韓文正本名與 `displayName`(同權重),
`tags` 另外加入 `termZh()` 的中文分類標籤。
實測:`rapi`/`red hood`/`crown`/`alice`/`snow white`/`scarlet` 都中,
`ㄹㅍ`・`라피` 韓文照舊,`電擊`/`水冷`/`極樂淨土` 也查得到。
測試在 `nikke-search.test.ts` 的「화면 이름 검색」describe。

## 剩下的缺口 ⬜

1. **`렐릭 커버 큐브`(掩體體力)** — 唯一還會顯示韓文的地方,出現在角色設定面板的
   魔方下拉。使用者判斷「沒人用」而暫緩,不是漏掉。要補就在 `CUBE_ZH` 加一行即可
   (數值:7.26 / 10.91 / 14.54%;**效果說明句早就翻好了**,只差名字)。
   `runtime-assets.test.ts` 有一個 `pending` 允許清單放行它 — 補上名字後把它從清單移掉。
2. **繁中角色名** — 見下節。CDN 沒有中文,目前顯示官方英文。
3. **技能名**(`부착형 유탄 4` 等)— 依鐵則不翻,是資料值。
4. 偏離報告裡的**引擎鍵路徑**(`console.class_level.방어형`)— 資料鍵,不翻。

### 魔方名稱(已完成,記錄來源)
17 個魔方的中文名與 17 條效果說明句都在 `site/src/i18n-terms.ts`
(`CUBE_ZH` / `CUBE_TEMPLATE_ZH` + `cubeZh()` / `cubeTemplateZh()`)。

- **來源**:NGA 的資料整理帖(中國服簡體表記),由使用者(玩家)指定採用,轉為繁體。
  `분배` 依使用者的說法採 **分攤**(社群慣用),`stat-names.ts` 的
  `split_damage` / `split_dmg_pct` 也一併從「分裂」改為「分攤」對齊。
- **配對方式**:不是靠名字猜,是拿該帖列出的效果數值去對 `settings.json` 每個魔方的
  `effect`(如 命中率 2.54/3.81/5.08 ↔ `렐릭 어설트 큐브` accuracy_pct),17 個全部對上。
- **效果說明句在 TS 裡翻,不動 `cube.json`** — 那是抓下來的遊戲資料,改了會被下次
  scrape 覆蓋。`cubeTemplateZh()` 以原文為鍵替換,`{0}` 留給畫面填數值。
- **護欄**:`runtime-assets.test.ts` 會比對字典與實際資料 —
  漏翻的魔方名、字典裡的錯字、沒翻到的效果句都會讓測試紅燈。
  資料更新後魔方改名時,這個測試會擋下「悄悄變回韓文」。

## 繁中角色名:CDN 調查結果(已查過,不必再試)
`scraper/fetch_zh_names.py --probe` 在本機跑過(雲端環境擋掉該網域,本機沒有限制)。
`sg-tools-cdn.blablalink.com` 的 `/roledata/{rid}-v2-{locale}.json` **只有 `en` / `ko` / `ja`**;
`zh-TW`/`zh-CN`/`zh-Hant`/`zh-Hans`/`cht`/`chs`/`zh`/`tw`/`tc`/`zh_TW`/`hk` 全部 404。
→ 官方繁中角色名**無法從這個 CDN 取得**。要嘛換來源,要嘛由玩家人工整理一份
`data/i18n/names.zh-TW.json`,再讓 `sync-runtime` 優先讀它(現有英文橋樑的結構可直接沿用)。

## 鐵則(務必遵守)
1. **只翻「顯示的字」,不翻「識別鍵/資料值」**。不可碰:
   - 下拉 `value="풍압"` 等 enum 值、`NO_CUBE='없음'`、`DEFAULT_SQUAD` 韓文名、
     裝備部位鍵 `머리/몸통/팔/다리`(**標籤**已中文化,鍵沒動)、
     element→icon map(`작열:'fire'`)、`custom-nikke` schema 裡的 enum 與英文 key、
     技能名(`skill.name`)、Let's Doro CSV 的韓文欄位名、
     blablalink API 的 `'X-Language': 'ko'`。
2. 顯示角色名一律用 `displayName ?? name` 或 `resolveDisplayName(name)`,**絕不改 name 本身**。
   純函式(`timeline`/`report`/`share-panel`)靠參數把對照表傳進去,不要 import `ui.ts`(會循環)。
3. 用詞照 `docs/hanhua-glossary.md`。
4. **`context/baseline/*.json` 依賴 `spec.py` 的 `_fmt`/`char_deviations` 輸出字串** —
   要翻那一層就得重產 29 個基準線,而基準線正是回歸的護欄,別為了美觀動它。
5. **改完必跑測試**:很多測試寫死韓文斷言,翻譯後要同步改測試的預期值(這是正常的,不是弄壞測試)。

## 怎麼再掃一次殘留韓文
grep 只會撈出一堆識別值(`풍압`、`머리`、CSV 欄名…),分不出「顯示的字」和「資料值」。
有效的做法是**把畫面掛起來看**:寫一支暫時的 jsdom 測試,用 `public/catalog.json` +
`public/settings.json`(不是測試假資料)`mountCalculator()`,再把所有 `button` / `summary`
點過幾輪、`details` 全開,然後走訪 DOM 的**文字節點與 `title`/`aria-label`/`placeholder`**,
撈出含韓文又不是角色名的字。`renderCharacterSettings()` 要另外掛一次
(記得先打開 `[data-custom-toggle]`,魔方與超載欄位才會出現)。掃完把那支測試刪掉。
CSS 的 `content:` 不在 DOM 裡,要另外 grep `styles.css`。

## 開發/驗證流程(在 `site/` 目錄)
```bash
cd site
npm ci                      # 第一次
npm test -- --run           # 419 個前端測試
npx tsc --noEmit            # 型別檢查
npm run sync-runtime        # 改了 calculator/ context/ data/ 之後必跑
npm run check-runtime
npm run build
```
引擎側(在專案根目錄):
```bash
python3 -m unittest discover -s calculator -p 'test_*.py'   # 142 個
python3 calculator/damage.py
python3 -m context.doclint
python3 -m context.snapshot                                  # 29 個
python3 site/scripts/test-bridge.py                          # 34 個
```

## 提交慣例
- commit 訊息用中文,結尾兩行 trailer 照現有提交(`Co-Authored-By` + `Claude-Session`)。
- 開分支 → PR → 合併回 `master`。

## 上線
推上 `master` → GitHub Actions 自動 build 部署到 GitHub Pages
(`https://farly6966.github.io/nikke-calc-t1/`)。**合併前先問使用者。**
（Pages 需在該 fork 的 Settings → Pages 啟用。）

`site/vite.config.ts` 的 `base` 必須等於 repo 名(`/nikke-calc-t1/`)。
改 repo 名或再 fork 一次時要跟著改,否則 JS/CSS 會 404、頁面全白而 CI 仍是綠燈。
`site/index.html` 的 `og:url` / `og:image` 也是絕對網址,同樣要跟著 repo 名走。
