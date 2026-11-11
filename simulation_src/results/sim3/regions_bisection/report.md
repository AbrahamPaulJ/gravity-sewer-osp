# Sim 3 region runs: analysis

Generated 2026-11-08 22:53 from 8 cases: ii0.00_flat_uniform_b1_sfree, ii0.11_flat_uniform_b1_sfree, ii0.25_flat_uniform_b1_sfree, ii0.40_flat_uniform_b1_sfree, ii0.11_flat_weighted_b1_sfree, ii0.11_flat_uniform_b1.5_sfree, ii0.25_flat_weighted_b1_sfree, ii0.25_flat_uniform_b1.5_sfree.
Every figure is a model output under the register's assumptions. ✏️ DRAFT

## Regions

| id | manholes | dwellings now | 100% growth (dwellings) | name |
|---|---|---|---|---|
| R1 | 31 | 317 | 53.9 | Equal-dwelling region 1 of 8: drains to pipe 4433768 |
| R2 | 39 | 287 | 48.8 | Equal-dwelling region 2 of 8: drains to pipe 4433117 |
| R3 | 40 | 320 | 54.4 | Equal-dwelling region 3 of 8: drains to pipe 4433505 |
| R4 | 38 | 315 | 53.6 | Equal-dwelling region 4 of 8: drains to pipe 4433722 |
| R5 | 37 | 233 | 39.6 | Equal-dwelling region 5 of 8: drains to pipe 4476326 |
| R6 | 44 | 352 | 59.9 | Equal-dwelling region 6 of 8: drains to pipe 4433048 |
| R7 | 48 | 323 | 54.9 | Equal-dwelling region 7 of 8: drains to pipe 4433423 |
| R8 | 54 | 418 | 71.1 | Equal-dwelling region 8 of 8: reaches the outlet |
| R9 | 25 | 179 | 485 | Walkerville Terrace corridor (overlaps the regions above) |

Ladder: [0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 3.0]. Runs settled in 252.0 to 1800 minutes; 2 unconverged.

## Wet weather only (no growth): baseline against Dry

| case | in alarm | surcharged | spilling | newly in alarm vs Dry |
|---|---|---|---|---|
| ii0.00_flat_uniform_b1_sfree | 21 | 0 | 0 | 0 |
| ii0.11_flat_uniform_b1_sfree | 34 | 7 | 0 | 13 |
| ii0.25_flat_uniform_b1_sfree | 122 | 107 | 1 | 101 |
| ii0.40_flat_uniform_b1_sfree | 147 | 141 | 6 | 126 |
| ii0.11_flat_weighted_b1_sfree | 34 | 7 | 0 | 13 |
| ii0.11_flat_uniform_b1.5_sfree | 53 | 29 | 0 | 32 |
| ii0.25_flat_weighted_b1_sfree | 119 | 104 | 1 | 98 |
| ii0.25_flat_uniform_b1.5_sfree | 136 | 121 | 5 | 115 |

## Risk-weighted coverage (Kimbrough, expert option)

Each scenario weighted by S x O (S x O per scenario; weighted coverage = sum of w over scenarios seen / sum of w). O: 1 + 9 x max over manholes of proximity x push, proximity = clamp((d/D after - 0.35) / (0.7 - 0.35)), push = clamp(rise / (0.1 x bore)). S: 1 to 10 by decile of homes draining through the manhole where O is scored. A comparison, not the recommendation: the plain set and the risk set at each size, each scored on plain coverage and on risk-weighted coverage (worst case over the cases).

### rise10

| k | plain set: plain / risk | risk set: plain / risk | shared | risk set |
|---|---|---|---|---|
| 1 | 17% / 18% | 17% / 25% | 0 | MH4452680 |
| 2 | 33% / 42% | 32% / 42% | 1 | MH4448419, MH4452189 |
| 3 | 60% / 62% | 55% / 70% | 1 | MH4429312, MH4451886, MH4452541 |
| 4 | 75% / 70% | 70% / 77% | 2 | MH4447394, MH4451207, MH4452541, MH4455121 |
| 5 | 83% / 86% | 83% / 88% | 3 | MH4447394, MH4450391, MH4451207, MH4452541, MH4455121 |
| 6 | 87% / 90% | 85% / 92% | 3 | MH1626189, MH4429499, MH4449796, MH4449913, MH4451207, MH4452541 |
| 7 | 90% / 92% | 90% / 94% | 4 | MH1626189, MH4428268, MH4428920, MH4448345, MH4449796, MH4451207, MH4452541 |
| 8 | 92% / 93% | 90% / 96% | 7 | MH1626189, MH4428268, MH4428920, MH4448345, MH4449796, MH4450531, MH4451207, MH4452541 |
| 9 | 95% / 97% | 92% / 97% | 7 | MH1626189, MH4428268, MH4428920, MH4448345, MH4449796, MH4450531, MH4451207, MH4452541, MH4501866 |
| 10 | 97% / 97% | 92% / 98% | 7 | MH1626189, MH4428268, MH4428636, MH4428920, MH4448345, MH4449796, MH4450531, MH4451207, MH4452541, MH4501866 |

### rise25

