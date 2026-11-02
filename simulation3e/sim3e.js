/* Sim 3-e page. Reads window.SIM3E (simulation_src/sim3e/sim3e_build.py) and the Sim 3 map
   geometry (window.GROWTH_GEOM). Everything shown is from saved settled SWMM runs; the only
   things computed here are the budget split and the sensor estimate, which applies the learned
   linear map (estimators[k-1]) to the modelled fullness at the level-sensor manholes. */
(function () {
  const D = window.SIM3E, G = window.GROWTH_GEOM;
  const LABELS = {
    "ii0.00_flat_uniform_b1_sfree": ["Dry", "Sewage only, no groundwater or rain in the pipes."],
    "ii0.11_flat_uniform_b1_sfree": ["Design wet", "Leakage at the level the pipes were designed for."],
    "ii0.25_flat_uniform_b1_sfree": ["Beyond design", "1.7 times the design leakage: a wet day on a leaky network."],
    "ii0.40_flat_uniform_b1_sfree": ["Severe", "2.4 times the design leakage: a heavy wet period."],
    "ii0.11_flat_weighted_b1_sfree": ["Design wet, old pipes leak more", "Design leakage, weighted towards older pipes."],
    "ii0.11_flat_uniform_b1.5_sfree": ["Design wet, more outside inflow", "Design leakage, 1.5 times the flow from outside the council area."],
    "ii0.25_flat_weighted_b1_sfree": ["Beyond design, old pipes leak more", "Beyond-design leakage, weighted towards older pipes."],
    "ii0.25_flat_uniform_b1.5_sfree": ["Beyond design, more outside inflow", "Beyond-design leakage, 1.5 times the outside flow."],
  };
  const $ = (id) => document.getElementById(id);
  const n = D.manholes.length;
  const crit = D.critical, critSet = new Set(crit);
  const st = { c: D.cases.indexOf("ii0.11_flat_uniform_b1_sfree"), year: 2041, view: "model", nL: 0, nF: 0 };

  // ---- fullness at a year: linear between the saved ladder steps
  function ddAt(c, year) {
    const ys = D.years, rows = D.dd[D.cases[c]];
    if (year <= ys[0]) return rows[0];
    for (let i = 1; i < ys.length; i++) {
      if (year <= ys[i]) {
        const f = (year - ys[i - 1]) / (ys[i] - ys[i - 1]);
        return rows[i].map((v, j) => rows[i - 1][j] + f * (v - rows[i - 1][j]));
      }
    }
    return rows[rows.length - 1];
  }
  function estimate(dd, k) {
    if (!k) return null;
    const E = D.estimators[k - 1], S = D.order.slice(0, k);
    const x = S.map((m, i) => Math.min(dd[m], D.settings.clip_dd) - E.mx[i]);
    return E.my.map((my, j) => my + x.reduce((s, xi, i) => s + xi * E.B[i][j], 0));
  }
  const colour = (v) => v >= 1 ? "#ff2d55" : v >= 0.7 ? "#ff8c1a" : v >= 0.5 ? "#f1c40f" : "#2ecc71";
  const errColour = (e) => e <= 0.05 ? "#2ecc71" : e <= 0.10 ? "#f1c40f" : e <= 0.2 ? "#ff8c1a" : "#ff2d55";
  const yearTxt = (y) => y === null ? "after 2081" : y === "now" ? "already" : String(y);

  // ---- map geometry
  const pos = {};
  G.nodes.forEach((nd) => { if (nd.mh) pos[nd.mh] = [nd.x, nd.y]; });
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < G.px.length; i++) {
    minx = Math.min(minx, G.px[i]); maxx = Math.max(maxx, G.px[i]);
    miny = Math.min(miny, G.py[i]); maxy = Math.max(maxy, G.py[i]);
  }
  const canvas = $("map"), ctx = canvas.getContext("2d");
  function fit() {
    const r = canvas.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    canvas.style.width = r.width + "px"; canvas.style.height = r.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pad = 30, top = 70;
    const s = Math.min((r.width - 2 * pad) / (maxx - minx), (r.height - pad - top) / (maxy - miny));
    const ox = (r.width - s * (maxx - minx)) / 2, oy = top + (r.height - top - pad - s * (maxy - miny)) / 2;
    return (x, y) => [ox + (x - minx) * s, oy + (maxy - y) * s];
  }

  function chosen() {
    return { level: D.order.slice(0, st.nL), float: D.floats.slice(0, st.nF) };
  }

  function draw() {
    const T = fit(), dd = ddAt(st.c, st.year), est = estimate(dd, st.nL);
    const r = canvas.parentElement.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.strokeStyle = "#3a4a66"; ctx.lineWidth = 1.2;
    for (let p = 0; p + 1 < G.ptr.length; p++) {
      ctx.beginPath();
      for (let i = G.ptr[p]; i < G.ptr[p + 1]; i++) {
        const [x, y] = T(G.px[i], G.py[i]);
        i === G.ptr[p] ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const estOf = {};
    if (est) crit.forEach((m, j) => { estOf[m] = est[j]; });
    for (let m = 0; m < n; m++) {
      const p = pos[D.manholes[m]]; if (!p) continue;
      const [x, y] = T(p[0], p[1]);
      const isC = critSet.has(m);
      let col;
      if (st.view === "model" || !isC) col = colour(dd[m]);
      else if (!est) col = "#56627a";
      else if (st.view === "est") col = colour(estOf[m]);
      else col = errColour(Math.abs(estOf[m] - Math.min(dd[m], D.settings.clip_dd)));
      if (!isC && st.view !== "model") col = "#2a3550";
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, isC ? 4.2 : 2.6, 0, 7); ctx.fill();
    }
    const ch = chosen();
    ch.float.forEach((m, i) => mark(T, m, "F" + (i + 1), "#c084fc", "tri"));
    ch.level.forEach((m, i) => mark(T, m, "L" + (i + 1), "#38bdf8", "sq"));
    legend(); summary(dd, est);
  }
  function mark(T, m, label, col, shape) {
    const p = pos[D.manholes[m]]; if (!p) return;
    const [x, y] = T(p[0], p[1]);
    ctx.fillStyle = col; ctx.strokeStyle = "#0a1220"; ctx.lineWidth = 2;
    ctx.beginPath();
    if (shape === "sq") ctx.rect(x - 7, y - 7, 14, 14);
    else { ctx.moveTo(x, y - 8); ctx.lineTo(x + 7, y + 6); ctx.lineTo(x - 7, y + 6); ctx.closePath(); }
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#e7edf7"; ctx.font = "bold 11px system-ui"; ctx.fillText(label, x + 9, y - 6);
  }
  function legend() {
    const L = st.view === "err"
      ? [["#2ecc71", "within 0.05"], ["#f1c40f", "within 0.10"], ["#ff8c1a", "within 0.20"], ["#ff2d55", "more"]]
      : [["#2ecc71", "under 50% full"], ["#f1c40f", "50 to 70%"], ["#ff8c1a", "70 to 100%"], ["#ff2d55", "full"]];
    $("legend").innerHTML = L.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join("") +
      `<span><i style="background:#38bdf8;border-radius:2px"></i>level sensor</span><span><i style="background:#c084fc"></i>float switch</span>`;
  }
  function summary(dd, est) {
    const warn = crit.filter((m) => dd[m] >= 0.7).length, full = crit.filter((m) => dd[m] >= 1).length;
    let s = `<b>${st.year}</b>, ${LABELS[D.cases[st.c]][0]}: ${warn} of ${crit.length} critical manholes run 70% full or more, ${full} are full.`;
    if (est) {
      const good = crit.filter((m, j) => Math.abs(est[j] - Math.min(dd[m], D.settings.clip_dd)) <= D.settings.good_err).length;
      s += ` With ${st.nL} level sensor${st.nL === 1 ? "" : "s"}, ${good} of ${crit.length} are estimated within 0.10.`;
    } else if (st.view !== "model") s += " Choose a mix with at least one level sensor to see the estimate.";
    $("summary").innerHTML = s;
  }

  // ---- budget options
  function options() {
    const B = +$("budget").value || 0, PL = +$("pLevel").value || 1, PF = +$("pFloat").value || 1;
    const rows = [];
    for (let nL = 0; nL <= Math.min(10, Math.floor(B / PL)); nL++) {
      const nF = Math.min(Math.floor((B - nL * PL) / PF), D.floats.length);
      rows.push({ nL, nF, cost: nL * PL + nF * PF, acc: D.curve[nL].worst_good });
    }
    let rec = rows[0];
    rows.forEach((o) => { if (o.acc > rec.acc + 0.01 || (Math.abs(o.acc - rec.acc) <= 0.01 && o.nF > rec.nF)) rec = o; });
    return { rows, rec };
  }
  function renderOptions(keep) {
    const { rows, rec } = options();
    if (!keep || !rows.some((o) => o.nL === st.nL && o.nF === st.nF)) { st.nL = rec.nL; st.nF = rec.nF; }
    $("opts").innerHTML = `<tr><th>Mix</th><th class="r">Cost</th><th class="r">Estimated well</th></tr>` +
      rows.map((o) => `<tr data-l="${o.nL}" data-f="${o.nF}" class="${o === rec ? "rec " : ""}${o.nL === st.nL && o.nF === st.nF ? "sel" : ""}">
        <td>${o.nL} level + ${o.nF} float</td><td class="r">$${o.cost.toLocaleString()}</td><td class="r">${Math.round(100 * o.acc)}%</td></tr>`).join("");
    $("opts").querySelectorAll("tr[data-l]").forEach((tr) => tr.onclick = () => {
      st.nL = +tr.dataset.l; st.nF = +tr.dataset.f; renderOptions(true); update();
    });
  }

  // ---- why cards
  function cards() {
    const tag = D.cases[st.c], tl = D.timeline[tag];
    const ch = chosen();
    let h = "";
    ch.level.forEach((m, i) => {
      const w = D.why[i], regs = w.regions_helped.join(", ") || "its own branch";
      const top = w.improves.slice(0, 3).map((x) => `MH${x.manhole}`).join(", ");
      h += `<div class="card"><h3><span class="tag level">L${i + 1} level</span> MH${w.manhole}</h3>
        <p><b>Why here:</b> its depth tells us most about pipes it cannot see directly: it sharpens the estimate in ${regs}${top ? ` (most at ${top})` : ""}.</p>
        <p><b>Pipe:</b> ${w.dia_mm} mm, ${Math.round(100 * D.dd[tag][0][m])}% full today in this weather.</p>
        <p><b>Why level, not float:</b> the estimate needs the actual depth, not just a yes or no.</p></div>`;
    });
    ch.float.forEach((m, i) => {
      h += `<div class="card"><h3><span class="tag float">F${i + 1} float</span> MH${D.manholes[m]}</h3>
        <p><b>Why here:</b> ${Math.round(100 * D.dd[tag][0][m])}% full today; reaches 70% in ${yearTxt(tl.warn[m])} and full in ${yearTxt(tl.full[m])} if growth arrives as projected (${LABELS[tag][0]}).</p>
        <p><b>Why float:</b> a cheap alarm set at 70% full: it switches on when this pipe's room is nearly used up.</p></div>`;
    });
    $("cards").innerHTML = h || `<p class="hint">Raise the budget to place sensors.</p>`;
  }

  // ---- headroom table
  function headroom() {
    const tag = D.cases[st.c], tl = D.timeline[tag], now = D.dd[tag][0];
    const pct = (v) => v >= 1 ? "full (surcharged)" : Math.round(100 * v) + "%";
    const already = crit.filter((m) => tl.warn[m] === "now");
    const key = (y) => y === null ? 9999 : y;
    const rows = crit.filter((m) => tl.warn[m] !== "now").sort((a, b) => key(tl.warn[a]) - key(tl.warn[b]) || now[b] - now[a]).slice(0, 30);
    $("headroom").innerHTML = `<tr><td colspan="6" class="hint">${already.length} critical manholes already run 70% full or more today in this weather (not listed). The rest, soonest first:</td></tr>
      <tr><th>Manhole</th><th>Area</th><th class="r">Pipe</th><th class="r">Full today</th><th class="r">70% full by</th><th class="r">Full by</th></tr>` +
      rows.map((m) => `<tr><td>MH${D.manholes[m]}</td><td>${D.region_of[m] || ""}</td><td class="r">${D.dia_mm[m]} mm</td>
        <td class="r">${pct(now[m])}</td><td class="r">${yearTxt(tl.warn[m])}</td><td class="r">${yearTxt(tl.full[m])}</td></tr>`).join("");
  }

  // ---- accuracy curve and comparison
  function curve() {
    const c = $("curve"), r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    c.width = r.width * dpr; c.height = 220 * dpr; const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = 220, L = 40, B = 28, pts = D.curve;
    g.clearRect(0, 0, W, H); g.font = "11px system-ui"; g.fillStyle = "#6f81a3"; g.strokeStyle = "#22314d";
    [0, 0.25, 0.5, 0.75, 1].forEach((v) => { const y = H - B - v * (H - B - 10); g.beginPath(); g.moveTo(L, y); g.lineTo(W - 8, y); g.stroke(); g.fillText(Math.round(v * 100) + "%", 6, y + 4); });
    const bw = (W - L - 16) / pts.length;
    pts.forEach((p, i) => {
      const x = L + 4 + i * bw, h = p.worst_good * (H - B - 10);
      g.fillStyle = i === st.nL ? "#38bdf8" : "#2e6f99"; g.fillRect(x, H - B - h, bw - 6, h);
      g.fillStyle = "#a9b8d4"; g.fillText(String(p.k), x + bw / 2 - 6, H - 10);
    });
    g.fillStyle = "#6f81a3"; g.fillText("level sensors", L, 12);
    const C = D.comparisons, nm = { sim3e: "Sim 3-e (placed for estimation)", sim3_exact_growth: "Sim 3 exact (placed to notice growth)",
      sim3_greedy_growth: "Sim 3 greedy (placed to notice growth)", deepest_flow: "Five deepest-flow manholes", random_best_of_20: "Best of 20 random sets", no_sensors: "No sensors" };
    $("cmp").innerHTML = `<tr><th>Five level sensors</th><th class="r">Estimated well (worst case)</th><th class="r">Typical error</th></tr>` +
      Object.keys(nm).map((k) => `<tr><td>${nm[k]}</td><td class="r">${Math.round(100 * C[k].worst_good)}%</td><td class="r">${C[k].mean_rmse.toFixed(3)} d/D</td></tr>`).join("");
  }

  function update() {
    $("yearVal").textContent = st.year;
    const f = Math.max(0, (st.year - D.settings.year0) / D.settings.years_per_step);
    $("homesVal").textContent = `${Math.round(485 * f)} new homes`;
    $("caseNote").textContent = LABELS[D.cases[st.c]][1];
    $("viewNote").textContent = { model: "Fullness from the SWMM runs (depth / pipe diameter).",
      est: "Fullness at critical manholes estimated from the level sensors only.",
      err: "How far each estimate is from the modelled fullness." }[st.view];
    draw(); cards(); headroom(); curve();
  }

  $("case").innerHTML = D.cases.map((t, i) => `<option value="${i}">${LABELS[t][0]}</option>`).join("");
  $("case").value = st.c;
  $("case").onchange = (e) => { st.c = +e.target.value; update(); };
  $("year").oninput = (e) => { st.year = +e.target.value; update(); };
  ["budget", "pLevel", "pFloat"].forEach((id) => $(id).oninput = () => { renderOptions(false); update(); });
  document.querySelectorAll("#view button").forEach((b) => b.onclick = () => {
    document.querySelectorAll("#view button").forEach((x) => x.classList.toggle("on", x === b));
    st.view = b.dataset.v; update();
  });
  window.addEventListener("resize", () => { draw(); curve(); });
  renderOptions(false); update();
})();
