# Sim 3 region runs: analysis

Generated 2026-10-22 15:53 from 8 cases: ii0.00_flat_uniform_b1_sfree, ii0.11_flat_uniform_b1_sfree, ii0.25_flat_uniform_b1_sfree, ii0.40_flat_uniform_b1_sfree, ii0.11_flat_weighted_b1_sfree, ii0.11_flat_uniform_b1.5_sfree, ii0.25_flat_weighted_b1_sfree, ii0.25_flat_uniform_b1.5_sfree.
Every figure is a model output under the register's assumptions. ✏️ DRAFT

## Regions

| id | manholes | dwellings now | 100% growth (dwellings) | name |
|---|---|---|---|---|
| R1 | 71 | 644 | 109.6 | Upper main line, north-east: the 71 manholes above MH4450193 |
| R2 | 40 | 324 | 55.1 | East branch joining the trunk at pipe 4433482 |
| R3 | 37 | 233 | 39.6 | South-west branch near the outlet, pipe 4476332 |
| R4 | 19 | 100 | 17 | East branch joining the trunk at pipe 4433517 |
| R5 | 19 | 147 | 25 | Central branch at pipe 4433419 |
| R6 | 14 | 113 | 19.2 | South-west branch at pipe 4433080 |
| R8 | 25 | 175 | 485 | Walkerville Terrace corridor |
| R7 | 105 | 829 | 141 | Rest of the suburb: trunk-side manholes and small branches |

Ladder: [0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 3.0]. Runs settled in 252.0 to 1800 minutes; 1 unconverged.

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
| 1 | 25% / 27% | 25% / 27% | 1 | MH4452680 |
| 2 | 36% / 43% | 36% / 43% | 2 | MH4451207, MH4452541 |
| 3 | 56% / 63% | 56% / 63% | 3 | MH4428636, MH4451886, MH4452541 |
| 4 | 69% / 66% | 67% / 75% | 0 | MH4429013, MH4451886, MH4452541, MH4452994 |
| 5 | 83% / 84% | 81% / 85% | 3 | MH4428636, MH4449796, MH4451207, MH4452541, MH4454376 |
| 6 | 86% / 86% | 83% / 90% | 4 | MH1624138, MH4429013, MH4449011, MH4449796, MH4451207, MH4452541 |
| 7 | 91% / 93% | 91% / 93% | 6 | MH4429013, MH4429503, MH4450391, MH4451207, MH4452541, MH4452994, MH4501544 |
| 8 | 92% / 92% | 92% / 94% | 5 | MH4429013, MH4429503, MH4449796, MH4450531, MH4451207, MH4452541, MH4452994, MH4502186 |
| 9 | 94% / 96% | 92% / 96% | 7 | MH4428636, MH4429013, MH4449011, MH4449796, MH4450531, MH4451207, MH4452541, MH4452994, MH4502186 |
| 10 | 94% / 96% | 92% / 97% | 7 | MH4429013, MH4449011, MH4449796, MH4450531, MH4451207, MH4452541, MH4452994, MH4454411, MH4501866, MH4502186 |

### rise25

| k | plain set: plain / risk | risk set: plain / risk | shared | risk set |
|---|---|---|---|---|
| 1 | 6% / 6% | 6% / 6% | 1 | MH1624138 |
| 2 | 23% / 23% | 23% / 23% | 2 | MH1624138, MH4450531 |
| 3 | 41% / 46% | 36% / 50% | 2 | MH1624138, MH4450922, MH4451945 |
| 4 | 64% / 59% | 59% / 71% | 3 | MH4429013, MH4450922, MH4452541, MH6153571 |
| 5 | 81% / 81% | 81% / 81% | 5 | MH4429013, MH4448474, MH4450922, MH4452541, MH6153571 |
| 6 | 82% / 85% | 82% / 85% | 6 | MH4429013, MH4448474, MH4450531, MH4450922, MH4452541, MH6153571 |
| 7 | 88% / 88% | 86% / 91% | 5 | MH4429013, MH4448474, MH4450531, MH4450922, MH4451945, MH4452541, MH6153571 |
| 8 | 91% / 90% | 86% / 92% | 4 | MH4429013, MH4429179, MH4450137, MH4450531, MH4450922, MH4451945, MH4452541, MH6153571 |
| 9 | 92% / 91% | 91% / 95% | 6 | MH4429013, MH4429179, MH4448474, MH4449849, MH4450531, MH4450922, MH4451945, MH4452541, MH6153571 |
| 10 | 94% / 93% | 94% / 96% | 7 | MH4429013, MH4429179, MH4448474, MH4450378, MH4450531, MH4450922, MH4451945, MH4452541, MH4454376, MH6153571 |

### alarm

