"""
model.py - one neighbourhood as a SWMM model: geometry, loads, scenarios, run, save.

Used by hydraulics.py (single runs) and experiments.py (load ladder, growth, warning time).

LOAD SPLITS (how sewage enters, see ASSUMPTIONS.md section L)

    equal      the same L/s into every chamber. The original exploration device, kept
               only for comparison. Unit: L/s per chamber.
    catchment  load in proportion to the sewer length it comes from. A chamber receives
               the whole real network upstream of it that the model does not contain
               (A: 7.8 km), and each modelled pipe's own length is added at its upstream
               chamber. Unit: L/s per 100 m of sewer.
    along      as catchment, but each modelled pipe's own load enters along the pipe, one
               share per segment of about SEG_LEN metres, the way house connections do.
               Unit: L/s per 100 m of sewer.

SCENARIOS (how load changes in time; every node's inflow = its base load x shape(t))

    constant   shape 1 throughout
    ramp       shape rises 0 -> 1 over the run (the original, time and load entangled)
    step       shape 1 for the warm-up, then jumps to `peak`
    event      shape 1 for the warm-up, rises to `peak`, holds, falls back to 1
    growth     an extra constant L/s at one chamber, on top of any of the above
"""
import json, math, os
from dataclasses import dataclass, field, asdict

import numpy as np
import pyswmm
from pyswmm import Simulation, Nodes, Links

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "results")

MANNING_N = 0.013                        # H3, the fallback where material is unknown

# Manning's n by the publisher's material code. Conventional design values, not
# measurements: Chow (1959) Open-Channel Hydraulics Table 5-6, the same table the
# SWMM reference manual reproduces and from which SWMM takes its own 0.013 default
# for concrete pipe. Vitrified clay and reinforced concrete sit at 0.013, uPVC is
# smoother at 0.010.
#
# The layer publishes a ROUGHNESS field, which would settle this from data. It is
# populated on no record in this catchment, so this stays a declared table keyed to
# a published attribute rather than a measurement. MATERIAL itself is published on
# every record once MATERIALUN is read alongside it.
#
# Walkerville is roughly nine parts clay to one part uPVC, so this moves a tenth of
# the network and leaves the rest where it was.
MANNING_BY_MATERIAL = {"VC": 0.013, "PVCU": 0.010, "RC": 0.013}


def manning_of(material):
    """Roughness for a pipe, falling back to MANNING_N for an unknown code."""
    return MANNING_BY_MATERIAL.get((material or "").strip().upper(), MANNING_N)
CHAMBER_AREA = math.pi * 0.525 ** 2      # H8, m2, 1050 mm chamber
INLINE_AREA = 0.02                       # H10, m2, token area at in-pipe segment nodes
SEG_LEN = 15.0                           # L3, m, target segment length for `along`
REPORT_S = 10
ROUTE_S = 0.5
SPLITS = ("equal", "catchment", "along")
UNIT_LABEL = {"equal": "L/s per chamber", "catchment": "L/s per 100 m of sewer",
              "along": "L/s per 100 m of sewer"}

# Indicative dry weather flow, for putting results in context only. Every input is
# assumed, none is from the network operator: see ASSUMPTIONS.md L5. Replace when the utility supplies
# a design figure.
ADWF_REF = 0.075                         # L/s per 100 m of sewer


# ------------------------------------------------------------------ geometry
@dataclass
class SimNode:
    name: str
    kind: str            # chamber | inline | outfall
    x: float
    y: float
    invert: float
    max_depth: float
    label: str = ""      # A, B, J, D for chambers
    cover: float = math.nan
    cover_src: str = ""
    manhole_id: int | None = None


@dataclass
class SimLink:
    name: str
    pipe: str            # which real pipe this is part of, e.g. "B-J"
    role: str            # study | outlet
    up: str
    down: str
    inv_up: float
    inv_down: float
    dia: float
    length: float
    line: list
    material: str = ""   # carried so the conduit writer can pick a roughness


