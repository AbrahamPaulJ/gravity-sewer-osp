#!/usr/bin/env python3
"""
growth_osp.py - where does growth cause surcharge, and where must a sensor be to see it?

THE QUESTION THIS ANSWERS

New houses connect somewhere. Flow accumulates down the network and the pipes that were
sized before them start to run full. A chamber SURCHARGES when water rises above the crown
of its outlet pipe. The reaches that were already tight were already a problem; the ones
that TIP, fine before and surcharged after, are what growth actually caused, and those are
what a sensor rollout has to be able to see. That framing is lifted from the sandbox's
osp_capacity.growth(), which does the same thing with steady Manning normal depth. This
does it with SWMM, so backwater and storage are real.

TWO THINGS MEASURED BEFORE ANY OF THIS WAS BUILT, BOTH OF WHICH SHAPED IT

1. Growth alone cannot surcharge this catchment. At peak dry weather flow the worst reach
   runs at 28% of full-bore capacity and the median at 0.8%. So every run here carries an
   infiltration level as well, and the interesting question is not "does growth surcharge
   the network" but "how much wet weather can the network still absorb once growth has
   eaten the headroom".
2. The catchment above A is complete in the published data, 157 pipes with 36 of 38
   headwaters terminating well inside the layer. So it is modelled in full and the old
   "upstream load arrives instantly" assumption (L4) does not apply here at all.

WHAT IT PRODUCES

    per site   how many dwellings that chamber can take before something new surcharges,
               and which chambers are the ones that tip
    coverage   the fewest sensor chambers that would see every growth scenario, by greedy
               set cover, plus how each single chamber scores on its own

Usage:
    python growth_osp.py                          # the default wet weather level
    python growth_osp.py --ii 0.5 --step 250
    python growth_osp.py --sites 12               # fewer sites, for a quick look
"""
import argparse, io, json, os, time

import numpy as np

import catchment
import model
from network import Network

OUT = os.path.join(model.RESULTS, "growth_osp")
MAX_ADD = 2000           # dwellings; above this the question stops being about this suburb


def tipped_sets(net, outlet, sites, ii, add, minutes):
    """Baseline, then one run per site with `add` dwellings there. Returns the new ones."""
    _, _, base = catchment.solve(net, outlet, ii_per_100m=ii, minutes=minutes,
                                 out_dir=os.path.join(OUT, "runs", "base"))
    base_sur = {c for c, v in base.items() if v["surcharged"]}
    rows = []
    for k, (name, mh) in enumerate(sites, 1):
        cat, _, st = catchment.solve(net, outlet, growth={mh: add}, ii_per_100m=ii,
                                     minutes=minutes,
                                     out_dir=os.path.join(OUT, "runs", f"site_{mh}"))
        sur = {c for c, v in st.items() if v["surcharged"]}
        rows.append({"site": name, "manholeId": mh,
                     "surcharged": sorted(sur), "tipped": sorted(sur - base_sur),
                     "spilled": sorted(c for c, v in st.items() if v["spilled"])})
        print(f"    [{k}/{len(sites)}] {name}: {len(sur - base_sur)} tipped", flush=True)
    return base, sorted(base_sur), rows


def capacity_for(net, outlet, mh, ii, base_sur, minutes, lo=0, hi=MAX_ADD, tol=25):
    """Fewest dwellings at this chamber that make something NEW surcharge.

    Bisection assumes adding load only ever makes things worse, which is true for a steady
    gravity network. None means it survived MAX_ADD, which is a finding, not a failure.
    """
    def tips(n):
        _, _, st = catchment.solve(net, outlet, growth={mh: n}, ii_per_100m=ii,
                                   minutes=minutes,
                                   out_dir=os.path.join(OUT, "runs", "bisect"))
        return bool({c for c, v in st.items() if v["surcharged"]} - set(base_sur))
    if not tips(hi):
        return None
    while hi - lo > tol:
        mid = (lo + hi) // 2
        if tips(mid):
            hi = mid
        else:
            lo = mid
    return hi


