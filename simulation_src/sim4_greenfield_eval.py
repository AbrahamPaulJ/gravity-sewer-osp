#!/usr/bin/env python3
"""Score saved Sim4 estate runs. Pure scoring functions; no SWMM or optimiser."""
from collections import defaultdict
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = HERE / 'results/sim4/greenfield'
RULES = (10, 25, 50)
CONTINUITY_LIMIT_PCT = 1.0


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def read_js(path):
    text = Path(path).read_text(encoding='utf-8')
    return json.loads(text[text.index('{'):text.rindex('}') + 1])


def name(mh):
    return str(mh) if str(mh).startswith('MH') else 'MH' + str(mh)


def invalid_run(run):
    """Missing provenance is not a settled run. Signed continuity errors use abs."""
    if not run or run.get('failed') or run.get('error') or run.get('status') == 'failed':
        return 'failed or missing run provenance'
    if run.get('converged') is not True:
        return 'did not settle/converge'
    error = run.get('continuity_err_pct')
    if not isinstance(error, (int, float)) or not math.isfinite(error):
        return 'missing or invalid continuity error'
    if abs(error) > CONTINUITY_LIMIT_PCT:
        return f'continuity error exceeds {CONTINUITY_LIMIT_PCT:g}%'
    return None


def valid_rows(summary, case_tag):
    """Reject a whole case on baseline failure, and individual invalid growth runs."""
    baseline = summary.get('baseline', {})
    baseline_run = baseline.get('run', summary.get('run_length', {}).get('baseline'))
    reason = invalid_run(baseline if baseline.get('failed') or baseline.get('error') or
                         baseline.get('status') == 'failed' else baseline_run)
    if summary.get('failed') or summary.get('error') or summary.get('status') == 'failed':
        reason = 'case failed'
    if reason:
        return [], [{'case': case_tag, 'site': None, 'homes': 0,
                     'scope': 'entire case', 'reason': 'baseline: ' + reason,
                     'excluded_growth_runs': len(summary.get('rows', []))}]
    valid, excluded = [], []
    for row in summary.get('rows', []):
        reason = invalid_run(row if row.get('failed') or row.get('error') or
                             row.get('status') == 'failed' else row.get('run'))
        if reason:
            excluded.append({'case': case_tag, 'site': row.get('site', row.get('region')),
                             'homes': row.get('dwellings'), 'scope': 'growth run', 'reason': reason})
        else:
            valid.append(row)
    return valid, excluded


def response_type(detected, sensors_downstream):
    if not detected:
        return None
    return 'direct' if set(detected).intersection(sensors_downstream) else 'indirect'


def evaluate_row(raw, ladder, sensors_downstream=(), chosen_k=None, baseline=None):
    """Label the recommended sensors at 10 mm, with a label at each threshold too."""
    rises = {name(mh): v for mh, v in raw['rise_mm'].items()}
    detected = {str(rule): {str(k): [s for s in chosen if rises.get(s, 0) >= rule]
                            for k, chosen in ladder.items()} for rule in RULES}
    detectable = {str(rule): any(v >= rule for v in rises.values()) for rule in RULES}
    chosen_k = str(chosen_k) if chosen_k is not None else next(iter(ladder))
    responses = {str(rule): response_type(detected[str(rule)][chosen_k], sensors_downstream)
                 for rule in RULES}
    return {'response_type': responses[str(min(RULES))], 'response_types': responses,
            'baseline_absolute_surcharge_count': (len(baseline['surcharged'])
                if baseline is not None and 'surcharged' in baseline else None),
            'homes': raw['dwellings'], 'added_lps': raw['added_lps'],
            'detected': detected, 'detectable': detectable, 'rise_mm': rises,
            'surcharge': [name(m) for m in raw.get('surcharge', [])],
            'flooded': [name(m) for m in raw.get('spilled', [])],
            'absolute_surcharged': [name(m) for m in raw.get('surcharged', [])],
            'absolute_flooded': [name(m) for m in raw.get('flooded', [])],
            'run': raw['run'], 'estate_dwellings': raw.get('estate_dwellings')}


def miss_class(row, rule, chosen_k):
    if row['detected'][str(rule)][str(chosen_k)]:
        return None
    return ('response missed by the chosen sensors' if row['detectable'][str(rule)]
            else 'no response anywhere')


