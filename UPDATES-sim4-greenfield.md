# Sim 4 greenfield: updates on branch `sid/sim4-greenfield`

This file covers the greenfield work on this branch, from its first commit to 18 November 2026. The interface simplification work done in parallel is not covered here. Sections 3 to 8 were committed together after `3fb6d4d`.

Labels: **sourced** (a standard or paper), **own choice** (team decision, open to change), **measured** (read from the code or results).

## 1. Question

Sim 4 chose five level sensors from infill growth only (`results/sim4/numbers.json`): MH4450531, MH4448345, MH4450922, MH4452994 and MH4428268. The greenfield family asks a separate question. If a new estate is built on open land at the edge of the network, do those sensors notice it? It is not a planning, serviceability or capacity study.

## 2. Committed: `3fb6d4d` (17 Nov)

- The first version of the greenfield family. Edge manholes with an open sector were clustered into 6 representative sites, then a sweep of 339 settled runs was evaluated at 10, 25 and 50 mm.
- An imaginary street map was drawn around the network's exit points, using local street statistics. The statistics are cached in `simulation_src/data/street_stats.json`, and the raw OSM extract stays out of the repo.
- Explore can show estate manholes, streets and rising mains in 3D, and has Recentre and Compass buttons.
- The overview page has start-here cards and a timeline of the simulations.

## 3. The final site rules (`sim4_greenfield.py`, `plan.json`, `plan.txt`)

The 6-site version was replaced after six independent reviews. The decisions are recorded in `tmp/sim4_greenfield_decisions_v2.md`, outside the repo.

| Rule | Value | Label |
|---|---|---|
| Nodes that may take an estate | every edge manhole and pipe end; 887 tested | own choice |
| The edge | an open sector of at least 120° with no pipe or home within 200 m, and clear for 400 m along its middle; points within 15 m are ignored | own choice |
| Homes a connection can take | sewer supplement Table 4.4 (DN150–300), log-log between anchors, applied to the total load on every downstream reticulation pipe; DN375 and above are left to SWMM | Table 4.4 sourced; the interpolation is own choice |
| Grouping | edge points on the same land with the same downstream sensors share one connection | own choice |
| Estate sizes | 10 to 1,000 homes, capped by each connection's room | own choice |
| Estate load | sewage only, 2.3 people per new home, peaking factor 2, no infiltration from the new pipes | own choice |

Result:
- 9 of 887 candidates are eligible: N153, N67, MH4450314, MH1631057, N331, MH1630702, N677, MH4452680 and MH4452902.
- Of the rest, 763 are not on the edge, 38 have less than 10 homes of room, 18 receive pumped or outside flow, 7 are where sewage leaves the model, and 52 share land and sensors with a chosen connection.
- 510 planned runs: 11 cases × the planned sizes, plus 11 baselines.

The tests in `test_sim4_greenfield.py` were updated (27 pass). An independent checker, `tools/check_sim4_greenfield_plan.py`, recomputes the plan without importing the planner. It prints ALL PASS, and it caught all five planted errors.

## 4. SWMM sweep and evaluation

- The full sweep ran on the new plan. It has 499 growth runs across the 11 case folders plus 11 baselines, and replaces the old `summary.json`, `model.rpt` and `model.inp` files.
- One growth run did not settle and is excluded: MH4452680 at 1,000 homes, in the Dry case.
- `sim4_greenfield_eval.py` now marks each hit as **direct** or **indirect**:
  - **direct:** the sensor lies downstream of the connection, following gravity pipes and pump links;
  - **indirect:** any other hit, which is a backwater response.
- Results are in `eval.json` and `eval_report.txt`. With the infill sensors fixed, the share of greenfield scenarios seen at 10 mm is:

| Case | Seen, of all valid | Seen, of those some manhole shows |
|---|---|---|
| Dry | 6.7% | 11.8% |
| Design wet | 10.8% | 19.6% |
| Beyond design | 31.6% | 52.3% |

So the infill placement sees little of the edge growth in normal weather. Most of what it misses either shows no 10 mm rise at any manhole, or rises only at manholes without a sensor (measured).

## 5. The same algorithms on three scenario sets

- New module `simulation_src/sim4_sets.py` and its tests in `test_sim4_sets.py`.
- The environment switch `SIM4_SET` is `infill` (the default), `greenfield` or `both`. Every existing algorithm runs unchanged on the chosen set:
  - the story ladder, checked against the exact solver;
  - fewest sensors for 80, 90 and 100%;
  - held out by case and by region;
  - mix, warn, float check, coverage and float.
- Greenfield rows enter in the infill row format. The size filter is now each row's own fraction of its limit: build-out for infill, homes over the room for greenfield.
- Edited files: `sim35_capacity.py`, `sim35_mix.py`, `sim35_warn.py`, `sim4_numbers.py`, `sim4_float.py`.
- `SIM4_SET=infill` reproduces the existing `results/sim4/*.json` byte for byte. New outputs are in `results/sim4_set_greenfield/` and `results/sim4_set_both/`.

| Set | Five sensors (story ladder) | Wet worst | Wet average |
|---|---|---|---|
| infill (current) | MH4450531, MH4448345, MH4450922, MH4452994, MH4428268 | 81.3% | 93.9% |
| greenfield only | MH4452527, MH1630926, MH4450802, MH1625316, MH4456468 | 70.0% | 74.9% |
| infill + greenfield | MH4450922, MH4454376, MH1630926, MH4448345, MH1625316 | 67.4% | 74.1% |

When greenfield is included, three of the five sensors change. MH4450922 and MH4448345 stay. **Open decision:** keep the infill five as the recommendation, or switch to the combined five.

## 6. Estate drawings (`tools/build_sim4_estates.py`, `simulation4/data/estates.js`)

