# Simulation source

The EPA SWMM models behind the three published simulations, with the exact public input data
they were run on and every run's output, so each result can be reproduced or checked.

| Page | Model | Run |
|---|---|---|
| Simulation 1, warning time | `model.py`, `experiments.py` | `python experiments.py` |
| Simulation 2, growth (superseded) | `catchment.py`, `growth_grid.py` | `python growth_grid.py` |
| Simulation 2.5, growth and sensor placement | `sim25.py`, `sim25_grid.py` | see below |
| Simulation 3, area growth on settled runs | `sim3_regions.py`, `sim3_analysis.py`, `sim25_grid.py` | see below |
| Simulation 3.5, warning, room for homes, level or float | `sim35_*.py`, on Simulation 3's runs | see below |
| Simulation 4, where to put the first sensors | `sim3_regions.py --partition bisection`, `sim4_numbers.py` | see below |

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

## Simulation 3

Every setting is read from `../config.js` (`simulation.run`, `simulation.regions`, and the
`eight` case set). Every SWMM run ends on a convergence gate instead of a fixed length: it stops
when no chamber's depth moves more than `settle_tol_mm` over the last `settle_window_min`
simulated minutes, and records its length, drift and whether it settled.

Infill (growth spread over an area's existing connection points, 8 areas x 7 build-out steps,
plus a baseline, in each of 8 cases: 456 runs):

```
python sim3_regions.py --plan                          # areas, run counts, nothing run
python sim3_regions.py --describe                      # write results/sim3/regions/regions.json
python sim3_regions.py --cases all --workers 6         # the whole sweep
python sim3_regions.py --cases all --resume --workers 6   # continue after a stop
python sim3_analysis.py                                # placement, first detection, time rule,
                                                       # choke points, pump indicator
python sim3_analysis.py --risk-only                    # the optional risk-weighted placement
```

Outputs land in `results/sim3/regions/`: one folder per case with `summary.json`, plus
`analysis.json` and `report.md`.

These are the hand-picked regions of 21 Oct 2026 (`simulation.regions.list`, partition `listed`,
the default in `config.js`), which Simulations 3 and 3.5 publish. Simulation 4 uses equal-home
regions instead; see below. Rebuild the Sim 3 page's data from the repository root:

```
python tools/build_sim3_regions.py            # simulation3/data/regions.js
python tools/build_sim3_regions.py --check    # rebuild in memory and compare
```

Known gap, found 10 Nov 2026: `python sim3_regions.py --describe` today gives the corridor (R8) 173
existing homes and the remainder (R7) 831, where the published runs and `results/sim3/regions/regions.json`
have 175 and 829. The repository's own earlier code gives the same 173 and 831, so the inputs, not the
code, changed after the 21 Oct runs; the cause is not traced. Re-running the hand-picked sweep today
would raise R7's 2041 growth from 141.0 to 141.4 homes; the corridor keeps its fixed 485 but spreads
them over its pipes slightly differently.

The exact placement needs PuLP with the HiGHS solver (`highspy`); without HiGHS it falls back to
PuLP's bundled CBC.

Greenfield (new dwellings at one manhole, the Sim 2.5 grid re-run on the gate):

```
python sim25_grid.py --cases all --only ii0.40 --workers 6                    # Severe
python sim25_grid.py --cases all --only ii0.25 --sizes 80,150,700 --workers 6 # Beyond design
```

Outputs land in `results/sim25/grid_whole/`, one folder per case. On the development machine
a whole-area run takes about 20 s; the infill sweep took a few hours on 6 workers, Severe
greenfield about 4 hours. Use `--resume` after an interruption.

## Simulation 3.5

Runs no SWMM: `sim35_capacity.py`, `sim35_capacity_check.py`, `sim35_mix.py`, `sim35_float_check.py`,
`sim35_coverage.py` and `sim35_greenfield_curve.py` re-read the Sim 3 page's
`simulation3/data/regions.js` and write `results/sim35/`. The page's data file
(`simulation35/data/sim35.js`) was built by a builder that is not in the repository; its warn sets
came from the method now in `sim35_warn.py`, which reproduces them exactly when run unset.

## Simulation 4

The six-step story, on equal-home regions: the spatial bisection method of Kim et al. (2022,
J. Environ. Manage. 320:115806). Each round cuts every part at the pipe whose upstream side and
downstream remainder hold the most nearly equal number of existing dwellings; 3 rounds give 8
regions (233 to 418 dwellings), plus the Walkerville Terrace corridor as a ninth, overlapping
scenario (`simulation.regions.bisection` in `config.js`). Simulations 3 and 3.5 keep the hand-picked
regions.

