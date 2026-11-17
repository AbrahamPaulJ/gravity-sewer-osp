#!/usr/bin/env python3
"""Plan or run Sim 4 estates joining a manhole on the network's edge.

An estate joins through a short new connection beside open land; an estate in
the built network would need a second sewer under existing streets.

The graph functions accept Network-like objects and do not import the SWMM model.
Pipe ids are Network pipe indices; plan records also give published asset ids.
"""
import argparse
from collections import Counter, defaultdict
import json
import math
import os
from pathlib import Path
import sys
import time

sys.dont_write_bytecode = True

TABLE_4_4 = {"150": 400, "225": 1000, "300": 1800}
OUT = Path(__file__).resolve().parent / "results" / "sim4" / "greenfield"


def pipe_limit(diameter_m, table=None):
    """Reticulation property limit; None for unknown diameter or uncapped trunks."""
    if diameter_m is None:
        return None
    diameter_m = float(diameter_m)
    if not math.isfinite(diameter_m) or diameter_m <= 0:
        return None
    if diameter_m > .300:
        return None  # Branch/trunk capacity is a hydraulic question for SWMM.
    table = TABLE_4_4 if table is None else table
    if diameter_m < .150:
        return table["150"] * (diameter_m / .150) ** (8 / 3)
    dn = min((int(d) for d in table), key=lambda d: (abs(diameter_m * 1000 - d), d))
    limit = table[str(dn)]
    # SA Water cl 4.5.5, Table 4.4: 400/1000/1800 properties at DN150/225/300.
    if abs(diameter_m * 1000 - dn) <= 5 + 1e-9:
        return float(limit)
    # This equal-slope, equal-roughness scaling is a team calculation.
    return limit * (diameter_m / (dn / 1000)) ** (8 / 3)


def _graph(net, domain_pipes):
    incoming, outgoing = defaultdict(list), defaultdict(list)
    for pi in sorted(set(domain_pipes)):
        p = net.pipes[pi]
        outgoing[p.up].append(pi)
        incoming[p.down].append(pi)
    return incoming, outgoing


def _reachable(net, start, adjacency, next_node, transfers=None):
    """Unique nodes and pipes reachable through gravity and pump links."""
    seen_nodes, seen_pipes, stack = set(), set(), [start]
    while stack:
        nid = stack.pop()
        if nid in seen_nodes:
            continue
        seen_nodes.add(nid)
        stack.extend((transfers or {}).get(nid, ()))
        for pi in adjacency.get(nid, ()):
            seen_pipes.add(pi)
            stack.append(getattr(net.pipes[pi], next_node))
    return seen_nodes, seen_pipes


def headroom(net, domain_pipes, table=None, node_properties=None, pump_transfers=()):
    """Return pipe and node headroom for the domain's directed gravity graph.

    Each pipe counts its own properties and every unique upstream pipe's properties.
    At a split, all upstream properties are counted on each possible route. They are
    counted once at a rejoin, including relief and pump loops. Boundary properties
    enter at their join node. Pump links carry unique upstream property sources
    to the discharge, so a relief returning to a wet well cannot multiply them.
    No flow split is assumed. Downstream constraints also follow pump transfers.
    A missing diameter on any downstream route makes node headroom unknown.
    A terminal node has no downstream pipe constraint (headroom and limiter None).
    """
    domain = set(domain_pipes)
    incoming, outgoing = _graph(net, domain)
    node_properties = node_properties or {}
    pump_incoming, pump_outgoing = defaultdict(list), defaultdict(list)
    for wet, discharge in pump_transfers:
        pump_outgoing[wet].append(discharge)
        pump_incoming[discharge].append(wet)
    pipes, nodes = {}, {}
    for pi in sorted(domain):
        p = net.pipes[pi]
        source_nodes, upstream = _reachable(net, p.up, incoming, "up", pump_incoming)
        existing = (sum(net.pipes[i].dwellings for i in upstream | {pi})
                    + sum(node_properties.get(n, 0) for n in source_nodes))
        limit = pipe_limit(p.dia, table)
        unlimited = p.dia is not None and math.isfinite(p.dia) and p.dia > .300
        pipes[pi] = {"limit": limit, "unlimited": unlimited, "existing_properties": existing,
                     "headroom": None if limit is None else limit - existing}
    for nid in sorted(set(incoming) | set(outgoing) | set(pump_incoming) | set(pump_outgoing)):
        _, downstream = _reachable(net, nid, outgoing, "down", pump_outgoing)
        unknown = sorted(i for i in downstream
                         if pipes[i]["limit"] is None and not pipes[i]["unlimited"])
        constrained = [i for i in downstream if pipes[i]["limit"] is not None]
        if unknown:
            limiting = unknown[0]
            h = None
        elif constrained:
            limiting = min(constrained, key=lambda i: (pipes[i]["headroom"], i))
            h = pipes[limiting]["headroom"]
        else:
            limiting, h = None, None
        nodes[nid] = {"headroom": h, "limiting_pipe_id": limiting,
                      "unlimited": not unknown and not constrained,
                      "unknown_diameter_pipes": unknown}
    return {"pipes": pipes, "nodes": nodes,
            "receiving_nodes": set(node_properties) | set(pump_incoming)}


