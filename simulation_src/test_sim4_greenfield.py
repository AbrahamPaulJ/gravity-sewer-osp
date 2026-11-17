#!/usr/bin/env python3
"""Run with ../.venv/bin/python test_sim4_greenfield.py from simulation_src."""
import math
import sys
from types import SimpleNamespace

sys.dont_write_bytecode = True
import sim4_greenfield as greenfield
import sim4_greenfield_eval as evaluation


def network(rows):
    """Rows: upstream node, downstream node, diameter metres, local properties."""
    pipes = [SimpleNamespace(id=i, asset_id=100 + i, up=u, down=d, dia=dia, dwellings=n)
             for i, (u, d, dia, n) in enumerate(rows)]
    nodes = {nid: SimpleNamespace(id=nid, manhole_id=1000 + nid)
             for p in pipes for nid in (p.up, p.down)}
    return SimpleNamespace(pipes=pipes, nodes=nodes)


TREE = [(0, 2, .150, 10), (1, 2, .225, 20), (2, 3, .150, 30), (3, 4, .300, 40)]


def test_pure_import():
    assert "pyswmm" not in sys.modules, "Pure functions must import without pyswmm"


def test_pipe_limit():
    for d, expected in ((.150, 400), (.225, 1000), (.300, 1800),
                        (.155, 400), (.220, 1000)):
        assert greenfield.pipe_limit(d) == expected, d
    for d in (None, 0, -.1, math.nan, math.inf, .305, .375, .450, .900):
        assert greenfield.pipe_limit(d) is None, d
    for d, anchor, limit in ((.100, .150, 400), (.145, .150, 400), (.216, .225, 1000)):
        assert math.isclose(greenfield.pipe_limit(d), limit * (d / anchor) ** (8 / 3))
    assert greenfield.pipe_limit(.150, {"150": 450, "225": 1100, "300": 1900}) == 450


def test_steps():
    for h, expected in ((76, [10, 30, 76]), (200, [10, 30, 80, 150, 200]),
                        (10, [10]), (12, [10, 12])):
        assert greenfield.steps_for(h, [10, 30, 80, 150, 300, 600, 1000], 4) == expected
    assert greenfield.steps_for(200.9, [150, 10, 30, 30, 80, 200], 4) == [10, 30, 80, 150, 200]
    assert greenfield.steps_for(80, [10, 30, 80], 1) == [10, 30, 80]
    assert greenfield.steps_for(9, [10, 30], 4) == [9]
    assert greenfield.steps_for(None, [10, 30, 80]) == [10, 30, 80]
    ladder = [10, 30, 80, 150, 300, 600, 1000]
    assert greenfield.steps_for(1562.9, ladder) == ladder
    assert greenfield.steps_for(80.9, ladder) == [10, 30, 80]
    assert greenfield.steps_for(None, ladder) == ladder


def test_tree_headroom():
    net = network(TREE)
    hr = greenfield.headroom(net, range(4))
    assert [hr["pipes"][i]["existing_properties"] for i in range(4)] == [10, 20, 60, 100]
    assert [hr["pipes"][i]["headroom"] for i in range(4)] == [390, 980, 340, 1700]
    for nid in (0, 1, 2):
        assert hr["nodes"][nid]["headroom"] == 340
        assert hr["nodes"][nid]["limiting_pipe_id"] == 2
    assert hr["nodes"][3]["headroom"] == 1700
    assert hr["nodes"][4]["headroom"] is None


def test_relief_loop():
    net = network(TREE + [(3, 2, .225, 5)])
    hr = greenfield.headroom(net, range(5))
    # The 2->3->2 relief loop adds five properties once, including in its own count.
    assert [hr["pipes"][i]["existing_properties"] for i in range(5)] == [10, 20, 65, 105, 65]
    for nid in (0, 1, 2, 3):
        assert hr["nodes"][nid]["headroom"] == 335
        assert hr["nodes"][nid]["limiting_pipe_id"] == 2


def test_split_and_rejoin():
    net = network([(0, 1, .300, 10), (1, 2, .225, 20), (1, 3, .150, 30),
                   (2, 4, .300, 40), (3, 4, .300, 50), (4, 5, .300, 60)])
    hr = greenfield.headroom(net, range(6))
    assert hr["pipes"][5]["existing_properties"] == 210
    assert hr["pipes"][2]["existing_properties"] == 40
    assert hr["nodes"][0]["headroom"] == 360
    assert hr["nodes"][0]["limiting_pipe_id"] == 2
    assert hr["nodes"][2]["headroom"] == 1590


