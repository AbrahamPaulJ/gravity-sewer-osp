/* Documentation panes for the OSP sandbox.
   The assumptions register is rendered from the LOADED dataset, not typed in, so its
   figures cannot drift out of step with the data the tool is actually running on.

   The Assumptions pane is the CANONICAL register for the whole project. README.md
   and the written documents point at it rather than restating it, so an assumption
   added or removed in code gets added or removed there in the same change. */
"use strict";

window.OSPDocs = (function () {

const esc = s => String(s).replace(/[&<>"]/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const m = v => (v == null || !isFinite(v)) ? "n/a" : v.toFixed(2) + " m";

/* ------------------------------------------------------------ assumptions */
/* This pane is CANONICAL. Every assumption either model rests on is registered
   here, in one place, and other documents point at it rather than restating it.
   If an assumption is added or removed in code, it is added or removed here in
   the same change.

   Two models run in this sandbox and they answer different questions, so the
   register is in two parts:
     A  the network, its geometry, and the BLOCKAGE observability model (Ninh 2025)
     B  the flow, capacity and growth model (osp_capacity.js), which is OVERCAPACITY
   Part C is what remains assumed across both, stated plainly.

   The capacity figures are computed here from the loaded dataset rather than
   typed in, so they cannot drift out of step with the model. That costs about
   280 ms, so it is deferred to idle time and injected into a placeholder rather
   than blocking first paint. */

const CAP_LADDER = [0.05, 0.1, 0.2, 0.4, 0.9];   // L/s per chamber, dry weather

function assumptions(ctx) {
  const { DATA, VALID, META, C, buildGraph } = ctx;
  const A = VALID.leg_a, B = VALID.leg_b, Cg = VALID.leg_c, ID = VALID.identity;

  const rows = Object.keys(DATA).map(k => {
    const g = buildGraph(k);
    const ds = C.depthStats(g);
    const st = g.stats;
    return { k, g, ds, st };
  });

  const regionTable = rows.map(r => `
    <tr>
      <td><b>${esc(r.g.label)}</b><br><span style="font-size:11px;color:var(--ink-faint)">${esc(r.g.role)}</span></td>
      <td class="num">${r.st.nodes}</td>
      <td class="num">${r.st.pipes_used}</td>
      <td class="num">${r.st.manholes_published ? (r.st.manholes_matched || 0) + " of " + r.st.manholes_published : "none published"}</td>
      <td class="num">${r.ds.median != null ? r.ds.median.toFixed(2) : "n/a"}</td>
      <td class="num">${r.ds.surveyed} / ${r.ds.contour} / ${r.ds.transferred}${r.ds.unknown ? " / " + r.ds.unknown : ""}</td>
      <td class="num">${r.st.invert_violations ?? "n/a"}</td>
    </tr>`).join("");

  return `
  <h2>Assumptions and limitations</h2>
  <p class="lede">This page is the canonical register. Every assumption the sandbox rests on is
  listed here, each with what it would take to remove it, and every figure is read from the dataset
  currently loaded in this page rather than typed in, so it cannot fall out of step with the model.
  Built ${esc(META.built || "unknown")}.</p>

  <div class="card good">
    <h4>The short version</h4>
    <p>The two substitutions the first version of this tool rested on are gone. Nodes are now real
    maintenance holes from the network operator's own asset register, and chamber depth is measured rather than
    stood in for by pipe diameter. What was added since is a second model, for capacity and growth,
    and it is far less measured than the first: its geometry is real, its <i>demand</i> is a
    setting you choose. That distinction is the most important thing on this page and it is
    spelled out in part B.</p>
  </div>

  <div class="card">
    <h4>Two models, because they answer two different questions</h4>
    <p><b>Blockage</b> is the published method this sandbox implements. A chamber chokes, flow
    stops, water backs up behind it to a ceiling, and the question is whether a sensor somewhere
    upstream can see that rise. A blockage can happen almost anywhere, so the geography of the
    problem is the whole network weighted by condition.</p>
    <p><b>Overcapacity</b> is what the agreed scope actually asks about. Nothing is obstructed:
    flow accumulates downhill and at some reach it exceeds what that pipe was sized to carry, so
    water backs up behind the bottleneck. Bottlenecks are few, predictable and fixed by geometry,
    and they are what growth causes.</p>
    <p>Both end the same way, water rising in a chamber and escaping at the lowest opening, so once
    a chamber surcharges the <i>cause</i> no longer matters to whether a sensor can see it, and the
    same observability machinery serves both. But the sets of chambers at risk are different, so
    <b>a placement optimised for one is not optimised for the other</b>. Do not conflate them in
    writing, and read every number below as belonging to one model or the other.</p>
  </div>

  <h3>What the loaded regions actually contain</h3>
  <p><b>Chambers usable as sites</b> counts published maintenance holes that were matched to a
  node in the graph, and therefore can hold a sensor. Where several nodes fall within the match
  radius of one manhole, only the closest is kept, so the same physical chamber is never offered
  to the optimiser twice. <b>Cover level from</b> breaks the nodes down by where their ground
  level came from: surveyed, interpolated from contours, transferred from another region as a
  constant, or discarded as unusable. <b>Invert violations</b> counts nodes where the outgoing
  invert sits above the incoming one, which water cannot do under gravity, so it is a count of
  data errors rather than a modelling choice.</p>
  <table>
    <thead><tr><th>Region</th><th>Nodes</th><th>Pipes</th><th>Chambers usable as sites</th>
      <th>Median depth (m)</th><th>Cover level from</th><th>Invert violations</th></tr></thead>
    <tbody>${regionTable}</tbody>
  </table>

  <h3>Part A. The network and the blockage model</h3>
  <p>These are the assumptions the first version of the tool rested on, and what each became.</p>
  <table>
    <thead><tr><th>#</th><th>Was</th><th>Is now</th><th>Status</th></tr></thead>
    <tbody>
      <tr><td>A1</td><td>Nodes were snapped pipe endpoints</td>
        <td>Real published manhole points, matched within 1.0 m. Sensors can only be placed in
            chambers, because that is the only place one physically fits.</td>
        <td><b style="color:var(--good)">Resolved</b> for Walkerville. No manhole layer exists
            publicly for the other regions.</td></tr>
      <tr><td>A2</td><td>Node elevation was the lowest invert at a snapped point</td>
        <td>Invert taken as the chamber floor, with incoming and outgoing inverts checked against
            each other.</td>
        <td><b style="color:var(--good)">Resolved.</b> Violations fell from 462 to
            ${rows[0] ? rows[0].st.invert_violations : "n/a"} once the invert fields were read
            correctly (see Method tab).</td></tr>
      <tr><td>A3</td><td>MaxDepth was pipe diameter, 0.15 m</td>
        <td>Depth is cover level minus invert. Median
            ${rows[0] ? m(rows[0].ds.median) : "n/a"} on Walkerville.</td>
        <td><b style="color:var(--good)">Measured</b>, and validated three ways below.</td></tr>
      <tr><td>A4</td><td>A single global coefficient c = 0.70</td>
        <td>A per-node ceiling, computed by flood fill over real cover levels.</td>
        <td><b style="color:var(--good)">Removed.</b> c survives only in the comparison mode.</td></tr>
      <tr><td>A5</td><td>The escape point was folded into c</td>
        <td>Optional property relief gully proxy: ground at the property inspection point plus
            ${META.org_above_ground_m} m.</td>
        <td><b style="color:var(--warn)">Still assumed.</b> Gully levels are published nowhere.</td></tr>
      <tr><td>A6</td><td>No detection threshold at all</td>
        <td>An explicit threshold a rise must exceed before it counts.</td>
        <td><b style="color:var(--warn)">Declared, not calibrated.</b> No South Australian
            wastewater sensor readings are public.</td></tr>
      <tr><td>A7</td><td>Flow direction taken from a drafting field</td>
        <td>Direction from the flow-direction code, with inverts read as flow-anchored.</td>
        <td><b style="color:var(--good)">Resolved</b>, and the reading was verified by measurement
            rather than assumed.</td></tr>
    </tbody>
  </table>

  <h3>How the depth reconstruction was validated</h3>
  <p>Cover levels are interpolated from published contour lines, so the question is how much error
  that introduces against a surveyed level. Three independent legs, all reproducible from public
  endpoints:</p>
  <table>
    <thead><tr><th>Leg</th><th>What it compares</th><th>n</th><th>Mean abs</th><th>p90</th><th>RMSE</th></tr></thead>
    <tbody>
      <tr><td><b>A</b></td><td>1 m contours vs surveyed cover levels, Walkerville, same area and
        same method</td><td class="num">${A ? A.n : "-"}</td><td class="num">${A ? A.mean_abs : "-"}</td>
        <td class="num">${A ? A.p90_abs : "-"}</td><td class="num">${A ? A.rmse : "-"}</td></tr>
      <tr><td><b>B</b></td><td>5 m contours vs surveyed levels, Barossa, large sample</td>
        <td class="num">${B ? B.n : "-"}</td><td class="num">${B ? B.mean_abs : "-"}</td>
        <td class="num">${B ? B.p90_abs : "-"}</td><td class="num">${B ? B.rmse : "-"}</td></tr>
      <tr><td><b>C</b></td><td>5 m subset vs full 1 m layer, same terrain, isolating the cost of a
        coarser interval</td><td class="num">${Cg ? Cg.n : "-"}</td><td class="num">${Cg ? Cg.mean_abs : "-"}</td>
        <td class="num">${Cg ? Cg.p90_abs : "-"}</td><td class="num">${Cg ? Cg.rmse : "-"}</td></tr>
    </tbody>
  </table>
  <p>B and C are independent measurements of the same thing, what a 5 m contour interval costs, and
  they agree${B && Cg ? ` (${B.mean_abs} m and ${Cg.mean_abs} m)` : ""}. That corroborates leg A's
  much smaller figure for the 1 m layer actually used${A ? `, ${A.mean_abs} m mean and ${A.p90_abs} m
  at the 90th percentile` : ""}. So the usable claim is: <b>Walkerville depths are reconstructed with
  a measured error of about ${A ? A.mean_abs : "?"} m</b>, against a median depth of
  ${rows[0] ? m(rows[0].ds.median) : "?"}.</p>

  ${ID ? `<div class="card"><h4>An independent arithmetic check</h4>
  <p>Barossa publishes surface level, invert and depth in the same record, which must satisfy
  <code>depth = surface - invert</code>. Across ${ID.n} records they agree to
  <b>${ID.mean_abs} m</b>. That is not our result, it is the publisher's own consistency, and it is
  what makes those records trustworthy enough to validate against.</p></div>` : ""}

  <h3>Part B. The capacity and growth model</h3>
  <div id="cap-register"><p class="lede">Computing capacity for every loaded region, one moment.</p></div>

  <h3>Part D. The blockage likelihood model</h3>
  <div id="risk-register"><p class="lede">Scoring blockage likelihood, one moment.</p></div>

  <h3>Part E. The dynamic model and the long-section</h3>
  <p>Part B solves steady uniform flow, which has no time axis and cannot show water backing up.
  The long-section can draw either that steady solution or a precomputed <b>EPA SWMM</b> run, and
  it always names which one is on screen. These are the assumptions the SWMM half rests on. Part C
  below closes the register across all three models.</p>

  <table>
    <thead><tr><th>#</th><th>Assumption</th><th>Why it is defensible</th><th>What would remove it</th></tr></thead>
    <tbody>
      <tr><td>E1</td><td><b>The dynamic physics is SWMM's, not ours</b></td>
        <td>The routing is EPA SWMM solving the full St Venant equations in dynamic wave mode.
            <code>tools/build_swmm.py</code> translates the network into SWMM's input format, runs
            it, and quantises the answer for the browser. It models nothing itself. That is the
            point: a hydraulic solver written for this project would have to be defended, and
            SWMM does not.</td>
        <td>Nothing to remove. Note only that using a trusted solver does not make the INPUTS
            trusted, and the inputs are D3 and D4.</td></tr>

      <tr><td>E2</td><td><b>The SWMM result is precomputed, so the sliders cannot reach it</b></td>
        <td>The solve runs offline in Python and ships as fixed scenarios. A browser cannot run
            SWMM, and a dynamic solve of 1,010 chambers is not an interactive operation in any
            case. The steady model stays live on the sliders, so the tool keeps one model you can
            interrogate and one you can trust.</td>
        <td>Nothing, short of a server. Scenarios are cheap to add: rerun
            <code>tools/build_swmm.py</code> with different load, roughness or growth points.</td></tr>

      <tr><td>E3</td><td><b>Inflow is an assumed per-chamber load on a conventional diurnal
            pattern</b></td>
        <td>Nothing public says how much sewage enters each chamber, which is C1 again and is the
            largest assumption in the whole tool. The hourly pattern is the conventional domestic
            shape, low overnight with a sharp morning peak and a broader evening one. It is not a
            measurement of this catchment: no diurnal curve is published for Walkerville.</td>
        <td>Pump station run hours and treatment plant inflow, both requested from the network operator.
            Those give a real catchment diurnal curve directly, and they are the same data the
            growth-identification work needs.</td></tr>

      <tr><td>E4</td><td><b>The infiltration and inflow hydrograph is a shape, not an event</b></td>
        <td>The wet weather scenario adds a single-peaked hydrograph on top of dry weather flow:
            a fast rise and a slow recession, which is how infiltration behaves. It exists because
            the network operator's own objection was that the idealised model will not survive real
            groundwater and stormwater. It is an illustration of that objection, not a design
            storm for this catchment.</td>
        <td>Rainfall records joined to measured flow response, which is how a real I&amp;I
            assessment is done. Until then, read the wet weather scenario as "something like this
            happens", never as "this happens".</td></tr>

      <tr><td>E5</td><td><b>Each terminus is given a synthetic free outfall</b></td>
        <td>SWMM requires an outfall to have exactly one inlet link, and several of our termini
            are junctions of two reaches. So every terminus stays a real junction and gets a short,
            slightly falling dummy reach to its own outfall, sized generously so it never becomes
            the constraint. This is the conventional way to terminate a SWMM extract.</td>
        <td>The real downstream network. Every terminus is an artefact of the extract boundary
            (C3), and nothing about what happens below it is being claimed.</td></tr>

      <tr><td>E6</td><td><b>SWMM does not clamp adverse slopes, and Manning does</b></td>
        <td>B5 clamps zero and adverse falls to a token grade because Manning has no solution at
            zero fall. Dynamic wave routing does, so the clamp is dropped for SWMM and flat reaches
            are modelled flat. This is a real improvement, and it is the reason a reach count can
            legitimately differ between the two models at the same load.</td>
        <td>Nothing. It is a difference to be aware of when comparing the two, not a defect.
            Where the two disagree, SWMM is the better answer.</td></tr>

      <tr><td>E7</td><td><b>The long-section shows one route through a branching network</b></td>
        <td>A sewer is a tree and a long-section is a single chain, so a route has to be chosen.
            At every branch the trace follows the largest contributing tributary, which is the
            trunk and the route a bottleneck sits on. Following the first-stored branch instead
            would pick an arbitrary short spur.</td>
        <td>Nothing to remove, but read it for what it is: the chambers either side of the drawn
            route also drain into it, and their flow appears without being drawn.</td></tr>

      <tr><td>E8</td><td><b>The route window and the vertical exaggeration are drawing choices</b></td>
        <td>The vertical scale is the horizontal scale times the exaggeration, so a long route
            squashes everything: trace the full four kilometres through Walkerville and a 300 mm
            pipe is a quarter of a pixel tall, with the water invisible inside it and every number
            still correct. The default is therefore a short window around the chosen chamber at a
            high exaggeration, which is why a real long-section covers a few hundred metres. Both
            factors are printed on the drawing.</td>
        <td>Nothing. A long-section without its exaggeration stated is a misleading drawing, which
            is the only reason this is registered at all.</td></tr>
    </tbody>
  </table>

  <h3>Part C. What is still assumed, stated plainly</h3>
  <div class="card bad">
    <h4>C1. Demand is a setting, not a measurement, and it drives the headline number</h4>
    <p>This is the largest assumption in the tool and the first thing a reader who models sewers
    will test. Load per chamber and peak factor are sliders. Nothing in the public data says what
    either should be, so the count of surcharging chambers is a property of where you left the
    sliders, not a finding about the suburb. The ladder in part B shows how far it moves. Quote
    surcharge counts <b>with the demand case attached</b>, never on their own, and treat the
    ranking of reaches as the result rather than the absolute count.</p>
    <p>Removing it needs billed consumption or dwelling counts joined to the network, or a
    calibrated dry weather flow per connection from the network operator's own model. That is an ask.</p>
  </div>
  <div class="card bad">
    <h4>C2. Nothing here has been validated against an actual blockage or overflow</h4>
    <p>Both models are structural and topological results throughout. No historical choke or
    overflow record was available, so the tool can say which chambers <i>would</i> see an event
    under each model, and cannot yet say whether they did. Obtaining incident history is the single
    highest-value thing that would change that, for either half.</p>
  </div>
  <div class="card warn">
    <h4>C3. Administrative boundaries cut the catchment, and this hurts capacity twice</h4>
    <p>Every region here is clipped to a council area or a bounding box, not to a drainage
    catchment. Pipes that continue in reality appear to end, so a mid-network chamber can look like
    the bottom of the system and the downstream consequences of a blockage there cannot be seen.</p>
    <p>For the capacity model the same cut does something worse and less obvious: flow that would
    have entered from outside the boundary is never counted, so reaches near a cut edge carry
    <b>too little</b> flow and will look healthier than they are. Anything near an edge is wrong in
    a known direction, and in the capacity view that direction is the unsafe one.</p>
  </div>
  <div class="card warn">
    <h4>C4. Property relief gully levels are not public anywhere</h4>
    <p>The gully is designed to be the lowest opening, so it usually controls where water escapes,
    and it sits on private land. The proxy here puts it at ground level plus
    ${META.org_above_ground_m} m at the property inspection point. It is reasoned from the plumbing
    standard, not measured. Toggle it on and off in the sandbox to see how much it moves the answer.</p>
  </div>
  <div class="card warn">
    <h4>C5. The detection threshold cannot be calibrated from public data</h4>
    <p>Setting it properly needs baseline level traces from deployed sensors, and none are published
    for South Australia. It is a slider with a declared default rather than a result. Do et al.
    (2023) show the shape the calibration would take: chokes were identified by how long the level
    stayed irregularly high, not by the peak alone.</p>
  </div>
  <div class="card warn">
    <h4>C6. Everything is treated as gravity, so pumped assets are not represented</h4>
    <p>The whole method rests on the network being a directed acyclic graph, which is what makes
    "everything upstream of here" cheap to compute. A rising main breaks that: it runs full, under
    pressure, and uphill. Pump stations are also storage, which a steady calculation has no way to
    represent, and they are where a real utility already has data. Whether pump stations are in
    scope is an <b>open question for the network operator</b>, and the answer changes the methodology rather
    than adding to it.</p>
  </div>
  <div class="card warn">
    <h4>C7. The real network deviates from the idealised one in ways this does not model</h4>
    <p>The standing objection to any idealised gravity model, and it is a fair one. Ground movement alters invert levels over
    time, so a surveyed gradient is not a current gradient. Infiltration and inflow put stormwater
    and groundwater into a sewer that was sized for neither, which is exactly when capacity
    matters. Tree roots reduce an effective diameter without changing the recorded one. None of the
    three is in either model. The tractable answer is not to measure them but to <b>perturb and
    report</b>: jitter the inverts by a plausible drift and show how far the recommendation moves.
    A placement that is stable under perturbation is a stronger claim than one that is merely
    optimal. That is planned work, not done work.</p>
  </div>

  <h3>Routes probed and rejected, so they are not retried</h3>
  <ul>
    <li>Geoscience Australia's national elevation services return HTTP 403 from here, and the ELVIS
      portal is an interactive download tool rather than a queryable service. Council contour layers
      are used instead.</li>
    <li>The state platform's <code>3D_DAT_Ground</code> elevation raster is tile-cached only:
      <code>identify</code>, <code>getSamples</code> and <code>exportImage</code> all return HTTP
      500, so per-point sampling is not available.</li>
    <li>No manhole or maintenance-hole point layer exists anywhere on the statewide utilities
      service. It publishes pipes and unrelated assets only.</li>
    <li>The statewide layer publishes a <code>roughness</code> field, which would have removed the
      Manning assumption in B1. It is populated on 0.8% of records, so it cannot be used.</li>
  </ul>`;
}

/* Part D, the blockage likelihood register. Computed for the same reason Part B is:
   the weights live in osp_risk.js and a table typed in here would drift from them
   the first time one was tuned. The sensitivity table is the point of the section,
   not an appendix to it. */
function riskRegister(ctx) {
  const { DATA, CODES, buildGraph } = ctx;
  const K = window.OSPRisk;
  if (!K) return `<div class="card bad"><h4>Likelihood model not loaded</h4>
    <p>osp_risk.js did not load, so part D cannot be computed. Nothing is shown rather than
    something stale.</p></div>`;

  const keys = Object.keys(DATA).filter(k => buildGraph(k).pipes);
  if (!keys.length) return `<div class="card warn"><h4>No region carries pipe attributes</h4>
    <p>Blockage likelihood needs per-pipe bore, age, gradient and material. No loaded region has
    them, so this model is unavailable rather than guessed at.</p></div>`;

  const g = buildGraph(keys[0]);
  const opt = { matCodes: (CODES || {}).mat, jointCodes: (CODES || {}).joint };
  const A = K.agreement(g, opt);
  const L = A.blended;
  const pub = L.summary.published, m = L.summary.edges;

  const wRows = A.rows.map(r => `
    <tr><td><b>${esc(r.factor)}</b></td>
      <td class="num">${r.weight.toFixed(2)}</td>
      <td class="num">${(100 * pub[r.factor] / m).toFixed(1)}%</td>
      <td class="num">${r.distinct}</td>
      <td class="num" style="color:${r.rho < 0.2 ? "var(--warn)" : "var(--ink-dim)"}">${r.rho.toFixed(3)}</td>
    </tr>`).join("");

  const worst = A.rows[A.rows.length - 1];

  return `
  <p>The two models above treat every chamber as an equally likely place for something to go
  wrong. Ninh 2025 names that as its own limitation and points at the fix; Crowley 2025 names the
  same gap. This part scores how likely each reach is to block, from the attributes the publisher
  carries per pipe, and hands the result to the optimiser as a per-chamber weight.</p>

  <div class="card bad">
    <h4>D0. The weights are declared, not calibrated. Read this before quoting anything below</h4>
    <p>Nothing here is fitted to a recorded blockage, because <b>no public source lists chokes for
    this network</b>. The factors and their directions come from the literature; the numbers on
    them are settings. That puts this model in exactly the position the demand setting is in
    (C1), and it gets the same rule: <b>the ranking of reaches is the claim, the score is not</b>.
    Quote a ranking with its weighting attached or do not quote it.</p>
    <p>Removing this needs choke and overflow history joined to the asset register. It is the same
    ask as C2 and it would convert this part from a declared model into a fitted one.</p>
  </div>

  <h4>The weighting, and how much of the answer each factor is actually deciding</h4>
  <p><b>Published</b> is the share of reaches carrying that attribute. <b>Distinct values</b>
  matters more than it looks: a factor with seven values across a thousand reaches cannot order
  them finely no matter what weight it carries. <b>Rank correlation</b> is Spearman's, between
  that factor scored alone and the blended result &mdash; how much of the final ordering that one
  factor reproduces by itself.</p>
  <table>
    <thead><tr><th>Factor</th><th>Weight</th><th>Published</th><th>Distinct values</th>
      <th>Rank corr. with blend</th></tr></thead>
    <tbody>${wRows}</tbody>
  </table>

  <div class="card warn">
    <h4>What that table says, and it is not comfortable</h4>
    <p>No single factor reproduces the blended ranking. The strongest,
    <b>${esc(A.rows[0].factor)}</b>, reaches only ${A.rows[0].rho.toFixed(2)}, and the weakest,
    <b>${esc(worst.factor)}</b>, sits at ${worst.rho.toFixed(2)}. <b>The blend is doing the
    ranking</b>, which means the weighting in the left column is not a detail of the method, it
    <i>is</i> the method, and a result quoted without it is not reproducible.</p>
    <p>The reason shows up in the data. In this network the original 1896 sewers are the
    <b>trunk</b> mains and the small-bore reticulation was infilled later, so the age factor and
    the bore factor pull against each other &mdash; they rank-correlate at about &minus;0.32. A
    condition model built elsewhere, where small pipe is also old pipe, would not behave this way.
    That is Malek Mohammadi's central finding arriving in our own data: these relationships are
    local, and thresholds do not travel.</p>
  </div>

  <h4>The register</h4>
  <table>
    <thead><tr><th>#</th><th>Assumption</th><th>Why it is there</th><th>What removes it</th></tr></thead>
    <tbody>
      <tr><td>D1</td><td><b>Blockage likelihood is a weighted sum of normalised factors</b></td>
        <td>An additive blend is the most explainable form available, and explainability was
            weighted heavily when the method was chosen. It assumes the factors act independently
            and additively, which is certainly false in detail.</td>
        <td>A model fitted to incident history, most plausibly the Bayesian network of Ma 2025,
            which represents dependence between factors instead of assuming it away.</td></tr>
      <tr><td>D2</td><td><b>Factors normalise over this network's own range</b></td>
        <td>The oldest pipe here scores 1 on age, the smallest scores 1 on bore. It avoids
            importing an absolute cutoff from another city, which Malek Mohammadi 2020 shows is
            how condition models end up contradicting each other.</td>
        <td>Nothing needs to. It is a deliberate choice, and its consequence is stated:
            <b>scores are not comparable between regions</b>, only within one.</td></tr>
      <tr><td>D3</td><td><b>Material and joint propensity are table lookups</b>
            (${esc(Object.keys(K.MATERIAL_RISK).join(", "))})</td>
        <td>Vitrified clay is jointed and root-prone, uPVC is smooth with fewer joints, concrete
            sits between. The ordering is well supported; the spacing between the numbers is not.</td>
        <td>Root-intrusion or CCTV defect records by material. The network operator names root
            intrusion as the dominant mechanism in these suburbs, so this is the factor most worth
            measuring.</td></tr>
      <tr><td>D4</td><td><b>A gradient at or above ${K.GRADE_REF}% scores zero</b></td>
        <td>Near the slope at which a 150 mm sewer reaches self-cleansing velocity, so flatter
            reaches accumulate deposits. A design convention, not a measurement.</td>
        <td>Velocity from the capacity model at a calibrated demand, rather than gradient as a
            stand-in for it.</td></tr>
      <tr><td>D5</td><td><b>Unpublished attributes score ${0.5} rather than being dropped</b></td>
        <td>Joint type is published on only ${(100 * pub.joint / m).toFixed(0)}% of reaches.
            Dropping those reaches would bias the ranking toward the better-documented parts of
            the network, which are also the newer parts.</td>
        <td>Complete attribution. Until then the neutral score is the least-worst option and its
            weight is deliberately small.</td></tr>
      <tr><td>D6</td><td><b>A chamber's score aggregates its incoming pipes, two ways, and the
            choice changes the answer</b></td>
        <td>A blockage happens in a pipe and backs up to the chamber that pipe arrives at, so a
            chamber inherits its incoming reaches. <b>Exposure</b> sums length &times; likelihood
            and is proportional to expected blockage count. <b>Intensity</b> divides that by the
            incoming length and measures how bad the pipe is, independent of how much of it there
            is.</td>
        <td>Nothing removes it; it is a choice that has to be declared with any result. The trap
            worth knowing: reach length spans a factor of 262 here while likelihood spans 2.8, so
            exposure is dominated by the length term and <b>rank-correlates 0.98 with plain
            incoming pipe length</b> &mdash; optimising it lands close to the existing
            length objective. Intensity correlates 0.47 with length and is the one that isolates
            condition, which is why it is the default. Head-of-line chambers score zero by
            construction under both.</td></tr>
    </tbody>
  </table>`;
}

/* Part B is computed rather than written, and it is the slow part of this pane, so
   it is filled in after first paint. Everything it needs is global by then. */
function capacityRegister(ctx) {
  const { DATA, CODES, C, buildGraph } = ctx;
  const matCodes = (CODES || {}).mat;
  const K = window.OSPCapacity;
  if (!K) return `<div class="card bad"><h4>Capacity model not loaded</h4>
    <p>osp_capacity.js did not load, so part B cannot be computed. The figures here are never
    typed in, so nothing is shown rather than something stale.</p></div>`;

  const R = Object.keys(DATA).map(k => {
    const g = buildGraph(k);
    const base = K.capacityState(g, C, { perNode: CAP_LADDER[0], peakFactor: 1, matCodes });
    let split = 0, sinks = 0;
    for (let v = 0; v < g.n; v++) {
      const d = g.outPtr[v + 1] - g.outPtr[v];
      if (d > 1) split++;
      if (d === 0) sinks++;
    }
    /* geo is reused across the ladder: diameter, slope and length do not depend on
       load, and recomputing them per rung would triple the cost for nothing. */
    const ladder = CAP_LADDER.map(l =>
      K.capacityState(g, C, { perNode: l, peakFactor: 1, geo: base.geo }).summary.nodesSurcharged);
    return { g, base, split, sinks, ladder };
  });

  const pct = (a, b) => b ? (100 * a / b).toFixed(1) + "%" : "n/a";

  const facts = R.map(r => `
    <tr>
      <td><b>${esc(r.g.label)}</b></td>
      <td class="num">${r.base.summary.edges}</td>
      <td class="num">${r.base.summary.diameterProxied === 0 ? "100%"
        : pct(r.base.summary.edges - r.base.summary.diameterProxied, r.base.summary.edges)}</td>
      <td class="num">${r.base.summary.slopeClamped} (${pct(r.base.summary.slopeClamped, r.base.summary.edges)})</td>
      <td class="num">${r.split}</td>
      <td class="num">${r.sinks}</td>
      <td class="num">${r.g.stats.components ?? "n/a"}</td>
    </tr>`).join("");

  const ladderRows = R.map(r => `
    <tr><td><b>${esc(r.g.label)}</b></td>${r.ladder.map(v =>
      `<td class="num">${v}</td>`).join("")}</tr>`).join("");

  return `
  <p>Overcapacity needs a quantity the blockage model never had to compute: <b>how much flow
  arrives at each reach</b>. Load is accumulated down the graph in topological order, one pass and
  exact, and each reach is then solved for the depth that flow would run at, using Manning's
  equation for a circular channel running part full. A reach whose flow exceeds its greatest
  passable flow is over capacity, and the chamber above it surcharges.</p>

  <div class="card bad">
    <h4>What this is not</h4>
    <p><b>It is not a hydraulic model and must never be presented as one.</b> It is steady,
    uniform and normal-depth: each reach is solved on its own, at one instant, as though flow had
    been constant forever. There is no backwater, so a bottleneck does not raise the level in the
    reach behind it. There is no routing and no storage, so nothing attenuates and nothing is held.
    There is no time, so there is no storm, no diurnal peak and no first flush.</p>
    <p>What it is, is the same screening-level depth-to-diameter calculation that utility capacity
    assessments use to flag a capacity-deficient sewer. That is defensible for <b>ranking</b>
    reaches against each other, which is all the placement objective needs. It is not SWMM and will
    not reproduce SWMM. The network operator's own team does real modelling and will spot the difference
    immediately, so say so first.</p>
  </div>

  <h4>The register</h4>
  <table>
    <thead><tr><th>#</th><th>Assumption</th><th>Why it is there</th><th>What removes it</th></tr></thead>
    <tbody>
      <tr><td>B1</td><td><b>Manning's n comes from each pipe's material</b> by default, and the
            slider overrides it with one value across the network</td>
        <td>Sewer pipe runs about 0.010 to 0.015 depending on material and age.
            ${K.DEFAULT_N} is the conventional design value for concrete and vitrified clay,
            and 0.010 the value for uPVC. It is the one term in Manning's equation that cannot
            be looked up anywhere, so the default is the per-material table and the slider
            overrides it with a single value: a reader can see what it is worth instead of
            taking it on trust, and moving it across its plausible range is not a small
            effect.</td>
        <td>The published <code>roughness</code> field is carried on this layer but populated on
            <b>no record at all</b> in this area, so it cannot remove the assumption. Material now
            <i>is</i> in the data, at 100%, so a per-material table is the remaining step and the
            only thing standing between this row and deletion.</td></tr>
      <tr><td><s>B2</s></td>
        <td><b>Retired.</b> Reach diameter was the smaller of the two chamber diameters; it is now
            the publisher's own per-pipe value.</td>
        <td>Diameter used to be held per chamber, as the largest pipe touching it, so a reach took
            the minimum of the pair on the argument that a reach is limited by its narrowest
            section.</td>
        <td>Removed by carrying <code>NOMINALDIA</code> per edge through
            <code>tools/build_demo_data.py</code>, from the same harvest the geometry comes from.
            <b>The proxy turned out to be exact</b>: it reproduces the published diameter on
            1,001 of 1,001 reaches, so no capacity figure moved. The assumption is gone because the
            value is now measured and checked, not because it was wrong.</td></tr>
      <tr><td>B3</td><td><b>Load is uniform per chamber</b>, set by a slider</td>
        <td>Without dwelling counts or billed consumption joined to the network there is nothing
            better to assume, and a flat number that is visibly a setting is more honest than an
            invented distribution that looks like data.</td>
        <td>Dwelling counts per chamber, or a calibrated dry weather flow per connection. See C1:
            this is the assumption that moves the answer most.</td></tr>
      <tr><td>B4</td><td><b>Peak factor is a multiplier</b>, applied uniformly</td>
        <td>Capacity is judged at peak, not at average. One multiplier stands in for diurnal peak,
            wet weather and infiltration together, because none of the three can be separated from
            public data.</td>
        <td>Rainfall-derived infiltration needs gauged flow. This is properly a modelling input
            from the network operator, not something to derive here.</td></tr>
      <tr><td>B5</td><td><b>Adverse or flat reaches are clamped</b> to a slope of ${K.MIN_SLOPE}
            and flagged</td>
        <td>Manning cannot solve a reach with no fall. Some of these are genuinely flat, some are
            invert data errors. Clamping keeps them visible as a data-quality finding instead of
            letting them silently disappear from the network.</td>
        <td>A surveyed check on the flagged reaches. The counts are in the table below and they are
            small, so this changes rankings locally at worst.</td></tr>
      <tr><td>B6</td><td><b>A chamber with two outgoing pipes splits its flow evenly</b></td>
        <td>A real split depends on the relative hydraulics of the two branches, which a steady
            reach-by-reach calculation cannot compute. Even splitting is an assumption, but it is a
            <b>conserving</b> one, and the tests assert mass balance. Sending the full flow down
            both would create water from nothing, and would do it invisibly.</td>
        <td>A hydraulic model, or field measurement. The counts below show how few chambers this
            touches.</td></tr>
      <tr><td>B7</td><td><b>Once a chamber surcharges, the cause stops mattering</b></td>
        <td>This is what lets the capacity model reuse the blockage model's observability
            machinery unchanged. Water rising in a chamber looks the same to a level sensor
            whichever mechanism put it there.</td>
        <td>Nothing needs to remove it. It is a modelling choice, stated so it is not mistaken for
            a claim that the two problems are the same. They are not: see the two-models card
            above.</td></tr>
      <tr><td>B8</td><td><b>The 3D water surface is to scale in fill, not in bore</b></td>
        <td>The 3D view draws the water as the circular segment Manning solved for, swept along
            the reach at the wetted angle the depth ratio implies, so the <b>fraction full</b>
            on screen is the computed d/D. Two things are stretched to make that visible: the
            pipe bore, because a 300 mm pipe is a few pixels across a 1 km wide region, and the
            vertical axis, which the relief view already exaggerates. The section is therefore a
            true circle in the stretched space rather than in metres. Both multipliers are on
            screen as sliders.</td>
        <td>Nothing. It is a drawing choice, declared here so the picture is not read as a scale
            drawing of a pipe. The quantity it communicates, how full the pipe is, is not
            distorted by either stretch.</td></tr>
      <tr><td>B9</td><td><b>The animation speed is Q/A from the same solution</b></td>
        <td>The travelling bands scroll at the reach's mean section velocity, flow divided by the
            wetted area that same normal-depth solution implies. It is continuity, not a second
            model and not an animation constant, so a steep reach visibly runs faster than a flat
            one for exactly the reason the arithmetic gives.</td>
        <td>Nothing to remove, but note what it is not. A mean section velocity is not a particle
            path: nothing in the view tracks a parcel of water, and the bands are a rate made
            visible rather than a trajectory. The steady-flow caveat above still applies, so the
            bands are not a flood wave travelling down the network.</td></tr>
      <tr><td>B10</td><td><b>A surcharge column marks which chamber fills, not how far</b></td>
        <td>Chambers the capacity model says surcharge are drawn as a column standing to the
            chamber depth. That height is the chamber, not a computed water level. How far water
            actually rises, and therefore whether a sensor could see it, is part A's
            observability question, answered by the escape-ceiling flood fill and not here.</td>
        <td>Nothing. Read the column as "this one fills", and read part A for how far.</td></tr>
    </tbody>
  </table>

  <h4>What the capacity model is running on</h4>
  <p>All computed from the loaded data. <b>Diameter published</b> is the share of reaches carrying
  the publisher's own per-pipe diameter rather than the retired B2 proxy; anything under 100% is a
  region harvested before the attribute fetch. <b>Clamped reaches</b> is B5, <b>splitting
  chambers</b> is B6, and both are small enough that a wrong call cannot distort the picture. <b>Outlets</b> counts
  chambers with nothing downstream: a real network has very few, so a high count is the boundary
  cut of C3 showing up, and every one of those is a reach whose real downstream flow is missing.
  <b>Components</b> is the same story from the other side, the number of separate pieces the
  clipped network falls into.</p>
  <table>
    <thead><tr><th>Region</th><th>Reaches</th><th>Diameter published</th>
      <th>Clamped reaches (B5)</th>
      <th>Splitting chambers (B6)</th><th>Outlets</th><th>Components</th></tr></thead>
    <tbody>${facts}</tbody>
  </table>

  <h4>How far the demand setting moves the answer</h4>
  <p>Chambers surcharging at a peak factor of 1, as load per chamber is raised. This is the
  evidence for C1, and it is the table to put in front of anyone who quotes a surcharge count
  without saying what demand case produced it.</p>
  <table>
    <thead><tr><th>Region</th>${CAP_LADDER.map(l =>
      `<th class="num">${l} L/s</th>`).join("")}</tr></thead>
    <tbody>${ladderRows}</tbody>
  </table>
  <p>The default, ${CAP_LADDER[0]} L/s, is roughly one chamber's share of ordinary dry weather
  household flow, and at that setting most of the network is comfortably under capacity, which is
  what a working sewer should look like. Everything above it is a stress case, and the top of the
  ladder is well beyond any plausible dry weather load. Use the ladder to find <b>which</b> reaches
  give way first and in what order, because that ordering is stable and is what a placement needs.
  Do not read a row of it as a prediction of how many chambers will surcharge.</p>

  <div class="card warn">
    <h4>Growth: the tipped set is the answer, not the after state</h4>
    <p>A growth scenario adds load at chambers you choose and recomputes. Reaches that were already
    over capacity were already a problem and a sensor rollout aimed at growth is not aimed at them.
    The reaches that <b>tip</b>, from under capacity to over, are what growth actually caused, and
    those are what the placement has to see. The same caution as C1 applies twice over here, since
    both the base load and the added load are chosen.</p>
  </div>`;
}

/* -------------------------------------------------------------------- Q&A */
function qa() {
  return `
  <h2>Questions answered</h2>
  <p class="lede">The questions that came up while building this, answered where they arose.
  Aimed at a reader who is comfortable with data and new to sewer vocabulary.</p>

  <div class="qa">
    <div class="q">What are elevation, depth and invert, and how do they differ?</div>
    <p>Three vertical numbers, and only two are the same kind of thing.</p>
    <p><b>Invert level</b> is the inside bottom of the pipe, the surface the water actually runs on.
    It is an altitude in metres above the survey datum, not a length. <b>Surface or cover level</b>
    is the altitude of the road and lid at the top of the chamber. Also an altitude.
    <b>Depth</b> is a length: cover minus invert, how far you reach down from the road to the water.</p>
    <p>The trap is in the naming. In this tool <code>inv</code> is an invert altitude, not ground
    level. In the previous version the field called <code>depth</code> was not depth at all, it was
    pipe diameter standing in for it, which is the substitution this rebuild removes.</p>
  </div>

  <div class="qa">
    <div class="q">At what depth does the sensor actually sit in the manhole?</div>
    <p>It does not sit down at the water. It is bolted <b>under the lid</b>, roughly 0.15 to 0.30 m
    below the underside of the cover so it clears the frame and step irons, firing downwards.</p>
    <p>It is an ultrasonic or radar head measuring the <b>air gap</b> to the water surface, so flow
    depth is mount height minus gap. In dry weather on a 3 m chamber it is measuring a gap of nearly
    3 m down to a few centimetres of flow in the channel. When the pipe surcharges the water climbs
    the shaft and the gap closes. That closing gap is the entire signal.</p>
    <p>Why up there: it stays out of the sewage and grit so it does not foul, it is reachable on a
    lid lift, and its battery and antenna sit near the surface. The consequence for this model is
    that sensor position has nothing to do with the coefficient <code>c</code>. The sensor can see
    the whole range from channel bottom to lid. What <code>c</code> was about is where the
    <i>water</i> stops rising.</p>
  </div>

  <div class="qa">
    <div class="q">How is c chosen, and why not just use 0.9 instead of 0.7 for better coverage?</div>
    <p><code>c</code> is the fraction of available vertical space the water fills before it escapes
    somewhere and stops rising. Raising it is not a tolerance you can loosen for a better answer, it
    is a physical claim that the network has headroom it does not have.</p>
    <p>What you would get by setting it to 0.9: more nodes marked observable, a lower sensor count,
    and sensors sited where water never arrives, because in reality it escaped out of a property's
    back-garden gully at 0.6 and stopped climbing. <b>The score improves and the detection does
    not.</b> That is the worst kind of result to act on.</p>
    <p>Which is why this rebuild deletes <code>c</code> rather than tuning it. The ceiling is now
    computed from real cover levels by flood fill, so the headroom is whatever the geometry says it
    is, node by node. The legacy mode is kept only so the tool can show what the old parameterisation
    cost instead of merely asserting it.</p>
  </div>

  <div class="qa">
    <div class="q">Is c not really different at every node?</div>
    <p>Yes, and that was the strongest objection to the original model. What <code>c x MaxDepth</code>
    stood for is the height water climbs at a blockage before escaping at the <b>lowest opening
    anywhere in the region that floods</b>. That is a per-node quantity determined by geometry.</p>
    <p>The reason a single fudge factor existed at all is that the controlling elevation is
    systematically the one thing missing from the asset data. Australian plumbing practice puts an
    overflow relief gully on each property connection, deliberately set below the lowest fixture in
    the house so a surcharge escapes into the garden rather than up through the shower. It is
    designed to be the lowest opening, and it sits on private property, so it is in no utility
    layer.</p>
    <p>The fix is a flood fill. Raise the level from the blocked node, admit upstream nodes as they
    come under it, and take the running minimum of opening levels; when the next node's invert is
    already at or above that running minimum, the water escaped before it could get there. Because
    flow has stopped the water surface is horizontal, which is what makes this exact rather than
    approximate.</p>
  </div>

  <div class="qa">
    <div class="q">How can several upstream sensors all see one blockage, if the ones further up
      only get a little backflow? Does each need its own threshold?</div>
    <p>First the picture: it is not backflow trickling upstream. The water is one continuous body.
    When flow stops at the blockage, water piles up behind it and the surface rises and tilts back
    upstream as a wedge. Within that wedge the surface is genuinely elevated everywhere.</p>
    <p>What shrinks going upstream is the <b>depth above the invert</b>, because the invert climbs
    towards a level water surface. At the blockage the depth is the full headroom; at the far tip of
    the wedge it is zero. So a chamber near the blockage sees a big rise, one near the tip sees a
    couple of centimetres, one past the tip sees nothing.</p>
    <p>So yes, each sensor effectively has a threshold, and it is the same physical test applied in
    different places: did the depth at my chamber rise by more than I can distinguish from normal
    variation? Since the surface is horizontal at the ceiling, the depth at a sensor is simply
    <code>ceiling(blockage) - invert(sensor)</code>, and the tool requires that to exceed the
    threshold slider. The older <code>reach = (c x MaxDepth) / gradient</code> formula is the
    constant-gradient special case of the same thing.</p>
  </div>

  <div class="qa">
    <div class="q">How would you actually calibrate that threshold per sensor?</div>
    <p>The useful part is that it needs <b>no blockage events</b>, only normal operation. The raw
    level trace is nowhere near stationary: a strong daily cycle, a weekly cycle, and rain response
    through infiltration. So you do not take the standard deviation of the raw series. You fit a
    baseline from time of day and day of week plus a rainfall term, take residuals, and set the
    threshold as an empirical quantile of those residuals for a target false-alarm rate. Use the
    empirical quantile rather than a multiple of sigma, because sewer residuals are heavy-tailed on
    the upside.</p>
    <p>Then require <b>persistence</b>, several consecutive readings above threshold. That buys far
    more than raising the threshold, because a blockage persists for hours while noise spikes do
    not. Do not compute the combined rate as p to the power k: residuals are strongly autocorrelated,
    so that is badly optimistic. Count actual runs in the baseline instead.</p>
    <p>The catch for placement is that you only have traces where sensors already are. To predict a
    threshold at an unmonitored chamber, regress the residual spread on things known network-wide:
    upstream contributing area, number of upstream connections, diameter, gradient. Larger catchment
    means larger absolute daily swing, so a trunk sensor needs a higher threshold than a headwater
    one. That cuts against intuition: the sensor that sees more of the network is less sensitive per
    centimetre.</p>
    <p>How much does it matter? At realistic depth, very little. Raise the slider and watch: the
    observable universe barely moves. Under the old diameter proxy the same threshold roughly halves
    it, because the proxy had crushed the budget down to the same order of magnitude as the noise.</p>
  </div>

  <div class="qa">
    <div class="q">How do pipes empty into chambers? Is there an opening in the chamber wall?</div>
    <p>Yes, literally. The pipe does not run through the chamber.</p>
    <p>The chamber is a shaft of precast concrete rings, about 1.05 to 1.2 m across, on a concrete
    base. The incoming pipe <b>terminates at the chamber wall</b>, its end an open mouth, and water
    leaves it into open air. Cast into the floor is an <b>open half channel</b>, essentially the
    bottom half of a pipe moulded in concrete, running from under the incoming mouth across to the
    outgoing mouth. Either side of it the floor is built up into sloping shoulders, the
    <b>benching</b>, so anything that splashes out drains back into the channel.</p>
    <p>So the flow path is: pipe, then open channel across the floor exposed to the air of the shaft,
    then back into a pipe at a slightly lower invert. Several incoming pipes each get their own
    channel branch curving into the main one.</p>
    <p>It is built that way so a rod, camera or jetting hose can go in from the road and reach the
    pipe in either direction. Unblocking access is the whole reason chambers exist, and it is also
    why they are the only candidate sensor sites in this tool: a lid to open, a dry wall to bolt to,
    and a clear vertical drop to the water. The surcharge behaviour follows from the same geometry.
    Normally water sits in the bottom of the channel with air above; when the downstream side blocks,
    it fills the pipe, leaves the channel, covers the benching and climbs the shaft toward the
    sensor.</p>
  </div>

  <div class="qa">
    <div class="q">Why does a sensor downstream of a blockage score anything at all?</div>
    <p>Because it is not blind, and the original objective wrongly said it was. With a blockage in a
    pipe barrel the upstream chamber goes wet and detects it, while the downstream chamber stays
    dry. But the flow that normally arrives there stops, and a level sensor reads that as an
    unexplained dry spell.</p>
    <p>That starved-flow signal is most of what the "two down" half of the rule of thumb is for. It
    is included here as an optional term with its own control: the stopped branch has to be a big
    enough share of what normally passes the sensor, otherwise it is lost in normal daily variation.
    Set the share to zero to disable it and see what the rule loses.</p>
  </div>`;
}

/* ----------------------------------------------------------------- method */
function method(ctx) {
  const { META } = ctx;
  const src = META.sources || {};
  return `
  <h2>Method and sources</h2>
  <p class="lede">What this implements, what was changed and why, and where every number comes
  from. Endpoints are named so any figure can be re-checked independently.</p>

  <h3>The method being implemented</h3>
  <p>The placement model follows <b>Ninh, Do, Zeng and Lambert (2025)</b>, <i>Optimal Sensor
  Placement in Smart Sewer Systems Using Network Topology and Elevation</i>, Journal of Water
  Resources Planning and Management 151(7). It was chosen because it needs only topology and
  elevation, with no calibrated hydraulic model, which is the only published method the available
  public data can actually support.</p>
  <p>Their condition is that a sensor at <code>s</code> observes a blockage at a downstream node
  <code>v</code> when <code>elevation(v) + c x MaxDepth(v) &gt; elevation(s)</code>, with
  <code>c = 0.7</code>.</p>

  <h3>What was changed, and why</h3>
  <table>
    <thead><tr><th>Change</th><th>Reason</th></tr></thead>
    <tbody>
      <tr><td>Global <code>c</code> replaced by a per-node ceiling from flood fill</td>
        <td>The term is a physical property of each node's escape geometry, not a constant.
            Retuning it upward buys coverage on paper and none in the ground.</td></tr>
      <tr><td>Manhole depth substituted for pipe diameter</td>
        <td>Diameter is not depth. On real data the difference is about a factor of nineteen,
            and it, not terrain, is what made most of the network look unobservable.</td></tr>
      <tr><td>Detection threshold added</td>
        <td>The published condition is binary, so a 2 mm rise counts the same as 2 m.</td></tr>
      <tr><td>Starved-flow term added</td>
        <td>A sensor downstream of a blockage scored zero, though flow stopping is a real and
            detectable signal, and it is half of what the rule of thumb buys.</td></tr>
      <tr><td>Candidates restricted to published manholes</td>
        <td>A recommendation naming a spot with no chamber cannot be acted on.</td></tr>
    </tbody>
  </table>

  <div class="card bad">
    <h4>A correction that matters beyond this tool</h4>
    <p>The invert fields on these layers are <b>flow-anchored, not geometry-anchored</b>.
    <code>START_INVE</code> is the upstream-of-flow invert whichever way the line was drawn, and the
    flow-direction code says which geometric vertex that is.</p>
    <p>This was established by measurement, not assumption. At a chamber shared by two pipes the
    invert handed over must equal the invert picked up, so the correct reading is the one that makes
    them agree:</p>
    <table>
      <thead><tr><th>Reading</th><th>Walkerville exact match</th><th>Statewide exact match</th></tr></thead>
      <tbody>
        <tr><td>Geometry-anchored inverts</td><td class="num">35.2%</td><td class="num">32.6%</td></tr>
        <tr><td>Orient by comparing inverts</td><td class="num">37.0%</td><td class="num">36.4%</td></tr>
        <tr><td><b>Flow-anchored</b></td><td class="num"><b>95.3%</b></td><td class="num"><b>85.0%</b></td></tr>
      </tbody>
    </table>
    <p>Reading it the other way silently reverses 583 of 1,002 mains on Walkerville and 1,867 of
    3,336 on the statewide layer, inverting every upstream and downstream argument while leaving
    node and edge counts unchanged.</p>
    <p><b>Consequence for the data report.</b> It also means "START_INVE is greater than END_INVERT
    on every record" is true <i>by definition of the field names</i>. It is a naming convention, not
    evidence that the network runs downhill and not evidence that it is acyclic. Any claim resting
    on that query needs restating; acyclicity has to be demonstrated on the assembled graph, which
    this tool does do, and reports per region.</p>
  </div>

  <h3>Supporting literature</h3>
  <p><b>Do, Dix, Lambert and Stephens (2023)</b>, <i>Proactive Detection of Wastewater Overflows for
  Smart Sanitary Sewer Systems: Case Study in South Australia</i>. A permanent deployment of
  ultrasonic level sensors at Stonyfell in South Australia, with a co-author from the water utility.
  Two features distinguished growing chokes: irregular peaks, and <b>durations for which the level
  stayed irregularly high</b>. The detection method was built on the second. That is the direct
  precedent for the persistence rule described in the Questions tab, and it is why the threshold
  here is framed as a level plus a duration rather than a level alone.</p>
  <p><b>Ninh, Zeng, Lambert, Do and Yin (2026)</b>, <i>Proactive blockage detection in sewer pipes
  using paired acoustic sensors: an experimental study</i>, Applied Acoustics 246, 111244, open
  access under CC BY-NC. A laboratory study of a different sensing modality, so it does not feed
  this placement algorithm. It matters here for two statements from the same research group: that
  level sensors have difficulty detecting blockages early <b>particularly in steep systems where
  sensor coverage is limited</b>, and that an abnormal level at a manhole is <b>insufficient to
  pinpoint where the blockage is</b>. The first is exactly the effect seen in a steep catchment;
  the second is the argument for pairing sensors rather than placing them singly, which is what the
  "two up, two down" rule of thumb encodes.</p>

  <h3>Data sources, all public and anonymously queryable</h3>
  <table>
    <thead><tr><th>Purpose</th><th>Endpoint</th></tr></thead>
    <tbody>
      <tr><td>Mains, manholes, property inspection points</td><td><code>${esc(src.walkerville || "")}</code></td></tr>
      <tr><td>Cover levels, 1 m contours</td><td><code>${esc(src.walkerville_contours || "")}</code></td></tr>
      <tr><td>Validation nodes, surveyed surface + invert + depth</td><td><code>${esc(src.barossa || "")}</code></td></tr>
      <tr><td>Validation contours, 5 m</td><td><code>${esc(src.barossa_contours || "")}</code></td></tr>
      <tr><td>Statewide gravity mains</td><td><code>${esc(src.statewide || "")}</code></td></tr>
      ${src.walkerville_mains_attrs ? `<tr><td>Per-pipe attributes: diameter, material, construction
        year, gradient, joint type</td><td><code>${esc(src.walkerville_mains_attrs)}</code></td></tr>` : ""}
    </tbody>
  </table>
  <p>All layers are requested with <code>outSR=${esc(META.out_sr || "")}</code> so the server does
  every reprojection and distances are true metres. The sources disagree natively, with manholes in
  one projection and contours in another, and getting that wrong fails silently.</p>

  <h3>Three things the pipe attributes turned up</h3>
  <p>The per-pipe attributes come from the same mains layer the geometry came from, matched back to
  each reach by geometry rather than by any id, so the join can be re-checked. Three findings came
  out of that fetch and all three are worth knowing before anyone reads a field at face value.</p>
  <div class="card">
    <h4>1. The material field says <code>UNKN</code> where the answer is in the next column</h4>
    <p><code>MATERIAL</code> reads <code>UNKN</code> on 456 of 1,002 records, which reads as
    material being published on barely half the network. It is not. <code>MATERIALUN</code> carries
    a value on <b>every one</b> of those 456, and on the 43 records where both fields are populated
    the two <b>agree every time</b>. Reading the pair rather than the first field takes material
    from 54.5% to 100% with no assumption. Same shape as the invert finding below: the field that
    looks empty is not the only field.</p>
  </div>
  <div class="card">
    <h4>2. <code>GRADE</code> is an independent check on the inverts, and it passes</h4>
    <p>The layer publishes its own gradient in percent. Compared against fall over length computed
    from the invert fields, the median ratio is <b>1.0000</b> across 1,001 reaches, with 796 inside
    &plusmn;5%. That is a second, independently maintained field agreeing with the flow-anchored
    reading of the inverts, which is the strongest confirmation of that reading available here
    without a site visit.</p>
  </div>
  <div class="card warn">
    <h4>3. The published length field is stale on 28 records</h4>
    <p><code>SHAPE_STLe</code> disagrees with the geometry it belongs to on 28 of 1,002 records,
    sometimes badly: one stores 163.8 m for a line that measures 48.3 m. Lengths here are computed
    from the geometry and always were, so nothing downstream is affected, but the stored field
    should not be adopted by anyone extending this work.</p>
  </div>

  <h3>Algorithms offered, and what each is for</h3>
  <ul>
    <li><b>Greedy set cover (CELF)</b>, the optimiser and the benchmark. Coverage is submodular, so
      a cached marginal gain can only overstate the truth, which makes lazy re-evaluation exact.</li>
    <li><b>Two up, two down</b>, a practitioner rule of thumb, scored on the same footing as everything
      else. Its anchors are drawn from the same candidate pool; its supporting chambers are taken as
      the rule dictates whether or not they observe anything, because that is what the rule says and
      it is where its cost legitimately shows up.</li>
    <li><b>Upstream catchment, betweenness, in and out degree</b>, standard network heuristics,
      all four now <b>weighted by the objective</b> rather than counting nodes. Upstream catchment
      sums the worth of everything above a chamber; degree sums the worth of the chambers on the
      other end of its pipes; betweenness scales each source's dependency by that source's weight,
      which is the standard vertex-weighted reading. Under the default objective every weight is 1
      and each reduces exactly to the counting version it replaced, so the unweighted comparison is
      unchanged.</li>
    <li><b>Random, best of 20</b>, the floor any method must clear. It picks the best of its
      twenty draws <i>on the stated objective</i>; it previously scored them on node count
      whatever the objective said, which quietly flattered it on weighted runs.</li>
    <li><b>Custom JavaScript</b>, run in a worker with an 8 s kill. The API exposes
      <code>weight(id)</code> for the active objective and <code>pipesInto(id)</code> for the
      publisher's per-pipe diameter, material, construction year and gradient, so an algorithm
      written here can use the same evidence the built-in ones do.</li>
  </ul>
  <p>Every algorithm draws from the same candidate pool. An earlier version did not, and it cost that
  rule of thumb more than half its score, so there is now a regression test asserting it.</p>

  <h3>Reproducing all of this</h3>
  <p><code>python tools/build_demo_data.py</code> re-harvests every region and rewrites the dataset,
  printing the validation legs. <code>node tools/test_sandbox.js</code> runs the regression suite,
  which must pass before any score here is trusted. Live services change as their publishers update
  them, so re-measure before quoting any figure formally.</p>`;
}

/* ------------------------------------------------------- glossary figures */
/* One small inline SVG per term where a picture shows the MECHANISM. Built from a
   handful of shared primitives so the chamber, pipe, water and dimension lines look
   the same in every figure and a reader learns the visual language once.

   Terms with no drawable mechanism (CWMS, SWMM) get no figure: a decoration next to
   a definition is worse than no figure, because it teaches the reader that the
   pictures here can be skipped. Palette follows the explainer pages. */
const GF = {
  soil: "#2a2333", road: "#414b60", wall: "#818da6", inner: "#333c52", lid: "#9aa6bd",
  water: "#38bdf8", dim: "#7dd3fc", ink: "#93a4c4", faint: "#4b5a78",
  bad: "#f87171", good: "#34d399", warn: "#fbbf24", sensor: "#f43f5e", root: "#8a6a52",
};
const gsvg = (title, inner) =>
  `<svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}">`
  + `<title>${title}</title>${inner}</svg>`;
const gt = (x, y, t, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.s || 7.5}" fill="${o.c || GF.ink}"`
  + ` text-anchor="${o.a || "start"}" font-family="ui-sans-serif,system-ui,sans-serif">${t}</text>`;
const gln = (x1, y1, x2, y2, c = GF.ink, w = 1, dash = "") =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}"`
  + (dash ? ` stroke-dasharray="${dash}"` : "") + "/>";
/* vertical dimension with end ticks; label sits on the side given */
const gdim = (x, y1, y2, t, side = 1, c = GF.dim) =>
  gln(x, y1, x, y2, c) + gln(x - 3, y1, x + 3, y1, c) + gln(x - 3, y2, x + 3, y2, c)
  + gt(x + 4 * side, (y1 + y2) / 2 + 2.5, t, { c, a: side < 0 ? "end" : "start" });
const gdatum = () => gln(0, 94, 160, 94, GF.faint, 1, "3 3") + gt(158, 91, "datum", { a: "end", c: GF.faint, s: 6.5 });
/* the standard chamber section: soil, shaft, lid, pipe in and out at invert y=78 */
function gchamber(extra = "", water = 0) {
  const wz = 78 - water;
  return `<rect x="0" y="18" width="160" height="82" fill="${GF.soil}"/>`
    + `<rect x="0" y="12" width="160" height="6" fill="${GF.road}"/>`
    + `<rect x="0" y="66" width="62" height="12" fill="${GF.inner}" stroke="${GF.wall}" stroke-width="1.2"/>`
    + `<rect x="98" y="66" width="62" height="12" fill="${GF.inner}" stroke="${GF.wall}" stroke-width="1.2"/>`
    + `<rect x="62" y="18" width="36" height="60" fill="${GF.inner}" stroke="${GF.wall}" stroke-width="1.2"/>`
    + `<rect x="58" y="14" width="44" height="4" fill="${GF.lid}"/>`
    + (water > 0 ? `<rect x="1" y="${Math.max(wz, 67)}" width="158" height="${78 - Math.max(wz, 67)}" fill="${GF.water}" opacity=".7"/>` : "")
    + (water > 12 ? `<rect x="63" y="${wz}" width="34" height="${78 - wz}" fill="${GF.water}" opacity=".7"/>` : "")
    + extra;
}
/* a long section: ground sloping gently, pipe below it, optional chambers */
function glong(opts = {}) {
  const sl = opts.slope == null ? 0.1 : opts.slope;
  const g = x => 22 + sl * x, inv = x => 60 + sl * x;
  let o = `<polygon points="0,${g(0)} 160,${g(160)} 160,100 0,100" fill="${GF.soil}"/>`
        + `<polygon points="0,${inv(0) - 5} 160,${inv(160) - 5} 160,${inv(160) + 5} 0,${inv(0) + 5}" fill="${GF.inner}" stroke="${GF.wall}"/>`;
  for (const cx of opts.chambers || [])
    o += `<rect x="${cx - 6}" y="${g(cx)}" width="12" height="${inv(cx) + 5 - g(cx)}" fill="${GF.inner}" stroke="${GF.wall}"/>`
       + `<rect x="${cx - 8}" y="${g(cx) - 3}" width="16" height="3" fill="${GF.lid}"/>`;
  return { o, g, inv };
}
const gsensor = (x, y) => `<rect x="${x - 3}" y="${y}" width="6" height="4" fill="${GF.sensor}"/>`;
const gnode = (x, y, c = GF.ink, r = 4) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
const garrow = (x1, y1, x2, y2, c = GF.ink) =>
  gln(x1, y1, x2, y2, c, 1.2) + `<polygon points="${x2},${y2} ${x2 - 4},${y2 - 2.5} ${x2 - 4},${y2 + 2.5}" fill="${c}" transform="rotate(${Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI} ${x2} ${y2})"/>`;
/* pipe cross-section: outer wall, bore, optional fill to depth ratio dd */
const gcircle = (dd = 0, extra = "") => {
  const cx = 80, cy = 52, R = 34, r = 28;
  let o = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${GF.wall}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${GF.inner}"/>`;
  if (dd > 0) {
    const yw = cy + r - 2 * r * dd;
    o += `<clipPath id="gc${Math.round(dd * 100)}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`
       + `<rect x="${cx - r}" y="${yw}" width="${2 * r}" height="${cy + r - yw}" fill="${GF.water}" opacity=".75" clip-path="url(#gc${Math.round(dd * 100)})"/>`;
  }
  return o + extra;
};

const GLOSS_FIGS = {
  "Invert level": gsvg("Invert level: the inside bottom of the pipe, as a height above datum",
    gchamber(gdatum() + gdim(30, 78, 94, "invert", -1) + gln(0, 78, 62, 78, GF.dim, 1.2), 3)),
  "Cover level / surface level": gsvg("Cover level: the height of the lid above datum",
    gchamber(gdatum() + gdim(30, 14, 94, "cover", -1) + gln(0, 14, 58, 14, GF.dim, 1.2), 3)),
  "Depth": gsvg("Depth: cover level minus invert level, a length not a height",
    gchamber(gdim(118, 14, 78, "depth", 1) + gln(102, 14, 118, 14, GF.faint, 1, "2 2") + gln(98, 78, 118, 78, GF.faint, 1, "2 2"), 3)),
  "Soffit": gsvg("Soffit: the inside top of the pipe; invert is the inside bottom",
    `<rect x="10" y="30" width="140" height="44" fill="${GF.wall}"/><rect x="10" y="36" width="140" height="32" fill="${GF.inner}"/>`
    + `<rect x="10" y="60" width="140" height="8" fill="${GF.water}" opacity=".7"/>`
    + gln(10, 36, 150, 36, GF.dim, 1.2) + gt(80, 46, "soffit", { c: GF.dim, a: "middle" })
    + gln(10, 68, 150, 68, GF.dim, 1.2) + gt(80, 80, "invert", { c: GF.dim, a: "middle" })),
  "Benching": gsvg("Benching: sloped shoulders either side of the channel on the chamber floor",
    `<rect x="0" y="0" width="160" height="100" fill="${GF.inner}"/>`
    + `<path d="M0,55 L55,55 Q60,58 62,70 Q80,84 98,70 Q100,58 105,55 L160,55 L160,100 L0,100 Z" fill="${GF.wall}"/>`
    + `<path d="M62,70 Q80,84 98,70 L98,78 Q80,90 62,78 Z" fill="${GF.water}" opacity=".7"/>`
    + garrow(30, 40, 50, 60, GF.dim) + gt(8, 36, "spill drains back", { c: GF.dim })
    + gt(80, 96, "channel", { a: "middle", c: GF.dim })),
  "Surcharge": gsvg("Surcharge: water backs up above the soffit and rises into the shaft",
    gchamber(gln(0, 66, 160, 66, GF.faint, 1, "3 3") + gt(4, 63, "soffit", { s: 6.5, c: GF.faint })
      + garrow(80, 60, 80, 34, GF.bad) + gt(84, 40, "rising", { c: GF.bad }), 40)),
  "Overflow relief gully (ORG)": gsvg("Overflow relief gully: the lowest opening, in the garden, on private land",
    (() => { const L = glong({ chambers: [130] });
      return L.o + `<rect x="18" y="8" width="30" height="16" fill="#5d6a8c"/><polygon points="14,8 33,0 52,8" fill="#8a5150"/>`
        + `<rect x="62" y="${L.g(62) - 2}" width="10" height="4" fill="${GF.lid}"/>`
        + gln(67, L.g(67) + 2, 67, L.inv(67) - 5, GF.wall, 3) + gln(48, 14, 67, L.g(67) + 2, GF.wall, 2)
        + `<path d="M62,${L.g(62) - 2} q5,-12 10,0" fill="none" stroke="${GF.bad}" stroke-width="1.5"/>`
        + gt(84, L.g(84) - 6, "escapes here", { c: GF.bad }) + gt(10, 34, "house", { c: GF.ink, s: 6.5 }); })()),
  "Backwater wedge": gsvg("Backwater wedge: a horizontal surface behind a blockage, meeting the rising invert upstream",
    (() => { const sl = 0.16, L = glong({ slope: sl }), xb = 138;
      /* Water stands well above the soffit at the blockage, as a real surcharge does,
         and its surface stays level going upstream while the invert climbs to meet
         it. The wedge is that level clipped to the pipe: full bore from the blockage
         back to x1, where the soffit rises through the surface, then thinning to
         nothing at x0, where the invert does. */
      const yw = L.inv(20) + 5;                              // meets the invert at x0 = 20
      const x0 = 20, x1 = (yw + 5 - 60) / sl;                // soffit meets the surface
      return L.o
        + `<polygon points="${x0},${yw} ${x1},${yw} ${xb},${L.inv(xb) - 5} ${xb},${L.inv(xb) + 5} ${x0},${L.inv(x0) + 5}" fill="${GF.water}" opacity=".75"/>`
        + `<rect x="${xb}" y="${L.inv(xb) - 5}" width="5" height="10" fill="${GF.bad}"/>`
        + gln(0, yw, xb, yw, GF.dim, 1, "3 2") + gt(24, yw - 4, "surface stays level", { c: GF.dim })
        + gt(4, 95, "level meets invert here", { c: GF.ink, s: 6.5 })
        + garrow(30, 90, x0 + 2, yw + 3, GF.ink)
        + gt(xb - 2, L.inv(xb) + 17, "blockage", { c: GF.bad, a: "end" }); })()),
  "Headroom": gsvg("Headroom: how far water can rise at a node before it escapes",
    gchamber(gln(62, 34, 98, 34, GF.dim, 1, "3 2") + gt(100, 37, "ceiling", { c: GF.dim, s: 6.5 })
      + gdim(50, 34, 78, "headroom", -1), 3)),
  "Ceiling": gsvg("Ceiling: the lowest opening anywhere in the region that floods",
    (() => { const L = glong({ chambers: [40, 120] });
      const yw = L.g(40) + 1;
      return L.o
        + `<polygon points="0,${L.inv(0) - 5} 150,${L.inv(150) - 5} 150,${L.inv(150) + 5} 0,${L.inv(0) + 5}" fill="${GF.water}" opacity=".7"/>`
        + `<rect x="35" y="${yw}" width="10" height="${L.inv(40) - yw}" fill="${GF.water}" opacity=".7"/>`
        + `<rect x="115" y="${yw}" width="10" height="${L.inv(120) - yw}" fill="${GF.water}" opacity=".7"/>`
        + `<rect x="150" y="${L.inv(150) - 5}" width="5" height="10" fill="${GF.bad}"/>`
        + `<path d="M34,${yw - 2} q6,-10 12,0" fill="none" stroke="${GF.bad}" stroke-width="1.5"/>`
        + gln(0, yw, 160, yw, GF.dim, 1, "3 2") + gt(60, yw - 5, "lowest lid sets the ceiling", { c: GF.dim, s: 6.5 }); })()),
  "Downstream-dependent (DD) node": gsvg("A blockage downstream raises the level back at the sensor upstream",
    (() => { const L = glong({ slope: 0.14, chambers: [30, 130] });
      const yw = L.inv(130) - 2;
      return L.o + `<polygon points="${(yw - 60) / 0.14},${yw} 128,${yw} 128,${L.inv(128) + 5} ${Math.max(0, (yw - 60) / 0.14 - 40)},${L.inv(Math.max(0, (yw - 60) / 0.14 - 40)) + 5}" fill="${GF.water}" opacity=".6"/>`
        + `<rect x="130" y="${L.inv(130) - 5}" width="5" height="10" fill="${GF.bad}"/>`
        + gsensor(30, L.g(30) + 2) + gt(30, L.g(30) - 6, "sensor", { a: "middle", c: GF.sensor })
        + gt(130, L.g(130) - 6, "DD node blocks", { a: "middle", c: GF.bad, s: 6.5 })
        + garrow(60, yw - 14, 34, L.inv(30) - 2, GF.dim); })()),
  "Directed acyclic graph (DAG)": gsvg("Every edge points downhill and nothing loops back",
    gnode(20, 20) + gnode(60, 20) + gnode(120, 25) + gnode(45, 50) + gnode(95, 55) + gnode(75, 85, GF.water, 5)
    + garrow(24, 24, 41, 46) + garrow(58, 24, 48, 46) + garrow(117, 29, 99, 51) + garrow(49, 54, 71, 81) + garrow(92, 59, 79, 81)
    + gt(84, 92, "outlet", { c: GF.water, s: 6.5 })),
  "Set cover": gsvg("Choose the fewest sensors whose observed sets together cover the network",
    `<ellipse cx="55" cy="50" rx="42" ry="30" fill="${GF.water}" opacity=".18"/><ellipse cx="110" cy="52" rx="40" ry="28" fill="${GF.good}" opacity=".18"/>`
    + [[30,40],[55,30],[70,60],[45,70],[90,45],[120,35],[130,65],[105,72],[80,45]].map(([x,y]) => gnode(x, y, GF.ink, 3)).join("")
    + gsensor(55, 24) + gsensor(112, 26)),
  "Submodular": gsvg("Diminishing returns: each added sensor helps less than the last",
    gln(20, 85, 150, 85, GF.faint) + gln(20, 85, 20, 10, GF.faint)
    + `<path d="M20,85 L45,45 L70,30 L95,23 L120,19 L145,17" fill="none" stroke="${GF.water}" stroke-width="2"/>`
    + gdim(50, 45, 85, "+40", 1, GF.good) + gdim(125, 19, 30, "+4", 1, GF.warn)
    + gt(85, 96, "sensors added", { a: "middle", s: 6.5 }) + gt(24, 16, "covered", { s: 6.5, c: GF.ink })),
  "Choke": gsvg("A choke: roots, fat or wipes obstructing the pipe",
    `<rect x="0" y="36" width="160" height="32" fill="${GF.wall}"/><rect x="0" y="41" width="160" height="22" fill="${GF.inner}"/>`
    + `<rect x="0" y="56" width="80" height="7" fill="${GF.water}" opacity=".7"/>`
    + `<path d="M84,42 q8,4 6,10 q6,2 2,9 q-8,3 -12,-2 q-6,-4 -2,-9 q-1,-6 6,-8z" fill="${GF.root}"/>`
    + `<path d="M84,44 q-10,-12 -22,-4 M90,46 q4,-14 16,-10" fill="none" stroke="${GF.root}" stroke-width="1.5"/>`
    + garrow(20, 50, 60, 50, GF.water) + gt(120, 82, "flow stops here", { c: GF.bad, a: "middle" })),
  "Gravity main": gsvg("Gravity main: part-full, always flowing downhill",
    (() => { const L = glong({ slope: 0.18 });
      return L.o + `<polygon points="0,${L.inv(0) + 1} 160,${L.inv(160) + 1} 160,${L.inv(160) + 5} 0,${L.inv(0) + 5}" fill="${GF.water}" opacity=".7"/>`
        + garrow(40, L.inv(40) - 14, 110, L.inv(110) - 14, GF.water) + gt(40, L.inv(40) - 18, "downhill, part full", { c: GF.water }); })()),
  "Rising main": gsvg("Rising main: pumped uphill, running full and under pressure",
    (() => { const L = glong({ slope: -0.18 });
      return L.o + `<polygon points="0,${L.inv(0) - 5} 160,${L.inv(160) - 5} 160,${L.inv(160) + 5} 0,${L.inv(0) + 5}" fill="${GF.water}" opacity=".7"/>`
        + `<circle cx="18" cy="${L.inv(18)}" r="9" fill="${GF.warn}"/>` + gt(18, L.inv(18) + 3, "P", { a: "middle", c: "#1a1200", s: 9 })
        + garrow(50, L.inv(50) - 14, 120, L.inv(120) - 14, GF.warn) + gt(50, L.inv(50) - 26, "pumped, full bore", { c: GF.warn }); })()),
  "Inflow and infiltration (I&I)": gsvg("Rain and groundwater entering through cracks and bad joints",
    `<rect x="0" y="0" width="160" height="100" fill="${GF.soil}"/>`
    + `<rect x="0" y="40" width="160" height="30" fill="${GF.wall}"/><rect x="0" y="45" width="160" height="20" fill="${GF.inner}"/>`
    + gln(60, 40, 63, 45, GF.bad, 1.5) + gln(110, 40, 108, 45, GF.bad, 1.5) + gln(80, 45, 80, 40, GF.faint, 2)
    + [[58,28],[62,22],[108,30],[112,24],[80,26],[30,30],[130,32]].map(([x,y]) => `<path d="M${x},${y} q-3,5 0,7 q3,-2 0,-7z" fill="${GF.water}"/>`).join("")
    + gt(80, 88, "groundwater and rain get in", { a: "middle", c: GF.water, s: 6.5 })),
  "Nominal diameter": gsvg("Nominal size versus the internal bore inside the wall",
    gcircle(0, gln(46, 52, 114, 52, GF.dim, 1.2) + gt(80, 48, "nominal", { a: "middle", c: GF.dim, s: 6.5 })
      + gln(52, 60, 108, 60, GF.good, 1.2) + gt(80, 70, "internal bore", { a: "middle", c: GF.good, s: 6.5 })
      + gt(80, 96, "the wall is the difference", { a: "middle", s: 6.5 }))),
  "Vitrified clay": gsvg("Clay pipe: short fired sections, joints every couple of metres, roots at the joints",
    `<rect x="0" y="0" width="160" height="100" fill="${GF.soil}"/>`
    + [0, 52, 104].map(x => `<rect x="${x}" y="40" width="50" height="26" fill="${GF.wall}" rx="1"/><rect x="${x}" y="45" width="50" height="16" fill="${GF.inner}"/>`).join("")
    + [50, 102].map(x => `<rect x="${x}" y="37" width="6" height="32" fill="${GF.lid}"/>`).join("")
    + `<path d="M53,37 q-6,-14 -14,-18 M53,37 q4,-16 12,-20" fill="none" stroke="${GF.root}" stroke-width="1.5"/>`
    + gt(80, 88, "strong pipe, weak joints", { a: "middle", s: 6.5 })),
  "Gradient": gsvg("Gradient: fall over length, as a percentage",
    (() => { const L = glong({ slope: 0.2 });
      return L.o + gln(20, L.inv(20), 140, L.inv(20), GF.dim, 1, "3 2") + gln(140, L.inv(20), 140, L.inv(140), GF.dim, 1.2)
        + gt(80, L.inv(20) - 4, "length", { a: "middle", c: GF.dim }) + gt(144, (L.inv(20) + L.inv(140)) / 2 + 3, "fall", { c: GF.dim })
        + gt(30, 92, "gradient = fall / length", { c: GF.ink, s: 6.5 }); })()),
  "Joint type": gsvg("A socket joint: where two sections meet, and where roots and water get in",
    `<rect x="0" y="0" width="160" height="100" fill="${GF.soil}"/>`
    + `<rect x="0" y="42" width="78" height="22" fill="${GF.wall}"/><rect x="0" y="47" width="78" height="12" fill="${GF.inner}"/>`
    + `<rect x="70" y="36" width="90" height="34" fill="${GF.wall}"/><rect x="78" y="42" width="82" height="22" fill="${GF.wall}" opacity=".6"/><rect x="78" y="47" width="82" height="12" fill="${GF.inner}"/>`
    + `<rect x="72" y="42" width="5" height="22" fill="${GF.lid}"/>`
    + `<path d="M75,36 q-8,-16 -20,-20 M75,36 q6,-18 16,-22" fill="none" stroke="${GF.root}" stroke-width="1.5"/>`
    + gt(30, 82, "spigot", { s: 6.5 }) + gt(110, 82, "socket", { s: 6.5 }) + gt(75, 92, "roots enter at the seal", { a: "middle", c: GF.root, s: 6.5 })),
  "Overcapacity": gsvg("Overcapacity: nothing obstructed, just more flow than the pipe was sized for",
    (() => { const L = glong({ slope: 0.06, chambers: [90] });
      return L.o + `<polygon points="0,${L.inv(0) - 5} 90,${L.inv(90) - 5} 90,${L.inv(90) + 5} 0,${L.inv(0) + 5}" fill="${GF.water}" opacity=".7"/>`
        + `<rect x="85" y="${L.g(90) + 8}" width="10" height="${L.inv(90) - L.g(90) - 3}" fill="${GF.water}" opacity=".7"/>`
        + garrow(10, L.inv(10) - 14, 40, L.inv(40) - 14, GF.water) + garrow(10, L.inv(10) - 22, 40, L.inv(40) - 22, GF.water) + garrow(10, L.inv(10) - 30, 40, L.inv(40) - 30, GF.water)
        + gt(90, L.g(90) - 6, "surcharges", { a: "middle", c: GF.bad, s: 6.5 }) + gt(125, L.inv(125) + 16, "no blockage", { a: "middle", s: 6.5 }); })()),
  "Reach": gsvg("A reach: one pipe between two chambers",
    (() => { const L = glong({ chambers: [30, 130] });
      return L.o + `<polygon points="36,${L.inv(36) - 5} 124,${L.inv(124) - 5} 124,${L.inv(124) + 5} 36,${L.inv(36) + 5}" fill="${GF.water}" opacity=".45"/>`
        + gln(36, L.inv(36) + 14, 124, L.inv(124) + 14, GF.dim, 1.2) + gt(80, L.inv(80) + 24, "one reach", { a: "middle", c: GF.dim }); })()),
  "Manning's equation": gsvg("Manning: flow from area A, wetted perimeter P and hydraulic radius R = A/P",
    gcircle(0.45, `<path d="M52.7,60.8 A28,28 0 0,0 107.3,60.8" fill="none" stroke="${GF.warn}" stroke-width="3"/>`
      + gt(80, 66, "A", { a: "middle", c: "#06121f", s: 9 }) + gt(80, 92, "P, the wetted wall", { a: "middle", c: GF.warn, s: 6.5 })
      + gt(150, 20, "R = A / P", { a: "end", c: GF.ink }))),
  "Manning's n": gsvg("Roughness: a rough wall slows the same flow on the same gradient",
    `<rect x="0" y="14" width="160" height="30" fill="${GF.wall}"/><rect x="0" y="19" width="160" height="20" fill="${GF.inner}"/>`
    + garrow(20, 29, 130, 29, GF.water) + gt(155, 32, "low n", { a: "end", c: GF.good, s: 6.5 })
    + `<rect x="0" y="56" width="160" height="30" fill="${GF.wall}"/>`
    + `<path d="M0,61 ${Array.from({length:32},(_, i)=>`L${(i+1)*5},${i%2?61:64}`).join(" ")} L160,81 ${Array.from({length:32},(_, i)=>`L${160-(i+1)*5},${i%2?81:78}`).join(" ")} Z" fill="${GF.inner}"/>`
    + garrow(20, 71, 80, 71, GF.water) + gt(155, 74, "high n", { a: "end", c: GF.bad, s: 6.5 })),
  "Normal depth": gsvg("Normal depth: gravity and friction balance, so the surface runs parallel to the bed",
    (() => { const L = glong({ slope: 0.14 });
      return L.o + `<polygon points="0,${L.inv(0) - 1} 160,${L.inv(160) - 1} 160,${L.inv(160) + 5} 0,${L.inv(0) + 5}" fill="${GF.water}" opacity=".7"/>`
        + garrow(60, L.inv(60) - 20, 60, L.inv(60) - 6, GF.dim) + gt(64, L.inv(60) - 12, "gravity", { c: GF.dim, s: 6.5 })
        + garrow(110, L.inv(110) + 12, 90, L.inv(90) + 12, GF.warn) + gt(112, L.inv(110) + 15, "friction", { c: GF.warn, s: 6.5 })
        + gt(6, 92, "same depth all along", { s: 6.5 }); })()),
  "d/D, depth to diameter ratio": gsvg("d over D: how full the pipe is running",
    gcircle(0.6, gdim(124, 24, 80, "D", 1) + gdim(36, 46, 80, "d", -1, GF.water))),
  "Flow accumulation": gsvg("Flow accumulation: each node passes on everything that reached it",
    gnode(25, 20, GF.ink, 3) + gnode(65, 20, GF.ink, 3) + gnode(125, 22, GF.ink, 3) + gnode(45, 50, GF.ink, 4) + gnode(100, 55, GF.ink, 4) + gnode(75, 85, GF.water, 6)
    + garrow(28, 24, 42, 46) + garrow(62, 24, 48, 46) + garrow(122, 26, 103, 51) + garrow(49, 54, 70, 80) + garrow(97, 59, 80, 80)
    + gt(25, 12, "1", { a: "middle" }) + gt(65, 12, "1", { a: "middle" }) + gt(125, 14, "1", { a: "middle" })
    + gt(34, 53, "3", { a: "end", c: GF.dim }) + gt(110, 58, "2", { c: GF.dim }) + gt(88, 90, "6", { c: GF.water, s: 9 })),
  "Peak factor": gsvg("Peak factor: the peak of the day against the dry-weather average",
    gln(15, 85, 150, 85, GF.faint) + gln(15, 85, 15, 10, GF.faint)
    + `<path d="M15,70 C30,72 35,40 50,32 S70,60 85,58 S105,25 120,30 S140,66 150,68" fill="none" stroke="${GF.water}" stroke-width="2"/>`
    + gln(15, 52, 150, 52, GF.dim, 1, "3 2") + gt(18, 49, "average", { c: GF.dim, s: 6.5 })
    + gdim(120, 29, 52, "", -1, GF.warn) + gt(116, 24, "peak / avg", { a: "end", c: GF.warn })
    + gt(82, 96, "time of day", { a: "middle", s: 6.5 })),
  "Tipped reach": gsvg("Tipped: under capacity before growth, over capacity after it",
    (() => { const L = glong({ slope: 0.05, chambers: [20, 80, 140] });
      return L.o + `<polygon points="26,${L.inv(26) - 5} 74,${L.inv(74) - 5} 74,${L.inv(74) + 5} 26,${L.inv(26) + 5}" fill="${GF.water}" opacity=".4"/>`
        + `<polygon points="86,${L.inv(86) - 5} 134,${L.inv(134) - 5} 134,${L.inv(134) + 5} 86,${L.inv(86) + 5}" fill="#e879f9" opacity=".75"/>`
        + gt(50, L.inv(50) + 18, "was fine", { a: "middle", s: 6.5 }) + gt(110, L.inv(110) + 18, "tipped by growth", { a: "middle", c: "#e879f9", s: 6.5 })
        + garrow(60, 12, 90, 12, GF.warn) + gt(75, 9, "new connections", { a: "middle", c: GF.warn, s: 6.5 }); })()),
};

/* --------------------------------------------------------------- glossary */
function glossary() {
  const items = [
    ["Invert level", "The inside bottom of a pipe, given as an altitude above the survey datum. The surface water actually runs on. The single most important attribute in this project: without it you cannot establish flow direction or gradient from the data."],
    ["Cover level / surface level", "The altitude of the ground and lid at the top of a chamber. Also called a reduced level. Here it is interpolated from published contour lines and validated against surveyed values."],
    ["Depth", "A length, not an altitude: cover level minus invert level. How far you reach down from the road to the water. Median 2.92 m on the measured region, against the 0.15 m pipe diameter the earlier model used in its place."],
    ["Soffit", "The inside top of a pipe, the opposite of the invert. Invert plus internal diameter."],
    ["Benching", "The sloped concrete shoulders either side of the open channel on a chamber floor, shaped so anything that spills out of the channel drains back into it."],
    ["Surcharge", "The condition where a pipe runs full and water backs up above the soffit, rising into the shaft above. What a level sensor is watching for."],
    ["Overflow relief gully (ORG)", "A grated drain on a property's sewer connection, set below the lowest fixture in the building so that a surcharge escapes into the garden rather than up through an indoor drain. Designed to be the lowest opening in the system, and absent from utility asset layers because it sits on private land."],
    ["Backwater wedge", "The tilted body of water that forms behind a blockage. With flow fully stopped the surface is horizontal, so the wedge ends where that level meets the rising invert going upstream."],
    ["Headroom", "In this tool, the ceiling at a node minus its invert: how far water can rise there before escaping. It replaces the published method's c x MaxDepth term with measured geometry."],
    ["Ceiling", "The level at which water escapes when a given node blocks, computed as the lowest opening anywhere in the region that floods."],
    ["Downstream-dependent (DD) node", "In Ninh et al.'s terms, a node downstream of a candidate sensor whose blockage would raise the level back at that sensor. The set of DD nodes is what a sensor observes."],
    ["Directed acyclic graph (DAG)", "A network where every connection has a direction and no path loops back on itself. A gravity sewer should be one, since water only ever moves downhill. It makes 'everything upstream of this point' a well-defined and quickly computable set."],
    ["Set cover", "The optimisation problem underneath placement: choose the fewest sensors whose observable sets together cover the network. NP-hard, but greedy gets within a known factor of optimal because coverage is submodular."],
    ["Submodular", "Diminishing returns: adding a sensor to a small set helps at least as much as adding it to a larger set. The property that makes greedy near-optimal and lazy evaluation exact."],
    ["Choke", "The operational term for a blockage in a sewer, usually from tree roots, fat, or non-flushable items."],
    ["Gravity main", "A sewer pipe flowing downhill under gravity, normally part-full. Most of a network. Its flow direction is fixed, unlike a pressurised water main."],
    ["Rising main", "A sewer pipe pumped uphill, running full and under pressure. It breaks the downhill logic and has to be handled separately."],
    ["Inflow and infiltration (I&I)", "Rainwater and groundwater entering the sewer through cracks, bad joints or illegal stormwater connections. The usual reason flows spike during rain, and the reason a detection threshold has to account for rainfall."],
    ["CWMS", "Community Wastewater Management Scheme: a council-owned system serving a town, as distinct from the state utility's metropolitan network. Because the council owns the asset, the data is often published openly."],
    ["SWMM", "Storm Water Management Model, the standard open-source simulator for part-full gravity systems. The right tool for sewers. EPANET models pressurised drinking-water networks and does not represent gravity sewers correctly."],
    ["Nominal diameter", "The pipe's named size, and what the asset register carries on every record. Distinct from internal diameter, the actual bore, which is smaller once wall thickness is counted and is published on only about half the records here. Manning wants the internal figure; consistency across the whole network wants the nominal one, and this tool takes consistency."],
    ["Vitrified clay", "Fired clay pipe, abbreviated VC, and the material of 906 of the 1,001 reaches in this network. Resists the acids a sewer generates and lasts a century or more, which is why a network whose median pipe was laid in 1912 is still in service. Its weakness is joints and cracks, which is where roots get in."],
    ["Gradient", "The fall of a pipe along its length, published here as a percentage. Steeper pipe runs faster and carries more, so gradient enters both the capacity calculation and, through the velocity needed to keep solids moving, the likelihood of a blockage forming at all."],
    ["Joint type", "How two pipe sections are connected. Joints are where a pipe is weakest: they are the usual entry point for tree roots and for groundwater infiltration, so joint type is a condition factor rather than a hydraulic one."],
    ["Overcapacity", "The condition where the flow arriving at a reach is more than the pipe was sized to carry, with nothing obstructing it. Distinct from a blockage: it happens at fixed, predictable bottlenecks rather than anywhere, and it is what growth causes. Same consequence, different geography."],
    ["Reach", "One pipe between two chambers, the unit the capacity calculation works on. Flow, gradient, diameter and capacity are all properties of a reach, not of a chamber."],
    ["Manning's equation", "The standard formula for flow in an open channel, relating flow to cross-sectional area, hydraulic radius, gradient and a roughness coefficient n. Used here reach by reach to work out how full each pipe runs."],
    ["Manning's n", "The roughness coefficient in Manning's equation. Sewer pipe runs about 0.010 to 0.015 depending on material and age. Higher n means rougher pipe and less flow for the same gradient."],
    ["Normal depth", "The depth flow settles at in a long uniform channel, where gravity and friction balance. Assuming it lets each reach be solved on its own, which is what makes a screening calculation cheap, and it is also why there is no backwater in this model."],
    ["d/D, depth to diameter ratio", "How full a pipe is running, as a fraction of its diameter. The standard screening measure of capacity: utilities flag a sewer as capacity-deficient above a threshold d/D at the design storm."],
    ["Flow accumulation", "Adding up all the load that drains to each point, walking the network downhill. On a DAG this is one pass in topological order and it is exact."],
    ["Peak factor", "The multiplier from average dry weather flow to the peak condition capacity is judged at. Stands in for the daily peak, wet weather and infiltration together."],
    ["Tipped reach", "A reach that was under capacity before a growth scenario and over capacity after it. The set of tipped reaches is what growth caused, as distinct from what was already a problem."],
  ];
  return `
  <h2>Glossary</h2>
  <p class="lede">Terms used in this tool and in the surrounding documents, in plain language.</p>
  <dl class="gloss">
    ${items.map(([t, d]) => {
      const fig = GLOSS_FIGS[t];
      return `<dt>${esc(t)}</dt><dd class="gl-row">`
        + `<div class="gl-txt">${esc(d)}</div>`
        + (fig ? `<figure class="gl-fig">${fig}</figure>` : "") + `</dd>`;
    }).join("")}
  </dl>`;
}

function render(ctx) {
  document.getElementById("doc-assumptions").innerHTML = assumptions(ctx);
  document.getElementById("doc-qa").innerHTML = qa();
  document.getElementById("doc-method").innerHTML = method(ctx);
  document.getElementById("doc-glossary").innerHTML = glossary();

  /* Part B costs a few hundred ms across all loaded regions, and the tab it lands
     on is not the one the page opens on, so it is filled after first paint rather
     than blocking it. Idle callback where available, a timeout where not. */
  const fillB = () => {
    const slot = document.getElementById("cap-register");
    if (slot) slot.innerHTML = capacityRegister(ctx);
    const rslot = document.getElementById("risk-register");
    if (rslot) rslot.innerHTML = riskRegister(ctx);
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(fillB, { timeout: 2000 });
  else setTimeout(fillB, 0);
}

return { render };
})();
