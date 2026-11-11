#!/usr/bin/env python3
"""
sim4_numbers.py - the one set of figures behind Sim 4. Runs no SWMM: it re-reads Sim 3's settled runs through
sim35_mix.py and sim35_capacity.py, and fixes what the Sim 3.5 audit found (docs/22_sim4_plan_DRAFT.md).

    triage      each region is monitor, watch or leave, from its capacity band: Design wet, limit 0.7.
                runs out = monitor; uncertain = watch; room left or already over = leave.
    scope       sensors are chosen only for monitor and watch regions, on build-out up to 100% (the 2041 homes).
                The 150% and 300% steps are stress steps and never decide a sensor.
    ladder      ONE nested order of sensors: the k-sensor set is the (k-1)-sensor set plus one. It starts with the
                smallest set that sees all of Design wet. Then the best 5-sensor set containing it, on worst +
                average over the 7 wet cases + share of overloads warned, with the 25 mm score breaking ties, is
                put in the order that scores best on the way up and extended to 8. Compared with the exact solver
                at every k, so the price of nesting is a reported figure; the 5-sensor pick is checked by brute force.
    held out    the same search without the weather case or region being tested, always exactly k sensors, so
                "5 sensors" means 5 sensors everywhere.
    baseline    random sets of k, from any manhole and from manholes that respond at all.
    reasons     for each sensor: what it hears, how many homes before it reads, what it adds, what is lost
                without it, and which manholes could stand in for it.
    overloads   the manholes that really newly surcharge or spill by 100%, replacing Sim 3's choke list.

Level sensors only; the float comparison stays in sim35_mix.py. Prices are assumed, as everywhere.

    SIM35_TARGET=sim4 python sim35_capacity.py   # first: the capacity bands on Sim 4's regions, results/sim4/capacity.json
    python sim4_numbers.py                        # writes results/sim4/numbers.json and numbers_report.txt

Sim 4's regions are the equal-home regions (Kim et al. 2022 spatial bisection) in simulation4/data/regions.js. Run with
SIM35_TARGET=sim35 to read Sim 3's hand-picked regions instead (it needs results/sim35/capacity.json): the checks tied to
those regions apply only then, and it writes numbers_handpicked.json and its report beside numbers.json, for the
story's comparison of the two region cuts.
"""
import heapq, itertools, json, os, random, sys, time
from collections import Counter, defaultdict

os.environ.setdefault("SIM35_TARGET", "sim4")      # Sim 4's own regions and capacity file, before sim35_capacity is read
import sim35_mix as M

C = M.C
reg, geo = M.reg, M.geo
lad, wet, lab, rid, ch, n = reg["ladder"], M.wet, M.label, M.rid, M.ch, M.n
DESIGN = C.DESIGN
LIMIT = "0.7"
KMAX = 8
RECOMMEND = 5        # the headline count: the 7 wet cases pass 80% worst case and the curve flattens after
WIDTH = 1500
DRAWS = 5000
SEED = 4
OUT = os.path.join(C.HERE, "results", "sim4")
LISTED = C.TARGET != "sim4"      # Sim 3's hand-picked regions: the checks below that name their regions apply only to them
STEM = "numbers_handpicked" if LISTED else "numbers"
ACTION = {"runs out": "monitor", "uncertain": "watch", "room left": "leave", "already over": "leave"}
lines = []
cap = json.load(open(os.path.join(C.OUT, "capacity.json"), encoding="utf-8"))


def say(*a):
    t = " ".join(str(x) for x in a)
    print(t, flush=True)
    lines.append(t)


def pct(v):
    return "n/a" if v is None else f"{v:.0%}"


class Universe:
    """One score on one set of scenarios, as bitmasks. Level sensors only."""

    def __init__(self, P, keep, cases):
        self.cases = [t for t in cases if any(keep(sc) for sc in P.scen[t])]
        self.scen = {t: [sc for sc in P.scen[t] if keep(sc)] for t in self.cases}
        self.mask = {t: [0] * n for t in self.cases}
        for t in self.cases:
            for j, sc in enumerate(self.scen[t]):
                for d in sc["D"]:
                    if d < n:
                        self.mask[t][d] |= 1 << j

    def ors(self, S):
        out = {}
        for t in self.cases:
            x = 0
            for i in S:
                x |= self.mask[t][i]
            out[t] = x
        return out

    def per(self, S):
        o = self.ors(S)
        return {t: bin(o[t]).count("1") / len(self.scen[t]) for t in self.cases}

    def wa(self, S):
        p = self.per(S)
        return (min(p.values()), sum(p.values()) / len(p)) if p else (None, None)

    def seen(self, S):
        o = self.ors(S)
        return sum(bin(o[t]).count("1") for t in self.cases)

    def total(self):
        return sum(len(L) for L in self.scen.values())


