# Changelog - Simulation 2 Advanced Hydraulic Intelligence & Visual Heatmap
**Git Branch:** `feature/sim2-hydraulics`  
**Target Code Path:** `simulation/` (backing `https://abrahampaulj.github.io/gravity-sewer-osp/#sim2`)  
**Status:** Production-Ready & Verified (87 Simulation 2 Tests Passing, 42 Sandbox Tests Passing, 0 Regressions)  

> [!NOTE]
> **Comprehensive Technical Guide Available:**  
> For complete technical breakdowns, hydraulic and viscosity derivations, peer-reviewed citations, WebGL optimization architecture, and test matrices across all 16 features from branch start, see [FEATURE_DOCUMENTATION.md](FEATURE_DOCUMENTATION.md).

---

## Changes Summary

### 1. Real-Time Blockage Timeline & Interactive Step Freeze (`simulation/growth_ui.js`, `simulation/growth_3d.js`, `simulation/index.html`)
- **Interactive Playback Engine:** Added play/pause (`#btnTimelinePlay`), step forward 1 min (`#btnTimelineStepFwd`), step backward 1 min (`#btnTimelineStepBack`), reset (`#btnTimelineReset`), speed selector (1x, 5x, 15x, 30x, 60x), and time scrubber (`#timelineScrubber`).
- **Live Time & Status HUD:** Formats elapsed time as `MM:SS`, live spill horizon (`X mins` or `No spill`), and dynamic warning badge (`Pipe Filling (X%)` → `Manhole Surcharging (X%)` → `SURCHARGE OVERFLOW! (MH...)`).
- **Step Freeze Inspection:** Pausing or scrubbing freezes the sewer hydraulic state at that exact simulated second, updating the physics diagnostic card and 3D visual representations.
- **3D Dynamic Water Columns & Overflow Spill Rings:**
  - Rising translucent cyan/red water columns (`blockageWaterGroup`) inside upstream manholes reflecting exact hydraulic water elevations.
  - Surcharged overflowing manholes pulse magenta warning spill rings (`spillRings`) at the ground surface rim.
  - Flow animation particles inside backwater-choked pipes automatically decelerate (0.04x) to visually reflect severe choke resistance.

### 2. Fact-Checked Wastewater Viscosity & Gravity Bed Slope Physics (`simulation/growth_ui.js`)
- **Peer-Reviewed Literature Citations:** Replaced speculative approximations with fact-checked wastewater properties:
  - **Domestic Sewage ($20^\circ\text{C}$):** $\nu = 1.15\text{ mm}^2/\text{s}$, $n = 0.0130$ (Metcalf & Eddy, 2014, *Wastewater Engineering: Treatment and Resource Recovery*, 5th Ed., McGraw-Hill).
  - **High Grease / FOG ($15^\circ\text{C}$):** $\nu = 2.40\text{ mm}^2/\text{s}$, $n = 0.0142$ (He, X. et al., 2017, "Physical properties of fat, oil, and grease deposits in sewer systems", *Water Research* 113).
  - **Cold Primary Sludge ($10^\circ\text{C}$):** $\nu = 3.80\text{ mm}^2/\text{s}$, $n = 0.0151$ (Seyssiecq, I. et al., 2003, "Rheological properties of sludge in wastewater treatment", *Water Science & Technology* 47).
  - **Clean Water ($20^\circ\text{C}$):** $\nu = 1.00\text{ mm}^2/\text{s}$, $n = 0.0130$ (IAPWS, 2008 standard).
- **Physical Slope & Manning Capacity:**
  - Calculates true Euclidean pipe length $L$ and invert drop $\Delta z = |z_u - z_d|$.
  - Computes actual bed slope $S_0 = \frac{\Delta z}{L}$ and full hydraulic radius $R_h = \frac{D}{4}$.
  - Computes full gravity capacity via Manning equation $v = \frac{1}{n_{\text{eff}}} R_h^{2/3} S_0^{1/2}$ and $Q_{\text{full}} = v \cdot A$.
  - Calculates choked constricted capacity $Q_{\text{choked}} = Q_{\text{full}} \cdot (1 - \text{sev}/100)^{1.8}$.
  - Calculates active upstream tributary dry and wet-weather inflow $Q_{\text{in}}$ based on connected homes and rainfall infiltration.
  - Determines exact shaft surcharge volume $V_{\text{shaft}} = (\frac{\pi \cdot 1.05^2}{4}) \cdot \text{depth}$ and spill warning horizon $t_{\text{spill}} = \frac{V_{\text{total}}}{\Delta Q}$.

