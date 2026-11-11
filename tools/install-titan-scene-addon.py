#!/usr/bin/env python3
"""Enable the qualified native picker beside the existing Workshop mods."""

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import shutil
import sqlite3
from uuid import uuid4

from deployment_common import deployment_lock, ensure_closed, tree_hash
from goa_timeline_audit import parse


REGISTRY = 'mod/votc_titan_scenes.mod'
CE = 'mod/ugc_3654567139.mod'
GOA = 'mod/ugc_2949767945.mod'


def atomic_write(path, contents):
    temporary = path.with_name(path.name + '.titan-scene.tmp')
    with temporary.open('xb') as stream:
        stream.write(contents)
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def mod_root(ck3, registry):
    entries = parse((ck3 / registry).read_text(encoding='utf-8-sig'))
    roots = [entry.value for entry in entries if entry.key == 'path']
    if len(roots) != 1 or not isinstance(roots[0], str):
        raise ValueError(f'Cannot locate {registry}')
    return (ck3 / roots[0]).resolve()


def active_playset(db, enabled):
    rows = db.execute('SELECT id FROM playsets WHERE isActive=1 AND isRemoved=0').fetchall()
    if len(rows) != 1:
        raise ValueError('Expected one active CK3 playset.')
    playset = rows[0][0]
    active = db.execute(
        'SELECT mods.gameRegistryId FROM playsets_mods JOIN mods ON mods.id=modId '
        'WHERE playsetId=? AND enabled=1 ORDER BY position', (playset,)).fetchall()
    if [row[0] for row in active] != enabled:
        raise ValueError('The active Paradox playset differs from the game’s load list.')
    return playset


def register(db, playset, target, metadata):
    if db.execute('SELECT 1 FROM mods WHERE gameRegistryId=?', (REGISTRY,)).fetchone():
        raise ValueError('A previous Titan Scenes registration needs review.')
    key = str(uuid4())
    now = datetime.now(timezone.utc)
    name = metadata['name']
    db.execute(
        'INSERT INTO mods (id,gameRegistryId,name,displayName,version,tags,dirPath,status,source,'
        'isNew,createdDate,timeUpdated,isMetadataApplied,metadataStatus,keepLatest,userVersion) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (key, REGISTRY, name, name, metadata['version'], '["Utilities"]', str(target),
         'ready_to_play', 'local', 0, now.isoformat(), int(now.timestamp() * 1000), 1, 'applied', 0, 1))
    next_position = db.execute(
        'SELECT COALESCE(MAX(position),-1)+1 FROM playsets_mods WHERE playsetId=?',
        (playset,)).fetchone()[0]
    db.execute('INSERT INTO playsets_mods(playsetId,modId,enabled,position) VALUES (?,?,1,?)',
               (playset, key, next_position))
    return key


def install(stage, ck3, qualification, state):
    metadata = json.loads((stage / 'titan-scene-addon.json').read_text())
    receipt = json.loads(qualification.read_text())
    digest = tree_hash(stage)
    if not receipt.get('passed') or receipt.get('addonSha256') != digest:
        raise ValueError('The add-on must match the native picker playtest.')
    if stage.with_suffix('.sha256').read_text().strip() != digest:
        raise ValueError('The staged add-on differs from its build.')
    load_path = ck3 / 'dlc_load.json'
    db_path = ck3 / 'launcher-v2.sqlite'
    registry = ck3 / REGISTRY
    target = registry.with_suffix('')
    temporary = target.with_name(target.name + '.installing')
    with deployment_lock(state):
        ensure_closed()
        if any(path.exists() or path.is_symlink() for path in (registry, target, temporary)):
            raise ValueError('Titan Scenes is already present or has a pending installation.')
        load_bytes = load_path.read_bytes()
        load = json.loads(load_bytes)
        enabled = load['enabled_mods']
        if CE not in enabled or GOA not in enabled or 'mod/votc_titan.mod' in enabled:
            raise ValueError('Select the playset with the stock CE and GoA Workshop entries.')
        ce = mod_root(ck3, CE)
        for relative, expected in metadata['cePins'].items():
            if sha256((ce / relative).read_bytes()).hexdigest() != expected:
                raise ValueError(f'Community Edition changed: {relative}')
        with sqlite3.connect(db_path.as_uri()+'?mode=rw', uri=True) as db:
            playset = active_playset(db, enabled)
            backup = state / 'scene-addon-deployments' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            backup.mkdir(parents=True, mode=0o700)
            with sqlite3.connect(backup / 'launcher-v2.sqlite') as saved:
                db.backup(saved)
            (backup / 'dlc_load.json').write_bytes(load_bytes)
            created = False
            registered = False
            changed_load = False
            try:
                shutil.copytree(stage, temporary)
                if tree_hash(temporary) != digest:
                    raise ValueError('The copied add-on differs from the staged tree.')
                temporary.rename(target)
                created = True
                descriptor = (target / 'descriptor.mod').read_text() + 'path=' + json.dumps(str(target)) + '\n'
                atomic_write(registry, descriptor.encode())
                registered = True
                key = register(db, playset, target, metadata)
                load['enabled_mods'] = [*enabled, REGISTRY]
                active_playset(db, load['enabled_mods'])
                if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise ValueError('CK3 playset database integrity check failed.')
                atomic_write(load_path, (json.dumps(load, indent=2) + '\n').encode())
                changed_load = True
                db.commit()
            except Exception:
                db.rollback()
                if changed_load:
                    atomic_write(load_path, load_bytes)
                if registered:
                    registry.unlink()
                if created:
                    shutil.rmtree(target)
                raise
            finally:
                if temporary.is_dir():
                    shutil.rmtree(temporary)
        result = {'installed': True, 'path': str(target), 'sha256': digest, 'backup': str(backup),
                  'registryId': REGISTRY, 'playsetId': playset, 'modId': key}
        (backup / 'receipt.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--stage', type=Path, required=True)
    cli.add_argument('--qualification', type=Path, required=True)
    cli.add_argument('--ck3-user', type=Path,
                     default=Path.home() / '.local/share/Paradox Interactive/Crusader Kings III')
    cli.add_argument('--state', type=Path, default=Path.home() / '.local/share/votc-mimir')
    args = cli.parse_args()
    install(args.stage.resolve(), args.ck3_user.resolve(), args.qualification.resolve(), args.state.resolve())
