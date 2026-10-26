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
