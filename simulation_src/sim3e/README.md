# Simulation 3-e: headroom from a few sensors

A new version beside Simulation 3, in new files only. Sim 3's model, cases, runs and pages are
read and never changed.

| Step | Needs SWMM? | Script | Output |
|---|---|---|---|
| Whole-suburb growth, 7 steps x 8 cases | Yes, 56 runs (about 8 min on 8 workers) | `sim3e_runs.py` | `../results/sim3e/suburb.json` |
| Virtual sensors, placement, timeline, budget inputs | No | `sim3e_build.py` | `../results/sim3e/analysis.json`, `../../simulation3e/data/sim3e.js` |

```
~/.venvs/sewer/bin/python simulation_src/sim3e/sim3e_runs.py --workers 8   # checks one published Sim 3 run first
~/.venvs/sewer/bin/python simulation_src/sim3e/sim3e_build.py
```

The page is `simulation3e/index.html`; every assumption and check is on `simulation3e/about.html`.

The build also runs a fair re-test (added at merge, 2 Nov 2026): sensors chosen again for each held-out growth source from the other sources only, and the whole-suburb runs left out of the learning when an area is held out. It adds about two minutes. Its results are `fair_test` in `analysis.json`; the page's budget table quotes them.
