# Breeze acoustic casting

This extends the installed Breeze audio rig with the user's authored r3.1 acoustic catalogue. The attached text model still designs each person's individual voice; deterministic code supplies anatomy and learned pronunciation to Breeze. The roleplay writer remains independently responsible for words and character choices.

## Directional data flow

| Input | Consumer | Result |
| --- | --- | --- |
| Selected character persona, player portrayal, verified lore and ready backgrounds | Separate voice-design request to the configured text model | Bounded individual texture, articulation and habitual rhythm |
| Authored anatomy and culture acoustic paragraphs | Audio composer, then Breeze | Physical resonance plus one learned accent |
| Current age and verified slow-aging/ageless facts | Existing code maturity function, then Breeze direction | Current maturity without redesigning the identity every year |
| Player's frozen literary reading | Breeze text field | Only the words actually available to the player |
| Existing bounded delivery cue and thought classification | Audio direction composer | Delivery and whispered visible thoughts |

The acoustic catalogue never enters either text-model prompt. The voice-design request is separate from roleplay generation, uses a frozen snapshot of the configured provider, and runs through the existing resumable background lane. Ordinary foreground requests retain priority. No model name is hardcoded. This release changes no RP conversation, writer prompt, suggestion, letter, provider-routing or dialogue-steering module relative to its installed parent.

The shared capture framework has two small lifecycle integrations: an optional audio catalogue, and audio configuration/log/reset hooks. Audio owns its additional participant read after text commitment. It does not add acoustic data to the writer's capture request or alter anonymous culture/faith background hashes. Existing verified body data and established accents avoid another command read. When required, the audio probe targets only the actual speaker through the existing owned CE command bridge; it never scans the world or overwrites a gameplay-owned command.

## Casting and reuse

`public/audio/goa-casting.json` reproduces 115 anatomy profiles, 92 exact race routes, 166 culture paragraphs and 35 explicitly selected faith delivery records from `/home/titan/Downloads/GOA2-BREEZE-PERFORMANCE-ONLY-r3.txt`. The file's internal revision is r3.1; its SHA-256 is `1b631ee9ddc39724b09de46a6499c9f77f39dc15f03a93876a5d2fbb98c6d576`. The dummy culture is excluded. Intentional null presentation entries remain null.

Current physical form determines anatomy; culture determines learned pronunciation. A Gilnean tauren combines bovine chest/throat resonance with the authored Cockney direction. A Darkspear elf combines elven resonance with the authored Jamaican direction. Culture never grants another race's throat. Male/female naga use different anatomy cores with the same selected culture; dryad/keeper and native presentation restrictions retain their explicit routes.

The anatomy and named-accent analogies are authored casting suggestions, including creative extrapolation. They are not newly established Warcraft linguistic facts. No class, title, wealth, faith membership or localized culture label silently chooses another voice.

First use saves an age-neutral individual design and neutral reference WAV with its requested exact transcript, seed, casting provenance and generation metadata. Subsequent lines reuse the original WAV. Model/runtime-specific codec bindings remain replaceable caches. Managed Vulkan's model SHA identifies the GGUF containing the codec; external model identity is the operator's configured label, not independently certified codec provenance. Previously saved references receive no fabricated metadata.

Current-form variants are keyed by campaign, character, anatomy, presentation and selected accent. A physical transformation can prepare one paired reference while retaining compatible individual differences and learned pronunciation. Returning to a previously prepared form reuses its reference. Current age is excluded from this key. Each committed job freezes available verified body data and its maturity; historical replay retains its recorded voice revision and delivery.

Existing saved voices and the user's narrator are preserved. Older character designs continue using their original references until explicitly redesigned in Audio. This prevents an update from silently replacing a voice the player already accepted.

## Audio controls

For a current encounter participant, Audio offers **Race**, **Sex** (observed, Male or Female), and **Culture accent**. Observed race follows verified current physical form; explicit Race/Sex choices provide compatibility casting. Save casting and redesign creates a new voice revision through the attached text model. Custom or newly hybridized cultures without an exact supported key can use an explicit dominant accent; no ancestry-derived blend is invented. A learned accent persists until explicit redesign or selection rather than changing whenever political culture changes.

Preview a candidate, then choose **Use this saved voice** to retain that actual reference for future lines. Earlier revisions and their WAVs remain available; a later redesign still receives a new revision number. The narrator remains global and consistent across campaigns.

Faith performance is a **preview-only explicit choice**, initially inactive. Its catalogue is not activated by membership, Zealous, a doctrine, a sacred name or an inferred scene. The internal delivery composer accepts an explicit per-line faith record for a future upstream consumer; this release adds no new writer metadata contract for it.

The composer also supports explicit existing-word emphasis spans, qualitative pause positions and the four documented English event markers, bound to the digest of the exact delivered line. These are internal integration seams, not new automatic RP behavior. Invalid, stale or hidden-source positions are rejected. Culture/faith lookup never inserts laughter, oaths, new words, prices or dialogue. The existing whole-reply cue remains the production input. No supernatural DSP stage, event scheduler, microphone input or general CK3 UI dubbing is added.

