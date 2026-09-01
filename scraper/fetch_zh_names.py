#!/usr/bin/env python3
"""
fetch_zh_names.py — 從 blablalink CDN 抓「官方中文角色名」,產生漢化用對照表。

做什麼:
  對每個角色,抓中文 locale 的 roledata,取出官方中文名(name_localkey),
  用 resource_id 對回韓文名,輸出 data/i18n/names.zh-TW.json = { 韓文名: 中文名 }。

為什麼要你自己跑:
  這支要連 blablalink 的 CDN(sg-tools-cdn.blablalink.com)。開發用的雲端
  環境擋掉了那個網域,但你自己的電腦沒有這個限制,直接跑就行。

怎麼跑(在專案根目錄):
  python3 scraper/fetch_zh_names.py            # 自動偵測中文 locale 並抓取
  python3 scraper/fetch_zh_names.py --locale zh-TW   # 指定 locale
  python3 scraper/fetch_zh_names.py --probe     # 只偵測 CDN 有哪些 locale,不抓取

只用 Python 標準函式庫,不必安裝任何套件。
抓完把產生的 data/i18n/names.zh-TW.json 一起 commit,我再接到畫面上。
"""

import argparse
import json
import sys
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import cdn_path  # noqa: E402

ROOT = Path(__file__).parent.parent
SCRAPED = ROOT / "scraper" / "nikke_scraped.json"
OUT_DIR = ROOT / "data" / "i18n"

ROLEDATA_PATH = "/roledata/{rid}-v2-{locale}.json"

# CDN 可能用的中文 locale 代碼(不確定哪個對,所以逐一試)。
LOCALE_CANDIDATES = ["zh-TW", "zh-CN", "zh-Hant", "zh-Hans", "cht", "chs", "zh", "tw", "tc"]

TIMEOUT = 25
CONCURRENCY = 12


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


def roledata_url(rid, locale):
    return cdn_path.url(ROLEDATA_PATH.format(rid=rid, locale=locale))


def load_name_to_id():
    data = json.loads(SCRAPED.read_text(encoding="utf-8"))
    # {韓文名: resource_id}
    return {name: entry["id"] for name, entry in data.items() if "id" in entry}


def probe_locale(sample_rid):
    """回傳第一個可用的中文 locale 代碼,找不到回 None。"""
    print(f"偵測中文 locale(以 rid={sample_rid} 測試)…")
    for loc in LOCALE_CANDIDATES:
        try:
            data = fetch_json(roledata_url(sample_rid, loc))
            name = data.get("name_localkey", "")
            print(f"  {loc:8} OK   name={name!r}")
            return loc
        except urllib.error.HTTPError as e:
            print(f"  {loc:8} HTTP {e.code}")
        except Exception as e:  # noqa: BLE001
            print(f"  {loc:8} 失敗 {type(e).__name__}: {str(e)[:50]}")
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--locale", help="指定 locale 代碼(略過自動偵測)")
    ap.add_argument("--probe", action="store_true", help="只偵測 locale,不抓取")
    args = ap.parse_args()

    name_to_id = load_name_to_id()
    print(f"讀到 {len(name_to_id)} 個角色(來自 nikke_scraped.json)")

    sample_rid = next(iter(name_to_id.values()))
    locale = args.locale or probe_locale(sample_rid)
    if not locale:
        print("\n找不到可用的中文 locale。CDN 可能沒有中文版,或代碼不在候選清單裡。")
        print("可用 --locale <代碼> 手動指定再試。")
        sys.exit(1)
    print(f"\n使用 locale: {locale}")
    if args.probe:
        return

    id_to_name = {rid: name for name, rid in name_to_id.items()}
    result = {}
    failed = []

    def one(name, rid):
        try:
            data = fetch_json(roledata_url(rid, locale))
            zh = data.get("name_localkey", "").strip()
            return name, zh, None
        except Exception as e:  # noqa: BLE001
            return name, None, str(e)[:60]

    print(f"抓取 {len(name_to_id)} 個角色的中文名…")
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futs = [pool.submit(one, n, r) for n, r in name_to_id.items()]
        for i, fut in enumerate(as_completed(futs), 1):
            name, zh, err = fut.result()
            if err:
                failed.append((name, err))
            elif zh:
                result[name] = zh
            if i % 40 == 0:
                print(f"  …{i}/{len(name_to_id)}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"names.{locale}.json"
    out.write_text(
        json.dumps(dict(sorted(result.items())), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\n完成:{len(result)} 個中文名 → {out.relative_to(ROOT)}")
    if failed:
        print(f"有 {len(failed)} 個失敗:")
        for name, err in failed[:10]:
            print(f"  {name}: {err}")
    # 印幾個範例讓你確認抓對了
    print("範例:")
    for name in list(result)[:8]:
        print(f"  {name}  →  {result[name]}")


if __name__ == "__main__":
    main()
