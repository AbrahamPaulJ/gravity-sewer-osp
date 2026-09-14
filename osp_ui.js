/* OSP sandbox UI: state, canvas renderer, controls, custom-algorithm worker.
   All modelling lives in osp_core.js; all prose lives in osp_docs.js. */
"use strict";

const $ = id => document.getElementById(id);
const C = window.OSPCore;
const PAYLOAD = window.OSP_DATA || {};
const DATA = PAYLOAD.regions || {};
const VALID = PAYLOAD.validation || {};
const META = PAYLOAD.meta || {};
const CODES = PAYLOAD.codes || {};
const REGION_KEYS = Object.keys(DATA);

const S = {
  region: REGION_KEYS[0],
  mode: "network",
  model: "headroom",
  c: 0.7, drop: 1.0, threshold: 0.05, useOrg: false, starveFrac: 0,
  budget: 40, objective: "nodes", algo: "greedy",
  kup: 2, kdown: 2,
  colourBy: "coverage",
  perNodeLoad: 0.05, peakFactor: 1,
  riskBlend: "blend", riskAgg: "intensity",
  growthPoints: [], addedLoad: 2,
  anchor: null, sensors: [], covered: null, lastResult: null,
  view: "2d", exaggeration: 30,
};

let G = null;
const graphCache = {};
const escapeHtml = s => String(s).replace(/[&<>"]/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtM = m => m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m";

function buildGraph(key) {
  if (graphCache[key]) return graphCache[key];
  const g = C.buildGraph(DATA[key]);
  // Uniform grid over node coordinates, for nearest-node picking on the canvas.
  const b = g.bounds, cell = 40;
  const gw = Math.max(1, Math.ceil((b.maxx - b.minx) / cell));
  const gh = Math.max(1, Math.ceil((b.maxy - b.miny) / cell));
  const buckets = new Map();
  for (let i = 0; i < g.n; i++) {
    const cx = Math.min(gw - 1, Math.floor((g.x[i] - b.minx) / cell));
    const cy = Math.min(gh - 1, Math.floor((g.y[i] - b.miny) / cell));
    const k = cy * gw + cx;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(i);
  }
  g.grid = { cell, gw, gh, buckets, minx: b.minx, miny: b.miny };
  graphCache[key] = g;
  return g;
}

/* ------------------------------------------------- custom algorithm worker */
const WORKER_SRC = `
self.onmessage = function(e){
  var d = e.data;
  try {
    var n = d.n, outPtr = d.outPtr, outIdx = d.outIdx,
        obsPtr = d.obsPtr, obsIdx = d.obsIdx, lenIn = d.lenIn;
    var nodes = [];
    for (var i=0;i<n;i++) nodes.push({id:i, x:d.x[i], y:d.y[i], invert:d.inv[i],
                                      cover:d.cover[i], depth:d.cover[i]-d.inv[i],
                                      isChamber: d.cand[i]===1,
                                      weight: d.w ? d.w[i] : 1});
    // reverse index so a chamber can be asked what arrives at it
    var inEdges = [];
    for (var i=0;i<n;i++) inEdges.push([]);
    if (d.edges) for (var e=0;e<d.edges.length;e++) inEdges[d.edges[e][1]].push(e);
    var edges = [];
    for (var v=0; v<n; v++)
      for (var p=outPtr[v]; p<outPtr[v+1]; p++) edges.push([v, outIdx[p]]);
    var api = {
      downstream: function(id){
        var seen = new Set(), st=[id], out=[];
        while(st.length){
          var v = st.pop();
          for (var p=outPtr[v]; p<outPtr[v+1]; p++){
            var w = outIdx[p];
            if (!seen.has(w)){ seen.add(w); out.push(w); st.push(w); }
          }
        }
        return out;
      },
      observableFrom: function(id){
        return Array.prototype.slice.call(obsIdx.subarray(obsPtr[id], obsPtr[id+1]));
      },
      pipeLength: function(id){ return lenIn[id]; },
      /* What the objective currently says this chamber is worth. 1 everywhere
         under "maximise nodes", so an algorithm written against it degrades to
         the unweighted version rather than breaking. */
      weight: function(id){ return d.w ? d.w[id] : 1; },
      /* The pipes arriving at a chamber, with the publisher's own attributes.
         Empty where the region carries none, so test before relying on them. */
      pipesInto: function(id){
        return inEdges[id].map(function(e){
          return { edge:e, from:d.edges[e][0], length:d.lengths[e],
                   diameter: d.pdia ? d.pdia[e] : null,
                   material: d.pmat && d.pmat[e]>=0 ? d.mats[d.pmat[e]] : null,
                   year: d.pyear && d.pyear[e] ? d.pyear[e] : null,
                   gradient: d.pgrade && d.pgrade[e] ? d.pgrade[e] : null };
        });
      },
      candidates: function(){
        var out=[]; for (var i=0;i<n;i++) if (d.cand[i]===1) out.push(i); return out;
      }
    };
    var graph = {nodes:nodes, edges:edges, n:n};
    var fn = new Function('graph','budget','api', d.code + '\\nreturn place(graph,budget,api);');
    var res = fn(graph, d.budget, api);
    if (!Array.isArray(res)) throw new Error('place() must return an array of node ids, got ' + typeof res);
    self.postMessage({ok:true, sensors:res});
  } catch (err) {
    self.postMessage({ok:false, error: String(err && err.stack || err)});
  }
};`;

function runCustom(g, code, budget, weights) {
  return new Promise((resolve, reject) => {
    const P = g.pipes || {};
    const payload = {
      code, budget, n: g.n, x: g.x, y: g.y, inv: g.inv, cover: g.cover, cand: g.candidate,
      outPtr: g.outPtr, outIdx: g.outIdx,
      obsPtr: g.obs.ptr, obsIdx: g.obs.idx, lenIn: g.lenIn,
      edges: g.edges, lengths: g.lengths, w: weights || null,
      pdia: P.dia || null, pmat: P.mat || null, pyear: P.year || null, pgrade: P.grade || null,
      mats: CODES.mat || [],
    };
    let worker = null, timer = null;
    try {
      const blob = new Blob([WORKER_SRC], { type: "application/javascript" });
      worker = new Worker(URL.createObjectURL(blob));
    } catch (e) { worker = null; }

    if (!worker) {
      // Fallback: same contract, no hang guard.
      try {
        const nodes = [];
        for (let i = 0; i < g.n; i++)
          nodes.push({ id: i, x: g.x[i], y: g.y[i], invert: g.inv[i], cover: g.cover[i],
                       depth: g.cover[i] - g.inv[i], isChamber: g.candidate[i] === 1,
                       weight: weights ? weights[i] : 1 });
        const api = {
          downstream: id => {
            const seen = new Set(), st = [id], out = [];
            while (st.length) {
              const v = st.pop();
              for (let p = g.outPtr[v]; p < g.outPtr[v + 1]; p++) {
                const w = g.outIdx[p];
                if (!seen.has(w)) { seen.add(w); out.push(w); st.push(w); }
              }
            }
            return out;
          },
          observableFrom: id => Array.from(C.obsOf(g, id)),
          pipeLength: id => g.lenIn[id],
          weight: id => weights ? weights[id] : 1,
          pipesInto: id => {
            const P = g.pipes, out = [];
            for (let e = 0; e < g.edges.length; e++) {
              if (g.edges[e][1] !== id) continue;
              out.push({ edge: e, from: g.edges[e][0], length: g.lengths[e],
                diameter: P ? P.dia[e] : null,
                material: P && P.mat[e] >= 0 ? (CODES.mat || [])[P.mat[e]] : null,
                year: P && P.year[e] ? P.year[e] : null,
                gradient: P && P.grade[e] ? P.grade[e] : null });
            }
            return out;
          },
          candidates: () => { const o = []; for (let i = 0; i < g.n; i++) if (g.candidate[i]) o.push(i); return o; },
        };
        const fn = new Function("graph", "budget", "api", code + "\nreturn place(graph,budget,api);");
        const res = fn({ nodes, edges: g.edges, n: g.n }, budget, api);
        if (!Array.isArray(res)) throw new Error("place() must return an array of node ids");
        resolve({ sensors: res, fallback: true });
      } catch (err) { reject(err); }
      return;
    }

    timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Timed out after 8s. The worker was terminated, so the page is fine.\nCheck for a loop that never exits."));
    }, 8000);
    worker.onmessage = e => {
      clearTimeout(timer); worker.terminate();
      e.data.ok ? resolve({ sensors: e.data.sensors }) : reject(new Error(e.data.error));
    };
    worker.onerror = e => {
      clearTimeout(timer); worker.terminate();
      reject(new Error(e.message || "Worker error"));
    };
    worker.postMessage(payload);
  });
}

