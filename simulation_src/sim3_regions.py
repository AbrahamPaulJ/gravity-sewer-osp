#!/usr/bin/env python3
"""
sim3_regions.py - Sim 3 family A, infill: a REGION grows, not one manhole.

Sim 2.5 asked what one manhole sees when N dwellings land on it. Ten dwellings are 0.1 L/s
and a few millimetres anywhere, so the answer was "nothing until the stress case". The
the network operator's steer (28 Sep 2026) was to pick an area, assume its dwellings increase, and ask
which locations should be monitored. This module does that:

    region   every pipe draining to a named exit pipe (a tributary of the trunk), the 71
             manholes above MH4450193 being one of them; or "remainder" (every domain pipe
             no listed region claimed); or "corridor" (the Walkerville Terrace family).
             Regions are disjoint: a pipe two branches share through a relief pipe goes to
             the region listed first. Definitions: config.js simulation.regions.
    growth   a build-out step f of the region's nominal growth, spread over its EXISTING
             connection points in proportion to the dwellings on each pipe, and loaded
             where that pipe's dwellings are already loaded (its upstream node). So a new
             dwelling joins at a connection, not at a manhole (28 Sep, 23:22), and 100% is
             the region's share of the published 20-year projection landing in it.
    runs     whole domain, every candidate manhole watched, each run ended by the
             convergence gate (sim25.SETTLE) with its length and drift recorded.

Rows carry, per region and step: the depth rise at every candidate, which manholes newly
alarm, surcharge or spill, what each pump station pumps (the SCADA indicator), and the
run's provenance. The build-out fraction at which a candidate first sees the region is
read from the rows by the analysis step.

Usage:
    python sim3_regions.py --plan                       # regions, run counts, nothing run
    python sim3_regions.py --describe                   # write regions.json for the page
    python sim3_regions.py --cases nominal --workers 6  # the weather sweep
    python sim3_regions.py --cases all --resume --workers 6
    python sim3_regions.py --cases nominal --regions R1,R2 --steps 0.5,1.0   # a quick look
"""
import argparse, functools, json, os, shutil, sys, time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict

import model
import sim25
import sim25_grid
from sim25 import Case, Sim25Model

OUT = os.path.join(model.RESULTS, "sim3", "regions")
RCFG = sim25.CFG["simulation"].get("regions") or {}
ANCHOR = float(RCFG.get("anchor_dwellings", 485))
COUNCIL_CONNECTIONS = float(RCFG.get("council_connections", 2851))
LADDER = [float(x) for x in RCFG.get("ladder", [0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 3.0])]
RISE_FLOOR_MM = float(RCFG.get("rise_floor_mm", 0.5))


# ---------------------------------------------------------------------- the regions
def _domain():
    """The whole-domain model's pipes (exit pipes excluded), the network, and a probe model."""
    probe = Sim25Model(Case(), whole=True)
    net = sim25.network()
    return net, probe, probe._pipe_ids - probe._exits


def regions(net=None, probe=None, pipes=None):
    """config.js's regions resolved into disjoint pipe sets, in the listed order.

    Each entry: id, name, exit_pipe, pipes (network pipe ids), manholes (published ids),
    n_manholes, dwellings (connected properties counted on its pipes), length_m,
    nominal_dwellings (its 100% growth), weights (pipe id -> share of new dwellings)."""
    if net is None:
        net, probe, pipes = _domain()
    ins = {}
    for i in pipes:
        ins.setdefault(net.pipes[i].down, []).append(i)
    sys.setrecursionlimit(10000)

    @functools.lru_cache(None)
    def upstream(nid):
        s = set()
        for i in ins.get(nid, []):
            s.add(i)
            s |= upstream(net.pipes[i].up)
        return frozenset(s)

    by_asset = {net.pipes[i].asset_id: i for i in pipes}
    chamber_nodes = set(probe.chambers.values())
    claimed, out, remainder = set(), [], None
    for r in RCFG.get("list", []):
        key = r["exit_pipe"]
        if key == "remainder":
            remainder = r
            continue
        if key == "corridor":
            share = sim25_grid.corridor_nodes()          # node -> share by pipe length
            members = {i for i in pipes if net.pipes[i].up in share} - claimed
            weights = {i: share[net.pipes[i].up] for i in members}
            tot = sum(weights.values()) or 1.0
            weights = {i: w / tot for i, w in weights.items()}
            nominal = float(r.get("nominal_dwellings", ANCHOR))
        else:
            if key not in by_asset:
                raise ValueError(f"config.js regions: exit_pipe {key} ({r['id']}) is not a pipe in the model domain")
            pi = by_asset[key]
            members = ({pi} | set(upstream(net.pipes[pi].up))) - claimed
            weights = None
            nominal = None
        out.append(_region(r, members, weights, nominal, net, chamber_nodes))
        claimed |= members
    if remainder is not None:
        out.append(_region(remainder, pipes - claimed, None, None, net, chamber_nodes))
    ids = [x["id"] for x in out]
    if len(set(ids)) != len(ids):
        raise ValueError(f"config.js regions: duplicate ids {ids}")
    return out


