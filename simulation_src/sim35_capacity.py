#!/usr/bin/env python3
"""
sim35_capacity.py - Sim 3.5, item 3: how many new homes can each area take before growth uses up
the design buffer on its path? Runs no SWMM: post-processing of Sim 3's settled infill runs.

    fullness   f = (water depth - outlet invert above the floor) / outlet bore, at a manhole's lowest
               outlet pipe. f >= 1 reproduces Sim 3's surcharge flags, checked on every baseline; the
               script stops if it does not.
    limit      a declared design limit on f. The utility's per-pipe rating would replace it (data
               request item "hydraulic model output"); until then it is swept and labelled, not a
               standard. 0.7 headline, after Kimbrough (2019) as read from a teammate's note.
    path       an area's own manholes plus everything downstream of them, through pump links.
    buffer     on one path, one case: a manhole under the limit before growth has buffer. Homes-to-limit
               is the fewest new dwellings that take any such manhole to the limit, read linearly
               between the saved build-out steps. Manholes already over the limit have no buffer left
               and are counted separately, because growth cannot "use up" what is already gone.

Reported as ">N" when nothing reaches the limit by the top of the ladder: never extrapolated.

    python sim35_capacity.py

Writes results/sim35/capacity.json and results/sim35/capacity_report.txt. The fullness geometry follows
the before-surcharge branch (Rijoy John). The whole-suburb row reads Sim 3-e's runs (Ashis Jose
Kalathil) and is reported separately, because whether those runs join Sim 3.5 is still undecided.
"""
import json, os, statistics, sys
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = next(d for d in (os.path.join(ROOT, "simulation3", "data"), os.path.join(ROOT, "sim3_web", "data")) if os.path.isdir(d))
SUBURB = next((f for f in (os.path.join(HERE, "results", "sim3e", "suburb.json"),
                           os.path.join(ROOT, "public_demo", "simulation_src", "results", "sim3e", "suburb.json")) if os.path.exists(f)), "")
# SIM35_TARGET=sim4 runs the same analysis for Simulation 4: its own regions file (the equal-home regions) and
# results/sim4. Unset, it is Simulation 3.5 as published: simulation3/data/regions.js and results/sim35.
TARGET = os.environ.get("SIM35_TARGET", "sim35")
REGIONS = os.path.join(ROOT, "simulation4", "data", "regions.js") if TARGET == "sim4" else os.path.join(DATA, "regions.js")
OUT = os.path.join(HERE, "results", TARGET)
LIMITS = [0.5, 0.6, 0.7]
HEADLINE = 0.7
DESIGN = "ii0.11_flat_uniform_b1_sfree"
BASE_ERR = 0.05     # assumed error on a manhole's level before growth, as a share of its bore (7.5 mm on 150 mm)
DRAWS = 400
SEED = 35
BAND_HI, BAND_LO = 0.8, 0.2
GONE = 0.25         # no new pipe passes the limit, but this share of the path is already past it: not "room left"


def read_js(path):
    s = open(path, encoding="utf-8").read()
    return json.loads(s[s.index("{"):s.rstrip().rstrip(";").rindex("}") + 1])


def chamber_names():
    s = open(os.path.join(DATA, "growth.js"), encoding="utf-8").read()
    at = s.index('"chambers":')
    return json.loads(s[s.index("[", at):s.index("]", at) + 1])


def geometry(geo, chambers):
    """Per manhole: lowest outlet's invert above the floor and its bore, in mm."""
    ix = {n["name"]: j for j, n in enumerate(geo["nodes"])}
    outs = defaultdict(list)
    for li, u in enumerate(geo["up"]):
        outs[u].append(li)
    rows = []
    for name in chambers:
        j = ix[name]
        if outs[j]:
            li = min(outs[j], key=lambda l: geo["zu"][l])
            rows.append(((geo["zu"][li] - geo["nodes"][j]["inv"]) * 10, geo["dia"][li]))
        else:
            rows.append((None, None))
    return rows


def downstream(geo, chambers):
    """Per manhole, the manholes downstream of it, following pipes and pump links."""
    ix = {n["name"]: j for j, n in enumerate(geo["nodes"])}
    cidx = {ix[c]: i for i, c in enumerate(chambers)}
    nxt = defaultdict(set)
    for u, d in zip(geo["up"], geo["down"]):
        nxt[u].add(d)
    for a, b in geo.get("pumpLinks", []):
        nxt[a].add(b)
    out = []
    for c in chambers:
        seen, stack, res = {ix[c]}, [ix[c]], set()
        while stack:
            for d in nxt[stack.pop()]:
                if d not in seen:
                    seen.add(d)
                    stack.append(d)
                    if d in cidx:
                        res.add(cidx[d])
        out.append(res)
    return out