## Verification and limits

Receipts are under `out/audio-casting-20261014/`. The final release is rebased over installed dialogue steering r1 `26b3386c6f4593be720938b2b4397ddcf287c34ec5c0dc23defeaba24c176fa0`. An earlier R13 stage and its successful checks are retained as superseded evidence; they were not promoted over the newer parent.

The combined frozen suite passes 2,769 checks in 90 suites with the two existing skips. Both TypeScript builds pass. The composition audit proves every RP conversation/prompt, letter, dialogue module/asset, provider router, language asset/engine, GoA rule, scene, dependency and default template unchanged from that parent. Only audio modules, the Audio page and the two explicit shared capture hooks change.

Tests exercise exact catalogue extraction, all native routes with unrelated culture, presentation nulls, ambiguous identity, form/reference reuse, age-independent identity, preserved legacy narrator WAVs, saved-candidate selection, literal privacy, explicit faith/events/positions, incomplete capture, disabled audio and the actual text-provider request boundary. The native-definition audit finds all 166 culture keys and parses the generated 27,624-byte per-speaker acoustic body. This does not prove those expressions have executed in CK3.

Four actual configured-text-model requests produced four usable individual designs on their first attempts: Gilnean tauren, Darkspear elf and both naga presentations. No authored acoustic paragraph entered those requests, and no RP generation request was made. The replies were directly reviewed. Surplus prose about practical wording and Highborne lineage remains qualified model behavior; the composer supplies the concrete acoustic cores independently.

The Q8 study retains four original references and six subsequent speech/thought clips at CFG 4, including two whispered-thought directions and child maturity. All complete with nonempty mono 24 kHz PCM. [The listening page](../out/audio-casting-20261014/model-study/review.html) exposes the ten retained clips. Generation, waveform levels and prompt compliance do not establish perceived anatomy, named-accent fidelity, identity continuity or intelligibility. Exact audible reference transcripts also remain a listening check.

The four required native reports use disposable stores and synthetic windows. The dedicated Audio desktop check covers independent selectors, inactive faith defaults, explicit faith preview preserving its original neutral reference, saved voice selection, renderer ownership, key redaction and actual WebAudio playback controls. The first extended faith-preview check exceeded the test driver's fixed evaluation timeout; its original logs are retained and the final harness waits asynchronously for synthesis.

Fresh CK3 culture/form execution, actual character listening, concurrent-game memory/performance and CUDA execution remain separate. The user's earlier successful Q8 narrator report is preserved. No real CK3 launch is performed by this work, and the broader crash/RP investigation remains open. Installed CLOSE 3.0 and R12 study work are retained; pending CLOSE 3.1 must rebase over the resulting installed parent before promotion.

## Installed release and rollback

Acoustic casting r1 is installed as native application `5abb5f48ba68ec69da61fe010ea916bd12b0e6ba9e90dc4a0af9ce32e62fafe8`. The game remains `c5e2f5a10163269fa37a86e5137b88b3721ec845fd7d6da0e94317a0e3314b8a`. Guarded installation rechecked the exact dialogue-r1 parent and preservation baseline under the common runtime lock. All 438 current userdata files, including the user's download and narrator, remain byte-identical; game/addon, playsets/load bytes and semantics, launcher/shortcuts, runtime selector and frozen Wine are preserved.

Rollback `~/.local/share/votc-mimir/native-deployments/20261014T195130306483Z` contains the verified exact dialogue-r1 parent. With companion, CK3 and launcher closed, `python3 tools/deploy-native.py rollback --backup ~/.local/share/votc-mimir/native-deployments/20261014T195130306483Z` restores that application. Confirm this acoustic release is still the installed head before a whole-application rollback; preserve any later accepted work. No game rollback is needed for this release.

The refreshed `out/VOTC-Titan-Edition/` portable application and game match the installed pair. It includes `AUDIO.md`, `AUDIO-CASTING.md` and `DIALOGUE.md`, with no personal settings, histories, voice library or model weights. The preceding bundle is retained under this release's receipts.

