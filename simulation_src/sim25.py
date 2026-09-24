#!/usr/bin/env python3
"""
sim25.py - Sim 2.5: growth and sensor placement on the council network, EPA SWMM.

The canonical list of every assumption and constant below is
simulation/Assumptions_Register.xlsx; the row IDs in comments (L4, P02, X6 ...) point there.
Sources: docs/15_sim25_research.md. Method position: docs/16_method_A6_DRAFT.md.

WHAT IT MODELS

Two models built from the same council network, used together ("nesting", X4):

    whole    every council pipe draining to node 606, where the council data ends, plus the
             three pump-station catchments (L7) and any pipe that leaves the domain (own
             outfall). Outfall at 606 is FREE or a FIXED water level (X6, P31).
    segment  the study catchment draining to node 583 (71 manholes, the only growth sites and
             sensor candidates, X2), with its outlet pipe discharging at the water level the
             whole model settled to there.

Outside pipes are never modelled. Where one flows into the council network, a constant inflow
sized from the statewide layer's pipe length stands in for it (L4).

Usage:
    python sim25.py --describe              # domain, boundary inflows, pumps, loads
    python sim25.py --whole --minutes 1440  # one whole-domain steady run, nominal case
"""
import argparse, json, math, os
from dataclasses import dataclass, replace

import numpy as np
from scipy.spatial import cKDTree

import model
import overlap_check as oc
from model import SimNode, SimLink, PipeInfo
from network import Network

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(model.RESULTS, "sim25")

DOMAIN_END = 606            # X1: node where the council data ends
SEGMENT_OUTLET = 583        # P22 / X2: manhole A

PEOPLE_PER_CONNECTION = 2.81        # P01: 8,023 people / 2,851 connections (ABS 2021)
PEOPLE_PER_NEW_DWELLING = 2.3       # G4: ABS 2021 average household size
LITRES_PER_PERSON_DAY = 200.0       # P01b
PF_NOMINAL = 2.0                    # P02
# R9: the overnight trough of the daily cycle, x average sewage flow. Midpoint of "Minimum
# hour flow: 0.10 to 0.30 x ADF" (UW CEE 481 notes, as for P02). The peak end is the peak
# factor itself, so the existing runs ARE the peak of the day.
TROUGH_FACTOR = 0.2

# P04: I&I rate, L/s per 100 m. 0.11 meets the design envelope implied by the utility's own
# DN225 rating (docs/15 s2.3); the others are multiples beyond design.
WEATHER = [(0.0, "Dry"), (0.11, "Design wet"), (0.25, "Beyond design"), (0.40, "Severe")]

# P26: sensitivity only; nominal is uniform. Upper bound of each era (construction year).
AGE_BANDS = [(1929, 1.5), (1959, 1.2), (1989, 0.8), (9999, 0.5)]

DETECT_DEPTH_M = 0.150              # G6: the network operator's low alarm, depth above invert (Do 2023)
GROWTH_DWELLINGS = [10, 30, 80, 150]  # P05
STRESS_DWELLINGS = 700              # P05 stress case
RM_SNAP_M = 12.0                    # rising main end to network node (measured: <= 11.4 m)


def replace_node(n, name, kind, max_depth):
    """A copy of SimNode `n` under a new name and kind."""
    return SimNode(name, kind, n.x, n.y, n.invert, max_depth, name, n.cover, n.cover_src,
                   n.manhole_id)


def harmon(pop):
    """P02 high case. pop in people."""
    return 1.0 + 14.0 / (4.0 + math.sqrt(max(pop, 1.0) / 1000.0))


@dataclass(frozen=True)
class Case:
    ii: float = 0.11            # P04
    pf: str = "flat"            # P02: flat | harmon
    age: str = "uniform"        # L5 / P26: uniform | weighted
    bfac: float = 1.0           # P25
    stage: float | None = None  # P31: m above the 606 invert; None = free outfall
    hour: str = "peak"          # R9: peak | trough of the daily sewage cycle

    def tag(self):
        st = "free" if self.stage is None else f"{self.stage:.3f}"
        t = f"ii{self.ii:.2f}_{self.pf}_{self.age}_b{self.bfac:g}_s{st}"
        return t if self.hour == "peak" else t + "_trough"


