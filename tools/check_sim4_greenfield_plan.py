"""Independent check of the Sim 4 greenfield plan (final rule set, 17 Nov 2026).

Does NOT import sim4_greenfield. Rebuilds topology from the sim25 data loader, sensors from
results/sim4/numbers.json, and recomputes land groups, exits, sensor classes, picks, coverage,
pump variants and combined shared-pipe loads, then compares with results/sim4/greenfield/plan.json.
Run from simulation_src. Prints PASS/FAIL per rule; exit 1 on any FAIL.
"""
import json, math, sys, collections
import sim25

plan = json.load(open("results/sim4/greenfield/plan.json"))
numbers = json.load(open("results/sim4/numbers.json"))
sensors = next(r["chosen"] for r in numbers["ladder"] if r["k"] == numbers["recommend"])
m = sim25.Sim25Model(sim25.Case(), whole=True)
net, dom, exits = m.net, set(m._pipe_ids), set(m._exits)
by_name = {n: i for i, n in m.node_of.items()}
pumps = [(by_name[w], by_name[d]) for _, w, d in m.pumps]
wet_wells = {w for w, _ in pumps}
g_out, g_in, reach_out = collections.defaultdict(list), collections.defaultdict(list), collections.defaultdict(list)
for k in dom:
    p = net.pipes[k]; g_out[p.up].append(k); g_in[p.down].append(k); reach_out[p.up].append(p.down)
for w, d in pumps:
    reach_out[w].append(d)
sensor_node = {i: f"MH{nd.manhole_id}" for i, nd in enumerate(net.nodes)
               if nd.manhole_id is not None and f"MH{nd.manhole_id}" in sensors}
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f" -- {detail}" if detail and not ok else ""))
    if not ok: fails.append(name)

check("sensors resolved", len(sensor_node) == len(sensors) == 5, f"{sensors} -> {sensor_node}")

def is_exit(n):
    if n in wet_wells: return False
    outs = g_out.get(n, [])
    return (not outs) or any(k in exits for k in outs)
def kind(n):
    if n in wet_wells: return "pump_wet_well"
    if is_exit(n): return "exit"
    if net.nodes[n].manhole_id is not None: return "manhole"
    if not g_in.get(n): return "pipe_end"
    return "inline" if len(g_in[n]) == 1 and len(g_out[n]) == 1 else "junction"
def downstream(n):
    seen, st = set(), [n]
    while st:
        x = st.pop()
        if x in seen: continue
        seen.add(x); st += reach_out.get(x, [])
    return seen
def sensors_down(n):
    return sorted(sensor_node[x] for x in downstream(n) if x in sensor_node)

# Edge points before grouping: every eligible site plus every site excluded only as a grouping duplicate.
eligible = plan["eligible"]
before = set(plan.get("eligible_before_clustering", []))
dupes = [e for e in plan["excluded"] if e["site_id"] in before]
points = {s["site_id"]: s for s in eligible + dupes}
check("every pre-grouping edge point is either a connection or a grouped duplicate",
      set(points) == before, f"missing {sorted(before - set(points))[:8]} extra {sorted(set(points) - before)[:8]}")

# Rule 1: true exits are never a connection; pump wet wells are not treated as exits.
exit_conn = [s["site_id"] for s in eligible if is_exit(s["node_id"])]
check("rule 1: no connection is a true exit", not exit_conn, str(exit_conn))
exit_in_excl = [e["site_id"] for e in plan["excluded"] if is_exit(e["node_id"]) and e.get("reason") not in (None,)]
for s in eligible + dupes:
    if s["node_id"] in wet_wells:
        check(f"rule 1: wet well {s['site_id']} not labelled exit", s.get("point_kind") == "pump_wet_well", s.get("point_kind"))
mis_kind = [(sid, s.get("point_kind"), kind(s["node_id"])) for sid, s in points.items() if s.get("point_kind") != kind(s["node_id"])]
check("point kinds match independent classification", not mis_kind, str(mis_kind[:6]))

# Rule 2: land groups = chaining within radius and facing angle over ALL pre-grouping points (exits included).
R = plan["config"].get("cluster_radius_m", 300); A = plan["config"].get("cluster_angle_deg", 45)
xy = {sid: (net.nodes[s["node_id"]].x, net.nodes[s["node_id"]].y) for sid, s in points.items()}
def angdiff(a, b): return abs((a - b + 180) % 360 - 180)
parent = {sid: sid for sid in points}
def find(x):
    while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
    return x
ids = sorted(points)
for i, a in enumerate(ids):
    for b in ids[i + 1:]:
        if math.dist(xy[a], xy[b]) <= R + 1e-9 and angdiff(points[a]["open_bearing_deg"], points[b]["open_bearing_deg"]) <= A + 1e-9:
            parent[find(a)] = find(b)
