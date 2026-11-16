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

## 10. Writing for non-technical readers: the Simple reading level

The demo has two reading levels: **Simple** (the default, for the client and anyone who is not an engineer) and
**Detailed** (the full engineering view). Switch in the map tools or with `D`; `?mode=detailed` in the address sets it for a link.
Simple pages live in `demo/simple.js` and reuse the engine, map and state in `app.js`, so the numbers cannot drift between levels.

Why two levels: guidance that helps beginners slows experts down (the expertise reversal effect). One page cannot be right for both.

| # | Principle | Evidence | In the demo |
|---|---|---|---|
| 1 | Experts cannot see their own jargon (the curse of knowledge) | Heath & Heath | Plain words everywhere in Simple. A jargon list is checked automatically (`tools/verify_demo.js`) |
| 2 | Everyday words, written to "you" | US federal plain-language guidelines; Mayer's personalisation principle | "Backing up", not "surcharged"; "rain leaking in", not "infiltration" |
| 3 | Teach a few key words first | Mayer's pre-training principle | Five words with small pictures on page 1 |
| 4 | Concrete first, then abstract | Concreteness fading (Fyfe et al. 2014) | One manhole, one street, one day, then 504 futures, then counts |
| 5 | Walk through one example | Worked-example effect (Sweller) | One future followed through the demo: R3's 2041 homes on a very wet day |
| 6 | Counts, not percentages; show them as icons | Natural frequencies (Gigerenzer & Hoffrage 1995); icon arrays (Galesic et al. 2009) | "14 of 16 futures", drawn as 16 dots |
| 7 | Put numbers in familiar terms | Barrio, Goldstein & Hofman 2016 | 1 cm is about a fingernail's width; a 150 mm pipe is about a side plate |
| 8 | The headline states the message; people remember the headline | Borkin et al. 2015; Kong et al. 2018, 2019 | Headline-first pages. A headline never claims more than the chart shows |
| 9 | Novices look at what stands out, not at what matters | Hegarty, Canham & Fabrikant 2010 | A "How to read the map" note on the map; one callout; the Homes layer off by default; no street basemap |
| 10 | Labels next to what they describe; nothing extra | Spatial contiguity (Ginns 2006 meta-analysis); coherence (Mayer) | Notes and callouts on the map, fewer controls in Simple |
| 11 | Give a frame for an unfamiliar chart | Lee et al. 2016 | Unfamiliar charts (scatter, comparison table, sensor grid) stay in Detailed |
| 12 | An analogy maps relationships, and says where it stops | Gentner 1983 | Roads and traffic; "sewage only flows downhill, so a jam lower down backs up everything above it" |
| 13 | Saying how sure you are barely costs trust | van der Bles et al. 2020, PNAS | "Model results, not yet checked against real readings" on every page; ranges and ties stated |
| 14 | Tie it to consequences | Utility communication guides | "A spill puts sewage into streets and creeks; a fix takes years" |
| 15 | Outcomes as dots help decisions | Kay et al. 2016; Fernandes et al. 2018 | Dots for counts of futures |

Plain words used in Simple (map text is translated by `WORDS` in `simple.js`):

| Technical | Plain |
|---|---|
| surcharged | backing up (water rises up the manhole) |
| overflow / spill | spills out of the lid |
| infiltration | rain and groundwater leaking in |
| run, scenario | a possible future |
| seen (10 mm rise) | notices (water rises 1 cm) |
| worst case | the hardest weather we tested |
| scenario coverage | how many futures the sensors notice |
| Design wet / Beyond design / Severe | wet day / very wet day / extreme wet day |
| Monitor / Watch / Leave | monitor / keep an eye on / room to spare |

Rules for Simple pages:
- At most about 120 visible words, one control group, one chart; the rest goes in a fold or stays in Detailed.
- Every count is "x of y", and drawn as dots when y ≤ 20.
- Everyday comparisons must be checked before use; the ones above are approximate.
- Test each new page on someone outside the team with one small task.

## 11. Draft status and next steps (branch `rijoy/final-presentation-design`)

