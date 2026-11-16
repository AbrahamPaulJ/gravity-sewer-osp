# Design philosophy: the product demo and pages like it

How the demo is designed, and why, so that later iterations and new pages keep the same feel. Each rule comes from a
published principle (sources at the end) or from feedback on this project.

The short version: **one map, one finding per page, controls that prove it, and colour that means something.**

## 1. What the page is for

- **A product, not slides.** The client should be able to test our claims themselves: drag, click, switch, fail a
  sensor, re-run the method. A page with nothing to try is a slide, and it belongs in a report instead.
- **Two audiences, one page.** A presenter walks it on Teams; later, a reader (the supervisor, the client) explores it
  alone. It must work with and without a narrator.
- **Short.** The supervisor found an earlier demo good but wordy and long. Words are a cost; spend them only on the finding
  and on what the reader can do.

## 2. Story structure

- **A martini glass** (Segel & Heer 2010). A narrow, guided path first: the chapter bar, Next buttons and headlines,
  in a fixed order (Problem → Approach → Results → Next). Then a wide body to explore on each page.
  - Every page opens in a state that already shows the point. Exploring is optional; the point is never hidden
    behind a control.
- **Explorable explanations** (Victor 2011). Controls are there to let the reader check a claim, not for decoration. Each
  page steers attention to one phenomenon. Use a callout on the map, presets, and a default state that shows it.
- **Four chapters, at most four pages each.** Twelve pages is the ceiling. A new topic replaces a page or folds into one;
  it does not add a thirteenth.

## 3. Anatomy of a page

| Part | Rule |
|---|---|
| **Crumb** | `Chapter · Page · n of N`. Where am I, and how far is left (Nielsen: visibility of status). |
| **Headline** | One sentence stating the **finding**, with a live number where there is one. "The recommended five see 88% of growth in the worst weather", not "Comparing placements". |
| **Lede** | At most two sentences: what the reader can do here. |
| **Controls** | Chips, sliders, one select. Every control changes the map or a number at once; no Apply buttons, except for slow searches. |
| **Readouts** | At most four stat tiles, then one chart. |
| **Folds** | Everything secondary: method notes, literature, tables of assumptions, the Manning working (NN/g: progressive disclosure). Folds stay open once opened. |
| **Next** | Always last: one button to the next page. |

Budget: **about 120 visible words and one screen** at 1920×1080 before scrolling. If a page needs more, it needs a fold or a split.

## 4. The map

- **Overview first, then zoom and filter, then details on demand** (Shneiderman 1996). Every page opens on the whole
  network. Hover gives a tooltip; click gives a card in the panel.