| k | plain set: plain / risk | risk set: plain / risk | shared | risk set |
|---|---|---|---|---|
| 1 | 4% / 5% | 4% / 5% | 1 | MH1624769 |
| 2 | 19% / 19% | 19% / 19% | 2 | MH1624769, MH4450531 |
| 3 | 46% / 48% | 46% / 49% | 2 | MH1624769, MH4428636, MH4450922 |
| 4 | 65% / 59% | 62% / 70% | 1 | MH4429499, MH4450922, MH4451945, MH6153571 |
| 5 | 81% / 78% | 81% / 78% | 4 | MH1624769, MH4448345, MH4448474, MH4450922, MH4452541 |
| 6 | 83% / 81% | 83% / 83% | 5 | MH4448345, MH4448474, MH4450922, MH4451945, MH4452541, MH6153571 |
| 7 | 85% / 81% | 83% / 84% | 5 | MH4429499, MH4448474, MH4450581, MH4450922, MH4451945, MH4452541, MH6153571 |
| 8 | 88% / 86% | 88% / 87% | 6 | MH4428636, MH4448345, MH4448474, MH4450581, MH4450922, MH4451945, MH4452541, MH6153571 |
| 9 | 89% / 88% | 89% / 88% | 9 | MH4428636, MH4429503, MH4448345, MH4448474, MH4450581, MH4450922, MH4451945, MH4452541, MH6153571 |
| 10 | 92% / 91% | 92% / 92% | 9 | MH4428268, MH4429107, MH4429503, MH4448345, MH4448474, MH4450581, MH4450922, MH4451945, MH4452541, MH6153571 |

### alarm

| k | plain set: plain / risk | risk set: plain / risk | shared | risk set |
|---|---|---|---|---|
| 1 | 0% / 0% | 0% / 0% | 1 | MH4450531 |
| 2 | 0% / 0% | 0% / 0% | 1 | MH4448853, MH4450531 |
| 3 | 0% / 0% | 0% / 0% | 3 | MH1631057, MH4448853, MH4450531 |
| 4 | 0% / 0% | 0% / 0% | 4 | MH1631057, MH4429268, MH4448853, MH4450531 |
| 5 | 6% / 9% | 6% / 9% | 5 | MH1631057, MH4428268, MH4448853, MH4450531, MH4454629 |
| 6 | 31% / 32% | 30% / 37% | 5 | MH1631057, MH4428268, MH4429527, MH4448853, MH4450531, MH4454629 |
| 7 | 50% / 46% | 50% / 46% | 6 | MH1631057, MH4428268, MH4429268, MH4448853, MH4449977, MH4450531, MH4451945 |
| 8 | 50% / 46% | 50% / 50% | 6 | MH1631057, MH4428268, MH4429268, MH4448853, MH4449977, MH4450531, MH4451945, MH4452946 |
| 9 | 67% / 57% | 58% / 74% | 8 | MH1631057, MH4428268, MH4429268, MH4448419, MH4448853, MH4449977, MH4450531, MH4451945, MH4452946 |
| 10 | 75% / 79% | 75% / 79% | 10 | MH1631057, MH4428268, MH4429268, MH4448419, MH4448853, MH4449977, MH4450531, MH4451945, MH4452946, MH4454629 |


## Rule: rise10

Detectable scenarios per case (seen by at least one manhole): ii0.00_flat_uniform_b1_sfree: 6/63, ii0.11_flat_uniform_b1_sfree: 26/63, ii0.25_flat_uniform_b1_sfree: 37/63, ii0.40_flat_uniform_b1_sfree: 40/63, ii0.11_flat_weighted_b1_sfree: 24/63, ii0.11_flat_uniform_b1.5_sfree: 31/63, ii0.25_flat_weighted_b1_sfree: 36/63, ii0.25_flat_uniform_b1.5_sfree: 34/63

### How early each region is seen (worst over cases): best five manholes

- **R1**: MH4448419 at 3
- **R2**: never seen at any step
- **R3**: never seen at any step
- **R4**: never seen at any step
- **R5**: never seen at any step
- **R6**: never seen at any step
- **R7**: never seen at any step
- **R8**: never seen at any step
- **R9**: MH1623928 at 1.5, MH1624138 at 1.5, MH1624769 at 1.5, MH1626189 at 1.5, MH1629194 at 1.5

### First build-out fraction at which any manhole sees the region, per case

Cell: fraction of the region's 100% growth at which the first candidate crosses the rule, and the manhole with the largest rise at that step (count of manholes that see it). A dot means not seen even at 300%.

| region | ii0.00_uniform_b1 | ii0.11_uniform_b1 | ii0.25_uniform_b1 | ii0.40_uniform_b1 | ii0.11_weighted_b1 | ii0.11_uniform_b1.5 | ii0.25_weighted_b1 | ii0.25_uniform_b1.5 |
|---|---|---|---|---|---|---|---|---|
| R1 | 3 MH4448419 (4) | 0.5 MH4450581 (6) | 0.25 MH4429013 (14) | 0.1 MH4428268 (1) | 0.5 MH4450922 (4) | 0.1 MH4448345 (1) | 0.25 MH4429013 (12) | 0.1 MH4428636 (1) |
| R2 | . | . | 0.25 MH4452541 (1) | 0.25 MH4451945 (2) | . | 3 MH4454116 (2) | 0.25 MH4452541 (1) | 0.25 MH4452541 (1) |
| R3 | 3 MH4451207 (2) | 0.25 MH4450531 (1) | 0.25 MH4448474 (14) | 0.25 MH4446824 (12) | 0.5 MH4450922 (4) | 0.25 MH4450137 (3) | 0.25 MH4448474 (12) | 0.25 MH4448474 (2) |
| R4 | 3 MH4451207 (2) | 0.5 MH4450581 (6) | 0.5 MH4428836 (34) | 0.75 MH4448813 (6) | 0.5 MH4450922 (4) | 0.25 MH4448345 (14) | 0.5 MH4429107 (24) | 0.5 MH4428836 (38) |
| R5 | . | . | . | 1.5 MH4501851 (2) | . | . | . | . |
| R6 | . | . | 1.5 MH4454376 (16) | 0.75 MH4454411 (8) | . | . | 1.5 MH4454376 (16) | 1.5 MH4453512 (2) |
| R7 | . | 0.5 MH4450581 (3) | 0.5 MH4429179 (50) | 1 MH4428920 (1) | 0.75 MH4450922 (5) | 0.5 MH4448345 (25) | 0.5 MH4429179 (45) | 1 MH4428920 (3) |
| R8 | . | . | . | 1.5 MH6153571 (11) | . | . | . | . |
| R9 | 1 MH4501544 (5) | 0.5 MH4450531 (9) | 0.1 MH4451870 (2) | 0.25 MH4454629 (34) | 0.5 MH4450922 (6) | 0.25 MH4451871 (26) | 0.25 MH4451870 (73) | 0.5 MH4453512 (25) |

