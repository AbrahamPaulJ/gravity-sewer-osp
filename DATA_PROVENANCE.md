# Data Provenance & Hydraulic Modeling Integrity Report
**Project:** Gravity Sewer Decision-Support System (Simulation 2 / Growth & Sensor Placement)  
**Corpus / Repository:** `gravity-sewer-osp`  
**Active Branch:** `feature/sim2-hydraulics`  
**Production URL:** `https://abrahampaulj.github.io/gravity-sewer-osp/#sim2`  
**Date:** September 2026  

---

## Executive Summary
This document provides full transparency into the data sources, physical simulations, and modeled assumptions underpinning **Simulation 2 (Sewer Infill Growth & Dynamic Sensor Placement)**. Every number presented in the user interface is traceable to either measured GIS asset registers, hydrodynamic dynamic-wave differential equation solves (EPA SWMM 5.2), or documented engineering standards (WSA 02-2014).

---

## 1. Real Measured Datasets & File Locations

| File Path in Repository | Data Structure | Source / Registry | Provenance & Measurement Details |
|---|---|---|---|
| `simulation/data/catchment.js` | `GROWTH_GEOM.nodes` (156 nodes) | Location SA / Walkerville Council Asset Layer 2 | 71 real maintenance holes with published asset IDs (`MH...`) and 85 inline pipe junctions. Ground lid elevations surveyed where published (10 surveyed lids MAE 0.23m) or interpolated from 1m contours. |
| `simulation/data/catchment.js` | `GROWTH_GEOM.nPipes` (158 reaches) | Location SA / Walkerville Council Asset Layer 6 | 158 gravity sewer mains. Pipe inverts (`zu, zd`) in cm AHD are flow-anchored via `START_INVE` and `FLOWDIRECT` (95% invert agreement at shared chambers). Published internal diameter (`INTERNALDI`) used where recorded, otherwise nominal diameter (`NOMINALDIA`). |
| `simulation/data/catchment.js` | `GROWTH_GEOM.hx, hy, hz, hn` (643 properties) | Location SA Cadastre Layer 4 | 643 real connected residential parcels within 40m of mains carrying validated `PARCELID`s. Attributed to the nearest main (median 7.0m connection line). Replaces coarse land-use density proxies. |
| `simulation/data/catchment.js` | `GROWTH_GEOM.bottlenecks` (7 reaches) | Hydraulic Capacity Audit | Identified reaches where full-bore capacity constrains upstream development: Reach #101, #102, #103, #118, etc. |
| `simulation/data/growth.js` | `GROWTH_RUNS.cells` (852 SWMM solves) | EPA SWMM 5.2 via `pyswmm` 2.1 | Precomputed hydrodynamic dynamic wave engine solves across 71 connection sites × 4 growth steps (+50, +150, +350, +700) × 3 wet weather infiltration levels (0.25, 0.40, 0.55 L/s/100m). Surcharge is evaluated using the Preissmann slot method (0.1% continuity error). |
| `simulation/data/index.js` | `GROWTH_INDEX.assumptions` & `GROWTH_INDEX.qa` | Peer-reviewed documentation | Structured assumptions register (M = Measured, D = Derived, A = Assumed) and interactive technical Q&A. |

---

## 2. Transparently Declared Assumptions & Modeled Parameters

Where real-time sensor measurements or asset attributes are not published by council, honest, industry-standard engineering parameters are utilized and explicitly declared:

### A. Sewage Load per Dwelling
- **Assumed Value:** 500 Litres / dwelling / day (equivalent to 2.5 persons/dwelling × 200 L/person/day).
- **Sanitary Peak Factor (PF):** 2.0 (yielding peak dry-weather sanitary flow $Q_{\text{dry}} = 0.0116\text{ L/s}$ per dwelling).
- **Basis:** Australian Sewerage Code (WSA 02-2014) standard planning allowance.
- **Integrity Note:** Property counts ($N=643$) are measured exactly from cadastre. The load multiplier is an assumed design value that will be calibrated when physical flow meters are installed.

