# Developing voices and the stable adult reference

Generated characters first encountered in childhood receive a provisional individual
voice. Their current traits guide the attached text model, without predicting
future temperament. Childhood and adolescent performances reuse that reference.
On their first voiced encounter after CK3 declares adulthood (normally 16), the
attached text model finalizes the individual description using current traits.
Breeze then makes one neutral adult reference conditioned on the original reference
when one exists. Its original seed, compatible vocal texture, Sex and learned accent
carry forward. The provisional reference remains available for recorded childhood
replies and earlier saves.

The adult reference is the stable voice from 16 onward. At ages **16–19 inclusive**,
Breeze receives a short youthful performance direction on speech and thoughts.
At **20**, that direction drops away; the reference is reused without another
identity design or recording. This is the user's corrected boundary, superseding
the initially discussed 18. CK3's native adulthood flag still determines adulthood;
the numeric check at 20 determines only the end of youthful delivery.

A character first encountered as an adult receives the standard adult design once.
There is no unused childhood reference to generate. Work runs only for actually
encountered voiced identities, not the world's population. Changes to current
Race/form retain the existing paired form behavior.

## Traits and speaking habits

The audio-owned maturity probe now reads personality and childhood traits in the
same current-participant frame, using native `every_character_trait` with
`has_trait_category` filters. Existing VotC export and installed CK3 effect scripts
provide these primitives. Category labels in the protocol are literal canonical
categories; localized native trait names remain reference data. No definition scan,
world scan, character mutation or change to the RP capture lane is needed.

The complete frame takes priority over stale encounter personality data. A new
voice-design prompt explicitly treats those current traits as authoritative, even
if an older persona description disagrees. The audio copy does not overwrite
canonical character data or invent future personality.

A compact hash of current personality/childhood traits controls speaking-habit
updates. Unchanged traits make no additional text-model request. On a real change,
one independent, resumable audio request asks the configured attached text model
for concise rhythm/articulation/emphasis directions. It does not create another
identity reference. Losing all these traits clears the style without a request.
The direction accompanies speech and whispered thoughts, separately from literal
spoken words. The reply's stored audio plan freezes its exact style for replay.
Adult personality changes can likewise update habits while retaining the finalized
adult reference.

The style prompt requests at most 20 words/180 characters; validation caps it at
300 characters. Its completion budget allows reasoning models to finish before
returning short JSON. The initial 200-token study returned empty content, which
was refused. The final budget is 2,000 tokens. This increases a maximum completion
allowance, not the permitted delivery-direction length, and introduces no
per-passage request or change to standard text-provider routing.

## Existing voices and clones

Explicit player-authored voices keep their chosen identity and receive only the
existing maturity delivery. Reference clones never enter the attached voice
identity/style designer. They retain their original bank and existing tone/whisper
behavior, plus the authorized age directions. Their youthful speech uses guidance
1.5, thoughts remain 2, and their baseline settings resume at 20. Childhood
performance retains guidance 2. Existing demon family directions and normal adult
Illidan reference delivery are preserved.

An older automatic profile heard as a child under the preceding maturity release
can be recognized from its existing audio delivery receipts and finalized once.
Existing adult profiles with no child history are adopted without mass recasting.
The new voice-development table stores small per-profile phase/style/hash/link
metadata inside the existing encountered-voice library. It is not an NPC age or
study tracking database. It is initialized lazily when the new app opens that
library; deployment preserves existing userdata bytes.

Adult reference publication is atomic: first finish the model requests and WAV,
then save/activate the adult profile and its link. A failed or cancelled preparation
preserves the provisional identity and reference. New pending audio-plan metadata
lets the current Play button retry incomplete preparation instead of treating a
draft as a frozen finished voice. A historical unfinished draft reports its missing
preparation rather than querying today's character and inventing an old performance.
Completed recordings retain their original identity, age and speaking style.

Earlier saves reuse the original provisional profile. Growing up again reuses the
already finalized adult profile. Neither old recordings nor successful adult
references are rewritten. Deliberate deletion remains deletion: receipts referring
to a removed voice retain the existing clear replay error.

