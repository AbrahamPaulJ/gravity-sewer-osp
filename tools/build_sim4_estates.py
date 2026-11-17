#!/usr/bin/env python3
"""Imaginary surrounding street network and estates around the existing sewer network.

Generates one seeded planar street map in the open land (~40 m to 1.2 km) around the
existing network, patterned on local Adelaide street statistics from osm_streets_ext.json
(segment lengths, block sizes, T vs 4-way junction shares, cul-de-sac share/length,
collector curvature). Each of the 9 connections in plan.json gets its own entry and takes
contiguous blocks nearest it, never a block another estate holds, until its largest step
fits. Houses are laid out on ground contours and a terrain-following sewer tree is routed
along the streets that serve them: gravity if feasible within 1.4-6.5 m depth, otherwise a
wet well at the estate's lowest ground point, with a rising main along the streets to the
connection. Where a sewer would pass 6.5 m (long runs on flat land, a valley behind a
ridge), a small lift well takes the upstream flow. Manholes sit at junctions, turns over
30 deg, changes of grade, drops and 120 m spacing; dead ends stop at a plain pipe end, as most
do in the real network. Each manhole-to-manhole run is
graded on its own and arrives through a drop where it meets a deeper pipe. Each size draws
whole runs, so a larger size always contains the smaller one.

    .venv/bin/python tools/build_sim4_estates.py          writes estates.js
    .venv/bin/python tools/build_sim4_estates.py --check  compares without writing
"""
import heapq
import json
import math
import os
import random
import sys
import zlib
from collections import Counter, defaultdict

import numpy as np
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "simulation_src"))
from mga54 import to_mga54
from network import ContourSurface

RAW = os.path.join(ROOT, "simulation_src", "data", "raw")
PLAN = os.path.join(ROOT, "simulation_src", "results", "sim4", "greenfield", "plan.json")
OUT = os.path.join(ROOT, "simulation4", "data", "estates.js")
OSM = os.path.join(RAW, "osm_streets_ext.json")

MIN_GRADE = 0.005
MIN_DEPTH_M = 1.4
MAX_DEPTH_M = 6.5
MAX_RUN_M = 120.0
CHAMBER_TURN_DEG = 30.0
CLEARANCE_M = 40.0
SCREEN_M = CLEARANCE_M + 4.0
MAP_SEED = 42054


def load_geom():
    with open(os.path.join(ROOT, "simulation3", "data", "catchment.js"), encoding="utf-8") as f:
        text = f.read()
    return json.loads(text[text.index("=") + 1:].strip().rstrip(";"))


def sample(line, step=3.0):
    out = []
    for a, b in zip(line, line[1:]):
        n = max(1, math.ceil(math.dist(a, b) / step))
        out.extend((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n))
    return out + [tuple(line[-1])]


def rectangle(origin, along, across, a, b, c, d):
    return [(origin[0] + along[0] * x + across[0] * y, origin[1] + along[1] * x + across[1] * y)
            for x, y in ((a, c), (b, c), (b, d), (a, d))]


def house_outline(ring):
    """A house footprint inside its checked lot rectangle: plain, L-shaped, stepped or with a
    narrower rear wing, so the estate does not read as identical boxes. The outline never leaves
    the rectangle, so the spacing and street checks made on the rectangle still hold. The shape
    is seeded from the rectangle itself, so it does not change the rest of the layout."""
    p0, p1, p2, p3 = ring                      # front-left, front-right, back-right, back-left
    rng = random.Random(zlib.crc32(repr([(round(x, 1), round(y, 1)) for x, y in ring]).encode()))
    at = lambda u, v: (p0[0] + (p1[0] - p0[0]) * u + (p3[0] - p0[0]) * v,
                       p0[1] + (p1[1] - p0[1]) * u + (p3[1] - p0[1]) * v)
    front = rng.uniform(0.0, 0.12)             # a varied front setback inside the lot
    kind = rng.random()
    if kind < 0.25:
        uv = [(0, front), (1, front), (1, 1), (0, 1)]
    elif kind < 0.55:                           # L: one front corner left open (porch or yard)
        cu, cv = rng.uniform(0.3, 0.5), rng.uniform(front + 0.2, front + 0.4)
        uv = [(cu, front), (1, front), (1, 1), (0, 1), (0, cv), (cu, cv)]
        if rng.random() < 0.5:
            uv = [(1 - u, v) for u, v in reversed(uv)]
    elif kind < 0.8:                            # stepped: garage set forward on one side
        cu, cv = rng.uniform(0.35, 0.55), rng.uniform(front + 0.12, front + 0.25)
        uv = [(0, front), (cu, front), (cu, cv), (1, cv), (1, 1), (0, 1)]
        if rng.random() < 0.5:
            uv = [(1 - u, v) for u, v in reversed(uv)]
    else:                                       # narrower rear wing
        a, b, cv = rng.uniform(0.0, 0.2), rng.uniform(0.6, 0.85), rng.uniform(0.55, 0.75)
        uv = [(0, front), (1, front), (1, cv), (b, cv), (b, 1), (a, 1), (a, cv), (0, cv)]
    return [at(u, v) for u, v in uv]


def network_points(g):
    """10 m pipe samples and property points, in local metres."""
    xy = np.array([(n["x"] / 10, n["y"] / 10) for n in g["nodes"]])
    points = []
    for u, v in zip(g["up"], g["down"]):
        a, b = xy[u], xy[v]
        n = max(1, int(np.linalg.norm(b - a) / 10))
        points.extend(a + (b - a) * t for t in np.linspace(0, 1, n + 1))
    points.extend((x / 10, y / 10) for x, y in zip(g["hx"], g["hy"]))
    return np.asarray(points)


def _extract_faces(adj, node_xy, min_area=2000.0, max_area=450000.0):
    """CCW planar half-edge face walk returning vertex-index cycles."""
    work = {u: set(nbs) for u, nbs in adj.items() if nbs}
    q = [u for u, nbs in work.items() if len(nbs) <= 1]
    while q:
        u = q.pop()
        for v in list(work.get(u, ())):
            work[v].discard(u)
            if len(work[v]) <= 1:
                q.append(v)
        work.pop(u, None)
    half_edges = {}
    for u, nbs in work.items():
        if len(nbs) < 2:
            continue
        p0 = node_xy[u]
        nbs_s = sorted(nbs, key=lambda v: math.atan2(node_xy[v][1] - p0[1], node_xy[v][0] - p0[0]))
        for i, v in enumerate(nbs_s):
            half_edges[(v, u)] = nbs_s[(i - 1) % len(nbs_s)]
    seen, faces = set(), []
    for he in list(half_edges):
        if he in seen:
            continue
        face, cur, ok = [], he, True
        for _ in range(400):
            if cur in seen or cur not in half_edges:
                ok = False; break
            seen.add(cur); face.append(cur[0]); cur = (cur[1], half_edges[cur])
            if cur == he:
                break
        else:
            ok = False
        if ok and len(face) >= 3:
            pts = [node_xy[u] for u in face]
            area = _poly_signed_area(pts)
            if min_area < area < max_area:
                faces.append((face, area, pts))
    return faces


STATS = os.path.join(os.path.dirname(RAW), "street_stats.json")


def learn_osm_stats(ox, oy):
    """Street pattern statistics: measured from osm_streets_ext.json when present (and cached to
    street_stats.json), else read from that cache. The raw OSM extract is not committed."""
    if not os.path.exists(OSM):
        with open(STATS, encoding="utf-8") as f:
            return json.load(f)
    stats = _measure_osm_stats(ox, oy)
    with open(STATS, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=1)
    return stats


