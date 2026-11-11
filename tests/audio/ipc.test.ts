import { app, ipcMain } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import { registerAudioIpc } from '../../src/main/audio/audioIpc';
import { normalizeAudio } from '../../src/shared/audio';
test('both owned Audio settings windows can manage audio; foreign and navigated renderers cannot read credentials', () => {
    (app as any).getAppPath = () => path.resolve('.');
    const senderA = { getURL: () => pathToFileURL(path.resolve('public/configWindow/audio.html')).href };
    const senderB = { ...senderA }; const foreign = { ...senderA };
    const runtime = { cloneBanks: () => [], cloneBinding: () => undefined, cloneInfo: () => ({ mode: 'auto' }), list: jest.fn(() => []), status: {}, managed: { installed: () => false } } as any;
    const windows = [senderA, senderB].map(webContents => ({ webContents, isDestroyed: () => false })) as any;
    const config = { audio: normalizeAudio({ apiKey: 'synthetic-private-key' }) } as any;
    registerAudioIpc(runtime, config, () => undefined, () => windows, () => undefined);
    const handler = (ipcMain.handle as jest.Mock).mock.calls.find(([name]) => name === 'audio-settings')![1];
    expect(handler({ sender: senderA }).settings.apiKey).toBe('synthetic-private-key');
    expect(handler({ sender: senderB }).settings.apiKey).toBe('synthetic-private-key');
    expect(() => handler({ sender: foreign })).toThrow('Open Audio');
    senderA.getURL = () => 'https://example.test/audio.html';
    expect(() => handler({ sender: senderA })).toThrow('Open Audio');
});

