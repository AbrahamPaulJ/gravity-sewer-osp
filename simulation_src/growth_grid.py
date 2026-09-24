#!/usr/bin/env python3
"""
growth_grid.py - every combination of wet weather level and growth size, so the page can
have knobs instead of one frozen answer.

WHY A GRID

The page precomputes, so a control can only exist if every position of it has been solved
in advance. That is not a limitation worth apologising for at this size: one steady state
takes about two seconds, so the whole cross-product is minutes, and the browser gets exact
SWMM answers instead of an approximation it could compute live.

Two things it fixes, both of which were real confusions about the previous build:

1. There was no wet weather control at all, even though infiltration is the thing that
   actually fills these pipes. It was fixed at one level chosen off-screen.
2. The sensor recommendation never changed, because each site was grown to its own
   threshold, which is a single number per site. Growing every site by the SAME amount,
   and letting that amount vary, is what makes the recommendation move: a small
   development tips one chamber near the bottleneck, a large one tips a spread of them.

Both axes are kept deliberately coarse. They are conditions to compare, not a continuum
to interpolate, and the underlying infiltration figure is assumed anyway (L10).

Usage:
    python growth_grid.py
    python growth_grid.py --sites 8          # quick shape check
"""
import argparse, io, json, os, time

import numpy as np

import catchment
import growth_osp
from network import Network

OUT = os.path.join(catchment.model.RESULTS, "growth_grid")

# L/s per 100 m of sewer. 0 is a dry day and nothing surcharges; past about 0.6 the network
# saturates and growth stops making a visible difference, so the useful band is narrow.
II_LEVELS = [
    (0.25, "Dry weather", "An ordinary day. Sewage only, plus a little groundwater."),
    (0.40, "Wet", "Rain getting in through joints and defects. The network is stressed."),
    (0.55, "Very wet", "A heavy event. Much of the trunk is already full before any growth."),
]
# Dwellings added at the chosen chamber. The median chamber absorbs about 140 before
# anything new surcharges, so this brackets that: two below it, two above.
GROWTH_LEVELS = [50, 150, 350, 700]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outlet", type=int, default=583)
    ap.add_argument("--minutes", type=int, default=120)
    ap.add_argument("--sites", type=int, default=0)
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    net = Network()
    cat0 = catchment.Catchment(net, args.outlet)
    chambers = sorted(cat0.chambers)
    index = {c: i for i, c in enumerate(chambers)}
    sites = [(c, cat0.nodes[c].manhole_id) for c in chambers]
    if args.sites:
        sites = sites[:args.sites]

    total = len(II_LEVELS) * (1 + len(GROWTH_LEVELS) * len(sites))
    print(f"catchment above node {args.outlet}: {len(cat0.pipes)} pipes, "
          f"{len(chambers)} chambers, {cat0.base_dwellings} properties")
    print(f"{len(II_LEVELS)} wet weather levels x {len(GROWTH_LEVELS)} growth sizes x "
          f"{len(sites)} sites = {total} runs")
    t0 = time.time()

    cells, done = [], 0
    for ii, ii_label, ii_note in II_LEVELS:
        _, _, base = catchment.solve(net, args.outlet, ii_per_100m=ii, minutes=args.minutes,
                                     out_dir=os.path.join(OUT, "runs", "base"))
        base_sur = sorted(c for c, v in base.items() if v["surcharged"])
        done += 1
        for add in GROWTH_LEVELS:
            rows = []
            for name, mh in sites:
                _, _, st = catchment.solve(net, args.outlet, growth={mh: add},
                                           ii_per_100m=ii, minutes=args.minutes,
                                           out_dir=os.path.join(OUT, "runs", "cell"))
                sur = set(c for c, v in st.items() if v["surcharged"])
                spill = sorted(index[c] for c, v in st.items() if v["spilled"])
                rows.append({"site": index[name], "manholeId": mh,
                             "sur": sorted(index[c] for c in sur),
                             "tip": sorted(index[c] for c in sur - set(base_sur)),
                             "spill": spill})
                done += 1
                if done % 25 == 0:
                    el = time.time() - t0
                    print(f"  {done}/{total}  {el:.0f}s elapsed, "
                          f"~{el / done * (total - done):.0f}s left", flush=True)
            cover = growth_osp.greedy_cover(
                [{"site": str(r["site"]), "tipped": r["tip"]} for r in rows])
            cells.append({"ii": ii, "add": add,
                          "baseSurcharged": [index[c] for c in base_sur],
                          "rows": rows, "coverage": cover})

    out = {
        "outlet": args.outlet, "minutes": args.minutes,
        "chambers": chambers,
        "manholeIds": [cat0.nodes[c].manhole_id for c in chambers],
        "dwellingsAt": [cat0.dwellings.get(c, 0) for c in chambers],
        "iiLevels": [{"ii": a, "label": b, "note": c} for a, b, c in II_LEVELS],
        "growthLevels": GROWTH_LEVELS,
        "baseDwellings": cat0.base_dwellings,
        "lpsPerDwelling": catchment.LPS_PER_DWELLING,
        "peakFactor": cat0.peak_factor,
        "pipes": len(cat0.pipes),
        "cells": cells,
        "seconds": round(time.time() - t0, 1),
    }
    with io.open(os.path.join(OUT, "summary.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, separators=(",", ":"))

    print()
    print(f"{len(cells)} cells in {out['seconds']}s")
    print(f"{'wet':>12} {'growth':>7} {'base':>5} {'tips':>6} {'sensors':>8}")
    for c in cells:
        lab = next(x[1] for x in II_LEVELS if x[0] == c["ii"])
        tips = [len(r["tip"]) for r in c["rows"]]
        print(f"{lab:>12} {c['add']:>7} {len(c['baseSurcharged']):>5} "
              f"{int(np.median(tips)):>6} {len(c['coverage']['chosen']):>8}")
    print(f"wrote {os.path.join(OUT, 'summary.json')}")


if __name__ == "__main__":
    main()
