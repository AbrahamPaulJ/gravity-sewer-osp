#!/usr/bin/env python3
"""
check_sim4_numbers.py - recomputes simulation_src/results/sim4/numbers.json (and float.json) from the raw SWMM rows in
simulation4/data/regions.js, without sim35_mix.py, sim4_numbers.py or any solver, so a mistake in those cannot hide here.
Run after sim4_numbers.py, from anywhere: python tools/check_sim4_numbers.py. Exit 1 on a failure.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "simulation_src", "results", "sim4")


def rd(path):
    s = open(path, encoding="utf8").read()
    return json.loads(s[s.index("{"):s.rstrip().rstrip(";").rindex("}") + 1])


reg = rd(os.path.join(ROOT, "simulation4", "data", "regions.js"))
s = open(os.path.join(ROOT, "simulation3", "data", "growth.js"), encoding="utf8").read()
at = s.index('"chambers":')
ch = json.loads(s[s.index("[", at):s.index("]", at) + 1])
X = json.load(open(os.path.join(RES, "numbers.json"), encoding="utf8"))
cap = json.load(open(os.path.join(RES, "capacity.json"), encoding="utf8"))
ix = {c: i for i, c in enumerate(ch)}
lad = reg["ladder"]
lab = {c["tag"]: c["label"] for c in reg["cases"]}
wet = [c["tag"] for c in reg["cases"] if c["ii"] > 0]
rid = [r["id"] for r in reg["regions"]]
DESIGN = next(c["tag"] for c in reg["cases"] if c["label"] == "Design wet")
fails = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail else ""))
    if not ok:
        fails.append(name)


# Triage from the capacity bands
act = {"runs out": "monitor", "uncertain": "watch", "room left": "leave", "already over": "leave"}
for r in rid:
    check(f"triage {r}", act[cap["bands"][DESIGN][r]["0.7"]["band"]] == X["triage"][r]["action"], X["triage"][r]["action"])
T = {rid.index(r) for r in rid if X["triage"][r]["action"] != "leave"}


def detect_runs(t, R=10):
    """Runs in target regions by 100% build-out where some manhole rises at least 10 mm; each with who hears it at R."""
    out = []
    for x in reg["rows"][t]:
        if x["r"] in T and lad[x["s"]] <= 1.0 and any(v >= 10 for _, v in x["rise"]):
            out.append({i for i, v in x["rise"] if v >= R})
    return out


def warn_runs(R=10):
    """Target-region overloads by 100% that a 10 mm rise anywhere precedes by one step; who hears it at that step."""
    out = []
    for t in wet:
        for ri in T:
            rows = sorted((x for x in reg["rows"][t] if x["r"] == ri), key=lambda x: x["s"])
            s = next((x["s"] for x in rows if x["sur"] or x["spill"]), None)
            if s is None or s < 1 or lad[s] > 1.0:
                continue
            prev = next(x for x in rows if x["s"] == s - 1)
            if any(v >= 10 for _, v in prev["rise"]):
                out.append({i for i, v in prev["rise"] if v >= R})
    return out


W = warn_runs()
check("warn universe", len(W) == X["warn_universe"]["target"], f"{len(W)}")
prev = []
for r in X["ladder"]:
    S = {ix[m] for m in r["chosen"]}
    per = {t: sum(bool(h & S) for h in detect_runs(t)) / len(detect_runs(t)) for t in wet}
    per25 = {t: sum(bool(h & S) for h in detect_runs(t, 25)) / len(detect_runs(t)) for t in wet}
    k = r["k"]
    check(f"k={k} exactly k sensors, nested", len(S) == k and set(prev) <= S)
    prev = list(S)
    check(f"k={k} worst", abs(min(per.values()) - r["worst"]) < 6e-5, f"{min(per.values()):.4f}")
    check(f"k={k} average", abs(sum(per.values()) / 7 - r["average"]) < 6e-5, f"{sum(per.values()) / 7:.4f}")
    check(f"k={k} Design wet", abs(per[DESIGN] - r["design_wet"]) < 6e-5, f"{per[DESIGN]:.4f}")
    check(f"k={k} 25 mm", abs(min(per25.values()) - r["worst_25"]) < 6e-5 and abs(sum(per25.values()) / 7 - r["average_25"]) < 6e-5)
    check(f"k={k} warned", sum(bool(h & S) for h in W) == r["warned_target"], f"{r['warned_target']}/{len(W)}")

# What the popups say is lost without a sensor
for k in ("2", "5"):
    for m, v in X["swaps"][k].items():
        rest = {ix[x] for x in X["ladder"][int(k) - 1]["chosen"]} - {ix[m]}
        per = {t: sum(bool(h & rest) for h in detect_runs(t)) / len(detect_runs(t)) for t in wet}
        same = abs(min(per.values()) - v["without_worst"]) < 6e-5 and abs(sum(per.values()) / 7 - v["without_average"]) < 6e-5 and abs(per[DESIGN] - v["without_design"]) < 6e-5
        check(f"k={k} without {m}", same and all(abs(per[t] - v["without_per_case"][lab[t]]) < 6e-5 for t in wet))

# Every reason: rises quoted are the raw rise at that manhole, and no leave region appears
for e in X["reasons"]:
    i = ix[e["manhole"]]
    for name, h in e["hears"].items():
        ri = rid.index(name)
        check(f"{e['manhole']} {name} is a target region", ri in T)
        rows = sorted((x for x in reg["rows"][DESIGN] if x["r"] == ri and lad[x["s"]] <= 1.0), key=lambda x: x["s"])
        rise = [dict((a, b) for a, b in x["rise"]).get(i, 0.0) for x in rows]
        first = next((j for j, v in enumerate(rise) if v >= 10), None)
        ok = (first is None and h["first_step"] is None) or (first is not None and lad[rows[first]["s"]] == h["first_step"] and abs(rise[first] - h["first_rise"]) < .06)
        check(f"{e['manhole']} first reading from {name}", ok)
        check(f"{e['manhole']} rise at 100% from {name}", abs(rise[-1] - h["rise_at_100"]) < .06)
    check(f"{e['manhole']} surcharged flag", (i in reg["base"][DESIGN]["surcharged"]) == e["surcharged_before_growth"])

# The fewest sensors that see all of Design wet: no smaller set does, and the list's first k0 do
full = detect_runs(DESIGN)
live = sorted({i for h in full for i in h})
k0 = next(f["1.0"] for f in X["fewest"] if f["scope"] == "Design wet only")
first = {ix[m] for m in X["ladder"][k0 - 1]["chosen"]}
singles = [a for a in live if all(a in h for h in full)]
check(f"the list's first {k0} see all of Design wet", all(h & first for h in full))
if k0 == 1:
    check("one sensor sees all of Design wet, and it starts the list", ch[next(iter(first))] in [ch[a] for a in singles], f"{len(singles)} single sensors do")
else:
    check("no single sensor sees all of Design wet", not singles)
    pairs = [(a, b) for x, a in enumerate(live) for b in live[x + 1:] if all(h & {a, b} for h in full)]
    check("a pair that sees all of Design wet starts the list", k0 > 2 or any(set(p) == first for p in pairs))

# The list of real overloads
hot = set()
for t in wet:
    for x in reg["rows"][t]:
        if lad[x["s"]] <= 1.0:
            hot |= set(x["sur"]) | set(x["spill"])
check("real overload manholes", {ch[i] for i in hot} == {o["manhole"] for o in X["overloads"]}, f"{len(hot)}")
check("none on the old choke list", not hot & {c["i"] for c in reg.get("chokePoints", [])})

# Level against float (float.json, from sim4_float.py): every set's scores from the raw rows. A float at height h in
# manhole i, case t, trips on a run when the rise there is at least the margin and lifts the water from the case's normal
# level b past h: b + margin <= h <= b + rise. It must also clear Design wet's normal level by the margin.
FP = os.path.join(RES, "float.json")
if os.path.exists(FP):
    F = json.load(open(FP, encoding="utf8"))
    mg = F["scope"]["float_margin_mm"]
    base = lambda t, i: reg["base"][t]["depthMm"].get(str(i), 0)

    def hears(t, rise, L, Fl):
        return any(rise.get(i, 0) >= 10 for i in L) or any(rise.get(i, 0) >= mg and base(t, i) + mg <= h <= base(t, i) + rise.get(i, 0) for i, h in Fl)

    det = {t: [dict((i, v) for i, v in x["rise"]) for x in reg["rows"][t] if x["r"] in T and lad[x["s"]] <= 1.0 and any(v >= 10 for _, v in x["rise"])] for t in wet}
    war = []
    for t in wet:
        for ri in T:
            rows = sorted((x for x in reg["rows"][t] if x["r"] == ri), key=lambda x: x["s"])
            s_ = next((x["s"] for x in rows if x["sur"] or x["spill"]), None)
            if s_ is None or s_ < 1 or lad[s_] > 1.0:
                continue
            p = next(x for x in rows if x["s"] == s_ - 1)
            if any(v >= 10 for _, v in p["rise"]):
                war.append((t, dict((i, v) for i, v in p["rise"])))
    check("float: warn universe", len(war) == F["scope"]["warn_total"])
    for b in F["budgets"]:
        for col in ("level", "float", "mix"):
            c = b[col]
            L = [ix[m] for m in c["level_at"]]
            Fl = [(ix[f["manhole"]], f["height_mm"]) for f in c["floats"]]
            per = {lab[t]: sum(hears(t, r, L, Fl) for r in det[t]) / len(det[t]) for t in wet}
            ok = all(abs(per[k] - c["per_case"][k]) < 6e-5 for k in per) and abs(min(per.values()) - c["worst"]) < 6e-5 \
                and abs(sum(per.values()) / len(per) - c["average"]) < 6e-5
            check(f"float: ${b['budget'] // 1000}k {col} scores", ok)
            check(f"float: ${b['budget'] // 1000}k {col} warned", sum(hears(t, r, L, Fl) for t, r in war) == c["warned"])
            check(f"float: ${b['budget'] // 1000}k {col} cost within budget",
                  c["cost"] == 25000 * len(L) + 1000 * len(Fl) <= b["budget"] and (len(L), len(Fl)) == (c["level"], c["float"]))
            check(f"float: ${b['budget'] // 1000}k {col} floats quiet on Design wet",
                  all(h >= base(DESIGN, i) + mg - 1e-6 for i, h in Fl))
        check(f"float: ${b['budget'] // 1000}k level column is the list", b["level"]["level_at"] == sorted(X["ladder"][b["k"] - 1]["chosen"]) and not b["level"]["floats"])

print(f"\n{'ALL PASS' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
