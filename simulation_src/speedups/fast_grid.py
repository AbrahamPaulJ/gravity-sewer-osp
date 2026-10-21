#!/usr/bin/env python3
"""
fast_grid.py - the Sim 2.5 grid with the speed-ups in this folder. Run from simulation_src:

    python -m speedups.fast_grid --plan                       # cases and run counts only
    python -m speedups.fast_grid --cases all --workers 6      # hotstart + settle + one pool
    python -m speedups.fast_grid --cases all --shard 0/4      # this machine's quarter
    python -m speedups.distributed.merge --out <out>          # after every shard is in
    python -m speedups.fast_grid --cases all --executor dask --scheduler tcp://host:8786

The same cases, sites, sizes, detection rules and placement as sim25_grid.py (it imports them
from there), and the same summary files, written to a separate folder (grid_fast, or
grid_whole_fast in the whole area). What changes is how each run is solved:

    1 hotstart   growth runs start from their case's settled baseline     (--no-hotstart)
    2 converge   every run stops when settled, not at 480 minutes          (--fixed-minutes 480)
    3 one pool   every case's runs in one queue, the longest first         (always)
    5 shards     --shard i/n, or --executor dask

--no-hotstart --fixed-minutes 480 solves every run as sim25_grid does (cold, 480 minutes),
which checks this pipeline against the published one; compare.py sets the two side by side.
"""
import argparse
import os
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict

import sim25
import sim25_grid
from sim25 import Case, Sim25Model

from .common import write_json
from .distributed import shard as sharding
from .hotstart import run_task, settle_baseline
from .hotstart.tasks import RUN_CAP_MIN, BASELINE_CAP_MIN
from .one_pool import run_all
from .outputs import write_all

# Relative cost of a whole-domain run against a segment run, for longest-first ordering:
# about 28.6 s against 3.5 s in sim25_grid's own measurements.
WHOLE_COST = 8.0


