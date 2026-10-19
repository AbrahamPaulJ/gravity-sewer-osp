/* A plan view of one network on a canvas: fit, pan, zoom, hover and click, for pages
   other than the sandbox.

   The sandbox draws its own map inside osp_ui.js, which also owns that page's state;
   this is a separate, smaller renderer so the story page can reuse the drawing without
   reaching into the sandbox's state, and without editing the file most likely to
   conflict in a merge. Its conventions are the sandbox's: north up, metres
   (EPSG:28354, as written by the harvester), pipe width as sqrt(diameter) over the
   region's own range, maintenance holes drawn and other nodes not.

   What is drawn is the caller's business. The map takes three optional callbacks and
   otherwise draws the plain network:
     edgeStyle(e)  -> { color, width, z } | null   (null: do not draw that reach)
     nodeStyle(i)  -> { color, r, stroke } | null
     overlay(ctx, api)  drawn last, in screen pixels, for sensors, labels and the like
   Higher z draws later, so whatever the view is about can sit on top.

   Picking prefers a node within NODE_PICK_PX, else the nearest reach within
   EDGE_PICK_PX, because a chamber sits on the reaches it joins and would otherwise be
   unreachable. Both are found through uniform grids, so a hover costs a few dozen
   distance tests, not a thousand.

   UMD, so a page reads it as window.OSPMap. It needs a DOM to run, and no model. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OSPMap = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

const NODE_PICK_PX = 12, EDGE_PICK_PX = 7;
const PAD_PX = 28;
const MIN_SCALE = 0.02, MAX_SCALE = 80;   // pixels per metre, as in the sandbox

/* Pipe width as sqrt(diameter), normalised over the region's range: a compression, so
   the many small pipes stay visible beside the few large ones. Not proportional. */
function pipeWidths(g, lo, hi) {
  const m = g.edges.length, w = new Float64Array(m);
  const d = g.pipes && g.pipes.dia;
  if (!d) return w.fill((lo + hi) / 2);
  let a = Infinity, b = -Infinity;
  for (let e = 0; e < m; e++) if (d[e] > 0) { a = Math.min(a, d[e]); b = Math.max(b, d[e]); }
  const ra = Math.sqrt(a), span = Math.max(1e-6, Math.sqrt(b) - ra);
  for (let e = 0; e < m; e++)
    w[e] = d[e] > 0 ? lo + (hi - lo) * (Math.sqrt(d[e]) - ra) / span : lo * 0.8;
  return w;
}

/* Two uniform grids in world metres: nodes by position, reaches by every cell their
   segments' bounding boxes touch. */
function buildIndex(g) {
  const b = g.bounds, cell = 40;
  const gw = Math.max(1, Math.ceil((b.maxx - b.minx) / cell) + 1);
  const key = (cx, cy) => cy * gw + cx;
  const cxOf = x => Math.floor((x - b.minx) / cell), cyOf = y => Math.floor((y - b.miny) / cell);
  const nodes = new Map(), edges = new Map();
  const put = (map, k, v) => { const a = map.get(k); if (a) a.push(v); else map.set(k, [v]); };
  for (let i = 0; i < g.n; i++) put(nodes, key(cxOf(g.x[i]), cyOf(g.y[i])), i);
  for (let e = 0; e < g.polylines.length; e++) {
    const pl = g.polylines[e], seen = new Set();
    for (let k = 1; k < pl.length; k++) {
      const x0 = cxOf(Math.min(pl[k - 1][0], pl[k][0])), x1 = cxOf(Math.max(pl[k - 1][0], pl[k][0]));
      const y0 = cyOf(Math.min(pl[k - 1][1], pl[k][1])), y1 = cyOf(Math.max(pl[k - 1][1], pl[k][1]));
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const kk = key(cx, cy);
        if (!seen.has(kk)) { seen.add(kk); put(edges, kk, e); }
      }
    }
  }
  return { cell, cxOf, cyOf, key, nodes, edges };
}

function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

/* Colours come from the page's CSS custom properties where it defines them, so the map
   follows the page; the fallbacks are the site's dark palette. */
function cssVar(el, name, fallback) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

