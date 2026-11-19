#!/usr/bin/env node
/* verify_sim4_web.js - drives the Sim 4 story page with real mouse events, over the Chrome DevTools protocol, and
   compares what it shows with simulation_src/results/sim4/numbers.json. Serves this repository as it is on disk
   (since 14 Nov the Sim 4 page is edited here, not in the private sim4_web/), so it tests what will be published.
   Every expected figure is read from the data files, none typed in.

     node tools/verify_sim4_web.js [screenshot folder]
     node tools/verify_sim4_web.js --serve          # just the local server, http://127.0.0.1:8772/simulation4/
*/
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const PUB = path.dirname(__dirname), RES = path.join(PUB, 'simulation_src/results/sim4');
const HTTP = 8772, DBG = 9372;
const X = JSON.parse(fs.readFileSync(path.join(RES, 'numbers.json'), 'utf8'));
global.window = global; eval(fs.readFileSync(path.join(PUB, 'simulation4/data/sim4.js'), 'utf8'));
const D = window.SIM4;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, note) => { if (c) pass++; else fail++; console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${n}${note != null ? '   [' + String(note).slice(0, 170) + ']' : ''}`); };

const server = http.createServer((q, s) => {
  let u = decodeURIComponent(q.url.split('?')[0]);
  if (u.endsWith('/')) u += 'index.html';
  const f = path.join(PUB, u);
  const safe = f.startsWith(PUB);
  if (!safe || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(s);
});

function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    let id = 0; const pending = new Map(), errors = [];
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    };
    ws.onerror = () => rej(new Error('websocket failed'));
    ws.onopen = () => res({ errors, send: (method, params = {}) => new Promise((rs, rj) => { const i = ++id; pending.set(i, { res: rs, rej: rj }); ws.send(JSON.stringify({ id: i, method, params })); }) });
  });
}

(async () => {
  await new Promise(r => server.listen(HTTP, '127.0.0.1', r));
  if (process.argv.includes('--serve')) { console.log(`http://127.0.0.1:${HTTP}/simulation4/`); return; }
  const shots = process.argv[2];
  if (shots) fs.mkdirSync(shots, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sim4-verify-'));
  const chrome = spawn(CHROME, [`--remote-debugging-port=${DBG}`, '--headless=new', `--user-data-dir=${profile}`, '--window-size=1500,900', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 50 && !target; i++) { await wait(250); try { target = (await (await fetch(`http://127.0.0.1:${DBG}/json`)).json()).find(t => t.type === 'page'); } catch (e) {} }
  const c = await connect(target.webSocketDebuggerUrl);
  await c.send('Runtime.enable'); await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 880, deviceScaleFactor: 1, mobile: false });
  const ev = async x => { const r = await c.send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || x); return r.result.value; };
  const shot = async n => { if (!shots) return; const r = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shots, n + '.png'), Buffer.from(r.data, 'base64')); };
  const clickAt = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) { await c.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }); await wait(40); } await wait(250); };
  const click = async sel => { const p = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`); await clickAt(p.x, p.y); };
  const load = async h => {
    await c.send('Page.navigate', { url: 'about:blank' }); await wait(100);
    await c.send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/simulation4/index.html${h}` });
    for (let i = 0; i < 240; i++) { await wait(250); if (await ev('document.body && document.body.dataset.ready === "1"')) break; }
    await wait(800);
  };
  const txt = sel => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||""`);
  // Python's "{:.0%}" rounds a half to even (0.625 is 62%), and the builder writes with it.
  const pc = v => { const x = v * 100, f = Math.floor(x); return (Math.abs(x - f - 0.5) < 1e-9 ? (f % 2 ? f + 1 : f) : Math.round(x)) + '%'; };
  // 19 Nov: Sim 4 places level sensors by greedy only. L is Greedy: average (the map's default), LW Greedy: worst case (step 5c).
  const L = k => X.ladder[k - 1], LW = k => X.ladder_worst[k - 1];
  const kd = v => '$' + Math.floor(v / 1000) + 'k', K0 = 1, REC = X.recommend;
  const HO = k => X.held_out.find(h => h.k === k);
  // Unseen weather as every page quotes it: each wet case scored by sensors chosen without it, averaged over the cases.
  const UAVG = k => Object.values(X.held_out_by_case).reduce((a, v) => a + v[String(k)], 0) / Object.keys(X.held_out_by_case).length;
  const UAVGW = k => Object.values(X.held_out_by_case_worst).reduce((a, v) => a + v[String(k)], 0) / Object.keys(X.held_out_by_case_worst).length;

  await load('');
  ok('page loads, no exception', c.errors.length === 0, c.errors[0]);
  ok('starts on step 1', (await txt('#stepN')).startsWith('Step 1 of 6'), await txt('#stepN'));
  const layout = await ev(`(()=>{const v=e=>e&&e.offsetParent!==null||e&&getComputedStyle(e).position==='fixed'&&!e.hidden;
    const can=document.querySelector('#stage canvas').getBoundingClientRect();
    const card=document.querySelector('#card').getBoundingClientRect();
    return {full:can.width>=innerWidth-1&&can.height>=innerHeight-1, cardShare:card.width*card.height/(innerWidth*innerHeight),
      controls:[...document.querySelectorAll('button,input,select,a')].filter(e=>e.getClientRects().length).map(e=>e.id||e.tagName)}})()`);
  ok('the map fills the whole screen', layout.full);
  const clutter = await ev(`[...document.querySelectorAll('.labels .lbl.scale,.labels .lbl.outlet')].filter(e=>getComputedStyle(e).display!=='none').length`);
  ok("the map code's own scale and outlet labels are hidden", clutter === 0, clutter);
  ok('the only controls are Back, Next, Behind this step, Explore, the map controls ? and Light or Dark (no Hide)', layout.controls.sort().join() === 'back,btnExplore,btnMapHelp,btnNotes,next,themeBtn', layout.controls.join());
  ok('19 Nov: the map opens straight down, north up', await ev('Growth3D.isTop()'));
  ok('the card leaves the map clear', layout.cardShare < .22, pc(layout.cardShare));

  // Walk every step with the Next button
  const steps = await ev('window.SIM4.steps.map(s=>({id:s.id,n:s.n,title:s.title,body:s.body,slider:!!s.slider,k:s.k||0,list:s.list||""}))');
  ok('six numbered steps', new Set(steps.map(s => s.n)).size === 6 && steps.length === 8);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    ok(`step ${s.id}: title and body shown`, (await txt('#stepTitle')) === s.title && (await txt('#stepBody')) === s.body);
    ok(`step ${s.id}: under 65 words`, s.body.split(/\s+/).length <= 65, s.body.split(/\s+/).length);
    const sl = await ev('document.querySelector("#homes").getClientRects().length>0');
    ok(`step ${s.id}: slider only on step 3`, sl === s.slider);
    // 18 Nov: the step's text, its slider and its legend show as the step opens, with every fold shut, never inside one.
    const vis = await ev(`(()=>{const card=document.querySelector('#card').getBoundingClientRect(), n=document.querySelector('#notes');
      const seen=e=>{if(!e||!e.getClientRects().length)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=card.top-1&&r.bottom<=Math.min(card.bottom,innerHeight)+1&&r.left>=0&&r.right<=innerWidth+1&&!n.contains(e)};
      return {notesShut:n.hidden, body:seen(document.querySelector('#stepBody')), slider:seen(document.querySelector('#homes')),
        legend:[...document.querySelectorAll('#legend span')].map(seen), legendN:document.querySelectorAll('#legend span').length}})()`);
    const wantLegend = (await ev(`(window.SIM4.steps[${i}].legend||[]).length`));
    ok(`step ${s.id}: text${s.slider ? ', slider' : ''} and legend in view with the folds shut`, vis.notesShut && vis.body && (!s.slider || vis.slider) && vis.legend.every(Boolean) && (!wantLegend || vis.legendN > 0), JSON.stringify(vis));
    // 18 Nov: wide and short. At 1500 px the card is at least 1200 px wide, at most 185 px tall with the fold shut, and
    // needs no scrollbar, so the map shows below it.
    const size = await ev(`(()=>{const c=document.querySelector('#card'),r=c.getBoundingClientRect();return{w:Math.round(r.width),h:Math.round(r.height),scroll:c.scrollHeight>c.clientHeight+1}})()`);
    ok(`step ${s.id}: card wide and short (w >= 1200, h <= 185, no scrollbar)`, size.w >= 1200 && size.h <= 185 && !size.scroll, JSON.stringify(size));
    const sens = await ev('Sim4.sensors()');
    ok(`step ${s.id}: ${s.k} sensors on the map${s.list === 'worst' ? ', Greedy: worst case' : ''}`, sens.length === s.k && (!s.k || sens.join() === (s.list === 'worst' ? LW(s.k) : L(s.k)).chosen.join()), sens.join());
    if (s.slider) await wait(4000);
    await wait(500);
    await shot(`step_${s.id}`);
    if (i < steps.length - 1) await click('#next');
  }
  ok('Next stops at the last step', await ev('document.querySelector("#next").disabled'));

  // The words against the numbers
  const by = id => steps.find(s => s.id === id).body;
  const fb = X.facts.before_growth;
  ok('step 2 quotes the surcharged counts', by('2').includes(String(fb['Design wet'].surcharged) + ' manholes') && by('2').includes(String(fb['Beyond design'].surcharged)));
  const nDW = X.universe['Design wet'], dw1 = Math.round(L(1).design_wet * nDW);
  ok('step 5a quotes the first level sensor on Design wet and on average', by('5a').includes(dw1 === nDW ? `all ${nDW}` : `${dw1} of the ${nDW} design wet growth runs`) && by('5a').includes(pc(L(1).average)) && by('5a').includes(pc(L(1).worst) + ' in the worst case'));
  ok('step 5c quotes Greedy: worst case at the recommended count', by('5c').includes(pc(LW(REC).worst)) && by('5c').includes(pc(LW(REC).average)) && by('5c').includes(`${LW(REC).warned_target} of ${X.warn_universe.target} overloads`));
  ok('step 5b quotes the five', by('5b').includes(pc(L(REC).average)) && by('5b').includes(pc(L(REC).worst)) && by('5b').includes(`${L(REC).warned_target} overloads`));
  ok('step 5b quotes unseen weather as the average over the cases, and says so', by('5b').includes(pc(UAVG(REC))) && /averaged by case/.test(by('5b')) && !by('5b').includes(pc(HO(REC).weather_runs[0] / HO(REC).weather_runs[1]) + '.'));
  ok('step 6 quotes the costs', by('6').includes(kd(X.price.level)) && by('6').includes(kd(REC * X.price.level)) && by('6').includes('assumed') && /bought in stages/.test(by('6')));
  ok('no word claims an overflow prediction', !steps.some(s => /overflows? (will|predicted)|predict/i.test(s.body)));

  // The slider
  await load('#step=3&still=1');
  const atLevels = await ev(`[0,1,2,3,4,5].map(l=>{const g=Sim4.growthState(l),v=Object.values(g.named);return{was:v.filter(x=>x==='was').length,rise:v.filter(x=>x==='rise').length,tip:v.filter(x=>x==='tip').length,labels:g.labels.map(a=>a.text)}})`);
  const surNow = X.facts.before_growth['Design wet'].surcharged, newSur = /no manhole newly surcharges/.test(by('3')) ? 0 : null;
  ok(`slider 0%: only the ${surNow} already surcharged`, atLevels[0].was === surNow && atLevels[0].rise === 0 && atLevels[0].tip === 0);
  ok('slider 100%: newly surcharged as step 3 says', atLevels[5].tip === newSur, JSON.stringify(atLevels[5]).slice(0, 150));
  ok('rising manholes never shrink as homes are added', atLevels.every((a, i) => !i || a.rise + a.tip + a.was >= atLevels[i - 1].rise + atLevels[i - 1].tip + atLevels[i - 1].was), atLevels.map(a => a.rise).join());
  const full = atLevels[5].labels.join(' ');
  ok('labels give each region\'s full-build-out rise', atLevels[5].labels.length === 9 && atLevels[5].labels.every(l => /^R[1-9]: up to \+\d+ mm$/.test(l)), full);
  const sl = await ev(`(()=>{const r=document.querySelector('#homes').getBoundingClientRect();return{x:r.x,w:r.width,y:r.y+r.height/2}})()`);
  await clickAt(sl.x + sl.w * 0.4, sl.y);
  const lv = await ev('Sim4.state.level');
  ok('a real click moves the slider', lv === 2, lv);
  ok('the slider text says what it means', /25% of each region's 2041 homes/.test(await txt('#homesOut')), await txt('#homesOut'));
  await shot('step_3_at_25');

  // The sweep on entering step 3
  await load('#step=2');
  // Recorded in the page every frame from the moment step 3 shows, so a slow headless renderer cannot skip a level between two reads.
  // The sweep is timed (3.2 s for six levels), so a software renderer whose frames take longer than a level's share
  // jumps levels; then only the order and the end are checked, and the frame gap is reported.
  await ev(`(()=>{ window.__lv = []; window.__t = []; const f = now => { if (Sim4.step().id === '3') { window.__lv.push(Sim4.state.level); window.__t.push(now); } if (window.__lv.length < 2000) requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`);
  await click('#next');
  await wait(4200);
  // The first frame of step 3 can still show the level the card was built with, before the sweep's first tick sets 0.
  const lvAll = await ev('window.__lv'), tt = await ev('window.__t'), seen = lvAll.includes(0) ? lvAll.slice(lvAll.indexOf(0)) : lvAll;
  const gap = Math.max(0, ...tt.slice(1).map((v, i) => v - tt[i])), slow = gap > 3200 / 6;
  ok(`entering step 3 sweeps the homes up to 100%${slow ? ` (frames ${Math.round(gap)} ms apart here, so levels skip)` : ''}`,
     seen[seen.length - 1] === 5 && seen.every((v, i) => !i || v >= seen[i - 1]) && (slow || new Set(seen).size >= 3), [...new Set(seen)].join());
  await load('#step=2');
  await click('#next');
  await wait(300);
  const bar = await ev(`(()=>{const r=document.querySelector('#homes').getBoundingClientRect();return{x:r.x,w:r.width,y:r.y+r.height/2}})()`);
  await clickAt(bar.x + bar.w * 0.6, bar.y);
  const held = await ev('Sim4.state.level');
  await wait(3600);
  const later = await ev('Sim4.state.level');
  ok('touching the slider stops the sweep where the click put it', held < 5 && later === held && await ev('+document.querySelector("#homes").value') === held, `${held} ${later}`);

  // Popups, by real clicks where each sensor is on screen
  // Waits for that sensor's popup: a slow headless renderer can take a while to handle the click.
  // The map may still be easing into place under the card when the page reports ready, so a click that opened nothing
  // is tried again from the manhole's new position.
  const clickSensor = async n => { for (let tries = 0; tries < 3; tries++) { const p = await ev(`Growth3D.screenOf(${JSON.stringify(n)})`); await clickAt(p.x, p.y);
    for (let i = 0; i < 14 && !(await txt('#pop')).includes(n); i++) await wait(150); if ((await txt('#pop')).includes(n)) break; await wait(600); } await wait(200); };
  await load('#step=5a');
  for (const [i, n] of L(K0).chosen.entries()) {
    await clickSensor(n);
    const t = await txt('#pop'), p = D.popups[String(K0)][i];
    ok(`5a: click ${n} opens its popup`, t.includes(`Level sensor ${i + 1} of ${K0}`) && t.includes(n), t.split('\n')[0]);
    ok(`5a: ${n} popup speaks of Design wet`, t.includes(`Design wet falls from ${pc(L(1).design_wet)}`) && t.includes(p.lost) && t.includes(p.listens) && t.includes(p.reacts));
    if (i === 0) await shot('popup_5a');
  }
  // 20 Nov (dry run, 36:44 to 41:31): region labels read as sensor sites when they sat on a central manhole. They now sit
  // at the network's edge with a dashed leader into the region, clear of every sensor pin and of each other.
  for (const h of ['#step=4', '#step=5b']) {
    await load(h); await wait(800);
    const L = await ev(`(()=>{const pins=[...document.querySelectorAll('.labels .lbl.sensor')].filter(e=>e.offsetParent).map(e=>e.getBoundingClientRect());
      return {st:RegionLabels.state(), pins:pins.map(b=>({l:b.left,t:b.top,r:b.right,b:b.bottom})), old:[...document.querySelectorAll('.labels .lbl.region')].filter(e=>e.style.display!=='none'&&e.style.visibility!=='hidden').length}})()`);
    const ov = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    ok(`${h}: 9 region labels shown, none of them on the map's own label layer`, L.st.length === 9 && L.st.every(x => x.shown) && L.old === 0, JSON.stringify(L.st.map(x => x.text)));
    ok(`${h}: no region label covers a sensor pin`, L.st.every(x => L.pins.every(p => !ov(x.box, p))));
    ok(`${h}: no two region labels overlap`, L.st.every((x, i) => L.st.every((y, j) => i === j || !ov(x.box, y.box))));
    ok(`${h}: each label sits away from its region's centre manhole, with a leader to the region`,
      L.st.every(x => x.anchor && x.end && Math.hypot((x.box.l + x.box.r) / 2 - x.anchor.x, (x.box.t + x.box.b) / 2 - x.anchor.y) > 40));
  }
  {
    const steps = await ev('window.SIM4.steps.map(s=>({id:s.id,title:s.title,body:s.body}))');
    const bare = steps.filter(s => /(?<!level )\bsensors?\b/i.test(s.title + ' ' + s.body));
    ok('20 Nov: the story says "level sensor", never a bare "sensor" (KK 41:57)', bare.length === 0, bare.map(s => s.id).join(' '));
  }
  await load('#step=5b');
  const pops = {};
  const COVERED = `(()=>{const b=document.querySelector('#pop');if(b.hidden)return[];const r=b.getBoundingClientRect();return Sim4.sensors().filter(m=>{const p=Growth3D.screenOf(m);return p&&p.x>r.left-6&&p.x<r.right+6&&p.y>r.top-6&&p.y<r.bottom+6})})()`;
  for (const [i, n] of L(5).chosen.entries()) {
    // Close the last popup first: it can sit over the next sensor (see below), and a click on it is not a click on the map.
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await wait(200);
    await clickSensor(n);
    const t = await txt('#pop'); pops[n] = t;
    const sw = X.swaps['5'][n];
    ok(`5b: click ${n} opens its popup`, t.includes(`Level sensor ${i + 1} of 5`) && t.includes(n), t.split('\n')[0]);
    ok(`5b: ${n} has the three plain lines`, /Listens to/.test(t) && /First reacts/.test(t) && /Without it/.test(t));
    ok(`5b: ${n} quotes what is lost`, t.includes(`from ${pc(L(5).worst)} to ${pc(sw.without_worst)}`), t.match(/Worst.*/)?.[0]);
    const r = await ev(`(()=>{const r=document.querySelector('#pop').getBoundingClientRect(),c=document.querySelector('#card').getBoundingClientRect();return{on:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}})()`);
    ok(`5b: ${n} popup stays on screen`, r.on);
    // 19 Nov: the box docks in a corner free of sensors, so it never covers one (before, S1's box covered S2 and S5).
    const covered = await ev(COVERED);
    ok(`5b: ${n} popup hides no sensor`, covered.length === 0, covered.join());
    await shot(`popup_5_${i + 1}`);
  }
  const [s1, s2, s3, s4, s5] = L(5).chosen;
  // Abraham's case (19 Nov): S1, then S3, then S1, each a real click on the map with the box left open, each landing.
  {
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await wait(200);
    const seq = [], pos = [];
    for (const n of [s1, s3, s1]) {
      // The map eases into place once the box opens: click the manhole where it settles, as a person would.
      let p = await ev(`Growth3D.screenOf(${JSON.stringify(n)})`);
      for (let i = 0; i < 20; i++) { await wait(150); const q = await ev(`Growth3D.screenOf(${JSON.stringify(n)})`); if (Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5) break; p = q; }
      await clickAt(p.x, p.y);
      for (let i = 0; i < 14 && !(await txt('#pop')).includes(n); i++) await wait(150);
      seq.push((await txt('#pop')).includes(n) && (await ev(COVERED)).length === 0);
      pos.push(await ev(`(()=>{const r=document.querySelector('#pop').getBoundingClientRect();return Math.round(r.left)+','+Math.round(r.top)})()`));
    }
    ok('5b: S1, S3, S1 clicked in turn with the box open: every click lands, no sensor covered', seq.every(Boolean), seq.join());
    ok('5b: the box swaps its words in place (it does not move between sensors)', pos[0] === pos[1] && pos[1] === pos[2], pos.join(' / '));
    const pinSeq = [];
    for (const lbl of ['S3', 'S1', 'S3']) {
      const n = L(5).chosen[+lbl.slice(1) - 1];
      const at = () => ev(`(()=>{const e=[...document.querySelectorAll('.labels .lbl.sensor')].find(e=>e.textContent===${JSON.stringify(lbl)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      // The map eases into place once the box opens: tap the pin where it settles, as a person would.
      let p = await at();
      for (let i = 0; i < 20; i++) { await wait(150); const q = await at(); if (Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5) break; p = q; }
      await clickAt(p.x, p.y);
      for (let i = 0; i < 10 && !(await txt('#pop')).includes(n); i++) await wait(150);
      pinSeq.push((await txt('#pop')).includes(n));
    }
    ok('5b: the pins themselves are clickable (S3, S1, S3)', pinSeq.every(Boolean), pinSeq.join());
    await shot('popup_dock_s1_s3_s1');
  }
  ok('every 5b popup carries its data, word for word', D.popups['5'].every(p => pops[p.name].includes(p.listens) && pops[p.name].includes(p.reacts) && pops[p.name].includes(p.lost) && (!p.note || pops[p.name].includes(p.note))));
  ok('a sensor whose region needs none says it is there for flow passing through', D.popups['5'].filter(p => /flow passing through/.test(p.note)).every(p => /flow passing through/.test(pops[p.name])));
  ok('wetter-weather sensors say so', D.popups['5'].filter(p => /wetter weather only/i.test(p.listens)).every(p => /wetter weather only/i.test(pops[p.name])) && D.popups['5'].some(p => /wetter weather only/i.test(p.listens)));
  ok('no popup names a leave region as the reason it listens', !D.popups['5'].some(p => !/wetter weather only/i.test(p.listens) && Object.entries(X.triage).some(([r, v]) => v.action === 'leave' && new RegExp('\\b' + r + '\\b').test(p.listens))));

  // Clearing it
  const corner = { x: 40, y: 860 };
  await clickSensor(s2); await wait(100);
  await clickAt(corner.x, corner.y);
  ok('a click on empty ground closes the popup', await ev('document.querySelector("#pop").hidden'));
  await clickSensor(s2);
  await click('#next');
  ok('moving step closes the popup', await ev('document.querySelector("#pop").hidden'));

  // Keyboard, Back, deep link
  await load('#step=4');
  ok('deep link lands on the step', (await txt('#stepN')).startsWith('Step 4 of 6'));
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await wait(200);
  ok('right arrow goes forward, and the link follows', (await txt('#stepTitle')) === steps[4].title && (await ev('location.hash')) === '#step=5a', await ev('location.hash'));
  await click('#back');
  ok('Back goes back', (await txt('#stepN')).startsWith('Step 4 of 6'));

  // Expert is gone (14 Nov): Explore is the place to play, and each card has its fold
  ok('no Expert on the page', await ev('!document.querySelector("#btnExpert") && !document.querySelector("#expert") && !window.Sim4Play'));
  ok('Explore is a link to explore.html', await ev('document.querySelector("#btnExplore").getAttribute("href")') === 'explore.html');
  await click('#btnNotes');
  const notes = await txt('#notes');
  ok('a real click opens "Behind this step", with Assumes, Source, Limit and Next', /Assumes/.test(notes) && /Source/.test(notes) && /Limit/.test(notes) && /Next/.test(notes) && await ev('!document.querySelector("#notes").hidden'));
  ok('it links the redo guide at this step', await ev('document.querySelector("#notes a.redo").getAttribute("href")') === 'redo.html#step-4');
  await click('#btnNotes');
  ok('a second click closes it', await ev('document.querySelector("#notes").hidden'));
  await load('#step=5b&notes=1&figs=1');
  const n5 = await txt('#notes');
  ok('5b: the fold says other sets score the same (stand-ins), not chosen for Dry or 150%/300%', /stand-ins/.test(n5) && /150%/.test(n5) && /300%/.test(n5) && /Dry/.test(n5), n5.slice(0, 160));
  await shot('fold_5b');
  {
    await load('#step=5b');
    const W = D.steps.find(s => s.id === '5b').why, R5 = L(REC), W5 = LW(REC);
    ok('5b: one visible line says they can be bought in stages without moving one', /bought in stages without moving one/.test(await txt('#stepBody')));
    ok('5b: "Greedy: average, Greedy: worst case or Exact optimum?" is a button closed by default', await txt('#btnWhy') === 'Greedy: average, Greedy: worst case or Exact optimum?' && await ev('document.querySelector("#why").hidden') && await ev('document.querySelector("#btnWhy").getAttribute("aria-expanded")') === 'false');
    const card0 = await ev('document.querySelector("#card").getBoundingClientRect().height');
    const shift0 = await ev('getComputedStyle(document.documentElement).getPropertyValue("--map-shift")');
    await click('#btnWhy'); await wait(300);
    const w = await txt('#why');
    const cell = r => `${pc(r.worst)} / ${pc(r.average)}, ${r.warned_target} of ${X.warn_universe.target}`;
    ok('5b: a real click opens it, both greedy lists side by side at every count', !(await ev('document.querySelector("#why").hidden')) && X.ladder.every((r, i) => w.includes(cell(r)) && w.includes(cell(X.ladder_worst[i]))), w.slice(0, 120));
    ok('5b: it leads with the reason: neither moves a level sensor, so either can be bought in stages', /never move one, so either can be bought in stages/.test(W.intro) && W.intro.indexOf('stages') < 90);
    // 20 Nov: Exact optimum beside them, the comparison: numbers.json's exact_* at every count, and how many sensors it moves.
    const xcell = r => `${pc(r.exact_worst)} / ${pc(r.exact_average)}`;
    const xrows = await ev('[...document.querySelectorAll("#why tr")].slice(1).map(r=>[...r.cells].map(c=>c.textContent))');
    const moved = X.ladder.map((r, i) => i ? String(X.ladder[i - 1].exact_set.filter(m => !r.exact_set.includes(m)).length) : 'n/a');
    ok('5b: the fold has Exact optimum at every count (numbers.json) and the sensors it moves from the size before',
       xrows.length === X.ladder.length && xrows.every((c, i) => c[3].startsWith(xcell(X.ladder[i])) && c[4] === moved[i]), JSON.stringify(xrows.map(c => c.slice(3))) + ' want moved ' + moved.join());
    ok('5b: the fold says Exact optimum is the comparison and cannot be bought in stages without moving sensors', /Exact optimum, the comparison/.test(W.intro) && /cannot be bought in stages without moving level sensors/.test(W.intro), W.intro);
    ok('5b: the open fold lies over the map rather than moving it', await ev('getComputedStyle(document.documentElement).getPropertyValue("--map-shift")') === shift0, shift0);
    await shot('why_5b');
    await click('#btnWhy'); await wait(200);
    ok('5b: a second click closes it', await ev('document.querySelector("#why").hidden') && Math.abs(await ev('document.querySelector("#card").getBoundingClientRect().height') - card0) < 2);
    await load('#step=5a');
    ok('5a: no such button on other steps', await ev('document.querySelector("#btnWhy").hidden'));
  }

  // 19 Nov (third pass): an open "Behind this step" runs down to 16 px above the screen's bottom, inside the card
  {
    const fold = async () => ev(`(()=>{const c=document.querySelector('#card'),n=document.querySelector('#notes'),cr=c.getBoundingClientRect(),nr=n.getBoundingClientRect();
      return{shown:!n.hidden,nb:Math.round(nr.bottom),cb:Math.round(cr.bottom),gap:Math.round(innerHeight-cr.bottom),cardScroll:c.scrollHeight>c.clientHeight+1,foldScroll:n.scrollHeight>n.clientHeight+1,h:Math.round(nr.height)}})()`);
    await load('#step=3&still=1');
    await click('#btnNotes'); await wait(500);
    await ev('document.querySelector("#more").open = true'); await wait(500);     // with "More on this step" open the words need more than the screen
    const f3 = await fold();
    ok('notes: a real click opens it down to 16 px above the bottom, inside the card, the card itself not scrolling', f3.shown && Math.abs(f3.gap - 16) <= 2 && f3.nb <= f3.cb && !f3.cardScroll && f3.foldScroll && f3.h > 500, JSON.stringify(f3));
    await shot('notes_tall');
    await click('#btnNotes'); await wait(300);
    const shut = await ev(`(()=>{const r=document.querySelector('#card').getBoundingClientRect();return{h:Math.round(r.height),mh:document.querySelector('#notes').style.maxHeight}})()`);
    ok('notes: closed again, the card is short as before', shut.h <= 185 && shut.mh === '', JSON.stringify(shut));
    await load('#step=1&notes=1');
    const f1 = await fold();
    ok('notes: a short fold is only as tall as its words, and never runs past the card', f1.shown && f1.nb <= f1.cb && !f1.cardScroll && f1.gap >= 14, JSON.stringify(f1));
  }
  // 19 Nov (third pass): the map controls card, from a ? in the top-right corner
  {
    await load('#step=2');
    const hp = await ev(`(()=>{const b=document.querySelector('#btnMapHelp'),t=document.querySelector('#themeBtn').getBoundingClientRect(),r=b.getBoundingClientRect();return{lab:b.getAttribute('aria-label'),row:!!b.closest('#corner')&&Math.abs(r.right-t.right)<2&&r.width>0,pop:!!document.querySelector('#btnMapHelpPop')}})()`);
    ok('map help: a ? in the corner with Explore and Light or Dark, labelled Map controls', hp.lab === 'Map controls' && hp.row && hp.pop, JSON.stringify(hp));
    const bx = await ev(`(()=>{const r=document.querySelector('#btnMapHelp').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bx.x, y: bx.y, button: 'none' }); await wait(400);
    const hov = await ev(`(()=>{const p=document.querySelector('#btnMapHelpPop'),r=p.getBoundingClientRect(),b=document.querySelector('#btnMapHelp').getBoundingClientRect(),cd=document.querySelector('#card').getBoundingClientRect();
      return{shown:!p.hidden,w:Math.round(r.width),fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,clearBtn:r.top>=b.bottom||r.bottom<=b.top,t:p.innerText}})()`);
    ok('map help: hovering opens the card (about 360 px, on screen, clear of its button)', hov.shown && hov.w >= 340 && hov.w <= 380 && hov.fits && hov.clearBtn, JSON.stringify({ ...hov, t: undefined }));
    ok('map help: the controls named as the map has them', /Left click/.test(hov.t) && /Drag to turn/.test(hov.t) && /Right click/.test(hov.t) && /Drag to move/.test(hov.t) && /Scroll/.test(hov.t) && /two fingers/.test(hov.t));
    await shot('maphelp_story');
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 600, button: 'none' }); await wait(500);
    ok('map help: moving away closes it', await ev('document.querySelector("#btnMapHelpPop").hidden'));
    await click('#btnMapHelp'); await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 600, button: 'none' }); await wait(500);
    const pinned = await ev('!document.querySelector("#btnMapHelpPop").hidden');
    await clickAt(700, 600); await wait(300);
    ok('map help: a click keeps it open; a click elsewhere closes it', pinned && await ev('document.querySelector("#btnMapHelpPop").hidden'), pinned);
  }
  // 19 Nov (third pass): step 6 says greenfield is the next piece of work, with its coverage in a fold
  {
    await load('#step=6');
    const b6 = await txt('#stepBody');
    const W6 = D.steps.find(s => s.id === '6').why;
    ok('6: one visible line: new estates at the edge (greenfield) are the next piece of work', /New estates at the (network's )?edge \(greenfield\)/.test(b6) && /next piece of work/.test(b6), b6.slice(-120));
    ok('6: one visible line: level sensors, not floats, and why', /Level sensors, not floats: a float only switches at one height/.test(b6), b6);
    ok('6: "New estates at the edge" is a fold closed by default', await txt('#btnWhy') === 'New estates at the edge' && await ev('document.querySelector("#why").hidden'));
    await click('#btnWhy'); await wait(300);
    const w6 = await txt('#why'), gf5 = D.steps.find(s => s.id === '5b').notes.limit.match(/these \w+ see (\d+%) of growth runs on average and (\d+%) in the worst/);
    ok("6: the fold gives today's five on greenfield growth, the figures step 5b's limit quotes (average, worst)", gf5 && w6.includes(gf5[1] + ' of the growth runs on average') && w6.includes(gf5[2] + ' in the worst wet case'), gf5 && gf5.slice(1).join(' '));
    ok("6: it links Explore's Greenfield view", await ev('document.querySelector("#why .gfLink a").getAttribute("href")') === 'explore.html#fam=one&view=expert');
    ok('6: no client named, and slide 3 still says infill only', !/SA Water|important to|the client/i.test(W6.intro + W6.table + b6) && /Infill only/.test(JSON.stringify(D.steps.find(s => s.id === '3'))));
    await shot('why_6');
  }

  // Source links (19 Nov): every cited source in the team's paper library opens there, in a new tab
  {
    eval(fs.readFileSync(path.join(PUB, 'simulation4/library.js'), 'utf8'));
    const LIB = window.SIM4_LIBRARY;
    const href = id => LIB.url(LIB.papers.find(p => p.key === id));
    const links = async () => ev(`[...document.querySelectorAll('#notes a.lib, #why a.lib')].map(a=>({t:a.textContent,h:a.getAttribute('href'),tg:a.target,r:a.rel}))`);
    await load('#step=4&notes=1');
    const A = await links(), n4 = await txt('#notes');
    ok('step 4: the 0.7 limit credited to Kimbrough (2019), linked at the cited page, a risk signal not a design standard',
      A.some(a => a.t === 'Kimbrough (2019)' && a.h === href('kimbrough2019') && /page=87/.test(a.h)) && /risk signal, not a design standard/.test(n4) && /cut-offs and the error: team assumption/.test(n4), JSON.stringify(A).slice(0, 160));
    const seen = [];
    for (const s of D.steps) { await load(`#step=${s.id}&notes=1&more=1`); seen.push(...(await links()).map(a => ({ ...a, step: s.id }))); }
    ok('every source link opens the library viewer in a new tab, rel=noopener', seen.length >= 5 && seen.every(a => a.h.startsWith(LIB.viewer + '?paper=') && a.tg === '_blank' && a.r === 'noopener'), seen.length);
    ok('the links: Do 2023 (31), Kim 2022 (58), EPA SWMM 5 (SATYA-GL-01), Kimbrough 2019 (ASHIS-GL-17)',
      ['31', '58', 'SATYA-GL-01', 'ASHIS-GL-17'].every(id => seen.some(a => a.h.includes('?paper=' + encodeURIComponent(id) + '&'))), [...new Set(seen.map(a => a.h.split('&')[0].split('=')[1]))].join(','));
    ok("no link carries the utility's name; unlisted sources stay plain text", !seen.some(a => /SA\s*Water/i.test(decodeURIComponent(a.h))) && !seen.some(a => /PlanSA|ABS|Barwon/.test(a.t)));
    const redo = fs.readFileSync(path.join(PUB, 'simulation4/redo.html'), 'utf8');
    const rl = [...redo.matchAll(/<a class="lib" href="([^"]+)" target="_blank" rel="noopener"/g)].map(m => m[1].replace(/&amp;/g, '&'));
    ok('redo guide: Do, Kim, Kimbrough and SWMM link to the same library pages as the story', [href('do2023'), href('kim2022'), href('kimbrough2019'), href('swmm')].every(h => rl.includes(h)), rl.length);
  }

  // "More on this step" (19 Nov): the product demo's items, closed by default, figures from the data
  {
    const stepsWithMore = D.steps.filter(s => s.notes && s.notes.more).map(s => s.id);
    ok('"More on this step" on steps 1, 2, 3, 5a, 5b and 6', JSON.stringify(stepsWithMore) === JSON.stringify(['1', '2', '3', '5a', '5b', '6']), stepsWithMore.join());
    await load('#step=1&notes=1');
    ok('it is closed by default', await ev('!!document.querySelector("#more") && !document.querySelector("#more").open'));
    await ev('document.querySelector("#more").open = true'); await wait(200);
    let m = await txt('#more');
    eval(fs.readFileSync(path.join(PUB, 'simulation4/data/regions.js'), 'utf8'));
    eval(fs.readFileSync(path.join(PUB, 'simulation3/data/catchment.js'), 'utf8'));
    const R = window.SIM3_REGIONS, G = window.GROWTH_GEOM, nPipes = G.nPipes, nMh = +D.steps[0].body.match(/(\d+) manholes/)[1];
    ok("1: network figures are the data's (council homes, model homes, pipes, manholes)",
      m.includes(R.councilConnections.toLocaleString('en-AU')) && m.includes(G.baseDwellings.toLocaleString('en-AU')) && m.includes(`${nPipes}\npipes`) && m.includes(`${nMh}\nmanholes`), `${nPipes} ${nMh}`);
    ok('1: Have / Assumed / Missing, with no greenfield row', /Have, from public layers/.test(m) && /Missing/.test(m) && !/greenfield/i.test(m));
    const nPaths = await ev('document.querySelectorAll("#more svg.pipemap path").length');
    ok('1: every pipe is drawn, coloured by flow / capacity first', nPaths === nPipes && await ev('document.querySelector("#more [data-by=util]").getAttribute("aria-pressed")') === 'true', nPaths);
    const bandSum = () => ev('[...document.querySelectorAll("#more .band b")].reduce((a,b)=>a+ +b.textContent,0)');
    const b0 = await bandSum();
    await ev('document.querySelector("#more [data-by=material]").scrollIntoView({block:"center"})'); await wait(200);
    await click('#more [data-by=material]'); await wait(200);
    ok('1: a real click on Material recolours; the bands add up to the pipe count each time', b0 === nPipes && await bandSum() === nPipes && await ev('document.querySelector("#more [data-by=material]").getAttribute("aria-pressed")') === 'true', b0);
    await load('#step=2&notes=1&more=1');
    const cut = D.more.cutaway;
    ok("2: the cutaway is sensor S1's manhole, opening on Design wet, today", cut.manhole === L(1).chosen[0] && await ev('document.querySelector("#more select").selectedOptions[0].textContent') === 'Design wet' && /Today/.test(await txt('#more .slide')));
    const r0 = Object.keys(cut.homes)[0];
    await ev(`(()=>{const i=document.querySelector('#more input[type=range]');i.value=i.max;i.dispatchEvent(new Event('input'))})()`); await wait(150);
    const want = cut.cases[0].base + cut.cases[0].rise[r0][cut.steps.length - 1];
    ok("2: at 100% the shaft shows the model's water depth for that region's homes", (await txt('#more .slide')).includes('100%') && await ev(`document.querySelector('#more .cutSvg svg').getAttribute('aria-label')`).then(s => s.includes(`water ${Math.round(want)} mm`)), want);
    await load('#step=5b&notes=1&more=1');
    m = await txt('#more');
    ok("5b: S1 alone, case by case, is step 5a's one-sensor score", Object.values(L(1).per_case).every(v => m.includes(pc(v))));
    const trs = await ev('[...document.querySelectorAll("#more tr")].map(r=>r.innerText)');
    const aRow = trs.find(r => /^Greedy: average/.test(r)) || '', wRow = trs.find(r => /^Greedy: worst case/.test(r)) || '';
    const rowOk = (row, r, u) => row.includes(pc(r.worst)) && row.includes(pc(r.average)) && row.includes(`${r.warned_target} of ${X.warn_universe.target}`) && row.includes(pc(u));
    ok("5b: the Greedy: average row = numbers.json (worst, average, warned) and the case-average unseen weather", rowOk(aRow, L(REC), UAVG(REC)), aRow);
    ok("5b: the Greedy: worst case row = numbers.json's ladder_worst and its own unseen weather", rowOk(wRow, LW(REC), UAVGW(REC)), wRow);
    const xRow = trs.find(r => /^Exact optimum/.test(r)) || '';
    ok("5b: the Exact optimum row = numbers.json's exact set at five (worst, average)", xRow.includes(pc(L(REC).exact_worst)) && xRow.includes(pc(L(REC).exact_average)), xRow);
    ok("5b: no other placement method in the comparison: the two greedy lists, Exact optimum, two desk baselines and random", !trs.some(r => /^(Nested|Warn|Risk)/.test(r)), trs.filter(r => /^(Nested|Warn|Risk)/.test(r)).join(' | '));
    ok('5b: both greedy lists are "chosen on this test"; random is 500 draws, a different measure', /chosen on this test/.test(m) && /500 draws/.test(m) && /different measure/.test(m));
    const lim5b = D.steps.find(s => s.id === '5b').notes.limit, gf = lim5b.match(/these \w+ see (\d+%) of growth runs on average and (\d+%) in the worst/);
    await load('#step=6&notes=1&more=1');
    m = await txt('#more');
    ok('6: sensor types, and how sure we are, with the greenfield figures step 5b quotes', /Ultrasonic level/.test(m) && /Float switch/.test(m) && /need from you/i.test(m) && gf && m.includes(gf[1]) && m.includes(gf[2]), gf && gf.slice(1).join(' '));
    ok('6: at most two blocks added', D.steps.find(s => s.id === '6').notes.more.blocks.length <= 2);
    await load('#step=3&notes=1&more=1');
    ok('3: the cross-check marks the recommended sensors and gives the rank agreement', await ev('document.querySelectorAll("#more svg.xc circle.s").length') === REC && /ρ = 0\.\d\d/.test(await txt('#more')));
  }

  // Words anywhere on the page
  const all = await ev(`document.querySelector('#card').innerText+document.querySelector('#notes').textContent+JSON.stringify(window.SIM4.popups)+JSON.stringify(window.SIM4.steps)`);
  ok('no em or en dash anywhere', !/[\u2014\u2013]/.test(all));
  ok('no mention of the old five-sensor figures on the story (step 5c may quote Greedy: worst case\'s own)', !steps.some(s => /80%|86%|90%/.test(s.body.replace(s.id === '5c' ? pc(LW(REC).worst) : '\u0000', ''))));
  ok('19 Nov: greedy, with Exact optimum only as the comparison: no nested list, beam search, design-day seed or tied sets in the story', !/nested list|beam search|exact best|exact solver|sets tie|tie for best|design day is right/i.test(all));
  ok('20 Nov: Exact optimum is named in the story only as the comparison, never as the plan', !/recommend[^.]*Exact optimum|Exact optimum[^.]*recommend/i.test(all) && /Exact optimum/.test(all));
  ok('no client or suburb name in the words', !/SA Water|Walkerville|Rostrevor|Stonyfell|Woodforde|Malvern|Bolivar/i.test(all));
  ok('no private source: no meeting date, prices called assumed', !/28 Sep|confidential/i.test(all) && /assumed/.test(all));

  // Light or dark (18 Nov): Explore's switch, its wording, and its storage key, so the choice carries between the two pages
  const px = async (x, y) => {   // one screen pixel, read from a 1x1 PNG
    const r = await c.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: 1, height: 1, scale: 1 } });
    const b = Buffer.from(r.data, 'base64'); let o = 8, idat = [];
    while (o < b.length) { const n = b.readUInt32BE(o), t = b.toString('ascii', o + 4, o + 8); if (t === 'IDAT') idat.push(b.slice(o + 8, o + 8 + n)); o += 12 + n; }
    const raw = require('zlib').inflateSync(Buffer.concat(idat)); return [raw[1], raw[2], raw[3]];
  };
  const lum = ([r, g, b]) => (r * 299 + g * 587 + b * 114) / 1000;
  const theme = () => ev('document.documentElement.dataset.theme');
  const cssOf = (sel, prop) => ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)}))[${JSON.stringify(prop)}]`);
  await ev('localStorage.removeItem("sim4Theme")');
  await load('#step=4');
  const ground = [Math.round(innerW() * 0.06), 860];
  function innerW() { return 1500; }
  const offers = () => ev('document.querySelector("#themeBtn").getAttribute("aria-label")');
  const iconShown = () => ev(`[...document.querySelectorAll('#themeBtn svg')].filter(s=>getComputedStyle(s).display!=='none').map(s=>s.getAttribute('class')).join()`);
  ok('theme: dark by default, and the icon button offers light (a sun)', await theme() === 'dark' && /light theme/.test(await offers()) && await iconShown() === 'sun' && (await txt('#themeBtn')).trim() === '');
  const darkGround = await px(...ground), darkCard = await cssOf('#card', 'backgroundColor');
  await click('#themeBtn'); await wait(700);
  const lightGround = await px(...ground);
  ok('theme: a real click turns it light, and the button then offers dark (a moon)', await theme() === 'light' && /dark theme/.test(await offers()) && await iconShown() === 'moon');
  // 19 Nov: warm paper, not white: the ground and the card are off-white
  ok('theme: light is warm paper (ground #f3f0e8 as the map, card #fbf9f4)', await cssOf('body', 'backgroundColor') === 'rgb(243, 240, 232)' && /rgba?\(251, 249, 244/.test(await cssOf('#card', 'backgroundColor')), await cssOf('#card', 'backgroundColor'));
  ok("theme: kept under Explore's own key", await ev('localStorage.getItem("sim4Theme")') === 'light' && /localStorage\.getItem\("sim4Theme"\)/.test(fs.readFileSync(path.join(PUB, 'simulation4/explore_ui.js'), 'utf8')));
  ok("theme: the map's ground turns light", lum(darkGround) < 60 && lum(lightGround) > 200, darkGround + ' -> ' + lightGround);
  ok('theme: the card, its text and the fold turn light', (await cssOf('#card', 'backgroundColor')) !== darkCard && lum((await cssOf('#stepBody', 'color')).match(/\d+/g).map(Number)) < 80);
  const pills = await ev(`[...document.querySelectorAll('.rlabels .rlbl')].filter(e=>e.style.display!=='none').map(e=>getComputedStyle(e).color)`);
  ok("theme: the map's region labels keep dark text on their colour", pills.length > 0 && pills.every(c => c === 'rgb(4, 20, 10)'), pills.slice(0, 3).join(' '));
  await load('#step=3&still=1');
  ok('theme: a new visit keeps the choice', await theme() === 'light' && await iconShown() === 'moon');
  {
    await c.send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/simulation4/explore.html` });
    let et = null;
    for (let i = 0; i < 240 && !et; i++) { await wait(250); et = await ev('document.querySelector("#sensorList") && document.querySelector("#sensorList").innerText.length > 50 ? document.documentElement.dataset.theme : null'); }
    ok("theme: Explore opens in the story's choice", et === 'light', et);
  }
  await load('#step=3&still=1');
  const riseDot = await ev(`[...document.querySelectorAll('#legend span')].filter(s=>/Rises/.test(s.textContent)).map(s=>getComputedStyle(s.querySelector('i')).backgroundColor)[0]`);
  ok("theme: the legend's rise colour is the light map's", riseDot === 'rgb(201, 154, 0)', riseDot);
  await click('#btnNotes'); await wait(300);
  ok('theme: the fold and its tables are light', lum((await cssOf('#notes dd', 'color')).match(/\d+/g).map(Number)) < 80);
  await load('#step=4&theme=dark');
  ok('theme: #theme=dark in the link wins over the stored choice', await theme() === 'dark' && await iconShown() === 'sun');
  await click('#themeBtn'); await wait(300); await click('#themeBtn'); await wait(300);
  ok('theme: switching back to dark is kept', await ev('localStorage.getItem("sim4Theme")') === 'dark' && await theme() === 'dark');
  ok('theme: no exception while switching', c.errors.length === 0, c.errors[0]);

  // The landing page (19 Nov): its title and tabs on one row, and one sun/moon switch in that row for the page and for
  // Sim 4's story and Explore inside it, whose own switches hide there.
  const loadLanding = async h => {
    await c.send('Page.navigate', { url: 'about:blank' }); await wait(100);
    await c.send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/index.html${h}` });
    for (let i = 0; i < 240; i++) { await wait(250); if (await ev(`(()=>{const f=document.querySelector('#pane-sim4 iframe');try{return f.contentDocument.body.dataset.ready==='1'||!!(f.contentDocument.querySelector('#sensorList')&&f.contentDocument.querySelector('#sensorList').innerText.length>50)}catch(e){return false}})()`)) break; }
    await wait(1500);
  };
  const inFrame = x => ev(`(()=>{const w=document.querySelector('#pane-sim4 iframe').contentWindow,d=w.document;return (${x})})()`);
  await ev('localStorage.removeItem("sim4Theme")');
  await loadLanding('#sim4/story');
  const head = await ev(`(()=>{const h=document.querySelector('header.top').getBoundingClientRect(),b=document.querySelector('header.top .brand').getBoundingClientRect(),t=document.querySelector('#tabs').getBoundingClientRect(),s=document.querySelector('#themeToggle').getBoundingClientRect();
    return{h:Math.round(h.height),oneRow:t.top<b.bottom&&b.top<t.bottom&&s.top<b.bottom,right:Math.round(innerWidth-s.right)}})()`);
  ok('landing: the title, the tabs and the light/dark switch share one row', head.oneRow && head.h <= 60, JSON.stringify(head));
  ok('landing: the switch is an icon (a sun while dark), with a label', await ev(`[...document.querySelectorAll('#themeToggle svg')].filter(s=>getComputedStyle(s).display!=='none').map(s=>s.getAttribute('class')).join()`) === 'sun' &&
     /light theme/.test(await ev('document.querySelector("#themeToggle").getAttribute("aria-label")')) && (await txt('#themeToggle')).trim() === '');
  ok("landing: the story's own switch hides inside it", await inFrame('d.querySelector("#themeBtn").hidden'));
  await shot('landing_dark');
  await click('#themeToggle'); await wait(900);
  ok('landing: a real click turns the page light (warm paper) and keeps it', await ev('document.documentElement.dataset.theme') === 'light' && await ev('localStorage.getItem("sim4Theme")') === 'light' && await cssOf('body', 'backgroundColor') === 'rgb(244, 241, 234)');
  ok('landing: the story inside turns light with it', await inFrame('d.documentElement.dataset.theme') === 'light');
  await shot('landing_light_story');
  await loadLanding('#sim4/explore');
  ok('landing: Explore inside opens light, its own switch hidden', await inFrame('d.documentElement.dataset.theme') === 'light' && await inFrame('d.querySelector("#themeBtn").hidden'));
  ok('landing: one sun/moon only: Explore\'s own switch takes no space there', await inFrame('d.querySelector("#themeBtn").getClientRects().length') === 0);
  await click('#themeToggle'); await wait(900);
  ok('landing: the header switch turns Explore inside dark (this fixes Explore having no switch there)', await inFrame('d.documentElement.dataset.theme') === 'dark' && await ev('document.documentElement.dataset.theme') === 'dark');
  await shot('landing_dark_explore');
  ok('landing: no exception', c.errors.length === 0, c.errors[0]);

  // Narrow screen
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true });
  await loadLanding('#sim4/story');
  const headP = await ev(`(()=>{const s=document.querySelector('#themeToggle').getBoundingClientRect(),h=document.querySelector('header.top').getBoundingClientRect();return{fit:document.documentElement.scrollWidth<=innerWidth&&s.right<=innerWidth&&s.left>=0,h:Math.round(h.height)}})()`);
  ok('phone width: the landing header fits, the switch on screen, the tabs wrapping under the title', headP.fit && headP.h < 150, JSON.stringify(headP));
  await shot('landing_phone');
  await load('#step=5b');
  const narrow = await ev(`(()=>{const r=document.querySelector('#card').getBoundingClientRect();return{fit:r.left>=0&&r.right<=innerWidth,bottom:r.bottom,h:innerHeight,scroll:document.documentElement.scrollWidth<=innerWidth}})()`);
  ok('phone width: the card fits', narrow.fit && narrow.scroll);
  ok('phone width: the card leaves map to see', narrow.bottom < narrow.h * .62, Math.round(narrow.bottom));
  {
    await wait(800);
    const L = await ev(`(()=>{const pins=[...document.querySelectorAll('.labels .lbl.sensor')].filter(e=>e.offsetParent).map(e=>e.getBoundingClientRect());
      return {st:RegionLabels.state(), pins:pins.map(b=>({l:b.left,t:b.top,r:b.right,b:b.bottom}))}})()`);
    const ov = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    ok('phone width: region labels on screen, clear of the pins and of each other',
      L.st.length === 9 && L.st.every(x => x.box.l >= 0 && x.box.r <= 390 && L.pins.every(q => !ov(x.box, q))) && L.st.every((x, i) => L.st.every((y, j) => i === j || !ov(x.box, y.box))));
  }
  const corners = await ev(`(()=>{const c=document.querySelector('#card').getBoundingClientRect();return ['#btnExplore','#btnMapHelp','#themeBtn'].map(s=>document.querySelector(s).getBoundingClientRect()).map(r=>({in:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,clear:r.top>=c.bottom}))})()`);
  ok("phone width: Explore, the map controls ? and Light or Dark fit, clear of the card", corners.every(x => x.in && x.clear), JSON.stringify(corners));
  {
    await load('#step=3&still=1&notes=1');
    const pn = await ev(`(()=>{const c=document.querySelector('#card'),cr=c.getBoundingClientRect(),n=document.querySelector('#notes').getBoundingClientRect(),k=document.querySelector('#corner').getBoundingClientRect();
      return{nb:Math.round(n.bottom),cb:Math.round(cr.bottom),corner:Math.round(k.top),cardScroll:c.scrollHeight>c.clientHeight+1,h:Math.round(n.height)}})()`);
    ok('phone width: an open fold runs down to the foot of the card, above Explore and the switch', pn.nb <= pn.cb && pn.cb <= pn.corner && !pn.cardScroll && pn.h > 300, JSON.stringify(pn));
    await shot('phone_notes');
  }
  const phoneMiss = [];
  for (const sx of steps) {
    await load('#step=' + sx.id + '&still=1');
    const v = await ev(`(()=>{const card=document.querySelector('#card').getBoundingClientRect(), n=document.querySelector('#notes');
      const seen=e=>{if(!e||!e.getClientRects().length)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=card.top-1&&r.bottom<=Math.min(card.bottom,innerHeight)+1&&r.left>=0&&r.right<=innerWidth+1&&!n.contains(e)};
      return n.hidden&&seen(document.querySelector('#stepBody'))&&(document.querySelector('#sliderRow').hidden||seen(document.querySelector('#homes')))&&[...document.querySelectorAll('#legend span')].every(seen)})()`);
    if (!v) phoneMiss.push(sx.id);
  }
  ok('phone width: every step shows its text, slider and legend with the folds shut', phoneMiss.length === 0, phoneMiss.join());
  await shot('phone_5b');
  {
    await load('#step=5b'); await wait(1200);     // the map eases into place under the card after the page is ready
    // On a phone the manholes of S1 and S3 are a few pixels apart, so the pins themselves (the S1, S3 labels) are clicked.
    const [p1, , p3] = L(5).chosen, seq = [];
    for (const n of [p1, p3, p1]) {
      const lbl = 'S' + (L(5).chosen.indexOf(n) + 1);
      const at = () => ev(`(()=>{const e=[...document.querySelectorAll('.labels .lbl.sensor')].find(e=>e.textContent===${JSON.stringify(lbl)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      // The map eases into place once the box opens: tap the pin where it settles, as a person would.
      let p = await at();
      for (let i = 0; i < 20; i++) { await wait(150); const q = await at(); if (Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5) break; p = q; }
      await clickAt(p.x, p.y);
      for (let i = 0; i < 14 && !(await txt('#pop')).includes(n); i++) await wait(150);
      await wait(400);
      seq.push((await txt('#pop')).includes(n));
    }
    const sheet = await ev(`(()=>{const b=document.querySelector('#pop').getBoundingClientRect(),c=document.querySelector('#card').getBoundingClientRect(),e=document.querySelector('#btnExplore').getBoundingClientRect();
      return{bottom:b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth&&b.top>=c.bottom,explore:!document.querySelector('#corner').getClientRects().length}})()`);
    const cov = await ev(`(()=>{const b=document.querySelector('#pop');const r=b.getBoundingClientRect();return Sim4.sensors().filter(m=>{const p=Growth3D.screenOf(m);return p&&p.x>r.left&&p.x<r.right&&p.y>r.top&&p.y<r.bottom})})()`);
    ok('phone width: the pins S1, S3, S1 tapped in turn: every tap lands', seq.every(Boolean), seq.join());
    ok('phone width: the box is a sheet along the bottom, below the card; Explore and the switch step aside while it is open', sheet.bottom && sheet.explore, JSON.stringify(sheet));
    ok('phone width: the sheet covers no sensor (the map moves up above it)', cov.length === 0, cov.join());
    await shot('phone_sheet');
    await click('#popX'); await wait(400);
    ok('phone width: closing the sheet brings Explore back', await ev('document.querySelector("#pop").hidden && document.querySelector("#corner").getClientRects().length > 0'));
  }

  ok('no exception in the whole run', c.errors.length === 0, c.errors[0]);
  console.log(`\n${pass} passed, ${fail} failed`);
  try { chrome.kill(); } catch (e) {}
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
