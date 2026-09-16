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
  let built = false, onPick = null, focusRing = null;
  const ZEXAG = 22.0;
  const COL = {
    bg: 0xf4f1ea,
    ok: [0x9a, 0xa3, 0xad],        // grey, has room
    was: [0xe8, 0x91, 0x2d],       // amber, surcharged already
    tip: [0xe0, 0x31, 0x2b],       // red, tipped by this growth
    site: 0x2f7fd1,                // blue, where the houses go
    sensor: 0x1f6f3f,              // green, a proposed sensor
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

  async function build(container, pick) {
    await ensureThree();
    onPick = pick;
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
      window.addEventListener("resize", () => resize(container));
      (function loop() {
        requestAnimationFrame(loop);
        controls.update();
        renderer.render(scene, camera);
      })();
    }
    if (built) { resize(container); return; }
    scene.background = new THREE.Color(COL.bg);
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 0.4);
    sun.position.set(-100, 300, 200);
    scene.add(sun);

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
      }
    }
    pipeGeo = new THREE.BufferGeometry();
    pipeGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    pipeColours = new THREE.Float32BufferAttribute(col, 3);
    pipeGeo.setAttribute("color", pipeColours);
    pipeGeo.userData.segPipe = segPipe;
    scene.add(new THREE.LineSegments(pipeGeo,
      new THREE.LineBasicMaterial({ vertexColors: true })));

    // Chambers. Spheres rather than points so they can be picked and so their size means
    // something at any zoom.
    const sphere = new THREE.SphereGeometry(4.2, 12, 9);
    chamberMeshes = [];
    g.nodes.forEach((nd, i) => {
      if (nd.kind !== "chamber") return;
      const m = new THREE.Mesh(sphere, new THREE.MeshLambertMaterial({ color: 0x9aa3ad }));
      m.position.copy(P(nd.x, nd.y, nd.inv));
      m.userData = { node: nd, index: i };
      scene.add(m);
      chamberMeshes.push(m);
    });

    // A ring on the ground plus a stalk above it. One chamber among 71, in a view you can
    // orbit, is genuinely hard to find from its colour alone; the stalk is what makes the
    // growth site locatable without hunting for it.
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
  function onUp(e) {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 4 || !onPick) return;
    const r = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(chamberMeshes, false)[0];
    if (hit) onPick(hit.object.userData.node);
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
        : st === "tip" ? 0xe0312b : st === "was" ? 0xe8912d : 0x9aa3ad;
      m.material.color.setHex(typeof c === "number" ? c : 0x9aa3ad);
      m.scale.setScalar(sensorSet.has(nm) ? 1.9 : st === "ok" ? 1 : 1.45);
      if (nm === siteName) {
        focusRing.position.copy(m.position);
        focusRing.visible = true;
      }
    });
    if (!siteName) focusRing.visible = false;
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
    const r = span / (2 * Math.tan((camera.fov * Math.PI / 180) / 2)) * 0.95;
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

  return { build, paint, frame, resize, ZEXAG };
})();
