# The worlds and people behind Titan

VOTC Titan Edition is MimirLab's GoA2-dedicated fork of Voices of the Court
Community Edition. Thank you to the developers, writers, performers and contributors whose work
made Titan possible.

## The foundations

| Project / people | Their contribution |
| --- | --- |
| [Crusader Kings III — Paradox Development Studio / Paradox Interactive](https://www.paradoxinteractive.com/games/crusader-kings-iii/about) | The game, its character simulation and the modding foundation |
| [Warcraft — Blizzard Entertainment](https://warcraft.blizzard.com/) | Azeroth, its characters, stories and the original game performances used by the reference collection |
| [Guardians of Azeroth 2 development team](https://github.com/Warcraft-GoA-Development-Team/Warcraft-Guardians-of-Azeroth-2) | Warcraft's world, cultures, faiths, histories and campaign systems in CK3; [Steam addon](https://steamcommunity.com/sharedfiles/filedetails/?id=2949767945) |
| **Durond and the original VOTC team** | The original Voices of the Court concept and implementation |
| [Voices of the Court / VOTC 2.0](https://github.com/Voices-of-the-Court) | Continued development of AI conversations with CK3 characters |
| [Voices of the Court Community Edition](https://github.com/szmania/Voices_of_the_Court) | The direct application foundation for this fork; [CE game addon](https://github.com/szmania/voices_of_the_court_mod) and [Steam subscription](https://steamcommunity.com/sharedfiles/filedetails/?id=3654567139) |
| **MrAndroPC, Lisiyuan233, zhaowendao2005, the CE maintainers and community contributors** | Updates, support and the community work explicitly credited by the inherited project |

The original [Community Edition README](README.upstream.md) is retained with its
credits and licensing history. Its older installation and updater directions
describe upstream; [Titan's setup guide](docs/getting-started.md) describes this release.

## Lore and source preservation

**[Warcraft Wiki contributors](https://warcraft.wiki.gg/)** supplied a major source
foundation for the assembled lorebank. The bundled attribution records retain
source URLs, snapshot and revision metadata, and CC BY-SA 4.0 attribution.
Titan's passages were extracted, condensed, reorganized and expanded from that
material.

Thanks also to **[WikiTeam / wikiteam3](https://github.com/saveweb/wikiteam3)** and
**[Internet Archive](https://archive.org/details/wiki-warcraft.wiki.gg-20231113)**
for source-preservation tooling and the archived source edition. GoA2 definitions
supply the campaign-specific material and interpretation boundaries.

## Voices and audio tools

Original reference performances remain credited to **Blizzard Entertainment and
their performers**. Individual performers are credited where their identity is known. The bank
records keep the original recordings and source information separate from newly
synthesized dialogue.

- **[BreezeBlue / Breeze TTS](https://github.com/breezeblue-ai/breeze-tts)** and
  **[Breeze-TTS-2](https://huggingface.co/BreezeBlue/Breeze-TTS-2)** — voice synthesis.
- **[HoppouAI Breeze-TTS-2.cpp](https://github.com/HoppouAI/Breeze-TTS-2.cpp)** — native runtime and Vulkan integration.
- **[remominor/breeze-tts-api](https://github.com/remominor/breeze-tts-api)** — an additional supported runtime route.
- **[whisper.cpp / GGML contributors](https://github.com/ggml-org/whisper.cpp)** — transcription checks used in research.
- **[TheWoWDB](https://thewowdb.com/sounds/)**, **[Tongues of Azeroth](https://github.com/JessePretendstoCode/TonguesOfAzeroth)**,
  **[HeroesToolChest](https://github.com/HeroesToolChest/HeroesDataParser)**,
  **[Hive Workshop's campaign sound compiler](https://www.hiveworkshop.com/threads/sound-sets-from-campaign-dialog.328584/)**
  and **[HearthSFX](https://hearthsfx.github.io/)** — credited source-discovery,
  extraction and indexing routes. Their source information is retained in
  the collection records.

See [the bank's source attribution](public/audio/clone-banks/ATTRIBUTION.md).
Runtime code, model weights and original recordings have separate terms.

## The software beneath the companion

Thank you to the maintainers of **[Electron](https://www.electronjs.org/)**,
**[Node.js](https://nodejs.org/)**, **[TypeScript](https://www.typescriptlang.org/)**,
**[Python](https://www.python.org/)**, **[SQLite](https://sqlite.org/)**,
**[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)**,
**[sqlite-vec](https://github.com/asg017/sqlite-vec)** and the many dependencies
recorded in `package-lock.json`. Their bundled notices and package licenses remain
part of the distribution.

The public interface pairs **[Alegreya Sans](https://github.com/google/fonts/tree/main/ofl/alegreyasans)**
by Juan Pablo del Peral / Huerta Tipográfica with
**[Cinzel Decorative](https://github.com/google/fonts/tree/main/ofl/cinzeldecorative)**
by Natanael Gama. **[Adobe's Source Han Serif contributors](https://github.com/adobe-fonts/source-han-serif)**
created the inherited Source Han Serif family. Their OFL notices accompany the
release. Other inherited UI art keeps its own provenance and terms.

## The Titan contribution

MimirLab maintains Titan's embedded lore delivery and campaign-state adaptation,
GoA2 character/body/knowledge integration, cultural and devotional steering,
language perspective and memory work, saved casting and clone routing,
illustrated launcher scenes, native packaging and regression infrastructure.

Player listening, actual roleplay feedback and the upstream communities have
shaped these systems. Production choices reflect those listening and playtest decisions.

The new repository cover and council illustration were generated specifically
for this presentation using the built-in image generation tool. Their prompts
and provenance are recorded in [artwork notes](docs/media/ARTWORK.md). The illustrations are promotional artwork.

Titan is independent and noncommercial. These acknowledgments do not imply
endorsement by Paradox, Blizzard, the GoA2 team or the VOTC/CE maintainers.
