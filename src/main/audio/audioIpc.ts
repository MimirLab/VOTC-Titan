import { ipcMain, BrowserWindow, app, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Config } from '../../shared/Config';
import { normalizeAudio } from '../../shared/audio';
import type { Conversation } from '../conversation/Conversation';
import { AudioRuntime, DEFAULT_NARRATOR, REFERENCE_TEXT } from './AudioRuntime';
import { BREEZE_MODELS } from './modelCatalog';
import { audioHardware } from './hardware';
import { castingCatalogue } from './castingCatalog';

export function registerAudioIpc(runtime: AudioRuntime, config: Config, conversation: () => Conversation | undefined,
    settingsWindows: () => (BrowserWindow | undefined)[], chatWindow: () => BrowserWindow | undefined): void {
    const settingsOwner = (sender: Electron.WebContents) => {
        if (!settingsWindows().some(window => window && !window.isDestroyed() && window.webContents === sender)) return false;
        try { return path.resolve(fileURLToPath(sender.getURL())) === path.join(app.getAppPath(), 'public', 'configWindow', 'audio.html'); }
        catch { return false; }
    };
    const chatOwner = (sender: Electron.WebContents) => { const window = chatWindow(); return !!window && !window.isDestroyed() && window.webContents === sender; };
    const requireSettings = (sender: Electron.WebContents) => { if (!settingsOwner(sender)) throw new Error('Open Audio settings for this action.'); };
    ipcMain.handle('audio-playback-status', event => {
        if (!chatOwner(event.sender) && !settingsOwner(event.sender)) throw new Error('Unknown audio playback owner.');
        return runtime.status;
    });
    ipcMain.handle('audio-settings', event => {
        requireSettings(event.sender);
        const conv = conversation();
        return { settings: config.audio, status: runtime.status, hardware: audioHardware(),
            models: Object.entries(BREEZE_MODELS).map(([id, model]) => ({ id, ...model, installed: runtime.managed.installed(id as keyof typeof BREEZE_MODELS) })),
            voices: runtime.list(), cloneBanks: runtime.cloneBanks(), castingCatalogue: castingCatalogue(), narratorDefault: DEFAULT_NARRATOR, previewDefault: REFERENCE_TEXT,
            activeLocalModel: runtime.managed.activeModel,
            activeLocalBackend: runtime.managed.activeBackend,
            defaultCharacterId: conv?.gameData.aiID,
            characters: [...(conv?.gameData.characters.values() ?? [])].map(actor => ({ id: actor.id, name: actor.fullName,
                casting: runtime.castingChoices(conv!, actor.id), cloneInfo: runtime.cloneInfo(conv!, actor.id), cloneBank: runtime.cloneBinding(conv!, actor.id)?.key })) };
    });
    ipcMain.handle('audio-import-clone-bank', async event => {
        requireSettings(event.sender);
        const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
            title: 'Import character clone bank — select voice.json', properties: ['openFile'], filters: [{ name: 'Voice manifest', extensions: ['json'] }] });
        if (selected.canceled || !selected.filePaths[0]) return;
        requireSettings(event.sender); return runtime.importCloneBank(selected.filePaths[0]);
    });
    ipcMain.handle('audio-bind-clone-bank', (event, characterId: number, key?: string) => {
        requireSettings(event.sender); const conv = conversation(); if (!conv) throw new Error('Open an encounter first.');
        runtime.bindClone(conv, characterId, key); return true;
    });
    ipcMain.handle('audio-save-settings', (event, value: unknown) => {
        requireSettings(event.sender);
        if (!value || typeof value !== 'object') throw new Error('Invalid audio settings.');
        config.audio = normalizeAudio(value); config.audio.cueMode = 'whole'; // Passage cues remain a study arm until qualified.
        config.export(); runtime.changed(); return config.audio;
    });
    ipcMain.handle('audio-install', async (event, model: string) => {
        requireSettings(event.sender); if (!(model in BREEZE_MODELS)) throw new Error('Unknown Breeze package.');
        await runtime.managed.install(model as keyof typeof BREEZE_MODELS); return true;
    });
    ipcMain.handle('audio-test', async event => { requireSettings(event.sender); await runtime.test(); return runtime.status; });
    const checkFaith = (faithDeliveryId?: string) => {
        if (faithDeliveryId !== undefined && (typeof faithDeliveryId !== 'string' || !castingCatalogue().faithDelivery[faithDeliveryId]))
            throw new Error('Unknown faith performance for this preview.');
    };
    ipcMain.handle('audio-preview', async (event, id?: string, faithDeliveryId?: string, text?: string) => {
        requireSettings(event.sender);
        checkFaith(faithDeliveryId); return runtime.previewVoice(id, faithDeliveryId, text);
    });
    ipcMain.handle('audio-preview-character', async (event, id: number, text?: string, faithDeliveryId?: string) => {
        requireSettings(event.sender); checkFaith(faithDeliveryId);
        const conv = conversation(); if (!conv || !conv.gameData.characters.has(id)) throw new Error('Select a character in the current encounter.');
        return runtime.previewCharacter(conv, id, text, faithDeliveryId);
    });
    ipcMain.handle('audio-save-narrator', (event, label: string, instruction: string) => { requireSettings(event.sender); return runtime.saveNarrator(label, instruction); });
    ipcMain.handle('audio-preview-narrator-draft', async (event, instruction: string, text?: string, faithDeliveryId?: string) => {
        requireSettings(event.sender); checkFaith(faithDeliveryId); return runtime.previewNarratorDraft(instruction, text, faithDeliveryId);
    });
    ipcMain.handle('audio-save-narrator-draft', (event, id: string, label: string) => { requireSettings(event.sender); return runtime.saveNarratorDraft(id, label); });
    ipcMain.handle('audio-discard-narrator-draft', event => { requireSettings(event.sender); runtime.discardNarratorDraft(); return true; });
    ipcMain.handle('audio-save-voice', (event, id: string, instruction: string) => { requireSettings(event.sender); return runtime.saveVoice(id, instruction); });
    ipcMain.handle('audio-select-voice', (event, id: string) => { requireSettings(event.sender); runtime.selectVoice(id); return true; });
    ipcMain.handle('audio-rename-voice', (event, id: string, label: string) => { requireSettings(event.sender); runtime.renameVoice(id, label); return true; });
    ipcMain.handle('audio-delete-voice', (event, id: string) => { requireSettings(event.sender); runtime.deleteVoice(id); return true; });
    ipcMain.handle('audio-redesign', async (event, characterId: number) => {
        requireSettings(event.sender); const conv = conversation(); if (!conv) throw new Error('Open an encounter first.');
        await runtime.redesign(conv, characterId); return runtime.list();
    });
    ipcMain.handle('audio-save-casting', async (event, characterId: number, choices: unknown) => {
        requireSettings(event.sender); const conv = conversation(); if (!conv) throw new Error('Open an encounter first.');
        await runtime.saveCasting(conv, characterId, choices); return runtime.list();
    });
    ipcMain.handle('audio-replay', (event, id: string) => {
        if (!chatOwner(event.sender) && !settingsOwner(event.sender)) throw new Error('Unknown audio playback owner.');
        const conv = conversation(); if (!conv || typeof id !== 'string') throw new Error('Open an encounter first.');
        if (!config.audio.enabled) throw new Error('Enable Audio to play character voices.');
        runtime.replay(conv, id); return true;
    });
    ipcMain.on('audio-control', (event, command: string) => {
        if (!chatOwner(event.sender) && !settingsOwner(event.sender)) return;
        if (command === 'pause') runtime.pause();
        if (command === 'stop') runtime.stop();
        if (settingsOwner(event.sender) && command === 'unload') { runtime.stop(); runtime.managed.stop(); }
        if (settingsOwner(event.sender) && command === 'cancel-download') runtime.managed.cancelInstall();
    });
    ipcMain.on('audio-completed', (event, id: string) => { if (chatOwner(event.sender)) runtime.completed(id); });
}
