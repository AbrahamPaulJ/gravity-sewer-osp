/* The guided walkthrough: eight steps from the network to its caveats, each with a
   title, a line on how to use the screen, and the one sentence a reader should leave
   with.

   The takeaways are COMPUTED, not typed. Each is a function of the facts below, and
   the facts are read from the loaded dataset through the same model calls the sandbox
   makes, so a takeaway cannot drift out of step with the data the way a quoted figure
   can. This is the rule osp_docs.js follows for the assumptions register.

   The few figures the shipped data cannot reproduce are in CITED, each with the place
   it is established. They come from the harvest, which reads fields the published
   payload no longer carries (the per-pipe end inverts, the geometry-anchored reading).

   Pure logic, no DOM, so tools/test_sandbox.js renders every takeaway in Node.

   The story arc follows a second implementation on the same network (a React demo in a
   private repository), rebuilt on this repository's own models: the headroom flood-fill
   in place of k-hop reach, the per-chamber demand ladder in place of a house-by-house
   load, and the sandbox's own algorithms in place of a precomputed MILP. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.OSPStory = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

/* Figures established outside the payload. Quote them with their source. */
const CITED = {
  reversedIfGeometry: { value: 583, src: "README, finding 2" },
  invertBadIfGeometry: { value: 462, src: "README, finding 2" },
  gradeMedianRatio: { value: "1.0000", src: "README, finding 4" },
};

/* The detection threshold the sandbox starts at (S.threshold in osp_ui.js). Declared,
   not calibrated: see the register, Part A. */
const THRESHOLD_M = 0.05;
/* The budget every placement comparison uses, as in the regression suite. */
const BUDGET = 40;
/* The demand ladder of the register's capacity table (CAP_LADDER in osp_docs.js). */
const DEMAND = [0.05, 0.1, 0.2, 0.4, 0.9];

const ALGOS = [
  ["twoupdown", "two up, two down"],
  ["upstream", "largest upstream catchment"],
  ["between", "highest betweenness"],
  ["outdeg", "highest out-degree"],
  ["indeg", "highest in-degree"],
];

/* Seeded, so the random baseline in a takeaway is the same on every load. */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* Thousands separated by a comma, independent of the reader's locale. */
const n = v => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/* The facts every takeaway reads, in groups, each computed once on first use.
   ctx: { raw, C, K, codes } where raw is one region of OSP_DATA, C is OSPCore and K is
   OSPCapacity. The observability groups build their own graph, because
   computeObservable replaces g.obs and the map's graph must keep the default model. */