def test_boundary_headroom():
    net = network(TREE)
    base = greenfield.headroom(net, range(4))
    hr = greenfield.headroom(net, range(4), node_properties={2: 12.5})
    assert hr["pipes"][0] == base["pipes"][0]
    assert hr["pipes"][1] == base["pipes"][1]
    assert hr["pipes"][2]["existing_properties"] == 72.5
    assert hr["pipes"][3]["existing_properties"] == 112.5
    assert hr["nodes"][0]["headroom"] == 327.5
    result = greenfield.eligible_sites(net, range(4), {1000: 0, 1002: 2}, headrooms=hr, edge={nid: (180., 270.) for nid in net.nodes})
    assert result["eligible"][0]["headroom"] == 327.5
    assert result["excluded"][0]["reason"] == "receives pumped or outside flow"


def test_boundary_conversion():
    net = network(TREE)
    loads = {"people_per_connection": 2.81, "litres_per_person_day": 200,
             "peak_factor": 2}
    model = SimpleNamespace(net=net, sew=loads["peak_factor"],
                            case=SimpleNamespace(ii=.11, bfac=1),
                            entries=[{"id": 42, "kind": "statewide", "node": 2,
                                      "connections": 12.5, "length_m": 100}])
    rows, properties = greenfield.boundary_properties(model, loads)
    assert properties == {2: 12.5}
    assert rows[0]["equivalent_properties"] == 12.5
    assert rows[0]["manhole"] == 1002
    sewage = 12.5 * 2.81 * 200 / 86400 * 2
    assert math.isclose(rows[0]["flow_lps"], sewage + .11)
    assert rows[0]["method"].startswith("Sim25 connections:")
    model.sew = .5  # The same property estimate, using a different hourly flow basis.
    trough, _ = greenfield.boundary_properties(model, loads)
    assert math.isclose(trough[0]["flow_lps"], sewage / 4 + .11)


def test_pump_transfer():
    # Wet-well branch 0->1 pumps into 2; node 2 has no gravity inlet.
    net = network([(0, 1, .300, 50), (2, 3, .150, 20), (3, 4, .300, 30)])
    hr = greenfield.headroom(net, range(3), node_properties={1: 5}, pump_transfers=[(1, 2)])
    assert hr["pipes"][0]["existing_properties"] == 50
    assert hr["pipes"][1]["existing_properties"] == 75
    assert hr["pipes"][2]["existing_properties"] == 105
    assert hr["nodes"][0]["headroom"] == 325  # Discharge pipe also limits wet-well sites.
    result = greenfield.eligible_sites(net, range(3), {1000: 0, 1002: 2}, headrooms=hr, edge={nid: (180., 270.) for nid in net.nodes})
    assert result["eligible"][0]["manhole_id"] == 1000
    assert result["excluded"][0]["in_degree"] == 0
    assert result["excluded"][0]["reason"] == "receives pumped or outside flow"
    # Relief back to the wet well: shared pipe and boundary sources count only once.
    net = network([(0, 1, .300, 50), (2, 3, .150, 20), (3, 4, .300, 30),
                   (2, 1, .225, 7)])
    hr = greenfield.headroom(net, range(4), node_properties={2: 5}, pump_transfers=[(1, 2)])
    assert hr["pipes"][1]["existing_properties"] == 82
    assert hr["pipes"][2]["existing_properties"] == 112
    assert hr["pipes"][3]["existing_properties"] == 62


def test_multiple_outlets_and_unknown():
    net = network([(0, 1, .300, 10), (1, 2, .150, 20), (1, 3, .225, 30)])
    hr = greenfield.headroom(net, range(3))
    assert hr["nodes"][0]["headroom"] == 370
    for diameter in (0, None):
        net.pipes[2].dia = diameter
        hr = greenfield.headroom(net, range(3))
        assert hr["nodes"][0]["headroom"] is None
        assert hr["nodes"][0]["unknown_diameter_pipes"] == [2]
        result = greenfield.eligible_sites(net, range(3), {1000: 0}, headrooms=hr, edge={nid: (180., 270.) for nid in net.nodes})
        assert result["excluded_counts"]["unknown diameter"] == 1


