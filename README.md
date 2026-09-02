# Optimal sensor placement in gravity sewers

An interactive sandbox and two explainers for deciding **where to put level sensors in a
sewer network**, built entirely on openly published South Australian data.

**[Open the live site](https://abrahampaulj.github.io/gravity-sewer-osp/)**

Everything runs in the browser. No server, no build step, no tracking.

---

## What is here

| Page | What it is |
|---|---|
| `osp_sandbox.html` | The tool. Place a sensor budget on a real network, compare seven algorithms, inspect the assumptions. |
| `manhole_anatomy.html` | Rotatable 3D half section of a maintenance hole. What the chamber is, where the sensor sits, what a blockage does. |
| `why_observability.html` | Draggable long section: the backwater wedge, and the arithmetic that limits how far a sensor can see. |

Both explainers are standalone and need no data file. If the vocabulary is new, start with
`manhole_anatomy.html`.

## The problem

Blockages in gravity sewers cause overflows. Utilities fit level sensors in maintenance holes to
catch them early, but there are far more chambers than sensors, so placement decides how much of
the network is actually watched. A sensor sees a blockage only if the water backing up behind it
reaches that chamber, which makes this a set-cover problem over a directed acyclic graph.

## Two findings worth more than the tool

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

## The model

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
   in a known direction.

## Method

Implements the topology-and-elevation placement approach of Ninh, Do, Zeng and Lambert (2025),
*Optimal Sensor Placement in Smart Sewer Systems Using Network Topology and Elevation*, JWRPM
151(7), with the modifications described above. Full provenance, including what was changed and
why, is in the tool's Method and sources tab.

## Licence

Code released under the MIT Licence. The underlying network data belongs to its publishers and is
subject to their terms.
