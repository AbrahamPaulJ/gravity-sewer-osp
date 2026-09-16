/* osp_profile.js - the long-section view.

   A long-section (or long profile) is the drawing a sewer engineer actually works
   from: distance along the sewer across the page, elevation up it, ground level on
   top, manhole shafts as verticals, and the pipe stepping down between them. It is
   the natural way to SEE a gravity system, because the whole behaviour of a gravity
   system is a consequence of elevation, and elevation is the one thing a plan view
   throws away.

   It earns its place here for one specific reason. The failure this project is about
   is a chamber filling, backing water up the reach above it, and spilling at the rim.
   On a plan view that is a dot changing colour. On a long-section it is visible as
   what it is: a water surface climbing, going flat where it surcharges, and reaching
   the lid. Anyone can read it without being told what to look for, which is what the network operator asked for.

   WATER LEVEL COMES FROM ONE OF TWO MODELS and the view always says which:

     manning   osp_capacity.js, steady uniform normal depth. Instant, responds to the
               sliders, no time axis, no backwater. The water surface it draws is
               parallel to the pipe invert by construction, so it can never show
               water backing up. Good for ranking reaches, useless for showing a
               failure develop.

     swmm      data/osp_swmm.js, precomputed by tools/build_swmm.py using EPA SWMM
               with dynamic wave routing. Real St Venant, so real backwater, real
               storage, real surcharge, on a real clock. This is the one that shows
               the failure happen. It cannot respond to the sliders, because the
               solve happens offline in Python, so it ships as fixed scenarios.

   Keeping both, and labelling them, is deliberate. The difference between the two
   pictures at the same load IS the argument for why a steady solver is not enough,
   and it is better shown than asserted. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OSPProfile = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

/* ----------------------------------------------------------------- path tracing */
/* A long-section needs a single chain of pipes, but a sewer is a branching tree. So
   we trace one route through the chosen chamber: as far upstream as we can go, and
   then all the way down to where the catchment leaves the extract.

   At every branch we follow the LARGEST contributing branch, not the first. Following
   the first would be an arbitrary artefact of edge ordering and would usually pick a
   short spur, giving a profile that tells you nothing. Largest-upstream follows the
   trunk, which is the route the flow actually takes and the route a bottleneck sits
   on. `up` is the upstream node count per node, which osp_core already computes. */
function tracePath(g, start, up, maxUp, maxDown) {
  const seen = new Uint8Array(g.n);
  /* How far to trace, in chambers each way.

     This is not cosmetic, it sets whether the drawing can be read at all. The
     vertical scale is the horizontal scale times the exaggeration, so a longer route
     means a smaller scale, and past a certain length the pipe bore falls below one
     pixel: a 4 km route through Walkerville falls 30 m, and at that span a 300 mm
     pipe is a quarter of a pixel tall. Every number stays right and the water
     becomes invisible. A real long-section covers a few hundred metres for exactly
     this reason, so the default is a window around the chosen chamber and the whole
     route is opt-in. */
  const lim = (v) => (v == null || v < 0 || !isFinite(v)) ? Infinity : v;
  maxUp = lim(maxUp); maxDown = lim(maxDown);

  // Upstream: walk to the head of the biggest tributary each time.
  const head = [];
  let cur = start;
  while (!seen[cur] && head.length < maxUp) {
    seen[cur] = 1;
    let best = -1, bv = -1;
    for (let k = g.inPtr[cur]; k < g.inPtr[cur + 1]; k++) {
      const u = g.inIdx[k];
      if (seen[u]) continue;
      const v = up ? up[u] : 1;
      if (v > bv) { bv = v; best = u; }
    }
    if (best < 0) break;
    head.push(best);
    cur = best;
  }
  head.reverse();

  // Downstream: there is normally one outgoing reach, but where a chamber splits
  // take the branch carrying the larger catchment, same reasoning.
  const tail = [];
  cur = start;
  while (tail.length < maxDown) {
    let best = -1, bv = -1;
    for (let k = g.outPtr[cur]; k < g.outPtr[cur + 1]; k++) {
      const v = g.outIdx[k];
      if (seen[v]) continue;
      const w = up ? up[v] : 1;
      if (w > bv) { bv = w; best = v; }
    }
    if (best < 0) break;
    seen[best] = 1;
    tail.push(best);
    cur = best;
  }

  return head.concat([start], tail);
}

