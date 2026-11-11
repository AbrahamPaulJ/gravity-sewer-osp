#!/usr/bin/env python3
"""
sim35_mix.py - Sim 3.5, items 2 and 6: the budgeted mix of level sensors and float switches, each float
with its own height, and the cheapest set that passes a tolerance. Runs no SWMM.

A SCENARIO is one area at one build-out step in one case (Sim 3's runs). Two scores:
    detect   the scenario is seen by a chosen sensor (Sim 3's score)
    warn     an overload is seen one build-out step before its first new surcharge (Rijoy John's
             before-surcharge score, used here only as a measuring stick)

A LEVEL SENSOR at manhole i sees a scenario when i rises at least R mm over its own level before growth.

A FLOAT at manhole i and height h trips when water reaches h. It earns credit only when it moved because
of growth:  base + margin <= h <= base + rise.  The margin is the point of the model: without it the optimiser
parks each float 1 mm above normal, which is perfect in the model and useless in a sewer. So a float
sees a rise only if the rise is at least the margin, and only inside its band.
A float must also stay quiet on a normal Design wet day: h >= Design wet level + margin. In wetter
weather it may already be tripped before growth: it then earns nothing there and the false trip is counted.

Fixed universe: scenarios a level sensor could see at 10 mm somewhere, so every sensor type and rule is
scored against the same denominator. Worst case over the 7 wet cases, Dry reported beside it (the
Dry-in-objective decision in docs/18 s11.3 is still open). Prices are assumed: level $25,000, float $1,000.

    python sim35_mix.py            # writes results/sim35/mix.json and mix_report.txt
"""
import json, os, sys, time
from collections import defaultdict
import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import csr_matrix

import sim35_capacity as C

PRICE = {"level": 25000, "float": 1000}
MARGIN = 25.0                      # mm; a float's clearance above normal, assumed. Swept below
BUDGETS = [25000, 50000, 75000, 100000, 125000, 150000, 200000, 250000]
FRACTIONS = [round(.2 + .1 * a, 1) for a in range(9)]   # float heights: share of the outlet bore
ABOVE_CROWN = [100, 300, 500, 1000, 2000]               # and mm above the crown, while under the lid
EPS = 1e-3
TIME = 90

reg, geo = C.read_js(C.REGIONS), C.read_js(os.path.join(C.DATA, "catchment.js"))
ch = C.chamber_names(); gm = C.geometry(geo, ch); n = len(ch)
ix = {nd["name"]: j for j, nd in enumerate(geo["nodes"])}
rim = [round(geo["nodes"][ix[c]]["depth"] * 1000) for c in ch]
tags = [c["tag"] for c in reg["cases"]]; label = {c["tag"]: c["label"] for c in reg["cases"]}
wet = [t for t, c in zip(tags, reg["cases"]) if c["ii"] > 0]
nreg = len(reg["regions"]); rid = [r["id"] for r in reg["regions"]]
base = {t: reg["base"][t]["depthMm"] for t in tags}
b_of = lambda t, i: base[t].get(str(i), 0)
lines = []


def say(*a):
    t = " ".join(str(x) for x in a); print(t, flush=True); lines.append(t)


def float_options(margin):
    """[(manhole, height mm)], quiet on a Design wet day, under the lid."""
    opts = []
    for i, (o, d) in enumerate(gm):
        if o is None:
            continue
        hs = [o + f * d for f in FRACTIONS] + [o + d + a for a in ABOVE_CROWN]
        for h in hs:
            if b_of(C.DESIGN, i) + margin <= h <= rim[i]:
                opts.append((i, round(h, 1)))
    return opts


def scenarios(score):
    """{case: [{key, region, rises}]} on the fixed universe."""
    out = {}
    for t in tags:
        L = []
        rows = sorted(reg["rows"][t], key=lambda x: (x["r"], x["s"]))
        if score == "detect":
            for x in rows:
                rs = dict((i, v) for i, v in x["rise"])
                if any(v >= 10 for v in rs.values()):
                    L.append({"r": x["r"], "s": x["s"], "rises": rs})
        else:
            for ri in range(nreg):
                rr = [x for x in rows if x["r"] == ri]
                s = next((x["s"] for x in rr if x["sur"] or x["spill"]), None)
                if s is None or s < 1:
                    continue
                rs = dict((i, v) for i, v in rr[s - 1]["rise"])
                if any(v >= 10 for v in rs.values()):
                    L.append({"r": ri, "s": s - 1, "rises": rs})
        out[t] = L
    return out


