#!/usr/bin/env python3
"""
sim4_more.py - the figures behind the story's "More on this step" folds, computed from the same files the story is built
from: simulation3/data/catchment.js (the network), simulation3/data/growth.js (manhole order), simulation4/data/regions.js
(Sim 4's runs on the equal-home regions), results/sim4/numbers.json, float.json and data/greenfield.js.

These folds carry items first shown in the product demo (demo/app.js), re-scored here on the story's own test: the 7 wet
cases, the regions to monitor or watch, build-out up to 100%, a 10 mm rise. Nothing is copied from the demo's pages or
its compare.js; the demo's figures are a cross-check only (tools/verify_sim4_consistency.js).

Imported by tools/build_sim4_web.py; run alone it prints the figures:   python tools/sim4_more.py
"""
import itertools, json, math, os, random as _random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPACING_M = 150          # a desk study would not put two sensors closer than this (the demo's screen rule)
RANDOM_DRAWS = 500
RANDOM_SEED = 7


def read_js(path):
    t = open(path, encoding="utf-8").read()
    return json.loads(t[t.index("{"):t.rindex("}") + 1])


def popcount(x):
    return bin(x).count("1")


# ------------------------------------------------------------------------------------------------ scoring
class Test:
    """The story's test: per wet case, the growth runs (target region x build-out step up to 100%) that some manhole
    sees with a 10 mm rise, and the overloads warnable a step ahead. Each manhole carries a bitmask of the runs it sees
    in each case and of the overloads it warns of, so a set's score is an OR of masks."""

    def __init__(self, reg, chambers, targets, mm=10):
        self.reg, self.chambers, self.mm = reg, chambers, mm
        self.idx = {n: i for i, n in enumerate(chambers)}
        self.cases = [c for c in reg["cases"] if c["ii"] > 0]
        self.labels = [c["label"] for c in self.cases]
        self.steps = [s for s, v in enumerate(reg["ladder"]) if v <= 1 + 1e-9]
        self.tg = [ri for ri, r in enumerate(reg["regions"]) if r["id"] in targets]
        N = len(chambers)
        self.n = []                                  # runs counted per case
        self.mask = []                               # mask[c][i]: runs of case c manhole i sees
        self.warn = [0] * N                          # overloads each manhole warns of, over all cases
        self.nwarn = 0
        for c in self.cases:
            rows = {(x["r"], x["s"]): x for x in reg["rows"][c["tag"]]}
            m, k = [0] * N, 0
            for ri in self.tg:
                rr = [rows[(ri, s)] for s in self.steps]
                for x in rr:
                    if any(v >= 10 for _, v in x["rise"]):
                        for j, v in x["rise"]:
                            if v >= mm:
                                m[j] |= 1 << k
                        k += 1
                first = next((n for n, x in enumerate(rr) if x["sur"] or x["spill"]), -1)
                if first >= 1 and any(v >= 10 for _, v in rr[first - 1]["rise"]):
                    for j, v in rr[first - 1]["rise"]:
                        if v >= mm:
                            self.warn[j] |= 1 << self.nwarn
                    self.nwarn += 1
            self.n.append(k)
            self.mask.append(m)

    def ids(self, names):
        return [self.idx[n] for n in names]

    def per_case(self, S, cases=None):
        cs = range(len(self.cases)) if cases is None else cases
        out = []
        for c in cs:
            if not self.n[c]:
                continue
            m = 0
            for i in S:
                m |= self.mask[c][i]
            out.append(popcount(m) / self.n[c])
        return out

    def score(self, S, cases=None):
        per = self.per_case(S, cases)
        w = 0
        for i in S:
            w |= self.warn[i]
        return {"worst": min(per) if per else 1.0, "average": sum(per) / len(per) if per else 1.0, "warned": popcount(w), "per": per}

    def one_fails(self, S):
        return min(self.score([j for j in S if j != i])["worst"] for i in S) if len(S) > 1 else 0.0

    # The demo's greedy: each step adds the manhole that most raises (worst, then average, then warned), or
    # (average, then worst, then warned); the first in manhole order wins a tie.
    def greedy(self, k, aim="worst", cases=None):
        S = []
        key = (lambda s: (s["worst"], s["average"], s["warned"])) if aim == "worst" else (lambda s: (s["average"], s["worst"], s["warned"]))
        for _ in range(k):
            best, bk = None, None
            for i in range(len(self.chambers)):
                if i in S:
                    continue
                v = key(self.score(S + [i], cases))
                if bk is None or v > bk:
                    best, bk = i, v
            S.append(best)
        return S

    def exact(self, k, cases=None):
        """The exact best k on (worst, average, warned), searched over the manholes no other one covers more than."""
        cs = list(range(len(self.cases))) if cases is None else cases
        sig = {}
        for i in range(len(self.chambers)):
            s = tuple(self.mask[c][i] for c in cs) + (self.warn[i],)
            if any(s):
                sig[i] = s
        live = list(sig)
        sub = lambda a, b: all((x & ~y) == 0 for x, y in zip(a, b))
        cand = [i for i in live if not any(j != i and sub(sig[i], sig[j]) and (sig[i] != sig[j] or j < i) for j in live)]
        best, bk = None, None
        for S in itertools.combinations(cand, k):
            s = self.score(list(S), cs)
            v = (round(s["worst"], 9), round(s["average"], 9), s["warned"])
            if bk is None or v > bk:
                best, bk = list(S), v
        return best

    def unseen(self, chooser, k):
        """Each wet case scored with the k sensors chosen without it, averaged over the cases."""
        out = []
        for c in range(len(self.cases)):
            others = [x for x in range(len(self.cases)) if x != c]
            S = chooser(k, others)
            out.append(self.per_case(S, [c])[0])
        return sum(out) / len(out)


