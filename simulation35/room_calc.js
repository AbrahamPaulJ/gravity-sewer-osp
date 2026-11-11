/* room_calc.js - Sim 3.5 "Room for homes", recalculated in the browser.

   The same calculation as simulation_src/sim35_capacity.py, on the same saved runs, so the reader can
   change three things the script fixes:

     limit    any share of the pipe's height, not only 0.5, 0.6 and 0.7
     load     people, litres a day and peak factor for each NEW home. The runs added a fixed flow per
              home, and a run only sees the flow, so N homes at r times that flow give the same levels as
              N x r homes did: the ladder is re-read in homes as dw / r. Existing homes, leakage and
              outside inflow stay as modelled; changing those needs new SWMM runs.
     timing   the projection case, the year growth is counted from and the approval lag turn homes
              into years, at the projection's rate (and the same rate after it ends).

   Per region: the path is the region's manholes and every manhole downstream (pipes and pump links).
   Fullness is depth over the bore of the manhole's lowest outlet pipe, measured from that pipe's invert.
   Each draw shifts every manhole's starting fullness by an independent normal error (0.05 of the bore)
   and takes the homes at which the first manhole still under the limit reaches it. The draws use a
   seeded generator, so a row's answer only changes when an input does.

   Needs window.GROWTH_GEOM, GROWTH_RUNS, SIM3_REGIONS (Sim 3's data) and SIM35_ROOM (data/room.js).
   Runs in Node too, for the check against the published figures (tools/check_room_calc.js). */
