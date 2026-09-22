/* growth_3d.js - the catchment above A in 3D, coloured by what growth did to it.

   157 pipes, 155 nodes, 71 of them real chambers. Pipes are drawn as lines and chambers
   as pickable markers, because choosing where the houses go is the one thing the page
   asks of a person and pointing at the map is how you do that.

   COLOUR IS THE WHOLE ARGUMENT, so it is deliberately only three states in baseline:
     grey    below the crown, room to spare
     amber   already surcharged before a single house was added
     red     TIPPED: fine before, surcharged after, and therefore caused by this growth

   Includes:
   - Wastewater flow particles & hydraulic speed animation
   - Active pump stations with 3D rotating impellers & state beacons
   - Dynamic Sensor Placement Heatmap with gradient scoring
   - Upstream tributary affecting DAG highlighting
   - Backwater surcharge & blockage visualization */
"use strict";
window.Growth3D = (function () {
  let THREE = null, OrbitControls = null, loadPromise = null;
  let renderer, scene, camera, controls, ray, pointer;
  let pipeGeo = null, pipeColours = null, chamberMeshes = [], labelLayer = null;
  let built = false, onPick = null, onHover = null, focusRing = null, outletLabel = null;
  let houseGeo = null, houseColours = null, houseHi = null, houseUp = null, sleeves = null;
  let siteLabel = null, bottleneckMesh = null, lastPipeState = null;
  const segEnds = [];               // per pipe segment, its two endpoints, for the sleeves
  const segPipe = [];               // segment index -> pipe index
  const segPhases = [];             // random phases for flow particle animation
  const clock = { t0: performance.now() };
  const ZEXAG = 22.0;

  // Flow animation state
  let flowParticles = null;
  let flowAnimActive = true;
  let flowAnimSpeed = 1.0;

  // Pump stations state
  const pumpStations = [
    { id: "PS-01", name: "MH4450193", label: "Pump Station PS-01 (Outlet)", group: null, impeller: null, beacon: null, labelObj: null, running: true, duty: 1.0 },
    { id: "LS-02", name: "MH4449118", label: "Lift Station LS-02 (Trunk)", group: null, impeller: null, beacon: null, labelObj: null, running: true, duty: 0.8 }
  ];

  // Sensor Placement Heatmap state
  let heatmapActive = false;
  let heatmapScores = {};          // chamberName -> score (0-100)
  let topRecommendations = [];     // array of top candidate chamber names
  let haloRings = [];              // 3D rings around top sensor sites
  let heatmapGroup = null;         // THREE.Group containing radial gradient planes
  let heatTexture = null;          // CanvasTexture for multi-ring radial gradient
  let rankingPins = [];            // [{ el, at, name }]

  // Blockage & Backwater state
  let activeBlockagePipe = null;
  let backwaterChambersSet = new Set();
  let backwaterPipesSet = new Set();

  const COL = {
    bg: 0x0d1117,
    ok: [0x4c, 0x8b, 0xf5],        // blue, has room
    was: [0xff, 0xa5, 0x00],       // orange, surcharged before any growth
    tip: [0xff, 0x2d, 0x55],       // hot red, tipped by this growth
    backwater: [0xff, 0x57, 0x22], // vivid orange-red for backwater surcharge
    house: 0xff6f9c,
    junction: 0x30363d,            // a pipe end the record does not call a chamber
    chamber: 0xc9d1d9,             // a real, published manhole: a candidate sensor site
    site: 0x00d4ff,                // cyan, where the new dwellings connect
    outlet: 0xa371f7,              // violet, the chamber everything drains through
    sensor: 0x3fb950,              // green, a proposed sensor
    houseDim: 0x3a2430,            // a property with nothing to do with the selection
    houseUp: 0x7dc4e0,             // drains THROUGH the selected manhole, from further up
    sleeve: 0x00d4ff,              // the pipes those homes drain through
    sleeveOnAmber: 0xffe066,
    watched: 0x3fb950,             // sewage passes a proposed sensor on its way out
    bottleneck: 0xffffff,          // the fixed set of pipes find_bottlenecks() names
    flow: 0x38bdf8                 // wastewater pulse cyan
  };

  function ensureThree() {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.race([
      (async () => {
        THREE = await import("three");
        OrbitControls = (await import("three/addons/controls/OrbitControls.js")).OrbitControls;
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout loading Three.js library from CDN. Please check your network connection.")), 10000)
      )
    ]);
    return loadPromise;
  }

  const G = () => window.GROWTH_GEOM;

  function P(xDm, yDm, zCm) {
    return new THREE.Vector3(xDm / 10, (zCm / 100) * ZEXAG, -(yDm / 10));
  }

  function getHeatmapHex(score) {
    const s = Math.max(0, Math.min(100, score || 0));
    if (s < 25) {
      // 0 - 25: deep blue to cyan (0x1e3a8a -> 0x0284c7)
      const t = s / 25;
      const r = Math.round(0x1e + t * (0x02 - 0x1e));
      const g = Math.round(0x3a + t * (0x84 - 0x3a));
      const b = Math.round(0x8a + t * (0xc7 - 0x8a));
      return (r << 16) | (g << 8) | b;
    } else if (s < 50) {
      // 25 - 50: cyan to bright green (0x0284c7 -> 0x10b981)
      const t = (s - 25) / 25;
      const r = Math.round(0x02 + t * (0x10 - 0x02));
      const g = Math.round(0x84 + t * (0xb9 - 0x84));
      const b = Math.round(0xc7 + t * (0x81 - 0xc7));
      return (r << 16) | (g << 8) | b;
    } else if (s < 75) {
      // 50 - 75: green to amber (0x10b981 -> 0xf59e0b)
      const t = (s - 50) / 25;
      const r = Math.round(0x10 + t * (0xf5 - 0x10));
      const g = Math.round(0xb9 + t * (0x9e - 0xb9));
      const b = Math.round(0x81 + t * (0x0b - 0x81));
      return (r << 16) | (g << 8) | b;
    } else {
      // 75 - 100: amber to bright hot neon red (0xf59e0b -> 0xff0055)
      const t = (s - 75) / 25;
      const r = Math.round(0xf5 + t * (0xff - 0xf5));
      const g = Math.round(0x9e + t * (0x00 - 0x9e));
      const b = Math.round(0x0b + t * (0x55 - 0x0b));
      return (r << 16) | (g << 8) | b;
    }
  }

  function getHeatTexture() {
    if (heatTexture) return heatTexture;
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    // Concentric multi-ring gradient matching user's reference image (media_1790071173730.png)
    grad.addColorStop(0.00, "rgba(239, 68, 68, 0.88)");   // Red/coral core (critical priority)
    grad.addColorStop(0.20, "rgba(245, 158, 11, 0.76)");  // Amber ring (high priority)
    grad.addColorStop(0.45, "rgba(74, 222, 128, 0.60)");  // Lime/green ring (moderate priority)
    grad.addColorStop(0.70, "rgba(56, 189, 248, 0.44)");  // Cyan/sky-blue ring (low priority)
    grad.addColorStop(0.88, "rgba(71, 85, 105, 0.22)");  // Translucent dark slate outer boundary
    grad.addColorStop(1.00, "rgba(13, 17, 23, 0.00)");   // Completely transparent falloff
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    heatTexture = new THREE.CanvasTexture(canvas);
    return heatTexture;
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
      controls.screenSpacePanning = true;
      controls.panSpeed = 1.25;
      controls.enablePan = true;
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      };
      controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN
      };
      renderer.domElement.addEventListener("pointerdown", onDown);
      renderer.domElement.addEventListener("pointerup", onUp);
      renderer.domElement.addEventListener("pointermove", onMove);
      renderer.domElement.addEventListener("pointerleave", () => hoverTo(null));
      window.addEventListener("resize", () => resize(container));
      (function loop() {
        requestAnimationFrame(loop);
        controls.update();

        const t = (performance.now() - clock.t0) / 1000, beat = Math.sin(t * 3.4);
        if (houseHi) { houseHi.material.opacity = 0.55 + 0.45 * beat; houseHi.material.size = 13 + 3.5 * beat; }
        if (houseUp) { houseUp.material.opacity = 0.5 + 0.35 * Math.sin(t * 3.4 + 0.7); }
        if (sleeves) sleeves.material.opacity = 0.20 + 0.22 * (0.5 + 0.5 * beat);

        // Animate wastewater flow particles along pipes
        if (flowAnimActive && flowParticles && flowParticles.visible) {
          const tSec = t * flowAnimSpeed;
          const pArr = flowParticles.geometry.attributes.position.array;
          for (let s = 0; s < segEnds.length; s++) {
            const [a, b] = segEnds[s];
            const pIdx = segPipe[s];
            const pipeSlope = Math.max(0.002, Math.abs(g.zu[pIdx] - g.zd[pIdx]) / 1000);
            const speed = (0.7 + Math.sqrt(pipeSlope) * 4.2) * flowAnimSpeed;
            const u = (tSec * speed * 0.38 + segPhases[s]) % 1.0;
            const idx = s * 3;
            pArr[idx] = a.x + (b.x - a.x) * u;
            pArr[idx + 1] = a.y + (b.y - a.y) * u + 0.4;
            pArr[idx + 2] = a.z + (b.z - a.z) * u;
          }
          flowParticles.geometry.attributes.position.needsUpdate = true;
        }

        // Animate pump station impellers & status beacons
        pumpStations.forEach(ps => {
          if (ps.impeller && ps.running) {
            ps.impeller.rotation.y += 0.09 * (ps.duty || 1.0);
          }
          if (ps.beacon) {
            const pBeat = Math.sin(t * 4.5);
            ps.beacon.material.opacity = 0.7 + 0.3 * pBeat;
          }
        });

        // Animate heatmap halo rings
        haloRings.forEach((hRing, idx) => {
          if (hRing.visible) {
            const hBeat = Math.sin(t * 3.0 + idx * 1.2);
            hRing.scale.setScalar(1.0 + 0.25 * hBeat);
            hRing.material.opacity = 0.5 + 0.4 * hBeat;
          }
        });

        renderer.render(scene, camera);

        // Project HTML labels
        const allLabels = [outletLabel, siteLabel].concat(pumpStations.map(p => p.labelObj)).filter(Boolean);
        allLabels.forEach(lbl => {
          if (!lbl || !lbl.el) return;
          const v = lbl.at.clone().project(camera);
          const el = renderer.domElement;
          lbl.el.style.display = v.z < 1 ? "block" : "none";
          lbl.el.style.left = ((v.x * 0.5 + 0.5) * el.clientWidth) + "px";
          lbl.el.style.top = ((-v.y * 0.5 + 0.5) * el.clientHeight) + "px";
        });

        // Project numbered ranking teardrop pins on heatmap
        rankingPins.forEach(pin => {
          if (!pin || !pin.el) return;
          const v = pin.at.clone().project(camera);
          const el = renderer.domElement;
          if (v.z < 1) {
            pin.el.style.display = "block";
            pin.el.style.left = ((v.x * 0.5 + 0.5) * el.clientWidth) + "px";
            pin.el.style.top = ((-v.y * 0.5 + 0.5) * el.clientHeight) + "px";
          } else {
            pin.el.style.display = "none";
          }
        });
      })();
    }
    if (built) { resize(container); return; }
    scene.background = new THREE.Color(COL.bg);
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 0.45);
    sun.position.set(-100, 300, 200);
    scene.add(sun);

    // Properties layer
    if (g.hx && g.hx.length) {
      const hp = [];
      for (let i = 0; i < g.hx.length; i++) {
        const v = P(g.hx[i], g.hy[i], (g.hz ? g.hz[i] : 0) + 200);
        hp.push(v.x, v.y, v.z);
      }
      houseGeo = new THREE.BufferGeometry();
      houseGeo.setAttribute("position", new THREE.Float32BufferAttribute(hp, 3));
      houseColours = new THREE.Float32BufferAttribute(new Float32Array(hp.length), 3);
      houseGeo.setAttribute("color", houseColours);
      scene.add(new THREE.Points(houseGeo, new THREE.PointsMaterial({
        size: 4.5, sizeAttenuation: true, vertexColors: true,
        transparent: true, opacity: 0.9 })));
      const overlay = (col, size) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(hp), 3));
        geo.setDrawRange(0, 0);
        const pts = new THREE.Points(geo, new THREE.PointsMaterial({
          color: col, size, sizeAttenuation: true, transparent: true, opacity: 1 }));
        pts.renderOrder = 2;
        scene.add(pts);
        return pts;
      };
      houseUp = overlay(COL.houseUp, 9);
      houseHi = overlay(COL.site, 13);
    }

    // Unrecorded pipe ends / junctions
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

    // LineSegments for every pipe
    const pos = [], col = [];
    segEnds.length = 0; segPipe.length = 0; segPhases.length = 0;
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
        segPhases.push(Math.random());
      }
    }
    pipeGeo = new THREE.BufferGeometry();
    pipeGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    pipeColours = new THREE.Float32BufferAttribute(col, 3);
    pipeGeo.setAttribute("color", pipeColours);
    pipeGeo.userData.segPipe = segPipe;
    scene.add(new THREE.LineSegments(pipeGeo,
      new THREE.LineBasicMaterial({ vertexColors: true })));

    // Wastewater flow particle system
    const flowPositions = new Float32Array(segEnds.length * 3);
    for (let s = 0; s < segEnds.length; s++) {
      const [v0] = segEnds[s];
      flowPositions[s * 3] = v0.x;
      flowPositions[s * 3 + 1] = v0.y + 0.3;
      flowPositions[s * 3 + 2] = v0.z;
    }
    const flowGeo = new THREE.BufferGeometry();
    flowGeo.setAttribute("position", new THREE.Float32BufferAttribute(flowPositions, 3));
    flowParticles = new THREE.Points(flowGeo, new THREE.PointsMaterial({
      color: COL.flow, size: 5.5, sizeAttenuation: true, transparent: true, opacity: 0.9 }));
    flowParticles.visible = true;
    flowParticles.renderOrder = 3;
    scene.add(flowParticles);

    // Pipe sleeves (highlight tubes)
    sleeves = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true,
        opacity: 0.28, depthWrite: false }), Math.max(1, segEnds.length));
    sleeves.count = 0;
    sleeves.renderOrder = 1;
    sleeves.frustumCulled = false;
    scene.add(sleeves);

    // Bottlenecks highlight
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

    // Chambers (spheres)
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

    // Outlet indicator
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

    // Focus ring and growth site label
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

    // Multi-Ring Radial Gradient Heatmap Overlay Layer
    heatmapGroup = new THREE.Group();
    heatmapGroup.visible = false;
    scene.add(heatmapGroup);

    // Top 3 Heatmap Halo Rings
    haloRings = [];
    for (let h = 0; h < 3; h++) {
      const hMat = new THREE.MeshBasicMaterial({
        color: 0xff0055, transparent: true, opacity: 0.7, depthWrite: false
      });
      const hMesh = new THREE.Mesh(new THREE.TorusGeometry(16, 2.2, 8, 32), hMat);
      hMesh.rotation.x = Math.PI / 2;
      hMesh.visible = false;
      scene.add(hMesh);
      haloRings.push(hMesh);
    }

    // Build 3D Pump Stations
    pumpStations.forEach(ps => {
      const node = g.nodes.find(n => n.name === ps.name);
      if (!node) return;
      const grp = new THREE.Group();
      grp.position.copy(P(node.x, node.y, node.inv));

      // Station outer base
      const baseMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(14, 16, 8, 16),
        new THREE.MeshBasicMaterial({ color: 0x1e293b })
      );
      baseMesh.position.y = 4;
      grp.add(baseMesh);

      // Rotating Impeller Ring
      const impGeo = new THREE.TorusGeometry(10, 1.8, 6, 16);
      const impMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      const impeller = new THREE.Mesh(impGeo, impMat);
      impeller.rotation.x = Math.PI / 2;
      impeller.position.y = 9;
      grp.add(impeller);
      ps.impeller = impeller;

      // Status Beacon Light
      const beaconGeo = new THREE.SphereGeometry(3.6, 12, 8);
      const beaconMat = new THREE.MeshBasicMaterial({
        color: 0x22c55e, transparent: true, opacity: 0.9
      });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.y = 17;
      grp.add(beacon);
      ps.beacon = beacon;

      scene.add(grp);
      ps.group = grp;

      // Label
      const pLbl = document.createElement("div");
      pLbl.className = "lbl site";
      pLbl.style.color = "#38bdf8";
      pLbl.style.fontWeight = "700";
      pLbl.textContent = ps.id;
      labelLayer.appendChild(pLbl);
      ps.labelObj = { el: pLbl, at: P(node.x, node.y, node.inv) };
    });

    built = true;
    frame();
    resize(container);
  }

  let downAt = null;
  let isSpacePressed = false;
  let isPanLocked = false;
  let isDraggingPan = false;

  function isTyping(e) {
    const t = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
    return t === "input" || t === "select" || t === "textarea" || (e.target && e.target.isContentEditable);
  }

  function updatePanMode() {
    const active = isSpacePressed || isPanLocked;
    if (controls) {
      controls.mouseButtons.LEFT = active ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    }
    const stage = document.getElementById("stage");
    const panHint = document.getElementById("panHint");
    const btnPan = document.getElementById("togglePan");

    if (stage) {
      if (active) {
        stage.classList.add("pan-active");
        if (isDraggingPan) stage.classList.add("panning");
        else stage.classList.remove("panning");
      } else {
        stage.classList.remove("pan-active", "panning");
      }
    }
    if (panHint) {
      panHint.classList.toggle("active", active);
      if (active) {
        panHint.innerHTML = '<span class="pan-badge" style="color:var(--accent);font-weight:600">✋ PAN ACTIVE</span> Drag mouse or use <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> / <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to move';
      } else {
        panHint.innerHTML = '<span class="pan-badge"><kbd>Space</kbd> + Drag</span> or <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> to pan freely';
      }
    }
    if (btnPan) {
      btnPan.classList.toggle("primary", active);
      btnPan.textContent = isPanLocked ? "Pan: LOCKED (Click to Rotate)" : (isSpacePressed ? "Pan: ACTIVE [Space]" : "Pan: Hold [Space]");
    }
  }

  function togglePanMode(forced) {
    isPanLocked = forced !== undefined ? !!forced : !isPanLocked;
    updatePanMode();
    return isPanLocked;
  }

  function panByKeys(key) {
    if (!camera || !controls) return;
    const dist = camera.position.distanceTo(controls.target);
    const step = Math.max(8, dist * 0.045);

    // Compute right vector (screen X axis in world coordinates)
    const right = new THREE.Vector3();
    camera.getWorldDirection(right);
    right.cross(camera.up).normalize();

    // Compute up vector (screen Y axis in world coordinates)
    const up = new THREE.Vector3();
    up.copy(camera.up).normalize();

    const delta = new THREE.Vector3();
    if (key === "ArrowLeft" || key === "a" || key === "A") {
      delta.addScaledVector(right, -step);
    } else if (key === "ArrowRight" || key === "d" || key === "D") {
      delta.addScaledVector(right, step);
    } else if (key === "ArrowUp" || key === "w" || key === "W") {
      delta.addScaledVector(up, step);
    } else if (key === "ArrowDown" || key === "s" || key === "S") {
      delta.addScaledVector(up, -step);
    }

    if (delta.lengthSq() > 0) {
      camera.position.add(delta);
      controls.target.add(delta);
      controls.update();
    }
  }

  window.addEventListener("keydown", (e) => {
    if (isTyping(e)) return;

    if (e.code === "Space" || e.key === " ") {
      if (!isSpacePressed) {
        isSpacePressed = true;
        updatePanMode();
      }
      e.preventDefault();
      return;
    }

    const isArrow = e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown";
    const isWASD = e.key === "w" || e.key === "W" || e.key === "a" || e.key === "A" ||
                   e.key === "s" || e.key === "S" || e.key === "d" || e.key === "D";

    if (isArrow || isWASD) {
      panByKeys(e.key);
      e.preventDefault();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "Space" || e.key === " ") {
      if (isSpacePressed) {
        isSpacePressed = false;
        isDraggingPan = false;
        updatePanMode();
      }
      e.preventDefault();
    }
  });

  window.addEventListener("blur", () => {
    if (isSpacePressed) {
      isSpacePressed = false;
      isDraggingPan = false;
      updatePanMode();
    }
  });

  function onDown(e) {
    downAt = { x: e.clientX, y: e.clientY };
    if (isSpacePressed || isPanLocked) {
      isDraggingPan = true;
      updatePanMode();
    }
  }

  function chamberAt(e) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(chamberMeshes, false)[0];
    return hit ? hit.object.userData.node : null;
  }

  function onUp(e) {
    if (isDraggingPan) {
      isDraggingPan = false;
      updatePanMode();
    }
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 4 || !onPick || isSpacePressed || isPanLocked) return;
    const nd = chamberAt(e);
    if (nd) onPick(nd);
  }

  let hovered = null, moveQueued = null;
  function onMove(e) {
    if (isSpacePressed || isPanLocked) return;
    if (e.pointerType !== "mouse" || !onHover || !built) return;
    if (e.buttons) { hoverTo(null); return; }
    if (!moveQueued) requestAnimationFrame(() => {
      const ev = moveQueued; moveQueued = null;
      if (ev) hoverTo(chamberAt(ev));
    });
    moveQueued = e;
  }

  function hoverTo(nd) {
    if (isSpacePressed || isPanLocked) return;
    const name = nd ? nd.name : null;
    if (name === hovered) return;
    hovered = name;
    if (renderer) renderer.domElement.style.cursor = nd ? "pointer" : "";
    if (onHover) onHover(nd);
  }

  let topo = null;
  function topology() {
    if (topo) return topo;
    const g = G(), n = g.nodes.length;
    const into = Array.from({ length: n }, () => []), downOf = new Array(n).fill(-1);
    for (let p = 0; p < g.nPipes; p++) {
      into[g.down[p]].push(p);
      if (downOf[g.up[p]] < 0) downOf[g.up[p]] = g.down[p];
    }
    const firstMh = new Array(n);
    for (let i = 0; i < n; i++) {
      let j = i, hops = 0;
      while (j >= 0 && g.nodes[j].kind !== "chamber" && hops++ <= n) j = downOf[j];
      firstMh[i] = j >= 0 && g.nodes[j].kind === "chamber" ? j : -1;
    }
    const idxOf = {};
    g.nodes.forEach((nd, i) => { idxOf[nd.name] = i; });
    topo = { into, firstMh, idxOf, downOf };
    return topo;
  }

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

  /* Compute comprehensive metrics for all areas that affect a node */
  function getUpstreamMetrics(name) {
    const g = G(), t = topology();
    if (!g || !(name in t.idxOf)) return null;
    const up = upstream([name]);
    let totalLengthM = 0;
    for (const p of up.pipes) {
      const a = g.ptr[p], b = g.ptr[p + 1];
      let lenDm = 0;
      for (let i = a; i < b - 1; i++) {
        lenDm += Math.hypot(g.px[i + 1] - g.px[i], g.py[i + 1] - g.py[i]);
      }
      totalLengthM += lenDm * 0.1;
    }
    let homesCount = 0;
    if (g.hn) {
      for (let i = 0; i < g.hn.length; i++) {
        if (up.nodes.has(g.hn[i])) homesCount++;
      }
    }
    const targetIdx = t.idxOf[name];
    let directHomes = 0;
    if (g.hn) {
      for (let i = 0; i < g.hn.length; i++) {
        if (t.firstMh[g.hn[i]] === targetIdx) directHomes++;
      }
    }
    const qDry = homesCount * 500 * 2 / 86400; // 500 L/day, PF=2
    const upstreamChambers = [];
    up.nodes.forEach(ndIdx => {
      if (g.nodes[ndIdx].kind === "chamber" && ndIdx !== targetIdx) {
        upstreamChambers.push(g.nodes[ndIdx].name);
      }
    });

    return {
      nodeName: name,
      pipesCount: up.pipes.size,
      totalLengthM: Math.round(totalLengthM * 10) / 10,
      homesCount,
      directHomes,
      upstreamChambersCount: upstreamChambers.length,
      upstreamChambers,
      estimatedDryFlowLps: Math.round(qDry * 100) / 100
    };
  }

  function highlight(spec) {
    if (!built || !houseGeo || !G().hn) return null;
    const g = G(), t = topology(), n = g.hn.length;
    const arr = houseColours.array, src = houseGeo.attributes.position.array;
    const hiPos = houseHi.geometry.attributes.position.array;
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
      out = { mode: "site", here: nHi, direct: nDirect, through: nUp, elsewhere: n - nHi - nUp, total: n, pipesCount: up.pipes.size };
    } else if (spec && spec.mode === "sensors" && spec.names.length) {
      const up = upstream(spec.names);
      pipes = up.pipes;
      let watched = 0;
      for (let i = 0; i < n; i++) {
        paintHouse(i, COL.house);
        if (up.nodes.has(g.hn[i])) { copy(hiPos, nHi++, i); watched++; }
      }
      out = { mode: "sensors", watched, unwatched: n - watched, total: n, pipesCount: up.pipes.size };
    } else {
      for (let i = 0; i < n; i++) paintHouse(i, COL.house);
      out = { mode: "none", total: n };
    }
    houseColours.needsUpdate = true;
    houseHi.material.color.setHex(out.mode === "sensors" ? COL.watched : COL.site);
    houseHi.material.size = 13; houseUp.material.opacity = 1; houseHi.material.opacity = 1;
    [[houseHi, nHi], [houseUp, nUp]].forEach(([pts, k]) => {
      pts.geometry.setDrawRange(0, k);
      pts.geometry.attributes.position.needsUpdate = true;
      pts.frustumCulled = false;
    });

    // Sleeves around the pipes that carry it
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
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
        scl.set(3.4, len, 3.4);
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

  function setFlowAnimation(active, speed) {
    flowAnimActive = !!active;
    if (speed != null) flowAnimSpeed = Math.max(0.2, Math.min(5.0, speed));
    if (flowParticles) flowParticles.visible = flowAnimActive;
  }

  function setHeatmap(active, scoresMap, topRankedList) {
    heatmapActive = !!active;
    heatmapScores = scoresMap || {};
    const rankedArr = topRankedList || [];
    topRecommendations = rankedArr.map(item => typeof item === "string" ? item : item.name);

    if (!built) return;
    const g = G();
    if (!g) return;

    if (heatmapActive && heatmapGroup) {
      heatmapGroup.visible = true;
      // Rebuild multi-ring gradient overlay planes
      while (heatmapGroup.children.length) {
        const c = heatmapGroup.children.pop();
        if (c.geometry) c.geometry.dispose();
      }

      const tex = getHeatTexture();
      if (tex) {
        g.nodes.forEach(nd => {
          if (nd.kind !== "chamber") return;
          const sc = heatmapScores[nd.name] || 0;
          if (sc < 15) return;

          const planeGeo = new THREE.PlaneGeometry(1, 1);
          const planeMat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            opacity: 0.82,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide
          });
          const mesh = new THREE.Mesh(planeGeo, planeMat);
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.copy(P(nd.x, nd.y, nd.inv));
          mesh.position.y += 1.8; // hover slightly above pipes and terrain
          const diam = 45 + (sc / 100) * 115;
          mesh.scale.set(diam, diam, 1);
          mesh.renderOrder = 2;
          heatmapGroup.add(mesh);
        });
      }

      // Update numbered teardrop pins in labelLayer
      rankingPins.forEach(p => { if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el); });
      rankingPins.length = 0;

      if (labelLayer) {
        rankedArr.slice(0, 5).forEach((item, r) => {
          const name = typeof item === "string" ? item : item.name;
          const mh = typeof item === "object" && item.mh ? item.mh : name.replace(/^MH/, "");
          const sc = typeof item === "object" && item.score != null ? item.score : (heatmapScores[name] || 0);
          const rankNum = typeof item === "object" && item.rank != null ? item.rank : (r + 1);
          const node = g.nodes.find(n => n.name === name);
          if (!node) return;

          const pin = document.createElement("div");
          pin.className = "pin-marker";
          pin.innerHTML =
            '<svg width="30" height="38" viewBox="0 0 32 42" class="pin-badge">' +
              '<path d="M16 0C7.16 0 0 7.16 0 16c0 10.5 16 26 16 26s16-15.5 16-26c0-8.84-7.16-16-16-16z" fill="#0288d1" stroke="#ffffff" stroke-width="1.8"/>' +
              '<circle cx="16" cy="15" r="9" fill="#ffffff"/>' +
              '<text x="16" y="19.5" text-anchor="middle" font-size="12" font-weight="800" font-family="system-ui, -apple-system, sans-serif" fill="#0288d1">' + rankNum + '</text>' +
            '</svg>' +
            '<div class="pin-tooltip">#' + rankNum + ' MH ' + mh + '<br><b>' + sc + ' pts</b> &bull; Click to inspect</div>';
          pin.onclick = (e) => {
            e.stopPropagation();
            if (onPick) onPick(node);
          };
          pin.onmouseenter = () => {
            if (onHover) onHover(node);
          };
          labelLayer.appendChild(pin);
          rankingPins.push({ el: pin, at: P(node.x, node.y, node.inv), name });
        });
      }
    } else {
      if (heatmapGroup) heatmapGroup.visible = false;
      rankingPins.forEach(p => { if (p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el); });
      rankingPins.length = 0;
    }
  }

  function setBlockage(pipeIdx, severity, backwaterChambers, backwaterPipes) {
    activeBlockagePipe = pipeIdx;
    backwaterChambersSet = new Set(backwaterChambers || []);
    backwaterPipesSet = new Set(backwaterPipes || []);
  }

  function setPumpStationState(stationId, isRunning, duty) {
    const ps = pumpStations.find(p => p.id === stationId);
    if (!ps) return;
    ps.running = isRunning !== false;
    if (duty != null) ps.duty = duty;
    if (ps.beacon) {
      ps.beacon.material.color.setHex(ps.running ? 0x22c55e : 0xf59e0b);
    }
  }

  /* Recolour for one scenario. `state` maps a chamber name to "tip" | "was" | "ok". */
  function paint(state, siteName, sensors) {
    if (!built) return;
    const g = G();
    const nodeState = name => state[name] || "ok";
    const arr = pipeColours.array;
    const rank = { ok: 0, was: 1, tip: 2 };
    const pipeCol = [];
    for (let p = 0; p < g.nPipes; p++) {
      const u = g.nodes[g.up[p]], d = g.nodes[g.down[p]];
      const su = nodeState(u.name), sd = nodeState(d.name);
      pipeCol.push(rank[su] >= rank[sd] ? su : sd);
    }
    lastPipeState = pipeCol;

    for (let s = 0; s < segPipe.length; s++) {
      const pIdx = segPipe[s];
      let c;
      if (pIdx === activeBlockagePipe) {
        c = [0xff, 0x00, 0x55]; // active blockage choke pipe
      } else if (backwaterPipesSet.has(pIdx)) {
        c = COL.backwater;
      } else {
        c = COL[pipeCol[pIdx] === "tip" ? "tip" : pipeCol[pIdx] === "was" ? "was" : "ok"];
      }
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

      if (heatmapActive && nm in heatmapScores) {
        // Render Heatmap Gradient
        const score = heatmapScores[nm];
        const hex = getHeatmapHex(score);
        m.material.color.setHex(hex);
        const isTop = topRecommendations.includes(nm);
        m.scale.setScalar(isTop ? 2.4 : 1.0 + (score / 100) * 0.9);
      } else if (backwaterChambersSet.has(nm)) {
        // Backwater Surcharged Chamber
        m.material.color.setHex(0xff5722);
        m.scale.setScalar(2.0);
      } else {
        // Standard View
        const c = sensorSet.has(nm) ? COL.sensor
          : st === "tip" ? 0xff2d55 : st === "was" ? 0xffa500 : COL.chamber;
        m.material.color.setHex(c);
        m.scale.setScalar(sensorSet.has(nm) ? 2.1 : st === "ok" ? 1 : 1.6);
      }

      if (nm === siteName) {
        focusRing.position.copy(m.position);
        focusRing.visible = true;
        siteLabel.at.copy(m.position);
        siteLabel.el.textContent = "MH " + m.userData.node.mh;
        siteLabel.el.style.display = "";
      }
    });

    // Update Top 3 Halo Rings
    haloRings.forEach(r => { r.visible = false; });
    if (heatmapActive && topRecommendations.length) {
      topRecommendations.forEach((tName, i) => {
        if (i >= haloRings.length) return;
        const mesh = chamberMeshes.find(cm => cm.userData.node.name === tName);
        if (mesh) {
          haloRings[i].position.copy(mesh.position);
          haloRings[i].visible = true;
        }
      });
    }

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

  return {
    build, paint, highlight, showBottlenecks, frame, resize,
    setFlowAnimation, setHeatmap, setBlockage, setPumpStationState,
    getUpstreamMetrics, topology, togglePanMode, panByKeys, ZEXAG
  };
})();
