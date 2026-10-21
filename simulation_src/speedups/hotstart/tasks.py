"""
hotstart/tasks.py - one SWMM run of the grid, optionally started from a settled baseline.

sim25_grid starts every run from empty pipes, so each of a case's 1,641 runs first fills the
network and then settles it, though the growth adds a few L/s to a network that was already
settled in the baseline. model.write_inp has written SWMM's [FILES] USE/SAVE HOTSTART since Sim
2 (catchment.py used it); Sim 2.5's _Steady never asked for it.

Here a case's baseline is run once until settled (converge.run_until_settled, cap 2,880 min)
and its final state saved. Each growth run then writes that state into its own run folder and
starts from it, so it simulates only the response to the growth. The hotstart travels as bytes
inside the task, not as a path, so a run needs no shared disk: the same task runs in a local
process pool, on a Dask worker on another machine, or in a CI job.

Measured 21 Oct 2026, ii 0.25 whole domain, three growth runs against settled cold references
(README.md, "Hot start"): 360 minutes from the hotstart came within 0.7 to 2.6 mm, no alarm or
surcharge detection different, in about 28 s against about 105 s for a settled cold run.

A hotstart fits only a model with the same nodes and links. Growth changes inflows only, so
every growth run of a case fits its baseline; rated pumps add tanks and do not (serve_hotstart
leaves those to the published runner).
"""
import os
import shutil
import tempfile

import numpy as np

import model
import sim25
from sim25 import Sim25Model

from ..common import pack
from ..converge import run_until_settled

BASELINE_CAP_MIN = 2880     # two simulated days; ii 0.25 settles by about 960 (README.md)
RUN_CAP_MIN = 1440          # a growth run from a settled hotstart; ii 0.25 needs about 360


def _model(t):
    if t["whole"]:
        return Sim25Model(t["case"], whole=True, growth=t.get("growth"),
                          growth_nodes=t.get("growth_nodes"))
    return Sim25Model(t["case"], whole=False, outlet_head=t["outlet_head"],
                      exit_heads=t["exit_heads"], growth=t.get("growth"))


def _chambers(m):
    """The chambers the grid reports: candidates on a whole run, the 71 study manholes on a
    segment run, as sim25_grid._whole_task and _segment_task do."""
    return m.candidates if m.whole else m.study_chambers


def run_task(t):
    """One run. t is a dict:
        case, whole, growth ({manhole: dwellings} or None), growth_nodes (whole only),
        outlet_head, exit_heads (segment only), key (returned as is),
        hotstart: bytes of a saved hotstart, or None to start from empty pipes,
        save_hotstart: True to return the final state's bytes (a baseline),
        fixed_minutes: run exactly this long, as sim25_grid does, instead of until settled,
        cap_minutes, tol_m: the convergence rule's cap and tolerance.
    Returns a dict: key, depths, flags (common.pack, in chamber order), chambers, manholes,
    head, exit_heads, growth_lps, err, minutes, capped, hotstart (bytes or None)."""
    m = _model(t)
    run_dir = tempfile.mkdtemp(prefix="sim25fast_", dir=t.get("tmp_root"))
    try:
        cap = t.get("fixed_minutes") or t.get("cap_minutes") or RUN_CAP_MIN
        sc = sim25._Steady(cap, record_last_min=12)
        if t.get("hotstart"):
            use = os.path.join(run_dir, "start.hsf")
            with open(use, "wb") as f:
                f.write(t["hotstart"])
            sc.hotstart_use = use
        save = os.path.join(run_dir, "end.hsf") if t.get("save_hotstart") else None
        if save:
            sc.hotstart_save = save
        if t.get("fixed_minutes"):
            res = model.run(m, sc, os.path.join(run_dir, "run"))
            minutes, capped = float(cap), False
        else:
            res, s = run_until_settled(m, sc, os.path.join(run_dir, "run"),
                                       tol_m=t.get("tol_m", 2e-4))
            minutes, capped = s.minutes, s.capped
        st = sim25.settled(m, res)
        head, exits = None, {}
        if m.watch and len(res.s["watch_head"]):
            wh = np.max(res.s["watch_head"][-6:, :], axis=0)
            head = float(wh[0])
            exits = {nid: float(h) for nid, h in zip(m.watch_nids[1:], wh[1:])}
        hs = None
        if save:
            with open(save, "rb") as f:
                hs = f.read()
        chambers = _chambers(m)
        depths, flags = pack(st, chambers)
        return {"key": t.get("key"), "depths": depths, "flags": flags, "chambers": chambers,
                "manholes": [m.nodes[c].manhole_id for c in chambers],
                "head": head, "exit_heads": exits, "growth_lps": m.growth_lps, "err": res.err,
                "minutes": round(minutes, 1), "capped": capped, "hotstart": hs}
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)


def settle_baseline(case, whole=True, outlet_head=None, exit_heads=None, tol_m=2e-4,
                    cap_minutes=BASELINE_CAP_MIN):
    """The task that settles a case's baseline from empty pipes and returns its hotstart."""
    return {"key": ("base", case.tag(), whole), "case": case, "whole": whole,
            "outlet_head": outlet_head, "exit_heads": exit_heads, "hotstart": None,
            "save_hotstart": True, "cap_minutes": cap_minutes, "tol_m": tol_m}