const DEFAULT_CODE = `// Return an array of node ids. Beat greedy if you can.
// api.candidates()      chambers you are allowed to use
// api.observableFrom(id) what a sensor there would see
// api.weight(id)        what the active objective says a chamber is worth
// api.pipesInto(id)     the pipes arriving: diameter, material, year, gradient
function place(graph, budget, api) {
  const scored = api.candidates().map(id => {
    let val = 0;
    for (const v of api.observableFrom(id)) val += api.weight(v);
    return { id: id, val: val };
  });
  scored.sort((a, b) => b.val - a.val);
  return scored.slice(0, budget).map(s => s.id);
}`;

/* --------------------------------------------------------------- renderer */
const cv = $("map"), ctx = cv.getContext("2d");
const view = { scale: 1, ox: 0, oy: 0 };
const dpr = Math.min(2, window.devicePixelRatio || 1);

function resize() {
  const r = cv.getBoundingClientRect();
  if (r.width && r.height) {
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    draw();
  }
  if (S.view !== "2d") window.OSP3D.resize($("view3d"));
}

/* Rebuilds the 3D scene from current state, whenever a 3D-showing view (3d or split) is
   active. No-op otherwise, so every state-changing handler can call this unconditionally. */
let threeReady = null;
function render3D(reframe) {
  if (S.view === "2d" || !G) return;
  if (!threeReady) threeReady = window.OSP3D.ensureThree().then(() => window.OSP3D.initScene($("view3d")));
  threeReady.then(() => window.OSP3D.build(G, S, { exaggeration: S.exaggeration, reframe: !!reframe }));
}
function fitView() {
  if (!G) return;
  const r = cv.getBoundingClientRect(), b = G.bounds, pad = 28;
  if (!r.width || !r.height) return;
  const sxs = (r.width - pad * 2) / Math.max(1e-6, b.maxx - b.minx);
  const sys = (r.height - pad * 2) / Math.max(1e-6, b.maxy - b.miny);
  view.scale = Math.min(sxs, sys);
  view.ox = pad - b.minx * view.scale + (r.width - pad * 2 - (b.maxx - b.minx) * view.scale) / 2;
  view.oy = r.height - pad + b.miny * view.scale - (r.height - pad * 2 - (b.maxy - b.miny) * view.scale) / 2;
  draw();
}
const sx = v => v * view.scale + view.ox;
const sy = v => view.oy - v * view.scale;
const wx = p => (p - view.ox) / view.scale;
const wy = p => (view.oy - p) / view.scale;

/* Multi-stop ramps, not a single lerp between two colours: equal steps in value should look
   like genuinely different colours, not a blur through a muddy midpoint. */
const ELEV_STOPS = [[0, [37, 99, 235]], [0.33, [45, 212, 191]], [0.66, [250, 204, 21]], [1, [220, 38, 38]]];
const DEPTH_STOPS = [[0, [186, 230, 253]], [0.5, [59, 130, 246]], [1, [190, 24, 93]]];
/* Capacity ramp. Deliberately calm until it is not: quiet slate through to amber
   only as d/D approaches the design limit, because a reach at 0.3 full is not news.
   Anything actually over capacity is drawn in a separate alarm colour, not from
   this ramp, so it cannot be confused with a merely busy reach. */
const CAP_STOPS = [[0, [51, 65, 85]], [0.5, [56, 189, 248]],
                   [0.75, [250, 204, 21]], [1, [249, 115, 22]]];
/* Diameter ramp. Kept clear of both the coverage blues and the capacity
   amber/red so a glance never confuses "big pipe" with "pipe in trouble". The
   small end stays a readable slate rather than fading out: three quarters of this
   network by length is 150 mm, and a mode that renders three quarters of the map
   as background is not showing you the network. */
const DIA_STOPS = [[0, [100, 116, 139]], [0.5, [45, 212, 191]], [1, [167, 243, 208]]];
let _diaOrder = null, _diaOrderKey = null;
let _pipeW = null, _pipeWKey = null;

/* Line width as pipe diameter, cached per region.

   Width and colour are independent channels, so diameter can ride along with
   whatever a mode is colouring by instead of competing with it: colour carries
   the analysis, width carries the physical fact. That is worth doing by default
   rather than hiding behind a dedicated mode, because "which of these is a trunk
   main" is a question you have while looking at every other view.

   Width goes as sqrt(d), so it tracks flow area rather than bore, and it is
   normalised over the region's own range: this network runs 150 mm to 450 mm and
   would be unreadable at true relative scale. Regions with no pipe data fall back
   to a constant, which is what every view used to do everywhere. */
function pipeWidths(scale) {
  const key = S.region + "|" + scale;
  if (_pipeW && _pipeWKey === key) return _pipeW;
  const m = G.edges.length, w = new Float64Array(m);
  const d = G.pipes && G.pipes.dia;
  if (!d) { w.fill(1.3); _pipeW = w; _pipeWKey = key; return w; }
  let lo = Infinity, hi = -Infinity;
  for (let e = 0; e < m; e++) {
    if (!(d[e] > 0)) continue;
    if (d[e] < lo) lo = d[e]; if (d[e] > hi) hi = d[e];
  }
  const rlo = Math.sqrt(lo), rspan = Math.max(1e-6, Math.sqrt(hi) - rlo);
  for (let e = 0; e < m; e++)
    w[e] = d[e] > 0 ? scale[0] + (scale[1] - scale[0]) * ((Math.sqrt(d[e]) - rlo) / rspan)
                    : scale[0] * 0.8;
  _pipeW = w; _pipeWKey = key;
  return w;
}
/* Likelihood ramp. Quiet through the bulk of the distribution, warming only at the
   top, with the top decile lifted out of the ramp entirely into the alarm red. */
