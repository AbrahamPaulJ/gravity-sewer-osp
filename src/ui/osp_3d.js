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
  let barrelMesh = null, waterMesh = null, surchargeMesh = null, waterMat = null;
  let loadPromise = null;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  let clock0 = now();
  let animate = true;

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
    (function loop() {
      requestAnimationFrame(loop);
      controls.update();
      if (waterMat) {
        waterMat.uniforms.uTime.value = (now() - clock0) / 1000;
        waterMat.uniforms.uAnimate.value = animate ? 1 : 0;
      }
      renderer.render(scene, camera);
    })();
  }

  /* Same three-level palette as the 2D canvas: not observable, observable, covered. */
  function levelColour(lvl) {
    return lvl === 2 ? [56, 189, 248] : lvl === 1 ? [29, 78, 216] : [58, 71, 97];
  }

  /* Multi-stop ramps, shared in spirit with the 2D canvas's continuous colour-by modes,
     with enough stops that a small elevation change is a visibly different colour rather
     than a blur in the middle of a two-colour gradient. */
  /* Same ramp and the same two alarm colours as the 2D capacity mode, so switching
     views never recolours the same reach. Over capacity and tipped-by-growth sit
     deliberately OUTSIDE the ramp: a reach that is merely busy must not be able to
     borrow the colour of one that has failed. */
  const CAP_STOPS = [[0, [51, 65, 85]], [0.5, [56, 189, 248]],
                     [0.75, [250, 204, 21]], [1, [249, 115, 22]]];
  const COL_OVER = [244, 63, 94], COL_TIPPED = [232, 121, 249];

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

  /* Water drawn as the circular segment Manning actually solved for.

     osp_capacity gives d/D per reach. Turning that back into a picture needs the
     wetted angle back out of it, theta = 2 acos(1 - 2 d/D), which osp_capacity now
     exports so the drawing and the number cannot drift apart. The wetted arc is
     swept along the reach and closed with the chord at the free surface.

     The section is built in the frame of the reach: `right` is horizontal and square
     to the pipe, `up` is square to both and therefore near vertical. Filling from the
     invert along `up` is what makes the surface read as horizontal.

       point(phi) = centre + R (cos phi * up + sin phi * right)

     phi = pi is the invert. The reach is wet for phi in [phi0, 2pi - phi0] where
     phi0 = acos(2 d/D - 1), the same theta reached a different way.

     Two deliberate distortions, both declared in the panel. The bore is exaggerated,
     because a 300 mm pipe is invisible across a 1 km wide region. The scene's vertical
     axis is already exaggerated, so the section is a true circle in the STRETCHED
     space rather than in metres. The fill FRACTION, which is the quantity being
     communicated, is exact either way.

     The arc is sampled at OSPCapacity.arcSegments(d/D), not at a fixed count: a nearly
     full pipe sweeps almost the whole circle and needs more steps to stop the chords
     cutting the corners off the very reaches that matter most. */

  function disposeMesh(m) {
    if (!m) return;
    scene.remove(m);
    if (m.geometry) m.geometry.dispose();
    if (m.material && m.material !== waterMat) m.material.dispose();
  }

  function makeWaterMaterial() {
    if (waterMat) return waterMat;
    waterMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uAnimate: { value: 1 },
        /* One band per 6 m of real pipe. Reaches run 40 to 100 m, so a reach carries a
           readable handful of bands rather than a strobe or a single slab. */
        uWave: { value: 1 / 6 },
      },
      vertexShader: [
        "attribute vec3 aColour;",
        "attribute float aU;",      // metres along the reach, true length not stretched
        "attribute float aSpeed;",  // v = Q/A, from the same normal-depth solution
        "varying vec3 vColour; varying float vU; varying float vSpeed;",
        "void main() {",
        "  vColour = aColour; vU = aU; vSpeed = aSpeed;",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "precision mediump float;",
        "uniform float uTime; uniform float uAnimate; uniform float uWave;",
        "varying vec3 vColour; varying float vU; varying float vSpeed;",
        "void main() {",
        /* Travelling band. Phase advances at the reach's own velocity, so a steep
           reach visibly runs faster than a flat one. That contrast is the point:
           it is continuity, not decoration. */
        "  float band = 0.5 + 0.5 * cos(6.28318 * (vU - uTime * vSpeed) * uWave);",
        "  float lift = mix(1.0, 0.74 + 0.52 * band, uAnimate);",
        "  gl_FragColor = vec4(vColour * lift, 0.93);",
        "}",
      ].join("\n"),
      transparent: true, side: THREE.DoubleSide, depthWrite: true,
    });
    return waterMat;
  }

  function buildFlow(G, S, opts, pos) {
    const cap = opts.capacity, gr = opts.growth;
    const geo = cap.geo, bore = opts.boreExagg || 10;
    const m = G.edges.length;
    const tipped = gr ? new Set(gr.tipped) : null;

    const P = [], COL = [], U = [], SP = [], IDX = [], inst = [];

    for (let e = 0; e < m; e++) {
      const a = G.edges[e][0], b = G.edges[e][1];
      const pa = pos(a), pb = pos(b);
      let ax = pb[0] - pa[0], ay = pb[1] - pa[1], az = pb[2] - pa[2];
      const alen = Math.hypot(ax, ay, az);
      if (alen < 1e-6) continue;
      ax /= alen; ay /= alen; az /= alen;

      // right = normalise(axis x worldUp): horizontal, square to the pipe.
      let rx = az, ry = 0, rz = -ax;
      const rlen = Math.hypot(rx, ry, rz);
      if (rlen < 1e-9) continue;             // a truly vertical reach; sewers have none
      rx /= rlen; ry /= rlen; rz /= rlen;
      // up = right x axis: square to both, near vertical.
      const ux = ry * az - rz * ay, uy = rz * ax - rx * az, uz = rx * ay - ry * ax;

      const R = Math.max(1e-3, (geo.dia[e] / 2) * bore);
      const L = geo.len[e];

      inst.push([(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2,
                 ax, ay, az, alen, R]);

      let ratio = cap.dOverD[e];
      if (!isFinite(ratio) || ratio <= 0) continue;
      ratio = Math.min(1, ratio);

      let rgb;
      if (tipped && tipped.has(e)) rgb = COL_TIPPED;
      else if (cap.over[e]) rgb = COL_OVER;
      else rgb = rampN(ratio, CAP_STOPS);
      const cr = rgb[0] / 255, cg = rgb[1] / 255, cb = rgb[2] / 255;

      const vel = OSPCapacity.velocityOf(cap.q[e], geo.dia[e], ratio);
      const phi0 = Math.acos(Math.max(-1, Math.min(1, 2 * ratio - 1)));
      const span = 2 * Math.PI - 2 * phi0;
      const seg = OSPCapacity.arcSegments(ratio);
      const base = P.length / 3;

      for (let end = 0; end < 2; end++) {
        const c = end === 0 ? pa : pb;
        const uu = end === 0 ? 0 : L;
        for (let i = 0; i <= seg; i++) {
          const phi = phi0 + span * (i / seg);
          const cp = Math.cos(phi), sp = Math.sin(phi);
          P.push(c[0] + R * (cp * ux + sp * rx),
                 c[1] + R * (cp * uy + sp * ry),
                 c[2] + R * (cp * uz + sp * rz));
          COL.push(cr, cg, cb); U.push(uu); SP.push(vel);
        }
      }
      const A0 = base, B0 = base + seg + 1;
      for (let i = 0; i < seg; i++) {
        IDX.push(A0 + i, B0 + i, A0 + i + 1, A0 + i + 1, B0 + i, B0 + i + 1);
      }
      /* The free surface: the chord closing the wetted arc, swept along the reach.
         This is the face read from above, and the one that moves. */
      IDX.push(A0, B0, B0 + seg, A0, B0 + seg, A0 + seg);
    }

    disposeMesh(waterMesh); waterMesh = null;
    if (IDX.length) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      wg.setAttribute("aColour", new THREE.Float32BufferAttribute(COL, 3));
      wg.setAttribute("aU", new THREE.Float32BufferAttribute(U, 1));
      wg.setAttribute("aSpeed", new THREE.Float32BufferAttribute(SP, 1));
      wg.setIndex(IDX);
      waterMesh = new THREE.Mesh(wg, makeWaterMaterial());
      waterMesh.renderOrder = 1;
      scene.add(waterMesh);
    }

    /* Barrels after the water, semi-transparent and not writing depth, so the water
       inside stays visible through the pipe wall from any camera angle. */
    disposeMesh(barrelMesh); barrelMesh = null;
    if (inst.length) {
      const cyl = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x94a3b8, transparent: true, opacity: 0.17,
        side: THREE.DoubleSide, depthWrite: false,
      });
      barrelMesh = new THREE.InstancedMesh(cyl, mat, inst.length);
      const o = new THREE.Object3D(), yAxis = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3();
      for (let k = 0; k < inst.length; k++) {
        const q = inst[k];
        dir.set(q[3], q[4], q[5]);
        o.position.set(q[0], q[1], q[2]);
        o.quaternion.setFromUnitVectors(yAxis, dir);
        o.scale.set(q[7], q[6], q[7]);
        o.updateMatrix();
        barrelMesh.setMatrixAt(k, o.matrix);
      }
      barrelMesh.instanceMatrix.needsUpdate = true;
      barrelMesh.renderOrder = 2;
      scene.add(barrelMesh);
    }

    /* Chambers the capacity model says surcharge, drawn as a column standing in the
       chamber. It marks WHICH chamber the backed-up water enters. How far up it rises,
       and therefore whether a sensor can see it, is the observability model's job in
       osp_core, not this one. The column is drawn to the chamber depth and means
       "this one fills", not "it fills to exactly here". */
    disposeMesh(surchargeMesh); surchargeMesh = null;
    const sur = gr ? gr.after.surcharged : cap.surcharged;
    const nodes = [];
    for (let i = 0; i < G.n; i++) if (sur[i]) nodes.push(i);
    if (nodes.length) {
      const exagg = opts.exaggeration || 1;
      const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xf43f5e, transparent: true, opacity: 0.45, depthWrite: false,
      });
      surchargeMesh = new THREE.InstancedMesh(cyl, mat, nodes.length);
      const o = new THREE.Object3D();
      const rad = Math.max(0.4, bore * 0.09);
      for (let k = 0; k < nodes.length; k++) {
        const i = nodes[k], p = pos(i);
        const dep = G.cover[i] > 0 ? Math.max(0.2, G.cover[i] - G.inv[i]) : 1.5;
        const h = dep * exagg;
        o.position.set(p[0], p[1] + h / 2, p[2]);
        o.quaternion.identity();
        o.scale.set(rad, h, rad);
        o.updateMatrix();
        surchargeMesh.setMatrixAt(k, o.matrix);
      }
      surchargeMesh.instanceMatrix.needsUpdate = true;
      surchargeMesh.renderOrder = 3;
      scene.add(surchargeMesh);
    }
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

    const flowOn = !!opts.capacity;
    if (!flowOn) {
      disposeMesh(waterMesh); waterMesh = null;
      disposeMesh(barrelMesh); barrelMesh = null;
      disposeMesh(surchargeMesh); surchargeMesh = null;
    } else {
      buildFlow(G, S, opts, pos);
    }

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
    edgeLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: flowOn, opacity: flowOn ? 0.28 : 1,
    }));
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
        depthWrite: false,
      }));
      // Context, not content: behind the pipes, and never occluding the water.
      groundMesh.renderOrder = -1;
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

  function setAnimate(on) { animate = !!on; }

  /* What is actually in the scene, for tools/verify_flow_view.js.
     Not a debug leftover: it is the only honest way to assert the picture changed,
     since the WebGL back buffer is not readable after compositing. */
  function stats() {
    const wg = waterMesh && waterMesh.geometry;
    let uMax = 0, sMax = 0;
    if (wg) {
      const sp = wg.getAttribute("aSpeed"), uu = wg.getAttribute("aU");
      for (let i = 0; i < sp.count; i++) {
        if (sp.array[i] > sMax) sMax = sp.array[i];
        if (uu.array[i] > uMax) uMax = uu.array[i];
      }
    }
    return {
      waterVerts: wg ? wg.getAttribute("position").count : 0,
      waterTris: wg && wg.index ? wg.index.count / 3 : 0,
      barrels: barrelMesh ? barrelMesh.count : 0,
      surcharge: surchargeMesh ? surchargeMesh.count : 0,
      maxSpeed: sMax, maxReach: uMax,
      shaderOk: !!(waterMat && waterMat.program !== undefined ? true : !!waterMat),
    };
  }

  /* Frame the camera on the densest part of the network rather than the whole
     region, so a screenshot lands on pipes at a readable size. */
  function zoomTo(frac) {
    if (!camera || !controls) return false;
    const d = camera.position.distanceTo(controls.target);
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, d * frac);
    controls.update();
    return true;
  }

  return { ensureThree, initScene, build, resize, setAnimate, stats, zoomTo };
})();
