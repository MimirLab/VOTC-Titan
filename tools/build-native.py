#!/usr/bin/env python3
"""Build an isolated Linux x64 portable folder; never rebuild the working node_modules."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile
import sys
import tarfile
import urllib.request
from storage_policy import copy_tree, require_space, tree_bytes

ROOT = Path(__file__).resolve().parent.parent
STAGE = ROOT / 'out/titan-rebrand/native/application'
VERSION = '33.0.0'

RUNTIME_TOOLS = (
    'audit-goa-lore.cjs', 'lorebook-worker.py', 'lorebook_disclosure.py',
    'lorebook_campaign_clock.py', 'lorebook_observed.py',
    'lorebook-observed-bindings.json', 'lorebook_mutations.py',
    'lorebook_game_state.py', 'lorebook-game-state-catalogue.json', 'launcher-scene-policy.json',
)


def copy_runtime_tools(source, target):
    """Ship the launcher reader, never game-hook installers or local histories."""
    source, target = Path(source), Path(target)
    missing = [name for name in RUNTIME_TOOLS if not (source / name).is_file()]
    if missing:
        raise RuntimeError('Missing launcher runtime tools: ' + ', '.join(missing))
    target.mkdir(parents=True, exist_ok=True)
    for name in RUNTIME_TOOLS:
        shutil.copy2(source / name, target / name)
    for name in ('lorebook-mutation-catalogue.json', 'goa-lore-game-preflight.py', 'goa_lore_game_guard.py'):
        (target / name).unlink(missing_ok=True)

def require_runtime_assets(root):
    """A source checkout must never quietly produce a launcher with missing lore/art/voices."""
    root = Path(root)
    required = [root / name for name in (
        'public/lorebook/bundle/manifest.json', 'public/lorebook/bundle/titan-vendor.json',
        'public/lorebook/bundle/goa.sqlite3', 'public/lorebook/bundle/base.sqlite3',
        'public/lorebook/bundle/expanded.sqlite3', 'public/lorebook/bundle/catalog.sqlite3',
        'public/lorebook/bundle/python/bin/python3', 'public/scene-art/manifest.json',
        'public/audio/clone-banks/catalog.json', 'public/audio/race-selections/manifest.json',
        'public/audio/demon-families/manifest.json')]
    catalogue = root / 'public/audio/clone-banks/catalog.json'
    if catalogue.is_file():
        for key in json.loads(catalogue.read_text()).get('profiles', {}):
            if Path(key).is_absolute() or '..' in Path(key).parts:
                raise RuntimeError('Invalid voice asset path.')
            required.extend(root / 'public/audio/clone-banks' / key / name for name in ('voice.json', 'reference.wav', 'transcript.txt'))
    paintings = root / 'public/scene-art/manifest.json'
    if paintings.is_file():
        for relative in json.loads(paintings.read_text()).get('files', {}):
            if Path(relative).is_absolute() or '..' in Path(relative).parts:
                raise RuntimeError('Invalid painting asset path.')
            required.append(root / 'public/scene-art' / relative)
    missing = [str(p.relative_to(root)) for p in required if not p.is_file()]
    if missing:
        raise RuntimeError('Runtime assets are missing. Run python3 tools/import-release-assets.py /path/to/the/verified/Titan.tar.gz before building. Missing: ' + ', '.join(missing))
    for folder in ('public/audio', 'public/scene-art'):
        if not any((root / folder).rglob('*.wav' if folder.endswith('audio') else '*.dds')):
            raise RuntimeError('Runtime recordings/paintings are missing; import the verified release assets before building.')


def remove_upstream_client(modules):
    client = modules / 'update-electron-app'
    if client.is_symlink():
        client.unlink()
    elif client.exists():
        shutil.rmtree(client)


def install_sqlite_prebuilt(modules, archive=None, policy_file=None):
    """Keep the qualified upstream ABI130 module instead of raising host-libc requirements."""
    policy = json.loads(Path(policy_file or ROOT / 'tools/native-sqlite-prebuilt.json').read_text())
    if policy['electron_abi'] != '130' or policy['platform'] != 'linux-x64':
        raise RuntimeError('Inspect a changed native target before selecting a SQLite prebuilt.')
    package = Path(modules) / 'better-sqlite3'
    if package.is_symlink() or not package.resolve().is_relative_to(Path(modules).resolve()):
        raise RuntimeError('SQLite package escapes isolated staged dependencies.')
    if json.loads((package / 'package.json').read_text())['version'] != policy['package_version']:
        raise RuntimeError('Inspect a changed SQLite version before selecting a native prebuilt.')
    destination = package / policy['member']
    if not destination.resolve().is_relative_to(package.resolve()):
        raise RuntimeError('SQLite module destination escapes its package.')
    if destination.is_file() and hashlib.sha256(destination.read_bytes()).hexdigest() == policy['module_sha256']:
        return False
    archive = Path(archive) if archive else ROOT / 'out/native-prebuilt-cache' / Path(policy['url']).name
    if archive.is_file():
        data = archive.read_bytes()
    else:
        with urllib.request.urlopen(policy['url'], timeout=60) as response:
            data = response.read(20 * 1024 * 1024 + 1)
        if len(data) > 20 * 1024 * 1024:
            raise RuntimeError('SQLite prebuilt archive exceeds its bounded download size.')
    if hashlib.sha256(data).hexdigest() != policy['archive_sha256']:
        raise RuntimeError('SQLite prebuilt archive checksum mismatch; native module unchanged.')
    import io
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:*') as bundle:
        members = bundle.getmembers()
        if len(members) != 1 or members[0].name != policy['member'] or not members[0].isfile() or members[0].size > 20 * 1024 * 1024:
            raise RuntimeError('Unexpected SQLite prebuilt contents; native module unchanged.')
        native = bundle.extractfile(members[0]).read()
    if hashlib.sha256(native).hexdigest() != policy['module_sha256']:
        raise RuntimeError('SQLite prebuilt module checksum mismatch; native module unchanged.')
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists(): archive.write_bytes(data)
    # Only isolated staged dependencies reach this function. Leave development modules alone.
    build_directory = package / 'build'
    if build_directory.exists(): shutil.rmtree(build_directory)
    destination.parent.mkdir(parents=True)
    destination.write_bytes(native)
    destination.chmod(0o755)
    return True


def copy_default_userdata(source, target):
    """Ship authored defaults, never runtime records left by local tests or development."""
    source = Path(source)
    runtime_directories = {'conversation_history', 'conversation_summaries', 'logs', 'audio'}
    def ignore(directory, names):
        return runtime_directories.intersection(names) if Path(directory) == source else set()
    shutil.copytree(source, target, ignore=ignore)
    for directory in runtime_directories:
        (Path(target) / directory).mkdir()


def build(refresh=False):
    if sys.platform != 'linux' or os.uname().machine != 'x86_64':
        raise RuntimeError('This native build targets Linux x64.')
    package = json.loads((ROOT / 'package.json').read_text())
    if package['devDependencies']['electron'] != VERSION:
        raise RuntimeError('Inspect a changed Electron version before building Titan.')
    require_runtime_assets(ROOT)
    if not (ROOT / 'dist/main/main.js').is_file():
        raise RuntimeError('Build TypeScript first.')
    estimated = sum(tree_bytes(ROOT / name) for name in ('dist', 'public', 'src', 'docs', 'default_userdata'))
    if not (STAGE / 'resources/app/node_modules').exists():
        estimated += tree_bytes(ROOT / 'node_modules') + 300 * 1024 ** 2
    require_space(STAGE, estimated)
    if not STAGE.exists():
        archives = list((Path.home() / '.cache/electron').rglob('electron-v33.0.0-linux-x64.zip'))
        if not archives:
            raise RuntimeError('Electron 33 Linux archive missing. Download the pinned official release first.')
        STAGE.mkdir(parents=True)
        with zipfile.ZipFile(archives[0]) as archive:
            archive.extractall(STAGE)
        (STAGE / 'electron').rename(STAGE / 'votc-titan-edition')
        for name in ('votc-titan-edition', 'chrome-sandbox', 'chrome_crashpad_handler'):
            (STAGE / name).chmod(0o755)
    app = STAGE / 'resources/app'
    app.mkdir(parents=True, exist_ok=True)
    modules = app / 'node_modules'
    dependency_state = STAGE.parent / 'native-dependencies.json'
    lock = ROOT / 'node_modules/.package-lock.json'
    fingerprint = hashlib.sha256(lock.read_bytes() + json.dumps({
        'dependencies': package['dependencies'], 'devDependencies': package['devDependencies'],
        'electron': VERSION, 'platform': 'linux-x64'
    }, sort_keys=True).encode()).hexdigest()
    previous = json.loads(dependency_state.read_text()) if dependency_state.exists() else {}
    copied_modules = not modules.exists()
    if modules.exists() and previous and previous.get('fingerprint') != fingerprint:
        shutil.rmtree(modules)
        copied_modules = True
    if copied_modules:
        copy_tree(ROOT / 'node_modules', modules, symlinks=True)
    # A development install may still contain this removed upstream dependency.
    # Never carry its application replacement client into another Titan build.
    remove_upstream_client(modules)
    package.pop('updater', None)
    package['dependencies'].pop('update-electron-app', None)
    package['votcMimirDeployment'] = True
    package['votcTitanRuntime'] = 'linux-x64'
    (app / 'package.json').write_text(json.dumps(package, indent=2) + '\n')
    install_sqlite_prebuilt(modules)
    for directory in ('dist', 'public', 'default_userdata', 'src', 'docs', 'build/icons'):
        target = app / directory
        if target.exists(): shutil.rmtree(target)
        if directory == 'default_userdata':
            copy_default_userdata(ROOT / directory, target)
        else:
            copy_tree(ROOT / directory, target)
    for name in ('LICENSE', 'README.md', 'README.upstream.md', 'CREDITS.md', 'THIRD_PARTY_NOTICES.md'):
        shutil.copy2(ROOT / name, app / name)
    copy_runtime_tools(ROOT / 'tools', app / 'tools')
    # Git omits empty directories; retain the default template's required layout.
    for directory in ('scripts/actions/custom', 'logs', 'conversation_summaries'):
        (app / 'default_userdata' / directory).mkdir(parents=True, exist_ok=True)
    # Libraries must load under Electron's ABI, not merely under the development Node.
    env = dict(os.environ, ELECTRON_RUN_AS_NODE='1')
    subprocess.run([str(STAGE / 'votc-titan-edition'), '-e',
        "const D=require('./node_modules/better-sqlite3');const d=new D(':memory:');"
        "require('./node_modules/sqlite-vec').load(d);d.exec('create virtual table v using vec0(x float[3])');"
        "require('./node_modules/argon2');require('./node_modules/electron-overlay-window/prebuilds/linux-x64/electron-overlay-window.node');"
        "console.log(JSON.stringify({electron:process.versions.electron,abi:process.versions.modules,sqlite:d.prepare('select vec_version() v').get()}));d.close();"],
        env=env, cwd=app, check=True)
    dependency_state.write_text(json.dumps({'fingerprint': fingerprint, 'electron': VERSION, 'abi': 130}, indent=2) + '\n')
    print('Titan Linux application:', STAGE)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true', help='Refresh app files, keeping the verified native dependency rebuild')
    args = parser.parse_args()
    build(args.refresh)
