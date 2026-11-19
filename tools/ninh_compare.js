// Ninh et al. (2025) topology-aware placement, by greedy, against Sim 4's simulation-based placement.
//
// Ninh, Do, Zeng & Lambert (2025), "Optimal Sensor Placement in Smart Sewer Systems Using Network Topology and
// Elevation", J. Water Resour. Plann. Manage. 151(7) 04025016. A level sensor at manhole s sees a blockage at a
// manhole v downstream of it when the water backed up at v reaches the sensor (Eq. 1):
//     Z_v + H_d - e > Z_s + H_s,   H_d = 0.7 x depth of v,   e = 0 (as in the paper),
// with Z the invert level and H_s the sensor's normal water depth (here: the model's dry-day depth). A covered manhole
// covers the pipe leaving it, and coverage is pipe length, as in the paper. The paper searches with a genetic
// algorithm; here the same objective is maximised greedily (each sensor added covers the most new pipe length).
// No hydraulic simulation is used to place these sensors: only the network's topology and elevations.
//
// Every placement is then scored on Sim 4's 504 simulated growth scenarios (8 weather cases x 9 regions x 7 build-out
// steps; SWMM, steady flows, uncalibrated), on:
//   - scenario coverage, Sim 4's own test (7 wet cases, target regions, up to the 2041 homes; worst and average case),
//   - growth monitoring on every scenario: a sensor's level rises 10 mm or more,
//   - detection of growth-caused overcapacity (a manhole newly past 0.7 of pipe height), surcharge (newly above the
//     pipe crown) and overflow (newly at the lid): seen at the time, and warned one build-out step before,
//   - Ninh's own measure, pipe length covered for blockages,
// so each method is tested on the other's objective too.
//   node tools/ninh_compare.js        writes simulation4/data/ninh_compare.js and docs/ninh_compare.md
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
global.window = global;
global.document = { querySelector: () => null, querySelectorAll: () => [] };
global.DOMParser = class { parseFromString() { return { querySelectorAll: () => [] }; } };
["simulation3/data/catchment.js", "simulation3/data/growth.js", "simulation4/data/regions.js", "simulation4/data/sim4.js", "simulation35/data/sim35.js"]
  .forEach(f => vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f }));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "demo/app.js"), "utf8") + "\n;globalThis.App = App;", { filename: "demo/app.js" });
const A = global.App; A.prepare();
const G = GROWTH_GEOM, RUNS = GROWTH_RUNS, X = SIM3_REGIONS, S4 = SIM4;
const K = 8, MM = 10, HD = 0.7, EPS = 0;
const N = RUNS.chambers.length, idxOf = n => RUNS.chambers.indexOf(n);
const DRY = X.cases.find(c => c.ii === 0).tag;

// ------------------------------------------------------------------ Ninh: who sees which pipes
const node = G.nodes, Z = v => G.oz + node[v].inv / 100;
const outPipes = node.map(() => []);
for (let p = 0; p < G.nPipes; p++) outPipes[G.up[p]].push(p);
const chNode = RUNS.chambers.map(nm => node.findIndex(n => n.name === nm));
const Hs = i => ((X.base[DRY].depthMm || {})[i] || 0) / 1000;
const totalLen = G.plen.reduce((t, v) => t + v, 0);
// covers[i]: pipes whose blockage the sensor at chamber i would see (BFS downstream, Eq. 1 at every node reached)
const covers = chNode.map((s, i) => {
  const lvl = Z(s) + Hs(i), seen = new Set([s]), q = [s], pipes = new Set();
  while (q.length) {
    const v = q.shift();
    if (Z(v) + HD * node[v].depth - EPS > lvl) outPipes[v].forEach(p => pipes.add(p));
    for (const p of outPipes[v]) { const w = G.down[p]; if (!seen.has(w)) { seen.add(w); q.push(w); } }
  }
  return pipes;
});
const ninhCover = set => { const u = new Set(); set.forEach(i => covers[i].forEach(p => u.add(p))); return u; };
const ninhLen = set => [...ninhCover(set)].reduce((t, p) => t + G.plen[p], 0) / totalLen;
function ninhGreedy(k) {
  const set = [], got = new Set();
  for (let r = 0; r < k; r++) {
    let best = -1, gain = -1;
    for (let i = 0; i < N; i++) { if (set.includes(i)) continue; let g = 0; covers[i].forEach(p => { if (!got.has(p)) g += G.plen[p]; }); if (g > gain + 1e-9) { gain = g; best = i; } }
    set.push(best); covers[best].forEach(p => got.add(p));
  }
  return set;
}
// The most Ninh's rule can cover with a sensor in every manhole, and how many sensors reach a share of that
// (the paper's first question, full coverage, is out of reach on a network this steep).
const ORDER = ninhGreedy(N), maxCov = ninhLen(ORDER);
function ninhFull(share) { for (let k = 1; k <= N; k++) if (ninhLen(ORDER.slice(0, k)) >= share * maxCov - 1e-9) return k; return N; }

