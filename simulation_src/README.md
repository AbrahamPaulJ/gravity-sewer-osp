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

### Choosing the cases

The cases — "what cannot be measured yet" on the page — are defined in **`cases.json`** and
nowhere else. `sim25.py`, `sim25_grid.py` and `../tools/build_sim25_web.py` all read it, so
adding or removing a case is an edit to that one file:

- `weather` is the nominal sweep, one case per infiltration level, each with the label and
  note the page shows. The corridor runs use these levels too.
- `sensitivity.at_ii` names which weather levels get the variants; each variant overrides one
  field of `Case` (`pf`, `age`, `bfac`, `stage`, `hour`) and carries the words added to its label.

As committed that is 4 weather levels plus 4 variants at 2 of them, 12 cases. Each case is 355
SWMM runs, so the count is the main lever on run time.

`study_area` in the same file sets where growth is tested and sensors may go:

- `"segment"` (the default if absent): the 71 manholes above node 583, a corner of the council
  area. Results in `results/sim25/grid/`. Low-infiltration cases are nested, so a case takes
  4 to 20 minutes.
- `"whole"`: all 328 published manholes in the model domain. Results in
  `results/sim25/grid_whole/`, so the two never overwrite each other. Growth can land
  anywhere, which the nested shortcut cannot hold, so every run is whole-domain: 1,641 runs
  and about 87 minutes a case on 9 workers. Depth rises below 1 mm are not stored, since the
  smallest published rule is 10 mm. Measured on the first whole-area grid (1 Oct 2026): 0.8 to
  2 MB a case, wetter cases larger since more manholes rise, against roughly 13 MB had every manhole in every run been kept, almost all
  of it zeros. That grid of 5 cases took 8 h 22 m, about 35 s a run rather than 28.6.

The map follows the setting: a whole-area build draws the whole domain as the study area,
and the "Whole Walkerville" button is hidden because there is nothing left for it to add.

The file is checked when `sim25` is imported, so a misspelt field, an `at_ii` that is not a
weather level, or two cases sharing an infiltration level fails immediately with a message
saying which, rather than partway through a two-hour grid.

**Editing it does not change the page by itself.** The page reads generated data, so after an
edit, publish it from the repository root:

```
python tools/build_sim25_web.py --publish
```

That checks `cases.json`, rebuilds, copies the data into `simulation25/` and bumps the cache
keys, then lists the cases now on the page. It publishes nothing if the file is invalid. If
the file names a case that has never been solved, it stops and says which; run those first
with `python sim25_grid.py --cases all --resume`, which skips every case already solved.

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

## Manning's n comes from each pipe's material

`model.MANNING_BY_MATERIAL` keys roughness to the publisher's MATERIAL field: 0.013 for
vitrified clay and reinforced concrete, 0.010 for uPVC, and 0.013 as the fallback where the
code is missing or unrecognised. Conventional design values from Chow (1959) Table 5-6, the
table the SWMM reference reproduces and from which SWMM takes its own concrete default.

On this catchment that is 907 clay, 94 uPVC and 1 reinforced concrete, so **94 of 1,002
reaches move from 0.013 to 0.010** and carry slightly more flow than before. Of the 890 links
the whole domain actually routes, 83 are uPVC; of the 161 in the segment, 9 are. The layer
also publishes a ROUGHNESS field, which would settle this from data rather than a table; it is
populated on no record here.

Reaching those counts takes both material fields. MATERIAL is the coded value and reads UNKN
on 456 of the 1,002 mains; MATERIALUN is the free text, and on every one of those 456 it reads
VC. The layer is not saying the material is unknown, only that the code is, so `network._material`
falls back to MATERIALUN and those 456 reaches are clay rather than fallback. It makes no
difference to the roughness here, since clay and the fallback are both 0.013, but it is what
the published network in `../data/osp_data.js` does, and it keeps the two in step if the table
ever changes.

**Simulation 2.5 has been re-run; Simulations 1 and 2 have not.** Under `results/sim25/` the
12-case grid, the corridor runs, `robustness.json`, `graded.json`, `graded_report.txt` and
`daily.json` were all regenerated with per-material n. Everything else under `results/` —
`ladder_*`, `growth_*`, `catchment/`, `warning_along/`, `runs/`, `compare/` — still holds the
uniform-n answers, and so do the packed page files in `../simulation25/data/`.

```
python sim25_grid.py --cases all --workers 9    # 2 h 18 m measured, not the 94 min it predicts
python sim25_graded.py > results/sim25/graded_report.txt
python sim25_daily.py                           # about 2.5 min
```

The grid's own estimate assumes 20 s per whole-domain run. That holds at low I&I; at 0.25 and
0.40 the network surcharges and a run takes about 30 s, so the four high-I&I cases take 18-20
minutes each rather than the predicted 13.

To tell which roughness an output came from: Simulation 1 records it, in the `manning_used`
and `manning_by_material` keys of the meta that `model.Result.save` writes. Simulation 2.5
does not — `sim25.py` writes its own `summary.json` and never calls that writer, so its
outputs carry no provenance at all, not even the pyswmm version or the routing error. Date
the files against this section until that is fixed.
