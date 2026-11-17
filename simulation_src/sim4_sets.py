"""Adapt saved estate runs to the existing region algorithms. Runs no SWMM."""
import json
import re
from pathlib import Path

from sim4_greenfield_eval import name, valid_rows

GREENFIELD = Path(__file__).resolve().parent / "results/sim4/greenfield"


def steps_and_limit(reg, row):
    unit = reg["regions"][row["r"]]
    if unit.get("family") == "greenfield":
        return unit["steps"], unit["limit"]
    return reg["ladder"], 1.0


def next_in_scope(reg, row):
    """Whether this unit has a next planned size within its own limit."""
    steps, limit = steps_and_limit(reg, row)
    s = row["s"] + 1
    return s < len(steps) and steps[s] / limit <= 1.0


def size_value(reg, row, next_step=False):
    """Fraction for infill, homes for an estate (including the next size)."""
    steps, _ = steps_and_limit(reg, row)
    return steps[row["s"] + 1] if next_step else (
        row["dw"] if reg["regions"][row["r"]].get("family") == "greenfield" else row["f"])


def report_text(text, scenario_set):
    if scenario_set == "infill":
        return text
    text = re.sub(r"\bregions\b", "regions or estates", text)
    return text.replace("build-out", "build-out or estate size")


def select_set(reg, chambers, scenario_set="infill", directory=GREENFIELD):
    """Return the original infill object, or a shallow copy with estate units/rows."""
    if scenario_set not in ("infill", "greenfield", "both"):
        raise ValueError(f"Unknown SIM4_SET: {scenario_set}")
    for rows in reg["rows"].values():
        for row in rows:
            row["f"] = reg["ladder"][row["s"]]
    if scenario_set == "infill":
        return reg

    directory = Path(directory)
    sites = json.loads((directory / "plan.json").read_text(encoding="utf-8"))["eligible"]
    ix = {c: i for i, c in enumerate(chambers)}
    units = []
    for site in sites:
        steps = sorted(site["steps"])
        ms = [ix[site["site_id"]]] if site["site_id"] in ix else []
        units.append({"id": "G:" + site["site_id"], "name": "Estate at " + site["site_id"],
                      "manholes": ms, "nManholes": len(ms), "dwellings": 0, "lengthM": 0,
                      "nominal": steps[-1], "family": "greenfield", "steps": steps,
                      "limit": site["headroom"] if site["headroom"] is not None else steps[-1]})
    offset = len(reg["regions"]) if scenario_set == "both" else 0
    by_site = {s["site_id"]: i for i, s in enumerate(sites)}
    out = dict(reg)
    out["regions"] = (reg["regions"] if offset else []) + units
    out["rows"] = {}
    for case in reg["cases"]:
        tag = case["tag"]
        summary = json.loads((directory / tag / "summary.json").read_text(encoding="utf-8"))
        valid, _ = valid_rows(summary, tag)
        rows = []
        for raw in valid:
            ri = by_site[raw["site"]]
            unit = units[ri]
            row = {"r": offset + ri, "s": unit["steps"].index(raw["dwellings"]),
                   "dw": raw["dwellings"], "lps": raw["added_lps"], "f": raw["dwellings"] / unit["limit"],
                   "rise": [[ix[name(m)], v] for m, v in sorted(raw["rise_mm"].items(), key=lambda kv: -kv[1]) if v > 0],
                   "sur": [ix[name(m)] for m in raw["surcharge"]],
                   "spill": [ix[name(m)] for m in raw["spilled"]], "pumps": raw["pumps"], "run": raw["run"]}
            if "alarm" in raw:
                row["alarm"] = [ix[name(m)] for m in raw["alarm"]]
            rows.append(row)
        out["rows"][tag] = (reg["rows"][tag] if offset else []) + rows
    return out