- **One callout per page**: the single manhole or pipe the headline is about, with a short label (e.g. "If this one fails,
  the worst case drops to 0%").
- **Linked views** (Munzner 2014). When a chart and the map show the same manholes, hovering or clicking one highlights
  the other (the Cross-check scatter is the model to follow).
- **The legend explains only what is drawn now**: no more than five entries.

## 5. Colour means something

Colour is reserved for meaning. Neutral numbers are ink. Each theme sets the same **roles**; code uses roles, never hex
values (`PAL.sensor`, `var(--sensor)`).

| Role | Means | Paper | Night | Clear |
|---|---|---|---|---|
| `sensor` | The plan's sites, and only those (also "best in column") | teal `#2d6a6e` | green `#2ef56b` | green `#047857` |
| `monitor` / `bad` | Overload: newly surcharged, a failed sensor's loss, "Monitor" regions | rust `#b8523b` | `#ff5c7a` | `#be123c` |
| `watch` / `was` | Caution: surcharged before growth, "Watch" regions | amber `#c27a2c` | `#ffa500` | `#d97706` |
| `leave` | Room left | sand | slate | grey |
| `accent` | Interface: links, selection, the current page | `#2c6f86` | `#38bdf8` | `#0369a1` |
| `heat(t)` | How often or how much: a ramp with **no sensor colour in it** | sand → rust | blue → amber | blue → red |
| `rise[0..3]` | Water rise bands, 0.5 / 2 / 5 / 10 mm | sand → deep rust | blue → yellow | light → deep blue |
| `regions` | Region identity: categorical, used only on region pages | muted earth | bright | saturated |

Rules:
- **Contrast:** text at least 4.5:1 against its background (WCAG 1.4.3). Text on a coloured cell switches to the background colour when the cell is strong.
- **Red and green never carry a difference alone:** pair them with position, a label or a ring.
- **New colours** become a role in all three themes, in `THEMES` (app.js) and the CSS tokens (index.html), together.

## 6. Themes

| Theme | For | Character |
|---|---|---|
| **Paper** (default) | Reading, the supervisor's preference | Warm paper, ink type (Inter), teal, rust and amber; after the earlier sensor-plan demo the supervisor liked |
| **Night** | Dark rooms, the site's own look | The original dark palette, with the contrast fixes |
| **Clear** | Projectors, bright rooms, printing | White, slate type, saturated roles, highest contrast |

Switch with the select in the map's tool stack or `T`. The choice is remembered per viewer, and `?theme=night` in the address
sets it for a link.

## 7. Type and presenting

- **Base text 14.5 px; nothing smaller than 10.5 px** (chart axes), and that only for axes.
- **Presentation mode** (`P`, or Present in the map tools) scales the panel, legend, map labels and markers by 1.3, and the
  chapter bar by 1.15, for a Teams share. Teams compresses shared screens (reportedly to 1080p at most), and Microsoft
  advises large, high-contrast text. Present from a 1920×1080 window, full screen.
- One font per theme. The sizes in use: headline 21, body 14.5, controls 13, hints 13, axes 10.5.

## 8. Writing

- **Headline = finding.** One sentence, plain words, a number if there is one.
- No client, suburb or street names anywhere on the page: the repository is public (checked by `tools/verify_demo.js`).
- Say what the reader can do ("click a sensor to fail it"), not what the page "shows".
- Model results are labelled as such: "Uncalibrated model: a guide to where to look first" stays on every page.
- Numbers come from the data at run time, never typed in, so the words and the charts cannot disagree.

## 9. Checklist for a new page

1. Write the headline first: what is the one finding?
2. Pick the default state that shows it, and the one callout that points at it.
3. Add only the controls that let a reader test that finding.
4. Count visible words (≤ ~120) and check it fits one screen at 1920×1080; fold the rest.
5. Use colour roles only; check every theme (`T`) and presentation mode (`P`).
6. Add the page's checks to `tools/verify_demo.js` (it loads, its headline exists, its main interaction works).
7. Try it on someone outside the team with a small task, before it reaches the client.

## 10. Draft status and next steps (branch `rijoy/final-presentation-design`)

Done in this draft:
- Three themes with one palette system (`THEMES` in app.js, CSS tokens in index.html).
- Presentation mode.
- A headline finding on every page.
- One callout per page on six pages.
- Secondary content folded, and folds stay open.
- Numbers in ink, the sensor colour only for sensors, heat ramps without it.
- Contrast and clipped-label fixes, y-axis values on the line charts.
- The theme and Present controls moved into the map tools.

Still to do:
- A callout on the remaining six pages.
- Linked hover between the Insights bars and the map.
- Trim the End-to-end and Sensor-types pages under one screen.
- Re-run Sim 4's level-or-float study on the recommended set.
- A short test with 3–5 people.
- Choose the default theme with the team: Paper is the default here, but the surrounding site is dark.

## Sources

- Segel, E. & Heer, J. (2010). Narrative Visualization: Telling Stories with Data. *IEEE TVCG* 16(6). https://homes.cs.washington.edu/~jheer/files/narrative.pdf
- Victor, B. (2011). Explorable Explanations. https://worrydream.com/ExplorableExplanations/
- Shneiderman, B. (1996). The Eyes Have It: A Task by Data Type Taxonomy for Information Visualizations. *IEEE VL*. https://webspace.science.uu.nl/~telea001/uploads/VACourse/Shneiderman96.pdf
- Munzner, T. (2014). *Visualization Analysis and Design*, ch. 12: Facet into Multiple Views. https://www.cs.ubc.ca/~tmm/talks/minicourse14/minicourse14-session3.pdf
- Nielsen, J. (1994). 10 Usability Heuristics for User Interface Design. https://principles.design/examples/10-usability-heuristics-for-user-interface-design
- Nielsen Norman Group. Progressive Disclosure. https://www.nngroup.com/videos/progressive-disclosure/
- Few, S. (2006). *Information Dashboard Design*. Review: https://uxmatters.com/mt/archives/2007/04/book-review-information-dashboard-design.php
- W3C. WCAG 2.2, Success Criterion 1.4.3 Contrast (Minimum). https://webaim.org/articles/contrast/
- Microsoft. Tips for presenting in large meetings and events in Microsoft Teams. https://support.microsoft.com/en-us/teams/meetings/tips-for-presenting-in-large-meetings-and-events-in-microsoft-teams
