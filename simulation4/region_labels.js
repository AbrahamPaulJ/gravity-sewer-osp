/* Region labels at the edge of the network, each with a thin leader line into its region.
   19 Nov dry run: a label such as "R3 Monitor" sat on one central manhole of its region and read as a sensor site.
   Here every label sits just outside the network's outline on screen, spread so none overlap, and a dashed line in
   the label's colour runs to the region. Sim 4 only: it wraps Growth3D.setRegionLabels / showRegionLabels, so the
   shared 3D map file is untouched and Sim 3.5 keeps its own labels. Positions follow the camera every frame. */
window.RegionLabels = (function () {
  "use strict";
  let layer = null, svg = null, items = [], hull = [], raf = 0, visible = true, opts = {};
  const NS = "http://www.w3.org/2000/svg";

  // The network's outline: the convex hull of every chamber in plan, so a few points bound it on screen.
  function hullNames() {
    const g = window.GROWTH_GEOM;
    if (!g || !g.nodes) return [];
    const p = g.nodes.filter(n => n.kind === "chamber" && isFinite(n.x) && isFinite(n.y)).map(n => [n.x, n.y, n.name]);
    p.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1)).map(q => q[2]);
  }

  function init(o) {
    opts = o || {};
    if (layer || !window.Growth3D) return;
    layer = document.createElement("div");
    layer.className = "rlabels";
    layer.style.cssText = "position:fixed; inset:0; pointer-events:none; overflow:hidden; z-index:" + (opts.z || 4);
    svg = document.createElementNS(NS, "svg");
    svg.setAttribute("style", "position:absolute; inset:0; width:100%; height:100%; overflow:visible");
    layer.appendChild(svg);
    document.body.appendChild(layer);
    const set0 = Growth3D.setRegionLabels, show0 = Growth3D.showRegionLabels;
    Growth3D.setRegionLabels = list => { set0([]); set(list); };
    Growth3D.showRegionLabels = on => { if (show0) show0(on); visible = !!on; tick(); };
  }

  function set(list) {
    items.forEach(it => { it.el.remove(); it.line.remove(); });
    items = (list || []).map(r => {
      const el = document.createElement("div");
      el.className = "rlbl";
      el.textContent = r.text;
      el.style.background = r.col;
      layer.appendChild(el);
      const line = document.createElementNS(NS, "line");
      line.setAttribute("stroke", r.col);
      line.setAttribute("stroke-width", "1.5");
      line.setAttribute("stroke-dasharray", "4 3");
      line.setAttribute("opacity", ".9");
      svg.appendChild(line);
      return { el, line, name: (r.names || [])[0], text: r.text, names: null };
    });
    if (items.length && !hull.length) hull = hullNames();
    tick();
  }

  function tick() {
    if (raf) return;
    if (!items.length) return;
    raf = requestAnimationFrame(() => { raf = 0; place(); tick(); });
  }

  // The region's manholes, by name, for the end of the leader line: it stops at the region's manhole nearest the label.
  function regionNames(text) {
    const S = window.SIM3_REGIONS, R = window.GROWTH_RUNS, id = String(text || "").split(" ")[0];
    const r = S && S.regions ? S.regions.find(x => x.id === id) : null;
    return r && R && R.chambers ? r.manholes.map(i => R.chambers[i]).filter(n => n != null) : [];
  }
  let lastKey = "", cache = {};
  function pt(name) {
    if (!(name in cache)) cache[name] = Growth3D.screenOf(name);
    return cache[name];
  }

  function place() {
    if (!items.length) return;
    const stage = opts.stage && opts.stage(), cv = stage && stage.querySelector("canvas");
    if (!cv || !visible || !Growth3D.screenOf) { layer.style.display = "none"; return; }
    layer.style.display = "";
    const r = cv.getBoundingClientRect(), s = (opts.safe && opts.safe()) || {};
    const lim = { l: Math.max(r.left, 0) + 6, t: Math.max(r.top, 0) + 6, r: Math.min(r.right, innerWidth) - 6, b: Math.min(r.bottom, innerHeight) - 6 };
    if (s.top != null) lim.t = Math.max(lim.t, s.top + 6);
    if (s.bottom != null) lim.b = Math.min(lim.b, s.bottom - 6);
    if (s.left != null) lim.l = Math.max(lim.l, s.left + 6);
    if (s.right != null) lim.r = Math.min(lim.r, s.right - 6);
    // Screen points are cached while the view holds still; the outline's points tell when it moved.
    const hp = hull.map(n => Growth3D.screenOf(n)).filter(Boolean);
    const key = hp.map(p => Math.round(p.x) + "," + Math.round(p.y)).join(";") + "|" + innerWidth + "x" + innerHeight;
    if (key !== lastKey) { lastKey = key; cache = {}; }
    if (hp.length < 3) { layer.style.display = "none"; return; }
    const x0 = Math.min(...hp.map(p => p.x)), x1 = Math.max(...hp.map(p => p.x)), y0 = Math.min(...hp.map(p => p.y)), y1 = Math.max(...hp.map(p => p.y));
    const pad = 16;
    const R = { l: Math.max(lim.l, x0 - pad), t: Math.max(lim.t, y0 - pad), r: Math.min(lim.r, x1 + pad), b: Math.min(lim.b, y1 + pad) };
    if (R.r - R.l < 40 || R.b - R.t < 40) { layer.style.display = "none"; return; }
    const W = R.r - R.l, H = R.b - R.t, P = 2 * (W + H);
    const cx = (R.l + R.r) / 2, cy = (R.t + R.b) / 2;
    // What a label must not cover: the sensor pins and their tags, and the labels placed before it.
    const pins = [...document.querySelectorAll(".labels .lbl.sensor")].filter(e => e.offsetParent).map(e => {
      const b = e.getBoundingClientRect(); return { l: b.left - 8, t: b.top - 8, r: b.right + 8, b: b.bottom + 16 };
    }).concat(opts.avoid ? [...document.querySelectorAll(opts.avoid)].filter(e => e.offsetParent && !e.hidden).map(e => {
      const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom };
    }).filter(b => b.r > b.l && b.b > b.t) : []);
    const at = (it, s0) => {
      s0 = ((s0 % P) + P) % P;
      let x, y;
      if (s0 < W) { x = R.l + s0; y = R.t - it.h / 2; }
      else if (s0 < W + H) { x = R.r + it.w / 2; y = R.t + (s0 - W); }
      else if (s0 < 2 * W + H) { x = R.r - (s0 - W - H); y = R.b + it.h / 2; }
      else { x = R.l - it.w / 2; y = R.b - (s0 - 2 * W - H); }
      x = Math.min(lim.r - it.w / 2, Math.max(lim.l + it.w / 2, x));
      y = Math.min(lim.b - it.h / 2, Math.max(lim.t + it.h / 2, y));
      return { x, y, l: x - it.w / 2, t: y - it.h / 2, r: x + it.w / 2, b: y + it.h / 2 };
    };
    const hit = (a, list) => list.some(b => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t);
    const live = [];
    items.forEach(it => {
      if (!it.names) it.names = regionNames(it.text);
      it.a = it.name ? pt(it.name) : null;
      it.w = it.el.offsetWidth; it.h = it.el.offsetHeight;
      if (!it.a) { it.el.style.display = "none"; it.line.setAttribute("visibility", "hidden"); return; }
      it.el.style.display = ""; it.line.setAttribute("visibility", "visible");
      let dx = it.a.x - cx, dy = it.a.y - cy;
      if (Math.hypot(dx, dy) < 1) { dx = 0; dy = -1; }
      // Where the ray from the network's centre through the region meets the outline box, as a distance round it.
      const ts = [];
      if (dx > 0) ts.push([(R.r - cx) / dx, "r"]); if (dx < 0) ts.push([(R.l - cx) / dx, "l"]);
      if (dy > 0) ts.push([(R.b - cy) / dy, "b"]); if (dy < 0) ts.push([(R.t - cy) / dy, "t"]);
      const [t, side] = ts.reduce((m, x) => x[0] < m[0] ? x : m, [Infinity, "t"]);
      const px = cx + dx * t, py = cy + dy * t;
      it.s = side === "t" ? px - R.l : side === "r" ? W + (py - R.t) : side === "b" ? W + H + (R.r - px) : 2 * W + H + (R.b - py);
      live.push(it);
    });
    live.sort((a, b) => a.s - b.s);
    // Each label takes the free spot round the outline nearest its own direction: not on a pin, not on another label.
    const placed = [];
    live.forEach(it => {
      let best = null;
      for (let k = 0; k <= P / 6 && !best; k++) for (const sg of k ? [1, -1] : [1]) {
        const b = at(it, it.s + sg * k * 6);
        const pad2 = { l: b.l - 4, t: b.t - 3, r: b.r + 4, b: b.b + 3 };
        if (!hit(pad2, pins) && !hit(pad2, placed)) { best = b; break; }
      }
      if (!best) best = at(it, it.s);
      placed.push(best);
      it.x = best.x; it.y = best.y;
      it.el.style.left = best.l + "px";
      it.el.style.top = best.t + "px";
      // The leader stops at the region's manhole nearest the label, so it reaches the region's edge, not a site.
      let end = it.a, d = Infinity;
      (it.names || []).forEach(n => { const q = pt(n); if (!q) return; const e = Math.hypot(q.x - best.x, q.y - best.y); if (e < d) { d = e; end = q; } });
      it.end = end;
      it.line.setAttribute("x1", best.x); it.line.setAttribute("y1", best.y);
      it.line.setAttribute("x2", end.x); it.line.setAttribute("y2", end.y);
    });
  }

  // Read by tools/verify_sim4_web.js: each label's box, its region's anchor on screen, and the network's outline.
  function state() {
    return items.map(it => {
      const b = it.el.getBoundingClientRect();
      return { text: it.text, name: it.name, shown: it.el.style.display !== "none" && layer.style.display !== "none",
               box: { l: b.left, t: b.top, r: b.right, b: b.bottom }, anchor: it.a || null, end: it.end || null };
    });
  }
  const outline = () => hull.slice();

  return { init, set, state, outline, place };
})();
