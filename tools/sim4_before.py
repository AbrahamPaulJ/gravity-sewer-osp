#!/usr/bin/env python3
"""Simulation 4: re-score Sim 3's published infill runs on warning BEFORE surcharge.

Sim 3 scores a sensor set by the share of runs in which one of its sensors passes a rule. That
credits a sensor for runs where a manhole has already surcharged, and counts build-outs that
never overload anything. This tool asks the narrower question the operator cares about:

    along each area's build-out, does a chosen sensor respond at a smaller build-out than the
    one at which the first manhole newly surcharges, and does the pattern of sensors that
    respond say where?

It reads only Sim 3's published files (simulation3/data/regions.js, catchment.js, growth.js)
and config.js, runs no SWMM, and writes simulation4/data/before.js. The method, definitions
and every choice are in docs/sim3_before_surcharge.md.

Exact placements are solved with SciPy's HiGHS interface (scipy.optimize.milp), so this needs
the project's venv:

    ~/.venvs/sewer/bin/python tools/sim4_before.py            # build and print the headline
    ~/.venvs/sewer/bin/python tools/sim4_before.py --check    # rebuild, compare with the published file
    ~/.venvs/sewer/bin/python tools/sim4_before.py --publish  # write simulation4/data/before.js
"""
import argparse
import hashlib
import heapq
import json
import os
import sys
from collections import defaultdict

import numpy as np
import scipy
from scipy.optimize import LinearConstraint, Bounds, milp
from scipy.sparse import lil_matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SIM3 = os.path.join(ROOT, "simulation3", "data")
OUT = os.path.join(ROOT, "simulation4", "data", "before.js")
sys.path.insert(0, os.path.join(ROOT, "simulation_src"))
import osp_config  # noqa: E402

EPS = 1e-3          # weight of the average in the objective: breaks ties in the worst case
RISE_RULES = {"r10": 10, "r25": 25, "r50": 50}


# ── reading ─────────────────────────────────────────────────────────────────────────────

def read_js(path):
    """The JSON object a generated `window.X = {...};` file sets."""
    with open(path, encoding="utf-8") as f:
        s = f.read()
    return json.loads(s[s.index("{"):s.rstrip().rstrip(";").rindex("}") + 1]), s


def chamber_names(growth_text):
    """growth.js is 3 MB; only its list of chamber names is needed, in manhole-index order."""
    at = growth_text.index('"chambers":')
    return json.loads(growth_text[growth_text.index("[", at):growth_text.index("]", at) + 1])


def settings(cfg):
    """simulation.before_surcharge, checked. A bad value stops the build with the reason."""
    b = cfg["simulation"].get("before_surcharge")
    if b is None:
        raise ValueError("config.js has no simulation.before_surcharge")
    m, radii, r0 = b["margin_steps"], b["radii_m"], b["default_radius_m"]
    full, w = b["fullness"], b["weights"]
    if m not in (1, 2, 3):
        raise ValueError(f"before_surcharge.margin_steps must be 1, 2 or 3, not {m!r}")
    if not radii or any(not isinstance(r, (int, float)) or r < 0 for r in radii):
        raise ValueError(f"before_surcharge.radii_m must be distances of 0 m or more, not {radii!r}")
    if r0 not in radii:
        raise ValueError(f"before_surcharge.default_radius_m ({r0!r}) must be one of radii_m")
    if not full or any(not (0 < f < 1) for f in full):
        raise ValueError(f"before_surcharge.fullness must be fractions between 0 and 1, not {full!r}")
    if w not in ("equal", "homes"):
        raise ValueError(f"before_surcharge.weights must be \"equal\" or \"homes\", not {w!r}")
    return {"margin_steps": m, "radii_m": list(radii), "default_radius_m": r0,
            "fullness": list(full), "weights": w,
            "max_sensors": int(cfg["simulation"]["max_sensors"])}


