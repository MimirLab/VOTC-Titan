# Titan language assets

The main process loads this directory through `src/main/language/languageEngine.ts`.
This is the shipped data home; `out/` research packages are not runtime dependencies.

- `routing.json`: comprehension families and direct current-cultural familiarity.
- `close-profiles.json`: all 53 readable English-source sound filters.
- `far-profiles.json`: all 53 unfamiliar voices and their inherited sound roots.
- `unicode-casefold.json`: the pinned FAR normalization table.

Routing inventory and both voice banks must match. Sound-root inheritance does
not establish comprehension. Preserve the current FAR version and vocabulary
seed when working on plumbing or CLOSE. See `src/main/language/README.md` for
the engine API, capture/history boundaries, master checkbox and verification.
