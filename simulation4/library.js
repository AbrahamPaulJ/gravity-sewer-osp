/* The sources Sim 4 cites that are in the team's paper library (https://siddhu-123.github.io/waste_water_network_sensor-papers/),
   each opened in the library's PDF viewer, where the team's notes sit beside it. Ids, PDF paths and titles are the
   library's own (its js/bundled-data.js, read 19 Nov 2026); "page" opens the viewer at the cited passage, checked in the PDF.
   A citation not listed here has no copy in the library and stays plain text: PlanSA's population projections,
   ABS 2021, Barwon Water's supplement, Krause et al. (2008), Stephens (2007) and the council's map layers. The sewer
   supplement's Table 4.4 is in the library too (checked: page 9), but its file name and title there carry the utility's
   name, which these pages leave out, so it is not linked.

   The story (sim4_story.js) and Explore (explore_ui.js) call SIM4_LIBRARY.link() on text they have already escaped;
   tools/build_sim4_web.py reads the same list to link the redo guide. Keep the object strict JSON: the builder parses it. */
window.SIM4_LIBRARY = {
  "viewer": "https://siddhu-123.github.io/waste_water_network_sensor-papers/pdf-viewer.html",
  "papers": [
    {"key": "do2023", "paper": "31", "pdf": "./contributors/abraham/papers/2023_Do_Stonyfell-SA-overflow-detection.pdf",
     "title": "Proactive Detection of Wastewater Overflows for Smart Sanitary Sewer Systems: Case Study in South Australia",
     "match": ["Do, N\\. C\\., Dix, L\\., Lambert, M\\. F\\. and Stephens, M\\. L\\. \\(2023\\)", "Do et al\\. \\(2023\\)", "Do et al\\. 2023"]},
    {"key": "kim2022", "paper": "58", "pdf": "./contributors/wimukthi/papers/Keugtae_2022_Optimal-Allocation-and-Operation-of-Sewer-Monitoring-Sites.pdf",
     "title": "Optimal allocation and operation of sewer monitoring sites for wastewater-based disease surveillance: A methodological proposal",
     "match": ["Kim, K\\., Ban, M\\. J\\., Kim, S\\., Park, M\\.-H\\., Stenstrom, M\\. K\\. and Kang, J\\.-H\\. \\(2022\\)", "Kim et al\\. \\(2022\\)", "Kim et al\\. 2022"]},
    {"key": "swmm", "paper": "SATYA-GL-01", "pdf": "./contributors/satya-siddhartha/grey/GL_2017_USEPA_SWMM_Reference_Manual_Vol2_Hydraulics.pdf",
     "title": "US EPA Storm Water Management Model (SWMM) 5.2 Reference Manual Volume II: Hydraulics",
     "match": ["Storm Water Management Model \\(EPA SWMM\\), version 5", "EPA SWMM 5"]},
    {"key": "kimbrough2019", "paper": "ASHIS-GL-17", "page": 87, "pdf": "./contributors/ashis-jose/grey/ASHIS-GL-17_Kimbrough_2019_Sewer_Capacity_Risk_Sensor_Placement_Dissertation.pdf",
     "title": "Optimal Sensor Placement for Sewer Capacity Risk Management (PhD dissertation)",
     "match": ["Kimbrough, H\\. R\\. \\(2019\\)", "Kimbrough \\(2019\\)", "Kimbrough 2019"]},
    {"key": "landsupply", "paper": "ASHIS-GL-06", "pdf": "./contributors/ashis-jose/grey/ASHIS-GL-06_PlanSA_Residential_Land_Supply_Report.pdf",
     "title": "Land Supply Report for Greater Adelaide: Residential (July 2023)",
     "match": ["Land Supply Report"]},
    {"key": "crowley2025", "paper": "24", "pdf": "./contributors/rijoy-john/papers/Crowley_2025_Information_theoretic_sewer_OSP.pdf",
     "title": "Information-theoretic sensor placement for large sewer networks",
     "match": ["Crowley, G\\. et al\\. \\(2025\\)", "Crowley et al\\. \\(2025\\)"]},
    {"key": "ding2025", "paper": "53", "pdf": "./contributors/rijoy-john/papers/2025_Zihang Ding_Manuscript-Optimizing Sensor Placement for Flow Reconstruction in Urban Drainage Networks A.pdf",
     "title": "Optimizing Sensor Placement for Flow Reconstruction in Urban Drainage Networks: A Digital-Twin Sparse Sensing Approach",
     "match": ["Ding, Z\\. et al\\. \\(2025\\)", "Ding et al\\. \\(2025\\)"]},
    {"key": "wani2015", "paper": "57", "pdf": "./contributors/wimukthi/papers/Omar_2015_Parameter-Estimation-of-Urban-Drainage-Models-Using-Binary-Observations.pdf",
     "title": "Parameter estimation of urban drainage models using binary observations from low-cost sensors",
     "match": ["Wani, O\\., Blumensaat, F\\., Scheidegger, A\\., Doppler, T\\. and Rieckermann, J\\. \\(2015\\)", "Wani et al\\. \\(2015\\)"]}
  ]
};
(function (L) {
  const url = p => L.viewer + "?paper=" + encodeURIComponent(p.paper) + "&pdf=" + encodeURIComponent(p.pdf) + "&title=" + encodeURIComponent(p.title) + (p.page ? "&page=" + p.page : "");
  const all = [];
  L.papers.forEach(p => p.match.forEach(m => all.push([m, p])));
  all.sort((a, b) => b[0].length - a[0].length);          // the full reference before its short form
  const re = new RegExp(all.map(([m]) => "(" + m + ")").join("|"), "g");
  L.url = url;
  // Wrap each citation in already-escaped text in a link to its library copy. Never call it on markup with attributes.
  L.link = html => String(html).replace(re, (hit, ...groups) => {
    const k = groups.findIndex((g, i) => i < all.length && g !== undefined);
    const p = all[k][1];
    return '<a class="lib" href="' + url(p).replace(/&/g, "&amp;") + '" target="_blank" rel="noopener" title="Open it in the team\'s paper library">' + hit + "</a>";
  });
})(window.SIM4_LIBRARY);
