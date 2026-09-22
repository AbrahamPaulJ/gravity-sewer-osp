# Changelog - Simulation 2 Advanced Hydraulic Intelligence & Visual Heatmap
**Git Branch:** `feature/sim2-hydraulics`  
**Target Code Path:** `simulation/` (backing `https://abrahampaulj.github.io/gravity-sewer-osp/#sim2`)  
**Status:** Production-Ready & Verified  

---

## Changes Summary

### 1. Visual Multi-Ring Radial Heatmap Overlay Layer (`simulation/growth_3d.js`)
- Replaced simple node dot recoloring with a true **translucent radial heat-gradient overlay layer** matching the design specification (`media_1790071173730.png`).
- Generates a 256x256 multi-ring radial canvas texture with concentric blended color bands:
  - **Core (0–20% radius):** Coral / Red (`rgba(239, 68, 68, 0.88)`) — Critical Priority ($\ge 75$ pts)
  - **Ring 1 (20–45% radius):** Amber / Orange (`rgba(245, 158, 11, 0.76)`) — High Priority (50–74 pts)
  - **Ring 2 (45–70% radius):** Lime / Green (`rgba(74, 222, 128, 0.60)`) — Moderate Priority (25–49 pts)
  - **Ring 3 (70–88% radius):** Sky Blue / Cyan (`rgba(56, 189, 248, 0.44)`) — Low Priority ($<25$ pts)
  - **Boundary (88–100% radius):** Dark translucent slate fading smoothly to 0.0 alpha
- Positioned on horizontal planes elevated $+1.8\text{ units}$ above inverts with `depthWrite: false`, ensuring chamber spheres and pipes underneath remain crisp and visible.
- Diameter scales dynamically with chamber priority score (45 to 160 units).
- Completely toggleable via the UI view selector.

### 2. Numbered Teardrop Ranking Map Pins (`simulation/growth_3d.js`, `simulation/index.html`)
- Positioned above the top candidate positions (#1, #2, #3, #4, #5) with tips pointing down at the chambers.
- Crisp SVG teardrop bodies with white circular badges and bold rank numbers matching the reference design.
- Includes hover tooltips displaying candidate score and click handlers opening live explainability cards.
- Screen projection matrix recalculates smoothly in the render loop without perspective distortion.

### 3. In-App Live Scenario Reactivity & Explainability (`simulation/growth_ui.js`, `simulation/index.html`)
- Replaced static caching with dynamic `computeHeatmapData()` that re-evaluates all 71 chambers live whenever wet-weather infiltration (`st.ii`) or infill growth (`st.add`) knobs change.
- Added active scenario knobs (`#heatmapIiKnob` and `#heatmapAddKnob`) in the Heatmap tab, fully synchronized with the growth model.
- Created live on-screen explainability card (`#heatmapLiveCard`) updating in real time when hovering or clicking any chamber or pin.
- Displays full parameter influence percentage breakdown:
  - Surcharge & Infiltration Vulnerability (30% weight)
  - Contributing Properties Guarded (25% weight)
  - Downstream Bottleneck Proximity (20% weight)
  - Backwater Pressure Signal Amplitude (15% weight)
  - Upstream Mains Network Inflow Intercepted (10% weight)
- Displays specific operational justification ("Why Here") and adjacent chamber comparisons ("Why Not Adjacent Chambers").

### 4. UI Responsiveness & Integration Improvements (`simulation/index.html`, `simulation/growth_ui.js`)
- **Responsive Drawer ($\le 900\text{px}$):** Added collapsible sidebar drawer toggle button (`#sidebarToggle`) that transitions off-canvas so the 3D WebGL viewport remains completely functional on tablets and mobile screens.
- **Loading Overlay (`#loadingOverlay`):** Added dark backdrop with animated cyan spinner and progress description while Three.js and the network geometry initialize.
- **Error Fallback (`#errorOverlay`):** Added descriptive WebGL context fallback modal if hardware acceleration is unavailable.
- **Dynamic Mode Legend (`#simLegend`):** Created persistent legend that dynamically switches content across Growth, Heatmap, Blockage, and Pumps & Viscosity modes.
- **Data Provenance in Schema Modal:** Added Section 4 detailing real GIS layers vs. EPA SWMM dynamic wave engine solves vs. standard WSA 02-2014 planning assumptions.

### 5. Automated Multi-Perspective Test Suite (`tools/test_simulation2.js`)
- Added automated test for **Upstream Highlighting DAG Isolation**: verifies that clicking a node traverses only true directed graph ancestors, and strictly does NOT leak into any downstream successors.
- Added automated test for **Blockage Backwater Propagation**: verifies that injecting a blockage on pipe 101 propagates backwater surcharge strictly upstream through incoming branches, and zero downstream reaches are affected.
- Added automated test for **Heatmap Scenario Reactivity**: verifies that shifting scenario knobs between dry/low-growth and heavy-storm/high-growth dynamically shifts chamber scores and re-ranks top candidates.
- Full suite of 41 tests passing (100% success). All 42 Sandbox/Simulation 1 tests in `tools/test_sandbox.js` also passing.

---

## Verification of File Changes
Running `git diff origin/main...HEAD --name-status` confirms that only Simulation 2 and test/documentation files have been modified:
```
M   simulation/growth_3d.js
M   simulation/growth_ui.js
M   simulation/index.html
A   tools/test_simulation2.js
A   DATA_PROVENANCE.md
A   CHANGELOG.md
```
**Zero files outside `simulation/`, `tools/`, and root documentation have been touched.** Simulation 1 (`src/`) remains completely untouched and verified.

---

## Instructions for Local Testing
To check out and run this branch locally:
```bash
# 1. Fetch and checkout the feature branch
git fetch origin
git checkout feature/sim2-hydraulics

# 2. Run the automated test suites
node tools/test_simulation2.js
node tools/test_sandbox.js

# 3. Launch a local web server to test in browser
npx serve -l 8080 .
# Open http://localhost:8080/simulation/ in your browser
```