Primary implementation references are the [official Breeze modes](https://github.com/breezeblue-ai/breeze-tts/blob/main/README.md), [pinned native server schema](https://github.com/HoppouAI/Breeze-TTS-2.cpp/blob/v0.1.0/docs/server.md) and [reference-cache contract](https://github.com/HoppouAI/Breeze-TTS-2.cpp/blob/v0.1.0/docs/voices.md). Source inspection also confirms that v0.1.0's multipart console mode label checks uploaded audio rather than cached reference frames; a saved-reference direction can print “design” while correctly supplying cached codes and transcript to generation. The primary-source hash and finding are retained locally; no runtime patch was made.

## Live first-play repair r2 — installed

The user enabled audio during a real game encounter and pressed a message's play button. The app reported “Current culture capture is not ready for voice casting.” Saved library metadata showed narrator references and an initial delivery receipt, but no character voice. The user then saved explicit race/sex/culture choices and encountered the same error. The choices were present in the character casting table; this was not an unsaved-controls diagnosis.

The installed r1 replay path excludes every replay job from casting preparation. A current reply first played after enabling Audio therefore sends an unprepared voice-design request; its fallback resolver has neither the audio culture observation nor the saved per-character choices. Existing tests had covered replay of already prepared voices, leaving this first-play path uncovered. A bounded offline reproducer runs the installed production runtime with synthetic collaborators and reproduces the exact culture error both with automatic casting and with persisted manual choices.

The installed repair initializes casting for the first playback of a current reply without an existing recorded voice/casting plan. It applies saved choices before the individual text-model request, captures any required observations through the audio-owned lane, and freezes available body data. Already recorded or historical replays retain their own voice and maturity. A newer unvoiced current reply can use a character's current form even when an older reference exists. Failed capture stops before any voice-design or TTS call.

The same update moves **Save audio settings** beside the enable checkbox, uses the user-requested **Race** and **Sex** labels with **Male/Female** choices, selects the current speaker initially, and preserves the selected character when refreshing the editor. These changes affect the Audio page and Audio modules only.

The lightweight reproducer passes for the repaired source with a 128 MiB Node heap, no network requests and no model/game process launches. It proves automatic and persisted-manual first-play failures on r1 and successful first play, frozen replay, current-form selection for a newer reply and early capture failure on r2. The final combined frozen suite passes **2,773 checks in 90 suites**, with the two existing skips; both TypeScript builds, 21 deployment checks and all four native reports pass. One initial test-fixture syntax failure is retained alongside the corrected passing run.

The actual configured-text-model/Q8 replay study uses the production runtime with a synthetic current encounter and simulated digest-bound engine observations. Automatic first replay creates its reference and speaks. A second character's first replay applies saved Race/Sex/Culture choices without another culture probe. Replaying the first reply reuses its recording without another voice-design request. The study retains two actual individual designs, two saved references and three nonempty PCM deliveries. The two replies were directly reviewed; quantitative completion does not establish perceived identity, accent quality or intelligibility. The simulated engine frames do not establish CK3 execution.

The extended native Audio check verifies that Save is visible at the default 1280×600 window height, Race/Sex labels are correct, the initial speaker and later explicit selection survive refresh, and manual controls transmit the exact chosen values. Its renderer actors and save response are synthetic; backend persistence and replay preparation are checked separately by the production runtime tests. Both settings owners, unowned-page rejection, secret redaction, actual AudioContext scheduling/controls, actual Breeze preview, saved-reference selection and explicit faith preview remain covered. Screenshots and original clips stay under the private receipts.

After the user closed CK3 and the lingering companion, guarded verification and installation ran against exact r1. First-play repair r2 is installed as `0733f566f49f1547726576146eca9ac149313f1fd302b3790b6ec367f7e6e307`. Its ten-file delta contains only three Audio TS modules, their six JS/maps and audio.html. Every RP/provider/capture/language/catalogue/dependency/default-template file remains exact to r1. The game stays `c5e2f5a10163269fa37a86e5137b88b3721ec845fd7d6da0e94317a0e3314b8a`.

A **fresh 472-file** closed-app baseline and after-install comparison preserve the enabled Audio settings, manual choices, model downloads, narrator recordings, all other userdata and game/addon/playset/load/launcher/frozen-Wine fingerprints. The older 438-file snapshot is historical. Rollback `~/.local/share/votc-mimir/native-deployments/20261014T203450325555Z` contains the verified exact r1 application. No game rollback is needed. The matched portable application/game pair retains its preceding bundle and excludes personal voices, histories, settings and weights.

Private receipts: `out/audio-live-playback-20261014/`. Fresh CK3 audio-culture capture and player listening remain pending the user's retest; no new campaign or saved-data reset is required. The broader crash/RP investigation remains open, and pending CLOSE3.1 must rebase over this newer r2 parent.


## Narrator and library editor repair r3 — installed

The user reported that edited selections kept producing the same British-sounding older female narrator, that test speech did not follow their intended words, and that saved items had no rename/delete actions. The two saved narrator revisions contained the same default description and byte-identical WAVs. The default description specified a warm storyteller and neutral English; it did not deliberately select a sex or old age. The old Preview button used the saved profile's instruction and recording even while its textarea contained an unsaved edit. Character Race/Sex/Culture selectors never controlled the global narrator, and preview text was a fixed reference sentence. This supported editor diagnosis does not prove a particular CK3 reply's audible transcript.

Audio now has a separate narrator editor and saved-narrator selector. It shows the active narrator's name and revision. Previewing an edited description saves and designs that candidate with a fresh reference, rather than cloning the previous narrator. The explicit new-narrator action also requests a new identity seed, allowing another candidate with the same prompt. Existing character revision seeds and existing saved recordings are retained. Custom player descriptions accept 1–2400 characters; short descriptions no longer fail the old 40-character minimum. The narrator's own description controls its age/sex/accent; code no longer appends a mature-adult age override to narrator reference design. Character references retain their established neutral adult identity and separate current-age delivery.

A separate **Words to speak in previews** field supplies literal preview text. When that text differs from the stable reference sentence, Breeze first prepares the neutral identity reference and then speaks the requested words against it. The saved reference transcript remains the actual reference text. Voice instructions and spoken words stay separate. **Preview this character** has its own IPC path and selected campaign/character identity; changed Race/Sex/Culture controls are applied through the existing audio casting rig before its preview. The regular game pipeline still consumes the player's frozen delivered reading.

The library shows the active revision for each owner. Previewing an edited saved-description textarea also uses that edit. **Rename** updates the selected revision's label without changing its WAV, seed or delivery receipts. **Delete** has an inline confirmation and removes just that revision, its local reference WAV and database codec/metadata/form links. A remaining narrator becomes active, and a surviving matching character-form reference is rebound when available. A monotonic revision counter prevents deleted revision numbers from being reused. Old receipt IDs remain frozen; replay bound to a deleted recording reports the missing voice rather than silently substituting someone else. No personal voice was deleted during verification or deployment.

The exact staged build changes four Audio TS modules, their eight JS/maps and audio.html: thirteen files over installed first-play r2. The audit proves all RP/dialogue/provider/capture/language/catalogue/default/dependency files exact to that parent, including R12 study and CLOSE3.0. Pending CLOSE3.1 is excluded. Both TypeScript builds pass, along with 2,782 frozen application checks in 90 suites (two existing skips), 21 deployment checks and 22 actual Audio desktop checks. Initial harness failures are qualified locally: one suite invocation used the development working directory and consequently read pending CLOSE3.1 assets; the corrected frozen-directory run passes. A CDP array expectation was corrected from undefined to its JSON null representation. Neither required language or provider changes.

The actual local Breeze Q8 UI study edits the narrator description, presses Preview, obtains a distinct saved reference, shows the active name/revision, captures the custom-text WAV, renames it without changing its hash, and confirms deletion/fallback while preserving the original narrator. The character-preview UI check uses synthetic actors and verifies its separate route and exact requested words; production runtime tests independently verify character-reference ownership with a different narrator active. Different waveforms, literal request assertions and successful playback do not establish perceived sex, accent, age, intelligibility or exact audible words. Those remain player listening checks. No real CK3 was launched and no RP model request was added.

Private receipts and a synthetic listening page: `out/audio-narrator-editor-20261014/`. All four native reports pass. Guarded installation over exact r2 installs `4bb5262b7f63ef3dfc076c86b0bfb606b26b82b2fffddb0e98c5fc7c7126001d`; rollback `20261014T205441633276Z` contains the verified exact r2 parent. All 472 current userdata files remain byte-identical, including recordings, settings and downloaded models; game/addon/playsets/load/launcher/frozen Wine remain unchanged. The matched portable pair preserves the preceding bundle and excludes personal data and weights. Pending CLOSE3.1 MUST rebase over this newer r3 application. The broader crash/RP investigation remains open.

The optional external Déjà Vu progress write was rejected by automatic approval review for lack of trusted authorization to export private project status to Bifrost, including after reducing it to a brief feature summary. No progress observation was saved; local receipts retain both rejections. The installed app and portable repair are unaffected. A further external sync requires explicit user approval.


## Race/Sex wording correction r4 — installed

The user had explicitly requested **Race** and **Sex**, with **Male/Female** choices. The earlier label repair missed the Audio help paragraph's “anatomy/presentation” wording and four user-facing casting errors. This correction uses Race/Sex consistently in the help and errors as well as the existing headings and choices. Internal persisted field keys and all acoustic/model instructions remain unchanged, preserving reference/form identity and compatibility. No voice or personal recording was regenerated or changed.

Application `24f9f43c75f89e926a6b3fb3d6b1b857120e2c927a81a025e447e169df95a109` installs over exact narrator/editor r3. Its only four changed files are acousticCasting.ts, its JS/map and audio.html; every other installed file is exact to r3. Both TypeScript builds, all 2,782 frozen checks/90 suites (two existing skips), 21 deployment checks and four native reports pass. The visible-text/error scan finds none of the old Anatomy/Presentation/Gender terms; HTML identifiers and saved schema keys are implementation details and were not migrated. Prior Breeze studies are historical; this wording-only release adds no synthesis or CK3 acceptance claim.

Fresh closed-app hashes preserve all 472 userdata files and game/addon/playsets/load/launcher/frozen Wine. Rollback `20261014T210411108805Z` contains verified exact r3. The portable pair matches and retains its predecessor. Receipts: `out/audio-race-sex-20261014/`. The broader crash/RP investigation remains open; pending CLOSE3.1 MUST rebase over this newer r4 application.


## Automatic GPU hosting r5

Native `ed0a363d3f75dfcd61ca43aaf004db0c38c39159dc66ec9d42c386e4700ce7d3` supersedes r4 while preserving its Race/Sex wording, all casting/profile/reference ownership and the independent text-design pipeline. Known discrete Vulkan uses measured RAM headroom with a separate VRAM budget; GPU initialization and the actual Vulkan backend are mandatory. CPU fallback is disabled. Already installed Q8 can replace a preferred package that cannot fit, without changing the saved preference. Actual-model metadata and codec identities follow the chosen runtime; pressure unload/restart retains saved WAVs. See the current [hosting chapter](audio-integration.md) for budgets, lifecycle behavior and qualified tests.

All 501 fresh userdata files and game/addon/playsets/load/launcher/frozen Wine are preserved. Rollback `20261014T215402933383Z` contains exact r4. All 2,794 checks/91 suites (two existing skips), both builds, 21 deployment checks, four native reports and the real managed GPU lifecycle study pass. Synthetic resource readings and CPU-server fixtures are identified; no live CK3 or universal audio-quality claim is made. Receipts: `out/audio-auto-hosting-20261014/`. Pending CLOSE3.1 must rebase over r5; broader crash/RP work remains open.


## Voice playback and status strip r6 — installed

Native `903742508be879b2154eb8779ef82b679df76564a02889bf2bbc70722bfb76fc` adds shared boosted/peak-limited playback to chat and previews, preserving the original reference WAVs. Actual reader edit boundaries now separate character speech, whispered thoughts and narrator text even when the backend encoding flag is absent. A production replay regression retains narrator and character identities through the mixed sequence. The real Q8 AudioRuntime/renderer study completes narration → character → thought → character with all four acknowledgements. These finite checks do not establish the exact cause of every earlier narration-only report or replace player listening.

Loading/progress and voice controls now occupy a reserved strip between reading and input; two actual Electron viewport checks establish no overlap. Generation and playback show the current role/passage count, and replay displays the actual error. See the latest [integration chapter](audio-integration.md) for processing measurements, preservation details and qualified evidence.

All 2,796 staged checks/91 suites (two existing skips), both builds, 21 deployment checks, four native reports and 26 Audio UI checks pass. All 588 original userdata files and game/addon/playsets/load/launcher/frozen Wine are preserved. Two temporary sidecars created by the diagnostic read were removed, restoring the original baseline before installation. Rollback `20261014T224123926340Z` contains exact r5. Portable matches and retains its predecessor. Receipts: `out/audio-loudness-sequence-20261014/`. No real CK3 was launched; broader crash/RP work and fresh listening remain open. Pending CLOSE3.1 must rebase over r6.


## Continuous audio queue r7 — installed

Native `a3a0aa54a80780fb27bf1a8924b9104aae328c1e1f8e269db95d6dc6fb2ded71` prepares/reuses character and narrator references up front, then generates each natural delivered passage as soon as Breeze finishes the previous request. Playback consumes the results in order. The memory bound is 8 MiB of future PCM rather than one future passage; a full queue waits for playback, and cancellation wakes a blocked producer. Buffered bytes continue streaming at the handoff when a passage is unfinished. Model weights stay resident on the existing GPU path. No RP prompt or extra per-passage text-model request is added.

The actual synthetic Q8/renderer study has character audio ready about 1.92 seconds before narration ends and generates later passages during narration, with one active synthesis request. All 2,805 staged checks/92 suites (two existing skips), both builds, 21 deployment checks, four native reports and 27 Audio UI checks pass. Six application files change; all 588 userdata files and game/addon/playsets/load/launcher/frozen Wine are preserved. Rollback `20261014T234814587129Z` is exact r6. See the latest [integration chapter](audio-integration.md) for scope, timing qualifications and buffer behavior. Receipts: `out/audio-lookahead-20261014/`. No real CK3 was launched; broader crash/RP work and fresh listening remain open. Pending CLOSE3.1 must rebase over r7.

## Complete utterance playback r8 (2026-10-14)

Native `9e93edb39ca285ffdb15ebadf96e673ecc4a20e875d61ace8de55604c5d7f6bb` groups compatible delivered passages before synthesis, joining interrupted character dialogue when narration is muted. Each planned utterance streams PCM while generating; long turns use complete-sentence boundaries, with explicit Hoppou re-splitting disabled. Thought, voice, paragraph and distinct indexed-tone boundaries remain separate. Existing full-reply tone cues, saved references, current-age guidance and casting stay in use without an extra text-model request or RP change. Audible narration interjections still require separate performances in literary order; seamless acoustic continuation is not claimed.

All 2,820 exact staged checks/93 suites (two existing skips), both builds, 21 deployment checks, four native reports and 31 actual Audio UI checks pass. Four real Q8 cases reuse one exact character reference, including an intact 36.48-second sentence that streams during generation. Waveforms/request boundaries do not certify perceived delivery or word accuracy. All 588 original userdata files and game/addon/playsets/load/launcher/frozen Wine are preserved. Rollback `20261015T001356255847Z` is exact r7; the portable pair matches and retains its predecessor. See the latest [integration chapter](audio-integration.md) for bounds, qualifications and the [listening comparisons](../out/audio-prosody-20261014/listening.html). Pending CLOSE3.1 must rebase over r8. No CK3 was launched; fresh player acceptance and broader crash/RP work remain open. Receipts: `out/audio-prosody-20261014/`.

## Audio interface / narrator auditions r9 (2026-10-15)

Native `08701ad3b5309231f0a9b783bac965369440e938679860cfc880bd56829f366a` moves Audio between Summarization and Knowledge. Engine & downloads is the leftmost/default panel, followed by Narrator and Characters. Choose a saved narrator in the Narrator panel; **Delete narrator** is visible beside its heading, with a confirmation naming that voice. Rename is beside the name field. Existing saved voices are retained until explicitly deleted.

**Preview voice creates an unsaved audition; Save narrator keeps and selects it.** Repeated test words reuse one temporary identity without adding slots. Save copies the audition's exact WAV, seed, transcript and metadata rather than regenerating it; repeated saves do not duplicate it. Changing drafts/settings or shutting down cleans the temporary reference. Character Preview plays the saved revision, while a description change or casting redesign requires its explicit save. All draft operations require an owned Audio settings page.

All 2,826 staged checks/93 suites (two existing skips), both builds, 21 deployment checks, four native reports and 40 actual Audio UI checks pass. Real Q8 auditions/commit/rename/delete and three viewport checks cover the new workflow. Final preview controls do not overlay the editor. Saved data, all 588 original userdata files, the paired game/addon/playsets/launcher and frozen Wine are unchanged; r8 audio delivery, GPU hosting and RP/language work remain exact. Rollback `20261015T092441187147Z` is exact r8; portable matches and retains its predecessor. See the latest [integration chapter](audio-integration.md) for details, qualifications and screenshots. Receipts: `out/audio-interface-20261014/`. Pending CLOSE3.1 must rebase over r9. No CK3 was launched; player listening and broader crash/RP acceptance remain open.


## Whisper identity / Goblin nasal delivery / saved audio r10 (2026-10-15)

Native `f22ab54d9397a8246630641d079b9b9d28bd0327364b0b5925a895768395ddc4` keeps the established saved speaker/reference for thoughts and repeats its character brief and recorded Sex in Breeze's whisper instructions. Verified Goblin Race gets stronger pinched nasal resonance in Breeze delivery for speech and thought, alongside its independently learned culture and current-age directions. Existing personal WAVs/seeds are preserved, and other races/narrator keep their ordinary delivery. The synthetic male Goblin [before/after comparison](../out/audio-smooth-playback-20261015/listening.html) uses one identical reference; perceived identity and quality remain listening checks.

Audio Enable and all saved audio preferences now survive startup cleanup. Its strict default-schema merge previously discarded the entire code-defaulted audio object. Two regressions and three actual disposable app launches verify enabled and disabled states plus narrator/thought/volume settings in both windows. Narrator labels hide internal revision counters; the saved count, IDs and recordings remain accurate and unchanged. Complete utterances buffer into one source before playback, while the continuous serial producer continues preparing following passages. This trades opening wait for resistance to transport underrun inside the utterance.

The final encounter receipt read corrects a proven late-wake timeout defect; live Dreadlord acceptance remains pending. The Reigol English incident remains unverified in the saved completed replies, and a private metadata/digest receipt now links future audio to its precise delivered hearing. Language masking stays enabled and its formulas remain exact. See the latest [integration chapter](audio-integration.md) for evidence and limits.

All 2,839 staged checks/96 suites (two existing skips), both builds, 21 deployment checks, four native reports and 47 actual Audio UI checks pass. Eighteen app files change over r9; all 632 userdata files, paired game/addon/playsets/launcher and frozen Wine are preserved. Rollback `20261015T104316606320Z` is exact r9; portable matches and retains its predecessor. Pending CLOSE3.1 must rebase over r10. No CK3 was launched; broader crash/RP and player acceptance remain open. Receipts: out/audio-smooth-playback-20261015/.


## Short reference directions and breath spacing r11 (2026-10-15)

Native `3cc4014214200cad013a83b1fe4f83db5f32c1e2c59eaa0f2a8864a2589ab998` adds a 300 ms minimum breath between completed performances, counted on the audio clock. Existing generation gaps count; the first passage starts normally, and no pause is inserted between packets or inside a joined sentence. Full buffering and continuous serial future synthesis remain.

Routine whisper directions no longer repeat the full saved design paragraph. The same saved WAV/transcript/seed carries identity; short directions retain current age, recorded Sex, tone and same-speaker whispering. Verified Goblin Race keeps compact but strong nasal steering alongside its reference culture accent. Voice design/reference creation and all personal recordings remain unchanged. This supersedes r10's full-brief whisper direction. Pimgib's saved reply contains no prompt markers, but no live PCM was retained; the sole cause of his audible instruction speech remains unproven. A [private same-reference Q8 comparison](../out/audio-breath-direction-20261015/private/listening.html) uses synthetic words and confirms separate HTTP text/instruction fields. Generated words and perceived identity still require listening.

All 2,841 staged checks/96 suites (two skips), both builds, 21 deployment checks, four native reports and 50 actual Audio UI checks pass. Nine app files change over r10; all 656 userdata files and paired game/addon/playsets/load/launcher/frozen Wine remain exact. Rollback `20261015T111824022360Z` is exact r10; portable matches and retains its predecessor. See the latest [integration chapter](audio-integration.md). No CK3 was launched; fresh player acceptance and broader Reigol/crash/RP work remain open. Pending CLOSE3.1 must rebase over r11. Receipts: out/audio-breath-direction-20261015/.


## Character clone banks and independent-fork update protection r12 (2026-10-15)

Installed native `8742b10035f0294e133be4e775684cd7d52ef7ed57b7f5bad5ff4d8a6388ada0` is based on exact r11 (`3cc4014214200cad013a83b1fe4f83db5f32c1e2c59eaa0f2a8864a2589ab998`). Rollback `20261015T125354322144Z` contains that exact parent. The game stays `c5e2f5a10163269fa37a86e5137b88b3721ec845fd7d6da0e94317a0e3314b8a`.

**Audio → Characters → Import clone bank** accepts a prepared character package's `voice.json` from the independent [character voice repository](../character-voices/README.md). Select the encountered character, choose its bank and press **Apply to character**. Only an explicit verified campaign ID / numeric character ID assignment selects a clone. Names never auto-match; there is no world scan, new game capture, cross-campaign guess or extra text-model request. No real character banks are included yet. The upcoming collection project can populate the clean repository. Narrator packages remain an offline collection format; the existing narrator editor is unchanged.

The imported WAV and exact UTF-8 transcript are copied into private audio storage with a manifest/hash-bound revision. Mono 24 kHz, 16-bit PCM, one to thirty seconds, signal, size and SHA-256 checks precede activation. Symlinked/special files, path escapes, draft references, weakened policies and changed revisions are refused. Prepared references need no claimed listening review. Original source/repository files remain unchanged and need not stay mounted. The existing encountered-character SQLite library stores exact campaign bindings, cloned reference copies and frozen delivery receipts. A matching imported reference/seed is reused across lines; a missing or modified selected recording fails before GPU loading instead of designing another speaker.

A selected clone bypasses the attached text voice designer, Race, Sex, culture, age, faith and anatomical identity steering. Its recording supplies identity. Only the existing bounded performance tone and same-reference whispered thoughts reach Breeze alongside separate literal text and reference transcript fields. There is no design paragraph in this lane. Current age remains part of ordinary casting for unbound characters. Narrator, normal casting, authored acoustic paragraphs, existing text-design prompts, RP prompts/provider routing, capture, language/CLOSE3.0, GPU-only hosting, model downloads, sampling, output gain, complete utterance buffering, serial 8 MiB future synthesis and 300 ms breath behavior remain. No additional RP prompt or model route is added.

Select **Normal casting** and apply it to remove an assignment for future playback. Recorded replays keep the original normal or cloned profile even if a bank is assigned, unassigned or revised later. Deleted frozen profiles fail explicitly. Clone identity edits require a new bank revision; ordinary Race/Sex/culture redesign controls are disabled while assigned. Reference import alone does not activate a character override. Settings IPC requires an owned Audio page; chat and unrelated renderers cannot import or bind banks.

Titan is an independent fork of VotC Community Edition. Its upstream **application update client is removed**, including Settings button/toggles, tray item, startup/repeating release checks, legacy `update-app` IPC and downloaded-update/restart handlers. The packaged `update-electron-app` module and updater package configuration are removed. The native builder also strips stale copies from future development builds. Existing saved update flags are inert and left intact for data preservation. Upstream authorship/licence attribution and our guarded local installation/rollback tools remain. Breeze model downloads and memory/embedding update operations retain their separate purposes.

Both TypeScript builds, all **2,865 staged checks in 98 suites** (two existing skips), **22 deployment/build/reset checks**, four standard native reports, the independent repository's 19 tests and **52 actual Audio UI checks** pass. Actual synthetic Q8 clone speech and thought use one exact imported WAV/transcript/seed, without design or identity directions, through the real player renderer; unbinding returns ordinary age delivery. Unit cases cover bounded tone, per-campaign isolation, missing/changed packages before model loading, preview, old normal replay after binding, clone replay after unbinding, and deletion without substitution. The Audio DOM assignment/unbind checks use synthetic encounter data; the runtime Q8 check is separate. There are zero real text-model requests. Three actual disposable app launches retain saved enabled and disabled settings. The upstream client cannot resolve at runtime, and its legacy IPC/download handlers are absent; System displays the fork explanation. Generated words, tone, perceived identity and fresh CK3 acceptance remain user listening checks. No real CK3 was launched.

Exactly **27 application files** change (eight TS modules with JS/maps, two settings pages and package metadata), and **25 updater-package files** are removed. All other installed bytes remain r11. All **656 fresh closed-app userdata files**, game/addon/playsets/load/launcher and frozen Wine are preserved. The portable pair matches and retains its predecessor; only clean authoring tools/schema/docs accompany it, with no personal voices, histories, credentials or model weights. The independent repository is clean at commit `7ea9685980a5c89e0c0afbb1e478a0d5006a4679`; there is no remote. No external sync or sub-agent was used. The initial debugger `Promise was collected` run and an initial incomplete fixture-count release-guard refusal are retained alongside the passing final repeat; neither modified the live application. Receipts: `out/audio-clone-banks-20261015/`. Reigol and broader crash/RP work remain open; pending CLOSE3.1 must rebase over r12.

## Bundled character references r13

[GoA2 reference-bank activation](audio-banks-live.md) makes 419 prepared banks
available directly in Audio → Characters. Automatic identifies only the current
exported participant through finite historical-scope comparisons; it does not
match display names or substitute GetID for a history key. A single supported
recording bypasses normal casting while preserving tone and same-speaker thoughts.
Alternative forms need an explicit choice. Normal casting disables automatic
references for that character in that campaign; existing replay identities remain
frozen. The writer and ordinary acoustic-casting formulas stay unchanged.

## Automatic recorded defaults and current forms r14

The r13 null defaults incorrectly generated Illidan and Arthas despite successful
identity capture. All 407 covered identities now select an included default.
Current verified traits choose metamorphosis for Illidan, living/death-knight/Lich
King Arthas and living/undead Sylvanas; dates and names do not select forms. Clone
speech/thoughts reuse one reference/profile and CFG 1. See
[the current guide](audio-banks-live.md) for behavior and finite evidence. Existing
recordings, manual choices and frozen replay identities remain unchanged.

## Trait changes during an encounter r15

New unrecorded replies and character previews refresh supported form predicates
rather than preserving the first observed form indefinitely. Later probes compare
only the already verified current identity. A transformation and reversal reuse
the corresponding existing recording/profile; ordinary voices and historical
replays retain their previous behavior. The finite transition regressions include
Illidan base/metamorphosis/base and living/undead/Lich King/living Arthas.


## Demon performance and cloned whisper repair — 2026-10-15

The user reports that Illidan's normal clone is excellent but his thoughts do not whisper, and requests distinct demonic vocal flavors informed by the revised race guide. The audio-owned performance layer now supplies thirteen separate vocal textures and breath-compatible thought variants. Race and culture remain independent. Fifteen explicitly identified bundled demon/form banks receive conservative performance coloration; normal HotS Illidan speech keeps its exact reference, seed, directions and CFG1. Cloned thoughts use sustained unvoiced-breath directions at CFG2; colored demon clone speech uses CFG1.5. Generated voices/narrator retain their saved guidance setting. This is a user-authorized clone performance extension, not a return to automatic full casting of reference clones.

See `audio-demon-performance.md` for source hash, family table, scope and validation limits. No bank reference/manifests/transcripts, identity defaults, form rules, RP/provider prompts or routing, game files, PCM buffering, breathing gaps, volume, dependencies or model weights change. Existing generated references receive delivery guidance without recasting. Audio previews now also retain saved Race metadata. Receipts, finite Vulkan/Q8 auditions, automated word checks and preserved initial harness failures are under `out/audio-demon-performance-20261015/`. Perceived whisper identity and demon quality require player listening; no CK3 is launched by this repair.


## Mortal clone age-performance exception r17 (2026-10-15)

Clones can now acquire restrained older/elderly delivery while retaining their exact reference, seed and saved profile. The existing 55/70 thresholds apply only when a complete audio-owned current-participant frame explicitly confirms neither agelessness nor long life. The effective GoA longevity list and native no-aging/Immortal predicates retain fantasy lifespan protections. Older clones refresh those facts for each new performance; gaining or losing protection takes effect without recasting. No RP/text-model prompt or request, ordinary casting/age rule, bank data, demon treatment or game file changes.

New age performances persist through the existing plan age field, so recorded replay keeps its original age and does not requery current traits. Previously ignored old clone age strings remain ignored. Encounter previews use current age; library-only previews remain reference auditions. Aged clone speech uses CFG1.5, thoughts retain CFG2, and unaged clone speech retains its previous setting. See [the clone-aging guide](audio-clone-aging.md). Receipts and finite local auditions: `out/audio-clone-aging-20261015/`. Fresh CK3 predicate execution and subjective listening remain player checks.


## Shared child delivery and reference clones r18 (2026-10-15)

Generated and cloned voices now share a forced native maturity check for every new
character performance. CK3's adult flag takes precedence; default adulthood is 16.
Young-child, child and adolescent performances reuse the existing voice identity
and reference. Childhood uses guidance 2; adulthood restores existing guidance.
This explicitly authorized clone performance exception adds no automatic identity
casting or new voice-design request. Old recorded plans remain frozen and no
profile/WAV is created merely because the child has a birthday. Read
[audio-maturation.md](audio-maturation.md) for capture, previews, replay and the
separate remaining gap in long-lived adult senescence.


## Developing personality and youthful adulthood r19 (2026-10-15)

The user's corrected youthful boundary is **20**. Generated childhood identities
now receive one linked stable adult reference when native adulthood is first
observed (normally 16), based on current traits. Ages 16–19 use that adult reference
with youthful delivery; age 20 removes the direction without another voice design.
Current childhood/personality traits can update cached speaking habits without
recasting. Provisional recordings and frozen reply styles remain available.
Reference clones and explicit player voices keep their identity bypass. Read
[audio-development.md](audio-development.md) for capture, compatibility, atomic
adult publication, retry, earlier saves and the separate long-lived aging gap.
