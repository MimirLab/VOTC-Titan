import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import { Config } from '../../src/shared/Config';
import { checkUserData } from '../../src/main/userDataCheck';
jest.mock('original-fs', () => require('fs'), { virtual: true });

test('a saved Chronicle opt-out survives real startup synchronization', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-chronicle-restart-'));
    const getter = jest.spyOn(app, 'getPath').mockImplementation(name => name === 'userData' ? root : path.join(root, name));
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
        fs.cpSync(path.resolve('default_userdata'), path.join(root, 'votc_data'), { recursive: true, dereference: true });
        const file = path.join(root, 'votc_data/configs/config.json');
        fs.copyFileSync(path.join(root, 'votc_data/configs/default_config.json'), file);
        const config = new Config(file); expect(config.lorebookEnabled).toBe(true);
        config.lorebookEnabled = false; config.export();
        for (let i = 0; i < 2; i++) {
            await checkUserData();
            expect(new Config(file).lorebookEnabled).toBe(false);
        }
    } finally { getter.mockRestore(); log.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); }
});
