// Builds the Sim 3 coverage-map data (greenfield family: a new estate joining at one manhole)
// from the published simulation3/data files, and checks the greedy order against Sim 3's own.
// Usage: node tools/build_coverage_web.js simulation3/data coverage/data.js
const path = require("path");
const dir = path.resolve(process.argv[2]);
global.window = {};
require(path.join(dir, "catchment.js")); require(path.join(dir, "growth.js"));
const C = window.GROWTH_GEOM, G = window.GROWTH_RUNS;
const n = G.chambers.length, cases = G.cases.length, rules = ["r10", "r25", "r50", "alarm"];

// seen[rule][case][level][site] = chamber indices that see that run
const seen = {};
for (const r of rules) seen[r] = G.cases.map((_, ci) => G.growthLevels.map((lv) => {
  const cell = G.cells.find((c) => c.rule === r && c.case === ci && c.add === lv);
  const row = new Array(n).fill(null);
  cell.rows.forEach((x) => { row[x.site] = x.tip; });
  return row;
}));

// Same greedy as Sim 3 / export_scenario.greedy: maximise the worst case's share, ties by mean,
// then lowest index (strict >). Pools = every run some chamber sees, all five sizes, per case.
function greedy(rule) {
  const pools = seen[rule].map((lv) => lv.flat().filter((t) => t && t.length));
  const cov = pools.map((p) => new Uint8Array(p.length)), cnt = pools.map(() => 0);
  const order = [], worst = [], mean = [];
  while (order.length < n) {
    const hits = pools.map((p, c) => { const h = new Int32Array(n); p.forEach((t, s) => { if (!cov[c][s]) t.forEach((m) => h[m]++); }); return h; });
    let best = -1, bk = null;
    for (let m = 0; m < n; m++) {
      if (order.includes(m)) continue;
      const f = pools.map((p, c) => (cnt[c] + hits[c][m]) / p.length);
      const key = [Math.min(...f), f.reduce((a, b) => a + b, 0) / f.length];
      if (!bk || key[0] > bk[0] + 1e-12 || (Math.abs(key[0] - bk[0]) <= 1e-12 && key[1] > bk[1] + 1e-12)) { best = m; bk = key; }
    }
    order.push(best);
    pools.forEach((p, c) => p.forEach((t, s) => { if (!cov[c][s] && t.includes(best)) { cov[c][s] = 1; cnt[c]++; } }));
    const f = pools.map((p, c) => cnt[c] / p.length);
    worst.push(+Math.min(...f).toFixed(4)); mean.push(+(f.reduce((a, b) => a + b, 0) / f.length).toFixed(4));
    if (Math.min(...f) >= 1) break;
  }
  return { order, worst, mean, pools: pools.map((p) => p.length) };
}

const plans = {};
for (const r of rules) {
  const g = greedy(r), pub = G.sensors[r].worst;
  const same = pub.order.every((m, i) => m === g.order[i]);
  const dw = Math.max(...pub.worst.map((v, i) => Math.abs(v - g.worst[i])));
  console.log(r, "to 100%:", g.order.length, "| matches Sim 3 first 10:", same, "max worst diff", dw.toFixed(4), "| pools", g.pools.join("/"));
  plans[r] = g;
}

// geometry: decimetres from (ox, oy); chambers by manhole id
const byMh = new Map(C.nodes.filter((d) => d.mh != null).map((d) => [String(d.mh), d]));
const chambers = G.manholeIds.map((id) => { const d = byMh.get(String(id)); return d ? { id, x: d.x / 10, y: d.y / 10 } : { id, x: null, y: null }; });
console.log("chambers without position:", chambers.filter((c) => c.x == null).length);
const pipes = [];
for (let i = 0; i < C.nPipes; i++) {
  const p = [];
  for (let j = C.ptr[i]; j < C.ptr[i + 1]; j++) p.push(C.px[j] / 10, C.py[j] / 10);
  pipes.push({ p, d: C.dia[i] });
}
const out = { sim: 3, family: "greenfield", rules: G.rules.map((r) => ({ id: r.id, label: r.label })),
  cases: G.cases.map((c) => ({ label: c.label, settled: c.settled !== false })), sizes: G.growthLevels,
  chambers, pipes, seen, plans: Object.fromEntries(rules.map((r) => [r, { order: plans[r].order, worst: plans[r].worst, mean: plans[r].mean }])) };
require("fs").writeFileSync(process.argv[3], "window.COV=" + JSON.stringify(out) + ";");
