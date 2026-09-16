/* sim_overview.js - the whole network in 3D, for context. No water, no results.

   The simulation models four pipes. This shows where those four sit among the 998 that
   the council republishes, because "we modelled a junction" means very little until you
   can see how small a junction is against the thing it is a sample of.

   Elevation is the pipe invert, exaggerated, so the network reads as a drainage tree
   falling towards its outfall rather than as a flat street map. The exaggeration is
   stated on screen for the same reason it is in the main view: without saying so, an
   exaggerated fall looks like a measurement.

   Upstream is resolved by network.Network at build time, not here. START_INVE is
   flow-anchored rather than geometric (assumption A3), and getting that backwards would
   silently reverse most of the network while leaving every count identical. */
"use strict";
window.SimOverview = (function () {
  let THREE = null, OrbitControls = null, loadPromise = null;
  let renderer, scene, camera, controls, built = false, raf = 0, focusPoint = null;
  // 32 m of fall across 3.3 km is a 1% grade. At the main view's x8 it renders as a
  // flat street map, which wastes the third dimension. x35 makes the drainage tree
  // read as a tree. Stated on screen, because at this factor it has to be.
  const ZEXAG = 35.0;
  const COL = { bg: 0xf4f1ea, pipe: 0x9aa3ad, study: 0xe0312b, halo: 0xe8912d };

  function ensureThree() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      THREE = await import("three");
      OrbitControls = (await import("three/addons/controls/OrbitControls.js")).OrbitControls;
    })();
    return loadPromise;
  }

  async function build(container) {
    if (built) { resize(container); return; }
    await ensureThree();
    const ov = SIM_INDEX.overview;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    scene = new THREE.Scene();
    scene.background = new THREE.Color(COL.bg);
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000000);
    container.innerHTML = "";
    container.appendChild(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Plan is in decimetres and elevation in centimetres, both relative to the payload's
    // own origin. Convert back to metres here so the exaggeration factor means what it says.
    const P = (i) => new THREE.Vector3(ov.px[i] / 10, 0, -(ov.py[i] / 10));
    const studySet = new Set(ov.study);

    const bulk = [], focus = [];
    for (let p = 0; p < ov.nPipes; p++) {
      const a = ov.ptr[p], b = ov.ptr[p + 1];
      const n = b - a;
      if (n < 2) continue;
      const zUp = ov.zu[p] / 100, zDn = ov.zd[p] / 100;
      const target = studySet.has(p) ? focus : bulk;
      // Invert falls linearly along the pipe (assumption A8: no intermediate levels exist).
      for (let i = a; i < b - 1; i++) {
        const f0 = (i - a) / (n - 1), f1 = (i + 1 - a) / (n - 1);
        const v0 = P(i), v1 = P(i + 1);
        v0.y = (zUp + (zDn - zUp) * f0) * ZEXAG;
        v1.y = (zUp + (zDn - zUp) * f1) * ZEXAG;
        target.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z);
      }
    }

    const lines = (arr, colour, width, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      const m = new THREE.LineBasicMaterial({ color: colour, linewidth: width,
        transparent: opacity < 1, opacity: opacity });
      const o = new THREE.LineSegments(g, m);
      scene.add(o);
      return o;
    };
    lines(bulk, COL.pipe, 1, 0.8);
    // LineBasicMaterial.linewidth is ignored by WebGL on essentially every platform, so
    // the four studied pipes are drawn as tubes. They are the whole point of the view and
    // must not be a hairline among 998 other hairlines.
    for (let i = 0; i + 5 < focus.length; i += 6) {
      const a = new THREE.Vector3(focus[i], focus[i + 1], focus[i + 2]);
      const b = new THREE.Vector3(focus[i + 3], focus[i + 4], focus[i + 5]);
      if (a.distanceTo(b) < 1e-6) continue;
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, 6, 8, false),
        new THREE.MeshBasicMaterial({ color: COL.study }));
      scene.add(tube);
    }

    // A marker at the studied junction, because four pipes among 998 are otherwise
    // genuinely hard to find even when they are drawn in red.
    const c = new THREE.Vector3();
    let nf = 0;
    for (let i = 0; i < focus.length; i += 3) {
      c.x += focus[i]; c.y += focus[i + 1]; c.z += focus[i + 2]; nf++;
    }
    if (nf) {
      c.divideScalar(nf);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(70, 3.5, 8, 48),
        new THREE.MeshBasicMaterial({ color: COL.halo }));
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(c);
      scene.add(ring);
      const stalk = new THREE.Mesh(
        new THREE.CylinderGeometry(1.6, 1.6, 420, 8),
        new THREE.MeshBasicMaterial({ color: COL.halo, transparent: true, opacity: 0.55 }));
      stalk.position.set(c.x, c.y + 210, c.z);
      scene.add(stalk);
      focusPoint = c.clone();
    }

    frame(false);
    built = true;
    resize(container);
    (function loop() {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    })();
    window.addEventListener("resize", () => resize(container));
  }

  /* Two camera positions: the whole network, or tight on the studied junction. Being able
     to go back and forth is the entire point of the tab. */
  function frame(tight) {
    if (!camera) return;
    const box = new THREE.Box3().setFromObject(scene);
    const centre = tight && focusPoint ? focusPoint.clone() : box.getCenter(new THREE.Vector3());
    // Fit on the bounding SPHERE, not the plan extent. Exaggerating elevation makes the
    // scene tall, and a fit that only looked at x and z pushed it off the top of the view.
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const span = tight ? 620 : sphere.radius * 2;
    const r = span / (2 * Math.tan((camera.fov * Math.PI / 180) / 2)) * 0.92;
    controls.target.copy(centre);
    // Deliberately low. Looking down at 50 degrees turns this into a street map and the
    // exaggerated fall, which is the only reason it is in 3D at all, stops reading.
    camera.position.set(centre.x + r * 0.62, centre.y + r * 0.45, centre.z + r * 0.62);
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

  return { build, resize, frame, ZEXAG };
})();
