# Sim 4, next: level sensors with three roles (plan and viability)

Written 25 Oct 2026. **A plan, not built.** Every figure below was measured on Simulation 3's
published runs and geometry (`simulation3/data/`) with no new SWMM run, using the check script
described in section 6.

## 1. The idea

Sim 4 places level sensors to **warn** of an overload before the first manhole surcharges. Two
more jobs for the same kind of sensor came up:

| Role | Where | What it reads | What it answers |
|---|---|---|---|
| **W: warn** (built, Sim 4) | wherever the water rises first as an area grows | a rise of 10 mm, or the water reaching 70% / 80% of the outlet pipe's bore | "growth is loading this part of the network" |
| **C: capacity trend** (new) | at, or just upstream of, the pipes that surcharge first | **headroom**: the distance from the water to the top of the outlet pipe (its crown), and how fast it shrinks as growth is added | "at this rate the pipe surcharges at about this much more growth" |
| **G: spill guard** (new) | in manholes where a spill can occur | **freeboard**: the distance from the water to the lid (the rim), once the manhole is surcharged | "this manhole is close to spilling" |

W says that something is changing. C says how much capacity is left at the place that will fail
first. G is the last line, where a failure would spill. Together they cover the path from growth to
overflow:

    growth -> water rises (W) -> headroom shrinks at the bottleneck (C) -> pipe surcharges
           -> water climbs the manhole shaft (G) -> spill at the lid

## 2. Viability, measured on Sim 3's data

### 2.1 The geometry supports both readings

- Crown and rim come from the published geometry: the lowest outlet pipe's invert above the floor
  plus its bore, and the manhole depth. "Water at or above the crown" reproduces Sim 3's own
  surcharge flags in all 8 cases with no mismatch, so headroom can be computed for every manhole,
  case and build-out step from the stored depths.
- Between crown and rim, manhole shafts are **350 mm to 5.3 m** deep (median 2.8 m). That is the
  room a spill guard has to see the water climbing.

### 2.2 Spill guard (G): viable, and cheap

- Spills are rare in these runs. Only **3 manholes** newly spill in any infill run, on **4 of the 64**
  area build-outs. Before any growth, up to 6 manholes already spill in the wettest cases (none in
  Dry or Design wet).
- **In all 4 spilling build-outs, the manhole that spills was already surcharged before any
  growth**: the water was already in its shaft. Its freeboard then shrinks step by step as growth is
  added, for example (mm, before growth and then at 10%, 25%, 50%, 75%, 100% ...):
  - 97, 87, 72, 47, 21, **0**;
  - 92, 88, 81, 70, 59, 47, 25, **0**;
  - 172, 163, 148, 124, 100, 77, **0**;
  - 44, 38, 30, 16, 2, **0**.

  So a level sensor in that shaft sees the freeboard fall over **3 to 6 build-out steps** before the
  spill. A freeboard alarm (say 300 mm) would already be on in each case: these manholes are
  within 0.2 m of spilling in the model **before growth**, which is a hot spot today, or a sign that the
  uncalibrated model is wrong there. Either way it is the first place a real level record would test the model.
- Candidates beyond the observed spills: **147** manholes are surcharged in some case or build-out.
  Of those, freeboard falls below **300 mm** in **28**, below 500 mm in 46 and below 1 m in 81.
  A spill-guard set is drawn from these, ranked by how little freeboard they keep and by what a
  spill there would reach.

### 2.3 Capacity trend (C): viable in the model, needs a sensor at the bottleneck

- **19 distinct manholes** are the first to surcharge across the 29 overloading build-outs. Sensors
  at the four most frequent ones cover 20 of the 29. Eleven cover all of them.
  The cover curve for 1 to 11 sensors is 5, 10, 15, 20, 22, 24, 25, 26, 27, 28 and 29.
- **Forecasting the surcharge from the shrinking headroom works, and errs on the safe side.** At the
  first-surcharge manhole, a straight line through the headroom at the last two build-out steps
  before the surcharge predicts the build-out at which it reaches zero:
  - **from the step before:** at a median of **0.80** times the true build-out (quartiles 0.64 to
    0.90). The forecast is at or below the truth in **27 of 28**: it warns early, not late.
  - **from two steps before:** a median of **0.84** (quartiles 0.72 to 0.93), at or below the truth in
    19 of 22.
  - At the step before the surcharge, a median of **78%** of the manhole's headroom before growth is
    already used. A reading of "share of headroom used" is a capacity gauge an operator can read.
- Overlap with W: a sensor at a first-surcharge manhole usually also warns (W). One sensor can
  serve both roles, so a joint placement should beat two separate sets.

### 2.4 What the model cannot settle (and real data must)

- **Steady state.** Sim 3's depths are settled levels under constant load. A real level record
  varies daily and with rain. Headroom tracking will need a rain-conditioned statistic, for example
  the peak of each wet-weather day, trended over months, with its scatter measured. This is
  Sim 3's "time to notice" problem again.
