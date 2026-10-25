/* before_views.js - Simulation 4's "before surcharge" scoring and its pictures.

   Everything here is computed from two published files: Sim 3's runs (SIM3_REGIONS) and the
   re-scoring tool's output (SIM4_BEFORE, tools/sim4_before.py). The tool solved the placements;
   this file scores any sensor set the same way the tool does, so the page can show a published
   Sim 3 set, a greedy set and the new exact set side by side on the new measure, and so the
   test suite can check the two agree.

   The idea in one line: along an area's build-out, a sensor must respond at a smaller build-out
   than the one at which the first manhole newly surcharges. Green to the left of red.

   Colours (dark surface, checked for colour-blind separation; each also carries a label):
     before #199e70   warned at least one step before the first surcharge
     same   #c98500   responded only at the surcharge step (or inside the margin)
     after  #e5484d   responded only after the surcharge
     never  #4d5b75   no chosen sensor responds at any build-out */
"use strict";
window.Before = (function () {
  const B = () => window.SIM4_BEFORE, S = () => window.SIM3_REGIONS;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pct = x => Math.round(x * 100) + "%";
  const COL = { before: "#199e70", same: "#c98500", after: "#e5484d", never: "#4d5b75" };
  const OUTCOME = { before: "warned before surcharge", same: "only at the surcharge step", after: "only after it", never: "never" };
  const RULE_LABEL = { r10: "Rise 10 mm", r25: "Rise 25 mm", r50: "Rise 50 mm", alarm: "150 mm alarm", f70: "70% full", f80: "80% full" };
  const NEW_RULES = ["f70", "f80"];
  const mhId = i => (window.GROWTH_RUNS ? "MH " + window.GROWTH_RUNS.manholeIds[i] : "#" + i);
  const stepPct = s => Math.round(B().ladder[s] * 100) + "%";

  /* ---------------------------------------------------------------- scoring */
  const tags = () => B().cases;
  const caseLabel = ci => { const c = S().cases.find(x => x.tag === tags()[ci]); return c ? c.label : tags()[ci]; };
  const areaId = ri => S().regions[ri].id;
  const _rows = {};
  function pathRows(p) {
    const key = p.c + "|" + p.r;
    if (!_rows[key]) _rows[key] = (S().rows[tags()[p.c]] || []).filter(x => x.r === p.r).sort((a, b) => a.s - b.s);
    return _rows[key];
  }
  // Which manholes respond in one run under a rule. Every rule is a rise threshold (one number,
  // or one per manhole for the fullness rules) except the alarm, which is Sim 3's own list.
  function responders(row, rule, ci) {
    const need = B().results[rule].need;
    if (need === "alarm") return new Set(row.alarm);
    if (typeof need === "number") return new Set(row.rise.filter(x => x[1] >= need).map(x => x[0]));
    const nd = need[tags()[ci]];
    return new Set(row.rise.filter(x => nd[x[0]] != null && x[1] >= nd[x[0]]).map(x => x[0]));
  }
  const targets = () => B().paths.filter(p => p.s != null);
  function warnSet(p, rule) {
    const sw = p.s - B().settings.margin_steps;
    return sw < 0 ? new Set() : responders(pathRows(p)[sw], rule, p.c);
  }
  function firstStep(p, rule, set) {
    for (const x of pathRows(p)) for (const i of responders(x, rule, p.c)) if (set.has(i)) return x.s;
    return null;
  }
  // Per case (the rule's cases, in the tool's order) the warnable targets, each with its D.
  const _groups = {};
  function groups(rule) {
    if (_groups[rule]) return _groups[rule];
    const res = B().results[rule], out = [];
    (res.cases || []).forEach(c => {
      out.push(targets().filter(p => p.c === c).map(p => ({ p, D: warnSet(p, rule) })).filter(t => t.D.size));
    });
    return (_groups[rule] = out);
  }
  // Worst and average share for a set, as the tool scores it; with a radius, located only.
  function evaluate(set, rule, scheme, radius) {
    set = set instanceof Set ? set : new Set(set);
    const res = B().results[rule], gs = groups(rule);
    if (!gs.length) return null;
    const pairs = radius != null ? res.locate[String(radius)].pairs : null;
    const per = gs.map((g, gi) => {
      const ok = g.map(t => [...t.D].some(i => set.has(i)));
      if (pairs) pairs[gi].forEach(([ra, rb]) => {
        const a = g.findIndex(t => t.p.r === ra), b = g.findIndex(t => t.p.r === rb);
        const sep = [...g[a].D].some(i => set.has(i) && !g[b].D.has(i)) || [...g[b].D].some(i => set.has(i) && !g[a].D.has(i));
        if (!sep) { ok[a] = false; ok[b] = false; }
      });
      const w = g.map(t => t.p.w[scheme]), tot = w.reduce((s, v) => s + v, 0);
      return g.reduce((s, t, j) => s + (ok[j] ? w[j] : 0), 0) / tot;
    });
    return { worst: Math.min(...per), average: per.reduce((s, v) => s + v, 0) / per.length, per };
  }
  // Before / same / after / never over every target, and the warning margins.
  function outcomes(set, rule) {
    set = set instanceof Set ? set : new Set(set);
    const m = B().settings.margin_steps, cnt = { before: 0, same: 0, after: 0, never: 0 }, list = [];
    targets().forEach(p => {
      const f = firstStep(p, rule, set);
      const o = f == null ? "never" : f <= p.s - m ? "before" : f <= p.s ? "same" : "after";
      cnt[o]++;
      list.push({ p, f, o, margin: o === "before" ? B().ladder[p.s] / B().ladder[f] : null });
    });
    return { cnt, list };
  }
  // Runs the set is credited with by Sim 3's score, and how many had already surcharged.
  function credited(set, rule) {
    set = set instanceof Set ? set : new Set(set);
    let all = 0, late = 0;
    tags().forEach((t, ci) => (S().rows[t] || []).forEach(x => {
      for (const i of responders(x, rule, ci)) if (set.has(i)) { all++; if (x.sur.length || x.spill.length) late++; return; }
    }));
    return { all, late };
  }
  // The sets the page can show for a rule and k.
  function sets(rule, k, scheme) {
    const res = B().results[rule], pub = B().published[rule] || null, out = [];
    if (res.exact) out.push({ id: "new", name: "Sim 4 exact (before surcharge)", isNew: true, chosen: res.exact[scheme][k - 1].chosen });
    if (res.locate) out.push({ id: "loc", name: "Sim 4 exact (before + located, " + B().settings.default_radius_m + " m)", isNew: true, chosen: res.locate[String(B().settings.default_radius_m)].sets[k - 1].chosen });
    if (pub) {
      out.push({ id: "s3exact", name: "Sim 3 exact", chosen: pub.exact[k - 1].chosen });
      out.push({ id: "s3greedy", name: "Sim 3 greedy", chosen: pub.greedy[k - 1].chosen });
      if (pub.risk && pub.risk[k - 1]) out.push({ id: "s3risk", name: "Sim 3 risk-weighted", chosen: pub.risk[k - 1].chosen });
    }
    return out;
  }
  // The smallest k whose new exact set warns of every warnable target in every case.
  function kFull(rule, scheme) {
    const ex = (B().results[rule].exact || {})[scheme] || [];
    const e = ex.find(x => x.worst >= 0.9999);
    return e ? e.k : null;
  }

  /* ---------------------------------------------------------------- drawing */
  const svgOpen = (w, h, label) => '<svg viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="' + esc(label) + '" style="width:100%;max-width:' + w + 'px;height:auto;display:block">';
  const txt = (x, y, s, o) => '<text x="' + x + '" y="' + y + '" font-size="' + ((o && o.fs) || 10.5) + '" fill="' + ((o && o.fill) || "#a9b8d4") + '"' +
    (o && o.anchor ? ' text-anchor="' + o.anchor + '"' : "") + (o && o.weight ? ' font-weight="' + o.weight + '"' : "") + ">" + esc(s) + "</text>";
  const legend = items => '<div class="bvLg">' + items.map(([c, l, dash]) => '<span><i style="' + (dash ? "border-top:2px dashed " + c + ";background:none" : "background:" + c) + '"></i>' + esc(l) + "</span>").join("") + "</div>";

  // V1. The build-out ladder: one grid per case, areas down, build-out across.
  function ladderGrid(rule, set, opt) {
    set = new Set(set);
    const L = B().ladder, cw = 30, ch = 19, left = 34, top = 18, n = S().regions.length;
    const order = S().regions.map((r, i) => i).sort((a, b) => String(areaId(a)).localeCompare(String(areaId(b)), undefined, { numeric: true }));
    const only = opt && opt.caseIdx != null ? [opt.caseIdx] : tags().map((_, ci) => ci);
    return '<div class="bvGrids">' + only.map(ci => {
      const W = left + cw * L.length + 44, H = top + ch * n + 6;
      let g = svgOpen(W, H, "Build-out ladder, " + caseLabel(ci));
      L.forEach((f, s) => { g += txt(left + cw * s + cw / 2, 12, Math.round(f * 100) + "%", { anchor: "middle", fs: 9.5, fill: "#6f81a3" }); });
      order.forEach((ri, y) => {
        const p = B().paths.find(q => q.c === ci && q.r === ri), rows = pathRows(p), Y = top + ch * y;
        const isT = p.s != null, first = firstStep(p, rule, set);
        g += '<g opacity="' + (isT ? 1 : 0.5) + '">' + txt(left - 6, Y + ch / 2 + 3.5, areaId(ri), { anchor: "end", fs: 10, fill: isT ? "#e7edf7" : "#6f81a3" });
        rows.forEach(x => {
          const warned = [...responders(x, rule, ci)].some(i => set.has(i)), sur = !!(x.sur.length || x.spill.length);
          const fill = sur ? COL.after : warned ? COL.before : "#16233a";
          const X = left + cw * x.s;
          const tip = areaId(ri) + " at " + stepPct(x.s) + " (+" + Math.round(x.dw) + " homes), " + caseLabel(ci) + ": " +
            (warned ? "a chosen sensor responds" : "no chosen sensor responds") + (sur ? "; " + (x.sur.length + x.spill.length) + " manhole(s) newly surcharged" + (x.spill.length ? " or spilling" : "") : "; nothing surcharged");
          g += '<rect x="' + (X + 1) + '" y="' + (Y + 1) + '" width="' + (cw - 2) + '" height="' + (ch - 2) + '" rx="3" fill="' + fill + '" data-vt="' + esc(tip) + '"/>';
          if (sur && warned) g += '<circle cx="' + (X + cw / 2) + '" cy="' + (Y + ch / 2) + '" r="3.5" fill="' + COL.before + '" stroke="#0d1117" stroke-width="1.5" pointer-events="none"/>';
        });
        if (first != null && (!isT || first < p.s)) g += txt(left + cw * first + cw / 2, Y + ch / 2 + 4, "◆", { anchor: "middle", fs: 11, fill: "#e7edf7" });
        if (isT) {
          g += txt(left + cw * p.s + cw / 2, Y + ch / 2 + 4, "✕", { anchor: "middle", fs: 11, fill: "#ffffff", weight: 700 });
          const o = first == null ? "never" : first <= p.s - B().settings.margin_steps ? "before" : first <= p.s ? "same" : "after";
          const lab = o === "before" ? "×" + (L[p.s] / L[first]).toFixed(L[p.s] / L[first] < 10 ? 1 : 0) : o === "same" ? "late" : o === "after" ? "late" : "none";
          g += txt(left + cw * L.length + 6, Y + ch / 2 + 3.5, lab, { fs: 10, fill: o === "before" ? "#7ee2bf" : "#ff9aac", weight: 600 });
        }
        g += "</g>";
      });
      return '<figure class="bvFig"><figcaption>' + esc(caseLabel(ci)) + "</figcaption>" + g + "</svg></figure>";
    }).join("") + "</div>" +
      legend([[COL.before, "a chosen sensor responds"], [COL.after, "a manhole has newly surcharged"], ["#16233a", "quiet"]]) +
      '<p class="bvNote">◆ first response of a chosen sensor &nbsp; ✕ first new surcharge &nbsp; ×N at the right: surcharge comes at N times the build-out of the first warning. A green dot on red is a detection that came too late to be a warning. Faded rows never overload.</p>';
  }

  // V2. Where Sim 3's score came from: its credited runs, before vs after surcharge.
  function creditBars(rule, which) {
    const pub = B().published[rule];
    if (!pub || !pub[which]) return '<p class="bvNote">Sim 3 published no ' + esc(which) + " sets under " + esc(RULE_LABEL[rule]) + ".</p>";
    const rows = pub[which], max = Math.max(...rows.map(r => r.credited)), W = 520, H = 190, L = 34, T = 10, Bt = 26, bw = (W - L - 10) / rows.length;
    const y = v => T + (H - T - Bt) * (1 - v / max);
    let g = svgOpen(W, H, "Runs Sim 3 credits to its sets, before and after surcharge");
    [0, Math.round(max / 2), max].forEach(v => { g += '<line x1="' + L + '" x2="' + (W - 10) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#22314d"/>' + txt(L - 5, y(v) + 3.5, v, { anchor: "end", fs: 9.5, fill: "#6f81a3" }); });
    rows.forEach((r, i) => {
      const x = L + bw * i + 4, w = bw - 8, ok = r.credited - r.creditedSurcharged;
      const tip = "Sim 3 " + which + ", " + r.k + " sensor" + (r.k === 1 ? "" : "s") + ": credited with " + r.credited + " runs; " + r.creditedSurcharged + " (" + pct(r.creditedSurcharged / Math.max(1, r.credited)) + ") had already surcharged a manhole";
      g += '<rect x="' + x + '" y="' + y(ok) + '" width="' + w + '" height="' + (y(0) - y(ok)) + '" rx="2" fill="' + COL.before + '" data-vt="' + esc(tip) + '"/>';
      g += '<rect x="' + x + '" y="' + y(r.credited) + '" width="' + w + '" height="' + Math.max(0, y(ok) - y(r.credited) - 2) + '" rx="2" fill="' + COL.after + '" data-vt="' + esc(tip) + '"/>';
      g += txt(x + w / 2, y(r.credited) - 3, pct(r.creditedSurcharged / Math.max(1, r.credited)), { anchor: "middle", fs: 9, fill: "#ff9aac" });
      g += txt(x + w / 2, H - Bt + 13, r.k, { anchor: "middle", fs: 10, fill: "#6f81a3" });
    });
    g += txt((L + W) / 2, H - 2, "sensors", { anchor: "middle", fs: 10, fill: "#6f81a3" });
    return legend([[COL.before, "credited runs with no manhole surcharged yet"], [COL.after, "credited runs already surcharged (share above the bar)"]]) + g + "</svg>";
  }

  // V3. Before-surcharge curves against the number of sensors.
  function curves(rule, scheme, radius, kSel) {
    const res = B().results[rule];
    if (!res.exact) return '<p class="bvNote">No target can be warned under this rule.</p>';
    const kmax = res.exact[scheme].length, pub = B().published[rule];
    const series = [
      { name: "Sim 4 exact, worst case", col: "#c084fc", v: res.exact[scheme].map(e => e.worst) },
      { name: "Sim 4 exact, average", col: "#9085e9", v: res.exact[scheme].map(e => e.average), thin: true },
      { name: "Sim 4 located within " + radius + " m, worst", col: "#c084fc", v: res.locate[String(radius)].sets.map(e => e.worst), dash: true },
    ];
    if (pub) series.push({ name: "Sim 3 exact set, worst (scored the new way)", col: "#3987e5", v: pub.exact.map(e => evaluate(e.chosen, rule, scheme).worst) });
    series.push({ name: "Greedy, worst", col: "#8b949e", v: res.greedy.curve.map(c => c.worst), dash: true, thin: true });
    const W = 520, H = 200, L = 36, R = 12, T = 10, Bt = 26;
    const x = i => L + (W - L - R) * i / (kmax - 1), y = v => T + (H - T - Bt) * (1 - v);
    let g = svgOpen(W, H, "Share of overloads warned before surcharge against sensors");
    [0, 0.5, 1].forEach(v => { g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#22314d"/>' + txt(L - 5, y(v) + 3.5, pct(v), { anchor: "end", fs: 9.5, fill: "#6f81a3" }); });
    g += '<line x1="' + x(kSel - 1) + '" x2="' + x(kSel - 1) + '" y1="' + T + '" y2="' + (H - Bt) + '" stroke="#a9b8d4" stroke-dasharray="3 3"/>';
    series.forEach(s => {
      g += '<path d="' + s.v.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ") + '" fill="none" stroke="' + s.col + '" stroke-width="' + (s.thin ? 1.5 : 2) + '"' + (s.dash ? ' stroke-dasharray="5 4"' : "") + "/>";
      s.v.forEach((v, i) => { g += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="' + (i === kSel - 1 ? 4.5 : 2.5) + '" fill="' + s.col + '" stroke="#111c2f" stroke-width="2" data-vt="' + esc(s.name + ", " + (i + 1) + " sensors: " + pct(v)) + '"/>'; });
    });
    for (let i = 0; i < kmax; i++) g += txt(x(i), H - Bt + 14, i + 1, { anchor: "middle", fs: 10, fill: i === kSel - 1 ? "#e7edf7" : "#6f81a3" });
    g += txt((L + W) / 2, H - 2, "sensors", { anchor: "middle", fs: 10, fill: "#6f81a3" });
    return legend(series.map(s => [s.col, s.name, s.dash])) + g + "</svg>";
  }

  // V4. Outcome bars for every set at k, plus the ceiling (a sensor at every manhole).
  function outcomeBars(rule, k, scheme) {
    const all = sets(rule, k, scheme).map(s => Object.assign(s, outcomes(s.chosen, rule)));
    const n = S().regions.length ? targets().length : 0;
    all.push(Object.assign({ id: "ceil", name: "Ceiling: a sensor at every manhole" }, outcomes(new Set(Array.from({ length: B().geometry.length }, (_, i) => i)), rule)));
    const W = 520, lab = 190, bh = 18, gap = 9, H = all.length * (bh + gap) + 8, sc = (W - lab - 10) / n;
    let g = svgOpen(W, H, "Outcome of every overloading build-out for each set");
    all.forEach((s, j) => {
      const Y = 4 + j * (bh + gap);
      g += txt(lab - 8, Y + bh / 2 + 4, s.name, { anchor: "end", fs: 10.5, fill: s.isNew ? "#e3c8ff" : "#a9b8d4", weight: s.isNew ? 600 : 400 });
      let X = lab;
      ["before", "same", "after", "never"].forEach(o => {
        const v = s.cnt[o];
        if (!v) return;
        const w = v * sc;
        g += '<rect x="' + X + '" y="' + Y + '" width="' + Math.max(1, w - 2) + '" height="' + bh + '" rx="3" fill="' + COL[o] + '" data-vt="' + esc(s.name + ": " + v + " of " + n + " overloads " + OUTCOME[o]) + '"/>';
        if (w > 16) g += txt(X + w / 2 - 1, Y + bh / 2 + 4, v, { anchor: "middle", fs: 10, fill: "#ffffff", weight: 600 });
        X += w;
      });
    });
    return legend(Object.keys(COL).map(o => [COL[o], OUTCOME[o]])) + g + "</svg>" +
      '<p class="bvNote">Counts out of the ' + n + " build-outs that newly surcharge a manhole somewhere by 300%. The ceiling shows what no set can beat with these seven build-out steps.</p>";
  }

  // V5. Warning margin: one dot per warned overload, by case, on a log axis.
  function marginStrip(rule, set) {
    const oc = outcomes(set, rule), cs = tags().map((_, ci) => ci).filter(ci => targets().some(p => p.c === ci));
    const W = 560, lab = 196, miss = 116, T = 18, rh = 22, H = T + rh * cs.length + 24, lo = Math.log(1), hi = Math.log(32);
    const x = v => lab + (W - lab - miss - 10) * (Math.log(v) - lo) / (hi - lo);
    let g = svgOpen(W, H, "Warning margins, build-out at surcharge over build-out at first warning");
    g += '<rect x="' + x(1) + '" y="' + (T - 4) + '" width="' + (x(1.5) - x(1)) + '" height="' + (rh * cs.length + 4) + '" fill="#e5484d22"/>';
    [1, 1.5, 2, 4, 8, 16, 30].forEach(v => { g += '<line x1="' + x(v) + '" x2="' + x(v) + '" y1="' + (T - 4) + '" y2="' + (T + rh * cs.length) + '" stroke="#22314d"/>' + txt(x(v), H - 8, "×" + v, { anchor: "middle", fs: 9.5, fill: "#6f81a3" }); });
    cs.forEach((ci, j) => {
      const Y = T + j * rh + rh / 2;
      g += txt(lab - 8, Y + 3.5, caseLabel(ci), { anchor: "end", fs: 10, fill: "#a9b8d4" });
      const items = oc.list.filter(t => t.p.c === ci);
      const seen = {};
      items.filter(t => t.o === "before").forEach(t => {
        const key = t.margin.toFixed(2), off = (seen[key] = (seen[key] || 0) + 1) - 1;
        g += '<circle cx="' + x(Math.min(30, t.margin)) + '" cy="' + (Y - 4 + off * 5) + '" r="4.5" fill="' + COL.before + '" stroke="#111c2f" stroke-width="2" data-vt="' +
          esc(areaId(t.p.r) + ", " + caseLabel(ci) + ": first warning at " + stepPct(t.f) + ", first surcharge at " + stepPct(t.p.s) + " (×" + t.margin.toFixed(1) + ")") + '"/>';
      });
      const nw = items.filter(t => t.o !== "before");
      if (nw.length) g += '<text x="' + (W - miss + 4) + '" y="' + (Y + 3.5) + '" font-size="9.5" fill="#ff9aac" data-vt="' + esc("Not warned before surcharge in " + caseLabel(ci) + ": " + nw.map(t => areaId(t.p.r)).join(", ")) + '">' +
        nw.length + " not warned" + (nw.length < 3 ? " (" + nw.map(t => areaId(t.p.r)).join(" ") + ")" : "") + "</text>";
    });
    return g + "</svg>" + '<p class="bvNote">Each dot is one overloading build-out the set warns of: how many times more growth it takes to surcharge than to first respond. The red band (under ×1.5) leaves little room to act.</p>';
  }

  // V6. Signature matrix: which chosen sensors respond to each overload at its warning step.
  function signatures(rule, set, ci, radius) {
    set = [...set].sort((a, b) => a - b);
    const gIdx = (B().results[rule].cases || []).indexOf(ci);
    const ts = targets().filter(p => p.c === ci);
    if (!ts.length) return '<p class="bvNote">No build-out overloads in ' + esc(caseLabel(ci)) + ": nothing to warn of or locate.</p>";
    const pairs = gIdx >= 0 ? B().results[rule].locate[String(radius)].pairs[gIdx] : [];
    const sig = p => set.filter(i => warnSet(p, rule).has(i));
    const key = p => sig(p).join(",");
    const rows = ts.slice().sort((a, b) => key(b).localeCompare(key(a)) || a.r - b.r);
    const amb = new Set();
    pairs.forEach(([ra, rb]) => { const a = ts.find(p => p.r === ra), b = ts.find(p => p.r === rb); if (a && b && key(a) === key(b)) { amb.add(a.r); amb.add(b.r); } });
    const cw = 34, rh = 20, lab = 54, T = 30, W = lab + cw * set.length + 230, H = T + rh * rows.length + 6;
    let g = svgOpen(W, H, "Sensor response pattern for each overload, " + caseLabel(ci));
    set.forEach((i, j) => { g += txt(lab + cw * j + cw / 2, 12, "S" + (j + 1), { anchor: "middle", fs: 10, fill: "#e7edf7", weight: 600 }) + txt(lab + cw * j + cw / 2, 24, String(window.GROWTH_RUNS.manholeIds[i]).slice(-4), { anchor: "middle", fs: 8.5, fill: "#6f81a3" }); });
    rows.forEach((p, y) => {
      const Y = T + rh * y, s = sig(p), bad = amb.has(p.r);
      g += txt(lab - 8, Y + rh / 2 + 3.5, areaId(p.r), { anchor: "end", fs: 10.5, fill: "#e7edf7" });
      set.forEach((i, j) => {
        const on = s.includes(i);
        g += '<rect x="' + (lab + cw * j + 2) + '" y="' + (Y + 2) + '" width="' + (cw - 4) + '" height="' + (rh - 4) + '" rx="3" fill="' + (on ? "#c084fc" : "#16233a") + '" data-vt="' +
          esc("S" + (j + 1) + " (" + mhId(i) + ") " + (on ? "responds" : "does not respond") + " to " + areaId(p.r) + " at its warning step, " + (p.s - B().settings.margin_steps >= 0 ? stepPct(p.s - B().settings.margin_steps) : "none")) + '"/>';
      });
      if (bad) g += '<rect x="' + (lab - 2) + '" y="' + (Y + 0.5) + '" width="' + (cw * set.length + 4) + '" height="' + (rh - 1) + '" rx="4" fill="none" stroke="#e5484d" stroke-width="1.5"/>';
      const tail = (s.length ? "" : "not warned · ") + (bad ? "same pattern as a far overload · " : "") + "first surcharge " + p.F.map(mhId).join(", ");
      g += txt(lab + cw * set.length + 8, Y + rh / 2 + 3.5, tail.length > 46 ? tail.slice(0, 45) + "…" : tail, { fs: 9.5, fill: bad || !s.length ? "#ff9aac" : "#a9b8d4" });
    });
    return g + "</svg>" + '<p class="bvNote">Rows are the overloading areas in ' + esc(caseLabel(ci)) + ", grouped by the pattern of chosen sensors that respond one step before the surcharge. A red outline: two overloads whose first-surcharge manholes are more than " + radius +
      " m apart give the same pattern, so the alarm would not say which one it is.</p>";
  }

  // V7. Rule comparison: what each trigger can warn of at all, and with k sensors.
  function ruleCompare(k, scheme) {
    const rules = B().rules, n = targets().length, W = 520, lab = 110, bh = 9, rowH = 30, H = rules.length * rowH + 8, sc = (W - lab - 40) / n;
    let g = svgOpen(W, H, "Overloads warned before surcharge by rule");
    rules.forEach((r, j) => {
      const Y = 4 + j * rowH, ceil = B().ceiling[r].before, res = B().results[r];
      const got = res.exact ? outcomes(res.exact[scheme][k - 1].chosen, r).cnt.before : 0;
      g += txt(lab - 8, Y + 12, RULE_LABEL[r] + (NEW_RULES.includes(r) ? " ★" : ""), { anchor: "end", fs: 10.5, fill: NEW_RULES.includes(r) ? "#e3c8ff" : "#a9b8d4" });
      g += '<rect x="' + lab + '" y="' + Y + '" width="' + Math.max(1, ceil * sc) + '" height="' + bh + '" rx="2" fill="#4d5b75" data-vt="' + esc(RULE_LABEL[r] + ": a sensor at every manhole warns of " + ceil + " of " + n) + '"/>' + txt(lab + ceil * sc + 4, Y + 8.5, ceil, { fs: 9.5 });
      g += '<rect x="' + lab + '" y="' + (Y + bh + 2) + '" width="' + Math.max(1, got * sc) + '" height="' + bh + '" rx="2" fill="' + COL.before + '" data-vt="' + esc(RULE_LABEL[r] + ": the best " + k + " sensors warn of " + got + " of " + n) + '"/>' + txt(lab + got * sc + 4, Y + bh + 10.5, got, { fs: 9.5, fill: "#7ee2bf" });
    });
    return legend([["#4d5b75", "ceiling: a sensor at every manhole"], [COL.before, "the best " + k + " sensors for that rule"]]) + g + "</svg>" +
      '<p class="bvNote">Out of ' + n + " overloads. ★ new in Sim 4: the fullness rules, water reaching 70% or 80% of the outlet pipe's bore. A smaller trigger warns of more, but whether it stands out from everyday variation needs real level records.</p>";
  }

  // V8. Weighting stability: equal against by-homes.
  function weighting(rule, k) {
    const res = B().results[rule];
    if (!res.exact) return "";
    const a = res.exact.equal[k - 1].chosen, b = res.exact.homes[k - 1].chosen, shared = a.filter(i => b.includes(i));
    const chip = (i, on) => '<span class="bvChip' + (on ? " on" : "") + '" data-vt="' + esc(mhId(i)) + '">' + esc(String(window.GROWTH_RUNS.manholeIds[i])) + "</span>";
    const sc = (set, w) => { const e = evaluate(set, rule, w); return pct(e.worst) + " / " + pct(e.average); };
    return '<table class="sm bvT"><tr><th>Weights</th><th>The ' + k + ' sensors (shared ones lit)</th><th>Equal: worst / avg</th><th>Homes: worst / avg</th></tr>' +
      "<tr><td>Equal</td><td>" + a.map(i => chip(i, shared.includes(i))).join("") + "</td><td>" + sc(a, "equal") + "</td><td>" + sc(a, "homes") + "</td></tr>" +
      "<tr><td>By homes</td><td>" + b.map(i => chip(i, shared.includes(i))).join("") + "</td><td>" + sc(b, "equal") + "</td><td>" + sc(b, "homes") + "</td></tr></table>" +
      '<p class="bvNote">The two weightings share ' + shared.length + " of " + k + " sensors. Equal counts every overload once; by homes counts an area's overload by the homes it has today, which is how Sim 3 spreads infill.</p>";
  }

  return { COL, OUTCOME, RULE_LABEL, NEW_RULES, responders, targets, warnSet, firstStep, evaluate, outcomes, credited, sets, kFull, pathRows,
    ladderGrid, creditBars, curves, outcomeBars, marginStrip, signatures, ruleCompare, weighting, caseLabel, areaId, stepPct };
})();
