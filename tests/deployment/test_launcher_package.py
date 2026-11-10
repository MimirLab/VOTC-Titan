from pathlib import Path
import importlib.util
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('launcher_package', ROOT / 'tools/package-titan.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)

class LauncherPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.native = self.root / 'native'
        app = self.native / 'application/resources/app'
        app.mkdir(parents=True)
        (app / 'synthetic-launcher.js').write_text('launcher fixture')
        (self.native / 'votc-launch').write_text('launcher entry')
        self.seal()
    def tearDown(self):
        self.temp.cleanup()
    def seal(self):
        (self.native / 'manifest.json').write_text(json.dumps(dict(
            application_sha256=package.tree_hash(self.native / 'application'),
            launcher_sha256=package.tree_hash(self.native / 'votc-launch'),
            userdata_root='/private/synthetic-player-directory')))
    def test_real_package_contains_launcher_and_native_installer_without_game_payload(self):
        target = self.root / 'download'
        with patch.object(package, 'require_space'):
            package.package(self.native, target)
        self.assertEqual(package.tree_hash(target / 'application'), package.tree_hash(self.native / 'application'))
        self.assertFalse((target / 'game_mod').exists())
        self.assertEqual({p.name for p in (target / 'tools').iterdir()}, set(package.INSTALLER_TOOLS))
        self.assertNotIn('deploy-game-mod.py', (target / 'install.sh').read_text())
        self.assertFalse((target / 'settings').exists())
        self.assertNotIn('userdata_root', json.loads((target / 'manifest.json').read_text()))
        self.assertIn('## What you need', (target / 'INSTALL.md').read_text())
    def test_rejected_game_hook_cannot_enter_a_download_even_with_a_valid_seal(self):
        forbidden = self.native / 'application/resources/app/tools/lorebook-mutation-catalogue.json'
        forbidden.parent.mkdir()
        forbidden.write_text('retired hook policy')
        self.seal()
        target = self.root / 'download'
        with self.assertRaisesRegex(RuntimeError, 'Retired game integration'):
            package.package(self.native, target)
        self.assertFalse(target.exists())
    def test_changed_native_or_launcher_fails_before_copying(self):
        (self.native / 'votc-launch').write_text('changed')
        with self.assertRaisesRegex(RuntimeError, 'launcher changed'):
            package.package(self.native, self.root / 'download')
        self.assertFalse((self.root / 'download.candidate').exists())

if __name__ == '__main__':
    unittest.main()
