# Deterministic Warcraft lore in Titan Edition

> The 2026-11-10 game-hook deployment described below has been withdrawn: its 29
> story overrides are archived and the Steam launch option is restored. The
> replacement reads status on demand through stock CE. See the current
> [launcher-only contract and migration status](launcher-only-installation.md).
> Earlier installed hashes and hook instructions are historical evidence.

## Campaign book observations, 2026-11-10

The installed native application is `61aac90c192e3862da0a355a125ecb75a9744c4620fe08a30273445bbf27142b`; its game addon is `4cbba571117ec9de70211ff2c15f3884843df6da288f6a2c8e5c947e91d793d3`. This release connects the existing 141 GoA accounts at 159 source-bound receipt points. All 90 explicitly alternate event options already had accounts. Seven additional contextual variants handle substituted expedition actors, cities and realms without assigning them canonical identities.

Game observations persist world records separately from character-owned memories. The current actor, acting mind, save fork, actual creation date and source edition bound the private reader. A choice, attempt or declaration remains distinct from its later outcome. Four duel accounts wait for matched completion callbacks. An event elsewhere supplies no automatic personal knowledge. Existing root accounts and their consequences retain progressive disclosure. The original book databases/vendor bytes and normal full RP prompt remain unchanged; no additional model call is required. Lore uses the existing encounter and per-reply refresh probes.

Restart Titan and CK3 after installation. New events are recorded as they execute. Earlier choices are not backfilled from the calendar. The source guard must run through the configured Steam entry; after changing playsets, reopen that launch path before playing. Unsupported source/playset changes retire only the 29 owned story overrides, retaining the three memory-support files. Automatic admission also checks the active effective definitions.

The portable installer keeps observers active when the matching guard is configured. Otherwise it installs ordinary Titan plus saved-memory support and omits the story overrides. For a new installation, first install and enable Titan with GoA, close the game/Titan, run `python3 tools/setup-lore-guard.py --game-install "/path/to/Crusader Kings III"` from the portable folder, apply its printed Steam launch option, and rerun the installer. Existing ordinary launch arguments are preserved by the setup suggestion; complex shell commands require manual configuration.

Immediate installation failures can restore the exact verified parents. **After playing with observations, retain these files when rolling back the game addon**, so existing saved memories remain defined: `common/character_memory_types/titan_lore_mutation_memories.txt`, `localization/english/titan_lore_mutations_l_english.yml`, and `common/scripted_effects/titan_lore_mutation_observations.txt`. Future editions must preserve historical type/localization lineage and must not silently reinterpret old receipts under changed source or prose.

Evidence: [installation receipt](../out/goa-timeline-integration-20261110/deployment-acceptance.json), [all-point worker checks](../out/goa-timeline-integration-20261110/all-points-worker-matrix-v4.json), and [controlled engine checks](../out/goa-timeline-integration-20261110/engine-controlled-callback-capture.json). The frozen suite passes 3,444 tests with two existing skips; all four native reports pass. The 159-point/318-read matrix uses synthetic captures. Controlled CK3 memory/callback checks passed; this does not claim every original story event or the player's complete RP experience was executed. A first desktop focus failure and its unchanged passing recheck are retained.

The historical implementation notes below describe the earlier deterministic layer and earlier releases.

Implemented on 2026-10-07 using the user-supplied GoA2 catalogue. This adds selected Warcraft meanings to the character description already produced by VOTC. Culture and faith keep their separate shared libraries and existing influence rules, including stronger faith emphasis for Zealous. This layer makes no extra model call and has no dependency on the separate Warcraft Lore workspace.

Read the supplied [implementation brief](goa-lore/implementation-brief.md) and [human catalogue](goa-lore/catalog.md) for the author's intended semantics. The original JSON is preserved in `public/goaLore/catalog.json`. `public/goaLore/templates.json` contains reviewed male, female, neutral and name-only variants for all 297 cards. Runtime code substitutes explicit variables into these authored variants; it does not rewrite arbitrary pronouns in prose.

## Capture and provenance

The current adapter enables capture only when an enabled descriptor identifies GoA Workshop item `2949767945` and effective definitions include its Orc and Demon traits. An active Warcraft prompt preset, culture name or translated trait name is insufficient. A differently identified private GoA fork needs an explicit qualified adapter before these rules run.

`src/main/goa/goaBridge.ts` reads the effective base-game and active-mod trait/script-value files, respecting the existing loader's replacement/load-order behavior. It generates a literal `has_trait` mapping rather than guessing a trait-key getter. The copied VOTC character exporter retains the existing category, localized name and description and adds an optional canonical trait ID. Other callers of the upstream trait logger remain intact. Workshop files are never modified.

The independent `mod/votc_mimir_culture` addon now also contains:

- `goa-catalog.json`: effective inventory, content digest and compatibility diagnostics.
- `common/scripted_effects/mimir_capture_goa.txt`: canonical trait logger and read-only character observations.
- `common/script_values/mimir_goa_capture.txt`: game-calculated trait census.

The digest covers effective trait/script-value contents, pack identity, original catalogue, authored variants/compositions and resolver version. New definitions or changed lore invalidate the prepared capture. The companion periodically rechecks effective content; prepare backgrounds again and restart CK3 after a change. Add a resolver-version change for future predicate semantics changes.

The protocol uses the proven `debug_log` channel:

```text
VOTC:GOA/;/begin/;/1/;/<content digest>/;/<character ID>
VOTC:GOA/;/count/;/<game-calculated number of traits>
VOTC:GOA/;/sex/;/female
VOTC:GOA/;/trait/;/creature_sayaadi
VOTC:GOA/;/fact/;/ageless/;/yes
VOTC:GOA/;/defence/;/elemental_fire/;/-5
VOTC:GOA/;/end/;/<same digest>/;/<same character ID>
```

The reader requires matching boundaries/digest, canonical sex, allowed trait IDs and an exact census of unique positive trait records. Missing or malformed capture does not become a partial affirmative lore claim. Unexpanded numeric expressions do not become zero resistance. New/incomplete frames, log resets and campaign load invalidate former observations. Fresh observations can bind a Character object for 15 seconds; an already-bound conversation object can retain that exact observation beyond the window only while reader, campaign epoch and character revision still agree. A new encounter cannot borrow stale observations from a reused character ID. A saved workbench snapshot alone does not authorize live injection.

`Character.sex`, `Character.goaSnapshot` and `Trait.id` remain optional and round-trip through the snapshot codec/schema. Legacy records remain readable. The regenerated userdata typedefs expose these optional fields; the generator now passes text to ts-to-jsdoc and produces valid CommonJS/JSDoc instead of residual TypeScript and broken multiline imports.

## Bodies, sex and selection

`goaRuleContext.ts` distinguishes underlying nature, current body and controlling mind. A single verified active druid form supplies its body; several competing forms remain unresolved. Polymorph takes its own form. Temporary shapeshifting does not erase ancestry, soul-level appetite or curse. Fallen Demon Hunter is a real controller replacement and suppresses unsupported former mind-specific habits. Ordinary Metamorphosis does not prove takeover.

The actual actor's `is_female` observation chooses grammar and sex-dependent branches. Female Sayaad is a Succubus; male Sayaad is an Incubus. Female `creature_dryad` uses Dryad context; male uses Keeper of the Grove, including antlers. Missing sex uses the character's name and leaves sex-dependent branches dormant.

A current Voidwalker body is the narrowly authored sexless exception: the selected prose uses they/them and briefly identifies a sexless, shapeless Void-energy creature. Ordinary elementals, demons, constructs, infertile characters and undead retain observed male/female grammar. An explicit sexless adapter observation must identify the actual current body and cannot neutralize the known sexed Sayaad/Dryad branches. No such extra adapter field is currently emitted by the game exporter.

