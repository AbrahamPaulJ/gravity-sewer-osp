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
  const st = { site: null, showSensors: false };

  const runs = () => window.GROWTH_RUNS;
  const geom = () => window.GROWTH_GEOM;
  const byName = {};

  /* ----------------------------------------------------------------- state */
  /* chamber -> "tip" | "was" | "ok" for the selected scenario. */
  function stateFor(sc) {
    const was = new Set(runs().baseSurcharged);
    const out = {};
    was.forEach(c => { out[c] = "was"; });
    if (sc) {
      sc.surcharged.forEach(c => { if (!was.has(c)) out[c] = "tip"; });
    }
    return out;
  }

  function scenarioFor(name) {
    return runs().scenarios.find(s => s.site === name) || null;
  }

  /* ------------------------------------------------------------------ list */
  function buildList() {
    const sel = $("#site");
    const rows = runs().scenarios.slice().sort((a, b) => {
      // Tightest first: a chamber that can absorb almost nothing is the interesting one.
      const ca = a.capacity == null ? Infinity : a.capacity;
      const cb = b.capacity == null ? Infinity : b.capacity;
      return ca - cb;
    });
    sel.innerHTML = rows.map(r => {
      const cap = r.capacity == null ? "no limit found" : r.capacity + " dwellings";
      return '<option value="' + esc(r.site) + '">' + esc(label(r.site)) +
        "  (" + cap + ")</option>";
    }).join("");
    sel.onchange = () => select(sel.value);
    return rows;
  }

  function label(name) {
    const n = byName[name];
    return n && n.mh ? "MH " + n.mh : name;
  }

  /* --------------------------------------------------------------- select */
  function select(name) {
    st.site = name;
    const sc = scenarioFor(name);
    const s = stateFor(sc);
    const sensors = st.showSensors ? runs().coverage.chosen.map(c => c.chamber) : [];
    Growth3D.paint(s, name, sensors);
    $("#site").value = name;
    renderPanel(sc, s);
  }

  function renderPanel(sc, s) {
    const R = runs();
    const n = byName[st.site] || {};
    const tipped = sc ? sc.tipped : [];
    const was = R.baseSurcharged.length;
    const cap = sc && sc.capacity != null ? sc.capacity : null;

    $("#siteFacts").innerHTML =
      row("Connected here now", (n.dw || 0) + " properties") +
      row("Runs out of room at", cap == null
        ? "more than the range tested"
        : "<b>+" + cap + "</b> new dwellings") +
      row("When it does", tipped.length
        ? "<b class=bad>" + tipped.length + "</b> chambers tip"
        : "nothing new tips");

    $("#tipList").innerHTML = tipped.length
      ? "<h4>First to go, at +" + (cap == null ? "?" : cap) + " dwellings</h4><ul>" +
        tipped.map(c => "<li>" + esc(label(c)) + "</li>").join("") + "</ul>"
      : "<h4>First to go</h4><p class=quiet>This connection point absorbed everything " +
        "tested without tipping anything new.</p>";

    $("#baseNote").innerHTML =
      "<b>" + was + "</b> of " + geom().nChambers + " chambers were already surcharged " +
      "before any houses were added, at the wet weather level this run uses. They are " +
      "amber, and they are <b>not</b> evidence about growth.";
  }

  const row = (k, v) => '<div class="fact"><span>' + esc(k) + "</span><span>" + v + "</span></div>";

  /* ------------------------------------------------------------- sensors */
  function renderSensors() {
    const c = runs().coverage;
    $("#sensorList").innerHTML =
      "<p>The fewest chambers that would see <b>every</b> growth scenario, by greedy set " +
      "cover. Each site is grown to <b>its own</b> limit, not to a flat number: a shared " +
      "step overloads the small sites and collapses every answer onto one bottleneck.</p>" +
      "<ol>" + c.chosen.map(x =>
        "<li><b>" + esc(label(x.chamber)) + "</b> covers " + x.newlyCovered +
        " more scenario" + (x.newlyCovered === 1 ? "" : "s") + "</li>").join("") + "</ol>" +
      "<p class=quiet><b>" + c.chosen.length + "</b> sensors for <b>" + c.scenarios +
      "</b> scenarios." + (c.uncoverable && c.uncoverable.length
        ? " " + c.uncoverable.length + " sites tip nothing at this growth level and are " +
          "excluded rather than counted as covered."
        : "") + "</p>" +
      (c.best_single && c.best_single.length
        ? "<h4>Best single chambers</h4><table>" + c.best_single.slice(0, 8).map(
          ([name, k]) => "<tr><td>" + esc(label(name)) + "</td><td>" + k +
            " scenarios</td></tr>").join("") + "</table>"
        : "");
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
      fact("Infiltration", n.ii + " L/s per 100 m") +
      fact("Growth per scenario", "each site to its own limit") +
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
    Growth3D.build($("#stage"), nd => select(nd.name)).then(() => {
      const rows = buildList();
      renderSensors();
      $("#scale").textContent = geom().nPipes + " pipes, " + geom().nChambers +
        " manholes, " + (geom().nHouses || geom().baseDwellings) + " connected properties" +
        ", plus " + geom().nodes.filter(n => n.kind !== "chamber").length +
        " pipe ends with no manhole on record. Elevation is the pipe invert, exaggerated x" +
        Growth3D.ZEXAG + ". Click a manhole to move the growth there.";
      select(rows[0].site);
    });
    $("#btn-info").onclick = showModal;
    $("#modal").onclick = e => { if (e.target.id === "modal") $("#modal").hidden = true; };
    $("#fitAll").onclick = () => Growth3D.frame(null);
    $("#fitSite").onclick = () => Growth3D.frame(st.site);
    $("#toggleSensors").onclick = () => {
      st.showSensors = !st.showSensors;
      $("#toggleSensors").classList.toggle("primary", st.showSensors);
      $("#toggleSensors").textContent = st.showSensors ? "Hide proposed sensors"
                                                       : "Show proposed sensors";
      select(st.site);
    };
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") $("#modal").hidden = true;
    });
    window.addEventListener("resize", () => Growth3D.resize($("#stage")));
  }

  return { init };
})();
