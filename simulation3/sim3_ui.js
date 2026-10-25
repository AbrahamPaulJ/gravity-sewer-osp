/* sim3_ui.js - the Sim 3 page: the use case first, the uncertainty band underneath.

   Two growth families, as the network operator asked for them to be separated:
     infill      new homes spread through one of eight areas (regions) in proportion to the
                 homes already there, from 10% to 300% of that area's share of the 2021 to
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
window.Sim3UI = (function () {
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&lt;" }[c] || c));
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
  const FAM_NOTE = {
    infill: "New homes spread through one area in proportion to the homes already there. The area's 100% is its share of the planning projection for the whole council area (" + S().anchor + " dwellings by 2041).",
    one: "A new estate joining the sewer at one manhole, all its flow entering there. Click a manhole to move it.",
    none: "No growth placed. The map shows the network as it is in the selected weather: manholes already over the alarm are amber. The sensors are still the ones chosen for growth.",
  };

  const st = {
    view: "simple", fam: "infill",
    region: 0, step: 4,                 // infill: region index, ladder index (100%)
    site: null, add: 3,                 // greenfield: chamber index, growth size index
    caseTag: null,                      // the uncertainty case, by tag (shared by the families)
    rule: "r10", k: 5, method: "exact", obj: "worst",
    showSensors: true, showHeat: false, showPumps: false, showConn: false,
    hover: null, pick: null,            // hovered / clicked manhole NAME for the right panel
    lg: { results: true, network: false, regions: true },
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
  function infillPlacement() {
    const rr = S().rules[st.rule];
    if (!rr) return { chosen: [], worst: null, average: null, curve: [] };
    if (st.method === "risk" && rr.risk && rr.risk.exact && rr.risk.exact.length) {
      const e = rr.risk.exact.find(x => x.k === st.k) || rr.risk.exact[Math.min(st.k, rr.risk.exact.length) - 1];
      const c = (rr.risk.compare || []).find(x => x.k === e.k);
      return { chosen: e.chosen.slice(), worst: c ? c.risk_set.plain : null, average: null, riskWorst: e.worst, compare: c };
    }
    if (st.method === "exact" && rr.exact && rr.exact.length) {
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
    Growth3D.paint(named, site, sensors, heatValues());
    Growth3D.setSpills(spillsBefore, spillsNew);
    Growth3D.setPumpRates([]);
    renderHomes(sensors);
    renderKnobs();
    renderPanel();
    renderSide();
    renderSensors();
    renderWords();
    $("#heatKey").hidden = !st.showHeat;
    $("#heatWhich").textContent = (st.obj === "worst" ? "worst of the " : "average of the ") + famCases().length +
      " cases, " + ruleOf(st.rule).label.toLowerCase() + (st.fam === "infill" ? ", infill scenarios" : ", greenfield scenarios");
  }

  /* ------------------------------------------------------------------ homes */
  // The homes key, fixed shape (see Sim 2.5): hover previews a manhole's homes; otherwise the
  // selected area's homes (infill), the sensors' catchment, or the growth manhole's homes.
  function renderHomes(sensors) {
    const mhName = nm => { const n = G().nodes.find(x => x.name === nm); return n && n.mh ? "MH " + n.mh : nm; };
    const row = (col, text, ring) => '<div class="row">' + (col ? '<span class="k' + (ring ? " ring" : "") + '" style="background:' + col + '"></span>' : "") + text + "</div>";
    const put = (head, r1, r2, r3, hint) => {
      $("#homeKey").innerHTML = '<div class="row head">' + head + "</div>" + r1 + r2 + r3 + '<div class="row quiet2">' + hint + "</div>";
    };
    let spec, lead;
    if (st.hover) { spec = { mode: "site", name: st.hover }; lead = "Homes behind " + esc(mhName(st.hover)); }
    else if (st.fam === "infill") spec = { mode: "region", names: region().manholes.map(nameOf) };
    else if (st.showSensors && sensors.length && st.fam !== "one") spec = { mode: "sensors", names: sensors };
    else if (st.fam === "one" && st.site != null) { spec = { mode: "site", name: nameOf(st.site) }; lead = "Homes behind " + esc(label(st.site)); }
    else spec = st.showSensors && sensors.length ? { mode: "sensors", names: sensors } : { mode: "none" };
    const r = Growth3D.highlight(spec);
    if (!r) { put("", "", "", "", ""); return; }
    if (r.mode === "region") {
      const reg = region();
      put(esc(reg.id + ": " + shortName(reg)),
        row("#7dc4e0", "<strong>" + r.homes + "</strong> homes in the area, <strong>" + reg.nManholes + "</strong> manholes"),
        row("#00d4ff", "<strong>" + r.pipes + "</strong> pipes carry the new homes' flow"),
        row("#3a2430", "<strong>" + r.elsewhere + "</strong> homes elsewhere"),
        "Click a manhole to inspect it; the area follows your click");
      return;
    }
    if (r.mode === "none") {
      put("No growth placed", row("#ff6f9c", "<strong>" + r.total + "</strong> connected homes"), row("", "&nbsp;"), row("", "&nbsp;"),
        "Pick a kind of growth on the left");
      return;
    }
    if (r.mode === "sensors") {
      put("Homes and the " + sensors.length + " sensor" + (sensors.length === 1 ? "" : "s"),
        row("#3fb950", "<strong>" + r.watched + "</strong> of " + r.total + " drain past a sensor (" + Math.round(100 * r.watched / r.total) + "%)"),
        row("", "<strong>" + r.unwatched + "</strong> do not"), row("", "&nbsp;"), "Green sleeves: pipes feeding a sensor");
      return;
    }
    put(lead,
      row("#1f4fff", "<strong>" + r.here + "</strong> reach it first" + (r.here > r.direct ? " (" + (r.here - r.direct) + " via unrecorded pipe ends)" : ""), true),
      row("#7dc4e0", "<strong>" + r.through + "</strong> drain through it from further up"),
      row("#3a2430", "<strong>" + r.elsewhere + "</strong> elsewhere"),
      st.hover ? (st.fam === "one" ? "Previewing. Click to move the growth here." : "Previewing. Click to inspect it.") : "Hover any manhole to preview its homes");
  }
  const shortName = reg => reg.name.split(":")[0];

  /* ------------------------------------------------------------------ knobs */
  function buildCaseKnobs() {
    const cs = famCases();
    $("#iiKnob").innerHTML = cs.map((c, i) => "<button data-i=" + JSON.stringify(String(i)) + " title=" + JSON.stringify(c.note || "") + ">" +
      esc(c.label) + '<span class="knobNum">' + c.ii.toFixed(2) + " L/s/100m" + (c.settled === false ? ", 480 min" : "") + "</span></button>").join("");
    $("#caseSel").innerHTML = cs.map((c, i) => "<option value=" + JSON.stringify(String(i)) + ">" + esc(c.label) + "</option>").join("");
    $("#nCases").textContent = cs.length;
  }
  function buildKnobs() {
    const Rr = R();
    $("#ruleKnob").innerHTML = RULES.map(r => "<button data-r=" + JSON.stringify(r.id) + " title=" + JSON.stringify(r.note) + ">" + esc(r.label) + "</button>").join("");
    $("#addKnob").innerHTML = Rr.growthLevels.map((g, i) => "<button data-i=" + JSON.stringify(String(i)) + ">+" + g + "</button>").join("");
    $("#region").innerHTML = S().regions.map((r, i) => "<option value=" + JSON.stringify(String(i)) + ">" + esc(r.id + ": " + shortName(r)) + " (" + r.dwellings + " homes)</option>").join("");
    $("#stepRange").max = String(ladder().length - 1);
    buildCaseKnobs();
    const on = (sel, fn) => { $(sel).onclick = e => { const b = e.target.closest("button"); if (!b) return; fn(b); }; };
    on("#viewKnob", b => setView(b.dataset.v));
    on("#famKnob", b => setFamily(b.dataset.f));
    on("#iiKnob", b => { st.caseTag = famCases()[+b.dataset.i].tag; repaint(); });
    $("#caseSel").onchange = () => { st.caseTag = famCases()[+$("#caseSel").value].tag; repaint(); };
    on("#ruleKnob", b => { st.rule = b.dataset.r; repaint(); });
    on("#typeKnob", b => { st.rule = b.dataset.r; repaint(); });
    on("#addKnob", b => { st.add = +b.dataset.i; repaint(); });
    on("#methKnob", b => { st.method = b.dataset.m; st.pickedGreedy = b.dataset.m === "greedy"; repaint(); });
    on("#objKnob", b => { st.obj = b.dataset.o; repaint(); });
    $("#region").onchange = () => { st.region = +$("#region").value; st.pick = null; repaint(); Growth3D.frameNodes(region().manholes.map(nameOf)); };
    $("#stepRange").oninput = () => { st.step = +$("#stepRange").value; repaint(); };
    $("#kRange").oninput = () => { st.k = +$("#kRange").value; repaint(); };
    $("#site").onchange = () => { st.site = $("#site").value === "" ? null : +$("#site").value; st.pick = null; repaint(); };
  }
  function renderKnobs() {
    const ci = caseIndex(), c = curCase();
    $$("#viewKnob button").forEach(b => b.classList.toggle("on", b.dataset.v === st.view));
    $$("#famKnob button").forEach(b => b.classList.toggle("on", b.dataset.f === st.fam));
    $$("#iiKnob button").forEach(b => b.classList.toggle("on", +b.dataset.i === ci));
    $("#caseSel").value = String(ci);
    $$("#ruleKnob button").forEach(b => b.classList.toggle("on", b.dataset.r === st.rule));
    $$("#typeKnob button").forEach(b => b.classList.toggle("on", b.dataset.r === st.rule || (b.dataset.r === "r10" && st.rule !== "alarm")));
    $$("#addKnob button").forEach(b => b.classList.toggle("on", +b.dataset.i === st.add));
    $$("#methKnob button").forEach(b => b.classList.toggle("on", b.dataset.m === st.method));
    $$("#objKnob button").forEach(b => b.classList.toggle("on", b.dataset.o === st.obj));
    $("#famNote").textContent = FAM_NOTE[st.fam];
    $("#infillBox").hidden = st.fam !== "infill";
    $("#oneBox").hidden = st.fam !== "one";
    $("#region").value = String(st.region);
    $("#stepRange").value = String(st.step);
    $("#kRange").value = String(st.k);
    $("#kVal").textContent = String(st.k);
    $("#site").value = st.site == null ? "" : String(st.site);
    const settled = c.settled !== false;
    $("#iiNote").innerHTML = '<span class="badge ' + (settled ? "settled" : "fixed") + '">' + (settled ? "settled runs" : "480-minute runs") + "</span>" +
      esc(c.note || "") + (caseFellBack() ? " <b>This family has not run the selected variant yet; its " + esc(c.label) + " case is shown.</b>" : "") +
      (st.view === "simple" ? " The sensors are chosen for the worst of all " + famCases().length + " cases, not just this one." : "");
    const rl = ruleOf(st.rule);
    $("#ruleNote").textContent = rl.note + (st.view === "simple" && st.rule !== "alarm" && st.rule !== "r10" ? " (Expert rule " + rl.label + " selected.)" : "");
    if (st.fam === "infill") {
      const reg = region(), f = ladder()[st.step], row = curRow();
      $("#stepLbl").innerHTML = "<b>+" + (row ? Math.round(row.dw) : Math.round(reg.nominal * f)) + "</b> dwellings (" + Math.round(f * 100) + "% of the area's share)";
      $("#stepNote").textContent = "100% is this area's share of the 2041 projection, " + Math.round(reg.nominal) + " dwellings on its " + reg.dwellings +
        " today. 25% is roughly the first year or two; 300% is a stress test.";
    }
    $("#objKnob").style.display = st.fam !== "one" && st.method !== "greedy" ? "none" : "";
    const hasRisk = st.fam !== "one" && !!((S().rules[st.rule] || {}).risk);
    $("#methRisk").hidden = !hasRisk;
    if (!hasRisk && st.method === "risk") st.method = "exact";
    $("#methNote").textContent = st.fam !== "one"
      ? (st.method === "exact" ? "The best set of this size, solved exactly over all cases for the worst case (PuLP + HiGHS). The recommendation."
         : st.method === "risk" ? "Kimbrough's risk score: each scenario weighted by severity (homes draining through the manhole where it bites) x occurrence (how far it pushes that manhole towards 0.7 of its bore). The set that notices the most RISK, solved exactly. A comparison, not the recommendation: it pulls sensors towards trunk mains already near capacity."
                               : "Each sensor is the best addition to the ones before it. Up to 10 points below the exact optimum at the same size.")
      : "The greenfield grid publishes the greedy order only; the exact solver has run on the infill family.";
    $("#objNote").textContent = st.obj === "worst"
      ? "Each sensor added is the one that most raises the worst of the cases: whatever the unknowns turn out to be, at least this much is caught."
      : "Each sensor added is the one that most raises the average over the cases. Catches more on average, but can leave one case poorly covered.";
    $("#fitSite").textContent = st.fam === "infill" ? "Zoom to the area" : "Zoom to the growth";
    $("#fitSite").disabled = st.fam === "none" || (st.fam === "one" && st.site == null);
    $("#regionKey").hidden = !(st.lg.regions && st.fam === "infill");
  }

  function setView(v) {
    st.view = v;
    document.body.classList.toggle("simple", v === "simple");
    document.body.classList.toggle("expert", v === "expert");
    if (v === "simple" && st.rule !== "alarm" && st.rule !== "r10") st.rule = "r10";
    if (v === "simple") { st.showHeat = false; $("#toggleHeat").classList.remove("primary"); }
    repaint();
    Growth3D.resize($("#stage"));
  }
  function setFamily(f) {
    st.fam = f; st.pick = null; st.hover = null;
    if (f === "one" && st.method === "exact") st.method = "greedy";
    if (f !== "one" && st.method === "greedy" && !st.pickedGreedy) st.method = "exact";
    buildCaseKnobs();
    repaint();
    if (f === "infill") Growth3D.frameNodes(region().manholes.map(nameOf));
    else Growth3D.frame(null);
  }

  /* ------------------------------------------------------------ left panel */
  function renderPanel() {
    const Rr = R(), c = curCase();
    if (st.fam === "infill") {
      const reg = region(), row = curRow();
      if (!row) {
        $("#siteFacts").innerHTML = '<p class="quiet">This area and build-out have no run in the selected case.</p>';
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
    ? "Graded rule: every manhole is judged against its own level before the growth, so nothing counts as already triggered."
    : nAlarm ? "<b>" + nAlarm + "</b> of " + n + " manholes are already over the alarm in this case <b>before any houses are added</b>. They are amber and cannot report the growth."
    : "No manhole is over the alarm before growth in this case.") +
    (nSpill ? " <b>" + nSpill + "</b> manhole" + (nSpill === 1 ? " already spills" : "s already spill") + " from the lid before any growth." : "");

  /* ------------------------------------------------------------- in words */
  function renderWords() {
    const c = curCase(), el = $("#inWords");
    if (st.fam === "infill") {
      const reg = region(), row = curRow();
      if (!row) { el.innerHTML = ""; return; }
      const seen = seers(row, st.rule), top = row.rise[0], chosen = placement().chosen, caught = chosen.filter(i => seen.includes(i));
      const fd = ((S().rules[st.rule] || {}).firstSeen || {})[reg.id] || {};
      const first = fd[curTag()];
      el.innerHTML = '<span class="tag">Infill</span><b>' + esc(reg.id + ", " + shortName(reg)) + "</b>: " + Math.round(row.dw) + " new dwellings (" +
        Math.round(ladder()[st.step] * 100) + "% of its 2041 share) in <b>" + esc(c.label) + "</b> weather. " +
        (top && top[1] >= 0.5 ? "Largest rise <b>" + top[1].toFixed(1) + " mm</b> at " + label(top[0]) + "; " : "No manhole rises as much as half a millimetre; ") +
        (seen.length ? "<b>" + seen.length + "</b> manhole" + (seen.length === 1 ? "" : "s") + " see it under the " + esc(ruleOf(st.rule).label.toLowerCase()) + " rule" : "nothing passes the rule") + ". " +
        (st.showSensors ? (caught.length ? "Sensor" + (caught.length === 1 ? " " : "s ") + caught.map(i => "S" + (chosen.indexOf(i) + 1)).join(", ") + (caught.length === 1 ? " sees" : " see") + " it." : "<b>None of the chosen sensors sees it.</b>") : "") +
        (first ? " In this weather a sensor first sees this area at <b>" + Math.round(first[1] * 100) + "%</b> build-out (" + label(first[0]) + ")." : " In this weather no sensor sees this area at any build-out.");
      return;
    }
    if (st.fam === "one") {
      if (st.site == null) { el.innerHTML = '<span class="tag">Greenfield</span>Click a manhole to place the new estate there.'; return; }
      const cl = cell(), row = rowFor(cl, st.site), tipped = row ? row.tip : [], chosen = placement().chosen, caught = chosen.filter(i => tipped.includes(i));
      el.innerHTML = '<span class="tag">Greenfield</span><b>' + R().growthLevels[st.add] + " dwellings</b> joining at <b>" + esc(label(st.site)) + "</b> in <b>" + esc(c.label) + "</b> weather: " +
        (tipped.length ? "<b>" + tipped.length + "</b> manhole" + (tipped.length === 1 ? "" : "s") + " see it" : "no manhole passes the rule") + ". " +
        (st.showSensors ? (caught.length ? "Sensor" + (caught.length === 1 ? " " : "s ") + caught.map(i => "S" + (chosen.indexOf(i) + 1)).join(", ") + " see" + (caught.length === 1 ? "s" : "") + " it." : "<b>None of the chosen sensors sees it.</b>") : "");
      return;
    }
    el.innerHTML = '<span class="tag">No growth</span>The suburb as the model has it in <b>' + esc(c.label) + "</b> weather. Amber manholes are already over the " + ALARM_MM + " mm alarm; the choke points are listed on the left.";
  }

  /* ------------------------------------------------------------ right panel */
  function renderSide() {
    const box = $("#mhFacts");
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
    box.innerHTML = "<h4>This area</h4>" +
      row2("Area", "<b>" + esc(reg.id) + "</b> " + esc(shortName(reg))) +
      (rw ? row2("Risk weight (expert)", "<b>" + rw.w + "</b> = S " + rw.S + " x O " + rw.O + (rw.at != null ? ", at " + esc(label(rw.at)) + (rw.ddAfter != null ? " (d/D " + rw.ddBefore + " to " + rw.ddAfter + ")" : "") : "")) : "") +
      row2("Today", reg.dwellings + " homes, " + reg.nManholes + " manholes, " + (reg.lengthM / 1000).toFixed(1) + " km of pipe") +
      row2("Its 2041 share", "<b>" + Math.round(reg.nominal) + "</b> dwellings (100%)" + (reg.exitPipe ? ", drains out through pipe " + reg.exitPipe : "")) +
      '<p class="quiet">' + esc(reg.name) + "</p>" +
      "<h4>First build-out a sensor sees it (" + esc(ruleOf(st.rule).label.toLowerCase()) + ")</h4>" + seenTable +
      '<p class="quiet">The best single manhole in each case. A blank row means no manhole passes the rule even at 300%: the area is a blind spot under this rule.</p>' +
      (tr ? "<h4>Time to notice full build-out, " + esc(curCase().label) + "</h4>" +
        row2("Best manhole", esc(label(tr.best)) + ", <b>+" + tr.riseMm.toFixed(1) + " mm</b> at 100%") +
        '<table class="sm"><tr><th>Day-to-day noise</th><th>Days of readings</th></tr>' + days + "</table>" +
        '<p class="quiet">How many days of same-hour readings separate the new level from the old one, if the day-to-day scatter is the figure in the first column. The scatter is assumed until normal-day level records arrive.</p>' : "") +
      (pi ? "<h4>Pump stations, " + esc(curCase().label) + ", 100% build-out</h4>" + Object.entries(pi).map(([p, v]) =>
        row2(esc(p.replace(/^P/, "Station ")), v.baseline_lps.toFixed(2) + " to " + v.with_growth_lps.toFixed(2) + " L/s (" + (v.change_pct >= 0 ? "+" : "") + v.change_pct.toFixed(1) + "%)")).join("") +
        '<p class="quiet">Pumped flow is a growth indicator only for the part of the suburb that drains through a station; a zero change means this area does not.</p>' : "");
  }
  let _incoming = null;
  function upstreamOf(g, ni) {
    if (!_incoming) { _incoming = g.nodes.map(() => []); for (let l = 0; l < g.up.length; l++) _incoming[g.down[l]].push(l); }
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
    box.innerHTML = "<h4>This manhole</h4>" +
      row2("Asset", "MH " + n.mh + (n.yr ? ", built " + n.yr : ", year not recorded")) +
      (ri >= 0 ? row2("Area", esc(S().regions[ri].id + ", " + shortName(S().regions[ri]))) : "") +
      (water ? row2("Water before growth", water) : "") + (head ? row2("Headroom", head) : "") +
      (here ? row2("This growth", here) : "") +
      row2("Pipe floor / ground", inv.toFixed(2) + " / " + (inv + n.depth).toFixed(2) + ' m <span class="quiet">(' + n.depth.toFixed(1) + " m deep)</span>") +
      row2("Pipes", pipes) +
      row2("Drains through it", up.chambers + " manholes, " + (up.metres / 1000).toFixed(2) + " km of pipe") +
      row2("As a sensor", "alone it sees " + pct(h.mean[i]) + " of " + (st.fam === "one" ? "greenfield" : "infill") + " growth on average, " + pct(h.worst[i]) + " in the worst case; rank " + rank + " of " + names().length +
        (k >= 0 ? ", <b>chosen as S" + (k + 1) + "</b>" : "")) +
      '<p class="quiet">Water and headroom are for ' + esc(curCase().label) + ". Click empty ground to go back to the area card.</p>";
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
      (pl.riskWorst != null ? ", and <b>" + pct(pl.riskWorst) + "</b> of the risk-weighted total" : "") + " (" + esc(ruleOf(st.rule).label.toLowerCase()) +
      (isIn ? ", " + S().cases.length + " cases, " + S().regions.length + " areas x " + ladder().length + " build-outs" : ", all " + R().growthLevels.length + " growth sizes, " + R().cases.length + " cases") + ").</p>";
    const cards = chosen.map((i, j) => {
      const nm = nameOf(i), ri = regionOf[i];
      let watch = "";
      if (isIn) {
        // The areas this manhole is the first to see, over every case, and how early.
        const firsts = [];
        S().regions.forEach(reg => {
          const fd = (rr.firstSeen || {})[reg.id] || {};
          const steps = Object.entries(fd).filter(([, v]) => v && v[0] === i).map(([, v]) => v[1]);
          if (steps.length) firsts.push({ id: reg.id, at: Math.min(...steps), n: steps.length });
        });
        watch = firsts.length ? "First to see <b>" + firsts.map(f => f.id + " at " + Math.round(f.at * 100) + "%").join(", ") + "</b> build-out in " +
          (firsts.reduce((a, f) => a + f.n, 0) === 1 ? "one case" : "some cases") + ". "
          : "Not the first detector of any area; it earns its place by covering scenarios the others miss. ";
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
        "<p>" + watch + "Watches <b>" + upc.chambers + "</b> manholes and " + (reach ? reach.here : "?") + " homes draining through it. A " + type + ". " + sees + "</p></div>";
    }).join("");
    let extra = "";
    if (isIn && st.view === "expert" && pl.compare && pl.compare.plain_set) {
      const c = pl.compare, hi = ' class="hi"';
      extra += "<h4>Plain against risk-weighted, " + k + " sensors</h4><table class='sm'><tr><th>Set</th><th>Plain coverage</th><th>Risk-weighted</th></tr>" +
        "<tr><td>Exact (plain)</td><td" + (st.method !== "risk" ? hi : "") + ">" + pct(c.plain_set.plain) + "</td><td>" + pct(c.plain_set.risk) + "</td></tr>" +
        "<tr><td>Risk-weighted</td><td>" + pct(c.risk_set.plain) + "</td><td" + (st.method === "risk" ? hi : "") + ">" + pct(c.risk_set.risk) + "</td></tr></table>" +
        "<p class='quiet'>Worst case over the cases. The two sets share " + c.shared + " of " + k + " manholes. Risk weight = severity x occurrence per scenario (Kimbrough 2019, as applied in the risk note of 22 Oct 2026); the current scenario's weight is in the area card.</p>";
    }
    if (isIn && st.view === "expert" && rr.loo && Object.keys(rr.loo).length) {
      const n0 = Object.values(rr.loo)[0].chosen.length;
      extra = "<h4>Leave one case out (" + n0 + " sensors)</h4><table class='sm'><tr><th>Held out</th><th>Score on it</th></tr>" +
        S().cases.map(c => rr.loo[c.tag] ? "<tr><td>" + esc(c.label) + "</td><td" + (rr.loo[c.tag].score < 0.5 ? ' class="hi"' : "") + ">" + pct(rr.loo[c.tag].score) + "</td></tr>" : "").join("") +
        "</table><p class='quiet'>Sensors chosen on the other cases, scored on the one held out: how much the recommendation depends on any single assumption about the weather.</p>";
    }
    $("#sensorList").innerHTML = lead + cards + extra +
      "<p class=quiet>" + (isIn && st.method === "exact" ? "Each size is solved on its own, so the set for " + (k + 1) + " need not contain this one." : "Chosen one at a time, so the set for " + (k + 1) + " is this set plus one.") +
      " Detectable growth: scenarios that at least one manhole sees. This scores whether a sensor would notice growth, not whether it watches a choke point; the choke points are under No growth.</p>";
  }
  function renderCurve() {
    const el = $("#curve");
    if (st.view !== "expert") { el.innerHTML = ""; return; }
    let series = [];
    if (st.fam !== "one") {
      const rr = S().rules[st.rule];
      if (!rr) { el.innerHTML = ""; return; }
      const ex = rr.exact || [], gr = rr.greedy.curve || [];
      series = [{ name: "Exact, worst case", col: "var(--worst)", v: ex.map(e => e.worst) },
                { name: "Exact, average", col: "var(--mean)", v: ex.map(e => e.average) },
                { name: "Greedy, worst case", col: "var(--greedy)", v: gr.map(c => c.worst), dash: true }];
    } else {
      const pl = R().sensors[st.rule][st.obj];
      series = [{ name: "Worst case", col: "var(--worst)", v: pl.worst }, { name: "Average", col: "var(--mean)", v: pl.mean }];
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
  function renderRef() {
    if ($("#ref").dataset.done) return;
    const g = G();
    $("#ref").innerHTML = '<div class="lead"><p><strong>What this model is, in one paragraph.</strong> Every council pipe draining to the end of the council data, ' +
      g.nPipes + " pipes and " + g.nChambers + " manholes, is solved together in EPA SWMM as a steady state, run until no manhole's level is still moving, and every one of those manholes is a growth site and a sensor candidate. " +
      "Pipes from outside the council area are not modelled; where they join, a constant inflow sized from their published length stands in for them. Two pump stations pass their flow on as ideal pumps. " +
      "Sewage comes from connected properties counted from the published record; infiltration is in proportion to pipe length.</p>" +
      "<p><strong>The register below</strong> is every assumption and constant the model rests on, with its value, how firm it is and its source. " + S().cases.length +
      " cases vary the ones no data pins yet. Sources cited as docs/ or papers/ are in the project's working repository, not this one.</p></div>" + '<div class="regBody">' + markdown(IDX().docs.assumptions) + "</div>";
    wireRegister($("#ref .regBody"));
    $("#ref").dataset.done = "1";
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
  function renderQA() {
    if ($("#qa").dataset.done) return;
    $("#qa").innerHTML = markdown(IDX().docs.findings);
    $("#qa").dataset.done = "1";
  }
  function setTab(tab) {
    const ref = tab === "ref", qa = tab === "qa";
    $("#pane-ref").hidden = !ref; $("#pane-qa").hidden = !qa;
    $("#tab-ref").classList.toggle("primary", ref); $("#tab-ref").textContent = ref ? "Back to the map" : "Assumptions";
    $("#tab-qa").classList.toggle("primary", qa); $("#tab-qa").textContent = qa ? "Back to the map" : "Findings";
    if (ref) renderRef(); else if (qa) renderQA(); else Growth3D.resize($("#stage"));
  }
  function showModal() {
    const sc = IDX().scenario, n = sc.numbers;
    const fact = (l, v) => v == null ? "" : '<div class="kfact">' + esc(l) + "<b>" + esc(v) + "</b></div>";
    $("#modalBox").innerHTML = '<button class="close" id="modalClose">Close</button><h2>' + esc(sc.title) + '</h2><p class="q">' + esc(sc.question) + "</p>" +
      sc.what.map(p => "<p>" + esc(p) + "</p>").join("") + "<h3>What to look at</h3><ul>" + sc.read.map(r => "<li>" + esc(r) + "</li>").join("") + "</ul>" +
      "<h3>The numbers behind it</h3><div class=kfacts>" + fact("Pipes modelled", n.pipes) + fact("Manholes", n.chambers) + fact("Properties counted", n.dwellings) +
      fact("Areas (infill)", n.regions) + fact("Uncertainty cases", n.cases) + fact("Peak factor", n.peakFactor) + fact("Wet weather settings", n.iiRange ? n.iiRange + " L/s per 100 m" : null) +
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
  function legendGroups() {
    const show = (cls, on) => $$(".legend ." + cls).forEach(g => { if (g.id === "heatKey") return; if (g.id === "pumpKey") { g.hidden = !(on && st.showPumps); return; } if (g.id === "connKey") { g.hidden = !(on && st.showConn); return; } if (g.id === "regionKey") { g.hidden = !(on && st.fam === "infill"); return; } g.hidden = !on; });
    show("lg-results", st.lg.results); show("lg-network", st.lg.network); show("lg-regions", st.lg.regions);
    $("#lgResults").classList.toggle("primary", st.lg.results);
    $("#lgNetwork").classList.toggle("primary", st.lg.network);
    $("#lgRegions").classList.toggle("primary", st.lg.regions);
  }
  function init() {
    names().forEach((c, i) => { idxOfName[c] = i; });
    regionOf = names().map(() => -1);
    S().regions.forEach((r, ri) => r.manholes.forEach(i => { regionOf[i] = ri; }));
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
    if (hp.get("method") === "greedy" || hp.get("method") === "risk") st.method = hp.get("method");
    if (hp.get("site") != null && names()[+hp.get("site")]) st.site = +hp.get("site");
    if (st.fam === "one" && st.method === "exact") st.method = "greedy";
    document.body.classList.toggle("simple", st.view === "simple");
    document.body.classList.toggle("expert", st.view === "expert");
    Growth3D.build($("#stage"), nd => {
      st.hover = null;
      if (!nd) { st.pick = null; if (st.fam === "one" && st.site != null) st.site = null; repaint(); return; }
      if (!(nd.name in idxOfName)) return;
      const i = idxOfName[nd.name];
      if (st.fam === "one") { st.site = i; st.pick = null; }
      else { st.pick = nd.name; if (st.fam === "infill" && regionOf[i] >= 0) st.region = regionOf[i]; }
      repaint();
    }, nd => {
      const name = nd && !(st.fam === "one" && st.site != null && nd.name === nameOf(st.site)) ? nd.name : null;
      if (name === st.hover) return;
      st.hover = name;
      renderHomes(sensorSet());
    }).then(() => {
      $("#kRange").max = String(R().maxSensors || 10);
      buildKnobs();
      buildSiteList();
      legendGroups();
      $("#scale").textContent = G().nPipes + " pipes, " + G().nChambers + " manholes, " + (G().nHouses || G().baseDwellings) + " connected properties, plus " +
        G().nodes.filter(n => n.kind !== "chamber").length + " pipe ends with no manhole on record. Elevation is the pipe invert, exaggerated x" + Growth3D.ZEXAG +
        ". Drag to turn the map, right-drag to move it, scroll to zoom where the pointer is.";
      repaint();
      if (st.fam === "infill") Growth3D.frameNodes(region().manholes.map(nameOf)); else Growth3D.frame(null);
    });
    $("#btn-info").onclick = showModal;
    $("#tab-ref").onclick = () => setTab($("#pane-ref").hidden ? "ref" : "map");
    $("#refClose").onclick = () => setTab("map");
    $("#tab-qa").onclick = () => setTab($("#pane-qa").hidden ? "qa" : "map");
    $("#qaClose").onclick = () => setTab("map");
    $("#modal").onclick = e => { if (e.target.id === "modal") $("#modal").hidden = true; };
    document.addEventListener("keydown", e => { if (e.key === "Escape") { $("#modal").hidden = true; setTab("map"); } });
    $("#fitAll").onclick = () => Growth3D.frame(null);
    $("#fitSite").onclick = () => { if (st.fam === "infill") Growth3D.frameNodes(region().manholes.map(nameOf)); else if (st.site != null) Growth3D.frame(nameOf(st.site)); };
    $("#toggleSensors").onclick = () => {
      st.showSensors = !st.showSensors;
      $("#toggleSensors").classList.toggle("primary", st.showSensors);
      $("#toggleSensors").textContent = st.showSensors ? "Hide sensors" : "Show sensors";
      repaint();
    };
    const hasPumps = !!(G().pumps && G().pumps.length);
    $("#togglePumps").hidden = !hasPumps;
    $("#togglePumps").onclick = () => {
      st.showPumps = !st.showPumps;
      if (!Growth3D.showPumps(st.showPumps)) { st.showPumps = false; return; }
      $("#togglePumps").classList.toggle("primary", st.showPumps);
      $("#togglePumps").textContent = st.showPumps ? "Hide pump stations" : "Pump stations";
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
    $("#lgResults").onclick = () => { st.lg.results = !st.lg.results; legendGroups(); };
    $("#lgNetwork").onclick = () => { st.lg.network = !st.lg.network; legendGroups(); };
    $("#lgRegions").onclick = () => { st.lg.regions = !st.lg.regions; legendGroups(); renderKnobs(); };
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