def _measure_osm_stats(ox, oy):
    with open(OSM, encoding="utf-8") as f:
        elements = json.load(f).get("elements", [])
    node_xy, adj, edge_hw = {}, defaultdict(set), {}
    keep_hw = {"residential", "unclassified", "tertiary", "secondary", "living_street"}
    for w in elements:
        hw = (w.get("tags") or {}).get("highway", "")
        nids, geom = w.get("nodes", []), w.get("geometry", [])
        if hw not in keep_hw or len(nids) != len(geom) or len(geom) < 2:
            continue
        for nid, pt in zip(nids, geom):
            if nid not in node_xy:
                ex, ny = to_mga54(pt["lon"], pt["lat"])
                node_xy[nid] = (ex - ox, ny - oy)
        for a, b in zip(nids, nids[1:]):
            if a != b:
                adj[a].add(b); adj[b].add(a); edge_hw[(min(a, b), max(a, b))] = hw
    juncs = {u for u, nb in adj.items() if len(nb) != 2}
    visited, res_segs, col_segs, cul_segs, col_turn_deg = set(), [], [], [], []
    for u in juncs:
        for v in adj[u]:
            e = (min(u, v), max(u, v))
            if e in visited:
                continue
            visited.add(e); path, curr, prev = [u, v], v, u
            while curr not in juncs:
                nbs = [x for x in adj[curr] if x != prev]
                if not nbs:
                    break
                nxt = nbs[0]
                visited.add((min(curr, nxt), max(curr, nxt)))
                path.append(nxt); prev, curr = curr, nxt
            L = sum(math.dist(node_xy[a], node_xy[b]) for a, b in zip(path, path[1:]))
            if L < 20:
                continue
            hw = edge_hw[(min(path[0], path[1]), max(path[0], path[1]))]
            if len(adj[path[0]]) == 1 or len(adj[path[-1]]) == 1:
                cul_segs.append(L)
            elif hw in ("secondary", "tertiary"):
                col_segs.append(L)
                for a, b, c in zip(path, path[1:], path[2:]):
                    d1 = (node_xy[b][0] - node_xy[a][0], node_xy[b][1] - node_xy[a][1])
                    d2 = (node_xy[c][0] - node_xy[b][0], node_xy[c][1] - node_xy[b][1])
                    n1, n2 = math.hypot(*d1), math.hypot(*d2)
                    if n1 > 5 and n2 > 5:
                        col_turn_deg.append(math.degrees(math.acos(max(-1.0, min(1.0, (d1[0]*d2[0] + d1[1]*d2[1]) / (n1*n2))))))
            else:
                res_segs.append(L)
    block_short, block_long = [], []
    for _, _, pts in _extract_faces(adj, node_xy, 2000.0, 200000.0):
        c = np.array(pts) - np.mean(pts, axis=0)
        _, _, vt = np.linalg.svd(c, full_matrices=False)
        dims = np.ptp(c @ vt.T, axis=0)
        if min(dims) > 35:
            block_short.append(float(min(dims))); block_long.append(float(max(dims)))
    deg = Counter(len(nb) for nb in adj.values())
    total_seg = max(1, len(res_segs) + len(col_segs) + len(cul_segs))
    return {
        "t_junc_share": deg[3] / max(1, deg[3] + deg[4]),
        "cul_share": len(cul_segs) / total_seg,
        "cul_len_p25": float(np.percentile(cul_segs, 25)) if cul_segs else 62.0,
        "cul_len_p75": float(np.percentile(cul_segs, 75)) if cul_segs else 140.0,
        "col_turn_std": float(np.percentile(col_turn_deg, 65)) if col_turn_deg else 5.5,
        "block_short_p25": float(np.percentile(block_short, 25)) if block_short else 95.0,
        "block_long_p50": float(np.percentile(block_long, 50)) if block_long else 210.0,
    }


def find_exit_points(g, plan, occupancy):
    """Find outer-edge exit points (eligible sites + perimeter pipe ends / manholes)."""
    xy = np.array([(n["x"] / 10, n["y"] / 10) for n in g["nodes"]])
    occ_kd = cKDTree(occupancy)
    nb = defaultdict(list)
    for u, v in zip(g["up"], g["down"]):
        nb[u].append(v); nb[v].append(u)
    # Connections are keyed by site id (the node name): four are pipe ends with no manhole id.
    nid_of = {n["name"]: i for i, n in enumerate(g["nodes"])}
    elig = {r["site_id"] for r in plan["eligible"]}
    exits = [{"nid": nid_of[r["site_id"]], "xy": tuple(map(float, xy[nid_of[r["site_id"]]])),
              "bearing_deg": float(r["open_bearing_deg"]), "sector_deg": float(r["open_sector_deg"]),
              "manhole_id": r["site_id"]} for r in plan["eligible"]]
    cands = []
    for i, n in enumerate(g["nodes"]):
        if n["name"] in elig:
            continue
        p = xy[i]
        fkd = cKDTree(occupancy[np.linalg.norm(occupancy - p, axis=1) > 25])
        open_degs = []
        for deg in range(0, 360, 10):
            v = np.array([math.sin(math.radians(deg)), math.cos(math.radians(deg))])
            if (fkd.query(p + np.outer(np.linspace(46, 230, 10), v))[0].min() >= SCREEN_M
                    and occ_kd.query(p + 46 * v)[0] >= SCREEN_M and occ_kd.query(p + 230 * v)[0] >= 80.0):
                open_degs.append(deg)
        if len(open_degs) >= 5:
            s, best = set(open_degs), []
            for a in open_degs:
                if (a - 10) % 360 not in s:
                    arc = [a]
                    while (arc[-1] + 10) % 360 in s and len(arc) < 36:
                        arc.append((arc[-1] + 10) % 360)
                    if len(arc) > len(best):
                        best = arc
            best = best or (open_degs if len(open_degs) == 36 else [])
            if len(best) >= 5:
                prio = 2 if len(nb[i]) == 1 else (1 if n.get("mh") is not None else 0)
                cands.append((prio, len(best) * 10, i, (float(p[0]), float(p[1])), (best[0] + 5.0 * (len(best) - 1)) % 360.0, n.get("mh")))
    for _, sec, nid, p, mid, mh in sorted(cands, key=lambda x: (-x[0], -x[1], x[2])):
        if all(math.dist(p, e["xy"]) >= 105.0 for e in exits):
            exits.append({"nid": nid, "xy": p, "bearing_deg": mid, "sector_deg": float(sec), "manhole_id": mh})
    return exits


def _seg_intersect(p1, p2, p3, p4):
    dx1, dy1 = p2[0] - p1[0], p2[1] - p1[1]
    dx2, dy2 = p4[0] - p3[0], p4[1] - p3[1]
    denom = dx1 * dy2 - dy1 * dx2
    if abs(denom) < 1e-9:
        return None
    dx3, dy3 = p3[0] - p1[0], p3[1] - p1[1]
    t = (dx3 * dy2 - dy3 * dx2) / denom
    s = (dx3 * dy1 - dy3 * dx1) / denom
    if 1e-5 < t < 1.0 - 1e-5 and -1e-5 <= s <= 1.0 + 1e-5:
        return t, max(0.0, min(1.0, s)), p1[0] + t * dx1, p1[1] + t * dy1
    return None


def _pt_seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    if l2 < 1e-9:
        return math.dist(p, a), 0.0
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), t


def _poly_signed_area(pts):
    n = len(pts)
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))


def _point_in_poly(p, poly):
    x, y = p
    inside = False
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1):
            inside = not inside
    return inside


def _sat_overlap(a, b, pad=1.0):
    for poly in (a, b):
        for k in range(2):
            ex, ey = poly[k + 1][0] - poly[k][0], poly[k + 1][1] - poly[k][1]
            en = math.hypot(ex, ey)
            if en < 1e-9:
                continue
            ax, ay = ex / en, ey / en
            pa = [p[0] * ax + p[1] * ay for p in a]
            pb = [p[0] * ax + p[1] * ay for p in b]
            if max(pa) + pad < min(pb) or max(pb) + pad < min(pa):
                return False
    return True


