#!/usr/bin/env node
/* check_growth_estimate.js - how close is the Sim 2.5 page's growth-scenario estimate
   (simulation25/growth_est.js) to SWMM? Compared on every run the whole-area grid solved,
   reading the published page data and results/sim25/grid_whole/.

   The page's estimate note quotes these figures; rerun this after changing the estimate,
   the grid, or the cases, and update that note if they move.

   Run:   node tools/check_growth_estimate.js */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
global.window = {};
require(path.join(ROOT, "simulation25/data/catchment.js"));
require(path.join(ROOT, "simulation25/data/growth.js"));
const E = require(path.join(ROOT, "simulation25/growth_est.js"));
const g = window.GROWTH_GEOM, R = window.GROWTH_RUNS, P = E.prepare(g);
const idxOfMh = {}; g.nodes.forEach((n, i) => { if (n.mh) idxOfMh[n.mh] = i; });
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const pct = (a, b) => b ? (100 * a / b).toFixed(0) + "%" : "-";
console.log("case                               | BASELINE depth |err| mm: free-flowing / surcharged | RISE |err| mm | rule 25 mm: found / false   | 150 mm alarm: found / false");
R.cases.forEach((c, k) => {
  const S = JSON.parse(fs.readFileSync(path.join(ROOT, "simulation_src/results/sim25/grid_whole", c.tag, "summary.json")));
  const lpd = R.lpsPerDwelling[k];
  const qBase = E.flows(P, R.baseLoads[k]), base = E.depths(P, qBase);
  const sur = new Set(S.baseline.surcharged.map(Number));
  const eFree = [], eSur = [];
  for (const [mh, d] of Object.entries(S.baseline_depth_m)) {
    const i = idxOfMh[mh]; if (i == null || isNaN(base.depth[i])) continue;
    (sur.has(+mh) ? eSur : eFree).push(Math.abs(1000 * (base.depth[i] - d)));
  }
  let riseErr = [], tp = 0, fp = 0, fn = 0, atp = 0, afp = 0, afn = 0;
  const baseMm = {}; for (const [mh, d] of Object.entries(S.baseline_depth_m)) baseMm[mh] = 1000 * d;
  for (const row of S.rows) {
    const site = idxOfMh[row.site]; if (site == null) continue;
    const loads = new Float64Array(P.nN); loads[site] = row.dwellings * lpd;
    const qg = E.flows(P, loads);
    const qNow = new Float64Array(P.nL); for (let l = 0; l < P.nL; l++) qNow[l] = qBase[l] + qg[l];
    const now = E.depths(P, qNow), est = {};
    for (let i = 0; i < P.nN; i++) {
      if (!g.nodes[i].mh || isNaN(now.depth[i])) continue;
      const r = 1000 * (now.depth[i] - base.depth[i]);
      if (Math.abs(r) > 1e-9) est[g.nodes[i].mh] = r;
    }
    const swmm = row.rise_mm || {};
    const keys = new Set([...Object.keys(swmm), ...Object.keys(est).filter(m => est[m] >= 1)]);
    for (const m of keys) {
      const a = est[m] || 0, b = swmm[m] || 0;
      riseErr.push(Math.abs(a - b));
      const ea = a >= 25, sa = b >= 25;
      if (ea && sa) tp++; else if (ea) fp++; else if (sa) fn++;
    }
    // 150 mm alarm newly crossed: estimate (baseline est + rise) vs SWMM's own list
    const swAlarm = new Set((row.alarm || []).map(String));
    for (const m of Object.keys(est)) {
      const i = idxOfMh[m], b0 = 1000 * base.depth[i], b1 = b0 + est[m];
      const ea = b0 < 150 && b1 >= 150;
      if (ea && swAlarm.has(m)) atp++; else if (ea) afp++;
    }
    for (const m of swAlarm) { const i = idxOfMh[m]; if (i == null) continue;
      const b0 = 1000 * base.depth[i], e = est[m] || 0;
      if (!(b0 < 150 && b0 + e >= 150)) afn++; }
  }
  console.log(
    c.label.padEnd(35), "|",
    ("median " + q(eFree, .5).toFixed(1) + ", 90% " + q(eFree, .9).toFixed(1)).padEnd(24), "/",
    (eSur.length ? "median " + q(eSur, .5).toFixed(0) + " (" + eSur.length + ")" : "none").padEnd(18), "|",
    ("med " + q(riseErr, .5).toFixed(1) + ", 90% " + q(riseErr, .9).toFixed(1)).padEnd(16), "|",
    (pct(tp, tp + fn) + " / " + pct(fp, tp + fp)).padEnd(26), "|", pct(atp, atp + afn) + " / " + pct(afp, atp + afp));
});
