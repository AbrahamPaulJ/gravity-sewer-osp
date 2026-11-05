/* footprints.js - map-style building outlines for the Sim 3 view (demo copy only).

   These are drawn shapes, not surveyed buildings. Each property's inspection point is where
   its connection starts, so the building is put on the far side of that point from the
   main it drains to, squared to that main (mains run along streets or rear boundaries, so
   this follows the lot grid), and sized from the spacing of its neighbours along the same
   main. Shapes are a rectangle, an L with a rear wing, or a front garage notch, picked
   from the property index so every reload draws the same map.

   Footprints.make(g) -> [{ i, poly: [[x, y], ...] }] in plan metres (g.hx / 10, g.hy / 10).
   Two checks run before anything is returned: no two outlines may overlap, and no outline
   may cross a main. A shape that still fails after shrinking is left out, not drawn wrong. */
"use strict";
(function (root) {
  function rng(seed) {
    let a = (seed * 2654435761) >>> 0 || 1;
    return () => { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; };
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // A uniform grid over plan space, for "what is near this point".
  function Grid(cell) {
    const m = new Map(), key = (cx, cy) => cx * 100003 + cy;
    return {
      add(x0, y0, x1, y1, item) {
        for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++)
          for (let cy = Math.floor(y0 / cell); cy <= Math.floor(y1 / cell); cy++) {
            const k = key(cx, cy); if (!m.has(k)) m.set(k, []); m.get(k).push(item);
          }
      },
      near(x, y, r) {
        const out = new Set();
        for (let cx = Math.floor((x - r) / cell); cx <= Math.floor((x + r) / cell); cx++)
          for (let cy = Math.floor((y - r) / cell); cy <= Math.floor((y + r) / cell); cy++) {
            const b = m.get(key(cx, cy)); if (b) b.forEach(it => out.add(it));
          }
        return out;
      },
    };
  }

  // Separating-axis test on two convex polygons; true when their interiors meet.
  function convexOverlap(A, B, pad) {
    for (const P of [A, B]) for (let k = 0; k < P.length; k++) {
      const a = P[k], b = P[(k + 1) % P.length];
      const nx = -(b[1] - a[1]), ny = b[0] - a[0], L = Math.hypot(nx, ny) || 1;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const p of A) { const d = (p[0] * nx + p[1] * ny) / L; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const p of B) { const d = (p[0] * nx + p[1] * ny) / L; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      if (a1 + pad <= b0 || b1 + pad <= a0) return false;
    }
    return true;
  }
  const segOverlap = (P, s, pad) => convexOverlap(P, [s[0], s[1]], pad);

  function make(g, opts) {
    const n = g.hx.length;
    // Mains as plan segments.
    const segs = [], sg = Grid(25);
    for (let p = 0; p < g.nPipes; p++)
      for (let v = g.ptr[p]; v < g.ptr[p + 1] - 1; v++) {
        const a = [g.px[v] / 10, g.py[v] / 10], b = [g.px[v + 1] / 10, g.py[v + 1] / 10];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.01) continue;
        segs.push([a, b]);
        sg.add(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), segs.length - 1);
      }
    const nearestMain = (x, y) => {
      let best = null, bd = Infinity;
      for (let r = 30; r <= 240 && !best; r *= 2) sg.near(x, y, r).forEach(k => {
        const [a, b] = segs[k], dx = b[0] - a[0], dy = b[1] - a[1];
        const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy), 0, 1);
        const cx = a[0] + t * dx, cy = a[1] + t * dy, d = Math.hypot(x - cx, y - cy);
        if (d < bd) { bd = d; best = { c: [cx, cy], t: [dx, dy], d }; }
      });
      return best;
    };

    // Frame per property: u along the main, v away from it.
    const hp = [], hg = Grid(30);
    for (let i = 0; i < n; i++) {
      const x = g.hx[i] / 10, y = g.hy[i] / 10, m = nearestMain(x, y);
      let tx = 1, ty = 0, vx = 0, vy = 1;
      if (m) {
        const L = Math.hypot(m.t[0], m.t[1]); tx = m.t[0] / L; ty = m.t[1] / L;
        vx = -ty; vy = tx;
        // Away from the main: by the point's own offset, else by its connection's far end.
        let ox = x - m.c[0], oy = y - m.c[1];
        if (Math.hypot(ox, oy) < 0.3 && g.jx) { ox = x - g.jx[i] / 10; oy = y - g.jy[i] / 10; }
        if (ox * vx + oy * vy < 0) { vx = -vx; vy = -vy; tx = -tx; ty = -ty; }
      }
      hp.push({ x, y, tx, ty, vx, vy });
      hg.add(x, y, x, y, i);
    }

    // Size from the gap to the next property along the same main; properties within 4 m of
    // each other (units on one lot) are stacked one behind the other.
    const B = [];
    const stackOf = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const h = hp[i];
      let along = Infinity;
      hg.near(h.x, h.y, 30).forEach(k => {
        if (k === i) return;
        const dx = hp[k].x - h.x, dy = hp[k].y - h.y;
        const a = Math.abs(dx * h.tx + dy * h.ty), b = Math.abs(dx * h.vx + dy * h.vy);
        if (Math.hypot(dx, dy) < 4) { if (k < i) stackOf[i]++; return; }
        if (b < 10 && a > 4) along = Math.min(along, a);
      });
      const r = rng(i + 7);
      const w = clamp(isFinite(along) ? along * 0.72 : 12, 5.5, 15);
      const D = clamp(w * (1.15 + 0.45 * r()), 8, 19);
      const shape = r(), wing = r(), gar = r();
      B.push({ i, w, D, s: 2.5 + 3 * r(), shape, wing, gar, stack: stackOf[i], src: "drawn" });
    }

    // Real sizes. Each property takes the mapped building on its own side of the main whose
    // centre is closest to where its house would stand (one building per property, closest
    // pairs first). The drawn shape then gets that building's width along the street, its
    // depth, its distance back from the inspection point and its offset along the street; an L is used when the real
    // outline fills less of its box than a rectangle would. Properties with no match take
    // the median size of matched neighbours within 80 m.
    const real = (opts && opts.real) || [];
    const stats = { matched: 0, neighbour: 0, drawn: 0 };
    if (real.length) {
      const RB = real.map(p => {
        let a = 0, cx = 0, cy = 0;
        for (let k = 0; k < p.length; k++) {
          const q = p[k], s = p[(k + 1) % p.length], c = q[0] * s[1] - s[0] * q[1];
          a += c; cx += (q[0] + s[0]) * c; cy += (q[1] + s[1]) * c;
        }
        const A = Math.abs(a / 2);
        return a ? { p, A, cx: cx / (3 * a), cy: cy / (3 * a) } : null;
      }).filter(b => b && b.A >= 35 && b.A <= 900);
      const rg = Grid(30);
      RB.forEach((b, k) => rg.add(b.cx, b.cy, b.cx, b.cy, k));
      const pairs = [];
      B.forEach((b, j) => {
        const h = hp[b.i];
        rg.near(h.x, h.y, 35).forEach(k => {
          const dx = RB[k].cx - h.x, dy = RB[k].cy - h.y;
          const u = dx * h.tx + dy * h.ty, v = dx * h.vx + dy * h.vy;
          if (v < -1 || Math.abs(u) > 14) return;
          pairs.push([Math.hypot(u, v - 12), j, k]);
        });
      });
      pairs.sort((x, y) => x[0] - y[0]);
      const takenB = new Set(), takenR = new Set();
      for (const [, j, k] of pairs) {
        if (takenB.has(j) || takenR.has(k)) continue;
        takenB.add(j); takenR.add(k);
        const b = B[j], h = hp[b.i], R = RB[k];
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        R.p.forEach(([x, y]) => {
          const u = (x - h.x) * h.tx + (y - h.y) * h.ty, v = (x - h.x) * h.vx + (y - h.y) * h.vy;
          u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
        });
        // Measured in the property's own frame, so a building turned against the street
        // reads a little larger than it is; the area keeps the drawn one honest.
        const bw = u1 - u0, bd = v1 - v0, fill = R.A / (bw * bd), k2 = Math.sqrt(Math.min(1, R.A / (bw * bd * 0.92)));
        b.w = clamp(bw * k2, 4, 40); b.D = clamp(bd * k2, 4, 45);
        b.s = clamp(v0 + (bd - b.D) / 2, 0.8, 30); b.du = clamp((u0 + u1) / 2, -12, 12); b.stack = 0;
        b.shape = fill < 0.8 ? 0.1 : 0.9; b.realA = R.A; b.src = "osm";
        stats.matched++;
      }
      // Neighbour medians for the rest.
      const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
      B.forEach(b => {
        if (b.src !== "drawn") return;
        const h = hp[b.i], ws = [], ds = [];
        hg.near(h.x, h.y, 80).forEach(k => {
          const o = B[k];
          if (o.src === "osm" && Math.hypot(hp[k].x - h.x, hp[k].y - h.y) <= 80) { ws.push(o.w); ds.push(o.D); }
        });
        if (ws.length >= 3) { b.w = Math.min(b.w * 1.4, med(ws)); b.D = med(ds); b.src = "neighbour"; stats.neighbour++; }
        else stats.drawn++;
      });
    } else stats.drawn = n;

    // Local outline -> plan coordinates. f is the shrink factor.
    function outline(b, f, extra) {
      const h = hp[b.i], w = b.w * f, D = b.D * f;
      const front = b.s + (b.stack + extra) * (D + 2.5);
      let loc;
      const l = -w / 2, rgt = w / 2;
      if (b.shape < 0.32 && f > 0.6) {             // L: a rear wing on one side
        const ww = w * (0.4 + 0.2 * b.wing), e = D * 0.35, side = b.wing < 0.5;
        loc = side
          ? [[l, 0], [rgt, 0], [rgt, D], [l + ww, D], [l + ww, D + e], [l, D + e]]
          : [[l, 0], [rgt, 0], [rgt, D + e], [rgt - ww, D + e], [rgt - ww, D], [l, D]];
      } else if (b.shape < 0.5 && f > 0.6) {       // a garage stepping forward on one side
        const gw = w * (0.32 + 0.1 * b.gar), gd = 3.5, side = b.gar < 0.5;
        loc = side
          ? [[l, -gd], [l + gw, -gd], [l + gw, 0], [rgt, 0], [rgt, D], [l, D]]
          : [[l, 0], [rgt - gw, 0], [rgt - gw, -gd], [rgt, -gd], [rgt, D], [l, D]];
      } else loc = [[l, 0], [rgt, 0], [rgt, D], [l, D]];
      const du = b.du || 0;
      loc = loc.map(([u, v]) => [u + du, v]);
      const poly = loc.map(([u, v]) => [h.x + u * h.tx + (front + v) * h.vx, h.y + u * h.ty + (front + v) * h.vy]);
      // Its bounding box in the same frame, for the overlap tests.
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      loc.forEach(([u, v]) => { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); });
      const box = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [h.x + u * h.tx + (front + v) * h.vx, h.y + u * h.ty + (front + v) * h.vy]);
      return { poly, box };
    }

    // Place in order, shrinking each shape until it clears what is already placed and every
    // main; a shape that never clears is skipped.
    // A drawn L or notch is not the real outline, so scale each matched shape until its
    // area equals the real building's, keeping its centre where it was.
    const areaOf = P => { let a = 0; for (let k = 0; k < P.length; k++) { const p = P[k], q = P[(k + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); };
    B.forEach(b => {
      if (!b.realA) return;
      const k = Math.sqrt(b.realA / areaOf(outline(b, 1, 0).poly)), D0 = b.D;
      b.w *= k; b.D *= k; b.s = Math.max(0.8, b.s + (D0 - b.D) / 2);
    });
    const placed = [], pg = Grid(30), out = [];
    let skipped = 0;
    for (const b of B) {
      let ok = null;
      // Smaller first, then one lot further back (a rear unit), before giving up.
      for (let t = 0; t < 2 && !ok; t++) for (let f = 1; f >= 0.45 && !ok; f -= 0.08) {
        const o = outline(b, f, t);
        const cx = o.box.reduce((s, p) => s + p[0], 0) / 4, cy = o.box.reduce((s, p) => s + p[1], 0) / 4;
        let bad = false;
        for (const k of pg.near(cx, cy, 30)) if (convexOverlap(o.box, placed[k], 0.6)) { bad = true; break; }
        if (!bad) for (const k of sg.near(cx, cy, 30)) if (segOverlap(o.box, segs[k], 1.5)) { bad = true; break; }
        if (!bad) { ok = o; ok.f = f; }
      }
      if (!ok) { skipped++; continue; }
      placed.push(ok.box);
      const xs = ok.box.map(p => p[0]), ys = ok.box.map(p => p[1]);
      pg.add(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), placed.length - 1);
      out.push({ i: b.i, poly: ok.poly, src: b.src, realA: b.realA, f: ok.f });
    }
    out.skipped = skipped; out.stats = stats;
    return out;
  }

  root.Footprints = { make, convexOverlap };
})(typeof window !== "undefined" ? window : globalThis);
