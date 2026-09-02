#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""사람이 친 이름 → 정식 명칭(한국어).

엔진은 캐릭터를 **한국어 정식 명칭**으로만 안다(`parsed_nikke.json`의 키). 그런데 러너를
손으로 부르는 사람은 화면에서 본 이름을 친다 — 영어 표기이거나, 커뮤니티 별칭이다.
`라피 : 레드 후드`를 한 글자도 안 틀리고 치라고 요구하면 한국어를 안 쓰는 사람에게는
사실상 못 쓰는 도구가 된다.

받는 것 (모두 대소문자·공백·구두점 무시)

    라피 : 레드 후드     정식 명칭
    라피                 별칭 (`context/ALIASES.md` §별칭 표)
    Rapi: Red Hood       영어 표기 (`data/i18n/names.en.json`)
    rapi red hood        구두점을 흘려도 통한다

겹칠 때 누가 이기는지는 `ALIASES.md §해석 규칙 2`가 정한다 — 맨이름(`라피`)은 원본이
파싱된 계열에서만 원본을 뜻하고, 원본이 미파싱이면 그 계열의 이격을 뜻한다. `_index()`에
그 규칙을 적어 뒀다.

못 찾으면 가까운 후보를 함께 돌려준다. 「그런 캐릭터 없음」만 던지면 사람은 자기가 뭘
잘못 쳤는지 알 길이 없다.
"""
from __future__ import annotations

import json
import re
import unicodedata
from difflib import get_close_matches
from functools import lru_cache
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ALIASES_MD = REPO / "context" / "ALIASES.md"
NAMES_EN = REPO / "data" / "i18n" / "names.en.json"
PARSED_NIKKE = REPO / "data" / "parsed_nikke.json"
PARSED_SKILLS = REPO / "data" / "parsed_skills.json"


def normalize(text: str) -> str:
    """맞대 볼 꼴. 대소문자·공백·구두점을 흘린다.

    `Rapi: Red Hood`·`rapi red hood`·`RapiRedHood`가 모두 같은 열쇠가 된다. 한글은
    NFC로 모아 둔다 — 자모가 풀린 문자열(맥 파일명 등)이 섞여도 같은 것으로 본다.
    """
    text = unicodedata.normalize("NFC", text)
    return re.sub(r"[\s:：·,，.\-_'\"()]+", "", text).lower()


def _alias_rows() -> dict[str, list[str]]:
    """`ALIASES.md` §별칭 표 → 정식 명칭 → 별칭들.

    별칭에는 `크메 (메스트와 함께)`처럼 괄호 주석이 붙는다 — 쓸 것은 괄호 앞이다.
    (`site/scripts/sync-runtime.mjs`가 같은 표를 같은 규칙으로 읽는다.)
    """
    if not ALIASES_MD.exists():
        return {}
    text = ALIASES_MD.read_text(encoding="utf-8")
    start = text.find("## 별칭 표")
    if start < 0:
        return {}
    end = text.find("\n## ", start + 1)
    section = text[start:] if end < 0 else text[start:end]
    out: dict[str, list[str]] = {}
    for line in section.split("\n"):
        row = re.match(r"^\|([^|]*)\|([^|]*)\|\s*$", line)
        if not row:
            continue
        name = row.group(1).strip()
        if not name or name == "정식 명칭" or re.fullmatch(r"-+", name):
            continue
        aliases = [piece.split("(")[0].strip() for piece in row.group(2).split(",")]
        aliases = [a for a in aliases if a]
        if aliases:
            out[name] = aliases
    return out


@lru_cache(maxsize=1)
def _index() -> tuple[dict[str, str], list[str]]:
    """(맞대 볼 열쇠 → 정식 명칭, 정식 명칭 목록).

    싣는 순서가 곧 우선순위다: 영어 → 별칭 → 정식 명칭.

    다만 정식 명칭이 언제나 이기는 것은 **아니다.** `ALIASES.md §해석 규칙 2`가 정한다 —
    맨이름은 «원본이 파싱된 계열»에서만 원본을 뜻하고, 원본이 미파싱이면 그 계열의
    이격을 뜻한다(`마스트` → `마스트 : 로망틱 메이드`). 그래서 정식 명칭은 **엔진이
    실제로 돌릴 수 있을 때만**(`parsed_skills.json`에 있을 때만) 덮어쓴다.

    지금은 원본이 전부 파싱돼 있어 두 방식의 결과가 같다. 그래도 규칙대로 적어 둔다 —
    미파싱 원본이 하나 들어오는 순간 «맨이름이 조용히 딴 캐릭터를 가리키는» 쪽으로
    갈리는데, 그때 이 자리를 다시 들여다볼 사람은 없다.
    """
    canonical = sorted(json.loads(PARSED_NIKKE.read_text(encoding="utf-8")))
    try:
        implemented = set(json.loads(PARSED_SKILLS.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        implemented = set(canonical)
    table: dict[str, str] = {}

    try:
        english = json.loads(NAMES_EN.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        english = {}
    for korean, shown in english.items():
        if korean in set(canonical) and isinstance(shown, str):
            table.setdefault(normalize(shown), korean)

    for korean, aliases in _alias_rows().items():
        for alias in aliases:
            table.setdefault(normalize(alias), korean)

    for name in canonical:
        if name in implemented:
            table[normalize(name)] = name      # 돌릴 수 있는 이름 — 무엇이든 덮는다
        else:
            table.setdefault(normalize(name), name)   # 별칭 쪽 해석을 남겨 둔다
    return table, canonical


class UnknownCharacter(ValueError):
    """못 알아본 이름. `suggestions`에 가까운 후보가 담긴다."""

    def __init__(self, typed: str, suggestions: list[str]):
        self.typed = typed
        self.suggestions = suggestions
        hint = f" 혹시 이것인가: {', '.join(suggestions)}" if suggestions else ""
        super().__init__(f"모르는 캐릭터: {typed!r}.{hint}")


def resolve(typed: str) -> str:
    """이름 하나 → 정식 명칭. 못 찾으면 `UnknownCharacter`."""
    table, canonical = _index()
    key = normalize(typed)
    if key in table:
        return table[key]
    near = get_close_matches(key, table.keys(), n=3, cutoff=0.72)
    return _fail(typed, [table[k] for k in near], canonical)


def _fail(typed: str, near: list[str], canonical: list[str]) -> str:
    seen, unique = set(), []
    for name in near:
        if name not in seen:
            seen.add(name)
            unique.append(name)
    if not unique:
        # 부분 문자열로도 한 번 훑는다 — 「red hood」처럼 일부만 친 경우를 건진다.
        key = normalize(typed)
        table, _ = _index()
        unique = list(dict.fromkeys(
            table[k] for k in table if len(key) >= 2 and key in k))[:3]
    raise UnknownCharacter(typed, unique)


def resolve_squad(typed: str | list[str]) -> list[str]:
    """쉼표로 구분한 줄(또는 목록) → 정식 명칭 목록.

    **한 명이라도 못 알아보면 끊는다.** 조용히 빼면 넷으로 돌린 결과가 다섯인 척한다.
    """
    names = ([n.strip() for n in typed.split(",")] if isinstance(typed, str) else
             [str(n).strip() for n in typed])
    return [resolve(name) for name in names if name]


def display(name: str) -> str:
    """정식 명칭 → 사람이 읽을 이름. 영어 표기가 있으면 그것, 없으면 그대로."""
    try:
        english = json.loads(NAMES_EN.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return name
    shown = english.get(name)
    return shown if isinstance(shown, str) and shown else name