def site_weighted_score(groups, rule, chosen_k):
    """Each site has unit weight; each valid size has 1/n of that site's weight.

    Detectable coverage conditions that same weighted population on a response
    at this threshold. No-response sites remain in all-scenario coverage.
    """
    groups = {site: rows for site, rows in groups.items() if rows}
    seen_weight = detectable_weight = 0.
    seen = total = detectable = 0
    misses = defaultdict(int)
    for rows in groups.values():
        for row in rows:
            hit = bool(row['detected'][str(rule)][str(chosen_k)])
            can = row['detectable'][str(rule)]
            seen += hit
            total += 1
            detectable += can
            seen_weight += hit / len(rows)
            detectable_weight += can / len(rows)
            miss = miss_class(row, rule, chosen_k)
            if miss:
                misses[miss] += 1
    return {'seen': seen, 'total': total, 'site_count': len(groups),
            'share': seen_weight / len(groups) if groups else None,
            'detectable_total': detectable, 'detectable_site_weight': detectable_weight,
            'share_of_detectable': seen_weight / detectable_weight if detectable_weight else None,
            'misses': dict(misses)}


def mark_before_surcharge(rows, chosen_k):
    """At-or-below includes the tested surcharge step; it is not a time claim."""
    ordered = sorted(rows, key=lambda r: r['homes'])
    first = next((r['homes'] for r in ordered if r['surcharge'] or r['flooded']), None)
    for row in ordered:
        row['first_new_surcharge_or_flooding_homes'] = first
        row['before_surcharge'] = {
            str(rule): ('no surcharge in range' if first is None else
                        'yes' if any(r['homes'] <= min(first, row['homes']) and
                                     r['detected'][str(rule)][str(chosen_k)] for r in ordered)
                        else 'no') for rule in RULES}
        row['miss'] = {str(rule): miss_class(row, rule, chosen_k) for rule in RULES}
    return first


def match_infill(estate, infill, tolerance=.10):
    """Match added peak L/s, within 10% of the estate flow; no extrapolation."""
    flow = estate['added_lps']
    if not flow or not math.isfinite(flow):
        return None
    matches = [r for r in infill if abs(r['added_lps'] - flow) / flow <= tolerance + 1e-12]
    return min(matches, key=lambda r: (abs(r['added_lps'] - flow), r['homes'])) if matches else None


def scores(groups, chosen_k):
    return {str(rule): site_weighted_score(groups, rule, chosen_k) for rule in RULES}


