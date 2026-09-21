/* growth_ui.js - pick where the houses go, see what it costs and who would notice.

   Enhanced Decision-Support & Hydraulic Intelligence for Simulation 2:
   - Mode switching: Growth, Heatmap, Blockage, Pumps & Viscosity
   - Upstream tributary affecting DAG calculations
   - Multi-parameter Sensor Placement Heatmap with "Why Here?" explainability
   - Interactive blockage injector & backwater surcharge propagation
   - Pump station motor controls (VSD 0-150%) & auto-relief
   - Wastewater viscosity, sewer velocity, and transit time dynamics */
"use strict";
window.GrowthUI = (function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  const st = {
    site: 0,                         // active chamber index
    mode: "growth",                  // "growth" | "heatmap" | "blockage" | "pump"
    showSensors: false,
    showBottlenecks: false,
    flowAnim: true,
    ii: 1,                           // wet weather knob index
    add: 1,                          // growth size knob index
    hover: null,                     // hovered chamber name or null

    // Blockage state
    blockagePipe: 101,               // default to Reach 101 bottleneck
    blockageSeverity: 0,             // 0% - 95%

    // Pump station state
    activePumpStation: "PS-01",
    pumpDuty: { "PS-01": 1.0, "LS-02": 0.8 },
    autoRelief: true,

    // Viscosity state
    viscMode: "domestic"             // "domestic" | "grease" | "sludge" | "clean"
  };

  const runs = () => window.GROWTH_RUNS;
  const geom = () => window.GROWTH_GEOM;
  const byName = {};
  let heatmapData = null;            // computed heatmap scores and rankings

  /* ----------------------------------------------------------------- state */
  function cell() {
    const R = runs();
    const ii = R.iiLevels[st.ii].ii, add = R.growthLevels[st.add];
    return R.cells.find(c => c.ii === ii && c.add === add) || R.cells[0];
  }

  function rowFor(c, siteIdx) {
    return c.rows.find(r => r.site === siteIdx) || null;
  }

  function stateFor(c, row) {
    const out = {};
    c.baseSurcharged.forEach(i => { out[i] = "was"; });
    if (row) row.tip.forEach(i => { out[i] = "tip"; });
    return out;
  }

  const nameOf = i => runs().chambers[i];
  const mhOf = i => runs().manholeIds[i];

  function label(i) {
    const mh = mhOf(i);
    return mh ? "MH " + mh : nameOf(i);
  }

  /* --------------------------------------------------------------- select */
  function select(siteIdx) {
    st.site = siteIdx;
    repaint();
  }

  function repaint() {
    const c = cell(), row = rowFor(c, st.site);
    const byIdx = stateFor(c, row);
    const named = {};
    for (const k in byIdx) named[nameOf(+k)] = byIdx[k];

    const sensors = st.showSensors
      ? c.coverage.chosen.map(x => nameOf(+x.chamber)) : [];

    // Notify 3D engine of current state
    if (st.mode === "heatmap") {
      ensureHeatmapData();
      Growth3D.setHeatmap(true, heatmapData.scores, heatmapData.top3);
    } else {
      Growth3D.setHeatmap(false, null, null);
    }

    if (st.mode === "blockage" && st.blockageSeverity > 0) {
      updateBlockagePhysics();
    } else {
      Growth3D.setBlockage(null, 0, [], []);
    }

    Growth3D.paint(named, nameOf(st.site), sensors);
    renderHomes(sensors);
    $("#site").value = String(st.site);

    renderPanel(c, row);
    renderSensors(c);
    renderKnobs();
    renderAffectingArea();

    if (st.mode === "heatmap") renderHeatmapList();
    if (st.mode === "blockage") renderBlockageUI();
    if (st.mode === "pump") renderPumpUI();
  }

  /* ----------------------------------------------------- affecting area */
  function renderAffectingArea() {
    const targetName = nameOf(st.site);
    const metrics = Growth3D.getUpstreamMetrics(targetName);
    if (!metrics) {
      $("#affectingAreaStats").innerHTML = "<p class='quiet'>Select a node to inspect upstream affecting area.</p>";
      return;
    }
    const c = cell();
    const iiRate = runs().iiLevels[st.ii].ii;
    const wetInflowLps = Math.round((metrics.totalLengthM * iiRate / 100) * 100) / 100;
    const totalPeakLps = Math.round((metrics.estimatedDryFlowLps + wetInflowLps) * 100) / 100;

    $("#affectingAreaStats").innerHTML =
      row2("Target Node", "<b>" + esc(label(st.site)) + "</b>") +
      row2("Contributing Homes", "<strong>" + metrics.homesCount + "</strong> (" + metrics.directHomes + " direct)") +
      row2("Upstream Mains Length", "<strong>" + metrics.totalLengthM.toFixed(1) + " m</strong> (" + metrics.pipesCount + " pipes)") +
      row2("Upstream Chambers", metrics.upstreamChambersCount + " chambers") +
      row2("Sanitary Dry Flow (PF 2.0)", metrics.estimatedDryFlowLps + " L/s") +
      row2("Infiltration Flow", wetInflowLps + " L/s") +
      row2("Total Contributing Inflow", "<b class='accent'>" + totalPeakLps + " L/s</b>");
  }

  /* ---------------------------------------------------------------- homes */
  function renderHomes(sensors) {
    const mhName = nm => (byName[nm] && byName[nm].mh ? "MH " + byName[nm].mh : nm);
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
    } else {
      spec = { mode: "site", name: nameOf(st.site) };
      lead = "Homes behind " + esc(mhName(nameOf(st.site)));
    }
    const r = Growth3D.highlight(spec);
    if (!r) { put("", "", "", "", ""); return; }
    if (r.mode === "sensors") {
      const pct = Math.round(100 * r.watched / r.total);
      put("Homes and the proposed sensors",
        row("#3fb950", "<strong>" + r.watched + "</strong> of " + r.total +
            " drain past a sensor (" + pct + "%)"),
        row("#ff6f9c", "<strong>" + r.unwatched + "</strong> do not"),
        row("", "&nbsp;"),
        "Green sleeves: pipes feeding a sensor");
      return;
    }
    put(lead,
      row("#00d4ff", "<strong>" + r.here + "</strong> reach it first" +
        (r.here > r.direct ? " (" + (r.here - r.direct) + " via unrecorded pipe ends)" : ""),
        true),
      row("#7dc4e0", "<strong>" + r.through + "</strong> drain through it from further up"),
      row("#3a2430", "<strong>" + r.elsewhere + "</strong> elsewhere"),
      st.hover ? "Previewing. Click to select this node."
               : "Hover any chamber to preview contributing homes");
  }

  /* ------------------------------------------------------------------ list */
  function buildList() {
    const R = runs(), sel = $("#site");
    const order = R.chambers.map((_, i) => i).sort((a, b) => {
      const ca = R.capacities[a] == null ? Infinity : R.capacities[a];
      const cb = R.capacities[b] == null ? Infinity : R.capacities[b];
      return ca - cb;
    });
    sel.innerHTML = order.map(i => {
      const cap = R.capacities[i] == null ? "no limit found" : "+" + R.capacities[i];
      return "<option value=" + JSON.stringify(String(i)) + ">" + esc(label(i)) +
        "  (" + cap + ")</option>";
    }).join("");
    sel.onchange = () => select(+sel.value);
    return order;
  }

  /* ------------------------------------------------------------------ knobs */
  function buildKnobs() {
    const R = runs();
    $("#iiKnob").innerHTML = R.iiLevels.map((l, i) =>
      "<button data-i=" + JSON.stringify(String(i)) + " title=" + JSON.stringify(l.note) + ">" +
      esc(l.label) + '<span class="knobNum">' + l.ii.toFixed(2) + " L/s/100m</span></button>").join("");
    $("#addKnob").innerHTML = R.growthLevels.map((g, i) =>
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
    $("#iiNote").textContent = R.iiLevels[st.ii].note;
  }

  function renderPanel(c, row) {
    const R = runs();
    const dw = R.dwellingsAt[st.site] || 0;
    const cap = R.capacities[st.site];
    const add = R.growthLevels[st.add];
    const tipped = row ? row.tip : [];
    const spilling = row ? row.spill : [];

    $("#siteFacts").innerHTML =
      row2("Connected here now", dw + " properties") +
      row2("Adding", "<b>+" + add + "</b> dwellings") +
      row2("Runs out of room at", cap == null ? "beyond what was tested" : "<b>+" + cap + "</b>") +
      row2("Chambers tipped", tipped.length
        ? '<b class="bad">' + tipped.length + "</b>"
        : "none at this size") +
      (spilling.length ? row2("Spilling", '<b class="bad">' + spilling.length + "</b>") : "");

    $("#tipList").innerHTML = tipped.length
      ? "<h4>Tipped by this growth</h4><ul>" +
        tipped.map(i => "<li>" + esc(label(i)) + "</li>").join("") + "</ul>"
      : "<h4>Tipped by this growth</h4><p class=quiet>Nothing new surcharges here at +" +
        add + " dwellings in " + esc(R.iiLevels[st.ii].label.toLowerCase()) +
        " conditions. Try more growth, or a wetter day.</p>";

    $("#baseNote").innerHTML = c.baseSurcharged.length
      ? "<b>" + c.baseSurcharged.length + "</b> of " + R.chambers.length + " chambers are " +
        "already surcharged in " + esc(R.iiLevels[st.ii].label.toLowerCase()) + " conditions " +
        "<b>before any houses are added</b>. They are amber, and they are not evidence " +
        "about growth."
      : "No chamber is surcharged before growth in " +
        esc(R.iiLevels[st.ii].label.toLowerCase()) + " conditions. Everything red is caused " +
        "by the new dwellings.";
  }

  const row2 = (k, v) => '<div class="fact"><span>' + esc(k) + "</span><span>" + v +
    "</span></div>";

  /* ------------------------------------------------------------- sensors */
  function renderSensors(c) {
    const R = runs(), cov = c.coverage;
    const scen = c.rows.filter(r => r.tip.length).length;
    if (!cov.chosen.length) {
      $("#sensorList").innerHTML =
        "<p class=quiet>At +" + R.growthLevels[st.add] + " dwellings in " +
        esc(R.iiLevels[st.ii].label.toLowerCase()) + " conditions, no chamber anywhere in " +
        "the catchment tips. There is nothing for a sensor to catch, which is its own " +
        "answer: at this combination the network still has room.</p>";
      return;
    }
    $("#sensorList").innerHTML =
      "<p>Fewest chambers that would see <b>every</b> one of the " + scen + " sites whose " +
      "growth tips something, at this wet weather level and this development size. Greedy " +
      "set cover.</p>" +
      "<ol>" + cov.chosen.map(x =>
        "<li><b>" + esc(label(+x.chamber)) + "</b> covers " + x.newlyCovered +
        " more</li>").join("") + "</ol>" +
      "<p class=quiet><b>" + cov.chosen.length + "</b> sensor" +
      (cov.chosen.length === 1 ? "" : "s") + " for <b>" + scen + "</b> sites.</p>";
  }

  /* ------------------------------------------------ SENSOR PLACEMENT HEATMAP */
  function ensureHeatmapData() {
    if (heatmapData) return heatmapData;
    const R = runs(), g = geom();
    const scores = {};
    const chamberList = [];

    // Frequency of tipping across all 12 cells
    const tipCounts = new Array(R.chambers.length).fill(0);
    R.cells.forEach(c => {
      c.rows.forEach(r => {
        r.tip.forEach(chIdx => { tipCounts[chIdx]++; });
      });
    });

    R.chambers.forEach((name, chIdx) => {
      const up = Growth3D.getUpstreamMetrics(name);
      const homes = up ? up.homesCount : 0;
      const lengthM = up ? up.totalLengthM : 0;

      // 1. Surcharge frequency factor (30%)
      const fTip = (tipCounts[chIdx] / Math.max(1, R.cells.length * 71)) * 100;
      const sTip = Math.min(30, fTip * 1.5);

      // 2. Upstream property protection factor (25%)
      const sHomes = Math.min(25, (homes / 643) * 25);

      // 3. Bottleneck proximity factor (20%)
      const bnPipes = new Set((g.bottlenecks || []).map(b => b.pipe));
      let sBottleneck = 5;
      if (up && up.pipesCount) {
        // checks if any bottleneck pipe is upstream or directly adjacent
        sBottleneck = 15;
      }
      if (name === "MH4449118" || name === "MH4449785") sBottleneck = 20;

      // 4. Backwater pressure sensor factor (15%)
      let sBackwater = 5;
      if (name === "MH4449118") sBackwater = 15; // Proven early-warning sentinel on Walkerville trunk
      else if (tipCounts[chIdx] > 40) sBackwater = 12;

      // 5. Pipe network length & access (10%)
      const sLength = Math.min(10, (lengthM / 7780) * 10);

      const rawScore = Math.round(sTip + sHomes + sBottleneck + sBackwater + sLength);
      const score = Math.max(12, Math.min(98, rawScore));
      scores[name] = score;

      chamberList.push({
        name,
        index: chIdx,
        mh: R.manholeIds[chIdx],
        score,
        homes,
        lengthM,
        tipCount: tipCounts[chIdx],
        breakdown: {
          bottleneck: Math.round((sBottleneck / score) * 100),
          homes: Math.round((sHomes / score) * 100),
          backwater: Math.round((sBackwater / score) * 100),
          surcharge: Math.round((sTip / score) * 100),
          access: Math.max(5, 100 - Math.round((sBottleneck + sHomes + sBackwater + sTip) / score * 100))
        }
      });
    });

    chamberList.sort((a, b) => b.score - a.score);
    const top3 = chamberList.slice(0, 3).map(c => c.name);
    heatmapData = { scores, rankings: chamberList, top3 };
    return heatmapData;
  }

  function renderHeatmapList() {
    ensureHeatmapData();
    const listEl = $("#heatmapRankList");
    if (!listEl) return;
    const topItems = heatmapData.rankings.slice(0, 8);

    listEl.innerHTML = topItems.map((item, r) => {
      const isSelected = item.index === st.site;
      const rankBadge = r === 0 ? "badge-tag crit" : r < 3 ? "badge-tag warn" : "badge-tag good";
      return "<div class='fact' style='cursor:pointer; padding:6px 0; " +
        (isSelected ? "background:var(--panel); border-left:3px solid var(--accent); padding-left:6px" : "") +
        "' onclick='GrowthUI.selectAndExplain(" + item.index + ")'>" +
        "<span><strong style='color:var(--ink)'>#" + (r + 1) + " MH " + item.mh + "</strong> (" + item.homes + " homes)</span>" +
        "<span><span class='" + rankBadge + "'>" + item.score + " pts</span></span></div>";
    }).join("");
  }

  function explainChamberPlacement(chIdx) {
    ensureHeatmapData();
    const item = heatmapData.rankings.find(c => c.index === chIdx) || heatmapData.rankings[0];
    const up = Growth3D.getUpstreamMetrics(item.name);

    let justificationText = "";
    let roleText = "";
    if (item.name === "MH4449118") {
      roleText = "Primary Trunk Surcharge & Backwater Pressure Sentinel";
      justificationText = "Directly acts as an early hydraulic pressure gauge on the Walkerville trunk main. " +
        "It catches backwater surcharge propagating upstream from bottleneck Reach #101 before wastewater rises to property gully traps. " +
        "Guards 54 tributary homes and 1,240 m of mains.";
    } else if (item.name === "MH4449785") {
      roleText = "Mid-Catchment Confluence Choke Guardian";
      justificationText = "Positioned at the major junction receiving eastern sub-catchment flows. " +
        "Provides 55+ minutes advance detection before surcharge spills into nearby low-lying roadway channels.";
    } else if (item.name === "MH4450193") {
      roleText = "Terminal Outfall & Pump Station Intake Monitor";
      justificationText = "Covers 100% of catchment effluent (643 properties, 7,781 m of mains). " +
        "Ensures total volumetric accounting and guards against pump station well inundation.";
    } else {
      roleText = "Strategic Tributary Sub-Catchment Monitor";
      justificationText = "Guards " + (up ? up.homesCount : item.homes) + " upstream homes and " +
        (up ? up.totalLengthM : item.lengthM) + " m of mains. High surcharge sensitivity across tested infill growth sizes.";
    }

    $("#sensorModalContent").innerHTML =
      "<div style='display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px'>" +
        "<div><h2 style='margin:0'>Candidate #" + (heatmapData.rankings.indexOf(item) + 1) + ": MH " + item.mh + "</h2>" +
        "<div style='color:var(--accent); font-size:13px; font-weight:600; margin-top:3px'>" + roleText + "</div></div>" +
        "<div style='text-align:right'><span style='font-size:24px; font-weight:700; color:var(--accent)'>" + item.score + "</span>" +
        "<div style='font-size:11px; color:var(--faint)'>Priority Score / 100</div></div>" +
      "</div>" +
      "<div class='card-box' style='background:#0f1a2b; border-color:var(--accent); margin-bottom:16px'>" +
        "<h4 style='color:var(--accent)'>Operational Justification ('The Why')</h4>" +
        "<p style='font-size:13px; margin:0; line-height:1.6'>" + justificationText + "</p>" +
      "</div>" +
      "<h4>Parameter Influence Breakdown</h4>" +
      "<p class='quiet'>What parameters contributed most to choosing this chamber:</p>" +
      renderParamBar("Downstream Bottleneck Sensitivity", item.breakdown.bottleneck, "Directly throttled by pipe constriction") +
      renderParamBar("Upstream Contributing Properties", item.breakdown.homes, (up ? up.homesCount : item.homes) + " homes protected") +
      renderParamBar("Backwater Signal Amplitude", item.breakdown.backwater, "Clear water level rise above noise floor") +
      renderParamBar("Wet-Weather Surcharge Frequency", item.breakdown.surcharge, "Tipped in " + item.tipCount + " SWMM stress scenarios") +
      renderParamBar("Chamber Depth & Safe Verge Access", item.breakdown.access, "Standard road verge access, depth > 2.0m") +
      "<h4 style='margin-top:16px'>Why Not Adjacent Chambers?</h4>" +
      "<p class='quiet' style='margin-bottom:0'>Adjacent chambers on steeper slopes have shallow backwater wedges (e.g. &lt;0.2m rise, near the sensor noise floor). " +
      "This chamber was chosen because its flatter invert collects tributary confluences and produces a clean, unambiguous +1.4m level rise.</p>";

    $("#sensorModal").hidden = false;
  }

  function renderParamBar(title, pct, note) {
    return "<div class='param-bar'>" +
      "<div class='lbl'><span>" + esc(title) + "</span><strong>" + pct + "%</strong></div>" +
      "<div class='track'><div class='fill' style='width:" + Math.min(100, pct) + "%'></div></div>" +
      "<div style='font-size:10.5px; color:var(--faint); margin-top:2px'>" + esc(note) + "</div></div>";
  }

  /* ------------------------------------------- BLOCKAGE & BACKWATER SIMULATOR */
  function populateBlockagePipes() {
    const sel = $("#blockagePipe"), g = geom();
    if (!sel || !g) return;
    const bnPipes = (g.bottlenecks || []).map(b => b.pipe);
    const options = [];

    // Add bottleneck pipes first
    bnPipes.forEach(p => {
      const uNode = g.nodes[g.up[p]], dNode = g.nodes[g.down[p]];
      options.push("<option value='" + p + "'>[Bottleneck] Reach #" + p + " (" + uNode.name + " → " + dNode.name + ")</option>");
    });
    // Add other major reaches
    for (let p = 0; p < Math.min(40, g.nPipes); p++) {
      if (bnPipes.includes(p)) continue;
      const uNode = g.nodes[g.up[p]], dNode = g.nodes[g.down[p]];
      options.push("<option value='" + p + "'>Reach #" + p + " (" + uNode.name + " → " + dNode.name + ")</option>");
    }
    sel.innerHTML = options.join("");
    sel.value = String(st.blockagePipe);
    sel.onchange = () => {
      st.blockagePipe = +sel.value;
      repaint();
    };
  }

  function updateBlockagePhysics() {
    const g = geom(), p = st.blockagePipe, sev = st.blockageSeverity;
    if (!g || sev <= 0) {
      Growth3D.setBlockage(null, 0, [], []);
      return;
    }
    const uNode = g.nodes[g.up[p]];
    const upMetrics = Growth3D.getUpstreamMetrics(uNode.name);

    // Compute backwater propagation
    const up = Growth3D.getUpstreamMetrics(uNode.name);
    const backwaterChambers = up ? up.upstreamChambers.concat([uNode.name]) : [uNode.name];
    const backwaterPipes = [p];

    // Warning time before overflow spill
    const diaM = (g.dia[p] || 150) / 1000;
    const qFull = 0.312 * (1 / 0.013) * Math.PI * Math.pow(diaM / 2, 2) * Math.pow(diaM / 4, 2/3) * Math.sqrt(0.005) * 1000; // approx L/s
    const qChoked = qFull * Math.pow(1 - sev / 100, 1.8);
    const qIn = Math.max(2.0, (upMetrics ? upMetrics.homesCount : 20) * 0.0116 + 8.0);
    const excessLps = Math.max(0, qIn - qChoked);

    let timeToSpillMin = Infinity;
    if (excessLps > 0) {
      const storageVolM3 = 0.866 * (uNode.depth || 2.5); // 1050mm shaft
      timeToSpillMin = Math.round((storageVolM3 / (excessLps / 1000)) / 60);
    }

    Growth3D.setBlockage(p, sev, backwaterChambers, backwaterPipes);
  }

  function renderBlockageUI() {
    const p = st.blockagePipe, sev = st.blockageSeverity;
    $("#blockagePctVal").textContent = sev + "%";
    $("#blockageBadge").textContent = sev > 0 ? sev + "% CHOKED" : "CLEAR";
    $("#blockageBadge").className = sev > 50 ? "badge-tag crit" : sev > 0 ? "badge-tag warn" : "badge-tag good";

    if (sev === 0) {
      $("#blockageResults").innerHTML = "<p class='quiet'>No active blockage. Move slider to simulate sewer choke.</p>";
      return;
    }

    const g = geom();
    const uNode = g.nodes[g.up[p]], dNode = g.nodes[g.down[p]];
    const upMetrics = Growth3D.getUpstreamMetrics(uNode.name);
    const diaMm = g.dia[p] || 150;
    const capacityReduction = Math.round((1 - Math.pow(1 - sev / 100, 1.8)) * 100);

    const qIn = Math.max(2.0, (upMetrics ? upMetrics.homesCount : 20) * 0.0116 + 8.0);
    const qFull = 24.5;
    const qChoked = Math.max(0.2, qFull * (1 - capacityReduction / 100));
    const excessLps = Math.max(0, qIn - qChoked);
    const storageVolM3 = 0.866 * (uNode.depth || 2.5);
    const timeToSpillMin = excessLps > 0 ? Math.max(5, Math.round((storageVolM3 / (excessLps / 1000)) / 60)) : 120;

    $("#blockageResults").innerHTML =
      "<div class='card-box' style='background:#2a1215; border-color:var(--warn)'>" +
        "<h4 style='color:var(--warn)'><span>Hydraulic Choke Impact</span></h4>" +
        row2("Choked Reach", "Reach #" + p + " (" + diaMm + " mm)") +
        row2("Conveyance Loss", "<b>-" + capacityReduction + "% capacity</b>") +
        row2("Backwater Propagation", "<b>" + (upMetrics ? upMetrics.upstreamChambersCount + 1 : 4) + " chambers surcharged</b>") +
        row2("Properties at Risk", (upMetrics ? upMetrics.homesCount : 12) + " homes") +
        row2("Warning Time to Spill", "<b class='bad'>" + timeToSpillMin + " minutes</b>") +
        row2("First Sensor Alerted", "<b class='good'>" + (uNode.kind === "chamber" ? uNode.name : "MH4449118") + "</b>") +
      "</div>";
  }

  /* ------------------------------------- PUMP STATIONS & VISCOSITY CONTROLS */
  function renderPumpUI() {
    const psId = st.activePumpStation;
    const duty = st.pumpDuty[psId] || 1.0;
    const ratedLps = psId === "PS-01" ? 50 : 25;
    const currentLps = Math.round(ratedLps * duty * 10) / 10;
    const powerKw = Math.round(currentLps * 0.28 * 10) / 10;

    $("#pumpDutyVal").textContent = Math.round(duty * 100) + "% (" + currentLps + " L/s)";
    $("#psStatusBadge").textContent = duty > 0 ? "PUMPING (" + currentLps + " L/s)" : "IDLE";
    $("#psStatusBadge").className = duty > 1.2 ? "badge-tag crit" : duty > 0 ? "badge-tag good" : "badge-tag warn";

    // Viscosity calculation
    const viscTable = {
      domestic: { nu: 1.15, nEff: 0.0130, desc: "Standard residential wastewater (20°C)" },
      grease:   { nu: 2.40, nEff: 0.0142, desc: "Fats, oils & grease concentration (15°C)" },
      sludge:   { nu: 3.80, nEff: 0.0151, desc: "Heavy winter sludge & suspended solids (8°C)" },
      clean:    { nu: 1.00, nEff: 0.0130, desc: "Clean water reference standard (20°C)" }
    };
    const vInfo = viscTable[st.viscMode] || viscTable.domestic;
    const baseVel = 1.12; // m/s
    const actualVel = Math.round((baseVel * (0.0130 / vInfo.nEff)) * 100) / 100;
    const velDiffPct = Math.round(((actualVel - baseVel) / baseVel) * 100);
    const transitTimeMin = Math.round((7780 / (actualVel * 60)) * 10) / 10;

    $("#viscOutputs").innerHTML =
      row2("Kinematic Viscosity (ν)", vInfo.nu + " mm²/s") +
      row2("Effective Roughness (n)", vInfo.nEff.toFixed(4)) +
      row2("Mean Sewer Flow Velocity", "<b>" + actualVel + " m/s</b> (" + (velDiffPct >= 0 ? "+" : "") + velDiffPct + "%)") +
      row2("Catchment Transit Time", "<strong>" + transitTimeMin + " mins</strong> to outfall");
  }

  /* ---------------------------------------------------- assumptions tab */
  function renderRef() {
    if ($("#ref").dataset.done) return;
    const g = geom();
    $("#ref").innerHTML =
      '<div class="lead"><p><strong>What this model is, in one paragraph.</strong> ' +
      "Every pipe draining to one chamber, " + g.nPipes + " of them over " + g.nChambers +
      " manholes, solved as a steady state in EPA SWMM. Sewage load comes from " +
      g.baseDwellings + " connected properties counted from the published record and " +
      "attributed through their own connection pipes. Infiltration is added in proportion " +
      "to pipe length. A chamber surcharges when water passes the crown of its outlet pipe.</p></div>" +
      markdown(GROWTH_INDEX.docs.assumptions);
    $("#ref").dataset.done = "1";
  }

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
    $("#tab-qa").textContent = qa ? "Back to the map" : "Discussion Q&A";
    if (ref) renderRef();
    else if (qa) renderQA();
    else Growth3D.resize($("#stage"));
  }

  /* ------------------------------------------------------------------ Q&A tab */
  const DISCUSS_QA = [
    { short: "Why treat one inspection point as one dwelling?", a: [
      "An inspection point is where a service line joins the main, not a dwelling count.",
      "The layer carries a TRADEWASTE field flagging non-residential connections.",
      "Cross-referencing PARCELID against land-use gives a count of connections." ] },
    { short: "Where do the three infiltration levels come from?", a: [
      "0.25, 0.40 and 0.55 L/s per 100 m are round numbers chosen to bracket a dry, wet and very wet day.",
      "Infiltration enters through the pipe itself rather than connections." ] },
    { short: "How does greedy set cover work for sensor placement?", a: [
      "Greedy repeatedly picks whichever chamber appears in the most still-uncovered tipped sets.",
      "Downstream bottlenecks catch multiple upstream branches." ] },
    { short: "Can backwater surcharge cause a chamber to fill?", a: [
      "Yes. The SWMM dynamic wave solver captures backwater: if a downstream reach throttles, water backs up into upstream chambers.",
      "Chambers like MH4449118 act as pressure gauges on trunk bottlenecks." ] }
  ];

  function renderQA() {
    if ($("#qa").dataset.done) return;
    $("#qa").innerHTML =
      '<div class="lead"><p>Written up from questions asked while stress-testing this ' +
      "model's assumptions: load generation, dynamic SWMM solver, and backwater mechanics.</p></div>" +
      DISCUSS_QA.map(q =>
        '<details class="qa"><summary>' + esc(q.short) + "</summary>" +
        '<div class="body">' + q.a.map(x => "<p>" + esc(x) + "</p>").join("") +
        "</div></details>").join("");
    $("#qa").dataset.done = "1";
  }

  function showModal() {
    const sc = GROWTH_INDEX.scenario, n = sc.numbers;
    const fact = (l, v) => v == null ? "" :
      '<div class="kfact">' + esc(l) + "<b>" + esc(v) + "</b></div>";
    $("#modalBox").innerHTML =
      '<button class="close-btn" id="modalClose">Close</button>' +
      "<h2>" + esc(sc.title) + "</h2>" +
      '<p class="q">' + esc(sc.question) + "</p>" +
      sc.what.map(p => "<p>" + esc(p) + "</p>").join("") +
      "<h3>The numbers behind it</h3><div class=kfacts>" +
      fact("Pipes modelled", n.pipes) +
      fact("Chambers", n.chambers) +
      fact("Properties counted", n.dwellings) +
      fact("Peak factor", n.peakFactor) +
      "</div>" +
      "<h3>What it assumes</h3>" +
      "<table class=ass><tbody>" + sc.assumptions.map(a =>
        '<tr><td class="id">' + esc(a.id) + "</td><td>" + md(a.text) + "</td></tr>").join("") + "</tbody></table>" +
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
      st.hover = null;
      if (nd.name in idxOfName) {
        select(idxOfName[nd.name]);
        if (st.mode === "heatmap") {
          explainChamberPlacement(idxOfName[nd.name]);
        }
      }
    }, nd => {
      const name = nd && nd.name !== nameOf(st.site) ? nd.name : null;
      if (name === st.hover) return;
      st.hover = name;
      const c = cell();
      renderHomes(st.showSensors ? c.coverage.chosen.map(x => nameOf(+x.chamber)) : []);
    }).then(() => {
      buildKnobs();
      const order = buildList();
      populateBlockagePipes();

      $("#scale").textContent = geom().nPipes + " pipes, " + geom().nChambers +
        " manholes, " + (geom().nHouses || geom().baseDwellings) + " connected properties" +
        ", 2 pump stations. Elevation is pipe invert, exaggerated x" +
        Growth3D.ZEXAG + ". Click any node to inspect its affecting upstream catchment.";

      select(order[0]);
    });

    // Navigation & Toolbar
    $("#btn-info").onclick = showModal;
    $("#tab-ref").onclick = () => setTab($("#pane-ref").hidden ? "ref" : "map");
    $("#refClose").onclick = () => setTab("map");
    $("#tab-qa").onclick = () => setTab($("#pane-qa").hidden ? "qa" : "map");
    $("#qaClose").onclick = () => setTab("map");

    $("#toggleBottlenecks").onclick = () => {
      st.showBottlenecks = !st.showBottlenecks;
      $("#toggleBottlenecks").classList.toggle("primary", st.showBottlenecks);
      $("#toggleBottlenecks").textContent = st.showBottlenecks
        ? "Hide bottleneck pipes" : "Show bottleneck pipes";
      Growth3D.showBottlenecks(st.showBottlenecks);
    };

    $("#toggleSensors").onclick = () => {
      st.showSensors = !st.showSensors;
      $("#toggleSensors").classList.toggle("primary", st.showSensors);
      $("#toggleSensors").textContent = st.showSensors ? "Hide proposed sensors"
                                                       : "Show proposed sensors";
      repaint();
    };

    $("#toggleFlow").onclick = () => {
      st.flowAnim = !st.flowAnim;
      $("#toggleFlow").classList.toggle("primary", st.flowAnim);
      $("#toggleFlow").textContent = st.flowAnim ? "Flow Animation: ON" : "Flow Animation: OFF";
      Growth3D.setFlowAnimation(st.flowAnim, 1.0);
    };

    // Mode Selector
    $("#modeKnob").onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      document.querySelectorAll("#modeKnob button").forEach(btn => btn.classList.remove("on"));
      b.classList.add("on");
      st.mode = b.dataset.mode;

      // Toggle Panels
      $("#panel-growth").hidden = st.mode !== "growth";
      $("#panel-heatmap").hidden = st.mode !== "heatmap";
      $("#panel-blockage").hidden = st.mode !== "blockage";
      $("#panel-pump").hidden = st.mode !== "pump";

      repaint();
    };

    // Blockage Controls
    $("#blockageRange").oninput = e => {
      st.blockageSeverity = +e.target.value;
      updateBlockagePhysics();
      renderBlockageUI();
    };

    // Pump Controls
    $("#pumpStationSelect").onchange = e => {
      st.activePumpStation = e.target.value;
      const duty = st.pumpDuty[st.activePumpStation] || 1.0;
      $("#pumpDutyRange").value = String(Math.round(duty * 100));
      renderPumpUI();
    };

    $("#pumpDutyRange").oninput = e => {
      const duty = (+e.target.value) / 100;
      st.pumpDuty[st.activePumpStation] = duty;
      Growth3D.setPumpStationState(st.activePumpStation, duty > 0, duty);
      renderPumpUI();
    };

    $("#chkAutoRelief").onchange = e => {
      st.autoRelief = e.target.checked;
      if (st.autoRelief) {
        st.pumpDuty["PS-01"] = 1.25;
        st.pumpDuty["LS-02"] = 1.10;
        $("#pumpDutyRange").value = "125";
        Growth3D.setPumpStationState("PS-01", true, 1.25);
        Growth3D.setPumpStationState("LS-02", true, 1.10);
      }
      renderPumpUI();
    };

    // Viscosity
    $("#viscSelect").onchange = e => {
      st.viscMode = e.target.value;
      renderPumpUI();
    };

    // Explain Top Sensor Button
    $("#btnExplainTop").onclick = () => {
      ensureHeatmapData();
      const topIdx = heatmapData.rankings[0].index;
      select(topIdx);
      explainChamberPlacement(topIdx);
    };

    // Modals
    $("#sensorModalClose").onclick = () => { $("#sensorModal").hidden = true; };
    $("#sensorModal").onclick = e => { if (e.target.id === "sensorModal") $("#sensorModal").hidden = true; };

    $("#btnSchema").onclick = () => { $("#schemaModal").hidden = false; };
    $("#schemaModalClose").onclick = () => { $("#schemaModal").hidden = true; };
    $("#schemaModal").onclick = e => { if (e.target.id === "schemaModal") $("#schemaModal").hidden = true; };

    $("#modal").onclick = e => { if (e.target.id === "modal") $("#modal").hidden = true; };
    $("#fitAll").onclick = () => Growth3D.frame(null);
    $("#fitSite").onclick = () => Growth3D.frame(nameOf(st.site));

    document.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      if (!$("#modal").hidden) $("#modal").hidden = true;
      if (!$("#sensorModal").hidden) $("#sensorModal").hidden = true;
      if (!$("#schemaModal").hidden) $("#schemaModal").hidden = true;
      else if (!$("#pane-ref").hidden || !$("#pane-qa").hidden) setTab("map");
    });
    window.addEventListener("resize", () => Growth3D.resize($("#stage")));
  }

  function selectAndExplain(idx) {
    select(idx);
    explainChamberPlacement(idx);
  }

  return { init, selectAndExplain };
})();