const RISK_STOPS = [[0, [51, 65, 85]], [0.55, [56, 189, 248]], [1, [251, 146, 60]]];
function rampN(t, stops) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
    if (t <= t1) {
      const f = (t - t0) / Math.max(1e-6, t1 - t0);
      return `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * f)},${Math.round(c0[1] + (c1[1] - c0[1]) * f)},${Math.round(c0[2] + (c1[2] - c0[2]) * f)})`;
    }
  }
  const [, c] = stops[stops.length - 1];
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function draw() {
  if (!G || !cv.width) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.scale(dpr, dpr);

  const cov = S.covered, obs = G.obs;

  /* Capacity is a per-EDGE quantity, unlike elevation and depth which are per node,
     so it takes its own pass rather than being squeezed into the node ramp below.
     Reaches over capacity are drawn last and thick, because they are the answer:
     they are where growth causes an overflow, and the whole point of the mode is
     that they should be legible at a glance without hunting. */
  if (S.colourBy === "capacity") {
    const cap = capacityState();
    const gr = growthState();          // null when no growth points are placed
    const tipped = gr ? gr.tippedSet : null;

    /* Three passes so the important thing is never painted over by the
       unimportant: under capacity, then already over, then tipped by growth.
       Tipped is the answer to the question, so it is drawn last,
       thickest, and in a colour used nowhere else on the canvas. */
    for (const pass of [0, 1, 2]) {
      for (let ei = 0; ei < G.edges.length; ei++) {
        const isTipped = tipped ? tipped[ei] === 1 : false;
        const isOver = cap.over[ei] === 1 && !isTipped;
        const lvl = isTipped ? 2 : (isOver ? 1 : 0);
        if (lvl !== pass) continue;
        const t = Math.max(0, Math.min(1, cap.dOverD[ei]));
        const style = lvl === 2 ? "#e879f9" : lvl === 1 ? "#f43f5e" : rampN(t, CAP_STOPS);
        const pl = G.polylines[ei];
        ctx.beginPath();
        ctx.moveTo(sx(pl[0][0]), sy(pl[0][1]));
        for (let k = 1; k < pl.length; k++) ctx.lineTo(sx(pl[k][0]), sy(pl[k][1]));
        ctx.strokeStyle = style;
        ctx.lineWidth = lvl === 2 ? 3.1 : lvl === 1 ? 2.6 : 1.3;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }

    // Where the new development connects.
    const gr2 = Math.max(3, Math.min(8, 4 * Math.sqrt(view.scale)));
    ctx.fillStyle = "#a3e635"; ctx.strokeStyle = "#1a2e05"; ctx.lineWidth = 1.5;
    for (const i of S.growthPoints) {
      ctx.beginPath();
      ctx.arc(sx(G.x[i]), sy(G.y[i]), gr2, 0, 6.284);
      ctx.fill(); ctx.stroke();
    }
    drawSensors();
    return;
  }

  /* Blockage likelihood. Per edge again, and drawn lowest-first so the reaches
     that matter finish on top rather than being overpainted by the quiet ones.

     The top decile gets its own colour and weight rather than sitting at the end
     of the ramp. That is the same rule the capacity view uses: a ramp shows you
     the distribution, a separate alarm colour shows you the answer, and mixing
     the two makes the answer negotiable. */
  if (S.colourBy === "risk" && G.pipes && window.OSPRisk) {
    const rs = riskState();
    if (rs) {
      const a = rs.edge;
      const sorted = Array.from(a).sort((p, q) => p - q);
      const cut = sorted[Math.floor(sorted.length * 0.9)];
      const lo0 = sorted[0], hi0 = sorted[sorted.length - 1];
      const span = Math.max(1e-9, hi0 - lo0);
      const order = Array.from(a.keys()).sort((p, q) => a[p] - a[q]);
      for (const ei of order) {
        const top = a[ei] >= cut;
        const pl = G.polylines[ei];
        ctx.beginPath();
        ctx.moveTo(sx(pl[0][0]), sy(pl[0][1]));
        for (let k = 1; k < pl.length; k++) ctx.lineTo(sx(pl[k][0]), sy(pl[k][1]));
        ctx.strokeStyle = top ? "#f43f5e" : rampN((a[ei] - lo0) / span, RISK_STOPS);
        ctx.lineWidth = top ? 2.8 : 1.3;
        ctx.lineCap = "round";
        ctx.stroke();
      }
      drawSensors();
      return;
    }
  }

  /* Pipe diameter, like capacity, is a per-EDGE attribute and gets its own pass.
     Width carries the value as well as colour, because a pipe's width IS its
     diameter: this is the one attribute with a literal visual encoding, and
     reading it that way makes the trunk skeleton legible without a legend.
     Width goes as sqrt(d) so it tracks flow area rather than bore.

     Drawn smallest first so the trunk lines land on top of the reticulation they
     collect, which is the order they exist in physically. */
  if (S.colourBy === "diameter" && G.pipes) {
    const d = G.pipes.dia;
    let dlo = Infinity, dhi = -Infinity;
    for (let e = 0; e < d.length; e++) {
      if (!(d[e] > 0)) continue;
      if (d[e] < dlo) dlo = d[e]; if (d[e] > dhi) dhi = d[e];
    }
    const rlo = Math.sqrt(dlo), rspan = Math.max(1e-6, Math.sqrt(dhi) - rlo);
    const DW = pipeWidths([1, 4.2]);
    if (_diaOrderKey !== S.region) {
      _diaOrder = Array.from(d.keys()).sort((a, b) => d[a] - d[b]);
      _diaOrderKey = S.region;          // sorted once per region, not per frame
    }
    for (const ei of _diaOrder) {
      const v = d[ei];
      const t = v > 0 ? (Math.sqrt(v) - rlo) / rspan : 0;
      const pl = G.polylines[ei];
      ctx.beginPath();
      ctx.moveTo(sx(pl[0][0]), sy(pl[0][1]));
      for (let k = 1; k < pl.length; k++) ctx.lineTo(sx(pl[k][0]), sy(pl[k][1]));
      ctx.strokeStyle = v > 0 ? rampN(t, DIA_STOPS) : "#3a4257";
      ctx.lineWidth = DW[ei];
      ctx.lineCap = "round";
      ctx.stroke();
    }
    drawSensors();
    return;
  }

  let lo = Infinity, hi = -Infinity;
  const scalar = S.colourBy === "elevation" ? G.inv
               : S.colourBy === "depth" ? null : null;
  let depthArr = null;
  if (S.colourBy === "depth") {
    depthArr = new Float64Array(G.n);
    for (let i = 0; i < G.n; i++) depthArr[i] = G.cover[i] > 0 ? G.cover[i] - G.inv[i] : NaN;
  }
  const field = S.colourBy === "elevation" ? G.inv : depthArr;
  if (field) for (let i = 0; i < G.n; i++) {
    const v = field[i];
    if (!isFinite(v)) continue;
    if (v < lo) lo = v; if (v > hi) hi = v;
  }

  const PW = pipeWidths([0.9, 4.0]);
  const passes = field ? [0] : [0, 1, 2];
  for (const pass of passes) {
    for (let ei = 0; ei < G.edges.length; ei++) {
      const a = G.edges[ei][0], b = G.edges[ei][1];
      let style, width;
      if (field) {
        const v = field[b];
        if (!isFinite(v)) { style = "#3a4257"; width = PW[ei] * 0.8; }
        else {
          const t = (v - lo) / Math.max(1e-6, hi - lo);
          style = rampN(t, S.colourBy === "depth" ? DEPTH_STOPS : ELEV_STOPS);
          width = PW[ei];
        }
      } else {
        const isCov = cov && (cov[a] || cov[b]);
        const isObs = obs.inUniverse[a] || obs.inUniverse[b];
        const lvl = isCov ? 2 : (isObs ? 1 : 0);
        if (lvl !== pass) continue;
        style = lvl === 2 ? "#38bdf8" : lvl === 1 ? "#1d4ed8" : "#2b3a55";
        /* Colour already separates the three coverage levels, so width is free to
           carry diameter. The small taper on uncovered pipe keeps the background
           from crowding the result without losing the trunk lines in it. */
        width = PW[ei] * (lvl === 2 ? 1 : lvl === 1 ? 0.85 : 0.65);
      }
      const pl = G.polylines[ei];
      ctx.beginPath();
      ctx.moveTo(sx(pl[0][0]), sy(pl[0][1]));
      for (let k = 1; k < pl.length; k++) ctx.lineTo(sx(pl[k][0]), sy(pl[k][1]));
      ctx.strokeStyle = style; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.stroke();
    }
  }

  drawSensors();
}

function drawSensors() {
  const r = Math.max(2.5, Math.min(6, 3.2 * Math.sqrt(view.scale)));
  // Sensors are drawn white-cored in capacity mode: the alarm red is taken by
  // over-capacity reaches there, and two different meanings for one colour on the
  // same canvas is how a map starts lying to you.
  const capMode = S.colourBy === "capacity" || S.colourBy === "risk";
  ctx.fillStyle = capMode ? "#f8fafc" : "#f43f5e";
  ctx.strokeStyle = capMode ? "#0f172a" : "#4c0519";
  ctx.lineWidth = capMode ? 1.6 : 1;
  for (const s of S.sensors) {
    if (s == null || s < 0 || s >= G.n) continue;
    ctx.beginPath(); ctx.arc(sx(G.x[s]), sy(G.y[s]), r, 0, 6.284); ctx.fill(); ctx.stroke();
  }
  if (S.anchor != null) {
    ctx.fillStyle = "#fbbf24"; ctx.strokeStyle = "#78350f"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sx(G.x[S.anchor]), sy(G.y[S.anchor]), r + 2.5, 0, 6.284);
    ctx.fill(); ctx.stroke();
  }
}

/* Capacity state, cached on the inputs that change it. Recomputing on every pan
   and zoom would be wasteful: the solver bisects per reach, so this is the one
   part of the draw path worth memoising. */
