/* sim_3d.js - the three.js port of view3d.py's PyVista scene.

   What is drawn, and why it matches the desktop viewer mesh for mesh:
     ground   the contour-reconstructed surface, plus 1 m contour lines. PyVista got the
              lines from grid.contour(); there is no equivalent here, so marching squares
              runs on the same 60x60 grid and produces the same levels.
     shafts   one open cylinder per chamber, invert to cover, drawn wider than true
     water    a blue column in each shaft at the depth SWMM reported
     pipes    real plan route, falling straight between recorded inverts. Under the
              `along` split a pipe is several SWMM segments, each coloured by its own
              fill, so a backwater profile along a pipe stays visible. Red = full.
     arrows   flow direction and size per pipe, from SWMM's signed flow
     spill    a red ball on the lid while SWMM reports flooding there

   Exaggerations (vertical, bore, shaft width) are the desktop viewer's and are stated
   on screen, because without saying so an exaggerated shaft looks like a measurement. */
"use strict";
window.Sim3D = (function () {
  let THREE = null, OrbitControls = null, loadPromise = null;
  let renderer, scene, camera, controls, labelLayer;
  let built = null;            // the current scene's mutable pieces
  const ZEXAG = 8.0, BORE = 8.0, SHAFT_R = 0.525, SHAFT_DRAW = 2.5;
  const COL = { ground: 0xc9b79c, contour: 0x9c8a6c, shaft: 0x8a8f98, lid: 0x3b3f45,
                pipe: 0x6b7280, water: 0x2f7fd1, spill: 0xe0312b, arrow: 0xe8912d,
                bg: 0xf4f1ea };

  function ensureThree() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      THREE = await import("three");
      OrbitControls = (await import("three/addons/controls/OrbitControls.js")).OrbitControls;
    })();
    return loadPromise;
  }

  /* ---------------------------------------------------------------- colour ramp
     PyVista's "Blues" with above_color red. Sampled at the same few stops: an empty
     pipe must not read as a slightly-less-full one, and a full pipe must leave the
     ramp entirely rather than sit at its dark end. */
  // NOT PyVista's Blues verbatim. Its low end is [247,251,255], which is white, and the
  // page background is [244,241,234]. On the desktop that was survivable because VTK's
  // shading gave the tube a visible form; here an almost empty pipe was the same colour
  // as the page and the network looked like it had no pipes at all, which is how this was
  // reported. The run opens at fills of 0.003 to 0.16, so this is the state a visitor sees
  // first. The ramp now starts at a light steel blue that reads against cream and keeps
  // the same meaning: darker is fuller, red is full.
  const BLUES = [[0, [150, 180, 205]], [0.25, [116, 160, 203]], [0.5, [72, 128, 186]],
                 [0.75, [33, 95, 160]], [1, [8, 48, 107]]];
  function fillColour(t) {
    if (t >= 0.999) return [224, 49, 43];        // full: off the ramp, deliberately
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < BLUES.length - 1; i++) {
      const [a, ca] = BLUES[i], [b, cb] = BLUES[i + 1];
      if (t <= b) {
        const u = (t - a) / ((b - a) || 1);
        return [0, 1, 2].map(j => Math.round(ca[j] + u * (cb[j] - ca[j])));
      }
    }
    return BLUES[BLUES.length - 1][1];
  }

  /* ------------------------------------------------------- marching squares
     PyVista contoured the structured grid for us. Doing it by hand keeps the 1 m
     lines that make the slope readable, which is most of why the ground is drawn. */
  function contourLines(gx, gy, gz, level) {
    const segs = [];
    const ny = gz.length, nx = gz[0].length;
    const interp = (x1, y1, v1, x2, y2, v2) => {
      const t = (level - v1) / ((v2 - v1) || 1e-9);
      return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
    };
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const v = [gz[j][i], gz[j][i + 1], gz[j + 1][i + 1], gz[j + 1][i]];
        const px = [gx[i], gx[i + 1], gx[i + 1], gx[i]];
        const py = [gy[j], gy[j], gy[j + 1], gy[j + 1]];
        if (v.some(z => z === null || !isFinite(z))) continue;
        const pts = [];
        for (let e = 0; e < 4; e++) {
          const a = e, b = (e + 1) % 4;
          if ((v[a] < level) !== (v[b] < level)) {
            pts.push(interp(px[a], py[a], v[a], px[b], py[b], v[b]));
          }
        }
        for (let k = 0; k + 1 < pts.length; k += 2) segs.push([pts[k], pts[k + 1]]);
      }
    }
    return segs;
  }

  /* ------------------------------------------------------------------ helpers */
  function makeLabel(text, cls) {
    const d = document.createElement("div");
    d.className = "lbl " + (cls || "");
    d.textContent = text;
    labelLayer.appendChild(d);
    return d;
  }

  function tubeAlong(pts, radius, mat) {
    const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0);
    const seg = Math.max(2, (pts.length - 1) * 4);
    return new THREE.Mesh(new THREE.TubeGeometry(curve, seg, radius, 16, false), mat);
  }

  /* ------------------------------------------------------------------- build */
  async function build(container, geom, ground) {
    await ensureThree();
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
      container.innerHTML = "";
      labelLayer = document.createElement("div");
      labelLayer.className = "labels";
      container.appendChild(renderer.domElement);
      container.appendChild(labelLayer);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      (function loop() {
        requestAnimationFrame(loop);
        controls.update();
        renderer.render(scene, camera);
        placeLabels();
      })();
      window.addEventListener("resize", () => resize(container));
    }
    scene.clear();
    labelLayer.innerHTML = "";
    scene.background = new THREE.Color(COL.bg);
    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(-120, -200, 300);
    scene.add(sun);

    const nodes = {};
    geom.nodes.forEach(n => { nodes[n.name] = n; });
    const J = nodes.J;
    const ox = J.x, oy = J.y;
    let oz = Infinity;
    geom.nodes.forEach(n => { if (n.invert < oz) oz = n.invert; });
    oz -= 0.5;
    const P = (x, y, z) => new THREE.Vector3(x - ox, (z - oz) * ZEXAG, -(y - oy));
    //                                        ^ three.js is Y-up; the model is Z-up.

    // ---- ground surface and its 1 m contours
    const gx = ground.x, gy = ground.y, gz = ground.z;
    const gw = gx.length, gh = gy.length;
    const gGeo = new THREE.BufferGeometry();
    const pos = [], idx = [];
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const z = gz[j][i];
        const v = P(gx[i], gy[j], isFinite(z) ? z : oz);
        pos.push(v.x, v.y, v.z);
      }
    }
    for (let j = 0; j < gh - 1; j++) {
      for (let i = 0; i < gw - 1; i++) {
        const a = j * gw + i, b = a + 1, c = a + gw + 1, d = a + gw;
        idx.push(a, b, c, a, c, d);
      }
    }
    gGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    gGeo.setIndex(idx);
    gGeo.computeVertexNormals();
    scene.add(new THREE.Mesh(gGeo, new THREE.MeshLambertMaterial({
      color: COL.ground, transparent: true, opacity: 0.10,
      side: THREE.DoubleSide, depthWrite: false })));

    let zmin = Infinity, zmax = -Infinity;
    gz.forEach(row => row.forEach(z => {
      if (isFinite(z)) { if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
    }));
    const cpts = [];
    for (let lv = Math.floor(zmin); lv <= Math.ceil(zmax); lv += 1) {
      contourLines(gx, gy, gz, lv).forEach(([p1, p2]) => {
        const a = P(p1[0], p1[1], lv), b = P(p2[0], p2[1], lv);
        cpts.push(a.x, a.y, a.z, b.x, b.y, b.z);
      });
    }
    const cGeo = new THREE.BufferGeometry();
    cGeo.setAttribute("position", new THREE.Float32BufferAttribute(cpts, 3));
    scene.add(new THREE.LineSegments(cGeo, new THREE.LineBasicMaterial({
      color: COL.contour, transparent: true, opacity: 0.6 })));

    // ---- shafts, lids, chamber labels
    const shaftMat = new THREE.MeshLambertMaterial({ color: COL.shaft, transparent: true,
      opacity: 0.25, side: THREE.DoubleSide, depthWrite: false });
    const labels = [];
    geom.chambers.forEach(c => {
      const n = nodes[c];
      const h = n.max_depth * ZEXAG;
      const base = P(n.x, n.y, n.invert);
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(SHAFT_R * SHAFT_DRAW, SHAFT_R * SHAFT_DRAW, h, 40, 1, true),
        shaftMat);
      shaft.position.set(base.x, base.y + h / 2, base.z);
      scene.add(shaft);
      const lid = new THREE.Mesh(
        new THREE.CircleGeometry(SHAFT_R * SHAFT_DRAW * 1.25, 40),
        new THREE.MeshLambertMaterial({ color: COL.lid, side: THREE.DoubleSide }));
      lid.rotation.x = -Math.PI / 2;
      lid.position.set(base.x, base.y + h, base.z);
      scene.add(lid);
      // cover may be null: that chamber has no surveyed lid level (see build_sim_web.clean)
      const tag = c + "  (MH " + n.manhole_id + ")" + (n.cover === null ? "  lid interpolated" : "");
      labels.push({ el: makeLabel(tag, "chamber"),
                    at: new THREE.Vector3(base.x, base.y + h + 1.2 * ZEXAG / 8, base.z) });
    });

    // ---- pipe centrelines
    const linkIndex = {};
    geom.links.forEach((lk, i) => { linkIndex[lk.name] = i; });
    const lines = geom.links.map(lk => {
      const xy = lk.line;
      let run = 0;
      const seg = [0];
      for (let i = 1; i < xy.length; i++) {
        run += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
        seg.push(run);
      }
      const total = seg[seg.length - 1] || 1e-9;
      return xy.map((p, i) => {
        const f = seg[i] / total;
        const z = lk.inv_up + (lk.inv_down - lk.inv_up) * f + lk.dia / 2;
        return P(p[0], p[1], z);
      });
    });

    geom.links.forEach((lk, i) => {
      const ghost = lk.role !== "study";
      scene.add(tubeAlong(lines[i], lk.dia / 2 * BORE * 1.08,
        new THREE.MeshLambertMaterial({ color: COL.pipe, transparent: true,
          // The outline says "a pipe is here" whatever the water is doing. It was faint
          // enough to disappear along with the fill colour.
          opacity: ghost ? 0.18 : 0.40, depthWrite: false })));
    });

    geom.pipes.forEach(p => {
      const mid = lines[linkIndex[p.links[Math.floor(p.links.length / 2)]]];
      const at = p.links.length === 1 ? mid[Math.floor(mid.length / 2)] : mid[0];
      const txt = p.label + "  " + Math.round(p.dia * 1000) + " mm  " +
                  p.length.toFixed(0) + " m" + (p.role !== "study" ? "  (outlet boundary)" : "");
      labels.push({ el: makeLabel(txt, "pipe"),
                    at: new THREE.Vector3(at.x, at.y + 1.5, at.z) });
    });

    // ---- dynamic pieces, rebuilt per frame only where they must be
    const waterMat = new THREE.MeshLambertMaterial({ color: COL.water, transparent: true,
      opacity: 0.85 });
    const water = geom.chambers.map(c => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(
        SHAFT_R * SHAFT_DRAW * 0.9, SHAFT_R * SHAFT_DRAW * 0.9, 1, 32), waterMat);
      scene.add(m);
      return m;
    });
    const spill = geom.chambers.map(() => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1.2, 20, 14),
        new THREE.MeshLambertMaterial({ color: COL.spill }));
      m.visible = false;
      scene.add(m);
      return m;
    });
    const fillTubes = geom.links.map((lk, i) => {
      const m = tubeAlong(lines[i], lk.dia / 2 * BORE * 0.9,
        new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }));
      scene.add(m);
      return m;
    });
    const arrows = geom.pipes.map(() => {
      const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(),
        1, COL.arrow, 0.35, 0.18);
      scene.add(a);
      return a;
    });

    built = { geom, nodes, P, lines, linkIndex, water, spill, fillTubes, arrows, labels };
    frameCamera(geom, P, nodes, lines);
    resize(container);
    return built;
  }

  /* Frame on the shafts AND the pipe routes. Chambers alone leave the longest reach
     running off the side of a view that looks correctly framed, which is how the
     desktop viewer's default camera also reads too far out. */
  function frameCamera(geom, P, nodes, lines) {
    const box = new THREE.Box3();
    geom.chambers.forEach(c => {
      const n = nodes[c];
      box.expandByPoint(P(n.x, n.y, n.invert));
      box.expandByPoint(P(n.x, n.y, n.invert + n.max_depth));
    });
    (lines || []).forEach(pts => pts.forEach(p => box.expandByPoint(p)));
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const fov = camera.fov * Math.PI / 180;
    const r = Math.max(size.x, size.y, size.z, 20) / (2 * Math.tan(fov / 2)) * 1.25;
    controls.target.copy(c);
    camera.position.set(c.x + r * 0.75, c.y + r * 0.45, c.z + r * 0.75);
    camera.updateProjectionMatrix();
    controls.update();
  }

  /* -------------------------------------------------------------- per frame */
  function draw(k, run, s) {
    if (!built) return;
    const { geom, nodes, P, lines, linkIndex, water, spill, fillTubes, arrows } = built;
    k = Math.max(0, Math.min(k, run.steps - 1));

    geom.chambers.forEach((c, i) => {
      const n = nodes[c];
      const h = Math.max(s.depth.at(k, i), 0.002) * ZEXAG;
      const base = P(n.x, n.y, n.invert);
      water[i].scale.set(1, h, 1);
      water[i].position.set(base.x, base.y + h / 2, base.z);
      const lidZ = (n.cover !== null && isFinite(n.cover)) ? n.cover : n.invert + n.max_depth;
      const top = P(n.x, n.y, lidZ);
      spill[i].visible = s.flood.at(k, i) > 1e-6;
      spill[i].position.set(top.x, top.y + 0.6 * ZEXAG / 8, top.z);
    });

    geom.links.forEach((lk, i) => {
      const fill = s.ldepth.at(k, i) / lk.dia;
      const [r, g, b] = fillColour(fill);
      fillTubes[i].material.color.setRGB(r / 255, g / 255, b / 255);
    });

    let qmax = 1e-6;
    for (let i = 0; i < s.lflow.rows * s.lflow.cols; i++) {
      const v = Math.abs(s.lflow.data[i]);
      if (v > qmax) qmax = v;
    }
    geom.pipes.forEach((p, ai) => {
      const i = linkIndex[p.links[Math.floor(p.links.length / 2)]];
      const pts = lines[i], q = s.lflow.at(k, i);
      const a = pts[0], z = pts[pts.length - 1];
      const dir = new THREE.Vector3(z.x - a.x, z.y - a.y, z.z - a.z)
        .multiplyScalar(q >= 0 ? 1 : -1).normalize();
      const size = Math.abs(q) < 0.02 ? 0.001 : 4.0 + 10.0 * Math.abs(q) / qmax;
      const ctr = pts.length > 2 ? pts[Math.floor(pts.length / 2)]
        : new THREE.Vector3((a.x + z.x) / 2, (a.y + z.y) / 2, (a.z + z.z) / 2);
      arrows[ai].position.set(ctr.x, ctr.y + p.dia * BORE + 0.6, ctr.z);
      arrows[ai].setDirection(dir);
      arrows[ai].setLength(size, size * 0.35, size * 0.18);
      arrows[ai].visible = size > 0.01;
    });
  }

  /* HTML labels projected by hand, which avoids pulling in CSS2DRenderer for six of them. */
  function placeLabels() {
    if (!built || !renderer) return;
    const el = renderer.domElement;
    const w = el.clientWidth, h = el.clientHeight;
    built.labels.forEach(({ el: div, at }) => {
      const v = at.clone().project(camera);
      const vis = v.z < 1;
      div.style.display = vis ? "block" : "none";
      if (!vis) return;
      div.style.left = ((v.x * 0.5 + 0.5) * w) + "px";
      div.style.top = ((-v.y * 0.5 + 0.5) * h) + "px";
    });
  }

  function resize(container) {
    if (!renderer || !container) return;
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return { build, draw, resize, ZEXAG, BORE, SHAFT_DRAW,
           resetCamera: () => built && frameCamera(built.geom, built.P, built.nodes, built.lines) };
})();
