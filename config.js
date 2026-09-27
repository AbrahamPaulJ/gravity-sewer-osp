// Which pages the site offers. Hand-edited; nothing generates this file.
//
// Set one to false and that page disappears: its tab, its card on the overview, and
// its pane. The pane is removed rather than hidden, and the iframe inside it is never
// given a src, so the page is not fetched at all. A deep link to a hidden page
// (index.html#sim1) falls back to the overview, because showTab already returns false
// for a tab whose button is not there.
//
// A page left out of this file is shown, and if this file fails to load the site shows
// everything. That is the safe direction: a static site with no build step should
// degrade to more content, never to a blank page.
//
// Overview and Sandbox are not listed and cannot be hidden. The overview is the
// fallback every unknown route lands on, and the overview's prose links into the
// sandbox mid-sentence, so removing it would leave broken sentences behind.
window.OSP_PAGES = {
  anatomy: true,        // What a maintenance hole is
  observability: true,  // Why observability is limited
  sim1: false,           // Simulation 1, warning time
  sim2: false,           // Simulation 2, growth (superseded by 2.5)
  sim25: true,          // Simulation 2.5, growth and sensor placement
};