`goaRules.ts` contains executable full predicates for all 297 cards. Catalogue `ids` are candidates, never a blanket OR condition. Fixed replacements apply within their authored families: Fel Orc and exact Mok'nathal combinations; elven infusion/dependency branches; Leper cognition; Nightmare/Fang versus healthy nature assumptions; domain mantles; highest injury/rank within its own family; and specific demonic pressure versus generic temptation. Actual restored cognition replaces Leper cognitive pressure while physical irradiation remains. Elemental mastery merges into its matching practice without inventing a method or rank. All Blood labels form one ancestry statement and never grant the ancestor's full anatomy, appetites or powers.

Owning-character lore and other participants' knowledge are distinct. Observer packets require an explicit known-rule key or qualified public fact. Exporting someone's curse, method or private mark does not make it known to everyone. Scene-dependent cards require structured tags/observations; chat prose is never classified by another model.

## Current installed-pack compatibility

The installed pack identifies itself as Warcraft: Guardians of Azeroth Reforged 2 v0.6.5. It differs from the author's pinned source snapshot. Effective discovery finds 557 trait IDs. Of 347 unique catalogue candidate-provider IDs, 82 are absent: 80 `blood_*` providers, `champion_of_the_scourge`, and `wc_no_children_until_married`. Their absent providers remain inactive. This does not justify translating a display name into a missing ID or recreating a trait in CK3.

All three pinned magic/lifestyle formula hashes differ from the current installed files. The exporter reads the game's actual ten net magical-defense script values, including the case-sensitive `wc_Order_magic_resistance_value`; it never uses the older pinned numerical formulas. Racial/ancestral learning aptitude resolves only unconditional numeric XP modifiers or scalar constants from the effective definitions. Unresolved expressions remain unavailable. Flags ending in `resistance` are not assumed positive or stackable. Relevant schools come from captured practice IDs or explicit encounter data.

The narrow production fact adapter currently exports these qualified observations:

| Observation | Actual source |
| --- | --- |
| Binary sex | Character `is_female` trigger |
| Ordinary disease immunity | Actual `can_not_get_sick` trait flag |
| Ageless condition | Actual `no_aging_penalties` flag or `immortal` trait |
| Flight / underwater breathing | Actual `can_fly` / `breath_underwater` flags |
| Light limitation | Actual `can_not_use_light` flag |
| Long lifespan | Effective trait `life_expectancy >= 100`; no inference of personal memories |
| Net magical defenses | Installed pack's corresponding game-calculated script values |
| Innate learning aptitude | Unconditional race/Blood XP modifiers resolved from current definitions |

Advanced positive prerequisites remain dormant until there is an authoritative adapter. Examples include phylactery existence/integrity, retained upbringing/history, literacy, Jinyu waterspeaking, Empress connection/maturation, controller/binding identity, restored cognition/Light access, cure state, actual dragon visage, public disclosure and structured scene tags. The resolver supports these fields; the current capture does not invent or export them. A synthetic restored Broken test qualifies the resolver/model branch, not production restoration capture. Source-backed default conditions continue unless an actual contrary override is known.

## Prompt integration and budget

`goaRuntime.ts` qualifies one current packet using `composeGoaContext` and appends it to the selected description renderer's result. It never edits a player's saved renderer. Chat/group prompts use the actual speaking Character, outside temporary ID swapping. Letters render the actual replying writer and restore original game IDs afterward; a custom template without its description placeholder still receives the complete writer context. Suggestions use the player; action extraction uses its source actor. Scene descriptions use only qualified observer lore. Diaries receive the owning character's context through their existing input; summaries receive resulting dialogue rather than another full catalogue.

No catalogue, source metadata, rule IDs, predicate strings or unresolved braces are sent as the new packet. Applicable cards determine packet size; there is no hard word target. Existing personality, relationship, worldview and player-written descriptions remain present. The shared instruction is:

> Express these facts through the character’s perceptions, manner and choices, with their stated intensity. Individual traits shape expression within those conditions; bodily limits and established control changes remain real. Private knowledge stays private.

Chat removes optional shared culture/faith background first when necessary, then trims older original dialogue while protecting persona, complete lore, player description, instructions and the current turn. If mandatory context plus configured reply budget cannot fit, it reports an explicit context-size error. Letters check their complete context similarly. Disabled lore or unqualified packs retain the legacy chat path. Other prompt surfaces do not silently truncate these added clauses; they keep their existing provider handling.

### Revision 2: quieter physical context

The user approved a refinement on 2026-10-07 because the first packets overemphasized current forms. Ordinary packets now begin `Warcraft context for <name>:` followed directly by selected prose. They no longer announce `Current body`, list pronouns or describe themselves as the character's own context. Canonical sex still chooses authored grammar and the Succubus/Incubus and Dryad/Keeper branches; the body and pronoun diagnostic fields remain internal. An unresolved active transformation or explicitly qualified sexless adapter can still receive a narrow clarification. Voidwalker prose already states its sexless nature, without a second header.

Thirty-four physical cards were shortened to necessary facts, removing incidental directions about seating, clothing, doorways, touch and tactical scene handling. A Dryad still has a humanoid torso on a four-legged deer body; a cat transformation still has paws and claws. Four other cards fold Succubus/Incubus and Dryad/Keeper names into their existing prose and identify Voidwalkers as sexless. In total 38 of 297 cards changed; 259 cards and the original source catalogue remain unchanged. Rich appetites, powers, loyalties, conflicting pressures and limits remain available. Do not replace those meanings with mere race names in a future cleanup.

Predicate selection, nature/body/controller distinctions, privacy gates, dormancy rules and budget protection are unchanged. Resolver version is now `2`; its digest invalidates the prepared addon even though the CK3 capture expressions themselves are unchanged. Culture, faith and per-character Zealous influence are unchanged.

## Verification and Mimir experiments

The latest [secondary review](goa-lore/secondary-review.md) supersedes the older prose/verification counts below: resolver version 4, 125 passing local tests, all 297 cards reviewed, 23 cards revised and four complete authored combinations. Its completed study includes 58 matched baseline replies, 58 final replies and 13 lore-disabled controls, with another 40 exploratory/superseded replies retained honestly. Ordinary lore uses 17.4% fewer estimated tokens across the matched nonempty ordinary fixtures; the exceptional Fallen controller policy is intentionally stronger and longer. It adds no runtime model calls or capture expressions and leaves culture/faith/Zealous behavior unchanged. New CK3 capture still needs direct engine verification.

The TypeScript build and 111 tests across 12 suites pass, including catalogue/coverage integrity (297 rules, 345 Warcraft and 294 core coverage rows), grammatical references, exact combinations, forms/controller replacements, privacy, restoration, independent magic methods, snapshot compatibility, speaker/writer selection, stale-state invalidation and protected-budget behavior. Revision 2 adds a behavior check for quiet headers, brief anatomy, sex-dependent names and preserved ordinary male grammar. Eight Python deployment/process-guard/rollback tests pass. The generated typedef file passes JavaScript syntax checking. Engine verification remains a separate step.

`tools/goa-mimir-regression.cjs` uses the saved production provider, active preset and renderer, production capture readers/resolver/builders/API client, and synthetic characters. Credentials stay in memory and player histories are never copied. The Zealous Fel Orc reuses copies of the accepted anonymous culture and faith profiles; exact text and the existing Zealous emphasis are asserted in the composed request. Other fixtures isolate the new layer. There is no model grader or hand-written substitute lore packet.

The first run completed 13 chat cases plus one letter; two additional focused cases tested male Incubus and restored Broken Light access. All 16 returned visible content. The first run's full prompts measured 587–1,410 tokens, with applicable lore packets 214–390 tokens (the unsupported hidden-mark packet was empty). The additional Incubus packet was 275 tokens and restored Broken was 179. These use the existing cl100k tokenizer and are measurements of these fixtures, not universal token bounds.

Reports, exact selected blocks and captured chat requests are in ignored local output:

