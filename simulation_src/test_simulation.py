#!/usr/bin/env python3
"""
test_simulation.py - checks that must pass before trusting any number from this folder.

Each one pins something that has already gone wrong once, or would go wrong silently:
counts that stay plausible while the physics is off.

    python test_simulation.py
"""
import os, shutil, sys, tempfile

import numpy as np
from pyswmm import Simulation, Nodes, Links

import model
from model import Neighbourhood, Scenario
from network import Network

FAILS, PASSES = [], 0


def check(name, ok, detail=""):
    global PASSES
    if ok:
        PASSES += 1
        print(f"  ok    {name}")
    else:
        FAILS.append(name)
        print(f"  FAIL  {name}  {detail}")


def main():
    tmp = tempfile.mkdtemp(prefix="osp_test_")
    net = Network()

    print("network")
    ids = set()
    for pi in net.nodes[583].ins:
        ids.add(pi)
        ids.update(net.upstream_pipes(net.pipes[pi].up))
    nh = Neighbourhood(net, 441, "along")
    check("upstream of A counted as a pipe set (157 pipes)", len(ids) == 157, len(ids))
    check("external length at A equals the pipe set length",
          abs(nh.external_m["A"] - sum(net.pipes[i].length for i in ids)) < 1e-6)
    check("B is the top of its line", nh.external_m["B"] == 0)
    check("all four study chambers are real manholes",
          all(net.nodes[n].is_chamber for n in nh.chambers.values()))

    print("loads")
    tot = {sp: sum(Neighbourhood(net, 441, sp).base_loads(0.3).values()) for sp in model.SPLITS}
    check("catchment and along carry the same total load", abs(tot["catchment"] - tot["along"]) < 1e-9,
          tot)
    check("equal = 4 x unit", abs(tot["equal"] - 1.2) < 1e-9, tot["equal"])
    seg_total = sum(lk.length for lk in nh.links if lk.pipe == "B-J")
    check("segments of B-J add up to the pipe length", abs(seg_total - 91.0) < 0.5, seg_total)

    print("mass balance, constant along 0.3 for 120 min")
    r = model.run(nh, Scenario("constant", 0.3, 120), os.path.join(tmp, "steady"))
    total_in = sum(r.loads.values())
    check("outfall flow equals total inflow at steady state",
          abs(r.s["outflow"][-1] - total_in) < 0.01 * total_in, (r.s["outflow"][-1], total_in))
    check("continuity error under 2%", abs(r.err) < 2, r.err)
    li = {lk.name: i for i, lk in enumerate(nh.links)}
    last = lambda pipe: li[[lk.name for lk in nh.links if lk.pipe == pipe][-1]]
    first = lambda pipe: li[[lk.name for lk in nh.links if lk.pipe == pipe][0]]
    q = r.s["lflow"][-1]
    j_in = q[last("A-J")] + q[last("B-J")] + r.loads.get("J", 0)
    check("flow accumulates at J: J-D carries A-J + B-J + J's own load",
          abs(q[first("J-D")] - j_in) < 0.01 * j_in, (q[first("J-D")], j_in))

    print("shaft storage (the SLOT regression)")
    eq = Neighbourhood(net, 441, "equal")
    rr = model.run(eq, Scenario("ramp", 60, 60), os.path.join(tmp, "ramp"))
    inp = os.path.join(rr.dir, "model.inp")
    t, depth, qin, qout = [], [], [], []
    with Simulation(inp) as sim:
        sim.step_advance(2)
        N, L = Nodes(sim), Links(sim)
        for _ in sim:
            t.append((sim.current_time - sim.start_time).total_seconds())
            depth.append(N["B"].depth)
            qin.append(N["B"].lateral_inflow / 1000)
            qout.append(L["B-J"].flow / 1000)
    t, depth, qin, qout = map(np.array, (t, depth, qin, qout))
    idx = np.nonzero((depth > 0.30) & (depth < 2.4))[0]
    a, b = idx[0], idx[-1]
    area = np.trapezoid((qin - qout)[a:b + 1], t[a:b + 1]) / (depth[b] - depth[a])
    check("surcharged shaft at B stores water as a 1050 mm chamber (0.8 to 1.1 m2)",
          0.8 <= area <= 1.1, f"{area:.3f} m2")
    check("ramp continuity error under 2%", abs(rr.err) < 2, rr.err)

    print("growth")
    rg = model.run(nh, Scenario("constant", 0.3, 30, growth_site="A", growth_lps=5.0),
                   os.path.join(tmp, "growth"))
    check("growth at an already loaded chamber adds exactly the growth",
          abs(rg.loads["A"] - (r.loads["A"] + 5.0)) < 1e-9, (rg.loads["A"], r.loads["A"]))
    check("growth inflow reaches SWMM", abs(rg.s["inflow"][-1, 0] - rg.loads["A"]) < 0.01,
          (rg.s["inflow"][-1, 0], rg.loads["A"]))

    print("monotone response")
    depths = [model.run(nh, Scenario("constant", u, 120), os.path.join(tmp, f"m{u}")).steady()["A"]["depth"]
              for u in (0.1, 0.3, 0.6)]
    check("steady depth at A rises with load", depths[0] < depths[1] < depths[2], depths)

    print("scenario shapes")
    ev = Scenario("event", 1.0, 240, peak=5, warmup=60).shape()
    check("event starts at 1, peaks, returns to 1",
          ev[0][1] == 1 and max(v for _, v in ev) == 5 and ev[-1][1] == 1, ev)
    st = Scenario("step", 1.0, 120, peak=3, warmup=60).shape()
    check("step holds 1 until warm-up then the peak", st[1] == (60, 1.0) and st[-1][1] == 3, st)

    print("Sim 2.5")
    import sim25
    plain, withov = Network(), sim25.network()
    check("overflow pipes are off by default (older models unchanged)",
          len(withov.pipes) - len(plain.pipes) == 3, len(withov.pipes) - len(plain.pipes))
    ov = {p.asset_id: (p.up, p.down) for p in withov.pipes[len(plain.pipes):]}
    # Directions recorded in the statewide layer for these three (24 Sep).
    check("overflow pipes oriented as the statewide record says",
          ov.get(4433446) == (948, 110) and ov.get(4404777) == (428, 918)
          and ov.get(4404825) == (824, 461), ov)
    pumps = {(w, d) for w, d, _ in sim25.pump_links(withov)}
    check("rising main pieces chained: stations 997 -> 452, 183 -> 948, 825 -> 881",
          pumps == {(997, 452), (183, 948), (825, 881)}, pumps)
    case = sim25.Case(ii=0.11)
    whole = sim25.Sim25Model(case, whole=True)
    check("whole domain pumps only the two stations draining into it",
          len(whole.pumps) == 2, whole.pumps)
    check("71 study manholes", len(whole.study_chambers) == 71, len(whole.study_chambers))
    seg_nodes = {withov.pipes[i].up for i in withov.upstream_pipes(sim25.SEGMENT_OUTLET)}
    into_seg = [e for e in whole.entries if e["node"] in seg_nodes]
    check("three sized outside inflows enter the study segment", len(into_seg) == 3,
          [e["id"] for e in into_seg])
    res, stw, head = sim25.solve(whole, 480, os.path.join(tmp, "s25w"))
    seg = sim25.Sim25Model(case, whole=False, outlet_head=head)
    _, sts, _ = sim25.solve(seg, 480, os.path.join(tmp, "s25s"))
    diff = max(abs(sts[c]["depth"] - stw[c]["depth"]) for c in seg.study_chambers)
    check("nesting: segment reproduces the whole domain's study depths at design wet (< 1 mm)",
          diff < 0.001, diff)
    check("whole-domain continuity error under 1%", abs(res.err) < 1, res.err)

    shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n{PASSES} passed, {len(FAILS)} failed")
    if FAILS:
        sys.exit(1)


if __name__ == "__main__":
    main()