def boundary_properties(model, loads):
    """Keep Sim25's existing connection estimate; report its nominal total flow.

    Sim25 loads connections at people/connection * L/person/day * sewage factor,
    plus length/100 * I&I. I&I is not converted to additional properties when a
    connection estimate already exists. model.sew uses the case's peak or trough
    basis, exactly as Sim25Model._loads does.
    """
    per_property = loads["people_per_connection"] * loads["litres_per_person_day"] / 86400 * model.sew
    rows, properties = [], defaultdict(float)
    for entry in model.entries:
        n = entry["node"]
        sewage = entry["connections"] * per_property * model.case.bfac
        ii = entry["length_m"] / 100 * model.case.ii * model.case.bfac
        equivalent = float(entry["connections"])
        properties[n] += equivalent
        rows.append({"id": entry["id"], "kind": entry["kind"], "node": n,
                     "manhole": model.net.nodes[n].manhole_id,
                     "length_m": entry["length_m"], "flow_lps": sewage + ii,
                     "sewage_lps": sewage, "ii_lps": ii,
                     "equivalent_properties": equivalent,
                     "method": ("Sim25 connections: council connection-density estimate by pipe size"
                                if entry["kind"] == "statewide" else
                                "Sim25 connections: counted council branch properties")})
    return rows, dict(properties)


def network_points(net, domain_pipes=None):
    """All gravity polylines held by Network, sampled every 10 m, plus homes.

    domain_pipes remains an optional argument for callers; it does not clip land
    obstacles. Statewide pipes are included too if present in net.pipes.
    """
    points = []
    for pipe in net.pipes:
        line = pipe.line
        if not line:
            continue
        points.append(tuple(line[0][:2]))
        distance, sample = 0., 10.
        for a, b in zip(line, line[1:]):
            length = math.hypot(b[0] - a[0], b[1] - a[1])
            while length and sample <= distance + length:
                t = (sample - distance) / length
                points.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
                sample += 10.
            distance += length
        points.append(tuple(line[-1][:2]))
    points.extend((x, y) for x, y, _ in getattr(net, "connections", ()))
    points.extend(getattr(net, "connection_junctions", ()))
    for connection in getattr(net, "connection_paths", ()):
        points.extend((tuple(connection["path"][0][:2]), tuple(connection["path"][-1][:2])))
    return points


def edge_sites(points, node_xy, edge_open_deg=120, edge_radius_m=200,
               edge_clear_m=400):
    """Return {node: (sector degrees, bearing clockwise from north)}.

    Sector obstacles lie 15 m through edge_radius_m from the node. Clearance
    is the distance to the finite ray segment from 60 m through edge_clear_m;
    the initial 60 m accommodates the adjoining pipe and new connection.
    Search all qualifying sectors, including subsectors when a gap's middle
    is blocked farther away. No SWMM or Network object is needed.
    """
    from scipy.spatial import cKDTree

    if not 0 < edge_open_deg <= 360 or edge_radius_m < 15 or edge_clear_m < 60:
        raise ValueError("Invalid edge sector, radius or clearance length")
    if not points:
        return {nid: (360., 0.) for nid in node_xy}
    points = [tuple(p[:2]) for p in points]
    tree = cKDTree(points)
    result = {}
    for nid, (x, y) in node_xy.items():
        obstacles = []
        bearings = []
        for i in tree.query_ball_point((x, y), max(edge_radius_m, edge_clear_m + 60)):
            dx, dy = points[i][0] - x, points[i][1] - y
            radius = math.hypot(dx, dy)
            bearing = math.degrees(math.atan2(dx, dy)) % 360
            if 15 <= radius <= edge_radius_m:
                bearings.append(bearing)
            # Bearings whose finite ray comes closer than 60 m to this point.
            if 0 < radius < edge_clear_m + 60:
                if radius < math.sqrt(60 ** 2 + 60 ** 2):
                    cosine = radius / 120
                    half = math.degrees(math.acos(min(1., cosine)))
                elif radius <= math.sqrt(edge_clear_m ** 2 + 60 ** 2):
                    half = math.degrees(math.asin(60 / radius))
                else:
                    cosine = (radius ** 2 + edge_clear_m ** 2 - 60 ** 2) / (2 * radius * edge_clear_m)
                    half = math.degrees(math.acos(min(1., cosine)))
                obstacles.append((bearing, half))
        bearings = sorted(set(bearings))
        gaps = (list(zip(bearings, bearings[1:] + [bearings[0] + 360]))
                if bearings else [(0., 720.)])
        best = None
        for start, end in gaps:
            if end - start < edge_open_deg:
                continue
            middle = (start + end) / 2
            available = [(start + edge_open_deg / 2, end - edge_open_deg / 2)]
            for bearing, half in obstacles:
                for turn in (-360, 0, 360, 720):
                    lo, hi = bearing + turn - half, bearing + turn + half
                    remainder = []
                    for a, b in available:
                        if hi <= a or lo >= b:
                            remainder.append((a, b))
                        else:
                            if a <= lo:
                                remainder.append((a, lo))
                            if hi <= b:
                                remainder.append((hi, b))
                    available = remainder
            for a, b in available:
                bearing = min(b, max(a, middle))
                sector = min(360., 2 * min(bearing - start, end - bearing))
                candidate = (sector, bearing % 360)
                if best is None or (-candidate[0], candidate[1]) < (-best[0], best[1]):
                    best = candidate
        if best is not None:
            result[nid] = best
    return result


