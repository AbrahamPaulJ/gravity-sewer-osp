"""
network.py - turn the cached raw layers into a small, explicit network model.

Reads data/raw only. Nothing here assumes anything about flow, load or sensors; it only
answers "what is physically there": chambers, pipes, levels, diameters.

TWO DATA FACTS THAT DECIDE HOW THIS IS BUILT (see ASSUMPTIONS.md, section A)

1. Inverts are FLOW-anchored. START_INVE is the upstream-of-flow invert whichever way
   the line was digitised; FLOWDIRECT (1 = first vertex upstream, 2 = last) says which
   end that is. Reading them geometry-anchored reverses 583 of 1,002 mains. So the
   recorded flow direction is needed just to put each invert at the right end, and the
   simulation's flow direction is therefore NOT independent of the record. What the
   simulation adds is what happens once pipes back up, which the record cannot say.

2. Every published manhole sits exactly on a pipe end, but most pipe ends are not
   manholes (dead ends, bends and junction fittings). Nodes are snapped pipe ends;
   a node is a chamber only if a published manhole point lies on it.
"""
import json, math, os
from dataclasses import dataclass, field
from collections import defaultdict

import numpy as np
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "data", "raw")

SNAP_TOL = 1.0       # m, pipe ends closer than this are one node
MH_MATCH_TOL = 1.0   # m, a manhole point this close to a node makes it a chamber

# An inspection point further than this from any main is not attributed to one. Measured
# 16 Sep: 99.5% of the 2,851 points lie within 40 m of a main, median 7.0 m, so this
# discards a handful of strays rather than shaping the answer.
IP_MATCH_TOL = 40.0
IP_SAMPLE = 4.0      # m, spacing when sampling centrelines to find the nearest pipe

# A property sits about 6.2 m from its own connection line (median, measured 16 Sep). This
# is generous enough to cover that and tight enough that a property cannot adopt the
# connection belonging to the house next door.
CONN_MATCH_TOL = 15.0


@dataclass
class Node:
    id: int
    x: float
    y: float
    invert: float = math.inf        # chamber floor: lowest pipe invert at the node
    cover: float = math.nan         # ground / lid level
    cover_src: str = "none"         # "surveyed" | "contour" | "none"
    manhole_id: int | None = None
    ins: list = field(default_factory=list)    # pipe indices flowing in
    outs: list = field(default_factory=list)   # pipe indices flowing out

    @property
    def is_chamber(self):
        return self.manhole_id is not None

    @property
    def depth(self):
        return self.cover - self.invert


@dataclass
class Pipe:
    id: int
    asset_id: int
    up: int                 # node index, upstream by the record
    down: int
    inv_up: float
    inv_down: float
    dia: float              # m, internal where published, else nominal
    dia_src: str
    length: float           # m, along the polyline
    line: list              # [(x, y), ...] ordered upstream to downstream
    material: str
    year: int
    dwellings: int = 0      # connected properties nearest this pipe, see Network._connect

    @property
    def slope(self):
        return (self.inv_up - self.inv_down) / self.length if self.length > 0 else 0.0


class ContourSurface:
    """Ground level from 1 m contours: blend the nearest two contour levels by distance.
    A reconstruction, not a measurement (assumption A4)."""

    def __init__(self, feats):
        pts = defaultdict(list)
        for f in feats:
            z = (f.get("attributes") or {}).get("ELEVATION")
            if z is None:
                continue
            for path in (f.get("geometry") or {}).get("paths", []):
                pts[float(z)].extend((p[0], p[1]) for p in path)
        self.levels = np.array(sorted(pts), float)
        self.trees = [cKDTree(np.asarray(pts[z])) for z in self.levels]

    def at(self, xy):
        xy = np.atleast_2d(np.asarray(xy, float))
        D = np.stack([t.query(xy)[0] for t in self.trees])
        o = np.argsort(D, axis=0)
        c = np.arange(xy.shape[0])
        d1, d2 = D[o[0], c], D[o[1], c]
        z1, z2 = self.levels[o[0]], self.levels[o[1]]
        return z1 + (z2 - z1) * d1 / np.maximum(d1 + d2, 1e-9)


def _load(name):
    with open(os.path.join(RAW, name + ".json"), encoding="utf-8") as f:
        return json.load(f)["features"]


