#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""유니온원 여럿을 **같은 덱·같은 보스**로 돌려 견준다.

`sim.py`가 한 사람의 한 덱을 재는 자리라면 여기는 «같은 덱을 여럿이 돌리면 누가 얼마나
내나»를 재는 자리다. 유니온 레이드에서 사람을 보스에 배정할 때 필요한 것이 이것이다.

프로필은 `profiles/<이름>.json`이고, `scraper/profile_fetch.py`(내 계정)나
`scraper/profile_import.py`(남이 건네준 파일)가 만든다.

미보유는 **기본적으로 기본 스펙으로 대체하고 그 사실을 표에 적는다.** 여기서 끊으면 서른
명 중 하나가 캐릭터 하나를 안 가졌다는 이유로 전체가 멈춘다 — 유니온 레이드에서는 «못
쓴다»는 것 자체가 알고 싶은 답이므로, 끊는 대신 몇 명을 대체했는지 나란히 보인다.

사용

    python -m context.union_compare --squad "리타,크라운,라피 : 레드 후드,앨리스,나가"
    python -m context.union_compare --squad "..." --duration 90 --enemy-code 전격
    python -m context.union_compare --squad "..." --html out/report.html
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

from calculator.timeline import simulate
from context import names as char_names
from context import spec as char_spec

PROFILE_DIR = Path("profiles")

GAP_LABEL = {
    "affinity": "호감도",
    "equipment": "장비 강화",
    "console": "콘솔",
    "synchro": "싱크로",
}


def _profiles(only: list[str] | None) -> list[str]:
    if not PROFILE_DIR.exists():
        raise SystemExit(f"{PROFILE_DIR}/가 없다. `python scraper/profile_import.py exports/`를 먼저 돌린다.")
    have = sorted(p.stem for p in PROFILE_DIR.glob("*.json") if not p.name.endswith(".raw.json"))
    if not only:
        return have
    missing = [n for n in only if n not in have]
    if missing:
        raise SystemExit(f"없는 프로필: {missing}. 있는 것: {have}")
    return only


def run_one(name: str, squad_names: list[str], config: dict, enemy: dict,
            seed: int, level_mode: str = "sync") -> dict:
    """한 사람의 결과 한 줄. 프로필을 못 읽으면 그 사실을 담아 돌려준다(끊지 않는다).

    레벨 정책은 **`sync`가 기본**이다. 러너 공통 기본값은 `fixed`(400 고정)인데 그것은
    솔로레이드가 레벨을 고정하기 때문이고, 유니온 레이드는 고정하지 않는다 — 각자
    자기 싱크로 디바이스 레벨로 싸운다. 여기서 400으로 맞춰 버리면 유니온원 사이의
    **가장 큰 차이가 통째로 지워져** 「누가 얼마나 내나」라는 물음 자체가 무의미해진다.
    """
    try:
        profile = char_spec.load_profile(name, allow_unowned=True, level_mode=level_mode)
    except SystemExit as error:
        return {"name": name, "error": str(error)}
    squad = char_spec.build_squad(squad_names, profile=profile)
    result = simulate(squad, config=dict(config), enemy=dict(enemy) or None, seed=seed)
    meta = profile.meta or {}
    imported = meta.get("_imported") or {}
    return {
        "name": name,
        "total": result.squad_total,
        "per_char": dict(result.char_total),
        "synchro": (profile.account or {}).get("synchro_level"),
        "unowned": list(getattr(profile, "unowned", []) or []),
        "gaps": list(imported.get("gaps") or []),
        "roster": meta.get("roster"),
    }


def _rows(results: list[dict]) -> list[dict]:
    """순위·선두 대비 비율을 붙인다. 실패한 줄은 뒤로 보낸다."""
    ok = sorted([r for r in results if "error" not in r], key=lambda r: -r["total"])
    top = ok[0]["total"] if ok else 0
    for rank, row in enumerate(ok, 1):
        row["rank"] = rank
        row["share"] = (row["total"] / top * 100) if top else 0
    return ok + [r for r in results if "error" in r]


def _note(row: dict) -> str:
    """이 줄의 수치를 얼마나 믿어도 되는지 한 마디로."""
    parts = []
    if row.get("unowned"):
        parts.append(f"미보유 {len(row['unowned'])}명을 기본 스펙으로 대체")
    if row.get("gaps"):
        parts.append("추정: " + "·".join(GAP_LABEL.get(g, g) for g in row["gaps"]))
    return " · ".join(parts)