@dataclass
class PipeInfo:
    label: str
    asset_id: int
    role: str
    up: str
    down: str
    dia: float
    length: float
    slope: float
    material: str
    year: int
    links: list = field(default_factory=list)


def _cut_line(line, length, fractions):
    """Points at the given fractions of distance along a polyline, plus sub-polylines."""
    xy = np.asarray(line, float)
    cum = np.r_[0, np.cumsum(np.hypot(*np.diff(xy, axis=0).T))]
    total = cum[-1]

    def at(f):
        d = f * total
        i = int(np.clip(np.searchsorted(cum, d) - 1, 0, len(xy) - 2))
        t = (d - cum[i]) / max(cum[i + 1] - cum[i], 1e-9)
        return tuple(xy[i] + t * (xy[i + 1] - xy[i]))

    pieces = []
    for f0, f1 in zip(fractions[:-1], fractions[1:]):
        inner = [tuple(p) for p, c in zip(xy, cum) if f0 * total < c < f1 * total]
        pieces.append([at(f0)] + inner + [at(f1)])
    return pieces


class Neighbourhood:
    """Chambers A, B (upstream), J (junction), D (downstream), three study pipes, and the
    real outlet pipe below D draining to a free outfall."""

    def __init__(self, net, junction, split="along"):
        if split not in SPLITS:
            raise ValueError(split)
        self.net, self.junction, self.split = net, junction, split
        j = net.nodes[junction]
        if not (len(j.ins) == 2 and len(j.outs) == 1):
            raise SystemExit(f"node {junction} is not a two-in, one-out junction")
        p_a, p_b = (net.pipes[i] for i in j.ins)
        p_jd = net.pipes[j.outs[0]]
        d = net.nodes[p_jd.down]
        if not d.outs:
            raise SystemExit(f"chamber below {junction} has no outgoing pipe")
        p_out = net.pipes[d.outs[0]]
        self.study_ids = {p_a.id, p_b.id, p_jd.id}

        self.nodes: dict[str, SimNode] = {}
        self.links: list[SimLink] = []
        self.pipes: list[PipeInfo] = []
        self.chambers = {}
        for label, nid in (("A", p_a.up), ("B", p_b.up), ("J", junction), ("D", d.id)):
            n = net.nodes[nid]
            self.nodes[label] = SimNode(label, "chamber", n.x, n.y, n.invert, n.depth,
                                        label, n.cover, n.cover_src, n.manhole_id)
            self.chambers[label] = nid
        ox, oy = p_out.line[-1]
        self.nodes["OUT"] = SimNode("OUT", "outfall", ox, oy, p_out.inv_down, 0.0, "OUT")

        segmented = split == "along"
        for p, up, down, role in ((p_a, "A", "J", "study"), (p_b, "B", "J", "study"),
                                  (p_jd, "J", "D", "study"), (p_out, "D", "OUT", "outlet")):
            label = f"{up}-{down}" if down != "OUT" else "D-out"
            k = max(1, math.ceil(p.length / SEG_LEN)) if (segmented and role == "study") else 1
            fr = [i / k for i in range(k + 1)]
            pieces = _cut_line(p.line, p.length, fr)
            names = [up] + [f"{label}.{i}" for i in range(1, k)] + [down]
            for i in range(1, k):
                x, y = pieces[i][0]
                inv = p.inv_up + (p.inv_down - p.inv_up) * fr[i]
                self.nodes[names[i]] = SimNode(names[i], "inline", x, y, inv, p.dia)
            info = PipeInfo(label, p.asset_id, role, up, down, p.dia, p.length, p.slope,
                            p.material, p.year)
            for i in range(k):
                lk = SimLink(f"{label}~{i}" if k > 1 else label, label, role, names[i],
                             names[i + 1],
                             p.inv_up + (p.inv_down - p.inv_up) * fr[i],
                             p.inv_up + (p.inv_down - p.inv_up) * fr[i + 1],
                             p.dia, p.length / k, pieces[i], p.material)
                self.links.append(lk)
                info.links.append(lk.name)
            self.pipes.append(info)

        # Real sewer draining into each chamber that the model does not contain. Collected
        # as a set of pipes, not of nodes: 9 chambers above A have two outlets, and walking
        # by node silently drops the second pipe (A: 157 pipes, 7,781 m, not 154 / 7,601 m).
        # All of it is assumed to reach A, although those 9 split their flow (L2).
        self.external_m = {}
        for label, nid in self.chambers.items():
            ids = set()
            for pi in net.nodes[nid].ins:
                if pi in self.study_ids:
                    continue
                ids.add(pi)
                ids.update(net.upstream_pipes(net.pipes[pi].up))
            self.external_m[label] = sum(net.pipes[q].length for q in ids - self.study_ids)

    # ----------------------------------------------------------------- loads
    def base_loads(self, unit):
        """L/s per node at shape = 1."""
        q = {name: 0.0 for name, n in self.nodes.items() if n.kind != "outfall"}
        if self.split == "equal":
            for c in self.chambers:
                q[c] = unit
            return q
        per_m = unit / 100.0
        for c in self.chambers:
            q[c] += self.external_m[c] * per_m
        for lk in self.links:
            if lk.role == "study":
                q[lk.up] += lk.length * per_m
        return q

    def stage_levels(self):
        """Depth above chamber floor at which each stage is reached (T section)."""
        out = {}
        for c in self.chambers:
            n = self.nodes[c]
            first = next(lk for lk in self.links if lk.up == c)
            crown = first.inv_up - n.invert + first.dia
            out[c] = {"half pipe": crown / 2, "surcharge": crown,
                      "half shaft": n.max_depth / 2, "spill": n.max_depth}
        return out


