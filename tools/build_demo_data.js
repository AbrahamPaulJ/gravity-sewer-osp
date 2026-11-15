// Builds demo/data/compare.js: sensor sites from several placement methods (1 to 8 sensors), and the figures that are
// too slow to compute in the browser (each weather case scored with sensors chosen without it; random draws).
// It reuses the demo's own scoring engine (demo/app.js), so the page and this file cannot drift apart.
//   node tools/build_demo_data.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
global.window = global;
global.document = { querySelector: () => null, querySelectorAll: () => [] };
global.DOMParser = class { parseFromString() { return { querySelectorAll: () => [] }; } };
["simulation3/data/catchment.js", "simulation3/data/growth.js", "simulation4/data/regions.js", "simulation4/data/sim4.js"]
  .forEach(f => vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), "utf8"), { filename: f }));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, "demo/app.js"), "utf8") + "\n;globalThis.App = App;", { filename: "demo/app.js" });
const A = global.App, K = 8;
A.prepare();
const o = A.SIM4_TEST(), R = GROWTH_RUNS, D = SIM4;
const idxOf = n => R.chambers.indexOf(n);

// Published by Sim 4
const sim4 = D.explore.ladder.slice(0, K).map(s => s.map(idxOf));
const exact = D.explore.exact.slice(0, K).map(s => s.map(idxOf));
// Greedy, from empty, two aims
const gAvg = A.greedy({ ...o, aim: "avg" }, K).set, gWorst = A.greedy({ ...o, aim: "worst" }, K).set;
// Hydraulic screens: no model runs, only the network (Manning capacity and homes upstream), within the target regions
const pool = A.targetPool();
const hyd = A.screenRank("util", pool), homes = A.screenRank("homes", pool);
const prefix = s => Array.from({ length: K }, (_, k) => s.slice(0, k + 1));

// Exact best set for the worst case (then the average, then overloads warned), as Sim 4's exact solver. The score only
// grows as more runs are covered, so a manhole whose covered runs are a subset of another's can be dropped; the
// survivors (about 20) are searched exhaustively.
function candidates(o) {
  const X = SIM3_REGIONS, steps = X.ladder.map((v, s) => s).filter(s => X.ladder[s] <= 1), els = [];
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
function exactSet(o, k) {
  const cand = candidates(o), n = cand.length, key = sc => sc.worst * 1e6 + sc.avg * 1e3 + sc.warned;
  let best = null, bk = -1;
  (function rec(start, set) {
    if (set.length === k) { const v = key(A.score(set, o)); if (v > bk + 1e-9) { bk = v; best = set.slice(); } return; }
    for (let a = start; a <= n - (k - set.length); a++) { set.push(cand[a]); rec(a + 1, set); set.pop(); }
  })(0, []);
  return best;
}
// Check against Sim 4's published exact sets: same scores at every count.
exact.forEach((s, k) => {
  const mine = A.score(exactSet(o, k + 1), o), theirs = A.score(s, o);
  if (Math.abs(mine.worst - theirs.worst) > 1e-9 || Math.abs(mine.avg - theirs.avg) > 1e-9 || mine.warned !== theirs.warned) throw new Error(`exact search disagrees with Sim 4 at k=${k + 1}`);
});
const exactUnseen = Array.from({ length: K }, (_, k) => {
  const v = o.cases.map(tag => { const set = exactSet({ ...o, cases: o.cases.filter(t => t !== tag) }, k + 1), sc = A.score(set, { ...o, cases: [tag] }).per[0]; return sc.n ? sc.share : null; }).filter(x => x != null);
  return v.reduce((t, x) => t + x, 0) / v.length;
});

// Each weather case scored with sensors chosen without it (prefixes of one greedy run per left-out case)
function unseen(aim) {
  const per = o.cases.map(tag => {
    const set = A.greedy({ ...o, cases: o.cases.filter(t => t !== tag), aim }, K).set;
    return prefix(set).map(s => { const sc = A.score(s, { ...o, cases: [tag] }).per[0]; return sc.n ? sc.share : null; });
  });
  return Array.from({ length: K }, (_, k) => { const v = per.map(p => p[k]).filter(x => x != null); return v.reduce((t, x) => t + x, 0) / v.length; });
}
// Random sites in the target regions: 500 draws per count
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const random = Array.from({ length: K }, (_, k) => {
  const draws = [];
  for (let d = 0; d < 500; d++) { const p = pool.slice(); for (let j = p.length - 1; j > 0; j--) { const r = Math.floor(rnd() * (j + 1)); [p[j], p[r]] = [p[r], p[j]]; } draws.push(A.score(p.slice(0, k + 1), o)); }
  const q = (a, f) => a.slice().sort((x, y) => x - y)[Math.floor(f * (a.length - 1))];
  const av = draws.map(x => x.avg), wo = draws.map(x => x.worst), wa = draws.map(x => x.warned);
  return { avg: av.reduce((t, x) => t + x, 0) / av.length, avgLo: q(av, 0.1), avgHi: q(av, 0.9), worst: wo.reduce((t, x) => t + x, 0) / wo.length, warned: wa.reduce((t, x) => t + x, 0) / wa.length };
});
const out = {
  built: new Date().toISOString().slice(0, 10), K,
  methods: {
    sim4: { sets: sim4 }, exact: { sets: exact, unseen: exactUnseen },
    greedyWorst: { sets: prefix(gWorst), unseen: unseen("worst") }, greedyAvg: { sets: prefix(gAvg), unseen: unseen("avg") },
    hydraulic: { sets: prefix(hyd) }, homes: { sets: prefix(homes) },
  },
  random,
};
const file = path.join(ROOT, "demo/data/compare.js");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, "// Built by tools/build_demo_data.js from Sim 4's data. Manhole numbers index GROWTH_RUNS.chambers.\nwindow.DEMO_COMPARE = " + JSON.stringify(out) + ";\n");
for (const [m, v] of Object.entries(out.methods)) {
  const s = v.sets[4], sc = A.score(s, o);
  console.log(m.padEnd(12), "5 sensors: avg", Math.round(sc.avg * 100), "worst", Math.round(sc.worst * 100), "warned", sc.warned + "/" + sc.warnable, v.unseen ? "unseen " + Math.round(v.unseen[4] * 100) : "");
}
console.log("random      ", "5 sensors: avg", Math.round(random[4].avg * 100), "worst", Math.round(random[4].worst * 100), "warned", random[4].warned.toFixed(1));
console.log("wrote", path.relative(ROOT, file));
