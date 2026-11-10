import fs from 'fs';
import { APP_DISPLAY_NAME, LEGACY_USER_DATA_NAME } from '../src/shared/appIdentity';
import { maintenanceLinks, titanProviderHeaders, localTitanGuide } from '../src/shared/projectMaintenance';
test('Titan maintenance defaults to MimirLab without inventing a repository or issue target', () => {
    expect(maintenanceLinks({})).toEqual({ organization:'https://github.com/MimirLab',repository:undefined,issues:undefined });
    expect(titanProviderHeaders({})).toEqual({ 'HTTP-Referer':'https://github.com/MimirLab','X-Title':APP_DISPLAY_NAME });
});
test('an explicitly configured Titan repository supplies maintenance URLs', () => {
    expect(maintenanceLinks({repositoryUrl:'https://github.com/MimirLab/Titan.git'}).issues).toBe('https://github.com/MimirLab/Titan/issues');
});
test.each(['https://github.com/szmania/Voices_of_the_Court','file:///private','javascript:alert(1)','https://github.com/MimirLab/Titan?token=private'])('unrelated or malformed maintenance destination is rejected: %s', repositoryUrl => {
    expect(maintenanceLinks({repositoryUrl}).repository).toBeUndefined();
});
test('local documentation, upstream credits and saved-data compatibility remain available', () => {
    expect(fs.existsSync(localTitanGuide())).toBe(true);
    expect(LEGACY_USER_DATA_NAME).toBe('Voices of the Court - Community Edition');
    const about=fs.readFileSync('public/readmeWindow/readme.html','utf8');
    expect(about).toContain('Original VOTC by Durond');
    expect(about).toContain('data-titan-maintenance="docs"');
    expect(about).not.toContain('Local Titan build: 2026-10-07');
});
test('publishing, request attribution and maintenance dialogs never target the upstream maintainer', () => {
    const forge=require('../forge.config.js');
    expect(forge.publishers).toEqual([]);
    const main=fs.readFileSync('src/main/main.ts','utf8');
    expect(main).not.toMatch(/discord\.gg\/UQpE4mJSqZ|votc-ce\.vercel\.app/);
    expect(fs.readFileSync('src/shared/apiConnection.ts','utf8')).not.toContain('github.com/szmania');
});
