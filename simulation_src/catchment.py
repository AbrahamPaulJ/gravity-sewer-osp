#!/usr/bin/env python3
"""
catchment.py - a whole drainage catchment as a steady-state SWMM model, loaded by
connected dwellings rather than by assumed density, so that growth can be asked in
houses instead of in litres per second.

WHAT CHANGED, AND WHY IT MATTERS

The four-chamber model at junction 441 carried 97.8% of its water in as a single lump at
chamber A with no travel time, because the 7.8 km above A was outside the model. That is
assumption L4, and the register calls it the largest simplification. It is also avoidable:
the catchment above A is already in the cached Walkerville layer, 157 pipes over 155 nodes.
CORRECTED 24 Sep: not all of it. Three pipes outside the council extract, about 3.2 km of
sewer, also drain in (overlap_check.py, ASSUMPTIONS H12). What the council holds was
excluded, not missing; what it does not hold is still missing until the domain upgrade.

Including it retires L4 outright. Flow now accumulates through real geometry.

Load no longer comes from ASSUMPTIONS L5's assumed 13 properties per 100 m of sewer.
Layer 4 of the published service is one point per connected property, carrying PARCELID on
every record, so `network.Network` counts them per pipe. Measured 16 Sep: 643 connected
properties above A over 7,781 m, which is 8.3 per 100 m, not 13. The old figure overstated
the population above A by about 1.6x.

STEADY STATE ONLY. There is no event here and no time-varying anything. A constant load is
held until the network settles, and the settled state is the answer. Growth is a permanent
change in how many houses drain to a chamber, so a permanent change in load is the right
question to ask of it. Warning time from a passing storm is a different question and lives
in the warning experiment.

WHAT "TROUBLE" MEANS HERE

A chamber surcharges when water rises above the crown of its outlet pipe: the pipe is full
and the chamber has started to fill. That is the sandbox's over-capacity condition, and it
is the thing a level sensor can see. Spill, water leaving the lid, is the consequence; it
is reported too but it is not the trigger.

Usage:
    python catchment.py --list                       # candidate outlet chambers
    python catchment.py --outlet 583                 # baseline, settled
    python catchment.py --outlet 583 --add 120 --at 4450193
"""
import argparse, json, math, os

import numpy as np

import model
from model import SimNode, SimLink, PipeInfo
from network import Network

# ASSUMPTIONS L5, restated per dwelling instead of per metre of sewer. 2.5 people at 200 L
# per person per day is the same chain as before; only the property COUNT stops being
# assumed. Still not a figure from the network operator, so still an assumption.
LITRES_PER_DWELLING_DAY = 500.0
LPS_PER_DWELLING = LITRES_PER_DWELLING_DAY / 86400.0      # 0.005787 L/s

# Average dry weather flow is not the condition that fills a sewer. Capacity is assessed at
# a peak, and the four-chamber model used 2x for the same reason. It stays an explicit,
# overridable parameter rather than being folded into the per-dwelling figure, because it
# is the number most likely to be replaced by a real one.
PEAK_FACTOR = 2.0

# Infiltration and inflow, in L/s per 100 m of sewer.
#
# THIS DIAL EXISTS BECAUSE GROWTH ALONE CANNOT SURCHARGE THIS CATCHMENT. Measured 16 Sep
# against full-bore Manning capacity: at peak dry weather flow the worst of the 157 reaches
# runs at 28.3% full and the median at 0.8%. Filling the worst one on sewage alone would
# take about 2,274 dwellings where there are 643. Sewers are not sized for houses, they are
# sized for wet weather, so a model with no I&I in it cannot answer a question about
# surcharge and would make any growth look harmless.
#
# Note the BASIS differs from sewage on purpose, and this is the part worth keeping:
#   sewage        is proportional to DWELLINGS, which are now counted, not assumed
#   infiltration  is proportional to PIPE LENGTH, because it enters through the pipe
#                 itself, through joints, cracks and bad connections
# The old four-chamber model put both on length, which is right for one and wrong for the
# other. 0 is a genuine dry day; the default is a wet one. Still assumed, and the single
# most valuable thing a flow survey would replace.
II_PER_100M = 0.25