## Verification and limits

Work and local auditions: `out/audio-development-20261015/`.

Checks cover development with stale encounter data, cached personality updates,
child/adult reference separation, identical seeds, reference reuse at 19 and 20,
frozen childhood style and replay, earlier-save reversal, adult publication failure
and Play retry, old-library adoption, exact literal words and both Breeze protocols.
Independent prompt tests preserve ordinary RP request bytes and keep casting
paragraphs out of the attached voice-design request.

Native desktop checks use disposable stores and synthetic CK3 frames. Actual
configured-model studies use synthetic characters only. Local Vulkan/Q8 checks
exercise generated and cloned performances with existing weights. Unprompted CPU
ASR is a finite word-recognition check, not listening approval. Perceived age,
speaker continuity and whisper quality, plus fresh CK3 execution of the combined
trait/maturity probe, remain player acceptance checks. No CK3 is launched here.

Adult long-lived senescence remains a separate open task. Existing mortal clone
55/70 thresholds and verified ageless/long-life exemptions remain separate from
childhood and youthful-adult delivery.

Final verification passes 2,964 staged tests in 106 suites (two existing skips),
both TypeScript builds, 22 deployment/build/reset checks, four native reports and
six actual Audio settings UI checks. Compiled native playback exercises 25 current
trait/maturity captures, one adult design, cached styles, youthful delivery at 16
and 19, its removal at 20, historical style and earlier-save profile reuse. The old
native report field `sameReferenceThroughAdulthood` refers specifically to its
legacy/player and clone fixtures; the new automatic-development fixture explicitly
creates one distinct linked adult reference.

Four final actual configured-text-model audio requests produce a provisional
identity, two concise trait styles and a linked adult description. Two earlier
attempts returned empty content at the original short style budget; those attempts
were refused. The first attempt retains its status log but did not persist full
responses; the second retains the complete synthetic inputs/outputs. The final
2,000-token budget completes all four requests. Token exhaustion is a plausible
explanation for the empty short-budget outputs, not a captured finish-reason proof.

Thirteen actual Vulkan/Q8 renders complete with the owned server stopped and no
pressure events. All age-16/19/20 generated deliveries use the exact adult reference,
which was derived once from the original reference; all Anduin deliveries use his
unchanged bank. Both identity-reference transcripts and 12/13 total targets match
normalized unprompted CPU ASR. The retained age-16 difference is “copper” recognized
as “Culper.” Transport proves guidance 2 for childhood, saved guidance 4 for the
generated adult, cloned youthful speech 1.5/thought 2 and baseline adult clone 1.
Normal adult Illidan and elderly Thrall controls retain their prior guidance.
Perceived maturation/identity/whisper acceptance is not inferred from these checks.

The initial full regression exposed lost established-individual continuity when
constructing a paired current-form prompt; that app regression was corrected.
An overbroad test pattern also mistook participant trait iteration for a world
character scan. Initial failures and the passing repeat are retained. The first
Audio desktop attempt correctly refused an already-held native verification lock;
the final runs are serialized. No deployment guard was weakened.

The guarded live installation is complete. Native SHA-256 is
`e3a4beb363a21e22607043d5ba2c12fed8d4f6a7ef6e9def38e995b2dc613dee`; rollback `20261015T205933986626Z`
contains exact r18 `f7f45b418a686aff6ef3291150120cf4c195bf42a23ea28049e55e13c9f5ec02`. All 817 fresh closed-app
userdata files and game/addon/load/playsets/launcher/frozen Wine remain unchanged.
The game component remains
`c5e2f5a10163269fa37a86e5137b88b3721ec845fd7d6da0e94317a0e3314b8a`.
See `deployment-acceptance.json` for complete receipts.

The matching portable application/game pair is refreshed, includes all current
audio development/performance guides, and retains its predecessor. No personal
voices, histories, settings or model weights are bundled. The independent
character-voices checkout remains clean.
