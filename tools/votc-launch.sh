#!/usr/bin/env bash
set -euo pipefail
export WINEPREFIX="$HOME/.local/share/bottles/bottles/VOTC"
votc_titan_state="$HOME/.local/share/votc-mimir"
mkdir -p "$votc_titan_state"
# One host lock protects the shared data across Wine and native launches.
exec 9>"$votc_titan_state/runtime.lock"
if ! flock -n 9; then
    printf 'VOTC Titan Edition is already running. Exit it before changing runtimes.\n' >&2
    exit 1
fi
votc_titan_runtime="${VOTC_TITAN_RUNTIME:-native}"
if [[ -z "${VOTC_TITAN_RUNTIME:-}" && -f "$votc_titan_state/default-runtime" ]]; then
    read -r votc_titan_runtime < "$votc_titan_state/default-runtime"
fi
if [[ "${VOTC_MIMIR_USE_UPSTREAM:-0}" == 1 ]]; then
    votc_titan_runtime=wine
fi
if [[ "$votc_titan_runtime" == native ]]; then
    votc_titan_app="$votc_titan_state/native/app-2.2.0-beta2-titan"
    if [[ ! -x "$votc_titan_app/votc-titan-edition" ]]; then
        printf 'VOTC Titan Edition for Linux is not installed. Run the native deployment tool.\n' >&2
        exit 1
    fi
    if [[ -z "${VOTC_TITAN_USER_DATA_ROOT:-}" ]]; then
        votc_titan_user_name="${USER:-$(id -un)}"
        votc_titan_data_name='Voices of the Court - Community Edition'
        VOTC_TITAN_USER_DATA_ROOT="${XDG_CONFIG_HOME:-$HOME/.config}/$votc_titan_data_name"
        for votc_titan_legacy_data in \
            "$WINEPREFIX/drive_c/users/$votc_titan_user_name/AppData/Roaming/$votc_titan_data_name" \
            "$WINEPREFIX/drive_c/users/titan/AppData/Roaming/$votc_titan_data_name"; do
            if [[ -d "$votc_titan_legacy_data" ]]; then
                VOTC_TITAN_USER_DATA_ROOT="$votc_titan_legacy_data"
                break
            fi
        done
    fi
    export VOTC_TITAN_USER_DATA_ROOT
    # Player-authorized lore playtest. Each switch accepts an explicit 0;
    # streaming and unsupported providers keep their ordinary writer.
    export VOTC_LORE_NATIVE_CHAT_STUDY="${VOTC_LORE_NATIVE_CHAT_STUDY:-1}"
    export VOTC_LORE_SPOKEN_EXPOSURE_STUDY="${VOTC_LORE_SPOKEN_EXPOSURE_STUDY:-1}"
    export VOTC_LORE_NATIVE_SCENE_STUDY="${VOTC_LORE_NATIVE_SCENE_STUDY:-1}"
    export VOTC_LORE_NATIVE_PROPOSAL_STUDY="${VOTC_LORE_NATIVE_PROPOSAL_STUDY:-1}"
    export VOTC_LORE_NATIVE_SEMANTIC_STUDY="${VOTC_LORE_NATIVE_SEMANTIC_STUDY:-1}"
    export VOTC_LORE_NATIVE_THINKING_BUDGET="${VOTC_LORE_NATIVE_THINKING_BUDGET:--1}"
    cd "$votc_titan_app/resources/app"
    "$votc_titan_app/votc-titan-edition" --disable-gpu --no-sandbox "$@"
    exit $?
fi
if [[ "$votc_titan_runtime" != wine ]]; then
    printf 'Unknown VOTC runtime: %s\n' "$votc_titan_runtime" >&2
    exit 1
fi
votc_mimir_app="$WINEPREFIX/drive_c/VOTC-Mimir/app-2.2.0-beta2-mimir/Voices of the Court - Community Edition.exe"
# Restore the original upstream selection without moving user data.
if [[ "${VOTC_MIMIR_USE_UPSTREAM:-0}" == 1 ]]; then
    votc_install="$WINEPREFIX/drive_c/users/titan/AppData/Local/voices_of_the_court_ce"
    votc_mimir_app=""
    while IFS= read -r votc_version; do
        if [[ -f "$votc_version/Voices of the Court - Community Edition.exe" ]]; then
            votc_mimir_app="$votc_version/Voices of the Court - Community Edition.exe"
            break
        fi
    done < <(printf '%s\n' "$votc_install"/app-* | sort -Vr)
fi
if [[ -z "$votc_mimir_app" || ! -f "$votc_mimir_app" ]]; then
    printf 'VOTC Titan Edition is not installed. Run the project deployment tool.\n' >&2
    exit 1
fi
cd "$(dirname "$votc_mimir_app")"
wine "$votc_mimir_app" --disable-gpu --disable-gpu-compositing --no-sandbox "$@"
