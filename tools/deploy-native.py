#!/usr/bin/env python3
"""Seal, install or roll back Titan's main Linux runtime; preserve the frozen Wine fallback."""
import argparse
import ctypes
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from deployment_common import deployment_lock, ensure_closed, save_existing, tree_hash, user_data_root
from storage_policy import require_space, require_deployment_space, tree_bytes, prune_backups, copy_tree

ROOT = Path(__file__).resolve().parent.parent
USER = Path.home()
STATE = USER / '.local/share/votc-mimir'
TARGET = STATE / 'native/app-2.2.0-beta2-titan'
STAGE = ROOT / 'out/titan-rebrand/native/application'


def data_home():
    configured = Path(os.environ.get('XDG_DATA_HOME', ''))
    return configured if configured.is_absolute() else USER / '.local/share'


def retired_targets():
    # Names retained for compatibility with the trial's existing backups.
    return [(USER / '.local/bin/votc-launch-native-test', 'test-launcher'),
            (USER / 'Desktop/VOTC Titan Edition Native Test.desktop', 'desktop')]


def integration_targets():
    return [(USER / '.local/bin/votc-launch', 'launcher'),
            (USER / 'Desktop/VOTC Titan Edition.desktop', 'titan-desktop'),
            (data_home() / 'applications/votc.desktop', 'titan-menu'),
            (data_home() / 'icons/hicolor/256x256/apps/votc-titan-edition.png', 'titan-icon'),
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
    icon = data_home() / 'icons/hicolor/256x256/apps/votc-titan-edition.png'
    atomic_write(icon, icon_source.read_bytes(), 0o644)
    entry = ('[Desktop Entry]\nType=Application\nName=VOTC Titan Edition\n'
             'Comment=Titan companion for Crusader Kings III\n'
             'Exec="' + str(USER / '.local/bin/votc-launch') + '"\nIcon=' + str(icon) + '\n'
             'Terminal=false\nCategories=Game;\nStartupNotify=true\n')
    for target in (USER / 'Desktop/VOTC Titan Edition.desktop', data_home() / 'applications/votc.desktop'):
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


def exchange_directories(first, second):
    libc = ctypes.CDLL(None, use_errno=True)
    exchange = getattr(libc, 'renameat2', None)
    if exchange is None:
        raise RuntimeError('Atomic application upgrade is unavailable on this system.')
    exchange.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    exchange.restype = ctypes.c_int
    if exchange(-100, os.fsencode(first), -100, os.fsencode(second), 2) != 0:
        number = ctypes.get_errno()
        raise OSError(number, os.strerror(number))


def restore_integration(backup):
    entries = json.loads((Path(backup) / 'deployment.json').read_text())['entries']
    allowed = {name: target for target, name in integration_targets()}
    for name, target in allowed.items():
        entry = entries.get(name)
        if not entry or Path(entry['path']) != target:
            raise RuntimeError('Unexpected integration restore target.')
        if name in {n for _, n in retired_targets()}:
            continue
        if entry['existed']:
            atomic_write(target, (Path(backup) / name).read_bytes(), (Path(backup) / name).stat().st_mode & 0o777)
        else:
            target.unlink(missing_ok=True)


def recover_pending_install():
    journal = STATE / 'native-install-pending.json'
    temporary_journal = journal.with_name(journal.name + '.titan-tmp')
    if temporary_journal.exists():
        draft = json.loads(temporary_journal.read_text())
        if draft.get('target') != str(TARGET) or draft.get('temp') != str(TARGET.with_name(TARGET.name + '.staging')):
            raise RuntimeError('Unexpected interrupted install journal.')
        if not journal.exists():
            temporary_journal.replace(journal)
        else:
            active = json.loads(journal.read_text())
            if any(active.get(k) != draft.get(k) for k in ('target', 'temp', 'inode', 'backup', 'old', 'new')):
                raise RuntimeError('Conflicting interrupted install journals.')
            temporary_journal.unlink()
    if not journal.exists():
        return
    pending = json.loads(journal.read_text())
    temp = TARGET.with_name(TARGET.name + '.staging')
    if pending.get('target') != str(TARGET) or pending.get('temp') != str(temp):
        raise RuntimeError('Inspect an unexpected native install journal.')
    backup = Path(pending['backup'])
    if backup.parent.resolve() != (STATE / 'native-deployments').resolve():
        raise RuntimeError('Unexpected install recovery backup.')
    owned_temp = temp.exists() and temp.stat().st_ino in (pending['inode'], pending.get('old_inode'))
    live_hash = tree_hash(TARGET) if TARGET.exists() else None
    if pending['phase'] == 'committed':
        if live_hash != pending['new']:
            raise RuntimeError('Installed application changed during interrupted cleanup.')
    elif live_hash == pending['new']:
        if pending['old'] is not None:
            if not owned_temp or tree_hash(temp) != pending['old']:
                raise RuntimeError('Prior application is unavailable for atomic install recovery.')
            exchange_directories(TARGET, temp)
        else:
            shutil.rmtree(TARGET)
        restore_integration(backup)
    elif live_hash != pending['old']:
        raise RuntimeError('Native application changed during interrupted installation.')
    if temp.exists():
        if not owned_temp:
            raise RuntimeError('Staging directory ownership changed; inspect before retrying.')
        shutil.rmtree(temp)
    journal.unlink()


def install_locked():
    ensure_closed()
    recover_pending_install()
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
    require_deployment_space(STATE, tree_bytes(STAGE) + (tree_bytes(TARGET) if TARGET.exists() else 0))
    backup = make_backup(targets(), manifest)
    temp.parent.mkdir(parents=True, exist_ok=True)
    temp.mkdir()
    journal = STATE / 'native-install-pending.json'
    pending = {'target': str(TARGET), 'temp': str(temp), 'inode': temp.stat().st_ino,
               'old': tree_hash(TARGET) if TARGET.exists() else None, 'old_inode': TARGET.stat().st_ino if TARGET.exists() else None,
               'new': manifest['application_sha256'], 'backup': str(backup), 'phase': 'copying'}
    try:
        atomic_write(journal, json.dumps(pending))
        copy_tree(STAGE, temp, symlinks=True, dirs_exist_ok=True)
        if tree_hash(temp) != pending['new']:
            raise RuntimeError('Staged native application failed copy verification.')
        if TARGET.exists():
            exchange_directories(TARGET, temp)
        else:
            temp.replace(TARGET)
        pending['phase'] = 'promoted'
        atomic_write(journal, json.dumps(pending))
        apply_integration(runtime, launcher, TARGET / 'resources/app/public/assets/titan-icon.png')
        pending['phase'] = 'committed'
        atomic_write(journal, json.dumps(pending))
        recover_pending_install()
        prune_backups(STATE)
        print(json.dumps({'installed': True, 'native': str(TARGET), 'backup': str(backup),
                          'default_runtime': runtime, 'ck3_acceptance': manifest['engine_acceptance']}, indent=2))
    except BaseException:
        recover_pending_install()
        if not journal.exists() and temp.exists() and temp.stat().st_ino == pending['inode']:
            shutil.rmtree(temp)
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