def _strip(rec):
    return {k: v for k, v in rec.items() if k != "hotstart"}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--cases", default="nominal", choices=["nominal", "all"])
    ap.add_argument("--only", nargs="+", default=None, metavar="TAG",
                    help="only these case tags (e.g. ii0.11_flat_uniform_b1_sfree)")
    ap.add_argument("--sites", type=int, default=0, help="first N sites only (a quick check)")
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--no-corridor", action="store_true")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) // 2),
                    help="local processes; default the physical cores (logical / 2)")
    ap.add_argument("--out", default=None)
    ap.add_argument("--no-hotstart", action="store_true", help="start growth runs from empty pipes")
    ap.add_argument("--fixed-minutes", type=int, default=0,
                    help="run every run exactly this long instead of until settled")
    ap.add_argument("--tol-mm", type=float, default=0.2, help="settling tolerance, mm")
    ap.add_argument("--run-cap", type=int, default=RUN_CAP_MIN)
    ap.add_argument("--baseline-cap", type=int, default=BASELINE_CAP_MIN)
    ap.add_argument("--shard", default=None, help="i/n: run only shard i of n, then merge")
    ap.add_argument("--executor", default="local", choices=["local", "dask"])
    ap.add_argument("--scheduler", default=None, help="Dask scheduler address")
    args = ap.parse_args()

    cs = sim25_grid.cases(args.cases)
    if args.only:
        cs = [c for c in cs if c.tag() in args.only]
        if not cs:
            raise SystemExit(f"--only matched no case of {args.cases}")
    sizes = sim25.GROWTH_DWELLINGS + [sim25.STRESS_DWELLINGS]
    whole_area = sim25.STUDY_AREA == "whole"
    out = args.out or os.path.join(sim25.OUT_DIR, ("grid_whole" if whole_area else "grid") + "_fast")
    tol = args.tol_mm / 1000.0
    fixed = args.fixed_minutes or None
    corridor_cases = [] if args.no_corridor else [Case(ii=ii) for ii, _ in sim25.WEATHER]
    nested = {c.tag(): (not whole_area and c.ii <= sim25_grid.NEST_MAX_II) for c in cs}
    probe = Sim25Model(cs[0], whole=whole_area, outlet_head=None if whole_area else 0.0)
    sites = [probe.nodes[c].manhole_id for c in probe.candidates][: args.sites or None]
    shard = sharding.parse(args.shard) if args.shard else None

    n_grow = len(cs) * len(sites) * len(sizes)
    n_corr = len(corridor_cases) * len(sim25_grid.CORRIDOR_SIZES)
    print(f"study area {sim25.STUDY_AREA}, {len(sites)} sites x {len(sizes)} sizes; "
          f"{len(cs)} cases ({sum(nested.values())} nested); {n_grow} growth + {n_corr} corridor runs"
          + (f"; shard {shard[0]} of {shard[1]}: about {(n_grow + n_corr) // shard[1]} runs" if shard else ""))
    print(f"runs: {'cold' if args.no_hotstart else 'from the settled baseline'}, "
          f"{f'{fixed} minutes' if fixed else f'until settled within {args.tol_mm} mm (cap {args.run_cap} min)'}; "
          f"results in {out}")
    if args.plan:
        return

    t0 = time.time()
    if args.executor == "dask":
        from .distributed.dask_pool import executor
        ex, close = executor(args.scheduler), (lambda: None)
    else:
        pool = ProcessPoolExecutor(args.workers)
        ex, close = pool, pool.shutdown

    def base_task(case, **kw):
        t = settle_baseline(case, tol_m=tol, cap_minutes=args.baseline_cap, **kw)
        t["fixed_minutes"] = fixed
        return t

    try:
        # Baselines: every case's whole-domain baseline at once, then the nested segments'.
        base_cases = {c.tag(): c for c in cs + corridor_cases}
        recs = run_all(ex, run_task, [base_task(c) for c in base_cases.values()],
                       label="whole baselines", every=1)
        wbase = {r["key"][1]: r for r in recs}
        seg_cases = [c for c in cs if nested[c.tag()]]
        sbase = {}
        if seg_cases:
            recs = run_all(ex, run_task, [base_task(c, whole=False,
                                                    outlet_head=wbase[c.tag()]["head"],
                                                    exit_heads=wbase[c.tag()]["exit_heads"])
                                          for c in seg_cases], label="segment baselines", every=1)
            sbase = {r["key"][1]: r for r in recs}

        # Growth runs, every case in one list, in a fixed order (sharding deals from it).
        tasks, expected = [], {}
        for c in cs:
            tag = c.tag()
            nest = nested[tag]
            b = sbase[tag] if nest else wbase[tag]
            for k, (mh, add) in enumerate((mh, add) for mh in sites for add in sizes):
                tasks.append({"key": ("grow", tag, k, mh, add), "case": c, "whole": not nest,
                              "growth": {mh: add},
                              "outlet_head": wbase[tag]["head"] if nest else None,
                              "exit_heads": wbase[tag]["exit_heads"] if nest else None,
                              "hotstart": None if args.no_hotstart else b["hotstart"],
                              "fixed_minutes": fixed, "cap_minutes": args.run_cap, "tol_m": tol,
                              "_cost": b["minutes"] * (1 if nest else WHOLE_COST)})
            expected[tag] = len(sites) * len(sizes)
        share = sim25_grid.corridor_nodes() if corridor_cases else {}
        for c in corridor_cases:
            tag, b = c.tag(), wbase[c.tag()]
            for k, n in enumerate(sim25_grid.CORRIDOR_SIZES):
                tasks.append({"key": ("corr", tag, k, n), "case": c, "whole": True,
                              "growth_nodes": {nid: v * n for nid, v in share.items()},
                              "hotstart": None if args.no_hotstart else b["hotstart"],
                              "fixed_minutes": fixed, "cap_minutes": args.run_cap, "tol_m": tol,
                              "_cost": b["minutes"] * WHOLE_COST})
            expected["corr:" + tag] = len(sim25_grid.CORRIDOR_SIZES)
        if shard:
            tasks = sharding.select(tasks, *shard)
        recs = run_all(ex, run_task, tasks, cost=lambda t: t["_cost"], label="growth runs")
    finally:
        close()
    wall = time.time() - t0

    grid, corridor = {}, {}
    for r in recs:
        kind, tag = r["key"][0], r["key"][1]
        (grid if kind == "grow" else corridor).setdefault(tag, []).append(_strip(r))

    def group(c, kind, runs):
        tag = c.tag()
        nest = kind == "grid" and nested[tag]
        return {"case": c, "kind": kind, "method": "nested" if nest else "whole",
                "baseline": _strip(sbase[tag] if nest else wbase[tag]),
                "outlet_head": wbase[tag]["head"] if nest else None,
                "corridor_nodes": len(share) if kind == "corridor" else None, "runs": runs}

    grid_groups = [group(c, "grid", grid.get(c.tag(), [])) for c in cs]
    corr_groups = [group(c, "corridor", corridor.get(c.tag(), [])) for c in corridor_cases]
    if shard:
        i, n = shard
        for order, g in enumerate(grid_groups + corr_groups):
            tag = g["case"].tag()
            key = tag if g["kind"] == "grid" else "corr:" + tag
            sub = tag if g["kind"] == "grid" else "corridor_" + tag
            payload = {"tag": sub, "case": asdict(g["case"]), "kind": g["kind"],
                       "method": g["method"], "baseline": g["baseline"],
                       "outlet_head": g["outlet_head"], "corridor_nodes": g["corridor_nodes"],
                       "expected": expected[key], "order": order, "wall_s": round(wall),
                       "runs": g["runs"]}
            write_json(sharding.path(out, sub, i, n), payload, indent=None)
        print(f"shard {i} of {n}: {len(recs)} runs in {wall/60:.1f} min; merge with "
              f"python -m speedups.distributed.merge --out {out}")
        return
    write_all(out, grid_groups, corr_groups, wall)
    print(f"{len(recs)} runs in {wall/60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
