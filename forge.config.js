
const path = require('path');
const { execSync } = require('child_process');
const runtimeTools = new Set([
  'audit-goa-lore.cjs', 'lorebook-worker.py', 'lorebook_disclosure.py',
  'lorebook_campaign_clock.py', 'lorebook_observed.py',
  'lorebook-observed-bindings.json', 'lorebook_mutations.py',
  'lorebook_game_state.py', 'lorebook-game-state-catalogue.json', 'launcher-scene-policy.json'
]);
function excludeFromLauncher(filename) {
  const value = filename.replace(/\\/g, '/');
  if (/^\/(?:out|tests|logs|debug|game_mod|research)(?:\/|$)|^\/\./.test(value)) return true;
  if (/^\/default_userdata\/(?:conversation_history|conversation_summaries|logs|audio)(?:\/|$)/.test(value)) return true;
  if (value.startsWith('/tools/')) return !runtimeTools.has(value.slice('/tools/'.length));
  return false;
}

module.exports = {
  outDir: process.platform === 'win32' ? 'C:/tmp' : 'out',
  packagerConfig: {
    icon: './build/icons/icon', // Electron Forge will automatically use .ico for Windows and .icns for Mac
    //"asar":true
    ignore: excludeFromLauncher
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: { loadingGif: path.join(__dirname, 'build', 'icons', 'installerPic.png')}
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin']
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO',
        name: 'VOTC-2_0-CE_macOS',
        title: 'VOTC-2_0-CE_macOS'
      }
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  hooks: {
    postPackage: (forgeConfig, packageResult) => {
      // This hook is used to remove the quarantine attribute from the app bundle on macOS
      // which causes the "damaged file" error.
      if (packageResult.platform === 'darwin') {
        const appPath = packageResult.outputPaths[0];
        console.log(`Running xattr -cr on ${appPath} to prevent "damaged file" error.`);
        try {
          execSync(`xattr -cr "${appPath}"`);
          console.log('Successfully removed quarantine attribute.');
        } catch (error) {
          console.error('Failed to remove quarantine attribute:', error);
        }
      }
    }
  },
  // Public upload is a separate stage. No inherited upstream publishing target.
  publishers: []
};
