/* The story's part 2 screens: Simulation 2.5, one view per step of osp_story_growth.js.
   Same contract as part 1's views (osp_story_views.js): enter(map, panel) sets how the map
   draws and fills the panel, leave() undoes what enter attached, hud(hit) adds rows to
   the hover readout.

   Every figure comes from the Sim 2.5 payload as the builder published it, from
   simulation25/placement.js (the Sim 2.5 page's own scoring), or from the facts in
   osp_story_growth.js. The last step also reads part 1's facts (osp_story.js on the
   sandbox's data) so the two parts' results can be set side by side.

   Chambers are Sim 2.5's manholes, indexed as GROWTH_RUNS indexes them; the map draws
   graph nodes. chamberOf[node] and nodeOfChamber[chamber] convert.

   UMD for the dependency-order check in tools/test_sandbox.js; it needs a DOM to run. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OSPStoryGrowthViews = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

const COL = {
  accent: "#38bdf8", good: "#34d399", warn: "#fbbf24", bad: "#f87171",
  pipe: "#5b7096", dim: "#2c3c5a", hole: "#a9b8d4", slot: "#3b4a68", ink: "#e7edf7", home: "#7d8db0",
};
const CASE_COL = ["#fbbf24", "#38bdf8", "#f87171", "#a78bfa", "#34d399"];
const hex = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
function along(stops, t) {
  t = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], t));
  let k = 1;
  while (k < stops.length - 1 && t > stops[k][0]) k++;
  const [t0, a] = stops[k - 1], [t1, b] = stops[k];
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0, A = hex(a), B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * f)).join(",")})`;
}
const gradient = stops => `linear-gradient(90deg,${stops.map(s => `${s[1]} ${s[0] * 100}%`).join(",")})`;
const DEPTH_STOPS = [[0, "#33507f"], [0.3, "#22d3ee"], [0.75, "#fbbf24"], [1, "#fb923c"]];
const LOAD_STOPS = [[0, "#33507f"], [0.4, "#22d3ee"], [1, "#e0f2fe"]];
const HEAT_STOPS = [[0, "#2c3c5a"], [0.3, "#22d3ee"], [1, "#fbbf24"]];
const n = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function make(ctx) {
  const { G, g, R, I, F, C, PL, ST, chamberOf, nodeOfChamber, map, esc, row, $ } = ctx;
  const pc = ST.pc;
  const nCh = R.chambers.length;
  const name = c => R.chambers[c];

  /* ---------------------------------------------------------------- shared */
  const stat = (k, v) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`;
  const sw = (c, dot) => `<span class="sw${dot ? " dot" : ""}" style="background:${c}"></span>`;
  const legendRow = (c, label, count, dot) =>
    `${sw(c, dot)}<span>${label}</span><span class="n">${count == null ? "" : n(count)}</span>`;
  const on = (el, ev, fn) => el.addEventListener(ev, fn);
  const seg = (id, items, cur) => `<div class="seg" id="${id}">` +
    items.map(([v, label]) => `<button data-v="${v}" class="${String(v) === String(cur) ? "on" : ""}">${esc(label)}</button>`).join("") + `</div>`;
  const onSeg = (id, fn) => on($(id), "click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    $(id).querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    fn(b.dataset.v);
  });
  const CASES = R.cases.map((c, k) => [k, c.label]);
  const RULES = R.rules.map(r => [r.id, r.label]);
  const OBJS = [["worst", "best worst case"], ["mean", "best average"]];
  const xy = (x, y) => map.toScreen(x / 10, y / 10);   // payload decimetres to map metres
  const chamberAt = h => (h && h.kind === "node" ? chamberOf[h.i] : -1);

  /* Map style for "chambers by a value": every manhole a dot coloured by fn(chamber),
     or left out when fn returns null. */
  const byChamber = fn => i => { const c = chamberOf[i]; return c >= 0 ? fn(c) : null; };
  const quiet = { edgeStyle: () => ({ color: COL.dim }) };

  function homes(ctx2) {
    ctx2.fillStyle = "rgba(125,141,176,.55)";
    for (let h = 0; h < g.hx.length; h++) {
      const [x, y] = xy(g.hx[h], g.hy[h]);
      ctx2.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
    }
  }
  function pumps(ctx2, strong) {
    for (const p of g.pumps) {
      ctx2.strokeStyle = strong ? COL.warn : "rgba(251,191,36,.7)";
      ctx2.setLineDash([4, 3]); ctx2.lineWidth = strong ? 2.2 : 1.4;
      ctx2.beginPath();
      p.px.forEach((x, k) => { const q = xy(x, p.py[k]); if (k) ctx2.lineTo(q[0], q[1]); else ctx2.moveTo(q[0], q[1]); });
      ctx2.stroke(); ctx2.setLineDash([]);
      const [x, y] = xy(p.x, p.y), r = strong ? 7 : 5;
      ctx2.fillStyle = p.modelled ? COL.warn : COL.slot;
      ctx2.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  }
  function entries(ctx2, strong) {
    ctx2.fillStyle = strong ? COL.accent : "rgba(56,189,248,.75)";
    for (const e of g.context.entries) {
      if (!e.into) continue;
      const [x, y] = xy(e.x, e.y), r = strong ? 7 : 5;
      ctx2.beginPath(); ctx2.moveTo(x, y + r); ctx2.lineTo(x - r, y - r); ctx2.lineTo(x + r, y - r); ctx2.closePath(); ctx2.fill();
    }
  }
  /* Numbered sensor markers, drawn last so they sit on everything. */
  function markers(ctx2, list) {
    ctx2.font = "bold 10px ui-sans-serif,system-ui,Segoe UI,Arial";
    ctx2.textAlign = "center"; ctx2.textBaseline = "middle";
    for (const m of list) {
      const v = nodeOfChamber[m.c];
      if (v < 0) continue;
      const [x, y] = map.toScreen(G.x[v], G.y[v]);
      ctx2.beginPath(); ctx2.arc(x, y, m.r || 8, 0, 2 * Math.PI);
      ctx2.fillStyle = m.color; ctx2.fill();
      ctx2.strokeStyle = m.stroke || "#0b1220"; ctx2.lineWidth = m.stroke ? 2.4 : 1.5; ctx2.stroke();
      if (m.label != null) { ctx2.fillStyle = "#04111d"; ctx2.fillText(String(m.label), x, y + 0.5); }
    }
  }

  /* --------------------------------------------------------------- 1 area */
  const area = {
    enter(map, panel) {
      const f = F.area();
      map.set({
        nodeStyle: i => g.nodes[i].kind === "outfall" ? { color: COL.warn, r: 4, stroke: COL.ink }
          : G.mh[i] ? { color: COL.hole } : null,
        overlay: c2 => { homes(c2); pumps(c2); entries(c2); },
      });
      panel.innerHTML =
        `<h2>The model area</h2>` +
        stat("Pipes", n(f.pipes)) + stat("Manholes", f.chambers) + stat("Length", f.km.toFixed(1) + " km") +
        stat("Homes connected", n(f.homes)) + stat("Dwellings", n(f.dwellings)) +
        stat("Pump stations modelled", `${f.pumps} of ${f.pumpsAll}`) + stat("Outside pipes joining", f.entries) +
        `<p class="hint">These are the council's pipes that drain to the end of the council data, the ` +
        `same published network part 1 reads, cut to what one outlet collects and joined to the homes ` +
        `on it, which part 1 does not use.</p>` +
        `<div class="sec"><h2>Reading the map</h2><div class="legend">` +
        legendRow(COL.home, "a home, from the published inspection points", f.homes, true) +
        legendRow(COL.hole, "manhole", f.chambers, true) +
        legendRow(COL.warn, "pump station and its rising main (dashed)", f.pumpsAll) +
        legendRow(COL.accent, "where an outside pipe joins", f.entries) +
        `</div><p class="hint">Hover a pipe for its size, material, age and the flow it carries full.</p></div>`;
    },
    leave() {},
  };

  /* --------------------------------------------------------------- 2 load */
  const load = (() => {
    let max = 1;
    for (const v of g.nodes) max = Math.max(max, v.dw || 0);
    return {
      enter(map, panel) {
        const f = F.load();
        map.set({
          edgeStyle: () => ({ color: COL.dim }),
          nodeStyle: i => {
            const d = g.nodes[i].dw || 0;
            return d ? { color: along(LOAD_STOPS, Math.sqrt(d / max)), r: 1.6 + 5.5 * Math.sqrt(d / max) } : null;
          },
        });
        panel.innerHTML =
          `<h2>A new dwelling</h2>` +
          stat("Sewage per day", Math.round(f.newLpd) + " L") +
          stat("At the peak hour", f.newLps.toFixed(4) + " L/s") +
          stat("Peak factor", "&times;" + f.peak) +
          `<p class="hint">2.3 people at 200 litres each, doubled for the peak hour (Sim 2.5 register G4, ` +
          `P01b, P02). New dwellings add sewage only; no extra groundwater (P03).</p>` +
          `<div class="sec"><h2>What SWMM is given, by case</h2>` +
          f.cases.map((c, k) => stat(esc(c), Math.round(f.caseLoad[k]) + " L/s")).join("") +
          `<p class="hint">Homes, outside inflow and groundwater together, at the peak hour.</p></div>` +
          `<div class="sec"><h2>Growth sizes tested</h2><p class="hint">${f.sizes.join(", ")} dwellings at one ` +
          `manhole; ${f.sizes[f.sizes.length - 1]} only as a stress case (P05).</p></div>` +
          `<div class="sec"><h2>Reading the map</h2><div class="legend">` +
          `<span class="sw" style="width:40px;background:${gradient(LOAD_STOPS)}"></span><span>dwellings draining in, up to ${max}</span><span></span>` +
          `</div></div>`;
      },
      leave() {},
      hud(h) { return ""; },
    };
  })();

  /* -------------------------------------------------------------- 3 cases */
  const cases = (() => {
    let k = 1, over = new Set(), sur = new Set(), spl = new Set();
    function apply() {
      over = new Set(R.baseOver[k]); sur = new Set(R.baseSurcharged[k]); spl = new Set(R.baseSpilled[k]);
      $("cs-list").querySelectorAll("button").forEach(b => b.classList.toggle("on", +b.dataset.k === k));
      $("cs-note").textContent = R.cases[k].note || "";
      map.redraw();
    }
    return {
      enter(map, panel) {
        const c = F.cases();
        panel.innerHTML =
          `<h2>Before any growth</h2><div class="rows" id="cs-list">` +
          c.map((x, i) => `<button data-k="${i}">${sw(CASE_COL[i])}<span class="lab">${esc(x.label)}</span>` +
            `<span class="num" title="over the alarm">${x.over}</span><span class="num" title="surcharged">${x.surcharged}</span>` +
            `<span class="num" title="spilling">${x.spilled}</span></button>`).join("") +
          `</div><p class="hint">Columns: manholes over the 150 mm alarm, surcharged, spilling. Click a case.</p>` +
          `<p class="hint" id="cs-note"></p>` +
          `<div class="sec"><h2>Reading the map</h2><div class="legend">` +
          `<span class="sw" style="width:40px;background:${gradient(DEPTH_STOPS)}"></span><span>depth before growth</span><span class="n">0 to 300 mm</span>` +
          legendRow(COL.warn, "over the 150 mm alarm (ringed)", null, true) +
          legendRow(COL.bad, "surcharged: the pipe is full", null, true) +
          `</div><p class="hint">Hover a manhole for its depth in this case.</p></div>`;
        on($("cs-list"), "click", e => { const b = e.target.closest("button"); if (b) { k = +b.dataset.k; apply(); } });
        map.set({
          edgeStyle: () => ({ color: COL.dim }),
          nodeStyle: byChamber(c2 => {
            const d = R.baseDepthMm[k][c2];
            if (sur.has(c2)) return { color: COL.bad, r: spl.has(c2) ? 5.5 : 4, stroke: spl.has(c2) ? COL.ink : null };
            return { color: along(DEPTH_STOPS, d / 300), r: 2.6, stroke: over.has(c2) ? COL.warn : null };
          }),
        });
        apply();
      },
      leave() {},
      hud(h) {
        const c2 = chamberAt(h);
        if (c2 < 0) return "";
        return row("depth", R.baseDepthMm[k][c2] + " mm before growth") +
          (sur.has(c2) ? row("state", '<span style="color:var(--bad)">surcharged</span>')
            : over.has(c2) ? row("state", '<span style="color:var(--warn)">over the alarm</span>') : "");
      },
    };
  })();

  /* ------------------------------------------------------------- 4 growth */
  const growth = (() => {
    const ex = ST.EXAMPLE;
    let k = ex.case, add = ex.add, rule = "r25", site = -1, off = [];
    let rows = null, tip = new Set(), seenAt = null;
    const cellOf = () => R.cells.find(c => c.case === k && c.add === add && c.rule === rule);
    function pickDefault() {
      // Open on the site whose growth the most manholes notice, under the example's own setting.
      const c = cellOf();
      let best = 0;
      c.rows.forEach((r, i) => { if (r.tip.length > c.rows[best].tip.length) best = i; });
      site = c.rows[best].site;
    }
    function apply() {
      const c = cellOf();
      rows = c ? c.rows : [];
      seenAt = new Uint8Array(nCh);
      let seen = 0;
      for (const r of rows) if (r.tip.length) { seenAt[r.site] = 1; seen++; }
      const r = rows.find(x => x.site === site);
      tip = new Set(r ? r.tip : []);
      const sp = R.spill && R.spill[k] && R.spill[k][add] ? (R.spill[k][add].find(([s]) => s === site) || [0, []])[1] : [];
      $("gr-big").innerHTML = `${tip.size} <small>manhole${tip.size === 1 ? "" : "s"} notice growth at ${esc(name(site))}</small>`;
      $("gr-list").innerHTML = tip.size
        ? [...tip].slice(0, 14).map(name).map(esc).join(", ") + (tip.size > 14 ? `, and ${tip.size - 14} more` : "")
        : "None, under this rule.";
      $("gr-all").innerHTML =
        stat("Sites whose growth some manhole notices", `${seen} of ${nCh}`) +
        (sp.length ? stat("Manholes it newly makes spill", sp.length) : "");
      map.redraw();
    }
    return {
      enter(map, panel) {
        if (site < 0) pickDefault();
        panel.innerHTML =
          `<h2>The scenario</h2>` +
          `<label class="range">Case</label>` + seg("gr-k", CASES, k) +
          `<label class="range">New dwellings at one manhole</label>` + seg("gr-a", R.growthLevels.map(v => [v, String(v)]), add) +
          `<label class="range">Noticed when</label>` + seg("gr-r", RULES, rule) +
          `<div class="big sec" id="gr-big"></div><p class="hint" id="gr-list"></p><div id="gr-all"></div>` +
          `<p class="hint">Click any manhole to move the growth there. A rise rule compares each manhole with ` +
          `its own level before the growth; the alarm counts only a manhole newly passing 150 mm.</p>` +
          `<div class="sec"><h2>Reading the map</h2><div class="legend">` +
          legendRow(COL.warn, "where the growth connects", null, true) +
          legendRow(COL.accent, "notices it", null, true) +
          legendRow(COL.hole, "growth here would be noticed somewhere", null, true) +
          legendRow(COL.slot, "growth here would go unnoticed", null, true) + `</div></div>`;
        onSeg("gr-k", v => { k = +v; apply(); });
        onSeg("gr-a", v => { add = +v; apply(); });
        onSeg("gr-r", v => { rule = v; apply(); });
        map.set({
          edgeStyle: () => ({ color: COL.dim }),
          nodeStyle: byChamber(c2 => c2 === site ? { color: COL.warn, r: 7, stroke: COL.ink }
            : tip.has(c2) ? { color: COL.accent, r: 4 }
            : { color: seenAt && seenAt[c2] ? COL.hole : COL.slot, r: 2.2 }),
        });
        off.push(map.on("click", h => { const c2 = chamberAt(h); if (c2 >= 0) { site = c2; apply(); } }));
        apply();
      },
      leave() { off.forEach(fn => fn()); off = []; },
      hud(h) {
        const c2 = chamberAt(h);
        if (c2 < 0 || !rows) return "";
        const r = rows.find(x => x.site === c2);
        return row("growth here", r && r.tip.length ? `noticed by ${r.tip.length}` : "noticed by none") +
          (tip.has(c2) ? row("", '<span style="color:var(--accent)">notices the current growth</span>') : "");
      },
    };
  })();

  /* ------------------------------------------------------------- 5 robust */
  const robust = (() => {
    let rule = "alarm";
    function apply() {
      const d = F.detect().byRule[rule];
      $("rb-list").innerHTML = d.map((c, k) =>
        `<div class="stat"><span>${sw(CASE_COL[k], true)} ${esc(R.cases[k].label)}<br><span class="hint">` +
        `best: ${c.bestSees ? esc(name(c.best)) : "none"}</span></span>` +
        `<b>${c.bestShare == null ? "&ndash;" : pc(c.bestShare)} <span class="hint">/</span> ` +
        `${c.sharedShare == null ? "&ndash;" : pc(c.sharedShare)}</b></div>`).join("");
      $("rb-shared").textContent = name(d[0].shared);
      $("rb-big").innerHTML = `${F.detect().distinct(rule)} <small>different best manholes in ${d.length} cases</small>`;
      $("rb-worst").textContent = pc(F.detect().sharedWorst(rule));
      const marks = [];
      d.forEach((c, k) => { if (c.bestSees) marks.push({ c: c.best, color: CASE_COL[k], r: 7, label: k + 1 }); });
      marks.push({ c: d[0].shared, color: "rgba(0,0,0,0)", r: 11, stroke: COL.ink });
      map.set({ overlay: c2 => markers(c2, marks) });
    }
    return {
      enter(map, panel) {
        panel.innerHTML =
          `<h2>Noticed when</h2>` + seg("rb-r", RULES, rule) +
          `<div class="big sec" id="rb-big"></div>` +
          `<p class="hint">Each row: the share of that case's noticeable growth its own best manhole sees, ` +
          `then the share the one shared choice (<b id="rb-shared"></b>, ringed white) sees. Its worst ` +
          `case: <b id="rb-worst"></b>.</p><div id="rb-list"></div>` +
          `<p class="hint">Under the alarm the best manhole is whichever sits just below 150 mm, and that ` +
          `moves with the weather. A rise rule does not depend on where the alarm happens to sit.</p>`;
        onSeg("rb-r", v => { rule = v; apply(); });
        map.set(Object.assign({}, quiet, { nodeStyle: i => (G.mh[i] ? { color: COL.slot, r: 1.8 } : null) }));
        apply();
      },
      leave() {},
    };
  })();

  /* ------------------------------------------------------------ 6 sensors */
  const sensors = (() => {
    let rule = "r25", obj = "worst", k = 3, ro = null;
    const pub = () => R.sensors[rule][obj];
    function chart() {
      const cv = $("sn-chart");
      if (!cv) return;
      const p = pub(), K = R.maxSensors, dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth, H = cv.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const c = cv.getContext("2d");
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const pad = { l: 34, r: 8, t: 8, b: 22 };
      const X = i => pad.l + (W - pad.l - pad.r) * i / K, Y = v => H - pad.b - (H - pad.t - pad.b) * v;
      c.strokeStyle = "#22314d"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(pad.l, pad.t); c.lineTo(pad.l, H - pad.b); c.lineTo(W - pad.r, H - pad.b); c.stroke();
      c.fillStyle = "#6f81a3"; c.font = "11px ui-sans-serif,system-ui,Segoe UI,Arial";
      c.textAlign = "right"; c.fillText("100%", pad.l - 4, pad.t + 9); c.fillText("0", pad.l - 4, H - pad.b);
      c.textAlign = "center"; c.fillText("sensors", (pad.l + W - pad.r) / 2, H - 6);
      c.textAlign = "right"; c.fillText(String(K), W - pad.r, H - 6);
      [["mean", COL.hole], ["worst", COL.accent]].forEach(([key, col]) => {
        c.strokeStyle = col; c.lineWidth = 2;
        c.beginPath(); c.moveTo(X(0), Y(0));
        p[key].forEach((v, i) => c.lineTo(X(i + 1), Y(v)));
        c.stroke();
      });
      c.fillStyle = COL.warn;
      [p.worst[k - 1], p.mean[k - 1]].forEach(v => { c.beginPath(); c.arc(X(k), Y(v), 4, 0, 2 * Math.PI); c.fill(); });
    }
    function apply() {
      const p = pub(), heat = R.heat[rule][obj];
      let hmax = 1e-9;
      for (const v of heat) hmax = Math.max(hmax, v);
      $("sn-k").textContent = k;
      $("sn-w").textContent = pc(p.worst[k - 1]);
      $("sn-m").textContent = pc(p.mean[k - 1]);
      $("sn-list").innerHTML = p.order.slice(0, k).map((c, i) => `${i + 1}. ${esc(name(c))}`).join("<br>");
      map.set({
        edgeStyle: () => ({ color: COL.dim }),
        nodeStyle: byChamber(c2 => ({ color: along(HEAT_STOPS, heat[c2] / hmax), r: 2.4 })),
        overlay: c2 => markers(c2, p.order.slice(0, k).map((c, i) => ({ c, color: COL.warn, label: i + 1 }))),
      });
      chart();
    }
    return {
      enter(map, panel) {
        panel.innerHTML =
          `<h2>Sim 2.5's greedy</h2>` +
          `<label class="range">Noticed when</label>` + seg("sn-r", RULES, rule) +
          `<label class="range">Chosen for the</label>` + seg("sn-o", OBJS, obj) +
          `<label class="range" for="sn-s">Sensors <b id="sn-k"></b></label>` +
          `<input type="range" id="sn-s" min="1" max="${R.maxSensors}" step="1" value="${k}">` +
          `<div class="sec">` + stat("Growth caught, worst case", `<span id="sn-w"></span>`) +
          stat("Growth caught, average of the cases", `<span id="sn-m"></span>`) + `</div>` +
          `<canvas class="chart" id="sn-chart"></canvas>` +
          `<div class="legend">${legendRow(COL.accent, "worst case", null)}${legendRow(COL.hole, "average", null)}</div>` +
          `<p class="hint" id="sn-list"></p>` +
          `<div class="sec"><h2>Reading the map</h2><div class="legend">` +
          `<span class="sw" style="width:40px;background:${gradient(HEAT_STOPS)}"></span><span>growth a manhole would catch on its own</span><span></span>` +
          legendRow(COL.warn, "chosen sensor, in the order chosen", null, true) + `</div></div>`;
        onSeg("sn-r", v => { rule = v; apply(); });
        onSeg("sn-o", v => { obj = v; apply(); });
        on($("sn-s"), "input", e => { k = +e.target.value; apply(); });
        if (typeof ResizeObserver === "function") { ro = new ResizeObserver(chart); ro.observe($("sn-chart")); }
        apply();
      },
      leave() { if (ro) ro.disconnect(); ro = null; },
    };
  })();

  /* ------------------------------------------------------------ 7 caveats */
  const caveats = (() => {
    let sel = -1;
    const SHOW = {
      none: () => ({}),
      pumps: () => Object.assign({}, quiet, { overlay: c2 => pumps(c2, true) }),
      entries: () => Object.assign({}, quiet, { overlay: c2 => entries(c2, true) }),
    };
    function pick(k) {
      sel = sel === k ? -1 : k;
      $("cv-list").querySelectorAll(".card").forEach((el, i) => el.classList.toggle("on", i === sel));
      map.reset();
      if (sel >= 0) map.set(SHOW[ST.CAVEATS[sel].show]());
    }
    return {
      enter(map, panel) {
        sel = -1;
        panel.innerHTML =
          `<h2>What part 2 rests on</h2><div id="cv-list">` +
          ST.CAVEATS.map((c, i) => {
            let text;
            try { text = c.text(F, I); } catch (err) { console.error(err); text = "Could not be computed from the loaded data."; }
            return `<button class="card" data-k="${i}"><h3>${esc(c.title)}</h3><p>${esc(text)}</p>` +
              `<span class="src">${esc(c.src)}${c.show !== "none" ? " &middot; shown on the map" : ""}</span></button>`;
          }).join("") +
          `</div><p class="hint">The full register is the Assumptions tab of ` +
          `<a href="index.html#sim25" target="_top" style="color:var(--accent)">Simulation 2.5</a>.</p>`;
        on($("cv-list"), "click", e => { const b = e.target.closest(".card"); if (b) pick(+b.dataset.k); });
      },
      leave() {},
    };
  })();

  /* ------------------------------------------------------------ 8 compare */
  const compare = (() => {
    const base = F.graph();
    let { rule, obj, k } = ST.COMPARE, sel = "celf", res = null;
    /* Part 1's own headline results, from its facts on the sandbox's data, when the page
       has loaded them. */
    function partOne() {
      const S1 = window.OSPStory, D = window.OSP_DATA;
      if (!S1 || !D) return null;
      const raw = D.regions[Object.keys(D.regions)[0]];
      const F1 = S1.facts({ raw, C, K: null, codes: D.codes || {} });
      return { net: F1.network(), pl: F1.placement(), cmp: F1.compare(), methods: S1.METHODS };
    }
    let one;
    function sideBySide() {
      if (one === undefined) { try { one = partOne(); } catch (err) { console.error(err); one = null; } }
      const a = F.area(), c = res, best = c.rows.filter(r => !["swmm", "celf", "random"].includes(r.id))
        .reduce((x, y) => (y[obj] > x[obj] ? y : x));
      const cell = (x, y) => `<tr><th>${x[0]}</th><td>${x[1]}</td><td>${y}</td></tr>`;
      let p1 = { net: "&ndash;", greedy: "&ndash;", rule: "&ndash;", random: "&ndash;" };
      if (one) {
        const w = one.cmp.watched, lab = one.cmp.bestRule.label;
        p1 = {
          net: `${n(one.net.nodes)} nodes, ${one.net.manholes} manholes`,
          greedy: `${one.pl.budget} sensors watch ${w.greedy} nodes`,
          rule: `${esc(lab)}: ${w[one.cmp.bestRule.id]}`,
          random: `${w.random}`,
        };
      }
      $("cm-side").innerHTML =
        `<table class="side"><thead><tr><th></th><th>Part 1: blockage</th><th>Part 2: growth</th></tr></thead><tbody>` +
        cell(["Asks", "where would a blockage back water up to a sensor?"], "where would new homes raise a sensor's level?") +
        cell(["Model", "level flood-fill, no flow"], "EPA SWMM at the peak, five cases") +
        cell(["Network", p1.net], `${n(G.n)} nodes, ${a.chambers} manholes`) +
        cell(["Greedy", p1.greedy], `${k} sensors catch ${pc(c.by.swmm[obj])} of growth (${obj === "worst" ? "worst case" : "average"})`) +
        cell(["Best rule of thumb", p1.rule], `${esc(best.label.toLowerCase())}: ${pc(best[obj])}`) +
        cell(["Best of 20 random", p1.random], pc(c.by.random[obj])) +
        `</tbody></table>`;
    }
    function apply() {
      res = ST.compareAt({ R, C, PL }, base, rule, obj, k);
      const top = Math.max(1e-9, ...res.rows.map(r => r[obj]));
      const topB = Math.max(1, ...res.rows.map(r => r.blockage));
      $("cm-k").textContent = k;
      $("cm-list").innerHTML =
        `<div class="stat"><span class="hint">method</span><span class="hint">growth caught &middot; blockage nodes</span></div>` +
        res.rows.map(r =>
          `<button data-id="${r.id}" class="${r.id === sel ? "on" : ""}" title="${esc(r.label)}">` +
          `<span class="lab">${esc(r.label.replace(/ \(.*\)$/, ""))}</span>` +
          `<span class="bar"><i style="width:${(100 * r[obj] / top).toFixed(1)}%;${r.id === "swmm" ? "" : "background:#7d93bb"}"></i></span>` +
          `<span class="num">${pc(r[obj])}</span>` +
          `<span class="bar"><i style="width:${(100 * r.blockage / topB).toFixed(1)}%;background:${r.id === "celf" ? COL.good : "#7d93bb"}"></i></span>` +
          `<span class="num">${r.blockage}</span></button>`).join("");
      const s = res.by.swmm.set, o = res.by[sel].set, both = new Set(s.filter(c => o.includes(c)));
      $("cm-ov").textContent = sel === "swmm" ? "" :
        `${both.size} of the ${k} manholes are the same in both sets.`;
      map.set({
        edgeStyle: () => ({ color: COL.dim }),
        nodeStyle: i => (G.mh[i] ? { color: COL.slot, r: 1.8 } : null),
        overlay: c2 => markers(c2, [
          ...o.filter(c => !both.has(c)).map(c => ({ c, color: COL.good, r: 7 })),
          ...s.filter(c => !both.has(c)).map(c => ({ c, color: COL.warn, r: 7 })),
          ...[...both].map(c => ({ c, color: COL.ink, r: 8 })),
        ]),
      });
      sideBySide();
    }
    return {
      enter(map, panel) {
        panel.innerHTML =
          `<h2>The two parts side by side</h2><div id="cm-side"></div>` +
          `<p class="hint">Each part's own result on its own question. Part 1 counts nodes a blockage ` +
          `would be seen from; part 2 counts the share of growth scenarios noticed. They are not on one scale; the rows below are.</p>` +
          `<div class="sec"><h2>On part 2's network, scored both ways</h2>` +
          `<label class="range">Noticed when</label>` + seg("cm-r", RULES, rule) +
          `<label class="range">Chosen for the</label>` + seg("cm-o", OBJS, obj) +
          `<label class="range" for="cm-s">Sensors <b id="cm-k"></b></label>` +
          `<input type="range" id="cm-s" min="1" max="${R.maxSensors}" step="1" value="${k}">` +
          `<div class="rows" id="cm-list"></div>` +
          `<p class="hint">Growth caught: the share SWMM says the set notices (the Sim 2.5 page's score). ` +
          `Blockage nodes: how many nodes part 1's flood-fill says the same set would see a blockage from, ` +
          `out of ${base.G.obs.universeSize} any sensor could. Click a method to put it on the map.</p>` +
          `<p class="hint" id="cm-ov"></p></div>` +
          `<div class="sec"><h2>Reading the map</h2><div class="legend">` +
          legendRow(COL.warn, "Sim 2.5's growth greedy", null, true) +
          legendRow(COL.good, "the method selected (part 1's blockage greedy to start)", null, true) +
          legendRow(COL.ink, "chosen by both", null, true) + `</div></div>`;
        onSeg("cm-r", v => { rule = v; apply(); });
        onSeg("cm-o", v => { obj = v; apply(); });
        on($("cm-s"), "input", e => { k = +e.target.value; apply(); });
        on($("cm-list"), "click", e => { const b = e.target.closest("button"); if (b) { sel = b.dataset.id; apply(); } });
        apply();
      },
      leave() {},
    };
  })();

  return { views: { area, load, cases, growth, robust, sensors, caveats, compare } };
}

return { make };
});
