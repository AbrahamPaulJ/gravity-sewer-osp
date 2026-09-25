#!/usr/bin/env python3
"""
hydraulics.py - one SWMM run of the three-pipe neighbourhood, saved for the 3D viewer.

The model itself lives in model.py; the experiments that answer the project questions
live in experiments.py. This is for looking at a single scenario.

Output: results/runs/<split>_<scenario>_<unit>[_growth]/  model.inp, .rpt, series.npz, meta.json

Usage:
    python hydraulics.py                                          # along, constant 0.15
    python hydraulics.py --split along --scenario event --unit 0.15 --peak 12
    python hydraulics.py --split equal --scenario ramp --unit 60 --minutes 60   # the original
    python hydraulics.py --growth-site B --growth 30
    python hydraulics.py --list                                   # candidate junctions
"""
import argparse, os

import model
from model import Neighbourhood, Scenario, STAGES, UNIT_LABEL
from network import Network


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--junction", type=int, default=441)
    ap.add_argument("--split", choices=model.SPLITS, default="along")
    ap.add_argument("--scenario", choices=["constant", "ramp", "step", "event"], default="constant")
    ap.add_argument("--unit", type=float, default=0.15,
                    help="base load: L/s per chamber for equal, L/s per 100 m otherwise")
    ap.add_argument("--minutes", type=int, default=120)
    ap.add_argument("--peak", type=float, default=1.0, help="step/event multiplier")
    ap.add_argument("--warmup", type=int, default=60)
    ap.add_argument("--growth-site", choices=["A", "B", "J", "D"])
    ap.add_argument("--growth", type=float, default=0.0, help="extra constant L/s at the site")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    net = Network()
    if args.list:
        for jid, ids in net.junctions():
            print(jid, [f"{net.pipes[i].dia*1000:.0f}mm/{net.pipes[i].length:.0f}m" for i in ids])
        return

    nh = Neighbourhood(net, args.junction, args.split)
    minutes = args.minutes
    if args.scenario == "event":
        minutes = max(minutes, args.warmup + 150)
    sc = Scenario(args.scenario, args.unit, minutes, peak=args.peak, warmup=args.warmup,
                  growth_site=args.growth_site, growth_lps=args.growth)
    name = f"{args.split}_{args.scenario}_{args.unit:g}"
    if args.scenario in ("step", "event"):
        name += f"_x{args.peak:g}"
    if args.growth_site and args.growth:
        name += f"_growth{args.growth_site}{args.growth:g}"
    out = os.path.join(model.RESULTS, "runs", name)
    r = model.run(nh, sc, out)
    meta = r.save()

    print(f"\n{name}: {sc.describe(args.split)}")
    print(f"{len(r.s['t'])} frames, SWMM flow continuity error {r.err:.2f}%")
    print(f"total inflow at shape 1: {sum(r.loads.values()):.2f} L/s")
    print("\nchamber  load L/s  peak depth  of shaft")
    for k, c in enumerate(nh.chambers):
        d = r.s["depth"][:, k].max()
        print(f"   {c}    {r.loads.get(c, 0):7.2f}    {d:6.2f} m   {100 * d / nh.nodes[c].max_depth:5.1f}%")
    print("\nfirst time each stage is reached (min)")
    for c, row in meta["first_times"].items():
        print(f"   {c}  " + "  ".join(f"{s}: {'never' if row[s] is None else f'{row[s]:.1f}'}"
                                     for s in STAGES))
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