def monitoring_settings(cfg, ladder):
    """simulation.monitoring, checked: float trip distances, the near-spill build-out and the
    catalogue of readings and sensors."""
    mo = cfg["simulation"].get("monitoring")
    if mo is None:
        raise ValueError("config.js has no simulation.monitoring")
    fb, cap = mo["float_freeboard_mm"], mo["near_spill_max_buildout"]
    if not fb or any(not isinstance(x, (int, float)) or x <= 0 for x in fb):
        raise ValueError(f"monitoring.float_freeboard_mm must be distances above 0 mm, not {fb!r}")
    if cap not in ladder:
        raise ValueError(f"monitoring.near_spill_max_buildout must be one of the build-out steps {ladder}, not {cap!r}")
    cat = {part: {k: osp_config.plain(v) for k, v in osp_config.plain(mo["catalogue"][part]).items()}
           for part in ("readings", "sensors")}
    for rid, r in cat["readings"].items():
        missing = [x for x in r["sensors"] if x not in cat["sensors"]]
        if missing:
            raise ValueError(f"monitoring.catalogue.readings.{rid} names sensors not in the catalogue: {missing}")
    cl = mo["noncontact_clearance_mm"]
    if not isinstance(cl, (int, float)) or not 100 <= cl <= 2000:
        raise ValueError(f"monitoring.noncontact_clearance_mm must be 100 to 2000 mm, not {cl!r}")
    return {"float_freeboard_mm": list(fb), "near_spill_max_buildout": cap, "noncontact_clearance_mm": cl, "catalogue": cat}


# ── geometry ────────────────────────────────────────────────────────────────────────────

def manhole_geometry(geo, chambers):
    """Per manhole: the lowest outlet pipe's invert above the floor and its bore (mm), the crown
    (their sum) and the rim (the manhole's depth). zu and node inv are in cm on one datum."""
    ix = {n["name"]: j for j, n in enumerate(geo["nodes"])}
    outs = defaultdict(list)
    for li, u in enumerate(geo["up"]):
        outs[u].append(li)
    rows = []
    for name in chambers:
        j = ix[name]
        node = geo["nodes"][j]
        if outs[j]:
            li = min(outs[j], key=lambda l: geo["zu"][l])
            off = (geo["zu"][li] - node["inv"]) * 10
            bore = geo["dia"][li]
        else:
            off = bore = None
        rows.append({"node": j, "off": off, "bore": bore,
                     "crown": None if off is None else off + bore,
                     "rim": round(node["depth"] * 1000)})
    return rows


def pipe_distances(geo, mh):
    """Shortest distance along the pipes (either direction) between every pair of manholes, in
    metres. Pump rising mains count at their published length."""
    n = len(geo["nodes"])
    adj = defaultdict(list)
    for li, (u, d) in enumerate(zip(geo["up"], geo["down"])):
        adj[u].append((d, geo["plen"][li]))
        adj[d].append((u, geo["plen"][li]))
    for a, b in geo.get("pumpLinks", []):
        ln = next((p["len"] for p in geo["pumps"] if p.get("node") == a), 0.0)
        adj[a].append((b, ln))
        adj[b].append((a, ln))
    node_of = [m["node"] for m in mh]
    out = []
    for src in node_of:
        dist = [float("inf")] * n
        dist[src] = 0.0
        heap = [(0.0, src)]
        while heap:
            d, u = heapq.heappop(heap)
            if d > dist[u]:
                continue
            for v, w in adj[u]:
                if d + w < dist[v]:
                    dist[v] = d + w
                    heapq.heappush(heap, (dist[v], v))
        out.append([dist[j] for j in node_of])
    return out


# ── rules ───────────────────────────────────────────────────────────────────────────────

