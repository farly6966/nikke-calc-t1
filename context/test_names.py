#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""`context/names.py` 시험.

실제 로스터(`data/parsed_nikke.json`·`ALIASES.md`·`names.en.json`)를 그대로 쓴다 —
이 해석기의 값어치는 «지금 이 데이터에서 맞느냐»이고, 대역으로는 그걸 못 잰다.
"""
from __future__ import annotations

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from context import names  # noqa: E402


class ResolveTest(unittest.TestCase):
    def test_accepts_canonical_alias_and_english(self):
        self.assertEqual(names.resolve("라피 : 레드 후드"), "라피 : 레드 후드")
        self.assertEqual(names.resolve("Rapi: Red Hood"), "라피 : 레드 후드")
        self.assertEqual(names.resolve("흑련"), "홍련 : 흑영")          # 별칭
        self.assertEqual(names.resolve("Crown"), "크라운")

    def test_ignores_case_spacing_and_punctuation(self):
        for typed in ("rapi red hood", "RAPIREDHOOD", "Rapi:Red  Hood", "rapi-red-hood"):
            self.assertEqual(names.resolve(typed), "라피 : 레드 후드", typed)
        self.assertEqual(names.resolve("라피:레드후드"), "라피 : 레드 후드")

    def test_bare_name_follows_the_aliases_rule_not_just_the_alias_table(self):
        """`ALIASES.md §해석 규칙 2` — 맨이름은 원본이 파싱된 계열에서만 원본을 뜻한다.

        별칭 표에는 `라피 : 레드 후드 | 라피`가 있지만, 원본 `라피`가 파싱돼 있으므로
        `라피`는 원본이다. 이 둘이 갈리는 지점이라 못으로 박아 둔다.
        """
        parsed = set(json.loads(names.PARSED_SKILLS.read_text(encoding="utf-8")))
        self.assertIn("라피", parsed, "이 시험의 전제가 깨졌다 — 원본 라피가 미파싱이다")
        self.assertEqual(names.resolve("라피"), "라피")
        self.assertEqual(names.resolve("네온"), "네온")

    def test_every_canonical_and_english_name_resolves_to_itself(self):
        """로스터 전원이 한국어로도 영어로도 불릴 수 있어야 한다."""
        english = json.loads(names.NAMES_EN.read_text(encoding="utf-8"))
        canonical = json.loads(names.PARSED_NIKKE.read_text(encoding="utf-8"))
        for korean in canonical:
            self.assertEqual(names.resolve(korean), korean)
        wrong = [(korean, shown, names.resolve(shown))
                 for korean, shown in english.items()
                 if korean in canonical and names.resolve(shown) != korean]
        self.assertEqual(wrong, [], "영어 표기가 딴 캐릭터로 붙는다")

    def test_unknown_name_carries_close_matches(self):
        with self.assertRaises(names.UnknownCharacter) as caught:
            names.resolve("Rapi Red")
        self.assertIn("라피 : 레드 후드", caught.exception.suggestions)

    def test_hopeless_name_still_fails_cleanly(self):
        with self.assertRaises(names.UnknownCharacter) as caught:
            names.resolve("zzzzzzzz")
        self.assertEqual(caught.exception.suggestions, [])

    def test_squad_resolves_in_order_and_stops_on_any_unknown(self):
        squad = names.resolve_squad("Rapi: Red Hood, Crown ,Liter,Alice,Naga")
        self.assertEqual(squad, ["라피 : 레드 후드", "크라운", "리타", "앨리스", "나가"])
        # 하나라도 모르면 끊는다 — 조용히 빼면 넷으로 돌린 결과가 다섯인 척한다.
        with self.assertRaises(names.UnknownCharacter):
            names.resolve_squad("Crown,Nobody At All,Liter")

    def test_resolved_squad_is_runnable_by_the_engine(self):
        """해석 결과가 엔진이 실제로 받는 이름인지. 여기까지 봐야 «맞다»고 할 수 있다."""
        from context import spec as char_spec
        squad = names.resolve_squad("Rapi: Red Hood,Crown,Liter,Alice,Naga")
        built = char_spec.build_squad(squad)
        self.assertEqual([c["name"] for c in built], squad)

    def test_display_gives_the_english_name_back(self):
        self.assertEqual(names.display("라피 : 레드 후드"), "Rapi: Red Hood")
        self.assertEqual(names.display("존재하지 않는 이름"), "존재하지 않는 이름")


if __name__ == "__main__":
    unittest.main()
