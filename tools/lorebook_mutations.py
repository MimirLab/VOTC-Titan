"""Actor-owned campaign turnings over the unchanged accepted lorebook.

The host supplies a complete source-pinned current-save capture. World records
can withdraw incompatible canonical navigation; only that actor's matching
memory or an existing explicit report admits an account. No origin is relabeled
as user_reported and no source database is edited.
"""
from __future__ import annotations

import copy
from contextlib import closing
from datetime import date
import hashlib
import json
from pathlib import Path
import re
from types import SimpleNamespace


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def calendar(value):
    if not isinstance(value, dict) or not {'totalDays', 'year', 'month', 'day'} <= set(value):
        raise ValueError('Numeric mutation date required')
    if any(type(value[k]) is not int or value[k] <= 0 for k in ['totalDays', 'year', 'month', 'day']):
        raise ValueError('Invalid numeric mutation date')
    return date(value['year'], value['month'], value['day']).isoformat()


def mutation_reader(pack, context, catalogue_path=None):
    from lorebank.goa_reader import UNAVAILABLE
    from lorebook_campaign_clock import bind_campaign_clock
    from lorebook_observed import observed_reader, combined_reader

    path = Path(catalogue_path or Path(__file__).with_name('lorebook-mutation-catalogue.json'))
    raw = path.read_bytes()
    policy = json.loads(raw)
    digest = policy.pop('digest')
    if policy.get('version') != 1 or hashlib.sha256(encoded(policy).encode()).hexdigest() != digest:
        raise ValueError('Changed mutation policy')
    if policy['supplement_sha256'] != pack.manifest['files']['goa']['sha256']:
        raise ValueError('Mutation policy targets a different book')
    required = {'origin', 'campaign_id', 'timeline_id', 'actor_id', 'as_of', 'setting_sha256',
                'mutation_digest', 'acting_owner', 'clock', 'world', 'memories'}
    if not isinstance(context, dict) or not required <= set(context) or set(context) - required - {'common_context', 'reported_context'}:
        raise ValueError('Complete verified mutation context required')
    if context['origin'] != 'verified_campaign_mutations' or context['mutation_digest'] != digest:
        raise ValueError('Verified mutation provenance required')
    if any(not isinstance(context[k], str) or not context[k] or len(context[k]) > 256
           for k in ['campaign_id', 'timeline_id', 'actor_id']):
        raise ValueError('Mutation actor/campaign identity required')
    if context['setting_sha256'] != pack.manifest['files']['expanded']['sha256']:
        raise ValueError('Mutation setting edition differs')
    if calendar(context['clock']) != context['as_of']:
        raise ValueError('Mutation clocks differ')
    if context['acting_owner'] not in policy['memory_owner_policies']:
        raise ValueError('Unqualified acting identity')
    points = {p['token']: p for p in policy['points']}
    if len(points) != len(policy['points']) or not isinstance(context['world'], dict) or set(context['world']) != set(points):
        raise ValueError('Incomplete mutation world census')
    for value in context['world'].values():
        if value is not None and (type(value) is not int or not 0 < value <= context['clock']['totalDays']):
            raise ValueError('Invalid or future mutation observation')
    memories = context['memories']
    if not isinstance(memories, list) or len(memories) > 4096:
        raise ValueError('Invalid owned mutation memories')
    seen = set()
    for memory in memories:
        if not isinstance(memory, dict) or set(memory) != {'actorId', 'token', 'owner', 'date', 'ordinal'}:
            raise ValueError('Invalid owned memory receipt')
        if type(memory['actorId']) is not int or str(memory['actorId']) != context['actor_id']:
            raise ValueError('Memory belongs to another character')
        if memory['token'] not in points or memory['owner'] != context['acting_owner']:
            raise ValueError('Memory belongs to another source or acting identity')
        if type(memory['ordinal']) is not int or not 0 <= memory['ordinal'] < 4096 or memory['ordinal'] in seen:
            raise ValueError('Duplicate or invalid owned memory identity')
        seen.add(memory['ordinal'])
        if calendar(memory['date']) > context['as_of'] or memory['date']['totalDays'] > context['clock']['totalDays']:
            raise ValueError('Future character knowledge')
        world = context['world'][memory['token']]
        # CK3's script current_date and the memory datamodel's totalDays are
        # different day origins. Existence binds the current-save source token;
        # the memory's actual date above establishes knowledge timing. Never
        # guess a shared epoch or fabricate a one-day conversion here.
        if world is None:
            raise ValueError('Memory lacks a matching current-save world record')

    reported = context.get('reported_context')
    common = context.get('common_context')
    for inner in [x for x in [reported, common] if x is not None]:
        actor = inner.get('actor_id', inner.get('lore_knowledge', {}).get('actor_id'))
        if any(inner.get(key) != context[key] for key in ['campaign_id', 'timeline_id', 'as_of']) or actor != context['actor_id']:
            raise ValueError('Nested knowledge belongs to another actor, campaign or clock')
    if reported and common:
        primary = combined_reader(pack, reported, common)
    elif reported:
        primary = bind_campaign_clock(pack.reader(state=reported))
    elif common:
        primary = observed_reader(pack, common)
    else:
        def unavailable(*args, **kwargs):
            raise ValueError(UNAVAILABLE)
        primary = SimpleNamespace(reference=pack.reference, known=frozenset(), admitted=set(),
            read=unavailable, upstream=pack.reference.upstream, fingerprint='empty_actor_knowledge')

    goa = pack.reference.upstream
    branches = goa.branches
    for point in points.values():
        branch = branches.get(point['branch_id'])
        if not branch or json.loads(branch['evidence_json'])['source']['block_sha256'] != point['accepted_definition_sha256']:
            raise ValueError('Mutation branch/source binding differs')
    latest = {}
    for memory in memories:
        branch_id = points[memory['token']]['branch_id']
        if branch_id not in latest or memory['date']['totalDays'] > latest[branch_id]['date']['totalDays']:
            latest[branch_id] = memory
    active = dict(getattr(primary.upstream, 'active', {}))
    active.update({key: branches[key] for key in latest})
    affected = {}
    for branch in active.values():
        own = latest.get(branch['id'])
        entries = points[own['token']].get('entry_ids', []) if own else json.loads(branch['entry_ids_json'])
        for entry in entries:
            affected.setdefault(entry, []).append(branch)
    world_affected = set()
    for token, observed in context['world'].items():
        if observed is not None and points[token]['account_kind'] not in {'attempt', 'declaration_only'}:
            world_affected.update(points[token].get('entry_ids', []))
    if not hasattr(pack, '_mutation_base_entries'):
        with closing(pack.bundle.connect()) as db:
            pack._mutation_base_entries = {row['node_id']: json.loads(row['selector_json'])['entry_id']
                for row in db.execute("SELECT node_id,selector_json FROM passages WHERE family='base'")}
    base_entries = pack._mutation_base_entries
    subject_roots = {}
    for entry in world_affected | set(affected):
        subject_roots[goa.roots[entry]['root_id']] = entry
        expanded = pack.reference.bindings.get(entry)
        if expanded:
            subject_roots[expanded] = entry
    upstream_state = getattr(primary.upstream, 'state', None) or {'origin': context['origin'], 'choices': []}
    captured = copy.deepcopy(context)
    own_tokens = {m['token'] for m in memories}
    dependency_entries = {entry for token in own_tokens for entry in points[token].get('entry_ids', [])}
    dependencies = {token for token, point in points.items() if reported or token in own_tokens or
                    (point['account_kind'] not in {'attempt', 'declaration_only'} and
                     dependency_entries.intersection(point.get('entry_ids', [])))}
    semantic_context = {**captured, 'world': {token: captured['world'][token] for token in sorted(dependencies)}}

    class MutationReader:
        def __init__(self):
            self.reference = pack.reference
            self.known = primary.known
            self.admitted = primary.admitted
            self.policies = getattr(primary, 'policies', {})
            self.mode = 'history'
            self.state = {**captured, 'lore_knowledge': {'actor_id': captured['actor_id'], 'as_of': captured['as_of']}}
            self._state_binding = encoded(self.state)
            self.fingerprint = hashlib.sha256(encoded({'context': semantic_context, 'primary': primary.fingerprint,
                'policy': hashlib.sha256(raw).hexdigest()}).encode()).hexdigest()
            self.upstream = SimpleNamespace(mode='history', state=upstream_state, active=active, affected=affected,
                base=primary.upstream.base, _entry=goa._entry)
            with goa.connect() as db:
                self.nodes = {row['id']: dict(row) for row in db.execute('SELECT * FROM nodes')}
        def _current(self):
            if encoded(self.state) != self._state_binding:
                raise ValueError('Mutation context changed; restart the reader')
            if hasattr(primary, '_check_context'):
                primary._check_context()
        def _withheld(self, node):
            return base_entries.get(node) in world_affected
        def _render(self, node):
            memory = latest.get(node['branch_id'])
            if not memory:
                return node
            point = points[memory['token']]
            override = point.get('node_overrides', {}).get(node['id'])
            if not override:
                return node
            accepted = hashlib.sha256(node['text'].encode()).hexdigest()
            if override['accepted_sha256'] != accepted or point.get('accepted_node_sha256', {}).get(node['id']) != accepted:
                raise ValueError('Contextual account differs from its accepted source template')
            if point['node_sha256'].get(node['id']) != hashlib.sha256(override['text'].encode()).hexdigest():
                raise ValueError('Contextual account body changed')
            return {**node, 'text': override['text'], 'title': override['title']}
        def _position(self, cursor, binding):
            return self.reference.__class__.position(self, cursor, binding)
        def _cursor(self, offset, binding):
            return self.reference.__class__.cursor(self, offset, binding)
        def read(self, node_id, cursor=None):
            self._current()
            if node_id in self.nodes:
                row = self._render(self.nodes[node_id])
                if row['branch_id'] and row['branch_id'] not in active:
                    raise ValueError(UNAVAILABLE)
                children = [n for n in self.nodes.values() if n['parent_id'] == node_id and
                    (n['branch_id'] in active if n['branch_id'] else any(b['family'] == n['id'].split(':')[-1] for b in active.values()))]
                children.sort(key=lambda n: (n['position'], n['id']))
                children = [self._render(child) for child in children]
                if not row['branch_id'] and not children:
                    raise ValueError(UNAVAILABLE)
                binding = 'mutation:' + node_id
                offset = self._position(cursor, binding)
                parent = self.nodes.get(row['parent_id'])
                return dict(node_id=node_id, title=row['title'], text=row['text'],
                    parent={'node_id': parent['id'], 'title': parent['title']} if parent else None,
                    children=[{'node_id': n['id'], 'title': n['title'], 'teaser': n['text'][:180]} for n in children[offset:offset + 10]],
                    related=[], next_cursor=self._cursor(offset + 10, binding) if len(children) > offset + 10 else None)
            entry = subject_roots.get(node_id)
            if entry and (entry in affected or entry in world_affected):
                children = []
                try:
                    prior = primary.read(node_id)
                    children = [n for n in prior['children'] if not self._withheld(n['node_id'])]
                except ValueError:
                    pass
                own = affected.get(entry, [])
                own = sorted(own, key=lambda b: latest.get(b['id'], {}).get('date', {}).get('totalDays', 0), reverse=True)
                children = [{'node_id': b['id'], 'title': points[latest[b['id']]['token']]['title'] if b['id'] in latest else b['title'], 'teaser': ''} for b in own] + children
                children = list({n['node_id']: n for n in children}.values())
                if not children:
                    raise ValueError(UNAVAILABLE)
                binding = 'mutation-subject:' + node_id
                offset = self._position(cursor, binding)
                return dict(node_id=node_id, title=goa.roots[entry]['title'],
                    text='The following accounts preserve the turnings and traditions known of this subject.', parent=None,
                    children=children[offset:offset + 10], related=[],
                    next_cursor=self._cursor(offset + 10, binding) if len(children) > offset + 10 else None)
            if self._withheld(node_id):
                raise ValueError(UNAVAILABLE)
            result = copy.deepcopy(primary.read(node_id, cursor))
            result['children'] = [n for n in result['children'] if not self._withheld(n['node_id'])]
            result['related'] = [n for n in result['related'] if not self._withheld(n['node_id'])]
            return result

        def named_subjects(self, query):
            return primary.named_subjects(query) if hasattr(primary, 'named_subjects') else []

        def observed_turning(self, node_id, text):
            node = self.nodes.get(node_id)
            if not node or node['branch_id'] not in latest:
                return None
            memory = latest[node['branch_id']]
            point = points[memory['token']]
            if point.get('node_sha256', {}).get(node_id) != hashlib.sha256(text.encode()).hexdigest():
                raise ValueError('Observed account body differs from its accepted node binding')
            return dict(kind='verified_character_turning', node_id=node_id, branch_id=node['branch_id'], token=point['token'],
                actor_id=captured['actor_id'], owner=captured['acting_owner'],
                occurred_at=calendar(memory['date']), account_kind=point['account_kind'],
                phase=point['phase'], accepted_definition_sha256=point['accepted_definition_sha256'],
                execution_definition_sha256=point['definition_sha256'],
                body_sha256=hashlib.sha256(text.encode()).hexdigest())

        def candidate_ids(self, query):
            # A bounded lexical search of already-known turnings prevents the
            # much larger base corpus from crowding them out of candidate slots.
            # These remain candidates: the unchanged resolver still admits them.
            stop = {'the', 'and', 'you', 'your', 'our', 'was', 'were', 'what', 'when', 'where',
                    'how', 'why', 'tell', 'about', 'have', 'has', 'this', 'that', 'with', 'for'}
            terms = [t for t in re.findall(r'\w+', query)[:40] if len(t) > 2 and t.casefold() not in stop]
            if not terms:
                return []
            expression = ' OR '.join('"' + t + '"*' for t in terms)
            with goa.connect() as db:
                matches = [row[0] for row in db.execute('SELECT node_id FROM search WHERE search MATCH ? ORDER BY rank LIMIT 100', (expression,))]
            matches = [node for node in matches if node in active]
            with closing(pack.bundle.connect()) as db:
                result = []
                for node in matches[:10]:
                    result.extend(row[0] for row in db.execute("SELECT id FROM passages WHERE family='goa' AND node_id=? ORDER BY id LIMIT 1", (node,)))
            inherited = primary.candidate_ids(query) if hasattr(primary, 'candidate_ids') else []
            return list(dict.fromkeys(result + inherited))

        def named_turnings(self, query):
            # Exact names of this actor's admitted accounts take precedence
            # over shorter ordinary-word aliases (e.g. a paladin's "hammer"
            # must not redirect his whole turning to an unrelated weapon).
            def normal(value):
                return ' '.join(re.findall(r'\w+', value.casefold()))
            haystack = ' ' + normal(query) + ' '
            return [branch for branch, memory in latest.items()
                    if ' ' + normal(points[memory['token']]['title']) + ' ' in haystack][:2]

        def turning_entry_ids(self, branch_id):
            memory = latest.get(branch_id)
            return points[memory['token']].get('entry_ids', []) if memory else json.loads(branches[branch_id]['entry_ids_json'])

    return MutationReader()