- `out/goa-mimir-live/results.json` and `transcript.md` — first 14 cases.
- `out/goa-mimir-incubus/` — male sex variant.
- `out/goa-mimir-restored/` — authoritative synthetic override.
- `out/goa-mimir-preflight/` — initial production composition checks without model calls.

Observed successes: a compassionate vampire bandaged the friend while feeling hunger; an adopted Troll identified with dwarven upbringing; female Succubus and male Incubus used the corresponding grammar and showed possessive pressure alongside restraint; female Dryad and male Keeper kept their distinct body/context; Voidwalker used they/them and energy tendrils; the Satyr stayed in the current cat body; Fallen spoke as the replacement intelligence; Spirit and Decay were described as different methods; injury plus negative defense discouraged standing in flames; the hidden mark did not enter the new packet. The restored Broken offered Light healing without gaining a different race.

Limits: these are finite synthetic scenes, not a controlled proof of optimal roleplay. The craven Zealous Fel Orc acknowledged fear but accepted the duel, so fear did not force avoidance. The Incubus restrained the binding spell but still made a possessive threat. Mimir invented some myths, rites, anatomy/healing embellishments and personal history beyond the packet. Such additions remain model behavior to assess, not validated canon. User-reported parallel context spillover should be diagnosed against the exact submitted request, rather than automatically blamed on this feature. This run did not show a coding spillover artifact in its inspected responses.

Revision 2 completed nine more production-path Mimir responses: compassionate vampire, female Succubus, female Dryad, male Keeper, sexless Voidwalker, shapeshifted Satyr, Fallen Demon Hunter, male Incubus and female Succubus letter writer. Exact requests and responses are in `out/goa-mimir-prose-v2/results.json` and `transcript.md`. Selected rule keys match the retained revision-1 code/assets in all nine fixtures. Lore packets measured 222–268 tokens, versus 238–337 for these same packets before refinement; individual savings were 11–69 tokens. Full chat prompts measured 808–886 tokens; the letter prompt was 670. This comparison measures composed text, not paired causal model performance.

The replies preserved the intended female/male branches, deer anatomy, cat transformation and lack of flesh in the Voidwalker. Vampire and Sayaad appetites remained visible alongside restraint. The letter gave trust without an anatomy announcement. Physical description still appeared when Mimir chose it; shortening the packet does not guarantee a model will stop embellishing bodies. The Voidwalker narration used it/its rather than the packet's they/them, and invented absorbing soup into mist. The Keeper invented a ritual and justified cutting the healthy tree despite available fallen wood. Fallen Demon Hunter blurred the former hunter and replacement demon with a fusion claim, although the resolver suppressed former Gnome habits. Those are model limitations, not successful demonstrations of every nuance. No inspected response contained coding spillover. The tests establish deterministic text and selection; these finite replies do not establish an optimal formula or CK3 engine capture.

## Deployment and the next engine check

Keep development/staged output separate. Use `tools/deploy-live.py stage --stage out/goa-live-deployment`, Windows verification via `tools/wine-smoke.cjs`, then the guarded `update` action. The tool requires CK3, Paradox launcher and VOTC to be closed and must run with host process visibility. It verifies all staged trees, current three catalogue digests and active mod order, backs up the dedicated application/addon/configuration/registry, preserves existing settings and both libraries, and supports rollback. It never edits Steam's Workshop installation or replaces the upstream package.

Use the existing **VOTC Titan Edition** desktop companion and current **VOTC Titan Edition Backgrounds** addon after the Community Edition Workshop mod in the Warcraft playset. The addon directory and registry identity remain stable; no different mod selection is required. The Warcraft lore setting appears in **System** and defaults on. Existing culture/faith toggles remain separate.

The initial guarded update was installed from `out/goa-live-deployment-final` on 2026-10-07. Its private rollback backup is `/home/titan/.local/share/votc-mimir/deployments/20261007T154232Z`. The addon retains its existing registry identity and position 5 in the Warcraft playset. The companion and upstream package retain their established paths. Run `python3 tools/deploy-live.py rollback --backup <backup path>` with all three applications closed if rollback is needed; inspect any later settings/playset changes first. The secondary-review backup below is now the latest rollback point.

Windows verification passed on Electron 33.0.0 / Node 20.18.0 / ABI 130, including both native SQLite libraries, all three Wine/native catalogue digests and female lore rendering. Nine generated addon files parsed successfully. The installed real System window confirmed Titan branding, original Community Edition userdata path, all three toggles enabled, both libraries at one ready profile each, and Warcraft capture prepared/awaiting its first complete character. A normal companion was restored without the temporary localhost debugger. `out/goa-wine-smoke.log`, `out/goa-deployment-ui-smoke.json`, `out/goa-live-update.log` and `out/goa-live-continuity.json` contain narrow evidence.

The initial update preserved all prior config values, selected renderer, active registry/order, original upstream executable/API client and all 155 stored-data files byte-for-byte before startup. After startup, 153 player-store files and config values still matched; both library tables matched the retained pre-deployment copies across every persisted column. Normal SQLite initialization writes WAL/header metadata, so a subsequent byte hash of a database is not a sufficient content-preservation test. Culture digest remains `6f68f10f290351a3e429d18e62a4fc3641aeeae116ad9d553a7d131c2b52c8a4`; faith remains `81e4de55506966170dca46d4141c985696ce6d9dd35be175eed4d58ad6333110`; the initial GoA digest was `e14ea27b2e5a97d47ad063c6d4945455d57ff72d916426d399ad5110c18016d6`. Final local handoff notes include post-deployment evidence beyond the packaged documentation snapshot.

Revision 2 is now installed from `out/goa-prose-v2-deployment`. Its backup is `/home/titan/.local/share/votc-mimir/deployments/20261007T175938Z`, preserving the previous working GoA implementation. The current GoA digest is `c7373b713e7229e9e4fcb1d47e0bc0160e25c16c33365f32c3f696501921837c`; culture and faith digests are unchanged. Both installed trees matched the staged manifest. Nine generated addon scripts/descriptor files parsed, and Windows Electron/native SQLite verification passed with all three matching digests. The installed System window confirmed all three toggles, original userdata identity, both libraries with one ready profile each and GoA prepared/awaiting a complete capture. The companion was reopened normally through the existing launcher without a debugger.

Before startup, all 161 stored-data files, configuration values, renderer, playset registry/order and original upstream executable/API client matched their pre-update fingerprints. After startup, all 155 non-database stored files and every persisted column of both library tables matched the pre-update copies; configuration values still matched. Six SQLite database/WAL/SHM files were checked semantically rather than requiring unchanged metadata bytes. Evidence is in `out/goa-prose-v2-wine-smoke.log`, `out/goa-prose-v2-live-update.log`, `out/goa-prose-v2-deployment-ui-smoke.json` and `out/goa-prose-v2-continuity.json`. No extra user action or mod selection is required; the next CK3 session must use the updated addon.