def greedy_cover(rows):
    """Fewest chambers such that every scenario has a sensor in at least one tipped chamber.

    Plain greedy set cover. It is not optimal and is not claimed to be; it is the standard
    baseline, it is transparent, and on a set this size it is within a chamber or two of
    optimal. Scenarios that tip nothing are uncoverable BY DEFINITION and are excluded
    rather than silently counted as covered, which would flatter the result.
    """
    scen = [set(r["tipped"]) for r in rows if r["tipped"]]
    uncoverable = [r["site"] for r in rows if not r["tipped"]]
    chosen, covered = [], set()
    while len(covered) < len(scen):
        best, gain = None, 0
        counts = {}
        for i, s in enumerate(scen):
            if i in covered:
                continue
            for c in s:
                counts[c] = counts.get(c, 0) + 1
        for c, g in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
            if g > gain:
                best, gain = c, g
        if best is None:
            break
        chosen.append({"chamber": best, "newlyCovered": gain})
        covered |= {i for i, s in enumerate(scen) if best in s}
    singles = {}
    for s in scen:
        for c in s:
            singles[c] = singles.get(c, 0) + 1
    return {"chosen": chosen, "scenarios": len(scen), "uncoverable": uncoverable,
            "best_single": sorted(singles.items(), key=lambda kv: (-kv[1], kv[0]))[:12]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outlet", type=int, default=583)
    ap.add_argument("--ii", type=float, default=0.40,
                    help="infiltration, L/s per 100 m; 0.40 leaves the network stressed "
                         "but not saturated, which is where growth changes the answer")
    ap.add_argument("--step", type=int, default=500, help="dwellings added per scenario")
    ap.add_argument("--minutes", type=int, default=120)
    ap.add_argument("--sites", type=int, default=0, help="limit sites, 0 = all chambers")
    ap.add_argument("--no-capacity", action="store_true", help="skip the bisection pass")
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    net = Network()
    cat0 = catchment.Catchment(net, args.outlet, ii_per_100m=args.ii)
    sites = [(c, cat0.nodes[c].manhole_id) for c in sorted(cat0.chambers)]
    if args.sites:
        sites = sites[:args.sites]

    t0 = time.time()
    print(f"catchment above node {args.outlet}: {len(cat0.pipes)} pipes, "
          f"{len(cat0.chambers)} chambers, {cat0.base_dwellings} dwellings")
    print(f"I&I {args.ii} L/s per 100 m, adding {args.step} dwellings per scenario")
    print(f"  running {len(sites)} growth scenarios...")
    base, base_sur, rows = tipped_sets(net, args.outlet, sites, args.ii, args.step,
                                       args.minutes)
    print(f"  baseline surcharges {len(base_sur)} of {len(base)} chambers")

    if not args.no_capacity:
        print(f"  finding each chamber's growth capacity...")
        for k, r in enumerate(rows, 1):
            r["capacity"] = capacity_for(net, args.outlet, r["manholeId"], args.ii,
                                         base_sur, args.minutes)
            print(f"    [{k}/{len(rows)}] {r['site']}: "
                  f"{r['capacity'] if r['capacity'] is not None else '>' + str(MAX_ADD)}",
                  flush=True)

    cover = greedy_cover(rows)
    out = {
        "outlet": args.outlet, "ii_per_100m": args.ii, "step": args.step,
        "minutes": args.minutes,
        "baseDwellings": cat0.base_dwellings,
        "chambers": len(cat0.chambers), "pipes": len(cat0.pipes),
        "lpsPerDwelling": catchment.LPS_PER_DWELLING,
        "peakFactor": cat0.peak_factor,
        "baseSurcharged": base_sur, "baseState": base,
        "scenarios": rows, "coverage": cover,
        "seconds": round(time.time() - t0, 1),
    }
    with io.open(os.path.join(OUT, "summary.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1)

    print()
    print(f"baseline: {len(base_sur)} of {len(cat0.chambers)} chambers already surcharged")
    tip = [r for r in rows if r["tipped"]]
    print(f"{len(tip)} of {len(rows)} sites tip something new at +{args.step} dwellings")
    caps = [r.get("capacity") for r in rows if r.get("capacity") is not None]
    if caps:
        print(f"growth capacity: tightest {min(caps)} dwellings, median {int(np.median(caps))}, "
              f"{len(rows) - len(caps)} sites survive +{MAX_ADD}")
    print()
    print("fewest sensors that see every growth scenario:")
    for c in cover["chosen"]:
        print(f"   {c['chamber']:14s} covers {c['newlyCovered']} more")
    print(f"   -> {len(cover['chosen'])} sensors for {cover['scenarios']} scenarios")
    print(f"wrote {os.path.join(OUT, 'summary.json')}  ({out['seconds']}s)")


if __name__ == "__main__":
    main()