def needs(reg, mh, tag, rule, full):
    """The rise (mm) at which each manhole responds under a rule in one case, or None where it
    cannot respond: already past the level before growth, or no outlet pipe. The fullness rules
    become rise thresholds, so the page and this tool test responses the same way. The alarm
    rule is Sim 3's own alarm list ("alarm"): its baseline depths are stored to the whole
    millimetre, which moves a manhole within 0.5 mm of 150 mm across the line, so a threshold
    rebuilt from them would disagree with Sim 3 in 1 of 448 runs."""
    base = reg["base"][tag]["depthMm"]
    if rule in RISE_RULES:
        return RISE_RULES[rule]
    if rule == "alarm":
        return "alarm"
    res = []
    for i, m in enumerate(mh):
        b = base.get(str(i), 0)
        if m["off"] is None:
            res.append(None)
            continue
        level = m["off"] + full[rule] * m["bore"]
        res.append(None if b >= level else round(level - b, 1))
    return res


def responders(row, need):
    """The manholes that respond in one published run, given a rule's needs."""
    if need == "alarm":
        return set(row["alarm"])
    if isinstance(need, (int, float)):
        return {i for i, v in row["rise"] if v >= need}
    return {i for i, v in row["rise"] if need[i] is not None and v >= need[i]}


# ── the optimisation ────────────────────────────────────────────────────────────────────

def solve(n, groups, k, pairs=None):
    """Exact placement of k sensors among n manholes.

    groups: per case, a list of (weight, D) for its targets, D the manholes that warn of it.
    pairs:  for locating, per case, the (a, b) positions of targets that must be told apart; a
            target then counts only if detected and separated from every one of them.
    Maximises the worst case's weighted share, plus EPS times the average over cases. Returns
    the chosen manholes, sorted."""
    tg = [(c, w, D) for c, g in enumerate(groups) for w, D in g]
    start = np.cumsum([0] + [len(g) for g in groups])
    loc = pairs is not None
    pr = [(start[c] + a, start[c] + b, groups[c][a][1] ^ groups[c][b][1])
          for c, pl in enumerate(pairs) for a, b in pl] if loc else []
    nT, nC = len(tg), len(groups)
    # variables: x (sensors) | y (detected) | l (located) | v (pair told apart) | z (worst case)
    Y, L = n, n + nT
    V = L + (nT if loc else 0)
    Z = V + len(pr)
    sc = L if loc else Y                      # the variable that is scored
    tot = [sum(w for w, _ in g) for g in groups]
    c_obj = np.zeros(Z + 1)
    c_obj[Z] = -1.0
    for t, (c, w, D) in enumerate(tg):
        c_obj[sc + t] -= EPS * w / tot[c] / nC
    rows, lo, hi = [], [], []

    def add(coef, a, b):
        rows.append(coef); lo.append(a); hi.append(b)

    add({i: 1 for i in range(n)}, k, k)
    for t, (c, w, D) in enumerate(tg):        # detected only if a chosen sensor warns of it
        add({Y + t: 1, **{i: -1 for i in D}}, -np.inf, 0)
    for c in range(nC):                       # every case's weighted share is at least z
        add({**{sc + t: w / tot[c] for t, (cc, w, D) in enumerate(tg) if cc == c}, Z: -1}, 0, np.inf)
    if loc:
        for t in range(nT):                   # located only if detected
            add({L + t: 1, Y + t: -1}, -np.inf, 0)
        for q, (a, b, sym) in enumerate(pr):  # told apart only if a chosen sensor sees one and not the other
            add({V + q: 1, **{i: -1 for i in sym}}, -np.inf, 0)
            add({L + a: 1, V + q: -1}, -np.inf, 0)
            add({L + b: 1, V + q: -1}, -np.inf, 0)
    A = lil_matrix((len(rows), Z + 1))
    for r, coef in enumerate(rows):
        for j, v in coef.items():
            A[r, j] = v
    integ = np.zeros(Z + 1)
    integ[:n] = 1
    res = milp(c_obj, constraints=[LinearConstraint(A.tocsr(), lo, hi)], integrality=integ,
               bounds=Bounds(0, 1), options={"disp": False, "mip_rel_gap": 0})
    if not res.success:
        raise RuntimeError(f"HiGHS did not solve (k={k}): {res.message}")
    return sorted(int(i) for i in np.flatnonzero(res.x[:n] > 0.5))