# ------------------------------------------------------------------------------------------------ desk hydraulics
class Desk:
    """The demo's desk screen, no model runs: homes and pipe length upstream of every pipe (split evenly where a
    manhole has two outlets), peak flow = homes x L/s per home + leakage x pipe length / 100 m, against Manning
    full-pipe capacity from the network file."""

    def __init__(self, geo, lps):
        g, N = geo, len(geo["nodes"])
        self.g = g
        out = [[] for _ in range(N)]
        inn = [[] for _ in range(N)]
        for p in range(g["nPipes"]):
            out[g["up"][p]].append(p)
            inn[g["down"][p]].append(p)
        self.out = out
        indeg = [len(a) for a in inn]
        homes = [n.get("dw") or 0 for n in g["nodes"]]
        length = [0.0] * N
        pH, pL = [0.0] * g["nPipes"], [0.0] * g["nPipes"]
        q = [a for a in range(N) if not indeg[a]]
        while q:
            a = q.pop(0)
            for p in out[a]:
                pH[p] = homes[a] / len(out[a])
                pL[p] = length[a] / len(out[a]) + g["plen"][p]
                d = g["down"][p]
                homes[d] += pH[p]
                length[d] += pL[p]
                indeg[d] -= 1
                if indeg[d] == 0:
                    q.append(d)
        self.pH, self.pL, self.homes_at, self.lps = pH, pL, homes, lps
        dist = sum(math.hypot(g["nodes"][g["up"][p]]["x"] - g["nodes"][g["down"][p]]["x"], g["nodes"][g["up"][p]]["y"] - g["nodes"][g["down"][p]]["y"]) for p in range(g["nPipes"]))
        self.unit = sum(g["plen"]) / dist          # metres per map unit
        self.node_of = {n["name"]: a for a, n in enumerate(g["nodes"])}

    def util(self, p, ii):
        return (self.pH[p] * self.lps + ii * self.pL[p] / 100) / self.g["pcap"][p]

    def out_pipe(self, name):
        o = self.out[self.node_of[name]]
        return o[0] if o else None

    def rank(self, pool, value, k):
        """Highest value first, keeping sites at least SPACING_M apart. Python's sort is stable, as the demo's is."""
        nodes = self.g["nodes"]
        order = sorted(pool, key=lambda i: -value(i))
        picked = []
        for i in order:
            a = nodes[self.node_of[self.names[i]]]
            if all(math.hypot(a["x"] - nodes[self.node_of[self.names[j]]]["x"], a["y"] - nodes[self.node_of[self.names[j]]]["y"]) * self.unit >= SPACING_M for j in picked):
                picked.append(i)
            if len(picked) >= k:
                break
        return picked


