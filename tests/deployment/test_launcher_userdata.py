from pathlib import Path
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools'))
import deployment_common as common

class LauncherUserdataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.home = patch.object(Path, 'home', return_value=self.root)
        self.home.start()
        self.user = patch.object(common.getpass, 'getuser', return_value='fresh_player')
        self.user.start()
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
    def tearDown(self):
        self.env.stop()
        self.user.stop()
        self.home.stop()
        self.temp.cleanup()
    def test_fresh_player_needs_no_wine_or_developer_username(self):
        result = common.user_data_root()
        self.assertEqual(result, self.root / '.config/Voices of the Court - Community Edition')
        self.assertFalse(result.exists())
    def test_existing_wine_userdata_is_preserved(self):
        old = self.root / '.local/share/bottles/bottles/VOTC/drive_c/users/fresh_player/AppData/Roaming/Voices of the Court - Community Edition'
        old.mkdir(parents=True)
        (old / 'sentinel').write_text('private voice settings and history')
        self.assertEqual(common.user_data_root(), old)
        self.assertEqual((old / 'sentinel').read_text(), 'private voice settings and history')
    def test_native_xdg_and_explicit_absolute_override(self):
        os.environ['XDG_CONFIG_HOME'] = str(self.root / 'native-config')
        self.assertEqual(common.user_data_root(), self.root / 'native-config/Voices of the Court - Community Edition')
        os.environ['VOTC_TITAN_USER_DATA_ROOT'] = str(self.root / 'explicit')
        self.assertEqual(common.user_data_root(), self.root / 'explicit')
        os.environ['VOTC_TITAN_USER_DATA_ROOT'] = 'relative-path'
        with self.assertRaisesRegex(RuntimeError, 'absolute'):
            common.user_data_root()

if __name__ == '__main__':
    unittest.main()