# ====================================================================== the network
_NET = {}


def network():
    """The council network with overflow pipes (D7). Built once per process."""
    if "net" not in _NET:
        _NET["net"] = Network(include_overflow=True)
    return _NET["net"]


def age_weight(year):
    for hi, w in AGE_BANDS:
        if year <= hi:
            return w
    return 1.0


# ====================================================================== boundary inflows
def boundary_entries(net):
    """L4 and X8: every point where water from outside the council data enters it.

    Returns a list of dicts: node (network node id where it enters), kind, length_m of outside
    (or disconnected council) pipe behind it, connections behind it (estimated from P24 for
    statewide pipes, counted for council pipes), and the id that identifies it.
    """
    if "entries" in _NET:
        return _NET["entries"]
    wv, sw = oc.load("mains"), oc.load("sw_gravity")
    oc.shift(sw, oc.datum_shift(wv, sw))
    wv_ids = {f["attributes"]["ID"] for f in wv["features"]}
    feat = {f["attributes"].get("id"): f for f in sw["features"]}
    by_asset = {p.asset_id: p for p in net.pipes}
    above, length = oc.statewide_upstream(sw)
    rep = json.load(open(os.path.join(HERE, "results", "overlap", "overlap_report.json"),
                         encoding="utf-8"))

    # Connection density by size class, measured on council pipes (P24).
    classes = (250, 450)
    L, D = [0.0] * 3, [0] * 3
    for p in net.pipes:
        k = next((i for i, hi in enumerate(classes) if p.dia * 1000 <= hi), 2)
        L[k] += p.length
        D[k] += p.dwellings
    density = [D[0] / L[0], D[1] / L[1], 0.0]

    def join_node(council_asset, xy):
        """The council pipe's end (network node) nearest the join point, in statewide frame."""
        p = by_asset.get(council_asset)
        f = feat.get(council_asset)
        if p is None or f is None:
            return None
        u, d = oc.upstream_end(f, "flowdirection")
        return p.up if math.dist(u, xy) <= math.dist(d, xy) else p.down

    out = []
    for b in rep["boundary"]:
        f = feat.get(b["id"])
        if f is None:
            continue
        up_xy, dn_xy = oc.upstream_end(f, "flowdirection")
        if b["kind"] == "inflow":
            node = join_node(b["council_pipe"], dn_xy)
            ids = above(b["id"]) - wv_ids
            conns = 0.0
            for x in ids:
                dia = float(feat[x]["attributes"].get("nominaldiameter") or 150)
                k = next((i for i, hi in enumerate(classes) if dia <= hi), 2)
                conns += density[k] * length[x]
            out.append(dict(id=b["id"], kind="statewide", node=node,
                            length_m=sum(length[x] for x in ids), connections=conns))
        elif b["kind"] == "gap":
            # A council branch joined to the rest only through a link the council lacks (X8).
            # Its own pipes and connections are counted; it enters where the link lands.
            node = join_node(b["council_pipe_down"], dn_xy)
            src = by_asset.get(b["council_pipe"])
            if src is None or node is None:
                continue
            ups = set(net.upstream_pipes(src.up)) | {src.id}
            out.append(dict(id=b["id"], kind="council branch via missing link", node=node,
                            source_node=src.down,
                            length_m=sum(net.pipes[i].length for i in ups) + length[b["id"]],
                            connections=float(sum(net.pipes[i].dwellings for i in ups))))
    _NET["entries"] = out
    return out


