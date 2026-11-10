"""Read current-save traces through stock CE; no event hooks or synthetic memories."""
from contextlib import closing
import copy
from datetime import date
import hashlib
import json
from pathlib import Path
import re
from types import SimpleNamespace


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def game_state_reader(pack, context, catalogue_path=None):
    from lorebank.goa_reader import UNAVAILABLE
    from lorebook_campaign_clock import bind_campaign_clock
    from lorebook_observed import observed_reader
    policy = json.loads(Path(catalogue_path or Path(__file__).with_name('lorebook-game-state-catalogue.json')).read_text())
    digest = policy.pop('digest')
    if policy['format'] != 'titan_lore_game_state_v1' or hashlib.sha256(encoded(policy).encode()).hexdigest() != digest:
        raise ValueError('Changed current-state policy')
    required = {'origin', 'campaign_id', 'timeline_id', 'actor_id', 'as_of', 'setting_sha256',
                'current_state_digest', 'acting_owner', 'observed_actor_id', 'clock', 'values'}
    if not isinstance(context, dict) or not required <= set(context) or set(context) - required - {'common_context', 'reported_context'}:
        raise ValueError('Incomplete current-state context')
    if context['origin'] != 'verified_current_game_state' or context['current_state_digest'] != digest:
        raise ValueError('Current-state origin or edition differs')
    if context['observed_actor_id'] != context['actor_id']:
        raise ValueError('Current-state capture belongs to another character')
    if any(not isinstance(context[k], str) or not context[k] or len(context[k]) > 256
           for k in ['campaign_id', 'timeline_id', 'actor_id']):
        raise ValueError('Current-state actor and campaign required')
    if context['acting_owner'] not in {'ordinary', 'fallen'} or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', context['as_of']):
        raise ValueError('Invalid current-state owner or clock')
    clock = context['clock']
    if set(clock) != {'totalDays', 'year', 'month', 'day'} or any(type(v) is not int or v <= 0 for v in clock.values()) or \
            date(clock['year'], clock['month'], clock['day']).isoformat() != context['as_of']:
        raise ValueError('Current-state numeric clock differs')
    rules = {rule['id']: rule for rule in policy['rules']}
    if set(context['values']) != set(rules) or any(v is not None and type(v) is not bool for v in context['values'].values()):
        raise ValueError('Incomplete current-state census')
    groups = {}
    for rule in rules.values():
        if rule.get('exclusive_group') and context['values'][rule['id']] is True:
            group = rule['exclusive_group']
            groups[group] = groups.get(group, 0) + 1
    if any(count > 1 for count in groups.values()):
        raise ValueError('Contradictory current-state values')
    reported, common = context.get('reported_context'), context.get('common_context')
    for nested in [x for x in [reported, common] if x is not None]:
        actor = nested.get('actor_id', nested.get('lore_knowledge', {}).get('actor_id'))
        if any(nested.get(k) != context[k] for k in ['campaign_id', 'timeline_id', 'as_of']) or actor != context['actor_id']:
            raise ValueError('Current-state knowledge belongs to another context')
    if reported:
        primary = bind_campaign_clock(pack.reader(state=reported))
    elif common:
        primary = observed_reader(pack, common)
    else:
        def unavailable(*args, **kwargs):
            raise ValueError(UNAVAILABLE)
        primary = SimpleNamespace(reference=pack.reference, known=frozenset(), admitted=set(), read=unavailable,
                                  upstream=pack.reference.upstream, fingerprint='empty_actor_knowledge')
    if context['setting_sha256'] != pack.manifest['files']['expanded']['sha256']:
        raise ValueError('Current-state setting edition differs')
    goa = pack.reference.upstream
    owned = {}
    for key, rule in rules.items():
        account = rule.get('account')
        if not account:
            continue  # World status never manufactures personal awareness.
        if account['awareness'] != 'same_actor_persistent_trace' or account['occurred_at_known'] is not False or \
                not rule['predicate']['kind'].startswith('actor_'):
            raise ValueError('Invalid private trace policy')
        branch = goa.branches[account['branch_id']]
        if json.loads(branch['evidence_json'])['source']['block_sha256'] != account['accepted_definition_sha256']:
            raise ValueError('Current-state account source differs')
        if context['acting_owner'] == 'ordinary' and context['values'][key] is True:
            owned[account['branch_id']] = rule
    active = dict(getattr(primary.upstream, 'active', {}))
    active.update({branch: goa.branches[branch] for branch in owned})
    affected = {}
    for branch_id, branch in active.items():
        for entry in json.loads(branch['entry_ids_json']):
            affected.setdefault(entry, []).append(branch)
    roots = {}
    for entry in affected:
        roots[goa.roots[entry]['root_id']] = entry
        expanded = pack.reference.bindings.get(entry)
        if expanded:
            roots[expanded] = entry
    captured = copy.deepcopy(context)
    semantic = {**captured, 'values': {key: captured['values'][key] for key, rule in rules.items() if 'account' in rule}}

    class CurrentStateReader:
        def __init__(self):
            self.reference = pack.reference
            self.known, self.admitted = primary.known, primary.admitted
            self.mode = 'history'
            self.policies = getattr(primary, 'policies', {})
            self.state = {**captured, 'lore_knowledge': {'actor_id': captured['actor_id'], 'as_of': captured['as_of']}}
            self._binding = encoded(self.state)
            self.fingerprint = hashlib.sha256(encoded({'context': semantic, 'primary': primary.fingerprint}).encode()).hexdigest()
            self.upstream = SimpleNamespace(mode='history', state=getattr(primary.upstream, 'state', None) or {'origin': captured['origin'], 'choices': []},
                active=active, affected=affected, base=primary.upstream.base, _entry=goa._entry)
            with goa.connect() as db:
                self.nodes = {r['id']: dict(r) for r in db.execute('SELECT * FROM nodes')}

        def _current(self):
            if encoded(self.state) != self._binding:
                raise ValueError('Current-state context changed')
            if hasattr(primary, '_check_context'):
                primary._check_context()

        def _position(self, cursor, binding):
            return self.reference.__class__.position(self, cursor, binding)

        def _cursor(self, offset, binding):
            return self.reference.__class__.cursor(self, offset, binding)

        def read(self, node_id, cursor=None):
            self._current()
            if node_id in self.nodes:
                row = self.nodes[node_id]
                if row['branch_id'] and row['branch_id'] not in active:
                    raise ValueError(UNAVAILABLE)
                children = [n for n in self.nodes.values() if n['parent_id'] == node_id and
                    (n['branch_id'] in active if n['branch_id'] else any(b['family'] == n['id'].split(':')[-1] for b in active.values()))]
                children.sort(key=lambda n: (n['position'], n['id']))
                if not row['branch_id'] and not children:
                    raise ValueError(UNAVAILABLE)
                binding = 'current-state:' + node_id
                offset = self._position(cursor, binding)
                parent = self.nodes.get(row['parent_id'])
                return dict(node_id=node_id, title=row['title'], text=row['text'],
                    parent={'node_id': parent['id'], 'title': parent['title']} if parent else None,
                    children=[{'node_id': n['id'], 'title': n['title'], 'teaser': n['text'][:180]} for n in children[offset:offset + 10]],
                    related=[], next_cursor=self._cursor(offset + 10, binding) if len(children) > offset + 10 else None)
            if node_id in roots:
                entry = roots[node_id]
                try:
                    prior = copy.deepcopy(primary.read(node_id))
                except ValueError:
                    prior = dict(node_id=node_id, title=goa.roots[entry]['title'], text='Accounts known of this subject.', parent=None, related=[])
                own_children = [{'node_id': b['id'], 'title': b['title'], 'teaser': ''} for b in affected[entry]]
                children = list({n['node_id']: n for n in own_children + prior.get('children', [])}.values())
                binding = 'current-state-subject:' + node_id
                offset = self._position(cursor, binding)
                prior.update(children=children[offset:offset + 10], next_cursor=self._cursor(offset + 10, binding) if len(children) > offset + 10 else None)
                return prior
            return copy.deepcopy(primary.read(node_id, cursor))

        def observed_turning(self, node_id, text):
            node = self.nodes.get(node_id)
            rule = node and owned.get(node['branch_id'])
            if not rule:
                return None
            account = rule['account']
            body = hashlib.sha256(text.encode()).hexdigest()
            if account['node_sha256'].get(node_id) != body:
                raise ValueError('Current-state account body differs')
            return dict(kind='verified_current_state_trace', node_id=node_id, branch_id=node['branch_id'], rule_id=rule['id'],
                actor_id=captured['actor_id'], observed_at=captured['as_of'], occurred_at=None,
                accepted_definition_sha256=account['accepted_definition_sha256'], body_sha256=body)

        def candidate_ids(self, query):
            terms = [t for t in re.findall(r'\w+', query)[:40] if len(t) > 2]
            if not terms:
                return []
            expression = ' OR '.join('"' + t + '"*' for t in terms)
            with goa.connect() as db:
                matches = [r[0] for r in db.execute('SELECT node_id FROM search WHERE search MATCH ? ORDER BY rank LIMIT 100', (expression,))]
            with closing(pack.bundle.connect()) as db:
                return [r[0] for node in matches if node in active for r in db.execute(
                    "SELECT id FROM passages WHERE family='goa' AND node_id=? ORDER BY id LIMIT 1", (node,))][:10]

        def named_turnings(self, query):
            normal = lambda text: ' '.join(re.findall(r'\w+', text.casefold()))
            haystack = ' ' + normal(query) + ' '
            return [branch for branch, rule in owned.items() if ' ' + normal(rule['account']['title']) + ' ' in haystack][:2]

        def turning_entry_ids(self, branch_id):
            return json.loads(goa.branches[branch_id]['entry_ids_json'])

    return CurrentStateReader()