def render_text(rows: list[dict], squad: list[str], config: dict) -> str:
    out = [f"덱: {' / '.join(squad)}",
           f"조건: {config['duration']}초", ""]
    width = max((len(r["name"]) for r in rows), default=4)
    for row in rows:
        if "error" in row:
            out.append(f"  --  {row['name']:<{width}}  실패: {row['error'].splitlines()[0]}")
            continue
        note = _note(row)
        out.append(f"  {row['rank']:>2}  {row['name']:<{width}}  {row['total']:>18,.0f}"
                   f"  {row['share']:5.1f}%" + (f"   ({note})" if note else ""))
    return "\n".join(out)


def render_html(rows: list[dict], squad: list[str], config: dict, enemy: dict) -> str:
    """혼자 열어 보는 표 한 장. 파일 하나로 끝나야 주고받기 쉽다 — 밖을 부르지 않는다."""
    esc = html.escape
    head = (f"{config['duration']}초"
            + (f" · 적 {enemy['code']}" if enemy.get("code") else " · 무속성")
            + (f" · 코어 {enemy['core_px']}px" if enemy.get("core_px") else ""))
    body = []
    for row in rows:
        if "error" in row:
            body.append(f'<tr class="bad"><td></td><td>{esc(row["name"])}</td>'
                        f'<td colspan="3">{esc(row["error"].splitlines()[0])}</td></tr>')
            continue
        note = _note(row)
        body.append(
            f'<tr><td class="rank">{row["rank"]}</td><td>{esc(row["name"])}</td>'
            f'<td class="num">{row["total"]:,.0f}</td>'
            f'<td class="num">{row["share"]:.1f}%</td>'
            f'<td class="bar"><i style="width:{row["share"]:.1f}%"></i></td>'
            f'<td class="note">{esc(note)}</td></tr>')
    return f"""<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<title>聯盟突襲 · 同隊比較</title>
<style>
 :root {{ color-scheme: light dark; --line: #8883; --dim: #8889; --bar: #45d6d0; }}
 body {{ font: 14px/1.6 system-ui, sans-serif; margin: 0; padding: 32px; max-width: 1100px; }}
 h1 {{ font-size: 20px; margin: 0 0 4px; }}
 .sub {{ color: var(--dim); margin: 0 0 24px; }}
 .wrap {{ overflow-x: auto; }}
 table {{ border-collapse: collapse; width: 100%; }}
 th, td {{ padding: 8px 10px; border-bottom: 1px solid var(--line); text-align: left;
           white-space: nowrap; }}
 th {{ font-size: 12px; color: var(--dim); font-weight: 600; }}
 .num {{ text-align: right; font-variant-numeric: tabular-nums; }}
 .rank {{ color: var(--dim); text-align: right; width: 3em; }}
 .bar {{ width: 34%; min-width: 120px; }}
 .bar i {{ display: block; height: 8px; border-radius: 4px; background: var(--bar); }}
 .note {{ color: var(--dim); font-size: 12px; white-space: normal; }}
 .bad td {{ color: #e5534b; }}
 footer {{ color: var(--dim); font-size: 12px; margin-top: 24px; }}
</style></head><body>
<h1>聯盟突襲 · 同一套隊伍比較</h1>
<p class="sub">{esc(' / '.join(squad))}<br>{esc(head)}</p>
<div class="wrap"><table>
<thead><tr><th></th><th>成員</th><th class="num">總傷害</th><th class="num">對第一名</th>
<th>　</th><th>備註</th></tr></thead>
<tbody>{''.join(body)}</tbody></table></div>
<footer>備註欄的「推估」表示那個欄位不在匯出檔裡,用預設值計算 —
數字會偏低或偏高,相對排名仍可參考。</footer>
</body></html>"""


