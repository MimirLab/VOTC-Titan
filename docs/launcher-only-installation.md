# Titan launcher distribution contract

The supported user setup is CK3 at the compatible patch, the normal GoA2 and
VOTC Community Edition Steam subscriptions, and the downloaded Titan launcher.
Titan must not require a separate Workshop publication, a Titan game-component
entry, edited Workshop/base-game scripts, or a custom Steam launch option.
CE's ordinary command files in the CK3 user folder remain its existing bridge;
writing those command inputs does not install or modify a game addon.

## Current correction, 2026-11-10

The earlier release violated this boundary. Its 29 new timeline story overrides
have been withdrawn with exact recovery copies. CK3's original empty Steam
launch option has been restored, preserving every other configuration byte.
The old component and its three historical memory-support files remain inactive
for recovery. The active playset now uses the unchanged subscribed CE entry.
The installed launcher is `f707e8b727703f18bb212fc1a5ca4b5da989d9a67a3a53c8014516b0bdd10480`.
All 1,030 protected player files retain their exact bytes.

The old portable package stays withdrawn. The replacement native Linux package
is `VOTC-Titan-Launcher`; run `./install.sh` from its extracted folder. Linux X11
requires the ordinary `wmctrl` utility. Select the CK3 installation/user folders
and configure the AI connection in Titan. Keep GoA2 and CE enabled in their normal
load order, using a compatible game/mod patch combination. No Titan mod entry,
Steam wrapper, additional subscription or helper installation is required.

The revised installer installs only the native application and launcher shortcut.
It does not deploy game files, register mods, rewrite playsets or alter Steam.
It rejects `--replace-ce`. Normal source building now includes the selected lore
runtime tools. Fresh-user data paths no longer assume the developer's username
or require a Wine installation.

## Lore delivery

The replacement reads current status when an RP encounter or reply needs it,
through CE's existing command channel. It does not subscribe to story events,
install on_actions, create lore memories or run a separate listening service.
The numeric clock is read through the same probe, without patching CE's exporter.
Current CE uses `votc_ce.txt`; Titan discovers that and the letter channels from
CE's own GUI declarations and creates only missing ordinary command inputs.

The staged adapter reads 27 state fields: 18 world statuses and nine specific
traces retained on the acting character. World status grants no personal
knowledge. A replaced controlling mind does not inherit the original actor's
private traces. A choice does not prove its later success. The observation date
is not presented as its occurrence date. Missing or unrecorded facts stay unknown.

All 141 accepted branch accounts remain intact. Nine automatic trace bindings
are an initial adapter, not a claim that all 141 choices can be reconstructed.
Some choices leave only temporary scopes that the game later discards. Applicable
explicit knowledge reports remain supported. The calendar and absent flags do
not manufacture those reports. Eligible accounts retain bounded nested disclosure
and optional deeper lookup, with no additional model call.

An isolated, paused CK3 test with unchanged CE/GoA and no Titan addon returned a
complete state snapshot and numeric clock, exercised language study observation,
and executed a positive fixture trace through CE's command channel. This is
primitive/transport evidence, not full player RP or every original story event.
The final source passes 3,507 tests across 150 suites, plus four native desktop
reports and actual Electron painting/IPC checks at 900- and 500-pixel viewports.

The scene migration retains all 868 scenes and bundles the existing
855 custom scenes as 851 distinct DDS files for Titan’s interface. Native facts
come from one 93 KB read-only query, with a complete current participant census
for private venue admission. Historical plot windows remain unknown without
current evidence. An actual combined lore/scene probe through CE’s conversation
channel completed in 0.51 seconds, including CE polling, with zero script errors.
This is one paused fixture campaign, not a general end-to-end latency guarantee.

A CE venue is preserved unless a clear custom equivalent exists. Other Titan
venues remain explicit launcher choices. Scene changes refresh current eligibility
before committing; custom paintings appear in Titan while CE retains its own
game presentation. All approved Audio code/assets, the source book bundle and
player voices remain unchanged.

The held research and prior source/test bytes are preserved under the development
correction workspace's `source-before-alignment/`. They are outside the normal
release build, so downloading/building Titan does not silently promote them.

Development evidence: `out/launcher-only-correction-20261110/WORKING.json`.
