/* blockage_physics.js — Client-side real-time sewer blockage & backwater hydraulic model.
   No DOM, no THREE.js dependencies. Loadable in Node, web workers, and browsers via UMD.

   WHY THIS EXISTS
   ---------------
   Simulation 2 operates two hydraulic engines:
   1. simulation/data/growth.js: 852 offline EPA SWMM 5.2 dynamic-wave solves (Preissmann slot).
   2. This module: Real-time closed-form Manning capacity, nonlinear circular-segment depth,
      and backwater hydraulic head propagation for interactive timeline scrubbing.

   FORMULATIONS & CITATIONS
   ------------------------
   - Full-bore conveyance: Manning's Equation: v = (1/n) * R_h^(2/3) * S_0^(1/2), Q = v * A
   - Kinematic Viscosity & effective roughness (nEff):
       * Domestic: Metcalf & Eddy (2014) Wastewater Engineering 5th Ed; Alshami et al. (2023)
       * High Grease/FOG: He et al. (2017) Water Research; Keener et al. (2008)
       * Cold Heavy Sludge: Seyssiecq et al. (2003) Process Biochem; Metcalf & Eddy (2014)
       * Clean Water: IAPWS (2008) Pure Water Standard Baseline
   - Partial Pipe Depth: Solved from circular-segment area fraction Af = accumM3 / pipeVolM3:
       Af * (pi * D^2 / 4) = (D^2 / 8) * (theta - sin(theta))
       depth = (D / 2) * (1 - cos(theta / 2))
       Solved via bounded monotonic bisection (exact at Af = 0.5 -> depth = D/2).
   - Choke Exponent: Q_choked = Q_cap * (1 - sev / 100)^1.8 (Declared modeling assumption A).
   - Shaft Diameter: 1050 mm uniform circular proxy (Declared modeling assumption A).
*/

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BlockagePhysics = factory();
  }
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : this), function () {
  "use strict";

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

  /**
   * Solve central angle theta (radians) from circular area fraction Af in [0, 1].
   * Af = (theta - sin(theta)) / (2 * pi)
   */
  function solveThetaFromAreaFraction(af) {
    if (af <= 0) return 0;
    if (af >= 1) return 2 * Math.PI;
    if (Math.abs(af - 0.5) < 1e-12) return Math.PI;

    let lo = 0;
    let hi = 2 * Math.PI;
    const target = 2 * Math.PI * af;

    // 35 bisections guarantees precision to < 2 * pi / 2^35 ~= 1.8e-10 radians
    for (let i = 0; i < 35; i++) {
      const mid = (lo + hi) * 0.5;
      const f = mid - Math.sin(mid);
      if (f < target) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return (lo + hi) * 0.5;
  }

  /**
   * Compute water depth inside a circular pipe of diameter D from area fraction Af.
   * Exact boundary conditions:
   *   Af <= 0   -> 0
   *   Af = 0.5 -> D / 2 exactly
   *   Af >= 1   -> D
   */
  function solveCircularDepth(af, diaM) {
    if (af <= 0) return 0;
    if (af >= 1.0) return diaM;
    if (Math.abs(af - 0.5) < 1e-12) return diaM * 0.5;

    const theta = solveThetaFromAreaFraction(af);
    return (diaM * 0.5) * (1 - Math.cos(theta * 0.5));
  }

  /**
   * Cached network topology builder (pure graph traversal).
   */
  let topoCacheGeom = null;
  let cachedTopo = null;

  function topology(geom) {
    if (topoCacheGeom === geom && cachedTopo) return cachedTopo;
    const g = geom;
    const n = g.nodes.length;
    const into = Array.from({ length: n }, () => []);
    const downOf = new Array(n).fill(-1);

    for (let p = 0; p < g.nPipes; p++) {
      into[g.down[p]].push(p);
      if (downOf[g.up[p]] < 0) downOf[g.up[p]] = g.down[p];
    }

    const firstMh = new Array(n);
    for (let i = 0; i < n; i++) {
      let j = i;
      let hops = 0;
      while (j >= 0 && g.nodes[j].kind !== "chamber" && hops++ <= n) {
        j = downOf[j];
      }
      firstMh[i] = j >= 0 && g.nodes[j].kind === "chamber" ? j : -1;
    }

    const idxOf = {};
    g.nodes.forEach((nd, i) => {
      idxOf[nd.name] = i;
    });

    cachedTopo = { into, firstMh, idxOf, downOf };
    topoCacheGeom = geom;
    return cachedTopo;
  }

  /**
   * Upstream ancestor node and pipe traversal.
   */
  function upstream(geom, names, topo) {
    const g = geom;
    const t = topo || topology(geom);
    const nodes = new Set();
    const pipes = new Set();
    const stack = [];

    names.forEach((nm) => {
      if (nm in t.idxOf) stack.push(t.idxOf[nm]);
    });

    while (stack.length) {
      const i = stack.pop();
      if (nodes.has(i)) continue;
      nodes.add(i);
      t.into[i].forEach((p) => {
        pipes.add(p);
        stack.push(g.up[p]);
      });
    }

    return { nodes, pipes };
  }

  /**
   * Compute comprehensive metrics for all areas that affect a node.
   * Returns upstreamChambers AND upstreamPipes array.
   */
  function getUpstreamMetrics(geom, name, topo) {
    const g = geom;
    const t = topo || topology(geom);
    if (!g || !(name in t.idxOf)) return null;

    const up = upstream(geom, [name], t);
    let totalLengthM = 0;
    for (const p of up.pipes) {
      const a = g.ptr[p];
      const b = g.ptr[p + 1];
      let lenDm = 0;
      for (let i = a; i < b - 1; i++) {
        lenDm += Math.hypot(g.px[i + 1] - g.px[i], g.py[i + 1] - g.py[i]);
      }
      totalLengthM += lenDm * 0.1;
    }

    let homesCount = 0;
    if (g.hn) {
      for (let i = 0; i < g.hn.length; i++) {
        if (up.nodes.has(g.hn[i])) homesCount++;
      }
    }

    const targetIdx = t.idxOf[name];
    let directHomes = 0;
    if (g.hn) {
      for (let i = 0; i < g.hn.length; i++) {
        if (t.firstMh[g.hn[i]] === targetIdx) directHomes++;
      }
    }

    const qDry = (homesCount * 500 * 2) / 86400; // 500 L/day, PF=2
    const upstreamChambers = [];
    up.nodes.forEach((ndIdx) => {
      if (g.nodes[ndIdx].kind === "chamber" && ndIdx !== targetIdx) {
        upstreamChambers.push(g.nodes[ndIdx].name);
      }
    });

    return {
      nodeName: name,
      pipesCount: up.pipes.size,
      totalLengthM: Math.round(totalLengthM * 10) / 10,
      homesCount,
      directHomes,
      upstreamChambersCount: upstreamChambers.length,
      upstreamChambers,
      upstreamPipes: Array.from(up.pipes),
      estimatedDryFlowLps: Math.round(qDry * 100) / 100,
    };
  }

  /**
   * Pure physics evaluation of network blockage state at time t.
   *
   * @param {Object} params
   * @param {Object} params.geom Catchment geometry
   * @param {number} params.pipeIdx Index of blocked pipe
   * @param {number} params.severity Choke severity % [0, 95]
   * @param {string} [params.viscMode="domestic"] Fluid viscosity key
   * @param {number} [params.iiRate=0.25] Infiltration rate (L/s per 100m)
   * @param {number} [params.timelineSec=0] Elapsed simulation time in seconds
   * @param {Object} [params.upstreamMetrics=null] Optional precomputed metrics
   */
  function computeBlockageState(params) {
    const {
      geom: g,
      pipeIdx: p,
      severity: sev = 0,
      viscMode = "domestic",
      iiRate = 0.25,
      timelineSec = 0,
      upstreamMetrics = null,
    } = params;

    if (!g || p == null || p < 0 || p >= g.nPipes || sev <= 0) {
      return {
        pipeIdx: p,
        severity: 0,
        chamberLevels: {},
        overflowing: [],
        backwaterPipes: [],
        timeToSpillSec: Infinity,
        timeToSpillMin: Infinity,
        timelineMaxSec: 3600,
        timelineSec,
        excessLps: 0,
        qCapLps: 0,
        qChokedLps: 0,
        qInLps: 0,
        h0: 0,
        isSpill: false,
        isShaftSurcharging: false,
      };
    }

    const uNode = g.nodes[g.up[p]];
    const dNode = g.nodes[g.down[p]];
    const upMetrics = upstreamMetrics || getUpstreamMetrics(g, uNode.name);

    // Physical pipe geometry
    const diaM = (g.dia[p] || 150) / 1000;
    const a = g.ptr[p];
    const b = g.ptr[p + 1];
    let lenM = 0;
    for (let i = a; i < b - 1; i++) {
      const dx = (g.px[i + 1] - g.px[i]) / 10;
      const dy = (g.py[i + 1] - g.py[i]) / 10;
      lenM += Math.sqrt(dx * dx + dy * dy);
    }
    lenM = Math.max(15, lenM);
    const dropM = Math.abs(g.zu[p] - g.zd[p]) / 100;
    const slopeS0 = Math.max(0.0015, dropM / lenM);

    // Fluid viscosity & Manning roughness
    const vProp = VISC_PROPERTIES[viscMode] || VISC_PROPERTIES.domestic;
    const nEff = vProp.nEff;

    // Gravity conveyance: v = (1/n) * R^(2/3) * S^(1/2), Q = v * A
    const areaFull = Math.PI * Math.pow(diaM / 2, 2);
    const rhFull = diaM / 4;
    const vFull = (1 / nEff) * Math.pow(rhFull, 2 / 3) * Math.sqrt(slopeS0); // m/s
    const qCapLps = vFull * areaFull * 1000; // L/s

    // Choked capacity via power law: (1 - sev/100)^1.8
    const qChokedLps = qCapLps * Math.pow(1 - sev / 100, 1.8);
    const capacityReductionPct = Math.round((1 - Math.pow(1 - sev / 100, 1.8)) * 100);

    // Tributary inflow under active weather scenario
    const homes = upMetrics ? upMetrics.homesCount : 24;
    const tribLenM = upMetrics ? upMetrics.totalLengthM : 650;
    const qDryLps = homes * ((500 * 2.0) / 86400); // 500 L/dwelling/day * PF 2.0
    const qWetLps = tribLenM * (iiRate / 100);
    const qInLps = Math.max(1.5, qDryLps + qWetLps);

    // Excess backwater accumulation
    const excessLps = Math.max(0, qInLps - qChokedLps);
    const pipeVolM3 = areaFull * lenM;
    const shaftAreaM2 = Math.PI * Math.pow(1.05 / 2, 2); // 0.8659 m^2 standard 1050 mm circular shaft
    const depthM = uNode.depth || 2.4;
    const shaftVolM3 = shaftAreaM2 * depthM;
    const totalSpillVolM3 = pipeVolM3 + shaftVolM3;

    // Warning horizon to overflow
    const timeToSpillSec = excessLps > 0 ? (totalSpillVolM3 * 1000) / excessLps : Infinity;
    const timeToSpillMin = isFinite(timeToSpillSec) ? Math.round(timeToSpillSec / 60) : Infinity;
    const timelineMaxSec = isFinite(timeToSpillSec)
      ? Math.max(1800, Math.ceil((timeToSpillSec * 1.35) / 300) * 300)
      : 3600;

    // Current state at simulated time t = timelineSec
    const t = timelineSec;
    const accumM3 = (excessLps * t) / 1000;

    const chamberLevels = {};
    const overflowing = [];
    const backwaterPipes = [p];

    let h0 = 0;
    if (accumM3 <= pipeVolM3) {
      // Stage 1: Filling pipe bore using circular segment formula
      const af = Math.max(0, Math.min(1.0, accumM3 / Math.max(0.001, pipeVolM3)));
      h0 = solveCircularDepth(af, diaM);
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
        const cNode = g.nodes.find((n) => n.name === cName);
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

    const isSpill = h0 >= depthM;
    const isShaftSurcharging = h0 > diaM;

    return {
      pipeIdx: p,
      severity: sev,
      diaM,
      lenM,
      dropM,
      slopeS0,
      vProp,
      nEff,
      areaFull,
      rhFull,
      vFull,
      qCapLps,
      qChokedLps,
      capacityReductionPct,
      homes,
      tribLenM,
      qDryLps,
      qWetLps,
      qInLps,
      excessLps,
      pipeVolM3,
      shaftAreaM2,
      depthM,
      shaftVolM3,
      totalSpillVolM3,
      timeToSpillSec,
      timeToSpillMin,
      timelineMaxSec,
      timelineSec: t,
      accumM3,
      h0,
      zWater,
      isSpill,
      isShaftSurcharging,
      chamberLevels,
      overflowing,
      backwaterPipes,
      uNode,
      dNode,
      upMetrics,
    };
  }

  return {
    VISC_PROPERTIES,
    solveThetaFromAreaFraction,
    solveCircularDepth,
    topology,
    upstream,
    getUpstreamMetrics,
    computeBlockageState,
  };
});
