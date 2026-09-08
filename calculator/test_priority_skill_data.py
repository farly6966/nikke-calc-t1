"""원문 갱신 누락과 무기 모드 장탄 버프 회귀."""

import json
from pathlib import Path
import unittest
from unittest.mock import patch

from calculator.timeline import CharState, simulate
from context import spec

ROOT = Path(__file__).resolve().parents[1]
SHADOW = "홍련 : 흑영"
WAVE = "신데렐라 : 크리스탈 웨이브"


class PrioritySkillDataTest(unittest.TestCase):
    def test_shadow_values_match_raw_at_every_level(self):
        raw = json.loads((ROOT / "scraper/nikke_scraped.json").read_text(encoding="utf-8"))
        parsed = json.loads((ROOT / "data/parsed_skills.json").read_text(encoding="utf-8"))
        effects = {effect["name"]: effect for effect in parsed[SHADOW]}
        for effect, skill, column in (
            ("화무십일홍 · 파죽", "화무십일홍 · 파죽", 0),
            ("화무십일홍 · 파죽 2", "화무십일홍 · 파죽", 1),
            ("화무십일홍 · 파죽 3", "화무십일홍 · 파죽", 2),
            ("화무십일홍 · 만개 3", "화무십일홍 · 만개", 1),
        ):
            for level in map(str, range(1, 11)):
                with self.subTest(effect=effect, level=level):
                    self.assertEqual(effects[effect]["values"][level],
                                     float(raw[SHADOW]["스킬"][skill]["values"][level][column]))

    def test_wave_mode_refills_use_the_mode_base_and_ammo_buffs(self):
        # 고정 저격 모드의 장탄은 15발. 장비 장탄 +100%를 더하면 정확히 15발 증가해야 한다.
        # 실제 전투의 모드 진입·재장전 경로를 관찰하여 플래그 존재만 검사하지 않는다.
        observed = []
        original = CharState._full_ammo
        for ammo_pct in (0, 100):
            capacities = set()
            def capture(char, bm, t):
                full = original(char, bm, t)
                if char.name == WAVE and bm.get_weapon_change(WAVE) is not None:
                    capacities.add(full)
                return full
            chars = {WAVE: {
                "weapon_mode_swap": True,
                "equip_skills": {**spec.DEFAULT_CHAR["equip_skills"], "max_ammo_pct": ammo_pct},
            }}
            squad = spec.build_squad(["리틀 머메이드", "크라운", WAVE, "test_B3"], chars)
            with patch.object(CharState, "_full_ammo", capture):
                result = simulate(squad, config={"duration": 60, "rng_mode": "expected",
                                                "first_burst_time": 3})
            self.assertTrue(capacities, "저격 모드에 진입해야 한다")
            self.assertGreater(sum(hit.damage for hit in result.hits if hit.caster == WAVE), 0)
            observed.append(capacities)
        self.assertEqual({capacity + 15 for capacity in observed[0]}, observed[1])


if __name__ == "__main__":
    unittest.main()
