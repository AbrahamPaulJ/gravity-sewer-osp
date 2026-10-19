# Architecture

A static site. No build step, no server, no framework. Every file is served as
written, which is what lets the sanitiser audit it by reading it and lets an incoming
researcher open any file and read the method.

## Layout

```
index.html               landing page; loads the pages below in iframes
osp_sandbox.html         the tool
story.html               the guided story: eight steps from the network to its caveats
manhole_anatomy.html     explainer, standalone, four 3D tabs
why_observability.html   explainer, standalone
src/model/               the models: pure JavaScript, no DOM, loadable in Node
src/ui/                  the sandbox page's state, canvas, controls, worker, and the
                         3D relief and long-section views; the story page's map,
                         views and routing
src/docs/                the documentation panes and the story's steps, generated
                         from the loaded data
data/                    generated datasets; never edited by hand
tools/                   tests and the data formatter
```

## Modules and what reads what

```
data/osp_data.js ─┐    the network: nodes, edges, per-pipe attributes
data/osp_swmm.js ─┤    EPA SWMM dynamic-wave output, precomputed offline by the
                  │    private tools/build_swmm.py and quantised. Read directly by
                  │    the long-section view; no model file touches it.
                  ▼
src/model/osp_core.js      graph (buildGraph), observability (ceilings,
                           computeObservable), scoring, every placement algorithm
        │
        ├── src/model/osp_capacity.js   flow accumulation, Manning, surcharge, growth.
        │                               Uses core's topoOrder; feeds core a marked set.
        └── src/model/osp_risk.js       blockage likelihood from pipe attributes.
                                        Feeds core a weight vector.
                  │
                  ▼
src/ui/osp_ui.js           owns all page state (S), draws the canvas, wires controls,
                           runs the custom-algorithm worker. The only file that
                           touches the DOM for the sandbox tab.
src/ui/osp_3d.js           optional three.js relief view, loaded lazily
src/ui/osp_profile.js      the long-section view. Draws water level from either the
                           Manning model (responds to the sliders, cannot show
                           backwater) or precomputed SWMM playback, and always says
                           which. UMD, so osp_ui.js reads it as window.OSPProfile.
src/docs/osp_docs.js       assumptions register, Q&A, method, glossary (with figures)
```

The story page reads the same data and models through files of its own, so it never
reaches into the sandbox's state:

```
src/docs/osp_story.js      the eight steps, and each one's takeaway as a function of
                           facts computed through the models. Pure, no DOM; also the
                           placement comparison and the caveats the views draw.
src/ui/osp_map.js          a plan-view map for pages other than the sandbox: fit, pan,
                           zoom, pinch, hover and click on chambers and pipes. The
                           caller says how each reach and node is drawn.
src/ui/osp_story_views.js  one screen per step, each drawing on osp_map.js and, for
                           the long section, osp_profile.js
src/ui/osp_story_ui.js     the story page's routing (#1 to #8), header and hover
                           readout. Loaded last.
```

The model files are wrapped UMD-style so they load unchanged in the page and in
Node. That is what makes `tools/test_sandbox.js` possible without a browser.

## The one rule that holds it together

Every objective is a **per-node weight vector**, and `weightOf()` in `osp_core.js` is
the only place that knows what an objective means. "Maximise nodes" is every weight
set to 1. The capacity model and the likelihood model both reach the optimiser by
producing such a vector, and every algorithm consumes it under one rule: count weight
instead of counting nodes. Adding a new objective means producing a vector; no
algorithm changes.

Weights change what is *worth* seeing. They never touch what a sensor *can* see,
which is geometry alone: inverts, cover levels and the flood-fill ceiling.

## Rules worth knowing before editing

**Merges into this file set need care.** The assumptions register is a lettered
document and both sides of a merge have added a "Part D" before now, producing two
sections with colliding row ids; the UI and docs files are the ones that conflict.
`node tools/test_sandbox.js` refuses a tree with conflict markers, a tracked `.orig`,
or a `src/` script that does not parse, which is the specific failure that shipped a
broken sandbox once. Run it before pushing a merge.

**The Assumptions tab is canonical.** Every assumption a model rests on is registered
there, computed from the loaded data where it can be, and other documents point at it
rather than restating it. Add or remove an assumption in code and its row changes in
the same commit.

**Script order is dependency order.** `osp_sandbox.html` loads data, then models,
then views, then `osp_ui.js` last, because the UI captures `window.OSPProfile` into a
const at load time and a view loaded after it is simply undefined. `story.html` does
the same with `osp_story_ui.js` last. The suite checks both pages, since neither
parsing nor a 200 from the server can.

**The story's figures are computed, not typed.** Every takeaway and caveat in
`osp_story.js` is a function of the loaded data, for the same reason the register is.
The few figures the published payload cannot reproduce sit in its `CITED` table, each
with the README finding it comes from. The suite renders every takeaway in Node and
checks the headline figures.

**Cache keys move together.** `index.html` loads each page as `page.html?v=N`, and
`osp_sandbox.html` loads each script as `script.js?v=N`. Browsers refetch the document
and reuse the scripts behind it, so a key on the page alone is not enough. Bump every
`?v=` at once; the sanitiser refuses a page whose scripts disagree. `story.html` loads
the same data and models, so it shares the sandbox's key, and the suite fails if the
two pages or their iframe keys in `index.html` drift apart.

**The data files are generated.** `data/osp_data.js` is written by the harvester in
the private repository and formatted by `tools/format_data.py`; `data/osp_swmm.js` is
written by `tools/build_swmm.py`, which runs EPA SWMM offline because the solve cannot
happen in a browser. Do not edit either by hand, and close them in editors that format
on save; that has reverted the data file twice.

## Private and public

This repository is the **public output** of a private one. The private repository
holds the harvester (`build_demo_data.py`), the sanitiser (`build_public_demo.py`)
and regions that must not be published. The sanitiser rewrites naming phrases,
drops the private regions, then audits its own output and refuses to finish if a
forbidden term survives. Those two scripts are gitignored here for exactly that
reason; if they are ever found tracked in this repository, that is a leak.

The relative layout is identical on both sides, so a file is copied to where it
already is.

## Running and testing

```
python3 -m http.server 8001          # serve; file:// breaks the worker and the 3D view
node tools/test_sandbox.js           # 95 regression checks against the shipped dataset
python3 tools/format_data.py --check # would the data file change if reformatted?
```

The tests are regression checks on one dataset, not unit tests of the algorithms.
Change the data and the expected figures must be re-established deliberately.
