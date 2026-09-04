@echo off
REM 按兩下就跑。exports\ 裡的匯出檔 -> 排名表 -> 自動打開。
REM 隊伍要改的話,編輯下面的 SQUAD 那一行(逗號分隔)。
REM 英文名、韓文正式名、社群別名都可以。說明:docs\聯盟突襲比較-使用說明.md
setlocal
cd /d "%~dp0"

set "SQUAD=Rapi: Red Hood,Crown,Liter,Alice,Naga"
set "DURATION=180"
set "ENEMY_CODE="

where python >nul 2>&1 || (echo 找不到 python。請先安裝 Python 3.13+。& pause & exit /b 1)

if not exist exports mkdir exports
if not exist out mkdir out
if not exist exports\*.json (
  echo exports\ 是空的 — 請先把匯出的 JSON 檔放進去,再按一次。
  pause & exit /b 1
)

echo -- 轉換 --
python scraper\profile_import.py exports\ || (pause & exit /b 1)
echo.
echo -- 計算 --
if "%ENEMY_CODE%"=="" (
  python -m context.union_compare --squad "%SQUAD%" --duration %DURATION% --html out\report.html
) else (
  python -m context.union_compare --squad "%SQUAD%" --duration %DURATION% --enemy-code "%ENEMY_CODE%" --html out\report.html
)
if errorlevel 1 (pause & exit /b 1)

start "" out\report.html
pause