// ------------------------------------------------------------------ placements, 1 to K sensors
const nested = arr => Array.from({ length: K }, (_, k) => arr.slice(0, k + 1));
const ninh = nested(ninhGreedy(K));
const gAvg = S4.explore.ladder.slice(0, K).map(s => s.map(idxOf));
const gWorst = (S4.explore.ladderWorst || []).slice(0, K).map(s => s.map(idxOf));
const exact = S4.explore.exact.slice(0, K).map(s => s.map(idxOf));

// ------------------------------------------------------------------ growth scenarios and events
const o = A.SIM4_TEST();
const tags = X.cases.map(c => c.tag), wetTags = X.cases.filter(c => c.ii > 0).map(c => c.tag);
const rise = x => new Map(x.rise.map(([i, v]) => [i, v]));
const hears = (set, x) => { const m = rise(x); return set.some(i => (m.get(i) || 0) >= MM); };
const KINDS = { alarm: "Overcapacity (past 0.7 of pipe height)", sur: "Surcharge (above the pipe crown)", spill: "Overflow (water at the lid)" };
function evaluate(set, upTo = Infinity) {
  const steps = X.ladder.map((v, s) => s).filter(s => X.ladder[s] <= upTo);
  let runs = 0, seenRuns = 0, wetRuns = 0, wetSeen = 0; const ev = {};
  for (const k of Object.keys(KINDS)) ev[k] = { series: 0, atTime: 0, atSpot: 0, early: 0, events: 0 };
  for (const t of tags) for (let r = 0; r < X.regions.length; r++) {
    const rows = steps.map(s => X.rows[t].find(x => x.r === r && x.s === s)).filter(Boolean);
    rows.forEach(x => { const any = x.rise.some(([, v]) => v >= MM); if (!any) return; runs++; if (hears(set, x)) seenRuns++; if (t !== DRY) { wetRuns++; if (hears(set, x)) wetSeen++; } });
    for (const k of Object.keys(KINDS)) {
      const j = rows.findIndex(x => x[k].length); if (j < 0) continue;
      const e = ev[k]; e.series++; e.events += rows[j][k].length;
      if (hears(set, rows[j])) e.atTime++;
      if (rows[j][k].some(i => set.includes(i))) e.atSpot++;
      if (j > 0 && hears(set, rows[j - 1])) e.early++;
    }
  }
  return { runs, seenRuns, growth: seenRuns / runs, wetRuns, wetSeen, growthWet: wetSeen / wetRuns, ev };
}
const sc = set => { const s = A.score(set, o), h = s.per.reduce((a, c) => c.share < a.share ? c : a, s.per[0]); return { worst: s.worst, avg: s.avg, warned: s.warned, warnable: s.warnable, hard: { hit: h.hit, n: h.n, tag: h.tag }, per: s.per.map(c => ({ tag: c.tag, hit: c.hit, n: c.n })) }; };

// ------------------------------------------------------------------ a fast scenario-coverage score, for the searches
// The same test as A.score (Sim 4's: 7 wet cases, target regions, up to the 2041 homes, a 10 mm rise), as bitmasks.
const FAST = (() => {
  const steps = X.ladder.map((v, s) => s).filter(s => X.ladder[s] <= 1), per = [];
  for (const t of o.cases) {
    const runs = [];
    for (const r of o.regions) for (const s of steps) { const x = X.rows[t].find(y => y.r === r && y.s === s); if (x && x.rise.some(([, v]) => v >= MM)) runs.push(new Set(x.rise.filter(([, v]) => v >= o.mm).map(([i]) => i))); }
    const mask = Array.from({ length: N }, (_, i) => runs.reduce((m, e, j) => e.has(i) ? m | (1n << BigInt(j)) : m, 0n));
    per.push({ n: runs.length, mask });
  }
  const bits = x => { let c = 0; while (x) { x &= x - 1n; c++; } return c; };
  return set => { const sh = per.map(c => bits(set.reduce((m, i) => m | c.mask[i], 0n)) / c.n); return { worst: Math.min(...sh), avg: sh.reduce((a, b) => a + b, 0) / sh.length }; };
})();
for (const set of [gAvg[4], gWorst[4], exact[4], ninh[4], [1, 2, 3]]) {
  const a = A.score(set, o), b = FAST(set);
  if (Math.abs(a.worst - b.worst) > 1e-9 || Math.abs(a.avg - b.avg) > 1e-9) throw new Error(`fast score differs from the demo's: ${JSON.stringify({ set, a: [a.worst, a.avg], b })}`);
}

