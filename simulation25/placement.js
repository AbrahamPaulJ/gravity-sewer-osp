/* placement.js - the sandbox's placement algorithms, run on the Sim 2.5 network and scored
   against what SWMM says each sensor would see.

   The sandbox's algorithms (osp_core.js) do not use SWMM: they rank manholes by the network's
   shape, or by a flood-fill model of where a blockage would be visible. Sim 2.5's own greedy
   is the one method here that reads the SWMM growth runs directly. So every method proposes
   sensors its own way, and every proposal is then SCORED THE SAME WAY: the share of the
   growth scenarios SWMM solved, in each case, that at least one chosen sensor sees under the
   selected detection rule. That makes the menu a fair comparison, not just a list.

   The score is the builder's own (tools/build_sim25_web.py, placement): the same scenarios,
   the same exclusion of scenarios nothing sees and of cases with none. tools/test_sandbox.js
   checks this scoring reproduces the builder's published figures for its greedy order, so a
   method's number here and the page's published number mean the same thing.

   Pure, no DOM; needs osp_core.js (window.OSPCore, or passed in) in the page and in node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Placement = factory();
})(this, function () {
  "use strict";

  const MAX_K = 10;

  // id, menu label, what it does. "swmm" is Sim 2.5's own and is published, not computed here.
  const METHODS = [
    ["swmm", "Greedy on the SWMM growth runs",
     "Sim 2.5's own: each sensor added is the manhole that most raises the objective below, " +
     "judged directly on which manholes saw growth in SWMM."],
    ["celf", "Greedy set cover, CELF (sandbox)",
     "The sandbox's greedy: covers the most network nodes on its flood-fill model of where a " +
     "blockage would be visible. Does not use SWMM."],
    ["twoupdown", "Two up, two down (rule of thumb)",
     "The practitioner's rule: anchor on the manhole with the largest catchment, add two " +
     "manholes upstream and two downstream, repeat. Does not use SWMM."],
    ["upstream", "Largest upstream catchment",
     "The manholes with the most network draining through them. Does not use SWMM."],
    ["between", "Highest betweenness",
     "The manholes the most flow paths pass through. Does not use SWMM."],
    ["outdeg", "Highest out-degree", "The manholes with the most pipes leaving. Does not use SWMM."],
    ["indeg", "Highest in-degree", "The manholes where the most pipes join. Does not use SWMM."],
    ["random", "Random (best of 20)",
     "Twenty random sets at each size, keeping the best on the SWMM growth runs: the floor " +
     "any method should beat."],
  ];

  /* The Sim 2.5 map as an osp_core graph. Levels in metres on the map's own datum; a node's
     ground is its invert plus its depth; its diameter the largest pipe at it. Gravity pipes
     only: the sandbox's model has no pumps. Only real chambers are candidates. */
  function graphFrom(g, C) {
    const n = g.nodes.length, maxDia = new Float64Array(n);
    g.up.forEach((u, l) => {
      const d = (g.dia[l] || 0) / 1000;
      if (d > maxDia[u]) maxDia[u] = d;
      if (d > maxDia[g.down[l]]) maxDia[g.down[l]] = d;
    });
    const nd = { x: [], y: [], inv: [], cover: [], dia: [], org: [], mh: [], coverSrc: [] };
    g.nodes.forEach((v, i) => {
      const inv = v.inv / 100;
      nd.x.push(v.x / 10); nd.y.push(v.y / 10); nd.inv.push(inv);
      nd.cover.push(v.depth ? inv + v.depth : 0);
      nd.dia.push(maxDia[i]); nd.org.push(0); nd.coverSrc.push(0);
      nd.mh.push(v.kind === "chamber" ? 1 : 0);
    });
    const G = C.buildGraph({
      key: "sim25", nodes: nd,
      edges: g.up.map((u, l) => [u, g.down[l]]),
      lengths: g.up.map((_, l) => (g.plen && g.plen[l]) || 1),
    });
    C.computeObservable(G, { model: "headroom", threshold: 0.05 });   // the sandbox's defaults
    return G;
  }

  /* Per case, the growth scenarios some manhole sees under a rule: each a list of chamber
     indices. Cases with none are dropped, as the builder drops them. */
  function scenarios(R, rule) {
    const per = R.cases.map(() => []);
    for (const c of R.cells) {
      if (c.rule !== rule) continue;
      for (const r of c.rows) if (r.tip.length) per[c.case].push(r.tip);
    }
    return per.filter(x => x.length);
  }

  /* Share of each case's scenarios that a set of chamber indices sees. */
  function cover(pool, chosen) {
    const s = new Set(chosen);
    return pool.map(tips => tips.filter(t => t.some(m => s.has(m))).length / tips.length);
  }
  const worstOf = f => Math.min(...f);
  const meanOf = f => f.reduce((a, b) => a + b, 0) / f.length;

  // A fixed-seed generator, so "random" gives the same sets on every repaint.
  function rng(seed) {
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* One method's sensors for 1..MAX_K, as chamber indices, scored on the SWMM runs.
     Returns { sets, worst, mean, nested }: sets[k-1] is the k-sensor set. */
  function place(method, ctx, rule, obj) {
    const { C, G, R, chamberOfNode } = ctx;
    const pool = scenarios(R, rule);
    const toCh = nodes => nodes.map(v => chamberOfNode[v]).filter(i => i >= 0);
    const prefixes = order => Array.from({ length: MAX_K }, (_, k) => order.slice(0, k + 1));
    const ranked = score => prefixes(toCh(C.topBy(G, MAX_K, i => score[i])));
    let sets, nested = true;
    switch (method) {
      case "celf": sets = prefixes(toCh(C.greedy(G, MAX_K, "nodes"))); break;
      case "upstream": sets = ranked(C.upstreamSize(G, null)); break;
      case "between": sets = ranked(C.betweenness(G, null)); break;
      case "outdeg": sets = ranked(C.degreeWeight(G, null, "out")); break;
      case "indeg": sets = ranked(C.degreeWeight(G, null, "in")); break;
      case "twoupdown":
        nested = false;
        sets = Array.from({ length: MAX_K }, (_, k) =>
          toCh(C.twoUpTwoDown(G, k + 1, 2, 2, "nodes").sensors));
        break;
      case "random": {
        nested = false;
        const r = rng(20261008), n = R.chambers.length;
        const better = (a, b) => obj === "mean"
          ? (a.m > b.m || (a.m === b.m && a.w > b.w))
          : (a.w > b.w || (a.w === b.w && a.m > b.m));
        sets = Array.from({ length: MAX_K }, (_, k) => {
          let best = null;
          for (let t = 0; t < 20; t++) {
            const pick = new Set();
            while (pick.size < k + 1) pick.add(Math.floor(r() * n));
            const f = cover(pool, [...pick]), cand = { s: [...pick], w: worstOf(f), m: meanOf(f) };
            if (!best || better(cand, best)) best = cand;
          }
          return best.s;
        });
        break;
      }
      default: throw new Error("unknown placement method " + method);
    }
    const worst = [], mean = [];
    for (const s of sets) {
      const f = cover(pool, s);
      worst.push(worstOf(f));
      mean.push(meanOf(f));
    }
    return { sets, worst, mean, nested };
  }

  /* Everything that depends only on the network and data, built once per page. */
  function context(g, R, C) {
    const G = graphFrom(g, C);
    const at = {};
    R.chambers.forEach((name, i) => { at[name] = i; });
    const chamberOfNode = g.nodes.map(v => (v.name in at ? at[v.name] : -1));
    return { C, G, R, chamberOfNode };
  }

  return { METHODS, MAX_K, context, place, scenarios, cover };
});
