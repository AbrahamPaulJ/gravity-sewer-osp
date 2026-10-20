"""run_all.py - both approximations on every Sim 2.5 SWMM condition committed, rises saved.

    newton   netsolve.NetSolve: the whole network solved at once (levels both ways, spills,
             level-based splits, ideal pumps, SWMM's slot). The baseline from a cold start;
             where that does not converge, from one SWMM baseline run of that condition.
    tree     marching.Net: flows summed down the network, standard-step backwater, no spills.

Every growth scenario of the condition's committed SWMM grid (results/sim25/grid_whole and
results/sim25/grid) starts from that condition's baseline. A condition already saved is
skipped, so a stopped run resumes.

    python simulation_src/approx/run_all.py [--workers 4]
Output: simulation_src/results/approx/allcond/<grid>/<tag>.json; SWMM baselines (levels only)
in simulation_src/results/approx/swmm_base/<tag>.npz.
"""
import argparse, glob, json, os, shutil, sys, time
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import numpy as np
import netsolve as ns
import marching
SRC = ns.SRC
os.chdir(SRC)
import sim25, model
from sim25 import Case, Sim25Model, _Steady

OUT = os.path.join(SRC, "results", "approx")
GRIDS = {"whole": "results/sim25/grid_whole", "segment": "results/sim25/grid"}
_CACHE = {}


def swmm_state(case, tag):
    """Every node's level, the mean of SWMM's last 10 of 480 minutes, from one baseline run of
    this condition (cached; the run's .inp, .rpt and .out are removed)."""
    from pyswmm import Simulation, Nodes
    p = os.path.join(OUT, "swmm_base", tag + ".npz")
    if os.path.exists(p):
        return np.load(p)["H"]
    m = Sim25Model(case, whole=True); net = ns.NetSolve(m)
    d = os.path.join(OUT, "swmm_base", tag); os.makedirs(d, exist_ok=True)
    inp = os.path.join(d, "model.inp"); model.write_inp(inp, m, _Steady(480))
    H = np.zeros(net.N); k = 0
    with Simulation(inp) as sim:
        N = Nodes(sim); nodes = [N[nm] for nm in net.names]
        sim.step_advance(60)
        for _ in sim:
            if (sim.current_time - sim.start_time).total_seconds() >= 470 * 60:
                H += [x.head for x in nodes]; k += 1
    H /= k
    np.savez(p, H=H, names=np.array(net.names))
    shutil.rmtree(d, ignore_errors=True)
    return H


def setup(case_d):
    key = json.dumps(case_d, sort_keys=True)
    if key not in _CACHE:
        m = Sim25Model(Case(**case_d), whole=True)
        net = ns.NetSolve(m)
        tree = marching.Net(m)
        loads = m.base_loads()
        tb = tree.solve(loads)
        per_dw = sim25.PEOPLE_PER_NEW_DWELLING * sim25.LITRES_PER_PERSON_DAY / 86400.0 * m.sew
        name = {nd.manhole_id: nm for nm, nd in m.nodes.items() if nd.manhole_id}
        _CACHE[key] = (m, net, tree, loads, tb, per_dw, name)
    return _CACHE[key]


def work(args):
    case_d, Hb, cand, rows = args
    m, net, tree, loads, tb, per_dw, name = setup(case_d)
    nb = {c: float(Hb[net.idx[c]] - net.inv[net.idx[c]]) for c in net.chambers}
    out = []
    for r in rows:
        ld = dict(loads)
        site = name[r["site"]]
        ld[site] = ld.get(site, 0.0) + r["dwellings"] * per_dw
        g = net.solve_newton(ld, H0=Hb, maxit=60)
        conv = net.converged
        if not conv:
            g = net.solve_ptc(ld, H0=Hb, maxit=400, dt_max=120.0)
            conv = net.converged
        tg = tree.solve(ld)
        rn, rt = {}, {}
        for c in cand:
            mh = str(m.nodes[c].manhole_id)
            a = (g[c] - nb[c]) * 1000; b = (tg[c] - tb[c]) * 1000
            if a >= 1.0: rn[mh] = round(a, 2)
            if b >= 1.0: rt[mh] = round(b, 2)
        out.append({"newton": rn, "tree": rt, "conv": bool(conv), "spill": len(net.spill)})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    jobs = []
    for grid, path in GRIDS.items():
        for f in sorted(glob.glob(os.path.join(path, "ii*", "summary.json"))):
            jobs.append((grid, f))
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for grid, f in jobs:
            s = json.load(open(f)); tag = s["tag"]
            dst = os.path.join(OUT, "allcond", grid, tag + ".json")
            if os.path.exists(dst):
                continue
            t0 = time.time()
            m = Sim25Model(Case(**s["case"]), whole=True); net = ns.NetSolve(m)
            b = net.solve_newton(m.base_loads(), maxit=80)
            base_from = "cold start"
            if not net.converged:
                Hs = swmm_state(Case(**s["case"]), tag)
                b = net.solve_newton(m.base_loads(), H0=Hs, maxit=80)
                base_from = "one SWMM baseline"
            Hb = net.H.copy()
            cand = list(m.chambers if grid == "whole" else m.study_chambers)
            tb = marching.Net(m).solve(m.base_loads())
            base = {"newton": {str(m.nodes[c].manhole_id): b[c] for c in cand},
                    "tree": {str(m.nodes[c].manhole_id): tb[c] for c in cand},
                    "crown": {str(m.nodes[c].manhole_id): net.crown[c] for c in cand},
                    "newton_conv": bool(net.converged), "from": base_from,
                    "spill": len(net.spill), "spill_lps": sum(net.spill.values())}
            rows = s["rows"]
            chunks = [rows[i:i + 40] for i in range(0, len(rows), 40)]
            res = []
            for part in pool.map(work, [(s["case"], Hb, cand, c) for c in chunks]):
                res += part
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            json.dump({"base": base, "rows": res}, open(dst, "w"))
            print("%s %s: baseline %s (conv %s), %d runs, %d converged, %.0f s" % (
                grid, tag, base_from, net.converged, len(res), sum(r["conv"] for r in res),
                time.time() - t0), flush=True)


if __name__ == "__main__":
    main()
