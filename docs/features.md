# Titan features

Titan is a GoA2-focused fork of VOTC Community Edition. It extends the original
conversation, action, letter and memory systems with Warcraft lore, character
casting, cultural and religious backgrounds, language comprehension and
illustrated scenes.

## The embedded evolving lorebook

The lorebook and its reader are built into Titan. The release contains:

| Material | Passages |
| --- | ---: |
| Warcraft lorebank | 33,366 |
| Expanded setting | 3,364 |
| GoA2 material | 296 |
| **Total** | **37,026** |

The book has **78,269 aliases** and **114,119 connections** between its entries.
Search finds the relevant material, and nested disclosure opens deeper details
as a conversation needs them. The character keeps their full roleplay prompt.
Lore retrieval runs locally; optional semantic search adds another way to find
topics.

**141 GoA2 branch accounts** extend the source history for the campaign. During
roleplay, Titan reads current game state through CE and selects the applicable
history. Public world events and personal knowledge have separate access rules.
A change of controlling mind also changes whose private experiences apply.

The current adapter reads **18 world-state predicates and nine character-owned
traces**. It cannot recover choices the game has stopped recording. Those choices
stay unknown. An attempted action and its outcome are separate records, as are
the date of an event and the date Titan observes it.

## Character portrayal

Current traits, relationships, body, race, upbringing, faith and knowledge feed
into the character's roleplay context. Titan distinguishes the acting mind from
the body it occupies and supplies the relevant physical constraints, forms and
appetites for nonhuman characters.

Your text model writes the roleplay. The voice system handles its spoken words.
Player suggestions and letter writers also receive their character context, and
you retain control of prompts and model connections.

## Culture, faith and language

Culture and faith libraries build backgrounds from the character's current game
identity. Speech profiles add **166 cultural registers**, **35 devotional
registers covering 42 faiths**, and **12 role or training profiles**. Role guidance
requires evidence of that role. Personality and conviction remain part of the
character's portrayal.

The language engine works out what each listener understands. Known languages,
related tongues, cultural contact and Learning affect comprehension. Each
recipient receives their own version of an utterance, and that version carries
into their memories and summaries. Private thoughts stay with their owner.

These are roleplay systems built around GoA2's culture, faith and language data.
GoA2 continues to run the underlying game mechanics.

## Voices with continuity

**419 voice banks cover 407 named GoA2 characters.** Titan matches historical
identities to their reference recordings and checks current traits for alternate
forms. Arthas has living, death knight and Lich King routes; Illidan has a
metamorphosis route. You can also assign a bank manually.

Ordinary characters receive saved individual casting, with shared references for
selected creature families. Physical form, cultural pronunciation, maturity and
personal design guide new casts. Your own assignments and named-character voices
have priority. Saved references keep a person's voice consistent, while historical
replays retain the voice used when they were recorded.

Dialogue, whispered thoughts and narration have separate delivery. Spoken text,
reference transcripts and performance instructions travel separately to Breeze.
Later passages can be prepared during playback. Preview, pause, resume, stop,
narrator selection and voice management are available in Audio.

Synthesis trials, word checks and player listening guide the casting refinements.
The bank count measures recordings and character coverage; several recordings
can feature the same performer. Model weights are downloaded separately, and
personal voice libraries stay in your private data.

## Illustrated encounters

Titan has **868 scenes**, including **855 custom scenes and 851 paintings**.
Venue selection uses current encounter facts and participant checks. Existing CE
venues carry through to Titan; custom venues are available through the scene
selector. Changing scene refreshes eligibility first.

Paintings appear in Titan's conversation interface. The scene system reads game
state through CE and runs inside the launcher.

## Installation and your data

Install CK3, subscribe to GoA2 and VOTC CE, then install Titan and configure your
model. The installer adds the companion and shortcut. It leaves game files,
Workshop addons, playsets and Steam launch options alone.

Your histories, connections, settings and personal voices stay in the private
user-data directory. Titan releases are maintained in **MimirLab/VOTC-Titan**.

[Installation and version notes](getting-started.md) · [Test results and known limits](release-validation.md)

<details>
<summary><strong>Implementation reference</strong></summary>

| System | Source |
| --- | --- |
| Lore | `src/main/lorebook/`, `tools/lorebook_disclosure.py`, `tools/lorebook_game_state.py`, `tools/lorebook_mutations.py` |
| Culture and faith | `src/main/culture/`, `src/main/faith/` |
| Speech profiles | `src/main/dialogue/`, `public/dialogue-steering/registers.json` |
| Language and perspective | `src/main/language/` |
| Casting and playback | `src/main/audio/`, `public/audio/clone-banks/catalog.json`, `public/audio/race-selections/manifest.json`, `public/audio/goa-casting.json` |
| Scenes | `src/main/scenes/launcherScene*.ts`, authored JSON in `game_mod/scenes/`, runtime paintings in `public/scene-art/` |

`game_mod/scenes` is a source-data directory. It is not an installed game addon.

</details>