### 3. Elevation Exaggeration Lever (`simulation/growth_3d.js`, `simulation/index.html`, `simulation/growth_ui.js`)
- **Interactive Top Nav Lever:** Added an elevation exaggeration slider (`#exaggRange`) and readout (`#exaggVal`) in the top navigation bar, adjustable from 1x to 35x (default 18x), matching the Sandbox implementation.
- **Real-Time In-Place 3D Vertex Transformation (`setElevationExaggeration`):** Transforms the Y-coordinates of pipes, chambers, houses, pump stations, outfall rings, and bottleneck sleeves in-place without rebuilding scene geometry or interrupting the render loop.

### 4. 3D Node-Click to Blockage Dropdown Auto-Sync & Glowing Highlight (`simulation/growth_ui.js`, `simulation/index.html`)
- **Full 158-Reach Coverage:** Expanded `#blockagePipe` dropdown from 40 capped pipes to cover all 158 reaches in the Walkerville network.
- **Node-to-Pipe Topological Mapping:** When clicking any node in 3D, maps `nameOf(siteIdx)` through `geom().nodes` to locate its connected sewer reach, automatically selects it in `#blockagePipe`, and resets the timeline.
- **Pulse Glow Animation:** Applies `.pulse-highlight` keyframes (`@keyframes pulseGlow`) with a pulsing cyan border and subtle scale pop, allowing users to locate the selected reach in the dropdown instantly.

### 5. Sub-Window Positioned Directly Below Top Second Nav (`simulation/index.html`, `simulation/growth_ui.js`)
- **Positioned Under Nav:** Moved `<aside id="sideSubWindow">` inside `<div id="stageWrap">`. Since `#stageWrap` is positioned immediately beneath `<nav>`, the drawer slides out right under the top second nav bar, leaving the nav fully visible and clickable above it.
- **Eliminated Duplicate Tabs:** Completely removed `#subwindowTabs` from `#sideSubWindow`. The buttons in the top second nav (`📖 Tool Guide`, `About this model`, `Data Schema & Formulas`, `Assumptions`, `Discussion Q&A`) serve as the single source of truth for switching panes.

### 6. Collapsible Topmost Suite Header into Hidden Menu Button (`index.html`)
- **Collapsible Suite Header:** Added smooth CSS collapse transition to root `header.top`.
- **Hidden Menu Bar Button (`#navMenuBtn`):** Appears when the header is collapsed (displaying `☰ Suite Navigation` or `☰ [Current Tab]`). Clicking it opens `#navMenuDropdown` with options to jump to Overview, Sandbox, Anatomy, Observability, Simulation 1, or Simulation 2.
- **Header Toggle Buttons:** Added `#btnCollapseHeader` (`▲ Hide Menu`) and `#btnExpandHeader` (`▼ Show Header Bar`).
- **Auto-Collapse on Simulations:** Navigating to `sim2`, `sim1`, or `sandbox` automatically collapses the topmost header to give full-screen immersion to the 3D WebGL viewport.

### 7. Window Size Extension, Outside-Click Auto-Close & Double-Click Pin Lock (`simulation/growth_ui.js`, `simulation/index.html`)
- **Left Controls Sidebar Extension (`#grip`):**
  - Added dragging support on the vertical divider (`#grip`) between the left sidebar and map.
  - Allows extending controls width from 240px to 850px for a wide, uncompressed view of all sliders, cards, and diagrams.
  - Calls `Growth3D.resize($("#stage"))` dynamically during resize to keep the 3D canvas viewport proportional.
  - Double-clicking `#grip` toggles between default compact (340px) and wide (560px) view.
  - Persists custom width across sessions to `localStorage ("simSideWidth")`.
- **Right Side Sub-Window Extension (`#subwindowGrip`):**
  - Added a dedicated draggable resizer handle (`#subwindowGrip`) on the left border of `#sideSubWindow`.
  - Allows extending documentation and formula tables from 340px up to 1100px.
  - Double-clicking `#subwindowGrip` toggles between default (480px) and wide view (780px).
  - Persists custom width across sessions to `localStorage ("simSubWindowWidth")`.
- **Outside-Click Auto-Close (`setTab("map")`):**
  - Clicking anywhere outside the side window (e.g. on the 3D canvas, map background, or blank area) automatically closes the side window so the user returns to an unobstructed 3D view.
