/* osp_capacity.js — flow accumulation and pipe capacity on the gravity DAG.
   No DOM. Loadable in a worker and in node.

   WHY THIS EXISTS
   ---------------
   The sandbox implements Ninh 2025, which models BLOCKAGE observability: a node
   chokes, water backs up to a ceiling, can a sensor see the rise? The scope agreed for this work is narrower and different:

     "what data ... can help us detect an OVERCAPACITY/overflow"

   Overcapacity is a different mechanism from blockage. A blockage can happen
   anywhere, weighted by condition. Overcapacity happens at predictable bottlenecks
   where accumulated flow exceeds what the pipe was sized for, and it is what a
   growth front causes. Same consequence, different geography, so a placement
   optimised for one is not optimised for the other.

   This module supplies the missing half: how much flow arrives at each reach, how
   much that reach can carry, and therefore which reaches are the bottlenecks. The
   surcharge nodes it produces feed the EXISTING observability machinery in
   osp_core.js unchanged, because once a node surcharges the cause no longer
   matters to whether a sensor can see it.

   WHAT THIS IS NOT
   ----------------
   This is not a hydraulic model and must never be presented as one. It is a
   steady, uniform, normal-depth calculation: Manning's equation reach by reach,
   with no backwater, no routing, no storage and no time. That is the same
   screening-level d/D that utility capacity assessments use to identify a
   capacity-deficient sewer, and it is defensible for ranking reaches. It is not
   SWMM and will not reproduce SWMM. The network operator's own team does real modelling and
   will know the difference immediately, so label it accordingly.  */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OSPCapacity = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

/* Manning roughness. Sewer pipe is 0.010 to 0.015 depending on material and age;
   0.013 is the conventional design value for concrete and vitrified clay and is
   what we default to. The statewide layer publishes a `roughness` field but it is
   populated on 0.8% of records, so it cannot be used and this stays an assumption.
   Material IS published at 99.9%, so a per-material table is the obvious refinement
   once material reaches the demo data. */
const DEFAULT_N = 0.013;

/* A reach with no fall cannot be solved by Manning. Some are genuinely flat, some
   are data error: the invert fields are flow-anchored and a mis-set record can read
   as adverse. Rather than drop them, clamp to a token grade and flag them, so they
   stay visible as a data-quality finding instead of silently disappearing. */
const MIN_SLOPE = 1e-4;

/* --------------------------------------------------------------- geometry */
/* Per-edge diameter, slope and length.

   Diameter is per NODE in the current data, holding the max diameter of the pipes
   touching that node. The reach between two nodes is taken as min(dia[u], dia[v]),
   because a reach is limited by its narrowest section. That is a proxy. The real
   per-pipe diameter exists upstream in build_demo_data.py and should be emitted as
   a `diams` array; when it is, pass it in as opt.diams and this falls away. */
function edgeGeometry(g, opt) {
  opt = opt || {};
  const m = g.edges.length;
  const dia = new Float64Array(m), slope = new Float64Array(m), len = new Float64Array(m);
  const flags = new Uint8Array(m);          // 1 = slope clamped
  let clamped = 0, diaProxied = 0;

  for (let e = 0; e < m; e++) {
    const u = g.edges[e][0], v = g.edges[e][1];
    const L = Math.max(g.lengths[e], 0.1);
    len[e] = L;

    if (opt.diams) dia[e] = opt.diams[e];
    else { dia[e] = Math.min(g.dia[u], g.dia[v]); diaProxied++; }

    // Fall is upstream invert minus downstream invert. The graph is already
    // oriented by flow, so u is upstream of v by construction.
    const s = (g.inv[u] - g.inv[v]) / L;
    if (s < MIN_SLOPE) { slope[e] = MIN_SLOPE; flags[e] = 1; clamped++; }
    else slope[e] = s;
  }
  return { dia, slope, len, flags, clamped, diaProxied, m };
}

/* ------------------------------------------------------- partial-flow solver */
/* Circular channel running part full, parameterised by the wetted angle theta.
     A = (D^2/8)(theta - sin theta)      P = D theta / 2      R = A / P
     Q = (1/n) A R^(2/3) sqrt(S)
   Depth ratio d/D = (1 - cos(theta/2)) / 2.

   Q does not increase monotonically to theta = 2pi. It peaks near d/D = 0.938 and
   falls slightly after, because wetted perimeter keeps growing while area barely
   does. So the solver bisects on the RISING branch only, and any flow above the
   peak is reported as surcharged rather than being given a spurious depth. */
