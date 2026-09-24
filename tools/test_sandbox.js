#!/usr/bin/env node
/* Regression suite for the sandbox models. Node only, no browser, no dependencies.

   The model files are pure (no DOM), so they load here as they load in the page.
   Every expected figure below was established interactively against the shipped
   Walkerville dataset and is quoted in the README or the Assumptions tab; if one of
   them moves, either the data changed or a model did, and either way someone should
   know before it is published.

   These are regression checks on ONE dataset, not unit tests of the algorithms.
   Change the data and the expected figures must be re-established, deliberately.

   Run:   node tools/test_sandbox.js          (exit 1 on any failure) */
"use strict";
const path = require("path");
const ROOT = path.join(__dirname, "..");
global.window = {};
require(path.join(ROOT, "data/osp_data.js"));
const C = require(path.join(ROOT, "src/model/osp_core.js"));
const K = require(path.join(ROOT, "src/model/osp_capacity.js"));
const R = require(path.join(ROOT, "src/model/osp_risk.js"));
const D = window.OSP_DATA;

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = typeof want === "function" ? want(got) : JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok ? "" : `   got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
};
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const rankCorr = (a, b) => {
  const ra = R.rankOf(a), rb = R.rankOf(b), n = a.length;
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += ra[i]; mb += rb[i]; } ma /= n; mb /= n;
  let s = 0, x = 0, y = 0;
  for (let i = 0; i < n; i++) { const p = ra[i] - ma, q = rb[i] - mb; s += p * q; x += p * p; y += q * q; }
  return s / Math.sqrt(x * y);
};

const raw = D.regions.walkerville;
const g = C.buildGraph(raw);
const mc = D.codes.mat, jc = D.codes.joint;

/* Repository hygiene, first, because a merge committed with conflicts unresolved is
   how this suite earned these three checks. The markers survived in osp_docs.js
   because they landed inside a template literal, so the file still parsed and still
   rendered; the page simply displayed "<<<<<<< HEAD" to the reader. In osp_ui.js
   they did not survive, and the sandbox was served broken. Neither was caught,
   because nothing here loaded the UI or looked at the text. */
console.log("repository hygiene");
{
  const fs = require("fs"), cp = require("child_process");
  const tracked = cp.execSync("git ls-files", { cwd: ROOT }).toString().trim().split("\n");
  const code = tracked.filter(f => /\.(js|html|py|md)$/.test(f));

  const conflicted = code.filter(f =>
    /^(<{7} |={7}$|>{7} )/m.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
  check("no unresolved conflict markers in tracked files", conflicted, []);

  const leftovers = tracked.filter(f => /\.(orig|rej|bak)$/.test(f));
  check("no merge leftovers tracked", leftovers, []);

  // Every browser script must parse. The models are require()d below, but the UI and
  // the views are not, and a syntax error in them breaks the page silently here.
  const scripts = tracked.filter(f => f.startsWith("src/") && f.endsWith(".js"));
  const broken = scripts.filter(f => {
    try { cp.execSync(`node --check "${path.join(ROOT, f)}"`, { stdio: "pipe" }); return false; }
    catch (e) { return true; }
  });
  check("every src/ script parses", broken, []);

  /* Script order is dependency order. osp_ui.js captures window.OSPProfile into a
     const at load time, so a page that loads the UI before the view gives
     "Cannot read properties of undefined (reading 'makeView')" and nothing renders.
     Parsing cannot catch that and neither can a 200 from the server, so the order
     is checked here: whatever a script reads from window at the top level must be
     defined by a script the page loads earlier. */
  const page = fs.readFileSync(path.join(ROOT, "osp_sandbox.html"), "utf8");
  const order = [...page.matchAll(/<script src="([^"?]+)/g)].map(m => m[1]);
  const definedBy = new Map();
  order.forEach((f, i) => {
    const t = fs.readFileSync(path.join(ROOT, f), "utf8");
    for (const m of t.matchAll(/(?:window|root)\.(OSP[A-Za-z_]*)\s*=/g))
      if (!definedBy.has(m[1])) definedBy.set(m[1], i);
  });
  const misordered = [];
  order.forEach((f, i) => {
    const t = fs.readFileSync(path.join(ROOT, f), "utf8");
    // top-level capture only: `const X = window.OSPFoo;` at column 0
    for (const m of t.matchAll(/^const\s+\w+\s*=\s*window\.(OSP[A-Za-z_]*)\s*;/gm)) {
      const at = definedBy.get(m[1]);
      if (at === undefined || at > i) misordered.push(`${f} reads ${m[1]} too early`);
    }
  });
  check("scripts load in dependency order", misordered, []);
}

console.log("graph");
check("nodes", g.n, 1010);
check("edges", g.edges.length, 1001);
check("pipes attached", !!g.pipes, true);
check("material counts", raw.stats.pipe_attrs.material_counts, { VC: 906, PVCU: 94, RC: 1 });

console.log("observability, headroom model, 0.05 m threshold");
C.computeObservable(g, { model: "headroom", threshold: 0.05 });
check("observable universe", g.obs.universeSize, 813);
check("chambers observing nothing", g.obs.zeroObservable, 32);
check("greedy, budget 40, nodes covered", C.score(g, C.greedy(g, 40, "nodes")).nodes, 341);

console.log("capacity");
const geo = K.edgeGeometry(g, { matCodes: mc });
check("reaches with published diameter", g.edges.length - geo.diaProxied, 1001);
check("reaches clamped for no fall", geo.clamped, 0);
check("reaches rescued by published grade", geo.fromGrade, 3);
const ladder = [0.05, 0.1, 0.2, 0.4, 0.9].map(l =>
  K.capacityState(g, C, { perNode: l, peakFactor: 1, geo }).summary.nodesSurcharged);
check("surcharge ladder 0.05 .. 0.9 L/s", ladder, [0, 3, 30, 80, 132]);

console.log("growth headroom");
{
  const st = K.capacityState(g, C, { perNode: 0.05, peakFactor: 1, geo });
  const H = K.growthHeadroom(g, C, st);
  check("every chamber gets a headroom or an outlet", H.summary.withLimit, 992);
  check("none already over at the default load", H.summary.underOneLitre, 0);

  // Exactness: superposition says the first tip lands exactly at the headroom.
  // Pushing just under leaves the network clear, just over tips one reach.
  const v = [...H.head.keys()].filter(i => isFinite(H.head[i]))
              .sort((a, b) => H.head[a] - H.head[b])[0];
  const over = add => {
    const l = Float64Array.from(st.own); l[v] += add;
    return K.capacityState(g, C, { loads: l, peakFactor: 1, geo }).summary.edgesOver;
  };
  check("tightest site: nothing over just below its headroom", over(H.head[v] * 0.99), 0);
  check("tightest site: one reach over just above it", over(H.head[v] * 1.01), 1);
  check("the binding reach surcharges the chamber above it",
        H.surchargeAt[v], g.edges[H.bind[v]][0]);

  const cov = K.growthCover(g, H);
  check("growth cover marks fewer chambers than sites", cov.summary.chambers < cov.summary.sites, true);
  check("weights are a count, so they sum to the site total",
        Math.round(cov.w.reduce((a, b) => a + b, 0)), cov.summary.sites);
}

console.log("blockage likelihood");
const rs = R.likelihood(g, { matCodes: mc, jointCodes: jc, aggregate: "intensity" });
const ex = R.likelihood(g, { matCodes: mc, jointCodes: jc, aggregate: "exposure" });
check("edge score max", +rs.summary.max.toFixed(3), 0.882);
check("exposure tracks pipe length (rho > 0.95)", rankCorr(ex.node, g.lenIn), v => v > 0.95);
check("intensity does not (rho < 0.6)", rankCorr(rs.node, g.lenIn), v => v < 0.6);
const A = R.agreement(g, { matCodes: mc, jointCodes: jc });
const rho = Object.fromEntries(A.rows.map(r => [r.factor, +r.rho.toFixed(2)]));
check("age is the strongest single factor", rho.age, v => v > 0.7);
check("bore pulls against the blend here", rho.diameter, v => v < 0);

console.log("objectives are one algorithm with different weights");
const ones = new Float64Array(g.n).fill(1);
check("'nodes' == weights all 1", same(C.greedy(g, 40, "nodes"), C.greedy(g, 40, { w: ones })), true);
check("'length' == weights lenIn", same(C.greedy(g, 40, "length"), C.greedy(g, 40, { w: Float64Array.from(g.lenIn) })), true);
const heur = (w) => ({
  upstream: C.topBy(g, 40, (u => i => u[i])(C.upstreamSize(g, w))),
  between: C.topBy(g, 40, (b => i => b[i])(C.betweenness(g, w))),
  indeg: C.topBy(g, 40, (d => i => d[i])(C.degreeWeight(g, w, "in"))),
  outdeg: C.topBy(g, 40, (d => i => d[i])(C.degreeWeight(g, w, "out"))),
  twoupdown: C.twoUpTwoDown(g, 40, 2, 2, w ? { w } : "nodes").sensors,
});
const plain = heur(null), unit = heur(ones), risk = heur(rs.node);
for (const k of Object.keys(plain)) {
  check(`${k}: weights all 1 reproduces unweighted`, same(plain[k], unit[k]), true);
  check(`${k}: responds to the risk objective`, same(plain[k], risk[k]), false);
}

console.log("weighting never touches structure or observability");
const before = [g.n, g.edges.length, g.obs.universeSize, g.obs.idx.length];
C.greedy(g, 40, { w: rs.node });
check("graph and observability unchanged", [g.n, g.edges.length, g.obs.universeSize, g.obs.idx.length], before);

console.log("a region without pipe attributes still works everywhere");
const bare = JSON.parse(JSON.stringify(raw)); delete bare.pipes;
const gb = C.buildGraph(bare);
C.computeObservable(gb, { model: "headroom", threshold: 0.05 });
check("pipes null", gb.pipes, null);
check("capacity falls back to the proxy on every reach", K.edgeGeometry(gb, {}).diaProxied, 1001);
// No published gradient here, so the three flat reaches are clamped instead of
// rescued and one more chamber surcharges: 133 against 132 with attributes. The
// difference IS the grade rescue, which is why this is asserted rather than waved off.
check("clamped not rescued: one more chamber surcharges", K.capacityState(gb, C, { perNode: 0.9 }).summary.nodesSurcharged, 133);
check("likelihood scores neutral, not zero", R.likelihood(gb, {}).summary.min, v => v > 0);

console.log("documentation panes render from the data");
window.OSPCore = C; window.OSPCapacity = K; window.OSPRisk = R;
const slots = {};
global.document = { getElementById: id => (slots[id] = slots[id] || { innerHTML: "" }) };
global.requestIdleCallback = fn => fn();
require(path.join(ROOT, "src/docs/osp_docs.js"));
window.OSPDocs.render({ DATA: D.regions, VALID: D.validation, META: D.meta, CODES: D.codes, C,
                        buildGraph: k => C.buildGraph(D.regions[k]) });
const all = Object.values(slots).map(s => s.innerHTML).join("");
check("no undefined or NaN in any pane", /undefined|NaN/.test(all), false);
check("Part D rendered", all.includes("Part D"), true);
  check("Part F rendered", all.includes("Part F. Growth headroom"), true);
const gl = slots["doc-glossary"].innerHTML;
check("glossary terms", (gl.match(/<dt>/g) || []).length, 35);
check("glossary figures", (gl.match(/<figure class="gl-fig">/g) || []).length, 31);
check("every figure titled", (gl.match(/<svg /g) || []).length === (gl.match(/<title>/g) || []).length, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