- **Coarse ladder.** Seven build-out steps make the trend a few points long. Finer steps need new
  solves; the approximate network solver on its branch could supply them cheaply.
- **The bottleneck pipe is not recorded.** The first-surcharge manholes stand in for it, as in
  Sim 4's locating.
- **Sensor type.** Ultrasonic sensors have a blind zone near the lid and go blind when the water
  reaches them, so a spill guard in a surcharged shaft needs a submersible pressure sensor or a
  radar sensor mounted with clearance. A float switch at a set freeboard is the cheap alternative
  for G alone.
- **Uncalibrated.** Manholes the model says spill before growth are where the model most needs
  checking.

## 3. The plan

None of phases 1 to 4 needs a SWMM run. Phase 5 does.

| Phase | What | Files | Check |
|---|---|---|---|
| **1. Headroom and freeboard series** | For every manhole, case and build-out step, compute headroom (crown − water) and freeboard (rim − water) from the stored depths and the geometry. Mark the first-surcharge manholes, the manholes that spill, and the spill-prone ones (freeboard below a setting at some step). | `tools/sim4_before.py` (or a sibling `tools/sim4_roles.py`), a new `simulation4/data/roles.js` | Reproduces section 2's figures; the surcharge flags still match Sim 3's |
| **2. Capacity-trend role (C)** | Score: a target is *tracked* if a chosen sensor sits at one of its first-surcharge manholes (or within d metres upstream along the pipes). Also report the forecast ratio and how early it is available. Placement: the best k for the share tracked, worst case over cases. | same, plus `before_views.js` | The cover curve 5, 10, 15, 20 ... 29 for d = 0 |
| **3. Spill-guard role (G)** | The spill-prone set, under freeboard settings of 300 and 500 mm. A guard covers a manhole if it is in it. Rank by the minimum freeboard reached and by the homes upstream (what a spill would cut off). Alarm: freeboard below the setting. | same | The 3 spilling manholes are in the set for every case they spill in |
| **4. One budget, three roles** | One exact program over a total budget k. Each chosen sensor may serve W, C and G. Lexicographic: first guard the spill-prone manholes the operator names as must-cover, then maximise W (warn before surcharge), then C. Report how many sensors each role costs on its own and together. | `tools/sim4_before.py`, `before.js` / `roles.js` | Joint ≤ sum of separate; one-role versions match phases 2 and 3 |
| **4b. The page** | Pins drawn by role (one shape per role, plus the violet accent while new); a role card per pin; dashboard cards: headroom used against build-out per bottleneck (a fan of lines ending at the crown); freeboard countdown per spill-prone manhole; a sensors-per-role bar | `simulation4/*` | Headless page check; the suite recomputes the role figures |
| **5. Needs runs** | Finer build-out steps (approximate solver, a SWMM sample to confirm); a wet-weather event run to give the spill guard minutes of warning, not only build-out; real level records to set noise and calibrate | `simulation_src/approx/*` | Approx solver against SWMM on a sample |

### Settings to add (`config.js`, `simulation.before_surcharge.roles`)

| Key | Default | Meaning |
|---|---|---|
| `capacity_upstream_m` | 0 | how far upstream of a first-surcharge manhole a capacity sensor may sit and still count |
| `spill_freeboard_mm` | [300, 500] | freeboard below which a manhole is spill-prone, and the guard's alarm |
| `must_guard` | [] | manholes the operator requires a guard in (sensitive receivers, past spills) |
| `role_order` | ["guard", "warn", "capacity"] | the order of the lexicographic objective |

## 4. Decisions needed

| Decision | Who | Why |
|---|---|---|
| Is a spill guard a sensor in the plan, or the operator's existing overflow monitoring? | Client | It may already exist at known overflow points |
| Freeboard alarm level | Client | Sets the spill-prone set and the guard's alarm |
| Sensor type in surcharged shafts (pressure, radar, float) | Client + team | Ultrasonic blind zone near the lid |
| How the budget is split: lexicographic, or a weight per role | Team | Changes the layout |
| Which statistic tracks headroom in real data (wet-day peak, percentile) | Team, then data | The model's settled depths are not what a sensor reads |

## 5. Recommendation

Build phases 1 to 3 next. They are cheap: the same data, a few hours of work, no runs. They give
the operator two readings that are easy to act on: "share of capacity used at the pipe that will fail
first" and "freeboard at the manholes that could spill". Phase 4 then shows whether one budget can
serve all three roles. On this data it probably can, because the warning and capacity sensors often
coincide.

## 6. Reproducing section 2

The figures come from a read-only check script kept in the project's research folder, outside this
repository. It takes the folder holding `regions.js`, `catchment.js` and `growth.js`:

    python -I sim3_level_roles.py <path to>/simulation3/data

Phase 1 moves this calculation into the repository's tools, with a test.
