/* OSP sandbox core: graph construction, the observability model, scoring and placement
   algorithms. Pure logic, no DOM, so it can be exercised from Node by
   tools/test_sandbox.js as well as by the page.

   Method: Ninh, Do, Zeng & Lambert (2025), Optimal Sensor Placement in Smart Sewer
   Systems Using Network Topology and Elevation, JWRPM 151(7).

   WHAT CHANGED IN THE REBUILD (2 Sep 2026), and why:

   1. The global coefficient c is gone. Ninh's threshold is `elev[v] + c x MaxDepth[v]`,
      where c x MaxDepth stands for the height water climbs at a blockage before it
      escapes somewhere. That is a per-node physical quantity, not a constant, and it
      cannot be raised to buy coverage: raising it claims headroom the network does not
      have, so sensors get placed where water never reaches them. It is replaced by a
      measured ceiling, computed by flood fill over real cover levels (see ceilings()).

   2. Depth is measured, not proxied. The old build used pipe diameter (0.15 m) for
      MaxDepth. Real manhole depth on Walkerville is a median 2.92 m, so the old budget
      was out by roughly a factor of fifteen. That, not terrain, is why 86.8% of
      nodes in the steep catchment previously observed nothing.

   3. A detection threshold was added. Observability was binary; a rise of 2 mm counted
      the same as 2 m. It is not calibratable from public data (no South Australian
      wastewater sensor readings are published), so it is an explicit declared parameter.

   4. A starved-flow term was added, so a sensor downstream of a blockage is no longer
      scored at zero. See starvation() for the argument.

   PRESERVED FROM THE ORIGINAL, deliberately:
   - Every algorithm draws from the same candidate pool (see feasible). An earlier cut
     let greedy and the centrality heuristics draw only from nodes that observe
     something while "two up, two down" drew from all nodes, which cost that rule of
     thumb more than half its score.
   - No elevation-based prune on the traversal. It was tried and rejected: node
     elevation does not fall monotonically downstream, so pruning silently drops real
     observable nodes while leaving headline counts unchanged. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OSPCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

/* ------------------------------------------------------------------ graph */
/* Accepts the parallel-array node format written by tools/build_demo_data.py:
     nodes: {x, y, inv, cover, coverSrc, dia, mh, org}
   coverSrc: 1 surveyed, 2 contour-interpolated, 3 transferred constant. */
function buildGraph(raw) {
  const nd = raw.nodes;
  const n = nd.x.length;
  const x = Float64Array.from(nd.x), y = Float64Array.from(nd.y);
  const inv = Float64Array.from(nd.inv);
  const cover = Float64Array.from(nd.cover);
  const dia = Float64Array.from(nd.dia);
  const org = Float64Array.from(nd.org);
  const mh = Uint8Array.from(nd.mh);
  const coverSrc = Uint8Array.from(nd.coverSrc);

  const outDeg = new Int32Array(n), inDeg = new Int32Array(n);
  for (const e of raw.edges) { outDeg[e[0]]++; inDeg[e[1]]++; }
  const outPtr = new Int32Array(n + 1), inPtr = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    outPtr[i + 1] = outPtr[i] + outDeg[i];
    inPtr[i + 1] = inPtr[i] + inDeg[i];
  }
  const outIdx = new Int32Array(raw.edges.length),
        inIdx = new Int32Array(raw.edges.length);
  const oCur = outPtr.slice(0, n), iCur = inPtr.slice(0, n);
  for (const e of raw.edges) { outIdx[oCur[e[0]]++] = e[1]; inIdx[iCur[e[1]]++] = e[0]; }

  // A node's covered pipe length is the length of the pipes flowing into it.
  const lenIn = new Float64Array(n);
  raw.edges.forEach((e, ei) => { lenIn[e[1]] += raw.lengths[ei]; });

  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (let i = 0; i < n; i++) {
    if (x[i] < minx) minx = x[i]; if (x[i] > maxx) maxx = x[i];
    if (y[i] < miny) miny = y[i]; if (y[i] > maxy) maxy = y[i];
  }

  // Only a real chamber can hold a sensor: you need a lid to open, a dry wall to bolt
  // to and a clear drop to the water. Where the source publishes a manhole layer we use
  // it; where it does not (the statewide regions) every node is a nominal candidate and
  // the UI says so.
  const anyMh = mh.some ? Array.prototype.some.call(mh, v => v === 1)
                        : Array.from(mh).some(v => v === 1);
  const candidate = new Uint8Array(n);
  for (let i = 0; i < n; i++) candidate[i] = anyMh ? mh[i] : 1;

  return {
    key: raw.key, label: raw.label, note: raw.note, role: raw.role, stats: raw.stats,
    n, x, y, inv, cover, coverSrc, dia, org, mh, candidate, hasManholes: anyMh,
    outPtr, outIdx, inPtr, inIdx, outDeg, inDeg, lenIn,
    edges: raw.edges, polylines: raw.polylines, lengths: raw.lengths,
    bounds: { minx, maxx, miny, maxy },
    obs: null, obsKey: null, ceil: null, ceilKey: null,
    _up: null, _topo: null, _btw: null,
  };
}

