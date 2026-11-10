# Titan source and release workflow

Titan's public home is **MimirLab/VOTC-Titan**. The project publishes source and a
separate downloadable application. Maintain the launcher-only installation
contract and preserve upstream credit through both outputs.

## Source

Use `tools/export-public-source.py` to create a reviewed source tree from the
private working repository. It excludes private Git history, the development
journal, player records, retired game-fork scripts and runtime voice/painting/lore
assets. The clean public source contains code, tests, authored scene data,
licenses, dependency lock and documentation.

The legacy `game_mod/scenes` directory contains authored regression/source JSON;
it is not an installed game addon. Private studies remain in the original working
project. Unrelated inherited setting summaries and three fonts lacking a verified
redistribution grant remain in the private archive. Public UI fonts have their
OFL notices, and typography is checked separately from RP behavior.

For a full source build:

```sh
python3 tools/import-release-assets.py /path/to/VOTC-Titan-Launcher-linux-x64.tar.gz
npm ci
npm run build
npm test -- --runInBand
npm run build:linux
```

The importer verifies the selected download and all three asset-tree digests,
extracts only runtime assets and refuses changed existing files. The native
builder rejects missing assets before making a package.

## Presentation and provenance

Keep the README's coverage figures tied to actual manifests. Clearly label
promotional illustrations and private/synthetic validation. Preserve the
[credits](../CREDITS.md), [third-party notices](../THIRD_PARTY_NOTICES.md) and
runtime attribution records. Software, original recordings, wiki-derived lore,
artwork, fonts and model weights retain their separate ownership and terms;
source preparation does not create new rights over those materials.

## Qualification and publication

Use the checks in [release validation](release-validation.md) and the pinned
source workflow. Verify native modules and actual desktop presentation in a
disposable profile. Game/RP tests need a compatible version set; transport fixtures
are not a universal gameplay or latency guarantee.

Package only a sealed native application. Verify the archive checksum and safe
paths, exclude player data and model weights, then upload the archive and checksum
to the matching GitHub prerelease/release. Update `release-assets.json` to the
exact public download. The inherited upstream Forge publisher stays disabled.

Use the maintainer's normal browser-authenticated GitHub CLI login backed by the
OS keyring, and a GitHub noreply commit address. Do not put credentials in source,
issues, commands or release manifests. See [maintenance](github-maintenance.md).