class Problem:
    def __init__(self, score, R, margin):
        self.R, self.margin = R, margin
        self.opts = float_options(margin)
        by = defaultdict(list)
        for j, (i, h) in enumerate(self.opts):
            by[i].append((j, h))
        self.by = by
        self.scen = scenarios(score)
        # detector sets: level i -> i ; float option j -> n + j
        for t, L in self.scen.items():
            for sc in L:
                D = set()
                for i, v in sc["rises"].items():
                    if v >= R:
                        D.add(i)
                    if v >= margin:
                        b = b_of(t, i)
                        for j, h in by.get(i, []):
                            if b + margin <= h <= b + v:
                                D.add(n + j)
                sc["D"] = D
        useful = {d - n for L in self.scen.values() for sc in L for d in sc["D"] if d >= n}
        self.useful = useful

    def tripped_wet(self, j):
        """Wet cases in which this float is already tripped before any growth."""
        i, h = self.opts[j]
        return [t for t in wet if b_of(t, i) >= h]

    def solve(self, groups, budget=None, tau=None, kinds=("level", "float"), max_float=None, pf=None):
        """groups: list of lists of detector sets. budget: maximise the worst share. tau: minimise cost."""
        pf = PRICE["float"] if pf is None else pf
        vars_ = []
        if "level" in kinds:
            vars_ += list(range(n))
        if "float" in kinds:
            vars_ += [n + j for j in sorted(self.useful)]
        pos = {v: a for a, v in enumerate(vars_)}
        nv = len(vars_)
        tg = [(c, D) for c, g in enumerate(groups) for D in g]
        ny, nc = len(tg), len(groups)
        Y, Z = nv, nv + ny
        cost = np.array([PRICE["level"] if v < n else pf for v in vars_], float)
        r, co, va, lo, hi = [], [], [], [], []
        row = 0
        def add(items, a, b):
            nonlocal row
            for k, v in items:
                r.append(row); co.append(k); va.append(v)
            lo.append(a); hi.append(b); row += 1
        for t_, (c, D) in enumerate(tg):
            add([(Y + t_, 1.0)] + [(pos[d], -1.0) for d in D if d in pos], -np.inf, 0)
        sizes = [len(g) for g in groups]
        for c in range(nc):
            items = [(Y + t_, 1.0 / sizes[c]) for t_, (cc, _) in enumerate(tg) if cc == c]
            if tau is None:
                add(items + [(Z, -1.0)], 0, np.inf)
            else:
                add(items, tau, np.inf)
        own = defaultdict(list)                        # at most one float height per manhole
        for v in vars_:
            if v >= n:
                own[self.opts[v - n][0]].append(pos[v])
        for i, ps in own.items():
            if len(ps) > 1:
                add([(p, 1.0) for p in ps], -np.inf, 1)
        if budget is not None:
            add([(a, cost[a]) for a in range(nv)], -np.inf, budget)
        if max_float is not None and "float" in kinds:
            add([(pos[v], 1.0) for v in vars_ if v >= n], -np.inf, max_float)
        A = csr_matrix((va, (r, co)), shape=(row, Z + 1))
        c_obj = np.zeros(Z + 1)
        if tau is None:
            c_obj[Z] = -1.0
            for t_, (cc, _) in enumerate(tg):
                c_obj[Y + t_] -= EPS / sizes[cc] / nc
            c_obj[:nv] += 1e-9 * cost / 1000       # never buy what scores nothing
        else:
            c_obj[:nv] = cost / 1000.0
        integ = np.zeros(Z + 1); integ[:nv] = 1
        res = milp(c_obj, constraints=[LinearConstraint(A, lo, hi)], integrality=integ,
                   bounds=Bounds(np.zeros(Z + 1), np.ones(Z + 1)),
                   options={"disp": False, "time_limit": TIME, "mip_rel_gap": 1e-3})
        if res.x is None:
            return None, res.status
        return [vars_[a] for a in np.flatnonzero(res.x[:nv] > .5)], res.status

    def groups(self, cases, keep=lambda sc: True):
        return [[sc["D"] for sc in self.scen[t] if keep(sc)] for t in cases if any(keep(sc) for sc in self.scen[t])]

    def score(self, S, cases, keep=lambda sc: True):
        S = set(S); per = {}
        for t in cases:
            L = [sc for sc in self.scen[t] if keep(sc)]
            if L:
                per[t] = sum(bool(sc["D"] & S) for sc in L) / len(L)
        return per

    def names(self, S):
        lv = [ch[v] for v in S if v < n]
        fl = [(ch[self.opts[v - n][0]], self.opts[v - n][1]) for v in S if v >= n]
        return lv, fl

    def cost(self, S, pf=None):
        pf = PRICE["float"] if pf is None else pf
        return sum(PRICE["level"] if v < n else pf for v in S)


