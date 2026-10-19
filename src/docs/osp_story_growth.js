/* The guided walkthrough, part 2: Simulation 2.5, where new homes would show and where a
   sensor must be to see them, ending with its results set against part 1's.

   As in part 1 (osp_story.js), the takeaways are COMPUTED. Every figure is read from the
   Sim 2.5 payload (simulation25/data: the SWMM grid as the builder published it) or
   scored by simulation25/placement.js, the same scoring the Sim 2.5 page uses and the
   suite checks against the builder. Nothing here runs SWMM; the physics is SWMM's saved
   answer. Where a figure is a declared input rather than a result, the step names the
   register row of the Sim 2.5 Assumptions tab that declares it.

   Pure logic, no DOM, so tools/test_sandbox.js renders every takeaway in Node.

   ctx: { g, R, I, C, PL } where g is GROWTH_GEOM, R is GROWTH_RUNS, I is GROWTH_INDEX,
   C is OSPCore and PL is the Sim 2.5 page's Placement module. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OSPStoryGrowth = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

/* The rule, objective and sensor count the comparison opens on: a 25 mm rise, the best
   worst case, three sensors. The rise rule is the one Sim 2.5's findings recommend over
   the alarm; three is where the published curves are still climbing steeply. */
const COMPARE = { rule: "r25", obj: "worst", k: 3 };
/* The single growth scenario step 4 opens on: Dry weather, 150 dwellings, the case Sim
   2.5's findings lead with (section 2: growth is invisible to the alarm until wet weather). */
const EXAMPLE = { case: 0, add: 150 };

const n = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pc = v => (v > 0 && v < 0.005 ? "under 1%" : Math.round(v * 100) + "%");

/* The Sim 2.5 map as an osp_core graph with polylines, so the story's map can draw it:
   the graph placement.js builds (same nodes, same order, observability already computed
   on the sandbox's defaults), plus each pipe's drawn line and its published attributes.
   Map units in the payload are decimetres from the outlet's origin; levels centimetres. */
function graph(g, R, C, PL) {
  const ctx = PL.context(g, R, C), G = ctx.G;
  G.polylines = g.up.map((_, l) => {
    const pts = [];
    for (let k = g.ptr[l]; k < g.ptr[l + 1]; k++) pts.push([g.px[k] / 10, g.py[k] / 10]);
    return pts;
  });
  G.pipes = { dia: Float64Array.from(g.dia, d => (d || 0) / 1000) };
  const nodeOfChamber = new Int32Array(R.chambers.length).fill(-1);
  ctx.chamberOfNode.forEach((c, v) => { if (c >= 0) nodeOfChamber[c] = v; });
  return { G, ctx, nodeOfChamber };
}

/* Every growth scenario SWMM solved for one case and rule: one row per (size, site),
   with the chambers that saw it. */
function scenarioRows(R, k, rule) {
  const out = [];
  for (const c of R.cells) if (c.case === k && c.rule === rule) for (const r of c.rows) out.push(r);
  return out;
}

