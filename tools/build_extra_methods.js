// Builds demo/data/extra_methods.js: more placements for the demo's Place sensors and Compare pages, 1 to 8 sensors.
//  - Region-less (as Sim 3.5): level sensors chosen from every manhole on growth in every region (no monitor / watch /
//    leave step), where Sim 4 counts only the regions it chose to monitor or watch. Greedy (both aims, nested) and the
//    exact optimum (worst case, then average, then overloads warned, as Sim 4's exact solver).
//  - Manning-based, no simulation: each manhole covers the pipes whose backup would reach it (Ninh et al. 2025's rule,
//    simulation4/data/ninh_compare.js), each pipe weighted by how full Manning's equation says it runs on a design wet
//    day (estimated peak flow / full capacity). Greedy maximises that weight; NSGA-II (Deb et al. 2002) trades it against
//    pipe length covered, and the front's balanced point is kept.
// Reuses the demo's own scoring engine (demo/app.js).
//   node tools/build_extra_methods.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
global.window = global;
global.document = { querySelector: () => null, querySelectorAll: () => [] };
global.DOMParser = class { parseFromString() { return { querySelectorAll: () => [] }; } };
["simulation3/data/catchment.js", "simulation3/data/growth.js", "simulation4/data/regions.js", "simulation4/data/sim4.js", "demo/data/compare.js", "simulation4/data/ninh_compare.js"]
  .forEach(f => vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f }));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "demo/app.js"), "utf8") + "\n;globalThis.App = App;", { filename: "demo/app.js" });
const A = global.App, K = 8, X = SIM3_REGIONS, R = GROWTH_RUNS;
A.prepare();
const all = { ...A.SIM4_TEST(), regions: X.regions.map((r, i) => i) };