def value(U, Uw, S):
    """What one step of the ladder is worth: worst + average + share of overloads warned."""
    w, a = U.wa(S)
    return w + a + (Uw.seen(S) / Uw.total() if Uw.total() else 0.0)


def design_seeds(U, Uw):
    """Every smallest set that sees all of Design wet: the ladder's first rung, because 'is the design day right?'
    is the first question. None if Design wet is held out, or no set of 1 or 2 manages it."""
    if DESIGN not in U.cases:
        return None
    full = (1 << len(U.scen[DESIGN])) - 1
    m = U.mask[DESIGN]
    live = [i for i in range(n) if m[i]]
    one = [(i,) for i in live if m[i] == full]
    two = [(a, b) for x, a in enumerate(live) for b in live[x + 1:] if m[a] | m[b] == full]
    return one or two or None


def beam_ladder(U, Uw, U25, K=KMAX, width=WIDTH):
    """The Design wet set, then the best RECOMMEND-sensor set containing it, in the order that scores best on the way
    up, then extended one sensor at a time to K. Returns (ladder, every set tied with the best at RECOMMEND)."""
    seeds = design_seeds(U, Uw) or [()]
    pool = [i for i in range(n) if any(U.mask[t][i] for t in U.cases) or any(Uw.mask[t][i] for t in Uw.cases)]
    tw = Uw.total() or 1
    beam = seeds
    for k in range(len(seeds[0]) + 1, RECOMMEND + 1):
        best = {}
        for S in beam:
            base, bw = U.ors(S), Uw.ors(S)
            for i in pool:
                if i in S:
                    continue
                key = frozenset(S) | {i}
                if key in best:
                    continue
                w, tot = None, 0.0
                for t in U.cases:
                    v = bin(base[t] | U.mask[t][i]).count("1") / len(U.scen[t])
                    w = v if w is None or v < w else w
                    tot += v
                warned = sum(bin(bw[t] | Uw.mask[t][i]).count("1") for t in Uw.cases) / tw
                best[key] = (S + (i,), round(w + tot / len(U.cases) + warned, 6))
        beam = [x[0] for x in heapq.nlargest(width, best.values(), key=lambda x: (x[1], x[0]))]
    top = round(value(U, Uw, beam[0]), 6)
    equal = [S for S in beam if round(value(U, Uw, S), 6) == top]
    pick = max(equal, key=lambda S: (round(sum(U25.wa(S)), 6), tuple(-i for i in S)))
    head = list(pick[:len(seeds[0])])
    if len(head) > 1:
        head = list(max(itertools.permutations(head), key=lambda o: (round(value(U, Uw, o[:1]), 6), tuple(-i for i in o))))
    rest = max(itertools.permutations(pick[len(seeds[0]):]),
               key=lambda o: (round(sum(value(U, Uw, head + list(o[:j])) for j in range(1, len(o) + 1)), 6), tuple(-i for i in o)))
    L = head + list(rest)
    while len(L) < K:
        L.append(max((i for i in pool if i not in L), key=lambda i: (round(value(U, Uw, L + [i]), 6), round(sum(U25.wa(L + [i])), 6), -i)))
    return L, equal


def triage():
    b = cap["bands"][DESIGN]
    out = {}
    for r in reg["regions"]:
        i = r["id"]
        x = b[i]
        out[i] = {"action": ACTION[x[LIMIT]["band"]], "band": x[LIMIT]["band"], "homes_2041": x["share_100"], "homes_now": r["dwellings"],
                  "p_runs_out": x[LIMIT]["p_runs_out"], "homes_p10": x[LIMIT]["homes_p10"], "homes_p90": x[LIMIT]["homes_p90"],
                  "mm_per_100_homes": x["rise_mm_per_100_homes"], "by_limit": {L: ACTION[x[L]["band"]] for L in ("0.5", "0.6", "0.7")},
                  "bands_by_case": {lab[t]: cap["bands"][t][i][LIMIT]["band"] for t in wet}}
    return out