class Catchment:
    """Every pipe draining to one chamber, plus that chamber's outlet pipe.

    Presents the same surface as model.Neighbourhood (nodes, links, pipes, chambers,
    base_loads, stage_levels) so model.write_inp and model.run work on it unchanged.

    A node is a `chamber` only where the published manhole layer puts a manhole on it.
    The rest are real pipe ends, mostly bends, dead ends and junction fittings, and they
    are modelled as sealed junctions that can pressurise but not overflow (H10). That is
    a choice with consequences: only a node the record calls a chamber can spill here, so
    spill is concentrated at the 71 chambers rather than spread over all 155 nodes.
    """

    def __init__(self, net, outlet_nid, peak_factor=PEAK_FACTOR, growth=None,
                 ii_per_100m=II_PER_100M):
        self.net = net
        self.outlet_nid = outlet_nid
        self.peak_factor = peak_factor
        self.ii_per_100m = ii_per_100m
        self.growth = dict(growth or {})       # manhole_id -> added dwellings

        out_node = net.nodes[outlet_nid]
        if not out_node.outs:
            raise SystemExit(f"node {outlet_nid} has no outgoing pipe, cannot be an outlet")
        pipe_ids = list(net.upstream_pipes(outlet_nid))
        if not pipe_ids:
            raise SystemExit(f"node {outlet_nid} has nothing upstream of it")
        self.tail = net.pipes[out_node.outs[0]]    # the pipe below the outlet chamber

        nids = set()
        for pi in pipe_ids:
            p = net.pipes[pi]
            nids.add(p.up)
            nids.add(p.down)
        nids.add(outlet_nid)

        self.nodes, self.links, self.pipes = {}, [], []
        self.chambers = {}          # SWMM node name -> network node id
        self.node_of = {}           # network node id -> SWMM node name
        for nid in sorted(nids):
            n = net.nodes[nid]
            name = f"MH{n.manhole_id}" if n.is_chamber else f"N{nid}"
            kind = "chamber" if n.is_chamber else "inline"
            # A node with no ground level at all only occurs in the extended domains
            # (domain.py); D0 never reaches this fallback, so its results are unchanged.
            nd = n.depth if math.isfinite(n.depth) else 0.5
            depth = nd if n.is_chamber else max(nd, 0.5)
            self.nodes[name] = SimNode(name, kind, n.x, n.y, n.invert, depth,
                                       name, n.cover, n.cover_src, n.manhole_id)
            self.node_of[nid] = name
            if kind == "chamber":
                self.chambers[name] = nid

        ox, oy = self.tail.line[-1]
        self.nodes["OUT"] = SimNode("OUT", "outfall", ox, oy, self.tail.inv_down, 0.0, "OUT")
        self.node_of[self.tail.down] = "OUT"

        if not getattr(net, "has_dwellings", True):
            raise SystemExit(
                "the inspection points layer is not cached, so every pipe has zero "
                "dwellings and this model would have no sewage in it. "
                "Run:  python fetch_data.py")
        self.dwellings = {}         # SWMM node name -> dwellings draining in there
        self.metres = {}            # SWMM node name -> metres of sewer entering there
        used = set()
        for pi in pipe_ids + [self.tail.id]:
            p = net.pipes[pi]
            up, down = self.node_of[p.up], self.node_of.get(p.down, "OUT")
            role = "outlet" if pi == self.tail.id else "study"
            label = f"{up}>{down}"
            # Twin pipes between the same two nodes exist on the trunk below 583 (assets
            # 8609340 and 8609341); SWMM needs distinct link names. Never hit in D0.
            if label in used:
                label = f"{label}#{p.asset_id}"
            used.add(label)
            info = PipeInfo(label, p.asset_id, role, up, down, p.dia, p.length, p.slope,
                            p.material, p.year)
            lk = SimLink(label, label, role, up, down, p.inv_up, p.inv_down,
                         p.dia, p.length, p.line)
            self.links.append(lk)
            info.links.append(lk.name)
            self.pipes.append(info)
            # Connections sit along a pipe, but at a median pipe length of 50 m entering at
            # its top end is already finer than the question needs, and it avoids inventing
            # several hundred extra nodes.
            if role == "study":
                self.dwellings[up] = self.dwellings.get(up, 0) + p.dwellings
                self.metres[up] = self.metres.get(up, 0.0) + p.length

        # Growth is expressed against manhole ids, because that is what a person can point
        # at on a map. Anything that does not resolve is an error, never a silent no-op.
        if self.base_dwellings == 0:
            raise SystemExit(f"no dwellings attributed above node {outlet_nid}; "
                             "the inspection points layer may be stale")
        by_mh = {n.manhole_id: name for name, n in self.nodes.items() if n.manhole_id}
        self.growth_at = {}
        for mh, extra in self.growth.items():
            if int(mh) not in by_mh:
                raise SystemExit(f"manhole {mh} is not a chamber in this catchment")
            self.growth_at[by_mh[int(mh)]] = extra

    # ------------------------------------------------------------------ loads
    @property
    def base_dwellings(self):
        return sum(self.dwellings.values())

    @property
    def added_dwellings(self):
        return sum(self.growth_at.values())

    def base_loads(self, unit=None):
        """L/s per node. `unit` is ignored: load comes from dwellings, not from a density.

        Kept in the signature because model.write_inp calls it that way, and changing the
        caller would fork a file the warning experiment still depends on.
        """
        q = {name: 0.0 for name, n in self.nodes.items() if n.kind != "outfall"}
        for name, d in self.dwellings.items():
            q[name] += d * LPS_PER_DWELLING * self.peak_factor
        for name, extra in self.growth_at.items():
            q[name] += extra * LPS_PER_DWELLING * self.peak_factor
        # Infiltration follows the pipe, not the houses. New dwellings add sewage but no
        # new I&I here, because a new connection is new pipe in good condition.
        for name, m in self.metres.items():
            q[name] += m / 100.0 * self.ii_per_100m
        return q

    @property
    def sewage_lps(self):
        return (self.base_dwellings + self.added_dwellings) * LPS_PER_DWELLING * self.peak_factor

    @property
    def ii_lps(self):
        return sum(self.metres.values()) / 100.0 * self.ii_per_100m

    def stage_levels(self):
        """Depth above each chamber's floor at which it surcharges and then spills."""
        out = {}
        for c in self.chambers:
            n = self.nodes[c]
            outs = [lk for lk in self.links if lk.up == c]
            if not outs:
                continue
            first = min(outs, key=lambda lk: lk.inv_up)
            crown = first.inv_up - n.invert + first.dia
            out[c] = {"half pipe": crown / 2, "surcharge": crown,
                      "half shaft": n.max_depth / 2, "spill": n.max_depth}
        return out


