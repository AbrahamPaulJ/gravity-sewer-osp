"""
distributed/merge.py - combine the shards of a fast grid into its summaries.

    python -m speedups.distributed.merge --out results/sim25/grid_whole_fast

Reads <out>/shards/<tag>/shard_<i>_of_<n>.json, checks that every shard of every case is there,
that their runs add up to the case's full count, and that every shard settled the same
baseline (each settled its own), then writes the same files fast_grid writes on one machine.
"""
import argparse
import glob
import json
import os
import re

import sim25
from sim25 import Case

from ..outputs import write_all

BASELINE_MATCH_M = 1e-6


def load(out):
    groups = {}
    for p in sorted(glob.glob(os.path.join(out, "shards", "*", "shard_*_of_*.json"))):
        i, n = (int(x) for x in re.search(r"shard_(\d+)_of_(\d+)\.json$", p).groups())
        with open(p, encoding="utf-8") as f:
            s = json.load(f)
        groups.setdefault(s["tag"], []).append((i, n, s))
    return groups


def _tuple_keys(runs):
    for r in runs:
        r["key"] = tuple(r["key"])
    return runs


def combine(tag, parts):
    ns = {n for _, n, _ in parts}
    if len(ns) != 1:
        raise SystemExit(f"{tag}: shards from different splits {sorted(ns)}; remove the stale ones")
    n = ns.pop()
    have = sorted(i for i, _, _ in parts)
    if have != list(range(n)):
        raise SystemExit(f"{tag}: have shards {have} of {n}; missing {sorted(set(range(n)) - set(have))}")
    first = parts[0][2]
    for i, _, s in parts[1:]:
        d = max(abs(a - b) for a, b in zip(s["baseline"]["depths"], first["baseline"]["depths"]))
        if d > BASELINE_MATCH_M or s["baseline"]["flags"] != first["baseline"]["flags"]:
            raise SystemExit(f"{tag}: shard {i}'s baseline differs from shard {parts[0][0]}'s "
                             f"by {d*1000:.4f} mm. Mixed platforms or versions? Re-run on one.")
    runs = _tuple_keys([r for _, _, s in parts for r in s["runs"]])
    if len(runs) != first["expected"]:
        raise SystemExit(f"{tag}: {len(runs)} runs across shards, expected {first['expected']}")
    return {"case": Case(**first["case"]), "kind": first["kind"], "method": first["method"],
            "baseline": first["baseline"], "outlet_head": first.get("outlet_head"),
            "corridor_nodes": first.get("corridor_nodes"), "runs": runs,
            "order": first["order"], "wall_s": max(s["wall_s"] for _, _, s in parts)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    groups = [combine(tag, parts) for tag, parts in load(args.out).items()]
    if not groups:
        raise SystemExit(f"no shards under {os.path.join(args.out, 'shards')}")
    grid = sorted((g for g in groups if g["kind"] == "grid"), key=lambda g: g["order"])
    corridor = [g for g in groups if g["kind"] == "corridor"]
    print(f"study area {sim25.STUDY_AREA}: merging {len(grid)} cases, {len(corridor)} corridor sets")
    write_all(args.out, grid, corridor, max(g["wall_s"] for g in groups))


if __name__ == "__main__":
    main()