- **Double-Click Pin Lock:**
  - **Double-clicking anywhere on the side window** toggles a PIN state (`st.subwindowPinned`).
  - When pinned, the side window **stops closing even when clicking outside**, allowing users to orbit, pan, inspect nodes, and interact with the 3D map while keeping documentation or explainability visible!
  - Added `#subwindowPin` button in the header (`📌 Pin` / `📌 Pinned`) and an animated confirmation toast (`#subwindowNotice`).
  - Double-clicking again unpins the window and re-enables auto-closing.

### 8. Clean 3D Node Heatmap Reversion with Pulsing Halo Rings (`simulation/growth_3d.js`)
- Reverted blurry planar canvas discs back to high-performance, crisp 3D node sphere coloring via `getHeatmapHex(score)` (Blue $\to$ Cyan $\to$ Green $\to$ Amber $\to$ Hot Neon Red).
- Retained dynamic sphere radius scaling and 3 glowing pulsing halo rings (`haloRings`) around the top-ranked sensor candidates.

### 9. In-Growth Scenario Sensor Placement Prioritization (`simulation/index.html`, `simulation/growth_ui.js`)
- Added `#growthSensorCard` directly into the Growth view (`#panel-growth`), allowing engineers to evaluate sensor needs within their active growth scenario.
- Integrated multi-criteria prioritization knob (`#growthSensorPriorityKnob`):
  1. **Immediate Need:** Ranks by immediate surcharge/tipping risk under active rainfall infiltration and dwelling loads.
  2. **Homes Guarded:** Ranks by total upstream connected properties monitored (e.g., outfall sentinel `MH4450193` covering 643 homes).
  3. **Sewer Volume:** Ranks by total wastewater effluent discharge monitored ($Q_{\text{total}} = Q_{\text{dry}} + Q_{\text{wet}}$ in L/s and m³/day).
- Clicking any candidate row automatically frames and highlights it in 3D.

### 10. WebGL Performance Optimization & Low-Power Engine (`simulation/growth_3d.js`)
- **Framerate Throttling Gate:** Introduced `targetFPS` limiter (`30 Eco`, `60`, `Max`) via `#fpsToggleGroup` to stop MacBook fan noise and conserve battery.
- **Eco 30 Mode:** Drops DPR to 1.0 (saving 75% GPU fragment overhead) and caps redraws at 30 FPS.
- **Low-Power Context Flags:** `powerPreference: "low-power"` and `precision: "mediump"`.
- **Sleeping on Background Tabs:** Suspends rendering and simulation ticks entirely when `document.hidden` is true.
- **Throttled DOM Layout Projections:** HTML label matrix projections only execute when camera actually moves (`cameraDirty`).

### 11. Relocation of Map Controls to Bottom SimLegend Bar (`simulation/index.html`, `simulation/growth_ui.js`)
- Relocated all 8 map tools, levers, and buttons (`fitAll`, `fitSite`, `togglePan`, `exaggRange`, `fpsToggleGroup`, `toggleSensors`, `toggleFlow`, `toggleBottlenecks`) from top nav to `#simLegendBar > #legendControls` on the left of the bottom legend.
- Cleared the top navbar into a single uncluttered row with `☰ Menu` and right-aligned documentation tabs.
- Added a crisp horizontal separator line (`.legend-divider`) between controls and dynamic legend items.
- Structured so `GrowthUI.renderLegend()` updates legend items without destroying button event listeners.

---

## File Diff Checklist
```
M   index.html (collapsible topmost nav, #navMenuBtn, #navMenuDropdown)
M   simulation/growth_3d.js (dynamic ZEXAG, setElevationExaggeration, setBlockageTimelineState, blockageWaterGroup, fpsLimiter, low-power)
M   simulation/growth_ui.js (window resizers, outside-click close, double-click pin lock, blockage timeline, viscosity, sensor priority)
M   simulation/index.html (subwindow grip, pin button, notice toast, bottom legend controls, legend divider, growth sensor card)
M   tools/test_simulation2.js (deep multi-perspective verification suite: 87 tests)
A   tools/serve.js (standalone review HTTP server)
A   DATA_PROVENANCE.md (Location SA GIS, SWMM 5.2, WSAA 02 standards)
A   FEATURE_DOCUMENTATION.md (Comprehensive 16-feature technical documentation)
A   CHANGELOG.md (this document)
```
**Zero files in Simulation 1 (`src/`) modified.** All 42 Sandbox tests passing.

---

## Automated Test Results
- `node tools/test_simulation2.js`: **87 passed, 0 failed** (100%)
- `node tools/test_sandbox.js`: **42 passed, 0 failed** (100%)

---

## Running the Review Bundle Locally
```bash
# Inside the standalone bundle directory:
node serve.js
# Open http://localhost:8080 in your browser
```