def test_trunk_has_no_property_limit():
    # A heavily loaded trunk must not veto available reticulation headroom.
    net = network([(0, 1, .150, 10), (2, 1, .375, 9000), (1, 3, .450, 2000)])
    hr = greenfield.headroom(net, range(3))
    assert hr["nodes"][0]["headroom"] == 390
    assert hr["nodes"][0]["limiting_pipe_id"] == 0
    assert hr["pipes"][2]["existing_properties"] == 11010
    assert hr["pipes"][2]["limit"] is None
    assert hr["nodes"][2]["unlimited"]
    assert hr["nodes"][2]["unknown_diameter_pipes"] == []
    sites = greenfield.eligible_sites(net, range(3), {1000: 0, 1002: 2}, headrooms=hr, edge={nid: (180., 270.) for nid in net.nodes})
    assert len(sites["eligible"]) == 2
    # Any reticulation pipe on either relief route still constrains the site.
    net = network([(0, 1, .375, 10), (1, 2, .150, 20), (1, 3, .450, 9000)])
    hr = greenfield.headroom(net, range(3))
    assert hr["nodes"][0]["headroom"] == 370
    net.pipes[2].dia = None
    assert greenfield.headroom(net, range(3))["nodes"][0]["unknown_diameter_pipes"] == [2]


def test_edge_and_exclusions():
    net = network(TREE + [(9, 0, .150, 200)])
    candidates = {1000: 0, 1001: 1, 1002: 2, 1003: 3}
    edge = {0: (180., 270.), 2: (150., 90.)}
    result = greenfield.eligible_sites(net, range(4), candidates, edge=edge)
    # An edge street junction qualifies despite incoming domain pipes; a line
    # end in the built network does not. Outside-domain pipes do not add load.
    assert [s["manhole_id"] for s in result["eligible"]] == [1000, 1002]
    assert result["eligible"][1]["in_degree"] == 2
    assert result["eligible"][1]["open_sector_deg"] == 150
    assert result["eligible"][1]["open_bearing_deg"] == 90
    assert result["excluded_counts"] == {
        "receives pumped or outside flow": 0, "not on the network's edge": 2,
        "unknown diameter": 0, "headroom below 10": 0}
    net.pipes[2].dwellings = 361  # 400 - (10 + 20 + 361) = 9.
    result = greenfield.eligible_sites(net, range(4), candidates, edge=edge)
    assert result["excluded_counts"]["headroom below 10"] == 2
    net.pipes[2].dwellings = 360
    result = greenfield.eligible_sites(net, range(4), candidates, edge=edge)
    assert [s["headroom"] for s in result["eligible"]] == [10, 10]
    net.pipes[2].dia = None
    hr = greenfield.headroom(net, range(4), node_properties={1: 1})
    result = greenfield.eligible_sites(net, range(4), candidates, headrooms=hr, edge=edge)
    assert [s["reason"] for s in result["excluded"]] == [
        "unknown diameter", "receives pumped or outside flow", "unknown diameter",
        "not on the network's edge"]
    # Retain the old positional call shape, but missing geometry cannot prove edge eligibility.
    assert not greenfield.eligible_sites(net, range(4), candidates)["eligible"]


def test_edge_sites():
    def polar(radius, bearing):
        return (radius * math.sin(math.radians(bearing)),
                radius * math.cos(math.radians(bearing)))

    nodes = {0: (0., 0.)}
    corner = [(r, 0.) for r in range(0, 501, 10)] + [(0., r) for r in range(0, 501, 10)]
    sector, bearing = greenfield.edge_sites(corner, nodes)[0]
    assert math.isclose(sector, 270.)
    assert math.isclose(bearing, 225.)  # South-west, clockwise from north.
    ring = [polar(100, a) for a in range(0, 360, 30)]
    assert greenfield.edge_sites(ring, nodes) == {}
    # An apparently open east-side gap is enclosed by existing streets/homes
    # just beyond the 400 m endpoint, still inside its 60 m clearance.
    gap = [polar(100, a) for a in range(0, 360, 10) if not 0 < a < 180]
    assert 0 in greenfield.edge_sites(gap, nodes)
    closed = gap + [polar(420, a) for a in range(0, 181, 5)]
    assert greenfield.edge_sites(closed, nodes) == {}
    assert 0 in greenfield.edge_sites(gap + [polar(470, a) for a in range(0, 181, 5)], nodes)
    # A blocked maximal-gap bisector may still have a qualifying subsector.
    shifted = greenfield.edge_sites(corner + [polar(300, 225)], nodes)[0]
    assert shifted[0] >= 120 and not math.isclose(shifted[1], 225)
    # Wrap-around north is treated as one continuous open sector.
    south = [polar(r, a) for r in range(20, 501, 10) for a in (90, 180, 270)]
    assert math.isclose(greenfield.edge_sites(south, nodes)[0][1], 0.)
    assert greenfield.edge_sites(ring, nodes, edge_open_deg=40) == {}
    assert greenfield.edge_sites([], nodes) == {0: (360., 0.)}