def evaluate(S, groups, pairs=None):
    """Worst and average weighted share for a sensor set, and the per-case shares."""
    S = set(S)
    per = []
    for c, g in enumerate(groups):
        det = [bool(D & S) for w, D in g]
        ok = list(det)
        if pairs is not None:
            for a, b in pairs[c]:
                if not ((g[a][1] ^ g[b][1]) & S):
                    ok[a] = ok[b] = False
        tot = sum(w for w, _ in g)
        per.append(sum(w for (w, _), o in zip(g, ok) if o) / tot)
    return min(per), sum(per) / len(per), per


def greedy(n, groups, kmax):
    chosen, curve = [], []
    for k in range(1, kmax + 1):
        best = None
        for i in range(n):
            if i in chosen:
                continue
            w, a, _ = evaluate(chosen + [i], groups)
            key = (round(w, 9), round(a, 9), -i)
            if best is None or key > best[0]:
                best = (key, i)
        chosen.append(best[1])
        w, a, _ = evaluate(chosen, groups)
        curve.append({"k": k, "worst": round(w, 4), "average": round(a, 4)})
    return chosen, curve


# ── the build ───────────────────────────────────────────────────────────────────────────

def build():
    cfg = osp_config.load()
    st = settings(cfg)
    reg, reg_text = read_js(os.path.join(SIM3, "regions.js"))
    geo, _ = read_js(os.path.join(SIM3, "catchment.js"))
    with open(os.path.join(SIM3, "growth.js"), encoding="utf-8") as f:
        chambers = chamber_names(f.read())
    n = len(chambers)
    mh = manhole_geometry(geo, chambers)
    dist = pipe_distances(geo, mh)
    ladder = reg["ladder"]
    tags = [c["tag"] for c in reg["cases"]]
    areas = reg["regions"]
    m = st["margin_steps"]
    full = {f"f{round(f * 100)}": f for f in st["fullness"]}
    rules = list(RISE_RULES) + ["alarm"] + list(full)

    need = {r: {t: needs(reg, mh, t, r, full) for t in tags} for r in rules}

    # And "depth at or above the crown" must reproduce Sim 3's pre-growth surcharge flags.
    for t in tags:
        b = reg["base"][t]
        flag = {i for i, g in enumerate(mh) if g["crown"] is not None and b["depthMm"].get(str(i), 0) >= g["crown"]}
        if flag != set(b["surcharged"]):
            raise RuntimeError(f"crown geometry disagrees with Sim 3's surcharge flags in {t}")

    # Paths: one area's build-out under one case.
    paths = []
    for ci, t in enumerate(tags):
        for ri, a in enumerate(areas):
            rr = sorted((x for x in reg["rows"][t] if x["r"] == ri), key=lambda x: x["s"])
            s_star = next((x["s"] for x in rr if x["sur"] or x["spill"]), None)
            F = sorted(set(rr[s_star]["sur"]) | set(rr[s_star]["spill"])) if s_star is not None else []
            paths.append({"c": ci, "r": ri, "s": s_star, "F": F, "rows": rr})
    targets = [p for p in paths if p["s"] is not None]
    homes = {ri: a["dwellings"] for ri, a in enumerate(areas)}

    def weight(p, scheme):
        return 1.0 if scheme == "equal" else float(homes[p["r"]])

    def first_step(p, rule, S):
        """The first step at which a manhole of S responds along the path, or None."""
        nd = need[rule][tags[p["c"]]]
        for x in p["rows"]:
            if responders(x, nd) & S:
                return x["s"]
        return None

    def warn_set(p, rule):
        sw = p["s"] - m
        if sw < 0:
            return set()
        return responders(p["rows"][sw], need[rule][tags[p["c"]]])

    def far(p, q, r):
        return min(dist[a][b] for a in p["F"] for b in q["F"]) > r

    out_rules = {}
    for rule in rules:
        D = {id(p): warn_set(p, rule) for p in targets}
        cases_used = sorted({p["c"] for p in targets if D[id(p)]})
        # per case: warnable targets only (a target no manhole can warn of is reported, not scored)
        tlist = {c: [p for p in targets if p["c"] == c and D[id(p)]] for c in cases_used}

        def groups_for(scheme, cs=cases_used):
            return [[(weight(p, scheme), D[id(p)]) for p in tlist[c]] for c in cs]

        def pairs_for(r, cs=cases_used):
            return [[(a, b) for a in range(len(tlist[c])) for b in range(a + 1, len(tlist[c]))
                     if far(tlist[c][a], tlist[c][b], r)] for c in cs]

        res = {"warnable": sum(len(v) for v in tlist.values()),
               "unwarnable": len(targets) - sum(len(v) for v in tlist.values()),
               "cases": cases_used,
               "need": need[rule] if isinstance(need[rule][tags[0]], list) else need[rule][tags[0]]}
        if not cases_used:
            out_rules[rule] = res
            continue
        g = {s: groups_for(s) for s in ("equal", "homes")}
        res["exact"] = {}
        for s in ("equal", "homes"):
            lst = []
            for k in range(1, st["max_sensors"] + 1):
                S = solve(n, g[s], k)
                w, a, per = evaluate(S, g[s])
                lst.append({"k": k, "chosen": S, "worst": round(w, 4), "average": round(a, 4),
                            "perCase": [round(v, 4) for v in per]})
            res["exact"][s] = lst
        res["greedy"] = dict(zip(("chosen", "curve"), greedy(n, g[st["weights"]], st["max_sensors"])))
        res["locate"] = {}
        for r in st["radii_m"]:
            pr = pairs_for(r)
            lst = []
            for k in range(1, st["max_sensors"] + 1):
                S = solve(n, g[st["weights"]], k, pairs=pr)
                w, a, per = evaluate(S, g[st["weights"]], pr)
                lst.append({"k": k, "chosen": S, "worst": round(w, 4), "average": round(a, 4),
                            "perCase": [round(v, 4) for v in per]})
            res["locate"][str(r)] = {"pairs": [[[tlist[c][a]["r"], tlist[c][b]["r"]] for a, b in pl]
                                               for c, pl in zip(cases_used, pr)],
                                     "sets": lst}
        # Leave one case out: chosen on the others, scored on the held-out case.
        loo = {}
        if len(cases_used) > 1:
            for hold in cases_used:
                rest = [c for c in cases_used if c != hold]
                gr = groups_for(st["weights"], rest)
                gh = groups_for(st["weights"], [hold])
                loo[tags[hold]] = []
                for k in range(1, st["max_sensors"] + 1):
                    S = solve(n, gr, k)
                    loo[tags[hold]].append({"k": k, "chosen": S, "score": round(evaluate(S, gh)[0], 4)})
        res["loo"] = loo
        out_rules[rule] = res

    # Sim 3's own objective, re-solved here: must reach the published exact scores.
    old_check = {}
    for rule in ["r10", "r25", "r50", "alarm"]:
        nd = need[rule]
        grp = []
        for t in tags:
            det = [responders(x, nd[t]) for x in reg["rows"][t]]
            det = [d for d in det if d]
            if det:
                grp.append([(1.0, d) for d in det])
        lst = []
        for e in reg["rules"][rule]["exact"]:
            S = solve(n, grp, e["k"])
            w, a, _ = evaluate(S, grp)
            lst.append({"k": e["k"], "worst": round(w, 4), "published": e["worst"],
                        "match": abs(w - e["worst"]) < 5e-4})
        old_check[rule] = lst

    # Every published Sim 3 set, scored the new way.
    def diag(rule, S):
        S = set(S)
        nd = need[rule]
        cred = cred_sur = 0
        for t in tags:
            for x in reg["rows"][t]:
                if responders(x, nd[t]) & S:
                    cred += 1
                    cred_sur += bool(x["sur"] or x["spill"])
        cnt = {"before": 0, "same": 0, "after": 0, "never": 0}
        margins = []
        for p in targets:
            f = first_step(p, rule, S)
            if f is None:
                cnt["never"] += 1
            elif f <= p["s"] - m:
                cnt["before"] += 1
                margins.append([p["c"], p["r"], f, p["s"]])
            elif f <= p["s"]:                 # at the surcharge step, or inside the margin
                cnt["same"] += 1
            else:
                cnt["after"] += 1
        return {"credited": cred, "creditedSurcharged": cred_sur, "counts": cnt, "margins": margins}

    published = {}
    for rule in ["r10", "r25", "r50", "alarm"]:
        pr = reg["rules"][rule]
        d = {"exact": [dict(k=e["k"], chosen=e["chosen"], old=e["worst"], **diag(rule, e["chosen"]))
                       for e in pr["exact"]],
             "greedy": [dict(k=c["k"], chosen=pr["greedy"]["chosen"][:c["k"]], old=c["worst"],
                             **diag(rule, pr["greedy"]["chosen"][:c["k"]])) for c in pr["greedy"]["curve"]]}
        if "risk" in pr:
            d["risk"] = [dict(k=e["k"], chosen=e["chosen"], **diag(rule, e["chosen"])) for e in pr["risk"]["exact"]]
        published[rule] = d
    new = {}
    for rule, res in out_rules.items():
        if "exact" in res:
            new[rule] = [dict(k=e["k"], chosen=e["chosen"], **diag(rule, e["chosen"]))
                         for e in res["exact"][st["weights"]]]
    ceiling = {rule: diag(rule, range(n))["counts"] for rule in rules}

    mo = monitoring_settings(cfg, ladder)
    payload = {
        "about": "Simulation 4: Sim 3's published infill runs re-scored on warning before surcharge. Built by tools/sim4_before.py from simulation3/data; no SWMM run.",
        "provenance": {"regionsSha256": hashlib.sha256(reg_text.encode("utf-8")).hexdigest(),
                       "scipy": scipy.__version__, "solver": "HiGHS via scipy.optimize.milp",
                       "epsilon": EPS},
        "settings": st,
        "ladder": ladder,
        "cases": tags,
        "rules": rules,
        "geometry": [{"off": g["off"], "bore": g["bore"], "crown": g["crown"], "rim": g["rim"]} for g in mh],
        "paths": [{"c": p["c"], "r": p["r"], "s": p["s"], "F": p["F"],
                   "w": {"equal": 1, "homes": homes[p["r"]]}} for p in paths],
        "results": out_rules,
        "published": published,
        "newSets": new,
        "ceiling": ceiling,
        "oldObjectiveCheck": old_check,
        "register": register(st),
        "monitoring": monitoring(reg, mh, tags, ladder, mo),
    }
    return payload