let _capCache = null, _capKey = null;
function capacityState() {
  const key = [S.region, S.perNodeLoad, S.peakFactor].join("|");
  if (_capCache && _capKey === key) return _capCache;
  _capCache = OSPCapacity.capacityState(G, OSPCore, {
    perNode: S.perNodeLoad, peakFactor: S.peakFactor, matCodes: CODES.mat,
  });
  _capKey = key;
  updateCapHint(_capCache);
  return _capCache;
}

/* Blockage likelihood, cached on the region and the chosen blend. Same reasoning
   as the capacity cache: the factor pass is cheap but it is on the draw path, and
   nothing about it changes while the map is being panned. */
let _riskCache = null, _riskKey = null;
function riskState() {
  if (!G.pipes || !window.OSPRisk) return null;
  const key = S.region + "|" + S.riskBlend + "|" + S.riskAgg;
  if (_riskCache && _riskKey === key) return _riskCache;
  const solo = S.riskBlend !== "blend";
  const weights = solo
    ? Object.keys(OSPRisk.DEFAULT_WEIGHTS).reduce(
        (o, k) => (o[k] = k === S.riskBlend ? 1 : 0, o), {})
    : null;
  _riskCache = OSPRisk.likelihood(G, {
    matCodes: CODES.mat, jointCodes: CODES.joint,
    weights: weights || undefined, aggregate: S.riskAgg,
  });
  _riskKey = key;
  updateRiskHint(_riskCache);
  return _riskCache;
}

function updateRiskHint(r) {
  const el = $("risk-hint");
  if (!el) return;
  const p = r.summary.published, m = r.summary.edges;
  const solo = S.riskBlend !== "blend";
  el.innerHTML = solo
    ? `One factor only, which is how you see what the blend is doing. Compare the map
       against the blended view: where they disagree, the weighting is deciding the answer,
       not the data.`
    : `Weights are <b>declared, not calibrated</b> &mdash; no public source lists chokes for
       this network, so this ranks reaches and does not predict them. Age is published on
       ${p.age} of ${m} reaches, joint type on only ${p.joint}. The Assumptions tab carries
       the full weighting and how far each factor moves it.`;
  if (r.summary.aggregate === "exposure") el.innerHTML +=
    `<br><span class="warn">Exposure multiplies by reach length, which spans a far wider range
     than likelihood does, so this ranking sits close to plain pipe length. Switch to intensity
     to see condition on its own.</span>`;
}

/* Growth scenario, cached alongside the base capacity state.
   Returns null when nothing has been placed, so the draw path can skip it. */
let _growthCache = null, _growthKey = null;
function growthState() {
  if (!S.growthPoints.length) return null;
  const key = [S.region, S.perNodeLoad, S.peakFactor, S.addedLoad,
               S.growthPoints.join(",")].join("|");
  if (_growthCache && _growthKey === key) return _growthCache;

  const base = capacityState();
  const additions = {};
  for (const i of S.growthPoints) additions[i] = (additions[i] || 0) + S.addedLoad;
  const g = OSPCapacity.growth(G, OSPCore, base, additions,
    { perNode: S.perNodeLoad, peakFactor: S.peakFactor, matCodes: CODES.mat });

  const tippedSet = new Uint8Array(G.edges.length);
  for (const e of g.tipped) tippedSet[e] = 1;
  g.tippedSet = tippedSet;

  _growthCache = g; _growthKey = key;
  updateGrowthOut(g);
  return g;
}

function clearGrowth() {
  S.growthPoints = [];
  _growthCache = null; _growthKey = null;
  $("growth-count").textContent = "0";
  $("growth-out").innerHTML = "";
  draw();
}

function updateGrowthOut(g) {
  const el = $("growth-out");
  if (!el) return;
  const s = g.summary;
  if (!s.edgesTipped) {
    el.innerHTML = `<div class="warnbox">Adding ${s.addedLoad} L/s tips nothing.
      The network absorbs it. Raise the added load, the peak factor, or connect
      further up a branch that is already close to capacity.</div>`;
    return;
  }
  el.innerHTML =
    `<div class="card bad" style="margin:10px 0 0">
       <div class="big">${s.edgesTipped}</div>
       <div class="bigsub">reaches tip from under capacity to over,
         ${fmtM(s.lengthTipped)} of pipe</div>
       <div class="stat"><span>Added load</span><span>${s.addedLoad} L/s</span></div>
       <div class="stat"><span>Reaches over, before</span><span>${s.edgesOverBefore}</span></div>
       <div class="stat"><span>Reaches over, after</span><span>${s.edgesOverAfter}</span></div>
       <div class="stat"><span>Chambers surcharging</span>
         <span>${s.nodesSurchargedBefore} to ${s.nodesSurchargedAfter}</span></div>
     </div>`;
}

function updateCapHint(cap) {
  const el = $("cap-hint");
  if (!el) return;
  const s = cap.summary;
  const pct = (100 * s.shareOver).toFixed(1);
  el.innerHTML =
    `<b>${s.edgesOver}</b> of ${s.edges} reaches over capacity (${pct}%), ` +
    `<b>${fmtM(s.lengthOver)}</b> of pipe, ${s.nodesSurcharged} chambers surcharging. ` +
    `<span class="warn">Screening estimate only: Manning normal depth, no backwater, ` +
    `not a hydraulic model.</span>` +
    (s.diameterProxied
      ? ` Reach diameter is proxied as the smaller of the two chamber values on
          ${s.diameterProxied} of ${s.edges} reaches; the rest use the published
          per-pipe diameter.`
      : ` Reach diameter is the publisher's own per-pipe value on every reach.`) +
    (s.slopeClamped
      ? ` ${s.slopeClamped} reach(es) had no usable fall and were clamped.` : "");
}

/* pan / zoom / pick */
let dragging = false, lastX = 0, lastY = 0, moved = 0;
cv.addEventListener("mousedown", e => {
  dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; cv.classList.add("dragging");
});
window.addEventListener("mouseup", () => { dragging = false; cv.classList.remove("dragging"); });
window.addEventListener("mousemove", e => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  moved += Math.abs(dx) + Math.abs(dy);
  view.ox += dx; view.oy += dy; lastX = e.clientX; lastY = e.clientY; draw();
});
cv.addEventListener("wheel", e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  const bx = wx(px), by = wy(py);
  view.scale = Math.max(0.02, Math.min(80, view.scale * Math.exp(-e.deltaY * 0.0016)));
  view.ox = px - bx * view.scale; view.oy = py + by * view.scale;
  draw();
}, { passive: false });