function facts(ctx) {
  const { g, R, I, C, PL } = ctx;
  const memo = {};
  const once = (k, fn) => () => (k in memo ? memo[k] : (memo[k] = fn()));
  const base = once("graph", () => graph(g, R, C, PL));
  const peak = I.scenario.numbers.peakFactor;

  return {
    graph: base,

    area: once("area", () => ({
      pipes: g.nPipes, chambers: g.nChambers, homes: g.nHouses, dwellings: g.baseDwellings,
      km: g.metres / 1000,
      pumps: g.pumps.filter(p => p.modelled).length, pumpsAll: g.pumps.length,
      entries: g.context.entries.filter(e => e.into).length,
    })),

    load: once("load", () => ({
      peak,
      // G4: a new dwelling's flow at the peak hour, published per case; it is one figure.
      newLps: R.lpsPerDwelling[0], newLpd: R.lpsPerDwelling[0] * 86400 / peak,
      // What SWMM is given in each case, homes, outside inflow and I&I together, in L/s.
      caseLoad: R.baseLoads.map(a => a.reduce((x, y) => x + y, 0)),
      cases: R.cases.map(c => c.label),
      sizes: R.growthLevels,
    })),

    cases: once("cases", () => R.cases.map((c, k) => {
      const d = R.baseDepthMm[k].slice().sort((a, b) => a - b);
      return {
        label: c.label, note: c.note,
        over: R.baseOver[k].length, surcharged: R.baseSurcharged[k].length,
        spilled: R.baseSpilled[k].length, medianMm: d[d.length >> 1],
      };
    })),

    /* How many of each case's growth scenarios (328 sites x 5 sizes) some manhole sees,
       under each rule; and, per case and rule, the manhole that sees the most of them. */
    detect: once("detect", () => {
      const out = {};
      for (const { id } of R.rules) {
        out[id] = R.cases.map((_, k) => {
          const rows = scenarioRows(R, k, id), cnt = new Int32Array(R.chambers.length);
          let seen = 0;
          for (const r of rows) { if (r.tip.length) seen++; for (const t of r.tip) cnt[t]++; }
          let best = 0;
          for (let i = 1; i < cnt.length; i++) if (cnt[i] > cnt[best]) best = i;
          return { seen, total: rows.length, best, bestSees: cnt[best], bestShare: seen ? cnt[best] / seen : null };
        });
        /* The one sensor chosen across all cases for the best worst case, and the share of
           each case's growth it catches. placement.js drops cases nothing sees, as the
           builder does, so its shares are matched back to the cases that remain. */
        const first = R.sensors[id].worst.order[0];
        const shares = PL.cover(PL.scenarios(R, id), [first]);
        let j = 0;
        out[id].forEach(c => { c.shared = first; c.sharedShare = c.seen ? shares[j++] : null; });
      }
      const distinct = id => new Set(out[id].filter(c => c.bestSees).map(c => c.best)).size;
      const ex = id => {
        const c = R.cells.find(x => x.case === EXAMPLE.case && x.add === EXAMPLE.add && x.rule === id);
        return c ? c.rows.filter(r => r.tip.length).length : 0;
      };
      const sharedWorst = id => Math.min(...out[id].filter(c => c.seen).map(c => c.sharedShare));
      return { byRule: out, distinct, sharedWorst, example: { ...EXAMPLE, label: R.cases[EXAMPLE.case].label, alarm: ex("alarm"), r25: ex("r25"), sites: R.chambers.length } };
    }),

    /* Sim 2.5's own sensors, as published by the builder for each rule and objective. */
    sensors: once("sensors", () => {
      const s = R.sensors;
      return {
        maxK: R.maxSensors,
        r25worst: s.r25.worst.worst, alarmWorst: s.alarm.worst.worst,
        // The first sensor count at which the alarm's worst case reaches 1%.
        alarmFirstSeen: s.alarm.worst.worst.findIndex(v => v >= 0.01) + 1,
      };
    }),

    /* Part 1's question against part 2's, on part 2's network. Each method's k sensors are
       scored two ways: on the SWMM growth runs (placement.js, the Sim 2.5 page's own
       score) and on the blockage flood-fill of part 1 (nodes watched, osp_core.score). */
    compare: once("compare", () => compareAt(ctx, base(), COMPARE.rule, COMPARE.obj, COMPARE.k)),
  };
}

/* Every method at k sensors under one rule and objective. "swmm" is Sim 2.5's greedy as
   published; every other method is placed by placement.js. Cached per (rule, obj) because
   placement.js places 1..K in one go. */
function compareAt(ctx, base, rule, obj, k) {
  const { R, C, PL } = ctx;
  const cache = base._placed || (base._placed = {});
  const rows = PL.METHODS.map(([id, label]) => {
    let set, worst, mean;
    if (id === "swmm") {
      const pub = R.sensors[rule][obj];
      set = pub.order.slice(0, k); worst = pub.worst[k - 1]; mean = pub.mean[k - 1];
    } else {
      const key = id + "|" + rule + "|" + obj;
      const p = cache[key] || (cache[key] = PL.place(id, base.ctx, rule, obj));
      set = p.sets[k - 1]; worst = p.worst[k - 1]; mean = p.mean[k - 1];
    }
    const nodes = set.map(c => base.nodeOfChamber[c]).filter(v => v >= 0);
    return { id, label, set, worst, mean, blockage: C.score(base.G, nodes).nodes };
  });
  const by = Object.fromEntries(rows.map(r => [r.id, r]));
  const a = new Set(by.swmm.set);
  return {
    rule, obj, k, rows, by, universe: base.G.obs.universeSize,
    overlap: by.celf.set.filter(c => a.has(c)).length,
  };
}