def main() -> None:
    parser = argparse.ArgumentParser(
        description="여러 프로필을 같은 덱으로 돌려 견준다",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    parser.add_argument("--squad", required=True,
                        help="쉼표로 구분한 다섯 이름. 정식 명칭·별칭·영어 표기 아무거나 "
                             "된다 (Rapi: Red Hood · 라피 : 레드 후드 · 흑련)")
    parser.add_argument("--profiles", help="쉼표로 구분한 프로필 이름 (기본: profiles/ 전부)")
    parser.add_argument("--duration", type=int, default=90, help="전투 길이(초). 기본 90")
    parser.add_argument("--enemy-code", default="", help="적 속성 (풍압·수냉·작열·전격·철갑)")
    parser.add_argument("--enemy-def", type=int,
                        help="적 방어력. 안 주면 계산기 기본값(31,784)을 쓴다 — 0을 주는 것과 다르다")
    parser.add_argument("--core-px", type=int, help="코어 크기(px). 안 주면 코어 없음")
    parser.add_argument("--parts", action="store_true", help="파츠가 있는 보스로 본다")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument(
        "--level", choices=char_spec.LEVEL_MODES, default="sync",
        help="캐릭터 레벨을 무엇으로 볼지. sync(기본) = 각자의 싱크로 디바이스 레벨 — "
             "유니온 레이드는 레벨을 고정하지 않는다. fixed = 400 고정(솔로레이드 기준)")
    parser.add_argument("--html", help="이 경로에 표 한 장을 쓴다 (예: out/report.html)")
    parser.add_argument("--json", dest="json_out", help="이 경로에 원자료를 쓴다")
    args = parser.parse_args()

    # 화면에서 본 이름을 그대로 쳐도 되게 한다 — 한국어 정식 명칭을 한 글자도 안 틀리고
    # 치라고 요구하면 한국어를 안 쓰는 사람에게는 사실상 못 쓰는 도구가 된다.
    try:
        squad = char_names.resolve_squad(args.squad)
    except char_names.UnknownCharacter as error:
        hint = ("\n  가까운 이름: " + ", ".join(
            f"{n} ({char_names.display(n)})" for n in error.suggestions)
        ) if error.suggestions else ""
        raise SystemExit(
            f"--squad에 모르는 이름이 있다: {error.typed!r}{hint}\n"
            f"  이름 목록은 context/ALIASES.md. 영어 표기·별칭도 그대로 쓸 수 있다."
        ) from error
    if not squad:
        raise SystemExit("--squad가 비어 있다")
    names = _profiles([n.strip() for n in args.profiles.split(",")] if args.profiles else None)
    if not names:
        raise SystemExit(f"{PROFILE_DIR}/에 프로필이 없다.")

    config = {"duration": args.duration}
    # 준 것만 싣는다(`sim.py`와 같다). 빈 값을 넣으면 «무속성 지정»과 «안 정함»이 섞인다.
    enemy: dict = {}
    if args.enemy_def is not None:      # 0도 뜻이 있다 — «방어력 없음»이다
        enemy["def"] = args.enemy_def
    if args.enemy_code:
        enemy["code"] = args.enemy_code
    if args.core_px:
        enemy["core_px"] = args.core_px
    if args.parts:
        enemy["has_parts"] = True

    # 덱 줄은 `render_text`가 결과와 함께 다시 적는다 — 여기서는 «무엇을 몇 벌 도는가»만.
    shown_squad = [char_names.display(n) for n in squad]
    level_note = "각자 싱크로 레벨" if args.level == "sync" else "레벨 400 고정"
    print(f"프로필 {len(names)}벌 · {args.duration}초 · {level_note}\n")
    # 진행 표시는 **터미널일 때만.** 파이프·로그로 흘리면 커서 제어 문자가 글자로 남아
    # («[K[K») 사람은 그걸 고장으로 읽는다.
    live = sys.stderr.isatty()
    results = []
    for index, name in enumerate(names, 1):
        if live:
            print(f"  [{index}/{len(names)}] {name}\033[K", end="\r",
                  file=sys.stderr, flush=True)
        results.append(run_one(name, squad, config, enemy, args.seed, args.level))
    if live:
        print("\033[K", end="\r", file=sys.stderr, flush=True)

    rows = _rows(results)
    print(render_text(rows, shown_squad, config))

    if args.html:
        Path(args.html).parent.mkdir(parents=True, exist_ok=True)
        Path(args.html).write_text(
            render_html(rows, shown_squad, config, enemy), encoding="utf-8")
        print(f"\n[+] {args.html}")
    if args.json_out:
        Path(args.json_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_out).write_text(
            json.dumps({"squad": squad, "config": config, "enemy": enemy, "rows": rows},
                       ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[+] {args.json_out}")


if __name__ == "__main__":
    main()
