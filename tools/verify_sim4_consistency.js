/* verify_sim4_consistency.js - Sim 4's story and its explorer must say the same thing.

   Opens simulation4/explore.html headless and checks that, at its defaults (the story's test, the story's list), the
   Results tabs and the side panel give the story's own figures, read from the files the story is built from:
   simulation_src/results/sim4/numbers.json, float.json, capacity.json and simulation4/data/sim4.js.

     Warning          overloads warned = the ladder's warned_target, of the story's total; held out = held_out_by_case averaged
     Unseen weather   one measure everywhere (19 Nov): each wet case scored by sensors chosen without it, averaged over the cases
     Source links     the citations in Explore's texts link to the team's paper library (library.js); tooltips do not
     More folds       the story's "More on this step" figures against numbers.json and a recount from the runs
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
  const uavg = k => Object.values(hoc).reduce((a, v) => a + v[String(k)], 0) / Object.keys(hoc).length;
  ok("leave one case out: the average of the cases is the story's unseen weather", hasPc(side.slice(side.toLowerCase().indexOf("leave one case out")).split("Average of the cases")[1] || "", uavg(rec)));
  ok("unseen weather: the story's 5b sentence, its comparison table and Explore all give the average of the cases", hasPc(D.steps.find(s => s.id === "5b").body, uavg(rec)) &&
     hasPc(D.steps.find(s => s.id === "5b").notes.more.blocks[1].html, uavg(rec)) && !hasPc(D.steps.find(s => s.id === "5b").body, h5.weather_runs[0] / h5.weather_runs[1]));

  // ---- Results: Warning
  await click("#btn-results"); await wait(1500);
  let t = await tab("warn");
  ok("Warning: opens on the story's test", t.includes("The story's test") && /story's test/.test(t));
  ok("Warning: overloads warned = the story's", t.includes(`${L[rec].warned_target} of ${wt}`), (t.match(/\d+ of \d+\s*\n?overloads/) || [""])[0]);
  ok("Warning: held out = the story's unseen weather, average of the cases", hasPc(t.split("average of the cases")[0].slice(-12), uavg(rec)), (t.match(/\d+%, average of the cases/) || [""])[0]);
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
  const un = x => Object.values(x.unseen_by_case).reduce((a, v) => a + v, 0) / Object.keys(x.unseen_by_case).length;
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
  ok("Nested beam search: pins are S1, S2, ...", pins.length && pins.every(p => /^S\d$/.test(p)), pins.join(","));

  // ---- greedy: the running worst case on a card equals the panel's figure at that count
  await click('#methKnob button[data-m="greedy"]'); await wait(2500);
  const g = await ev('[...document.querySelectorAll("#sensorList .why .cov")].map(e=>e.textContent)');
  const glead = await ev('document.getElementById("sensorList").innerText.split("\\n")[0]');
  ok("Greedy: the last card's running worst case = the panel's worst case", g.length && glead.includes(g[g.length - 1].replace("worst ", "")), g.join(",") + " / " + glead);
  await click('#methKnob button[data-m="story"]'); await wait(1500);

  // ---- 19 Nov: the recommendation is named for its algorithm, and explained where it is chosen
  const btnName = await ev('document.querySelector(\'#methKnob button[data-m="story"]\').textContent');
  const say = await ev('document.getElementById("methSay").innerText');
  const src = fs.readFileSync(path.join(PUB, "simulation_src/sim4_numbers.py"), "utf8");
  const width = (src.match(/^WIDTH = (\d+)/m) || [])[1];
  ok("method: the recommendation is called Nested beam search, nowhere Sim 4's list", btnName === "Nested beam search" &&
     !/Sim 4's list/.test(fs.readFileSync(path.join(PUB, "simulation4/explore.html"), "utf8")) && !/"Sim 4's list|Sim 4's list[:,]/.test(fs.readFileSync(path.join(PUB, "simulation4/explore_ui.js"), "utf8")), btnName);
  ok("method: the line under it explains it (seed, beam width from sim4_numbers.py, score, nested, brute force)",
     say.includes(L[1].chosen[0]) && width && say.includes(Number(width).toLocaleString("en-AU")) && /worst case plus the average/.test(say) && /25 mm rule breaks ties/.test(say) && /no sensor moves/.test(say) && /brute force/.test(say), say.slice(0, 200));

  // ---- the chart: one line per method, the selected one bold with its average dashed, pulsing when the method changes
  const chart = () => ev(`(()=>{const c=document.getElementById("curve");return{sel:(c.querySelector(".cv-sel")||{}).dataset?.m||null,avg:!!c.querySelector(".cv-sel .cv-avg"),
    dash:(c.querySelector(".cv-sel .cv-avg")||{getAttribute:()=>null}).getAttribute("stroke-dasharray"),same:(()=>{const a=c.querySelector(".cv-sel .cv-avg"),w=c.querySelector(".cv-sel .cv-worst");return!!a&&!!w&&a.getAttribute("stroke")===w.getAttribute("stroke")})(),
    others:[...c.querySelectorAll(".cv-other")].map(g=>g.dataset.m).sort().join(),otherAvg:c.querySelectorAll(".cv-other .cv-avg").length,pulse:!!c.querySelector(".cv-sel.pulse"),
    fade:+getComputedStyle(c.querySelector(".cv-other")||c).opacity,legend:(c.querySelector(".lg span.on")||{}).textContent||""}})()`);
  let ch = await chart();
  ok("chart: the nested beam search is drawn bold, its average dashed in the same colour", ch.sel === "story" && ch.avg && ch.dash && ch.same && ch.legend === "Nested beam search", JSON.stringify(ch));
  ok("chart: every other method drawn faded, with Worst case and Average both on its average dashed too", /exact/.test(ch.others) && /greedy-avg/.test(ch.others) && /warn/.test(ch.others) && ch.otherAvg >= 3 && ch.fade < 0.6, JSON.stringify(ch));
  const pulses = [];
  for (const m of ["exact", "greedy", "warn", "story"]) {
    await click(`#methKnob button[data-m="${m}"]`); await wait(1200);
    ch = await chart();
    pulses.push(ch.sel === m && ch.avg && ch.pulse && !ch.others.split(",").includes(m));
  }
  ok("chart: each method selected in turn is the bold one, with its average, and pulses as it changes", pulses.every(Boolean), pulses.join());
  await click('#scopeKnob button[data-s="broad"]'); await wait(1500);
  ch = await chart();
  ok("chart: on the broader test too, the selected method shows its average", ch.sel === "story" && ch.avg, JSON.stringify(ch));
  ok("chart: changing the test is not a method change, so no pulse", !ch.pulse);
  ok("chart: the pulse respects reduced motion", /prefers-reduced-motion:reduce\)\{#curve \.cv-sel\.pulse\{animation:none\}/.test(fs.readFileSync(path.join(PUB, "simulation4/explore.html"), "utf8")));

  // ---- the region panel: on the story's test, what lies outside it is greyed
  const seenRows = () => ev(`[...document.querySelector("#mhFacts table.sm").querySelectorAll("tr")].slice(1).map(r=>({c:r.children[0].innerText,v:r.children[1].innerText,out:r.classList.contains("outside")}))`);
  let sr = await seenRows();
  ok("region panel, broader test: every case as it was, nothing greyed", sr.length === REG.cases.length && sr.every(r => !r.out) && !(await ev('!!document.getElementById("seenScope")')), JSON.stringify(sr).slice(0, 200));
  await click('#scopeKnob button[data-s="story"]'); await wait(1500);
  sr = await seenRows();
  const dry = sr.find(r => /^Dry/.test(r.c));
  ok("region panel, story's test: Dry is greyed and marked outside the test", dry && dry.out && /not in the story's test/.test(dry.c), JSON.stringify(dry));
  ok("region panel, story's test: nothing past 100% shows as a build-out; it reads 'not seen by 100%', greyed", sr.every(r => r.out || (!/^(150|300)%$/.test(r.v))) && sr.filter(r => /not seen by 100%/.test(r.v)).every(r => r.out), JSON.stringify(sr).slice(0, 300));
  ok("region panel, story's test: a quiet note says what the test is", /wet cases up to 100% build-out/.test(await ev('(document.getElementById("seenScope")||{}).innerText||""')));

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

  // ---- 19 Nov: the story's "More on this step" figures, recounted here from the runs (regions.js), not from the builder
  {
    const G = (() => { global.window = global; eval(fs.readFileSync(path.join(PUB, "simulation3/data/growth.js"), "utf8")); return window.GROWTH_RUNS; })();
    const idx = Object.fromEntries(G.chambers.map((n, i) => [n, i]));
    const wet = REG.cases.filter(c => c.ii > 0), steps = REG.ladder.map((v, s) => [v, s]).filter(([v]) => v <= 1 + 1e-9).map(([, s]) => s);
    const tg = REG.regions.map((r, i) => [r.id, i]).filter(([id]) => X.targets.includes(id)).map(([, i]) => i);
    // Per case: the runs that count (some manhole rises 10 mm or more), and which of them each manhole sees.
    const sees = wet.map(c => {
      const rows = new Map(REG.rows[c.tag].map(x => [x.r + ":" + x.s, x])), runs = [];
      for (const ri of tg) for (const s of steps) { const x = rows.get(ri + ":" + s); if (x.rise.some(([, v]) => v >= 10)) runs.push(new Set(x.rise.filter(([, v]) => v >= 10).map(([j]) => j))); }
      return runs;
    });
    const score = S => { const per = sees.map(runs => runs.filter(r => S.some(m => r.has(idx[m]))).length / runs.length); return { per, worst: Math.min(...per), average: per.reduce((a, b) => a + b, 0) / per.length }; };
    ok("recount: each wet case's runs = numbers.json's universe", wet.every((c, k) => sees[k].length === X.universe[c.label]), wet.map((c, k) => sees[k].length).join(","));
    const more5 = D.steps.find(s => s.id === "5b").notes.more.blocks;
    const cells = h => [...h.matchAll(/<tr>(.*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<td>(.*?)<\/td>/g)].map(x => x[1].replace(/<[^>]+>/g, ""))).filter(r => r.length);
    const alone = cells(more5[0].html), five = L[rec].chosen;
    ok("5b fold: each sensor alone, case by case, = a recount from the runs", five.every((m, k) => { const s = score([m]); return alone[k] && alone[k][0].endsWith(m) && s.per.every((v, j) => pcs(v).has(alone[k][j + 1])); }),
       JSON.stringify(alone[0]));
    const cmp = cells(more5[1].html);
    const rowOk = (name, set) => { const r = cmp.find(x => x[0].startsWith(name)), s = score(set); return r && pcs(s.worst).has(r[1]) && pcs(s.average).has(r[2]); };
    ok("5b fold: the nested and exact rows = a recount from the runs", rowOk("Nested", five) && rowOk("Exact", L[rec].exact_set), JSON.stringify(cmp.slice(0, 2)));
    const ex = cmp.find(x => x[0].startsWith("Exact")), ne = cmp.find(x => x[0].startsWith("Nested"));
    ok("5b fold: unseen weather, nested and exact both on the case average", ne && pcs(uavg(rec)).has(ne[4]) && ex && ex[4] === ne[4], `${ne && ne[4]} / ${ex && ex[4]}`);
    const m6 = D.steps.find(s => s.id === "6").notes.more.blocks.map(b => b.html).join("");
    const fl0 = FL.budgets.map(b => Object.values(b.float.unseen_by_case).reduce((a, v) => a + v, 0) / 7);
    ok("6 fold: the float figure = float.json, averaged by case", [...new Set(fl0.map(v => [...pcs(v)][0]))].every(p => m6.includes(p)));
    const m1 = D.steps.find(s => s.id === "1").notes.more.blocks[0];
    ok("1 fold: council and model homes = regions.js and catchment.js", m1.intro.includes(REG.councilConnections.toLocaleString("en-AU")));
  }

  // ---- 19 Nov (third pass): the first view, the Show toggles, Greedy in two, the map controls card
  {
    await load();
    const first = await ev(`({top:Growth3D.isTop(), houses:document.querySelector("#toggleConn").classList.contains("primary"), housesShown:!!document.querySelector("#toggleConn").getClientRects().length,
      legend:document.querySelector("#toggleLegend").classList.contains("primary"), legendBox:!document.querySelector("#legend").hidden})`);
    ok("first load: the map straight down, Houses and Legend off (the Houses button shown)", first.top && !first.houses && first.housesShown && !first.legend && !first.legendBox, JSON.stringify(first));
    await click("#btn-compass"); await wait(1500);
    const tilted = await ev("Growth3D.isTop()");
    await click("#btn-compass"); await wait(1500);
    ok("first load: the compass still turns it to the tilted view and back", !tilted && await ev("Growth3D.isTop()"), tilted);
    await click('#viewKnob button[data-v="expert"]'); await wait(1500);
    const tog = () => ev('[...document.querySelectorAll("#objKnob button")].map(b=>(b.classList.contains("on")&&b.getAttribute("aria-pressed")==="true"?"1":"0")).join("")');
    const lines = () => ev('({w:document.querySelectorAll("#curve .cv-worst").length,a:document.querySelectorAll("#curve .cv-avg").length,lead:document.getElementById("sensorList").innerText.split("\\n")[0]})');
    const shown = [];
    for (const m of ["story", "exact", "warn"]) { await click(`#methKnob button[data-m="${m}"]`); await wait(900); shown.push(await ev('!!document.querySelector("#objKnob").getClientRects().length') && await tog() === "11"); }
    ok("Show: Worst case and Average show for every method, both on to start", shown.every(Boolean), shown.join());
    await click('#methKnob button[data-m="story"]'); await wait(1200);
    const both = await lines();
    await click('#objKnob button[data-o="worst"]'); await wait(900);
    const aOnly = await lines(), t1 = await tog();
    await click('#objKnob button[data-o="mean"]'); await wait(900);
    const t2 = await tog();
    ok("Show: Worst case off leaves the dashed averages only, and the figures say average", t1 === "01" && aOnly.w === 0 && aOnly.a >= 4 && /average/.test(aOnly.lead) && !/worst/.test(aOnly.lead), JSON.stringify(aOnly));
    ok("Show: the last one on cannot be turned off", t2 === "01", t2);
    await click('#objKnob button[data-o="worst"]'); await click('#objKnob button[data-o="mean"]'); await wait(900);
    const wOnly = await lines();
    ok("Show: Average off leaves the solid worst cases only, and the figures say worst", await tog() === "10" && wOnly.a === 0 && wOnly.w >= 4 && /worst/.test(wOnly.lead) && !/average/.test(wOnly.lead), JSON.stringify(wOnly));
    await click('#objKnob button[data-o="mean"]'); await wait(900);
    ok("Show: both on draws both", both.w >= 4 && both.a >= 4 && await tog() === "11", JSON.stringify(both));
    const names = await ev('[...document.querySelectorAll("#methKnob button")].filter(b=>!b.hidden).map(b=>b.textContent)');
    ok('Greedy is two methods: "Greedy: worst case" and "Greedy: average"', names.includes("Greedy: worst case") && names.includes("Greedy: average") && !names.some(n => /one at a time/.test(n)), names.join(" | "));
    await click('#scopeKnob button[data-s="broad"]'); await wait(1200);
    const gavg = [];
    for (const m of ["greedy", "greedy-avg"]) { await click(`#methKnob button[data-m="${m}"]`); await ev('(()=>{const r=document.getElementById("kRange");r.value="1";r.dispatchEvent(new Event("input"))})()'); await wait(1200); gavg.push(await ev('({pins:[...document.querySelectorAll(".labels .lbl.sensor")].length, lead:document.getElementById("sensorList").innerText.split("\\n")[0]})')); }
    const avgOf = t => +(((t.lead.match(/(\d+)% on average|average (\d+)%/) || []).slice(1).find(Boolean)) || -1);
    ok("Greedy: average at one sensor catches at least as much on average as Greedy: worst case", gavg[1].pins === 1 && avgOf(gavg[1]) >= avgOf(gavg[0]) && avgOf(gavg[0]) >= 0, gavg.map(g => g.lead).join(" / "));
    await send("Page.navigate", { url: "about:blank" }); await wait(150);
    await send("Page.navigate", { url: `http://127.0.0.1:${HTTP}/simulation4/explore.html#view=expert&method=greedy&obj=mean&show=average` });
    for (let i = 0; i < 240; i++) { await wait(250); if (await ev('!!(document.querySelector("#sensorList") && document.querySelector("#sensorList").innerText.length > 50)')) break; }
    await wait(1500);
    ok("hash: an old Greedy + Best average link opens Greedy: average; #show=average opens Average only", await ev('document.querySelector("#methKnob button.on").dataset.m') === "greedy-avg" && await tog() === "01");
    // The map controls card
    const help = await ev(`(()=>{const b=document.querySelector("#btn-maphelp"),c=document.querySelector("#btn-compass").getBoundingClientRect(),r=b.getBoundingClientRect();
      return{next:Math.abs(r.top-c.top)<4&&Math.abs(r.left-c.right)<24,label:b.getAttribute("aria-label"),pop:!!document.querySelector("#btn-maphelpPop")}})()`);
    ok("map help: a ? button beside the compass, labelled", help.next && help.label === "Map controls" && help.pop, JSON.stringify(help));
    const hb = await ev('(()=>{const r=document.querySelector("#btn-maphelp").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hb.x, y: hb.y, button: "none" }); await wait(400);
    const open = await ev(`(()=>{const p=document.querySelector("#btn-maphelpPop"),r=p.getBoundingClientRect(),c=document.querySelector("#btn-compass").getBoundingClientRect(),b=document.querySelector("#btn-maphelp").getBoundingClientRect();
      const hit=q=>!(q.right<=r.left||q.left>=r.right||q.bottom<=r.top||q.top>=r.bottom);
      return{shown:!p.hidden,w:Math.round(r.width),fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,clear:!hit(c)&&!hit(b),exp:document.querySelector("#btn-maphelp").getAttribute("aria-expanded"),t:p.innerText}})()`);
    ok("map help: hovering opens the card, about 360 px, on screen, clear of the compass and its own button", open.shown && open.w >= 340 && open.w <= 380 && open.fits && open.clear && open.exp === "true", JSON.stringify({ ...open, t: undefined }));
    ok("map help: left drag turns, right drag moves, scroll zooms, touch named; no pinch claimed", /Left click/.test(open.t) && /turn/.test(open.t) && /Right click/.test(open.t) && /move/.test(open.t) && /Scroll/.test(open.t) && /touch/i.test(open.t) && !/pinch/i.test(open.t + fs.readFileSync(path.join(PUB, "simulation4/map_help.js"), "utf8").replace(/no pinch zoom/g, "")));
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await wait(300);
    ok("map help: Escape closes it", await ev('document.querySelector("#btn-maphelpPop").hidden && document.querySelector("#btn-maphelp").getAttribute("aria-expanded")==="false"'));
  }

  // ---- 19 Nov: Explore's citations link to the team's paper library; its tooltips stay plain
  {
    await load();
    await click("#btn-results"); await wait(1200);
    const lib = {};
    for (const tb of await ev('[...document.querySelectorAll("#modalBox .restabs button")].map(b=>b.dataset.tab)')) {
      await tab(tb);
      for (const a of await ev('[...document.querySelectorAll("#modalBox a.lib")].map(a=>({t:a.textContent,h:a.getAttribute("href"),tg:a.target,r:a.rel}))')) lib[a.t + "|" + a.h] = a;
    }
    await click("#modalClose");
    const A = Object.values(lib), V = "https://siddhu-123.github.io/waste_water_network_sensor-papers/pdf-viewer.html?paper=";
    ok("Explore: the cited sources in Results link to the library viewer, new tab, rel=noopener", A.length >= 2 && A.every(a => a.h.startsWith(V) && a.tg === "_blank" && a.r === "noopener"), A.map(a => a.t).join(" ; ").slice(0, 170));
    ok("Explore: no tooltip holds a link", await ev('![...document.querySelectorAll("[data-tip]")].some(e=>/<a /.test(e.getAttribute("data-tip")))'));
  }

  ok("no page errors", errors.length === 0, errors.join(" | "));
  console.log(`\n${pass} passed, ${fail} failed`);
  chrome.kill(); server.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
