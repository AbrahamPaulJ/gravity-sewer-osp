#!/usr/bin/env python3
"""
growth_threshold.py - re-run every site at ITS OWN capacity, not at a shared step.

WHY THIS EXISTS

The first pass added the same 500 dwellings at every chamber. Median site capacity turned
out to be 140, so every scenario was pushed about 3.6x past the point where it first broke.
The result saturated: two chambers tipped in 69 of 71 scenarios, there were only 15
distinct tipped sets, and greedy cover answered "one sensor" because by then everything
drained through the same downstream bottleneck. That is true and useless. It describes the
step size, not the network.

Growth at each site's own threshold asks the question that actually has a site-specific
answer: when this connection point first runs out of room, WHERE does it show up? That is
the first thing a sensor would see, and it is what placement has to be designed around.

Reads the capacities the bisection already found, so it costs one run per site rather than
repeating the search. Writes the extra fields back into the same summary.

Usage:
    python growth_threshold.py
"""
import io, json, os, time

import numpy as np

import catchment
import growth_osp
from network import Network

SUMMARY = os.path.join(growth_osp.OUT, "summary.json")


def main():
    if not os.path.exists(SUMMARY):
        raise SystemExit("run growth_osp.py first")
    d = json.load(io.open(SUMMARY, encoding="utf-8"))
    base_sur = set(d["baseSurcharged"])
    net = Network()
    t0 = time.time()

    done = 0
    for k, r in enumerate(d["scenarios"], 1):
        cap = r.get("capacity")
        if cap is None:
            r["atThreshold"] = None
            continue
        _, _, st = catchment.solve(net, d["outlet"], growth={r["manholeId"]: cap},
                                   ii_per_100m=d["ii_per_100m"], minutes=d["minutes"],
                                   out_dir=os.path.join(growth_osp.OUT, "runs", "thresh"))
        sur = {c for c, v in st.items() if v["surcharged"]}
        r["atThreshold"] = {
            "dwellings": cap,
            "surcharged": sorted(sur),
            "tipped": sorted(sur - base_sur),
        }
        done += 1
        print(f"  [{k}/{len(d['scenarios'])}] {r['site']}: +{cap} tips "
              f"{len(sur - base_sur)}", flush=True)

    # Coverage recomputed on the threshold sets. greedy_cover reads `tipped`, so the rows
    # are presented to it in that shape rather than teaching it a second field name.
    rows = [{"site": r["site"], "tipped": (r["atThreshold"] or {}).get("tipped", [])}
            for r in d["scenarios"]]
    d["coverageAtThreshold"] = growth_osp.greedy_cover(rows)
    d["thresholdSeconds"] = round(time.time() - t0, 1)

    with io.open(SUMMARY, "w", encoding="utf-8", newline="\n") as f:
        json.dump(d, f, indent=1)

    sets = [tuple(sorted((r["atThreshold"] or {}).get("tipped", []))) for r in d["scenarios"]]
    nz = [s for s in sets if s]
    print()
    print(f"{done} sites re-run at their own capacity ({d['thresholdSeconds']}s)")
    print(f"distinct tipped sets: {len(set(nz))} at threshold, "
          f"against {len(set(tuple(sorted(r['tipped'])) for r in d['scenarios']))} at the flat step")
    n = [len(s) for s in nz]
    if n:
        print(f"chambers tipped per site: min {min(n)}, median {int(np.median(n))}, max {max(n)}")
    c = d["coverageAtThreshold"]
    print(f"sensors needed: {len(c['chosen'])} for {c['scenarios']} scenarios")
    for x in c["chosen"]:
        print(f"   {x['chamber']:14s} covers {x['newlyCovered']} more")


if __name__ == "__main__":
    main()
