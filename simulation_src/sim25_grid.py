#!/usr/bin/env python3
"""
sim25_grid.py - the Sim 2.5 growth grid and placement robustness (register G3 to G11; the corridor, G14, is in the legacy register).

For each CASE (weather level x peak factor x I&I distribution x boundary factor, G10), every
study manhole x every growth size, then placement by greedy set cover per detection rule (G6:
150 mm alarm, surcharge).

HOW EACH CASE IS RUN (validated 24 Sep, nesting X4 / X5):
    I&I <= NEST_MAX_II  nested: one whole-domain baseline hands the settled levels at the
                        segment's outlet and side exits to the 162-link segment, which runs
                        the growth grid alone (about 3.5 s a run). Validated: identical
                        detections in 12 of 12 growth cases, depth difference 0.0 mm.
    wetter              every growth run on the whole domain (about 20 s a run). Nesting was
                        tried and FAILED validation at 0.25 L/s per 100 m: 0 of 12 cases
                        matched, even with the exact levels handed over, because a surcharged
                        pipe discharging into a fixed-level outfall settles about 10 mm higher
                        than into the real manhole. A level-rise correction made it worse.
Plus the CORRIDOR family (G14): growth spread along Walkerville Terrace, whole domain only.

Robustness is reported as how often each manhole is chosen across cases.

Usage:
    python sim25_grid.py --plan                 # list cases and run counts, run nothing
    python sim25_grid.py --cases nominal        # the 4 nominal weather cases
    python sim25_grid.py --cases all            # nominal + every sensitivity
    python sim25_grid.py --sites 6 --cases nominal   # quick shape check
"""
import argparse, json, math, os, shutil, time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict

import numpy as np

import sim25
from sim25 import Case, Sim25Model, solve
import growth_osp

# Each study area has its own results folder, so a whole-area grid can never overwrite the
# segment results committed before the setting existed, and --resume never mistakes one
# area's summary.json for the other's.
OUT = os.path.join(sim25.OUT_DIR, "grid" if sim25.STUDY_AREA == "segment" else "grid_whole")
# In the whole area a rise is kept only where it reaches this, mm. 328 manholes in every one
# of 1,641 runs a case is about 13 MB of JSON, nearly all of it 0.0 at manholes the growth
# never reaches; the smallest published detection rule is 10 mm, so dropping rises below 1 mm
# loses nothing the page or the placement can use. The segment keeps every value, unchanged.
WHOLE_RISE_FLOOR_MM = 1.0
# R2, corrected 21 Oct 2026: every run ends on the convergence gate (sim25.SETTLE) and
# MAX_MINUTES is only the ceiling. 480 fixed minutes settled at 0.11 but not at 0.25 or 0.40;
# see docs/18_sim3_plan_DRAFT.md section 2. Each run's length and drift are recorded.
MAX_MINUTES = sim25.MAX_MINUTES
SETTLE = sim25.SETTLE
NEST_MAX_II = 0.11       # X4: nesting validated up to design wet only
CORRIDOR_BUFFER_M = 25.0
CORRIDOR_SIZES = list(sim25.CFG["simulation"]["corridor_dwellings"])   # P10; config.js


def cases(which):
    """The cases to run, the case set config.js selects: the weather sweep, then each sensitivity
    variant at each weather level the config names. Order is weather first, then by level,
    then by variant, which is the order the page lists them in."""
    nominal = [Case(ii=ii) for ii, _ in sim25.WEATHER]
    if which == "nominal":
        return nominal
    sens_cfg = sim25.CASE_CONFIG.get("sensitivity") or {}
    sens = [Case(ii=ii, **v["set"])
            for ii in sens_cfg.get("at_ii", [])
            for v in sens_cfg.get("variants", [])]
    return nominal + sens


def detected(st, base, c, rule):
    if rule == "alarm":
        return st[c]["alarm"] and not base[c]["alarm"]
    return st[c]["surcharged"] and not base[c]["surcharged"]


