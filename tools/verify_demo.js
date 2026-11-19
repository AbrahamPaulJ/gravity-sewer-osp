// Drives demo/index.html (and the site's "Product demo" tab) in headless Chrome with real clicks: every view, its main
// interactions, page errors, figures against Sim 4's published ones, and no client or suburb names on the page.
//   node tools/verify_demo.js [screenshot-folder]
// Needs Google Chrome. Serves the repository itself on a local port.
const { spawn } = require("child_process"); const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const ROOT = path.join(__dirname, ".."), OUT = process.argv[2], HTTP = 8794, DBG = 9394;
const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(p => p && fs.existsSync(p));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const wait = ms => new Promise(r => setTimeout(r, ms));
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const server = http.createServer((q, s) => { let u = decodeURIComponent(q.url.split("?")[0]); if (u.endsWith("/")) u += "index.html"; const f = path.join(ROOT, u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end(); return; } s.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(s); }).listen(HTTP, "127.0.0.1");
let pass = 0, fail = 0; const ok = (n, c, note) => { c ? pass++ : fail++; console.log(`${c ? "ok  " : "FAIL"} ${n}${note != null && !c ? "  [" + String(note).slice(0, 240) + "]" : ""}`); };
(async () => {
  if (!CHROME) { console.log("Chrome not found: set CHROME=path"); process.exit(2); }
  const ch = spawn(CHROME, [`--remote-debugging-port=${DBG}`, "--headless=new", `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "demo-"))}`, "--window-size=1600,900", "about:blank"], { stdio: "ignore" });
  let t; for (let i = 0; i < 60 && !t; i++) { await wait(250); try { t = (await (await fetch(`http://127.0.0.1:${DBG}/json`)).json()).find(x => x.type === "page"); } catch (e) {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(), logs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") logs.push("EXC " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push("ERR " + m.params.args.map(a => a.value || a.description).join(" ").slice(0, 300)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) logs.push("EVAL " + x.slice(0, 60) + ": " + (r.result.exceptionDetails.exception?.description || "").slice(0, 300)); return r.result?.result?.value; };
  const shot = async n => { if (!OUT) return; const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, n + ".png"), Buffer.from(r.result.data, "base64")); };
  const clickAt = async (x, y) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) { await send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 }); await wait(30); } await wait(250); };
  const click = async sel => { const p = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`); if (!p) { ok("found " + sel, false); return; } await clickAt(p.x, p.y); };
  const panel = () => ev(`document.querySelector('#panel').innerText.replace(/\\s+/g,' ')`);
  const input = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(String(v))};e.dispatchEvent(new Event('input'))})()`);
  const clickSensor = async k => { const p = await ev(`App.screenOf(App.chamberName(App.planIdx(5)[${k}]))`); await clickAt(p.x, p.y); };
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });

  // The site tab
  await send("Page.navigate", { url: `http://127.0.0.1:${HTTP}/index.html` }); await wait(1500);
  ok("navbar: Overview, Background, Product demo, Simulation 4 | Archived", await ev(`[...document.querySelectorAll('#tabs > .tabs-side > button, #tabs > .tabs-side > .tab-group > .group-toggle')].map(b=>b.textContent).join('|')`) === "Overview|Background|Product demo|Simulation 4|Archived");
  ok("navbar: one row, the title on the left and the pages on the right, then the light/dark switch, Archived after a divider", await ev(`(()=>{const t=document.querySelector('header.top .brand').getBoundingClientRect(),n=document.querySelector('#tabs').getBoundingClientRect(),s=document.querySelector('.tabs-sep').getBoundingClientRect(),g=document.querySelectorAll('#tabs .tabs-side'),m=document.querySelector('#themeToggle').getBoundingClientRect();
    return Math.abs((t.top+t.bottom)/2-(n.top+n.bottom)/2)<12 && Math.abs((m.top+m.bottom)/2-(n.top+n.bottom)/2)<12 && t.right<n.left && n.right<=m.left && innerWidth-m.right<40 && g[0].getBoundingClientRect().right<=s.left && s.right<=g[1].getBoundingClientRect().left && !!document.querySelector('#archived-menu [data-tab="sandbox"]')})()`));
  await click('#archived-toggle'); await wait(200); await shot("00_nav_menu");
  ok("navbar: a menu opens under its own button", await ev(`(()=>{const t=document.querySelector('#archived-toggle').getBoundingClientRect(),m=document.querySelector('#archived-menu'),r=m.getBoundingClientRect();
    return !m.hidden && Math.abs(r.right-t.right)<2 && r.top>=t.bottom && r.left>=0})()`));
  await click('#archived-toggle'); await wait(100);
  await click('#tabs button[data-tab="demo"]');
  let ready = false; for (let i = 0; i < 60 && !ready; i++) { await wait(250); ready = await ev(`(()=>{const f=document.querySelector('#pane-demo iframe');return !!(f && f.contentDocument && f.contentDocument.body && f.contentDocument.body.dataset.ready==='1')})()`); }
  ok("demo tab loads the demo in its pane", ready);
  const dth = () => ev(`document.querySelector('#pane-demo iframe').contentDocument.documentElement.dataset.theme`);
  ok("demo tab opens in the light theme, and the header icon shows light", await dth() === 'paper' && await ev(`document.documentElement.dataset.theme==='light'`));
  await click('#themeToggle'); await wait(500);
  ok("header switch: the demo turns dark", await dth() === 'night' && await ev(`document.documentElement.dataset.theme==='dark'`), await dth());
  await ev(`document.querySelector('#pane-demo iframe').contentWindow.eval("App.go('regions')")`); await wait(200);
  await click('#tabs button[data-tab="overview"]'); await wait(300); await click('#tabs button[data-tab="demo"]'); await wait(600);
  ok("header switch: the choice holds across sections and tabs", await dth() === 'night' && await ev(`document.documentElement.dataset.theme==='dark'`));
  await ev(`(()=>{const w=document.querySelector('#pane-demo iframe').contentWindow;w.eval("App.setTheme('paper')")})()`); await wait(500);
  ok("demo's own selector: the header icon follows", await ev(`document.documentElement.dataset.theme==='light'`) && await ev(`sessionStorage.getItem('demoTheme')==='light'`));
  await ev(`(()=>{const w=document.querySelector('#pane-demo iframe').contentWindow;w.eval("App.setTheme('night')")})()`); await wait(300);
  // A new visit: a dark choice saved before is ignored, the demo opens light.
  await ev(`sessionStorage.clear(); localStorage.setItem('sim4Theme','dark'); document.querySelector('#pane-demo iframe').contentWindow.localStorage.setItem('demo-theme2','night')`);
  await send("Page.navigate", { url: `http://127.0.0.1:${HTTP}/index.html?visit=2#demo` }); await wait(1500);
  for (let i = 0; i < 60; i++) { await wait(250); if (await ev(`(()=>{const f=document.querySelector('#pane-demo iframe');return !!(f&&f.contentDocument&&f.contentDocument.body&&f.contentDocument.body.dataset.ready==='1')})()`)) break; }
  await wait(1000);
  ok("a new visit opens the demo light, whatever was saved before", await dth() === 'paper' && await ev(`document.documentElement.dataset.theme==='light'`), await dth());
  await ev(`localStorage.removeItem('sim4Theme')`);
  await shot("00_site_tab");

  // The demo alone
  await send("Page.navigate", { url: `http://127.0.0.1:${HTTP}/demo/index.html` });
  for (let i = 0; i < 80; i++) { await wait(250); if (await ev("document.body.dataset.ready")) break; }
  ok("opens in the Simple reading level by default", await ev(`App.isSimple()`));
  ok("opens in the light theme, on The problem", await ev(`document.documentElement.dataset.theme==='paper' && App.st.sec==='problem'`));
  // 19 Nov dry run: the presenting view has no sentences; a heading, a few words, numbers and charts only
  ok("problem: three items and the value line, no sentences shown", await ev(`document.querySelectorAll('.pitems > div').length===3 && !!document.querySelector('.valueline')`) && /Growth is filling sewers sized for fewer homes/.test(await panel()));
  const SENT = `[...document.querySelectorAll('#panel :is(.lede,.hint,.analogy,.thread)')].filter(e=>e.offsetParent!==null).length`;
  let quiet = true, quietBad = "", noScroll = true, scrollBad = "";
  for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await wait(300);
    for (const v of await ev(`App.SECTIONS.map(s=>s[0])`)) {
      await ev(`App.go('${v}')`); await wait(v === "compare" || v === "check" || v === "future" ? 900 : 300);
      const n = await ev(SENT); if (n) { quiet = false; quietBad += v + ":" + n + " "; }
      const sc = await ev(`(()=>{const p=document.querySelector('#panel');return p.scrollHeight-p.clientHeight})()`); if (sc > 2) { noScroll = false; scrollBad += `${v}@${w}:${sc}px `; }
      await shot(`present_${w}_${v}`);
    }
  }
  ok("Simple, as presented: no sentence blocks on any page", quiet, quietBad);
  // Round 2. 19 Nov: Sim 4 places level sensors by greedy; the two plans are Greedy: average (the story's 5a and 5b,
  // the default) and Greedy: worst case (step 5c). 20 Nov: Exact optimum is back beside them as a comparison (numbers.json's
  // exact_* keys). Expected figures come from numbers.json, not from this file.
  const X = JSON.parse(fs.readFileSync(path.join(ROOT, "simulation_src", "results", "sim4", "numbers.json"), "utf8"));
  const P = v => Math.round(v * 100) + "%", L = k => X.ladder[k - 1], LW = k => X.ladder_worst[k - 1], WT = X.warn_universe.target;
  const UA = (by, k) => Object.values(by).reduce((a, v) => a + v[String(k)], 0) / Object.keys(by).length;
  const hardOf = r => { const c = Object.entries(r.per_case).reduce((a, b) => b[1] < a[1] ? b : a); return { hit: Math.round(c[1] * X.universe[c[0]]), n: X.universe[c[0]] }; };
  await ev(`App.go('algorithms')`); await wait(300);
  ok("place sensors: the ladder diagram, S1 to 5 to 8, one at a time, nothing moves", await ev(`(()=>{const t=(document.querySelector('svg.ladder')||{}).textContent||'';return /S1/.test(t)&&/adds most/.test(t)&&/Nothing moves/.test(t)&&!/beam|sets kept|every possible/.test(t)})()`));
  const cards = (await ev(`[...document.querySelectorAll('.plancard')].map(c=>c.innerText).join(' | ')`)).replace(/\s+/g, ' ');
  const card = r => `${P(r.worst)} worst ${P(r.average)} average ${r.warned_target} of ${WT} warned Nothing moves`;
  ok("place sensors: Greedy: average card = numbers.json at 5, nothing moves, highlighted", new RegExp(`^(Greedy: average|Best on average) ${card(L(5))}`).test(cards) && await ev(`document.querySelector('.plancard[data-plan="avg"]').classList.contains('on')`), cards);
  ok("place sensors: Greedy: worst case card = numbers.json's ladder_worst at 5, nothing moves", new RegExp(`(Greedy: worst case|Best in the hardest weather) ${card(LW(5))}`).test(cards) && await ev(`App._.planMoves('avg')===0 && App._.planMoves('worst')===0`), cards);
  await ev(`App.go('insights')`); await wait(300);
  ok("what the runs show: 7 and 107 surcharged before growth", await ev(`[...document.querySelectorAll('.stats.sur .stat b')].map(b=>b.textContent).join()`) === "7,107" && /7 manholes surcharged/.test(await ev(`SIM4.steps.find(s=>s.id==='2').body`)) && /it has 107/.test(await ev(`SIM4.steps.find(s=>s.id==='2').body`)));
  await ev(`App.go('regions')`); await wait(300);
  const edgeT = await ev(`[...document.querySelectorAll('#labels .lbl.region.edge')].map(e=>e.textContent)`), chartT = await ev(`document.querySelector('svg.regchart').textContent`);
  ok("which regions: each edge label carries its rise with the 2041 homes", edgeT.length === 9 && edgeT.every(t => /\+\d+ mm/.test(t)) && (chartT.match(/\+\d+ mm/g) || []).length === 9, edgeT.join());
  await ev(`App.go('conclude')`); await wait(300);
  ok("conclusion: three tiles: buy in stages, rerun for a new suburb, new estates next", await ev(`document.querySelectorAll('.tiles > div').length===3`) && /Buy in stages/.test(await panel()) && /nothing moves as more are added/.test(await panel()) && /rerun the method/.test(await panel()) && /new estates at the edge/.test(await panel()));
  const MAP = { network: "1", simulate: "2", insights: "3", regions: "4", algorithms: "5b", sensors: "6", conclude: "6" };
  let bOk = true, bBad = "", bScroll = "";
  for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await wait(250);
    for (const v of await ev(`App.SECTIONS.map(s=>s[0])`)) {
      await ev(`App.go('${v}')`); await wait(v === "compare" || v === "check" || v === "future" ? 700 : 250);
      const has = await ev(`!!document.querySelector('#behindBtn')`), closed = await ev(`document.querySelector('#behind').hidden`);
      if (!!MAP[v] !== has || !closed) { bOk = false; bBad += `${v}@${w} `; continue; }
      if (!MAP[v]) continue;
      if (["insights", "regions", "algorithms", "conclude"].includes(v)) await shot(`r2_${w}_${v}_closed`);
      await click('#behindBtn'); await wait(250);
      const t = await ev(`document.querySelector('#behind').hidden?'':document.querySelector('#behind').innerText`), want = await ev(`SIM4.steps.find(s=>s.id==='${MAP[v]}').title`);
      if (!t.includes(want) || !/Assumes/.test(t) || !/Source/.test(t)) { bOk = false; bBad += `${v}@${w}:content `; }
      if (await ev(`(()=>{const b=document.querySelector('#behind');return b.getBoundingClientRect().bottom<=innerHeight+1 && getComputedStyle(b).overflowY==='auto'})()`) !== true) bScroll += `${v}@${w} `;
      await shot(`r2_${w}_${v}_open`);
      await click('#behindClose'); await wait(200);
      if (!(await ev(`document.querySelector('#behind').hidden`))) { bOk = false; bBad += `${v}@${w}:close `; }
    }
  }
  ok("behind this step: a closed panel on each mapped section (and only those), opening the story's step", bOk, bBad);
  ok("behind this step: open, it fits the window and scrolls inside itself", !bScroll, bScroll);
  await ev(`App.go('regions')`); await click('#behindBtn'); await wait(200); await ev(`App.go('algorithms')`); await wait(200);
  ok("behind this step: closes again when moving to another section", await ev(`document.querySelector('#behind').hidden`));
  await ev(`App.go('regions')`); await click('#behindBtn'); await wait(200);
  ok("behind this step: sources link to the team's library", await ev(`!!document.querySelector('#behind a[href*="siddhu-123.github.io"]')`));
  // The story's relative links (step 6: "Open Explore's Greenfield view") must reach simulation4/, not demo/.
  await ev(`App.go('conclude')`); await wait(200); await click('#behindBtn'); await wait(250);
  const gfLinks = await ev(`[...document.querySelectorAll('#behind a[href]')].map(a=>a.getAttribute('href')).filter(h=>!/^https?:/.test(h))`);
  const broken = gfLinks.filter(h => !fs.existsSync(path.join(ROOT, "demo", h.split("#")[0])));
  ok("behind this step: the story's own links reach Simulation 4 (Open Explore's Greenfield view)", gfLinks.some(h => /^\.\.\/simulation4\/explore\.html#fam=one/.test(h)) && !broken.length, JSON.stringify(gfLinks) + " broken " + JSON.stringify(broken));
  await click('#behindClose'); await wait(150);
  await ev(`App.go('problem')`);
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }); await wait(200);
  ok("Simple, as presented: no panel scrolling at 1920x1080 or 1366x768", noScroll, scrollBad);
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }); await ev(`App.go('problem')`); await wait(200);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "n", code: "KeyN", windowsVirtualKeyCode: 78 }); await wait(200);
  ok("N brings the sentences back (Notes)", await ev(`document.documentElement.hasAttribute('data-notes')`));
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "n", code: "KeyN", windowsVirtualKeyCode: 78 }); await wait(200);
  await ev(`App.setMode('detailed')`); await wait(200);
  const fig = await ev(`(()=>{const o=App.SIM4_TEST();const a=App.score(App.ladderIdx(1),o),b=App.score(App.ladderIdx(5),o),c=App.score(App.ladderIdx(5),{...o,mm:25}),w=App.score(App._.ladderWorstIdx(5),o);return [a.worst,a.avg,a.warned,b.worst,b.avg,b.warned,b.warnable,c.worst,c.avg,w.worst,w.avg,w.warned].map(x=>Math.round(x*100)/100)})()`);
  const r2 = x => Math.round(x * 100) / 100, want = [L(1).worst, L(1).average, L(1).warned_target, L(5).worst, L(5).average, L(5).warned_target, WT, L(5).worst_25, L(5).average_25, LW(5).worst, LW(5).average, LW(5).warned_target].map((v, j) => [2, 5, 6, 11].includes(j) ? v : r2(v));
  ok("engine reproduces Sim 4's two greedy lists (numbers.json): 1 and 5 level sensors, warnings, the 25 mm rule", JSON.stringify(fig) === JSON.stringify(want), JSON.stringify(fig) + " vs " + JSON.stringify(want));
  ok("fifteen views in four chapters, The problem first", await ev(`document.querySelectorAll('#secs .ch').length===4 && document.querySelectorAll('#secs button[data-sec]').length===15 && document.querySelector('#secs button[data-sec]').dataset.sec==='problem'`));
  ok("order: Which regions, Place sensors, then Compare and Other methods", await ev(`App.SECTIONS.map(s=>s[0]).join()`) === "problem,setting,network,approach,simulate,insights,regions,algorithms,compare,ninh,check,sensors,repeat,future,conclude", await ev(`App.SECTIONS.map(s=>s[0]).join()`));
  ok("the plan defaults to Greedy: average (the story's step 5b)", await ev(`App._.plan()==='avg' && App.planIdx(5).join()===App.ladderIdx(5).join()`));
  ok("sensor labels read S1 to S5", await ev(`(()=>{App.go('conclude');return [...document.querySelectorAll('#labels .lbl.sensor')].map(e=>e.textContent).join()==='S1,S2,S3,S4,S5'})()`));
  await ev(`App.go('setting')`); await wait(300);

  // 1 Setting
  ok("setting: a cutaway and a state badge", await ev(`!!document.querySelector('svg.cut') && !!document.querySelector('.badge')`));
  ok("setting starts on the design wet day", await ev(`App.st.setting.tag===SIM4.design`));
  await input("#stS", -1); await wait(150);
  ok("setting: no growth, the badge reads below the limit", !/Surcharged/.test(await ev(`document.querySelector('.badge').textContent`)), await ev(`document.querySelector('.badge').textContent`));
  await shot("01_setting");
  // 2 Network
  await click('#secs button[data-sec="network"]'); await wait(300);
  ok("network: 2,851 connected beside 2,565 in the regions, and the 2041 source", await ev(`(()=>{const t=document.querySelector('#panel').textContent;return /2,851/.test(t)&&/2,565/.test(t)&&/PlanSA 2021 to 2041/.test(t)})()`), await ev(`document.querySelector('#panel .stats').textContent`));
  ok("network: histogram", await ev(`document.querySelectorAll('svg.hist .click').length>3`));
  await click('svg.hist g.click:last-of-type'); await wait(200);
  ok("network: clicking a bar picks those pipes out", await ev(`App.st.network.bin!==null`));
  const pipeXY = await ev(`(()=>{const g=GROWTH_GEOM,c=document.querySelector('#map').getBoundingClientRect();const p=g.plen.indexOf(Math.max(...g.plen)),m=Math.floor((g.ptr[p]+g.ptr[p+1]-1)/2),a=App.screenOf(g.nodes[g.up[p]].name),b=App.screenOf(g.nodes[g.down[p]].name);const s=App.toScreen(g.px[m],g.py[m]);return g.ptr[p+1]-g.ptr[p]>2?s:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}})()`);
  await clickAt(pipeXY.x, pipeXY.y); await wait(250);
  const tn = await panel(); ok("network: clicking a pipe works Manning through", /Qfull|Q full|L\/s/.test(tn) && /of capacity/.test(tn), tn.slice(tn.indexOf("Click a pipe") - 10, tn.indexOf("Click a pipe") + 80));
  await shot("02_network");
  // Approach, end to end
  await click('#secs button[data-sec="approach"]'); await wait(300);
  ok("approach: eight pipeline steps (step 2 in three parts) and four approaches", await ev(`document.querySelectorAll('.pipe6 button').length===8 && document.querySelectorAll('.pipe6 .nest button').length===3 && document.querySelectorAll('table.alts tr[data-alt]').length===4`));
  await click('[data-ap="4"]'); await wait(300);
  ok("approach: step 4 chooses the regions to watch, and the map shows monitor, watch and leave", /Choose the regions to watch/.test(await panel()) && await ev(`/Monitor region/.test(document.querySelector('#legend').textContent) && /Leave/.test(document.querySelector('#legend').textContent)`));
  await click('[data-ap="5"]'); await wait(300);
  ok("approach: step 5 places level sensors one at a time, by greedy, nested", /Place level sensors, one at a time/.test(await panel()) && /nested/.test(await panel()));
  await click('[data-ap="1"]'); await wait(200);
  ok("approach: ours (Greedy: average) scores its worst case, the desk study 25%", await ev(`(()=>{const v=id=>document.querySelector('tr[data-alt="'+id+'"] td.num').textContent;return v('ours')==='${P(L(5).worst)}'&&v('desk')==='25%'&&v('ml')==='–'})()`));
  await click('[data-ap="3"]'); await wait(200);
  ok("approach: a step shows its detail link", /In detail: What the runs show/.test(await panel()));
  await click('tr[data-alt="judgement"]'); await wait(200);
  ok("approach: clicking an approach maps its five sites", await ev(`/its 5 sites/.test(document.querySelector('#legend').textContent)`));
  await shot("02b_approach");
  await click('[data-ap="1"]'); await wait(150); await click('.card [data-go="network"]'); await wait(300);
  ok("approach: the detail link opens that view", await ev(`App.st.sec==='network'`));
  // 3 Simulate
  await click('#secs button[data-sec="simulate"]'); await wait(300);
  ok("simulate: 504 simulated scenarios, as a funnel to 315, 175 and 119", /504/.test(await panel()) && /315/.test(await panel()) && /175/.test(await panel()) && /119/.test(await panel()), await panel());
  ok("simulate: the design wet day in plain words", /the wet day these pipes are designed to carry/.test(await panel()));
  await click('[data-preset="2"]'); await wait(200);
  ok("simulate preset: the corridor on a wetter day spills", /\b1 newly spilling/.test(await panel()));
  await click('[data-stage="3"]'); await wait(150);
  ok("simulate: the stage text changes", /SWMM/.test(await ev(`document.querySelector('.stagetext').textContent`)));
  await shot("03_simulate");
  // 4 Insights
  await click('#secs button[data-sec="insights"]'); await wait(300);
  const before = await ev(`document.querySelector('.stats:not(.sur) .stat b').textContent`);
  await click('[data-ms="sur"]'); await wait(200);
  ok("insights: switching the measure changes the count", before !== await ev(`document.querySelector('.stats:not(.sur) .stat b').textContent`));
  await click('[data-find]'); await wait(300);
  ok("insights: clicking a hotspot selects it", await ev(`App.st.sel!==null`));
  await shot("04_insights");
  // Which regions
  await click('#secs button[data-sec="regions"]'); await wait(300);
  ok("regions: a bar per region, coloured by action, with 2 Monitor / 3 Watch / 4 Leave", await ev(`document.querySelectorAll('svg.regchart rect').length===6 && (document.querySelector('svg.regchart').textContent.match(/not reached/g)||[]).length===3`) && /2 Monitor 3 Watch 4 Leave/.test(await panel()), await panel());
  ok("regions: names the 0.7 limit and its source", /0\.7/.test(await panel()) && /Kimbrough/.test(await panel()));
  ok("regions: Detailed links the source to the team's library", await ev(`!!document.querySelector('#panel a[href*="siddhu-123.github.io"]')`));
  ok("regions: region names sit at the edge, not on manholes in the middle", await ev(`document.querySelectorAll('#labels .lbl.region.edge').length===9`));
  await shot("04b_regions");
  // 5 Algorithms
  await click('#secs button[data-sec="algorithms"]'); await wait(300);
  ok("algorithms: Greedy: average at 5 shows its worst case", (await panel()).includes(P(L(5).worst)) && /Greedy: average/.test(await panel()) && !/Buy all at once|Buy in stages \(nested\)|beam search/i.test(await panel()));
  ok("algorithms: the methods are the two greedy plans, Exact optimum, two desk methods and random", await ev(`[...document.querySelectorAll('[data-mth]')].map(b=>b.dataset.mth).join()`) === "greedyAvg,greedyWorst,exact,hydraulic,homes,random");
  await click('[data-mth="exact"]'); await wait(300);
  ok("algorithms: Exact optimum at 5 = numbers.json, says it is the comparison, and has no next-choice map (it is not built one at a time)",
     (await panel()).includes(P(L(5).exact_worst)) && (await panel()).includes(P(L(5).exact_average)) && /comparison/.test(await panel()) && /move sensors/.test(await panel()) && await ev(`!document.querySelector('#alShow')`), (await panel()).slice(0, 600));
  await click('[data-mth="greedyWorst"]'); await wait(200); await click("#alShow"); await wait(1200);
  ok("algorithms: the next-choice heat map draws", await ev(`/Choice for sensor/.test(document.querySelector('#legend').textContent)`));
  await shot("05_algorithms");
  // 6 Compare
  await click('#secs button[data-sec="compare"]'); await wait(1500); await click('#zreset'); await wait(200);
  ok("compare: six rows: the two greedy plans, Exact optimum, two desk methods and random", await ev(`[...document.querySelectorAll('table.cmp tr[data-row]')].map(r=>r.dataset.row).join()`) === "greedyAvg,greedyWorst,exact,hydraulic,homes,random");
  const row = id => ev(`[...document.querySelectorAll('table.cmp tr[data-row="${id}"] td')].map(x=>x.textContent).join('|')`);
  // The story quotes unseen weather as the average over the cases, so the demo, which reads the story's data, does too.
  const rowWant = (r, by) => `|${P(r.average)}|${P(r.worst)}|${r.warned_target}/${WT}|${P(UA(by, 5))}|`;
  ok("compare: Greedy: average row = numbers.json (average, worst, warned, unseen weather)", (await row("greedyAvg")).includes(rowWant(L(5), X.held_out_by_case)), await row("greedyAvg"));
  ok("compare: Greedy: worst case row = numbers.json's ladder_worst", (await row("greedyWorst")).includes(rowWant(LW(5), X.held_out_by_case_worst)), await row("greedyWorst"));
  // Exact optimum's unseen weather is the story's own (step 5b's comparison table), read from its data.
  const exUnseen = await ev(`(()=>{const b=SIM4.steps.find(s=>s.id==='5b').notes.more.blocks[1].html,r=new DOMParser().parseFromString('<table>'+b+'</table>','text/html');const tr=[...r.querySelectorAll('tr')].find(t=>/^Exact optimum/.test(t.cells[0].textContent));return tr?tr.cells[4].textContent:''})()`);
  ok("compare: Exact optimum row = numbers.json's exact set at 5, unseen weather = the story's", (await row("exact")).includes(`|${P(L(5).exact_average)}|${P(L(5).exact_worst)}|`) && (await row("exact")).includes(`|${exUnseen}|`), (await row("exact")) + " / story " + exUnseen);
  // Fail the sensor the nested plan rests on (the callout's): the worst case drops to what the other four see.
  const weak = await ev(`(()=>{const s=App.planIdx(5),o=App.SIM4_TEST(),f=s.map(i=>App.score(s.filter(j=>j!==i),o).worst);return {k:f.indexOf(Math.min(...f)),w:Math.round(100*Math.min(...f))+'%'}})()`);
  await clickSensor(weak.k); await wait(300);
  ok(`compare: failing S${weak.k + 1} drops the worst case to ${weak.w}`, /1 failed/.test(await panel()) && await ev(`document.querySelectorAll('.stats .stat b')[1].textContent==='${weak.w}'`), JSON.stringify(weak) + " " + (await panel()).slice(0, 500));
  await click('tr[data-row="hydraulic"]'); await wait(1000);
  ok("compare: clicking a row maps that method", await ev(`App.st.compare.method==='hydraulic'`));
  await shot("06_compare");
  // 7 Cross-check
  await click('#secs button[data-sec="check"]'); await wait(800);
  const rho = await ev(`parseFloat(document.querySelector('.stats:not(.sur) .stat b').textContent.replace('ρ = ',''))`);
  ok("cross-check: flow/capacity agrees with the model (ρ > 0.5)", rho > 0.5, rho);
  ok("cross-check: scatter with the five sensors", await ev(`document.querySelectorAll('svg.scatter .dot.sensor').length===5`));
  await click("details.fold:last-of-type summary"); await wait(150); await input("#ckX", 300); await wait(200);
  ok("cross-check: the Manning gauge responds to extra homes", /With the extra homes/.test(await panel()));
  await shot("07_check");
  // 8 Sensor types
  await click('#secs button[data-sec="sensors"]'); await wait(300);
  await click('[data-sty="float"]'); await wait(200);
  ok("sensors: float switch reads off at low water", /off: no information/.test(await panel()));
  await input("#snW", 400); await wait(200);
  ok("sensors: float switch turns on when the water reaches it", /ON: water has reached it/.test(await panel()));
  ok("sensors: level beats floats at $125k (81% vs 0%)", /\$125k/.test(await panel()));
  ok("sensors: the verdict, floats not feasible for growth, other types next work", /not feasible for watching growth/.test(await panel()) && /untested, next work/.test(await panel()) && !/150 mm|5 to 10 mm/.test(await panel()));
  await shot("08_sensors");
  // 9 Repeat
  await click('#secs button[data-sec="repeat"]'); await wait(300);
  await click("#rRun"); for (let i = 0; i < 40; i++) { await wait(250); if (/of your 5 are in/.test(await panel())) break; }
  ok("repeat: placing sensors scores them and compares with the recommendation", /of your 5 are in the recommended five/.test(await panel()));
  await shot("09_repeat");
  await ev(`App.go('network')`); await wait(300);
  ok("network: pipes take several colours from the ramp, and the legend shows them", await ev(`(()=>{const sw=[...document.querySelectorAll('#legend i')].map(e=>getComputedStyle(e).backgroundColor);return new Set(sw).size>4})()`));
  await ev(`(()=>{App.st.network.by='flow';App.st.network.bin=null;App._.refresh()})()`); await wait(250);
  await shot("network_flow");
  ok("network: opens on flow today ÷ capacity (homes' peak flow ÷ 70% of full capacity)", await ev(`App._.load(0)===App._.homeFlow(0)/(0.7*App._.G().pcap[0])`));
  ok("network: pipes can be coloured by flow today, beside capacity and flow ÷ capacity", /Flow today/.test(await panel()) && await ev(`document.querySelectorAll('svg.hist g.click').length===7`));
  const worstRed = await ev(`(()=>{const s=App._.pal().seq,last=s[s.length-1],first=s[0];return ['load','util','flow','cap','size','age','slope','depth'].every(k=>{App.st.network.by=k;App.st.network.bin=null;App._.refresh();
    const sw=[...document.querySelectorAll('svg.hist g.click rect+rect')].map(r=>r.getAttribute('fill'));const bad={load:sw.length-1,util:sw.length-1,flow:sw.length-1,slope:0,depth:0,cap:0,size:0,age:0}[k];return sw[bad]===last&&sw[sw.length-1-bad]===first;})})()`);
  ok("network: on every measure, red is the worse end (full, flat, shallow, small, low capacity, old)", worstRed);
  for (const th of ["night", "clear", "paper"]) { await ev(`(()=>{App.setTheme('${th}');App.st.network.by='age';App.st.network.bin=null;App._.refresh()})()`); await wait(250); await shot("network_age_" + th); }
  ok("network: no pink or purple in the pipe colour scale, in any theme", await ev(`Object.values(App.THEMES).every(t=>t.seq.every(c=>{const [r,g,b]=[1,3,5].map(k=>parseInt(c.slice(k,k+2),16));return !(r>200&&b>150&&g<120)&&!(b>r&&r>g+40)}))`));
  await ev(`(()=>{App.st.network.by='util';App._.refresh()})()`); await wait(200);
  // 10 Future
  await click('#secs button[data-sec="future"]'); await wait(800);
  ok("future: virtual coverage figure", /virtually covered/.test(await panel()));
  await click("#fuRun"); for (let i = 0; i < 40; i++) { await wait(250); if (/sites are shared/.test(await panel())) break; }
  ok("future: risk-weighted re-placement runs", /sites are shared with the recommended five/.test(await panel()));
  await shot("10_future");
  // 11 Conclude
  await click('#secs button[data-sec="conclude"]'); await wait(300);
  const stats = (r, by) => `${P(r.average)} seen on average ${P(r.worst)} hardest weather ${r.warned_target} of ${WT} overloads warned ${P(UA(by, 5))} weather not chosen for`;
  const tc = await panel(); ok("conclusion: Greedy: average at 5 = numbers.json", tc.includes(stats(L(5), X.held_out_by_case)), tc.slice(0, 400));
  const sixth = Math.round(100 * L(6).worst) - Math.round(100 * L(5).worst);
  ok("conclusion: five levels off on Greedy: average's numbers", tc.includes(`a sixth adds ${sixth} points`), tc.slice(tc.indexOf("Five is"), tc.indexOf("Five is") + 120));
  await click('[data-plan="worst"]'); await wait(300);
  const tc2 = await panel(); ok("conclusion: Greedy: worst case at 5 = numbers.json's ladder_worst", tc2.includes(stats(LW(5), X.held_out_by_case_worst)), tc2.slice(0, 400));
  await click('[data-plan="avg"]'); await wait(300);
  ok("conclusion: back to Greedy: average", await ev(`App._.plan()==='avg'`));
  const exMoved = L(4).exact_set.filter(m => !L(5).exact_set.includes(m)).length;
  const exRow = await ev(`(document.querySelector('table.plancmp tr.cmpx')||{}).innerText||''`);
  ok("conclusion: Exact optimum is the comparison row, numbers.json's at 5, and says how many sensors it moves from 4", exRow.includes(P(L(5).exact_worst)) && exRow.includes(P(L(5).exact_average)) && /comparison/.test(exRow) && exRow.includes(exMoved ? `Yes: ${exMoved} from 4` : "Not from 4"), exRow);
  await shot("11_conclude");
  // Other methods: Ninh's topology rule and the global-coverage algorithms, scored on growth and on blockage cover
  await ev(`App.go('ninh')`); await wait(500);
  ok("other methods: Ninh greedy, Ninh genetic algorithm, coverage greedy, Sim 3.5 region-less and our growth plan, in the table and the chart", await ev(`[...document.querySelectorAll('table.ncmp tr[data-nm]')].map(r=>r.dataset.nm).join()==='ninh,ga,cov,s35,gAvg' && document.querySelectorAll('svg.nchart g[data-nm]').length===5`));
  ok("other methods: the table's growth figures for Sim 4 match the demo's own score", await ev(`(()=>{const m=window.NINH_COMPARE.methods.find(x=>x.id==='gAvg'),s=App.score(m.sets[4],App.SIM4_TEST());return Math.abs(s.worst-m.byK[4].scenario.worst)<1e-9&&Math.abs(s.avg-m.byK[4].scenario.avg)<1e-9})()`));
  await click('table.ncmp tr[data-nm="ga"]'); await wait(300);
  ok("other methods: clicking a row shows that method's sensors and the pipe they cover", await ev(`App.st.ninh.m==='ga'`) && /genetic algorithm/.test(await panel()));
  await ev(`(()=>{const e=document.querySelector('#ncK');e.value=3;e.dispatchEvent(new Event('input'))})()`); await wait(300);
  ok("other methods: the sensor slider re-scores every method", await ev(`App.st.ninh.k===3`) && /3 sensors/.test(await panel()));
  await ev(`document.querySelector("svg.nchart").scrollIntoView()`); await wait(200); await shot("ninh_compare");
  await ev(`(()=>{App.st.ninh.k=5;App.st.ninh.m='ninh'})()`);
  // Design: titles, callouts, themes, presentation mode
  let heads = true; for (const v of await ev(`App.SECTIONS.map(s=>s[0])`)) { await ev(`App.go('${v}')`); await wait(120); heads = heads && await ev(`(()=>{const h=document.querySelector('#panel h2.title');return !!h && h.textContent===App.SECTIONS.find(s=>s[0]==='${v}')[2]})()`); }
  ok("every view opens with its own title", heads);
  await ev(`(()=>{App.st.compare.method='greedyAvg';App.st.compare.failed.clear();App.go('compare')})()`); await wait(1200);
  const drop = await ev(`(()=>{const s=App.planIdx(5),o=App.SIM4_TEST();return Math.round(100*Math.min(...s.map(i=>App.score(s.filter(j=>j!==i),o).worst)))+'%'})()`);
  ok("compare: a callout marks the sensor the plan rests on", (await ev(`(document.querySelector('.lbl.callout')||{}).textContent||''`)).includes(`worst case drops to ${drop}`), drop);
  for (const t of ["night", "clear", "paper"]) { await ev(`App.setTheme('${t}')`); await wait(300); await shot("theme_" + t); }
  ok("three themes switch without errors, and the map follows", await ev(`document.documentElement.dataset.theme==='paper' && getComputedStyle(document.body).backgroundColor!==''`));
  const w0 = await ev(`document.querySelector('#panel').getBoundingClientRect().width`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "p", code: "KeyP", windowsVirtualKeyCode: 80 }); await wait(400);
  ok("P turns on presentation mode: a wider, larger panel", await ev(`document.documentElement.classList.contains('present')`) && (await ev(`document.querySelector('#panel').getBoundingClientRect().width`)) > w0 + 80);
  await shot("present_compare");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "p", code: "KeyP", windowsVirtualKeyCode: 80 }); await wait(300);
  await ev(`App.go('conclude')`); await wait(300);
  // Simple reading level: every page in plain words
  await ev(`App.setMode('simple')`); await wait(300);
  const JARGON = /surcharg|infiltrat|spearman|\u03c1|greedy|heuristic|quantile|worst case|manning|future|I&I|d\/D|exact solver|heat map/i;
  let plainOk = true, plainBad = "", plainHeads = true, plainMiss = "";
  for (const v of await ev(`App.SECTIONS.map(s=>s[0])`)) {
    await ev(`App.go('${v}')`); await wait(v === "compare" || v === "check" || v === "future" ? 900 : 250);
    const txt = await ev(`[...document.querySelectorAll('#panel, #legend, #read, #labels .callout')].map(e=>e.innerText).join(' ')`);
    const m = JARGON.exec(txt); if (m) { plainOk = false; plainBad += `${v}: "${txt.slice(Math.max(0, m.index - 40), m.index + 40)}" `; }
    const hd = await ev(`!!document.querySelector('#panel h2.title') && !document.querySelector('#read').hidden`); if (!hd) plainMiss += v + " "; plainHeads = plainHeads && hd;
    await shot("simple_" + v);
  }
  ok("Simple: no jargon on any page (panel, legend, map notes, callouts)", plainOk, plainBad);
  ok("Simple: every page has its title and a 'how to read the map' note", plainHeads, plainMiss);
  await ev(`document.documentElement.setAttribute('data-notes','')`);
  await ev(`App.go('setting')`); await wait(250);
  ok("Simple: the first page has the road analogy and the five words", /roads for wastewater/.test(await panel()) && await ev(`document.querySelectorAll('.words > div').length===5`));
  await ev(`App.go('algorithms')`); await wait(250);
  const h5 = hardOf(L(5));
  ok(`Simple: 5 level sensors notice ${h5.hit} of ${h5.n} scenarios in the hardest weather, as dots`, (await panel()).includes(`${h5.hit} of ${h5.n}`) && await ev(`document.querySelectorAll('svg.dots circle').length===${h5.n}`));
  await ev(`(()=>{const e=document.querySelector('#alK');e.value=1;e.dispatchEvent(new Event('input'))})()`); await wait(250);
  ok("Simple: with 1 level sensor, none seen in its hardest weather", /\b0 of \d+ scenarios/.test(await panel()), (await panel()).slice(300, 700));
  await ev(`App.go('simulate')`); await wait(250); await click('[data-sp="1"]'); await wait(300);
  ok("Simple: the followed scenario appears, with its early warning", /scenario we follow/.test(await panel()) && /already risen/.test(await panel()));
  await ev(`App.go('compare')`); await wait(800);
  ok(`Simple: compare shows five rows of dots (ours ${h5.hit}, the best bought all at once, desk 4)`, await ev(`document.querySelectorAll('.rowwrap svg.dots').length===5`) && /bought all at once/.test(await panel()) && (await panel()).includes(`${h5.hit} of ${h5.n}`) && /\b4 of 16/.test(await panel()), await panel());
  await ev(`document.documentElement.removeAttribute('data-notes')`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "d", code: "KeyD", windowsVirtualKeyCode: 68 }); await wait(300);
  ok("D switches to Detailed", await ev(`!App.isSimple()`) && await ev(`document.querySelectorAll('table.cmp tr[data-row]').length===6`));
  await ev(`App.setMode('simple')`); await ev(`App.go('conclude')`); await wait(300);
  // Keys and names
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 }); await wait(300);
  ok("← steps back a view", await ev(`App.st.sec==='future'`));
  let names = ""; for (const s of await ev(`App.SECTIONS.map(s=>s[0])`)) { await ev(`App.go('${s}')`); await wait(150); names += await ev("document.body.innerText"); }
  for (const v of ["network", "simulate", "insights", "regions", "algorithms", "sensors", "conclude"]) { await ev(`App.go('${v}')`); await wait(150); await click('#behindBtn'); await wait(150); names += await ev(`document.querySelector('#behind').innerText`); }
  ok("no words name the client or the suburb, in any view", !/SA Water|Walkerville|Rostrevor|Stonyfell|Woodforde|Malvern|Bolivar|Adelaide/i.test(names));
  await ev(`App.setMode('detailed')`); let all = ""; for (const s of await ev(`App.SECTIONS.map(s=>s[0])`)) { await ev(`App.go('${s}')`); await wait(150); all += await ev("document.body.textContent"); } await ev(`App.setMode('simple')`);
  const unsourced = /US EPA|Auckland|88\.6|Sydney Water|United Utilities|Nemhauser|Dual use|[Ff]loat[^.]{0,80}(150 mm|5 to 10 mm)|\u2014/.exec(names + all);
  ok("no unsourced claims, float figures or em dashes, in either reading level", !unsourced, unsourced && (names + all).slice(Math.max(0, unsourced.index - 80), unsourced.index + 60));
  ok("no page errors", !logs.length, logs.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  ch.kill(); server.close(); process.exit(fail ? 1 : 0);
})();
