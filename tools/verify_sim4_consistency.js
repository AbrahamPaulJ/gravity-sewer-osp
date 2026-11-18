/* verify_sim4_consistency.js - Sim 4's story and its explorer must say the same thing.

   Opens simulation4/explore.html headless and checks that, at its defaults (the story's test, the story's list), the
   Results tabs and the side panel give the story's own figures, read from the files the story is built from:
   simulation_src/results/sim4/numbers.json, float.json, capacity.json and simulation4/data/sim4.js.

     Warning          overloads warned = the ladder's warned_target, of the story's total; held out = held_out weather_runs
     Room for homes   each region's band and 10th to 90th range = numbers.json triage (step 4), at the published settings
     Level or float   every budget row = float.json (step 6)
     Fewest sensors   every cell = numbers.json fewest (step 5a), exact and on the list
     Sensors panel    worst / average = the ladder; leave one case out = held_out_by_case; greenfield = step 5b's sentence
     Findings         no old Sim 3 report; comparison sets are numbered C1, C2, ...; the map card's homes = regions.js

     node tools/verify_sim4_consistency.js
*/
"use strict";
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const PUB = path.dirname(__dirname), RES = path.join(PUB, "simulation_src/results/sim4");
const HTTP = 8774, DBG = 9374;
const X = JSON.parse(fs.readFileSync(path.join(RES, "numbers.json"), "utf8"));
const FL = JSON.parse(fs.readFileSync(path.join(RES, "float.json"), "utf8"));
global.window = global; eval(fs.readFileSync(path.join(PUB, "simulation4/data/sim4.js"), "utf8")); eval(fs.readFileSync(path.join(PUB, "simulation4/data/regions.js"), "utf8"));
const D = window.SIM4, REG = window.SIM3_REGIONS;
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find(fs.existsSync);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, note) => { if (c) pass++; else fail++; console.log(`  ${c ? "ok  " : "FAIL"}  ${n}${note != null ? "   [" + String(note).slice(0, 200) + "]" : ""}`); };
// Python's "{:.0%}" rounds a half to even, and the story is written with it; the explorer uses Math.round. Accept either.
const pcs = v => { const x = v * 100, f = Math.floor(x); return new Set([Math.round(x) + "%", (Math.abs(x - f - 0.5) < 1e-9 ? (f % 2 ? f + 1 : f) : Math.round(x)) + "%"]); };
const hasPc = (text, v) => [...pcs(v)].some(p => text.includes(p));

const server = http.createServer((q, s) => {
  let u = decodeURIComponent(q.url.split("?")[0]);
  if (u.endsWith("/")) u += "index.html";
  const f = path.join(PUB, u);
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(f).pipe(s);
});