STAGES = ("half pipe", "surcharge", "half shaft", "spill")


# ------------------------------------------------------------------ scenarios
@dataclass
class Scenario:
    kind: str = "constant"       # constant | ramp | step | event
    unit: float = 0.1            # base load, in the split's unit
    minutes: int = 120
    peak: float = 1.0            # step / event multiplier
    warmup: int = 60             # minutes at shape 1 before a step or event
    rise: int = 30
    hold: int = 30
    fall: int = 60
    growth_site: str | None = None
    growth_lps: float = 0.0

    def shape(self):
        """(minute, multiplier) breakpoints."""
        T, w = self.minutes, self.warmup
        if self.kind == "constant":
            return [(0, 1.0), (T, 1.0)]
        if self.kind == "ramp":
            return [(0, 0.0), (T, 1.0)]
        if self.kind == "step":
            return [(0, 1.0), (w, 1.0), (w + 0.05, self.peak), (T, self.peak)]
        if self.kind == "event":
            a, b, c = w + self.rise, w + self.rise + self.hold, w + self.rise + self.hold + self.fall
            return [(0, 1.0), (w, 1.0), (a, self.peak), (b, self.peak), (c, 1.0), (max(T, c), 1.0)]
        raise ValueError(self.kind)

    def describe(self, split):
        u = f"{self.unit:g} {UNIT_LABEL[split]}"
        g = (f", plus {self.growth_lps:g} L/s growth at {self.growth_site}"
             if self.growth_site and self.growth_lps else "")
        return {
            "constant": f"constant {u}",
            "ramp": f"rising steadily from 0 to {u} over {self.minutes} min",
            "step": f"{u} for {self.warmup} min, then x{self.peak:g}",
            "event": (f"{u} for {self.warmup} min, then an event rising to x{self.peak:g} over "
                      f"{self.rise} min, holding {self.hold} min, falling over {self.fall} min"),
        }[self.kind] + g


