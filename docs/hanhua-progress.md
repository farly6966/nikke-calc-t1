# 漢化進度與交接筆記

> 給接手的人(其他 Cowork session 或未來的自己)。搭配 `docs/hanhua-glossary.md`(術語表)一起看。

## 一句話現況
NIKKE 隊伍計算機的**繁體中文化**。`docs/hanhua-progress.md` 原本列的 L3 待辦**已全部翻完**;
跑完一次模擬後,畫面上找不到韓文字串,只剩下**引擎資料鍵本身**與**魔方名稱**(見「剩下的缺口」)。
角色名用**官方英文**顯示(CDN 沒有中文,見下方調查結果)。

- **倉庫 / 分支**:`farly6966/nikke-calc-t1`,主線 `master`
- **原版來源**:fork 自 `Moris-kr/nikke-calc`
- 部署 base 為 `/nikke-calc-t1/`

## 已完成 ✅

### L1 / L2(既有)
- **分類名**:屬性/職業/企業/爆裂階(`site/src/i18n-terms.ts`)
- **角色名(英文)**:`data/i18n/names.en.json`(韓→英,**200 角色**;
  本次補上 `드레이크 : 그레이트 빌런` → `Drake: Great Villain`)。
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

1. **魔方名稱**(唯一還會出現在畫面上的韓文)。
   `site/src/i18n-terms.ts` 已備好 `CUBE_ZH` 空表與 `cubeZh()`,顯示點(下拉選單與卡片摘要)
   都已接上,**只差填資料**。故意留空:官方繁中名要照抄遊戲內的《和諧魔方》清單,
   不能靠推測。17 個名字如下,填進 `CUBE_ZH` 即可:
   `렐릭 어설트 / 택티컬 어설트 / 렐릭 베어 / 택티컬 베어 / 렐릭 부스트 / 택티컬 부스트 /
   렐릭 퀀텀 / 렐릭 비고르 / 렐릭 인듀어 / 렐릭 힐링 / 렐릭 템퍼링 / 렐릭 어시스터 /
   렐릭 디스트로이 / 렐릭 피어싱 / 렐릭 크래시 / 렐릭 커버 / 렐릭 디바이드` 큐브
2. **魔方效果說明句**(`template`,如 `전투 시작 시 명중률 {0}% ▲`)來自
   `data/base_stat_tables/cube.json` 的遊戲資料,同樣需要官方繁中文案。
3. **技能名**(`부착형 유탄 4` 等)— 依鐵則不翻,是資料值。
4. 偏離報告裡的**引擎鍵路徑**(`console.class_level.방어형`)— 資料鍵,不翻。

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

## 開發/驗證流程(在 `site/` 目錄)
```bash
cd site
npm ci                      # 第一次
npm test -- --run           # 416 個前端測試
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
