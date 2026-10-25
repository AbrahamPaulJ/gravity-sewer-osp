# Sim 4: filling corridors (placement method)

Written 25 Oct 2026, **before** the implementation, after testing five ways of placing level
sensors on the paths along which pipes reach capacity. It replaces "Before surcharge" as Sim 4's
default method. That method stays on the page as a comparison. Section 7 records what changed
while it was built. **No SWMM run.**

## 1. Why change

"Before surcharge" chooses sensors to warn of the 29 build-outs that surcharge a manhole in Sim 3's
runs. It is fitted to those specific events:
- 2 to 7 per case;
- 8 predefined infill areas;
- 7 build-out steps.

A layout fitted to so few events depends on every case being right. Tested on cases it was not
chosen on, it warns of 84% of held-out overloads. On growth areas it was not chosen on, it warns of
76%.

The question asked instead: **where, generally, do pipes run out of room as growth is added?**
Monitor those paths, not the specific surcharge events.

## 2. What was tested

All five methods were tested on Sim 3's published data. Every score is for 5 sensors; "warned"
means before surcharge, a rise of 10 mm one build-out step before the first new surcharge.

The three columns:
- **In-sample:** sensors chosen and scored on everything.
- **Case held out:** chosen on 6 of the 7 wet cases, scored on the seventh, summed over the seven
  rounds.
- **Area held out:** chosen with one area's growth runs removed, scored on that area's overloads,
  summed over the eight rounds. **This is the test closest to "growth we did not simulate".**

| Method | Uses | In-sample | Case held out | Area held out |
|---|---|---|---|---|
| Before surcharge (current) | the surcharging runs | 25 of 25 (100%) | 21 (84%) | 19 (76%) |
| Static spare capacity: Manning full-pipe capacity minus the flow implied by pre-growth depth, route each site to its bottleneck | pre-growth depths only | predicts the first-surcharge pipe in **2 of 29** | — | — |
| Pipe ratings: fullness per extra L/s, measured on the runs, routed downstream | all runs | predicts the pipe exactly in 3 of 29; load off by a median ×8 | — | — |
| Spare-capacity corridors: chains of low-margin manholes, sensor at the tightest | all runs | 8 (32%) | 12 (48%) | 8 (32%) |
| Filling corridors only: sensor at the most frequent filler of each corridor | all runs | 22 (88%) | 19 (76%) | 19 (76%) |
| **Filling corridors + before-surcharge choice (this method)** | all runs | **25 (100%)** | **21 (84%)** | **22 (88%)** |

The out-of-sample figures for the last two rows were checked at fill levels of 0.7 and 0.8. At 0.7
the method scores 88% with a case held out and 72% with an area held out, so 0.8 is used.

**What the failures teach:**
- **Pre-growth geometry alone cannot find the bottleneck.** Backwater from a downstream pipe makes
  a pipe look full when it carries little flow, so a static screen invents bottlenecks.
- **Linear ratings fail near full.** The hydraulics there are nonlinear.
- **Pipes already full before growth can't show growth.** Placing sensors at the tightest pipe
  picks manholes that are already full in the wetter cases, and their water cannot rise past full
  in a way the rule counts.
- **What works is to watch where pipes *fill up* under growth.**

## 3. The method

**Filling event.** In a published growth run (any case, any area, any build-out), manhole i's
outlet pipe **fills** if its water was below THETA of the pipe's bore before growth and is at or
above it in the run:

    f = (water depth − outlet invert above the floor) / outlet bore,   f_before < THETA ≤ f_run

THETA = 0.8 (`simulation.before_surcharge.corridor_fill`). It counts once per (case, area)
build-out, at its smallest build-out.

**Filling corridor.** Manholes with at least one filling event, joined into connected chains along
the flow (a manhole and the next manhole downstream are in the same corridor). Each corridor is a
path along which growth is using up capacity.

**Candidates.** Only manholes on a filling corridor may hold a level sensor.

**Choice.** Among the candidates, the existing before-surcharge exact program:
- maximise the worst case's share of overloads warned at least one build-out step before the first
  surcharge;
- then the average share, as a tie-break;
- solved with HiGHS.

So the method keeps the warning objective. It changes where sensors may go: onto the paths where
capacity is being used up, not wherever a rise happens to correlate with a surcharge elsewhere.

**Why it should generalise better:**
1. **Filling events are more numerous than surcharges.** 46 manholes fill past 0.8 in some run;
   only 19 manholes are ever the first to surcharge.
2. **Filling is seen before surcharge.** It shows up in runs that never surcharge, so growth patterns
   that stop short of a surcharge still mark the path.
3. **It excludes manholes that only correlate.** A manhole on another branch can rise 10 mm in step
   with an overload; it is not on a filling path.

**What it does not do:** it does not predict loads. It uses the runs that exist. It is still only
as good as Sim 3's growth patterns and cases. The area hold-out estimates how much better it does
on growth the model did not see.