(function (root) {
  "use strict";
  const ERR = 0.05, DRAWS = 400, HI = 0.8, LO = 0.2, GONE = 0.25;   // as sim35_capacity.py
  const G = () => root.GROWTH_GEOM, S = () => root.SIM3_REGIONS, X = () => root.SIM35_ROOM;
  const chambers = () => root.GROWTH_RUNS.chambers;
  // The 100% build-out step: its index among the runs; in a fullness row it is one further on (column 0 is before growth).
  const run100 = () => S().ladder.indexOf(1);
  let geomCache = null, downCache = null;
  const tables = {};

  // Per chamber index: [offset of the lowest outlet above the floor (mm), its bore (mm)], or null.
  function geometry() {
    if (geomCache) return geomCache;
    const g = G(), ix = {}, outs = {};
    g.nodes.forEach((n, j) => { ix[n.name] = j; });
    g.up.forEach((u, li) => { (outs[u] = outs[u] || []).push(li); });
    geomCache = chambers().map(name => {
      const j = ix[name], o = outs[j];
      if (!o || !o.length) return null;
      let li = o[0];
      for (const l of o) if (g.zu[l] < g.zu[li]) li = l;
      return [(g.zu[li] - g.nodes[j].inv) * 10, g.dia[li]];
    });
    return geomCache;
  }

  // Per chamber index: the chamber indices downstream of it, following pipes and pump links.
  function downstream() {
    if (downCache) return downCache;
    const g = G(), ix = {}, cidx = {}, nxt = {};
    g.nodes.forEach((n, j) => { ix[n.name] = j; });
    chambers().forEach((c, i) => { cidx[ix[c]] = i; });
    const add = (a, b) => { (nxt[a] = nxt[a] || new Set()).add(b); };
    g.up.forEach((u, li) => add(u, g.down[li]));
    (g.pumpLinks || []).forEach(([a, b]) => add(a, b));
    downCache = chambers().map(c => {
      const start = ix[c], seen = new Set([start]), stack = [start], res = new Set();
      while (stack.length) for (const d of nxt[stack.pop()] || []) if (!seen.has(d)) {
        seen.add(d); stack.push(d);
        if (cidx[d] !== undefined) res.add(cidx[d]);
      }
      return res;
    });
    return downCache;
  }

  const full = (m, depth) => { const gm = geometry()[m]; return gm ? (depth - gm[0]) / gm[1] : null; };

  // One region in one case: fullness table (path manholes x [before growth, each step]), bores,
  // the dwellings ladder [0, steps...] and the region's 100% share.
  function table(tag, key) {
    const k = tag + "|" + key;
    if (tables[k]) return tables[k];
    const reg = S(), base = reg.base[tag].depthMm, gm = geometry();
    let path, dw, share, depthAt;
    if (key === "suburb") {
      const sb = X().suburb[tag];
      if (!sb) return null;
      path = chambers().map((_, i) => i);
      dw = [0].concat(sb.dw);
      share = null;
      depthAt = (m, s) => s < 0 ? (base[String(m)] || 0) : sb.depth[s][m];
    } else {
      const ri = reg.regions.findIndex(r => r.id === key), r = reg.regions[ri];
      const rows = reg.rows[tag].filter(x => x.r === ri).sort((a, b) => a.s - b.s);
      const set = new Set(r.manholes), down = downstream();
      r.manholes.forEach(m => down[m].forEach(d => set.add(d)));
      path = Array.from(set);
      dw = [0].concat(rows.map(x => x.dw));
      share = rows[run100()].dw;
      const rises = rows.map(x => new Map(x.rise));
      depthAt = (m, s) => (base[String(m)] || 0) + (s < 0 ? 0 : rises[s].get(m) || 0);
    }
    path = path.filter(m => gm[m]).sort((a, b) => a - b);
    const F = path.map(m => [full(m, depthAt(m, -1))].concat(dw.slice(1).map((_, s) => full(m, depthAt(m, s)))));
    tables[k] = { path, F, bore: path.map(m => gm[m][1]), dw, share };
    return tables[k];
  }

  // Dwellings at which a rising fullness series first reaches the limit, or null. dw[0] = 0.
  function crossing(dw, fs, limit, shift) {
    for (let a = 1; a < fs.length; a++) {
      if (fs[a] + shift >= limit) {
        const span = fs[a] - fs[a - 1];
        const frac = span > 0 ? (limit - fs[a - 1] - shift) / span : 1;
        return dw[a - 1] + frac * (dw[a] - dw[a - 1]);
      }
    }
    return null;
  }

  // The first manhole on the path to reach the limit, with no starting-level error (sim35_capacity's homes_to_limit).
  function firstPipe(tag, key, limit) {
    const t = table(tag, key);
    let best = null, who = null, over = 0, room = 0;
    t.F.forEach((fs, i) => {
      if (fs[0] >= limit) { over++; return; }
      room++;
      const h = crossing(t.dw, fs, limit, 0);
      if (h !== null && (best === null || h < best)) { best = h; who = t.path[i]; }
    });
    return { homes: best, first: who === null ? null : chambers()[who], already_over: over, with_buffer: room };
  }

  // Seeded normals: mulberry32 and Box-Muller, seeded by the row's case and key.
  function rng(seedText) {
    let h = 2166136261;
    for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
    let a = h >>> 0, spare = null;
    const u = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return () => {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let x = 0, y = 0;
      while (x === 0) x = u();
      y = u();
      const r = Math.sqrt(-2 * Math.log(x));
      spare = r * Math.sin(2 * Math.PI * y);
      return r * Math.cos(2 * Math.PI * y);
    };
  }

  // numpy.percentile's default (linear) on a sorted array that may hold Infinity.
  function percentile(sorted, q) {
    const pos = (q / 100) * (sorted.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
    const v = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    return Number.isFinite(v) ? v : null;
  }

  // Flow per new home at the peak hour, L/s, and its ratio to what the runs used.
  function load(o) {
    const d = X().loads, q = (p, l, k) => p * l / 86400 * k;
    const lps = q(o.people, o.litres, o.peak), base = q(d.people, d.litres, d.peak);
    return { lps, base, ratio: lps / base };
  }

  // The homes a key is expected to gain each year, and by the projection's end, counting from o.from.
  function expected(key, o) {
    const T = X().timing, reg = S(), span = T.years[1] - T.years[0];
    const anchor = o.projection === "medium" ? T.medium : T.high;
    let share100;
    if (key === "suburb") {
      const domain = reg.regions.reduce((a, r) => a + r.dwellings, 0);
      share100 = reg.anchor * domain / reg.councilConnections;
    } else share100 = table(o.tag, key).share;
    const perYear = share100 * anchor / reg.anchor / span;
    return { share100, perYear, byEnd: perYear * Math.max(0, T.years[1] - o.from), end: T.years[1] };
  }

  /* The row the tab shows, for one key (a region id or "suburb") in case o.tag.
     o: { tag, limit, people, litres, peak, projection: "high"|"medium", from, lag[, seed] } */
  function row(key, o) {
    const t = table(o.tag, key);
    if (!t) return null;
    const ld = load(o), dw = t.dw.map(v => v / ld.ratio), ex = expected(key, o), L = o.limit;
    const draw = rng((o.seed || "") + o.tag + "|" + key), draws = new Float64Array(DRAWS);
    for (let d = 0; d < DRAWS; d++) {
      let best = Infinity;
      for (let i = 0; i < t.F.length; i++) {
        const e = draw() * ERR, fs = t.F[i];
        if (fs[0] + e < L) {
          const h = crossing(dw, fs, L, e);
          if (h !== null && h < best) best = h;
        }
      }
      draws[d] = best;
    }
    const sorted = Array.from(draws).sort((a, b) => a - b);
    const p = sorted.filter(v => v <= ex.byEnd).length / DRAWS;
    const gone = t.F.filter(fs => fs[0] >= L).length / t.F.length;
    const band = p >= HI ? "runs out" : p > LO ? "uncertain" : gone >= GONE ? "already over" : "room left";
    let rise = 0;
    const c100 = run100() + 1;
    t.F.forEach((fs, i) => { rise = Math.max(rise, (fs[c100] - fs[0]) * t.bore[i]); });
    const h10 = percentile(sorted, 10), h90 = percentile(sorted, 90), top = dw[dw.length - 1];
    const year = h => h === null ? null : o.from + h / ex.perYear;
    return {
      band, p_runs_out: p, already_over: gone, homes_p10: h10, homes_p90: h90, top_homes: top,
      expected: ex.byEnd, expected_end: ex.end, share100: ex.share100, per_year: ex.perYear,
      year_p10: year(h10), year_p90: year(h90), year_top: o.from + top / ex.perYear,
      rise_mm_per_100_homes: rise / dw[c100] * 100, load: ld,
    };
  }

  root.ROOM_CALC = { row, firstPipe, load, expected, defaults: () => {
    const x = X();
    return { people: x.loads.people, litres: x.loads.litres, peak: x.loads.peak, projection: "high", from: x.timing.from, lag: x.timing.lag, limit: 0.7 };
  } };
})(typeof window !== "undefined" ? window : globalThis);