def along_pipe():
    g = defaultdict(list)
    for u, d, l in zip(geo["up"], geo["down"], geo["plen"]):
        g[u].append((d, l)); g[d].append((u, l))
    nix = {nd["name"]: j for j, nd in enumerate(geo["nodes"])}

    def dist(a, b):
        src, dst = nix[ch[a]], nix[ch[b]]
        seen, h = {}, [(0.0, src)]
        while h:
            d, u = heapq.heappop(h)
            if u in seen:
                continue
            seen[u] = d
            if u == dst:
                return round(d)
            for v, l in g[u]:
                if v not in seen:
                    heapq.heappush(h, (d + l, v))
        return None
    return dist


def main():
    t0 = time.time()
    tri = triage()
    T = {rid.index(i) for i, v in tri.items() if v["action"] != "leave"}
    Tn = [rid[r] for r in sorted(T)]
    if LISTED:
        assert {i for i, v in tri.items() if v["action"] == "monitor"} == {"R1", "R2"} and {i for i, v in tri.items() if v["action"] == "watch"} == {"R4", "R8"}, "triage moved: read the report before trusting the story"

    say("=== 1. Triage: Design wet, limit 0.7. runs out = monitor, uncertain = watch, room left = leave")
    for i, v in tri.items():
        kept = sum(b == v["band"] for b in v["bands_by_case"].values())
        say(f"  {i}: {v['action']:8s} band {v['band']:10s} 2041 homes {v['homes_2041']:5.0f} (homes there now {v['homes_now']}); "
            f"same band in {kept} of 7 wet cases; limit 0.5/0.6/0.7 {v['by_limit']['0.5']}/{v['by_limit']['0.6']}/{v['by_limit']['0.7']}")
    say("  Bands by wet case: " + "; ".join(f"{i} " + ",".join(b.replace('runs out', 'O').replace('uncertain', 'U').replace('room left', 'R').replace('already over', 'A') for b in v["bands_by_case"].values()) for i, v in tri.items()))
    anchor = [i for i, v in tri.items() if round(v["homes_2041"]) == round(reg["anchor"])]
    s7 = sum(v["homes_2041"] for i, v in tri.items() if i not in anchor)
    say(f"  Homes: the other regions add up to {s7:.0f}; {', '.join(anchor) or 'no region'} alone is {round(reg['anchor'])} (the whole anchor by design, docs/18 D18). They are not shares of one total.")

    Det = {R: M.Problem("detect", R, M.MARGIN) for R in (10, 25)}
    War = {R: M.Problem("warn", R, M.MARGIN) for R in (10, 25)}
    d_ok = lambda sc: lad[sc["s"]] <= 1.0
    w_ok = lambda sc: lad[sc["s"] + 1] <= 1.0
    in_T = lambda sc: sc["r"] in T
    d_keep = lambda sc: in_T(sc) and d_ok(sc)
    w_keep = lambda sc: in_T(sc) and w_ok(sc)
    U = {R: Universe(Det[R], d_keep, wet) for R in (10, 25)}
    Uw = {R: Universe(War[R], w_keep, wet) for R in (10, 25)}
    Uall = Universe(Det[10], d_ok, wet)
    Ustress = Universe(Det[10], in_T, wet)
    Uw13 = Universe(War[10], w_ok, wet)
    Uw25 = Universe(War[10], lambda sc: True, wet)
    Udry = Universe(Det[10], d_keep, [M.tags[0]])
    Ud = Universe(Det[10], d_keep, [DESIGN])

    # Bitmasks must agree with the scoring every Sim 3.5 figure came from.
    probe = list(range(0, n, 37))
    for R in (10, 25):
        a, b = U[R].per(probe), Det[R].score([i for i in probe], wet, d_keep)
        assert all(abs(a[t] - b[t]) < 1e-12 for t in a), "bitmask score disagrees with sim35_mix"

    say("\n=== 2. What is being scored")
    say(f"  Target regions {Tn}. Runs a sensor could see at 10 mm by 100% build-out: " + ", ".join(f"{lab[t]} {len(U[10].scen[t])}" for t in wet))
    say(f"  Dry, reported apart: {Udry.total()} target runs show a 10 mm rise anywhere by 100%. Wet-day sensors are not chosen for these.")
    say(f"  Overloads warnable by 100%: {Uw[10].total()} in target regions of {Uw13.total()} anywhere ({Uw25.total()} counting stress steps).")
    dropped = [(lab[t], rid[sc["r"]], lad[sc["s"] + 1]) for t in wet for sc in War[10].scen[t] if w_ok(sc) and not in_T(sc)]
    say(f"  Warnable overloads given up by leaving regions out: {dropped}")
    left = []
    for t in wet:
        for ri in range(M.nreg):
            if ri in T:
                continue
            rows = sorted((x for x in reg["rows"][t] if x["r"] == ri), key=lambda x: x["s"])
            star = next((j for j, x in enumerate(rows) if x["sur"] or x["spill"]), None)
            if star is not None and lad[rows[star]["s"]] <= 1.0:
                left.append({"case": lab[t], "region": rid[ri], "step": lad[rows[star]["s"]],
                             "max_rise_before": max([v for _, v in rows[star - 1]["rise"]] or [0]) if star else 0})
    say(f"  Every overload by 100% in a leave region, warnable or not: {left}")

    say("\n=== 3. The ladder: nested, level sensors, target regions, up to 100%, 7 wet cases")
    L, equal = beam_ladder(U[10], Uw[10], U[25])
    say("  Order: " + ", ".join(ch[i] for i in L))
    exact = {}
    rows = []
    say(f"  {'k':>2s}  {'worst/avg':>10s} {'exact worst/avg':>16s} {'Design':>7s} {'25mm w/a':>10s} {'warned':>7s} {'of 13':>6s} {'all regions':>12s} {'Dry':>5s}   exact set")
    for k in range(1, KMAX + 1):
        S = L[:k]
        w, a = U[10].wa(S); w25, a25 = U[25].wa(S)
        ex = Det[10].solve(Det[10].groups(wet, d_keep), budget=k * M.PRICE["level"], kinds=("level",))
        Sx = ex[0]; exact[k] = Sx
        xw, xa = U[10].wa(Sx)
        assert w <= xw + 2e-3 + 1e-9 or ex[1] != 0, f"ladder beats the exact solver at k={k}: one of them is wrong"
        allw, alla = Uall.wa(S)
        r = {"k": k, "added": ch[L[k - 1]], "chosen": [ch[i] for i in S], "worst": round(w, 4), "average": round(a, 4),
             "exact_worst": round(xw, 4), "exact_average": round(xa, 4), "exact_status": int(ex[1]), "exact_set": [ch[i] for i in Sx],
             "design_wet": round(U[10].per(S)[DESIGN], 4), "per_case": {lab[t]: round(v, 4) for t, v in U[10].per(S).items()},
             "worst_25": round(w25, 4), "average_25": round(a25, 4),
             "warned_target": Uw[10].seen(S), "warned_target_25": Uw[25].seen(S), "warned_13": Uw13.seen(S), "warned_25_overloads": Uw25.seen(S),
             "all_regions_worst": round(allw, 4), "all_regions_average": round(alla, 4),
             "stress_worst": round(Ustress.wa(S)[0], 4), "stress_average": round(Ustress.wa(S)[1], 4),
             "dry": round(Udry.per(S)[M.tags[0]], 4) if Udry.cases else None, "cost": k * M.PRICE["level"]}
        rows.append(r)
        say(f"  {k:2d}  {w:4.0%}/{a:4.0%}  {xw:7.0%}/{xa:4.0%}  {r['design_wet']:7.0%} {w25:4.0%}/{a25:4.0%} {r['warned_target']:4d}/{Uw[10].total():<2d} {r['warned_13']:3d}/13 {allw:6.0%}/{alla:4.0%} {r['dry'] if r['dry'] is None else format(r['dry'], '5.0%')}   {[ch[i] for i in Sx]}")
    say(f"  [{(time.time() - t0) / 60:.1f} min]")

    freq = Counter(i for S in equal for i in S)
    say(f"  How firm is the {RECOMMEND}-sensor set? {len(equal)} sets tie for best on worst, average and warned. Each sensor is in: " + ", ".join(f"{ch[i]} {freq[i]}" for i in L[:RECOMMEND]))
    seed = design_seeds(U[10], Uw[10])
    assert seed, "no set of 1 or 2 sensors sees all of Design wet: read the report"
    if LISTED:
        assert len(seed) == 1 and len(seed[0]) == 2, "the Design wet pair is no longer unique: read the report"
    pair = list(L[:len(seed[0])])      # the ladder's Design wet set: one of the smallest sets that see all of it
    assert any(set(pair) == set(x) for x in seed), "the ladder does not start with a Design wet set"
    say(f"  Smallest sets that see all of Design wet: {len(seed)} of {len(seed[0])} sensor(s); the ladder starts with {[ch[i] for i in pair]}.")
    pool = sorted({d for t in wet for sc in U[10].scen[t] for d in sc["D"] if d < n} | {d for t in Uw[10].cases for sc in Uw[10].scen[t] for d in sc["D"] if d < n})
    brute = max(round(value(U[10], Uw[10], pair + list(c)), 6) for c in itertools.combinations([i for i in pool if i not in pair], RECOMMEND - len(pair)))
    mine = round(value(U[10], Uw[10], L[:RECOMMEND]), 6)
    say(f"  Brute force over every {RECOMMEND}-sensor set with the Design wet set: best value {brute}, ladder {mine}.")
    assert mine >= brute - 1e-6, "the beam missed the best five: widen it"
    say(f"  [{(time.time() - t0) / 60:.1f} min]")

    say("\n=== 4. Fewest sensors by how much of the weather you must cover (exact, target regions, up to 100%)")
    scopes = (("Design wet only", [DESIGN]), ("Design wet + Beyond design", [DESIGN, "ii0.25_flat_uniform_b1_sfree"]),
              ("Design wet family (3)", [t for t in wet if t.startswith("ii0.11")]), ("All 7 wet cases", wet))
    fewest = []
    for name, cs in scopes:
        e = {"scope": name}
        for tau in (.8, .9, 1.0):
            S = Det[10].solve(Det[10].groups(cs, d_keep), tau=tau, kinds=("level",))[0]
            e[str(tau)] = None if S is None else len(S)
            first = next((k for k in range(1, KMAX + 1) if min(U[10].per(L[:k])[t] for t in cs) >= tau - 1e-9), None)
            e[f"ladder_{tau}"] = first
        fewest.append(e)
        say(f"  {name:28s} exact 80/90/100%: {e['0.8']}/{e['0.9']}/{e['1.0']}    ladder reaches them at {e['ladder_0.8']}/{e['ladder_0.9']}/{e['ladder_1.0']}")

    say("\n=== 5. Held out, exactly k sensors, same search without what is being tested")
    held = []
    bw = {}; br = {}
    for hc in wet:
        rest = [t for t in wet if t != hc]
        bw[hc] = beam_ladder(Universe(Det[10], d_keep, rest), Universe(War[10], w_keep, rest), Universe(Det[25], d_keep, rest))[0]
    for ra in sorted(T):
        k2 = lambda sc, ra=ra: in_T(sc) and d_ok(sc) and sc["r"] != ra
        k3 = lambda sc, ra=ra: in_T(sc) and w_ok(sc) and sc["r"] != ra
        br[ra] = beam_ladder(Universe(Det[10], k2, wet), Universe(War[10], k3, wet), Universe(Det[25], k2, wet))[0]
    say(f"  [{(time.time() - t0) / 60:.1f} min]")
    Uby = {t: (Universe(Det[10], d_keep, [t]), Universe(War[10], w_keep, [t])) for t in wet}
    Urg = {ra: (Universe(Det[10], lambda sc, ra=ra: d_ok(sc) and sc["r"] == ra, wet), Universe(War[10], lambda sc, ra=ra: w_ok(sc) and sc["r"] == ra, wet)) for ra in T}
    for k in range(1, KMAX + 1):
        assert all(len(v[:k]) == k for v in list(bw.values()) + list(br.values()))
        ws = sum(Uby[t][0].seen(bw[t][:k]) for t in wet); wt = sum(Uby[t][0].total() for t in wet)
        wo = sum(Uby[t][1].seen(bw[t][:k]) for t in wet); wn = sum(Uby[t][1].total() for t in wet)
        ww = min(Uby[t][0].per(bw[t][:k])[t] for t in wet)
        rs = sum(Urg[ra][0].seen(br[ra][:k]) for ra in T); rt = sum(Urg[ra][0].total() for ra in T)
        ro = sum(Urg[ra][1].seen(br[ra][:k]) for ra in T); rn = sum(Urg[ra][1].total() for ra in T)
        per_r = {rid[ra]: round(Urg[ra][0].seen(br[ra][:k]) / Urg[ra][0].total(), 4) for ra in T}
        held.append({"k": k, "weather_runs": [ws, wt], "weather_worst": round(ww, 4), "weather_warned": [wo, wn], "region_runs": [rs, rt], "region_warned": [ro, rn], "region_per": per_r})
        say(f"  k={k}: unseen weather runs {ws}/{wt} ({ws / wt:.0%}), worst case {ww:.0%}, warned {wo}/{wn} | unseen region runs {rs}/{rt} ({rs / rt:.0%}) {per_r}, warned {ro}/{rn}")
    held_case = {lab[t]: {str(k): round(Uby[t][0].per(bw[t][:k])[t], 4) for k in range(1, KMAX + 1)} for t in wet}
    say("  Unseen weather by case, runs seen at k=2/3/5/8:")
    for t in wet:
        say(f"   {lab[t]:38s} {len(Uby[t][0].scen[t]):2d} runs: " + " ".join(f"{held_case[lab[t]][str(k)]:4.0%}" for k in (2, 3, 5, 8)))

    say("\n=== 6. Random sets of k, same runs")
    rng = random.Random(SEED)
    resp = sorted({d for t in wet for sc in U[10].scen[t] for d in sc["D"] if d < n})
    say(f"  Manholes that respond at 10 mm to any target run by 100%: {len(resp)} of {n}")
    base = []
    for k in range(1, KMAX + 1):
        e = {"k": k}
        for name, pool in (("any", list(range(n))), ("responsive", resp)):
            sw, sa, sn = [], [], []
            for _ in range(DRAWS):
                S = rng.sample(pool, k)
                w, a = U[10].wa(S)
                sw.append(w); sa.append(a); sn.append(Uw[10].seen(S))
            r = rows[k - 1]
            sw.sort(); sa.sort(); sn.sort()
            e[name] = {"worst_mean": round(sum(sw) / DRAWS, 4), "worst_p95": round(sw[int(.95 * DRAWS)], 4), "avg_mean": round(sum(sa) / DRAWS, 4), "avg_p95": round(sa[int(.95 * DRAWS)], 4),
                       "warned_mean": round(sum(sn) / DRAWS, 2), "warned_p95": sn[int(.95 * DRAWS)],
                       "share_matching_ladder_worst": round(sum(x >= r["worst"] - 1e-9 for x in sw) / DRAWS, 4), "share_matching_ladder_avg": round(sum(x >= r["average"] - 1e-9 for x in sa) / DRAWS, 4)}
        base.append(e)
        a_, b_ = e["any"], e["responsive"]
        say(f"  k={k}: ladder {rows[k - 1]['worst']:4.0%}/{rows[k - 1]['average']:4.0%} warned {rows[k - 1]['warned_target']} | any {a_['worst_mean']:4.0%}/{a_['avg_mean']:4.0%} warned {a_['warned_mean']:.1f} | responsive {b_['worst_mean']:4.0%}/{b_['avg_mean']:4.0%} warned {b_['warned_mean']:.1f}, 95th pct {b_['worst_p95']:4.0%}/{b_['avg_p95']:4.0%}, draws matching ladder avg {b_['share_matching_ladder_avg']:.2%}")
    say(f"  [{(time.time() - t0) / 60:.1f} min]")

    say("\n=== 7. Why each sensor is there (Design wet unless stated). No leave region or stress step can appear here")
    dist = along_pipe()
    home = defaultdict(list)
    for r in reg["regions"]:
        for m in r["manholes"]:
            home[m].append(r["id"])
    bD = reg["base"][DESIGN]
    reasons = []
    for p, i in enumerate(L):
        before = L[:p]
        new = []
        for t in wet:
            done = U[10].ors(before)[t]
            for j, sc in enumerate(U[10].scen[t]):
                if (U[10].mask[t][i] >> j) & 1 and not (done >> j) & 1:
                    new.append((t, sc))
        hears = {}
        for ri in sorted(T):
            rr = sorted((x for x in reg["rows"][DESIGN] if x["r"] == ri and lad[x["s"]] <= 1.0), key=lambda x: x["s"])
            ladder_rise = [(lad[x["s"]], round(x["dw"]), dict((a, b) for a, b in x["rise"]).get(i, 0.0)) for x in rr]
            first = next(((s, h, v) for s, h, v in ladder_rise if v >= 10), None)
            cases = [lab[t] for t in wet if any(x["r"] == ri and lad[x["s"]] <= 1.0 and dict((a, b) for a, b in x["rise"]).get(i, 0.0) >= 10 for x in reg["rows"][t])]
            hears[rid[ri]] = {"first_step": first and first[0], "first_homes": first and first[1], "first_rise": first and round(first[2], 1),
                              "rise_at_100": round(ladder_rise[-1][2], 1) if ladder_rise else 0, "cases_heard": cases}
        o, d = M.gm[i]
        depth = bD["depthMm"].get(str(i), 0)
        entry = {"position": p + 1, "manhole": ch[i], "home_regions": home[i], "adds_runs": len(new),
                 "adds_by_region": dict(Counter(rid[sc["r"]] for _, sc in new)), "adds_by_case": dict(Counter(lab[t] for t, _ in new)),
                 "hears": hears, "design_wet_silent": not any(v["first_step"] for v in hears.values()),
                 "design_depth_mm": depth, "bore_mm": d, "design_fullness": None if o is None else round((depth - o) / d, 3),
                 "surcharged_before_growth": i in bD["surcharged"], "over_alarm_before_growth": i in bD.get("alarm", []),
                 "nearest_earlier_m": min((dist(i, j) for j in before), default=None)}
        assert set(entry["adds_by_region"]) <= set(Tn) and set(hears) == set(Tn)
        reasons.append(entry)
        hh = "; ".join(f"{r_} from {v['first_homes']} homes (+{v['first_rise']} mm), +{v['rise_at_100']} at 100%" if v["first_step"] else f"{r_} silent ({len(v['cases_heard'])}/7 wet cases hear it)" for r_, v in hears.items())
        say(f"  {p + 1}. {ch[i]} in {','.join(home[i]) or 'no region (downstream)'}{' [leave region: it is there for the flow passing through]' if set(home[i]) and not set(home[i]) & set(Tn) else ''}; adds {len(new)} runs {entry['adds_by_region']}; nearest earlier {entry['nearest_earlier_m']} m; fullness {entry['design_fullness']}{' [SURCHARGED BEFORE GROWTH in the model: check on site]' if entry['surcharged_before_growth'] else ''}; {hh}")

    say("\n  Taking one out, and manholes that could stand in with the same worst and average:")
    swaps = {}
    for k in range(1, KMAX + 1):
        S = L[:k]; w0, a0 = U[10].wa(S)
        for i in S:
            rest = [x for x in S if x != i]
            lo = U[10].wa(rest) if rest else (0.0, 0.0)
            alt = [j for j in range(n) if j not in S and min(U[10].wa(rest + [j])[0] - w0, U[10].wa(rest + [j])[1] - a0) >= -1e-9]
            alt.sort(key=lambda j: dist(i, j) if dist(i, j) is not None else 1e9)
            swaps.setdefault(str(k), {})[ch[i]] = {"without_worst": round(lo[0], 4), "without_average": round(lo[1], 4), "without_warned": Uw[10].seen(rest), "without_design": round(U[10].per(rest)[DESIGN], 4) if rest else 0.0,
                                                 "without_per_case": {lab[t]: round(v, 4) for t, v in U[10].per(rest).items()} if rest else {}, "stand_ins": len(alt), "nearest_stand_ins": [(ch[j], dist(i, j)) for j in alt[:3]]}
        if k in (2, 4, 5, 6):
            say(f"   k={k}: " + "; ".join(f"{m} without {pct(v['without_worst'])}/{pct(v['without_average'])}, stand-ins {v['stand_ins']} {[a for a, _ in v['nearest_stand_ins'][:2]]}" for m, v in swaps[str(k)].items()))

    say("\n=== 8. Where the model really overloads by 100% (replaces the choke list), and the words to use")
    hot = defaultdict(lambda: {"runs": 0, "spill_runs": 0, "cases": set(), "regions": set()})
    for t in wet:
        for x in reg["rows"][t]:
            if lad[x["s"]] <= 1.0:
                for i in set(x["sur"]) | set(x["spill"]):
                    h = hot[i]; h["runs"] += 1; h["spill_runs"] += i in x["spill"]; h["cases"].add(lab[t]); h["regions"].add(rid[x["r"]])
    ranked = sorted(hot, key=lambda i: (-hot[i]["runs"], ch[i]))
    choke = {c["i"] for c in reg["chokePoints"]}
    over = [{"manhole": ch[i], "runs": hot[i]["runs"], "spill_runs": hot[i]["spill_runs"], "cases": sorted(hot[i]["cases"]), "regions": sorted(hot[i]["regions"]),
             "from_target_region": bool(hot[i]["regions"] & set(Tn)), "on_old_choke_list": i in choke, "home_regions": home[i]} for i in ranked]
    say(f"  {len(over)} manholes newly surcharge or spill by 100%; {sum(o['from_target_region'] for o in over)} from target-region growth; {sum(o['on_old_choke_list'] for o in over)} on Sim 3's choke list of {len(choke)}.")
    for o in over[:8]:
        say(f"   {o['manhole']}: {o['runs']} runs, {o['spill_runs']} spilling; {len(o['cases'])} cases; growth in {o['regions']}; sits in {o['home_regions'] or 'none'}")
    facts = {"before_growth": {lab[t]: {"surcharged": len(reg["base"][t]["surcharged"]), "spilled": len(reg["base"][t]["spilled"])} for t in M.tags},
             "design_wet_at_100": {"regions_with_new_surcharge": sum(bool(x["sur"]) for x in reg["rows"][DESIGN] if lad[x["s"]] == 1), "regions_with_new_spill": sum(bool(x["spill"]) for x in reg["rows"][DESIGN] if lad[x["s"]] == 1)},
             "design_wet_any_step_new_spill": sum(bool(x["spill"]) for x in reg["rows"][DESIGN]),
             "wet_rows_new_spill_by_100": sum(bool(x["spill"]) for t in wet for x in reg["rows"][t] if lad[x["s"]] <= 1.0),
             "wet_rows_new_surcharge_by_100": sum(bool(x["sur"]) for t in wet for x in reg["rows"][t] if lad[x["s"]] <= 1.0),
             "wet_rows_by_100": sum(1 for t in wet for x in reg["rows"][t] if lad[x["s"]] <= 1.0)}
    say("  Before growth: " + ", ".join(f"{k} {v['surcharged']} surcharged/{v['spilled']} spilling" for k, v in facts["before_growth"].items()))
    say(f"  Design wet at 100%: {facts['design_wet_at_100']}; new spill at any step in Design wet: {facts['design_wet_any_step_new_spill']}. All wet rows by 100%: {facts['wet_rows_new_surcharge_by_100']} with new surcharge, {facts['wet_rows_new_spill_by_100']} with new spill, of {facts['wet_rows_by_100']}.")
    say("  So: growth here means surcharge, the warning sign before an overflow. It is not a count of overflows.")

    say("\n=== 9. Sim 3.5's two '5 sensor' sets on the Sim 4 scope, and back on their old scope (audit check)")
    ix = {c: i for i, c in enumerate(ch)}
    old = {"Sim 3.5 map five": ["MH4449173", "MH4450531", "MH4452541", "MH4450922", "MH4454629"], "Sim 3.5 coverage five": ["MH4429013", "MH4449796", "MH4450922", "MH4452541", "MH4454629"]}
    compare = {}
    Uold = Universe(Det[10], lambda sc: True, wet)
    for name, ms in old.items():
        S = [ix[m] for m in ms]
        w, a = U[10].wa(S); ow, oa = Uold.wa(S)
        compare[name] = {"worst": round(w, 4), "average": round(a, 4), "design_wet": round(U[10].per(S)[DESIGN], 4), "warned": Uw[10].seen(S), "old_worst": round(ow, 4), "old_average": round(oa, 4), "old_warned_13": Uw13.seen(S)}
        say(f"  {name}: Sim 4 scope {w:.0%}/{a:.0%}, Design wet {U[10].per(S)[DESIGN]:.0%}, warned {Uw[10].seen(S)}/{Uw[10].total()}; old scope {ow:.0%}/{oa:.0%} warned {Uw13.seen(S)}/13")
    if LISTED:
        assert (round(compare["Sim 3.5 map five"]["old_worst"], 2), round(compare["Sim 3.5 coverage five"]["old_worst"], 2)) == (.80, .86), "old figures no longer reproduce"

    os.makedirs(OUT, exist_ok=True)
    payload = {"rule": {"limit": 0.7, "case": lab[DESIGN], "action": ACTION}, "triage": tri, "targets": Tn,
               "leave_overloads": left, "warnable_given_up": dropped, "ladder": rows, "tied_best_sets": len(equal), "in_tied_sets": {ch[i]: freq[i] for i in L[:RECOMMEND]}, "recommend": RECOMMEND, "fewest": fewest,
               "held_out": held, "held_out_by_case": held_case, "random": base, "reasons": reasons, "swaps": swaps, "overloads": over, "facts": facts, "old_sets": compare,
               "price": M.PRICE, "responsive_manholes": len(resp), "universe": {lab[t]: len(U[10].scen[t]) for t in wet}, "warn_universe": {"target": Uw[10].total(), "plausible": Uw13.total(), "all": Uw25.total()}}
    with open(os.path.join(OUT, STEM + ".json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, indent=1)
    say(f"\ndone in {(time.time() - t0) / 60:.1f} min")
    with open(os.path.join(OUT, STEM + "_report.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
