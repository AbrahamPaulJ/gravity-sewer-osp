/* sim_ui.js - the menu, the tabs, the readout and the summary chart.

   This replaces launcher.py's terminal menu and view3d.py's text tabs. The readout
   panel is a deliberate line-for-line port of view3d.readout(): the desktop and the
   browser must not disagree about a number, or neither can be trusted. */
"use strict";
window.SimUI = (function () {
  const SERIES_COLOURS = { A: "#2f7fd1", B: "#e8912d", J: "#3a9a5b", D: "#9b59b6" };
  const $ = sel => document.querySelector(sel);
  let state = { exp: null, runs: null, run: null, s: null, frame: 0, playing: false, tab: "sim" };

  /* ------------------------------------------------------------------- menu */
  function buildMenu() {
    const box = $("#menu");
    SIM_INDEX.menu.forEach(m => {
      const b = document.createElement("button");
      b.className = "menu-item";
      b.innerHTML = "<b>" + m.title + "</b><span>" + m.blurb + "</span>";
      b.onclick = () => openExperiment(m.exp);
      box.appendChild(b);
    });
  }

  async function openExperiment(exp) {
    state.exp = exp;
    setStatus("Loading " + exp.replace(/_/g, " ") + "...");
    const runs = await SimData.loadExperiment(exp);
    state.runs = runs;
    const meta = SIM_INDEX.experiments[exp];
    const def = meta.default ? exp + "/" + meta.default : Object.keys(runs)[0];
    const picker = $("#runPicker");
    picker.innerHTML = "";
    meta.runs.forEach(id => {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = id.split("/").slice(1).join("/");
      picker.appendChild(o);
    });
    picker.value = runs[def] ? def : meta.runs[0];
    picker.onchange = () => openRun(picker.value);
    document.querySelectorAll(".menu-item").forEach((b, i) => {
      b.classList.toggle("active", SIM_INDEX.menu[i] && SIM_INDEX.menu[i].exp === exp);
    });
    await openRun(picker.value);
    renderResults();
    setStatus("");
  }

  async function openRun(id) {
    const run = state.runs[id];
    if (!run) return;
    state.run = run;
    state.s = SimData.series(run);
    const geom = SIM_GEOM.geoms[run.geom];
    await Sim3D.build($("#stage"), geom, SIM_GEOM.ground);
    const slider = $("#time");
    slider.max = String(run.steps - 1);
    slider.value = "0";
    setFrame(0);
    renderBuilt();
  }

  /* ---------------------------------------------------------------- playback */
  function setFrame(k) {
    if (!state.run) return;
    state.frame = Math.max(0, Math.min(k, state.run.steps - 1));
    $("#time").value = String(state.frame);
    Sim3D.draw(state.frame, state.run, state.s);
    $("#readout").textContent = readout(state.frame);
  }

  function tick() {
    if (state.playing && state.tab === "sim") {
      setFrame(state.frame + 1 >= state.run.steps ? 0 : state.frame + 1);
    }
    setTimeout(tick, 60);
  }

  function setPlaying(p) {
    state.playing = p;
    $("#play").textContent = p ? "Pause" : "Play";
  }

  /* ----------------------------------------------------- readout, ported 1:1 */
  function readout(k) {
    const run = state.run, s = state.s;
    if (!run) return "";
    const geom = SIM_GEOM.geoms[run.geom];
    const nodes = {};
    geom.nodes.forEach(n => { nodes[n.name] = n; });
    const t = SimData.timeAt(run, k), tEnd = SimData.timeAt(run, run.steps - 1);
    const L = ["Junction " + run.junction + "   split: " + run.split,
               run.scenarioText,
               "t = " + (t / 60).toFixed(1).padStart(6) + " min   of " + (tEnd / 60).toFixed(0),
               "",
               "chamber  inflow     water    of shaft"];
    geom.chambers.forEach((c, i) => {
      const d = s.depth.at(k, i);
      const flag = s.flood.at(k, i) > 1e-6 ? "  SPILLING" : "";
      L.push("   " + c + "   " + s.inflow.at(k, i).toFixed(2).padStart(6) + " L/s  " +
             d.toFixed(2).padStart(5) + " m  " +
             (100 * d / nodes[c].max_depth).toFixed(0).padStart(5) + "%" + flag);
    });
    L.push("", "pipe    flow out     fullest");
    const linkIndex = {};
    geom.links.forEach((lk, i) => { linkIndex[lk.name] = i; });
    geom.pipes.forEach(p => {
      const idx = p.links.map(n => linkIndex[n]);
      const q = s.lflow.at(k, idx[idx.length - 1]);
      const fill = Math.max.apply(null, idx.map(i => s.ldepth.at(k, i) / p.dia));
      L.push(" " + p.label.padEnd(6) + " " + q.toFixed(2).padStart(7) + " L/s   " +
             (100 * Math.min(fill, 1)).toFixed(0).padStart(4) + "%" +
             (fill >= 0.999 ? "  full" : ""));
    });
    if (geom.links.length > geom.pipes.length) {
      L.push("", "(" + geom.links.length + " SWMM segments; fullest = any segment)");
    }
    return L.join("\n");
  }

  /* ----------------------------------------------------------- results tab */
  function renderResults() {
    const meta = SIM_INDEX.experiments[state.exp];
    const summ = meta && meta.summary;
    const box = $("#results");
    if (!summ) {
      box.innerHTML = "<pre>These are single scenarios, not an experiment.</pre>";
      return;
    }
    box.innerHTML = "<pre>" + escapeHtml(summ.text.join("\n")) +
      "\n\nShowing run: " + escapeHtml(state.run.id) + "</pre>" +
      (summ.chart ? '<canvas id="chart" width="900" height="420"></canvas>' : "");
    if (summ.chart) drawChart(summ.chart);
  }

  /* Log x, matching view3d's Chart2D. Values are clipped at 100% exactly as the
     desktop chart does, because past 100% of the shaft the number stops meaning
     a depth and starts meaning "spilling". */
  function drawChart(ch) {
    const cv = $("#chart"), g = cv.getContext("2d");
    const W = cv.width, H = cv.height, m = { l: 62, r: 140, t: 34, b: 46 };
    g.fillStyle = "#fbf9f4"; g.fillRect(0, 0, W, H);
    const xs = ch.x.filter(v => v > 0);
    const lx = v => Math.log10(v);
    const x0 = lx(Math.min.apply(null, xs)), x1 = lx(Math.max.apply(null, xs));
    const X = v => m.l + (lx(v) - x0) / ((x1 - x0) || 1) * (W - m.l - m.r);
    const Y = v => H - m.b - (Math.min(v, 100) / 105) * (H - m.t - m.b);

    g.strokeStyle = "#ddd6c8"; g.fillStyle = "#555b63";
    g.font = "12px ui-monospace, monospace"; g.lineWidth = 1;
    for (let p = 0; p <= 100; p += 25) {
      g.beginPath(); g.moveTo(m.l, Y(p)); g.lineTo(W - m.r, Y(p)); g.stroke();
      g.fillText(p + "%", 12, Y(p) + 4);
    }
    for (let e = Math.floor(x0); e <= Math.ceil(x1); e++) {
      const v = Math.pow(10, e);
      if (v < Math.pow(10, x0) || v > Math.pow(10, x1)) continue;
      g.beginPath(); g.moveTo(X(v), m.t); g.lineTo(X(v), H - m.b); g.stroke();
      g.fillText(String(v), X(v) - 8, H - m.b + 18);
    }
    g.fillStyle = "#1f2328"; g.font = "13px system-ui, sans-serif";
    g.fillText(ch.title, m.l, 20);
    g.fillText(ch.x_label, m.l, H - 10);

    let row = 0;
    for (const name in ch.series) {
      const col = SERIES_COLOURS[name] || "#333";
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2.5;
      g.beginPath();
      ch.series[name].forEach((v, i) => {
        const px = X(ch.x[i]), py = Y(v);
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      });
      g.stroke();
      ch.series[name].forEach((v, i) => {
        g.beginPath(); g.arc(X(ch.x[i]), Y(v), 3, 0, 7); g.fill();
      });
      g.fillRect(W - m.r + 16, m.t + row * 22, 14, 3);
      g.fillStyle = "#1f2328"; g.font = "13px system-ui, sans-serif";
      g.fillText(name, W - m.r + 38, m.t + row * 22 + 6);
      row++;
    }
  }

  /* ------------------------------------------------------- how it was built */
  function renderBuilt() {
    const run = state.run;
    const geom = SIM_GEOM.geoms[run.geom];
    const pipeLines = geom.pipes.map(p =>
      "  " + p.label.padEnd(6) + " " + Math.round(p.dia * 1000).toString().padStart(4) +
      " mm  " + p.length.toFixed(1).padStart(5) + " m  slope " + (100 * p.slope).toFixed(2) +
      "%  " + p.material + " " + p.year + "  " + p.links.length + " segment(s)" +
      (p.role !== "study" ? "   (outlet)" : "")).join("\n");
    const ext = Object.keys(run.externalM).filter(c => run.externalM[c] > 0)
      .map(c => c + " " + (run.externalM[c] / 1000).toFixed(2) + " km").join(", ") || "none";
    let total = 0;
    for (const k in run.loads) total += run.loads[k];
    const values = {
      fetched: run.dataFetched, junction: run.junction, pipe_lines: pipeLines,
      pyswmm: run.pyswmm, manning_n: run.manningN, scenario_text: run.scenarioText,
      split: run.split, unit_label: run.unitLabel, external: ext,
      seg_len: run.segLen, adwf_ref: run.adwfRef, total_load: total.toFixed(2),
      route_s: run.routeS, report_s: run.reportS, minutes: run.scenario.minutes,
      err: run.err.toFixed(2), zexag: Sim3D.ZEXAG, bore: Sim3D.BORE, shaft: Sim3D.SHAFT_DRAW,
    };
    // HOW_IT_WAS_BUILT.md is a Python format string; fill the same slots here.
    const filled = SIM_INDEX.docs.built.replace(/\{(\w+)\}/g,
      (m0, k) => (k in values && values[k] !== null && values[k] !== undefined)
        ? String(values[k]) : m0);
    $("#built").innerHTML = markdown(filled);
    $("#assumptions").innerHTML = markdown(SIM_INDEX.docs.assumptions);
  }

  /* Enough markdown for these three documents: headings, tables, code, bold, rules. */
  function markdown(md) {
    const lines = md.split("\n");
    const out = [];
    let inTable = false, inCode = false;
    const inline = t => escapeHtml(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const closeTable = () => { if (inTable) { out.push("</tbody></table>"); inTable = false; } };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");
      if (/^```/.test(line)) {
        closeTable();
        out.push(inCode ? "</pre>" : "<pre class='code'>");
        inCode = !inCode;
        continue;
      }
      if (inCode) { out.push(escapeHtml(raw)); continue; }
      if (/^\|/.test(line)) {
        const cells = line.split("|").slice(1, -1).map(c => c.trim());
        if (/^[:\-\s|]+$/.test(line)) continue;             // the --- separator row
        if (!inTable) {
          out.push("<table><thead><tr>" +
            cells.map(c => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>");
          inTable = true;
        } else {
          out.push("<tr>" + cells.map(c => "<td>" + inline(c) + "</td>").join("") + "</tr>");
        }
        continue;
      }
      closeTable();
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"); }
      else if (/^[-*]\s+/.test(line)) out.push("<li>" + inline(line.replace(/^[-*]\s+/, "")) + "</li>");
      else if (/^---+$/.test(line)) out.push("<hr>");
      else if (!line) out.push("");
      else out.push("<p>" + inline(line) + "</p>");
    }
    closeTable();
    if (inCode) out.push("</pre>");
    return out.join("\n");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  function setStatus(t) { $("#status").textContent = t; }

  function setTab(tab) {
    state.tab = tab;
    ["sim", "results", "built", "assumptions"].forEach(t => {
      $("#pane-" + t).hidden = t !== tab;
      const b = $("#tab-" + t);
      if (b) b.classList.toggle("active", t === tab);
    });
    if (tab !== "sim") setPlaying(false);
    else Sim3D.resize($("#stage"));
  }

  /* -------------------------------------------------------------- start up */
  function init() {
    buildMenu();
    $("#time").oninput = e => { setPlaying(false); setFrame(+e.target.value); };
    $("#play").onclick = () => setPlaying(!state.playing);
    $("#reset").onclick = () => Sim3D.resetCamera();
    ["sim", "results", "built", "assumptions"].forEach(t => {
      const b = $("#tab-" + t);
      if (b) b.onclick = () => setTab(t);
    });
    document.addEventListener("keydown", e => {
      if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); setPlaying(!state.playing); }
      else if (e.key === "r" || e.key === "R") Sim3D.resetCamera();
      else if (e.key === "ArrowLeft") { setPlaying(false); setFrame(state.frame - 1); }
      else if (e.key === "ArrowRight") { setPlaying(false); setFrame(state.frame + 1); }
    });
    setTab("sim");
    tick();
    openExperiment(SIM_INDEX.menu[0].exp);
  }

  return { init };
})();
