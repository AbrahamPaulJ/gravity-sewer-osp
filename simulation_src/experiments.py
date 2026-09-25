#!/usr/bin/env python3
"""
experiments.py - the three questions, each answered with constant or realistic loads.

    ladder    At what steady load does each chamber reach each stage?
              Constant-load runs at coarse steps, then bisection to pin every threshold
              to within 2%. No ramp, so no time-load entanglement.
    growth    From a steady base load, how much extra constant load (development) at each
              chamber before something surcharges or spills, and where?
    warning   From a steady base, an event rises and falls. For each chamber, how long
              before the first spill anywhere would a level sensor or a float switch there
              have raised the alarm?
    compare   The ladder under all three load splits, side by side.

Each experiment writes results/<experiment>_<split>/summary.json plus full runs the 3D
viewer can open. Usage:

    python experiments.py ladder                 # split defaults to `along`
    python experiments.py growth --base 0.15
    python experiments.py warning
    python experiments.py compare
    python experiments.py all
"""
import argparse, json, os, shutil, tempfile

import numpy as np

import model
from model import Neighbourhood, Scenario, STAGES, RESULTS, UNIT_LABEL, ADWF_REF
from network import Network

JUNCTION = 441
MINUTES = 120        # E1: long enough for these pipes to settle at steady load
REL_TOL = 0.02       # E2: bisection stops when the bracket is within 2%
BASE_UNIT = 0.15     # E4: base load for growth and warning, L/s per 100 m (2x ADWF_REF)
LEVEL_DELTA = 0.10   # E5: rise above base level a level sensor alarms at, m
PEAK_FACTORS = (1.25, 2.0, 3.0)   # E6: event peaks, as multiples of the steady spill load


def _dump(path, obj):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=1)


def _fmt(x, nd=3):
    return "never" if x is None else f"{x:.{nd}g}"


