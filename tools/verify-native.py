#!/usr/bin/env python3
"""Repeatable Linux checks using staged Electron, disposable stores and no model requests."""
import datetime
import fcntl
import json
import os
from pathlib import Path
import socket
import shutil
import subprocess
import tempfile
import time
import urllib.request

from deployment_common import ensure_closed, tree_hash, user_data_root

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'out/titan-rebrand'
STAGE = OUTPUT / 'native/application'
REPORTS = ['native-storage-report.json', 'native-runtime-report.json',
           'native-overlay-report.json', 'native-ui/ui-report.json']


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def wait_debugger(port, child):
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError('Synthetic companion exited before verification; inspect native-verification.log.')
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/json', timeout=1) as response:
                if json.load(response):
                    return
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise RuntimeError('Synthetic debugging endpoint did not become ready.')


def probe_runtime(directory):
    """Same Electron bytes, without resources/app intercepting probe script arguments."""
    directory.mkdir()
    for source in STAGE.iterdir():
        if source.name == 'resources':
            resources = directory / 'resources'
            resources.mkdir()
            for resource in source.iterdir():
                if resource.name != 'app':
                    (resources / resource.name).symlink_to(resource, target_is_directory=resource.is_dir())
        elif source.is_dir():
            (directory / source.name).symlink_to(source, target_is_directory=True)
        else:
            target = directory / ('electron' if source.name == 'votc-titan-edition' else source.name)
            try:
                os.link(source, target)
            except OSError:
                shutil.copy2(source, target)
    return directory / 'electron'


def catalogue_evidence(electron, env):
    # Only read the two game-folder settings; never export provider configuration.
    settings = user_data_root() / 'votc_data/configs/config.json'
    config = json.loads(settings.read_text()) if settings.exists() else {}
    game = os.environ.get('VOTC_TITAN_GAME_ROOT', config.get('cultureGameInstallPath', ''))
    ck3 = os.environ.get('VOTC_TITAN_CK3_ROOT', config.get('userFolderPath', ''))
    if not game or not ck3:
        raise RuntimeError('Configure both CK3 folders, or set VOTC_TITAN_GAME_ROOT and VOTC_TITAN_CK3_ROOT.')
    script = ("const {ck3RuntimePath}=require('./dist/shared/runtimePaths');"
              "const game=ck3RuntimePath(process.argv[1]),ck3=ck3RuntimePath(process.argv[2]);"
              "const c=require('./dist/main/culture/cultureCatalog').buildCultureCatalog(game,ck3);"
              "const f=require('./dist/main/faith/faithCatalog').buildFaithCatalog(game,ck3);"
              "const g=require('./dist/main/goa/goaBridge').buildGoaCaptureCatalog(game,ck3);"
              "process.stdout.write(JSON.stringify({game,ck3,catalog_digest:c.digest,faith_catalog_digest:f.digest,goa_catalog_digest:g?.digest??null}));")
    raw = subprocess.check_output([str(electron), '-e', script, game, ck3],
                                  cwd=STAGE / 'resources/app', env=dict(env, ELECTRON_RUN_AS_NODE='1'), text=True)
    manifest = OUTPUT / 'native-catalogues.json'
    manifest.write_text(json.dumps(json.loads(raw), indent=2) + '\n')
    return manifest


