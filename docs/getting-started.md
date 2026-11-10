# Start your Titan campaign

Titan is the GoA2-focused Voices of the Court companion. Install the normal game
and Steam addons, then use Titan as your launcher companion.

## What you need

| Component | Requirement |
| --- | --- |
| Game | A legitimate installation of [Crusader Kings III](https://store.steampowered.com/app/1158310/Crusader_Kings_III/) with versions compatible with the subscribed addons |
| World | [Guardians of Azeroth 2](https://steamcommunity.com/sharedfiles/filedetails/?id=2949767945), with its own required dependencies and load order |
| Game bridge | [Voices of the Court 2.0 — Community Edition](https://steamcommunity.com/sharedfiles/filedetails/?id=3654567139) Steam addon |
| Titan | The Linux x64 public-preview download from this repository's Releases |
| Desktop | Linux x64, an X11 desktop session and `wmctrl`; the installer also uses Python 3 |
| Native libraries | A recent glibc-based Linux system; the bundled Python needs at least **glibc 2.38**. The SQLite module retains the qualified upstream Electron prebuilt. Other libraries and distributions need their own compatibility check |
| Text AI | A configured supported provider/API or a running local model endpoint; model weights and API credit are not included |
| Optional speech | A configured Breeze endpoint, or an explicitly downloaded local Breeze runtime/model with suitable GPU support |

This preview was built and checked on EndeavourOS/Arch Linux. Other Linux
distributions need their own compatibility check; Windows, macOS and native
Wayland binaries are not included in this release.

## Versions and preview status

The development bridge was exercised with **CK3 1.19.0.6, GoA2 0.6.5 and CE 2.5**.
CE 2.5's descriptor declares **CK3 1.20**. Successful paused-campaign state and
scene probes do not prove that every gameplay system works across this mismatch.
Check the current upstream dependency instructions and choose a matching set;
this release does not claim qualification for a different patch combination.

This is the first public preview. The roleplay model can still make mistakes;
the lore and knowledge pipeline improves its grounding without guaranteeing
perfect canon or performance. Full response time depends on your text model,
model loading, context length, optional voice synthesis and shared hardware.

## Install

1. Install CK3. Subscribe to GoA2 and VOTC CE, including any dependencies they
   require. Enable the addons in a compatible playset and follow their order.
2. Open [Titan Releases](https://github.com/MimirLab/VOTC-Titan/releases).
   Download `VOTC-Titan-Launcher-linux-x64.tar.gz` and its `.sha256` file into the
   same directory. GitHub's automatic Source code downloads are for developers.
3. Check the download, then extract it:

   ```sh
   sha256sum -c VOTC-Titan-Launcher-linux-x64.tar.gz.sha256
   tar -xzf VOTC-Titan-Launcher-linux-x64.tar.gz
   cd VOTC-Titan-Launcher
   ./install.sh
   ```

4. Launch **VOTC Titan Edition** from the installed shortcut.
5. Configure the CK3 **installation folder** and CK3 **user folder** in Titan.
   The user folder contains CK3's logs and saves; it is a different folder from
   the game executable installation. Use the folders belonging to this campaign.
6. Configure and test the text-generation connection. Select your provider,
   endpoint and model; enter any required API key locally in Titan.
7. Start CK3 with the normal subscribed addons. Open an RP encounter through
   VOTC CE and use Titan's conversation interface.

The installer places the native companion and its shortcut. It does not edit
Workshop files, replace CK3 scripts, enable another mod, rewrite your playset or
change Steam launch options. No separate Titan Workshop subscription is needed.

## Optional character audio

Audio begins disabled. In **Audio**, select **Breeze** and choose either local
hosting or an existing remote Breeze endpoint. Downloading/loading a local model
is an explicit action; weights are not included in the application archive.

For the inspected Vulkan packages, local hosting checks for at least **6 GiB
available VRAM for Q8** or **9 GiB for F16**, plus system-memory headroom and a
working compute backend. Those are startup checks, not total-machine requirements
or guaranteed budgets while CK3 and a text model share the GPU. Leave additional
room for the game. A remote endpoint has its own hardware requirements.

Use **Start / test Breeze** and **Preview narrator**, then enable character audio.
The clone-bank selector defaults to **Automatic — GoA2 character voices**.
Covered named characters use their recorded route when identity checks match;
others retain normal individual casting. Player assignments and opt-outs remain
available. See [audio integration](audio-integration.md) for backend details.

## First conversation

Keep Warcraft lore, culture, faith and roleplay-language options enabled to
experience the combined systems. Their controls are independent. Start with a
small encounter and check that the game folders and AI connection work before
adding optional speech.

Titan reads current encounter state through CE when roleplay needs it. A lore
passage describes the world; a character's access to it still depends on that
character's knowledge. Scene paintings are displayed in Titan's interface.

## If something goes wrong

| Symptom | First check |
| --- | --- |
| No current encounter or stale game state | Correct CK3 user folder, active CE addon, compatible versions and a current RP encounter |
| Provider error or an empty reply | Test the selected endpoint/model; check its availability, context and output allowances |
| Voice model cannot start | Available VRAM, supported runtime/backend and interference from other GPU workloads |
| A named character uses generated casting | Automatic bank selection, current identity/source compatibility, supported form and explicit per-character opt-outs |
| Linux app fails to open | X11 session, `wmctrl`, executable permissions and distribution/runtime compatibility |

Report Titan problems in [this repository's issues](https://github.com/MimirLab/VOTC-Titan/issues).
Include your Titan build, OS, CK3/GoA2/CE versions, selected backend and a small
redacted error excerpt. Keep keys, credentials, saves and private RP transcripts
out of public reports.

## Updates and existing players

Keep a backup of your private player data and use the documented installer for
updates. The archive does not contain the developer's settings, models, campaign
history or personal voice library. Older automatic upstream app replacement is
disabled in Titan; follow releases in **MimirLab/VOTC-Titan** for Titan updates.
