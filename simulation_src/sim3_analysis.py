#!/usr/bin/env python3
"""
sim3_analysis.py - read the Sim 3 region runs and answer the placement questions.

Reads results/sim3/regions/<case>/summary.json for every case that has run and writes
results/sim3/regions/analysis.json and report.md. No SWMM is run here.

A growth SCENARIO is one region at one build-out step in one case. A candidate manhole
SEES it under a rule when its depth rises by at least R mm over its own baseline (R = 10,
25, 50), or newly passes the 150 mm alarm, or newly surcharges. From that:

  first detection   for each region and candidate, the smallest build-out fraction at which
                    the candidate sees the region: "how early". Reported worst over cases.
  coverage          the share of a case's detectable scenarios a sensor set sees; a set is
                    judged on its worst case over the uncertainty cases, average tie-break.
  placement         greedy (Sim 2.5's method) and the exact optimum (mixed-integer program,
                    PuLP + HiGHS, the review teammate's prove_placement), for 1 to K sensors;
                    leave-one-case-out tells how much of the exact set's score is in-sample.
  choke points      use case E: candidates ranked by baseline headroom to the alarm across
                    cases, with the regions each one sees.
  time rule         days of same-hour level readings needed to separate the rise a region's
                    full build-out makes from day-to-day noise sigma (swept, assumed).
  pumps             what each pump station pumps with and without a region's growth: the
                    SCADA indicator.
  wet weather only  each case's baseline against Dry: manholes newly alarmed, surcharged or
                    spilling with no growth at all.

Usage:
    python sim3_analysis.py                 # all cases present
    python sim3_analysis.py --max-sensors 10 --sigma 10,20,40
"""
import argparse, glob, json, math, os, time

import numpy as np

import sim25
import sim25_grid
import sim3_regions
from sim25 import Sim25Model, Case

OUT = sim3_regions.OUT
RULES = ["rise10", "rise25", "rise50", "alarm", "surcharge"]
RISE_OF = {"rise10": 10.0, "rise25": 25.0, "rise50": 50.0}


# ---------------------------------------------------------------------- load
def load_cases():
    """{tag: summary} for every case run, in config.js order; warns about missing ones."""
    want = [c.tag() for c in sim25_grid.cases("all")]
    have = {}
    for tag in want:
        p = os.path.join(OUT, tag, "summary.json")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                have[tag] = json.load(f)
    missing = [t for t in want if t not in have]
    if missing:
        print("cases not run yet, left out:", missing)
    return have


def sees(row, cand, rule):
    if rule in RISE_OF:
        return row["rise_mm"].get(cand, 0.0) >= RISE_OF[rule]
    return int(cand) in row[rule]


def matrices(cases, rule):
    """Per case: (scenario keys, 0/1 matrix scenarios x candidates), scenarios NOTHING sees
    dropped, as Sim 2.5 did (they cannot count against any placement)."""
    out = {}
    for tag, s in cases.items():
        cands = [str(c) for c in s["candidates"]]
        keys, A = [], []
        for r in s["rows"]:
            v = [1 if sees(r, c, rule) else 0 for c in cands]
            if any(v):
                keys.append((r["region"], r["step"]))
                A.append(v)
        out[tag] = {"keys": keys, "A": np.array(A, dtype=np.int8).reshape(len(keys), len(cands)),
                    "cands": cands, "n_all": len(s["rows"]), "w": np.ones(len(keys))}
    return out


# ---------------------------------------------------------------------- risk weights (Kimbrough)
# The risk teammate's note (22 Oct 2026, "Applying Kimbrough (2019) to the growth scenario")
# proposes weighting every growth scenario by R = S x O, after Kimbrough's FMEA-style risk
# priority number: O (occurrence, 1 to 10) is how far the scenario pushes its most affected
# manhole towards or past 0.7 d/D, the surcharge-risk threshold his US level data supports;
# S (severity, 1 to 10) is a stand-in for what an overflow there would harm, homes upstream
# for now. Weighted coverage is the share of total risk a sensor set notices rather than the
# share of scenarios. An EXPERT-VIEW option beside plain coverage (decision 22 Oct 2026), not
# the headline: it pulls sensors towards trunk mains already near capacity, which the model
# treats as evidence about the baseline, not about growth. [CITE: Kimbrough 2019, Colorado
# State University dissertation, pp. 11, 66, 83-87, 250-256; read from the teammate's note,
# not the dissertation itself.]
DD_RISK = 0.70          # d/D at which Kimbrough's occurrence score saturates
DD_FLOOR = 0.35         # below this depth ratio a scenario scores the minimum occurrence
PUSH_FULL = 0.10        # a rise of a tenth of the pipe's bore counts as a full push


