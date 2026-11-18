"""Independent check of the drawn greenfield estates (simulation4/data/estates.js).

Does not import the estate builder. Checks every estate size against the plan and the sewer
design rules the builder states (grade, depth, run length, manhole reasons, nesting), then
compares each estate's manhole and home density with the real network, measured the same way.
Run from the repo root:  python3 tools/check_sim4_estates.py
"""
import json, math, os, sys
import numpy as np
from scipy.spatial import cKDTree
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
t = open(os.path.join(ROOT, "simulation4/data/estates.js")).read(); d = json.loads(t[t.index("{"):t.rindex("}") + 1])
plan = json.load(open(os.path.join(ROOT, "simulation_src/results/sim4/greenfield/plan.json")))
bad = []
def ok(c, m):
    if not c: bad.append(m)
want = {s["site_id"]: s for s in plan["eligible"]}
ok(set(d["sites"]) == set(want), f"site keys {sorted(d['sites'])} != plan {sorted(want)}")
MIN_G, MIN_D, MAX_D, MAX_RUN, TURN = 0.005, 1.4, 6.5, 120.0, 30.0
key = lambda p: (round(p[0], 1), round(p[1], 1))
for sid, s in d["sites"].items():
    if sid not in want: continue
    ok(sorted(int(k) for k in s["steps"]) == sorted(want[sid]["steps"]), f"{sid} steps differ from plan")
    prevp = prevm = None
    for k in sorted(s["steps"], key=int):
        st = s["steps"][k]; tag = f"{sid}@{k}"
        pipes = {json.dumps(p) for p in st["pipes"]}; mhs = {json.dumps(m) for m in st["mh"]}
        if prevp is not None:
            ok(prevp <= pipes, f"{tag} pipes of the smaller size are not a subset (not nested)")
            ok(prevm <= mhs, f"{tag} manholes of the smaller size are not a subset (not nested)")
        prevp, prevm = pipes, mhs
        ok(st["n"] == int(k), f"{tag} houses {st['n']}")
        mh = {key(m): m for m in st["mh"]}
        ends = {key(m): m for m in st.get("ends", [])}   # dead ends: a plain pipe end, no manhole
        ok(not (set(ends) & set(mh)), f"{tag} a point is both a manhole and a pipe end")
        deg, nxt, steep, flat, total = {}, {}, 0, 0, 0.0
        for p in st["pipes"]:
            a, b = p[0], p[-1]; L = sum(math.dist(p[i][:2], p[i + 1][:2]) for i in range(len(p) - 1)); total += L
            ok((key(a) in mh or key(a) in ends) and key(b) in mh, f"{tag} pipe end without a manhole")
            ok(L <= MAX_RUN + 0.5, f"{tag} run {L:.0f} m > {MAX_RUN:g}")
            g = (a[2] - b[2]) / L if L else 0
            if g < MIN_G - 1e-4: flat += 1
            ma, mb = mh.get(key(a)) or ends.get(key(a)), mh.get(key(b))
            if ma and mb and len(ma) >= 4 and len(mb) >= 4:
                gs = (ma[3] - mb[3]) / L if L else 0   # ground slope along the pipe
                if g > max(gs, MIN_G) + 0.03: steep += 1
            for e in (a, b): deg[key(e)] = deg.get(key(e), 0) + 1
            nxt.setdefault(key(a), []).append((key(b), L, p)); 
        ok(flat == 0, f"{tag} {flat} pipes flatter than {MIN_G}")
        ok(steep == 0, f"{tag} {steep} pipes more than 3% steeper than the ground along them (use a drop at the manhole instead)")
        for kk in ends:
            ok(deg.get(kk, 0) == 1 and kk in nxt, f"{tag} pipe end that is not a dead end")
        for m in st["mh"] + st.get("ends", []):
            ok(len(m) >= 4, f"{tag} manhole lacks ground level (expect [x, y, invert, ground])")
            if len(m) >= 4:
                dep = m[3] - m[2]
                ok(MIN_D - 0.05 <= dep <= MAX_D + 0.05, f"{tag} manhole depth {dep:.2f} m outside {MIN_D}-{MAX_D}")
        # every manhole must be needed: an end, a junction, a turn over 30 deg, a drop, or spacing
        ins = {}
        for a, lst in nxt.items():
            for b, L, p in lst: ins.setdefault(b, []).append((a, L, p))
        extra = 0
        for kk, m in mh.items():
            if deg.get(kk, 0) != 2 or len(ins.get(kk, [])) != 1 or len(nxt.get(kk, [])) != 1: continue
            (a, La, pa), (b, Lb, pb) = ins[kk][0], nxt[kk][0]
            v1 = (pa[-1][0] - pa[-2][0], pa[-1][1] - pa[-2][1]); v2 = (pb[1][0] - pb[0][0], pb[1][1] - pb[0][1])
            ang = abs(math.degrees(math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1])))
            drop = abs(pa[-1][2] - pb[0][2]) > 0.05
            ga, gb = (pa[0][2] - pa[-1][2]) / max(La, 1e-9), (pb[0][2] - pb[-1][2]) / max(Lb, 1e-9)
            regrade = abs(ga - gb) > 0.005  # sewer codes put a manhole at every change of grade
            if ang <= TURN and not drop and not regrade and La + Lb <= MAX_RUN: extra += 1
        # a smaller size can show a junction whose other branch only comes with a later size
        ok(extra == 0 or k != max(s["steps"], key=int), f"{tag} {extra} manholes that are not an end, junction, turn over {TURN:g} deg, drop or needed for {MAX_RUN:g} m spacing")
        if k == max(s["steps"], key=int):  # no sourced target, so reported rather than gated
            print(f"{sid}: {len(st['mh'])} manholes for {k} homes ({int(k) / len(st['mh']):.1f} homes per manhole)")