## 4. Robustness published with it

For every rule and k = 1 to 10, the tool publishes:
- leave-one-case-out and leave-one-area-out scores, for the new method and the unrestricted
  before-surcharge method;
- corridors and candidates rebuilt from the training split each time, so nothing from the held-out
  case or area leaks in.

The page shows them side by side ("How robust is it?"), so the choice of method is visible as
evidence, not asserted.

## 5. Page

- **Methods:**
  - **Filling corridors** (default, NEW);
  - **Before surcharge, any manhole** (the previous default);
  - Before + locate;
  - Sim 3's exact, greedy and risk-weighted.
- **Corridors** toggle on the top bar:
  - corridor manholes tinted violet;
  - each corridor labelled C1, C2 … at its centre, in order of how many build-outs fill it.
- **Monitoring cards and the full specification** name the corridor a level sensor sits on, and how
  many build-outs fill it.
- **Dashboard, two new cards:**
  - the corridors table: manholes, areas, build-outs filling, the sensor on it;
  - "How robust is it?": in-sample, case held out and area held out, for both methods, as bars
    against k.
- Register rows B12 (filling event and corridor) and B13 (held-out tests); tour step; changelog
  entry.

## 6. Tests

- Filling events and corridors recomputed in JavaScript from Sim 3's rows and the geometry.
- Every corridor set's sensors are corridor candidates.
- The page's scoring of the corridor sets matches the tool.
- Held-out results exist for both methods; the area hold-out never uses the held-out area's runs.
  This is checked by rebuilding one round's candidates in the test.

## 7. Changes during implementation

1. **The exact solver changes the held-out picture.** Section 2's tests chose sensors one at a time
   (greedy). The tool solves exactly (HiGHS), for both methods and every k, and rebuilds the
   corridors for each held-out round. Its numbers are the published ones. Warnings before
   surcharge, of the held-out warnable overloads, rule rise 10 mm:

   | Sensors (k) | 1 | 2 | 3 | 4 | **5** | 6 | 7 | 8 | 9 | 10 |
   |---|---|---|---|---|---|---|---|---|---|---|
   | Case held out (25): filling corridors | 18 | 20 | 21 | 21 | **23** | 23 | 23 | 23 | 24 | 24 |
   | Case held out (25): any manhole | 17 | 18 | 22 | 22 | **21** | 20 | 20 | 20 | 23 | 23 |
   | Area held out (25): filling corridors | 18 | 18 | 19 | 17 | **17** | 17 | 18 | 19 | 17 | 19 |
   | Area held out (25): any manhole | 17 | 17 | 18 | 18 | **17** | 18 | 19 | 21 | 23 | 23 |

   - **With a case held out,** filling corridors match or beat choosing anywhere from 5 sensors up
     (92% against 84% at 5).
   - **With an area held out,** they tie at 5 and are a little better at 1–3, but worse from 8 up.
     There, choosing anywhere can add manholes that happen to rise for the held-out area.
   - **Under rise 25 mm,** corridors do clearly better with an area held out: 9–10 of 19 against 6.
   - **Mixed result.** The gain is modest and mixed, on small numbers: one overload is 4 points.
   - **A further finding:** the greedy choice generalised better than the exact one when an area
     was held out (19 of 25 for any manhole, against 17 exact). The exact optimum fits the training
     events more tightly. That argues for nested or greedy placement, recorded as a next step.
2. **Why it is the default anyway:**
   - it is at least as robust where it matters most, the case hold-out;
   - in-sample it reaches the same ceiling (25 of 25 at 5 sensors);
   - **its sets are nearly nested.** From 1 to 5 sensors: [172], [172, 202], [105, 172, 202],
     [91, 161, 172, 202], [91, 93, 161, 172, 202]. Adding a sensor mostly keeps the earlier ones,
     which suits a staged rollout. The unrestricted sets jump around;
   - every level sensor sits on a path where a pipe is filling, so an alert names a corridor and
     its pipes. The unrestricted method can pick a manhole that only correlates with an overload
     elsewhere.
3. **Corridors as built:** 46 manholes fill past 80% in some wet run, in 29 corridors. Most are
   short; the largest takes 12 build-outs. They lie mostly in the upstream north-east, where the
   pipes are fuller and flatter, so the sensors still sit there. The method makes that a stated
   reason ("pipes fill here") rather than a side-effect.
4. **Area hold-out rounds:** 6, not 8. R3 and R6 have no overload that a 10 mm rise can warn of a
   step ahead, so there is nothing to score.
5. **The "Before surcharge" method stays,** relabelled "Before surcharge, any manhole", with
   "Before + locate" and Sim 3's sets, so the comparison is on the page.

**Next:**
- nested (greedy) placement on the corridors;
- the ensemble and growth-pattern runs in the simulation programme, which would give enough
  held-out events to tell the methods apart with confidence.