The revision-3 secondary review is now installed from `out/goa-review-v3/deployment-final`, with resolver version 4 and GoA digest `4aad2b29df7b301eb8b021a0df7c4952f5a15ce41730dda232c3b92b9d55115a`. Latest rollback backup: `/home/titan/.local/share/votc-mimir/deployments/20261007T195427Z`. The [review's installation record](goa-lore/secondary-review.md#installed-revision-3-review) documents final Wine/native SQLite checks, installed tree hashes, actual System readiness, 159 unchanged stored files before startup and 153 unchanged non-database files plus complete library-row/schema preservation afterward. Culture/faith content digests, settings, userdata identity, upstream files and playset identity/order remain unchanged. The companion is running normally without a debugger; the existing addon remains at position 5.

The new literal trait logger, census getter and net-value exports have local/generated-script and synthetic-reader evidence. They still need a real CK3 encounter after restart. On that encounter inspect the monitored game `logs/debug.log` for a complete matching `VOTC:GOA` frame, error logs for unresolved getters, System status for verified captures, and the actual outgoing request for the actor's selected packet. This final engine/request chain must be verified before calling GoA capture fully working in-game.

Implementation, tested constraints, model limits, deployment and pending engine status were saved in Déjà Vu under `VOTC-Mimir`: revision `capture.revision.1806e78a2d0946b898766f2108875766`, capture `central.01601853aa7f4f90a48c68853f73db9a`. Its reported success applies to implementation/deployment checks; storage attribution is not independent execution or CK3 verification. No credentials, player dialogue or actual shared snippets were placed in that record.

The user-approved revision-2 refinement, nine additional model responses and latest deployment/preservation checks are also saved in Déjà Vu: revision `capture.revision.7f5fa6b5836e49c39762f951350548a9`, capture `central.51ab6a9d179c493fa29c25fb8f181da0`, derived from the initial implementation record. The same attribution and engine-verification limits apply.

The installed secondary review and completed matched study are saved as revision `capture.revision.f3cb719d4ebe4f6b8f11a0b39f2f6682`, capture `central.a156aef969ac435b9431aad0557afe08`, derived from revision 2. Read its [detailed local record](goa-lore/secondary-review.md) for user-authored Fallen policy, full-catalogue decisions, experiments, preservation checks and remaining engine limits.

### Native engine observation, 2026-10-07

The corrected native CK3 retest now supplies two actual complete GoA frames accepted by the installed production reader: canonical male sex with exact seven- and nine-trait censuses. The retained request audit identified Warcraft context in five parseable actual character requests. The installed-package context shim reconstructs their applicable packets and confirms the latest character's complete selected packet reaches API serialization alongside both newly ready culture/faith snippets. That last comparison is an intercepted replay, not an actual new Mimir submission. It does not verify every optional adapter, sex-specific branch, transformation or controller case in-engine. Read [the native acceptance/audit record](titan-native-rebrand.md#closed-game-generation-and-context-audit) for exact limits and the pending fresh live request. No lore formula, predicate or capture expression changed in this audit.

The following real session added female/male captures with eleven/seven canonical traits matching the base exporter, three qualified boolean-fact fields and all ten numeric net-defense values. Its reopened character request 15 contained the complete selected seven-rule lore packet plus both exact cached background paragraphs, and Mimir returned a successful stop reply that the user saw. A subsequent actual request reused those same blocks. This completes the observed capture-to-request chain for these characters and supported ordinary/magic rules; advanced controller/optional-state branches still need their own engine evidence. See [accepted native runtime](titan-native-rebrand.md#native-acceptance-and-normal-shortcut-promotion).

## Standard CE inline capture correction (2026-10-08)

The portable companion now scopes chat captures through CE’s ordered participant list/player root and letter captures through existing thread globals. Exported numeric GetID is not treated as a historical `character:<key>`. In the console-run context, temporary inline values are valid in script comparisons but `TopScope.GetValue` in debug-log localization returned zero. Four script-selected literal decimal census digits retain exact trait-count validation without a custom script-values file or persisted character variable. The reader requires every unique digit, matching complete frames, exact unique canonical traits and observed sex; legacy addon count records remain supported.

The corrected production shim accepted two real GoA frames, with exact census and sex, while the extra backgrounds addon was disabled. The correction is installed in native hash `155ef9dc59d71c77e5e35bba5f5a8a1457a30985902fe492777c868908d5ddd7`; source/native checks pass and saved data were preserved. Automatic new-chat outgoing-request verification, a real letter and untested optional branches remain pending. Resolver wording, controller precedence, sexed/sexless exceptions and advanced predicates are unchanged. See the cultural guide’s current engine and installation sections.

The following normal native launch now verifies the **automatic** route: two accepted GoA captures with canonical male sex, exact nine/seven-trait censuses and all ten numeric defenses arrived with the extra addon disabled. One capture also supplied agelessness, underwater breathing and ordinary-disease immunity. The speaking character's complete selected undead/troll/ageless-parenthood packet appeared in actual request 6 alongside both exact cached backgrounds and the canonical Zealous rule; Mimir completed the request successfully. This supersedes the automatic-request pending statement, while real letters and untested optional branches remain pending. Standard CE's localized trait names do not themselves provide canonical IDs; the authoritative canonical census comes from the accepted GoA frame. No resolver or catalogue wording was changed by this audit. See the cultural guide's automatic-acceptance section and ignored content-free receipts.

## Expanded racial guidance, resolver 5 (2026-10-11)

The user's expanded packet supplies enduring character guidance as well as material
for the future scene lorebook. This revision curates every one of its 115 sections
against the existing complete steering. The priority is the user's explicit choice:
**effective GoA2 first, older Warcraft lore next, compatible synthetic extrapolation
after that**. Later lore helps fill a gap; it does not silently replace the local
game's meanings. The byte-exact [full packet](goa-lore/source-packets/Warcraft_GoA2_Race_RP_Expanded.txt)
is preserved with SHA256
`a3215333063c3e93a793ef5fce2cbf376fbf4a624561168ee91e47f8de1a7306`.
The [115-section decision ledger](goa-lore/racial-guidance-decisions.json) records
each section's persistent extract, intensity, existing rules, additions, activation
limits and conflicting claims. Preservation does not certify every synthetic
worldbuilding detail as canon. The complete future lorebook is not implemented by
this change.

Persistent context supplies inhabited body, genuine needs, recurring attention and
enduring pressures. Learned language, greetings, dishes, rites, titles, law, caste,
faction history, remembered events, objects and particular places stay in the full
packet for retrieval or an actually established background. No character is assigned
a hometown, profession, childhood, faith, office or inventory from a race name.
Ordinary habits can shape a reply without being recited; situational lore is not
made omnipresent just because it appears in the same source section.

### Influence and personal choice

Compact selection does not mean uniformly light influence. The prose carries the
strength appropriate to the nature being portrayed:

| Influence | What it means in a scene | Representative cases |
| --- | --- | --- |
| Subtle | Bodily experience or a characteristic point of attention; individual temperament and actual upbringing carry most of the expression. | Humans, mixed ancestry, ordinary Draenei, Makrura reserve, Sethrak composure. |
| Pronounced | A recognizable recurrent repertoire in what feels interesting, rewarding or threatening, with substantial personal variation. | Goblin profitable ingenuity, Gnome discovery, Orc resolve, Dwarf workmanship, Nerubian deliberation, Mechagnome precision, Tortollan stories. |
| Dominant pressure | An appetite, curse or severe disposition remains compelling; mercy, loyalty and restraint require something worth the cost. | Satyr corruption, Sayaad possessiveness, vampire blood hunger, Fel Orc bloodlust, Black Dragon cruelty, Flamewaker submission, Kvaldir grievance. |
| Confirmed condition or control | A qualified impairment limits ordinary capacity; an actual controlling identity follows its separate established rules. | Lost One cognition, conditional Mindless Worgen, the user-authored Fallen Demon Hunter controller policy. |

The ledger classifies 30 source sections as dominant-pressure, 73 as pronounced
and 12 as subtle. These are editorial section counts, not new runtime switches or
counts of currently active cards. A curse is not automatically possession. The
Fallen policy still retains the captive hunter while the demon alone acts; owner
and observer knowledge remain separate. A generous Goblin can enjoy a clever deal,
a fearful Orc can make resolve meaningful through retreat, and a compassionate
vampire can care while managing predatory access. An adopted culture can redirect
the expression of a repertoire without supplying the parent's anatomy or powers.

### Authored changes and actual support

The original 297-card catalogue remains byte-for-byte intact. Its complete
predicates and four authored overlap compositions are retained. A separate
`public/goaLore/racial-extension.json` adds 14 fixed cards and joins the same
deterministic resolver, making 311 cards with 1,244 main grammatical variants.
No model router, extra generation lane or full-catalogue prompt was added.

Twelve new cards have providers in the installed GoA pack: Black Dragon,
Flamewaker, Nerubian, Qiraji, Fal'dorei, Kvaldir, Makrura, Sethrak, Tol'vir,
Sea Giant, Frost Nymph and Voidwalker. Healthy Frost Nymph playfulness still
requires the uncorrupted nature bond. Mental manner survives an ordinary changed
form, while current anatomy remains separately gated. A verified controller
replacement suppresses the former mind's unsupported habits. Ancestry alone
activates none of these parent profiles.

The two Worgen cards separate feral curse pressure from the explicit Mindless
condition and restoration. **They remain dormant:** the effective installed
definitions contain neither `worgen` nor `mindless_worgen` as active canonical
traits. Localization and commented future references are insufficient. Three
Worgen model fixtures are therefore excluded rather than faking game support.
Hobgoblin guidance is likewise retained in the source, without an invented trait
or anatomy adapter. Missing provider IDs increase from 82 to 84; the already
unsupported Blood providers and other historical absences stay inactive.

Fourteen original mental cards are reinforced: Gnome, Goblin, Orc, Dwarf, Imp,
Nathrezim, Satyr, Sayaad, Observer, Ered'ruin, original Mechagnome, Tortollan,
Vulpera and Vampire. Every original sentence is retained. Flamewaker anatomy gains
one necessary clarification: its humanoid torso rises from a serpentine lower body
and moves/rests with coils. One original Troll neutral-grammar error is corrected;
the added neutral variants use plural agreement. In total 30 template cards change:
14 added, 14 mental reinforcements, one body refinement and one grammar correction.
Kvaldir is explicitly nonliving so its spirit nature does not acquire living-mortal
Void pressure through another race label.

The final ledger decisions are 74 retained sections, 27 reinforced, 12 expanded
and two held for unsupported providers. Several sections share a single racial
card, so section counts differ from template counts. Draenei retain GoA's
Argus-exile eredar identity; Lightforged means Draenei plus actual Light infusion,
not the packet's consecrated Lost One interpretation. Lost One cognitive limits
remain distinct from faith and restored Light access. Revenants remain GoA's
necromantically returned warriors, rather than the old RPG elemental portrayal.
Black Dragons retain GoA's cruelty without imported later-flight redemption.
Mechagnomes remain original conscious constructs. Generic Giants do not receive
unobserved mountain/frost/molten subtypes, and Mantid development still needs its
actual stage. These corrections preserve the user's source hierarchy.

Culture/faith recipe 4, existing hashes/libraries, light ordinary influence and the
separate Zealous rule stay as currently installed. The latest concurrent formula
release incorporated the initial racial assets; this revision retains that release
and finishes the Flamewaker/grammar refinements. It does not restore the older
recipe-3 build used to isolate the racial comparison. All 868 scene IDs, captions,
art, gates and full game files remain unchanged. Standard CE inline capture is
used; the preserved disabled background addon and frozen Wine are not updated.

### Evidence, release and remaining limits

All 305 application tests across 30 suites and 94 deployment tests pass. The
authoring audit proves the original catalogue, all 297 original executable
predicates, original prose and compositions, 115 source decisions, key parity,
slots and grammatical variants. Dedicated resolver checks cover actual race versus
ancestry, privacy, controller suppression, changed anatomy, corrupted nature,
Worgen reason/restoration separation, canonical sex and Kvaldir's nonliving state.
These checks complement the semantic review; they do not independently verify every
claim in the source packet.

The final current-package preflight checks 49 chat/letter prompt compositions
through the production capture reader, resolver, saved renderer and builders, with
zero model calls. Its isolated background libraries are explicitly disabled; it
does not claim another Zealous-library integration test. The three unsupported
Worgen cases are reported separately. An earlier frozen recipe-3 preflight checks
46 compositions with copied accepted backgrounds. Partial library-backup attempts
and two unrelated old-fixture failures in the historical isolated package remain
preserved; they are not counted as passing final checks.

Eight matched baseline/candidate cases produced 16 normal-budget visible Mimir
stop replies in frozen recipe-3 packages. They cover vampire care, a cat-form
Satyr, generous Goblin companionship, Flamewaker and Nerubian shelter, Voidwalker
manner, Black Dragon equality and a female Sayaad letter writer. Candidate Black
Dragon equality carried clearer possessive cost and Flamewaker manner was more
commanding; other differences were smaller or inconsistent. Neither package
universally obeyed sexless Voidwalker grammar. Both invented props, history and
magical effects. The candidate Nerubian confused Dwarven upbringing with stone/iron
identity, and both Flamewakers initially used human movement.

Eight further candidate-only responses use the current package with recipe 4,
synthetic backgrounds disabled. GoA-first Draenei/Lightforged/Lost One/Revenant
portrayals, Flamewaker defiance, Nerubian evidence, Kvaldir grievance and Mechagnome
care all returned visible stop replies. The refined Flamewaker used coils; the
Nerubian asked for evidence and the Kvaldir listened while preserving grievance.
Limits include invented remembered empires, Kvaldir gills, structural-stress scent,
and treating differing sincere faiths as faces of the Light. These are 24 finite
racial-study replies, not a universal superiority claim or fresh CK3 acceptance.
Trait-name recital remains a separately deferred prompt issue.

Exact synthetic requests, replies, comparative assessment, audits and deployment
receipts remain private ignored output under `out/racial-steering-expanded/`.
`release.json` records the guarded native installation, exact application hash,
backup, four sealed desktop reports, preservation and refreshed portable bundle.
Do not infer installation merely from source edits: inspect that receipt and the
installed hash. Rollback restores its exact native backup with VOTC/CK3/Paradox
closed; the game component did not change. Earlier automatic CK3 capture/request
acceptance remains valid evidence for those earlier characters, while this new
wording and newly supported race combinations still need a fresh game encounter.
Advanced optional fields, real letter scopes and dormant Worgen support retain
their separate limits.

## Curated racial tone, resolver 6 (2026-10-11)

The revised packet guides how a character notices, speaks and chooses across
scenes. The user's direction is creative curation: give races distinct texture
at the intensity their nature warrants, while preserving individual nuance.
The [complete revised packet](goa-lore/source-packets/Warcraft_Race_RP_Guides_Revised.txt)
is retained byte for byte, SHA256
`62156cbdf433c03f623b065a0072457cfa53a5f6fefef110a86e276a1b6d469f`.
Effective GoA2 continues to take precedence over older lore and compatible
synthetic guidance. Its detailed customs, rites, offices, faction history and
personal events remain available for the future lorebook or an established
background; this revision does not implement that retrieval system.

The [race review](goa-lore/revised-tone-review.json) covers all **92 actual race
providers**. Twelve receive subtle influence, sixty a recognizable repertoire
and twenty strong pressure. These are editorial judgments, with conditional
cognition and controller rules recorded separately. A quiet Human or generic
Giant need not announce an archetype. Gnome discovery, Goblin opportunity, Orc
resolve and Nerubian precision can give ordinary companionship different textures.
Ghoul hunger, Fel Orc bloodlust, Satyr corruption and Faceless domination remain
costly pressures even when the character chooses care. Confirmed controller
replacement retains its own existing identity policy.

Twenty-three existing template cards are refined or clarified, with exact
before/after fingerprints in the [authoring record](goa-lore/revised-tone-authoring.json).
Several passages are rewritten for a clearer voice instead of indefinitely
appending another explanation. The original 297-card source catalogue remains
byte-identical; its complete executable predicates, four overlap compositions
and fourteen previously added extension definitions are retained. There are
still 311 effective cards. Body, sexed identity, actual powers, observer privacy,
ancestry and controller distinctions remain separately resolved. No provider,
capture field, routing model or generation lane is added. Worgen remains dormant
without an actual provider.

### What the replies informed

Actual Mimir replies drove successive refinements. A kindly Imp initially became
a solemn counselor; the revised manner can ease fear with cheeky mischief. A Ghoul
initially denied hunger while tending blood; its final reply catches a hungry
glance and deliberately looks away while staying close. Nathrezim assistance now
probes the offered confidence, and Faceless shelter can retain the temptation to
make defiance yield. Satyr care deliberately redirects cruel amusement. These
choices remain personal. Draenei ancestry supplies no automatic priestly healing,
Drogbar affinity supplies no unestablished stone-shaping practice, and undead
elven continuity does not restore living arcane dependence. Leper Gnome kindness
can coexist with visibly damaged clarity.

The study reviewed **329 synthetic replies**, including 92 installed-baseline
quiet replies, 92 candidate quiet replies, 92 candidate pressure replies,
fourteen branch replies and targeted exploratory/refinement runs. Six initial
pilots had an imperfect personality classification and are exploratory only;
the full rosters use corrected canonical personality categories. Every final
quiet/pressure selection and all fourteen branches have actual model evidence:
198 final selected texts and their other packet metadata match the reviewed
requests. Whole-catalogue-derived packet hashes can change when an unselected
card changes, so equality is proved against the selected content, not inferred
from the hash alone. Tone judgments came from reading the replies, without
automatic phrase scoring.

Strong expression still varies with the scene and sampling. Trait recital, a
shared noble/caregiver cadence, invented biography or equipment, unsupported
magical certainty and occasional anatomy errors remain observed model limits.
An accepted passage is a reviewed steering choice, not a promise that every
future reply will obey it. Background libraries were disabled only inside this
isolated racial study; live background influence was preserved.

### Native release and preservation

The guarded installation is native application
`b941f5c6afcea8d6ef71f60180c0a754d18a61852f80c92571793c60f76a9bad`,
backup `native-deployments/20261011T113229424678Z`. A concurrent background release
landed during verification. The guard stopped the earlier candidate; the racial
delta was rebased onto that actual installed parent
`98d0f7f650b795bbf941bf6788a845d84fae7f6e233e9b65c3f59f1c889fec20`,
preserving **culture 7 / faith 5**. All 198 isolated racial prompts and packets
match the reviewed candidate exactly after that rebase. Only templates, resolver
version/instruction and their two generated JavaScript modules differ from the
new parent. Native dependencies were copied from the installed Electron 33
runtime without rebuilding development or Wine modules.

All **329 application tests across 32 suites**, **94 deployment tests** and four
sealed native reports pass. Every one of the 572 saved-data files and checked
game/mod, addon, playset/load, launcher, shortcut and frozen-Wine fingerprints
remains unchanged. All 868 scenes and their art/gates remain intact. The portable
bundle matches the installed pair. Exact requests, replies, preservation hashes,
source isolation and release receipts remain private ignored output under
`out/racial-guidance-revised/`.

Rollback uses the exact native backup above with VOTC/CK3/Paradox closed; it keeps
the concurrent culture/faith release and requires no game rollback. Fresh CK3
acceptance of resolver 6 remains pending. Earlier engine capture evidence is not
a new in-game judgment of these voices.

## Attachment and chosen purpose, resolver 7 (2026-10-11)

The user revised the packet again after accepting resolver 6. The new
[complete source](goa-lore/source-packets/Warcraft_Race_RP_Guides_Revised_06907a92.txt)
is retained byte for byte, SHA256
`06907a92c0d68eaa80f5f6a36c34385c093a066156f327c9fa9fcb65afe0d21a`.
The earlier source and its authoring review remain intact. Effective installed
GoA2 still governs conflicts, followed by older Warcraft lore and compatible
synthetic guidance. Comparative inspiration does not establish Warcraft powers,
anatomy or history. The added appendix creatures have no matching installed
provider and are held rather than grafted onto a similar race.

The [new review](goa-lore/attachment-tone-review.json) accounts for all 153 source
sections and all 92 actual race providers. Those are applicability decisions,
not exhaustive verification of every statement or bibliography. The influence
judgments remain twelve subtle, sixty recognizable and twenty strong pressure.
Seventy-eight provider packets retain their installed text. Fourteen providers
receive fifteen refined cards: Kobold, ordinary Abomination cognition, Bronze,
Green and Red Dragon, Dryad and male Keeper, Centaur, Nerubian, Man'ari, Pit Lord,
Sayaad, Banshee, Lich and Qiraji. Dryad and Keeper are two branches of one actual
provider. These are prose judgments, not new numeric weights.

The emphasis is what can reward, hurt or occupy a character in an ordinary
exchange. Sharing protected light can express Kobold trust. Recognition can
matter to a blunt Abomination without replacing hunger. A Red Dragon may find
reward in another person's recovered independence. Precise accomplishment can
stir Nerubian pride. A Pit Lord can admire endurance while still wishing to own
its source. Sayaad intimacy can seek the place of indispensable confidant;
another friendship can sting without a sexual rivalry. A Banshee can choose
present connection alongside grief. The [authoring record](goa-lore/attachment-tone-authoring.json)
preserves exact before/after fingerprints and the finite model observations.
Specific customs, offices, faith, possessions and remembered events require
established background or future retrieval. The full packet is not forwarded
to the model, and this pass does not build the lorebook.

All 311 cards, 1,244 main grammatical variants, 297 original predicates and four
complete overlap compositions remain. Actual race, ancestry, underlying nature,
current body, sexed identity, observer privacy and controller policy keep their
existing resolution. Genius Abomination cognition remains an exception to the
ordinary slow-cognition card. Sayaad mental nature persists in cat form; a male
Sayaad remains an Incubus. The Fallen Demon Hunter's captive hunter does not
become the acting controller. No provider, capture field, power, router or
generation lane is added.

### What the comparison supports

All 95 synthetic Mimir replies were read. Thirty-five cases compare the installed
racial baseline and final selected wording under the same questions, model,
sampling, saved renderer and preset; seventeen additional branches have final
candidate replies. Eight earlier candidate replies are superseded by Red Dragon
or Sayaad refinements. All 52 final selected texts, other packet metadata and
complete production prompts match actual reviewed requests after rebasing onto
the current installed culture 7 / faith 6 parent. Fresh production projection
also proves matching selections and unchanged non-lore context across all 92
providers; it is not 92 new live-model comparisons. Background libraries were
disabled only inside this isolated racial study.

The final Red Dragon accepts independently chosen travel. The Pit Lord keeps
predatory pride while honoring a promise. The Man'ari feels the attraction of
power but declines to sell an ally. Ordinary Abomination speech becomes more
concrete, and the exceptional-intellect branch suppresses that usual limitation.
The final Sayaad confidence exchange permits the other friend while seeking
priority in future disclosures. These are finite observations, not a promise
of stronger texture in every scene or sample.

Limits remain explicit. Several replies invent equipment, memories, spells,
anatomy or expertise, and the saved personality examples encourage trait recital
and a common courtly cadence. Bronze timeway costs and a Lich's reference to the
foreign-setting Weave were not supplied or accepted. An unchanged Darkfallen
packet correctly excludes living arcane dependency, yet its reply claims hunger.
The final Sayaad letter still invents a prior confession and implies remote
surveillance; present-exchange and target-dependent wording did not eliminate
that failure. Some male or cat-form kindness replies soften the appetite. The
Fallen Demon Hunter reply leaves agency oblique and can reveal private captivity
in narration. These remain model limits, not established facts or new powers.

### Release evidence and rollback

All 337 application tests across 33 suites and 94 deployment tests pass. The
final authoring audit proves source preservation, complete predicates, variants,
compositions, all 153 decisions and all 92 reviews. It also proves the declared
rewrite path through the preserved resolver-5 and resolver-6 parents. Native
verification uses four disposable desktop reports with no model requests;
sealing binds them to the actual application and launcher.

The racial runtime delta is the templates and resolver version in TypeScript
and generated JavaScript. The regenerated source map is byte-identical to the
current parent. Native dependencies are copied from the accepted Electron 33
installation without rebuilding the development or frozen Wine modules. The
guarded deployment preserves the current culture 7 / faith 6 release, not the
older culture 7 / faith 5 package used for the initial isolated comparison.

Exact requests, replies, source isolation, desktop reports, preservation checks,
application hash, native backup and portable receipt are private ignored output
under `out/racial-guidance-pass3/`; inspect `release.json` and the installed hash
for deployment status. Rollback uses that receipt's exact native backup with
VOTC/CK3/Paradox closed. The game component does not require a rollback. All 868
scenes, userdata, addon/playset settings and the frozen Wine fallback are
preservation targets. Fresh CK3 voice acceptance of resolver 7 remains pending;
source, desktop and synthetic model evidence do not establish it.

The completed guarded installation is native
`f05decab093526b41cbad5c1dc806e5e2709f98ad2029eb8fdea2c87372e7e56`,
backup `native-deployments/20261011T140609451860Z`. Its actual parent was
`f5c196586c778ebacd2bd653274b07921d7889ef808f4c0579a96c33cba0f112`;
the deployed versions are culture 7 / faith 6 / GoA 7. All four native reports
are sealed, and a final 63-test GoA check passes after the last prose refinement.
All 572 saved-data files and every checked game, addon, playset/load, launcher,
shortcut and frozen-Wine fingerprint remain unchanged. The installed, private
stage, standard stage and portable application hashes match; all three game
components retain the same 868-scene build. The release receipt records these
checks and the finite model limitations above. This post-installation receipt
paragraph lives in the workspace guide; the sealed package's preceding chapter
points to the same private release receipt without a second documentation-only
installation.

## Whole-roster essence review, resolver 8 (2026-10-11)

The user's latest preference supersedes the earlier creative-source ranking:
effective installed GoA2 governs conflicts, while the user's revised synthetic
packet is the primary source for racial expression. Web sources supplement gaps
or uncertain details. The byte-exact `06907a92` packet and all 153 applicability
decisions remain preserved; earlier authoring chapters remain historical.

The [essence review](goa-lore/essence-tone-review.json) records two manually read
baseline replies and two universal-instruction experiment replies for each of the
92 actual race providers. Intensity remains twelve subtle, sixty recognizable
and twenty strong pressure. Quiet or compassionate choice is not automatically
weak racial expression, and cruelty is not automatically a failure. Personality
and actual commitments shape how an impulse is felt and acted on.

Six providers receive six refinements. Imp reserve and laziness can carry furtive
cheek and convenient mischief. Harpy vanity can occupy quiet attention and shared
admiration without imposing sabotage. Ordinary Abomination recognition and care
have short literal words; exceptional intellect remains exempt. A Lost One can
grasp and choose a concrete step without acquiring fluent abstract thought.
Ghoul rest leaves flesh hunger present in attention and checked movement. Jinyu
affinity concerns present water; absent-person knowledge requires an established
gift and actual revelation. The packet has no Jinyu section, so that boundary
uses effective GoA2 and the official distinction between ordinary Jinyu and
waterspeakers, cited in the [authoring record](goa-lore/essence-tone-authoring.json).

The longer shared instruction produced mixed results across all 184 comparisons
and was rejected. The proposed Pit Lord replacement softened dominion and was
likewise rejected. The installed shared instruction and resolver-7 Pit Lord
portrait remain. Eighty-six providers retain their selected text. Specific
customs, offices, faith, possessions, history and trained arts remain conditional
on established background or future retrieval. This does not build the lorebook
or forward the packet/catalogue to the model.

### Model evidence and limits

All 415 synthetic replies were read: 184 baseline, 184 universal-experiment,
28 direct baseline/targeted comparisons and nineteen final original/focused/branch
checks. Final whole-roster coverage combines 172 unchanged baseline requests
with twelve new original-question requests. Ten targeted direct replies have
identical complete final contexts and are explicitly reused. Two new Jinyu direct
checks and five new branches complete the focused evidence. Reuse is not fresh
generation. Every new submitted context matches its frozen preflight; candidate
bytes remain unchanged. The actual saved renderer, preset and Mimir model are
used, with backgrounds disabled only in the isolated harness.

Final Abomination speech is more concrete. Ghoul rest shows attention to a living
throat and checked jaw movement alongside company. Cat-shaped Harpy and Imp
replies retain feline bodies with underlying vanity or mischief. An established
waterspeaker reports no brother image when no revelation arrived. Direct Troll
recovery waits with the missing arm and disability, without self-harm or instant
regeneration; the correct Troll card remains unchanged.

Results are mixed. The Imp original questions remain softer than its open
amusement test. The original Harpy praise reply invents a taloned hand. A Jinyu
original question gets a bounded refusal, but the direct-focus reply still offers
unestablished divination; this is not a reliable model fix. The Lost One direct
demonstration works, while the ambiguous original question reverses teaching roles
and supplies player dialogue. The Genius exception reaches the model, yet its
reply fabricates specialist languages, expertise and implied feeding. Unprovided
props, histories, scene details and trait recital persist. No universal fidelity
or comparative numerical score is claimed; these details become no new accepted
power or biography.

### Runtime and release scope

All 337 application tests, 94 deployment tests and the authoring audit pass.
All 311 cards, 1,244 main variants, 297 original predicates and four compositions
remain. Nature/body/controller resolution, actual sex, observer privacy, optional
gates, culture 7 / faith 6 libraries and Zealous emphasis stay intact. The runtime
changes only templates and the GoA version in TypeScript/rebuilt JavaScript.
The unchanged resolver retains its parent debug map; a harmless compiler-only
map difference in the model candidate is not promoted. Native dependencies come
from the accepted Electron parent.

Exact requests/replies, isolation, final delivery proof and native/preservation/
portable receipts stay private under `out/racial-essence-review/`. Consult its
`release.json` for the guarded hash and exact native backup. Installation requires
four sealed desktop reports with no model requests. Roll back that native backup
with VOTC/CK3/Paradox closed after checking for later changes. The unchanged
868-scene game component needs no rollback for this prose release. Fresh CK3
voice acceptance remains separate from local, desktop and model evidence. This
review does not complete a separate background goal.

The guarded resolver-8 release is installed as
`17211c2a7c133400b58e61939bed3278c285d56bd38e261ada4d0a3f84477f15`,
backup `native-deployments/20261011T161616996075Z`, from actual parent
`f05decab093526b41cbad5c1dc806e5e2709f98ad2029eb8fdea2c87372e7e56`.
Culture 7 / faith 6 / GoA 8, all four sealed desktop reports, 337 application
tests and 94 deployment tests are verified. All 572 saved-file hashes and every
checked game/addon/playset/load/launcher/shortcut/frozen-Wine fingerprint match
the pre-update snapshot. Installed, private stage, standard stage and portable
application hashes match; all three game components retain the same 868 scenes
and `ff9a56fa` game hash. The private release receipt records exact values and
finite model limits. This post-installation paragraph is workspace-only; the
sealed package's review points to the same receipt, without a second installation
solely to refresh documentation. Fresh CK3 voice acceptance remains pending.

## Racial experience follow-up, resolver 9 (2026-10-11)

The [experience review](goa-lore/experience-tone-review.json) preserves all 92
providers, the 153 source decisions and the twelve subtle / sixty recognizable /
twenty strong-pressure distinctions. Effective GoA2 still governs conflicts;
the user's revised packet supplies racial expression. The supplied campaign
books and read-only local Azerothian Chronicle now supplement gaps and context.
Neither their historical portrayals nor the guide's sample clock replace the
current game or establish an individual's biography.

All 337 additional synthetic replies were manually read: 184 personality-paired
roster replies, 48 ordinary and eighteen pressure follow-up replies, thirteen
baseline branch/letter replies, six additional Ancient replies, three baseline
Troll replies, and 65 candidate replies. Later turns used actual preceding model
responses. Complete production prompts and unchanged non-lore contexts are
checked separately from artistic judgement. Exact final-context reuse is declared
in the private delivery proof; it is not fresh generation.

Six cards across five providers are refined. War Ancients notice footing and
practical support even in quiet company, without requiring a campaign or office.
Wind Ancients attend to movement and shared observation, with actual animal
training remaining individual. Ordinary Jinyu keep present sensory affinity;
the separately gated waterspeaker distinguishes seeking a reading from receiving
its actual content. Banshee spectral hands have no ordinary purchase, while voice
and chosen company remain active; possible possession and an actually established
power are preserved. A brief affirmative living-Troll portrait supplies tusks,
pointed ears and long limbs beside unchanged natural regeneration. The longer
Lore Ancient draft is rejected for insufficient improvement.

The final gifted Jinyu letter no longer reports the absent brother alive or
elsewhere; the follow-up keeps the supplied beam/high-water glimpse unnamed.
Final ordinary Banshees pass through cups/stones, actual narrow telekinesis still
lifts the cup, and possession remains a possible future choice. These are finite
observations. A final Troll reply still invents a tail, ordinary Jinyu over-infers
weather, and scene/history invention persists. No reliable universal anatomy,
knowledge or voice correction is claimed. Fel Orc fear and bloodlust, Satyr
seedling temptation, Ghoul checked hunger and Vampire starvation support retaining
their existing costly pressures alongside choice. Deceitful spoken boasts are
distinguished from narrator-certified powers and actual performed acts.

Later RPG Harpy clawed hands and folded wing-arms do not justify the historical
blanket claim that every taloned hand contradicts Harpy anatomy. That earlier
assessment is superseded here; its sealed historical receipts remain intact.
Official Blizzard prose supports a Hozen tail. A Troll portrait is affirmative
supported anatomy, not a categorical absence rule. Edition conflicts remain
visible rather than being silently resolved against effective GoA2.

Only templates and the GoA version in TypeScript/rebuilt JavaScript change at
runtime. All 311 cards, 1,244 variants, original predicates and four compositions
remain; body/nature/controller, sex, observer privacy and optional capture gates
are unchanged. Culture 7 / faith 6, Zealous influence, renderer/provider settings
and all 868 scenes remain the actual installed parent. The 381 workspace
application tests (including 63 GoA tests), 94 deployment tests and authoring audit
pass. The isolated compilation matches the tested candidate; the valid parent
source map is retained because only the isolated output path differs.

Exact synthetic requests/replies, final native production proof, four sealed
desktop reports, preservation, portable matching and guarded rollback belong to
`out/racial-experience-review/release.json` and its adjacent receipts. The private
native stage derives from the complete actual resolver-8 installation, preserving
its Electron dependencies and unrelated runtime bytes. Consult that receipt for
completed installation status and exact hashes. This review adds no lorebook,
new capture field, provider or model routing layer. Fresh CK3 racial-voice
acceptance remains a separate check.

The guarded resolver-9 release is installed as
`1641567269a6fff2144af136db0c480f4e400853442e997ce2a922bdbed2b94c`,
from actual `17211c2a` resolver-8 parent, with native backup
`20261011T195658472968Z`. All four reports are sealed. All 572 saved-file hashes
and every checked game/addon/playset/load/launcher/shortcut/frozen-Wine fingerprint
are unchanged. Installed/private/standard/portable applications match, and all
three game components retain `ff9a56fa` and 868 scenes. Read-only rollback checks
verify the exact actual parent. Déjà Vu has the qualified completion record;
full receipts remain private. This paragraph is workspace-only, after the sealed
package's pointer to its release receipt, without a second documentation-only
installation. Fresh CK3 racial-voice acceptance remains pending.

## Full automatic-steering review, resolver 10 (2026-10-11)

The [full review](goa-lore/full-steering-review.json) freshly covers all 311 cards,
1,244 main variants, four observer variants and four complete compositions.
All 345 Warcraft and 294 core decisions are accounted for. All 265 currently
available catalogue-provider descriptions and meaningful conditional branches
were read. Of 349 provider IDs, 84 are absent from the current game, mostly
historical Blood traits; compatibility entries establish no new capture support.
Effective GoA2 governs conflicts. The preferred revised packet, supplied books,
read-only local Chronicle and qualified primary sources supplement it. The guide
clock establishes no campaign date or individual biography.

Eight prose cards change. Three repair name-only reflexives or comparative grammar.
Wolf regains actual supernatural forewarning of harmful intent without an automatic
weapon, plot or exact movement. Critical burns and frostbite regain immediate danger
to continued life or existence and urgent care. Nightmare-corrupted Nature retains
actual rank and choices while distorted perfection exerts costly pressure even under
benevolent intent. Companionship establishes neither cleansing nor cure. Ice Prison
describes the soul bound to the imprisoned Helm, with established psychic agency.

Five predicate corrections bind Lich, Wickerman, Wicker Golem and Doomguard anatomy
to the current body and require resolved Metamorphosis for its physical paragraph.
Soul-bound prison overrides ordinary physical forms, preserving nature, mantle,
acting identity and canonical sex. Ice Block and Hibernation preserve their bodies.
Removing the prison trait restores ordinary selection; no release event is inferred.
The [authoring record](goa-lore/full-steering-authoring.json) pins exact transitions
and compiled predicates. The audit rejects every undeclared predicate change across
the complete inventory, rather than claiming all predicates remained byte-identical.

All 83 fresh finite Mimir replies were manually read: 25 baseline, 21 completed
candidate-A, fifteen baseline controls, fifteen final controls, five final follow-ups
and two final replies using the original baseline's actual history. HTTP 502
interruptions and zero-response recovery remain separate. All 81 earlier deliveries
were replayed through the final production builder with exact actual history and
unchanged non-lore context. Sixty requests match final context; 21 remain comparative
earlier-wording evidence. The two additional matched-history replies are separate.
Longer talent and arcane drafts were rejected: unestablished novice workings and
invented absent-brother news remained. Concise accurate potential/practice/repertoire
distinctions and actual innate racial powers remain; no spell-list capture was added.

Final replies still invent age, biography, props and scenery; overlook accurate
Polymorph/Hibernation constraints; restore latent wicker anatomy; overextend
perception; confuse a threat's identity; or soften injury urgency and Nightmare cost.
These are model limits, not incorrect selected anatomy. Costly pressure with choice,
controller replacement and recognizable repertoire remain distinct. All prior
twelve subtle / sixty recognizable / twenty strong racial judgements and user-authored
Fallen policy remain. Optional facts/tags and missing historical IDs remain dormant.

All 311 rules have positive synthetic witnesses, including explicit dormant facts;
28 pure resolver contexts verify body priority, release, nature, sex, controller and
observer privacy. These do not establish engine capture. All 420 workspace tests
and 94 deployment tests pass; unrelated existing workspace work is not installed.
The isolated GoA compile and native delta are verified separately. Culture7/faith6,
Zealous, renderer/provider settings, all 868 scenes and frozen Wine retain their
installed meanings. No new lorebook, router or generation lane was added.

Private `out/goa-full-steering-review/release.json` and adjacent receipts record the
guarded native installation, four sealed desktop reports, final production replay,
actual-parent backup, saved-data preservation and matched portable copy. The package
derives from the complete actual resolver-9 installation. Fresh CK3 performance of
the revised prose remains a separate acceptance check.

The resolver-10 native release is installed as
`bd598ec048505fee7312aa3ea50c6892f41f2cbaef17b7de9a5d793abf7d2df7`,
from exact resolver-9 parent `1641567269a6fff2144af136db0c480f4e400853442e997ce2a922bdbed2b94c`,
with native backup `20261011T221145373157Z`. All 572 saved-file
hashes and checked external fingerprints are unchanged. Four sealed reports,
83 final native production contexts, four matching application copies, three
unchanged game copies and read-only exact-parent rollback validate. Déjà Vu
retains the qualified completion revision `capture.revision.139bbb2206b746878c3480f7931faa3a`.
This receipt is workspace-only after sealing, with no second documentation-only
installation. Fresh CK3 performance remains unverified for this revision.