# Density against the real network, measured the same way for both: the area is all land within
# 30 m of a connected home, on a 5 m grid. The real network gives the reference; the +/-30% band
# is a team choice (own choice), not a design standard.
def served_ha(pts, r=30.0, cell=5.0):
    pts = np.asarray(pts, float); lo, hi = pts.min(0) - r, pts.max(0) + r
    gx, gy = np.meshgrid(np.arange(lo[0], hi[0], cell), np.arange(lo[1], hi[1], cell))
    dist = cKDTree(pts).query(np.c_[gx.ravel(), gy.ravel()], distance_upper_bound=r)[0]
    return float((dist <= r).sum()) * cell * cell / 1e4
BAND = 0.30
cat = open(os.path.join(ROOT, "simulation3/data/catchment.js")).read()
net = json.loads(cat[cat.index("=") + 1:].strip().rstrip(";"))
homes_xy = np.c_[net["hx"], net["hy"]] / 10.0                    # decimetres to metres
real_mh = sum(1 for x in net["nodes"] if x.get("kind") == "chamber")
real_ha = served_ha(homes_xy)
ref = {"manholes per ha": real_mh / real_ha, "homes per ha": len(homes_xy) / real_ha}
print(f"Real network: {real_mh} manholes, {len(homes_xy)} homes on {real_ha:.1f} ha: "
      f"{ref['manholes per ha']:.2f} manholes and {ref['homes per ha']:.1f} homes per ha, "
      f"{len(homes_xy) / real_mh:.1f} homes per manhole")
for sid, s in d["sites"].items():
    st = s["steps"][max(s["steps"], key=int)]
    cen = [(sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r)) for r in s["houses"][:st["n"]]]
    ha = served_ha(cen)
    got = {"manholes per ha": len(st["mh"]) / ha, "homes per ha": st["n"] / ha}
    print(f"{sid}: {ha:.1f} ha, {got['manholes per ha']:.2f} manholes and {got['homes per ha']:.1f} homes per ha")
    for kname, v in got.items():
        ok(abs(v / ref[kname] - 1) <= BAND, f"{sid} {kname} {v:.2f} is more than {BAND:.0%} from the real network's {ref[kname]:.2f}")
for m in bad[:40]: print("FAIL", m)
print(f"ESTATES FAIL ({len(bad)})" if bad else "ESTATES PASS"); sys.exit(1 if bad else 0)
