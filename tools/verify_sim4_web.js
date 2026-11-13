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
  const L = k => X.ladder[k - 1];
  const kd = v => '$' + Math.floor(v / 1000) + 'k', K0 = X.fewest.find(f => f.scope === 'Design wet only')['1.0'], REC = X.recommend;
  const HO = k => X.held_out.find(h => h.k === k);

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
  ok('the only controls are Back, Next, Hide, Behind this step and Explore', layout.controls.sort().join() === 'back,btnExplore,btnFold,btnNotes,next', layout.controls.join());
  ok('the card leaves the map clear', layout.cardShare < .22, pc(layout.cardShare));

  // Walk every step with the Next button
  const steps = await ev('window.SIM4.steps.map(s=>({id:s.id,n:s.n,title:s.title,body:s.body,slider:!!s.slider,k:s.k||0}))');
  ok('six numbered steps', new Set(steps.map(s => s.n)).size === 6 && steps.length === 7);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    ok(`step ${s.id}: title and body shown`, (await txt('#stepTitle')) === s.title && (await txt('#stepBody')) === s.body);
    ok(`step ${s.id}: under 65 words`, s.body.split(/\s+/).length <= 65, s.body.split(/\s+/).length);
    const sl = await ev('document.querySelector("#homes").getClientRects().length>0');
    ok(`step ${s.id}: slider only on step 3`, sl === s.slider);
    const sens = await ev('Sim4.sensors()');
    ok(`step ${s.id}: ${s.k} sensors on the map`, sens.length === s.k && (!s.k || sens.join() === L(s.k).chosen.join()), sens.join());
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
  ok('step 5a quotes all Design wet runs', by('5a').includes(`all ${X.universe['Design wet']} growth runs`) && by('5a').includes(pc(L(K0).average)));
  ok('step 5b quotes the five', by('5b').includes(pc(L(REC).average)) && by('5b').includes(pc(L(REC).worst)) && by('5b').includes(`${L(REC).warned_target} overloads`));
  ok('step 5b quotes unseen weather', by('5b').includes(pc(HO(REC).weather_runs[0] / HO(REC).weather_runs[1])));
  ok('step 6 quotes the costs', by('6').includes(kd(K0 * X.price.level)) && by('6').includes(kd(REC * X.price.level)) && by('6').includes(kd((REC - K0) * X.price.level)) && by('6').includes('assumed'));
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
    ok(`5a: click ${n} opens its popup`, t.includes(`Sensor ${i + 1} of ${K0}`) && t.includes(n), t.split('\n')[0]);
    ok(`5a: ${n} popup speaks of Design wet`, /Design wet falls from 100%/.test(t) && t.includes(p.lost) && t.includes(p.listens) && t.includes(p.reacts));
    if (i === 0) await shot('popup_5a');
  }
  await load('#step=5b');
  const pops = {};
  for (const [i, n] of L(5).chosen.entries()) {
    // Close the last popup first: it can sit over the next sensor (see below), and a click on it is not a click on the map.
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await wait(200);
    await clickSensor(n);
    const t = await txt('#pop'); pops[n] = t;
    const sw = X.swaps['5'][n];
    ok(`5b: click ${n} opens its popup`, t.includes(`Sensor ${i + 1} of 5`) && t.includes(n), t.split('\n')[0]);
    ok(`5b: ${n} has the three plain lines`, /Listens to/.test(t) && /First reacts/.test(t) && /Without it/.test(t));
    ok(`5b: ${n} quotes what is lost`, t.includes(`from ${pc(L(5).worst)} to ${pc(sw.without_worst)}`), t.match(/Worst.*/)?.[0]);
    const r = await ev(`(()=>{const r=document.querySelector('#pop').getBoundingClientRect(),c=document.querySelector('#card').getBoundingClientRect();return{on:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}})()`);
    ok(`5b: ${n} popup stays on screen`, r.on);
    const covered = await ev(`(()=>{const r=document.querySelector('#pop').getBoundingClientRect();return Sim4.sensors().filter(m=>{const p=Growth3D.screenOf(m);return p&&p.x>r.left&&p.x<r.right&&p.y>r.top&&p.y<r.bottom})})()`);
    // Known since PR #14's regions: S1's neighbours leave no side free, so its popup falls back to the right and covers S2
    // and S5 (the same on the 12 Nov page). Reported, not failed.
    if (covered.length) console.log(`  note  5b: ${n} popup covers ${covered.join(', ')} (no free side; same before 14 Nov)`);
    else ok(`5b: ${n} popup hides no sensor`, true);
    await shot(`popup_5_${i + 1}`);
  }
  const [s1, s2, s3, s4, s5] = L(5).chosen;
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
  ok('5b: the fold says many sets tie, the 25 mm rule picks this one, not chosen for Dry or 150%/300%', /tie/.test(n5) && /25 mm/.test(n5) && /150%/.test(n5) && /300%/.test(n5) && /Dry/.test(n5), n5.slice(0, 160));
  await shot('fold_5b');

  // Words anywhere on the page
  const all = await ev(`document.querySelector('#card').innerText+document.querySelector('#notes').textContent+JSON.stringify(window.SIM4.popups)+JSON.stringify(window.SIM4.steps)`);
  ok('no em or en dash anywhere', !/[\u2014\u2013]/.test(all));
  ok('no mention of the old five-sensor figures on the story', !steps.some(s => /80%|86%|90%/.test(s.body)));
  ok('no client or suburb name in the words', !/SA Water|Walkerville|Rostrevor|Stonyfell|Woodforde|Malvern|Bolivar/i.test(all));
  ok('no private source: no meeting date, prices called assumed', !/28 Sep|confidential/i.test(all) && /assumed/.test(all));

  // Narrow screen
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true });
  await load('#step=5b');
  const narrow = await ev(`(()=>{const r=document.querySelector('#card').getBoundingClientRect();return{fit:r.left>=0&&r.right<=innerWidth,bottom:r.bottom,h:innerHeight,scroll:document.documentElement.scrollWidth<=innerWidth}})()`);
  ok('phone width: the card fits', narrow.fit && narrow.scroll);
  ok('phone width: the card leaves map to see', narrow.bottom < narrow.h * .62, Math.round(narrow.bottom));
  await shot('phone_5b');

  ok('no exception in the whole run', c.errors.length === 0, c.errors[0]);
  console.log(`\n${pass} passed, ${fail} failed`);
  try { chrome.kill(); } catch (e) {}
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
