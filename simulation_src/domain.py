#!/usr/bin/env python3
"""
domain.py - extend the council network with statewide pipes, and name the domain ladder.

P2 of the domain upgrade (HANDOFF). The council extract is not a hydraulic catchment: three
outside pipes drain into the growth catchment above 583, and the trunk below 583 carries on
past the point where the council data appears to stop (overlap_check.py, measured 24 Sep).
This module adds the statewide pipes the council does not hold to a normal `Network`, so
`catchment.Catchment` runs on a larger domain unchanged.

HOW PIPES ARE JOINED, AND WHY NOT BY SNAPPING

Topology is read in the statewide frame, after the datum shift overlap_check measures. A
statewide-only pipe whose end meets a council-held pipe is joined to THAT pipe's node in the
council network, found by asset ID and flow-anchored end. Snapping to council coordinates
instead misses real joins, because 33 pipes are drawn differently in the two sources, the
last trunk pipe below 583 by about 48 m. Statewide-only pipes meeting each other get
synthetic nodes, keyed on statewide coordinates.

WHAT AN OUTSIDE NODE IS, AND IS NOT

The statewide layer has pipes only. An outside node is an inferred pipe end, never a known
manhole, so it is modelled as a sealed junction (H10) and is never a growth site or sensor
candidate. Its ground level comes from the 1 m contours where they reach, and otherwise
from the median council chamber depth, flagged `assumed` (ASSUMPTIONS X2).

WHAT AN OUTSIDE PIPE CARRIES

The statewide layer has no property points, so outside load is estimated from length, at
the connected-property density MEASURED on council pipes of the same size class, recomputed
on every build. Pipes above 450 mm get none: the council data has no evidence of house
connections on trunks. `load_factor` scales it for the P3 sensitivity (ASSUMPTIONS X1).

THE LADDER

    D0   today's model: everything above 583, council pipes only, free outfall below 583
    U    D0 plus the three outside inflows into the growth catchment. Same outlet
    T500, T1000, T2000
         the outlet moved down the trunk to the first node at least that far below 583,
         taking in everything that drains to it, council or statewide
    J    the outlet at the last node before the trunk meets the 1,460 mm main, whose water
         level is the downstream condition P3 varies

Usage:
    python domain.py                 # describe every rung
"""
import argparse, json, math, os
from collections import defaultdict

import numpy as np

import overlap_check as oc
from network import Network, Node, Pipe, SNAP_TOL

GROWTH_OUTLET = 583     # the Sim 2 outlet chamber; its catchment is the study region

# A pipe this large with no house connections in the council data marks the trunk the
# ladder stops at. The 450 mm trunk below 583 meets a 1,460 mm main (measured 24 Sep).
BIG_TRUNK_MM = 1000

# Size classes for the outside-load estimate, upper bounds in mm. Above the last: no load.
DENSITY_CLASSES = (250, 450)

TRUNK_STEPS_M = (500, 1000, 2000)