class StreetMap:
    """Planar surrounding street graph kept >= SCREEN_M from existing network occupancy."""

    def __init__(self, occupancy, bounds):
        self.occ = occupancy
        self.occ_kd = cKDTree(occupancy)
        self.bounds = bounds
        self.nodes = []
        self.edges = {}
        self.adj = defaultdict(set)
        self.exit_links = []

    def in_open_land(self, p, max_band=1250.0):
        xmin, xmax, ymin, ymax = self.bounds
        return xmin <= p[0] <= xmax and ymin <= p[1] <= ymax and SCREEN_M <= float(self.occ_kd.query(p)[0]) <= max_band

    def seg_clear(self, a, b, max_band=1250.0):
        pts = sample([a, b], 8.0)
        xmin, xmax, ymin, ymax = self.bounds
        if any(not (xmin <= x <= xmax and ymin <= y <= ymax) for x, y in pts):
            return False
        ds = self.occ_kd.query(pts)[0]
        return float(ds.min()) >= SCREEN_M and float(ds.max()) <= max_band

    def add_node(self, p):
        self.nodes.append((float(p[0]), float(p[1])))
        return len(self.nodes) - 1

    def _add_edge_raw(self, u, v, kind):
        if u != v:
            self.edges[(min(u, v), max(u, v))] = kind
            self.adj[u].add(v); self.adj[v].add(u)

    def _del_edge_raw(self, u, v):
        self.edges.pop((min(u, v), max(u, v)), None)
        self.adj[u].discard(v); self.adj[v].discard(u)

    def _angle_ok(self, u, target_pt, min_deg=24.0):
        pu = self.nodes[u]
        vx, vy = target_pt[0] - pu[0], target_pt[1] - pu[1]
        nv = math.hypot(vx, vy)
        if nv < 1e-6:
            return False
        for w in self.adj[u]:
            pw = self.nodes[w]
            wx, wy = pw[0] - pu[0], pw[1] - pu[1]
            nw = math.hypot(wx, wy)
            if nw > 1e-6 and math.degrees(math.acos(max(-1.0, min(1.0, (vx * wx + vy * wy) / (nv * nw))))) < min_deg:
                return False
        return True

    def connect(self, u, target, kind, allow_split=True, snap_r=22.0, min_len=14.0, max_band=1250.0):
        target_nid = target if isinstance(target, int) else None
        p0 = self.nodes[u]
        p1 = self.nodes[target_nid] if target_nid is not None else (float(target[0]), float(target[1]))
        if math.dist(p0, p1) < min_len:
            return None, False
        best_t, best_hit = 1.0, None
        minx, maxx = min(p0[0], p1[0]) - snap_r, max(p0[0], p1[0]) + snap_r
        miny, maxy = min(p0[1], p1[1]) - snap_r, max(p0[1], p1[1]) + snap_r
        for a, b in list(self.edges):
            if u in (a, b):
                continue
            pa, pb = self.nodes[a], self.nodes[b]
            if max(pa[0], pb[0]) < minx or min(pa[0], pb[0]) > maxx or max(pa[1], pb[1]) < miny or min(pa[1], pb[1]) > maxy:
                continue
            hit = _seg_intersect(p0, p1, pa, pb)
            if hit is not None and hit[0] < best_t:
                best_t, best_hit = hit[0], ("edge", (a, b), hit[2], hit[3])
        for w, pw in enumerate(self.nodes):
            if w == u:
                continue
            d, t = _pt_seg_dist(pw, p0, p1)
            if d < snap_r and 0.05 < t < best_t + 0.08 and math.dist(p0, pw) >= min_len:
                if best_hit is None or t <= best_t or (best_hit[0] == "edge" and math.dist((best_hit[2], best_hit[3]), pw) < snap_r):
                    best_t, best_hit = t, ("node", w)
        if best_hit is not None:
            if not allow_split and best_hit[0] == "edge":
                return None, False
            if best_hit[0] == "node":
                w = best_hit[1]
                if w in self.adj[u]:
                    return w, True
                pw = self.nodes[w]
                if not self.seg_clear(p0, pw, max_band) or not self._angle_ok(u, pw) or not self._angle_ok(w, p0):
                    return None, False
                if any(u not in (a, b) and w not in (a, b) and _seg_intersect(p0, pw, self.nodes[a], self.nodes[b]) is not None
                       for a, b in self.edges):
                    return None, False
                self._add_edge_raw(u, w, kind); return w, True
            (a, b), ix, iy = best_hit[1], best_hit[2], best_hit[3]
            ip = (ix, iy)
            if math.dist(ip, self.nodes[a]) < 16.0:
                return self.connect(u, a, kind, allow_split=allow_split, snap_r=snap_r, min_len=min_len, max_band=max_band)
            if math.dist(ip, self.nodes[b]) < 16.0:
                return self.connect(u, b, kind, allow_split=allow_split, snap_r=snap_r, min_len=min_len, max_band=max_band)
            if math.dist(p0, ip) < min_len or not self.seg_clear(p0, ip, max_band) or not self._angle_ok(u, ip):
                return None, False
            for end_p in (self.nodes[a], self.nodes[b]):
                dx1, dy1, dx2, dy2 = p0[0] - ix, p0[1] - iy, end_p[0] - ix, end_p[1] - iy
                n1, n2 = math.hypot(dx1, dy1), math.hypot(dx2, dy2)
                if n1 > 1e-6 and n2 > 1e-6 and math.degrees(math.acos(max(-1.0, min(1.0, (dx1*dx2 + dy1*dy2) / (n1*n2))))) < 24.0:
                    return None, False
            old_kind = self.edges[(min(a, b), max(a, b))]
            self._del_edge_raw(a, b); m = self.add_node(ip)
            self._add_edge_raw(a, m, old_kind); self._add_edge_raw(m, b, old_kind); self._add_edge_raw(u, m, kind)
            return m, True
        if not self.seg_clear(p0, p1, max_band) or not self._angle_ok(u, p1):
            return None, False
        if target_nid is not None:
            if target_nid in self.adj[u] or not self._angle_ok(target_nid, p0):
                return None, False
            self._add_edge_raw(u, target_nid, kind); return target_nid, False
        v = self.add_node(p1); self._add_edge_raw(u, v, kind)
        return v, False

    def extract_blocks(self, net_centroid, max_area=450000.0):
        out = []
        for face, _, pts in _extract_faces(self.adj, self.nodes, 2500.0, max_area):
            if _point_in_poly(net_centroid, pts):
                continue
            cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
            if float(self.occ_kd.query((cx, cy))[0]) >= SCREEN_M:
                out.append(face)
        return out

    def edge_chains(self, edge_filter=None):
        """Merge degree-2 chains into node-id paths, plus adjacency map."""
        adj = defaultdict(set)
        for u, v in self.edges:
            if edge_filter is None or (u, v) in edge_filter:
                adj[u].add(v); adj[v].add(u)
        juncs = {u for u, nbs in adj.items() if len(nbs) != 2}
        visited, chains = set(), []
        def walk(u, v, stop_junc=True):
            visited.add((min(u, v), max(u, v)))
            path, cur, prev = [u, v], v, u
            while not stop_junc or cur not in juncs:
                nbs = [x for x in adj[cur] if x != prev]
                if not nbs:
                    break
                nxt = nbs[0]; ne = (min(cur, nxt), max(cur, nxt))
                if stop_junc and ne in visited:
                    break
                path.append(nxt); visited.add(ne)
                if not stop_junc and nxt == u:
                    break
                prev, cur = cur, nxt
            chains.append(path)
        for u in sorted(juncs):
            for v in sorted(adj[u]):
                if (min(u, v), max(u, v)) not in visited:
                    walk(u, v, True)
        for u, v in sorted(self.edges):
            if (edge_filter is None or (u, v) in edge_filter) and (u, v) not in visited:
                walk(u, v, False)
        return chains, adj

    def to_polylines(self, edge_filter=None, include_exits=False):
        chains, _ = self.edge_chains(edge_filter)
        lines = [[self.nodes[k] for k in p] for p in chains]
        if include_exits:
            lines.extend([site_xy, self.nodes[nid]] for site_xy, nid, _ in self.exit_links)
        return lines