def candidate_geometry():
    """Per candidate (manhole id as str): outgoing bore (m), its invert offset above the
    chamber floor (m), and the homes whose sewage passes it, from the same model the grid ran."""
    m = Sim25Model(Case(), whole=True)
    net = m.net
    out = {}
    for c in m.candidates:
        n = m.nodes[c]
        outs = [lk for lk in m.links if lk.up == c]
        first = min(outs, key=lambda lk: lk.inv_up) if outs else None
        nid = m.chambers[c]
        pipes = set(net.upstream_pipes(nid)) | set(net.nodes[nid].outs)
        out[str(n.manhole_id)] = {"dia": first.dia if first else None,
                                  "offset": max(0.0, first.inv_up - n.invert) if first else 0.0,
                                  "homes": sum(net.pipes[i].dwellings for i in pipes)}
    return out


def risk_weights(cases, geom):
    """{tag: {(region, step): {w, O, S, at, dd_before, dd_after}}} for every scenario."""
    cands = sorted(geom)
    homes = np.array([geom[c]["homes"] for c in cands], dtype=float)
    rank = homes.argsort().argsort() / max(1, len(cands) - 1)       # 0 .. 1 by homes upstream
    sev = {c: 1 + int(round(9 * rank[i])) for i, c in enumerate(cands)}
    out = {}
    for tag, s in cases.items():
        base = s.get("baseline_depth_m", {})
        rows = {}
        for r in s["rows"]:
            best, at, dd0, dd1 = 0.0, None, None, None
            for c, rise in r["rise_mm"].items():
                g = geom.get(c)
                if not g or not g["dia"] or c not in base:
                    continue
                d0 = max(0.0, base[c] - g["offset"]) / g["dia"]
                d1 = max(0.0, base[c] + rise / 1000.0 - g["offset"]) / g["dia"]
                if d1 <= d0:
                    continue
                prox = min(1.0, max(0.0, (d1 - DD_FLOOR) / (DD_RISK - DD_FLOOR)))
                push = min(1.0, (d1 - d0) / PUSH_FULL)
                sc = prox * push
                if sc > best:
                    best, at, dd0, dd1 = sc, c, d0, d1
            O = 1 + int(round(9 * best))
            S = sev[at] if at else 1
            rows[(r["region"], r["step"])] = {"w": O * S, "O": O, "S": S, "at": int(at) if at else None,
                                              "dd_before": round(dd0, 3) if dd0 is not None else None,
                                              "dd_after": round(dd1, 3) if dd1 is not None else None}
        out[tag] = rows
    return out


def weighted(mats, risk):
    """A copy of the matrices with each kept scenario's risk weight in place of 1."""
    out = {}
    for tag, m in mats.items():
        w = np.array([risk.get(tag, {}).get(k, {}).get("w", 1.0) for k in m["keys"]], dtype=float)
        out[tag] = dict(m, w=w if w.sum() > 0 else np.ones(len(m["keys"])))
    return out


def coverage(mats, chosen_idx):
    """Share of detectable scenarios seen, per case, by the candidate indices chosen."""
    cov = {}
    for tag, m in mats.items():
        if len(m["keys"]) == 0:
            continue
        seen = m["A"][:, chosen_idx].max(axis=1) if chosen_idx else np.zeros(len(m["keys"]), dtype=np.int8)
        w = m.get("w")
        cov[tag] = float((seen * w).sum() / w.sum()) if w is not None else float(seen.mean())
    return cov


def worst_avg(cov):
    if not cov:
        return 0.0, 0.0
    v = list(cov.values())
    return min(v), sum(v) / len(v)