/* ------------------------------------------------------- the escape ceiling */
/* ceiling(v) is the level water reaches when v blocks, before it escapes somewhere.

   Water piles up behind the blockage. With flow stopped the velocity is zero, so the
   water surface is HORIZONTAL, and it floods progressively more of the network upstream
   of v as it rises. It escapes at the lowest opening anywhere in the flooded region.

   Openings, lowest first in practice:
     - a property overflow relief gully. AS/NZS 3500.2 sets it above finished ground and
       below the lowest fixture in the house, precisely so a surcharge escapes into the
       garden instead of the shower. It is designed to be the lowest opening, and it sits
       on private property, so it is absent from every utility asset layer. That is the
       real reason a fudge factor existed at all.
     - a manhole cover in the flooded reach, including v's own.

   Raising a level L, the flooded set R(L) grows monotonically while
   f(L) = min{opening(u) : u in R(L)} is non-increasing, so there is a unique crossing
   where L first meets f(L). Popping nodes in increasing invert order finds it directly:
   once the next node's invert is already at or above the running minimum opening, the
   water escaped before it could get there. */
function ceilings(g, useOrg) {
  const key = "org" + (useOrg ? 1 : 0);
  if (g.ceilKey === key) return g.ceil;
  const n = g.n, inv = g.inv, cover = g.cover, org = g.org;

  // An opening below the pipe floor is not an opening, it is a bad cover level. The
  // builder already discards those, and this is the second line of defence: accepting
  // one would hand a node a ceiling under its own invert and silently produce negative
  // headroom everywhere upstream of it.
  const opening = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let o = (cover[i] > 0 && cover[i] > inv[i]) ? cover[i] : Infinity;
    if (useOrg && org[i] > inv[i] && org[i] < o) o = org[i];
    opening[i] = o;
  }

  const ceil = new Float64Array(n);
  const seen = new Int32Array(n).fill(-1);
  // Binary min-heap over (invert, node), reused across sources. A node can be pushed
  // once per in-edge before it is marked seen, so the bound is edge count, not node
  // count. Undersizing this would silently drop writes on a typed array and corrupt
  // ceilings with no error raised.
  const cap = g.inIdx.length + n + 1;
  const hk = new Float64Array(cap), hv = new Int32Array(cap);
  for (let v = 0; v < n; v++) {
    let size = 0;
    const push = (k, node) => {
      let i = size++; hk[i] = k; hv[i] = node;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hk[p] <= hk[i]) break;
        const tk = hk[p], tv = hv[p]; hk[p] = hk[i]; hv[p] = hv[i]; hk[i] = tk; hv[i] = tv;
        i = p;
      }
    };
    const pop = () => {
      const rk = hk[0], rv = hv[0];
      size--;
      if (size > 0) {
        hk[0] = hk[size]; hv[0] = hv[size];
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < size && hk[l] < hk[m]) m = l;
          if (r < size && hk[r] < hk[m]) m = r;
          if (m === i) break;
          const tk = hk[m], tv = hv[m]; hk[m] = hk[i]; hv[m] = hv[i]; hk[i] = tk; hv[i] = tv;
          i = m;
        }
      }
      return [rk, rv];
    };

    let c = Infinity;
    push(inv[v], v);
    while (size > 0) {
      const [iu, u] = pop();
      if (iu >= c) break;              // water escaped before reaching this invert
      if (seen[u] === v) continue;
      seen[u] = v;
      if (opening[u] < c) c = opening[u];
      for (let p = g.inPtr[u]; p < g.inPtr[u + 1]; p++) {
        const w = g.inIdx[p];
        if (seen[w] !== v) push(inv[w], w);
      }
    }
    ceil[v] = c;
  }

  g.ceil = ceil; g.ceilKey = key;
  return ceil;
}

