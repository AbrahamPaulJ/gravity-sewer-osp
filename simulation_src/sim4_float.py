"""
sim4_float.py - Sim 4's level against float comparison, for the same money, on Sim 4's runs.

Same scope as sim4_numbers.py: target regions (monitor and watch), build-out up to 100%, the 7 wet cases, the 10 mm rule
for a level sensor. A float earns credit as in sim35_mix.py: it sits at least MARGIN (25 mm, assumed) above the manhole's
normal level, stays quiet on a Design wet day, sits under the lid, and trips when growth carries the water past it.

For each budget of 1 to 8 level sensors' worth ($25k each, assumed; a float $1k, assumed):
  level  the first k of Sim 4's sensor list (numbers.json), so the playground and the story agree
  float  floats only, chosen by the exact solver for the best worst wet case
  mix    level sensors and floats together, chosen the same way
Each is scored on the runs it was chosen on (worst and average of the 7 wet cases, overloads warned of) and on unseen
weather: chosen without one wet case, scored on that case, runs pooled over the 7. The level column's unseen weather is
numbers.json's (the same search without the case), so it matches the rest of Sim 4.

    python sim4_float.py      # writes results/sim4/float.json and float_report.txt, under a minute
"""
import json, os, time

import sim4_numbers as N

M = N.M
n, ch, wet, lab, lad = M.n, M.ch, M.wet, M.label, N.lad
OUT = N.OUT
KMAX = N.KMAX
lines = []


def say(*a):
    t = " ".join(str(x) for x in a)
    print(t, flush=True)
    lines.append(t)