function create(canvas, g, opts) {
  opts = opts || {};
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  const view = { scale: 1, ox: 0, oy: 0 };
  const index = buildIndex(g);
  const widths = pipeWidths(g, 0.9, 3.4);
  const listeners = { hover: [], click: [], view: [] };
  let styles = { edgeStyle: null, nodeStyle: null, overlay: null };
  let hover = null, frame = 0, fitted = false;
  /* Whether the reader has panned or zoomed since the last fit. Until they have, a
     resize refits; after, it keeps what they were looking at. */
  let touched = false;
  let lastSize = { w: 0, h: 0 };

  const colours = () => ({
    bg: cssVar(canvas, "--map-bg", cssVar(canvas, "--bg", "#0b1220")),
    pipe: cssVar(canvas, "--map-pipe", "#5b7096"),
    hole: cssVar(canvas, "--map-hole", "#a9b8d4"),
    hover: cssVar(canvas, "--accent", "#38bdf8"),
  });
  let C = colours();

  const sx = v => v * view.scale + view.ox;
  const sy = v => view.oy - v * view.scale;
  const wx = p => (p - view.ox) / view.scale;
  const wy = p => (view.oy - p) / view.scale;

  function emit(kind, arg) { for (const fn of listeners[kind]) fn(arg); }

  function size() {
    const r = canvas.getBoundingClientRect();
    return { w: r.width, h: r.height, r };
  }

  function fit(bounds) {
    const { w, h } = size(), b = bounds || g.bounds;
    if (!w || !h) return;
    const bw = Math.max(1e-6, b.maxx - b.minx), bh = Math.max(1e-6, b.maxy - b.miny);
    view.scale = Math.min((w - PAD_PX * 2) / bw, (h - PAD_PX * 2) / bh);
    view.ox = (w - bw * view.scale) / 2 - b.minx * view.scale;
    view.oy = (h + bh * view.scale) / 2 + b.miny * view.scale;
    fitted = true; touched = false;
    draw();
    emit("view", view);
  }

  function resize() {
    const { w, h } = size();
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const prev = lastSize;
    lastSize = { w, h };
    if (!fitted || !touched) { fit(); return; }
    // Keep the world point that was at the centre at the centre, at the same scale.
    if (prev.w && prev.h) {
      view.ox += (w - prev.w) / 2;
      view.oy += (h - prev.h) / 2;
    }
    draw();
  }

  function strokeEdge(e, color, width) {
    const pl = g.polylines[e];
    ctx.beginPath();
    ctx.moveTo(sx(pl[0][0]), sy(pl[0][1]));
    for (let k = 1; k < pl.length; k++) ctx.lineTo(sx(pl[k][0]), sy(pl[k][1]));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function draw() {
    frame = 0;
    if (!canvas.width) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    // Reaches, in z order when the view gives one.
    const m = g.edges.length, es = styles.edgeStyle;
    const list = [];
    for (let e = 0; e < m; e++) {
      const s = es ? es(e) : { color: C.pipe, width: widths[e] };
      if (s) list.push([e, s]);
    }
    if (es) list.sort((a, b) => (a[1].z || 0) - (b[1].z || 0));
    for (const [e, s] of list) strokeEdge(e, s.color || C.pipe, s.width == null ? widths[e] : s.width);

    // Nodes. By default only maintenance holes, small enough not to bury the pipes.
    const ns = styles.nodeStyle;
    const rDefault = Math.max(1.2, Math.min(3.2, 1.1 * Math.sqrt(view.scale)));
    for (let i = 0; i < g.n; i++) {
      const s = ns ? ns(i) : (g.mh[i] ? { color: C.hole, r: rDefault } : null);
      if (!s) continue;
      ctx.beginPath();
      ctx.arc(sx(g.x[i]), sy(g.y[i]), s.r == null ? rDefault : s.r, 0, 2 * Math.PI);
      ctx.fillStyle = s.color || C.hole;
      ctx.fill();
      if (s.stroke) { ctx.strokeStyle = s.stroke; ctx.lineWidth = 1.2; ctx.stroke(); }
    }

    // The thing under the pointer, last, so it is never painted over.
    if (hover && hover.kind === "edge") strokeEdge(hover.e, C.hover, widths[hover.e] + 2.5);
    if (hover && hover.kind === "node") {
      ctx.beginPath();
      ctx.arc(sx(g.x[hover.i]), sy(g.y[hover.i]), rDefault + 4, 0, 2 * Math.PI);
      ctx.strokeStyle = C.hover; ctx.lineWidth = 2; ctx.stroke();
    }

    if (styles.overlay) styles.overlay(ctx, api);
  }

  /* Coalesce redraws to one per animation frame: pointer moves arrive far faster. */
  function redraw() {
    if (frame) return;
    frame = (typeof requestAnimationFrame === "function" ? requestAnimationFrame : setTimeout)(draw);
  }

  function pick(px, py) {
    const X = wx(px), Y = wy(py);
    const cx = index.cxOf(X), cy = index.cyOf(Y);
    // Search as many cells as the pick radius spans at this zoom, at least one.
    const reach = Math.max(1, Math.ceil(NODE_PICK_PX / view.scale / index.cell));
    let bestN = -1, dN = Infinity, bestE = -1, dE = Infinity;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const k = index.key(cx + dx, cy + dy);
      const ns = index.nodes.get(k);
      if (ns) for (const i of ns) {
        if (styles.nodeStyle ? !styles.nodeStyle(i) : !g.mh[i]) continue;   // only what is drawn
        const d = (g.x[i] - X) ** 2 + (g.y[i] - Y) ** 2;
        if (d < dN) { dN = d; bestN = i; }
      }
      const es = index.edges.get(k);
      if (es) for (const e of es) {
        const pl = g.polylines[e];
        for (let s = 1; s < pl.length; s++) {
          const d = segDist2(X, Y, pl[s - 1][0], pl[s - 1][1], pl[s][0], pl[s][1]);
          if (d < dE) { dE = d; bestE = e; }
        }
      }
    }
    if (bestN >= 0 && Math.sqrt(dN) * view.scale <= NODE_PICK_PX) return { kind: "node", i: bestN };
    if (bestE >= 0 && Math.sqrt(dE) * view.scale <= EDGE_PICK_PX) return { kind: "edge", e: bestE };
    return null;
  }

  const sameHit = (a, b) => (!a && !b) || (a && b && a.kind === b.kind && a.i === b.i && a.e === b.e);
  function setHover(h) {
    if (sameHit(h, hover)) return;
    hover = h;
    canvas.style.cursor = h ? "pointer" : "";
    redraw();
    emit("hover", h);
  }

  function zoomAt(px, py, factor) {
    const bx = wx(px), by = wy(py);
    view.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.scale * factor));
    view.ox = px - bx * view.scale;
    view.oy = py + by * view.scale;
    touched = true;
    redraw();
    emit("view", view);
  }

  /* Pointer events, so mouse, pen and touch share one path. One pointer pans, two pinch.
     A press that moves less than CLICK_SLOP_PX is a click. */
  const CLICK_SLOP_PX = 5;
  const pts = new Map();
  let moved = 0, pinch = null;
  const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  function onDown(e) {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, local(e));
    moved = 0;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) };
    }
  }
  function onMove(e) {
    const p = local(e);
    if (!pts.has(e.pointerId)) {                 // hover, not a drag
      if (e.pointerType === "mouse") setHover(pick(p[0], p[1]));
      return;
    }
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, p);
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch.d > 0) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch.d);
      pinch.d = d; moved += CLICK_SLOP_PX + 1;
      return;
    }
    const dx = p[0] - prev[0], dy = p[1] - prev[1];
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > CLICK_SLOP_PX) {
      view.ox += dx; view.oy += dy;
      touched = true;
      if (hover) { hover = null; emit("hover", null); }
      redraw();
      emit("view", view);
    }
  }
  function onUp(e) {
    const p = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (p && moved <= CLICK_SLOP_PX && e.type === "pointerup") {
      const h = pick(p[0], p[1]);
      if (e.pointerType !== "mouse") setHover(h);   // a tap is the only hover touch has
      emit("click", h);
    }
  }
  function onWheel(e) {
    e.preventDefault();
    const [px, py] = local(e);
    zoomAt(px, py, Math.exp(-e.deltaY * 0.0016));
  }
  function onLeave(e) { if (e.pointerType === "mouse" && !pts.size) setHover(null); }

  canvas.style.touchAction = "none";   // the page must not scroll or zoom under a pinch
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(canvas);

  const api = {
    g, view, widths,
    toScreen: (x, y) => [sx(x), sy(y)],
    toWorld: (px, py) => [wx(px), wy(py)],
    /* Replace any of edgeStyle, nodeStyle, overlay; pass null to restore the default. */
    set(next) { styles = Object.assign({}, styles, next); C = colours(); redraw(); },
    reset() {
      styles = { edgeStyle: null, nodeStyle: null, overlay: null };
      if (hover) { hover = null; canvas.style.cursor = ""; emit("hover", null); }
      redraw();
    },
    on(kind, fn) { listeners[kind].push(fn); return () => { listeners[kind] = listeners[kind].filter(f => f !== fn); }; },
    fit, draw, redraw, resize, pick,
    get hover() { return hover; },
    /* Fit to a set of nodes, e.g. a pinned chamber and what it sees. */
    fitNodes(ids, padM) {
      if (!ids.length) return;
      const p = padM == null ? 30 : padM;
      let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
      for (const i of ids) {
        minx = Math.min(minx, g.x[i]); maxx = Math.max(maxx, g.x[i]);
        miny = Math.min(miny, g.y[i]); maxy = Math.max(maxy, g.y[i]);
      }
      fit({ minx: minx - p, maxx: maxx + p, miny: miny - p, maxy: maxy + p });
    },
    destroy() {
      if (ro) ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
    },
  };
  resize();
  return api;
}

return { create, pipeWidths, NODE_PICK_PX, EDGE_PICK_PX };
});