# ------------------------------------------------------------------ SWMM
def write_inp(path, nh, sc):
    loads = nh.base_loads(sc.unit)
    shape = sc.shape()
    L = []
    w = L.append
    end_h, end_m = divmod(sc.minutes, 60)
    w("[OPTIONS]")
    for k, v in [("FLOW_UNITS", "LPS"), ("INFILTRATION", "HORTON"), ("FLOW_ROUTING", "DYNWAVE"),
                 ("LINK_OFFSETS", "ELEVATION"), ("START_DATE", "01/01/2026"),
                 ("START_TIME", "00:00:00"), ("REPORT_START_DATE", "01/01/2026"),
                 ("REPORT_START_TIME", "00:00:00"), ("END_DATE", "01/01/2026"),
                 ("END_TIME", f"{end_h:02d}:{end_m:02d}:00"),
                 ("REPORT_STEP", f"00:00:{REPORT_S:02d}"), ("ROUTING_STEP", str(ROUTE_S)),
                 ("ALLOW_PONDING", "NO"), ("INERTIAL_DAMPING", "PARTIAL"),
                 # SLOT, not EXTRAN (H11). Measured on the equal ramp at B: EXTRAN junctions
                 # stored no water while surcharged (shaft rose 1.3 m on 0 m3), and EXTRAN
                 # storage nodes behaved as 3.54 m2 with 12.4% continuity error. The
                 # Preissmann slot gives 0.93 m2 against a true 0.87 m2 shaft, error 0.1%.
                 ("NORMAL_FLOW_LIMITED", "BOTH"), ("SURCHARGE_METHOD", "SLOT"),
                 ("MIN_SURFAREA", f"{INLINE_AREA}"), ("LENGTHENING_STEP", "0")]:
        w(f"{k:22s}{v}")

    w("\n[JUNCTIONS]\n;;Name Invert MaxDepth InitDepth SurDepth Aponded")
    for n in nh.nodes.values():
        if n.kind == "inline":
            # no opening in a pipe: it can pressurise but never overflow (H10)
            w(f"{n.name} {n.invert:.3f} {n.max_depth:.3f} 0 100 0")

    w("\n[STORAGE]\n;;Name Elev MaxDepth InitDepth Shape Coeff Expon Const SurDepth Fevap")
    for n in nh.nodes.values():
        if n.kind == "chamber":
            w(f"{n.name} {n.invert:.3f} {n.max_depth:.3f} 0 FUNCTIONAL 0 0 {CHAMBER_AREA:.4f} 0 0")

    w("\n[OUTFALLS]\n;;Name Invert Type Stage Gated")
    # Every outfall node, not only OUT. A node with a `stage` attribute (absolute water
    # elevation, m) is a FIXED outfall: the downstream water level held there (Sim 2.5, X6).
    # Neither is used by the warning model or Sim 2, which write exactly one FREE outfall.
    for n in nh.nodes.values():
        if n.kind != "outfall":
            continue
        stage = getattr(n, "stage", None)
        if stage is None:
            w(f"{n.name} {n.invert:.3f} FREE NO")
        else:
            w(f"{n.name} {n.invert:.3f} FIXED {max(stage, n.invert):.3f} NO")

    # Pumps (Sim 2.5, L7): SWMM IDEAL pumps pass whatever reaches the wet well straight on.
    pumps = getattr(nh, "pumps", [])
    if pumps:
        w("\n[PUMPS]\n;;Name From To Curve Status Startup Shutoff")
        for name, frm, to in pumps:
            w(f"{name} {frm} {to} * ON 0 0")

    w("\n[CONDUITS]\n;;Name From To Length N InOffset OutOffset InitFlow")
    for lk in nh.links:
        n = manning_of(getattr(lk, "material", ""))
        w(f"{lk.name} {lk.up} {lk.down} {lk.length:.3f} {n} {lk.inv_up:.4f} {lk.inv_down:.4f} 0")

    w("\n[XSECTIONS]\n;;Link Shape Geom1 Geom2 Geom3 Geom4 Barrels")
    for lk in nh.links:
        w(f"{lk.name} CIRCULAR {lk.dia:.3f} 0 0 0 1")

    # One series per loaded node: base x shape(t), plus any growth held constant.
    # SWMM allows a single FLOW inflow per node, so growth is folded in here.
    if sc.growth_site and sc.growth_lps:
        loads = dict(loads)
        loads.setdefault(sc.growth_site, 0.0)
    w("\n[TIMESERIES]\n;;Name Time(h) Value")
    inflows = []
    for i, (name, q) in enumerate(loads.items()):
        g = sc.growth_lps if name == sc.growth_site else 0.0
        if q <= 0 and g <= 0:
            continue
        ts = f"Q{i}"
        for t, v in shape:
            w(f"{ts} {t/60:.5f} {q * v + g:.6f}")
        inflows.append((name, ts))

    w("\n[INFLOWS]\n;;Node Constituent TimeSeries Type Mfactor Sfactor Baseline")
    for name, ts in inflows:
        w(f"{name} FLOW {ts} FLOW 1.0 1.0 0")

    # Hot start (domain upgrade, P2). The extended domains take 8 to 24 simulated hours to
    # settle, so a baseline is settled once and saved, and each growth run starts from it.
    # Off unless the scenario asks, so the warning model and Sim 2 are unchanged.
    use, save = getattr(sc, "hotstart_use", None), getattr(sc, "hotstart_save", None)
    if use or save:
        w("\n[FILES]")
        if use:
            w(f'USE HOTSTART "{use}"')
        if save:
            w(f'SAVE HOTSTART "{save}"')

    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(L) + "\n")
    if sc.growth_site and sc.growth_lps:
        loads[sc.growth_site] += sc.growth_lps
    return loads


