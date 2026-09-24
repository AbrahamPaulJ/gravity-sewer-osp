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
  // ii = case index; add = growth size index; rule = detection rule index (25 mm rise).
  const st = { site: 0, showSensors: false, showRobust: false, ii: 1, add: 3, rule: 2,
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
    const add = R.growthLevels[st.add], rule = R.rules[st.rule].id;
    return R.cells.find(c => c.case === st.ii && c.add === add && c.rule === rule)
      || R.cells[0];
  }

  const ruleId = () => runs().rules[st.rule].id;
  const graded = () => ruleId() !== "alarm";
  const caseLabel = () => runs().cases[st.ii].label;

  /* The one pair chosen across ALL twelve cases for the current rise rule (Sim 2.5's main
     result). None exists for the alarm rule: there the choice moves with every case. */
  function robustSensors() {
    const rb = runs().robust[ruleId()];
    return rb && rb.holds ? rb.pair.map(i => nameOf(i)) : [];
  }

  function shownSensors(c) {
    if (st.showRobust) return robustSensors();
    return st.showSensors ? c.coverage.chosen.map(x => nameOf(+x.chamber)) : [];
  }

  function rowFor(c, siteIdx) {
    return c.rows.find(r => r.site === siteIdx) || null;
  }

  /* chamber index -> "tip" | "was" | "ok" */
  function stateFor(c, row) {
    const out = {};
    c.base.forEach(i => { out[i] = "was"; });
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
    const sensors = shownSensors(c);
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
    } else if ((st.showSensors || st.showRobust) && sensors.length) {
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
    // Busiest first, by the same count as the panel: homes reaching the manhole first,
    // including those entering at an unrecorded pipe end above it.
    const homes = i => { const r = Growth3D.reach(nameOf(i)); return r ? r.here : (R.dwellingsAt[i] || 0); };
    const n = R.chambers.map((_, i) => homes(i));
    const order = R.chambers.map((_, i) => i).sort((a, b) => n[b] - n[a]);
    sel.innerHTML = order.map(i =>
      "<option value=" + JSON.stringify(String(i)) + ">" + esc(label(i)) +
      "  (" + n[i] + " homes)</option>").join("");
    sel.onchange = () => select(+sel.value);
    return order;
  }

  /* ------------------------------------------------------------------ knobs */
  /* Two controls, both reading straight out of the precomputed grid. Segmented buttons
     rather than sliders on purpose: every position is a real SWMM run and there is nothing
     in between them, so a continuous control would be inviting interpolation. */
  function buildKnobs() {
    const R = runs();
    $("#iiKnob").innerHTML = R.cases.map((l, i) =>
      "<button data-i=" + JSON.stringify(String(i)) + " title=" + JSON.stringify(l.note) + ">" +
      esc(l.label) + '<span class="knobNum">' + l.ii.toFixed(2) + " L/s/100m</span></button>").join("");
    $("#ruleKnob").innerHTML = R.rules.map((l, i) =>
      "<button data-i=" + JSON.stringify(String(i)) + " title=" + JSON.stringify(l.note) + ">" +
      esc(l.label) + "</button>").join("");
    $("#ruleKnob").onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      st.rule = +b.dataset.i; repaint();
    };
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
    document.querySelectorAll("#ruleKnob button").forEach(b =>
      b.classList.toggle("on", +b.dataset.i === st.rule));
    $("#iiNote").textContent = R.cases[st.ii].note;
    $("#ruleNote").textContent = R.rules[st.rule].note;
  }

  function renderPanel(c, row) {
    const R = runs();
    const add = R.growthLevels[st.add];
    const tipped = row ? row.tip : [];
    const cs = R.cases[st.ii];

    $("#siteFacts").innerHTML =
      reachRow() +
      row2("Adding", "<b>+" + add + "</b> dwellings") +
      row2("Manholes that see it", tipped.length
        ? '<b class="bad">' + tipped.length + "</b>"
        : "none at this size") +
      row2("Solved on", cs.method === "nested" ? "study catchment, levels handed down"
                                              : "whole council network");

    $("#tipList").innerHTML = "<h4>Manholes that see this growth</h4>" + (tipped.length
      ? "<ul>" + tipped.map(i => "<li>" + esc(label(i)) + "</li>").join("") + "</ul>"
      : "<p class=quiet>No manhole passes the rule at +" + add + " dwellings in this case. " +
        "Try more growth, a wetter case, or a smaller rise.</p>");

    $("#baseNote").innerHTML = graded()
      ? "Graded rule: every manhole is judged against its own level before the growth, so " +
        "nothing counts as already triggered."
      : (c.base.length
        ? "<b>" + c.base.length + "</b> of " + R.chambers.length + " manholes are already " +
          "over the alarm in this case <b>before any houses are added</b>. They are amber and " +
          "cannot report the growth."
        : "No manhole is over the alarm before growth in this case.");
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
    const rb = R.robust[ruleId()];
    const pct = x => Math.round(x * 100) + "%";
    // A consensus pair exists for every rise rule, but at 50 mm its worst case keeps 0%:
    // offering it as "robust" would be the opposite of the finding.
    const robustHtml = rb && !rb.holds
      ? "<h4>Robust pair</h4><p class=quiet>None at this rise. The best pair chosen across " +
        "all 12 cases keeps only <b>" + pct(rb.keptMin) + "</b> of a case's own best " +
        "coverage in the worst case (mean " + pct(rb.keptMean) + "): at this rise, some cases " +
        "have too few growth sites that reach it. Try 10 or 25 mm.</p>"
      : rb
      ? "<h4>Robust pair, all 12 cases</h4><p><b>" + rb.pair.map(i => esc(label(i))).join(" + ") +
        "</b>, chosen once across every case, keeps <b>" + Math.round(rb.keptMin * 100) +
        "% to " + Math.round(rb.keptMax * 100) + "%</b> (mean " + Math.round(rb.keptMean * 100) +
        "%) of the coverage each case's own best pair gets.</p>"
      : "<h4>Robust pair</h4><p class=quiet>None under the alarm rule: the best manhole " +
        "changes from case to case, because it is whichever one sits just under the alarm " +
        "before any growth. Switch to a rise rule.</p>";
    $("#toggleRobust").disabled = !(rb && rb.holds);
    if (!cov.chosen.length) {
      $("#sensorList").innerHTML = robustHtml +
        "<p class=quiet>In this case, at +" + R.growthLevels[st.add] + " dwellings, no " +
        "manhole passes the rule. There is nothing for a sensor to catch here.</p>";
      return;
    }
    $("#sensorList").innerHTML = robustHtml + "<h4>Best for this case only</h4>" +
      "<p>Fewest manholes that would see <b>every</b> one of the " + scen + " growth sites " +
      "that trigger the rule, in this case and at this development size. Greedy set " +
      "cover.</p>" +
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
      "The study catchment is the " + g.nPipes + " pipes and " + g.nChambers + " manholes " +
      "draining to one chamber, drawn here. Around it, every council pipe draining to the " +
      "end of the council data is solved together in EPA SWMM as a steady state, so the " +
      "trunk below can back water up into the catchment. Pipes from outside the council " +
      "area are not modelled; where they join, a constant inflow sized from their published " +
      "length stands in for them. Two pump stations pass their flow on as ideal pumps. " +
      "Sewage comes from connected properties counted from the published record; " +
      "infiltration is in proportion to pipe length.</p>" +
      "<p><strong>The register below</strong> is every assumption and constant the model " +
      "rests on, with its value, how firm it is and its source. Twelve cases vary the ones " +
      "no data pins yet.</p></div>" +
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
    $("#tab-qa").textContent = qa ? "Back to the map" : "Findings";
    if (ref) renderRef();
    else if (qa) renderQA();
    else Growth3D.resize($("#stage"));
  }

  /* --------------------------------------------------------------- findings tab */
  /* The results write-up, from the built payload (docs/17), rendered as markdown. */
  function renderQA() {
    if ($("#qa").dataset.done) return;
    $("#qa").innerHTML = markdown(GROWTH_INDEX.docs.findings);
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
      (sc.qa.length ? "<h3>Questions asked about this model</h3>" : "") +
      sc.qa.map(q =>
        '<details class="qa"><summary>' + esc(q.short) + "</summary>" +
        '<div class="body"><p><strong>' + esc(q.q) + "</strong></p>" +
        q.a.map(x => "<p>" + esc(x) + "</p>").join("") +
        '<div class="ev">' + esc(q.evidence) + "</div></div></details>").join("") +
      (sc.assumptions.length ? "<h3>What it assumes</h3><p>Lifted from the project's " +
        "assumptions register.</p>" : "<h3>What it assumes</h3><p>Every assumption is in " +
        "the Assumptions tab.</p>") +
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
      renderHomes(shownSensors(cell()));
    }).then(() => {
      buildKnobs();
      const order = buildList();
      $("#scale").textContent = geom().nPipes + " pipes, " + geom().nChambers +
        " manholes, " + (geom().nHouses || geom().baseDwellings) + " connected properties" +
        ", plus " + geom().nodes.filter(n => n.kind !== "chamber").length +
        " pipe ends with no manhole on record. Elevation is the pipe invert, exaggerated x" +
        Growth3D.ZEXAG + ". Click a manhole to move the growth there.";
      // Open on the busiest manhole whose growth something sees under the default knobs,
      // rather than one that reads "none at this size" before anyone has touched anything.
      const seen = new Set(cell().rows.filter(r => r.tip.length).map(r => r.site));
      select(order.find(i => seen.has(i)) ?? order[0]);
    });
    $("#btn-info").onclick = showModal;
    $("#tab-ref").onclick = () => setTab($("#pane-ref").hidden ? "ref" : "map");
    $("#refClose").onclick = () => setTab("map");
    $("#tab-qa").onclick = () => setTab($("#pane-qa").hidden ? "qa" : "map");
    $("#qaClose").onclick = () => setTab("map");
    $("#toggleRobust").onclick = () => {
      st.showRobust = !st.showRobust;
      if (st.showRobust && st.showSensors) {       // one set of sensors on the map at a time
        st.showSensors = false;
        $("#toggleSensors").classList.remove("primary");
        $("#toggleSensors").textContent = "Show proposed sensors";
      }
      $("#toggleRobust").classList.toggle("primary", st.showRobust);
      $("#toggleRobust").textContent = st.showRobust ? "Hide robust pair" : "Show robust pair";
      repaint();
    };
    $("#modal").onclick = e => { if (e.target.id === "modal") $("#modal").hidden = true; };
    $("#fitAll").onclick = () => Growth3D.frame(null);
    // Off by default: the page is about the 71 study manholes, and the whole network makes
    // them a fifth of the view. On demand it shows what "whole council network" means.
    $("#toggleRegion").onclick = () => {
      st.showRegion = !st.showRegion;
      if (!Growth3D.showRegion(st.showRegion)) { st.showRegion = false; return; }
      $("#toggleRegion").classList.toggle("primary", st.showRegion);
      $("#toggleRegion").textContent = st.showRegion ? "Study area only" : "Whole Walkerville";
      $("#regionKey").hidden = !st.showRegion;
    };
    $("#fitSite").onclick = () => Growth3D.frame(nameOf(st.site));
    $("#toggleSensors").onclick = () => {
      st.showSensors = !st.showSensors;
      if (st.showSensors && st.showRobust) {
        st.showRobust = false;
        $("#toggleRobust").classList.remove("primary");
        $("#toggleRobust").textContent = "Show robust pair";
      }
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