def main():
    t0 = time.time()
    X = json.load(open(os.path.join(OUT, "numbers.json"), encoding="utf-8"))
    tri = N.triage()
    T = {M.rid.index(i) for i, v in tri.items() if v["action"] != "leave"}
    assert sorted(M.rid[r] for r in T) == X["targets"], "targets moved since numbers.json: rerun sim4_numbers.py first"
    d_keep = lambda sc: sc["r"] in T and lad[sc["s"]] <= 1.0
    w_keep = lambda sc: sc["r"] in T and lad[sc["s"] + 1] <= 1.0
    Det, War = M.Problem("detect", 10, M.MARGIN), M.Problem("warn", 10, M.MARGIN)
    assert Det.opts == War.opts, "float options differ between the two scores"
    ix = {c: i for i, c in enumerate(ch)}
    n_warn = sum(1 for t in wet for sc in War.scen[t] if w_keep(sc))
    assert n_warn == X["warn_universe"]["target"], "warn universe differs from numbers.json"

    def describe(S, k):
        S = set(S)
        per = Det.score(S, wet, d_keep)
        warned = sum(bool(sc["D"] & S) for t in wet for sc in War.scen[t] if w_keep(sc))
        lv, fl = Det.names(S)
        floats = []
        for v in sorted(x for x in S if x >= n):
            i, h = Det.opts[v - n]
            floats.append({"manhole": ch[i], "height_mm": h, "above_design_normal_mm": round(h - M.b_of(M.C.DESIGN, i), 1),
                           "tripped_before_growth": len(Det.tripped_wet(v - n))})
        return {"level_at": sorted(lv), "floats": floats, "level": len(lv), "float": len(fl), "cost": Det.cost(S),
                "per_case": {lab[t]: round(x, 4) for t, x in per.items()}, "worst": round(min(per.values()), 4),
                "average": round(sum(per.values()) / len(per), 4), "warned": warned}

    def prune(S, cases):
        """Drop whatever adds nothing on the runs the set was chosen on. The solver stops within its gap (1e-3), so it can
        buy floats that score nothing; a set shown with a price must not. Floats go first, the dearest last."""
        S = list(S)
        full = Det.score(S, cases, d_keep)
        for v in sorted(S, key=lambda v: (v < n, -v)):
            rest = [x for x in S if x != v]
            if rest and all(abs(Det.score(rest, cases, d_keep)[t] - full[t]) < 1e-12 for t in full):
                S = rest
        return S

    def unseen(kinds, budget):
        seen = tot = 0
        per = {}
        for hc in wet:
            rest = [t for t in wet if t != hc]
            S, status = Det.solve(Det.groups(rest, d_keep), budget=budget, kinds=kinds)
            assert S is not None, f"no solution without {lab[hc]}"
            S = prune(S, rest)
            L = [sc for sc in Det.scen[hc] if d_keep(sc)]
            got = sum(bool(sc["D"] & set(S)) for sc in L)
            seen += got; tot += len(L); per[lab[hc]] = round(got / len(L), 4)
        return [seen, tot], per

    rows = []
    say("=== Level against float for the same money: target regions, up to 100%, 7 wet cases, 10 mm rule, float margin "
        f"{M.MARGIN:.0f} mm, prices ${M.PRICE['level']:,} and ${M.PRICE['float']:,} (assumed)")
    say(f"  {'budget':>8s}  {'level (the list)':>28s}  {'floats only':>28s}  {'free mix':>28s}")
    for k in range(1, KMAX + 1):
        B = k * M.PRICE["level"]
        e = {"k": k, "budget": B}
        lad_k = X["ladder"][k - 1]
        e["level"] = describe([ix[m] for m in lad_k["chosen"]], k)
        assert abs(e["level"]["worst"] - lad_k["worst"]) < 1e-9 and abs(e["level"]["average"] - lad_k["average"]) < 1e-9 \
            and e["level"]["warned"] == lad_k["warned_target"], f"level column disagrees with numbers.json at k={k}"
        h = next(x for x in X["held_out"] if x["k"] == k)
        e["level"]["unseen_weather"] = h["weather_runs"]
        e["level"]["unseen_by_case"] = {c: v[str(k)] for c, v in X["held_out_by_case"].items()}
        for name, kinds in (("float", ("float",)), ("mix", ("level", "float"))):
            S, status = Det.solve(Det.groups(wet, d_keep), budget=B, kinds=kinds)
            assert S is not None and status == 0, f"{name} at ${B}: solver status {status}"
            bought = len(S)
            S = prune(S, wet)
            e[name] = describe(S, k)
            e[name]["pruned"] = bought - len(S)
            e[name]["status"] = int(status)
            e[name]["unseen_weather"], e[name]["unseen_by_case"] = unseen(kinds, B)
        rows.append(e)
        txt = lambda c: f"{c['worst']:4.0%}/{c['average']:4.0%} w{c['warned']:2d} u{c['unseen_weather'][0] / c['unseen_weather'][1]:4.0%} {c['level']}L+{c['float']}F" + (f" -{c['pruned']}" if c.get("pruned") else "")
        say(f"  {B:8,d}  {txt(e['level']):>28s}  {txt(e['float']):>28s}  {txt(e['mix']):>28s}")
    say("  (worst/average of the 7 wet cases; w = overloads warned of, of " + str(n_warn) + "; u = unseen weather, runs pooled)")
    fl8 = rows[-1]["float"]
    zero = [c for c, v in fl8["per_case"].items() if v == 0]
    say(f"\n  Floats only, at ${rows[-1]['budget']:,}: {fl8['float']} floats bought (the solver buys only what adds something). "
        f"Wet cases where no float sees any run: {zero}. Per case: {fl8['per_case']}")
    tripped = sorted({f["tripped_before_growth"] for r in rows for f in r["float"]["floats"] + r["mix"]["floats"]})
    say(f"  Wet cases in which a chosen float is already tripped before any growth: {tripped}")
    payload = {"scope": {"targets": X["targets"], "up_to": 1.0, "rule_mm": 10, "float_margin_mm": M.MARGIN, "price": M.PRICE, "warn_total": n_warn},
               "budgets": rows}
    with open(os.path.join(OUT, "float.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, indent=1)
    with open(os.path.join(OUT, "float_report.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    say(f"\ndone in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
