#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""제3자 도구가 뽑은 계정 내보내기 → `profiles/<이름>.json`.

`profile_fetch.py`는 **내 계정**을 블라블라링크에서 직접 받아 온다. 이쪽은 **남이 건네준
파일**을 받는다 — 유니온원 서른 명의 스펙을 한 덱에 견주려면 서른 명분의 로그인이
필요한데 그건 받을 수도 없고 받아서도 안 되기 때문이다. 사람이 각자 자기 도구로 뽑은
파일을 주고, 여기서 계산기가 아는 모양으로 옮긴다.

입력 형식 (관측: 2026-09-02)

    {
      "name": "...", "synchroLevel": 801,
      "researchLevels": {"general": 372, "attacker": 145, ...},
      "elements": {"Electronic": [ {캐릭터}, ... ], "Fire": [...], ...}
    }

    캐릭터: name_code · limit_break{grade,core} · skill1_level · skill2_level ·
            skill_burst_level · item_rare · item_level ·
            equipments{"0".."3": [{function_type, function_value}]}

**모자란 것이 있어도 끊지 않는다.** 이 형식은 도구 쪽에서 자라는 중이라, 다 갖춰질 때까지
기다리면 아무것도 못 돌린다. 없는 값은 기본값으로 채우고 **무엇을 채웠는지 `_imported`에
남긴다** — 러너가 그걸 결과와 함께 보여 주므로, 그 숫자를 얼마나 믿어도 되는지가 늘 눈에
보인다. 도구가 필드를 채워 오기 시작하면 경고가 저절로 사라진다.

읽지 않는 것

    `cookie`·`game_uid` 같은 계정 접근권은 **쳐다보지도 않는다.** 계산에 필요 없고,
    옮겨 적으면 그 순간부터 이쪽이 그것을 흘릴 수 있는 자리가 된다.

사용

    python scraper/profile_import.py exports/            # 폴더 전체
    python scraper/profile_import.py exports/A.json      # 파일 하나
    python scraper/profile_import.py exports/ --affinity 30
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scraper.profile_fetch import (  # noqa: E402  (경로를 먼저 세워야 한다)
    EQUIP_KEYS, FUNC_TO_EQUIP, NO_ITEM, PER_LINE_KEYS,
)

PROFILE_DIR = "profiles"
NAME_CODES = os.path.join("data", "name_codes.json")

# 내보내기의 장비 칸 번호 → 계산기 부위. **도구 쪽 확인 완료(2026-09-02)**: 인게임 표시
# 순서 그대로 0·1·2·3 = 머리·몸통·팔·다리다. 추측이 아니다 — 어긋나면 부위별 장비 등급이
# 통째로 뒤바뀌는데 합계는 그럴듯하게 나와 조용히 틀린다.
SLOT_TO_PART = {"0": "머리", "1": "몸통", "2": "팔", "3": "다리"}

# 도구가 부위를 이름으로 싣는 형식(2026-08 이후 관측). 같은 순서를 영문 키로 적은 것뿐이다.
NAMED_SLOT_TO_PART = {"head": "머리", "torso": "몸통", "arm": "팔", "leg": "다리"}


def _slot_table(char: dict) -> dict:
    """이 파일이 부위를 번호로 부르는가 이름으로 부르는가. **키를 보고 정한다** —
    내보내기에 판본 표시가 없고, 유니온원마다 도구 판본이 다르기 때문이다."""
    equipments = char.get("equipments") or {}
    if any(k in equipments for k in NAMED_SLOT_TO_PART):
        return NAMED_SLOT_TO_PART
    return SLOT_TO_PART

# 재활용 연구실(계산기의 «콘솔») 영문 키 → 계산기 필드·소속.
# `profile_fetch.CONSOLE_TIDS`와 같은 표를 영문 이름으로 적은 것이다.
RESEARCH_TO_CONSOLE = {
    "general": ("common_level", ""),
    "attacker": ("class_level", "화력형"),
    "defender": ("class_level", "방어형"),
    "supporter": ("class_level", "지원형"),
    "elysion": ("company_level", "엘리시온"),
    "missilis": ("company_level", "미실리스"),
    "tetra": ("company_level", "테트라"),
    "pilgrim": ("company_level", "필그림"),
    "abnormal": ("company_level", "어브노말"),
}

# 영문 연구실 키 → 게임 내부 tid. 새 형식이 tid를 키로 싣기 때문에 되돌릴 표가 필요하다.
RESEARCH_NAME_TO_TID = {
    "general": 1001,
    "attacker": 1101, "defender": 1102, "supporter": 1103,
    "elysion": 1201, "missilis": 1202, "tetra": 1203, "pilgrim": 1204, "abnormal": 1205,
}

