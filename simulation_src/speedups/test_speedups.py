#!/usr/bin/env python3
"""
test_speedups.py - checks for the speed-ups. Run from simulation_src:

    python -m speedups.test_speedups            # quick checks, no SWMM (a second or two)
    python -m speedups.test_speedups --swmm     # plus SWMM runs on design wet (about 15 minutes)

The SWMM checks are the claims README.md rests on, at design wet where 480 minutes is known
to settle: a run stopped by the rule matches a full-length run, a hotstart run matches a cold
one, an early stop still saves a hotstart, and a sharded grid merges to the same summary as an
unsharded one.
"""
import argparse
import os
import shutil
import sys
import tempfile

from sim25 import Case

from .common import pack, unpack
from .distributed import shard

FAILS = []


def check(name, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{': ' + detail if detail else ''}")
    if not ok:
        FAILS.append(name)


def quick():
    st = {"MH1": {"depth": 0.1234567, "alarm": True, "surcharged": False, "spilled": True},
          "MH2": {"depth": 0.0, "alarm": False, "surcharged": True, "spilled": False}}
    d, f = pack(st, ["MH1", "MH2"])
    back = unpack(d, f, ["MH1", "MH2"])
    check("pack/unpack keeps flags", all(back[c][k] == st[c][k] for c in st
                                         for k in ("alarm", "surcharged", "spilled")))
    check("pack rounds depth to 1e-6 m", abs(back["MH1"]["depth"] - 0.123457) < 1e-12)
    tasks = list(range(1641))
    parts = [shard.select(tasks, i, 7) for i in range(7)]
    check("shards are disjoint and cover every task",
          sorted(x for p in parts for x in p) == tasks)
    check("shards are within one run of each other",
          max(map(len, parts)) - min(map(len, parts)) <= 1)
    check("shard spec parses", shard.parse("2/8") == (2, 8))
    try:
        shard.parse("8/8")
        check("shard spec rejects i >= n", False)
    except ValueError:
        check("shard spec rejects i >= n", True)


def swmm():
    from .hotstart import run_task, settle_baseline
    c = Case(ii=0.11)
    b = run_task(settle_baseline(c))
    check("design wet baseline settles before its cap", not b["capped"], f"{b['minutes']} min")
    check("an early stop still saves a hotstart", bool(b["hotstart"]), f"{len(b['hotstart'] or b'')} bytes")
    full = run_task({"case": c, "whole": True, "fixed_minutes": 480})
    d = max(abs(x - y) for x, y in zip(full["depths"], b["depths"]))
    check("settled baseline matches 480 minutes", d < 2e-4, f"{d*1000:.3f} mm")
    mh = b["manholes"][len(b["manholes"]) // 2]
    cold = run_task({"case": c, "whole": True, "growth": {mh: 150}, "fixed_minutes": 480})
    hot = run_task({"case": c, "whole": True, "growth": {mh: 150}, "hotstart": b["hotstart"]})
    rc = [x - y for x, y in zip(cold["depths"], full["depths"])]
    rh = [x - y for x, y in zip(hot["depths"], b["depths"])]
    d = max(abs(x - y) for x, y in zip(rc, rh))
    check("hotstart growth rise matches cold 480", d < 2e-4, f"{d*1000:.3f} mm, {hot['minutes']} min")
    check("hotstart growth flags match cold 480", hot["flags"] == cold["flags"])


def sharded_equals_whole():
    """A two-site grid on one machine and as two shards plus a merge: same summaries."""
    import json
    import runpy
    tmp = tempfile.mkdtemp(prefix="sim25shardtest_")
    try:
        def grid(*extra):
            sys.argv = ["fast_grid", "--only", Case(ii=0.11).tag(), "--sites", "2", "--no-corridor",
                        "--workers", "2", *extra]
            runpy.run_module("speedups.fast_grid", run_name="__main__")
        grid("--out", os.path.join(tmp, "one"))
        for i in range(2):
            grid("--out", os.path.join(tmp, "two"), "--shard", f"{i}/2")
        sys.argv = ["merge", "--out", os.path.join(tmp, "two")]
        runpy.run_module("speedups.distributed.merge", run_name="__main__")
        same = True
        for tag in os.listdir(os.path.join(tmp, "one")):
            p = os.path.join(tmp, "one", tag, "summary.json")
            if not os.path.exists(p):
                continue
            a = json.load(open(p, encoding="utf-8"))
            b = json.load(open(os.path.join(tmp, "two", tag, "summary.json"), encoding="utf-8"))
            same &= a["rows"] == b["rows"] and a["placement"] == b["placement"]
        check("two shards merge to the single-machine summaries", same)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--swmm", action="store_true")
    args = ap.parse_args()
    print("quick checks")
    quick()
    if args.swmm:
        print("SWMM checks (design wet, whole domain)")
        swmm()
        sharded_equals_whole()
    print(f"{len(FAILS)} failed" if FAILS else "all passed")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
