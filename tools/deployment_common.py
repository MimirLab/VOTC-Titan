"""Shared deployment primitives; no runtime or Wine installation is required."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import fcntl
import getpass
from contextlib import contextmanager
from storage_policy import copy_tree, file_hash


@contextmanager
def deployment_lock(state):
    state.mkdir(parents=True, exist_ok=True)
    with (state / 'runtime.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Exit VOTC before replacing or rolling back its application.') from None
        yield


def user_data_root():
    override = os.environ.get('VOTC_TITAN_USER_DATA_ROOT')
    if override:
        root = Path(override)
        if not root.is_absolute():
            raise RuntimeError('VOTC_TITAN_USER_DATA_ROOT must be absolute')
        return root
    home = Path.home()
    wine = home / '.local/share/bottles/bottles/VOTC/drive_c/users'
    app_name = 'Voices of the Court - Community Edition'
    candidates = [wine / getpass.getuser() / 'AppData/Roaming' / app_name,
                  wine / 'titan/AppData/Roaming' / app_name]
    for existing in candidates:
        if existing.is_dir():
            return existing
    return Path(os.environ.get('XDG_CONFIG_HOME', home / '.config')) / app_name


def tree_hash(path):
    path = Path(path)
    digest = hashlib.sha256()
    paths = [path] if path.is_file() else sorted(p for p in path.rglob('*') if p.is_file())
    for file in paths:
        digest.update((file.name if path.is_file() else file.relative_to(path).as_posix()).encode())
        digest.update(b'\0')
        digest.update(bytes.fromhex(file_hash(file)))
    return digest.hexdigest()


def save_existing(path, backup, name, entries):
    entries[name] = {'path': str(path), 'existed': path.exists()}
    if path.is_dir():
        copy_tree(path, backup / name, symlinks=True)
    elif path.is_file():
        shutil.copy2(path, backup / name)


def ensure_closed():
    lines = subprocess.check_output(['ps', '-eo', 'pid=,comm=,args='], text=True).splitlines()
    running = []
    for line in lines:
        fields = line.split(None, 2)
        if len(fields) != 3:
            continue
        pid, name, args = fields
        name_lower, args_lower = name.lower(), args.lower()
        try:
            executable = Path(os.readlink('/proc/' + pid + '/exe')).name.lower()
        except OSError:
            executable = ''
        chromium_main = name_lower in ('crbrowsermain', 'electron')
        if (executable in ('ck3', 'ck3.exe', 'dowser', 'votc-titan-edition') or
                name_lower in ('ck3', 'ck3.exe', 'dowser', 'paradox launcher', 'votc-titan-edit') or
                ((name_lower.startswith('voices of') or chromium_main) and
                 'voices of the court - community edition.exe' in args_lower) or
                (chromium_main and 'paradox' in args_lower)):
            running.append({'pid': int(pid), 'name': name})
    if running:
        raise RuntimeError('Close CK3, Paradox launcher and VOTC before deployment: ' + json.dumps(running))
