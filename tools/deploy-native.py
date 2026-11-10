#!/usr/bin/env python3
"""Seal, install or roll back Titan's main Linux runtime; preserve the frozen Wine fallback."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from deployment_common import deployment_lock, ensure_closed, save_existing, tree_hash, user_data_root
from storage_policy import require_space, tree_bytes, prune_backups, copy_tree

ROOT = Path(__file__).resolve().parent.parent
USER = Path.home()
STATE = USER / '.local/share/votc-mimir'
TARGET = STATE / 'native/app-2.2.0-beta2-titan'
STAGE = ROOT / 'out/titan-rebrand/native/application'


def retired_targets():
    # Names retained for compatibility with the trial's existing backups.
    return [(USER / '.local/bin/votc-launch-native-test', 'test-launcher'),
            (USER / 'Desktop/VOTC Titan Edition Native Test.desktop', 'desktop')]


def integration_targets():
    return [(USER / '.local/bin/votc-launch', 'launcher'),
            (USER / 'Desktop/VOTC Titan Edition.desktop', 'titan-desktop'),
            (USER / '.local/share/applications/votc.desktop', 'titan-menu'),
            (USER / '.local/share/icons/hicolor/256x256/apps/votc-titan-edition.png', 'titan-icon'),
            (STATE / 'default-runtime', 'default-runtime'), *retired_targets()]


def targets():
    return [(TARGET, 'application'), *integration_targets()]


def selected_runtime():
    selector = STATE / 'default-runtime'
    runtime = selector.read_text().strip() if selector.exists() else 'native'
    if runtime not in ('native', 'wine'):
        raise RuntimeError('Inspect the invalid runtime selector before deployment.')
    return runtime


def atomic_write(path, content, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.titan-tmp')
    if temporary.exists():
        raise RuntimeError('Inspect existing deployment temporary file: ' + str(temporary))
    try:
        temporary.write_bytes(content if isinstance(content, bytes) else content.encode())
        temporary.chmod(mode)
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()


def retire_test_shortcuts():
    for target, _ in retired_targets():
        if target.exists():
            target.unlink()


def apply_integration(runtime, launcher_source, icon_source):
    atomic_write(USER / '.local/bin/votc-launch', launcher_source.read_bytes(), 0o755)
    icon = USER / '.local/share/icons/hicolor/256x256/apps/votc-titan-edition.png'
    atomic_write(icon, icon_source.read_bytes(), 0o644)
    entry = ('[Desktop Entry]\nType=Application\nName=VOTC Titan Edition\n'
             'Comment=Titan companion for Crusader Kings III\n'
             'Exec="' + str(USER / '.local/bin/votc-launch') + '"\nIcon=' + str(icon) + '\n'
             'Terminal=false\nCategories=Game;\nStartupNotify=true\n')
    for target in (USER / 'Desktop/VOTC Titan Edition.desktop', USER / '.local/share/applications/votc.desktop'):
        atomic_write(target, entry, 0o755)
    atomic_write(STATE / 'default-runtime', runtime + '\n')
    retire_test_shortcuts()


def seal(output=None):
    output = Path(output) if output is not None else ROOT / 'out/titan-rebrand'
    checks = json.loads((output / 'native-verification.json').read_text())
    application_hash = tree_hash(STAGE)
    launcher_hash = tree_hash(ROOT / 'tools/votc-launch.sh')
    if (not checks.get('passed') or checks.get('application_sha256') != application_hash or
            checks.get('launcher_sha256') != launcher_hash):
        raise RuntimeError('Run verify:linux for the current application and launcher before sealing.')
    required = {'native-storage-report.json', 'native-runtime-report.json',
                'native-overlay-report.json', 'native-ui/ui-report.json'}
    if set(checks.get('reports', {})) != required:
        raise RuntimeError('Native verification is incomplete.')
    for name, digest in checks['reports'].items():
        report = output / name
        if tree_hash(report) != digest or not json.loads(report.read_text()).get('passed'):
            raise RuntimeError('Native verification report changed or failed: ' + name)
    overlay = json.loads((output / 'native-overlay-report.json').read_text())
    overlay_hash = hashlib.sha256((STAGE / 'resources/app/dist/main/windows/ChatWindow.js').read_bytes()).hexdigest()
    if overlay.get('sourceSha256') != overlay_hash:
        raise RuntimeError('Native overlay verification belongs to a different ChatWindow build.')
    launcher = STAGE.parent / 'votc-launch'
    shutil.copy2(ROOT / 'tools/votc-launch.sh', launcher)
    manifest = {'application_sha256': application_hash, 'launcher_sha256': tree_hash(launcher),
                'engine_acceptance': 'not_retested_for_this_build', 'default_runtime': 'preserve_or_native',
                'electron': '33.0.0', 'abi': 130, 'platform': 'linux-x64',
                'userdata_root': str(user_data_root()), 'overlay_source_sha256': overlay_hash}
    atomic_write(STAGE.parent / 'manifest.json', json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest, indent=2))


def make_backup(paths, manifest):
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = STATE / 'native-deployments' / timestamp
    backup.mkdir(parents=True, mode=0o700)
    entries = {}
    for target, name in paths:
        save_existing(target, backup, name, entries)
    atomic_write(backup / 'deployment.json', json.dumps({'entries': entries, 'manifest': manifest}, indent=2) + '\n')
    return backup


def integrate():
    """Update next-launch integration only, leaving the active application and userdata alone."""
    package = json.loads((TARGET / 'resources/app/package.json').read_text())
    if not package.get('votcMimirDeployment') or package.get('votcTitanRuntime') != 'linux-x64':
        raise RuntimeError('Expected the existing dedicated Titan Linux application.')
    runtime = selected_runtime()
    backup = make_backup(integration_targets(), {'mode': 'integration_only'})
    try:
        apply_integration(runtime, ROOT / 'tools/votc-launch.sh', TARGET / 'resources/app/public/assets/titan-icon.png')
    except Exception:
        rollback(backup, guard=False)
        raise
    print(json.dumps({'integration_updated': True, 'runtime': runtime, 'backup': str(backup),
                      'test_shortcut_removed': True, 'application_replaced': False}))


def install():
    with deployment_lock(STATE):
        install_locked()


def install_locked():
    ensure_closed()
    manifest = json.loads((STAGE.parent / 'manifest.json').read_text())
    if tree_hash(STAGE) != manifest['application_sha256']:
        raise RuntimeError('Native application changed after sealing.')
    launcher = STAGE.parent / 'votc-launch'
    if tree_hash(launcher) != manifest.get('launcher_sha256'):
        raise RuntimeError('Native launcher changed after sealing.')
    package = json.loads((STAGE / 'resources/app/package.json').read_text())
    if not package.get('votcMimirDeployment') or package.get('votcTitanRuntime') != 'linux-x64':
        raise RuntimeError('Refusing to install an unmarked native application.')
    if TARGET.exists() and not json.loads((TARGET / 'resources/app/package.json').read_text()).get('votcMimirDeployment'):
        raise RuntimeError('Refusing to replace an application without the dedicated Titan marker.')
    runtime = selected_runtime()
    temp = TARGET.with_name(TARGET.name + '.staging')
    if temp.exists():
        raise RuntimeError('Inspect an existing native staging directory first.')
    # Budget both the independent rollback and new installation before touching live.
    require_space(STATE, tree_bytes(STAGE) + (tree_bytes(TARGET) if TARGET.exists() else 0))
    backup = make_backup(targets(), manifest)
    try:
        temp.parent.mkdir(parents=True, exist_ok=True)
        copy_tree(STAGE, temp, symlinks=True)
        if TARGET.exists():
            shutil.rmtree(TARGET)
        temp.replace(TARGET)
        apply_integration(runtime, launcher, TARGET / 'resources/app/public/assets/titan-icon.png')
        prune_backups(STATE)
        print(json.dumps({'installed': True, 'native': str(TARGET), 'backup': str(backup),
                          'default_runtime': runtime, 'ck3_acceptance': manifest['engine_acceptance']}, indent=2))
    except Exception:
        if temp.exists():
            shutil.rmtree(temp)
        rollback(backup, guard=False)
        raise


def rollback(backup, guard=True):
    if guard:
        with deployment_lock(STATE):
            ensure_closed()
            return rollback(backup, guard=False)
    backup = Path(backup).resolve()
    if backup.parent != (STATE / 'native-deployments').resolve():
        raise RuntimeError('Expected a native deployment backup.')
    entries = json.loads((backup / 'deployment.json').read_text())['entries']
    allowed = {name: target for target, name in targets()}
    retired = {name for _, name in retired_targets()}
    for name, entry in entries.items():
        if allowed.get(name) != Path(entry['path']):
            raise RuntimeError('Unexpected native restore target.')
        if entry['existed'] and name not in retired and not (backup / name).exists():
            raise RuntimeError('Incomplete native backup: ' + name)
    for name, entry in entries.items():
        if name in retired:
            continue
        target = Path(entry['path'])
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()
        if entry['existed']:
            target.parent.mkdir(parents=True, exist_ok=True)
            if (backup / name).is_dir():
                shutil.copytree(backup / name, target, symlinks=True)
            else:
                shutil.copy2(backup / name, target)
    retire_test_shortcuts()
    print('Native deployment rolled back:', backup)


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['seal', 'install', 'integrate', 'rollback'])
    parser.add_argument('--backup')
    args = parser.parse_args()
    if args.action == 'seal':
        seal()
    elif args.action == 'install':
        install()
    elif args.action == 'integrate':
        integrate()
    elif args.backup:
        rollback(args.backup)
    else:
        parser.error('rollback requires --backup')
