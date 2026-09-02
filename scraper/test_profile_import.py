#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""`scraper/profile_import.py` 시험.

시제 자료는 **여기서 손으로 만든다.** 실제 내보내기는 남의 계정 자료이고 계정 접근권까지
들어 있어 저장소에 둘 수 없다.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from context import spec as char_spec  # noqa: E402
from scraper.profile_import import convert  # noqa: E402

# 실제 카탈로그에 있는 이름 셋. 대응이 깨지면 시험이 먼저 알려 준다.
CODES = {5129: "라피 : 레드 후드", 5169: "아니스 : 스타", 1021: "목단"}


def character(code: int, **over) -> dict:
    base = {
        "name_code": code,
        "name_en": "Someone",
        "skill1_level": 10, "skill2_level": 9, "skill_burst_level": 8,
        "item_rare": "SR", "item_level": 15,
        "limit_break": {"grade": 3, "core": 6},
        "equipments": {"0": [], "1": [], "2": [], "3": []},
    }
    base.update(over)
    return base


def export(chars: list[dict], **over) -> dict:
    base = {
        "name": "TESTER",
        "synchroLevel": 801,
        "researchLevels": {
            "general": 372, "attacker": 145, "defender": 128, "supporter": 127,
            "elysion": 131, "missilis": 129, "tetra": 128, "pilgrim": 169, "abnormal": 127,
        },
        "elements": {"Fire": chars},
    }
    base.update(over)
    return base