class Steady:
    """A constant load held long enough to settle. The only scenario this module has."""
    kind = "constant"
    peak = 1.0
    warmup = 0
    # model.write_inp reads these to decide whether to add a growth inflow of its own.
    # Growth here is a change in DWELLINGS, folded into base_loads, so they stay off.
    growth_site = None
    growth_lps = 0.0

    def __init__(self, minutes=90, hotstart_use=None, hotstart_save=None, record_last_min=None):
        self.minutes = minutes
        self.unit = 0.0
        # Hot start and recording window, used by the extended domains (domain_grid.py).
        # All off by default, so every existing caller gets exactly what it got before.
        self.hotstart_use, self.hotstart_save = hotstart_use, hotstart_save
        self.record_from_s = 0 if record_last_min is None else (minutes - record_last_min) * 60

    def shape(self):
        return [(0, 1.0), (self.minutes, 1.0)]

    def describe(self, split=None):
        return f"steady load held {self.minutes} min, from connected dwellings"


def settled(cat, res, window_min=10):
    """State over the last `window_min` of the run, which is the answer.

    Reported per chamber: settled depth, whether it is above the outlet crown
    (surcharged), and whether SWMM flooded it (spilled).
    """
    s = res.s
    t = s["t"]
    keep = t >= (t[-1] - window_min * 60)
    lv = cat.stage_levels()
    chambers = list(cat.chambers)
    out = {}
    for i, c in enumerate(chambers):
        d = float(np.max(s["depth"][keep, i]))
        fl = float(np.max(s["flood"][keep, i]))
        crown = lv.get(c, {}).get("surcharge")
        out[c] = {
            "depth": d,
            "crown": crown,
            "surcharged": bool(crown is not None and d >= crown - 1e-4),
            "spilled": bool(fl > 1e-6),
            "maxDepth": cat.nodes[c].max_depth,
            "manholeId": cat.nodes[c].manhole_id,
        }
    return out


