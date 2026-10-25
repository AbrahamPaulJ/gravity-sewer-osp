# Optimal sensor placement in gravity sewers

An interactive sandbox and two explainers for deciding **where to put level sensors in a
sewer network**, built entirely on openly published South Australian data.

**[Open the live site](https://abrahampaulj.github.io/gravity-sewer-osp/)**

Everything runs in the browser. No server, no build step, no tracking.

---

## What is here

| Page | What it is |
|---|---|
| `osp_sandbox.html` | The tool. Place a sensor budget on a real network, compare seven algorithms against four objectives, inspect the assumptions. |
| `manhole_anatomy.html` | Four rotatable 3D sections: one chamber inside, why every chamber on a run is a different depth, a chamber taking several pipes, and where a blockage sends the water. |
| `why_observability.html` | Draggable long section: the backwater wedge, and the arithmetic that limits how far a sensor can see. |
| `src/model/` | The models, pure and DOM-free: `osp_core.js` (graph, observability, placement), `osp_capacity.js`, `osp_risk.js`. Run from Node by the tests. |
| `src/ui/` | `osp_ui.js`, the sandbox page's state, canvas and controls; `osp_3d.js`, the optional relief view. |
| `src/docs/` | `osp_docs.js`, the assumptions register, method, Q&A and illustrated glossary, generated from the loaded data. |
| `data/` | `osp_data.js`, the generated dataset. Never edited by hand. |
| `config.js` | Every setting in one file: which pages the site shows, pipe roughness and age weights, the sandbox's blockage weights, loads, Simulation 2.5's study area, cases, detection rules and pump stations. Read by the browser, Node and Python (`simulation_src/osp_config.py`). |
| `simulation3/` | Simulation 3, the latest page: infill (eight areas, a build-out ladder) and greenfield growth under eight settled cases, exact and greedy placement, a simple view with an expert toggle. Built by the private repository's `build_sim3_web.py` from the same SWMM outputs; its renderer is a copy of `simulation25/growth_3d.js`. |
| `simulation25/` | Simulation 2.5, the browser view of the growth and sensor-placement grid, with a scenario builder and a choice of placement methods. |
| `simulation_src/` | EPA SWMM source, the exact public-data snapshot, saved outputs and full reproduction commands for Simulations 1, 2 and 2.5. |
| `tools/` | Regression tests, data formatting, and the public Sim 2.5 browser builder. The source-data harvester and sanitiser remain private. See `ARCHITECTURE.md`. |

Both explainers are standalone and need no data file. If the vocabulary is new, start with
`manhole_anatomy.html`.

To reproduce Sim 2.5 from the committed SWMM outputs, run
`python tools/build_sim25_web.py --check`. For a fresh solver reproduction (the whole-area grid is
8,200 SWMM runs, about 8.5 hours) and the complete setup instructions, see
[`simulation_src/README.md`](simulation_src/README.md).

To solve your own growth scenarios in SWMM from the page, serve the site with the local runner
instead of a plain web server:

```
~/.venvs/sewer/bin/python simulation_src/sim25_serve.py      # http://localhost:8001
```

A page opened from another local server (say `python3 -m http.server 8000`) finds the runner at
port 8001 too, as long as it is running. Without it, **Run in SWMM** and the pump rates stay
disabled and the page says so under the buttons.

## The problem

Blockages in gravity sewers cause overflows. Utilities fit level sensors in maintenance holes to
catch them early, but there are far more chambers than sensors, so placement decides how much of
the network is actually watched. A sensor sees a blockage only if the water backing up behind it
reaches that chamber, which makes this a set-cover problem over a directed acyclic graph.

**Overcapacity** is the same consequence by a different mechanism, and it is the one growth causes:
nothing is obstructed, flow simply accumulates until a reach exceeds what it was sized to carry.
Bottlenecks are few, predictable and fixed by geometry, so a placement optimised for blockage is
not optimised for overcapacity. Both are modelled here, and the tool keeps them separate.

## Findings worth more than the tool

**1. A depth proxy, not the terrain, was making the network look unobservable.**

The published placement condition uses a water-depth capacity term. When manhole depth is not
available, the natural substitute is pipe diameter. That understates the term by roughly nineteen
times, and it changes the answer completely:

| Depth used | Observable universe | Chambers observing nothing |
|---|---|---|
| Pipe diameter, 0.15 m | 157 / 1010 | **840 (83.2%)** |
| Measured depth, median 2.92 m | 813 / 1010 | **32 (3.2%)** |

Switch the model dropdown to "as published" in the sandbox to reproduce it.

**2. The invert fields are flow-anchored, not geometry-anchored.**

On both publishers examined, `START_INVE` is the upstream-of-flow invert whichever way the line was
digitised, and the flow-direction code says which geometric vertex that is. Verified by testing
which reading makes inverts agree at a chamber shared by two pipes:

| Reading | Utility network | Statewide layer |
|---|---|---|
| Geometry-anchored | 35.2% exact | 32.6% |
| Orient by comparing inverts | 37.0% exact | 36.4% |
| **Flow-anchored** | **95.3% exact** | **85.0%** |

Reading it the other way reverses 583 of 1,002 mains while leaving every record, node and edge
count unchanged, so the error survives every obvious sanity check. Chamber invert inconsistencies
fall from 462 to 4 once it is read correctly.

A consequence worth stating plainly: `START_INVE > END_INVERT` returning every record is **true by
definition of the field names**. It is a naming convention, not evidence that a network runs
downhill and not evidence that it is acyclic.

**3. A field that reads `UNKN` on half the network has its answer in the next column.**

`MATERIAL` is unknown on 456 of 1,002 mains, which reads as material being published on barely half
the network. `MATERIALUN` carries a value on **every one** of those 456, and on the 43 records where
both are populated the two agree every time. Reading the pair takes material from 54.5% to 100%:
906 vitrified clay, 94 uPVC, 1 reinforced concrete. Same shape as finding 2 — the field that looks
empty is not the only field.

**4. A second published field independently confirms the invert reading.**

The layer also publishes its own gradient. Against fall over length computed from the invert fields,
the median ratio is **1.0000** across 1,001 reaches, 796 of them inside &plusmn;5%. That is a
separately maintained field agreeing with the flow-anchored reading of finding 2, which is the
strongest confirmation available without a site visit. It also rescued the three reaches the
capacity model had been clamping for want of usable fall, one of which reads as running uphill.

**5. Two things that did not pan out, reported because they were checked.**

The per-pipe diameter, once fetched, turned out to equal the old `min(dia[u], dia[v])` proxy on
**1,001 of 1,001 reaches**. The proxy was exact and no capacity figure moved; the assumption was
retired because the value is now measured, not because it was wrong.

And the published `ROUGHNESS` field, which would have removed the Manning assumption outright, is
populated on **no record at all** here.

## The models

A blockage at node `v` is observable from a sensor at `s` when `v` is downstream of `s` and the
backed-up water stands deep enough at `s` to be told apart from a normal day:

```
ceiling[v] - invert[s] > detection threshold
```

`ceiling[v]` is where water escapes when `v` blocks, found by flood fill: raise the level, admit
upstream nodes as they come under it, take the running minimum of opening levels, and stop when the
next node's invert is already at or above that minimum. Because flow has stopped, the water surface
is **horizontal**, which is what makes this exact rather than approximate and why no gradient term
appears.

This replaces the published method's single global coefficient with per-node measured geometry. The
coefficient is retained as a comparison mode, not as the default.

**Capacity and growth** (`osp_capacity.js`) accumulates load down the graph in one exact pass and
solves each reach for the depth that flow would run at, using Manning for a circular channel running
part full. A reach whose flow exceeds its greatest passable flow is over capacity and the chamber
above it surcharges. It is a screening calculation — steady, uniform, normal depth, no backwater, no
routing, no storage, no time — and it must not be presented as a hydraulic model. Its output feeds
the observability machinery unchanged, because once a chamber surcharges the cause stops mattering.

**Blockage likelihood** (`osp_risk.js`) scores each reach from the published pipe attributes and
aggregates it to a per-chamber weight. This is the least measured of the three: the factors and
their directions come from the literature, but the weights on them are **declared, not calibrated**,
because no public source lists chokes for this network. The ranking of reaches is the claim; the
score is not.

All three reach the optimiser the same way — as a per-node weight vector. `weightOf` is the only
place that knows what an objective means, so every algorithm is weightable: "maximise nodes" is
simply every weight set to 1.

## Data

All figures come from services that answer anonymous queries and are named in the tool's
**Method and sources** tab, so anything here can be re-checked.

- Network: a council's open republication of the operator's sewer asset register. 1,002 gravity
  mains with invert levels on 100% of records, 360 mapped maintenance holes, 2,851 property
  inspection points, and a 1 m contour layer.
- Chamber depth is published almost nowhere, so it is reconstructed as cover level minus invert,
  with cover interpolated from contours and validated three ways:

| Validation | n | mean abs error | p90 |
|---|---|---|---|
| 1 m contours vs surveyed covers, same area | 10 | **0.23 m** | 0.41 m |
| 5 m contours vs surveyed levels, external set | 707 | 1.34 m | 2.62 m |
| 5 m subset vs full 1 m layer, same terrain | 1,009 | 1.85 m | 4.54 m |

The last two measure the same thing by different routes and agree, which is what makes the first
credible on a small sample.

- Per-pipe attributes are carried per reach, re-queried from the same mains layer the geometry came
  from and matched back by geometry rather than by any id, so the join can be re-checked:

| Attribute | Published | Used for |
|---|---|---|
| Nominal diameter | **100%** | reach capacity, likelihood, map line width |
| Material | **100%** (456 of them via the second field) | Manning's *n* per material, likelihood |
| Construction year | 99.5% | likelihood. Median 1912; 91.7% are over fifty years old |
| Gradient | 99.9% | rescues flat and adverse reaches, likelihood |
| Internal diameter | 54.4% | **nothing, deliberately** — see below |
| Joint type | 54.4% | likelihood only |
| Roughness | **0%** | unusable |

Internal diameter is the bore Manning actually wants, and it is carried but not used. At 54.4% it is
the *newer* half of the network, and since flow scales with roughly `D^(8/3)` mixing it with nominal
would compute capacity on a different basis for old pipe and new. When the claim is a ranking, a
uniform basis is worth more than a more accurate one applied unevenly.

## Limits

Stated here and in the tool, because they matter more than the scores.

1. **Nothing is validated against a recorded blockage.** No public source lists historical chokes or
   overflows, so this is a structural result: which chambers *would* see a blockage under this
   model, not whether they did.
2. **The detection threshold is declared, not calibrated.** No sensor readings for this network are
   public.
3. **Property relief gully levels are published nowhere.** They are usually the lowest opening and
   so control where water escapes. The proxy is reasoned from the plumbing standard, not measured.
4. **The network is clipped to a council boundary, not a catchment.** Anything near an edge is wrong
   in a known direction. For the capacity model this cuts the unsafe way: flow entering from outside
   the boundary is never counted, so reaches near an edge look healthier than they are.
5. **Demand is a setting, not a measurement.** The capacity model's load per chamber and peak factor
   are sliders, and they move the headline: Walkerville has zero chambers surcharging at 0.05 L/s
   and 132 at 0.9 L/s. Quote a surcharge count with its demand case attached or not at all.
6. **The likelihood weights are declared, not fitted**, for the same reason as limit 1. Worse, no
   single factor reproduces the blended ranking — age correlates 0.78 with it, bore &minus;0.13 —
   so **the weighting is the method, not a detail of it**. Age and bore even pull against each other
   here (rank correlation &minus;0.32), because this network's 1896 sewers are the *trunk* mains and
   the small-bore reticulation was infilled later. A condition model built where small pipe is also
   old pipe would not behave this way.

## Method

Implements the topology-and-elevation placement approach of Ninh, Do, Zeng and Lambert (2025),
*Optimal Sensor Placement in Smart Sewer Systems Using Network Topology and Elevation*, JWRPM
151(7), with the modifications described above. The capacity and likelihood models are additions
rather than part of that method, and both are registered as such.

Ninh 2025 names weighting by risk as its own obvious extension, and Crowley et al. (2025) name equal
node weighting as their own limitation; `osp_risk.js` is the join between that gap and the separate
literature on what actually makes a sewer fail.

Full provenance, including every assumption, what was changed and why, and what data would remove
each one, is in the tool's **Assumptions** tab, which is generated from the loaded dataset rather
than written by hand so its figures cannot drift from the model.

## Settings

Everything the project is run with lives in [`config.js`](config.js) at the repository root, one
file for the browser, Node and Python. Its object is plain JSON (double quotes, no comments, no
trailing commas); every choice carries an `"_"` note naming the values it allows. The comment at
the top of the file says what each section takes effect on:

| Section | Takes effect |
|---|---|
| `pages` | the landing page, on reload |
| `pipes.blockage_likelihood`, `pipes.manning_*` | the sandbox, on reload; Manning also feeds SWMM, so Simulation 2.5 needs a re-run |
| `pumps` | growth scenarios run by the local SWMM runner; restart it after an edit |
| `loads`, `simulation` | Simulation 2.5, after re-running the grid and `python tools/build_sim25_web.py --publish` |

## History

Simulation 2.5 and the site since the first public version (tag `v1.0`, 25 Sep 2026). Tag `v1.1`
marks 13 Oct 2026.

| Date | Change |
|---|---|
| 24 Sep 2026 | Sandbox: growth headroom per chamber, and an objective that maximises the growth capacity watched. |
| 25 Sep 2026 | Every declared number cited where it is declared. SWMM takes Manning's n from each pipe's material (VC 0.013, uPVC 0.010, RC 0.013), reading the second material field where the first says UNKN; Simulation 2.5 re-run. Reproducible page builder published. |
| 27 Sep 2026 | Pipes drawn at their own bore. `config.js` chooses which pages the site offers. |
| 1 Oct 2026 | Simulation 2.5 cases defined in one file and published with one command. |
| 2 Oct 2026 | Whole-area placement: all 328 manholes are growth sites and sensor candidates (8,200 SWMM runs). Height datum and ruler; each home's lateral; pipe width proportional to diameter; a details card for any pipe; a right-hand panel for the selected manhole. |
| 3 Oct 2026 | Pump stations and rising mains drawn apart from the gravity mains, with a chip to highlight them. |
| 8 Oct 2026 | Growth scenarios over many manholes, solved in SWMM by a local runner (`simulation_src/sim25_serve.py`) or estimated in the page. The sandbox's placement algorithms on this network, all scored on the same SWMM runs. |
| 13 Oct 2026 | Review fixes: the estimate trusted for depth rise only; the method comparison labelled for what it is (in-sample greedy, best-of-20 random). Tagged `v1.1`. |
| 14 Oct 2026 | All settings in one `config.js`, read by the browser, Node and Python. House connections drawn from the published connection layer, bends included, and checked line for line against the council map viewer; a Connections chip shows every one at its bore. Map controls: drag turns, right-drag moves, the wheel zooms to the pointer. Homes can sit at their main's level or above it. Pump stations at a set rate in growth scenarios (option A, below). |
| 15 Oct 2026 | Validation end to end: cases, growth sizes, rules, sensors, depths and overflows checked against the SWMM runs and on 400 page views. Overflow (spills from the lid) and rises below the rule shown on the map. Pumps in rated scenarios follow a head curve, so a station delivers less as the level it pumps against rises; overflow pipe 4433446, which sent N183's discharge back to its own wet well, relieves only when surcharged in those scenarios. |
| 16 Oct 2026 | Simulation 2.5 map made simpler to read: a **None** growth size, to select manholes and see the network before any growth; **Datum & ruler** and **Raised homes** toggles (the datum and ruler hidden by default; raised homes replace the `display` setting, removed from `config.js`); a one-line legend that shows only what is on the map, with the full key on demand; the scenario's **+ Add by number** list in manhole-number order; explanations folded behind ⓘ buttons; the optional map layers (heatmap, pump stations, house connections, datum and ruler, raised homes) in one **Layers** menu; the page opening on **None** with nothing selected. No result changes. |
| 22 Oct 2026 | Simulation 2.5 fixes: a page served from another local port finds the SWMM runner at port 8001 (the runner answers localhost pages only), and a page with no runner says so under **Run in SWMM**, not only in a tooltip (on the public site: that SWMM runs only on a local copy, with a link to how); the heatmap, pump-station, house-connection and whole-area keys show with their layer again, outside the collapsed full legend. No result changes. |
| 25 Oct 2026 | Assumptions register (Simulation 2.5; D9 and the legend also on Simulation 3): D9 dropped (the lining field, read by nothing); the register split into sections by group, with sub-sections where a group mixes topics, and numbered continuously within each group; a legend that is also a filter (group, status, risk) and a search. Old to new IDs: D10→D9, D11→D10, R9→R3, P01b→P02, P02→P03, P03→P04, P04→P05, P24→P06, P25→P07, P26→P08, P31→P09, P05→P10, P06→P11, P07→P12, P08→P13, P15→P14, P16→P15, P17→P16, P18→P17, P19→P18, P20→P19, P21→P20, P22→P21, P34→P22; every other ID is unchanged. No result changes. |
| 25 Oct 2026 | Registers trimmed to what each page's results rest on. Simulation 2.5: the rows only the earlier segment study, a test or a plan used (X3 to X5, P09, P21, R3, G12 to G14) move to a closing "Earlier work" section, kept for Findings 1 to 6. Simulation 3: its register, an out-of-date copy, is rebuilt from Simulation 2.5's with the same IDs, without the rows it does not use (set-rate pumps, the segment study, the 10-minute window, config.js), with its own run length, cases and detection rule, and its own rows G15 to G18 (infill areas, build-out ladder, time rule, risk weighting). No result changes. |
| 25 Oct 2026 | Simulation 2.5's "Earlier work" section removed: its rows (X3 to X5, P09, P21, R3, G12 to G14) were used only by the earlier segment study, a test or a plan, and remain in the Simulation 2.5 (legacy) tab's register. The register now lists only what today's results rest on (87 rows). No result changes. |
| 25 Oct 2026 | Simulation 2.5 Findings rewritten as one whole-catchment document: what was run, the load before growth, the alarm and rise coverage, the manholes chosen, how much growth it takes to show (new: median rise and share seen by case and size, from the 8,200 runs), overflows, the October work, limits and next steps. The segment study's sections, whose numbers contradicted the whole-catchment ones, stay on the legacy tab; two of its lessons are kept. No result changes. |

**Pumps, now and next.** Every published result uses SWMM's ideal pumps, which pass on whatever
reaches a wet well at once. Since 14 Oct 2026 a growth scenario may instead run the two modelled
stations at a set rate: each wet well becomes a tank and each pump starts and stops on its levels,
solved by the local runner against the same network at default rates. Since 15 Oct each pump
follows a head curve: it delivers less as the level it pumps against rises, and nothing above its
shut-off head. The defaults (17.67 L/s in the DN150 rising main, 7.85 L/s in the DN100s, from a
1.0 m/s design velocity) and the curves are assumptions; the utility publishes neither. The next step (option B) is to re-run the whole grid with rated pumps
once the operator supplies pump rates, wet-well sizes and start and stop levels, judging detection on
the peak across a pump cycle; see `pumps._future` in `config.js` and section 7 of the Simulation 2.5
Findings tab.

## Licence

Code released under the MIT Licence. The underlying network data belongs to its publishers and is
subject to their terms.



<!-- Array |	Source | field |	Units |	Published |	Used by
dia |	NOMINALDIA |	metres |	100% |	capacity (reach diameter), risk (bore factor), map line width

idia |	INTERNALDI |	metres, 0 = absent |	54.4% |	nothing yet — carried, deliberately unused

mat |	MATERIAL + MATERIALUN |	index into codes.mat |	100% |	capacity (Manning's n per material), risk, hover

year |	CONST_YEAR |	four-digit, 0 = absent |	99.5% |	risk (age factor), hover

grade |	GRADE |	percent |	99.9%	| capacity (rescues flat/adverse reaches), risk (deposition factor), hover

joint |	JOINTTYPE |	index into codes.joint |	54.4% |	risk only


Plus a top-level codes legend — mat: ["VC","PVCU","RC"], joint: ["RRJ","SCJ","PLAST","BIT"] — and stats.pipe_attrs recording completeness per region, which the sidebar renders rather than hard-coding. -->