def _region(r, members, weights, nominal, net, chamber_nodes):
    members = sorted(members)
    dw = sum(net.pipes[i].dwellings for i in members)
    if weights is None:
        # New dwellings follow the existing ones: each pipe's connections take its share.
        tot = dw or sum(net.pipes[i].length for i in members) or 1.0
        weights = {i: (net.pipes[i].dwellings if dw else net.pipes[i].length) / tot for i in members}
    if nominal is None:
        nominal = float(r.get("nominal_dwellings", ANCHOR * dw / COUNCIL_CONNECTIONS))
    mh_nodes = {net.pipes[i].up for i in members} & chamber_nodes
    return {"id": r["id"], "name": r["name"], "exit_pipe": r["exit_pipe"],
            "pipes": members, "manholes": sorted(net.nodes[n].manhole_id for n in mh_nodes),
            "n_manholes": len(mh_nodes), "dwellings": int(dw),
            "length_m": round(sum(net.pipes[i].length for i in members)),
            "nominal_dwellings": round(nominal, 1),
            "weights": {int(i): w for i, w in weights.items() if w > 0}}


def growth_nodes(region, step, net):
    """{network node id: new dwellings} for build-out fraction `step` of the region."""
    n = step * region["nominal_dwellings"]
    g = {}
    for i, w in region["weights"].items():
        u = net.pipes[int(i)].up
        g[u] = g.get(u, 0.0) + n * w
    return g


