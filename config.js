// config.js - every setting the project is run with, in one place.
//
// Read by the browser (this file is a script that sets window.OSP_CONFIG), by Node, and by the Python
// simulation and page builder (simulation_src/osp_config.py takes the JSON object below).
// So everything between the first "{" and the last "}" must stay plain JSON: double quotes,
// no comments, no trailing commas. Explanations live in "_note" fields instead.
//
// WHAT A CHANGE TAKES EFFECT ON
//   pages                 the landing page, on reload.
//   pipes.blockage_*      the sandbox, on reload.
//   pipes.manning_*       the sandbox on reload; Simulation 2.5 after a re-run and republish.
//   everything else       Simulation 2.5, after re-running the grid and republishing:
//                           ~/.venvs/sewer/bin/python simulation_src/sim25_grid.py --cases all --resume
//                           ~/.venvs/sewer/bin/python tools/build_sim25_web.py --publish
//                         Settings marked "_republish_only" need only the second command.
//
// Register IDs (P01, G6, ...) refer to the assumptions register on the Simulation 2.5 page.
(typeof window !== "undefined" ? window : globalThis).OSP_CONFIG = {
  "pages": {
    "_note": "Which pages the site offers. false removes that page's tab, overview card and pane; a deep link to it falls back to the overview. Overview and Sandbox cannot be hidden: the overview is the fallback, and its prose links to the sandbox mid-sentence.",
    "anatomy": true,
    "observability": true,
    "sim1": false,
    "sim2": false,
    "sim25": true
  },

  "pipes": {
    "manning_n_by_material": {
      "_note": "Roughness by the published MATERIAL code (H3). Conventional design values from Chow (1959) Table 5-6, the table the SWMM reference reproduces. Used by SWMM in Simulation 2.5, by the sandbox's capacity model, and by the Simulation 2.5 page's growth estimate.",
      "VC": 0.013,
      "PVCU": 0.010,
      "RC": 0.013
    },
    "manning_n_fallback": 0.013,
    "min_slope": 0.0001,
    "infiltration_weight_by_age": {
      "_note": "P26 / L5: in the age-weighted I&I case, a pipe's infiltration is multiplied by the weight of the first band whose upper construction year it falls under, then all weights are rescaled so total I&I is unchanged. Older pipes leak more. [upper year, weight].",
      "bands": [[1929, 1.5], [1959, 1.2], [1989, 0.8], [9999, 0.5]]
    },
    "blockage_likelihood": {
      "_note": "The sandbox's blockage-likelihood score (src/model/osp_risk.js, where each value's argument and full references are set out). Weights from the mutual-information ranking of [Ma25] (age 0.124 first, diameter second) and the factor review of [MM20]; [DP22] and [Al23] on small pipes. Not used by Simulation 2.5.",
      "weights": { "age": 0.30, "diameter": 0.25, "gradient": 0.20, "material": 0.15, "joint": 0.05, "length": 0.05 },
      "material_risk": { "VC": 1.0, "RC": 0.7, "PVCU": 0.3 },
      "joint_risk": { "BIT": 1.0, "SCJ": 0.8, "PLAST": 0.4, "RRJ": 0.3 },
      "grade_ref_pct": 1.0,
      "length_ref_m": 100,
      "unknown_score": 0.5
    }
  },

  "loads": {
    "_note": "How connected properties and new dwellings become flow in Simulation 2.5.",
    "people_per_connection": 2.81,
    "people_per_new_dwelling": 2.3,
    "litres_per_person_day": 200.0,
    "peak_factor": 2.0,
    "trough_factor": 0.2,
    "_sources": "P01 2.81 = 8,023 people / 2,851 connections (ABS 2021); G4 2.3 = ABS 2021 household size; P01b 200 L/person/day (Barwon Water, WSAA supplement s3.2.2); P02 peak 2.0; R9 trough 0.2, the midpoint of 0.10-0.30 x ADF (UW CEE 481)."
  },

  "simulation": {
    "_note": "Simulation 2.5: where growth is tested, how much, and what counts as a sensor seeing it.",
    "study_area": "whole",
    "_study_area": "segment: the 71 manholes draining to segment_outlet_node, results in results/sim25/grid. whole: all 328 published manholes in the model domain, results in results/sim25/grid_whole.",
    "segment_outlet_node": 583,
    "growth_dwellings": [10, 30, 80, 150],
    "stress_dwellings": 700,
    "corridor_dwellings": [80, 150, 390, 485],
    "_dwellings": "P05: growth sizes added at one manhole, and the stress case; corridor sizes, of which 390 and 485 are the PlanSA 2021-41 medium and high projections.",
    "alarm_depth_mm": 150,
    "_alarm_depth_mm": "G6: the operator's low alarm, depth above the pipe floor. Stored with every SWMM run, so changing it needs a re-run.",
    "detection_rises_mm": [10, 25, 50],
    "_republish_only": "detection_rises_mm and max_sensors are applied to the stored runs by the builder.",
    "max_sensors": 10,
    "scenario_default_dwellings": 50,

    "case_set": "five",
    "_case_set": "Which of case_sets below is run and published. Each case is one combination of what cannot be measured yet, and costs 1,641 whole-domain SWMM runs (about 87 min on 9 workers) in the whole area.",
    "case_sets": {
      "five": {
        "weather": [
          { "ii": 0.0, "label": "Dry", "note": "Sewage only, no infiltration: a genuinely dry day." },
          { "ii": 0.11, "label": "Design wet", "note": "Infiltration at the level that just meets the utility's own design rating for these pipes." },
          { "ii": 0.4, "label": "Severe", "note": "2.4 times the design envelope: a heavy wet period." }
        ],
        "sensitivity": {
          "at_ii": [0.11],
          "variants": [
            { "label": "age-weighted I&I", "set": { "age": "weighted" } },
            { "label": "outside inflow x1.5", "set": { "bfac": 1.5 } }
          ]
        }
      },
      "all_twelve": {
        "weather": [
          { "ii": 0.0, "label": "Dry", "note": "Sewage only, no infiltration: a genuinely dry day." },
          { "ii": 0.11, "label": "Design wet", "note": "Infiltration at the level that just meets the utility's own design rating for these pipes." },
          { "ii": 0.25, "label": "Beyond design", "note": "1.7 times the design envelope: an old network on a wet day." },
          { "ii": 0.4, "label": "Severe", "note": "2.4 times the design envelope: a heavy wet period." }
        ],
        "sensitivity": {
          "at_ii": [0.11, 0.25],
          "variants": [
            { "label": "Harmon peaking", "set": { "pf": "harmon" } },
            { "label": "age-weighted I&I", "set": { "age": "weighted" } },
            { "label": "outside inflow x0.5", "set": { "bfac": 0.5 } },
            { "label": "outside inflow x1.5", "set": { "bfac": 1.5 } }
          ]
        }
      }
    },
    "_case_sets": "weather: the nominal sweep, one case each; ii is P04, infiltration in L/s per 100 m of pipe. sensitivity: at_ii names the weather levels that get the variants; each variant overrides fields of a case (pf flat|harmon, age uniform|weighted, bfac, stage, hour) and adds its label."
  }
};