| k | plain set: plain / risk | risk set: plain / risk | shared | risk set |
|---|---|---|---|---|
| 1 | 0% / 0% | 0% / 0% | 1 | MH4450531 |
| 2 | 0% / 0% | 0% / 0% | 2 | MH1631057, MH4450531 |
| 3 | 0% / 0% | 0% / 0% | 2 | MH1631057, MH4448853, MH4450531 |
| 4 | 0% / 0% | 0% / 0% | 4 | MH1631057, MH4429268, MH4448853, MH4450531 |
| 5 | 8% / 10% | 8% / 10% | 5 | MH1631057, MH4428268, MH4448853, MH4450531, MH4454629 |
| 6 | 38% / 40% | 38% / 40% | 5 | MH1631057, MH4428268, MH4448853, MH4450531, MH4451945, MH4453850 |
| 7 | 50% / 46% | 50% / 46% | 6 | MH1631057, MH4428268, MH4429268, MH4448853, MH4449977, MH4450531, MH4451945 |
| 8 | 64% / 52% | 55% / 75% | 7 | MH1631057, MH4428268, MH4429268, MH4448853, MH4449977, MH4450531, MH4451945, MH4452946 |
| 9 | 69% / 75% | 69% / 75% | 9 | MH1631057, MH4428268, MH4429268, MH4448853, MH4449977, MH4450531, MH4451945, MH4452946, MH4454629 |
| 10 | 83% / 85% | 83% / 85% | 10 | MH1631057, MH4428268, MH4429268, MH4429527, MH4448853, MH4449977, MH4450531, MH4451945, MH4452946, MH4454629 |


## Rule: rise10

Detectable scenarios per case (seen by at least one manhole): ii0.00_flat_uniform_b1_sfree: 6/56, ii0.11_flat_uniform_b1_sfree: 22/56, ii0.25_flat_uniform_b1_sfree: 36/56, ii0.40_flat_uniform_b1_sfree: 36/56, ii0.11_flat_weighted_b1_sfree: 20/56, ii0.11_flat_uniform_b1.5_sfree: 26/56, ii0.25_flat_weighted_b1_sfree: 34/56, ii0.25_flat_uniform_b1.5_sfree: 30/56

### How early each region is seen (worst over cases): best five manholes

- **R1**: MH4448419 at 3, MH4449173 at 3, MH4449785 at 3, MH4450193 at 3, MH4450378 at 3
- **R2**: never seen at any step
- **R3**: never seen at any step
- **R4**: never seen at any step
- **R5**: never seen at any step
- **R6**: never seen at any step
- **R8**: MH1623928 at 1.5, MH1624138 at 1.5, MH1624769 at 1.5, MH1626189 at 1.5, MH1629194 at 1.5
- **R7**: never seen at any step

### First build-out fraction at which any manhole sees the region, per case

Cell: fraction of the region's 100% growth at which the first candidate crosses the rule, and the manhole with the largest rise at that step (count of manholes that see it). A dot means not seen even at 300%.

| region | ii0.00_uniform_b1 | ii0.11_uniform_b1 | ii0.25_uniform_b1 | ii0.40_uniform_b1 | ii0.11_weighted_b1 | ii0.11_uniform_b1.5 | ii0.25_weighted_b1 | ii0.25_uniform_b1.5 |
|---|---|---|---|---|---|---|---|---|
| R1 | 1.5 MH4451207 (2) | 0.25 MH4450581 (6) | 0.1 MH4429013 (2) | 0.1 MH4428268 (2) | 0.25 MH4450922 (4) | 0.1 MH4448345 (9) | 0.1 MH4429013 (1) | 0.1 MH4428636 (3) |
| R2 | 3 MH4451207 (2) | 0.25 MH4450531 (1) | 0.25 MH4448474 (14) | 0.25 MH4446824 (12) | 0.5 MH4450922 (4) | 0.25 MH4450137 (3) | 0.25 MH4448474 (12) | 0.25 MH4448474 (2) |
| R3 | . | . | . | 1.5 MH4501851 (2) | . | . | . | . |
| R4 | . | 1 MH4450581 (1) | 0.75 MH4429179 (8) | 1.5 MH4428920 (12) | 1.5 MH4450922 (4) | 0.75 MH4449011 (8) | 1 MH4429179 (15) | 1.5 MH4428920 (15) |
| R5 | . | . | 0.25 MH4452541 (1) | 0.25 MH4451945 (2) | . | . | 0.25 MH4452541 (1) | 0.25 MH4452541 (1) |
| R6 | . | . | 3 MH4454629 (1) | 1.5 MH4454411 (2) | . | . | 3 MH4454629 (1) | 3 MH4454629 (1) |
| R8 | 1 MH4501544 (6) | 0.5 MH4450531 (9) | 0.1 MH4451870 (2) | 0.25 MH4455121 (33) | 0.5 MH4450922 (6) | 0.25 MH4451871 (27) | 0.25 MH4451870 (71) | 0.5 MH4453512 (25) |
| R7 | . | 1.5 MH4450531 (6) | 0.5 MH4452994 (15) | 0.5 MH4453133 (2) | 1.5 MH4450922 (4) | 1 MH4448345 (25) | 0.5 MH4452994 (2) | 1 MH4452994 (1) |