/* Edge index lookup for consecutive path nodes. Built once per path rather than
   scanned per frame: at 60 fps a linear scan of 1001 edges per reach per frame is
   the difference between smooth playback and not. */
function pathEdges(g, path) {
  const key = new Map();
  for (let e = 0; e < g.edges.length; e++) key.set(g.edges[e][0] * g.n + g.edges[e][1], e);
  const out = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const e = key.get(path[i] * g.n + path[i + 1]);
    out.push(e == null ? -1 : e);
  }
  return out;
}

/* Chainage: cumulative real pipe length along the path, metres. Uses the true reach
   length, not the straight-line distance between chambers, because a sewer follows
   the road and the two differ. */
function chainage(g, path, pe) {
  const ch = [0];
  for (let i = 0; i < pe.length; i++) {
    const L = pe[i] >= 0 ? g.lengths[pe[i]] : Math.hypot(
      g.x[path[i + 1]] - g.x[path[i]], g.y[path[i + 1]] - g.y[path[i]]);
    ch.push(ch[i] + Math.max(L, 0.1));
  }
  return ch;
}

/* ------------------------------------------------------------------- the drawing */
const COL = {
  sky:      "#0b1220",
  earth:    "#131d2e",
  ground:   "#6b7f52",
  pipe:     "#7d8db0",
  pipeFill: "#16233a",
  water:    "#2f7fd4",
  waterTop: "#6fb5f5",
  surcharge:"#f43f5e",
  shaft:    "#3b4a68",
  shaftIn:  "#0e1726",
  lid:      "#94a3b8",
  sensor:   "#f43f5e",
  sel:      "#fbbf24",
  grid:     "#1b2740",
  ink:      "#a9b8d4",
  inkFaint: "#6f81a3",
  spill:    "#fb7185",
};

