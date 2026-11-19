/* The demo in plain words: the "Simple" reading level, for readers who are not engineers.
   Each page is built on the same engine, map and state as app.js (App._); only the words, the amount shown and the
   charts change. Rules (demo/DESIGN.md §11): one concrete case first; counts as dots, not percentages; everyday
   comparisons; no jargon (tools/verify_demo.js checks a list); one scenario followed through the whole demo. */
(() => {
  const _ = App._, { $, S, D, C, COL, pct, money, list, regionLabel, regionIndex, rowAt, riseAt, baseMm, wetTags, allTags, caseLabel,
    score, SIM4_TEST, planIdx, st, chips, stat, fold, nextBtn, on, refresh, cutaway, manholeFacts, nameOf, HANDLERS, FULL, stepLabel } = _;

  // ------------------------------------------------------------------ words
  const WEATHER = { "Dry": "Dry day", "Design wet": "Design wet day", "Beyond design": "Very wet day", "Severe": "Extreme wet day",
    "Design wet + age-weighted I&I": "Wet day, old pipes leak more", "Design wet + outside inflow x1.5": "Wet day, extra water from upstream",
    "Beyond design + age-weighted I&I": "Very wet day, old pipes leak more", "Beyond design + outside inflow x1.5": "Very wet day, extra water from upstream" };
  const weather = tag => WEATHER[caseLabel(tag)] || caseLabel(tag);
  // Map words (legends, callouts, tooltips) in plain language. Order matters: longer phrases first.
  const WORDS = [
    [/Ninh rule, greedy/g, "Pipe-map method, first search"], [/Ninh rule, genetic algorithm/g, "Pipe-map method, second search"], [/Coverage greedy \(2-pipe radius\)/g, "Spread to reach the most manholes nearby"], [/Sim 3\.5, region-less/g, "Our earlier way, no areas"], [/ \(Ninh rule\)/g, ""], [/Sim 4 Greedy: average \(current\)/g, "Our level sensors"], [/Sim 4 Greedy: worst case/g, "Our level sensors"], [/^NR greedy/g, "Any area: one at a time"], [/^NR exact optimum/g, "Any area: best possible"], [/^NS: /g, "Without simulation: "], [/Greedy: average/g, "Best on average"], [/Greedy: worst case/g, "Best in the hardest weather"], [/Exact optimum/g, "Best set bought all at once"],
    [/\s*\(manning\)/gi, ""], [/^Watch$/, "Keep an eye on"], [/^Leave$/, "Room to spare"], [/^Level sensor$/, "Level sensor"], [/Low flow \/ capacity/gi, "Pipes with room"], [/^High$/, "Fuller pipes"],
    [/Surcharged by infiltration alone/g, "Already backing up from rain leaking in"], [/Surcharged before growth/g, "Already backing up today"],
    [/surcharged before growth/g, "already backing up today"], [/Newly surcharged/g, "Starts backing up"], [/newly surcharged/g, "starts backing up"],
    [/Newly spilling/g, "Spills from the lid"], [/newly spilling/g, "spills from the lid"], [/[Ss]urcharged/g, "backing up"],
    [/10 mm \+: noticeable/g, "1 cm or more: a sensor notices"], [/Rises 10 mm or more in (\d+) runs/g, "Rises 1 cm or more in $1 scenarios"],
    [/Rises 10 mm in few runs/g, "Notices few scenarios"], [/In many runs/g, "Notices many scenarios"], [/Responds in few runs/g, "Notices few scenarios"],
    [/Responds in many \(up to (\d+)\)/g, "Notices many (up to $1)"], [/in (\d+) runs/g, "in $1 scenarios"], [/(\d+) runs/g, "$1 scenarios"],
    [/the worst case drops to/g, "one kind of wet weather drops to"], [/in the worst weather\)/g, "in one kind of wet weather)"], [/worst case/gi, "hardest weather"], [/in the worst weather/g, "in the hardest weather"],
    [/Monitor region/g, "Area to monitor"], [/Watch region/g, "Area to watch"], [/Greedy search/g, "Our search"],
    [/Desk heuristic: flow\/capacity/g, "Without simulation: fullest pipes"], [/Desk heuristic: most homes upstream/g, "Rule of thumb: most homes upstream"],
    [/Best coverage \(exact\)/g, "Our 5 sensors"], [/Flow \/ capacity \(Manning\)/g, "How full the pipe is"], [/Flow \/ capacity/gi, "How full"], [/flow \/ capacity \(manning\)/g, "how full the pipe is"],
    [/Before growth (\d+) mm deep/g, "Before the new homes: $1 mm deep"], [/with these homes/g, "with the new homes"], [/Infiltration/g, "Rain leaking in"],
    [/water backs up from downstream/g, "water queues back from a full pipe below"], [/Responds in/g, "Notices"],
    [/Beyond design/g, "very wet day"], [/Design wet/g, "design wet day"], [/Severe/g, "extreme wet day"], [/ \+ age-weighted I&I/g, ", old pipes leak more"], [/ \+ outside inflow x1\.5/g, ", extra water from upstream"],
  ];
  const CM = "1 cm (about a fingernail's width)";

  // ------------------------------------------------------------------ small parts
  // Counts as dots: n circles, hit of them filled. People read "14 of 16" faster than "88%" (Gigerenzer; Galesic et al.).
  function dots(hit, n, colour, o = {}) {
    const r = o.r || 7, gap = 4, per = o.per || Math.min(n, 20), rows = Math.ceil(n / per), w = per * (2 * r + gap), h = rows * (2 * r + gap);
    const c = Array.from({ length: n }, (_x, k) => { const x = (k % per) * (2 * r + gap) + r, y = Math.floor(k / per) * (2 * r + gap) + r;
      return k < hit ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${colour}"/>` : `<circle cx="${x}" cy="${y}" r="${r - 1}" fill="none" stroke="${_.pal().failed}" stroke-width="1.5" stroke-dasharray="2 2"/>`; }).join("");
    return `<svg class="dots" viewBox="0 0 ${w} ${h}" width="${Math.min(100, w / 3.6)}%" role="img" aria-label="${hit} of ${n}">${c}</svg>`;
  }
  const dotRow = (label, hit, n, colour, key) => `<div class="dotrow ${key ? "click" : ""}" ${key ? `data-alt="${key}"` : ""}><div class="dl"><b>${hit} of ${n}</b> ${label}</div>${dots(hit, n, colour)}</div>`;
  const thread = text => `<div class="thread"><span>Following one scenario</span>${text}</div>`;
  const words = items => `<div class="words">${items.map(([icon, w, d]) => `<div>${ICONS[icon]}<b>${w}</b><span>${d}</span></div>`).join("")}</div>`;
  const ICONS = {
    manhole: `<svg viewBox="0 0 40 40"><rect x="14" y="6" width="12" height="26" fill="none" stroke="currentColor" stroke-width="2"/><rect x="11" y="4" width="18" height="3" fill="currentColor"/><rect x="2" y="30" width="36" height="7" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
    full: `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6.5 24 A14 14 0 0 0 33.5 24 Z" fill="var(--water)"/><line x1="4" y1="14" x2="36" y2="14" stroke="var(--warn)" stroke-dasharray="3 2"/></svg>`,
    backup: `<svg viewBox="0 0 40 40"><rect x="14" y="4" width="12" height="28" fill="none" stroke="currentColor" stroke-width="2"/><rect x="15" y="16" width="10" height="16" fill="var(--water)"/><rect x="2" y="30" width="36" height="7" fill="var(--water)" stroke="currentColor" stroke-width="2"/></svg>`,
    spill: `<svg viewBox="0 0 40 40"><rect x="14" y="8" width="12" height="24" fill="var(--water)" stroke="currentColor" stroke-width="2"/><ellipse cx="20" cy="6" rx="14" ry="3" fill="var(--spill)"/><rect x="2" y="30" width="36" height="7" fill="var(--water)" stroke="currentColor" stroke-width="2"/></svg>`,
    sensor: `<svg viewBox="0 0 40 40"><rect x="14" y="4" width="12" height="28" fill="none" stroke="currentColor" stroke-width="2"/><rect x="15" y="6" width="10" height="5" rx="1" fill="var(--sensor)"/><path d="M20 11 L17 24 M20 11 L23 24" stroke="var(--sensor)" opacity=".5"/><rect x="15" y="24" width="10" height="8" fill="var(--water)"/></svg>`,
  };

  // ------------------------------------------------------------------ facts used across pages (computed once)
  let F = null;
  function facts() {
    if (F && F.planKind === _.plan()) return F;
    const o = SIM4_TEST(), plan = planIdx(5), sc = score(plan, o), hard = sc.per.reduce((a, c) => c.share < a.share ? c : a, sc.per[0]);
    const on = (set, tag) => score(set, { ...o, cases: [tag] }).per[0];
    // The scenario we follow: one area's 2041 homes on a very wet day, where one manhole starts backing up.
    const r = regionIndex("R3"), tag = wetTags()[1], rows = _.stepsTo(1).map(s => rowAt(tag, r, s)), k = rows.findIndex(x => x.sur.length);
    const row = rows[rows.length - 1], warnRow = rows[Math.max(0, k - 1)], warnRise = plan.map(i => riseAt(warnRow, i)), ws = warnRise.indexOf(Math.max(...warnRise));
    let all = 0, allN = 0; sc.per.forEach(c => { all += c.hit; allN += c.n; });
    F = { planKind: _.plan(), plan, sc, hard, hardTag: hard.tag, n: hard.n, all, allN,
      desk: on(C().methods.hydraulic.sets[4], hard.tag).hit, exact: on(C().methods.exact.sets[4], hard.tag).hit, today: on(_.ALTERNATIVES[0].picks(), hard.tag).hit, homes: on(C().methods.homes.sets[4], hard.tag).hit, random: Math.round(C().random[4].worst * hard.n),
      // each count's own hardest weather, so 1 level sensor reads as the One-is-not-enough page does (0 in its hardest case)
      byK: [1, 2, 3, 4, 5, 6, 7, 8].map(n => score(planIdx(n), o).per.reduce((a, c) => c.share < a.share ? c : a)),
      f: { r, tag, row, homes: Math.round(row.dw), sur: row.sur[0], warnStep: _.S().ladder[Math.max(0, k - 1)], warnSensor: ws, warnMm: warnRise[ws], riseMm: riseAt(row, plan[ws]) },
      base: S().base[D().design].surcharged.length, baseWet: S().base[wetTags()[1]].surcharged.length };
    return F;
  }
  const fol = () => facts().f;
  const followName = () => `${regionLabel(fol().r)}'s 2041 homes (+${fol().homes}) on a very wet day`;

  // ------------------------------------------------------------------ pages
  const pages = {
    setting: {
      panel() {
        const s = st.setting, h = HANDLERS.setting, f = manholeFacts(s.mh), w = h.water(), dia = f.dia || 150, depthM = f.nd.depth || 2;
        const state = w.water >= depthM * 1000 ? ["bad", "Spilling out of the lid"] : w.water > dia ? ["bad", "Pipe full: water backing up the manhole"] : w.water > 0.7 * dia ? ["warn", "Past the design limit"] : ["ok", "Room to spare"];
        return `
          <div class="analogy"><b>Think of the sewer as roads for wastewater.</b> Pipes are roads, every new home adds traffic (extra homes in existing streets, or a new estate at the edge), and rain leaking into old pipes is extra traffic.
            When a pipe is full, water queues back up the manhole, like a jam onto side streets. If it reaches the lid, it spills.
            <span class="dim">Where the comparison stops: sewage only flows downhill, so a jam lower down backs up everything above it.</span></div>
          <div class="cutwrap">${cutaway({ depthM, dia, water: w.water, base: w.base, title: f.name })}<div class="badge ${state[0]}">${state[1]}</div></div>
          <h3>New homes upstream <small>(in ${regionLabel(s.r)})</small></h3>
          <div class="slider"><input id="stS" type="range" min="-1" max="${S().ladder.length - 1}" value="${s.s}" aria-label="New homes"><span>${s.s < 0 ? "None yet" : stepLabel(s.s).replace("(stress)", "(test)")}${w.row ? ` · +${Math.round(w.row.dw)}` : ""}</span></div>
          <h3>Weather conditions</h3>
          ${chips(allTags().slice(1, 4).map(t => [t, weather(t)]), k => k === s.tag, "stc")}
          ${s.mh === fol().sur ? thread(`This manhole is in ${followName()}: with all the homes added, its pipe fills and water starts backing up.`) : ""}
          ${fold("Five words used in this demo", words([["manhole", "Manhole", "The shaft from the street down to the pipe."], ["full", "Design limit", `Pipes are meant to run at most about 70% full.`],
            ["backup", "Backing up", "The pipe is full, so water rises up the manhole."], ["spill", "Spill", "Water reaches the lid and comes out into the street or a creek."],
            ["sensor", "Level sensor", "A small box under the lid that measures how high the water is."]]), true)}
          <div class="hint"><b>Why it matters:</b> a spill means cleaning, disruption for the people nearby and, if it reaches a creek, an environmental incident. A bigger pipe takes years to plan and build: a sensor buys that warning time.</div>
          ${nextBtn()}`;
      },
      wire() { const s = st.setting; $("#stS").oninput = e => { s.s = +e.target.value; refresh(); }; on("[data-stc]", "onclick", e => { s.tag = e.currentTarget.dataset.stc; refresh(); }); },
      click(i) { return HANDLERS.setting.click(i); },
    },
    network: {
      panel() {
        const n = st.network; n.bin = null; if (!["load", "flow", "cap", "size", "age"].includes(n.by)) n.by = "load"; // Simple has no bars to pick a band with
        const g = _.G(), km = (g.plen.reduce((t, v) => t + v, 0) / 1000).toFixed(0), small = g.dia.filter(d => d <= 150).length;
        return `
          <p class="lede">We built a computer model of every pipe and manhole from public maps.</p>
          <div class="stats">${stat(km + " km", "of pipe")}${stat(S().councilConnections.toLocaleString("en-AU"), "homes connected")}</div>
          <h3>Colour the pipes by</h3>
          ${chips([["load", "How full (flow ÷ capacity)"], ["flow", "Flow from homes"], ["cap", "Pipe capacity"], ["size", "Size"], ["age", "Age"]], k => k === n.by, "by")}
          <div class="hint">${{ util: "Most pipes have plenty of room. A few near the bottom of the network are close to full on a wet day: that is where trouble starts.",
            load: "Sewage from the homes upstream at the busiest time of day, against the 70% of each pipe we count as usable. Hover a pipe for its numbers.",
            flow: "Litres a second from the homes upstream at the busiest time of day. It builds up downhill: the pipes along the bottom carry everything from above.",
            cap: "The most each pipe can carry, in litres a second, from its size and slope. Red: the pipes that can carry least.",
            size: `${small} of ${g.nPipes} pipes are 150 mm across, about the width of a side plate: sized for the suburb as it was. Red: the smallest.`,
            age: "Much of it was laid before 1950 (red). Old pipes let more rain and groundwater leak in." }[n.by]}</div>
          ${nextBtn()}`;
      },
      wire() {
        on("[data-by]", "onclick", e => { st.network.by = e.currentTarget.dataset.by; st.network.bin = null; refresh(); });
      },
    },
    approach: {
      panel() {
        const a = st.approach, x = facts(), STEPS = [
          ["1", "Map the pipes", "Every pipe and manhole, from public maps, into a computer model.", "network"],
          ["2a", "Where new homes go", "The homes expected by 2041, added one area at a time, in small steps. The sensors were picked on this, then tried on new estates at the edge of the network.", "simulate"],
          ["2b", "What each home sends", "About 460 litres a day from a typical home (2.3 people), more at peak times.", "simulate"],
          ["2c", "Weather conditions", `From a dry day to an extreme wet one. On a normal wet day, rain leaks in at about half a running garden tap for every 100 m of pipe.`, "simulate"],
          ["3", "Run the model", "504 possible growth scenarios (an area, a number of new homes, a kind of weather), each giving the water level in every manhole.", "insights"],
          ["4", "Choose the areas to watch", `Will the new homes use up the room in each area's pipes by 2041? Sensors go only where the answer is yes or maybe: ${App.targetPool().length} of ${_.R().chambers.length} manholes.`, "regions"],
          ["5", "Pick the sensors, one at a time", "Each new level sensor goes where it notices the most extra scenarios. Buying more later never moves one already in.", "algorithms"],
          ["6", "Check the pick", "Count how many scenarios they notice, even in the hardest weather, and compare with other ways of choosing.", "compare"]];
        if (!STEPS.some(z => z[0] === a.step)) a.step = "1";
        const cur = STEPS.find(z => z[0] === a.step), btn = ([id, t]) => `<button type="button" data-ap="${id}" class="${!a.alt && a.step === id ? "on" : ""} ${+id[0] <= 3 ? "sim" : "alg"}"><i>${id.length > 1 ? id.slice(1) : id}</i>${t}</button>`;
        return `
          <div class="pipe6">${btn(STEPS[0])}<div class="nest"><div class="nesth"><i>2</i>Set up the growth scenarios to test</div>${STEPS.slice(1, 4).map(btn).join("")}</div>${STEPS.slice(4).map(btn).join("")}</div>
          <div class="card stepcard"><b>${cur[1]}</b><div>${cur[2]}</div><button type="button" class="link" data-go="${cur[3]}">See this step →</button></div>
          <h3>Why a model? <small>(5 level sensors each)</small></h3>
          <div class="hint">How many of the ${x.n} growth scenarios each way would notice, in the hardest weather we tested:</div>
          ${dotRow("Where problems are today", x.today, x.n, _.pal().orange, "judgement")}
          ${dotRow("A desk study of the fullest pipes", x.desk, x.n, _.pal().yellow, "desk")}
          ${dotRow("Our model", x.hard.hit, x.n, COL.sensor, "ours")}
          <div class="hint">No sensors and no new homes yet, so a model is the only way to see the growth coming.</div>
          ${nextBtn()}`;
      },
      wire() { const a = st.approach; on("[data-ap]", "onclick", e => { a.step = e.currentTarget.dataset.ap; a.alt = null; refresh(); }); on("[data-alt]", "onclick", e => { const id = e.currentTarget.dataset.alt; a.alt = a.alt === id ? null : id; refresh(); }); },
    },
    simulate: {
      panel() {
        const p = st.simulate, row = HANDLERS.simulate.row(), up = row ? row.rise.filter(([, m]) => m >= 10).length : 0;
        const presets = [["2041 homes, wet day", "R3", _.S().ladder.indexOf(1), D().design], ["2041 homes, very wet day (the scenario we follow)", "R3", _.S().ladder.indexOf(1), wetTags()[1]], ["Three times the homes, wet day", "R3", _.S().ladder.indexOf(3), D().design]];
        const isFollow = p.r === fol().r && p.s === FULL() && p.tag === fol().tag;
        return `
          <p class="lede">Choose where new homes go, how many, and the weather conditions. The map shows how much the water rises in every manhole.</p>
          <div class="presets">${presets.map((x, k) => `<button type="button" data-sp="${k}">${x[0]}</button>`).join("")}</div>
          <h3>Area</h3>${chips(S().regions.map((r, ri) => [ri, regionLabel(ri), _.REGION_COLS[r.id]]), k => +k === p.r, "region")}
          <h3>How many new homes</h3><div class="slider"><input id="pStep" type="range" min="-1" max="${S().ladder.length - 1}" value="${p.s}"><span>${p.s < 0 ? "None" : stepLabel(p.s).replace("(stress)", "(test)")}${row ? ` · +${Math.round(row.dw)}` : ""}</span></div>
          <h3>Weather conditions</h3>${chips(allTags().slice(1, 4).map(t => [t, weather(t)]), k => k === p.tag, "stc")}
          <div class="stats">${stat(up, `manholes rise ${CM} or more`)}${stat(row ? row.sur.length : 0, "start backing up", row && row.sur.length ? "bad" : "")}</div>
          ${isFollow ? thread(`This is the scenario we follow: one manhole starts backing up. One step earlier, at ${pct(fol().warnStep)} of the homes, S${fol().warnSensor + 1} of our plan has already risen ${(fol().warnMm / 10).toFixed(0)} cm.`) : ""}
          ${nextBtn()}`;
      },
      wire() {
        const p = st.simulate, pr = [["R3", 1, D().design], ["R3", 1, wetTags()[1]], ["R3", 3, D().design]];
        on("[data-sp]", "onclick", e => { const x = pr[+e.currentTarget.dataset.sp]; p.r = regionIndex(x[0]); p.s = _.S().ladder.indexOf(x[1]); p.tag = x[2]; st.sel = null; refresh(); });
        on("[data-region]", "onclick", e => { p.r = +e.currentTarget.dataset.region; refresh(); });
        on("[data-stc]", "onclick", e => { p.tag = e.currentTarget.dataset.stc; refresh(); });
        $("#pStep").oninput = e => { p.s = +e.target.value; refresh(); };
      },
    },
    insights: {
      panel() {
        const q = st.insights; q.measure = "r10"; q.max = 1;
        const { c } = HANDLERS.insights.counts(), n = c.filter(Boolean).length, top = c.map((v, i) => [v, i]).filter(x => x[0]).sort((a, b) => b[0] - a[0]).slice(0, 3);
        const sel = q.cases.size === 1 ? [...q.cases][0] : "all";
        return `
          ${_.surTiles()}
          <p class="lede">All the scenarios at once: the bigger and darker the dot, the more scenarios that manhole notices (water rises ${CM}).</p>
          <h3>Which weather</h3>
          ${chips([[D().design, "Wet day"], [wetTags()[1], "Very wet day"], ["all", "All weather"]], k => k === sel, "iw")}
          <div class="stats">${stat(`${n} of ${_.R().chambers.length}`, "manholes notice the new homes at all")}${stat(top.length ? top[0][0] : 0, "scenarios noticed by the busiest manhole")}</div>
          <div class="hint">So where you measure matters: most manholes would never see the growth. The busiest ones sit just below where several areas join. <button type="button" class="link" data-find="${top.length ? top[0][1] : 0}">Show the busiest</button></div>
          ${nextBtn()}`;
      },
      wire() {
        const q = st.insights;
        on("[data-iw]", "onclick", e => { const k = e.currentTarget.dataset.iw; q.cases = new Set(k === "all" ? allTags() : [k]); refresh(); });
        on("[data-find]", "onclick", e => { st.sel = +e.currentTarget.dataset.find; _.focus(st.sel); refresh(); });
      },
    },
    algorithms: {
      panel() {
        const a = st.algorithms; a.method = _.planMethod(); a.show = false; const x = facts(), hk = x.byK[a.k - 1], hit = hk.hit;
        return `
          <p class="lede">A sensor <b>notices</b> a scenario if its water rises ${CM}. We let the computer add one manhole at a time, always the one that notices the most new scenarios, so nothing moves as more are bought. We also checked every combination for the best set bought all at once.</p>
          <h3>How many level sensors</h3>
          <div class="slider"><input id="alK" type="range" min="1" max="8" value="${a.k}"><span>${a.k} level sensor${a.k > 1 ? "s" : ""} · ${money(a.k * _.PRICE)}</span></div>
          ${dotRow("scenarios noticed in the hardest weather", hit, hk.n, COL.sensor)}
          <div class="hint">${a.k < 5 ? `Add sensors and watch the dots fill.` : a.k === 5 ? `<b>Five is where it levels off:</b> ${[6, 7, 8].map(n => (d => `${n === 6 ? "a sixth" : n === 7 ? "a seventh" : "an eighth"} adds ${d} point${d === 1 ? "" : "s"}`)(Math.round(100 * x.byK[n - 1].share) - Math.round(100 * x.byK[n - 2].share))).join(", ")} in the hardest weather.` : "Past five, each sensor adds little."} Many nearby manholes would do almost as well, so the sites are areas, not exact lids.</div>
          ${thread(`In the scenario we follow, S${fol().warnSensor + 1} rises ${(fol().riseMm / 10).toFixed(0)} cm: it notices.`)}
          ${nextBtn()}`;
      },
      wire() { $("#alK").oninput = e => { st.algorithms.k = +e.target.value; refresh(); }; },
    },
    compare: {
      panel() {
        const c = st.compare; c.k = 5; c.mm = 10; const own = _.planMethod(); if (![own, "exact", "hydraulic", "homes"].includes(c.method)) c.method = own; const x = facts();
        const after = x.plan.map(i => score(x.plan.filter(j => j !== i), SIM4_TEST()).per.reduce((a, q) => q.share < a.share ? q : a)), weak = after.reduce((b, q, k) => q.share < after[b].share ? k : b, 0), wq = after[weak];
        return `
          <p class="lede">Five sensors each, placed five ways, counted on the same ${x.n} scenarios in the hardest weather. Click a row to see its sensors.</p>
          ${_.planChips()}
          <div data-row="${own}" class="rowwrap ${c.method === own ? "on" : ""}">${dotRow("Our 5 level sensors", x.hard.hit, x.n, COL.sensor)}</div>
          <div data-row="exact" class="rowwrap ${c.method === "exact" ? "on" : ""}">${dotRow("The best 5 bought all at once (they change as more are added)", x.exact, x.n, _.pal().blue)}</div>
          <div data-row="hydraulic" class="rowwrap ${c.method === "hydraulic" ? "on" : ""}">${dotRow("A desk study: the 5 fullest pipes", x.desk, x.n, _.pal().yellow)}</div>
          <div data-row="homes" class="rowwrap ${c.method === "homes" ? "on" : ""}">${dotRow("Rule of thumb: most homes upstream", x.homes, x.n, _.pal().pink)}</div>
          <div class="rowwrap">${dotRow("5 manholes picked at random (typical)", x.random, x.n, _.pal().failed)}</div>
          <div class="hint">Across all ${allTags().length - 1} kinds of wet weather, our 5 notice <b>${x.all} of ${x.allN}</b> scenarios.</div>
          <div class="hint"><b>New estates:</b> we also tried a new estate joining at the edge of the network, in separate scenarios. Our 5 notice ${_.GF() ? pct(_.GF().avg) : "few"} of them on average: an estate needs a placement of its own, the next piece of work.</div>
          <div class="hint"><b>One weak spot:</b> if S${weak + 1} fails, the other four notice only ${wq.hit} of ${wq.n} scenarios on a ${weather(wq.tag).toLowerCase()}. Check it first, or put two there.</div>
          ${nextBtn()}`;
      },
      wire() { on("[data-row]", "onclick", e => { st.compare.method = e.currentTarget.dataset.row; st.compare.failed.clear(); refresh(); }); },
    },
    ninh: {
      panel() {
        const n = st.ninh; n.k = 5; const d = window.NINH_COMPARE, x = facts(), tag = x.hard.tag, P = _.pal();
        const at = id => d.methods.find(m => m.id === id).byK[4], hits = id => at(id).scenario.per.find(q => q.tag === tag) || { hit: 0, n: x.n };
        const own = _.plan() === "worst" ? "gWorst" : "gAvg";
        const row = (id, label, colour) => `<div data-nm="${id}" class="rowwrap ${n.m === id ? "on" : ""}">${dotRow(label, hits(id).hit, hits(id).n, colour)}</div>`;
        const ev = (id, k) => at(id).all.ev[k];
        return `
          <p class="lede">A recent published method (Ninh and others, 2025) chooses sensor sites from the pipe map alone, without trying out growth: it puts sensors where a blocked pipe would back water up to them. A simpler common way spreads sensors so each one reaches as many manholes nearby as it can. We tried both on our growth scenarios. Click a row to see its sensors.</p>
          <div class="hint">Growth scenarios each one notices on a ${weather(tag).toLowerCase()}, the hardest weather we tested:</div>
          ${row("ninh", "Pipe-map method, first search", P.orange)}
          ${row("ga", "Pipe-map method, second search", P.yellow)}
          ${row("cov", "Spread sensors to reach the most manholes nearby", P.purple)}
          ${row("s35", "Our earlier way: trying out growth, any manhole, no areas", P.blue)}
          ${row(own, "Our 5 level sensors", COL.sensor)}
          <div class="stats">${stat(pct(at("ninh").ninh), "of the pipe length where a blockage would show: pipe-map method")}${stat(pct(at(own).ninh), "the same, for our 5")}</div>
          <div class="hint">Each method is good at its own job. The pipe-map method watches more pipe for blockages; ours notices far more of the slow rise from new homes, which is what this project is for.</div>
          <div class="hint">Pipes that <b>start backing up</b> because of the new homes, noticed when it happens: pipe-map method <b>${ev("ninh", "sur").atTime} of ${ev("ninh", "sur").series}</b>, ours <b>${ev(own, "sur").atTime} of ${ev(own, "sur").series}</b>. Pipes filling <b>past the safe level</b>: ${ev("ninh", "alarm").atTime} and ${ev(own, "alarm").atTime} of ${ev(own, "alarm").series}.</div>
          ${nextBtn()}`;
      },
      wire() { on("[data-nm]", "onclick", e => { st.ninh.m = e.currentTarget.dataset.nm; refresh(); }); },
    },
    check: {
      panel() {
        const ch = st.check; ch.screen = "util"; const o = HANDLERS.check.odd();
        return `
          <p class="lede">A quick check anyone can do with pipe sizes and slopes: which pipes are fullest on paper? If the model is sensible, those should be where it shows the water rising.</p>
          <div class="hint">They agree strongly: pipes that are fuller on paper are, mostly, the ones that rise in the model. Our sensors sit on the fuller pipes (darker dots).</div>
          ${o.length ? `<div class="card"><b>Where they disagree</b><div>${nameOf(o[0].i)} rises ${(o[0].y / 10).toFixed(0)} cm in the model, though its own pipe has room. Water queues back from a full pipe below it: the traffic jam again. Only a model of the whole network catches that.</div><button type="button" class="link" data-find="${o[0].i}">Show it</button></div>` : ""}
          ${nextBtn()}`;
      },
      wire() { on("[data-find]", "onclick", e => { st.sel = +e.currentTarget.dataset.find; _.focus(st.sel); refresh(); }); },
    },
    sensors: {
      panel() {
        const s = st.sensors; if (!["ultra", "float"].includes(s.type)) s.type = "ultra";
        const h = HANDLERS.sensors, i = h.site(), f = manholeFacts(i), base = baseMm(D().design, i), depthM = f.nd.depth, t = _.SENSOR_TYPES.find(x => x.id === s.type);
        const reading = t.id === "float" ? (s.water >= t.at({ base, dia: f.dia }) ? "ON: it says “full”" : "off: says nothing yet") : (s.water >= depthM * 1000 - 150 ? "under water: no reading" : `${Math.round(s.water)} mm`);
        return `
          <p class="lede">Drag the water up and compare what each sensor tells you.</p>
          ${chips([["ultra", "Level sensor", _.pal().sensor], ["float", "Float switch", _.pal().orange]], k => k === s.type, "sty")}
          <div class="cutwrap">${cutaway({ depthM, dia: f.dia, water: s.water, base, sensor: t.id, title: t.name })}</div>
          <div class="slider"><input id="snW" type="range" min="0" max="${Math.round(Math.min(depthM * 1000, f.dia * 4))}" value="${Math.round(s.water)}"><span>Reads: <b>${reading}</b></span></div>
          <div class="hint">${t.id === "ultra" ? "A level sensor reports the height every few minutes, so you can see the rise coming over months." : "A float only switches when the water reaches it: by then the pipe is already in trouble. For the same money, floats noticed none of the hardest-weather scenarios in our tests."}</div>
          ${fold("Who uses water-level sensors", `<ul class="lit"><li><b>An Australian trial</b>: 62 of 82 level sensors still working after about a year (Do et al. 2023).</li></ul>`)}
          ${_.verdict()}
          ${nextBtn()}`;
      },
      wire() { const s = st.sensors; on("[data-sty]", "onclick", e => { s.type = e.currentTarget.dataset.sty; refresh(); }); $("#snW").oninput = e => { s.water = +e.target.value; refresh(); }; },
    },
    repeat: {
      layer() { const set = planIdx(st.repeat.k); return { pipe: _.triagePipe(true), node: i => set.includes(i) ? { fill: COL.sensor, r: 7 } : null, labels: _.sensorLabels(set), legend: [[COL.sensor, "Our sensors"], [COL.monitor, "Area to monitor"], [COL.watch, "Area to watch"]] }; },
      panel() {
        const r = st.repeat, x = facts(), k = Math.min(8, Math.max(1, r.k));
        return `
          <p class="lede">The method carries over to any suburb; this list of sites does not. What another suburb needs:</p>
          <table class="mini"><tr><td><b>1</b></td><td>Maps of the pipes and manholes, and the homes connected</td></tr><tr><td><b>2</b></td><td>Where new homes are expected</td></tr>
            <tr><td><b>3</b></td><td>Ideally, a few weeks of water-level readings on a normal day</td></tr><tr><td><b>4</b></td><td>A few hours of computer time to run the scenarios</td></tr><tr><td><b>5</b></td><td>This page's steps, on the new results</td></tr></table>
          <h3>What can you afford?</h3>
          <div class="slider"><input id="rpK" type="range" min="1" max="8" value="${k}"><span>${k} level sensor${k > 1 ? "s" : ""} · ${money(k * _.PRICE)}</span></div>
          ${dotRow("scenarios noticed in the hardest weather", x.byK[k - 1].hit, x.byK[k - 1].n, COL.sensor)}
          <div class="hint">Want to change the areas, the weather or the rules? <button type="button" class="link" data-mode="detailed">Switch to Detailed</button></div>
          ${nextBtn()}`;
      },
      wire() { $("#rpK").oninput = e => { st.repeat.k = +e.target.value; refresh(); }; },
    },
    future: {
      panel() {
        const f = st.future, v = HANDLERS.future.virtual(planIdx(5), 0.8);
        return `
          <p class="lede">Four ways to make the plan better.</p>
          <div class="card"><b>1. Measure first</b><div>One sensor for a wet season would show whether the model is right, before buying the rest.</div></div>
          <div class="card"><b>2. Weigh what is at stake</b><div>Put sensors where a spill would hurt most: near creeks, schools, busy streets. The same search works with these priorities added.</div></div>
          <div class="card"><b>3. Let a few sensors stand in for many</b><div>A computer can learn how the network behaves, then estimate manholes without a sensor. Even a simple version estimates <b>${v.ok} of the ${v.nResp}</b> manholes that respond, from our 5 sensors (lighter dots on the map).</div></div>
          <div class="card"><b>4. New estates at the edge</b><div>Our 5 see ${_.GF() ? pct(_.GF().avg) : "few"} of a new estate's scenarios on average, ${_.GF() ? pct(_.GF().worst) : "few"} in the hardest weather: an estate needs its own level sensors, placed before the homes arrive.</div></div>
          ${_.GF() ? `<div class="stats">${_.stat(pct(_.GF().worst), "new estates, hardest weather", "bad")}${_.stat(pct(_.GF().avg), "new estates, average")}</div>` : ""}
          ${nextBtn()}`;
      },
    },
    conclude: {
      panel() {
        const x = facts(); st.conclude.k = 5;
        const groups = [["monitor", "Monitor"], ["watch", "Keep an eye on"], ["leave", "Room to spare"]].map(([t, l]) => [t, l, Object.keys(D().triage).filter(r => D().triage[r] === t)]);
        return `
          <div class="hint">Our 5 notice <b>${x.hard.hit} of ${x.n}</b> scenarios in the hardest weather, and <b>${x.all} of ${x.allN}</b> across all the wet weather we tested.</div>
          <div class="tri">${groups.map(([t, l, rs]) => `<div class="${t}"><b>${l}</b>${rs.join(", ")}</div>`).join("")}</div>
          ${_.tiles()}
          ${_.planChips()}
          ${_.verdict()}
          <h3>What we recommend</h3>
          <ol class="redo"><li><b>Start with one level sensor</b> at S1, the first site the plan picks, for a wet season (about ${money(_.PRICE)}).</li><li><b>Check the model</b> against what it records.</li><li><b>Then place the rest</b>, about ${money(5 * _.PRICE)} for five, at assumed prices.</li></ol>
          <div class="hint"><b>Why it matters:</b> sensors give years of warning before a spill, and time to plan a fix rather than react to one.</div>
          ${fold("What we need, and how sure we are", `<ul class="plain"><li>A few weeks of water-level or flow readings from a normal day.</li><li>Your pipe ratings: how full is too full.</li><li>Where new homes are approved, year by year.</li><li>Where new estates could join the network and how big they could be, so we can decide whether growth at the edge should shape the sensor sites.</li></ul><ul class="plain"><li><b>Firm:</b> where growth shows, and that five sensors beat one when the weather is unknown.</li><li><b>Less sure:</b> exact lids (many nearby sites do as well), timing, and costs. The model is not yet checked against real readings.</li><li><b>Assumed:</b> a new estate joins where there is open land at the edge of the network, no bigger than the pipe has room for, and adds sewage only.</li><li><b>Weak:</b> our 5 notice few new estates at the edge, and mostly as water backing up rather than the estate's own flow.</li></ul>`)}
          ${nextBtn()}`;
      },
    },
  };

  const x = () => facts();
  const read = {
    ninh: "Numbered dots: the chosen method's sensors. Coloured pipes: where a blocked pipe would back water up to one of them. Green rings: our 5 sensors.",
    problem: "The network, before any colour: every line is a pipe.",
    regions: "Pipe colour: monitor (red), keep an eye on (amber) or room to spare (grey). Region names sit at the edge.",
    setting: "Coloured pipes: the area getting new homes. Rings: manholes already backing up on this day. The blue dot is the manhole in the drawing; click any other.",
    network: "Each line is a pipe, coloured by what you picked. Rings: manholes already backing up on a wet day.",
    approach: "The map follows the step you pick on the left.",
    simulate: "Bigger, brighter dots: more rise. Red dots start backing up. Rings were already backing up before the new homes.",
    insights: "Dot size and colour: how many scenarios each manhole notices. Most manholes have no dot at all.",
    algorithms: "Numbered dots: the sensors. Coloured pipes: areas to monitor (red) or watch (amber).",
    compare: "Filled dots: the selected row's sensors. Rings: our 5, for comparison.",
    check: "Darker dots: fuller pipes on paper. Numbered dots: our sensors.",
    sensors: "Numbered dots: where the sensors would go.",
    repeat: "Numbered dots: the best sites for the number of sensors you can afford.",
    future: "Light-blue dots: manholes our 5 sensors could stand in for. Grey: not yet.",
    conclude: "Numbered dots: the 5 sensors. Pipe colour: monitor, keep an eye on, or room to spare.",
  };
  App.registerPlain({ pages, read, words: WORDS });
})();
