#!/usr/bin/env python3
"""Build the optional native picker from the installed Workshop mods and Titan paintings."""
import argparse
from contextlib import closing
import importlib.util
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory

from deployment_common import ensure_closed, tree_hash
from storage_policy import require_deployment_space, tree_bytes


ROOT = Path(__file__).resolve().parents[1]
QUALIFICATION = ROOT / 'tools/titan-scenes-qualification.json'


def scene_tool(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tools' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def enable(ck3, art, state):
    ensure_closed()
    builder = scene_tool('build-titan-scene-addon')
    installer = scene_tool('install-titan-scene-addon')
    expected = json.loads(QUALIFICATION.read_text())['addonSha256']
    enabled = json.loads((ck3 / 'dlc_load.json').read_text())['enabled_mods']
    if installer.CE not in enabled or installer.GOA not in enabled or 'mod/votc_titan.mod' in enabled:
        raise ValueError('Select a playset with the Workshop versions of CE and GoA2.')
    if installer.REGISTRY in enabled:
        target = installer.mod_root(ck3, installer.REGISTRY)
        with closing(sqlite3.connect((ck3 / 'launcher-v2.sqlite').as_uri() + '?mode=ro', uri=True)) as db:
            installer.active_playset(db, enabled)
        if (enabled.index(installer.REGISTRY) < enabled.index(installer.CE) or
                enabled.index(installer.REGISTRY) < enabled.index(installer.GOA) or
                target != (ck3 / installer.REGISTRY).with_suffix('').resolve() or
                tree_hash(target) != expected):
            raise ValueError('Check the existing Titan Scenes installation and load order.')
        print('Titan Scenes is already enabled in this playset.')
        return

    if (ck3 / installer.REGISTRY).exists() or (ck3 / installer.REGISTRY).with_suffix('').exists():
        installer.reenable(ck3, state, expected)
        return

    ce = installer.mod_root(ck3, installer.CE)
    goa = installer.mod_root(ck3, installer.GOA)
    state.mkdir(parents=True, exist_ok=True)
    artwork_bytes = tree_bytes(art)
    require_deployment_space(state, 2 * artwork_bytes)
    require_deployment_space(ck3, artwork_bytes)
    with TemporaryDirectory(prefix='titan-scene-build-', dir=state) as temp:
        stage = Path(temp) / 'votc_titan_scenes'
        builder.build(ce, goa, art, stage)
        installer.install(stage, ck3, QUALIFICATION, state)


def main():
    portable_art = ROOT / 'application/resources/app/public/scene-art'
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ck3-user', type=Path,
                        default=Path.home() / '.local/share/Paradox Interactive/Crusader Kings III')
    parser.add_argument('--art', type=Path, default=portable_art if portable_art.is_dir() else ROOT / 'public/scene-art')
    parser.add_argument('--state', type=Path, default=Path.home() / '.local/share/votc-mimir')
    args = parser.parse_args()
    try:
        enable(args.ck3_user.resolve(), args.art.resolve(), args.state.resolve())
    except (OSError, ValueError, RuntimeError, sqlite3.Error) as error:
        parser.exit(1, f'Titan Scenes: {error}\n')


if __name__ == '__main__':
    main()
