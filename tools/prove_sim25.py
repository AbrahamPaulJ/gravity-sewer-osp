#!/usr/bin/env python3
"""Compute proven sensor optima, phased plans and leave-one-case-out scores for Sim 2.5.

Greedy is up to about 10 percentage points below the optimum in the worst case.
This offline integer program finds the best set at each size for either the worst
case or the mean case share, using the same growth scenarios as placement.js.

Run: python tools/prove_sim25.py --growth simulation25/data/growth.js
Dependencies: Python 3, numpy, pulp and highspy (pip install numpy pulp highspy).
"""
import argparse
import json
from pathlib import Path
import time

import numpy as np
import pulp


TIE_BREAK = 1e-4


def scenarios(runs, rule):
    """Keep nonempty tips at every growth size, then drop empty cases."""
    pools = [[] for _ in runs["cases"]]
    for cell in runs["cells"]:
        if cell["rule"] == rule:
            pools[cell["case"]].extend(row["tip"] for row in cell["rows"] if row["tip"])
    mats, labels = [], []
    for case, tips in zip(runs["cases"], pools):
        if not tips:
            continue
        matrix = np.zeros((len(tips), len(runs["chambers"])), dtype=bool)
        for i, tip in enumerate(tips):
            matrix[i, tip] = True
        mats.append(matrix)
        labels.append(case["label"])
    return mats, labels


def shares(mats, chosen):
    if not chosen:
        return [0.0] * len(mats)
    return [float(np.any(m[:, chosen], axis=1).sum()) / m.shape[0] for m in mats]


def scores(mats, chosen):
    values = shares(mats, chosen)
    return round(min(values), 4), round(sum(values) / len(values), 4)


def optimum(mats, k, objective, time_limit, fixed=()):
    """Merge identical rows with weights and solve the exact coverage program."""
    n = mats[0].shape[1]
    prob = pulp.LpProblem("maxmin_coverage", pulp.LpMaximize)
    x = [prob.add_variable(f"x{j}", cat="Binary") for j in range(n)]
    t = prob.add_variable("t", 0, 1)
    case_shares = []
    prob += pulp.lpSum(x) == k
    for j in fixed:
        prob += x[j] == 1
    for c, m in enumerate(mats):
        rows, weights = np.unique(m, axis=0, return_counts=True)
        terms = []
        for r, (row, weight) in enumerate(zip(rows, weights)):
            y = prob.add_variable(f"y{c}_{r}", 0, 1)
            prob += y <= pulp.lpSum(x[j] for j in np.flatnonzero(row))
            terms.append(int(weight) * y)
        prob += t * m.shape[0] <= pulp.lpSum(terms)
        case_shares.append(pulp.lpSum(terms) * (1.0 / (m.shape[0] * len(mats))))
    mean = pulp.lpSum(case_shares)
    prob += mean + TIE_BREAK * t if objective == "mean" else t + TIE_BREAK * mean
    start = time.time()
    # The default MIP gap can swallow the small secondary objective.
    status = prob.solve(pulp.HiGHS(msg=False, timeLimit=time_limit, gapRel=0, gapAbs=0))
    chosen = [j for j in range(n) if x[j].value() and x[j].value() > 0.5]
    # PuLP 4 returns a result object; PuLP 3 returns an integer status code.
    proven = (status.status == pulp.LpSolveStatus.Optimal if hasattr(status, "status")
              else status == pulp.LpStatusOptimal)
    if len(chosen) != k:
        raise RuntimeError(f"solver found no feasible {k}-sensor set")
    return chosen, proven, round(time.time() - start, 1)


def solve_rule(mats, labels, objective, phase1_k, k_max, time_limit):
    result = {"sets": [], "worst": [], "mean": [], "proven": [], "seconds": []}
    for k in range(1, k_max + 1):
        chosen, proven, seconds = optimum(mats, k, objective, time_limit)
        worst, mean = scores(mats, chosen)
        result["sets"].append(chosen)
        result["worst"].append(worst)
        result["mean"].append(mean)
        result["proven"].append(proven)
        result["seconds"].append(seconds)

    phase1 = result["sets"][phase1_k - 1][:]
    full, proven, _ = optimum(mats, k_max, objective, time_limit, fixed=phase1)
    remaining = sorted(set(full) - set(phase1))
    phase2, order = [], phase1[:]
    while remaining:
        # The current worst share is common to every candidate, so maximising
        # the new share maximises its gain. Stable ties go to the lower index.
        best = max(remaining, key=lambda j: min(shares(mats, order + [j])))
        phase2.append(best)
        order.append(best)
        remaining.remove(best)
    plan_scores = [scores(mats, order[:k]) for k in range(phase1_k, k_max + 1)]
    result["plan"] = {
        "phase1": phase1, "phase2": phase2, "order": order,
        "worst": [s[0] for s in plan_scores], "mean": [s[1] for s in plan_scores],
        "phase2_proven": proven,
    }
    if objective == "worst":
        held_out = []
        for c, label in enumerate(labels):
            train = [m for i, m in enumerate(mats) if i != c]
            if not train:
                raise ValueError("leave-one-case-out needs at least two nonempty cases")
            row = {"case": label}
            for k in dict.fromkeys((phase1_k, k_max)):
                chosen, _, _ = optimum(train, k, objective, time_limit)
                row[f"unseen_k{k}"] = round(shares([mats[c]], chosen)[0], 4)
                row[f"seen_k{k}"] = round(shares([mats[c]], order[:k])[0], 4)
            held_out.append(row)
        result["held_out"] = held_out
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--growth", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--rules", help="comma-separated rule ids (default: all)")
    parser.add_argument("--phase1", type=int, default=5)
    parser.add_argument("--time-limit", type=float, default=120)
    args = parser.parse_args()
    source = args.growth.read_text(encoding="utf-8")
    runs = json.loads(source.split("window.GROWTH_RUNS =", 1)[1].strip().removesuffix(";").strip())
    k_max = int(runs["maxSensors"])
    if not 1 <= args.phase1 <= k_max <= len(runs["chambers"]):
        parser.error("require 1 <= phase1 <= maxSensors <= number of chambers")
    if args.time_limit <= 0:
        parser.error("time-limit must be positive")
    available = [r["id"] for r in runs["rules"]]
    rules = list(dict.fromkeys(r.strip() for r in args.rules.split(","))) if args.rules else available
    if any(rule not in available for rule in rules):
        parser.error("unknown rule in --rules")
    proof = {"phase1K": args.phase1, "K": k_max, "rules": {}}
    for rule in rules:
        mats, labels = scenarios(runs, rule)
        if not mats:
            parser.error(f"no scenarios for rule {rule}")
        proof["rules"][rule] = {}
        for objective in ("worst", "mean"):
            result = solve_rule(mats, labels, objective, args.phase1, k_max, args.time_limit)
            proof["rules"][rule][objective] = result
            i = args.phase1 - 1
            all_proven = all(result["proven"]) and result["plan"]["phase2_proven"]
            print(f"{rule}/{objective}: k={args.phase1} worst {result['worst'][i]:.4f} "
                  f"mean {result['mean'][i]:.4f}; k={k_max} worst {result['worst'][-1]:.4f}; "
                  f"all proven: {all_proven}", flush=True)
    out = args.out if args.out is not None else args.growth.with_name("proof.js")
    out.write_text("// Generated by prove_sim25.py from growth.js. Do not edit by hand.\n"
                   "window.SIM25_PROOF = " + json.dumps(proof, separators=(",", ":")) + ";\n",
                   encoding="utf-8")


if __name__ == "__main__":
    main()
