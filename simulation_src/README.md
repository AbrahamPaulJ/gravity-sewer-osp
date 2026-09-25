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

## Rebuild the Sim 2.5 browser page

Run these commands from the repository root:

```bash
pip install -r simulation_src/requirements.txt
python tools/build_sim25_web.py --check
python -m http.server 8782 --directory reproduced_simulation25
```

Open <http://localhost:8782>. The builder reconstructs the network geometry from the committed
ArcGIS snapshot and regenerates all 240 browser cells, heatmaps and nested 1-to-10 sensor sets
from the committed `summary.json` files. `--check` then compares all seven rebuilt files byte for
byte with the tracked page in `simulation25/`. The static HTML, UI modules and public narrative
are copied from that tracked page as templates; `data/catchment.js` and `data/growth.js` are
regenerated from the simulation inputs and outputs.

For a full solver-to-browser reproduction, first run the Simulation 2.5 commands above from
`simulation_src/`, including the 12-case grid and `sim25_graded.py`, then return to the repository
root and run the builder. The complete grid is 12 cases x 71 sites x 5 growth sizes, or 4,260
growth runs, and took about 77 minutes on the development machine. Use `--resume` after an
interruption. Keep `data/raw/`; running `fetch_data.py` substitutes today's live data and is not
an exact reproduction of the published run.

Uncalibrated: every number is conditional on the assumptions listed in the page's Assumptions
tab. Generated from the project's working copy; do not hand-edit this folder.