### Placement: coverage of detectable growth, worst case over the uncertainty cases

| sensors | greedy worst | greedy avg | exact worst | exact avg | exact set |
|---|---|---|---|---|---|
| 1 | 25% | 38% | 25% | 38% | MH4452680 |
| 2 | 30% | 65% | 36% | 70% | MH4451207, MH4452541 |
| 3 | 33% | 71% | 56% | 72% | MH4428636, MH4451886, MH4452541 |
| 4 | 53% | 76% | 69% | 80% | MH4428636, MH4449796, MH4451207, MH4454376 |
| 5 | 67% | 82% | 83% | 88% | MH4429013, MH4449796, MH4451207, MH4452541, MH4455121 |
| 6 | 67% | 87% | 86% | 93% | MH1624769, MH4429013, MH4449011, MH4450391, MH4451207, MH4452541 |
| 7 | 78% | 91% | 91% | 95% | MH4429013, MH4449011, MH4450391, MH4451207, MH4452541, MH4452994, MH4501544 |
| 8 | 83% | 94% | 92% | 97% | MH1629194, MH4429013, MH4449011, MH4450531, MH4451207, MH4452541, MH4452994, MH4454629 |
| 9 | 89% | 96% | 94% | 98% | MH1629194, MH4429013, MH4449011, MH4449796, MH4450531, MH4451207, MH4452541, MH4452994, MH4454629 |
| 10 | 92% | 97% | 94% | 98% | MH4429013, MH4429503, MH4449796, MH4450378, MH4450531, MH4451207, MH4452541, MH4452994, MH4454629, MH4502186 |

Leave-one-case-out at the recommended size: the exact set chosen without a case, scored on it: ii0.00_flat_uniform_b1_sfree 0%, ii0.11_flat_uniform_b1_sfree 91%, ii0.25_flat_uniform_b1_sfree 69%, ii0.40_flat_uniform_b1_sfree 58%, ii0.11_flat_weighted_b1_sfree 100%, ii0.11_flat_uniform_b1.5_sfree 85%, ii0.25_flat_weighted_b1_sfree 71%, ii0.25_flat_uniform_b1.5_sfree 60%

## Rule: rise25

Detectable scenarios per case (seen by at least one manhole): ii0.00_flat_uniform_b1_sfree: 1/56, ii0.11_flat_uniform_b1_sfree: 16/56, ii0.25_flat_uniform_b1_sfree: 24/56, ii0.40_flat_uniform_b1_sfree: 24/56, ii0.11_flat_weighted_b1_sfree: 13/56, ii0.11_flat_uniform_b1.5_sfree: 17/56, ii0.25_flat_weighted_b1_sfree: 23/56, ii0.25_flat_uniform_b1.5_sfree: 22/56

### How early each region is seen (worst over cases): best five manholes

- **R1**: never seen at any step
- **R2**: never seen at any step
- **R3**: never seen at any step
- **R4**: never seen at any step
- **R5**: never seen at any step
- **R6**: never seen at any step
- **R8**: MH1623928 at 3, MH1624138 at 3, MH1624769 at 3, MH1626189 at 3, MH1629194 at 3
- **R7**: never seen at any step

### First build-out fraction at which any manhole sees the region, per case

Cell: fraction of the region's 100% growth at which the first candidate crosses the rule, and the manhole with the largest rise at that step (count of manholes that see it). A dot means not seen even at 300%.

| region | ii0.00_uniform_b1 | ii0.11_uniform_b1 | ii0.25_uniform_b1 | ii0.40_uniform_b1 | ii0.11_weighted_b1 | ii0.11_uniform_b1.5 | ii0.25_weighted_b1 | ii0.25_uniform_b1.5 |
|---|---|---|---|---|---|---|---|---|
| R1 | . | 0.5 MH4450581 (3) | 0.25 MH4429013 (2) | 0.25 MH4428268 (2) | 0.5 MH4450922 (1) | 0.25 MH4448345 (9) | 0.25 MH4429013 (1) | 0.25 MH4428636 (3) |
| R2 | . | 0.5 MH4450531 (1) | 0.5 MH4448474 (14) | 0.5 MH4446824 (3) | 1 MH4450922 (1) | 0.5 MH4450137 (2) | 0.5 MH4448474 (12) | 0.5 MH4448474 (1) |
| R3 | . | . | . | . | . | . | . | . |
| R4 | . | 3 MH4450581 (3) | 3 MH4429179 (43) | 3 MH4428920 (2) | 3 MH4450922 (1) | 3 MH4449011 (25) | 3 MH4429179 (18) | 3 MH4428920 (9) |
| R5 | . | . | 0.75 MH4452541 (1) | 0.5 MH4451945 (1) | . | . | 0.75 MH4452541 (1) | 0.5 MH4451945 (1) |
| R6 | . | . | . | . | . | . | . | . |
| R8 | 3 MH4501544 (10) | 0.75 MH4450531 (6) | 0.25 MH4451870 (2) | 0.5 MH4455121 (27) | 0.75 MH4450922 (4) | 0.75 MH4454116 (31) | 0.5 MH4451870 (67) | 0.75 MH4453512 (14) |
| R7 | . | 3 MH4450531 (2) | 1.5 MH4452994 (48) | 1.5 MH4453133 (14) | . | 3 MH4448345 (27) | 1.5 MH4452994 (36) | 3 MH4452994 (14) |