# ---------------------------------------------------------------------- workers
def _pin_worker(mask, omp_threads):
    """Runs once in every pool process. Two Windows facts found on 23 Oct 2026 while the 0.25
    grid crawled at 65 runs an hour on 5 and then 9 workers alike: (1) SWMM's engine is
    OpenMP-parallel and each worker spawned a thread per logical core, so nine workers
    fought over the same cores; (2) Windows 11 parked every background worker on the four
    efficiency cores of this hybrid CPU (cores 8 to 11 at 100%, the eight performance-core
    threads idle, 50 runnable threads queued). Pinning the workers to cores 0 to 7 pushed
    them straight to 100% each. mask is the affinity bitmask (0 leaves it alone); OMP
    threads per worker default to 1."""
    if omp_threads:
        os.environ["OMP_NUM_THREADS"] = str(omp_threads)
    if mask and os.name == "nt":
        import ctypes
        k32 = ctypes.windll.kernel32
        k32.SetProcessAffinityMask(k32.GetCurrentProcess(), ctypes.c_size_t(mask))


def _segment_task(args):
    case, head, exits, mh, add, run_dir = args
    m = Sim25Model(case, whole=False, outlet_head=head, exit_heads=exits,
                   growth={mh: add} if mh else None)
    try:
        res, st, _ = solve(m, MAX_MINUTES, run_dir, settle=SETTLE)
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)
    return mh, add, {c: {k: st[c][k] for k in ("depth", "alarm", "surcharged", "spilled")}
                     for c in m.study_chambers}, provenance(res)


def provenance(res):
    """What a run did, kept with its result: how long it ran, whether it settled, the
    largest drift in the final window, and SWMM's continuity error. Sim 2.5 recorded none
    of this (the public README says so)."""
    p = dict(res.settle or {"converged": None, "minutes": res.sc.minutes})
    p["continuity_err_pct"] = res.err
    pf = res.s.get("pump_flow")
    if pf is not None and len(pf) and len(res.s.get("pumps", [])):
        # What each station pumped over the final window, L/s: the SCADA indicator (Sim 3).
        p["pumps"] = {n: round(float(v), 4) for n, v in zip(res.s["pumps"], pf.mean(axis=0))}
    return p


def _whole_task(args):
    """One whole-domain run. An optional fifth element, pump rates ({} for every station at
    its default), solves with rated pumps over config.js's longer run and peak window; the
    grid never passes it, so its runs are the ideal-pump ones it always was."""
    case, growth_nodes, growth, run_dir, *rest = args
    pump_rates = rest[0] if rest else None
    m = Sim25Model(case, whole=True, growth=growth, growth_nodes=growth_nodes,
                   pump_rates=pump_rates)
    minutes, window, settle = MAX_MINUTES, 10, SETTLE
    if pump_rates is not None:
        # A stop-start pump never settles: a fixed longer run, peak over whole cycles.
        ps = sim25.pump_settings()
        minutes, window, settle = ps["minutes"], ps["window"], None
    try:
        res, st, head = solve(m, minutes, run_dir, window, settle)
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)
    return head, m.growth_lps, res.err, {
        c: {k: st[c][k] for k in ("depth", "alarm", "surcharged", "spilled")}
        for c in m.candidates}, provenance(res)


def _whole_task_ckpt(args):
    """_whole_task with a checkpoint beside the run folder (<run_dir>.json, the task's return
    value), so a grid stopped mid-case resumes at the run it reached instead of at the case.
    The PC's memory reaper stopped the Severe grid twice on 21 Oct and each stop lost every
    finished run of the case, because results lived only in the pool's memory until the
    case's summary.json was written. run_case deletes the checkpoints once that is written."""
    ck = args[3] + ".json"
    if os.path.exists(ck):
        with open(ck, encoding="utf-8") as f:
            return tuple(json.load(f))
    out = _whole_task(args)
    with open(ck, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, default=lambda o: o.item() if hasattr(o, "item") else float(o))
    return out


def corridor_nodes():
    """G14: network nodes along Walkerville Terrace, weighted by pipe length.

    Street geometry: OpenStreetMap via Nominatim (18 way segments), cached in
    data/raw/walkerville_tce.json in MGA zone 54. Only council pipes in the domain and outside
    the study segment count; measured 24 Sep, none of the terrace lies in the segment."""
    path = os.path.join(sim25.HERE, "data", "raw", "walkerville_tce.json")
    with open(path, encoding="utf-8") as f:
        pts = np.array(json.load(f)["points_mga54"])
    from scipy.spatial import cKDTree
    net = sim25.network()
    tree = cKDTree(pts)
    dom = sim25.Sim25Model._domain_pipes(type("x", (), {"net": net})())
    seg = set(net.upstream_pipes(sim25.SEGMENT_OUTLET))
    w = {}
    for i in dom - seg:
        p = net.pipes[i]
        if tree.query(np.array(p.line))[0].min() < CORRIDOR_BUFFER_M:
            w[p.up] = w.get(p.up, 0.0) + p.length
    tot = sum(w.values())
    return {n: v / tot for n, v in w.items()}