test('voice management and exact preview words are restricted to the owned Audio page', async () => {
    (app as any).getAppPath = () => path.resolve('.'); (ipcMain.handle as jest.Mock).mockClear();
    const sender = { getURL: () => pathToFileURL(path.resolve('public/configWindow/audio.html')).href };
    const runtime = { previewVoice: jest.fn(), previewCharacter: jest.fn(), saveNarrator: jest.fn(), useDefaultNarrator: jest.fn(), renameVoice: jest.fn(), deleteVoice: jest.fn() } as any;
    const conv = { gameData: { characters: new Map([[2, {}]]) } } as any;
    registerAudioIpc(runtime, { audio: normalizeAudio() } as any, () => conv,
        () => [{ webContents: sender, isDestroyed: () => false }] as any, () => undefined);
    const handler = (channel: string) => (ipcMain.handle as jest.Mock).mock.calls.find(([name]) => name === channel)![1];
    for (const channel of ['audio-save-narrator', 'audio-use-default-narrator', 'audio-rename-voice', 'audio-delete-voice']) {
        expect(() => handler(channel)({ sender: {} }, 'id', 'value')).toThrow('Open Audio');
        handler(channel)({ sender }, 'id', 'value');
    }
    expect(runtime.renameVoice).toHaveBeenCalledWith('id', 'value'); expect(runtime.deleteVoice).toHaveBeenCalledWith('id');
    expect(runtime.useDefaultNarrator).toHaveBeenCalledTimes(1);
    await handler('audio-preview')({ sender }, 'chosen-narrator', undefined, 'My exact preview words.');
    expect(runtime.previewVoice).toHaveBeenCalledWith('chosen-narrator', undefined, 'My exact preview words.');
    await handler('audio-preview-character')({ sender }, 2, 'Different character words.');
    expect(runtime.previewCharacter).toHaveBeenCalledWith(conv, 2, 'Different character words.', undefined);
    await expect(handler('audio-preview-character')({ sender }, 999)).rejects.toThrow('current encounter');
    await expect(handler('audio-preview')({ sender: {} })).rejects.toThrow('Open Audio');
});
test('Audio settings identify the current speaker and retain each participant’s saved casting choices', () => {
    (app as any).getAppPath = () => path.resolve('.'); (ipcMain.handle as jest.Mock).mockClear();
    const sender = { getURL: () => pathToFileURL(path.resolve('public/configWindow/audio.html')).href };
    const conv = { gameData: { aiID: 2, characters: new Map([[1, { id: 1, fullName: 'Synthetic Player' }], [2, { id: 2, fullName: 'Synthetic Speaker' }]]) } } as any;
    const choices = { anatomyId: '012', presentation: 'female', cultureId: 'shadowmoon' };
    const runtime = { cloneBanks: () => [], cloneBinding: () => undefined, cloneInfo: () => ({ mode: 'auto' }), list: () => [], status: {}, managed: { installed: () => false }, castingChoices: (_conv: unknown, id: number) => id === 2 ? choices : {} } as any;
    registerAudioIpc(runtime, { audio: normalizeAudio() } as any, () => conv,
        () => [{ webContents: sender, isDestroyed: () => false }] as any, () => undefined);
    const handler = (ipcMain.handle as jest.Mock).mock.calls.find(([name]) => name === 'audio-settings')![1];
    const info = handler({ sender }); expect(info.defaultCharacterId).toBe(2);
    expect(info.characters.find((actor: any) => actor.id === 2).casting).toEqual(choices);
});
test('draft preview, commit and discard require an owned Audio page and pass only explicit audition inputs', async () => {
    (app as any).getAppPath = () => path.resolve('.'); (ipcMain.handle as jest.Mock).mockClear();
    const sender = { getURL: () => pathToFileURL(path.resolve('public/configWindow/audio.html')).href };
    const runtime = { previewNarratorDraft: jest.fn(), saveNarratorDraft: jest.fn(), discardNarratorDraft: jest.fn() } as any;
    registerAudioIpc(runtime, { audio: normalizeAudio() } as any, () => undefined,
        () => [{ webContents: sender, isDestroyed: () => false }] as any, () => undefined);
    const handler = (channel: string) => (ipcMain.handle as jest.Mock).mock.calls.find(([name]) => name === channel)![1];
    await expect(handler('audio-preview-narrator-draft')({ sender: {} }, 'Voice', 'Words')).rejects.toThrow('Open Audio');
    expect(() => handler('audio-save-narrator-draft')({ sender: {} }, 'id', 'Name')).toThrow('Open Audio');
    expect(() => handler('audio-discard-narrator-draft')({ sender: {} })).toThrow('Open Audio');
    await handler('audio-preview-narrator-draft')({ sender }, 'A male baritone.', 'Exact words.');
    expect(runtime.previewNarratorDraft).toHaveBeenCalledWith('A male baritone.', 'Exact words.', undefined);
    handler('audio-save-narrator-draft')({ sender }, 'audition-id', 'Saved name');
    expect(runtime.saveNarratorDraft).toHaveBeenCalledWith('audition-id', 'Saved name');
    handler('audio-discard-narrator-draft')({ sender }); expect(runtime.discardNarratorDraft).toHaveBeenCalledTimes(1);
});
test('bank import and exact encounter assignment require the owned Audio settings page', async () => {
    (app as any).getAppPath = () => path.resolve('.'); (ipcMain.handle as jest.Mock).mockClear();
    const sender = { getURL: () => pathToFileURL(path.resolve('public/configWindow/audio.html')).href };
    const runtime = { bindClone: jest.fn(), importCloneBank: jest.fn() } as any, conv = {} as any;
    registerAudioIpc(runtime, { audio: normalizeAudio() } as any, () => conv,
        () => [{ webContents: sender, isDestroyed: () => false }] as any, () => undefined);
    const handler = (name: string) => (ipcMain.handle as jest.Mock).mock.calls.find(([channel]) => channel === name)![1];
    expect(() => handler('audio-bind-clone-bank')({ sender: {} }, 2, 'speaker/v0001')).toThrow('Open Audio');
    await expect(handler('audio-import-clone-bank')({ sender: {} })).rejects.toThrow('Open Audio');
    handler('audio-bind-clone-bank')({ sender }, 2, 'speaker/v0001'); expect(runtime.bindClone).toHaveBeenCalledWith(conv, 2, 'speaker/v0001');
    handler('audio-bind-clone-bank')({ sender }, 2); expect(runtime.bindClone).toHaveBeenLastCalledWith(conv, 2, undefined);
});