def routing_error(inp):
    rpt = os.path.splitext(inp)[0] + ".rpt"
    with open(rpt, encoding="utf-8", errors="replace") as f:
        block = f.read().split("Flow Routing Continuity", 1)[-1]
    for line in block.splitlines():
        if "Continuity Error" in line:
            return float(line.split()[-1])
    return float("nan")


def run(nh, sc, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    inp = os.path.join(out_dir, "model.inp")
    loads = write_inp(inp, nh, sc)
    ch = list(nh.chambers)
    t, dep, head, flood, inflow, lflow, ldep, outq = [], [], [], [], [], [], [], []
    with Simulation(inp) as sim:
        sim.step_advance(REPORT_S)
        N, Lk = Nodes(sim), Links(sim)
        sn = [N[c] for c in ch]
        sl = [Lk[lk.name] for lk in nh.links]
        so = N["OUT"]
        # Extra nodes whose water level is recorded even though they are not chambers: the
        # nesting handoff in Sim 2.5 needs the level where the study segment's outlet pipe
        # ends, which is usually a plain pipe junction. Empty for every older model.
        watch = list(getattr(nh, "watch", []))
        sw_ = [N[x] for x in watch]
        whead = []
        # Seconds before which nothing is recorded. A steady run only reads its final
        # window, and reading every link every step is most of the cost on a big domain.
        skip = getattr(sc, "record_from_s", 0)
        for _ in sim:
            now = (sim.current_time - sim.start_time).total_seconds()
            if now < skip:
                continue
            t.append(now)
            whead.append([x.head for x in sw_])
            dep.append([x.depth for x in sn])
            head.append([x.head for x in sn])
            flood.append([x.flooding for x in sn])
            inflow.append([x.lateral_inflow for x in sn])
            lflow.append([x.flow for x in sl])
            ldep.append([x.depth for x in sl])
            outq.append(so.total_inflow)
    series = dict(t=np.array(t), depth=np.array(dep), head=np.array(head),
                  flood=np.array(flood), inflow=np.array(inflow),
                  lflow=np.array(lflow), ldepth=np.array(ldep), outflow=np.array(outq),
                  watch=watch, watch_head=np.array(whead))
    return Result(nh, sc, series, loads, routing_error(inp), out_dir)


# ------------------------------------------------------------------ results
class Result:
    def __init__(self, nh, sc, series, loads, err, out_dir):
        self.nh, self.sc, self.s, self.loads, self.err, self.dir = nh, sc, series, loads, err, out_dir

    def steady(self, window_min=10):
        """Per chamber: stages reached over the final window, and whether it has settled."""
        s, t = self.s, self.s["t"]
        win = t >= t[-1] - window_min * 60
        levels = self.nh.stage_levels()
        out = {}
        for k, c in enumerate(self.nh.chambers):
            d = s["depth"][win, k]
            spilling = bool((s["flood"][win, k] > 1e-6).any())
            reached = {st: (spilling if st == "spill" else bool(d.max() >= levels[c][st] - 1e-9))
                       for st in STAGES}
            out[c] = {"depth": float(d.mean()), "pct_shaft": float(100 * d.mean() / self.nh.nodes[c].max_depth),
                      "reached": reached,
                      "settled": spilling or float(d.max() - d.min()) < 0.02}
        return out

    def first_times(self, after_min=0.0):
        """Minute each chamber first reaches each stage, after `after_min`."""
        s, t = self.s, self.s["t"] / 60
        levels = self.nh.stage_levels()
        m = t >= after_min
        out = {}
        for k, c in enumerate(self.nh.chambers):
            out[c] = {}
            for st in STAGES:
                hit = (s["flood"][:, k] > 1e-6) if st == "spill" else (s["depth"][:, k] >= levels[c][st])
                idx = np.nonzero(hit & m)[0]
                out[c][st] = float(t[idx[0]]) if idx.size else None
        return out

    def save(self, extra=None):
        nh, sc, net = self.nh, self.sc, self.nh.net
        np.savez_compressed(os.path.join(self.dir, "series.npz"), **self.s)
        xs = [n.x for n in nh.nodes.values()] + [p[0] for lk in nh.links for p in lk.line]
        ys = [n.y for n in nh.nodes.values()] + [p[1] for lk in nh.links for p in lk.line]
        gx = np.linspace(min(xs) - 15, max(xs) + 15, 60)
        gy = np.linspace(min(ys) - 15, max(ys) + 15, 60)
        GX, GY = np.meshgrid(gx, gy)
        GZ = net.surface.at(np.column_stack([GX.ravel(), GY.ravel()])).reshape(GX.shape)
        with open(os.path.join(HERE, "data", "raw", "mains.json"), encoding="utf-8") as f:
            fetched = json.load(f).get("fetched", "unknown")
        meta = {
            "junction": nh.junction, "split": nh.split, "unit_label": UNIT_LABEL[nh.split],
            "scenario": asdict(sc), "scenario_text": sc.describe(nh.split),
            "manning_n": MANNING_N, "manning_by_material": MANNING_BY_MATERIAL,
            "manning_used": sorted({manning_of(getattr(lk, "material", ""))
                                    for lk in nh.links}),
            "report_s": REPORT_S, "route_s": ROUTE_S,
            "seg_len": SEG_LEN, "adwf_ref": ADWF_REF,
            "pyswmm": pyswmm.__version__, "data_fetched": fetched,
            "routing_error_pct": self.err,
            "chambers": list(nh.chambers),
            "external_m": nh.external_m,
            "loads_lps": self.loads,
            "stage_levels": nh.stage_levels(),
            "nodes": [asdict(n) for n in nh.nodes.values()],
            "links": [asdict(lk) for lk in nh.links],
            "pipes": [asdict(p) for p in nh.pipes],
            "ground": {"x": gx.tolist(), "y": gy.tolist(), "z": GZ.tolist()},
            "first_times": self.first_times(),
        }
        if extra:
            meta.update(extra)
        with open(os.path.join(self.dir, "meta.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(meta, f, indent=1)
        return meta
