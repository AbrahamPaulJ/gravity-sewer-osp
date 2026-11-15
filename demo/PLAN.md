# Product demo: plan and status

Branch `rijoy/final-presentation`. Updated 2026-11-15.

## What it is

An app, not slides. The client (or anyone) opens the **"Product demo" tab** in the site's navbar and explores the problem, the
data, the method, the results and what comes next on **one live map** of the network. Every number on the page is
recomputed from Simulation 4's runs, or read from Sim 4's tables. Text is short: one line of lede per view, the rest
is controls, the map and charts.

Navigation: four chapters across the top, each with its views. ← / → step through, and every view has a "Next" button and
its own link (`demo/index.html#compare`). Each view opens on the whole network; zoom, pan, hover and click work in every view.

## The storyline (presenter order) and what each view lets you do

| Chapter | View | What the user does | What they see | Data |
|---|---|---|---|---|
| **1 Problem** | **Setting** | Drags "homes added" and picks the weather on a cutaway of a real manhole; switches what is in and out of scope | Water climbing past the 0.7 limit, the pipe top (surcharge) and the lid (overflow); the map of homes and of manholes already surcharged | Sim 4 runs; grey literature (capacity events carry most overflow volume) |
| | **Network** | Colours the pipes by age, size, material, slope, depth, Manning capacity or flow/capacity today; clicks a histogram bar to light those pipes; clicks a pipe | The network as data: a histogram per attribute; a pipe card with Manning's equation worked through; what we have, what we assumed, what is missing | `catchment.js` (pcap is Manning full-pipe capacity, checked) |
| **2 Approach** | **Simulate** | Steps through the two-part process (homes → flows → water levels → placement); picks a region, build-out and weather, or a scenario; clicks a manhole | The run matrix (9 regions × 7 steps × 8 weather = 504 runs); the weather cases; the rise at every manhole, new surcharges and spills | Sim 4 runs |
| | **What the runs show** | Picks a measure (rise ≥ 10 mm, past the 0.7 limit, surcharged), filters weather and build-out, clicks a hotspot | Manholes sized by how often they respond; splits by weather and by build-out; a top-10 hotspot list | Sim 4 runs |
| | **Placing sensors** | Picks a method; steps the greedy one sensor at a time | The candidate heat map ("what each manhole would add next"), why greedy, max–min, the nested ladder, the exact check and the baselines | Engine + `compare.js` |
| **3 Results** | **Compare** | Picks the number of sensors; clicks a method; switches the rule (10/25/50 mm); fails sensors | One table, seven methods, six measures (average, worst case, overloads warned, unseen weather, after one failure, cost); curves by count; sites on the map | Engine + `compare.js` |
| | **Cross-check** | Picks a screen (flow/capacity, slope, depth today, homes upstream); hovers the scatter | The screen against the simulated response, with Spearman ρ; where they agree, where they don't (backwater) and why we simulate; the Manning check on any pipe, with homes and leakage sliders | Engine; `catchment.js` |
| | **Sensor types** | Picks a sensor type; drags the water on the cutaway | Where each type sits and what it reads; what the plan sees with level sensors against floats for the same money; utilities doing this, cited | Sim 4 float table; grey literature; CIWEM 2017 |
| **4 Next** | **Repeat** | Chooses regions, weather, rule, aim and budget, then Place sensors; or places their own | The method re-run live; the data checklist for another suburb; how to read the results; the other objectives a real plan weighs | Engine |
| | **Next research** | Slides a risk weight; picks sensors for "virtual sensing" | Sites shifting towards sensitive places (risk-weighted coverage); how many manholes the sensors could stand in for (a simple stand-in for an Edge-STGCN surrogate, He et al. 2025) | Sim 4 risk weights; engine |
| | **Conclusion** | Chooses the 1- or 5-sensor plan | What to do, how sure we are, what we need from the client, links | Sim 4 |

Suggested speaking split for 5 presenters (not equal, by chapter): Problem (setting + network) · Approach: simulation ·
Approach: placement · Results (compare + cross-check + sensors) · Next (repeat + research + conclusion). Target 25 min plus questions.

## Checked numbers this plan relies on (2026-11-15)

- **Engine matches Sim 4:** 1 sensor 0% / 53% with 8 warned; 5 sensors 81% / 94% with 11 of 11; 25 mm rule 36% / 45%.
- **Manning:** `pcap` = (1/n)·A·R^(2/3)·S^(1/2) (450 mm clay at 0.28%: 151 L/s, file 151.1).
- **A basic screen agrees with the simulation, mostly:**
  - Over the 183 manholes that respond on a design wet day, estimated flow / Manning capacity ranks them like the simulated rise at
    2041 (Spearman ρ = 0.74). Homes upstream gives 0.75, today's simulated depth 0.73 and slope 0.48.
  - Sim 4's five sit between the 67th and 93rd percentile on flow/capacity.
  - Where they disagree, backwater is the cause: for example, a manhole surcharged before growth has only 4% utilisation on its own pipe, because water
    backs up from downstream.
  - Ranking well is not placing well: "most homes upstream" ranks like the model, yet as a placement it sees 12% / 0%.
