#!/usr/bin/env bash
set -euo pipefail
votc_project="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
votc_titan_state="$HOME/.local/share/votc-mimir"
mkdir -p "$votc_titan_state"
exec 9>"$votc_titan_state/runtime.lock"
if ! flock -n 9; then
    printf 'VOTC Titan Edition is already running. Exit it before starting a development build.\n' >&2
    exit 1
fi
cd "$votc_project"
python tools/build-native.py
if [[ -z "${VOTC_TITAN_USER_DATA_ROOT:-}" ]]; then
    VOTC_TITAN_USER_DATA_ROOT="$(PYTHONPATH="$votc_project/tools" python3 -c 'from deployment_common import user_data_root; print(user_data_root())')"
fi
export VOTC_TITAN_USER_DATA_ROOT
votc_titan_app="$votc_project/out/titan-rebrand/native/application"
cd "$votc_titan_app/resources/app"
exec "$votc_titan_app/votc-titan-edition" --disable-gpu --no-sandbox "$@"
