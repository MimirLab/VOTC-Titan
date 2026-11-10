<p align="center">
  <img src="docs/media/titan-release-hero.png" alt="VOTC Titan: an emerald-crowned titan watches a living Azeroth unfold from an illuminated lorebook" width="100%">
</p>

<h1 align="center">Your campaign deserves a living world.</h1>

<p align="center">
  <strong>An embedded Warcraft lorebank. A changing history. Characters with convictions, memories and voices.</strong><br>
  A GoA2-dedicated evolution of Voices of the Court, maintained by MimirLab.
</p>

<p align="center">
  <a href="https://github.com/MimirLab/VOTC-Titan/releases/tag/titan-preview-2026.11.10"><img src="docs/media/download-titan.svg" alt="Download the first Titan preview" width="300"></a>
</p>

<p align="center">
  <a href="#a-world-that-can-change">Explore Titan</a> ·
  <a href="docs/getting-started.md">Installation & requirements</a> ·
  <a href="docs/features.md">The full feature tour</a> ·
  <a href="CREDITS.md">Credits & thanks</a> ·
  <a href="https://github.com/MimirLab/VOTC-Titan/issues">Report a problem</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/FIRST_PUBLIC_PREVIEW-Linux_x64_%C2%B7_X11-294c3b?style=for-the-badge&amp;labelColor=111a17&amp;color=806337" alt="First public preview: Linux x64, X11">
  <a href="https://github.com/MimirLab/VOTC-Titan/actions/workflows/source-checks.yml"><img src="https://github.com/MimirLab/VOTC-Titan/actions/workflows/source-checks.yml/badge.svg" alt="Source checks"></a>
</p>

| **37,026 lore passages** | **419 character voice banks** | **868 scenes** |
| :---: | :---: | :---: |
| A complete embedded release of the assembled lorebank, including expanded and GoA2 material | Prepared references covering **407 named identities**, alongside individual character casting | **855 custom scenes**, with **851 distinct paintings** bundled in Titan |

> **Before you download:** this first preview targets **Linux x64 with X11**. You need **Crusader Kings III**, the **GoA2** and **VOTC Community Edition** Steam addons, and a configured AI model or API. Optional spoken audio needs Breeze and suitable hardware or a remote Breeze endpoint. [Check the version notes and setup guide →](docs/getting-started.md)

## A world that can change

### The lore lives here. Your campaign gives it a present.

Titan carries the assembled **Warcraft lorebank inside the launcher**: people, peoples, places, beliefs, histories and their connections. It adds expanded material and **141 authored GoA2 branch accounts** so a campaign can be understood as its own evolving history.

The book is more than a flat timeline. Titan reads the current game state when roleplay needs it, selects the applicable account and reveals details in layers. Current transformations and supported world changes can affect the lore being delivered. Missing historical choices remain unknown, rather than being filled in from the calendar.

**The world knowing something does not mean your character knows it.** Character knowledge, private experience and public history have separate boundaries. A relevant slice reaches the normal character prompt; deeper lore is available when it is needed. The aim is a rich world that stays focused on the scene in front of you.

