/* sim_ui.js - one scenario, three event sizes.

   WHY THE PHASE BANNER AND THE MARKERS EXIST. The run opens with 60 minutes of steady base
   flow, which is 29% of the frames. Across that stretch depth at A sits at 0.106 m and
   inflow at 11.69 L/s and neither moves, so pressing play looks exactly like a viewer whose
   numbers are broken. That warmup is not padding and must not be cut: each level sensor's
   alarm is defined as a rise above its own SETTLED base level, so the run has to establish
   that level before any alarm means anything. The honest fix is to say what is happening,
   mark where the event and the alarms fall, and offer to skip.

   The panel is a port of view3d.py's readout(). The desktop and the browser disagreeing
   about a depth, with both looking plausible, is the failure worth engineering against. */
"use strict";
window.SimUI = (function () {
  const $ = s => document.querySelector(s);
  const st = { run: null, s: null, size: null, frame: 0, playing: false, prev: null, tab: "sim" };

  /* ------------------------------------------------------------------ helpers */
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const mins = k => SimData.timeAt(st.run, k) / 60;
  const runs = () => window.SIM_RUNS_warning_along.runs;

  /* Event phase, from the scenario shape the run carries (S3 in the register). */
  function phase(t) {
    const sc = st.run.scenario;
    const w = sc.warmup, r = sc.rise || 30, h = sc.hold || 30;
    if (t < w) return { key: "base", name: "Steady base flow",
                        note: "Settling. Nothing changes until " + w + " min, and that is the point: "
                              + "each alarm is a rise above this settled level." };
    if (t < w + r) return { key: "rising", name: "Event rising", note: "Inflow climbing to the peak." };
    if (t < w + r + h) return { key: "rising", name: "Event at peak", note: "Holding at the peak." };
    return { key: "falling", name: "Event falling", note: "Inflow receding." };
  }

  /* ---------------------------------------------------------------- event size */
  function buildSizes() {
    const box = $("#sizes");
    box.innerHTML = "";
    SIM_INDEX.sizes.forEach(sz => {
      const b = document.createElement("button");
      b.textContent = sz.label;
      b.onclick = () => selectSize(sz);
      b.dataset.id = sz.id;
      box.appendChild(b);
    });
  }

  async function selectSize(sz) {
    st.size = sz;
    document.querySelectorAll("#sizes button").forEach(b =>
      b.classList.toggle("active", b.dataset.id === sz.id));
    $("#sizeNote").textContent = sz.detail + ". First spill at " + sz.firstSpillAt +
      ", " + (sz.firstSpill - (runs()[sz.id].scenario.warmup)).toFixed(1) + " min into the event.";
    await openRun(sz.id);
  }

  async function openRun(id) {
    const run = runs()[id];
    st.run = run;
    st.s = SimData.series(run);
    st.prev = null;
    await Sim3D.build($("#stage"), SIM_GEOM.geoms[run.geom], SIM_GEOM.ground);
    $("#time").max = String(run.steps - 1);
    drawMarks();
    buildRows();
    setFrame(0);
    renderLeads();
  }

  /* Ticks on the slider track: event start, every level alarm, the first spill. Without
     these the run is 210 minutes of undifferentiated track and the interesting 15 are
     impossible to find. */
  function drawMarks() {
    const run = st.run, sz = st.size, box = $("#marks");
    const tEnd = SimData.timeAt(run, run.steps - 1) / 60;
    box.innerHTML = "";
    const put = (t, cls, title) => {
      const i = document.createElement("i");
      i.className = cls;
      i.style.left = (100 * t / tEnd) + "%";
      i.title = title;
      box.appendChild(i);
    };
    put(run.scenario.warmup, "evt", "Event starts, " + run.scenario.warmup + " min");
    Object.keys(sz.chambers || {}).forEach(c => {
      const a = sz.chambers[c].level_alarm;
      if (a != null) put(a, "alarm", c + " level alarm, " + a.toFixed(1) + " min");
    });
    if (sz.firstSpill != null) {
      put(sz.firstSpill, "spill", "First spill at " + sz.firstSpillAt + ", " +
        sz.firstSpill.toFixed(1) + " min");
    }
  }

  /* ------------------------------------------------------------ the live panel */
  function buildRows() {
    const g = SIM_GEOM.geoms[st.run.geom];
    $("#rows").innerHTML = g.chambers.map(c =>
      '<tr data-c="' + c + '"><td>' + c + '</td><td class="q"></td>' +
      '<td class="d"></td><td class="p"></td></tr>').join("");
  }

  function setFrame(k) {
    const run = st.run;
    if (!run) return;
    st.frame = Math.max(0, Math.min(k, run.steps - 1));
    $("#time").value = String(st.frame);
    Sim3D.draw(st.frame, run, st.s);
    paint(st.frame);
  }

  function paint(k) {
    const g = SIM_GEOM.geoms[st.run.geom], s = st.s;
    const nodes = {};
    g.nodes.forEach(n => { nodes[n.name] = n; });
    const t = mins(k);
    const ph = phase(t);
    const spilling = g.chambers.some((c, i) => s.flood.at(k, i) > 1e-6);

    const box = $("#phase");
    box.className = spilling ? "spilling" : (ph.key === "rising" ? "rising" : "");
    box.innerHTML = "<b>" + (spilling ? "SPILLING" : esc(ph.name)) + "</b>" +
      "<span>" + esc(spilling ? "Water is leaving a lid." : ph.note) + "</span>" +
      "<span>t = " + t.toFixed(1) + " of " + mins(st.run.steps - 1).toFixed(0) + " min</span>";

    // Highlight a cell only when its PRINTED value changed. Comparing the raw float would
    // light up every cell on every frame from noise far below what the panel shows.
    const prev = st.prev, cur = {};
    g.chambers.forEach((c, i) => {
      const tr = $('#rows tr[data-c="' + c + '"]');
      const d = s.depth.at(k, i), q = s.inflow.at(k, i);
      const pct = 100 * d / nodes[c].max_depth;
      const v = { q: q.toFixed(2), d: d.toFixed(2), p: pct.toFixed(0) };
      cur[c] = v;
      tr.classList.toggle("spill", s.flood.at(k, i) > 1e-6);
      ["q", "d", "p"].forEach(key => {
        const td = tr.querySelector("." + key);
        const txt = key === "p"
          ? v.p + "% <span class=bar style=width:" + Math.max(1, Math.min(52, pct * 0.52)) + "px></span>"
          : v[key];
        td.innerHTML = txt;
        td.classList.toggle("moved", !!prev && prev[c] && prev[c][key] !== v[key]);
      });
    });
    st.prev = cur;
  }

  /* Lead times for the selected event size, straight from the experiment's own analysis. */
  function renderLeads() {
    const sz = st.size, ch = sz.chambers || {};
    const rows = Object.keys(ch).map(c => ({ c: c, lead: ch[c].level_lead }))
      .filter(r => r.lead != null).sort((a, b) => b.lead - a.lead);
    if (!rows.length) { $("#leadNote").textContent = ""; return; }
    $("#leadNote").innerHTML =
      "<b>Warning a level sensor would give, minutes before the first spill:</b><br>" +
      rows.map(r => r.c + " <b>" + r.lead.toFixed(1) + "</b>").join(" &nbsp;/&nbsp; ") +
      "<br>Best is " + rows[0].c + ", worst is " + rows[rows.length - 1].c + ".";
  }

  /* ------------------------------------------------------------------- popup */
  function showModal() {
    const sc = SIM_INDEX.scenario, n = sc.numbers;
    const fact = (label, val) => val == null ? "" :
      '<div class="fact">' + esc(label) + "<b>" + esc(val) + "</b></div>";
    $("#modalBox").innerHTML =
      '<button class="close" id="modalClose">Close</button>' +
      "<h2>" + esc(sc.title) + "</h2>" +
      '<p class="q">' + esc(sc.question) + "</p>" +
      sc.what.map(p => "<p>" + esc(p) + "</p>").join("") +
      "<h3>What to look at</h3><ul>" +
      sc.read.map(r => "<li>" + esc(r) + "</li>").join("") + "</ul>" +
      "<h3>The numbers behind it</h3><div class=facts>" +
      fact("Base load", n.baseLoad + " " + n.unitLabel) +
      fact("Load that first spills anywhere",
           (n.spillLoad != null ? n.spillLoad.toFixed(2) + " " + n.unitLabel : null)) +
      fact("Level alarm at", "+" + n.levelDelta + " m") +
      fact("Worst SWMM continuity error", (n.worstContinuity != null ?
        n.worstContinuity.toFixed(2) + "%" : null)) +
      "</div>" +
      "<h3>What it assumes</h3>" +
      "<p>Every row below is from the project's assumptions register. These are the ones " +
      "that could change the answer, not just the picture.</p>" +
      "<table><tbody>" +
      sc.assumptions.map(a =>
        '<tr><td class="id">' + esc(a.id) + "</td><td>" + md(a.text) +
        '<br><span class="tag ' + (a.status === "A" ? "assumed" : "") + '">' +
        esc(a.statusWord) + "</span></td></tr>").join("") +
      "</tbody></table>" +
      '<div class="caveat">' + esc(sc.caveat) + "</div>";
    $("#modal").hidden = false;
    $("#modalClose").onclick = hideModal;
  }
  function hideModal() { $("#modal").hidden = true; }

  /* Bold and code only. The register's cells carry both and nothing else. */
  function md(t) {
    return esc(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
                 .replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  /* --------------------------------------------------------------- reference */
  function renderRef() {
    $("#ref").innerHTML =
      "<h1>Results</h1><pre>" + esc(SIM_INDEX.summaryText.join("\n")) + "</pre>" +
      markdown(fillBuilt(SIM_INDEX.docs.built)) +
      markdown(SIM_INDEX.docs.assumptions);
  }

  function fillBuilt(doc) {
    const run = st.run, g = SIM_GEOM.geoms[run.geom];
    const pipeLines = g.pipes.map(p =>
      "  " + p.label.padEnd(6) + " " + Math.round(p.dia * 1000).toString().padStart(4) +
      " mm  " + p.length.toFixed(1).padStart(5) + " m  slope " + (100 * p.slope).toFixed(2) +
      "%  " + p.material + " " + p.year + "  " + p.links.length + " segment(s)" +
      (p.role !== "study" ? "   (outlet)" : "")).join("\n");
    const ext = Object.keys(run.externalM).filter(c => run.externalM[c] > 0)
      .map(c => c + " " + (run.externalM[c] / 1000).toFixed(2) + " km").join(", ") || "none";
    let total = 0;
    for (const k in run.loads) total += run.loads[k];
    const v = {
      fetched: run.dataFetched, junction: run.junction, pipe_lines: pipeLines,
      pyswmm: run.pyswmm, manning_n: run.manningN, scenario_text: run.scenarioText,
      split: run.split, unit_label: run.unitLabel, external: ext, seg_len: run.segLen,
      adwf_ref: run.adwfRef, total_load: total.toFixed(2), route_s: run.routeS,
      report_s: run.reportS, minutes: run.scenario.minutes, err: run.err.toFixed(2),
      zexag: Sim3D.ZEXAG, bore: Sim3D.BORE, shaft: Sim3D.SHAFT_DRAW,
    };
    return doc.replace(/\{(\w+)\}/g, (m, k) =>
      (k in v && v[k] != null) ? String(v[k]) : m);
  }

  /* Enough markdown for these documents: headings, tables, code, bold, rules. */
  function markdown(md_) {
    const out = []; let inTable = false, inCode = false;
    const inline = t => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>")
                              .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const closeT = () => { if (inTable) { out.push("</tbody></table>"); inTable = false; } };
    for (const raw of md_.split("\n")) {
      const line = raw.replace(/\s+$/, "");
      if (/^```/.test(line)) { closeT(); out.push(inCode ? "</pre>" : "<pre class=code>"); inCode = !inCode; continue; }
      if (inCode) { out.push(esc(raw)); continue; }
      if (/^\|/.test(line)) {
        if (/^[:\-\s|]+$/.test(line)) continue;
        const cells = line.split("|").slice(1, -1).map(c => c.trim());
        if (!inTable) {
          out.push("<table><thead><tr>" + cells.map(c => "<th>" + inline(c) + "</th>").join("") +
                   "</tr></thead><tbody>");
          inTable = true;
        } else out.push("<tr>" + cells.map(c => "<td>" + inline(c) + "</td>").join("") + "</tr>");
        continue;
      }
      closeT();
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">");
      else if (/^[-*]\s+/.test(line)) out.push("<li>" + inline(line.replace(/^[-*]\s+/, "")) + "</li>");
      else if (/^---+$/.test(line)) out.push("<hr>");
      else if (!line) out.push("");
      else out.push("<p>" + inline(line) + "</p>");
    }
    closeT();
    if (inCode) out.push("</pre>");
    return out.join("\n");
  }

  /* -------------------------------------------------------------- playback */
  function tick() {
    if (st.playing && st.tab === "sim" && st.run) {
      setFrame(st.frame + 1 >= st.run.steps ? 0 : st.frame + 1);
    }
    setTimeout(tick, 60);
  }
  function setPlaying(p) { st.playing = p; $("#play").textContent = p ? "Pause" : "Play"; }

  function setTab(tab) {
    st.tab = tab;
    $("#pane-sim").hidden = tab !== "sim";
    $("#pane-ref").hidden = tab !== "ref";
    $("#tab-sim").classList.toggle("active", tab === "sim");
    $("#tab-ref").classList.toggle("active", tab === "ref");
    if (tab === "ref") { setPlaying(false); renderRef(); }
    else Sim3D.resize($("#stage"));
  }

  /* ---- sidebar width, dragged. Persisted so it survives a reload. ---- */
  function initGrip() {
    const grip = $("#grip");
    const apply = px => {
      const w = Math.max(210, Math.min(560, px));
      document.documentElement.style.setProperty("--side", w + "px");
      Sim3D.resize($("#stage"));
      return w;
    };
    try {
      const saved = localStorage.getItem("simSideWidth");
      if (saved) apply(parseInt(saved, 10));
    } catch (e) { /* private mode, blocked storage: the default width is fine */ }
    let on = false;
    grip.addEventListener("mousedown", e => {
      on = true; grip.classList.add("on"); document.body.classList.add("dragging");
      e.preventDefault();
    });
    window.addEventListener("mousemove", e => { if (on) apply(e.clientX); });
    window.addEventListener("mouseup", () => {
      if (!on) return;
      on = false; grip.classList.remove("on"); document.body.classList.remove("dragging");
      try {
        localStorage.setItem("simSideWidth",
          String(parseInt(getComputedStyle(document.documentElement)
            .getPropertyValue("--side"), 10)));
      } catch (e) { /* not worth failing a drag over */ }
    });
  }

  function init() {
    buildSizes();
    initGrip();
    $("#time").oninput = e => { setPlaying(false); setFrame(+e.target.value); };
    $("#play").onclick = () => setPlaying(!st.playing);
    $("#reset").onclick = () => Sim3D.resetCamera();
    $("#skip").onclick = () => {
      // Land a little before the event so the change is visible rather than already begun.
      const w = st.run.scenario.warmup;
      setPlaying(false);
      setFrame(Math.max(0, Math.round(((w - 2) * 60 - st.run.t0) / st.run.dt)));
    };
    $("#tab-sim").onclick = () => setTab("sim");
    $("#tab-ref").onclick = () => setTab("ref");
    $("#btn-info").onclick = showModal;
    $("#modal").onclick = e => { if (e.target.id === "modal") hideModal(); };
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") return hideModal();
      if (/^(INPUT|SELECT|BUTTON)$/.test(e.target.tagName)) return;
      if (e.code === "Space") { e.preventDefault(); setPlaying(!st.playing); }
      else if (e.key === "r" || e.key === "R") Sim3D.resetCamera();
      else if (e.key === "ArrowLeft") { setPlaying(false); setFrame(st.frame - 1); }
      else if (e.key === "ArrowRight") { setPlaying(false); setFrame(st.frame + 1); }
    });
    window.addEventListener("resize", () => Sim3D.resize($("#stage")));
    setTab("sim");
    tick();
    const def = SIM_INDEX.sizes.find(s => s.id === SIM_INDEX.default) || SIM_INDEX.sizes[0];
    selectSize(def);
  }

  return { init };
})();