def main():
    plan = read(OUT / 'plan.json')
    numbers = read(HERE / 'results/sim4/numbers.json')
    regions = read_js(ROOT / 'simulation4/data/regions.js')
    chambers = read_js(ROOT / 'simulation3/data/growth.js')['chambers']
    ladder = {str(r['k']): r['chosen'] for r in numbers['ladder'] if 1 <= r['k'] <= 8}
    chosen_k = str(numbers['recommend'])
    sites = plan['eligible']
    excluded, missing, summaries, available = [], [], {}, {}
    for case in plan['cases']:
        tag = case['tag']
        path = OUT / tag / 'summary.json'
        if not path.exists():
            missing.append(tag)
            continue
        summary = summaries[tag] = read(path)
        valid, rejected = valid_rows(summary, tag)
        excluded += rejected
        # Saved checkpoints must describe the current representatives and ladders.
        saved_sites = summary.get('sites', [])
        sites_match = bool(saved_sites) and all(s in sites for s in saved_sites)
        if case.get('variant') in ('together', 'with_infill'):
            sites_match = saved_sites == sites
        if (summary.get('greenfield_config') != plan['config'] or
                not sites_match or summary.get('case_spec') != case):
            excluded.append({'case': tag, 'scope': 'entire case', 'site': None, 'homes': None,
                             'reason': 'checkpoint does not match current plan; rerun required'})
            valid = []
        available[tag] = valid

    # Baseline provenance is carried per case, not in the packed base object.
    infill, infill_excluded = {}, []
    for case in regions['cases']:
        tag = case['tag']
        reason = invalid_run(case.get('settle', {}).get('baseline'))
        infill[tag] = defaultdict(list)
        if reason:
            infill_excluded.append({'case': tag, 'scope': 'entire infill case', 'reason': 'baseline: ' + reason})
            continue
        for raw in regions['rows'].get(tag, []):
            reason = invalid_run(raw.get('run'))
            if reason:
                infill_excluded.append({'case': tag, 'region': raw['r'], 'homes': raw['dw'], 'reason': reason})
                continue
            converted = {'dwellings': raw['dw'], 'added_lps': raw['lps'],
                         'rise_mm': {chambers[i]: v for i, v in raw['rise']},
                         'surcharge': [chambers[i] for i in raw['sur']],
                         'spilled': [chambers[i] for i in raw['spill']], 'run': raw['run']}
            infill[tag][raw['r']].append(evaluate_row(converted, ladder, chosen_k=chosen_k))

    output = []
    for site in sites:
        mh = site['manhole_id']
        site_id = site.get('site_id', name(mh))
        regidx = next((i for i, r in enumerate(regions['regions'])
                       if not r.get('overlay') and (r['id'] == site.get('region') or
                           (name(mh) in chambers and chambers.index(name(mh)) in r['manholes']))), None)
        record = {'id': site_id, 'manhole_id': mh, 'steps': site['steps'],
                  'edge_stretch': site.get('edge_stretch', mh),
                  'connection_class': site['connection_class'], 'region': regions['regions'][regidx]['id'] if regidx is not None else site.get('region'),
                  'cases': {}}
        for case in plan['cases']:
            if case.get('variant', 'primary') not in ('primary', 'pumprate'):
                continue
            tag = case['tag']
            raw_rows = {r['dwellings']: r for r in available.get(tag, []) if r.get('site') in (site_id, mh)}
            rows = []
            for homes in site['steps']:
                raw = raw_rows.get(homes)
                gf = evaluate_row(raw, ladder, site.get('sensors_downstream', []), chosen_k,
                                  summaries.get(tag, {}).get('baseline')) if raw else None
                match = match_infill(gf, infill.get(tag, {}).get(regidx, [])) if gf else None
                rows.append({'homes': homes, 'greenfield': gf, 'infill': match,
                             'infill_match': 'matched within 10% added peak flow' if match else 'unmatched'})
            ran = [r['greenfield'] for r in rows if r['greenfield']]
            first = mark_before_surcharge(ran, chosen_k)
            record['cases'][tag] = {'status': 'complete' if len(ran) == len(rows) else 'partial' if ran else 'no valid runs',
                                    'available_steps': len(ran), 'rows': rows,
                                    'first_new_surcharge_or_flooding_homes': first}
        output.append(record)

    headlines, extra_cases = {}, {}
    for case in plan['cases']:
        tag = case['tag']
        variant = case.get('variant', 'primary')
        if variant in ('together', 'with_infill'):
            combined = [evaluate_row(raw, ladder,
                sorted({sensor for s in sites if s.get('site_id', name(s['manhole_id']))
                        in (raw.get('estate_dwellings') or {}) for sensor in s.get('sensors_downstream', [])}),
                chosen_k, summaries.get(tag, {}).get('baseline')) for raw in available.get(tag, [])]
            mark_before_surcharge(combined, chosen_k)
            extra_cases[tag] = {'variant': variant, 'rows': combined,
                                'rules': scores({'combined estates': combined}, chosen_k),
                                'baseline': summaries.get(tag, {}).get('baseline')}
            continue
        groups = {s['id']: [r['greenfield'] for r in s['cases'][tag]['rows'] if r['greenfield']] for s in output}
        matched_gf = {s['id']: [r['greenfield'] for r in s['cases'][tag]['rows']
                               if r['greenfield'] and r['infill']] for s in output}
        matched_infill = {s['id']: [r['infill'] for r in s['cases'][tag]['rows']
                                   if r['greenfield'] and r['infill']] for s in output}
        headline = {'rules': scores(groups, chosen_k),
                    'hits_by_response_type': {str(rule): {
                        kind: sum(r['response_types'][str(rule)] == kind for rows in groups.values() for r in rows)
                        for kind in ('direct', 'indirect')} for rule in RULES},
                    'by_connection_class': {cl: scores({s['id']: groups[s['id']] for s in output
                                                        if s['connection_class'] == cl}, chosen_k)
                                            for cl in ('reticulation', 'trunk')},
                    'matched_pairs_only': {'greenfield': scores(matched_gf, chosen_k),
                                           'infill': scores(matched_infill, chosen_k)},
                    'unmatched_pairs': sum(1 for s in output for r in s['cases'][tag]['rows']
                                           if r['greenfield'] and not r['infill']),
                    'baseline': summaries.get(tag, {}).get('baseline')}
        (headlines if variant == 'primary' else extra_cases)[tag] = headline

    result = {'recommend': numbers['recommend'], 'sensors': ladder[chosen_k], 'ladder': ladder,
              'rules_mm': list(RULES), 'response_type_rule_mm': min(RULES), 'headlines': headlines, 'extra_cases': extra_cases,
              'sites': output, 'excluded_runs': excluded, 'excluded_infill_runs': infill_excluded,
              'missing_cases': missing, 'continuity_limit_pct': CONTINUITY_LIMIT_PCT,
              'missing_sizes': [{'case': c['tag'], 'site': s.get('site_id', name(s['manhole_id'])), 'homes': n}
                                for c in plan['cases'] if c.get('variant', 'primary') in ('primary', 'pumprate')
                                for s in sites for n in s['steps']
                                if not any(r.get('site') in (s.get('site_id', name(s['manhole_id'])), s['manhole_id']) and r.get('dwellings') == n
                                           for r in summaries.get(c['tag'], {}).get('rows', []))],
              'scoring': 'Each edge representative has equal weight; valid size steps are averaged within it. Detectable coverage conditions the same weighted population on any manhole rise at the stated threshold. Invalid runs and failed-baseline cases have zero contribution. Partial sites use available valid sizes only.',
              'comparison': 'Only added peak flows within 10% are paired. Unmatched rows enter no paired percentage. Reused infill rows are comparisons for distinct estate scenarios, not independent infill evidence.',
              'surcharge_note': 'Before surcharge means detection at or below the smallest tested size with NEW chamber surcharge OR flooding. A yes at the same size is not demonstrated advance warning in time. Invalid and untested sizes cannot establish onset; no surcharge in range refers only to valid tested sizes.',
              'limits': plan['data_notes']}
    (OUT / 'eval.json').write_text(json.dumps(result, indent=1, allow_nan=False) + '\n')
    lines = ['Sim 4: fixed infill sensors noticing imaginary edge growth', ', '.join(ladder[chosen_k]),
             'Thresholds: 10, 25, 50 mm.', result['scoring'], result['comparison'], result['surcharge_note'],
             'Missing cases: ' + (', '.join(missing) or 'none'),
             f'Excluded runs/cases: {len(excluded)}; infill exclusions: {len(infill_excluded)}.']
    for item in excluded + infill_excluded:
        lines.append('Excluded: ' + json.dumps(item))

    def percent(value):
        return f'{value:.1%}' if value is not None else 'no valid scenarios'

    def print_scores(label, rules):
        for rule, score in rules.items():
            lines.append(f"{label} / {rule} mm: all {percent(score['share'])}; detectable {percent(score['share_of_detectable'])}; {score['site_count']} stretches, {score['total']} valid scenarios; misses {score['misses']}.")

    for tag, headline in headlines.items():
        print_scores(tag, headline['rules'])
        for cl, rules in headline['by_connection_class'].items():
            print_scores('  ' + cl, rules)
        for family, rules in headline['matched_pairs_only'].items():
            print_scores('  matched ' + family, rules)
        lines.append(f"  Hits by response type: {headline['hits_by_response_type']}")
        lines.append(f"  Unmatched pairs: {headline['unmatched_pairs']}")
    lines += ['', 'Separate brackets (excluded from primary headlines):']
    for tag, extra in extra_cases.items():
        print_scores(tag, extra['rules'])
        for row in extra.get('rows', []):
            lines.append(f"  +{row['homes']} each: {row['added_lps']:g} L/s; before surcharge {row['before_surcharge']}")
    lines += ['', 'Site-size results:']
    for site in output:
        for tag, case in site['cases'].items():
            for pair in case['rows']:
                row = pair['greenfield']
                if row:
                    lines.append(f"{site['id']} / {site['connection_class']} / {tag} / +{row['homes']}: before surcharge {row['before_surcharge']}; misses {row['miss']}; {pair['infill_match']}; new surcharge {row['surcharge']}, new flooding {row['flooded']}.")
    lines += ['', 'Limits:'] + plan['data_notes']
    report = '\n'.join(lines) + '\n'
    (OUT / 'eval_report.txt').write_text(report)
    print(report, end='')


if __name__ == '__main__':
    main()