Done in this draft:
- The Simple reading level (§10): all 12 pages in plain words, the road analogy, five key words, counts as dots,
  one future followed through, everyday comparisons, "How to read the map" notes, and a jargon check in the tests.
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
- A short test with 3–5 people, in Simple mode, with one task each (e.g. "which sensor matters most, and why?").
- Fact-check the everyday comparisons (fingernail, side plate, garden tap) before the client sees them.
- The road analogy is ours and untested: check that it helps rather than confuses.
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

Writing for non-technical readers (§10):
- Heath, C. & Heath, D. (2007). *Made to Stick*; the curse of knowledge. https://heathbrothers.com/category/curse-of-knowledge
- US Federal Plain Language Guidelines. https://digital.gov/guides/plain-language/principles/avoid-jargon
- Mayer, R. E. (2020). *Multimedia Learning*, 3rd ed.; principles summary. https://ugc.futurelearn.com/uploads/files/7d/d6/7dd6188d-c343-4311-b064-ac98d2c95abc/Multimedia_Principles._R._E._Mayer__2020.pdf
- Fyfe, E. R., McNeil, N. M., Son, J. Y. & Goldstone, R. L. (2014). Concreteness fading in mathematics and science instruction. *Educational Psychology Review* 26. https://www.doi.org/10.1007/S10648-014-9249-3
- Sweller, J. & Cooper, G. A. (1985); worked-example and expertise reversal effects. https://en.wikipedia.org/wiki/Worked-example_effect ; https://faculty.engineering.asu.edu/mre/wp-content/uploads/sites/31/2020/02/Exp_Rev_LI06.pdf
- Gigerenzer, G. & Hoffrage, U. (1995); natural frequencies. https://pmc.ncbi.nlm.nih.gov/articles/PMC4504147
- Galesic, M., Garcia-Retamero, R. & Gigerenzer, G. (2009). Using icon arrays to communicate medical risks: overcoming low numeracy. *Health Psychology* 28. https://pure.mpg.de/pubman/item/item_2099767_5/component/file_2562291/MG_Using_2009.pdf
- Barrio, P. J., Goldstein, D. G. & Hofman, J. M. (2016). Improving comprehension of numbers in the news. *CHI 2016*. https://microsoft.com/en-us/research/?p=215388
- Borkin, M. A. et al. (2015). Beyond Memorability: Visualization Recognition and Recall. *IEEE TVCG*. https://vcg.seas.harvard.edu/publications/20150101-beyond-memorability-visualization-recognition-and-recall
- Kong, H.-K., Liu, Z. & Karahalios, K. (2018, 2019). Titles of visualizations: frames, slants and misalignment. *CHI*. https://mail.zcliu.cs.umd.edu/vistitles/CHI18-VisTitles.pdf
- Hegarty, M., Canham, M. S. & Fabrikant, S. I. (2010). Thinking about the weather: display salience and knowledge. *JEP: LMC*. https://escholarship.org/content/qt96k28038/qt96k28038.pdf
- Ginns, P. (2006). Integrating information: spatial and temporal contiguity, a meta-analysis; and later mixed results. https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2019.00086/pdf
- Lee, S. et al. (2016). How do people make sense of unfamiliar visualizations? *IEEE TVCG*. https://www.aminer.org/pub/5687e80c0cf2afdcd166006b/how-do-people-make-sense-of-unfamiliar-visualizations-a-grounded-model-of
- Gentner, D. (1983). Structure-mapping: a theoretical framework for analogy. *Cognitive Science* 7. https://groups.psych.northwestern.edu/gentner/papers/GentnerGentner83.pdf
- van der Bles, A. M. et al. (2020). The effects of communicating uncertainty on public trust in facts and numbers. *PNAS* 117(14). https://research.rug.nl/en/publications/the-effects-of-communicating-uncertainty-on-public-trust-in-facts/
- Kay, M. et al. (2016). When (ish) is my bus? *CHI*; Fernandes, M. et al. (2018). https://mucollective.northwestern.edu/project/when-ish-is-my-bus
- Utility communication: https://www.hdrinc.com/node/11356 ; https://efcnetwork.org/building-community-support-for-wastewater-projects/
