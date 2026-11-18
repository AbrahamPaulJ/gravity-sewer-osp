/* Explore: the Sim 2.5 growth runs on the presentation demo's street map.
   One panel: where new homes connect, how many, and the weather. The map shows which manholes rise
   and whether a sensor notices. Every figure is computed here from data/growth.js and data/proof.js
   with the Workbench's scoring: a development is caught when a sensor's manhole rises 25 mm or more
   (the r25 rule), and a plan's share per weather case is the sum Placement.scenarios and
   Placement.cover do. The drawing follows output/adelaide-map/demo/engine.js. */
(function () {
  "use strict";
  const R = window.GROWTH_RUNS, G = window.GROWTH_GEOM, PROOF = window.SIM25_PROOF;
  const $ = (id) => document.getElementById(id);
  const card = $("card"), tip = $("tip"), detail = $("detail"), labelsEl = $("labels");
  const canvas = $("stage-canvas"), ctx = canvas.getContext("2d");
  const RULE = "r25", NCH = R.chambers.length, K = R.maxSensors, SIZES = R.growthLevels;
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (f) => Math.round(100 * f) + "%";
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

  // Plain names for the five weather cases, checked against the data's own labels.
  const CASES = [["Dry", "Dry", "on a dry day"], ["Design wet", "Wet", "on a wet day"], ["Severe", "Very wet", "on a very wet day"],
    ["Design wet + age-weighted I&I", "Leaky old pipes", "on a wet day with leakier old pipes"],
    ["Design wet + outside inflow x1.5", "Extra inflow", "on a wet day with 1.5 times the outside inflow"]];
  const wxName = (c) => (CASES[c] && CASES[c][0] === R.cases[c].label ? CASES[c][1] : R.cases[c].label);
  const wxOn = (c) => (CASES[c] && CASES[c][0] === R.cases[c].label ? CASES[c][2] : "in case " + R.cases[c].label);

  // ------------------------------------------------------------------ georeference (engine.js)
  function mgaToLL(E, Nn) {   // Transverse Mercator inverse, GRS80 (Snyder 1987, eq. 8-12 to 8-25)
    const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    const x = E - 500000, M = (Nn - 10000000) / k0;
    const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
      + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const sn = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1), N1 = a / Math.sqrt(1 - e2 * sn * sn), T1 = t * t, C1 = ep2 * c * c;
    const R1 = a * (1 - e2) / Math.pow(1 - e2 * sn * sn, 1.5), D = x / (N1 * k0);
    const lat = p1 - (N1 * t / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
    const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c;
    return [141 + lon * 180 / Math.PI, lat * 180 / Math.PI];
  }
  // Sim 2.5 stores positions in decimetres from (ox, oy), MGA zone 54.
  const toLL = (x, y) => mgaToLL(G.ox + x / 10, G.oy + y / 10);
  const NN = G.nodes.length, NP = G.up.length, NV = G.px.length;
  const nodeLL = G.nodes.map((n) => toLL(n.x, n.y));
  const vLL = []; for (let v = 0; v < NV; v++) vLL.push(toLL(G.px[v], G.py[v]));
  const nodeOf = {}; G.nodes.forEach((n, i) => { nodeOf[n.name] = i; });
  const CHN = R.chambers.map((name) => nodeOf[name]);            // chamber -> node
  const chOf = new Int32Array(NN).fill(-1); CHN.forEach((n, c) => { if (n != null) chOf[n] = c; });
  const BOUNDS = nodeLL.reduce((b, q) => [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0]), Math.max(b[3], q[1])],
    [Infinity, Infinity, -Infinity, -Infinity]);

  // the route new sewage takes from a node to the outlet: first pipe out, or the pump's rising main
  const outOf = G.nodes.map(() => []); for (let l = 0; l < NP; l++) outOf[G.up[l]].push(l);
  const DIA_MED = Array.from(G.dia).sort((a, b) => a - b)[NP >> 1];
  const pumpTo = new Map((G.pumpLinks || []).map(([a, b]) => [a, b]));
  function routeFrom(node) {
    const pipes = new Set(), seen = new Set();
    let v = node;
    while (v != null && !seen.has(v)) {
      seen.add(v);
      if (outOf[v].length) { const l = outOf[v][0]; pipes.add(l); v = G.down[l]; } else v = pumpTo.get(v);
    }
    return pipes;
  }

  // ------------------------------------------------------------------ the runs and the scoring
  const CELL = {};
  for (const c of R.cells) { const tips = []; for (const r of c.rows) tips[r.site] = r.tip; CELL[c.case + "|" + c.add + "|" + c.rule] = tips; }
  const tipOf = (cs, add, rule, site) => (CELL[cs + "|" + add + "|" + rule] || [])[site] || [];
  // per weather case, every development some manhole notices: one size at one connection point
  const DEV = R.cases.map((_, cs) => {
    const out = [];
    for (const add of SIZES) (CELL[cs + "|" + add + "|" + RULE] || []).forEach((t, site) => { if (t && t.length) out.push({ site, add, tip: t }); });
    return out;
  });
  const hits = (set) => { const s = new Set(set); return (t) => t.some((m) => s.has(m)); };
  function score(set) {
    const hit = hits(set);
    const per = DEV.map((list, cs) => { let n = 0; for (const d of list) if (hit(d.tip)) n++; return { cs, n, of: list.length, f: list.length ? n / list.length : 0 }; });
    const live = per.filter((p) => p.of);
    return { per, hard: live.reduce((a, b) => (b.f < a.f ? b : a)), mean: live.reduce((a, b) => a + b.f, 0) / live.length };
  }

  // The recommended plan: the proven optimum below five sensors, then the two-phase plan
  // (sensors 1-5 now, 6-10 added later), from prove_sim25.py for the r25 rule and the hardest case.
  const PR = PROOF && PROOF.rules && PROOF.rules[RULE] && PROOF.rules[RULE].worst;
  const PLAN = PR ? PR.plan.order : R.sensors[RULE].worst.order;
  const P1 = PR ? PR.plan.phase1.length : 5;
  const recommended = (k) => (PR && k < P1 ? PR.sets[k - 1].slice() : PLAN.slice(0, k));

  const METHODS = [
    { id: "proven", name: "Recommended plan", how: "The best possible set for the hardest weather case, found by an exact integer program over every combination of manholes and scored on the SWMM runs. From six sensors on, sensors are added to the first five so the plan can be built in two phases." },
    { id: "swmm", name: "Greedy, one at a time", how: "Adds one manhole at a time, each time the one that most raises the hardest-day share in the SWMM runs." },
    { id: "twoupdown", name: "Two up, two down", how: "A practitioners' rule of thumb: start at the manhole with the largest catchment, add two manholes upstream and two downstream, and repeat. It does not use the SWMM runs." },
    { id: "upstream", name: "Largest catchment", how: "The manholes with the most network draining through them. It does not use the SWMM runs." },
    { id: "between", name: "Most flow paths", how: "The manholes that the most flow paths pass through (betweenness). It does not use the SWMM runs." },
    { id: "celf", name: "Blockage-model greedy", how: "Greedy set cover on a model of where a blockage would be visible (CELF). It was built for blockages, not growth, and does not use the SWMM runs." },
    { id: "random", name: "Best of 20 random", how: "Twenty random sets of this size, keeping the one that scores best on these SWMM runs." },
  ];
  let plCtx = null;
  const plCache = {};
  function setOf(id, k) {
    if (id === "proven") return sensors();
    if (id === "swmm") return R.sensors[RULE].worst.order.slice(0, k);
    if (!plCache[id]) {
      if (!plCtx) plCtx = Placement.context(G, R, OSPCore, PROOF);
      plCache[id] = Placement.place(id, plCtx, RULE, "worst");
    }
    return plCache[id].sets[k - 1];
  }

  // ------------------------------------------------------------------ state
  const st = { add: SIZES.includes(150) ? 150 : SIZES[Math.floor(SIZES.length / 2)], cs: R.cases.length > 1 ? 1 : 0,
    site: 0, k: P1, own: null, view: "main", xs: 150, xcs: 0, other: "twoupdown" };
  // start where the answer is visible: the 150-home connection point the most manholes notice that a sensor sees
  (function pickStart() {
    const S = new Set(recommended(st.k));
    let best = -1, bn = -1;
    for (let s = 0; s < NCH; s++) {
      const t = tipOf(st.cs, st.add, RULE, s);
      if (t.some((m) => S.has(m)) && t.length > bn) { bn = t.length; best = s; }
    }
    if (best >= 0) st.site = best;
  })();
  const sensors = () => st.own || recommended(st.k);
  const sensorNo = (ch) => sensors().indexOf(ch) + 1;      // 0: not a sensor
  const phaseOf = (no) => (!st.own && st.k > P1 ? (no <= P1 ? "install now" : "add later") : "");

  function result() {
    const t25 = tipOf(st.cs, st.add, RULE, st.site), S = sensors();
    const seen = S.filter((m) => t25.includes(m));
    const g = new Uint8Array(NCH);
    [["r10", 1], ["r25", 2], ["r50", 3]].forEach(([r, v]) => { for (const m of tipOf(st.cs, st.add, r, st.site)) if (g[m] < v) g[m] = v; });
    const alarm = new Set(tipOf(st.cs, st.add, "alarm", st.site));
    const n = [0, 0, 0, 0]; for (let i = 0; i < NCH; i++) n[g[i]]++;
    return { t25, seen, g, alarm, n, kind: seen.length ? "hit" : t25.length ? "miss" : "none", route: routeFrom(CHN[st.site]) };
  }
  let cur = result(), sc = score(sensors());

  // ------------------------------------------------------------------ street names, from the basemap
  const streetCache = {}, streetTried = {};
  function streetOf(node) {
    if (node in streetCache) return streetCache[node];
    if (!map || !map.isStyleLoaded()) return "";
    const x = nodeS[2 * node], y = nodeS[2 * node + 1], t = performance.now();
    if (!(x > 0 && y > 0 && x < W && y < H) || t - (streetTried[node] || -1e9) < 1500) return "";
    streetTried[node] = t;
    let name = "";
    try {
      // the nearest named street, looking a little further out each time
      for (const r of [10, 24, 44]) {
        const fs = map.queryRenderedFeatures([[x - r, y - r], [x + r, y + r]], { layers: ["vt-street-names"] });
        const f = fs.find((q) => q.properties && (q.properties.name || q.properties.name_en));
        if (f) { name = f.properties.name || f.properties.name_en; break; }
      }
    } catch (e) { name = ""; }
    if (name) streetCache[node] = name;
    return name;
  }
  const placeOf = (node, fallback) => { const s = streetOf(node); return s ? esc(s) : fallback; };
  const mh = (node, text) => `<span class="mh" tabindex="0" data-n="${node}">${text}</span>`;

  // ------------------------------------------------------------------ the main panel
  const MAPICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.5 5.5 2l5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5z M5.5 2v10.5 M10.5 3.5V14"/></svg>`;
  const mapBtn = (x, label, aria) => `<button class="mapbtn" data-x="${x}" aria-label="${esc(aria)}">${MAPICON}${label}</button>`;
  const segSizes = (key, on) => `<div class="seg" role="group" aria-label="New homes">${SIZES.map((a) =>
    `<button data-${key}="${a}" class="${a === on ? "on" : ""}" aria-pressed="${a === on}">${a}</button>`).join("")}</div>`;
  const segWx = (key, on) => `<div class="seg" role="group" aria-label="Weather">${R.cases.map((c, i) =>
    `<button data-${key}="${i}" class="${i === on ? "on" : ""}" aria-pressed="${i === on}" data-say="${esc(c.note)}">${wxName(i)}</button>`).join("")}</div>`;
  const GRADE_COL = ["", "#ecd39a", "#d39a45", "#b8523b"];
  function gradesHtml(r) {
    const k = [["10–25 mm", 1], ["25–50 mm", 2], ["50 mm or more", 3]].map(([t, v]) =>
      `<span><i style="background:${GRADE_COL[v]}"></i>${t} <b>${r.n[v]}</b></span>`).join("");
    const al = r.alarm.size ? `<span><i class="ring"></i>newly over the ${R.alarmMm} mm alarm <b>${r.alarm.size}</b></span>` : "";
    return `<div class="grades" aria-label="Manholes by rise">${k}${al}</div>`;
  }
  const sensorList = (list) => {
    const parts = list.map((m) => mh(CHN[m], "sensor " + sensorNo(m)));
    return parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0];
  };
  function verdictHtml(r) {
    const site = mh(CHN[st.site], placeOf(CHN[st.site], "the ringed manhole"));
    const nr = plural(r.t25.length, "manhole", "manholes");
    if (r.kind === "hit") return `<p class="verdict hit">Seen by ${sensorList(r.seen)}.</p>
      <p class="sub">${st.add} new homes at ${site} ${wxOn(st.cs)} raise ${nr} by 25 mm or more.</p>`;
    if (r.kind === "miss") return `<p class="verdict miss">Missed by every sensor.</p>
      <p class="sub">${st.add} new homes at ${site} ${wxOn(st.cs)} raise ${nr} by 25 mm or more, and none of them has a sensor.</p>`;
    return `<p class="verdict none">Too small to notice.</p>
      <p class="sub">${st.add} new homes at ${site} ${wxOn(st.cs)} raise no manhole by 25 mm${r.n[1] ? `; ${plural(r.n[1], "manhole rises", "manholes rise")} 10–25 mm` : ""}.</p>`;
  }
  function planNote() {
    if (st.own) return "Click a manhole on the map to add a sensor there, or click a sensor to remove it.";
    if (st.k < P1) return `The best possible set of ${st.k} for the hardest weather case.`;
    if (st.k === P1) return `The recommended first phase. Up to ${K - P1} more can be added later.`;
    return `Recommended plan: sensors 1–${P1} go in first, ${P1 + 1}–${st.k} are added later.`;
  }
  function statSay(which) {
    const h = sc.hard;
    if (which === "hard") return `${h.n} of the ${h.of} developments ${wxOn(h.cs)} are caught. A development is one size of new housing connected at one manhole; it counts when at least one manhole rises 25 mm or more. ${wxName(h.cs)} is the hardest of the five weather cases for these sensors.`;
    return "Average of the five weather cases: " + sc.per.filter((p) => p.of).map((p) => `${wxName(p.cs)} ${pct(p.f)}`).join(", ") + ".";
  }
  function mainHtml() {
    const r = cur, S = sensors(), h = sc.hard;
    let yours = "";
    if (st.own) {
      const rec = score(recommended(S.length));
      yours = `<p class="yours">Your ${plural(S.length, "sensor", "sensors")}: ${pct(h.f)} on the hardest day. The recommended ${S.length}: ${pct(rec.hard.f)}.
        <button class="linkbtn" id="reset">Back to the recommended plan</button></p>`;
    }
    return `
      <div class="xsec"><div class="hd">New homes</div>${segSizes("add", st.add)}
        <p class="note">Connected at ${mh(CHN[st.site], placeOf(CHN[st.site], "the ringed manhole"))}. Click any manhole on the map to move them.</p></div>
      <div class="xsec"><div class="hd">Weather</div>${segWx("cs", st.cs)}</div>
      <div class="xsec"><div class="hd">What the sensors notice ${mapBtn("rise", "How far levels rise", "Explain the rise on the map")}</div>
        ${verdictHtml(r)}${gradesHtml(r)}
        <p class="changed" id="changed" ${lastChange ? "" : "hidden"}>${lastChange || ""}</p></div>
      <div class="xsec"><div class="hd">Sensors ${mapBtn("cover", "Where they miss", "Show on the map where the sensors miss")}</div>
        <div class="row">
          <div class="stepper"><button data-k="-1" aria-label="Fewer sensors" ${st.own || st.k <= 1 ? "disabled" : ""}>−</button>
            <output><b>${S.length}</b> ${S.length === 1 ? "sensor" : "sensors"}</output>
            <button data-k="1" aria-label="More sensors" ${st.own || st.k >= K ? "disabled" : ""}>+</button></div>
          <button class="toggle ${st.own ? "on" : ""}" id="own" aria-pressed="${!!st.own}">${st.own ? "Placing your own" : "Place your own"}</button>
        </div>
        <p class="note">${planNote()}</p>
        <div class="stats">
          <div class="stat"><b data-say="${esc(statSay("hard"))}">${pct(h.f)}<em class="delta" id="dHard"></em></b>
            <span>of noticeable developments caught on the hardest day (${wxName(h.cs).toLowerCase()})</span>
            <button class="i" data-say="${esc(statSay("hard"))}" aria-label="What this number means">i</button></div>
          <div class="stat"><b data-say="${esc(statSay("mean"))}">${pct(sc.mean)}<em class="delta" id="dMean"></em></b>
            <span>average over the five weather cases</span>
            <button class="i" data-say="${esc(statSay("mean"))}" aria-label="What this number means">i</button></div>
        </div>
        ${yours}
        <p class="note">Six other ways of choosing sensors were scored the same way. ${mapBtn("compare", "Compare", "Compare the methods on the map")}</p>
      </div>`;
  }

  // ------------------------------------------------------------------ explanation cards
  const back = `<button class="back" id="back">← Back</button>`;
  function siteStatus(cs, add, set) {
    const hit = hits(set), out = new Int8Array(NCH);   // 0 not noticeable, 1 caught, 2 missed
    for (let s = 0; s < NCH; s++) { const t = tipOf(cs, add, RULE, s); out[s] = t.length ? (hit(t) ? 1 : 2) : 0; }
    return out;
  }
  function riseHtml() {
    const site = mh(CHN[st.site], placeOf(CHN[st.site], "the ringed manhole"));
    return `${back}<div class="kicker"><span>What the sensors notice</span></div>
      <h1>How far the levels rise</h1>
      <p class="lead">${st.add} new homes at ${site} ${wxOn(st.cs)}. Their sewage runs downhill along the dark line, and the manholes on the way run deeper.</p>
      <div class="ctl"><span>New homes</span>${segSizes("add", st.add)}</div>
      <div class="ctl"><span>Weather</span>${segWx("cs", st.cs)}</div>
      ${gradesHtml(cur)}
      <h3>How to read the map</h3>
      <p>Each coloured dot is a manhole whose level rises because of these homes. Darker and larger means a bigger rise. A dark ring marks a manhole the homes push past the ${R.alarmMm} mm alarm level. Numbered circles are sensors. Hover any manhole to see its rise, and click one to connect the homes there instead.</p>
      <h3>Why 25 mm</h3>
      <p>A sensor counts the growth as noticed when its manhole rises 25 mm or more above its level before the homes were added. The threshold is our assumption until SA Water data shows how small a change its level sensors can tell apart from normal daily variation.</p>
      <h3>Why it matters</h3>
      <p>Spare capacity in a trunk sewer is used up one development at a time. A sensor where the levels rise records that change, so the loss of capacity shows up in the data before it shows up as an overflow.</p>
      <h3>Assumptions</h3>
      <p>Each new home has 2.3 people using 200 L per person per day, with a peak factor of 2. The weather cases set how much groundwater gets into the pipes. The model has not been checked against field measurements yet.</p>
      <h3>Where the numbers come from</h3>
      <p>EPA SWMM runs of the Walkerville model (Simulation 2.5): each of the ${NCH} manholes as a connection point, ${SIZES.length} development sizes and ${R.cases.length} weather cases.</p>`;
  }
  function coverHtml() {
    const S = sensors(), stat = siteStatus(st.xcs, st.xs, S);
    let a = 0, m = 0, z = 0; for (const v of stat) { if (v === 1) a++; else if (v === 2) m++; else z++; }
    const p = sc.per[st.xcs], hit = hits(S);
    const big = SIZES[SIZES.length - 1], bigN = DEV[st.xcs].filter((d) => d.add === big && hit(d.tip)).length;
    const isHard = st.xcs === sc.hard.cs;
    const bars = sc.per.map((q) => `<button data-xcs="${q.cs}" class="ours ${q.cs === st.xcs ? "on" : ""}" ${q.of ? "" : "disabled"}>
      <span>${wxName(q.cs)}</span><i style="width:${(100 * q.f).toFixed(1)}%"></i><b>${q.of ? pct(q.f) : "–"}</b></button>`).join("");
    return `${back}<div class="kicker"><span>Sensors</span></div>
      <h1>Where the ${plural(S.length, "sensor misses", "sensors miss")}</h1>
      <p class="lead">${st.xs} new homes ${wxOn(st.xcs)}: ${a} of the ${a + m} connection points where the growth is noticeable are caught.</p>
      <div class="ctl"><span>New homes</span>${segSizes("xs", st.xs)}</div>
      <div class="ctl"><span>Weather</span>${segWx("xcs", st.xcs)}</div>
      <div class="legend"><span class="key"><i style="background:#2d6a6e"></i>Caught <b>${a}</b></span>
        <span class="key"><i style="background:#b8523b"></i>Missed <b>${m}</b></span>
        <span class="key"><i style="background:#fff;border:1.5px solid #c9bfa9"></i>Too small to notice <b>${z}</b></span></div>
      <h3>All five sizes together</h3>
      <p>${p.n} of the ${p.of} developments ${wxOn(st.xcs)} are caught (${pct(p.f)}).${isHard ? ` This is the ${pct(p.f)} on the main panel: the hardest of the five weather cases.` : ""} ${bigN} of the ${p.n} caught are the ${big}-home size, so the share depends heavily on the large developments.</p>
      <div class="bars" role="group" aria-label="Share caught in each weather case">${bars}</div>
      <p class="note">The average of these five bars is the ${pct(sc.mean)} on the main panel. Click a bar to see that weather on the map.</p>
      <h3>How to read the map</h3>
      <p>Each dot is a manhole where the new homes could connect. Teal: at least one sensor's manhole rises 25 mm or more, so the development is caught. Rust: some manhole rises 25 mm but none of them has a sensor. Faint: no manhole rises 25 mm, so no sensor could notice it.</p>
      <h3>Why it matters</h3>
      <p>Rust dots are where growth could go unnoticed. They show where another sensor, a lower threshold or a different sensor type would help most.</p>
      <h3>Assumptions</h3>
      <p>The 25 mm threshold, the load per home and the weather cases are assumptions until SA Water data is available. The model has not been checked against field measurements yet.</p>
      <h3>Where the numbers come from</h3>
      <p>The same SWMM runs and scoring as the Workbench: a development is one size of new housing at one manhole, and it is caught when at least one sensor's manhole rises 25 mm or more.</p>`;
  }
  function compareHtml() {
    const k = sensors().length, ours = sensors(), other = setOf(st.other, k), hO = hits(ours), hT = hits(other);
    let x = 0, y = 0;
    for (const d of DEV[st.xcs]) { const a = hO(d.tip), b = hT(d.tip); if (a && !b) x++; if (b && !a) y++; }
    const n = [0, 0, 0, 0];   // only ours, both, only theirs, neither
    for (let s = 0; s < NCH; s++) {
      const t = tipOf(st.xcs, st.xs, RULE, s); if (!t.length) continue;
      const a = hO(t), b = hT(t); n[a && b ? 1 : a ? 0 : b ? 2 : 3]++;
    }
    const of = DEV[st.xcs].length;
    const rows = METHODS.map((M) => {
      const set = M.id === "proven" ? ours : setOf(M.id, k), hit = hits(set);
      const f = of ? DEV[st.xcs].filter((d) => hit(d.tip)).length / of : 0;
      return { M, f };
    });
    const max = Math.max(...rows.map((r) => r.f), 1e-9);
    const bars = rows.map(({ M, f }) => M.id === "proven"
      ? `<button class="ours fixed" tabindex="-1"><span>${st.own ? "Your sensors" : M.name}</span><i style="width:${(100 * f / max).toFixed(1)}%"></i><b>${pct(f)}</b></button>`
      : `<button data-m="${M.id}" class="${M.id === st.other ? "on" : ""}" aria-pressed="${M.id === st.other}" data-say="${esc(M.how)}"><span>${M.name}</span><i style="width:${(100 * f / max).toFixed(1)}%"></i><b>${pct(f)}</b></button>`).join("");
    const oName = METHODS.find((M) => M.id === st.other).name.toLowerCase(), ourName = st.own ? "your plan" : "the recommended plan";
    // where the other method's sensors sit, in pipe sizes, and how much of the growth reaches them
    const dias = other.map((c) => outOf[CHN[c]].map((l) => G.dia[l])[0]).filter((d) => d > 0);
    const dLo = Math.min(...dias), dHi = Math.max(...dias), caughtT = DEV[st.xcs].filter((d) => hT(d.tip)).length;
    const sits = dias.length ? `Its sensors sit on ${dLo === dHi ? dLo : dLo + "–" + dHi} mm pipes; the typical pipe in this network is ${DIA_MED} mm. `
      + `${caughtT} of the ${of} developments ${wxOn(st.xcs)} raise one of its manholes by 25 mm or more.` : "";
    let why;
    if (st.own) why = "These are your own sensors, scored the same way as every method.";
    else if (PR && k <= P1) why = `For ${plural(k, "sensor", "sensors")} this is the best possible set for the hardest weather case: an exact integer program checked every combination of manholes and proved that no other set catches more there. Other weather cases can rank the methods differently, as the bars show.`;
    else if (PR) why = `${k === P1 + 1 ? "Sensor " + k + " is" : "Sensors " + (P1 + 1) + "–" + k + " are"} added to the first ${P1} so the plan can be built in two phases. On the hardest day it catches ${pct(sc.hard.f)}; the best possible set of ${k}, chosen from scratch, catches ${pct(PR.worst[k - 1])}.`;
    else why = "";
    return `${back}<div class="kicker"><span>Sensors</span></div>
      <h1>Why ${ourName}</h1>
      <p class="lead">At ${plural(k, "sensor", "sensors")} ${wxOn(st.xcs)}, across all sizes, ${ourName} catches ${plural(x, "development", "developments")} that ${oName} misses, and misses ${y} that it catches.</p>
      <div class="ctl"><span>Weather</span>${segWx("xcs", st.xcs)}</div>
      <div class="bars" role="group" aria-label="Share caught by each method">${bars}</div>
      <p class="note">Share of noticeable developments caught ${wxOn(st.xcs)}, all sizes, ${plural(k, "sensor", "sensors")} each. Click a method to compare it on the map.</p>
      <div class="ctl"><span>New homes</span>${segSizes("xs", st.xs)}</div>
      <div class="legend"><span class="key"><i style="background:#2d6a6e"></i>Only ${st.own ? "yours" : "recommended"} <b>${n[0]}</b></span>
        <span class="key"><i style="background:#a9c7bf"></i>Both <b>${n[1]}</b></span>
        <span class="key"><i style="background:#c27a2c"></i>Only ${esc(oName)} <b>${n[2]}</b></span>
        <span class="key"><i style="background:#b8523b"></i>Neither <b>${n[3]}</b></span></div>
      <h3>How to read the map</h3>
      <p>Dark numbered circles are ${st.own ? "your" : "the recommended"} sensors; grey squares are the ${esc(oName)} sensors. Each dot is a connection point for ${st.xs} new homes where the growth is noticeable, coloured by which plan notices it.</p>
      ${sits ? `<h3>Where ${esc(oName)} puts its sensors</h3><p>${sits}</p>` : ""}
      <h3>Why it wins</h3>
      <p>${why}</p>
      <h3>The methods</h3>
      ${METHODS.map((M) => `<p><strong>${M.name}.</strong> ${M.how}</p>`).join("")}`;
  }

  // ------------------------------------------------------------------ render, and showing what changed
  let lastChange = "", deltaTimer = 0;
  function render(enter) {
    cur = result(); sc = score(sensors());
    const html = st.view === "rise" ? riseHtml() : st.view === "cover" ? coverHtml() : st.view === "compare" ? compareHtml() : mainHtml();
    const top = card.scrollTop;
    if (enter) { card.classList.remove("in"); card.innerHTML = html; card.scrollTop = 0; void card.offsetWidth; card.classList.add("in"); }
    else { card.innerHTML = html; card.scrollTop = top; }
    placeSiteLabel();
    if (!detail.hidden && detailFor) showDetail(detailFor);
  }
  const verdictShort = (r) => (r.kind === "hit" ? "seen by " + r.seen.map((m) => "sensor " + sensorNo(m)).join(" and ") : r.kind === "miss" ? "missed" : "too small to notice");
  function snap() { return { add: st.add, cs: st.cs, site: st.site, k: sensors().length, S: sensors().slice(), r: cur, v: verdictShort(cur), hard: sc.hard.f, mean: sc.mean }; }
  function change(what, fn) {
    const b = snap();
    fn();
    cur = result(); sc = score(sensors());
    const a = snap();
    const head = {
      add: `Homes: ${b.add} → ${a.add}.`, cs: `Weather: ${wxName(b.cs)} → ${wxName(a.cs)}.`,
      site: `Homes moved to ${placeOf(CHN[a.site], "the ringed manhole")}.`, k: `Sensors: ${b.k} → ${a.k}.`,
      own: a.k > b.k ? `Sensor added (${a.k} now).` : `Sensor removed (${a.k} now).`, reset: "Back to the recommended plan.",
    }[what] || "";
    const parts = [head];
    const was = b.v, now = a.v;
    parts.push(was === now ? `Still ${now}.` : `Now ${now} (was ${was}).`);
    if (b.r.t25.length !== a.r.t25.length) parts.push(`${b.r.t25.length} → ${a.r.t25.length} manholes rise 25 mm or more.`);
    if (Math.round(100 * b.hard) !== Math.round(100 * a.hard)) parts.push(`Hardest day ${pct(b.hard)} → ${pct(a.hard)}.`);
    lastChange = parts.join(" ");
    // pulse the manholes whose rise or sensor changed
    const sb = new Set(b.S), sa = new Set(a.S), now0 = performance.now();
    const list = [];
    for (let i = 0; i < NCH; i++) if (b.r.g[i] !== a.r.g[i] || sb.has(i) !== sa.has(i)) list.push(i);
    if (b.site !== a.site) list.push(a.site);
    list.slice(0, 80).forEach((i, j) => pulses.push({ n: CHN[i], t0: now0 + j * 12 }));
    render(false);
    const c = $("changed"); if (c) { c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash"); }
    showDelta("dHard", b.hard, a.hard); showDelta("dMean", b.mean, a.mean);
  }
  function showDelta(id, b, a) {
    const el = $(id), d = Math.round(100 * a) - Math.round(100 * b);
    if (!el || !d) return;
    el.textContent = (d > 0 ? "▲ " : "▼ ") + Math.abs(d) + " pts";
    el.className = "delta on " + (d > 0 ? "up" : "down");
    clearTimeout(deltaTimer);
    deltaTimer = setTimeout(() => { const e = $(id); if (e) e.classList.remove("on"); }, 4000);
  }
  function setView(v) {
    if (v === "cover" || v === "compare") { st.xs = st.add; st.xcs = sc.hard.cs; }
    st.view = v; hideTip(); render(true);
  }

  card.addEventListener("click", (e) => {
    const t = e.target.closest("button"); if (!t) return;
    const d = t.dataset;
    if (t.id === "back") return setView("main");
    if (d.x) return setView(d.x);
    if (d.add) return change("add", () => { st.add = +d.add; });
    if (d.cs) return change("cs", () => { st.cs = +d.cs; });
    if (d.k) return change("k", () => { st.k = Math.max(1, Math.min(K, st.k + +d.k)); });
    if (t.id === "own") { if (st.own) change("reset", () => { st.k = st.own.length; st.own = null; }); else { st.own = recommended(st.k); render(false); } return; }
    if (t.id === "reset") return change("reset", () => { st.k = st.own.length; st.own = null; });
    if (d.xs) { st.xs = +d.xs; return render(false); }
    if (d.xcs) { st.xcs = +d.xcs; return render(false); }
    if (d.m) { st.other = d.m; return render(false); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!detail.hidden) closeDetail(); else if (st.view !== "main") setView("main");
  });

  // ------------------------------------------------------------------ hover help: data-say, and places named in the text
  let spot = -1;
  function sayAt(el) {
    const r = el.getBoundingClientRect();
    tip.innerHTML = esc(el.dataset.say);
    tip.style.left = Math.min(r.left, innerWidth - 270) + "px"; tip.style.top = r.bottom - 4 + "px";
    tip.classList.add("on");
  }
  function hideTip() { tip.classList.remove("on"); }
  for (const root of [card, detail]) {
    root.addEventListener("mouseover", (e) => {
      const s = e.target.closest("[data-say]"); if (s) sayAt(s);
      const m = e.target.closest(".mh"); if (m) pointAt(+m.dataset.n);
    });
    root.addEventListener("mouseout", (e) => {
      if (e.target.closest("[data-say]")) hideTip();
      if (e.target.closest(".mh")) spot = -1;
    });
    root.addEventListener("focusin", (e) => {
      const s = e.target.closest("[data-say]"); if (s) sayAt(s);
      const m = e.target.closest(".mh"); if (m) pointAt(+m.dataset.n);
    });
    root.addEventListener("focusout", () => { hideTip(); spot = -1; });
  }
  // ring the place on the map, and bring it into view if it is off screen or under the panel
  function pointAt(node) {
    spot = node;
    const x = nodeS[2 * node], y = nodeS[2 * node + 1], f = freeRect();
    if (map && !(x > f.x0 && x < f.x1 && y > f.y0 && y < f.y1)) map.easeTo({ center: nodeLL[node], duration: 600, padding: mapPadding() });
  }

  // ------------------------------------------------------------------ details card: manholes and pipes alike
  let detailFor = null;
  const MAT = { VC: "vitrified clay", PVCU: "PVC", RC: "reinforced concrete" };
  function manholeHtml(ch) {
    const n = CHN[ch], nd = G.nodes[n], no = sensorNo(ch), street = streetOf(n);
    const lines = [];
    const main = st.view === "main" || st.view === "rise";
    if (main && ch === st.site) lines.push(`<b>New homes connect here:</b> ${st.add} homes ${wxOn(st.cs)}.`);
    lines.push(no ? `<b>Sensor ${no}</b>${phaseOf(no) ? ", " + phaseOf(no) : ""}.` : "No sensor here.");
    if (main && ch !== st.site) {
      const g = cur.g[ch];
      lines.push(g ? `Rises ${["", "10–25 mm", "25–50 mm", "50 mm or more"][g]} when the homes connect at ${placeOf(CHN[st.site], "the ringed manhole")}.` : "No rise of 10 mm or more from these homes.");
      if (cur.alarm.has(ch)) lines.push(`The homes push it past the ${R.alarmMm} mm alarm level.`);
    }
    if (!main) {
      const t = tipOf(st.xcs, st.xs, RULE, ch), s = new Set(sensors()), seen = t.filter((m) => s.has(m));
      lines.push(`As a connection point for ${st.xs} homes ${wxOn(st.xcs)}: ` + (seen.length ? "caught by " + seen.map((m) => "sensor " + sensorNo(m)).join(" and ") + "." : t.length ? "missed by every sensor." : "too small to notice."));
    }
    const cs = main ? st.cs : st.xcs, over = (R.baseOver[cs] || []).includes(ch);
    lines.push(over ? `Already over the ${R.alarmMm} mm alarm level before any growth, ${wxOn(cs)}.` : `Below the ${R.alarmMm} mm alarm level before growth ${wxOn(cs)}.`);
    const act = !st.own && !(st.view === "main" && ch === st.site) ? `<p class="act"><button class="mapbtn" data-connect="${ch}">Connect the new homes here</button></p>` : "";
    const depth = R.baseDepthMm && R.baseDepthMm[cs] ? R.baseDepthMm[cs][ch] : null;
    return `<button class="x" aria-label="Close">×</button><span class="casepill">Manhole</span>
      <h3>${street ? esc(street) : "Manhole"}</h3>${lines.map((l) => `<p>${l}</p>`).join("")}${act}
      <details><summary>Engineering details</summary><dl>
        <dt>Asset</dt><dd>${esc(R.chambers[ch])}</dd>
        ${nd.depth ? `<dt>Depth to pipe floor</dt><dd>${nd.depth.toFixed(1)} m</dd>` : ""}
        ${depth != null ? `<dt>Water depth before growth</dt><dd>${depth} mm (${wxName(cs).toLowerCase()})</dd>` : ""}
        ${R.dwellingsAt ? `<dt>Homes connected now</dt><dd>${R.dwellingsAt[ch]}</dd>` : ""}
      </dl></details>`;
  }
  function pipeHtml(l) {
    const n0 = G.up[l], n1 = G.down[l], street = streetOf(n0) || streetOf(n1), main = st.view === "main" || st.view === "rise";
    const lines = [];
    if (main) lines.push(cur.route.has(l) ? `<b>Carries the new homes' sewage</b> on its way to the outlet.` : "Not on the new homes' route to the outlet.");
    const yr = G.pyr && G.pyr[l], mat = G.pmat && MAT[G.pmat[l]];
    if (yr || mat) lines.push(`${yr ? "Laid in " + yr : "Material"}${mat ? (yr ? ", " : ": ") + mat : ""}.`);
    lines.push(`Sewage enters at ${mh(n0, "the upper end")} and leaves at ${mh(n1, "the lower end")}.`);
    return `<button class="x" aria-label="Close">×</button><span class="casepill">Pipe</span>
      <h3>${G.dia[l]} mm pipe${street ? " on " + esc(street) : ""}</h3>${lines.map((q) => `<p>${q}</p>`).join("")}
      <details><summary>Engineering details</summary><dl>
        ${G.pid ? `<dt>Asset</dt><dd>${esc(G.pid[l])}</dd>` : ""}
        ${G.plen ? `<dt>Length</dt><dd>${Math.round(G.plen[l])} m</dd>` : ""}
        ${G.pcap ? `<dt>Capacity when full</dt><dd>${G.pcap[l]} L/s</dd>` : ""}
      </dl></details>`;
  }
  function showDetail(what) {
    detailFor = what;
    detail.innerHTML = what.ch != null ? manholeHtml(what.ch) : pipeHtml(what.pipe);
    detail.hidden = false;
  }
  function closeDetail() { detail.hidden = true; detailFor = null; }
  detail.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.classList.contains("x")) return closeDetail();
    if (b.dataset.connect) {
      const ch = +b.dataset.connect;
      if (st.view !== "main") { st.view = "main"; render(true); }
      change("site", () => { st.site = ch; });
      showDetail({ ch });
    }
  });

  // ------------------------------------------------------------------ map
  let map = null, W = 0, H = 0, dpr = 1, zf = 1;
  const nodeS = new Float32Array(NN * 2), vS = new Float32Array(NV * 2);
  const sheet = $("sheet");
  const narrow = () => innerWidth <= 900 || innerWidth / innerHeight < 0.8;
  function mapPadding() {
    if (narrow()) return { top: 90, bottom: Math.round(innerHeight * 0.56) + 10, left: 20, right: 20 };
    return { top: 70, bottom: 40, left: sheet.offsetWidth + 20, right: 40 };
  }
  function freeRect() {
    const p = mapPadding();
    return { x0: p.left - 10, x1: W - 10, y0: p.top - 20, y1: H - (narrow() ? p.bottom - 20 : 10) };
  }
  let fb = null;   // without WebGL: a fixed fit, no basemap
  function project() {
    if (map) {
      for (let i = 0; i < NN; i++) { const p = map.project(nodeLL[i]); nodeS[2 * i] = p.x; nodeS[2 * i + 1] = p.y; }
      for (let v = 0; v < NV; v++) { const p = map.project(vLL[v]); vS[2 * v] = p.x; vS[2 * v + 1] = p.y; }
      zf = Math.max(0.9, Math.min(2.4, Math.pow(2, map.getZoom() - 14.6)));
    } else {
      const f = freeRect(), kx = Math.cos(BOUNDS[1] * Math.PI / 180);
      const s = Math.min((f.x1 - f.x0) / ((BOUNDS[2] - BOUNDS[0]) * kx), (f.y1 - f.y0) / (BOUNDS[3] - BOUNDS[1])) * 0.92;
      const cx = (f.x0 + f.x1) / 2, cy = (f.y0 + f.y1) / 2, mx = (BOUNDS[0] + BOUNDS[2]) / 2, my = (BOUNDS[1] + BOUNDS[3]) / 2;
      const put = (q, arr, i) => { arr[2 * i] = cx + (q[0] - mx) * kx * s; arr[2 * i + 1] = cy - (q[1] - my) * s; };
      nodeLL.forEach((q, i) => put(q, nodeS, i)); vLL.forEach((q, i) => put(q, vS, i));
      fb = s; zf = 1;
    }
    furniture();
  }
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    project();
  }
  function furniture() {
    const lat = (BOUNDS[1] + BOUNDS[3]) / 2;
    const mpp = map ? 40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * Math.pow(2, map.getZoom())) : 111320 / (fb || 1);
    const m = [50, 100, 200, 250, 500, 1000, 2000].reverse().find((v) => v / mpp <= 120) || 50;
    const s = $("scale"); s.querySelector("i").style.width = (m / mpp).toFixed(0) + "px";
    s.querySelector("span").textContent = m >= 1000 ? m / 1000 + " km" : m + " m";
  }

  // ------------------------------------------------------------------ drawing (engine.js colours and marks)
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const C = { ink: hex("#16130f"), pipe: hex("#2d6a6e"), faint: hex("#c9bfa9"), growth: hex("#c27a2c"), rust: hex("#b8523b"),
    sur: hex("#7a2a1d"), white: [255, 255, 255], paper: hex("#fbf6ee"), grey: hex("#8f8270"), tealLight: hex("#a9c7bf") };
  const GRADE = [null, hex("#ecd39a"), hex("#d39a45"), hex("#b8523b")];
  const pulses = [];
  let hov = null;
  function pipePath(l) {
    ctx.beginPath();
    for (let v = G.ptr[l]; v < G.ptr[l + 1]; v++) v === G.ptr[l] ? ctx.moveTo(vS[2 * v], vS[2 * v + 1]) : ctx.lineTo(vS[2 * v], vS[2 * v + 1]);
  }
  const pipeW = (l) => (1.3 + (G.dia[l] / 1000) * 3.6) * zf;
  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const v = st.view, main = v === "main" || v === "rise", S = sensors();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // paper casing first, so the network reads apart from the streets
    ctx.strokeStyle = rgba(C.paper, 0.8);
    for (let l = 0; l < NP; l++) { ctx.lineWidth = pipeW(l) + 2.4; pipePath(l); ctx.stroke(); }
    for (let l = 0; l < NP; l++) {
      const on = main && cur.route.has(l);
      ctx.strokeStyle = on ? rgba(C.ink, 0.95) : main ? rgba(C.pipe, 0.9) : rgba(C.faint, 0.95);
      ctx.lineWidth = pipeW(l) * (on ? 1.9 : 1);
      pipePath(l); ctx.stroke();
    }
    if (hov && hov.pipe != null) { ctx.strokeStyle = rgba(C.growth, 0.9); ctx.lineWidth = pipeW(hov.pipe) + 3; pipePath(hov.pipe); ctx.stroke(); }
    // manholes
    const r0 = Math.max(1.5, Math.min(3.4, 1.5 * zf));
    ctx.lineWidth = 1;
    for (let c = 0; c < NCH; c++) {
      const n = CHN[c]; if (n == null) continue;
      ctx.fillStyle = rgba(C.white, 0.95); ctx.strokeStyle = rgba(C.ink, 0.5);
      ctx.beginPath(); ctx.arc(nodeS[2 * n], nodeS[2 * n + 1], r0, 0, 7); ctx.fill(); ctx.stroke();
    }
    const zr = Math.max(0.8, Math.min(1.6, zf * 0.7 + 0.4));
    if (main) {
      // the rise at each manhole, smallest first so the big ones sit on top
      for (let g = 1; g <= 3; g++) for (let c = 0; c < NCH; c++) {
        if (cur.g[c] !== g) continue;
        const n = CHN[c], x = nodeS[2 * n], y = nodeS[2 * n + 1], rad = (2.6 + g * 1.7) * zr;
        ctx.fillStyle = rgba(GRADE[g], 0.9); ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
        if (g >= 2) { ctx.strokeStyle = rgba(C.ink, 0.55); ctx.lineWidth = 1.1; ctx.stroke(); }
      }
      ctx.strokeStyle = rgba(C.sur, 0.95); ctx.lineWidth = 2;
      for (const c of cur.alarm) { const n = CHN[c]; ctx.beginPath(); ctx.arc(nodeS[2 * n], nodeS[2 * n + 1], 9 * zr, 0, 7); ctx.stroke(); }
    } else if (v === "cover") {
      const stat = siteStatus(st.xcs, st.xs, S);
      for (let c = 0; c < NCH; c++) {
        if (!stat[c]) continue;
        const n = CHN[c]; ctx.fillStyle = rgba(stat[c] === 1 ? C.pipe : C.rust, 0.92);
        ctx.beginPath(); ctx.arc(nodeS[2 * n], nodeS[2 * n + 1], 4.2 * zr, 0, 7); ctx.fill();
      }
    } else if (v === "compare") {
      const hO = hits(S), hT = hits(setOf(st.other, S.length)), col = [C.pipe, C.tealLight, C.growth, C.rust];
      for (let c = 0; c < NCH; c++) {
        const t = tipOf(st.xcs, st.xs, RULE, c); if (!t.length) continue;
        const a = hO(t), b = hT(t), n = CHN[c];
        ctx.fillStyle = rgba(col[a && b ? 1 : a ? 0 : b ? 2 : 3], 0.92);
        ctx.beginPath(); ctx.arc(nodeS[2 * n], nodeS[2 * n + 1], 4.2 * zr, 0, 7); ctx.fill();
      }
      // the other method's sensors: grey squares (engine.js drawSet)
      for (const c of setOf(st.other, S.length)) {
        const n = CHN[c], x = nodeS[2 * n], y = nodeS[2 * n + 1];
        ctx.fillStyle = rgba(C.grey, 0.92); ctx.strokeStyle = rgba(C.white, 1); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.rect(x - 6.5, y - 6.5, 13, 13); ctx.fill(); ctx.stroke();
      }
    }
    // the growth site (engine.js drawResponse)
    if (main) {
      const n = CHN[st.site], sx = nodeS[2 * n], sy = nodeS[2 * n + 1], ph = (now / 1000 % 1.6) / 1.6;
      ctx.strokeStyle = rgba(C.growth, 1 - ph); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, 8 + ph * 26, 0, 7); ctx.stroke();
      ctx.fillStyle = rgba(C.growth, 1); ctx.beginPath(); ctx.arc(sx, sy, 7.5, 0, 7); ctx.fill();
      ctx.strokeStyle = rgba(C.white, 1); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx - 3.6, sy); ctx.lineTo(sx + 3.6, sy); ctx.moveTo(sx, sy - 3.6); ctx.lineTo(sx, sy + 3.6); ctx.stroke();
    }
    // sensors (engine.js drawSet): dark discs for phase 1, dashed rings for phase 2
    S.forEach((c, i) => {
      const n = CHN[c], x = nodeS[2 * n], y = nodeS[2 * n + 1], later = !st.own && st.k > P1 && i >= P1;
      ctx.font = `700 ${later ? 10 : 11}px Inter, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if (later) {
        ctx.fillStyle = rgba(C.white, 0.95); ctx.strokeStyle = rgba(C.ink, 1); ctx.lineWidth = 2.2; ctx.setLineDash([3, 2.5]);
        ctx.beginPath(); ctx.arc(x, y, 8.5, 0, 7); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = rgba(C.ink, 1); ctx.fillText(String(i + 1), x, y + 0.5);
      } else {
        const seen = main && cur.seen.includes(c);
        if (seen) { const ph = ((now / 1000) % 1.6) / 1.6; ctx.strokeStyle = rgba(C.pipe, 0.7 * (1 - ph)); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 10 + ph * 18, 0, 7); ctx.stroke(); }
        ctx.fillStyle = rgba(seen ? C.pipe : C.ink, 1); ctx.strokeStyle = rgba(C.white, 1); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = rgba(C.white, 1); ctx.fillText(String(i + 1), x, y + 0.5);
      }
    });
    // hover, a place named in the text, and the pulses after a change
    if (hov && hov.ch != null) {
      const n = CHN[hov.ch]; ctx.strokeStyle = rgba(C.ink, 0.8); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(nodeS[2 * n], nodeS[2 * n + 1], 13, 0, 7); ctx.stroke();
    }
    if (spot >= 0) {
      const x = nodeS[2 * spot], y = nodeS[2 * spot + 1], ph = (now / 1000 % 1) ;
      ctx.strokeStyle = rgba(C.growth, 1); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, 16, 0, 7); ctx.stroke();
      ctx.strokeStyle = rgba(C.growth, 1 - ph); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 16 + ph * 22, 0, 7); ctx.stroke();
    }
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i], t = (now - p.t0) / 1100;
      if (t > 1) { pulses.splice(i, 1); continue; }
      if (t < 0) continue;
      ctx.strokeStyle = rgba(C.growth, 0.85 * (1 - t)); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(nodeS[2 * p.n], nodeS[2 * p.n + 1], 6 + t * 20, 0, 7); ctx.stroke();
    }
    placeSiteLabel();
  }
  // the "+150 homes" label over the growth site (engine.js .lbl.growth)
  const namedInPanel = {};
  const siteLbl = document.createElement("div");
  siteLbl.className = "lbl growth on"; labelsEl.appendChild(siteLbl);
  function placeSiteLabel() {
    const main = st.view === "main" || st.view === "rise";
    siteLbl.style.display = main ? "" : "none";
    if (!main) return;
    const n = CHN[st.site], s = streetOf(n);
    // the panel names the site too: redraw it once the tiles can name the street
    if (s && !(n in namedInPanel)) { namedInPanel[n] = 1; render(false); return; }
    const html = `+${st.add} homes${s ? `<small>${esc(s)}</small>` : ""}`;
    if (siteLbl.innerHTML !== html) siteLbl.innerHTML = html;
    siteLbl.style.transform = `translate(${nodeS[2 * n].toFixed(1)}px, ${(nodeS[2 * n + 1] - 14).toFixed(1)}px) translate(-50%, -100%)`;
  }

  // ------------------------------------------------------------------ hit testing and the hover tooltip
  function nearestChamber(x, y, r) {
    let best = -1, bd = r * r;
    for (let c = 0; c < NCH; c++) {
      const n = CHN[c]; if (n == null) continue;
      const dx = nodeS[2 * n] - x, dy = nodeS[2 * n + 1] - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  function nearestPipe(x, y, r) {
    let best = -1, bd = r * r;
    for (let l = 0; l < NP; l++) for (let v = G.ptr[l]; v < G.ptr[l + 1] - 1; v++) {
      const ax = vS[2 * v], ay = vS[2 * v + 1], bx = vS[2 * v + 2], by = vS[2 * v + 3];
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
      const ex = ax + t * dx - x, ey = ay + t * dy - y, d = ex * ex + ey * ey;
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }
  function hitAt(x, y) {
    const c = nearestChamber(x, y, 11);
    if (c >= 0) return { ch: c };
    const l = nearestPipe(x, y, 6);
    return l >= 0 ? { pipe: l } : null;
  }
  function tipHtml(h) {
    const main = st.view === "main" || st.view === "rise";
    if (h.ch != null) {
      const c = h.ch, n = CHN[c], no = sensorNo(c), s = streetOf(n), lines = [];
      if (no) lines.push(`Sensor ${no}${phaseOf(no) ? " · " + phaseOf(no) : ""}`);
      if (main) {
        if (c === st.site) lines.push(`${st.add} new homes connect here`);
        else lines.push(cur.g[c] ? `Rises ${["", "10–25 mm", "25–50 mm", "50 mm or more"][cur.g[c]]} with these homes` : "No rise of 10 mm or more");
        if (cur.alarm.has(c)) lines.push(`Pushed past the ${R.alarmMm} mm alarm`);
      } else {
        const t = tipOf(st.xcs, st.xs, RULE, c);
        lines.push(t.length ? (hits(sensors())(t) ? `${st.xs} homes here: caught` : `${st.xs} homes here: missed`) : `${st.xs} homes here: too small to notice`);
      }
      const act = st.own ? (no ? "Click to remove this sensor" : "Click to add a sensor here") : main && c !== st.site ? "Click to connect the homes here" : "Click for details";
      if (G.nodes[n].depth) lines.push(G.nodes[n].depth.toFixed(1) + " m deep");
      return `<b>Manhole${s ? " · " + esc(s) : ""}</b><br>${lines.join("<br>")}<br><i>${act}</i>`;
    }
    const l = h.pipe, lines = [];
    if (main && cur.route.has(l)) lines.push("Carries the new homes' sewage");
    if (G.pyr && G.pyr[l]) lines.push("Laid in " + G.pyr[l]);
    return `<b>Pipe · ${G.dia[l]} mm</b>${lines.length ? "<br>" + lines.join("<br>") : ""}<br><i>Click for details</i>`;
  }
  function onMove(x, y, cx, cy) {
    hov = hitAt(x, y);
    const cv = map ? map.getCanvas() : canvas;
    cv.style.cursor = hov ? "pointer" : "";
    if (!hov) return hideTip();
    tip.innerHTML = tipHtml(hov); tip.style.left = cx + "px"; tip.style.top = cy + "px"; tip.classList.add("on");
  }
  function onClick(x, y) {
    const h = hitAt(x, y);
    if (!h) return closeDetail();
    if (h.ch != null) {
      const c = h.ch;
      if (st.own) {
        const i = st.own.indexOf(c);
        if (i >= 0 && st.own.length > 1) change("own", () => { st.own = st.own.filter((m) => m !== c); });
        else if (i < 0 && st.own.length < K) change("own", () => { st.own = st.own.concat([c]); });
      } else if (st.view === "main" || st.view === "rise") {
        if (c !== st.site) change("site", () => { st.site = c; });
      }
      showDetail({ ch: c });
    } else showDetail({ pipe: h.pipe });
    onMove(x, y, lastXY[0], lastXY[1]);
  }
  let lastXY = [0, 0];

  // ------------------------------------------------------------------ start
  function loop(now) { draw(now); requestAnimationFrame(loop); }
  function start() {
    try {
      if (!window.maplibregl) throw new Error("no maplibre");
      map = new maplibregl.Map({ container: "map", style: buildMapStyle(), attributionControl: false, dragRotate: false,
        pitchWithRotate: false, touchPitch: false, fadeDuration: 0, maxZoom: 18.5, minZoom: 12,
        bounds: [[BOUNDS[0], BOUNDS[1]], [BOUNDS[2], BOUNDS[3]]], fitBoundsOptions: { padding: mapPadding() } });
      map.touchZoomRotate.disableRotation();
      map.on("move", project);
      map.on("resize", project);
      map.on("mousemove", (e) => { lastXY = [e.originalEvent.clientX, e.originalEvent.clientY]; onMove(e.point.x, e.point.y, lastXY[0], lastXY[1]); });
      map.on("mouseout", () => { hov = null; hideTip(); });
      map.on("click", (e) => onClick(e.point.x, e.point.y));
      map.once("load", () => $("loading").classList.add("done"));
      // street names arrive with the tiles: name the growth site once they have
      map.once("idle", () => render(false));
    } catch (e) {
      map = null;
      $("stage").style.pointerEvents = "auto";
      canvas.addEventListener("mousemove", (ev) => { lastXY = [ev.clientX, ev.clientY]; onMove(ev.clientX, ev.clientY, ev.clientX, ev.clientY); });
      canvas.addEventListener("mouseleave", () => { hov = null; hideTip(); });
      canvas.addEventListener("click", (ev) => onClick(ev.clientX, ev.clientY));
      $("loading").classList.add("done");
    }
    resize();
    // until someone pans or zooms, a new window size refits the network
    let moved = false;
    if (map) { map.on("dragstart", () => { moved = true; }); map.on("wheel", () => { moved = true; }); }
    addEventListener("resize", () => {
      if (map) { map.resize(); if (!moved) map.fitBounds([[BOUNDS[0], BOUNDS[1]], [BOUNDS[2], BOUNDS[3]]], { padding: mapPadding(), duration: 0 }); }
      resize();
    });
    setTimeout(() => $("loading").classList.add("done"), 6000);
    render(true);
    requestAnimationFrame(loop);
  }
  start();

  // read by tools/test_sandbox.js and handy in the console
  window.Explore = { state: () => Object.assign({}, st, { sensors: sensors().slice() }), score, recommended, result: () => cur,
    map: () => map, screenOf: (ch) => [nodeS[2 * CHN[ch]], nodeS[2 * CHN[ch] + 1]],
    pipeAt: (l) => { const v = G.ptr[l]; return [(vS[2 * v] + vS[2 * v + 2]) / 2, (vS[2 * v + 1] + vS[2 * v + 3]) / 2]; } };
})();