function makeView(canvas) {
  const st = {
    canvas, ctx: canvas.getContext("2d"),
    g: null, path: [], pe: [], ch: [],
    exagg: 10, boreScale: 1,
    source: "manning",           // "manning" | "swmm"
    fill: null, nodeLevel: null, // per-reach d/D and per-node water elevation
    surch: null, spill: null,
    sensors: new Set(), selected: -1,
    hover: -1, pan: 0, zoom: 1,
    label: "", subLabel: "",
    onPick: null,
  };

  /* Scales. x is metres of chainage to pixels, y is metres of ELEVATION to pixels and
     is exaggerated. Vertical exaggeration is standard practice on a long-section: a
     500 m sewer falls perhaps 3 m, so at true scale the pipe is a horizontal line and
     the whole point is lost. Engineering drawings conventionally use 10:1 and the
     drawing is always annotated with it, which is why the factor is on screen. */
  function geom() {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    /* Padding is not cosmetic here, it reserves space for two overlays that sit ON
       the canvas rather than beside it.

       Bottom clears the playback bar. At 42 the chainage ticks and the axis title
       were drawn underneath it: present in the bitmap, invisible on screen.

       Top clears the three model labels drawn in drawAxes. At 16 the ground line ran
       straight through them at the upstream end, where ground level is highest and
       the label block is widest, so both became hard to read. */
    const pad = { l: 62, r: 16, t: 52, b: 74 };
    const iw = Math.max(10, W - pad.l - pad.r), ih = Math.max(10, H - pad.t - pad.b);
    const total = st.ch.length ? st.ch[st.ch.length - 1] : 1;

    // Vertical range covers ground down to the lowest pipe invert, with headroom for
    // a spill plume above the lid.
    let lo = Infinity, hi = -Infinity;
    for (const i of st.path) {
      const c = st.g.cover[i], v = st.g.inv[i];
      if (isFinite(c) && c > hi) hi = c;
      if (isFinite(v) && v < lo) lo = v;
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    const span = Math.max(hi - lo, 0.5);
    lo -= span * 0.12; hi += span * 0.18;

    const sx = (iw / total) * st.zoom;
    // The exaggeration multiplies the natural fit, so "10x" means ten times true
    // scale relative to the horizontal, which is what the convention means.
    const trueScale = sx;                       // px per metre horizontally
    const sy = Math.min(trueScale * st.exagg, ih / (hi - lo));
    const yMid = (hi + lo) / 2;

    return {
      pad, W, H, iw, ih, total, lo, hi, sx, sy, yMid,
      X: m => pad.l + (m * sx) - st.pan,
      Y: z => pad.t + ih / 2 - (z - yMid) * sy,
    };
  }

  function draw() {
    const ctx = st.ctx, dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COL.sky; ctx.fillRect(0, 0, W, H);

    if (!st.g || st.path.length < 2) {
      ctx.fillStyle = COL.inkFaint;
      ctx.font = "13px ui-sans-serif,system-ui,Segoe UI,Roboto,Arial";
      ctx.textAlign = "center";
      ctx.fillText("Click a chamber on the map to cut a long-section through it.",
                   W / 2, H / 2);
      return;
    }

    const G = geom();
    drawGrid(ctx, G);
    drawGround(ctx, G);
    drawPipes(ctx, G);
    drawWater(ctx, G);
    drawShafts(ctx, G);
    drawMarkers(ctx, G);
    drawAxes(ctx, G);
  }

  function drawGrid(ctx, G) {
    ctx.save();
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    const stepZ = niceStep((G.hi - G.lo) / 6);
    for (let z = Math.ceil(G.lo / stepZ) * stepZ; z <= G.hi; z += stepZ) {
      const y = Math.round(G.Y(z)) + 0.5;
      ctx.beginPath(); ctx.moveTo(G.pad.l, y); ctx.lineTo(G.W - G.pad.r, y); ctx.stroke();
    }
    const stepM = niceStep(G.total / 8);
    for (let m = 0; m <= G.total; m += stepM) {
      const x = Math.round(G.X(m)) + 0.5;
      if (x < G.pad.l || x > G.W - G.pad.r) continue;
      ctx.beginPath(); ctx.moveTo(x, G.pad.t); ctx.lineTo(x, G.H - G.pad.b); ctx.stroke();
    }
    ctx.restore();
  }

  /* Ground surface. Cover level is the top of the manhole, which is finished surface
     level, so the line through the cover levels IS the ground line. Between chambers
     it is interpolated, and that interpolation is a straight line because nothing in
     the data says otherwise: there is no terrain model along the pipe, only spot
     heights at the chambers. The fill below it is decoration, the line is the datum. */
  function drawGround(ctx, G) {
    const pts = [];
    for (let i = 0; i < st.path.length; i++) {
      const c = st.g.cover[st.path[i]];
      if (!isFinite(c) || c <= 0) continue;
      pts.push([G.X(st.ch[i]), G.Y(c)]);
    }
    if (pts.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(pts[pts.length - 1][0], G.H);
    ctx.lineTo(pts[0][0], G.H);
    ctx.closePath();
    ctx.fillStyle = COL.earth; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.strokeStyle = COL.ground; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }

  /* Pipe barrels. Each reach is drawn between its two chambers as the band from the
     invert (pipe floor) up to the soffit (pipe crown), which is invert + diameter.
     Real diameter, optionally exaggerated, and the exaggeration is on screen: a
     150 mm pipe over a 300 m reach is a third of a pixel tall at true scale. */
  function drawPipes(ctx, G) {
    for (let i = 0; i < st.pe.length; i++) {
      const u = st.path[i], v = st.path[i + 1];
      const D = reachDia(st.g, st.pe[i], u, v) * st.boreScale;
      const x0 = G.X(st.ch[i]), x1 = G.X(st.ch[i + 1]);
      const iu = st.g.inv[u], iv = st.g.inv[v];
      ctx.beginPath();
      ctx.moveTo(x0, G.Y(iu)); ctx.lineTo(x1, G.Y(iv));
      ctx.lineTo(x1, G.Y(iv + D)); ctx.lineTo(x0, G.Y(iu + D));
      ctx.closePath();
      ctx.fillStyle = COL.pipeFill; ctx.fill();
      ctx.strokeStyle = COL.pipe; ctx.lineWidth = 1.2; ctx.stroke();
    }
  }

  /* The water.

     In a reach, the surface is drawn between the water level at each end. Where that
     level comes from is the whole difference between the two models:

       manning  level = invert + (d/D) x D at each end, so the surface is parallel to
                the invert. It CANNOT slope differently from the pipe, which is what
                "uniform flow" means, and is exactly why it cannot show backwater.

       swmm     level is the head SWMM solved at each chamber. It can be flat while
                the invert falls, it can rise above the soffit, and it can climb the
                shaft. That is backwater, surcharge and spill, drawn directly.

     Above the soffit the reach is running full and under pressure. It is filled in
     the surcharge colour rather than the water colour, because "full" and "under
     pressure" are different conditions and a sensor distinguishes them. */
  function drawWater(ctx, G) {
    if (!st.nodeLevel) return;
    for (let i = 0; i < st.pe.length; i++) {
      const u = st.path[i], v = st.path[i + 1];
      const D = reachDia(st.g, st.pe[i], u, v) * st.boreScale;
      const iu = st.g.inv[u], iv = st.g.inv[v];
      let wu = st.nodeLevel[i], wv = st.nodeLevel[i + 1];
      if (!(isFinite(wu) && isFinite(wv))) continue;
      // Water cannot be below the pipe floor, and for drawing it is capped at the
      // soffit: anything above that is pressure, shown in the shaft, not a deeper
      // stream. Drawing it higher inside the barrel would be a picture of something
      // that does not happen.
      wu = Math.min(Math.max(wu, iu), iu + D);
      wv = Math.min(Math.max(wv, iv), iv + D);
      if (wu <= iu + 1e-6 && wv <= iv + 1e-6) continue;

      const x0 = G.X(st.ch[i]), x1 = G.X(st.ch[i + 1]);
      const full = (wu >= iu + D - 1e-6) && (wv >= iv + D - 1e-6);
      ctx.beginPath();
      ctx.moveTo(x0, G.Y(iu)); ctx.lineTo(x1, G.Y(iv));
      ctx.lineTo(x1, G.Y(wv)); ctx.lineTo(x0, G.Y(wu));
      ctx.closePath();
      ctx.fillStyle = full ? COL.surcharge : COL.water;
      ctx.globalAlpha = full ? 0.55 : 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (!full) {
        ctx.beginPath();
        ctx.moveTo(x0, G.Y(wu)); ctx.lineTo(x1, G.Y(wv));
        ctx.strokeStyle = COL.waterTop; ctx.lineWidth = 1.4; ctx.stroke();
      }
    }
  }

  /* Manhole shafts. Drawn after the pipes so the chamber reads as a chamber the pipe
     enters, and with the water level inside it. The shaft is where surcharge becomes
     legible: the level in the barrel can only reach the soffit, but the level in the
     shaft keeps climbing, and when it reaches the lid that is an overflow. */
  function drawShafts(ctx, G) {
    const w = Math.max(4, Math.min(16, 7 * st.zoom));
    for (let i = 0; i < st.path.length; i++) {
      const nd = st.path[i];
      const x = G.X(st.ch[i]);
      const inv = st.g.inv[nd], cov = st.g.cover[nd];
      if (!isFinite(cov) || cov <= inv) continue;
      const yTop = G.Y(cov), yBot = G.Y(inv);

      ctx.fillStyle = COL.shaftIn;
      ctx.fillRect(x - w / 2, yTop, w, yBot - yTop);

      const lvl = st.nodeLevel ? st.nodeLevel[i] : null;
      if (lvl != null && isFinite(lvl) && lvl > inv) {
        const yW = G.Y(Math.min(lvl, cov));
        const spilling = st.spill && st.spill[i];
        ctx.fillStyle = (lvl >= cov - 1e-3 || spilling) ? COL.surcharge : COL.water;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x - w / 2, yW, w, yBot - yW);
        ctx.globalAlpha = 1;
      }

      ctx.strokeStyle = st.g.candidate[nd] ? COL.shaft : "#2a3550";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(Math.round(x - w / 2) + 0.5, Math.round(yTop) + 0.5,
                     Math.round(w), Math.round(yBot - yTop));
      // The lid.
      ctx.strokeStyle = COL.lid; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - w / 2 - 2, Math.round(yTop) + 0.5);
      ctx.lineTo(x + w / 2 + 2, Math.round(yTop) + 0.5);
      ctx.stroke();
    }
  }

  function drawMarkers(ctx, G) {
    const w = Math.max(4, Math.min(16, 7 * st.zoom));
    for (let i = 0; i < st.path.length; i++) {
      const nd = st.path[i], x = G.X(st.ch[i]);
      const cov = st.g.cover[nd];
      const yTop = isFinite(cov) ? G.Y(cov) : G.Y(st.g.inv[nd]);

      if (st.spill && st.spill[i]) {
        // A spill at the rim. Drawn as an arc above the lid: this is the event the
        // whole project exists to catch, so it is the loudest thing on the drawing.
        ctx.strokeStyle = COL.spill; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, yTop - 3, w * 0.7, Math.PI, 0);
        ctx.stroke();
        ctx.fillStyle = COL.spill;
        ctx.beginPath(); ctx.arc(x, yTop - 9, 2.6, 0, Math.PI * 2); ctx.fill();
      }
      if (st.sensors.has(nd)) {
        ctx.fillStyle = COL.sensor;
        ctx.beginPath(); ctx.arc(x, yTop - 16, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = COL.sensor; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(x, yTop - 12); ctx.lineTo(x, yTop - 1); ctx.stroke();
      }
      if (nd === st.selected || nd === st.hover) {
        ctx.strokeStyle = COL.sel; ctx.lineWidth = 1.6;
        ctx.strokeRect(Math.round(x - w / 2 - 3) + 0.5, Math.round(yTop - 4) + 0.5,
                       Math.round(w + 6), Math.round(G.Y(st.g.inv[nd]) - yTop + 8));
      }
    }
  }

  function drawAxes(ctx, G) {
    ctx.save();
    ctx.font = "10.5px ui-monospace,Menlo,Consolas,monospace";
    ctx.fillStyle = COL.inkFaint;

    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    const stepZ = niceStep((G.hi - G.lo) / 6);
    for (let z = Math.ceil(G.lo / stepZ) * stepZ; z <= G.hi; z += stepZ) {
      ctx.fillText(z.toFixed(1), G.pad.l - 7, G.Y(z));
    }
    ctx.save();
    ctx.translate(13, G.pad.t + G.ih / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center"; ctx.fillStyle = COL.ink;
    ctx.fillText("elevation, m AHD", 0, 0);
    ctx.restore();

    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillStyle = COL.inkFaint;
    const stepM = niceStep(G.total / 8);
    for (let m = 0; m <= G.total; m += stepM) {
      const x = G.X(m);
      if (x < G.pad.l || x > G.W - G.pad.r) continue;
      ctx.fillText(String(Math.round(m)), x, G.H - G.pad.b + 6);
    }
    ctx.fillStyle = COL.ink;
    // Inside the padding, not at the very bottom: the playback bar overlays the
    // canvas and would swallow it.
    ctx.fillText("chainage along sewer, m", G.pad.l + G.iw / 2, G.H - G.pad.b + 26);

    // The exaggeration and the model, always on the drawing. A long-section without
    // its vertical exaggeration stated is a misleading drawing, and a water level
    // without its model named is a misleading number.
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillStyle = COL.inkFaint;
    /* In the reserved band ABOVE the plot, not inside it. Drawn at pad.t these ran
       through the ground line and the top elevation tick at the upstream end, where
       ground level is highest, and both became hard to read. */
    ctx.fillText(`vertical exaggeration ${st.exagg.toFixed(0)}x` +
                 (st.boreScale !== 1 ? `, bore ${st.boreScale.toFixed(1)}x` : ""),
                 G.pad.l + 4, 5);
    if (st.label) {
      ctx.fillStyle = st.source === "swmm" ? "#6fb5f5" : "#fbbf24";
      ctx.fillText(st.label, G.pad.l + 4, 19);
    }
    if (st.subLabel) {
      ctx.fillStyle = COL.inkFaint;
      ctx.fillText(st.subLabel, G.pad.l + 4, 33);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------- interaction */
  function pickAt(px) {
    if (!st.path.length) return -1;
    const G = geom();
    let best = -1, bd = Infinity;
    for (let i = 0; i < st.path.length; i++) {
      const d = Math.abs(G.X(st.ch[i]) - px);
      if (d < bd) { bd = d; best = i; }
    }
    return bd < 14 ? best : -1;
  }

  canvas.addEventListener("mousemove", e => {
    const r = canvas.getBoundingClientRect();
    const k = pickAt(e.clientX - r.left);
    const nd = k >= 0 ? st.path[k] : -1;
    if (nd !== st.hover) { st.hover = nd; draw(); }
    if (st.onHover) st.onHover(nd, k);
  });
  canvas.addEventListener("mouseleave", () => {
    if (st.hover >= 0) { st.hover = -1; draw(); }
    if (st.onHover) st.onHover(-1, -1);
  });
  canvas.addEventListener("click", e => {
    const r = canvas.getBoundingClientRect();
    const k = pickAt(e.clientX - r.left);
    if (k >= 0 && st.onPick) st.onPick(st.path[k]);
  });
  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left;
    const before = (px + st.pan - 62) / st.zoom;
    st.zoom = Math.max(1, Math.min(40, st.zoom * Math.exp(-e.deltaY * 0.0014)));
    st.pan = before * st.zoom - px + 62;
    clampPan(); draw();
  }, { passive: false });

  let dragging = false, lastX = 0;
  canvas.addEventListener("mousedown", e => { dragging = true; lastX = e.clientX; });
  window.addEventListener("mouseup", () => { dragging = false; });
  window.addEventListener("mousemove", e => {
    if (!dragging) return;
    st.pan -= (e.clientX - lastX); lastX = e.clientX;
    clampPan(); draw();
  });

  function clampPan() {
    const G = geom();
    const wide = G.total * G.sx;
    st.pan = Math.max(0, Math.min(Math.max(0, wide - G.iw), st.pan));
  }

  return { st, draw, geom, tracePath, pathEdges, chainage };
}

/* Reach diameter. Same proxy as osp_capacity.js, min of the two ends, so the two
   views cannot disagree about how big a pipe is. Assumption B2. */
function reachDia(g, e, u, v) {
  const d = Math.min(g.dia[u], g.dia[v]);
  return d > 0 ? d : 0.15;
}

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

/* ------------------------------------------------------ water levels, manning */
/* Convert the steady capacity solution into a water ELEVATION at each path node, so
   the renderer takes one kind of input regardless of which model produced it.

   The level at a node is taken from the reach ARRIVING at it, because that is the
   reach whose normal depth the chamber sees. The head node of the path has no
   arriving reach on the path, so it borrows the reach leaving it. Where the reach is
   surcharged the steady model has no answer above full bore, so the level is pinned
   at the soffit and the shaft is left dry: Manning genuinely does not know how high
   the water would go, and inventing a shaft level here would be fabricating the very
   thing SWMM is here to supply. */
function manningLevels(g, path, pe, ratio) {
  const lvl = new Array(path.length).fill(NaN);
  for (let i = 0; i < path.length; i++) {
    const e = i > 0 ? pe[i - 1] : (pe.length ? pe[0] : -1);
    if (e < 0 || !ratio) continue;
    const u = g.edges[e][0], v = g.edges[e][1];
    const D = reachDia(g, e, u, v);
    const r = Math.max(0, Math.min(1, ratio[e] || 0));
    lvl[i] = g.inv[path[i]] + r * D;
  }
  return lvl;
}

/* ---------------------------------------------------------- water levels, swmm */
/* data/osp_swmm.js ships each scenario as base64 uint8 grids, [step][node] and
   [step][reach] flattened row-major. Unpacking is done once per scenario load, not
   per frame, and the result is kept as typed arrays so playback is a slice rather
   than a decode. */
function decodeGrid(b64, rows, cols) {
  const bin = atob(b64);
  if (bin.length !== rows * cols) {
    throw new Error(`SWMM grid is ${bin.length} bytes, expected ${rows * cols}. ` +
                    "The data file and the network are out of step: rebuild it with " +
                    "tools/build_swmm.py.");
  }
  const out = new Uint8Array(rows * cols);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function loadScenario(data, key) {
  const sc = data.scenarios[key];
  if (!sc) throw new Error(`no SWMM scenario "${key}" in the data file`);
  const nN = data.nNodes, nE = data.nEdges, T = sc.steps;
  return {
    key, label: sc.label, note: sc.note, perNode: sc.perNode, rain: sc.rain,
    t: sc.t, steps: T, nNodes: nN, nEdges: nE,
    qMax: sc.qMax, floodMax: sc.floodMax,
    surchargedCount: sc.surchargedCount, floodedCount: sc.floodedCount,
    everSurcharged: sc.everSurcharged,
    nodeDepth: decodeGrid(sc.nodeDepth, T, nN),
    linkFill: decodeGrid(sc.linkFill, T, nE),
    linkQ: decodeGrid(sc.linkQ, T, nE),
    nodeFlood: decodeGrid(sc.nodeFlood, T, nN),
  };
}

/* Water elevation at each path node, and whether it is spilling, at one time step.

   SWMM reports node depth measured up from the node invert, which we quantised as a
   fraction of that node's full depth (cover minus invert). So the elevation is
   invert + ratio x (cover - invert), and a ratio of 1 means the water is at the lid.
   Flooding is reported separately rather than inferred from the ratio, because a
   node can sit exactly at its lid without spilling, and the distinction between
   "as full as it can be" and "coming out of the lid" is the one that matters. */
function swmmLevels(g, path, scn, step) {
  const off = step * scn.nNodes;
  const lvl = new Array(path.length);
  const spill = new Array(path.length);
  for (let i = 0; i < path.length; i++) {
    const nd = path[i];
    const inv = g.inv[nd], cov = g.cover[nd];
    const full = (isFinite(cov) && cov > inv) ? cov - inv : 0;
    const r = scn.nodeDepth[off + nd] / 255;
    lvl[i] = inv + r * full;
    spill[i] = scn.nodeFlood[off + nd] > 0 ? 1 : 0;
  }
  return { lvl, spill };
}

/* Per-reach flow at one step, L/s, for the readout. Dequantised against the
   scenario's own peak, which is why qMax travels with the grid. */
function swmmFlow(scn, step, e) {
  return (scn.linkQ[step * scn.nEdges + e] / 255) * scn.qMax;
}

return { makeView, tracePath, pathEdges, chainage, manningLevels,
         decodeGrid, loadScenario, swmmLevels, swmmFlow,
         reachDia, niceStep, COL };
});
