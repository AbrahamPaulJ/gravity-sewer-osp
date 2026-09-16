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
  const st = { site: 0, showSensors: false, ii: 1, add: 1 };   // knob indices

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
    $("#site").value = String(st.site);
    renderPanel(c, row);
    renderSensors(c);
    renderKnobs();
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
      "<button data-i=" + JSON.stringify(String(i)) + " title=" + JSON.stringify(l.note) + ">" + esc(l.label) + "</button>").join("");
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
    const dw = R.dwellingsAt[st.site] || 0;
    const cap = R.capacities[st.site];
    const add = R.growthLevels[st.add];
    const tipped = row ? row.tip : [];
    const spilling = row ? row.spill : [];

    $("#siteFacts").innerHTML =
      row2("Connected here now", dw + " properties") +
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
        : "");
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
    const ref = tab === "ref";
    $("#pane-ref").hidden = !ref;
    $("#tab-ref").classList.toggle("primary", ref);
    $("#tab-ref").textContent = ref ? "Back to the map" : "Assumptions";
    if (ref) renderRef(); else Growth3D.resize($("#stage"));
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
      if (nd.name in idxOfName) select(idxOfName[nd.name]);
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
      if (e.key === "Escape") $("#modal").hidden = true;
    });
    window.addEventListener("resize", () => Growth3D.resize($("#stage")));
  }

  return { init };
})();
