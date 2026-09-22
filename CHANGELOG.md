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

### 8. 3D Viewport Free Movement: Spacebar Hand Pan & 4-Direction Navigation (`simulation/growth_3d.js`, `simulation/index.html`, `simulation/growth_ui.js`)
- **Spacebar Hand Pan:** Holding `Space` switches the mouse left button to `PAN` mode with `cursor: grab / grabbing`, allowing users to drag and translate the 3D map across all four directions (North, South, East, West) without being locked to orbiting a single pivot point.
- **Screen-Space Translation:** Enabled `controls.screenSpacePanning = true` with `controls.panSpeed = 1.25` so panning moves the camera and focal target concurrently. Subsequent zoom-ins zoom into the newly translated area.
- **Keyboard 4-Direction Panning:** Added Arrow Keys (`↑`, `↓`, `←`, `→`) and `WASD` navigation that calculates the camera's orthogonal basis vectors and pans smoothly in all four directions.
- **Pan Lock Mode Button:** Added `Pan: Hold [Space]` toggle button in the main navigation toolbar (`#togglePan`) allowing users to click and lock Pan mode on/off on trackpads or mobile screens without holding keys.
- **HUD Indicator:** Added a subtle bottom HUD badge (`#panHint`) displaying live navigation guidance (`Space + Drag or ↑↓←→ to pan freely`) and highlighting with a cyan pulse whenever Pan is active.
- **Node Selection Guard:** Ensured dragging or panning while Space is held never accidentally triggers node or manhole selection.
### 9. Unified Right-Side Sub-Window Architecture & Tool Guide (`simulation/index.html`, `simulation/growth_ui.js`)
- **Eliminated Floating Center Modals:** Completely removed blocking center modal popups (`#modalBox`, `#sensorModal`, `#schemaModal`).
- **Unified Right-Side Sub-Window Drawer (`#sideSubWindow`):** Added a non-blocking slide-out drawer on the right edge of the viewport (`width: 480px, max-width: 92vw`) that keeps the 3D map fully visible, interactive, and responsive while reviewing formulas, guides, assumptions, or sensor explainability.
- **Top Menu "About this model":** Moved "About this model" (`#btn-info`) into the top menu bar alongside Discussion & Q/A, opening directly into the right-side sub-window.
- **Comprehensive Tool Guide (`📖 Tool Guide`):** Added an interactive introductory guide explaining what each of the 4 simulation views does and delivers (Growth, Heatmap, Blockage, Pumps & Viscosity), full 3D navigation instructions (Spacebar pan, orbit, zoom, inspect), and top navbar document links.
- **Integrated Data Schema & Formulas:** Moved data schemas, physical equations, and Location SA data provenance into the side sub-window (`#pane-schema`).
- **Sensor Placement Explainability Pane:** Clicking candidate pins or selecting candidates opens the technical placement rationale and parameter influence bars directly inside the side drawer (`#pane-sensor`).
- **Escape Key & Tabbed Navigation:** Fully integrated tabbed navigation inside the sub-window, with `Esc` key shortcut to close and return focus to the map.

---

## File Diff Checklist
```
M   simulation/growth_3d.js
M   simulation/growth_ui.js
M   simulation/index.html
A   tools/serve.js
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
