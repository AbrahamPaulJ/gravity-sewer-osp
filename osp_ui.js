/* OSP sandbox UI: state, canvas renderer, controls, custom-algorithm worker.
   All modelling lives in osp_core.js; all prose lives in osp_docs.js. */
"use strict";

const $ = id => document.getElementById(id);
const C = window.OSPCore;
const PAYLOAD = window.OSP_DATA || {};
const DATA = PAYLOAD.regions || {};
const VALID = PAYLOAD.validation || {};
const META = PAYLOAD.meta || {};
const REGION_KEYS = Object.keys(DATA);

const S = {
  region: REGION_KEYS[0],
  mode: "network",
  model: "headroom",
  c: 0.7, drop: 1.0, threshold: 0.05, useOrg: false, starveFrac: 0,
  budget: 40, objective: "nodes", algo: "greedy",
  kup: 2, kdown: 2,
  colourBy: "coverage",
  anchor: null, sensors: [], covered: null, lastResult: null,
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
                                      isChamber: d.cand[i]===1});
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

function runCustom(g, code, budget) {
  return new Promise((resolve, reject) => {
    const payload = {
      code, budget, n: g.n, x: g.x, y: g.y, inv: g.inv, cover: g.cover, cand: g.candidate,
      outPtr: g.outPtr, outIdx: g.outIdx,
      obsPtr: g.obs.ptr, obsIdx: g.obs.idx, lenIn: g.lenIn,
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
                       depth: g.cover[i] - g.inv[i], isChamber: g.candidate[i] === 1 });
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
// api.candidates() gives the chambers you are allowed to use.
function place(graph, budget, api) {
  const scored = api.candidates().map(id => ({
    id: id,
    n: api.observableFrom(id).length
  }));
  scored.sort((a, b) => b.n - a.n);
  return scored.slice(0, budget).map(s => s.id);
}`;

/* --------------------------------------------------------------- renderer */
const cv = $("map"), ctx = cv.getContext("2d");
const view = { scale: 1, ox: 0, oy: 0 };
const dpr = Math.min(2, window.devicePixelRatio || 1);

function resize() {
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return;
  cv.width = Math.round(r.width * dpr);
  cv.height = Math.round(r.height * dpr);
  draw();
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

function ramp(t, a, b) {
  t = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

function draw() {
  if (!G || !cv.width) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.scale(dpr, dpr);

  const cov = S.covered, obs = G.obs;
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

  const passes = field ? [0] : [0, 1, 2];
  for (const pass of passes) {
    for (let ei = 0; ei < G.edges.length; ei++) {
      const a = G.edges[ei][0], b = G.edges[ei][1];
      let style, width;
      if (field) {
        const v = field[b];
        if (!isFinite(v)) { style = "#3a4257"; width = 1; }
        else {
          const t = (v - lo) / Math.max(1e-6, hi - lo);
          style = S.colourBy === "depth" ? ramp(t, [125, 211, 252], [190, 24, 93])
                                         : ramp(t, [45, 212, 191], [251, 191, 36]);
          width = 1.3;
        }
      } else {
        const isCov = cov && (cov[a] || cov[b]);
        const isObs = obs.inUniverse[a] || obs.inUniverse[b];
        const lvl = isCov ? 2 : (isObs ? 1 : 0);
        if (lvl !== pass) continue;
        style = lvl === 2 ? "#38bdf8" : lvl === 1 ? "#1d4ed8" : "#2b3a55";
        width = lvl === 2 ? 1.9 : lvl === 1 ? 1.3 : 0.8;
      }
      const pl = G.polylines[ei];
      ctx.beginPath();
      ctx.moveTo(sx(pl[0][0]), sy(pl[0][1]));
      for (let k = 1; k < pl.length; k++) ctx.lineTo(sx(pl[k][0]), sy(pl[k][1]));
      ctx.strokeStyle = style; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.stroke();
    }
  }

  const r = Math.max(2.5, Math.min(6, 3.2 * Math.sqrt(view.scale)));
  ctx.fillStyle = "#f43f5e"; ctx.strokeStyle = "#4c0519"; ctx.lineWidth = 1;
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
    (S.covered && S.covered[i] ? '<span style="color:#38bdf8">covered</span>'
      : G.obs.inUniverse[i] ? '<span style="color:#93a4c4">observable</span>'
      : '<span style="color:#64748b">not observable</span>');
});
cv.addEventListener("click", e => {
  if (moved > 4 || S.mode !== "anchor" || !G) return;
  const r = cv.getBoundingClientRect();
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
    let sensors = [], extra = {};
    switch (S.algo) {
      case "greedy": sensors = C.greedy(G, S.budget, S.objective); break;
      case "upstream": { const u = C.upstreamSize(G); sensors = C.topBy(G, S.budget, i => u[i]); break; }
      case "outdeg": sensors = C.topBy(G, S.budget, i => G.outDeg[i]); break;
      case "indeg": sensors = C.topBy(G, S.budget, i => G.inDeg[i]); break;
      case "between": { const b = C.betweenness(G); sensors = C.topBy(G, S.budget, i => b[i]); break; }
      case "random": { const r = C.randomPlace(G, S.budget, S.objective); sensors = r.sensors; extra.mean = r.mean; break; }
      case "twoupdown": { const r = C.twoUpTwoDown(G, S.budget, S.kup, S.kdown); sensors = r.sensors; extra.anchors = r.anchors.length; break; }
      case "custom": {
        const r = await runCustom(G, $("code").value, S.budget);
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
    S.lastResult = { ...res, sensors: sensors.length, extra };
    renderResult(); saveScore(); draw();
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
  S.sensors = rule; S.covered = rRule.covered;
  const key = S.objective === "length" ? "len" : "nodes";
  const fmt = v => S.objective === "length" ? fmtM(v) : v;
  const pct = v => rFree[key] > 0 ? Math.round(100 * v / rFree[key]) + "%" : "n/a";

  $("anchor-out").innerHTML = `
    <div class="stat"><span>Anchor node</span><span>${a}</span></div>
    <div class="stat"><span>Rule (${S.kup} up / ${S.kdown} down)</span><span>${budget} sensors</span></div>
    <hr>
    <div class="stat"><span>Rule covers</span><span>${fmt(rRule[key])}</span></div>
    <div class="stat"><span>Optimiser, free</span><span>${fmt(rFree[key])}</span></div>
    <div class="stat"><span>Optimiser, anchor forced</span><span>${fmt(rForced[key])}</span></div>
    <hr>
    <div class="stat"><span>Rule vs free optimum</span><span style="color:${rRule[key] >= rFree[key] * 0.9 ? "var(--good)" : "var(--warn)"}">${pct(rRule[key])}</span></div>
    <div class="stat"><span>Cost of mandating</span><span>${fmt(rFree[key] - rForced[key])}</span></div>
    <div class="hint" style="margin-top:8px">The last row is what the mandate costs: the optimiser
      loses this much by being forced to use the anchor.</div>`;
  draw();
}

function renderResult() {
  const r = S.lastResult, o = G.obs;
  const main = S.objective === "length"
    ? (o.universeLen ? 100 * r.len / o.universeLen : 0)
    : (o.universeSize ? 100 * r.nodes / o.universeSize : 0);
  const e = r.extra || {};
  $("result").innerHTML = `
    <div class="big">${main.toFixed(1)}%</div>
    <div class="bigsub">of the observable ${S.objective === "length" ? "pipe length" : "nodes"} covered,
      using ${r.sensors} sensor${r.sensors === 1 ? "" : "s"}</div>
    <div class="stat"><span>Nodes covered</span><span>${r.nodes} / ${o.universeSize}</span></div>
    <div class="stat"><span>Length covered</span><span>${fmtM(r.len)} / ${fmtM(o.universeLen)}</span></div>
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
  const rows = loadLB().filter(r => r.k === k).sort((a, b) => b.v - a.v).slice(0, 12);
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
function setRegion(k) {
  S.region = k; G = buildGraph(k);
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
    <div class="stat"><span>Real manholes</span><span>${st.manholes_matched || 0} / ${st.manholes_published || 0}</span></div>
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
    <div class="stat"><span>Cover transferred</span><span>${ds.transferred}</span></div>
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
  fitView(); syncParamUI(); renderLB();
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
}

const ALGO_HINTS = {
  greedy: "Repeatedly takes the sensor adding the most new coverage. The benchmark to beat.",
  twoupdown: "The the two up, two down rule of thumb of thumb, scored on the same footing as everything else. " +
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
  $("model").addEventListener("change", e => { S.model = e.target.value; syncParamUI(); ensureObs(); draw(); });
  $("objective").addEventListener("change", e => { S.objective = e.target.value; renderLB(); });
  $("algo").addEventListener("change", e => { S.algo = e.target.value; syncParamUI(); });
  $("colourby").addEventListener("change", e => { S.colourBy = e.target.value; draw(); });
  $("useorg").addEventListener("change", e => { S.useOrg = e.target.checked; ensureObs(); draw(); });
  bindRange("c", "c", () => { ensureObs(); draw(); });
  bindRange("drop", "drop", () => { ensureObs(); draw(); });
  bindRange("threshold", "threshold", () => { ensureObs(); draw(); });
  bindRange("starve", "starveFrac", () => { ensureObs(); draw(); });
  bindRange("budget", "budget", renderLB);
  bindRange("kup", "kup");
  bindRange("kdown", "kdown");
  $("run").addEventListener("click", run);

  document.querySelectorAll("#mode-seg button").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#mode-seg button").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      S.mode = b.dataset.mode;
      $("mode-hint").textContent = S.mode === "anchor"
        ? "Click a chamber to treat it as a mandated location, then compare the rule against a free optimiser and against one forced to use it."
        : "Place a budget of sensors across the whole network.";
      syncParamUI();
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
  if (window.OSPDocs) window.OSPDocs.render({ DATA, VALID, META, C, buildGraph });
}

init();
