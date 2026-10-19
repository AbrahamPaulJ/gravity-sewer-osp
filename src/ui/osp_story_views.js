/* The story's eight screens. Each is an entry with enter(map, panel, F) and leave(map):
   enter sets how the map draws and fills the panel, leave undoes whatever enter
   attached (map listeners, timers). The shell in osp_story_ui.js owns routing and the
   header, and resets the map's styles between steps.

   Nothing here computes a model of its own. Every figure on screen comes from
   osp_core.js and osp_capacity.js, called as the sandbox calls them, or from the facts
   in osp_story.js, so the panels and the takeaways cannot disagree.

   Optional per view: hud(hit) returns extra rows for the hover readout.

   UMD for the dependency-order check in tools/test_sandbox.js; it needs a DOM to run. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OSPStoryViews = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

/* The page's palette, as story.html declares it. Canvas cannot read a CSS variable at
   draw time without a style lookup per call, so the views keep their own copy. */
const COL = {
  accent: "#38bdf8", good: "#34d399", warn: "#fbbf24", bad: "#f87171",
  pipe: "#5b7096", dim: "#2c3c5a", hole: "#a9b8d4", slot: "#3b4a68", ink: "#e7edf7",
};
/* Networks other than the largest, in an order that keeps neighbours apart. */
const COMP_COL = ["#7d93bb", "#f59e0b", "#a78bfa", "#34d399", "#f472b6", "#22d3ee", "#facc15",
  "#fb7185", "#4ade80", "#c084fc", "#60a5fa", "#fdba74", "#86efac", "#f9a8d4"];
const MAT_COL = { VC: "#d6a46c", PVCU: "#60a5fa", RC: "#cbd5e1" };
const MAT_LABEL = { VC: "vitrified clay", PVCU: "uPVC", RC: "reinforced concrete" };
const JOINT_COL = { RRJ: "#a78bfa", SCJ: "#f59e0b", PLAST: "#22d3ee", BIT: "#f472b6" };
const JOINT_LABEL = { RRJ: "rubber ring", SCJ: "solvent cement", PLAST: "plastic", BIT: "bitumen" };

