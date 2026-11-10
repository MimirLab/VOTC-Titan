# Bundled GoA2 character voices

Titan includes 419 prepared recording banks covering 407 authored GoA2 identities.
Audio → Characters → Clone bank defaults to **Automatic — GoA2 character voices**.
Every covered identity now has a recorded default; multiple available recordings
no longer send a covered character to generated casting. Players do not need to
extract the archive, import each bank or manually choose all alternate forms.
Characters without a collected reference keep ordinary saved casting. Explicit
assignments and the per-campaign **Normal casting** opt-out retain priority.

Current verified game traits select supported alternate forms. Illidan uses his
HotS base voice unless metamorphosis/fallen demon hunter is actually observed;
being a demon or a demon hunter alone does not select metamorphosis. Arthas uses
his living paladin recording, the death knight recording when being_undead is
present, and the Lich King recording when lich_king is present. Sylvanas uses the
living ranger recording until being_undead or creature_banshee selects her HotS
Banshee Queen recording. There is no calendar-based guess. Other alternate
performances remain available as explicit overrides. Defaults prefer the normal
named portrayal, keeping pirate Garrosh, Remnant of Ner'zhul and Gall's separate
head available without blocking the base character's clone.

Identity checks belong to the audio lane after committed player text. The probe
compares only the already exported encounter participant scope with the finite
407-entry historical catalog and reads five bounded form predicates. It does not
use GetID as a history key, match display names, enumerate NPCs, mutate game
variables or add an RP/text-model request. Effective active-playset history must
match the collection's 107 hashes, including checks against later key overrides.
Script-created new individuals are not silently equated with historical scopes
by name. Unsupported histories retain manual bank assignment and ordinary casting.
Complete observations are scoped to participant objects and cleared on game reload;
incomplete, duplicated, unknown or mismatched identity/form frames are rejected.

A clone bypasses normal voice design and automatic Race, Sex, culture, age and
faith delivery instructions. Bounded performance tone and whispered thoughts
remain. The same prepared profile, reference WAV/transcript, voice identifier and
seed supply speech and thoughts. Reference-clone synthesis uses CFG 1, Breeze's
reference-matching default, even if the saved general design strength is higher.
The saved setting and narrator/ordinary guidance remain unchanged. This reduces
the risk of instruction strength overpowering the reference on short thoughts;
it is not a universal perceived-identity guarantee. Whisper instructions stay
short and preserve recorded timbre, resonance and accent without repeating a
voice-design paragraph. Local synthesis receipts record profile/bank/digests and
effective guidance, without copying dialogue into diagnostics.

Opening narration is one complete first sentence, buffered fully before playback.
Later narration retains ordinary sentence grouping. The serial producer prepares
each voice when it first reaches that role, so character design/reference creation
cannot hold up a completed narrator opening. Character synthesis can then proceed
while narration plays. The continuous 8 MiB future-PCM budget, full-utterance
playback, literary order, pause/stop behavior and 300 ms inter-performance breath
remain. No sentence is cut to hit a startup timer.

References remain ready mono 24 kHz PCM16 WAVs. Only encountered clones are copied
into the private library; the existing Breeze codec cache is reused. No original
pools, auditions, model weights or personal voices are bundled. Existing generated
profiles and frozen historical replay receipts are preserved. Use Preview saved
voice or a new reply to exercise the repaired current routing; an old replay keeps
its original voice. Apply Automatic to restore discovery after an explicit opt-out.

The r14 repair is based on exact native r13. Evidence is under
out/audio-routing-repair-20261015/. All 2,894 isolated checks/99 suites (two existing
skips), 22 deployment/build/reset checks, four native reports, six actual Audio UI
checks and the compiled pipeline pass. The player's r13 game log already records
Illidan matching history key 340009; the old null default caused generated casting.
Five compiled synthetic participant cases verify ordinary defaults, player Illidan,
undead Arthas, Lich King Arthas and unknown participants. Fresh in-game execution
of the new form predicates remains a player test; the agent launched no CK3.

Six real Vulkan/Q8 renders compare old/new Thrall speech/thought delivery on the
identical bank and packed/first-sentence openings on the unchanged saved narrator.
All generated WAVs are retained locally. Unprompted CPU ASR matches five targets
exactly after normalization, including both repaired Thrall renders and the new
opening. The old packed opening substitutes one article. In this one warm sample,
complete synthesis fell from 8.38 seconds for the packed opening to 1.71 seconds
for its complete first sentence. This excludes cold preparation/physical playback,
is not concurrent-game performance evidence and does not certify perceived voice
identity or listening quality. Human listening and the broader crash/RP work remain
open. Upstream application updating remains removed.

## Trait refresh follow-up r15

Stable identity and current performance form now have separate lifetimes. For a
covered identity with automatic form rules, each new unrecorded reply or character
preview rechecks the five form predicates on that participant. A cached historical
identity narrows later probes to that one identity; there is no repeated world or
407-character scan. A newly read form frame is authoritative and an older general
body snapshot cannot override it. Characters without form rules reuse the identity
observation. Recorded historical replays retain their original voice.

This handles a story transformation within the same open encounter and its reversal.
Returning to a previous form reactivates the existing exact bank/profile/reference;
it does not regenerate the voice or create another revision. Tests exercise Illidan
base → metamorphosis → base and Arthas living → undead → Lich King → living, including
a stale general snapshot. The exact staged suite passes 2,897 checks/100 suites with
two existing skips. This changes only cloneRuntime.ts and its emitted JS/map over
r14; all recordings, synthesis, whisper guidance and opening playback stay exact.
Fresh actual game execution remains a player test. Receipts:
out/audio-trait-refresh-20261015/. The six actual Q8 renders remain r14 evidence.