# 호감도 표(`data/base_stat_tables/affinity.json`)는 1~40이고 1이 가산 0이다.
AFFINITY_MIN, AFFINITY_MAX = 1, 40
# 일반 장비 T1~T9, 10부터가 기업 장비(강화 0~5).
CORP_TIER = 10
CORP_LEVEL_MAX = 5


def _slot_lines(slot: object) -> list[dict]:
    """장비 칸 하나의 오버로드 줄들.

    지금 형식은 줄 배열이고, 도구가 티어·강화를 함께 싣기 시작하면 `{"options": [...]}`
    꼴이 될 수 있다. 양쪽 다 받는다 — 형식이 바뀌어도 이 파일만 고치면 된다.
    """
    raw = slot if isinstance(slot, list) else         (slot.get("options") or []) if isinstance(slot, dict) else []
    # 새 형식은 «줄의 배열»의 배열이다(칸 하나에 줄 하나). 한 겹 더 펴서 둘 다 받는다.
    out = []
    for entry in raw:
        for line in (entry if isinstance(entry, list) else [entry]):
            if isinstance(line, dict):
                out.append(line)
    return out


def _slot_value(char: dict, slot_key: str, field: str, *nested: str) -> object:
    """티어·강화 값. 캐릭터 옆의 표(`equipTiers`)에도, 칸 안(`{"tier": …}`)에도 둘 수 있다.

    칸 안의 이름은 판본마다 다르다(강화는 `lv`이기도 `level`이기도 하다). 후보를
    순서대로 본다 — 하나만 보다가 못 찾으면 «강화 0»으로 접혀 조용히 과소평가된다.
    """
    table = char.get(field)
    if isinstance(table, dict) and slot_key in table:
        return table[slot_key]
    slot = (char.get("equipments") or {}).get(slot_key)
    if isinstance(slot, dict):
        for key in nested:
            if key in slot:
                return slot[key]
    return None


def _as_int(value: object) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _equipment(char: dict, slot_key: str, lines: list[dict], gaps: set[str]) -> dict:
    """장비 한 부위 → 계산기 `equipment` 항목.

    티어를 실어 주면 그대로 쓴다. 없으면 **오버로드 줄이 붙어 있다 = 기업 장비**로 본다 —
    오버로드 옵션은 기업 장비에만 붙기 때문이다. 강화 단계(0~5)는 알 수 없어 0으로 두고,
    그 사실을 `gaps`에 남긴다. 0은 «가장 낮은 장착 상태»라 과대평가가 아니라 과소평가다.
    """
    tier = _as_int(_slot_value(char, slot_key, "equipTiers", "tier"))
    level = _as_int(_slot_value(char, slot_key, "equipLevels", "lv", "level"))
    if tier is None:
        if not lines:
            return {"tier": NO_ITEM}
        gaps.add("equipment")
        return {"level": 0}
    if tier >= CORP_TIER:
        if level is None:
            gaps.add("equipment")
            level = 0
        return {"level": max(0, min(CORP_LEVEL_MAX, level))}
    if tier >= 1:
        return {"tier": f"T{min(9, tier)}"}
    return {"tier": NO_ITEM}


def _collection(char: dict) -> tuple[str, int | None]:
    """소장품 단계와 애장품 단계.

    `item_rare` R·SR는 소장품(`R0`~`SR15`), SSR는 애장품이고 `item_level`이 그 단계다.
    둘은 한 칸을 나눠 쓰므로 한쪽만 온다.
    """
    rare = str(char.get("item_rare") or "")
    level = _as_int(char.get("item_level")) or 0
    if rare in ("R", "SR"):
        return f"{rare}{level}", None
    if rare == "SSR":
        # 애장품은 SR15와 스탯이 같으므로 등급은 SR15로 적고 단계만 따로 넘긴다.
        # `item_level` 0/1/2 = 단계 1/2/3이다 — `profile_fetch._collection`과 같은 규칙이다.
        # 예전에는 여기서 미장착으로 적고 단계도 한 칸 낮았다(SR15 스탯이 통째로 빠졌다).
        return "SR15", level + 1
    return NO_ITEM, None