class Runner:
    """Runs a scenario, keeping it on disk only when asked; caches steady results."""

    def __init__(self, net, split):
        self.nh = Neighbourhood(net, JUNCTION, split)
        self.split = split
        self.tmp = tempfile.mkdtemp(prefix="osp_")
        self.n = 0
        self.worst_err = 0.0

    def run(self, sc, keep_dir=None):
        self.n += 1
        out = keep_dir or os.path.join(self.tmp, f"r{self.n}")
        r = model.run(self.nh, sc, out)
        if abs(r.err) > abs(self.worst_err):
            self.worst_err = r.err
        if keep_dir:
            r.save()
        else:
            shutil.rmtree(out, ignore_errors=True)
        return r

    def close(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


def bisect(test, lo, hi):
    """Smallest x in (lo, hi] with test(x) True, given test(lo) False and test(hi) True."""
    while (hi - lo) > REL_TOL * hi:
        mid = (lo + hi) / 2
        if test(mid):
            hi = mid
        else:
            lo = mid
    return hi


# ------------------------------------------------------------------ ladder
def ladder(net, split="along"):
    R = Runner(net, split)
    out_dir = os.path.join(RESULTS, f"ladder_{split}")
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir)
    chambers = list(R.nh.chambers)
    cache = {}

    def steady(q, keep=False):
        key = round(q, 6)
        if key not in cache or keep:
            kd = os.path.join(out_dir, f"q_{q:g}") if keep else None
            r = R.run(Scenario("constant", q, MINUTES), kd)
            cache[key] = (r.steady(), r.err)
        return cache[key][0]

    # Coarse: grow until every chamber spills, or give up at a hard cap.
    q = 0.05 if split != "equal" else 1.0
    coarse = []
    while True:
        st = steady(q, keep=True)
        coarse.append(q)
        if all(st[c]["reached"]["spill"] for c in chambers) or q > (64 if split != "equal" else 400):
            break
        q = round(q * 1.5, 4)

    table = {c: [steady(x)[c]["pct_shaft"] for x in coarse] for c in chambers}
    unsettled = sorted({f"{c} at {x:g}" for x in coarse for c in chambers
                        if not steady(x)[c]["settled"]})
    nonmono = []
    thresholds = {c: {} for c in chambers}
    for c in chambers:
        for s in STAGES:
            flags = [steady(x)[c]["reached"][s] for x in coarse]
            if any(a and not b for a, b in zip(flags, flags[1:])):
                nonmono.append(f"{c} {s}")
            if not any(flags):
                thresholds[c][s] = None
                continue
            i = flags.index(True)
            if i == 0:
                thresholds[c][s] = coarse[0]
                continue
            thresholds[c][s] = bisect(lambda x: steady(x)[c]["reached"][s], coarse[i - 1], coarse[i])

    first = {}
    for s in STAGES:
        cands = [(thresholds[c][s], c) for c in chambers if thresholds[c][s] is not None]
        first[s] = min(cands) if cands else (None, None)

    ul = UNIT_LABEL[split]
    text = [f"LOAD LADDER, split = {split}  ({ul})", "",
            "Constant load held for 120 min per run; stage judged over the last 10 min.",
            f"{len(coarse)} coarse runs, {len(cache)} runs in total, thresholds within 2%.", ""]
    head = "chamber  " + "".join(f"{s:>12s}" for s in STAGES)
    text += ["Load at which each chamber first reaches each stage", head]
    for c in chambers:
        text.append(f"   {c}     " + "".join(f"{_fmt(thresholds[c][s]):>12s}" for s in STAGES))
    text += ["", "First anywhere:"]
    for s in STAGES:
        q, c = first[s]
        extra = (f"   = {q / ADWF_REF:.1f} x indicative dry weather flow"
                 if q is not None and split != "equal" else "")
        text.append(f"   {s:10s} {_fmt(q)} at {c}{extra}")
    if unsettled:
        text += ["", "Not settled after 120 min (threshold may be slightly high): "
                 + ", ".join(unsettled[:8]) + (" ..." if len(unsettled) > 8 else "")]
    if nonmono:
        text += ["", "WARNING, stage not monotone in load: " + ", ".join(nonmono)]

    summary = dict(experiment="ladder", split=split, unit_label=ul, coarse=coarse,
                   pct_shaft=table, thresholds=thresholds,
                   first={s: {"load": first[s][0], "chamber": first[s][1]} for s in STAGES},
                   unsettled=unsettled, non_monotone=nonmono, runs=len(cache),
                   chart=dict(title="Steady water depth, % of shaft", x_label=ul,
                              x=coarse, series=table),
                   text=text, default_run=f"q_{coarse[-1]:g}")
    # open on the first coarse run where something spills, the interesting one
    for x in coarse:
        if any(steady(x)[c]["reached"]["spill"] for c in chambers):
            summary["default_run"] = f"q_{x:g}"
            break
    summary["worst_continuity_error_pct"] = R.worst_err
    summary["text"] += ["", f"Worst SWMM flow continuity error across all runs: {R.worst_err:.2f}%"
                        + ("   WARNING: above 2%" if abs(R.worst_err) > 2 else "")]
    text = summary["text"]
    _dump(os.path.join(out_dir, "summary.json"), summary)
    R.close()
    print("\n".join(text))
    return summary


