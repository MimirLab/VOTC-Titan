# GitHub maintenance

The public home for Titan is `MimirLab/VOTC-Titan`. Titan remains a launcher-only
project for the subscribed GoA2 and VOTC CE addons.

GoA2 intentionally pins CK3 to an earlier branch. Use the CK3 version required
by GoA2. Titan communicates with the in-game VOTC Community Edition addon through
CE's command channels and debug log, and reads GoA2 game facts through that bridge.
The working tested stack is **CK3 1.19.0.6, GoA2 0.6.5 and VOTC CE 2.5.0**.
A newer CK3 label in CE's launcher descriptor is metadata, not evidence of a
runtime incompatibility. Report an actual command, probe, log or script failure
when identifying a bridge compatibility defect.

## Maintainer access

GitHub CLI is installed for the maintainer's Linux user. Its browser login uses
the desktop keyring; Git over HTTPS uses the CLI credential helper. This login
is shared by terminals running as that user. The desktop keyring may need to be
unlocked after a new login. Automatic refresh is enabled for the current login;
reauthorize through the browser when GitHub requires it.

The publication checkout uses the account's verified GitHub noreply commit
address. Do not put passwords, personal access tokens, authentication codes or
keyring exports in Git, issues, CI settings or release assets. GitHub-hosted CI
uses its own read-only job token for source checks, not this desktop login.

Check access without displaying credentials:

```sh
gh auth status --active --hostname github.com
gh repo view MimirLab/VOTC-Titan
```

On another computer, install Git and GitHub CLI, perform a new browser login and run
`gh auth setup-git --hostname github.com`; do not copy the credential files.

## Routine changes

Use the clean publication repository for public branches. The original working
project has private research and unrelated history; do not push it as the public
repository. Keep private evidence outside the source tree and summarize relevant
validation in pull requests.

```sh
git switch main
git pull --ff-only
git switch -c fix/descriptive-name
# Make and validate the change.
git add <reviewed-files>
git diff --cached
git commit -m "Describe the resulting behavior"
git push -u origin HEAD
gh pr create --base main
```

Use `gh issue list`, `gh pr checks`, `gh run list` and `gh release list` for routine
maintenance. Do not route Titan issues or releases to the original VOTC project.
Avoid force pushes to main and preserve existing recovery receipts.

## Validation

Source checks install the lockfile, compile TypeScript and exercise maintenance
links plus the asset-import/native-build guards. The workflow is pinned to
official action commits, uses read-only repository access and cannot publish.
These checks do not synthesize voices, call the RP model or launch CK3.

Full qualification needs the verified runtime bundle from `release-assets.json`:

```sh
python3 tools/import-release-assets.py /path/to/VOTC-Titan-Launcher-linux-x64.tar.gz
npm ci
npm run build
npm test -- --runInBand
python3 -m unittest discover -s tests/deployment -p 'test_*.py'
node tests/helpers/renderer-integrity.cjs
```

Historical listening tests retain explicit skips when their private evidence is
absent. Review the reported skips; do not hide a production regression as an
archival omission. Native and game acceptance require their own compatible
Linux/X11 setup, disposable profile, checksums and appropriate playtest.

## Releases

Keep application archives and their checksums in GitHub Releases. Keep source
changes in ordinary Git. Do not add runtime recordings, paintings, model weights
or player libraries to source history. Preserve separate software and asset
notices and the provenance review described in `github-release-preparation.md`.

After qualification, use a distinct Titan release tag and prepare a draft release
with the exact verified archive and checksum. Review the draft's contents and
GoA2 CK3 branch and working CE bridge before publishing it. Do not enable the inherited upstream
Forge publisher. A GitHub release does not automatically replace the installed
launcher; installation still follows the verified native deployment process.