(async () => {
  await new Promise(r => server.listen(HTTP, "127.0.0.1", r));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sim4-consistency-"));
  const chrome = spawn(CHROME, [`--remote-debugging-port=${DBG}`, "--headless=new", `--user-data-dir=${profile}`, "--window-size=1500,950", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 60 && !target; i++) { await wait(250); try { target = (await (await fetch(`http://127.0.0.1:${DBG}/json`)).json()).find(t => t.type === "page"); } catch (e) {} }
  const ws = new WebSocket(target.webSocketDebuggerUrl); let id = 0; const pend = new Map(), errors = [];
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  const ev = async x => { const r = await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || x); return r.result?.result?.value; };
  const load = async () => {
    await send("Page.navigate", { url: "about:blank" }); await wait(150);
    await send("Page.navigate", { url: `http://127.0.0.1:${HTTP}/simulation4/explore.html` });
    for (let i = 0; i < 240; i++) { await wait(250); if (await ev('!!(window.SIM4_GF_RUNS && document.querySelector("#sensorList") && document.querySelector("#sensorList").innerText.length > 50)')) break; }
    await wait(1500);
  };
  const click = async sel => { const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.click(); return true})()`); await wait(900); return r; };
  const modal = () => ev('document.getElementById("modalBox").innerText');
  const tab = async t => { await click(`#modalBox .restabs button[data-tab="${t}"]`); await wait(1200); return modal(); };
  const rows = sel => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(tr=>[...tr.children].map(c=>c.innerText.trim()))`);

  const rec = X.recommend, L = Object.fromEntries(X.ladder.map(r => [r.k, r])), wt = X.warn_universe.target;
  await load();

  // ---- the side panel, default
  await click('#viewKnob button[data-v="expert"]'); await wait(1500);
  const side = await ev('document.getElementById("sensorList").innerText');
  ok("side panel: the story's list at its recommended count, worst and average", hasPc(side, L[rec].worst) && hasPc(side, L[rec].average), side.split("\n")[0]);
  ok("side panel: overloads warned as the story", side.includes(`${L[rec].warned_target} of ${wt}`));
  const hoc = X.held_out_by_case;
  const loo = await rows("#sensorList table.sm tr");
  const looOk = Object.entries(hoc).every(([c, v]) => loo.some(r => r[0] === c && pcs(v[String(rec)]).has(r[1])));
  ok("leave one case out = the story's held-out score per case", looOk && side.includes("the story's test"), JSON.stringify(loo).slice(0, 160));
  const h5 = X.held_out.find(h => h.k === rec);
  ok("leave one case out: the pooled figure is the story's unseen weather", hasPc(side.slice(side.toLowerCase().indexOf("leave one case out")).split("All held-out runs together")[1] || "", h5.weather_runs[0] / h5.weather_runs[1]));

  // ---- Results: Warning
  await click("#btn-results"); await wait(1500);
  let t = await tab("warn");
  ok("Warning: opens on the story's test", t.includes("The story's test") && /story's test/.test(t));
  ok("Warning: overloads warned = the story's", t.includes(`${L[rec].warned_target} of ${wt}`), (t.match(/\d+ of \d+\s*\n?overloads/) || [""])[0]);
  ok("Warning: held out = the story's unseen weather", t.includes(`${h5.weather_runs[0]} of ${h5.weather_runs[1]}`));
  const warnRegs = (await rows("#modalBox table.ladder tbody tr")).map(r => r[0]);
  ok("Warning: only the regions to monitor or watch", JSON.stringify(warnRegs) === JSON.stringify(X.targets), warnRegs.join(","));
  const warnCols = (await rows("#modalBox table.ladder thead tr"))[0].slice(1, -1);
  ok("Warning: build-out up to 100% only", warnCols.length && warnCols[warnCols.length - 1] === "100%", warnCols.join(","));

  // ---- Results: Room for homes
  t = await tab("room");
  const room = await rows("#modalBox table.rtab tbody tr");
  const label = { "runs out": "Likely to reach the limit", "uncertain": "Could go either way", "room left": "Room left", "already over": "Already past the limit" };
  const roomOk = Object.entries(X.triage).map(([r, v]) => {
    const row = room.find(x => x[0] === r);
    const want = v.homes_p10 == null ? null : v.homes_p10 + " to " + (v.homes_p90 == null ? "" : v.homes_p90);
    const good = row && row[1].includes(label[v.band]) && (want == null || row[2].startsWith(v.homes_p90 == null ? String(v.homes_p10) : want));
    return [r, good, row ? row[1] + " | " + row[2] : "missing"];
  });
  ok("Room: every region's band = step 4", roomOk.every(x => x[1]), roomOk.filter(x => !x[1]).map(x => x.join(" ")).join("; "));
  const mon = Object.entries(X.triage).filter(([, v]) => v.action === "monitor").map(([r]) => r);
  ok("Room: the regions likely to reach the limit are the story's monitor regions", mon.every(r => (room.find(x => x[0] === r) || [, ""])[1].includes(label["runs out"])), mon.join(","));
  ok("Room: opens at the published settings, counted from 2021", /counted from 2021/.test(t) && /class='on'|Published settings, as the story/.test(t));

  // ---- Results: Level or float
  t = await tab("float");
  const fr = await rows("#modalBox table.rtab tbody tr");
  const usd = v => "$" + v.toLocaleString("en-AU");
  const un = x => x.unseen_weather[0] / x.unseen_weather[1];
  const floatOk = FL.budgets.map(b => {
    const r = fr.find(x => x[0] === usd(b.budget));
    const wa = (x, s) => [...pcs(x.worst)].some(a => [...pcs(x.average)].some(c => s === a + " / " + c));
    const good = r && wa(b.level, r[1]) && pcs(un(b.level)).has(r[2]) && wa(b.float, r[4]) && pcs(un(b.float)).has(r[5]) && wa(b.mix, r[7]) && pcs(un(b.mix)).has(r[8]);
    return [b.budget, good, r ? r.join("|") : "missing"];
  });
  ok("Level or float: every budget row = step 6 (float.json)", floatOk.every(x => x[1]), floatOk.filter(x => !x[1]).map(x => x.join(" ")).join("; "));
  ok("Level or float: opens on the story's test", t.includes("The story's test"));

  // ---- Results: Fewest sensors
  t = await tab("min");
  const mr = await rows("#modalBox table.rtab tbody tr");
  const fewOk = X.fewest.map(f => {
    const r = mr.find(x => x[0] === f.scope);
    const good = r && ["0.8", "0.9", "1.0"].every((m, j) => f[m] == null ? r[j + 1] === "not reachable" : r[j + 1].startsWith(String(f[m]) + " ") &&
      r[j + 1].includes(f["ladder_" + m] == null ? "more than" : "list: " + f["ladder_" + m]));
    return [f.scope, good, r ? r.join("|") : "missing"];
  });
  ok("Fewest sensors: every cell = step 5a (numbers.json), exact and on the list", fewOk.every(x => x[1]), fewOk.filter(x => !x[1]).map(x => x.join(" ")).join("; "));

  // ---- Findings
  t = await tab("findings");
  ok("Findings: no old Sim 3 report on the hand-picked regions", !/Sim 3 first results|11\.1 The headline|blind spots for level sensing/.test(t));
  ok("Findings: the broader-test sections say so", /Sections 1 and 3 below are worked out on the broader test/.test(t));
  await click("#modalClose");

  // ---- the broader test is still there, labelled
  await click('#scopeKnob button[data-s="broad"]'); await wait(1500);
  await click("#btn-results"); await wait(1200);
  t = await tab("float");
  ok("Level or float: the broader test still offers Sim 3.5's tables, labelled", t.includes("Broader test") && /broader test, wider than the story/i.test(t) && /25 floats/.test(t));
  await click("#modalClose");
  await click('#scopeKnob button[data-s="story"]'); await wait(1500);

  // ---- comparison sets are C1, C2, ...; the story's are S1, S2, ...
  await click('#methKnob button[data-m="exact"]'); await wait(2500);
  let pins = await ev('[...document.querySelectorAll(".labels .lbl.sensor")].map(e=>e.textContent)');
  const cards = await ev('[...document.querySelectorAll("#sensorList .pin")].map(e=>e.textContent)');
  ok("Exact optimum: pins and cards are C1, C2, ...", pins.length && pins.every(p => /^C\d$/.test(p)) && cards.every(p => /^C\d$/.test(p)), pins.join(",") + " / " + cards.join(","));
  await click('#methKnob button[data-m="story"]'); await wait(2500);
  pins = await ev('[...document.querySelectorAll(".labels .lbl.sensor")].map(e=>e.textContent)');
  ok("Sim 4's list: pins are S1, S2, ...", pins.length && pins.every(p => /^S\d$/.test(p)), pins.join(","));

  // ---- greedy: the running worst case on a card equals the panel's figure at that count
  await click('#methKnob button[data-m="greedy"]'); await wait(2500);
  const g = await ev('[...document.querySelectorAll("#sensorList .why .cov")].map(e=>e.textContent)');
  const glead = await ev('document.getElementById("sensorList").innerText.split("\\n")[0]');
  ok("Greedy: the last card's running worst case = the panel's worst case", g.length && glead.includes(g[g.length - 1].replace("worst ", "")), g.join(",") + " / " + glead);
  await click('#methKnob button[data-m="story"]'); await wait(1500);

  // ---- the map card's homes = the model's count
  const card = await ev('document.getElementById("homesLine").innerText');
  const r0 = REG.regions[0];
  ok("map card: the region's homes = regions.js (as the side panel and the story)", card.includes(r0.dwellings + " homes in the region") || card.includes(r0.dwellings + "\nhomes in the region"), card.slice(0, 80));

  // ---- greenfield: the story's list scored on the wet cases, as step 5b says
  await click('#famKnob button[data-f="one"]'); await wait(3500);
  const gs = await ev('document.getElementById("sensorList").innerText');
  const s5b = D.steps.find(s => s.id === "5b").notes.limit;
  const m = s5b.match(/see (\d+%) of growth runs on average and (\d+%) in the worst wet case \(Explore, Greenfield\)/);
  ok("greenfield: Explore's figures = step 5b's sentence", m && new RegExp("catch " + m[2] + " of detectable greenfield growth in the worst case and " + m[1] + " on average").test(gs), (m ? m.slice(1).join(" / ") : "no sentence") + " vs " + gs.split("\n").find(l => /greenfield growth in the worst/.test(l)));
  ok("greenfield: scored on the wet cases", /scored on the 7 wet cases/i.test(await ev('document.getElementById("sensHead").innerText')));

  ok("no page errors", errors.length === 0, errors.join(" | "));
  console.log(`\n${pass} passed, ${fail} failed`);
  chrome.kill(); server.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
