import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import { Config } from '../../src/shared/Config';
import { normalizeAudio } from '../../src/shared/audio';
import { checkUserData } from '../../src/main/userDataCheck';

jest.mock('original-fs', () => require('fs'), { virtual: true });
let root: string, configPath: string;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-audio-restart-'));
    (app.getPath as jest.Mock).mockImplementation((name: string) => name === 'userData' ? root : path.join(root, name));
    fs.cpSync(path.resolve('default_userdata'), path.join(root, 'votc_data'), { recursive: true });
    configPath = path.join(root, 'votc_data/configs/config.json');
    fs.copyFileSync(path.join(root, 'votc_data/configs/default_config.json'), configPath);
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

test('saved audio enable and engine preferences survive repeated real startup cleanup and config reloads', async () => {
    const config = new Config(configPath);
    config.audio = normalizeAudio({ enabled: true, narrator: true, thoughts: false, playerSpeech: true,
        hosting: 'external', endpoint: 'http://127.0.0.1:18892', apiKey: 'synthetic-local-key',
        managedModel: 'hoppou-f16', volume: 0.55, cfgScale: 3.5, idleMinutes: 7 });
    config.export();
    for (let restart = 0; restart < 3; restart++) {
        await checkUserData();
        const reloaded = new Config(configPath);
        expect(reloaded.audio).toEqual(config.audio);
        expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).audio).toEqual(config.audio);
        reloaded.export();
    }
});

test('startup keeps audio disabled for new users and preserves an explicit saved disable', async () => {
    await checkUserData();
    expect(new Config(configPath).audio.enabled).toBe(false);
    const config = new Config(configPath);
    config.audio = normalizeAudio({ enabled: false, narrator: true, volume: 0.3 }); config.export();
    await checkUserData();
    expect(new Config(configPath).audio).toEqual(config.audio);
});

test('a temporarily unavailable explicit CK3 folder survives startup even when Documents has another install',async()=>{
    const config=new Config(configPath);const selected=path.join(root,'disconnected-drive/CK3');config.userFolderPath=selected;config.export();
    fs.mkdirSync(path.join(root,'documents/Paradox Interactive/Crusader Kings III'),{recursive:true});
    await checkUserData();expect(new Config(configPath).userFolderPath).toBe(selected);
});
