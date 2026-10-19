/* The story page: routing between the eight steps, the header (progress, back and next,
   title, description, takeaway), the map they share, and each step's view.

   Steps live in the URL hash (#1 to #8), as the landing page and the sandbox already
   route, so a step can be linked to and the browser's back button walks the story.

   What a step says is in osp_story.js and what it shows is in osp_story_views.js; this
   file routes between them and owns the header and the hover readout. A step whose view
   is missing shows the plain network and says so, rather than borrowing another step's
   screen. */
"use strict";

const $ = id => document.getElementById(id);
const C = window.OSPCore;
const K = window.OSPCapacity;
const M = window.OSPMap;
const P = window.OSPProfile;
const ST = window.OSPStory;
const SV = window.OSPStoryViews;
const PAYLOAD = window.OSP_DATA || {};
const CODES = PAYLOAD.codes || {};
const VALID = PAYLOAD.validation || null;
const REGIONS = PAYLOAD.regions || {};
/* The story is told on one network: the first region, as the sandbox opens on. */
const RAW = REGIONS[Object.keys(REGIONS)[0]];

const STEPS = ST.STEPS, TOTAL = STEPS.length;
const G = C.buildGraph(RAW);
const F = ST.facts({ raw: RAW, C, K, codes: CODES });
const map = M.create($("map"), G);

const esc = s => String(s).replace(/[&<>"]/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MAT_LABEL = { VC: "clay", PVCU: "uPVC", RC: "concrete" };
const COVER_SRC = { 0: "unknown", 1: "surveyed", 2: "contour", 3: "transferred" };

/* ---------------------------------------------------------------- hover readout */
/* One field per line, labels in a fixed-width column, and a dash for anything not
   published: visibly absent beats quietly missing. */
let active = null;
const row = (k, v) => `<div><span class="k">${k}</span>${v}</div>`;
const dash = "&ndash;";

function describeNode(i) {
  const depth = G.cover[i] > 0 ? G.cover[i] - G.inv[i] : null;
  return `<b>node ${i}</b> ${G.mh[i] ? '<span style="color:var(--good)">maintenance hole</span>'
                                     : '<span style="color:var(--ink-faint)">junction, no manhole</span>'}` +
    row("invert", G.inv[i].toFixed(2) + " m") +
    row("depth", depth != null
      ? depth.toFixed(2) + ` m <span style="color:var(--ink-faint)">(${COVER_SRC[G.coverSrc[i]]})</span>`
      : dash) +
    row("pipes", `${G.inDeg[i]} in, ${G.outDeg[i]} out`);
}

function describeEdge(e) {
  const P = G.pipes, [u, v] = G.edges[e];
  const code = P && P.mat && P.mat[e] >= 0 ? (CODES.mat || [])[P.mat[e]] : null;
  return `<b>reach ${e}</b> <span style="color:var(--ink-faint)">node ${u} &rarr; ${v}</span>` +
    row("diameter", P && P.dia[e] > 0 ? Math.round(P.dia[e] * 1000) + " mm" : dash) +
    row("material", code ? esc(MAT_LABEL[code] || code) : dash) +
    row("built", P && P.year && P.year[e] ? P.year[e] : dash) +
    row("grade", P && P.grade && P.grade[e] ? P.grade[e].toFixed(2) + "%" : dash) +
    row("length", G.lengths[e].toFixed(1) + " m");
}

map.on("hover", h => {
  const hud = $("hud");
  hud.classList.toggle("on", !!h);
  hud.innerHTML = !h ? "" : (h.kind === "node" ? describeNode(h.i) : describeEdge(h.e)) +
    (active && active.hud ? active.hud(h) : "");
});
$("fit").addEventListener("click", () => map.fit());

/* ---------------------------------------------------------------------- views */
const { views: VIEWS, long: LONG } = SV.make({
  G, RAW, F, C, K, P, ST, CODES, VALID, map, esc, row, $,
});

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
  LONG.hide();
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
  $("explore").hidden = !last;
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
