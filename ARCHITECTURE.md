# Architecture

A static site. No build step, no server, no framework. Every file is served as
written, which is what lets the sanitiser audit it by reading it and lets an incoming
researcher open any file and read the method.

## Layout

```
index.html               landing page; loads the three pages below in iframes
osp_sandbox.html         the tool
manhole_anatomy.html     explainer, standalone, four 3D tabs
why_observability.html   explainer, standalone
src/model/               the models: pure JavaScript, no DOM, loadable in Node
src/ui/                  the sandbox page's state, canvas, controls, worker, and the
                         3D relief and long-section views
src/docs/                the documentation panes, generated from the loaded data
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
const at load time and a view loaded after it is simply undefined. The suite checks
this, since neither parsing nor a 200 from the server can.

**Cache keys move together.** `index.html` loads each page as `page.html?v=N`, and
`osp_sandbox.html` loads each script as `script.js?v=N`. Browsers refetch the document
and reuse the scripts behind it, so a key on the page alone is not enough. Bump every
`?v=` at once; the sanitiser refuses a page whose scripts disagree.

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
node tools/test_sandbox.js           # 38 regression checks against the shipped dataset
python3 tools/format_data.py --check # would the data file change if reformatted?
```

The tests are regression checks on one dataset, not unit tests of the algorithms.
Change the data and the expected figures must be re-established deliberately.
