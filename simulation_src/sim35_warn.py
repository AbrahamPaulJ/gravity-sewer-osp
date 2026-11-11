#!/usr/bin/env python3
"""
sim35_warn.py - Sim 3.5, item 1: level sensors chosen to warn before the first new surcharge. Runs no SWMM.

An OVERLOAD is one region's build-out in one wet case that newly surcharges or spills a manhole at some step s >= 1
(sim35_mix's "warn" scenarios). A set WARNS of it when one of its sensors rises at least R mm at step s - 1, one
build-out step before the first new surcharge. Overloads whose first surcharge comes by 100% build-out are the
plausible ones; the rest happen only at the 150% and 300% stress steps.

For k = 1 to 10 level sensors, at each of the 10, 25 and 50 mm rules:
    chosen     the exact set (HiGHS, through sim35_mix.Problem.solve) that maximises the worst wet case's share of
               overloads warned, then the average. When fewer than k sensors already score the best, the spare
               places go one at a time to the manhole that most raises Sim 3's detect score (worst, then average,
               then the lowest index). needed is the exact set's own size.
    worst, average, warned, plausible_warned       on the 7 wet cases the set was chosen on
    detect_worst, detect_average                   the same set on Sim 3's detect score
    out_case, plausible_unseen_weather             chosen without one wet case, scored on it alone: the mean
                                                   share, and the plausible overloads warned, summed over cases
    out_area, plausible_unseen_region              chosen without one region, scored on it alone: the share of
                                                   its overloads, and the plausible ones warned, over regions

    python sim35_warn.py     # writes results/sim35/warn.json

Simulation 3.5's warn sets came from this same method by a script that never reached the repository; on Sim 3.5's
regions (../simulation3/data/regions.js) this reproduces them exactly.
"""
import json, os

import sim35_mix as M

RULES = (10, 25, 50)
KMAX = 10
LEVEL = ("level",)
PLAUSIBLE = M.reg["ladder"].index(1.0) - 1      # a scenario's step is the one before its first surcharge


def tally(P, S, cases):
    """Overloads warned in these cases, and how many of them are plausible."""
    S = set(S); n = p = 0
    for t in cases:
        for sc in P.scen[t]:
            if sc["D"] & S:
                n += 1; p += sc["s"] <= PLAUSIBLE
    return n, p


def top_up(S, Pd, k):
    """Fill the spare places by Sim 3's detect score, one manhole at a time."""
    S = list(S)
    while len(S) < k:
        S.append(max((i for i in range(M.n) if i not in S), key=lambda i: (M.wm(Pd.score(S + [i], M.wet)), -i)))
    return S


def held_out(P, budget):
    """(out_case, out_area, plausible_unseen_weather, plausible_unseen_region)."""
    shares, pw = [], 0
    for hc in M.wet:
        S = P.solve(P.groups([t for t in M.wet if t != hc]), budget=budget, kinds=LEVEL)[0]
        sh = P.score(S, [hc]).get(hc)
        if sh is not None:
            shares.append(sh)
        pw += tally(P, S, [hc])[1]
    hit = tot = pr = 0
    for ra in range(M.nreg):
        if not any(sc["r"] == ra for t in M.wet for sc in P.scen[t]):
            continue
        S = set(P.solve(P.groups(M.wet, lambda sc, ra=ra: sc["r"] != ra), budget=budget, kinds=LEVEL)[0])
        for t in M.wet:
            for sc in P.scen[t]:
                if sc["r"] == ra:
                    seen = bool(sc["D"] & S)
                    tot += 1; hit += seen; pr += seen and sc["s"] <= PLAUSIBLE
    return sum(shares) / len(shares), hit / tot, pw, pr


def rule(R):
    P, Pd = M.Problem("warn", R, M.MARGIN), M.Problem("detect", R, M.MARGIN)
    total = sum(len(P.scen[t]) for t in M.wet)
    plausible = sum(sc["s"] <= PLAUSIBLE for t in M.wet for sc in P.scen[t])
    sets = []
    for k in range(1, KMAX + 1):
        budget = k * M.PRICE["level"]
        exact = P.solve(P.groups(M.wet), budget=budget, kinds=LEVEL)[0]
        S = top_up(exact, Pd, k)
        w, a = M.wm(P.score(S, M.wet))
        dw, da = M.wm(Pd.score(S, M.wet))
        oc, oa, pw, pr = held_out(P, budget)
        warned, pwarned = tally(P, S, M.wet)
        sets.append({"k": k, "chosen": S, "needed": len(exact), "worst": round(w, 4), "average": round(a, 4),
                     "plausible_unseen_weather": pw, "plausible_unseen_region": pr,
                     "warned": warned, "plausible_warned": pwarned,
                     "detect_worst": round(dw, 4), "detect_average": round(da, 4),
                     "out_case": round(oc, 4), "out_area": round(oa, 4)})
        print(f"  {R} mm, {k:2d} sensors: warns of {pwarned} of {plausible} plausible overloads; "
              f"unseen weather {pw}, unseen region {pr}", flush=True)
    return {"R": R, "total": total, "plausible_total": plausible, "sets": sets}


def main():
    out = {f"r{R}": rule(R) for R in RULES}
    os.makedirs(M.C.OUT, exist_ok=True)
    with open(os.path.join(M.C.OUT, "warn.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1)
    print("wrote", os.path.relpath(os.path.join(M.C.OUT, "warn.json"), M.C.HERE))


if __name__ == "__main__":
    main()