function qOfTheta(theta, D, S, n) {
  if (theta <= 0) return 0;
  const A = (D * D / 8) * (theta - Math.sin(theta));
  const P = (D * theta) / 2;
  if (P <= 0) return 0;
  const R = A / P;
  return (1 / n) * A * Math.pow(R, 2 / 3) * Math.sqrt(S);
}

const THETA_QMAX = 5.2781;   // argmax of Q(theta), d/D = 0.9381

function capacityOf(D, S, n) {
  return {
    qMax: qOfTheta(THETA_QMAX, D, S, n),      // greatest flow the reach can pass
    qFull: qOfTheta(2 * Math.PI, D, S, n),    // flow at exactly full bore
  };
}

/* Depth ratio for a given flow. Returns 1 when the reach is surcharged. */
function depthRatio(Q, D, S, n) {
  if (Q <= 0) return 0;
  const { qMax } = capacityOf(D, S, n);
  if (Q >= qMax) return 1;
  let lo = 1e-6, hi = THETA_QMAX;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (qOfTheta(mid, D, S, n) < Q) lo = mid; else hi = mid;
  }
  const theta = (lo + hi) / 2;
  return (1 - Math.cos(theta / 2)) / 2;
}

/* ------------------------------------------------------- flow accumulation */
/* Accumulate node loads down the DAG. Every node contributes its own load, and
   passes on everything that reached it.

   Done in topological order so each node is settled before anything downstream of
   it is touched, which is one pass and exact. topoOrder is already computed and
   cached by osp_core, so this is cheap.

   loads is per node, in L/s. Uniform by default: without dwelling counts joined to
   the network there is nothing better to assume, and saying so is more honest than
   inventing a distribution. Pass opt.loads to supply real per-node load. */
function accumulate(g, core, opt) {
  opt = opt || {};
  const n = g.n;
  const own = new Float64Array(n);
  if (opt.loads) own.set(opt.loads);
  else {
    const per = opt.perNode == null ? 0.05 : opt.perNode;   // L/s per node
    own.fill(per);
  }

  const acc = new Float64Array(n);
  const edgeQ = new Float64Array(g.edges.length);
  const order = core.topoOrder(g);

  /* Most chambers have exactly one outgoing pipe, but not all: measured on the
     loaded data there are 9 nodes in Walkerville, 8 in the steep catchment and 24 in the flat catchment
     with two. Passing the full accumulated flow to each of those would create flow
     out of nothing and break mass conservation, and it would do so invisibly,
     because the headline "share of network over capacity" would still look
     plausible. Flow is therefore split evenly across the outgoing reaches.

     Even splitting is an assumption. A real split depends on the relative hydraulics
     of the two branches, which we cannot compute here. What matters is that it
     conserves mass, which the tests assert, and that a wrong split at 41 nodes out
     of 8,206 cannot distort the picture the way an unconserved one would. */
  for (let k = 0; k < order.length; k++) {
    const v = order[k];
    acc[v] += own[v];
    const deg = g.outPtr[v + 1] - g.outPtr[v];
    if (!deg) continue;
    const share = acc[v] / deg;
    for (let p = g.outPtr[v]; p < g.outPtr[v + 1]; p++) acc[g.outIdx[p]] += share;
  }

  /* outIdx is CSR over nodes, so its slot order is not edge order. Recover the
     per-edge flow by walking the edge list: the flow on edge (u,v) is u's share. */
  for (let e = 0; e < g.edges.length; e++) {
    const u = g.edges[e][0];
    const deg = g.outPtr[u + 1] - g.outPtr[u];
    edgeQ[e] = deg ? acc[u] / deg : acc[u];
  }
  return { own, acc, edgeQ };
}

/* --------------------------------------------------------------- the state */
/* Flow, capacity and utilisation for every reach, plus the nodes that surcharge.

   Edge flow is the accumulated flow at the reach's UPSTREAM node, which is what
   that pipe has to carry. A node is surcharged when any reach leaving it is over
   capacity: the water has nowhere to go and backs up into the chamber. */
