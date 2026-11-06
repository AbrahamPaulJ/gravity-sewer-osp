#!/usr/bin/env python3
"""
sim35_greenfield_curve.py - how many sensors it takes to see every greenfield run. Runs no SWMM.

After Siddhartha Balanagu's coverage prototype: Sim 3's greedy order, carried on past the ten it publishes until every
detectable run is seen. A run is one estate size joining at one manhole in one weather case. Each sensor is the manhole that
most raises the worst case's share, ties by the mean, then the lowest index. All five estate sizes count, 700 homes included.

Four of the eight weather cases are still fixed 480-minute runs, so each count is also worked out on the settled cases alone.

    python simulation/sim35_greenfield_curve.py     # writes results/sim35/greenfield_curve.json
"""
import json, os

import sim35_capacity as C

RULES = ("r10", "r25", "r50", "alarm")


def greedy(G, rule, cases):
    n = len(G["chambers"])
    cell = {(c["rule"], c["case"], c["add"]): c for c in G["cells"]}
    pools = [[set(r["tip"]) for lv in G["growthLevels"] for r in cell[(rule, ci, lv)]["rows"] if r["tip"]] for ci in cases]
    covered = [[False] * len(p) for p in pools]
    count = [0] * len(pools)
    order, worst, mean = [], [], []
    while len(order) < n:
        hits = [[0] * n for _ in pools]
        for c, p in enumerate(pools):
            for s, t in enumerate(p):
                if not covered[c][s]:
                    for m in t:
                        hits[c][m] += 1
        best, key_best = -1, None
        for m in range(n):
            if m in order:
                continue
            f = [(count[c] + hits[c][m]) / len(p) for c, p in enumerate(pools)]
            key = (min(f), sum(f) / len(f))
            if key_best is None or key[0] > key_best[0] + 1e-12 or (abs(key[0] - key_best[0]) <= 1e-12 and key[1] > key_best[1] + 1e-12):
                best, key_best = m, key
        order.append(best)
        for c, p in enumerate(pools):
            for s, t in enumerate(p):
                if not covered[c][s] and best in t:
                    covered[c][s] = True
                    count[c] += 1
        f = [count[c] / len(p) for c, p in enumerate(pools)]
        worst.append(round(min(f), 4))
        mean.append(round(sum(f) / len(f), 4))
        if min(f) >= 1:
            break
    return order, worst, mean


def reach(worst, q):
    return next((i + 1 for i, v in enumerate(worst) if v >= q), None)


def main():
    G = C.read_js(os.path.join(C.DATA, "growth.js"))
    every = list(range(len(G["cases"])))
    settled = [i for i, c in enumerate(G["cases"]) if c.get("settled", True)]
    out = {"cases": len(every), "settled_cases": len(settled), "sizes": G["growthLevels"], "rules": {}}
    for rule in RULES:
        order, worst, mean = greedy(G, rule, every)
        published = G["sensors"][rule]["worst"]["order"]
        if order[:len(published)] != published:
            raise SystemExit(f"{rule}: this greedy does not reproduce Sim 3's published order")
        _, w_settled, _ = greedy(G, rule, settled)
        out["rules"][rule] = {"n": len(order), "worst": worst, "mean": mean, "n90": reach(worst, .9),
                              "settled_n": len(w_settled), "settled_n90": reach(w_settled, .9)}
        print(rule, "to 100%", len(order), "to 90%", reach(worst, .9), "| settled cases: to 100%", len(w_settled), "to 90%", reach(w_settled, .9))
    os.makedirs(C.OUT, exist_ok=True)
    with open(os.path.join(C.OUT, "greenfield_curve.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