# ---------------------------------------------------------------------- placement
def greedy(mats, n_cand, K):
    """Sim 2.5's method: add the candidate that most raises the worst-case coverage, average
    as the tie-break, never revisiting. Returns the ordered list of indices and the curve."""
    chosen, curve = [], []
    for _ in range(K):
        best = None
        for j in range(n_cand):
            if j in chosen:
                continue
            w, a = worst_avg(coverage(mats, chosen + [j]))
            if best is None or (w, a) > best[0]:
                best = ((w, a), j)
        if best is None:
            break
        chosen.append(best[1])
        curve.append({"k": len(chosen), "worst": round(best[0][0], 4), "average": round(best[0][1], 4)})
    return chosen, curve


def exact(mats, n_cand, k, time_limit=60):
    """The proven best k-set for max-min coverage over the cases (a max-min maximal covering
    location problem), with a tiny average bonus too small to trade a worst-case scenario
    away. Returns (indices, worst, average, status)."""
    import pulp
    prob = pulp.LpProblem("placement", pulp.LpMaximize)
    x = [pulp.LpVariable(f"x{j}", cat="Binary") for j in range(n_cand)]
    t = pulp.LpVariable("t", lowBound=0, upBound=1)
    avg_terms = []
    tags = [tag for tag, m in mats.items() if len(m["keys"])]
    for tag in tags:
        m = mats[tag]
        n = len(m["keys"])
        w = m.get("w")
        w = [float(v) for v in w] if w is not None else [1.0] * n
        W = sum(w)
        ys = []
        for i in range(n):
            y = pulp.LpVariable(f"y_{tags.index(tag)}_{i}", lowBound=0, upBound=1)
            cover_j = [x[j] for j in np.nonzero(m["A"][i])[0]]
            prob += y <= pulp.lpSum(cover_j)
            ys.append(y)
        prob += t <= pulp.lpSum(w[i] * ys[i] for i in range(n)) / W
        avg_terms.append(pulp.lpSum(w[i] * ys[i] for i in range(n)) / W)
    eps = 1e-3 / max(1, len(tags))
    prob += t + eps * pulp.lpSum(avg_terms)
    prob += pulp.lpSum(x) == k
    solver = pulp.HiGHS(msg=False, timeLimit=time_limit) if "HiGHS" in pulp.listSolvers(onlyAvailable=True) \
        else pulp.PULP_CBC_CMD(msg=False, timeLimit=time_limit)
    status = prob.solve(solver)
    chosen = [j for j in range(n_cand) if (x[j].value() or 0) > 0.5]
    w, a = worst_avg(coverage(mats, chosen))
    return chosen, w, a, pulp.LpStatus[status]


def leave_one_out(mats, n_cand, k):
    """Choose the exact k-set on every case but one, score it on the held-out case."""
    out = {}
    for held in list(mats):
        rest = {t: m for t, m in mats.items() if t != held and len(m["keys"])}
        if not rest or len(mats[held]["keys"]) == 0:
            continue
        chosen, _, _, _ = exact(rest, n_cand, k, time_limit=30)
        out[held] = {"chosen": chosen, "score_on_held_out": round(coverage({held: mats[held]}, chosen)[held], 4)}
    return out


# ---------------------------------------------------------------------- the other questions
def first_detection(cases, rule):
    """{region: {candidate: worst-over-cases smallest build-out fraction seen, or None}}."""
    out = {}
    regions = [r["id"] for r in next(iter(cases.values()))["regions"]]
    for rid in regions:
        per_cand = {}
        for tag, s in cases.items():
            cands = [str(c) for c in s["candidates"]]
            rows = sorted((r for r in s["rows"] if r["region"] == rid), key=lambda r: r["step"])
            for c in cands:
                f = next((r["step"] for r in rows if sees(r, c, rule)), None)
                per_cand.setdefault(c, []).append(f)
        # worst over cases: if any case never sees it, None; else the largest fraction
        out[rid] = {c: (None if any(v is None for v in vs) else max(vs)) for c, vs in per_cand.items()}
    return out


def first_detection_by_case(cases, rule):
    """{region: {case: (best candidate, first build-out fraction seen) or None}}: the earliest
    step at which ANY candidate sees the region, per case. The worst-over-cases view above is
    dominated by Dry, where infill raises levels by millimetres; this is the per-case view."""
    out = {}
    regions = [r["id"] for r in next(iter(cases.values()))["regions"]]
    for rid in regions:
        per = {}
        for tag, s in cases.items():
            cands = [str(c) for c in s["candidates"]]
            rows = sorted((r for r in s["rows"] if r["region"] == rid), key=lambda r: r["step"])
            best = None
            for r in rows:
                seen = [c for c in cands if sees(r, c, rule)]
                if seen:
                    # the candidate with the largest rise at that step, as the representative
                    rep = max(seen, key=lambda c: (r.get("rise_mm") or {}).get(c, 0.0))
                    best = (int(rep), r["step"], len(seen))
                    break
            per[tag] = best
        out[rid] = per
    return out


