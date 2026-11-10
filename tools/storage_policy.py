"""Bounded native build storage. No runtime/userdata writes, hardlinks or world data."""
import errno
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import time
import warnings

MIN_FREE_BYTES = 30 * 1024 ** 3
KEEP_ROLLBACKS = 3
KEEP_STAGES = 2
KEEP_PORTABLE_PRIORS = 1
CHUNK = 4 * 1024 ** 2
_clone_support = {}
_verified_objects = {}


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(CHUNK), b''):
            digest.update(chunk)
    return digest.hexdigest()


def require_space(destination, additional_bytes=0, reserve=MIN_FREE_BYTES):
    path = Path(destination)
    while not path.exists():
        path = path.parent
    free = shutil.disk_usage(path).free
    needed = max(0, int(additional_bytes)) + reserve
    if free < needed:
        raise RuntimeError('Insufficient build space: %.1f GiB free; need %.1f GiB '
                           'including a %.0f GiB reserve. Run tools/maintain-storage.py '
                           'plan, then apply its reviewed plan; live files were not changed.' %
                           (free / 1024**3, needed / 1024**3, reserve / 1024**3))


def tree_bytes(path):
    total = 0
    for current, dirs, files in os.walk(path, followlinks=False):
        dirs[:] = [d for d in dirs if not (Path(current) / d).is_symlink()]
        for name in files:
            file = Path(current) / name
            if not file.is_symlink():
                total += file.stat().st_size
    return total


def copy_file(source, destination):
    """Independent copy, using CoW where supported. Replacing never edits a shared inode."""
    source, destination = Path(source), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.titan-copy-', dir=destination.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(fd, 'wb') as target, source.open('rb') as original:
            devices = (source.stat().st_dev, os.fstat(target.fileno()).st_dev)
            cloned = False
            if _clone_support.get(devices, True):
                try:
                    fcntl.ioctl(target.fileno(), 0x40049409, original.fileno())  # FICLONE
                    cloned = True
                except OSError as error:
                    if error.errno not in (errno.EOPNOTSUPP, errno.ENOTTY, errno.EXDEV, errno.EINVAL, errno.ENOSYS):
                        raise
                    _clone_support[devices] = False
            if not cloned:
                shutil.copyfileobj(original, target, CHUNK)
        shutil.copystat(source, temporary)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return str(destination)


def copy_tree(source, destination, **kwargs):
    return shutil.copytree(source, destination, copy_function=copy_file, **kwargs)


def _walk(path):
    for current, dirs, files in os.walk(path, followlinks=False):
        current = Path(current)
        for name in list(dirs):
            if (current / name).is_symlink():
                yield current / name
                dirs.remove(name)
            elif name in ('node_modules', '.git'):
                dirs.remove(name)
        for name in files:
            yield current / name


def _payloads(root, kind):
    """Retain exact source, generated code, authored data and tests; omit reproducible runtimes."""
    if kind == 'native-stage':
        app = root / 'resources/app'
        prefixes = [('resources/app/' + n, app / n) for n in
                    ('src', 'dist', 'public', 'default_userdata', 'docs', 'build/icons')]
        singles = ['resources/app/' + n for n in ('package.json', 'LICENSE', 'README.md', 'README.upstream.md', 'node_modules/.package-lock.json')]
    elif kind == 'native-backup':
        for name, path in _payloads(root / 'application', 'native-stage'):
            yield 'application/' + name, path
        for path in root.iterdir():
            if path.is_file() and not path.is_symlink():
                yield path.name, path
        return
    elif kind == 'portable-prior':
        for name, path in _payloads(root / 'application', 'native-stage'):
            yield 'application/' + name, path
        prefixes = [('game_mod', root / 'game_mod'), ('tools', root / 'tools')]
        singles = [p.name for p in root.iterdir() if p.is_file()]
    else:
        prefixes = [('', root)]
        singles = []
    seen = set()
    for prefix, directory in prefixes:
        if not directory.is_dir() or directory.is_symlink():
            continue
        for path in _walk(directory):
            name = '/'.join(x for x in (prefix, path.relative_to(directory).as_posix()) if x)
            if name not in seen:
                seen.add(name)
                yield name, path
    for name in singles:
        path = root / name
        if path.is_file() and name not in seen:
            yield name, path


