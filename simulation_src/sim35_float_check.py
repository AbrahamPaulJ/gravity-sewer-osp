#!/usr/bin/env python3
"""
sim35_float_check.py - how much does the level-or-float answer rest on our own float rule? Runs no SWMM.

sim35_mix.py credits a float only if it clears the manhole's normal level by a margin (25 mm, assumed) in the
case being scored, and only offers heights that stay quiet on a Design wet day (assumed). This re-solves the
float-only and level-only sets with the quiet rule removed, and with smaller margins, against the same scenarios.

Removing the quiet rule is generous to floats: a float low enough to be already tripped in Design wet is still
credited in any drier or differently loaded case where it clears the normal level.

    python simulation/sim35_float_check.py     # writes results/sim35/float_check.json and float_check.txt
"""
import json, os

import sim35_mix as M

C = M.C
lines = []


def say(*a):
    t = " ".join(str(x) for x in a)
    print(t, flush=True)
    lines.append(t)


def open_options(margin):
    """Every float height under the lid, quiet on a Design wet day or not."""
    opts = []
    for i, (o, d) in enumerate(M.gm):
        if o is None:
            continue
        for h in [o + f * d for f in M.FRACTIONS] + [o + d + a for a in M.ABOVE_CROWN]:
            if h <= M.rim[i]:
                opts.append((i, round(h, 1)))
    return opts


def row(P, name, budget, kinds):
    S = P.solve(P.groups(M.wet), budget=budget, kinds=kinds)[0]
    c = M.cell(P, S)
    h = M.rounded(M.heldout(P, budget=budget, kinds=kinds))
    per = P.score(S, M.wet)
    say(f"  {name:22s} {c['level']:2d}L+{c['float']:2d}F  worst {c['worst']:4.0%} average {c['average']:4.0%}"
        f"  unseen weather {h['case_mean']:4.0%}  unseen region {h['area']:4.0%}"
        + (f"  floats tripped before growth, median {c['tripped_median']:.0f} of 7 wet cases" if c["tripped_median"] is not None else ""))
    return {"name": name, "level": c["level"], "float": c["float"], "worst": c["worst"], "average": c["average"],
            "tripped_median": c["tripped_median"], "unseen_weather": h["case_mean"], "unseen_region": h["area"],
            "per_case": {M.label[t]: round(v, 4) for t, v in per.items()}}


def main():
    out = {"variants": []}
    stock = M.float_options
    for quiet, margin in ((True, 25), (False, 25), (False, 10), (False, 0)):
        M.float_options = stock if quiet else open_options
        # a zero margin is not a rule anyone would install; it is the most generous bound
        P = M.Problem("detect", 10, margin)
        tag = f"{'quiet on Design wet' if quiet else 'quiet rule removed'}, margin {margin} mm"
        say(f"\n=== {tag}: float options {len(P.opts)}, useful {len(P.useful)}")
        rows = [row(P, "25 floats budget", 25000, ("float",)),
                row(P, "125 floats budget", 125000, ("float",))]
        if quiet or margin == 25:
            rows.append(row(P, "1 level sensor", 25000, ("level",)))
            rows.append(row(P, "5 level sensors", 125000, ("level",)))
        worst = rows[0]["per_case"]
        say("  25 floats by case:", {k: f"{v:.0%}" for k, v in worst.items()})
        out["variants"].append({"quiet": quiet, "margin": margin, "rows": rows})
    M.float_options = stock
    os.makedirs(C.OUT, exist_ok=True)
    with open(os.path.join(C.OUT, "float_check.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1)
    with open(os.path.join(C.OUT, "float_check.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