/* ----------------------------------------------------- observability model */
/* A sensor at s observes a blockage at v when v is downstream of s and the water backed
   up behind v stands deep enough at s to be told apart from a normal day.

   Because the surface is horizontal at ceiling(v), the depth at s is simply
   ceiling(v) - inv[s], with no gradient term needed. The old `(c x MaxDepth) / gradient`
   reach formula is the constant-gradient special case of this.

     headroom : ceiling(v) - inv[s] > threshold        (measured, the default)
     legacy   : inv[v] + c x dia[v] > inv[s]           (Ninh as published, for comparison)
     drop     : inv[s] - inv[v] < D                    (a plain elevation budget)

   Keeping the legacy mode is the point of the exercise: it lets the tool show what the
   diameter proxy costs rather than merely asserting it. */
function computeObservable(g, opt) {
  const model = opt.model || "headroom";
  const c = opt.c == null ? 0.7 : opt.c;
  const drop = opt.drop == null ? 1.0 : opt.drop;
  const thr = opt.threshold == null ? 0.05 : opt.threshold;
  const useOrg = !!opt.useOrg;
  const starveFrac = opt.starveFrac == null ? 0 : opt.starveFrac;

  const key = [model, c, drop, thr, useOrg ? 1 : 0, starveFrac].join("|");
  if (g.obsKey === key) return g.obs;

  const n = g.n, inv = g.inv, dia = g.dia;
  const ceil = model === "headroom" ? ceilings(g, useOrg) : null;
  const up = starveFrac > 0 ? upstreamSize(g) : null;

  const counts = new Int32Array(n);
  const lists = new Array(n);
  const seen = new Int32Array(n).fill(-1);
  // A node can be pushed once per in-edge before being marked seen, so the stack is
  // bounded by edge count. Typed arrays drop out-of-range writes silently, so
  // undersizing this would corrupt results with no error raised.
  const stack = new Int32Array(g.outIdx.length + 1);

  for (let s = 0; s < n; s++) {
    const is = inv[s];
    let sp = 0, out = null;
    for (let p = g.outPtr[s]; p < g.outPtr[s + 1]; p++) stack[sp++] = g.outIdx[p];
    while (sp > 0) {
      const v = stack[--sp];
      if (seen[v] === s) continue;
      seen[v] = s;
      let ok;
      if (model === "headroom") ok = (ceil[v] - is) > thr;
      else if (model === "legacy") ok = (inv[v] + c * dia[v]) > is;
      else ok = (is - inv[v]) < drop;
      if (ok) (out || (out = [])).push(v);
      for (let p = g.outPtr[v]; p < g.outPtr[v + 1]; p++) {
        const w = g.outIdx[p];
        if (seen[w] !== s) stack[sp++] = w;
      }
    }

    // Starved flow: s sits DOWNSTREAM of the blockage, so nothing backs up to it, but
    // the flow that normally arrives stops. A level sensor reads that as an unexplained
    // dry spell, and it is most of what the "two down" half of the rule of thumb buys.
    // Detectable only when the stopped branch is a big enough share of what passes s,
    // otherwise it is lost in normal diurnal variation.
    if (starveFrac > 0) {
      let sp2 = 0;
      for (let p = g.inPtr[s]; p < g.inPtr[s + 1]; p++) stack[sp2++] = g.inIdx[p];
      const denom = up[s] + 1;
      while (sp2 > 0) {
        const v = stack[--sp2];
        if (seen[v] === s) continue;
        seen[v] = s;
        if ((up[v] + 1) / denom >= starveFrac) (out || (out = [])).push(v);
        for (let p = g.inPtr[v]; p < g.inPtr[v + 1]; p++) {
          const w = g.inIdx[p];
          if (seen[w] !== s) stack[sp2++] = w;
        }
      }
    }

    if (out) { counts[s] = out.length; lists[s] = out; }
  }

  const ptr = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) ptr[i + 1] = ptr[i] + counts[i];
  const idx = new Int32Array(ptr[n]);
  let k = 0;
  for (let i = 0; i < n; i++) if (lists[i]) for (const v of lists[i]) idx[k++] = v;

  const inUniverse = new Uint8Array(n);
  for (let i = 0; i < idx.length; i++) inUniverse[idx[i]] = 1;
  let universeSize = 0, universeLen = 0, zeroObservable = 0;
  for (let i = 0; i < n; i++) {
    if (inUniverse[i]) { universeSize++; universeLen += g.lenIn[i]; }
    if (ptr[i + 1] === ptr[i]) zeroObservable++;
  }

  g.obs = { ptr, idx, inUniverse, universeSize, universeLen, zeroObservable, model };
  g.obsKey = key;
  return g.obs;
}