# ====================================================================== pumps
def pump_links(net):
    """L7: (wet well node, discharge node, first rising main id) per pump station.

    A rising main is recorded as several short pieces laid end to end (e.g. 1495438, 1495437,
    1495433, 1500798 from the station at node 997), whose ends coincide exactly. The pieces
    are chained first; only the chain's first and last ends are matched to the gravity
    network. A station is a chain whose start is a dead end of the gravity network (the wet
    well). Matching each piece alone snaps intermediate ends to whatever manhole is nearest
    in the street and invents pumping into the wrong place.
    """
    feats = oc.load("rising_mains")["features"]
    ends = []
    for f in feats:
        a = f["attributes"]
        p = f["geometry"]["paths"]
        s, e = tuple(p[0][0]), tuple(p[-1][-1])
        u, d = (e, s) if a.get("FLOWDIRECT") == 2 else (s, e)
        ends.append((a["ID"], u, d))
    key = lambda xy: (round(xy[0], 1), round(xy[1], 1))
    starts = {key(u): i for i, (_, u, _) in enumerate(ends)}
    fed = {key(d) for _, _, d in ends}
    xy = np.array([(n.x, n.y) for n in net.nodes])
    tree = cKDTree(xy)
    pairs = []
    for i, (rid, u, d) in enumerate(ends):
        if key(u) in fed:                   # not the start of a chain
            continue
        seen = {i}
        while key(d) in starts and starts[key(d)] not in seen:
            k = starts[key(d)]
            seen.add(k)
            d = ends[k][2]
        du, iu = tree.query(u)
        dd, idn = tree.query(d)
        iu, idn = int(iu), int(idn)
        if du > RM_SNAP_M or dd > RM_SNAP_M or iu == idn or net.nodes[iu].outs:
            continue
        pairs.append((iu, idn, rid))
    return pairs


