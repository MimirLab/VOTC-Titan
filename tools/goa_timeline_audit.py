"""Source-linked inventory of GoA script mutations and existing book coverage.

This is static evidence, not a CK3 interpreter or proof that an event happened.
It preserves executable versus preview/condition contexts, exact source hashes,
option positions, deferred calls, and unresolved external script dependencies.
"""
from __future__ import annotations
import argparse
import bisect
from collections import Counter
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import sqlite3

TOKEN = re.compile(r'\s+|\ufeff|#[^\r\n]*|"(?:\\.|[^"\\])*"|[{}]|[<>!?]?=|[<>]|[^\s{}=<>!?"#]+')
OP = re.compile(r'^(?:[<>!?]?=|[<>])$')
EVENT = re.compile(r'^[A-Za-z_][\w]*\.[\w]+$')
PREVIEW = {'show_as_tooltip', 'show_as_unavailable'}
CONDITION = {'trigger', 'limit', 'potential', 'is_shown', 'is_valid', 'is_valid_showing_failures_only',
             'ai_potential', 'ai_will_do', 'ai_chance', 'weight_multiplier', 'triggered_desc',
             'desc', 'title', 'left_portrait', 'right_portrait', 'lower_left_portrait',
             'lower_right_portrait', 'override_background', 'illustration'}
ENTRY = {'immediate', 'after', 'option', 'on_trigger_fail', 'effect', 'hidden_effect',
         'on_start', 'on_end', 'on_complete', 'on_success', 'on_failure', 'on_invalidated',
         'on_invalidated_cleanup', 'on_join', 'on_leave', 'on_creation', 'on_destroy',
         'on_monthly', 'on_yearly', 'on_weekly', 'on_travel_end', 'on_arrival', 'on_owner_death'}
MARKERS = {'following_lore_path_effect', 'following_alternate_path_effect'}
MUTATIONS = {
    'set_global_variable': 'world_state', 'remove_global_variable': 'world_state',
    'change_global_variable': 'world_state', 'add_to_global_variable_list': 'world_state',
    'remove_from_global_variable_list': 'world_state', 'clear_global_variable_list': 'world_state',
    'set_variable': 'scoped_state', 'remove_variable': 'scoped_state', 'change_variable': 'scoped_state',
    'add_to_variable_list': 'scoped_state', 'remove_from_variable_list': 'scoped_state',
    'add_character_flag': 'scoped_state', 'remove_character_flag': 'scoped_state',
    'death': 'character_life', 'kill_character': 'character_life', 'override_death_effect': 'character_life',
    'create_character': 'character_life', 'create_story': 'story_state', 'end_story': 'story_state',
    'add_trait': 'character_state', 'remove_trait': 'character_state', 'set_immortal_age': 'character_state',
    'add_character_modifier': 'character_state', 'remove_character_modifier': 'character_state',
    'change_culture': 'culture_faith', 'set_culture': 'culture_faith', 'set_county_culture': 'culture_faith',
    'set_character_faith': 'culture_faith', 'set_character_faith_with_conversion': 'culture_faith',
    'set_county_faith': 'culture_faith', 'set_religion': 'culture_faith', 'create_faith': 'culture_faith',
    'change_government': 'political_state', 'set_de_jure_liege': 'political_state',
    'change_title_holder': 'political_state', 'destroy_landed_title': 'political_state',
    'create_dynamic_title': 'political_state', 'set_title_name': 'political_state',
    'set_title_prefix': 'political_state', 'set_capital_county': 'political_state',
    'set_father': 'family_identity', 'set_real_father': 'family_identity', 'set_mother': 'family_identity',
    'set_name': 'family_identity', 'set_dynasty': 'family_identity', 'set_house': 'family_identity',
    'set_to_lowborn': 'family_identity', 'start_war': 'war', 'end_war': 'war',
    'add_province_modifier': 'place_state', 'remove_province_modifier': 'place_state',
    'add_county_modifier': 'place_state', 'remove_county_modifier': 'place_state',
    'destroy_building': 'place_state', 'add_building': 'place_state', 'set_holding_type': 'place_state',
    'create_epidemic': 'epidemic', 'spawn_army': 'army', 'raise_all_levies': 'army',
}


def encoded(value): return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
def sha(value): return hashlib.sha256(value.encode()).hexdigest()


@dataclass(slots=True)
class Node:
    key: str | None
    operator: str | None
    value: str | list['Node']
    start: int
    end: int
    line: int
    end_line: int


def scalar(token):
    return re.sub(r'\\(["\\])', r'\1', token[1:-1]) if token.startswith('"') else token


