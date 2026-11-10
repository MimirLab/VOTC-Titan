import fs from 'fs';
test('Titan exposes no Community Edition updater entry point, listener or replacement client', () => {
    const main = fs.readFileSync('src/main/main.ts', 'utf8'), renderer = fs.readFileSync('src/configWindow/systemRenderer.ts', 'utf8');
    const page = fs.readFileSync('public/configWindow/system.html', 'utf8');
    expect(main).not.toMatch(/autoUpdater|updateElectronApp|update-electron-app|update-app|checkGitHubForUpdates|tray\.check_updates|api\.github\.com\/repos\/szmania/);
    expect(renderer).not.toMatch(/update-app|update-button/);
    expect(page).not.toMatch(/update-button|checkForUpdatesOnStartup|earlyAccessUpdates/);
    expect(page).toContain('independent fork');
});
