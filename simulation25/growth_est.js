/* growth_est.js - an instant estimate of what a growth scenario does, in the browser.

   The page cannot run SWMM: it is a static site, and one whole-domain solve takes about
   35 s. So a scenario the user builds (several manholes, each with its own number of
   new dwellings) is estimated here, and the estimate is checked against SWMM rather than
   trusted:

     1. FLOW is exact for a steady state. Every node's load, the case's own baseline as
        SWMM was given it plus the new dwellings, is carried down the network in
        topological order. Where flow splits (9 of 887 nodes, at relief pipes) it is
        shared in proportion to each pipe's capacity, and a pumped wet well's whole inflow
        crosses its pump to the discharge node, as SWMM's ideal pumps do.
     2. DEPTH at a manhole is the normal depth that flow makes in the pipe leaving it,
        Manning, partial flow, plus any step from the manhole floor up to that pipe's
        invert. A pipe given more than it can carry is reported surcharged.

   What it leaves out is backwater: water held up behind a full pipe raising the levels
   upstream. Where pipes have room that barely matters; where they surcharge the
   estimate under-reads, and that is where choke points are. The page states how close
   the estimate came to SWMM on the 8,200 runs the grid solved.

   Pure, no DOM, loadable in the page and in node (tools/test_sandbox.js checks it). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GrowthEst = factory();
})(this, function () {
  "use strict";

  /* The partial-flow solver, the same equations as src/model/osp_capacity.js. A copy
     rather than a shared import because this page must stand alone when its folder is
     served as a site root, where ../src does not exist. tools/test_sandbox.js asserts the
     two give the same depths, so the copy cannot drift. */
  const THETA_QMAX = 5.2781;   // argmax of Q(theta), d/D = 0.9381
  function qOfTheta(theta, D, S, n) {
    if (theta <= 0) return 0;
    const A = (D * D / 8) * (theta - Math.sin(theta));
    const P = (D * theta) / 2;
    if (P <= 0) return 0;
    return (1 / n) * A * Math.pow(A / P, 2 / 3) * Math.sqrt(S);
  }
  function depthRatio(Q, D, S, n) {
    if (Q <= 0) return 0;
    if (Q >= qOfTheta(THETA_QMAX, D, S, n)) return 1;
    let lo = 1e-6, hi = THETA_QMAX;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (qOfTheta(mid, D, S, n) < Q) lo = mid; else hi = mid;
    }
    return (1 - Math.cos((lo + hi) / 4)) / 2;
  }

  // Roughness by published material, model.py's MANNING_BY_MATERIAL; 0.013 otherwise.
  const MATERIAL_N = { VC: 0.013, PVCU: 0.010, RC: 0.013 };
  const MIN_SLOPE = 1e-4;           // a flat or adverse reach, given a token fall
  const NO_GRADE = 0.001;           // a link with no published pipe (an outfall dummy)

  /* Everything that depends only on the network, computed once. */
  function prepare(g) {
    const nN = g.nodes.length, nL = g.up.length;
    const D = new Float64Array(nL), S = new Float64Array(nL), N = new Float64Array(nL);
    const qMax = new Float64Array(nL), step = new Float64Array(nL);
    const qFull = new Float64Array(nL), len = new Float64Array(nL);
    const outs = Array.from({ length: nN }, () => []);
    for (let l = 0; l < nL; l++) {
      D[l] = (g.dia[l] || 150) / 1000;
      const sl = g.pslope && g.pslope[l] != null ? g.pslope[l] / 100 : NO_GRADE;
      S[l] = Math.max(MIN_SLOPE, sl);
      N[l] = (g.pmat && MATERIAL_N[g.pmat[l]]) || 0.013;
      qMax[l] = 1000 * qOfTheta(THETA_QMAX, D[l], S[l], N[l]);        // L/s
      qFull[l] = 1000 * qOfTheta(2 * Math.PI, D[l], S[l], N[l]);       // L/s, full bore
      len[l] = (g.plen && g.plen[l]) || 1;
      // How far this pipe's invert sits above its manhole's floor, m.
      step[l] = Math.max(0, (g.zu[l] - g.nodes[g.up[l]].inv) / 100);
      outs[g.up[l]].push(l);
    }
    const pumpTo = new Int32Array(nN).fill(-1);
    (g.pumpLinks || []).forEach(([w, d]) => { pumpTo[w] = d; });

    /* Loops. Where a manhole splits flow and one of its pipes leads, through the network
       or a pump, back to that same manhole, the flow would circle. The data has one: the
       pump from wet well N183 delivers to MH4451967, which splits, and one branch runs
       back to MH4451823 and so into the same wet well. SWMM simply recirculates it; a
       one-pass accumulation cannot, and every node below the loop waited on it, so only
       0.1 of 100 L/s reached an outfall. Such a pipe carries nothing here, and its share
       goes on down the pipes that lead away. All flow is kept; only the loop's own
       nodes under-read the extra the recirculation would add. */
    const next = i => outs[i].map(l => g.down[l]).concat(pumpTo[i] >= 0 ? [pumpTo[i]] : []);
    const reaches = (from, target) => {
      const seen = new Uint8Array(nN), stack = [from];
      while (stack.length) {
        const v = stack.pop();
        if (v === target) return true;
        if (seen[v]) continue;
        seen[v] = 1;
        for (const w of next(v)) stack.push(w);
      }
      return false;
    };
    const loop = new Uint8Array(nL);
    for (let i = 0; i < nN; i++)
      if (outs[i].length > 1)
        for (const l of outs[i]) if (reaches(g.down[l], i)) loop[l] = 1;
    for (let i = 0; i < nN; i++) {
      const kept = outs[i].filter(l => !loop[l]);
      if (kept.length) outs[i] = kept;
    }

    // Topological order over gravity links and pumps (Kahn). The network is a DAG; a node
    // left out by a cycle would be a data error, and is reported rather than looped on.
    const indeg = new Int32Array(nN);
    for (let i = 0; i < nN; i++) for (const l of outs[i]) indeg[g.down[l]]++;   // kept pipes only
    for (let i = 0; i < nN; i++) if (pumpTo[i] >= 0) indeg[pumpTo[i]]++;
    const order = [], queue = [];
    for (let i = 0; i < nN; i++) if (!indeg[i]) queue.push(i);
    while (queue.length) {
      const i = queue.pop();
      order.push(i);
      const next = outs[i].map(l => g.down[l]);
      if (pumpTo[i] >= 0) next.push(pumpTo[i]);
      for (const j of next) if (--indeg[j] === 0) queue.push(j);
    }
    // The pipe a manhole's level is read from: the largest leaving it.
    const main = new Int32Array(nN).fill(-1);
    for (let i = 0; i < nN; i++)
      for (const l of outs[i]) if (main[i] < 0 || qMax[l] > qMax[main[i]]) main[i] = l;
    return { g, nN, nL, D, S, N, qMax, qFull, len, step, outs, pumpTo, order, main,
             loopLinks: [...loop.keys()].filter(l => loop[l]),
             acyclic: order.length === nN };
  }

  /* Flow in every link, L/s, for per-node loads in L/s. */
  function flows(P, loads) {
    const { g, nN, outs, qMax, pumpTo, order } = P;
    const inflow = new Float64Array(nN), q = new Float64Array(P.nL);
    for (let i = 0; i < nN; i++) inflow[i] = loads[i] || 0;
    for (const i of order) {
      const total = inflow[i];
      if (!total) continue;
      const o = outs[i];
      if (o.length === 1) {
        q[o[0]] += total;
        inflow[g.down[o[0]]] += total;
      } else if (o.length > 1) {
        let cap = 0;
        for (const l of o) cap += qMax[l];
        for (const l of o) {
          const share = total * (cap > 0 ? qMax[l] / cap : 1 / o.length);
          q[l] += share;
          inflow[g.down[l]] += share;
        }
      } else if (pumpTo[i] >= 0) {
        inflow[pumpTo[i]] += total;                     // the ideal pump
      }
    }
    return q;
  }

  /* Depth at every node, m (NaN where no pipe leaves it), and which are surcharged.

     Normal depth alone matched SWMM to the millimetre where pipes flow freely, but on the
     8,200 grid runs it found only 26% of the 25 mm rises SWMM saw in the Design wet case:
     most of those come from water backing up behind a full pipe. So levels are set by a
     backwater pass, the hydraulic-grade-line check of sewer design. Walking upstream from
     the outfalls, a manhole's water level is the higher of
       - its own: the outgoing pipe's invert plus the normal depth of its flow, and
       - the level the water below holds it at: the downstream level, plus the friction
         loss through the pipe wherever that pipe runs full (Manning at full bore, so the
         friction slope is the grade scaled by (Q / Q full) squared).
     A level is capped at the ground, where the manhole would spill. Free-surface backwater
     is taken as a level pool, which understates it slightly; SWMM's dynamic wave solves it
     in full. */
  function depths(P, q) {
    const { g, nN } = P;
    const inv = i => g.nodes[i].inv / 100;            // m, relative to the map's datum
    const head = new Float64Array(nN).fill(NaN);      // water level, same datum
    const depth = new Float64Array(nN).fill(NaN), sur = new Uint8Array(nN);
    for (let k = P.order.length - 1; k >= 0; k--) {   // downstream first
      const i = P.order[k], l = P.main[i];
      if (l < 0) { head[i] = inv(i); continue; }      // outfall or wet well: free
      const zu = g.zu[l] / 100, zd = g.zd[l] / 100, D = P.D[l], ql = q[l];
      const own = zu + depthRatio(ql / 1000, D, P.S[l], P.N[l]) * D;
      const below = head[g.down[l]];
      let held = -Infinity;
      if (!isNaN(below)) {
        const full = ql >= P.qFull[l] || below >= zd + D;
        if (full) {
          const ratio = P.qFull[l] > 0 ? ql / P.qFull[l] : 0;
          held = Math.max(below, zd + D) + P.S[l] * ratio * ratio * P.len[l];
        } else {
          held = below;                                // a level pool behind it
        }
      }
      let h = Math.max(own, held);
      const ground = inv(i) + (g.nodes[i].depth || 0);
      if (g.nodes[i].depth && h > ground) h = ground;  // it spills at the surface
      head[i] = h;
      depth[i] = h - inv(i);
      if (h >= zu + D - 1e-9) sur[i] = 1;
    }
    return { depth, sur, head };
  }

  /* A scenario: sites is [[node, dwellings], ...]. Returns the baseline and the scenario
     side by side, and the rise at every node in mm. */
  function scenario(P, baseLoads, sites, lpsPerDwelling) {
    const loads = Float64Array.from(baseLoads);
    let added = 0;
    for (const [node, n] of sites) {
      const g = n * lpsPerDwelling;
      loads[node] += g;
      added += g;
    }
    const qBase = flows(P, baseLoads), qNow = flows(P, loads);
    const base = depths(P, qBase), now = depths(P, qNow);
    const rise = new Float64Array(P.nN);
    for (let i = 0; i < P.nN; i++) {
      rise[i] = isNaN(now.depth[i]) ? NaN : 1000 * (now.depth[i] - base.depth[i]);
    }
    return { qBase, qNow, base, now, rise, addedLps: added };
  }

  return { prepare, flows, depths, scenario, depthRatio, qOfTheta, MATERIAL_N, THETA_QMAX };
});
