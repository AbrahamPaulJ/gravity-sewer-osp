"""
distributed/shard.py - split the grid's growth runs into n disjoint shards.

Every growth run is independent once its case's baseline is known, so the runs can be dealt
out to n machines with nothing shared but the code and the input snapshot (data/raw and
config.js are in the repository). Each shard settles every case's baseline itself: a
baseline is deterministic, a few minutes each, and small next to a shard's share of runs.
merge.py checks the shards' baselines agree before combining them.

Runs are dealt round-robin over a fixed order (by case, then site, then size), so each shard
gets the same mix of wet and dry cases and finishes at about the same time.
"""
import os

SHARD_FILE = "shard_{i}_of_{n}.json"


def parse(spec):
    """'2/8' -> (2, 8). Shards are numbered 0 to n-1."""
    i, n = (int(x) for x in spec.split("/"))
    if not 0 <= i < n:
        raise ValueError(f"shard {spec}: need 0 <= i < n")
    return i, n


def select(tasks, i, n):
    """The tasks of shard i of n, from tasks already in their fixed order."""
    return tasks[i::n]


def path(out, tag, i, n):
    return os.path.join(out, "shards", tag, SHARD_FILE.format(i=i, n=n))
