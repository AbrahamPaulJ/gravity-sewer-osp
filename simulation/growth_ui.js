/* growth_ui.js - pick where the houses go, see what it costs and who would notice.

   The page has one control that matters: which chamber the new dwellings connect at.
   Everything else is a readout of a SWMM run that has already happened.

   THE DISTINCTION THIS INTERFACE EXISTS TO PROTECT. A chamber that was already surcharged
   before any houses were added is not evidence about growth. Only the ones that TIP are.
   The sandbox's capacity module makes the same point in its own header, and it is easy to
   lose the moment you draw everything in one colour, so amber and red never merge here
   and the counts are always reported separately. */
"use strict";
window.GrowthUI = (function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const st = { site: 0, showSensors: false, showBottlenecks: false, ii: 1, add: 1,
               hover: null };                                  // a manhole NAME, or null

  const runs = () => window.GROWTH_RUNS;
  const geom = () => window.GROWTH_GEOM;
  const byName = {};

  /* ----------------------------------------------------------------- state */
  /* One cell of the grid is one (wet weather, growth size) pair. Everything on screen is
     read out of the cell the two knobs select, so a knob costs a lookup and nothing is
     recomputed. Chambers are held as indices throughout, because the payload stores them
     that way and converting once at the edge is cheaper than everywhere. */
  function cell() {
    const R = runs();
    const ii = R.iiLevels[st.ii].ii, add = R.growthLevels[st.add];
    return R.cells.find(c => c.ii === ii && c.add === add) || R.cells[0];
  }

  function rowFor(c, siteIdx) {
    return c.rows.find(r => r.site === siteIdx) || null;
  }

  /* chamber index -> "tip" | "was" | "ok" */
  function stateFor(c, row) {
    const out = {};
    c.baseSurcharged.forEach(i => { out[i] = "was"; });
    if (row) row.tip.forEach(i => { out[i] = "tip"; });
    return out;
  }

  const nameOf = i => runs().chambers[i];
  const mhOf = i => runs().manholeIds[i];

  /* --------------------------------------------------------------- select */
  function select(siteIdx) {
    st.site = siteIdx;
    repaint();
  }

  function repaint() {
    const c = cell(), row = rowFor(c, st.site);
    const byIdx = stateFor(c, row);
    // Growth3D works in chamber NAMES, so translate once, here.
    const named = {};
    for (const k in byIdx) named[nameOf(+k)] = byIdx[k];
    const sensors = st.showSensors
      ? c.coverage.chosen.map(x => nameOf(+x.chamber)) : [];
    Growth3D.paint(named, nameOf(st.site), sensors);
    renderHomes(sensors);
    $("#site").value = String(st.site);
    renderPanel(c, row);
    renderSensors(c);
    renderKnobs();
  }

  /* ---------------------------------------------------------------- homes */
  /* Which homes are behind the manhole in question, lit on the map and counted in the
     legend. Hovering previews another manhole without moving the growth; showing the
     proposed sensors switches to which homes' sewage passes one. Precedence is in that
     order, because a hover is the most deliberate thing a person is doing at that moment. */
  function renderHomes(sensors) {
    const mhName = nm => (byName[nm] && byName[nm].mh ? "MH " + byName[nm].mh : nm);
    // FIXED SHAPE. Every state writes exactly a heading, three rows and one hint, each a
    // single clipped line, into a box of fixed size. Hovering flips between states many
    // times a second, and when the states had different amounts of text the box changed
    // height and everything around it moved.
    const row = (col, text, ring) => '<div class="row">' + (col ? '<span class="k' +
      (ring ? " ring" : "") + '" style="background:' + col + '"></span>' : "") + text + "</div>";
    const put = (head, r1, r2, r3, hint) => {
      $("#homeKey").innerHTML = '<div class="row head">' + head + "</div>" + r1 + r2 + r3 +
        '<div class="row quiet2">' + hint + "</div>";
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
    if (!r) { put("", "", "", "", ""); return; }
    if (r.mode === "sensors") {
      const pct = Math.round(100 * r.watched / r.total);
      put("Homes and the proposed sensors",
        row("#3fb950", "<strong>" + r.watched + "</strong> of " + r.total +
            " drain past a sensor (" + pct + "%)"),
        row("#ff6f9c", "<strong>" + r.unwatched + "</strong> do not"),
        row("", "&nbsp;"),
        "Green sleeves: pipes feeding a sensor");
      return;
    }
    put(lead,
      // The panel's "connected here" counts only the manhole's own pipe. The rest come in
      // through pipe ends with no manhole on record; saying so stops the numbers disagreeing.
      row("#1f4fff", "<strong>" + r.here + "</strong> reach it first" +
        (r.here > r.direct ? " (" + (r.here - r.direct) + " via unrecorded pipe ends)" : ""),
        true),
      row("#7dc4e0", "<strong>" + r.through + "</strong> drain through it from further up"),
      row("#3a2430", "<strong>" + r.elsewhere + "</strong> elsewhere"),
      st.hover ? "Previewing. Click to move the growth here."
               : "Hover any manhole to preview its homes");
  }

  function label(i) {
    const mh = mhOf(i);
    return mh ? "MH " + mh : nameOf(i);
  }

  /* ------------------------------------------------------------------ list */
  function buildList() {
    const R = runs(), sel = $("#site");
    const order = R.chambers.map((_, i) => i).sort((a, b) => {
      // Tightest first: a chamber that can absorb almost nothing is the interesting one.
      const ca = R.capacities[a] == null ? Infinity : R.capacities[a];
      const cb = R.capacities[b] == null ? Infinity : R.capacities[b];
      return ca - cb;
    });
    sel.innerHTML = order.map(i => {
      const cap = R.capacities[i] == null ? "no limit found" : "+" + R.capacities[i];
      return "<option value=" + JSON.stringify(String(i)) + ">" + esc(label(i)) +
        "  (" + cap + ")</option>";
    }).join("");
    sel.onchange = () => select(+sel.value);
    return order;
  }

  /* ------------------------------------------------------------------ knobs */
  /* Two controls, both reading straight out of the precomputed grid. Segmented buttons
     rather than sliders on purpose: every position is a real SWMM run and there is nothing
     in between them, so a continuous control would be inviting interpolation. */
  function buildKnobs() {
    const R = runs();
    $("#iiKnob").innerHTML = R.iiLevels.map((l, i) =>
      "<button data-i=" + JSON.stringify(String(i)) + " title=" + JSON.stringify(l.note) + ">" +
      esc(l.label) + '<span class="knobNum">' + l.ii.toFixed(2) + " L/s/100m</span></button>").join("");
    $("#addKnob").innerHTML = R.growthLevels.map((g, i) =>
      "<button data-i=" + JSON.stringify(String(i)) + ">+" + g + "</button>").join("");
    $("#iiKnob").onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      st.ii = +b.dataset.i; repaint();
    };
    $("#addKnob").onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      st.add = +b.dataset.i; repaint();
    };
  }

  function renderKnobs() {
    const R = runs();
    document.querySelectorAll("#iiKnob button").forEach(b =>
      b.classList.toggle("on", +b.dataset.i === st.ii));
    document.querySelectorAll("#addKnob button").forEach(b =>
      b.classList.toggle("on", +b.dataset.i === st.add));
    $("#iiNote").textContent = R.iiLevels[st.ii].note;
  }

  function renderPanel(c, row) {
    const R = runs();
    const cap = R.capacities[st.site];
    const add = R.growthLevels[st.add];
    const tipped = row ? row.tip : [];
    const spilling = row ? row.spill : [];

    $("#siteFacts").innerHTML =
      reachRow() +
      row2("Adding", "<b>+" + add + "</b> dwellings") +
      row2("Runs out of room at", cap == null ? "beyond what was tested" : "<b>+" + cap + "</b>") +
      row2("Chambers tipped", tipped.length
        ? '<b class="bad">' + tipped.length + "</b>"
        : "none at this size") +
      (spilling.length ? row2("Spilling", '<b class="bad">' + spilling.length + "</b>") : "");

    $("#tipList").innerHTML = tipped.length
      ? "<h4>Tipped by this growth</h4><ul>" +
        tipped.map(i => "<li>" + esc(label(i)) + "</li>").join("") + "</ul>"
      : "<h4>Tipped by this growth</h4><p class=quiet>Nothing new surcharges here at +" +
        add + " dwellings in " + esc(R.iiLevels[st.ii].label.toLowerCase()) +
        " conditions. Try more growth, or a wetter day.</p>";

    $("#baseNote").innerHTML = c.baseSurcharged.length
      ? "<b>" + c.baseSurcharged.length + "</b> of " + R.chambers.length + " chambers are " +
        "already surcharged in " + esc(R.iiLevels[st.ii].label.toLowerCase()) + " conditions " +
        "<b>before any houses are added</b>. They are amber, and they are not evidence " +
        "about growth."
      : "No chamber is surcharged before growth in " +
        esc(R.iiLevels[st.ii].label.toLowerCase()) + " conditions. Everything red is caused " +
        "by the new dwellings.";
  }

  /* Homes whose sewage reaches this manhole first. The model loads a home at the top of
     its pipe, and about half the pipes start at a pipe end with no manhole on record, so
     counting only the homes loaded AT the manhole left those out. */
  function reachRow() {
    const r = Growth3D.reach(nameOf(st.site));
    if (!r) return row2("Homes reaching it first", (runs().dwellingsAt[st.site] || 0) + "");
    const via = r.here - r.direct;
    return row2("Homes reaching it first", "<b>" + r.here + "</b>") + (via
      ? '<div class="fact sub2"><span>' + via + " via unrecorded pipe ends</span><span></span></div>"
      : "");
  }

  const row2 = (k, v) => '<div class="fact"><span>' + esc(k) + "</span><span>" + v +
    "</span></div>";

  /* ------------------------------------------------------------- sensors */
  function renderSensors(c) {
    const R = runs(), cov = c.coverage;
    const scen = c.rows.filter(r => r.tip.length).length;
    if (!cov.chosen.length) {
      $("#sensorList").innerHTML =
        "<p class=quiet>At +" + R.growthLevels[st.add] + " dwellings in " +
        esc(R.iiLevels[st.ii].label.toLowerCase()) + " conditions, no chamber anywhere in " +
        "the catchment tips. There is nothing for a sensor to catch, which is its own " +
        "answer: at this combination the network still has room.</p>";
      return;
    }
    $("#sensorList").innerHTML =
      "<p>Fewest chambers that would see <b>every</b> one of the " + scen + " sites whose " +
      "growth tips something, at this wet weather level and this development size. Greedy " +
      "set cover.</p>" +
      "<ol>" + cov.chosen.map(x =>
        "<li><b>" + esc(label(+x.chamber)) + "</b> covers " + x.newlyCovered +
        " more</li>").join("") + "</ol>" +
      "<p class=quiet><b>" + cov.chosen.length + "</b> sensor" +
      (cov.chosen.length === 1 ? "" : "s") + " for <b>" + scen + "</b> sites." +
      (cov.uncoverable && cov.uncoverable.length
        ? " " + cov.uncoverable.length + " sites tip nothing here and are excluded rather " +
          "than counted as covered." : "") + "</p>" +
      (cov.best_single && cov.best_single.length
        ? "<h4>Best single chambers</h4><table>" + cov.best_single.slice(0, 6).map(
          ([idx, k]) => "<tr><td>" + esc(label(+idx)) + "</td><td>" + k +
            " sites</td></tr>").join("") + "</table>"
        : "") +
      "<p class=quiet>On the map, green homes drain past a proposed sensor. That means " +
      "their flow is in what it measures, not that a problem at their own street would " +
      "show up there.</p>";
  }

  /* ---------------------------------------------------- assumptions tab */
  /* The whole register, not the nine rows the popup curates. The legacy page carried it
     and it was asked for back: a reader who wants to argue with the model needs every row,
     not a selection made on their behalf. */
  function renderRef() {
    if ($("#ref").dataset.done) return;
    const g = geom(), n = GROWTH_INDEX.scenario.numbers;
    $("#ref").innerHTML =
      '<div class="lead"><p><strong>What this model is, in one paragraph.</strong> ' +
      "Every pipe draining to one chamber, " + g.nPipes + " of them over " + g.nChambers +
      " manholes, solved as a steady state in EPA SWMM. Sewage load comes from " +
      g.baseDwellings + " connected properties counted from the published record and " +
      "attributed through their own connection pipes. Infiltration is added in proportion " +
      "to pipe length. A chamber surcharges when water passes the crown of its outlet " +
      "pipe.</p>" +
      "<p><strong>Why this chamber is the outlet.</strong> It is inherited, not selected. " +
      "The earlier four-chamber study picked junction 441 because it was one of only four " +
      "places in this network where two pipes join a third and all four ends are real " +
      "manholes with a recorded lid level. This catchment is everything draining to the " +
      "chamber immediately above that junction. It is the <b>31st largest</b> of 360 " +
      "chambers by catchment size, so it is a defensible pilot area and it is not the " +
      "biggest or the busiest. Widening to a larger catchment is a change of the outlet " +
      "node and nothing else.</p></div>" +
      markdown(GROWTH_INDEX.docs.assumptions);
    $("#ref").dataset.done = "1";
  }

  /* Enough markdown for the register: headings, tables, code, bold, rules, lists. */
  function markdown(md_) {
    const out = []; let inTable = false;
    const inline = t => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>")
                              .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const closeT = () => { if (inTable) { out.push("</tbody></table>"); inTable = false; } };
    for (const raw of String(md_ || "").split("\n")) {
      const line = raw.replace(/\s+$/, "");
      if (/^\|/.test(line)) {
        if (/^[:\-\s|]+$/.test(line)) continue;
        const cells = line.split("|").slice(1, -1).map(c => c.trim());
        if (!inTable) {
          out.push("<table><thead><tr>" +
            cells.map(c => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>");
          inTable = true;
        } else {
          out.push("<tr>" + cells.map(c => "<td>" + inline(c) + "</td>").join("") + "</tr>");
        }
        continue;
      }
      closeT();
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">");
      else if (/^[-*]\s+/.test(line)) out.push("<li>" + inline(line.replace(/^[-*]\s+/, "")) + "</li>");
      else if (/^---+$/.test(line)) out.push("<hr>");
      else if (line) out.push("<p>" + inline(line) + "</p>");
    }
    closeT();
    return out.join("\n");
  }

  function setTab(tab) {
    const ref = tab === "ref", qa = tab === "qa";
    $("#pane-ref").hidden = !ref;
    $("#pane-qa").hidden = !qa;
    $("#tab-ref").classList.toggle("primary", ref);
    $("#tab-ref").textContent = ref ? "Back to the map" : "Assumptions";
    $("#tab-qa").classList.toggle("primary", qa);
    $("#tab-qa").textContent = qa ? "Back to the map" : "Discussion Q&A";
    if (ref) renderRef();
    else if (qa) renderQA();
    else Growth3D.resize($("#stage"));
  }

  /* ------------------------------------------------------------------ Q&A tab */
  /* Not part of the built payload: this is a fixed write-up of questions asked about
     this model while stress-testing it, kept here because it is the same kind of
     content as the popup's Q&A and does not depend on any run's numbers. */
  const DISCUSS_QA = [
    { short: "Why treat one inspection point as one dwelling?", a: [
      "An inspection point is where a service line joins the main, not a dwelling count. "
      + "It could be a single house, an apartment block sharing one connection, or a "
      + "commercial site with a different load profile entirely.",
      "The layer carries a TRADEWASTE field flagging non-residential connections, and this "
      + "model does not use it: every point is charged the same 500 L/day regardless.",
      "Cross-referencing PARCELID against a land-use or dwelling-count layer would test "
      + "this directly. Until then, 643 is a count of connections, not a verified count of "
      + "households." ] },
    { short: "Where do the three infiltration levels come from?", a: [
      "0.25, 0.40 and 0.55 L/s per 100 m are round numbers chosen to bracket a dry, a wet "
      + "and a very wet day. None is calibrated to this catchment.",
      "The treatment plant publishes 91,993 hourly inflow records from 2009. Paired with "
      + "Bureau of Meteorology rainfall for the same hours, a real rate can be worked "
      + "backwards: measured inflow minus calculated sewage.",
      "The catch is the catchment boundary. That only gives Walkerville's own rate if the "
      + "plant serves only this catchment; a regional plant serving many suburbs would "
      + "return a blended figure instead." ] },
    { short: "What is the peak factor, and can it be checked?", a: [
      "The ratio of the busiest hour's flow to the daily average, fixed here at 2.0. It "
      + "describes household usage patterns such as morning showers, not a storm.",
      "The same treatment plant records that would calibrate infiltration would also give "
      + "a real peak factor: the ratio of the highest to the average hourly flow on a dry "
      + "day, when infiltration is close to zero." ] },
    { short: "Peak factor and infiltration cannot both come from one flow record. "
             + "What breaks the tie?", a: [
      "One equation, two unknowns: measured flow = dwellings x peak factor + infiltration. "
      + "Infinitely many pairs of values fit the same measured number equally well.",
      "A dry day anchors the peak factor first, since infiltration is near zero then. Wet "
      + "days can then be solved for infiltration alone, holding the peak factor fixed.",
      "Without that dry-day anchor, both figures stay assumptions, and fitting one to a "
      + "wet event just moves the same uncertainty onto the other." ] },
    { short: "What exactly is being simulated?", a: [
      "The real 157-pipe, 71-chamber catchment above one outlet, solved in EPA SWMM's "
      + "dynamic wave engine, the full equations rather than a simplification.",
      "Every run is steady: a constant load is held for 120 minutes and the last 10 are "
      + "read as the answer. There is no storm hydrograph and no time-of-day curve here.",
      "Two loads enter at each node: sewage proportional to counted dwellings, and "
      + "infiltration proportional to upstream pipe length. A chamber 'surcharges' when "
      + "water rises above the crown of its own outlet pipe." ] },
    { short: "What is one 'scenario', exactly?", a: [
      "One infiltration level, one growth size and one manhole, all fixed together: "
      + "'add N houses here, at this wet-weather level.'",
      "71 chambers x 4 growth sizes x 3 infiltration levels = 852 separate SWMM solves. "
      + "Clicking a manhole picks one of the three; the two knobs pick the other two." ] },
    { short: "How does greedy pick the recommended sensor, and what does 'catching' a "
             + "scenario mean physically?", a: [
      "For one fixed wet-weather level and growth size, each of the 71 sites has a tipped "
      + "set: the chambers that surcharge there but did not in the baseline.",
      "Greedy repeatedly picks whichever chamber appears in the most still-uncovered "
      + "tipped sets, until every coverable scenario has a chosen chamber in its set.",
      "A chamber can only appear in a site's tipped set if it sits downstream of that site, "
      + "since flow only moves one way, and it was already close enough to its own limit "
      + "that the extra flow pushes it over. Downstream is necessary, not sufficient." ] },
    { short: "Does a dwelling's load ever get shared between two manholes?", a: [
      "No. Each property is attributed to exactly one pipe, either by its own connection "
      + "line (about 96% of properties) or, failing that, by nearest main. Nothing is "
      + "counted twice at the point of entry.",
      "But every chamber downstream of that entry point 'sees' its flow in its own "
      + "cumulative total, because the water genuinely passes through on the way to the "
      + "outlet. That is aggregation, not sharing." ] },
    { short: "Can a chamber surcharge because of something downstream of it?", a: [
      "Yes. The dynamic wave solver captures backwater: if a downstream chamber cannot "
      + "discharge fast enough, its level rises, and that can restrict the chamber "
      + "immediately upstream of it too, with no extra load entering there at all.",
      "A tipped set that is a chain of neighbouring chambers, rather than scattered "
      + "locations, is the signature of this: one real bottleneck backing up into "
      + "everything just above it." ] },
    { short: "Why do so many manholes show the same 'runs out of room at' number?", a: [
      "Because the figure describes the nearest downstream bottleneck's own remaining "
      + "capacity, not the manhole clicked. Two manholes upstream of the same bottleneck "
      + "get the same answer, regardless of how many properties are already connected at "
      + "either one.",
      "Walking a real path to the outlet, the number stays flat until it crosses the one "
      + "pipe that was actually limiting it, then jumps to whatever the next tight pipe "
      + "allows. This catchment has only 7 such pipes among all 71 chambers.",
      "'Show bottleneck pipes' on the map draws exactly those 7, identified by full-bore "
      + "Manning capacity (diameter and slope together, not diameter alone), computed at "
      + "the one infiltration level the underlying bisection was run at." ] },
  ];

  function renderQA() {
    if ($("#qa").dataset.done) return;
    $("#qa").innerHTML =
      '<div class="lead"><p>Written up from questions asked while stress-testing this ' +
      "model's assumptions: how the load is built, what the solver actually does, and " +
      "why the numbers behave the way they do. Not part of any SWMM run.</p></div>" +
      DISCUSS_QA.map(q =>
        '<details class="qa"><summary>' + esc(q.short) + "</summary>" +
        '<div class="body">' + q.a.map(x => "<p>" + esc(x) + "</p>").join("") +
        "</div></details>").join("");
    $("#qa").dataset.done = "1";
  }

  /* --------------------------------------------------------------- popup */
  function showModal() {
    const sc = GROWTH_INDEX.scenario, n = sc.numbers;
    const fact = (l, v) => v == null ? "" :
      '<div class="kfact">' + esc(l) + "<b>" + esc(v) + "</b></div>";
    $("#modalBox").innerHTML =
      '<button class="close" id="modalClose">Close</button>' +
      "<h2>" + esc(sc.title) + "</h2>" +
      '<p class="q">' + esc(sc.question) + "</p>" +
      sc.what.map(p => "<p>" + esc(p) + "</p>").join("") +
      "<h3>What to look at</h3><ul>" + sc.read.map(r => "<li>" + esc(r) + "</li>").join("") +
      "</ul>" +
      "<h3>The numbers behind it</h3><div class=kfacts>" +
      fact("Pipes modelled", n.pipes) +
      fact("Chambers", n.chambers) +
      fact("Properties counted", n.dwellings) +
      fact("Peak factor", n.peakFactor) +
      fact("Wet weather settings", n.iiRange ? n.iiRange + " L/s per 100 m" : null) +
      fact("Growth settings", n.stepRange ? n.stepRange + " dwellings" : null) +
      "</div>" +
      "<h3>Questions asked about this model</h3>" +
      sc.qa.map(q =>
        '<details class="qa"><summary>' + esc(q.short) + "</summary>" +
        '<div class="body"><p><strong>' + esc(q.q) + "</strong></p>" +
        q.a.map(x => "<p>" + esc(x) + "</p>").join("") +
        '<div class="ev">' + esc(q.evidence) + "</div></div></details>").join("") +
      "<h3>What it assumes</h3><p>Lifted from the project's assumptions register.</p>" +
      "<table class=ass><tbody>" + sc.assumptions.map(a =>
        '<tr><td class="id">' + esc(a.id) + "</td><td>" + md(a.text) +
        '<br><span class="tag ' + (a.status === "A" ? "assumed" : "") + '">' +
        esc(a.statusWord) + "</span></td></tr>").join("") + "</tbody></table>" +
      '<div class="caveat">' + esc(sc.caveat) + "</div>";
    $("#modal").hidden = false;
    $("#modalClose").onclick = () => { $("#modal").hidden = true; };
  }
  const md = t => esc(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
                        .replace(/`([^`]+)`/g, "<code>$1</code>");

  /* ---------------------------------------------------------------- init */
  function init() {
    geom().nodes.forEach(n => { byName[n.name] = n; });
    const idxOfName = {};
    runs().chambers.forEach((c, i) => { idxOfName[c] = i; });
    Growth3D.build($("#stage"), nd => {
      // A click on the map gives a chamber NAME; everything else here works in indices.
      st.hover = null;
      if (nd.name in idxOfName) select(idxOfName[nd.name]);
    }, nd => {
      // Hovering the manhole that is already selected previews nothing new.
      const name = nd && nd.name !== nameOf(st.site) ? nd.name : null;
      if (name === st.hover) return;
      st.hover = name;
      const c = cell();
      renderHomes(st.showSensors ? c.coverage.chosen.map(x => nameOf(+x.chamber)) : []);
    }).then(() => {
      buildKnobs();
      const order = buildList();
      $("#scale").textContent = geom().nPipes + " pipes, " + geom().nChambers +
        " manholes, " + (geom().nHouses || geom().baseDwellings) + " connected properties" +
        ", plus " + geom().nodes.filter(n => n.kind !== "chamber").length +
        " pipe ends with no manhole on record. Elevation is the pipe invert, exaggerated x" +
        Growth3D.ZEXAG + ". Click a manhole to move the growth there.";
      select(order[0]);
    });
    $("#btn-info").onclick = showModal;
    $("#tab-ref").onclick = () => setTab($("#pane-ref").hidden ? "ref" : "map");
    $("#refClose").onclick = () => setTab("map");
    $("#tab-qa").onclick = () => setTab($("#pane-qa").hidden ? "qa" : "map");
    $("#qaClose").onclick = () => setTab("map");
    $("#toggleBottlenecks").onclick = () => {
      st.showBottlenecks = !st.showBottlenecks;
      $("#toggleBottlenecks").classList.toggle("primary", st.showBottlenecks);
      $("#toggleBottlenecks").textContent = st.showBottlenecks
        ? "Hide bottleneck pipes" : "Show bottleneck pipes";
      Growth3D.showBottlenecks(st.showBottlenecks);
    };
    $("#modal").onclick = e => { if (e.target.id === "modal") $("#modal").hidden = true; };
    $("#fitAll").onclick = () => Growth3D.frame(null);
    $("#fitSite").onclick = () => Growth3D.frame(nameOf(st.site));
    $("#toggleSensors").onclick = () => {
      st.showSensors = !st.showSensors;
      $("#toggleSensors").classList.toggle("primary", st.showSensors);
      $("#toggleSensors").textContent = st.showSensors ? "Hide proposed sensors"
                                                       : "Show proposed sensors";
      repaint();
    };
    document.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      if (!$("#modal").hidden) $("#modal").hidden = true;
      else if (!$("#pane-ref").hidden || !$("#pane-qa").hidden) setTab("map");
    });
    window.addEventListener("resize", () => Growth3D.resize($("#stage")));
  }

  return { init };
})();
