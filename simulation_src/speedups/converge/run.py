"""
converge/run.py - a model.run that stops when the network has settled.

The grid holds a constant load and reads the peak depth over the last 10 minutes (sim25.settled).
model.run always simulates the scenario's full length, 480 minutes in the grid. Measured 21 Oct
2026 on the whole domain (README.md, "Settling"): design wet (ii 0.11) is within 0.3 mm of
settled by 240 minutes, while ii 0.25 is still up to 25.9 mm short at 480 and settles only by
about 960. One fixed length is too long for one and too short for the other.

This runner keeps the peak over each window of `window_min` and compares it with the previous
window's. The change between windows shrinks roughly geometrically as a run settles (one slow
mode dominates), so with d_k the largest change at any chamber and r = d_k / d_(k-1), the
change still to come is about d_k * r / (1 - r). The run stops when that projected remainder is
under `tol_m` for `patience` windows in a row, or when d_k is negligible outright. It never
stops before `min_minutes` and always stops at the scenario's length, the cap; Settling.capped
says the cap was hit, and the caller decides what that means.

The Result it returns has the series sim25.settled and sim25.solve read (t, depth, flood,
watch_head) over the final window plus two minutes, as the grid already records. Link series,
heads and inflows are not recorded: reading every link every step was most of the cost on the
whole domain (model.run's own comment), and nothing in the grid reads them.
"""
import os
from collections import deque
from dataclasses import dataclass

import numpy as np
from pyswmm import Simulation, Nodes

import model


@dataclass
class Settling:
    minutes: float          # simulated minutes when the run stopped
    capped: bool            # True if it ran to the cap without meeting the rule
    last_change_mm: float   # d_k at the stop, largest window-to-window change of a peak
    projected_mm: float     # the change still expected after the stop, by the geometric rule


def run_until_settled(nh, sc, out_dir, window_min=10, tol_m=2e-4, min_minutes=30,
                      patience=2, floor_m=1e-5, sample_s=60):
    """Like model.run(nh, sc, out_dir) with sc.minutes as the cap. Returns (Result, Settling).

    tol_m 2e-4 is 0.2 mm, the settling standard sim25_grid states for its 480 minutes (R2).
    floor_m 1e-5: a change of 0.01 mm between windows is settled whatever the ratio says.
    sample_s: how often depths are read while watching; the window peaks the rule compares
    are peaks of these samples. Once the rule is met the run continues for one more window
    plus two minutes, read every step, and that window is what the Result holds."""
    os.makedirs(out_dir, exist_ok=True)
    inp = os.path.join(out_dir, "model.inp")
    loads = model.write_inp(inp, nh, sc)
    ch = list(nh.chambers)
    watch = list(getattr(nh, "watch", []))
    keep_s = (window_min + 2) * 60
    keep = deque(maxlen=int(keep_s / model.REPORT_S) + 1)
    win_s, cap_s = window_min * 60, sc.minutes * 60
    peak = prev = None
    d_prev, calm, final_until = None, 0, None
    state = Settling(0.0, True, float("nan"), float("nan"))
    with Simulation(inp) as sim:
        sim.step_advance(model.REPORT_S)
        N = Nodes(sim)
        sn = [N[c] for c in ch]
        sw_ = [N[x] for x in watch]
        for _ in sim:
            now = (sim.current_time - sim.start_time).total_seconds()
            # The final window, once the rule is met or the cap is near: every step, every
            # field settled() and solve() read, as model.run records it.
            if final_until is not None or now > cap_s - keep_s:
                keep.append((now, np.fromiter((x.depth for x in sn), float, len(sn)),
                             [x.flooding for x in sn], [x.head for x in sw_]))
                if final_until is not None and now >= final_until:
                    break
                continue
            # Watching for settled: depths only, sampled every sample_s. Reading every chamber
            # every 10 s costs about as much as the routing on a hotstart run.
            if now % sample_s > 1e-6 and now % win_s > 1e-6:
                continue
            dep = np.fromiter((x.depth for x in sn), float, len(sn))
            peak = dep if peak is None else np.maximum(peak, dep)
            if now % win_s > 1e-6:
                continue
            # The end of a window: compare its peaks with the last window's.
            if prev is not None:
                d = float(np.max(np.abs(peak - prev)))
                if d_prev and d_prev > 0:
                    r = d / d_prev
                    tail = d * r / (1 - r) if r < 0.9 else float("inf")
                else:
                    tail = float("inf")
                state = Settling(now / 60, True, d * 1000, tail * 1000)
                ok = d <= floor_m or tail <= tol_m
                calm = calm + 1 if ok else 0
                if calm >= patience and now >= min_minutes * 60:
                    state.capped = False
                    final_until = now + keep_s
                d_prev = d
            prev, peak = peak, None
    t, dep, flood, whead = (list(x) for x in zip(*keep))
    series = dict(t=np.array(t), depth=np.array(dep), flood=np.array(flood),
                  watch=watch, watch_head=np.array(whead))
    state.minutes = t[-1] / 60
    return model.Result(nh, sc, series, loads, model.routing_error(inp), out_dir), state
