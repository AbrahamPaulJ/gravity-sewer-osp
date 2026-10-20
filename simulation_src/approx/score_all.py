"""score_all.py - both approximations scored against SWMM on every condition (after run_all.py).

    python simulation_src/approx/score_all.py

Per condition: baseline depth error and surcharged count; the share of growth runs the network
solve converged; the share of SWMM's detections each method finds and of its own flags that are
false, at rises of 10, 25 and 50 mm; the median rise error where SWMM rises 10 mm or more; and
how many 10 mm rises a +10-dwelling development (about 0.1 L/s) produces. Per grid: sensors
chosen on each method's rises (worst-case greedy over that grid's conditions), scored on SWMM's,
against SWMM's own greedy choice.
"""
import json, glob, os, statistics as S
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
os.chdir(SRC)
GRIDS = {"whole": "results/sim25/grid_whole", "segment": "results/sim25/grid"}
METHODS = ("newton", "tree")
RULES = (10, 25, 50)


def label(case):
    w = {0.0: "Dry", 0.11: "Design wet", 0.25: "I&I 0.25", 0.4: "Severe"}[round(case["ii"], 2)]
    x = []
    if case["pf"] != "flat": x.append("Harmon PF")
    if case["age"] != "uniform": x.append("age-weighted")
    if case["bfac"] != 1: x.append("outside x%g" % case["bfac"])
    return w + (" + " + ", ".join(x) if x else "")


def table(rows, t):
    return [{int(k) for k, v in r.items() if v >= t} for r in rows]


def greedy(cases, k=5):
    pool = set().union(*[set().union(*c) for c in cases if c])
    chosen, order = set(), []
    for _ in range(k):
        if not pool - chosen:
            break
        best = max(pool - chosen, key=lambda m: (
            min(sum(1 for t in c if t & (chosen | {m})) / len(c) for c in cases),
            sum(sum(1 for t in c if t & (chosen | {m})) / len(c) for c in cases)))
        chosen.add(best); order.append(best)
    return order


def score(order, cases):
    out = []
    for i in range(1, len(order) + 1):
        ch = set(order[:i]); fr = [sum(1 for t in c if t & ch) / len(c) for c in cases]
        out.append("%d/%d" % (round(100 * min(fr)), round(100 * sum(fr) / len(fr))))
    return out


report = []
for grid, path in GRIDS.items():
    conds = []
    for f in sorted(glob.glob(os.path.join(path, "ii*", "summary.json"))):
        s = json.load(open(f))
        a = os.path.join(SRC, "results", "approx", "allcond", grid, s["tag"] + ".json")
        if os.path.exists(a):
            conds.append((s, json.load(open(a))))
    print("=" * 30, grid, "grid:", len(conds), "conditions")
    print("%-34s %-17s %-6s | %-40s | %s" % ("condition", "baseline from", "conv", "baseline depth: median/p90 err, <25mm, surch (SWMM)", "detections found%/false% at 10, 25, 50 mm | median rise err"))
    for s, A in conds:
        sw_rows = [r["rise_mm"] for r in s["rows"]]
        conv = 100 * sum(r["conv"] for r in A["rows"]) / len(A["rows"])
        for meth in METHODS:
            bd = A["base"][meth]; cr = A["base"]["crown"]
            e = sorted(abs(bd[k] - s["baseline_depth_m"][k]) * 1000 for k in bd)
            sur = sum(bd[k] >= cr[k] - 1e-4 for k in bd)
            det = []
            for t in RULES:
                Aw, Bm = table(sw_rows, t), table([r[meth] for r in A["rows"]], t)
                tp = sum(len(x & y) for x, y in zip(Aw, Bm)); fn = sum(len(x - y) for x, y in zip(Aw, Bm)); fp = sum(len(y - x) for x, y in zip(Aw, Bm))
                det.append("%3d/%-3d" % (round(100 * tp / max(tp + fn, 1)), round(100 * fp / max(tp + fp, 1))))
            errs = [abs(r[meth].get(k, 0.0) - v) for sw, r in zip(sw_rows, A["rows"]) for k, v in sw.items() if v >= 10]
            print("%-34s %-17s %-6s | %-6s %5.1f/%-6.0f %3d%% %4d (%d) | %s | %.1f mm" % (
                label(s["case"]) if meth == "newton" else "", A["base"]["from"] if meth == "newton" else "",
                ("%d%%" % conv) if meth == "newton" else "", meth, S.median(e), e[int(.9 * len(e))],
                round(100 * sum(x < 25 for x in e) / len(e)), sur, len(s["baseline"]["surcharged"]),
                "  ".join(det), S.median(errs) if errs else 0.0))
    # SWMM's own small rises: from the smallest development, which adds about 0.1 L/s
    print("SWMM rises >= 10 mm from a +10-dwelling development (about 0.1 L/s), per condition:")
    for s, A in conds:
        n10 = [(r, a) for r, a in zip(s["rows"], A["rows"]) if r["dwellings"] == 10]
        k = sum(1 for r, _ in n10 for v in r["rise_mm"].values() if v >= 10)
        kn = sum(1 for _, a in n10 for v in a["newton"].values() if v >= 10)
        print("   %-34s SWMM %4d   network solve %4d" % (label(s["case"]), k, kn))
    # placement over the grid's conditions: chosen on the approximation, scored on SWMM
    print("5 sensors, worst-case greedy over this grid's conditions, scored by SWMM (worst%/mean% for 1..5 sensors):")
    for t in RULES:
        sw_cases = [[x for x in table([r["rise_mm"] for r in s["rows"]], t) if x] for s, _ in conds]
        keep = [i for i, c in enumerate(sw_cases) if c]
        sw_cases = [sw_cases[i] for i in keep]
        line = ["   >=%d mm" % t]
        for meth in METHODS:
            ap = [[x for x in table([r[meth] for r in conds[i][1]["rows"]], t) if x] for i in keep]
            ap = [c for c in ap if c]
            line.append("%s %s" % (meth, " ".join(score(greedy(ap), sw_cases))))
        line.append("SWMM %s" % " ".join(score(greedy(sw_cases), sw_cases)))
        print(" | ".join(line))
