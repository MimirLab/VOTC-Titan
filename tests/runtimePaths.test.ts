import { ck3RuntimePath, resolveUserDataRoot } from '../src/shared/runtimePaths';
import { Config } from '../src/shared/Config';
import { app } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

test('Wine and Linux use the same physical CK3 directories without changing arbitrary paths', () => {
    const linux = '/home/titan/.local/share/Paradox Interactive/Crusader Kings III';
    const wine = 'Z:\\home\\titan\\.local\\share\\Paradox Interactive\\Crusader Kings III';
    expect(ck3RuntimePath(wine, 'linux')).toBe(linux);
    expect(ck3RuntimePath(linux, 'win32')).toBe(wine);
    expect(ck3RuntimePath('C:\\Games\\CK3', 'linux')).toBe('C:\\Games\\CK3');
    expect(ck3RuntimePath('https://models.example/v1', 'linux')).toBe('https://models.example/v1');
    expect(ck3RuntimePath(wine, 'win32')).toBe(wine);
});

test('userdata identity is stable and overrides must be explicit absolute roots', () => {
    expect(resolveUserDataRoot('/tmp/appData', 'Community Edition')).toBe('/tmp/appData/Community Edition');
    expect(resolveUserDataRoot('/tmp/appData', 'Community Edition', '/tmp/test-root')).toBe('/tmp/test-root');
    expect(() => resolveUserDataRoot('/tmp/appData', 'Community Edition', 'relative')).toThrow('must be absolute');
});

test('saving cross-runtime CK3 paths preserves provider and embedding settings', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-config-paths-'));
    const getPath = app.getPath as jest.Mock;
    getPath.mockReturnValue(root);
    try {
        const file = path.join(root, 'votc_data/configs/config.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const embedding = { connection: { type: 'custom', baseUrl: 'https://embedding.example/v1', key: 'synthetic',
            model: 'test-retrieval', embeddingDimension: 1024, customContext: 32768 }, parameters: {} };
        fs.writeFileSync(file, JSON.stringify({ userFolderPath: 'Z:\\tmp\\game', cultureGameInstallPath: 'Z:\\tmp\\install',
            embeddingApiConnectionConfig: embedding, textGenerationApiConnectionConfig: { connection: { model: 'test-chat' } } }));
        const config = new Config(file);
        expect(config.userFolderPath).toBe('/tmp/game');
        config.cultureGameInstallPath = 'Z:\\tmp\\other-install';
        config.export();
        const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
        expect(stored.cultureGameInstallPath).toBe('/tmp/other-install');
        expect(stored.embeddingApiConnectionConfig).toEqual(embedding);
        expect(stored.textGenerationApiConnectionConfig.connection.model).toBe('test-chat');
    } finally {
        getPath.mockReturnValue('/tmp');
        fs.rmSync(root, { recursive: true, force: true });
    }
});