groups = collections.defaultdict(list)
for sid in ids: groups[find(sid)].append(sid)
expected_groups = sorted(sorted(g) for g in groups.values())
plan_groups = sorted(sorted(g["members"]) for g in plan.get("land_groups", []))
check("rule 2: land groups match (union-find recomputation, order independent)", expected_groups == plan_groups,
      f"expected {len(expected_groups)} groups, plan has {len(plan_groups)}")

# Rule 3: one connection per distinct downstream-sensor set; pick type > room > open sector > id.
TYPE = {"manhole": 0, "junction": 0, "pipe_end": 0, "inline": 1, "pump_wet_well": 2}
room = lambda s: math.inf if s.get("headroom") is None else s["headroom"]
expected_conn = set()
for g in expected_groups:
    classes = collections.defaultdict(list)
    for sid in g:
        n = points[sid]["node_id"]
        if is_exit(n): continue
        classes[tuple(sensors_down(n))].append(sid)
    for members in classes.values():
        expected_conn.add(min(members, key=lambda s: (TYPE[kind(points[s]["node_id"])], -room(points[s]),
                                                      -points[s]["open_sector_deg"], s)))
actual_conn = {s["site_id"] for s in eligible}
check("rule 3: connections = best point of each (land group, sensor set)", expected_conn == actual_conn,
      f"missing {sorted(expected_conn - actual_conn)} extra {sorted(actual_conn - expected_conn)}")
for s in eligible:
    check(f"rule 3: {s['site_id']} sensors_downstream", s.get("sensors_downstream") == sensors_down(s["node_id"]),
          f"plan {s.get('sensors_downstream')} vs {sensors_down(s['node_id'])}")
for g in plan.get("land_groups", []):
    if all(is_exit(points[x]["node_id"]) for x in g["members"]):
        check(f"rule 2: exit-only group {g.get('land_id')} has no connection and a reason",
              not g.get("connections") and bool(g.get("no_connection_reason")))

# Rule 4: coverage reported before SWMM, recomputed.
usable = [sid for sid in points if not is_exit(points[sid]["node_id"])]
cov = plan.get("coverage", {})
exp_cov = {"usable_points": len(usable),
           "points_with_sensor_downstream": sum(1 for sid in usable if sensors_down(points[sid]["node_id"])),
           "land_groups": len(expected_groups),
           "land_groups_with_covered_connection": sum(1 for g in expected_groups
               if any(sensors_down(points[x]["node_id"]) for x in g if not is_exit(points[x]["node_id"]))),
           "sensors": sorted(sensors)}
for k, v in exp_cov.items():
    got = cov.get(k); got = sorted(got) if k == "sensors" and got else got
    check(f"rule 4: coverage.{k}", got == v, f"plan {got} vs {v}")

# Rule 6: every connection runs the steady-peak load; the pump-rate load also runs when pumped OR pump status unknown.
for s in eligible:
    want = ["pump_rate", "steady_peak"] if (s.get("pumped") or not s.get("pumped_known")) else ["steady_peak"]
    check(f"rule 6: {s['site_id']} load variants", sorted(s.get("load_variants", [])) == want,
          f"plan {s.get('load_variants')} want {want} (pumped={s.get('pumped')}, known={s.get('pumped_known')})")

# Rule 5: combined cases never exceed the room of any limiting pipe shared by the estates in them.
limit_room = {}
for s in eligible:
    if s.get("limiting_pipe") is not None:
        limit_room[s["limiting_pipe"]] = min(limit_room.get(s["limiting_pipe"], math.inf), room(s))
pipe_reach = {}
for s in eligible:
    ds = downstream(s["node_id"])
    pipe_reach[s["site_id"]] = {net.pipes[k].asset_id for k in dom if net.pipes[k].up in ds}
combos = plan.get("combined_steps", [])
check("rule 5: combined steps are listed", len(combos) > 0)
land_of = {sid: s.get("land_id") for sid, s in points.items()}
for c in combos:
    lands = [land_of.get(sid) for sid in c["homes"]]
    check(f"rule 5: combined {c.get('label')} uses at most one connection per land group",
          len(lands) == len(set(lands)) and None not in lands, str(lands))
bad = []
for c in combos:
    for pipe, r in limit_room.items():
        added = sum(h for sid, h in c["homes"].items() if pipe in pipe_reach.get(sid, set()))
        if added > r + 1e-9: bad.append((c.get("label"), pipe, added, r))
check("rule 5: no combined step overloads a shared limiting pipe", not bad, str(bad[:5]))

print(f"\n{len(fails)} FAIL" if fails else "\nALL PASS")
sys.exit(1 if fails else 0)