// Exact: drop any manhole whose growth runs are a subset of another's (the score only grows as more runs are covered),
// then search the survivors exhaustively, as tools/build_demo_data.js does for Sim 4's own test.
function candidates(o) {
  const steps = X.ladder.map((v, s) => s).filter(s => X.ladder[s] <= 1), els = [];
  const seen = (row, mm) => new Set(row.rise.filter(([, v]) => v >= mm).map(([i]) => i));
  for (const tag of o.cases) for (const r of o.regions) {
    const rows = steps.map(s => X.rows[tag].find(x => x.r === r && x.s === s));
    rows.forEach(x => { if (seen(x, 10).size) els.push(seen(x, o.mm)); });
    const k = rows.findIndex(x => x.sur.length); if (k > 0 && seen(rows[k - 1], 10).size) els.push(seen(rows[k - 1], o.mm));
  }
  const N = R.chambers.length, cov = Array.from({ length: N }, (_, i) => els.map(e => e.has(i) ? "1" : "0").join(""));
  const live = [...Array(N).keys()].filter(i => cov[i].includes("1"));
  const sub = (a, b) => { for (let k = 0; k < a.length; k++) if (a[k] === "1" && b[k] !== "1") return false; return true; };
  return live.filter(i => !live.some(j => j !== i && sub(cov[i], cov[j]) && (cov[i] !== cov[j] || j < i)));
}
const cand = candidates(all);
console.log(`region-less: ${all.regions.length} regions, ${cand.length} candidate manholes after dominance`);
function exactSet(o, k) {
  const n = cand.length, key = sc => sc.worst * 1e6 + sc.avg * 1e3 + sc.warned;
  let best = null, bk = -1;
  (function rec(start, set) {
    if (set.length === k) { const v = key(A.score(set, o)); if (v > bk + 1e-9) { bk = v; best = set.slice(); } return; }
    for (let a = start; a <= n - (k - set.length); a++) { set.push(cand[a]); rec(a + 1, set); set.pop(); }
  })(0, []);
  return best;
}
const t0 = Date.now();
const greedyAvg = A.greedy({ ...all, aim: "avg" }, K).set, greedyWorst = A.greedy({ ...all, aim: "worst" }, K).set;
const exact = Array.from({ length: K }, (_, k) => { const s = exactSet(all, k + 1); console.log(`  exact k=${k + 1} (${Math.round((Date.now() - t0) / 1000)} s)`); return s; });
const prefix = s => Array.from({ length: K }, (_, k) => s.slice(0, k + 1));
// ------------------------------------------------------------------ Manning-based, no simulation
const G = GROWTH_GEOM, NC = NINH_COMPARE, ii = A._.caseOf(SIM4.design).ii, N = R.chambers.length;
const w = Array.from({ length: G.nPipes }, (_, p) => Math.min(2, A.util(p, ii)));      // wet-day flow / full capacity, capped at 2
const covers = NC.covers.map(c => new Set(c));
const union = set => { const u = new Set(); set.forEach(i => covers[i].forEach(p => u.add(p))); return u; };
const risk = set => [...union(set)].reduce((t, p) => t + w[p], 0), len = set => [...union(set)].reduce((t, p) => t + G.plen[p], 0);
function mGreedy(k) {
  const set = [];
  for (let r = 0; r < k; r++) { let b = -1, bv = -1; for (let i = 0; i < N; i++) if (!set.includes(i)) { const v = risk([...set, i]); if (v > bv + 1e-12) { bv = v; b = i; } } set.push(b); }
  return set;
}
let seed = 23; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pick = n => Math.floor(rnd() * n);
function nsga(k, pop = 80, gens = 120) {
  const objs = s => [risk(s), len(s)], dom = (a, b) => a[0] >= b[0] && a[1] >= b[1] && (a[0] > b[0] || a[1] > b[1]);
  const rand = () => { const s = new Set(); while (s.size < k) s.add(pick(N)); return [...s]; }, key = s => s.slice().sort((a, b) => a - b).join();
  const fronts = O => { const n = O.length, S = O.map(() => []), c = new Array(n).fill(0), rank = new Array(n), fr = [[]];
    for (let p = 0; p < n; p++) for (let q = 0; q < n; q++) if (p !== q) { if (dom(O[p], O[q])) S[p].push(q); else if (dom(O[q], O[p])) c[p]++; }
    for (let p = 0; p < n; p++) if (!c[p]) { rank[p] = 0; fr[0].push(p); }
    for (let i = 0; fr[i].length; i++) { const nx = []; for (const p of fr[i]) for (const q of S[p]) if (!--c[q]) { rank[q] = i + 1; nx.push(q); } fr.push(nx); }
    return { fr: fr.filter(f => f.length), rank }; };
  const crowd = (O, f) => { const d = new Map(f.map(i => [i, 0])); for (const m of [0, 1]) { const s = f.slice().sort((a, b) => O[a][m] - O[b][m]), span = (O[s[s.length - 1]][m] - O[s[0]][m]) || 1;
    d.set(s[0], Infinity); d.set(s[s.length - 1], Infinity); for (let j = 1; j < s.length - 1; j++) d.set(s[j], d.get(s[j]) + (O[s[j + 1]][m] - O[s[j - 1]][m]) / span); } return d; };
  let P = [mGreedy(k), ...Array.from({ length: pop - 1 }, rand)], O = P.map(objs);
  for (let g = 0; g < gens; g++) {
    const { fr, rank } = fronts(O), cd = new Map(); fr.forEach(f => crowd(O, f).forEach((v, i) => cd.set(i, v)));
    const better = (a, b) => rank[a] < rank[b] || (rank[a] === rank[b] && cd.get(a) > cd.get(b)) ? a : b, tour = () => P[better(pick(pop), pick(pop))], Q = [];
    while (Q.length < pop) {
      const pool = [...new Set([...tour(), ...tour()])], c = new Set(); while (c.size < k) c.add(pool.length && rnd() < 0.9 ? pool[pick(pool.length)] : pick(N));
      const ch = [...c]; if (rnd() < 0.3) { let j; do j = pick(N); while (ch.includes(j)); ch[pick(k)] = j; } Q.push(ch);
    }
    const seen = new Set(), U = [...P, ...Q].filter(s => { const kk = key(s); if (seen.has(kk)) return false; seen.add(kk); return true; }), UO = U.map(objs), next = [];
    for (const f of fronts(UO).fr) { if (next.length + f.length <= pop) next.push(...f); else { const d = crowd(UO, f); next.push(...f.slice().sort((a, b) => d.get(b) - d.get(a)).slice(0, pop - next.length)); break; } }
    P = next.map(i => U[i]); O = next.map(i => UO[i]);
  }
  // The front's balanced point: the most of both objectives, each scaled to its range on the front.
  const f0 = fronts(O).fr[0].map(i => ({ set: P[i], o: O[i] })), lo = m => Math.min(...f0.map(x => x.o[m])), hi = m => Math.max(...f0.map(x => x.o[m]));
  return f0.reduce((b, x) => { const v = (x.o[0] - lo(0)) / ((hi(0) - lo(0)) || 1) + (x.o[1] - lo(1)) / ((hi(1) - lo(1)) || 1); return v > b.v ? { v, set: x.set } : b; }, { v: -1 }).set;
}
const manGreedy = mGreedy(K), manNsga = Array.from({ length: K }, (_, k) => nsga(k + 1));

const out = { built: new Date().toISOString().slice(0, 10), source: "tools/build_extra_methods.js",
  regionless: { greedyAvg: prefix(greedyAvg), greedyWorst: prefix(greedyWorst), exact },
  manning: { greedy: prefix(manGreedy), nsga: manNsga } };
fs.writeFileSync(path.join(ROOT, "demo/data/extra_methods.js"), "// Generated by tools/build_extra_methods.js. Do not edit.\nwindow.DEMO_EXTRA = " + JSON.stringify(out) + ";\n");
const o = A.SIM4_TEST(), f = s => `${Math.round(A.score(s, o).worst * 100)}% / ${Math.round(A.score(s, o).avg * 100)}% (target) · ${Math.round(A.score(s, all).worst * 100)}% / ${Math.round(A.score(s, all).avg * 100)}% (all)`;
console.log("5 sensors, worst / average:");
console.log("  region-less greedy avg  ", f(greedyAvg.slice(0, 5)));
console.log("  region-less greedy worst", f(greedyWorst.slice(0, 5)));
console.log("  region-less exact       ", f(exact[4]));
console.log("  Sim 4 greedy avg        ", f(A.planIdx(5, "avg")));
console.log("  Manning greedy          ", f(manGreedy.slice(0, 5)));
console.log("  Manning NSGA-II         ", f(manNsga[4]));