def parse(source: str) -> list[Node]:
    newlines = [m.start() for m in re.finditer('\n', source)]
    tokens = []
    position = 0
    for match in TOKEN.finditer(source):
        if match.start() != position: raise ValueError(f'Unsupported syntax at line {bisect.bisect_left(newlines, position)+1}')
        position = match.end()
        text = match[0]
        if text[0].isspace() or text[0] in '#\ufeff': continue
        tokens.append((text, match.start(), match.end()))
    if position != len(source): raise ValueError('Unsupported trailing syntax')
    index = 0

    def block(nested=False):
        nonlocal index
        result = []
        while index < len(tokens) and tokens[index][0] != '}':
            token, start, end = tokens[index]
            index += 1
            key = operator = None
            if token == '{':
                value, end = block(True)
            elif index < len(tokens) and OP.fullmatch(tokens[index][0]):
                key, operator = scalar(token), tokens[index][0]
                index += 1
                if index >= len(tokens) or tokens[index][0] == '}': raise ValueError('Missing assignment value')
                token, _, end = tokens[index]
                index += 1
                if token == '{': value, end = block(True)
                else: value = scalar(token)
            else: value = scalar(token)
            result.append(Node(key, operator, value, start, end,
                               bisect.bisect_left(newlines, start)+1, bisect.bisect_left(newlines, end)+1))
        if nested:
            if index >= len(tokens): raise ValueError('Unclosed script block')
            end = tokens[index][2]
            index += 1
        else:
            if index != len(tokens): raise ValueError('Unexpected closing brace')
            end = len(source)
        return result, end
    return block()[0]


def value_summary(node):
    if isinstance(node.value, str): return node.value
    return {child.key: child.value for child in node.value if child.key and isinstance(child.value, str)}


def kind_for(path):
    if path.startswith('events/'): return 'event'
    for folder, kind in [('scripted_effects', 'effect'), ('scripted_triggers', 'predicate'),
                         ('on_action', 'on_action'), ('decisions', 'decision')]:
        if path.startswith('common/' + folder + '/'): return kind
    return 'definition'


def inspect_definition(node, kind, source, known_symbols=frozenset()):
    mutations, calls, observations = [], [], []
    option_index = -1
    def walk(children, scope, mode, option):
        nonlocal option_index
        counts = Counter()
        for child in children:
            key = child.key or '<item>'
            ordinal = counts[key]; counts[key] += 1
            here = scope + [key + f'[{ordinal}]']
            current = mode
            if key in PREVIEW: current = 'preview'
            elif key in CONDITION and mode != 'preview': current = 'condition'
            elif mode == 'declarative' and (key in ENTRY or key.startswith('on_')): current = 'execute'
            selected = option
            if not scope and key == 'option' and kind == 'event':
                option_index += 1; selected = option_index
            info = {'key': key, 'line': child.line, 'end_line': child.end_line, 'scope': here,
                    'mode': current, 'option_index': selected, 'value': value_summary(child),
                    'sha256': sha(source[child.start:child.end])}
            if key in MUTATIONS or key in MARKERS:
                mutations.append(dict(info, domain=MUTATIONS.get(key, 'narrative_marker')))
            if key in {'has_global_variable', 'global_var', 'has_variable', 'has_character_flag'} or key.startswith('global_var:'):
                observations.append(info)
            if key == 'trigger_event':
                target = child.value if isinstance(child.value, str) else next((n.value for n in child.value if n.key == 'id' and isinstance(n.value, str)), None)
                if target: calls.append(dict(info, target=target, edge='scheduled_event'))
            if key in known_symbols or key.endswith(('_effect', '_trigger')):
                calls.append(dict(info, target=key, edge='script_call'))
                if isinstance(child.value, list):
                    for argument in child.value:
                        if isinstance(argument.value, str) and EVENT.fullmatch(argument.value):
                            calls.append(dict(info, target=argument.value, edge='event_argument', argument=argument.key))
            if (key == '<item>' or key.isdigit()) and isinstance(child.value, str) and EVENT.fullmatch(child.value):
                calls.append(dict(info, target=child.value, edge='event_route'))
            if isinstance(child.value, list): walk(child.value, here, current, selected)
    mode = 'execute' if kind == 'effect' else 'condition' if kind == 'predicate' else 'declarative'
    walk(node.value, [], mode, None)
    return mutations, calls, observations


SCHEMA = '''
CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE files(path TEXT PRIMARY KEY,sha256 TEXT,bytes INTEGER,status TEXT,error TEXT);
CREATE TABLE definitions(id INTEGER PRIMARY KEY,kind TEXT,name TEXT,path TEXT,line INTEGER,end_line INTEGER,sha256 TEXT);
CREATE INDEX definition_name ON definitions(name);
CREATE TABLE mutations(definition_id INTEGER,key TEXT,domain TEXT,line INTEGER,mode TEXT,option_index INTEGER,detail_json TEXT);
CREATE TABLE calls(definition_id INTEGER,target TEXT,edge TEXT,line INTEGER,mode TEXT,option_index INTEGER,detail_json TEXT);
CREATE INDEX call_target ON calls(target);
CREATE INDEX call_definition ON calls(definition_id);
CREATE TABLE observations(definition_id INTEGER,key TEXT,line INTEGER,mode TEXT,detail_json TEXT);
CREATE TABLE book_branches(branch_id TEXT PRIMARY KEY,event_id TEXT,title TEXT,kind TEXT,path TEXT,source_sha256 TEXT,current_definition_id INTEGER,source_matches INTEGER);
'''


