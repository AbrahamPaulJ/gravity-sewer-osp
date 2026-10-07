/* growth_3d.js - the catchment above A in 3D, coloured by what growth did to it.

   157 pipes, 155 nodes, 71 of them real chambers. Pipes are drawn as lines and chambers
   as pickable markers, because choosing where the houses go is the one thing the page
   asks of a person and pointing at the map is how you do that.

   COLOUR IS THE WHOLE ARGUMENT, so it is deliberately only three states:
     grey    below the crown, room to spare
     amber   already surcharged before a single house was added
     red     TIPPED: fine before, surcharged after, and therefore caused by this growth
   Amber and red are separated because conflating them is the mistake the sandbox module
   header warns about: a reach that was already a problem is not evidence about growth.

   Elevation is the pipe invert, exaggerated, and the factor is on screen. 32 m of fall
   across this catchment would otherwise draw as a flat street map. */
"use strict";
window.Growth3D = (function () {
  let THREE = null, OrbitControls = null, loadPromise = null;
  let renderer, scene, camera, controls, ray, pointer;
  let pipeGeo = null, pipeColours = null, chamberMeshes = [], labelLayer = null;
  let pipeBodies = null, bodyTint = null;
  let built = false, onPick = null, onHover = null, focusRing = null, outletLabel = null;
  let houseGeo = null, houseColours = null, houseHi = null, houseRim = null, houseUp = null,
      sleeves = null;
  let siteLabel = null, bottleneckMesh = null, lastPipeState = null, region = null;
  let scaleLabels = [];             // the height ruler's tick labels, projected like the rest
  let pipeLines = null, pipeCard = null;
  let stationMeshes = [], risingLines = [];          // pump stations and their rising mains
  let pumpsOn = false, pumpLabels = [], pumpTubes = null, pumpSleeves = null;   // the chip
  let scnMarks = [];                                 // a growth scenario's sites: ring + label          // pipes as pickable lines; the details card
  let houseJ = null, latHi = null, latUp = null;   // where each home joins its main; the laterals drawn
  const segEnds = [];               // per pipe segment, its two endpoints, for the sleeves
  const clock = { t0: performance.now() };
  const ZEXAG = 22.0;
  /* DARK, and saturated. The first version drew grey pipes and beige markers on a cream
     background and was unreadable: every state looked like every other state. On a dark
     ground a saturated colour carries, so the three pipe states separate at a glance and
     the markers stop competing with the pipes for attention. */
  const HI_MIN = 18, HI_MAX = 21, RIM = 5;   // linked-home dot sizes; RIM is the white edge
  const UP_MIN = 15, UP_MAX = 17;            // upstream homes: as clearly apart from plain (4.5)
  const COL = {
    bg: 0x0d1117,
    ok: [0x4c, 0x8b, 0xf5],        // blue, has room
    was: [0xff, 0xa5, 0x00],       // orange, surcharged before any growth
    tip: [0xff, 0x2d, 0x55],       // hot red, tipped by this growth
    // Pink, not amber/yellow: "already surcharged, not growth" already owns that hue,
    // and a homes layer that reads the same colour as a pipe warning was the confusion.
    house: 0xff6f9c,
    junction: 0x30363d,            // a pipe end the record does not call a chamber
    chamber: 0xc9d1d9,             // a real, published manhole: a candidate sensor site
    site: 0x00d4ff,                // cyan, where the new dwellings connect
    outlet: 0xa371f7,              // violet, the chamber everything drains through
    sensor: 0x3fb950,              // green, a proposed sensor
    houseDim: 0x3a2430,            // a property with nothing to do with the selection
    houseUp: 0x7dc4e0,             // drains THROUGH the selected manhole, from further up
    // A home's own connection pipe down to its main. Lighter than the royal-blue dot it
    // hangs from, because a one-pixel line in that blue vanishes on the dark ground.
    lateralHere: 0x6f95ff,
    // Royal blue, not the cyan of the growth marker: "these homes reach this manhole first"
    // and "the new dwellings connect here" are different facts. A white rim keeps a dark
    // blue readable on the near-black background and apart from the blue pipes.
    houseHere: 0x1f4fff,
    houseRim: 0xffffff,
    sleeve: 0x00d4ff,              // the pipes those homes drain through
    // A sleeve is translucent cyan over whatever the pipe already is. Cyan over amber
    // ("already surcharged, not growth") mixes toward green, which reads as a fourth,
    // undefined state. Where the covered pipe is amber the sleeve switches to this
    // yellow instead, so it stays visibly a highlight ON amber rather than a new colour.
    sleeveOnAmber: 0xffe066,
    watched: 0x3fb950,             // sewage passes a proposed sensor on its way out
    bottleneck: 0xffffff,          // the fixed set of pipes find_bottlenecks() names
    region: 0x4f5d75,              // the rest of the council network: solved, not a candidate
    entryIn: 0xf0f6fc,             // an outside inflow joining the study area itself
    entryOut: 0x8b949e,            // an outside inflow joining the rest of the network
    heatPipe: [0x3a, 0x42, 0x50],  // pipes while the heatmap is on: neutral, out of the way
    datum: 0x8b949e,               // the height ruler and datum plane: present, never loud
    // Pumped, not gravity. Gold, which nothing else on the map uses, and told apart by shape
    // as well as colour: a cube where every other node is a sphere or a dot, a dashed
    // line where every gravity main is a solid tube. Dimmed where the model leaves it out.
    pump: 0xe3b341,
    pumpOff: 0x6e5a2a,
  };

  function ensureThree() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      THREE = await import("three");
      OrbitControls = (await import("three/addons/controls/OrbitControls.js")).OrbitControls;
    })();
    return loadPromise;
  }

  const G = () => window.GROWTH_GEOM;

  function P(xDm, yDm, zCm) {
    return new THREE.Vector3(xDm / 10, (zCm / 100) * ZEXAG, -(yDm / 10));
  }

  async function build(container, pick, hover) {
    await ensureThree();
    onPick = pick; onHover = hover || null;
    const g = G();
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500000);
      ray = new THREE.Raycaster();
      pointer = new THREE.Vector2();
      container.innerHTML = "";
      container.appendChild(renderer.domElement);
      labelLayer = document.createElement("div");
      labelLayer.className = "labels";
      container.appendChild(labelLayer);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      renderer.domElement.addEventListener("pointerdown", onDown);
      renderer.domElement.addEventListener("pointerup", onUp);
      renderer.domElement.addEventListener("pointermove", onMove);
      renderer.domElement.addEventListener("pointerleave", () => hoverTo(null));
      window.addEventListener("resize", () => resize(container));
      (function loop() {
        requestAnimationFrame(loop);
        controls.update();
        // The blink. One shared clock so every pulsing thing stays in phase rather than
        // drifting against each other, which read as flicker rather than a deliberate beat.
        const t = (performance.now() - clock.t0) / 1000, beat = Math.sin(t * 3.4);
        // Linked homes never shrink below HI_MIN (plain homes are 4.5) or fade below 80%,
        // so even at the bottom of the pulse they cannot be mistaken for unrelated ones.
        if (houseHi) {
          const sz = HI_MIN + (HI_MAX - HI_MIN) * (0.5 + 0.5 * beat);
          houseHi.material.size = sz; houseHi.material.opacity = 0.9 + 0.1 * beat;
          houseRim.material.size = sz + RIM; houseRim.material.opacity = 0.8 + 0.2 * beat;
        }
        // Upstream homes get the same floor: never below UP_MIN or 80% while blinking.
        if (houseUp) {
          const b2 = 0.5 + 0.5 * Math.sin(t * 3.4 + 0.7);
          houseUp.material.size = UP_MIN + (UP_MAX - UP_MIN) * b2;
          houseUp.material.opacity = 0.8 + 0.2 * b2;
        }
        if (sleeves) sleeves.material.opacity = 0.20 + 0.22 * (0.5 + 0.5 * beat);
        renderer.render(scene, camera);
        if (pumpsOn) {
          const sc = 2.0 + 0.45 * (0.5 + 0.5 * beat);    // in phase with the linked homes
          stationMeshes.forEach(m => m.scale.setScalar(sc));
        }
        [outletLabel, siteLabel, ...scaleLabels, ...(pumpsOn ? pumpLabels : []),
         ...scnMarks.map(m => m.label)].forEach(lbl => {
          if (!lbl) return;
          const v = lbl.at.clone().project(camera);
          const el = renderer.domElement;
          lbl.el.style.display = v.z < 1 ? "block" : "none";
          lbl.el.style.left = ((v.x * 0.5 + 0.5) * el.clientWidth) + "px";
          lbl.el.style.top = ((-v.y * 0.5 + 0.5) * el.clientHeight) + "px";
        });
      })();
    }
    if (built) { resize(container); return; }
    scene.background = new THREE.Color(COL.bg);
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 0.35);
    sun.position.set(-100, 300, 200);
    scene.add(sun);

    // The connected properties, drawn at the ground rather than at pipe level so they read
    // as a layer above the network instead of merging into it.
    if (g.hx && g.hx.length) {
      const hp = [];
      for (let i = 0; i < g.hx.length; i++) {
        // Its own main's elevation plus a couple of metres, so the properties sit just
        // above the street they drain into rather than on one shared plane.
        const v = P(g.hx[i], g.hy[i], (g.hz ? g.hz[i] : 0) + 200);
        hp.push(v.x, v.y, v.z);
      }
      // Colour per property, so lighting up the homes behind a manhole is an array write.
      // The highlighted ones are drawn again on top, larger, because a colour change alone
      // on a 4.5 unit dot does not carry across the whole catchment.
      houseGeo = new THREE.BufferGeometry();
      houseGeo.setAttribute("position", new THREE.Float32BufferAttribute(hp, 3));
      houseColours = new THREE.Float32BufferAttribute(new Float32Array(hp.length), 3);
      houseGeo.setAttribute("color", houseColours);
      scene.add(new THREE.Points(houseGeo, new THREE.PointsMaterial({
        size: 4.5, sizeAttenuation: true, vertexColors: true,
        transparent: true, opacity: 0.9 })));
      const overlay = (col, size, order = 2) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(hp), 3));
        geo.setDrawRange(0, 0);
        // Transparent, though fully opaque, only so it sorts into the same pass as the
        // plain layer and draws after it. As an opaque object it drew first, and the plain
        // dot at the identical depth then painted over its centre.
        const pts = new THREE.Points(geo, new THREE.PointsMaterial({
          color: col, size, sizeAttenuation: true, transparent: true, opacity: 1 }));
        pts.renderOrder = order;
        scene.add(pts);
        return pts;
      };
      // Bigger than the plain layer, and blinking (the render loop below pulses their
      // opacity and size), because a same-size, same-brightness dot in a field of 643
      // others is easy to lose the moment you move the mouse.
      houseUp = overlay(COL.houseUp, UP_MIN);
      houseRim = overlay(COL.houseRim, HI_MIN + RIM, 3);   // drawn under the blue, a size up
      houseHi = overlay(COL.houseHere, HI_MIN, 4);
    }

    // Pipe ends the manhole record does not cover. Drawn small and dark so the question
    // "what are all these dots" has a visible answer: the bright ones are chambers you
    // could put a sensor in, these are not.
    const jp = [];
    g.nodes.forEach(nd => {
      if (nd.kind === "chamber") return;
      const v = P(nd.x, nd.y, nd.inv);
      jp.push(v.x, v.y, v.z);
    });
    if (jp.length) {
      const jg = new THREE.BufferGeometry();
      jg.setAttribute("position", new THREE.Float32BufferAttribute(jp, 3));
      scene.add(new THREE.Points(jg, new THREE.PointsMaterial({
        color: COL.junction, size: 6, sizeAttenuation: true })));
    }

    // One LineSegments for every pipe, with a colour attribute so recolouring a scenario
    // is an array write rather than a scene rebuild.
    const pos = [], col = [], segPipe = [];
    for (let p = 0; p < g.nPipes; p++) {
      const a = g.ptr[p], b = g.ptr[p + 1], n = b - a;
      if (n < 2) continue;
      const zu = g.zu[p], zd = g.zd[p];
      for (let i = a; i < b - 1; i++) {
        const f0 = (i - a) / (n - 1), f1 = (i + 1 - a) / (n - 1);
        const v0 = P(g.px[i], g.py[i], zu + (zd - zu) * f0);
        const v1 = P(g.px[i + 1], g.py[i + 1], zu + (zd - zu) * f1);
        pos.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z);
        col.push(0, 0, 0, 0, 0, 0);
        segPipe.push(p);
        segEnds.push([v0, v1]);
      }
    }
    pipeGeo = new THREE.BufferGeometry();
    pipeGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    pipeColours = new THREE.Float32BufferAttribute(col, 3);
    pipeGeo.setAttribute("color", pipeColours);
    pipeGeo.userData.segPipe = segPipe;
    pipeLines = new THREE.LineSegments(pipeGeo,
      new THREE.LineBasicMaterial({ vertexColors: true }));
    scene.add(pipeLines);

    /* Pipe bodies: one instanced cylinder per segment, its radius the pipe's own bore.
       WebGL ignores LineBasicMaterial.linewidth, as the sleeve note below says, so a line
       cannot be made thicker and the bore has to be drawn as geometry.

       Radius is PROPORTIONAL to diameter: radius = d x R_MAX / (largest d), so the
       largest main is R_MAX and every other pipe is drawn in its true ratio to it. A
       450 mm trunk reads 3.15 times a 143 mm lateral main, as it is. Only the overall
       size is exaggerated, which it has to be: at true scale a 450 mm pipe would be about
       half a unit wide on a map measured in metres, and invisible.

       It was sqrt(d) normalised between a floor and a ceiling until 2 Oct 2026, justified
       as "sqrt tracks flow area". It does not: flow area goes as d squared, so tracking it
       would spread the widths further, not compress them. sqrt and the floor together
       drew that 450 mm main only 2.27 times the 143 mm, and a reader asking whether
       widths are proportional deserves a yes.

       Colour is left to paint(), which writes the scenario colour here as well as on the
       lines, so widening a pipe never changes what it says.

       TWO TRAPS, both of which rendered the whole network unreadable before they were
       found by screenshotting the page rather than by any check in tools/.

       vertexColors STAYS FALSE. A per-instance colour arrives through instanceColor and
       the USE_INSTANCING_COLOR path, which is a different mechanism from vertex colours.
       Turning vertexColors on makes the shader also multiply by the geometry's own colour
       attribute; CylinderGeometry has none, MeshBasicMaterial carries no default for it,
       so the attribute reads 0 and every tube renders BLACK over the lines.

       AND EVERY INSTANCE IS COLOURED BELOW, BEFORE THE MESH REACHES THE SCENE. An
       InstancedMesh only gets the instanceColor path compiled into its shader if
       instanceColor exists when the material first compiles. Leave it to the first
       paint() and the first frame compiles without it, and every later setColorAt writes
       to an attribute the shader never reads. The sleeve dodges this by starting at
       count 0; these are permanent scenery, so they are painted up front instead. */
    {
      const dia = g.dia || [];
      let dlo = Infinity, dhi = -Infinity;
      for (let p = 0; p < g.nPipes; p++) {
        const d = dia[p];
        if (!(d > 0)) continue;
        if (d < dlo) dlo = d;
        if (d > dhi) dhi = d;
      }
      // R_MAX stays under the bottleneck tube at 4.4 and the chamber at 5.6.
      const R_MAX = 3.4, R_NONE = 1.5;
      const k = dhi > 0 && isFinite(dhi) ? R_MAX / dhi : 0;
      // A link with no published diameter (an outfall dummy, say) is drawn at the smallest
      // real pipe's radius rather than inventing a size for it.
      const radiusOf = p => {
        const d = dia[p];
        if (!(d > 0) || !k) return isFinite(dlo) && k ? k * dlo : R_NONE;
        return k * d;
      };
      pipeBodies = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(1, 1, 1, 6, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),   // see the vertexColors note above
        Math.max(1, segEnds.length));
      pipeBodies.count = segEnds.length;
      pipeBodies.frustumCulled = false;
      bodyTint = new THREE.Color();
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      const yAxis = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3(), mid = new THREE.Vector3(), scl = new THREE.Vector3();
      const ok = COL.ok;   // the build-time colour; paint() overwrites it on first draw
      for (let s = 0; s < segEnds.length; s++) {
        pipeBodies.setColorAt(s, bodyTint.setRGB(ok[0] / 255, ok[1] / 255, ok[2] / 255));
        const [a, b] = segEnds[s];
        dir.subVectors(b, a);
        const len = dir.length();
        if (len < 1e-6) { m.makeScale(0, 0, 0); pipeBodies.setMatrixAt(s, m); continue; }
        q.setFromUnitVectors(yAxis, dir.clone().divideScalar(len));
        mid.addVectors(a, b).multiplyScalar(0.5);
        const r = radiusOf(segPipe[s]);
        scl.set(r, len, r);
        m.compose(mid, q, scl);
        pipeBodies.setMatrixAt(s, m);
      }
      pipeBodies.instanceMatrix.needsUpdate = true;
      if (pipeBodies.instanceColor) pipeBodies.instanceColor.needsUpdate = true;
      scene.add(pipeBodies);
    }


    /* Each home's connection to its main. The data records where every property's own
       connection pipe meets a main (layer 7, median 6.2 m long). That point is snapped
       here onto the nearest drawn pipe segment rather than placed by its published level,
       so the line ends on the pipe as it is drawn, exaggeration and all. It runs from the
       home, drawn 2 m above its main, down to that point: mostly a drop, which is what a
       lateral is. Built once; highlight() draws only the ones for the homes it lights. */
    if (houseGeo && g.jx && g.jx.length === g.hx.length && segEnds.length) {
      const n = g.hx.length;
      houseJ = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const j = P(g.jx[i], g.jy[i], 0);              // only x and z matter here
        let best = Infinity, bx = j.x, by = 0, bz = j.z;
        for (let s2 = 0; s2 < segEnds.length; s2++) {
          const [a, b] = segEnds[s2];
          const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
          let t = L2 > 0 ? ((j.x - a.x) * dx + (j.z - a.z) * dz) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = a.x + t * dx, qz = a.z + t * dz;
          const d = (j.x - qx) * (j.x - qx) + (j.z - qz) * (j.z - qz);
          if (d < best) { best = d; bx = qx; bz = qz; by = a.y + t * (b.y - a.y); }
        }
        houseJ[i * 3] = bx; houseJ[i * 3 + 1] = by; houseJ[i * 3 + 2] = bz;
      }
      const lateral = (col, opacity) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 6), 3));
        geo.setDrawRange(0, 0);
        const ls = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
          color: col, transparent: true, opacity }));
        ls.frustumCulled = false;
        scene.add(ls);
        return ls;
      };
      latHi = lateral(COL.lateralHere, 0.95);
      latUp = lateral(COL.houseUp, 0.5);     // fainter: there can be hundreds of these
    }

    // Sleeves: a translucent tube around every pipe in the highlighted catchment. WebGL
    // ignores line width, so a line cannot be made thicker, and recolouring the pipe itself
    // would overwrite the blue, amber and red the page's argument depends on. A sleeve
    // leaves that colour visible inside it. One instanced cylinder per segment, allocated
    // once; a selection only writes matrices and a count.
    // White base colour: MeshBasicMaterial MULTIPLIES vertexColors against its own
    // .color, so a cyan base here would have quietly tinted every per-instance colour
    // set below, including the yellow meant to fix the cyan-on-amber problem in the
    // first place. White makes the instance colour render unmodified.
    sleeves = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true,
        opacity: 0.28, depthWrite: false }), Math.max(1, segEnds.length));
    sleeves.count = 0;
    sleeves.renderOrder = 1;
    sleeves.frustumCulled = false;
    scene.add(sleeves);

    // A permanent, selection-independent highlight of the network's real bottlenecks:
    // the only pipes where build_growth_web.py's find_bottlenecks() says the per-site
    // growth capacity actually changes crossing them. Off by default, toggled from the
    // UI, opaque rather than translucent since it never has to share a pipe with a
    // selection colour the way the sleeve does.
    const bnSet = new Set((g.bottlenecks || []).map(b => b.pipe));
    const bnSegs = [];
    for (let s = 0; s < segEnds.length; s++) if (bnSet.has(segPipe[s])) bnSegs.push(s);
    bottleneckMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: COL.bottleneck }), Math.max(1, bnSegs.length));
    bottleneckMesh.count = bnSegs.length;
    bottleneckMesh.visible = false;
    bottleneckMesh.frustumCulled = false;
    {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion();
      const yAxis = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3(), mid = new THREE.Vector3(), scl = new THREE.Vector3();
      bnSegs.forEach((s, k) => {
        const [a, b] = segEnds[s];
        dir.subVectors(b, a);
        const len = dir.length();
        if (len < 1e-6) return;
        q.setFromUnitVectors(yAxis, dir.clone().divideScalar(len));
        mid.addVectors(a, b).multiplyScalar(0.5);
        scl.set(4.4, len, 4.4);
        m.compose(mid, q, scl);
        bottleneckMesh.setMatrixAt(k, m);
      });
      bottleneckMesh.instanceMatrix.needsUpdate = true;
    }
    scene.add(bottleneckMesh);

    // Chambers. Spheres rather than points so they can be picked and so their size means
    // something at any zoom.
    const sphere = new THREE.SphereGeometry(5.6, 14, 10);
    chamberMeshes = [];
    g.nodes.forEach((nd, i) => {
      if (nd.kind !== "chamber") return;
      const m = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: COL.chamber }));
      m.position.copy(P(nd.x, nd.y, nd.inv));
      m.userData = { node: nd, index: i };
      scene.add(m);
      chamberMeshes.push(m);
    });

    // A ring on the ground plus a stalk above it. One chamber among 71, in a view you can
    // orbit, is genuinely hard to find from its colour alone; the stalk is what makes the
    // growth site locatable without hunting for it.
    // The outlet. Everything on screen drains through this one chamber, so it gets a
    // marker of its own rather than being one white dot among the rest.
    if (g.outletName) {
      const on = g.nodes.find(n => n.name === g.outletName);
      if (on) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(26, 2.6, 8, 40),
          new THREE.MeshBasicMaterial({ color: COL.outlet }));
        ring.rotation.x = Math.PI / 2;
        ring.position.copy(P(on.x, on.y, on.inv));
        scene.add(ring);
        const lbl = document.createElement("div");
        lbl.className = "lbl outlet";
        // The whole-area domain ends at an outfall where the council data stops, which
        // has no manhole number; "MH null" is what the bare concatenation printed.
        lbl.textContent = on.mh ? "outlet, MH " + on.mh : "outlet, where the council network ends";
        labelLayer.appendChild(lbl);
        outletLabel = { el: lbl, at: P(on.x, on.y, on.inv) };
      }
    }

    /* The height datum, made visible. Every level on this map is drawn relative to the
       lowest invert in the model (g.oz) and exaggerated ZEXAG times, and neither number
       was on screen, so heights could be compared with each other but not read. A ruler at
       the corner of the network, ticked in real metres, and a faint plane at its foot give
       them something to be measured against. The ruler is drawn through P() like every
       pipe, so it carries the same exaggeration and reads off directly.

       The levels are as published, in metres above the survey datum. The council layer
       does not name the datum; cover levels come from the government 1 m contours and
       cover minus invert gives credible chamber depths, so both share one datum, which
       for South Australian survey levels is AHD. The label says "consistent with AHD"
       rather than claiming what the data does not state. */
    {
      const lv = g.nodes.map(n => g.oz + n.inv / 100);
      const top = g.nodes.map(n => g.oz + n.inv / 100 + (n.depth || 0));
      const lo = Math.min(...lv), hi = Math.max(...top);
      const step = hi - lo > 40 ? 10 : 5;
      const base = Math.floor(lo / step) * step, peak = Math.ceil(hi / step) * step;
      const cm = level => (level - g.oz) * 100;          // real metres -> P()'s z units
      const xs = g.nodes.map(n => n.x), ys = g.nodes.map(n => n.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const pad = 0.04 * Math.max(x1 - x0, y1 - y0);
      const rx = x0 - pad, ry = y0 - pad, tick = 0.025 * Math.max(x1 - x0, y1 - y0);

      const seg = [];
      const add = (a, b) => seg.push(a.x, a.y, a.z, b.x, b.y, b.z);
      add(P(rx, ry, cm(base)), P(rx, ry, cm(peak)));
      for (let L = base; L <= peak + 1e-9; L += step) {
        add(P(rx, ry, cm(L)), P(rx + tick, ry, cm(L)));
        const el = document.createElement("div");
        el.className = "lbl scale";
        // The foot of the ruler is the datum plane, so its tick says so rather than
        // leaving the plane a grid with no name.
        el.textContent = L === base ? L + " m \u2190 datum plane (100 m grid)" : L + " m";
        labelLayer.appendChild(el);
        scaleLabels.push({ el, at: P(rx + tick, ry, cm(L)) });
      }
      const cap = document.createElement("div");
      cap.className = "lbl scale cap";
      cap.textContent = "height above datum, m (consistent with AHD) \u00b7 vertical \u00d7" + ZEXAG;
      labelLayer.appendChild(cap);
      // Under the foot of the ruler, not above its top: the top sits in the corner the
      // "homes behind" box covers, and a caption you cannot read explains nothing.
      scaleLabels.push({ el: cap, at: P(rx, ry, cm(base)) });

      // The datum plane at the ruler's foot: the network's outline plus a 100 m grid.
      const z = cm(base), gx = 1000;                     // 1000 dm = 100 m
      const X0 = rx, X1 = x1 + pad, Y0 = ry, Y1 = y1 + pad;
      for (let x = Math.ceil(X0 / gx) * gx; x <= X1; x += gx) add(P(x, Y0, z), P(x, Y1, z));
      for (let y = Math.ceil(Y0 / gx) * gx; y <= Y1; y += gx) add(P(X0, y, z), P(X1, y, z));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
      scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: COL.datum, transparent: true, opacity: 0.35 })));
    }

    /* Pump stations and their rising mains. A gravity main falls; a rising main is pumped
       uphill under pressure, so it is drawn as a dashed line, never a tube, and its station
       as a cube at the wet well. The route is the published one; its depth is not
       published, so it runs from the wet well's invert to the discharge's, linearly, and
       the card says it is schematic. A station the model leaves out is drawn dimmed. */
    stationMeshes = []; risingLines = [];
    (g.pumps || []).forEach((ps, k) => {
      const col = ps.modelled ? COL.pump : COL.pumpOff;
      const pts = ps.px.map((x, j) => P(x, ps.py[j], ps.pz[j]));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineDashedMaterial({ color: col, dashSize: 7, gapSize: 5 }));
      line.computeLineDistances();             // dashes need distances along the line
      line.userData.pump = k;
      scene.add(line);
      risingLines.push(line);
      const box = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12),
        new THREE.MeshBasicMaterial({ color: col }));
      box.position.copy(P(ps.x, ps.y, ps.z));
      box.userData.pump = k;
      // A dark edge so the cube reads as a cube, not a square dot, from any angle.
      box.add(new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry),
        new THREE.LineBasicMaterial({ color: 0x0d1117 })));
      scene.add(box);
      stationMeshes.push(box);
    });
    const pumpKey = document.getElementById("pumpKey");
    if (pumpKey) pumpKey.hidden = !stationMeshes.length;   // no key for a map with no pumps

    /* What the "Pump stations" chip switches on, built once and kept hidden: the rising
       mains as thick gold tubes, a gold sleeve over every pipe that drains to a modelled
       station's wet well (the part of the catchment that depends on pumping), and a label
       per station. Instance colours are set before the meshes reach the scene and the
       material has no vertexColors, for the two reasons the pipe-body note gives. */
    if (stationMeshes.length) {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3(), mid = new THREE.Vector3(), scl = new THREE.Vector3();
      const tint = new THREE.Color();
      const place = (mesh, k, a, b, r) => {
        dir.subVectors(b, a);
        const len = dir.length();
        if (len < 1e-6) m4.makeScale(0, 0, 0);
        else {
          q.setFromUnitVectors(yAxis, dir.clone().divideScalar(len));
          mid.addVectors(a, b).multiplyScalar(0.5);
          scl.set(r, len, r);
          m4.compose(mid, q, scl);
        }
        mesh.setMatrixAt(k, m4);
      };
      const rm = [];
      g.pumps.forEach(ps => {
        for (let j = 0; j < ps.px.length - 1; j++)
          rm.push([P(ps.px[j], ps.py[j], ps.pz[j]), P(ps.px[j + 1], ps.py[j + 1], ps.pz[j + 1]),
                   ps.modelled ? COL.pump : COL.pumpOff]);
      });
      pumpTubes = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, rm.length));
      rm.forEach(([a, b, col], k) => { place(pumpTubes, k, a, b, 2.8); pumpTubes.setColorAt(k, tint.setHex(col)); });
      pumpTubes.instanceMatrix.needsUpdate = true;
      pumpTubes.visible = false;
      pumpTubes.frustumCulled = false;
      scene.add(pumpTubes);

      // Pipes draining to each modelled wet well: walk the links upstream from it.
      const into = g.nodes.map(() => []);
      for (let l = 0; l < g.up.length; l++) into[g.down[l]].push(l);
      const served = new Set();
      g.pumps.forEach(ps => {
        if (ps.node == null) return;
        const seen = new Set([ps.node]), stack = [ps.node];
        while (stack.length) for (const l of into[stack.pop()]) {
          served.add(l);
          if (!seen.has(g.up[l])) { seen.add(g.up[l]); stack.push(g.up[l]); }
        }
      });
      const segPipeAll = pipeGeo.userData.segPipe, segs = [];
      for (let k = 0; k < segPipeAll.length; k++) if (served.has(segPipeAll[k])) segs.push(k);
      pumpSleeves = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true),
        new THREE.MeshBasicMaterial({ color: COL.pump, transparent: true, opacity: 0.3, depthWrite: false }),
        Math.max(1, segs.length));
      segs.forEach((k, j) => { const [a, b] = segEnds[k]; place(pumpSleeves, j, a, b, 5.5); });
      pumpSleeves.count = segs.length;
      pumpSleeves.instanceMatrix.needsUpdate = true;
      pumpSleeves.visible = false;
      pumpSleeves.frustumCulled = false;
      scene.add(pumpSleeves);

      pumpLabels = g.pumps.map(ps => {
        const el = document.createElement("div");
        el.className = "lbl pump";
        el.textContent = (ps.id ? "Pump station " + ps.id : "Pump station") +
          (ps.to ? " \u2192 MH " + ps.to : ps.modelled ? "" : " (not modelled)");
        el.style.display = "none";
        labelLayer.appendChild(el);
        return { el, at: P(ps.x, ps.y, ps.z) };
      });
    }

    siteLabel = { el: document.createElement("div"), at: new THREE.Vector3() };
    siteLabel.el.className = "lbl site";
    siteLabel.el.style.display = "none";
    labelLayer.appendChild(siteLabel.el);

    focusRing = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(22, 2.4, 8, 36),
      new THREE.MeshBasicMaterial({ color: COL.site }));
    ring.rotation.x = Math.PI / 2;
    focusRing.add(ring);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 260, 8),
      new THREE.MeshBasicMaterial({ color: COL.site, transparent: true, opacity: 0.6 }));
    stalk.position.y = 130;
    focusRing.add(stalk);
    focusRing.visible = false;
    scene.add(focusRing);

    built = true;
    frame();
    resize(container);
  }

  /* Picking. A drag that ends where it began is a click; anything else is an orbit, so
     rotating the view does not keep reassigning the growth site. */
  let downAt = null;
  function onDown(e) { downAt = { x: e.clientX, y: e.clientY }; }
  function chamberAt(e) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(chamberMeshes, false)[0];
    return hit ? hit.object.userData.node : null;
  }
  /* The pipe under the pointer, as an index into the geometry's links, or -1. Picked on
     the centre lines rather than the tubes, with a tolerance of a few screen pixels turned
     into world units at the clicked depth, so a 150 mm pipe can still be clicked from a
     view of the whole area where its tube is narrower than a pixel. */
  function pipeAt(e) {
    if (!pipeLines) return -1;
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(pointer, camera);
    const dist = camera.position.distanceTo(controls.target);
    const perPx = 2 * dist * Math.tan((camera.fov * Math.PI / 180) / 2) / r.height;
    ray.params.Line = { threshold: 6 * perPx };
    const hit = ray.intersectObject(pipeLines, false)[0];
    if (!hit || hit.index == null) return -1;
    return pipeGeo.userData.segPipe[Math.floor(hit.index / 2)];
  }

  /* A pump station or its rising main under the pointer, as an index into g.pumps, or -1.
     The cube is hit as a mesh; the dashed line with the same pixel tolerance as the pipes. */
  function pumpAt(e) {
    if (!stationMeshes.length) return -1;
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(pointer, camera);
    const box = ray.intersectObjects(stationMeshes, false)[0];
    if (box) return box.object.userData.pump;
    const dist = camera.position.distanceTo(controls.target);
    ray.params.Line = { threshold: 6 * 2 * dist * Math.tan((camera.fov * Math.PI / 180) / 2) / r.height };
    const line = ray.intersectObjects(risingLines, false)[0];
    return line ? line.object.userData.pump : -1;
  }

  function onUp(e) {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 4) return;                             // an orbit, not a click
    // A chamber wins over the pipes that meet at it: clicking a manhole still moves the
    // growth there, exactly as before. Only a click on a pipe away from any chamber opens
    // the pipe's card, and a click on empty ground closes it.
    const nd = chamberAt(e);
    if (nd) { closePipe(); if (onPick) onPick(nd); return; }
    const k = pumpAt(e);
    if (k >= 0) { showPump(k, e.clientX, e.clientY); return; }
    const p = pipeAt(e);
    if (p >= 0) { showPipe(p, e.clientX, e.clientY); return; }
    // Empty ground: close any pipe card and clear the selected manhole. onPick(null) is how
    // the page hears "nothing selected", the same channel a manhole click comes through.
    closePipe();
    if (onPick) onPick(null);
  }

  const MATERIAL = { VC: "vitrified clay", PVCU: "uPVC", RC: "reinforced concrete" };
  const STATE = {
    ok: ["#4c8bf5", "room to spare"],
    was: ["#ffa500", "already over the alarm before growth"],
    tip: ["#ff2d55", "sees this growth"],
  };
  /* Turn the pump-station highlight on or off. False if the map has no stations, so the
     page can hide its chip rather than offer a switch that does nothing. */
  function showPumps(on) {
    if (!stationMeshes.length) return false;
    pumpsOn = !!on;
    if (pumpTubes) pumpTubes.visible = pumpsOn;
    if (pumpSleeves) pumpSleeves.visible = pumpsOn;
    if (!pumpsOn) {
      stationMeshes.forEach(m => m.scale.setScalar(1));
      pumpLabels.forEach(l => { l.el.style.display = "none"; });
    }
    return true;
  }
  /* The sites of a growth scenario: a cyan ring at each, the colour the legend gives to
     "where the new dwellings connect", sized a little by its dwellings, and a "+n" label.
     Replaces whatever was there; an empty list clears them. */
  function setScenario(items) {
    if (!built) return;
    scnMarks.forEach(m => { scene.remove(m.ring); m.ring.geometry.dispose(); m.label.el.remove(); });
    scnMarks = [];
    const g = G();
    (items || []).forEach(({ name, n }) => {
      const nd = g.nodes.find(x => x.name === name);
      if (!nd) return;
      const at = P(nd.x, nd.y, nd.inv);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(15 + Math.min(16, 1.2 * Math.sqrt(n)), 2.4, 8, 36),
        new THREE.MeshBasicMaterial({ color: COL.site }));
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(at);
      scene.add(ring);
      const el = document.createElement("div");
      el.className = "lbl scn";
      el.textContent = "+" + n;
      labelLayer.appendChild(el);
      scnMarks.push({ ring, label: { el, at } });
    });
  }
  function closePipe() { if (pipeCard) pipeCard.hidden = true; }
  function cardAt(html, cx, cy) {
    const host = renderer.domElement.parentElement;
    if (!pipeCard) {
      pipeCard = document.createElement("div");
      pipeCard.className = "pipeCard";
      host.appendChild(pipeCard);
      document.addEventListener("keydown", ev => { if (ev.key === "Escape") closePipe(); });
    }
    pipeCard.innerHTML = '<button class="x" title="Close (Esc)">\u00d7</button>' + html;
    pipeCard.querySelector(".x").onclick = closePipe;
    pipeCard.hidden = false;
    const r = host.getBoundingClientRect();
    const w = pipeCard.offsetWidth, h = pipeCard.offsetHeight;
    pipeCard.style.left = Math.max(8, Math.min(cx - r.left + 14, r.width - w - 8)) + "px";
    pipeCard.style.top = Math.max(8, Math.min(cy - r.top + 14, r.height - h - 8)) + "px";
  }
  function showPump(k, cx, cy) {
    const ps = G().pumps[k];
    const row = (a, b) => '<div class="r"><span>' + a + "</span><b>" + b + "</b></div>";
    cardAt(
      "<h4>" + (ps.id ? "Pump station " + ps.id : "Pump station, no structure record") + "</h4>" +
      '<div class="sub">' + (ps.to ? "pumps to MH " + ps.to : "pumps out of the modelled area") + "</div>" +
      row("Rising main", ps.dia.join(", ") + " mm, " + ps.len.toFixed(1) + " m" +
        (ps.risingMains.length > 1 ? " in " + ps.risingMains.length + " pieces" : "")) +
      row("Homes it serves", ps.homes) +
      row("In the model", ps.modelled ? "yes, as an ideal pump" : "no") +
      '<div class="note">' + (ps.modelled
        ? "An ideal pump passes everything reaching the wet well straight on, with no pump " +
          "rate, storage or cycling. A real station delivers in bursts, so the peak at the " +
          "manhole it pumps to can be higher than the model shows."
        : "It discharges outside the model's area, so its flow never reaches the network " +
          "solved here.") +
      " The rising main's route is published, its depth is not: it is drawn schematically " +
      "from the wet well to where it discharges.</div>", cx, cy);
  }
  function showPipe(p, cx, cy) {
    const g = G();
    const host = renderer.domElement.parentElement;
    if (!pipeCard) {
      pipeCard = document.createElement("div");
      pipeCard.className = "pipeCard";
      host.appendChild(pipeCard);
      document.addEventListener("keydown", ev => { if (ev.key === "Escape") closePipe(); });
    }
    const at = i => g.nodes[i];
    const end = n => n.mh ? "MH " + n.mh : (n.kind === "outfall" ? "outfall" : "unrecorded pipe end");
    const lvl = cm => (g.oz + cm / 100).toFixed(2);
    const v = (arr, f = x => x) => (g[arr] && g[arr][p] != null) ? f(g[arr][p]) : null;
    const mat = v("pmat", m => (MATERIAL[m] || m) + (MATERIAL[m] ? " (" + m + ")" : ""));
    const st = lastPipeState && STATE[lastPipeState[p]];
    const row = (k, val) => val == null ? "" :
      '<div class="r"><span>' + k + "</span><b>" + val + "</b></div>";
    pipeCard.innerHTML =
      '<button class="x" title="Close (Esc)">\u00d7</button>' +
      "<h4>" + (v("pid") ? "Pipe " + v("pid") : "Pipe, no published record") + "</h4>" +
      '<div class="sub">' + end(at(g.up[p])) + " \u2192 " + end(at(g.down[p])) + "</div>" +
      row("Diameter", g.dia[p] ? g.dia[p] + " mm" : null) +
      row("Material", mat) +
      row("Built", v("pyr") || "not recorded") +
      row("Length", v("plen", x => x.toFixed(1) + " m")) +
      row("Grade", v("pslope", x => x.toFixed(2) + " %")) +
      row("Pipe floor, up \u2192 down", lvl(g.zu[p]) + " \u2192 " + lvl(g.zd[p]) + " m") +
      row("Full-bore capacity", v("pcap", x => x.toFixed(1) + " L/s")) +
      (st ? '<div class="state"><i style="background:' + st[0] + '"></i>This case: ' + st[1] + "</div>" : "") +
      '<div class="note">Capacity is Manning full-bore at the published grade, with the ' +
      "roughness for its material. Levels in metres above datum.</div>";
    pipeCard.querySelector(".x").onclick = closePipe;
    pipeCard.hidden = false;
    // Beside the click, kept inside the map so it never opens half off-screen.
    const r = host.getBoundingClientRect();
    const w = pipeCard.offsetWidth, h = pipeCard.offsetHeight;
    pipeCard.style.left = Math.max(8, Math.min(cx - r.left + 14, r.width - w - 8)) + "px";
    pipeCard.style.top = Math.max(8, Math.min(cy - r.top + 14, r.height - h - 8)) + "px";
  }

  /* Hover previews a manhole's homes without moving the growth there. Mouse only: a touch
     has no hover, and a tap still does everything. At most one raycast per frame. */
  let hovered = null, moveQueued = null;
  function onMove(e) {
    if (e.pointerType !== "mouse" || !onHover || !built) return;
    if (e.buttons) { hoverTo(null); return; }         // orbiting, not pointing
    if (!moveQueued) requestAnimationFrame(() => {
      const ev = moveQueued; moveQueued = null;
      if (ev) hoverTo(chamberAt(ev));
    });
    moveQueued = e;
  }
  function hoverTo(nd) {
    const name = nd ? nd.name : null;
    if (name === hovered) return;
    hovered = name;
    if (renderer) renderer.domElement.style.cursor = nd ? "pointer" : "";
    if (onHover) onHover(nd);
  }

  /* ------------------------------------------------------ the network as a tree */
  /* Built once from the pipe list. A gravity sewer drains one way, so "which homes are
     behind this manhole" is a walk up the graph, not a hydraulic question. */
  let topo = null;
  function topology() {
    if (topo) return topo;
    const g = G(), n = g.nodes.length;
    const into = Array.from({ length: n }, () => []), downOf = new Array(n).fill(-1);
    for (let p = 0; p < g.nPipes; p++) {
      into[g.down[p]].push(p);
      if (downOf[g.up[p]] < 0) downOf[g.up[p]] = g.down[p];
    }
    // The first real manhole a node's sewage reaches, itself included, or -1. Half the
    // properties enter at a pipe end with no manhole on record, and without this they
    // would never belong to anything a person can click.
    const firstMh = new Array(n);
    for (let i = 0; i < n; i++) {
      let j = i, hops = 0;
      while (j >= 0 && g.nodes[j].kind !== "chamber" && hops++ <= n) j = downOf[j];
      firstMh[i] = j >= 0 && g.nodes[j].kind === "chamber" ? j : -1;
    }
    const idxOf = {};
    g.nodes.forEach((nd, i) => { idxOf[nd.name] = i; });
    topo = { into, firstMh, idxOf };
    return topo;
  }

  /* Every node and pipe whose sewage passes through any of `names`, those nodes included. */
  function upstream(names) {
    const g = G(), t = topology();
    const nodes = new Set(), pipes = new Set(), stack = [];
    names.forEach(nm => { if (nm in t.idxOf) stack.push(t.idxOf[nm]); });
    while (stack.length) {
      const i = stack.pop();
      if (nodes.has(i)) continue;
      nodes.add(i);
      t.into[i].forEach(p => { pipes.add(p); stack.push(g.up[p]); });
    }
    return { nodes, pipes };
  }

  /* What the homes layer shows. The counts come back so the legend can state them rather
     than leave a person counting dots.
       { mode: "site", name }       homes whose sewage reaches this manhole first, and homes
                                    further up that drain through it
       { mode: "sensors", names }   homes whose sewage passes any of these manholes
       null                         every home, plain */
  /* How many homes reach a manhole first, and how many of those enter at the manhole itself
     rather than at an unrecorded pipe end above it. The same rule highlight() paints by,
     without touching the map, so the side panel and the homes key cannot disagree. */
  function reach(name) {
    if (!built || !G().hn) return null;
    const g = G(), t = topology(), me = t.idxOf[name];
    if (me == null) return null;
    let here = 0, direct = 0;
    g.hn.forEach(node => { if (t.firstMh[node] === me) { here++; if (node === me) direct++; } });
    return { here, direct };
  }

  function highlight(spec) {
    if (!built || !houseGeo || !G().hn) return null;
    const g = G(), t = topology(), n = g.hn.length;
    const arr = houseColours.array, src = houseGeo.attributes.position.array;
    const hiPos = houseHi.geometry.attributes.position.array;
    const rimPos = houseRim.geometry.attributes.position.array;
    const upPos = houseUp.geometry.attributes.position.array;
    const paintHouse = (i, hex) => {
      arr[i * 3] = ((hex >> 16) & 255) / 255;
      arr[i * 3 + 1] = ((hex >> 8) & 255) / 255;
      arr[i * 3 + 2] = (hex & 255) / 255;
    };
    const copy = (dst, k, i) => {
      dst[k * 3] = src[i * 3]; dst[k * 3 + 1] = src[i * 3 + 1]; dst[k * 3 + 2] = src[i * 3 + 2];
    };
    let nHi = 0, nUp = 0, nDirect = 0, out, pipes = null;
    // A home's lateral, from the home to where it joins its main, written into slot k.
    const hiLat = latHi && latHi.geometry.attributes.position.array;
    const upLat = latUp && latUp.geometry.attributes.position.array;
    const lat = (dst, k, i) => {
      if (!dst) return;
      dst.set(src.subarray(i * 3, i * 3 + 3), k * 6);
      dst.set(houseJ.subarray(i * 3, i * 3 + 3), k * 6 + 3);
    };

    if (spec && spec.mode === "site" && spec.name in t.idxOf) {
      const me = t.idxOf[spec.name], up = upstream([spec.name]);
      pipes = up.pipes;
      for (let i = 0; i < n; i++) {
        const node = g.hn[i];
        paintHouse(i, COL.houseDim);
        if (t.firstMh[node] === me) { lat(hiLat, nHi, i); copy(hiPos, nHi++, i); if (node === me) nDirect++; }
        else if (up.nodes.has(node)) { lat(upLat, nUp, i); copy(upPos, nUp++, i); }
      }
      out = { mode: "site", here: nHi, direct: nDirect, through: nUp, elsewhere: n - nHi - nUp, total: n };
    } else if (spec && spec.mode === "sensors" && spec.names.length) {
      const up = upstream(spec.names);
      pipes = up.pipes;
      let watched = 0;
      // Counted, not drawn: big highlighted homes over the green sensors were too busy.
      // Every home is a faint dot here; the homes box still gives the count.
      for (let i = 0; i < n; i++) {
        paintHouse(i, COL.houseDim);
        if (up.nodes.has(g.hn[i])) watched++;
      }
      out = { mode: "sensors", watched, unwatched: n - watched, total: n };
    } else {
      for (let i = 0; i < n; i++) paintHouse(i, COL.house);
      out = { mode: "none", total: n };
    }
    houseColours.needsUpdate = true;
    houseHi.material.color.setHex(out.mode === "sensors" ? COL.watched : COL.houseHere);
    houseUp.material.opacity = 1;
    rimPos.set(hiPos.subarray(0, nHi * 3));             // the rim sits under every linked home
    [[houseHi, nHi], [houseRim, nHi], [houseUp, nUp]].forEach(([pts, k]) => {
      pts.geometry.setDrawRange(0, k);
      pts.geometry.attributes.position.needsUpdate = true;
      pts.frustumCulled = false;
    });
    // Laterals only for the homes lit in "site" mode; every other mode clears them, since
    // nHi and nUp are only counted there.
    [[latHi, nHi], [latUp, nUp]].forEach(([ls, k]) => {
      if (!ls) return;
      ls.geometry.setDrawRange(0, k * 2);
      ls.geometry.attributes.position.needsUpdate = true;
    });

    // Sleeves around the pipes that carry it. Coloured per instance, not once for the
    // whole mesh: a segment that is itself amber ("already surcharged, not growth") gets
    // a yellow sleeve instead of the usual cyan/green, so it never mixes toward green.
    const segPipe = pipeGeo.userData.segPipe, m = new THREE.Matrix4();
    const q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3(), mid = new THREE.Vector3(), scl = new THREE.Vector3();
    const tmpColor = new THREE.Color();
    const baseHex = spec && spec.mode === "sensors" ? COL.watched : COL.sleeve;
    let k = 0;
    if (pipes) {
      for (let s = 0; s < segPipe.length; s++) {
        if (!pipes.has(segPipe[s])) continue;
        const [a, b] = segEnds[s];
        dir.subVectors(b, a);
        const len = dir.length();
        if (len < 1e-6) continue;
        q.setFromUnitVectors(yAxis, dir.clone().divideScalar(len));
        mid.addVectors(a, b).multiplyScalar(0.5);
        scl.set(3.2, len, 3.2);
        m.compose(mid, q, scl);
        sleeves.setMatrixAt(k, m);
        const onAmber = lastPipeState && lastPipeState[segPipe[s]] === "was";
        tmpColor.setHex(onAmber ? COL.sleeveOnAmber : baseHex);
        sleeves.setColorAt(k, tmpColor);
        k++;
      }
    }
    sleeves.count = k;
    sleeves.instanceMatrix.needsUpdate = true;
    if (sleeves.instanceColor) sleeves.instanceColor.needsUpdate = true;
    out.drawn = nHi + nUp;          // highlighted homes actually on screen
    return out;
  }

  function showBottlenecks(show) {
    if (bottleneckMesh) bottleneckMesh.visible = !!show;
  }

  /* Recolour for one scenario. `state` maps a chamber name to "tip" | "was" | "ok". */
  /* Heatmap colour: one hue (the reference sequential blue), dark near 0 so a manhole that
     sees little recedes into the dark background, light near 100%. */
  const HEAT_RAMP = [0x104281, 0x184f95, 0x1c5cab, 0x256abf, 0x2a78d6, 0x3987e5,
                     0x5598e7, 0x6da7ec, 0x86b6ef, 0x9ec5f4, 0xb7d3f6, 0xcde2fb];
  function heatHex(v) {
    const x = Math.max(0, Math.min(1, v)) * (HEAT_RAMP.length - 1), i = Math.floor(x);
    if (i >= HEAT_RAMP.length - 1) return HEAT_RAMP[HEAT_RAMP.length - 1];
    const a = HEAT_RAMP[i], b = HEAT_RAMP[i + 1], f = x - i, ch = s => (h => (h >> s) & 255);
    const mix = s => Math.round(ch(s)(a) + (ch(s)(b) - ch(s)(a)) * f);
    return (mix(16) << 16) | (mix(8) << 8) | mix(0);
  }

  function paint(state, siteName, sensors, heat) {
    if (!built) return;
    const g = G();
    const nodeState = name => state[name] || "ok";
    const arr = pipeColours.array, segPipe = pipeGeo.userData.segPipe;
    // A pipe takes the worse of its two ends: a reach between a tipped chamber and a
    // healthy one is part of the problem, not half of it.
    const rank = { ok: 0, was: 1, tip: 2 };
    const pipeCol = [];
    for (let p = 0; p < g.nPipes; p++) {
      const u = g.nodes[g.up[p]], d = g.nodes[g.down[p]];
      const su = nodeState(u.name), sd = nodeState(d.name);
      pipeCol.push(rank[su] >= rank[sd] ? su : sd);
    }
    lastPipeState = pipeCol;   // read by highlight() to keep a sleeve off cyan-on-amber
    for (let s = 0; s < segPipe.length; s++) {
      // Heatmap on: pipes go neutral so the only colour on screen is the manholes' score.
      const c = heat ? COL.heatPipe : COL[pipeCol[segPipe[s]] === "tip" ? "tip"
        : pipeCol[segPipe[s]] === "was" ? "was" : "ok"];
      for (let k = 0; k < 2; k++) {
        const o = (s * 2 + k) * 3;
        arr[o] = c[0] / 255; arr[o + 1] = c[1] / 255; arr[o + 2] = c[2] / 255;
      }
      if (pipeBodies) pipeBodies.setColorAt(s, bodyTint.setRGB(c[0] / 255, c[1] / 255, c[2] / 255));
    }
    pipeColours.needsUpdate = true;
    if (pipeBodies && pipeBodies.instanceColor) pipeBodies.instanceColor.needsUpdate = true;

    const sensorSet = new Set(sensors || []);
    chamberMeshes.forEach(m => {
      const nm = m.userData.node.name;
      const st = nodeState(nm);
      const c = sensorSet.has(nm) ? COL.sensor
        : heat ? heatHex(heat[nm] || 0)
        : st === "tip" ? 0xff2d55 : st === "was" ? 0xffa500 : COL.chamber;
      m.material.color.setHex(c);
      m.scale.setScalar(sensorSet.has(nm) ? 2.1 : heat ? 0.9 + 1.4 * (heat[nm] || 0)
        : st === "ok" ? 1 : 1.6);
      if (nm === siteName) {
        focusRing.position.copy(m.position);
        focusRing.visible = true;
        siteLabel.at.copy(m.position);
        siteLabel.el.textContent = "MH " + m.userData.node.mh;
        siteLabel.el.style.display = "";
      }
    });
    if (!siteName) { focusRing.visible = false; siteLabel.el.style.display = "none"; }
  }

  /* The optional "Whole Walkerville" view: the rest of the network the whole-domain run
     solves, greyed out, and where the outside inflows join. Built on first use and kept OUT
     of the scene while hidden, because frame() sizes the view from everything in the scene. */
  function buildRegion() {
    const c = G().context;
    if (!c) return null;
    const grp = new THREE.Group(), pos = [];
    for (let p = 0; p < c.nPipes; p++) {
      const a = c.ptr[p], b = c.ptr[p + 1], n = b - a;
      for (let i = a; i < b - 1; i++) {
        const f0 = (i - a) / (n - 1), f1 = (i + 1 - a) / (n - 1);
        const v0 = P(c.px[i], c.py[i], c.zu[p] + (c.zd[p] - c.zu[p]) * f0);
        const v1 = P(c.px[i + 1], c.py[i + 1], c.zu[p] + (c.zd[p] - c.zu[p]) * f1);
        pos.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    grp.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: COL.region })));
    [true, false].forEach(into => {
      const ep = [];
      c.entries.filter(e => e.into === into).forEach(e => {
        const v = P(e.x, e.y, e.z); ep.push(v.x, v.y, v.z);
      });
      if (!ep.length) return;
      const eg = new THREE.BufferGeometry();
      eg.setAttribute("position", new THREE.Float32BufferAttribute(ep, 3));
      grp.add(new THREE.Points(eg, new THREE.PointsMaterial({
        color: into ? COL.entryIn : COL.entryOut, size: into ? 70 : 45, sizeAttenuation: true })));
    });
    return grp;
  }

  function showRegion(show) {
    if (!built) return false;
    if (show && !region) region = buildRegion();
    if (!region) return false;
    if (show) scene.add(region); else scene.remove(region);
    frame(null);
    return true;
  }

  function frame(tightOn) {
    if (!built) return;
    const box = new THREE.Box3().setFromObject(scene);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    let centre = sphere.center, span = sphere.radius * 2;
    if (tightOn) {
      const m = chamberMeshes.find(x => x.userData.node.name === tightOn);
      if (m) { centre = m.position.clone(); span = 420; }
    }
    const r = span / (2 * Math.tan((camera.fov * Math.PI / 180) / 2)) * 0.72;
    controls.target.copy(centre);
    camera.position.set(centre.x + r * 0.62, centre.y + r * 0.48, centre.z + r * 0.62);
    camera.updateProjectionMatrix();
    controls.update();
  }

  function resize(container) {
    if (!renderer || !container) return;
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return { build, paint, highlight, reach, showBottlenecks, showRegion, showPumps, setScenario,
           frame, resize, heatHex,
           ZEXAG };
})();