def eligible_sites(net, domain_pipes, candidates, min_homes=10, table=None,
                   headrooms=None, edge=None):
    """Classify a {published manhole id: network node id} candidate mapping.

    Exclusion reasons are exclusive: outside/pumped flow, network edge,
    known diameter, then minimum headroom. Degree is descriptive only.
    Omitted geometry leaves candidates unclassified as edges.
    """
    domain = set(domain_pipes)
    incoming, outgoing = _graph(net, domain)
    hr = headroom(net, domain, table) if headrooms is None else headrooms
    eligible, excluded = [], []
    receives_flow = "receives pumped or outside flow"
    not_edge = "not on the network's edge"
    below_minimum = f"headroom below {min_homes:g}"
    reasons = [receives_flow, not_edge, "unknown diameter", below_minimum]
    counts = dict.fromkeys(reasons, 0)
    edge = {} if edge is None else edge
    for mh, nid in sorted(candidates.items()):
        node = hr["nodes"][nid]
        pi = node["limiting_pipe_id"]
        limiter = net.pipes[pi] if pi is not None else None
        row = {"manhole_id": mh, "node_id": nid, "in_degree": len(incoming[nid]),
               "outgoing_dn": [None if net.pipes[i].dia is None else
                               net.pipes[i].dia * 1000 for i in outgoing[nid]],
               "outgoing_pipe_ids": [net.pipes[i].asset_id for i in outgoing[nid]],
               "headroom": node["headroom"], "no_table_cap": node["unlimited"],
               "limiting_pipe_index": pi,
               "limiting_pipe": limiter.asset_id if limiter else None,
               "limiting_pipe_id": limiter.asset_id if limiter else None,
               "limiting_pipe_dn": limiter.dia * 1000 if limiter and limiter.dia else None}
        if nid in hr["receiving_nodes"]:
            reason = receives_flow
        elif nid not in edge:
            reason = not_edge
        elif node["unknown_diameter_pipes"]:
            reason = reasons[2]
        elif node["headroom"] is not None and node["headroom"] < min_homes:
            reason = below_minimum
        else:
            row["open_sector_deg"], row["open_bearing_deg"] = edge[nid]
            eligible.append(row)
            continue
        row["reason"] = reason
        excluded.append(row)
        counts[reason] += 1
    return {"eligible": eligible, "excluded": excluded, "excluded_counts": counts}


def steps_for(h, steps, max_levels=None):
    """Every configured step below the common ceiling, then the ceiling itself."""
    if not steps or (h is not None and (not math.isfinite(h) or h < 1)):
        return []
    last = min(math.floor(h), max(steps)) if h is not None else max(steps)
    smaller = sorted({s for s in steps if 0 < s < last})
    return smaller + [last]


def cluster_sites(sites, node_xy, radius_m=300, angle_deg=45):
    """Connected components: shared non-null limiter OR nearby aligned bearings.

    Proximity and bearing tests are inclusive; bearings wrap through north.
    A chain of matching sites belongs to one stretch.
    """
    remaining = {s['manhole_id']: s for s in sites}
    representatives, excluded, clusters = [], [], []
    while remaining:
        group = [remaining.pop(min(remaining))]
        for a in group:
            for mh, b in list(remaining.items()):
                shared = (a['limiting_pipe'] is not None and
                          a['limiting_pipe'] == b['limiting_pipe'])
                distance = math.dist(node_xy[a['node_id']], node_xy[b['node_id']])
                angle = abs((a['open_bearing_deg'] - b['open_bearing_deg'] + 180) % 360 - 180)
                if shared or (distance <= radius_m and angle <= angle_deg):
                    group.append(remaining.pop(mh))
        winner = min(group, key=lambda s: (-s['open_sector_deg'], s['manhole_id']))
        representative = winner['manhole_id']
        representatives.append(dict(winner, edge_stretch=representative))
        clusters.append({'representative': representative,
                         'members': sorted(s['manhole_id'] for s in group)})
        excluded += [dict(s, edge_stretch=representative,
                          reason=f'same edge stretch as MH{representative}')
                     for s in group if s is not winner]
    return sorted(representatives, key=lambda s: s['manhole_id']), excluded, clusters


def read_js_object(path):
    text = Path(path).read_text(encoding='utf-8')
    return json.loads(text[text.index('{'):text.rindex('}') + 1])