def choke_points(cases, first, top=15):
    """Use case E: candidates by baseline headroom to the alarm (mm), worst over cases, with
    the regions each sees at any step (rise25 first-detection)."""
    alarm_mm = sim25.DETECT_DEPTH_M * 1000
    rows = {}
    for tag, s in cases.items():
        for mh, d in s["baseline_depth_m"].items():
            rows.setdefault(mh, []).append(alarm_mm - d * 1000)
    out = []
    for mh, heads in rows.items():
        sees_regions = {rid: f for rid, fd in first.items() if (f := fd.get(mh)) is not None}
        out.append({"manhole": int(mh), "headroom_mm_min": round(min(heads), 1),
                    "headroom_mm_mean": round(sum(heads) / len(heads), 1),
                    "already_in_alarm_cases": sum(1 for h in heads if h <= 0),
                    "regions_seen": sees_regions, "n_regions_seen": len(sees_regions)})
    out.sort(key=lambda r: (abs(r["headroom_mm_min"]), -r["n_regions_seen"]))
    return out[:top]


def time_rule(cases, sigmas, step=1.0, cap_days=1825):
    """Days of same-hour readings to separate each region's full-build-out rise at its best
    candidate from day-to-day noise sigma: N = (2 sigma / r)^2. Per case; sigma is assumed."""
    out = {}
    for tag, s in cases.items():
        per = {}
        for r in s["rows"]:
            if r["step"] != step:
                continue
            if not r["rise_mm"]:
                per[r["region"]] = {"best_candidate": None, "rise_mm": 0.0,
                                    "days": {str(sg): None for sg in sigmas}}
                continue
            mh, rise = max(r["rise_mm"].items(), key=lambda kv: kv[1])
            per[r["region"]] = {"best_candidate": int(mh), "rise_mm": rise,
                                "days": {str(sg): (min(cap_days, math.ceil((2 * sg / rise) ** 2)) if rise > 0 else None)
                                         for sg in sigmas}}
        out[tag] = per
    return out


def pump_indicator(cases, step=1.0):
    out = {}
    for tag, s in cases.items():
        base = s["baseline"].get("pumps") or {}
        per = {}
        for r in s["rows"]:
            if r["step"] != step or not r.get("pumps"):
                continue
            per[r["region"]] = {p: {"baseline_lps": base.get(p), "with_growth_lps": q,
                                    "change_pct": (round(100 * (q - base[p]) / base[p], 1) if base.get(p) else None)}
                                for p, q in r["pumps"].items()}
        out[tag] = per
    return out


def wet_weather_only(cases):
    dry = next((s for s in cases.values() if s["case"]["ii"] == 0.0), None)
    out = {}
    for tag, s in cases.items():
        b = s["baseline"]
        rec = {k: len(b[k]) for k in ("alarm", "surcharged", "spilled")}
        if dry is not None:
            rec["newly_vs_dry"] = {k: sorted(set(b[k]) - set(dry["baseline"][k])) for k in ("alarm", "surcharged", "spilled")}
        out[tag] = rec
    return out


# ---------------------------------------------------------------------- report
def pct(x):
    return f"{100 * x:.0f}%"


