#!/usr/bin/env python3
"""
serve_hotstart/serve.py - sim25_serve.py with ideal-pump scenarios started from a settled
baseline. Run from simulation_src:

    python -m speedups.serve_hotstart.serve [--port 8001] [--warm]

sim25_serve solves each scenario cold for 480 minutes (about 25 s a case), and solves the
case's baseline the same way the first time it is asked for. Here the first scenario of a case
settles the baseline once (converge, cap 2,880 min) and keeps its hotstart; every scenario of
that case after it starts from that state and stops when settled. --warm settles every case's
baseline when the runner starts, two at a time, so the first scenario is quick too.

Everything else is sim25_serve's: the endpoints, the checks on a request, the reply. Rated-pump
scenarios add wet-well tanks the baseline's hotstart does not have, so they are passed to
sim25_serve's own solve unchanged.

Because the baseline is now settled rather than run for 480 minutes, a reply can differ from
the published grid's row for the same scenario in the wet cases, where the grid's runs had not
settled (README.md, "Settling"). That is the point, but say so when comparing the two.
"""
import argparse
import sys
import tempfile
import threading
from concurrent.futures import Future

import sim25_serve

from ..common import unpack
from ..hotstart import run_task, settle_baseline

_settled, _locks, _locks_lock = {}, {}, threading.Lock()
_published_solve = sim25_serve.solve


def _as_grid_tuple(rec):
    """run_task's record -> the (head, growth_lps, err, state) sim25_grid._whole_task returns."""
    return rec["head"], rec["growth_lps"], rec["err"], unpack(rec["depths"], rec["flags"],
                                                              rec["chambers"])


def baseline(case):
    tag = case.tag()
    with _locks_lock:
        lock = _locks.setdefault(tag, threading.Lock())
    with lock:                   # one settle per case; different cases settle side by side
        if tag not in _settled:
            t = settle_baseline(case)
            t["tmp_root"] = tempfile.gettempdir()
            rec = sim25_serve._pool.submit(run_task, t).result()
            _settled[tag] = rec
            print(f"  {tag}: baseline settled at {rec['minutes']:.0f} simulated min"
                  + (" (CAPPED)" if rec["capped"] else ""), flush=True)
        return _settled[tag]


def solve(case, growth, pumps=None):
    if pumps is not None:
        return _published_solve(case, growth, pumps)
    base = baseline(case)
    if not growth:
        f = Future()
        f.set_result(_as_grid_tuple(base))
        return f
    t = {"key": None, "case": case, "whole": True, "growth": growth, "hotstart": base["hotstart"]}
    f = Future()
    inner = sim25_serve._pool.submit(run_task, t)
    inner.add_done_callback(lambda x: f.set_exception(x.exception()) if x.exception()
                            else f.set_result(_as_grid_tuple(x.result())))
    return f


def warm():
    """Settle every case's baseline in the background, two at a time (the runner's pool)."""
    for case in sim25_serve.CASES.values():
        threading.Thread(target=baseline, args=(case,), daemon=True).start()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--warm", action="store_true")
    mine, rest = ap.parse_known_args()
    sys.argv = [sys.argv[0]] + rest
    sim25_serve.solve = solve
    if mine.warm:
        # sim25_serve.main creates the pool and then blocks serving; warm once it exists.
        def later():
            import time
            while sim25_serve._pool is None:
                time.sleep(0.2)
            warm()
        threading.Thread(target=later, daemon=True).start()
    sim25_serve.main()


if __name__ == "__main__":
    main()
