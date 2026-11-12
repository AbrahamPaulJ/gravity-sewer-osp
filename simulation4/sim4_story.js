/* Sim 4 story page: six steps on a full map. Every number and sentence comes from data/sim4.js, built from
   simulation_src/results/sim4/numbers.json by tools/build_sim4_web.py, or straight from the region runs in
   data/regions.js: the equal-home regions (Kim et al. 2022 spatial bisection) plus the Walkerville Terrace
   corridor, which overlaps them (overlay: true). */
const Sim4 = (() => {
  const $ = s => document.querySelector(s);
  const D = () => window.SIM4, G = () => window.GROWTH_GEOM, R = () => window.GROWTH_RUNS, S = () => window.SIM3_REGIONS;
  const nameOf = i => R().chambers[i];
  const ACTION_COL = { monitor: "#ff5c7a", watch: "#ffa500", leave: "#33435f" };
  const LEGEND = {
    was: ["#ffa500", "Surcharged before growth"], rise: ["#fff176", "Rises 10 mm or more"], tip: ["#ff2d55", "Newly surcharged"],
    monitor: [ACTION_COL.monitor, "Monitor"], watch: [ACTION_COL.watch, "Watch"], leave: [ACTION_COL.leave, "Leave"], sensor: ["#2ef56b", "Sensor"],
  };
  // Step 3's "Regions" view: every region in its own colour, the same colours by id as the Explore page (explore_ui.js).
  const REGION_COLS = { R1: "#3987e5", R2: "#d95926", R3: "#008300", R4: "#e87ba4", R5: "#199e70", R6: "#39c5cf", R7: "#b08457", R8: "#9085e9", R9: "#c9d1d9" };
  const regionCol = ri => REGION_COLS[S().regions[ri].id] || "#5b6470";
  const SWEEP_MS = 3200;
  // regions: the Regions view is on (step 3 only; off again on leaving the step or reloading).
  // onMap: the legend keys whose colour the map shows right now, so the legend lists only those.
  const st = { i: 0, level: 5, pick: null, sweep: null, popAt: null, popSide: "right", expert: false, regions: false, onMap: new Set() };

  /* The region each map point is painted in: the same rule as Sim 3.5, so regions look the same on both pages. */
  let _paint = null;
  function regionPaint() {
    if (_paint) return _paint;
    const g = G(), N = g.nodes.length, own = new Array(N).fill(-1), out = g.nodes.map(() => []);
    for (let p = 0; p < g.nPipes; p++) out[g.up[p]].push(p);
    g.nodes.forEach((nd, a) => { if (nd.kind === "chamber") own[a] = a; });
    for (let a = 0; a < N; a++) {
      if (g.nodes[a].kind !== "chamber") continue;
      const stack = [a];
      while (stack.length) out[stack.pop()].forEach(p => {
        const d = g.down[p];
        if (own[d] < 0 && g.nodes[d].kind === "inline") { own[d] = a; stack.push(d); }
      });
    }
    for (let a = 0; a < N; a++) {
      if (own[a] >= 0 || g.nodes[a].kind !== "inline") continue;
      const path = [a], seen = new Set();
      let cur = a;
      while (own[cur] < 0 && out[cur].length && !seen.has(cur)) { seen.add(cur); cur = g.down[out[cur][0]]; path.push(cur); }
      if (own[cur] >= 0) path.forEach(x => { own[x] = own[cur]; });
    }
    const of = new Array(N).fill(-1), byChamber = {}, idx = {};
    g.nodes.forEach((nd, a) => { idx[nd.name] = a; });
    S().regions.forEach((r, ri) => { if (!r.overlay) r.manholes.forEach(i => { const a = idx[nameOf(i)]; if (byChamber[a] === undefined) byChamber[a] = ri; }); });
    own.forEach((o, a) => { if (o >= 0 && byChamber[o] !== undefined) of[a] = byChamber[o]; });
    // A region that overlaps the others (the corridor) never takes their points: it is kept apart, for its label and tint.
    const overlayOf = new Array(N).fill(-1);
    S().regions.forEach((r, ri) => {
      if (!r.overlay) return;
      const mine = new Set(r.manholes.map(i => idx[nameOf(i)]));
      own.forEach((o, a) => { if (o >= 0 && mine.has(o)) overlayOf[a] = ri; });
    });
    const labelAt = S().regions.map((r, ri) => {
      const pts = [], on = r.overlay ? overlayOf : of; on.forEach((x, a) => { if (x === ri && g.nodes[a].kind === "chamber") pts.push(a); });
      const cx = pts.reduce((t, a) => t + g.nodes[a].x, 0) / (pts.length || 1), cy = pts.reduce((t, a) => t + g.nodes[a].y, 0) / (pts.length || 1);
      const at = pts.reduce((b, a) => Math.hypot(g.nodes[a].x - cx, g.nodes[a].y - cy) < Math.hypot(g.nodes[b].x - cx, g.nodes[b].y - cy) ? a : b, pts[0]);
      return at === undefined ? nameOf(r.manholes[0]) : g.nodes[at].name;
    });
    return (_paint = { of, overlayOf, labelAt });
  }

  const LEVELS = () => S().ladder.map((v, s) => ({ v, s })).filter(x => x.v <= 1);     // stress steps never appear here
  const designRows = () => S().rows[D().design];
  function growthState(level) {
    const named = {};
    S().base[D().design].surcharged.forEach(i => { named[nameOf(i)] = "was"; });
    const labels = S().regions.map((r, ri) => ({ names: [regionPaint().labelAt[ri]], text: r.id, col: "#8b949e" }));
    let spills = [];
    if (level > 0) {
      const { s } = LEVELS()[level - 1];
      designRows().filter(x => x.s === s).forEach(x => {
        x.rise.forEach(([i, mm]) => { if (mm >= 10 && !named[nameOf(i)]) named[nameOf(i)] = "rise"; });
      });
      designRows().filter(x => x.s === s).forEach(x => {
        x.sur.forEach(i => { named[nameOf(i)] = "tip"; });
        spills = spills.concat(x.spill.map(nameOf));
        const top = Math.max(0, ...x.rise.map(([, mm]) => mm));
        labels[x.r] = { names: [regionPaint().labelAt[x.r]], text: `${S().regions[x.r].id}: up to +${Math.round(top)} mm`, col: top >= 10 ? "#fff176" : "#8b949e" };
      });
    }
    return { named, labels, spills };
  }
  // The region each map point is drawn in, by name.
  let _at = null;
  function regionAt() {
    if (_at) return _at;
    const rp = regionPaint(), at = {};
    rp.of.forEach((ri, a) => { if (ri >= 0) at[G().nodes[a].name] = ri; });
    // The corridor is drawn over the regions it crosses when it needs looking at; left alone, it shows through.
    rp.overlayOf.forEach((ri, a) => { if (ri >= 0 && D().triage[S().regions[ri].id] !== "leave") at[G().nodes[a].name] = ri; });
    return (_at = at);
  }
  // Tints by region: the action colours by default, or any colour per region index.
  function regionTints(colOf = ri => ACTION_COL[D().triage[S().regions[ri].id]]) {
    const at = regionAt(), tints = {};
    for (const nm in at) tints[nm] = colOf(at[nm]);
    return tints;
  }
  const regionsShown = () => new Set(Object.values(regionAt()));
  const actionLabels = () => S().regions.map((r, ri) => {
    const a = D().triage[r.id];
    return { names: [regionPaint().labelAt[ri]], text: a === "leave" ? r.id : `${r.id} ${a[0].toUpperCase()}${a.slice(1)}`, col: a === "leave" ? "#8b949e" : ACTION_COL[a] };
  });

  /* ---------------------------------------------------------- painting a step */
  const step = () => D().steps[st.i];
  const sensorNames = () => step().k ? D().ladder[step().k] : [];
  function paintMap() {
    const s = step(), base = S().base[D().design];
    Growth3D.setPumpRates([]); Growth3D.setPulse([]); Growth3D.setScenario([]);
    if (s.map === "plain") {
      Growth3D.setRegionTints(null); Growth3D.paint({}, null, [], null);
      Growth3D.setRegionLabels([]); Growth3D.setSpills([], []);
    } else if (s.map === "base") {
      const named = {}; base.surcharged.forEach(i => { named[nameOf(i)] = "was"; });
      Growth3D.setRegionTints(null); Growth3D.paint(named, null, [], null);
      Growth3D.setRegionLabels([]); Growth3D.setSpills(base.spilled.map(nameOf), []);
    } else if (s.map === "growth" && st.regions) {
      // The Regions view: each region in its own colour and nothing else, so no surcharge, rise or spill colours.
      Growth3D.setRegionTints(regionTints(regionCol)); Growth3D.paint({}, null, [], null);
      Growth3D.setRegionLabels(S().regions.map((r, ri) => ({ names: [regionPaint().labelAt[ri]], text: r.id, col: regionCol(ri) })));
      Growth3D.setSpills([], []);
    } else if (s.map === "growth") {
      const g = growthState(st.level);
      Growth3D.setRegionTints(null); Growth3D.paint(g.named, null, [], null);
      Growth3D.setRegionLabels(g.labels); Growth3D.setSpills(base.spilled.map(nameOf), g.spills);
    } else {
      Growth3D.setRegionTints(regionTints());
      Growth3D.paint({}, null, sensorNames(), null);
      Growth3D.setRegionLabels(actionLabels()); Growth3D.setSpills([], []);
    }
    Growth3D.setCoverSelect(st.pick && sensorNames().includes(st.pick) ? st.pick : null, []);
    st.onMap = onMap();
    renderLegend();
  }
  // What the map shows for the step as painted, in legend keys: a region view gives region indices.
  function onMap() {
    const s = step(), keys = new Set();
    if (s.map === "base") { if (S().base[D().design].surcharged.length) keys.add("was"); }
    else if (s.map === "growth" && st.regions) regionsShown().forEach(ri => keys.add(ri));
    else if (s.map === "growth") Object.values(growthState(st.level).named).forEach(k => keys.add(k));
    else if (s.map !== "plain") {
      if (sensorNames().length) keys.add("sensor");
      regionsShown().forEach(ri => keys.add(D().triage[S().regions[ri].id]));
    }
    return keys;
  }
  // The legend lists only the colours on the map now: a step's list is the most it can show.
  function renderLegend() {
    const s = step(), regionView = s.map === "growth" && st.regions;
    const items = regionView
      ? S().regions.map((r, ri) => ri).filter(ri => st.onMap.has(ri))
          .sort((a, b) => String(S().regions[a].id).localeCompare(String(S().regions[b].id), undefined, { numeric: true }))
          .map(ri => [regionCol(ri), S().regions[ri].id])
      : (s.legend || []).filter(k => st.onMap.has(k)).map(k => LEGEND[k]);
    $("#legend").innerHTML = items.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join("");
    const b = $("#btnRegions");
    b.hidden = s.map !== "growth";
    b.setAttribute("aria-pressed", String(regionView));
  }
  function renderLevel() {
    const lv = LEVELS(), v = st.level === 0 ? 0 : lv[st.level - 1].v;
    $("#homes").value = String(st.level);
    $("#homesOut").textContent = `${Math.round(v * 100)}% of each region's 2041 homes`;
  }
  function renderCard() {
    const s = step(), total = D().steps.length;
    $("#stepN").textContent = `Step ${s.n} of ${D().stepCount}`;
    $("#stepTitle").textContent = s.title;
    $("#stepBody").textContent = s.body;
    $("#sliderRow").hidden = !s.slider;
    $("#back").disabled = st.i === 0;
    $("#next").disabled = st.i === total - 1;
    $("#dots").innerHTML = Array.from({ length: D().stepCount }, (_, a) => `<i class="${a + 1 === s.n ? "on" : ""}"></i>`).join("");
    const c = $("#card"); c.classList.remove("in"); void c.offsetWidth; c.classList.add("in");
  }
  function stopSweep() { if (st.sweep) { cancelAnimationFrame(st.sweep); st.sweep = null; } }
  function sweep() {
    stopSweep();
    if (window.matchMedia("(prefers-reduced-motion:reduce)").matches || /(^|[#&])still=1/.test(location.hash)) { st.level = 5; renderLevel(); paintMap(); return; }
    const t0 = performance.now(); let last = -1;
    const tick = now => {
      const lv = Math.max(0, Math.min(5, Math.floor((now - t0) / SWEEP_MS * 6)));     // the frame's clock can start just before t0
      if (lv !== last) { last = lv; st.level = lv; renderLevel(); paintMap(); }
      st.sweep = lv < 5 ? requestAnimationFrame(tick) : null;
    };
    st.sweep = requestAnimationFrame(tick);
  }
  function go(i, push = true) {
    stopSweep(); hidePop();
    const to = Math.max(0, Math.min(D().steps.length - 1, i));
    if (to !== st.i) st.regions = false;     // the Regions view belongs to the step it was turned on in
    st.i = to;
    renderCard();
    st.level = 5; renderLevel(); paintMap();
    if (step().slider) sweep();
    if (push) history.replaceState(null, "", "#step=" + step().id);
  }

  /* ---------------------------------------------------------- the popup, on any click */
  function hidePop() {
    st.pick = null; st.popAt = null;
    $("#pop").hidden = true;
    Growth3D.setCoverSelect(null);
  }
  const esc = t => String(t).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const regionOf = name => { const ri = regionPaint().of[G().nodes.findIndex(n => n.name === name)]; return ri >= 0 ? ri : null; };
  // The corridor overlaps the eight regions: " Also on the corridor, R9: watch." for a manhole on it, else "".
  const overlayNote = name => { const oi = regionPaint().overlayOf[G().nodes.findIndex(n => n.name === name)];
    return oi >= 0 ? ` Also on the corridor, ${S().regions[oi].id}: ${D().triage[S().regions[oi].id]}.` : ""; };
  // Opens the popup at a manhole; the playground uses it too, with its own words and its own sensors to keep clear of.
  function openPop(name, html, sel, avoid) {
    st.pick = name;
    const box = $("#pop");
    box.innerHTML = html;
    Growth3D.setCoverSelect(sel ? name : null, []);
    box.hidden = false;
    st.popAt = name;
    st.popSide = popSide(name, avoid || sensorNames());
  }
  function showPop(name) {
    const k = step().k, info = k ? D().popups[k].find(x => x.name === name) : null;
    if (info) {
      openPop(name, `<b>Sensor ${info.n} of ${k}: ${esc(name)}</b><dl><dt>Listens to</dt><dd>${esc(info.listens)}</dd><dt>First reacts</dt><dd>${esc(info.reacts)}</dd><dt>Without it</dt><dd>${esc(info.lost)}</dd></dl>${info.note ? `<p>${esc(info.note)}</p>` : ""}`, true);
    } else {
      const ri = regionOf(name), r = ri == null ? null : S().regions[ri].id;
      openPop(name, `<b>${esc(name)}</b><p>${r ? `In ${r}: ${D().triage[r]}.` : "Not in a region."}${esc(overlayNote(name))} No sensor here.</p>`, false);
    }
  }
  // Where the popup sits for one side of a manhole: kept on screen.
  function popRect(at, side, w, h) {
    const m = 12, gap = 20;
    let x = side === "right" ? at.x + gap : side === "left" ? at.x - w - gap : at.x - w / 2;
    let y = side === "below" ? at.y + gap : side === "above" ? at.y - h - gap : at.y - h / 2;
    x = Math.max(m, Math.min(innerWidth - w - m, x));
    y = Math.max(m, Math.min(innerHeight - h - m, y));
    return { x, y, w, h };
  }
  // The first side that hides neither the manhole, another sensor, the step card nor the Expert panel. Chosen once per popup,
  // so it never jumps.
  function popSide(name, avoid) {
    const at = Growth3D.screenOf(name), box = $("#pop");
    if (!at) return "right";
    const w = box.offsetWidth, h = box.offsetHeight;
    const blocks = ["#card", "#expert"].map(s => $(s)).filter(el => !el.hidden).map(el => el.getBoundingClientRect());
    const hides = (r, p, pad = 14) => p.x > r.x - pad && p.x < r.x + r.w + pad && p.y > r.y - pad && p.y < r.y + r.h + pad;
    const others = avoid.filter(n => n !== name).map(n => Growth3D.screenOf(n)).filter(Boolean);
    const free = side => {
      const r = popRect(at, side, w, h);
      const over = blocks.some(b => r.x < b.right && r.x + w > b.left && r.y < b.bottom && r.y + h > b.top);
      return !over && !others.some(p => hides(r, p));
    };
    return ["right", "left", "below", "above"].find(free) || "right";
  }
  function placePop() {
    if (st.popAt) {
      const at = Growth3D.screenOf(st.popAt), box = $("#pop");
      if (at) {
        const r = popRect(at, st.popSide, box.offsetWidth, box.offsetHeight);
        box.style.left = r.x + "px";
        box.style.top = r.y + "px";
      }
    }
    requestAnimationFrame(placePop);
  }

  /* ---------------------------------------------------------- start */
  // Expert takes the map over while it is open (the playground paints it); closing gives the step back.
  function toggleExpert(on, pane) {
    stopSweep(); hidePop();
    st.expert = on == null ? !st.expert : on;
    $("#expert").hidden = !st.expert;
    $("#card").hidden = st.expert;
    $("#btnExpert").setAttribute("aria-expanded", String(st.expert));
    $("#btnExpert").textContent = st.expert ? "Close Expert" : "Expert";
    if (st.expert) Sim4Play.open(pane || Sim4Play.pane());
    else { Sim4Play.close(); paintMap(); history.replaceState(null, "", "#step=" + step().id); }
  }
  function init() {
    $("#expertTables").innerHTML = D().expert.tables;
    $("#expertLimits").innerHTML = D().expert.limits;
    Growth3D.build($("#stage"), nd => {
      if (st.expert) { Sim4Play.pick(nd); return; }
      if (!nd) { hidePop(); paintMap(); return; }
      showPop(nd.name);
    }, nd => { $("#stage").style.cursor = nd ? "pointer" : ""; }).then(() => {
      Growth3D.frame(null);
      const want = (location.hash.match(/step=([0-9a-z]+)/) || [])[1];
      const at = D().steps.findIndex(s => s.id === want);
      Sim4Play.init();
      go(at < 0 ? 0 : at, false);
      const ex = (location.hash.match(/expert=(play|tables|limits)/) || [])[1];
      if (ex) { Sim4Play.fromHash(location.hash); toggleExpert(true, ex); }
      placePop();
      document.body.dataset.ready = "1";
    });
    $("#next").onclick = () => go(st.i + 1);
    $("#back").onclick = () => go(st.i - 1);
    // Pressing the slider ends the sweep even where the value does not change, because then no input event fires.
    $("#homes").onpointerdown = stopSweep;
    $("#homes").onkeydown = stopSweep;
    $("#homes").oninput = e => { stopSweep(); hidePop(); st.level = +e.target.value; renderLevel(); paintMap(); };
    $("#btnExpert").onclick = () => toggleExpert();
    $("#btnRegions").onclick = () => { hidePop(); st.regions = !st.regions; paintMap(); };
    $("#expertClose").onclick = () => toggleExpert(false);
    addEventListener("keydown", e => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      if (st.expert && e.key !== "Escape") return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(st.i + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(st.i - 1);
      else if (e.key === "Escape") { if (st.expert) toggleExpert(false); else { hidePop(); paintMap(); } }
    });
    addEventListener("resize", () => Growth3D.resize($("#stage")));
  }
  return { init, state: st, step, levels: LEVELS, sensors: sensorNames, growthState, regionPaint, regionTints, actionLabels, regionOf, overlayNote,
           openPop, hidePop, esc, ACTION_COL, LEGEND, REGION_COLS, toggleExpert };
})();
