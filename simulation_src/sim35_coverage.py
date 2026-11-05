#!/usr/bin/env python3
"""
sim35_coverage.py - the curves on Sim 3.5's Sensor coverage tab. Runs no SWMM.

The tab takes its map and chart design from Siddhartha Balanagu's coverage view, but its logic is Sim 3.5's, so the page
has one set of numbers: Sim 3's region runs, the 7 wet cases, the 10 mm and 25 mm rules, and sim35_mix's float rule.
Each point is the best set of that many sensors, solved exactly for the worst wet case.

    python simulation/sim35_coverage.py     # writes results/sim35/coverage.json
"""
import json, os

import sim35_mix as M

LEVEL_MAX = 20
FLOATS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 35, 40]


def curve(P, counts, price, kinds):
    out = []
    for c in counts:
        S = P.solve(P.groups(M.wet), budget=c * price, kinds=kinds)[0]
        w, a = M.wm(P.score(S, M.wet))
        out.append({"n": len(S), "worst": round(w, 4), "average": round(a, 4)})
        if w >= 1 - 1e-9:
            break
    return out


def main():
    out = {"rules": {}}
    for rule, R in (("r10", 10), ("r25", 25)):
        P = M.Problem("detect", R, M.MARGIN)
        level = curve(P, range(1, LEVEL_MAX + 1), M.PRICE["level"], ("level",))
        floats = curve(P, FLOATS, M.PRICE["float"], ("float",))
        # What every manhole at once could see: the ceiling a rule allows, whatever the budget.
        wc, ac = M.wm(P.score(list(range(M.n)), M.wet))
        out["rules"][rule] = {"R": R, "level": level, "float": floats, "ceiling_worst": round(wc, 4), "ceiling_average": round(ac, 4)}
        print(rule, "level", [(x["n"], x["worst"]) for x in level], "ceiling", round(wc, 4))
        print(rule, "float", [(x["n"], x["worst"], x["average"]) for x in floats])
    os.makedirs(M.C.OUT, exist_ok=True)
    with open(os.path.join(M.C.OUT, "coverage.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
