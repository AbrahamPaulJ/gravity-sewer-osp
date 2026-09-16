/* Optional 3D relief view for the OSP sandbox. Loads three.js lazily from the CDN import
   map declared in osp_sandbox.html, so a browser that never opens the 3D tab never fetches it.
   Elevation (pipe invert) becomes screen height, exaggerated, so upstream/downstream reads as
   visible rise and fall. Colours mirror the 2D canvas: coverage level, or the elevation/depth
   ramp, so switching views never contradicts what the 2D map just showed. */
"use strict";
window.OSP3D = (function () {
  let THREE = null, OrbitControls = null;
  let renderer = null, scene = null, camera = null, controls = null;
  let edgeLines = null, sensorMarkers = null, anchorMarker = null, groundMesh = null;
  let loadPromise = null;

  function ensureThree() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      THREE = await import("three");
      const mod = await import("three/addons/controls/OrbitControls.js");
      OrbitControls = mod.OrbitControls;
    })();
    return loadPromise;
  }

  function initScene(container) {
    if (renderer) return;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 100000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    container.innerHTML = "";
    container.appendChild(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    (function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
  }

  /* Same three-level palette as the 2D canvas: not observable, observable, covered. */
  function levelColour(lvl) {
    return lvl === 2 ? [56, 189, 248] : lvl === 1 ? [29, 78, 216] : [58, 71, 97];
  }

  /* Multi-stop ramps, shared in spirit with the 2D canvas's continuous colour-by modes,
     with enough stops that a small elevation change is a visibly different colour rather
     than a blur in the middle of a two-colour gradient. */
  const ELEV_STOPS = [[0, [37, 99, 235]], [0.33, [45, 212, 191]], [0.66, [250, 204, 21]], [1, [220, 38, 38]]];
  const DEPTH_STOPS = [[0, [186, 230, 253]], [0.5, [59, 130, 246]], [1, [190, 24, 93]]];
  function rampN(t, stops) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
      if (t <= t1) {
        const f = (t - t0) / Math.max(1e-6, t1 - t0);
        return [0, 1, 2].map(k => Math.round(c0[k] + (c1[k] - c0[k]) * f));
      }
    }
    return stops[stops.length - 1][1];
  }

  function build(G, S, opts) {
    if (!renderer) return;
    const exagg = opts.exaggeration || 1;

    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (let i = 0; i < G.n; i++) {
      if (G.x[i] < minx) minx = G.x[i]; if (G.x[i] > maxx) maxx = G.x[i];
      if (G.y[i] < miny) miny = G.y[i]; if (G.y[i] > maxy) maxy = G.y[i];
    }
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    let minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < G.n; i++) { if (G.inv[i] < minz) minz = G.inv[i]; if (G.inv[i] > maxz) maxz = G.inv[i]; }
    const cz = (minz + maxz) / 2;
    // The 2D canvas flips world Y so north reads as "up" on screen (screenY = oy - worldY*scale).
    // Three.js's Z axis has no such flip by default, so leaving world Y unflipped here mirrors
    // north/south against the 2D view. Negating it lines the two views up, regardless of where
    // the camera is orbited to; orbiting can never fix a mirror, only a sign flip here can.
    const pos = i => [G.x[i] - cx, (G.inv[i] - cz) * exagg, -(G.y[i] - cy)];

    let depthArr = null;
    if (S.colourBy === "depth") {
      depthArr = new Float64Array(G.n);
      for (let i = 0; i < G.n; i++) depthArr[i] = G.cover[i] > 0 ? G.cover[i] - G.inv[i] : NaN;
    }
    const field = S.colourBy === "elevation" ? G.inv : S.colourBy === "depth" ? depthArr : null;
    let flo = Infinity, fhi = -Infinity;
    if (field) for (let i = 0; i < G.n; i++) if (isFinite(field[i])) { if (field[i] < flo) flo = field[i]; if (field[i] > fhi) fhi = field[i]; }

    if (edgeLines) { scene.remove(edgeLines); edgeLines.geometry.dispose(); edgeLines.material.dispose(); }
    const cov = S.covered, obs = G.obs;
    const positions = [], colours = [];
    for (let ei = 0; ei < G.edges.length; ei++) {
      const [a, b] = G.edges[ei];
      let rgb;
      if (field) {
        const v = field[b];
        rgb = isFinite(v) ? rampN((v - flo) / Math.max(1e-6, fhi - flo), S.colourBy === "depth" ? DEPTH_STOPS : ELEV_STOPS) : [58, 66, 87];
      } else {
        const isCov = cov && (cov[a] || cov[b]);
        const isObs = obs.inUniverse[a] || obs.inUniverse[b];
        rgb = levelColour(isCov ? 2 : isObs ? 1 : 0);
      }
      const pa = pos(a), pb = pos(b);
      positions.push(...pa, ...pb);
      const r = rgb[0] / 255, g = rgb[1] / 255, bch = rgb[2] / 255;
      colours.push(r, g, bch, r, g, bch);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
    edgeLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true }));
    scene.add(edgeLines);

    if (sensorMarkers) scene.remove(sensorMarkers);
    const sRadius = Math.max(0.6, (maxx - minx) / 300);
    const sGeo = new THREE.SphereGeometry(sRadius, 10, 8);
    const sMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
    sensorMarkers = new THREE.Group();
    for (const s of (S.sensors || [])) {
      if (s == null || s < 0 || s >= G.n) continue;
      const m = new THREE.Mesh(sGeo, sMat);
      m.position.set(...pos(s));
      sensorMarkers.add(m);
    }
    scene.add(sensorMarkers);

    if (groundMesh) { scene.remove(groundMesh); groundMesh.geometry.dispose(); groundMesh.material.dispose(); groundMesh = null; }
    const covNodes = [];
    for (let i = 0; i < G.n; i++) if (G.cover[i] > 0) covNodes.push(i);
    if (covNodes.length >= 3) {
      // A ground-level reference surface, not a flat plane at a single elevation: each grid
      // vertex's height is inverse-distance-weighted from real cover levels (surveyed or
      // contour-derived, whichever the node actually has), so it is honestly flat where the
      // input data is flat (a transferred-depth region) and honestly undulating where it isn't.
      const N = 36;
      const positions = new Float32Array(N * N * 3);
      for (let gy = 0; gy < N; gy++) {
        const wy = miny + (maxy - miny) * gy / (N - 1);
        for (let gx = 0; gx < N; gx++) {
          const wx = minx + (maxx - minx) * gx / (N - 1);
          let num = 0, den = 0;
          for (const i of covNodes) {
            const dx = G.x[i] - wx, dy = G.y[i] - wy;
            const w = 1 / (dx * dx + dy * dy + 1);
            num += w * G.cover[i]; den += w;
          }
          const h = num / den;
          const p = (gy * N + gx) * 3;
          positions[p] = wx - cx;
          positions[p + 1] = (h - cz) * exagg;
          positions[p + 2] = -(wy - cy);
        }
      }
      const indices = [];
      for (let gy = 0; gy < N - 1; gy++) for (let gx = 0; gx < N - 1; gx++) {
        const a = gy * N + gx, b = a + 1, c = a + N, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
      const gGeo = new THREE.BufferGeometry();
      gGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      gGeo.setIndex(indices);
      gGeo.computeVertexNormals();
      groundMesh = new THREE.Mesh(gGeo, new THREE.MeshBasicMaterial({
        color: 0x9fb3d9, transparent: true, opacity: 0.16, side: THREE.DoubleSide,
      }));
      scene.add(groundMesh);
    }

    if (anchorMarker) { scene.remove(anchorMarker); anchorMarker.geometry.dispose(); anchorMarker.material.dispose(); anchorMarker = null; }
    if (S.anchor != null) {
      const aGeo = new THREE.SphereGeometry(sRadius * 1.7, 12, 10);
      const aMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
      anchorMarker = new THREE.Mesh(aGeo, aMat);
      anchorMarker.position.set(...pos(S.anchor));
      scene.add(anchorMarker);
    }

    if (opts.reframe) {
      const span = Math.max(maxx - minx, maxy - miny, 1);
      camera.position.set(span * 0.15, span * 0.55, span * 0.95);
      controls.target.set(0, 0, 0);
      camera.near = Math.max(0.1, span / 2000);
      camera.far = span * 12;
      camera.updateProjectionMatrix();
      controls.update();
    }
  }

  function resize(container) {
    if (!renderer || !container) return;
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return { ensureThree, initScene, build, resize };
})();
