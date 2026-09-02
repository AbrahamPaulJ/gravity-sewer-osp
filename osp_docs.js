/* Documentation panes for the OSP sandbox.
   The assumptions register is rendered from the LOADED dataset, not typed in, so its
   figures cannot drift out of step with the data the tool is actually running on. */
"use strict";

window.OSPDocs = (function () {

const esc = s => String(s).replace(/[&<>"]/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const m = v => (v == null || !isFinite(v)) ? "n/a" : v.toFixed(2) + " m";

/* ------------------------------------------------------------ assumptions */
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
  <p class="lede">Every figure below is read from the dataset currently loaded in this page, so
  it cannot fall out of step with the model. Built ${esc(META.built || "unknown")}.</p>

  <div class="card good">
    <h4>The short version</h4>
    <p>The two substitutions the first version of this tool rested on are gone. Nodes are now real
    maintenance holes from the network operator's own asset register, and chamber depth is measured rather than
    stood in for by pipe diameter. What remains assumed is listed below, each with what it would
    take to remove it.</p>
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

  <h3>The register</h3>
  <table>
    <thead><tr><th>#</th><th>Was</th><th>Is now</th><th>Status</th></tr></thead>
    <tbody>
      <tr><td>1</td><td>Nodes were snapped pipe endpoints</td>
        <td>Real published manhole points, matched within 1.0 m. Sensors can only be placed in
            chambers, because that is the only place one physically fits.</td>
        <td><b style="color:var(--good)">Resolved</b> for Walkerville. No manhole layer exists
            publicly for the other regions.</td></tr>
      <tr><td>2</td><td>Node elevation was the lowest invert at a snapped point</td>
        <td>Invert taken as the chamber floor, with incoming and outgoing inverts checked against
            each other.</td>
        <td><b style="color:var(--good)">Resolved.</b> Violations fell from 462 to
            ${rows[0] ? rows[0].st.invert_violations : "n/a"} once the invert fields were read
            correctly (see Method tab).</td></tr>
      <tr><td>3</td><td>MaxDepth was pipe diameter, 0.15 m</td>
        <td>Depth is cover level minus invert. Median
            ${rows[0] ? m(rows[0].ds.median) : "n/a"} on Walkerville.</td>
        <td><b style="color:var(--good)">Measured</b>, and validated three ways below.</td></tr>
      <tr><td>4</td><td>A single global coefficient c = 0.70</td>
        <td>A per-node ceiling, computed by flood fill over real cover levels.</td>
        <td><b style="color:var(--good)">Removed.</b> c survives only in the comparison mode.</td></tr>
      <tr><td>5</td><td>The escape point was folded into c</td>
        <td>Optional property relief gully proxy: ground at the property inspection point plus
            ${META.org_above_ground_m} m.</td>
        <td><b style="color:var(--warn)">Still assumed.</b> Gully levels are published nowhere.</td></tr>
      <tr><td>6</td><td>No detection threshold at all</td>
        <td>An explicit threshold a rise must exceed before it counts.</td>
        <td><b style="color:var(--warn)">Declared, not calibrated.</b> No South Australian
            wastewater sensor readings are public.</td></tr>
      <tr><td>7</td><td>Flow direction taken from a drafting field</td>
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

  <h3>What is still assumed, stated plainly</h3>
  <div class="card warn">
    <h4>1. Property relief gully levels are not public anywhere</h4>
    <p>The gully is designed to be the lowest opening, so it usually controls where water escapes,
    and it sits on private land. The proxy here puts it at ground level plus
    ${META.org_above_ground_m} m at the property inspection point. It is reasoned from the plumbing
    standard, not measured. Toggle it on and off in the sandbox to see how much it moves the answer.</p>
  </div>
  <div class="card warn">
    <h4>2. The detection threshold cannot be calibrated from public data</h4>
    <p>Setting it properly needs baseline level traces from deployed sensors, and none are published
    for South Australia. It is a slider with a declared default rather than a result. Do et al.
    (2023) show the shape the calibration would take: chokes were identified by how long the level
    stayed irregularly high, not by the peak alone.</p>
  </div>
  <div class="card warn">
    <h4>3. Administrative boundaries cut the catchment</h4>
    <p>Every region here is clipped to a council area or a bounding box, not to a drainage
    catchment. Pipes that continue in reality appear to end, so a mid-network chamber can look like
    the bottom of the system and the downstream consequences of a blockage there cannot be seen.
    Anything near an edge is wrong in a known direction.</p>
  </div>
  <div class="card bad">
    <h4>4. Nothing here has been validated against an actual blockage</h4>
    <p>This is a structural and topological result throughout. No historical choke or overflow
    record was available, so the tool can say which chambers would see a blockage under this model,
    and cannot yet say whether they did. Obtaining incident history is the single highest-value
    thing that would change that.</p>
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
  </ul>`;
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
    <p>That starved-flow signal is most of what the "two down" half of the two up, two down rule of thumb is for. It
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
            detectable signal, and it is half of what the two up, two down rule of thumb buys.</td></tr>
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
  the second is the argument for pairing sensors rather than placing them singly, which is what the two up, two down rule of thumb encodes.</p>

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
    <li><b>Two up, two down</b>, the two up, two down rule of thumb, scored on the same footing as everything
      else. Its anchors are drawn from the same candidate pool; its supporting chambers are taken as
      the rule dictates whether or not they observe anything, because that is what the rule says and
      it is where its cost legitimately shows up.</li>
    <li><b>Upstream catchment, betweenness, in and out degree</b>, standard network heuristics.</li>
    <li><b>Random, best of 20</b>, the floor any method must clear.</li>
    <li><b>Custom JavaScript</b>, run in a worker with an 8 s kill.</li>
  </ul>
  <p>Every algorithm draws from the same candidate pool. An earlier version did not, and it cost the two up, two down rule of thumb more than half its score, so there is now a regression test asserting it.</p>

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
}

return { render };
})();