# ---------------------------------------------------------------------- one case
def run_case(case, pool, sites_limit, sizes):
    tag = case.tag()
    base_dir = os.path.join(OUT, tag)
    os.makedirs(base_dir, exist_ok=True)
    t0 = time.time()
    whole_area = sim25.STUDY_AREA == "whole"
    probe = Sim25Model(case, whole=whole_area, outlet_head=None if whole_area else 0.0)
    seg = probe.candidates
    mh_of = {c: probe.nodes[c].manhole_id for c in seg}

    sites = [mh_of[c] for c in seg][: sites_limit or None]
    # Nesting solves only the segment with its outlet level handed down (X4), so it cannot
    # hold growth placed anywhere else: a whole-area grid is whole-domain runs throughout.
    nested = case.ii <= NEST_MAX_II and not whole_area
    if nested:
        # The baseline whole run hands its levels to the segment runs.
        head_run = Sim25Model(case, whole=True)
        _, _, h0 = solve(head_run, MAX_MINUTES, os.path.join(base_dir, "w0"), settle=SETTLE)
        exits = head_run.exit_heads
        shutil.rmtree(os.path.join(base_dir, "w0"), ignore_errors=True)
        tasks = [(case, h0, exits, None, 0, os.path.join(base_dir, "s0"))]
        tasks += [(case, h0, exits, mh, add, os.path.join(base_dir, f"s_{mh}_{add}"))
                  for mh in sites for add in sizes]
        results = list(pool.map(_segment_task, tasks, chunksize=4))
    else:
        h0 = None
        tasks = [(case, None, None, os.path.join(base_dir, "w0"))]
        tasks += [(case, None, {mh: add}, os.path.join(base_dir, f"w_{mh}_{add}"))
                  for mh in sites for add in sizes]
        n_ck = sum(1 for t in tasks if os.path.exists(t[3] + ".json"))
        if n_ck:
            print(f"  {tag}: {n_ck} of {len(tasks)} runs already checkpointed, kept", flush=True)
        raw = list(pool.map(_whole_task_ckpt, tasks, chunksize=2))
        results = [(None, 0, raw[0][3], raw[0][4])] + [(mh, add, r[3], r[4]) for (_, _, g, _), r
                                                       in zip(tasks[1:], raw[1:])
                                                       for mh, add in g.items()]
    _, _, base, base_prov = results[0]
    rows = []
    for mh, add, st, prov in results[1:]:
        rows.append({"site": mh, "dwellings": add,
                     # How this run went: minutes to settle, converged or not, drift, error.
                     "run": {k: prov.get(k) for k in ("minutes", "converged", "max_drift_mm",
                                                      "continuity_err_pct")},
                     "alarm": sorted(mh_of[c] for c in seg if detected(st, base, c, "alarm")),
                     "surcharge": sorted(mh_of[c] for c in seg if detected(st, base, c, "surcharge")),
                     "spilled": sorted(mh_of[c] for c in seg if st[c]["spilled"]),
                     # Depth rise at every study manhole, mm. The graded observability
                     # matrix (docs/17 s1) is built from this, not from the yes/no sets.
                     "rise_mm": {str(mh_of[c]): r for c in seg
                                 for r in [round((st[c]["depth"] - base[c]["depth"]) * 1000, 2)]
                                 if not whole_area or r >= WHOLE_RISE_FLOOR_MM}})
    placement = {}
    for rule in ("alarm", "surcharge"):
        cover = growth_osp.greedy_cover([{"site": f"{r['site']}+{r['dwellings']}",
                                          "tipped": r[rule]} for r in rows])
        placement[rule] = {"chosen": [c["chamber"] for c in cover["chosen"]],
                           "scenarios": cover["scenarios"],
                           "undetectable": len(cover["uncoverable"])}
    runs = [r["run"] for r in rows]
    summary = {"case": asdict(case), "tag": tag,
               # minutes: the baseline's own run length (it used to be the fixed 480).
               "minutes": base_prov.get("minutes"),
               "run_length": {"ceiling_min": MAX_MINUTES, "settle": SETTLE, "baseline": base_prov,
                              "growth_runs": {"min_minutes": min(r["minutes"] for r in runs),
                                              "max_minutes": max(r["minutes"] for r in runs),
                                              "unconverged": sum(1 for r in runs if r["converged"] is False),
                                              "max_drift_mm": max((r["max_drift_mm"] or 0) for r in runs)}},
               "method": "nested" if nested else "whole", "outlet_head": h0,
               "baseline_depth_m": {str(mh_of[c]): round(base[c]["depth"], 4) for c in seg},
               "baseline": {"alarm": sorted(mh_of[c] for c in seg if base[c]["alarm"]),
                            "surcharged": sorted(mh_of[c] for c in seg if base[c]["surcharged"]),
                            # Spilling from the lid before growth, so a row's "spilled" can be
                            # read as new or not (added 14 Oct 2026).
                            "spilled": sorted(mh_of[c] for c in seg if base[c]["spilled"])},
               "rows": rows, "placement": placement, "wall_s": round(time.time() - t0)}
    with open(os.path.join(base_dir, "summary.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(summary, f, indent=1)
    if not nested:
        for t in tasks:
            if os.path.exists(t[3] + ".json"):
                os.remove(t[3] + ".json")
    gr = summary["run_length"]["growth_runs"]
    print(f"  {tag}: runs settled in {gr['min_minutes']} to {gr['max_minutes']} min"
          f" (baseline {base_prov.get('minutes')}), {gr['unconverged']} unconverged,"
          f" drift up to {gr['max_drift_mm']} mm")
    print(f"  {tag}: {len(rows)} growth runs, baseline alarm {len(summary['baseline']['alarm'])}"
          f" surcharged {len(summary['baseline']['surcharged'])}; sensors alarm "
          f"{placement['alarm']['chosen']} surcharge {placement['surcharge']['chosen']}"
          f" ({summary['wall_s']} s)", flush=True)
    return summary


def run_corridor(case, pool, resume=False):
    tag = case.tag()
    d = os.path.join(OUT, "corridor", tag)
    done = os.path.join(d, "summary.json")
    if resume and os.path.exists(done):
        with open(done, encoding="utf-8") as f:
            out = json.load(f)
        # Only a gated summary counts as done; the 480-minute ones staged from the teammate's
        # pull requests have no "run_length" and are re-run (22 Oct 2026).
        if "run_length" in out:
            print(f"  corridor {tag}: already done, kept", flush=True)
            return out
    os.makedirs(d, exist_ok=True)
    share = corridor_nodes()
    tasks = [(case, None, None, os.path.join(d, "base"))]
    for n in CORRIDOR_SIZES:
        tasks.append((case, {k: v * n for k, v in share.items()}, None,
                      os.path.join(d, f"g{n}")))
    res = list(pool.map(_whole_task_ckpt, tasks))
    base = res[0][3]
    whole_area = sim25.STUDY_AREA == "whole"
    probe = Sim25Model(case, whole=whole_area, outlet_head=None if whole_area else 0.0)
    mh_of = {c: probe.nodes[c].manhole_id for c in probe.candidates}
    rows = []
    # _whole_task returns five values since the convergence gate (the fifth is the run's
    # provenance); unpacking four here crashed the grid after the Severe case on 22 Oct 2026.
    for n, (head, glps, err, st, prov) in zip(CORRIDOR_SIZES, res[1:]):
        rows.append({"dwellings": n, "added_lps": glps, "outlet_head_rise_m": head - res[0][0],
                     "alarm": sorted(mh_of[c] for c in st if detected(st, base, c, "alarm")),
                     "surcharge": sorted(mh_of[c] for c in st if detected(st, base, c, "surcharge")),
                     "max_depth_rise_m": max(st[c]["depth"] - base[c]["depth"] for c in st),
                     "run": prov})
    out = {"case": asdict(case), "corridor_nodes": len(share),
           "run_length": {"ceiling_min": MAX_MINUTES, "baseline": res[0][4]}, "rows": rows}
    with open(done, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1)
    for t in tasks:
        if os.path.exists(t[3] + ".json"):
            os.remove(t[3] + ".json")
    for r in rows:
        print(f"  corridor {tag} +{r['dwellings']}: outlet rises {r['outlet_head_rise_m']*1000:.1f} mm,"
              f" max study rise {r['max_depth_rise_m']*1000:.1f} mm, newly alarm {r['alarm']},"
              f" surcharge {r['surcharge']}", flush=True)
    return out


def robustness(summaries):
    freq = {"alarm": {}, "surcharge": {}}
    for s in summaries:
        for rule in freq:
            for mh in s["placement"][rule]["chosen"]:
                freq[rule][mh] = freq[rule].get(mh, 0) + 1
    n = len(summaries)
    return {rule: sorted(({"manhole": k, "chosen_in": v, "of": n} for k, v in f.items()),
                         key=lambda r: -r["chosen_in"]) for rule, f in freq.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", default="nominal", choices=["nominal", "all"])
    ap.add_argument("--sites", type=int, default=0)
    ap.add_argument("--sizes", help="comma-separated growth sizes instead of config.js's (Sim 3: 80,150,700 for the 0.25 cases)")
    ap.add_argument("--only", help="run only cases whose tag contains this text, e.g. ii0.40")
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--no-corridor", action="store_true")
    ap.add_argument("--resume", action="store_true",
                    help="skip cases whose summary.json already exists, and within a whole-area "
                         "case the runs whose checkpoint exists (e.g. after a stopped run)")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--affinity", default=os.environ.get("SIM25_AFFINITY", "0xFF"),
                    help="CPU affinity bitmask for the workers, hex or decimal; 0 leaves Windows to "
                         "choose (it parks them on the efficiency cores). Default 0xFF: cores 0 to 7, "
                         "the performance cores of this 13th-gen i5")
    ap.add_argument("--omp-threads", type=int, default=1,
                    help="OpenMP threads per SWMM engine, 1 so workers do not fight for cores")
    args = ap.parse_args()
    affinity = int(args.affinity, 0)
    cs = cases(args.cases)
    if args.only:
        cs = [c for c in cs if args.only in c.tag()]
        if not cs:
            ap.error(f"--only {args.only} matches no case")
    sizes = [int(x) for x in args.sizes.split(",")] if args.sizes else sim25.GROWTH_DWELLINGS + [sim25.STRESS_DWELLINGS]
    whole_area = sim25.STUDY_AREA == "whole"
    n_sites = args.sites or (328 if whole_area else 71)
    per_case = 1 + n_sites * len(sizes)
    nest = [] if whole_area else [c for c in cs if c.ii <= NEST_MAX_II]
    seg_runs = len(nest) * per_case
    # 28.6 s is the measured mean of a whole-domain run on the Sim 2.5 grid of 25 Sep (the
    # old 20 s guess held only at low infiltration and put the grid at 94 min, not 2 h 18 m).
    whole_runs = (len(nest) + (len(cs) - len(nest)) * per_case
                  + (0 if args.no_corridor else len(sim25.WEATHER) * (1 + len(CORRIDOR_SIZES))))
    print(f"study area: {sim25.STUDY_AREA}, {n_sites} growth sites; results in {OUT}")
    print(f"{len(cs)} cases ({len(nest)} nested); {seg_runs} segment runs (~3.5 s each) + "
          f"{whole_runs} whole runs (~28.6 s each) on {args.workers} workers: about "
          f"{(seg_runs * 3.5 + whole_runs * 28.6) / args.workers / 60:.0f} min")
    for c in cs:
        print("   ", c.tag(), "nested" if c in nest else "whole")
    if args.plan:
        return
    os.makedirs(OUT, exist_ok=True)
    _pin_worker(affinity, args.omp_threads)
    with ProcessPoolExecutor(args.workers, initializer=_pin_worker,
                             initargs=(affinity, args.omp_threads)) as pool:
        summaries = []
        for c in cs:
            done = os.path.join(OUT, c.tag(), "summary.json")
            if args.resume and os.path.exists(done):
                with open(done, encoding="utf-8") as f:
                    summaries.append(json.load(f))
                print(f"  {c.tag()}: already done, kept", flush=True)
                continue
            summaries.append(run_case(c, pool, args.sites, sizes))
        # The corridor family follows --only and --resume like the cases do (22 Oct 2026).
        corridor = [] if args.no_corridor else [
            run_corridor(Case(ii=ii), pool, args.resume) for ii, _ in sim25.WEATHER
            if not args.only or args.only in Case(ii=ii).tag()]
    rob = robustness(summaries)
    with open(os.path.join(OUT, "robustness.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"cases": [s["tag"] for s in summaries], "robustness": rob}, f, indent=1)
    for rule, rows in rob.items():
        print(f"{rule}: " + ", ".join(f"MH{r['manhole']} {r['chosen_in']}/{r['of']}"
                                      for r in rows[:10]))


if __name__ == "__main__":
    main()
