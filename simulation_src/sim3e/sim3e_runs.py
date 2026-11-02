"""sim3e_runs.py - Sim 3-e: the whole suburb grows at once, in EPA SWMM.

Sim 3 grows one area at a time. The 26 Oct 2026 review asked how capacity is used up as growth
arrives over the years, and infill arrives everywhere at once, not one area at a time. So this
script runs Sim 3's own infill rule over the WHOLE suburb:

  growth   step f of the published 2021-41 projection (config.js regions.anchor_dwellings,
           485 dwellings at f = 1.0), spread over every existing connection point in the
           Sim 3 regions (R1 to R8) in proportion to the dwellings already on each pipe, and
           loaded at each pipe's upstream node: sim3_regions.growth_nodes's rule, suburb-wide.
  steps    Sim 3's ladder (0.1 to 3.0).
  cases    the eight cases of config.js case set "eight" (sim25_grid.cases("all")).
  runs     whole domain, ended by the same convergence gate as Sim 3.

Sim 3's model, cases, loads and solver are imported, never changed. Before the new runs the
script repeats one published Sim 3 run (R1 at 100%, Design wet) and stops if it does not match.

    ~/.venvs/sewer/bin/python simulation_src/sim3e/sim3e_runs.py --workers 8

Output: simulation_src/results/sim3e/suburb.json (rise at every manhole per case and step;
baselines are Sim 3's own, in results/sim3/regions/<case>/summary.json).
"""
import argparse
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
if SRC not in sys.path:
    sys.path.insert(0, SRC)
os.chdir(SRC)

import model                       # noqa: E402
import sim25_grid                  # noqa: E402
import sim3_regions as s3          # noqa: E402

OUT = os.path.join(model.RESULTS, "sim3e")
RUN_DIR = os.path.join(OUT, "tmp")
SIM3 = os.path.join(model.RESULTS, "sim3", "regions")
CHECK = {"region": "R1", "step": 1.0, "tag": "ii0.11_flat_uniform_b1_sfree"}


def suburb_weights(regs, net):
    """Pipe id -> share of new dwellings, over every pipe in R1 to R8, by existing dwellings."""
    w = {}
    for r in regs:
        for i in r["pipes"]:
            w[i] = float(net.pipes[i].dwellings)
    tot = sum(w.values())
    return {i: v / tot for i, v in w.items() if v > 0}


def growth(weights, n, net):
    g = {}
    for i, w in weights.items():
        u = net.pipes[i].up
        g[u] = g.get(u, 0.0) + n * w
    return g


def rises(st, base, mh_of, cands):
    return {str(mh_of[c]): r for c in cands
            for r in [round((st[c]["depth"] - base[c]["depth"]) * 1000, 2)] if r >= s3.RISE_FLOOR_MM}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--plan", action="store_true")
    a = ap.parse_args()
    net, probe, pipes = s3._domain()
    regs = s3.regions(net, probe, pipes)
    w = suburb_weights(regs, net)
    cases = sim25_grid.cases("all")
    print(f"suburb growth over {len(w)} pipes in {len(regs)} regions; {len(cases)} cases x "
          f"{len(s3.LADDER)} steps = {len(cases) * len(s3.LADDER)} runs (+2 for the check)")
    if a.plan:
        return
    os.makedirs(RUN_DIR, exist_ok=True)
    cands = probe.candidates
    mh_of = {c: probe.nodes[c].manhole_id for c in cands}
    with ProcessPoolExecutor(a.workers) as pool:
        # Check: repeat one published Sim 3 run.
        case = next(c for c in cases if c.tag() == CHECK["tag"])
        r1 = next(r for r in regs if r["id"] == CHECK["region"])
        t0 = time.time()
        base, grow = pool.map(sim25_grid._whole_task, [
            (case, None, None, os.path.join(RUN_DIR, "chk0")),
            (case, s3.growth_nodes(r1, CHECK["step"], net), None, os.path.join(RUN_DIR, "chk1"))])
        mine = rises(grow[3], base[3], mh_of, cands)
        pub_s = json.load(open(os.path.join(SIM3, CHECK["tag"], "summary.json"), encoding="utf-8"))
        pub = next(x for x in pub_s["rows"] if x["region"] == CHECK["region"] and x["step"] == CHECK["step"])["rise_mm"]
        worst = max(abs(mine.get(k, 0.0) - pub.get(k, 0.0)) for k in set(mine) | set(pub))
        print(f"check: {CHECK['region']} at {CHECK['step']:g}, Design wet: largest difference "
              f"{worst:.2f} mm over {len(set(mine) | set(pub))} manholes ({time.time() - t0:.0f} s)", flush=True)
        if worst > 1.0:
            raise SystemExit("The re-run does not reproduce the published Sim 3 result; stopping.")

        tasks, keys = [], []
        for c in cases:
            for f in s3.LADDER:
                tasks.append((c, growth(w, f * s3.ANCHOR, net), None,
                              os.path.join(RUN_DIR, f"{c.tag()}_{f:g}")))
                keys.append((c.tag(), f))
        t0 = time.time()
        res = []
        for i, r in enumerate(pool.map(sim25_grid._whole_task, tasks, chunksize=1)):
            res.append(r)
            print(f"  {i + 1}/{len(tasks)} runs, {(time.time() - t0) / 60:.1f} min", flush=True)

    out = {"version": "sim3e", "family": "whole-suburb infill",
           "check": {"published_run": f"{CHECK['region']} at {CHECK['step']:g}, {CHECK['tag']}",
                     "largest_difference_mm": round(worst, 3)},
           "anchor_dwellings": s3.ANCHOR, "ladder": s3.LADDER, "pipes_with_growth": len(w),
           "cases": [c.tag() for c in cases], "rows": []}
    for (tag, f), (head, glps, err, st, prov) in zip(keys, res):
        b = json.load(open(os.path.join(SIM3, tag, "summary.json"), encoding="utf-8"))["baseline_depth_m"]
        out["rows"].append({
            "case": tag, "step": f, "dwellings": round(f * s3.ANCHOR, 1), "added_lps": round(glps, 4),
            "depth_mm": {str(mh_of[c]): round(st[c]["depth"] * 1000, 1) for c in cands},
            "rise_mm": {str(mh_of[c]): rr for c in cands
                        for rr in [round(st[c]["depth"] * 1000 - b[str(mh_of[c])] * 1000, 2)]
                        if rr >= s3.RISE_FLOOR_MM},
            "run": {k: prov.get(k) for k in ("minutes", "converged", "max_drift_mm", "continuity_err_pct")}})
    with open(os.path.join(OUT, "suburb.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=1)
    print("wrote", os.path.relpath(os.path.join(OUT, "suburb.json"), SRC))


if __name__ == "__main__":
    main()