The estates were redrawn so that they follow sewer design rules:
- Each estate uses blocks that no other estate holds, so no two estates overlap.
- Sewers are laid only in streets that serve homes.
- Each run between manholes is graded on its own:
  - at least 0.5% grade and 1.4 m of cover;
  - a drop where a pipe arrives more than 0.05 m above the manhole;
  - no pipe deeper than 6.5 m.
  - Before the redraw, depths reached 41 m and grades 38%.
- Where gravity is not possible, a main wet well is used. Lift wells are added where a sewer would pass 6.5 m deep. N67 needs 8 lift wells, because its land is flat.
- Manholes are placed at junctions, ends, changes of grade and direction, and at the length limit. Grade-break manholes are added only where they are needed.
- Each larger estate size contains the smaller one.

- A dead-end sewer stops at a plain pipe end, not a manhole. In the real network, 138 of 160 dead ends have no chamber; junctions (142 of 148) and bends over 30° (44 of 49) mostly do (measured from the network's node records).
- House footprints vary inside each lot: plain, L-shaped, stepped, or with a narrower rear wing. The 3D view draws estate homes and streets at the level of the nearest estate sewer, as it draws the network's own homes on the main they join.

An independent checker, `tools/check_sim4_estates.py`, tests every estate size against the plan and these rules, plus density against the real network. The area is the land within 30 m of a connected home, measured the same way for both. Each estate must stay within 30% of the real network's 1.51 manholes and 11.9 homes per hectare. The 30% band is own choice. With a 10% band it fails 7 checks, so it does catch drift.

| | Manholes per ha | Homes per ha | Homes per manhole |
|---|---|---|---|
| Real network | 1.51 | 11.9 | 7.9 |
| All 9 estates | 1.43 | 11.0 | 7.7 |
| Range across estates | 1.14–1.71 | 10.1–11.9 | 5.9–10.4 |

Manholes fell from 329 to 130 at MH4452680. All 9 estates are pumped, so the plan, which reads only the pumped flag, is unchanged.

## 7. Pages and documents

- `simulation4/data/greenfield.js` and `simulation4/greenfield_runs.js`, built by `tools/build_sim4_greenfield.py`, carry the 9 connections and their exit points.
- Explore (`explore_ui.js`, `explore.html`) draws every connection's largest estate. The 3D view (`simulation35/growth_3d.js`) draws lift wells and dashed lift mains.
- The redo guide's greenfield section was rewritten to describe the current plan. It is built by `tools/build_sim4_web.py` into `simulation4/redo.html`.
- `README.md`, `simulation_src/README.md`, `ARCHITECTURE.md` and the product demo (`demo/`) were updated to match.

## 8. Explore view (`explore.html`, `explore_ui.js`, `simulation35/growth_3d.js`)

These change only how the map is drawn. No result changes.
- Homes are drawn as building outlines in Explore and on the story page, never as dots. The Houses button shows or hides the outlines with their connection pipes. The story page loads the outline data itself.
- In greenfield, the 9 edge connections are drawn at 3.4 times a manhole's size, and pulse by 20%.
- A **Sewer flow** button animates the flow direction:
  - squares move along every pipe from its upstream end to its downstream end (all 889 sloped pipes fall that way);
  - along the 3 rising mains, from the pump;
  - through the drawn estate sewers, downhill to the estate's well and on to the network manhole.
  - Each square is twice the drawn pipe's thickness and scales with zoom. Speed and spacing are for display only. Lift mains inside estates are not animated.
- The imaginary street map on the open land stays as background. It fades out with distance from the network, reaching nothing 1,200 m away (own choice), and is fainter in infill. Each estate draws its own streets at full strength. The flat datum grid is hidden while the street map is shown.
- When nothing moves, the 3D view redraws at most 30 times a second, with or without Sewer flow. Dragging, zooming or resizing returns it to the screen's full rate for 0.8 s. On a 120 Hz screen, idle drawing fell from 120 to 30 frames a second, and camera moves stayed at 120 (measured). The street fade is computed once per street map.
- The legend is open by default, in the bottom-right corner. The summary sits above the layer buttons, so neither covers the other.
- A refresh keeps the mode, family, choices, layers, Vertical slider and camera. A new visit (tab closed and reopened) starts at the defaults. Simple or Expert is no longer remembered between visits. The theme still is.

## 9. Checks run (18 Nov)

| Check | Result |
|---|---|
| `test_sim4_greenfield.py` | 27 passed |
| `test_sim4_sets.py` | OK |
| `tools/check_sim4_greenfield_plan.py` | ALL PASS |
| `tools/check_sim4_estates.py` (new) | ESTATES PASS |
| `check_sim4_numbers` | ALL PASS |
| `build_sim4_estates.py --check`, `build_sim4_greenfield.py --check`, `build_sim4_explore --check` | current |
| `verify_demo` | 53 passed |
| Browser: Explore with all 9 estates | draws correctly; no new console errors |
| Browser: Sewer flow, refresh and fresh open, legend and foot layout | as described in section 8 |
| Browser: frame rate, 120 Hz screen | idle 30 per second (was 120), moving 120 |

## 10. Still open

- Recommendation: the infill five or the combined five (section 5).
- `eval_report.txt` still describes "before surcharge" as at or below the first surcharge size. The stricter rule (strictly before) was proposed but not applied.
- `results/sim4/greenfield_prev_6site/` (19 MB, untracked) holds the old 6-site results. Keep it outside the repo, or delete it.
- Street and region names still appear in teammates' text (`README.md`, `simulation_src/README.md`, `index.html`, `config.js`).
- Limits:
  - steady peak hour only;
  - free outfall;
  - no pump duty-cycle bursts;
  - the land beyond the network is hypothetical open land.