def _researches(src: dict) -> dict:
    """회수실 등급 → {영문 키: 등급}. 형식 둘 다 받는다.

        새  {"recycleRoomResearches": {"1001": {"Level": 366}, ...}}   ← 게임 내부 tid
        옛  {"researchLevels": {"general": 372, ...}}                  ← 영문 이름

    tid의 뜻은 `profile_fetch.CONSOLE_TIDS`가 정본이고 여기서는 영문 키로 되돌린다.
    """
    modern = src.get("recycleRoomResearches")
    if isinstance(modern, dict) and modern:
        by_tid = {tid: key for key, tid in RESEARCH_NAME_TO_TID.items()}
        out = {}
        for raw_tid, value in modern.items():
            tid = _as_int(raw_tid)
            key = by_tid.get(tid) if tid is not None else None
            if key is None:
                continue
            level = value.get("Level", value.get("level")) if isinstance(value, dict) else value
            out[key] = _as_int(level) or 0
        if out:
            return out
    legacy = src.get("researchLevels")
    return legacy if isinstance(legacy, dict) else {}


def _observed_cubes(chars: list) -> dict:
    """장착 중인 큐브에서 관찰된 {큐브명: 최고 레벨}. 보유분의 **하한**일 뿐이다.

    큐브는 프로필의 육성 항목이 아니다 — 자유롭게 갈아 끼우므로 케이스가 정하는 축이고,
    `profile_fetch`도 같은 이유로 `_account.cubes`에만 적는다. 러너는 이 값으로
    «요구 큐브 레벨이 실제 보유분보다 높다»를 알린다.
    """
    names = {}
    path = os.path.join("data", "base_stat_tables", "cube.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            table = json.load(f)
        names = {v["id"]: k for k, v in table.items() if isinstance(v, dict) and "id" in v}
    out: dict[str, int] = {}
    for char in chars:
        name = names.get(_as_int(char.get("cube_id")))
        if name:
            out[name] = max(out.get(name, 0), _as_int(char.get("cube_level")) or 0)
    return dict(sorted(out.items()))


def convert(src: dict, codes: dict[int, str], default_affinity: int = 30) -> tuple[dict, dict]:
    """내보내기 한 벌 → (프로필, 보고). 보고는 무엇을 채웠고 무엇을 못 읽었는지."""
    gaps: set[str] = set()
    unknown: list[str] = []
    entries: dict[str, dict] = {}

    for char in [c for group in (src.get("elements") or {}).values() for c in group]:
        code = _as_int(char.get("name_code"))
        name = codes.get(code) if code is not None else None
        if name is None:
            unknown.append(f"{code} ({char.get('name_en') or char.get('name_cn') or '?'})")
            continue

        equipment: dict[str, dict] = {}
        skills: dict[str, object] = {k: ([] if k in PER_LINE_KEYS else 0.0) for k in EQUIP_KEYS}
        for slot_key, part in _slot_table(char).items():
            lines = _slot_lines((char.get("equipments") or {}).get(slot_key))
            equipment[part] = _equipment(char, slot_key, lines, gaps)
            for line in lines:
                key = FUNC_TO_EQUIP.get(str(line.get("function_type")))
                if key is None:
                    unknown.append(f"오버로드 옵션 {line.get('function_type')}")
                    continue
                value = round(float(line.get("function_value") or 0), 4)
                if key in PER_LINE_KEYS:
                    skills[key].append(value)  # type: ignore[union-attr]
                else:
                    skills[key] = round(float(skills[key]) + value, 4)
        for key in PER_LINE_KEYS:
            skills[key].sort(reverse=True)  # type: ignore[union-attr]

        affinity = _as_int(char.get("affinity"))
        if affinity is None:
            affinity = _as_int(char.get("attractive_lv"))
        if affinity is None:
            gaps.add("affinity")
            affinity = default_affinity
        stage, favorite = _collection(char)

        entry = {
            "breakthrough": _as_int((char.get("limit_break") or {}).get("grade")) or 0,
            "core_enhancement": _as_int((char.get("limit_break") or {}).get("core")) or 0,
            "affinity": max(AFFINITY_MIN, min(AFFINITY_MAX, affinity)),
            "skill_levels": {
                "1": _as_int(char.get("skill1_level")) or 1,
                "2": _as_int(char.get("skill2_level")) or 1,
                "3": _as_int(char.get("skill_burst_level")) or 1,
            },
            "equipment": equipment,
            "equip_skills": skills,
            "collection_stage": stage,
        }
        if favorite is not None:
            entry["favorite_stage"] = favorite
        entries[name] = entry

    console: dict = {"common_level": 0, "class_level": {}, "company_level": {}}
    research = _researches(src)
    for key, value in research.items():
        mapped = RESEARCH_TO_CONSOLE.get(key)
        if mapped is None:
            unknown.append(f"연구실 {key}")
            continue
        field, who = mapped
        level = _as_int(value) or 0
        if who:
            console[field][who] = level
        else:
            console[field] = level
    missing_console = [k for k, _ in RESEARCH_TO_CONSOLE.values() if k not in console]
    if not research or missing_console:
        gaps.add("console")

    synchro = _as_int(src.get("synchroLevel"))
    if synchro is None:
        gaps.add("synchro")

    cubes = _observed_cubes([c for group in (src.get("elements") or {}).values()
                             for c in group])

    report = {"roster": len(entries), "gaps": sorted(gaps), "unknown": sorted(set(unknown))}
    profile = {
        "_meta": {
            "name": str(src.get("name") or "?"),
            "roster": len(entries),
            "source": "third-party export (scraper/profile_import.py)",
            # 이 프로필이 무엇을 추정했는지. 러너가 결과와 함께 그대로 보고한다 —
            # 추정이 섞인 수치를 실측처럼 읽는 일이 없어야 한다.
            "_imported": report,
        },
        "_account": {
            "synchro_level": synchro,
            "console": console,
            "console_warnings": [],
            "cubes": cubes,
        },
        "chars": dict(sorted(entries.items())),
    }
    return profile, report


def _safe_name(raw: str) -> str:
    """파일 이름으로 쓸 수 있는 꼴. 프로필 이름은 러너가 `--profile`로 받는 값이다."""
    keep = [c for c in raw.strip() if c.isalnum() or c in "-_"]
    return "".join(keep) or "unnamed"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="제3자 도구 내보내기 → profiles/<이름>.json",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    parser.add_argument("source", help="내보내기 파일 하나 또는 그것들이 든 폴더")
    parser.add_argument("--out", default=PROFILE_DIR, help=f"저장 위치 (기본 {PROFILE_DIR}/)")
    parser.add_argument("--affinity", type=int, default=30,
                        help="호감도가 없는 파일에 쓸 값 (기본 30). 표는 1~40이고 1이 가산 0이다")
    args = parser.parse_args()

    if os.path.isdir(args.source):
        paths = sorted(os.path.join(args.source, f) for f in os.listdir(args.source)
                       if f.endswith(".json"))
    else:
        paths = [args.source]
    if not paths:
        raise SystemExit(f"[!] {args.source}에 .json이 없다")

    with open(NAME_CODES, encoding="utf-8") as f:
        codes = {int(k): v for k, v in json.load(f).items()}

    os.makedirs(args.out, exist_ok=True)
    made, all_gaps, failed = [], set(), []
    for path in paths:
        # 한 파일이 깨졌다고 나머지를 멈추지 않는다. 서른 명분을 받으면 못 읽는 것이
        # 하나쯤 섞이는데(중간에 끊긴 다운로드, 다른 도구의 파일), 거기서 통째로
        # 끊기면 나머지 스물아홉 명도 못 본다. 못 읽은 것은 끝에 모아 알린다.
        try:
            with open(path, encoding="utf-8") as f:
                src = json.load(f)
            profile, report = convert(src, codes, args.affinity)
        except (OSError, ValueError, KeyError, TypeError) as error:
            failed.append((os.path.basename(path), str(error).splitlines()[0][:80]))
            continue
        name = _safe_name(profile["_meta"]["name"])
        target = os.path.join(args.out, f"{name}.json")
        with open(target, "w", encoding="utf-8") as f:
            json.dump(profile, f, ensure_ascii=False, indent=1)
        made.append((name, report))
        all_gaps |= set(report["gaps"])
        note = f" · 채운 값: {', '.join(report['gaps'])}" if report["gaps"] else ""
        print(f"[+] {target}  캐릭터 {report['roster']}{note}")
        for item in report["unknown"]:
            print(f"    ! 모르는 항목: {item}")

    for name, why in failed:
        print(f"[!] {name} — 읽지 못했다: {why}")
    if not made:
        raise SystemExit("[!] 읽을 수 있는 파일이 하나도 없다")

    print(f"\n[=] 프로필 {len(made)}벌"
          + (f" · 못 읽은 파일 {len(failed)}개" if failed else ""))
    if all_gaps:
        print(f"[!] 내보내기에 없어 추정한 값: {', '.join(sorted(all_gaps))}")
        print("    도구가 그 필드를 실어 주기 시작하면 이 줄은 저절로 사라진다.")


if __name__ == "__main__":
    main()