function pickNode(px, py) {
  if (!G) return -1;
  const g = G.grid, X = wx(px), Y = wy(py);
  const cx = Math.floor((X - g.minx) / g.cell), cy = Math.floor((Y - g.miny) / g.cell);
  let best = -1, bestD = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const arr = g.buckets.get((cy + dy) * g.gw + (cx + dx));
    if (!arr) continue;
    for (const i of arr) {
      const d = (G.x[i] - X) ** 2 + (G.y[i] - Y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  return Math.sqrt(bestD) * view.scale < 18 ? best : -1;
}

const COVER_SRC = { 0: "unknown", 1: "surveyed", 2: "contour", 3: "transferred" };

/* Pipes entering a chamber, for the hover readout.

   The attributes are per EDGE but the map picks NODES, so until there is a
   pick-a-pipe interaction the honest place to surface them is the chamber they
   arrive at: a blockage at this chamber is a blockage in one of these pipes, and
   their diameter, material and age are what decides which. inPtr/inIdx carry
   upstream node ids rather than edge ids, so the reverse index is built once per
   region. */
let _inEdges = null, _inEdgesKey = null;
function inEdgesOf(i) {
  if (_inEdgesKey !== S.region) {
    _inEdges = Array.from({ length: G.n }, () => []);
    for (let e = 0; e < G.edges.length; e++) _inEdges[G.edges[e][1]].push(e);
    _inEdgesKey = S.region;
  }
  return _inEdges[i];
}

/* Publisher material codes, expanded for the readout. The codes are what the
   register and the glossary use, because they are what the source carries; the
   words are what someone reading a map can act on without a lookup. */
const MAT_LABEL = { VC: "clay", PVCU: "uPVC", RC: "concrete" };

function incomingPipes(i) {
  if (!G.pipes) return "";
  const es = inEdgesOf(i);
  if (!es.length) return '<span style="color:#6f81a3">head of line, no pipe in</span><br>';
  const P = G.pipes, mats = CODES.mat || [];
  const now = new Date().getFullYear();

  /* One field per line, values aligned in a column.

     Four values on a shared line read as a puzzle even when labelled, and they
     wrap unpredictably at narrow widths. Stacking them costs vertical space the
     HUD has and buys a readout that can be scanned down the value column. The
     label is a fixed-width inline-block rather than padded text, so the values
     align regardless of font metrics.

     An unpublished value still prints a dash: visibly absent beats quietly
     missing, which is the whole reason the columns are not collapsed. */
  const row = (k, v) =>
    '<div><span style="color:#6f81a3;display:inline-block;width:66px">' + k
    + ':</span>' + v + "</div>";

  const blocks = es.slice(0, 3).map((e, n) => {
    const mm = P.dia[e] > 0 ? Math.round(P.dia[e] * 1000) + " mm" : "&ndash;";
    const code = P.mat && P.mat[e] >= 0 ? mats[P.mat[e]] : null;
    const mt = code ? (MAT_LABEL[code] || code) : "&ndash;";
    const y = P.year && P.year[e] ? P.year[e] : 0;
    const yr = y ? y + ' <span style="color:#6f81a3">(' + (now - y) + 'y)</span>' : "&ndash;";
    const gr = P.grade && P.grade[e] ? P.grade[e].toFixed(2) + "%" : "&ndash;";
    // A rule between blocks, so several pipes never read as one long list.
    const sep = n ? "border-top:1px solid #22314d;margin-top:4px;padding-top:4px;" : "";
    return '<div style="padding-left:10px;' + sep + '">'
      + row("diameter", mm) + row("material", mt) + row("built", yr) + row("grade", gr)
      + "</div>";
  });
  if (es.length > 3)
    blocks.push('<div style="padding-left:10px">and ' + (es.length - 3) + " more</div>");

  const n = es.length;
  return '<span style="color:#6f81a3">in: ' + n + " pipe" + (n === 1 ? "" : "s")
    + "</span>" + blocks.join("")
    + '<div style="color:#6f81a3;margin-top:3px">small, old, flat = likelier to block</div>';
}

cv.addEventListener("mousemove", e => {
  if (dragging || !G) return;
  const r = cv.getBoundingClientRect();
  const i = pickNode(e.clientX - r.left, e.clientY - r.top);
  const hud = $("hud");
  if (i < 0) { hud.classList.remove("on"); hud.textContent = ""; return; }
  hud.classList.add("on");
  const nObs = G.obs.ptr[i + 1] - G.obs.ptr[i];
  const depth = G.cover[i] > 0 ? (G.cover[i] - G.inv[i]) : null;
  const ceil = G.ceil ? G.ceil[i] : null;
  hud.innerHTML =
    `node ${i}${G.mh[i] ? ' <span style="color:#34d399">chamber</span>' : ' <span style="color:#f87171">no manhole</span>'}<br>` +
    `invert ${G.inv[i].toFixed(2)} m<br>` +
    (depth != null ? `depth ${depth.toFixed(2)} m <span style="color:#6f81a3">(${COVER_SRC[G.coverSrc[i]]})</span><br>` : `depth unknown<br>`) +
    (ceil != null && isFinite(ceil) ? `ceiling ${ceil.toFixed(2)} m, headroom ${(ceil - G.inv[i]).toFixed(2)} m<br>` : "") +
    `observes ${nObs}<br>` +
    incomingPipes(i) +
    (S.covered && S.covered[i] ? '<span style="color:#38bdf8">covered</span>'
      : G.obs.inUniverse[i] ? '<span style="color:#93a4c4">observable</span>'
      : '<span style="color:#64748b">not observable</span>');
});
cv.addEventListener("click", e => {
  if (moved > 4 || !G) return;
  const r = cv.getBoundingClientRect();

  /* In capacity colouring a click places or removes a growth connection, which is
     a different act from choosing a sensor anchor. Any node can take a new
     connection: a development connects to the main, it does not need a chamber
     you could stand a sensor in. */
  if (S.colourBy === "capacity") {
    const j = pickNode(e.clientX - r.left, e.clientY - r.top);
    if (j < 0) return;
    const at = S.growthPoints.indexOf(j);
    if (at >= 0) S.growthPoints.splice(at, 1); else S.growthPoints.push(j);
    _growthCache = null; _growthKey = null;
    $("growth-count").textContent = String(S.growthPoints.length);
    if (!S.growthPoints.length) $("growth-out").innerHTML = "";
    draw();
    return;
  }

  if (S.mode !== "anchor") return;
  const i = pickNode(e.clientX - r.left, e.clientY - r.top);
  if (i < 0) return;
  if (!G.candidate[i]) {
    $("anchor-out").innerHTML = '<div class="warnbox">That node has no published manhole, so a sensor could not physically go there. Pick a chamber.</div>';
    return;
  }
  S.anchor = i; runAnchor();
});

/* ------------------------------------------------------------------- run */
const busy = on => $("busy").classList.toggle("on", on);
const obsOpts = () => ({ model: S.model, c: S.c, drop: S.drop, threshold: S.threshold,
                         useOrg: S.useOrg, starveFrac: S.starveFrac });
function ensureObs() { C.computeObservable(G, obsOpts()); }

async function run() {
  $("run-err").innerHTML = "";
  busy(true);
  await new Promise(r => setTimeout(r, 10));
  try {
    ensureObs();

    /* The overcapacity objective is a per-node weight vector, not a string: 1 on
       chambers the capacity model says surcharge, 0 elsewhere. Everything routes
       through weightOf, so passing this makes every algorithm target overcapacity
       without any of them knowing what overcapacity is. When growth points are
       placed, the chambers growth NEWLY surcharges are the target, because those
       are the ones a future rollout has to catch; otherwise it is the ones already
       surcharging today. */
    let objective = S.objective, marked = null;
    if (S.objective === "risk") {
      /* Expected-blockage exposure per chamber, straight into weightOf. No
         algorithm changes: every one of them scores through that function, so
         handing it a weight vector is the whole integration.

         Reported as a share of total exposure rather than a count, because the
         quantity has no natural unit: it is metres of pipe times a declared
         likelihood, and pretending it is anything more precise than a ranking
         would be the exact overreach osp_risk.js exists to avoid. */
      const rs = riskState();
      if (!rs) throw new Error(
        "This region carries no per-pipe attributes, so blockage likelihood cannot be " +
        "computed. Pick a region with published pipe data, or choose another objective.");
      objective = { w: rs.node };
    }
    if (S.objective === "surcharge") {
      const gr = growthState();
      marked = gr ? gr.after.surcharged : capacityState().surcharged;
      const w = new Float64Array(G.n);
      let anyMarked = 0;
      for (let i = 0; i < G.n; i++) if (marked[i]) { w[i] = 1; anyMarked++; }
      if (!anyMarked) throw new Error(
        "No chamber is surcharging at this load, so there is nothing for the " +
        "overcapacity objective to target. Raise the load per chamber or the peak " +
        "factor under Colour by, or place growth connections.");
      objective = { w };
    }

    const extra = {};
    /* The weight vector the topology heuristics aggregate over. Null under the
       plain node objective, which lets them reuse their cached unweighted results
       and reduce exactly to the counting versions they have always been. */
    const wv = C.isUnweighted(objective) ? null : C.weightVector(G, objective);
    if (wv) extra.weighted = true;

    let sensors = [];
    switch (S.algo) {
      case "greedy": sensors = C.greedy(G, S.budget, objective); break;
      case "upstream": { const u = C.upstreamSize(G, wv); sensors = C.topBy(G, S.budget, i => u[i]); break; }
      case "outdeg": { const d = C.degreeWeight(G, wv, "out"); sensors = C.topBy(G, S.budget, i => d[i]); break; }
      case "indeg": { const d = C.degreeWeight(G, wv, "in"); sensors = C.topBy(G, S.budget, i => d[i]); break; }
      case "between": { const b = C.betweenness(G, wv); sensors = C.topBy(G, S.budget, i => b[i]); break; }
      case "random": { const r = C.randomPlace(G, S.budget, objective); sensors = r.sensors; extra.mean = r.mean; break; }
      case "twoupdown": { const r = C.twoUpTwoDown(G, S.budget, S.kup, S.kdown, objective); sensors = r.sensors; extra.anchors = r.anchors.length; break; }
      case "custom": {
        const r = await runCustom(G, $("code").value, S.budget, wv);
        sensors = r.sensors.filter(v => Number.isInteger(v) && v >= 0 && v < G.n);
        const nonChamber = sensors.filter(v => !G.candidate[v]).length;
        if (nonChamber) extra.nonChamber = nonChamber;
        if (sensors.length > S.budget) { extra.truncated = sensors.length; sensors = sensors.slice(0, S.budget); }
        if (r.fallback) extra.fallback = true;
        break;
      }
    }
    S.sensors = sensors;
    const res = C.score(G, sensors);
    S.covered = res.covered;
    // Coverage of all nodes is not the headline when the objective is overcapacity:
    // "24 of 183 surcharging chambers" is the number that means something.
    if (marked) extra.marked = C.scoreMarked(G, sensors, marked);
    if (S.objective === "risk") {
      const rs = riskState();
      let hit = 0, tot = 0;
      for (let i = 0; i < G.n; i++) { tot += rs.node[i]; if (res.covered[i]) hit += rs.node[i]; }
      extra.risk = { hit, tot, share: tot > 0 ? hit / tot : 0 };
    }
    S.lastResult = { ...res, sensors: sensors.length, extra };
    renderResult(); saveScore(); draw(); render3D();
  } catch (err) {
    $("run-err").innerHTML = `<div class="err">${escapeHtml(err.message || String(err))}</div>`;
  } finally { busy(false); }
}

function runAnchor() {
  ensureObs();
  const a = S.anchor;
  const rule = C.collectUpDown(G, a, S.kup, S.kdown).filter(v => G.candidate[v]);
  const budget = rule.length;
  const free = C.greedy(G, budget, S.objective);
  const forced = C.greedyForced(G, [a], budget, S.objective);
  const rRule = C.score(G, rule), rFree = C.score(G, free), rForced = C.score(G, forced);
  S.sensors = forced; S.covered = rForced.covered;
  const key = S.objective === "length" ? "len" : "nodes";
  const fmt = v => S.objective === "length" ? fmtM(v) : v;
  const pct = v => rFree[key] > 0 ? Math.round(100 * v / rFree[key]) + "%" : "n/a";

  $("anchor-out").innerHTML = `
    <div class="stat"><span>Anchor node</span><span>${a}</span></div>
    <div class="stat"><span>Budget (= rule size, ${S.kup} up / ${S.kdown} down)</span><span>${budget} sensors</span></div>
    <hr>
    <div class="stat"><span style="font-weight:600">Optimiser, anchor forced</span><span style="font-weight:600">${fmt(rForced[key])}</span></div>
    <div class="hint" style="margin-top:-4px;margin-bottom:6px">Shown on the map. Includes the
      anchor, plus the optimiser's best choices for the rest of the budget.</div>
    <div class="stat"><span>Rule covers</span><span>${fmt(rRule[key])}</span></div>
    <div class="stat"><span>Optimiser, free</span><span>${fmt(rFree[key])}</span></div>
    <hr>
    <div class="stat"><span>Forced vs free optimum</span><span style="color:${rForced[key] >= rFree[key] * 0.9 ? "var(--good)" : "var(--warn)"}">${pct(rForced[key])}</span></div>
    <div class="stat"><span>Cost of mandating</span><span>${fmt(rFree[key] - rForced[key])}</span></div>
    <div class="hint" style="margin-top:8px">Free is never drawn, it is only the unconstrained
      baseline. Cost of mandating is what it would gain by not being tied to the anchor.</div>`;
  draw(); render3D();
}

function renderResult() {
  const r = S.lastResult, o = G.obs;
  const e = r.extra || {};

  /* The headline has to be the quantity that was actually optimised. Reporting
     "21% of all observable nodes" after optimising for surcharging chambers would
     understate the result and answer a question nobody asked: most of the network
     is not at risk of overcapacity, and deliberately not covering it is the point. */
  const marked = e.marked;
  const main = e.risk ? 100 * e.risk.share
    : marked ? (marked.total ? 100 * marked.hit / marked.total : 0)
    : S.objective === "length"
      ? (o.universeLen ? 100 * r.len / o.universeLen : 0)
      : (o.universeSize ? 100 * r.nodes / o.universeSize : 0);
  const sub = e.risk
    ? `of the network's blockage exposure observed, using ${r.sensors}
       sensor${r.sensors === 1 ? "" : "s"}`
    : marked
    ? `of the ${marked.total} surcharging chamber${marked.total === 1 ? "" : "s"} observed,
       using ${r.sensors} sensor${r.sensors === 1 ? "" : "s"}`
    : `of the observable ${S.objective === "length" ? "pipe length" : "nodes"} covered,
       using ${r.sensors} sensor${r.sensors === 1 ? "" : "s"}`;

  $("result").innerHTML = `
    <div class="big">${main.toFixed(1)}%</div>
    <div class="bigsub">${sub}</div>
    ${marked ? `<div class="stat"><span>Surcharging chambers seen</span>
      <span>${marked.hit} / ${marked.total}</span></div>` : ""}
    ${e.risk ? `<div class="stat"><span>Blockage exposure covered</span>
      <span>${Math.round(e.risk.hit)} / ${Math.round(e.risk.tot)}</span></div>
      <div class="hint" style="margin-top:2px">Exposure is metres of pipe weighted by a
      <b>declared</b> likelihood, so the share is a ranking statement, not a prediction.</div>` : ""}
    <div class="stat"><span>Nodes covered</span><span>${r.nodes} / ${o.universeSize}</span></div>
    <div class="stat"><span>Length covered</span><span>${fmtM(r.len)} / ${fmtM(o.universeLen)}</span></div>
    ${e.weighted ? `<div class="stat"><span>Objective weighting</span>
      <span style="color:var(--good)">applied</span></div>` : ""}
    <div class="stat"><span>Per sensor</span><span>${r.sensors ? (r.nodes / r.sensors).toFixed(2) : "0"} nodes</span></div>
    <div class="stat"><span>Observable universe</span><span>${o.universeSize} / ${G.n} nodes</span></div>
    <div class="stat"><span>Candidate chambers</span><span>${C.feasible(G).length}</span></div>
    ${e.mean != null ? `<div class="stat"><span>Random mean of 20</span><span>${e.mean.toFixed(1)}</span></div>` : ""}
    ${e.anchors != null ? `<div class="stat"><span>Anchors used</span><span>${e.anchors}</span></div>` : ""}
    ${e.truncated ? `<div class="warnbox">Your function returned ${e.truncated} ids. Only the first
      ${S.budget} were used, to keep the budget fair.</div>` : ""}
    ${e.nonChamber ? `<div class="warnbox">${e.nonChamber} of your ids have no published manhole,
      so a sensor could not physically be installed there.</div>` : ""}
    ${e.fallback ? `<div class="warnbox">Workers are blocked here, so your code ran on the main thread.
      An infinite loop will freeze the tab.</div>` : ""}`;
}

/* ----------------------------------------------------------- leaderboard */
const LB_KEY = "osp_sandbox_leaderboard_v2";
const paramKey = () => [S.region, S.model, S.model === "legacy" ? S.c : S.model === "drop" ? S.drop : S.threshold,
                        S.useOrg ? 1 : 0, S.starveFrac, S.budget, S.objective].join("|");
function loadLB() { try { return JSON.parse(localStorage.getItem(LB_KEY)) || []; } catch (e) { return []; } }
function saveScore() {
  if (!S.lastResult) return;
  const key = S.objective === "length" ? "len" : "nodes";
  const rows = loadLB();
  rows.push({ k: paramKey(), algo: $("algo").options[$("algo").selectedIndex].text,
              v: S.lastResult[key], s: S.lastResult.sensors, t: Date.now() });
  try { localStorage.setItem(LB_KEY, JSON.stringify(rows.slice(-400))); } catch (e) {}
  renderLB();
}
function renderLB() {
  const k = paramKey();
  // Collapse exact repeats (same algorithm, same score) to their most recent run, so ten
  // identical greedy runs cannot crowd twelve distinct algorithms out of the visible list.
  // A genuinely different result under the same settings (random draws, a tweaked custom
  // function) still gets its own row.
  const seen = new Map();
  for (const r of loadLB()) {
    if (r.k !== k) continue;
    const dk = r.algo + "|" + r.v;
    const prev = seen.get(dk);
    if (!prev || r.t > prev.t) seen.set(dk, r);
  }
  const rows = [...seen.values()].sort((a, b) => b.v - a.v).slice(0, 12);
  if (!rows.length) { $("lb").innerHTML = '<div class="empty">No runs yet for this exact setup.</div>'; return; }
  const fmt = v => S.objective === "length" ? fmtM(v) : v;
  const newest = Math.max(...rows.map(r => r.t));
  $("lb").innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
    ${rows.map((r, i) => `<tr style="${r.t === newest ? "color:var(--accent)" : "color:var(--ink-dim)"}">
      <td style="padding:2px 6px 2px 0;color:var(--ink-faint)">${i + 1}</td>
      <td style="padding:2px 0">${escapeHtml(r.algo)}</td>
      <td style="text-align:right;font-family:ui-monospace,Menlo,Consolas,monospace">${fmt(r.v)}</td></tr>`).join("")}
    </table>`;
}

/* ------------------------------------------------------------ UI wiring */
/* Completeness of the per-pipe attributes, reported per region because it varies
   per region: the publisher carries them on the utility layer and may not on the
   statewide one. Percentages come from the dataset, never typed in.

   Material earns its own line. The publisher's MATERIAL field reads UNKN on the
   oldest 456 records, but MATERIALUN carries the value on every one of them and
   the two agree on all 43 records where both are populated, so reading the pair
   takes material from 54.5% to 100% with no assumption. That is worth stating
   where someone can check it against the source. */
function pipeDQ(st) {
  const p = st.pipe_attrs;
  if (!p) return "";
  // A stat the build did not emit reads as "not reported", never as a crash.
  const row = (label, v, extra) => v == null
    ? `<div class="stat"><span>${label}</span><span style="color:var(--ink-faint)">not reported</span></div>`
    : `<div class="stat"><span>${label}</span><span${v < 100 ? ' style="color:var(--warn)"' : ""}>` +
      `${v.toFixed(1)}%${extra || ""}</span></div>`;
  return `<hr>
    ${row("Pipe diameter published", p.diameter_pct)}
    ${row("Material published", p.material_pct)}
    ${p.material_from_fallback ? `<div class="hint" style="margin-top:-2px;margin-bottom:6px">
      ${p.material_from_fallback} of those read <code>UNKN</code> in the primary field and were
      resolved from the publisher's second material field, which agrees with the first on every
      record where both are populated.</div>` : ""}
    ${row("Construction year published", p.const_year_pct)}
    ${row("Gradient published", p.grade_pct)}
    ${row("Internal diameter published", p.internal_dia_pct)}
    ${row("Joint type published", p.jointtype_pct)}
    ${row("Roughness published", p.roughness_pct)}
    <div class="hint" style="margin-top:6px">Roughness is carried as a field but populated on no
      record here, so Manning's n stays a declared constant. Internal diameter is the bore Manning
      actually wants but is published on barely half the records, and mixing it with nominal would
      compute capacity on a different basis for old and new pipe, so nominal is used throughout.</div>`;
}

function setRegion(k) {
  S.region = k; G = buildGraph(k);
  _capCache = null; _capKey = null;      // capacity is per region, never carry it over
  _growthCache = null; _growthKey = null; S.growthPoints = [];
  _diaOrder = null; _diaOrderKey = null;
  _pipeW = null; _pipeWKey = null;
  _riskCache = null; _riskKey = null;

  // Only regions harvested since the pipe-attribute fetch carry per-pipe data, so
  // the mode is offered where it means something and withdrawn where it does not,
  // rather than silently drawing a blank map.
  const hasPipes = !!G.pipes;
  $("opt-diameter").disabled = !hasPipes;
  $("opt-diameter").textContent = hasPipes ? "Pipe diameter" : "Pipe diameter (not published)";
  $("opt-risk").disabled = !hasPipes;
  $("opt-risk").textContent = hasPipes ? "Blockage likelihood" : "Blockage likelihood (no pipe data)";
  $("obj-risk").disabled = !hasPipes;
  if (!hasPipes && (S.colourBy === "diameter" || S.colourBy === "risk")) {
    S.colourBy = "coverage"; $("colourby").value = "coverage";
  }
  if (!hasPipes && S.objective === "risk") {
    S.objective = "nodes"; $("objective").value = "nodes";
  }
  syncColourUI();
  S.sensors = []; S.covered = null; S.anchor = null; S.lastResult = null;
  const st = G.stats;
  const measured = G.role === "measured";
  $("region-badge").innerHTML = measured
    ? '<span class="badge b-measured">measured depth</span>'
    : '<span class="badge b-transferred">transferred depth</span>';
  $("region-note").textContent = G.note || "";

  const ds = C.depthStats(G);
  const legA = VALID.leg_a;
  $("dq").innerHTML = `
    <div class="stat"><span>Pipes</span><span>${st.pipes_used}</span></div>
    <div class="stat"><span>Nodes</span><span>${st.nodes}</span></div>
    <div class="stat"><span>Published manholes</span><span>${st.manholes_published || 0}</span></div>
    <div class="stat"><span>Matched to a node</span><span>${st.manholes_matched || 0}${st.manhole_duplicates_merged ? ` <span style="color:var(--ink-faint)">(${st.manhole_duplicates_merged} dup merged)</span>` : ""}</span></div>
    <div class="stat"><span>Direction from field</span><span>${(st.direction || {}).from_field ?? "n/a"}</span></div>
    <div class="stat"><span>Direction fallback</span><span>${(st.direction || {}).geometry_fallback ?? "n/a"}</span></div>
    <div class="stat"><span>Invert violations</span><span>${st.invert_violations ?? "n/a"}</span></div>
    <div class="stat"><span>Components</span><span>${st.components}</span></div>
    <div class="stat"><span>Directed cycle</span><span>${st.has_cycle ? "yes" : "none"}</span></div>
    <hr>
    <div class="stat"><span>Depth median</span><span>${ds.median != null ? ds.median.toFixed(2) + " m" : "n/a"}</span></div>
    <div class="stat"><span>Depth p10 / p90</span><span>${ds.p10 != null ? ds.p10.toFixed(2) + " / " + ds.p90.toFixed(2) : "n/a"}</span></div>
    <div class="stat"><span>Cover surveyed</span><span>${ds.surveyed}</span></div>
    <div class="stat"><span>Cover from contours</span><span>${ds.contour}</span></div>
    ${ds.transferred ? `<div class="stat"><span>Cover transferred</span><span>${ds.transferred}</span></div>` : ""}
    ${ds.unknown ? `<div class="stat"><span>Cover unusable, discarded</span><span>${ds.unknown}</span></div>` : ""}
    ${pipeDQ(st)}
    <div class="hint" style="margin-top:8px">${measured && legA
      ? `Cover levels are interpolated from the 1 m contour layer. Measured against ${legA.n}
         surveyed covers in this same area the error is ${legA.mean_abs} m mean,
         ${legA.p90_abs} m at the 90th percentile.`
      : `No public surface model covers this area, so depth is a single transferred constant
         (${META.transferred_depth_m} m, Walkerville's measured median). Treat every depth-dependent
         number here as indicative, not measured.`}</div>
    <div class="hint" style="margin-top:6px">${st.components} components means the bounding box or
      council boundary cuts the network into pieces. A real catchment would be one system, so
      anything near an edge is wrong in a known direction.</div>`;

  ensureObs();
  $("result").innerHTML = '<div class="empty">Run a placement to see results.</div>';
  const pool = C.feasible(G).length;
  $("budget").max = Math.max(10, Math.min(400, pool || 50));
  if (S.budget > +$("budget").max) { S.budget = +$("budget").max; $("budget").value = S.budget; }
  fitView(); syncParamUI(); renderLB(); render3D(true);
}

/* One place decides which controls and which legend belong to the active colour
   mode. It was two inline toggles while capacity was the only per-edge mode;
   adding a third made a single owner cheaper than a third set of flags. */
function syncColourUI() {
  const mode = S.colourBy;
  const cap = mode === "capacity", dia = mode === "diameter", risk = mode === "risk";
  $("p-capacity").hidden = !cap;
  $("cap-hint").hidden = !cap;
  $("p-risk").hidden = !risk;
  $("grp-growth").classList.toggle("collapsed", !cap);
  $("legend").hidden = cap || dia || risk;   // the coverage legend means nothing here
  $("legend-cap").hidden = !cap;
  $("legend-dia").hidden = !dia;
  $("legend-risk").hidden = !risk;
  if (risk) riskState();                     // fills the hint on first switch
}

function syncParamUI() {
  $("c-val").textContent = S.c.toFixed(2);
  $("d-val").textContent = S.drop.toFixed(2) + " m";
  $("t-val").textContent = S.threshold.toFixed(2) + " m";
  $("s-val").textContent = S.starveFrac > 0 ? (S.starveFrac * 100).toFixed(0) + "%" : "off";
  $("b-val").textContent = S.budget;
  $("k-val").textContent = `${S.kup} / ${S.kdown}`;
  $("p-headroom").style.display = S.model === "headroom" ? "" : "none";
  $("p-legacy").style.display = S.model === "legacy" ? "" : "none";
  $("p-drop").style.display = S.model === "drop" ? "" : "none";
  $("p-updown").style.display = (S.algo === "twoupdown" || S.mode === "anchor") ? "" : "none";
  $("p-custom").style.display = S.algo === "custom" ? "" : "none";
  $("anchor-grp").style.display = S.mode === "anchor" ? "" : "none";
  $("algo-hint").textContent = ALGO_HINTS[S.algo] || "";
  $("exagg-val").textContent = S.exaggeration + "x";
}

const ALGO_HINTS = {
  greedy: "Repeatedly takes the sensor adding the most new coverage. The benchmark to beat.",
  twoupdown: "A practitioner rule of thumb, scored on the same footing as everything else. " +
             "Anchors come from the candidate pool; the k up and k down chambers are taken as the " +
             "rule dictates, which is where its cost shows up.",
  upstream: "Ranks chambers by how much network drains through them.",
  between: "Brandes betweenness: chambers many flow paths pass through.",
  outdeg: "Wang et al. found out-degree beat in-degree as a simple heuristic.",
  indeg: "Chambers where many pipes converge.",
  random: "Best of 20 random draws from the same candidate pool. The floor any method must beat.",
  custom: "Your own function, run in a sandboxed worker.",
};

function bindRange(id, key, after) {
  $(id).addEventListener("input", e => {
    S[key] = parseFloat(e.target.value);
    syncParamUI();
    if (after) after();
  });
}

function init() {
  if (!REGION_KEYS.length) {
    document.body.innerHTML = '<p style="padding:40px;color:#f87171">osp_data.js has no regions. Run tools/build_demo_data.py.</p>';
    return;
  }
  $("region").innerHTML = REGION_KEYS
    .map(k => `<option value="${k}">${escapeHtml(DATA[k].label)}</option>`).join("");
  $("code").value = DEFAULT_CODE;

  $("region").addEventListener("change", e => setRegion(e.target.value));
  $("model").addEventListener("change", e => { S.model = e.target.value; syncParamUI(); ensureObs(); draw(); render3D(); });
  $("objective").addEventListener("change", e => { S.objective = e.target.value; renderLB(); });
  $("algo").addEventListener("change", e => { S.algo = e.target.value; syncParamUI(); });
  $("colourby").addEventListener("change", e => {
    S.colourBy = e.target.value;
    syncColourUI();
    draw(); render3D();
  });
  $("riskagg").addEventListener("change", e => {
    S.riskAgg = e.target.value;
    _riskCache = null; _riskKey = null;
    draw(); render3D();
  });
  $("riskblend").addEventListener("change", e => {
    S.riskBlend = e.target.value;
    _riskCache = null; _riskKey = null;
    draw(); render3D();
  });
  $("addload").addEventListener("input", e => {
    S.addedLoad = +e.target.value;
    $("addload-val").textContent = S.addedLoad.toFixed(1);
    _growthCache = null; _growthKey = null;
    draw();
  });
  $("growth-clear").addEventListener("click", clearGrowth);
  $("objective").addEventListener("change", () => {
    const sur = S.objective === "surcharge", risk = S.objective === "risk";
    $("obj-hint").hidden = !sur && !risk;
    $("obj-hint").textContent = risk
      ? "Weights coverage by how likely each chamber's incoming pipes are to block, from " +
        "published bore, age, gradient, material and joint type. The weighting is declared, " +
        "not calibrated: see the Assumptions tab."
      : "Targets the chambers that overcapacity actually threatens, taken from the capacity " +
        "model, rather than treating every chamber as an equally likely blockage.";
  });
  $("load").addEventListener("input", e => {
    S.perNodeLoad = +e.target.value;
    $("load-val").textContent = S.perNodeLoad.toFixed(2);
    draw();
  });
  $("peak").addEventListener("input", e => {
    S.peakFactor = +e.target.value;
    $("peak-val").textContent = S.peakFactor.toFixed(1);
    draw();
  });
  $("useorg").addEventListener("change", e => { S.useOrg = e.target.checked; ensureObs(); draw(); render3D(); });
  bindRange("c", "c", () => { ensureObs(); draw(); render3D(); });
  bindRange("drop", "drop", () => { ensureObs(); draw(); render3D(); });
  bindRange("threshold", "threshold", () => { ensureObs(); draw(); render3D(); });
  bindRange("starve", "starveFrac", () => { ensureObs(); draw(); render3D(); });
  bindRange("exagg", "exaggeration", () => render3D());
  bindRange("budget", "budget", renderLB);
  bindRange("kup", "kup");
  bindRange("kdown", "kdown");
  $("run").addEventListener("click", run);

  document.querySelectorAll("#side-scroll .grp > h3").forEach(h => {
    h.addEventListener("click", () => h.parentElement.classList.toggle("collapsed"));
  });

  document.querySelectorAll("#mode-seg button").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#mode-seg button").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      S.mode = b.dataset.mode;
      if (S.mode === "network" && S.anchor != null) {
        S.anchor = null; S.sensors = []; S.covered = null;
        $("anchor-out").innerHTML = "";
        draw(); render3D();
      }
      $("mode-hint").textContent = S.mode === "anchor"
        ? "Click a chamber to treat it as a mandated location; the optimiser is then forced to use it."
        : "Place a budget of sensors across the whole network.";
      syncParamUI();
    });
  });

  document.querySelectorAll("#view-seg button").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#view-seg button").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      S.view = b.dataset.view;
      $("p-3d").style.display = S.view === "2d" ? "none" : "";
      $("pane2d").style.display = S.view === "3d" ? "none" : "";
      $("pane3d").style.display = S.view === "2d" ? "none" : "block";
      resize(); draw();
      if (S.view !== "2d") render3D(true);
    });
  });

  // Tabs are deep-linkable (#assumptions, #qa, ...) so a specific section can be sent to
  // someone, and so each pane can be screenshotted directly when testing.
  function showTab(name) {
    const btn = document.querySelector(`.tabs button[data-tab="${name}"]`);
    if (!btn) return false;
    document.querySelectorAll(".tabs button").forEach(x => x.classList.remove("on"));
    btn.classList.add("on");
    for (const p of document.querySelectorAll(".pane")) p.hidden = true;
    $("pane-" + name).hidden = false;
    if (name === "sandbox") { resize(); fitView(); }
    return true;
  }
  document.querySelectorAll(".tabs button").forEach(b => {
    b.addEventListener("click", () => {
      showTab(b.dataset.tab);
      history.replaceState(null, "", "#" + b.dataset.tab);
    });
  });
  window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
  window.__ospShowTab = showTab;

  window.addEventListener("resize", resize);
  setRegion(REGION_KEYS[0]);
  resize();
  if (location.hash.length > 1) showTab(location.hash.slice(1));
  if (window.OSPDocs) window.OSPDocs.render({ DATA, VALID, META, CODES, C, buildGraph });
}

init();
