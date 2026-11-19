/* Map controls help (19 Nov). A small "?" beside the map's own controls (Explore: beside the compass; the story: in its
   top-right corner) opens a card that says how to drive the 3D map: left drag turns and tilts it, right drag moves it,
   the wheel zooms toward the pointer, and on a touch screen one finger turns it and two move it. These are the map's
   own bindings (simulation35/growth_3d.js: OrbitControls, screenSpacePanning off, its own wheel zoom; three.js's touch
   defaults with zoom off, so there is no pinch zoom). Redrawn from a design Abraham supplied, in HTML and inline SVG, so
   it is sharp at any size and follows the light and dark themes. Opens on hover or keyboard focus, and on a tap, which
   keeps it open until a second tap, Escape, or a click elsewhere. Placed under its button, or above it when there is no
   room below, so it never covers the button row it belongs to. */
window.MapHelp = (function () {
  "use strict";
  const CSS = `
.mh-pop{position:fixed; z-index:60; width:min(372px, calc(100vw - 16px)); box-sizing:border-box; padding:14px 14px 12px;
  background:var(--panel-solid, var(--panel, #111c2f)); color:var(--ink, #e7edf7); border:1px solid var(--line, #22314d);
  border-radius:12px; box-shadow:0 12px 32px #0009; font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif; text-align:left}
.mh-pop[hidden]{display:none}
.mh-head{display:flex; align-items:center; gap:10px; margin:0 0 10px}
.mh-head .mh-q{flex:none; width:26px; height:26px; border-radius:50%; border:2px solid currentColor; display:grid; place-items:center; font-weight:700; font-size:14px; line-height:1}
.mh-head b{display:block; font-size:16px; line-height:1.2}
.mh-head span{display:block; font-size:12px; color:var(--dim, #a9b8d4)}
.mh-grid{display:grid; grid-template-columns:1fr 1fr; gap:8px}
.mh-card{border:1.5px solid var(--mh-c); border-radius:10px; padding:9px 9px 8px; display:flex; flex-direction:column; align-items:center; text-align:center; gap:5px;
  background:color-mix(in srgb, var(--mh-c) 7%, transparent)}
.mh-card.l{--mh-c:#3b9cff} .mh-card.r{--mh-c:#b06cff}
.mh-top{display:flex; align-items:center; gap:8px}
.mh-mouse{width:24px; height:34px; flex:none}
.mh-pill{font-size:12px; font-weight:700; padding:3px 10px; border-radius:99px; background:var(--mh-c); color:#fff; white-space:nowrap}
.mh-card b{font-size:13px; line-height:1.25}
.mh-card .mh-sub{font-size:11.5px; color:var(--dim, #a9b8d4); line-height:1.3}
.mh-art{width:100%; max-width:150px; height:auto; display:block}
.mh-row{display:flex; align-items:center; gap:10px; margin-top:8px; padding:7px 9px; border:1px solid var(--line, #22314d); border-radius:10px; font-size:12.5px}
.mh-row svg{flex:none; width:24px; height:30px}
.mh-row .mh-sub{color:var(--dim, #a9b8d4)}
html[data-theme="light"] .mh-pop{box-shadow:0 12px 32px #1f232833}
html[data-theme="light"] .mh-card.l{--mh-c:#0969da} html[data-theme="light"] .mh-card.r{--mh-c:#8250df}
@media (prefers-reduced-motion:no-preference){.mh-pop:not([hidden]){animation:mhIn .14s ease-out}}
@keyframes mhIn{from{opacity:0; transform:translateY(-3px)} to{opacity:1; transform:none}}
`;
  // A mouse, one button filled: "l", "r" or "w" (the wheel).
  const mouse = (which, col) => `<svg class="mh-mouse" viewBox="0 0 24 34" aria-hidden="true">
    <rect x="1.5" y="1.5" width="21" height="31" rx="10.5" fill="none" stroke="currentColor" stroke-width="2"/>
    ${which === "l" ? `<path d="M12 2.5 A9.5 9.5 0 0 0 2.5 12 V13.5 H12 Z" fill="${col}"/>` : ""}
    ${which === "r" ? `<path d="M12 2.5 A9.5 9.5 0 0 1 21.5 12 V13.5 H12 Z" fill="${col}"/>` : ""}
    <line x1="12" y1="2" x2="12" y2="13.5" stroke="currentColor" stroke-width="1.6"/><line x1="2" y1="13.5" x2="22" y2="13.5" stroke="currentColor" stroke-width="1.6"/>
    ${which === "w" ? `<rect x="10" y="5" width="4" height="7" rx="2" fill="${col}"/>` : ""}
  </svg>`;
  // A flat block of town, seen at an angle, with arrows round it (turn) or out from it (move).
  const plate = `<path d="M75 20 L118 36 L75 52 L32 36 Z" fill="color-mix(in srgb, currentColor 14%, transparent)" stroke="currentColor" stroke-opacity=".55" stroke-width="1.2"/>
    <g fill="currentColor" fill-opacity=".5"><rect x="66" y="26" width="6" height="10"/><rect x="76" y="29" width="5" height="8"/><rect x="58" y="33" width="5" height="6"/><rect x="84" y="35" width="6" height="5"/><rect x="72" y="39" width="5" height="6"/></g>`;
  const turnArt = (c, flat) => `<svg class="mh-art" viewBox="0 0 150 72" aria-hidden="true">${plate}
    <path d="M20 40 C 22 60, 128 60, 130 40" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
    <path d="M124 45 L131 38 L134 48" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${flat ? "</svg>" : `
    <path d="M75 6 C 92 8, 94 64, 75 66" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-opacity=".85"/>
    <path d="M81 63 L74 67 L80 71" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-opacity=".85"/></svg>`}`;
  const arrow = (x1, y1, x2, y2, c) => {
    const a = Math.atan2(y2 - y1, x2 - x1), h = 6, p = (t, d) => [x2 - h * Math.cos(a - t) * d, y2 - h * Math.sin(a - t) * d];
    const [ax, ay] = p(0.6, 1), [bx, by] = p(-0.6, 1);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="3" stroke-linecap="round"/><path d="M${ax.toFixed(1)} ${ay.toFixed(1)} L${x2} ${y2} L${bx.toFixed(1)} ${by.toFixed(1)}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  };
  const moveArt = c => `<svg class="mh-art" viewBox="0 0 150 72" aria-hidden="true">${plate}
    ${arrow(30, 36, 8, 36, c)}${arrow(120, 36, 142, 36, c)}${arrow(75, 18, 75, 3, c)}${arrow(75, 54, 75, 69, c)}</svg>`;
  const touch = `<svg viewBox="0 0 24 30" aria-hidden="true"><path d="M9 14 V5 a2 2 0 0 1 4 0 v8 l5.2 1.3 a2.4 2.4 0 0 1 1.8 2.6 L19 25 a3 3 0 0 1 -3 3 H11 a3 3 0 0 1 -2.4 -1.2 L4.4 21 a2 2 0 0 1 3 -2.6 L9 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  // Wording can be changed per page (the product demo's flat map turns but does not tilt); the defaults are the 3D map's.
  const TEXT = { sub: "Mouse controls for the 3D map", turnSub: "Round and tilt, both ways", flat: false,
    touch: "one finger turns the map, two fingers move it" };
  function html(t) {
    const L = "var(--mh-c)";
    return `<div class="mh-head"><span class="mh-q" aria-hidden="true">?</span><div><b>Map controls</b><span>${t.sub}</span></div></div>
      <div class="mh-grid">
        <div class="mh-card l"><div class="mh-top">${mouse("l", L)}<span class="mh-pill">Left click</span></div>
          <b>Drag to turn the map</b><span class="mh-sub">${t.turnSub}</span>${turnArt(L, t.flat)}</div>
        <div class="mh-card r"><div class="mh-top">${mouse("r", L)}<span class="mh-pill">Right click</span></div>
          <b>Drag to move the map</b><span class="mh-sub">Left, right, up and down</span>${moveArt(L)}</div>
      </div>
      <div class="mh-row">${mouse("w", "currentColor")}<div><b>Scroll</b> to zoom in or out<div class="mh-sub">towards wherever the pointer is</div></div></div>
      <div class="mh-row">${touch}<div><b>On a touch screen</b><div class="mh-sub">${t.touch}</div></div></div>`;
  }
  let styled = false;
  function attach(btn, text) {
    if (!btn || btn._mapHelp) return null;
    if (!styled) { const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); styled = true; }
    const pop = document.createElement("div");
    pop.className = "mh-pop"; pop.id = (btn.id || "mapHelp") + "Pop"; pop.hidden = true;
    pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Map controls");
    pop.innerHTML = html(Object.assign({}, TEXT, text || {}));
    document.body.appendChild(pop);
    btn.setAttribute("aria-controls", pop.id);
    btn.setAttribute("aria-expanded", "false");
    if (!btn.title) btn.title = "Map controls";
    let pinned = false, hideT = 0;
    const place = () => {
      const r = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, m = 8;
      let left = Math.min(innerWidth - w - m, r.right - w);
      left = Math.max(m, left);
      let top = r.bottom + m;
      if (top + h > innerHeight - m && r.top - m - h >= m) top = r.top - m - h;      // no room below: above the button
      top = Math.max(m, Math.min(top, innerHeight - h - m));
      pop.style.left = Math.round(left) + "px"; pop.style.top = Math.round(top) + "px";
    };
    const show = () => { clearTimeout(hideT); if (pop.hidden) { pop.hidden = false; btn.setAttribute("aria-expanded", "true"); } place(); };
    const hide = () => { clearTimeout(hideT); pinned = false; pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    const later = () => { if (pinned) return; clearTimeout(hideT); hideT = setTimeout(hide, 160); };
    btn.addEventListener("mouseenter", show);
    btn.addEventListener("mouseleave", later);
    pop.addEventListener("mouseenter", () => clearTimeout(hideT));
    pop.addEventListener("mouseleave", later);
    btn.addEventListener("focus", show);
    btn.addEventListener("blur", later);
    btn.addEventListener("click", e => { e.stopPropagation(); if (pinned) hide(); else { pinned = true; show(); } });
    document.addEventListener("click", e => { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) hide(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !pop.hidden) hide(); });
    addEventListener("resize", () => { if (!pop.hidden) place(); });
    btn._mapHelp = { pop, show, hide };
    return btn._mapHelp;
  }
  return { attach };
})();