def crossing(ladder_dw, fs, limit):
    """Dwellings at which a rising fullness series first reaches the limit, or None. ladder_dw[0] = 0."""
    for a in range(1, len(fs)):
        if fs[a] >= limit:
            span = fs[a] - fs[a - 1]
            frac = (limit - fs[a - 1]) / span if span > 0 else 1.0
            return ladder_dw[a - 1] + frac * (ladder_dw[a] - ladder_dw[a - 1])
    return None


def homes_to_limit(series, dw, path, limit):
    """series: {manhole: fullness at [0] + ladder}. Returns (homes, manhole, already_over, with_buffer)."""
    best, who, over, room = None, None, 0, 0
    for m in path:
        fs = series.get(m)
        if fs is None:
            continue
        if fs[0] >= limit:
            over += 1
            continue
        room += 1
        h = crossing(dw, fs, limit)
        if h is not None and (best is None or h < best):
            best, who = h, m
    return best, who, over, room


def band_for(F, bore, dw, share, rng):
    """Band, range and rise per home for one fullness table (manholes x [0] + ladder)."""
    out = {"share_100": share, "top_homes": dw[-1], "rise_mm_per_100_homes": round(float(np.max((F[:, 5] - F[:, 0]) * bore) / dw[5] * 100), 1)}
    for L in LIMITS:
        draws = []
        for _ in range(DRAWS):
            G = F + rng.normal(0, BASE_ERR, len(F))[:, None]
            best = np.inf
            for fs in G:
                if fs[0] < L:
                    h = crossing(dw, fs.tolist(), L)
                    if h is not None and h < best:
                        best = h
            draws.append(best)
        draws = np.array(draws)
        p = float(np.mean(draws <= share))
        gone = float(np.mean(F[:, 0] >= L))
        band = "runs out" if p >= BAND_HI else "uncertain" if p > BAND_LO else "already over" if gone >= GONE else "room left"
        lo, hi = np.percentile(draws, 10), np.percentile(draws, 90)
        out[str(L)] = {"band": band, "p_runs_out": round(p, 3), "homes_p10": None if not np.isfinite(lo) else round(float(lo)),
                       "homes_p90": None if not np.isfinite(hi) else round(float(hi)), "already_over": round(gone, 3)}
    return out