# ====================================================================== the model
class Sim25Model:
    """A SWMM model with the same surface as catchment.Catchment, so model.run and
    catchment-style settling work on it.

    whole=True:  everything draining to DOMAIN_END, pump catchments, exit pipes.
    whole=False: the study segment above SEGMENT_OUTLET plus its outlet pipe, whose end is a
                 FIXED outfall at `outlet_head` (absolute water level, m) from a whole run.
    """

    def __init__(self, case, whole=True, outlet_head=None, growth=None, growth_nodes=None,
                 exit_heads=None):
        net = network()
        self.net, self.case, self.whole = net, case, whole
        self.growth = dict(growth or {})            # manhole id -> added dwellings
        self.growth_nodes = dict(growth_nodes or {})  # network node id -> added dwellings
        self.pumps, self.watch = [], []

        if whole:
            pipes = set(net.upstream_pipes(DOMAIN_END))
            dom_nodes = ({net.pipes[i].up for i in pipes} | {net.pipes[i].down for i in pipes})
            pump_pairs = [pp for pp in pump_links(net) if pp[1] in dom_nodes]
            for wet, _, _ in pump_pairs:
                pipes |= set(net.upstream_pipes(wet))
            outlet_node = DOMAIN_END
        else:
            pipes = set(net.upstream_pipes(SEGMENT_OUTLET))
            pump_pairs = []
            tail = net.pipes[net.nodes[SEGMENT_OUTLET].outs[0]]
            pipes.add(tail.id)
            outlet_node = tail.down
        nids = {net.pipes[i].up for i in pipes} | {net.pipes[i].down for i in pipes}

        # Exit pipes: leave the model's nodes to somewhere outside it (X7, overflow relief).
        exits = [p.id for p in net.pipes
                 if p.up in nids and p.up != outlet_node
                 and p.id not in pipes and p.down not in nids]
        pipes |= set(exits)
        exit_nodes = {net.pipes[i].down for i in exits}
        nids |= exit_nodes

        self.nodes, self.links, self.pipes = {}, [], []
        self.chambers, self.node_of = {}, {}
        for nid in sorted(nids):
            n = net.nodes[nid]
            if nid == outlet_node:
                name, kind = "OUT", "outfall"
            elif nid in exit_nodes:
                name, kind = f"X{nid}", "outfall"
            elif n.is_chamber:
                name, kind = f"MH{n.manhole_id}", "chamber"
            else:
                name, kind = f"N{nid}", "inline"
            nd = n.depth if math.isfinite(n.depth) else 0.5
            depth = nd if kind == "chamber" else max(nd, 0.5)
            self.nodes[name] = SimNode(name, kind, n.x, n.y, n.invert,
                                       0.0 if kind == "outfall" else depth,
                                       name, n.cover, n.cover_src, n.manhole_id)
            self.node_of[nid] = name
            if kind == "chamber":
                self.chambers[name] = nid
        out = self.nodes["OUT"]
        if whole and case.stage is not None:
            out.stage = out.invert + case.stage
        if not whole:
            out.stage = outlet_head
            # Nesting (X4): the segment's side exits discharge into the rest of the network,
            # which can be surcharged. Measured 24 Sep: leaving them FREE made the segment
            # miss backwater at 0.25 L/s per 100 m. Each takes the whole run's level there.
            for nid, h in (exit_heads or {}).items():
                nm = self.node_of.get(nid)
                if nm and self.nodes[nm].kind == "outfall":
                    self.nodes[nm].stage = h

        used = set()
        for pi in sorted(pipes):
            p = net.pipes[pi]
            up, dn = self.node_of[p.up], self.node_of[p.down]
            label = f"{up}>{dn}"
            if label in used:
                label = f"{label}#{p.asset_id}"
            used.add(label)
            role = "exit" if pi in exits else "study"
            self.links.append(SimLink(label, label, role, up, dn, p.inv_up, p.inv_down,
                                      p.dia, p.length, p.line))
            info = PipeInfo(label, p.asset_id, role, up, dn, p.dia, p.length, p.slope,
                            p.material, p.year)
            info.links.append(label)
            self.pipes.append(info)
        # SWMM allows one inlet per outfall (error 141). Where several pipes meet at an
        # outfall node, that node becomes an ordinary junction and the outfall hangs off it
        # by a 1 m, 1 m bore dummy pipe with a 1 mm fall: it carries the flow without
        # adding a measurable head loss, and a FIXED level applies at its end.
        inlets = {}
        for lk in self.links:
            inlets[lk.down] = inlets.get(lk.down, 0) + 1
        for name, n in list(self.nodes.items()):
            if n.kind != "outfall" or inlets.get(name, 0) <= 1:
                continue
            j = "J" + name
            self.nodes[j] = replace_node(n, j, "inline", max(n.max_depth, 0.5))
            for lk in self.links:
                if lk.down == name:
                    lk.down = j
            o = self.nodes[name]
            o.invert = n.invert - 0.001
            self.links.append(SimLink(f"{j}>{name}", "dummy", "dummy", j, name, n.invert,
                                      n.invert - 0.001, 1.0, 1.0, [(n.x, n.y), (n.x, n.y)]))
            nid = next(k for k, v in self.node_of.items() if v == name)
            self.node_of[nid] = j
        for k, (wet, dis, rm) in enumerate(pump_pairs):
            self.pumps.append((f"P{rm}", self.node_of[wet], self.node_of[dis]))

        # Segment outlet level is what the nesting hands over: record it in whole runs.
        seg_tail = net.pipes[net.nodes[SEGMENT_OUTLET].outs[0]]
        self.watch_nids = []
        if whole and seg_tail.down in self.node_of:
            self.watch_nids = [seg_tail.down] + segment_exit_nodes(net)
            self.watch_nids = [n for n in self.watch_nids if n in self.node_of]
            self.watch = [self.node_of[n] for n in self.watch_nids]
        self._pipe_ids = pipes
        self._exits = set(exits)
        self._loads()

    # ------------------------------------------------------------------ loads
    def _loads(self):
        net, c = self.net, self.case
        q_person = LITRES_PER_PERSON_DAY / 86400.0
        # An entry landing on an outfall (the model's outlet or an exit pipe's end) leaves at
        # once and cannot affect anything modelled, so it is not loaded.
        entries = [e for e in boundary_entries(net) if e["node"] in self.node_of
                   and self.nodes[self.node_of[e["node"]]].kind != "outfall"]
        pop = PEOPLE_PER_CONNECTION * (
            sum(net.pipes[i].dwellings for i in self._domain_pipes())
            + sum(e["connections"] for e in boundary_entries(net)
                  if e["node"] in self._domain_nodes()))
        self.population = pop
        self.pf = harmon(pop) if c.pf == "harmon" else PF_NOMINAL
        # Sewage multiplier for this hour of the day (I&I does not follow the daily cycle).
        self.sew = self.pf if c.hour == "peak" else TROUGH_FACTOR
        # Age weights renormalised over the WHOLE domain so each weather level's total I&I is
        # unchanged, and so the segment and whole runs use identical weights (nesting).
        if c.age == "weighted":
            dp = self._domain_pipes()
            tot = sum(net.pipes[i].length for i in dp)
            wtot = sum(net.pipes[i].length * age_weight(net.pipes[i].year) for i in dp)
            norm = tot / wtot
        q = {name: 0.0 for name, n in self.nodes.items() if n.kind != "outfall"}
        self.sewage_lps = self.ii_lps = self.boundary_lps = self.growth_lps = 0.0
        for pi in self._pipe_ids:
            if pi in self._exits:
                continue
            p = net.pipes[pi]
            name = self.node_of[p.up]
            if name not in q:
                continue
            s = p.dwellings * PEOPLE_PER_CONNECTION * q_person * self.sew
            w = age_weight(p.year) * norm if c.age == "weighted" else 1.0
            i = p.length / 100.0 * c.ii * w
            q[name] += s + i
            self.sewage_lps += s
            self.ii_lps += i
        for e in entries:
            b = c.bfac * (e["connections"] * PEOPLE_PER_CONNECTION * q_person * self.sew
                          + e["length_m"] / 100.0 * c.ii)
            q[self.node_of[e["node"]]] += b
            self.boundary_lps += b
        self.entries = entries
        by_mh = {n.manhole_id: name for name, n in self.nodes.items() if n.manhole_id}
        adds = [(by_mh[int(mh)], d) for mh, d in self.growth.items()]
        adds += [(self.node_of[nid], d) for nid, d in self.growth_nodes.items()
                 if nid in self.node_of]
        for name, d in adds:
            g = d * PEOPLE_PER_NEW_DWELLING * q_person * self.sew
            q[name] += g
            self.growth_lps += g
        self._q = q

    def _outlet_nid(self):
        return DOMAIN_END if self.whole else self.net.pipes[
            self.net.nodes[SEGMENT_OUTLET].outs[0]].down

    def _domain_pipes(self):
        if "dom" not in _NET:
            net = self.net
            d = set(net.upstream_pipes(DOMAIN_END))
            nodes = {net.pipes[i].up for i in d} | {net.pipes[i].down for i in d}
            for wet, dis, _ in pump_links(net):
                if dis in nodes:        # a station pumping out of Walkerville is not ours
                    d |= set(net.upstream_pipes(wet))
            _NET["dom"] = d
        return _NET["dom"]

    def _domain_nodes(self):
        if "domn" not in _NET:
            net = self.net
            _NET["domn"] = ({net.pipes[i].up for i in self._domain_pipes()}
                            | {net.pipes[i].down for i in self._domain_pipes()})
        return _NET["domn"]

    def base_loads(self, unit=None):
        return dict(self._q)

    def stage_levels(self):
        out = {}
        for ch in self.chambers:
            n = self.nodes[ch]
            outs = [lk for lk in self.links if lk.up == ch]
            if not outs:
                continue
            first = min(outs, key=lambda lk: lk.inv_up)
            crown = first.inv_up - n.invert + first.dia
            out[ch] = {"half pipe": crown / 2, "surcharge": crown,
                       "half shaft": n.max_depth / 2, "spill": n.max_depth}
        return out

    @property
    def study_chambers(self):
        """X2: the 71 growth sites and sensor candidates, by SWMM name."""
        seg = set(self.net.upstream_pipes(SEGMENT_OUTLET))
        seg_nodes = {self.net.pipes[i].up for i in seg} | {SEGMENT_OUTLET}
        return sorted(c for c, nid in self.chambers.items() if nid in seg_nodes)


