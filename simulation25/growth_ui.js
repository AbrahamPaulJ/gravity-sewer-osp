/* growth_ui.js - pick where the houses go, see what it costs and who would notice.

   The page has one control that matters: which chamber the new dwellings connect at.
   Everything else is a readout of a SWMM run that has already happened.

   THE DISTINCTION THIS INTERFACE EXISTS TO PROTECT. A chamber that was already surcharged
   before any houses were added is not evidence about growth. Only the ones that TIP are.
   The sandbox's capacity module makes the same point in its own header, and it is easy to
   lose the moment you draw everything in one colour, so amber and red never merge here
   and the counts are always reported separately. */
"use strict";
window.GrowthUI = (function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  // ii = case index; add = growth size index; rule = detection rule index (25 mm rise).
  // k and obj drive the sensor set: k sensors chosen once across all cases, for the best
  // worst case or the best average. showHeat colours the manholes by their own coverage.
  const st = { site: 0, showSensors: false, showHeat: false, k: 3, obj: "worst", ii: 1, add: 3, rule: 2,
               hover: null,                                    // a manhole NAME, or null
               // Growth at one manhole (the grid), or a scenario the reader builds: scn is
               // [{i: chamber index, n: dwellings}], runner whether a local SWMM runner
               // answered (null until asked), scnRuns the SWMM answers, by case and sites.
               mode: "one", scn: [], runner: null, scnRuns: {}, busy: false,
               // Pump stations at a set rate in the scenario (SWMM runner only): on or off,
               // the rates changed from default by rising main id, the runner's defaults.
               pumpOn: false, pumpRates: {}, pumpDefaults: null,
               algo: "swmm" };                                 // a Placement.METHODS id

  const runs = () => window.GROWTH_RUNS;
  const geom = () => window.GROWTH_GEOM;
  const byName = {};

  /* ----------------------------------------------------------------- state */
  /* One cell of the grid is one (wet weather, growth size) pair. Everything on screen is
     read out of the cell the two knobs select, so a knob costs a lookup and nothing is
     recomputed. Chambers are held as indices throughout, because the payload stores them
     that way and converting once at the edge is cheaper than everywhere. */
  /* The growth size "None" (st.add === NO_GROWTH): a click only selects a manhole, so the map
     and panels show the network as it is in the case. Its cell has no growth rows; what is
     already over the alarm before growth is the same for every size, so it comes from any. */
  const NO_GROWTH = -1;
  const noGrowth = () => st.add === NO_GROWTH;
  function cell() {
    const R = runs(), rule = R.rules[st.rule].id;
    if (noGrowth()) {
      const any = R.cells.find(c => c.case === st.ii && c.rule === rule) || R.cells[0];
      return { case: st.ii, add: 0, rule, base: any.base, rows: [] };
    }
    const add = R.growthLevels[st.add];
    return R.cells.find(c => c.case === st.ii && c.add === add && c.rule === rule)
      || R.cells[0];
  }

  const ruleId = () => runs().rules[st.rule].id;
  const graded = () => ruleId() !== "alarm";
  const caseLabel = () => runs().cases[st.ii].label;
  // How many cases the build published. config.js's case set decides it, so nothing here may say 12.
  const nCases = () => runs().cases.length;

  /* The sensor set: the first k of the order chosen across ALL cases for the current
     rule and objective. The order is nested, so sensor k+1 is always added to the first k. */
  /* The sensors for the selected method. Sim 2.5's own greedy is published by the builder;
     the sandbox's methods are run here by placement.js, once per method, rule and objective,
     and every method is scored against the same SWMM runs, so the numbers compare. */
  let _plCtx = null;
  const _plCache = {};
  function placement() {
    if (st.algo === "swmm" || !window.Placement || !window.OSPCore) return runs().sensors[ruleId()][st.obj];
    const key = st.algo + "|" + ruleId() + "|" + st.obj;
    if (!_plCache[key]) {
      if (!_plCtx) _plCtx = Placement.context(geom(), runs(), OSPCore);
      _plCache[key] = Placement.place(st.algo, _plCtx, ruleId(), st.obj);
    }
    return _plCache[key];
  }
  // The k-sensor set. Nested methods add one sensor at a time; two-up-two-down and random
  // choose afresh at each size, so their k set is stored whole.
  const chosenAt = (pl, k) => pl.sets ? pl.sets[k - 1] : pl.order.slice(0, k);
  const sensorSet = () => chosenAt(placement(), st.k).map(i => nameOf(i));
  function shownSensors() { return st.showSensors ? sensorSet() : []; }

  /* name -> the manhole's coverage on its own, for the heatmap, or null when it is off. */
  /* Coloured by RANK among the 71, not by the raw share: in the worst case most manholes see
     under a tenth on their own, so any value scale left the map one colour. Rank spreads the
     71 evenly from darkest to lightest; ties share a rank. The real percentages are in the
     hover line and the sensor list, so nothing is hidden by the ranking. */
  function heatRanks() {
    // Dense rank: each distinct value is one colour step, so 0% is always the darkest and the
    // top value the lightest, however many manholes tie (many share 0% in the worst case).
    const v = runs().heat[ruleId()][st.obj];
    const levels = [...new Set(v)].sort((a, b) => a - b), n = levels.length;
    return v.map(x => n > 1 ? levels.indexOf(x) / (n - 1) : 1);
  }
  // Competition rank for the hover line: 1 + how many manholes score strictly higher.
  const rankOf = i => { const v = runs().heat[ruleId()][st.obj]; return 1 + v.filter(x => x > v[i]).length; };
  function heatValues() {
    if (!st.showHeat) return null;
    const r = heatRanks(), out = {};
    r.forEach((x, i) => { out[nameOf(i)] = x; });
    return out;
  }

  /* Overflow (water spilling from a manhole's lid), from SWMM: which manholes spill before
     any growth in the selected case, and which the selected growth newly makes spill. Null
     where the build published no spill data (a segment build). */
  const hasSpill = () => !!runs().spill;
  const spillBefore = () => (runs().baseSpilled ? runs().baseSpilled[st.ii] : []);
  function spillNew(siteIdx) {
    const R = runs();
    if (!R.spill || siteIdx == null || noGrowth()) return [];
    const hit = (R.spill[st.ii][String(R.growthLevels[st.add])] || []).find(x => x[0] === siteIdx);
    return hit ? hit[1] : [];
  }

  function rowFor(c, siteIdx) {
    return c.rows.find(r => r.site === siteIdx) || null;
  }

  /* chamber index -> "tip" | "was" | "ok" */
  function stateFor(c, row) {
    const out = {};
    c.base.forEach(i => { out[i] = "was"; });
    if (row) row.tip.forEach(i => { out[i] = "tip"; });
    return out;
  }

  const nameOf = i => runs().chambers[i];
  const mhOf = i => runs().manholeIds[i];

  /* --------------------------------------------------------------- select */
  /* st.site is the selected manhole, which is also where the growth goes; null means none.
     With nothing selected there is no growth anywhere: the map shows the network as it is,
     manholes already over the alarm still amber, and both panels say how to pick one. */
  function select(siteIdx) {
    st.site = siteIdx;
    repaint();
  }

  function repaint() {
    if (st.mode === "scn") return repaintScenario();
    Growth3D.setScenario([]);
    const c = cell(), row = rowFor(c, st.site);
    const byIdx = stateFor(c, row);
    // How far the change reaches: manholes rising 10 mm or more that the selected rule does
    // not count, from the 10 mm cell of the same case, size and site.
    if (row && ruleId() !== "r10") {
      const R = runs(), add = R.growthLevels[st.add];
      const c10 = R.cells.find(x => x.case === st.ii && x.add === add && x.rule === "r10");
      const r10 = c10 && rowFor(c10, st.site);
      if (r10) r10.tip.forEach(i => { if (!byIdx[i]) byIdx[i] = "rise"; });
    }
    // Growth3D works in chamber NAMES, so translate once, here.
    const named = {};
    for (const k in byIdx) named[nameOf(+k)] = byIdx[k];
    const sensors = shownSensors();
    Growth3D.paint(named, nameOf(st.site), sensors, heatValues());
    Growth3D.setSpills(spillBefore().map(nameOf), spillNew(st.site).map(nameOf));
    Growth3D.setPumpRates([]);
    renderHomes(sensors);
    $("#site").value = st.site == null ? "" : String(st.site);
    renderPanel(c, row);
    renderSensors();
    $("#heatKey").hidden = !st.showHeat;

    $("#heatWhich").textContent = (st.obj === "worst" ? "worst of the " : "average of the ") + nCases() + " cases" +
      ", " + runs().rules[st.rule].label.toLowerCase();
    renderKnobs();
    renderLegend();
  }

  /* ---------------------------------------------------------------- homes */
  /* Which homes are behind the manhole in question, lit on the map and counted in the
     legend. Hovering previews another manhole without moving the growth; showing the
     proposed sensors switches to which homes' sewage passes one. Precedence is in that
     order, because a hover is the most deliberate thing a person is doing at that moment. */
  function renderHomes(sensors) {
    const mhName = nm => (byName[nm] && byName[nm].mh ? "MH " + byName[nm].mh : nm);
    // FIXED SHAPE. Every state writes exactly a heading, three rows and one hint, each a
    // single clipped line, into a box of fixed size. Hovering flips between states many
    // times a second, and when the states had different amounts of text the box changed
    // height and everything around it moved.
    const row = (col, text, ring) => '<div class="row">' + (col ? '<span class="k' +
      (ring ? " ring" : "") + '" style="background:' + col + '"></span>' : "") + text + "</div>";
    const put = (head, r1, r2, r3, hint) => {
      $("#homeKey").innerHTML = '<div class="row head">' + head + "</div>" + r1 + r2 + r3 +
        '<div class="row quiet2">' + hint + "</div>";
    };
    let spec, lead;
    if (st.hover) {
      spec = { mode: "site", name: st.hover };
      lead = "Homes behind " + esc(mhName(st.hover));
    } else if (st.showSensors && sensors.length) {
      spec = { mode: "sensors", names: sensors };
    } else if (st.site == null) {
      spec = { mode: "none" };
    } else {
      spec = { mode: "site", name: nameOf(st.site) };
      lead = "Homes behind " + esc(mhName(nameOf(st.site)));
    }
    const r = Growth3D.highlight(spec);
    if (!r) { put("", "", "", "", ""); return; }
    if (r.mode === "none") {
      put("No manhole selected",
        row("#ff6f9c", "<strong>" + r.total + "</strong> connected homes"),
        row("", "No growth placed"),
        row("", "&nbsp;"),
        "Click a manhole to place the growth there");
      return;
    }
    if (r.mode === "sensors") {
      const pct = Math.round(100 * r.watched / r.total);
      put("Homes and the " + sensors.length + " sensor" + (sensors.length === 1 ? "" : "s"),
        row("#3fb950", "<strong>" + r.watched + "</strong> of " + r.total +
            " drain past a sensor (" + pct + "%)"),
        row("", "<strong>" + r.unwatched + "</strong> do not"),
        row("", "&nbsp;"),
        "Green sleeves: pipes feeding a sensor");
      return;
    }
    // Heatmap on: the hint line carries the hovered (or selected) manhole's own score.
    const heatHint = () => {
      const nm = st.hover || nameOf(st.site), R = runs(), i = R.chambers.indexOf(nm);
      if (i < 0) return "Not a study manhole";
      const h = R.heat[ruleId()];
      return "Rank " + rankOf(i) + " of " + R.chambers.length + ". Alone: " + Math.round(100 * h.mean[i]) + "% average, " +
        Math.round(100 * h.worst[i]) + "% worst case";
    };
    put(lead,
      // The panel's "connected here" counts only the manhole's own pipe. The rest come in
      // through pipe ends with no manhole on record; saying so stops the numbers disagreeing.
      row("#1f4fff", "<strong>" + r.here + "</strong> reach it first" +
        (r.here > r.direct ? " (" + (r.here - r.direct) + " via unrecorded pipe ends)" : ""),
        true),
      row("#7dc4e0", "<strong>" + r.through + "</strong> drain through it from further up"),
      row("#3a2430", "<strong>" + r.elsewhere + "</strong> elsewhere"),
      st.showHeat ? heatHint()
        : st.hover ? "Previewing. Click to move the growth here."
                   : "Hover any manhole to preview its homes");
  }

  function label(i) {
    const mh = mhOf(i);
    return mh ? "MH " + mh : nameOf(i);
  }

  /* ------------------------------------------------------------------ list */
  function buildList() {
    const R = runs(), sel = $("#site");
    // Busiest first, by the same count as the panel: homes reaching the manhole first,
    // including those entering at an unrecorded pipe end above it.
    const homes = i => { const r = Growth3D.reach(nameOf(i)); return r ? r.here : (R.dwellingsAt[i] || 0); };
    const n = R.chambers.map((_, i) => homes(i));
    const order = R.chambers.map((_, i) => i).sort((a, b) => n[b] - n[a]);
    sel.innerHTML = '<option value="">No manhole selected</option>' + order.map(i =>
      "<option value=" + JSON.stringify(String(i)) + ">" + esc(label(i)) +
      "  (" + n[i] + " homes)</option>").join("");
    sel.onchange = () => select(sel.value === "" ? null : +sel.value);   // +"" would be 0
    return order;
  }

  /* ------------------------------------------------------------------ knobs */
  /* Two controls, both reading straight out of the precomputed grid. Segmented buttons
     rather than sliders on purpose: every position is a real SWMM run and there is nothing
     in between them, so a continuous control would be inviting interpolation. */
  function buildKnobs() {
    const R = runs();
    $("#iiKnob").innerHTML = R.cases.map((l, i) =>
      "<button data-i=" + JSON.stringify(String(i)) + " title=" + JSON.stringify(l.note) + ">" +
      esc(l.label) + '<span class="knobNum">' + l.ii.toFixed(2) + " L/s/100m</span></button>").join("");
    $("#ruleKnob").innerHTML = R.rules.map((l, i) =>
      "<button data-i=" + JSON.stringify(String(i)) + " title=" + JSON.stringify(l.note) + ">" +
      esc(l.label) + "</button>").join("");
    $("#ruleKnob").onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      st.rule = +b.dataset.i; repaint();
    };
    $("#addKnob").innerHTML = '<button data-i="' + NO_GROWTH + '" title="Select manholes without adding any growth">None</button>' +
      R.growthLevels.map((g, i) =>
        "<button data-i=" + JSON.stringify(String(i)) + ">+" + g + "</button>").join("");
    $("#iiKnob").onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      st.ii = +b.dataset.i; repaint();
    };
    $("#addKnob").onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      st.add = +b.dataset.i; repaint();
    };
  }

  function renderKnobs() {
    const R = runs();
    document.querySelectorAll("#iiKnob button").forEach(b =>
      b.classList.toggle("on", +b.dataset.i === st.ii));
    document.querySelectorAll("#addKnob button").forEach(b =>
      b.classList.toggle("on", +b.dataset.i === st.add));
    document.querySelectorAll("#ruleKnob button").forEach(b =>
      b.classList.toggle("on", +b.dataset.i === st.rule));
    document.querySelectorAll("#modeKnob button").forEach(b =>
      b.classList.toggle("on", b.dataset.m === st.mode));
    // A scenario is only offered where the page carries what it needs: the per-case loads
    // the estimate starts from, which a whole-area build publishes.
    $("#modeKnob").hidden = !R.baseLoads;
    $("#iiNote").textContent = R.cases[st.ii].note;
    $("#ruleNote").textContent = R.rules[st.rule].note;
  }

  /* "This manhole": the selected manhole as an asset, apart from what growth there does.
     Water before growth and headroom lead, because they are what make a manhole a choke
     point; the rest is what the council record and the model know about it. Everything
     here follows the selected case and detection rule, as the rest of the panel does. */
  // G6: the operator's low alarm, above invert. config.js's alarm_depth_mm, published with the runs.
  const ALARM_MM = window.GROWTH_RUNS.alarmMm;
  const GROUND = { contour: "from the 1 m contours", surveyed: "surveyed", none: "not known" };
  let _incoming = null;
  function upstreamOf(g, ni) {
    if (!_incoming) {                          // links entering each node, built once
      _incoming = g.nodes.map(() => []);
      for (let l = 0; l < g.up.length; l++) _incoming[g.down[l]].push(l);
    }
    const seen = new Set([ni]), stack = [ni], pipes = new Set();
    let chambers = 0, metres = 0;
    while (stack.length) {
      for (const l of _incoming[stack.pop()]) {
        const key = g.pid && g.pid[l] != null ? g.pid[l] : "link" + l;
        if (!pipes.has(key)) { pipes.add(key); metres += (g.plen && g.plen[l]) || 0; }
        const up = g.up[l];
        if (seen.has(up)) continue;
        seen.add(up); stack.push(up);
        if (g.nodes[up].kind === "chamber") chambers++;
      }
    }
    return { chambers, metres };
  }
  // In scenario mode, what the scenario does to this manhole, and where the answer came from.
  function scnRow(i) {
    if (st.mode !== "scn") return "";
    const out = scnOutcome(), v = out && out.per.get(i);
    if (!v) return "";
    const tag = out.source === "swmm" ? "SWMM" : "estimate";
    const flags = out.source !== "swmm" ? ""
      : v.spillNew ? ', <b class="bad">overflows</b>' : v.surNew ? ', <b class="bad">surcharges</b>'
      : v.alarmNew ? ', <b class="bad">passes the alarm</b>' : "";
    return row2("This scenario", (v.rise >= 1 ? "<b>+" + Math.round(v.rise) + " mm</b>" : "no rise") + flags +
      ' <span class="quiet">(' + tag + ")</span>");
  }
  function renderManhole() {
    const box = $("#mhFacts");
    if (!box) return;
    if (st.site == null) {
      box.innerHTML = "<h4>This manhole</h4>" +
        '<p class="quiet">Click a manhole on the map to see its water level, headroom, ' +
        "pipes and value as a sensor. Click empty ground to clear it.</p>";
      return;
    }
    const R = runs(), g = geom(), i = st.site, nm = nameOf(i);
    const ni = g ? g.nodes.findIndex(x => x.name === nm) : -1;
    if (ni < 0) { box.innerHTML = ""; return; }
    const n = g.nodes[ni];
    const inv = g.oz + n.inv / 100;
    const ins = [], outs = [];
    for (let l = 0; l < g.up.length; l++) {
      if (g.up[l] === ni) outs.push(l);
      if (g.down[l] === ni) ins.push(l);
    }
    const mm = ls => [...new Set(ls.map(l => g.dia[l]).filter(Boolean))].sort((a, b) => a - b)
      .join(", ") + " mm";
    const out = outs[0];
    const pipes = (ins.length ? ins.length + " in (" + mm(ins) + ")" : "none in, it is a top end") +
      (out != null ? ", out " + g.dia[out] + " mm" + (g.pid && g.pid[out] ? " (pipe " + g.pid[out] + ")" : "") : "");
    const up = upstreamOf(g, ni);

    // Water before growth, in the selected case, and what is left above it.
    const d = R.baseDepthMm ? R.baseDepthMm[st.ii][i] : null;
    const over = R.baseOver && R.baseOver[st.ii].includes(i);
    const sur = R.baseSurcharged && R.baseSurcharged[st.ii].includes(i);
    const spills = spillBefore().includes(i);
    let water = null, head = null;
    if (d != null) {
      water = "<b>" + d + " mm</b> deep";
      const crown = out != null ? g.dia[out] : null;
      head = spills ? '<b class="bad">overflowing</b>: water already spills from its lid'
        : sur ? '<b class="bad">surcharged</b>: above the top of its pipe already'
        : over ? '<b class="bad">' + (d - ALARM_MM) + " mm over</b> the " + ALARM_MM + " mm alarm already"
        : "<b>" + (ALARM_MM - d) + " mm</b> to the " + ALARM_MM + " mm alarm" +
          (crown ? ", " + (crown - d) + " mm to the top of its pipe" : "");
    }

    // As a sensor, under the selected rule and objective.
    const h = R.heat[ruleId()], chosen = chosenAt(placement(), st.k).includes(i);
    // rankOf ranks by the objective the sensor list uses, worst case or average. Say which:
    // shown beside the average, a worst-case rank read as wrong (43% and 9% averages both
    // ranked 285th, tied at 0% worst case).
    const by = st.obj === "worst" ? "worst case" : "average";
    const vals = h[st.obj], ties = vals.filter(x => x === vals[i]).length - 1;
    const sensor = pct(h.mean[i]) + " average, " + pct(h.worst[i]) + " worst case; rank " +
      rankOf(i) + " of " + R.chambers.length + " by " + by +
      (ties ? " (tied with " + ties + " other" + (ties === 1 ? "" : "s") + ")" : "") +
      (chosen ? ", <b>one of the " + st.k + " chosen</b>" : "");

    box.innerHTML = "<h4>This manhole</h4>" +
      row2("Asset", "MH " + n.mh + (n.yr ? ", built " + n.yr : ", year not recorded")) +
      (water ? row2("Water before growth", water) : "") +
      (head ? row2("Headroom", head) : "") +
      scnRow(i) +
      row2("Pipe floor / ground", inv.toFixed(2) + " / " + (inv + n.depth).toFixed(2) +
        ' m <span class="quiet">(' + n.depth.toFixed(1) + " m deep)</span>") +
      row2("Pipes", pipes) +
      row2("Drains through it", up.chambers + " manholes, " + (up.metres / 1000).toFixed(2) + " km of pipe") +
      row2("As a sensor", sensor) +
      '<p class="quiet">Water and headroom are for ' + esc(caseLabel()) + "; the sensor figures for " +
      esc(R.rules[st.rule].label.toLowerCase()) + ". Ground level " + (GROUND[n.cs] || "not known") +
      ". Manhole positions are schematic in the council record, not surveyed.</p>";
  }

  // Depends on the case and rule only, so it is written in either mode, and with or without
  // a manhole selected; with none selected it is the only account of the case on the panel.
  /* ------------------------------------------------------------ scenario */
  /* A growth scenario: new dwellings at several manholes, each its own amount. The page
     cannot run SWMM, so the answer comes from one of two places and always says which:

       SWMM      sim25_serve.py, run locally, solves it with the grid's own function and
                 model; exact, about 25 s. Cached per case and set of sites.
       Estimate  growth_est.js, instant: exact flows plus a backwater pass. Checked against
                 the grid's 8,200 SWMM runs it is close in dry weather, finds almost every
                 manhole SWMM shows rising in the wet cases but also flags up to 4 in 10 that
                 do not, and is unreliable in Severe. Shown only until SWMM has answered. */
  const EST_NOTE = "an instant estimate, not SWMM. Checked against the 8,200 grid runs: " +
    "close to SWMM in dry weather; in the wet cases it finds almost every manhole SWMM shows " +
    "rising, but up to 4 in 10 it flags do not rise; unreliable in Severe. It is not " +
    "trusted for the " + ALARM_MM + " mm alarm or for surcharge (in the wet cases it finds 44% to 71% of " +
    "the manholes SWMM puts newly over the alarm, and 6 or 7 in 10 of its own are wrong), so " +
    "those are shown only from SWMM.";
  const DEFAULT_DWELLINGS = window.GROWTH_RUNS.defaultDwellings;   // config.js, via the runs
  const threshold = () => graded() ? +ruleId().slice(1) : null;
  const scnKey = () => runs().cases[st.ii].tag + "|" +
    st.scn.map(s => runs().manholeIds[s.i] + ":" + s.n).sort().join(",") + "|" + pumpKey();
  const seenBy = v => graded() ? v.rise >= threshold() : v.alarmNew;

  /* Pump stations at a set rate (config.js pumps, option A). Only the stations the model
     solves, keyed by the first rising main as the runner keys them. A station's default is
     what the runner reports at start-up (config.js as it reads it), else the published one. */
  const pumpStations = () => ((geom() && geom().pumps) || []).filter(p => p.modelled && p.rm);
  const pumpDefault = rm => {
    const live = st.pumpDefaults && st.pumpDefaults[rm];
    if (live != null) return live;
    const p = pumpStations().find(x => x.rm === rm);
    return p ? p.rate : null;
  };
  const pumpRate = rm => (st.pumpRates[rm] != null ? st.pumpRates[rm] : pumpDefault(rm));
  const pumpKey = () => st.pumpOn
    ? "rated:" + pumpStations().map(p => p.rm + "=" + pumpRate(p.rm)).join(",") : "ideal";
  // The estimate is close to SWMM on the rise, not on the alarm or surcharge (EST_NOTE), so
  // under the alarm rule, or for those two rows, only a SWMM answer is shown.
  const trusted = out => out.source === "swmm" || graded();

  let _P = null, _geoIdx = null;
  function estimateScn() {
    const g = geom(), R = runs();
    if (!window.GrowthEst || !R.baseLoads) return null;
    if (!_P) {
      _P = GrowthEst.prepare(g);
      _geoIdx = {};
      g.nodes.forEach((n, k) => { _geoIdx[n.name] = k; });
    }
    const sites = st.scn.map(x => [_geoIdx[nameOf(x.i)], x.n]).filter(x => x[0] != null);
    const r = GrowthEst.scenario(_P, R.baseLoads[st.ii], sites, R.lpsPerDwelling[st.ii]);
    const per = new Map();
    R.chambers.forEach((nm, i) => {
      const k = _geoIdx[nm], rise = r.rise[k];
      if (k == null || isNaN(rise)) return;
      // The alarm is judged from the published SWMM baseline plus the estimated rise, so
      // the estimate and SWMM agree on which manholes start over it.
      const b0 = R.baseDepthMm ? R.baseDepthMm[st.ii][i] : null;
      per.set(i, { rise, alarmNew: b0 != null && b0 < ALARM_MM && b0 + rise >= ALARM_MM,
                   surNew: !r.base.sur[k] && !!r.now.sur[k] });
    });
    return { source: "est", per, addedLps: r.addedLps };
  }
  function fromRunner(res) {
    const per = new Map();
    runs().manholeIds.forEach((mh, i) => {
      const v = res.manholes[String(mh)];
      if (v) per.set(i, { rise: v.rise_mm, alarmNew: v.alarm && !v.alarm_before,
                          surNew: v.surcharged && !v.surcharged_before,
                          spillNew: !!v.spilled && v.spilled_before === false });
    });
    return { source: "swmm", per, addedLps: res.added_lps, seconds: res.seconds,
             err: res.continuity_error_pct, pumps: res.pumps };
  }
  function scnOutcome() {
    if (!st.scn.length && !st.pumpOn) return null;
    const hit = st.scnRuns[scnKey()];
    if (hit) return fromRunner(hit);
    // Stop-start pumping is beyond the estimate: with pumps at set rates only SWMM answers.
    if (st.pumpOn) return { source: "needs", per: new Map(), addedLps: 0 };
    return estimateScn();
  }

  function repaintScenario() {
    const R = runs(), c = cell(), out = scnOutcome();
    const named = {};
    if (!graded()) R.baseOver[st.ii].forEach(i => { named[nameOf(i)] = "was"; });
    if (out && trusted(out)) for (const [i, v] of out.per) if (seenBy(v)) named[nameOf(i)] = "tip";
    // The reach of the change: a rise of 10 mm or more the rule does not count (the estimate
    // is trusted for the rise, so it shows here too).
    if (out) for (const [i, v] of out.per) if (v.rise >= 10 && !named[nameOf(i)]) named[nameOf(i)] = "rise";
    // A scenario can also LOWER levels (a pump set slower than its default): show that too.
    if (out) for (const [i, v] of out.per) if (v.rise <= -10 && !named[nameOf(i)]) named[nameOf(i)] = "fall";
    const sensors = shownSensors();
    Growth3D.paint(named, null, sensors, heatValues());
    Growth3D.setSpills(spillBefore().map(nameOf),
      out && out.source === "swmm" ? [...out.per].filter(([, v]) => v.spillNew).map(([i]) => nameOf(i)) : []);
    // Each station whose rate the scenario changes, labelled on the map.
    Growth3D.setPumpRates(!st.pumpOn ? [] : pumpStations()
      .filter(p => st.pumpRates[p.rm] != null && st.pumpRates[p.rm] !== pumpDefault(p.rm))
      .map(p => ({ rm: p.rm, text: st.pumpRates[p.rm] + " L/s (was " + pumpDefault(p.rm) + ")" })));
    Growth3D.setScenario(st.scn.map(x => ({ name: nameOf(x.i), n: x.n })));
    renderHomes(sensors);
    renderManhole();
    renderBaseNote(c);
    renderScnList();
    renderScnResult(out);
    renderSensors();
    $("#heatKey").hidden = !st.showHeat;
    $("#heatWhich").textContent = (st.obj === "worst" ? "worst of the " : "average of the ") +
      nCases() + " cases, " + runs().rules[st.rule].label.toLowerCase();
    renderKnobs();
    renderLegend();
  }

  function renderScnList() {
    const total = st.scn.reduce((a, x) => a + x.n, 0);
    $("#scnList").innerHTML = st.scn.map((x, k) =>
      '<div class="srow"><span class="nm" title="' + esc(label(x.i)) + '">' + esc(label(x.i)) +
      '</span><input type="number" min="1" max="5000" step="1" value="' + x.n +
      '" data-k="' + k + '" aria-label="dwellings"> <span class="quiet">dw</span>' +
      '<button class="x" data-k="' + k + '" title="Remove">×</button></div>').join("") +
      (st.scn.length ? '<div class="tot">' + total + " dwellings at " + st.scn.length +
        " manhole" + (st.scn.length === 1 ? "" : "s") + "</div>" : "");
    renderPumps();
    const solved = !!st.scnRuns[scnKey()];
    const run = $("#scnRun");
    run.disabled = st.busy || (!st.scn.length && !st.pumpOn) || solved || st.runner !== true;
    run.textContent = st.busy ? "Solving…" : solved ? "Solved in SWMM" : "Run in SWMM";
    run.title = st.runner === true ? "Solve this scenario in EPA SWMM (about 25 s)"
      : "Needs the local SWMM runner: simulation_src/sim25_serve.py";
    $("#scnClear").disabled = (!st.scn.length && !st.pumpOn) || st.busy;
  }

  function renderPumps() {
    const list = pumpStations();
    $("#pumpBox").hidden = !list.length;
    if (!list.length) return;
    // Pump rates are solved only by the SWMM runner. Without one, nothing here can change the
    // answer, so the controls are disabled rather than left to look as if they did nothing.
    const can = st.runner === true;
    if (!can && st.pumpOn) st.pumpOn = false;
    $("#pumpOn").checked = st.pumpOn;
    $("#pumpOn").disabled = !can;
    const focused = document.activeElement && document.activeElement.dataset
      ? document.activeElement.dataset.rm : null;
    $("#pumpList").innerHTML = list.map(p => {
      const d = pumpDefault(p.rm), r = pumpRate(p.rm), changed = st.pumpRates[p.rm] != null && r !== d;
      return '<div class="prow' + (changed ? " changed" : "") + '"><span class="nm" title="' +
        esc("Rising main " + p.rm + ", " + p.dia.join("/") + " mm; default " + d + " L/s (" + p.rateFrom + ")") + '">' +
        (p.id ? "Station " + p.id : "Station") + " · " + p.homes + " homes</span>" +
        '<input type="number" min="0.1" max="200" step="0.1" value="' + r + '" data-rm="' + esc(p.rm) +
        '"' + (st.pumpOn ? "" : " disabled") + ' aria-label="pump rate"> <span class="quiet">L/s</span>' +
        '<button class="rs" data-rm="' + esc(p.rm) + '" title="Back to the default, ' + d + ' L/s"' +
        (changed ? "" : " hidden") + ">\u21ba</button></div>";
    }).join("");
    if (focused) { const el = $("#pumpList").querySelector('input[data-rm="' + focused + '"]'); if (el) el.focus(); }
    $("#pumpNote").textContent = !can ? "" : !st.pumpOn
      ? "Off: pumps pass whatever reaches them at once (ideal), as every published result does."
      : st.runner === true
      ? "On: each station fills its wet well, then pumps at its rate until it is low again. " +
        "Compared with the same network at the default rates; SWMM only. Defaults are " +
        "assumptions, not published pump data."
      : "";
    $("#pumpWarn").hidden = can;
  }

  function renderScnResult(out) {
    const R = runs();
    if (!out) {
      $("#siteFacts").innerHTML = '<p class="quiet">No manholes in the scenario yet. Click a ' +
        "manhole on the map and add it, or add one by number.</p>";
      $("#tipList").innerHTML = "";
      return;
    }
    if (out.source === "needs") {
      $("#siteFacts").innerHTML = '<p class="quiet"><span class="badge est">Not solved</span>' +
        "With pump stations at set rates the answer comes from SWMM only: the estimate " +
        "cannot model a wet well filling and a pump starting and stopping. " +
        (st.runner === true ? "Press Run in SWMM (about 30 s)."
          : "Run the site with simulation_src/sim25_serve.py to solve it.") + "</p>";
      $("#tipList").innerHTML = "";
      return;
    }
    const ok = trusted(out), swmm = out.source === "swmm";
    const seen = ok ? [...out.per].filter(([, v]) => seenBy(v)).sort((a, b) => b[1].rise - a[1].rise) : [];
    const newAlarm = [...out.per].filter(([, v]) => v.alarmNew).length;
    const newSur = [...out.per].filter(([, v]) => v.surNew).length;
    const newSpill = [...out.per].filter(([, v]) => v.spillNew).length;
    const chosen = chosenAt(placement(), st.k);
    const caught = chosen.filter(i => seen.some(([j]) => j === i));
    const source = out.source === "swmm"
      ? '<span class="badge swmm">SWMM</span>Solved in EPA SWMM for ' + esc(caseLabel()) +
        " in " + out.seconds + " s (continuity " + out.err + "%)." +
        (out.pumps && out.pumps.mode === "rated"
          ? " Pumps at set rates: every depth is the peak over the last " + out.pumps.window_min +
            " minutes of a " + out.pumps.minutes + "-minute run, against the same network with " +
            "each station at its default rate."
          : "")
      : '<span class="badge est">Estimate</span>' + EST_NOTE +
        (st.runner === true ? " Press Run in SWMM for the real answer."
          : " For the real answer, run the site with simulation_src/sim25_serve.py.");
    $("#siteFacts").innerHTML = '<p class="quiet">' + source + "</p>" +
      row2("Adding", st.scn.length ? "<b>" + st.scn.reduce((a, x) => a + x.n, 0) + "</b> dwellings, " +
        out.addedLps.toFixed(2) + " L/s" : "no new dwellings: pump rates only") +
      (out.pumps && out.pumps.mode === "rated"
        ? row2("Pumps", Object.entries(out.pumps.rates).map(([rm, r]) => {
            const d = out.pumps.defaults[rm], p = pumpStations().find(x => x.rm === rm);
            const nm = p && p.id ? "Station " + p.id : "Rising main " + rm;
            return nm + " " + (r === d ? r + " L/s" : "<b>" + r + " L/s</b> (default " + d + ")");
          }).join("<br>"))
        : "") +
      row2("Manholes that see it", !ok ? '<span class="quiet">SWMM only, under the alarm rule</span>'
        : seen.length ? '<b class="bad">' + seen.length + "</b>" : "none") +
      row2("Newly over the alarm", !swmm ? '<span class="quiet">SWMM only</span>'
        : newAlarm ? '<b class="bad">' + newAlarm + "</b>" : "none") +
      row2("Newly surcharged", !swmm ? '<span class="quiet">SWMM only</span>'
        : newSur ? '<b class="bad">' + newSur + "</b>" : "none") +
      row2("Newly overflowing", !swmm ? '<span class="quiet">SWMM only</span>'
        : newSpill ? '<b class="bad">' + newSpill + "</b> spill from the lid" : "none") +
      row2("The " + st.k + " chosen sensors", !ok ? '<span class="quiet">SWMM only, under the alarm rule</span>'
        : caught.length
        ? "<b>" + caught.length + "</b> see it (" + caught.map(i => "MH " + R.manholeIds[i]).join(", ") + ")"
        : "none of them see it");
    $("#tipList").innerHTML = "<h4>Manholes that see this scenario</h4>" + (!ok
      ? '<p class="quiet">The estimate is not reliable for the alarm rule. Choose a rise rule, ' +
        "or solve the scenario in SWMM.</p>"
      : seen.length
      ? "<ul>" + seen.slice(0, 40).map(([i, v]) => "<li>MH " + R.manholeIds[i] +
          ' <span class="quiet">+' + Math.round(v.rise) + " mm</span></li>").join("") + "</ul>" +
        (seen.length > 40 ? '<p class="quiet">and ' + (seen.length - 40) + " more</p>" : "")
      : '<p class="quiet">No manhole passes ' + esc(runs().rules[st.rule].label.toLowerCase()) +
        " in this case.</p>");
  }

  function scnStatus(msg) { $("#scnStatus").textContent = msg || ""; }
  function addToScn(i) {
    if (i == null) return scnStatus("Click a manhole on the map first, then add it.");
    if (st.scn.some(x => x.i === i)) return scnStatus("MH " + runs().manholeIds[i] + " is already in the scenario.");
    if (st.scn.length >= 60) return scnStatus("A scenario takes at most 60 manholes.");
    st.scn.push({ i, n: DEFAULT_DWELLINGS });
    scnStatus("");
    repaint();
  }
  async function runScn() {
    if ((!st.scn.length && !st.pumpOn) || st.busy) return;
    if (st.runner !== true) return scnStatus("No SWMM runner here. Locally, start " +
      "simulation_src/sim25_serve.py and reload; the public page shows the estimate only.");
    const key = scnKey(), R = runs(), t0 = Date.now();
    st.busy = true;
    renderScnList();
    const tick = setInterval(() => scnStatus("Solving in SWMM, " +
      Math.round((Date.now() - t0) / 1000) + " s (about 25 s)…"), 500);
    try {
      const res = await fetch("/api/sim25/scenario", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case: R.cases[st.ii].tag,
                               sites: st.scn.map(x => [R.manholeIds[x.i], x.n]),
                               pumps: st.pumpOn ? Object.fromEntries(
                                 pumpStations().map(p => [p.rm, pumpRate(p.rm)])) : null }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.status);
      st.scnRuns[key] = j;
      scnStatus("");
    } catch (e) {
      scnStatus("The SWMM run failed: " + e.message);
    } finally {
      clearInterval(tick);
      st.busy = false;
      repaint();
    }
  }
  function wireScenario(order) {
    $("#modeKnob").onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      st.mode = b.dataset.m;
      $("#oneBox").hidden = st.mode !== "one";
      $("#scnBox").hidden = st.mode !== "scn";
      repaint();
    };
    $("#scnAddSel").onclick = () => addToScn(st.site);
    // By manhole number, ascending, so a manhole can be found by its number. (Connected at
    // keeps busiest first.) Pipe ends with no manhole number, if any, go last by name.
    const R0 = runs();
    const byNumber = [...order].sort((a, b) =>
      (R0.manholeIds[a] || Infinity) - (R0.manholeIds[b] || Infinity) || nameOf(a).localeCompare(nameOf(b)));
    $("#scnAddPick").innerHTML = '<option value="">+ Add by number…</option>' +
      byNumber.map(i => "<option value=" + JSON.stringify(String(i)) + ">" + esc(label(i)) + "</option>").join("");
    $("#scnAddPick").onchange = () => {
      const v = $("#scnAddPick").value;
      $("#scnAddPick").value = "";
      if (v !== "") addToScn(+v);
    };
    $("#scnList").onchange = e => {
      const k = +e.target.dataset.k;
      if (e.target.tagName !== "INPUT" || !st.scn[k]) return;
      st.scn[k].n = Math.max(1, Math.min(5000, Math.round(+e.target.value) || 1));
      repaint();
    };
    $("#scnList").onclick = e => {
      const b = e.target.closest("button.x"); if (!b) return;
      st.scn.splice(+b.dataset.k, 1);
      repaint();
    };
    $("#scnRun").onclick = runScn;
    $("#scnClear").onclick = () => {
      st.scn = []; st.pumpOn = false; st.pumpRates = {}; scnStatus(""); repaint();
    };
    $("#pumpOn").onchange = () => { st.pumpOn = $("#pumpOn").checked; repaint(); };
    $("#pumpList").onchange = e => {
      const rm = e.target.dataset.rm;
      if (e.target.tagName !== "INPUT" || !rm) return;
      const v = Math.round(10 * Math.max(0.1, Math.min(200, +e.target.value || pumpDefault(rm)))) / 10;
      if (v === pumpDefault(rm)) delete st.pumpRates[rm]; else st.pumpRates[rm] = v;
      repaint();
    };
    $("#pumpList").onclick = e => {
      const b = e.target.closest("button.rs"); if (!b) return;
      delete st.pumpRates[b.dataset.rm];
      repaint();
    };
    // "Set its rate" on a pump station's card: into the scenario, pumps on, its box in focus.
    document.addEventListener("osp:pumprate", e => {
      if (st.mode !== "scn") $("#modeKnob").querySelector('button[data-m="scn"]').click();
      st.pumpOn = true;
      repaint();
      const el = $("#pumpList").querySelector('input[data-rm="' + e.detail + '"]');
      if (el) { el.focus(); el.select(); }
    });
    // Is a local SWMM runner serving this page? On the public site there is none, and the
    // request fails, which is the answer.
    fetch("/api/sim25/ping", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        st.runner = !!(j && j.ok && runs().cases.every(c => j.cases.includes(c.tag)));
        if (st.runner && j.pumpDefaults) st.pumpDefaults = j.pumpDefaults;
      })
      .catch(() => { st.runner = false; })
      .finally(() => { if (st.mode === "scn") renderScnList(); });
  }

  /* The map's view toggles: the datum with its height ruler (one button), and raised homes.
     Off and on by default; each viewer's choice is remembered in this browser only (a
     convenience, not state). */
  function wireViewToggles() {
    const KEY = "sim25.view2";
    let v = { datum: false, raised: true };
    try { Object.assign(v, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { /* none kept */ }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* not kept */ } };
    const apply = () => {
      Growth3D.showRuler(v.datum);
      Growth3D.showDatum(v.datum);
      Growth3D.setHomesRaised(v.raised);
      $("#tglDatum").setAttribute("aria-pressed", String(v.datum));
      $("#tglRaised").setAttribute("aria-pressed", String(v.raised));
    };
    const flip = k => () => { v[k] = !v[k]; save(); apply(); repaint(); };
    $("#tglDatum").onclick = flip("datum");
    $("#tglRaised").onclick = flip("raised");
    apply();
  }

  /* The legend shows only what is on the map now: each item carries data-ctx, and the full
     key opens from the toggle (remembered in this browser only). */
  function renderLegend() {
    const R = runs(), scn = st.mode === "scn";
    const out = scn ? scnOutcome() : null;
    const growth = scn ? !!out : (st.site != null && !noGrowth());
    const newSpill = scn ? !!(out && out.source === "swmm" && [...out.per].some(([, v]) => v.spillNew))
      : spillNew(st.site).length > 0;
    const on = {
      alarm: !graded() && R.baseOver[st.ii].length > 0,
      growth,
      falls: scn && !!out,
      spillWas: spillBefore().length > 0,
      spillNew: newSpill,
      sensors: st.showSensors,
      site: !scn && st.site != null,
    };
    document.querySelectorAll("#legend [data-ctx]").forEach(el => { el.hidden = !on[el.dataset.ctx]; });
    $("#pumpKey").hidden = !(st.showPumps && geom().pumps && geom().pumps.length);
  }
  function wireLegend() {
    const KEY = "sim25.legend";
    let open = false;
    try { open = localStorage.getItem(KEY) === "open"; } catch (e) { /* not kept */ }
    const apply = () => {
      $("#lgFull").hidden = !open;
      $("#lgToggle").setAttribute("aria-expanded", String(open));
      $("#lgToggle").innerHTML = open ? "Less &#9662;" : "Full legend &#9656;";
    };
    $("#lgToggle").onclick = () => {
      open = !open;
      try { localStorage.setItem(KEY, open ? "open" : "closed"); } catch (e) { /* not kept */ }
      apply();
    };
    apply();
  }

  function renderBaseNote(c) {
    const R = runs(), sp = spillBefore().length;
    const spillNote = sp ? " <b>" + sp + "</b> manhole" + (sp === 1 ? " already spills" : "s already spill") +
      " from the lid before any growth in this case." : "";
    $("#baseNote").innerHTML = (graded()
      ? "Graded rule: every manhole is judged against its own level before the growth, so " +
        "nothing counts as already triggered."
      : (c.base.length
        ? "<b>" + c.base.length + "</b> of " + R.chambers.length + " manholes are already " +
          "over the alarm in this case <b>before any houses are added</b>. They are amber and " +
          "cannot report the growth."
        : "No manhole is over the alarm before growth in this case.")) + spillNote;
  }

  function renderPanel(c, row) {
    const R = runs();
    const add = R.growthLevels[st.add];
    const tipped = row ? row.tip : [];
    const cs = R.cases[st.ii];

    renderManhole();
    renderBaseNote(c);
    if (st.site == null) {
      $("#siteFacts").innerHTML = '<p class="quiet">No manhole selected, so no growth is ' +
        "placed. Click a manhole on the map, or choose one above.</p>";
      $("#tipList").innerHTML = "";
      return;
    }
    if (noGrowth()) {
      // No growth placed: the manhole as it is. Its details are in the right-hand panel.
      $("#siteFacts").innerHTML = reachRow() +
        row2("Adding", "none: the network as it is in " + esc(cs.label)) +
        row2("Solved on", cs.method === "nested" ? "study catchment, levels handed down"
                                                : "whole council network");
      $("#tipList").innerHTML = '<p class="quiet">No growth is placed, so nothing is coloured ' +
        "as seeing it. Amber manholes are over the alarm before any growth" +
        (spillBefore().length ? "; violet rings spill from the lid already" : "") +
        ". Choose a growth size above to place new dwellings at the selected manhole.</p>";
      return;
    }
    $("#siteFacts").innerHTML =
      reachRow() +
      row2("Adding", "<b>+" + add + "</b> dwellings, " + (add * runs().lpsPerDwelling[st.ii]).toFixed(2) + " L/s") +
      row2("Manholes that see it", tipped.length
        ? '<b class="bad">' + tipped.length + "</b>"
        : "none at this size") +
      (hasSpill() ? row2("Newly overflowing", spillNew(st.site).length
        ? '<b class="bad">' + spillNew(st.site).length + "</b> spill from the lid"
        : "none") : "") +
      row2("Solved on", cs.method === "nested" ? "study catchment, levels handed down"
                                              : "whole council network");

    $("#tipList").innerHTML = "<h4>Manholes that see this growth</h4>" + (tipped.length
      ? "<ul>" + tipped.map(i => "<li>" + esc(label(i)) + "</li>").join("") + "</ul>"
      : "<p class=quiet>No manhole passes the rule at +" + add + " dwellings in this case. " +
        "Try more growth, a wetter case, or a smaller rise.</p>") +
      (spillNew(st.site).length
        ? "<h4>Overflowing because of it</h4><ul>" + spillNew(st.site).map(i =>
            "<li>" + esc(label(i)) + (ruleId() === "alarm" && runs().baseOver[st.ii].includes(i)
              ? ' <span class="quiet">already over the alarm before growth, so the alarm rule cannot count it</span>'
              : "") + "</li>").join("") + "</ul>"
        : "");

  }

  /* Homes whose sewage reaches this manhole first. The model loads a home at the top of
     its pipe, and about half the pipes start at a pipe end with no manhole on record, so
     counting only the homes loaded AT the manhole left those out. */
  function reachRow() {
    const r = Growth3D.reach(nameOf(st.site));
    if (!r) return row2("Homes reaching it first", (runs().dwellingsAt[st.site] || 0) + "");
    const via = r.here - r.direct;
    return row2("Homes reaching it first", "<b>" + r.here + "</b>") + (via
      ? '<div class="fact sub2"><span>' + via + " via unrecorded pipe ends</span><span></span></div>"
      : "");
  }

  const row2 = (k, v) => '<div class="fact"><span>' + esc(k) + "</span><span>" + v +
    "</span></div>";

  /* ------------------------------------------------------------- sensors */
  const OBJ_NOTE = {
    worst: "Each sensor added is the one that most raises the worst of the {n} cases: " +
           "whatever the unknowns turn out to be, at least this much is caught.",
    mean: "Each sensor added is the one that most raises the average over the {n} cases. " +
          "Catches more on average, but can leave one case poorly covered.",
  };
  const pct = x => Math.round(x * 100) + "%";

  function renderSensors() {
    const pl = placement(), k = st.k;
    $("#kRange").value = String(k);
    $("#kVal").textContent = String(k);
    document.querySelectorAll("#objKnob button").forEach(b =>
      b.classList.toggle("on", b.dataset.o === st.obj));
    const m = window.Placement ? Placement.METHODS.find(x => x[0] === st.algo) : null;
    $("#algoNote").textContent = m ? m[2] + (st.algo === "swmm" ? "" :
      " Scored, like every method here, on the SWMM growth runs.") : "";
    $("#objNote").textContent = st.algo === "swmm" || st.algo === "random"
      ? OBJ_NOTE[st.obj].replace("{n}", nCases())
      : "This method does not use the objective; the curve shows both measures, worst case and average.";
    $("#nCases").textContent = nCases();
    renderCurve(pl, k);
    // Which case is the worst at this many sensors, from the same scoring the curve uses.
    let worstNote = "";
    if (window.Placement) {
      const R = runs(), rule = ruleId();
      // scenarios() drops a case nothing sees, as the builder does; keep the labels in step.
      const kept = R.cases.filter((_, j) => R.cells.some(x => x.case === j && x.rule === rule &&
        x.rows.some(r => r.tip.length)));
      const f = Placement.cover(Placement.scenarios(R, rule), chosenAt(pl, k));
      const w = f.indexOf(Math.min(...f));
      if (w >= 0) worstNote = "<p class=quiet>The worst case at " + k + " sensor" + (k === 1 ? "" : "s") +
        " is <b>" + esc(kept[w].label) + "</b> (" + pct(f[w]) + ")." +
        (f[w] === 0 ? " None of these sensors sees any growth that this case's alarm or rise " +
          "reveals, so the worst case stays at 0% until one does." : "") + "</p>";
    }
    $("#sensorList").innerHTML =
      "<p><b>" + k + "</b> sensor" + (k === 1 ? "" : "s") + " catch <b>" + pct(pl.worst[k - 1]) +
      "</b> of detectable growth in the worst case and <b>" + pct(pl.mean[k - 1]) +
      "</b> on average (all " + runs().growthLevels.length + " growth sizes, " + esc(runs().rules[st.rule].label.toLowerCase()) +
      ").</p><ol>" + chosenAt(pl, k).map((m, j) =>
        "<li><b>" + esc(label(m)) + "</b>" + (pl.nested === false ? "" :
          " <span class=quiet>worst " + pct(pl.worst[j]) + ", average " + pct(pl.mean[j]) +
          "</span>") + "</li>").join("") + "</ol>" + worstNote +
      "<p class=quiet>" + (pl.nested === false
        ? "Chosen afresh for each number of sensors, so the set for " + (k + 1) +
          " need not contain this one."
        : "Chosen one at a time, so the set for " + (k + 1) + " is this set plus one.") +
      " Detectable growth: growth scenarios that at least one manhole sees.</p>" +
      "<p class=quiet>This scores whether a sensor would notice a development, not whether " +
      "it watches a choke point. Trunk manholes already over the alarm before any growth " +
      "carry the most load yet rise only a few millimetres per development, so they score " +
      "low here; watching the bottlenecks is a different objective, not yet modelled.</p>";
  }

  /* Worst case and average against the number of sensors. One axis (percent), two series,
     legend plus direct labels at the right end, the current count marked, hover per count. */
  function renderCurve(pl, k) {
    const W = 290, H = 132, L = 30, Rr = 50, T = 8, B = 22, n = pl.worst.length;
    const x = i => L + (W - L - Rr) * i / (n - 1), y = v => T + (H - T - B) * (1 - v);
    const line = arr => arr.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
    const grid = [0, 0.5, 1].map(v => '<line x1="' + L + '" x2="' + (W - Rr) + '" y1="' + y(v) +
      '" y2="' + y(v) + '" stroke="#22314d" stroke-width="1"/><text x="' + (L - 5) + '" y="' +
      (y(v) + 3.5) + '" text-anchor="end" font-size="10" fill="#6f81a3">' + (v * 100) + "%</text>").join("");
    const ticks = pl.worst.map((_, i) => '<text x="' + x(i) + '" y="' + (H - 6) +
      '" text-anchor="middle" font-size="10" fill="' + (i === k - 1 ? "#e7edf7" : "#6f81a3") + '">' +
      (i + 1) + "</text>").join("");
    const dots = (arr, col) => arr.map((v, i) => '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="' +
      (i === k - 1 ? 5 : 3) + '" fill="' + col + '" stroke="#16233a" stroke-width="2"/>').join("");
    const hits = pl.worst.map((_, i) => '<rect class="hit" data-i="' + i + '" x="' + (x(i) - 12) +
      '" y="' + T + '" width="24" height="' + (H - T - B + 16) + '" fill="transparent"/>').join("");
    // Worst and average meet at the top, so their end labels are pushed apart if they collide.
    let ew = y(pl.worst[n - 1]), em = y(pl.mean[n - 1]);
    if (Math.abs(ew - em) < 11) { if (ew >= em) ew = em + 11; else em = ew + 11; }
    $("#curve").innerHTML =
      '<div class="lg"><span><i style="background:var(--worst)"></i>Worst case</span>' +
      '<span><i style="background:var(--mean)"></i>Average</span></div>' +
      '<svg viewBox="0 0 ' + W + " " + (H + 10) + '" role="img" aria-label="Share of detectable growth ' +
      'caught against number of sensors">' + grid +
      '<line x1="' + x(k - 1) + '" x2="' + x(k - 1) + '" y1="' + T + '" y2="' + (H - B) +
      '" stroke="#a9b8d4" stroke-width="1" stroke-dasharray="3 3"/>' +
      '<path d="' + line(pl.mean) + '" fill="none" stroke="var(--mean)" stroke-width="2"/>' +
      '<path d="' + line(pl.worst) + '" fill="none" stroke="var(--worst)" stroke-width="2"/>' +
      dots(pl.mean, "var(--mean)") + dots(pl.worst, "var(--worst)") +
      '<text x="' + (x(n - 1) + 8) + '" y="' + (ew + 3.5) + '" font-size="10.5" fill="#a9b8d4">worst</text>' +
      '<text x="' + (x(n - 1) + 8) + '" y="' + (em + 3.5) + '" font-size="10.5" fill="#a9b8d4">average</text>' +
      ticks + '<text x="' + ((L + W - Rr) / 2) + '" y="' + (H + 7) + '" text-anchor="middle" ' +
      'font-size="10" fill="#6f81a3">sensors</text>' + hits + "</svg>" +
      '<div id="curveTip" hidden></div>';
    const tip = $("#curveTip"), svg = $("#curve svg");
    svg.querySelectorAll(".hit").forEach(r => {
      const i = +r.dataset.i;
      r.style.cursor = "pointer";
      r.onmouseenter = () => {
        const bx = svg.getBoundingClientRect(), cx = $("#curve").getBoundingClientRect();
        tip.innerHTML = "<b>" + (i + 1) + " sensor" + (i ? "s" : "") + "</b>: worst " +
          pct(pl.worst[i]) + ", average " + pct(pl.mean[i]);
        tip.style.left = (bx.left - cx.left + x(i) * bx.width / W) + "px";
        tip.style.top = (bx.top - cx.top + y(pl.worst[i]) * bx.height / (H + 10)) + "px";
        tip.hidden = false;
      };
      r.onmouseleave = () => { tip.hidden = true; };
      r.onclick = () => { st.k = i + 1; repaint(); };
    });
  }

  /* ---------------------------------------------------- assumptions tab */
  /* The whole register, not the nine rows the popup curates. The legacy page carried it
     and it was asked for back: a reader who wants to argue with the model needs every row,
     not a selection made on their behalf. */
  function renderRef() {
    if ($("#ref").dataset.done) return;
    const g = geom(), n = GROWTH_INDEX.scenario.numbers;
    $("#ref").innerHTML =
      '<div class="lead"><p><strong>What this model is, in one paragraph.</strong> ' +
      (runs().studyArea === "whole"
        ? "Every council pipe draining to the end of the council data, " + g.nPipes + " pipes and " +
          g.nChambers + " manholes, is solved together in EPA SWMM as a steady state, and every " +
          "one of those manholes is a growth site and a sensor candidate. "
        : "The study catchment is the " + g.nPipes + " pipes and " + g.nChambers + " manholes " +
          "draining to one chamber, drawn here. Around it, every council pipe draining to the " +
          "end of the council data is solved together in EPA SWMM as a steady state, so the " +
          "trunk below can back water up into the catchment. ") +
      "Pipes from outside the council " +
      "area are not modelled; where they join, a constant inflow sized from their published " +
      "length stands in for them. Two pump stations pass their flow on as ideal pumps (a " +
      "growth scenario may run them at a set rate instead). " +
      "Sewage comes from connected properties counted from the published record; " +
      "infiltration is in proportion to pipe length.</p>" +
      "<p><strong>The register below</strong> is every assumption and constant the model " +
      "rests on, with its value, how firm it is and its source. " + nCases() + " cases vary " +
      "the ones no data pins yet. Sources cited as docs/ or papers/ are in the project's " +
      "working repository, not this one.</p></div>" +
      markdown(GROWTH_INDEX.docs.assumptions);
    $("#ref").dataset.done = "1";
  }

  /* Enough markdown for the register: headings, tables, code, bold, rules, lists. */
  function markdown(md_) {
    const out = []; let inTable = false;
    const inline = t => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>")
                              .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const closeT = () => { if (inTable) { out.push("</tbody></table>"); inTable = false; } };
    for (const raw of String(md_ || "").split("\n")) {
      const line = raw.replace(/\s+$/, "");
      if (/^\|/.test(line)) {
        if (/^[:\-\s|]+$/.test(line)) continue;
        const cells = line.split("|").slice(1, -1).map(c => c.trim());
        if (!inTable) {
          out.push("<table><thead><tr>" +
            cells.map(c => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>");
          inTable = true;
        } else {
          out.push("<tr>" + cells.map(c => "<td>" + inline(c) + "</td>").join("") + "</tr>");
        }
        continue;
      }
      closeT();
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">");
      else if (/^[-*]\s+/.test(line)) out.push("<li>" + inline(line.replace(/^[-*]\s+/, "")) + "</li>");
      else if (/^---+$/.test(line)) out.push("<hr>");
      else if (line) out.push("<p>" + inline(line) + "</p>");
    }
    closeT();
    return out.join("\n");
  }

  function setTab(tab) {
    const ref = tab === "ref", qa = tab === "qa";
    $("#pane-ref").hidden = !ref;
    $("#pane-qa").hidden = !qa;
    $("#tab-ref").classList.toggle("primary", ref);
    $("#tab-ref").textContent = ref ? "Back to the map" : "Assumptions";
    $("#tab-qa").classList.toggle("primary", qa);
    $("#tab-qa").textContent = qa ? "Back to the map" : "Findings";
    if (ref) renderRef();
    else if (qa) renderQA();
    else Growth3D.resize($("#stage"));
  }

  /* --------------------------------------------------------------- findings tab */
  /* The results write-up, from the built payload (docs/17), rendered as markdown. */
  function renderQA() {
    if ($("#qa").dataset.done) return;
    $("#qa").innerHTML = markdown(GROWTH_INDEX.docs.findings);
    $("#qa").dataset.done = "1";
  }

  /* --------------------------------------------------------------- popup */
  function showModal() {
    const sc = GROWTH_INDEX.scenario, n = sc.numbers;
    const fact = (l, v) => v == null ? "" :
      '<div class="kfact">' + esc(l) + "<b>" + esc(v) + "</b></div>";
    $("#modalBox").innerHTML =
      '<button class="close" id="modalClose">Close</button>' +
      "<h2>" + esc(sc.title) + "</h2>" +
      '<p class="q">' + esc(sc.question) + "</p>" +
      sc.what.map(p => "<p>" + esc(p) + "</p>").join("") +
      "<h3>What to look at</h3><ul>" + sc.read.map(r => "<li>" + esc(r) + "</li>").join("") +
      "</ul>" +
      "<h3>The numbers behind it</h3><div class=kfacts>" +
      fact("Pipes modelled", n.pipes) +
      fact("Chambers", n.chambers) +
      fact("Properties counted", n.dwellings) +
      fact("Peak factor", n.peakFactor) +
      fact("Wet weather settings", n.iiRange ? n.iiRange + " L/s per 100 m" : null) +
      fact("Growth settings", n.stepRange ? n.stepRange + " dwellings" : null) +
      "</div>" +
      (sc.qa.length ? "<h3>Questions asked about this model</h3>" : "") +
      sc.qa.map(q =>
        '<details class="qa"><summary>' + esc(q.short) + "</summary>" +
        '<div class="body"><p><strong>' + esc(q.q) + "</strong></p>" +
        q.a.map(x => "<p>" + esc(x) + "</p>").join("") +
        '<div class="ev">' + esc(q.evidence) + "</div></div></details>").join("") +
      (sc.assumptions.length ? "<h3>What it assumes</h3><p>Lifted from the project's " +
        "assumptions register.</p>" : "<h3>What it assumes</h3><p>Every assumption is in " +
        "the Assumptions tab.</p>") +
      "<table class=ass><tbody>" + sc.assumptions.map(a =>
        '<tr><td class="id">' + esc(a.id) + "</td><td>" + md(a.text) +
        '<br><span class="tag ' + (a.status === "A" ? "assumed" : "") + '">' +
        esc(a.statusWord) + "</span></td></tr>").join("") + "</tbody></table>" +
      '<div class="caveat">' + esc(sc.caveat) + "</div>";
    $("#modal").hidden = false;
    $("#modalClose").onclick = () => { $("#modal").hidden = true; };
  }
  const md = t => esc(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
                        .replace(/`([^`]+)`/g, "<code>$1</code>");

  /* ---------------------------------------------------------------- init */
  function init() {
    geom().nodes.forEach(n => { byName[n.name] = n; });
    const idxOfName = {};
    runs().chambers.forEach((c, i) => { idxOfName[c] = i; });
    Growth3D.build($("#stage"), nd => {
      // A click on the map gives a chamber NAME; everything else here works in indices.
      st.hover = null;
      if (!nd) { if (st.site != null) select(null); return; }   // empty ground: deselect
      if (nd.name in idxOfName) select(idxOfName[nd.name]);
    }, nd => {
      // Hovering the manhole that is already selected previews nothing new.
      const name = nd && nd.name !== nameOf(st.site) ? nd.name : null;
      if (name === st.hover) return;
      st.hover = name;
      renderHomes(shownSensors());
    }).then(() => {
      // How many sensors may be placed is config.js's max_sensors, as the build published it.
      $("#kRange").max = String(runs().maxSensors);
      st.k = Math.min(st.k, runs().maxSensors);
      wireViewToggles();
      wireLegend();
      buildKnobs();
      const order = buildList();
      wireScenario(order);
      if (window.Placement && window.OSPCore) {
        $("#algo").innerHTML = Placement.METHODS.map(([id, lab]) =>
          "<option value=" + JSON.stringify(id) + ">" + esc(lab) + "</option>").join("");
        $("#algo").value = st.algo;
        $("#algo").onchange = () => { st.algo = $("#algo").value; repaint(); };
      } else {
        $("#algo").hidden = true;           // the page still works on its published greedy
      }
      $("#scale").textContent = geom().nPipes + " pipes, " + geom().nChambers +
        " manholes, " + (geom().nHouses || geom().baseDwellings) + " connected properties" +
        ", plus " + geom().nodes.filter(n => n.kind !== "chamber").length +
        " pipe ends with no manhole on record. Elevation is the pipe invert, exaggerated x" +
        Growth3D.ZEXAG + ". Click a manhole to move the growth there. Drag to turn the map, " +
        "right-drag to move it, scroll to zoom where the pointer is.";
      // Open on the busiest manhole whose growth something sees under the default knobs,
      // rather than one that reads "none at this size" before anyone has touched anything.
      const seen = new Set(cell().rows.filter(r => r.tip.length).map(r => r.site));
      select(order.find(i => seen.has(i)) ?? order[0]);
    });
    $("#btn-info").onclick = showModal;
    $("#tab-ref").onclick = () => setTab($("#pane-ref").hidden ? "ref" : "map");
    $("#refClose").onclick = () => setTab("map");
    $("#tab-qa").onclick = () => setTab($("#pane-qa").hidden ? "qa" : "map");
    $("#qaClose").onclick = () => setTab("map");
    $("#modal").onclick = e => { if (e.target.id === "modal") $("#modal").hidden = true; };
    $("#fitAll").onclick = () => Growth3D.frame(null);
    // Off by default: the page is about the 71 study manholes, and the whole network makes
    // them a fifth of the view. On demand it shows what "whole council network" means.
    // A whole-area build already draws the whole network as the study area, so the button
    // would add nothing but inflow markers; it is hidden rather than left to mislead.
    if (runs().studyArea === "whole") $("#toggleRegion").hidden = true;
    $("#toggleRegion").onclick = () => {
      st.showRegion = !st.showRegion;
      if (!Growth3D.showRegion(st.showRegion)) { st.showRegion = false; return; }
      $("#toggleRegion").classList.toggle("primary", st.showRegion);
      $("#toggleRegion").textContent = st.showRegion ? "Study area only" : "Whole Walkerville";
      $("#regionKey").hidden = !st.showRegion;
    };
    $("#fitSite").onclick = () => Growth3D.frame(nameOf(st.site));
    $("#toggleSensors").onclick = () => {
      st.showSensors = !st.showSensors;
      $("#toggleSensors").classList.toggle("primary", st.showSensors);
      $("#toggleSensors").textContent = st.showSensors ? "Hide sensors" : "Show sensors";
      repaint();
    };
    // Pump stations: only offered where the map has any, which a whole-area build does.
    const hasPumps = !!(geom() && geom().pumps && geom().pumps.length);
    $("#togglePumps").hidden = !hasPumps;
    $("#togglePumps").onclick = () => {
      st.showPumps = !st.showPumps;
      if (!Growth3D.showPumps(st.showPumps)) { st.showPumps = false; return; }
      $("#togglePumps").classList.toggle("primary", st.showPumps);
      // The label stays put, as on the other chips: a longer "Hide ..." wrapped the bar.
      renderLegend();
    };
    // Connections: every property's published connection pipe. Offered only if the build
    // published them; the key carries the counts the 3D view actually drew.
    // Wired before the 3D view has built, so offered from the data, not from the view.
    $("#toggleConn").hidden = !(geom() && geom().cptr && geom().cptr.length > 1);
    $("#toggleConn").onclick = () => {
      st.showConn = !st.showConn;
      const c = Growth3D.showConnections(st.showConn);
      if (!c) { st.showConn = false; return; }
      $("#connMis").textContent = c.mis;
      $("#connSpare").textContent = c.spare;
      $("#connGuess").textContent = c.guess;
      $("#connKey").hidden = !st.showConn;
      // The label stays put: a longer "Hide ..." wrapped the map bar onto a second row.
      $("#toggleConn").classList.toggle("primary", st.showConn);
    };
    $("#toggleHeat").onclick = () => {
      st.showHeat = !st.showHeat;
      $("#toggleHeat").classList.toggle("primary", st.showHeat);
      $("#toggleHeat").textContent = st.showHeat ? "Hide heatmap" : "Heatmap";
      repaint();
    };
    // Moving the slider or the objective shows the sensors: that is what it is asking to see.
    const showThem = () => {
      if (st.showSensors) return;
      st.showSensors = true;
      $("#toggleSensors").classList.add("primary");
      $("#toggleSensors").textContent = "Hide sensors";
    };
    $("#kRange").oninput = () => { st.k = +$("#kRange").value; showThem(); repaint(); };
    $("#objKnob").onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      st.obj = b.dataset.o; showThem(); repaint();
    };
    document.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      if (!$("#modal").hidden) $("#modal").hidden = true;
      else if (!$("#pane-ref").hidden || !$("#pane-qa").hidden) setTab("map");
    });
    window.addEventListener("resize", () => Growth3D.resize($("#stage")));
  }

  return { init };
})();
