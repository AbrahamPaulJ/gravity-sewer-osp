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
  // k and obj drive the sensor set: k sensors chosen once across all 12 cases, for the best
  // worst case or the best average. showHeat colours the manholes by their own coverage.
  const st = { site: 0, showSensors: false, showHeat: false, k: 3, obj: "worst", ii: 1, add: 3, rule: 2,
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

  /* The sensor set: the first k of the order chosen across ALL twelve cases for the current
     rule and objective. The order is nested, so sensor k+1 is always added to the first k. */
  const placement = () => runs().sensors[ruleId()][st.obj];
  const sensorSet = () => placement().order.slice(0, st.k).map(i => nameOf(i));
  function shownSensors() { return st.showSensors ? sensorSet() : []; }

  /* name -> the manhole's coverage on its own, for the heatmap, or null when it is off. */
  /* Coloured 0% to the highest value present, not 0 to 100%: in the worst case most manholes
     see under a tenth on their own, and a fixed scale left the whole map one dark blue. The
     legend states the top of the scale, so the stretch is never hidden. */
  const heatMax = () => Math.max(1e-9, ...runs().heat[ruleId()][st.obj]);
  function heatValues() {
    if (!st.showHeat) return null;
    const v = runs().heat[ruleId()][st.obj], top = heatMax(), out = {};
    v.forEach((x, i) => { out[nameOf(i)] = x / top; });
    return out;
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
    const sensors = shownSensors();
    Growth3D.paint(named, nameOf(st.site), sensors, heatValues());
    renderHomes(sensors);
    $("#site").value = String(st.site);
    renderPanel(c, row);
    renderSensors();
    $("#heatKey").hidden = !st.showHeat;
    $("#heatTop").textContent = Math.round(100 * heatMax()) + "%";
    $("#heatWhich").textContent = (st.obj === "worst" ? "worst of the 12 cases" : "average of the 12 cases") +
      ", " + runs().rules[st.rule].label.toLowerCase();
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
      put("Homes and the " + sensors.length + " sensor" + (sensors.length === 1 ? "" : "s"),
        row("#3fb950", "<strong>" + r.watched + "</strong> of " + r.total +
            " drain past a sensor (" + pct + "%)"),
        row("", "<strong>" + r.unwatched + "</strong> do not"),
        row("", "&nbsp;"),
        "Green sleeves: pipes feeding a sensor");
      return;
    }
    // Heatmap on: the hint line carries the hovered (or selected) manhole's own score.
    const heatHint = () => {
      const nm = st.hover || nameOf(st.site), R = runs(), i = R.chambers.indexOf(nm);
      if (i < 0) return "Not a study manhole";
      const h = R.heat[ruleId()];
      return "On its own it sees " + Math.round(100 * h.mean[i]) + "% on average, " +
        Math.round(100 * h.worst[i]) + "% in the worst case";
    };
    put(lead,
      // The panel's "connected here" counts only the manhole's own pipe. The rest come in
      // through pipe ends with no manhole on record; saying so stops the numbers disagreeing.
      row("#1f4fff", "<strong>" + r.here + "</strong> reach it first" +
        (r.here > r.direct ? " (" + (r.here - r.direct) + " via unrecorded pipe ends)" : ""),
        true),
      row("#7dc4e0", "<strong>" + r.through + "</strong> drain through it from further up"),
      row("#3a2430", "<strong>" + r.elsewhere + "</strong> elsewhere"),
      st.showHeat ? heatHint()
        : st.hover ? "Previewing. Click to move the growth here."
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
  const OBJ_NOTE = {
    worst: "Each sensor added is the one that most raises the worst of the 12 cases: " +
           "whatever the unknowns turn out to be, at least this much is caught.",
    mean: "Each sensor added is the one that most raises the average over the 12 cases. " +
          "Catches more on average, but can leave one case poorly covered.",
  };
  const pct = x => Math.round(x * 100) + "%";

  function renderSensors() {
    const pl = placement(), k = st.k;
    $("#kRange").value = String(k);
    $("#kVal").textContent = String(k);
    document.querySelectorAll("#objKnob button").forEach(b =>
      b.classList.toggle("on", b.dataset.o === st.obj));
    $("#objNote").textContent = OBJ_NOTE[st.obj];
    renderCurve(pl, k);
    const alarmNote = ruleId() === "alarm"
      ? "<p class=quiet>Under the alarm rule the worst case is the dry one, where only one " +
        "growth scenario passes the alarm at all, at one manhole. Until that manhole is " +
        "chosen, the worst case stays at 0%.</p>" : "";
    $("#sensorList").innerHTML =
      "<p><b>" + k + "</b> sensor" + (k === 1 ? "" : "s") + " catch <b>" + pct(pl.worst[k - 1]) +
      "</b> of detectable growth in the worst case and <b>" + pct(pl.mean[k - 1]) +
      "</b> on average (all five growth sizes, " + esc(runs().rules[st.rule].label.toLowerCase()) +
      ").</p><ol>" + pl.order.slice(0, k).map((m, j) =>
        "<li><b>" + esc(label(m)) + "</b> <span class=quiet>worst " + pct(pl.worst[j]) +
        ", average " + pct(pl.mean[j]) + "</span></li>").join("") + "</ol>" + alarmNote +
      "<p class=quiet>Chosen one at a time, so the set for " + (k + 1) + " is this set plus " +
      "one. Detectable growth: growth scenarios that at least one manhole sees.</p>";
  }

  /* Worst case and average against the number of sensors. One axis (percent), two series,
     legend plus direct labels at the right end, the current count marked, hover per count. */
  function renderCurve(pl, k) {
    const W = 290, H = 132, L = 30, Rr = 50, T = 8, B = 22, n = pl.worst.length;
    const x = i => L + (W - L - Rr) * i / (n - 1), y = v => T + (H - T - B) * (1 - v);
    const line = arr => arr.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
    const grid = [0, 0.5, 1].map(v => '<line x1="' + L + '" x2="' + (W - Rr) + '" y1="' + y(v) +
      '" y2="' + y(v) + '" stroke="#22314d" stroke-width="1"/><text x="' + (L - 5) + '" y="' +
      (y(v) + 3.5) + '" text-anchor="end" font-size="10" fill="#6f81a3">' + (v * 100) + "%</text>").join("");
    const ticks = pl.worst.map((_, i) => '<text x="' + x(i) + '" y="' + (H - 6) +
      '" text-anchor="middle" font-size="10" fill="' + (i === k - 1 ? "#e7edf7" : "#6f81a3") + '">' +
      (i + 1) + "</text>").join("");
    const dots = (arr, col) => arr.map((v, i) => '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="' +
      (i === k - 1 ? 5 : 3) + '" fill="' + col + '" stroke="#16233a" stroke-width="2"/>').join("");
    const hits = pl.worst.map((_, i) => '<rect class="hit" data-i="' + i + '" x="' + (x(i) - 12) +
      '" y="' + T + '" width="24" height="' + (H - T - B + 16) + '" fill="transparent"/>').join("");
    // Worst and average meet at the top, so their end labels are pushed apart if they collide.
    let ew = y(pl.worst[n - 1]), em = y(pl.mean[n - 1]);
    if (Math.abs(ew - em) < 11) { if (ew >= em) ew = em + 11; else em = ew + 11; }
    $("#curve").innerHTML =
      '<div class="lg"><span><i style="background:var(--worst)"></i>Worst case</span>' +
      '<span><i style="background:var(--mean)"></i>Average</span></div>' +
      '<svg viewBox="0 0 ' + W + " " + (H + 10) + '" role="img" aria-label="Share of detectable growth ' +
      'caught against number of sensors">' + grid +
      '<line x1="' + x(k - 1) + '" x2="' + x(k - 1) + '" y1="' + T + '" y2="' + (H - B) +
      '" stroke="#a9b8d4" stroke-width="1" stroke-dasharray="3 3"/>' +
      '<path d="' + line(pl.mean) + '" fill="none" stroke="var(--mean)" stroke-width="2"/>' +
      '<path d="' + line(pl.worst) + '" fill="none" stroke="var(--worst)" stroke-width="2"/>' +
      dots(pl.mean, "var(--mean)") + dots(pl.worst, "var(--worst)") +
      '<text x="' + (x(n - 1) + 8) + '" y="' + (ew + 3.5) + '" font-size="10.5" fill="#a9b8d4">worst</text>' +
      '<text x="' + (x(n - 1) + 8) + '" y="' + (em + 3.5) + '" font-size="10.5" fill="#a9b8d4">average</text>' +
      ticks + '<text x="' + ((L + W - Rr) / 2) + '" y="' + (H + 7) + '" text-anchor="middle" ' +
      'font-size="10" fill="#6f81a3">sensors</text>' + hits + "</svg>" +
      '<div id="curveTip" hidden></div>';
    const tip = $("#curveTip"), svg = $("#curve svg");
    svg.querySelectorAll(".hit").forEach(r => {
      const i = +r.dataset.i;
      r.style.cursor = "pointer";
      r.onmouseenter = () => {
        const bx = svg.getBoundingClientRect(), cx = $("#curve").getBoundingClientRect();
        tip.innerHTML = "<b>" + (i + 1) + " sensor" + (i ? "s" : "") + "</b>: worst " +
          pct(pl.worst[i]) + ", average " + pct(pl.mean[i]);
        tip.style.left = (bx.left - cx.left + x(i) * bx.width / W) + "px";
        tip.style.top = (bx.top - cx.top + y(pl.worst[i]) * bx.height / (H + 10)) + "px";
        tip.hidden = false;
      };
      r.onmouseleave = () => { tip.hidden = true; };
      r.onclick = () => { st.k = i + 1; repaint(); };
    });
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
      renderHomes(shownSensors());
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
      $("#toggleSensors").classList.toggle("primary", st.showSensors);
      $("#toggleSensors").textContent = st.showSensors ? "Hide sensors" : "Show sensors";
      repaint();
    };
    $("#toggleHeat").onclick = () => {
      st.showHeat = !st.showHeat;
      $("#toggleHeat").classList.toggle("primary", st.showHeat);
      $("#toggleHeat").textContent = st.showHeat ? "Hide heatmap" : "Heatmap";
      repaint();
    };
    // Moving the slider or the objective shows the sensors: that is what it is asking to see.
    const showThem = () => {
      if (st.showSensors) return;
      st.showSensors = true;
      $("#toggleSensors").classList.add("primary");
      $("#toggleSensors").textContent = "Hide sensors";
    };
    $("#kRange").oninput = () => { st.k = +$("#kRange").value; showThem(); repaint(); };
    $("#objKnob").onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      st.obj = b.dataset.o; showThem(); repaint();
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
