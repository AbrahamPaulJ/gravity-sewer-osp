# Approximating Simulation 2.5 without running SWMM for every scenario

Simulation 2.5 places sensors from 8,200 EPA SWMM runs (5 cases x 328 sites x 5 growth sizes,
about 35 s each). This folder asks whether those answers can be had from pipe geometry and
hydraulics alone, and measures each approximation against the committed SWMM grids. Nothing
here changes the published page or its data; it is an offline check.

| File | What it is |
|---|---|
| `netsolve.py` | The network solve: every node's water level found together by Newton's method |
| `marching.py` | The one-pass method: flows summed downstream, then backwater stepped upstream |
| `run_all.py` | Both methods on every condition in `results/sim25/grid_whole` and `results/sim25/grid` |
| `score_all.py` | Both scored against SWMM: depths, detections, sensor placement |
| `check_baselines.py` | Baselines against SWMM, and the slot finding below (about 2 minutes) |

```
python simulation_src/approx/check_baselines.py
python simulation_src/approx/run_all.py --workers 4    # resumes; results/approx/allcond/
python simulation_src/approx/score_all.py
```

Measured with pyswmm 2.2.0 (the project pins 2.1.0), numpy and scipy, 19 to 20 Oct 2026.

## The methods, simplest first

Each step was added because the one before it failed against SWMM in a way that was traced
to a cause. Figures are from the whole-area grid unless stated.

1. **Manning normal depth.** Flows summed down the network are exact (they match SWMM's to
   0.00% median). Depths match where pipes flow freely, but most growth detections are
   backwater, which normal depth cannot produce: it finds 17 to 50% of SWMM's detections in
   Dry and Design wet. For 80 new dwellings it predicts rises of at most 2.2 mm where SWMM
   shows 52.8 mm.
2. **Plus a backwater pass**, water level carried up each pipe with friction. Finds every
   detection, but 27 to 42% of its own are false: it put backed-up reaches about 100 mm too
   high, because it assumed a pipe given more than its capacity runs full to its outlet.
3. **Plus the energy standard step from critical depth** (`marching.py`). An over-capacity
   pipe runs part-full at a free outlet and fills going upstream. False detections fall to
   15 to 28%, and its sensors score as well as SWMM's own greedy choice in Dry and Design wet.
   It still marches in the recorded flow direction, so it fails in Severe, where SWMM has
   water flowing **backwards** up pipes (for example -13.4 L/s in
   MH4450167 > MH4449849), looping through relief pipes, and 58 L/s lost from 6 manholes.
4. **The network solve** (`netsolve.py`). Every pipe's flow follows the levels at its two
   ends, either way; every node balances; chambers at their lid spill; relief pipes share
   flow by water level; ideal pumps pass their wet well's inflow on. It is SWMM's own steady
   balance without the time stepping.

## SWMM's slot makes surcharged pipes carry more than a full pipe can

At SWMM's own Severe levels, the pipe law first disagreed with SWMM's flows by up to 16 L/s
in 124 pipes, and always the same way: SWMM carried 12 to 19% more than a full pipe could
(MH4450922 > MH4451207, DN300, about 3.4 m of water: 78.8 L/s full-pipe, 89.0 L/s in SWMM).
That is SWMM's Preissmann slot (`SURCHARGE_METHOD SLOT`, chosen for the reasons in H11): above
1.78 bores of depth the slot is 1% of the bore wide, so a pipe surcharged ten bores deep gains
`(y - D) x 0.01 D` of flow area, +13% for DN300 and +19% for DN225. With the slot written into
the pipe law, pipes off by more than 1 L/s fall from 124 to 10.

So in Severe, SWMM moves water through surcharged pipes more easily than real pipes would,
and its surcharge depths there read low. This is a property of the published model, not of
the approximation, and it matters only where pipes are surcharged well above the crown.

Two related observations, both measured:

