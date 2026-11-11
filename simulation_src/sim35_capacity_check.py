#!/usr/bin/env python3
"""
sim35_capacity_check.py - how far can the homes-to-limit figure be trusted? Runs no SWMM.

The model is uncalibrated, so each manhole's level before growth is uncertain. This shifts every
manhole's whole fullness series by an independent error and re-reads the figures. It also compares
the first-pipe figure with sturdier ones, and looks at whether the rise per home is steadier than
the buffer it is measured against.

    python sim35_capacity_check.py

Writes results/sim35/capacity_check.txt.
"""
import json, os, statistics
import numpy as np
import sim35_capacity as C

reg, geo = C.read_js(os.path.join(C.DATA, "regions.js")), C.read_js(os.path.join(C.DATA, "catchment.js"))
ch = C.chamber_names(); gm = C.geometry(geo, ch); down = C.downstream(geo, ch)
tags = [c["tag"] for c in reg["cases"]]; label = {c["tag"]: c["label"] for c in reg["cases"]}
regions = reg["regions"]; ids = [r["id"] for r in regions]
lines = []
def say(*a):
    t = " ".join(str(x) for x in a); print(t); lines.append(t)


def series_for(t, ri):
    r = regions[ri]
    base = reg["base"][t]["depthMm"]
    rows = sorted((x for x in reg["rows"][t] if x["r"] == ri), key=lambda x: x["s"])
    dw = [0.0] + [x["dw"] for x in rows]
    path = set(r["manholes"])
    for m in r["manholes"]:
        path |= down[m]
    path = sorted(m for m in path if gm[m][0] is not None)
    rises = [dict((i, v) for i, v in x["rise"]) for x in rows]
    F = np.array([[(base.get(str(m), 0) + ([0.0] + [q.get(m, 0.0) for q in rises])[a] - gm[m][0]) / gm[m][1]
                   for a in range(len(dw))] for m in path])
    return np.array(dw), path, F, rows[4]["dw"]


def crossings(F, dw, L):
    """Homes at which each manhole with buffer reaches L; inf if never, nan if already over."""
    out = np.full(len(F), np.inf)
    out[F[:, 0] >= L] = np.nan
    for i in np.where(F[:, 0] < L)[0]:
        for a in range(1, F.shape[1]):
            if F[i, a] >= L:
                span = F[i, a] - F[i, a - 1]
                out[i] = dw[a - 1] + ((L - F[i, a - 1]) / span if span > 0 else 1.0) * (dw[a] - dw[a - 1])
                break
    return out


def nth(cr, k):
    v = np.sort(cr[np.isfinite(cr)])
    return v[k - 1] if len(v) >= k else np.inf


def fmt(x, top):
    return f">{top:.0f}" if not np.isfinite(x) else f"{x:.0f}"


L = C.HEADLINE
say(f"Limit {L}. How close to the limit is the manhole that crosses first, before any growth?")
say(f"{'':38s}" + "".join(f"{i:>16s}" for i in ids))
for t in tags:
    cells = []
    for ri in range(len(ids)):
        dw, path, F, sh = series_for(t, ri)
        cr = crossings(F, dw, L)
        if np.isfinite(cr).any():
            j = int(np.nanargmin(np.where(np.isfinite(cr), cr, np.nan)))
            cells.append(f"{F[j, 0]:.3f} {(L - F[j, 0]) * gm[path[j]][1]:3.0f}mm")
        else:
            cells.append("-")
    say(f"{label[t]:38s}" + "".join(f"{c:>16s}" for c in cells))

say("\nBaseline error test, Design wet: every manhole's level shifted by an independent error, 400 draws.")
say("10th to 90th percentile of homes. Sigma 0.05 of bore is 7.5 mm on a 150 mm pipe.")
rng = np.random.default_rng(35)
for sig in (0.02, 0.05):
    say(f" sigma {sig}")
    say(f"   {'area':6s}{'share':>7s}{'first pipe':>16s}{'third pipe':>16s}{'pipes past at share':>22s}")
    for ri, i in enumerate(ids):
        dw, path, F, sh = series_for(C.DESIGN, ri)
        firsts, thirds, counts = [], [], []
        for _ in range(400):
            e = rng.normal(0, sig, len(F))[:, None]
            cr = crossings(F + e, dw, L)
            firsts.append(nth(cr, 1)); thirds.append(nth(cr, 3))
            counts.append(int(np.sum(cr[np.isfinite(cr)] <= sh)))
        q = lambda v: f"{fmt(np.percentile(v, 10), dw[-1])} to {fmt(np.percentile(v, 90), dw[-1])}"
        say(f"   {i:6s}{sh:7.0f}{q(firsts):>16s}{q(thirds):>16s}{np.percentile(counts, 10):>14.0f} to {np.percentile(counts, 90):.0f}")

say("\nPipes newly past the limit at each area's 100% share, with no error added:")
say(f"{'':38s}" + "".join(f"{i:>6s}" for i in ids))
for lim in C.LIMITS:
    say(f" limit {lim}")
    for t in tags:
        cells = []
        for ri in range(len(ids)):
            dw, path, F, sh = series_for(t, ri)
            cr = crossings(F, dw, lim)
            cells.append(int(np.sum(cr[np.isfinite(cr)] <= sh)))
        say(f"   {label[t]:35s}" + "".join(f"{c:6d}" for c in cells))

say("\nBuffer already gone: share of each path past the limit before any growth (Design wet, Beyond design):")
for t in (C.DESIGN, "ii0.25_flat_uniform_b1_sfree"):
    for lim in C.LIMITS:
        cells = []
        for ri in range(len(ids)):
            dw, path, F, sh = series_for(t, ri)
            cells.append(f"{np.mean(F[:, 0] >= lim):.0%}")
        say(f"   {label[t]:20s} limit {lim}: " + " ".join(f"{i} {c}" for i, c in zip(ids, cells)))

say("\nIs the rise per home steady? Largest rise on the path per 100 homes, at 25% and at 100% build-out (Design wet),")
say("and the same at 100% across the wet cases. Lower-left to upper-right steady means a usable rating:")
wet = [t for t, c in zip(tags, reg["cases"]) if c["ii"] > 0]
for ri, i in enumerate(ids):
    dw, path, F, sh = series_for(C.DESIGN, ri)
    bore = np.array([gm[m][1] for m in path])
    rate = lambda a: float(np.max((F[:, a] - F[:, 0]) * bore) / dw[a] * 100)
    per_case = []
    for t in wet:
        d2, p2, F2, _ = series_for(t, ri)
        b2 = np.array([gm[m][1] for m in p2])
        per_case.append(float(np.max((F2[:, 5] - F2[:, 0]) * b2) / d2[5] * 100))
    say(f"   {i}: {rate(2):7.0f} mm per 100 homes at 25%, {rate(5):7.0f} at 100%; across wet cases at 100%: {min(per_case):.0f} to {max(per_case):.0f}")

with open(os.path.join(C.OUT, "capacity_check.txt"), "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(lines) + "\n")
