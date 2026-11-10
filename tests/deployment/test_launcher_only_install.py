from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class LauncherOnlyInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.tools = self.root / 'package/tools'
        self.tools.mkdir(parents=True)
        shutil.copyfile(ROOT / 'tools/install-titan.py', self.tools / 'install-titan.py')
        (self.tools / 'deployment_common.py').write_text(
            'from contextlib import contextmanager\n'
            '@contextmanager\ndef deployment_lock(state):\n yield\n'
            'def ensure_closed(): pass\n')
        (self.tools / 'deploy-native.py').write_text(
            'from pathlib import Path\n'
            'STATE=Path(__file__).parents[1]/"installed-launcher"\n'
            'def install_locked():\n STATE.mkdir()\n'
            ' (STATE/"receipt.json").write_text(str(STAGE))\n')
        # No game deployment or guard setup modules exist in this fixture.
        self.ck3 = self.root / 'CK3 User'
        self.ck3.mkdir()
        for name in ['dlc_load.json', 'launcher-v2.sqlite', 'mod/ce.mod', 'save games/player.ck3']:
            p = self.ck3 / name
            p.parent.mkdir(exist_ok=True)
            p.write_text('private original ' + name)
        self.before = self.snapshot()

    def tearDown(self):
        self.temp.cleanup()

    def snapshot(self):
        return {str(p.relative_to(self.ck3)): p.read_bytes() for p in self.ck3.rglob('*') if p.is_file()}

    def run_installer(self, *args):
        return subprocess.run([sys.executable, '-B', str(self.tools / 'install-titan.py'), *args],
                              text=True, capture_output=True)

    def test_real_installer_installs_only_launcher_preserving_game_state(self):
        result = self.run_installer('--ck3-user', str(self.ck3))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.snapshot(), self.before)
        self.assertEqual((self.root / 'package/installed-launcher/receipt.json').read_text(),
                         str(self.root / 'package/application'))
        self.assertFalse((self.ck3 / 'mod/votc_titan').exists())

    def test_replace_ce_is_refused_before_any_writes(self):
        result = self.run_installer('--replace-ce')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('unrecognized arguments', result.stderr)
        self.assertEqual(self.snapshot(), self.before)
        self.assertFalse((self.root / 'package/installed-launcher').exists())

    def test_help_has_no_game_mod_or_steam_setup_steps(self):
        result = self.run_installer('--help')
        self.assertEqual(result.returncode, 0)
        self.assertNotIn('replace-ce', result.stdout)
        self.assertNotIn('setup-lore-guard', result.stdout)
        self.assertEqual(self.snapshot(), self.before)


if __name__ == '__main__':
    unittest.main()