### Placement: coverage of detectable growth, worst case over the uncertainty cases

| sensors | greedy worst | greedy avg | exact worst | exact avg | exact set |
|---|---|---|---|---|---|
| 1 | 17% | 37% | 17% | 37% | MH4452527 |
| 2 | 31% | 56% | 33% | 62% | MH4447394, MH4452189 |
| 3 | 40% | 77% | 60% | 73% | MH4428636, MH4451886, MH4454629 |
| 4 | 57% | 81% | 75% | 83% | MH4428636, MH4448474, MH4451207, MH4455121 |
| 5 | 67% | 86% | 83% | 91% | MH4449882, MH4450391, MH4451207, MH4452541, MH4456553 |
| 6 | 72% | 89% | 87% | 94% | MH1626189, MH4428920, MH4447394, MH4450391, MH4451207, MH4452541 |
| 7 | 80% | 93% | 90% | 95% | MH1626189, MH4428920, MH4447394, MH4450391, MH4451207, MH4452541, MH4454376 |
| 8 | 83% | 95% | 92% | 98% | MH1626189, MH4428268, MH4428920, MH4448345, MH4450531, MH4451207, MH4452541, MH4454629 |
| 9 | 88% | 97% | 95% | 98% | MH4428268, MH4428920, MH4448345, MH4449796, MH4450531, MH4451207, MH4452541, MH4454629, MH4502186 |
| 10 | 92% | 98% | 97% | 99% | MH4428268, MH4428920, MH4448345, MH4448813, MH4449796, MH4450531, MH4451207, MH4452541, MH4454629, MH4502186 |

Leave-one-case-out at the recommended size: the exact set chosen without a case, scored on it: ii0.00_flat_uniform_b1_sfree 17%, ii0.11_flat_uniform_b1_sfree 92%, ii0.25_flat_uniform_b1_sfree 78%, ii0.40_flat_uniform_b1_sfree 68%, ii0.11_flat_weighted_b1_sfree 100%, ii0.11_flat_uniform_b1.5_sfree 84%, ii0.25_flat_weighted_b1_sfree 75%, ii0.25_flat_uniform_b1.5_sfree 35%

## Rule: rise25

Detectable scenarios per case (seen by at least one manhole): ii0.00_flat_uniform_b1_sfree: 1/63, ii0.11_flat_uniform_b1_sfree: 18/63, ii0.25_flat_uniform_b1_sfree: 28/63, ii0.40_flat_uniform_b1_sfree: 26/63, ii0.11_flat_weighted_b1_sfree: 15/63, ii0.11_flat_uniform_b1.5_sfree: 23/63, ii0.25_flat_weighted_b1_sfree: 26/63, ii0.25_flat_uniform_b1.5_sfree: 26/63

### How early each region is seen (worst over cases): best five manholes

- **R1**: never seen at any step
- **R2**: never seen at any step
- **R3**: never seen at any step
- **R4**: never seen at any step
- **R5**: never seen at any step
- **R6**: never seen at any step
- **R7**: never seen at any step
- **R8**: never seen at any step
- **R9**: MH1623928 at 3, MH1624138 at 3, MH1624769 at 3, MH1626189 at 3, MH1629194 at 3

### First build-out fraction at which any manhole sees the region, per case

Cell: fraction of the region's 100% growth at which the first candidate crosses the rule, and the manhole with the largest rise at that step (count of manholes that see it). A dot means not seen even at 300%.