def test_network_points():
    net = SimpleNamespace(pipes=[SimpleNamespace(line=[(0., 0.), (6., 0.), (6., 18.)]),
                                 SimpleNamespace(line=[(999., 999.), (999., 1000.)])],
                          connections=[(30., 40., 1)], connection_junctions=[(31., 41.)],
                          connection_paths=[{"path": [(32., 42.), (33., 43.)]}])
    assert greenfield.network_points(net, [0]) == [
        (0., 0.), (6., 4.), (6., 14.), (6., 18.),
        (999., 999.), (999., 1000.),
        (30., 40.), (31., 41.), (32., 42.), (33., 43.)]


def test_clustering():
    def site(mh, node, limiter, bearing, sector):
        return dict(manhole_id=mh, node_id=node, limiting_pipe=limiter,
                    open_bearing_deg=bearing, open_sector_deg=sector)

    # Null limiters are not shared pipes. Bearings wrap through north; ties use id.
    sites = [site(10, 0, None, 350, 180), site(20, 1, None, 35, 200),
             site(30, 2, 99, 180, 150), site(40, 3, 99, 0, 150),
             site(50, 4, None, 81, 250)]
    xy = {0: (0, 0), 1: (300, 0), 2: (10000, 0), 3: (20000, 0), 4: (301, 0)}
    reps, excluded, clusters = greenfield.cluster_sites(sites, xy)
    assert [s['manhole_id'] for s in reps] == [20, 30, 50]
    assert [c['members'] for c in clusters] == [[10, 20], [30, 40], [50]]
    assert {r['reason'] for r in excluded} == {'same edge stretch as MH20', 'same edge stretch as MH30'}
    assert greenfield.cluster_sites(list(reversed(sites)), xy) == (reps, excluded, clusters)
    # Transitive geography is one connected component, even beyond one radius.
    chain = [site(i, i, None, 0, 180) for i in range(3)]
    assert greenfield.cluster_sites(chain, {i: (i * 300, 0) for i in range(3)})[2] == [
        {'representative': 0, 'members': [0, 1, 2]}]


def test_eval_scoring():
    ladder = {'1': ['MH1']}
    gate = dict(converged=True, continuity_err_pct=-.5)

    def row(homes, chosen, other, surcharge=(), flooded=()):
        return evaluation.evaluate_row(dict(dwellings=homes, added_lps=homes * .01,
            rise_mm={'1': chosen, '2': other}, surcharge=surcharge, spilled=flooded,
            run=gate), ladder)

    a = [row(10, 0, 0), row(30, 30, 60)]
    b = [row(10, 0, 60)]
    score = evaluation.site_weighted_score({'A': a, 'B': b}, 25, 1)
    assert score['share'] == .25  # Sites each weigh 1, rather than 1/3 per row.
    assert math.isclose(score['share_of_detectable'], 1 / 3)
    assert score['misses'] == {'no response anywhere': 1, 'response missed by the chosen sensors': 1}
    assert a[1]['detectable']['50'] and not a[1]['detected']['50']['1']
    assert evaluation.site_weighted_score({'A': [row(10, 0, 20)]}, 25, 1)['share_of_detectable'] is None
    assert evaluation.site_weighted_score({}, 10, 1)['share'] is None
    # A flooding event alone counts; same-step detection counts at-or-below.
    rows = [row(10, 0, 5), row(30, 25, 30, flooded=[2]), row(80, 60, 60)]
    assert evaluation.mark_before_surcharge(rows, 1) == 30
    assert rows[0]['before_surcharge']['25'] == 'no'
    assert rows[1]['before_surcharge']['25'] == 'yes'
    assert rows[2]['before_surcharge']['50'] == 'no'
    assert evaluation.mark_before_surcharge(a, 1) is None
    assert a[0]['before_surcharge']['10'] == 'no surcharge in range'
    # Flow, not dwelling count, controls pairing. Exactly 10% is accepted.
    estate = row(100, 30, 30)
    same_homes_wrong_flow = dict(estate, added_lps=2)
    different_homes_equal_flow = dict(estate, homes=122, added_lps=.9)
    assert evaluation.match_infill(estate, [same_homes_wrong_flow]) is None
    assert evaluation.match_infill(estate, [different_homes_equal_flow]) == different_homes_equal_flow