def spearman(xs, ys):
    def rank(a):
        s = sorted(range(len(a)), key=lambda i: a[i])
        r = [0.0] * len(a)
        k = 0
        while k < len(s):
            j = k
            while j + 1 < len(s) and a[s[j + 1]] == a[s[k]]:
                j += 1
            for m in range(k, j + 1):
                r[s[m]] = (k + j) / 2
            k = j + 1
        return r
    rx, ry, n = rank(xs), rank(ys), len(xs)
    mx, my = sum(rx) / n, sum(ry) / n
    a = sum((rx[k] - mx) * (ry[k] - my) for k in range(n))
    b = sum((v - mx) ** 2 for v in rx)
    c = sum((v - my) ** 2 for v in ry)
    return a / math.sqrt(b * c), n


# ------------------------------------------------------------------------------------------------ the figures
def figures(nm, reg, geo, runs, fl, gf_cover, gf_joins):
    chambers = runs["chambers"]
    T = Test(reg, chambers, nm["targets"])
    lad = {r["k"]: r for r in nm["ladder"]}
    rec = nm["recommend"]
    design_tag = next(c["tag"] for c in reg["cases"] if c["label"] == "Design wet")
    ii = next(c["ii"] for c in reg["cases"] if c["tag"] == design_tag)
    desk = Desk(geo, runs["lpsPerDwelling"][1])
    desk.names = chambers
    # Sim 4 places level sensors by greedy (19 Nov), two ways: Greedy: average (the map's default) and Greedy: worst case;
    # Exact optimum is shown beside them as a comparison (20 Nov).
    ladw = {r["k"]: r for r in nm["ladder_worst"]}
    listS = T.ids(lad[rec]["chosen"])
    worstS = T.ids(ladw[rec]["chosen"])
    # Exact optimum (20 Nov, back as a comparison): numbers.json's exact set of each size, the best bought all at once.
    exactS = T.ids(lad[rec]["exact_set"])
    # The engine must reproduce numbers.json before anything else is trusted.
    for name, L_ in (("Greedy: average", lad), ("Greedy: worst case", ladw)):
        for k, r in L_.items():
            a = T.score(T.ids(r["chosen"]))
            assert abs(a["worst"] - r["worst"]) < 6e-5 and abs(a["average"] - r["average"]) < 6e-5 and a["warned"] == r["warned_target"], f"{name} at {k} does not match numbers.json"
    for k, r in lad.items():
        a = T.score(T.ids(r["exact_set"]))
        assert abs(a["worst"] - r["exact_worst"]) < 6e-5 and abs(a["average"] - r["exact_average"]) < 6e-5, f"Exact optimum at {k} does not match numbers.json"
    assert T.n == [nm["universe"][c] for c in T.labels], "runs per case do not match numbers.json"
    assert T.nwarn == nm["warn_universe"]["target"], "warnable overloads do not match numbers.json"

    out = {"cases": T.labels, "n": T.n, "nwarn": T.nwarn}

    # Network, step 1.
    g = geo
    out["network"] = {"pipes": g["nPipes"], "manholes": len(chambers), "km": round(sum(g["plen"]) / 1000, 1),
                      "council": reg["councilConnections"], "model_homes": g["baseDwellings"],
                      "region_homes": sum(r["dwellings"] for r in reg["regions"] if not r.get("overlay")),
                      "pumps": len(g["pumps"])}
    util = [desk.util(p, ii) for p in range(g["nPipes"])]
    edges = [0, 0.05, 0.1, 0.2, 0.4, 0.7, 1]
    pct = lambda v: f"{round(v * 100)}%"

    def edge_bins(vals, edges, fmt):
        defs = [(f"{fmt(lo)} to {fmt(edges[k + 1])}" if k + 1 < len(edges) else f"{fmt(lo)} or more") for k, lo in enumerate(edges)]
        of = []
        for v in vals:
            if v is None:
                of.append(-1)
                continue
            k = max(k for k, lo in enumerate(edges) if v >= lo) if v >= edges[0] else -1
            of.append(k)
        return defs, of

    u_defs, u_of = edge_bins(util, edges, pct)
    sizes = [(150, "150 mm or less"), (225, "225 mm"), (300, "250 to 300 mm"), (float("inf"), "375 mm or more")]
    s_of = [next(k for k, (hi, _) in enumerate(sizes) if d <= hi) for d in g["dia"]]
    years = [1900, 1930, 1950, 1970, 1990, 2010]
    a_defs, a_of = edge_bins([y or None for y in g["pyr"]], years, str)
    mats = [("VC", "Clay"), ("PVCU", "PVC"), ("RC", "Concrete")]
    m_of = [next((k for k, (c, _) in enumerate(mats) if c == m), -1) for m in g["pmat"]]
    count = lambda of, n: [sum(1 for x in of if x == k) for k in range(n)]
    total_len = sum(g["plen"])
    clay = sum(l for l, m in zip(g["plen"], g["pmat"]) if m == "VC") / total_len
    old = sum(l for l, y in zip(g["plen"], g["pyr"]) if y and y < 1950) / total_len
    n150 = sum(1 for d in g["dia"] if d <= 150)
    hot = sum(1 for v in util if v >= 0.7)
    low = sum(1 for v in util if v < 0.05)
    out["pipes"] = {
        "util": {"label": "Flow / capacity, design wet day", "unit": "desk estimate: peak flow from the homes upstream plus leakage, over Manning full-pipe capacity",
                 "bins": u_defs, "count": count(u_of, len(u_defs)), "of": u_of, "seq": True,
                 "note": f"{low} of {g['nPipes']} pipes run below 5% of capacity on a design wet day; {hot} run at 70% or more. A desk estimate, pipe by pipe: it cannot see water backing up, which the model can."},
        "size": {"label": "Size", "unit": "diameter", "bins": [l for _, l in sizes], "count": count(s_of, len(sizes)), "of": s_of, "seq": True, "rev": True,
                 "note": f"{n150} of {g['nPipes']} pipes are 150 mm or less: small pipes, sized for the homes that were there."},
        "age": {"label": "Age", "unit": "year laid", "bins": a_defs, "count": count(a_of, len(a_defs)), "of": a_of, "seq": True, "rev": True,
                "unknown": sum(1 for x in a_of if x < 0),
                "note": f"{pct(old)} of the length was laid before 1950. The age-weighted wet cases let older pipes leak more."},
        "material": {"label": "Material", "unit": "", "bins": [l for _, l in mats], "count": count(m_of, len(mats)), "of": m_of, "seq": False,
                     "note": f"{pct(clay)} of the length is clay."},
    }

    # The cutaway, step 2: the manhole where the regions to monitor first reach the pipe limit, which is also sensor 1.
    s1 = lad[1]["chosen"][0]
    i1 = T.idx[s1]
    p1 = desk.out_pipe(s1)
    nd = g["nodes"][desk.node_of[s1]]
    dia = g["dia"][p1]
    monitor = [r for r, v in nm["triage"].items() if v["action"] == "monitor"]
    cut_regions = [r for r in reg["regions"] if r["id"] in monitor]
    cases = []
    for c in T.cases:
        base = reg["base"][c["tag"]]["depthMm"][str(i1)] if isinstance(reg["base"][c["tag"]]["depthMm"], dict) else reg["base"][c["tag"]]["depthMm"][i1]
        rows = {(x["r"], x["s"]): x for x in reg["rows"][c["tag"]]}
        rise = {}
        for r in cut_regions:
            ri = reg["regions"].index(r)
            rise[r["id"]] = [round(dict(rows[(ri, s)]["rise"]).get(i1, 0.0), 2) for s in T.steps]
        cases.append({"label": c["label"], "base": round(base, 1), "rise": rise})
    first_limit = {}
    for r in cut_regions:
        d0 = cases[0]
        k = next((n for n, v in enumerate(d0["rise"][r["id"]]) if d0["base"] + v >= 0.7 * dia), None)
        first_limit[r["id"]] = None if k is None else reg["ladder"][T.steps[k]]
    out["cutaway"] = {"manhole": s1, "depthM": nd["depth"], "dia": dia, "mat": {"VC": "clay", "PVCU": "PVC", "RC": "concrete"}.get(g["pmat"][p1], g["pmat"][p1]),
                      "steps": [reg["ladder"][s] for s in T.steps], "homes": {r["id"]: r["nominal"] for r in cut_regions},
                      "cases": cases, "first_limit": first_limit}

    # Cross-check, step 3: the desk screen against the simulated rise at 100% (largest over all regions), design wet.
    resp = [0.0] * len(chambers)
    full = reg["ladder"].index(1.0)
    for x in reg["rows"][design_tag]:
        if x["s"] == full:
            for j, v in x["rise"]:
                resp[j] = max(resp[j], v)
    xs = [util[desk.out_pipe(n)] if desk.out_pipe(n) is not None else None for n in chambers]
    keep = [i for i in range(len(chambers)) if xs[i] is not None and xs[i] > 0 and resp[i] > 0.05]
    rho, n = spearman([xs[i] for i in keep], [resp[i] for i in keep])
    sx = sorted(xs[i] for i in keep)
    sy = sorted(resp[i] for i in keep)
    prank = lambda v: round(sum(1 for x in sx if x < v) / len(sx) * 100)
    yr = lambda v: sum(1 for y in sy if y < v) / len(sy)
    five = [prank(xs[i]) for i in listS if i in keep]
    odd = sorted((i for i in keep if yr(resp[i]) > 0.8 and prank(xs[i]) < 30), key=lambda i: -resp[i])[:4]
    out["check"] = {"rho": rho, "n": n, "five": [min(five), max(five)], "five_in": len(five),
                    "odd": [{"manhole": chambers[i], "rise": resp[i], "pct": prank(xs[i])} for i in odd],
                    "points": [[xs[i], resp[i], chambers[i] in lad[rec]["chosen"]] for i in keep]}

    # Why simulate, step 5a: each approach's five sites on the story's test.
    base_d = reg["base"][design_tag]
    dmm = lambda i: base_d["depthMm"][str(i)] if isinstance(base_d["depthMm"], dict) else base_d["depthMm"][i]
    today = sorted(base_d["surcharged"], key=lambda i: -(dmm(i) / (g["dia"][desk.out_pipe(chambers[i])] if desk.out_pipe(chambers[i]) is not None else 150)))[:rec]
    pool = sorted({i for ri in T.tg for i in reg["regions"][ri]["manholes"]})
    deskS = desk.rank(pool, lambda i: util[desk.out_pipe(chambers[i])] if desk.out_pipe(chambers[i]) is not None else -1, rec)
    homesS = desk.rank(pool, lambda i: desk.homes_at[desk.node_of[chambers[i]]], rec)
    out["why"] = {"today": T.score(today), "today_set": [chambers[i] for i in today], "desk": T.score(deskS), "desk_set": [chambers[i] for i in deskS],
                  "list": T.score(listS), "worst_list": T.score(worstS), "exact": T.score(exactS), "n_today": len(base_d["surcharged"])}

    # Each sensor alone, per wet case, step 5b.
    out["alone"] = [{"name": chambers[i], "per": T.per_case([i])} for i in listS]

    # The two greedy lists and Exact optimum against simple baselines, step 5b.
    rng = _random.Random()
    seed = RANDOM_SEED

    def rnd():
        nonlocal seed
        seed = (seed * 16807) % 2147483647
        return seed / 2147483647
    draws = []
    for _ in range(RANDOM_DRAWS):
        p = pool[:]
        for j in range(len(p) - 1, 0, -1):
            r = math.floor(rnd() * (j + 1))
            p[j], p[r] = p[r], p[j]
        draws.append(T.score(p[:rec]))
    rand = {"worst": sum(d["worst"] for d in draws) / len(draws), "average": sum(d["average"] for d in draws) / len(draws),
            "warned": sum(d["warned"] for d in draws) / len(draws)}
    hb, hbw = nm["held_out_by_case"], nm["held_out_by_case_worst"]
    rows = []

    def row(name, S, unseen, note=""):
        s = T.score(S)
        rows.append({"name": name, "set": [chambers[i] for i in S], "worst": s["worst"], "average": s["average"], "warned": s["warned"],
                     "unseen": unseen, "fails": T.one_fails(S), "note": note})
    row("Greedy: average", listS, sum(hb[c][str(rec)] for c in hb) / len(hb))
    row("Greedy: worst case", worstS, sum(hbw[c][str(rec)] for c in hbw) / len(hbw))
    # Unseen weather for Exact optimum: each wet case scored with the exact best set chosen without it (the same search).
    row("Exact optimum", exactS, T.unseen(lambda k, cs: T.exact(k, cs), rec))
    row("Desk: flow / capacity", deskS, None)
    row("Desk: most homes upstream", homesS, None)
    for r in rows:
        if r["unseen"] is None:          # a desk method uses no weather, so every case is unseen to it
            r["unseen"] = r["average"]
    out["compare"] = {"rows": rows, "random": rand, "draws": RANDOM_DRAWS, "pool": len(pool)}

    # Sensor types and how sure we are, step 6.
    B = fl["budgets"]
    f_un = sorted({round(sum(b["float"]["unseen_by_case"].values()) / len(b["float"]["unseen_by_case"]), 6) for b in B})   # averaged over the cases
    out["float_unseen"] = f_un
    out["greenfield"] = {"joins": gf_joins, "worst": gf_cover["worst"], "average": gf_cover["average"]}
    out["standins"] = {m: v["stand_ins"] for m, v in nm["swaps"][str(rec)].items()}
    return out


def main():
    nm = json.load(open(os.path.join(ROOT, "simulation_src", "results", "sim4", "numbers.json"), encoding="utf-8"))
    fl = json.load(open(os.path.join(ROOT, "simulation_src", "results", "sim4", "float.json"), encoding="utf-8"))
    reg = read_js(os.path.join(ROOT, "simulation4", "data", "regions.js"))
    geo = read_js(os.path.join(ROOT, "simulation3", "data", "catchment.js"))
    runs = read_js(os.path.join(ROOT, "simulation3", "data", "growth.js"))
    f = figures(nm, reg, geo, runs, fl, {"worst": 0, "average": 0}, 0)
    show = {k: v for k, v in f.items() if k not in ("pipes", "cutaway", "check")}
    print(json.dumps(show, indent=1, default=str)[:6000])
    print("pipes", {k: (v["bins"], v["count"]) for k, v in f["pipes"].items()})
    c = f["check"]
    print("check rho", round(c["rho"], 3), "n", c["n"], "five", c["five"], c["five_in"], "odd", c["odd"])
    cu = f["cutaway"]
    print("cutaway", cu["manhole"], cu["depthM"], cu["dia"], cu["mat"], cu["first_limit"], cu["cases"][0])


if __name__ == "__main__":
    main()
