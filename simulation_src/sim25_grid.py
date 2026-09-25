#!/usr/bin/env python3
"""
sim25_grid.py - the Sim 2.5 growth grid and placement robustness (register G3 to G14).

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

OUT = os.path.join(sim25.OUT_DIR, "grid")
MINUTES = 480            # R2: settled within 0.2 mm by 480 min at every weather level tested
NEST_MAX_II = 0.11       # X4: nesting validated up to design wet only
CORRIDOR_BUFFER_M = 25.0
CORRIDOR_SIZES = [80, 150, 390, 485]   # P05; 390 / 485 = projected 2021-41 medium / high


def cases(which):
    nominal = [Case(ii=ii) for ii, _ in sim25.WEATHER]
    if which == "nominal":
        return nominal
    sens = []
    for ii in (0.11, 0.25):                   # design wet and beyond design
        sens += [Case(ii=ii, pf="harmon"), Case(ii=ii, age="weighted"),
                 Case(ii=ii, bfac=0.5), Case(ii=ii, bfac=1.5)]
    return nominal + sens


def detected(st, base, c, rule):
    if rule == "alarm":
        return st[c]["alarm"] and not base[c]["alarm"]
    return st[c]["surcharged"] and not base[c]["surcharged"]


# ---------------------------------------------------------------------- workers
def _segment_task(args):
    case, head, exits, mh, add, run_dir = args
    m = Sim25Model(case, whole=False, outlet_head=head, exit_heads=exits,
                   growth={mh: add} if mh else None)
    try:
        _, st, _ = solve(m, MINUTES, run_dir)
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)
    return mh, add, {c: {k: st[c][k] for k in ("depth", "alarm", "surcharged", "spilled")}
                     for c in m.study_chambers}


def _whole_task(args):
    case, growth_nodes, growth, run_dir = args
    m = Sim25Model(case, whole=True, growth=growth, growth_nodes=growth_nodes)
    try:
        res, st, head = solve(m, MINUTES, run_dir)
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)
    return head, m.growth_lps, res.err, {
        c: {k: st[c][k] for k in ("depth", "alarm", "surcharged", "spilled")}
        for c in m.study_chambers}


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
    probe = Sim25Model(case, whole=False, outlet_head=0.0)
    seg = probe.study_chambers
    mh_of = {c: probe.nodes[c].manhole_id for c in seg}

    sites = [mh_of[c] for c in seg][: sites_limit or None]
    nested = case.ii <= NEST_MAX_II
    if nested:
        # The baseline whole run hands its levels to the segment runs.
        head_run = Sim25Model(case, whole=True)
        _, _, h0 = solve(head_run, MINUTES, os.path.join(base_dir, "w0"))
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
        raw = list(pool.map(_whole_task, tasks, chunksize=2))
        results = [(None, 0, raw[0][3])] + [(mh, add, r[3]) for (_, _, g, _), r
                                            in zip(tasks[1:], raw[1:])
                                            for mh, add in g.items()]
    _, _, base = results[0]
    rows = []
    for mh, add, st in results[1:]:
        rows.append({"site": mh, "dwellings": add,
                     "alarm": sorted(mh_of[c] for c in seg if detected(st, base, c, "alarm")),
                     "surcharge": sorted(mh_of[c] for c in seg if detected(st, base, c, "surcharge")),
                     "spilled": sorted(mh_of[c] for c in seg if st[c]["spilled"]),
                     # Depth rise at every study manhole, mm. The graded observability
                     # matrix (docs/17 s1) is built from this, not from the yes/no sets.
                     "rise_mm": {str(mh_of[c]): round((st[c]["depth"] - base[c]["depth"]) * 1000, 2)
                                 for c in seg}})
    placement = {}
    for rule in ("alarm", "surcharge"):
        cover = growth_osp.greedy_cover([{"site": f"{r['site']}+{r['dwellings']}",
                                          "tipped": r[rule]} for r in rows])
        placement[rule] = {"chosen": [c["chamber"] for c in cover["chosen"]],
                           "scenarios": cover["scenarios"],
                           "undetectable": len(cover["uncoverable"])}
    summary = {"case": asdict(case), "tag": tag, "minutes": MINUTES,
               "method": "nested" if nested else "whole", "outlet_head": h0,
               "baseline_depth_m": {str(mh_of[c]): round(base[c]["depth"], 4) for c in seg},
               "baseline": {"alarm": sorted(mh_of[c] for c in seg if base[c]["alarm"]),
                            "surcharged": sorted(mh_of[c] for c in seg if base[c]["surcharged"])},
               "rows": rows, "placement": placement, "wall_s": round(time.time() - t0)}
    with open(os.path.join(base_dir, "summary.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(summary, f, indent=1)
    print(f"  {tag}: {len(rows)} growth runs, baseline alarm {len(summary['baseline']['alarm'])}"
          f" surcharged {len(summary['baseline']['surcharged'])}; sensors alarm "
          f"{placement['alarm']['chosen']} surcharge {placement['surcharge']['chosen']}"
          f" ({summary['wall_s']} s)", flush=True)
    return summary


def run_corridor(case, pool):
    tag = case.tag()
    d = os.path.join(OUT, "corridor", tag)
    os.makedirs(d, exist_ok=True)
    share = corridor_nodes()
    tasks = [(case, None, None, os.path.join(d, "base"))]
    for n in CORRIDOR_SIZES:
        tasks.append((case, {k: v * n for k, v in share.items()}, None,
                      os.path.join(d, f"g{n}")))
    res = list(pool.map(_whole_task, tasks))
    base = res[0][3]
    probe = Sim25Model(case, whole=False, outlet_head=0.0)
    mh_of = {c: probe.nodes[c].manhole_id for c in probe.study_chambers}
    rows = []
    for n, (head, glps, err, st) in zip(CORRIDOR_SIZES, res[1:]):
        rows.append({"dwellings": n, "added_lps": glps, "outlet_head_rise_m": head - res[0][0],
                     "alarm": sorted(mh_of[c] for c in st if detected(st, base, c, "alarm")),
                     "surcharge": sorted(mh_of[c] for c in st if detected(st, base, c, "surcharge")),
                     "max_depth_rise_m": max(st[c]["depth"] - base[c]["depth"] for c in st)})
    out = {"case": asdict(case), "corridor_nodes": len(share), "rows": rows}
    with open(os.path.join(d, "summary.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1)
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
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--no-corridor", action="store_true")
    ap.add_argument("--resume", action="store_true",
                    help="skip cases whose summary.json already exists (e.g. after a stopped run)")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = ap.parse_args()
    cs = cases(args.cases)
    sizes = sim25.GROWTH_DWELLINGS + [sim25.STRESS_DWELLINGS]
    n_sites = args.sites or 71
    per_case = 1 + n_sites * len(sizes)
    nest = [c for c in cs if c.ii <= NEST_MAX_II]
    seg_runs = len(nest) * per_case
    whole_runs = (len(nest) + (len(cs) - len(nest)) * per_case
                  + (0 if args.no_corridor else 4 * (1 + len(CORRIDOR_SIZES))))
    print(f"{len(cs)} cases ({len(nest)} nested); {seg_runs} segment runs (~3.5 s each) + "
          f"{whole_runs} whole runs (~20 s each) on {args.workers} workers: about "
          f"{(seg_runs * 3.5 + whole_runs * 20) / args.workers / 60:.0f} min")
    for c in cs:
        print("   ", c.tag(), "nested" if c.ii <= NEST_MAX_II else "whole")
    if args.plan:
        return
    os.makedirs(OUT, exist_ok=True)
    with ProcessPoolExecutor(args.workers) as pool:
        summaries = []
        for c in cs:
            done = os.path.join(OUT, c.tag(), "summary.json")
            if args.resume and os.path.exists(done):
                with open(done, encoding="utf-8") as f:
                    summaries.append(json.load(f))
                print(f"  {c.tag()}: already done, kept", flush=True)
                continue
            summaries.append(run_case(c, pool, args.sites, sizes))
        corridor = [] if args.no_corridor else [
            run_corridor(Case(ii=ii), pool) for ii, _ in sim25.WEATHER]
    rob = robustness(summaries)
    with open(os.path.join(OUT, "robustness.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"cases": [s["tag"] for s in summaries], "robustness": rob}, f, indent=1)
    for rule, rows in rob.items():
        print(f"{rule}: " + ", ".join(f"MH{r['manhole']} {r['chosen_in']}/{r['of']}"
                                      for r in rows[:10]))


if __name__ == "__main__":
    main()
