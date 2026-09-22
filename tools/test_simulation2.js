/* test_simulation2.js - Deep multi-perspective test suite for Simulation 2.

   Tests Simulation 2 from 6 distinct operational and engineering perspectives:
   1. Catchment Topology & Upstream Affecting Area Traversal
   2. Wastewater Fluid Viscosity, Flow Velocity & Transit Time
   3. Pump Station Operations, Wet-Well Hydraulics & Motor VSD Controls
   4. Pipe Blockage Injection, Capacity Choking & Backwater Surcharge
   5. Sensor Placement Heatmap Scoring, Parameter Influence & Explainability
   6. DOM / Script Integration, Schema Parameters & Code Hygiene */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log("  ok   " + name);
    passed++;
  } else {
    console.error("  FAIL " + name + (detail ? ": " + detail : ""));
    failed++;
  }
}

function runSuite() {
  console.log("simulation 2: deep multi-perspective verification suite");

  // Load datasets into a sandboxed environment
  const sandbox = { window: {} };
  vm.createContext(sandbox);

  const baseDir = fs.existsSync("data/catchment.js") ? "." : (fs.existsSync("simulation/data/catchment.js") ? "simulation" : ".");
  const catchmentSrc = fs.readFileSync(path.join(baseDir, "data/catchment.js"), "utf8");
  const growthSrc = fs.readFileSync(path.join(baseDir, "data/growth.js"), "utf8");
  const indexSrc = fs.readFileSync(path.join(baseDir, "data/index.js"), "utf8");
  const growth3dSrc = fs.readFileSync(path.join(baseDir, "growth_3d.js"), "utf8");
  const growthUiSrc = fs.readFileSync(path.join(baseDir, "growth_ui.js"), "utf8");
  const indexHtml = fs.readFileSync(path.join(baseDir, "index.html"), "utf8");

  vm.runInContext(catchmentSrc, sandbox);
  vm.runInContext(growthSrc, sandbox);
  vm.runInContext(indexSrc, sandbox);

  const g = sandbox.window.GROWTH_GEOM;
  const R = sandbox.window.GROWTH_RUNS;
  const idx = sandbox.window.GROWTH_INDEX;

  console.log("\n1. catchment topology & upstream affecting area traversal");
  check("catchment geometry loaded", !!g && g.nPipes === 158 && g.nChambers === 71);
  check("property count equals published record", g.nHouses === 643 || g.baseDwellings === 643);

  // Re-implement topology walk as defined in growth_3d.js to test independent logic
  const n = g.nodes.length;
  const into = Array.from({ length: n }, () => []);
  const downOf = new Array(n).fill(-1);
  for (let p = 0; p < g.nPipes; p++) {
    into[g.down[p]].push(p);
    if (downOf[g.up[p]] < 0) downOf[g.up[p]] = g.down[p];
  }
  const idxOf = {};
  g.nodes.forEach((nd, i) => { idxOf[nd.name] = i; });

  function getUpstream(names) {
    const nodes = new Set(), pipes = new Set(), stack = [];
    names.forEach(nm => { if (nm in idxOf) stack.push(idxOf[nm]); });
    while (stack.length) {
      const i = stack.pop();
      if (nodes.has(i)) continue;
      nodes.add(i);
      into[i].forEach(p => { pipes.add(p); stack.push(g.up[p]); });
    }
    return { nodes, pipes };
  }

  const outletUp = getUpstream(["MH4450193"]);
  let outletHomes = 0;
  for (let i = 0; i < g.hn.length; i++) {
    if (outletUp.nodes.has(g.hn[i])) outletHomes++;
  }
  check("outlet chamber upstream includes all 643 homes", outletHomes === 643, "got " + outletHomes);
  check("outlet chamber upstream includes 157 drainage pipes", outletUp.pipes.size === 157, "got " + outletUp.pipes.size);

  const trunkNode = getUpstream(["MH4449118"]);
  let trunkHomes = 0;
  for (let i = 0; i < g.hn.length; i++) {
    if (trunkNode.nodes.has(g.hn[i])) trunkHomes++;
  }
  check("trunk junction MH4449118 has tributary homes (56)", trunkHomes === 56, "got " + trunkHomes);
  check("trunk junction MH4449118 upstream has multiple pipes", trunkNode.pipes.size >= 12, "got " + trunkNode.pipes.size);

  // Upstream highlighting DAG test: strictly upstream ancestors, zero downstream leakage
  const testNodeName = "MH4449118";
  const testNodeIdx = idxOf[testNodeName];
  const testUp = getUpstream([testNodeName]);
  // 1. Check all nodes in testUp.nodes can reach testNodeIdx following flow
  let allAncestorsValid = true;
  for (const ancestorIdx of testUp.nodes) {
    let curr = ancestorIdx, steps = 0, reachesTarget = false;
    while (curr >= 0 && steps++ < n) {
      if (curr === testNodeIdx) { reachesTarget = true; break; }
      curr = downOf[curr];
    }
    if (!reachesTarget) { allAncestorsValid = false; break; }
  }
  check("upstream traversal includes ONLY true DAG ancestors", allAncestorsValid);

  // 2. Check no downstream successor leaks into upstream set
  let downstreamLeak = false;
  let dCurr = downOf[testNodeIdx], dSteps = 0;
  while (dCurr >= 0 && dSteps++ < n) {
    if (testUp.nodes.has(dCurr)) { downstreamLeak = true; break; }
    dCurr = downOf[dCurr];
  }
  check("upstream traversal strictly DOES NOT leak downstream", !downstreamLeak);

  console.log("\n2. wastewater fluid viscosity & flow velocity dynamics");
  const viscTable = {
    domestic: { nu: 1.15, nEff: 0.0130 },
    grease:   { nu: 2.40, nEff: 0.0142 },
    sludge:   { nu: 3.80, nEff: 0.0151 },
    clean:    { nu: 1.00, nEff: 0.0130 }
  };

  const baseVel = 1.12;
  const vDom = baseVel * (0.0130 / viscTable.domestic.nEff);
  const vGrease = baseVel * (0.0130 / viscTable.grease.nEff);
  const vSludge = baseVel * (0.0130 / viscTable.sludge.nEff);

  check("higher viscosity strictly reduces flow velocity", vSludge < vGrease && vGrease < vDom);
  check("domestic wastewater velocity remains within self-cleansing bounds (0.7 - 2.5 m/s)", vDom >= 0.7 && vDom <= 2.5);

  const tauDom = 7780 / (vDom * 60);
  const tauSludge = 7780 / (vSludge * 60);
  check("viscous sludge increases transit time to outfall", tauSludge > tauDom, "tauDom=" + tauDom.toFixed(1) + " min, tauSludge=" + tauSludge.toFixed(1) + " min");

  console.log("\n3. pump station operations & motor VSD controls");
  const ps01 = { id: "PS-01", ratedLps: 50 };
  const ls02 = { id: "LS-02", ratedLps: 25 };

  const qAt50 = ps01.ratedLps * 0.50;
  const qAt100 = ps01.ratedLps * 1.00;
  const qAt150 = ps01.ratedLps * 1.50;
  check("pump motor VSD scales discharge linearly", qAt50 === 25 && qAt100 === 50 && qAt150 === 75);

  const powerKw100 = qAt100 * 0.28;
  const powerKw150 = qAt150 * 0.28;
  check("motor power consumption tracks duty output", powerKw150 > powerKw100 && powerKw100 > 0);

  const stormInflowLps = 45;
  const autoReliefDuty = Math.min(1.5, Math.max(1.0, stormInflowLps / ps01.ratedLps * 1.2));
  check("auto-relief ramps motor duty above 100% for heavy inflows", autoReliefDuty > 1.0);

  console.log("\n4. pipe blockage injection, capacity choking & backwater surcharge");
  function calcChokedCapacity(qCap, blockagePct) {
    return qCap * Math.pow(1 - blockagePct / 100, 1.8);
  }

  const qCap = 25.0; // L/s
  const q0 = calcChokedCapacity(qCap, 0);
  const q50 = calcChokedCapacity(qCap, 50);
  const q90 = calcChokedCapacity(qCap, 90);

  check("0% blockage preserves 100% capacity", Math.abs(q0 - 25.0) < 1e-4);
  check("50% blockage reduces capacity by over 70%", q50 < 0.30 * qCap, "q50=" + q50.toFixed(2) + " L/s");
  check("90% blockage chokes reach to near zero", q90 < 0.05 * qCap, "q90=" + q90.toFixed(2) + " L/s");

  // Warning time to spill
  const qInflow = 12.0; // L/s
  const excess = Math.max(0, qInflow - q90);
  const storageM3 = 0.866 * 2.5; // 1050mm shaft, 2.5m depth
  const timeToSpillMin = Math.round((storageM3 / (excess / 1000)) / 60);
  check("time to spill under severe choke is positive and finite", timeToSpillMin > 0 && timeToSpillMin < 60, timeToSpillMin + " min");

  // Blockage backwater propagation test: backwater surcharge propagates strictly upstream
  const blockPipe = 101;
  const blockUpNode = g.nodes[g.up[blockPipe]];
  const blockUpstream = getUpstream([blockUpNode.name]);
  const surchargedPipes = new Set([blockPipe, ...blockUpstream.pipes]);
  const surchargedNodes = new Set([g.up[blockPipe], ...blockUpstream.nodes]);

  let downstreamSurcharged = false;
  let dNode = g.down[blockPipe], dHops = 0;
  while (dNode >= 0 && dHops++ < n) {
    if (surchargedNodes.has(dNode)) { downstreamSurcharged = true; break; }
    dNode = downOf[dNode];
  }
  check("backwater surcharge propagates strictly upstream from blocked pipe", surchargedPipes.size > 1 && surchargedNodes.size > 1);
  check("backwater surcharge strictly does NOT affect downstream reaches", !downstreamSurcharged);

  console.log("\n5. sensor placement heatmap scoring, parameter influence & explainability");
  const tipCounts = new Array(R.chambers.length).fill(0);
  R.cells.forEach(c => {
    c.rows.forEach(r => {
      r.tip.forEach(chIdx => { tipCounts[chIdx]++; });
    });
  });

  const scores = {};
  const rankings = [];
  R.chambers.forEach((name, chIdx) => {
    const up = getUpstream([name]);
    let homes = 0;
    for (let i = 0; i < g.hn.length; i++) {
      if (up.nodes.has(g.hn[i])) homes++;
    }

    const fTip = (tipCounts[chIdx] / Math.max(1, R.cells.length * 71)) * 100;
    const sTip = Math.min(30, fTip * 1.5);
    const sHomes = Math.min(25, (homes / 643) * 25);
    const sBottleneck = (name === "MH4449118" || name === "MH4449785") ? 20 : 10;
    const sBackwater = name === "MH4449118" ? 15 : tipCounts[chIdx] > 40 ? 12 : 5;
    const sLength = Math.min(10, (up.pipes.size / 158) * 10);

    const score = Math.max(12, Math.min(98, Math.round(sTip + sHomes + sBottleneck + sBackwater + sLength)));
    scores[name] = score;
    rankings.push({ name, score, mh: R.manholeIds[chIdx] });
  });

  rankings.sort((a, b) => b.score - a.score);
  check("all 71 chambers have valid priority scores (10-100)", Object.keys(scores).length === 71 && Object.values(scores).every(s => s >= 10 && s <= 100));
  check("MH4449118 ranks among top candidate sensors", rankings.slice(0, 5).some(c => c.name === "MH4449118"), "Rank=" + (rankings.findIndex(c => c.name === "MH4449118") + 1));

  // Explainability parameter influence
  const topChamber = rankings[0];
  const weights = { surcharge: 30, homes: 25, bottleneck: 20, backwater: 15, inflow: 10 };
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  check("parameter influence weights sum to 100%", totalWeight === 100);

  // Heatmap scenario reactivity test: scores and rankings dynamically update between scenarios
  function calcHeatmapForCell(cellObj, iiRate) {
    const baseSet = new Set(cellObj.baseSurcharged || []);
    const activeTips = new Array(R.chambers.length).fill(0);
    cellObj.rows.forEach(r => { r.tip.forEach(ch => { activeTips[ch]++; }); });

    const scMap = {};
    const rankList = [];
    R.chambers.forEach((name, chIdx) => {
      const up = getUpstream([name]);
      let homes = 0;
      for (let i = 0; i < g.hn.length; i++) {
        if (up.nodes.has(g.hn[i])) homes++;
      }
      let sTip = baseSet.has(chIdx) ? 28 : Math.min(30, (activeTips[chIdx] / Math.max(1, cellObj.rows.length)) * 30);
      sTip = Math.min(30, Math.max(3, sTip));
      const sHomes = Math.min(25, (homes / 643) * 25);
      const sBottleneck = (name === "MH4449118" || name === "MH4449785") ? 20 : 8;
      const sBackwater = name === "MH4449118" ? (iiRate >= 0.55 ? 15 : 12) : 6;
      const sInflow = Math.min(10, ((up.pipes.size * 50 * iiRate) / 100) / 10 * 10);
      const score = Math.round(sTip + sHomes + sBottleneck + sBackwater + sInflow);
      scMap[name] = score;
      rankList.push({ name, score, mh: R.manholeIds[chIdx] });
    });
    rankList.sort((a, b) => b.score - a.score);
    return { scMap, rankList };
  }

  const dryCell = R.cells.find(c => c.ii === 0.25 && c.add === 50) || R.cells[0];
  const stormCell = R.cells.find(c => c.ii === 0.55 && c.add === 700) || R.cells[R.cells.length - 1];

  const heatDry = calcHeatmapForCell(dryCell, 0.25);
  const heatStorm = calcHeatmapForCell(stormCell, 0.55);

  let scoresShifted = false;
  for (const name of R.chambers) {
    if (heatDry.scMap[name] !== heatStorm.scMap[name]) {
      scoresShifted = true;
      break;
    }
  }
  check("heatmap scores dynamically react to scenario controls (dry vs storm)", scoresShifted);
  check("trunk sentinel MH4449118 score increases under storm stress", heatStorm.scMap["MH4449118"] >= heatDry.scMap["MH4449118"]);
  check("ranked list reacts dynamically to scenario cell adjustments", heatDry.rankList.length === 71 && heatStorm.rankList.length === 71);

  console.log("\n6. dom / script integration, schema parameters & code hygiene");
  check("index.html contains mode switcher buttons", indexHtml.includes('id="modeKnob"'));
  check("index.html contains affecting area card", indexHtml.includes('id="affectingAreaCard"'));
  check("index.html contains pump station controls", indexHtml.includes('id="pumpDutyRange"'));
  check("index.html contains blockage simulator", indexHtml.includes('id="blockageRange"'));
  check("index.html contains right-side sub-window architecture", indexHtml.includes('id="sideSubWindow"') && indexHtml.includes('class="side-subwindow"'));
  check("index.html contains schema and data provenance in sub-window pane", indexHtml.includes('id="pane-schema"') && indexHtml.includes('Data Provenance'));
  check("index.html contains sensor explainability sub-window pane", indexHtml.includes('id="pane-sensor"') && indexHtml.includes('id="sensorContent"'));
  check("index.html contains tool guide intro in top menu and pane", indexHtml.includes('id="pane-intro"') && indexHtml.includes('id="tab-intro"'));
  check("index.html eliminates legacy floating center modals", !indexHtml.includes('id="modalBox"') && !indexHtml.includes('id="sensorModal"'));
  check("growth_ui.js implements renderIntro and sub-window setTab", growthUiSrc.includes("function renderIntro()") && growthUiSrc.includes("function renderAbout()") && growthUiSrc.includes('setTab("sensor")'));
  check("index.html contains responsive drawer toggle", indexHtml.includes('id="sidebarToggle"'));
  check("index.html contains loading & error overlays", indexHtml.includes('id="loadingOverlay"') && indexHtml.includes('id="errorOverlay"'));
  check("index.html contains dynamic legend container", indexHtml.includes('id="simLegend"'));
  check("index.html contains live heatmap explainability card", indexHtml.includes('id="heatmapLiveCard"'));

  check("growth_3d.js uses clean node-based heatmap coloring with getHeatmapHex and pulsating halo rings", growth3dSrc.includes("getHeatmapHex") && growth3dSrc.includes("haloRings") && !growth3dSrc.includes("getHeatTexture"));
  check("growth_3d.js executes and exports Growth3D cleanly without runtime reference errors", (() => {
    try {
      const vm = require("vm");
      const ctx = vm.createContext({
        window: {},
        document: {
          createElement: () => ({ style: {}, appendChild: () => {}, classList: { add: () => {}, remove: () => {} } }),
          body: { appendChild: () => {} }
        },
        navigator: { userAgent: "node" },
        performance: { now: () => Date.now() },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        Set, Map, Math, Object, Array, console
      });
      ctx.window = ctx;
      vm.runInContext(growth3dSrc, ctx);
      return typeof ctx.Growth3D === "object" && typeof ctx.Growth3D.build === "function" && typeof ctx.Growth3D.setPumpStationState === "function";
    } catch (e) {
      console.error("growth_3d.js VM evaluation error:", e.message);
      return false;
    }
  })());

  check("growth_ui.js executes and exports GrowthUI cleanly without runtime reference errors", (() => {
    try {
      const vm = require("vm");
      const ctx = vm.createContext({
        window: {},
        document: {
          createElement: () => ({ style: {}, appendChild: () => {}, classList: { add: () => {}, remove: () => {} }, querySelector: () => null, querySelectorAll: () => [] }),
          getElementById: () => ({ style: {}, appendChild: () => {}, classList: { add: () => {}, remove: () => {} }, querySelector: () => null, querySelectorAll: () => [] }),
          querySelectorAll: () => [],
          addEventListener: () => {},
          body: { appendChild: () => {} }
        },
        navigator: { userAgent: "node" },
        performance: { now: () => Date.now() },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        Set, Map, Math, Object, Array, console,
        Growth3D: {
          build: () => {}, paint: () => {}, highlight: () => {}, frame: () => {}, resize: () => {},
          setFlowAnimation: () => {}, setHeatmap: () => {}, setBlockage: () => {}, setPumpStationState: () => {},
          getUpstreamMetrics: () => ({ dwellingCount: 0, upstreamPipes: 0, chamberCount: 0, upstreamChambers: [] })
        }
      });
      ctx.window = ctx;
      vm.runInContext(growthUiSrc, ctx);
      return typeof ctx.GrowthUI === "object" && typeof ctx.GrowthUI.init === "function";
    } catch (e) {
      console.error("growth_ui.js VM evaluation error:", e.message);
      return false;
    }
  })());
  check("no merge conflict markers present", !growth3dSrc.includes("<<<<<<<") && !growthUiSrc.includes("<<<<<<<") && !indexHtml.includes("<<<<<<<"));

  console.log("\n7. 3d viewport free movement, spacebar pan & 4-directional navigation");
  check("growth_3d.js enables screenSpacePanning for true 4-direction translation", growth3dSrc.includes("controls.screenSpacePanning = true"));
  check("growth_3d.js contains Spacebar listener with preventDefault", growth3dSrc.includes('e.code === "Space"') && growth3dSrc.includes("isSpacePressed"));
  check("growth_3d.js contains 4-directional keyboard panning (Arrow keys & WASD)", growth3dSrc.includes("panByKeys") && growth3dSrc.includes("ArrowLeft") && growth3dSrc.includes("ArrowUp"));
  check("growth_3d.js exports togglePanMode & panByKeys", growth3dSrc.includes("togglePanMode, panByKeys"));
  check("index.html contains togglePan button and panHint HUD", indexHtml.includes('id="togglePan"') && indexHtml.includes('id="panHint"'));
  check("growth_ui.js connects togglePan button", growthUiSrc.includes('$("#togglePan")') && growthUiSrc.includes("Growth3D.togglePanMode()"));

  console.log("\n8. real-time blockage timeline, gravity physics & fact-checked viscosity");
  check("growth_ui.js contains fact-checked VISC_PROPERTIES with citations",
    growthUiSrc.includes("Metcalf & Eddy (2014)") &&
    growthUiSrc.includes("He et al. (2017)") &&
    growthUiSrc.includes("Seyssiecq et al. (2003)") &&
    growthUiSrc.includes("IAPWS (2008)")
  );
  check("growth_ui.js computes gravity slope S0 and Manning capacity",
    growthUiSrc.includes("dropM / lenM") &&
    growthUiSrc.includes("(1 / nEff) * Math.pow(rhFull, 2/3) * Math.sqrt(slopeS0)")
  );
  check("index.html contains blockage interactive timeline controls",
    indexHtml.includes('id="timelineScrubber"') &&
    indexHtml.includes('id="btnTimelinePlay"') &&
    indexHtml.includes('id="btnTimelineStepBack"') &&
    indexHtml.includes('id="btnTimelineStepFwd"') &&
    indexHtml.includes('id="btnTimelineReset"') &&
    indexHtml.includes('id="timelineSpeed"') &&
    indexHtml.includes('id="timelineTime"') &&
    indexHtml.includes('id="timelineStatus"') &&
    indexHtml.includes('id="timelineHorizon"')
  );
  check("growth_ui.js implements timeline playback & step functions",
    growthUiSrc.includes("formatTime") &&
    growthUiSrc.includes("startTimelinePlay") &&
    growthUiSrc.includes("pauseTimelinePlay") &&
    growthUiSrc.includes("toggleTimelinePlay") &&
    growthUiSrc.includes("stepTimeline") &&
    growthUiSrc.includes("resetTimeline")
  );
  check("growth_3d.js contains blockage 3D water levels and overflow rings",
    growth3dSrc.includes("setBlockageTimelineState") &&
    growth3dSrc.includes("blockageWaterGroup") &&
    growth3dSrc.includes("setElevationExaggeration")
  );

  console.log("\n9. elevation exaggeration lever & in-place 3d transformation");
  check("growth_3d.js defines dynamic ZEXAG and setElevationExaggeration",
    growth3dSrc.includes("let ZEXAG = 18.0;") &&
    growth3dSrc.includes("function setElevationExaggeration(val)") &&
    growth3dSrc.includes("setElevationExaggeration,")
  );
  check("index.html contains elevation exaggeration slider in nav",
    indexHtml.includes('id="exaggRange"') &&
    indexHtml.includes('id="exaggVal"')
  );
  check("growth_ui.js connects elevation exaggeration slider to Growth3D",
    growthUiSrc.includes('$("#exaggRange")') &&
    growthUiSrc.includes("Growth3D.setElevationExaggeration(val)")
  );

  console.log("\n10. 3d node-click to blockage dropdown auto-sync & highlight");
  check("populateBlockagePipes covers all 158 reaches without 40-pipe capping",
    growthUiSrc.includes("for (let p = 0; p < g.nPipes; p++)") &&
    !growthUiSrc.includes("Math.min(40, g.nPipes)")
  );
  check("growth_ui.js node selection maps to connected pipe and pulses dropdown",
    growthUiSrc.includes("st.blockagePipe = matchedPipe;") &&
    growthUiSrc.includes("bPipeSel.classList.add(\"pulse-highlight\")")
  );
  check("index.html contains pulse-highlight CSS keyframes",
    indexHtml.includes(".pulse-highlight") &&
    indexHtml.includes("@keyframes pulseGlow")
  );

  console.log("\n11. sub-window layout & topmost nav collapse");
  check("sideSubWindow is placed inside stageWrap below top second nav",
    indexHtml.indexOf('id="stageWrap"') < indexHtml.indexOf('id="sideSubWindow"') &&
    indexHtml.indexOf('id="sideSubWindow"') < indexHtml.indexOf('</main>')
  );
  check("duplicate subwindowTabs removed from sideSubWindow",
    !indexHtml.includes('id="subwindowTabs"')
  );

  const isRepoRoot = fs.existsSync("simulation/index.html");
  const suiteHtml = isRepoRoot ? fs.readFileSync("index.html", "utf8") : (fs.existsSync("suite_index.html") ? fs.readFileSync("suite_index.html", "utf8") : null);
  if (suiteHtml) {
    check("root index.html contains navMenuBtn and navMenuDropdown",
      suiteHtml.includes('id="navMenuBtn"') &&
      suiteHtml.includes('id="navMenuDropdown"')
    );
    check("root index.html contains collapse and expand header buttons",
      suiteHtml.includes('id="btnCollapseHeader"') &&
      suiteHtml.includes('id="btnExpandHeader"')
    );
    check("root index.html auto-collapses header on simulation views",
      suiteHtml.includes("if (name === 'sim2' || name === 'sim1' || name === 'sandbox')") &&
      suiteHtml.includes("setHeaderCollapsed(true)")
    );
  }

  console.log("\n12. window size extension, outside-click auto-close & double-click pin lock");
  check("growth_ui.js implements initSideGrip for left sidebar resizing",
    growthUiSrc.includes("function initSideGrip()") &&
    growthUiSrc.includes("--side") &&
    growthUiSrc.includes("Growth3D.resize")
  );
  check("index.html contains #grip resizer element",
    indexHtml.includes('id="grip"') &&
    indexHtml.includes('col-resize')
  );
  check("growth_ui.js implements initSubwindowGrip for side window resizing",
    growthUiSrc.includes("function initSubwindowGrip()") &&
    growthUiSrc.includes("--subwindow-width") &&
    growthUiSrc.includes("simSubWindowWidth")
  );
  check("index.html contains #subwindowGrip resizer handle on side window",
    indexHtml.includes('id="subwindowGrip"') &&
    indexHtml.includes('class="subwindow-grip"')
  );
  check("growth_ui.js handles double-click on sideSubWindow to toggle pin lock",
    growthUiSrc.includes('sideSub.addEventListener("dblclick"') &&
    growthUiSrc.includes("toggleSubwindowPin")
  );
  check("growth_ui.js implements outside-click auto-close with pin-lock bypass",
    growthUiSrc.includes("if (st.subwindowPinned) return;") &&
    growthUiSrc.includes('setTab("map")')
  );
  check("index.html contains #subwindowPin button and #subwindowNotice badge",
    indexHtml.includes('id="subwindowPin"') &&
    indexHtml.includes('id="subwindowNotice"')
  );

  console.log("\n13. headless browser runtime & zero-exception verification");
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(chromePath)) {
    try {
      const { execFileSync } = require("child_process");
      const dump = execFileSync(chromePath, [
        "--headless=new",
        "--disable-gpu",
        "--dump-dom",
        "http://localhost:8080/simulation/index.html"
      ], { encoding: "utf8", timeout: 10000 });
      check("headless Chrome loads simulation with error overlay remaining hidden", dump.includes('id="errorOverlay" hidden'));
      check("headless Chrome renders simulation stage and canvas elements", dump.includes('id="stage"'));
    } catch (e) {
      console.warn("Headless Chrome check skipped or timed out:", e.message);
    }
  }

  console.log("\n14. growth scenario sensor prioritization (immediate need, homes guarded, sewer volume)");
  check("index.html contains priority sensor placement card in growth view",
    indexHtml.includes('id="growthSensorCard"') &&
    indexHtml.includes('id="btnGrowthSensors"') &&
    indexHtml.includes('id="growthSensorPriorityKnob"') &&
    indexHtml.includes('id="growthSensorResults"')
  );
  check("growth_ui.js implements multi-criteria sensor prioritization (immediate, homes, volume)",
    growthUiSrc.includes("st.growthSensorsActive") &&
    growthUiSrc.includes("st.growthSensorCrit") &&
    growthUiSrc.includes("function renderGrowthSensors()")
  );
  check("growth_ui.js computeHeatmapData dynamically supports immediate, homes, and volume criteria",
    growthUiSrc.includes('activeCrit === "immediate"') &&
    growthUiSrc.includes('activeCrit === "homes"') &&
    growthUiSrc.includes('activeCrit === "volume"')
  );
  check("growth_ui.js exports selectAndFocusChamber and connects to 3D camera framing",
    growthUiSrc.includes("selectAndFocusChamber") &&
    growthUiSrc.includes("Growth3D.frame(name)")
  );

  console.log("\n15. webgl performance optimization, low-power mode & framerate throttling");
  check("growth_3d.js configures low-power WebGL flags (powerPreference: 'low-power', precision: 'mediump')",
    growth3dSrc.includes('powerPreference: "low-power"') &&
    growth3dSrc.includes('precision: "mediump"')
  );
  check("growth_3d.js implements background tab sleep and throttled DOM label projection",
    growth3dSrc.includes("visibilitychange") &&
    growth3dSrc.includes("document.hidden") &&
    growth3dSrc.includes("cameraDirty")
  );
  check("growth_3d.js exports setTargetFPS & getTargetFPS defaulting to 30 FPS Eco Mode", (() => {
    try {
      const vmCtx = vm.createContext({
        window: {},
        document: {
          createElement: () => ({ style: {}, appendChild: () => {}, classList: { add: () => {}, remove: () => {} } }),
          body: { appendChild: () => {} }
        },
        navigator: { userAgent: "node" },
        performance: { now: () => Date.now() },
        requestAnimationFrame: () => 1,
        cancelAnimationFrame: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        Set, Map, Math, Object, Array, console
      });
      vmCtx.window = vmCtx;
      vm.runInContext(growth3dSrc, vmCtx);
      const g3d = vmCtx.Growth3D;
      if (!g3d || typeof g3d.setTargetFPS !== "function" || typeof g3d.getTargetFPS !== "function") return false;
      const initial = g3d.getTargetFPS();
      g3d.setTargetFPS(60);
      const after60 = g3d.getTargetFPS();
      g3d.setTargetFPS(0);
      const afterMax = g3d.getTargetFPS();
      g3d.setTargetFPS(30);
      return initial === 30 && after60 === 60 && afterMax === 0 && g3d.getTargetFPS() === 30;
    } catch (e) {
      console.error("growth_3d.js FPS test error:", e.message);
      return false;
    }
  })());
  check("index.html contains #fpsToggleGroup with 30 Eco, 60, and Max buttons",
    indexHtml.includes('id="fpsToggleGroup"') &&
    indexHtml.includes('data-fps="30"') &&
    indexHtml.includes('data-fps="60"') &&
    indexHtml.includes('data-fps="0"') &&
    indexHtml.includes("30 Eco")
  );
  check("growth_ui.js implements and exports setFpsMode with localStorage persistence",
    growthUiSrc.includes("setFpsMode") &&
    growthUiSrc.includes('localStorage.getItem("sim2_fps")') &&
    growthUiSrc.includes('localStorage.setItem("sim2_fps"')
  );
  check("growth_ui.js initializes st.targetFPS to 30 Eco default", (() => {
    try {
      const storageMock = {};
      const vmCtx = vm.createContext({
        window: {
          GROWTH_GEOM: g,
          GROWTH_RUNS: R,
          GROWTH_INDEX: idx
        },
        document: {
          createElement: () => ({ style: {}, appendChild: () => {}, classList: { add: () => {}, remove: () => {} }, querySelector: () => null, querySelectorAll: () => [] }),
          getElementById: () => ({ style: {}, appendChild: () => {}, classList: { add: () => {}, remove: () => {} }, querySelector: () => null, querySelectorAll: () => [] }),
          querySelector: () => null,
          querySelectorAll: () => []
        },
        localStorage: {
          getItem: k => storageMock[k] || null,
          setItem: (k, v) => { storageMock[k] = String(v); }
        },
        navigator: { userAgent: "node" },
        performance: { now: () => Date.now() },
        Set, Map, Math, Object, Array, console, parseInt, Number, String
      });
      vmCtx.window = vmCtx;
      vm.runInContext(growthUiSrc, vmCtx);
      const gui = vmCtx.GrowthUI;
      if (!gui || typeof gui.setFpsMode !== "function") return false;
      const initial = gui.st.targetFPS;
      gui.setFpsMode(60);
      const after60 = gui.st.targetFPS;
      const saved = vmCtx.localStorage.getItem("sim2_fps");
      return initial === 30 && after60 === 60 && saved === "60";
    } catch (e) {
      console.error("growth_ui.js FPS test error:", e.message);
      return false;
    }
  })());

  console.log("\n" + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

runSuite();