def monitoring(reg, mh, tags, ladder, mo):
    """Float locations (spill, early) and the facts the sensor recommendation rests on.

    Freeboard is the lid (rim) minus the water. At each build-out step the worst over the
    eight areas is taken, since any area's growth could be the one that arrives; step index 0
    is before growth. A spill manhole spills in some published run; a near-spill one comes
    within the trip distance of the lid by near_spill_max_buildout."""
    n = len(mh)
    steps = len(ladder)
    fb = {t: [[None] * (steps + 1) for _ in range(n)] for t in tags}
    spill_at = {t: {} for t in tags}
    over_crown = set()
    for t in tags:
        base = reg["base"][t]
        for i in range(n):
            d = base["depthMm"].get(str(i), 0)
            fb[t][i][0] = mh[i]["rim"] - d
            if mh[i]["crown"] is not None and d >= mh[i]["crown"]:
                over_crown.add(i)
        for i in base["spilled"]:
            spill_at[t][i] = 0
        for x in reg["rows"][t]:
            rise = dict((i, v) for i, v in x["rise"])
            k = x["s"] + 1
            for i in range(n):
                d = base["depthMm"].get(str(i), 0) + rise.get(i, 0)
                f = mh[i]["rim"] - d
                if fb[t][i][k] is None or f < fb[t][i][k]:
                    fb[t][i][k] = f
                if mh[i]["crown"] is not None and d >= mh[i]["crown"]:
                    over_crown.add(i)
            for i in x["spill"]:
                spill_at[t][i] = min(spill_at[t].get(i, 99), k)
    spill_mh = sorted({i for t in tags for i in spill_at[t]})
    capk = ladder.index(mo["near_spill_max_buildout"]) + 1
    floats = {}
    for X in mo["float_freeboard_mm"]:
        near = sorted({i for t in tags for i in range(n) if i not in spill_mh
                       and min(v for v in fb[t][i][:capk + 1] if v is not None) < X})
        def first_trip(t, i):
            return next((k for k, v in enumerate(fb[t][i]) if v is not None and v < X), None)
        locs = []
        for i in spill_mh + near:
            locs.append({
                "i": i, "kind": "spill" if i in spill_mh else "near",
                "minFb": round(min(min(v for v in fb[t][i] if v is not None) for t in tags)),
                "trip": [first_trip(t, i) for t in tags],
                "spill": [spill_at[t].get(i) for t in tags],
                "fb": [[None if v is None else round(v) for v in fb[t][i]] for t in tags],
            })
        # spill manholes first, earliest spill first; then near-spill by least freeboard
        locs.sort(key=lambda L: (L["kind"] != "spill",
                                 min([v for v in L["spill"] if v is not None] or [99]), L["minFb"]))
        floats[str(X)] = locs
    min_fb = [round(min(min(v for v in fb[t][i] if v is not None) for t in tags)) for i in range(n)]
    return {"settings": {k: mo[k] for k in ("float_freeboard_mm", "near_spill_max_buildout", "noncontact_clearance_mm")},
            "catalogue": mo["catalogue"], "overCrown": sorted(over_crown), "minFreeboard": min_fb,
            "spillManholes": spill_mh, "floats": floats}