function facts(ctx) {
  const { raw, C, K, codes } = ctx;
  const memo = {};
  const once = (k, fn) => () => (k in memo ? memo[k] : (memo[k] = fn()));
  const observed = opt => {
    const g = C.buildGraph(raw);
    C.computeObservable(g, opt);
    return g;
  };
  const headroom = once("g", () => observed({ model: "headroom", threshold: THRESHOLD_M }));

  return {
    network: once("network", () => {
      const st = raw.stats;
      return {
        nodes: st.nodes, reaches: st.pipes_used,
        manholes: raw.nodes.mh.reduce((a, b) => a + b, 0),
        km: raw.lengths.reduce((a, b) => a + b, 0) / 1000,
        components: st.components, largest: st.largest_component,
      };
    }),

    data: once("data", () => {
      const pa = raw.stats.pipe_attrs, ds = C.depthStats(headroom());
      return {
        reaches: raw.stats.pipes_used,
        materialFromFallback: pa.material_from_fallback,
        materialPct: pa.material_pct, roughnessPct: pa.roughness_pct,
        materials: pa.material_counts,
        surveyed: ds.surveyed, contour: ds.contour, nodes: ds.total,
        depthMedian: ds.median,
      };
    }),

    flow: once("flow", () => {
      const st = raw.stats;
      return {
        reaches: st.pipes_used,
        fromField: st.direction.from_field, fromGeometry: st.direction.geometry_fallback,
        hasCycle: st.has_cycle, invertBad: st.invert_violations,
      };
    }),

    capacity: once("capacity", () => {
      const g = headroom();
      const geo = K.edgeGeometry(g, { matCodes: codes.mat });
      const ladder = DEMAND.map(l => ({
        perNode: l,
        surcharged: K.capacityState(g, C, { perNode: l, peakFactor: 1, geo }).summary.nodesSurcharged,
      }));
      return { ladder, nodes: g.n };
    }),

    sight: once("sight", () => {
      const g = headroom(), pub = observed({ model: "legacy" });
      const counts = C.feasible(g).map(i => g.obs.ptr[i + 1] - g.obs.ptr[i]).sort((a, b) => a - b);
      return {
        thresholdM: THRESHOLD_M, nodes: g.n,
        universe: g.obs.universeSize, blind: g.obs.zeroObservable,
        pubUniverse: pub.obs.universeSize, pubBlind: pub.obs.zeroObservable,
        candidates: counts.length, medianSees: counts[counts.length >> 1],
      };
    }),

    placement: once("placement", () => {
      const g = headroom();
      const order = C.greedy(g, g.n, "nodes");
      const covered = new Uint8Array(g.n), curve = [];
      let c = 0;
      for (const s of order) {
        const set = C.obsOf(g, s);
        for (let k = 0; k < set.length; k++) if (!covered[set[k]]) { covered[set[k]] = 1; c++; }
        curve.push(c);
      }
      const reach = c;
      return {
        order, curve, reach, sensors: order.length, universe: g.obs.universeSize,
        halfAt: curve.findIndex(v => v >= reach / 2) + 1,
        atBudget: curve[Math.min(BUDGET, curve.length) - 1], budget: BUDGET,
      };
    }),

    compare: once("compare", () => {
      const g = headroom(), b = BUDGET;
      const placed = {
        greedy: C.greedy(g, b, "nodes"),
        twoupdown: C.twoUpTwoDown(g, b, 2, 2, "nodes").sensors,
        upstream: (u => C.topBy(g, b, i => u[i]))(C.upstreamSize(g, null)),
        between: (w => C.topBy(g, b, i => w[i]))(C.betweenness(g, null)),
        outdeg: (d => C.topBy(g, b, i => d[i]))(C.degreeWeight(g, null, "out")),
        indeg: (d => C.topBy(g, b, i => d[i]))(C.degreeWeight(g, null, "in")),
        random: C.randomPlace(g, b, "nodes", 20, mulberry32(1)).sensors,
      };
      const watched = {};
      for (const k in placed) watched[k] = C.score(g, placed[k]).nodes;
      const best = ALGOS.reduce((a, r) => (watched[r[0]] > watched[a[0]] ? r : a));
      return { budget: b, placed, watched, bestRule: { id: best[0], label: best[1] } };
    }),
  };
}

