// Check simulation35/room_calc.js against the published Sim 3.5 figures (sim35_capacity.py).
//   node tools/check_room_calc.js
// 1. With no starting-level error, the homes to the first pipe at each limit must equal
//    results/sim35/capacity.json's first_pipe exactly (same runs, same arithmetic).
// 2. With the error draws, at the published settings (high case, counted from 2021, the runs'
//    load per home), the bands and ranges should agree with simulation35/data/sim35.js up to
//    sampling noise: the script and the page draw different random numbers.
// With --sim4 the same checks run on Sim 4's equal-home regions, against results/sim4/capacity.json and the
// explorer's data (simulation4/data/explore.js), which loads room_calc.js too.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const ctx = { window: {} };
vm.createContext(ctx);
const SIM4 = process.argv.includes("--sim4");
for (const f of ["simulation3/data/catchment.js", "simulation3/data/growth.js", SIM4 ? "simulation4/data/regions.js" : "simulation3/data/regions.js",
                 SIM4 ? "simulation4/data/explore.js" : "simulation35/data/sim35.js", "simulation35/data/room.js", "simulation35/room_calc.js"])
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
const W = ctx.window, C = W.ROOM_CALC, reg = W.SIM3_REGIONS;
const pub = JSON.parse(fs.readFileSync(path.join(ROOT, `simulation_src/results/${SIM4 ? "sim4" : "sim35"}/capacity.json`), "utf8"));
const PUBCAP = () => (SIM4 ? W.SIM4_EXPLORE : W.SIM35).capacity;
const tags = reg.cases.map(c => c.tag), ids = reg.regions.map(r => r.id);

let bad = 0, n = 0;
for (const t of tags) for (const id of ids) for (const L of ["0.5", "0.6", "0.7", "1.0"]) {
  const want = pub.first_pipe[t][id][L], got = C.firstPipe(t, id, +L);
  const same = (want.homes === null ? got.homes === null : got.homes !== null && Math.abs(got.homes - want.homes) < 0.06)
    && got.first === want.first && got.already_over === want.already_over && got.with_buffer === want.with_buffer;
  n++;
  if (!same) { bad++; if (bad <= 5) console.log("first pipe differs", t, id, L, want, got); }
}
for (const t of tags) for (const L of ["0.5", "0.6", "0.7", "1.0"]) {
  const want = pub.whole_suburb[t][L], got = C.firstPipe(t, "suburb", +L);
  const same = (want.homes === null ? got.homes === null : got.homes !== null && Math.abs(got.homes - want.homes) < 0.06)
    && got.first === want.first && got.already_over === want.already_over && got.with_buffer === want.with_buffer;
  n++;
  if (!same) { bad++; if (bad <= 5) console.log("first pipe differs", t, "suburb", L, want, got); }
}
console.log(`1. First pipe, no error (${ids.length} regions and the whole suburb): ${n - bad} of ${n} match exactly.`);

const o = Object.assign(C.defaults(), { from: 2021, projection: "high" });
let agree = 0, total = 0, pd = [], rd = [];
const lines = [];
for (const t of tags) for (const id of ids) for (const L of pub.limits) {
  const want = PUBCAP().areas[t][id][String(L)], got = C.row(id, Object.assign({}, o, { tag: t, limit: L }));
  total++;
  if (got.band === want.band) agree++;
  else lines.push(`   ${t} ${id} ${L}: published ${want.band} (p ${want.p_runs_out}), here ${got.band} (p ${got.p_runs_out.toFixed(3)})`);
  pd.push(Math.abs(got.p_runs_out - want.p_runs_out));
  for (const [a, b] of [[got.homes_p10, want.homes_p10], [got.homes_p90, want.homes_p90]])
    if (a !== null && b !== null && b > 0) rd.push(Math.abs(a - b) / b);
}
const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`2. Bands at 0.5/0.6/0.7 (published settings): ${agree} of ${total} agree; probability of running out differs by a median ${med(pd).toFixed(3)}, at most ${Math.max(...pd).toFixed(3)}; 10th/90th percentile homes by a median ${(100 * med(rd)).toFixed(1)}%.`);
lines.forEach(l => console.log(l));
// Whole suburb: the script compares with 485 homes (Sim 3-e's runs); the page uses the modelled area's share,
// so only the homes range is comparable.
const sd = [];
for (const t of tags) for (const L of pub.limits) {
  const want = pub.whole_suburb_bands[t][String(L)], got = C.row("suburb", Object.assign({}, o, { tag: t, limit: L }));
  for (const [a, b] of [[got.homes_p10, want.homes_p10], [got.homes_p90, want.homes_p90]])
    if (a !== null && b !== null && b > 0) sd.push(Math.abs(a - b) / b);
}
console.log(`   Whole suburb, 10th/90th percentile homes: median difference ${(100 * med(sd)).toFixed(1)}% over ${sd.length} figures.`);
const rise = tags.flatMap(t => ids.map(id => Math.abs(C.row(id, Object.assign({}, o, { tag: t, limit: 0.7 })).rise_mm_per_100_homes - PUBCAP().areas[t][id].rise_mm_per_100_homes)));
console.log(`3. Rise per 100 homes: largest difference ${Math.max(...rise).toFixed(2)} mm (published values are rounded to 0.1).`);
process.exit(bad ? 1 : 0);
