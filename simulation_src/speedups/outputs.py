"""
outputs.py - write a fast grid's summaries, from one machine's runs or merged shards.

The files and their layout are sim25_grid's: <out>/<case tag>/summary.json per case,
<out>/corridor/<tag>/summary.json per weather level, <out>/robustness.json. The default <out>
is a separate folder (grid_fast or grid_whole_fast), so the published results are never
overwritten and compare.py can set the two side by side.
"""
import os
from dataclasses import asdict

import sim25_grid

from .common import summarise, settling_block, unpack, write_json


def _mh_of(rec):
    return dict(zip(rec["chambers"], rec["manholes"]))


def write_case(out, g, wall_s):
    """g: {"case", "method", "baseline", "outlet_head", "runs"}, runs keyed
    ("grow", tag, index, site, dwellings)."""
    base_rec, recs = g["baseline"], sorted(g["runs"], key=lambda r: r["key"][2])
    chambers, mh_of = base_rec["chambers"], _mh_of(base_rec)
    base = unpack(base_rec["depths"], base_rec["flags"], chambers)
    runs = [(r["key"][3], r["key"][4], unpack(r["depths"], r["flags"], chambers)) for r in recs]
    s = summarise(g["case"], chambers, mh_of, base, runs, g["method"], g["outlet_head"],
                  wall_s, settling_block(base_rec, recs))
    write_json(os.path.join(out, g["case"].tag(), "summary.json"), s)
    st = s["settling"]
    print(f"  {s['tag']}: {len(s['rows'])} growth runs ({s['method']}), baseline settled at "
          f"{st['baseline_minutes']:.0f} min, runs median {st['run_minutes_median']} min, "
          f"{st['runs_capped']} capped; sensors alarm {s['placement']['alarm']['chosen']} "
          f"surcharge {s['placement']['surcharge']['chosen']}", flush=True)
    return s


def write_corridor(out, g):
    """As sim25_grid.run_corridor, from runs keyed ("corr", tag, index, dwellings)."""
    base_rec, recs = g["baseline"], sorted(g["runs"], key=lambda r: r["key"][2])
    chambers, mh_of = base_rec["chambers"], _mh_of(base_rec)
    base = unpack(base_rec["depths"], base_rec["flags"], chambers)
    rows = []
    for r in recs:
        st = unpack(r["depths"], r["flags"], chambers)
        rows.append({"dwellings": r["key"][3], "added_lps": r["growth_lps"],
                     "outlet_head_rise_m": r["head"] - base_rec["head"],
                     "alarm": sorted(mh_of[c] for c in st if sim25_grid.detected(st, base, c, "alarm")),
                     "surcharge": sorted(mh_of[c] for c in st if sim25_grid.detected(st, base, c, "surcharge")),
                     "max_depth_rise_m": max(st[c]["depth"] - base[c]["depth"] for c in st),
                     "minutes": r["minutes"], "capped": r["capped"]})
    payload = {"case": asdict(g["case"]), "corridor_nodes": g.get("corridor_nodes"), "rows": rows}
    write_json(os.path.join(out, "corridor", g["case"].tag(), "summary.json"), payload)
    return payload


def write_all(out, grid_groups, corridor_groups, wall_s):
    """grid_groups in the order the cases were listed; returns the case summaries."""
    summaries = [write_case(out, g, wall_s) for g in grid_groups]
    for g in corridor_groups:
        write_corridor(out, g)
    if summaries:
        rob = sim25_grid.robustness(summaries)
        write_json(os.path.join(out, "robustness.json"),
                   {"cases": [s["tag"] for s in summaries], "robustness": rob})
    return summaries