const obsOf = (g, i) => g.obs.idx.subarray(g.obs.ptr[i], g.obs.ptr[i + 1]);

/* Depth summary for the UI, so the assumptions register reports the loaded data rather
   than a figure typed into the page. */
function depthStats(g) {
  const d = [];
  for (let i = 0; i < g.n; i++) if (g.cover[i] > 0) d.push(g.cover[i] - g.inv[i]);
  d.sort((a, b) => a - b);
  const q = f => d.length ? d[Math.min(d.length - 1, Math.floor(f * d.length))] : null;
  // Four categories, not three. They must sum to the node count, or a node has
  // silently lost its cover level somewhere.
  let surveyed = 0, contour = 0, transferred = 0, unknown = 0;
  for (let i = 0; i < g.n; i++) {
    if (g.coverSrc[i] === 1) surveyed++;
    else if (g.coverSrc[i] === 2) contour++;
    else if (g.coverSrc[i] === 3) transferred++;
    else unknown++;               // cover was below the invert, so it was discarded
  }
  return { n: d.length, p10: q(0.1), median: q(0.5), p90: q(0.9),
           surveyed, contour, transferred, unknown, total: g.n };
}

/* --------------------------------------------------------------- scoring */
function score(g, sensors) {
  const covered = new Uint8Array(g.n);
  for (const s of sensors) {
    if (!Number.isInteger(s) || s < 0 || s >= g.n) continue;
    const set = obsOf(g, s);
    for (let i = 0; i < set.length; i++) covered[set[i]] = 1;
  }
  let nodes = 0, len = 0;
  for (let i = 0; i < g.n; i++) if (covered[i]) { nodes++; len += g.lenIn[i]; }
  return { covered, nodes, len };
}

const weightOf = (g, i, obj) => (obj === "length" ? g.lenIn[i] : 1);

/* ------------------------------------------------------------ algorithms */
/* Lazy (CELF) greedy. Coverage is submodular, so a cached marginal gain can only
   overstate the true gain; re-checking the top entry before taking it is therefore
   exact, and skips most re-evaluations. Pass budget = Infinity for full coverage. */