class ExtendedNetwork(Network):
    """A council Network plus every statewide gravity main the council does not hold.

    `origin[pipe_id]` is "council" or "statewide"; `synthetic` is the set of node ids that
    exist only because statewide pipe ends meet. Council pipes, nodes and their ids are
    untouched, so anything keyed on them (manhole ids, node 583) still resolves.
    """

    def __init__(self, load_factor=1.0):
        super().__init__()
        self.load_factor = load_factor
        self.origin = {p.id: "council" for p in self.pipes}
        self.synthetic = set()
        self.density = self._measured_density()
        self.extension = self._extend()

    # -------------------------------------------------------------- measured
    def _measured_density(self):
        """Connected properties per metre on council pipes, per size class."""
        L, D = defaultdict(float), defaultdict(int)
        for p in self.pipes:
            k = size_class(p.dia * 1000)
            L[k] += p.length
            D[k] += p.dwellings
        return {k: (D[k] / L[k] if L[k] else 0.0) for k in range(len(DENSITY_CLASSES))}

    # -------------------------------------------------------------- stitching
    def _extend(self):
        wv, sw = oc.load("mains"), oc.load("sw_gravity")
        dxy = oc.datum_shift(wv, sw)
        oc.shift(sw, dxy)
        by_asset = {p.asset_id: p for p in self.pipes}
        key = lambda xy: (round(xy[0] / SNAP_TOL), round(xy[1] / SNAP_TOL))

        # Statewide end points of council-held pipes -> the council node at that end.
        at = {}
        for f in sw["features"]:
            p = by_asset.get(f["attributes"].get("id"))
            if p is None:
                continue
            u, d = oc.upstream_end(f, "flowdirection")
            at.setdefault(key(u), p.up)
            at.setdefault(key(d), p.down)

        surface_box = self._contour_box()
        fallback_depth = float(np.median([n.depth for n in self.nodes
                                          if n.is_chamber and math.isfinite(n.depth)]))
        stats = defaultdict(int)
        joined = set(at.values())
        held = {p.asset_id for p in self.pipes}
        wv_ids = {f["attributes"]["ID"] for f in wv["features"]}
        for f in sw["features"]:
            a = f["attributes"]
            if a.get("id") in wv_ids or a.get("id") in held:
                continue
            si, ei, fd = a.get("start_invert"), a.get("end_invert"), a.get("flowdirection")
            paths = (f.get("geometry") or {}).get("paths") or []
            if not paths or len(paths[0]) < 2 or not si or not ei or si <= 0 or ei <= 0 \
                    or fd not in (1, 2):
                stats["statewide pipe skipped: no geometry, invert or direction"] += 1
                continue
            line = [tuple(p) for p in paths[0]]
            if fd == 2:
                line.reverse()
            u = self._resolve(line[0], at, key)
            d = self._resolve(line[-1], at, key)
            if u == d:
                stats["statewide pipe skipped: zero length"] += 1
                continue
            internal, nominal = a.get("internaldiameter") or 0, a.get("nominaldiameter") or 0
            dia, src = (internal, "internal") if internal else (nominal, "nominal")
            length = sum(math.dist(line[i], line[i + 1]) for i in range(len(line) - 1))
            p = Pipe(len(self.pipes), a.get("id"), u, d, float(si), float(ei), dia / 1000.0,
                     src, length, line, (a.get("material") or "").strip(),
                     0)     # install year unused by the models; statewide dates not parsed
            p.dwellings = self._estimated_dwellings(nominal or dia, length)
            self.pipes.append(p)
            self.origin[p.id] = "statewide"
            self.nodes[u].outs.append(p.id)
            self.nodes[d].ins.append(p.id)
            self.nodes[u].invert = min(self.nodes[u].invert, p.inv_up)
            self.nodes[d].invert = min(self.nodes[d].invert, p.inv_down)
            stats["statewide pipes added"] += 1
            stats["ends joined to council by asset id"] += (u in joined) + (d in joined)

        # Ground level at the new nodes: contours inside their coverage, else assumed.
        new = sorted(self.synthetic)
        if new:
            xy = np.array([(self.nodes[i].x, self.nodes[i].y) for i in new])
            g = self.surface.at(xy)
            for i, z, (x, y) in zip(new, g, xy):
                n = self.nodes[i]
                inside = (surface_box[0] <= x <= surface_box[2]
                          and surface_box[1] <= y <= surface_box[3])
                if inside and z > n.invert:
                    n.cover, n.cover_src = float(z), "contour"
                else:
                    n.cover, n.cover_src = n.invert + fallback_depth, "assumed"
                stats[f"outside node ground: {n.cover_src}"] += 1
        stats["fallback depth m"] = round(fallback_depth, 2)
        stats["datum shift m"] = [round(float(v), 3) for v in dxy]
        return dict(stats)

    def _resolve(self, xy, at, key):
        k = key(xy)
        if k in at:
            return at[k]
        before = len(self.nodes)
        nid = self._node_at(xy, self._syn_index)
        if len(self.nodes) > before:
            self.synthetic.add(nid)
        return nid

    @property
    def _syn_index(self):
        if not hasattr(self, "_syn"):
            self._syn = {}
        return self._syn

    def _contour_box(self):
        lv = self.surface
        pts = np.vstack([t.data for t in lv.trees])
        # 20 m inside the edge: beyond the last contour the blend extrapolates.
        return (*(pts.min(0) + 20), *(pts.max(0) - 20))

    def _estimated_dwellings(self, dia_mm, length):
        k = size_class(dia_mm)
        rate = self.density.get(k, 0.0)
        return rate * length * self.load_factor

    # -------------------------------------------------------------- queries
    def trunk_below(self, outlet=GROWTH_OUTLET):
        """Nodes and cumulative metres down the trunk from `outlet`, following outs[0],
        stopping at the node where the trunk meets a pipe of BIG_TRUNK_MM or more."""
        nodes, dist, n, total = [outlet], [0.0], outlet, 0.0
        while self.nodes[n].outs:
            p = self.pipes[self.nodes[n].outs[0]]
            if p.dia * 1000 >= BIG_TRUNK_MM:
                break
            total += p.length
            n = p.down
            nodes.append(n)
            dist.append(total)
            if any(self.pipes[i].dia * 1000 >= BIG_TRUNK_MM for i in self.nodes[n].ins):
                break
        return nodes, dist

    def study_nodes(self, outlet=GROWTH_OUTLET, council_only=True):
        """Nodes of the Sim 2 study region: council nodes draining to `outlet`, plus it."""
        s = {outlet}
        for pi in self.upstream_pipes(outlet):
            if council_only and self.origin[pi] != "council":
                continue
            s |= {self.pipes[pi].up, self.pipes[pi].down}
        return s