const RULE_LABEL = { alarm: "the 150 mm alarm", r10: "a 10 mm rise", r25: "a 25 mm rise", r50: "a 50 mm rise" };

const STEPS = [
  {
    view: "area",
    title: "The model area",
    description:
      "Part 2 asks a different question on part of the same council network: if new homes " +
      "connect, which manholes' water levels respond? Every pipe draining to the end of the " +
      "council data is modelled in EPA SWMM. Hover a pipe or manhole for what is recorded.",
    takeaway: F => {
      const f = F.area();
      return `${n(f.pipes)} pipes and ${f.chambers} manholes over ${f.km.toFixed(1)} km carry the sewage of ` +
        `${n(f.homes)} homes to one outlet, through ${f.pumps} modelled pump stations. Pipes from outside ` +
        `the council area join at ${f.entries} points, each given a sized inflow.`;
    },
  },
  {
    view: "load",
    title: "Where the sewage comes from",
    description:
      "Each home's sewage enters at the manhole its connection joins. The model is solved at " +
      "the peak hour, held steady until the network settles. The map sizes each manhole by the " +
      "dwellings that drain into it directly.",
    takeaway: F => {
      const f = F.load();
      return `A new dwelling adds ${Math.round(f.newLpd)} litres a day, ${f.peak} times that at the peak ` +
        `hour (register G4, P02). With groundwater, rain and outside inflow added, the load SWMM is ` +
        `given runs from ${Math.round(Math.min(...f.caseLoad))} to ${Math.round(Math.max(...f.caseLoad))} L/s ` +
        `across the five cases.`;
    },
  },
  {
    view: "cases",
    title: "Five versions of the unknowns",
    description:
      "How much groundwater and rain get into the pipes, whether older pipes leak more, and how " +
      "much flows in from outside are not measured. Each case is one answer to those, and every " +
      "result after this is computed in all five. Pick a case to see its levels before any growth.",
    takeaway: F => {
      const c = F.cases();
      // Ties go to the earlier case, which lists Dry before the wet ones.
      const lo = c.reduce((a, b) => (b.over < a.over ? b : a)), hi = c.reduce((a, b) => (b.over > a.over ? b : a));
      return `Before any growth, ${lo.over} manholes are already over the 150 mm alarm in ${lo.label} ` +
        `and ${hi.over} in ${hi.label}. A manhole already over its alarm cannot newly pass it, whatever growth arrives.`;
    },
  },
  {
    view: "growth",
    title: "Add homes at one manhole",
    description:
      "SWMM was run with growth added at each manhole in turn, at five sizes, in every case. " +
      "Click a manhole to put the growth there, and see which manholes notice it under each way " +
      "of noticing.",
    takeaway: F => {
      const e = F.detect().example;
      return `In ${e.label.toLowerCase()} weather, ${e.add} new dwellings at one manhole raise some manhole by 25 mm for ` +
        `${e.r25} of the ${e.sites} places they could go, and push one newly past the 150 mm alarm for ` +
        `${e.alarm ? "only " + e.alarm : "none of them"}.`;
    },
  },
  {
    view: "robust",
    title: "Is the answer stable?",
    description:
      "Each case has its own best manhole, the one that sees the most growth. A sensor has to be " +
      "placed before anyone knows which case is true, so what matters is how much one manhole chosen " +
      "for all cases still catches. The map marks each case's best manhole and the shared choice.",
    takeaway: F => {
      const d = F.detect();
      return `Under the alarm, the manhole that sees the most growth is a different one in ${d.distinct("alarm")} ` +
        `of ${d.byRule.alarm.length} cases, and one sensor chosen for all of them catches ${pc(d.sharedWorst("alarm"))} ` +
        `of growth in its worst case. Under a 25 mm rise the best manhole still moves, but one shared sensor ` +
        `catches ${pc(d.sharedWorst("r25"))} even in the worst.`;
    },
  },
  {
    view: "sensors",
    title: "Sensors chosen across every case",
    description:
      "Sim 2.5's greedy adds one sensor at a time, each the manhole that most improves the share " +
      "of growth caught, judged on the SWMM runs in all five cases, for the worst case or the " +
      "average.",
    takeaway: F => {
      const s = F.sensors(), w = s.r25worst;
      return `For the best worst case under a 25 mm rise, one sensor catches ${pc(w[0])} of growth and ` +
        `${s.maxK} catch ${pc(w[s.maxK - 1])}. Under the alarm the worst case stays under 1% until ` +
        `sensor ${s.alarmFirstSeen}.`;
    },
  },
  {
    view: "caveats",
    title: "What it rests on",
    description:
      "What every result in part 2 assumes. The Sim 2.5 page's Assumptions tab is the full " +
      "register, with a source for every row.",
    takeaway: () =>
      "The model is uncalibrated: no level or flow record from this network has been compared " +
      "with it, and the rise that counts as noticing needs normal-day level records to set.",
  },
  {
    view: "compare",
    title: "Comparing the results",
    description:
      "Both parts placed sensors. Here every method, part 1's blockage greedy among them, places " +
      "sensors on part 2's network, and each set is scored both ways: the share of growth SWMM " +
      "says it catches, and the nodes part 1's blockage model says it watches.",
    takeaway: F => {
      const c = F.compare(), s = c.by.swmm, b = c.by.celf;
      return `With ${c.k} sensors and ${RULE_LABEL[c.rule]}, the growth greedy catches ${pc(s.worst)} of ` +
        `growth in the worst case and part 1's blockage greedy ${pc(b.worst)}. On part 1's blockage measure ` +
        `the order ${b.blockage > s.blockage ? "flips" : "holds"}: ${b.blockage} nodes watched against ` +
        `${s.blockage}. The two questions want different manholes.`;
    },
  },
];