| region | ii0.00_uniform_b1 | ii0.11_uniform_b1 | ii0.25_uniform_b1 | ii0.40_uniform_b1 | ii0.11_weighted_b1 | ii0.11_uniform_b1.5 | ii0.25_weighted_b1 | ii0.25_uniform_b1.5 |
|---|---|---|---|---|---|---|---|---|
| R1 | . | 0.75 MH4450581 (1) | 0.5 MH4429013 (8) | 0.25 MH4428268 (1) | 1 MH4450922 (1) | 0.25 MH4448345 (1) | 0.5 MH4429013 (7) | 0.25 MH4428636 (1) |
| R2 | . | . | 0.5 MH4452541 (1) | 0.5 MH4451945 (1) | . | . | 0.5 MH4452541 (1) | 0.5 MH4451945 (1) |
| R3 | . | 0.75 MH4450531 (1) | 0.5 MH4448474 (14) | 0.5 MH4446824 (3) | 1 MH4450922 (1) | 0.5 MH4450137 (2) | 0.5 MH4448474 (12) | 0.5 MH4448474 (1) |
| R4 | . | 0.75 MH4450581 (1) | 0.75 MH4428836 (2) | 3 MH4448813 (29) | 1 MH4450922 (1) | 0.5 MH4448345 (9) | 1 MH4429107 (4) | 0.75 MH4428836 (7) |
| R5 | . | . | . | . | . | . | . | . |
| R6 | . | . | . | 1.5 MH4454411 (2) | . | . | . | 3 MH4453512 (1) |
| R7 | . | 1.5 MH4450581 (6) | 1 MH4429179 (42) | 3 MH4428920 (11) | 1.5 MH4450922 (4) | 1 MH4448345 (18) | 1 MH4429179 (16) | 3 MH4428920 (15) |
| R8 | . | . | . | 3 MH6153571 (7) | . | . | . | . |
| R9 | 3 MH4501544 (10) | 0.75 MH4450531 (6) | 0.25 MH4451870 (2) | 0.5 MH4454629 (27) | 0.75 MH4450922 (4) | 0.75 MH4454116 (31) | 0.5 MH4451870 (67) | 0.75 MH4453512 (17) |

### Placement: coverage of detectable growth, worst case over the uncertainty cases

| sensors | greedy worst | greedy avg | exact worst | exact avg | exact set |
|---|---|---|---|---|---|
| 1 | 4% | 21% | 4% | 21% | MH1624769 |
| 2 | 19% | 58% | 19% | 58% | MH1624769, MH4450531 |
| 3 | 27% | 71% | 46% | 73% | MH1624769, MH4449882, MH4450922 |
| 4 | 50% | 80% | 65% | 80% | MH1624769, MH4448474, MH4449882, MH4450922 |
| 5 | 69% | 88% | 81% | 90% | MH4448345, MH4448474, MH4450922, MH4452541, MH6153571 |
| 6 | 81% | 90% | 83% | 91% | MH4429503, MH4448345, MH4448474, MH4450922, MH4452541, MH6153571 |
| 7 | 85% | 92% | 85% | 93% | MH4429503, MH4448345, MH4448474, MH4450581, MH4450922, MH4452541, MH6153571 |
| 8 | 88% | 93% | 88% | 94% | MH4428636, MH4429503, MH4448345, MH4448474, MH4450581, MH4450922, MH4452541, MH4456553 |
| 9 | 89% | 94% | 89% | 95% | MH4428636, MH4429503, MH4448345, MH4448474, MH4450581, MH4450922, MH4451945, MH4452541, MH6153571 |
| 10 | 89% | 95% | 92% | 96% | MH4429107, MH4429136, MH4429503, MH4448345, MH4448474, MH4450581, MH4450922, MH4451945, MH4452541, MH6153571 |

Leave-one-case-out at the recommended size: the exact set chosen without a case, scored on it: ii0.00_flat_uniform_b1_sfree 0%, ii0.11_flat_uniform_b1_sfree 83%, ii0.25_flat_uniform_b1_sfree 75%, ii0.40_flat_uniform_b1_sfree 50%, ii0.11_flat_weighted_b1_sfree 27%, ii0.11_flat_uniform_b1.5_sfree 74%, ii0.25_flat_weighted_b1_sfree 65%, ii0.25_flat_uniform_b1.5_sfree 58%

## Rule: rise50

Detectable scenarios per case (seen by at least one manhole): ii0.00_flat_uniform_b1_sfree: 0/63, ii0.11_flat_uniform_b1_sfree: 9/63, ii0.25_flat_uniform_b1_sfree: 19/63, ii0.40_flat_uniform_b1_sfree: 18/63, ii0.11_flat_weighted_b1_sfree: 6/63, ii0.11_flat_uniform_b1.5_sfree: 17/63, ii0.25_flat_weighted_b1_sfree: 17/63, ii0.25_flat_uniform_b1.5_sfree: 16/63

### How early each region is seen (worst over cases): best five manholes

- **R1**: never seen at any step
- **R2**: never seen at any step
- **R3**: never seen at any step
- **R4**: never seen at any step
- **R5**: never seen at any step
- **R6**: never seen at any step
- **R7**: never seen at any step
- **R8**: never seen at any step
- **R9**: never seen at any step

### First build-out fraction at which any manhole sees the region, per case

Cell: fraction of the region's 100% growth at which the first candidate crosses the rule, and the manhole with the largest rise at that step (count of manholes that see it). A dot means not seen even at 300%.

| region | ii0.00_uniform_b1 | ii0.11_uniform_b1 | ii0.25_uniform_b1 | ii0.40_uniform_b1 | ii0.11_weighted_b1 | ii0.11_uniform_b1.5 | ii0.25_weighted_b1 | ii0.25_uniform_b1.5 |
|---|---|---|---|---|---|---|---|---|
| R1 | . | 1.5 MH4450581 (1) | 0.75 MH4429013 (2) | 0.5 MH4428268 (1) | 3 MH4450922 (4) | 0.5 MH4448345 (1) | 0.75 MH4429013 (2) | 0.5 MH4428636 (1) |
| R2 | . | . | 1 MH4452541 (1) | 0.75 MH4451945 (1) | . | . | 1 MH4452541 (1) | 0.75 MH4451945 (1) |
| R3 | . | 1.5 MH4450531 (1) | 0.75 MH4448474 (2) | 0.75 MH4446824 (2) | 3 MH4450531 (5) | 1 MH4450137 (2) | 0.75 MH4448474 (2) | 1 MH4448474 (1) |
| R4 | . | 1.5 MH4450581 (1) | 1.5 MH4428836 (3) | . | 3 MH4450922 (4) | 0.75 MH4448345 (7) | 3 MH4429107 (30) | 1.5 MH4428836 (7) |
| R5 | . | . | . | . | . | . | . | . |
| R6 | . | . | . | 3 MH4454411 (2) | . | . | . | . |
| R7 | . | 3 MH4450581 (6) | 3 MH4429179 (59) | . | 3 MH4450922 (4) | 3 MH4449011 (29) | 3 MH4429179 (53) | . |
| R8 | . | . | . | . | . | . | . | . |
| R9 | . | 1.5 MH4450531 (6) | 0.5 MH4451870 (3) | 0.75 MH4454629 (11) | 1.5 MH4450922 (4) | 0.75 MH4454116 (1) | 0.75 MH4451870 (50) | 1.5 MH4454629 (31) |