def main():
    reg, geo = read_js(REGIONS), read_js(os.path.join(DATA, "catchment.js"))
    ch = chamber_names()
    gm = geometry(geo, ch)
    down = downstream(geo, ch)
    tags = [c["tag"] for c in reg["cases"]]
    label = {c["tag"]: c["label"] for c in reg["cases"]}
    regions = reg["regions"]
    lines = []

    def say(*a):
        t = " ".join(str(x) for x in a)
        print(t)
        lines.append(t)

    # The check everything rests on: fullness 1 must be Sim 3's surcharge.
    for t in tags:
        b = reg["base"][t]["depthMm"]
        flag = {i for i, (o, d) in enumerate(gm) if o is not None and b.get(str(i), 0) >= o + d}
        if flag != set(reg["base"][t]["surcharged"]):
            sys.exit(f"STOP: fullness 1 disagrees with Sim 3's surcharge flags in {t}")
    say("Check passed: fullness 1 matches Sim 3's surcharge flags on all", len(tags), "baselines.")

    def full(i, depth):
        o, d = gm[i]
        return None if o is None else (depth - o) / d

    results = {}
    for t in tags:
        base = reg["base"][t]["depthMm"]
        results[t] = {}
        for ri, r in enumerate(regions):
            rows = sorted((x for x in reg["rows"][t] if x["r"] == ri), key=lambda x: x["s"])
            dw = [0.0] + [x["dw"] for x in rows]
            path = set(r["manholes"])
            for m in r["manholes"]:
                path |= down[m]
            series = {}
            rises = [dict((i, v) for i, v in x["rise"]) for x in rows]
            for m in path:
                if gm[m][0] is None:
                    continue
                b = base.get(str(m), 0)
                series[m] = [full(m, b)] + [full(m, b + ri_.get(m, 0.0)) for ri_ in rises]
            entry = {"path": len(path), "top_homes": dw[-1], "share_100": rows[4]["dw"]}
            for L in LIMITS + [1.0]:
                h, who, over, room = homes_to_limit(series, dw, path, L)
                entry[str(L)] = {"homes": None if h is None else round(h, 1), "first": None if who is None else ch[who],
                                 "already_over": over, "with_buffer": room}
                # Stability of the read: the same figure with each interior step left out.
                if h is not None:
                    errs = []
                    for drop in range(1, len(dw) - 1):
                        keep = [a for a in range(len(dw)) if a != drop]
                        h2, _, _, _ = homes_to_limit({m: [fs[a] for a in keep] for m, fs in series.items()},
                                                     [dw[a] for a in keep], path, L)
                        if h2 is not None and h > 0:
                            errs.append(abs(h2 - h) / h)
                    entry[str(L)]["worst_drop_step_err"] = round(max(errs), 3) if errs else None
            results[t][r["id"]] = entry

    # ---- report
    ids = [r["id"] for r in regions]
    def cell(e, L):
        x = e[str(L)]
        return f">{e['top_homes']:.0f}" if x["homes"] is None else f"{x['homes']:.0f}"
    say(f"\nNew homes before the path passes {HEADLINE} of bore (>N = not reached by the top of the ladder, 300%)")
    say(f"{'case':38s}" + "".join(f"{i:>7s}" for i in ids))
    for t in tags:
        say(f"{label[t]:38s}" + "".join(f"{cell(results[t][i], HEADLINE):>7s}" for i in ids))
    say(f"{'2041 share (100% build-out)':38s}" + "".join(f"{results[tags[0]][i]['share_100']:7.0f}" for i in ids))
    say(f"\nManholes on the path already past {HEADLINE} before any growth / manholes with buffer")
    for t in tags:
        say(f"{label[t]:38s}" + "".join(f"{results[t][i][str(HEADLINE)]['already_over']:3d}/{results[t][i][str(HEADLINE)]['with_buffer']:<3d}" for i in ids))
    say(f"\nDesign wet: sensitivity to the limit, and the manhole that gets there first")
    for L in LIMITS + [1.0]:
        say(f"  limit {L}: " + "  ".join(f"{i} {cell(results[DESIGN][i], L)} ({results[DESIGN][i][str(L)]['first'] or '-'})" for i in ids))
    say("\nIs the first manhole stable? Distinct first manholes for each area across the wet cases at 0.7:")
    for i in ids:
        firsts = [results[t][i][str(HEADLINE)]["first"] for t in tags if t != tags[0]]
        c = {f: firsts.count(f) for f in set(firsts) if f}
        say(f"  {i}: reached in {sum(1 for f in firsts if f)} of {len(firsts)} wet cases; " + ", ".join(f"{k} x{v}" for k, v in sorted(c.items(), key=lambda kv: -kv[1])))
    errs = [results[t][i][str(L)].get("worst_drop_step_err") for t in tags for i in ids for L in LIMITS]
    errs = [e for e in errs if e is not None]
    say(f"\nReading between steps: with an interior step left out, the figure moves by a median of {statistics.median(errs):.0%} (worst per figure), up to {max(errs):.0%}; {len(errs)} figures.")

    # Within the plausible range, how many areas run out?
    say("\nAreas reaching the limit within their own 2041 share (100% build-out), of 8:")
    for L in LIMITS + [1.0]:
        say(f"  limit {L}: " + "  ".join(f"{label[t].split(' +')[0][:13]}{'+' if '+' in label[t] else ''}={sum(1 for i in ids if results[t][i][str(L)]['homes'] is not None and results[t][i][str(L)]['homes'] <= results[t][i]['share_100'])}" for t in tags))

    # ---- the reported output (the team, 4 Nov): band, range, rise per home, buffer already gone.
    # A single first-pipe number is not defensible: it swings with the uncalibrated baseline
    # (sim35_capacity_check.py). So every manhole's level is shifted by an independent error and
    # the band is how often the area runs out within its own 2041 share.
    rng = np.random.default_rng(SEED)
    bands = {}
    for t in tags:
        base = reg["base"][t]["depthMm"]
        bands[t] = {}
        for ri, r in enumerate(regions):
            rows = sorted((x for x in reg["rows"][t] if x["r"] == ri), key=lambda x: x["s"])
            dw = [0.0] + [x["dw"] for x in rows]
            share = rows[4]["dw"]
            path = set(r["manholes"])
            for m in r["manholes"]:
                path |= down[m]
            path = sorted(m for m in path if gm[m][0] is not None)
            rises = [dict((i, v) for i, v in x["rise"]) for x in rows]
            F = np.array([[full(m, base.get(str(m), 0))] + [full(m, base.get(str(m), 0) + q.get(m, 0.0)) for q in rises]
                          for m in path])
            bore = np.array([gm[m][1] for m in path])
            bands[t][r["id"]] = band_for(F, bore, dw, share, rng)

    def rng_txt(e, L):
        x = e[str(L)]
        a = f">{e['top_homes']:.0f}" if x["homes_p10"] is None else str(x["homes_p10"])
        b = f">{e['top_homes']:.0f}" if x["homes_p90"] is None else str(x["homes_p90"])
        return a if a == b else f"{a} to {b}"

    say(f"\n=== REPORTED OUTPUT. Baseline error {BASE_ERR} of bore, {DRAWS} draws. Band: runs out within the 2041 share in at least {BAND_HI:.0%} of draws, room left in at most {BAND_LO:.0%}.")
    short = {"runs out": "OUT", "uncertain": "unc", "room left": "room", "already over": "over"}
    say(f"\nBand at limit {HEADLINE}, every case")
    say(f"{'case':38s}" + "".join(f"{i:>6s}" for i in ids))
    for t in tags:
        say(f"{label[t]:38s}" + "".join(f"{short[bands[t][i][str(HEADLINE)]['band']]:>6s}" for i in ids))
    say(f"\nDesign wet, per area, limit {HEADLINE}: share, homes to first pipe (10th to 90th), mm per 100 homes, band, path already over")
    for i in ids:
        e = bands[DESIGN][i]; x = e[str(HEADLINE)]
        say(f"  {i}: share {e['share_100']:.0f}; {rng_txt(e, HEADLINE)}; {e['rise_mm_per_100_homes']:.0f} mm; {x['band']} (p {x['p_runs_out']:.2f}); already over {x['already_over']:.0%}")
    say("\nDoes the band survive the choice of limit? Design wet:")
    for L in LIMITS:
        say(f"  limit {L}: " + " ".join(f"{i} {short[bands[DESIGN][i][str(L)]['band']]}" for i in ids))
    say("\nHow far does each area's band hold across the wet cases, limit 0.7 (runs out / uncertain / room left / already over, of 7):")
    wet_tags = [t for t, c in zip(tags, reg["cases"]) if c["ii"] > 0]
    for i in ids:
        n_ = [sum(bands[t][i][str(HEADLINE)]["band"] == b for t in wet_tags) for b in ("runs out", "uncertain", "room left", "already over")]
        say(f"  {i}: {n_[0]} / {n_[1]} / {n_[2]} / {n_[3]}")

    # ---- whole suburb, separately
    suburb, suburb_bands = {}, {}
    if SUBURB and os.path.exists(SUBURB):
        sub = json.load(open(SUBURB, encoding="utf-8"))
        name_ix = {n: i for i, n in enumerate(ch)}
        say("\nSeparately, whole suburb at once (Sim 3-e's runs, not yet part of Sim 3.5): 485 homes = 100%")
        for t in tags:
            base = reg["base"][t]["depthMm"]
            rows = sorted((x for x in sub["rows"] if x["case"] == t), key=lambda x: x["step"])
            dw = [0.0] + [x["dwellings"] for x in rows]
            series = {}
            for m, c in enumerate(ch):
                if gm[m][0] is None:
                    continue
                key = c.replace("MH", "")
                series[m] = [full(m, base.get(str(m), 0))] + [full(m, x["depth_mm"][key]) for x in rows]
            ms = sorted(series)
            suburb_bands[t] = band_for(np.array([series[m] for m in ms]), np.array([gm[m][1] for m in ms]), dw, rows[4]["dwellings"], rng)
            suburb[t] = {}
            for L in LIMITS + [1.0]:
                h, who, over, room = homes_to_limit(series, dw, set(series), L)
                suburb[t][str(L)] = {"homes": None if h is None else round(h, 1), "first": None if who is None else ch[who],
                                     "already_over": over, "with_buffer": room}
            x = suburb[t][str(HEADLINE)]
            say(f"  {label[t]:38s} limit {HEADLINE}: {('>' + str(int(dw[-1]))) if x['homes'] is None else round(x['homes'])} homes ({x['first']}); already over {x['already_over']} of {x['already_over'] + x['with_buffer']}")

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "capacity.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"limits": LIMITS, "headline": HEADLINE, "labels": label, "baseline_error": BASE_ERR, "draws": DRAWS,
                   "bands": bands, "first_pipe": results, "whole_suburb": suburb, "whole_suburb_bands": suburb_bands}, f, indent=1)
    with open(os.path.join(OUT, "capacity_report.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    print("wrote results/sim35/capacity.json and capacity_report.txt")


if __name__ == "__main__":
    main()