def build_plan():
    """Build the whole-area Sim25Model, without opening or running SWMM."""
    import osp_config
    import sim25

    cfg = osp_config.load()
    settings = cfg["simulation"]["greenfield"]
    if sim25.STUDY_AREA != "whole":
        raise ValueError("Sim 4 greenfield requires simulation.study_area 'whole'")
    model = sim25.Sim25Model(sim25.Case(), whole=True)
    net, domain = model.net, set(model._pipe_ids)  # Includes the model's relief exits.
    if not net.has_dwellings:
        raise ValueError("Existing property connections are missing; cannot plan headroom")
    names = model.candidates
    if len(names) != 328:
        raise ValueError(f"Expected 328 published candidates, found {len(names)}")
    candidates = {net.nodes[model.chambers[name]].manhole_id: model.chambers[name]
                  for name in names}
    if len(candidates) != len(names):
        raise ValueError("Published candidate manhole ids are not unique")
    boundaries, outside_properties = boundary_properties(model, cfg["loads"])
    by_name = {name: nid for nid, name in model.node_of.items()}
    transfers = [(by_name[wet], by_name[discharge]) for _, wet, discharge in model.pumps]
    hr = headroom(net, domain, settings["table_4_4_max_properties"],
                  node_properties=outside_properties, pump_transfers=transfers)
    xy = {nid: (net.nodes[nid].x, net.nodes[nid].y) for nid in candidates.values()}
    points = network_points(net)
    edge = edge_sites(points, xy,
                      settings["edge_open_deg"], settings["edge_radius_m"], settings["edge_clear_m"])
    classified = eligible_sites(net, domain, candidates, settings["min_homes"],
                                headrooms=hr, edge=edge)
    before = [s['manhole_id'] for s in classified['eligible']]
    # Compare the old clipped obstacle rule using the identical sampler.
    from types import SimpleNamespace
    clipped = SimpleNamespace(pipes=[net.pipes[i] for i in sorted(domain)],
                              connections=getattr(net, 'connections', ()),
                              connection_junctions=getattr(net, 'connection_junctions', ()),
                              connection_paths=getattr(net, 'connection_paths', ()))
    old_edge = edge_sites(network_points(clipped), xy, settings['edge_open_deg'],
                          settings['edge_radius_m'], settings['edge_clear_m'])
    old_ids = [s['manhole_id'] for s in eligible_sites(
        net, domain, candidates, settings['min_homes'], headrooms=hr, edge=old_edge)['eligible']]
    edge_sensitivity = []
    for angle in (90, 120, 150):
        for radius in (150, 200, 300):
            sensitivity_edge = edge_sites(points, xy, angle, radius, settings['edge_clear_m'])
            shortlist = eligible_sites(net, domain, candidates, settings['min_homes'],
                                       headrooms=hr, edge=sensitivity_edge)['eligible']
            reps, _, _ = cluster_sites(shortlist, xy, settings['cluster_radius_m'],
                                       settings['cluster_angle_deg'])
            edge_sensitivity.append({'edge_open_deg': angle, 'edge_radius_m': radius,
                                     'before_clustering': len(shortlist), 'after_clustering': len(reps)})
    representatives, duplicates, clusters = cluster_sites(
        classified['eligible'], xy, settings['cluster_radius_m'], settings['cluster_angle_deg'])
    classified['eligible'] = representatives
    classified['excluded'] += duplicates
    for row in duplicates:
        reason = row['reason']
        classified['excluded_counts'][reason] = classified['excluded_counts'].get(reason, 0) + 1
    estates_path = Path(osp_config.ROOT) / 'simulation4/data/estates.js'
    estates = read_js_object(estates_path).get('sites', {}) if estates_path.exists() else {}
    missing_pumped = []
    for site in representatives:
        site['steps'] = steps_for(site['headroom'], settings['steps'])
        site['ceiling'] = site['steps'][-1]
        levels = estates.get(f"MH{site['manhole_id']}", {}).get('levels', {})
        site['pumped'] = levels.get('pumped') is True
        site['pumped_known'] = isinstance(levels.get('pumped'), bool)
        if not site['pumped_known']:
            missing_pumped.append(site['manhole_id'])
        site['connection_class'] = ('reticulation' if any(
            d is not None and d <= 300 for d in site['outgoing_dn']) else 'trunk')
    for site in classified["eligible"] + classified["excluded"]:
        if site["headroom"] is not None:
            site["headroom"] = round(site["headroom"], 1)
    most_loaded = []
    for pi in sorted(domain, key=lambda i: (-hr["pipes"][i]["existing_properties"],
                                          net.pipes[i].asset_id))[:10]:
        p, counts = net.pipes[pi], hr["pipes"][pi]
        most_loaded.append({"asset_id": p.asset_id, "dn": p.dia * 1000 if p.dia else None,
                            "limit": counts["limit"],
                            "counted_properties": counts["existing_properties"],
                            "headroom": (round(counts["headroom"], 1)
                                         if counts["headroom"] is not None else None)})
    case_config = sim25.load_cases(cfg)
    from dataclasses import asdict
    cases = [sim25.Case(ii=w["ii"]) for w in case_config["weather"]]
    sensitivity = case_config["sensitivity"]
    cases += [sim25.Case(ii=ii, **v["set"])
              for ii in sensitivity.get("at_ii", []) for v in sensitivity.get("variants", [])]
    case_rows = [{'tag': c.tag(), **asdict(c), 'variant': 'primary'} for c in cases]
    bracket = sim25.Case(ii=.11, age='uniform', bfac=1)
    # Sim25 derives these bores from the published rising mains, using config velocity.
    mains = sim25.rising_mains()
    bores = [m['dia_mm'] / 1000 for m in mains.values() if m.get('dia_mm', 0) > 0]
    bore = min(bores, default=.100)
    velocity = cfg.get('pumps', {}).get('rising_main_velocity_m_s', 1.0)
    pump_rate = math.pi * bore ** 2 / 4 * velocity * 1000
    case_rows += [{'tag': bracket.tag() + '_' + variant, **asdict(bracket),
                   'variant': variant} for variant in ('pumprate', 'together')]
    # Both growth mappings are added by Sim25._loads. Use the actual Sim4 partition
    # and distributor; one largest-step background per distinct receiving region.
    import sim3_regions
    regs = [r for r in sim3_regions.regions(net, model, domain - model._exits,
                                           partition='bisection') if not r.get('overlay')]
    infill_nodes, infill_regions = defaultdict(float), {}
    for site in representatives:
        region = next((r for r in regs if site['manhole_id'] in r['manholes']), None)
        if region is None:
            raise ValueError(f"No Sim4 infill region for MH{site['manhole_id']}")
        site['region'] = region['id']
        if region['id'] not in infill_regions:
            step = max(cfg['simulation']['regions']['ladder'])
            adds = sim3_regions.growth_nodes(region, step, net)
            for nid, n in adds.items():
                infill_nodes[nid] += n
            infill_regions[region['id']] = {'step': step, 'dwellings': sum(adds.values())}
    case_rows.append({'tag': bracket.tag() + '_with_infill', **asdict(bracket),
                      'variant': 'with_infill', 'background_nodes': dict(infill_nodes),
                      'infill_regions': infill_regions})
    incoming, outgoing = _graph(net, domain)
    terminals = sorted(set(incoming) - set(outgoing))
    unknown = [net.pipes[i].asset_id for i in sorted(domain)
               if hr["pipes"][i]["limit"] is None and not hr["pipes"][i]["unlimited"]]
    scaled = Counter()
    for pi in domain:
        d = net.pipes[pi].dia
        if pipe_limit(d) is not None and (d < .150 or
                min(abs(d * 1000 - dn) for dn in (150, 225, 300)) > 5 + 1e-9):
            scaled[d * 1000] += 1
    growth_runs = sum(len(s["steps"]) for s in classified["eligible"])
    notes = [
        f"A greenfield estate joins a manhole on the network's edge, where open land lies beside it (an open sector of at least {settings['edge_open_deg']:g} degrees with no pipes or homes within {settings['edge_radius_m']:g} m, clear for {settings['edge_clear_m']:g} m along its middle); an estate in the middle of the built network would need a second sewer under existing streets.",
        "This family is for understanding whether the infill-chosen sensors notice hypothetical growth at an edge connection. It is not a planning, serviceability or capacity study; geometric openness does not establish access, land availability or a feasible receiving invert.",
        "Geometry uses every gravity pipe held by Network, including non-domain/statewide pipes if held, sampled every 10 m, and all retained homes and property connection points. It does not import extra surrounding GIS. The sector ignores points within 15 m; the 60 m clearance is checked along the ray from 60 m to its configured end, allowing the short connection beside the existing pipe.",
        "outgoing_dn is a list of recorded diameters in mm, in outgoing pipe order; limiting_pipe_dn is also in mm. Pipe ids are published asset ids; pipe indices are Network indices.",
        "At splits, every downstream route must have headroom. Shared upstream properties are counted once per pipe, including relief loops; no hydraulic flow split is assumed.",
        "Limits are from SA Water Supplement Table 4.4 for reticulation sewers (DN150-300). Only pipes DN <= 300 constrain property headroom on each downstream path. Branch and trunk capacity (DN375+) is left to SWMM, with no property limit above DN300.",
        "Below DN150 the limit scales from DN150; other unlisted reticulation diameters scale from the nearest Table 4.4 DN at equal slope and roughness. This is a team calculation.",
        "Estate sizes, the short connection at the network edge and estate infiltration are team assumptions because no public data gives them. The estate adds sewage only, with no extra infiltration for its own new pipes, exactly as Sim25Model growth does. For paths without a reticulation constraint, the largest configured estate size caps the ladder only.",
        "Table 4.4 limits apply to total EP on a pipe, expressed here as equivalent properties using the configured Table 4.4 property limits; they are not an allowance for new properties alone.",
        "Boundary conversion is a team estimate: use Sim25's estimated/countable connections, not total boundary L/s divided by sewage per property. Boundary L/s includes both sewage and I&I, on the nominal Sim25 case basis.",
        "Counts include unique upstream Pipe.dwellings, boundary properties at their joins and wet-well catchments transferred at pump discharges. Downstream checks follow pumps as well as gravity pipes. Hydraulic constraints are tested by the SWMM run stage.",
        "Headroom is displayed to one decimal; integer steps use floor of unrounded headroom, capped at the largest configured step for every site. All smaller configured steps are retained. 'No table cap' means no Table 4.4 property limit above DN300, not unlimited hydraulic capacity.",
        f"Existing dwellings use {cfg['loads']['people_per_connection']:g} people per connection; new dwellings use {cfg['loads']['people_per_new_dwelling']:g}, both at the same configured peaking factor ({cfg['loads']['peak_factor']:g} for these peak-hour cases). b1.5 multiplies boundary sewage AND boundary I&I by 1.5; it does not multiply existing in-domain sewage, in-domain I&I or estate sewage. Estates add no infiltration: a sewage-only control. Pumped estates use their smoothed peak-hour flow in the primary cases.",
        f"The _pumprate bracket uses max(estate peak-hour flow, {pump_rate:.4f} L/s), from {velocity:g} m/s in the smallest published rising main DN{bore * 1000:g}, only for sites flagged levels.pumped in simulation4/data/estates.js. Gravity estates are unchanged. This is steady depth while the pump runs, an upper bound, not a volume-preserving duty-cycle model.",
        f"Missing pumped flags are treated as gravity: {', '.join('MH' + str(mh) for mh in missing_pumped) or 'none'}.",
        "The _together case loads all representatives at once at 30, 80 and 150 homes each, capped individually. The _with_infill case loads every representative at 150 homes (or its ceiling) on top of the largest Sim4 infill step in each distinct containing region. Its baseline includes that same infill background, so rises isolate the additional estates.",
        "Exclusion order: receives pumped or outside flow, not on the network's edge, unknown diameter, headroom below minimum, then same edge stretch. Clusters are connected components sharing a non-null limiting pipe or within the configured distance and bearing difference; the largest open sector wins, then the lowest manhole id. Counts are exclusive.",
        f"Remaining limits: no pump duty-cycle bursts; free outfall (no tailwater); steady peak hour only (no trough, diurnal or wet-weather timing); relief inlets as configured ({cfg['simulation']['overflow_inlet']}).",
    ]
    if len(terminals) > 1:
        notes.append(f"The gravity domain has {len(terminals)} terminals, including pump wet wells and relief exits; all reachable downstream gravity paths are checked.")
    if unknown:
        notes.append(f"{len(unknown)} domain pipes have unknown diameter; any candidate reaching one is excluded.")
    return {"family": "sim4_greenfield", "candidate_count": len(names),
            "candidate_ids": sorted(candidates), "eligible_count": len(classified["eligible"]),
            **classified, "config": settings, "study_area": "whole",
            "case_set": case_config["case_set"], "case_config": case_config,
            "cases": case_rows, "case_count": len(case_rows), 'primary_case_count': len(cases),
            'clusters': clusters, 'edge_sensitivity': edge_sensitivity,
            'eligible_before_clustering': before,
            'obstacle_change': {'clipped_eligible': old_ids, 'all_network_eligible': before,
                                'removed': sorted(set(old_ids) - set(before)),
                                'added': sorted(set(before) - set(old_ids)),
                                'domain_pipes': len(domain), 'network_pipes': len(net.pipes)},
            'pump_rate_lps': pump_rate,
            "growth_runs_per_case": growth_runs, "baseline_runs": len(case_rows),
            "run_count": sum(1 + len(case_jobs({}, c, representatives)) for c in case_rows),
            "data_notes": notes,
            "boundary_entries": boundaries, "most_loaded_pipes": most_loaded,
            "domain": {"pipe_count": len(domain), "outlet_node_ids": terminals,
                       "unknown_diameter_pipe_ids": unknown,
                       "scaled_diameters": [{"diameter_mm": d, "pipe_count": n}
                                            for d, n in sorted(scaled.items())],
                       "relief_pipe_ids": [net.pipes[i].asset_id for i in sorted(domain)
                                           if getattr(net.pipes[i], "overflow", False)],
                       "pump_links": [list(p) for p in model.pumps]}}