/* Part 2's caveats, each citing the Sim 2.5 register row or findings section it restates.
   `show` names what the map highlights. */
const CAVEATS = [
  {
    title: "Uncalibrated", src: "Sim 2.5, About", show: "none",
    text: (F, I) => I.scenario.caveat,
  },
  {
    title: "The rise that counts as noticing is not known",
    src: "Sim 2.5 Findings, section 4", show: "none",
    text: () => "Which manholes are chosen depends on the rise threshold, and that depends on how much a " +
      "manhole's level varies on a normal day. Only real level records at candidate manholes can set it.",
  },
  {
    title: "One steady peak, not a day",
    src: "Sim 2.5 register R1, R9", show: "none",
    text: F => `Every run holds the peak-hour load (x${F.load().peak}) until the network settles. Growth ` +
      `is compared at the peak; the trough, and the day-to-day variation a sensor would really see, are not modelled.`,
  },
  {
    title: "Pump stations pass everything straight on",
    src: "Sim 2.5 register L7", show: "pumps",
    text: F => `The ${F.area().pumps} modelled stations are ideal pumps in the published grid: whatever reaches ` +
      `the wet well leaves at once. A real station pumps in bursts, so a sensor below it sees pump cycles.`,
  },
  {
    title: "Outside inflow is sized, not measured",
    src: "Sim 2.5 register L4, P25", show: "entries",
    text: F => `At ${F.area().entries} points where an outside pipe enters, the inflow is estimated from the ` +
      `length of pipe behind it. One case scales it by 1.5; the true figure is not published.`,
  },
  {
    title: "Growth arrives at one manhole at a time",
    src: "Sim 2.5 register G3", show: "none",
    text: () => "Each grid run adds dwellings at a single manhole. Growth spread over many manholes is " +
      "solved only in scenarios a reader builds on the Sim 2.5 page.",
  },
  {
    title: "The growth greedy is scored on the runs it was chosen from",
    src: "simulation25/placement.js", show: "none",
    text: () => "Its coverage is in-sample: an upper bound for growth it was not shown. Every other " +
      "method is placed without seeing the runs.",
  },
];

return { STEPS, CAVEATS, COMPARE, EXAMPLE, RULE_LABEL, pc, facts, graph, compareAt, scenarioRows };
});
