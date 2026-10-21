# Speed-ups for the Simulation 2.5 grid

Proposed changes that make the Sim 2.5 growth grid faster, each in its own folder, with the
measurements behind them. Nothing here changes the published pipeline: `sim25_grid.py`,
`sim25_serve.py` and their results are untouched, and the fast grid writes to its own results
folder. Adopting any of it is a separate decision (see "Adopting it" at the end).

Run everything from `simulation_src` as modules, so the published modules import unchanged:

```
python -m speedups.fast_grid --plan                          # what would run
python -m speedups.fast_grid --cases all --workers 6         # 1 + 2 + 3 on this machine
python -m speedups.compare                                   # against the published grid
python -m speedups.test_speedups [--swmm]                    # checks
```

| # | Improvement | Folder | Effect, as measured |
|---|---|---|---|
| 1 | Growth runs start from the settled baseline (SWMM hotstart) | `hotstart/` | simulates only the response to the growth, not the fill from empty pipes |
| 2 | Each run stops when settled, not at a fixed 480 min | `converge/` | short runs where the network settles fast, and correct runs where 480 min is not enough |
| 3 | One queue for every case's runs, longest first | `one_pool/` | no idle workers at each case's tail |
| 4 | The page's local SWMM runner hot-started | `serve_hotstart/` | scenarios from a cached settled baseline |
| 5 | The grid spread over machines | `distributed/` | shards + merge, Dask, GitHub Actions, SLURM |
| | Measurements | `bench/` | the scripts that produced the tables below |

## What the time goes on

Measured from the published `summary.json` files (`wall_s`, 6 workers):

| Grid | Runs a case | Wall time a case |
|---|---|---|
| Segment, nested (design wet and drier) | 356 segment runs | about 4 min |
| Segment, whole-domain (wetter) | 356 whole runs | about 18 min |
| Whole area (`study_area: "whole"`, as configured) | 1,641 whole runs | 1.3 to 1.8 h; **about 8.4 h for the 5 cases** |

Every run is a constant-load EPA SWMM dynamic-wave run started from empty pipes and simulated
for 480 minutes (`sim25_grid.MINUTES`). SWMM's own report for these runs shows the routing step
pinned at 0.5 s (minimum, average and maximum are all 0.5 s) on one thread, so a run's cost is
close to proportional to the minutes simulated. Two things that look like they would help do
not:

- A longer `ROUTING_STEP`. At 1.0 s the depths were identical to 0.5 s (0.000 mm): the variable
  step stays at SWMM's 0.5 s minimum, most likely held there by the Courant condition on the
  short in-pipe links (not checked link by link). Lengthening those links
  (`LENGTHENING_STEP`) would let it grow, but changes the hydraulics: an assumption-level
  change, not a speed-up.
- Writing less output. The `.inp` has no `[REPORT]` section, so the `.out` files hold system
  totals only and are already small. Reading results through pyswmm is a real cost (recording
  every link every step took a run from 41 to 66 s), but the grid already records only its last
  12 minutes.

## Settling: the finding that comes first

`sim25_grid.py` states (R2) that runs are "settled within 0.2 mm by 480 min at every weather
level tested". On the current whole-domain model that holds for design wet and not for the wet
case. `python -m speedups.bench.settling --ii 0.11 0.25`, 21 Oct 2026, cold baselines run for
1,440 minutes, 10-minute peak at each time against the peak at 1,440:

| Peak at | ii 0.11 (design wet), all 328 chambers | ii 0.25, all 328 chambers | ii 0.25, 71 study manholes |
|---|---|---|---|
| 240 min | 0.3 mm | 477.2 mm (122 over 1 mm) | 308.4 mm |
| 360 min | 0.0 mm | 82.9 mm (122) | 75.6 mm |
| **480 min (the grid)** | **0.0 mm** | **25.9 mm (107)** | **18.9 mm** |
| 720 min | 0.0 mm | 2.4 mm (80) | 1.3 mm |
| 960 min | 0.0 mm | 0.2 mm (0) | 0.1 mm |

So 480 minutes is about twice what design wet needs and too short for ii 0.25. In three growth
runs at ii 0.25 against references settled for 1,440 minutes (`bench/hotstart_check.py`), the
grid's method (growth and baseline both cold for 480 min) put the depth rise **11 to 30 mm**
off, classed 2 to 23 chambers differently under the 10 mm rule, and changed 1 to 4 newly-alarm
or newly-surcharged detections per run. The detection rules are 10 and 25 mm, so this is the
size of the effect being measured. ii 0.40 was not checked and is likely no better.