# ====================================================================== running
def settled(m, res, window_min=10):
    """Per chamber over the final window: depth, surcharged, above the detection depth (G6),
    spilled. Same logic as catchment.settled plus the 150 mm alarm."""
    s, t = res.s, res.s["t"]
    keep = t >= (t[-1] - window_min * 60)
    lv = m.stage_levels()
    out = {}
    for i, c in enumerate(m.chambers):
        d = float(np.max(s["depth"][keep, i]))
        crown = lv.get(c, {}).get("surcharge")
        out[c] = {"depth": d,
                  "surcharged": bool(crown is not None and d >= crown - 1e-4),
                  "alarm": bool(d >= DETECT_DEPTH_M),
                  "spilled": bool(float(np.max(s["flood"][keep, i])) > 1e-6)}
    return out


class _Steady:
    kind, peak, warmup, growth_site, growth_lps, unit = "constant", 1.0, 0, None, 0.0, 0.0

    def __init__(self, minutes, record_last_min=12):
        self.minutes = minutes
        self.record_from_s = max(0, (minutes - record_last_min) * 60)

    def shape(self):
        return [(0, 1.0), (self.minutes, 1.0)]

    def describe(self, split=None):
        return "Sim 2.5 steady"


def solve(m, minutes, out_dir):
    """Returns (result, settled state, head at the segment outlet). After a whole run,
    m.exit_heads holds the settled level at each segment side exit, for nesting."""
    res = model.run(m, _Steady(minutes), out_dir)
    st = settled(m, res)
    head = None
    m.exit_heads = {}
    if m.watch and len(res.s["watch_head"]):
        wh = np.max(res.s["watch_head"][-6:, :], axis=0)
        head = float(wh[0])
        m.exit_heads = {nid: float(h) for nid, h in zip(m.watch_nids[1:], wh[1:])}
    return res, st, head


