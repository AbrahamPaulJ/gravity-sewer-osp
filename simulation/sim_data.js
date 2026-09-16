/* sim_data.js - unpack the quantised payload and fetch experiments on demand.

   The payload is EPA SWMM output that tools/build_sim_web.py saved. Nothing here
   models anything: the browser never solves, it replays. Each run is a set of
   base64 arrays plus the range they were quantised over, so unpacking is a scale
   and a shift, done once per run and cached.

   Loading is lazy on purpose. geom.js and index.js are about 46 KB gzipped between
   them, so the menu is up immediately; the heaviest experiment is another 118 KB
   and is only fetched when someone opens it. */
"use strict";
window.SimData = (function () {
  const loaded = {};        // exp -> promise of its runs object
  const unpacked = {};      // runId -> {field: {data, rows, cols}}

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* Undo the quantisation. `bits` is 16 for anything the readout panel prints and
     8 only for the spill flag, which is drawn as on or off. */
  function unpackField(f) {
    const bytes = b64ToBytes(f.b64);
    const wide = f.bits === 16;
    const top = wide ? 65535 : 255;
    const n = wide ? bytes.length / 2 : bytes.length;
    const span = (f.hi - f.lo) || 1;
    const data = new Float32Array(n);
    if (wide) {
      // The builder wrote '<u2'. Uint16Array would read PLATFORM endianness, which is
      // little-endian on every browser anyone will use and silently wrong on one that
      // is not. A DataView costs nothing here and states the byte order.
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < n; i++) data[i] = f.lo + (dv.getUint16(i * 2, true) / top) * span;
    } else {
      for (let i = 0; i < n; i++) data[i] = f.lo + (bytes[i] / top) * span;
    }
    const rows = f.shape[0], cols = f.shape.length > 1 ? f.shape[1] : 1;
    return { data, rows, cols, at: (k, i) => data[k * cols + (i || 0)] };
  }

  function series(run) {
    if (unpacked[run.id]) return unpacked[run.id];
    const out = {};
    for (const k in run.series) out[k] = unpackField(run.series[k]);
    unpacked[run.id] = out;
    return out;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("could not load " + src));
      document.head.appendChild(s);
    });
  }

  /* One network request per experiment, at most once. */
  function loadExperiment(exp) {
    if (loaded[exp]) return loaded[exp];
    const varName = "SIM_RUNS_" + exp;
    loaded[exp] = (window[varName]
      ? Promise.resolve()
      : loadScript("data/run_" + exp + ".js")
    ).then(() => {
      const payload = window[varName];
      if (!payload) throw new Error("payload " + varName + " did not define itself");
      return payload.runs;
    });
    return loaded[exp];
  }

  function timeAt(run, k) { return run.t0 + k * run.dt; }

  return { loadExperiment, series, timeAt };
})();
