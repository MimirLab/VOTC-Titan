# Inside Titan

Titan develops the VOTC/Community Edition conversation foundation into a
GoA2-focused roleplay companion. The original projects supply the game integration
and much of the conversation, history, action, letter and settings foundation.
The systems below describe Titan's dedicated additions and integrations.

## The embedded evolving lorebook

The whole assembled runtime edition is bundled in Titan, including the reader
and databases. The release manifest contains:

| Material | Structured passages |
| --- | ---: |
| Base lorebank | 33,366 |
| Expanded setting | 3,364 |
| GoA2 material | 296 |
| **Total** | **37,026** |

The corpus also records **78,269 aliases** and **114,119 connections**. These are
structured corpus counts, not a claim that every possible Warcraft fact or future
story update exists in the collection.

Lexical retrieval selects relevant material. Nested progressive disclosure starts
with a bounded account and allows deeper access, preserving the normal complete
character prompt. Optional qualified semantic routing can help select topics;
it does not turn a similarity match into permission to know a fact. Lore does
not require a separate always-running wiki service or an extra mandatory model
roundtrip before each normal reply.

Campaign history is a layer on top of the source world. **141 authored GoA2 branch
accounts** remain available. Current state is read through CE during RP, with
**18 world-state predicates and nine character-owned trace bindings** in the
current adapter. Other supported explicit knowledge reports keep their own
provenance. This does not reconstruct every historical choice: transient or
missing game evidence remains unknown. A choice is distinct from an outcome;
the observation date is distinct from an event's occurrence date.

Public world state and private character knowledge remain separate. A changed
controller does not inherit the earlier mind's private experiences. The full
bank supports grounding; the text model can still misinterpret or invent details.

Implementation: `src/main/lorebook/`, `tools/lorebook_disclosure.py`,
`tools/lorebook_game_state.py` and `tools/lorebook_mutations.py`.

## Character portrayal

Titan combines current traits, relationships, body, race, cultural upbringing,
faith and admitted lore. It distinguishes the body from the acting mind and
handles supported forms, appetites and nonhuman physical constraints through
bounded context rather than forcing a single human template.

The roleplay writer chooses the prose. Acoustic casting chooses how literal
words sound. Source facts, authored portrayal direction and generated model
behavior are distinct; the companion does not claim that every generated ritual,
myth or flourish is established Warcraft canon.

Player suggestions and letter writers receive their applicable integrations.
Editable prompts and the inherited connection controls remain available.

## Culture, faith and language

Culture and faith libraries resolve current game identities and supply roleplay
background. Separate speech steering includes **166 cultural registers**,
**35 devotional registers covering 42 faith IDs**, and **12 bounded role/training
records**. A role record is used only when there is suitable evidence; race or
title alone does not confer a role or erase a person's traits.

The spoken-language engine projects the same utterance separately for each
listener. Known languages, related tongues, current cultural contact and Learning
can affect full, partial or unfamiliar comprehension. Canonical source words are
kept apart from recipient prompts and delivered history. Thoughts and unspoken
material retain owner-specific boundaries. Memory and summaries preserve the
listener's delivered perspective rather than quietly granting untranslated facts.

These systems enrich roleplay. They do not replace GoA2's underlying culture,
religion or language game mechanics with a new external ruleset.

Implementation: `src/main/culture/`, `src/main/faith/`, `src/main/dialogue/`,
`src/main/language/` and `public/dialogue-steering/registers.json`.

## Voices with continuity

The clone catalogue contains **419 prepared reference profiles covering 407 named
GoA2 identities**. Exact identity/source checks drive automatic matches;
unsupported histories retain manual assignment and ordinary casting. Some
identities have multiple performances. Supported form routes use observed traits,
including Illidan's supported metamorphosis and Arthas's living/undead/Lich King
states. Calendar dates do not select a form.

Unbound ordinary people receive saved individual casting, with approved shared
reference exceptions for difficult forms. Player-assigned and canonical voices
have priority. A stable seed and personal reference retain continuity; current
maturity and bounded delivery can change without casually replacing the person.
Historical replays retain their recorded identity and delivered words.

Speech, whispered thoughts and narrator delivery are separate. Literal words,
reference transcripts and performance instructions travel in distinct fields.
The producer prepares later passages while playback proceeds, preserves order,
and keeps a bounded future-audio buffer. Preview, pause, resume, stop, narrator
selection and voice management are part of the Audio interface.

Synthesis tests, word checks and player listening have informed refinements.
**419 banks is a coverage count, not 419 distinct performers, proof of universal
voice identity, or human approval of every possible output.** Private auditions,
rejected takes and unresolved later race experiments are not included as newly
approved production directions. Model weights and personal player libraries are
not bundled.

Implementation: `src/main/audio/`, `public/audio/clone-banks/catalog.json`,
`public/audio/race-selections/manifest.json` and `public/audio/goa-casting.json`.

## Illustrated encounters

The retained catalogue has **868 scenes**, including **855 custom scenes** and
**851 distinct bundled custom paintings**. Titan reads current encounter facts
and checks current participants before admitting a private venue. An existing CE
venue remains unless there is a clear custom equivalent; other Titan venues are
explicit choices. Changing scene refreshes current eligibility first.

Paintings appear in the Titan interface. The installer does not replace CE's
presentation files or install another game addon. Historical plot windows do not
become current scene facts merely because a date falls inside a range.

Implementation: `src/main/scenes/launcherScene*.ts`, authored scene JSON under
`game_mod/scenes/`, and the release's `public/scene-art/` asset set. The legacy
source directory name does not mean those JSON files are an installed game mod.

## A launcher you can share

The native companion carries these integrations. Users obtain CK3, GoA2 and VOTC
CE through their normal channels, install Titan and configure their model.
No Titan Workshop entry, required wrapper, edited base/Workshop file or external
lore event-listening hook is part of this release.

Conversation history, model connections, personal voices and player settings stay
in the private user-data directory. Upstream automatic application replacement is
disabled; Titan releases and maintenance are handled in MimirLab/VOTC-Titan.

See [getting started](getting-started.md) for platform and version limits, and
[release validation](release-validation.md) for what has actually been checked.