- **Placement methods at 5 sensors** (worst / average / warned / unseen weather), from `tools/build_demo_data.js`:
  - **Best coverage (exact), the recommendation:** 88 / 94 / 11 / 75.
  - Nested list (Sim 4's story): 81 / 94 / 11 / 77.
  - Greedy, average: 88 / 94 / 11 / 74 (ties with exact).
  - Greedy, worst case: 80 / 92 / 10 / 74.
  - Desk flow/capacity: 25 / 73 / 9.
  - Most homes upstream: 0 / 12 / 2.
  - Random: 6 / 47 / 7.5.
- **Decision (2026-11-16): the recommendation is the best-coverage set,** i.e. Sim 4's exact solver
  (`SIM4.explore.exact`): the set that sees the most growth runs in the worst wet case, then on average, then warns of the most overloads.
  The nested list is shown as a comparison.
  - The build script re-solves it exactly. Dominated manholes are dropped, leaving about 20 candidates, and every combination is searched.
    It matches Sim 4's exact scores at 1–8 sensors and computes unseen weather (held-out exact sets).
  - The exact five: MH4428268, MH4448345, MH4449796, MH4450922, MH4452680; 3 are shared with the nested five. They see 15 of 16 runs on a design wet day.
    At 25 mm they score 31% / 46%.
  - The page numbers sensors by the loss if each fails. **Sensor 1 = MH4450922**: if it fails, the worst case drops to 0%. It was the nested list's Sensor 3,
    and it is already surcharged before growth.
  - Not nested: the best 4 and the best 5 differ, so a 1 → 5 upgrade would move sensors. That is the trade-off.
  - 🟠 **Sim 4's own pages still recommend the nested list** (explore.html "Sim 4's list: the recommendation"; the story's 81% / 77%). Align
    them, or say why they differ, before the client sees both.

## Results review (Sim 4): what can be put forward

- ✅ **Firm (as model results):**
  - 890 pipes, 328 manholes;
  - 7 manholes surcharged before growth on a design wet day;
  - 5 of 9 regions raise the water ≥ 10 mm;
  - the recommended 5 sensors see 94% / 88% and warn of 11 of 11, with 75% on unseen weather;
  - no other set of 5 covers more (exact);
  - random sites see 47% / 6%;
  - floats see 0% on unseen weather;
  - 4 of 5 sensors are robust to how the regions are cut.
- 🟠 **Say carefully:**
  - Percentages are of growth that shows anywhere (16 of 25 runs on a design wet day).
  - "No new surcharge by 2041" holds on a design wet day only.
  - Many sets tie: read the sites as areas, not exact lids.
  - The regions' 2041 homes total about 436, not 485.
  - Three thresholds are in play: 0.7 limit, pipe top, 10 mm.
  - The worst case rests on one site (Sensor 1, MH4450922), already surcharged before growth.
  - The 25 mm rule keeps the 10 mm denominator.
- 🔴 **Check:** `MH4501866` newly surcharges in severe weather at 25% growth in a "Leave" region, against Sim 4's "R5 keeps room in all 7 wet cases".
- ⛔ **Don't claim:** exact lids as *the* sites, dates or timing, costs as a budget, the virtual-sensing share as a model result
  (it is a correlation stand-in, not a trained network).

## Build

- `demo/index.html` (layout, styles) and `demo/app.js` (engine, map, views). `demo/data/compare.js` comes from
  `node tools/build_demo_data.js`. Re-run it whenever Sim 4's data or the engine changes, and bump the `?v=` keys.
- No client, suburb or street names in page text: the repository is public.

## To do

1. Team review of wording, then a timed run-through on Teams.
2. ~~Move the headless check into `tools/verify_demo.js`~~ done: `node tools/verify_demo.js [shots]`, 35 checks.
3. Investigate `MH4501866`.
4. Optional:
   - a three-hint first-visit tour;
   - a print view.
5. Then commit, PR, merge, tag a final release, and assemble the handover pack.

## Wrapping up the project

1. Tag a final release.
2. Regroup the landing page: demo first, then Sim 4, then supporting work and the archive.
3. Close the open branches.
4. Put together the handover pack: the link, a one-page summary, the data request list and the redo guide.
5. Propose a one-sensor pilot for one wet season.
6. Record a walkthrough.
7. Add a retrospective to the report.
