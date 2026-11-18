/* greenfield_runs.js - Sim 4's greenfield runs in the shape the explorer's greenfield family reads.

   The explorer's "A new estate at one manhole" family was written for Sim 3's grid
   (window.GROWTH_RUNS: every manhole, five fixed sizes). Sim 4 runs greenfield only at the
   9 connections of simulation_src/sim4_greenfield.py: one per land group of open land at the
   network's edge and per distinct set of downstream sensors, 5 of them manholes and 4 of them
   pipe ends. Each connection runs its own sizes (10 to 1,000 homes, capped at the pipe room
   from the sewer supplement's Table 4.4), from data/greenfield.js. This file rebuilds the
   grid from those runs so the same panels, map states and sensor scores work unchanged:

     cells     {case, add, rule, base, rows: [{site, tip}]}, one per case, size and rule. A
               size holds the sites that were run at it; a site's own sizes are stepsAt[site].
     tip       the manholes that see the run: a rise of at least 10, 25 or 50 mm over the
               same case's no-growth level, or newly past the 150 mm alarm.
     baseline  the infill family's settled no-growth runs of the same case (data/regions.js);
               both families run the same model on the same settle gate.
     heat, sensors   each manhole's share of the detectable greenfield runs it sees, and the
               greedy order on those runs, as the Sim 3 grid published them.
     siteList  the 9 connections: {id, site, chamber, land, kind, x, y, steps, pumped}. A
               manhole connection's site key is its chamber index; a pipe end, which is not
               a chamber, takes a key from chambers.length upward (siteName holds its id).
     exits     where sewage leaves the model; never a connection, drawn as a quiet marker.

   The chamber list, manhole ids and homes per manhole stay Sim 3's (the same 328 chambers),
   so sensors and heat stay on chambers. Runs that did not settle carry no rises and are left
   out. growthLevels is set by the page: the selected site's own sizes. */