def test_eval_invalid_runs():
    good = dict(converged=True, continuity_err_pct=.5)
    summary = {'baseline': {'run': good}, 'rows': [
        {'site': 1, 'dwellings': 10, 'run': good},
        {'site': 1, 'dwellings': 30, 'run': dict(good, converged=False)},
        {'site': 1, 'dwellings': 80, 'failed': True},
        {'site': 2, 'dwellings': 10, 'run': dict(good, continuity_err_pct=-1.1)}]}
    valid, excluded = evaluation.valid_rows(summary, 'case')
    assert len(valid) == 1 and len(excluded) == 3
    summary['baseline']['run'] = dict(good, converged=False)
    valid, excluded = evaluation.valid_rows(summary, 'case')
    assert not valid and excluded[0]['scope'] == 'entire case'
    assert excluded[0]['excluded_growth_runs'] == 4
    assert evaluation.invalid_run(dict(good, converged=None))
    assert evaluation.invalid_run(dict(good, continuity_err_pct=math.nan))
    assert evaluation.invalid_run(dict(good, failed=True))


def test_bracket_jobs_and_loads():
    sites = [dict(manhole_id=1, steps=[10, 30, 60], ceiling=60, pumped=True),
             dict(manhole_id=2, steps=[10, 30, 80, 150], ceiling=150, pumped=False)]
    jobs = greenfield.case_jobs({}, {'variant': 'together'}, sites)
    assert [j[2] for j in jobs] == [{1: 30, 2: 30}, {1: 60, 2: 80}, {1: 60, 2: 150}]
    assert greenfield.case_jobs({}, {'variant': 'with_infill'}, sites)[0][2] == {1: 60, 2: 150}
    assert len(greenfield.case_jobs({}, {'variant': 'pumprate'}, sites)) == 7
    loads = greenfield.estate_loads({1: 30, 2: 30}, sites, .01, 7.85)
    assert loads == {1: 785, 2: 30}
    assert greenfield.estate_loads({1: 1000, 2: 1000}, sites, .01, 7.85) == {1: 1000, 2: 1000}
    assert greenfield.estate_loads({1: 30, 2: 30}, sites, .01) == {1: 30, 2: 30}


def test_eval_report():
    """Exercise case separation, invalid baselines, classes and unmatched pairs."""
    import contextlib
    import io
    import json
    from pathlib import Path
    from unittest.mock import patch

    gate = dict(converged=True, continuity_err_pct=.1)
    sites = [dict(manhole_id=1, steps=[10, 30, 80], connection_class='reticulation'),
             dict(manhole_id=2, steps=[10], connection_class='trunk')]
    cases = [dict(tag='base', variant='primary'), dict(tag='failed', variant='primary')]
    cases += [dict(tag=v, variant=v) for v in ('pumprate', 'together', 'with_infill')]
    plan = dict(eligible=sites, cases=cases, config={}, data_notes=['understanding only'])

    def raw(site, n, run=gate):
        return dict(site=site, dwellings=n, added_lps=n * .01, rise_mm={'1': n, '2': 0},
                    surcharge=[1] if n >= 30 else [], spilled=[], run=run)

    summaries = {c['tag']: dict(greenfield_config={}, sites=sites, case_spec=c,
        baseline={'run': gate}, rows=[raw(1, 10), raw(1, 30),
            raw(1, 80, dict(gate, converged=False)), raw(2, 10)]) for c in cases}
    summaries['failed']['baseline']['run'] = dict(gate, converged=False)
    for tag in ('together', 'with_infill'):
        summaries[tag]['rows'] = [raw(tag, 30)]
    numbers = dict(recommend=1, ladder=[dict(k=1, chosen=['MH1'])])
    regions = dict(regions=[dict(id='R1', manholes=[0, 1])],
        cases=[dict(tag='base', settle=dict(baseline=gate))],
        rows={'base': [dict(r=0, s=0, dw=123, lps=.1, rise=[[0, 30]], sur=[], spill=[], run=gate)]})
    written = {}

    def fake_read(path):
        if path.name == 'plan.json':
            return plan
        if path.name == 'numbers.json':
            return numbers
        return summaries[path.parent.name]

    def fake_js(path):
        return regions if path.name == 'regions.js' else {'chambers': ['MH1', 'MH2']}

    def capture(path, text):
        written[path.name] = text

    with patch.object(evaluation, 'read', side_effect=fake_read), \
            patch.object(evaluation, 'read_js', side_effect=fake_js), \
            patch.object(Path, 'exists', return_value=True), \
            patch.object(Path, 'write_text', autospec=True, side_effect=capture), \
            contextlib.redirect_stdout(io.StringIO()):
        evaluation.main()
    result = json.loads(written['eval.json'])
    assert set(result['headlines']) == {'base', 'failed'}
    assert set(result['extra_cases']) == {'pumprate', 'together', 'with_infill'}
    assert result['headlines']['failed']['rules']['10']['total'] == 0
    assert result['headlines']['base']['rules']['10']['total'] == 3
    assert result['headlines']['base']['unmatched_pairs'] == 1
    assert result['headlines']['base']['matched_pairs_only']['infill']['10']['total'] == 2
    assert result['headlines']['base']['by_connection_class']['trunk']['25']['total'] == 1
    assert len(result['excluded_runs']) == 3  # base+pumprate growth, failed baseline
    assert 'did not settle/converge' in written['eval_report.txt']
    assert 'Separate brackets' in written['eval_report.txt']


