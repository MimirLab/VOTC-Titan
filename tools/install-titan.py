#!/usr/bin/env python3
"""Install the Titan launcher. CK3, subscribed mods and playsets are never edited."""
import argparse
import importlib.util
from pathlib import Path
import shutil

from deployment_common import ensure_closed, deployment_lock

PACKAGE = Path(__file__).resolve().parents[1]


def install_launcher(package=PACKAGE):
    package = Path(package)
    source = package / 'tools/deploy-native.py'
    spec = importlib.util.spec_from_file_location('titan_launcher_native_installer', source)
    native = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native)
    native.STAGE = package / 'application'
    # No game-mod deployment, Steam configuration, registry/playset writes
    # or Workshop-file copying belongs to the launcher installer.
    with deployment_lock(native.STATE):
        ensure_closed()
        native.install_locked()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    # Compatibility input only. Installation does not configure the game.
    parser.add_argument('--ck3-user', type=Path, help=argparse.SUPPRESS)
    parser.parse_args()
    if not shutil.which('wmctrl'):
        parser.error('Install wmctrl with your Linux package manager for Titan X11 taskbar integration.')
    install_launcher()