const hex = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
/* Colour at t along piecewise-linear stops [[t, "#rrggbb"], ...]. */
function along(stops, t) {
  t = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], t));
  let k = 1;
  while (k < stops.length - 1 && t > stops[k][0]) k++;
  const [t0, a] = stops[k - 1], [t1, b] = stops[k];
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0, A = hex(a), B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * f)).join(",")})`;
}
const gradient = stops => `linear-gradient(90deg,${stops.map(s => `${s[1]} ${s[0] * 100}%`).join(",")})`;
const USE_STOPS = [[0, "#33507f"], [0.5, "#22d3ee"], [0.9, "#fbbf24"], [1, "#fb923c"]];
const COUNT_STOPS = [[0, "#33507f"], [0.35, "#22d3ee"], [1, "#e0f2fe"]];
const YEAR_STOPS = [[0, "#fb923c"], [0.5, "#fbbf24"], [1, "#60a5fa"]];

const n = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0) + "%";

function make(ctx) {
  const { G, RAW, F, C, K, P, ST, CODES, VALID, map, esc, row, $ } = ctx;
  const m = G.edges.length;

  /* --------------------------------------------------------------- shared */
  const stat = (k, v) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`;
  const sw = (c, dot) => `<span class="sw${dot ? " dot" : ""}" style="background:${c}"></span>`;
  const legendRow = (c, label, count, dot) =>
    `${sw(c, dot)}<span>${label}</span><span class="n">${count == null ? "" : n(count)}</span>`;
  const on = (el, ev, fn) => el.addEventListener(ev, fn);

  /* Connected components, ignoring direction, largest first. Computed on first use. */
  let _comps = null;
  function comps() {
    if (_comps) return _comps;
    const p = Int32Array.from({ length: G.n }, (_, i) => i);
    const find = i => { while (p[i] !== i) i = p[i] = p[p[i]]; return i; };
    for (const [u, v] of G.edges) p[find(u)] = find(v);
    const groups = new Map();
    for (let i = 0; i < G.n; i++) {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(i);
    }
    const list = [...groups.values()].sort((a, b) => b.length - a.length);
    const of = new Int32Array(G.n);
    list.forEach((ids, k) => ids.forEach(i => { of[i] = k; }));
    const km = new Float64Array(list.length);
    G.edges.forEach(([u], e) => { km[of[u]] += G.lengths[e] / 1000; });
    return (_comps = { list, of, km });
  }

  /* Coverage of a set of sensors on an observability graph: watched nodes, and the
     reaches between them, which is what the map lights up. */
  function coverage(g, sensors) {
    const cov = new Uint8Array(g.n), isS = new Uint8Array(g.n);
    let count = 0;
    for (const s of sensors) {
      isS[s] = 1;
      const set = C.obsOf(g, s);
      for (let k = 0; k < set.length; k++) if (!cov[set[k]]) { cov[set[k]] = 1; count++; }
    }
    return { cov, isS, count };
  }
  const litEdge = (c, e) => { const [u, v] = G.edges[e]; return c.cov[v] && (c.cov[u] || c.isS[u]); };
  /* Map styles for a placement: sensors on top, watched nodes and reaches lit. */
  function placementStyles(c, latest) {
    return {
      edgeStyle: e => (litEdge(c, e) ? { color: COL.accent, z: 1 } : { color: COL.dim }),
      nodeStyle: i => c.isS[i] ? { color: COL.warn, r: i === latest ? 6 : 4.2, stroke: i === latest ? COL.ink : "#0b1220" }
        : c.cov[i] ? { color: COL.accent, r: 2.2 }
        : G.candidate[i] ? { color: COL.slot, r: 1.8 } : null,
    };
  }

  /* --------------------------------------------------------- long section */
  /* The strip under the map, for the steps that cut a long section. One route through
     the chosen chamber, 12 chambers each way and 45 times exaggerated, as the sandbox
     opens it. levels(path, pe) supplies the water; without it the view draws only the
     pipe, the chambers and the ground. */
  const long = (function () {
    const el = $("lower"), cv = $("prof");
    const up = C.upstreamSize(G);
    let view = null, cur = null;
    function render() {
      if (!cur || el.hidden) return;
      view = view || P.makeView(cv);
      const path = P.tracePath(G, cur.node, up, 12, 12);
      const pe = P.pathEdges(G, path), ch = P.chainage(G, path, pe);
      const w = cur.levels ? cur.levels(path, pe) : { lvl: null, label: cur.label, sub: cur.sub };
      Object.assign(view.st, {
        g: G, path, pe, ch, exagg: 45, boreScale: 1, source: "manning",
        nodeLevel: w.lvl, spill: new Array(path.length).fill(0),
        sensors: new Set(), selected: cur.node, label: w.label, subLabel: w.sub,
        onPick: nd => { cur.node = nd; render(); },
      });
      view.draw();
    }
    if (typeof ResizeObserver === "function")
      new ResizeObserver(() => { if (!el.hidden && view) view.draw(); }).observe(cv);
    function hide() { el.hidden = true; cur = null; }
    on($("prof-close"), "click", hide);
    return {
      show(opts) { cur = opts; el.hidden = false; requestAnimationFrame(render); },
      hide, render,
      get node() { return cur ? cur.node : -1; },
    };
  })();
  /* A long section opens by itself only where there is room for it beside the map; on a
     phone it would leave the map a sliver, so there it waits for a tap. */
  const roomy = () => !window.matchMedia || window.matchMedia("(min-width: 641px)").matches;
  const clickNode = h => (h && h.kind === "node" ? h.i : h && h.kind === "edge" ? G.edges[h.e][0] : -1);

  /* ------------------------------------------------------------ 1 network */
  const network = (() => {
    let sel = -1;
    function style() {
      const c = comps();
      map.set({
        edgeStyle: e => {
          const k = c.of[G.edges[e][0]];
          return sel >= 0 && k !== sel ? { color: COL.dim } : { color: COMP_COL[k % COMP_COL.length], z: k === sel ? 1 : 0 };
        },
      });
    }
    return {
      enter(map, panel) {
        sel = -1;
        const f = F.network(), c = comps();
        panel.innerHTML =
          `<h2>The network</h2>` +
          stat("Nodes", n(f.nodes)) +
          stat("Maintenance holes", n(f.manholes)) +
          stat("Junctions with no manhole", n(f.nodes - f.manholes)) +
          stat("Reaches", n(f.reaches)) +
          stat("Length", f.km.toFixed(1) + " km") +
          stat("Separate networks", f.components) +
          `<div class="sec"><h2>Networks, largest first</h2><div class="rows" id="nw-list">` +
          c.list.map((ids, k) =>
            `<button data-k="${k}">${sw(COMP_COL[k % COMP_COL.length])}<span class="lab">${n(ids.length)} nodes</span>` +
            `<span class="num">${c.km[k].toFixed(c.km[k] < 1 ? 2 : 1)} km</span></button>`).join("") +
          `</div><p class="hint">Click one to zoom to it, and again to see them all. A network with no ` +
          `pipe joining it to the rest was cut off by the boundary the data was clipped to.</p></div>` +
          `<div class="sec"><h2>Reading the map</h2><p class="hint">Dots are maintenance holes, where a ` +
          `sensor could go. Line width grows with the square root of pipe diameter, so small pipes stay ` +
          `visible beside large ones; it is not to scale.</p></div>`;
        const list = $("nw-list");
        on(list, "click", e => {
          const b = e.target.closest("button");
          if (!b) return;
          const k = +b.dataset.k;
          sel = sel === k ? -1 : k;
          list.querySelectorAll("button").forEach(x => x.classList.toggle("on", +x.dataset.k === sel));
          style();
          if (sel >= 0) map.fitNodes(c.list[sel], 40); else map.fit();
        });
        style();
      },
      leave() { if (sel >= 0) map.fit(); },
    };
  })();

  /* --------------------------------------------------------------- 2 data */
  const data = (() => {
    const Pp = G.pipes || {};
    const pa = RAW.stats.pipe_attrs;
    const codeOf = (codes, v) => (v >= 0 ? (codes || [])[v] : null);
    let years = [Infinity, -Infinity];
    if (Pp.year) for (let e = 0; e < m; e++) if (Pp.year[e]) years = [Math.min(years[0], Pp.year[e]), Math.max(years[1], Pp.year[e])];

    /* One entry per field the map can be coloured by: an edge or node style, and the
       legend rows with their counts, counted from the loaded data. */
    const LAYERS = {
      material: {
        label: "Material",
        edge: e => { const c = codeOf(CODES.mat, Pp.mat && Pp.mat[e]); return { color: c ? MAT_COL[c] || COL.pipe : COL.bad, z: c ? 0 : 1 }; },
        legend() {
          const k = {}; let miss = 0;
          for (let e = 0; e < m; e++) { const c = codeOf(CODES.mat, Pp.mat && Pp.mat[e]); if (c) k[c] = (k[c] || 0) + 1; else miss++; }
          return Object.keys(k).map(c => legendRow(MAT_COL[c] || COL.pipe, MAT_LABEL[c] || esc(c), k[c]))
            .concat(miss ? [legendRow(COL.bad, "not recorded", miss)] : []).join("");
        },
        note: `${pa.material_from_fallback} reaches read unknown in the primary material field and take ` +
          `their material from a second published field. The payload does not say which, so the map ` +
          `cannot pick them out.`,
      },
      idia: {
        label: "Internal diameter",
        edge: e => (Pp.idia && Pp.idia[e] > 0 ? { color: COL.pipe } : { color: COL.bad, z: 1 }),
        legend() {
          let have = 0; for (let e = 0; e < m; e++) if (Pp.idia && Pp.idia[e] > 0) have++;
          return legendRow(COL.pipe, "recorded", have) + legendRow(COL.bad, "not recorded", m - have);
        },
        note: "Capacity needs the bore water actually flows through. Where it is missing the nominal " +
          "diameter stands in, which every reach records.",
      },
      joint: {
        label: "Joint type",
        edge: e => { const c = codeOf(CODES.joint, Pp.joint && Pp.joint[e]); return { color: c ? JOINT_COL[c] || COL.pipe : COL.bad, z: c ? 0 : 1 }; },
        legend() {
          const k = {}; let miss = 0;
          for (let e = 0; e < m; e++) { const c = codeOf(CODES.joint, Pp.joint && Pp.joint[e]); if (c) k[c] = (k[c] || 0) + 1; else miss++; }
          return Object.keys(k).map(c => legendRow(JOINT_COL[c] || COL.pipe, JOINT_LABEL[c] || esc(c), k[c]))
            .concat(miss ? [legendRow(COL.bad, "not recorded", miss)] : []).join("");
        },
        note: "Joint type is recorded on the same reaches as the internal diameter and missing on the same ones.",
      },
      year: {
        label: "Year built",
        edge: e => (Pp.year && Pp.year[e]
          ? { color: along(YEAR_STOPS, (Pp.year[e] - years[0]) / Math.max(1, years[1] - years[0])) }
          : { color: COL.bad, z: 1 }),
        legend() {
          let miss = 0; for (let e = 0; e < m; e++) if (!(Pp.year && Pp.year[e])) miss++;
          return `<span class="sw" style="width:40px;background:${gradient(YEAR_STOPS)}"></span>` +
            `<span>${years[0]} to ${years[1]}</span><span class="n">${n(m - miss)}</span>` +
            (miss ? legendRow(COL.bad, "not recorded", miss) : "");
        },
        note: "The oldest pipes are the trunk mains; the small-bore pipes were laid later.",
      },
      cover: {
        label: "Cover level",
        node: true,
        edge: () => ({ color: COL.dim }),
        nodeStyle: i => G.coverSrc[i] === 1 ? { color: COL.good, r: 5, stroke: "#0b1220" }
          : G.coverSrc[i] === 2 ? { color: COL.slot, r: 2 }
          : G.coverSrc[i] === 3 ? { color: COL.warn, r: 3.5 }
          : { color: COL.bad, r: 4.5, stroke: "#0b1220" },
        legend() {
          const c = [0, 0, 0, 0]; for (let i = 0; i < G.n; i++) c[G.coverSrc[i]]++;
          return legendRow(COL.good, "surveyed", c[1], true) + legendRow(COL.slot, "read from 1 m contours", c[2], true) +
            (c[3] ? legendRow(COL.warn, "transferred from a neighbour", c[3], true) : "") +
            (c[0] ? legendRow(COL.bad, "unknown", c[0], true) : "");
        },
        note: "Depth is cover level less invert, and depth decides where backed-up water escapes. " +
          (VALID && VALID.leg_a ? `Against the ${VALID.leg_a.n} surveyed covers, contour levels are out by ` +
            `${VALID.leg_a.mean_abs.toFixed(2)} m on average and ${VALID.leg_a.p90_abs.toFixed(2)} m at the 90th percentile.` : ""),
      },
    };
    let layer = "material";
    function apply() {
      const L = LAYERS[layer];
      map.set({ edgeStyle: L.edge, nodeStyle: L.nodeStyle || null });
      $("dt-legend").innerHTML = L.legend();
      $("dt-note").textContent = L.note;
      $("dt-seg").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.l === layer));
    }
    return {
      enter(map, panel) {
        const f = F.data();
        const fieldRow = (label, v, note) => stat(label + (note ? ` <span class="hint">${note}</span>` : ""), v);
        panel.innerHTML =
          `<h2>What each reach records</h2>` +
          fieldRow("Diameter", pa.diameter_pct + "%") +
          fieldRow("Material", pa.material_pct + "%", `(${f.materialFromFallback} from a second field)`) +
          fieldRow("Year built", pa.const_year_pct + "%") +
          fieldRow("Grade", pa.grade_pct + "%") +
          fieldRow("Internal diameter", pa.internal_dia_pct + "%") +
          fieldRow("Joint type", pa.jointtype_pct + "%") +
          fieldRow("Roughness", pa.roughness_pct + "%") +
          `<p class="hint">With no roughness published, capacity takes a Manning n per material.</p>` +
          `<h2 class="sec">And each node</h2>` +
          stat("Cover level surveyed", `${f.surveyed} of ${n(f.nodes)}`) +
          stat("Median depth", f.depthMedian != null ? f.depthMedian.toFixed(2) + " m" : "&ndash;") +
          `<div class="sec"><h2>Colour the map by</h2><div class="seg" id="dt-seg">` +
          Object.keys(LAYERS).map(k => `<button data-l="${k}">${LAYERS[k].label}</button>`).join("") +
          `</div><div class="legend" id="dt-legend"></div><p class="hint" id="dt-note"></p></div>`;
        on($("dt-seg"), "click", e => {
          const b = e.target.closest("button");
          if (b) { layer = b.dataset.l; apply(); }
        });
        apply();
      },
      leave() {},
    };
  })();

  /* --------------------------------------------------------------- 3 flow */
  const flow = (() => {
    const f = () => F.flow();
    let flag = null, off = [];
    const rise = e => G.inv[G.edges[e][1]] - G.inv[G.edges[e][0]];
    /* Arrowheads at each reach's midpoint, once the reach is long enough on screen to
       carry one without clutter. */
    function arrows(ctx2, api) {
      const s = api.view.scale;
      ctx2.fillStyle = "rgba(231,237,247,.75)";
      for (let e = 0; e < m; e++) {
        if (G.lengths[e] * s < 26) continue;
        const pl = G.polylines[e];
        let total = 0;
        for (let k = 1; k < pl.length; k++) total += Math.hypot(pl[k][0] - pl[k - 1][0], pl[k][1] - pl[k - 1][1]);
        let acc = 0, k = 1;
        for (; k < pl.length; k++) {
          const L = Math.hypot(pl[k][0] - pl[k - 1][0], pl[k][1] - pl[k - 1][1]);
          if (acc + L >= total / 2) break;
          acc += L;
        }
        k = Math.min(k, pl.length - 1);
        const a = pl[k - 1], b = pl[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const t = (total / 2 - acc) / L;
        const [x, y] = api.toScreen(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
        const ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]), h = 6;
        ctx2.beginPath();
        ctx2.moveTo(x + h * Math.cos(ang), y + h * Math.sin(ang));
        ctx2.lineTo(x + h * Math.cos(ang + 2.5), y + h * Math.sin(ang + 2.5));
        ctx2.lineTo(x + h * Math.cos(ang - 2.5), y + h * Math.sin(ang - 2.5));
        ctx2.closePath();
        ctx2.fill();
      }
    }
    const cut = node => long.show({
      node, label: "Levels only",
      sub: "pipe inverts, chambers and ground; no flow is modelled on this step",
    });
    return {
      enter(map, panel) {
        const d = f();
        flag = new Int8Array(m);
        d.rising.forEach(e => { flag[e] = 2; });
        d.level.forEach(e => { flag[e] = 1; });
        map.set({
          edgeStyle: e => flag[e] === 2 ? { color: COL.bad, width: map.widths[e] + 2.5, z: 2 }
            : flag[e] === 1 ? { color: COL.warn, width: map.widths[e] + 2.5, z: 2 }
            : { color: COL.pipe },
          overlay: arrows,
        });
        const odd = d.rising.map(e => [e, 2]).concat(d.level.map(e => [e, 1]));
        const c = ST.CITED.invertBadIfGeometry;
        panel.innerHTML =
          `<h2>Direction</h2>` +
          stat("From the published field", n(d.fromField)) +
          stat("From geometry, field blank", n(d.fromGeometry)) +
          stat("Loops", d.hasCycle ? "yes" : "none") +
          `<p class="hint">Zoom in for arrows. Reading direction from the field first matters: read from ` +
          `geometry first, ${ST.CITED.reversedIfGeometry.value} mains come out reversed ` +
          `(${ST.CITED.reversedIfGeometry.src}).</p>` +
          `<div class="sec"><h2>Do the levels agree?</h2>` +
          `<p class="hint">Water runs downhill, so each reach's far end should sit lower. Checked against ` +
          `each pipe's own end levels, ${d.invertBad} chambers disagree with this direction, against ` +
          `${c.value} read geometry-first (${c.src}). Those end levels are not in the published payload, ` +
          `which carries one level per chamber instead. By those, these reaches do not fall:</p>` +
          `<div class="rows" id="fl-list">` +
          odd.map(([e, k]) => `<button data-e="${e}">${sw(k === 2 ? COL.bad : COL.warn)}` +
            `<span class="lab">reach ${e}</span><span class="num">${k === 2 ? "rises " + rise(e).toFixed(2) + " m" : "level"}</span></button>`).join("") +
          `</div><p class="hint">Click one to zoom to it and cut a long section through it.</p></div>` +
          `<div class="sec"><h2>Long section</h2><p class="hint">Click any chamber or pipe on the map to cut ` +
          `a long section through it: distance along the sewer across, level up, exaggerated 45 times. ` +
          `Click a chamber in the section to move the cut there.</p></div>`;
        on($("fl-list"), "click", e => {
          const b = e.target.closest("button");
          if (!b) return;
          const k = +b.dataset.e;
          map.fitNodes(G.edges[k], 60);
          cut(G.edges[k][0]);
        });
        off.push(map.on("click", h => { const i = clickNode(h); if (i >= 0) cut(i); }));
        if (odd.length && roomy()) cut(G.edges[odd[0][0]][0]);
      },
      leave() { off.forEach(fn => fn()); off = []; long.hide(); },
    };
  })();

  /* ----------------------------------------------------------- 4 capacity */
  const capacity = (() => {
    const geo = K.edgeGeometry(G, { matCodes: CODES.mat });
    let perNode = 0.2, cs = null, off = [];
    const use = e => (cs.qCap[e] > 0 ? cs.q[e] / cs.qCap[e] : 0);
    const levels = (path, pe) => ({
      lvl: P.manningLevels(G, path, pe, cs.dOverD),
      label: "Manning, steady uniform flow",
      sub: `${perNode.toFixed(2)} L/s per chamber, peak x1  |  no backwater, no storage, no time`,
    });
    function compute() {
      cs = K.capacityState(G, C, { perNode, peakFactor: 1, geo });
      const s = cs.summary;
      let busiest = 0;
      for (let e = 0; e < m; e++) busiest = Math.max(busiest, use(e));
      $("cp-v").textContent = perNode.toFixed(2) + " L/s";
      $("cp-big").innerHTML = `${s.nodesSurcharged} <small>chamber${s.nodesSurcharged === 1 ? "" : "s"} surcharge</small>`;
      $("cp-stats").innerHTML =
        stat("Reaches over capacity", `${s.edgesOver} of ${n(s.edges)}`) +
        stat("Length over capacity", (s.lengthOver / 1000).toFixed(2) + " km") +
        stat("Busiest reach", Math.round(busiest * 100) + "% of capacity");
      $("cp-seg").querySelectorAll("button").forEach(b => b.classList.toggle("on", +b.dataset.v === perNode));
      map.redraw();
      long.render();
    }
    return {
      enter(map, panel) {
        const L = F.capacity().ladder;
        panel.innerHTML =
          `<h2>Demand</h2>` +
          `<label class="range" for="cp-r">Load per chamber <b id="cp-v"></b></label>` +
          `<input type="range" id="cp-r" min="1" max="100" step="1" value="${Math.round(perNode * 100)}">` +
          `<div class="seg" id="cp-seg">${L.map(r => `<button data-v="${r.perNode}" title="${r.surcharged} surcharge">` +
            `${r.perNode} L/s</button>`).join("")}</div>` +
          `<div class="big sec" id="cp-big"></div><div id="cp-stats"></div>` +
          `<div class="sec"><h2>Reading the map</h2><div class="legend">` +
          `<span class="sw" style="width:40px;background:${gradient(USE_STOPS)}"></span><span>share of capacity used</span><span class="n">0 to 100%</span>` +
          legendRow(COL.bad, "over capacity", null) + legendRow(COL.bad, "surcharged chamber", null, true) +
          `</div><p class="hint">Flow is added up reach by reach down the network and set against what ` +
          `each reach carries part full by Manning, with roughness by material. Peak factor 1, steady ` +
          `flow: a screening estimate, not a hydraulic model.</p>` +
          `<p class="hint">Click a chamber or pipe for the water level along its route.</p></div>`;
        on($("cp-r"), "input", e => { perNode = +e.target.value / 100; compute(); });
        on($("cp-seg"), "click", e => {
          const b = e.target.closest("button");
          if (!b) return;
          perNode = +b.dataset.v;
          $("cp-r").value = Math.round(perNode * 100);
          compute();
        });
        map.set({
          edgeStyle: e => cs.over[e] ? { color: COL.bad, width: map.widths[e] + 1.5, z: 2 }
            : { color: along(USE_STOPS, use(e)), z: use(e) > 0.5 ? 1 : 0 },
          nodeStyle: i => cs.surcharged[i] ? { color: COL.bad, r: 4.2, stroke: "#0b1220" }
            : G.mh[i] ? { color: COL.slot } : null,
        });
        compute();
        off.push(map.on("click", h => { const i = clickNode(h); if (i >= 0) long.show({ node: i, levels }); }));
        // Open on the reach closest to giving out at this load.
        let worst = 0;
        for (let e = 1; e < m; e++) if (use(e) > use(worst)) worst = e;
        if (roomy()) long.show({ node: G.edges[worst][0], levels });
      },
      leave() { off.forEach(fn => fn()); off = []; long.hide(); },
      hud(h) {
        if (!cs) return "";
        if (h.kind === "edge") {
          const e = h.e;
          return row("flow", `${(cs.q[e] * 1000).toFixed(2)} of ${(cs.qCap[e] * 1000).toFixed(1)} L/s`) +
            row("used", cs.over[e] ? '<span style="color:var(--bad)">over capacity</span>' : Math.round(use(e) * 100) + "%");
        }
        return cs.surcharged[h.i] ? row("state", '<span style="color:var(--bad)">surcharged</span>') : "";
      },
    };
  })();

  /* -------------------------------------------------------------- 5 sight */
  const sight = (() => {
    const g = C.buildGraph(RAW);   // its own: computeObservable replaces g.obs
    let model = "headroom", thrCm = Math.round(ST.THRESHOLD_M * 100), pinned = -1, hovered = -1;
    let seen = null, inSet = new Uint8Array(G.n), max = 1, off = [];
    const active = () => (pinned >= 0 ? pinned : hovered);

    function compute() {
      const o = C.computeObservable(g, { model, threshold: thrCm / 100 });
      seen = new Int32Array(g.n);
      max = 1;
      for (let i = 0; i < g.n; i++) { seen[i] = o.ptr[i + 1] - o.ptr[i]; if (g.candidate[i]) max = Math.max(max, seen[i]); }
      const cand = [];
      for (let i = 0; i < g.n; i++) if (g.candidate[i]) cand.push(seen[i]);
      cand.sort((a, b) => a - b);
      $("sg-big").innerHTML = `${o.zeroObservable} <small>of ${n(g.n)} nodes see nothing</small>`;
      $("sg-stats").innerHTML =
        stat("Nodes some sensor can see", n(o.universeSize)) +
        stat("Median a maintenance hole sees", cand[cand.length >> 1]) +
        stat("Most any one sees", max);
      $("sg-seg").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.m === model));
      $("sg-r").disabled = model !== "headroom";
      $("sg-v").textContent = model === "headroom" ? thrCm + " cm" : "not used";
      $("sg-model").textContent = model === "headroom"
        ? "Water backs up level behind a blockage until it escapes at the lowest opening. A sensor " +
          "sees the blockage if that water rises past the threshold where it sits. Depth is cover level less invert."
        : "As published: a sensor sees a node downstream if that node's invert plus 0.7 of its pipe " +
          "diameter sits above the sensor's invert. Diameter stands in for depth.";
      focus();
    }
    function focus() {
      const a = active();
      inSet.fill(0);
      if (a >= 0) { const s = C.obsOf(g, a); for (let k = 0; k < s.length; k++) inSet[s[k]] = 1; }
      const el = $("sg-pin");
      if (a < 0) {
        el.innerHTML = `<p class="hint">Hover a chamber to preview what a sensor there would see; click to pin it.</p>`;
      } else {
        let len = 0, cnt = 0;
        for (let i = 0; i < g.n; i++) if (inSet[i]) { cnt++; len += g.lenIn[i]; }
        el.innerHTML =
          stat(`Node ${a}${pinned >= 0 ? " (pinned)" : ""}`, g.candidate[a] ? "maintenance hole" : "no manhole, no sensor") +
          stat("Nodes it sees", cnt) + stat("Pipe it covers", n(len) + " m") +
          (pinned >= 0 ? `<button class="act" id="sg-zoom">Zoom to it</button><button class="act" id="sg-unpin">Unpin</button>` : "");
        if (pinned >= 0) {
          on($("sg-zoom"), "click", () => map.fitNodes([pinned].concat([...C.obsOf(g, pinned)]), 40));
          on($("sg-unpin"), "click", () => { pinned = -1; focus(); });
        }
      }
      map.redraw();
    }
    return {
      enter(map, panel) {
        pinned = hovered = -1;
        panel.innerHTML =
          `<h2>How depth is read</h2>` +
          `<div class="seg" id="sg-seg"><button data-m="headroom">Measured depth</button>` +
          `<button data-m="legacy">Diameter stand-in</button></div>` +
          `<p class="hint" id="sg-model"></p>` +
          `<label class="range" for="sg-r">Detection threshold <b id="sg-v"></b></label>` +
          `<input type="range" id="sg-r" min="1" max="30" step="1" value="${thrCm}">` +
          `<div class="big sec" id="sg-big"></div><div id="sg-stats"></div>` +
          `<div class="sec"><h2>One chamber</h2><div id="sg-pin"></div></div>` +
          `<div class="sec"><h2>Reading the map</h2><div class="legend">` +
          `<span class="sw" style="width:40px;background:${gradient(COUNT_STOPS)}"></span><span>how many nodes a maintenance hole sees</span><span></span>` +
          legendRow(COL.bad, "sees nothing", null, true) + legendRow(COL.warn, "the chamber in focus", null, true) +
          legendRow(COL.accent, "what it sees", null, true) + `</div></div>`;
        on($("sg-seg"), "click", e => {
          const b = e.target.closest("button");
          if (b) { model = b.dataset.m; compute(); }
        });
        on($("sg-r"), "input", e => { thrCm = +e.target.value; compute(); });
        map.set({
          edgeStyle: e => {
            if (active() < 0) return { color: COL.pipe };
            const [u, v] = G.edges[e];
            return inSet[v] && (inSet[u] || u === active()) ? { color: COL.accent, width: map.widths[e] + 1, z: 1 } : { color: COL.dim };
          },
          nodeStyle: i => {
            const a = active();
            if (i === a) return { color: COL.warn, r: 6, stroke: COL.ink };
            if (a >= 0) return inSet[i] ? { color: COL.accent, r: 3 } : g.candidate[i] ? { color: COL.slot, r: 1.8 } : null;
            if (!seen[i]) return { color: COL.bad, r: 3.2 };
            return g.candidate[i] ? { color: along(COUNT_STOPS, seen[i] / max), r: 2.6 } : null;
          },
        });
        off.push(map.on("hover", h => {
          const i = h && h.kind === "node" ? h.i : -1;
          if (i !== hovered) { hovered = i; if (pinned < 0) focus(); }
        }));
        off.push(map.on("click", h => {
          pinned = h && h.kind === "node" && h.i !== pinned ? h.i : -1;
          focus();
        }));
        compute();
      },
      leave() { off.forEach(fn => fn()); off = []; },
      hud(h) { return h.kind === "node" && seen ? row("sees", `${seen[h.i]} node${seen[h.i] === 1 ? "" : "s"}`) : ""; },
    };
  })();

  /* ---------------------------------------------------------- 6 placement */
  const placement = (() => {
    let k = 0, timer = 0, off = [], cov = null;
    const pf = () => F.placement();
    function drawChart() {
      const cv = $("pl-chart");
      if (!cv) return;
      const f = pf(), dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth, H = cv.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const c = cv.getContext("2d");
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const pad = { l: 34, r: 8, t: 8, b: 22 };
      const X = i => pad.l + (W - pad.l - pad.r) * i / f.sensors;
      const Y = v => H - pad.b - (H - pad.t - pad.b) * v / f.reach;
      c.strokeStyle = "#22314d"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(pad.l, pad.t); c.lineTo(pad.l, H - pad.b); c.lineTo(W - pad.r, H - pad.b); c.stroke();
      c.fillStyle = "#6f81a3"; c.font = "11px ui-sans-serif,system-ui,Segoe UI,Arial";
      c.textAlign = "right"; c.fillText(String(f.reach), pad.l - 4, pad.t + 9); c.fillText("0", pad.l - 4, H - pad.b);
      c.textAlign = "center"; c.fillText("sensors", (pad.l + W - pad.r) / 2, H - 6);
      c.textAlign = "right"; c.fillText(String(f.sensors), W - pad.r, H - 6);
      // the comparison budget
      c.setLineDash([3, 3]); c.strokeStyle = "#6f81a3";
      c.beginPath(); c.moveTo(X(f.budget), pad.t); c.lineTo(X(f.budget), H - pad.b); c.stroke(); c.setLineDash([]);
      c.textAlign = "left"; c.fillText(String(f.budget), X(f.budget) + 3, H - pad.b - 4);
      c.strokeStyle = COL.accent; c.lineWidth = 2;
      c.beginPath(); c.moveTo(X(0), Y(0));
      f.curve.forEach((v, i) => c.lineTo(X(i + 1), Y(v)));
      c.stroke();
      const v = k ? f.curve[k - 1] : 0;
      c.fillStyle = COL.warn; c.beginPath(); c.arc(X(k), Y(v), 4, 0, 2 * Math.PI); c.fill();
    }
    function setK(next) {
      const f = pf();
      k = Math.max(0, Math.min(f.sensors, next));
      cov = coverage(F.graph(), f.order.slice(0, k));
      $("pl-r").value = k;
      $("pl-k").textContent = k;
      $("pl-w").textContent = n(cov.count);
      $("pl-p").textContent = pct(cov.count, f.reach);
      map.set(placementStyles(cov, k ? f.order[k - 1] : -1));
      drawChart();
    }
    function stop() { clearInterval(timer); timer = 0; const b = $("pl-play"); if (b) b.textContent = "Play"; }
    function play() {
      if (timer) { stop(); return; }
      if (k >= pf().sensors) setK(0);
      $("pl-play").textContent = "Pause";
      timer = setInterval(() => { if (k >= pf().sensors) stop(); else setK(k + 1); }, 90);
    }
    let ro = null;
    return {
      enter(map, panel) {
        const f = pf();
        panel.innerHTML =
          `<h2>Greedy, one sensor at a time</h2>` +
          `<div class="big"><span id="pl-k"></span> <small>sensors watch</small> <span id="pl-w"></span> <small>nodes</small></div>` +
          `<p class="hint"><span id="pl-p"></span> of the ${n(f.reach)} nodes sensors in maintenance holes can watch at all.</p>` +
          `<input type="range" id="pl-r" min="0" max="${f.sensors}" step="1" aria-label="Sensors placed">` +
          `<div><button class="act" id="pl-play">Play</button><button class="act" id="pl-b">${f.budget}, the comparison budget</button>` +
          `<button class="act" id="pl-all">All ${f.sensors}</button></div>` +
          `<canvas class="chart" id="pl-chart"></canvas>` +
          `<p class="hint">Each sensor greedy adds watches no more new nodes than the one before it, so ` +
          `the curve only flattens. Half the reach takes ${f.halfAt} sensors; the other half takes ` +
          `${f.sensors - f.halfAt}.</p>` +
          `<div class="sec"><h2>Reading the map</h2><div class="legend">` +
          legendRow(COL.warn, "sensor (ringed: the latest)", null, true) + legendRow(COL.accent, "watched", null, true) +
          legendRow(COL.slot, "maintenance hole, no sensor", null, true) + `</div></div>`;
        on($("pl-r"), "input", e => { stop(); setK(+e.target.value); });
        on($("pl-play"), "click", play);
        on($("pl-b"), "click", () => { stop(); setK(f.budget); });
        on($("pl-all"), "click", () => { stop(); setK(f.sensors); });
        if (typeof ResizeObserver === "function") { ro = new ResizeObserver(drawChart); ro.observe($("pl-chart")); }
        setK(f.budget);
      },
      leave() { stop(); if (ro) ro.disconnect(); ro = null; off.forEach(fn => fn()); off = []; },
    };
  })();

  /* ------------------------------------------------------------ 7 compare */
  const compare = (() => {
    const g = () => F.graph();
    let budget = ST.BUDGET, sel = "greedy", placed = null, watched = null;
    function compute() {
      placed = ST.placements(g(), C, budget);
      watched = {};
      for (const k in placed) watched[k] = C.score(g(), placed[k]).nodes;
      $("cm-v").textContent = budget;
      render();
    }
    function render() {
      const top = Math.max(1, ...Object.values(watched));
      $("cm-list").innerHTML = ST.METHODS.map(([id, label]) =>
        `<button data-id="${id}" class="${id === sel ? "on" : ""}"><span class="lab">${esc(label)}</span>` +
        `<span class="bar"><i style="width:${(100 * watched[id] / top).toFixed(1)}%;` +
        `${id === "greedy" ? "" : "background:#7d93bb"}"></i></span><span class="num">${watched[id]}</span></button>`).join("");
      /* Greedy on a coverage objective is within 1 - 1/e of the best layout of the same
         size (Nemhauser, Wolsey and Fisher 1978), so the best possible is bounded above,
         though not found. */
      const bound = Math.min(F.placement().reach, Math.floor(watched.greedy / (1 - 1 / Math.E)));
      $("cm-bound").textContent =
        `No exact optimum is solved here. Greedy's guarantee on this kind of objective puts the best ` +
        `possible ${budget}-sensor layout at no more than ${bound} nodes, so greedy's ${watched.greedy} ` +
        `is at least ${pct(watched.greedy, bound)} of it; how close it really is, is not measured.`;
      map.set(placementStyles(coverage(g(), placed[sel]), -1));
    }
    return {
      enter(map, panel) {
        panel.innerHTML =
          `<h2>Nodes watched, same sensors each</h2>` +
          `<label class="range" for="cm-r">Sensors <b id="cm-v"></b></label>` +
          `<input type="range" id="cm-r" min="5" max="120" step="1" value="${budget}">` +
          `<div class="rows" id="cm-list"></div>` +
          `<p class="hint">Click a method to see its layout on the map. Every method draws from the same ` +
          `${n(F.sight().candidates)} maintenance holes, the ones that see anything at all, and is scored ` +
          `the same way.</p>` +
          `<p class="hint" id="cm-bound"></p>`;
        on($("cm-r"), "input", e => { budget = +e.target.value; compute(); });
        on($("cm-list"), "click", e => {
          const b = e.target.closest("button");
          if (b) { sel = b.dataset.id; render(); }
        });
        compute();
      },
      leave() {},
    };
  })();

  /* ------------------------------------------------------------ 8 caveats */
  const caveats = (() => {
    let sel = -1;
    const SHOW = {
      none: () => ({}),
      blind: () => {
        const o = F.graph().obs;
        return {
          edgeStyle: () => ({ color: COL.dim }),
          nodeStyle: i => (o.ptr[i + 1] === o.ptr[i] ? { color: COL.bad, r: 4, stroke: "#0b1220" } : null),
        };
      },
      contour: () => ({
        edgeStyle: () => ({ color: COL.dim }),
        nodeStyle: i => G.coverSrc[i] === 1 ? { color: COL.good, r: 5, stroke: "#0b1220" } : { color: COL.warn, r: 1.8 },
      }),
      fragments: () => {
        const c = comps();
        return { edgeStyle: e => (c.of[G.edges[e][0]] ? { color: COL.warn, width: map.widths[e] + 1.5, z: 1 } : { color: COL.dim }) };
      },
      surcharge: () => {
        const top = ST.DEMAND[ST.DEMAND.length - 1];
        const cs = K.capacityState(G, C, { perNode: top, peakFactor: 1, geo: K.edgeGeometry(G, { matCodes: CODES.mat }) });
        return {
          edgeStyle: e => (cs.over[e] ? { color: COL.bad, width: map.widths[e] + 1.5, z: 1 } : { color: COL.dim }),
          nodeStyle: i => (cs.surcharged[i] ? { color: COL.bad, r: 3.5 } : null),
        };
      },
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
          `<h2>What every result rests on</h2><div id="cv-list">` +
          ST.CAVEATS.map((c, i) => {
            let text;
            try { text = c.text(F); } catch (err) { console.error(err); text = "Could not be computed from the loaded data."; }
            return `<button class="card" data-k="${i}"><h3>${esc(c.title)}</h3><p>${esc(text)}</p>` +
              `<span class="src">${esc(c.src)}${c.show !== "none" ? " &middot; shown on the map" : ""}</span></button>`;
          }).join("") +
          `</div><p class="hint">The full register, with what would remove each assumption, is the ` +
          `<a href="index.html#sandbox" target="_top" style="color:var(--accent)">sandbox's</a> Assumptions tab.</p>`;
        on($("cv-list"), "click", e => {
          const b = e.target.closest(".card");
          if (b) pick(+b.dataset.k);
        });
      },
      leave() {},
    };
  })();

  return { views: { network, data, flow, capacity, sight, placement, compare, caveats }, long };
}

return { make };
});
