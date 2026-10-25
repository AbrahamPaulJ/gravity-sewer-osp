#!/usr/bin/env python3
"""
scenarios.py - growth scenario families for Sim 2.5, and placement evaluated across them.

The grid (sim25_grid.py) adds growth at one manhole at a time. Real growth comes in patterns,
and a sensor set chosen for one pattern may not see another. This file turns each pattern
into a FAMILY of scenarios, runs them in SWMM under every case, and scores placement chosen on
one family against every other (the transfer matrix).

FAMILIES (config.js simulation.growth_scenarios)

    single    the grid's own runs: one manhole, 10 to 700 dwellings. Read from the grid's
              summaries, not run here.
    infill    a share of the existing connected properties is redeveloped, each lot becoming
              dwellings_per_lot dwellings, so it adds dwellings_per_lot - 1. Lots are the
              published connections the baseline already loads (2,565 in the whole area), and
              each new dwelling sits where its lot's load already sits: the upstream node of
              the pipe its connection was joined to (network.py, D11). Which lots redevelop is
              unknown, so each share is drawn `draws` times, seeded.
    combined  background infill at one share plus one concentrated block of new dwellings at
              one manhole (a new estate or a redeveloped site). Draw r's infill is exactly
              infill draw r at the same share, so the difference between the two families is
              the block alone. The block's manhole is drawn from the candidates.

Every scenario is a whole-domain run (nesting cannot hold growth outside the segment, X4) with
the grid's settling time and detection rules, so a family's rows read exactly like the grid's.

Usage:
    python scenarios.py --plan                       # families, scenario counts, run time
    python scenarios.py --describe                   # dwellings and sites per scenario, no SWMM
    python scenarios.py --run --cases all --workers 11 [--resume]
    python scenarios.py --score                      # transfer matrix -> evaluation.json
"""
import argparse, json, os, time
from dataclasses import asdict, dataclass, field

import numpy as np

import sim25
import sim25_grid
from sim25 import Sim25Model

CFG = sim25.CFG["simulation"]
SPEC = CFG["growth_scenarios"]
OUT = os.path.join(sim25_grid.OUT, "scenarios")
RULES_YN = ("alarm", "surcharge")
RISES_MM = list(CFG["detection_rises_mm"])
MAX_SENSORS = CFG["max_sensors"]


@dataclass
class Scenario:
    tag: str
    family: str
    params: dict
    growth_nodes: dict = field(default_factory=dict)   # network node id -> added dwellings

    @property
    def dwellings(self):
        return sum(self.growth_nodes.values())


# ---------------------------------------------------------------------- generators
def lots(m):
    """Every connected property the baseline loads, as the network node its load sits on, one
    entry per property, in a fixed order. Restricted to the study segment when that is the
    study area, so growth lands only where the candidates are."""
    net = m.net
    area = None
    if sim25.STUDY_AREA == "segment":
        area = set(net.upstream_pipes(sim25.SEGMENT_OUTLET))
    out = []
    for pi in sorted(m._pipe_ids):
        p = net.pipes[pi]
        if pi in m._exits or not p.dwellings or (area is not None and pi not in area):
            continue
        if m.nodes[m.node_of[p.up]].kind == "outfall":
            continue
        out += [p.up] * p.dwellings
    return out


def _check(spec):
    """Fail before a SWMM run does, as load_cases does for the cases."""
    where = f"{sim25.CASES_FILE}: simulation.growth_scenarios"
    inf, com = spec.get("infill"), spec.get("combined")
    if not inf and not com:
        raise ValueError(f"{where}: needs an 'infill' or a 'combined' family")
    for name, f in (("infill", inf), ("combined", com)):
        if not f:
            continue
        shares = f["shares"] if name == "infill" else [f["infill_share"]]
        if not all(0 < s <= 1 for s in shares):
            raise ValueError(f"{where}.{name}: every share must lie in (0, 1], got {shares}")
        if f["dwellings_per_lot"] < 2:
            raise ValueError(f"{where}.{name}: dwellings_per_lot below 2 adds nothing")
        if f["draws"] < 1:
            raise ValueError(f"{where}.{name}: draws must be at least 1")
    if com and not all(b > 0 for b in com["block_dwellings"]):
        raise ValueError(f"{where}.combined: block_dwellings must be positive")


def infill_draw(lot_nodes, share, per_lot, draw, seed):
    """{node: added dwellings} for one infill draw. Seeded by (seed, share, per_lot, draw) only,
    so the same draw is reproduced by the combined family."""
    n_pick = int(np.floor(share * len(lot_nodes) + 0.5))
    rng = np.random.default_rng([seed, 1, round(share * 10000), per_lot, draw])
    pick = rng.choice(len(lot_nodes), size=n_pick, replace=False)
    g = {}
    for i in sorted(pick.tolist()):
        g[lot_nodes[i]] = g.get(lot_nodes[i], 0) + per_lot - 1
    return g


