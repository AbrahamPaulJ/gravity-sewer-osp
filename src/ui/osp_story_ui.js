/* The story pages: routing between the steps, the header (progress, back and next, title,
   description, takeaway), the map they share, and each step's view.

   Steps live in the URL hash (#1 to #8), as the landing page and the sandbox already
   route, so a step can be linked to and the browser's back button walks the story.

   The story is told in two parts, one page each, sharing this file:
     blockage  story.html         osp_story.js + osp_story_views.js, on the sandbox's data
     growth    story_growth.html  osp_story_growth.js + osp_story_growth_views.js, on Sim 2.5's
   The page names its part on <body data-part>. What a step says is in the part's spec and
   what it shows is in its views; this file routes between them and owns the header and the
   hover readout. A step whose view is missing shows the plain network and says so, rather
   than borrowing another step's screen.

   Each part's modules are read inside its setup, not captured at the top: a page loads
   only its own part's scripts, so a top-level capture of the other part's would be
   undefined. */
"use strict";

const $ = id => document.getElementById(id);
const C = window.OSPCore;
const M = window.OSPMap;

const esc = s => String(s).replace(/[&<>"]/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/* One field per line, labels in a fixed-width column, and a dash for anything not
   published: visibly absent beats quietly missing. */
const row = (k, v) => `<div><span class="k">${k}</span>${v}</div>`;
const dash = "&ndash;";

/* ------------------------------------------------------------------- the parts */
/* Each returns { ST, G, F, make, ctx, describeNode, describeEdge }. */
const PARTS = {
  blockage() {
    const K = window.OSPCapacity, P = window.OSPProfile, ST = window.OSPStory;
    const PAYLOAD = window.OSP_DATA || {};
    const CODES = PAYLOAD.codes || {}, VALID = PAYLOAD.validation || null;
    const REGIONS = PAYLOAD.regions || {};
    /* Told on one network: the first region, as the sandbox opens on. */
    const RAW = REGIONS[Object.keys(REGIONS)[0]];
    const G = C.buildGraph(RAW);
    const F = ST.facts({ raw: RAW, C, K, codes: CODES });
    const MAT_LABEL = { VC: "clay", PVCU: "uPVC", RC: "concrete" };
    const COVER_SRC = { 0: "unknown", 1: "surveyed", 2: "contour", 3: "transferred" };
    return {
      ST, G, F, make: window.OSPStoryViews.make,
      ctx: { G, RAW, F, C, K, P, ST, CODES, VALID },
      describeNode(i) {
        const depth = G.cover[i] > 0 ? G.cover[i] - G.inv[i] : null;
        return `<b>node ${i}</b> ${G.mh[i] ? '<span style="color:var(--good)">maintenance hole</span>'
                                           : '<span style="color:var(--ink-faint)">junction, no manhole</span>'}` +
          row("invert", G.inv[i].toFixed(2) + " m") +
          row("depth", depth != null
            ? depth.toFixed(2) + ` m <span style="color:var(--ink-faint)">(${COVER_SRC[G.coverSrc[i]]})</span>`
            : dash) +
          row("pipes", `${G.inDeg[i]} in, ${G.outDeg[i]} out`);
      },
      describeEdge(e) {
        const Pp = G.pipes, [u, v] = G.edges[e];
        const code = Pp && Pp.mat && Pp.mat[e] >= 0 ? (CODES.mat || [])[Pp.mat[e]] : null;
        return `<b>reach ${e}</b> <span style="color:var(--ink-faint)">node ${u} &rarr; ${v}</span>` +
          row("diameter", Pp && Pp.dia[e] > 0 ? Math.round(Pp.dia[e] * 1000) + " mm" : dash) +
          row("material", code ? esc(MAT_LABEL[code] || code) : dash) +
          row("built", Pp && Pp.year && Pp.year[e] ? Pp.year[e] : dash) +
          row("grade", Pp && Pp.grade && Pp.grade[e] ? Pp.grade[e].toFixed(2) + "%" : dash) +
          row("length", G.lengths[e].toFixed(1) + " m");
      },
    };
  },

  growth() {
    const ST = window.OSPStoryGrowth, PL = window.Placement;
    const g = window.GROWTH_GEOM, R = window.GROWTH_RUNS, I = window.GROWTH_INDEX;
    const F = ST.facts({ g, R, I, C, PL });
    const { G, ctx: pctx, nodeOfChamber } = F.graph();
    const chamberOf = pctx.chamberOfNode;
    return {
      ST, G, F, make: window.OSPStoryGrowthViews.make,
      ctx: { G, g, R, I, F, C, PL, ST, chamberOf, nodeOfChamber },
      describeNode(i) {
        const v = g.nodes[i], c = chamberOf[i];
        const kind = v.kind === "chamber" ? '<span style="color:var(--good)">manhole</span>'
          : v.kind === "outfall" ? '<span style="color:var(--warn)">outlet</span>'
          : '<span style="color:var(--ink-faint)">junction, no manhole</span>';
        return `<b>${esc(c >= 0 ? R.chambers[c] : v.name)}</b> ${kind}` +
          row("depth", v.depth ? v.depth.toFixed(2) + " m" + (v.cs ? ` <span style="color:var(--ink-faint)">(${esc(v.cs)})</span>` : "") : dash) +
          row("dwellings", v.dw ? v.dw + " drain in here" : dash) +
          row("pipes", `${G.inDeg[i]} in, ${G.outDeg[i]} out`);
      },
      describeEdge(e) {
        return `<b>pipe ${g.pid ? g.pid[e] : e}</b>` +
          row("diameter", g.dia[e] ? g.dia[e] + " mm" : dash) +
          row("material", g.pmat && g.pmat[e] ? esc(g.pmat[e]) : dash) +
          row("built", g.pyr && g.pyr[e] ? g.pyr[e] : dash) +
          row("slope", g.pslope && g.pslope[e] != null ? g.pslope[e] + "%" : dash) +
          row("capacity", g.pcap && g.pcap[e] != null ? g.pcap[e] + " L/s full" : dash) +
          row("length", G.lengths[e].toFixed(1) + " m");
      },
    };
  },
};

const PART = PARTS[document.body.dataset.part] ? document.body.dataset.part : "blockage";
const part = PARTS[PART]();
const { ST, G, F } = part;
const STEPS = ST.STEPS, TOTAL = STEPS.length;
const map = M.create($("map"), G);

/* ---------------------------------------------------------------- hover readout */
let active = null;
map.on("hover", h => {
  const hud = $("hud");
  hud.classList.toggle("on", !!h);
  hud.innerHTML = !h ? "" : (h.kind === "node" ? part.describeNode(h.i) : part.describeEdge(h.e)) +
    (active && active.hud ? active.hud(h) : "");
});
$("fit").addEventListener("click", () => map.fit());

/* ---------------------------------------------------------------------- views */
const built = part.make(Object.assign({ map, esc, row, $ }, part.ctx));
const VIEWS = built.views, LONG = built.long || null;

function placeholder(step) {
  $("panel").innerHTML =
    `<h2>${esc(step.title)}</h2>` +
    `<div class="todo">This step's own view is still to be built. The map shows the plain network, ` +
    `and the takeaway above is already computed from the data.</div>`;
}

/* --------------------------------------------------------------------- routing */
let current = 0;

const stepFromHash = () => {
  const k = parseInt(location.hash.slice(1), 10);
  return k >= 1 && k <= TOTAL ? k : 1;
};
const go = k => { if (k >= 1 && k <= TOTAL && k !== current) location.hash = "#" + k; };

function buildDots() {
  const nav = $("dots"), count = $("count");
  STEPS.forEach((s, i) => {
    const b = document.createElement("button");
    b.title = `${i + 1}. ${s.title}`;
    b.setAttribute("aria-label", `Step ${i + 1}: ${s.title}`);
    b.addEventListener("click", () => go(i + 1));
    nav.insertBefore(b, count);
  });
}

function show(k) {
  if (k === current) return;
  const step = STEPS[k - 1];

  if (active && active.leave) active.leave(map);
  if (LONG) LONG.hide();
  map.reset();
  current = k;

  [...$("dots").querySelectorAll("button")].forEach((b, i) => {
    b.classList.toggle("on", i === k - 1);
    b.classList.toggle("done", i < k - 1);
    if (i === k - 1) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
  });
  $("count").textContent = `Step ${k} of ${TOTAL}`;
  $("back").disabled = k === 1;
  const last = k === TOTAL;
  $("next").hidden = last;
  /* The last step's way out: the page's own links, hidden until then. */
  document.querySelectorAll(".onlast").forEach(el => { el.hidden = !last; });
  if (!last) $("next").innerHTML = `Next<span class="long">: ${esc(STEPS[k].title)}</span>`;

  $("title").textContent = step.title;
  $("desc").textContent = step.description;
  document.title = `${step.title} · OSP Story`;

  /* A takeaway that cannot be computed says so in place: the rest of the page still
     works, and a figure is never shown that the data did not produce. */
  const tk = $("takeaway");
  try {
    tk.textContent = step.takeaway(F);
    tk.classList.remove("err");
  } catch (err) {
    console.error(err);
    tk.textContent = "This takeaway could not be computed from the loaded data.";
    tk.classList.add("err");
  }

  active = VIEWS[step.view] || null;
  if (active) active.enter(map, $("panel"), F);
  else placeholder(step);
}

/* One listener for the whole page, attached once. Arrow keys that belong to a slider,
   a text field or a select move that control, not the story. */
function isTyping(t) {
  return t instanceof HTMLElement &&
    (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable);
}
window.addEventListener("keydown", e => {
  if (e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
  if (e.key === "ArrowRight") go(current + 1);
  else if (e.key === "ArrowLeft") go(current - 1);
});

$("back").addEventListener("click", () => go(current - 1));
$("next").addEventListener("click", () => go(current + 1));
$("more").addEventListener("click", () => {
  const open = $("desc").classList.toggle("open");
  $("more").setAttribute("aria-expanded", String(open));
  $("more").textContent = open ? "Hide" : "How to use this";
});
/* A hash that names no step lands on step 1, and the address says so, rather than
   keeping a #99 that would be shared as a link to a step that does not exist. */
function route() {
  const k = stepFromHash();
  if (location.hash !== "#" + k) history.replaceState(null, "", "#" + k);
  show(k);
}
window.addEventListener("hashchange", route);

buildDots();
route();
