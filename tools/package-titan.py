#!/usr/bin/env python3
"""Bundle the verified native Titan launcher and optional local scene builder."""
import argparse
import json
from pathlib import Path
import shutil
from deployment_common import tree_hash, deployment_lock, ensure_closed
from storage_policy import copy_tree, require_space, tree_bytes, promote_portable

ROOT = Path(__file__).resolve().parents[1]
INSTALLER_TOOLS = ('deploy-native.py', 'deployment_common.py', 'storage_policy.py', 'install-titan.py')

SCENE_PICKER_TOOLS = (
    'enable-titan-scenes.py', 'build-titan-scene-addon.py', 'install-titan-scene-addon.py',
    'build-game-mod.py', 'goa_timeline_audit.py', 'world_art_provenance.py', 'scene_admission.py',
    'scene_presentation_contract.py', 'world_scene_contract.py', 'titan-scenes-qualification.json',
)
SCENE_PICKER_INPUTS = (
    'game_mod/scenes/catalogue.json', 'game_mod/scenes/presentation-baseline.json',
    'game_mod/scenes/scene-titles.json', 'game_mod/overrides/gui/custom_gui/votc_scene_selector.gui',
)


def package(native=None, target=None, *, scene_picker=False):
    native = Path(native) if native else ROOT / 'out/titan-rebrand/native'
    target = Path(target) if target else ROOT / 'out/VOTC-Titan-Launcher'
    bundle = target.with_name(target.name + '.candidate')
    manifest = json.loads((native / 'manifest.json').read_text())
    if manifest['application_sha256'] != tree_hash(native / 'application'):
        raise RuntimeError('Seal the verified native application before packaging.')
    if manifest['launcher_sha256'] != tree_hash(native / 'votc-launch'):
        raise RuntimeError('The sealed launcher changed.')
    for forbidden in ['game_mod', 'goa-lore-game-preflight.py', 'goa_lore_game_guard.py', 'lorebook-mutation-catalogue.json']:
        if any((native / 'application').rglob(forbidden)):
            raise RuntimeError('Retired game integration is present in the application: ' + forbidden)
    require_space(bundle, tree_bytes(native / 'application'))
    if bundle.exists():
        raise RuntimeError('Inspect the existing portable candidate before retrying.')
    bundle.mkdir(parents=True)
    copy_tree(native / 'application', bundle / 'application', symlinks=True)
    public_manifest = {key: value for key, value in manifest.items() if key != 'userdata_root'}
    (bundle / 'manifest.json').write_text(json.dumps(public_manifest, indent=2) + '\n')
    shutil.copy2(native / 'votc-launch', bundle / 'votc-launch')
    (bundle / 'tools').mkdir()
    for name in INSTALLER_TOOLS:
        shutil.copy2(ROOT / 'tools' / name, bundle / 'tools' / name)
    shutil.copy2(ROOT / 'LICENSE', bundle / 'LICENSE')
    guide = (ROOT / 'docs/getting-started.md').read_text()
    guide = guide.replace('](audio-integration.md)', '](application/resources/app/docs/audio-integration.md)')
    (bundle / 'INSTALL.md').write_text(guide)
    (bundle / 'install.sh').write_text('#!/bin/sh\nset -eu\nexec python3 "$(dirname "$0")/tools/install-titan.py" "$@"\n')
    (bundle / 'install.sh').chmod(0o755)
    if scene_picker:
        for name in SCENE_PICKER_TOOLS:
            shutil.copy2(ROOT / 'tools' / name, bundle / 'tools' / name)
        for relative in SCENE_PICKER_INPUTS:
            destination = bundle / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, destination)
        command = bundle / 'install-scenes.sh'
        command.write_text('#!/bin/sh\nset -eu\nexec python3 "$(dirname "$0")/tools/enable-titan-scenes.py" "$@"\n')
        command.chmod(0o755)
    if tree_hash(bundle / 'application') != manifest['application_sha256']:
        raise RuntimeError('Portable application copy differs.')
    prior = promote_portable(bundle, target, ROOT / 'out/storage-retained-sources')
    receipt = dict(bundle=str(target), predecessor=str(prior), application_sha256=manifest['application_sha256'],
                   settings_included=False, histories_included=False, game_component_included=False,
                   steam_configuration_required=False, native_scene_builder_included=scene_picker)
    print(json.dumps(receipt))
    return receipt

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', type=Path, help='Verified native stage containing manifest.json and application/')
    parser.add_argument('--target', type=Path)
    parser.add_argument('--with-native-scenes', action='store_true')
    args = parser.parse_args()
    with deployment_lock(Path.home() / '.local/share/votc-mimir'):
        ensure_closed()
        package(args.native, args.target, scene_picker=args.with_native_scenes)