def generate(m=None, spec=SPEC):
    """Every scenario config.js asks for, in a fixed order."""
    _check(spec)
    m = m or Sim25Model(sim25.Case(), whole=True)
    seed = spec["seed"]
    lot_nodes = lots(m)
    sites = [(m.nodes[c].manhole_id, m.chambers[c]) for c in m.candidates]
    out = []
    inf = spec.get("infill")
    if inf:
        for s in inf["shares"]:
            for r in range(inf["draws"]):
                out.append(Scenario(
                    f"infill_s{s:.2f}_d{inf['dwellings_per_lot']}_r{r:02d}", "infill",
                    {"share": s, "dwellings_per_lot": inf["dwellings_per_lot"], "draw": r},
                    infill_draw(lot_nodes, s, inf["dwellings_per_lot"], r, seed)))
    com = spec.get("combined")
    if com:
        s, d = com["infill_share"], com["dwellings_per_lot"]
        for b in com["block_dwellings"]:
            for r in range(com["draws"]):
                g = infill_draw(lot_nodes, s, d, r, seed)
                rng = np.random.default_rng([seed, 2, b, r])
                mh, nid = sites[int(rng.integers(len(sites)))]
                g[nid] = g.get(nid, 0) + b
                out.append(Scenario(
                    f"combined_s{s:.2f}_d{d}_b{b}_r{r:02d}", "combined",
                    {"share": s, "dwellings_per_lot": d, "block": b, "block_site": mh,
                     "draw": r}, g))
    return out


