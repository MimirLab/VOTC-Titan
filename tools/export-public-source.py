#!/usr/bin/env python3
"""Prepare a source-only upload tree without Git history, private journals or runtime assets."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DOCS = {
 'launcher-only-installation.md', 'github-release-preparation.md', 'github-maintenance.md', 'audio-banks-live.md',
 'getting-started.md', 'features.md', 'release-validation.md',
 'audio-recovery.md', 'audio-undead-reference-review.json', 'audio-clone-baseline-review.json',
 'goa-lore-steering.md', 'audio-casting.md', 'audio-integration.md', 'audio-development.md',
}
TOOLS = {
 'build-native.py', 'deploy-native.py', 'deployment_common.py', 'storage_policy.py',
 'native-sqlite-prebuilt.json',
 'install-titan.py', 'package-titan.py', 'verify-native.py', 'votc-launch.sh', 'start-native.sh',
 'native-storage-smoke.cjs', 'native-runtime-smoke.cjs', 'native-overlay-smoke.cjs',
 'native-background-fixtures.json',
 'native-verification-windows.cjs', 'native-scene-art-smoke.cjs', 'titan-ui-smoke.cjs',
 'language-ui-smoke.cjs',
 'background-purge-ui-smoke.cjs', 'scene-menu-smoke.cjs',
 'clipboard-peer.cjs', 'import-release-assets.py', 'export-public-source.py',
 'audit-goa-lore.cjs', 'lorebook-worker.py', 'lorebook_disclosure.py',
 'lorebook_campaign_clock.py', 'lorebook_observed.py', 'lorebook-observed-bindings.json',
 'lorebook_mutations.py', 'lorebook_game_state.py', 'lorebook-game-state-catalogue.json',
 'launcher-scene-policy.json',
 'enable-titan-scenes.py', 'build-titan-scene-addon.py', 'install-titan-scene-addon.py',
 'build-game-mod.py', 'goa_timeline_audit.py', 'world_art_provenance.py', 'scene_admission.py',
 'scene_presentation_contract.py', 'world_scene_contract.py', 'titan-scenes-qualification.json',
}
PY_TESTS = {
 'test_native_build.py', 'test_launcher_only_install.py', 'test_launcher_package.py',
 'test_launcher_userdata.py', 'test_import_release_assets.py',
}
PUBLIC_AGENTS = """# VOTC Titan Edition
Titan is the MimirLab-maintained GoA2 roleplay launcher.

Users install compatible CK3, GoA2 and VOTC Community Edition through Steam,
then install Titan. Runtime changes belong in the launcher. The optional Titan
Scenes add-on is limited to the native venue picker and builds from the user's
Workshop files. Keep a stock Steam setup usable with the launcher alone.
Before publishing, compare GitHub main and the qualified local launcher.
Carry forward verified fixes from parallel work and use fast-forward updates.
Preserve upstream attribution and the software license. Third-party assets keep
their own terms; source attribution alone is not a redistribution grant.

Import the checksum-verified runtime assets before building (see README).
Use npm ci, npm run build, and npm test -- --runInBand. The native target is Linux
x64 with X11; other platform binaries need their own qualification.
Keep player settings, voice identities, histories and libraries private.
Never include model weights or player data in a public source export.
Keep maintenance links under the configured MimirLab project, not upstream.
Do not publish, push, install services or spawn agents unless explicitly requested.
"""

def selected(name):
    p = Path(name)
    if name in {'public/assets/GitanLatin-Regular.otf', 'public/assets/Paradox_King_Script.otf',
                'public/assets/ZiKuXingQiuFeiYangTi-2.ttf'}:
        return False
    if name in {'AGENTS.md','LICENSE','README.md','README.upstream.md','CONTRIBUTING.md','SECURITY.md',
                'CREDITS.md','THIRD_PARTY_NOTICES.md','.gitignore',
                'package.json','package-lock.json','tsconfig.json','forge.config.js',
                'jest.config.js','jest.resolver.js','release-assets.json'}:
        return True
    if name in {'.github/ISSUE_TEMPLATE/bug_report.yml', '.github/pull_request_template.md',
                '.github/workflows/source-checks.yml'}:
        return True
    if p.parts[0] in {'src','__mocks__','build','public'}:
        return True
    if p.parts[0] == 'default_userdata':
        return len(p.parts)>1 and p.parts[1] in {'configs','scripts'}
    if name == 'game_mod/overrides/gui/custom_gui/votc_scene_selector.gui':
        return True
    if p.parts[0] == 'game_mod':
        return len(p.parts)==3 and p.parts[1]=='scenes' and p.suffix=='.json'
    if p.parts[0] == 'docs':
        if len(p.parts)==3 and p.parts[1] in {'media','licenses'}:
            return p.suffix.lower() in {'.md','.txt','.svg','.png','.jpg','.webp'}
        return len(p.parts)==2 and p.name in DOCS
    if p.parts[0] == 'tools':
        return len(p.parts)==2 and p.name in TOOLS
    if p.parts[0] == 'tests':
        return p.suffix in {'.ts','.json','.txt','.log'} or p.name in PY_TESTS
    return False

def export(target):
    target=Path(target).resolve()
    if target.exists():
        raise RuntimeError('Inspect the existing public-source candidate before replacing it.')
    names=[n.decode() for n in subprocess.check_output(
        ['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=ROOT).split(b'\0') if n]
    files={}
    target.mkdir(parents=True)
    for name in sorted(set(names)):
        if not selected(name):
            continue
        source=ROOT/name
        if source.is_symlink() or not source.is_file():
            continue
        destination=target/name
        destination.parent.mkdir(parents=True,exist_ok=True)
        if name=='AGENTS.md':
            destination.write_text(PUBLIC_AGENTS)
        else:
            shutil.copy2(source,destination)
        files[name]=hashlib.sha256(destination.read_bytes()).hexdigest()
    report={'sourceFiles':len(files),'sourceBytes':sum((target/p).stat().st_size for p in files),
            'gitHistoryIncluded':False,'privateJournalIncluded':False,'runtimeAssetsIncluded':False,
            'thirdPartyNotices':'THIRD_PARTY_NOTICES.md','files':files}
    (target/'PUBLIC-SOURCE-MANIFEST.json').write_text(json.dumps(report,indent=2)+'\n')
    return {k:v for k,v in report.items() if k!='files'}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target',type=Path,required=True)
    args=parser.parse_args()
    print(json.dumps(export(args.target),indent=2))
