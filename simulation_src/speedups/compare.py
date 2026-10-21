#!/usr/bin/env python3
"""
compare.py - a fast grid's summaries against the published grid's, case by case.

    python -m speedups.compare                      # the configured area's two folders
    python -m speedups.compare --fast DIR --published DIR

Per case present in both: how many growth rows give a different newly-alarm or
newly-surcharged set, the largest difference in any rise, how many rises cross the 10 and 25 mm
rules differently, and whether the greedy placement chose the same sensors. A fast grid run
with --no-hotstart --fixed-minutes 480 should show no differences: that checks the pipeline.
With the speed-ups on, design-wet cases should agree within a fraction of a millimetre and the
wet cases should not, because the published runs had not settled (README.md, "Settling").
"""
import argparse
import glob
import json
import os

import sim25


def _load(d):
    out = {}
    for p in glob.glob(os.path.join(d, "*", "summary.json")):
        with open(p, encoding="utf-8") as f:
            s = json.load(f)
        if "rows" in s and "tag" in s:
            out[s["tag"]] = s
    return out


def compare_case(a, b):
    ra = {(r["site"], r["dwellings"]): r for r in a["rows"]}
    rb = {(r["site"], r["dwellings"]): r for r in b["rows"]}
    keys = sorted(set(ra) & set(rb))
    diff = {"alarm": 0, "surcharge": 0}
    worst, rules = 0.0, {10: 0, 25: 0}
    for k in keys:
        for rule in diff:
            diff[rule] += set(ra[k][rule]) != set(rb[k][rule])
        x, y = ra[k]["rise_mm"], rb[k]["rise_mm"]
        for mh in set(x) | set(y):
            u, v = x.get(mh, 0.0), y.get(mh, 0.0)    # absent = under the 1 mm floor
            worst = max(worst, abs(u - v))
            for t in rules:
                rules[t] += (u >= t) != (v >= t)
    same = {rule: a["placement"][rule]["chosen"] == b["placement"][rule]["chosen"]
            for rule in ("alarm", "surcharge")}
    return len(keys), diff, worst, rules, same


def main():
    area = "grid_whole" if sim25.STUDY_AREA == "whole" else "grid"
    ap = argparse.ArgumentParser()
    ap.add_argument("--published", default=os.path.join(sim25.OUT_DIR, area))
    ap.add_argument("--fast", default=os.path.join(sim25.OUT_DIR, area + "_fast"))
    args = ap.parse_args()
    pub, fast = _load(args.published), _load(args.fast)
    both = [t for t in pub if t in fast]
    if not both:
        raise SystemExit(f"no case in both {args.published} and {args.fast}")
    for tag in sorted(both):
        n, diff, worst, rules, same = compare_case(pub[tag], fast[tag])
        st = fast[tag].get("settling") or {}
        print(f"{tag}: {n} rows; detection sets differ in {diff['alarm']} (alarm) and "
              f"{diff['surcharge']} (surcharge); largest rise difference {worst:.2f} mm; "
              f"rises crossing 10 mm differently {rules[10]}, 25 mm {rules[25]}; "
              f"placement same: alarm {same['alarm']}, surcharge {same['surcharge']}; "
              f"fast baseline settled at {st.get('baseline_minutes', '?')} min")


if __name__ == "__main__":
    main()