# ---------------------------------------------------------------------- running
def run_case(case, scen, pool):
    tag = case.tag()
    d = os.path.join(OUT, tag)
    os.makedirs(d, exist_ok=True)
    t0 = time.time()
    tasks = [(case, None, None, os.path.join(d, "base"))]
    tasks += [(case, sc.growth_nodes, None, os.path.join(d, sc.tag)) for sc in scen]
    res = list(pool.map(sim25_grid._whole_task, tasks, chunksize=2))
    probe = Sim25Model(case, whole=True)
    mh_of = {c: probe.nodes[c].manhole_id for c in probe.candidates}
    head0, _, _, base = res[0]
    det = sim25_grid.detected
    rows = []
    for sc, (head, glps, err, st) in zip(scen, res[1:]):
        rows.append({"tag": sc.tag, "family": sc.family, "params": sc.params,
                     "dwellings": sc.dwellings, "sites": len(sc.growth_nodes),
                     "added_lps": round(glps, 4), "continuity_error_pct": round(err, 3),
                     "alarm": sorted(mh_of[c] for c in st if det(st, base, c, "alarm")),
                     "surcharge": sorted(mh_of[c] for c in st if det(st, base, c, "surcharge")),
                     "spilled": sorted(mh_of[c] for c in st if st[c]["spilled"]),
                     "rise_mm": {str(mh_of[c]): r for c in st
                                 for r in [round((st[c]["depth"] - base[c]["depth"]) * 1000, 2)]
                                 if r >= sim25_grid.WHOLE_RISE_FLOOR_MM}})
    summary = {"case": asdict(case), "tag": tag, "minutes": sim25_grid.MINUTES,
               "spec": SPEC, "outlet_head": head0,
               # The grid stores the same, so a family's baseline can be checked against the
               # grid's before the two are compared (scenarios.py --score does).
               "baseline_depth_m": {str(mh_of[c]): round(base[c]["depth"], 4) for c in base},
               "baseline": {"alarm": sorted(mh_of[c] for c in base if base[c]["alarm"]),
                            "surcharged": sorted(mh_of[c] for c in base if base[c]["surcharged"]),
                            "spilled": sorted(mh_of[c] for c in base if base[c]["spilled"])},
               "candidates": sorted(mh_of.values()),
               "rows": rows, "wall_s": round(time.time() - t0)}
    with open(os.path.join(d, "summary.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(summary, f, indent=1)
    worst_err = max((abs(r["continuity_error_pct"]) for r in rows), default=0.0)
    print(f"  {tag}: {len(rows)} scenarios, worst continuity error {worst_err:.2f}%"
          f" ({summary['wall_s']} s)", flush=True)
    return summary


# ---------------------------------------------------------------------- scoring
def _tips(row, rule):
    """The candidates that see a row under a rule: 'alarm', 'surcharge' or a rise in mm."""
    if rule in RULES_YN:
        return row[rule]
    return [int(k) for k, v in row["rise_mm"].items() if v >= rule]


def baseline_check(tags):
    """Per case, how far the scenario baseline's depths sit from the grid's, mm. The grid and
    the scenarios are compared only fairly if they start from the same network: a change to
    the model between the two runs (loads, attribution, pipes) shows here first."""
    out = {}
    for tag in tags:
        paths = [os.path.join(sim25_grid.OUT, tag, "summary.json"), os.path.join(OUT, tag, "summary.json")]
        if not all(os.path.exists(p) for p in paths):
            continue
        g, s = (json.load(open(p, encoding="utf-8")).get("baseline_depth_m") for p in paths)
        if not g or not s:
            out[tag] = None
            continue
        diff = [abs(s[k] - g[k]) * 1000 for k in g if k in s]
        out[tag] = {"max_mm": round(max(diff), 2),
                    "over_1mm": sum(1 for d in diff if d > 1.0), "of": len(diff)}
    return out


def load_families():
    """{family: {case tag: [rows]}} for every family with results, the grid's as 'single'."""
    fams = {}
    for tag in sorted(os.listdir(sim25_grid.OUT)):
        p = os.path.join(sim25_grid.OUT, tag, "summary.json")
        if tag.startswith("ii") and os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                fams.setdefault("single", {})[tag] = json.load(f)["rows"]
    if os.path.isdir(OUT):
        for tag in sorted(os.listdir(OUT)):
            p = os.path.join(OUT, tag, "summary.json")
            if not os.path.exists(p):
                continue
            with open(p, encoding="utf-8") as f:
                for r in json.load(f)["rows"]:
                    fams.setdefault(r["family"], {}).setdefault(tag, []).append(r)
    return fams


class Pool:
    """One family under one rule: per case, a bitmask per manhole of the scenarios it sees.
    Scenarios no candidate sees are dropped, and so are cases with none, as the builder
    (tools/build_sim25_web.py, placement) drops them, so shares mean the same thing."""

    def __init__(self, per_case, rule):
        self.cases, self.masks, self.n = [], [], []
        for tag, rows in sorted(per_case.items()):
            seen = [t for t in (_tips(r, rule) for r in rows) if t]
            if not seen:
                continue
            m = {}
            for i, tips in enumerate(seen):
                for mh in tips:
                    m[mh] = m.get(mh, 0) | (1 << i)
            self.cases.append(tag)
            self.masks.append(m)
            self.n.append(len(seen))

    def cover(self, chosen):
        out = []
        for m, n in zip(self.masks, self.n):
            acc = 0
            for mh in chosen:
                acc |= m.get(mh, 0)
            out.append(acc.bit_count() / n)
        return out


def greedy(pool, candidates, objective, k_max=MAX_SENSORS):
    """Nested 1-to-k sets, the builder's greedy: best (mean, worst) or (worst, mean), first
    candidate in order on a tie."""
    chosen, cur = [], [0] * len(pool.masks)
    for _ in range(k_max):
        best, best_key = None, None
        for mh in candidates:
            if mh in chosen:
                continue
            f = [(c | m.get(mh, 0)).bit_count() / n
                 for c, m, n in zip(cur, pool.masks, pool.n)]
            mean, worst = sum(f) / len(f), min(f)
            key = (mean, worst) if objective == "mean" else (worst, mean)
            if best_key is None or key > best_key:
                best, best_key = mh, key
        chosen.append(best)
        cur = [c | m.get(best, 0) for c, m in zip(cur, pool.masks)]
    return chosen


def score():
    """The transfer matrix: sensors chosen on each family, scored on every family, per rule
    and objective, for 1 to max_sensors sensors. Only cases every family has are used."""
    fams = load_families()
    if len(fams) < 2:
        raise SystemExit("scenarios.py --score: need the grid and at least one scenario family; "
                         "run --run first")
    common = sorted(set.intersection(*(set(v) for v in fams.values())))
    if not common:
        raise SystemExit("scenarios.py --score: no case has results in every family")
    fams = {f: {t: v[t] for t in common} for f, v in fams.items()}
    probe = Sim25Model(sim25.Case(), whole=True)
    candidates = sorted(probe.nodes[c].manhole_id for c in probe.candidates)
    out = {"cases": common, "baseline_vs_grid": baseline_check(common), "families": {}, "rules": {}}
    for f, per_case in fams.items():
        out["families"][f] = {
            "scenarios": {t: len(rows) for t, rows in per_case.items()},
            "detectable": {str(rule): {t: sum(1 for r in rows if _tips(r, rule))
                                       for t, rows in per_case.items()}
                           for rule in RULES_YN + tuple(RISES_MM)}}
    for rule in RULES_YN + tuple(RISES_MM):
        pools = {f: Pool(per_case, rule) for f, per_case in fams.items()}
        per_rule = {}
        for objective in ("worst", "mean"):
            per_obj = {}
            for train, tp in pools.items():
                if not tp.masks:
                    continue
                order = greedy(tp, candidates, objective)
                test = {}
                for name, sp in pools.items():
                    if not sp.masks:
                        continue
                    fr = [sp.cover(order[:k]) for k in range(1, len(order) + 1)]
                    test[name] = {"worst": [round(min(x), 4) for x in fr],
                                  "mean": [round(sum(x) / len(x), 4) for x in fr]}
                per_obj[train] = {"order": order, "test": test}
            per_rule[objective] = per_obj
        out["rules"][str(rule)] = per_rule
    with open(os.path.join(OUT, "evaluation.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1)
    report(out)
    return out


def report(ev, ks=(1, 3, 6, 10), objective="worst"):
    """Print each rule's transfer matrix: rows are the family sensors were chosen on, columns
    the family scored on, each cell worst / mean coverage at k sensors."""
    print(f"cases: {', '.join(ev['cases'])}")
    for tag, b in ev["baseline_vs_grid"].items():
        print(f"  baseline vs the grid's, {tag}: " + (
            "not stored (run before baseline depths were kept)" if b is None else
            f"max {b['max_mm']} mm, {b['over_1mm']} of {b['of']} manholes differ by over 1 mm"))
    for f, d in ev["families"].items():
        n = sum(d["scenarios"].values())
        det = ", ".join(f"{rule}: {sum(v.values())}" for rule, v in d["detectable"].items())
        print(f"  {f}: {n} scenario runs; seen by some manhole, {det}")
    for rule, per_rule in ev["rules"].items():
        rows = per_rule[objective]
        if not rows:
            continue
        names = list(next(iter(rows.values()))["test"])
        unit = "" if rule in RULES_YN else " mm rise"
        print(f"\nrule {rule}{unit}, sensors chosen for the best {objective} case; "
              f"cells are worst / mean share of each case's detectable scenarios")
        for k in ks:
            if k > MAX_SENSORS:
                continue
            print(f"  k = {k:2d}   " + "".join(f"{'on ' + n:>16s}" for n in names))
            for train, r in rows.items():
                cells = "".join(f"{r['test'][n]['worst'][k - 1] * 100:7.0f}% /{r['test'][n]['mean'][k - 1] * 100:4.0f}%"
                                for n in names)
                print(f"    chosen on {train:9s}{cells}")


# ---------------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--describe", action="store_true")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--score", action="store_true")
    ap.add_argument("--cases", default="all", choices=["nominal", "all"])
    ap.add_argument("--resume", action="store_true",
                    help="skip cases whose summary.json holds exactly the scenarios config.js asks for")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = ap.parse_args()

    if args.score:
        score()
        return
    scen = generate()
    cs = sim25_grid.cases(args.cases)
    fams = {}
    for sc in scen:
        fams.setdefault(sc.family, []).append(sc)
    print(f"study area: {sim25.STUDY_AREA}; results in {OUT}")
    for f, items in fams.items():
        dw = [sc.dwellings for sc in items]
        print(f"  {f}: {len(items)} scenarios, {min(dw)} to {max(dw)} new dwellings")
    runs = len(cs) * (1 + len(scen))
    # 35 s a run: the measured mean of the whole-area grid of 1 Oct (8,205 runs, 8 h 22 m, 9 workers).
    print(f"{len(cs)} cases x ({len(scen)} scenarios + baseline) = {runs} whole-domain runs on "
          f"{args.workers} workers: about {runs * 35 / args.workers / 60:.0f} min")
    if args.describe:
        for sc in scen:
            print(f"    {sc.tag}: {sc.dwellings} dwellings at {len(sc.growth_nodes)} nodes"
                  + (f", block at MH{sc.params['block_site']}" if "block_site" in sc.params else ""))
    if args.plan or args.describe or not args.run:
        return
    from concurrent.futures import ProcessPoolExecutor
    want = [sc.tag for sc in scen]
    with ProcessPoolExecutor(args.workers) as pool:
        for c in cs:
            done = os.path.join(OUT, c.tag(), "summary.json")
            if args.resume and os.path.exists(done):
                with open(done, encoding="utf-8") as f:
                    if [r["tag"] for r in json.load(f)["rows"]] == want:
                        print(f"  {c.tag()}: already done, kept", flush=True)
                        continue
                print(f"  {c.tag()}: stored scenarios differ from config.js, re-running", flush=True)
            run_case(c, scen, pool)


if __name__ == "__main__":
    main()