### Placement: coverage of detectable growth, worst case over the uncertainty cases

| sensors | greedy worst | greedy avg | exact worst | exact avg | exact set |
|---|---|---|---|---|---|
| 1 | 6% | 22% | 6% | 22% | MH1624138 |
| 2 | 23% | 64% | 23% | 64% | MH1624138, MH4450531 |
| 3 | 31% | 74% | 41% | 76% | MH1624138, MH4429013, MH4450922 |
| 4 | 50% | 82% | 64% | 83% | MH4429013, MH4448474, MH4450922, MH6153571 |
| 5 | 73% | 88% | 81% | 91% | MH4429013, MH4448474, MH4450922, MH4452541, MH6153571 |
| 6 | 82% | 90% | 82% | 94% | MH4429013, MH4448474, MH4450531, MH4450922, MH4452541, MH6153571 |
| 7 | 83% | 92% | 88% | 95% | MH1624769, MH4429013, MH4448474, MH4450531, MH4450922, MH4452541, MH4454376 |
| 8 | 86% | 95% | 91% | 95% | MH4428636, MH4448419, MH4448474, MH4450531, MH4450922, MH4452541, MH4454376, MH6153571 |
| 9 | 92% | 97% | 92% | 97% | MH4429013, MH4429179, MH4448474, MH4450378, MH4450531, MH4450922, MH4452541, MH4452994, MH4502186 |
| 10 | 94% | 98% | 94% | 98% | MH4429013, MH4429179, MH4448474, MH4450137, MH4450531, MH4450922, MH4451945, MH4452541, MH4453748, MH4502186 |

Leave-one-case-out at the recommended size: the exact set chosen without a case, scored on it: ii0.00_flat_uniform_b1_sfree 0%, ii0.11_flat_uniform_b1_sfree 81%, ii0.25_flat_uniform_b1_sfree 79%, ii0.40_flat_uniform_b1_sfree 67%, ii0.11_flat_weighted_b1_sfree 31%, ii0.11_flat_uniform_b1.5_sfree 88%, ii0.25_flat_weighted_b1_sfree 74%, ii0.25_flat_uniform_b1.5_sfree 55%

## Rule: rise50

Detectable scenarios per case (seen by at least one manhole): ii0.00_flat_uniform_b1_sfree: 0/56, ii0.11_flat_uniform_b1_sfree: 8/56, ii0.25_flat_uniform_b1_sfree: 17/56, ii0.40_flat_uniform_b1_sfree: 18/56, ii0.11_flat_weighted_b1_sfree: 6/56, ii0.11_flat_uniform_b1.5_sfree: 12/56, ii0.25_flat_weighted_b1_sfree: 16/56, ii0.25_flat_uniform_b1.5_sfree: 14/56

### How early each region is seen (worst over cases): best five manholes

- **R1**: never seen at any step
- **R2**: never seen at any step
- **R3**: never seen at any step
- **R4**: never seen at any step
- **R5**: never seen at any step
- **R6**: never seen at any step
- **R8**: never seen at any step
- **R7**: never seen at any step

### First build-out fraction at which any manhole sees the region, per case

Cell: fraction of the region's 100% growth at which the first candidate crosses the rule, and the manhole with the largest rise at that step (count of manholes that see it). A dot means not seen even at 300%.

| region | ii0.00_uniform_b1 | ii0.11_uniform_b1 | ii0.25_uniform_b1 | ii0.40_uniform_b1 | ii0.11_weighted_b1 | ii0.11_uniform_b1.5 | ii0.25_weighted_b1 | ii0.25_uniform_b1.5 |
|---|---|---|---|---|---|---|---|---|
| R1 | . | 0.75 MH4450581 (1) | 0.5 MH4429013 (2) | 0.5 MH4428268 (2) | 1 MH4450922 (1) | 0.5 MH4448345 (9) | 0.5 MH4429013 (1) | 0.5 MH4428636 (3) |
| R2 | . | 1.5 MH4450531 (1) | 0.75 MH4448474 (2) | 0.75 MH4446824 (2) | 3 MH4450531 (5) | 1 MH4450137 (3) | 0.75 MH4448474 (2) | 1 MH4448474 (1) |
| R3 | . | . | . | . | . | . | . | . |
| R4 | . | . | . | . | . | . | . | . |
| R5 | . | . | 1.5 MH4452541 (1) | 0.75 MH4451945 (1) | . | . | 1.5 MH4452541 (1) | 0.75 MH4451945 (1) |
| R6 | . | . | . | . | . | . | . | . |
| R8 | . | 1.5 MH4450531 (6) | 0.5 MH4451870 (6) | 0.75 MH4455121 (11) | 1.5 MH4450922 (4) | 0.75 MH4454116 (1) | 0.75 MH4451870 (50) | 1.5 MH4454629 (31) |
| R7 | . | . | 3 MH4452994 (50) | 3 MH4453133 (14) | . | . | 3 MH4452994 (33) | . |

