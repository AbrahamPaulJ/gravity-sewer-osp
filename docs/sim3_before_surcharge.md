# Sim 3: detect and locate overcapacity before surcharge (design)

Branched from `main` at `60db306`. Written 25 Oct 2026, **before** the
implementation, so the team can review the method separately from the code. Section 11 records what
changed while it was being built.

**Scope:** post-processing of Sim 3's published infill runs only. **No SWMM run is added or
repeated**, and none of Sim 3's generated files (`simulation3/data/*.js`) is edited.

---

## 1. The question this answers

Sim 3 asks: *which manholes' water levels respond to growth, and where would a few sensors see most
of it?* The network operator's underlying concern is narrower:

> Detect a plausible overcapacity, and locate it, **before** any manhole surcharges.

Growth arrives over years, so "before" is measured in **growth**, not time. Along an area's
build-out, a sensor must respond at a smaller build-out than the one at which the first manhole
newly surcharges.

Sim 3 already has the runs to test this. Its infill family solves each of 8 areas at 7 build-out
steps (10, 25, 50, 75, 100, 150 and 300% of the area's share of the 2021–41 projection), under 8
cases: 448 settled runs. For every run it publishes:
- every manhole's rise;
- the manholes that newly pass the alarm, newly surcharge and newly spill;
- the baseline depth of every manhole.

## 2. What is wrong with the current score, measured

Sim 3 scores a sensor set by the share of **detectable scenarios**: runs (area × step × case) in
which at least one manhole passes the rule. It takes the worst case over the 8 cases. Two
properties of that score work against the question in section 1.

1. **It credits detections made after the surcharge.** Once a pipe surcharges, water backs up and
   many manholes respond, so a sensor far from the problem "sees" the run. For the published exact
   sets:

   | Rule | Sensors | Runs credited | …with a manhole already newly surcharged |
   |---|---|---|---|
   | rise 10 mm | 3 / 5 / 8 | 151 / 184 / 202 | 74 / 80 / 82 (49% / 43% / 41%) |
   | rise 25 mm | 3 / 5 / 8 | 97 / 126 / 131 | 65 / 72 / 73 (67% / 57% / 56%) |

2. **It counts growth that never overloads anything.** Only 29 of the 64 build-out paths (8 areas
   × 8 cases) newly surcharge any manhole by 300%. **Dry has none at all**, which is why Dry drags
   every worst-case score down: there is nothing in it to warn about.

Measured with the 5-sensor exact set under the rise-10 rule, the 29 overloading paths split
**24 detected before surcharge, 1 at the same step, 4 after**. The same set under the rise-25 rule
detects 16, with 6 at the same step, 4 after and 3 never.

## 3. Definitions

**Path.** One area's build-out under one case: steps s = 0…6 (10% … 300%).

**First surcharge step s\*.** The first step at which any manhole newly surcharges or newly spills
(lists `sur` and `spill` in the row). A path with no such step does not overload; it is not a
target.

**Target.** A path that overloads (s\* exists).

**Warning step s_w = s\* − m.** m is the margin in ladder steps; the default m = 1 means "the step
before the surcharge". A target with s_w < 0, which surcharges at its first step, cannot be warned
by any sensor. It is reported, never hidden.

**A manhole responds at step s** under a rule:

| Rule | Responds when | Notes |
|---|---|---|
| `r10`, `r25`, `r50` | its rise over its own pre-growth level ≥ 10 / 25 / 50 mm | as Sim 3 |
| `alarm` | it newly passes 150 mm above its floor | as Sim 3 (`alarm` list) |
| `f70`, `f80` (**new**) | its water newly reaches 70% / 80% of the depth of its lowest outlet pipe | from stored depths, section 6 |

**Detected before surcharge.** At least one chosen sensor responds at s_w.

Rises never fall as growth increases: 0 of 20,597 step-to-step comparisons in the published rows.
So responding at s_w is the same as responding at some step ≤ s_w.

**Warning margin.** For a detected target, (build-out at s\*) ÷ (build-out at the first step a
chosen sensor responds). For example, warns at 25% and surcharges at 100% gives ×4.

**Signature.** The set of chosen sensors that respond at s_w.

**First-surcharge manholes F(p).** The manholes in `sur ∪ spill` at s\*. This is the closest
published stand-in for "where the overcapacity is"; the bottleneck pipe itself is not recorded
(section 10).

**Located within radius r.** Path p is detected, and for every other target q in the same case
whose F(q) lies further than r from F(p), the signatures of p and q differ. The distance is the
shortest distance along the pipes between any member of F(p) and any member of F(q).

Read it as: "when these sensors light up in this pattern, the overload is in this part of the
network, to within r".

## 4. The new scores

For a sensor set S, rule ρ, margin m and case c, with T_c the targets in case c that **some**
manhole could warn ("warnable"):

- **Before-surcharge coverage:** BS_c(S) = |{p ∈ T_c : detected before surcharge}| / |T_c|.
- **Located coverage:** LC_c(S, r) = |{p ∈ T_c : located within r}| / |T_c|.

The headline is the **worst case over the cases that have targets**, as in Sim 3, with the average
beside it. Cases without targets (Dry, under every rule) are reported as "nothing to warn about"
rather than scored 0.

Also reported, so nothing is hidden by the denominator:
- the absolute count of targets, warnable targets and unwarnable targets;
- the warning-margin distribution;
- for every **published** Sim 3 set (exact, greedy, risk-weighted; k = 1…10):
  - its old score;
  - the share of its credited runs that were already surcharged;
  - its before / same / after / never counts.

**Weighting.**
- *Equal*, the default: every target counts once.
- *By homes*: a target's weight is the number of homes its area has today. Sim 3 spreads infill
  in proportion to existing homes, so this is how much of the plausible infill lands there.
  Weighting by each area's share of the projection was considered and rejected: the corridor's
  100% is the whole 485-dwelling projection, so it would dominate every other area.
- The page shows the sets under both weightings and how many sensors they share.

## 5. The optimisation

Exact, per rule and per k = 1…10, solved as a mixed-integer program with SciPy's HiGHS interface
(`scipy.optimize.milp`, already in `simulation_src/requirements.txt`).

**Detect before surcharge (`before`):**

    maximise    z + ε · mean_c(BS_c)
    subject to  Σ_i x_i = k
                y_p ≤ Σ_{i ∈ D(p)} x_i          for each target p   (D(p): manholes responding at s_w)
                Σ_{p ∈ T_c} w_p y_p / Σ_{p ∈ T_c} w_p ≥ z    for each case c with targets
                x_i ∈ {0,1},  0 ≤ y_p ≤ 1,  ε = 10⁻³

The small ε term breaks ties among sets with the same worst case in favour of the better average,
as a stated rule rather than an accident of the solver.

**Detect and locate (`locate`, per radius r):** add, for every pair p, q in the same case that must
be told apart:

    v_pq ≤ Σ_{i ∈ D(p) △ D(q)} x_i              (some chosen sensor responds to one and not the other)
    l_p ≤ y_p,   l_p ≤ v_pq  for each such q,   and score l_p instead of y_p.

This is exact: a target is located only if it is detected and separated from every target it must
be told apart from. Problem size per rule: 328 binaries, up to ~30 targets per case and a few
hundred pairs, so each solve takes well under a second.

**Also computed:**
- **Greedy**, for comparison.
- **Leave one case out:** chosen on the other cases, scored on the held-out case.
- **Old-objective check:** the same program with Sim 3's own objective (worst-case share of
  detectable runs over all 8 cases) must reach the published exact score at every k. This shows
  the new tool reads the data the way the generator did. Sets may differ where several sets tie.

