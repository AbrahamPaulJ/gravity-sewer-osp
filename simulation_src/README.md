# Simulation source

The EPA SWMM models behind the three published simulations, with the exact public input data
they were run on and every run's output, so each result can be reproduced or checked.

| Page | Model | Run |
|---|---|---|
| Simulation 1, warning time | `model.py`, `experiments.py` | `python experiments.py` |
| Simulation 2, growth (superseded) | `catchment.py`, `growth_grid.py` | `python growth_grid.py` |
| Simulation 2.5, growth and sensor placement | `sim25.py`, `sim25_grid.py` | see below |

## Setup

Python 3.11. `pip install -r requirements.txt` (pyvista only for the desktop viewer
`view3d.py`).

## Inputs

`data/raw/` is the snapshot of the public council and statewide ArcGIS layers the published
results were computed from. `python fetch_data.py` re-downloads them, but the live layers
change, so a fresh fetch may not reproduce the published numbers exactly. Keep the snapshot for
replication.

## Simulation 2.5

```
python sim25.py --describe                           # the model domain, inflows, pumps, loads
python sim25_grid.py --cases all --workers 6         # 12 cases x 71 sites x 5 sizes, about 77 min
python sim25_grid.py --cases all --resume --workers 6   # continue after a stop
python sim25_graded.py                               # the rise-threshold placement, graded.json
python sim25_daily.py                                # the daily-cycle check
python test_simulation.py                            # the test suite
```

Outputs land in `results/sim25/`: one folder per case with `summary.json`, plus `graded.json`,
`robustness.json`, the corridor runs and the SWMM `.inp`, `.rpt` and `.out` files. The published
page reads these through its own data files in `../simulation25/data/`.

Uncalibrated: every number is conditional on the assumptions listed in the page's Assumptions
tab. Generated from the project's working copy; do not hand-edit this folder.

## Manning's n comes from each pipe's material

`model.MANNING_BY_MATERIAL` keys roughness to the publisher's MATERIAL field: 0.013 for
vitrified clay and reinforced concrete, 0.010 for uPVC, and 0.013 as the fallback where the
code is missing or unrecognised. Conventional design values from Chow (1959) Table 5-6, the
table the SWMM reference reproduces and from which SWMM takes its own concrete default.

On this catchment that is 907 clay, 94 uPVC and 1 reinforced concrete, so **94 of 1,002
reaches move from 0.013 to 0.010** and carry slightly more flow than before. The layer also
publishes a ROUGHNESS field, which would settle this from data rather than a table; it is
populated on no record here.

**`results/` predates this change.** Everything committed under `results/` was run with a
single n = 0.013 and has not been regenerated. Re-run the grids to bring them into line:

```
python sim25_grid.py --cases all --workers 6     # about 77 minutes
```

Until then the published pages show the uniform-n answers, and `meta.manning_used` in a fresh
run is how to tell which you are looking at.