### Placement: coverage of detectable growth, worst case over the uncertainty cases

| sensors | greedy worst | greedy avg | exact worst | exact avg | exact set |
|---|---|---|---|---|---|
| 1 | 6% | 47% | 6% | 47% | MH4450531 |
| 2 | 33% | 58% | 33% | 58% | MH4428636, MH4450531 |
| 3 | 50% | 69% | 50% | 74% | MH4429013, MH4450922, MH4451945 |
| 4 | 56% | 78% | 72% | 85% | MH4429013, MH4448474, MH4450922, MH4451945 |
| 5 | 72% | 85% | 76% | 86% | MH4429013, MH4450531, MH4450922, MH4451945, MH4454116 |
| 6 | 75% | 88% | 83% | 92% | MH4429013, MH4448474, MH4450531, MH4450922, MH4452541, MH4454116 |
| 7 | 83% | 93% | 88% | 95% | MH4429013, MH4448474, MH4450531, MH4450922, MH4451945, MH4452541, MH4454116 |
| 8 | 88% | 96% | 92% | 97% | MH4429013, MH4448474, MH4450531, MH4450581, MH4450922, MH4451945, MH4452541, MH4454116 |
| 9 | 92% | 98% | 94% | 98% | MH4429013, MH4448474, MH4450378, MH4450531, MH4450581, MH4450922, MH4451945, MH4452541, MH4454116 |
| 10 | 94% | 99% | 94% | 99% | MH4429013, MH4448345, MH4448474, MH4450531, MH4450581, MH4450922, MH4451945, MH4452189, MH4452541, MH4454116 |

Leave-one-case-out at the recommended size: the exact set chosen without a case, scored on it: ii0.11_flat_uniform_b1_sfree 75%, ii0.25_flat_uniform_b1_sfree 82%, ii0.40_flat_uniform_b1_sfree 56%, ii0.11_flat_weighted_b1_sfree 50%, ii0.11_flat_uniform_b1.5_sfree 75%, ii0.25_flat_weighted_b1_sfree 62%, ii0.25_flat_uniform_b1.5_sfree 71%

## Rule: alarm

Detectable scenarios per case (seen by at least one manhole): ii0.00_flat_uniform_b1_sfree: 1/56, ii0.11_flat_uniform_b1_sfree: 8/56, ii0.25_flat_uniform_b1_sfree: 13/56, ii0.40_flat_uniform_b1_sfree: 6/56, ii0.11_flat_weighted_b1_sfree: 2/56, ii0.11_flat_uniform_b1.5_sfree: 10/56, ii0.25_flat_weighted_b1_sfree: 10/56, ii0.25_flat_uniform_b1.5_sfree: 11/56

### How early each region is seen (worst over cases): best five manholes

- **R1**: never seen at any step
- **R2**: never seen at any step
- **R3**: never seen at any step
- **R4**: never seen at any step
- **R5**: never seen at any step
- **R6**: never seen at any step
- **R8**: never seen at any step
- **R7**: never seen at any step

### First build-out fraction at which any manhole sees the region, per case

Cell: fraction of the region's 100% growth at which the first candidate crosses the rule, and the manhole with the largest rise at that step (count of manholes that see it). A dot means not seen even at 300%.

| region | ii0.00_uniform_b1 | ii0.11_uniform_b1 | ii0.25_uniform_b1 | ii0.40_uniform_b1 | ii0.11_weighted_b1 | ii0.11_uniform_b1.5 | ii0.25_weighted_b1 | ii0.25_uniform_b1.5 |
|---|---|---|---|---|---|---|---|---|
| R1 | . | 0.75 MH4448419 (1) | 0.5 MH4449977 (1) | 1 MH4428268 (1) | 3 MH4450531 (2) | 0.5 MH4448853 (2) | 1.5 MH4429268 (1) | . |
| R2 | . | 1.5 MH4450531 (1) | 1 MH4429527 (1) | . | 3 MH4450531 (1) | 1.5 MH4450137 (2) | 1.5 MH4429268 (1) | . |
| R3 | . | . | . | . | . | . | . | . |
| R4 | . | . | . | . | . | . | 3 MH4429268 (1) | . |
| R5 | . | . | . | 3 MH4451287 (1) | . | . | . | 0.75 MH4451945 (1) |
| R6 | . | . | . | . | . | . | . | 3 MH4454629 (1) |
| R8 | 3 MH1631057 (1) | 1.5 MH4450531 (1) | 0.75 MH4453850 (2) | 1.5 MH4452946 (1) | . | 1 MH4452809 (2) | 0.75 MH4453850 (2) | 0.5 MH4454629 (1) |
| R7 | . | . | 3 MH4453850 (1) | . | . | . | 3 MH4429268 (1) | 3 MH4454629 (1) |

