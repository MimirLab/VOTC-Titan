# VOTC Titan Edition
Titan is the MimirLab-maintained GoA2 roleplay launcher.

## Game and bridge compatibility

GoA2 intentionally pins CK3 to an earlier branch. Use the CK3 version required
by GoA2. Titan communicates with the in-game VOTC Community Edition addon through
CE's command channels and debug log, and reads GoA2 game facts through that bridge.
The working tested stack is **CK3 1.19.0.6, GoA2 0.6.5 and VOTC CE 2.5.0**.
A newer CK3 label in CE's launcher descriptor is metadata, not evidence of a
runtime incompatibility. Report an actual command, probe, log or script failure
when identifying a bridge compatibility defect.

Do not report a version-mismatch bug from descriptor labels alone, or recommend
moving CK3 off GoA2's intended branch to match CE's label. Preserve the actual
source/content checks used by the lore readers; those validate game facts.

Users install CK3 on GoA2's required branch, GoA2 and VOTC CE through Steam,
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