def archive_sources(root, kind, archive_root):
    """Keep compact evidence and one independent object per large content hash, before retiring."""
    root, archive_root = Path(root), Path(archive_root)
    archive_root.mkdir(parents=True, exist_ok=True)
    identity = hashlib.sha256(str(root).encode()).hexdigest()[:16]
    archive = archive_root / (root.name + '-' + identity + '-' + str(time.time_ns()) + '.tar.gz')
    if archive.exists():
        raise RuntimeError('A source archive already exists; inspect before retiring again: ' + str(archive))
    manifest = {'source': str(root), 'kind': kind, 'files': [], 'omitted':
                ['Rebuildable Electron runtime and node_modules; dependency lock retained when available.']}
    temporary = archive.with_suffix('.partial')
    try:
        with tarfile.open(temporary, 'w:gz', compresslevel=3, dereference=False) as output:
            for name, path in _payloads(root, kind):
                before = path.lstat()
                if path.is_symlink():
                    manifest['files'].append({'path': name, 'symlink': os.readlink(path)})
                    output.add(path, arcname='tree/' + name, recursive=False)
                    continue
                sha = file_hash(path)
                entry = {'path': name, 'sha256': sha, 'bytes': before.st_size}
                if before.st_size >= 256 * 1024:
                    obj = archive_root / 'objects' / sha[:2] / sha
                    if not obj.exists():
                        copy_file(path, obj)
                    stat = obj.stat()
                    stamp = (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns)
                    if _verified_objects.get(stamp) != sha:
                        if file_hash(obj) != sha:
                            raise RuntimeError('Retained object hash mismatch: ' + str(obj))
                        _verified_objects[stamp] = sha
                    entry['object'] = obj.relative_to(archive_root).as_posix()
                else:
                    output.add(path, arcname='tree/' + name, recursive=False)
                after = path.lstat()
                if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
                    raise RuntimeError('Source changed while archiving: ' + str(path))
                manifest['files'].append(entry)
            body = json.dumps(manifest, indent=2).encode()
            info = tarfile.TarInfo('retired-tree-manifest.json'); info.size = len(body)
            output.addfile(info, io.BytesIO(body))
        with tarfile.open(temporary, 'r:gz') as check:
            stored = json.load(check.extractfile('retired-tree-manifest.json'))
            for entry in stored['files']:
                if 'sha256' in entry and 'object' not in entry:
                    digest = hashlib.sha256()
                    with check.extractfile('tree/' + entry['path']) as stream:
                        for chunk in iter(lambda: stream.read(CHUNK), b''):
                            digest.update(chunk)
                    if digest.hexdigest() != entry['sha256']:
                        raise RuntimeError('Source archive verification failed')
        temporary.chmod(0o600); temporary.replace(archive)
    finally:
        temporary.unlink(missing_ok=True)
    return {'archive': str(archive), 'archiveSha256': file_hash(archive), 'retainedFiles': len(manifest['files'])}


def valid_backup(path):
    try:
        data = json.loads((path / 'deployment.json').read_text())
        entries = data['entries']
        package = json.loads((path / 'application/resources/app/package.json').read_text())
        return (path.is_dir() and not path.is_symlink() and not (path / 'application').is_symlink() and entries['application']['existed'] and
                package.get('votcMimirDeployment') and package.get('votcTitanRuntime') == 'linux-x64' and
                (path / 'application/resources/app/dist/main/main.js').is_file() and
                all(not v['existed'] or (path / name).exists() or name in ('desktop', 'test-launcher') for name, v in entries.items()))
    except (OSError, ValueError, KeyError, TypeError):
        return False


def prune_backups(state, keep=KEEP_ROLLBACKS):
    """Call only after a successful guarded install. Incomplete/explicitly pinned backups remain."""
    state = Path(state); parent = state / 'native-deployments'
    if not parent.is_dir():
        return []
    complete = sorted(p for p in parent.iterdir() if valid_backup(p))
    retired = []
    for path in complete[:-keep]:
        if (path / '.titan-keep').exists():
            continue
        try:
            receipt = archive_sources(path, 'native-backup', state / 'native-retired-sources')
            shutil.rmtree(path)
            retired.append({'path': str(path), **receipt})
        except (OSError, RuntimeError, ValueError) as error:
            warnings.warn('Installed app is safe; old rollback retained: ' + str(error))
    if retired:
        log = state / 'native-retired-sources/retirements.jsonl'
        with log.open('a') as stream:
            for row in retired:
                stream.write(json.dumps(row) + '\n')
    return retired


def promote_portable(candidate, target, archive_root):
    """Keep the working portable until its fully built replacement is ready; retain one predecessor."""
    candidate, target = Path(candidate), Path(target)
    prior = target.parent / 'portable-previous'
    if prior.exists():
        if prior.is_symlink() or pinned_portable(prior):
            raise RuntimeError('Previous portable is pinned or a symlink; preserve it and inspect')
        archive_sources(prior, 'portable-prior', archive_root)
        shutil.rmtree(prior)
    if target.exists():
        target.rename(prior)
    try:
        candidate.rename(target)
    except BaseException:
        if prior.exists() and not target.exists(): prior.rename(target)
        raise
    return prior


def pinned_portable(path):
    return (path / '.titan-keep').exists() or not (path / 'application/resources/app/package.json').is_file()