SWMM runs (on an Apple-silicon Mac the 504-run sweep took 45 min on 9 workers), from `simulation_src/`:

```
python sim3_regions.py --plan --partition bisection                  # the regions, nothing run
python sim3_regions.py --cases all --partition bisection --workers 9 # results/sim3/regions_bisection/
python sim3_analysis.py --partition bisection                        # its analysis.json and report.md
```

Then the page's regions, the figures (no SWMM, about a minute) and the page's data, from the
repository root:

```
python tools/build_sim3_regions.py --partition bisection --out simulation4/data/regions.js
cd simulation_src
SIM35_TARGET=sim4 python sim35_capacity.py   # capacity bands on Sim 4's regions, results/sim4/capacity.json
python sim4_numbers.py                        # results/sim4/numbers.json and numbers_report.txt
python sim4_float.py                          # level or float for the same money: float.json, float_report.txt
SIM35_TARGET=sim35 python sim4_numbers.py     # the same on the hand-picked regions: numbers_handpicked.json
SIM35_TARGET=sim35 python sim4_float.py       # and float_handpicked.json
cd ..
python tools/build_sim4_web.py                # simulation4/data/sim4.js; --check compares instead
```

The page's Expert panel has Play, Tables and Limits. Play scores any weather case, region, share of homes and
budget in the browser from the regions file's rows, with the rules of `sim4_numbers.py` and `sim4_float.py`; on the
story's selection it lands on their figures for all 8 budgets, floats and free mix included. `float_handpicked.json`
matches the team's published float run on every score; one free-mix set at $150k swaps a level sensor for a tie.

The story's Explore button opens `simulation4/explore.html`: Simulation 3.5's full view on the same
regions. Its data needs the rest of the Sim 3.5 analysis on Sim 4's regions, then its own builder:

```
cd simulation_src && export SIM35_TARGET=sim4
python sim35_capacity_check.py && python sim35_mix.py && python sim35_warn.py
python sim35_float_check.py && python sim35_coverage.py
unset SIM35_TARGET && cd ..
python tools/build_sim4_explore.py            # simulation4/data/explore.js; --check compares instead
```

Its sensors default to the story's own list (`simulation4/data/sim4.js`), scored over every region and
the stress steps; Simulation 3.5's methods stay as comparisons. Its Room for homes tab is Sim 3.5's
configurable one (`simulation35/room_calc.js`); `node tools/check_room_calc.js --sim4` checks it on these regions.