def test_bracket_task_loader():
    """Exercise the real load adapter with the hydraulic solver replaced."""
    import tempfile
    from unittest.mock import patch
    import sim25
    import sim25_grid

    per_home = sim25.PEOPLE_PER_NEW_DWELLING * sim25.LITRES_PER_PERSON_DAY / 86400 * sim25.PF_NOMINAL
    calls = []

    def fake_whole(args):
        case, background, growth, directory = args
        calls.append((background, growth))
        return None, (sum(background.values()) + sum(growth.values())) * per_home, 0., {}, {'converged': True}

    sites = [dict(manhole_id=1, pumped=True), dict(manhole_id=2, pumped=False)]
    with tempfile.TemporaryDirectory() as directory, \
            patch.object(sim25_grid, '_whole_task', side_effect=fake_whole):
        result = greenfield._run_task((sim25.Case(), 'combined', 30, directory,
            {'growth': {1: 30, 2: 30}, 'background_nodes': {'5': 123},
             'sites': sites, 'pump_rate_lps': 7.85}))
    assert calls[0][0] == {5: 123}
    assert math.isclose(calls[0][1][1] * per_home, 7.85)
    assert calls[0][1][2] == 30
    assert math.isclose(result[1], 7.85 + 30 * per_home)  # Background subtracted.


