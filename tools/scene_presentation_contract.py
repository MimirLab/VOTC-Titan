"""Versioned captions over an immutable scene collection; never edits its gates/art."""
import copy
import hashlib
import json
import re

MAX_TITLE_CHARACTERS = 32
MAX_TITLE_WORDS = 6


def load_parent(root, authoring):
    pin = authoring.get('baseline', {})
    if pin.get('file') != 'presentation-baseline.json':
        raise ValueError('Unexpected scene presentation baseline path')
    raw = (root / 'game_mod/scenes/presentation-baseline.json').read_bytes()
    parent = json.loads(raw)
    if hashlib.sha256(raw).hexdigest() != pin.get('sha256') or len(parent['scenes']) != pin.get('scenes'):
        raise ValueError('Immutable scene presentation baseline changed')
    return parent


def validate_title(title):
    if (not isinstance(title, str) or not title or title != title.strip()
            or len(title) > MAX_TITLE_CHARACTERS or len(title.split()) > MAX_TITLE_WORDS
            or not title[0].isupper() or re.search(r'[_:/;\[\]{}#\n\r\t]', title)
            or re.search(r'\s{2,}', title) or any(ord(c) < 32 for c in title)):
        raise ValueError('Scene title needs a compact, readable caption')


def stage_presentation(parent, authoring):
    if authoring.get('schema') != 1 or authoring.get('revision') != 1:
        raise ValueError('Unsupported scene presentation revision')
    rows = authoring.get('titles', [])
    ids = [row['id'] for row in rows]
    if len(ids) != len(set(ids)) or ids != [s['id'] for s in parent['scenes']]:
        raise ValueError('Scene titles must cover the entire ordered collection exactly once')
    if len({row['label'] for row in rows}) != len(rows):
        raise ValueError('Scene captions must remain distinguishable')
    result = copy.deepcopy(parent)
    for scene, row in zip(result['scenes'], rows):
        if set(row) != {'id', 'expectedLabel', 'label'} or row['expectedLabel'] != scene['label']:
            raise ValueError('Caption revision requires its exact original title')
        validate_title(row['label'])
        scene['label'] = row['label']
    result['presentationRevision'] = {'revision': authoring['revision'], 'file': 'scene-titles.json'}
    return result


def validated_parent(root, catalogue):
    if not catalogue.get('presentationRevision'):
        return catalogue
    authoring = json.loads((root / 'game_mod/scenes/scene-titles.json').read_text())
    parent = load_parent(root, authoring)
    if catalogue != stage_presentation(parent, authoring):
        raise ValueError('Presented catalogue differs from its reviewed caption-only composition')
    return parent


def apply_current_titles(root, scenes):
    """Keep offline galleries readable while retaining historical source briefs."""
    catalogue = json.loads((root / 'game_mod/scenes/catalogue.json').read_text())
    validated_parent(root, catalogue)
    labels = {s['id']: s['label'] for s in catalogue['scenes']}
    return [dict(s, authoringLabel=s['label'], label=labels.get(s['id'], s['label'])) for s in scenes]
