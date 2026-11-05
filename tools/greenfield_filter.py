#!/usr/bin/env python3
"""
greenfield_filter.py - keep only the greenfield growth sites a new estate could join
(sim25_grid.greenfield_sites: a network-edge manhole or one on a main of 225 mm or more) in
simulation3/data/growth.js, and re-score the greenfield sensor placement on those runs.

The SWMM results are not re-run: the grid already holds a run at every manhole, so the
eligible runs are a subset of it. The greedy placement and the single-sensor heatmap are
recomputed with build_sim25_web.placement, the same code that produced them.

    python3 tools/greenfield_filter.py           # check, filter, write
    python3 tools/greenfield_filter.py --check   # only check that the old numbers reproduce

Running it twice is safe: a file that already carries eligibleSites is re-filtered from the
rows it still has, which gives the same result.
"""
import argparse, io, json, os, sys, types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "simulation_src"))
sys.path.insert(0, os.path.join(ROOT, "tools"))
try:
    import pyswmm  # noqa: F401
except ImportError:                      # the rule and the scoring never run SWMM
    stub = types.ModuleType("pyswmm")
    stub.Simulation = stub.Nodes = stub.Links = None
    stub.__version__ = "stub"
    sys.modules["pyswmm"] = stub

GROWTH = os.path.join(ROOT, "simulation3", "data", "growth.js")


def load(path):
    text = io.open(path, encoding="utf-8").read()
    start, end = text.index("{"), text.rstrip().rstrip(";").rindex("}") + 1
    return text[:start], json.loads(text[start:end]), text[end:]


def score(runs, keep=None):
    """Heat and nested sensor sets per rule, pooled per weather case as the build does."""
    from build_sim25_web import placement
    n, heat, sensors = len(runs["chambers"]), {}, {}
    for rule in [r["id"] for r in runs["rules"]]:
        pooled = {c["id"]: [] for c in runs["cases"]}
        for cell in runs["cells"]:
            if cell["rule"] == rule:
                pooled[cell["case"]].extend(r["tip"] for r in cell["rows"]
                                            if keep is None or r["site"] in keep)
        heat[rule], sensors[rule] = placement([pooled[c["id"]] for c in runs["cases"]], n,
                                              runs["maxSensors"])
    return heat, sensors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    head, runs, tail = load(GROWTH)

    if "eligibleSites" not in runs:
        heat, sensors = score(runs)
        if heat != runs["heat"] or sensors != runs["sensors"]:
            sys.exit("the published heat/sensors do not reproduce from the rows; not filtering")
        print("published placement reproduces from the rows: ok")
    if args.check:
        return

    import sim25
    from sim25_grid import _greenfield_kinds, greenfield_sites
    probe = sim25.Sim25Model(sim25.Case(), whole=True, outlet_head=None)
    nodes = [probe.chambers[c] for c in probe.candidates]
    ok_ids = set(greenfield_sites(probe.net, nodes))
    kind_of = {probe.net.nodes[n].manhole_id: k for n, k in zip(nodes, _greenfield_kinds(probe.net, nodes))}
    keep = sorted(i for i, m in enumerate(runs["manholeIds"]) if m in ok_ids)
    if not keep:
        sys.exit("no eligible site matched the page's manholes")

    for cell in runs["cells"]:
        cell["rows"] = [r for r in cell["rows"] if r["site"] in keep]
    for per_case in runs["spill"]:
        for add in per_case:
            per_case[add] = [x for x in per_case[add] if x[0] in keep]
    runs["heat"], runs["sensors"] = score(runs, set(keep))
    runs["eligibleSites"] = keep
    runs["eligibleKind"] = [kind_of[runs["manholeIds"][i]] for i in keep]
    runs["eligibleRule"] = {"minDiaMm": 225, "note": "A greenfield estate joins at a network-edge "
                            "manhole or on a main of 225 mm or more. A team assumption, not an "
                            "SA Water standard."}

    body = json.dumps(runs, separators=(",", ":"))
    io.open(GROWTH, "w", encoding="utf-8", newline="\n").write(head + body + tail)
    edge = runs["eligibleKind"].count("edge")
    print(f"kept {len(keep)} of {len(runs['chambers'])} greenfield sites ({edge} edge, "
          f"{len(keep) - edge} on 225 mm+ mains); heat and sensors re-scored -> {GROWTH}")


if __name__ == "__main__":
    main()