### Placement: coverage of detectable growth, worst case over the uncertainty cases

| sensors | greedy worst | greedy avg | exact worst | exact avg | exact set |
|---|---|---|---|---|---|
| 1 | 0% | 23% | 0% | 23% | MH4450531 |
| 2 | 0% | 36% | 0% | 36% | MH1631057, MH4450531 |
| 3 | 0% | 48% | 0% | 48% | MH4429268, MH4448853, MH4450531 |
| 4 | 0% | 61% | 0% | 61% | MH1631057, MH4429268, MH4448853, MH4450531 |
| 5 | 0% | 70% | 8% | 66% | MH1631057, MH4428268, MH4448853, MH4450531, MH4454629 |
| 6 | 8% | 76% | 38% | 72% | MH1631057, MH4428268, MH4448853, MH4450531, MH4453850, MH4454629 |
| 7 | 50% | 84% | 50% | 84% | MH1631057, MH4428268, MH4429268, MH4448853, MH4449977, MH4450531, MH4454629 |
| 8 | 64% | 88% | 64% | 88% | MH1631057, MH4428268, MH4429268, MH4448853, MH4449977, MH4450531, MH4452946, MH4454629 |
| 9 | 69% | 93% | 69% | 93% | MH1631057, MH4428268, MH4429268, MH4448853, MH4449977, MH4450531, MH4451945, MH4452946, MH4454629 |
| 10 | 83% | 95% | 83% | 95% | MH1631057, MH4428268, MH4429268, MH4429527, MH4448853, MH4449977, MH4450531, MH4451945, MH4452946, MH4454629 |

Leave-one-case-out at the recommended size: the exact set chosen without a case, scored on it: ii0.00_flat_uniform_b1_sfree 0%, ii0.11_flat_uniform_b1_sfree 88%, ii0.25_flat_uniform_b1_sfree 0%, ii0.40_flat_uniform_b1_sfree 0%, ii0.11_flat_weighted_b1_sfree 100%, ii0.11_flat_uniform_b1.5_sfree 0%, ii0.25_flat_weighted_b1_sfree 20%, ii0.25_flat_uniform_b1.5_sfree 0%

## Rule: surcharge

Detectable scenarios per case (seen by at least one manhole): ii0.00_flat_uniform_b1_sfree: 0/56, ii0.11_flat_uniform_b1_sfree: 7/56, ii0.25_flat_uniform_b1_sfree: 14/56, ii0.40_flat_uniform_b1_sfree: 28/56, ii0.11_flat_weighted_b1_sfree: 2/56, ii0.11_flat_uniform_b1.5_sfree: 17/56, ii0.25_flat_weighted_b1_sfree: 13/56, ii0.25_flat_uniform_b1.5_sfree: 6/56

### How early each region is seen (worst over cases): best five manholes

- **R1**: never seen at any step
- **R2**: never seen at any step
- **R3**: never seen at any step
- **R4**: never seen at any step
- **R5**: never seen at any step
- **R6**: never seen at any step
- **R8**: never seen at any step
- **R7**: never seen at any step

### First build-out fraction at which any manhole sees the region, per case

Cell: fraction of the region's 100% growth at which the first candidate crosses the rule, and the manhole with the largest rise at that step (count of manholes that see it). A dot means not seen even at 300%.

| region | ii0.00_uniform_b1 | ii0.11_uniform_b1 | ii0.25_uniform_b1 | ii0.40_uniform_b1 | ii0.11_weighted_b1 | ii0.11_uniform_b1.5 | ii0.25_weighted_b1 | ii0.25_uniform_b1.5 |
|---|---|---|---|---|---|---|---|---|
| R1 | . | 1 MH4450531 (1) | 0.5 MH4449977 (1) | 1 MH4428268 (1) | 3 MH4450531 (1) | 0.25 MH4448345 (1) | 1 MH4429268 (1) | . |
| R2 | . | 1.5 MH4450531 (1) | 1 MH4429527 (1) | . | 3 MH4450531 (1) | 0.75 MH4448345 (1) | 1 MH4429268 (1) | . |
| R3 | . | . | . | 0.25 MH4501866 (1) | . | . | . | . |
| R4 | . | . | . | . | . | 3 MH4449011 (2) | 3 MH4429268 (1) | . |
| R5 | . | . | . | 1.5 MH4501866 (1) | . | . | . | 0.75 MH4451945 (1) |
| R6 | . | . | . | 0.75 MH4501866 (1) | . | . | . | . |
| R8 | . | 1.5 MH4450531 (1) | 0.5 MH4453850 (1) | 0.1 MH4501866 (1) | . | 0.5 MH4448345 (1) | 0.5 MH4429268 (1) | 1.5 MH4454629 (7) |
| R7 | . | . | 3 MH4453850 (1) | 0.25 MH4501866 (1) | . | 3 MH4448345 (2) | 3 MH4453850 (2) | . |