def test_real_plan():
    # Guard engine entry points while building the real model and plan.
    import model
    import pyswmm
    import sim25
    from unittest.mock import patch

    def no_swmm(*args, **kwargs):
        raise AssertionError("Planning must not run SWMM")

    with patch.object(model, "Simulation", no_swmm), patch.object(pyswmm, "Simulation", no_swmm), \
            patch.object(model, "run", no_swmm), patch.object(sim25, "solve", no_swmm):
        plan = greenfield.build_plan()
        real_model = sim25.Sim25Model(sim25.Case(), whole=True)
    candidates = {real_model.net.nodes[real_model.chambers[name]].manhole_id
                  for name in real_model.candidates}
    assert len(candidates) == plan["candidate_count"] == 328
    assert candidates == set(plan["candidate_ids"])
    assert 0 <= plan["eligible_count"] <= plan["candidate_count"]
    domain = real_model._pipe_ids
    boundaries, node_properties = greenfield.boundary_properties(real_model, sim25.CFG["loads"])
    by_name = {name: nid for nid, name in real_model.node_of.items()}
    transfers = [(by_name[wet], by_name[dis]) for _, wet, dis in real_model.pumps]
    hr = greenfield.headroom(real_model.net, domain,
                            plan["config"]["table_4_4_max_properties"],
                            node_properties=node_properties, pump_transfers=transfers)
    assert math.isclose(sum(e["flow_lps"] for e in boundaries), real_model.boundary_lps)
    assert plan["boundary_entries"] == boundaries
    # Both separate wet-well catchments must reach the downstream trunk.
    trunk = next(p.id for p in real_model.net.pipes if p.asset_id == 1495331)
    without_pumps = greenfield.headroom(real_model.net, domain, node_properties=node_properties)
    wet_properties = sum(real_model.net.pipes[i].dwellings
                         for wet, _ in transfers for i in real_model.net.upstream_pipes(wet))
    assert wet_properties == 55
    assert math.isclose(hr["pipes"][trunk]["existing_properties"]
                        - without_pumps["pipes"][trunk]["existing_properties"], wet_properties)
    for site in plan["eligible"] + plan["excluded"]:
        raw_headroom = hr["nodes"][site["node_id"]]["headroom"]
        assert site["headroom"] == (round(raw_headroom, 1) if raw_headroom is not None else None)
        if site["no_table_cap"]:
            assert site["limiting_pipe_index"] is None
            continue
        assert site["limiting_pipe_index"] in domain
        pipe = real_model.net.pipes[site["limiting_pipe_index"]]
        assert site["limiting_pipe"] == site["limiting_pipe_id"] == pipe.asset_id
        assert site["limiting_pipe_dn"] == pipe.dia * 1000
    for site in plan["eligible"]:
        assert site["manhole_id"] in candidates
        assert site["open_sector_deg"] >= plan["config"]["edge_open_deg"]
        assert 0 <= site["open_bearing_deg"] < 360
        # Independently check annular emptiness and finite-ray clearance.
        bearing = math.radians(site["open_bearing_deg"])
        ux, uy = math.sin(bearing), math.cos(bearing)
        origin = real_model.net.nodes[site["node_id"]]
        for x, y in greenfield.network_points(real_model.net, domain):
            dx, dy = x - origin.x, y - origin.y
            radius = math.hypot(dx, dy)
            if 15 <= radius <= plan["config"]["edge_radius_m"]:
                angle = math.degrees(math.atan2(dx, dy))
                difference = abs((angle - site["open_bearing_deg"] + 180) % 360 - 180)
                assert difference + 1e-7 >= site["open_sector_deg"] / 2
            t = min(plan["config"]["edge_clear_m"], max(60., dx * ux + dy * uy))
            assert math.hypot(dx - t * ux, dy - t * uy) >= 60 - 1e-7
        steps = site["steps"]
        assert 1 <= len(steps) <= len(plan['config']['steps']) + 1
        assert all(a < b for a, b in zip(steps, steps[1:]))
        raw_headroom = hr["nodes"][site["node_id"]]["headroom"]
        assert steps[-1] == (max(plan["config"]["steps"]) if site["no_table_cap"]
                             else min(max(plan['config']['steps']), math.floor(raw_headroom)))
        assert set(s for s in plan['config']['steps'] if s <= steps[-1]) <= set(steps)
        assert all(isinstance(s, int) for s in steps)
        assert min(steps) >= 10
    eligible_ids = {s["manhole_id"] for s in plan["eligible"]}
    excluded_ids = {s["manhole_id"] for s in plan["excluded"]}
    assert {4451967, 1623725}.isdisjoint(eligible_ids)
    assert {s["manhole_id"] for s in plan["excluded"]
            if s["reason"] == "receives pumped or outside flow"} >= {4451967, 1623725}
    assert len(plan["most_loaded_pipes"]) == 10
    assert [p["counted_properties"] for p in plan["most_loaded_pipes"]] == sorted(
        [p["existing_properties"] for p in hr["pipes"].values()], reverse=True)[:10]
    assert not (eligible_ids & excluded_ids)
    assert eligible_ids | excluded_ids == candidates
    assert plan["eligible_count"] + sum(plan["excluded_counts"].values()) == 328
    assert plan["growth_runs_per_case"] == sum(len(s["steps"]) for s in plan["eligible"])
    assert plan["run_count"] == sum(1 + len(greenfield.case_jobs(plan, c, plan['eligible']))
                                    for c in plan['cases'])
    assert plan["baseline_runs"] == plan["case_count"]
    chosen = sim25.CFG["simulation"]["case_sets"][plan["case_set"]]
    sens = chosen["sensitivity"]
    assert plan["primary_case_count"] == len(chosen["weather"]) + len(sens["at_ii"]) * len(sens["variants"])
    assert plan['case_count'] == plan['primary_case_count'] + 3
    import sim25_grid
    assert [c["tag"] for c in plan["cases"] if c['variant'] == 'primary'] == [c.tag() for c in sim25_grid.cases("all")]
    assert len(plan['edge_sensitivity']) == 9
    assert all(r['after_clustering'] <= r['before_clustering'] for r in plan['edge_sensitivity'])
    assert len({m for c in plan['clusters'] for m in c['members']}) == len(plan['eligible_before_clustering'])
    assert all(c['representative'] in c['members'] for c in plan['clusters'])
    assert all(p["limit"] is None for p in plan["most_loaded_pipes"] if p["dn"] > 300)