# ------------------------------------------------------------------ growth
def growth(net, split="along", base=BASE_UNIT):
    R = Runner(net, split)
    out_dir = os.path.join(RESULTS, f"growth_{split}")
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir)
    chambers = list(R.nh.chambers)
    base_st = R.run(Scenario("constant", base, MINUTES)).steady()
    already = {s: sorted(c for c in chambers if base_st[c]["reached"][s]) for s in STAGES}
    cache = {}

    def steady(site, g):
        key = (site, round(g, 6))
        if key not in cache:
            cache[key] = R.run(Scenario("constant", base, MINUTES, growth_site=site,
                                        growth_lps=g)).steady()
        return cache[key]

    def new_at(site, g, stage):
        st = steady(site, g)
        return sorted(c for c in chambers if st[c]["reached"][stage] and c not in already[stage])

    rows = {}
    for site in chambers:
        rows[site] = {}
        for stage in ("surcharge", "spill"):
            lo, hi = 0.0, 1.0
            while not new_at(site, hi, stage):
                lo, hi = hi, hi * 2
                if hi > 1024:
                    hi = None
                    break
            if hi is None:
                rows[site][stage] = {"lps": None, "where": []}
                continue
            g = bisect(lambda x: bool(new_at(site, x, stage)), lo, hi)
            rows[site][stage] = {"lps": g, "where": new_at(site, g, stage)}
        g_spill = rows[site]["spill"]["lps"]
        if g_spill is not None:
            R.run(Scenario("constant", base, MINUTES, growth_site=site, growth_lps=g_spill * 1.05),
                  os.path.join(out_dir, f"site_{site}"))

    ul = UNIT_LABEL[split]
    per_m = base / 100
    text = [f"GROWTH, split = {split}", "",
            f"Base load {base:g} {ul} (= {base / ADWF_REF:.1f} x indicative dry weather flow),"
            " held constant.",
            "Extra constant load added at one chamber at a time; 120 min per run.",
            "Already at base: surcharge at " + (", ".join(already["surcharge"]) or "none")
            + "; spilling at " + (", ".join(already["spill"]) or "none"), "",
            "Added L/s at site before a NEW chamber surcharges / spills, and which one:",
            "site   surcharge (where)          spill (where)        spill as sewer at base"]
    for site in chambers:
        s, p = rows[site]["surcharge"], rows[site]["spill"]
        eq = f"{p['lps'] / per_m / 1000:.1f} km" if p["lps"] is not None and split != "equal" else ""
        text.append(f"  {site}    {_fmt(s['lps']):>7s} L/s ({','.join(s['where']) or '-':5s})"
                    f"      {_fmt(p['lps']):>7s} L/s ({','.join(p['where']) or '-':5s})   {eq}")
    text += ["", "'as sewer at base' = how much new sewer, loaded like the existing network,",
             "would add that flow. A rough development-size equivalent, nothing more."]
    worst = min((rows[c]["spill"]["lps"], c) for c in chambers if rows[c]["spill"]["lps"] is not None)
    summary = dict(experiment="growth", split=split, unit_label=ul, base=base,
                   already=already, rows=rows, runs=len(cache) + 1, text=text,
                   default_run=f"site_{worst[1]}")
    summary["worst_continuity_error_pct"] = R.worst_err
    summary["text"] += ["", f"Worst SWMM flow continuity error across all runs: {R.worst_err:.2f}%"
                        + ("   WARNING: above 2%" if abs(R.worst_err) > 2 else "")]
    text = summary["text"]
    _dump(os.path.join(out_dir, "summary.json"), summary)
    R.close()
    print("\n".join(text))
    return summary


