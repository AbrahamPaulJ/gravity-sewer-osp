#!/usr/bin/env python3
"""
sim25_graded.py - placement on a GRADED response, from the Sim 2.5 grid's depth rises.

Why this exists (docs/17_sim25_results.md s1): with a yes/no threshold on absolute depth, one
"marginal" manhole, just under its threshold at baseline, detects nearly every scenario, and
which manhole that is moves with every unknown. Here a sensor sees a scenario when the depth
at its manhole RISES by at least R mm over that manhole's own baseline, so the answer no
longer hinges on who happens to sit at the edge.

R is swept (register G6): 10, 25, 50 mm. 50 mm is about the width of the normal daily range
the network operator's own deployment reported, levels "typically range from 20 to 75 mm" (Do et al.
2023); the steady-state model has no daily variation, so a rise smaller than that could hide
in a real day's noise.

Reported per case and R: the best 1, 2, 3 sensors by greedy maximum coverage, and ONE
consensus set chosen over all cases together, with the coverage it keeps in each case.

Usage:
    python sim25_graded.py            # reads results/sim25/grid/*/summary.json
"""
import glob, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
GRID = os.path.join(HERE, "results", "sim25", "grid")
RISE_MM = (10, 25, 50)
K = (1, 2, 3)


def load():
    out = []
    for f in sorted(glob.glob(os.path.join(GRID, "ii*", "summary.json"))):
        with open(f, encoding="utf-8") as fh:
            s = json.load(fh)
        if s["rows"] and "rise_mm" not in s["rows"][0]:
            raise SystemExit(f"{f} has no depth rises: re-run sim25_grid.py")
        out.append(s)
    return out


def scenarios(s, r):
    """Each growth scenario -> set of manholes whose depth rises >= r mm."""
    return [{mh for mh, v in row["rise_mm"].items() if v >= r} for row in s["rows"]]


def greedy(sets, k):
    chosen, covered = [], set()
    for _ in range(k):
        gain = {}
        for i, st in enumerate(sets):
            if i in covered:
                continue
            for mh in st:
                gain[mh] = gain.get(mh, 0) + 1
        if not gain:
            break
        best = max(sorted(gain), key=lambda m: gain[m])
        chosen.append(best)
        covered |= {i for i, st in enumerate(sets) if best in st}
    return chosen, len(covered)


def main():
    cases = load()
    report = {"rise_mm": RISE_MM, "cases": [c["tag"] for c in cases], "by_r": {}}
    for r in RISE_MM:
        per = []
        all_sets = []
        for c in cases:
            sets = scenarios(c, r)
            detectable = sum(1 for st in sets if st)
            row = {"case": c["tag"], "detectable": detectable, "of": len(sets)}
            for k in K:
                ch, cov = greedy(sets, k)
                row[f"k{k}"] = {"chosen": ch, "covered": cov}
            per.append(row)
            all_sets.append(sets)
        # Consensus: greedy over every case's scenarios together, each case weighted equally
        # by giving each of its scenarios weight 1 / (that case's detectable count).
        consensus = {}
        for k in K:
            chosen, keep = [], []
            remaining = [set(range(len(s))) for s in all_sets]
            for _ in range(k):
                gain = {}
                for ci, sets in enumerate(all_sets):
                    det = sum(1 for st in sets if st) or 1
                    for i in remaining[ci]:
                        for mh in sets[i]:
                            gain[mh] = gain.get(mh, 0.0) + 1.0 / det
                if not gain:
                    break
                best = max(sorted(gain), key=lambda m: gain[m])
                chosen.append(best)
                for ci, sets in enumerate(all_sets):
                    remaining[ci] -= {i for i in remaining[ci] if best in sets[i]}
            for ci, sets in enumerate(all_sets):
                cov = sum(1 for st in sets if set(chosen) & st)
                best_k = per[ci][f"k{k}"]["covered"]
                keep.append({"case": per[ci]["case"], "covered": cov, "case_best": best_k})
            consensus[f"k{k}"] = {"chosen": chosen, "per_case": keep}
        freq = {}
        for row in per:
            for mh in row["k1"]["chosen"]:
                freq[mh] = freq.get(mh, 0) + 1
        report["by_r"][str(r)] = {"per_case": per, "consensus": consensus,
                                  "k1_frequency": dict(sorted(freq.items(), key=lambda kv: -kv[1]))}

        print(f"\n=== detection = rise >= {r} mm ===")
        for row in per:
            print(f"  {row['case']:32s} detectable {row['detectable']:3d}/{row['of']}"
                  f" | best 1 MH{row['k1']['chosen'][:1]} covers {row['k1']['covered']}"
                  f" | best 3 {row['k3']['chosen']} covers {row['k3']['covered']}")
        print(f"  single-sensor choice frequency: {report['by_r'][str(r)]['k1_frequency']}")
        for k in K:
            c = consensus[f"k{k}"]
            ratios = [p["covered"] / p["case_best"] for p in c["per_case"] if p["case_best"]]
            print(f"  consensus {k} sensor(s) {c['chosen']}: keeps "
                  f"{min(ratios):.0%} to {max(ratios):.0%} of each case's own best "
                  f"(mean {sum(ratios)/len(ratios):.0%})" if ratios else f"  consensus {k}: none")
    with open(os.path.join(GRID, "graded.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, indent=1)


if __name__ == "__main__":
    main()