/* One entry per step, in order. `view` names the screen osp_story_ui.js mounts. */
const STEPS = [
  {
    view: "network",
    title: "The network",
    description:
      "One council area's sewer, from openly published GIS layers, drawn in its own map " +
      "coordinates (metres north and east). Drag to pan, scroll or pinch to zoom, and hover " +
      "any chamber or pipe for what is recorded about it.",
    takeaway: F => {
      const f = F.network();
      return `${n(f.nodes)} nodes joined by ${n(f.reaches)} reaches over ${f.km.toFixed(1)} km, ` +
        `${f.manholes} of the nodes maintenance holes. They form ${f.components} separate networks; ` +
        `the largest has ${f.largest} nodes.`;
    },
  },
  {
    view: "data",
    title: "Can we trust the data?",
    description:
      "Every model here reads a handful of published fields. This step shows which are recorded, " +
      "which are filled from another field, and which are missing outright.",
    takeaway: F => {
      const f = F.data();
      return `Material reads unknown on ${f.materialFromFallback} reaches, but a second published ` +
        `field carries it on every one, so material is known for all ${n(f.reaches)}. No reach ` +
        `publishes a roughness, and only ${f.surveyed} of ${n(f.nodes)} cover levels are surveyed; ` +
        `the other ${f.contour} are read from the 1 m contours.`;
    },
  },
  {
    view: "flow",
    title: "Which way does water flow?",
    description:
      "Each pipe's direction comes from its published flow-direction field where there is one, " +
      "and from its geometry where there is not. The long section shows what that means " +
      "for the levels water falls through.",
    takeaway: F => {
      const f = F.flow(), c = CITED.invertBadIfGeometry;
      return `${n(f.fromField)} of ${n(f.reaches)} reaches take their direction from the published ` +
        `field and ${f.fromGeometry} from geometry, with ${f.hasCycle ? "a loop" : "no loops"}. Read ` +
        `that way, ${f.invertBad} chambers have inverts that disagree; read geometry-first, ` +
        `${c.value} do (${c.src}).`;
    },
  },
  {
    view: "capacity",
    title: "How stressed is it?",
    description:
      "Load is added up pipe by pipe down the network and compared with what each reach can " +
      "carry part full (Manning). Move the demand per chamber and watch where the network " +
      "gives out first. A screening estimate, not a hydraulic model.",
    takeaway: F => {
      const L = F.capacity().ladder, lo = L[0], hi = L[L.length - 1];
      return `At ${lo.perNode} L/s per chamber ${lo.surcharged ? lo.surcharged + " chambers surcharge" : "no chamber surcharges"}; ` +
        `at ${hi.perNode} L/s, ${hi.surcharged} do. A surcharge count means nothing without ` +
        `the demand it was computed at.`;
    },
  },
  {
    view: "sight",
    title: "What can a sensor see?",
    description:
      "A blockage backs water up until it escapes at the lowest opening. A sensor upstream sees it " +
      "if that water rises past the detection threshold where the sensor sits. Hover a chamber to " +
      "preview what it would see; click to pin it.",
    takeaway: F => {
      const f = F.sight();
      return `With measured depths and a ${Math.round(f.thresholdM * 100)} cm threshold, ` +
        `${f.blind} of ${n(f.nodes)} nodes see nothing. With pipe diameter standing in for depth, ` +
        `as in the published method, ${f.pubBlind} would.`;
    },
  },
  {
    view: "placement",
    title: "Where should sensors go?",
    description:
      "Greedy adds one sensor at a time, each where it watches the most nodes not yet watched. " +
      "Play the build-up to see the sensors arrive in the order greedy chose them.",
    takeaway: F => {
      const f = F.placement();
      return `${f.sensors} sensors watch everything a sensor in a maintenance hole can reach, ` +
        `${f.reach} nodes. The first ${f.halfAt} watch half of that, and ${f.budget} watch ${f.atBudget}.`;
    },
  },
  {
    view: "compare",
    title: "How good is that?",
    description:
      "Every method draws from the same candidates and is scored the same way. Greedy is set " +
      "against the rules of thumb and the best of 20 random layouts. There is no exact optimum " +
      "here, so how far greedy is from the best possible is not measured.",
    takeaway: F => {
      const f = F.compare(), w = f.watched;
      return `With ${f.budget} sensors greedy watches ${w.greedy} nodes. The best rule of thumb ` +
        `(${f.bestRule.label}) watches ${w[f.bestRule.id]}, and the best of 20 random layouts ${w.random}.`;
    },
  },
  {
    view: "caveats",
    title: "Caveats",
    description:
      "What every result above assumes, what is approximate, and what would come next. " +
      "The sandbox's Assumptions tab is the full register.",
    takeaway: () =>
      `Nothing here is checked against a recorded blockage, and the detection threshold and the ` +
      `demand are declared, not measured. Every figure is a result of the model, not a ` +
      `measurement of the sewer.`,
  },
];

return { STEPS, CITED, THRESHOLD_M, BUDGET, DEMAND, facts };
});
