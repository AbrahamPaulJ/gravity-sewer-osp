"""Saved-data checks for the common scenario input. Runs no SWMM."""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sim35_capacity as C
import sim4_sets as sets
from sim4_greenfield_eval import valid_rows


class ScenarioSets(unittest.TestCase):
    def setUp(self):
        self.source = C.read_js(os.path.join(C.ROOT, "simulation4/data/regions.js"))
        self.ch = C.chamber_names()
        self.tag = C.DESIGN

    def test_infill_identity(self):
        original = copy.deepcopy(self.source)
        result = sets.select_set(self.source, self.ch)
        self.assertIs(result, self.source)
        for tag, rows in result["rows"].items():
            for old, row in zip(original["rows"][tag], rows):
                self.assertEqual(row["f"], original["ladder"][row["s"]])
                self.assertEqual({k: v for k, v in row.items() if k != "f"}, old)
        self.assertEqual({k: v for k, v in result.items() if k != "rows"},
                         {k: v for k, v in original.items() if k != "rows"})

    def test_greenfield_conversion(self):
        reg = sets.select_set(self.source, self.ch, "greenfield")
        plan = json.loads((sets.GREENFIELD / "plan.json").read_text())
        summary = json.loads((sets.GREENFIELD / self.tag / "summary.json").read_text())
        raw_rows, _ = valid_rows(summary, self.tag)
        # A non-empty surcharge row checks bare numeric ids as well as rises.
        raw = next(x for x in raw_rows if x["surcharge"])
        ri = next(i for i, s in enumerate(plan["eligible"]) if s["site_id"] == raw["site"])
        site = plan["eligible"][ri]
        row = next(x for x in reg["rows"][self.tag] if x["r"] == ri and x["dw"] == raw["dwellings"])
        self.assertEqual(row["s"], sorted(site["steps"]).index(raw["dwellings"]))
        limit = site["headroom"] if site["headroom"] is not None else max(site["steps"])
        self.assertEqual(row["f"], raw["dwellings"] / limit)
        self.assertTrue(all(0 < x["f"] <= 1 for rows in reg["rows"].values() for x in rows))
        expected = [[self.ch.index("MH" + str(m)), v] for m, v in
                    sorted(raw["rise_mm"].items(), key=lambda kv: -kv[1]) if v > 0]
        self.assertEqual(row["rise"], expected)
        for field, source in (("sur", "surcharge"), ("spill", "spilled"), ("alarm", "alarm")):
            self.assertEqual(row[field], [self.ch.index("MH" + str(m)) for m in raw[source]])
        for field in ("pumps", "run"):
            self.assertEqual(row[field], raw[field])
        self.assertEqual(row["lps"], raw["added_lps"])
        self.assertEqual(len(reg["regions"]), 9)
        for unit, site in zip(reg["regions"], plan["eligible"]):
            self.assertEqual(unit["id"], "G:" + site["site_id"])
            self.assertEqual(unit["nominal"], max(site["steps"]))
            ms = [self.ch.index(site["site_id"])] if site["site_id"] in self.ch else []
            self.assertEqual(unit["manholes"], ms)
            self.assertEqual(unit["nManholes"], len(ms))
            self.assertEqual((unit["dwellings"], unit["lengthM"], unit["family"]), (0, 0, "greenfield"))
        for key in self.source.keys() - {"regions", "rows"}:
            self.assertIs(reg[key], self.source[key])

    def test_both_offsets(self):
        infill = sets.select_set(self.source, self.ch)
        green = sets.select_set(self.source, self.ch, "greenfield")
        both = sets.select_set(self.source, self.ch, "both")
        offset = len(infill["regions"])
        self.assertEqual(both["regions"], infill["regions"] + green["regions"])
        for tag in infill["rows"]:
            n = len(infill["rows"][tag])
            self.assertEqual(len(both["rows"][tag]), n + len(green["rows"][tag]))
            self.assertEqual(both["rows"][tag][:n], infill["rows"][tag])
            self.assertEqual(both["rows"][tag][n:], [dict(x, r=x["r"] + offset) for x in green["rows"][tag]])

    def test_next_size(self):
        for family in ("infill", "greenfield", "both"):
            reg = sets.select_set(copy.deepcopy(self.source), self.ch, family)
            for row in reg["rows"][self.tag]:
                unit = reg["regions"][row["r"]]
                steps = unit["steps"] if unit.get("family") == "greenfield" else reg["ladder"]
                limit = unit["limit"] if unit.get("family") == "greenfield" else 1
                s = row["s"] + 1
                self.assertEqual(sets.next_in_scope(reg, row), s < len(steps) and steps[s] <= limit)
                if row["s"] == len(steps) - 1:
                    self.assertFalse(sets.next_in_scope(reg, row))
                self.assertEqual(sets.size_value(reg, row), row["dw"] if unit.get("family") == "greenfield" else row["f"])

    def test_validity_and_chamber_names(self):
        # Use a saved row with named flags too, and reject failed baseline/growth.
        source = copy.deepcopy(self.source)
        source["cases"] = source["cases"][:1]
        tag = source["cases"][0]["tag"]
        summary = json.loads((sets.GREENFIELD / tag / "summary.json").read_text())
        good = copy.deepcopy(summary["rows"][0])
        good["surcharge"] = [self.ch[0]]
        bad = copy.deepcopy(good)
        bad["run"]["converged"] = False
        summary["rows"] = [good, bad]
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "plan.json").write_bytes((sets.GREENFIELD / "plan.json").read_bytes())
            (directory / tag).mkdir()
            path = directory / tag / "summary.json"
            path.write_text(json.dumps(summary))
            reg = sets.select_set(source, self.ch, "greenfield", directory)
            self.assertEqual(len(reg["rows"][tag]), 1)
            self.assertEqual(reg["rows"][tag][0]["sur"], [0])
            summary["baseline"]["run"]["converged"] = False
            path.write_text(json.dumps(summary))
            self.assertEqual(sets.select_set(source, self.ch, "greenfield", directory)["rows"][tag], [])

    def test_scenario_metadata_and_missing_previous_size(self):
        import sim35_mix as M
        for family in ("infill", "greenfield", "both"):
            reg = sets.select_set(copy.deepcopy(self.source), self.ch, family)
            with patch.multiple(M, reg=reg, nreg=len(reg["regions"])):
                for score in ("detect", "warn"):
                    for tag, scenarios in M.scenarios(score).items():
                        for sc in scenarios:
                            row = next(x for x in reg["rows"][tag] if (x["r"], x["s"]) == (sc["r"], sc["s"]))
                            self.assertEqual(sc["f"], row["f"])
                            self.assertEqual(sc["next_in_scope"], sets.next_in_scope(reg, row))
                warning = M.scenarios("warn")[self.tag][0]
                reg["rows"][self.tag] = [x for x in reg["rows"][self.tag]
                                         if (x["r"], x["s"]) != (warning["r"], warning["s"])]
                self.assertFalse(any(sc["r"] == warning["r"] for sc in M.scenarios("warn")[self.tag]))

    def test_set_switch_and_output_directory(self):
        code = ('import sim35_capacity as C; '
                'print(C.SCENARIO_SET, C.OUT.rsplit("/", 1)[-1], len(C.read_regions()["regions"]))')
        for target, family, expected in (("sim4", "infill", "infill sim4 9"),
                                         ("sim4", "greenfield", "greenfield sim4_set_greenfield 9"),
                                         ("sim4", "both", "both sim4_set_both 18"),
                                         ("sim35", "ignored", "infill sim35 8")):
            env = dict(os.environ, SIM35_TARGET=target, SIM4_SET=family)
            result = subprocess.check_output([sys.executable, "-c", code], cwd=Path(__file__).resolve().parent,
                                             env=env, text=True)
            self.assertEqual(result.strip(), expected)


if __name__ == "__main__":
    unittest.main()
