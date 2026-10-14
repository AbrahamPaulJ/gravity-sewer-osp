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

PUMP STATIONS AT A SET RATE (config.js pumps, option A). A scenario may also carry
"pumps": a rate in L/s for any station, keyed by its first rising main id. Then every station
is a wet-well tank with a constant-rate pump that starts and stops on its levels (stations
not named run at their default rate), solved over config.js's longer run with each depth the
peak over a window spanning whole pump cycles; and the baseline it is compared with is the
same rated model with every station at its default rate and no growth. Without "pumps" a
scenario uses SWMM's ideal pumps, exactly as the published grid did. Pump settings are read
when the runner starts: restart it after editing config.js.

On the public site there is no such server; the page detects that and shows its estimate.

    ~/.venvs/sewer/bin/python simulation_src/sim25_serve.py            # http://localhost:8001
    ~/.venvs/sewer/bin/python simulation_src/sim25_serve.py --port 8002

Listens on 127.0.0.1 only. Endpoints:
    GET  /api/sim25/ping       which study area and cases this runner can solve
    POST /api/sim25/scenario   {"case": "<case tag>", "sites": [[manhole_id, dwellings], ...],
                                "pumps": null | {"<rising main id>": rate_lps, ...}}
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
MAX_PUMP_LPS = 200.0             # per station; the defaults here are 7.9 and 17.7

CASES = {c.tag(): c for c in sim25_grid.cases("all")}
_baseline, _lock, _pool = {}, threading.Lock(), None


def candidates():
    """Manhole id -> SWMM chamber name, for the configured study area."""
    probe = sim25.Sim25Model(sim25.Case(), whole=True)
    return {probe.nodes[c].manhole_id: c for c in probe.candidates}


def solve(case, growth, pumps=None):
    """One whole-domain run, as the grid runs it; growth is {manhole_id: dwellings} or None.
    pumps None keeps the ideal pumps; a dict of rates (even empty) makes them rated."""
    run_dir = tempfile.mkdtemp(prefix="sim25_scenario_")
    args = (case, None, growth, run_dir) + (() if pumps is None else (pumps,))
    return _pool.submit(sim25_grid._whole_task, args)


def scenario(tag, sites, by_mh, pumps=None):
    case = CASES[tag]
    growth = {int(mh): int(n) for mh, n in sites} or None
    rated = pumps is not None
    key = (tag, "rated" if rated else "ideal")
    t0 = time.time()
    with _lock:                  # one solve at a time: each already uses a full core
        jobs = {"run": solve(case, growth, pumps)}
        if key not in _baseline:
            # The rated baseline is every station at its default rate: {} names none.
            jobs["base"] = solve(case, None, {} if rated else None)
        run = jobs["run"].result()
        if "base" in jobs:
            _baseline[key] = jobs["base"].result()[3]
    base, (head, growth_lps, err, st) = _baseline[key], run
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
    out = {"case": tag, "sites": [[int(mh), int(n)] for mh, n in sites],
           "added_lps": round(growth_lps, 4), "continuity_error_pct": round(err, 3),
           "seconds": round(time.time() - t0, 1), "manholes": manholes,
           "pumps": {"mode": "ideal"}}
    if rated:
        ps = sim25.pump_settings()
        out["pumps"] = {"mode": "rated",
                        "rates": {k: float(pumps.get(k, d)) for k, d in DEFAULT_RATES.items()},
                        "defaults": DEFAULT_RATES, "window_min": ps["window"],
                        "minutes": ps["minutes"]}
    return out


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
                                    "maxDwellings": MAX_DWELLINGS,
                                    "pumpDefaults": DEFAULT_RATES, "maxPumpLps": MAX_PUMP_LPS})
        return super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/api/sim25/scenario":
            return self._json(404, {"error": "no such endpoint"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(min(n, 100_000)) or b"{}")
            tag, sites = req.get("case"), req.get("sites") or []
            pumps = req.get("pumps")
            if tag not in CASES:
                return self._json(400, {"error": f"unknown case {tag!r}; this runner has "
                                                 f"{sorted(CASES)}. Republish if config.js's cases changed."})
            if pumps is not None:
                if not isinstance(pumps, dict):
                    return self._json(400, {"error": "pumps must be null or {station: rate}"})
                pumps = {str(k): float(v) for k, v in pumps.items()}
                bad = [k for k in pumps if k not in DEFAULT_RATES]
                if bad:
                    return self._json(400, {"error": f"no pump station {bad}; they are {sorted(DEFAULT_RATES)}"})
                bad = [k for k, v in pumps.items() if not 0 < v <= MAX_PUMP_LPS]
                if bad:
                    return self._json(400, {"error": f"pump rate at {bad} must be above 0 and up to {MAX_PUMP_LPS:g} L/s"})
            # With pumps at a set rate a scenario may change only the pumps.
            if len(sites) > MAX_SITES or (not sites and pumps is None):
                return self._json(400, {"error": f"give between 1 and {MAX_SITES} manholes"})
            for mh, dw in sites:
                if int(mh) not in BY_MH:
                    return self._json(400, {"error": f"MH {mh} is not a growth site in this "
                                                     f"study area ({sim25.STUDY_AREA})"})
                if not 1 <= int(dw) <= MAX_DWELLINGS:
                    return self._json(400, {"error": f"dwellings at MH {mh} must be 1 to "
                                                     f"{MAX_DWELLINGS}"})
            self._json(200, scenario(tag, sites, BY_MH, pumps))
        except (ValueError, TypeError) as e:
            self._json(400, {"error": f"bad request: {e}"})
        except Exception as e:                     # a failed solve, reported, not swallowed
            self._json(500, {"error": f"{type(e).__name__}: {e}"})


def main():
    global _pool, BY_MH, DEFAULT_RATES
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8001)
    args = ap.parse_args()
    if sim25.STUDY_AREA != "whole":
        print("note: study_area is 'segment'; scenarios are limited to its 71 manholes and "
              "solved on the whole domain")
    BY_MH = candidates()
    # Only the stations the whole model solves can be rated; read once, as the config is.
    probe = sim25.Sim25Model(sim25.Case(), whole=True)
    every = sim25.default_pump_rates(probe.net)
    DEFAULT_RATES = {name[1:]: every[name[1:]] for name, _, _ in probe.pumps}
    _pool = ProcessPoolExecutor(2)
    print(f"serving {ROOT} at http://localhost:{args.port}  "
          f"({len(BY_MH)} growth sites, {len(CASES)} cases, pump defaults {DEFAULT_RATES} L/s; "
          "Ctrl+C to stop)")
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=ROOT))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        _pool.shutdown(cancel_futures=True)


BY_MH, DEFAULT_RATES = {}, {}
if __name__ == "__main__":
    main()
