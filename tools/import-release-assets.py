#!/usr/bin/env python3
"""Restore exact runtime assets from a checksum-verified Titan download; never install the app or game."""
import argparse
import copy
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import tempfile
from deployment_common import tree_hash
from storage_policy import require_space

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ('audio', 'scene-art', 'lorebook/bundle')

def digest(file):
    value = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()

def import_assets(archive, root=ROOT, policy_file=None):
    archive, root = Path(archive), Path(root)
    policy = json.loads(Path(policy_file or root / 'release-assets.json').read_text())
    if digest(archive) != policy['archive_sha256']:
        raise RuntimeError('The download checksum does not match release-assets.json.')
    prefix = policy['archive_public_prefix']
    if not prefix.endswith('/') or PurePosixPath(prefix).is_absolute() or '..' in PurePosixPath(prefix).parts:
        raise RuntimeError('Invalid release asset prefix.')
    sizes = policy.get('asset_bytes', {})
    estimate = sum(sizes.values()) if sizes else archive.stat().st_size
    require_space(root, 2 * estimate)
    scratch = root / 'out'
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='titan-release-assets-', dir=scratch) as directory:
        staged = Path(directory)
        selected = 0
        with tarfile.open(archive, 'r:*') as tar:
            for original in tar:
                if not original.name.startswith(prefix):
                    continue
                relative = original.name[len(prefix):]
                if not any(relative == a or relative.startswith(a + '/') for a in ASSETS):
                    continue
                if PurePosixPath(relative).is_absolute() or '..' in PurePosixPath(relative).parts:
                    raise RuntimeError('Unsafe release asset entry.')
                member = copy.copy(original)
                member.name = 'public/' + relative
                if member.islnk():
                    if not member.linkname.startswith(prefix):
                        raise RuntimeError('External asset hardlink.')
                    member.linkname = 'public/' + member.linkname[len(prefix):]
                tar.extract(member, staged, filter='data')
                selected += 1
        if not selected:
            raise RuntimeError('The archive contains no runtime assets.')
        missing = []
        for name in ASSETS:
            source, target = staged / 'public' / name, root / 'public' / name
            if not target.resolve().is_relative_to(root.resolve()):
                raise RuntimeError('Asset destination escapes the checkout.')
            if not source.is_dir() or tree_hash(source) != policy['asset_tree_sha256'][name]:
                raise RuntimeError('Extracted asset edition differs: ' + name)
            expected = {p.relative_to(source).as_posix(): p for p in source.rglob('*') if p.is_file() or p.is_symlink()}
            current = {p.relative_to(target).as_posix(): p for p in target.rglob('*') if p.is_file() or p.is_symlink()} if target.exists() else {}
            if current.keys() - expected.keys():
                raise RuntimeError('Unrecognized existing runtime assets: ' + name)
            for relative, src in expected.items():
                dst = target / relative
                if src.is_symlink() and not src.resolve().is_relative_to(source.resolve()):
                    raise RuntimeError('Asset symlink escapes its asset set.')
                if not dst.parent.resolve().is_relative_to(target.resolve()):
                    raise RuntimeError('Existing asset path escapes its destination.')
                if dst.exists() or dst.is_symlink():
                    same = src.is_symlink() and dst.is_symlink() and src.readlink() == dst.readlink() or                         not src.is_symlink() and not dst.is_symlink() and dst.is_file() and digest(src) == digest(dst)
                    if not same:
                        raise RuntimeError('An existing asset differs; no files replaced: ' + name + '/' + relative)
                else:
                    missing.append((src, dst))
        # All archive hashes and existing paths are checked before the first source-tree write.
        for src, dst in missing:
            dst.parent.mkdir(parents=True, exist_ok=True)
            if src.is_symlink():
                dst.symlink_to(src.readlink())
            else:
                shutil.copy2(src, dst)
        return {'importedFiles': len(missing), 'assetSets': list(ASSETS), 'appInstalled': False, 'gameFilesWritten': False}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, help='Verified local Titan launcher tar.gz download')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'release-assets.json')
    args = parser.parse_args()
    print(json.dumps(import_assets(args.archive, ROOT, args.manifest), indent=2))