This is why improvement 2 is a stopping rule and not a shorter fixed length: the published
wet-case results need a re-run with runs that settle, and that re-run is what the speed-ups make
affordable.

## 1. Hot start (`hotstart/`)

`model.write_inp` has supported SWMM's `[FILES] USE HOTSTART / SAVE HOTSTART` since Sim 2
(`catchment.py` used it); Sim 2.5's steady scenario never asked for it, so all 1,641 runs of a
case fill the network from empty before the growth's few L/s can show.

`hotstart/tasks.py` runs each case's baseline once until settled (cap 2,880 min), saves its
final state, and starts every growth run of that case from it. A hotstart fits any model with
the same nodes and links, and growth changes inflows only. The file is about 19 KB on the whole
domain, so it travels inside each task as bytes: no shared disk is needed, which is what lets
the same task run in a local pool, on a Dask worker or in a CI job.

Measured at ii 0.25 against references settled for 1,440 min (`bench/hotstart_check.py`; wall
times are on a 6-core laptop under load and are comparable only within a row group):

| Growth run | Wall time | Rise error vs settled | 10 mm rule differs at | Detections differ |
|---|---|---|---|---|
| MH4429357 +150, reference: cold 1,440 min | 111 s | | | |
| grid as published: cold 480 min | 39 s | 25.87 mm | 2 | 2 |
| hot start, 240 min | 21 s | 7.92 mm | 1 | 0 |
| hot start, 360 min | 28 s | 2.64 mm | 0 | 0 |
| hot start, until settled (stopped at 730 min) | 66 s, before sampling (see 2) | 0.09 mm | 0 | 0 |
| MH4427309 +40: grid as published | | 29.91 mm | 23 | 4 |
| hot start, 360 min | | 1.23 mm | 20 | 0 |
| hot start, until settled (stopped at 640 min) | | 0.09 mm | 0 | 0 |

At design wet (`test_speedups --swmm`, the current runner): the baseline settled at 282 min,
within 0.10 mm of a 480-minute run, and a hot-started +150 run settled at 172 min with its rise
within 0.016 mm of the cold 480-minute run's and every flag the same. An earlier timing of the
same pair took 34 s against 142 s for the cold run, about a quarter.

The perturbation from growth itself relaxes slowly in the wet case (the hot start needs 600
to 700 min there), so the hot start alone does not make wet runs short; it removes the fill
from empty, which at ii 0.25 is the 960 minutes a cold run needs before it can settle at all.

## 2. Stop when settled (`converge/`)

`converge/run.py` is `model.run` with the scenario's length as a cap. It watches the 10-minute
peak of every chamber (the quantity `sim25.settled` reports) and compares each window's peaks
with the last window's. As a run settles, one slow mode dominates and the change between
windows shrinks roughly geometrically, so with d_k the largest change at any chamber and
r = d_k / d_(k-1), the change still to come is about d_k r / (1 − r). The run stops when that
projected remainder is under 0.2 mm (the standard R2 states) for two windows in a row, or the
change is under 0.01 mm outright; then it simulates one more window plus two minutes at full
resolution, and that window is what the result holds, read exactly as `model.run` reads it.
It never stops before 30 minutes, and a run that reaches its cap is flagged (`capped`), counted
in each summary's `settling` block, so an unsettled run is visible rather than silent.

While watching, depths are sampled every 60 s rather than every 10 s: reading all 328 chambers
every step is about as costly as the routing on a short hot-started run.

On the two wet-case sites above it stopped at 640 and 730 min and landed within 0.09 mm of the
1,440-minute reference with no classification different. At design wet it stopped the baseline
at 282 min and a growth run at 172.

The wet-case figures were measured before the 60 s sampling was added, when the runner read
every chamber every 10 s (66 s for the 730-minute run above, against 28 s for a fixed 360);
the sampling changes what is read while watching, not the rule or the final window.

## 3. One pool (`one_pool/`)

`sim25_grid.run_case` maps one case at a time, so each case's last runs leave workers idle,
and the baseline runs alone first. `one_pool/scheduler.py` settles every case's baseline at
once, then submits every growth run of every case to one executor, longest first by the
baseline's settling time (wet cases first, segment runs last). Longest-first (LPT) is the
standard greedy for uneven jobs on a fixed number of workers; it matters more once
improvement 2 makes run lengths differ by case. The saving is a few minutes a case, not a
multiple; it is here because it is free once runs are tasks.

`--workers` defaults to the physical core count (logical / 2). The development machine is a
6-core, 12-thread Ryzen 5 7530U; a SWMM run uses one core and gains little from a hyperthread.