### Placement: coverage of detectable growth, worst case over the uncertainty cases

| sensors | greedy worst | greedy avg | exact worst | exact avg | exact set |
|---|---|---|---|---|---|
| 1 | 6% | 37% | 6% | 37% | MH4450531 |
| 2 | 33% | 47% | 33% | 47% | MH4450531, MH4451945 |
| 3 | 39% | 57% | 47% | 66% | MH4429312, MH4450922, MH4451945 |
| 4 | 50% | 72% | 63% | 77% | MH4448345, MH4448474, MH4451945, MH4452011 |
| 5 | 63% | 78% | 67% | 84% | MH4429312, MH4448345, MH4448474, MH4452011, MH4452541 |
| 6 | 74% | 84% | 74% | 85% | MH4429312, MH4448345, MH4448474, MH4450581, MH4450922, MH4451945 |
| 7 | 78% | 89% | 81% | 88% | MH4428636, MH4448345, MH4448474, MH4450581, MH4452011, MH4452541, MH4454411 |
| 8 | 78% | 92% | 88% | 93% | MH4429312, MH4448345, MH4448474, MH4450581, MH4450922, MH4451945, MH4452541, MH4454629 |
| 9 | 88% | 94% | 89% | 94% | MH4429312, MH4448345, MH4448474, MH4449977, MH4450581, MH4451945, MH4452011, MH4452541, MH4454116 |
| 10 | 89% | 96% | 89% | 96% | MH4428836, MH4429312, MH4448345, MH4448474, MH4450531, MH4450581, MH4451945, MH4452011, MH4452541, MH4454116 |

Leave-one-case-out at the recommended size: the exact set chosen without a case, scored on it: ii0.11_flat_uniform_b1_sfree 67%, ii0.25_flat_uniform_b1_sfree 63%, ii0.40_flat_uniform_b1_sfree 56%, ii0.11_flat_weighted_b1_sfree 0%, ii0.11_flat_uniform_b1.5_sfree 41%, ii0.25_flat_weighted_b1_sfree 71%, ii0.25_flat_uniform_b1.5_sfree 81%

## Rule: alarm

Detectable scenarios per case (seen by at least one manhole): ii0.00_flat_uniform_b1_sfree: 1/63, ii0.11_flat_uniform_b1_sfree: 10/63, ii0.25_flat_uniform_b1_sfree: 16/63, ii0.40_flat_uniform_b1_sfree: 6/63, ii0.11_flat_weighted_b1_sfree: 2/63, ii0.11_flat_uniform_b1.5_sfree: 14/63, ii0.25_flat_weighted_b1_sfree: 10/63, ii0.25_flat_uniform_b1.5_sfree: 12/63

### How early each region is seen (worst over cases): best five manholes

- **R1**: never seen at any step
- **R2**: never seen at any step
- **R3**: never seen at any step
- **R4**: never seen at any step
- **R5**: never seen at any step
- **R6**: never seen at any step
- **R7**: never seen at any step
- **R8**: never seen at any step
- **R9**: never seen at any step

### First build-out fraction at which any manhole sees the region, per case

Cell: fraction of the region's 100% growth at which the first candidate crosses the rule, and the manhole with the largest rise at that step (count of manholes that see it). A dot means not seen even at 300%.

| region | ii0.00_uniform_b1 | ii0.11_uniform_b1 | ii0.25_uniform_b1 | ii0.40_uniform_b1 | ii0.11_weighted_b1 | ii0.11_uniform_b1.5 | ii0.25_weighted_b1 | ii0.25_uniform_b1.5 |
|---|---|---|---|---|---|---|---|---|
| R1 | . | 0.75 MH4448419 (1) | 0.75 MH4449977 (1) | 1 MH4428268 (1) | 3 MH4448419 (1) | 0.75 MH4448853 (2) | 3 MH4429411 (2) | . |
| R2 | . | . | 3 MH4453850 (1) | 3 MH4451287 (1) | . | . | . | 0.5 MH4451945 (1) |
| R3 | . | 1.5 MH4450531 (1) | 1 MH4429527 (1) | . | 3 MH4450531 (1) | 1.5 MH4450137 (2) | 1.5 MH4429268 (1) | . |
| R4 | . | 3 MH4450531 (2) | 1 MH4449977 (1) | . | . | 0.75 MH4448853 (1) | 3 MH4429268 (1) | . |
| R5 | . | . | . | . | . | . | . | . |
| R6 | . | . | . | . | . | . | . | 1.5 MH4454629 (1) |
| R7 | . | 3 MH4450531 (1) | 3 MH4429527 (2) | . | . | 3 MH4448853 (4) | 1.5 MH4429268 (1) | . |
| R8 | . | . | . | . | . | . | . | . |
| R9 | 3 MH1631057 (1) | 1.5 MH4450531 (1) | 0.75 MH4453850 (2) | 1.5 MH4452946 (1) | . | 1 MH4452809 (2) | 0.75 MH4453850 (2) | 0.5 MH4454629 (1) |