// ------------------------------------------------------------------ other global-coverage algorithms (Ninh's objective)
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pick = n => Math.floor(rnd() * n);
const lenOf = set => ninhLen(set);
// Genetic algorithm, as in Ninh et al.: k distinct manholes per chromosome, tournament selection, crossover that keeps
// k distinct genes, swap mutation, elitism. Population 80, 200 generations.
function ga(k, fit = lenOf, pop = 80, gens = 200) {
  const rand = () => { const s = new Set(); while (s.size < k) s.add(pick(N)); return [...s]; };
  let P = Array.from({ length: pop }, rand), F = P.map(fit);
  const tour = () => { const a = pick(pop), b = pick(pop); return F[a] >= F[b] ? P[a] : P[b]; };
  for (let g = 0; g < gens; g++) {
    const best = F.indexOf(Math.max(...F)), Q = [P[best]];
    while (Q.length < pop) {
      const pool = [...new Set([...tour(), ...tour()])], c = new Set();
      while (c.size < k) c.add(pool.length && rnd() < 0.9 ? pool[pick(pool.length)] : pick(N));
      const ch = [...c]; if (rnd() < 0.3) { let j; do j = pick(N); while (ch.includes(j)); ch[pick(k)] = j; }
      Q.push(ch);
    }
    P = Q; F = P.map(fit);
  }
  return P[F.indexOf(Math.max(...F))];
}
// General coverage greedy: each sensor covers the manholes within R_HOPS pipes of it, upstream or downstream (the
// radius, or k-hop, model common in coverage-based placement, and the Sandbox's earlier one); each sensor added
// covers the most manholes not yet covered. No simulation and no elevations: topology only.
const R_HOPS = 2, adj = node.map(() => []);
for (let p = 0; p < G.nPipes; p++) { adj[G.up[p]].push(G.down[p]); adj[G.down[p]].push(G.up[p]); }
const chOf = new Map(chNode.map((v, i) => [v, i]));
const hops = chNode.map(s => { const d = new Map([[s, 0]]), q = [s], out = new Set();
  while (q.length) { const v = q.shift(); if (chOf.has(v)) out.add(chOf.get(v)); if (d.get(v) < R_HOPS) for (const w of adj[v]) if (!d.has(w)) { d.set(w, d.get(v) + 1); q.push(w); } }
  return out; });
const hopCover = set => { const u = new Set(); set.forEach(i => hops[i].forEach(j => u.add(j))); return u.size / N; };
function covGreedy(k) {
  const set = [], got = new Set();
  for (let r = 0; r < k; r++) {
    let best = -1, gain = -1;
    for (let i = 0; i < N; i++) { if (set.includes(i)) continue; let g = 0; hops[i].forEach(j => { if (!got.has(j)) g++; }); if (g > gain) { gain = g; best = i; } }
    set.push(best); hops[best].forEach(j => got.add(j));
  }
  return set;
}
const per = f => Array.from({ length: K }, (_, k) => f(k + 1));


const METHODS = [
  { id: "ninh", family: "topology", label: "Ninh rule, greedy", sets: ninh, note: "Each sensor adds the most pipe length covered for blockages (Ninh et al. 2025 detection rule)" },
  { id: "ga", family: "topology", label: "Ninh rule, genetic algorithm", sets: per(k => ga(k)), note: "The paper's own search: a genetic algorithm on the same objective" },
  { id: "cov", family: "coverage", label: "Coverage greedy (2-pipe radius)", sets: nested(covGreedy(K)), note: `Each sensor covers the manholes within ${R_HOPS} pipes of it, up or down; each one added covers the most new manholes` },
  // Sim 3.5's placement: simulated growth too, but no regions: chosen from every manhole (sim35_warn.py), the exact set
  // that most warns, one build-out step ahead, of the first new surcharge in the hardest wet case (10 mm rule), on Sim 3's runs.
  { id: "s35", family: "regionless", label: "Sim 3.5, region-less", sets: SIM35.warn.r10.sets.slice(0, K).map(s => s.chosen.slice()), note: "Simulated growth on Sim 3's runs, chosen from every manhole with no regions: the set that most warns, a step ahead, of the first new surcharge in the hardest wet case" },
  { id: "gAvg", family: "simulation", label: "Sim 4 Greedy: average (current)", sets: gAvg, note: "Simulated growth; each sensor adds most to the average over 7 wet cases" },
  { id: "gWorst", family: "simulation", label: "Sim 4 Greedy: worst case", sets: gWorst, note: "Simulated growth; each sensor adds most to the hardest wet case" },
].filter(m => m.sets.length === K);

