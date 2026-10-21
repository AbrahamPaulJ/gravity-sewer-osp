#!/usr/bin/env python3
"""
bench/hotstart_check.py - growth runs solved three ways, against a settled reference.

    python -m speedups.bench.hotstart_check --ii 0.25 --sites 4427309:40 4429357:150

For each site:dwellings, on the whole domain:
    reference   baseline and growth both cold for --ref-minutes (1,440: settled, bench/settling)
    grid        baseline and growth both cold for 480 minutes, as sim25_grid runs them
    hot T       growth from the settled baseline's hotstart for T minutes
    hot settle  growth from the hotstart until converge's rule stops it
Each line gives the wall time, the largest error in the depth rise at any chamber, how many
chambers the 10 mm rise rule classes differently, and how many newly-alarm or
newly-surcharged detections differ. README.md's "Hot start" table is this script's output.
"""
import argparse
import time

from sim25 import Case

from ..common import unpack
from ..hotstart import run_task, settle_baseline


def _rise(run, base):
    return [a - b for a, b in zip(run["depths"], base["depths"])]


def _detections(run, base):
    s, b = unpack(run["depths"], run["flags"], run["chambers"]), unpack(base["depths"], base["flags"], base["chambers"])
    return {(c, k) for c in s for k in ("alarm", "surcharged") if s[c][k] and not b[c][k]}


def compare(run, base, ref, ref_base):
    r, rr = _rise(run, base), _rise(ref, ref_base)
    err = max(abs(a - b) for a, b in zip(r, rr))
    ten = sum((a >= 0.010) != (b >= 0.010) for a, b in zip(r, rr))
    det = len(_detections(run, base) ^ _detections(ref, ref_base))
    return f"rise error {err*1000:6.2f} mm, 10 mm rule differs at {ten:3d}, detections differ {det}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ii", type=float, default=0.25)
    ap.add_argument("--sites", nargs="+", default=["4427309:40", "4429357:150", "4448419:40"])
    ap.add_argument("--ref-minutes", type=int, default=1440)
    ap.add_argument("--hot", type=int, nargs="*", default=[120, 240, 360])
    args = ap.parse_args()
    case = Case(ii=args.ii)

    def timed(t):
        t0 = time.time()
        r = run_task(t)
        return r, time.time() - t0

    base_task = settle_baseline(case)
    base_task["fixed_minutes"] = args.ref_minutes
    ref_base, _ = timed(base_task)
    grid_base, _ = timed({"case": case, "whole": True, "fixed_minutes": 480})
    print(f"case {case.tag()}: reference baseline cold {args.ref_minutes} min")
    for spec in args.sites:
        mh, add = (int(x) for x in spec.split(":"))
        g = {mh: add}
        ref, dref = timed({"case": case, "whole": True, "growth": g, "fixed_minutes": args.ref_minutes})
        print(f"MH{mh} +{add}: reference cold {args.ref_minutes} min {dref:.0f} s, "
              f"{sum(x >= 0.01 for x in _rise(ref, ref_base))} chambers rise 10 mm or more")
        grid, d = timed({"case": case, "whole": True, "growth": g, "fixed_minutes": 480})
        print(f"   grid, cold 480        {d:6.1f} s  {compare(grid, grid_base, ref, ref_base)}")
        for T in args.hot:
            h, d = timed({"case": case, "whole": True, "growth": g, "hotstart": ref_base["hotstart"],
                          "fixed_minutes": T})
            print(f"   hot {T:4d}              {d:6.1f} s  {compare(h, ref_base, ref, ref_base)}")
        h, d = timed({"case": case, "whole": True, "growth": g, "hotstart": ref_base["hotstart"]})
        print(f"   hot, until settled    {d:6.1f} s  {compare(h, ref_base, ref, ref_base)} "
              f"(stopped at {h['minutes']:.0f} min{', CAPPED' if h['capped'] else ''})", flush=True)


if __name__ == "__main__":
    main()