# ---------------------------------------------------------------------- one case
def run_case(case, pool, regs, steps, net, probe):
    tag = case.tag()
    base_dir = os.path.join(OUT, tag)
    os.makedirs(base_dir, exist_ok=True)
    t0 = time.time()
    cands = probe.candidates
    mh_of = {c: probe.nodes[c].manhole_id for c in cands}

    tasks = [(case, None, None, os.path.join(base_dir, "base"))]
    keys = []
    for r in regs:
        for f in steps:
            tasks.append((case, growth_nodes(r, f, net), None,
                          os.path.join(base_dir, f"{r['id']}_{f:g}")))
            keys.append((r, f))
    raw = list(pool.map(sim25_grid._whole_task, tasks, chunksize=1))
    _, _, _, base, base_prov = raw[0]

    def newly(st, k):
        return sorted(mh_of[c] for c in cands if st[c][k] and not base[c][k])

    rows = []
    for (r, f), (head, glps, err, st, prov) in zip(keys, raw[1:]):
        rows.append({"region": r["id"], "step": f,
                     "dwellings": round(f * r["nominal_dwellings"], 1),
                     "added_lps": round(glps, 4),
                     "alarm": newly(st, "alarm"), "surcharge": newly(st, "surcharged"),
                     "spilled": newly(st, "spilled"),
                     "rise_mm": {str(mh_of[c]): rr for c in cands
                                 for rr in [round((st[c]["depth"] - base[c]["depth"]) * 1000, 2)]
                                 if rr >= RISE_FLOOR_MM},
                     "pumps": prov.get("pumps"),
                     "run": {k: prov.get(k) for k in ("minutes", "converged", "max_drift_mm",
                                                      "continuity_err_pct")}})
    runs = [x["run"] for x in rows]
    summary = {
        "case": asdict(case), "tag": tag, "family": "infill regions",
        "anchor_dwellings": ANCHOR, "council_connections": COUNCIL_CONNECTIONS,
        "ladder": steps, "rise_floor_mm": RISE_FLOOR_MM,
        "regions": [{k: v for k, v in r.items() if k not in ("pipes", "weights")} for r in regs],
        "candidates": [mh_of[c] for c in cands],
        "baseline_depth_m": {str(mh_of[c]): round(base[c]["depth"], 4) for c in cands},
        "baseline": {"alarm": sorted(mh_of[c] for c in cands if base[c]["alarm"]),
                     "surcharged": sorted(mh_of[c] for c in cands if base[c]["surcharged"]),
                     "spilled": sorted(mh_of[c] for c in cands if base[c]["spilled"]),
                     "pumps": base_prov.get("pumps")},
        "run_length": {"ceiling_min": sim25_grid.MAX_MINUTES, "settle": sim25_grid.SETTLE,
                       "baseline": base_prov,
                       "growth_runs": {"min_minutes": min(x["minutes"] for x in runs),
                                       "max_minutes": max(x["minutes"] for x in runs),
                                       "unconverged": sum(1 for x in runs if x["converged"] is False),
                                       "max_drift_mm": max((x["max_drift_mm"] or 0) for x in runs)}},
        "rows": rows, "wall_s": round(time.time() - t0)}
    with open(os.path.join(base_dir, "summary.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(summary, f, indent=1)
    gr = summary["run_length"]["growth_runs"]
    print(f"  {tag}: {len(rows)} runs in {summary['wall_s']} s; settled in {gr['min_minutes']} to "
          f"{gr['max_minutes']} min, {gr['unconverged']} unconverged; baseline alarm "
          f"{len(summary['baseline']['alarm'])}, surcharged {len(summary['baseline']['surcharged'])}",
          flush=True)
    for r in regs:
        seen = [(x["step"], max(x["rise_mm"].values(), default=0.0), len(x["alarm"]))
                for x in rows if x["region"] == r["id"]]
        print(f"    {r['id']} ({r['nominal_dwellings']:g} dwellings at 100%): "
              + ", ".join(f"{f:g}: {m:.0f} mm, {a} new alarm" for f, m, a in seen), flush=True)
    return summary


def describe(regs, path):
    out = {"anchor_dwellings": ANCHOR, "council_connections": COUNCIL_CONNECTIONS, "ladder": LADDER,
           "regions": [{k: v for k, v in r.items() if k not in ("pipes", "weights")} for r in regs]}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", default="nominal", choices=["nominal", "all"])
    ap.add_argument("--regions", help="comma-separated region ids, default all")
    ap.add_argument("--steps", help="comma-separated build-out fractions, default the ladder")
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--describe", action="store_true", help="write regions.json and stop")
    ap.add_argument("--resume", action="store_true", help="skip cases whose summary.json exists")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = ap.parse_args()

    net, probe, pipes = _domain()
    regs = regions(net, probe, pipes)
    if args.regions:
        want = set(args.regions.split(","))
        missing = want - {r["id"] for r in regs}
        if missing:
            ap.error(f"unknown regions {sorted(missing)}; have {[r['id'] for r in regs]}")
        regs = [r for r in regs if r["id"] in want]
    steps = [float(x) for x in args.steps.split(",")] if args.steps else LADDER
    cs = sim25_grid.cases(args.cases)

    print(f"study area {sim25.STUDY_AREA}: {len(probe.candidates)} candidate manholes; "
          f"anchor {ANCHOR:g} dwellings over {COUNCIL_CONNECTIONS:g} connections")
    print(f"{'id':4} {'manholes':>8} {'dwellings':>9} {'length m':>8} {'100% growth':>11}  name")
    for r in regs:
        print(f"{r['id']:4} {r['n_manholes']:>8} {r['dwellings']:>9} {r['length_m']:>8} "
              f"{r['nominal_dwellings']:>11g}  {r['name']}")
    per_case = 1 + len(regs) * len(steps)
    print(f"{len(cs)} cases x {per_case} whole-domain runs = {len(cs) * per_case}, about "
          f"{len(cs) * per_case * 70 / args.workers / 60:.0f} min on {args.workers} workers "
          f"(70 s a run, gated); ladder {steps}")
    if args.describe:
        p = os.path.join(OUT, "regions.json")
        describe(regs, p)
        print("wrote", p)
        return
    if args.plan:
        return
    os.makedirs(OUT, exist_ok=True)
    with ProcessPoolExecutor(args.workers) as pool:
        for c in cs:
            done = os.path.join(OUT, c.tag(), "summary.json")
            if args.resume and os.path.exists(done):
                print(f"  {c.tag()}: already done, kept", flush=True)
                continue
            run_case(c, pool, regs, steps, net, probe)
    describe(regions(net, probe, pipes), os.path.join(OUT, "regions.json"))


if __name__ == "__main__":
    main()
