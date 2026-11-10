# Start your Titan campaign

Titan is the GoA2-focused Voices of the Court companion. Install the normal game
and Steam addons, then use Titan as your launcher companion.

## What you need

| Component | Requirement |
| --- | --- |
| Game | [Crusader Kings III](https://store.steampowered.com/app/1158310/Crusader_Kings_III/) with versions compatible with the subscribed addons |
| World | [Guardians of Azeroth 2](https://steamcommunity.com/sharedfiles/filedetails/?id=2949767945), with its own required dependencies and load order |
| Game bridge | [Voices of the Court 2.0 — Community Edition](https://steamcommunity.com/sharedfiles/filedetails/?id=3654567139) Steam addon |
| Titan | The Linux x64 public-preview download from this repository's Releases |
| Desktop | Linux x64, an X11 desktop session and `wmctrl`; the installer also uses Python 3 |
| Native libraries | A glibc-based Linux system with **glibc 2.38 or newer**; tested on EndeavourOS/Arch |
| Text AI | A configured supported provider/API or a running local model endpoint; model weights and API credit are not included |
| Optional speech | A configured Breeze endpoint, or an explicitly downloaded local Breeze runtime/model with suitable GPU support |

The download is built and tested on EndeavourOS/Arch Linux. Other Linux
distributions are untested. Windows, macOS and native Wayland builds are not
available in this release.

## Versions and preview status

The game bridge was tested with **CK3 1.19.0.6, GoA2 0.6.5 and CE 2.5**.
CE 2.5 targets **CK3 1.20**. This mismatch remains a known issue, and the
combination has not completed full gameplay testing. Match your game and addon
versions using the upstream instructions before starting a campaign.

Response speed depends on your text model, context length and optional voice
synthesis. Model loading and first-time voice creation add startup time.

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

Local Vulkan hosting requires **6 GiB available VRAM for Q8** or **9 GiB for
F16**, system-memory headroom and a working compute backend. Allow additional
VRAM for CK3 and your text model. A remote Breeze endpoint runs on its own host.

Use **Start / test Breeze** and **Preview narrator**, then enable character audio.
The clone-bank selector defaults to **Automatic — GoA2 character voices**.
Automatic matching selects the character’s recorded voice. You can also assign a
voice manually or choose normal casting. See [audio integration](audio-integration.md) for backend details.

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

Keep a backup of your private player data and use the installer for updates from
**MimirLab/VOTC-Titan**. The download carries the
launcher and its runtime assets; your settings, models, histories and personal
voices remain in your private data.