- SWMM's conveyance jumps about 4.5% where the slot begins (0.985 of the bore, where the
  hydraulic radius switches from its part-full value to full), so no steady state exists
  across it. That is the likely source of the Severe run's oscillation (up to 8.9 mm at 18
  manholes over the final window). `netsolve.py` blends across it.
- In surcharged conditions a development of 10 dwellings (about 0.1 L/s) produced SWMM rises
  of 10 mm or more 596 times across the Design wet + outside x1.5 grid, so the 10 mm rule is
  close to what either method can resolve there.

## Results

### Baselines

| Condition | Network solve against SWMM |
|---|---|
| Dry | from a cold start in 0.4 s: largest depth error 4 mm |
| Design wet | from a cold start in 1.4 s: 99% of manholes within 25 mm, largest 25 mm; 7 surcharged, as SWMM |
| Severe | **does not converge from a cold start.** From one SWMM baseline, 21 iterations: 141 surcharged (SWMM 141), 6 spilling 57.8 L/s (SWMM 6, 58.0 L/s), 96% within 25 mm |

Severe from a cold start fails because the steady state changes regime as the network
surcharges and flow reverses: continuation in load from Design wet stalls about 6% of the
way, at a fold no step size passes. SWMM gets there by stepping through time. So for heavily
surcharged conditions the practical method is one SWMM baseline per condition, then the
network solve for every growth scenario from it: 1 SWMM run where the grid needed 1,641.

### Growth scenarios

Four of the 17 committed conditions are solved (`results/approx/allcond/whole/`, 1,640
scenarios each): every whole-area case but Severe. Two runs of `run_all.py` were stopped by
the machine running low on memory, not by a fault; it resumes where it stopped. Still to run:
whole-area Severe (its SWMM baseline is saved) and the 12 segment cases, which add I&I 0.25,
the Harmon peak factor and outside inflow x0.5.

SWMM detections found / the method's own detections that are false, at rises of 10, 25, 50 mm:

| Condition | Baseline from | Runs converged | Network solve | One-pass method | Median rise error where SWMM >= 10 mm (network / one-pass) |
|---|---|---|---|---|---|
| Dry | cold start | 100% | 100/2, 100/0, 99/0 | 99/12, 99/6, 93/46 | 0.0 / 0.0 mm |
| Design wet | cold start | 95% | 97/2, 98/3, 95/1 | 100/12, 100/16, 100/17 | 0.9 / 1.9 mm |
| Design wet + age-weighted I&I | cold start | 95% | 99/3, 99/3, 96/1 | 88/14, 80/17, 82/25 | 0.5 / 7.6 mm |
| Design wet + outside inflow x1.5 | one SWMM baseline | 90% | 93/5, 91/13, 88/9 | 99/17, 100/23, 99/30 | 15.5 / 18.7 mm |

A run that does not converge (by Newton, then pseudo-transient stepping) keeps its last
iterate, so its rises are scored as they are.

Sensors chosen on each method's rises, worst-case greedy over these four conditions, scored on
SWMM's (worst case / mean, 5 sensors): at 10 mm, network solve 47/62, one-pass 46/68, SWMM's own
greedy 51/70; at 25 mm, 57/65, 64/76, 56/65; at 50 mm, 59/72, 58/66, 61/75. The network solve's
choice is close to SWMM's own at every rule. SWMM's greedy is not optimal, which is how a method
scored on SWMM can beat it.

## Limits

- Every figure is agreement with SWMM, not with the sewer. SWMM is uncalibrated here; the
  approximations inherit its assumptions (steady peak flow, no manhole losses, ideal pumps,
  free outfall) and, by design, its slot.
- The comparison is with the committed grids. Its segment cases at I&I 0.11 and below were
  nested SWMM runs; the network solve is whole-domain throughout (nesting was validated
  identical at those levels).
- Manhole minor losses are left out of both, because the SWMM model has none. Adding them to
  one side only would make it disagree with SWMM by design.