def generate_street_map(g, exits, occupancy, stats, ground, seed=MAP_SEED):
    """Generate one seeded imaginary surrounding street network in open land around the network."""
    rng = random.Random(seed)
    net_pts = np.array([(n["x"] / 10, n["y"] / 10) for n in g["nodes"]])
    net_centroid = (float(net_pts[:, 0].mean()), float(net_pts[:, 1].mean()))
    smap = StreetMap(occupancy, (-1350.0, 5350.0, -1650.0, 4000.0))

    # 1. Place entry nodes ~46 m outside each exit point
    exit_entries = []
    for ex in exits:
        b = math.radians(ex["bearing_deg"])
        v = (math.sin(b), math.cos(b))
        entry_xy = next(((ex["xy"][0] + d * v[0], ex["xy"][1] + d * v[1])
                         for d in (46.0, 49.0, 52.0, 44.5)
                         if smap.in_open_land((ex["xy"][0] + d * v[0], ex["xy"][1] + d * v[1]))), None)
        if entry_xy is None and isinstance(ex["manhole_id"], str):
            # A connection must get an entry: widen the search around its open bearing.
            entry_xy = next(((ex["xy"][0] + d * math.sin(b + math.radians(t)), ex["xy"][1] + d * math.cos(b + math.radians(t)))
                             for d in range(40, 161, 6) for t in (0, -10, 10, -20, 20, -30, 30, -45, 45)
                             if smap.in_open_land((ex["xy"][0] + d * math.sin(b + math.radians(t)),
                                                   ex["xy"][1] + d * math.cos(b + math.radians(t))))), None)
        if entry_xy is None or any(math.dist(entry_xy, smap.nodes[nid]) < 30.0 for _, nid, _ in smap.exit_links):
            continue
        nid = smap.add_node(entry_xy)
        smap.exit_links.append((ex["xy"], nid, ex["manhole_id"]))
        exit_entries.append((nid, ex["bearing_deg"]))

    # 2. Grow collectors outward from each exit point with gentle curvature
    col_chains = []
    turn_std = max(3.0, min(7.0, stats["col_turn_std"]))
    def grow_collector(start_nid, brg_deg):
        chain, cur = [start_nid], start_nid
        ang = init_ang = math.radians(brg_deg)
        drift = 0.0
        for step in range(25):
            p = smap.nodes[cur]
            d_occ, idx = smap.occ_kd.query(p)
            if d_occ > 1140.0 and step >= 3:
                break
            drift = 0.6 * drift + rng.gauss(0.0, math.radians(turn_std))
            ang += max(-math.radians(9), min(math.radians(9), drift))
            diff = (ang - init_ang + math.pi) % (2 * math.pi) - math.pi
            if abs(diff) > math.radians(45):
                ang = init_ang + math.copysign(math.radians(45), diff)
            near = occupancy[int(idx)]
            odx, ody = p[0] - near[0], p[1] - near[1]
            on = math.hypot(odx, ody)
            if on > 1e-6 and d_occ < 180.0 and (math.sin(ang) * odx + math.cos(ang) * ody) / on < 0.25:
                ang = math.atan2(0.5 * math.sin(ang) + 0.5 * odx / on, 0.5 * math.cos(ang) + 0.5 * ody / on)
            step_len = rng.uniform(44.0, 56.0)
            nxt_nid = None
            for alt in (0, 18, -18, 36, -36):
                a2 = ang + math.radians(alt)
                cand = (p[0] + step_len * math.sin(a2), p[1] + step_len * math.cos(a2))
                nxt_nid, hit = smap.connect(cur, cand, "collector", allow_split=True, snap_r=24.0)
                if nxt_nid is not None:
                    ang = a2
                    break
            if nxt_nid is None:
                break
            chain.append(nxt_nid); cur = nxt_nid
            if hit:
                break
        return chain

    for start_nid, brg_deg in exit_entries:
        col_chains.append(grow_collector(start_nid, brg_deg))

    # 3. Link neighbouring collectors with ring/cross streets at distance bands
    def link_band(u, v, target_r):
        pu, pv = smap.nodes[u], smap.nodes[v]
        n_steps = max(1, math.ceil(math.dist(pu, pv) / 60.0))
        cur, created = u, []
        for k in range(1, n_steps):
            t = k / n_steps
            pt = [pu[0] + (pv[0] - pu[0]) * t, pu[1] + (pv[1] - pu[1]) * t]
            d_occ, idx = smap.occ_kd.query(pt)
            if d_occ < max(52.0, target_r - 35.0):
                near = occupancy[int(idx)]
                dx, dy = pt[0] - near[0], pt[1] - near[1]
                dn = max(1e-6, math.hypot(dx, dy))
                push = min(90.0, max(56.0, target_r - 15.0) - d_occ)
                pt[0] += dx / dn * push; pt[1] += dy / dn * push
            nxt, _ = smap.connect(cur, tuple(pt), "ring", allow_split=True, snap_r=22.0)
            if nxt is None:
                near = occupancy[int(smap.occ_kd.query(pt)[1])]
                dx, dy = pt[0] - near[0], pt[1] - near[1]
                dn = max(1e-6, math.hypot(dx, dy))
                nxt, _ = smap.connect(cur, (pt[0] + 30 * dx / dn, pt[1] + 30 * dy / dn), "ring", allow_split=True, snap_r=22.0)
            if nxt is None:
                return created
            created.append(nxt); cur = nxt
            if nxt == v:
                return created
        if smap.connect(cur, v, "ring", allow_split=True, snap_r=28.0)[0] is None:
            for vn in list(smap.adj[v]):
                if smap.connect(cur, vn, "ring", allow_split=True, snap_r=24.0)[0] is not None:
                    break
        return created

    ang_of = lambda nid: math.atan2(smap.nodes[nid][1] - net_centroid[1], smap.nodes[nid][0] - net_centroid[0])
    inner_nodes = sorted((ang_of(min(c, key=lambda n: abs(float(smap.occ_kd.query(smap.nodes[n])[0]) - 145.0))),
                          min(c, key=lambda n: abs(float(smap.occ_kd.query(smap.nodes[n])[0]) - 145.0)))
                         for c in col_chains)
    for i in range(len(inner_nodes)):
        u, v = inner_nodes[i][1], inner_nodes[(i + 1) % len(inner_nodes)][1]
        span_d = math.dist(smap.nodes[u], smap.nodes[v])
        if u != v and 55.0 <= span_d <= 1600.0:
            ring_pts = link_band(u, v, 145.0)
            if span_d > 340.0 and len(ring_pts) >= 4:
                n_extra = max(1, int(span_d // 260.0) - 1)
                for j in range(1, n_extra + 1):
                    mp = smap.nodes[ring_pts[int(j * len(ring_pts) / (n_extra + 1))]]
                    near = occupancy[int(smap.occ_kd.query(mp)[1])]
                    col_chains.append(grow_collector(ring_pts[int(j * len(ring_pts) / (n_extra + 1))],
                                                     math.degrees(math.atan2(mp[0] - near[0], mp[1] - near[1]))))

    for R in [55.0, 270.0, 410.0, 560.0, 720.0, 890.0, 1080.0]:
        bn = sorted((ang_of(n), n) for c in col_chains
                    for n in [min(c, key=lambda k: abs(float(smap.occ_kd.query(smap.nodes[k])[0]) - R))]
                    if abs(float(smap.occ_kd.query(smap.nodes[n])[0]) - R) <= 110.0)
        for i in range(len(bn)):
            u, v = bn[i][1], bn[(i + 1) % len(bn)][1]
            if u != v and 55.0 <= math.dist(smap.nodes[u], smap.nodes[v]) <= 1500.0:
                link_band(u, v, R)

    tips = sorted((ang_of(c[-1]), c[-1]) for c in col_chains if float(smap.occ_kd.query(smap.nodes[c[-1]])[0]) >= 500.0)
    for i in range(len(tips)):
        u, v = tips[i][1], tips[(i + 1) % len(tips)][1]
        if u != v and 60.0 <= math.dist(smap.nodes[u], smap.nodes[v]) <= 1500.0:
            link_band(u, v, 1050.0)

    # 4. Subdivide macro-blocks into local suburban blocks using learned OSM statistics
    t_share, cul_share = stats["t_junc_share"], min(0.16, stats["cul_share"])
    for _ in range(14):
        blocks = smap.extract_blocks(net_centroid, max_area=3000000.0)
        did_split = False
        for face in blocks:
            if any((min(face[k], face[(k + 1) % len(face)]), max(face[k], face[(k + 1) % len(face)])) not in smap.edges
                   for k in range(len(face))):
                continue
            pts = np.array([smap.nodes[u] for u in face])
            area = _poly_signed_area(pts)
            c = pts.mean(axis=0)
            _, _, vt = np.linalg.svd(pts - c, full_matrices=False)
            proj = (pts - c) @ vt.T
            u_span, v_span = float(np.ptp(proj[:, 0])), float(np.ptp(proj[:, 1]))
            if v_span < 132.0 and u_span < 175.0 and area < 19000.0:
                continue
            split_u = (u_span >= 175.0 and u_span > 1.25 * v_span) or (v_span < 132.0)
            ax, perp = (vt[0], vt[1]) if split_u else (vt[1], vt[0])
            span = u_span if split_u else v_span
            s_mid = float((proj[:, 0] if split_u else proj[:, 1]).min()) + span * rng.uniform(0.42, 0.58)

            def find_chord(s_val):
                hits = []
                for idx_e in range(len(face)):
                    a_id, b_id = face[idx_e], face[(idx_e + 1) % len(face)]
                    pa, pb = smap.nodes[a_id], smap.nodes[b_id]
                    sa, sb = float(np.dot(np.array(pa) - c, ax)), float(np.dot(np.array(pb) - c, ax))
                    if (sa - s_val) * (sb - s_val) <= 0 and abs(sb - sa) > 1e-6:
                        t = (s_val - sa) / (sb - sa)
                        ip = (pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1]))
                        near_j = ((t * math.dist(pa, pb) < 20.0 and len(smap.adj[a_id]) >= 3) or
                                  ((1 - t) * math.dist(pa, pb) < 20.0 and len(smap.adj[b_id]) >= 3))
                        hits.append((float(np.dot(np.array(ip) - c, perp)), ip, near_j))
                return sorted(hits, key=lambda x: x[0])

            hits = find_chord(s_mid)
            if len(hits) < 2:
                continue
            if (hits[0][2] or hits[-1][2]) and rng.random() < t_share and span > 130.0:
                hits2 = find_chord(s_mid + rng.choice((-1, 1)) * rng.uniform(22.0, min(36.0, 0.18 * span)))
                if len(hits2) >= 2:
                    hits = hits2
            p_a, p_b = hits[0][1], hits[-1][1]
            chord = math.dist(p_a, p_b)
            if chord < 65.0:
                continue

            best_e = min(((face[k], face[(k + 1) % len(face)]) for k in range(len(face))),
                         key=lambda e: _pt_seg_dist(p_a, smap.nodes[e[0]], smap.nodes[e[1]])[0])
            u, v = best_e
            _, t = _pt_seg_dist(p_a, smap.nodes[u], smap.nodes[v])
            best_p = (smap.nodes[u][0] + t * (smap.nodes[v][0] - smap.nodes[u][0]),
                      smap.nodes[u][1] + t * (smap.nodes[v][1] - smap.nodes[u][1]))
            if math.dist(best_p, smap.nodes[u]) < 16.0:
                n_a = u
            elif math.dist(best_p, smap.nodes[v]) < 16.0:
                n_a = v
            else:
                okind = smap.edges[(min(u, v), max(u, v))]
                smap._del_edge_raw(u, v)
                n_a = smap.add_node(best_p)
                smap._add_edge_raw(u, n_a, okind); smap._add_edge_raw(n_a, v, okind)

            pa_act = smap.nodes[n_a]
            if 115.0 <= chord <= 185.0 and area < 35000.0 and rng.random() < cul_share:
                cul_len = min(chord - 52.0, rng.uniform(stats["cul_len_p25"], min(105.0, stats["cul_len_p75"])))
                if cul_len >= 48.0:
                    dx, dy = (p_b[0] - pa_act[0]) / math.dist(pa_act, p_b), (p_b[1] - pa_act[1]) / math.dist(pa_act, p_b)
                    tip = (pa_act[0] + cul_len * dx, pa_act[1] + cul_len * dy)
                    gz_pair = ground([pa_act, tip])
                    if float(gz_pair[1]) >= float(gz_pair[0]) - 3.0:
                        if smap.connect(n_a, tip, "cul", allow_split=False, snap_r=20.0)[0] is not None:
                            did_split = True
                        continue
            if smap.connect(n_a, p_b, "local", allow_split=True, snap_r=22.0)[0] is not None:
                did_split = True
        if not did_split:
            break
    return smap, net_centroid


