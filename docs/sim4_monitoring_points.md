# Sim 4: monitoring points (where, what to monitor, which sensor)

Written 25 Oct 2026, **before** the implementation. It replaces the earlier note on "three sensor
roles". Section 7 records what changed while it was built. Every figure was measured on
Simulation 3's published runs and geometry; **no SWMM run**.

## 1. The change

Until now the page proposed "sensors S1…Sk", all of one kind. A network operator thinks in
**monitoring points**:

| | Question | Example |
|---|---|---|
| **Where** | which manhole needs watching | MH 4450531, area R2 |
| **What** | the reading it needs, and what trips an alert | water level, read continuously; alert when wet-weather peaks rise 10 mm over the manhole's own level |
| **Which sensor** | the recommended device, with alternatives and how it is mounted | radar level sensor under the lid; a submersible pressure sensor if the manhole surcharges |

Two monitoring roles are placed now:

| Role | Purpose | Reading | Recommended sensor | Where |
|---|---|---|---|---|
| **Overcapacity, early** | warn that growth is using up a pipe's capacity before any manhole surcharges | **water level**, continuous, against the manhole's own pre-growth level (or % of the outlet pipe full) | **level sensor** (radar or ultrasonic; submersible pressure where the manhole surcharges) | Sim 4's "Before surcharge" set (k from the slider) |
| **Spill, early** | alert before water reaches the lid | **high level**, on/off, set a fixed distance below the lid | **float switch** hung that distance below the lid | every manhole the model says can spill; optionally the near-spill ones too |

The structure is a **catalogue of readings and sensors** (in `config.js`). Further readings, such as
flow at an area's outlet pipe or pump run-hours, are added to the catalogue without changing the
page. The catalogue lists them now as "not placed by the model yet", so the page can describe
them.

## 2. Float locations (spill, early)

**A spill** is water reaching the lid: in Sim 3's runs, a manhole in the `spill` list of a run, or
in a case's `spilled` list before growth.

**Spill manholes:** every manhole that spills in any published run (any case, before growth or at
any build-out up to 300%). Measured: **7 manholes**.
- Two spill only after growth: one at 100% build-out in Beyond design, and one at 300% in Severe.
- The other five already spill before growth in the wettest cases (Beyond design and its variants,
  Severe). None spills in Dry or Design wet.

**Near-spill manholes (optional):** water comes within the trip distance of the lid by 100%
build-out in some case. Measured: with a 300 mm trip distance, **14 more** (21 in all); with 500 mm,
36 more (43 in all).

**Trip level:** the float hangs `float_freeboard_mm` below the lid. 300 mm is the default; 500 mm is
also published.

**Is the float pre-emptive?** For each case in which a float location spills, the tool compares two
build-outs: the smallest at which its freeboard (lid minus water) falls below the trip level, and
the build-out at which it spills.
- **Trips earlier:** a growth-stage warning.
- **Same step:** the coarse ladder cannot separate them.
- **Spills before growth:** the float is a wet-weather spill alarm for today's network. A real
  storm fills the manhole over minutes, so the float still trips before the spill. The model is
  steady-state, so it cannot show those minutes.

Measured freeboard sequences show the gap closing over 3 to 6 build-out steps. One example, in mm:
97 before growth, then 87, 72, 47, 21, 0.

## 3. Which sensor, and why (the recommendation rules)

| Reading | Rule | Recommended | Alternatives | Why |
|---|---|---|---|---|
| Water level | the manhole stays below its outlet pipe's crown in every case and build-out | **radar level sensor**, non-contact, under the lid | ultrasonic level sensor | non-contact; radar is less affected by foam, condensation and temperature than ultrasonic |
| Water level | the water reaches the crown (surcharges) in some case or build-out | **submersible pressure (hydrostatic) level sensor** on the manhole floor | radar mounted with clearance | a non-contact sensor goes blind or is submerged once the shaft fills; a pressure sensor keeps reading through a surcharge |
| High level | always | **float switch**, hung at the trip level below the lid | the level sensor's own high alarm, where the point also has one | simple, independent of power-hungry electronics, the usual spill alarm; the backup if a level sensor fails |

Measured: **147** manholes surcharge in some case or build-out, so they get the pressure sensor
recommendation if chosen. Shafts are 0.35 to 5.3 m deep between the pipe crown and the lid.

Every rule is stated on the page, and the card names the rule that applied to that manhole.

## 4. Settings (`config.js`, `simulation.monitoring`)

| Key | Default | Meaning |
|---|---|---|
| `float_freeboard_mm` | [300, 500] | trip distances below the lid that are computed; the first is the default |
| `near_spill_max_buildout` | 1.0 | near-spill means within the trip distance by this build-out (100%) |
| `catalogue.readings` | level, high level, flow, pump run-hours | what can be monitored: name, purpose, how often, trigger, sensors that read it, status (placed / catalogue only) |
| `catalogue.sensors` | radar, ultrasonic, pressure, float switch, area-velocity flow meter, pump telemetry | each sensor's reading, strengths, limits, mounting |

## 5. The page

- **Two pin types on the map.** Level sensors keep the green pin, now labelled **L1…Lk**. Float
  switches get a yellow pin with a downward cone, labelled **F1…Fn**. A manhole that needs both
  shows both labels.
- **Monitoring plan** in place of the sensor list, one card per location:
  - the badges (L, F);
  - the location;
  - **Monitor:** each reading and its trigger;
  - **Sensor:** the recommended device;
  - the evidence, for example "warns of R1 at 25% (surcharges at 100%)" or "spills in Severe before
    growth; freeboard 97 → 0 mm by 100%".
- **Hover** a monitoring point on the map, or its card, for a short card: reading, trigger and
  recommended sensor. **Click** for the full specification in the right panel:
  - the reading;
  - how often it is read, and the trigger;
  - the recommended sensor, its alternatives and mounting;
  - the rule that chose it, and the evidence.
- **Controls** (expert view): Floats: *where the model spills* | *+ near spill* | *none*; trip
  distance 300 / 500 mm. The Sensors toggle in the top bar hides or shows both kinds.
- **Dashboard:**
  - **9. Spill floats:** a grid of float locations by build-out, coloured by the least freeboard
    over the cases.
  - **10. Readings and sensors:** the catalogue, including the readings not yet placed.
- **Register rows:** B09 (float locations), B10 (trip level), B11 (sensor recommendation rules).
- Everything new keeps the violet "new" accent; the tour gains a step on monitoring points.

## 6. Tests

- The 7 spill manholes, and the 21 and 43 float locations under 300 and 500 mm, recomputed in
  JavaScript from Sim 3's rows and the geometry.
- The pressure-sensor rule: the set of manholes that reach the crown, recomputed.
- Every reading and sensor named on a monitoring point exists in the catalogue.
- The float pins and level pins are drawn with distinct labels (checked headless).

## 7. Changes during implementation

(Filled in as the work proceeds.)
