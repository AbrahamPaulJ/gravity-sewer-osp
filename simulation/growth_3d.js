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
  let built = false, onPick = null, onHover = null, focusRing = null, outletLabel = null;
  let houseGeo = null, houseColours = null, houseHi = null, houseRim = null, houseUp = null,
      sleeves = null;
  let siteLabel = null, bottleneckMesh = null, lastPipeState = null;
  const segEnds = [];               // per pipe segment, its two endpoints, for the sleeves
  const clock = { t0: performance.now() };
  const ZEXAG = 22.0;
  /* DARK, and saturated. The first version drew grey pipes and beige markers on a cream
     background and was unreadable: every state looked like every other state. On a dark
     ground a saturated colour carries, so the three pipe states separate at a glance and
     the markers stop competing with the pipes for attention. */
  const HI_MIN = 16, HI_MAX = 20, RIM = 5;   // linked-home dot sizes; RIM is the white edge
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
        if (houseUp) { houseUp.material.opacity = 0.5 + 0.35 * Math.sin(t * 3.4 + 0.7); }
        if (sleeves) sleeves.material.opacity = 0.20 + 0.22 * (0.5 + 0.5 * beat);
        renderer.render(scene, camera);
        [outletLabel, siteLabel].forEach(lbl => {
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
      houseUp = overlay(COL.houseUp, 9);
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
    scene.add(new THREE.LineSegments(pipeGeo,
      new THREE.LineBasicMaterial({ vertexColors: true })));

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
    // marker of its own rather than being one white dot among 71.
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
        lbl.textContent = "outlet, MH " + on.mh;
        labelLayer.appendChild(lbl);
        outletLabel = { el: lbl, at: P(on.x, on.y, on.inv) };
      }
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
  function onUp(e) {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 4 || !onPick) return;
    const nd = chamberAt(e);
    if (nd) onPick(nd);
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

    if (spec && spec.mode === "site" && spec.name in t.idxOf) {
      const me = t.idxOf[spec.name], up = upstream([spec.name]);
      pipes = up.pipes;
      for (let i = 0; i < n; i++) {
        const node = g.hn[i];
        paintHouse(i, COL.houseDim);
        if (t.firstMh[node] === me) { copy(hiPos, nHi++, i); if (node === me) nDirect++; }
        else if (up.nodes.has(node)) copy(upPos, nUp++, i);
      }
      out = { mode: "site", here: nHi, direct: nDirect, through: nUp, elsewhere: n - nHi - nUp, total: n };
    } else if (spec && spec.mode === "sensors" && spec.names.length) {
      const up = upstream(spec.names);
      pipes = up.pipes;
      let watched = 0;
      for (let i = 0; i < n; i++) {
        paintHouse(i, COL.house);
        if (up.nodes.has(g.hn[i])) { copy(hiPos, nHi++, i); watched++; }
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
    return out;
  }

  function showBottlenecks(show) {
    if (bottleneckMesh) bottleneckMesh.visible = !!show;
  }

  /* Recolour for one scenario. `state` maps a chamber name to "tip" | "was" | "ok". */
  function paint(state, siteName, sensors) {
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
      const c = COL[pipeCol[segPipe[s]] === "tip" ? "tip"
        : pipeCol[segPipe[s]] === "was" ? "was" : "ok"];
      for (let k = 0; k < 2; k++) {
        const o = (s * 2 + k) * 3;
        arr[o] = c[0] / 255; arr[o + 1] = c[1] / 255; arr[o + 2] = c[2] / 255;
      }
    }
    pipeColours.needsUpdate = true;

    const sensorSet = new Set(sensors || []);
    chamberMeshes.forEach(m => {
      const nm = m.userData.node.name;
      const st = nodeState(nm);
      const c = sensorSet.has(nm) ? COL.sensor
        : st === "tip" ? 0xff2d55 : st === "was" ? 0xffa500 : COL.chamber;
      m.material.color.setHex(c);
      m.scale.setScalar(sensorSet.has(nm) ? 2.1 : st === "ok" ? 1 : 1.6);
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

  return { build, paint, highlight, reach, showBottlenecks, frame, resize, ZEXAG };
})();