// ------------------------------------------------------------------ check against Sim 4's published figures
const pub = S4.explore.rungs.find(r => r.k === 5), mine = sc(gAvg[4]);
if (Math.abs(pub.worst - mine.worst) > 1e-3 || Math.abs(pub.average - mine.avg) > 1e-3) throw new Error(`scenario coverage does not match Sim 4: ${JSON.stringify({ pub, mine })}`);

// ------------------------------------------------------------------ results
const res = METHODS.map(m => ({
  id: m.id, family: m.family, label: m.label, note: m.note, sets: m.sets, sites: m.sets.map(s => s.map(i => RUNS.chambers[i])),
  byK: m.sets.map(set => ({ k: set.length, ninh: ninhLen(set), hop: hopCover(set), scenario: sc(set), all: evaluate(set), by2041: evaluate(set, 1) })),
}));
const out = { source: "tools/ninh_compare.js", paper: "Ninh, Do, Zeng & Lambert (2025), JWRPM 151(7) 04025016", rule: { HdShare: HD, eps: EPS, Hs: "dry-day depth in the model", mm: MM },
  network: { pipes: G.nPipes, km: +(totalLen / 1000).toFixed(2), chambers: N }, ninhFull: { max: maxCov, all: ninhFull(1), p95: ninhFull(0.95), p80: ninhFull(0.8), p50: ninhFull(0.5) },
  overlap5: Object.fromEntries(res.map(m => [m.id, m.byK[4] && res[0].byK[4] ? m.sites[4].filter(x => res[0].sites[4].includes(x)).length : null])),
  kinds: KINDS, methods: res, covers: covers.map(c => [...c]), totalLen };
fs.writeFileSync(path.join(ROOT, "simulation4/data/ninh_compare.js"), "// Generated by tools/ninh_compare.js. Do not edit.\nwindow.NINH_COMPARE = " + JSON.stringify(out) + ";\n");

// ------------------------------------------------------------------ report
const P = v => v == null ? "–" : `${Math.round(v * 100)}%`, F = (a, b) => `${a} of ${b}`;
const L = [];
L.push("# Ninh's topology-aware placement against Sim 4's simulation-based placement", "",
  "Generated by `tools/ninh_compare.js`. Uncalibrated, steady-flow model: these figures compare methods on the same runs; they do not forecast.", "",
  "## Method", "",
  `- **Ninh (2025), greedy.** A sensor at manhole s sees a blockage at a downstream manhole v if Z_v + 0.7·H_v > Z_s + H_s (Eq. 1, ε = 0), with H_s the dry-day water depth. A covered manhole covers the pipe leaving it; coverage is pipe length (${out.network.km} km, ${G.nPipes} pipes, ${N} candidate manholes). The paper uses a genetic algorithm; this uses greedy maximum coverage. No simulation is used to place the sensors.`,
  "- **Ninh (2025), genetic algorithm**: the paper's own search on the same objective.",
  "- **Coverage greedy (2-pipe radius)**: the general coverage model. Each sensor covers every manhole within 2 pipes of it, up or down the network; greedy adds the manhole that covers the most new ones. Topology only.",
  "- **Sim 3.5, region-less**: simulated growth (Sim 3's runs), sensors chosen from every manhole with no regions; the exact set that most warns, a build-out step ahead, of the first new surcharge in the hardest wet case (\`simulation_src/sim35_warn.py\`).",
  "- **Sim 4, Greedy: average** (current) and **Greedy: worst case**: chosen on simulated growth, within the regions to monitor or watch.",
  `- **Scored on Sim 4's 504 runs.** Growth monitoring: a sensor rises ${MM} mm or more. Overcapacity, surcharge, overflow: the first build-out step at which a manhole newly crosses 0.7 of pipe height, the pipe crown, or the lid, per weather case and region. *At the time*: a sensor rises ${MM} mm in that run. *Early*: a sensor had risen ${MM} mm one step before. *At the spot*: a sensor sits at a manhole that crossed.`,
  "- **Two scopes.** Scenario coverage is Sim 4's test: growth in its target regions (monitor or watch), up to the 2041 homes. Growth monitoring and the events count every region and every build-out step. Sim 3.5 chose from every manhole with no regions, so it does better on the second and worse on the first.",
  `- Scenario coverage figures for Greedy: average match Sim 4's published ones (5 sensors: ${P(pub.worst)} worst, ${P(pub.average)} average).`, "",
  `On this steep network Ninh's rule cannot reach full coverage: a sensor in every one of the ${N} manholes covers **${P(out.ninhFull.max)} of the pipe length**, because a backup 0.7 of a manhole deep reaches only a short way up a steep pipe (the paper notes the same for steep systems). Reaching that maximum takes ${out.ninhFull.all} sensors; half of it, ${out.ninhFull.p50}; 80% of it, ${out.ninhFull.p80}.`, "");