def write_report(an, path):
    L = ["# Sim 3 region runs: analysis", "",
         f"Generated {time.strftime('%Y-%m-%d %H:%M')} from {len(an['cases'])} cases: {', '.join(an['cases'])}.",
         "Every figure is a model output under the register's assumptions. ✏️ DRAFT", ""]
    L += ["## Regions", "", "| id | manholes | dwellings now | 100% growth (dwellings) | name |", "|---|---|---|---|---|"]
    for r in an["regions"]:
        L.append(f"| {r['id']} | {r['n_manholes']} | {r['dwellings']} | {r['nominal_dwellings']:g} | {r['name']} |")
    L += ["", f"Ladder: {an['ladder']}. Runs settled in {an['run_length']['min_minutes']} to "
          f"{an['run_length']['max_minutes']} minutes; {an['run_length']['unconverged']} unconverged.", ""]
    L += ["## Wet weather only (no growth): baseline against Dry", "", "| case | in alarm | surcharged | spilling | newly in alarm vs Dry |", "|---|---|---|---|---|"]
    for tag, w in an["wet_weather_only"].items():
        n = w.get("newly_vs_dry", {}).get("alarm", [])
        L.append(f"| {tag} | {w['alarm']} | {w['surcharged']} | {w['spilled']} | {len(n)} |")
    if an.get("risk"):
        L += ["", "## Risk-weighted coverage (Kimbrough, expert option)", "",
              "Each scenario weighted by S x O (" + an["risk"]["definition"]["w"] + "). O: " + an["risk"]["definition"]["O"] +
              ". S: " + an["risk"]["definition"]["S"] + ". A comparison, not the recommendation: the plain set and the risk set at "
              "each size, each scored on plain coverage and on risk-weighted coverage (worst case over the cases).", ""]
        for rule in RULES:
            Rk = an["rules"].get(rule, {}).get("risk")
            if not Rk:
                continue
            L += [f"### {rule}", "", "| k | plain set: plain / risk | risk set: plain / risk | shared | risk set |", "|---|---|---|---|---|"]
            for c, e in zip(Rk["compare"], Rk["exact"]):
                ps = c["plain_set"]
                L.append(f"| {c['k']} | " + (f"{pct(ps['plain'])} / {pct(ps['risk'])}" if ps else "n/a") +
                         f" | {pct(c['risk_set']['plain'])} / {pct(c['risk_set']['risk'])} | {c['shared']} | "
                         + ", ".join(f"MH{m}" for m in e["chosen"]) + " |")
            L.append("")
    for rule in RULES:
        R = an["rules"][rule]
        L += ["", f"## Rule: {rule}", "",
              "Detectable scenarios per case (seen by at least one manhole): "
              + ", ".join(f"{t}: {v['detectable']}/{v['all']}" for t, v in R["detectable"].items()), ""]
        L += ["### How early each region is seen (worst over cases): best five manholes", ""]
        for rid, fd in R["first_detection_top"].items():
            L.append(f"- **{rid}**: " + (", ".join(f"MH{c} at {f:g}" for c, f in fd) if fd else "never seen at any step"))
        tags = an["cases"]
        L += ["", "### First build-out fraction at which any manhole sees the region, per case", "",
              "Cell: fraction of the region's 100% growth at which the first candidate crosses the rule, "
              "and the manhole with the largest rise at that step (count of manholes that see it). "
              "A dot means not seen even at 300%.", "",
              "| region | " + " | ".join(t.replace("_flat", "").replace("_sfree", "") for t in tags) + " |",
              "|---|" + "---|" * len(tags)]
        for rid, per in R["first_detection_by_case"].items():
            cells = []
            for t in tags:
                v = per.get(t)
                cells.append("." if v is None else f"{v[1]:g} MH{v[0]} ({v[2]})")
            L.append(f"| {rid} | " + " | ".join(cells) + " |")
        L += ["", "### Placement: coverage of detectable growth, worst case over the uncertainty cases", "",
              "| sensors | greedy worst | greedy avg | exact worst | exact avg | exact set |", "|---|---|---|---|---|---|"]
        for g, e in zip(R["greedy"]["curve"], R["exact"]):
            L.append(f"| {g['k']} | {pct(g['worst'])} | {pct(g['average'])} | {pct(e['worst'])} | {pct(e['average'])} | "
                     + ", ".join(f"MH{c}" for c in e["chosen"]) + " |")
        if R.get("leave_one_out"):
            L += ["", "Leave-one-case-out at the recommended size: the exact set chosen without a case, scored on it: "
                  + ", ".join(f"{t} {pct(v['score_on_held_out'])}" for t, v in R["leave_one_out"].items())]
    L += ["", "## Choke points (use case E): least headroom to the 150 mm alarm, worst case", "",
          "| manhole | headroom min (mm) | mean | already in alarm (cases) | regions seen (first detection, 25 mm) |", "|---|---|---|---|---|"]
    for c in an["choke_points"]:
        L.append(f"| MH{c['manhole']} | {c['headroom_mm_min']} | {c['headroom_mm_mean']} | {c['already_in_alarm_cases']} | "
                 + ", ".join(f"{r} at {f:g}" for r, f in c["regions_seen"].items()) + " |")
    L += ["", "## Time rule: days of same-hour readings to see each region's full (100%) build-out", "",
          "sigma is the assumed day-to-day spread of the level at the same hour; N = (2 sigma / rise)^2, capped at 5 years.", ""]
    for tag, per in an["time_rule"].items():
        L.append(f"- **{tag}**: " + "; ".join(
            f"{rid} {v['rise_mm']:.0f} mm at MH{v['best_candidate']}, days " + "/".join(
                f"{v['days'][s] if v['days'][s] is not None else 'never'}" for s in v["days"])
            for rid, v in per.items() if v["best_candidate"]))
    L += ["", "## Pump stations: what SCADA would show at 100% build-out", "",
          "Only regions that drain through a pump station move its flow. In this network the two pump "
          "stations serve part of R7 only; in the 0.25 and 0.40 cases P4433449 also receives trunk overflow "
          "through the relief route, so fractions of a percent there are the other regions' overflow, not "
          "their sewage. A pump change below about 1% is inside SCADA flow-meter noise.", ""]
    for tag, per in an["pump_indicator"].items():
        L.append(f"- **{tag}**: " + "; ".join(
            f"{rid}: " + ", ".join(f"{p} {q['change_pct']:+.1f}%" for p, q in st.items() if q["change_pct"] is not None)
            for rid, st in per.items() if any(q["change_pct"] for q in st.values())))
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(L) + "\n")


