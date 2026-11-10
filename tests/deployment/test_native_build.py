"""Default-template copying must not package runtime histories or diagnostic logs."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
import hashlib
import io
import json
import tarfile

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / 'tools'))
spec = importlib.util.spec_from_file_location('native_build', PROJECT / 'tools/build-native.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class NativeBuildDefaultsTest(unittest.TestCase):
    def test_runtime_records_are_excluded_and_authored_nested_paths_survive(self):
        with tempfile.TemporaryDirectory(prefix='titan-default-copy-') as directory:
            root = Path(directory)
            source, target = root / 'source', root / 'target'
            for name in ['conversation_history', 'conversation_summaries', 'logs', 'audio']:
                (source / name / 'nested').mkdir(parents=True)
                (source / name / 'nested/sensitive.txt').write_text('Synthetic runtime sentinel')
            files = {'configs/default_config.json': '{}', 'scripts/actions/custom/logs/example.js': 'authored custom script'}
            for name, content in files.items():
                file = source / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(content)
            builder.copy_default_userdata(source, target)
            for name in ['conversation_history', 'conversation_summaries', 'logs', 'audio']:
                self.assertEqual(list((target / name).iterdir()), [])
                self.assertEqual((source / name / 'nested/sensitive.txt').read_text(), 'Synthetic runtime sentinel')
            for name, content in files.items():
                self.assertEqual((target / name).read_text(), content)

    def test_removed_upstream_client_cannot_be_repackaged_from_old_development_modules(self):
        with tempfile.TemporaryDirectory(prefix='titan-no-updater-') as directory:
            modules = Path(directory)
            (modules / 'update-electron-app').mkdir()
            (modules / 'update-electron-app/index.js').write_text('old replacement client')
            (modules / 'better-sqlite3').mkdir()
            (modules / 'better-sqlite3/sentinel').write_bytes(b'preserve native ABI')
            builder.remove_upstream_client(modules)
            builder.remove_upstream_client(modules)
            self.assertFalse((modules / 'update-electron-app').exists())
            self.assertEqual((modules / 'better-sqlite3/sentinel').read_bytes(), b'preserve native ABI')

    def test_missing_runtime_directories_get_empty_layout(self):
        with tempfile.TemporaryDirectory(prefix='titan-default-layout-') as directory:
            root = Path(directory)
            (root / 'source').mkdir()
            builder.copy_default_userdata(root / 'source', root / 'target')
            self.assertEqual({p.name for p in (root / 'target').iterdir()}, {'conversation_history', 'conversation_summaries', 'logs', 'audio'})

class LauncherRuntimeToolTest(unittest.TestCase):
    def test_only_runtime_readers_are_shipped_and_retired_hooks_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, target = root / 'source', root / 'target'
            source.mkdir()
            target.mkdir()
            for name in builder.RUNTIME_TOOLS:
                (source / name).write_text('runtime ' + name)
            (source / 'private-review.json').write_text('do not ship')
            for name in ['lorebook-mutation-catalogue.json', 'goa-lore-game-preflight.py', 'goa_lore_game_guard.py']:
                (target / name).write_text('retired game hook')
            builder.copy_runtime_tools(source, target)
            self.assertEqual({p.name for p in target.iterdir()}, set(builder.RUNTIME_TOOLS))
            self.assertTrue((source / 'private-review.json').exists())

    def test_missing_runtime_reader_fails_before_any_destination_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, target = root / 'source', root / 'target'
            source.mkdir()
            for name in builder.RUNTIME_TOOLS[:-1]:
                (source / name).write_text('runtime')
            with self.assertRaisesRegex(RuntimeError, 'Missing launcher runtime'):
                builder.copy_runtime_tools(source, target)
            self.assertFalse(target.exists())


class MissingRuntimeAssetsTest(unittest.TestCase):
    def test_source_only_checkout_fails_before_build_output_is_created(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(RuntimeError, 'import-release-assets.py'):
                builder.require_runtime_assets(root)
            self.assertFalse((root / 'out').exists())


class QualifiedSqlitePrebuiltTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.modules = self.root / 'modules'
        self.package = self.modules / 'better-sqlite3'
        self.target = self.package / 'build/Release/better_sqlite3.node'
        self.target.parent.mkdir(parents=True)
        self.target.write_bytes(b'keep current native module')
        (self.package / 'package.json').write_text(json.dumps({'version': '11.10.0'}))
        self.archive = self.root / 'prebuilt.tar.gz'
        self.native = b'Synthetic qualified native fixture'
        self.policy = self.root / 'policy.json'
        self.make_archive('build/Release/better_sqlite3.node')

    def make_archive(self, member):
        with tarfile.open(self.archive, 'w:gz') as bundle:
            entry = tarfile.TarInfo(member)
            entry.size = len(self.native)
            bundle.addfile(entry, io.BytesIO(self.native))
        self.policy.write_text(json.dumps({
            'package_version': '11.10.0', 'electron_abi': '130', 'platform': 'linux-x64',
            'url': 'https://example.invalid/not-used', 'member': 'build/Release/better_sqlite3.node',
            'archive_sha256': hashlib.sha256(self.archive.read_bytes()).hexdigest(),
            'module_sha256': hashlib.sha256(self.native).hexdigest()}))

    def install(self):
        return builder.install_sqlite_prebuilt(self.modules, self.archive, self.policy)

    def test_verified_native_is_installed_once_without_changing_other_packages(self):
        marker = self.modules / 'other-package.txt'
        marker.write_text('preserve sibling')
        self.assertTrue(self.install())
        self.assertEqual(self.target.read_bytes(), self.native)
        self.assertEqual(marker.read_text(), 'preserve sibling')
        self.assertFalse(self.install())

    def test_bad_archive_checksum_preserves_existing_native(self):
        self.archive.write_bytes(self.archive.read_bytes() + b'changed')
        with self.assertRaisesRegex(RuntimeError, 'archive checksum mismatch'):
            self.install()
        self.assertEqual(self.target.read_bytes(), b'keep current native module')

    def test_unexpected_archive_path_is_refused_before_module_change(self):
        self.make_archive('../outside.node')
        with self.assertRaisesRegex(RuntimeError, 'Unexpected SQLite prebuilt contents'):
            self.install()
        self.assertEqual(self.target.read_bytes(), b'keep current native module')
        self.assertFalse((self.root / 'outside.node').exists())

    def test_changed_package_version_requires_review_before_replacement(self):
        (self.package / 'package.json').write_text(json.dumps({'version': '12.0.0'}))
        with self.assertRaisesRegex(RuntimeError, 'changed SQLite version'):
            self.install()
        self.assertEqual(self.target.read_bytes(), b'keep current native module')


if __name__ == '__main__':
    unittest.main()
