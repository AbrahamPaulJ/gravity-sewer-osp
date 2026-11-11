/* explore_ui.js - Sim 4's explorer (explore.html), opened from the story's Explore button: Sim 3.5's full page
   (simulation35/sim35_ui.js) on Sim 4's equal-home regions, Kim et al. (2022) spatial bisection, with the Walkerville
   Terrace corridor as an overlapping ninth region. Reads the story's regions (data/regions.js) and its own results
   (window.SIM4_EXPLORE, tools/build_sim4_explore.py); Sim 3's network, map and placement code are loaded from
   ../simulation3/ and Sim 3.5's map from ../simulation35/, never changed.
   The use case first, the uncertainty band underneath.

   Two growth families, as the network operator asked for them to be separated:
     infill      new homes spread through one of the regions in proportion to the
                 homes already there, from 10% to 300% of that region's share of the 2021 to
                 2041 planning projection (SIM3_REGIONS, from sim3_regions.py / sim3_analysis.py)
     greenfield  a new estate joining at one manhole, 10 to 700 dwellings (GROWTH_RUNS, the
                 Sim 2.5 grid, re-run with settled run lengths where it has been)
   plus "no growth": the suburb as it is, for the choke points and the baseline.

   The map is the live Sim 2.5 page's renderer (growth_3d.js) with its colours unchanged, so
   amber ("already over the alarm, not growth") and red ("sees this growth") keep meaning what
   they meant. THE DISTINCTION THIS INTERFACE EXISTS TO PROTECT is the same as Sim 2.5's: a
   manhole already surcharged before any houses were added is not evidence about growth.

   Simple view (default): the use case in words, the map, the recommended sensors with one
   "why" card each. Expert view: every case, rule, method, the curve, leave-one-case-out. */
