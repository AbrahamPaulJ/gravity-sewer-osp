"""
common.py - the compact run record and the case summary, shared by every speed-up.

A run's settled state is kept as two lists in the case's chamber order: depth (m, to 1e-6) and
flags (1 alarm, 2 surcharged, 4 spilled). 328 chambers x 1,641 runs is about 5 MB a case this
way, against about 50 MB as sim25_grid's per-chamber dicts, which matters once shards are
copied between machines.

summarise() builds the same summary.json that sim25_grid.run_case writes (lines 165 to 192 of
sim25_grid.py as of 21 Oct 2026), from compact records, plus a "settling" block saying how long
each run was simulated and whether any hit its cap.
"""
import json
import os
from dataclasses import asdict

import growth_osp
import sim25
import sim25_grid

ALARM, SURCHARGED, SPILLED = 1, 2, 4


def pack(st, chambers):
    """sim25.settled output -> (depths, flags) in chamber order."""
    return ([round(st[c]["depth"], 6) for c in chambers],
            [ALARM * st[c]["alarm"] | SURCHARGED * st[c]["surcharged"] | SPILLED * st[c]["spilled"]
             for c in chambers])


def unpack(depths, flags, chambers):
    return {c: {"depth": d, "alarm": bool(f & ALARM), "surcharged": bool(f & SURCHARGED),
                "spilled": bool(f & SPILLED)} for c, d, f in zip(chambers, depths, flags)}


def case_dir(out, case):
    return os.path.join(out, case.tag())


def write_json(path, payload, indent=1):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, indent=indent)


def summarise(case, chambers, mh_of, base, runs, method, h0, wall_s, settling):
    """base: unpacked baseline state; runs: [(site, dwellings, state)]; settling: a dict that
    goes into the summary as is. The rest is sim25_grid.run_case's summary, unchanged."""
    whole_area = sim25.STUDY_AREA == "whole"
    seg = chambers
    rows = []
    for mh, add, st in runs:
        rows.append({"site": mh, "dwellings": add,
                     "alarm": sorted(mh_of[c] for c in seg if sim25_grid.detected(st, base, c, "alarm")),
                     "surcharge": sorted(mh_of[c] for c in seg if sim25_grid.detected(st, base, c, "surcharge")),
                     "spilled": sorted(mh_of[c] for c in seg if st[c]["spilled"]),
                     "rise_mm": {str(mh_of[c]): r for c in seg
                                 for r in [round((st[c]["depth"] - base[c]["depth"]) * 1000, 2)]
                                 if not whole_area or r >= sim25_grid.WHOLE_RISE_FLOOR_MM}})
    placement = {}
    for rule in ("alarm", "surcharge"):
        cover = growth_osp.greedy_cover([{"site": f"{r['site']}+{r['dwellings']}",
                                          "tipped": r[rule]} for r in rows])
        placement[rule] = {"chosen": [c["chamber"] for c in cover["chosen"]],
                           "scenarios": cover["scenarios"],
                           "undetectable": len(cover["uncoverable"])}
    return {"case": asdict(case), "tag": case.tag(), "minutes": "until settled",
            "method": method, "outlet_head": h0,
            "baseline_depth_m": {str(mh_of[c]): round(base[c]["depth"], 4) for c in seg},
            "baseline": {"alarm": sorted(mh_of[c] for c in seg if base[c]["alarm"]),
                         "surcharged": sorted(mh_of[c] for c in seg if base[c]["surcharged"]),
                         "spilled": sorted(mh_of[c] for c in seg if base[c]["spilled"])},
            "rows": rows, "placement": placement, "wall_s": round(wall_s),
            "settling": settling}


def settling_block(base_rec, run_recs):
    """How long the baseline and the growth runs were simulated, and how many were capped."""
    mins = sorted(r["minutes"] for r in run_recs)
    return {"baseline_minutes": base_rec["minutes"], "baseline_capped": base_rec["capped"],
            "runs": len(mins),
            "run_minutes_median": mins[len(mins) // 2] if mins else None,
            "run_minutes_max": mins[-1] if mins else None,
            "runs_capped": sum(1 for r in run_recs if r["capped"])}