### Placement: coverage of detectable growth, worst case over the uncertainty cases

| sensors | greedy worst | greedy avg | exact worst | exact avg | exact set |
|---|---|---|---|---|---|
| 1 | 0% | 29% | 0% | 29% | MH4450531 |
| 2 | 0% | 43% | 0% | 43% | MH4448345, MH4450531 |
| 3 | 0% | 57% | 0% | 57% | MH4429268, MH4448345, MH4450531 |
| 4 | 0% | 71% | 7% | 62% | MH1624138, MH4448345, MH4450531, MH4501866 |
| 5 | 0% | 84% | 38% | 84% | MH4448345, MH4450531, MH4451945, MH4453850, MH4501866 |
| 6 | 64% | 93% | 64% | 93% | MH4429268, MH4448345, MH4449977, MH4450531, MH4451945, MH4501866 |
| 7 | 86% | 96% | 86% | 96% | MH4429268, MH4429527, MH4448345, MH4449977, MH4450531, MH4451945, MH4501866 |
| 8 | 89% | 98% | 89% | 98% | MH4429268, MH4429527, MH4448345, MH4449977, MH4450531, MH4451945, MH4453850, MH4501866 |
| 9 | 100% | 100% | 100% | 100% | MH4428268, MH4429268, MH4429527, MH4448345, MH4449977, MH4450531, MH4451945, MH4453850, MH4501866 |
| 10 | 100% | 100% | 100% | 100% | MH4428268, MH4429268, MH4429527, MH4448345, MH4449977, MH4450137, MH4450531, MH4451945, MH4453850, MH4501866 |

Leave-one-case-out at the recommended size: the exact set chosen without a case, scored on it: ii0.11_flat_uniform_b1_sfree 100%, ii0.25_flat_uniform_b1_sfree 7%, ii0.40_flat_uniform_b1_sfree 0%, ii0.11_flat_weighted_b1_sfree 100%, ii0.11_flat_uniform_b1.5_sfree 0%, ii0.25_flat_weighted_b1_sfree 8%, ii0.25_flat_uniform_b1.5_sfree 0%

## Choke points (use case E): least headroom to the 150 mm alarm, worst case

| manhole | headroom min (mm) | mean | already in alarm (cases) | regions seen (first detection, 25 mm) |
|---|---|---|---|---|
| MH4428583 | -23.1 | 100.3 | 1 |  |
| MH4448813 | -44.5 | 108.7 | 1 |  |
| MH4428524 | 45.9 | 72.9 | 0 |  |
| MH4451287 | 48.4 | 78.2 | 0 |  |
| MH7465841 | 49.9 | 73.3 | 0 |  |
| MH4429019 | 51.1 | 74.2 | 0 |  |
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