def _place_houses_on_edges(smap, selected_edges, occ_kd, rng, need):
    """Place 14-18 m lots and 10-14 x 14-20 m houses set back 6 m along both sides of streets."""
    grid = defaultdict(list)
    box_of = lambda r: (min(p[0] for p in r), max(p[0] for p in r), min(p[1] for p in r), max(p[1] for p in r))

    def overlaps_house(r):
        x0, x1, y0, y1 = box_of(r)
        for ix in range(int(x0 // 25) - 1, int(x1 // 25) + 2):
            for iy in range(int(y0 // 25) - 1, int(y1 // 25) + 2):
                for ox0, ox1, oy0, oy1, oring in grid[(ix, iy)]:
                    if not (ox1 + 1.2 < x0 or x1 + 1.2 < ox0 or oy1 + 1.2 < y0 or y1 + 1.2 < oy0):
                        if _sat_overlap(r, oring, pad=1.0):
                            return True
        return False

    edge_list = [(smap.nodes[u], smap.nodes[v]) for u, v in selected_edges]

    def clear_of_streets(r):
        pts = sample(r + r[:1], 4.0)
        if float(occ_kd.query(pts)[0].min()) < SCREEN_M:
            return False
        x0, x1, y0, y1 = box_of(r)
        for pa, pb in edge_list:
            if max(pa[0], pb[0]) < x0 - 10.0 or min(pa[0], pb[0]) > x1 + 10.0:
                continue
            if max(pa[1], pb[1]) < y0 - 10.0 or min(pa[1], pb[1]) > y1 + 10.0:
                continue
            for p in pts:
                if _pt_seg_dist(p, pa, pb)[0] < 8.8:
                    return False
        return True

    chains, sel_adj = smap.edge_chains(selected_edges)
    houses = []
    for path in chains:
        cum = [0.0]
        for a, b in zip(path, path[1:]):
            cum.append(cum[-1] + math.dist(smap.nodes[a], smap.nodes[b]))
        start_pad = 9.0 if len(sel_adj[path[0]]) >= 3 else 2.0
        end_pad = 9.0 if len(sel_adj[path[-1]]) >= 3 else 2.0
        usable = cum[-1] - start_pad - end_pad
        if usable < 14.0:
            continue
        n_lots = max(1, int(usable // rng.uniform(14.0, 15.6)))
        step = usable / n_lots
        for k in range(n_lots):
            s = start_pad + (k + 0.5) * step
            si = next(i for i in range(len(path) - 1) if cum[i + 1] >= s - 1e-6)
            a, b = path[si], path[si + 1]
            pa, pb = smap.nodes[a], smap.nodes[b]
            seg_l = max(1e-6, cum[si + 1] - cum[si])
            frac = (s - cum[si]) / seg_l
            cx, cy = pa[0] + frac * (pb[0] - pa[0]), pa[1] + frac * (pb[1] - pa[1])
            along = ((pb[0] - pa[0]) / seg_l, (pb[1] - pa[1]) / seg_l)
            across = (along[1], -along[0])
            conn_nid = a if frac < 0.5 else b
            for bank in (-1, 1):
                w = rng.uniform(10.0, min(13.6, step - 1.3))
                d = rng.uniform(14.0, 16.8)
                ring = rectangle((cx, cy), along, (bank * across[0], bank * across[1]),
                                 -w * 0.5, w * 0.5, 12.0, 12.0 + d)
                if overlaps_house(ring) or not clear_of_streets(ring):
                    ring = rectangle((cx, cy), along, (bank * across[0], bank * across[1]),
                                     -5.1, 5.1, 12.0, 26.2)
                if not overlaps_house(ring) and clear_of_streets(ring):
                    x0, x1, y0, y1 = box_of(ring)
                    item = (x0, x1, y0, y1, ring)
                    for ix in range(int(x0 // 25), int(x1 // 25) + 1):
                        for iy in range(int(y0 // 25), int(y1 // 25) + 1):
                            grid[(ix, iy)].append(item)
                    houses.append((ring, conn_nid))
                    if len(houses) >= need * 1.1:
                        return houses
    return houses


def _precompute_edge_samples(smap, ground, max_seg=25.0):
    """Pre-sample 25 m points along every smap edge and evaluate ground in one batch."""
    edge_chains, query_pts = {}, []
    for u, v in smap.edges:
        pu, pv = smap.nodes[u], smap.nodes[v]
        pieces = max(1, math.ceil(math.dist(pu, pv) / max_seg))
        pts = [(pu[0] + (pv[0] - pu[0]) * k / pieces, pu[1] + (pv[1] - pu[1]) * k / pieces) for k in range(1, pieces)]
        edge_chains[(u, v)] = (len(query_pts), len(pts), pts)
        query_pts.extend(pts)
    gzs = [float(z) for z in ground(query_pts)] if query_pts else []
    return {e: list(zip(pts, gzs[i:i + n])) for e, (i, n, pts) in edge_chains.items()}


def _est_cut_depth(smap, edges, node_gz, edge_samples):
    """Fast minimax cut depth on 25 m-sampled street graph."""
    adj, xy, tg, next_id = defaultdict(list), {}, {}, len(node_gz)
    for u, v in edges:
        if u not in xy:
            xy[u], tg[u] = smap.nodes[u], node_gz[u]
        if v not in xy:
            xy[v], tg[v] = smap.nodes[v], node_gz[v]
        prev = u
        for pt, gz in edge_samples.get((min(u, v), max(u, v)), ()):
            nid = next_id; next_id += 1; xy[nid], tg[nid] = pt, gz
            d = math.dist(xy[prev], pt)
            adj[prev].append((nid, d)); adj[nid].append((prev, d)); prev = nid
        L = math.dist(xy[prev], xy[v])
        adj[prev].append((v, L)); adj[v].append((prev, L))
    root = min(xy, key=lambda u: tg[u])
    best, pq, worst = {root: (tg[root], 0.0)}, [(tg[root], 0.0, root)], MIN_DEPTH_M
    while pq:
        pk, d, v = heapq.heappop(pq)
        if (pk, d) > best[v]:
            continue
        worst = max(worst, MIN_DEPTH_M + pk - (tg[v] - MIN_GRADE * d))
        for u, elen in adj[v]:
            nd = d + elen
            cand = (max(pk, tg[u] - MIN_GRADE * nd), nd)
            if cand < best.get(u, (1e18, 1e18)):
                best[u] = cand; heapq.heappush(pq, (cand[0], cand[1], u))
    return worst


def select_estate_blocks(smap, entry_nid, site_xy, need, node_gz, edge_samples, rng, taken=frozenset()):
    """Select contiguous blocks nearest by street distance to entry_nid, keeping sewer depth <= ~6 m.

    Blocks with a street already used by another estate (taken) are skipped, and no houses are
    placed on taken streets, so estates never draw on top of each other."""
    blocks = smap.extract_blocks(site_xy)
    dist, prev_n, pq = {entry_nid: 0.0}, {entry_nid: None}, [(0.0, entry_nid)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v in smap.adj[u]:
            nd = d + math.dist(smap.nodes[u], smap.nodes[v])
            if nd < dist.get(v, 1e18):
                dist[v] = nd; prev_n[v] = u; heapq.heappush(pq, (nd, v))

    block_info, edge_to_blocks = [], defaultdict(list)
    for face in blocks:
        if any(u not in dist for u in face):
            continue
        if any((min(face[i], face[(i + 1) % len(face)]), max(face[i], face[(i + 1) % len(face)])) in taken for i in range(len(face))):
            continue
        f_edges = [(min(face[i], face[(i + 1) % len(face)]), max(face[i], face[(i + 1) % len(face)])) for i in range(len(face))]
        pts = [smap.nodes[u] for u in face]
        cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        gzs = [node_gz[u] for u in face] + [gz for e in f_edges for _, gz in edge_samples.get(e, ())]
        block_info.append({"face": face, "edges": f_edges, "centroid": (cx, cy),
                           "score": 0.65 * min(dist[u] for u in face) + 0.35 * math.dist((cx, cy), smap.nodes[entry_nid]),
                           "relief": max(gzs) - min(gzs)})
        for e in f_edges:
            edge_to_blocks[e].append(len(block_info) - 1)
    if not block_info:
        return set(), []

    cul_spurs = defaultdict(list)
    for (u, v), kind in smap.edges.items():
        if kind == "cul":
            cul_spurs[u].append((u, v)); cul_spurs[v].append((u, v))

    def bridge_edges_for(target_nodes):
        cur, be = min(target_nodes, key=lambda u: dist[u]), set()
        while cur != entry_nid and prev_n.get(cur) is not None:
            p = prev_n[cur]; be.add((min(cur, p), max(cur, p))); cur = p
        return be

    near_cands = sorted(range(len(block_info)), key=lambda i: block_info[i]["score"])[:16]
    def start_key(i):
        cd = _est_cut_depth(smap, set(block_info[i]["edges"]) | bridge_edges_for(block_info[i]["face"]), node_gz, edge_samples)
        return (0 if cd <= 3.8 else (1 if cd <= 5.5 else 2), 0 if block_info[i]["relief"] <= 5.0 else 1, block_info[i]["score"])
    start_b = min(near_cands, key=start_key)
    chosen, deferred = {start_b}, set()
    sel_edges = set(block_info[start_b]["edges"]) | bridge_edges_for(block_info[start_b]["face"])
    sel_nodes = {u for e in sel_edges for u in e}

    def bridge_to(target_nodes):
        cur = min(target_nodes, key=lambda u: dist[u])
        added = [cur]
        while cur not in sel_nodes and prev_n.get(cur) is not None:
            p = prev_n[cur]; sel_edges.add((min(cur, p), max(cur, p))); added.append(p); cur = p
        sel_nodes.update(added)

    frontier = {nb_b for e in sel_edges for nb_b in edge_to_blocks[e] if nb_b not in chosen}
    est_houses, next_check_len = [], max(140.0, need * 10.0)

    def add_block(bi):
        chosen.add(bi)
        for e in block_info[bi]["edges"]:
            sel_edges.add(e)
            for nb_b in edge_to_blocks[e]:
                if nb_b not in chosen and nb_b not in deferred:
                    frontier.add(nb_b)
        sel_nodes.update(block_info[bi]["face"])

    while True:
        full_edges = set(sel_edges)
        cur_min_gz = min(node_gz[u] for u in sel_nodes)
        for u in list(sel_nodes):
            for a, b in cul_spurs.get(u, ()):
                e = (min(a, b), max(a, b))
                egzs = [node_gz[a], node_gz[b]] + [gz for _, gz in edge_samples.get(e, ())]
                if min(egzs) >= cur_min_gz - 3.0 and _est_cut_depth(smap, full_edges | {e}, node_gz, edge_samples) <= 5.7:
                    full_edges.add(e)
        street_len = sum(math.dist(smap.nodes[a], smap.nodes[b]) for a, b in full_edges)
        avail = [i for i in range(len(block_info)) if i not in chosen and i not in deferred]
        if street_len >= next_check_len or not avail:
            est_houses = _place_houses_on_edges(smap, full_edges - taken, smap.occ_kd, random.Random(rng.randint(0, 10**9)), need)
            if len(est_houses) >= need or (not avail and not deferred):
                sel_edges = full_edges
                break
            if not avail and deferred:
                frontier.update(i for i in deferred if any(nb in chosen for e in block_info[i]["edges"] for nb in edge_to_blocks[e]))
                deferred.clear(); continue
            next_check_len = street_len + max(160.0, (need - len(est_houses)) * 10.0)
        if not frontier:
            def_front = [i for i in deferred if any(nb in chosen for e in block_info[i]["edges"] for nb in edge_to_blocks[e])] if deferred else []
            if def_front:
                nxt = min(def_front, key=lambda i: (_est_cut_depth(smap, sel_edges | set(block_info[i]["edges"]), node_gz, edge_samples),
                                                    block_info[i]["score"]))
                deferred.discard(nxt); add_block(nxt); continue
            nxt = min(avail, key=lambda i: block_info[i]["score"])
            bridge_to(block_info[nxt]["face"])
        else:
            ccx = sum(block_info[i]["centroid"][0] for i in chosen) / len(chosen)
            ccy = sum(block_info[i]["centroid"][1] for i in chosen) / len(chosen)
            nxt = min(frontier, key=lambda i: 0.45 * block_info[i]["score"] + 0.55 * math.dist(block_info[i]["centroid"], (ccx, ccy)))
            frontier.discard(nxt)
            if _est_cut_depth(smap, sel_edges | set(block_info[nxt]["edges"]), node_gz, edge_samples) > 5.7:
                deferred.add(nxt); continue
        add_block(nxt)

    return sel_edges, est_houses[:need]


def chamber_design(down, xy, ground, covers, outlet, point_levels, fixed_root=None, extra_chambers=()):
    """Split a downstream tree into chamber runs and grade each run in plan distance."""
    down, xy, ground, covers = dict(down), dict(xy), dict(ground), dict(covers)
    new_id = min(0, *down, *xy) - 1
    for u, d in list(down.items()):
        if d is None:
            continue
        length = math.dist(xy[u], xy[d])
        pieces = max(1, math.ceil(length / MAX_RUN_M))
        prev = u
        for k in range(1, pieces):
            v = new_id; new_id -= 1
            xy[v] = tuple(a + (b - a) * k / pieces for a, b in zip(xy[u], xy[d]))
            ground[v], covers[v] = point_levels(xy[v])
            down[prev] = v; prev = v
        down[prev] = d
    kids = defaultdict(list)
    for u, d in down.items():
        if d is not None:
            kids[d].append(u)
    root = next(u for u, d in down.items() if d is None)
    seq = [root]
    for u in seq:
        seq.extend(kids[u])
    chambers = {u for u in down if len(kids[u]) != 1 or down[u] is None} | {outlet} | (set(extra_chambers) & set(down))
    for u in down:
        if len(kids[u]) == 1 and down[u] is not None:
            a, b, c = xy[kids[u][0]], xy[u], xy[down[u]]
            ab, bc = math.dist(a, b), math.dist(b, c)
            if ab and bc:
                cosine = sum((b[i] - a[i]) * (c[i] - b[i]) for i in (0, 1)) / (ab * bc)
                if math.degrees(math.acos(max(-1.0, min(1.0, cosine)))) > CHAMBER_TURN_DEG:
                    chambers.add(u)
    mandatory = set(chambers)
    for start in reversed(seq):
        if start not in mandatory or down[start] is None:
            continue
        path = [start]
        while down[path[-1]] not in mandatory:
            path.append(down[path[-1]])
        path.append(down[path[-1]])
        length = 0.0
        for u, v in zip(path[::-1], path[-2::-1]):
            edge_m = math.dist(xy[u], xy[v])
            if length + edge_m > MAX_RUN_M + 1e-8:
                chambers.add(u); length = 0.0
            length += edge_m
    runs = []
    for u in reversed(seq):
        if u not in chambers or down[u] is None:
            continue
        run = [u]
        while run[-1] == u or run[-1] not in chambers:
            run.append(down[run[-1]])
        runs.append(run)
    inv = {u: ground[u] - covers[u] for u in chambers}
    for run in runs:
        u, d = run[0], run[-1]
        length = sum(math.dist(xy[a], xy[b]) for a, b in zip(run, run[1:]))
        req, dist = inv[u] - length * MIN_GRADE, 0.0
        for a, b in zip(run, run[1:]):
            dist += math.dist(xy[a], xy[b])
            if dist:
                req = min(req, inv[u] - (inv[u] - (ground[b] - covers[b])) * length / dist)
        inv[d] = min(inv[d], req)
    if fixed_root is not None:
        if inv[root] < fixed_root - 1e-7:
            raise ValueError("constant-grade gravity link falls below the site invert")
        inv[root] = fixed_root
    centimetre = lambda z: math.floor(z * 100 + 1e-8) / 100
    for u in chambers:
        if u != root or fixed_root is None:
            inv[u] = centimetre(inv[u])
    for run in runs:
        u, d = run[0], run[-1]
        req = inv[u] - sum(math.dist(xy[a], xy[b]) for a, b in zip(run, run[1:])) * MIN_GRADE
        if d == root and fixed_root is not None:
            if max(fixed_root, round(fixed_root, 2)) > req + 1e-7:
                raise ValueError("rounded gravity link falls below the site invert")
        else:
            inv[d] = min(inv[d], centimetre(req))
    for run in runs:
        cum, length, z_end = _run_end(run, xy, ground, covers, inv)
        for b, dist in zip(run[1:-1], cum[1:-1]):
            inv[b] = inv[run[0]] + (z_end - inv[run[0]]) * dist / length
    return down, xy, ground, covers, chambers, runs, inv


def _run_end(run, xy, ground, covers, inv):
    """Grade one manhole-to-manhole run on its own: its downstream end sits as high as minimum grade and
    cover allow, and a run that arrives above the deeper outgoing pipe drops at that manhole."""
    u, d = run[0], run[-1]
    cum = [0.0]
    for a, b in zip(run, run[1:]):
        cum.append(cum[-1] + math.dist(xy[a], xy[b]))
    length = max(cum[-1], 1e-9)
    req = inv[u] - length * MIN_GRADE
    for b, dist in zip(run[1:], cum[1:]):
        if dist:
            req = min(req, inv[u] - (inv[u] - (ground[b] - covers[b])) * length / dist)
    return cum, length, max(inv[d], math.floor(req * 100 + 1e-8) / 100)


def _build_terrain_tree(sub_xy, adj, root, tg):
    roots = root if isinstance(root, (list, tuple)) else [root]
    best, down = {r: (tg[r], 0.0) for r in roots}, {r: None for r in roots}
    pq = [(tg[r], 0.0, r) for r in roots]
    heapq.heapify(pq)
    while pq:
        pk, d, v = heapq.heappop(pq)
        if (pk, d) > best[v]:
            continue
        for u in adj[v]:
            if u in best and down[u] is None:
                continue  # another well
            nd = d + math.dist(sub_xy[v], sub_xy[u])
            cand = (max(pk, tg[u] - MIN_GRADE * nd), nd)
            if cand < best.get(u, (1e18, 1e18)):
                best[u] = cand; down[u] = v
                heapq.heappush(pq, (cand[0], cand[1], u))
    return down


def _subdivide_estate_edges(smap, sel_edges, max_seg=25.0):
    sub_xy, sub_adj = {}, defaultdict(set)
    orig_nodes = {u for e in sel_edges for u in e}
    for u in orig_nodes:
        sub_xy[u] = (round(smap.nodes[u][0], 1), round(smap.nodes[u][1], 1))
    next_id = max(orig_nodes) + 1 if orig_nodes else 0
    for u, v in sorted(sel_edges):
        pu, pv = sub_xy[u], sub_xy[v]
        pieces, prev = max(1, math.ceil(math.dist(pu, pv) / max_seg)), u
        for k in range(1, pieces):
            nid = next_id; next_id += 1
            sub_xy[nid] = (round(pu[0] + (pv[0] - pu[0]) * k / pieces, 1), round(pu[1] + (pv[1] - pu[1]) * k / pieces, 1))
            sub_adj[prev].add(nid); sub_adj[nid].add(prev); prev = nid
        sub_adj[prev].add(v); sub_adj[v].add(prev)
    return sub_xy, sub_adj


def _design_with_grade_breaks(down, sub_xy, tg, covers, outlet, point_levels, fixed_root):
    extra = set()
    for _ in range(40):
        res = chamber_design(down, sub_xy, tg, covers, outlet, point_levels, fixed_root=fixed_root, extra_chambers=extra)
        _, r_xy, r_tg, r_cov, _, runs, inv = res
        added = False
        for run in runs:
            if len(run) <= 2:
                continue
            d_cum, L, z_end = _run_end(run, r_xy, r_tg, r_cov, inv)
            grade = (inv[run[0]] - z_end) / L
            deep = max(r_tg[u] - inv[u] for u in run[:-1]) > MAX_DEPTH_M - 0.5 and grade > MIN_GRADE + 0.002
            steep = grade > max((r_tg[run[0]] - r_tg[run[-1]]) / L, MIN_GRADE) + 0.03
            if not (deep or steep):
                continue  # a manhole here would not make the run shallower or follow the ground better
            z0, z1 = r_tg[run[0]] - MIN_DEPTH_M, r_tg[run[-1]] - MIN_DEPTH_M
            worst_i = max(range(1, len(run) - 1), key=lambda i: abs((r_tg[run[i]] - MIN_DEPTH_M) - (z0 + (z1 - z0) * d_cum[i] / L)))
            if run[worst_i] in down and run[worst_i] not in extra:
                extra.add(run[worst_i]); added = True
        if not added:
            return res
    return chamber_design(down, sub_xy, tg, covers, outlet, point_levels, fixed_root=fixed_root, extra_chambers=extra)


def _prune(down, served):
    """Keep only the sewers that carry some home's flow: no empty branches and no manholes for them."""
    keep = set()
    for u in served:
        while u is not None and u not in keep and u in down:
            keep.add(u); u = down[u]
    return {u: d for u, d in down.items() if u in keep or d is None}


def design_estate_sewers(smap, sel_edges, entry_nid, site, site_inv, site_depth, ground, served):
    """Build gravity or pumped sewer tree along estate streets keeping depth in 1.4-6.5 m."""
    sub_xy, sub_adj = _subdivide_estate_edges(smap, sel_edges, max_seg=25.0)
    tg, covers = {u: float(ground([p])[0]) for u, p in sub_xy.items()}, {u: MIN_DEPTH_M for u in sub_xy}
    point_levels = lambda p: (float(ground([p])[0]), MIN_DEPTH_M)
    try:
        down_g = _prune(_build_terrain_tree(sub_xy, sub_adj, entry_nid, tg), served | {entry_nid})
        g_xy, g_tg, g_cov = dict(sub_xy), dict(tg), dict(covers)
        g_xy[-1], g_tg[-1], g_cov[-1] = (round(site[0], 1), round(site[1], 1)), site_inv + site_depth, site_depth
        down_g[entry_nid] = -1; down_g[-1] = None
        res_g = _design_with_grade_breaks(down_g, g_xy, g_tg, g_cov, entry_nid, point_levels, fixed_root=site_inv)
        depths = [res_g[2][u] - res_g[6][u] for u in res_g[6]]
        if min(depths) >= 1.0 and max(depths) <= MAX_DEPTH_M:
            return res_g, None, [], None
    except ValueError:
        pass
    # Pumped: the main wet well at the lowest street point. Where a sewer would pass the 6.5 m depth
    # limit (a long run on flat land, or a second valley behind a ridge), a small lift well takes the
    # flow from upstream and its rising main follows the streets to the main well.
    low = min(tg.values())
    centre = (sum(p[0] for p in sub_xy.values()) / len(sub_xy), sum(p[1] for p in sub_xy.values()) / len(sub_xy))
    wells = [min((u for u in sub_xy if tg[u] <= low + 0.5), key=lambda u: (math.dist(sub_xy[u], centre), u))]
    for _ in range(25):
        tree = _prune(_build_terrain_tree(sub_xy, sub_adj, wells, tg), served)
        res = _design_forest(tree, sub_xy, tg, covers, point_levels, wells)
        down, _, r_tg, _, _, _, inv = res
        deep = [u for u in down if u in sub_xy and r_tg[u] - inv[u] > MAX_DEPTH_M]
        if not deep:
            break
        kids = defaultdict(list)
        for u, d in down.items():
            if d is not None:
                kids[d].append(u)
        # Each deep stretch starts where no deeper sewer feeds it; lift where that sewer is still 5 m deep,
        # so everything upstream drains to the new well.
        added = set()
        for v in deep:
            if any(k in sub_xy and r_tg[k] - inv[k] > MAX_DEPTH_M for k in kids[v]):
                continue
            new = v
            while r_tg[new] - inv[new] > MAX_DEPTH_M - 1.5:
                up = [k for k in kids[new] if k in sub_xy]
                if not up:
                    break
                new = max(up, key=lambda u: (r_tg[u] - inv[u], u))
            if new not in wells:
                added.add(new)
        if not added:
            break
        wells.extend(sorted(added))
    def design(ws):
        r = _design_forest(_prune(_build_terrain_tree(sub_xy, sub_adj, ws, tg), served), sub_xy, tg, covers, point_levels, ws)
        return r, any(u in sub_xy and r[2][u] - r[6][u] > MAX_DEPTH_M for u in r[0])
    # Drop any lift well the design can do without.
    for w in list(reversed(wells[1:])):
        trial = [x for x in wells if x != w]
        r, too_deep = design(trial)
        if not too_deep:
            wells, res = trial, r
    down = res[0]
    wells = wells[:1] + [w for w in wells[1:] if w in served or any(d == w for d in down.values())]
    lifts = [_street_path(sub_xy, sub_adj, w, wells[0]) for w in wells[1:]]
    return res, wells, lifts, _street_path(sub_xy, sub_adj, entry_nid, wells[0])


def _design_forest(down, sub_xy, tg, covers, point_levels, roots):
    """Design each well's catchment on its own and merge the results."""
    root_of = {}
    for u in down:
        path, w = [], u
        while w not in root_of and down[w] is not None:
            path.append(w); w = down[w]
        r = root_of.get(w, w)
        for x in path + [w]:
            root_of[x] = r
    D, X, G, C, CH, R, I = {}, dict(sub_xy), dict(tg), dict(covers), set(), [], {}
    for r in roots:
        sub = {u: d for u, d in down.items() if root_of[u] == r}
        res = _design_with_grade_breaks(sub, X, G, C, r, point_levels, fixed_root=None)
        D.update(res[0]); X.update(res[1]); G.update(res[2]); C.update(res[3])
        CH |= res[4]; R += res[5]; I.update(res[6])
    return D, X, G, C, CH, R, I


def _street_path(sub_xy, adj, a, b):
    dist, prev, pq = {a: 0.0}, {}, [(0.0, a)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == b:
            break
        if d > dist[u]:
            continue
        for v in adj[u]:
            nd = d + math.dist(sub_xy[u], sub_xy[v])
            if nd < dist.get(v, 1e18):
                dist[v], prev[v] = nd, u
                heapq.heappush(pq, (nd, v))
    path = [b]
    while path[-1] != a:
        path.append(prev[path[-1]])
    return path[::-1]


def _graph_stats(lines):
    adj = defaultdict(set)
    for l in lines:
        pts = [(round(q[0]), round(q[1])) for q in l]
        for a, b in zip(pts, pts[1:]):
            if a != b:
                adj[a].add(b); adj[b].add(a)
    V, E = len(adj), sum(len(s) for s in adj.values()) // 2
    seen, C = set(), 0
    for v in adj:
        if v in seen:
            continue
        C += 1; st = [v]
        while st:
            x = st.pop()
            if x not in seen:
                seen.add(x); st.extend(adj[x] - seen)
    deg = [len(s) for s in adj.values()]
    return E - V + C, sum(d >= 3 for d in deg), sum(d == 1 for d in deg)


def build():
    g = load_geom()
    with open(os.path.join(RAW, "contours.json"), encoding="utf-8") as f:
        surface = ContourSurface(json.load(f)["features"])
    ground = lambda pts: surface.at(np.asarray(pts, float) + (g["ox"], g["oy"]))
    occupancy = network_points(g)
    with open(PLAN, encoding="utf-8") as f:
        plan = json.load(f)
    stats = learn_osm_stats(g["ox"], g["oy"])
    exits = find_exit_points(g, plan, occupancy)
    smap, net_centroid = generate_street_map(g, exits, occupancy, stats, ground, seed=MAP_SEED)
    node_gz = [float(z) for z in ground(smap.nodes)]
    edge_samples = _precompute_edge_samples(smap, ground)
    entry_by_key = {key: nid for _, nid, key in smap.exit_links if isinstance(key, str)}

    nodes = {n["name"]: n for n in g["nodes"]}
    sites, taken = {}, set()
    for row in sorted(plan["eligible"], key=lambda r: (-r["open_sector_deg"], r["site_id"])):
        key = row["site_id"]
        n = nodes[key]
        site = (n["x"] / 10, n["y"] / 10)
        site_inv, site_depth = g["oz"] + n["inv"] / 100, n.get("depth") or MIN_DEPTH_M
        entry_nid = entry_by_key[key]
        entry_m = math.dist(site, smap.nodes[entry_nid])

        need = max(row["steps"])
        sel_edges, houses = select_estate_blocks(smap, entry_nid, site, need, node_gz, edge_samples,
                                                 random.Random(zlib.crc32(key.encode())), taken)
        taken |= sel_edges
        result, wells, lifts, main_path = design_estate_sewers(smap, sel_edges, entry_nid, site, site_inv, site_depth, ground,
                                                    {conn for _, conn in houses})
        down, txy, tg, covers, chambers, runs, inv = result
        pumped = wells is not None
        well = wells[0] if pumped else None
        outlet = well if pumped else entry_nid
        point = lambda u: [round(txy[u][0], 1), round(txy[u][1], 1), round(inv[u], 2)]

        children = defaultdict(list)
        for u, d in down.items():
            if d is not None:
                children[d].append(u)
        lift_m = {p[0]: sum(math.dist(txy[a], txy[b]) for a, b in zip(p, p[1:])) for p in lifts}
        distance, seq = {outlet: 0.0, **lift_m}, [outlet] + list(lift_m)
        for u in seq:
            for v in children[u]:
                distance[v] = distance[u] + math.dist(txy[u], txy[v])
                seq.append(v)
        houses.sort(key=lambda h: (distance.get(h[1], 1e18), h[1], h[0]))
        centroids = [(sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r)) for r, _ in houses]
        house_z = [round(float(z), 2) for z in ground(centroids)] if centroids else []

        link_nodes, u = [], entry_nid
        while u is not None and not pumped:
            link_nodes.append(u); u = down[u]
        if pumped:
            link_nodes = main_path  # the rising main follows the streets from the well to the entry
        rising_main = []
        if pumped:
            route_xy = [site] + [txy[u] for u in link_nodes]
            rm_pts = [site]
            for a, b in zip(route_xy, route_xy[1:]):
                pieces = max(1, math.ceil(math.dist(a, b) / 35.0))
                rm_pts.extend((a[0] + (b[0] - a[0]) * k / pieces, a[1] + (b[1] - a[1]) * k / pieces)
                              for k in range(1, pieces + 1))
            for idx, (pt, gz) in enumerate(zip(rm_pts, ground(rm_pts))):
                z = site_inv if idx == 0 else (inv[well] if idx == len(rm_pts) - 1 else float(gz) - 1.0)
                rising_main.append([round(pt[0], 1), round(pt[1], 1), round(z, 2)])
            entry_gz = float(ground([txy[entry_nid]])[0])
            link = [rising_main[0], [round(txy[entry_nid][0], 1), round(txy[entry_nid][1], 1), round(entry_gz - 1.0, 2)]]
            drop = None
        else:
            link = [point(u) for u in reversed(link_nodes)]
            drop = inv[entry_nid] - entry_m * MIN_GRADE - site_inv
        if not houses:
            link = link[:1]
        main = rising_main if pumped else link
        main_m = sum(math.dist(a[:2], b[:2]) for a, b in zip(main, main[1:]))

        run_pts, drops = [], set()
        for run in runs:
            cum, L, z_end = _run_end(run, txy, tg, covers, inv)
            if z_end > inv[run[-1]] + 0.05:
                drops.add(run[-1])
            run_pts.append([[round(txy[a][0], 1), round(txy[a][1], 1), round(inv[a], 2)] for a in run[:-1]] +
                           [[round(txy[run[-1]][0], 1), round(txy[run[-1]][1], 1), round(z_end, 2)]])
        mh_point = lambda u: [round(txy[u][0], 1), round(txy[u][1], 1), round(inv[u], 2), round(tg[u], 2)]

        # A dead-end sewer stops at a plain pipe end, not a manhole, as 138 of the 160 dead ends
        # in the real network do (measured from its node records).
        fed = {d for d in down.values() if d is not None}
        ends = {u for u in chambers if u not in fed and down.get(u) is not None}
        out_steps = {}
        link_chambers = set() if pumped else chambers.intersection(link_nodes)
        for wanted in row["steps"]:
            selected = houses[:wanted]
            used, used_nodes = set(), {outlet}
            for _, conn in selected:
                cur = conn; used_nodes.add(cur)
                while down[cur] is not None:
                    d = down[cur]; used.add((cur, d)); used_nodes.add(d); cur = d
            # Whole manhole-to-manhole runs, so a larger step always contains the smaller one.
            lines, mh, pipe_m = [], link_chambers | {outlet}, 0.0
            for run, pts in zip(runs, run_pts):
                if any(e in used for e in zip(run, run[1:])):
                    lines.append(pts); mh.update((run[0], run[-1]))
                    pipe_m += sum(math.dist(a[:2], b[:2]) for a, b in zip(pts, pts[1:]))
            out_steps[str(wanted)] = {"n": len(selected), "pipes": lines,
                                      "mh": [mh_point(u) for u in sorted(mh - ends) if u in tg],
                                      "ends": [mh_point(u) for u in sorted(mh & ends) if u in tg],
                                      "drops": [mh_point(u)[:2] for u in sorted(drops & mh) if u in tg],
                                      "lifts": [[[round(txy[u][0], 1), round(txy[u][1], 1), round(tg[u] - 1.0, 2)] for u in p]
                                                for p in lifts if p[0] in used_nodes],
                                      "partial": len(selected) < wanted, "pipe_m": round(pipe_m)}
        depths = [tg[u] - inv[u] for u in inv]
        levels = {"ground_m": [round(min(tg.values()), 1), round(max(tg.values()), 1)],
                  "depth_m": [round(min(depths), 2), round(max(depths), 2)],
                  "site_inv_m": round(site_inv, 2), "drop_m": None if drop is None else round(drop, 2),
                  "pumped": pumped, "well": point(well) if pumped else None,
                  "lift_wells": [point(p[0]) for p in lifts]}
        rings = [[[round(x, 1), round(y, 1)] for x, y in house_outline(ring)] for ring, _ in houses]
        site_streets = [[[round(x, 1), round(y, 1)] for x, y in line] for line in smap.to_polylines(edge_filter=sel_edges)]
        pts = link + [p for r in rings for p in r] + [p for l in site_streets for p in l]
        bbox = [round(min(p[0] for p in pts) - 40), round(min(p[1] for p in pts) - 40),
                round(max(p[0] for p in pts) + 40), round(max(p[1] for p in pts) + 40)]
        sites[key] = {"link": link, "link_m": round(entry_m), "main_m": round(main_m),
                      "rising_main": rising_main, "houses": rings, "house_z": house_z,
                      "levels": levels, "steps": out_steps,
                      "direction": "N NE E SE S SW W NW".split()[int((row["open_bearing_deg"] + 22.5) // 45) % 8],
                      "bbox": bbox, "streets": site_streets}
        st_loops, st_junc, st_dead = _graph_stats(site_streets)
        print(f"{key}: {len(houses)}/{need} homes, {'pumped' if pumped else 'gravity'}, "
              f"rising_main {round(main_m) if pumped else 0} m, depth {levels['depth_m'][0]:.2f}-{levels['depth_m'][1]:.2f} m, {len(lifts)} lift wells, "
              f"bbox {bbox}, loops/juncs/dead {st_loops}/{st_junc}/{st_dead}")

    top_streets = [[[round(x, 1), round(y, 1)] for x, y in line] for line in smap.to_polylines(include_exits=True)]
    total_km = sum(math.dist(a, b) for l in top_streets for a, b in zip(l, l[1:])) / 1000.0
    top_loops, _, _ = _graph_stats(top_streets)
    print(f"Surrounding map: {len(top_streets)} streets, {total_km:.1f} km, {top_loops} loops")

    return {"credit": "Imaginary streets and estates generated around the network, patterned on local street statistics; not real streets or houses.",
            "snapshot": "network ground model",
            "note": "Imaginary streets and estates generated around the network, patterned on local street statistics; "
                    "not real streets or houses; the simulation adds each estate's flow at its manhole.",
            "design": {"min_grade": MIN_GRADE, "min_depth_m": MIN_DEPTH_M,
                       "max_structure_spacing_m": MAX_RUN_M, "max_run_m": MAX_RUN_M, "chamber_turn_deg": CHAMBER_TURN_DEG,
                       "source": "Sewerage Code Supplement Pt 1 (Issue 03, 2010), Table 4.6; "
                                 "cl 4.6.5.4 (connection depth, assumed for main cover); cl 2.9.4. "
                                 "Table 4.7 permanent-upstream-end grade is not applied to growing estates."},
            "served_buffer_m": CLEARANCE_M, "streets": top_streets, "sites": sites}


def render(d):
    return ("// Generated by tools/build_sim4_estates.py - do not edit by hand.\n// " + d["credit"] + "\n"
            "window.SIM4_ESTATES = " + json.dumps(d, separators=(",", ":")) + ";\n")


if __name__ == "__main__":
    text = render(build())
    if "--check" in sys.argv:
        ok = os.path.exists(OUT) and open(OUT, encoding="utf-8").read() == text
        print("estates.js is current" if ok else "estates.js is out of date")
        sys.exit(0 if ok else 1)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print("wrote", OUT, os.path.getsize(OUT), "bytes")
