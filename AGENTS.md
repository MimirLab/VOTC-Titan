# VOTC Titan Edition
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
