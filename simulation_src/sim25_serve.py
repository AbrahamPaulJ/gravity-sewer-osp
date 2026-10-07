#!/usr/bin/env python3
"""
sim25_serve.py - serve the site, and solve growth scenarios built on the Sim 2.5 page.

The page is static and cannot run SWMM. Run locally, this serves the repository exactly as
`python3 -m http.server` would, and adds one endpoint the page's "Run in SWMM" button calls:
a scenario (several manholes, each with its own number of new dwellings) solved in EPA SWMM
on the whole-domain model, for one case.

It reuses sim25_grid._whole_task, the function the overnight grid ran, so a scenario is
solved with the same model, inflows, run length and settling as every published result. The
case's baseline (no growth) is solved the same way once and kept, so a rise is always the
difference between two runs of one solver, never between SWMM and a stored number.

On the public site there is no such server; the page detects that and shows its estimate.

    ~/.venvs/sewer/bin/python simulation_src/sim25_serve.py            # http://localhost:8001
    ~/.venvs/sewer/bin/python simulation_src/sim25_serve.py --port 8002

Listens on 127.0.0.1 only. Endpoints:
    GET  /api/sim25/ping       which study area and cases this runner can solve
    POST /api/sim25/scenario   {"case": "<case tag>", "sites": [[manhole_id, dwellings], ...]}
"""
import argparse, json, os, sys, tempfile, threading, time
from concurrent.futures import ProcessPoolExecutor
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import sim25                     # noqa: E402  (after the path is set)
import sim25_grid                # noqa: E402

MAX_SITES = 60                   # a scenario, not a census
MAX_DWELLINGS = 5000             # per manhole; the grid's own stress case is 700

CASES = {c.tag(): c for c in sim25_grid.cases("all")}
_baseline, _lock, _pool = {}, threading.Lock(), None


def candidates():
    """Manhole id -> SWMM chamber name, for the configured study area."""
    probe = sim25.Sim25Model(sim25.Case(), whole=True)
    return {probe.nodes[c].manhole_id: c for c in probe.candidates}


def solve(case, growth):
    """One whole-domain run, as the grid runs it; growth is {manhole_id: dwellings} or None."""
    run_dir = tempfile.mkdtemp(prefix="sim25_scenario_")
    return _pool.submit(sim25_grid._whole_task, (case, None, growth, run_dir))


def scenario(tag, sites, by_mh):
    case = CASES[tag]
    growth = {int(mh): int(n) for mh, n in sites}
    t0 = time.time()
    with _lock:                  # one solve at a time: each already uses a full core
        jobs = {"run": solve(case, growth)}
        if tag not in _baseline:
            jobs["base"] = solve(case, None)
        run = jobs["run"].result()
        if "base" in jobs:
            _baseline[tag] = jobs["base"].result()[3]
    base, (head, growth_lps, err, st) = _baseline[tag], run
    manholes = {}
    for mh, name in by_mh.items():
        b, s = base[name], st[name]
        manholes[str(mh)] = {
            "base_mm": round(b["depth"] * 1000, 1),
            "depth_mm": round(s["depth"] * 1000, 1),
            "rise_mm": round((s["depth"] - b["depth"]) * 1000, 1),
            "alarm": bool(s["alarm"]), "alarm_before": bool(b["alarm"]),
            "surcharged": bool(s["surcharged"]), "surcharged_before": bool(b["surcharged"]),
            "spilled": bool(s["spilled"]),
        }
    return {"case": tag, "sites": [[int(mh), int(n)] for mh, n in sites],
            "added_lps": round(growth_lps, 4), "continuity_error_pct": round(err, 3),
            "seconds": round(time.time() - t0, 1), "manholes": manholes}


class Handler(SimpleHTTPRequestHandler):
    def _json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] == "/api/sim25/ping":
            return self._json(200, {"ok": True, "studyArea": sim25.STUDY_AREA,
                                    "cases": list(CASES), "maxSites": MAX_SITES,
                                    "maxDwellings": MAX_DWELLINGS})
        return super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/api/sim25/scenario":
            return self._json(404, {"error": "no such endpoint"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(min(n, 100_000)) or b"{}")
            tag, sites = req.get("case"), req.get("sites") or []
            if tag not in CASES:
                return self._json(400, {"error": f"unknown case {tag!r}; this runner has "
                                                 f"{sorted(CASES)}. Republish if cases.json changed."})
            if not sites or len(sites) > MAX_SITES:
                return self._json(400, {"error": f"give between 1 and {MAX_SITES} manholes"})
            for mh, dw in sites:
                if int(mh) not in BY_MH:
                    return self._json(400, {"error": f"MH {mh} is not a growth site in this "
                                                     f"study area ({sim25.STUDY_AREA})"})
                if not 1 <= int(dw) <= MAX_DWELLINGS:
                    return self._json(400, {"error": f"dwellings at MH {mh} must be 1 to "
                                                     f"{MAX_DWELLINGS}"})
            self._json(200, scenario(tag, sites, BY_MH))
        except (ValueError, TypeError) as e:
            self._json(400, {"error": f"bad request: {e}"})
        except Exception as e:                     # a failed solve, reported, not swallowed
            self._json(500, {"error": f"{type(e).__name__}: {e}"})


def main():
    global _pool, BY_MH
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8001)
    args = ap.parse_args()
    if sim25.STUDY_AREA != "whole":
        print("note: study_area is 'segment'; scenarios are limited to its 71 manholes and "
              "solved on the whole domain")
    BY_MH = candidates()
    _pool = ProcessPoolExecutor(2)
    print(f"serving {ROOT} at http://localhost:{args.port}  "
          f"({len(BY_MH)} growth sites, {len(CASES)} cases; Ctrl+C to stop)")
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=ROOT))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        _pool.shutdown(cancel_futures=True)


BY_MH = {}
if __name__ == "__main__":
    main()