### Placement: coverage of detectable growth, worst case over the uncertainty cases

| sensors | greedy worst | greedy avg | exact worst | exact avg | exact set |
|---|---|---|---|---|---|
| 1 | 0% | 15% | 0% | 15% | MH4450531 |
| 2 | 0% | 28% | 0% | 28% | MH1631057, MH4450531 |
| 3 | 0% | 40% | 0% | 40% | MH1631057, MH4448853, MH4450531 |
| 4 | 0% | 52% | 0% | 52% | MH1631057, MH4429268, MH4448853, MH4450531 |
| 5 | 0% | 62% | 6% | 58% | MH1631057, MH4428268, MH4448853, MH4450531, MH4454629 |
| 6 | 0% | 72% | 31% | 63% | MH1631057, MH4428268, MH4448853, MH4450531, MH4453850, MH4454629 |
| 7 | 0% | 80% | 50% | 76% | MH1631057, MH4428268, MH4429268, MH4448853, MH4449977, MH4450531, MH4454629 |
| 8 | 50% | 86% | 50% | 86% | MH1631057, MH4428268, MH4429268, MH4448419, MH4448853, MH4449977, MH4450531, MH4454629 |
| 9 | 67% | 91% | 67% | 91% | MH1631057, MH4428268, MH4429268, MH4448419, MH4448853, MH4449977, MH4450531, MH4452946, MH4454629 |
| 10 | 75% | 95% | 75% | 95% | MH1631057, MH4428268, MH4429268, MH4448419, MH4448853, MH4449977, MH4450531, MH4451945, MH4452946, MH4454629 |

Leave-one-case-out at the recommended size: the exact set chosen without a case, scored on it: ii0.00_flat_uniform_b1_sfree 0%, ii0.11_flat_uniform_b1_sfree 0%, ii0.25_flat_uniform_b1_sfree 0%, ii0.40_flat_uniform_b1_sfree 0%, ii0.11_flat_weighted_b1_sfree 0%, ii0.11_flat_uniform_b1.5_sfree 0%, ii0.25_flat_weighted_b1_sfree 0%, ii0.25_flat_uniform_b1.5_sfree 0%

## Rule: surcharge

Detectable scenarios per case (seen by at least one manhole): ii0.00_flat_uniform_b1_sfree: 0/63, ii0.11_flat_uniform_b1_sfree: 7/63, ii0.25_flat_uniform_b1_sfree: 17/63, ii0.40_flat_uniform_b1_sfree: 33/63, ii0.11_flat_weighted_b1_sfree: 1/63, ii0.11_flat_uniform_b1.5_sfree: 26/63, ii0.25_flat_weighted_b1_sfree: 12/63, ii0.25_flat_uniform_b1.5_sfree: 7/63

### How early each region is seen (worst over cases): best five manholes

- **R1**: never seen at any step
- **R2**: never seen at any step
- **R3**: never seen at any step
- **R4**: never seen at any step
- **R5**: never seen at any step
- **R6**: never seen at any step
- **R7**: never seen at any step
- **R8**: never seen at any step
- **R9**: never seen at any step

### First build-out fraction at which any manhole sees the region, per case

Cell: fraction of the region's 100% growth at which the first candidate crosses the rule, and the manhole with the largest rise at that step (count of manholes that see it). A dot means not seen even at 300%.

| region | ii0.00_uniform_b1 | ii0.11_uniform_b1 | ii0.25_uniform_b1 | ii0.40_uniform_b1 | ii0.11_weighted_b1 | ii0.11_uniform_b1.5 | ii0.25_weighted_b1 | ii0.25_uniform_b1.5 |
|---|---|---|---|---|---|---|---|---|
| R1 | . | 3 MH4450531 (1) | 0.75 MH4449977 (1) | 1 MH4428268 (1) | . | 0.25 MH4448345 (1) | 3 MH4429411 (2) | . |
| R2 | . | . | 3 MH4453850 (1) | 0.5 MH4501866 (1) | . | 3 MH4454376 (1) | . | 0.5 MH4451945 (1) |
| R3 | . | 1.5 MH4450531 (1) | 1 MH4429527 (1) | . | 3 MH4450531 (1) | 0.75 MH4448345 (1) | 1 MH4429268 (1) | . |
| R4 | . | 3 MH4450531 (1) | 1 MH4449977 (1) | . | . | 0.25 MH4448345 (1) | 3 MH4429268 (1) | . |
| R5 | . | . | . | 0.25 MH4501866 (1) | . | . | . | . |
| R6 | . | . | . | 0.25 MH4501866 (1) | . | . | . | . |
| R7 | . | 3 MH4450531 (1) | 3 MH4429527 (3) | . | . | 0.75 MH4448345 (1) | 1.5 MH4429268 (1) | . |
| R8 | . | . | . | 0.25 MH4501866 (1) | . | . | . | . |
| R9 | . | 1.5 MH4450531 (1) | 0.5 MH4453850 (1) | 0.1 MH4501866 (1) | . | 0.5 MH4448345 (1) | 0.5 MH4429268 (1) | 1.5 MH4454629 (7) |