const at5 = res.map(m => ({ m, r: m.byK[4] }));
L.push("## Five sensors", "", "| | " + at5.map(x => x.m.label).join(" | ") + " |", "|---|" + at5.map(() => "---|").join(""));
const row = (name, f) => L.push(`| ${name} | ` + at5.map(x => f(x.r)).join(" | ") + " |");
row("**Ninh coverage** (pipe length covered for blockages)", r => P(r.ninh));
row("**Radius coverage** (manholes within 2 pipes of a sensor)", r => P(r.hop));
row("**Scenario coverage, worst wet case** (Sim 4's test)", r => P(r.scenario.worst));
row("**Scenario coverage, average** (Sim 4's test)", r => P(r.scenario.avg));
row("Growth monitoring, all 504 runs with a 10 mm rise anywhere", r => `${P(r.all.growth)} (${F(r.all.seenRuns, r.all.runs)})`);
row("Growth monitoring, wet weather only", r => P(r.all.growthWet));
for (const [k, lab] of Object.entries(KINDS)) {
  row(`${lab}: seen at the time`, r => F(r.all.ev[k].atTime, r.all.ev[k].series));
  row(`${lab}: warned a step early`, r => F(r.all.ev[k].early, r.all.ev[k].series));
  row(`${lab}: sensor at the spot`, r => F(r.all.ev[k].atSpot, r.all.ev[k].series));
}
L.push("", "Event counts are (weather case × region) series in which growth up to 3× the 2041 homes causes the event; up to the 2041 homes only:", "");
L.push("| | " + at5.map(x => x.m.label).join(" | ") + " |", "|---|" + at5.map(() => "---|").join(""));
for (const [k, lab] of Object.entries(KINDS)) L.push(`| ${lab}: seen / early | ` + at5.map(x => { const e = x.r.by2041.ev[k]; return e.series ? `${e.atTime} / ${e.early} of ${e.series}` : "none"; }).join(" | ") + " |");
L.push("", "## Difference: Ninh against Sim 4 Greedy: average, by sensor count", "", "| Sensors | Ninh coverage, Ninh / Sim 4 | Scenario coverage worst, Ninh / Sim 4 | Scenario coverage average, Ninh / Sim 4 | Growth monitoring (all runs), Ninh / Sim 4 |", "|---|---|---|---|---|");
const a = res.find(m => m.id === "ninh"), b = res.find(m => m.id === "gAvg");
for (let k = 0; k < K; k++) { const x = a.byK[k], y = b.byK[k]; L.push(`| ${k + 1} | ${P(x.ninh)} / ${P(y.ninh)} | ${P(x.scenario.worst)} / ${P(y.scenario.worst)} | ${P(x.scenario.avg)} / ${P(y.scenario.avg)} | ${P(x.all.growth)} / ${P(y.all.growth)} |`); }
L.push("", "## Every method, five sensors", "", "| Method | Ninh coverage | Scenario coverage worst / average | Growth noticed (all runs) | Overcapacity / surcharge / overflow seen |", "|---|---|---|---|---|");
res.forEach(m => { const x = m.byK[4], e = x.all.ev; L.push(`| ${m.label} | ${P(x.ninh)} | ${P(x.scenario.worst)} / ${P(x.scenario.avg)} | ${P(x.all.growth)} | ${e.alarm.atTime}/${e.alarm.series} · ${e.sur.atTime}/${e.sur.series} · ${e.spill.atTime}/${e.spill.series} |`); });
L.push("", "## Sites at five sensors", "");
res.forEach(m => L.push(`- **${m.label}**: ${m.sites[4].join(", ")}` + (m.id !== "ninh" ? ` (${out.overlap5[m.id]} shared with the Ninh greedy set)` : "")));
fs.mkdirSync(path.join(ROOT, "docs"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "docs/ninh_compare.md"), L.join("\n") + "\n");
console.log(L.join("\n"));