"use strict";
window.Sim35UI = (function () {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));
  const pct = x => Math.round(x * 100) + "%";
  const row2 = (k, v) => '<div class="fact"><span>' + esc(k) + "</span><span>" + v + "</span></div>";

  const G = () => window.GROWTH_GEOM, R = () => window.GROWTH_RUNS, S = () => window.SIM3_REGIONS;
  const IDX = () => window.SIM3_INDEX;
  const ALARM_MM = window.GROWTH_RUNS.alarmMm;
  // Page rule ids and their plain names. The regions payload uses the same ids.
  const RULES = [
    { id: "alarm", label: ALARM_MM + " mm alarm", note: "Seen when the depth newly passes " + ALARM_MM + " mm above the pipe floor (a float switch's one trip level).", thr: null },
    { id: "r10", label: "Rise 10 mm", note: "Seen when the depth rises at least 10 mm over that manhole's own level before the growth (a level sensor, read over days).", thr: 10 },
    { id: "r25", label: "Rise 25 mm", note: "Seen when the depth rises at least 25 mm over that manhole's own level before the growth.", thr: 25 },
    { id: "r50", label: "Rise 50 mm", note: "Seen when the depth rises at least 50 mm over that manhole's own level before the growth.", thr: 50 },
  ];
  const ruleOf = id => RULES.find(r => r.id === id);
  // The selected region is shown by movement, not colour (23 Oct 2026, the team: colouring all
  // eight regions at once fought the result colours): its manholes pulse, its pipes carry the
  // blinking cyan sleeves, and it alone has a label at its centre. The colours below are for
  // the "Regions" view only: a quick look at how the suburb is divided, with every result colour
  // off while it is on.
  // Fixed by region id, not list position. Regions that touch on the map were checked pair by pair for colour
  // blindness when the regions were hand-picked; the equal-home regions (Kim et al. 2022 bisection) keep the same colours, R7 now
  // a tan since it is no longer the leftovers. R9, the corridor, overlaps the others and is never painted as an area.
  // No amber: that is the pump mains' colour.
  const REGION_COLS = { R1: "#3987e5", R2: "#d95926", R3: "#008300", R4: "#e87ba4", R5: "#199e70", R6: "#39c5cf", R7: "#b08457", R8: "#9085e9", R9: "#c9d1d9" };
  const isOverlay = ri => !!S().regions[ri].overlay;
  const regionCol = ri => REGION_COLS[S().regions[ri].id] || "#5b6470";
  const SIZES_TIP = "The size of the new estate, all of it draining into the sewer at the chosen manhole. 10, 30, 80 and 150 homes are realistic: one year of the whole council's growth landing at one point is about 30 to 80 homes, one apartment project 50 to 150. 700 is a stress case, roughly a decade of the council's growth in one place, kept as an upper bound and not a plausible development. For scale, the state projection (PlanSA, 2021 to 2041) is 390 to 485 new dwellings over twenty years for the whole council; the infill family spreads that figure over the regions, and Sim 2.5's corridor runs placed exactly 390 and 485 along Walkerville Terrace, where the state expects them.";
  // Region indices in the order of their ids (R1, R2, ...), for the dropdown and the chips;
  // the data lists them in another order.
  const regionOrder = () => S().regions.map((r, i) => i).sort((a, b) => String(S().regions[a].id).localeCompare(String(S().regions[b].id), undefined, { numeric: true }));
  const strip = html => String(html).replace(/<[^>]+>/g, "");
  /* Which region every point on the map is drawn in. The data lists manholes only, so a pipe run with no manhole at
     either end had no colour and fell back to the default blue. A manhole shared by two regions keeps the first
     listed, as its pipes do. A point with no manhole takes the region of the manhole upstream of it, or, at the head
     of a line, the region it drains to. labelAt: the manhole for a region's label, the most central one in its
     largest connected piece, so a label always sits on its own region. */
  let _paint = null, _owner = null;
  // For every point on the map, the node of the manhole it is drawn with (-1 for an outfall).
  function nodeOwner() {
    if (_owner) return _owner;
    const g = G(), N = g.nodes.length, own = new Array(N).fill(-1), out = g.nodes.map(() => []);
    for (let p = 0; p < g.nPipes; p++) out[g.up[p]].push(p);
    g.nodes.forEach((nd, a) => { if (nd.kind === "chamber") own[a] = a; });
    for (let a = 0; a < N; a++) {
      if (g.nodes[a].kind !== "chamber") continue;
      const stack = [a];
      while (stack.length) out[stack.pop()].forEach(p => {
        const d = g.down[p];
        if (own[d] < 0 && g.nodes[d].kind === "inline") { own[d] = a; stack.push(d); }
      });
    }
    for (let a = 0; a < N; a++) {
      if (own[a] >= 0 || g.nodes[a].kind !== "inline") continue;
      const path = [a], seen = new Set();
      let cur = a;
      while (own[cur] < 0 && out[cur].length && !seen.has(cur)) { seen.add(cur); cur = g.down[out[cur][0]]; path.push(cur); }
      if (own[cur] >= 0) path.forEach(x => { own[x] = own[cur]; });
    }
    return (_owner = own);
  }
  function regionPaint() {
    if (_paint) return _paint;
    const g = G(), N = g.nodes.length, of = new Array(N).fill(-1), byChamber = {}, idx = {};
    g.nodes.forEach((nd, a) => { idx[nd.name] = a; });
    S().regions.forEach((r, ri) => { if (!r.overlay) r.manholes.forEach(i => { const a = idx[nameOf(i)]; if (byChamber[a] === undefined) byChamber[a] = ri; }); });
    nodeOwner().forEach((o, a) => { if (o >= 0 && byChamber[o] !== undefined) of[a] = byChamber[o]; });
    // Pipes take the colour growth_3d.js gives them: the downstream end's, else the upstream end's.
    const pipeRegion = p => of[g.down[p]] >= 0 ? of[g.down[p]] : of[g.up[p]];
    const pieces = [], labelAt = [];
    S().regions.forEach((r, ri) => {
      const parent = {};
      const find = x => { while (parent[x] !== undefined && parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      for (let p = 0; p < g.nPipes; p++) if (pipeRegion(p) === ri) { const u = find(g.up[p]), d = find(g.down[p]); parent[u] = u; parent[d] = d; if (u !== d) parent[u] = d; }
      const groups = {};
      Object.keys(parent).forEach(k => { const root = find(+k); (groups[root] = groups[root] || []).push(+k); });
      const list = Object.values(groups);
      const own = n => n.filter(a => of[a] === ri && g.nodes[a].kind === "chamber");
      const big = list.reduce((b, c) => own(c).length > own(b).length ? c : b, list[0] || []);
      const pts = own(big), cx = pts.reduce((t, a) => t + g.nodes[a].x, 0) / (pts.length || 1), cy = pts.reduce((t, a) => t + g.nodes[a].y, 0) / (pts.length || 1);
      const at = pts.reduce((b, a) => Math.hypot(g.nodes[a].x - cx, g.nodes[a].y - cy) < Math.hypot(g.nodes[b].x - cx, g.nodes[b].y - cy) ? a : b, pts[0]);
      pieces.push(list.length);
      labelAt.push(at === undefined ? nameOf(r.manholes[0]) : g.nodes[at].name);
    });
    let unpainted = 0;
    for (let p = 0; p < g.nPipes; p++) if (pipeRegion(p) < 0) unpainted++;
    _paint = { regionOfNode: of, labelAt, pieces, unpainted };
    window.SIM4_EXPLORE.regionPaint = { pieces, unpainted };                  // read by a page check
    return _paint;
  }
  const FAM_NOTE = {
    infill: "New homes spread through one region in proportion to the homes already there. The region's 100% is its share of the planning projection for the whole council area (" + S().anchor + " dwellings by 2041).",
    one: "A new estate joining the sewer at one manhole, all its flow entering there. Click a manhole to move it.",
    none: "No growth placed. The map shows the network as it is in the selected weather: manholes already over the alarm are amber. The sensors are still the ones chosen for growth.",
  };

  const st = {
    view: "simple", fam: "infill",
    region: 0, step: 4,                 // infill: region index, ladder index (100%)
    site: null, add: 3,                 // greenfield: chamber index, growth size index
    caseTag: null,                      // the uncertainty case, by tag (shared by the families)
    rule: "r10", k: 5, method: "warn", obj: "worst",
    showSensors: true, showHeat: false, showPumps: false, showConn: false,
    hover: null, pick: null,            // hovered / clicked manhole NAME for the right panel
    legend: false,                      // the colour key, off until asked for
    areasView: false,                   // every region in its colour, nothing else
    coverView: false,                   // the map coloured by which sensor sees growth where
    rb: true, lb: true, top: true,      // right panel, left panel, top bar shown
    words: true,                        // the summary bubble on the map open
  };

  /* ------------------------------------------------------------- index spaces */
  const names = () => R().chambers;                 // chamber index -> SWMM name "MH<id>"
  const nameOf = i => R().chambers[i];
  const mhOf = i => R().manholeIds[i];
  const label = i => "MH " + mhOf(i);
  const idxOfName = {};
  let regionOf = [];                                // chamber index -> region index or -1

  /* ------------------------------------------------------------------- cases */
  // Each family publishes its own case list; the page keeps one selection by tag and falls
  // back to the same weather level where a family has not run a variant yet.
  // "No growth" reads the settled infill baselines, so it shares the infill case list.
  const famCases = () => st.fam === "one" ? R().cases : S().cases;
  function caseIndex() {
    const cs = famCases();
    let i = cs.findIndex(c => c.tag === st.caseTag);
    if (i < 0) {
      const want = S().cases.find(c => c.tag === st.caseTag);
      i = want ? cs.findIndex(c => Math.abs(c.ii - want.ii) < 1e-6) : -1;
    }
    return i < 0 ? 0 : i;
  }
  const curCase = () => famCases()[caseIndex()];
  const curTag = () => curCase().tag;
  const caseFellBack = () => curTag() !== st.caseTag;

  /* --------------------------------------------------------------- infill */
  const region = () => S().regions[st.region];
  const ladder = () => S().ladder;
  const infillRow = (tag, ri, si) => (S().rows[tag] || []).find(r => r.r === ri && r.s === si) || null;
  const curRow = () => infillRow(curTag(), st.region, st.step);
  const thr = () => ruleOf(st.rule).thr;
  // Which chambers see a region row under a rule: the alarm list, or the rises past the threshold.
  function seers(row, rule) {
    if (!row) return [];
    if (rule === "alarm") return row.alarm.slice();
    const t = ruleOf(rule).thr;
    return row.rise.filter(x => x[1] >= t).map(x => x[0]);
  }
  function infillState(row) {
    const out = {};
    const base = S().base[curTag()];
    if (st.rule === "alarm") base.alarm.forEach(i => { out[i] = "was"; });
    if (row) {
      const seen = new Set(seers(row, st.rule));
      row.rise.forEach(([i, mm]) => {
        if (seen.has(i)) out[i] = "tip";
        else if (mm >= 10 && !out[i]) out[i] = "rise";
      });
      if (st.rule === "alarm") row.alarm.forEach(i => { out[i] = "tip"; });
    }
    return out;
  }
  // Infill placement: the exact optimum per k, or greedy's nested order, worst case over cases.
  const WARN = rule => (window.SIM4_EXPLORE.warn || {})[rule];
  const WARN_TIP = "A sensor warns when it responds at least one build-out step before the first manhole newly surcharges along that region's build-out. " +
    "The set is chosen for the worst of the 7 wet cases, from every manhole. Unseen means chosen without the weather case or region tested, then scored on it: higher is better, and it is the fairer guide.";
  function warnSentence(pl) {
    const e = pl.warn, W = WARN(st.rule);
    return "<p style='margin:0 0 8px'><b>" + e.k + "</b> sensor" + (e.k === 1 ? " warns" : "s warn") + " of <b>" + e.plausible_warned + " of " + W.plausible_total + "</b> overloads by 100% build-out, before the first surcharge" +
      (e.needed < e.k ? " (" + e.needed + " would do; the rest are chosen to see more growth)" : "") + ". " +
      "Chosen without the part tested: <b>" + e.plausible_unseen_weather + " of " + W.plausible_total + "</b> on unseen weather, <b>" + e.plausible_unseen_region + " of " + W.plausible_total + "</b> on an unseen region. " +
      "They also see " + pct(e.detect_worst) + " of detectable growth in the worst wet case.</p>";
  }
  function infillPlacement() {
    const rr = S().rules[st.rule];
    if (!rr) return { chosen: [], worst: null, average: null, curve: [] };
    if (st.method === "warn" && WARN(st.rule)) {
      const e = WARN(st.rule).sets[st.k - 1];
      return { chosen: e.chosen.slice(), worst: e.detect_worst, average: e.detect_average, warn: e };
    }
    if (st.method === "risk" && rr.risk && rr.risk.exact && rr.risk.exact.length) {
      const e = rr.risk.exact.find(x => x.k === st.k) || rr.risk.exact[Math.min(st.k, rr.risk.exact.length) - 1];
      const c = (rr.risk.compare || []).find(x => x.k === e.k);
      return { chosen: e.chosen.slice(), worst: c ? c.risk_set.plain : null, average: null, riskWorst: e.worst, compare: c };
    }
    if ((st.method === "exact" || st.method === "warn") && rr.exact && rr.exact.length) {
      const e = rr.exact.find(x => x.k === st.k) || rr.exact[Math.min(st.k, rr.exact.length) - 1];
      const c = rr.risk && (rr.risk.compare || []).find(x => x.k === e.k);
      return { chosen: e.chosen.slice(), worst: e.worst, average: e.average, status: e.status, riskWorst: c && c.plain_set ? c.plain_set.risk : null, compare: c };
    }
    const c = rr.greedy.curve[Math.min(st.k, rr.greedy.curve.length) - 1] || {};
    return { chosen: rr.greedy.chosen.slice(0, st.k), worst: c.worst, average: c.average };
  }
  // Each candidate's own coverage of the infill scenarios (worst and mean over cases), for the
  // heatmap and the cards. Computed once per rule from the same rows the map paints.
  const _heatInfill = {};
  function infillHeat() {
    if (_heatInfill[st.rule]) return _heatInfill[st.rule];
    const n = names().length, per = [];
    S().cases.forEach(c => {
      const rows = S().rows[c.tag] || [];
      const det = rows.map(r => new Set(seers(r, st.rule))).filter(s => s.size);
      if (!det.length) return;
      const f = new Array(n).fill(0);
      det.forEach(s => s.forEach(i => { f[i]++; }));
      per.push(f.map(x => x / det.length));
    });
    const worst = [], mean = [];
    for (let i = 0; i < n; i++) {
      const v = per.map(f => f[i]);
      worst.push(v.length ? Math.min(...v) : 0);
      mean.push(v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
    }
    return (_heatInfill[st.rule] = { worst, mean });
  }

  /* ------------------------------------------------------------ greenfield */
  function cell() {
    const Rr = R(), add = Rr.growthLevels[st.add];
    return Rr.cells.find(c => c.case === caseIndex() && c.add === add && c.rule === st.rule) || Rr.cells[0];
  }
  const rowFor = (c, site) => c.rows.find(r => r.site === site) || null;
  function oneState(c, row) {
    const out = {};
    c.base.forEach(i => { out[i] = "was"; });
    if (row) row.tip.forEach(i => { out[i] = "tip"; });
    if (row && st.rule !== "r10") {
      const c10 = R().cells.find(x => x.case === caseIndex() && x.add === R().growthLevels[st.add] && x.rule === "r10");
      const r10 = c10 && rowFor(c10, st.site);
      if (r10) r10.tip.forEach(i => { if (!out[i]) out[i] = "rise"; });
    }
    return out;
  }
  function onePlacement() {
    // The greenfield grid publishes greedy only (nested, by objective). The exact solver has
    // run on the infill family; for greenfield the greedy set stands in and the note says so.
    const pl = R().sensors[st.rule][st.obj];
    const k = Math.min(st.k, pl.order.length);
    return { chosen: pl.order.slice(0, k), worst: pl.worst[k - 1], average: pl.mean[k - 1], curveWorst: pl.worst, curveMean: pl.mean };
  }
  const spillBefore = () => (R().baseSpilled ? R().baseSpilled[caseIndex()] : []);
  function spillNewOne() {
    const Rr = R();
    if (!Rr.spill || st.site == null) return [];
    const hit = (Rr.spill[caseIndex()][String(Rr.growthLevels[st.add])] || []).find(x => x[0] === st.site);
    return hit ? hit[1] : [];
  }

  /* ----------------------------------------------------------------- sensors */
  // The recommendation is the infill placement; the greenfield family scores its own grid.
  function placement() {
    return st.fam === "one" ? onePlacement() : infillPlacement();
  }
  const sensorSet = () => (st.showSensors ? placement().chosen.map(nameOf) : []);
  function heatValues() {
    if (!st.showHeat) return null;
    const h = st.fam === "infill" ? infillHeat() : R().heat[st.rule];
    const v = h[st.obj], levels = [...new Set(v)].sort((a, b) => a - b), n = levels.length, out = {};
    v.forEach((x, i) => { out[nameOf(i)] = n > 1 ? levels.indexOf(x) / (n - 1) : 1; });
    return out;
  }

  /* ------------------------------------------------------------------ paint */
  function repaint() {
    const sensors = sensorSet();
    Growth3D.setCoverSelect(null);
    let named = {}, site = null, spillsBefore = [], spillsNew = [];
    if (st.fam === "infill") {
      const row = curRow(), byIdx = infillState(row);
      for (const k in byIdx) named[nameOf(+k)] = byIdx[k];
      const base = S().base[curTag()];
      spillsBefore = base.spilled.map(nameOf);
      spillsNew = row ? row.spill.map(nameOf) : [];
      Growth3D.setScenario([]);
    } else if (st.fam === "one") {
      const c = cell(), row = rowFor(c, st.site), byIdx = oneState(c, row);
      for (const k in byIdx) named[nameOf(+k)] = byIdx[k];
      site = st.site == null ? null : nameOf(st.site);
      spillsBefore = spillBefore().map(nameOf);
      spillsNew = spillNewOne().map(nameOf);
      Growth3D.setScenario([]);
    } else {
      if (st.rule === "alarm") {
        const base = st.fam === "none" && S().cases.some(c => c.tag === curTag()) && S().base[curTag()]
          ? S().base[curTag()].alarm : (R().baseOver[caseIndex()] || []);
        base.forEach(i => { named[nameOf(i)] = "was"; });
      }
      spillsBefore = (S().base[curTag()] ? S().base[curTag()].spilled : spillBefore()).map(nameOf);
      Growth3D.setScenario([]);
    }
    if (st.areasView) {
      const tints = {};
      regionPaint().regionOfNode.forEach((ri, a) => { if (ri >= 0) tints[G().nodes[a].name] = regionCol(ri); });
      Growth3D.setRegionTints(tints);
      Growth3D.paint({}, null, [], null);
      Growth3D.setPulse([]);
      Growth3D.setRegionLabels(S().regions.map((r, ri) => ({ names: [regionPaint().labelAt[ri]], text: r.id, col: regionCol(ri) })).filter((x, ri) => !isOverlay(ri)));
      Growth3D.setSpills([], []);
    } else if (coverOn()) {
      paintCover(site, sensors);
    } else {
      Growth3D.setRegionTints(null);
      Growth3D.paint(named, site, sensors, heatValues());
      if (st.fam === "infill") {
        Growth3D.setPulse(region().manholes.map(nameOf));
        Growth3D.setRegionLabels([{ names: [regionPaint().labelAt[st.region]], text: region().id, col: "#00d4ff" }]);
      } else { Growth3D.setPulse([]); Growth3D.setRegionLabels([]); }
      Growth3D.setSpills(spillsBefore, spillsNew);
    }
    Growth3D.setPumpRates([]);
    renderHomes(sensors);
    renderKnobs();
    renderStrip();
    syncDDs();
    renderPanel();
    renderSide();
    renderSensors();
    renderCover();
    renderWords();
    legendKeys();
    $("#heatWhich").textContent = (st.obj === "worst" ? "worst of the " : "average of the ") + famCases().length +
      " cases, " + ruleOf(st.rule).label.toLowerCase() + (st.fam === "infill" ? ", infill scenarios" : ", greenfield scenarios");
  }

  /* ------------------------------------------------------------------ homes */
  // The homes key, fixed shape (see Sim 2.5): hover previews a manhole's homes; otherwise the
  // selected region's homes (infill), the sensors' catchment, or the growth manhole's homes.
  function renderHomes(sensors) {
    const mhName = nm => { const n = G().nodes.find(x => x.name === nm); return n && n.mh ? "MH " + n.mh : nm; };
    const row = (col, text, ring) => text && text !== "&nbsp;" ? "<span>" + (col ? '<span class="k' + (ring ? " ring" : "") + '" style="background:' + col + '"></span>' : "") + text + "</span>" : "";
    const put = (head, r1, r2, r3, hint) => {
      $("#homesLine").innerHTML = (head ? '<span class="hd">' + head + "</span>" : "") + r1 + r2 + r3 + (hint ? '<span class="quiet2">' + hint + "</span>" : "");
    };
    let spec, lead;
    if (st.areasView) spec = { mode: "none" };
    else if (st.hover) { spec = { mode: "site", name: st.hover }; lead = "Homes behind " + esc(mhName(st.hover)); }
    else if (coverOn()) spec = { mode: "none" };
    else if (st.fam === "infill") spec = { mode: "region", names: region().manholes.map(nameOf) };
    else if (st.showSensors && sensors.length && st.fam !== "one") spec = { mode: "sensors", names: sensors };
    else if (st.fam === "one" && st.site != null) { spec = { mode: "site", name: nameOf(st.site) }; lead = "Homes behind " + esc(label(st.site)); }
    else spec = st.showSensors && sensors.length ? { mode: "sensors", names: sensors } : { mode: "none" };
    const r = Growth3D.highlight(spec);
    if (!r) { put("", "", "", "", ""); return; }
    if (r.mode === "region") {
      const reg = region();
      put(esc(reg.id + ": " + shortName(reg)),
        row("#7dc4e0", "<strong>" + r.homes + "</strong> homes in the region, <strong>" + reg.nManholes + "</strong> manholes"),
        row("#00d4ff", "<strong>" + r.pipes + "</strong> pipes carry the new homes' flow"),
        row("#3a2430", "<strong>" + r.elsewhere + "</strong> homes elsewhere"),
        "");
      return;
    }
    if (r.mode === "none") {
      put("", row("#ff6f9c", "<strong>" + r.total + "</strong> connected homes"), "", "", "");
      return;
    }
    if (r.mode === "sensors") {
      put("Homes and the " + sensors.length + " sensor" + (sensors.length === 1 ? "" : "s"),
        row("#3fb950", "<strong>" + r.watched + "</strong> of " + r.total + " drain past a sensor (" + Math.round(100 * r.watched / r.total) + "%)"),
        row("", "<strong>" + r.unwatched + "</strong> do not"), "", "");
      return;
    }
    put(lead,
      row("#1f4fff", "<strong>" + r.here + "</strong> reach it first" + (r.here > r.direct ? " (" + (r.here - r.direct) + " via unrecorded pipe ends)" : ""), true),
      row("#7dc4e0", "<strong>" + r.through + "</strong> drain through it from further up"),
      row("#3a2430", "<strong>" + r.elsewhere + "</strong> elsewhere"),
      st.hover ? (st.fam === "one" ? "Click to move the growth here" : "Click to inspect it") : "");
  }
  const shortName = reg => reg.name.split(":")[0];

  /* ------------------------------------------------------------------ knobs */
  function buildCaseKnobs() {
    const cs = famCases();
    $("#iiKnob").innerHTML = cs.map((c, i) => "<button data-i=" + JSON.stringify(String(i)) + " title=" + JSON.stringify(c.note || "") + ">" +
      esc(c.label) + '<span class="knobNum">' + c.ii.toFixed(2) + " L/s/100m" + (c.settled === false ? ", 480 min" : "") + "</span></button>").join("");
    $("#nCases").textContent = cs.length;
  }
  // The simple strip's "where": the regions, then greenfield, then no growth.
  function buildStrip() {
    $("#whereSel").innerHTML = regionOrder().map(i => { const r = S().regions[i]; return "<option value=" + JSON.stringify("r" + i) + ">" + esc(r.id + ": " + shortName(r)) + "</option>"; }).join("") +
      '<option value="one">A new estate at one manhole</option><option value="none">Nowhere: the suburb today</option>';
    $("#whereSel").onchange = () => {
      const v = $("#whereSel").value;
      if (v === "one" || v === "none") { setFamily(v); return; }
      st.region = +v.slice(1); st.pick = null;
      if (st.fam !== "infill") setFamily("infill"); else repaint();
    };
    $("#howRange").oninput = () => {
      if (st.fam === "infill") st.step = +$("#howRange").value; else if (st.fam === "one") st.add = +$("#howRange").value;
      repaint();
    };
    $("#wxKnob").onclick = e => { const b = e.target.closest("button"); if (b) setWeather(b.dataset.w); };
    $("#kDown").onclick = () => { st.k = Math.max(1, st.k - 1); repaint(); };
    $("#kUp").onclick = () => { st.k = Math.min(+$("#kRange").max || 10, st.k + 1); repaint(); };
    // Arrows beside every dropdown: step through its options.
    $$(".arrow[data-for]").forEach(b => { b.onclick = () => {
      const sel = $("#" + b.dataset.for), n = sel.options.length;
      if (!n) return;
      sel.selectedIndex = (sel.selectedIndex + (+b.dataset.step) + n) % n;
      sel.dispatchEvent(new Event("change"));
    }; });
    $("#rTab").onclick = () => setFold("rb", !st.rb);
    $("#lTab").onclick = () => setFold("lb", !st.lb);
    $("#topTab").onclick = () => setFold("top", !st.top);
    $("#wordsTab").onclick = () => setWords(!st.words);
  }
  function setWords(on) {
    st.words = on;
    $("#inWords").classList.toggle("collapsed", !on);
    $("#wordsTab").innerHTML = on ? "&#9662;" : "&#9656;";
    $("#wordsTab").title = on ? "Fold the summary away" : "Show the summary";
  }
  // The fold tabs on the map's edges: top bar, left panel (expert only), right panel.
  function setFold(which, on) {
    st[which] = on;
    document.body.classList.toggle({ rb: "rbHidden", lb: "lbHidden", top: "topHidden" }[which], !on);
    $("#rTab").innerHTML = st.rb ? "&#9654;" : "&#9664;";
    $("#lTab").innerHTML = st.lb ? "&#9664;" : "&#9654;";
    $("#topTab").innerHTML = st.top ? "&#9650;" : "&#9660;";
    $("#rTab").title = st.rb ? "Fold the right panel away" : "Bring the right panel back";
    $("#lTab").title = st.lb ? "Fold the left panel away" : "Bring the left panel back";
    $("#topTab").title = st.top ? "Fold the top bar away" : "Bring the top bar back";
    Growth3D.resize($("#stage"));
  }
  const setRightPanel = on => setFold("rb", on);
  // Simple weather: Dry is the family's 0.0 case, Wet its Design wet case (0.11).
  const wxOf = () => (curCase().ii < 1e-6 ? "dry" : "wet");
  function setWeather(w) {
    const cs = famCases();
    const c = w === "dry" ? cs.find(x => x.ii < 1e-6) : (cs.find(x => Math.abs(x.ii - 0.11) < 1e-6 && /^Design wet$/.test(x.label)) || cs.find(x => Math.abs(x.ii - 0.11) < 1e-6));
    if (c) { st.caseTag = c.tag; repaint(); }
  }
  function renderStrip() {
    if (st.view !== "simple") return;
    $("#whereSel").value = st.fam === "infill" ? "r" + st.region : st.fam;
    const reg = region();
    const desc = String(reg.name).split(":").slice(1).join(":").trim();
    $("#whereSel").title = st.fam === "infill" ? reg.name : "";
    $("#whereHint").textContent = st.fam === "infill" ? (desc ? desc.charAt(0).toUpperCase() + desc.slice(1) + "; " : "") + reg.dwellings + " homes, " + reg.nManholes + " manholes today"
      : st.fam === "one" ? (st.site != null ? "At " + label(st.site) + ". Click another manhole to move it." : "Click a manhole on the map to place it.")
      : "No homes added. Amber manholes are over the alarm already.";
    const how = $("#howStep");
    if (st.fam === "infill") {
      const row = curRow(), f = ladder()[st.step];
      $("#howRange").disabled = false; $("#howRange").max = String(ladder().length - 1); $("#howRange").value = String(st.step);
      $("#howLbl").innerHTML = "+" + (row ? Math.round(row.dw) : Math.round(reg.nominal * f)) + " homes <span class='quiet' style='display:inline'>(" + Math.round(f * 100) + "% of its share)</span>";
      $("#howInfo").dataset.tip = "100% is this region's share of the council's 2021 to 2041 planning projection, " + Math.round(reg.nominal) + " homes on top of its " + reg.dwellings +
        " today. 25% is roughly the first year or two of that; 300% is a stress test. The homes are added all at once to today's pipes, with no upgrades; in reality they arrive over three to five years.";
    } else if (st.fam === "one") {
      $("#howRange").disabled = false; $("#howRange").max = String(R().growthLevels.length - 1); $("#howRange").value = String(st.add);
      const g = R().growthLevels[st.add];
      $("#howLbl").innerHTML = "+" + g + " homes in the new estate" + (g >= 500 ? " <span class='quiet' style='display:inline'>(stress case)</span>" : "");
      $("#howInfo").dataset.tip = SIZES_TIP;
    } else {
      $("#howRange").disabled = true; $("#howLbl").textContent = "No growth"; $("#howInfo").dataset.tip = "Nothing is added in this view; the map shows the network as it is in the selected weather.";
    }
    $$("#wxKnob button").forEach(b => b.classList.toggle("on", b.dataset.w === wxOf()));
    const c = curCase();
    $("#wxHint").textContent = c.label + (c.settled === false ? " (480-minute runs)" : "");
    $("#kBig").textContent = st.k + " sensor" + (st.k === 1 ? "" : "s");
    const pl = placement();
    $("#kHint").textContent = pl.warn ? "warn of " + pl.warn.plausible_warned + " of " + WARN(st.rule).plausible_total + " overloads by 100% build-out" : pl.worst != null ? "catch " + pct(pl.worst) + " of detectable growth, worst case" : "";
    $("#kInfo").dataset.tip = pl.warn ? WARN_TIP : "The best set of this many level sensors, chosen once for the worst of all " + famCases().length + " weather and leakage cases. " +
      "A level sensor counts as seeing growth when a manhole's water rises 10 mm or more over its own level before the growth. " +
      "Detectable growth means the scenarios that at least one manhole anywhere would see; the percentage is the share of those that this set notices." +
      (st.fam === "one" ? " For a new estate the set is built one sensor at a time (greedy); the infill set is the exact optimum." : " Each size is solved on its own, so the set for one more sensor need not contain this one.");
  }
  function buildKnobs() {
    const Rr = R();
    $("#ruleKnob").innerHTML = RULES.map(r => "<button data-r=" + JSON.stringify(r.id) + " title=" + JSON.stringify(r.note) + ">" + esc(r.label) + "</button>").join("");
    $("#addKnob").innerHTML = Rr.growthLevels.map((g, i) => "<button data-i=" + JSON.stringify(String(i)) + (g >= 500 ? ' title="A stress case, not a plausible estate"' : "") + ">+" + g + (g >= 500 ? '<span class="knobNum">stress case</span>' : "") + "</button>").join("");
    $("#addInfo").dataset.tip = SIZES_TIP;
    $("#region").innerHTML = regionOrder().map(i => { const r = S().regions[i]; return "<option value=" + JSON.stringify(String(i)) + " title=" + JSON.stringify(r.name) + ">" + esc(r.id + ": " + shortName(r)) + "</option>"; }).join("");
    $("#stepRange").max = String(ladder().length - 1);
    buildCaseKnobs();
    const on = (sel, fn) => { $(sel).onclick = e => { const b = e.target.closest("button"); if (!b) return; fn(b); }; };
    on("#viewKnob", b => setView(b.dataset.v));
    on("#famKnob", b => setFamily(b.dataset.f));
    on("#iiKnob", b => { st.caseTag = famCases()[+b.dataset.i].tag; repaint(); });
    buildStrip();
    on("#ruleKnob", b => { st.rule = b.dataset.r; repaint(); });
    $("#toggleLegend").onclick = () => { st.legend = !st.legend; legendGroups(); };
    $("#toggleAreas").onclick = () => { st.areasView = !st.areasView; if (st.areasView) st.coverView = false; legendGroups(); repaint(); };
    $("#toggleCover").onclick = () => {
      st.coverView = !st.coverView;
      if (st.coverView) { st.areasView = false; st.pick = null; if (!st.rb) setFold("rb", true); }
      legendGroups(); repaint();
    };
    $("#areasKeyList").innerHTML = regionOrder().filter(i => !isOverlay(i)).map(i => { const r = S().regions[i]; return '<span><span class="k" style="background:' + regionCol(i) + '"></span>' + esc(r.id + " " + shortName(r)) + "</span>"; }).join("") +
      regionOrder().filter(isOverlay).map(i => '<span class="quiet">' + esc(S().regions[i].id + ", " + shortName(S().regions[i]).replace(/ \(.*\)$/, "")) + ", overlaps the regions above, so it is not shaded.</span>").join("");
    on("#addKnob", b => { st.add = +b.dataset.i; repaint(); });
    on("#methKnob", b => { st.method = b.dataset.m; st.pickedGreedy = b.dataset.m === "greedy"; repaint(); });
    on("#objKnob", b => { st.obj = b.dataset.o; repaint(); });
    $("#region").onchange = () => { st.region = +$("#region").value; st.pick = null; repaint(); };
    $("#stepRange").oninput = () => { st.step = +$("#stepRange").value; repaint(); };
    $("#kRange").oninput = () => { st.k = +$("#kRange").value; repaint(); };
    $("#site").onchange = () => { st.site = $("#site").value === "" ? null : +$("#site").value; st.pick = null; repaint(); };
  }
  function renderKnobs() {
    $("#methWarn").hidden = !WARN(st.rule) || st.fam === "one";
    if (!WARN(st.rule) && st.method === "warn") st.method = "exact";
    const ci = caseIndex(), c = curCase();
    $$("#viewKnob button").forEach(b => b.classList.toggle("on", b.dataset.v === st.view));
    $$("#famKnob button").forEach(b => b.classList.toggle("on", b.dataset.f === st.fam));
    $$("#iiKnob button").forEach(b => b.classList.toggle("on", +b.dataset.i === ci));
    $$("#ruleKnob button").forEach(b => b.classList.toggle("on", b.dataset.r === st.rule));
    $$("#addKnob button").forEach(b => b.classList.toggle("on", +b.dataset.i === st.add));
    $$("#methKnob button").forEach(b => b.classList.toggle("on", b.dataset.m === st.method));
    $$("#objKnob button").forEach(b => b.classList.toggle("on", b.dataset.o === st.obj));
    $("#famInfo").dataset.tip = FAM_NOTE[st.fam];
    $("#infillBox").hidden = st.fam !== "infill";
    $("#oneBox").hidden = st.fam !== "one";
    $("#region").value = String(st.region);
    $("#region").title = region().name;
    $("#stepRange").value = String(st.step);
    $("#kRange").value = String(st.k);
    $("#kVal").textContent = String(st.k);
    $("#site").value = st.site == null ? "" : String(st.site);
    const settled = c.settled !== false;
    $("#iiBadge").innerHTML = '<span class="badge ' + (settled ? "settled" : "fixed") + '">' + (settled ? "settled runs" : "480-minute runs") + "</span>" +
      (caseFellBack() ? " <b>This family has not run the selected variant yet; its " + esc(c.label) + " case is shown.</b>" : "");
    $("#iiInfo").dataset.tip = (c.note || "") + " The sensors are chosen for the worst of all " + famCases().length + " cases, not just the one shown." +
      (settled ? "" : " This case's runs are the fixed 480-minute ones from Sim 2.5, not yet re-run to settlement.");
    const rl = ruleOf(st.rule);
    $("#ruleInfo").dataset.tip = rl.note + (st.rule === "alarm"
      ? " Manholes already over the alarm before any growth are amber: they cannot report it."
      : " Every manhole is judged against its own level before the growth, so nothing counts as already triggered.");
    if (st.fam === "infill") {
      const reg = region(), f = ladder()[st.step], row = curRow();
      $("#stepLbl").innerHTML = "<b>+" + (row ? Math.round(row.dw) : Math.round(reg.nominal * f)) + "</b> dwellings (" + Math.round(f * 100) + "% of the region's share)";
      $("#stepInfo").dataset.tip = "100% is this region's share of the 2041 projection, " + Math.round(reg.nominal) + " dwellings on its " + reg.dwellings +
        " today. 25% is roughly the first year or two; 300% is a stress test. The growth is added all at once to today's network, with no pipe upgrades; " +
        "in reality the dwellings arrive over three to five years, which is why the time-to-notice figures matter as much as the millimetres.";
    }
    $("#objKnob").style.display = st.fam !== "one" && st.method !== "greedy" ? "none" : "";
    $("#methKnob").style.display = st.fam === "one" ? "none" : "";      // the greenfield grid publishes greedy only, so there is nothing to choose
    $("#methNote").hidden = st.fam !== "one";
    const hasRisk = st.fam !== "one" && !!((S().rules[st.rule] || {}).risk);
    $("#methRisk").hidden = !hasRisk;
    if (!hasRisk && st.method === "risk") st.method = "exact";
    const methText = st.fam !== "one"
      ? (st.method === "warn" ? "Warn before surcharge: the best set of this size for warning at least one build-out step before the first new surcharge, worst of the 7 wet cases." : st.method === "exact" ? "Exact: the best set of this size, solved exactly over all cases for the worst case (PuLP + HiGHS). The recommendation."
         : st.method === "risk" ? "Risk-weighted: a severity x occurrence score of the kind Kimbrough (2019) uses, with this page's own scales. Severity is homes draining through the manhole where it bites; occurrence is how far it pushes that manhole towards 0.7 of its bore. The set that notices the most risk, solved exactly. A comparison, not the recommendation: it pulls sensors towards trunk mains already near capacity."
                               : "Greedy: each sensor is the best addition to the ones before it. Up to 10 points below the exact optimum at the same size.")
      : "The greenfield grid publishes the greedy order only; the exact solver has run on the infill family.";
    const objText = st.fam !== "one" && st.method !== "greedy" ? "" : (st.obj === "worst"
      ? " Best worst case: each sensor added is the one that most raises the worst of the cases, so whatever the unknowns turn out to be at least this much is caught."
      : " Best average: each sensor added is the one that most raises the average over the cases; catches more on average, but can leave one case poorly covered.");
    $("#sensInfo").dataset.tip = methText + objText + " Detectable growth: scenarios that at least one manhole sees. This scores whether a sensor would notice growth, not whether it watches a choke point; the choke points are under No growth.";
  }

  function setView(v) {
    st.view = v;
    document.body.classList.toggle("simple", v === "simple");
    document.body.classList.toggle("expert", v === "expert");
    if (v === "simple") {
      st.rule = "r10"; st.showHeat = false; $("#toggleHeat").classList.remove("primary");
      if (st.method === "risk") st.method = "exact";
      if (wxOf() !== "dry" && wxOf() !== "wet") setWeather("wet"); else if (!/^(Dry|Design wet)$/.test(curCase().label)) setWeather(wxOf());
    }
    repaint();
    Growth3D.resize($("#stage"));
  }
  function setFamily(f) {
    st.fam = f; st.pick = null; st.hover = null;
    if (f === "one" && (st.method === "exact" || st.method === "warn")) st.method = "greedy";
    if (f !== "one" && st.method === "greedy" && !st.pickedGreedy) st.method = "warn";
    buildCaseKnobs();
    repaint();           // the camera stays where the reader left it
  }

  /* ------------------------------------------------------------ left panel */
  function renderPanel() {
    const Rr = R(), c = curCase();
    if (st.fam === "infill") {
      const reg = region(), row = curRow();
      if (!row) {
        $("#siteFacts").innerHTML = '<p class="quiet">This region and build-out have no run in the selected case.</p>';
        $("#tipList").innerHTML = ""; $("#baseNote").innerHTML = ""; return;
      }
      const seen = seers(row, st.rule), top = row.rise[0];
      const chosen = placement().chosen, caught = chosen.filter(i => seen.includes(i));
      const base = S().base[curTag()];
      $("#siteFacts").innerHTML =
        row2("Adding", "<b>+" + Math.round(row.dw) + "</b> dwellings over " + reg.nManholes + " manholes, " + row.lps.toFixed(2) + " L/s") +
        row2("Largest rise", top ? "<b>+" + top[1].toFixed(1) + " mm</b> at " + label(top[0]) : "under 0.5 mm everywhere") +
        row2("Manholes that see it", seen.length ? '<b class="bad">' + seen.length + "</b> of " + names().length : "none under this rule") +
        row2("Newly over the alarm", row.alarm.length ? '<b class="bad">' + row.alarm.length + "</b>" : "none") +
        row2("Newly surcharged", row.sur.length ? '<b class="bad">' + row.sur.length + "</b>" : "none") +
        row2("Newly overflowing", row.spill.length ? '<b class="bad">' + row.spill.length + "</b> spill from the lid" : "none") +
        row2("The " + chosen.length + " chosen sensors", caught.length ? '<b class="good">' + caught.length + "</b> (" +
          caught.map(i => "S" + (chosen.indexOf(i) + 1)).join(", ") + ") " + (caught.length === 1 ? "sees" : "see") + " it" : '<b class="bad">none</b> of them sees this growth') +
        (row.run ? row2("Run", (row.run.converged ? "settled at " : "<b class='bad'>not settled</b> at ") + Math.round(row.run.minutes) + " min") : "");
      $("#tipList").innerHTML = seen.length
        ? "<h4>Manholes that see this growth</h4><ul>" + seen.slice(0, 40).map(i => { const mm = (row.rise.find(x => x[0] === i) || [0, 0])[1]; return "<li>" + esc(label(i)) + ' <span class="quiet">+' + Math.round(mm) + " mm</span></li>"; }).join("") + "</ul>" +
          (seen.length > 40 ? '<p class="quiet">and ' + (seen.length - 40) + " more</p>" : "")
        : '<p class="quiet">No manhole passes ' + esc(ruleOf(st.rule).label.toLowerCase()) + " at this build-out in this case. Try more growth, a wetter case, or a smaller rise.</p>";
      $("#baseNote").innerHTML = baseNote(base.alarm.length, base.spilled.length, names().length);
      return;
    }
    if (st.fam === "one") {
      const cl = cell(), row = rowFor(cl, st.site), add = Rr.growthLevels[st.add];
      $("#baseNote").innerHTML = baseNote(cl.base.length, spillBefore().length, names().length);
      if (st.site == null) {
        $("#siteFacts").innerHTML = '<p class="quiet">No manhole selected, so no growth is placed. Click a manhole on the map, or choose one above.</p>';
        $("#tipList").innerHTML = ""; return;
      }
      const tipped = row ? row.tip : [], chosen = placement().chosen, caught = chosen.filter(i => tipped.includes(i));
      const reach = Growth3D.reach(nameOf(st.site));
      $("#siteFacts").innerHTML =
        row2("Homes reaching it first", "<b>" + (reach ? reach.here : (Rr.dwellingsAt[st.site] || 0)) + "</b>") +
        row2("Adding", "<b>+" + add + "</b> dwellings" + (Rr.lpsPerDwelling ? ", " + (add * Rr.lpsPerDwelling[caseIndex()]).toFixed(2) + " L/s" : "")) +
        row2("Manholes that see it", tipped.length ? '<b class="bad">' + tipped.length + "</b>" : "none at this size") +
        (Rr.spill ? row2("Newly overflowing", spillNewOne().length ? '<b class="bad">' + spillNewOne().length + "</b> spill from the lid" : "none") : "") +
        row2("The " + chosen.length + " chosen sensors", caught.length ? '<b class="good">' + caught.length + "</b> (" +
          caught.map(i => "S" + (chosen.indexOf(i) + 1)).join(", ") + ") " + (caught.length === 1 ? "sees" : "see") + " it" : '<b class="bad">none</b> of them sees this growth') +
        row2("Runs", c.settled === false ? '<span class="badge fixed">480 min</span>fixed length, not settled' : '<span class="badge settled">settled</span>' + (c.unconverged ? c.unconverged + " of the case's runs hit the ceiling" : "every run settled"));
      $("#tipList").innerHTML = "<h4>Manholes that see this growth</h4>" + (tipped.length
        ? "<ul>" + tipped.map(i => "<li>" + esc(label(i)) + "</li>").join("") + "</ul>"
        : "<p class=quiet>No manhole passes the rule at +" + add + " dwellings in this case. Try more growth, a wetter case, or a smaller rise.</p>");
      return;
    }
    // No growth: the baseline and the choke points.
    const base = S().base[curTag()] || { alarm: R().baseOver[caseIndex()], surcharged: R().baseSurcharged[caseIndex()], spilled: spillBefore() };
    $("#siteFacts").innerHTML =
      row2("Over the alarm today", base.alarm.length ? '<b class="bad">' + base.alarm.length + "</b> of " + names().length : "none") +
      row2("Surcharged today", base.surcharged.length ? '<b class="bad">' + base.surcharged.length + "</b>" : "none") +
      row2("Overflowing today", base.spilled.length ? '<b class="bad">' + base.spilled.length + "</b>" : "none");
    const ck = S().chokePoints || [];
    $("#tipList").innerHTML = "<h4>Choke points (least headroom over the cases)</h4>" + (ck.length
      ? '<table class="sm"><tr><th>Manhole</th><th>Least headroom</th><th>Mean</th><th>In alarm, cases</th></tr>' +
        ck.slice(0, 12).map(x => "<tr><td>" + esc(label(x.i)) + "</td><td" + (x.headroomMin < 0 ? ' class="hi"' : "") + ">" + x.headroomMin.toFixed(0) + " mm</td><td>" +
          x.headroomMean.toFixed(0) + " mm</td><td>" + x.alarmCases + "</td></tr>").join("") + "</table>" +
        '<p class="quiet">Headroom is the distance below the ' + ALARM_MM + ' mm alarm before any growth; negative means already over it. Watching these is a different objective from noticing growth, and none of them is an early growth detector.</p>'
      : '<p class="quiet">No choke-point table published.</p>');
    $("#baseNote").innerHTML = baseNote(base.alarm.length, base.spilled.length, names().length);
  }
  const baseNote = (nAlarm, nSpill, n) => (st.rule !== "alarm"
    ? ""
    : nAlarm ? "<b>" + nAlarm + "</b> of " + n + " manholes are already over the alarm in this case <b>before any houses are added</b>. They are amber and cannot report the growth."
    : "No manhole is over the alarm before growth in this case.") +
    (nSpill ? " <b>" + nSpill + "</b> manhole" + (nSpill === 1 ? " already spills" : "s already spill") + " from the lid before any growth." : "");

  /* ------------------------------------------------------------- in words */
  function renderWords() {
    const c = curCase(), el = $("#wordsText");
    const wx = st.view === "simple" ? (wxOf() === "dry" ? "dry" : "wet") + " weather" : "<b>" + esc(c.label) + "</b> weather";
    const withTip = (short, long) => short + '<i class="info-i" data-tip="' + esc(long).replace(/"/g, "&quot;") + '">i</i>';
    if (st.fam === "infill") {
      const reg = region(), row = curRow();
      if (!row) { el.innerHTML = ""; return; }
      const seen = seers(row, st.rule), top = row.rise[0], chosen = placement().chosen, caught = chosen.filter(i => seen.includes(i));
      const fd = ((S().rules[st.rule] || {}).firstSeen || {})[reg.id] || {};
      const first = fd[curTag()];
      {
        const S_ = caught.map(i => "S" + (chosen.indexOf(i) + 1));
        const short = "<b>" + esc(reg.id) + "</b>, +" + Math.round(row.dw) + " homes, " + wx + ": " +
          (caught.length ? "<b>sensor" + (S_.length === 1 ? " " : "s ") + S_.join(", ") + (S_.length === 1 ? " sees" : " see") + " it</b>" : seen.length ? "<b>no chosen sensor sees it</b>, " + seen.length + " other manhole" + (seen.length === 1 ? " does" : "s do") : "<b>nothing moves enough to see</b>") + "." +
          (first ? " A sensor first sees this region at <b>" + Math.round(first[1] * 100) + "%</b> of its growth." : "");
        const long = (top && top[1] >= 0.5 ? "Largest rise " + top[1].toFixed(1) + " mm at " + label(top[0]) + ". " : "No manhole rises as much as half a millimetre. ") +
          seen.length + " manhole" + (seen.length === 1 ? "" : "s") + " rise 10 mm or more (the level-sensor rule). " +
          "Full build-out here is " + Math.round(reg.nominal) + " homes, this region's share of the 2041 projection. The case shown is " + c.label + "; the sensors were chosen for the worst of all cases." +
          (first ? " First seen at " + label(first[0]) + "." : " Under this rule no manhole sees this region at any build-out in this case: a blind spot.");
        el.innerHTML = '<span class="tag">Infill</span>' + withTip(short, long);
        return;
      }
      el.innerHTML = '<span class="tag">Infill</span><b>' + esc(reg.id + ", " + shortName(reg)) + "</b>: " + Math.round(row.dw) + " new dwellings (" +
        Math.round(ladder()[st.step] * 100) + "% of its 2041 share) in <b>" + esc(c.label) + "</b> weather. " +
        (top && top[1] >= 0.5 ? "Largest rise <b>" + top[1].toFixed(1) + " mm</b> at " + label(top[0]) + "; " : "No manhole rises as much as half a millimetre; ") +
        (seen.length ? "<b>" + seen.length + "</b> manhole" + (seen.length === 1 ? "" : "s") + " see it under the " + esc(ruleOf(st.rule).label.toLowerCase()) + " rule" : "nothing passes the rule") + ". " +
        (st.showSensors ? (caught.length ? "Sensor" + (caught.length === 1 ? " " : "s ") + caught.map(i => "S" + (chosen.indexOf(i) + 1)).join(", ") + (caught.length === 1 ? " sees" : " see") + " it." : "<b>None of the chosen sensors sees it.</b>") : "") +
        (first ? " In this weather a sensor first sees this region at <b>" + Math.round(first[1] * 100) + "%</b> build-out (" + label(first[0]) + ")." : " In this weather no sensor sees this region at any build-out.");
      return;
    }
    if (st.fam === "one") {
      if (st.site == null) { el.innerHTML = '<span class="tag">Greenfield</span>Click a manhole to place the new estate there.'; return; }
      const cl = cell(), row = rowFor(cl, st.site), tipped = row ? row.tip : [], chosen = placement().chosen, caught = chosen.filter(i => tipped.includes(i));
      el.innerHTML = '<span class="tag">Greenfield</span><b>' + R().growthLevels[st.add] + " dwellings</b> joining at <b>" + esc(label(st.site)) + "</b> in " + wx + ": " +
        (tipped.length ? "<b>" + tipped.length + "</b> manhole" + (tipped.length === 1 ? "" : "s") + " see it" : "no manhole passes the rule") + ". " +
        (st.showSensors ? (caught.length ? "Sensor" + (caught.length === 1 ? " " : "s ") + caught.map(i => "S" + (chosen.indexOf(i) + 1)).join(", ") + " see" + (caught.length === 1 ? "s" : "") + " it." : "<b>None of the chosen sensors sees it.</b>") : "");
      return;
    }
    el.innerHTML = '<span class="tag">No growth</span>The suburb as the model has it in ' + wx + ". Amber manholes are already over the " + ALARM_MM + " mm alarm" +
      (st.view === "simple" ? "." : "; the choke points are listed on the left.");
  }

  /* ------------------------------------------------------------ right panel */
  function renderSide() {
    const box = $("#mhFacts");
    if (st.coverView) {
      $("#rightSensors").hidden = true;
      $("#rightCover").hidden = !!st.pick;
      if (!st.pick) { box.innerHTML = ""; return; }
      renderManhole(box, st.pick);
      box.insertAdjacentHTML("afterbegin", '<button id="rbBack">&#9664; Back to coverage</button>');
      $("#rbBack").onclick = () => { st.pick = null; repaint(); };
      return;
    }
    $("#rightCover").hidden = true;
    if (st.view === "simple") {
      const show = st.pick || (st.fam === "one" && st.site != null ? nameOf(st.site) : null);
      $("#rightSensors").hidden = !!show;
      if (!show) { box.innerHTML = ""; return; }
      renderManhole(box, show);
      box.insertAdjacentHTML("afterbegin", '<button id="rbBack">&#9664; Back to the sensors</button>');
      $("#rbBack").onclick = () => { st.pick = null; if (st.fam === "one") st.site = null; repaint(); };
      return;
    }
    if (st.pick) return renderManhole(box, st.pick);
    if (st.fam === "infill") return renderRegionCard(box);
    if (st.fam === "one" && st.site != null) return renderManhole(box, nameOf(st.site));
    box.innerHTML = "<h4>This manhole</h4><p class='quiet'>Click a manhole on the map to see its water level, headroom, pipes and value as a sensor.</p>";
  }
  function renderRegionCard(box) {
    const reg = region(), tag = curTag(), rr = S().rules[st.rule] || {}, fd = (rr.firstSeen || {})[reg.id] || {};
    const tr = ((S().timeRule || {})[tag] || {})[reg.id];
    const pi = ((S().pumpIndicator || {})[tag] || {})[reg.id];
    const stepPct = f => Math.round(f * 100) + "%";
    const seenTable = '<table class="sm"><tr><th>Case</th><th>First seen</th><th>By</th></tr>' + S().cases.map(c => {
      const v = fd[c.tag];
      return "<tr><td>" + esc(c.label) + "</td>" + (v ? '<td class="hi">' + stepPct(v[1]) + "</td><td>" + mhOf(v[0]) + "</td>" : '<td class="never">never</td><td class="never">none</td>') + "</tr>";
    }).join("") + "</table>";
    const days = tr && tr.days ? Object.entries(tr.days).map(([sg, d]) => "<tr><td>" + (+sg).toFixed(0) + " mm</td><td" + (d >= 1825 ? ' class="never"' : "") + ">" + (d >= 1825 ? "over 5 years" : d + " day" + (d === 1 ? "" : "s")) + "</td></tr>").join("") : "";
    const rw = st.view === "expert" && S().riskWeights && S().riskWeights[tag] ? S().riskWeights[tag][reg.id + "|" + ladder()[st.step]] : null;
    const h4i = (t, tip) => "<h4>" + t + ' <i class="info-i left" data-tip="' + esc(tip).replace(/"/g, "&quot;") + '">i</i></h4>';
    box.innerHTML = h4i("This region", reg.name) +
      row2("Region", "<b>" + esc(reg.id) + "</b> " + esc(shortName(reg))) +
      (rw ? row2("Risk weight (expert)", "<b>" + rw.w + "</b> = S " + rw.S + " x O " + rw.O + (rw.at != null ? ", at " + esc(label(rw.at)) + (rw.ddAfter != null ? " (d/D " + rw.ddBefore + " to " + rw.ddAfter + ")" : "") : "")) : "") +
      row2("Today", reg.dwellings + " homes, " + reg.nManholes + " manholes, " + (reg.lengthM / 1000).toFixed(1) + " km of pipe") +
      row2("Its 2041 share", "<b>" + Math.round(reg.nominal) + "</b> dwellings (100%)" + (reg.exitPipe ? ", drains out through pipe " + reg.exitPipe : "")) +
      h4i("First build-out a sensor sees it (" + esc(ruleOf(st.rule).label.toLowerCase()) + ")",
          "The best single manhole in each case, and the build-out at which it first passes the rule. A 'never' row means no manhole passes the rule even at 300%: the region is a blind spot under this rule.") + seenTable +
      (tr ? h4i("Time to notice full build-out, " + esc(curCase().label),
                "How many days of same-hour readings separate the new level from the old one, if the day-to-day scatter is the figure in the first column. The scatter is assumed until normal-day level records arrive.") +
        row2("Best manhole", esc(label(tr.best)) + ", <b>+" + tr.riseMm.toFixed(1) + " mm</b> at 100%") +
        '<table class="sm"><tr><th>Day-to-day noise</th><th>Days of readings</th></tr>' + days + "</table>" : "") +
      (pi ? h4i("Pump stations, " + esc(curCase().label) + ", 100% build-out",
                "Pumped flow is a growth indicator only for the part of the suburb that drains through a station; a zero change means this region does not.") + Object.entries(pi).map(([p, v]) =>
        row2(esc(p.replace(/^P/, "Station ")), v.baseline_lps.toFixed(2) + " to " + v.with_growth_lps.toFixed(2) + " L/s (" + (v.change_pct >= 0 ? "+" : "") + v.change_pct.toFixed(1) + "%)")).join("") : "");
  }
  let _incoming = null;
  function upstreamOf(g, ni) {
    if (!_incoming) { _incoming = g.nodes.map(() => []); for (let l = 0; l < g.up.length; l++) _incoming[g.down[l]].push(l); }
    const seen = new Set([ni]), stack = [ni], pipes = new Set();
    let chambers = 0, metres = 0;
    while (stack.length) {
      const cur = stack.pop();
      for (const [a, b] of g.pumpLinks || []) if (b === cur && !seen.has(a)) { seen.add(a); stack.push(a); if (g.nodes[a].kind === "chamber") chambers++; }
      for (const l of _incoming[cur]) {
        const key = g.pid && g.pid[l] != null ? g.pid[l] : "link" + l;
        if (!pipes.has(key)) { pipes.add(key); metres += (g.plen && g.plen[l]) || 0; }
        const up = g.up[l];
        if (seen.has(up)) continue;
        seen.add(up); stack.push(up);
        if (g.nodes[up].kind === "chamber") chambers++;
      }
    }
    let homes = 0;
    seen.forEach(j => { homes += g.nodes[j].dw || 0; });
    return { chambers, metres, homes };
  }
  function renderManhole(box, nm) {
    const g = G(), i = idxOfName[nm], ni = g.nodes.findIndex(x => x.name === nm);
    if (i == null || ni < 0) { box.innerHTML = ""; return; }
    const n = g.nodes[ni], inv = g.oz + n.inv / 100;
    const ins = [], outs = [];
    for (let l = 0; l < g.up.length; l++) { if (g.up[l] === ni) outs.push(l); if (g.down[l] === ni) ins.push(l); }
    const mm = ls => [...new Set(ls.map(l => g.dia[l]).filter(Boolean))].sort((a, b) => a - b).join(", ") + " mm";
    const out = outs[0];
    const pipes = (ins.length ? ins.length + " in (" + mm(ins) + ")" : "none in, it is a top end") + (out != null ? ", out " + g.dia[out] + " mm" : "");
    const up = upstreamOf(g, ni);
    // Water before growth in the selected case, from the family's baseline.
    let d = null, over = false, sur = false, spills = false;
    if (st.fam === "infill" || st.fam === "none") {
      const b = S().base[curTag()];
      if (b) { d = b.depthMm[String(i)]; over = b.alarm.includes(i); sur = b.surcharged.includes(i); spills = b.spilled.includes(i); }
    }
    if (d == null && R().baseDepthMm) { const ci = caseIndex(); d = R().baseDepthMm[ci][i]; over = R().baseOver[ci].includes(i); sur = R().baseSurcharged[ci].includes(i); spills = spillBefore().includes(i); }
    let water = "", head = "";
    if (d != null) {
      water = "<b>" + d + " mm</b> deep";
      const crown = out != null ? g.dia[out] : null;
      head = spills ? '<b class="bad">overflowing</b>: water already spills from its lid'
        : sur ? '<b class="bad">surcharged</b>: above the top of its pipe already'
        : over ? '<b class="bad">' + (d - ALARM_MM) + " mm over</b> the " + ALARM_MM + " mm alarm already"
        : "<b>" + (ALARM_MM - d) + " mm</b> to the " + ALARM_MM + " mm alarm" + (crown ? ", " + (crown - d) + " mm to the top of its pipe" : "");
    }
    // What the shown growth does to it.
    let here = "";
    if (st.fam === "infill") {
      const row = curRow(), v = row && row.rise.find(x => x[0] === i);
      here = row ? (v ? "<b>+" + v[1].toFixed(1) + " mm</b>" : "under 0.5 mm") + (row.alarm.includes(i) ? ', <b class="bad">passes the alarm</b>' : "") + (row.sur.includes(i) ? ', <b class="bad">surcharges</b>' : "") + (row.spill.includes(i) ? ', <b class="bad">overflows</b>' : "") : "";
    } else if (st.fam === "one" && st.site != null) {
      const row = rowFor(cell(), st.site);
      here = row && row.tip.includes(i) ? '<b class="bad">sees it</b> (' + esc(ruleOf(st.rule).label.toLowerCase()) + ")" : "does not see it under this rule";
    }
    const h = st.fam === "one" ? R().heat[st.rule] : infillHeat();
    const chosen = placement().chosen, k = chosen.indexOf(i);
    const rank = 1 + h[st.obj].filter(x => x > h[st.obj][i]).length;
    const ri = regionOf[i];
    box.innerHTML = '<h4>This manhole <i class="info-i left" data-tip="' + esc("Water and headroom are for " + curCase().label + ". Click empty ground, or Back, to leave it.") + '">i</i></h4>' +
      row2("Asset", "MH " + n.mh + (n.yr ? ", built " + n.yr : ", year not recorded")) +
      (ri >= 0 ? row2("Region", esc(S().regions[ri].id + ", " + shortName(S().regions[ri]))) : "") +
      (water ? row2("Water before growth", water) : "") + (head ? row2("Headroom", head) : "") +
      (here ? row2("This growth", here) : "") +
      row2("Pipe floor / ground", inv.toFixed(2) + " / " + (inv + n.depth).toFixed(2) + ' m <span class="quiet">(' + n.depth.toFixed(1) + " m deep)</span>") +
      row2("Pipes", pipes) +
      row2("Drains through it", up.chambers + " manholes, " + (up.metres / 1000).toFixed(2) + " km of pipe") +
      row2("As a sensor", "alone it sees " + pct(h.mean[i]) + " of " + (st.fam === "one" ? "greenfield" : "infill") + " growth on average, " + pct(h.worst[i]) + " in the worst case; rank " + rank + " of " + names().length +
        (k >= 0 ? ", <b>chosen as S" + (k + 1) + "</b>" : "")) +
      "";
  }

  /* -------------------------------------------------------------- sensors */
  function renderSensors() {
    const pl = placement(), chosen = pl.chosen, k = chosen.length, isIn = st.fam !== "one";
    renderCurve();
    const h = isIn ? infillHeat() : R().heat[st.rule];
    const rr = isIn ? (S().rules[st.rule] || {}) : null;
    const row = st.fam === "infill" ? curRow() : null, seen = isIn ? new Set(seers(row, st.rule)) : null;
    const oneRow = !isIn && st.fam === "one" && st.site != null ? rowFor(cell(), st.site) : null;
    const type = st.rule === "alarm" ? "float switch at the alarm level" : "level sensor";
    const lead = "<p><b>" + k + "</b> sensor" + (k === 1 ? "" : "s") + (pl.worst != null ? " catch <b>" + pct(pl.worst) + "</b> of detectable " + (isIn ? "infill" : "greenfield") +
      " growth in the worst case" + (pl.average != null ? " and <b>" + pct(pl.average) + "</b> on average" : "") : "") +
      (pl.riskWorst != null ? ", and <b>" + pct(pl.riskWorst) + "</b> of the risk-weighted total" : "") + ".</p>";
    const cards = chosen.map((i, j) => {
      const nm = nameOf(i), ri = regionOf[i];
      let watch = "";
      if (isIn) {
        // The regions this manhole is the first to see, over every case, and how early.
        const firsts = [];
        S().regions.forEach(reg => {
          const fd = (rr.firstSeen || {})[reg.id] || {};
          const steps = Object.entries(fd).filter(([, v]) => v && v[0] === i).map(([, v]) => v[1]);
          if (steps.length) firsts.push({ id: reg.id, at: Math.min(...steps), n: steps.length });
        });
        watch = firsts.length ? "First to see <b>" + firsts.map(f => f.id + " at " + Math.round(f.at * 100) + "%").join(", ") + "</b> build-out in " +
          (firsts.reduce((a, f) => a + f.n, 0) === 1 ? "one case" : "some cases") + ". "
          : "Not the first detector of any region; it earns its place by covering scenarios the others miss. ";
      } else {
        watch = "Alone it would see " + pct(h.mean[i]) + " of greenfield growth on average, " + pct(h.worst[i]) + " in the worst case. ";
      }
      const reach = Growth3D.reach(nm), upc = upstreamOf(G(), G().nodes.findIndex(x => x.name === nm));
      const sees = isIn ? (row ? (seen.has(i) ? "<b>Sees this growth</b> (+" + ((row.rise.find(x => x[0] === i) || [0, 0])[1]).toFixed(0) + " mm)." : '<span class="miss">Does not see this growth.</span>') : "")
        : (oneRow ? (oneRow.tip.includes(i) ? "<b>Sees this growth.</b>" : '<span class="miss">Does not see this growth.</span>') : "");
      const miss = sees.includes("miss");
      return '<div class="why' + (miss ? " miss" : "") + '"><div class="hd"><span class="pin">S' + (j + 1) + "</span>" + esc(label(i)) +
        (ri >= 0 ? ' <span class="quiet">' + esc(S().regions[ri].id) + "</span>" : "") +
        '<span class="cov">' + (isIn && st.method === "greedy" && rr.greedy && rr.greedy.curve[j] ? "worst " + pct(rr.greedy.curve[j].worst) : "") + "</span></div>" +
        "<p>" + watch + "Watches <b>" + upc.chambers + "</b> manholes and " + upc.homes + " homes draining through it. A " + type + ". " + sees + "</p></div>";
    }).join("");
    let extra = "";
    if (isIn && st.view === "expert" && pl.compare && pl.compare.plain_set) {
      const c = pl.compare, hi = ' class="hi"';
      extra += "<h4>Plain against risk-weighted, " + k + " sensors <i class='info-i left' data-tip='Worst case over the cases, each set scored both ways. Risk weight = severity x occurrence per scenario, the kind of score Kimbrough (2019) uses; the scales are this page&#39;s own. The current scenario&#39;s weight is in the region card.'>i</i></h4><table class='sm'><tr><th>Set</th><th>Plain coverage</th><th>Risk-weighted</th></tr>" +
        "<tr><td>Exact (plain)</td><td" + (st.method !== "risk" ? hi : "") + ">" + pct(c.plain_set.plain) + "</td><td>" + pct(c.plain_set.risk) + "</td></tr>" +
        "<tr><td>Risk-weighted</td><td>" + pct(c.risk_set.plain) + "</td><td" + (st.method === "risk" ? hi : "") + ">" + pct(c.risk_set.risk) + "</td></tr></table>" +
        "<p class='quiet'>The two sets share " + c.shared + " of " + k + " manholes.</p>";
    }
    if (isIn && st.view === "expert" && rr.loo && Object.keys(rr.loo).length) {
      const n0 = Object.values(rr.loo)[0].chosen.length;
      extra = "<h4>Leave one case out (" + n0 + " sensors) <i class='info-i left' data-tip='Sensors chosen on the other cases, scored on the one held out: how much the recommendation depends on any single assumption about the weather.'>i</i></h4><table class='sm'><tr><th>Held out</th><th>Score on it</th></tr>" +
        S().cases.map(c => rr.loo[c.tag] ? "<tr><td>" + esc(c.label) + "</td><td" + (rr.loo[c.tag].score < 0.5 ? ' class="hi"' : "") + ">" + pct(rr.loo[c.tag].score) + "</td></tr>" : "").join("") +
        "</table>";
    }
    const warnLead = pl.warn ? warnSentence(pl) : "";
    $("#sensorList").innerHTML = (pl.warn ? warnLead : lead) + cards + extra;
    if (st.view === "simple") {
      const tip = pl.warn ? WARN_TIP : "Detectable growth: the scenarios (every region at every build-out, or every estate size at every manhole) that at least one manhole anywhere would see. " +
        "The worst case is the lowest share over all " + famCases().length + " weather and leakage cases; the set is chosen to make that worst case as high as possible. " +
        "Each card names the regions this sensor is the first to notice, and how many manholes and homes drain past it.";
      $("#rightSensors").innerHTML = "<h4 style='margin-top:0'>Where to put " + k + " sensor" + (k === 1 ? "" : "s") + ' <i class="info-i left" data-tip="' + esc(tip) + '">i</i></h4>' +
        (pl.warn ? warnLead : pl.worst != null ? "<p style='margin:0 0 8px;color:var(--dim)'>Together they notice <b>" + pct(pl.worst) + "</b> of detectable " + (isIn ? "infill" : "greenfield") + " growth in the worst case.</p>" : "") +
        cards + "<p class='quiet'>Click a pin or any manhole for its details.</p>";
    }
  }
  function renderCurve() {
    const el = $("#curve");
    if (st.view !== "expert") { el.innerHTML = ""; return; }
    let series = [], note = "";
    if (st.fam !== "one") {
      const rr = S().rules[st.rule];
      if (!rr) { el.innerHTML = ""; return; }
      const ex = rr.exact || [], gr = rr.greedy.curve || [];
      series = [{ name: "Exact, worst case", col: "var(--worst)", v: ex.map(e => e.worst) },
                { name: "Exact, average", col: "var(--mean)", v: ex.map(e => e.average) },
                { name: "Greedy, worst case", col: "var(--greedy)", v: gr.map(c => c.worst), dash: true }];
      if (st.method === "warn" && WARN(st.rule)) series.push({ name: "Warn before surcharge, worst case", col: "var(--selset)", v: WARN(st.rule).sets.map(e => e.detect_worst) });
      if (st.method === "risk" && rr.risk && rr.risk.compare) series.push({ name: "Risk-weighted, worst case", col: "var(--selset)", v: rr.risk.compare.slice().sort((a, b) => a.k - b.k).map(c => c.risk_set.plain) });
      note = "Selected set: " + methodName() + ".";
    } else {
      const pl = R().sensors[st.rule][st.obj];
      series = [{ name: "Greedy, worst case", col: "var(--worst)", v: pl.worst }, { name: "Greedy, average", col: "var(--mean)", v: pl.mean }];
      note = "Greedy: each sensor is the one that most raises the " + (st.obj === "worst" ? "worst case" : "average") + ". Greenfield publishes greedy only.";
    }
    series = series.filter(s => s.v && s.v.length);
    if (!series.length) { el.innerHTML = ""; return; }
    const n = Math.max(...series.map(s => s.v.length)), k = st.k;
    const W = 300, H = 132, L = 30, Rr = 14, T = 8, B = 22;
    const x = i => L + (W - L - Rr) * i / Math.max(1, n - 1), y = v => T + (H - T - B) * (1 - v);
    const line = arr => arr.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
    const grid = [0, 0.5, 1].map(v => '<line x1="' + L + '" x2="' + (W - Rr) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#22314d"/><text x="' + (L - 5) + '" y="' + (y(v) + 3.5) + '" text-anchor="end" font-size="10" fill="#6f81a3">' + (v * 100) + "%</text>").join("");
    const ticks = Array.from({ length: n }, (_, i) => '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="10" fill="' + (i === k - 1 ? "#e7edf7" : "#6f81a3") + '">' + (i + 1) + "</text>").join("");
    el.innerHTML = '<div class="lg">' + series.map(s => "<span><i style=\"background:" + s.col + '"></i>' + esc(s.name) + "</span>").join("") + "</div>" +
      '<p class="quiet" id="curveNote">' + esc(note) + "</p>" +
      '<svg viewBox="0 0 ' + W + " " + (H + 10) + '" role="img" aria-label="Share of detectable growth caught against number of sensors">' + grid +
      '<line x1="' + x(k - 1) + '" x2="' + x(k - 1) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="#a9b8d4" stroke-dasharray="3 3"/>' +
      series.map(s => '<path d="' + line(s.v) + '" fill="none" stroke="' + s.col + '" stroke-width="2"' + (s.dash ? ' stroke-dasharray="4 3"' : "") + "/>" +
        s.v.map((v, i) => '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="' + (i === k - 1 ? 4.5 : 2.5) + '" fill="' + s.col + '" stroke="#16233a" stroke-width="2"/>').join("")).join("") +
      ticks + '<text x="' + ((L + W - Rr) / 2) + '" y="' + (H + 7) + '" text-anchor="middle" font-size="10" fill="#6f81a3">sensors</text>' +
      Array.from({ length: n }, (_, i) => '<rect class="hit" data-i="' + i + '" x="' + (x(i) - 12) + '" y="' + T + '" width="24" height="' + (H - T - B + 16) + '" fill="transparent" style="cursor:pointer"/>').join("") +
      "</svg>";
    el.querySelectorAll(".hit").forEach(r => { r.onclick = () => { st.k = +r.dataset.i + 1; repaint(); }; });
  }

  /* ------------------------------------------------------ documents, modal */
  function markdown(md_) {
    const out = []; let inTable = false;
    const inline = t => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const closeT = () => { if (inTable) { out.push("</tbody></table>"); inTable = false; } };
    for (const raw of String(md_ || "").split("\n")) {
      const line = raw.replace(/\s+$/, "");
      if (/^\|/.test(line)) {
        if (/^[:\-\s|]+$/.test(line)) continue;
        const cells = line.split("|").slice(1, -1).map(c => c.trim());
        if (!inTable) { out.push("<table><thead><tr>" + cells.map(c => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>"); inTable = true; }
        else out.push("<tr>" + cells.map(c => "<td>" + inline(c) + "</td>").join("") + "</tr>");
        continue;
      }
      closeT();
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">");
      else if (/^[-*]\s+/.test(line)) out.push("<li>" + inline(line.replace(/^[-*]\s+/, "")) + "</li>");
      else if (/^\d+\.\s+/.test(line)) out.push("<li>" + inline(line.replace(/^\d+\.\s+/, "")) + "</li>");
      else if (/^---+$/.test(line)) out.push("<hr>");
      else if (line) out.push("<p>" + inline(line) + "</p>");
    }
    closeT();
    return out.join("\n");
  }
  function refHtml() {
    const g = G();
    return '<div class="lead"><p><strong>What this model is, in one paragraph.</strong> Every council pipe draining to the end of the council data, ' +
      g.nPipes + " pipes and " + g.nChambers + " manholes, is solved together in EPA SWMM as a steady state, run until no manhole's level is still moving, and every one of those manholes is a growth site and a sensor candidate. " +
      "Pipes from outside the council area are not modelled; where they join, a constant inflow sized from their published length stands in for them. Two pump stations pass their flow on as ideal pumps. " +
      "Sewage comes from connected properties counted from the published record; infiltration is in proportion to pipe length.</p>" +
      "<p><strong>The register below</strong> is every assumption and constant the model rests on, with its value, how firm it is and its source. " + S().cases.length +
      " cases vary the ones no data pins yet. Sources cited as docs/ or papers/ are in the project's working repository, not this one.</p></div>" + markdown(window.SIM4_EXPLORE.assumptions) + '<div class="regBody">' + markdown(IDX().docs.assumptions) + "</div>";
  }

  /* The register's legend, which is also its filter. An assumption's ID starts with the
     letters of its group; Status says how the value is known, Risk how much the results
     depend on it. Pick any legend entries to narrow the table (entries in one row are
     either-or, the rows together both-and), or search the text. */
  const REG_GROUPS = [
    ["D", "Data", "the council data, and how it is read"],
    ["N", "Network", "how pipe ends and points become joined nodes and manholes"],
    ["X", "Extent", "where the model starts and stops: domain, study area, boundaries"],
    ["L", "Loads and pumps", "what flows in (sewage, I&I, outside inflows) and the pump stations"],
    ["P", "Parameters", "the numbers the other rows use"],
    ["H", "Hydraulics", "how SWMM represents the physics"],
    ["SW", "SWMM options", "the settings in the SWMM input file"],
    ["R", "Run settings", "how a run is done and judged"],
    ["G", "Growth and placement", "what a scenario is, when a sensor sees it, how sensors are chosen"],
    ["C", "Configuration", "where the settings live"]];
  const REG_STATUS = [
    ["M", "Measured", "read directly from the data or a run"],
    ["D", "Derived", "worked out from the data, or from a cited standard or method"],
    ["A", "Assumed", "our choice, with weak or no evidence"]];
  const REG_RISK = [
    ["Low", "Low", "the results barely move if it is wrong"],
    ["Medium", "Medium", "some results shift; the main findings hold"],
    ["High", "High", "could change which manholes are chosen, or the headline numbers"]];

  function wireRegister(root) {
    // The register may be one table or several, under section (h3) and sub-section (h4)
    // headings; a heading, and the description under it, hides when none of its rows show.
    const tables = [...root.querySelectorAll("table")];
    if (!tables.length) return;
    const rows = [];
    for (const table of tables) {
      const head = [...table.querySelectorAll("thead th")].map(th => th.textContent.trim().toLowerCase());
      const iId = head.indexOf("id"), iSt = head.indexOf("status"), iRk = head.indexOf("risk");
      if (iId < 0 || iSt < 0 || iRk < 0) return;
      for (const tr of table.querySelectorAll("tbody tr")) {
        const td = tr.children, id = td[iId].textContent.trim();
        rows.push({ tr, table, g: (id.match(/^[A-Z]+/) || ["?"])[0], s: td[iSt].textContent.trim(),
                    r: td[iRk].textContent.trim(), text: tr.textContent.toLowerCase(),
                    stCell: td[iSt], rkCell: td[iRk] });
      }
    }
    // Sections, in document order: each heading owns the description and tables after it,
    // up to the next heading of its level or higher.
    const blocks = [];
    let sec = null, sub = null;
    for (const el of root.children) {
      if (el.tagName === "H3") { sec = { els: [el], tables: [] }; sub = null; blocks.push(sec); }
      else if (el.tagName === "H4") { sub = { els: [el], tables: [] }; blocks.push(sub); }
      else if (el.tagName === "TABLE") { if (sec) sec.tables.push(el); if (sub) sub.tables.push(el); }
      else if (sub) sub.els.push(el);
      else if (sec) sec.els.push(el);
    }
    // A group the register uses but the legend does not name still gets an entry.
    const groups = REG_GROUPS.filter(([c]) => rows.some(x => x.g === c));
    [...new Set(rows.map(x => x.g))].filter(c => !REG_GROUPS.some(([k]) => k === c))
      .forEach(c => groups.push([c, "Other", "rows with this prefix"]));
    const name = { s: {}, r: {} };
    REG_STATUS.forEach(([c, n, d]) => { name.s[c] = n + ": " + d; });
    REG_RISK.forEach(([c, n, d]) => { name.r[c] = n + " risk: " + d; });
    rows.forEach(x => { x.stCell.title = name.s[x.s] || ""; x.rkCell.title = name.r[x.r] || ""; });
    const entry = (k, [code, label, desc]) => {
      const n = rows.filter(x => x[k] === code).length;
      return n ? '<button class="rf" data-k="' + k + '" data-v="' + esc(code) + '" aria-pressed="false">' +
        "<span class=rfTop><b>" + esc(code) + "</b> " + (label !== code ? esc(label) : "") +
        '<span class="rfN">' + n + "</span></span><span class=rfDesc>" + esc(desc) + "</span></button>" : "";
    };
    const keyRow = (title, k, list) => '<div class="regRow"><h4>' + title + '</h4><div class="regGrid">' +
      list.map(e => entry(k, e)).join("") + "</div></div>";
    const box = document.createElement("div");
    box.className = "regKey";
    box.innerHTML = "<p><strong>How to read the register.</strong> The letters at the start of " +
      "an ID name its group. Status says how the value is known; risk says how much the results " +
      "depend on it. Click any entry to show only those rows; click again to undo.</p>" +
      keyRow("Group (the ID's letters)", "g", groups) +
      keyRow("Status", "s", REG_STATUS) +
      keyRow("Risk", "r", REG_RISK) +
      '<div class="regBar"><input type="search" id="regQ" placeholder="Search the register…" ' +
      'aria-label="Search the register"> <span id="regCount"></span> ' +
      '<button id="regClear" hidden>Clear filters</button></div>';
    root.insertBefore(box, root.firstChild);
    const none = document.createElement("p");
    none.className = "quiet"; none.hidden = true;
    none.textContent = "No assumption matches these filters.";
    root.appendChild(none);

    const on = { g: new Set(), s: new Set(), r: new Set() };
    let q = "";
    const apply = () => {
      let shown = 0;
      const seen = new Set();
      rows.forEach(x => {
        const ok = ["g", "s", "r"].every(k => !on[k].size || on[k].has(x[k])) &&
                   (!q || x.text.includes(q));
        x.tr.hidden = !ok;
        if (ok) { shown++; seen.add(x.table); }
      });
      tables.forEach(t => { t.hidden = !seen.has(t); });
      blocks.forEach(b => {
        const vis = b.tables.some(t => seen.has(t));
        b.els.forEach(el => { el.hidden = !vis; });
      });
      none.hidden = !!shown;
      $("#regCount").textContent = "Showing " + shown + " of " + rows.length + " assumptions";
      $("#regClear").hidden = !(q || on.g.size || on.s.size || on.r.size);
    };
    box.addEventListener("click", e => {
      const b = e.target.closest(".rf");
      if (!b) return;
      const set = on[b.dataset.k], v = b.dataset.v;
      if (set.has(v)) set.delete(v); else set.add(v);
      b.setAttribute("aria-pressed", String(set.has(v)));
      apply();
    });
    $("#regQ").addEventListener("input", e => { q = e.target.value.trim().toLowerCase(); apply(); });
    $("#regClear").onclick = () => {
      Object.values(on).forEach(s => s.clear());
      q = ""; $("#regQ").value = "";
      box.querySelectorAll(".rf").forEach(b => b.setAttribute("aria-pressed", "false"));
      apply();
    };
    apply();
  }
  // Documents open in the one popup: About (the scenario) and Assumptions. Findings is a tab of Results.
  const CLOSE = '<button class="close" id="modalClose" title="Close (Esc)">&times;</button>';
  function showDoc(kind) {
    if (kind !== "ref") { RES.tab = "findings"; return showResults(); }   // old #open=qa links, and a presenter on that tab
    const box = $("#modalBox");
    box.classList.add("wide");
    box.innerHTML = CLOSE + '<div class="docbody">' + refHtml() + "</div>";
    wireRegister(box.querySelector(".docbody .regBody"));
    $("#modal").hidden = false;
    box.scrollTop = 0;
    $("#modalClose").onclick = () => { $("#modal").hidden = true; };
  }
  /* ------------------------------------------------------------------ the Results panel */
  const RES = { tab: "warn", tag: null, limit: "0.7", rule: "r10", score: "detect", pL: null, pF: null };
  const usd = v => "$" + Math.round(v).toLocaleString("en-AU");
  const seg = (name, cur, opts) => '<div class="knob resknob" data-res="' + name + '">' + opts.map(([v, t]) =>
    '<button data-v="' + v + '"' + (String(v) === String(cur) ? ' class="on"' : "") + ">" + esc(t) + "</button>").join("") + "</div>";
  const caseSelect = () => '<select class="ressel" data-res="tag">' + S().cases.map(c =>
    '<option value="' + c.tag + '"' + (c.tag === RES.tag ? " selected" : "") + ">" + esc(c.label) + "</option>").join("") + "</select>";
  const RULE_OPTS = [["r10", "10 mm rule"], ["r25", "25 mm rule"]];
  const info = t => ' <i class="info-i left" data-tip="' + esc(t) + '">i</i>';
  // Where a tab's numbers come from, beside the table. The text is in the data, written by the builder.
  const sources = key => "<div class='src'><b>Where these numbers come from</b>" + window.SIM4_EXPLORE.sources[key].map(([tag, t]) =>
    "<div><span class='srctag'>" + esc(tag) + "</span> " + esc(t) + "</div>").join("") + "</div>";
  const say = html => "<p class='say'>" + html + "</p>";
  const head = (t, sub) => esc(t) + "<span class='thsub'>" + esc(sub) + "</span>";
  const listAnd = a => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
  const caseLabel = () => (S().cases.find(c => c.tag === RES.tag) || {}).label || "";

  function ladderTab() {
    const X = window.SIM4_EXPLORE, rule = RES.rule === "r25" ? "r25" : "r10", W = X.warn[rule], e = W.sets[st.k - 1], set = new Set(e.chosen), lad = S().ladder;
    const rows = S().rows[RES.tag] || [];
    let body = "";
    const tally = { warned: [], missed: [], stress: 0 };
    S().regions.forEach((reg, ri) => {
      const rr = rows.filter(x => x.r === ri).sort((a, b) => a.s - b.s);
      const first = rr.findIndex(x => x.sur.length || x.spill.length);
      const fire = rr.findIndex(x => x.rise.some(([i, v]) => v >= W.R && set.has(i)));
      if (first >= 0 && lad[first] > 1) tally.stress++;
      else if (first >= 0) (fire >= 0 && fire < first ? tally.warned : tally.missed).push(reg.id);
      let cells = "";
      rr.forEach((x, s) => {
        const over = first >= 0 && s >= first, f = fire >= 0 && s >= fire;
        const cls = over ? (f ? "late" : "over") : f ? "warned" : "";
        const sym = over ? "\u2715" : f ? "\u2713" : "";
        const say = over ? (f ? "A manhole has newly surcharged; a sensor responds, too late to warn" : "A manhole has newly surcharged; no sensor responds") : f ? "A sensor responds, before any surcharge" : "Quiet";
        cells += '<td class="lc ' + cls + '" title="' + esc(reg.id + " at " + Math.round(lad[s] * 100) + "%, " + Math.round(x.dw) + " homes: " + say) + '">' + sym + "</td>";
      });
      const note = first < 0 ? (fire >= 0 ? "Responds; never overloads" : "Quiet; never overloads")
        : first === 0 ? "Overloads at the first step"
        : fire >= 0 && fire < first ? "Warns at " + Math.round(lad[fire] * 100) + "%, overloads at " + Math.round(lad[first] * 100) + "%"
        : "Overloads at " + Math.round(lad[first] * 100) + "% with no warning";
      body += "<tr" + (first < 0 ? ' class="dimrow"' : "") + '><th title="' + esc(reg.name) + '">' + esc(reg.id) + "</th>" + cells + "<td class='lnote'>" + esc(note) + "</td></tr>";
    });
    const nOver = tally.warned.length + tally.missed.length;
    const line = "In " + esc(caseLabel()) + ", with " + st.k + " sensors at the " + W.R + " mm rule: " + (nOver
      ? (nOver === 1 ? "the one region that overloads by 100% build-out " + (tally.warned.length ? "<b>gets a warning first</b>" : "<b>gets no warning first</b>") : "<b>" + tally.warned.length + " of " + nOver + "</b> regions that overload by 100% build-out get a warning first") + (nOver > 1 && tally.missed.length ? " (no warning: " + listAnd(tally.missed) + ")" : "") + "."
      : "no region overloads by 100% build-out.") + (tally.stress ? " " + tally.stress + " more overload only in the stress steps." : "");
    return "<p class='q'>Does a sensor respond before the first manhole newly surcharges?" + info("Each row is one region's build-out, in the weather chosen. A tick means a chosen sensor has responded with no surcharge yet: that is a warning. A cross means a manhole has newly surcharged. Ticks must come before crosses. Hover any cell for the detail.") + "</p>" +
      say(line) +
      "<div class='resctl'>" + caseSelect() + seg("rule", rule, RULE_OPTS) + seg("k", st.k, [[3, "3 sensors"], [5, "5 sensors"], [8, "8 sensors"]]) + "</div>" +
      "<div class='tscroll'><table class='ladder'><thead><tr><th>Region</th>" + lad.map(f => "<th>" + Math.round(f * 100) + "%</th>").join("") + "<th class='lnote'>Reading</th></tr></thead><tbody>" + body + "</tbody></table></div>" +
      "<p class='quiet'>Blue \u2713: responded, no surcharge yet. Red \u2715: newly surcharged, no response. Purple \u2715: newly surcharged, responded too late. 100% is the region's 2041 share; 150% and 300% are stress steps.</p>" +
      "<div class='kpis'><div><b>" + e.plausible_warned + " of " + W.plausible_total + "</b>overloads by 100% build-out warned, on the runs the sensors were chosen on</div><div><b>" + e.plausible_unseen_weather + " of " + W.plausible_total + "</b>on unseen weather: chosen without that weather case</div><div><b>" + e.plausible_unseen_region + " of " + W.plausible_total + "</b>on an unseen region: chosen without that region</div><div><b>" + e.warned + " of " + W.total + "</b>on the runs chosen on, adding the 150% and 300% stress steps</div></div>" +
      sources("warn");
  }

  const BAND_ICON = { "runs out": ["bo", "\u25CF"], "uncertain": ["bu", "\u25D0"], "room left": ["br", "\u25CB"], "already over": ["bg", "\u25A0"] };
  const BAND_LABEL = { "runs out": "Likely to reach the limit", "uncertain": "Could go either way", "room left": "Room left", "already over": "Already past the limit" };
  function roomRow(id, name, e, L) {
    const x = e[L], ic = BAND_ICON[x.band], top = "over " + Math.round(e.top_homes);
    const a = x.homes_p10 == null ? top : String(x.homes_p10), b = x.homes_p90 == null ? top : String(x.homes_p90);
    return "<tr><th title='" + esc(name) + "'>" + esc(id) + "</th><td><span class='" + ic[0] + "'>" + ic[1] + "</span> " + esc(BAND_LABEL[x.band]) +
      "</td><td class='r'>" + (a === b ? a : a + " to " + b) + " <span class='quiet'>(" + Math.round(e.share_100) + " expected)</span></td><td class='r'>" + e.rise_mm_per_100_homes.toFixed(0) + " mm</td><td class='r'>" + Math.round(x.already_over * 100) + "%</td></tr>";
  }
  function roomTab() {
    const C = window.SIM4_EXPLORE.capacity, L = RES.limit, areas = C.areas[RES.tag] || {};
    const rows = S().regions.map(r => areas[r.id] ? roomRow(r.id, r.name, areas[r.id], L) : "").join("");
    const sub_ = C.suburb[RES.tag] ? roomRow("Whole suburb", "485 homes across every region at once (Sim 3-e's 56 runs)", C.suburb[RES.tag], L) : "";
    const inBand = b => S().regions.filter(r => areas[r.id] && areas[r.id][L].band === b).map(r => r.id);
    const part = (b, t) => inBand(b).length ? listAnd(inBand(b)) + " " + t : null;
    const line = "In " + esc(caseLabel()) + ", with pipes limited to " + L + " of their height: " + [part("runs out", inBand("runs out").length > 1 ? "are likely to reach the limit before their 2041 homes arrive" : "is likely to reach the limit before its 2041 homes arrive"),
      part("uncertain", "could go either way"), part("room left", inBand("room left").length > 1 ? "have room" : "has room"), part("already over", inBand("already over").length > 1 ? "are already past the limit along much of their path" : "is already past the limit along much of its path")].filter(Boolean).join("; ") + ".";
    return "<p class='q'>How many new homes can each region take before growth uses up the buffer on its path?" + info("The path is the region's manholes and everything downstream. A manhole under the limit has buffer. The homes figure is when the first of them reaches the limit, re-read with each manhole's starting level shifted by an assumed error, because the model is uncalibrated: this is why it is a range. The limit is declared, not a standard.") + "</p>" +
      say(line) +
      "<div class='resctl'>" + caseSelect() + seg("limit", L, C.limits.map(v => [v, "limit " + v])) + "</div>" +
      "<div class='tscroll'><table class='rtab'><thead><tr><th>Region</th><th>" + head("Outlook for its 2041 homes", "does growth use up the buffer?") + info("Likely to reach the limit: within the homes expected by 2041, in at least 80% of draws. Room left: in at most 20%. Already past the limit: no new pipe passes it, but 25% or more of the path is past it before growth. Otherwise, could go either way.") + "</th><th class='r'>" + head("New homes before a pipe reaches the limit", "range, with homes expected by 2041") + info("10th to 90th percentile of the draws: when the first pipe on the path with any buffer left reaches the limit.") + "</th><th class='r'>" + head("Water rise per 100 new homes", "largest rise on the path") + info("The largest rise on the path, at 100% build-out. Steady as growth builds in a given weather, but it changes with the weather. The utility's real buffer on that pipe divided by this gives homes for that pipe; other pipes rise less, so they would take more homes.") + "</th><th class='r'>" + head("Path already past the limit", "share of the path, before growth") + "</th></tr></thead><tbody>" + rows + sub_ + "</tbody></table></div>" +
      "<p class='quiet'>Whole suburb: Sim 3-e's 56 runs, growth everywhere at once.</p>" +
      sources("room");
  }

  function floatTab() {
    const M = window.SIM4_EXPLORE.mix, key = RES.score + (RES.rule === "r25" ? "25" : "10"), rows = M.compare[key], pc = v => v == null ? "n/a" : pct(v);
    const cmp = rows.map(r => "<tr><th>" + esc(r.name) + "</th><td class='r'>" + usd(r.budget) + "</td><td class='r'>" + r.in.level + " + " + r.in.float + "</td><td class='r'>" + pc(r.in.worst) + " / " + pc(r.in.average) + "</td><td class='r'>" + pc(r.out.case_mean) + "</td><td class='r'>" + pc(r.out.area) + "</td></tr>").join("");
    const c3 = (x) => x ? pc(x.worst) + " / " + pc(x.average) + " <span class='quiet'>(" + x.level + "+" + x.float + ")</span>" : "n/a";
    const bud = M.budget[key].map(r => "<tr><th class='r'>" + usd(r.budget) + "</th><td class='r'>" + c3(r.level) + "</td><td class='r'>" + c3(r.float) + "</td><td class='r'>" + c3(r.mix) + "</td></tr>").join("");
    const named = n => rows.find(r => r.name === n);
    const line = "On weather they were not chosen for, for the same money: <b>" + usd(named("1 level sensor").budget) + "</b> buys 1 level sensor at " + pc(named("1 level sensor").out.case_mean) + ", or floats at " + pc(named("25 floats").out.case_mean) +
      "; <b>" + usd(named("5 level sensors").budget) + "</b> buys " + named("5 level sensors").in.level + " level sensors at " + pc(named("5 level sensors").out.case_mean) + ", or floats at " + pc(named("125 floats").out.case_mean) + ".";
    return "<p class='q'>Do float switches beat level sensors?" + info("A float earns credit only when it clears its manhole's normal level by " + M.margin + " mm (assumed) and growth carries the water past it. It must also stay quiet on a Design wet day. Prices are assumed, not quotes.") + "</p>" +
      say(line) +
      "<p class='quiet'>These tables score seeing growth, not notifying of an overflow, which is what a float is for and which a level sensor can also do. The right mix depends on which job the budget is buying.</p>" +
      "<div class='resctl'>" + seg("score", RES.score, [["detect", "Sees growth"], ["warn", "Warns before surcharge"]]) + seg("rule", RES.rule === "r25" ? "r25" : "r10", RULE_OPTS) + "</div>" +
      "<div class='tscroll'><table class='rtab'><thead><tr><th>Set</th><th class='r'>Budget</th><th class='r'>Bought: level + float</th><th class='r'>" + head("Runs it was chosen on", "worst / average of the wet cases") + "</th><th class='r'>" + head("Unseen weather", "higher is better") + info("Average share, chosen without the weather case tested, then scored on it. This is where floats fall away: a float's useful height moves with the weather.") + "</th><th class='r'>" + head("Unseen region", "higher is better") + info("Share seen in a region, chosen without that region, then scored on it.") + "</th></tr></thead><tbody>" + cmp + "</tbody></table></div>" +
      "<h3>By budget, on the runs it was chosen on, worst / average</h3><div class='tscroll'><table class='rtab'><thead><tr><th class='r'>Budget</th><th class='r'>Level only</th><th class='r'>Float only</th><th class='r'>Free mix</th></tr></thead><tbody>" + bud + "</tbody></table></div>" +
      "<p class='quiet'>Prices assumed: " + usd(M.price.level) + " a level sensor, " + usd(M.price.float) + " a float. The solver buys only what adds something, so a float set can stop short of its budget. Scores on the runs a set was chosen on flatter every set; read the unseen columns.</p>" +
      sources("float");
  }

  function minTab() {
    const M = window.SIM4_EXPLORE.mix, key = RES.score + (RES.rule === "r25" ? "25" : "10"), pL = RES.pL == null ? M.price.level : RES.pL, pF = RES.pF == null ? M.price.float : RES.pF, pc = v => v == null ? "n/a" : pct(v);
    const cost = x => usd(x.level * pL + x.float * pF);
    const cellTxt = x => x ? "<td class='r'>" + x.level + " + " + x.float + "</td><td class='r'>" + cost(x) + "</td><td class='r'>" + pc(x.out.case_mean) + " / " + pc(x.out.area) + "</td>" : "<td colspan='3' class='r quiet'>not reachable at any budget</td>";
    const rows = M.tolerance[key].map(r => "<tr><th class='r'>" + pct(r.pass) + "</th>" + cellTxt(r.level) + cellTxt(r.mix) + "</tr>").join("");
    const reach = M.tolerance[key].filter(r => r.level), top_ = reach[reach.length - 1], eighty = M.tolerance[key].find(r => r.pass === 0.8 && r.level);
    const scoreName = RES.score === "warn" ? "warn before surcharge in" : "see growth in";
    const pick = eighty || top_;
    const line = !pick ? "At the " + (RES.rule === "r25" ? 25 : 10) + " mm rule, no listed pass mark can be reached for this score." :
      "At the " + (RES.rule === "r25" ? 25 : 10) + " mm rule, to " + scoreName + " at least <b>" + pct(pick.pass) + "</b> of scenarios in the worst wet case takes <b>" + pick.level.level + " level sensors</b> (" + cost(pick.level) + ")" + (eighty ? "." : ". That is the highest listed mark level sensors can reach.");
    return "<p class='q'>What is the fewest sensors that passes?" + info("The cheapest set whose worst wet case reaches the pass mark. The pass mark is the network operator's call: it is what 'enough visibility' means. Then the same pass mark is re-solved without one weather case or region, and scored on it.") + "</p>" +
      say(line) +
      "<div class='resctl'>" + seg("score", RES.score, [["detect", "Sees growth"], ["warn", "Warns before surcharge"]]) + seg("rule", RES.rule === "r25" ? "r25" : "r10", RULE_OPTS) +
      "<label class='price'>Level $<input type='number' min='1' step='500' data-price='pL' value='" + pL + "'></label><label class='price'>Float $<input type='number' min='1' step='100' data-price='pF' value='" + pF + "'></label></div>" +
      "<div class='tscroll'><table class='rtab'><thead><tr><th class='r' rowspan='2'>Pass mark</th><th colspan='3' class='c'>Level sensors only</th><th colspan='3' class='c'>Free mix</th></tr><tr><th class='r'>Level + float</th><th class='r'>Cost</th><th class='r'>" + head("Unseen: weather / region", "higher is better") + "</th><th class='r'>Level + float</th><th class='r'>Cost</th><th class='r'>" + head("Unseen: weather / region", "higher is better") + "</th></tr></thead><tbody>" + rows + "</tbody></table></div>" +
      "<p class='quiet'>Prices are assumed, not quotes. Editing them recalculates cost only: the sets were chosen at the default prices. Differences under about 10 points are noise.</p>" +
      sources("min");
  }

  const limitsTab = () => "<div class='docbody'>" + markdown(window.SIM4_EXPLORE.limits) + "</div>";

  /* ------------------------------------------------------------------ Sensor coverage, on the main map. The idea and chart
     design are after the team's coverage view; the logic is this page's: whatever the left panel has selected
     (growth type, build-out or estate size, weather, rule, method, number of sensors) decides what is painted. */
  const COV = { m: "who", sel: null };
  const COV_COL = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
  const COV_SEQ = ["#184f95", "#3987e5", "#9ec5f4"], COV_LEVEL = "#3987e5", COV_FLOAT = "#c98500";
  const COV_MISS = "#e7edf7", COV_NONE = "#3a4350", COV_DIM = "#262d38";
  const coverOn = () => st.coverView && st.fam !== "none";
  const methodName = () => st.fam === "one" ? "Greedy" : { warn: "Warn before surcharge", exact: "Exact optimum", greedy: "Greedy", risk: "Risk-weighted" }[st.method] || "";
  // One unit per region (infill) or per manhole the estate could join at (greenfield): who sees growth there.
  function coverData() {
    const pl = placement(), placed = pl.chosen, units = [];
    const entry = (id, s) => ({ id, det: s.size > 0, by: placed.map((c, r) => s.has(c) ? r : -1).filter(r => r >= 0) });
    if (st.fam === "infill") {
      S().regions.forEach((r, ri) => units.push(entry(r.id, new Set(seers(infillRow(curTag(), ri, st.step), st.rule)))));
    } else {
      const bySite = new Map(cell().rows.map(x => [x.site, x]));
      names().forEach((nm, i) => { const row = bySite.get(i); units.push(entry(label(i), new Set(row ? row.tip : []))); });
    }
    const sensors = placed.map((c, r) => ({ c, r, sees: [], only: 0 }));
    units.forEach((u, ui) => { u.by.forEach(r => sensors[r].sees.push(ui)); if (u.by.length === 1) sensors[u.by[0]].only++; });
    if (COV.sel != null && COV.sel >= placed.length) COV.sel = null;
    return { pl, placed, units, sensors, det: units.filter(u => u.det).length, hit: units.filter(u => u.by.length).length, multi: units.filter(u => u.by.length >= 2).length };
  }
  function unitCol(u) {
    const mine = COV.sel != null && u.by.includes(COV.sel);
    if (COV.sel != null && !mine) return COV_DIM;
    if (!u.det) return COV_NONE;
    if (!u.by.length) return COV_MISS;
    return COV.m === "who" ? COV_COL[(mine ? COV.sel : u.by[0]) % COV_COL.length] : COV_SEQ[Math.min(u.by.length, 3) - 1];
  }
  function coverTints(d) {
    const g = G(), rp = regionPaint(), owner = nodeOwner(), tints = {};
    g.nodes.forEach((nd, a) => {
      let u = null;
      if (st.fam === "infill") { if (rp.regionOfNode[a] >= 0) u = d.units[rp.regionOfNode[a]]; }
      else if (owner[a] >= 0) u = d.units[idxOfName[g.nodes[owner[a]].name]];
      if (u) tints[nd.name] = unitCol(u);
    });
    return tints;
  }
  function paintCover(site, sensors) {
    const d = coverData(), tints = coverTints(d);
    Growth3D.setRegionTints(tints);
    Growth3D.paint({}, site, sensors, null);
    if (st.fam === "infill") {
      Growth3D.setPulse(region().manholes.map(nameOf));
      Growth3D.setRegionLabels(S().regions.map((r, ri) => ({ names: [regionPaint().labelAt[ri]], text: r.id, col: ri === st.region ? "#00d4ff" : "#8b949e" })));
    } else { Growth3D.setPulse([]); Growth3D.setRegionLabels([]); }
    Growth3D.setSpills([], []);
    if (COV.sel != null) Growth3D.setCoverSelect(nameOf(d.placed[COV.sel]), coverBreakdown(d, d.sensors[COV.sel]).targets.map(nameOf));
    // read by a page check
    window.SIM4_EXPLORE.coverState = { k: d.placed.length, det: d.det, hit: d.hit, units: d.units.length, tinted: Object.keys(tints).length, sig: d.units.map(unitCol).join() + "|" + d.units.map(u => u.by.join("+")).join() };
  }
  // Each manhole's region, by chamber index. A manhole shared by two regions goes to the first listed.
  let _chReg = null;
  const chamberRegion = () => {
    if (_chReg) return _chReg;
    const at = {}, of = regionPaint().regionOfNode;
    G().nodes.forEach((n, a) => { at[n.name] = a; });
    return (_chReg = names().map(nm => of[at[nm]]));
  };
  /* What one sensor covers. targets: the manholes its arcs go to. bars: visibility per region. Infill grows a whole region,
     so a region is seen or not at one build-out; its bar is the share of build-out steps at which growth there reaches the
     sensor. Greenfield grows at one manhole; its bar is the share of the region's manholes where growth would reach it. */
  function coverBreakdown(d, s) {
    const regs = S().regions, chReg = chamberRegion(), isIn = st.fam === "infill", seen = new Set(s.sees);
    const targets = isIn ? names().map((_, i) => i).filter(i => seen.has(chReg[i])) : s.sees.slice();
    const per = regs.map((_, ri) => targets.filter(i => chReg[i] === ri).length);
    const size = regs.map((_, ri) => chReg.filter(x => x === ri).length);
    const bars = regionOrder().map(ri => {
      if (isIn) {
        const steps = ladder().map((_, j) => seers(infillRow(curTag(), ri, j), st.rule).includes(s.c));
        const n = steps.filter(Boolean).length;
        return { ri, id: regs[ri].id, v: n / steps.length, now: seen.has(ri), tip: "S" + (s.r + 1) + " sees growth in " + regs[ri].id + " at " + n + " of " + steps.length + " build-out steps" };
      }
      return { ri, id: regs[ri].id, v: size[ri] ? per[ri] / size[ri] : 0, now: per[ri] > 0, tip: "S" + (s.r + 1) + " sees growth at " + per[ri] + " of " + regs[ri].id + "'s " + size[ri] + " manholes" };
    });
    return { targets, per, size, bars, home: chReg[s.c] };
  }
  function coverDetailHtml(d, s) {
    const regs = S().regions, b = coverBreakdown(d, s), isIn = st.fam === "infill", total = b.targets.length, home = regs[b.home], me = "S" + (s.r + 1);
    const homeShare = total ? pct(b.per[b.home] / total) : "0%";
    let top = -1;
    b.per.forEach((n, ri) => { if (ri !== b.home && n > (top < 0 ? 0 : b.per[top])) top = ri; });
    const backwater = s.sees.length > 1 ? " A sensor can respond in two ways: the new flow passes it, or water backs up to it from a fuller pipe downstream." : "";
    const text = !total ? "<b>" + me + "</b> sits in " + esc(home.id) + " and sees no growth " + (isIn ? "at this build-out" : "at this estate size") + "." :
      isIn ? "<b>" + me + "</b> sits in " + esc(home.id) + " and sees growth in <b>" + s.sees.map(ui => regs[ui].id).join(", ") + "</b> at " + Math.round(ladder()[st.step] * 100) + "% build-out. Those regions hold <b>" + total + " manholes</b>: <b>" + homeShare + "</b> are in " + esc(home.id) + ", its own region." + backwater
        : "<b>" + me + "</b> sits in " + esc(home.id) + " and sees growth at <b>" + total + " manholes</b>: <b>" + homeShare + "</b> are in " + esc(home.id) + ", its own region" + (top >= 0 ? ", and " + pct(b.per[top] / total) + " in " + esc(regs[top].id) : "") + "." + backwater;
    const head = isIn ? "How often " + me + " sees each region" : "How much of each region " + me + " sees";
    const sub_ = isIn ? "Share of the " + ladder().length + " build-out steps at which growth there reaches " + me + ", " + esc(curCase().label) + ". Bold: seen at " + Math.round(ladder()[st.step] * 100) + "% build-out."
      : "Share of each region's manholes where " + R().growthLevels[st.add] + " new homes would reach " + me + ", " + esc(curCase().label) + ".";
    return "<p class='covdetail' id='covDetail'>" + text + "</p><h4>" + head + "</h4><p class='quiet covsub'>" + sub_ + "</p><div class='covbars' id='covBars'>" +
      b.bars.map(x => "<div class='covbar" + (x.now ? " now" : "") + "' title='" + esc(x.tip) + "'><span class='covbarl'>" + esc(x.id) + (x.ri === b.home ? " <span class='quiet'>sits here</span>" : "") + "</span><span class='covbart'><i style='width:" + (x.v * 100).toFixed(1) + "%'></i></span><span class='covbarv'>" + pct(x.v) + "</span></div>").join("") + "</div>";
  }
  // A sensor showing none here is usually not useless: say where it does respond, from the same runs.
  function coverWhyHtml(d) {
    const none = d.sensors.filter(s => !s.sees.length);
    if (!none.length) return "";
    const isIn = st.fam === "infill", cs = famCases(), here = caseIndex(), wx = esc(curCase().label);
    const line = s => {
      const me = "<b>S" + (s.r + 1) + "</b>";
      let best = 0, bestCase = null, first = "";
      if (isIn) {
        const inCase = tag => S().regions.filter((_, ri) => seers(infillRow(tag, ri, st.step), st.rule).includes(s.c)).length;
        cs.forEach((c, ci) => { if (ci !== here) { const n = inCase(c.tag); if (n > best) { best = n; bestCase = c; } } });
        const at = ladder().findIndex((_, j) => S().regions.some((_r, ri) => seers(infillRow(curTag(), ri, j), st.rule).includes(s.c)));
        if (at >= 0) first = " In " + wx + " it first responds at " + Math.round(ladder()[at] * 100) + "% build-out.";
        return me + (best ? " sees " + best + " region" + (best === 1 ? "" : "s") + " at this build-out in " + esc(bestCase.label) + "." : " sees no region at this build-out in any weather.") + first;
      }
      const grid = (ci, add) => R().cells.find(c => c.case === ci && c.add === add && c.rule === st.rule);
      const reach_ = (ci, add) => { const c = grid(ci, add); return c ? c.rows.filter(r => r.tip.includes(s.c)).length : 0; };
      const size = R().growthLevels[st.add];
      cs.forEach((c, ci) => { if (ci !== here) { const n = reach_(ci, size); if (n > best) { best = n; bestCase = c; } } });
      const bigger = R().growthLevels.find(lv => lv > size && reach_(here, lv) > 0);
      if (bigger) first = " In " + wx + " it first responds at " + bigger + " homes, for " + reach_(here, bigger) + " manholes.";
      return me + (best ? " sees " + best + " estates of " + size + " homes in " + esc(bestCase.label) + "." : " sees no estate of " + size + " homes in any weather.") + first;
    };
    return "<div class='covwhy' id='covWhy'><p><b>Why a sensor can show none.</b> Sensors are chosen to lift the worst weather case, so some respond only in other weather or to more growth.</p><ul>" +
      none.map(s => "<li>" + line(s) + "</li>").join("") + "</ul></div>";
  }
  // On the summary line while the pointer is over a manhole: who sees growth there.
  function coverHoverLine() {
    if (!coverOn() || !st.hover || !(st.hover in idxOfName)) return;
    const d = coverData(), i = idxOfName[st.hover], isIn = st.fam === "infill", u = isIn ? d.units[chamberRegion()[i]] : d.units[i];
    if (!u) return;
    const who = !u.det ? "no manhole passes the rule" : !u.by.length ? "detectable, but no placed sensor sees it" : "seen by " + u.by.map(r => "S" + (r + 1)).join(", ");
    const t = isIn ? esc(u.id) + " at " + Math.round(ladder()[st.step] * 100) + "% build-out: " + who : R().growthLevels[st.add] + " homes joining here: " + who;
    $("#homesLine").insertAdjacentHTML("afterbegin", "<span class='hd' id='covHover'>" + t + "</span>");
  }
  function renderCoverKey(d) {
    const item = (col, t) => '<span><span class="k" style="background:' + col + '"></span>' + esc(t) + "</span>";
    const unit = st.fam === "infill" ? "region" : "manhole";
    $("#coverKeyList").innerHTML = !coverOn() ? "<span>Coverage needs growth on the map: choose a region or a greenfield site.</span>" :
      (COV.m === "who" ? d.placed.map((c, r) => item(COV_COL[r % COV_COL.length], "first seen by S" + (r + 1))).join("")
        : item(COV_SEQ[0], "seen by 1 sensor") + item(COV_SEQ[1], "2 sensors") + item(COV_SEQ[2], "3 or more")) +
      item(COV_MISS, "detectable, no placed sensor sees it") + item(COV_NONE, "no manhole passes the rule for this " + unit) +
      (COV.sel == null ? "" : '<span><span class="kl" style="background:#2ef56b"></span>' + (st.fam === "infill" ? "green arc: a manhole in a region S" + (COV.sel + 1) + " sees" : "green arc: growth joining at this manhole reaches S" + (COV.sel + 1)) + "</span>");
  }
  function renderCover() {
    if (!st.coverView) return;
    const box = $("#rightCover");
    const tip = "Each part of the map is coloured by the first sensor that sees growth there. The map uses the growth, weather, sensor rule and number of sensors set in the left panel, so it changes when you change them. Click a sensor in the table to see everything it covers.";
    const title = "<h4 style='margin-top:0'>Sensor coverage <i class='info-i left' data-tip='" + esc(tip) + "'>i</i></h4>";
    if (!coverOn()) {
      renderCoverKey(null);
      box.innerHTML = title + "<p class='quiet'>Coverage shows which sensor sees which growth, so it needs growth on the map. Choose a region or a greenfield site.</p>";
      return;
    }
    const d = coverData(), k = d.placed.length, isIn = st.fam === "infill", regs = S().regions, sel = COV.sel;
    renderCoverKey(d);
    const S_ = by => by.map(r => "S" + (r + 1)).join(", ");
    const wx = esc(curCase().label);
    const cur = isIn ? d.units[st.region] : st.site != null ? d.units[st.site] : null;
    const line = cur ? " <b>" + esc(cur.id) + "</b>" + (isIn ? ", the selected region" : ", where the estate joins") + ": " + (!cur.det ? "no manhole passes the rule." : !cur.by.length ? "detectable, but no placed sensor sees it." : "seen by " + S_(cur.by) + ".") : "";
    const say_ = "In " + wx + (isIn ? ", at " + Math.round(ladder()[st.step] * 100) + "% build-out: " : ", with " + R().growthLevels[st.add] + " homes joining at one manhole: ") +
      "<b>" + k + " sensor" + (k === 1 ? "" : "s") + "</b> see" + (k === 1 ? "s" : "") + " growth in <b>" + d.hit + " of the " + d.det + "</b> " + (isIn ? "regions" : "manholes") + " where any manhole could see it." + line +
      (d.pl.worst != null ? " The " + esc(methodName()) + " set sees <b>" + pct(d.pl.worst) + "</b> of detectable growth in the worst case it was chosen for." : " Set: " + esc(methodName()) + ".");
    const unitWord = isIn ? "regions" : "manholes";
    const sitsIn = c => { const ri = regionPaint().regionOfNode[G().nodes.findIndex(n => n.name === nameOf(c))]; return ri >= 0 ? regs[ri].id : ""; };
    const swatch = r => "<span class='covsw' style='background:" + (COV.m === "who" ? COV_COL[r % COV_COL.length] : "#e7edf7") + "'></span>";
    const sees = s => !s.sees.length ? "<span class='quiet'>none</span>" : isIn ? s.sees.map(ui => regs[ui].id).join(", ") : s.sees.length + " of " + d.det;
    const s = sel != null ? d.sensors[sel] : null;
    const onlyTip = k === 1 ? "With one sensor placed, this counts everything it sees, " + (isIn ? "at " + Math.round(ladder()[st.step] * 100) + "% build-out in " : "with " + R().growthLevels[st.add] + " new homes in ") + curCase().label + "."
      : (isIn ? "The number of regions this sensor sees and none of the other " + (k - 1) + " sensors do, at " + Math.round(ladder()[st.step] * 100) + "% build-out in " + curCase().label + "."
          : "The number of manholes where " + R().growthLevels[st.add] + " new homes would reach this sensor and none of the other " + (k - 1) + " sensors, in " + curCase().label + ".") +
        " A 0 does not make a sensor useless: another sensor may see the same growth, or this one may only respond at other settings.";
    box.innerHTML = title + "<p class='say' id='covSay'>" + say_ + "</p>" +
      "<div class='covstats'><div><b>" + d.hit + " of " + d.det + "</b>detectable " + unitWord + " seen</div><div><b>" + (d.det - d.hit) + "</b>detectable, missed</div><div><b>" + d.multi + "</b>seen by 2 or more</div><div><b>" + (d.units.length - d.det) + "</b>no manhole passes the rule</div></div>" +
      "<label class='fld'>Colour by</label><div class='knob covknob' id='covMode'><button data-v='who'" + (COV.m === "who" ? " class='on'" : "") + ">First sensor</button><button data-v='count'" + (COV.m === "count" ? " class='on'" : "") + ">Number of sensors</button></div>" +
      "<p class='covdetail'>" + (s ? "S" + (sel + 1) + " is selected: click its row again to clear it." : "Click a sensor for green arcs to everything it covers, and how much of each region it sees.") + "</p>" +
      "<table class='sm' id='covTable'><thead><tr><th>Sensor</th><th>Sits in</th><th>Sees growth in</th><th>Seen only by this sensor <i class='info-i left' id='covOnlyTip' data-tip='" + esc(onlyTip) + "'>i</i></th></tr></thead><tbody id='covRows'>" +
      d.sensors.map(q => "<tr class='covrow" + (sel === q.r ? " sel" : "") + "' data-r='" + q.r + "'><td>" + swatch(q.r) + "S" + (q.r + 1) + " <span class='quiet'>" + esc(String(mhOf(q.c))) + "</span></td><td>" + esc(sitsIn(q.c)) + "</td><td>" + sees(q) + "</td><td>" + q.only + "</td></tr>").join("") + "</tbody></table>" +
      (s ? coverDetailHtml(d, s) : "") + coverWhyHtml(d) +
      coverCurveHtml(k, isIn) + sources("cover");
    box.querySelectorAll("#covMode button").forEach(b => { b.onclick = () => { COV.m = b.dataset.v; repaint(); }; });
    box.querySelectorAll("#covRows tr").forEach(tr => { tr.onclick = () => { const r = +tr.dataset.r; COV.sel = COV.sel === r ? null : r; repaint(); }; });
    wireCoverCurve();
  }
  // Level against float, small enough for the right panel. It moves with the rule and the number of sensors.
  let _covCurve = null;
  function coverCurveHtml(k, isIn) {
    _covCurve = null;
    const gf = !isIn && (window.SIM4_EXPLORE.coverage.greenfield.rules || {})[st.rule];
    const head = "<h4>" + (isIn ? "Level and float curves" : "Sensors to see every greenfield run") + "</h4>";
    if (!isIn && !gf) return head + "<p class='quiet'>Not worked out for this rule.</p>";
    const rule = isIn ? (window.SIM4_EXPLORE.coverage.rules || {})[st.rule] : null;
    if (isIn && !rule) return head + "<p class='quiet'>Worked out for the 10 mm and 25 mm rules.</p>";
    const K = isIn ? Math.max(...rule.level.map(p => p.n), ...rule.float.map(p => p.n)) : gf.n;
    const W_ = 300, H_ = 186, L = 34, Rt = 10, T = 8, B = 36;
    const x = n => L + (W_ - L - Rt) * (n - 1) / (K - 1), y = v => T + (H_ - T - B) * (1 - v);
    const pts = (a, f) => { const m = new Map(); a.forEach(p => m.set(p.n, p[f])); return [...m.entries()].sort((p, q) => p[0] - q[0]); };
    const SER = isIn ? [{ name: "Level, worst wet case", p: pts(rule.level, "worst"), col: COV_LEVEL, dash: "" }, { name: "Level, average", p: pts(rule.level, "average"), col: COV_LEVEL, dash: "6 4" },
      { name: "Float, worst wet case", p: pts(rule.float, "worst"), col: COV_FLOAT, dash: "" }, { name: "Float, average", p: pts(rule.float, "average"), col: COV_FLOAT, dash: "6 4" }]
      : [{ name: "Greedy, worst weather case", p: gf.worst.map((v, i) => [i + 1, v]), col: COV_LEVEL, dash: "" }, { name: "Greedy, average of 8 cases", p: gf.mean.map((v, i) => [i + 1, v]), col: COV_LEVEL, dash: "6 4" }];
    SER.forEach(s => { const last = s.p[s.p.length - 1]; if (last[0] < K) s.p.push([K, last[1]]); });   // a set that stops improving stays level
    const path = s => s.p.map(([n, v], i) => (i ? "L" : "M") + x(n).toFixed(1) + " " + y(v).toFixed(1)).join("");
    const valueAt = (s, n) => { let v = null; s.p.forEach(([m, q]) => { if (m <= n) v = q; }); return v; };
    const tickStep = K <= 40 ? 5 : K <= 100 ? 20 : 50;
    const ticks = [1]; for (let n = tickStep; n <= K; n += tickStep) ticks.push(n);
    const at = Math.min(k, K), lv = valueAt(SER[0], at);
    const top = isIn ? rule.level[rule.level.length - 1] : null, fTop = isIn ? rule.float[rule.float.length - 1] : null, full = isIn && top.worst >= 1 - 1e-9;
    const text = !isIn ? at + " sensor" + (at === 1 ? "" : "s") + " see" + (at === 1 ? "s" : "") + " <b>" + pct(lv) + "</b> of detectable runs in the worst weather case. Seeing every run takes <b>" + gf.n + "</b>, and 90% takes " + (gf.n90 || "n/a") + ". " +
        "That count leans on the " + (window.SIM4_EXPLORE.coverage.greenfield.cases - window.SIM4_EXPLORE.coverage.greenfield.settled_cases) + " weather cases that are still fixed 480-minute runs: on settled cases alone it is <b>" + gf.settled_n + "</b>, and 90% takes " + (gf.settled_n90 || "n/a") + "." : "At the " + rule.R + " mm rule, " + at + " level sensor" + (at === 1 ? "" : "s") + " see" + (at === 1 ? "s" : "") + " <b>" + (lv == null ? "n/a" : pct(lv)) + "</b> in the worst wet case, " + (full ? "reaching 100% at " + top.n : "stopping near " + pct(top.worst)) +
      ". Floats stop at <b>" + pct(fTop.worst) + "</b> worst and <b>" + pct(fTop.average) + "</b> average, however many are added.";
    _covCurve = { SER, K, W_, L, Rt, x, valueAt };
    return head + "<p class='covdetail' id='covCurveSay'>" + text + "</p>" +
      "<div class='covlegend'>" + SER.map(s => "<span><svg width='22' height='8'><line x1='0' x2='22' y1='4' y2='4' stroke='" + s.col + "' stroke-width='2' stroke-dasharray='" + s.dash + "'/></svg>" + esc(s.name) + "</span>").join("") + "</div>" +
      "<div class='covchart'><svg id='covPlot' viewBox='0 0 " + W_ + " " + H_ + "' role='img' aria-label='Share of detectable growth seen against number of sensors, for level sensors and float switches'>" +
      [0, .5, 1].map(v => "<line x1='" + L + "' x2='" + (W_ - Rt) + "' y1='" + y(v) + "' y2='" + y(v) + "' class='covgl'/><text x='" + (L - 6) + "' y='" + (y(v) + 4) + "' text-anchor='end' class='covax'>" + pct(v) + "</text>").join("") +
      ticks.map(n => "<text x='" + x(n) + "' y='" + (H_ - B + 15) + "' text-anchor='middle' class='covax'>" + n + "</text>").join("") +
      "<text x='" + ((L + W_ - Rt) / 2) + "' y='" + (H_ - 4) + "' text-anchor='middle' class='covax'>" + (isIn ? "Sensors, the best set of each size" : "Sensors, in greedy order") + "</text>" +
      "<line x1='" + x(at) + "' x2='" + x(at) + "' y1='" + T + "' y2='" + (H_ - B) + "' class='covcross' stroke-dasharray='3 3'/>" +
      SER.map(s => "<path d='" + path(s) + "' fill='none' stroke='" + s.col + "' stroke-width='2' stroke-linejoin='round' stroke-dasharray='" + s.dash + "'/>").join("") +
      (lv == null ? "" : "<circle cx='" + x(at) + "' cy='" + y(lv) + "' r='4.5' fill='" + COV_LEVEL + "' stroke='#111c2f' stroke-width='2'/>") +
      "<line id='covCross' y1='" + T + "' y2='" + (H_ - B) + "' class='covcross' visibility='hidden'/></svg><div class='covtip' id='covTip' hidden></div></div>" +
      "<p class='quiet'>" + (isIn ? "The best set of each size for seeing growth, so it can sit above the Warn before surcharge set. Scored on the runs each set was chosen on; the Level or float tab in Results has the unseen scores."
        : "Greenfield growth only, so these counts do not compare with infill's. All five estate sizes count, 700 homes included. The map and slider stop at " + (R().maxSensors || 10) + " sensors; the curve carries on past them.") + "</p>";
  }
  function wireCoverCurve() {
    if (!_covCurve) return;
    const { SER, K, W_, L, Rt, x, valueAt } = _covCurve, plot = $("#covPlot"), tip = $("#covTip"), cross = $("#covCross");
    plot.addEventListener("mousemove", e => {
      const b = plot.getBoundingClientRect(), sx = (e.clientX - b.left) * W_ / b.width, n = Math.max(1, Math.min(K, Math.round(1 + (sx - L) * (K - 1) / (W_ - L - Rt))));
      cross.setAttribute("x1", x(n)); cross.setAttribute("x2", x(n)); cross.setAttribute("visibility", "visible");
      tip.innerHTML = "<b>" + n + " sensor" + (n === 1 ? "" : "s") + "</b><br>" + SER.map(s => { const v = valueAt(s, n); return esc(s.name) + ": <b>" + (v == null ? "n/a" : pct(v)) + "</b>"; }).join("<br>");
      tip.hidden = false;
      const left = e.clientX - b.left;
      tip.style.left = (left > b.width * .5 ? Math.max(0, left - tip.offsetWidth - 10) : left + 10) + "px"; tip.style.top = "6px";
    });
    plot.addEventListener("mouseleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
  }

  const findingsTab = () => '<div class="docbody">' + markdown(window.SIM4_EXPLORE.findings) + markdown(IDX().docs.findings) + "</div>";
  function renderResults() {
    const box = $("#modalBox");
    const TABS = [["warn", "Warning"], ["room", "Room for homes"], ["float", "Level or float"], ["min", "Fewest sensors needed"], ["limits", "Limits and next steps"], ["findings", "Findings"]];
    const pane = RES.tab === "warn" ? ladderTab() : RES.tab === "room" ? roomTab() : RES.tab === "float" ? floatTab() : RES.tab === "limits" ? limitsTab() : RES.tab === "findings" ? findingsTab() : minTab();
    box.innerHTML = CLOSE + "<h2>Results</h2><div class='restabs'>" + TABS.map(([v, t]) => "<button data-tab='" + v + "'" + (v === RES.tab ? " class='on'" : "") + ">" + esc(t) + "</button>").join("") + "</div>" + pane;
    $("#modalClose").onclick = () => { $("#modal").hidden = true; };
    box.querySelectorAll(".restabs button").forEach(b => { b.onclick = () => { RES.tab = b.dataset.tab; renderResults(); }; });
    box.querySelectorAll(".resknob button").forEach(b => {
      b.onclick = () => {
        const name = b.parentElement.dataset.res, v = b.dataset.v;
        if (name === "k") { st.k = +v; repaint(); }
        else if (name === "rule") { RES.rule = v; st.rule = v; repaint(); }
        else RES[name] = v;
        renderResults();
      };
    });
    box.querySelectorAll("select.ressel").forEach(s => { s.onchange = () => { RES[s.dataset.res] = s.value; renderResults(); }; });
    box.querySelectorAll("input[data-price]").forEach(i => { i.onchange = () => { RES[i.dataset.price] = Math.max(1, +i.value || 1); renderResults(); }; });
  }
  function showResults() {
    const c = S().cases.find(x => x.tag === (curCase() || {}).tag);
    RES.tag = RES.tag || (c ? c.tag : window.SIM4_EXPLORE.design);
    if (RES.tag === S().cases[0].tag) RES.tag = window.SIM4_EXPLORE.design;
    if (WARN(st.rule)) RES.rule = st.rule === "r25" ? "r25" : "r10";
    $("#modalBox").classList.add("wide");
    renderResults();
    $("#modal").hidden = false;
    $("#modalBox").scrollTop = 0;
  }

  function showModal() {
    const sc = IDX().scenario, n = sc.numbers;
    const fact = (l, v) => v == null ? "" : '<div class="kfact">' + esc(l) + "<b>" + esc(v) + "</b></div>";
    $("#modalBox").classList.remove("wide");
    $("#modalBox").innerHTML = CLOSE + '<h2>' + esc(sc.title) + '</h2><p class="q">' + esc(sc.question) + "</p>" +
      "<p>" + esc(window.SIM4_EXPLORE.about) + "</p>" + sc.what.map(p => "<p>" + esc(p) + "</p>").join("") + "<h3>What to look at</h3><ul>" + sc.read.map(r => "<li>" + esc(r) + "</li>").join("") + "</ul>" +
      "<h3>The numbers behind it</h3><div class=kfacts>" + fact("Pipes modelled", n.pipes) + fact("Manholes", n.chambers) + fact("Properties counted", n.dwellings) +
      fact("Regions (infill)", n.regions) + fact("Uncertainty cases", n.cases) + fact("Peak factor", n.peakFactor) + fact("Wet weather settings", n.iiRange ? n.iiRange + " L/s per 100 m" : null) +
      fact("Greenfield sizes", n.stepRange ? n.stepRange + " dwellings" : null) + "</div>" +
      '<div class="caveat">' + esc(sc.caveat) + "</div>";
    $("#modal").hidden = false;
    $("#modalClose").onclick = () => { $("#modal").hidden = true; };
  }

  /* ------------------------------------------------------------------ init */
  function buildSiteList() {
    const Rr = R(), sel = $("#site");
    const homes = i => { const r = Growth3D.reach(nameOf(i)); return r ? r.here : (Rr.dwellingsAt[i] || 0); };
    const n = Rr.chambers.map((_, i) => homes(i));
    const order = Rr.chambers.map((_, i) => i).sort((a, b) => n[b] - n[a]);
    sel.innerHTML = '<option value="">No manhole selected</option>' + order.map(i => "<option value=" + JSON.stringify(String(i)) + ">" + esc(label(i)) + "  (" + n[i] + " homes)</option>").join("");
    return order;
  }
  /* ---------------------------------------------------- dropdowns that wrap */
  // The native select keeps the state (value, options, change event, the arrows step it);
  // the button shows the chosen option's text wrapped, the list shows every option's full
  // name (its title) or its text.
  function enhanceSelect(sel) {
    if (sel.dataset.dd) return;
    const dd = document.createElement("div"); dd.className = "dd";
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "ddBtn";
    const list = document.createElement("div"); list.className = "ddList"; list.hidden = true;
    dd.appendChild(btn); dd.appendChild(list);
    sel.insertAdjacentElement("afterend", dd);
    sel.dataset.dd = "1";
    btn.onclick = () => { const open = list.hidden; closeDDs(); if (open) { fillDD(sel); list.hidden = false; dd.classList.add("open"); } };
    list.onclick = e => { const o = e.target.closest("[data-v]"); if (!o) return; sel.value = o.dataset.v; closeDDs(); syncDD(sel); sel.dispatchEvent(new Event("change")); };
    sel.addEventListener("change", () => syncDD(sel));
    syncDD(sel);
  }
  function fillDD(sel) {
    const list = sel.nextElementSibling.querySelector(".ddList");
    list.innerHTML = Array.from(sel.options).map(o => '<div data-live-click title="' + esc(o.title || "") + '" data-v="' + esc(o.value) + '"' + (o.value === sel.value ? ' class="on"' : "") + ">" + esc(o.text) + "</div>").join("");
    const on = list.querySelector(".on"); if (on) on.scrollIntoView({ block: "center" });
  }
  function syncDD(sel) {
    const dd = sel.nextElementSibling; if (!dd || !dd.classList.contains("dd")) return;
    const o = sel.options[sel.selectedIndex];
    dd.querySelector(".ddBtn").textContent = o ? o.text : "";
    dd.querySelector(".ddBtn").title = o && o.title ? o.title : "";
  }
  function syncDDs() { $$("select[data-dd]").forEach(syncDD); }
  function closeDDs() { $$(".dd").forEach(d => { d.classList.remove("open"); d.querySelector(".ddList").hidden = true; }); }

  function legendKeys() {
    // One Legend button. Off by default; on, it shows the groups that apply. Regions, Coverage and the Heatmap bring their
    // own key whether Legend is on or not, and the heatmap key shows only while the heatmap does.
    const av = st.areasView, cv = st.coverView, own = av || cv, heat = st.showHeat && !own, full = st.legend && !own;
    $("#legend").hidden = !(full || own || heat);
    $("#areasKey").hidden = !av;
    $("#coverKey").hidden = !cv;
    $("#simpleKey").hidden = !full;
    $$(".legend .lg-results").forEach(g => { g.hidden = g.id === "heatKey" ? !heat : !full; });
    $$(".legend .lg-network").forEach(g => { g.hidden = !full || (g.id === "pumpKey" ? !st.showPumps : g.id === "connKey" ? !st.showConn : !(st.showPumps || st.showConn)); });
    $("#toggleLegend").classList.toggle("primary", st.legend && !own);
    $("#toggleAreas").classList.toggle("primary", av);
    $("#toggleCover").classList.toggle("primary", cv);
  }
  function legendGroups() {
    legendKeys();
    Growth3D.resize($("#stage"));
  }
  /* Live presentation sync (Capstone Live). Its script mirrors buttons, sliders and selects by
     itself; this carries what it cannot see (a manhole picked on the map, a dropdown option,
     the Pumps toggle, whose "Highlight" title it reads as a private action, a popup closed
     with Esc) and gives a viewer who joins late the presenter's whole view. */
  const LIVE = ["region", "step", "site", "add", "caseTag", "rule", "k", "method", "obj", "pickedGreedy", "pick"];
  const LIVE_TOGGLES = { showSensors: "#toggleSensors", showHeat: "#toggleHeat", showPumps: "#togglePumps",
                         showConn: "#toggleConn", legend: "#toggleLegend", areasView: "#toggleAreas", coverView: "#toggleCover" };
  const docOpen = () => $("#modal").hidden ? null : $("#modalBox .docbody > .lead") ? "ref" : $("#modalBox").classList.contains("wide") ? "qa" : "about";
  function liveGet() {
    const v = { view: st.view, fam: st.fam, rb: st.rb, lb: st.lb, top: st.top, words: st.words, doc: docOpen() };
    LIVE.concat(Object.keys(LIVE_TOGGLES)).forEach(k => { v[k] = st[k]; });
    return v;
  }
  function liveSet(v) {
    if (!v || typeof v !== "object") return;
    if (v.view && v.view !== st.view) setView(v.view);
    if (v.fam && v.fam !== st.fam) setFamily(v.fam);
    ["rb", "lb", "top"].forEach(w => { if (typeof v[w] === "boolean" && v[w] !== st[w]) setFold(w, v[w]); });
    if (typeof v.words === "boolean" && v.words !== st.words) setWords(v.words);
    for (const k in LIVE_TOGGLES) if (typeof v[k] === "boolean" && v[k] !== st[k]) $(LIVE_TOGGLES[k]).click();
    let dirty = false;
    LIVE.forEach(k => { if (k in v && v[k] !== st[k]) { st[k] = v[k]; dirty = true; } });
    if (dirty) repaint();
    const d = v.doc || null;
    if (d !== docOpen()) { if (!d) $("#modal").hidden = true; else if (d === "about") showModal(); else showDoc(d); }
  }
  function init() {
    names().forEach((c, i) => { idxOfName[c] = i; });
    regionOf = names().map(() => -1);
    S().regions.forEach((r, ri) => { if (!r.overlay) r.manholes.forEach(i => { regionOf[i] = ri; }); });
    const design = S().cases.find(c => Math.abs(c.ii - 0.11) < 1e-6 && /^Design wet$/.test(c.label)) || S().cases[1] || S().cases[0];
    st.caseTag = design.tag;
    st.step = Math.max(0, ladder().indexOf(1.0));
    // Presets from the URL hash (view, fam, region, step, case, rule, k, method), so a view
    // can be linked to and the page can be checked headless.
    const hp = new URLSearchParams((location.hash || "").replace(/^#/, ""));
    if (hp.get("view") === "expert") st.view = "expert";
    if (["infill", "one", "none"].includes(hp.get("fam"))) st.fam = hp.get("fam");
    if (hp.get("region") != null && S().regions[+hp.get("region")]) st.region = +hp.get("region");
    if (hp.get("step") != null && ladder()[+hp.get("step")] != null) st.step = +hp.get("step");
    if (hp.get("case")) st.caseTag = hp.get("case");
    if (hp.get("rule") && ruleOf(hp.get("rule"))) st.rule = hp.get("rule");
    if (hp.get("k")) st.k = Math.max(1, Math.min(10, +hp.get("k") || st.k));
    if (["greedy", "risk", "exact"].includes(hp.get("method"))) st.method = hp.get("method");
    if (hp.get("site") != null && names()[+hp.get("site")]) st.site = +hp.get("site");
    if (st.fam === "one" && (st.method === "exact" || st.method === "warn")) st.method = "greedy";
    if (st.view === "simple") st.rule = "r10";
    if (hp.get("areas") === "1") st.areasView = true;
    if (hp.get("cover") === "1" || hp.get("results") === "cover") st.coverView = true;   // the old Results tab's link lands on the view
    document.body.classList.toggle("simple", st.view === "simple");
    document.body.classList.toggle("expert", st.view === "expert");
    Growth3D.build($("#stage"), nd => {
      st.hover = null;
      if (!nd) { st.pick = null; if (st.fam === "one" && st.site != null) st.site = null; repaint(); return; }
      if (!(nd.name in idxOfName)) return;
      const i = idxOfName[nd.name];
      if (st.fam === "one") { st.site = i; st.pick = null; }
      else st.pick = nd.name;          // inspect it; the selected region stays (23 Oct 2026)
      repaint();
    }, nd => {
      const name = nd && !(st.fam === "one" && st.site != null && nd.name === nameOf(st.site)) ? nd.name : null;
      if (name === st.hover) return;
      st.hover = name;
      renderHomes(sensorSet());
      coverHoverLine();
    }).then(() => {
      $("#kRange").max = String(R().maxSensors || 10);
      buildKnobs();
      buildSiteList();
      legendGroups();
      if (hp.get("panel") === "0") setFold("rb", false);
      if (hp.get("top") === "0") setFold("top", false);
      if (hp.get("words") === "0") setWords(false);
      if (hp.get("open") === "ref" || hp.get("open") === "qa") showDoc(hp.get("open"));
      else if (hp.get("open") === "about") showModal();
      $("#scale").textContent = G().nPipes + " pipes, " + G().nChambers + " manholes, " + (G().nHouses || G().baseDwellings) + " connected properties, plus " +
        G().nodes.filter(n => n.kind !== "chamber").length + " pipe ends with no manhole on record. Elevation is the pipe invert, exaggerated x" + Growth3D.ZEXAG +
        ". Drag to turn the map, right-drag to move it, scroll to zoom where the pointer is.";
      repaint();
      Growth3D.frame(null);            // the whole network, orbiting about its centre
      // The page state first, then the camera, so a follower's view lands on the state it shows.
      const live = () => { window.LiveSync?.register("sim4explore", liveGet, liveSet); Growth3D.liveCamera(); };
      if (window.LiveSync) live(); else window.addEventListener("load", () => window.LiveSync && live(), { once: true });
    });
    $("#btn-info").onclick = showModal;
    // Full screen, for the whole page. In the landing page's frame this needs the frame's allow="fullscreen".
    {
      const fsBtn = $("#btn-full"), root = document.documentElement;
      const on = () => document.fullscreenElement || document.webkitFullscreenElement;
      if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) fsBtn.hidden = true;
      fsBtn.onclick = () => { if (on()) (document.exitFullscreen || document.webkitExitFullscreen).call(document); else (root.requestFullscreen || root.webkitRequestFullscreen).call(root); };
      const sync = () => { const f = !!on(); fsBtn.classList.toggle("primary", f); fsBtn.title = f ? "Leave full screen (Esc)" : "Full screen"; fsBtn.setAttribute("aria-label", fsBtn.title); Growth3D.resize($("#stage")); };
      document.addEventListener("fullscreenchange", sync);
      document.addEventListener("webkitfullscreenchange", sync);
    }
    $("#btn-results").onclick = showResults;
    { const foot = $("#mapFoot"), sync = () => $("#stageWrap").style.setProperty("--foot", foot.offsetHeight + "px");
      if (window.ResizeObserver) new ResizeObserver(sync).observe(foot);
      sync(); }
    { const h = new URLSearchParams(location.hash.slice(1)); if (h.get("results") && h.get("results") !== "cover") { RES.tab = h.get("results"); if (h.get("rescase")) RES.tag = h.get("rescase"); setTimeout(showResults, 400); } }
    $("#tab-ref").onclick = () => showDoc("ref");
    $("#modal").onclick = e => { if (e.target.id === "modal") $("#modal").hidden = true; };
    document.addEventListener("keydown", e => { if (e.key === "Escape") { $("#modal").hidden = true; closeDDs(); } });
    // The (i) bubble: one fixed box, placed under the icon and kept inside the window.
    const tipBox = document.createElement("div");
    tipBox.id = "tipBox"; tipBox.hidden = true;
    document.body.appendChild(tipBox);
    const placeTip = i => {
      const r = i.getBoundingClientRect(), w = tipBox.offsetWidth, h = tipBox.offsetHeight;
      let left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
      let top = r.bottom + 8;
      if (top + h > window.innerHeight - 8) top = r.top - 8 - h;
      if (top < 8) top = 8;
      tipBox.style.left = left + "px"; tipBox.style.top = top + "px";
    };
    document.addEventListener("mouseover", e => {
      const i = e.target.closest && e.target.closest(".info-i[data-tip]");
      if (!i || !i.dataset.tip) return;
      tipBox.textContent = i.dataset.tip; tipBox.hidden = false; placeTip(i);
    });
    document.addEventListener("mouseout", e => {
      const i = e.target.closest && e.target.closest(".info-i[data-tip]");
      if (i && !(e.relatedTarget && i.contains(e.relatedTarget))) tipBox.hidden = true;
    });
    document.addEventListener("scroll", () => { tipBox.hidden = true; }, true);
    // Dropdowns that wrap: a button and a list drawn beside each hidden native select.
    $$("select").forEach(enhanceSelect);
    document.addEventListener("click", e => { if (!e.target.closest(".dd")) closeDDs(); });
    $("#toggleSensors").onclick = () => {
      st.showSensors = !st.showSensors;
      $("#toggleSensors").classList.toggle("primary", st.showSensors);
      repaint();
    };
    const hasPumps = !!(G().pumps && G().pumps.length);
    $("#togglePumps").hidden = !hasPumps;
    $("#togglePumps").onclick = () => {
      st.showPumps = !st.showPumps;
      if (!Growth3D.showPumps(st.showPumps)) { st.showPumps = false; return; }
      $("#togglePumps").classList.toggle("primary", st.showPumps);
      legendGroups();
    };
    $("#toggleHeat").onclick = () => { st.showHeat = !st.showHeat; $("#toggleHeat").classList.toggle("primary", st.showHeat); repaint(); };
    $("#toggleConn").hidden = !(G().cptr && G().cptr.length > 1);
    $("#toggleConn").onclick = () => {
      st.showConn = !st.showConn;
      const counts = Growth3D.showConnections(st.showConn);
      if (counts == null) { st.showConn = false; return; }
      $("#toggleConn").classList.toggle("primary", st.showConn);
      if (counts) { $("#connMis").textContent = counts.mis; $("#connSpare").textContent = counts.spare; $("#connGuess").textContent = counts.guess; }
      legendGroups();
    };
    $("#toggleIds").hidden = true;      // not in this build; the hover and the card give the id
    // The sidebar grip, as on the Sim 2.5 page.
    const grip = $("#grip");
    grip.onpointerdown = e => {
      grip.classList.add("on"); document.body.classList.add("dragging");
      const move = ev => { const w = Math.max(260, Math.min(560, ev.clientX)); document.documentElement.style.setProperty("--side", w + "px"); Growth3D.resize($("#stage")); };
      const up = () => { grip.classList.remove("on"); document.body.classList.remove("dragging"); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); e.preventDefault();
    };
  }
  return { init, state: st, repaint };
})();