# ------------------------------------------------------------------ warning
def warning(net, split="along", base=BASE_UNIT):
    lad_path = os.path.join(RESULTS, f"ladder_{split}", "summary.json")
    if not os.path.exists(lad_path):
        ladder(net, split)
    with open(lad_path, encoding="utf-8") as f:
        lad = json.load(f)
    q_spill = lad["first"]["spill"]["load"]
    R = Runner(net, split)
    out_dir = os.path.join(RESULTS, f"warning_{split}")
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir)
    chambers = list(R.nh.chambers)
    levels = R.nh.stage_levels()

    events = []
    for fac in PEAK_FACTORS:
        peak = round(q_spill * fac / base, 2)
        sc = Scenario("event", base, 60 + 30 + 30 + 60 + 30, peak=peak, warmup=60)
        r = R.run(sc, os.path.join(out_dir, f"peak_x{peak:g}"))
        s, t = r.s, r.s["t"] / 60
        pre = (t >= 50) & (t < 60)
        spill_any = [(ft, c) for c in chambers
                     if (ft := r.first_times(60)[c]["spill"]) is not None]
        t_spill, c_spill = min(spill_any) if spill_any else (None, None)
        rows = {}
        for k, c in enumerate(chambers):
            base_d = float(s["depth"][pre, k].mean())
            after = t >= 60
            lvl = np.nonzero(after & (s["depth"][:, k] >= base_d + LEVEL_DELTA))[0]
            flt = np.nonzero(after & (s["depth"][:, k] >= levels[c]["surcharge"]))[0]
            t_lvl = float(t[lvl[0]]) if lvl.size else None
            t_flt = float(t[flt[0]]) if flt.size else None
            tripped_at_base = base_d >= levels[c]["surcharge"]
            rows[c] = dict(base_depth=base_d,
                           level_alarm=t_lvl, float_alarm=None if tripped_at_base else t_flt,
                           float_tripped_at_base=tripped_at_base,
                           level_lead=None if (t_spill is None or t_lvl is None) else t_spill - t_lvl,
                           float_lead=None if (t_spill is None or t_flt is None or tripped_at_base)
                           else t_spill - t_flt)
        events.append(dict(peak=peak, factor=fac, run=f"peak_x{peak:g}", err=r.err,
                           first_spill=t_spill, first_spill_at=c_spill, chambers=rows))

    ul = UNIT_LABEL[split]
    text = [f"WARNING TIME, split = {split}", "",
            f"Base {base:g} {ul} for 60 min, then an event: rise 30 min to the peak, hold 30,",
            "fall 60. Peaks are multiples of the steady load that first spills anywhere"
            f" ({q_spill:.3g} {ul}).",
            f"Level sensor alarms at +{LEVEL_DELTA:g} m above its base level. Float switch trips at"
            " its outlet pipe crown.",
            "Lead = minutes between the alarm and the first spill anywhere. Times from event start.", ""]
    for ev in events:
        if ev["first_spill"] is None:
            text.append(f"Peak x{ev['peak']:g} base ({ev['factor']:g} x spill load): no spill anywhere.")
        else:
            text.append(f"Peak x{ev['peak']:g} base ({ev['factor']:g} x spill load): first spill at "
                        f"{ev['first_spill_at']}, {ev['first_spill'] - 60:.1f} min into the event")
        text.append("   sensor at   level alarm  lead      float alarm  lead")
        for c in chambers:
            row = ev["chambers"][c]
            la = "-" if row["level_alarm"] is None else f"{row['level_alarm'] - 60:5.1f}"
            fa = ("at base" if row["float_tripped_at_base"] else
                  "-" if row["float_alarm"] is None else f"{row['float_alarm'] - 60:5.1f}")
            ll = "-" if row["level_lead"] is None else f"{row['level_lead']:5.1f}"
            fl = "-" if row["float_lead"] is None else f"{row['float_lead']:5.1f}"
            text.append(f"      {c}        {la:>7s}   {ll:>6s}      {fa:>7s}   {fl:>6s}")
        text.append("")
    summary = dict(experiment="warning", split=split, unit_label=ul, base=base,
                   spill_load=q_spill, level_delta=LEVEL_DELTA, events=events, text=text,
                   default_run=events[len(events) // 2]["run"])
    summary["worst_continuity_error_pct"] = R.worst_err
    summary["text"] += ["", f"Worst SWMM flow continuity error across all runs: {R.worst_err:.2f}%"
                        + ("   WARNING: above 2%" if abs(R.worst_err) > 2 else "")]
    text = summary["text"]
    _dump(os.path.join(out_dir, "summary.json"), summary)
    R.close()
    print("\n".join(text))
    return summary


# ------------------------------------------------------------------ compare
def compare(net):
    rows = {sp: ladder(net, sp) for sp in model.SPLITS}
    text = ["SPLIT COMPARISON, first chamber to reach each stage", "",
            "split       unit                       surcharge            spill"]
    for sp, s in rows.items():
        su, sp_ = s["first"]["surcharge"], s["first"]["spill"]
        text.append(f"{sp:10s}  {s['unit_label']:25s}  {_fmt(su['load']):>7s} at {su['chamber'] or '-':3s}"
                    f"    {_fmt(sp_['load']):>7s} at {sp_['chamber'] or '-'}")
    text += ["", "Units differ: equal is per chamber, the others per 100 m of sewer, so compare",
             "WHERE the stages appear first, not the numbers across rows."]
    out_dir = os.path.join(RESULTS, "compare")
    os.makedirs(out_dir, exist_ok=True)
    _dump(os.path.join(out_dir, "summary.json"),
          dict(experiment="compare", text=text,
               first={sp: s["first"] for sp, s in rows.items()}))
    print("\n".join(text))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["ladder", "growth", "warning", "compare", "all"])
    ap.add_argument("--split", choices=model.SPLITS, default="along")
    ap.add_argument("--base", type=float, default=BASE_UNIT)
    args = ap.parse_args()
    net = Network()
    if args.what in ("ladder", "all"):
        ladder(net, args.split)
    if args.what in ("growth", "all"):
        growth(net, args.split, args.base)
    if args.what in ("warning", "all"):
        warning(net, args.split, args.base)
    if args.what in ("compare", "all"):
        compare(net)


if __name__ == "__main__":
    main()