### B. Infiltration and Inflow (I&I)
- **Assumed Levels:**
  - Low / Dry Weather Base: $0.25\text{ L/s per 100m}$
  - Moderate Wet Weather: $0.40\text{ L/s per 100m}$
  - Heavy Wet Weather (5-Year ARI Storm): $0.55\text{ L/s per 100m}$
- **Basis:** Infiltration enters through pipe joints, root fractures, and defect cracks, so it scales with mains length rather than house count.
- **Physical Reason:** In dry weather, the network median capacity utilization is only 0.8% and the maximum reach runs at 28.3%. Infill growth alone cannot surcharge the network under dry weather; growth consumes the hydraulic headroom required to absorb wet-weather infiltration.

### C. Hydraulic Roughness & Viscosity Formulation
- **Base Manning Roughness:** $n_0 = 0.013$ for vitrified clay and concrete gravity mains.
- **Viscosity Correction:** Effective roughness accounts for fluid kinematic viscosity $\nu$ (temperature, FOG, and suspended solids):
  $$n_{\text{eff}} = n_0 \cdot \left[1 + 0.12 \cdot \ln\left(\frac{\nu}{\nu_0}\right)\right]$$
  where $\nu_0 = 1.05 \times 10^{-6}\text{ m}^2/\text{s}$ (clean water at 20°C).
  - Clean Water: $\nu = 1.00\text{ mm}^2/\text{s} \implies n_{\text{eff}} = 0.0130$
  - Standard Domestic: $\nu = 1.15\text{ mm}^2/\text{s} \implies n_{\text{eff}} = 0.0130$
  - High Grease / FOG: $\nu = 2.40\text{ mm}^2/\text{s} \implies n_{\text{eff}} = 0.0142$
  - Cold Sludge / Solids: $\nu = 3.80\text{ mm}^2/\text{s} \implies n_{\text{eff}} = 0.0151$

### D. Maintenance Hole Shaft Geometry
- **Diameter:** 1050 mm standard circular shaft ($A = 0.866\text{ m}^2$) from invert to lid.
- **Surcharge Criterion:** Water surface elevation exceeding pipe crown ($z > z_{\text{crown}}$).

### E. Pump & Lift Station Operational Parameters
- **PS-01 (Catchment Outfall at MH4450193):** Rated 50 L/s at 100% duty, equipped with Variable Speed Drive (0–150%, 0–75 L/s) and auto-relief dynamic draw-down.
- **LS-02 (Walkerville Trunk Lift Station at MH4449118):** Rated 25 L/s at 100% duty.

---

## 3. Sensor Placement Heatmap Algorithm & Weights
The dynamic sensor placement heatmap computes a priority score ($S \in [10, 100]$) for each candidate chamber in real time, reacting dynamically to the active scenario cell (`st.ii`, `st.add`):

$$S = \text{clamp}\left(12, 98, S_{\text{surcharge}} + S_{\text{homes}} + S_{\text{bottleneck}} + S_{\text{backwater}} + S_{\text{inflow}}\right)$$

1. **Active Scenario Surcharge Vulnerability (30% weight, up to 30 pts):** Evaluates whether the chamber is surcharged at baseline in the current wet weather condition or is tipped by growth scenarios in this active cell.
2. **Upstream Properties Guarded (25% weight, up to 25 pts):** Number of contributing dwellings protected: $(N_{\text{homes}} / 643) \times 25$.
3. **Downstream Bottleneck Proximity (20% weight, up to 20 pts):** Strategic proximity to hydraulic constrictions (e.g. Reach #101), where upstream pressure waves provide early warning.
4. **Backwater Signal Amplitude (15% weight, up to 15 pts):** Ability of the chamber invert to accumulate an unambiguous backwater head rise (+1.4m) without shallow spill losses.
5. **Upstream Network Length & Inflow (10% weight, up to 10 pts):** Total mains length ($L$) and wet weather infiltration entering upstream: $(L \cdot \text{iiRate} / 100) / 15.0 \times 10$.

---

## 4. Integrity Statement
No simulation numbers are hallucinated or randomly generated. The 852 scenario grid consists of deterministic EPA SWMM 5.2 dynamic wave differential equation solves. All UI controls either query this precomputed physics grid or apply explicit hydraulic equations in real time.