"use strict";
(function () {
  const G3 = window.GROWTH_RUNS, GF = window.SIM4_GREENFIELD, S = window.SIM3_REGIONS;
  if (!G3 || !GF || !S) return;
  const idx = {};
  G3.chambers.forEach((n, i) => { idx[n] = i; });
  const RULES = [{ id: "r10", mm: 10 }, { id: "r25", mm: 25 }, { id: "r50", mm: 50 }];
  const ALARM = G3.alarmMm || 150;

  const cases = G3.cases.map(c => Object.assign({}, c, { settled: true, unconverged: 0, method: "settled" }));
  const base = cases.map(c => S.base[c.tag]);
  const depth = base.map(b => G3.chambers.map((_, i) => (b && b.depthMm[i] != null ? b.depthMm[i] : 0)));
  const sites = [], stepsAt = {}, cells = [], spill = cases.map(() => ({}));
  const cellOf = {};
  const getCell = (ci, add, rule) => {
    const k = ci + "|" + add + "|" + rule;
    if (!cellOf[k]) {
      cellOf[k] = { case: ci, add, rule, base: rule === "alarm" ? (base[ci] ? base[ci].alarm.slice() : []) : [], rows: [] };
      cells.push(cellOf[k]);
    }
    return cellOf[k];
  };

  const siteList = [], siteName = {};
  GF.sites.forEach(s => {
    const chamber = idx[s.id] === undefined ? null : idx[s.id];
    const si = chamber != null ? chamber : G3.chambers.length + siteList.filter(x => x.chamber == null).length;
    siteName[si] = s.id;
    siteList.push({ id: s.id, site: si, chamber, land: s.land, kind: s.kind, x: s.x, y: s.y,
                    steps: s.steps.slice(), pumped: s.pumped, pumpedKnown: s.pumped_known });
    sites.push(si);
    stepsAt[si] = s.steps.slice();
    cases.forEach((c, ci) => {
      const rec = s.cases[c.tag];
      if (!rec) return;
      rec.rows.forEach(r => {
        const g = r.greenfield, add = r.homes;
        if (!g || !g.rise_mm) return;
        if (g.run && g.run.converged === false) cases[ci].unconverged++;
        const rise = [];
        for (const nm in g.rise_mm) if (idx[nm] !== undefined) rise.push([idx[nm], g.rise_mm[nm]]);
        RULES.forEach(rl => getCell(ci, add, rl.id).rows.push({ site: si, tip: rise.filter(x => x[1] >= rl.mm).map(x => x[0]).sort((a, b) => a - b) }));
        const d0 = depth[ci];
        getCell(ci, add, "alarm").rows.push({ site: si, tip: rise.filter(x => d0[x[0]] < ALARM && d0[x[0]] + x[1] >= ALARM).map(x => x[0]).sort((a, b) => a - b) });
        const fl = (g.flooded || []).map(n => idx[n]).filter(i => i !== undefined);
        if (fl.length) (spill[ci][String(add)] = spill[ci][String(add)] || []).push([si, fl]);
      });
    });
  });

  // Per case, the runs some manhole sees under the rule, each as its set of seeing manholes.
  const n = G3.chambers.length, ruleIds = ["alarm", "r10", "r25", "r50"];
  const detected = rule => cases.map((_, ci) => cells.filter(c => c.case === ci && c.rule === rule)
    .flatMap(c => c.rows).filter(r => r.tip.length).map(r => new Set(r.tip))).filter(runs => runs.length);
  const heat = {}, sensors = {}, maxSensors = G3.maxSensors || 10;
  ruleIds.forEach(rule => {
    const det = detected(rule);
    const worst = new Array(n).fill(0), mean = new Array(n).fill(0);
    if (det.length) for (let i = 0; i < n; i++) {
      const sh = det.map(runs => runs.filter(t => t.has(i)).length / runs.length);
      worst[i] = Math.min(...sh);
      mean[i] = sh.reduce((a, b) => a + b, 0) / sh.length;
    }
    heat[rule] = { worst, mean };
    // Greedy: each sensor the one that most raises the objective over the set so far.
    const score = set => {
      if (!det.length) return { worst: 0, mean: 0 };
      const sh = det.map(runs => runs.filter(t => set.some(i => t.has(i))).length / runs.length);
      return { worst: Math.min(...sh), mean: sh.reduce((a, b) => a + b, 0) / sh.length };
    };
    sensors[rule] = {};
    ["worst", "mean"].forEach(obj => {
      const order = [], w = [], m = [];
      for (let k = 0; k < maxSensors; k++) {
        let best = -1, bestV = -1, bestTie = -1;
        for (let i = 0; i < n; i++) {
          if (order.includes(i)) continue;
          const s = score(order.concat(i)), v = s[obj], tie = obj === "worst" ? s.mean : s.worst;
          if (v > bestV + 1e-12 || (Math.abs(v - bestV) <= 1e-12 && tie > bestTie + 1e-12)) { best = i; bestV = v; bestTie = tie; }
        }
        order.push(best);
        const s = score(order);
        w.push(+s.worst.toFixed(4)); m.push(+s.mean.toFixed(4));
      }
      sensors[rule][obj] = { order, worst: w, mean: m };
    });
  });

  // With no site selected, the size knob offers the full ladder (the longest connection's sizes).
  const levels = siteList.reduce((a, x) => (x.steps.length > a.length ? x.steps : a), []).slice();
  window.SIM4_GF_RUNS = Object.assign({}, G3, {
    source: "Sim 4 greenfield (data/greenfield.js)",
    cases, cells, spill, heat, sensors, sites, stepsAt,
    siteList, siteName, exits: (GF.exits || []).slice(),
    defaultLevels: levels,
    growthLevels: levels,
    lpsPerDwelling: null,
    baseDepthMm: depth,
    baseOver: base.map(b => (b ? b.alarm.slice() : [])),
    baseSurcharged: base.map(b => (b ? b.surcharged.slice() : [])),
    baseSpilled: base.map(b => (b ? b.spilled.slice() : [])),
  });
})();
