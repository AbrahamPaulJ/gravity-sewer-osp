/* osp_risk.js — blockage likelihood per reach, from published pipe attributes.
   No DOM. Loadable in a worker and in node.

   WHY THIS EXISTS
   ---------------
   Both existing models treat every chamber as an equally likely place for
   something to go wrong. Ninh 2025 says so itself and names the fix as its own
   obvious extension: "this method can improve the effectiveness of sensor location
   distribution if considering other factors such as high-risk regions". Crowley
   2025 names the same gap as its own limitation. The literature on what makes a
   sewer fail is separate from the literature on where to put sensors, and nothing
   joins them.

   This module is the join. It turns the per-pipe attributes into a likelihood per
   reach, aggregates that to an expected-blockage exposure per chamber, and hands
   it to osp_core's weightOf as a weight vector. Every algorithm there already
   routes its scoring through that one function, so this makes all of them
   risk-weighted without any of them knowing what risk is.

   WHAT THIS IS NOT, AND THIS MATTERS MOST
   ---------------------------------------
   These weights are DECLARED, not fitted. Nothing here is calibrated against a
   recorded blockage, because no public source lists chokes for this network. That
   is the same position the demand setting is in, and it gets the same treatment:
   the numbers are settings you can see and change, the sensitivity is published
   next to the result, and the defensible claim is the RANKING of reaches, never
   the absolute score.

   The temptation this module exists to resist is inventing a formula, giving it
   three decimal places and calling it data. The rebuild deleted a global
   coefficient for exactly that sin. So: no factor appears here without a
   direction the literature actually supports, every weight is exposed, and the
   agreement between blends is reported so a reader can see how much the blend is
   doing versus how much the data is.

   Do not import thresholds from elsewhere. Malek Mohammadi 2020's central finding
   is that condition models contradict each other on diameter, depth and length
   because each is fitted to local geography; the reason its own review cannot
   resolve them is the reason this file does not quote them.  */

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OSPRisk = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

/* Default blend. Ordered to follow the only ranking in the corpus that was
   measured rather than asserted: Ma 2025 learned a Bayesian network over 23,000
   Hong Kong pipes and ranked age well clear of the field by mutual information
   (0.124), then diameter (0.032). The ORDER is borrowed; the numbers are not,
   because that study's thresholds are Hong Kong's geology and asset stock.

   Everything sums to 1 so the score stays in [0,1] and a weight can be read as
   "share of the answer this factor is responsible for". */
const DEFAULT_WEIGHTS = {
  age: 0.30,        // Ma 2025 rank 1. Deterioration, root entry, roughness.
  diameter: 0.25,   // Ma 2025 rank 2. Drenoyanis and Alshami both find blockages
                    //   concentrate in small-diameter reticulation.
  gradient: 0.20,   // Malek Mohammadi: flat -> low velocity -> deposition -> H2S.
  material: 0.15,   // Resistance to abrasion, acid and root penetration.
  joint: 0.05,      // Joints are the usual root entry point, but published on
                    //   barely half the records, so it cannot carry much weight.
  length: 0.05,     // Longer reaches hold more joints and more lateral connections.
};

/* Per-material blockage propensity, 0 to 1. Declared, and the reasoning is the
   only thing defending them: vitrified clay is jointed, brittle and the classic
   root-entry material; uPVC is smooth, has far fewer joints per length and
   resists roots; reinforced concrete sits between, durable but subject to acid
   attack in flat reaches where sulphides form. */
const MATERIAL_RISK = { VC: 1.0, RC: 0.7, PVCU: 0.3 };

/* Per-joint-type propensity. Rigid and bituminous joints open up as ground moves
   and are where roots get in; rubber ring joints are the modern flexible answer. */
const JOINT_RISK = { BIT: 1.0, SCJ: 0.8, PLAST: 0.4, RRJ: 0.3 };

/* Reference points for the two factors that need one. A gradient at or above
   GRADE_REF is treated as comfortably self-cleansing and scores zero; the figure
   is near the slope at which a 150 mm sewer reaches self-cleansing velocity, so
   it is a design convention rather than a measurement. LENGTH_REF is the reach
   length at which the length factor saturates. */
const GRADE_REF = 1.0;      // percent
const LENGTH_REF = 100;     // metres
const UNKNOWN = 0.5;        // neutral score where an attribute is not published

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

/* ------------------------------------------------------------- the factors */
/* Each factor is normalised to [0,1] with 1 meaning "more likely to block", so
   they can be blended without any of them dominating through units alone.

   Diameter and age normalise over the range actually present in this network
   rather than against an absolute threshold. That is deliberate: it keeps the
   score a statement about THIS network, which is what a ranking needs, and it
   avoids importing a cutoff from a different city. It also means a score is not
   comparable between regions, which is stated in the summary. */
