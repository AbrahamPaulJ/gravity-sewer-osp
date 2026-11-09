#!/usr/bin/env python3
"""
test_greenfield_sites.py - checks sim25_grid.greenfield_sites, the rule for where a greenfield
estate can join the network (a candidate manhole whose outgoing pipe, a trunk main, is 225 mm or
more; a team assumption, not an SA Water standard).

Plain asserts, no pytest:   python3 simulation_src/test_greenfield_sites.py

The rule never runs SWMM. sim25_grid still imports pyswmm through model.py, so where pyswmm is
not installed an empty stand-in is used for the import and nothing here simulates.
"""
import os
import sys
import time
import types
from collections import Counter
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import pyswmm  # noqa: F401
except ImportError:
    stub = types.ModuleType("pyswmm")
    stub.Simulation = stub.Nodes = stub.Links = None
    stub.__version__ = "stub"
    sys.modules["pyswmm"] = stub

from sim25_grid import GF_MIN_DIA_M, _greenfield_kinds, greenfield_sites  # noqa: E402


def make_net(pipes, n_nodes):
    """A stand-in for network.Network: pipes are (up, down, dia in metres); node i has manhole
    id 1000 + i, so a node id and a manhole id can never be mistaken for each other."""
    return SimpleNamespace(
        nodes=[SimpleNamespace(manhole_id=1000 + i) for i in range(n_nodes)],
        pipes=[SimpleNamespace(up=u, down=d, dia=dia) for u, d, dia in pipes])


#   0 -150-> 2 -150-> 4 -300-> 5 -150-> 6 -150-> 8
#   1 -100-> 3 -225-> 4         5 -300-> 7 -300-> 8
# 0 and 1 are heads of lines; 8 is the outlet (nothing leaves it).
NET = make_net([(0, 2, 0.150), (1, 3, 0.100), (2, 4, 0.150), (3, 4, 0.225), (4, 5, 0.300),
                (5, 6, 0.150), (5, 7, 0.300), (6, 8, 0.150), (7, 8, 0.300)], 9)


def test_threshold_is_225_mm():
    assert GF_MIN_DIA_M == 0.225


def test_head_of_a_line_on_a_small_pipe_is_not_eligible():
    assert greenfield_sites(NET, [0]) == []          # head of a line, 150 mm
    assert greenfield_sites(NET, [1]) == []          # head of a line, 100 mm


def test_head_of_a_line_on_a_trunk_is_eligible():
    net = make_net([(0, 1, 0.300), (1, 2, 0.300)], 3)
    assert greenfield_sites(net, [0]) == [1000]


def test_interior_node_on_150_mm_is_not_eligible():
    assert greenfield_sites(NET, [2]) == []
    assert greenfield_sites(NET, [6]) == []


def test_interior_node_on_225_mm_is_eligible():
    assert greenfield_sites(NET, [3]) == [1003]      # exactly 225 mm counts
    assert greenfield_sites(NET, [4]) == [1004]      # 300 mm


def test_just_under_225_mm_is_not_eligible():
    # 10 PVC-U pipes in the real network have a 224 mm internal diameter.
    net = make_net([(0, 1, 0.150), (1, 2, 0.224), (2, 3, 0.150)], 4)
    assert greenfield_sites(net, [1]) == []


def test_widest_outgoing_pipe_counts():
    assert greenfield_sites(NET, [5]) == [1005]      # leaves on 150 mm and 300 mm


def test_outlet_with_no_outgoing_pipe_is_not_eligible():
    assert greenfield_sites(NET, [8]) == []


def test_order_of_the_candidates_is_kept():
    assert greenfield_sites(NET, [4, 0, 2, 3, 1, 5, 6, 7, 8]) == [1004, 1003, 1005, 1007]
    assert greenfield_sites(NET, [7, 5, 1, 0, 4, 3]) == [1007, 1005, 1004, 1003]


def test_only_the_candidates_are_returned():
    assert greenfield_sites(NET, [2, 3]) == [1003]   # eligible nodes 4, 5, 7 are not asked about
    assert greenfield_sites(NET, []) == []


def test_kinds_say_why():
    assert _greenfield_kinds(NET, list(range(9))) == [
        None, None, None, "trunk", "trunk", "trunk", None, "trunk", None]


def real_network_counts():
    """Print how many of the real candidate manholes the rule keeps (no SWMM run)."""
    try:
        import sim25
        t0 = time.time()
        probe = sim25.Sim25Model(sim25.Case(), whole=True, outlet_head=None)
        nodes = [probe.chambers[c] for c in probe.candidates]
    except Exception as e:  # noqa: BLE001 - the network files are not on every machine
        print(f"real network not loaded, skipped ({type(e).__name__}: {e})")
        return
    kinds = Counter(_greenfield_kinds(probe.net, nodes))
    ids = greenfield_sites(probe.net, nodes)
    manholes = [probe.net.nodes[n].manhole_id for n in nodes]
    assert len(ids) == kinds["trunk"]
    assert 0 < len(ids) < len(nodes)
    assert ids == [m for m in manholes if m in set(ids)]   # same order as the candidates
    print(f"real network ({time.time() - t0:.1f} s): {len(ids)} of {len(nodes)} candidate manholes "
          f"on a trunk main of {GF_MIN_DIA_M * 1000:.0f} mm or more, {kinds[None]} not eligible")


if __name__ == "__main__":
    tests = [(k, v) for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for name, fn in tests:
        fn()
        print("ok", name)
    print(f"{len(tests)} tests passed")
    real_network_counts()
