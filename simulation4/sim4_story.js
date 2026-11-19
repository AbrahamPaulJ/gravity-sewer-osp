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
    monitor: [ACTION_COL.monitor, "Monitor"], watch: [ACTION_COL.watch, "Watch"], leave: [ACTION_COL.leave, "Leave"], sensor: ["#2ef56b", "Level sensor"],
  };
  // Step 3's "Regions" view: every region in its own colour, the same colours by id as the Explore page (explore_ui.js).
  const REGION_COLS = { R1: "#3987e5", R2: "#d95926", R3: "#008300", R4: "#e87ba4", R5: "#199e70", R6: "#39c5cf", R7: "#b08457", R8: "#9085e9", R9: "#c9d1d9" };
  const regionCol = ri => REGION_COLS[S().regions[ri].id] || "#5b6470";
  // The light theme draws the rise in a darker yellow (growth_3d.js THEMES), so the legend and labels follow it.
  const theme = () => document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const riseCol = () => theme() === "light" ? "#c99a00" : "#fff176";
  const SWEEP_MS = 3200;
  // regions: the Regions view is on (step 3 only; off again on leaving the step or reloading).
  // onMap: the legend keys whose colour the map shows right now, so the legend lists only those.
  // notes: the "Behind this step" fold is open; closed by default, it stays as the reader left it across steps.
  const st = { i: 0, level: 5, pick: null, sweep: null, popAt: null, popSide: "right", regions: false, onMap: new Set(), notes: false };

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
        labels[x.r] = { names: [regionPaint().labelAt[x.r]], text: `${S().regions[x.r].id}: up to +${Math.round(top)} mm`, col: top >= 10 ? riseCol() : "#8b949e" };
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
      : (s.legend || []).filter(k => st.onMap.has(k)).map(k => k === "rise" ? [riseCol(), LEGEND.rise[1]] : LEGEND[k]);
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
    renderWhy(s);
    $("#sliderRow").hidden = !s.slider;
    $("#back").disabled = st.i === 0;
    $("#next").disabled = st.i === total - 1;
    $("#dots").innerHTML = Array.from({ length: D().stepCount }, (_, a) => `<i class="${a + 1 === s.n ? "on" : ""}"></i>`).join("");
    renderNotes();
    placeNotes();
    const c = $("#card"); c.classList.remove("in"); void c.offsetWidth; c.classList.add("in");
    c.scrollTop = 0;
  }
  /* "Behind this step": Assumes, Source, Limit and Next, the tables behind the step in a second fold, and the link to
     the redo guide. Built by tools/build_sim4_web.py from numbers.json; the text is escaped here, the tables are the builder's. */
  const ROWS = [["assumes", "Assumes"], ["source", "Source"], ["limit", "Limit"], ["next", "Next"]];
  // A cited source in the team's paper library becomes a link to it (library.js); the text is escaped first.
  const cite = html => window.SIM4_LIBRARY ? window.SIM4_LIBRARY.link(html) : html;
  function renderNotes() {
    const n = step().notes, box = $("#notes");
    if (!n) { $("#notesBar").hidden = true; box.hidden = true; return; }
    $("#notesBar").hidden = false;
    const figs = (n.figures || []).map(f => `<div class="fig"><h3>${esc(f.title)}</h3>${f.intro ? `<p>${cite(esc(f.intro))}</p>` : ""}<div class="tscroll">${f.table}</div></div>`).join("");
    // "More on this step": items first shown in the product demo, re-scored on the story's test (tools/sim4_more.py),
    // closed by default. Intros are text, escaped here; html and the widgets' data are the builder's.
    const m = n.more, more = m ? m.blocks.map(b => `<div class="fig more">${b.title ? `<h3>${esc(b.title)}</h3>` : ""}${b.intro ? `<p>${cite(esc(b.intro))}</p>` : ""}` +
      (b.widget ? `<div class="widget" data-widget="${b.widget}"></div>` : "") + (b.html ? `<div class="tscroll">${cite(b.html)}</div>` : "") + "</div>").join("") : "";
    box.innerHTML = `<dl>${ROWS.map(([k, h]) => `<dt>${h}</dt><dd>${cite(esc(n[k]))}</dd>`).join("")}</dl>` +
      (more ? `<details id="more"><summary>${esc(m.title)}</summary>${more}</details>` : "") +
      (figs ? `<details id="figs"><summary>Figures behind this step</summary>${figs}</details>` : "") +
      `<a class="redo" href="redo.html#${n.redo}">How to redo this for another suburb</a>`;
    box.querySelectorAll("[data-widget]").forEach(el => (WIDGETS[el.dataset.widget] || (() => {}))(el));
    setNotes(st.notes);
  }

  /* The two drawings in "More on this step", from SIM4.more (tools/build_sim4_web.py, figures from tools/sim4_more.py). */
  const WIDGETS = {
    // Step 1: every pipe, coloured by one attribute, with how many pipes fall in each band.
    pipes(el) {
      const P = D().more.pipes, g = G(), keys = Object.keys(P);
      let by = el.dataset.pick || "util";
      const SEQ = ["#4f86c6", "#6fa8dc", "#8fbf9a", "#e0b04f", "#e8893a", "#d9602e", "#b8322a"], CAT = ["#c98a4b", "#3d8bd4", "#8b949e"];
      const colours = a => !a.seq ? CAT.slice(0, a.bins.length) : (c => a.rev ? c.reverse() : c)(a.bins.map((_, k) => SEQ[a.bins.length < 2 ? 0 : Math.round(k * (SEQ.length - 1) / (a.bins.length - 1))]));
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let k = 0; k < g.px.length; k++) { x0 = Math.min(x0, g.px[k]); x1 = Math.max(x1, g.px[k]); y0 = Math.min(y0, g.py[k]); y1 = Math.max(y1, g.py[k]); }
      const W = 420, H = Math.round(W * (y1 - y0) / (x1 - x0)), sx = v => ((v - x0) / (x1 - x0) * (W - 8) + 4).toFixed(1), sy = v => ((y1 - v) / (y1 - y0) * (H - 8) + 4).toFixed(1);
      const path = p => { let d = ""; for (let k = g.ptr[p]; k < g.ptr[p + 1]; k++) d += (k === g.ptr[p] ? "M" : "L") + sx(g.px[k]) + " " + sy(g.py[k]); return d; };
      const draw = () => {
        const a = P[by], col = colours(a), max = Math.max(...a.count);
        const lines = a.of.map((k, p) => `<path d="${path(p)}" stroke="${k < 0 ? "var(--faint)" : col[k]}" stroke-width="${k < 0 ? 0.8 : 1.6}"/>`).join("");
        el.innerHTML = `<div class="chips" role="group" aria-label="Colour the pipes by">${keys.map(k => `<button type="button" data-by="${k}" aria-pressed="${k === by}">${esc(P[k].label)}</button>`).join("")}</div>` +
          `<div class="pipesWrap"><svg class="pipemap" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(a.label)} of every pipe"><g fill="none" stroke-linecap="round">${lines}</g></svg>` +
          `<div class="bands">${a.unit ? `<div class="unit">${esc(a.unit)}</div>` : ""}${a.bins.map((b, k) => `<div class="band"><i style="background:${col[k]}"></i><span>${esc(b)}</span><span class="bar"><span style="width:${(a.count[k] / max * 100).toFixed(1)}%;background:${col[k]}"></span></span><b>${a.count[k]}</b></div>`).join("")}` +
          (a.unknown ? `<div class="band"><i style="background:var(--faint)"></i><span>Year not recorded</span><span class="bar"></span><b>${a.unknown}</b></div>` : "") + `</div></div>` +
          `<p class="wnote">${esc(a.note)}</p>`;
        el.querySelectorAll("[data-by]").forEach(b => b.onclick = () => { by = el.dataset.pick = b.dataset.by; draw(); });
      };
      draw();
    },
    // Step 2: one manhole cut open: water in the outlet pipe and the shaft, against 0.7 of the pipe, the pipe top and the lid.
    cutaway(el) {
      const C = D().more.cutaway, regs = Object.keys(C.homes);
      const s = { c: 0, r: regs[0], k: 0 };     // Design wet, the first region to monitor, today
      const stepLabel = k => k === 0 ? "Today" : `${Math.round(C.steps[k - 1] * 100)}% of ${s.r}'s 2041 homes, +${Math.round(C.homes[s.r] * C.steps[k - 1])}`;
      // The controls are drawn once, so dragging the slider is never interrupted; paint() redraws the picture only.
      el.innerHTML = `<div class="cutRow"><div class="cutSvg"></div><div class="cutCtl">
          <div class="badge"></div>
          <label>Weather <select>${C.cases.map((c, k) => `<option value="${k}"${k === s.c ? " selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>
          <div class="chips" role="group" aria-label="Homes added in">${regs.map(r => `<button type="button" data-r="${r}" aria-pressed="${r === s.r}">Homes in ${r}</button>`).join("")}</div>
          <label class="slide"><input type="range" min="0" max="${C.steps.length}" step="1" value="${s.k}" aria-label="Homes added"><span></span></label>
        </div></div>`;
      const paint = () => {
        const cs = C.cases[s.c], base = cs.base, water = base + (s.k ? cs.rise[s.r][s.k - 1] : 0), dia = C.dia, depth = C.depthM * 1000;
        const W = 340, Hc = 230, top = 22, bottom = Hc - 22, zone = Math.max(dia * 1.4, 1), split = top + (bottom - top) * 0.3;
        const y = mm => mm <= zone ? bottom - (bottom - split) * mm / zone : split - (split - top) * Math.min(1, (mm - zone) / Math.max(1, depth - zone));
        const sx0 = 140, sx1 = 216, px0 = 18, px1 = 322, lid = y(depth), wTop = y(Math.min(water, depth)), bTop = y(Math.min(base, depth));
        const state = water >= depth ? ["bad", "Overflowing at the lid"] : water > dia ? ["bad", "Surcharged: water above the pipe top"]
          : water > C.limit * dia ? ["warn", `Past the pipe limit, ${C.limit} of the pipe`] : ["ok", `Within the pipe limit, ${C.limit} of the pipe`];
        const line = (mm, t, cls, below) => `<line class="${cls}" x1="${px0}" x2="${px1}" y1="${y(mm).toFixed(1)}" y2="${y(mm).toFixed(1)}"/><text class="ax ${cls}" x="${px1 - 4}" y="${(y(mm) + (below ? 12 : -4)).toFixed(1)}" text-anchor="end">${t}</text>`;
        const svg = `<svg class="cut" viewBox="0 0 ${W} ${Hc}" role="img" aria-label="${esc(C.manhole)} cut open: water ${Math.round(water)} mm deep in a ${dia} mm pipe">
          <rect class="ground" x="0" y="${lid}" width="${W}" height="${Hc - lid}"/>
          <rect class="void" x="${sx0}" y="${lid}" width="${sx1 - sx0}" height="${bottom - lid}"/>
          <rect class="void" x="${px0}" y="${y(dia)}" width="${px1 - px0}" height="${bottom - y(dia)}"/>
          <rect class="water" x="${px0}" y="${Math.max(y(dia), wTop)}" width="${px1 - px0}" height="${bottom - Math.max(y(dia), wTop)}"/>
          ${water > dia ? `<rect class="water" x="${sx0}" y="${wTop}" width="${sx1 - sx0}" height="${y(dia) - wTop}"/>` : ""}
          <line class="base" x1="${px0}" x2="${px1}" y1="${bTop}" y2="${bTop}"/>
          ${line(C.limit * dia, `${C.limit} of pipe: the limit`, "lim")}${line(dia, "pipe top: surcharge above", "top")}
          <rect class="lid" x="${sx0 - 8}" y="${lid - 5}" width="${sx1 - sx0 + 16}" height="5"/><text class="ax" x="${W - 6}" y="${lid - 9}" text-anchor="end">Lid: overflow, ${C.depthM.toFixed(1)} m up</text>
          <text class="ax" x="${px0}" y="${split - 4}">shaft not to scale</text>
          <text class="ax" x="${px0}" y="${Hc - 6}">Water ${Math.round(water)} mm deep; today ${Math.round(base)} mm (dotted)</text></svg>`;
        el.querySelector(".cutSvg").innerHTML = svg;
        const b = el.querySelector(".badge");
        b.className = "badge " + state[0]; b.textContent = state[1];
        el.querySelector(".slide span").textContent = stepLabel(s.k);
        el.querySelectorAll("[data-r]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.r === s.r)));
      };
      el.querySelector("select").onchange = e => { s.c = +e.target.value; paint(); };
      el.querySelectorAll("[data-r]").forEach(x => x.onclick = () => { s.r = x.dataset.r; paint(); });
      el.querySelector("input").oninput = e => { s.k = +e.target.value; paint(); };
      paint();
    },
  };
  /* A step's own question, folded under its text (step 5b: "Why not the exact best set?"), closed when the step opens.
     Built by tools/build_sim4_web.py from the runs; the text is escaped here, the table is the builder's. */
  function renderWhy(s) {
    const w = s.why, b = $("#btnWhy"), box = $("#why");
    b.hidden = !w;
    if (!w) { box.hidden = true; box.innerHTML = ""; return; }
    b.querySelector("span").textContent = w.title;
    box.innerHTML = `<p>${cite(esc(w.intro))}</p><div class="tscroll">${w.table}</div>`;
    setWhy(/(^|[#&])why=1/.test(location.hash));
  }
  function setWhy(on) {
    $("#why").hidden = !on;
    $("#btnWhy").setAttribute("aria-expanded", String(on));
    placeNotes();
    placeMap();
  }
  function setNotes(on) {
    st.notes = on;
    $("#notes").hidden = !on;
    $("#btnNotes").setAttribute("aria-expanded", String(on));
    $("#btnNotes").title = on ? "Hide what sits behind this step" : "What this step assumes, its sources, its limits and what comes next";
    if (!on) $("#notes").scrollTop = 0;
    placeNotes();
    placeMap();
  }
  /* 19 Nov: an open "Behind this step" runs down to the card's lowest edge, 16 px above the bottom of the screen (on a
     phone, above Explore and the theme switch, or above the sensor sheet when that is open), so far more of it shows
     before it scrolls; before, it stopped at 46% of the screen. The card never runs past the screen: the fold scrolls
     inside itself, and a short fold is only as tall as its words. Shut, the card is as short as ever. */
  const NOTES_MIN = 140;
  function placeNotes() {
    const c = $("#card"), n = $("#notes");
    if (n.hidden) { n.style.maxHeight = ""; return; }
    const cs = getComputedStyle(c), maxH = parseFloat(cs.maxHeight) || innerHeight - 32;
    let bottom = c.offsetTop + maxH;
    const p = $("#pop");
    if (p && !p.hidden && st.popSide === "sheet") bottom = Math.min(bottom, p.offsetTop - 8);
    const top = c.offsetTop + (n.getBoundingClientRect().top - c.getBoundingClientRect().top);     // a difference, so the card's entry animation does not move it
    const room = Math.max(NOTES_MIN, Math.floor(bottom - top - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth)));
    n.style.maxHeight = room + "px";
    const over = c.scrollHeight - c.clientHeight;     // anything laid out below the fold (margins, padding) still fits
    if (over > 0) n.style.maxHeight = Math.max(NOTES_MIN, room - over) + "px";
  }
  // The map moves down by half the card's height, so it centres in the space below the card at the same scale.
  // A shift, not a smaller canvas: the stage keeps its size, so nothing is resized and the reader's view is kept.
  // An open "Behind this step" fold is read and closed again, so it lies over the map rather than moving it.
  function placeMap() {
    const c = $("#card"), n = $("#notes"), w = $("#why");
    const natural = c.scrollHeight + c.offsetHeight - c.clientHeight - (n.hidden ? 0 : n.offsetHeight + 6) - (w.hidden ? 0 : w.offsetHeight + 10);     // the card's height with the folds shut
    const below = c.hidden ? 0 : c.offsetTop + Math.min(c.offsetHeight, natural);
    const p = $("#pop"), sheet = p && !p.hidden && st.popSide === "sheet" ? p.offsetHeight + 8 : 0;     // the phone's bottom sheet
    document.documentElement.style.setProperty("--map-shift", Math.round((below - sheet) / 2) + "px");
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
    const was = !$("#pop").hidden;
    st.pick = null; st.popAt = null; st.popSide = null;
    $("#pop").hidden = true;
    document.body.classList.remove("docked");
    Growth3D.setCoverSelect(null);
    if (was) { placeNotes(); placeMap(); }
  }
  const esc = t => String(t).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const regionOf = name => { const ri = regionPaint().of[G().nodes.findIndex(n => n.name === name)]; return ri >= 0 ? ri : null; };
  // The corridor overlaps the eight regions: " Also on the corridor, R9: watch." for a manhole on it, else "".
  const overlayNote = name => { const oi = regionPaint().overlayOf[G().nodes.findIndex(n => n.name === name)];
    return oi >= 0 ? ` Also on the corridor, ${S().regions[oi].id}: ${D().triage[S().regions[oi].id]}.` : ""; };
  /* 19 Nov: the box no longer opens beside the manhole clicked, where it covered the sensors next to it (S1 and S3 sit
     close together, so S3 could not be clicked after S1). It docks in a corner of the screen that holds no sensor, chosen
     once per step, so clicking another sensor swaps its words in place and every sensor stays clickable; at phone width
     it is a sheet along the bottom and the map moves up to centre in the space left. */
  const phone = () => innerWidth <= 640;
  function openPop(name, html, sel, avoid) {
    st.pick = name;
    const box = $("#pop");
    box.innerHTML = '<button id="popX" type="button" aria-label="Close">\u00d7</button>' + html;
    $("#popX").onclick = () => { hidePop(); paintMap(); };
    Growth3D.setCoverSelect(sel ? name : null, []);
    const was = box.hidden;
    box.hidden = false;
    st.popAt = name;
    if (was || !st.popSide) st.popSide = dockSide(avoid || sensorNames());
    placeDock();
    if (was) { placeNotes(); placeMap(); }
  }
  function showPop(name) {
    const k = step().k, info = k ? D().popups[k].find(x => x.name === name) : null;
    if (info) {
      openPop(name, `<b>Level sensor ${info.n} of ${k}: ${esc(name)}</b><dl><dt>Listens to</dt><dd>${esc(info.listens)}</dd><dt>First reacts</dt><dd>${esc(info.reacts)}</dd><dt>Without it</dt><dd>${esc(info.lost)}</dd></dl>${info.note ? `<p>${esc(info.note)}</p>` : ""}`, true);
    } else {
      const ri = regionOf(name), r = ri == null ? null : S().regions[ri].id;
      openPop(name, `<b>${esc(name)}</b><p>${r ? `In ${r}: ${D().triage[r]}.` : "Not in a region."}${esc(overlayNote(name))} No sensor here.</p>`, false);
    }
  }
  // The dock's corners, below the step card: bottom left (above the map credit), bottom right, then the two sides.
  const DOCK_W = 330, DOCK_H = 300;
  function dockRect(side, h) {
    const m = 16, card = $("#card").getBoundingClientRect(), top = card.bottom + m;
    const x = side.endsWith("l") ? m : innerWidth - DOCK_W - m;
    const y = side.startsWith("b") ? innerHeight - h - (side === "bl" ? 34 : m) : top;
    return { x, y: Math.max(top, y), w: DOCK_W, h };
  }
  // The first corner that holds no sensor (its manhole or its label), checked at the tallest the box gets.
  function dockSide(avoid) {
    if (phone()) return "sheet";
    const pts = avoid.map(n => Growth3D.screenOf(n)).filter(Boolean);
    const labels = [...document.querySelectorAll(".labels .lbl.sensor")].map(e => e.getBoundingClientRect()).filter(r => r.width);
    const pad = 18;
    const hits = r => pts.filter(p => p.x > r.x - pad && p.x < r.x + r.w + pad && p.y > r.y - pad && p.y < r.y + r.h + pad).length +
      labels.filter(l => l.left < r.x + r.w && l.right > r.x && l.top < r.y + r.h && l.bottom > r.y).length;
    const sides = ["bl", "br", "ml", "mr"].map(s => ({ s, n: hits(dockRect(s, DOCK_H)) }));
    return (sides.find(x => !x.n) || sides.reduce((a, x) => (x.n < a.n ? x : a))).s;
  }
  function placeDock() {
    const box = $("#pop");
    document.body.classList.toggle("docked", !box.hidden && st.popSide === "sheet");
    box.dataset.dock = st.popSide || "";
    if (box.hidden || st.popSide === "sheet") { box.style.left = box.style.top = ""; return; }
    const r = dockRect(st.popSide, DOCK_H);
    box.style.left = r.x + "px";
    box.style.top = r.y + "px";     // a fixed top at the tallest the box gets, so another sensor's words swap in place
  }
  /* Labels that would sit on each other (two sensors on neighbouring manholes, a sensor under a region's label) are
     pushed apart, every frame, from where the map puts them: a region label gives way more than a sensor's, so each
     sensor's label stays near the top of its own stalk. Worked out afresh from the map's positions each time, so it never
     drifts, and applied with the CSS translate property, which the map code never sets. */
  function declutter() {
    const els = [...document.querySelectorAll(".labels .lbl.sensor, .labels .lbl.region")].filter(e => e.style.display !== "none" && e.isConnected);
    const B = els.map(el => {
      const r = el.getBoundingClientRect(), o = el._off || [0, 0];
      return { el, x: r.left - o[0], y: r.top - o[1], w: r.width, h: r.height, dx: 0, dy: 0, sensor: el.classList.contains("sensor") };
    }).filter(b => b.w > 0);
    const pad = 3;
    for (let it = 0; it < 24; it++) {
      let moved = false;
      for (let a = 0; a < B.length; a++) for (let b = a + 1; b < B.length; b++) {
        const A = B[a], C = B[b];
        const ax = A.x + A.dx, ay = A.y + A.dy, cx = C.x + C.dx, cy = C.y + C.dy;
        const ox = Math.min(ax + A.w, cx + C.w) - Math.max(ax, cx) + pad, oy = Math.min(ay + A.h, cy + C.h) - Math.max(ay, cy) + pad;
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const wa = A.sensor === C.sensor ? 0.5 : A.sensor ? 0.2 : 0.8;     // the share of the push that A takes
        // Along the smaller overlap; a dead heat goes by list order, so the answer is the same every frame.
        const ca = [ax + A.w / 2, ay + A.h / 2], cc = [cx + C.w / 2, cy + C.h / 2];
        if (ox < oy) { const s = ca[0] < cc[0] || ca[0] === cc[0] ? -1 : 1; A.dx += s * ox * wa; C.dx -= s * ox * (1 - wa); }
        else { const s = ca[1] < cc[1] || ca[1] === cc[1] ? -1 : 1; A.dy += s * oy * wa; C.dy -= s * oy * (1 - wa); }
      }
      if (!moved) break;
    }
    B.forEach(b => {
      const o = [Math.round(b.dx), Math.round(b.dy)], p = b.el._off || [0, 0];
      if (o[0] !== p[0] || o[1] !== p[1]) { b.el._off = o; b.el.style.translate = o[0] || o[1] ? `${o[0]}px ${o[1]}px` : ""; }
    });
  }
  function placePop() {
    declutter();
    if (st.popAt) placeDock();
    requestAnimationFrame(placePop);
  }

  /* ---------------------------------------------------------- start */
  // The building outlines Explore uses, loaded here so the page's own script list stays as it is.
  function loadBuildings() {
    if (window.Footprints) return Promise.resolve();
    const one = src => new Promise(ok => {
      const el = document.createElement("script");
      el.src = src; el.onload = el.onerror = ok;
      document.head.appendChild(el);
    });
    return one("data/osm_buildings.js?v=1").then(() => one("data/msft_buildings.js?v=1")).then(() => one("footprints.js?v=1"));
  }
  // Light or dark, as Explore: the button names the theme it switches to, and the choice is kept under Explore's key.
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    if (Growth3D.setTheme) Growth3D.setTheme(t);
    const say = "Switch to the " + (t === "light" ? "dark" : "light") + " theme";
    $("#themeBtn").title = say;
    $("#themeBtn").setAttribute("aria-label", say);
  }
  function setTheme(t, keep) {
    if (keep) { try { localStorage.setItem("sim4Theme", t); } catch (e) { /* not remembered */ } }
    applyTheme(t);
    if (document.body.dataset.ready) { hidePop(); paintMap(); }
  }
  function init() {
    loadBuildings().then(start);
  }
  function start() {
    Growth3D.build($("#stage"), nd => {
      if (!nd) { hidePop(); paintMap(); return; }
      showPop(nd.name);
    }, nd => { $("#stage").style.cursor = nd ? "pointer" : ""; }).then(() => {
      if (Growth3D.setHouseShapes) Growth3D.setHouseShapes(true);   // homes as building outlines, no dots
      if (Growth3D.setTopDefault) Growth3D.setTopDefault(true);       // 19 Nov: the map opens straight down, north up
      Growth3D.frame(null);
      applyTheme(theme());
      const want = (location.hash.match(/step=([0-9a-z]+)/) || [])[1];
      const at = D().steps.findIndex(s => s.id === want);
      if (/(^|[#&])notes=1/.test(location.hash)) st.notes = true;
      go(at < 0 ? 0 : at, false);
      if (/(^|[#&])figs=1/.test(location.hash) && $("#figs")) $("#figs").open = true;
      if (/(^|[#&])more=1/.test(location.hash) && $("#more")) $("#more").open = true;
      placePop();
      document.body.dataset.ready = "1";
    });
    $("#themeBtn").onclick = () => setTheme(theme() === "light" ? "dark" : "light", true);
    // Inside the landing page its header carries the switch and sends "sim4-set-theme"; on its own the page keeps its own.
    if (window.self !== window.top) $("#themeBtn").hidden = true;
    applyTheme(theme());
    addEventListener("message", e => {
      if (e.data && e.data.type === "sim4-set-theme" && (e.data.theme === "light" || e.data.theme === "dark")) setTheme(e.data.theme, true);
    });
    $("#next").onclick = () => go(st.i + 1);
    $("#back").onclick = () => go(st.i - 1);
    // Pressing the slider ends the sweep even where the value does not change, because then no input event fires.
    $("#homes").onpointerdown = stopSweep;
    $("#homes").onkeydown = stopSweep;
    $("#homes").oninput = e => { stopSweep(); hidePop(); st.level = +e.target.value; renderLevel(); paintMap(); };
    $("#btnRegions").onclick = () => { hidePop(); st.regions = !st.regions; paintMap(); };
    $("#btnNotes").onclick = () => setNotes(!st.notes);
    $("#btnWhy").onclick = () => setWhy($("#why").hidden);
    // A click on a sensor's pin (S1, S2, ...) opens that sensor, wherever its manhole sits under the pin.
    $("#stage").addEventListener("click", e => {
      const l = e.target.closest && e.target.closest(".lbl.sensor");
      if (!l) return;
      let n = sensorNames()[+l.textContent.replace(/\D/g, "") - 1];
      // 19 Nov: seen from straight above, one sensor's pin can lie over another's manhole (S3's over S1's at 5b). A click
      // within 8 px of a sensor's own manhole, and nearer it than the middle of the pin, means that sensor; a tap on the
      // middle of a pin is that pin's (on a phone S3's pin sits a few px from S1's manhole).
      const r = l.getBoundingClientRect();
      let best = Math.min(8, Math.hypot(r.left + r.width / 2 - e.clientX, r.top + r.height / 2 - e.clientY));
      for (const m of sensorNames()) { const q = Growth3D.screenOf(m); const d = q ? Math.hypot(q.x - e.clientX, q.y - e.clientY) : 1e9; if (d < best) { best = d; n = m; } }
      if (n) { stopSweep(); showPop(n); }
    });
    if (window.ResizeObserver) new ResizeObserver(placeMap).observe($("#card"));
    // The fold's room changes when what sits above it does (the legend, a wrapped line, the 6 fold), not only the card.
    if (window.ResizeObserver) { const ro = new ResizeObserver(() => placeNotes()); ["#cardHead", "#bodyRow", "#controls", "#notesBar"].forEach(q => ro.observe($(q))); }
    addEventListener("keydown", e => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      // Inside the fold the arrow keys scroll its tables, so they do not change step there.
      if (e.target.closest && e.target.closest("#notes") && e.key !== "Escape") return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(st.i + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(st.i - 1);
      else if (e.key === "Escape") { hidePop(); paintMap(); }
    });
    addEventListener("resize", () => { Growth3D.resize($("#stage")); if (st.popAt) { st.popSide = dockSide(sensorNames()); placeDock(); } placeNotes(); placeMap(); });
    if (window.MapHelp) MapHelp.attach($("#btnMapHelp"));     // 19 Nov: how to turn, move and zoom the map
  }
  return { init, state: st, step, levels: LEVELS, sensors: sensorNames, growthState, regionPaint, regionTints, actionLabels, regionOf, overlayNote,
           openPop, hidePop, esc, setTheme, ACTION_COL, LEGEND, REGION_COLS, setNotes, setWhy, declutter, placeNotes };
})();