def size_class(dia_mm):
    for k, hi in enumerate(DENSITY_CLASSES):
        if dia_mm <= hi:
            return k
    return len(DENSITY_CLASSES)


class CouncilOnly(Network):
    """D0: the council network as Sim 2 has always used it, with the same query surface."""

    def __init__(self):
        super().__init__()
        self.origin = {p.id: "council" for p in self.pipes}
        self.synthetic = set()
        self.extension = {}


def rung(net, name):
    """(network, outlet node id) for a rung of the ladder. `net` is an ExtendedNetwork,
    except for D0, which needs the council-only network and is built separately."""
    if name in ("D0", "U"):
        return GROWTH_OUTLET
    nodes, dist = net.trunk_below(GROWTH_OUTLET)
    if name == "J":
        # The last node whose outgoing pipe is still the small trunk: its tail pipe then
        # discharges at the junction with the big main, which becomes the outfall.
        return nodes[-2]
    if name.startswith("T"):
        want = float(name[1:])
        for n, d in zip(nodes, dist):
            if d >= want:
                return n
        raise SystemExit(f"trunk below {GROWTH_OUTLET} is only {dist[-1]:.0f} m long")
    raise SystemExit(f"unknown domain {name}; one of D0 U T500 T1000 T2000 J")


RUNGS = ("D0", "U", "T500", "T1000", "T2000", "J")


def build(name, load_factor=1.0, _cache={}):
    """(network, outlet) for a rung. Networks are cached per load factor; building one
    reads 36 MB of statewide data."""
    if name == "D0":
        if "D0" not in _cache:
            _cache["D0"] = CouncilOnly()
        return _cache["D0"], GROWTH_OUTLET
    k = ("ext", load_factor)
    if k not in _cache:
        _cache[k] = ExtendedNetwork(load_factor)
    return _cache[k], rung(_cache[k], name)


def describe(net, outlet, study):
    ups = net.upstream_pipes(outlet)
    council = [i for i in ups if net.origin[i] == "council"]
    state = [i for i in ups if net.origin[i] == "statewide"]
    return {
        "outlet": outlet,
        "pipes": len(ups), "council_pipes": len(council), "statewide_pipes": len(state),
        "metres": round(sum(net.pipes[i].length for i in ups)),
        "statewide_metres": round(sum(net.pipes[i].length for i in state)),
        "counted_properties": int(sum(net.pipes[i].dwellings for i in council)),
        "estimated_properties": round(sum(net.pipes[i].dwellings for i in state), 1),
        "study_chambers": sum(1 for n in study if net.nodes[n].is_chamber),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--load-factor", type=float, default=1.0)
    args = ap.parse_args()
    ext, _ = build("U", args.load_factor)
    print("extension:", json.dumps(ext.extension))
    print("measured properties per 100 m by size class (<=250, <=450 mm):",
          {k: round(100 * v, 2) for k, v in ext.density.items()})
    nodes, dist = ext.trunk_below()
    print(f"trunk below {GROWTH_OUTLET}: {len(nodes) - 1} pipes, {dist[-1]:.0f} m to the "
          f"{BIG_TRUNK_MM} mm+ main")
    study = ext.study_nodes()
    for name in RUNGS:
        net, outlet = build(name, args.load_factor)
        print(f"  {name:6s}", describe(net, outlet, study))


if __name__ == "__main__":
    main()