- **ii0.00_flat_uniform_b1_sfree**: R1 7 mm at MH4451207, days 9/34/134; R2 4 mm at MH4451207, days 33/130/520; R3 3 mm at MH4501866, days 37/146/581; R4 1 mm at MH4429179, days 227/905/1825; R5 2 mm at MH4452541, days 163/650/1825; R6 2 mm at MH4454629, days 91/363/1452; R8 11 mm at MH4501544, days 4/13/52; R7 3 mm at MH1629194, days 57/228/912
- **ii0.11_flat_uniform_b1_sfree**: R1 73 mm at MH4450581, days 1/1/2; R2 50 mm at MH4450531, days 1/1/3; R3 2 mm at MH4501866, days 88/350/1398; R4 11 mm at MH4450581, days 4/15/57; R5 1 mm at MH4453098, days 237/947/1825; R6 1 mm at MH4454629, days 186/741/1825; R8 40 mm at MH4450531, days 1/1/4; R7 9 mm at MH4450531, days 6/21/81
- **ii0.25_flat_uniform_b1_sfree**: R1 124 mm at MH4429013, days 1/1/1; R2 80 mm at MH4448474, days 1/1/1; R3 2 mm at MH4501851, days 136/541/1825; R4 14 mm at MH4429179, days 2/8/32; R5 43 mm at MH4452541, days 1/1/4; R6 4 mm at MH4454629, days 29/113/451; R8 99 mm at MH4451870, days 1/1/1; R7 22 mm at MH4452994, days 1/4/14
- **ii0.40_flat_uniform_b1_sfree**: R1 121 mm at MH4428268, days 1/1/1; R2 73 mm at MH4446824, days 1/1/2; R3 8 mm at MH4501851, days 6/23/91; R4 9 mm at MH4428920, days 5/20/78; R5 74 mm at MH4451945, days 1/1/2; R6 8 mm at MH4454411, days 7/27/106; R8 74 mm at MH4455121, days 1/1/2; R7 20 mm at MH4453133, days 1/4/16
- **ii0.11_flat_weighted_b1_sfree**: R1 53 mm at MH4450922, days 1/1/3; R2 27 mm at MH4450922, days 1/3/9; R3 2 mm at MH4501866, days 91/363/1452; R4 8 mm at MH4450922, days 6/24/93; R5 1 mm at MH4453098, days 261/1041/1825; R6 1 mm at MH4454629, days 199/794/1825; R8 35 mm at MH4450922, days 1/2/6; R7 8 mm at MH4450922, days 7/27/105
- **ii0.11_flat_uniform_b1.5_sfree**: R1 182 mm at MH4448345, days 1/1/1; R2 58 mm at MH4450137, days 1/1/2; R3 2 mm at MH4501866, days 89/353/1411; R4 16 mm at MH4449011, days 2/7/26; R5 3 mm at MH4454116, days 61/243/969; R6 1 mm at MH4454629, days 186/741/1825; R8 65 mm at MH4454116, days 1/1/2; R7 12 mm at MH4448345, days 4/13/49
- **ii0.25_flat_weighted_b1_sfree**: R1 112 mm at MH4429013, days 1/1/1; R2 80 mm at MH4448474, days 1/1/1; R3 2 mm at MH4501866, days 142/567/1825; R4 13 mm at MH4429179, days 3/10/37; R5 44 mm at MH4452541, days 1/1/4; R6 4 mm at MH4454629, days 28/109/435; R8 97 mm at MH4451870, days 1/1/1; R7 21 mm at MH4452994, days 1/4/15
- **ii0.25_flat_uniform_b1.5_sfree**: R1 126 mm at MH4428636, days 1/1/1; R2 52 mm at MH4448474, days 1/1/3; R3 2 mm at MH4502186, days 96/381/1523; R4 9 mm at MH4428920, days 5/18/72; R5 80 mm at MH4451945, days 1/1/1; R6 4 mm at MH4454629, days 26/102/405; R8 40 mm at MH4453512, days 1/2/5; R7 12 mm at MH4452994, days 3/11/42

## Pump stations: what SCADA would show at 100% build-out

Only regions that drain through a pump station move its flow. In this network the two pump stations serve part of R7 only; in the 0.25 and 0.40 cases P4433449 also receives trunk overflow through the relief route, so fractions of a percent there are the other regions' overflow, not their sewage. A pump change below about 1% is inside SCADA flow-meter noise.

- **ii0.00_flat_uniform_b1_sfree**: R7: P4433449 +13.9%, P1495438 +13.9%
- **ii0.11_flat_uniform_b1_sfree**: R7: P4433449 +6.0%, P1495438 +7.0%
- **ii0.25_flat_uniform_b1_sfree**: R1: P4433449 +0.5%, P1495438 +0.0%; R2: P4433449 +0.5%, P1495438 +0.0%; R4: P4433449 +0.1%, P1495438 +0.0%; R5: P4433449 +0.3%, P1495438 +0.0%; R6: P4433449 +0.1%, P1495438 +0.0%; R8: P4433449 +2.6%, P1495438 +0.0%; R7: P4433449 +0.6%, P1495438 +4.3%
- **ii0.40_flat_uniform_b1_sfree**: R5: P4433449 +0.1%, P1495438 +0.0%; R6: P4433449 +0.1%, P1495438 +0.0%; R8: P4433449 +1.0%, P1495438 +0.0%; R7: P4433449 +0.3%, P1495438 +3.0%
- **ii0.11_flat_weighted_b1_sfree**: R7: P4433449 +7.3%, P1495438 +7.4%
- **ii0.11_flat_uniform_b1.5_sfree**: R7: P4433449 +6.0%, P1495438 +7.0%
- **ii0.25_flat_weighted_b1_sfree**: R1: P4433449 +0.4%, P1495438 +0.0%; R2: P4433449 +0.5%, P1495438 +0.0%; R4: P4433449 +0.1%, P1495438 +0.0%; R5: P4433449 +0.3%, P1495438 +0.0%; R6: P4433449 +0.1%, P1495438 +0.0%; R8: P4433449 +2.6%, P1495438 +0.0%; R7: P4433449 +0.6%, P1495438 +4.6%
- **ii0.25_flat_uniform_b1.5_sfree**: R5: P4433449 +0.1%, P1495438 +0.0%; R8: P4433449 +0.8%, P1495438 +0.0%; R7: P4433449 +0.2%, P1495438 +4.3%
