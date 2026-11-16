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
  ok("navbar has Product demo after Overview", await ev(`[...document.querySelectorAll('#tabs button')].slice(0,2).map(b=>b.textContent).join('|')`) === "Overview|Product demo");
  await click('#tabs button[data-tab="demo"]');
  let ready = false; for (let i = 0; i < 60 && !ready; i++) { await wait(250); ready = await ev(`(()=>{const f=document.querySelector('#pane-demo iframe');return !!(f && f.contentDocument && f.contentDocument.body && f.contentDocument.body.dataset.ready==='1')})()`); }
  ok("demo tab loads the demo in its pane", ready);
  await shot("00_site_tab");

  // The demo alone
  await send("Page.navigate", { url: `http://127.0.0.1:${HTTP}/demo/index.html` });
  for (let i = 0; i < 80; i++) { await wait(250); if (await ev("document.body.dataset.ready")) break; }
  ok("opens in the Simple reading level by default", await ev(`App.isSimple()`));
  await ev(`App.setMode('detailed')`); await wait(200);
  const fig = await ev(`(()=>{const o=App.SIM4_TEST();const a=App.score(App.ladderIdx(1),o),b=App.score(App.ladderIdx(5),o),c=App.score(App.ladderIdx(5),{...o,mm:25});return [a.worst,a.avg,a.warned,b.worst,b.avg,b.warned,b.warnable,c.worst,c.avg].map(x=>Math.round(x*100)/100)})()`);
  ok("engine reproduces Sim 4: 0%/53%, 8 warned; 81%/94%, 11 of 11; 25 mm 36%/45%", JSON.stringify(fig) === JSON.stringify([0, 0.53, 8, 0.81, 0.94, 11, 11, 0.36, 0.45]), JSON.stringify(fig));
  ok("twelve views in four chapters", await ev(`document.querySelectorAll('#secs .ch').length===4 && document.querySelectorAll('#secs button[data-sec]').length===12`));

  // 1 Setting
  ok("setting: a cutaway and a state badge", await ev(`!!document.querySelector('svg.cut') && !!document.querySelector('.badge')`));
  ok("setting starts on a surcharged manhole", /Surcharged/.test(await ev(`document.querySelector('.badge').textContent`)));
  await input("#stS", -1); await wait(150);
  ok("setting: no growth, the badge drops", !/Surcharged/.test(await ev(`document.querySelector('.badge').textContent`)), await ev(`document.querySelector('.badge').textContent`));
  await shot("01_setting");
  // 2 Network
  await click('#secs button[data-sec="network"]'); await wait(300);
  ok("network: histogram", await ev(`document.querySelectorAll('svg.hist .click').length>3`));
  await click('svg.hist g.click:last-of-type'); await wait(200);
  ok("network: clicking a bar picks those pipes out", await ev(`App.st.network.bin!==null`));
  const pipeXY = await ev(`(()=>{const g=GROWTH_GEOM,c=document.querySelector('#map').getBoundingClientRect();const p=g.plen.indexOf(Math.max(...g.plen)),m=Math.floor((g.ptr[p]+g.ptr[p+1]-1)/2),a=App.screenOf(g.nodes[g.up[p]].name),b=App.screenOf(g.nodes[g.down[p]].name);const s=App.toScreen(g.px[m],g.py[m]);return g.ptr[p+1]-g.ptr[p]>2?s:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}})()`);
  await clickAt(pipeXY.x, pipeXY.y); await wait(250);
  const tn = await panel(); ok("network: clicking a pipe works Manning through", /Qfull|Q full|L\/s/.test(tn) && /of capacity/.test(tn), tn.slice(tn.indexOf("Click a pipe") - 10, tn.indexOf("Click a pipe") + 80));
  await shot("02_network");
  // Approach, end to end
  await click('#secs button[data-sec="approach"]'); await wait(300);
  ok("approach: seven pipeline steps (step 2 in three parts) and four approaches", await ev(`document.querySelectorAll('.pipe6 button').length===7 && document.querySelectorAll('.pipe6 .nest button').length===3 && document.querySelectorAll('table.alts tr[data-alt]').length===4`));
  ok("approach: ours scores 88% worst, the desk study 25%", await ev(`(()=>{const v=id=>document.querySelector('tr[data-alt="'+id+'"] td.num').textContent;return v('ours')==='88%'&&v('desk')==='25%'&&v('ml')==='–'})()`));
  await click('[data-ap="3"]'); await wait(200);
  ok("approach: a step shows its detail link", /In detail: What the runs show/.test(await panel()));
  await click('tr[data-alt="judgement"]'); await wait(200);
  ok("approach: clicking an approach maps its five sites", await ev(`/its 5 sites/.test(document.querySelector('#legend').textContent)`));
  await shot("02b_approach");
  await click('[data-ap="1"]'); await wait(150); await click('.card [data-go="network"]'); await wait(300);
  ok("approach: the detail link opens that view", await ev(`App.st.sec==='network'`));
  // 3 Simulate
  await click('#secs button[data-sec="simulate"]'); await wait(300);
  ok("simulate: 504 simulated futures", /504/.test(await panel()));
  await click('[data-preset="2"]'); await wait(200);
  ok("simulate preset: the corridor on a wetter day spills", /\b1 newly spilling/.test(await panel()));
  await click('[data-stage="3"]'); await wait(150);
  ok("simulate: the stage text changes", /SWMM/.test(await ev(`document.querySelector('.stagetext').textContent`)));
  await shot("03_simulate");
  // 4 Insights
  await click('#secs button[data-sec="insights"]'); await wait(300);
  const before = await ev(`document.querySelector('.stats .stat b').textContent`);
  await click('[data-ms="sur"]'); await wait(200);
  ok("insights: switching the measure changes the count", before !== await ev(`document.querySelector('.stats .stat b').textContent`));
  await click('[data-find]'); await wait(300);
  ok("insights: clicking a hotspot selects it", await ev(`App.st.sel!==null`));
  await shot("04_insights");
  // 5 Algorithms
  await click('#secs button[data-sec="algorithms"]'); await wait(300);
  ok("algorithms: the recommended best-coverage set at 5 shows 88% worst", /88%/.test(await panel()) && /Best coverage/.test(await panel()));
  await click('[data-mth="greedyAvg"]'); await wait(200); await click("#alShow"); await wait(1200);
  ok("algorithms: the next-choice heat map draws", await ev(`/Choice for sensor/.test(document.querySelector('#legend').textContent)`));
  await shot("05_algorithms");
  // 6 Compare
  await click('#secs button[data-sec="compare"]'); await wait(1500); await click('#zreset'); await wait(200);
  ok("compare: seven methods in the table", await ev(`document.querySelectorAll('table.cmp tr[data-row]').length===7`));
  const row = id => ev(`[...document.querySelectorAll('table.cmp tr[data-row="${id}"] td')].map(x=>x.textContent).join('|')`);
  ok("compare: recommended row reads 94% / 88% / 11/11 / 75%", /^[^|]*\|94%\|88%\|11\/11\|75%/.test(await row("exact")), await row("exact"));
  ok("compare: nested list row reads 94% / 81% / 11/11 / 77%", /^[^|]*\|94%\|81%\|11\/11\|77%/.test(await row("sim4")), await row("sim4"));
  await clickSensor(0); await wait(300);
  ok("compare: failing Sensor 1 drops the worst case to 0%", /1 failed/.test(await panel()) && await ev(`document.querySelectorAll('.stats .stat b')[1].textContent==='0%'`));
  await click('tr[data-row="hydraulic"]'); await wait(1000);
  ok("compare: clicking a row maps that method", await ev(`App.st.compare.method==='hydraulic'`));
  await shot("06_compare");
  // 7 Cross-check
  await click('#secs button[data-sec="check"]'); await wait(800);
  const rho = await ev(`parseFloat(document.querySelector('.stats .stat b').textContent.replace('ρ = ',''))`);
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
  await shot("08_sensors");
  // 9 Repeat
  await click('#secs button[data-sec="repeat"]'); await wait(300);
  await click("#rRun"); for (let i = 0; i < 40; i++) { await wait(250); if (/of your 5 are in/.test(await panel())) break; }
  ok("repeat: placing sensors scores them and compares with the recommendation", /of your 5 are in the recommended five/.test(await panel()));
  await shot("09_repeat");
  // 10 Future
  await click('#secs button[data-sec="future"]'); await wait(800);
  ok("future: virtual coverage figure", /virtually covered/.test(await panel()));
  await click("#fuRun"); for (let i = 0; i < 40; i++) { await wait(250); if (/sites are shared/.test(await panel())) break; }
  ok("future: risk-weighted re-placement runs", /sites are shared with the recommended five/.test(await panel()));
  await shot("10_future");
  // 11 Conclude
  await click('#secs button[data-sec="conclude"]'); await wait(300);
  const tc = await panel(); ok("conclusion: the recommended 5 figures (94% / 88% / 11 of 11 / 75%)", /94%/.test(tc) && /88%/.test(tc) && /11 of 11/.test(tc) && /75%/.test(tc), tc.slice(tc.indexOf("THE PLAN"), tc.indexOf("THE PLAN") + 300));
  await shot("11_conclude");
  // Design: headlines, callouts, themes, presentation mode
  let heads = true; for (const v of await ev(`App.SECTIONS.map(s=>s[0])`)) { await ev(`App.go('${v}')`); await wait(120); heads = heads && await ev(`(()=>{const h=document.querySelector('#panel h2.headline');return !!h && h.textContent.length>30})()`); }
  ok("every view opens with a headline finding", heads);
  await ev(`(()=>{App.st.compare.method='exact';App.st.compare.failed.clear();App.go('compare')})()`); await wait(1200);
  ok("compare: a callout marks the sensor the plan rests on", /worst case drops to 0%/.test(await ev(`(document.querySelector('.lbl.callout')||{}).textContent||''`)));
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
  const JARGON = /surcharg|infiltrat|spearman|\u03c1|greedy|heuristic|quantile|worst case|scenario|manning|I&I|d\/D|exact solver|heat map/i;
  let plainOk = true, plainBad = "", plainHeads = true;
  for (const v of await ev(`App.SECTIONS.map(s=>s[0])`)) {
    await ev(`App.go('${v}')`); await wait(v === "compare" || v === "check" || v === "future" ? 900 : 250);
    const txt = await ev(`[...document.querySelectorAll('#panel, #legend, #read, #labels .callout')].map(e=>e.innerText).join(' ')`);
    const m = JARGON.exec(txt); if (m) { plainOk = false; plainBad += `${v}: "${txt.slice(Math.max(0, m.index - 40), m.index + 40)}" `; }
    plainHeads = plainHeads && await ev(`!!document.querySelector('#panel h2.headline') && !document.querySelector('#read').hidden`);
    await shot("simple_" + v);
  }
  ok("Simple: no jargon on any page (panel, legend, map notes, callouts)", plainOk, plainBad);
  ok("Simple: every page has a headline and a 'how to read the map' note", plainHeads);
  await ev(`App.go('setting')`); await wait(250);
  ok("Simple: the first page has the road analogy and the five words", /roads for wastewater/.test(await panel()) && await ev(`document.querySelectorAll('.words > div').length===5`));
  await ev(`App.go('algorithms')`); await wait(250);
  ok("Simple: 5 sensors notice 14 of 16 futures in the hardest weather, as dots", /14 of 16/.test(await panel()) && await ev(`document.querySelectorAll('svg.dots circle').length===16`));
  await ev(`(()=>{const e=document.querySelector('#alK');e.value=1;e.dispatchEvent(new Event('input'))})()`); await wait(250);
  ok("Simple: with 1 sensor, 2 of 16", /2 of 16/.test(await panel()));
  await ev(`App.go('simulate')`); await wait(250); await click('[data-sp="1"]'); await wait(300);
  ok("Simple: the followed future appears, with its early warning", /future we follow/.test(await panel()) && /already risen/.test(await panel()));
  await ev(`App.go('compare')`); await wait(800);
  ok("Simple: compare shows four rows of dots (ours 14, desk 4)", await ev(`document.querySelectorAll('.rowwrap svg.dots').length===4`) && /14 of 16/.test(await panel()) && /4 of 16/.test(await panel()));
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "d", code: "KeyD", windowsVirtualKeyCode: 68 }); await wait(300);
  ok("D switches to Detailed", await ev(`!App.isSimple()`) && await ev(`document.querySelectorAll('table.cmp tr[data-row]').length===7`));
  await ev(`App.setMode('simple')`); await ev(`App.go('conclude')`); await wait(300);
  // Keys and names
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 }); await wait(300);
  ok("← steps back a view", await ev(`App.st.sec==='future'`));
  let names = ""; for (const s of await ev(`App.SECTIONS.map(s=>s[0])`)) { await ev(`App.go('${s}')`); await wait(150); names += await ev("document.body.innerText"); }
  ok("no words name the client or the suburb, in any view", !/SA Water|Walkerville|Rostrevor|Stonyfell|Woodforde|Malvern|Bolivar|Adelaide/i.test(names));
  ok("no page errors", !logs.length, logs.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed`);
  ch.kill(); server.close(); process.exit(fail ? 1 : 0);
})();