def write_plan(plan):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "plan.json").write_text(json.dumps(plan, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    lines = ["Sim 4 greenfield plan", "New estate outside the network; one existing manhole connection.",
             f"Eligible: {plan['eligible_count']} of {plan['candidate_count']} candidates."]
    lines += [f"Excluded - {reason}: {n}" for reason, n in plan["excluded_counts"].items()]
    lines += [f"Cases: {plan['case_count']} ({plan['case_set']}).",
              f"Growth sizes per case: {plan['growth_runs_per_case']}.",
              f"Planned runs: {plan['run_count']} (including {plan['baseline_runs']} baselines).",
              f"Gravity outlets: {len(plan['domain']['outlet_node_ids'])}.",
              f"Unknown-diameter pipes: {len(plan['domain']['unknown_diameter_pipe_ids'])}.",
              "This plan does not run SWMM.", "", *plan["data_notes"]]
    lines += ["", "10 most loaded pipes (by total counted properties, including boundary/pump):",
              "Asset id | DN (mm) | Limit (properties) | Counted properties | Headroom"]
    for pipe in plan["most_loaded_pipes"]:
        limit = ("no table cap" if pipe["dn"] and pipe["dn"] > 300 else "unknown") if pipe["limit"] is None else f"{pipe['limit']:.1f}"
        h = "n/a" if pipe["headroom"] is None else f"{pipe['headroom']:.1f}"
        dn = "unknown" if pipe["dn"] is None else f"{pipe['dn']:g}"
        lines.append(f"{pipe['asset_id']} | {dn} | {limit} | {pipe['counted_properties']:.1f} | {h}")
    lines += ["", "Boundary entries (nominal Sim25 case; conversion is a team estimate):",
              "Entry id | Node | Manhole | L/s | Equivalent properties | Method"]
    for entry in plan["boundary_entries"]:
        lines.append(f"{entry['id']} | {entry['node']} | {entry['manhole']} | "
                     f"{entry['flow_lps']:.3f} | {entry['equivalent_properties']:.1f} | {entry['method']}")
    eligible_lines = ["", "Eligible estate connections:",
              "Manhole | Headroom | Limiting pipe | DN (mm) | Open bearing (deg) | Open sector (deg) | Estate steps (properties) | Connection | Pumped"]
    for site in plan["eligible"]:
        h = "no table cap" if site["no_table_cap"] else f"{site['headroom']:.1f}"
        dn = "n/a" if site["limiting_pipe_dn"] is None else f"{site['limiting_pipe_dn']:g}"
        eligible_lines.append(f"{site['manhole_id']} | {h} | {site['limiting_pipe']} | "
                     f"{dn} | {site['open_bearing_deg']:.1f} | {site['open_sector_deg']:.1f} | {', '.join(map(str, site['steps']))} | {site['connection_class']} | {site['pumped']}")
    edge_connections = [s for s in plan["eligible"] + plan["excluded"]
                        if s.get("reason") not in ("not on the network's edge", "receives pumped or outside flow")]
    constraints = Counter((s["limiting_pipe"], s["limiting_pipe_dn"], s["headroom"])
                          for s in edge_connections)
    lines += ["", "Limiting pipes for eligible or excluded edge connections:",
              "Asset id | DN (mm) | Headroom | Edge connections"]
    for (asset, dn, h), count in sorted(constraints.items(), key=lambda x: str(x[0])):
        dn_text = "unknown" if dn is None else f"{dn:g}"
        h_text = ("no table cap" if asset is None else "unknown") if h is None else f"{h:.1f}"
        lines.append(f"{asset} | {dn_text} | {h_text} | {count}")
    change = plan['obstacle_change']
    lines += ['', f"Obstacle coverage: {change['domain_pipes']} domain pipes -> {change['network_pipes']} Network gravity pipes.",
              f"Eligible before clustering: clipped {len(change['clipped_eligible'])} -> all Network {len(change['all_network_eligible'])}.",
              f"Removed: {change['removed']}; added: {change['added']}.",
              '', 'Edge-rule sensitivity (all Network obstacles; no SWMM):',
              'Open deg | Radius m | Eligible before clustering | Representatives']
    for row in plan['edge_sensitivity']:
        lines.append(f"{row['edge_open_deg']} | {row['edge_radius_m']} | {row['before_clustering']} | {row['after_clustering']}")
    lines += eligible_lines
    lines += ['', 'Edge stretches (representative <- all cluster members):']
    for cluster in plan['clusters']:
        lines.append(f"MH{cluster['representative']} <- " + ', '.join('MH' + str(m) for m in cluster['members']))
    lines += ['', 'Separate cases:']
    for case in plan['cases']:
        if case['variant'] != 'primary':
            count = len(case_jobs(plan, case, plan['eligible']))
            lines.append(f"{case['tag']}: {count} growth runs + 1 baseline")
    lines.append(f"Planned runs: {plan['run_count']} (including {plan['baseline_runs']} baselines).")
    text = "\n".join(lines) + "\n"
    (OUT / "plan.txt").write_text(text, encoding="utf-8")
    return text


def atomic_summary(path, summary):
    """Replace a checkpoint only after the complete new JSON has reached disk."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    try:
        with temporary.open("w", encoding="utf-8", newline="\n") as stream:
            json.dump(summary, stream, indent=1, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def case_jobs(plan, case, sites, limit_sizes=None):
    """(site key, size label, estate dwellings mapping), without running SWMM."""
    variant = case.get('variant', 'primary')
    if variant == 'together':
        return [('together', n, {s['manhole_id']: min(n, s['ceiling']) for s in sites})
                for n in (30, 80, 150)][:limit_sizes]
    if variant == 'with_infill':
        return [('with_infill', 150, {s['manhole_id']: min(150, s['ceiling']) for s in sites})]
    return [(s['manhole_id'], n, {s['manhole_id']: n})
            for s in sites for n in s['steps'][:limit_sizes]]


def estate_loads(growth, sites, per_home_lps, pump_rate_lps=None):
    """Equivalent dwelling loads preserve the shared sewage-only Sim25 loader."""
    pumped = {str(s['manhole_id']) for s in sites if s.get('pumped')}
    return {int(mh): max(n, pump_rate_lps / per_home_lps)
            if pump_rate_lps is not None and str(mh) in pumped else n
            for mh, n in growth.items()}


def _run_task(args):
    """Use the infill grid's gated solver and its exact single-manhole loads.

    SWMM needs input/report/output files while solving. Growth files live only in
    a temporary directory and are removed by _whole_task; baseline files are kept.
    """
    import tempfile
    import sim25
    import sim25_grid

    case, site, dwellings, case_dir, *rest = args
    options = rest[0] if rest else {}
    background = {int(n): d for n, d in options.get('background_nodes', {}).items()}
    started = time.monotonic()
    if site is None:
        model = sim25.Sim25Model(case, whole=True, growth_nodes=background)
        res, state, _ = sim25.solve(model, sim25_grid.MAX_MINUTES,
                                   str(Path(case_dir) / "base"), settle=sim25_grid.SETTLE)
        state = {c: state[c] for c in model.candidates}
        added_lps, gate = 0., sim25_grid.provenance(res)
    else:
        with tempfile.TemporaryDirectory(prefix=".growth-", dir=case_dir) as scratch:
            growth = options.get('growth', {site: dwellings})
            per_home = (sim25.PEOPLE_PER_NEW_DWELLING * sim25.LITRES_PER_PERSON_DAY
                        / 86400 * sim25.PF_NOMINAL)
            growth = estate_loads(growth, options.get('sites', []), per_home,
                                  options.get('pump_rate_lps'))
            _, added_lps, _, state, gate = sim25_grid._whole_task(
                (case, background, growth, str(Path(scratch) / "run")))
            added_lps -= sum(background.values()) * per_home
    return state, added_lps, gate, round(time.monotonic() - started, 3)


def result_row(site, dwellings, result, mh_of, baseline=None):
    state, added_lps, gate, wall_s = result
    depth = {str(mh): round(state[c]["depth"] * 1000, 4) for c, mh in mh_of.items()}
    absolute = {key: sorted(mh for c, mh in mh_of.items() if state[c][key])
                for key in ("alarm", "surcharged", "spilled")}
    row = {"site": site, "dwellings": dwellings, "added_lps": round(added_lps, 4),
           "depth_mm": depth,
           "rise_mm": {mh: round(d - baseline["depth_mm"][mh], 2) if baseline else 0.0
                       for mh, d in depth.items()},
           "surcharged": absolute["surcharged"], "flooded": absolute["spilled"],
           "pumps": gate.get("pumps"), "run": gate, "wall_s": wall_s}
    # Same names and newly-triggered semantics as sim3_regions summary rows.
    for key, output in (("alarm", "alarm"), ("surcharged", "surcharge"), ("spilled", "spilled")):
        before = set(baseline[key]) if baseline else set()
        row[output] = sorted(set(absolute[key]) - before)
    return row


def _update_run_length(summary):
    runs = [row["run"] for row in summary["rows"]]
    summary["run_length"]["baseline"] = summary["baseline"]["run"]
    summary["run_length"]["growth_runs"] = {
        "min_minutes": min((r["minutes"] for r in runs), default=None),
        "max_minutes": max((r["minutes"] for r in runs), default=None),
        "unconverged": sum(r["converged"] is False for r in runs),
        "max_drift_mm": max((r["max_drift_mm"] or 0 for r in runs), default=None)}


def run_sweep(plan, args):
    from concurrent.futures import ProcessPoolExecutor, as_completed
    from dataclasses import asdict
    import sim25
    import sim25_grid

    cases = plan['cases']
    if args.cases != "all":
        tags = set(args.cases.split(","))
        unknown = tags - {case['tag'] for case in cases}
        if unknown:
            raise ValueError(f"Unknown active case tags: {', '.join(sorted(unknown))}")
        cases = [case for case in cases if case['tag'] in tags]
    sites = plan["eligible"][:args.limit_sites]
    probe = sim25.Sim25Model(sim25.Case(), whole=True)
    mh_of = {c: probe.nodes[c].manhole_id for c in probe.candidates}
    total = sum(1 + len(case_jobs(plan, c, sites, args.limit_sizes)) for c in cases)
    done = 0

    def progress(tag, row):
        nonlocal done
        done += 1
        status = "settled" if row["run"]["converged"] else "cap"
        print(f"{done}/{total} {tag} {row['site'] if row['site'] is not None else 'baseline'} "
              f"+{row['dwellings']} {status} {row['wall_s']:g}s", flush=True)

    # One SWMM engine per process, as in sim3_regions. Keep OpenMP to one thread.
    with ProcessPoolExecutor(args.workers, initializer=sim25_grid._pin_worker,
                             initargs=(0, 1)) as pool:
        for spec in cases:
            case = sim25.Case(**{k: spec[k] for k in sim25.Case.__dataclass_fields__})
            tag = spec['tag']
            jobs = case_jobs(plan, spec, sites, args.limit_sizes)
            options = {'background_nodes': spec.get('background_nodes', {}), 'sites': sites}
            if spec['variant'] == 'pumprate':
                options['pump_rate_lps'] = plan['pump_rate_lps']
            started = time.monotonic()
            directory = OUT / tag
            directory.mkdir(parents=True, exist_ok=True)
            path = directory / "summary.json"
            summary = None
            if args.resume and path.exists():
                summary = json.loads(path.read_text(encoding="utf-8"))
                if (summary.get("family") != "greenfield" or summary.get("case") != asdict(case)
                        or summary.get("greenfield_config") != plan["config"]
                        or summary.get('case_spec') != json.loads(json.dumps(spec))
                        or summary["run_length"]["settle"] != sim25_grid.SETTLE
                        or summary["run_length"]["ceiling_min"] != sim25_grid.MAX_MINUTES
                        or summary.get("candidates") != list(mh_of.values())):
                    raise ValueError(f"{path}: incompatible checkpoint; rerun without --resume")
            if summary is None:
                baseline = result_row(None, 0, pool.submit(
                    _run_task, (case, None, 0, str(directory), options)).result(), mh_of)
                summary = {"case": asdict(case), 'case_spec': spec, "tag": tag, "family": "greenfield",
                           "greenfield_config": plan["config"], "sites": sites,
                           "candidates": list(mh_of.values()), "rise_floor_mm": 0.0,
                           "baseline_depth_m": {mh: round(d / 1000, 4)
                                                for mh, d in baseline["depth_mm"].items()},
                           "baseline": baseline, "rows": [],
                           "run_length": {"ceiling_min": sim25_grid.MAX_MINUTES,
                                          "settle": sim25_grid.SETTLE}}
                _update_run_length(summary)
                summary["wall_s"] = round(time.monotonic() - started, 3)
                atomic_summary(path, summary)
                progress(tag, baseline)
            else:
                done += 1
            previous_wall = summary["wall_s"]
            started = time.monotonic()
            summary["sites"] = sites
            completed = {(row["site"], row["dwellings"]) for row in summary["rows"]}
            done += sum((site, n) in completed for site, n, _ in jobs)
            pending = {pool.submit(_run_task, (case, site, n, str(directory),
                                              dict(options, growth=growth))): (site, n, growth)
                       for site, n, growth in jobs if (site, n) not in completed}
            for future in as_completed(pending):
                site, n, growth = pending[future]
                row = result_row(site, n, future.result(), mh_of, summary["baseline"])
                row['estate_dwellings'] = growth
                summary["rows"].append(row)
                summary["rows"].sort(key=lambda row: (row["site"], row["dwellings"]))
                _update_run_length(summary)
                summary["wall_s"] = round(previous_wall + time.monotonic() - started, 3)
                atomic_summary(path, summary)
                progress(tag, row)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--plan", action="store_true")
    mode.add_argument("--run", action="store_true")
    parser.add_argument("--cases", default="all", help="all or comma-separated active case tags")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--limit-sites", type=int)
    parser.add_argument("--limit-sizes", type=int)
    args = parser.parse_args()
    for name in ("workers", "limit_sites", "limit_sizes"):
        value = getattr(args, name)
        if value is not None and value < 1:
            parser.error(f"--{name.replace('_', '-')} must be positive")
    plan = build_plan()
    if args.run:
        try:
            run_sweep(plan, args)
        except ValueError as exc:
            parser.error(str(exc))
    else:
        print(write_plan(plan), end="")


if __name__ == "__main__":
    main()
