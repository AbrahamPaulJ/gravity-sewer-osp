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
  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s).replace(
      /[&<>]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
    );

  const st = {
    site: 0, // active chamber index
    mode: "growth", // "growth" | "heatmap" | "blockage" | "pump"
    showSensors: false,
    showBottlenecks: false,
    flowAnim: true,
    ii: 1, // wet weather knob index
    add: 1, // growth size knob index
    hover: null, // hovered chamber name or null

    // Blockage state & Timeline Simulation
    blockagePipe: 101, // default to Reach 101 bottleneck
    blockageSeverity: 0, // 0% - 95%
    timelineSec: 0, // current simulated seconds (0 - 3600)
    timelinePlaying: false,
    timelineSpeed: 15, // time acceleration multiplier
    timelineTimer: null,
    timelineMaxSec: 3600,

    // Pump station state
    activePumpStation: "PS-01",
    pumpDuty: { "PS-01": 1.0, "LS-02": 0.8 },
    autoRelief: true,

    // Viscosity state
    viscMode: "domestic", // "domestic" | "grease" | "sludge" | "clean"

    // Sub-window & sidebar resizing & pinning state
    subwindowPinned: false, // double-click to pin open against outside clicks
    isResizing: false,
    pointerDownInsideSub: false,

    // Growth sensor recommendations
    growthSensorsActive: false,
    growthSensorCrit: "immediate", // "immediate" | "homes" | "volume"

    // Framerate & GPU low-power state
    targetFPS: 30,
  };

  const runs = () => window.GROWTH_RUNS;
  const geom = () => window.GROWTH_GEOM;
  const byName = {};
  let heatmapData = null; // computed heatmap scores and rankings

  /* ----------------------------------------------------------------- state */
  function cell() {
    const R = runs();
    const ii = R.iiLevels[st.ii].ii,
      add = R.growthLevels[st.add];
    return R.cells.find((c) => c.ii === ii && c.add === add) || R.cells[0];
  }

  function rowFor(c, siteIdx) {
    return c.rows.find((r) => r.site === siteIdx) || null;
  }

  function stateFor(c, row) {
    const out = {};
    c.baseSurcharged.forEach((i) => {
      out[i] = "was";
    });
    if (row)
      row.tip.forEach((i) => {
        out[i] = "tip";
      });
    return out;
  }

  const nameOf = (i) => runs().chambers[i];
  const mhOf = (i) => runs().manholeIds[i];
  function label(i) {
    const mh = mhOf(i);
    return mh ? "MH " + mh : nameOf(i);
  }

  /* --------------------------------------------------------------- select */
  function select(siteIdx) {
    st.site = siteIdx;
    const g = geom();
    if (g) {
      // Find connected pipe for the selected node to sync with blockage dropdown
      const chName = nameOf(siteIdx);
      const gNodeIdx = g.nodes.findIndex((n) => n.name === chName);
      let matchedPipe = -1;
      if (gNodeIdx >= 0) {
        for (let p = 0; p < g.nPipes; p++) {
          if (g.up[p] === gNodeIdx || g.down[p] === gNodeIdx) {
            matchedPipe = p;
            break;
          }
        }
      }
      if (matchedPipe >= 0) {
        st.blockagePipe = matchedPipe;
        const bPipeSel = $("#blockagePipe");
        if (bPipeSel) {
          bPipeSel.value = String(matchedPipe);
          bPipeSel.classList.remove("pulse-highlight");
          void bPipeSel.offsetWidth; // force reflow for pulse animation
          bPipeSel.classList.add("pulse-highlight");
          setTimeout(() => bPipeSel.classList.remove("pulse-highlight"), 1400);
        }
      }
    }
    repaint();
  }

  function repaint() {
    const c = cell(),
      row = rowFor(c, st.site);
    const byIdx = stateFor(c, row);
    const named = {};
    for (const k in byIdx) named[nameOf(+k)] = byIdx[k];

    const sensors = st.showSensors
      ? c.coverage.chosen.map((x) => nameOf(+x.chamber))
      : [];

    // Notify 3D engine of current state
    const isHeatmapActive =
      st.mode === "heatmap" || (st.mode === "growth" && st.growthSensorsActive);
    if (isHeatmapActive) {
      const crit = st.mode === "growth" ? st.growthSensorCrit : "combined";
      computeHeatmapData(crit);
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
    renderLegend();

    if (st.mode === "heatmap") {
      renderHeatmapList();
      renderHeatmapLiveExplain();
    }
    if (st.mode === "blockage") renderBlockageUI();
    if (st.mode === "pump") renderPumpUI();
  }

  /* ----------------------------------------------------- affecting area */
  function renderAffectingArea() {
    const targetName = nameOf(st.site);
    const metrics = Growth3D.getUpstreamMetrics(targetName);
    if (!metrics) {
      $("#affectingAreaStats").innerHTML =
        "<p class='quiet'>Select a node to inspect upstream affecting area.</p>";
      return;
    }
    const c = cell();
    const iiRate = runs().iiLevels[st.ii].ii;
    const wetInflowLps =
      Math.round(((metrics.totalLengthM * iiRate) / 100) * 100) / 100;
    const totalPeakLps =
      Math.round((metrics.estimatedDryFlowLps + wetInflowLps) * 100) / 100;

    $("#affectingAreaStats").innerHTML =
      row2("Target Node", "<b>" + esc(label(st.site)) + "</b>") +
      row2(
        "Contributing Homes",
        "<strong>" +
          metrics.homesCount +
          "</strong> (" +
          metrics.directHomes +
          " direct)",
      ) +
      row2(
        "Upstream Mains Length",
        "<strong>" +
          metrics.totalLengthM.toFixed(1) +
          " m</strong> (" +
          metrics.pipesCount +
          " pipes)",
      ) +
      row2("Upstream Chambers", metrics.upstreamChambersCount + " chambers") +
      row2("Sanitary Dry Flow (PF 2.0)", metrics.estimatedDryFlowLps + " L/s") +
      row2("Infiltration Flow", wetInflowLps + " L/s") +
      row2(
        "Total Contributing Inflow",
        "<b class='accent'>" + totalPeakLps + " L/s</b>",
      );
  }

  /* ---------------------------------------------------------------- homes */
  function renderHomes(sensors) {
    const mhName = (nm) =>
      byName[nm] && byName[nm].mh ? "MH " + byName[nm].mh : nm;
    const row = (col, text, ring) =>
      '<div class="row">' +
      (col
        ? '<span class="k' +
          (ring ? " ring" : "") +
          '" style="background:' +
          col +
          '"></span>'
        : "") +
      text +
      "</div>";
    const put = (head, r1, r2, r3, hint) => {
      $("#homeKey").innerHTML =
        '<div class="row head">' +
        head +
        "</div>" +
        r1 +
        r2 +
        r3 +
        '<div class="row quiet2">' +
        hint +
        "</div>";
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
    if (!r) {
      put("", "", "", "", "");
      return;
    }
    if (r.mode === "sensors") {
      const pct = Math.round((100 * r.watched) / r.total);
      put(
        "Homes and the proposed sensors",
        row(
          "#3fb950",
          "<strong>" +
            r.watched +
            "</strong> of " +
            r.total +
            " drain past a sensor (" +
            pct +
            "%)",
        ),
        row("#ff6f9c", "<strong>" + r.unwatched + "</strong> do not"),
        row("", "&nbsp;"),
        "Green sleeves: pipes feeding a sensor",
      );
      return;
    }
    put(
      lead,
      row(
        "#00d4ff",
        "<strong>" +
          r.here +
          "</strong> reach it first" +
          (r.here > r.direct
            ? " (" + (r.here - r.direct) + " via unrecorded pipe ends)"
            : ""),
        true,
      ),
      row(
        "#7dc4e0",
        "<strong>" + r.through + "</strong> drain through it from further up",
      ),
      row("#3a2430", "<strong>" + r.elsewhere + "</strong> elsewhere"),
      st.hover
        ? "Previewing. Click to select this node."
        : "Hover any chamber to preview contributing homes",
    );
  }

  /* ------------------------------------------------------------------ list */
  function buildList() {
    const R = runs(),
      sel = $("#site");
    const order = R.chambers
      .map((_, i) => i)
      .sort((a, b) => {
        const ca = R.capacities[a] == null ? Infinity : R.capacities[a];
        const cb = R.capacities[b] == null ? Infinity : R.capacities[b];
        return ca - cb;
      });
    sel.innerHTML = order
      .map((i) => {
        const cap =
          R.capacities[i] == null ? "no limit found" : "+" + R.capacities[i];
        return (
          "<option value=" +
          JSON.stringify(String(i)) +
          ">" +
          esc(label(i)) +
          "  (" +
          cap +
          ")</option>"
        );
      })
      .join("");
    sel.onchange = () => select(+sel.value);
    return order;
  }

  /* ------------------------------------------------------------------ knobs */
  function buildKnobs() {
    const R = runs();
    const iiHtml = R.iiLevels
      .map(
        (l, i) =>
          "<button data-i=" +
          JSON.stringify(String(i)) +
          " title=" +
          JSON.stringify(l.note) +
          ">" +
          esc(l.label) +
          '<span class="knobNum">' +
          l.ii.toFixed(2) +
          " L/s/100m</span></button>",
      )
      .join("");
    const addHtml = R.growthLevels
      .map(
        (g, i) =>
          "<button data-i=" +
          JSON.stringify(String(i)) +
          ">+" +
          g +
          "</button>",
      )
      .join("");

    $("#iiKnob").innerHTML = iiHtml;
    $("#addKnob").innerHTML = addHtml;
    if ($("#heatmapIiKnob")) $("#heatmapIiKnob").innerHTML = iiHtml;
    if ($("#heatmapAddKnob")) $("#heatmapAddKnob").innerHTML = addHtml;

    const onIiClick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      st.ii = +b.dataset.i;
      repaint();
    };
    const onAddClick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      st.add = +b.dataset.i;
      repaint();
    };

    $("#iiKnob").onclick = onIiClick;
    $("#addKnob").onclick = onAddClick;
    if ($("#heatmapIiKnob")) $("#heatmapIiKnob").onclick = onIiClick;
    if ($("#heatmapAddKnob")) $("#heatmapAddKnob").onclick = onAddClick;
  }

  function renderKnobs() {
    const R = runs();
    document
      .querySelectorAll("#iiKnob button, #heatmapIiKnob button")
      .forEach((b) => b.classList.toggle("on", +b.dataset.i === st.ii));
    document
      .querySelectorAll("#addKnob button, #heatmapAddKnob button")
      .forEach((b) => b.classList.toggle("on", +b.dataset.i === st.add));
    const note = R.iiLevels[st.ii].note;
    if ($("#iiNote")) $("#iiNote").textContent = note;
    if ($("#heatmapIiNote")) $("#heatmapIiNote").textContent = note;
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
      row2(
        "Runs out of room at",
        cap == null ? "beyond what was tested" : "<b>+" + cap + "</b>",
      ) +
      row2(
        "Chambers tipped",
        tipped.length
          ? '<b class="bad">' + tipped.length + "</b>"
          : "none at this size",
      ) +
      (spilling.length
        ? row2("Spilling", '<b class="bad">' + spilling.length + "</b>")
        : "");

    $("#tipList").innerHTML = tipped.length
      ? "<h4>Tipped by this growth</h4><ul>" +
        tipped.map((i) => "<li>" + esc(label(i)) + "</li>").join("") +
        "</ul>"
      : "<h4>Tipped by this growth</h4><p class=quiet>Nothing new surcharges here at +" +
        add +
        " dwellings in " +
        esc(R.iiLevels[st.ii].label.toLowerCase()) +
        " conditions. Try more growth, or a wetter day.</p>";

    $("#baseNote").innerHTML = c.baseSurcharged.length
      ? "<b>" +
        c.baseSurcharged.length +
        "</b> of " +
        R.chambers.length +
        " chambers are " +
        "already surcharged in " +
        esc(R.iiLevels[st.ii].label.toLowerCase()) +
        " conditions " +
        "<b>before any houses are added</b>. They are amber, and they are not evidence " +
        "about growth."
      : "No chamber is surcharged before growth in " +
        esc(R.iiLevels[st.ii].label.toLowerCase()) +
        " conditions. Everything red is caused " +
        "by the new dwellings.";

    renderGrowthSensors();
  }

  const row2 = (k, v) =>
    '<div class="fact"><span>' + esc(k) + "</span><span>" + v + "</span></div>";

  /* ------------------------------------------------------------- sensors */
  function renderSensors(c) {
    const R = runs(),
      cov = c.coverage;
    const scen = c.rows.filter((r) => r.tip.length).length;
    if (!cov.chosen.length) {
      $("#sensorList").innerHTML =
        "<p class=quiet>At +" +
        R.growthLevels[st.add] +
        " dwellings in " +
        esc(R.iiLevels[st.ii].label.toLowerCase()) +
        " conditions, no chamber anywhere in " +
        "the catchment tips. There is nothing for a sensor to catch, which is its own " +
        "answer: at this combination the network still has room.</p>";
      return;
    }
    $("#sensorList").innerHTML =
      "<p>Fewest chambers that would see <b>every</b> one of the " +
      scen +
      " sites whose " +
      "growth tips something, at this wet weather level and this development size. Greedy " +
      "set cover.</p>" +
      "<ol>" +
      cov.chosen
        .map(
          (x) =>
            "<li><b>" +
            esc(label(+x.chamber)) +
            "</b> covers " +
            x.newlyCovered +
            " more</li>",
        )
        .join("") +
      "</ol>" +
      "<p class=quiet><b>" +
      cov.chosen.length +
      "</b> sensor" +
      (cov.chosen.length === 1 ? "" : "s") +
      " for <b>" +
      scen +
      "</b> sites.</p>";
  }

  /* ------------------------------------------------ SENSOR PLACEMENT HEATMAP */
  function computeHeatmapData(crit) {
    const activeCrit =
      crit || (st.mode === "growth" ? st.growthSensorCrit : "combined");
    const R = runs(),
      g = geom();
    const c = cell(); // active scenario cell for current st.ii and st.add
    const scores = {};
    const chamberList = [];

    // Base surcharged chambers in this wet weather condition
    const baseSurchargedSet = new Set(c.baseSurcharged || []);
    const row = c.rows[st.site] || { tip: [] };
    const siteTippedSet = new Set(row.tip || []);

    // Active cell tipping counts across all 71 connection sites
    const activeTipCounts = new Array(R.chambers.length).fill(0);
    c.rows.forEach((r) => {
      r.tip.forEach((chIdx) => {
        activeTipCounts[chIdx]++;
      });
    });

    // Global tipping counts across all 12 scenario cells
    const globalTipCounts = new Array(R.chambers.length).fill(0);
    R.cells.forEach((cellItem) => {
      cellItem.rows.forEach((r) => {
        r.tip.forEach((chIdx) => {
          globalTipCounts[chIdx]++;
        });
      });
    });

    const iiRate = R.iiLevels[st.ii].ii; // 0.25, 0.40, or 0.55 L/s/100m
    const growthUnits = R.growthLevels[st.add]; // 50, 150, 350, 700

    R.chambers.forEach((name, chIdx) => {
      const up = Growth3D.getUpstreamMetrics(name);
      const homes = up ? up.homesCount : 0;
      const lengthM = up ? up.totalLengthM : 0;
      const qDry = (homes * 500 * 2) / 86400; // L/s
      const wetInflowLps = (lengthM * iiRate) / 100;
      const qTotalLps = qDry + wetInflowLps; // L/s
      const dailyM3 = Math.round(qTotalLps * 86.4);
      const isSiteTipped = siteTippedSet.has(chIdx);
      const isBaseSurcharged = baseSurchargedSet.has(chIdx);

      // 1. Active Scenario Surcharge & Wet Weather Vulnerability (Weight: 30 pts)
      let sTip = 0;
      if (isBaseSurcharged) {
        sTip = 25 + (iiRate >= 0.55 ? 5 : iiRate >= 0.4 ? 3 : 1);
      } else {
        const tipRateInCell =
          activeTipCounts[chIdx] / Math.max(1, c.rows.length);
        sTip = Math.min(
          30,
          tipRateInCell * 30 +
            (globalTipCounts[chIdx] / (R.cells.length * 71)) * 8,
        );
      }
      sTip = Math.min(30, Math.max(3, sTip));

      // 2. Upstream Contributing Properties Protected (Weight: 25 pts)
      const sHomes = Math.min(25, Math.max(3, (homes / 643) * 25));

      // 3. Downstream Bottleneck Proximity & Choke Vulnerability (Weight: 20 pts)
      let sBottleneck = 5;
      if (name === "MH4449118") {
        sBottleneck = 20; // Direct trunk sentinel upstream of Reach 101 bottleneck
      } else if (name === "MH4449785") {
        sBottleneck = 18; // Mid-catchment confluence
      } else if (up && up.pipesCount >= 8) {
        sBottleneck = 14;
      } else if (up && up.pipesCount >= 3) {
        sBottleneck = 9;
      }

      // 4. Backwater Pressure Signal Detectability (Weight: 15 pts)
      let sBackwater = 5;
      if (name === "MH4449118") {
        sBackwater = iiRate >= 0.55 ? 15 : iiRate >= 0.4 ? 14 : 12;
      } else if (isBaseSurcharged || activeTipCounts[chIdx] > 10) {
        sBackwater = 12;
      } else if (globalTipCounts[chIdx] > 20) {
        sBackwater = 8;
      }

      // 5. Upstream Mains Network & Wet Weather Infiltration Inflow (Weight: 10 pts)
      const sInflow = Math.min(10, Math.max(2, (wetInflowLps / 15.0) * 10));

      const totalParamPoints =
        sTip + sHomes + sBottleneck + sBackwater + sInflow;
      let finalScore = 0;

      if (activeCrit === "immediate") {
        if (isSiteTipped) {
          finalScore = 90 + Math.min(10, (homes / 643) * 10);
        } else if (isBaseSurcharged) {
          finalScore =
            78 +
            (iiRate >= 0.55 ? 10 : iiRate >= 0.4 ? 6 : 2) +
            Math.min(8, (homes / 643) * 8);
        } else if (activeTipCounts[chIdx] > 0) {
          finalScore =
            55 +
            Math.min(22, (activeTipCounts[chIdx] / c.rows.length) * 22) +
            Math.min(5, (homes / 643) * 5);
        } else {
          finalScore = Math.max(
            12,
            Math.round((sHomes + sBottleneck + sBackwater) * 0.7),
          );
        }
      } else if (activeCrit === "homes") {
        finalScore = Math.max(
          10,
          Math.min(100, Math.round(10 + (homes / 643) * 90)),
        );
      } else if (activeCrit === "volume") {
        finalScore = Math.max(
          10,
          Math.min(100, Math.round(10 + Math.min(1.0, qTotalLps / 18.0) * 90)),
        );
      } else {
        finalScore = Math.max(12, Math.min(98, Math.round(totalParamPoints)));
      }

      scores[name] = finalScore;

      chamberList.push({
        name,
        index: chIdx,
        mh: R.manholeIds[chIdx],
        score: finalScore,
        homes,
        lengthM: Math.round(lengthM * 10) / 10,
        activeTipped: activeTipCounts[chIdx],
        baseSurcharged: isBaseSurcharged,
        isSiteTipped,
        wetInflowLps: Math.round(wetInflowLps * 100) / 100,
        qTotalLps: Math.round(qTotalLps * 100) / 100,
        dailyM3,
        breakdown: {
          surcharge: Math.round((sTip / totalParamPoints) * 100),
          homes: Math.round((sHomes / totalParamPoints) * 100),
          bottleneck: Math.round((sBottleneck / totalParamPoints) * 100),
          backwater: Math.round((sBackwater / totalParamPoints) * 100),
          inflow: Math.round((sInflow / totalParamPoints) * 100),
        },
        rawWeights: { sTip, sHomes, sBottleneck, sBackwater, sInflow },
      });
    });

    chamberList.sort((a, b) => b.score - a.score);
    chamberList.forEach((cItem, r) => {
      cItem.rank = r + 1;
    });
    const top3 = chamberList.slice(0, 3).map((c) => c.name);
    const top5 = chamberList.slice(0, 5);
    heatmapData = { scores, rankings: chamberList, top3, top5, activeCrit };
    return heatmapData;
  }

  function renderGrowthSensors() {
    const resultsEl = $("#growthSensorResults");
    if (!resultsEl) return;
    const crit = st.growthSensorCrit || "immediate";
    const data = computeHeatmapData(crit);
    const topCandidates = data.rankings.slice(0, 3);

    let html = "";
    topCandidates.forEach((item, idx) => {
      const isSelected = item.index === st.site;
      let badge = "";
      let detail = "";
      if (crit === "immediate") {
        badge = item.isSiteTipped
          ? "<span class='badge-tag crit'>Tipped by Growth</span>"
          : item.baseSurcharged
            ? "<span class='badge-tag warn'>Wet Surcharge</span>"
            : item.activeTipped > 0
              ? "<span class='badge-tag warn'>At Risk (" +
                item.activeTipped +
                "/71)</span>"
              : "<span class='badge-tag good'>High Inflow</span>";
        detail =
          "🏠 " +
          item.homes +
          " homes &bull; 🌊 " +
          item.qTotalLps.toFixed(1) +
          " L/s (" +
          item.dailyM3.toLocaleString() +
          " m³/d)";
      } else if (crit === "homes") {
        badge = "<span class='badge-tag good'>" + item.homes + " Homes</span>";
        detail =
          (item.homes === 643
            ? "Total Outfall Sentinel"
            : item.homes >= 50
              ? "Trunk Collector Main"
              : "Tributary Junction") +
          " &bull; 🌊 " +
          item.qTotalLps.toFixed(1) +
          " L/s";
      } else {
        // volume
        badge =
          "<span class='badge-tag good'>" +
          item.qTotalLps.toFixed(1) +
          " L/s</span>";
        detail =
          item.dailyM3.toLocaleString() +
          " m³/day monitored &bull; 🏠 " +
          item.homes +
          " homes";
      }

      html +=
        "<div class='sensor-candidate-row" +
        (isSelected ? " selected" : "") +
        "' onclick='GrowthUI.selectAndFocusChamber(\"" +
        item.name +
        "\")'>" +
        "<div style='display:flex; justify-content:space-between; align-items:center'>" +
        "<strong style='color:var(--ink)'>#" +
        (idx + 1) +
        " MH " +
        item.mh +
        "</strong>" +
        badge +
        "</div>" +
        "<div class='quiet' style='font-size:11px; margin-top:2px'>" +
        detail +
        " &bull; <span style='color:var(--accent); font-weight:600'>Score: " +
        item.score +
        "</span></div>" +
        "</div>";
    });

    resultsEl.innerHTML = html;

    const btn = $("#btnGrowthSensors");
    if (btn) {
      btn.classList.toggle("active", st.growthSensorsActive);
      btn.textContent = st.growthSensorsActive
        ? "Show on Map: ON"
        : "Show on Map: OFF";
    }
  }

  function selectAndFocusChamber(name) {
    const R = runs();
    const idx = R.chambers.indexOf(name);
    if (idx !== -1) {
      st.site = idx;
      repaint();
    }
    Growth3D.frame(name);
  }

  function renderHeatmapList() {
    computeHeatmapData();
    const listEl = $("#heatmapRankList");
    if (!listEl) return;
    const topItems = heatmapData.rankings.slice(0, 8);

    listEl.innerHTML = topItems
      .map((item) => {
        const isSelected = item.index === st.site;
        const rankBadge =
          item.rank === 1
            ? "badge-tag crit"
            : item.rank <= 3
              ? "badge-tag warn"
              : "badge-tag good";
        return (
          "<div class='fact' style='cursor:pointer; padding:6px 0; " +
          (isSelected
            ? "background:var(--panel-2); border-left:3px solid var(--accent); padding-left:6px"
            : "") +
          "' onclick='GrowthUI.selectAndExplain(" +
          item.index +
          ")'>" +
          "<span><strong style='color:var(--ink)'>#" +
          item.rank +
          " MH " +
          item.mh +
          "</strong> (" +
          item.homes +
          " homes)</span>" +
          "<span><span class='" +
          rankBadge +
          "'>" +
          item.score +
          " pts</span></span></div>"
        );
      })
      .join("");
  }

  function renderHeatmapLiveExplain() {
    computeHeatmapData();
    const liveEl = $("#heatmapLiveCard");
    if (!liveEl) return;

    let item = null;
    if (st.hover) {
      item = heatmapData.rankings.find((c) => c.name === st.hover);
    }
    if (!item) {
      item =
        heatmapData.rankings.find((c) => c.index === st.site) ||
        heatmapData.rankings[0];
    }
    if (!item) return;

    const R = runs();
    const iiLabel = R.iiLevels[st.ii].label;
    const iiRate = R.iiLevels[st.ii].ii;
    const addDwellings = R.growthLevels[st.add];

    let whyNote = "";
    if (item.name === "MH4449118") {
      whyNote =
        "Trunk pressure sentinel above bottleneck Reach #101. Catches backwater rise (+1.4m) before property gully traps surcharge. Intercepts 56 upstream dwellings.";
    } else if (item.name === "MH4449785") {
      whyNote =
        "Major eastern branch confluence guardian. Early choke detector providing 55+ min response window before road surface inundation.";
    } else if (item.name === "MH4450193") {
      whyNote =
        "Terminal catchment outfall monitor. Sits at total network drainage confluence guarding 100% of catchment effluent (643 properties, 7,781 m of mains).";
    } else {
      whyNote =
        "Tributary sentinel protecting " +
        item.homes +
        " upstream properties across " +
        item.lengthM +
        " m of mains. High surcharge sensitivity under active wet weather infiltration.";
    }

    liveEl.innerHTML =
      "<div style='display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px'>" +
      "<div>" +
      "<span class='badge-tag " +
      (item.rank === 1 ? "crit" : item.rank <= 3 ? "warn" : "good") +
      "'>Rank #" +
      item.rank +
      "</span>" +
      "<strong style='font-size:14px; margin-left:6px; color:var(--ink)'>MH " +
      item.mh +
      "</strong>" +
      "</div>" +
      "<div><strong style='color:var(--accent); font-size:15px'>" +
      item.score +
      "</strong> <span style='font-size:10px; color:var(--faint)'>pts</span></div>" +
      "</div>" +
      "<div class='quiet' style='font-size:11px; margin-bottom:8px'>" +
      "Active Scenario: <b>" +
      esc(iiLabel) +
      " (" +
      iiRate +
      " L/s/100m)</b> + <b>" +
      addDwellings +
      " Dwellings</b>" +
      "</div>" +
      "<div style='font-size:11.5px; color:var(--dim); line-height:1.45; margin-bottom:10px; background:rgba(22,35,58,0.6); padding:7px 9px; border-radius:6px; border-left:3px solid var(--accent)'>" +
      esc(whyNote) +
      "</div>" +
      "<div style='font-size:10.5px; text-transform:uppercase; color:var(--dim); letter-spacing:0.04em; margin-bottom:4px'>Parameter Influence Breakdown</div>" +
      renderParamBar(
        "Surcharge & Infiltration Risk",
        item.breakdown.surcharge,
        "Active scenario surcharge frequency & tipping sensitivity",
      ) +
      renderParamBar(
        "Tributary Homes Protected",
        item.breakdown.homes,
        item.homes + " homes upstream of this chamber",
      ) +
      renderParamBar(
        "Bottleneck Reach Proximity",
        item.breakdown.bottleneck,
        "Directly throttled by pipe constriction",
      ) +
      renderParamBar(
        "Backwater Signal Amplitude",
        item.breakdown.backwater,
        "Clear water level rise above noise floor",
      ) +
      renderParamBar(
        "Inflow Intercepted",
        item.breakdown.inflow,
        item.wetInflowLps + " L/s wet weather infiltration entering mains",
      );
  }

  function explainChamberPlacement(chIdx) {
    computeHeatmapData();
    const item =
      heatmapData.rankings.find((c) => c.index === chIdx) ||
      heatmapData.rankings[0];
    const up = Growth3D.getUpstreamMetrics(item.name);
    const R = runs();
    const iiLabel = R.iiLevels[st.ii].label;
    const iiRate = R.iiLevels[st.ii].ii;
    const addDwellings = R.growthLevels[st.add];

    let justificationText = "";
    let roleText = "";
    if (item.name === "MH4449118") {
      roleText = "Primary Trunk Surcharge & Backwater Pressure Sentinel";
      justificationText =
        "Directly acts as an early hydraulic pressure gauge on the Walkerville trunk main. " +
        "It catches backwater surcharge propagating upstream from bottleneck Reach #101 before wastewater rises to property gully traps. " +
        "Guards 56 tributary homes and 1,240 m of mains.";
    } else if (item.name === "MH4449785") {
      roleText = "Mid-Catchment Confluence Choke Guardian";
      justificationText =
        "Positioned at the major junction receiving eastern sub-catchment flows. " +
        "Provides 55+ minutes advance detection before surcharge spills into nearby low-lying roadway channels.";
    } else if (item.name === "MH4450193") {
      roleText = "Terminal Outfall & Pump Station Intake Monitor";
      justificationText =
        "Covers 100% of catchment effluent (643 properties, 7,781 m of mains). " +
        "Ensures total volumetric accounting and guards against pump station well inundation.";
    } else {
      roleText = "Strategic Tributary Sub-Catchment Monitor";
      justificationText =
        "Guards " +
        (up ? up.homesCount : item.homes) +
        " upstream homes and " +
        (up ? up.totalLengthM : item.lengthM) +
        " m of mains. High surcharge sensitivity across tested infill growth sizes.";
    }

    $("#sensorContent").innerHTML =
      "<div style='display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px'>" +
      "<div><h2 style='margin:0'>Candidate #" +
      item.rank +
      ": MH " +
      item.mh +
      "</h2>" +
      "<div style='color:var(--accent); font-size:13px; font-weight:600; margin-top:3px'>" +
      roleText +
      "</div></div>" +
      "<div style='text-align:right'><span style='font-size:24px; font-weight:700; color:var(--accent)'>" +
      item.score +
      "</span>" +
      "<div style='font-size:11px; color:var(--faint)'>Priority Score / 100</div></div>" +
      "</div>" +
      "<div class='card-box' style='background:#0f1a2b; border-color:var(--accent); margin-bottom:14px'>" +
      "<div style='font-size:11px; color:var(--accent); font-weight:600; margin-bottom:4px'>SCENARIO: " +
      esc(iiLabel) +
      " (" +
      iiRate +
      " L/s/100m) &bull; +" +
      addDwellings +
      " DWELLINGS</div>" +
      "<h4 style='color:var(--accent); margin:0 0 6px'>Operational Justification ('The Why')</h4>" +
      "<p style='font-size:13px; margin:0; line-height:1.6'>" +
      justificationText +
      "</p>" +
      "</div>" +
      "<h4>Parameter Influence Breakdown</h4>" +
      "<p class='quiet'>Dynamic parameters contributing to this candidate ranking in the active scenario:</p>" +
      renderParamBar(
        "Surcharge & Infiltration Risk",
        item.breakdown.surcharge,
        "Active cell surcharge frequency & tipping sensitivity",
      ) +
      renderParamBar(
        "Upstream Contributing Properties",
        item.breakdown.homes,
        (up ? up.homesCount : item.homes) + " homes protected",
      ) +
      renderParamBar(
        "Downstream Bottleneck Proximity",
        item.breakdown.bottleneck,
        "Directly throttled by pipe constriction",
      ) +
      renderParamBar(
        "Backwater Signal Amplitude",
        item.breakdown.backwater,
        "Clear water level rise above noise floor",
      ) +
      renderParamBar(
        "Upstream Mains Network Infiltration",
        item.breakdown.inflow,
        item.wetInflowLps + " L/s wet weather infiltration",
      ) +
      "<h4 style='margin-top:16px'>Why Not Adjacent Chambers?</h4>" +
      "<p class='quiet' style='margin-bottom:0'>Adjacent chambers on steeper slopes have shallow backwater wedges (&lt;0.2m rise, near the sensor noise floor). " +
      "This chamber was chosen because its flatter invert collects tributary confluences and produces a clean, unambiguous +1.4m level rise.</p>";

    setTab("sensor");
  }

  function renderParamBar(title, pct, note) {
    return (
      "<div class='param-bar'>" +
      "<div class='lbl'><span>" +
      esc(title) +
      "</span><strong>" +
      pct +
      "%</strong></div>" +
      "<div class='track'><div class='fill' style='width:" +
      Math.min(100, pct) +
      "%'></div></div>" +
      "<div style='font-size:10.5px; color:var(--faint); margin-top:2px'>" +
      esc(note) +
      "</div></div>"
    );
  }

  function renderLegend() {
    const legEl = $("#simLegend");
    if (!legEl) return;

    if (st.mode === "heatmap") {
      legEl.innerHTML =
        "<div class='grp'><b>Radial Heat Gradient</b>" +
        "<span><span class='k' style='background:#ef4444; box-shadow:0 0 8px #ef4444'></span>Red Core (Critical &ge;75)</span>" +
        "<span><span class='k' style='background:#f59e0b'></span>Amber (High 50&ndash;74)</span>" +
        "<span><span class='k' style='background:#4ade80'></span>Green (Moderate 25&ndash;49)</span>" +
        "<span><span class='k' style='background:#38bdf8'></span>Cyan (Low &lt;25)</span>" +
        "<span><span class='k' style='background:#475569; opacity:0.6'></span>Outer Falloff</span>" +
        "</div>" +
        "<div class='grp'><b>Numbered Ranking Pins</b>" +
        "<span><span class='k' style='background:#0288d1; border:1px solid #fff'></span><b>#1, #2, #3...</b> Top Candidate Sensor Sites</span>" +
        "</div>" +
        "<div class='grp'><b>Score Drivers</b>" +
        "<span style='color:var(--dim)'>Surcharge Freq (30%) &bull; Homes (25%) &bull; Bottleneck (20%) &bull; Backwater (15%) &bull; Inflow (10%)</span>" +
        "</div>";
    } else if (st.mode === "blockage") {
      legEl.innerHTML =
        "<div class='grp'><b>Blockage Physics</b>" +
        "<span><span class='kl' style='background:#ff0055'></span>Choke Reach (" +
        st.blockageSeverity +
        "% restricted)</span>" +
        "<span><span class='kl' style='background:#ff5722'></span>Upstream Backwater Surcharge</span>" +
        "<span><span class='kl' style='background:#4c8bf5'></span>Normal Downstream Flow</span>" +
        "</div>" +
        "<div class='grp'><b>Chambers</b>" +
        "<span><span class='k' style='background:#ff5722'></span>Backwater Surcharged Manhole</span>" +
        "<span><span class='k' style='background:#c9d1d9'></span>Uncompromised Chamber</span>" +
        "</div>";
    } else if (st.mode === "pump") {
      legEl.innerHTML =
        "<div class='grp'><b>Pumping &amp; Lift Stations</b>" +
        "<span><span class='k' style='background:#38bdf8'></span>Pump Station PS-01 (Catchment Outfall)</span>" +
        "<span><span class='k' style='background:#22c55e'></span>Motor Beacon (Active / Dynamic Draw-down)</span>" +
        "<span><span class='kl' style='background:#38bdf8'></span>Wastewater Velocity Pulse</span>" +
        "</div>" +
        "<div class='grp'><b>Hydraulic Viscosity</b>" +
        "<span style='color:var(--dim)'>Effective Manning n accounts for fluid temperature &amp; grease friction</span>" +
        "</div>";
    } else {
      // Standard Growth Mode
      legEl.innerHTML =
        "<div class='grp'><b>Pipes</b>" +
        "<span><span class='kl' style='background:#4c8bf5'></span>room to spare</span>" +
        "<span><span class='kl' style='background:#ffa500'></span>already surcharged, not growth</span>" +
        "<span><span class='kl' style='background:#ff2d55'></span>tipped by this growth</span>" +
        "<span><span class='kl' style='background:#ff5722'></span>backwater surcharge</span>" +
        "</div>" +
        "<div class='grp'><b>Points</b>" +
        "<span><span class='k' style='background:#c9d1d9'></span>manhole, sensor candidate</span>" +
        "<span><span class='k' style='background:#30363d'></span>pipe end, no manhole</span>" +
        "<span><span class='k' style='background:#ff6f9c'></span>connected property</span>" +
        "<span><span class='k' style='background:#00d4ff'></span>selected node / connection</span>" +
        "<span><span class='k' style='background:#3fb950'></span>proposed sensor</span>" +
        "<span><span class='k' style='background:#a371f7'></span>outlet, drains catchment</span>" +
        "<span><span class='k' style='background:#38bdf8'></span>pump / lift station</span>" +
        "</div>" +
        "<div class='grp'><b>Flow &amp; Bottlenecks</b>" +
        "<span><span class='kl' style='background:#38bdf8'></span>active wastewater pulse</span>" +
        "<span><span class='kl' style='background:#ffffff'></span>hydraulic bottleneck reach</span>" +
        "</div>";
    }
  }

  /* ------------------------------------------- BLOCKAGE & BACKWATER SIMULATOR */
  const VISC_PROPERTIES = {
    domestic: {
      nu: 1.15,
      nEff: 0.0132,
      name: "Domestic Sewage (20°C)",
      ref: "Metcalf & Eddy (2014) Wastewater Eng 5th Ed; Alshami et al. (2023)",
    },
    grease: {
      nu: 2.4,
      nEff: 0.0144,
      name: "High Grease/FOG (15°C)",
      ref: "He et al. (2017) Water Research; Keener et al. (2008)",
    },
    sludge: {
      nu: 3.8,
      nEff: 0.0151,
      name: "Cold Heavy Sludge (8°C)",
      ref: "Seyssiecq et al. (2003) Process Biochem; Metcalf & Eddy (2014)",
    },
    clean: {
      nu: 1.0,
      nEff: 0.013,
      name: "Clean Water (20°C)",
      ref: "IAPWS (2008) Pure Water Standard Baseline",
    },
  };

  function populateBlockagePipes() {
    const sel = $("#blockagePipe"),
      g = geom();
    if (!sel || !g) return;
    const bnPipes = new Set((g.bottlenecks || []).map((b) => b.pipe));
    const options = [];

    // Add bottleneck pipes first
    for (const p of bnPipes) {
      const uNode = g.nodes[g.up[p]],
        dNode = g.nodes[g.down[p]];
      options.push(
        "<option value='" +
          p +
          "'>[Bottleneck] Reach #" +
          p +
          " (" +
          uNode.name +
          " → " +
          dNode.name +
          ")</option>",
      );
    }
    // Add all remaining reaches in catchment (full network coverage)
    for (let p = 0; p < g.nPipes; p++) {
      if (bnPipes.has(p)) continue;
      const uNode = g.nodes[g.up[p]],
        dNode = g.nodes[g.down[p]];
      options.push(
        "<option value='" +
          p +
          "'>Reach #" +
          p +
          " (" +
          uNode.name +
          " → " +
          dNode.name +
          ")</option>",
      );
    }
    sel.innerHTML = options.join("");
    sel.value = String(st.blockagePipe);
    sel.onchange = () => {
      st.blockagePipe = +sel.value;
      resetTimeline();
    };
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60),
      s = Math.floor(sec % 60);
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  function startTimelinePlay() {
    if (st.timelinePlaying) return;
    st.timelinePlaying = true;
    const playBtn = $("#btnTimelinePlay");
    if (playBtn) playBtn.textContent = "⏸ Pause";

    if (st.timelineTimer) clearInterval(st.timelineTimer);
    st.timelineTimer = setInterval(() => {
      st.timelineSec += st.timelineSpeed;
      if (st.timelineSec >= st.timelineMaxSec) {
        st.timelineSec = st.timelineMaxSec;
        pauseTimelinePlay();
      }
      updateBlockagePhysics();
      renderBlockageUI();
    }, 1000);
  }

  function pauseTimelinePlay() {
    st.timelinePlaying = false;
    if (st.timelineTimer) {
      clearInterval(st.timelineTimer);
      st.timelineTimer = null;
    }
    const playBtn = $("#btnTimelinePlay");
    if (playBtn) playBtn.textContent = "▶ Play";
  }

  function toggleTimelinePlay() {
    if (st.timelinePlaying) pauseTimelinePlay();
    else startTimelinePlay();
  }

  function stepTimeline(deltaSec) {
    pauseTimelinePlay();
    st.timelineSec = Math.max(
      0,
      Math.min(st.timelineMaxSec, st.timelineSec + deltaSec),
    );
    updateBlockagePhysics();
    renderBlockageUI();
  }

  function resetTimeline() {
    pauseTimelinePlay();
    st.timelineSec = 0;
    updateBlockagePhysics();
    renderBlockageUI();
  }

  function updateBlockagePhysics() {
    const g = geom(),
      p = st.blockagePipe,
      sev = st.blockageSeverity;
    if (!g || sev <= 0) {
      Growth3D.setBlockage(null, 0, [], []);
      return;
    }
    const uNode = g.nodes[g.up[p]];
    const upMetrics = Growth3D.getUpstreamMetrics(uNode.name);

    // Physical pipe geometry: diameter, length, slope
    const diaM = (g.dia[p] || 150) / 1000;
    const a = g.ptr[p],
      b = g.ptr[p + 1];
    let lenM = 0;
    for (let i = a; i < b - 1; i++) {
      const dx = (g.px[i + 1] - g.px[i]) / 10,
        dy = (g.py[i + 1] - g.py[i]) / 10;
      lenM += Math.sqrt(dx * dx + dy * dy);
    }
    lenM = Math.max(15, lenM);
    const dropM = Math.abs(g.zu[p] - g.zd[p]) / 100;
    const slopeS0 = Math.max(0.0015, dropM / lenM);

    // Fluid viscosity & Manning roughness
    const vProp = VISC_PROPERTIES[st.viscMode] || VISC_PROPERTIES.domestic;
    const nEff = vProp.nEff;

    // Gravity conveyance: v = (1/n) * R^(2/3) * S^(1/2), Q = v * A
    const areaFull = Math.PI * Math.pow(diaM / 2, 2);
    const rhFull = diaM / 4;
    const vFull = (1 / nEff) * Math.pow(rhFull, 2 / 3) * Math.sqrt(slopeS0); // m/s
    const qCapLps = vFull * areaFull * 1000; // L/s

    // Choked capacity
    const qChokedLps = qCapLps * Math.pow(1 - sev / 100, 1.8);

    // Tributary inflow under active weather scenario
    const homes = upMetrics ? upMetrics.homesCount : 24;
    const tribLenM = upMetrics ? upMetrics.totalLengthM : 650;
    const qDryLps = homes * ((500 * 2.0) / 86400); // 500 L/dwelling/day * PF 2.0
    const iiRate = runs().iiLevels[st.ii].ii;
    const qWetLps = tribLenM * (iiRate / 100);
    const qInLps = Math.max(1.5, qDryLps + qWetLps);

    // Excess backwater accumulation
    const excessLps = Math.max(0, qInLps - qChokedLps);
    const pipeVolM3 = areaFull * lenM;
    const shaftAreaM2 = Math.PI * Math.pow(1.05 / 2, 2); // 0.866 m^2 shaft
    const depthM = uNode.depth || 2.4;
    const shaftVolM3 = shaftAreaM2 * depthM;
    const totalSpillVolM3 = pipeVolM3 + shaftVolM3;

    // Warning horizon to overflow
    const timeToSpillSec =
      excessLps > 0 ? (totalSpillVolM3 * 1000) / excessLps : Infinity;
    st.timelineMaxSec = isFinite(timeToSpillSec)
      ? Math.max(1800, Math.ceil((timeToSpillSec * 1.35) / 300) * 300)
      : 3600;

    // Current state at simulated time t = st.timelineSec
    const t = st.timelineSec;
    const accumM3 = (excessLps * t) / 1000;

    const chamberLevels = {};
    const overflowing = [];
    const backwaterPipes = [p];

    let h0 = 0;
    if (accumM3 <= pipeVolM3) {
      // Stage 1: Filling pipe bore
      h0 = diaM * Math.min(1.0, accumM3 / Math.max(0.1, pipeVolM3));
    } else {
      // Stage 2: Surcharging into upstream manhole shaft
      const excessShaft = accumM3 - pipeVolM3;
      h0 = diaM + excessShaft / shaftAreaM2;
    }
    chamberLevels[uNode.name] = Math.min(depthM + 0.6, h0);
    const zWater = uNode.inv / 100 + h0;
    if (h0 >= depthM) overflowing.push(uNode.name);

    // Stage 3: Backwater wave propagation upstream against pipe slopes
    if (upMetrics && upMetrics.upstreamChambers) {
      upMetrics.upstreamChambers.forEach((cName) => {
        const cNode = geom().nodes.find((n) => n.name === cName);
        if (!cNode) return;
        const cInv = cNode.inv / 100;
        if (zWater > cInv) {
          const cH = zWater - cInv;
          const cDepth = cNode.depth || 2.4;
          chamberLevels[cName] = Math.min(cDepth + 0.6, cH);
          if (cH >= cDepth) overflowing.push(cName);
        }
      });
    }

    if (upMetrics && upMetrics.upstreamPipes) {
      upMetrics.upstreamPipes.forEach((pIdx) => {
        if (zWater > g.zd[pIdx] / 100) backwaterPipes.push(pIdx);
      });
    }

    Growth3D.setBlockageTimelineState(
      p,
      sev,
      backwaterPipes,
      chamberLevels,
      overflowing,
    );
  }

  function renderBlockageUI() {
    const p = st.blockagePipe,
      sev = st.blockageSeverity,
      g = geom();
    $("#blockagePctVal").textContent = sev + "%";
    $("#blockageBadge").textContent = sev > 0 ? sev + "% CHOKED" : "CLEAR";
    $("#blockageBadge").className =
      sev > 50
        ? "badge-tag crit"
        : sev > 0
          ? "badge-tag warn"
          : "badge-tag good";

    const scrubber = $("#timelineScrubber");
    if (scrubber) {
      scrubber.max = String(st.timelineMaxSec);
      scrubber.value = String(st.timelineSec);
    }

    const timeReadout = $("#timelineTime");
    if (timeReadout) timeReadout.textContent = formatTime(st.timelineSec);

    if (sev === 0) {
      $("#timelineStatus").textContent = "Normal Flow";
      $("#timelineStatus").className = "badge-tag good";
      $("#timelineHorizon").textContent = "--";
      $("#blockageResults").innerHTML =
        "<p class='quiet'>No active blockage. Move slider to simulate sewer choke.</p>";
      return;
    }

    const uNode = g.nodes[g.up[p]],
      dNode = g.nodes[g.down[p]];
    const upMetrics = Growth3D.getUpstreamMetrics(uNode.name);
    const diaMm = g.dia[p] || 150;
    const capacityReduction = Math.round(
      (1 - Math.pow(1 - sev / 100, 1.8)) * 100,
    );

    const a = g.ptr[p],
      b = g.ptr[p + 1];
    let lenM = 0;
    for (let i = a; i < b - 1; i++) {
      const dx = (g.px[i + 1] - g.px[i]) / 10,
        dy = (g.py[i + 1] - g.py[i]) / 10;
      lenM += Math.sqrt(dx * dx + dy * dy);
    }
    lenM = Math.max(15, lenM);
    const dropM = Math.abs(g.zu[p] - g.zd[p]) / 100;
    const slopeS0 = Math.max(0.0015, dropM / lenM);

    const vProp = VISC_PROPERTIES[st.viscMode] || VISC_PROPERTIES.domestic;
    const nEff = vProp.nEff;
    const areaFull = Math.PI * Math.pow(diaMm / 1000 / 2, 2);
    const rhFull = diaMm / 1000 / 4;
    const vFull = (1 / nEff) * Math.pow(rhFull, 2 / 3) * Math.sqrt(slopeS0);
    const qCapLps = vFull * areaFull * 1000;
    const qChokedLps = qCapLps * (1 - capacityReduction / 100);

    const homes = upMetrics ? upMetrics.homesCount : 24;
    const tribLenM = upMetrics ? upMetrics.totalLengthM : 650;
    const qDryLps = homes * ((500 * 2.0) / 86400);
    const iiRate = runs().iiLevels[st.ii].ii;
    const qWetLps = tribLenM * (iiRate / 100);
    const qInLps = Math.max(1.5, qDryLps + qWetLps);
    const excessLps = Math.max(0, qInLps - qChokedLps);

    const depthM = uNode.depth || 2.4;
    const totalSpillVolM3 = areaFull * lenM + 0.866 * depthM;
    const timeToSpillMin =
      excessLps > 0
        ? Math.round((totalSpillVolM3 * 1000) / excessLps / 60)
        : Infinity;

    // Determine current filling stage
    const accumM3 = (excessLps * st.timelineSec) / 1000;
    const pipeVolM3 = areaFull * lenM;
    const h0 =
      accumM3 <= pipeVolM3
        ? (diaMm / 1000) * (accumM3 / pipeVolM3)
        : diaMm / 1000 + (accumM3 - pipeVolM3) / 0.866;

    const isSpill = h0 >= depthM;
    const isShaftSurcharging = h0 > diaMm / 1000;

    const statusEl = $("#timelineStatus");
    if (statusEl) {
      if (isSpill) {
        statusEl.textContent = "SURCHARGE OVERFLOW! (" + uNode.name + ")";
        statusEl.className = "badge-tag crit";
      } else if (isShaftSurcharging) {
        statusEl.textContent =
          "Manhole Surcharging (" + Math.round((h0 / depthM) * 100) + "%)";
        statusEl.className = "badge-tag warn";
      } else {
        statusEl.textContent =
          "Pipe Filling (" +
          Math.round((accumM3 / Math.max(0.1, pipeVolM3)) * 100) +
          "%)";
        statusEl.className = "badge-tag warn";
      }
    }

    const horizonEl = $("#timelineHorizon");
    if (horizonEl) {
      horizonEl.textContent = isFinite(timeToSpillMin)
        ? timeToSpillMin + " mins"
        : "No spill";
    }

    $("#blockageResults").innerHTML =
      "<div class='card-box' style='background:#221015; border-color:var(--warn)'>" +
      "<h4 style='color:var(--warn)'><span>Hydraulic Choke Physics &amp; Spill Timeline</span></h4>" +
      row2(
        "Choked Reach",
        "Reach #" + p + " (" + diaMm + " mm &bull; " + Math.round(lenM) + " m)",
      ) +
      row2(
        "Bed Slope &amp; Gravity Flow",
        (slopeS0 * 100).toFixed(2) +
          "% (" +
          dropM.toFixed(2) +
          " m drop, v=" +
          vFull.toFixed(2) +
          " m/s)",
      ) +
      row2(
        "Fluid Viscosity &amp; Friction",
        vProp.nu + " mm²/s (n=" + nEff.toFixed(4) + ")",
      ) +
      row2(
        "Capacity Under Choke",
        "<b>" +
          qChokedLps.toFixed(1) +
          " L/s</b> (reduced from " +
          qCapLps.toFixed(1) +
          " L/s)",
      ) +
      row2(
        "Tributary Upstream Flow",
        "<b>" + qInLps.toFixed(1) + " L/s</b> (" + homes + " homes + wet I&I)",
      ) +
      row2(
        "Primary Surcharge Water Height",
        "<b class='" +
          (isSpill ? "bad" : "accent") +
          "'>" +
          h0.toFixed(2) +
          " m / " +
          depthM.toFixed(2) +
          " m</b> (" +
          Math.round(Math.min(100, (h0 / depthM) * 100)) +
          "%)",
      ) +
      row2(
        "Simulated Spill Warning Time",
        "<b class='bad'>" +
          (isFinite(timeToSpillMin)
            ? timeToSpillMin + " minutes"
            : "Indefinite buffer") +
          "</b>",
      ) +
      "</div>";
  }

  /* ------------------------------------- PUMP STATIONS & VISCOSITY CONTROLS */
  function renderPumpUI() {
    const psId = st.activePumpStation;
    const duty = st.pumpDuty[psId] || 1.0;
    const ratedLps = psId === "PS-01" ? 50 : 25;
    const currentLps = Math.round(ratedLps * duty * 10) / 10;
    const powerKw = Math.round(currentLps * 0.28 * 10) / 10;

    $("#pumpDutyVal").textContent =
      Math.round(duty * 100) + "% (" + currentLps + " L/s)";
    $("#psStatusBadge").textContent =
      duty > 0 ? "PUMPING (" + currentLps + " L/s)" : "IDLE";
    $("#psStatusBadge").className =
      duty > 1.2
        ? "badge-tag crit"
        : duty > 0
          ? "badge-tag good"
          : "badge-tag warn";

    // Viscosity calculation with peer-reviewed literature
    const vProp = VISC_PROPERTIES[st.viscMode] || VISC_PROPERTIES.domestic;
    const baseVel = 1.12; // m/s baseline
    const actualVel = Math.round(baseVel * (0.013 / vProp.nEff) * 100) / 100;
    const velDiffPct = Math.round(((actualVel - baseVel) / baseVel) * 100);
    const transitTimeMin = Math.round((7780 / (actualVel * 60)) * 10) / 10;

    $("#viscOutputs").innerHTML =
      row2("Kinematic Viscosity (ν)", "<b>" + vProp.nu + " mm²/s</b>") +
      row2(
        "Effective Manning (n)",
        vProp.nEff.toFixed(4) + " (roughness adjusted)",
      ) +
      row2(
        "Mean Flow Velocity",
        "<b>" +
          actualVel +
          " m/s</b> (" +
          (velDiffPct >= 0 ? "+" : "") +
          velDiffPct +
          "%)",
      ) +
      row2(
        "Catchment Transit Time",
        "<strong>" + transitTimeMin + " mins</strong> to outfall",
      ) +
      "<div style='font-size:10.5px; color:var(--faint); margin-top:8px; border-top:1px solid var(--line); padding-top:6px'><strong>Literature Reference:</strong> " +
      esc(vProp.ref) +
      "</div>";
  }

  /* ---------------------------------------------------- assumptions tab */
  function renderRef() {
    if ($("#ref").dataset.done) return;
    const g = geom();
    $("#ref").innerHTML =
      '<div class="lead"><p><strong>What this model is, in one paragraph.</strong> ' +
      "Every pipe draining to one chamber, " +
      g.nPipes +
      " of them over " +
      g.nChambers +
      " manholes, solved as a steady state in EPA SWMM. Sewage load comes from " +
      g.baseDwellings +
      " connected properties counted from the published record and " +
      "attributed through their own connection pipes. Infiltration is added in proportion " +
      "to pipe length. A chamber surcharges when water passes the crown of its outlet pipe.</p></div>" +
      markdown(GROWTH_INDEX.docs.assumptions);
    $("#ref").dataset.done = "1";
  }

  function markdown(md_) {
    const out = [];
    let inTable = false;
    const inline = (t) =>
      esc(t)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const closeT = () => {
      if (inTable) {
        out.push("</tbody></table>");
        inTable = false;
      }
    };
    for (const raw of String(md_ || "").split("\n")) {
      const line = raw.replace(/\s+$/, "");
      if (/^\|/.test(line)) {
        if (/^[:\-\s|]+$/.test(line)) continue;
        const cells = line
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());
        if (!inTable) {
          out.push(
            "<table><thead><tr>" +
              cells.map((c) => "<th>" + inline(c) + "</th>").join("") +
              "</tr></thead><tbody>",
          );
          inTable = true;
        } else {
          out.push(
            "<tr>" +
              cells.map((c) => "<td>" + inline(c) + "</td>").join("") +
              "</tr>",
          );
        }
        continue;
      }
      closeT();
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h)
        out.push(
          "<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">",
        );
      else if (/^[-*]\s+/.test(line))
        out.push("<li>" + inline(line.replace(/^[-*]\s+/, "")) + "</li>");
      else if (/^---+$/.test(line)) out.push("<hr>");
      else if (line) out.push("<p>" + inline(line) + "</p>");
    }
    closeT();
    return out.join("\n");
  }

  function setTab(tab) {
    const isClose = tab === "map" || !tab;
    const sideSub = $("#sideSubWindow");
    if (isClose) {
      if (sideSub) sideSub.hidden = true;
      document
        .querySelectorAll(".nav-doc-btn")
        .forEach((b) => b.classList.remove("primary"));
      Growth3D.resize($("#stage"));
      return;
    }

    if (sideSub) sideSub.hidden = false;

    const titles = {
      intro: "📖 Catchment Intelligence Guide",
      about: "ℹ️ About the Hydraulic Model",
      schema: "📐 Data Schema & Hydraulic Equations",
      ref: "📋 Engineering Assumptions",
      qa: "💬 Discussion Q&A",
      sensor: "🎯 Sensor Technical Placement Rationale",
    };
    const titleEl = $("#subwindowTitle");
    if (titleEl)
      titleEl.textContent = titles[tab] || "Documentation & Reference";

    const panes = ["intro", "about", "schema", "ref", "qa", "sensor"];
    panes.forEach((p) => {
      const el = $("#pane-" + p);
      if (el) el.hidden = p !== tab;
    });

    const introBtn = $("#tab-intro"),
      aboutBtn = $("#btn-info"),
      schemaBtn = $("#btnSchema"),
      refBtn = $("#tab-ref"),
      qaBtn = $("#tab-qa");
    if (introBtn) introBtn.classList.toggle("primary", tab === "intro");
    if (aboutBtn) aboutBtn.classList.toggle("primary", tab === "about");
    if (schemaBtn) schemaBtn.classList.toggle("primary", tab === "schema");
    if (refBtn) refBtn.classList.toggle("primary", tab === "ref");
    if (qaBtn) qaBtn.classList.toggle("primary", tab === "qa");

    if (tab === "intro") renderIntro();
    else if (tab === "about") renderAbout();
    else if (tab === "ref") renderRef();
    else if (tab === "qa") renderQA();

    Growth3D.resize($("#stage"));
  }

  function renderIntro() {
    const p = $("#pane-intro");
    if (!p || p.dataset.done) return;
    p.innerHTML =
      "<h2>📖 Catchment Intelligence & Sensor Placement Guide</h2>" +
      "<div class='lead-box'>" +
      "<p style='margin:0;font-weight:600;color:var(--ink)'>Engineering digital twin of the Walkerville gravity sewer network in Adelaide, South Australia, combining EPA SWMM 5.2 dynamic wave routing, 643 real property connections, and multi-criteria sensor placement optimization.</p>" +
      "</div>" +
      "<h3>How to Navigate the 3D Catchment</h3>" +
      "<table style='margin-bottom:14px'>" +
      "<tr><th style='width:35%'>Action</th><th>How to do it</th></tr>" +
      "<tr><td><b>Free 4-Direction Pan</b></td><td>Hold <kbd>Spacebar</kbd> and drag with mouse, or use <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> arrow keys. You can also toggle the 'Pan' button in the top menu.</td></tr>" +
      "<tr><td><b>Rotate / Orbit</b></td><td>Click and drag on the 3D canvas (left mouse button).</td></tr>" +
      "<tr><td><b>Zoom In / Out</b></td><td>Scroll mouse wheel, or pinch on trackpad / touchscreen.</td></tr>" +
      "<tr><td><b>Inspect Any Node</b></td><td>Click any manhole or pipe junction to highlight its complete upstream tributary drainage tree, pipe length, and guarded dwellings.</td></tr>" +
      "<tr><td><b>Extend Window Sizes</b></td><td>Drag the vertical divider between the left sidebar and map to widen/narrow controls. Drag the left border of this side window to widen/narrow documentation. Double-click dividers to toggle wide view.</td></tr>" +
      "<tr><td><b>Auto-Close &amp; Pin Window</b></td><td>Clicking outside this window closes it automatically. <b>Double-click anywhere on the side window</b> (or click <code>📌 Pin</code>) to pin it open so it stays open while interacting with the 3D map.</td></tr>" +
      "<tr><td><b>Reset Views</b></td><td>Click <code>Whole catchment</code> to view the full network, or <code>Zoom to selected</code> to zoom directly to your inspected node.</td></tr>" +
      "</table>" +
      "<h3>What Each Simulation View Does &amp; Delivers</h3>" +
      "<div class='card-box' style='margin-bottom:10px'>" +
      "<h4 style='color:var(--accent);margin:0 0 4px'>1. Growth Simulation (Default)</h4>" +
      "<p style='margin:0 0 6px'><strong>What it does:</strong> Simulates infill housing development (+50 to +700 dwellings) and 3 wet-weather rainfall infiltration levels (0.25, 0.40, 0.55 L/s/100m) connected to any candidate manhole.</p>" +
      "<p style='margin:0'><strong>What it delivers:</strong> Differentiates pipes that surcharge solely due to new development from baseline capacity deficits. Computes greedy set-cover sensor placement to catch newly tipped pipes.</p>" +
      "</div>" +
      "<div class='card-box' style='margin-bottom:10px'>" +
      "<h4 style='color:var(--green);margin:0 0 4px'>2. Sensor Placement Heatmap</h4>" +
      "<p style='margin:0 0 6px'><strong>What it does:</strong> Evaluates every manhole in the catchment across 5 dynamic hydraulic parameters (Surcharge Frequency, Tributary Properties, Bottleneck Proximity, Backwater Amplitude, Wet Inflow). Renders numbered 3D map pins and radial heat rings.</p>" +
      "<p style='margin:0'><strong>What it delivers:</strong> Ranked recommendations for IoT ultrasonic level sensor placement. Clicking any candidate reveals an explainability card detailing why the location was chosen over adjacent chambers.</p>" +
      "</div>" +
      "<div class='card-box' style='margin-bottom:10px'>" +
      "<h4 style='color:var(--warn);margin:0 0 4px'>3. Blockage &amp; Backwater Simulator</h4>" +
      "<p style='margin:0 0 6px'><strong>What it does:</strong> Injects choke constrictions (0% to 95%) mimicking fatbergs, root intrusion, or debris build-up into key collector mains.</p>" +
      "<p style='margin:0'><strong>What it delivers:</strong> Models upstream St. Venant backwater wave surcharge propagation and calculates proactive early-warning detection lead times (up to 32.6 days before street spills occur).</p>" +
      "</div>" +
      "<div class='card-box' style='margin-bottom:10px'>" +
      "<h4 style='color:var(--purple);margin:0 0 4px'>4. Pump Stations &amp; Viscosity Controls</h4>" +
      "<p style='margin:0 0 6px'><strong>What it does:</strong> Controls variable-speed motor dispatch (0–150% duty) for Outfall PS-01 and Trunk LS-02, and adjusts fluid viscosity across 4 wastewater conditions (Domestic, Grease/FOG, Cold Sludge, Clean Water).</p>" +
      "<p style='margin:0'><strong>What it delivers:</strong> Shows how fluid boundary-layer drag affects self-cleansing velocity (0.7–2.5 m/s) and transit times, and demonstrates automated pump drawdown to relieve upstream pipe surcharge.</p>" +
      "</div>" +
      "<h3>Top Menu Reference Documents</h3>" +
      "<p>The right side of the top menu contains technical engineering documentation:</p>" +
      "<ul>" +
      "<li><b>📖 Tool Guide:</b> This quick overview of controls and simulation deliverables.</li>" +
      "<li><b>ℹ️ About this model:</b> High-level catchment scope, research questions, and key statistics.</li>" +
      "<li><b>📐 Data Schema &amp; Formulas:</b> Formal data dictionaries, hydraulic Manning/viscosity equations, and data provenance.</li>" +
      "<li><b>📋 Assumptions:</b> Deep technical dive into EPA SWMM solver setup, loading methods, and edge cases.</li>" +
      "<li><b>💬 Discussion Q&amp;A:</b> Engineering rationale answering common peer-review questions.</li>" +
      "</ul>";
    p.dataset.done = "1";
  }

  function renderAbout() {
    const p = $("#pane-about");
    if (!p || p.dataset.done) return;
    const sc = GROWTH_INDEX.scenario,
      n = sc.numbers;
    const fact = (l, v) =>
      v == null
        ? ""
        : '<div class="kfact">' + esc(l) + "<b>" + esc(v) + "</b></div>";
    p.innerHTML =
      "<h2>" +
      esc(sc.title) +
      "</h2>" +
      '<div class="lead-box"><p class="q" style="margin:0;font-weight:600;color:var(--ink)">' +
      esc(sc.question) +
      "</p></div>" +
      sc.what.map((p2) => "<p>" + esc(p2) + "</p>").join("") +
      "<h3>Catchment Scale &amp; Parameters</h3><div class=kfacts>" +
      fact("Pipes modelled", n.pipes) +
      fact("Chambers", n.chambers) +
      fact("Properties counted", n.dwellings) +
      fact("Peak factor", n.peakFactor) +
      "</div>" +
      "<h3>Core Model Assumptions</h3>" +
      "<table class=ass><tbody>" +
      sc.assumptions
        .map(
          (a) =>
            '<tr><td class="id" style="font-weight:600;color:var(--accent);width:80px">' +
            esc(a.id) +
            "</td><td>" +
            md(a.text) +
            "</td></tr>",
        )
        .join("") +
      "</tbody></table>" +
      '<div class="lead-box" style="border-left-color:var(--warn);margin-top:14px"><strong>Model Limitations &amp; Caveat:</strong> ' +
      esc(sc.caveat) +
      "</div>";
    p.dataset.done = "1";
  }

  /* ------------------------------------------------------------------ Q&A tab */
  const DISCUSS_QA = [
    {
      short: "Why treat one inspection point as one dwelling?",
      a: [
        "An inspection point is where a service line joins the main, not a dwelling count.",
        "The layer carries a TRADEWASTE field flagging non-residential connections.",
        "Cross-referencing PARCELID against land-use gives a count of connections.",
      ],
    },
    {
      short: "Where do the three infiltration levels come from?",
      a: [
        "0.25, 0.40 and 0.55 L/s per 100 m are round numbers chosen to bracket a dry, wet and very wet day.",
        "Infiltration enters through the pipe itself rather than connections.",
      ],
    },
    {
      short: "How does greedy set cover work for sensor placement?",
      a: [
        "Greedy repeatedly picks whichever chamber appears in the most still-uncovered tipped sets.",
        "Downstream bottlenecks catch multiple upstream branches.",
      ],
    },
    {
      short: "Can backwater surcharge cause a chamber to fill?",
      a: [
        "Yes. The SWMM dynamic wave solver captures backwater: if a downstream reach throttles, water backs up into upstream chambers.",
        "Chambers like MH4449118 act as pressure gauges on trunk bottlenecks.",
      ],
    },
  ];

  function renderQA() {
    if ($("#qa").dataset.done) return;
    $("#qa").innerHTML =
      '<div class="lead"><p>Written up from questions asked while stress-testing this ' +
      "model's assumptions: load generation, dynamic SWMM solver, and backwater mechanics.</p></div>" +
      DISCUSS_QA.map(
        (q) =>
          '<details class="qa"><summary>' +
          esc(q.short) +
          "</summary>" +
          '<div class="body">' +
          q.a.map((x) => "<p>" + esc(x) + "</p>").join("") +
          "</div></details>",
      ).join("");
    $("#qa").dataset.done = "1";
  }

  function showModal() {
    setTab("about");
  }
  const md = (t) =>
    esc(t)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  /* ---------------------------------------------------------------- init */
  function init() {
    geom().nodes.forEach((n) => {
      byName[n.name] = n;
    });
    const idxOfName = {};
    runs().chambers.forEach((c, i) => {
      idxOfName[c] = i;
    });

    Growth3D.build(
      $("#stage"),
      (nd) => {
        st.hover = null;
        if (nd.name in idxOfName) {
          select(idxOfName[nd.name]);
          if (st.mode === "heatmap") {
            explainChamberPlacement(idxOfName[nd.name]);
          }
        }
      },
      (nd) => {
        const name = nd && nd.name !== nameOf(st.site) ? nd.name : null;
        if (name === st.hover) return;
        st.hover = name;
        const c = cell();
        renderHomes(
          st.showSensors
            ? c.coverage.chosen.map((x) => nameOf(+x.chamber))
            : [],
        );
        if (st.mode === "heatmap") {
          renderHeatmapLiveExplain();
        }
      },
    )
      .then(() => {
        const loadOverlay = $("#loadingOverlay");
        if (loadOverlay) {
          loadOverlay.classList.add("fade-out");
          setTimeout(() => loadOverlay.remove(), 450);
        }

        buildKnobs();
        const order = buildList();
        populateBlockagePipes();

        $("#scale").textContent =
          geom().nPipes +
          " pipes, " +
          geom().nChambers +
          " manholes, " +
          (geom().nHouses || geom().baseDwellings) +
          " connected properties" +
          ", 2 pump stations. Elevation is pipe invert, exaggerated x" +
          Growth3D.ZEXAG +
          ". Click any node to inspect its affecting upstream catchment.";

        select(order[0]);
      })
      .catch((err) => {
        console.error("Three.js initialization failed:", err);
        const errOverlay = $("#errorOverlay");
        if (errOverlay) {
          errOverlay.hidden = false;
          const p = errOverlay.querySelector("p");
          if (p && err && err.message) {
            p.textContent = "Could not initialize 3D scene: " + err.message;
          }
        }
        const loadOverlay = $("#loadingOverlay");
        if (loadOverlay) loadOverlay.style.display = "none";
      });

    // Mobile / Tablet Drawer Toggle
    const sideToggle = $("#sidebarToggle");
    if (sideToggle) {
      sideToggle.onclick = () => {
        const side = $("#side");
        side.classList.toggle("drawer-open");
        sideToggle.textContent = side.classList.contains("drawer-open")
          ? "✕ Close"
          : "☰ Menu";
        setTimeout(() => Growth3D.resize($("#stage")), 300);
      };
    }

    // Navigation & Sub-window Doc Tabs
    const tabIntro = $("#tab-intro");
    if (tabIntro)
      tabIntro.onclick = () =>
        setTab(
          $("#sideSubWindow").hidden || $("#pane-intro").hidden
            ? "intro"
            : "map",
        );
    const btnInfo = $("#btn-info");
    if (btnInfo)
      btnInfo.onclick = () =>
        setTab(
          $("#sideSubWindow").hidden || $("#pane-about").hidden
            ? "about"
            : "map",
        );
    const btnSchema = $("#btnSchema");
    if (btnSchema)
      btnSchema.onclick = () =>
        setTab(
          $("#sideSubWindow").hidden || $("#pane-schema").hidden
            ? "schema"
            : "map",
        );
    const tabRef = $("#tab-ref");
    if (tabRef)
      tabRef.onclick = () =>
        setTab(
          $("#sideSubWindow").hidden || $("#pane-ref").hidden ? "ref" : "map",
        );
    const tabQa = $("#tab-qa");
    if (tabQa)
      tabQa.onclick = () =>
        setTab(
          $("#sideSubWindow").hidden || $("#pane-qa").hidden ? "qa" : "map",
        );
    const subClose = $("#subwindowClose");
    if (subClose) subClose.onclick = () => setTab("map");

    // Elevation exaggeration lever
    const exaggRange = $("#exaggRange");
    const exaggVal = $("#exaggVal");
    if (exaggRange) {
      exaggRange.oninput = (e) => {
        const val = +e.target.value;
        if (exaggVal) exaggVal.textContent = val + "x";
        Growth3D.setElevationExaggeration(val);
      };
    }

    // Framerate & GPU low-power toggle group (30 Eco, 60 Balanced, Max)
    const fpsGroup = $("#fpsToggleGroup");
    if (fpsGroup) {
      let savedFps = 30;
      if (typeof localStorage !== "undefined") {
        try {
          const raw = localStorage.getItem("sim2_fps");
          if (raw !== null) savedFps = parseInt(raw, 10);
        } catch (e) {}
      }
      setFpsMode(savedFps);

      fpsGroup.querySelectorAll(".fps-btn").forEach((btn) => {
        btn.onclick = () => {
          const fps = parseInt(btn.dataset.fps, 10);
          setFpsMode(fps);
        };
      });
    }

    $("#toggleBottlenecks").onclick = () => {
      st.showBottlenecks = !st.showBottlenecks;
      $("#toggleBottlenecks").classList.toggle("primary", st.showBottlenecks);
      $("#toggleBottlenecks").textContent = st.showBottlenecks
        ? "Hide bottleneck pipes"
        : "Show bottleneck pipes";
      Growth3D.showBottlenecks(st.showBottlenecks);
    };

    const togglePanBtn = $("#togglePan");
    if (togglePanBtn) {
      togglePanBtn.onclick = () => {
        Growth3D.togglePanMode();
      };
    }

    $("#toggleSensors").onclick = () => {
      st.showSensors = !st.showSensors;
      $("#toggleSensors").classList.toggle("primary", st.showSensors);
      $("#toggleSensors").textContent = st.showSensors
        ? "Hide proposed sensors"
        : "Show proposed sensors";
      repaint();
    };

    $("#toggleFlow").onclick = () => {
      st.flowAnim = !st.flowAnim;
      $("#toggleFlow").classList.toggle("primary", st.flowAnim);
      $("#toggleFlow").textContent = st.flowAnim
        ? "Flow Animation: ON"
        : "Flow Animation: OFF";
      Growth3D.setFlowAnimation(st.flowAnim, 1.0);
    };

    // Growth Sensor Priority Placement Controls
    const btnGrowthSensors = $("#btnGrowthSensors");
    if (btnGrowthSensors) {
      btnGrowthSensors.onclick = () => {
        st.growthSensorsActive = !st.growthSensorsActive;
        repaint();
      };
    }

    const knobGrowthCrit = $("#growthSensorPriorityKnob");
    if (knobGrowthCrit) {
      knobGrowthCrit.onclick = (e) => {
        const b = e.target.closest("button[data-crit]");
        if (!b) return;
        st.growthSensorCrit = b.dataset.crit;
        knobGrowthCrit.querySelectorAll("button").forEach((btn) => {
          btn.classList.toggle("on", btn === b);
        });
        repaint();
      };
    }

    // Mode Selector
    $("#modeKnob").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      document
        .querySelectorAll("#modeKnob button")
        .forEach((btn) => btn.classList.remove("on"));
      b.classList.add("on");
      st.mode = b.dataset.mode;

      // Toggle Panels
      $("#panel-growth").hidden = st.mode !== "growth";
      $("#panel-heatmap").hidden = st.mode !== "heatmap";
      $("#panel-blockage").hidden = st.mode !== "blockage";
      $("#panel-pump").hidden = st.mode !== "pump";

      repaint();
    };

    // Blockage Controls & Timeline
    $("#blockageRange").oninput = (e) => {
      st.blockageSeverity = +e.target.value;
      updateBlockagePhysics();
      renderBlockageUI();
    };

    const btnPlay = $("#btnTimelinePlay");
    if (btnPlay) btnPlay.onclick = toggleTimelinePlay;
    const btnStepBack = $("#btnTimelineStepBack");
    if (btnStepBack) btnStepBack.onclick = () => stepTimeline(-60);
    const btnStepFwd = $("#btnTimelineStepFwd");
    if (btnStepFwd) btnStepFwd.onclick = () => stepTimeline(60);
    const btnReset = $("#btnTimelineReset");
    if (btnReset) btnReset.onclick = resetTimeline;
    const timelineSpeed = $("#timelineSpeed");
    if (timelineSpeed)
      timelineSpeed.onchange = (e) => {
        st.timelineSpeed = +e.target.value;
      };
    const scrubber = $("#timelineScrubber");
    if (scrubber) {
      scrubber.oninput = (e) => {
        pauseTimelinePlay();
        st.timelineSec = +e.target.value;
        updateBlockagePhysics();
        renderBlockageUI();
      };
    }

    // Pump Controls
    $("#pumpStationSelect").onchange = (e) => {
      st.activePumpStation = e.target.value;
      const duty = st.pumpDuty[st.activePumpStation] || 1.0;
      $("#pumpDutyRange").value = String(Math.round(duty * 100));
      renderPumpUI();
    };

    $("#pumpDutyRange").oninput = (e) => {
      const duty = +e.target.value / 100;
      st.pumpDuty[st.activePumpStation] = duty;
      Growth3D.setPumpStationState(st.activePumpStation, duty > 0, duty);
      renderPumpUI();
    };

    $("#chkAutoRelief").onchange = (e) => {
      st.autoRelief = e.target.checked;
      if (st.autoRelief) {
        st.pumpDuty["PS-01"] = 1.25;
        st.pumpDuty["LS-02"] = 1.1;
        $("#pumpDutyRange").value = "125";
        Growth3D.setPumpStationState("PS-01", true, 1.25);
        Growth3D.setPumpStationState("LS-02", true, 1.1);
      }
      renderPumpUI();
    };

    // Viscosity
    $("#viscSelect").onchange = (e) => {
      st.viscMode = e.target.value;
      renderPumpUI();
    };

    // Explain Top Sensor Button
    $("#btnExplainTop").onclick = () => {
      computeHeatmapData();
      const topIdx = heatmapData.rankings[0].index;
      select(topIdx);
      explainChamberPlacement(topIdx);
    };

    $("#fitAll").onclick = () => Growth3D.frame(null);
    $("#fitSite").onclick = () => Growth3D.frame(nameOf(st.site));

    initSideGrip();
    initSubwindowGrip();
    initSubwindowPin();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const sub = $("#sideSubWindow");
        if (sub && !sub.hidden) setTab("map");
      }
    });
    window.addEventListener("resize", () => Growth3D.resize($("#stage")));
  }

  /* ------------------------------------- WINDOW RESIZING (LEFT SIDEBAR & SUB-WINDOW) */
  function initSideGrip() {
    const grip = $("#grip");
    if (!grip) return;

    const applyWidth = (px) => {
      const minW = 350;
      const maxW = Math.max(minW, Math.min(850, window.innerWidth * 0.65));
      const w = Math.max(minW, Math.min(maxW, px));
      document.documentElement.style.setProperty("--side", w + "px");
      Growth3D.resize($("#stage"));
      return w;
    };

    try {
      const saved = localStorage.getItem("simSideWidth");
      if (saved) applyWidth(parseInt(saved, 10));
    } catch (e) {}

    let dragging = false;
    const onDown = (e) => {
      dragging = true;
      st.isResizing = true;
      grip.classList.add("on");
      document.body.classList.add("dragging");
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const clientX =
        e.clientX != null
          ? e.clientX
          : e.touches && e.touches[0]
            ? e.touches[0].clientX
            : null;
      if (clientX != null) applyWidth(clientX);
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      grip.classList.remove("on");
      document.body.classList.remove("dragging");
      setTimeout(() => {
        st.isResizing = false;
      }, 60);
      try {
        const cur = parseInt(
          getComputedStyle(document.documentElement).getPropertyValue("--side"),
          10,
        );
        if (cur) localStorage.setItem("simSideWidth", String(cur));
      } catch (e) {}
    };

    grip.addEventListener("mousedown", onDown);
    grip.addEventListener("touchstart", onDown, { passive: false });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);

    grip.addEventListener("dblclick", () => {
      const cur =
        parseInt(
          getComputedStyle(document.documentElement).getPropertyValue("--side"),
          10,
        ) || 340;
      const target = cur > 450 ? 340 : 560;
      applyWidth(target);
      try {
        localStorage.setItem("simSideWidth", String(target));
      } catch (e) {}
    });
  }

  function initSubwindowGrip() {
    const grip = $("#subwindowGrip");
    const sideSub = $("#sideSubWindow");
    if (!grip || !sideSub) return;

    const applyWidth = (px) => {
      const stageWrap = $("#stageWrap");
      const maxW = stageWrap
        ? Math.max(380, stageWrap.clientWidth - 40)
        : window.innerWidth - 80;
      const w = Math.max(340, Math.min(maxW, px));
      sideSub.style.width = w + "px";
      document.documentElement.style.setProperty("--subwindow-width", w + "px");
      Growth3D.resize($("#stage"));
      return w;
    };

    try {
      const saved = localStorage.getItem("simSubWindowWidth");
      if (saved) applyWidth(parseInt(saved, 10));
    } catch (e) {}

    let dragging = false;
    const onDown = (e) => {
      dragging = true;
      st.isResizing = true;
      grip.classList.add("active");
      document.body.classList.add("dragging");
      e.preventDefault();
      e.stopPropagation();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const clientX =
        e.clientX != null
          ? e.clientX
          : e.touches && e.touches[0]
            ? e.touches[0].clientX
            : null;
      if (clientX == null) return;
      const stageWrap = $("#stageWrap");
      const rect = stageWrap
        ? stageWrap.getBoundingClientRect()
        : document.body.getBoundingClientRect();
      const newWidth = rect.right - clientX;
      applyWidth(newWidth);
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      grip.classList.remove("active");
      document.body.classList.remove("dragging");
      setTimeout(() => {
        st.isResizing = false;
      }, 60);
      try {
        const cur = parseInt(sideSub.style.width, 10);
        if (cur) localStorage.setItem("simSubWindowWidth", String(cur));
      } catch (e) {}
    };

    grip.addEventListener("mousedown", onDown);
    grip.addEventListener("touchstart", onDown, { passive: false });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);

    grip.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const cur = parseInt(sideSub.style.width, 10) || 480;
      const target = cur > 620 ? 480 : 780;
      applyWidth(target);
      try {
        localStorage.setItem("simSubWindowWidth", String(target));
      } catch (err) {}
    });
  }

  /* ------------------------------------- SUB-WINDOW PINNING & OUTSIDE CLICK AUTO-CLOSE */
  let noticeTimer = null;
  function showSubwindowNotice(msg) {
    const notice = $("#subwindowNotice");
    if (!notice) return;
    notice.textContent = msg;
    notice.hidden = false;
    notice.style.opacity = "1";
    notice.style.transform = "translateX(-50%) translateY(0)";
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice.style.opacity = "0";
      notice.style.transform = "translateX(-50%) translateY(8px)";
      setTimeout(() => {
        notice.hidden = true;
      }, 250);
    }, 2200);
  }

  function toggleSubwindowPin(forceState) {
    st.subwindowPinned =
      forceState !== undefined ? forceState : !st.subwindowPinned;
    const sideSub = $("#sideSubWindow");
    const pinBtn = $("#subwindowPin");
    const pinText = $("#subwindowPinText");
    if (sideSub) sideSub.classList.toggle("pinned", st.subwindowPinned);
    if (pinBtn) {
      pinBtn.classList.toggle("pinned", st.subwindowPinned);
      pinBtn.title = st.subwindowPinned
        ? "Window is PINNED: Won't close on outside clicks (Double-click window to unpin)"
        : "Window is AUTO-CLOSE: Closes on outside clicks (Double-click window to pin)";
    }
    if (pinText) pinText.textContent = st.subwindowPinned ? "Pinned" : "Pin";
    showSubwindowNotice(
      st.subwindowPinned
        ? "📌 Window Pinned: Won't close when clicking outside (Double-click to unpin)"
        : "🔓 Auto-Close Active: Window will close when clicking outside",
    );
  }

  function initSubwindowPin() {
    const sideSub = $("#sideSubWindow");
    const pinBtn = $("#subwindowPin");
    if (!sideSub) return;

    // Double-click anywhere on the sideSubWindow toggles pin state!
    sideSub.addEventListener("dblclick", (e) => {
      if (
        e.target.closest("input, select, textarea, button, a, #subwindowGrip")
      )
        return;
      toggleSubwindowPin();
    });

    if (pinBtn) {
      pinBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSubwindowPin();
      });
    }

    // Track where pointer went down to prevent accidental closing on text selection
    document.addEventListener("pointerdown", (e) => {
      const sub = $("#sideSubWindow");
      st.pointerDownInsideSub = sub && !sub.hidden && sub.contains(e.target);
    });

    // Outside click to close window (unless pinned)
    document.addEventListener("click", (e) => {
      const sub = $("#sideSubWindow");
      if (!sub || sub.hidden) return;
      // If pinned, STOP CLOSING even when clicked outside!
      if (st.subwindowPinned) return;

      // If clicked inside or pointerdown started inside, do nothing
      if (sub.contains(e.target) || st.pointerDownInsideSub) return;

      // If dragging a resize grip, do nothing
      if (st.isResizing) return;

      // If clicked on navigation button that toggles/opens subwindow or sidebar, do not close here
      if (
        e.target.closest(
          ".nav-doc-btn, #subwindowClose, #fitSite, #btnExplainTop, #sidebarToggle, #grip, #subwindowGrip",
        )
      )
        return;

      // Click was outside an unpinned window -> close it!
      setTab("map");
    });
  }

  function selectAndExplain(idx) {
    select(idx);
    explainChamberPlacement(idx);
  }

  function setFpsMode(fps) {
    const val = Number(fps);
    st.targetFPS = val;
    if (
      typeof Growth3D !== "undefined" &&
      typeof Growth3D.setTargetFPS === "function"
    ) {
      Growth3D.setTargetFPS(val);
    }
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem("sim2_fps", String(val));
      } catch (e) {}
    }
    const fpsGroup =
      typeof document !== "undefined" &&
      typeof document.getElementById === "function"
        ? document.getElementById("fpsToggleGroup")
        : null;
    if (fpsGroup && typeof fpsGroup.querySelectorAll === "function") {
      fpsGroup.querySelectorAll(".fps-btn").forEach((b) => {
        const bFps = parseInt(b.dataset.fps, 10);
        b.classList.toggle("active", bFps === val);
      });
    }
  }

  return {
    init,
    selectAndExplain,
    selectAndFocusChamber,
    computeHeatmapData,
    toggleSubwindowPin,
    setFpsMode,
    st,
  };
})();
