"""check_baselines.py - the network solve's baselines against SWMM's, and the slot finding.

    python simulation_src/approx/check_baselines.py        # about 2 minutes, one SWMM run

1. Dry, Design wet and Severe baselines from a cold start, against the committed SWMM depths.
2. Severe from one SWMM baseline (results/approx/swmm_base, made by run_all.py or here).
3. The pipe law at SWMM's own Severe levels against SWMM's own pipe flows, with and without
   SWMM's Preissmann slot: in a deeply surcharged pipe SWMM carries more than a full pipe can.
"""
import json, os, statistics as S, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np
import netsolve as ns
os.chdir(ns.SRC)
import model
from sim25 import Case, Sim25Model, _Steady

GRID = "results/sim25/grid_whole"


def report(lbl, net, depth, s):
    e = sorted(abs(depth[c] - s["baseline_depth_m"][str(net.m.nodes[c].manhole_id)]) * 1000 for c in net.chambers)
    sur = sum(depth[c] >= net.crown[c] - 1e-4 for c in net.chambers)
    print("%-28s conv %-5s iters %3d | depth error median %.1f mm, p90 %.0f, max %.0f; within 25 mm %d%% | "
          "surcharged %d (SWMM %d) | spilling %d, %.1f L/s (SWMM %d)" % (
              lbl, net.converged, net.iters, S.median(e), e[int(.9 * len(e))], e[-1],
              round(100 * sum(x < 25 for x in e) / len(e)), sur, len(s["baseline"]["surcharged"]),
              len(net.spill), sum(net.spill.values()), len(s["baseline"]["spilled"])))


def swmm_levels_and_flows(m, net):
    from pyswmm import Simulation, Nodes, Links
    d = os.path.join(ns.SRC, "results", "approx", "check_tmp"); os.makedirs(d, exist_ok=True)
    inp = os.path.join(d, "model.inp"); model.write_inp(inp, m, _Steady(480))
    H = np.zeros(net.N); Q = np.zeros(len(net.links)); k = 0
    with Simulation(inp) as sim:
        N, Lk = Nodes(sim), Links(sim)
        nodes = [N[nm] for nm in net.names]; links = [Lk[lk.name] for lk in net.links]
        sim.step_advance(60)
        for _ in sim:
            if (sim.current_time - sim.start_time).total_seconds() >= 470 * 60:
                H += [x.head for x in nodes]; Q += [x.flow for x in links]; k += 1
    import shutil; shutil.rmtree(d, ignore_errors=True)
    return H / k, Q / k / 1000.0


def main():
    for tag in ("ii0.00_flat_uniform_b1_sfree", "ii0.11_flat_uniform_b1_sfree", "ii0.40_flat_uniform_b1_sfree"):
        s = json.load(open(os.path.join(GRID, tag, "summary.json")))
        m = Sim25Model(Case(**s["case"]), whole=True); net = ns.NetSolve(m)
        t = time.time(); d = net.solve_newton(m.base_loads(), maxit=80)
        report("%s, cold start (%.1f s)" % (tag[:6], time.time() - t), net, d, s)
    m = Sim25Model(Case(ii=0.40), whole=True); net = ns.NetSolve(m)
    Hs, Qs = swmm_levels_and_flows(m, net)
    d = net.solve_newton(m.base_loads(), H0=Hs, maxit=80)
    report("ii0.40, from SWMM baseline", net, d, s)
    for slot in (False, True):
        ns.SLOT[0] = slot
        dq = np.abs(net._q(Hs[net.up], Hs[net.dn]) - Qs) * 1000
        print("pipe law at SWMM's Severe levels, %-12s |Q - SWMM Q| median %.3f L/s, p90 %.2f, max %.1f; pipes off by > 1 L/s: %d of %d" % (
            "with slot:" if slot else "full pipe:", np.median(dq), np.percentile(dq, 90), dq.max(), (dq > 1).sum(), len(dq)))


if __name__ == "__main__":
    main()
