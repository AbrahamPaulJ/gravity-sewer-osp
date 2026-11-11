/* Sim 4 Expert playground (the team, 11 Nov): weather, region, homes built, 1 to 8 sensors from the list, and level or float
   for the same money. It scores every set here, from Sim 3's rows, with the rules simulation/sim4_numbers.py and
   sim4_float.py use, so on the story's selection (all 7 wet cases, the monitor and watch regions, up to 100%) it lands on
   their figures; tools/verify_sim4_web.js checks that. The float sets themselves come from the solver, in data/sim4.js. */
const Sim4Play = (() => {
  const $ = s => document.querySelector(s);
  const P = () => window.SIM4.play, S = () => window.SIM3_REGIONS, R = () => window.GROWTH_RUNS;
  const st = { pane: "play", open: false, w: "all", r: "targets", h: 5, k: 5, kind: "level", show: "level" };
  let IX = null;
  const ix = name => (IX || (IX = new Map(R().chambers.map((c, i) => [c, i])))).get(name);
  const nameOf = i => R().chambers[i];
  const esc = t => Sim4.esc(t);
  const pc = v => v == null ? "n/a" : Math.round(v * 100) + "%";
  const money = v => "$" + Math.round(v / 1000) + "k";
  const wet = () => S().cases.filter(c => c.ii > 0);
  const caseLabel = t => S().cases.find(c => c.tag === t).label;
  const levels = () => Sim4.levels();                               // build-out steps up to 100%: [{v, s}]
  const share = () => levels()[st.h - 1].v;
  const stepNow = () => levels()[st.h - 1].s;
  const targetIdx = () => P().targets.map(id => S().regions.findIndex(r => r.id === id));
  const regions = () => st.r === "targets" ? targetIdx() : [+st.r];
  const cases = () => st.w === "all" ? wet().map(c => c.tag) : [st.w];
  const oneRun = () => st.w !== "all" && st.r !== "targets";
  const action = ri => window.SIM4.triage[S().regions[ri].id];
  const baseMm = (t, i) => S().base[t].depthMm[String(i)] || 0;
  const headline = () => st.w === "all" && st.r === "targets" && st.h === levels().length;

  /* ------------------------------------------------------------ the runs a selection holds, and who hears them */
  // Growth runs: a region's build-out step, up to the share chosen, where some manhole rises 10 mm or more.
  // Overloads: a region's first new surcharge or spill, up to the share chosen; warned if a sensor hears the step before.
  function runs(t) {
    const lad = S().ladder, H = share(), keep = new Set(regions()), rows = S().rows[t];
    const det = rows.filter(x => keep.has(x.r) && lad[x.s] <= H + 1e-9 && x.rise.some(([, v]) => v >= 10)).map(x => new Map(x.rise));
    const warn = [];
    keep.forEach(ri => {
      const rr = rows.filter(x => x.r === ri).sort((a, b) => a.s - b.s);
      const f = rr.find(x => x.sur.length || x.spill.length);
      if (!f || f.s < 1 || lad[f.s] > H + 1e-9) return;
      const prev = rr.find(x => x.s === f.s - 1);
      if (prev && prev.rise.some(([, v]) => v >= 10)) warn.push(new Map(prev.rise));
    });
    return { det, warn };
  }
  // A level sensor hears a run at a 10 mm rise. A float at height h trips when the rise there is at least the margin and
  // lifts the water from the case's normal level b past h: b + margin <= h <= b + rise.
  function hears(t, rise, set) {
    const m = P().margin;
    for (const i of set.L) if ((rise.get(i) || 0) >= 10) return true;
    for (const [i, h] of set.F) { const v = rise.get(i) || 0, b = baseMm(t, i); if (v >= m && b + m <= h && h <= b + v) return true; }
    return false;
  }
  function score(set) {
    const per = [];
    let seen = 0, total = 0, warned = 0, wtotal = 0;
    cases().forEach(t => {
      const { det, warn } = runs(t);
      const s = det.filter(r => hears(t, r, set)).length;
      if (det.length) per.push({ t, share: s / det.length, seen: s, total: det.length });
      seen += s; total += det.length;
      warned += warn.filter(r => hears(t, r, set)).length; wtotal += warn.length;
    });
    const worst = per.length ? per.reduce((a, b) => (b.share < a.share ? b : a)) : null;
    const average = per.length ? per.reduce((a, b) => a + b.share, 0) / per.length : null;
    return { per, worst, average, seen, total, warned, wtotal };
  }

  /* ------------------------------------------------------------ the sets */
  const ladderNames = k => P().ladder[k - 1];
  function setOf(col) {
    if (st.kind === "level" || col === "level") {
      const names = ladderNames(st.k);
      return { L: names.map(ix), F: [], names, floats: [], cost: st.k * P().price.level, col: "level" };
    }
    const c = P().float[st.k - 1][col];
    return { L: c.level.map(ix), F: c.floats.map(([m, h]) => [ix(m), h]), names: c.level, floats: c.floats, cost: c.cost, col };
  }
  const shown = () => setOf(st.kind === "level" ? "level" : st.show);

  /* ------------------------------------------------------------ the map */
  function regionLabels() {
    const L = Sim4.actionLabels();
    if (oneRun()) {
      const ri = +st.r, row = S().rows[st.w].find(x => x.r === ri && x.s === stepNow());
      const top = row ? Math.max(0, ...row.rise.map(([, mm]) => mm)) : 0;
      L[ri] = Object.assign({}, L[ri], { text: L[ri].text + ` +${Math.round(top)} mm`, col: top >= 10 ? "#fff176" : "#8b949e" });
    }
    return L;
  }
  function drawFloats(floats) {
    Growth3D.setScenario(floats.map(([m]) => ({ name: m, n: 0 })));
    document.querySelectorAll(".labels .lbl.scn").forEach((el, j) => {
      el.textContent = "F" + (j + 1);
      el.classList.add("float");
      if (floats[j]) el.title = `Float ${j + 1}: ${floats[j][1]} mm deep, ${floats[j][2]} mm above its normal design wet level`;
    });
  }
  function paint() {
    const set = shown();
    Growth3D.setPumpRates([]); Growth3D.setPulse([]);
    if (oneRun()) {
      const t = st.w, ri = +st.r, row = S().rows[t].find(x => x.r === ri && x.s === stepNow()), named = {};
      S().base[t].surcharged.forEach(i => { named[nameOf(i)] = "was"; });
      if (row) {
        row.rise.forEach(([i, mm]) => { if (mm >= 10 && !named[nameOf(i)]) named[nameOf(i)] = "rise"; });
        row.sur.forEach(i => { named[nameOf(i)] = "tip"; });
      }
      Growth3D.setRegionTints(null);
      Growth3D.paint(named, null, set.names, null);
      Growth3D.setSpills(S().base[t].spilled.map(nameOf), row ? row.spill.map(nameOf) : []);
    } else {
      Growth3D.setRegionTints(Sim4.regionTints());
      Growth3D.paint({}, null, set.names, null);
      Growth3D.setSpills([], []);
    }
    Growth3D.setRegionLabels(regionLabels());
    drawFloats(set.floats);
    Growth3D.setCoverSelect(null, []);
  }
  function legend() {
    const L = Object.assign({}, Sim4.LEGEND, { float: ["#00d4ff", "Float"], spill: ["#ff3df5", "Overflows"] });
    const keys = (oneRun() ? ["was", "rise", "tip", "spill"] : ["monitor", "watch", "leave"]).concat(shown().names.length ? ["sensor"] : [], shown().floats.length ? ["float"] : []);
    $("#pLegend").innerHTML = keys.map(k => `<span><i style="background:${L[k][0]}"></i>${L[k][1]}</span>`).join("");
  }

  /* ------------------------------------------------------------ the words */
  function seesLine(sc) {
    if (!sc.total) return `<div class="big">No growth run</div><p>Nothing in this selection makes a manhole rise 10 mm.</p>`;
    if (st.w === "all") {
      const tied = sc.per.filter(p => p.share === sc.worst.share).length;
      return `<div class="big">${pc(sc.worst.share)} worst, ${pc(sc.average)} average</div><p>Of growth runs seen, across the 7 wet cases; worst in <b>${esc(caseLabel(sc.worst.t))}</b>${tied > 1 ? ` and ${tied - 1} more` : ""}. ${sc.seen} of ${sc.total} runs in all.</p>`;
    }
    return `<div class="big">${pc(sc.seen / sc.total)} of growth runs</div><p>${sc.seen} of ${sc.total} runs seen in ${esc(caseLabel(st.w))}.</p>`;
  }
  const warnLine = sc => sc.wtotal ? `<p>Warns of <b>${sc.warned} of ${sc.wtotal}</b> overload${sc.wtotal > 1 ? "s" : ""}: a rise one step before the first new surcharge.</p>` : "<p>No new surcharge in this selection, so nothing to warn of.</p>";
  function runLine(set) {
    if (!oneRun()) return `<p class="quiet">Pick one weather case and one region to see that run on the map.</p>`;
    const ri = +st.r, row = S().rows[st.w].find(x => x.r === ri && x.s === stepNow());
    if (!row) return "";
    const rise = new Map(row.rise), top = row.rise.reduce((a, b) => (b[1] > a[1] ? b : a), [null, 0]);
    const lv = set.names.map((m, j) => ((rise.get(ix(m)) || 0) >= 10 ? "S" + (j + 1) : null)).filter(Boolean);
    const fl = set.floats.map(([m, h], j) => (hears(st.w, rise, { L: [], F: [[ix(m), h]] }) ? "F" + (j + 1) : null)).filter(Boolean);
    const by = lv.concat(fl);
    const homes = Math.round(row.dw);
    return `<p>This run: ${esc(S().regions[ri].id)} with ${homes} new homes. Biggest rise +${Math.round(top[1])} mm${top[0] != null ? " at " + esc(nameOf(top[0])) : ""}. ${by.length ? "Heard by " + by.join(", ") + "." : "No sensor here hears it."}${row.sur.length ? ` ${row.sur.length} manhole${row.sur.length > 1 ? "s" : ""} newly surcharge.` : ""}${row.spill.length ? ` ${row.spill.length} spill.` : ""}</p>`;
  }
  function leaveLine() {
    if (st.r === "targets" || action(+st.r) !== "leave") return "";
    return `<p>${esc(S().regions[+st.r].id)} is a leave region: the list was not chosen for it.</p>`;
  }
  function renderLevel() {
    const set = shown(), sc = score(set), k = st.k, u = P().unseen[k - 1];
    $("#pResult").innerHTML = `<div class="sub">The first ${k} sensor${k > 1 ? "s" : ""} of the list, ${money(set.cost)} at an assumed ${money(P().price.level)} each</div>` +
      seesLine(sc) + warnLine(sc) +
      (headline() ? `<p>On weather they were not chosen for: <b>${pc(u[0] / u[1])}</b> (each wet case left out in turn).</p>` : "") +
      leaveLine() + runLine(set);
    return sc;
  }
  function renderFloat() {
    const cols = [["level", "Level, the list"], ["float", "Floats only"], ["mix", "Free mix"]];
    const got = cols.map(([c]) => ({ c, set: setOf(c), sc: score(setOf(c)), pre: P().float[st.k - 1][c] }));
    const on = c => (c === st.show ? ' class="on"' : "");
    const bought = s => [s.names.length ? s.names.length + " level" : "", s.floats.length ? s.floats.length + " float" + (s.floats.length > 1 ? "s" : "") : ""].filter(Boolean).join(" + ") || "none";
    const sees = sc => !sc.total ? "no runs" : st.w === "all" ? `${pc(sc.worst.share)} / ${pc(sc.average)}` : pc(sc.seen / sc.total);
    const row = (h, f) => `<tr><th>${h}</th>${got.map(g => `<td${on(g.c)}>${f(g)}</td>`).join("")}</tr>`;
    $("#pResult").innerHTML = `<div class="sub">Budget ${money(P().float[st.k - 1].budget)}; prices assumed: ${money(P().price.level)} a level sensor, ${money(P().price.float)} a float</div>` +
      `<table><thead><tr><th></th>${cols.map(([c, t]) => `<th${on(c)}>${t}</th>`).join("")}</tr></thead><tbody>` +
      row("Bought", g => bought(g.set)) + row("Cost", g => money(g.set.cost)) +
      row(st.w === "all" ? "Sees, worst / average" : "Sees", g => sees(g.sc)) +
      row("Warns", g => (g.sc.wtotal ? `${g.sc.warned} of ${g.sc.wtotal}` : "none to warn")) +
      row("Unseen weather", g => pc(g.pre.unseen[0] / g.pre.unseen[1])) + `</tbody></table>` +
      `<p>A float counts when it sits at least ${P().margin} mm above its manhole's normal level, stays quiet on a design wet day, and growth lifts the water past it. The sets are chosen on all 7 wet cases, the monitor and watch regions, up to 100%; unseen weather is for that selection.</p>` +
      leaveLine() + runLine(shown());
    return got;
  }

  /* ------------------------------------------------------------ controls */
  function syncControls() {
    $("#pWeather").value = st.w; $("#pRegion").value = st.r; $("#pHomes").value = String(st.h); $("#pK").value = String(st.k);
    $("#pHomesOut").textContent = (oneRun() ? "" : "up to ") + Math.round(share() * 100) + "% of 2041";
    $("#pKLabel").firstChild.textContent = st.kind === "level" ? "Sensors " : "Budget ";
    $("#pKOut").textContent = st.kind === "level" ? `${st.k}, ${money(st.k * P().price.level)}` : money(P().float[st.k - 1].budget);
    document.querySelectorAll("#pKind button").forEach(b => b.classList.toggle("on", b.dataset.kind === st.kind));
    document.querySelectorAll("#pShow button").forEach(b => b.classList.toggle("on", b.dataset.show === st.show));
    $("#pShow").hidden = st.kind !== "float";
  }
  function hash() {
    const w = st.w === "all" ? "all" : wet().findIndex(c => c.tag === st.w);
    return `#expert=${st.pane}&w=${w}&r=${st.r}&h=${st.h}&k=${st.k}&m=${st.kind}&show=${st.show}`;
  }
  function render() {
    if (!st.open) return;
    Sim4.hidePop();
    syncControls();
    const out = st.kind === "level" ? renderLevel() : renderFloat();
    paint(); legend();
    history.replaceState(null, "", hash());
    return out;
  }
  function showPane(p) {
    st.pane = p;
    document.querySelectorAll(".etabs button").forEach(b => { b.classList.toggle("on", b.dataset.pane === p); b.setAttribute("aria-selected", String(b.dataset.pane === p)); });
    ["play", "tables", "limits"].forEach(x => { $("#pane-" + x).hidden = x !== p; });
    $("#expert").classList.toggle("wide", p !== "play");
    $("#expert").scrollTop = 0;
    if (st.open) history.replaceState(null, "", hash());
  }
  function pick(nd) {
    if (!nd || st.pane !== "play") { Sim4.hidePop(); return; }
    const name = nd.name, set = shown(), i = ix(name);
    const lv = set.names.indexOf(name), fl = set.floats.findIndex(f => f[0] === name);
    const ri = Sim4.regionOf(name);
    let html = `<b>${esc(name)}</b><p>${ri == null ? "Not in a region." : `In ${esc(S().regions[ri].id)}: ${esc(action(ri))}.`}${esc(Sim4.overlayNote(name))}</p>`;
    if (lv >= 0) html += `<p>Level sensor S${lv + 1} of this set.</p>`;
    if (fl >= 0) html += `<p>Float F${fl + 1}: ${set.floats[fl][1]} mm deep, ${set.floats[fl][2]} mm above its normal design wet level.</p>`;
    if (i != null) {
      if (oneRun()) {
        const row = S().rows[st.w].find(x => x.r === +st.r && x.s === stepNow());
        const v = row ? (new Map(row.rise).get(i) || 0) : 0;
        html += `<p>${v >= 1 ? `Rises +${Math.round(v)} mm in this run.` : "No rise in this run."}</p>`;
      }
      const alone = score({ L: [i], F: [] });
      if (alone.total) html += `<p>A level sensor here alone would see ${alone.seen} of ${alone.total} growth runs in this selection.</p>`;
    }
    Sim4.openPop(name, html, lv >= 0, set.names.concat(set.floats.map(f => f[0])));
  }
  function fromHash(h) {
    const g = (k, d) => (h.match(new RegExp("[#&]" + k + "=([^&]+)")) || [])[1] || d;
    const w = g("w", "all"), wc = wet()[+w];
    st.w = w === "all" || !wc ? "all" : wc.tag;
    const r = g("r", "targets");
    st.r = r === "targets" || (/^\d+$/.test(r) && +r < S().regions.length) ? r : "targets";
    st.h = Math.max(1, Math.min(levels().length, +g("h", levels().length) || levels().length));
    st.k = Math.max(1, Math.min(8, +g("k", 5) || 5));
    st.kind = g("m", "level") === "float" ? "float" : "level";
    st.show = ["level", "float", "mix"].includes(g("show", "level")) ? g("show", "level") : "level";
  }
  function init() {
    $("#pWeather").innerHTML = `<option value="all">All 7 wet cases</option>` + wet().map(c => `<option value="${c.tag}">${esc(c.label)}</option>`).join("");
    $("#pRegion").innerHTML = `<option value="targets">Monitor and watch: ${P().targets.join(", ")}</option>` +
      S().regions.map((r, ri) => `<option value="${ri}">${esc(r.id)}, ${esc(action(ri))}</option>`).join("");
    $("#pHomes").max = String(levels().length);
    st.h = levels().length;
    $("#pWeather").onchange = e => { st.w = e.target.value; render(); };
    $("#pRegion").onchange = e => { st.r = e.target.value; render(); };
    $("#pHomes").oninput = e => { st.h = +e.target.value; render(); };
    $("#pK").oninput = e => { st.k = +e.target.value; render(); };
    document.querySelectorAll("#pKind button").forEach(b => { b.onclick = () => { st.kind = b.dataset.kind; render(); }; });
    document.querySelectorAll("#pShow button").forEach(b => { b.onclick = () => { st.show = b.dataset.show; render(); }; });
    document.querySelectorAll(".etabs button").forEach(b => { b.onclick = () => showPane(b.dataset.pane); });
  }
  function refit(on) {
    document.body.classList.toggle("expert-on", on);
    Growth3D.resize($("#stage"));
    Growth3D.frame(null);
  }
  function open(p) { st.open = true; refit(true); showPane(p || st.pane); render(); }
  function close() { st.open = false; Growth3D.setScenario([]); refit(false); }
  return { init, open, close, pick, fromHash, pane: () => st.pane, state: st, score, setOf, runs, render };
})();
