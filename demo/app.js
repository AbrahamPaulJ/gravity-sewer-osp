/* Product demo: one live map of the network and eleven views in four chapters (Problem, Approach, Results, Next).
   Every figure comes from Simulation 4's data, or is recomputed here from Sim 4's runs with Sim 4's own rules:
     simulation3/data/catchment.js  GROWTH_GEOM   the network: pipes (with Manning capacity), manholes, homes
     simulation3/data/growth.js     GROWTH_RUNS   manhole names, by index
     simulation4/data/regions.js    SIM3_REGIONS  Sim 4's regions and every run: rise at every manhole; risk weights
     simulation4/data/sim4.js       SIM4          Sim 4's plan, triage and tables
     demo/data/compare.js           DEMO_COMPARE  placement methods, built by tools/build_demo_data.js with this engine
   Recomputed figures match Sim 4's published ones (checked: 16 of 16, 0%/53%, 81%/94%, 8 and 11 of 11 warned).
   No client, suburb or street names in the words: the repository is public. */
const App = (() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const G = () => window.GROWTH_GEOM, R = () => window.GROWTH_RUNS, S = () => window.SIM3_REGIONS, D = () => window.SIM4, C = () => window.DEMO_COMPARE;
  const COL = {
    pipe: "#34445f", home: "#2a3650", was: "#ffa500", rise: "#fff176", tip: "#ff2d55", spill: "#ff3df5",
    monitor: "#ff5c7a", watch: "#ffa500", leave: "#3b4b68", sensor: "#2ef56b", accent: "#38bdf8", failed: "#6f81a3", sim4: "#7dd8ff",
  };
  const SEQ = ["#2c4f80", "#4f86c6", "#9fd3ff", "#ffd166", "#ff9f43", "#ff5c7a", "#ff3df5"];
  const REGION_COLS = { R1: "#3987e5", R2: "#d95926", R3: "#20a320", R4: "#e87ba4", R5: "#199e70", R6: "#39c5cf", R7: "#b08457", R8: "#9085e9", R9: "#c9d1d9" };
  // [id, short name, title], grouped in chapters
  const CHAPTERS = [
    ["Problem", [["setting", "Setting", "Growth uses up the pipes"], ["network", "Network", "What we know about the network"]]],
    ["Approach", [["approach", "End to end", "Our approach, end to end"], ["simulate", "Simulate", "Simulate the growth"], ["insights", "What the runs show", "Where the water rises"], ["algorithms", "Place sensors", "Turning runs into sensor sites"]]],
    ["Results", [["compare", "Compare", "How good is each placement?"], ["check", "Cross-check", "Does basic hydraulics agree?"], ["sensors", "Sensor types", "What to install"]]],
    ["Next", [["repeat", "Repeat", "Run the method yourself"], ["future", "Next research", "Where this goes next"], ["conclude", "Conclusion", "What we recommend"]]],
  ];
  const SECTIONS = CHAPTERS.flatMap(([ch, v]) => v.map(x => [...x, ch]));
  const RULES = [10, 25, 50];
  const PRICE = 25000, PRICE_NOTE = "assumed prices, not quotes";

  // ------------------------------------------------------------------ data helpers
  let idx = {}, chNode = [], paint, H = {};
  const nameOf = i => R().chambers[i];
  const regionId = ri => S().regions[ri].id;
  const regionIndex = id => S().regions.findIndex(r => r.id === id);
  const caseOf = tag => S().cases.find(c => c.tag === tag);
  const caseLabel = tag => caseOf(tag).label;
  const caseShort = tag => caseLabel(tag).replace("Design wet + age-weighted I&I", "Design + old pipes leak more").replace("Beyond design + age-weighted I&I", "Beyond + old pipes leak more")
    .replace("Design wet + outside inflow x1.5", "Design + inflow ×1.5").replace("Beyond design + outside inflow x1.5", "Beyond + inflow ×1.5");
  const caseTiny = tag => caseLabel(tag).replace("Design wet", "DW").replace("Beyond design", "BD").replace(" + age-weighted I&I", "+age").replace(" + outside inflow x1.5", "+in").replace("Severe", "Sev");
  const wetTags = () => S().cases.filter(c => c.ii > 0).map(c => c.tag);
  const allTags = () => S().cases.map(c => c.tag);
  const stepsTo = max => S().ladder.map((v, s) => s).filter(s => S().ladder[s] <= max);
  const FULL = () => S().ladder.indexOf(1);
  const pct = x => x == null || isNaN(x) ? "–" : Math.round(x * 100) + "%";
  const money = v => "$" + Math.round(v / 1000) + "k";
  const list = a => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
  const regionLabel = ri => S().regions[ri].overlay ? regionId(ri) + " (corridor)" : regionId(ri);
  const sim4Targets = () => D().explore.targets.map(regionIndex);
  const rowAt = (tag, r, s) => S().rows[tag].find(x => x.r === r && x.s === s);
  const riseAt = (row, i) => row ? ((row.rise.find(([j]) => j === i) || [])[1] || 0) : 0;
  const baseMm = (tag, i) => S().base[tag].depthMm[i];
  const stepLabel = s => s < 0 ? "Today" : S().ladder[s] > 1 ? `${S().ladder[s] * 100}% (stress)` : `${Math.round(S().ladder[s] * 100)}%`;
  function table(title) {
    for (const s of D().steps) for (const f of (s.notes.figures || [])) if (f.title.includes(title)) {
      const doc = new DOMParser().parseFromString(f.table, "text/html");
      return { intro: f.intro || "", rows: [...doc.querySelectorAll("tr")].map(tr => [...tr.children].map(td => td.textContent.trim())) };
    }
    throw new Error("No Sim 4 figure titled " + title);
  }
  const tcol = (t, name, from = 0) => t.rows[0].indexOf(name, from);
  const trow = (t, first) => t.rows.find(r => r[0] === String(first));

  // ------------------------------------------------------------------ the engine: Sim 4's scoring, on any choice
  // A run is one region's homes at one build-out step in one weather case. It is "noticeable" if some manhole rises
  // 10 mm or more (o.den), and "seen" if one of the sensors rises by the sensor rule (o.mm). Keeping the denominator at
  // 10 mm when the rule is stricter is Sim 4's own convention. Shares are per weather case; worst and average across them.
  // o.w (optional) weights each run, e.g. by risk; Sim 4's own scoring weights every run 1.
  const seenCache = new Map();
  function seenSet(row, mm) {
    let m = seenCache.get(row); if (!m) seenCache.set(row, m = {});
    return m[mm] || (m[mm] = new Set(row.rise.filter(([, v]) => v >= mm).map(([i]) => i)));
  }
  function score(set, o) {
    const steps = stepsTo(1), per = [];
    let warnable = 0, warned = 0;
    for (const tag of o.cases) {
      let n = 0, hit = 0;
      for (const r of o.regions) {
        const rows = steps.map(s => rowAt(tag, r, s));
        rows.forEach((x, s) => { if (seenSet(x, o.den || 10).size) { const w = o.w ? o.w(tag, r, steps[s]) : 1; n += w; const ss = seenSet(x, o.mm); if (set.some(i => ss.has(i))) hit += w; } });
        // Overload warned: a sensor rises one build-out step before the first new surcharge (Sim 4's rule).
        const k = rows.findIndex(x => x.sur.length);
        if (k > 0 && seenSet(rows[k - 1], o.den || 10).size) { warnable++; if (set.some(i => seenSet(rows[k - 1], o.mm).has(i))) warned++; }
      }
      per.push({ tag, n, hit, share: n ? hit / n : 1 });
    }
    const counted = per.filter(c => c.n);
    return {
      per, warnable, warned,
      worst: counted.length ? Math.min(...counted.map(c => c.share)) : 1,
      avg: counted.length ? counted.reduce((t, c) => t + c.share, 0) / counted.length : 1,
    };
  }
  const key = (sc, aim) => aim === "avg" ? sc.avg * 1e6 + sc.worst * 1e3 + sc.warned : sc.worst * 1e6 + sc.avg * 1e3 + sc.warned;
  function gains(set, o) { return R().chambers.map((n, i) => set.includes(i) ? null : score([...set, i], o)); }
  function greedy(o, k, start = []) {
    const set = [...start], steps = [];
    while (set.length < k) {
      const g = gains(set, o); let best = -1, bk = -Infinity;
      g.forEach((sc, i) => { if (sc) { const v = key(sc, o.aim); if (v > bk) { bk = v; best = i; } } });
      if (best < 0) break;
      set.push(best); steps.push(g[best]);
    }
    return { set, gains: steps };
  }
  // Each weather case scored with sensors chosen without it.
  function unseenWeather(o, k) {
    if (o.cases.length < 2) return null;
    const shares = o.cases.map(tag => {
      const pick = greedy({ ...o, cases: o.cases.filter(t => t !== tag) }, k).set;
      const sc = score(pick, { ...o, cases: [tag] });
      return sc.per[0].n ? sc.per[0].share : null;
    }).filter(x => x !== null);
    return shares.reduce((t, x) => t + x, 0) / shares.length;
  }
  const SIM4_TEST = () => ({ cases: wetTags(), regions: sim4Targets(), mm: 10, aim: "worst" });
  const ladderIdx = k => (D().explore.ladder[k - 1] || []).map(n => R().chambers.indexOf(n));
  // The recommendation: the exact best-coverage set at each count (Sim 4's exact solver: worst case, then average, then
  // overloads warned). Sensors are numbered by how much is lost if each one fails, so Sensor 1 matters most.
  const planCache = {};
  function planIdx(k) {
    if (planCache[k]) return planCache[k];
    const set = (D().explore.exact[k - 1] || []).map(n => R().chambers.indexOf(n)), o = SIM4_TEST();
    const loss = i => { const w = score(set.filter(j => j !== i), o); return -(w.worst * 1e3 + w.avg); };
    return (planCache[k] = set.slice().sort((a, b) => loss(b) - loss(a)));
  }
  const worstFailure = (set, o) => set.length < 2 ? (set.length ? 0 : null) : Math.min(...set.map(i => score(set.filter(j => j !== i), o).worst));
  // Risk weight of a run, from Sim 4's risk definition (severity x likelihood, 1 to 90).
  const riskW = (tag, r, s) => { const v = S().ladder[s]; const k = regionId(r) + "|" + (Number.isInteger(v) ? v.toFixed(1) : String(v)); return (S().riskWeights[tag] && S().riskWeights[tag][k] || { w: 1 }).w; };

  // What one sensor does, for its card.
  function sensorWhy(i, set, o) {
    const regs = o.regions.map(r => ({ r, cases: o.cases.filter(tag => stepsTo(1).some(s => seenSet(rowAt(tag, r, s), o.mm).has(i))).length }))
      .filter(x => x.cases).sort((a, b) => b.cases - a.cases);
    let first = null;
    o.regions.forEach(r => stepsTo(1).forEach(s => {
      const row = rowAt(D().design, r, s); if (!row) return;
      const m = riseAt(row, i);
      if (m >= o.mm && (!first || row.dw < first.dw)) first = { r, dw: row.dw, mm: m };
    }));
    return { regs, first, full: score(set, o), without: score(set.filter(j => j !== i), o) };
  }

  // ------------------------------------------------------------------ region painting (Sim 4's own rule)
  function regionPaint() {
    const g = G(), N = g.nodes.length, own = new Array(N).fill(-1), out = g.nodes.map(() => []), inn = g.nodes.map(() => []);
    for (let p = 0; p < g.nPipes; p++) { out[g.up[p]].push(p); inn[g.down[p]].push(p); }
    g.nodes.forEach((nd, a) => { if (nd.kind === "chamber") own[a] = a; });
    for (let a = 0; a < N; a++) {
      if (g.nodes[a].kind !== "chamber") continue;
      const stack = [a];
      while (stack.length) out[stack.pop()].forEach(p => { const d = g.down[p]; if (own[d] < 0 && g.nodes[d].kind === "inline") { own[d] = a; stack.push(d); } });
    }
    for (let a = 0; a < N; a++) {
      if (own[a] >= 0 || g.nodes[a].kind !== "inline") continue;
      const path = [a], seen = new Set(); let cur = a;
      while (own[cur] < 0 && out[cur].length && !seen.has(cur)) { seen.add(cur); cur = g.down[out[cur][0]]; path.push(cur); }
      if (own[cur] >= 0) path.forEach(x => { own[x] = own[cur]; });
    }
    const of = new Array(N).fill(-1), byChamber = {}, overlayOf = new Array(N).fill(-1);
    S().regions.forEach((r, ri) => { if (!r.overlay) r.manholes.forEach(i => { const a = idx[nameOf(i)]; if (byChamber[a] === undefined) byChamber[a] = ri; }); });
    own.forEach((o, a) => { if (o >= 0 && byChamber[o] !== undefined) of[a] = byChamber[o]; });
    S().regions.forEach((r, ri) => {
      if (!r.overlay) return;
      const mine = new Set(r.manholes.map(i => idx[nameOf(i)]));
      own.forEach((o, a) => { if (o >= 0 && mine.has(o)) overlayOf[a] = ri; });
    });
    const centre = S().regions.map((r, ri) => {
      const on = r.overlay ? overlayOf : of, pts = [];
      on.forEach((x, a) => { if (x === ri && g.nodes[a].kind === "chamber") pts.push(a); });
      const cx = pts.reduce((t, a) => t + g.nodes[a].x, 0) / pts.length, cy = pts.reduce((t, a) => t + g.nodes[a].y, 0) / pts.length;
      return pts.reduce((b, a) => Math.hypot(g.nodes[a].x - cx, g.nodes[a].y - cy) < Math.hypot(g.nodes[b].x - cx, g.nodes[b].y - cy) ? a : b, pts[0]);
    });
    return { of, overlayOf, centre, out, inn };
  }
  const pipeRegion = p => { const g = G(); return paint.of[g.up[p]] >= 0 ? paint.of[g.up[p]] : paint.of[g.down[p]]; };
  const inOverlay = p => { const g = G(); return paint.overlayOf[g.up[p]] >= 0 && paint.overlayOf[g.down[p]] >= 0; };
  const regionsOf = i => S().regions.map((r, ri) => ri).filter(ri => S().regions[ri].manholes.includes(i));

  // ------------------------------------------------------------------ hydraulics: a desk screen, no model runs
  // Homes and pipe length upstream of every pipe (flow split evenly where a manhole has two outlets), then
  // estimated peak flow = homes x L/s per home (2.3 people x 200 L/day x peak 2) + leakage x pipe length / 100 m,
  // against Manning full-pipe capacity (the file's pcap; Q = (1/n) A R^(2/3) S^(1/2), checked).
  function hydraulics() {
    const g = G(), N = g.nodes.length, indeg = paint.inn.map(a => a.length), homes = g.nodes.map(n => n.dw || 0), len = new Array(N).fill(0);
    const pH = new Array(g.nPipes).fill(0), pL = new Array(g.nPipes).fill(0), q = [];
    for (let a = 0; a < N; a++) if (!indeg[a]) q.push(a);
    while (q.length) {
      const a = q.shift(), o = paint.out[a];
      o.forEach(p => { pH[p] = homes[a] / o.length; pL[p] = len[a] / o.length + g.plen[p]; const d = g.down[p]; homes[d] += pH[p]; len[d] += pL[p]; if (--indeg[d] === 0) q.push(d); });
    }
    let dist = 0, metres = 0;
    for (let p = 0; p < g.nPipes; p++) { const u = g.nodes[g.up[p]], d = g.nodes[g.down[p]]; dist += Math.hypot(u.x - d.x, u.y - d.y); metres += g.plen[p]; }
    const outPipe = chNode.map(a => paint.out[a][0]);
    return { pH, pL, homesAt: homes, unit: metres / dist, outPipe, lps: R().lpsPerDwelling[1] };
  }
  const flowEst = (p, ii, extra = 0) => (H.pH[p] + extra) * H.lps + ii * H.pL[p] / 100;
  const util = (p, ii, extra = 0) => flowEst(p, ii, extra) / G().pcap[p];
  const nOf = p => (G().manning.byMaterial[G().pmat[p]] || G().manning.fallback);
  // Per-manhole screens, for the cross-check and the desk-study baselines.
  const SCREENS = {
    util: { label: "Flow / capacity (Manning)", v: (i, ii) => H.outPipe[i] != null ? util(H.outPipe[i], ii) : null, fmt: v => pct(v) },
    slope: { label: "Flatness (1 / slope)", v: i => H.outPipe[i] != null ? 1 / Math.max(0.01, G().pslope[H.outPipe[i]]) : null, fmt: v => (100 / v).toFixed(2) + "% slope", note: "Flat pipes carry less and back up sooner." },
    depth: { label: "Depth today (simulated)", v: (i, ii, tag) => H.outPipe[i] != null ? baseMm(tag, i) / G().dia[H.outPipe[i]] : null, fmt: v => v.toFixed(2) + " of pipe height", note: "From the model, before any growth: the one screen here that is not desk-only." },
    homes: { label: "Homes upstream", v: i => H.homesAt[chNode[i]], fmt: v => Math.round(v) + " homes" },
  };
  function targetPool() { const set = new Set(); sim4Targets().forEach(ri => S().regions[ri].manholes.forEach(i => set.add(i))); return [...set].sort((a, b) => a - b); }
  // Rank a pool by a screen, keeping sites at least 150 m apart (a desk study would not put two sensors side by side).
  function screenRank(id, pool, k = 8) {
    const ii = caseOf(D().design).ii, v = i => SCREENS[id].v(i, ii, D().design) ?? -1, g = G();
    const order = pool.slice().sort((a, b) => v(b) - v(a)), out = [];
    for (const i of order) {
      const a = g.nodes[chNode[i]];
      if (out.every(j => { const b = g.nodes[chNode[j]]; return Math.hypot(a.x - b.x, a.y - b.y) * H.unit >= 150; })) out.push(i);
      if (out.length >= k) break;
    }
    return out;
  }
  function spearman(xs, ys) {
    const ok = xs.map((x, k) => x != null && ys[k] != null && isFinite(x) && isFinite(ys[k])), X = xs.filter((x, k) => ok[k]), Y = ys.filter((y, k) => ok[k]);
    const rank = a => { const s = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(a.length); let k = 0; while (k < s.length) { let j = k; while (j + 1 < s.length && s[j + 1][0] === s[k][0]) j++; for (let m = k; m <= j; m++) r[s[m][1]] = (k + j) / 2; k = j + 1; } return r; };
    const rx = rank(X), ry = rank(Y), n = X.length, mx = rx.reduce((t, v) => t + v, 0) / n, my = ry.reduce((t, v) => t + v, 0) / n;
    let a = 0, b = 0, c = 0; for (let k = 0; k < n; k++) { a += (rx[k] - mx) * (ry[k] - my); b += (rx[k] - mx) ** 2; c += (ry[k] - my) ** 2; }
    return { rho: a / Math.sqrt(b * c), n };
  }
  // Largest rise at a manhole at full 2041 build-out, over the regions, in one weather case.
  function responseAt(tag) { const r = new Array(R().chambers.length).fill(0); S().rows[tag].forEach(x => { if (x.s === FULL()) x.rise.forEach(([i, m]) => { if (m > r[i]) r[i] = m; }); }); return r; }

  function prepare() {
    G().nodes.forEach((nd, a) => { idx[nd.name] = a; });
    chNode = R().chambers.map(n => idx[n]);
    paint = regionPaint();
    H = hydraulics();
  }

  // ------------------------------------------------------------------ state
  const st = {
    sec: "setting", sel: null, selPipe: null, hover: null, hoverPipe: null,
    setting: { mh: null, tag: null, s: null, r: null },
    network: { by: "util", bin: null },
    approach: { step: "1", alt: null },
    simulate: { stage: 1, r: null, s: null, tag: null, playing: null },
    insights: { measure: "r10", cases: null, max: 1 },
    algorithms: { method: "exact", k: 5, show: false },
    compare: { k: 5, method: "exact", mm: 10, failed: new Set() },
    check: { screen: "util", tag: null, extra: 0, ii: null },
    sensors: { type: "ultra", water: null, budget: 125 },
    repeat: { regions: null, cases: null, mm: 10, k: 5, aim: "worst", result: null, manual: false, mine: [] },
    future: { alpha: 0.5, risk: null, vsK: 5, r2: 0.8 },
    conclude: { k: 5 },
  };

  // ------------------------------------------------------------------ map: pan, zoom, hover, click
  const cv = () => $("#map");
  const view = { dpr: 1, k: 1, tx: 0, ty: 0, base: null };
  function fitView() {
    const c = cv(), r = c.getBoundingClientRect(), g = G();
    view.dpr = window.devicePixelRatio || 1; c.width = r.width * view.dpr; c.height = r.height * view.dpr;
    const minX = Math.min(...g.px), maxX = Math.max(...g.px), minY = Math.min(...g.py), maxY = Math.max(...g.py), pad = 30;
    const k = Math.min((r.width - 2 * pad) / (maxX - minX), (r.height - 2 * pad) / (maxY - minY));
    view.base = { minX, maxY, k, ox: (r.width - (maxX - minX) * k) / 2, oy: (r.height - (maxY - minY) * k) / 2 };
  }
  function resetView() { view.k = 1; view.tx = 0; view.ty = 0; draw(); }
  const P = (x, y) => { const b = view.base; return [(b.ox + (x - b.minX) * b.k) * view.k + view.tx, (b.oy + (b.maxY - y) * b.k) * view.k + view.ty]; };
  function nearestChamber(mx, my, within = 12) {
    let best = null, bd = within;
    chNode.forEach((a, i) => { const nd = G().nodes[a], [x, y] = P(nd.x, nd.y), d = Math.hypot(x - mx, y - my); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function nearestPipe(mx, my, within = 7) {
    const g = G(); let best = null, bd = within;
    for (let p = 0; p < g.nPipes; p++) for (let v = g.ptr[p]; v < g.ptr[p + 1] - 1; v++) {
      const [x1, y1] = P(g.px[v], g.py[v]), [x2, y2] = P(g.px[v + 1], g.py[v + 1]), dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((mx - x1) * dx + (my - y1) * dy) / L)) : 0, d = Math.hypot(mx - x1 - t * dx, my - y1 - t * dy);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  const picksPipes = () => !!layer().pickPipe;
  function wireMap() {
    const c = cv(); let drag = null, moved = false;
    c.addEventListener("wheel", e => {
      e.preventDefault();
      const r = c.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015);
      const nk = Math.max(0.6, Math.min(14, view.k * f)), ff = nk / view.k;
      view.tx = mx - (mx - view.tx) * ff; view.ty = my - (my - view.ty) * ff; view.k = nk; draw();
    }, { passive: false });
    c.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }; moved = false; c.setPointerCapture(e.pointerId); });
    c.addEventListener("pointermove", e => {
      const r = c.getBoundingClientRect();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.hypot(dx, dy) > 4) moved = true;
        if (moved) { view.tx = drag.tx + dx; view.ty = drag.ty + dy; c.style.cursor = "grabbing"; draw(); return; }
      }
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const h = nearestChamber(mx, my), hp = h === null && picksPipes() ? nearestPipe(mx, my) : null;
      if (h !== st.hover || hp !== st.hoverPipe) { st.hover = h; st.hoverPipe = hp; draw(); }
      h !== null ? showTip(h, e.clientX, e.clientY) : hp !== null ? showPipeTip(hp, e.clientX, e.clientY) : ($("#tip").hidden = true);
      c.style.cursor = h !== null || hp !== null ? "pointer" : "grab";
    });
    c.addEventListener("pointerup", e => {
      const r = c.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      if (!moved) { const i = nearestChamber(mx, my); if (i === null && picksPipes()) onPipeClick(nearestPipe(mx, my)); else onMapClick(i); }
      drag = null; c.style.cursor = "grab";
    });
    c.addEventListener("pointerleave", () => { st.hover = null; st.hoverPipe = null; $("#tip").hidden = true; draw(); });
    $("#zin").onclick = () => zoomBy(1.4); $("#zout").onclick = () => zoomBy(1 / 1.4); $("#zreset").onclick = resetView;
    $("#homesToggle").onchange = draw;
    window.addEventListener("resize", () => { fitView(); draw(); });
  }
  function zoomBy(f) { const r = cv().getBoundingClientRect(), mx = r.width / 2, my = r.height / 2; const nk = Math.max(0.6, Math.min(14, view.k * f)), ff = nk / view.k; view.tx = mx - (mx - view.tx) * ff; view.ty = my - (my - view.ty) * ff; view.k = nk; draw(); }
  // Centre the map on a manhole, keeping the zoom (used by lists of manholes).
  function focus(i) { const r = cv().getBoundingClientRect(), nd = G().nodes[chNode[i]], [x, y] = P(nd.x, nd.y); if (view.k < 2.5) { zoomBy(2.5 / view.k); return focus(i); } view.tx += r.width / 2 - x; view.ty += r.height / 2 - y; draw(); }

  // ------------------------------------------------------------------ drawing
  // Each view supplies a layer: pipe colour and width, manhole styles, labels and legend.
  function draw() {
    if (!view.base) return;
    const c = cv().getContext("2d"), g = G(), L = layer();
    c.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    c.clearRect(0, 0, cv().width, cv().height);
    if ($("#homesToggle").checked) {
      c.fillStyle = L.homes || COL.home; const s = Math.max(1.5, 1.2 * Math.sqrt(view.k));
      for (let h = 0; h < g.hx.length; h++) { const [x, y] = P(g.hx[h], g.hy[h]); c.fillRect(x - s / 2, y - s / 2, s, s); }
    }
    const wscale = Math.min(2.2, Math.sqrt(view.k));
    for (let p = 0; p < g.nPipes; p++) { const [col, w] = L.pipe ? L.pipe(p) : [COL.pipe, 1]; line(c, p, col, w * wscale); }
    if (L.overlayPipe) { c.setLineDash([6, 5]); for (let p = 0; p < g.nPipes; p++) if (inOverlay(p)) { const v = L.overlayPipe(p); if (v) line(c, p, v[0], v[1] * wscale); } c.setLineDash([]); }
    if (st.selPipe !== null && L.pickPipe) line(c, st.selPipe, "#ffffff", 5 * wscale);
    if (st.hoverPipe !== null && L.pickPipe) line(c, st.hoverPipe, "#a9b8d4", 4 * wscale);
    const rs = Math.min(1.8, Math.sqrt(view.k));
    if (L.node) chNode.forEach((a, i) => { const v = L.node(i); if (v) mark(c, g.nodes[a], v, rs); });
    if (st.sel !== null) mark(c, g.nodes[chNode[st.sel]], { ring: "#ffffff", r: 9 }, rs);
    if (st.hover !== null && st.hover !== st.sel) mark(c, g.nodes[chNode[st.hover]], { ring: "#a9b8d4", r: 8 }, rs);
    const labels = (L.labels || []).map(l => { const nd = g.nodes[l.node], [x, y] = P(nd.x, nd.y); return { ...l, x, y }; });
    $("#labels").innerHTML = labels.map(l => `<span class="lbl ${l.cls || ""}" style="left:${l.x}px;top:${l.y}px;${l.bg ? `background:${l.bg}` : ""}">${l.text}</span>`).join("");
    $("#legend").innerHTML = (L.legend || []).map(([c2, t, shape]) => `<span><i class="${shape || ""}" style="${shape === "ring" ? `border-color:${c2}` : shape === "line" ? `background:${c2}` : `background:${c2}`}"></i>${t}</span>`).join("") + (L.scale || "");
    $("#legend").hidden = !(L.legend || []).length && !L.scale;
  }
  function line(c, p, col, w) {
    const g = G(); c.strokeStyle = col; c.lineWidth = w; c.lineCap = "round"; c.beginPath();
    for (let v = g.ptr[p]; v < g.ptr[p + 1]; v++) { const [x, y] = P(g.px[v], g.py[v]); v === g.ptr[p] ? c.moveTo(x, y) : c.lineTo(x, y); }
    c.stroke();
  }
  function mark(c, nd, v, rs) {
    const [x, y] = P(nd.x, nd.y), r = (v.r || 4) * rs;
    if (v.fill) { c.fillStyle = v.fill; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.strokeStyle = "#0b1220"; c.lineWidth = 1.2; c.stroke(); }
    if (v.ring) { c.strokeStyle = v.ring; c.lineWidth = v.rw || 2.2; c.beginPath(); c.arc(x, y, r + (v.fill ? 3 : 0), 0, 7); c.stroke(); }
  }
  const regionLabels = (colour) => S().regions.map((r, ri) => ({ node: paint.centre[ri], text: regionLabel(ri), cls: "region", bg: colour(ri) }));
  const sensorLabels = (set, cls = "sensor") => set.map((i, j) => ({ node: chNode[i], text: String(j + 1), cls }));
  const triagePipe = (dim = false) => p => { const ri = pipeRegion(p); const t = ri >= 0 && D().triage[regionId(ri)]; return t && t !== "leave" ? [COL[t] + (dim ? "88" : ""), 2.2] : [COL.pipe, 1.1]; };
  function riseColour(mm) {
    if (mm >= 10) return COL.rise;
    if (mm >= 5) return "#9fd3ff";
    if (mm >= 2) return "#4f86c6";
    if (mm >= 0.5) return "#2c4f80";
    return null;
  }
  const riseScale = `<div class="scale"><b>Rise in water level</b><span><i style="background:#2c4f80"></i>0.5–2 mm</span><span><i style="background:#4f86c6"></i>2–5</span><span><i style="background:#9fd3ff"></i>5–10</span><span><i style="background:${COL.rise}"></i>10 mm +: noticeable</span></div>`;

  // ------------------------------------------------------------------ tooltips and cards
  const matName = m => ({ VC: "clay", PVCU: "PVC", RC: "concrete" }[m] || m);
  function manholeFacts(i) {
    const g = G(), a = chNode[i], nd = g.nodes[a], p = paint.out[a][0];
    return { name: nameOf(i), nd, regs: regionsOf(i).map(regionLabel), p, dia: p !== undefined ? g.dia[p] : null, mat: p !== undefined ? matName(g.pmat[p]) : null, pyr: p !== undefined ? g.pyr[p] : null };
  }
  function placeTip(t, x, y) { t.hidden = false; const W = window.innerWidth; t.style.left = Math.min(W - 330, x + 14) + "px"; t.style.top = (y + 14) + "px"; }
  function showTip(i, x, y) {
    const t = $("#tip"), f = manholeFacts(i), extra = layer().tip ? layer().tip(i) : "";
    t.innerHTML = `<b>${f.name}</b><span>${f.regs.length ? "Region " + list(f.regs) : "No region"} · ${f.nd.depth != null ? f.nd.depth.toFixed(1) + " m deep" : ""}${f.dia ? ` · ${f.dia} mm ${f.mat} pipe out${f.pyr ? `, laid ${f.pyr}` : ""}` : ""}</span>${extra ? `<em>${extra}</em>` : ""}`;
    placeTip(t, x, y);
  }
  function showPipeTip(p, x, y) {
    const g = G(), t = $("#tip"), extra = layer().pipeTip ? layer().pipeTip(p) : "";
    t.innerHTML = `<b>Pipe ${g.pid[p]}</b><span>${g.dia[p]} mm ${matName(g.pmat[p])}${g.pyr[p] ? `, laid ${g.pyr[p]}` : ""} · ${g.plen[p].toFixed(0)} m at ${g.pslope[p]}% · full capacity ${g.pcap[p].toFixed(0)} L/s</span>${extra ? `<em>${extra}</em>` : ""}`;
    placeTip(t, x, y);
  }
  function onMapClick(i) {
    const sec = HANDLERS[st.sec];
    if (sec.click && sec.click(i) === true) return;
    st.sel = i; st.selPipe = null; refresh();
  }
  function onPipeClick(p) { st.selPipe = p; st.sel = null; refresh(); }

  // ------------------------------------------------------------------ small SVG charts
  function bars(items, o = {}) {
    // items: [{label, value 0..1, colour, note, key, text}]
    const Hh = 16, gap = 6, w = o.width || 380, lw = o.labelWidth || 120;
    const rows = items.map((it, k) => {
      const y = k * (Hh + gap), bw = Math.max(0, (w - lw - 44) * Math.min(1, it.value));
      return `<g class="${o.clickable ? "click" : ""} ${it.on ? "on" : ""}" data-key="${it.key ?? ""}"><title>${it.note || it.label}</title>
        <text x="${lw - 6}" y="${y + 12}" text-anchor="end" class="bl">${it.label}</text>
        <rect x="${lw}" y="${y}" width="${w - lw - 44}" height="${Hh}" class="track"/>
        <rect x="${lw}" y="${y}" width="${bw}" height="${Hh}" fill="${it.colour || COL.accent}" rx="2"/>
        <text x="${w - 38}" y="${y + 12}" class="bv">${it.text != null ? it.text : pct(it.value)}</text></g>`;
    }).join("");
    return `<svg class="bars" viewBox="0 0 ${w} ${items.length * (Hh + gap)}" width="100%">${rows}</svg>`;
  }
  function lineChart(points, o = {}) {
    const w = 300, h = 120, l = 34, b = 22, maxY = Math.max(o.rule * 1.4 || 12, ...points.map(p => p.y)) * 1.1;
    const X = k => l + (w - l - 8) * (points.length < 2 ? 0 : k / (points.length - 1)), Y = v => h - b - (h - b - 8) * v / maxY;
    const path = points.map((p, k) => `${k ? "L" : "M"}${X(k).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
    return `<svg class="line" viewBox="0 0 ${w} ${h}" width="100%">
      ${o.rule ? `<line x1="${l}" x2="${w - 8}" y1="${Y(o.rule)}" y2="${Y(o.rule)}" class="rule"/><text x="${w - 8}" y="${Y(o.rule) - 4}" text-anchor="end" class="ax">${o.rule} ${o.unit || "mm"}</text>` : ""}
      <path d="${path}" class="ln"/>${points.map((p, k) => `<circle cx="${X(k)}" cy="${Y(p.y)}" r="3.5" class="pt ${p.cls || ""}"><title>${p.x}: ${o.fmt ? o.fmt(p.y) : p.y.toFixed(1) + " mm"}</title></circle>`).join("")}
      ${points.map((p, k) => `<text x="${X(k)}" y="${h - 6}" text-anchor="middle" class="ax">${p.x}</text>`).join("")}
      <text x="4" y="12" class="ax">${o.unit || "mm"}</text></svg>`;
  }
  // Several series against sensor count: series [{label, colour, ys (0..1), on}]
  function curves(series, o = {}) {
    const w = 380, h = 170, l = 34, b = 24, n = series[0].ys.length;
    const X = k => l + (w - l - 10) * k / (n - 1), Y = v => h - b - (h - b - 10) * v;
    const grid = [0, 0.25, 0.5, 0.75, 1].map(v => `<line x1="${l}" x2="${w - 10}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${l - 5}" y="${Y(v) + 3}" text-anchor="end" class="ax">${v * 100}%</text>`).join("");
    const lines = series.map(s => `<g class="click ${s.on ? "on" : ""}" data-key="${s.key}"><title>${s.label}</title><path d="${s.ys.map((v, k) => `${k ? "L" : "M"}${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join("")}" fill="none" stroke="${s.colour}" stroke-width="${s.on ? 3.2 : 1.6}" ${s.dash ? 'stroke-dasharray="4 4"' : ""} opacity="${s.on ? 1 : 0.75}"/>
      ${s.ys.map((v, k) => `<circle cx="${X(k)}" cy="${Y(v)}" r="${s.on ? 3.5 : 2.2}" fill="${s.colour}"><title>${s.label}, ${k + 1} sensor${k ? "s" : ""}: ${pct(v)}</title></circle>`).join("")}</g>`).join("");
    const xs = Array.from({ length: n }, (_, k) => `<text x="${X(k)}" y="${h - 6}" text-anchor="middle" class="ax">${k + 1}</text>`).join("");
    const mark = o.at ? `<line x1="${X(o.at - 1)}" x2="${X(o.at - 1)}" y1="6" y2="${h - b}" class="now"/>` : "";
    return `<svg class="curves" viewBox="0 0 ${w} ${h}" width="100%">${grid}${mark}${lines}${xs}<text x="${w - 10}" y="${h - 6}" text-anchor="end" class="ax">sensors →</text></svg>`;
  }
  function scatter(pts, o = {}) {
    // pts: [{x, y, i, cls}] ; log axes when asked
    const w = 380, h = 230, l = 40, b = 30, tx = o.logX ? Math.log10 : (v => v), ty = o.logY ? Math.log10 : (v => v);
    const xs = pts.map(p => tx(p.x)), ys = pts.map(p => ty(p.y)), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const X = v => l + (w - l - 10) * (tx(v) - x0) / ((x1 - x0) || 1), Y = v => h - b - (h - b - 10) * (ty(v) - y0) / ((y1 - y0) || 1);
    const dots = pts.slice().sort((a, b2) => (a.cls ? 1 : 0) - (b2.cls ? 1 : 0)).map(p => `<circle data-i="${p.i}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${p.cls === "sensor" ? 5.5 : p.cls === "sel" ? 6 : 3}" class="dot ${p.cls || ""}"><title>${nameOf(p.i)}: ${o.fx(p.x)}, ${o.fy(p.y)}</title></circle>`).join("");
    return `<svg class="scatter" viewBox="0 0 ${w} ${h}" width="100%"><rect x="${l}" y="10" width="${w - l - 10}" height="${h - b - 10}" class="track"/>${dots}
      <text x="${w - 10}" y="${h - 8}" text-anchor="end" class="ax">${o.xl} →</text><text x="${l + 4}" y="22" class="ax">↑ ${o.yl}</text></svg>`;
  }
  function histogram(bins, o = {}) {
    // bins: [{label, n, colour, key, on}]
    const w = 380, h = 120, l = 6, b = 30, max = Math.max(...bins.map(x => x.n)), bw = (w - 2 * l) / bins.length;
    return `<svg class="hist" viewBox="0 0 ${w} ${h}" width="100%">${bins.map((x, k) => {
      const bh = (h - b - 14) * x.n / max, X = l + k * bw;
      return `<g class="click ${x.on ? "on" : ""}" data-key="${x.key}"><title>${x.label}: ${x.n} pipes</title><rect x="${X}" y="0" width="${bw}" height="${h}" fill="transparent"/><rect x="${X + 2}" y="${h - b - bh}" width="${bw - 4}" height="${bh}" fill="${x.colour}" rx="2"/>
        <text x="${X + bw / 2}" y="${h - b - bh - 3}" text-anchor="middle" class="bv sm">${x.n}</text><text x="${X + bw / 2}" y="${h - b + 13}" text-anchor="middle" class="ax">${x.label}</text></g>`;
    }).join("")}<text x="${w - 6}" y="${h - 3}" text-anchor="end" class="ax">${o.unit || ""}</text></svg>`;
  }
  // A cutaway of one manhole: the lower part (the pipe) is drawn large, the shaft up to the lid compressed above it.
  function cutaway(o) {
    // o: {depthM, dia, water, base, sensor, title}
    const W = 330, Hc = 250, top = 24, bottom = Hc - 22, depth = o.depthM * 1000, zone = Math.max(o.dia * 2, 1);
    const split = top + (bottom - top) * 0.36;
    const y = mm => mm <= zone ? bottom - (bottom - split) * mm / zone : split - (split - top) * Math.min(1, (mm - zone) / Math.max(1, depth - zone));
    const sx0 = 130, sx1 = 210, px0 = 20, px1 = 310, lid = y(depth), wTop = y(Math.min(o.water, depth)), bTop = y(Math.min(o.base, depth));
    const lines = [[0.7 * o.dia, "0.7 of pipe: limit", "#ffd166"], [o.dia, "pipe top: surcharge above", "#ff9f43"]];
    const sensor = SENSOR_TYPES.find(t => t.id === o.sensor);
    let sm = "";
    if (sensor) {
      const at = sensor.at(o), yy = at === "lid" ? lid + 9 : y(at), xx = sensor.inPipe ? 250 : (sx0 + sx1) / 2;
      sm = `<g class="sens"><rect x="${xx - 13}" y="${yy - 7}" width="26" height="14" rx="3" fill="${sensor.colour}"/>${at === "lid" ? `<path d="M${xx - 10},${yy + 8} L${xx},${wTop} L${xx + 10},${yy + 8}" fill="${sensor.colour}" opacity=".18"/>` : ""}<text x="${xx + 18}" y="${yy + 4}" class="ax strong">${sensor.short}</text></g>`;
    }
    const over = o.water >= depth;
    return `<svg class="cut" viewBox="0 0 ${W} ${Hc}" width="100%" role="img" aria-label="${o.title || "Manhole cutaway"}">
      <rect x="0" y="${lid}" width="${W}" height="${Hc - lid}" fill="#1a2436"/>
      <rect x="${sx0}" y="${lid}" width="${sx1 - sx0}" height="${bottom - lid}" fill="#0b1220" stroke="#4a5b7a"/>
      <rect x="${px0}" y="${y(o.dia)}" width="${px1 - px0}" height="${bottom - y(o.dia)}" fill="#0b1220" stroke="#4a5b7a"/>
      <rect x="${px0}" y="${Math.max(y(o.dia), wTop)}" width="${px1 - px0}" height="${bottom - Math.max(y(o.dia), wTop)}" class="water"/>
      ${o.water > o.dia ? `<rect x="${sx0}" y="${wTop}" width="${sx1 - sx0}" height="${y(o.dia) - wTop}" class="water"/>` : ""}
      ${over ? `<ellipse cx="${(sx0 + sx1) / 2}" cy="${lid - 6}" rx="70" ry="8" class="water spill"/>` : ""}
      <line x1="${px0}" x2="${px1}" y1="${bTop}" y2="${bTop}" class="base"/>
      ${lines.map(([mm, t, c]) => `<line x1="${px0}" x2="${px1}" y1="${y(mm)}" y2="${y(mm)}" stroke="${c}" stroke-dasharray="5 4"/><text x="${px1}" y="${y(mm) - 3}" text-anchor="end" class="ax" fill="${c}">${t}</text>`).join("")}
      <rect x="${sx0 - 8}" y="${lid - 5}" width="${sx1 - sx0 + 16}" height="5" fill="#a9b8d4"/><text x="${sx1 + 12}" y="${lid + 2}" class="ax">lid: overflow (${o.depthM.toFixed(1)} m up)</text>
      <text x="${px0}" y="${split - 4}" class="ax">↕ shaft not to scale</text>
      ${sm}
      <text x="${px0}" y="${Hc - 6}" class="ax">water ${Math.round(o.water)} mm above the pipe floor · before growth ${Math.round(o.base)} mm (dotted)</text></svg>`;
  }
  const stat = (v, l, cls = "") => `<div class="stat ${cls}"><b>${v}</b><span>${l}</span></div>`;
  const chips = (items, on, attr) => `<div class="chips">${items.map(([k, t, c]) => `<button type="button" data-${attr}="${k}" class="${on(k) ? "on" : ""}" ${c ? `style="--c:${c}"` : ""}>${t}</button>`).join("")}</div>`;
  const fold = (title, body, open = false) => `<details class="fold" ${open ? "open" : ""}><summary>${title}</summary>${body}</details>`;
  const nextBtn = () => {
    const k = SECTIONS.findIndex(s => s[0] === st.sec), n = SECTIONS[k + 1];
    return n ? `<button class="next" type="button" data-go="${n[0]}">Next: ${n[1]} →</button>` : `<button class="next" type="button" data-go="setting">Back to the start ↺</button>`;
  };
  const on = (sel, ev, fn) => $$(sel).forEach(e => e[ev] = fn);

  // ------------------------------------------------------------------ 1 SETTING
  const SETTING = {
    init() {
      const s = st.setting;
      if (s.mh !== null) return;
      // Start on a manhole the model tips into surcharge: the corridor's homes on a wetter-than-design day.
      const wet = wetTags(), r = regionIndex("R3"), row = rowAt(wet[1], r, FULL());
      s.mh = row && row.sur.length ? row.sur[0] : planIdx(5)[0]; s.tag = wet[1]; s.r = r; s.s = FULL();
    },
    best(i, tag) { // the region whose homes raise this manhole most
      let best = null, bm = -1; S().regions.forEach((r, ri) => { const m = riseAt(rowAt(tag, ri, FULL()), i); if (m > bm) { bm = m; best = ri; } }); return best;
    },
    water() { const s = st.setting, row = s.s >= 0 ? rowAt(s.tag, s.r, s.s) : null; return { base: baseMm(s.tag, s.mh), water: baseMm(s.tag, s.mh) + riseAt(row, s.mh), row }; },
    layer() {
      const s = st.setting, base = new Set(S().base[s.tag].surcharged), { row } = this.water(), rise = new Map(row ? row.rise : []);
      return {
        pipe: p => pipeRegion(p) === s.r || (S().regions[s.r].overlay && inOverlay(p)) ? [REGION_COLS[regionId(s.r)] + "aa", 2.4] : [COL.pipe, 1.2],
        node: i => i === s.mh ? { fill: COL.accent, r: 7 } : row && row.sur.includes(i) ? { fill: COL.tip, r: 6 } : base.has(i) ? { ring: COL.was, r: 4.5 } : riseColour(rise.get(i) || 0) ? { fill: riseColour(rise.get(i)), r: 3 } : null,
        labels: [{ node: paint.centre[s.r], text: `${regionLabel(s.r)}: homes added here`, cls: "region", bg: REGION_COLS[regionId(s.r)] }],
        legend: [[COL.accent, "The manhole in the cutaway (click another)"], [COL.was, "Surcharged before growth", "ring"], [COL.tip, "Newly surcharged"]], scale: riseScale,
        tip: i => `Before growth ${Math.round(baseMm(s.tag, i))} mm deep${rise.get(i) ? ` · +${rise.get(i).toFixed(1)} mm with these homes` : ""}`,
      };
    },
    panel() {
      const s = st.setting, f = manholeFacts(s.mh), w = this.water(), dia = f.dia || 150, depthM = f.nd.depth || 2;
      const state = w.water >= depthM * 1000 ? ["bad", "Overflowing at the lid"] : w.water > dia ? ["bad", "Surcharged: water above the pipe top"] : w.water > 0.7 * dia ? ["warn", "Past the design limit (0.7 of the pipe)"] : ["ok", "Within the design limit"];
      const homes = w.row ? Math.round(w.row.dw) : 0;
      return `
        <p class="lede">New homes send more sewage into pipes that were sized for the suburb as it was. Wet weather leaks in on top. When the water rises above the pipe, a manhole <b>surcharges</b>; when it reaches the lid, it <b>overflows</b>.</p>
        <div class="cutwrap">${cutaway({ depthM, dia, water: w.water, base: w.base, title: f.name })}<div class="badge ${state[0]}">${state[1]}</div></div>
        <h3>Homes added <small>(in ${regionLabel(s.r)}, upstream of this manhole)</small></h3>
        <div class="slider"><input id="stS" type="range" min="-1" max="${S().ladder.length - 1}" value="${s.s}" aria-label="Homes added"><span>${stepLabel(s.s)}${homes ? ` · +${homes}` : ""}</span></div>
        <h3>Weather</h3>
        ${chips(allTags().filter((t, k) => k < 4).map(t => [t, caseLabel(t)]), k => k === s.tag, "stc")}
        <div class="hint">${f.name}, ${f.dia} mm ${f.mat} pipe, ${depthM.toFixed(1)} m deep. Model results, not measurements.</div>
        <h3>What this project is about</h3>
        <table class="mini scope"><tr><th class="in">In scope</th><th class="out">Out of scope</th></tr>
          <tr><td>Growth using up pipe capacity</td><td>Blockages and tree roots</td></tr>
          <tr><td>Wet-weather leakage that adds to it</td><td>Pipe collapse, corrosion</td></tr>
          <tr><td>Where to measure, to see it coming</td><td>Pipe upgrades and their design</td></tr></table>
        <div class="hint">Blockages cause most overflow events, but capacity events carry about three quarters of the overflow volume (US EPA 2004). Where capacity runs out, utilities have paused new connections (e.g. Auckland, 2026 moratoria in the US).</div>
        ${nextBtn()}`;
    },
    click(i) { if (i === null) return false; const s = st.setting; s.mh = i; s.r = this.best(i, s.tag) ?? s.r; refresh(); return true; },
    wire() {
      const s = st.setting;
      $("#stS").oninput = e => { s.s = +e.target.value; refresh(); };
      on("[data-stc]", "onclick", e => { s.tag = e.currentTarget.dataset.stc; refresh(); });
    },
  };

  // ------------------------------------------------------------------ 2 NETWORK
  const ATTRS = {
    util: { label: "Flow / capacity today", unit: "estimated peak flow ÷ Manning full capacity, design wet day", v: p => util(p, caseOf(D().design).ii), edges: [0, 0.05, 0.1, 0.2, 0.4, 0.7, 1], fmt: v => pct(v) },
    cap: { label: "Full capacity", unit: "L/s, Manning", v: p => G().pcap[p], edges: [0, 10, 20, 40, 80, 160], fmt: v => v.toFixed(0) },
    size: { label: "Size", unit: "mm diameter", v: p => G().dia[p], cats: [[150, "≤150"], [225, "225"], [300, "250–300"], [Infinity, "375+"]] },
    age: { label: "Age", unit: "year laid", v: p => G().pyr[p] || null, edges: [1900, 1930, 1950, 1970, 1990, 2010], fmt: v => v },
    material: { label: "Material", unit: "", v: p => G().pmat[p], names: { VC: "Clay", PVCU: "PVC", RC: "Concrete" } },
    slope: { label: "Slope", unit: "% fall", v: p => G().pslope[p], edges: [0, 0.5, 1, 2, 5, 10], fmt: v => v, rev: true },
    depth: { label: "Depth", unit: "m, manhole at the top of the pipe", v: p => G().nodes[G().up[p]].depth, edges: [0, 1, 1.5, 2, 3, 4], fmt: v => v },
  };
  function binsOf(id) {
    const a = ATTRS[id], g = G(), vals = Array.from({ length: g.nPipes }, (_, p) => a.v(p));
    let defs;
    if (a.names) defs = Object.keys(a.names).map(k => ({ key: k, label: a.names[k], test: v => v === k }));
    else if (a.cats) defs = a.cats.map(([hi, l], k) => ({ key: String(k), label: l, test: v => v <= hi && (k === 0 || v > a.cats[k - 1][0]) }));
    else defs = a.edges.map((lo, k) => { const hi = a.edges[k + 1]; return { key: String(k), label: hi === undefined ? `${a.fmt(lo)}+` : `${a.fmt(lo)}–${a.fmt(hi)}`, test: v => v != null && v >= lo && (hi === undefined || v < hi) }; });
    const colours = a.names ? ["#d9a066", "#7dd8ff", "#c9d1d9"] : SEQ.slice(0, defs.length);
    if (a.rev) colours.reverse();
    const of = vals.map(v => defs.findIndex(d => d.test(v)));
    return { defs: defs.map((d, k) => ({ ...d, colour: colours[k], n: of.filter(x => x === k).length })), of };
  }
  const NETWORK = {
    layer() {
      const n = st.network, b = binsOf(n.by), on = n.bin;
      return {
        pickPipe: true,
        pipe: p => { const k = b.of[p]; if (k < 0) return ["#444c5c", 1]; const d = b.defs[k], hit = on === null || d.key === on; return [hit ? d.colour : "#253148", hit ? (on === null ? 1.8 : 3) : 1]; },
        node: i => S().base[D().design].surcharged.includes(i) ? { ring: COL.was, r: 4.5 } : null,
        legend: [...b.defs.map(d => [d.colour, `${d.label} ${ATTRS[n.by].unit ? "" : ""}`]), [COL.was, "Surcharged before growth (model)", "ring"]],
        pipeTip: p => n.by === "util" ? `Flow / capacity ≈ ${pct(util(p, caseOf(D().design).ii))} on a design wet day` : "",
      };
    },
    panel() {
      const n = st.network, b = binsOf(n.by), g = G();
      const total = g.plen.reduce((t, v) => t + v, 0), clay = g.pmat.reduce((t, m, p) => t + (m === "VC" ? g.plen[p] : 0), 0);
      return `
        <p class="lede">Built from public layers: every pipe with its size, material, age, length, slope and inverts; every manhole with its depth; every home connected. Hover or click a pipe.</p>
        <div class="stats four">${stat(g.nPipes, "pipes")}${stat(R().chambers.length, "manholes")}${stat((total / 1000).toFixed(1) + " km", "of pipe")}${stat(S().councilConnections.toLocaleString("en-AU"), "homes connected")}</div>
        <h3>Colour the pipes by</h3>
        ${chips(Object.entries(ATTRS).map(([k, a]) => [k, a.label]), k => k === n.by, "by")}
        <h3>${ATTRS[n.by].label} <small>${ATTRS[n.by].unit} · click a bar to pick those pipes out</small></h3>
        ${histogram(b.defs.map(d => ({ ...d, on: n.bin === d.key })))}
        <div class="hint">${{
          util: "Most pipes run far below capacity; a handful near the bottom of the network run close to full on a wet day.",
          cap: "Capacity comes from Manning's equation: size, slope and roughness.",
          size: "Mostly 150 mm: small pipes, sized for the homes that were there.",
          age: "Much of it laid before 1950: old pipes leak more in wet weather.",
          material: `${Math.round(clay / total * 100)}% of the length is clay.`,
          slope: "A hillside network: steep pipes drain fast, flat ones near the bottom back up first.",
          depth: "Manhole depth: how far the water can rise before it reaches the lid.",
        }[n.by]}</div>
        ${this.pipeCard()}
        ${fold("What we have, what we assumed, what is missing", `<table class="mini"><tr><th>Have (public)</th><th>Assumed</th><th>Missing</th></tr>
          <tr><td>Pipes: size, material, year, length, inverts</td><td>200 L a person a day, 2.3 people a home, peak 2×</td><td>Flow and level records</td></tr>
          <tr><td>Manholes: lid and floor levels</td><td>Leakage per 100 m of pipe, by weather</td><td>Pump station run times</td></tr>
          <tr><td>Homes connected; growth to 2041 (projections)</td><td>Pipe limit 0.7 of pipe height</td><td>Rainfall response, blockage history</td></tr>
          <tr><td>3 pump stations and rising mains</td><td>Roughness n by material</td><td>Calibration</td></tr></table>`)}
        ${nextBtn()}`;
    },
    pipeCard() {
      const p = st.selPipe; if (p === null) return `<div class="card muted">Click a pipe to see Manning's equation worked through for it.</div>`;
      const g = G(), D_ = g.dia[p] / 1000, n = nOf(p), Sl = Math.max(g.pslope[p] / 100, g.manning.minSlope), A = Math.PI * D_ * D_ / 4, Rh = D_ / 4;
      const Q = A * Math.pow(Rh, 2 / 3) * Math.sqrt(Sl) / n * 1000, ii = caseOf(D().design).ii;
      return `<div class="card"><b>Pipe ${g.pid[p]}</b> <span class="dim">${g.dia[p]} mm ${matName(g.pmat[p])}${g.pyr[p] ? `, laid ${g.pyr[p]}` : ""}, ${g.plen[p].toFixed(0)} m</span>
        <div class="eq">Q<sub>full</sub> = (1/n) · A · R<sup>2/3</sup> · S<sup>1/2</sup> = (1/${n}) · ${A.toFixed(4)} m² · ${Rh.toFixed(3)}<sup>2/3</sup> · ${Sl.toFixed(4)}<sup>1/2</sup> = <b>${Q.toFixed(1)} L/s</b></div>
        <div class="dim small">n: ${matName(g.pmat[p])} roughness. A and R for a full round pipe. S: slope ${g.pslope[p]}%. File value ${g.pcap[p].toFixed(1)} L/s.</div>
        <div class="sub">Estimated peak flow on a design wet day</div>
        <div>${Math.round(H.pH[p])} homes upstream × ${H.lps.toFixed(4)} L/s + ${ii} L/s per 100 m × ${(H.pL[p] / 1000).toFixed(2)} km = <b>${flowEst(p, ii).toFixed(2)} L/s</b> → <b>${pct(util(p, ii))}</b> of capacity</div></div>`;
    },
    click(i) { if (i === null) return false; st.sel = i; st.selPipe = H.outPipe[i] ?? null; refresh(); return true; },
    wire() {
      const n = st.network;
      on("[data-by]", "onclick", e => { n.by = e.currentTarget.dataset.by; n.bin = null; refresh(); });
      on(".hist .click", "onclick", e => { const k = e.currentTarget.dataset.key; n.bin = n.bin === k ? null : k; refresh(); });
    },
  };

  // ------------------------------------------------------------------ APPROACH, END TO END
  // The whole method on one page: the pipeline (each step linking to its own view), why we simulate rather than use
  // the alternatives (each alternative's five sites mapped and scored on the same runs), and why it suits growth.
  // [id, title, what it does, detail view, part]; step 2 is split into three parts.
  const PIPELINE = [
    ["1", "Build the network model", "Pipes, manholes, inverts, lids and connected homes from public layers, assembled into one hydraulic model.", "network", "sim"],
    ["2a", "Where the homes go", "Infill: new homes spread through existing streets, region by region, in steps from 10% to 300% of the 2041 projection. Greenfield: a new estate joining at one manhole (explored in Simulation 4; the plan here rests on infill).", "simulate", "sim"],
    ["2b", "What each home sends", "Sewage per home: 2.3 people × 200 L a day, peaking at twice the average, loaded where each home connects.", "simulate", "sim"],
    ["2c", "How wet it is", "Infiltration that depends on the weather: 8 cases, from a dry day to severe leakage into old pipes, because the weather to plan for is unknown.", "simulate", "sim"],
    ["3", "Simulate sewer levels", "PySWMM runs EPA SWMM 5 for every scenario until flows settle: 504 runs, each giving the water level at every manhole.", "insights", "sim"],
    ["4", "Find the best sensor locations", "Search the simulated levels for the few manholes that see the most growth, solved exactly; greedy and desk heuristics for comparison.", "algorithms", "alg"],
    ["5", "Evaluate by scenario coverage", "Score each placement by the share of growth scenarios it sees, in the worst and the average weather, and the overloads it warns of. Then stress it.", "compare", "alg"],
  ];
  const ALTERNATIVES = [
    { id: "judgement", label: "Judgement or incident history", colour: "#ff9f43", note: "What utilities mostly do now: sites by experience or where problems were reported. Stand-in here: the manholes already worst today.",
      marks: ["~", "✗", "~", "✗", "✓"], picks: () => { const t = D().design; return S().base[t].surcharged.slice().sort((a, b) => baseMm(t, b) / (G().dia[H.outPipe[b]] || 150) - baseMm(t, a) / (G().dia[H.outPipe[a]] || 150)).slice(0, 5); } },
    { id: "desk", label: "Desk hydraulics (Manning)", colour: "#ffd166", note: "Flow against pipe capacity, pipe by pipe, no model runs. Cheap, but each pipe is judged alone.",
      marks: ["✓", "~", "✗", "~", "✓"], picks: () => C().methods.hydraulic.sets[4] },
    { id: "ml", label: "Learn from sensor data", colour: "#b38cff", note: "Train a model on years of level records. Not possible yet: there are no records, and the growth has not happened. Becomes possible after a pilot (Next research).",
      marks: ["✗", "✗", "✓", "~", "✗"], picks: () => null },
    { id: "ours", label: "Simulation + search (ours)", colour: COL.sensor, note: "Many futures simulated on the whole network, then the sites that see most of them, chosen exactly.",
      marks: ["✓", "✓", "✓", "✓", "✓"], picks: () => planIdx(5) },
  ];
  const CRITERIA = ["Works before any sensor exists", "Tests growth that has not happened", "Sees water backing up through the network", "Copes with unknown weather", "Gives a reason for each site"];
  const APPROACH = {
    layer() {
      const a = st.approach;
      if (a.alt) {
        const alt = ALTERNATIVES.find(x => x.id === a.alt), set = alt.picks() || [], rec = new Set(planIdx(5));
        return { pipe: triagePipe(true), node: i => set.includes(i) ? { fill: alt.colour, r: 7, ring: alt.id !== "ours" && rec.has(i) ? COL.sensor : undefined } : alt.id !== "ours" && rec.has(i) ? { ring: COL.sensor, r: 6 } : null,
          labels: sensorLabels(set), legend: [[alt.colour, alt.label + (set.length ? ": its 5 sites" : ": no sites possible yet")], ...(alt.id !== "ours" ? [[COL.sensor, "Our recommended sites", "ring"]] : [])] };
      }
      const k = a.step, g = G(), set = planIdx(5);
      if (k === "1") return { pipe: p => [g.dia[p] <= 150 ? "#4f86c6" : g.dia[p] <= 225 ? "#9fd3ff" : "#ffd166", 1 + g.dia[p] / 160], legend: [["#4f86c6", "150 mm pipes"], ["#9fd3ff", "225 mm"], ["#ffd166", "Larger mains"]] };
      if (k === "2a") return { pipe: p => { const ri = pipeRegion(p); return ri >= 0 ? [REGION_COLS[regionId(ri)], 2.2] : [COL.pipe, 1]; }, overlayPipe: p => [REGION_COLS[regionId(paint.overlayOf[g.up[p]])], 4], labels: regionLabels(ri => REGION_COLS[regionId(ri)]), legend: [["#c9d1d9", "Infill regions, each grown on its own (the corridor overlaps, dashed)"]] };
      if (k === "2b") { const mx = Math.max(...H.pH); return { homes: "#7f93b8", pickPipe: true, pipe: p => [`hsl(${210 - 170 * Math.sqrt(H.pH[p] / mx)},80%,${40 + 25 * Math.sqrt(H.pH[p] / mx)}%)`, 0.8 + 4 * Math.sqrt(H.pH[p] / mx)], legend: [["#7f93b8", "Homes connected"], ["hsl(210,80%,40%)", "Few homes upstream"], ["hsl(40,80%,65%)", `Many (up to ${Math.round(mx)})`]], pipeTip: p => `${Math.round(H.pH[p])} homes upstream` }; }
      if (k === "2c") { const t = wetTags()[1], base = new Set(S().base[t].surcharged); return { pipe: p => [g.pyr[p] && g.pyr[p] < 1950 ? "#d9a066" : COL.pipe, g.pyr[p] && g.pyr[p] < 1950 ? 1.8 : 1], node: i => base.has(i) ? { ring: COL.was, r: 4.5 } : null, legend: [["#d9a066", "Pipes laid before 1950: leak more"], [COL.was, `Surcharged by infiltration alone, ${caseLabel(t)} (${base.size})`, "ring"]] }; }
      if (k === "3") {
        const c = new Array(R().chambers.length).fill(0); wetTags().forEach(t => S().rows[t].forEach(x => { if (x.s <= FULL()) seenSet(x, 10).forEach(i => c[i]++); }));
        const max = Math.max(...c);
        return { pipe: () => [COL.pipe, 1], node: i => c[i] ? { fill: `hsl(${200 - 150 * c[i] / max},90%,${45 + 20 * c[i] / max}%)`, r: 2.5 + 7 * Math.sqrt(c[i] / max) } : null, legend: [["hsl(200,90%,45%)", "Rises 10 mm in few runs"], ["hsl(50,90%,65%)", "In many runs"]], tip: i => `Rises 10 mm or more in ${c[i]} runs` };
      }
      if (k === "4") {
        const ms = [["greedyAvg", "#ff9f43", "Greedy"], ["hydraulic", "#ffd166", "Desk heuristic: flow/capacity"], ["homes", "#e87ba4", "Desk heuristic: most homes upstream"]];
        const of = i => ms.find(([id]) => C().methods[id].sets[4].includes(i));
        return { pipe: triagePipe(true), node: i => set.includes(i) ? { fill: COL.sensor, r: 7 } : of(i) ? { ring: of(i)[1], r: 6, rw: 2.6 } : null, labels: sensorLabels(set),
          legend: [[COL.sensor, "Exact search"], ...ms.map(([, c, l]) => [c, l, "ring"])], tip: i => [set.includes(i) ? "Exact search" : null, ...ms.filter(([id]) => C().methods[id].sets[4].includes(i)).map(m => m[2])].filter(Boolean).join(" · ") };
      }
      const sc = score(set, SIM4_TEST()), per = new Map(set.map(i => [i, score([i], SIM4_TEST()).avg]));
      return { pipe: triagePipe(true), node: i => set.includes(i) ? { fill: COL.sensor, r: 7 } : null, labels: sensorLabels(set), legend: [[COL.sensor, `Recommended: ${pct(sc.avg)} of scenarios seen on average, ${pct(sc.worst)} in the worst weather`], [COL.monitor, "Monitor region"], [COL.watch, "Watch region"]], tip: i => per.has(i) ? `Alone, this sensor sees ${pct(per.get(i))} of scenarios on average` : "" };
    },
    panel() {
      const a = st.approach, o = SIM4_TEST(), step = PIPELINE.find(x => x[0] === a.step), target = SECTIONS.find(x => x[0] === step[3]);
      const nRuns = S().regions.length * S().ladder.length * allTags().length, rec = score(planIdx(5), o);
      const rows = ALTERNATIVES.map(x => { const set = x.picks(); return { x, sc: set ? score(set, o) : null }; });
      const mark = m => `<td class="mk ${m === "✓" ? "y" : m === "✗" ? "n" : "p"}">${m}</td>`;
      const alt = a.alt && ALTERNATIVES.find(x => x.id === a.alt);
      return `
        <p class="lede">Two parts. <b>Simulate</b> many possible futures on a model of the whole network, then <b>search</b> those runs for the few manholes that would see the most of them.</p>
        <div class="pipe6">${(() => { const btn = ([id, t, , , part]) => `<button type="button" data-ap="${id}" class="${!a.alt && a.step === id ? "on" : ""} ${part}"><i>${id.length > 1 ? id.slice(1) : id}</i>${t}</button>`;
          return btn(PIPELINE[0]) + `<div class="nest"><div class="nesth"><i>2</i>Design the simulation scenarios</div>${PIPELINE.slice(1, 4).map(btn).join("")}</div>` + PIPELINE.slice(4).map(btn).join(""); })()}</div>
        <div class="pipekey"><span class="sim">Simulation (steps 1–3)</span><span class="alg">Algorithm and evaluation (steps 4–5)</span></div>
        <div class="card"><b>${a.step}. ${step[1]}</b><div>${step[2]}</div><button type="button" class="link" data-go="${step[3]}">In detail: ${target[1]} →</button></div>
        <div class="matrix3">${stat(nRuns, "simulated futures")}<i>→</i>${stat(R().chambers.length, "candidate manholes")}<i>→</i>${stat(5, "sensors", "big")}</div>
        <h3>Why simulate? <small>(click an approach to map its five sites)</small></h3>
        <table class="alts"><tr><th></th>${CRITERIA.map((c, k) => `<th title="${c}">${["Before sensors", "Future growth", "Backwater", "Unknown weather", "Reasons"][k]}</th>`).join("")}<th title="Worst weather case, 5 sites, on the same runs">Worst</th></tr>
          ${rows.map(({ x, sc }) => `<tr data-alt="${x.id}" class="${a.alt === x.id ? "on" : ""}"><td><i class="sw" style="background:${x.colour}"></i>${x.label}</td>${x.marks.map(mark).join("")}<td class="num">${sc ? pct(sc.worst) : "–"}</td></tr>`).join("")}</table>
        <div class="hint">${alt ? alt.note : "✓ yes · ~ partly · ✗ no. Worst: growth runs seen in the worst weather case by that approach's five sites, scored on the same runs."}</div>
        <h3>Why it suits monitoring growth</h3>
        <ul class="plain">
          <li><b>Growth has not happened yet</b>, so there is nothing to measure or learn from. Simulation lets us add the 2041 homes now and watch where the water rises.</li>
          <li><b>It finds where growth shows first.</b> Homes are added in steps, so the sites rise before a pipe overloads: ${rec.warned} of ${rec.warnable} overloads warned a step ahead.</li>
          <li><b>It says which growth.</b> Each region is grown on its own, so each sensor's rise traces back to a region: monitor, watch or leave.</li>
          <li><b>It plans for any weather:</b> chosen for the worst of ${o.cases.length} wet cases, ${pct(rec.worst)} seen there.</li>
          <li><b>Level is the signal,</b> and a 10 mm rise is what a level sensor can pick up.</li>
          <li><b>It can be re-run</b> as approvals come in, or for another suburb.</li></ul>
        ${fold("What it costs us", `<ul class="plain"><li>The model is uncalibrated: it ranks where to look; it does not forecast levels.</li><li>Flows are steady, not storms.</li><li>Building the model and running 504 futures takes hours, once per suburb.</li></ul>`)}
        ${nextBtn()}`;
    },
    wire() {
      const a = st.approach;
      on("[data-ap]", "onclick", e => { a.step = e.currentTarget.dataset.ap; a.alt = null; refresh(); });
      on("[data-alt]", "onclick", e => { const id = e.currentTarget.dataset.alt; a.alt = a.alt === id ? null : id; refresh(); });
    },
  };

  // ------------------------------------------------------------------ 3 SIMULATE
  const STAGES = [
    ["Homes", "Each home: 2.3 people × 200 L a day, peaking at twice the average."],
    ["Flows", "Plus leakage into old pipes, set by the weather case."],
    ["Model", "PySWMM runs EPA SWMM 5 through all 890 pipes, until flows settle."],
    ["Levels", "The water level at every manhole, before and after each region's growth."],
    ["Sensors", "Search the runs for the few manholes that see the most growth."],
  ];
  const SIMULATE = {
    init() { const p = st.simulate; p.r ??= regionIndex("R3"); p.s ??= FULL(); p.tag ??= D().design; },
    presets() {
      const L = v => S().ladder.indexOf(v), wet = wetTags();
      return [
        ["2041 homes, design wet day: water rises, nothing tips over", "R3", L(1), D().design],
        ["Same homes, a wetter day: a manhole tips into surcharge", "R3", L(1), wet[1]],
        ["The corridor, wetter day: the first spill", "R9", L(1), wet[1]],
        ["A “Leave” region in severe weather", "R5", L(0.25), wet[2]],
        ["Stress test: 3 times the homes, design day", "R3", L(3), D().design],
      ];
    },
    row() { const p = st.simulate; return p.s >= 0 ? rowAt(p.tag, p.r, p.s) : null; },
    layer() {
      const p = st.simulate, row = this.row(), base = new Set(S().base[p.tag].surcharged), rise = new Map(row ? row.rise : []);
      const sur = new Set(row ? row.sur : []), spill = new Set(row ? row.spill : []);
      return {
        pipe: q => pipeRegion(q) === p.r || (S().regions[p.r].overlay && inOverlay(q)) ? [REGION_COLS[regionId(p.r)] + "88", 2.4] : [COL.pipe, 1.2],
        node: i => {
          if (spill.has(i)) return { fill: COL.spill, r: 7 };
          if (sur.has(i)) return { fill: COL.tip, r: 6.5 };
          const c = riseColour(rise.get(i) || 0), was = base.has(i);
          if (!c && !was) return null;
          return { fill: c || undefined, r: c === COL.rise ? 5 : 3.6, ring: was ? COL.was : undefined, rw: 2 };
        },
        labels: [{ node: paint.centre[p.r], text: regionLabel(p.r) + (row ? ` +${Math.round(row.dw)} homes` : ""), cls: "region", bg: REGION_COLS[regionId(p.r)] }],
        legend: [[COL.was, "Surcharged before growth", "ring"], [COL.tip, "Newly surcharged"], [COL.spill, "Newly spilling"]],
        scale: riseScale,
        tip: i => { const m = rise.get(i) || 0; return `${m ? `+${m.toFixed(1)} mm with these homes` : "No rise"}${base.has(i) ? " · surcharged before growth" : ""}${sur.has(i) ? " · newly surcharged" : ""}`; },
      };
    },
    panel() {
      const p = st.simulate, row = this.row(), nR = S().regions.length, nS = S().ladder.length, nC = allTags().length;
      const risen = row ? row.rise.filter(([, m]) => m >= 10).length : 0;
      return `
        <p class="lede">Two parts: simulate what growth does to the water level everywhere, then search those runs for sensor sites.</p>
        <div class="flow">${STAGES.map(([t], k) => `<button type="button" data-stage="${k + 1}" class="${p.stage === k + 1 ? "on" : ""} ${k === 4 ? "two" : ""}">${t}</button>${k < 4 ? "<i>→</i>" : ""}`).join("")}</div>
        <div class="hint stagetext">${STAGES[p.stage - 1][1]}</div>
        <div class="matrix3">${stat(nR, "regions grown one at a time")}<i>×</i>${stat(nS, "build-out steps, 10% to 300%")}<i>×</i>${stat(nC, "weather cases")}<i>=</i>${stat(nR * nS * nC, "simulated futures", "big")}</div>
        ${fold("The weather cases", `<table class="mini"><tr><th>Case</th><th>Leakage, L/s per 100 m</th><th>Surcharged before growth</th></tr>${allTags().map(t => `<tr><td>${caseLabel(t)}</td><td>${caseOf(t).ii}</td><td>${S().base[t].surcharged.length}</td></tr>`).join("")}</table>
          <div class="hint">Design wet: the leakage at which these pipes just meet their design rating. The others test wetter days, old pipes leaking more, and more water arriving from outside.</div>`)}
        <h3>Try a run</h3>
        <div class="presets">${this.presets().map((x, k) => `<button type="button" data-preset="${k}">${x[0]}</button>`).join("")}</div>
        <h3>Where the homes go</h3>
        ${chips(S().regions.map((r, ri) => [ri, regionLabel(ri), REGION_COLS[r.id]]), k => +k === p.r, "region")}
        <h3>How many</h3>
        <div class="slider"><input id="pStep" type="range" min="-1" max="${nS - 1}" value="${p.s}" aria-label="Build-out"><button type="button" id="pPlay">▶ Play</button></div>
        <div class="hint">${stepLabel(p.s)} of the region's 2041 homes${row ? `: <b>+${Math.round(row.dw)} homes</b>` : ""}.</div>
        <h3>Weather</h3>
        <select id="pCase">${allTags().map(t => `<option value="${t}" ${t === p.tag ? "selected" : ""}>${caseLabel(t)}</option>`).join("")}</select>
        <div class="stats">
          ${stat(risen, "manholes rise 10 mm or more")}
          ${stat(row ? row.sur.length : 0, "newly surcharged", row && row.sur.length ? "bad" : "")}
          ${stat(row ? row.spill.length : 0, "newly spilling", row && row.spill.length ? "bad" : "")}
          ${stat(S().base[p.tag].surcharged.length, "surcharged before growth", "was")}
        </div>
        ${this.card()}
        ${nextBtn()}`;
    },
    card() {
      const p = st.simulate; if (st.sel === null) return `<div class="card muted">Click a manhole to see its water rise as homes are added.</div>`;
      const f = manholeFacts(st.sel), pts = stepsTo(Infinity).map(s => { const row = rowAt(p.tag, p.r, s); return { x: S().ladder[s] * 100 + "%", y: riseAt(row, st.sel), cls: row.sur.includes(st.sel) ? "bad" : "" }; });
      return `<div class="card"><b>${f.name}</b> <span class="dim">${f.regs.length ? "in " + list(f.regs) : ""}</span>
        <div class="sub">Rise here as ${regionLabel(p.r)}'s homes are added (${caseLabel(p.tag)})</div>${lineChart(pts, { rule: 10 })}
        ${S().base[p.tag].surcharged.includes(st.sel) ? `<div class="dim">Already surcharged before growth in this weather.</div>` : ""}</div>`;
    },
    wire() {
      const p = st.simulate;
      on("[data-stage]", "onclick", e => { p.stage = +e.currentTarget.dataset.stage; refresh(); });
      on("[data-region]", "onclick", e => { p.r = +e.currentTarget.dataset.region; refresh(); });
      on("[data-preset]", "onclick", e => { const x = this.presets()[+e.currentTarget.dataset.preset]; stopPlay(p); p.r = regionIndex(x[1]); p.s = x[2]; p.tag = x[3]; st.sel = null; refresh(); });
      $("#pStep").oninput = e => { stopPlay(p); p.s = +e.target.value; refresh(); };
      $("#pCase").onchange = e => { p.tag = e.target.value; refresh(); };
      $("#pPlay").onclick = () => play(p, () => { p.s = p.s >= FULL() ? -1 : p.s + 1; refresh(); return p.s < FULL(); });
    },
  };

  // ------------------------------------------------------------------ 4 INSIGHTS
  const MEASURES = {
    r10: ["Rises 10 mm or more", row => seenSet(row, 10)],
    r50: ["Rises 50 mm or more", row => seenSet(row, 50)],
    alarm: ["Passes 150 mm (a typical alarm)", row => new Set(row.alarm)],
    sur: ["Newly surcharges", row => new Set(row.sur)],
  };
  const INSIGHTS = {
    init() { const q = st.insights; q.cases ??= new Set(allTags()); },
    counts() {
      const q = st.insights, f = MEASURES[q.measure][1], c = new Array(R().chambers.length).fill(0), steps = new Set(stepsTo(q.max));
      let runs = 0;
      allTags().filter(t => q.cases.has(t)).forEach(t => S().rows[t].forEach(x => { if (!steps.has(x.s)) return; runs++; f(x).forEach(i => c[i]++); }));
      return { c, runs };
    },
    layer() {
      const { c } = this.counts(), max = Math.max(1, ...c);
      return {
        pipe: () => [COL.pipe, 1],
        node: i => c[i] ? { fill: `hsl(${200 - 150 * c[i] / max},90%,${45 + 20 * c[i] / max}%)`, r: 2.5 + 7 * Math.sqrt(c[i] / max) } : null,
        legend: [["hsl(200,90%,45%)", "Responds in few runs"], ["hsl(50,90%,65%)", `Responds in many (up to ${max})`]],
        tip: i => `${MEASURES[st.insights.measure][0]} in ${c[i]} runs`,
      };
    },
    panel() {
      const q = st.insights, { c, runs } = this.counts(), f = MEASURES[q.measure][1], steps = new Set(stepsTo(q.max));
      const responders = c.filter(Boolean).length;
      const top = c.map((v, i) => [v, i]).filter(x => x[0]).sort((a, b) => b[0] - a[0]).slice(0, 8);
      const byCase = allTags().map(t => { const set = new Set(); S().rows[t].forEach(x => { if (steps.has(x.s)) f(x).forEach(i => set.add(i)); }); return { t, n: set.size }; });
      const maxCase = Math.max(1, ...byCase.map(x => x.n));
      const byStep = stepsTo(3).map(s => { const set = new Set(); allTags().filter(t => q.cases.has(t)).forEach(t => S().rows[t].forEach(x => { if (x.s === s) f(x).forEach(i => set.add(i)); })); return { x: S().ladder[s] * 100 + "%", y: set.size }; });
      const base = allTags().map(t => ({ label: caseShort(t), value: S().base[t].surcharged.length / 120, text: String(S().base[t].surcharged.length), colour: "#3c5a85" }));
      const sim4 = new Set(planIdx(5));
      return `
        <p class="lede">All the runs at once: which manholes respond, how often, and how that changes with the weather and with the number of homes.</p>
        <h3>Count runs where a manhole</h3>
        ${chips(Object.entries(MEASURES).map(([k, m]) => [k, m[0]]), k => k === q.measure, "ms")}
        <h3>Build-out included</h3>
        ${chips([[1, "Up to 2041 (100%)"], [3, "With stress tests (to 300%)"]], k => +k === q.max, "mx")}
        <h3>Weather included <small>(click a bar to switch it)</small></h3>
        ${bars(byCase.map(x => ({ label: caseShort(x.t), value: x.n / maxCase, text: String(x.n), key: x.t, colour: q.cases.has(x.t) ? COL.accent : "#2a3a58", note: `${x.n} manholes respond in ${caseLabel(x.t)}` })), { clickable: true, labelWidth: 170 })}
        <div class="hint">Manholes that respond at least once, per weather case. Wetter days spread the response wider.</div>
        <div class="stats">${stat(responders, `of ${R().chambers.length} manholes respond at least once`)}${stat(runs, "runs counted")}</div>
        <h3>As homes are added <small>(weather above)</small></h3>
        ${lineChart(byStep, { unit: "manholes", fmt: v => v + " manholes" })}
        <h3>The most frequent responders <small>(click to find)</small></h3>
        <ol class="top">${top.map(([v, i]) => `<li><button type="button" class="link" data-find="${i}">${nameOf(i)}</button> <span class="dim">${v} runs${sim4.has(i) ? " · <b class='g'>recommended sensor</b>" : ""}</span></li>`).join("")}</ol>
        ${fold("Before any growth, by weather", bars(base, { labelWidth: 170 }) + `<div class="hint">Manholes already surcharged with today's homes. Wet weather alone already matters.</div>`)}
        ${nextBtn()}`;
    },
    wire() {
      const q = st.insights;
      on("[data-ms]", "onclick", e => { q.measure = e.currentTarget.dataset.ms; refresh(); });
      on("[data-mx]", "onclick", e => { q.max = +e.currentTarget.dataset.mx; refresh(); });
      on(".bars .click", "onclick", e => { const t = e.currentTarget.dataset.key; q.cases.has(t) ? q.cases.delete(t) : q.cases.add(t); if (!q.cases.size) q.cases.add(t); refresh(); });
      on("[data-find]", "onclick", e => { st.sel = +e.currentTarget.dataset.find; focus(st.sel); refresh(); });
    },
  };

  // ------------------------------------------------------------------ 5 ALGORITHMS
  const METHODS = [
    { id: "exact", label: "Best coverage (exact)", colour: COL.sensor, how: "For each number of sensors, the set that sees the most growth runs in the worst weather case, then on average, then warns of the most overloads, solved exactly over every manhole.", why: "The recommendation: no other set of that size covers more scenarios." },
    { id: "sim4", label: "Nested list", colour: "#7dd8ff", how: "Start with the best sensor for a design wet day, then add, one at a time, the manhole that most lifts the worst weather case.", why: "Grows from 1 to 5 sensors without moving any, at a cost in the worst case (81% against 88% at 5)." },
    { id: "greedyWorst", label: "Greedy: worst case", colour: "#b38cff", how: "From nothing, add the manhole that most lifts the worst weather case.", why: "Max–min: protects against the weather you did not plan for." },
    { id: "greedyAvg", label: "Greedy: average", colour: "#ff9f43", how: "From nothing, add the manhole that most lifts the average over weather.", why: "Classic maximum coverage. Greedy is guaranteed at least 63% of the best possible (Nemhauser et al. 1978); here it ties with the exact set at 5." },
    { id: "hydraulic", label: "Desk: flow/capacity", colour: "#ffd166", dash: true, how: "No model runs: the fullest pipes by Manning's equation, at least 150 m apart.", why: "What a desk study would choose. A baseline to beat." },
    { id: "homes", label: "Desk: most homes upstream", colour: "#e87ba4", dash: true, how: "No model runs: the manholes draining the most homes, at least 150 m apart.", why: "The 'watch the trunk' rule of thumb." },
    { id: "random", label: "Random sites", colour: "#6f81a3", dash: true, how: "Random manholes in the target regions, 500 draws.", why: "The floor any method must clear." },
  ];
  const methodSets = (id, k) => id === "random" ? null : id === "exact" ? planIdx(k) : (C().methods[id].sets[k - 1] || []);
  const ALGORITHMS = {
    layer() {
      const a = st.algorithms, set = methodSets(a.method, a.k) || [], m = METHODS.find(x => x.id === a.method);
      if (a.show && a.method !== "random" && a.method !== "exact") {
        const g = this.gainMap(), max = Math.max(...g.filter(v => v != null)), next = g.indexOf(max);
        return {
          pipe: triagePipe(true),
          node: i => set.slice(0, a.k - 1).includes(i) ? { fill: m.colour, r: 7 } : i === next ? { fill: "#ffffff", r: 7, ring: m.colour } : g[i] > 0 ? { fill: `hsl(${200 - 150 * g[i] / max},90%,${45 + 20 * g[i] / max}%)`, r: 2 + 6 * g[i] / max } : null,
          labels: sensorLabels(set.slice(0, a.k - 1)),
          legend: [[m.colour, `Sensors 1 to ${a.k - 1}`], ["#ffffff", `Choice for sensor ${a.k}`], ["hsl(50,90%,65%)", "Adds a lot"], ["hsl(200,90%,45%)", "Adds a little"]],
          tip: i => g[i] != null ? `Would add ${(g[i] * 100).toFixed(1)} points` : "",
        };
      }
      return {
        pipe: triagePipe(), node: i => set.includes(i) ? { fill: m.colour, r: 7 } : null, labels: sensorLabels(set),
        legend: [[m.colour, m.label], [COL.monitor, "Monitor region"], [COL.watch, "Watch region"]],
      };
    },
    // What each manhole would add as sensor k, given the method's first k-1 (on its own aim; the desk methods use flow/capacity).
    gainMap() {
      const a = st.algorithms, o = SIM4_TEST(), prev = (methodSets(a.method, a.k) || []).slice(0, a.k - 1), base = score(prev, o);
      if (a.method === "hydraulic" || a.method === "homes") { const v = R().chambers.map((_, i) => prev.includes(i) ? null : SCREENS[a.method === "hydraulic" ? "util" : "homes"].v(i, caseOf(D().design).ii)); const mx = Math.max(...v.filter(x => x != null)); return v.map(x => x == null ? null : x / mx); }
      const aim = a.method === "greedyAvg" ? "avg" : "worst";
      return gains(prev, o).map(sc => sc ? Math.max(0, aim === "avg" ? sc.avg - base.avg : (sc.worst - base.worst) + 0.01 * (sc.avg - base.avg)) : null);
    },
    panel() {
      const a = st.algorithms, m = METHODS.find(x => x.id === a.method), o = SIM4_TEST(), set = methodSets(a.method, a.k);
      const sc = set ? score(set, o) : null, rnd = C().random[a.k - 1];
      return `
        <p class="lede">A run is <b>seen</b> if a sensor's water rises by 10 mm or more. The task: pick a few manholes that see as many runs as possible, in every weather case, and warn before an overload.</p>
        <h3>Method</h3>
        ${chips(METHODS.map(x => [x.id, x.label, x.colour]), k => k === a.method, "mth")}
        <div class="card"><b>${m.label}</b><div>${m.how}</div><div class="dim">${m.why}</div></div>
        <h3>Sensors</h3>
        <div class="slider"><input id="alK" type="range" min="1" max="8" value="${a.k}" aria-label="Sensors"><span>${a.k} sensor${a.k === 1 ? "" : "s"}</span></div>
        <div class="stats">${sc ? `${stat(pct(sc.avg), "seen on average")}${stat(pct(sc.worst), "in the worst weather case")}` : `${stat(pct(rnd.avg), "seen on average (mean of draws)")}${stat(pct(rnd.worst), "worst case (mean)")}`}</div>
        ${a.method !== "random" && a.method !== "exact" ? `<label class="tog"><input type="checkbox" id="alShow" ${a.show ? "checked" : ""}> Show how sensor ${a.k} is chosen: what every manhole would add</label>` : ""}
        ${fold("Why these methods", `<ul class="plain">
          <li><b>Coverage, not prediction.</b> The runs say which manhole sees which growth. Choosing sensors is then a set-cover problem, a standard formulation for sensor placement.</li>
          <li><b>Greedy</b> is fast, explainable ("this site adds most") and close to optimal for coverage problems.</li>
          <li><b>Worst case first</b>, because the weather is not known in advance.</li>
          <li><b>Exact solver</b> for the recommendation: with dominated manholes removed, about 20 candidates remain, few enough to search every combination.</li>
          <li><b>Desk methods and random</b> are the baselines: what you get without the simulation.</li></ul>`)}
        ${nextBtn()}`;
    },
    wire() {
      const a = st.algorithms;
      on("[data-mth]", "onclick", e => { a.method = e.currentTarget.dataset.mth; refresh(); });
      $("#alK").oninput = e => { a.k = +e.target.value; refresh(); };
      const s = $("#alShow"); if (s) s.onchange = e => { a.show = e.target.checked; refresh(); };
    },
  };

  // ------------------------------------------------------------------ 6 COMPARE
  const COMPARE = {
    metrics(id, k, mm) {
      const o = { ...SIM4_TEST(), mm };
      if (id === "random") { const r = C().random[k - 1]; return { avg: mm === 10 ? r.avg : null, worst: mm === 10 ? r.worst : null, warned: mm === 10 ? r.warned : null, warnable: 11, unseen: mm === 10 ? r.avg : null, fail: null, note: "mean of 500 draws" }; }
      const set = methodSets(id, k), sc = score(set, o);
      let unseen = null;
      if (mm === 10) {
        if (id === "sim4") { const t = table("How it holds up"), r = trow(t, k); unseen = r ? parseFloat(r[1]) / 100 : null; }
        else if (id === "exact") unseen = C().methods.exact.unseen[k - 1];
        else if (C().methods[id].unseen) unseen = C().methods[id].unseen[k - 1];
        else if (id === "hydraulic" || id === "homes") unseen = sc.avg; // they use no weather, so every case is unseen
      }
      return { avg: sc.avg, worst: sc.worst, warned: sc.warned, warnable: sc.warnable, unseen, fail: worstFailure(set, o), set };
    },
    layer() {
      const c = st.compare, m = METHODS.find(x => x.id === c.method), set = methodSets(c.method, c.k) || [], rec = new Set(planIdx(c.k)), other = c.method !== "exact";
      return {
        pipe: triagePipe(true),
        node: i => set.includes(i) ? (c.failed.has(i) ? { fill: COL.failed, r: 7, ring: COL.tip } : { fill: m.colour, r: 7, ring: other && rec.has(i) ? COL.sensor : undefined }) : other && rec.has(i) ? { ring: COL.sensor, r: 6 } : null,
        labels: sensorLabels(set),
        legend: [[m.colour, `${m.label} (click a sensor to fail it)`], ...(other ? [[COL.sensor, "Recommended set", "ring"]] : []), [COL.failed, "Failed sensor"]],
        tip: i => set.includes(i) ? (c.failed.has(i) ? "Failed: click to restore" : "Click to make it fail") : "",
      };
    },
    panel() {
      const c = st.compare, rows = METHODS.map(m => ({ m, x: this.metrics(m.id, c.k, c.mm) }));
      const best = f => Math.max(...rows.map(r => r.x[f] ?? -1));
      const cell = (r, f, fmt) => { const v = r.x[f]; return `<td class="${v != null && v >= best(f) - 1e-9 ? "best" : ""}">${v == null ? "–" : fmt(v)}</td>`; };
      const sel = rows.find(r => r.m.id === c.method), set = sel.x.set || [], working = set.filter(i => !c.failed.has(i));
      const live = set.length ? score(working, { ...SIM4_TEST(), mm: c.mm }) : null;
      const series = METHODS.map(m => ({ key: m.id, label: m.label, colour: m.colour, dash: m.dash, on: m.id === c.method, ys: Array.from({ length: 8 }, (_, k) => m.id === "random" ? C().random[k].worst : score(methodSets(m.id, k + 1), { ...SIM4_TEST(), mm: c.mm }).worst) }));
      const wet = wetTags(), alone = set.map(i => wet.map(tag => score([i], { ...SIM4_TEST(), mm: c.mm, cases: [tag] }).per[0]));
      return `
        <p class="lede">Seven ways to place the same number of sensors, scored the same way on the same runs. Click a row to map it.</p>
        <div class="slider"><input id="cmK" type="range" min="1" max="8" value="${c.k}" aria-label="Sensors"><span>${c.k} sensor${c.k === 1 ? "" : "s"} · ${money(c.k * PRICE)}</span></div>
        ${chips(RULES.map(m => [m, `Seen at ${m} mm`]), k => +k === c.mm, "cmm")}
        <table class="cmp"><tr><th>Method</th><th title="Share of growth runs seen, averaged over the 7 wet cases">Avg</th><th title="The worst of the 7 wet cases">Worst</th><th title="Overloads with a sensor rising one step before the first new surcharge">Warned</th><th title="Each weather case scored with sensors chosen without it">Unseen</th><th title="Worst case after the most damaging single sensor failure">1 fails</th></tr>
          ${rows.map(r => `<tr data-row="${r.m.id}" class="${r.m.id === c.method ? "on" : ""}"><td><i class="sw" style="background:${r.m.colour}"></i>${r.m.label}</td>${cell(r, "avg", pct)}${cell(r, "worst", pct)}${cell(r, "warned", v => (Math.round(v * 10) / 10) + "/" + r.x.warnable)}${cell(r, "unseen", pct)}${cell(r, "fail", pct)}</tr>`).join("")}</table>
        <div class="hint">Avg and Worst: share of growth runs seen, over the 7 wet cases. Unseen: on weather the sensors were not chosen for. 1 fails: worst case after the most damaging failure. Green: best in the column. Desk methods use no weather, so all weather is unseen to them. ${c.mm !== 10 ? "Random draws are scored at 10 mm only." : ""}</div>
        <h3>Worst case as sensors are added <small>(click a line)</small></h3>
        ${curves(series, { at: c.k })}
        <h3>Stress the selected plan <small>(click its sensors on the map)</small></h3>
        ${live ? `<div class="stats">${stat(pct(live.avg), "seen on average", c.failed.size ? "bad" : "")}${stat(pct(live.worst), "worst case", c.failed.size ? "bad" : "")}</div>
          <div class="hint">${c.failed.size ? `<b>${c.failed.size} failed.</b> <button type="button" class="link" id="cmRestore">Restore all</button>` : "In a real deployment, 62 of 82 level sensors stayed in service over about a year (Do et al. 2023)."}</div>
          <table class="matrix"><tr><th></th>${wet.map(t => `<th title="${caseLabel(t)}">${caseTiny(t)}</th>`).join("")}</tr>
          ${alone.map((row, j) => `<tr><th>S${j + 1}</th>${row.map(x => `<td style="background:rgba(46,245,107,${(x.share * 0.85).toFixed(2)})" title="${x.hit} of ${x.n}">${Math.round(x.share * 100)}</td>`).join("")}</tr>`).join("")}</table>
          <div class="hint">% of runs each sensor sees alone, per weather case. A column with one green cell rests on one site.</div>` : `<div class="card muted">Random has no single set to stress.</div>`}
        ${fold("Read these carefully", `<ul class="plain"><li>Percentages count only growth that shows somewhere (≥ 10 mm at some manhole).</li><li>Many sets tie: read the plan as areas, not exact lids.</li><li>The best set changes with the count: going from 4 to 5 sensors moves some of them. The nested list never moves a sensor, but sees less in the worst case (81% against 88% at 5); it does slightly better on unseen weather (77% against 75%).</li><li>One site carries the worst case in both: if it fails, the worst case drops to 0%. Check that site first, or double it.</li><li>Costs are ${PRICE_NOTE}.</li></ul>`)}
        ${nextBtn()}`;
    },
    click(i) {
      const c = st.compare, set = methodSets(c.method, c.k) || []; if (i === null || !set.includes(i)) return false;
      c.failed.has(i) ? c.failed.delete(i) : c.failed.add(i); refresh(); return true;
    },
    wire() {
      const c = st.compare;
      $("#cmK").oninput = e => { c.k = +e.target.value; c.failed.clear(); refresh(); };
      on("[data-cmm]", "onclick", e => { c.mm = +e.currentTarget.dataset.cmm; refresh(); });
      on("[data-row]", "onclick", e => { c.method = e.currentTarget.dataset.row; c.failed.clear(); refresh(); });
      on(".curves .click", "onclick", e => { c.method = e.currentTarget.dataset.key; c.failed.clear(); refresh(); });
      const r = $("#cmRestore"); if (r) r.onclick = () => { c.failed.clear(); refresh(); };
    },
  };

  // ------------------------------------------------------------------ 7 CROSS-CHECK
  const CHECK = {
    init() { const c = st.check; c.tag ??= D().design; c.ii ??= caseOf(D().design).ii; },
    data() {
      const c = st.check, sc = SCREENS[c.screen], ii = caseOf(c.tag).ii, resp = responseAt(c.tag);
      const xs = R().chambers.map((_, i) => sc.v(i, ii, c.tag)), ys = resp;
      const keep = xs.map((x, i) => x != null && x > 0 && ys[i] > 0.05);
      return { xs, ys, keep, rho: spearman(xs.filter((x, i) => keep[i]), ys.filter((y, i) => keep[i])) };
    },
    layer() {
      const c = st.check, { xs, keep } = this.data(), sim4 = new Set(planIdx(5));
      const sorted = xs.filter((x, i) => keep[i]).sort((a, b) => a - b), q = v => sorted.findIndex(x => x >= v) / sorted.length;
      return {
        pipe: () => [COL.pipe, 1],
        node: i => sim4.has(i) ? { fill: COL.sensor, r: 7 } : keep[i] ? { fill: SEQ[Math.min(5, Math.floor(q(xs[i]) * 6))], r: 3.5 } : null,
        labels: sensorLabels(planIdx(5)),
        legend: [[SEQ[0], `Low ${SCREENS[c.screen].label.toLowerCase()}`], [SEQ[5], "High"], [COL.sensor, "Recommended sensor"]],
        tip: i => keep[i] ? `${SCREENS[c.screen].label}: ${SCREENS[c.screen].fmt(xs[i])}` : "",
      };
    },
    panel() {
      const c = st.check, d = this.data(), sim4 = new Set(planIdx(5)), sc = SCREENS[c.screen];
      const pts = d.xs.map((x, i) => ({ x, y: d.ys[i], i, cls: sim4.has(i) ? "sensor" : i === st.sel ? "sel" : "" })).filter(p => d.keep[p.i]);
      const sorted = pts.map(p => p.x).sort((a, b) => a - b), rank = v => Math.round(sorted.filter(x => x < v).length / sorted.length * 100);
      // Where they disagree: big simulated rise, low screen value.
      const ysorted = pts.map(p => p.y).sort((a, b) => a - b), yr = v => ysorted.filter(x => x < v).length / ysorted.length;
      const odd = pts.filter(p => yr(p.y) > 0.8 && rank(p.x) < 30).sort((a, b) => b.y - a.y).slice(0, 4);
      const r = d.rho.rho, word = r > 0.6 ? "strong" : r > 0.3 ? "moderate" : r > 0 ? "weak" : "no";
      return `
        <p class="lede">If the simulation is sound, simple hydraulics should point the same way. Compare a desk screen with the simulated rise at every manhole.</p>
        <h3>Desk screen</h3>
        ${chips(Object.entries(SCREENS).map(([k, s]) => [k, s.label]), k => k === c.screen, "scr")}
        ${sc.note ? `<div class="hint">${sc.note}</div>` : ""}
        <h3>Against the simulated rise at 2041 <small>(largest over regions)</small></h3>
        <select id="ckCase">${allTags().filter(t => caseOf(t).ii > 0).map(t => `<option value="${t}" ${t === c.tag ? "selected" : ""}>${caseLabel(t)}</option>`).join("")}</select>
        ${scatter(pts, { logX: c.screen !== "depth", logY: true, xl: sc.label + " (log)", yl: "simulated rise, mm (log)", fx: sc.fmt, fy: v => v.toFixed(1) + " mm" })}
        <div class="stats">${stat("ρ = " + r.toFixed(2), `${word} rank agreement over ${d.rho.n} manholes`)}${(() => { const r5 = planIdx(5).map(i => rank(d.xs[i])).filter(v => !isNaN(v)); return stat(r5.length ? `${Math.min(...r5)}–${Math.max(...r5)}` : "–", "percentile range of the 5 recommended sensors on this screen"); })()}</div>
        <div class="hint">Green dots are the recommended sensors. The screen and the model agree on <b>where</b> to look.</div>
        <h3>Where they disagree</h3>
        ${odd.length ? `<ul class="plain">${odd.map(p => `<li><button type="button" class="link" data-find="${p.i}">${nameOf(p.i)}</button> <span class="dim">rises ${p.y.toFixed(0)} mm, but sits at percentile ${rank(p.x)} on the screen</span></li>`).join("")}</ul>` : `<div class="hint">No big disagreements on this screen.</div>`}
        <div class="hint">These rise because water <b>backs up from downstream</b>, which a pipe-by-pipe screen cannot see. And ranking well is not placing well: "most homes upstream" ranks manholes much like the model does, yet as a placement it sees little (Compare), because the big trunks barely move when one region grows. That is why we simulate the whole network rather than only screening it.</div>
        ${this.manning()}
        ${nextBtn()}`;
    },
    manning() {
      const c = st.check, i = st.sel ?? planIdx(5)[0], p = H.outPipe[i]; if (p == null) return "";
      const g = G(), now = util(p, c.ii), later = util(p, c.ii, c.extra);
      const bar = (v, l) => `<div class="gauge"><span style="width:${Math.min(100, v * 100)}%;background:${v >= 1 ? COL.tip : v >= 0.7 ? COL.watch : COL.accent}"></span><em>${l}: ${pct(v)}</em></div>`;
      return `<h3>Manning check <small>(click any manhole)</small></h3><div class="card"><b>${nameOf(i)}</b> <span class="dim">pipe out: ${g.dia[p]} mm ${matName(g.pmat[p])} at ${g.pslope[p]}%, full capacity ${g.pcap[p].toFixed(1)} L/s, ${Math.round(H.pH[p])} homes upstream</span>
        <div class="sub">Extra homes upstream</div><div class="slider"><input id="ckX" type="range" min="0" max="600" step="10" value="${c.extra}"><span>+${c.extra}</span></div>
        <div class="sub">Leakage, L/s per 100 m</div><div class="slider"><input id="ckI" type="range" min="0" max="0.4" step="0.01" value="${c.ii}"><span>${c.ii.toFixed(2)}</span></div>
        ${bar(now, "Today")}${bar(later, "With the extra homes")}
        <div class="dim small">Full-pipe flow ratio. A pipe can surcharge below 100% when water backs up from downstream, which is what the model adds.</div></div>`;
    },
    wire() {
      const c = st.check;
      on("[data-scr]", "onclick", e => { c.screen = e.currentTarget.dataset.scr; refresh(); });
      $("#ckCase").onchange = e => { c.tag = e.target.value; refresh(); };
      on("[data-find]", "onclick", e => { st.sel = +e.currentTarget.dataset.find; focus(st.sel); refresh(); });
      on(".scatter .dot", "onclick", e => { st.sel = +e.currentTarget.dataset.i; refresh(); });
      on(".scatter .dot", "onmouseenter", e => { st.hover = +e.currentTarget.dataset.i; draw(); });
      const x = $("#ckX"); if (x) x.oninput = e => { c.extra = +e.target.value; refresh(); };
      const ii = $("#ckI"); if (ii) ii.oninput = e => { c.ii = +e.target.value; refresh(); };
    },
  };

  // ------------------------------------------------------------------ 8 SENSOR TYPES
  const SENSOR_TYPES = [
    { id: "ultra", short: "Ultrasonic", name: "Ultrasonic level", colour: "#2ef56b", at: () => "lid", reads: "Distance down to the water, every few minutes", good: "Continuous level, no contact with sewage, battery and radio in one unit. Used at scale for blockages.", bad: "Must not be submerged; foam and ladders can confuse it.", fit: "Best fit: level is the direct sign of lost capacity.", cost: "$$" },
    { id: "radar", short: "Radar", name: "Radar level", colour: "#7dd8ff", at: () => "lid", reads: "Distance down to the water", good: "Like ultrasonic but less affected by foam, temperature and condensation.", bad: "Dearer; same mounting limits.", fit: "Good fit where ultrasonic struggles.", cost: "$$$" },
    { id: "pressure", short: "Pressure", name: "Submerged pressure level", colour: "#ffd166", at: () => 0, reads: "Depth from the weight of water above it", good: "Reads through surcharge, when the shaft fills.", bad: "Sits in the sewage: fouling, drift, more upkeep.", fit: "Useful where surcharge depth itself matters.", cost: "$$" },
    { id: "float", short: "Float", name: "Float switch", colour: "#ff9f43", at: o => o.base + 25, reads: "On or off at one set height", good: "Cheap and simple.", bad: "Says nothing until the water reaches it: no trend, so no early warning of growth.", fit: "Weak fit: in Sim 4, floats see 0% on unseen weather.", cost: "$" },
    { id: "flow", short: "Flow meter", name: "Area–velocity flow meter", colour: "#b38cff", inPipe: true, at: () => 0, reads: "Depth and speed in the pipe, so flow in L/s", good: "Measures load directly; the standard for flow surveys and model calibration.", bad: "Dear, needs a clean straight pipe, regular cleaning; usually short campaigns.", fit: "Best for calibrating the model, not for many sites.", cost: "$$$$" },
  ];
  const SENSORS = {
    // A recommended site whose water sits below the pipe top before growth, so the cutaway has room to show the rise.
    site() { const s = planIdx(5); return s.find(i => H.outPipe[i] != null && baseMm(D().design, i) < 0.5 * G().dia[H.outPipe[i]]) ?? s[0]; },
    init() { const s = st.sensors; if (s.water == null) s.water = baseMm(D().design, this.site()) + 15; },
    layer() {
      const t = SENSOR_TYPES.find(x => x.id === st.sensors.type), set = planIdx(5);
      return { pipe: triagePipe(true), node: i => set.includes(i) ? { fill: t.colour, r: 7 } : null, labels: sensorLabels(set), legend: [[t.colour, `${t.name} at the five recommended sites`]] };
    },
    panel() {
      const s = st.sensors, t = SENSOR_TYPES.find(x => x.id === s.type), i = this.site(), f = manholeFacts(i), base = baseMm(D().design, i), depthM = f.nd.depth;
      const at = t.at({ base }), reading = t.id === "float" ? (s.water >= at ? "ON: water has reached it" : "off: no information yet")
        : t.id === "flow" ? `≈ ${Math.min(s.water, f.dia).toFixed(0)} mm deep, flow computed from speed` : (at === "lid" && s.water >= depthM * 1000 - 150) ? "Submerged: reading lost" : `${Math.round(s.water)} mm`;
      const lvl = table("Level or float"), budgets = lvl.rows.slice(1), bi = Math.max(0, budgets.findIndex(r => r[0] === "$" + s.budget + "k")), br = budgets[bi];
      const split = v => v.split("/").map(x => parseFloat(x) / 100);
      const [lw, la] = split(br[1]), [fw, fa] = split(br[4]);
      return `
        <p class="lede">Level is the most direct sign that a pipe is running out of room, so the plan uses level sensors. Pick a type to see where it sits and what it reads.</p>
        ${chips(SENSOR_TYPES.map(x => [x.id, x.name, x.colour]), k => k === s.type, "sty")}
        <div class="cutwrap">${cutaway({ depthM, dia: f.dia, water: s.water, base, sensor: t.id, title: t.name })}</div>
        <div class="slider"><input id="snW" type="range" min="0" max="${Math.round(Math.min(depthM * 1000, f.dia * 4))}" value="${Math.round(s.water)}" aria-label="Water level"><span>Reads: <b>${reading}</b></span></div>
        <table class="mini kv"><tr><th>Reads</th><td>${t.reads}</td></tr><tr><th>Good</th><td>${t.good}</td></tr><tr><th>Limits</th><td>${t.bad}</td></tr><tr><th>For growth</th><td><b>${t.fit}</b></td></tr><tr><th>Cost</th><td>${t.cost}</td></tr></table>
        <h3>Level sensors or floats, for the same money</h3>
        <div class="slider"><input id="snB" type="range" min="0" max="${budgets.length - 1}" value="${bi}" aria-label="Budget"><span>${br[0]}</span></div>
        ${bars([{ label: "Level: worst case", value: lw, colour: COL.sensor }, { label: "Level: average", value: la, colour: "#1f9e4c" }, { label: "Floats: worst case", value: fw, colour: "#ff9f43" }, { label: "Floats: average", value: fa, colour: "#b36a20" }], { labelWidth: 150 })}
        <div class="hint">${br[3]} for floats. On weather not chosen for: level ${br[2]}, floats ${br[5]}. From Sim 4's level-or-float study (on its nested list), at ${PRICE_NOTE}.</div>
        <h3>Who does this already</h3>
        <ul class="lit">
          <li><b>Sydney Water</b>: 8,000+ level sensors, 15,000 more planned; 300–370+ blockages caught before overflow.</li>
          <li><b>United Utilities</b> (UK): about 20,000 manhole level sensors; a pilot cut blockages by 80%.</li>
          <li><b>Yorkshire Water</b> (UK): 27,000 level monitors planned for 2025–30.</li>
          <li><b>South Bend</b> (US): about 150 wireless sensors driving real-time control; combined overflows down 70%, about US$500 m of building avoided.</li>
          <li><b>An Australian level-sensor trial</b>: 82 ultrasonic sensors, 62 still working after a year (Do et al. 2023).</li>
          <li><b>Kansas City</b> (US) updates its network model every year from monitoring; <b>Anne Arundel County</b> (US) lifted a building pause once measured peak flows replaced design assumptions.</li></ul>
        <div class="hint">Most of these chose sites by judgement or incident history; none publish an optimisation method. Source: the team's grey-literature review. Mounting rules: CIWEM (2017).</div>
        ${nextBtn()}`;
    },
    wire() {
      const s = st.sensors;
      on("[data-sty]", "onclick", e => { s.type = e.currentTarget.dataset.sty; refresh(); });
      $("#snW").oninput = e => { s.water = +e.target.value; refresh(); };
      $("#snB").oninput = e => { const b = table("Level or float").rows.slice(1)[+e.target.value][0]; s.budget = parseInt(b.slice(1)); refresh(); };
    },
  };

  // ------------------------------------------------------------------ 9 REPEAT
  const REPEAT = {
    init() { const r = st.repeat; r.regions ??= new Set(sim4Targets()); r.cases ??= new Set(wetTags()); },
    opts() { const r = st.repeat; return { cases: allTags().filter(t => r.cases.has(t)), regions: [...r.regions].sort((a, b) => a - b), mm: r.mm, aim: r.aim }; },
    current() { const r = st.repeat; return r.manual ? r.mine : (r.result ? r.result.set : []); },
    layer() {
      const r = st.repeat, set = this.current(), sim4 = new Set(planIdx(5));
      return {
        pipe: p => { const ri = pipeRegion(p); return ri >= 0 && r.regions.has(ri) ? [REGION_COLS[regionId(ri)], 2.2] : [COL.pipe, 1]; },
        overlayPipe: p => r.regions.has(paint.overlayOf[G().up[p]]) ? [REGION_COLS[regionId(paint.overlayOf[G().up[p]])], 4] : null,
        node: i => set.includes(i) ? { fill: COL.sensor, r: 7, ring: sim4.has(i) ? COL.sim4 : undefined } : sim4.has(i) ? { ring: COL.sim4, r: 6 } : null,
        labels: [...regionLabels(ri => r.regions.has(ri) ? REGION_COLS[regionId(ri)] : "#3b4b68"), ...sensorLabels(set)],
        legend: [[COL.sensor, r.manual ? "Your sensor (click a manhole to add or remove)" : "Your sensor"], [COL.sim4, "In the recommended five", "ring"], ["#c9d1d9", "Coloured: regions you watch"]],
      };
    },
    panel() {
      const r = st.repeat, o = this.opts(), set = this.current();
      const sc = set.length && o.cases.length && o.regions.length ? score(set, o) : null;
      const overlap = set.filter(i => planIdx(5).includes(i)).length;
      return `
        <p class="lede">The method is the product, not the list. Change what matters and re-run it, or place sensors by hand and see how they score.</p>
        <h3>1. Regions to watch <small>(recommended: Monitor and Watch)</small></h3>
        ${chips(S().regions.map((x, ri) => [ri, regionLabel(ri), REGION_COLS[x.id]]), k => r.regions.has(+k), "rreg")}
        <h3>2. Weather to cover</h3>
        <div class="checks">${allTags().map(t => `<label><input type="checkbox" data-case="${t}" ${r.cases.has(t) ? "checked" : ""}> ${caseLabel(t)}</label>`).join("")}</div>
        <h3>3. Rule and aim</h3>
        ${chips(RULES.map(m => [m, `${m} mm`]), k => +k === r.mm, "rmm")}
        ${chips([["worst", "Best worst case"], ["avg", "Best average"]], k => k === r.aim, "aim")}
        <h3>4. Sensors</h3>
        <div class="slider"><input id="rK" type="range" min="1" max="10" value="${r.k}" aria-label="Sensor budget"><span>${r.k} sensor${r.k === 1 ? "" : "s"}</span></div>
        <div class="row"><button type="button" class="primary" id="rRun">Place sensors</button>
          <label class="tog"><input type="checkbox" id="rManual" ${r.manual ? "checked" : ""}> Place my own</label></div>
        ${sc ? `
          <div class="stats">${stat(pct(sc.avg), "seen on average")}${stat(pct(sc.worst), "worst case")}${stat(`${sc.warned} of ${sc.warnable}`, "overloads warned")}${stat(r.result && !r.manual && r.result.unseen != null ? pct(r.result.unseen) : "–", "on weather not chosen for")}</div>
          ${bars(sc.per.map(c => ({ label: caseShort(c.tag), value: c.share, text: `${c.hit}/${c.n}`, colour: c.share >= 0.8 ? COL.sensor : c.share >= 0.5 ? COL.watch : COL.monitor })), { labelWidth: 170 })}
          <div class="hint">${overlap} of your ${set.length} are in the recommended five. ${!r.manual && r.result ? "Each sensor is the one that adds most, given those before it: fast, and usually close to the exact best (Compare). Many sets tie, so different sites can score the same." : ""}</div>`
          : `<div class="card muted">${r.manual ? "Click manholes on the map to place sensors." : "Press Place sensors."}</div>`}
        <h3>For another suburb</h3>
        <table class="mini"><tr><th>Step</th><th>Needs</th></tr>
          <tr><td><b>1 Network</b></td><td>Pipes (size, material, inverts), manholes (lid, floor), homes connected, pump stations</td></tr>
          <tr><td><b>2 Growth</b></td><td>Where homes are expected and how many; people per home</td></tr>
          <tr><td><b>3 Weather</b></td><td>Leakage levels to test; ideally real level records of a normal day</td></tr>
          <tr><td><b>4 Runs</b></td><td>Each region grown in steps, in each weather case (SWMM, a few hours on a laptop)</td></tr>
          <tr><td><b>5 Choose</b></td><td>This page's steps, on the new runs</td></tr></table>
        <a class="link" href="../simulation4/redo.html" target="_blank" rel="noopener">The full redo guide ↗</a>
        ${fold("How to read the results", `<ul class="plain"><li><b>Worst case</b> is the number that matters when the weather is unknown; <b>average</b> flatters.</li><li>A sensor that sees one weather case alone (Compare's matrix) is a single point of failure.</li><li>If most manholes tie, the site is an <b>area</b>: choose the lid by access and signal.</li><li>"Leave" means room left on the tested day, not never.</li></ul>`)}
        ${fold("This tackles one objective", `<p class="dim">Seeing growth is one reason to monitor. A real plan also weighs:</p><div class="tags"><span>Blockages and chokes</span><span>Overflow near sensitive places</span><span>Odour</span><span>Access and safety</span><span>Radio signal</span><span>Existing meters and pump stations</span><span>Whole-life cost</span></div><p class="dim">Each becomes a weight or a constraint in the same search. Next research shows one: risk.</p>`)}
        ${nextBtn()}`;
    },
    run() {
      const r = st.repeat, o = this.opts();
      if (!o.cases.length || !o.regions.length) { r.result = null; refresh(); return; }
      $("#rRun").textContent = "Placing…"; $("#rRun").disabled = true;
      setTimeout(() => { const g = greedy(o, r.k); r.result = { set: g.set, unseen: unseenWeather(o, r.k) }; r.manual = false; refresh(); }, 30);
    },
    click(i) { const r = st.repeat; if (!r.manual || i === null) return false; r.mine = r.mine.includes(i) ? r.mine.filter(j => j !== i) : [...r.mine, i]; refresh(); return true; },
    wire() {
      const r = st.repeat;
      on("[data-rreg]", "onclick", e => { const k = +e.currentTarget.dataset.rreg; r.regions.has(k) ? r.regions.delete(k) : r.regions.add(k); r.result = null; refresh(); });
      on("[data-case]", "onchange", e => { const b = e.currentTarget; b.checked ? r.cases.add(b.dataset.case) : r.cases.delete(b.dataset.case); r.result = null; refresh(); });
      on("[data-rmm]", "onclick", e => { r.mm = +e.currentTarget.dataset.rmm; r.result = null; refresh(); });
      on("[data-aim]", "onclick", e => { r.aim = e.currentTarget.dataset.aim; r.result = null; refresh(); });
      $("#rK").oninput = e => { r.k = +e.target.value; e.target.nextElementSibling.textContent = `${r.k} sensor${r.k === 1 ? "" : "s"}`; };
      $("#rK").onchange = () => { r.result = null; refresh(); };
      $("#rRun").onclick = () => this.run();
      $("#rManual").onchange = e => { r.manual = e.target.checked; refresh(); };
    },
  };

  // ------------------------------------------------------------------ 10 NEXT RESEARCH
  // (a) Risk: each run weighted (1 - a) + a x (Sim 4 risk weight, scaled to 0..1). (b) Virtual sensing: a manhole is
  // "covered" when its rise across the runs tracks a sensor's closely (r² at least the threshold): a simple stand-in
  // for what a trained graph network (Edge-STGCN) would do from the same sensors.
  const FUTURE = {
    riskOpts(alpha) { return { ...SIM4_TEST(), aim: "avg", w: alpha > 0 ? (tag, r, s) => (1 - alpha) + alpha * riskW(tag, r, s) / 90 : null }; },
    profiles() {
      if (this._prof) return this._prof;
      const rows = []; allTags().forEach(t => S().rows[t].forEach(x => { if (x.s <= FULL()) rows.push(x); }));
      const V = R().chambers.map(() => new Float64Array(rows.length));
      rows.forEach((x, k) => x.rise.forEach(([i, m]) => { V[i][k] = m; }));
      return (this._prof = V);
    },
    virtual(set, r2) {
      const V = this.profiles(), n = V[0].length, stats = V.map(v => { let s = 0, ss = 0; for (let k = 0; k < n; k++) { s += v[k]; ss += v[k] * v[k]; } const m = s / n; return { m, sd: Math.sqrt(Math.max(0, ss / n - m * m)), max: Math.max(...v) }; });
      const corr = (a, b) => { const A = V[a], B = V[b]; let t = 0; for (let k = 0; k < n; k++) t += (A[k] - stats[a].m) * (B[k] - stats[b].m); return t / n / (stats[a].sd * stats[b].sd || 1); };
      const responsive = stats.map((s, i) => s.max >= 10);
      const cover = R().chambers.map((_, i) => { if (!responsive[i] || set.includes(i)) return null; let best = 0; set.forEach(j => { const c = corr(i, j); if (c * c > best) best = c * c; }); return best; });
      const nResp = responsive.filter(Boolean).length - set.filter(i => responsive[i]).length, ok = cover.filter(v => v != null && v >= r2).length;
      return { cover, nResp, ok };
    },
    layer() {
      const f = st.future, set = planIdx(f.vsK), v = this.virtual(set, f.r2), risk = f.risk ? f.risk.set : [];
      return {
        pipe: () => [COL.pipe, 1],
        node: i => set.includes(i) ? { fill: COL.sensor, r: 7 } : risk.includes(i) ? { ring: "#ff9f43", r: 7, rw: 3 } : v.cover[i] == null ? null : v.cover[i] >= f.r2 ? { fill: "#39c5cf", r: 4 } : { fill: "#4a5568", r: 3 },
        labels: sensorLabels(set),
        legend: [[COL.sensor, "Recommended sensors"], ["#39c5cf", "Responsive manhole a sensor can stand in for"], ["#4a5568", "Responsive, not covered"], ...(risk.length ? [["#ff9f43", "Risk-weighted choice", "ring"]] : [])],
        tip: i => v.cover[i] != null ? `Best r² with a sensor: ${v.cover[i].toFixed(2)}` : "",
      };
    },
    panel() {
      const f = st.future, set = planIdx(f.vsK), v = this.virtual(set, f.r2), rk = f.risk;
      const base = score(planIdx(5), this.riskOpts(f.alpha));
      return `
        <p class="lede">Three directions that build on this work. Two can be tried here.</p>
        <h3>1. Add a risk objective</h3>
        <div class="hint">Weight each run by severity × likelihood (Sim 4's risk weights: homes draining through, and how close the pipe gets to its limit), so sensors lean towards places where an overflow would matter most.</div>
        <div class="slider"><input id="fuA" type="range" min="0" max="1" step="0.25" value="${f.alpha}" aria-label="Risk weight"><span>Risk weight ${Math.round(f.alpha * 100)}%</span></div>
        <div class="row"><button type="button" class="primary" id="fuRun">Re-place 5 sensors</button></div>
        ${rk ? `<div class="stats">${stat(pct(rk.sc.avg), "risk-weighted growth seen (new five)")}${stat(pct(base.avg), "same measure, the recommended five")}</div><div class="hint">${rk.set.filter(i => planIdx(5).includes(i)).length} of 5 sites are shared with the recommended five (orange rings on the map).</div>` : `<div class="hint">The recommended five on this measure: <b>${pct(base.avg)}</b>.</div>`}
        <h3>2. Learn the network: Edge-STGCN</h3>
        <div class="flow small"><span>SWMM runs</span><i>→</i><span>train a graph network on pipes</span><i>→</i><span>predict every manhole from a few sensors</span><i>→</i><span>score placements fast</span></div>
        <div class="hint">He et al. (2025): an edge-based spatio-temporal graph network using pipe attributes (invert, size, length) predicted 88.6% of nodes reliably from 10% monitored, against 47% for a plain graph network. It would let us score placements by how well they reconstruct the whole network, and test new suburbs and storms without rerunning SWMM.</div>
        <div class="sub">A simple stand-in: which responsive manholes rise in step with one of the sensors?</div>
        ${chips([[1, "1 sensor"], [3, "3"], [5, "5 sensors"], [8, "8"]], k => +k === f.vsK, "vk")}
        <div class="slider"><input id="fuR" type="range" min="0.5" max="0.95" step="0.05" value="${f.r2}" aria-label="Closeness"><span>r² ≥ ${f.r2.toFixed(2)}</span></div>
        <div class="stats">${stat(`${v.ok} of ${v.nResp}`, "responsive manholes a sensor could stand in for")}${stat(pct(v.ok / v.nResp), "virtually covered")}</div>
        <div class="hint">Correlation only: a trained network would do better, and must be tested on held-out runs.</div>
        <h3>3. Also worth doing</h3>
        <ul class="plain"><li><b>Calibrate</b> on real level records of a normal day; then rainfall time series instead of steady leakage.</li><li><b>Timing:</b> homes arriving year by year, to say <i>when</i>, not only where.</li><li><b>Failures in the objective:</b> plan for 1 in 4 sensors going down.</li><li><b>Dual use:</b> check the same sites against blockage hotspots.</li></ul>
        ${nextBtn()}`;
    },
    wire() {
      const f = st.future;
      $("#fuA").oninput = e => { f.alpha = +e.target.value; f.risk = null; refresh(); };
      $("#fuRun").onclick = () => { $("#fuRun").textContent = "Placing…"; $("#fuRun").disabled = true; setTimeout(() => { const o = this.riskOpts(f.alpha), g = greedy(o, 5); f.risk = { set: g.set, sc: score(g.set, o) }; refresh(); }, 30); };
      on("[data-vk]", "onclick", e => { f.vsK = +e.currentTarget.dataset.vk; refresh(); });
      $("#fuR").oninput = e => { f.r2 = +e.target.value; refresh(); };
    },
  };

  // ------------------------------------------------------------------ 11 CONCLUSION
  const CONCLUDE = {
    layer() {
      const set = planIdx(st.conclude.k);
      return {
        pipe: p => { const ri = pipeRegion(p); const t = ri >= 0 && D().triage[regionId(ri)]; return t ? [COL[t], t === "leave" ? 1.2 : 2.4] : [COL.pipe, 1]; },
        overlayPipe: p => [COL[D().triage[regionId(paint.overlayOf[G().up[p]])]], 4],
        node: i => set.includes(i) ? { fill: COL.sensor, r: 7 } : null,
        labels: [...regionLabels(ri => COL[D().triage[regionId(ri)]]), ...sensorLabels(set)],
        legend: [[COL.monitor, "Monitor"], [COL.watch, "Watch"], [COL.leave, "Leave"], [COL.sensor, "Level sensor"]],
        tip: i => { const k = set.indexOf(i); if (k < 0) return ""; const w = sensorWhy(i, set, SIM4_TEST()); return `Sensor ${k + 1}: without it, worst case ${pct(w.full.worst)} → ${pct(w.without.worst)}`; },
      };
    },
    panel() {
      const k = st.conclude.k, o = SIM4_TEST(), sc = score(planIdx(k), o), unseen = C().methods.exact.unseen[k - 1];
      const fails = planIdx(k).map(i => score(planIdx(k).filter(j => j !== i), o).worst), weakest = fails.indexOf(Math.min(...fails));
      const groups = ["monitor", "watch", "leave"].map(t => [t, Object.keys(D().triage).filter(r => D().triage[r] === t)]);
      return `
        <p class="lede">Growth by 2041 uses up room in a few places, and wet weather decides how much. A handful of level sensors, placed from the simulation, can see it coming.</p>
        <div class="tri">${groups.map(([t, rs]) => `<div class="${t}"><b>${t[0].toUpperCase() + t.slice(1)}</b>${rs.join(", ")}</div>`).join("")}</div>
        <h3>The plan: the best-coverage set</h3>
        <div class="slider"><input id="coK" type="range" min="1" max="8" value="${k}" aria-label="Sensors"><span>${k} sensor${k === 1 ? "" : "s"} · ${money(k * PRICE)}</span></div>
        <div class="stats">${stat(pct(sc.avg), "of growth that shows, seen on average")}${stat(pct(sc.worst), "in the worst weather case")}${stat(`${sc.warned} of ${sc.warnable}`, "overloads warned a step ahead")}${stat(pct(unseen), "on weather not chosen for")}</div>
        <div class="hint">${k === 5 ? "<b>Five is where it levels off:</b> a sixth adds 6 points to the worst case; a seventh and eighth add none. " : ""}No set of this size covers more scenarios. It beats the desk methods and random sites, and a basic hydraulic screen agrees on where to look (Cross-check). ${k > 1 ? `Sensor ${weakest + 1} carries the worst case: if it fails, ${pct(fails[weakest])}.` : ""} Costs at ${PRICE_NOTE}.</div>
        <h3>How sure we are</h3>
        <table class="mini"><tr><th class="in">Firm</th><th class="out">Say carefully</th></tr>
          <tr><td>Where growth shows, and which regions</td><td>Exact lids: many sites tie</td></tr>
          <tr><td>Five beat one when weather is unknown</td><td>Uncalibrated, steady-state model</td></tr>
          <tr><td>Level beats floats for early warning</td><td>Timing and costs are assumed</td></tr></table>
        <h3>What we need from you</h3>
        <ul class="plain"><li>Level or flow records of a normal day, to tell which weather case is realistic: that decides how many sensors are needed.</li><li>Your pipe ratings and capacity limit.</li><li>Development approvals, year by year.</li></ul>
        <h3>Next steps</h3>
        <ol class="redo"><li>Pilot <b>one level sensor</b> at Sensor 1, the site the worst case rests on, for a wet season.</li><li>Calibrate the model on what it records.</li><li>Re-run the placement on the calibrated runs before buying the rest.</li></ol>
        <div class="links"><a class="link" href="../simulation4/index.html" target="_blank" rel="noopener">Simulation 4, in full ↗</a> <a class="link" href="../simulation4/redo.html" target="_blank" rel="noopener">Redo guide ↗</a></div>
        ${nextBtn()}`;
    },
    wire() { $("#coK").oninput = e => { st.conclude.k = +e.target.value; refresh(); }; },
  };

  const HANDLERS = { setting: SETTING, network: NETWORK, approach: APPROACH, simulate: SIMULATE, insights: INSIGHTS, algorithms: ALGORITHMS, compare: COMPARE, check: CHECK, sensors: SENSORS, repeat: REPEAT, future: FUTURE, conclude: CONCLUDE };
  const layer = () => HANDLERS[st.sec].layer();

  // ------------------------------------------------------------------ animation helpers
  function play(o, stepFn, ms = 700) {
    stopPlay(o);
    const tick = () => { if (stepFn()) o.playing = setTimeout(tick, ms); else o.playing = null; };
    o.playing = setTimeout(tick, 50);
  }
  function stopPlay(o) { if (o.playing) clearTimeout(o.playing); o.playing = null; }

  // ------------------------------------------------------------------ page
  function renderPanel() {
    const h = HANDLERS[st.sec], sec = SECTIONS.find(s => s[0] === st.sec);
    const scroll = $("#panel").scrollTop;
    $("#panel").innerHTML = `<div class="crumb">${sec[3]} · ${SECTIONS.indexOf(sec) + 1} of ${SECTIONS.length}</div><h2>${sec[2]}</h2>` + h.panel();
    $("#panel").scrollTop = scroll;
    h.wire && h.wire();
    on("[data-go]", "onclick", e => go(e.currentTarget.dataset.go));
  }
  function refresh() { renderPanel(); draw(); }
  function go(sec, push = true) {
    Object.values(st).forEach(v => v && v.playing && stopPlay(v));
    st.sec = sec; st.sel = null; st.selPipe = null;
    view.k = 1; view.tx = 0; view.ty = 0; // each view opens on the whole network
    HANDLERS[sec].init && HANDLERS[sec].init();
    $$("#secs button").forEach(b => b.classList.toggle("on", b.dataset.sec === sec));
    $$("#secs .ch").forEach(c => c.classList.toggle("on", !!c.querySelector("button.on")));
    $("#panel").scrollTop = 0;
    refresh();
    if (push) history.replaceState(null, "", "#" + sec);
  }
  function step(d) { const k = SECTIONS.findIndex(s => s[0] === st.sec) + d; if (k >= 0 && k < SECTIONS.length) go(SECTIONS[k][0]); }
  function init() {
    prepare();
    let n = 0;
    $("#secs").innerHTML = CHAPTERS.map(([ch, v], c) => `<div class="ch" style="--n:${v.length}"><span>${c + 1} ${ch}</span><div>${v.map(([k, t]) => `<button type="button" data-sec="${k}"><i>${++n}</i>${t}</button>`).join("")}</div></div>`).join("");
    $("#secs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) go(b.dataset.sec); });
    document.addEventListener("keydown", e => {
      if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "Escape") { st.sel = null; st.selPipe = null; refresh(); }
    });
    fitView(); wireMap();
    const start = SECTIONS.find(s => "#" + s[0] === location.hash);
    go(start ? start[0] : "setting", false);
    window.addEventListener("hashchange", () => { const s = SECTIONS.find(x => "#" + x[0] === location.hash); if (s && s[0] !== st.sec) go(s[0], false); });
    document.body.dataset.ready = "1";
  }
  // Where a manhole is on screen, for tests.
  function screenOf(name) { const nd = G().nodes[idx[name]], [x, y] = P(nd.x, nd.y), r = cv().getBoundingClientRect(); return { x: r.left + x, y: r.top + y }; }
  const toScreen = (x, y) => { const [a, b] = P(x, y), r = cv().getBoundingClientRect(); return { x: r.left + a, y: r.top + b }; };
  return { init, prepare, go, st, toScreen, score, greedy, ladderIdx, planIdx, SIM4_TEST, unseenWeather, screenOf, chamberName: i => R().chambers[i], targetPool, screenRank, spearman, responseAt, SCREENS, util, H: () => H, SECTIONS };
})();