function greedy(g, budget, obj) {
  const covered = new Uint8Array(g.n), chosen = [];
  const gain = new Float64Array(g.n), stamp = new Int32Array(g.n).fill(-1);
  const heap = [];
  for (const i of feasible(g)) {
    const set = obsOf(g, i);
    let val = 0;
    for (let j = 0; j < set.length; j++) val += weightOf(g, set[j], obj);
    if (val > 0) { gain[i] = val; heap.push(i); }
  }
  heap.sort((a, b) => gain[b] - gain[a]);

  let it = 0;
  while (chosen.length < budget && heap.length) {
    let best = -1;
    while (heap.length) {
      const cand = heap[0];
      if (stamp[cand] === it) { best = cand; heap.shift(); break; }
      const set = obsOf(g, cand);
      let val = 0;
      for (let j = 0; j < set.length; j++) if (!covered[set[j]]) val += weightOf(g, set[j], obj);
      gain[cand] = val; stamp[cand] = it;
      heap.shift();
      let lo = 0, hi = heap.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (gain[heap[m]] > val) lo = m + 1; else hi = m; }
      heap.splice(lo, 0, cand);
    }
    if (best < 0 || gain[best] <= 0) break;
    chosen.push(best);
    const set = obsOf(g, best);
    for (let i = 0; i < set.length; i++) covered[set[i]] = 1;
    it++;
  }
  return chosen;
}

/* The candidate pool every algorithm draws from. Two filters, both part of the problem
   statement rather than a hint:
     - the node must be a real chamber, because that is the only place a sensor can go
     - it must observe at least one node under the current settings, since a sensor
       anywhere else is provably wasted under this model
   Applying it uniformly is what makes scores comparable, and it is why the "random"
   baseline here is stronger than a uniform draw over all manholes. */
function feasible(g) {
  const out = [];
  for (let i = 0; i < g.n; i++)
    if (g.candidate[i] && g.obs.ptr[i + 1] > g.obs.ptr[i]) out.push(i);
  return out;
}

function topBy(g, budget, fn) {
  const idx = feasible(g);
  idx.sort((a, b) => fn(b) - fn(a));
  return idx.slice(0, budget);
}

function topoOrder(g) {
  if (g._topo) return g._topo;
  const indeg = Int32Array.from(g.inDeg), q = [], order = [];
  for (let i = 0; i < g.n; i++) if (!indeg[i]) q.push(i);
  while (q.length) {
    const v = q.pop(); order.push(v);
    for (let p = g.outPtr[v]; p < g.outPtr[v + 1]; p++) if (--indeg[g.outIdx[p]] === 0) q.push(g.outIdx[p]);
  }
  g._topo = order; return order;
}

function upstreamSize(g) {
  if (g._up) return g._up;
  const size = new Int32Array(g.n);
  for (const v of topoOrder(g))
    for (let p = g.inPtr[v]; p < g.inPtr[v + 1]; p++) size[v] += size[g.inIdx[p]] + 1;
  g._up = size; return size;
}

/* Brandes betweenness, unweighted. */
function betweenness(g) {
  if (g._btw) return g._btw;
  const n = g.n, CB = new Float64Array(n);
  const sigma = new Float64Array(n), dist = new Int32Array(n), delta = new Float64Array(n);
  const preds = new Array(n);
  for (let s = 0; s < n; s++) {
    const stack = [], queue = [s];
    sigma.fill(0); dist.fill(-1); delta.fill(0);
    for (let i = 0; i < n; i++) preds[i] = null;
    sigma[s] = 1; dist[s] = 0;
    let head = 0;
    while (head < queue.length) {
      const v = queue[head++]; stack.push(v);
      for (let p = g.outPtr[v]; p < g.outPtr[v + 1]; p++) {
        const w = g.outIdx[p];
        if (dist[w] < 0) { dist[w] = dist[v] + 1; queue.push(w); }
        if (dist[w] === dist[v] + 1) { sigma[w] += sigma[v]; (preds[w] || (preds[w] = [])).push(v); }
      }
    }
    while (stack.length) {
      const w = stack.pop();
      if (preds[w]) for (const v of preds[w]) delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      if (w !== s) CB[w] += delta[w];
    }
  }
  g._btw = CB; return CB;
}