def wm(per):
    return (min(per.values()), float(np.mean(list(per.values())))) if per else (float("nan"), float("nan"))


def heldout(P, budget=None, tau=None, kinds=("level", "float"), max_float=None):
    """Chosen without one wet case (or one area), scored only on it."""
    got = {}
    per = {}
    for hc in wet:
        rest = [t for t in wet if t != hc]
        S, st = P.solve(P.groups(rest), budget=budget, tau=tau, kinds=kinds, max_float=max_float)
        if S is None:
            continue
        per[hc] = P.score(S, [hc]).get(hc, float("nan"))
    got["case_worst"], got["case_mean"] = (min(per.values()), float(np.mean(list(per.values())))) if per else (None, None)
    hit = tot = 0
    for ra in range(nreg):
        keep = lambda sc, ra=ra: sc["r"] != ra
        if not any(sc["r"] == ra for t in wet for sc in P.scen[t]):
            continue
        S, st = P.solve(P.groups(wet, keep), budget=budget, tau=tau, kinds=kinds, max_float=max_float)
        if S is None:
            continue
        S = set(S)
        for t in wet:
            for sc in P.scen[t]:
                if sc["r"] == ra:
                    tot += 1; hit += bool(sc["D"] & S)
    got["area"] = hit / tot if tot else None
    return got


def cell(P, S):
    """Scores and make-up of one chosen set."""
    if S is None:
        return None
    w, a = wm(P.score(S, wet))
    lv, fl = P.names(S)
    tw = [len(P.tripped_wet(v - n)) for v in S if v >= n]
    return {"worst": round(w, 4), "average": round(a, 4), "level": len(lv), "float": len(fl), "cost": P.cost(S),
            "level_at": lv, "float_at": fl, "tripped_median": None if not tw else float(np.median(tw))}


def rounded(h):
    return {k: None if v is None else round(v, 4) for k, v in h.items()}