def verify():
    ensure_closed()  # A synthetic CK3 window must not attach another live companion.
    if not os.environ.get('DISPLAY'):
        raise RuntimeError('verify:linux requires the supported X11 desktop session.')
    state = Path.home() / '.local/share/votc-mimir'
    state.mkdir(parents=True, exist_ok=True)
    with (state / 'runtime.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Exit VOTC before native verification.') from None
        OUTPUT.mkdir(parents=True, exist_ok=True)
        summary = OUTPUT / 'native-verification.json'
        summary.unlink(missing_ok=True)
        electron = STAGE / 'votc-titan-edition'
        if not electron.is_file():
            raise RuntimeError('Run build:linux before verify:linux.')
        before = tree_hash(STAGE)
        (OUTPUT / 'verification-input.json').write_text(json.dumps({'application_sha256': before, 'launcher_sha256': tree_hash(ROOT / 'tools/votc-launch.sh')}, indent=2) + '\n')
        env = dict(os.environ)
        env.pop('ELECTRON_RUN_AS_NODE', None)
        with (OUTPUT / 'native-verification.log').open('w') as log:
            def run(args, timeout=60, node=False):
                subprocess.run([str(a) for a in args], cwd=ROOT,
                               env=dict(env, ELECTRON_RUN_AS_NODE='1') if node else env,
                               stdout=log, stderr=subprocess.STDOUT, check=True, timeout=timeout)
            manifest = catalogue_evidence(electron, env)
            run([electron, ROOT / 'tools/native-storage-smoke.cjs', STAGE / 'resources/app',
                 manifest, OUTPUT / REPORTS[0]], node=True)
            with tempfile.TemporaryDirectory(prefix='votc-native-verification-') as temporary:
                temporary = Path(temporary)
                probe_electron = probe_runtime(temporary / 'electron-probes')
                data, game = temporary / 'userdata', temporary / 'game'
                shutil.copytree(ROOT / 'default_userdata', data / 'votc_data')
                configs = data / 'votc_data/configs'
                configs.mkdir(parents=True, exist_ok=True)
                # The working installation contains this empty, user-owned scripts folder.
                # Empty directories are absent from the Git-backed default template.
                for directory in ('scripts/actions/custom', 'logs', 'conversation_summaries/1'):
                    (data / 'votc_data' / directory).mkdir(parents=True, exist_ok=True)
                (game / 'logs').mkdir(parents=True)
                (game / 'logs/debug.log').write_text('VOTC:conversation_history/;/1/;/0\n')
                config = json.loads((ROOT / 'default_userdata/configs/default_config.json').read_text())
                config.update(userFolderPath='Z:' + str(game).replace('/', '\\'),
                              cultureGameInstallPath='', cultureRoleplayEnabled=False,
                              faithRoleplayEnabled=False, goaLoreEnabled=False,
                              checkForUpdatesOnStartup=False)
                for name in ('textGenerationApiConnectionConfig', 'actionsApiConnectionConfig',
                             'summarizationApiConnectionConfig', 'embeddingApiConnectionConfig'):
                    connection = config[name]['connection']
                    connection.update(type='custom', baseUrl='http://127.0.0.1:9/v1', key='', model='synthetic')
                (configs / 'config.json').write_text(json.dumps(config))
                renderer, main = free_port(), free_port()
                while main == renderer:
                    main = free_port()
                child = subprocess.Popen([str(electron), '--no-sandbox', '--disable-gpu',
                                          f'--remote-debugging-port={renderer}', f'--inspect={main}'],
                                         cwd=STAGE / 'resources/app',
                                         env=dict(env, VOTC_TITAN_USER_DATA_ROOT=str(data)),
                                         stdout=log, stderr=subprocess.STDOUT)
                try:
                    wait_debugger(main, child)
                    wait_debugger(renderer, child)
                    run(['node', ROOT / 'tools/native-verification-windows.cjs', main, 'setup'])
                    run(['node', ROOT / 'tools/titan-ui-smoke.cjs', renderer, main, OUTPUT / 'native-ui'])
                    run(['node', ROOT / 'tools/native-runtime-smoke.cjs', renderer, main, OUTPUT / REPORTS[1],
                         probe_electron, data / 'votc_data', game, OUTPUT / REPORTS[0]])
                    if (STAGE / 'resources/app/public/scene-art/manifest.json').exists():
                        run(['node', ROOT / 'tools/native-scene-art-smoke.cjs', renderer, main, OUTPUT / 'native-scene-art'])
                finally:
                    if child.poll() is None:
                        try:
                            run(['node', ROOT / 'tools/native-verification-windows.cjs', main, 'quit'], timeout=15)
                            child.wait(timeout=15)
                        except (subprocess.SubprocessError, OSError):
                            # Only this owned synthetic process, never a user's companion.
                            child.terminate()
                            child.wait(timeout=15)
                env['VOTC_TITAN_PROBE_ROOT'] = str(temporary / 'overlay')
                run([probe_electron, ROOT / 'tools/native-overlay-smoke.cjs', STAGE, OUTPUT / REPORTS[2],
                     '--no-sandbox', '--disable-gpu'])
            if before != tree_hash(STAGE):
                raise RuntimeError('Native staging changed during verification.')
            for name in REPORTS:
                if not json.loads((OUTPUT / name).read_text()).get('passed'):
                    raise RuntimeError('Native check failed: ' + name)
            report = {'passed': True, 'verified_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      'application_sha256': before, 'launcher_sha256': tree_hash(ROOT / 'tools/votc-launch.sh'),
                      'reports': {name: tree_hash(OUTPUT / name) for name in REPORTS},
                      'synthetic_only': True, 'model_requests': 0}
            art = OUTPUT / 'native-scene-art/report.json'
            if (STAGE / 'resources/app/public/scene-art/manifest.json').exists():
                if not art.exists() or not json.loads(art.read_text()).get('passed'):
                    raise RuntimeError('Native scene art verification is incomplete.')
                report['scene_art_report_sha256'] = tree_hash(art)
            summary.write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps(report, indent=2))


if __name__ == '__main__':
    verify()