`SIM35_TARGET=sim4` makes the Sim 3.5 scripts read `simulation4/data/regions.js` and write
`results/sim4/`; `sim4_numbers.py` sets it for itself. Unset, those scripts are Simulation 3.5 as
published. The builder writes every number, region list and sensor note from `numbers.json`; given
the hand-picked regions' figures it reproduces the page as first published, credits aside.
`numbers_handpicked.json` (byte for byte the team's published figures) feeds the Expert panel's
comparison of the two region cuts: 4 of the 5 sensors are the same either way, while the regions to
watch, and whether a design day needs one sensor or two, change with the cut.

### Greenfield (Sim 4)

Greenfield here means a new estate network outside the existing network, joining it at one
manhole. Infill adds homes inside the existing network, across its existing connection points.
`sim4_greenfield.py` tests each eligible estate connection separately.

A connection must be a line-end manhole receiving neither pumped nor outside flow. Every
downstream reticulation sewer must stay within the SA Water Sewerage Code Supplement Pt 1
Table 4.4 property limits: 400 at DN150, 1,000 at DN225 and 1,800 at DN300. Headroom is what
remains after counting existing properties, outside-inflow properties and properties transferred
by pumps. The check follows every downstream route, including pump links, and counts shared
upstream properties once per pipe. Below DN150 and at other unlisted reticulation diameters,
the code scales the limit at equal slope and roughness; this is a team calculation. DN375+
trunk capacity is left to the SWMM runs, with no Table 4.4 property cap applied to those pipes.

Of 328 candidate manholes, 13 are eligible. The exclusions are 297 not at a line end, 15 with
headroom below 10 properties, 3 receiving pumped or outside flow, and 0 with unknown diameter.
Each excluded site counts under one reason, checked in this order: pumped or outside flow,
line end, unknown diameter, then minimum headroom.

Each site has up to four estate sizes: the largest configured steps below its headroom, then
the headroom itself rounded down to whole properties. The saved plan has four sizes at each
of the 13 sites, or 52 site-size combinations per case. For example, MH4451576 has 30, 80,
150 and 292 homes. Across the 8 cases this is 416 growth runs plus 8 baselines, using the same
settle gate as infill. All 424 saved runs settled; no cases are missing.

From `simulation_src/` (replace `N` with the number of worker processes):

```
python sim4_greenfield.py --plan
python sim4_greenfield.py --run --cases all --workers N --resume
python test_sim4_greenfield.py
python sim4_greenfield_eval.py
python ../tools/build_sim4_greenfield.py          # add --check to compare without writing
```

The plan command writes `results/sim4/greenfield/plan.json` and `plan.txt` without running SWMM.
The sweep saves a `summary.json` and baseline SWMM files in each case folder there; temporary
growth SWMM files are removed. The evaluation writes `eval.json` and `eval_report.txt`, with
detection shares, missed sites, first detection and first new chamber surcharge. The builder
writes `../simulation4/data/greenfield.js` for the explorer; `--check` compares it with a rebuild.

The same recommended 5 infill sensors are tested: MH4450531, MH4448345, MH4450922, MH4452994
and MH4428268. At a 25 mm rise from each chamber's baseline, the saved report gives:

| Case | Greenfield detected | Paired infill detected |
|---|---|---|
| Dry | 1/52 (1.9%) | 0/52 (0.0%) |
| Design wet | 2/52 (3.8%) | 4/52 (7.7%) |
| Beyond design | 21/52 (40.4%) | 11/52 (21.2%) |
| Severe | 29/52 (55.8%) | 20/52 (38.5%) |
| Design wet + age-weighted I&I | 1/52 (1.9%) | 4/52 (7.7%) |
| Design wet + outside inflow x1.5 | 4/52 (7.7%) | 4/52 (7.7%) |
| Beyond design + age-weighted I&I | 21/52 (40.4%) | 11/52 (21.2%) |
| Beyond design + outside inflow x1.5 | 21/52 (40.4%) | 5/52 (9.6%) |

Each estate site-size counts once, including scenarios no chamber can detect. Paired infill
uses the nearest saved homes count in the site's containing non-overlapping region, choosing
fewer homes on a tie, without interpolation. The evaluation also checks a 10 mm rise.

The 5 sensors miss these estate connections at every tested size under the 25 mm rule:

- Dry and Design wet + age-weighted I&I: MH1623436, MH1630702, MH4450787, MH4452760,
  MH4452919, MH4453095, MH4453315, MH4453981, MH4454395, MH4498291, MH5164627, MH5216010.
- Design wet: MH1623436, MH1630702, MH4452760, MH4452919, MH4453095, MH4453315,
  MH4453981, MH4454395, MH4498291, MH5164627, MH5216010.
- Beyond design and Beyond design + age-weighted I&I: MH1623436, MH1630702, MH4453315,
  MH4454395, MH4498291, MH5164627.
- Severe: MH1630702, MH4498291.
- Design wet + outside inflow x1.5: MH1623436, MH1630702, MH4452760, MH4452919,
  MH4453315, MH4453981, MH4454395, MH4498291, MH5164627, MH5216010.
- Beyond design + outside inflow x1.5: MH1623436, MH1630702, MH4498291.

Assumptions:

- Estate sizes are assumed test stages, not recorded development stages.
- The single line-end connection rule is assumed; these are not recorded estate connection points.
- The estate adds sewage only, with no infiltration from its new pipes; their lengths and
  infiltration are unknown.
- The estate drawn on the explorer is illustrative, not a surveyed or simulated estate pipe layout.

These are team assumptions because no public data gives per-estate sewer connection points or
stage sizes. PlanSA reports regional totals: about 2,500 greenfield dwellings a year in Greater
Adelaide over 2017-2021, not the sites or stages used here. See the
[Land Supply Report for Greater Adelaide - Residential 2022](https://www.plan.sa.gov.au/__data/assets/pdf_file/0007/1267486/Land-Supply-Report-for-Greater-Adelaide-Residential-June-2022.pdf),
section 3.1. Table 4.4 informs the headroom screen; it does not prescribe estate sites or sizes.

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