## 4. Local runner (`serve_hotstart/`)

```
python -m speedups.serve_hotstart.serve [--port 8001] [--warm]
```

`sim25_serve.py` with its `solve` replaced: the first scenario of a case settles that case's
baseline once and keeps its hotstart, and each later scenario starts from it and stops when
settled. `--warm` settles every case's baseline at start-up. Requests, checks and replies are
`sim25_serve`'s own. Rated-pump scenarios add wet-well tanks the baseline's hotstart does not
have, so they go to the published solve unchanged. Its replies come from settled runs, so in
the wet cases they can differ from the published grid's row for the same scenario (see
"Settling"), and the page's note that a single manhole at +150 reproduces the grid's own run
holds only at design wet and drier until the grid is re-run.

## 5. More machines (`distributed/`)

Every growth run is independent once its case's baseline is known, so the grid parallelises
across machines with no change to the model.

- **Shards** (`shard.py`, `merge.py`). `--shard i/n` runs every n-th growth run of a fixed list
  (round-robin, so each shard gets the same mix of wet and dry) and writes
  `<out>/shards/<case>/shard_i_of_n.json`; `python -m speedups.distributed.merge --out <out>`
  checks every shard is present, the run counts add up, and every shard settled the same
  baseline, then writes the usual summaries. Each shard settles each case's baseline itself
  (minutes a case), so shards share only the code. Works with team laptops: copy the shard
  files to one place and merge.
- **Dask** (`dask_pool.py`). `--executor dask --scheduler tcp://host:8786` sends runs to a Dask
  cluster of lab machines; workers start with `dask worker ... --nworkers <cores> --nthreads 1`
  from `simulation_src`. Dask is not in `requirements.txt`.
- **GitHub Actions** (`github_actions_grid.yml`). A hand-started workflow: 20 shards on free
  4-vCPU Linux runners (public repository), then a merge job, results as a build artifact. It
  is not active until copied into `.github/workflows/`.
- **SLURM** (`slurm_array.sh`). A job array for a university cluster, one shard per array task.

Estimate, not measured: the whole-area grid is about 8,200 runs. On 80 CI cores rather than 6
local ones the same grid takes roughly a thirteenth of the wall time, less the baselines each
shard settles and the job start-up. Before publishing a grid built on Linux, run one small case
on both platforms (`--only <tag> --sites 4`) and compare them (`python -m speedups.compare`):
SWMM builds need not agree to the last bit across compilers.

## Status, 21 Oct 2026

Run and passing: the quick checks; the SWMM checks at design wet (settle, early-stop hotstart
save, hotstart against cold 480); `bench/settling` and `bench/hotstart_check` at ii 0.11 and
0.25 as tabled above. Written and not yet run: the two-shard merge check (stopped part-way when
the machine ran short of memory, not by a failure), a full `fast_grid` grid, `compare`, the
local runner (`serve_hotstart`), Dask, the GitHub Actions workflow and the SLURM script. Run
`python -m speedups.test_speedups --swmm` and one small grid
(`python -m speedups.fast_grid --only ii0.11_flat_uniform_b1_sfree --sites 4`) before relying
on them.

## Checks

```
python -m speedups.test_speedups           # pack/unpack, shard partition (no SWMM)
python -m speedups.test_speedups --swmm    # design wet: settle, hotstart, early-stop hotstart
                                           # save, two shards merge to the one-machine summary
```

`python -m speedups.fast_grid --no-hotstart --fixed-minutes 480 ...` solves every run as
`sim25_grid` does; `python -m speedups.compare` should then show no differences against the
published grid, which checks this pipeline before trusting its speed-ups.

## Adopting it

These are proposals. If adopted into the published pipeline:

1. Re-run the grid with runs that settle (`fast_grid`, or `sim25_grid` with hotstart and the
   stopping rule moved in). The wet cases' figures will move.
2. Correct R2 in `sim25_grid.py` and the private assumptions register: 480 minutes settles at
   design wet and drier, not at ii 0.25. The stopping rule's tolerance (0.2 mm) and caps (2,880
   and 1,440 min) become declared values with this README as their source.
3. Republish (`python tools/build_sim25_web.py --publish`), rerun `node
   tools/check_growth_estimate.js` and update the note in `growth_ui.js` if its figures move,
   and re-establish the expected figures in `test_simulation.py` and `tools/test_sandbox.js`
   deliberately, as `CLAUDE.md` asks when the data change.
4. The page's text that a runner reply reproduces the grid's row is true again once both use
   settled runs.