def register(st):
    """Assumption-register rows for the page, so every new choice is stated where it is used."""
    r = st["default_radius_m"]
    return [
        ["B01", "Path", "One area's build-out under one case: Sim 3's 7 steps, 10% to 300% of the area's share of the 2021-41 projection.", "Sim 3's infill ladder"],
        ["B02", "Target", "A path along which some manhole newly surcharges or spills. Paths that never overload are reported as growth visibility, not scored.", "Core idea: warn of overcapacity"],
        ["B03", "Warned before surcharge", f"A chosen sensor responds at least {st['margin_steps']} build-out step(s) before the first new surcharge. Rises never fall as growth is added (0 of 20,597 step pairs), so responding then means responding earlier too.", "margin_steps in config.js"],
        ["B04", "Worst case", "The headline is the worst case over the cases that have targets; Dry has none, so it is reported apart rather than scored 0.", "As Sim 3, minus cases with nothing to warn about"],
        ["B05", "Located", f"Detected, and the pattern of chosen sensors differs from every target in the same case whose first-surcharge manholes lie more than {r} m away along the pipes.", "default_radius_m in config.js; the bottleneck pipe is not recorded, so the first-surcharge manholes stand in"],
        ["B06", "Fullness rules", "f70 / f80: water newly reaches 70% / 80% of the lowest outlet pipe's bore above its invert, from Sim 3's stored depths and the published geometry. The geometry reproduces Sim 3's own surcharge flags in all 8 cases.", "fullness in config.js"],
        ["B07", "Weights", f"{st['weights']}: the published recommendation's weighting; the other (equal or by homes today) is published beside it.", "weights in config.js"],
        ["B09", "Float locations", "A float switch goes in every manhole that spills in any published run (any case, before growth or at any build-out); optionally also where the water comes within the trip distance of the lid by 100% build-out.", "simulation.monitoring in config.js; docs/sim4_monitoring_points.md"],
        ["B10", "Float trip level", "The float hangs a set distance below the lid (300 mm by default, 500 mm also published) so it trips before the water reaches the lid.", "float_freeboard_mm in config.js"],
        ["B11", "Which level sensor", "A radar (or ultrasonic) level sensor under the lid where the water stays at least the non-contact clearance (500 mm) below the lid in every case and build-out, surcharged or not; a submersible pressure sensor where it comes closer, since a non-contact sensor cannot read water at its face.", "noncontact_clearance_mm in config.js; general practice; docs/sim4_monitoring_points.md"],
        ["B08", "Coarse ladder", "Seven steps only: a path that goes from no response anywhere to surcharge in one step cannot be warned by any sensor. Finer steps need new solves.", "Limitation"],
    ]


