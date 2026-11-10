# VOTC Titan Edition
Titan is the MimirLab-maintained GoA2 roleplay launcher.

Keep all runtime changes in the launcher. Users install compatible CK3, GoA2 and
VOTC Community Edition through Steam, then install Titan. Never require a Titan
game fork, edited Workshop/base files or a Steam launch wrapper.
Preserve upstream attribution and the software license. Third-party assets keep
their own terms; source attribution alone is not a redistribution grant.

Import the checksum-verified runtime assets before building (see README).
Use npm ci, npm run build, and npm test -- --runInBand. The native target is Linux
x64 with X11; other platform binaries need their own qualification.
Keep player settings, voice identities, histories and libraries private.
Never include model weights or player data in a public source export.
Keep maintenance links under the configured MimirLab project, not upstream.
Do not publish, push, install services or spawn agents unless explicitly requested.