def add_risk(an, cases, args):
    """The risk-weighted option for the rules named: weights, greedy and exact sets, and the
    comparison of each plain set with the risk set at every size, scored both ways."""
    t0 = time.time()
    geom = candidate_geometry()
    risk = risk_weights(cases, geom)
    cands = [str(c) for c in next(iter(cases.values()))["candidates"]]
    an["risk"] = {"definition": {"O": "1 + 9 x max over manholes of proximity x push, proximity = clamp((d/D after - "
                                      f"{DD_FLOOR}) / ({DD_RISK} - {DD_FLOOR})), push = clamp(rise / ({PUSH_FULL} x bore))",
                                 "S": "1 to 10 by decile of homes draining through the manhole where O is scored",
                                 "w": "S x O per scenario; weighted coverage = sum of w over scenarios seen / sum of w"},
                  "weights": {tag: [{"region": k[0], "step": k[1], **v} for k, v in rows.items()] for tag, rows in risk.items()},
                  "geometry": {c: geom[c] for c in geom}}
    for rule in [r for r in args.risk_rules.split(",") if r in an["rules"]]:
        mats = matrices(cases, rule)
        wm = weighted(mats, risk)
        g_idx, g_curve = greedy(wm, len(cands), args.max_sensors)
        R = {"greedy": {"chosen": [int(cands[j]) for j in g_idx], "curve": g_curve}, "exact": [], "compare": []}
        plain = {e["k"]: e["chosen"] for e in an["rules"][rule].get("exact", [])}
        for k in range(1, args.max_sensors + 1):
            if args.no_exact:
                idx = g_idx[:k]
                w, a = worst_avg(coverage(wm, idx)); status = "greedy"
            else:
                idx, w, a, status = exact(wm, len(cands), k)
            R["exact"].append({"k": k, "chosen": [int(cands[j]) for j in idx], "worst": round(w, 4),
                               "average": round(a, 4), "status": status})
            p_idx = [cands.index(str(m)) for m in plain.get(k, []) if str(m) in cands]
            R["compare"].append({"k": k,
                                 "plain_set": {"plain": round(worst_avg(coverage(mats, p_idx))[0], 4),
                                               "risk": round(worst_avg(coverage(wm, p_idx))[0], 4)} if p_idx else None,
                                 "risk_set": {"plain": round(worst_avg(coverage(mats, idx))[0], 4),
                                              "risk": round(w, 4)},
                                 "shared": len(set(p_idx) & set(idx))})
        an["rules"][rule]["risk"] = R
        print(f"{rule} risk-weighted: exact worst " + ", ".join(f"{e['k']}:{e['worst']:.2f}" for e in R["exact"]), flush=True)
    print(f"risk option: {time.time() - t0:.0f} s", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-sensors", type=int, default=sim25.CFG["simulation"].get("max_sensors", 10))
    ap.add_argument("--sigma", default="10,20,40", help="assumed day-to-day level noise, mm")
    ap.add_argument("--loo-k", type=int, default=4, help="sensor count for leave-one-case-out")
    ap.add_argument("--no-exact", action="store_true")
    ap.add_argument("--risk-only", action="store_true",
                    help="keep the existing analysis.json and (re)compute only the risk-weighted option")
    ap.add_argument("--risk-rules", default="rise10,rise25,alarm", help="rules given the risk-weighted option")
    args = ap.parse_args()
    cases = load_cases()
    if not cases:
        raise SystemExit("no cases run yet")
    if args.risk_only:
        with open(os.path.join(OUT, "analysis.json"), encoding="utf-8") as f:
            an = json.load(f)
        add_risk(an, cases, args)
        with open(os.path.join(OUT, "analysis.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(an, f, indent=1)
        write_report(an, os.path.join(OUT, "report.md"))
        print("risk option added to", os.path.join(OUT, "analysis.json"))
        return
    first_s = next(iter(cases.values()))
    cands = [str(c) for c in first_s["candidates"]]
    sigmas = [float(x) for x in args.sigma.split(",")]
    an = {"cases": list(cases), "regions": first_s["regions"], "ladder": first_s["ladder"],
          "candidates": [int(c) for c in cands],
          "run_length": {"min_minutes": min(s["run_length"]["growth_runs"]["min_minutes"] for s in cases.values()),
                         "max_minutes": max(s["run_length"]["growth_runs"]["max_minutes"] for s in cases.values()),
                         "unconverged": sum(s["run_length"]["growth_runs"]["unconverged"] for s in cases.values())},
          "rules": {}}
    first25 = None
    for rule in RULES:
        t0 = time.time()
        mats = matrices(cases, rule)
        fd = first_detection(cases, rule)
        if rule == "rise25":
            first25 = fd
        top = {rid: sorted(((c, f) for c, f in d.items() if f is not None), key=lambda cf: cf[1])[:5]
               for rid, d in fd.items()}
        g_idx, g_curve = greedy(mats, len(cands), args.max_sensors)
        R = {"detectable": {t: {"detectable": len(m["keys"]), "all": m["n_all"]} for t, m in mats.items()},
             "first_detection_by_case": first_detection_by_case(cases, rule),
             "first_detection": {rid: {c: f for c, f in d.items() if f is not None} for rid, d in fd.items()},
             "first_detection_top": {rid: [(int(c), f) for c, f in v] for rid, v in top.items()},
             "greedy": {"chosen": [int(cands[j]) for j in g_idx], "curve": g_curve}, "exact": []}
        if not args.no_exact:
            for k in range(1, args.max_sensors + 1):
                idx, w, a, status = exact(mats, len(cands), k)
                R["exact"].append({"k": k, "chosen": [int(cands[j]) for j in idx], "worst": round(w, 4),
                                   "average": round(a, 4), "status": status})
            R["leave_one_out"] = {t: {"chosen": [int(cands[j]) for j in v["chosen"]], "score_on_held_out": v["score_on_held_out"]}
                                  for t, v in leave_one_out(mats, len(cands), args.loo_k).items()}
        an["rules"][rule] = R
        print(f"{rule}: {time.time() - t0:.0f} s; greedy worst at {args.max_sensors}: "
              f"{g_curve[-1]['worst'] if g_curve else 0:.2f}; exact: "
              + ", ".join(f"{e['k']}:{e['worst']:.2f}" for e in R["exact"]), flush=True)
    add_risk(an, cases, args)
    an["choke_points"] = choke_points(cases, first25 or {})
    an["time_rule"] = time_rule(cases, sigmas)
    an["pump_indicator"] = pump_indicator(cases)
    an["wet_weather_only"] = wet_weather_only(cases)
    with open(os.path.join(OUT, "analysis.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(an, f, indent=1)
    write_report(an, os.path.join(OUT, "report.md"))
    print("wrote", os.path.join(OUT, "analysis.json"), "and report.md")


if __name__ == "__main__":
    main()