def audit(root, book, output):
    output.mkdir(parents=True, exist_ok=False)
    db = sqlite3.connect(output / 'inventory.sqlite3')
    db.executescript(SCHEMA)
    files = sorted([*root.joinpath('events').rglob('*.txt'), *root.joinpath('common').rglob('*.txt')])
    errors = []
    for index, file in enumerate(files):
        rel = file.relative_to(root).as_posix(); raw = file.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        try:
            source = raw.decode('utf-8-sig'); nodes = parse(source)
        except (ValueError, UnicodeError, RecursionError) as error:
            errors.append({'path': rel, 'error': str(error)[:300]})
            db.execute('INSERT INTO files VALUES(?,?,?,?,?)', (rel, digest, len(raw), 'parse_error', str(error)[:300]))
            continue
        db.execute('INSERT INTO files VALUES(?,?,?,?,?)', (rel, digest, len(raw), 'parsed', None))
        kind = kind_for(rel)
        for node in nodes:
            if not node.key or not isinstance(node.value, list): continue
            if kind == 'event' and not EVENT.fullmatch(node.key): continue
            cursor = db.execute('INSERT INTO definitions(kind,name,path,line,end_line,sha256) VALUES(?,?,?,?,?,?)',
                                (kind, node.key, rel, node.line, node.end_line, sha(source[node.start:node.end])))
            ident = cursor.lastrowid
            mutations, calls, observations = inspect_definition(node, kind, source)
            db.executemany('INSERT INTO mutations VALUES(?,?,?,?,?,?,?)',
                [(ident, row['key'], row['domain'], row['line'], row['mode'], row['option_index'], encoded(row)) for row in mutations])
            db.executemany('INSERT INTO calls VALUES(?,?,?,?,?,?,?)',
                [(ident, row['target'], row['edge'], row['line'], row['mode'], row['option_index'], encoded(row)) for row in calls])
            db.executemany('INSERT INTO observations VALUES(?,?,?,?,?)',
                [(ident, row['key'], row['line'], row['mode'], encoded(row)) for row in observations])
        if index % 100 == 0:
            db.commit(); print(encoded({'parsedFiles': index+1, 'totalFiles': len(files), 'errors': len(errors)}), flush=True)
    with sqlite3.connect(book.resolve().as_uri()+'?mode=ro', uri=True) as lore:
        for bid, event, title, kind, evidence in lore.execute('SELECT id,event_id,title,kind,evidence_json FROM branches'):
            source = json.loads(evidence)['source']
            candidates = db.execute('SELECT id,sha256 FROM definitions WHERE name=? AND path=?', (event, source['path'])).fetchall()
            exact = next((row for row in candidates if row[1] == source['block_sha256']), None)
            db.execute('INSERT INTO book_branches VALUES(?,?,?,?,?,?,?,?)',
                (bid,event,title,kind,source['path'],source['block_sha256'],exact[0] if exact else candidates[0][0] if len(candidates)==1 else None,1 if exact else 0))
    db.commit()
    one = lambda sql: db.execute(sql).fetchone()[0]
    summary = {'scope': 'Installed GoA events and every common/*.txt source; static definitions, not observed campaign execution.',
        'files':len(files), 'parsedFiles':one("SELECT count(*) FROM files WHERE status='parsed'"), 'parseErrors':errors,
        'sourceBytes':one('SELECT sum(bytes) FROM files'),
        'definitionsByKind':dict(db.execute('SELECT kind,count(*) FROM definitions GROUP BY kind')),
        'mutationsByMode':dict(db.execute('SELECT mode,count(*) FROM mutations GROUP BY mode')),
        'existingBookBranches':one('SELECT count(*) FROM book_branches'),
        'exactBookSourceMatches':one('SELECT count(*) FROM book_branches WHERE source_matches=1'),
        'eventDefinitionsWithDirectExecutedMutations':one("SELECT count(distinct d.id) FROM definitions d JOIN mutations m ON d.id=m.definition_id WHERE d.kind='event' AND m.mode='execute'"),
        'scriptCalls':one('SELECT count(*) FROM calls'),
        'cautions':['Recognized mutation vocabulary is explicit and not exhaustive of all engine effects.',
                    'Calls through external definitions and macro arguments require closure analysis.',
                    'Preview/trigger references are not executed outcomes; delayed calls are scheduling only.',
                    'World-state truth and character knowledge remain separate. No live hooks or state writes made.']}
    fingerprint = sha(encoded(db.execute('SELECT path,sha256 FROM files ORDER BY path').fetchall()))
    db.execute('INSERT INTO metadata VALUES(?,?)',('sourceFingerprint', fingerprint))
    db.execute('INSERT INTO metadata VALUES(?,?)',('sourceRoot', str(root)))
    db.commit(); db.close()
    summary['sourceFingerprint'] = fingerprint
    (output/'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n')
    print(encoded({k: v for k,v in summary.items() if k not in ['parseErrors','cautions']}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--book', type=Path, default=Path('public/lorebook/bundle/goa.sqlite3'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    audit(args.root, args.book, args.output)