## 6. The fullness rules (`f70`, `f80`), without new runs

A level sensor's natural trigger is how full the pipe is, not a fixed number of millimetres. For
each manhole:
- **crown** = its lowest outlet pipe's invert offset above the manhole floor, plus that pipe's bore,
  from `simulation3/data/catchment.js` (`zu`, `dia`, node `inv`);
- **depth at step s** = baseline depth (`base.depthMm`) + rise at step s.

The manhole responds under `fX` when its depth newly reaches offset + X · bore, having been below it
before growth. A manhole already past it before growth cannot report (amber on the map, as for the
alarm).

**Check (done before writing this):** "depth ≥ crown" reproduces Sim 3's own pre-growth surcharge
flags exactly in all 8 cases (0 mismatches), so the geometry and the depths agree.

**Precision:** stored depths are whole millimetres and rises are stored from 0.5 mm, so the
threshold is exact to about 1 mm.

## 7. Settings (`config.js`, `simulation.before_surcharge`)

| Key | Default | Allowed | Meaning |
|---|---|---|---|
| `margin_steps` | 1 | 1–3 | m: how many ladder steps before the first surcharge a sensor must respond |
| `radii_m` | [0, 300, 1000] | non-negative metres | radii at which locating is solved and published |
| `default_radius_m` | 300 | one of `radii_m` | the radius the page opens on |
| `fullness` | [0.7, 0.8] | fractions in (0, 1) | the fullness rules computed |
| `weights` | "equal" | "equal" \| "homes" | the weighting of the published recommendation |
| `max_sensors` | (Sim 3's, 10) | — | read from `simulation.max_sensors` |

Changing any of them needs only `python tools/sim3_before.py --publish`. **No SWMM re-run.**

## 8. Files

| File | New/changed | What |
|---|---|---|
| `tools/sim3_before.py` | new | Reads `simulation3/data/{regions,catchment,growth}.js` and `config.js`; computes section 3–6; writes `simulation3/data/before.js`. `--check` rebuilds in memory and compares byte for byte; `--publish` writes and bumps the page's cache keys |
| `simulation3/data/before.js` | new, generated | `window.SIM3_BEFORE`: settings, provenance (a hash of `regions.js`, SciPy version), paths, per-rule results, diagnostics of the published sets, register rows |
| `simulation3/before_views.js` | new | The visualisations (section 9), pure functions returning SVG/HTML from `SIM3_BEFORE` |
| `simulation3/sim3_ui.js` | changed | A "Before surcharge" method; a "Before surcharge" button opening the dashboard; summary line and cards say warn/surcharge build-outs; the new rules in the expert rule list; the register rows appended to Assumptions |
| `simulation3/index.html` | changed | Button, styles, script tags, cache keys |
| `changelog.html` | new | The site's changelog page |
| `index.html` | changed | A Changelog tab, card and pane; iframe cache keys |
| `config.js` | changed | `pages.changelog`, `simulation.before_surcharge` |
| `tools/test_sandbox.js` | changed | Checks in section 10 |
| `README.md`, `ARCHITECTURE.md` | changed | History row, the method, the new files |

## 9. Visualisations

All are drawn from `before.js`, so every number on them is computed from data, never typed. They
live in one **"Before surcharge" dashboard** (a wide popup from the top bar), with rule, k, radius
and weighting selectors, plus small versions in the expert side panel.

1. **Build-out ladder.** A grid with one row per area and one column per build-out step (10% to
   300%), for the selected case, or for all eight cases stacked.
   - *Cells:* blank = quiet; green = a chosen sensor responds; red = a manhole has newly surcharged;
     red with a green dot = both, which is a detection that came too late to be a warning.
   - *Markers:* ◆ the first warning, ✕ the first surcharge, and a bracket between them labelled
     with the margin (×4).
   - *Rows:* areas that never overload are greyed.

   This is the picture of the whole idea: green must appear to the left of red.
2. **Where the old score came from.** For k = 1…10, a stacked bar of the old score's credited runs:
   before any surcharge (green) vs already surcharged (red). Old exact, greedy and risk-weighted
   sets are selectable. It shows how much of the old percentage was after the fact.
3. **Before-surcharge curves.** Worst case and average against k for:
   - the new exact set;
   - the old exact set scored on the new metric;
   - greedy.

   The located curve at the chosen radius is dashed.
4. **Outcome bars per set.** For the selected k: before / same step / after / never, for the new
   set and every published set. Counts, not shares, so the 29 targets stay visible.
5. **Warning-margin strip.** One dot per detected target, on a log axis from ×1 to ×30, coloured by
   case; a band marks ×1.5, the smallest margin worth acting on. Undetected targets are listed
   beneath.
6. **Signature matrix (locating).** Targets in the selected case as rows, chosen sensors as columns.
   - *Cells:* filled where the sensor responds at the warning step.
   - *Rows:* grouped by identical signature, with groups that mix far-apart first-surcharge
     locations outlined in red (ambiguous at radius r). The group's first-surcharge manholes are
     listed at the right.
7. **Rule comparison.** For each rule (`r10`, `r25`, `r50`, `alarm`, `f70`, `f80`), the share warned
   before surcharge with a sensor at every manhole (the ceiling) and with the k chosen. This shows
   which trigger can warn at all.
8. **Weighting stability.** Equal vs homes-weighted sets side by side: shared sensors and both
   scores.

On the map, when the new method is selected:
- the summary line reads, for the shown area and case, "a sensor warns at 25%; the first manhole
  surcharges at 100% (×4)";
- each sensor card lists the areas it warns of and its margins.

## 10. Tests and limitations

**Checks added to `tools/test_sandbox.js`:**
- `before.js` parses and its `regions.js` hash matches the published file, so a Sim 3 republish
  without a re-score fails;
- the headline figures recomputed in JavaScript from `regions.js`: target count, before-surcharge
  counts for the new exact set at k = 5, and the credited-after share of the published exact set;
- the old-objective check reproduces the published exact worst-case scores;
- a hand-made four-path example with a known locating answer;
- the changelog page is configured, has a tab and a pane, and its cache key matches;
- every script on the Sim 3 page carries the same cache key.

**Limitations:**
- **Only seven build-out steps.** 4 of the 29 overloading paths jump from no response anywhere to a
  surcharge in one step, so even a sensor at every manhole cannot show their warning. Finer steps
  need new solves (out of scope here).
- **The bottleneck pipe is not recorded.** Locating uses the first-surcharge manholes as its stand-in.
- **Greenfield is not re-scored.** Its published rows hold only which manholes pass each rule, not
  rises or surcharges at every size.
- **Inherited from Sim 3:** uncalibrated; steady state; ideal pumps; flat peaking factor 2; no extra
  infiltration from new homes; thresholds not yet set from real level records.
- **Equal weights are an assumption.** The homes weighting is a sensitivity, not planning
  evidence.

## 11. Changes during implementation

(Filled in as the work proceeds.)