### Placement: coverage of detectable growth, worst case over the uncertainty cases

| sensors | greedy worst | greedy avg | exact worst | exact avg | exact set |
|---|---|---|---|---|---|
| 1 | 0% | 29% | 0% | 29% | MH4450531 |
| 2 | 0% | 43% | 0% | 43% | MH4450531, MH4451945 |
| 3 | 0% | 57% | 0% | 57% | MH4429268, MH4450531, MH4451945 |
| 4 | 0% | 71% | 6% | 61% | MH1624138, MH4448345, MH4450531, MH4501866 |
| 5 | 0% | 84% | 33% | 81% | MH4448345, MH4450531, MH4451945, MH4453850, MH4501866 |
| 6 | 71% | 94% | 71% | 94% | MH4429268, MH4448345, MH4449977, MH4450531, MH4451945, MH4501866 |
| 7 | 88% | 96% | 88% | 96% | MH4429268, MH4429527, MH4448345, MH4449977, MH4450531, MH4451945, MH4501866 |
| 8 | 91% | 98% | 91% | 98% | MH4429268, MH4429527, MH4448345, MH4449977, MH4450531, MH4451945, MH4453850, MH4501866 |
| 9 | 96% | 99% | 96% | 99% | MH4428268, MH4429268, MH4429527, MH4448345, MH4449977, MH4450531, MH4451945, MH4453850, MH4501866 |
| 10 | 100% | 100% | 100% | 100% | MH4428268, MH4429268, MH4429527, MH4448345, MH4449977, MH4450531, MH4451945, MH4453850, MH4454376, MH4501866 |

Leave-one-case-out at the recommended size: the exact set chosen without a case, scored on it: ii0.11_flat_uniform_b1_sfree 100%, ii0.25_flat_uniform_b1_sfree 6%, ii0.40_flat_uniform_b1_sfree 0%, ii0.11_flat_weighted_b1_sfree 100%, ii0.11_flat_uniform_b1.5_sfree 0%, ii0.25_flat_weighted_b1_sfree 8%, ii0.25_flat_uniform_b1.5_sfree 0%

## Choke points (use case E): least headroom to the 150 mm alarm, worst case

| manhole | headroom min (mm) | mean | already in alarm (cases) | regions seen (first detection, 25 mm) |
|---|---|---|---|---|
| MH4428583 | -23.1 | 100.4 | 1 |  |
| MH4448813 | -45.1 | 107.6 | 1 |  |
| MH4428524 | 45.9 | 72.9 | 0 |  |
| MH4451287 | 48.5 | 78.2 | 0 |  |
| MH7465841 | 49.9 | 73.3 | 0 |  |
| MH4429019 | 51.0 | 74.2 | 0 |  |
| MH4501201 | 54.2 | 82.2 | 0 |  |
| MH4500689 | 58.6 | 84.1 | 0 |  |
| MH4428765 | -59.0 | 95.4 | 2 |  |
| MH4450757 | 59.2 | 85.0 | 0 |  |
| MH4449485 | 63.5 | 86.7 | 0 |  |
| MH4449510 | 67.3 | 90.1 | 0 |  |
| MH4450170 | 68.6 | 91.0 | 0 |  |
| MH4500035 | 72.3 | 91.9 | 0 |  |
| MH4452946 | 79.5 | 98.9 | 0 |  |

## Time rule: days of same-hour readings to see each region's full (100%) build-out

sigma is the assumed day-to-day spread of the level at the same hour; N = (2 sigma / rise)^2, capped at 5 years.