[Inside the evolving lorebook →](docs/features.md#the-embedded-evolving-lorebook)

<p align="center">
  <img src="docs/media/titan-council.png" alt="An orc envoy, dwarf scholar, elven priestess and human ruler bring distinct perspectives to a council beneath a branching illuminated chronicle" width="100%">
  <sub>Original Titan promotional artwork. An illustration of the experience, rather than a gameplay screenshot.</sub>
</p>

## Every voice has a history

### Familiar characters. Individual people.

The bundled clone bank contains **419 prepared reference banks for 407 authored GoA2 identities**. Supported characters can use their collected voice automatically, with verified current forms selecting supported alternatives. Arthas's living, death knight and Lich King portrayals, for example, are distinct routes driven by observed traits.

Other characters receive **saved individual casting**. Physical form, learned cultural pronunciation, maturity and personal texture work together, while the saved reference keeps a person recognizable across later lines. Named clones and player-assigned voices retain priority.

Speech, whispered thoughts and narration have their own delivery. Playback preserves literary order, supports pause and stop, and can prepare later passages while the current passage plays. The sound system has grown through synthesis trials, regression checks and player listening—not just a list of voice prompts.

**You can also choose, preview and manage voices yourself.** Voice-model downloads are explicit, and audio starts disabled.

[Meet the voice system →](docs/features.md#voices-with-continuity) · [Audio setup →](docs/getting-started.md#optional-character-audio)

## Culture is lived. Faith is felt.

Titan gives culture and religion a continuing place in character portrayal. Current cultural and faith identities guide the background libraries and the character's perspective. Speech steering supplies **166 cultural registers** and **35 devotional registers covering 42 faith IDs**, alongside bounded role guidance when the role is actually known.

Traits, upbringing, convictions and the current body still matter. A shared race does not make every person identical; membership in a faith does not erase personality. Cultural diction and devotional language enrich the character instead of turning every reply into an exposition of the setting.

Languages have consequences, too. Different listeners can hear the same utterance with full, partial or unfamiliar comprehension. Learning and actual language knowledge shape that understanding, and later memories retain what the listener received.

[Culture, faith and language →](docs/features.md#culture-faith-and-language)

## Make the court worth inhabiting

| In the moment | Across a life |
| --- | --- |
| Character-aware roleplay built around current traits, relationships, form and knowledge | Persistent conversations, summaries and memories, with recipient-specific perspective |
| Scene selection with current eligibility checks and a large illustrated venue catalogue | Stable saved voices, historical replay identities and supported changes of form |
| Spoken dialogue, thoughts, narration and optional player suggestions | Letters, diaries and the continuing VOTC conversation foundation |
| Independent lore, culture, faith, language and audio controls | Your chosen local model or configured provider, with editable prompts and connection settings |

Titan concentrates these additions in the **launcher**. Your installation uses the ordinary Steam subscriptions for GoA2 and VOTC CE. The Titan installer installs the companion application and shortcut; it does not require a Titan Workshop mod, rewritten game files or a Steam launch wrapper.

## Enter Azeroth

1. Install **CK3** and choose a compatible game/addon version combination.
2. Subscribe to **[Guardians of Azeroth 2](https://steamcommunity.com/sharedfiles/filedetails/?id=2949767945)** and **[VOTC Community Edition](https://steamcommunity.com/sharedfiles/filedetails/?id=3654567139)**, following their load-order and dependency instructions.
3. Download the **[Titan Linux preview](https://github.com/MimirLab/VOTC-Titan/releases/tag/titan-preview-2026.11.10)**, verify its checksum, extract it and run `./install.sh`.
4. Open Titan, select the CK3 installation and user folders, then configure your AI connection.
5. Start CK3 with the subscribed addons and begin a conversation. Enable optional audio after configuring Breeze.

**Version transparency:** the exercised development combination is CK3 **1.19.0.6**, GoA2 **0.6.5** and CE **2.5**. CE 2.5 declares CK3 **1.20**; the successful bridge tests do not establish complete gameplay compatibility across that mismatch. This is an early public preview for testing, with the [exact limits and troubleshooting](docs/getting-started.md#versions-and-preview-status) documented.

## Built on extraordinary work

Titan exists because **Paradox's Crusader Kings III**, **Blizzard's Warcraft universe**, **Guardians of Azeroth 2**, **Durond's Voices of the Court**, and the **VOTC 2.0 / Community Edition teams** gave this project a world, a game and a foundation.

Thank you to **Durond, MrAndroPC, Lisiyuan233, zhaowendao2005, the CE maintainers, the GoA2 team, Warcraft Wiki contributors**, and the many contributors behind the audio runtimes, libraries, tools and community sources. Their work is credited as upstream work; the Titan additions are described separately in the [feature tour](docs/features.md).

**[Full credits & project links](CREDITS.md)** · **[Software license](LICENSE)** · **[Third-party notices](THIRD_PARTY_NOTICES.md)**

Titan is an independent, noncommercial fan project. Third-party names, recordings, artwork and other assets retain their respective ownership and terms. No affiliation or endorsement is implied.

<details>
<summary><strong>For builders and contributors</strong></summary>

Source and downloadable runtime assets are separate. The source archive alone does not contain the voice WAVs, scene paintings, bundled lore databases or model weights.

```sh
python3 tools/import-release-assets.py /path/to/VOTC-Titan-Launcher-linux-x64.tar.gz
npm ci
npm run build
npm test -- --runInBand
npm run build:linux
```

See [contributing](CONTRIBUTING.md), [maintenance](docs/github-maintenance.md), [validation and provenance](docs/release-validation.md), and [the upstream README](README.upstream.md). The public source omits private listening archives and player data. Historical listening comparisons have explicit evidence-dependent skips; production assertions remain active.

</details>