function capacityState(g, core, opt) {
  opt = opt || {};
  const nMan = opt.n == null ? DEFAULT_N : opt.n;
  const peak = opt.peakFactor == null ? 1 : opt.peakFactor;   // dry weather -> peak
  const geo = opt.geo || edgeGeometry(g, opt);
  const { own, acc, edgeQ } = accumulate(g, core, opt);

  const m = g.edges.length;
  const q = new Float64Array(m), qCap = new Float64Array(m), dOverD = new Float64Array(m);
  const over = new Uint8Array(m);
  const surcharged = new Uint8Array(g.n);
  let nOver = 0, lenOver = 0, lenTot = 0;

  for (let e = 0; e < m; e++) {
    const u = g.edges[e][0];
    // L/s to m3/s, and dry weather to the peak condition capacity is judged at.
    // edgeQ, not acc[u], so a chamber with two outgoing pipes splits rather than
    // sending its whole flow down both.
    const Q = (edgeQ[e] * peak) / 1000;
    const D = geo.dia[e], S = geo.slope[e];
    const cap = capacityOf(D, S, nMan);
    q[e] = Q; qCap[e] = cap.qMax;
    dOverD[e] = depthRatio(Q, D, S, nMan);
    lenTot += geo.len[e];
    if (Q >= cap.qMax) {
      over[e] = 1; nOver++; lenOver += geo.len[e];
      surcharged[u] = 1;
    }
  }

  let nSur = 0;
  for (let i = 0; i < g.n; i++) if (surcharged[i]) nSur++;

  return {
    geo, own, acc, edgeQ, q, qCap, dOverD, over, surcharged,
    summary: {
      edges: m, edgesOver: nOver,
      lengthOver: Math.round(lenOver), lengthTotal: Math.round(lenTot),
      shareOver: m ? nOver / m : 0,
      nodesSurcharged: nSur,
      slopeClamped: geo.clamped,
      diameterProxied: geo.diaProxied > 0,
      manningN: nMan, peakFactor: peak,
      perNodeLoad: opt.loads ? null : (opt.perNode == null ? 0.05 : opt.perNode),
    },
  };
}

/* ------------------------------------------------------------------ growth */
/* Add load at chosen nodes and report what changes.

   This is the sewer growth case this work targets: new development connects to
   a main that was sized before it, flow accumulates behind the resulting
   bottleneck, and it escapes at the last opening upstream. `additions` is a map of
   node index to added L/s.

   The value is not the after state on its own, it is the DIFFERENCE. Reaches that
   were already over capacity were already a problem; the ones that TIP are what
   growth actually caused, and those are the ones a sensor rollout has to see. */
function growth(g, core, base, additions, opt) {
  opt = opt || {};
  const loads = Float64Array.from(base.own);
  let added = 0;
  for (const k in additions) { loads[+k] += additions[k]; added += additions[k]; }

  const after = capacityState(g, core,
    Object.assign({}, opt, { loads, geo: base.geo }));

  const tipped = [], tippedNodes = new Uint8Array(g.n);
  for (let e = 0; e < g.edges.length; e++) {
    if (after.over[e] && !base.over[e]) {
      tipped.push(e);
      tippedNodes[g.edges[e][0]] = 1;
    }
  }
  let lenTipped = 0;
  for (const e of tipped) lenTipped += base.geo.len[e];

  return {
    after, tipped, tippedNodes,
    summary: {
      addedLoad: Math.round(added * 100) / 100,
      edgesTipped: tipped.length,
      lengthTipped: Math.round(lenTipped),
      edgesOverBefore: base.summary.edgesOver,
      edgesOverAfter: after.summary.edgesOver,
      nodesSurchargedBefore: base.summary.nodesSurcharged,
      nodesSurchargedAfter: after.summary.nodesSurcharged,
    },
  };
}

/* Nodes that surcharge, as an event set for the placement optimiser.
   This is the join to osp_core: instead of treating every node as an equally
   likely blockage, the optimiser can be pointed at the nodes overcapacity
   actually threatens. */
function surchargeNodes(state) {
  const out = [];
  for (let i = 0; i < state.surcharged.length; i++) if (state.surcharged[i]) out.push(i);
  return out;
}

return {
  DEFAULT_N, MIN_SLOPE, THETA_QMAX,
  edgeGeometry, qOfTheta, capacityOf, depthRatio,
  accumulate, capacityState, growth, surchargeNodes,
};
});
