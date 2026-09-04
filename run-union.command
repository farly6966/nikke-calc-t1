#!/usr/bin/env bash
# 按兩下就跑。exports/ 裡的匯出檔 → 排名表 → 自動打開。
#
# 隊伍要改的話,編輯下面的 SQUAD 那一行(逗號分隔)。
# 英文名、韓文正式名、社群別名都可以 — 打錯會列出最接近的幾個給你挑。
# 完整說明:docs/聯盟突襲比較-使用說明.md
set -euo pipefail
cd "$(dirname "$0")"

SQUAD="Rapi: Red Hood,Crown,Liter,Alice,Naga"
DURATION=180
ENEMY_CODE=""          # 풍압 · 수냉 · 작열 · 전격 · 철갑,留空=無屬性

PY=$(command -v python3 || command -v python || true)
[ -n "$PY" ] || { echo "找不到 python3。請先安裝 Python 3.13+。"; read -r -p "按 Enter 關閉"; exit 1; }

mkdir -p exports out
if ! ls exports/*.json >/dev/null 2>&1; then
  echo "exports/ 是空的 — 請先把匯出的 JSON 檔放進去,再按一次。"
  read -r -p "按 Enter 關閉"; exit 1
fi

echo "── 轉換 ──"
"$PY" scraper/profile_import.py exports/
echo
echo "── 計算 ──"
ARGS=(--squad "$SQUAD" --duration "$DURATION" --html out/report.html)
[ -n "$ENEMY_CODE" ] && ARGS+=(--enemy-code "$ENEMY_CODE")
"$PY" -m context.union_compare "${ARGS[@]}"

# 報告開起來。桌面環境不同,能開就開,開不了就把路徑印出來。
if command -v open >/dev/null 2>&1; then open out/report.html
elif command -v xdg-open >/dev/null 2>&1; then xdg-open out/report.html
else echo; echo "報告在 out/report.html — 用瀏覽器打開它。"; fi

read -r -p "按 Enter 關閉"
