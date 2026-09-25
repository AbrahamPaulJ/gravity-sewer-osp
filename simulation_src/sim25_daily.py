#!/usr/bin/env python3
"""
sim25_daily.py - the two ends of the day, and what they are (and are not) good for.

The day is represented by its two extremes as steady states: PEAK (sewage x peak factor, the
grid's condition) and TROUGH (sewage x 0.2, register R9). Sewage changes over hours, slower
than water crosses this network, so each extreme settles quasi-steadily. I&I is constant.

WHAT THIS CANNOT DO: set the true detection threshold. Growth is detected by comparing the
same hour across days, so the noise that matters is day-to-day variation at a given hour,
which an idealised repeating day does not contain. Only real level records give that.

WHAT IT DOES (docs/17 s6):
  1. validation: modelled normal levels in dry weather against the network operator's deployment,
     "typically range from 20 to 75 mm" (Do et al. 2023)
  2. when growth is visible: rise at peak vs trough for a sample of growth scenarios
  3. per-manhole thresholds: R_i = f x (that manhole's daily range), f swept, then the graded
     consensus placement again, from the grid's stored depth rises

Usage:
    python sim25_daily.py
"""
import json, os, random, shutil
from concurrent.futures import ProcessPoolExecutor
from dataclasses import replace

import numpy as np

import sim25
import sim25_grid
from sim25 import Case, Sim25Model, solve
import sim25_graded as graded

OUT = os.path.join(sim25.OUT_DIR, "daily")
FRACTIONS = (0.1, 0.25, 0.5)
FLOOR_MM = 5.0       # no threshold below 5 mm: under that, sensor resolution dominates
SAMPLE_SITES = 6
SAMPLE_DWELLINGS = 150


def _whole(args):
    case, growth, run_dir = args
    m = Sim25Model(case, whole=True, growth=growth)
    try:
        _, st, _ = solve(m, sim25_grid.MINUTES, run_dir)
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)
    return {str(m.nodes[c].manhole_id): st[c]["depth"] for c in m.study_chambers}


def main():
    os.makedirs(OUT, exist_ok=True)
    cases = sim25_grid.cases("all")
    with ProcessPoolExecutor(6) as pool:
        # 1 and 3: peak and trough baselines for every case
        tasks = []
        for c in cases:
            for hour in ("peak", "trough"):
                cc = replace(c, hour=hour)
                tasks.append((cc, None, os.path.join(OUT, "runs", cc.tag())))
        res = list(pool.map(_whole, tasks))
        depth = {}
        for (cc, _, _), d in zip(tasks, res):
            depth[cc.tag()] = d

        # 2: growth visibility by hour, design wet nominal
        base = Case(ii=0.11)
        probe = Sim25Model(base, whole=True)
        random.seed(2)
        sites = random.sample([probe.nodes[c].manhole_id for c in probe.study_chambers],
                              SAMPLE_SITES)
        gt = [(replace(base, hour=h), {mh: SAMPLE_DWELLINGS},
               os.path.join(OUT, "runs", f"g_{h}_{mh}")) for mh in sites for h in ("peak", "trough")]
        gres = list(pool.map(_whole, gt))

    report = {"trough_factor": sim25.TROUGH_FACTOR, "peak_factor": sim25.PF_NOMINAL}

    # 1. validation against 20 to 75 mm
    print("1. Normal levels at the 71 study manholes, mm (Stonyfell reported 20 to 75 mm):")
    val = {}
    for ii in (0.0, 0.11):
        c = Case(ii=ii)
        pk = np.array(list(depth[c.tag()].values())) * 1000
        tr = np.array(list(depth[replace(c, hour="trough").tag()].values())) * 1000
        rng = pk - tr
        val[str(ii)] = {"trough_median": float(np.median(tr)), "peak_median": float(np.median(pk)),
                        "trough_p10_p90": [float(np.percentile(tr, 10)), float(np.percentile(tr, 90))],
                        "peak_p10_p90": [float(np.percentile(pk, 10)), float(np.percentile(pk, 90))],
                        "range_median": float(np.median(rng)),
                        "share_peak_within_20_75": float(np.mean((pk >= 20) & (pk <= 75)))}
        v = val[str(ii)]
        print(f"   I&I {ii}: trough median {v['trough_median']:.0f} (p10-p90 "
              f"{v['trough_p10_p90'][0]:.0f}-{v['trough_p10_p90'][1]:.0f}), peak median "
              f"{v['peak_median']:.0f} (p10-p90 {v['peak_p10_p90'][0]:.0f}-{v['peak_p10_p90'][1]:.0f}),"
              f" daily range median {v['range_median']:.0f}; peak within 20-75 mm at "
              f"{v['share_peak_within_20_75']:.0%} of manholes")
    report["validation"] = val

    # 2. when is growth visible
    print(f"2. Rise from +{SAMPLE_DWELLINGS} dwellings, design wet, max over study manholes (mm):")
    bp = depth[base.tag()]
    bt = depth[replace(base, hour="trough").tag()]
    vis = []
    for i, mh in enumerate(sites):
        pk = max((gres[2 * i][k] - bp[k]) * 1000 for k in bp)
        tr = max((gres[2 * i + 1][k] - bt[k]) * 1000 for k in bt)
        vis.append({"site": mh, "peak_rise_mm": pk, "trough_rise_mm": tr})
        print(f"   MH{mh}: peak {pk:6.1f}   trough {tr:6.1f}")
    report["visibility_by_hour"] = vis

    # 3. per-manhole thresholds from each manhole's own daily range
    grid = graded.load()
    report["per_manhole"] = {}
    for f in FRACTIONS:
        all_sets, per = [], []
        for s in grid:
            c = Case(**{k: s["case"][k] for k in ("ii", "pf", "age", "bfac", "stage")})
            pk, tr = depth[c.tag()], depth[replace(c, hour="trough").tag()]
            thr = {mh: max(FLOOR_MM, f * (pk[mh] - tr[mh]) * 1000) for mh in pk}
            sets = [{mh for mh, v in row["rise_mm"].items() if v >= thr[mh]} for row in s["rows"]]
            all_sets.append(sets)
            per.append({"case": s["tag"], "best2": graded.greedy(sets, 2),
                        "detectable": sum(1 for x in sets if x)})
        chosen, remaining = [], [set(range(len(x))) for x in all_sets]
        for _ in range(2):
            gain = {}
            for ci, sets in enumerate(all_sets):
                det = sum(1 for x in sets if x) or 1
                for i in remaining[ci]:
                    for mh in sets[i]:
                        gain[mh] = gain.get(mh, 0.0) + 1.0 / det
            if not gain:
                break
            best = max(sorted(gain), key=lambda m: gain[m])
            chosen.append(best)
            for ci, sets in enumerate(all_sets):
                remaining[ci] -= {i for i in remaining[ci] if best in sets[i]}
        keep = []
        for ci, sets in enumerate(all_sets):
            cov = sum(1 for x in sets if set(chosen) & x)
            best = per[ci]["best2"][1]
            keep.append(cov / best if best else None)
        ks = [k for k in keep if k is not None]
        report["per_manhole"][str(f)] = {"consensus_pair": chosen, "kept": keep,
                                         "per_case": per}
        print(f"3. threshold = max({FLOOR_MM:g} mm, {f} x own daily range): consensus pair "
              f"{chosen} keeps {min(ks):.0%} to {max(ks):.0%} (mean {np.mean(ks):.0%}) of each"
              f" case's best pair")
    with open(os.path.join(OUT, "daily.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(report, fh, indent=1)


if __name__ == "__main__":
    main()
