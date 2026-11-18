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
connection on the network's edge. Infill adds homes inside the existing network, across its
existing connection points. `sim4_greenfield.py` tests each eligible estate connection separately.

A connection is an edge point: an open sector of at least 120 degrees with no pipes or homes
within 200 m, clear for 400 m along its middle, so the estate joins through a short new
connection beside open land. Points receiving pumped or outside flow are excluded, and so are
exits, where sewage leaves the model; an exit is never a connection. Edge points on the same open
land form a land group (chained within 300 m and 45 degrees of bearing), and a land group keeps
one connection for each distinct set of downstream sensors. The distances, the sector and the
grouping are team assumptions.

Room is the number of homes the downstream pipes can still take. Every downstream reticulation
sewer must stay within the sewer supplement Table 4.4 property limits: 400 at DN150, 1,000 at
DN225 and 1,800 at DN300. DN150 to DN300 use log-log interpolation between those sizes, and
below DN150 the limit scales from DN150; both are team calculations. DN375+ trunk capacity is
left to the SWMM runs, with no Table 4.4 property cap applied to those pipes. Headroom is what
remains after counting existing properties, outside-inflow properties and properties transferred
by pumps. The check follows every downstream route, including pump links, and counts shared
upstream properties once per pipe.

Of 887 candidate edge points, 9 are connections, in 9 land groups: 5 manholes and 4 pipe ends.
The exclusions are 763 not on the network's edge, 38 with room below 10 homes, 18 receiving
pumped or outside flow, 7 exits and 52 sharing land and downstream sensors with a kept
connection. No pipe has an unknown diameter.

Estate sizes step through 10, 30, 80, 150, 300, 600 and 1,000 homes, capped at the connection's
room; the steps are test stages, not recorded development stages. That gives 55 sizes per case.
There are 11 cases: the same 8 weather cases as infill, plus three on Design wet. `_pumprate`
has estates that are pumped or of unknown pump status discharge at 7.854 L/s or their peak flow,
whichever is larger; `_together` loads every land group's main connection at once; and
`_with_infill` puts the estates on top of the largest infill step. Two connections are known to
be pumped and 7 are unknown, which run both load variants. The plan is 510 runs, including 11
baselines, using the same settle gate as infill.

From `simulation_src/` (replace `N` with the number of worker processes). The infill sensors
come from `results/sim4/numbers.json`, so `sim4_numbers.py` above runs first:

```
python sim4_greenfield.py --plan
PYTHONPATH=. python ../tools/check_sim4_greenfield_plan.py
python sim4_greenfield.py --run --cases all --workers N --resume
python test_sim4_greenfield.py
python sim4_greenfield_eval.py
python ../tools/build_sim4_greenfield.py          # add --check to compare without writing
```

The plan command writes `results/sim4/greenfield/plan.json` and `plan.txt` without running SWMM.
The checker is written independently: it does not import `sim4_greenfield.py`, rebuilds the
connections, land groups and room from the network, and compares them with `plan.json`, printing
PASS or FAIL for each rule. The sweep saves a `summary.json` and baseline SWMM files in each case
folder there; temporary growth SWMM files are removed. The evaluation writes `eval.json` and
`eval_report.txt`, with detection shares, first detection and first new chamber surcharge. The
builder writes `../simulation4/data/greenfield.js` for the explorer; `--check` compares it with a
rebuild.

The same recommended 5 infill sensors are tested: MH4450531, MH4448345, MH4450922, MH4452994
and MH4428268. The model is uncalibrated, so these are runs the sensors see as a level rise of
10 mm or more, out of the runs that settled. A run is direct when the estate's sewage flows past
the sensor and indirect when the sensor sees backwater:

| Case | Seen | Direct | Indirect |
|---|---|---|---|
| Dry | 3 of 54 | 3 | 0 |
| Design wet | 6 of 55 | 2 | 4 |
| Beyond design | 17 of 55 | 4 | 13 |
| Severe | 23 of 55 | 4 | 19 |
| Design wet + age-weighted I&I | 5 of 55 | 2 | 3 |
| Design wet + outside inflow x1.5 | 6 of 55 | 2 | 4 |
| Beyond design + age-weighted I&I | 17 of 55 | 4 | 13 |
| Beyond design + outside inflow x1.5 | 18 of 55 | 4 | 14 |

One run did not settle and is excluded: Dry, MH4452680 at 1,000 homes. All direct hits come from
one connection, MH4450314. The evaluation also reports 25 and 50 mm rises.

Assumptions:

- Estate sizes are assumed test stages, not recorded development stages.
- The edge rule and the land-group distances are assumed; these are not recorded estate connection points.
- The estate adds sewage only, at 2.3 people per new dwelling and a peaking factor of 2, with no
  infiltration from its new pipes; their lengths and infiltration are unknown.
- The estate drawn on the explorer is illustrative, not a surveyed or simulated estate pipe layout.

These are team assumptions because no public data gives per-estate sewer connection points or
stage sizes. PlanSA reports regional totals: about 2,500 greenfield dwellings a year in Greater
Adelaide over 2017-2021, not the sites or stages used here. See the
[Land Supply Report for Greater Adelaide - Residential 2022](https://www.plan.sa.gov.au/__data/assets/pdf_file/0007/1267486/Land-Supply-Report-for-Greater-Adelaide-Residential-June-2022.pdf),
section 3.1. Table 4.4 informs the room screen; it does not prescribe estate sites or sizes.

#### Scenario sets

The Sim 3.5 scripts can run the same algorithms on the estates instead of, or beside, the infill
regions. `SIM4_SET=infill|greenfield|both` (default `infill`) picks the set, and it applies only
with `SIM35_TARGET=sim4`. `sim4_sets.py` turns the saved estate runs into the same row format as
infill, so no algorithm changes. Infill outputs stay in `results/sim4/`, byte for byte as before;
the other sets write `results/sim4_set_greenfield/` and `results/sim4_set_both/`. From
`simulation_src/`, with the plan and sweep already run:

```
export SIM35_TARGET=sim4 SIM4_SET=both        # or greenfield
python sim35_capacity.py && python sim35_mix.py && python sim35_warn.py
python sim35_float_check.py && python sim35_coverage.py
python sim4_numbers.py && python sim4_float.py
unset SIM35_TARGET SIM4_SET
python test_sim4_sets.py
```

Coverage is the share of the scenarios that some manhole sees at 10 mm which the sensors see,
shown as the worst wet case / the average of the 7 wet cases. Five sensors chosen on each set,
scored on each set:

| Five sensors chosen on | Scored on infill | Scored on greenfield | Scored on both |
|---|---|---|---|
| Infill only (today's five) | 81% / 94% | 17% / 40% | 44% / 59% |
| Infill + greenfield: MH4450922, MH4454376, MH1630926, MH4448345, MH1625316 | 50% / 84% | 53% / 69% | 67% / 74% |
| Greenfield only: MH4452527, MH1630926, MH4450802, MH1625316, MH4456468 | 13% / 27% | 70% / 75% | not computed |

The published recommendation is still the infill five; the infill + greenfield five is a
comparison, and whether it replaces the recommendation is not decided. In the both set the
ladder's five equals the exact best at five, and 8 sensors reach 78% / 84%. The exact fewest
sensors for all 7 wet cases are 8, 11 and 20 for 80%, 90% and 100% on both, and 6, 8 and 12 on
greenfield alone. Greenfield estates have no capacity band, so all 9 count as monitor, and in
the both set about 30 estate scenarios per case sit beside the infill ones. The cross-family
scores were recomputed from the raw runs outside the repository scripts.

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