- **ii0.00_flat_uniform_b1_sfree**: R1 4 mm at MH4448419, days 30/117/465; R2 2 mm at MH4453489, days 120/478/1825; R3 3 mm at MH4451207, days 34/133/532; R4 3 mm at MH4451207, days 35/138/551; R5 3 mm at MH4501866, days 37/146/581; R6 2 mm at MH4454629, days 90/360/1438; R7 3 mm at MH4451886, days 54/215/859; R8 2 mm at MH1630926, days 120/478/1825; R9 11 mm at MH4501544, days 4/14/53
- **ii0.11_flat_uniform_b1_sfree**: R1 34 mm at MH4450581, days 1/2/6; R2 2 mm at MH4454376, days 94/374/1494; R3 49 mm at MH4450531, days 1/1/3; R4 35 mm at MH4450581, days 1/2/6; R5 2 mm at MH4501866, days 88/350/1398; R6 1 mm at MH4454629, days 186/741/1825; R7 23 mm at MH4450581, days 1/3/12; R8 1 mm at MH1630926, days 217/866/1825; R9 38 mm at MH4450531, days 1/2/5
- **ii0.25_flat_uniform_b1_sfree**: R1 94 mm at MH4429013, days 1/1/1; R2 50 mm at MH4452541, days 1/1/3; R3 80 mm at MH4448474, days 1/1/2; R4 35 mm at MH4428836, days 1/2/6; R5 2 mm at MH4501851, days 136/541/1825; R6 8 mm at MH4454376, days 7/27/105; R7 28 mm at MH4429179, days 1/2/8; R8 2 mm at MH1629194, days 130/517/1825; R9 99 mm at MH4451870, days 1/1/1
- **ii0.40_flat_uniform_b1_sfree**: R1 111 mm at MH4428268, days 1/1/1; R2 77 mm at MH4451945, days 1/1/2; R3 73 mm at MH4446824, days 1/1/2; R4 16 mm at MH4448813, days 2/7/27; R5 8 mm at MH4501851, days 6/23/91; R6 18 mm at MH4454411, days 2/6/21; R7 10 mm at MH4428920, days 4/16/64; R8 10 mm at MH6153571, days 5/17/68; R9 74 mm at MH4454629, days 1/1/2
- **ii0.11_flat_weighted_b1_sfree**: R1 26 mm at MH4450922, days 1/3/10; R2 2 mm at MH4454376, days 98/389/1554; R3 27 mm at MH4450922, days 1/3/9; R4 26 mm at MH4450922, days 1/3/10; R5 2 mm at MH4501866, days 91/363/1452; R6 1 mm at MH4454629, days 196/783/1825; R7 20 mm at MH4450922, days 2/5/17; R8 1 mm at MH1630926, days 220/878/1825; R9 34 mm at MH4450922, days 1/2/6
- **ii0.11_flat_uniform_b1.5_sfree**: R1 102 mm at MH4448345, days 1/1/1; R2 5 mm at MH4454116, days 15/59/236; R3 58 mm at MH4450137, days 1/1/2; R4 87 mm at MH4448345, days 1/1/1; R5 2 mm at MH4501866, days 89/353/1411; R6 1 mm at MH4454629, days 186/741/1825; R7 32 mm at MH4448345, days 1/2/7; R8 1 mm at MH1630926, days 217/866/1825; R9 65 mm at MH4454116, days 1/1/2
- **ii0.25_flat_weighted_b1_sfree**: R1 87 mm at MH4429013, days 1/1/1; R2 51 mm at MH4452541, days 1/1/3; R3 80 mm at MH4448474, days 1/1/2; R4 27 mm at MH4429107, days 1/3/9; R5 2 mm at MH4501866, days 142/567/1825; R6 8 mm at MH4454376, days 7/27/105; R7 26 mm at MH4429179, days 1/3/10; R8 2 mm at MH1629194, days 106/421/1684; R9 97 mm at MH4451870, days 1/1/1
- **ii0.25_flat_uniform_b1.5_sfree**: R1 103 mm at MH4428636, days 1/1/1; R2 83 mm at MH4451945, days 1/1/1; R3 52 mm at MH4448474, days 1/1/3; R4 35 mm at MH4428836, days 1/2/6; R5 2 mm at MH4502186, days 96/381/1523; R6 8 mm at MH4453512, days 7/25/99; R7 11 mm at MH4428920, days 4/14/54; R8 2 mm at MH4502097, days 67/267/1067; R9 40 mm at MH4453512, days 1/1/4

## Pump stations: what SCADA would show at 100% build-out

Only regions that drain through a pump station move its flow. In this network the two pump stations serve only a small part of the suburb; in the 0.25 and 0.40 cases P4433449 also receives trunk overflow through the relief route, so fractions of a percent there are other regions' overflow, not their sewage. A pump change below about 1% is inside SCADA flow-meter noise.

- **ii0.00_flat_uniform_b1_sfree**: R7: P4433449 +0.7%, P1495438 +0.0%; R8: P4433449 +13.2%, P1495438 +13.9%
- **ii0.11_flat_uniform_b1_sfree**: R7: P4433449 +0.3%, P1495438 +0.0%; R8: P4433449 +5.7%, P1495438 +7.0%
- **ii0.25_flat_uniform_b1_sfree**: R1: P4433449 +0.2%, P1495438 +0.0%; R2: P4433449 +0.5%, P1495438 +0.0%; R3: P4433449 +0.5%, P1495438 +0.0%; R4: P4433449 +0.2%, P1495438 +0.0%; R6: P4433449 +0.2%, P1495438 +0.0%; R7: P4433449 +0.5%, P1495438 +0.0%; R8: P4433449 +0.1%, P1495438 +4.3%; R9: P4433449 +2.6%, P1495438 +0.0%
- **ii0.40_flat_uniform_b1_sfree**: R2: P4433449 +0.2%, P1495438 +0.0%; R6: P4433449 +0.2%, P1495438 +0.0%; R7: P4433449 +0.1%, P1495438 +0.0%; R8: P4433449 +0.1%, P1495438 +3.0%; R9: P4433449 +1.1%, P1495438 +0.0%
- **ii0.11_flat_weighted_b1_sfree**: R7: P4433449 +0.4%, P1495438 +0.0%; R8: P4433449 +7.0%, P1495438 +7.4%
- **ii0.11_flat_uniform_b1.5_sfree**: R7: P4433449 +0.3%, P1495438 +0.0%; R8: P4433449 +5.7%, P1495438 +7.0%
- **ii0.25_flat_weighted_b1_sfree**: R1: P4433449 +0.2%, P1495438 +0.0%; R2: P4433449 +0.5%, P1495438 +0.0%; R3: P4433449 +0.5%, P1495438 +0.0%; R4: P4433449 +0.2%, P1495438 +0.0%; R6: P4433449 +0.2%, P1495438 +0.0%; R7: P4433449 +0.5%, P1495438 +0.0%; R8: P4433449 +0.1%, P1495438 +4.6%; R9: P4433449 +2.6%, P1495438 +0.0%
- **ii0.25_flat_uniform_b1.5_sfree**: R2: P4433449 +0.2%, P1495438 +0.0%; R6: P4433449 +0.1%, P1495438 +0.0%; R7: P4433449 +0.1%, P1495438 +0.0%; R8: P4433449 +0.1%, P1495438 +4.3%; R9: P4433449 +0.9%, P1495438 +0.0%
