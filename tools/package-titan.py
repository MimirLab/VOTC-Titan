#!/usr/bin/env python3
"""Bundle the verified native Titan launcher. No game mod, Steam wrapper or player data."""
import argparse
import json
from pathlib import Path
import shutil
from deployment_common import tree_hash, deployment_lock, ensure_closed
from storage_policy import copy_tree, require_space, tree_bytes, promote_portable

ROOT = Path(__file__).resolve().parents[1]
INSTALLER_TOOLS = ('deploy-native.py', 'deployment_common.py', 'storage_policy.py', 'install-titan.py')

def package(native=None, target=None):
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
    if tree_hash(bundle / 'application') != manifest['application_sha256']:
        raise RuntimeError('Portable application copy differs.')
    prior = promote_portable(bundle, target, ROOT / 'out/storage-retained-sources')
    receipt = dict(bundle=str(target), predecessor=str(prior), application_sha256=manifest['application_sha256'],
                   settings_included=False, histories_included=False, game_component_included=False,
                   steam_configuration_required=False)
    print(json.dumps(receipt))
    return receipt

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', type=Path, help='Verified native stage containing manifest.json and application/')
    parser.add_argument('--target', type=Path)
    args = parser.parse_args()
    with deployment_lock(Path.home() / '.local/share/votc-mimir'):
        ensure_closed()
        package(args.native, args.target)