def segment_exit_nodes(net):
    """Downstream nodes of pipes leaving the study segment other than its outlet pipe."""
    seg = set(net.upstream_pipes(SEGMENT_OUTLET))
    tail = net.pipes[net.nodes[SEGMENT_OUTLET].outs[0]]
    nids = {net.pipes[i].up for i in seg} | {net.pipes[i].down for i in seg} | {tail.down}
    return sorted({p.down for p in net.pipes if p.up in nids and p.up != tail.down
                   and p.id not in seg and p.id != tail.id and p.down not in nids})


# ====================================================================== CLI
def describe():
    net = network()
    case = Case()
    w = Sim25Model(case, whole=True)
    s = Sim25Model(case, whole=False, outlet_head=w.nodes["OUT"].invert)
    print(f"network: {len(net.pipes)} council pipes incl. overflow; skipped {dict(net.skipped)}")
    for tag, m in (("whole", w), ("segment", s)):
        kinds = {k: sum(1 for n in m.nodes.values() if n.kind == k)
                 for k in ("chamber", "inline", "outfall")}
        print(f"{tag:8s} {len(m.links)} links, nodes {kinds}, pumps {len(m.pumps)}, "
              f"study chambers {len(m.study_chambers)}, exits {len(m._exits)}")
        print(f"         load {sum(m.base_loads().values()):.2f} L/s = sewage {m.sewage_lps:.2f}"
              f" + I&I {m.ii_lps:.2f} + boundary {m.boundary_lps:.2f} (PF {m.pf:.2f},"
              f" population {m.population:.0f})")
    print("boundary entries in the whole domain:")
    for e in w.entries:
        print(f"   {e['kind']:32s} id {e['id']:>9} -> node {e['node']:>5} "
              f"{e['length_m']:7.0f} m, {e['connections']:6.1f} connections"
              + ("   [into segment]" if e["node"] in {net.pipes[i].up for i in
                                                     net.upstream_pipes(SEGMENT_OUTLET)}
                 else ""))
    print("pumps:", w.pumps)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--describe", action="store_true")
    ap.add_argument("--whole", action="store_true")
    ap.add_argument("--minutes", type=int, default=1440)
    ap.add_argument("--ii", type=float, default=0.11)
    args = ap.parse_args()
    if args.describe:
        describe()
        return
    if args.whole:
        m = Sim25Model(Case(ii=args.ii), whole=True)
        res, st, head = solve(m, args.minutes, os.path.join(OUT_DIR, "single"))
        seg = set(m.study_chambers)
        print(f"err {res.err:.2f}%  study: surcharged "
              f"{sum(st[c]['surcharged'] for c in seg)}, alarm "
              f"{sum(st[c]['alarm'] for c in seg)} of {len(seg)}; segment outlet head {head}")


if __name__ == "__main__":
    main()