class Network:
    def __init__(self, include_overflow=False):
        # Overflow (relief) pipes, SUBTYPE 2, carry FLOWDIRECT 0 in this layer. Sim 2.5 keeps
        # them (they relieve surcharge sideways, exactly in the scenarios studied); every
        # older model leaves them out, which is the default, so its network is unchanged.
        self.include_overflow = include_overflow
        self.nodes: list[Node] = []
        self.pipes: list[Pipe] = []
        self.skipped = defaultdict(int)
        self.surface = ContourSurface(_load("contours"))
        self._build(_load("mains"), _load("manholes"))
        # Optional: this layer was added after the first experiments and everything that
        # predates it must still run. Absent, every pipe keeps dwellings = 0 and the fact
        # is recorded. Consumers that actually need the counts check for themselves;
        # catchment.py refuses to run on a catchment with no dwellings in it.
        try:
            self._connect(_load("inspection_points"), self._opt("connections"))
            self.has_dwellings = True
        except FileNotFoundError:
            self.skipped["inspection_points not cached, run fetch_data.py"] += 1
            self.has_dwellings = False
            self.connections = []

    def _node_at(self, pt, index):
        key = (round(pt[0] / SNAP_TOL), round(pt[1] / SNAP_TOL))
        if key not in index:
            index[key] = len(self.nodes)
            self.nodes.append(Node(len(self.nodes), pt[0], pt[1]))
        return index[key]

    def _build(self, mains, manholes):
        index = {}
        deferred = []
        for f in mains:
            a = f["attributes"]
            paths = (f.get("geometry") or {}).get("paths") or []
            si, ei, fd = a.get("START_INVE"), a.get("END_INVERT"), a.get("FLOWDIRECT")
            if not paths or len(paths[0]) < 2:
                self.skipped["no geometry"] += 1
                continue
            if not si or not ei or si <= 0 or ei <= 0:
                self.skipped["no invert"] += 1
                continue
            if fd not in (1, 2):
                if self.include_overflow and a.get("SUBTYPE") == 2:
                    deferred.append(f)          # oriented below, once node levels exist
                else:
                    self.skipped["no flow direction"] += 1
                continue
            line = [tuple(p) for p in paths[0]]
            if fd == 2:
                line.reverse()          # now ordered upstream -> downstream
            self._add(a, line, si, ei, index)

        # Overflow pipes: which end is upstream? START_INVE is always the upstream invert
        # (A3), so the end whose node already sits at that level is the upstream one. The
        # other pipes at each end set the node levels. Measured 24 Sep on the three in this
        # layer: the choice agrees with the statewide layer's recorded direction.
        for f in deferred:
            a = f["attributes"]
            si, ei = float(a["START_INVE"]), float(a["END_INVERT"])
            line = [tuple(p) for p in f["geometry"]["paths"][0]]
            lvl = lambda pt: self.nodes[self._node_at(pt, index)].invert
            as_is = abs(si - lvl(line[0])) + abs(ei - lvl(line[-1]))
            flip = abs(si - lvl(line[-1])) + abs(ei - lvl(line[0]))
            if flip < as_is:
                line.reverse()
            self._add(a, line, si, ei, index)
            self.skipped["overflow pipe included, direction from inverts"] += 1

        self._place_manholes(manholes)

    def _add(self, a, line, si, ei, index):
        """One main, `line` ordered upstream to downstream."""
        u, d = self._node_at(line[0], index), self._node_at(line[-1], index)
        if u == d:
            self.skipped["zero length"] += 1
            return
        internal, nominal = a.get("INTERNALDI") or 0, a.get("NOMINALDIA") or 0
        dia, src = (internal, "internal") if internal else (nominal, "nominal")
        length = sum(math.dist(line[i], line[i + 1]) for i in range(len(line) - 1))
        p = Pipe(len(self.pipes), a.get("ID"), u, d, float(si), float(ei),
                 dia / 1000.0, src, length, line, a.get("MATERIAL", "").strip(),
                 a.get("CONST_YEAR") or 0)
        self.pipes.append(p)
        self.nodes[u].outs.append(p.id)
        self.nodes[d].ins.append(p.id)
        self.nodes[u].invert = min(self.nodes[u].invert, p.inv_up)
        self.nodes[d].invert = min(self.nodes[d].invert, p.inv_down)

    def _place_manholes(self, manholes):
        xy = np.array([(n.x, n.y) for n in self.nodes])
        mh_xy = np.array([(f["geometry"]["x"], f["geometry"]["y"]) for f in manholes])
        dist, idx = cKDTree(xy).query(mh_xy)
        for k, f in enumerate(manholes):
            if dist[k] <= MH_MATCH_TOL:
                n = self.nodes[idx[k]]
                n.manhole_id = f["attributes"]["ID"]
                elev = f["attributes"].get("ELEVATION") or 0
                if elev > n.invert:
                    n.cover, n.cover_src = float(elev), "surveyed"

        ground = self.surface.at(xy)
        for n, g in zip(self.nodes, ground):
            if n.cover_src == "none" and g > n.invert:
                n.cover, n.cover_src = float(g), "contour"

    @staticmethod
    def _opt(name):
        """A layer that may not be cached yet. Absent is a degraded mode, not a crash."""
        try:
            return _load(name)
        except FileNotFoundError:
            return None

    def _connect(self, points, conns=None):
        """Attribute each connected property to the main it actually drains to.

        Replaces the assumed dwelling density in ASSUMPTIONS L5 with a count. Layer 4 is
        one point per connected property and carries PARCELID on every record, so this is
        a census of connections rather than a proxy for them.

        TWO WAYS TO DO THIS, AND THE BETTER ONE IS AVAILABLE. Layer 7 publishes the actual
        connection pipe from each property to the main it joins: median 6.7 m long, and the
        end that meets a main sits 0.00 m from one. Following that line says which main a
        property really drains to. Nearest-main is only a proxy for it, and the two disagree
        on 3.6% of properties (101 of 2,837), which is a corner block landing on the wrong
        street. So connections are used where a property has one, and proximity is the
        fallback where it does not.
        """
        if not self.pipes:
            return
        sx, sy, sp = [], [], []
        for p in self.pipes:
            for i in range(len(p.line) - 1):
                (x0, y0), (x1, y1) = p.line[i], p.line[i + 1]
                n = max(2, int(math.dist((x0, y0), (x1, y1)) / IP_SAMPLE))
                for k in range(n):
                    t = k / (n - 1)
                    sx.append(x0 + t * (x1 - x0))
                    sy.append(y0 + t * (y1 - y0))
                    sp.append(p.id)
        xy, keep = [], []
        for f in points:
            g = f.get("geometry") or {}
            if "x" in g and "y" in g:
                xy.append((g["x"], g["y"]))
                keep.append(f)
        if not xy:
            return
        tree = cKDTree(np.c_[sx, sy])

        # Where each connection line meets a main, and which main that is.
        end_xy, end_pipe = [], []
        for f in (conns or []):
            path = (f.get("geometry") or {}).get("paths") or []
            if not path or len(path[0]) < 2:
                continue
            a, b = path[0][0], path[0][-1]
            (da, ia), (db, ib) = tree.query([a]), tree.query([b])
            end_xy.append(a if da[0] <= db[0] else b)
            end_pipe.append(sp[ia[0] if da[0] <= db[0] else ib[0]])
        self.connection_lines = len(end_xy)

        dist, idx = tree.query(np.array(xy))
        if end_xy:
            # Match each property to its own connection line, then take the main that line
            # joins. CONN_MATCH_TOL keeps a property from adopting a neighbour's connection.
            cd, ci = cKDTree(np.array(end_xy)).query(np.array(xy))
        else:
            cd = ci = None
        # Coordinates are kept, not just counted. Drawing the actual connection points is
        # what turns an abstract network into a recognisable suburb, and a count cannot be
        # un-summed later.
        self.connections = []
        self.attributed_by = {"connection": 0, "proximity": 0}
        for k, ((px, py), d, i) in enumerate(zip(xy, dist, idx)):
            pipe = None
            if ci is not None and cd[k] <= CONN_MATCH_TOL:
                pipe = end_pipe[ci[k]]
                self.attributed_by["connection"] += 1
            elif d <= IP_MATCH_TOL:
                pipe = sp[i]
                self.attributed_by["proximity"] += 1
            if pipe is None:
                self.skipped["property with neither a connection nor a nearby main"] += 1
                continue
            self.pipes[pipe].dwellings += 1
            self.connections.append((px, py, pipe))

    def dwellings_upstream(self, node_id):
        """Connected properties draining to node_id, through any path."""
        return sum(self.pipes[i].dwellings for i in self.upstream_pipes(node_id))

    def upstream_pipes(self, node_id):
        """Every pipe that drains, directly or through others, into node_id."""
        seen, stack, out = set(), [node_id], []
        while stack:
            v = stack.pop()
            for pi in self.nodes[v].ins:
                if pi in seen:
                    continue
                seen.add(pi)
                out.append(pi)
                stack.append(self.pipes[pi].up)
        return out

    # ------------------------------------------------------------ neighbourhoods
    def junctions(self):
        """Chambers where two pipes meet one outgoing pipe, all four ends chambers with
        known cover. These are the smallest pieces of network where flows combine."""
        out = []
        for n in self.nodes:
            if not (n.is_chamber and len(n.ins) == 2 and len(n.outs) == 1):
                continue
            ids = n.ins + n.outs
            ends = [self.pipes[i].up for i in n.ins] + [self.pipes[n.outs[0]].down]
            if all(self.nodes[e].is_chamber and self.nodes[e].cover_src != "none"
                   for e in ends + [n.id]):
                out.append((n.id, ids))
        return out