class ConvertTest(unittest.TestCase):
    def test_maps_name_code_growth_and_console(self):
        profile, report = convert(export([character(5129)]), CODES)
        self.assertEqual(report["roster"], 1)
        self.assertEqual(report["unknown"], [])
        entry = profile["chars"]["라피 : 레드 후드"]
        self.assertEqual(entry["breakthrough"], 3)
        self.assertEqual(entry["core_enhancement"], 6)
        self.assertEqual(entry["skill_levels"], {"1": 10, "2": 9, "3": 8})
        self.assertEqual(entry["collection_stage"], "SR15")
        self.assertEqual(profile["_account"]["synchro_level"], 801)
        self.assertEqual(profile["_account"]["console"]["common_level"], 372)
        self.assertEqual(profile["_account"]["console"]["class_level"]["화력형"], 145)
        self.assertEqual(profile["_account"]["console"]["company_level"]["엘리시온"], 131)

    def test_sums_overload_but_keeps_per_line_options_as_lines(self):
        # 최대 장탄·차지 속도는 단계마다 따로 반올림되므로 **줄별**로 남아야 한다.
        # 나머지는 합산 스칼라다 (profile_fetch._equip_skills와 같은 규칙).
        char = character(5129, equipments={
            "0": [{"function_type": "StatAtk", "function_value": 11.11},
                  {"function_type": "StatAmmoLoad", "function_value": 60.71}],
            "1": [{"function_type": "StatAtk", "function_value": 12.52},
                  {"function_type": "StatAmmoLoad", "function_value": 77.15}],
            "2": [], "3": [],
        })
        entry = convert(export([char]), CODES)[0]["chars"]["라피 : 레드 후드"]
        self.assertAlmostEqual(entry["equip_skills"]["atk_pct"], 23.63)
        self.assertEqual(entry["equip_skills"]["max_ammo_pct"], [77.15, 60.71])

    def test_affinity_is_used_when_given_and_flagged_when_not(self):
        with_value = convert(export([character(5129, affinity=22)]), CODES)
        self.assertEqual(with_value[0]["chars"]["라피 : 레드 후드"]["affinity"], 22)
        self.assertNotIn("affinity", with_value[1]["gaps"])

        without = convert(export([character(5129)]), CODES, default_affinity=30)
        self.assertEqual(without[0]["chars"]["라피 : 레드 후드"]["affinity"], 30)
        self.assertIn("affinity", without[1]["gaps"])

    def test_affinity_is_clamped_to_the_table(self):
        # `affinity.json`은 1~40이다. 표 밖의 값을 그대로 넘기면 엔진이 KeyError로 끊긴다.
        low = convert(export([character(5129, affinity=0)]), CODES)[0]
        high = convert(export([character(5129, affinity=99)]), CODES)[0]
        self.assertEqual(low["chars"]["라피 : 레드 후드"]["affinity"], 1)
        self.assertEqual(high["chars"]["라피 : 레드 후드"]["affinity"], 40)

    def test_equipment_tiers_are_used_when_given(self):
        char = character(5129,
                         equipTiers={"0": 10, "1": 9, "2": 0, "3": 10},
                         equipLevels={"0": 3, "1": 0, "2": 0, "3": 5},
                         equipments={"0": [{"function_type": "StatAtk", "function_value": 1}],
                                     "1": [], "2": [], "3": []})
        profile, report = convert(export([char]), CODES)
        equipment = profile["chars"]["라피 : 레드 후드"]["equipment"]
        self.assertEqual(equipment["머리"], {"level": 3})     # 기업 장비 강화 3
        self.assertEqual(equipment["몸통"], {"tier": "T9"})   # 일반 T9
        self.assertEqual(equipment["팔"], {"tier": "없음"})   # 미장착
        self.assertEqual(equipment["다리"], {"level": 5})
        self.assertNotIn("equipment", report["gaps"])

    def test_equipment_is_inferred_from_overload_lines_when_tiers_missing(self):
        # 오버로드 옵션은 기업 장비에만 붙는다 — 줄이 있으면 그 부위는 기업 장비다.
        # 강화 단계는 알 수 없어 0(가장 낮은 장착 상태)으로 두고 추정으로 표시한다.
        char = character(5129, equipments={
            "0": [{"function_type": "StatAtk", "function_value": 11.11}],
            "1": [], "2": [], "3": [],
        })
        profile, report = convert(export([char]), CODES)
        equipment = profile["chars"]["라피 : 레드 후드"]["equipment"]
        self.assertEqual(equipment["머리"], {"level": 0})
        self.assertEqual(equipment["몸통"], {"tier": "없음"})
        self.assertIn("equipment", report["gaps"])

    def test_reads_tier_and_level_from_inside_the_slot_too(self):
        # 도구가 칸 안에 실어 주는 꼴로 바뀌어도 받는다.
        char = character(5129, equipments={
            "0": {"tier": 10, "level": 4,
                  "options": [{"function_type": "StatAtk", "function_value": 5.0}]},
            "1": [], "2": [], "3": [],
        })
        profile, report = convert(export([char]), CODES)
        self.assertEqual(profile["chars"]["라피 : 레드 후드"]["equipment"]["머리"], {"level": 4})
        self.assertAlmostEqual(
            profile["chars"]["라피 : 레드 후드"]["equip_skills"]["atk_pct"], 5.0)
        self.assertNotIn("equipment", report["gaps"])

    def test_ssr_item_becomes_favorite_stage_not_a_collection(self):
        # 애장품(SSR)과 소장품(R·SR)은 한 칸을 나눠 쓴다 — 섞으면 없는 단계를 만든다.
        ssr = convert(export([character(5129, item_rare="SSR", item_level=2)]), CODES)[0]
        entry = ssr["chars"]["라피 : 레드 후드"]
        self.assertEqual(entry["favorite_stage"], 2)
        self.assertEqual(entry["collection_stage"], "없음")

        sr = convert(export([character(5129)]), CODES)[0]["chars"]["라피 : 레드 후드"]
        self.assertNotIn("favorite_stage", sr)

    def test_unknown_name_code_is_reported_not_fatal(self):
        profile, report = convert(export([character(5129), character(999_999)]), CODES)
        self.assertEqual(report["roster"], 1)
        self.assertEqual(len(report["unknown"]), 1)
        self.assertIn("999999", report["unknown"][0])

    def test_account_credentials_are_never_copied(self):
        # 내보내기에 로그인 쿠키가 딸려 온다. 계산에 필요 없으므로 **쳐다보지 않는다** —
        # 옮겨 적는 순간 이 파일이 그것을 흘릴 수 있는 자리가 된다.
        src = export([character(5129)], cookie="game_token=SECRET; game_uid=42",
                     game_uid="4344331436314217")
        profile, _ = convert(src, CODES)
        dumped = json.dumps(profile, ensure_ascii=False)
        self.assertNotIn("SECRET", dumped)
        self.assertNotIn("cookie", dumped)
        self.assertNotIn("4344331436314217", dumped)

    def test_missing_console_and_synchro_are_flagged(self):
        src = export([character(5129)])
        del src["researchLevels"]
        del src["synchroLevel"]
        _, report = convert(src, CODES)
        self.assertIn("console", report["gaps"])
        self.assertIn("synchro", report["gaps"])

    def test_output_satisfies_the_engine_profile_contract(self):
        """엔진이 실제로 읽어 들이는지. `load_profile`은 육성이 아닌 키를 거부한다."""
        chars = [character(code) for code in CODES]
        profile, _ = convert(export(chars), CODES)
        with tempfile.TemporaryDirectory() as tmp:
            original = char_spec.PROFILE_DIR
            char_spec.PROFILE_DIR = Path(tmp)
            try:
                (Path(tmp) / "t.json").write_text(
                    json.dumps(profile, ensure_ascii=False), encoding="utf-8")
                loaded = char_spec.load_profile("t")
                built = char_spec.build_squad(list(CODES.values()), profile=loaded)
            finally:
                char_spec.PROFILE_DIR = original
        self.assertEqual(len(built), len(CODES))
        self.assertEqual(built[0]["name"], "라피 : 레드 후드")


if __name__ == "__main__":
    unittest.main()
