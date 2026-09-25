#!/usr/bin/env python3
"""
overlap_check.py - can the statewide gravity-main layer continue the Walkerville model?

P1 of the domain upgrade (HANDOFF). Before any statewide pipe is stitched onto the council
extract, every council main that also appears statewide is compared field by field, so the
join rests on a measurement rather than on the two services being "the same data".

Two services, one asset register behind both, published by different hosts on different
schedules. The questions, per pipe matched on asset ID:
    geometry    do the two polylines lie on top of each other
    diameter    nominal and internal
    inverts     start and end, and whether "start" means the same end in both
    direction   does FLOWDIRECT agree
It also answers the question the extension actually turns on: where the council network
stops, does the statewide one carry on, and which way does the water go there.

Reads data/raw only. Writes results/overlap/overlap_report.json and mismatches.csv.

Usage:
    python overlap_check.py
"""
import csv, json, math, os
from collections import Counter

import numpy as np
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "data", "raw")
OUT = os.path.join(HERE, "results", "overlap")

GEOM_TOL = 1.0      # m, mean vertex offset below which two polylines are the same line
INVERT_TOL = 0.01   # m, inverts are published to the centimetre
SNAP_TOL = 1.0      # m, same as network.SNAP_TOL: pipe ends closer than this are one node


def load(name):
    with open(os.path.join(RAW, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


def datum_shift(wv, sw):
    """The constant offset to ADD to statewide coordinates to land on the council ones.

    Measured 24 Sep: every matched pipe is displaced by the same vector, (+0.65, +1.50) m,
    residual median 4 mm. That is the GDA94 to GDA2020 datum difference: the council layer
    is native GDA2020 (wkid 8059) and the statewide one Web Mercator, both asked for in
    GDA94, and one server applies the datum transformation while the other does not. It
    is estimated from the data, not hard-coded, so a change on either server shows up in
    the report instead of silently breaking every join.
    """
    by_id = {f["attributes"].get("id"): f for f in sw["features"]}
    d = []
    for f in wv["features"]:
        s = by_id.get(f["attributes"]["ID"])
        if not s:
            continue
        a, b = verts(f), verts(s)
        if len(a) != len(b):
            continue
        if np.hypot(*(a[0] - b[-1])) < np.hypot(*(a[0] - b[0])):
            b = b[::-1]
        d.append((a - b).mean(0))
    return np.median(np.array(d), axis=0)


def shift(sw, dxy):
    for f in sw["features"]:
        f["geometry"]["paths"] = [[[p[0] + dxy[0], p[1] + dxy[1]] for p in path]
                                  for path in f["geometry"]["paths"]]


def verts(feat):
    return np.array([p for path in feat["geometry"]["paths"] for p in path], float)


def mean_offset(a, b):
    """Symmetric mean distance from each polyline's vertices to the other's vertices.
    Vertices, not segments, which overstates the offset on long straight pipes; that errs
    toward reporting a mismatch, the safe direction."""
    return 0.5 * (cKDTree(b).query(a)[0].mean() + cKDTree(a).query(b)[0].mean())


def num(v):
    return None if v in (None, "", " ") else float(v)


def same(a, b, tol=0.0):
    if a is None or b is None:
        return None
    return abs(a - b) <= tol


def compare(wv, sw):
    rows = []
    by_id = {}
    for f in sw["features"]:
        by_id.setdefault(f["attributes"].get("id"), []).append(f)
    for f in wv["features"]:
        a = f["attributes"]
        hits = by_id.get(a["ID"], [])
        r = {"id": a["ID"], "matched": bool(hits), "statewide_records": len(hits)}
        if hits:
            s = hits[0]["attributes"]
            wa, sa = verts(f), verts(hits[0])
            off = mean_offset(wa, sa)
            # Is the statewide polyline digitised the same way round? Needed to read FLOWDIRECT.
            rev = np.hypot(*(wa[0] - sa[-1])) < np.hypot(*(wa[0] - sa[0]))
            r.update({
                "geom_offset_m": round(off, 3),
                "geom_match": bool(off <= GEOM_TOL),
                "digitised_reversed": bool(rev),
                "nominal_wv": num(a.get("NOMINALDIA")), "nominal_sw": num(s.get("nominaldiameter")),
                "internal_wv": num(a.get("INTERNALDI")), "internal_sw": num(s.get("internaldiameter")),
                "start_inv_wv": num(a.get("START_INVE")), "start_inv_sw": num(s.get("start_invert")),
                "end_inv_wv": num(a.get("END_INVERT")), "end_inv_sw": num(s.get("end_invert")),
                "grade_wv": num(a.get("GRADE")), "grade_sw": num(s.get("grade")),
                "flowdir_wv": a.get("FLOWDIRECT"), "flowdir_sw": s.get("flowdirection"),
                "material_wv": a.get("MATERIAL"), "material_sw": s.get("material"),
            })
            r["nominal_match"] = same(r["nominal_wv"], r["nominal_sw"])
            r["internal_match"] = same(r["internal_wv"], r["internal_sw"])
            r["start_inv_match"] = same(r["start_inv_wv"], r["start_inv_sw"], INVERT_TOL)
            r["end_inv_match"] = same(r["end_inv_wv"], r["end_inv_sw"], INVERT_TOL)
            # FLOWDIRECT is relative to digitising order (1 = first vertex upstream), so a
            # reversed polyline with the opposite code is the SAME physical direction.
            fw, fs = r["flowdir_wv"], r["flowdir_sw"]
            if fw in (1, 2) and fs in (1, 2):
                r["flow_match"] = bool((fw == fs) != rev)
            else:
                r["flow_match"] = None
        rows.append(r)
    return rows


def summarise(rows):
    m = [r for r in rows if r["matched"]]

    def tally(key):
        c = Counter(r.get(key) for r in m)
        return {"agree": c[True], "disagree": c[False], "not_comparable": c[None]}

    return {
        "council_pipes": len(rows),
        "matched_on_id": len(m),
        "unmatched": [r["id"] for r in rows if not r["matched"]],
        "duplicate_ids_statewide": sum(1 for r in m if r["statewide_records"] > 1),
        "geometry": tally("geom_match"),
        "geom_offset_m": {"median": float(np.median([r["geom_offset_m"] for r in m])),
                          "max": float(max(r["geom_offset_m"] for r in m))} if m else None,
        "digitised_reversed": sum(r["digitised_reversed"] for r in m),
        "nominal_diameter": tally("nominal_match"),
        "internal_diameter": tally("internal_match"),
        "start_invert": tally("start_inv_match"),
        "end_invert": tally("end_inv_match"),
        "flow_direction": tally("flow_match"),
    }


def ends(feat):
    p = feat["geometry"]["paths"]
    return tuple(p[0][0]), tuple(p[-1][-1])


def upstream_end(feat, key):
    """Flow-anchored ends: (upstream_xy, downstream_xy). FLOWDIRECT 2 = last vertex upstream."""
    a, b = ends(feat)
    return (b, a) if feat["attributes"].get(key) == 2 else (a, b)


def boundary(wv, sw):
    """Where the council network touches statewide pipes the council layer does not hold.

    For every statewide pipe NOT in the council layer that shares an end (within SNAP_TOL)
    with a council-held pipe, classify it by which way its water goes at that shared point:
        inflow    it delivers water INTO the council network (a missed side inflow, 5.1)
        gap       both ends on council pipes, a link missing from the council extract
        outflow   it carries council water AWAY (a downstream continuation, 5.2)

    Topology is read in the STATEWIDE frame: the council-held pipes are located by asset ID
    in the statewide layer and their statewide ends are used. Snapping to council geometry
    instead misses the real continuation, because the two sources draw some pipes
    differently (the last trunk pipe below 583, 1495295, ends about 48 m apart). The
    council pipe touched is reported by asset ID, which is how network.py knows it.
    """
    wv_ids = {f["attributes"]["ID"] for f in wv["features"]}
    held = [f for f in sw["features"] if f["attributes"].get("id") in wv_ids]
    pts, owner = [], []
    for f in held:
        for p in ends(f):
            pts.append(p)
            owner.append(f["attributes"]["id"])
    tree = cKDTree(np.array(pts))
    touch = []
    for f in sw["features"]:
        s = f["attributes"]
        if s.get("id") in wv_ids:
            continue
        up, dn = upstream_end(f, "flowdirection")
        du, iu = tree.query(up)
        dd, idn = tree.query(dn)
        rec = {"id": s.get("id"), "dia": s.get("nominaldiameter"),
               "start_invert": s.get("start_invert"), "end_invert": s.get("end_invert"),
               "wwtp": s.get("destinationwwtp")}
        if dd <= SNAP_TOL and du <= SNAP_TOL:
            # Both ends on council-held pipes: a link the council extract dropped, not an
            # inflow. Measured 24 Sep: 1495294, 30 m of the 450 mm trunk below 583, is one,
            # and its absence is why the council network appears to end at node 606.
            touch.append({**rec, "kind": "gap", "council_pipe": owner[iu],
                          "council_pipe_down": owner[idn], "at": [round(v, 1) for v in up]})
        elif dd <= SNAP_TOL:
            touch.append({**rec, "kind": "inflow", "council_pipe": owner[idn],
                          "at": [round(v, 1) for v in dn]})
        elif du <= SNAP_TOL:
            touch.append({**rec, "kind": "outflow", "council_pipe": owner[iu],
                          "at": [round(v, 1) for v in up]})
    return touch


def statewide_upstream(sw):
    """Flow-anchored statewide graph: for each pipe, every statewide pipe draining to it."""
    key = lambda p: (round(p[0] / SNAP_TOL), round(p[1] / SNAP_TOL))
    into, up_of, length = {}, {}, {}
    for f in sw["features"]:
        a = f["attributes"]
        u, d = upstream_end(f, "flowdirection")
        up_of[a["id"]] = key(u)
        length[a["id"]] = float(a.get("st_length(shape)") or 0.0)
        into.setdefault(key(d), []).append(a["id"])

    def above(pid):
        seen, stack = set(), [pid]
        while stack:
            x = stack.pop()
            if x not in seen:
                seen.add(x)
                stack.extend(into.get(up_of[x], []))
        return seen
    return above, length


def impact(boundary_rows, sw, wv_ids, outlet=583):
    """What each missed inflow means for the models: where it lands, and how much sewer is
    behind it. 'growth' = inside the Sim 2 catchment above `outlet`; 'trunk_hop' = joins the
    pipe run below `outlet` that the free outfall currently cuts off."""
    from network import Network
    net = Network()
    by_asset = {p.asset_id: i for i, p in enumerate(net.pipes)}
    growth = set(net.upstream_pipes(outlet))
    trunk, n = [], outlet
    while net.nodes[n].outs:
        trunk.append(net.nodes[n].outs[0])
        n = net.pipes[trunk[-1]].down
    tset = set(trunk)
    above, length = statewide_upstream(sw)
    out = []
    for b in boundary_rows:
        if b["kind"] != "inflow":
            continue
        pi = by_asset.get(b["council_pipe"])
        hop = None
        if pi is not None:
            q, n = pi, None
            while True:
                if q in tset:
                    hop = trunk.index(q)
                    break
                n = net.pipes[q].down
                if not net.nodes[n].outs:
                    break
                q = net.nodes[n].outs[0]
        ups = above(b["id"])
        out.append({"id": b["id"], "council_pipe": b["council_pipe"],
                    "lands": ("not_in_network" if pi is None else
                              "growth" if pi in growth else
                              "trunk" if hop is not None else "elsewhere"),
                    "trunk_hop": hop,
                    "outside_pipes": len(ups - wv_ids),
                    "outside_length_m": round(sum(length[x] for x in ups - wv_ids), 1)})
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    wv, sw = load("mains"), load("sw_gravity")
    dxy = datum_shift(wv, sw)
    shift(sw, dxy)
    rows = compare(wv, sw)
    s = summarise(rows)
    s["datum_shift_added_to_statewide_m"] = [round(float(v), 3) for v in dxy]
    s["boundary"] = boundary(wv, sw)
    s["boundary_counts"] = dict(Counter(t["kind"] for t in s["boundary"]))

    wv_ids = {f["attributes"]["ID"] for f in wv["features"]}
    s["inflow_impact"] = impact(s["boundary"], sw, wv_ids)
    g = [r for r in s["inflow_impact"] if r["lands"] == "growth"]
    s["growth_catchment_missing"] = {"inflows": len(g),
                                     "outside_length_m": round(sum(r["outside_length_m"] for r in g), 1)}

    rm_ids = {f["attributes"]["ID"] for f in load("rising_mains")["features"]}
    sp_ids = {f["attributes"].get("id") for f in load("sw_pumping")["features"]}
    s["rising_mains"] = {"council": len(rm_ids), "also_statewide": len(rm_ids & sp_ids),
                         "missing_statewide": sorted(rm_ids - sp_ids)}
    s["sources"] = {"council": wv["source"], "statewide": sw["source"],
                    "statewide_fetched": sw["fetched"], "statewide_box": sw.get("envelope")}

    with open(os.path.join(OUT, "overlap_report.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(s, f, indent=1)
    keys = sorted({k for r in rows for k in r})
    bad = [r for r in rows if not r["matched"] or any(
        r.get(k) is False for k in ("geom_match", "nominal_match", "internal_match",
                                    "start_inv_match", "end_inv_match", "flow_match"))]
    with open(os.path.join(OUT, "mismatches.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(bad)

    print(f"datum shift added to statewide: {s['datum_shift_added_to_statewide_m']} m")
    print(f"council pipes {s['council_pipes']}, matched on ID {s['matched_on_id']}, "
          f"duplicate statewide IDs {s['duplicate_ids_statewide']}")
    for k in ("geometry", "nominal_diameter", "internal_diameter", "start_invert",
              "end_invert", "flow_direction"):
        print(f"  {k:18s} {s[k]}")
    print(f"  geom offset m      {s['geom_offset_m']}, digitised reversed {s['digitised_reversed']}")
    print(f"  boundary pipes     {s['boundary_counts']}")
    print(f"  rising mains       {s['rising_mains']}")
    print(f"  GROWTH CATCHMENT above 583 misses {s['growth_catchment_missing']}")
    t = [r for r in s["inflow_impact"] if r["lands"] == "trunk"]
    print(f"  trunk below 583 takes {len(t)} outside inflows, "
          f"{round(sum(r['outside_length_m'] for r in t))} m of outside sewer, at hops "
          f"{sorted({r['trunk_hop'] for r in t})}")
    print(f"  {len(bad)} rows written to results/overlap/mismatches.csv")


if __name__ == "__main__":
    main()
