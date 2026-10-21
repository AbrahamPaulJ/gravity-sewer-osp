#!/usr/bin/env python3
"""
bench/settling.py - how long a cold whole-domain baseline takes to settle, per weather level.

    python -m speedups.bench.settling --ii 0.11 0.25 [--minutes 1440]

Runs each baseline from empty pipes for --minutes, recording every chamber every 10 s, and
compares the 10-minute peak (what sim25.settled reports) at 240 to 1,200 minutes with the
peak at the end. Then says where converge.run_until_settled would have stopped the same run.
README.md's "Settling" table is this script's output of 21 Oct 2026.
"""
import argparse
import os
import shutil
import tempfile
import time

import numpy as np

import model
import sim25
from sim25 import Case, Sim25Model

from ..converge import run_until_settled


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ii", type=float, nargs="+", default=[0.11, 0.25])
    ap.add_argument("--minutes", type=int, default=1440)
    args = ap.parse_args()
    tmp = tempfile.mkdtemp(prefix="sim25settle_")
    try:
        for ii in args.ii:
            m = Sim25Model(Case(ii=ii), whole=True)
            t0 = time.time()
            r = model.run(m, sim25._Steady(args.minutes, record_last_min=args.minutes),
                          os.path.join(tmp, f"{ii}"))
            dt = time.time() - t0
            D, t = r.s["depth"], r.s["t"] / 60
            names = list(m.chambers)
            study = [names.index(c) for c in m.study_chambers]
            def peak(T):
                return D[(t > T - 10) & (t <= T)].max(0)
            ref = peak(args.minutes)
            print(f"ii {ii}: {len(names)} chambers, {args.minutes} min cold in {dt:.0f} s")
            for T in (240, 360, 480, 720, 960, 1200):
                if T >= args.minutes:
                    break
                d = np.abs(peak(T) - ref)
                print(f"   peak at {T:4d} vs {args.minutes}: all chambers max {d.max()*1000:7.2f} mm "
                      f"({(d > 1e-3).sum():3d} over 1 mm); 71 study manholes max {d[study].max()*1000:7.2f} mm")
            res, s = run_until_settled(m, sim25._Steady(args.minutes), os.path.join(tmp, f"c{ii}"))
            st = sim25.settled(m, res)
            d = max(abs(st[c]["depth"] - ref[i]) for i, c in enumerate(names))
            print(f"   converge rule: stops at {s.minutes:.0f} min{' (CAPPED)' if s.capped else ''}, "
                  f"{d*1000:.2f} mm from the {args.minutes}-minute peak")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
