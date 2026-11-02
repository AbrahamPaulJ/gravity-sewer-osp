"""sim3e_build.py - Sim 3-e: estimate headroom everywhere from a few sensors. No SWMM run.

The 26 Oct 2026 review made a point the earlier versions did not answer: sewers are built with
spare room, so the useful question is not "will a sensor notice growth?" but "how much room is
left, and when will it run out?". The utility already knows where new homes connect; what it
cannot see is how full each pipe runs. Sim 3-e places sensors to ESTIMATE that, everywhere.

  states       every saved settled SWMM run: Sim 3's eight areas x seven build-out steps x
               eight cases, their baselines, and the whole-suburb runs of sim3e_runs.py.
               A state is the fullness (depth / pipe diameter, d/D) at all 328 manholes.
  critical     the manholes that reach d/D >= CRIT_DD in any state up to the 2041 projection:
               where the room is being used up.
  estimator    a "virtual sensor": a linear map, learned from the states, from the d/D read at
               a few sensor manholes to the d/D at every critical manhole (ridge regression).
  placement    greedy: add the manhole that most lowers the estimation error at critical
               manholes, judged on growth it has not learned from (each area, the corridor and
               the whole suburb held out in turn) in the worst weather case.
  timeline     from the whole-suburb runs: the year each manhole first reaches 0.7 d/D and
               full, if the 2021-41 projection arrives evenly (2041 = 100%).
  sensors      level sensors are the estimation anchors; float switches go where a pipe is
               still under 0.7 d/D today but reaches it soonest (an early-warning alarm).

Reads, never writes: results/sim3/regions/*/summary.json, results/sim3/regions/analysis.json,
results/sim3e/suburb.json, results/sim25/grid_whole/*/summary.json (out-of-family test).
Writes: results/sim3e/analysis.json and simulation3e/data/sim3e.js.

    ~/.venvs/sewer/bin/python simulation_src/sim3e/sim3e_build.py
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
ROOT = os.path.dirname(SRC)
if SRC not in sys.path:
    sys.path.insert(0, SRC)
os.chdir(SRC)

import sim25                       # noqa: E402
from sim25 import Case, Sim25Model  # noqa: E402

SIM3 = os.path.join(SRC, "results", "sim3", "regions")
SUBURB = os.path.join(SRC, "results", "sim3e", "suburb.json")
GRID25 = os.path.join(SRC, "results", "sim25", "grid_whole")
OUT_JSON = os.path.join(SRC, "results", "sim3e", "analysis.json")
OUT_JS = os.path.join(ROOT, "simulation3e", "data", "sim3e.js")

# ---- declared settings (each is listed on simulation3e/about.html) ----
CRIT_DD = 0.5       # a manhole is critical if it reaches half full by 2041 in some case
WARN_DD = 0.7       # Kimbrough (2019): running at or above 0.7 d/D marks capacity risk
CLIP_DD = 1.2       # above this the pipe is surcharged; the exact value matters less
GOOD_ERR = 0.10     # an estimate within 0.10 d/D counts as good
RIDGE = 1e-3        # ridge strength, relative to the number of training states
MAX_K = 10
RANDOM_SETS, SEED = 20, 31
YEAR0, YEARS_PER_STEP = 2021, 20      # step 1.0 of the ladder = the 2021-41 projection
PRICES = {"level": 25000, "float": 1500}   # AUD; the industry partner's figures, 26 Oct 2026


def dia_by_manhole():
    m = Sim25Model(Case(ii=0.11), whole=True)
    net = m.net
    out = {}
    for c in m.candidates:
        nid, mh = m.chambers[c], m.nodes[c].manhole_id
        outs = net.nodes[nid].outs
        out[mh] = (min(net.pipes[p].dia for p in outs) if outs
                   else max(net.pipes[p].dia for p in net.nodes[nid].ins))
    return out


def fit(Xs, Y):
    """Ridge fit Y ~ Xs, returning (mean_x, mean_y, B)."""
    mx, my = Xs.mean(0), Y.mean(0)
    Xc, Yc = Xs - mx, Y - my
    k = Xs.shape[1]
    B = np.linalg.solve(Xc.T @ Xc + RIDGE * len(Xs) * np.eye(k), Xc.T @ Yc)
    return mx, my, B


def predict(model, Xs):
    mx, my, B = model
    return my + (Xs - mx) @ B


def main():
    s3a = json.load(open(os.path.join(SIM3, "analysis.json"), encoding="utf-8"))
    tags = s3a["cases"]
    mids = [int(m) for m in s3a["candidates"]]
    idx = {m: i for i, m in enumerate(mids)}
    n = len(mids)
    dia_m = dia_by_manhole()
    dia = np.array([dia_m[m] for m in mids])
    regions = s3a["regions"]
    region_of = {}
    for r in regions:
        for m in r["manholes"]:
            region_of.setdefault(int(m), r["id"])

    # ------------------------------------------------------------------ states
    X, case_of, kind, step_of = [], [], [], []
    base_dd = {}
    for ci, tag in enumerate(tags):
        s = json.load(open(os.path.join(SIM3, tag, "summary.json"), encoding="utf-8"))
        b = np.array([s["baseline_depth_m"][str(m)] for m in mids])
        base_dd[tag] = b / dia
        X.append(b / dia); case_of.append(ci); kind.append("base"); step_of.append(0.0)
        for r in s["rows"]:
            d = b.copy()
            for k, v in r["rise_mm"].items():
                if int(k) in idx:
                    d[idx[int(k)]] += v / 1000
            X.append(d / dia); case_of.append(ci); kind.append(r["region"]); step_of.append(r["step"])
    sub = json.load(open(SUBURB, encoding="utf-8"))
    assert sub["cases"] == tags, "suburb runs are not in Sim 3's case order"
    suburb_dd = {t: {} for t in tags}
    for r in sub["rows"]:
        d = np.array([r["depth_mm"][str(m)] / 1000 for m in mids])
        X.append(d / dia); case_of.append(tags.index(r["case"])); kind.append("suburb"); step_of.append(r["step"])
        suburb_dd[r["case"]][r["step"]] = d / dia
    X = np.clip(np.array(X), 0, CLIP_DD)
    case_of, step_of = np.array(case_of), np.array(step_of)
    ncase = len(tags)
    print(f"{len(X)} states ({sum(k == 'suburb' for k in kind)} whole-suburb) over {ncase} cases")

    # ------------------------------------------------------------------ critical manholes
    upto = step_of <= 1.0
    crit = np.where(X[upto].max(0) >= CRIT_DD)[0]
    print(f"critical manholes (reach {CRIT_DD} d/D by 2041 in some case): {len(crit)} of {n}")
    Y = X[:, crit]

    # Validation: hold out one GROWTH SOURCE at a time (an area, the corridor or the whole
    # suburb), in every weather case, learn from the rest, and predict the held-out states.
    # Where growth lands is the real unknown; the weather range (dry to severe) is covered by
    # the learning. Baseline states are always learned from. Scores are then per weather case.
    kind = np.array(kind)
    groups = [g for g in dict.fromkeys(kind.tolist()) if g != "base"]
    folds = [(np.where(kind != g)[0], np.where(kind == g)[0]) for g in groups]
    test_idx = np.concatenate([te for _, te in folds])

    def loco(S):
        """Held-out-growth predictions; per weather case, RMSE and share within GOOD_ERR."""
        P = np.empty((len(X), len(crit)))
        for tr, te in folds:
            if S:
                P[te] = predict(fit(X[tr][:, S], Y[tr]), X[te][:, S])
            else:
                P[te] = Y[tr].mean(0)
        rm, good, per_mh = [], [], np.zeros(len(crit))
        for c in range(ncase):
            te = test_idx[case_of[test_idx] == c]
            E = P[te] - Y[te]
            rm.append(float(np.sqrt((E ** 2).mean())))
            good.append(float((np.abs(E) <= GOOD_ERR).mean()))
            per_mh += np.sqrt((E ** 2).mean(0))
        return rm, good, per_mh / ncase

    def weather_check(S):
        """Second check: hold out a whole weather case that lies inside the learned range."""
        out = {}
        for c, tag in enumerate(tags):
            if tag.startswith("ii0.00") or tag.startswith("ii0.40"):
                continue          # dry and severe are the range's ends: holding them out is extrapolation
            tr, te = np.where(case_of != c)[0], np.where(case_of == c)[0]
            E = predict(fit(X[tr][:, S], Y[tr]), X[te][:, S]) - Y[te]
            out[tag] = {"rmse": round(float(np.sqrt((E ** 2).mean())), 4),
                        "good": round(float((np.abs(E) <= GOOD_ERR).mean()), 4)}
        return out

    def score(S):
        rm, good, _ = loco(S)
        return max(rm), float(np.mean(rm)), min(good), float(np.mean(good))

    # ------------------------------------------------------------------ greedy placement
    order, curve = [], []
    w0, m0, g0, gm0 = score([])
    curve.append({"k": 0, "worst_rmse": round(w0, 4), "mean_rmse": round(m0, 4),
                  "worst_good": round(g0, 4), "mean_good": round(gm0, 4)})
    gain_by_sensor = []
    for k in range(MAX_K):
        _, _, before = loco(order)
        best, best_v = None, None
        for m in range(n):
            if m in order:
                continue
            v = score(order + [m])
            key = (v[0], v[1])
            if best_v is None or key < best_v:
                best, best_v = m, key
        order.append(best)
        _, _, after = loco(order)
        gain_by_sensor.append(before - after)
        w, mm, g, gm = score(order)
        curve.append({"k": k + 1, "worst_rmse": round(w, 4), "mean_rmse": round(mm, 4),
                      "worst_good": round(g, 4), "mean_good": round(gm, 4)})
        print(f"  {k + 1:2d} sensors: + MH{mids[best]} ({region_of.get(mids[best], '?')}), worst RMSE "
              f"{w:.3f} d/D, worst share within {GOOD_ERR}: {100 * g:.0f}%", flush=True)

    # ------------------------------------------------------------------ comparisons at 5
    K = 5
    rng = np.random.default_rng(SEED)
    rand = [score(sorted(rng.choice(n, K, replace=False).tolist())) for _ in range(RANDOM_SETS)]
    rand_best = min(rand, key=lambda v: v[0])
    exact5 = next(e["chosen"] for e in s3a["rules"]["rise10"]["exact"] if e["k"] == K)
    greedy5 = s3a["rules"]["rise10"]["greedy"]["chosen"][:K]
    wet = tags.index("ii0.11_flat_uniform_b1_sfree")
    deep5 = np.argsort(-base_dd[tags[wet]])[:K].tolist()
    comp = {
        "sim3e": score(order[:K]),
        "sim3_exact_growth": score([idx[m] for m in exact5]),
        "sim3_greedy_growth": score([idx[m] for m in greedy5]),
        "deepest_flow": score(deep5),
        "random_best_of_20": rand_best,
        "no_sensors": score([]),
    }
    weather = {"sim3e": weather_check(order[:K]), "sim3_exact_growth": weather_check([idx[m] for m in exact5])}
    print("weather check (hold out an inside case):", {k: [v2["good"] for v2 in v.values()] for k, v in weather.items()})
    comparisons = {k: {"worst_rmse": round(v[0], 4), "mean_rmse": round(v[1], 4),
                       "worst_good": round(v[2], 4), "mean_good": round(v[3], 4)} for k, v in comp.items()}
    print("comparison at 5 sensors (worst-case RMSE d/D, worst share within 0.1):")
    for k, v in comparisons.items():
        print(f"  {k:20s} {v['worst_rmse']:.3f}  {100 * v['worst_good']:.0f}%")

    # ------------------------------------------------------------------ out-of-family test (Sim 2.5)
    oof = {}
    full = {S_name: fit(X[:, S], Y) for S_name, S in [("sim3e", order[:K]),
                                                     ("sim3_exact_growth", [idx[m] for m in exact5])]}
    for tag in tags:
        p = os.path.join(GRID25, tag, "summary.json")
        if not os.path.exists(p):
            continue
        s = json.load(open(p, encoding="utf-8"))
        b = np.array([s["baseline_depth_m"].get(str(m), 0.0) for m in mids])
        T = [b.copy()]
        for r in s["rows"]:
            d = b.copy()
            for k2, v in r["rise_mm"].items():
                if int(k2) in idx:
                    d[idx[int(k2)]] += v / 1000
            T.append(d)
        T = np.clip(np.array(T) / dia, 0, CLIP_DD)
        res = {}
        for S_name, S in [("sim3e", order[:K]), ("sim3_exact_growth", [idx[m] for m in exact5])]:
            E = predict(full[S_name], T[:, S]) - T[:, crit]
            res[S_name] = {"rmse": round(float(np.sqrt((E ** 2).mean())), 4),
                           "good": round(float((np.abs(E) <= GOOD_ERR).mean()), 4)}
        oof[tag] = {"states": len(T), **res}
    print("out-of-family (Sim 2.5 single-site runs, 480 min):",
          {t: (v["sim3e"]["rmse"], v["sim3_exact_growth"]["rmse"]) for t, v in oof.items()})

    # ------------------------------------------------------------------ timeline (whole suburb)
    steps = [0.0] + sorted(sub["ladder"])
    years = [YEAR0 + YEARS_PER_STEP * s_ for s_ in steps]

    def first_year(series, level):
        if series[0] >= level:
            return "now"
        for i in range(1, len(series)):
            if series[i] >= level:
                f = (level - series[i - 1]) / max(series[i] - series[i - 1], 1e-9)
                return round(years[i - 1] + f * (years[i] - years[i - 1]))
        return None
    timeline, dd_by_step = {}, {}
    for tag in tags:
        S_ = np.array([base_dd[tag]] + [suburb_dd[tag][s_] for s_ in steps[1:]])
        dd_by_step[tag] = np.round(np.clip(S_, 0, 3.0), 3).tolist()
        timeline[tag] = {"warn": [first_year(S_[:, i], WARN_DD) for i in range(n)],
                         "full": [first_year(S_[:, i], 1.0) for i in range(n)]}

    # ------------------------------------------------------------------ floats: early warning
    def sortyear(y):
        return 9999 if y is None else (0 if y == "now" else y)
    wet_tl = timeline[tags[wet]]["warn"]
    floats = [i for i in crit.tolist() if i not in order and wet_tl[i] not in (None, "now")]
    floats.sort(key=lambda i: (sortyear(wet_tl[i]), sortyear(timeline[tags[tags.index("ii0.25_flat_uniform_b1_sfree")]]["warn"][i])))

    # ------------------------------------------------------------------ why cards and estimator
    def top_regions(g):
        """The areas whose critical manholes this sensor helps most: at least 20% of its gain."""
        by = {}
        for i, v in enumerate(g):
            r = region_of.get(mids[int(crit[i])])
            if r and v > 0:
                by[r] = by.get(r, 0.0) + float(v)
        tot = sum(by.values()) or 1.0
        ranked = sorted(by.items(), key=lambda kv: -kv[1])
        return [r for r, v in ranked if v / tot >= 0.2][:3] or [r for r, _ in ranked[:1]]

    why = []
    for j, m in enumerate(order):
        g = gain_by_sensor[j]
        top = np.argsort(-g)[:5]
        why.append({"manhole": mids[m], "region": region_of.get(mids[m]),
                    "dia_mm": round(float(dia[m]) * 1000),
                    "dd_today": {t: round(float(base_dd[t][m]), 2) for t in (tags[0], tags[wet], tags[3])},
                    "improves": [{"manhole": mids[int(crit[i])], "region": region_of.get(mids[int(crit[i])]),
                                  "error_drop": round(float(g[i]), 3)} for i in top if g[i] > 0.005],
                    "regions_helped": top_regions(g)})
    estimators = []
    for k in range(1, MAX_K + 1):
        mx, my, B = fit(X[:, order[:k]], Y)
        estimators.append({"mx": np.round(mx, 4).tolist(), "my": np.round(my, 4).tolist(),
                           "B": np.round(B, 4).tolist()})

    out = {
        "version": "Sim 3-e",
        "settings": {"crit_dd": CRIT_DD, "warn_dd": WARN_DD, "clip_dd": CLIP_DD, "good_err": GOOD_ERR,
                     "ridge": RIDGE, "year0": YEAR0, "years_per_step": YEARS_PER_STEP,
                     "random_sets": RANDOM_SETS, "seed": SEED, "prices": PRICES},
        "cases": tags, "case_labels": [c for c in tags],
        "manholes": mids, "dia_mm": [round(float(d) * 1000) for d in dia],
        "region_of": [region_of.get(m) for m in mids],
        "regions": [{"id": r["id"], "name": r["name"]} for r in regions],
        "states": len(X), "critical": crit.tolist(),
        "order": order, "curve": curve, "comparisons": comparisons, "out_of_family": oof, "weather_check": weather,
        "steps": steps, "years": years, "dd": dd_by_step, "timeline": timeline,
        "floats": floats, "why": why, "estimators": estimators,
        "sim3_exact5": exact5,
        "check": sub["check"],
    }
    with open(OUT_JSON, "w", encoding="utf-8", newline="\n") as f:
        json.dump({k: v for k, v in out.items() if k not in ("dd", "estimators")}, f, indent=1)
    os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)
    with open(OUT_JS, "w", encoding="utf-8", newline="\n") as f:
        f.write("// Generated by simulation_src/sim3e/sim3e_build.py - do not edit by hand.\n")
        f.write("window.SIM3E = " + json.dumps(out, separators=(",", ":")) + ";\n")
    print("wrote", os.path.relpath(OUT_JSON, SRC), "and", os.path.relpath(OUT_JS, ROOT))
    soon = [(mids[i], wet_tl[i]) for i in floats[:8]]
    print("float early-warning order (Design wet, year reaching 0.7 d/D):", soon)


if __name__ == "__main__":
    main()