def render(payload):
    return ("// Generated by tools/sim4_before.py - do not edit by hand.\n"
            "// Sim 3's published runs re-scored on warning before surcharge. No SWMM run.\n"
            "window.SIM4_BEFORE = " + json.dumps(payload, separators=(",", ":")) + ";\n")


def headline(p):
    st = p["settings"]
    k = 5
    lines = []
    tg = sum(1 for x in p["paths"] if x["s"] is not None)
    lines.append(f"targets (paths that newly surcharge or spill): {tg} of {len(p['paths'])}")
    for rule in p["rules"]:
        res = p["results"][rule]
        if "exact" not in res:
            lines.append(f"{rule}: no warnable target")
            continue
        e = res["exact"][st["weights"]][k - 1]
        c = p["newSets"][rule][k - 1]["counts"]
        lines.append(f"{rule}: warnable {res['warnable']}, k={k} worst {e['worst']:.3f} avg {e['average']:.3f}  "
                     f"before {c['before']} same {c['same']} after {c['after']} never {c['never']}  ceiling {p['ceiling'][rule]}")
    mon = p["monitoring"]
    lines.append(f"spill manholes: {len(mon['spillManholes'])}; float locations " +
                 ", ".join(f"{X} mm: {len(v)}" for X, v in mon["floats"].items()) +
                 f"; manholes reaching the crown: {len(mon['overCrown'])}; needing a pressure sensor (water within "
                 f"{mon['settings']['noncontact_clearance_mm']} mm of the lid): {sum(v < mon['settings']['noncontact_clearance_mm'] for v in mon['minFreeboard'])}")
    for rule in ["r10", "r25"]:
        e = p["published"][rule]["exact"][k - 1]
        lines.append(f"published exact {rule} k={k}: {e['counts']}, credited {e['credited']}, already surcharged {e['creditedSurcharged']}")
    bad = [(r, e["k"]) for r, lst in p["oldObjectiveCheck"].items() for e in lst if not e["match"]]
    lines.append("old-objective check: " + ("all published exact scores reached" if not bad else f"MISMATCH {bad}"))
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="rebuild and compare with the published before.js")
    ap.add_argument("--publish", action="store_true", help="write simulation4/data/before.js")
    a = ap.parse_args()
    try:
        payload = build()
    except ValueError as e:
        sys.exit(f"\nconfig.js is not valid, so nothing was built:\n  {e}")
    text = render(payload)
    print(headline(payload))
    if any(not e["match"] for lst in payload["oldObjectiveCheck"].values() for e in lst):
        sys.exit("\nThe old-objective check failed: this tool does not read Sim 3's data the way Sim 3 did.")
    if a.check:
        try:
            with open(OUT, encoding="utf-8") as f:
                same = f.read() == text
        except FileNotFoundError:
            same = False
        print("\nbefore.js is " + ("IDENTICAL to" if same else "DIFFERENT from") + " the published file")
        sys.exit(0 if same else 1)
    if a.publish:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        print(f"\nwrote {os.path.relpath(OUT, ROOT)} ({len(text) // 1024} KB)")


if __name__ == "__main__":
    main()