function factors(g, opt) {
  opt = opt || {};
  const m = g.edges.length;
  const P = g.pipes;
  const out = {
    diameter: new Float64Array(m), gradient: new Float64Array(m),
    age: new Float64Array(m), material: new Float64Array(m),
    joint: new Float64Array(m), length: new Float64Array(m),
  };
  const have = { diameter: 0, gradient: 0, age: 0, material: 0, joint: 0, length: m };
  const matCodes = opt.matCodes || null, jointCodes = opt.jointCodes || null;

  // Observed spans, ignoring the unpublished.
  let dLo = Infinity, dHi = -Infinity, yLo = Infinity, yHi = -Infinity;
  for (let e = 0; e < m; e++) {
    const d = P && P.dia ? P.dia[e] : 0;
    if (d > 0) { if (d < dLo) dLo = d; if (d > dHi) dHi = d; }
    const y = P && P.year ? P.year[e] : 0;
    if (y > 0) { if (y < yLo) yLo = y; if (y > yHi) yHi = y; }
  }
  const dSpan = Math.max(1e-9, dHi - dLo), ySpan = Math.max(1e-9, yHi - yLo);

  for (let e = 0; e < m; e++) {
    // Diameter: inverted, small bore scores high.
    const d = P && P.dia ? P.dia[e] : 0;
    if (d > 0) { out.diameter[e] = clamp01((dHi - d) / dSpan); have.diameter++; }
    else out.diameter[e] = UNKNOWN;

    // Gradient: flat scores high, self-cleansing and steeper scores zero. Falls
    // back to fall-over-length when the publisher carries no gradient.
    let gr = P && P.grade && P.grade[e] > 0 ? P.grade[e] : 0;
    if (!gr) {
      const u = g.edges[e][0], v = g.edges[e][1];
      const L = Math.max(g.lengths[e], 0.1);
      const s = (g.inv[u] - g.inv[v]) / L;
      gr = s > 0 ? s * 100 : 0;
    } else have.gradient++;
    out.gradient[e] = gr > 0 ? clamp01((GRADE_REF - gr) / GRADE_REF) : 1;

    // Age: oldest in the network scores 1.
    const y = P && P.year ? P.year[e] : 0;
    if (y > 0) { out.age[e] = clamp01((yHi - y) / ySpan); have.age++; }
    else out.age[e] = UNKNOWN;

    // Material and joint: declared table lookups.
    const mi = P && P.mat ? P.mat[e] : -1;
    const mk = mi >= 0 && matCodes ? matCodes[mi] : null;
    if (mk && MATERIAL_RISK[mk] != null) { out.material[e] = MATERIAL_RISK[mk]; have.material++; }
    else out.material[e] = UNKNOWN;

    const ji = P && P.joint ? P.joint[e] : -1;
    const jk = ji >= 0 && jointCodes ? jointCodes[ji] : null;
    if (jk && JOINT_RISK[jk] != null) { out.joint[e] = JOINT_RISK[jk]; have.joint++; }
    else out.joint[e] = UNKNOWN;

    // Length: saturating, because a 400 m reach is not four times the problem a
    // 100 m one is; it is one reach with more places to go wrong.
    out.length[e] = clamp01(g.lengths[e] / LENGTH_REF);
  }
  return { f: out, have, span: { dLo, dHi, yLo, yHi } };
}

/* --------------------------------------------------------- the likelihood */
/* Blend the factors, then aggregate to chambers.

   Node aggregation is length-weighted, not an average: a chamber's exposure to
   blockage is the exposure of the pipes that arrive at it, and a long bad pipe
   carries more of it than a short one. That makes node[v] an expected-blockage
   proxy in metre-units, which is exactly the shape weightOf wants — the same
   shape lenIn already has, for the same reason.

   Head-of-line chambers have no incoming pipe and therefore score zero. That is
   correct rather than a gap: a blockage there is a blockage in the reach below
   it, which is credited to the chamber that reach arrives at. */