def main():
    t0 = time.time()
    tables = {"budget": {}, "compare": {}, "tolerance": {}, "sensitivity": []}
    Ps = {(score, R): Problem(score, R, MARGIN) for score in ("detect", "warn") for R in (10, 25)}
    P0 = Ps[("detect", 10)]
    say(f"Float options {len(P0.opts)}, useful {len(P0.useful)}; level candidates {n}.")
    say("Universe, wet cases: detect", {label[t]: len(P0.scen[t]) for t in wet}, "Dry", len(P0.scen[tags[0]]))
    say("Universe, wet cases: warn", sum(len(Ps[("warn", 10)].scen[t]) for t in wet))
    KINDS = {"level": ("level",), "float": ("float",), "mix": ("level", "float")}

    def txt(c):
        return "no solution" if c is None else f"{c['worst']:5.0%}/{c['average']:4.0%} {c['level']:2d}L+{c['float']:3d}F"

    for score, R in Ps:
        P = Ps[(score, R)]
        rows = []
        say(f"\n=== Score {score}, level rule {R} mm, float margin {MARGIN:.0f} mm: worst/average over the 7 wet cases, by budget")
        say(f"{'budget':>9s}  {'level only':>18s}  {'float only':>18s}  {'free mix':>18s}")
        for B in BUDGETS:
            r = {"budget": B}
            for name, kinds in KINDS.items():
                r[name] = cell(P, P.solve(P.groups(wet), budget=B, kinds=kinds)[0])
            rows.append(r)
            say(f"{B:9d}  {txt(r['level']):>18s}  {txt(r['float']):>18s}  {txt(r['mix']):>18s}")
        tables["budget"][f"{score}{R}"] = rows
        say(f"   [{(time.time() - t0) / 60:.1f} min]")

    say("\n=== Level against float, held out")
    say("Worst/average on the case left out, and share seen on the area left out")
    SETS = (("5 level sensors", 125000, ("level",)), ("1 level sensor", 25000, ("level",)), ("25 floats", 25000, ("float",)),
            ("125 floats", 125000, ("float",)), ("Free mix, $125k", 125000, ("level", "float")), ("Free mix, $25k", 25000, ("level", "float")))
    for score, R in Ps:
        P = Ps[(score, R)]
        rows = []
        for name, B, kinds in SETS:
            c = cell(P, P.solve(P.groups(wet), budget=B, kinds=kinds)[0])
            h = rounded(heldout(P, budget=B, kinds=kinds))
            rows.append({"name": name, "budget": B, "in": c, "out": h})
            say(f"  {score}{R:<3d} {name:18s} in-sample {c['worst']:4.0%}/{c['average']:4.0%}  case left out {h['case_worst']:4.0%}/{h['case_mean']:4.0%}  area left out {h['area']:4.0%}"
                + (f"   floats already tripped before growth, median wet cases {c['tripped_median']:.0f} of 7" if c["tripped_median"] is not None else ""))
        tables["compare"][f"{score}{R}"] = rows
        say(f"   [{(time.time() - t0) / 60:.1f} min]")

    say("\n=== Sensitivity at $125k free mix, detect, level 25 mm")
    for m in (10, 25, 50):
        P = Problem("detect", 25, m)
        c = cell(P, P.solve(P.groups(wet), budget=125000)[0])
        tables["sensitivity"].append({"margin": m, **{k: c[k] for k in ("worst", "average", "level", "float")}})
        say(f"  float margin {m:2d} mm: {c['worst']:4.0%}/{c['average']:4.0%}, {c['level']} level + {c['float']} float")
    P = Ps[("detect", 25)]
    for pf in (1000, 1500):
        for B in (25000, 125000):
            S = P.solve(P.groups(wet), budget=B, pf=pf)[0]
            lv, fl = P.names(S); w, a = wm(P.score(S, wet))
            say(f"  float ${pf}, budget ${B}: {w:4.0%}/{a:4.0%}, {len(lv)} level + {len(fl)} float")

    say("\n=== Item 6: cheapest set that passes a tolerance, worst of the 7 wet cases")
    say("Prices assumed. Then the same tolerance chosen without one case or area, and how it really scores there.")
    for score, R in Ps:
        P = Ps[(score, R)]
        rows = []
        say(f" score {score}, level {R} mm")
        for tau in (.5, .6, .7, .8, .9, 1.0):
            r = {"pass": tau}; cells = []
            for name, kinds in (("level", ("level",)), ("mix", ("level", "float"))):
                S = P.solve(P.groups(wet), tau=tau, kinds=kinds)[0]
                if S is None:
                    r[name] = None; cells.append(f"{name}: not reachable"); continue
                c = cell(P, S); h = rounded(heldout(P, tau=tau, kinds=kinds))
                r[name] = {**c, "out": h}
                cells.append(f"{name}: ${c['cost'] / 1000:.0f}k {c['level']}L+{c['float']}F held out case {h['case_mean'] if h['case_mean'] is None else format(h['case_mean'], '.0%')} area {h['area'] if h['area'] is None else format(h['area'], '.0%')}")
            rows.append(r)
            say(f"   pass {tau:4.0%}  " + " | ".join(cells))
        tables["tolerance"][f"{score}{R}"] = rows
        say(f"   [{(time.time() - t0) / 60:.1f} min]")

    os.makedirs(C.OUT, exist_ok=True)
    with open(os.path.join(C.OUT, "mix.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"price": PRICE, "margin": MARGIN, "budgets": BUDGETS, "tables": tables}, f, indent=1)
    with open(os.path.join(C.OUT, "mix_report.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    say(f"done in {(time.time() - t0) / 60:.1f} min")


if __name__ == "__main__":
    main()