def solve(net, outlet_nid, growth=None, minutes=120, peak_factor=PEAK_FACTOR,
          ii_per_100m=II_PER_100M, out_dir=None, **steady):
    """Build, run and settle one steady state. Returns (catchment, result, settled).

    120 minutes is the default because that is where this catchment stops moving: measured
    16 Sep, outflow equals total inflow to four decimal places and no chamber depth changes
    in the last 10 minutes. SWMM's continuity error is about -0.7% and halves every time
    the run doubles, which is the signature of the fixed volume used to fill 7.8 km of
    initially empty pipe rather than of anything numerical. For a steady state the check
    that matters is that outflow has converged on inflow, and it has.
    """
    cat = Catchment(net, outlet_nid, peak_factor=peak_factor, growth=growth,
                    ii_per_100m=ii_per_100m)
    sc = Steady(minutes, **steady)
    out_dir = out_dir or os.path.join(model.RESULTS, "catchment", "tmp")
    res = model.run(cat, sc, out_dir)
    return cat, res, settled(cat, res)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outlet", type=int, default=583)
    ap.add_argument("--minutes", type=int, default=120)
    ap.add_argument("--ii", type=float, default=II_PER_100M,
                    help="infiltration, L/s per 100 m of sewer; 0 for a dry day")
    ap.add_argument("--peak", type=float, default=PEAK_FACTOR)
    ap.add_argument("--add", type=int, default=0, help="dwellings to add")
    ap.add_argument("--at", type=int, help="manhole id to add them at")
    ap.add_argument("--list", action="store_true", help="candidate outlet chambers")
    args = ap.parse_args()

    net = Network()
    if args.list:
        rows = []
        for n in net.nodes:
            if not n.is_chamber:
                continue
            ups = net.upstream_pipes(n.id)
            if len(ups) < 20:
                continue
            rows.append((len(ups), sum(net.pipes[i].length for i in ups),
                         net.dwellings_upstream(n.id), n.id, n.manhole_id))
        rows.sort(reverse=True)
        print(f"{'pipes':>6} {'metres':>9} {'dwellings':>10} {'node':>6}  manhole")
        for r in rows[:25]:
            print(f"{r[0]:6d} {r[1]:9.0f} {r[2]:10d} {r[3]:6d}  {r[4]}")
        return

    growth = {args.at: args.add} if (args.add and args.at) else None
    cat, res, st = solve(net, args.outlet, growth=growth, minutes=args.minutes,
                         peak_factor=args.peak, ii_per_100m=args.ii)
    total = sum(cat.base_loads().values())
    print(f"catchment above node {args.outlet}: {len(cat.pipes)} pipes, "
          f"{len(cat.chambers)} chambers, {len(cat.nodes) - 1} nodes")
    print(f"dwellings {cat.base_dwellings}" +
          (f" + {cat.added_dwellings} added" if cat.added_dwellings else ""))
    print(f"load {total:.2f} L/s = sewage {cat.sewage_lps:.2f} (peak factor "
          f"{cat.peak_factor:g}) + I&I {cat.ii_lps:.2f} "
          f"({cat.ii_per_100m:g} L/s per 100 m)")
    print(f"SWMM flow continuity error {res.err:.2f}%")
    sur = [c for c, v in st.items() if v["surcharged"]]
    spl = [c for c, v in st.items() if v["spilled"]]
    print(f"surcharged {len(sur)} of {len(st)} chambers; spilling {len(spl)}")
    for c in sorted(sur, key=lambda c: -st[c]["depth"])[:12]:
        v = st[c]
        print(f"   {c:12s} depth {v['depth']:5.2f} m of {v['maxDepth']:5.2f} "
              f"(crown {v['crown']:.2f})" + ("  SPILLING" if v["spilled"] else ""))


if __name__ == "__main__":
    main()