function likelihood(g, opt) {
  opt = opt || {};
  const w = Object.assign({}, DEFAULT_WEIGHTS, opt.weights || {});
  let wsum = 0;
  for (const k in w) wsum += w[k];
  if (wsum <= 0) throw new Error("blockage weights sum to zero, so nothing is being scored");

  const { f, have, span } = factors(g, opt);
  const m = g.edges.length;
  const edge = new Float64Array(m);
  for (let e = 0; e < m; e++) {
    let v = 0;
    for (const k in w) v += w[k] * f[k][e];
    edge[e] = v / wsum;
  }

  /* Two ways to bring a per-reach likelihood up to a chamber, and they answer
     different questions. The choice matters more than it looks.

       exposure  = sum of length x likelihood over the incoming reaches.
                   Proportional to expected blockage COUNT, so it is the right
                   objective for catching the most events.
       intensity = the same sum divided by the incoming length, i.e. a
                   length-weighted mean. Proportional to how BAD this chamber's
                   pipes are, independent of how much pipe it happens to collect.

     Exposure is the theoretically correct one and it is the default, but it has a
     trap that has to be stated: reach length spans a factor of 262 in this network
     while likelihood spans a factor of 2.8, so the length term dominates and
     exposure rank-correlates about 0.98 with plain incoming length. Optimising it
     therefore lands close to the existing "maximise pipe length" objective, and a
     placement built on it is barely a risk-weighted placement at all.

     Intensity is the one that isolates condition. Use exposure to argue how many
     blockages a rollout should catch; use intensity to argue which chambers are
     sitting on the worst pipe. Reporting either without saying which is how a
     risk-weighted claim stops being checkable. */
  const agg = opt.aggregate === "intensity" ? "intensity" : "exposure";
  const node = new Float64Array(g.n);
  const lenAt = new Float64Array(g.n);
  for (let e = 0; e < m; e++) {
    const v = g.edges[e][1];
    node[v] += g.lengths[e] * edge[e];
    lenAt[v] += g.lengths[e];
  }
  if (agg === "intensity")
    for (let i = 0; i < g.n; i++) node[i] = lenAt[i] > 0 ? node[i] / lenAt[i] : 0;

  let lo = Infinity, hi = -Infinity, tot = 0;
  for (let e = 0; e < m; e++) {
    if (edge[e] < lo) lo = edge[e];
    if (edge[e] > hi) hi = edge[e];
    tot += edge[e] * g.lengths[e];
  }

  return {
    edge, node, factors: f,
    summary: {
      weights: w, edges: m, aggregate: agg,
      hasAttributes: !!g.pipes,
      min: isFinite(lo) ? lo : 0, max: isFinite(hi) ? hi : 0,
      exposureTotal: tot,
      published: have,
      span,
      /* Scores normalise over this network's own range, so they rank reaches
         within a region and mean nothing across regions. Said here so a caller
         cannot quietly compare two. */
      comparableAcrossRegions: false,
    },
  };
}

/* ------------------------------------------------------------ sensitivity */
/* How much of the answer is the data, and how much is the blend?

   Reported as Spearman rank correlation between each factor on its own and the
   blended score. Rank correlation, not an overlap of top-k sets, because the
   factors are heavily tied: diameter takes seven distinct values across a
   thousand reaches, so "the top 100 by diameter" is an arbitrary hundred of the
   757 that share the smallest bore, and any overlap measured against it reports
   the tie-breaking, not the agreement. Average ranks handle that correctly.

   A factor correlating near 1 is doing most of the ranking by itself. Factors
   correlating weakly with the blend are the ones whose weight is deciding the
   answer, and any result quoted from this module has to be quoted with them.

   This is the blockage-likelihood equivalent of the demand ladder, and it exists
   for the same reason: to stop a number being quoted without the setting that
   produced it. */
function rankOf(a) {
  const n = a.length;
  const idx = Array.from(a.keys()).sort((i, j) => a[i] - a[j]);
  const r = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && a[idx[j + 1]] === a[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;                 // average rank across the tie
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    sab += da * db; saa += da * da; sbb += db * db;
  }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}

function agreement(g, opt) {
  opt = opt || {};
  const blended = likelihood(g, opt);
  const rb = rankOf(blended.edge);
  const rows = [];
  for (const key in DEFAULT_WEIGHTS) {
    const solo = likelihood(g, Object.assign({}, opt, {
      weights: Object.keys(DEFAULT_WEIGHTS).reduce((o, kk) => (o[kk] = kk === key ? 1 : 0, o), {}),
    }));
    rows.push({
      factor: key,
      weight: blended.summary.weights[key],
      rho: pearson(rankOf(solo.edge), rb),
      distinct: new Set(Array.from(solo.edge)).size,
    });
  }
  rows.sort((a, b) => b.rho - a.rho);
  return { rows, blended };
}

return {
  DEFAULT_WEIGHTS, MATERIAL_RISK, JOINT_RISK,
  GRADE_REF, LENGTH_REF,
  factors, likelihood, agreement, rankOf,
};
});