def test_atomic_checkpoint():
    import json
    from pathlib import Path
    import tempfile
    from unittest.mock import patch

    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "summary.json"
        greenfield.atomic_summary(path, {"saved": 1})
        with patch.object(greenfield.os, "replace", side_effect=OSError("interrupted")):
            try:
                greenfield.atomic_summary(path, {"saved": 2})
            except OSError:
                pass
            else:
                raise AssertionError("Interrupted replacement must fail")
        assert json.loads(path.read_text()) == {"saved": 1}
        assert not path.with_suffix(".json.tmp").exists()


def test_runner_resume_and_schema():
    import concurrent.futures
    import contextlib
    import io
    import json
    from pathlib import Path
    import tempfile
    from unittest.mock import patch
    import sim25
    import sim25_grid

    plan = greenfield.build_plan()
    probe = sim25.Sim25Model(sim25.Case(), whole=True)
    names = probe.candidates
    called = []

    def fake_run(task):
        case, site, n, _, *options = task
        called.append((site, n))
        state = {c: {"depth": .1 + n * .0001, "alarm": i == 0 or bool(n and i == 1),
                     "surcharged": i == 0 or bool(n and i == 1),
                     "spilled": i == 0 or bool(n and i == 1)}
                 for i, c in enumerate(names)}
        return state, float(n), {"minutes": 240, "converged": True,
                                "max_drift_mm": .1, "continuity_err_pct": .01}, 1.0

    class InlinePool:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def submit(self, function, args):
            future = concurrent.futures.Future()
            future.set_result(function(args))
            return future

    args = SimpleNamespace(cases=plan["cases"][0]["tag"], limit_sites=1,
                           limit_sizes=1, workers=1, resume=False)
    site, n = plan["eligible"][0]["manhole_id"], plan["eligible"][0]["steps"][0]
    with tempfile.TemporaryDirectory() as directory, \
            patch.object(greenfield, "OUT", Path(directory)), \
            patch.object(greenfield, "_run_task", side_effect=fake_run), \
            patch.object(concurrent.futures, "ProcessPoolExecutor", InlinePool), \
            contextlib.redirect_stdout(io.StringIO()) as output:
        greenfield.run_sweep(plan, args)
        assert called == [(None, 0), (site, n)]
        path = Path(directory) / args.cases / "summary.json"
        summary = json.loads(path.read_text())
        assert summary["family"] == "greenfield"
        assert len(summary["rows"]) == 1
        first = summary["rows"][0]
        assert len(summary["baseline"]["depth_mm"]) == 328
        assert len(first["depth_mm"]) == len(first["rise_mm"]) == 328
        assert set(first["rise_mm"].values()) == {round(n * .1, 2)}
        assert len(first["surcharge"]) == len(first["spilled"]) == 1
        assert len(first["surcharged"]) == len(first["flooded"]) == 2
        assert summary["run_length"]["baseline"]["converged"] is True
        assert summary["run_length"]["settle"] == sim25_grid.SETTLE
        assert "1/2 " in output.getvalue() and "2/2 " in output.getvalue()
        args.resume = True
        greenfield.run_sweep(plan, args)
        assert len(called) == 2  # Both baseline and finished growth must be skipped.
        args.limit_sizes = 2
        greenfield.run_sweep(plan, args)
        assert called[-1] == (site, plan["eligible"][0]["steps"][1])
        assert len(called) == 3
        assert len(json.loads(path.read_text())["rows"]) == 2
        with patch.object(greenfield, "_run_task", side_effect=RuntimeError("failed run")):
            args.limit_sizes = 3
            try:
                greenfield.run_sweep(plan, args)
            except RuntimeError:
                pass
            else:
                raise AssertionError("Failed runs must not be checkpointed")
        assert len(json.loads(path.read_text())["rows"]) == 2


if __name__ == "__main__":
    tests = [test_pure_import, test_pipe_limit, test_steps, test_tree_headroom,
             test_relief_loop, test_split_and_rejoin, test_boundary_headroom,
             test_boundary_conversion, test_pump_transfer, test_multiple_outlets_and_unknown,
             test_trunk_has_no_property_limit, test_edge_and_exclusions, test_edge_sites,
             test_network_points, test_real_plan,
             test_clustering, test_eval_scoring, test_eval_invalid_runs, test_bracket_jobs_and_loads,
             test_eval_report,
             test_bracket_task_loader,
             test_atomic_checkpoint, test_runner_resume_and_schema]
    for test in tests:
        try:
            test()
        except Exception:
            print(f"FAILED: {test.__name__}", file=sys.stderr)
            raise
    print(f"{len(tests)} passed")