/* The anchor plus k manholes upstream and k downstream, breadth-first. */
function collectUpDown(g, anchor, kup, kdown) {
  const out = [anchor], seen = new Set([anchor]);
  let frontier = [anchor];
  for (let step = 0; step < kup && frontier.length; step++) {
    const next = [];
    for (const v of frontier)
      for (let p = g.inPtr[v]; p < g.inPtr[v + 1]; p++) {
        const w = g.inIdx[p];
        if (!seen.has(w)) { seen.add(w); next.push(w); out.push(w); }
      }
    frontier = next;
  }
  frontier = [anchor];
  for (let step = 0; step < kdown && frontier.length; step++) {
    const next = [];
    for (const v of frontier)
      for (let p = g.outPtr[v]; p < g.outPtr[v + 1]; p++) {
        const w = g.outIdx[p];
        if (!seen.has(w)) { seen.add(w); next.push(w); out.push(w); }
      }
    frontier = next;
  }
  return out;
}

/* The two up, two down rule of thumb applied network-wide: anchors largest-catchment-first, spaced so
   their groups do not overlap, then k up and k down around each.
   Anchors are drawn from the same feasible pool as every other algorithm, so the rule is
   not handicapped by spending its anchor on a node that observes nothing. The supporting
   k-up and k-down manholes are taken as the rule dictates, feasible or not, because that
   is exactly what the rule says to do and where its cost shows up. Chambers only: a rule
   that named a spot with no manhole could not be followed on site. */
function twoUpTwoDown(g, budget, kup, kdown) {
  const per = 1 + kup + kdown;
  const nAnchors = Math.max(1, Math.floor(budget / per));
  const up = upstreamSize(g);
  const cand = feasible(g);
  cand.sort((a, b) => up[b] - up[a]);

  const used = new Uint8Array(g.n), anchors = [], out = [];
  for (const a of cand) {
    if (anchors.length >= nAnchors) break;
    if (used[a]) continue;
    const grp = collectUpDown(g, a, kup, kdown).filter(v => g.candidate[v]);
    if (grp.some(v => used[v])) continue;
    anchors.push(a);
    for (const v of grp) { used[v] = 1; if (out.length < budget) out.push(v); }
  }
  for (const a of cand) {         // spend any remainder on further anchors
    if (out.length >= budget) break;
    if (!used[a]) { used[a] = 1; out.push(a); anchors.push(a); }
  }
  return { sensors: out.slice(0, budget), anchors };
}

function randomPlace(g, budget, obj, trials, rnd) {
  trials = trials || 20; rnd = rnd || Math.random;
  const pool = feasible(g);
  let best = null, bestVal = -1, sum = 0;
  for (let t = 0; t < trials; t++) {
    const pick = [], copy = pool.slice();
    for (let i = 0; i < budget && copy.length; i++)
      pick.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
    const r = score(g, pick);
    const val = obj === "length" ? r.len : r.nodes;
    sum += val;
    if (val > bestVal) { bestVal = val; best = pick; }
  }
  return { sensors: best || [], mean: sum / trials };
}

/* Greedy that must include a fixed set, used to price a mandated location. */
function greedyForced(g, forced, budget, obj) {
  const covered = new Uint8Array(g.n), chosen = forced.slice();
  for (const f of forced) { const s = obsOf(g, f); for (let i = 0; i < s.length; i++) covered[s[i]] = 1; }
  const pool = feasible(g);
  while (chosen.length < budget) {
    let best = -1, bv = 0;
    for (const i of pool) {
      const set = obsOf(g, i);
      let val = 0;
      for (let j = 0; j < set.length; j++) if (!covered[set[j]]) val += weightOf(g, set[j], obj);
      if (val > bv) { bv = val; best = i; }
    }
    if (best < 0 || bv <= 0) break;
    chosen.push(best);
    const s = obsOf(g, best);
    for (let i = 0; i < s.length; i++) covered[s[i]] = 1;
  }
  return chosen;
}

return {
  buildGraph, ceilings, computeObservable, obsOf, depthStats,
  score, weightOf, feasible,
  greedy, greedyForced, topBy, topoOrder, upstreamSize, betweenness,
  collectUpDown, twoUpTwoDown, randomPlace,
};
});
