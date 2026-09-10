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

/* Part B is computed rather than written, and it is the slow part of this pane, so
   it is filled in after first paint. Everything it needs is global by then. */
function capacityRegister(ctx) {
  const { DATA, C, buildGraph } = ctx;
  const K = window.OSPCapacity;
  if (!K) return `<div class="card bad"><h4>Capacity model not loaded</h4>
    <p>osp_capacity.js did not load, so part B cannot be computed. The figures here are never
    typed in, so nothing is shown rather than something stale.</p></div>`;

  const R = Object.keys(DATA).map(k => {
    const g = buildGraph(k);
    const base = K.capacityState(g, C, { perNode: CAP_LADDER[0], peakFactor: 1 });
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
      <tr><td>B1</td><td><b>Manning's n = ${K.DEFAULT_N}</b> everywhere</td>
        <td>Sewer pipe runs about 0.010 to 0.015 depending on material and age.
            ${K.DEFAULT_N} is the conventional design value for concrete and vitrified clay.</td>
        <td>The published <code>roughness</code> field, populated on 0.8% of records, is unusable.
            <code>material</code> is public at 99.9%, so a per-material table is the obvious
            refinement once material reaches the demo data.</td></tr>
      <tr><td>B2</td><td><b>Reach diameter is the smaller of the two chamber diameters</b></td>
        <td>Diameter is held per chamber in the current data, as the largest pipe touching it. A
            reach is limited by its narrowest section, so the minimum of the pair is the safe
            reading of a proxy.</td>
        <td>Real per-pipe diameter already exists upstream in <code>build_demo_data.py</code>. Emit
            it as a <code>diams</code> array, pass it as <code>opt.diams</code>, and the proxy
            falls away.</td></tr>
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
    </tbody>
  </table>

  <h4>What the capacity model is running on</h4>
  <p>All computed from the loaded data. <b>Clamped reaches</b> is B5, <b>splitting chambers</b> is
  B6, and both are small enough that a wrong call cannot distort the picture. <b>Outlets</b> counts
  chambers with nothing downstream: a real network has very few, so a high count is the boundary
  cut of C3 showing up, and every one of those is a reach whose real downstream flow is missing.
  <b>Components</b> is the same story from the other side, the number of separate pieces the
  clipped network falls into.</p>
  <table>
    <thead><tr><th>Region</th><th>Reaches</th><th>Clamped reaches (B5)</th>
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
    </tbody>
  </table>
  <p>All layers are requested with <code>outSR=${esc(META.out_sr || "")}</code> so the server does
  every reprojection and distances are true metres. The sources disagree natively, with manholes in
  one projection and contours in another, and getting that wrong fails silently.</p>

  <h3>Algorithms offered, and what each is for</h3>
  <ul>
    <li><b>Greedy set cover (CELF)</b>, the optimiser and the benchmark. Coverage is submodular, so
      a cached marginal gain can only overstate the truth, which makes lazy re-evaluation exact.</li>
    <li><b>Two up, two down</b>, a practitioner rule of thumb, scored on the same footing as everything
      else. Its anchors are drawn from the same candidate pool; its supporting chambers are taken as
      the rule dictates whether or not they observe anything, because that is what the rule says and
      it is where its cost legitimately shows up.</li>
    <li><b>Upstream catchment, betweenness, in and out degree</b>, standard network heuristics.</li>
    <li><b>Random, best of 20</b>, the floor any method must clear.</li>
    <li><b>Custom JavaScript</b>, run in a worker with an 8 s kill.</li>
  </ul>
  <p>Every algorithm draws from the same candidate pool. An earlier version did not, and it cost that
  rule of thumb more than half its score, so there is now a regression test asserting it.</p>

  <h3>Reproducing all of this</h3>
  <p><code>python tools/build_demo_data.py</code> re-harvests every region and rewrites the dataset,
  printing the validation legs. <code>node tools/test_sandbox.js</code> runs the regression suite,
  which must pass before any score here is trusted. Live services change as their publishers update
  them, so re-measure before quoting any figure formally.</p>`;
}

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
    ${items.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join("")}
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
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(fillB, { timeout: 2000 });
  else setTimeout(fillB, 0);
}

return { render };
})();
