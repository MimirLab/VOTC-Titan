import path from 'path';
import fs from 'fs';
import os from 'os';
import { Conversation } from '../../src/main/conversation/Conversation';
import { GameData } from '../../src/shared/gameData/GameData';
import { SCENE_CATALOGUE_DIGEST } from '../../src/shared/scenes/catalogue.generated';
import { applySceneSnapshot } from '../../src/main/scenes/sceneRuntime';
import { generateSceneDescription } from '../../src/main/conversation/sceneDescriptionBuilder';

jest.mock('../../src/main/conversation/sceneDescriptionBuilder', () => ({ generateSceneDescription: jest.fn() }));
jest.mock('../../src/main/compactedMemoryStore', () => ({ compactedMemoryStore: {} }));
jest.mock('../../src/main/culture/cultureRuntime', () => ({
    beginCultureForeground: () => () => {}, prepareRoleplayBackground: jest.fn()
}));

const fixtureDirectories = new Set<string>();
function fixture(): any {
    const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-narration-refresh-'));
    fixtureDirectories.add(fixtureDirectory);
    const game = new GameData(['1', 'Test player', '2', 'Test visitor', '600.1.1',
        'talk_scene_titan_farraki_court', "Zul'Farrak", 'Test controller', '0']);
    applySceneSnapshot(game, { schema: 1, catalogue: SCENE_CATALOGUE_DIGEST, mode: 'goa',
        anchorId: 1, selected: 'titan_farraki_court', location: "Zul'Farrak", controller: 'Test controller',
        provinceId: 1591, terrain: 'desert', style: 'zulian', regions: ['tanaris'], settled: true, coastal: false,
        worldStates: [], eligible: ['titan_farraki_court', 'titan_region_tanaris_white_gold_dune_country'] });
    return Object.assign(Object.create(Conversation.prototype), {
        isOpen: true, gameData: game, config: { autoGenerateSuggestions: false }, messages: [], actions: [],
        chatWindow: { window: { webContents: { send: jest.fn() } } }, isGenerating: false,
        isGeneratingScene: false, abortController: null, sceneRequestAbort: null, sceneRefreshPending: false,
        pendingPlayerRequest: false, encounterLifetime: new AbortController(), encounterCapture: Promise.resolve(true),
        generateAIsMessages: jest.fn(), votcDataPath: fixtureDirectory
    });
}
function move(conv: any, scene: string) {
    expect(applySceneSnapshot(conv.gameData, { ...conv.gameData.sceneSnapshot, selected: scene })).toBe(true);
    conv.sceneContextChanged();
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
const builder = generateSceneDescription as jest.Mock;

beforeEach(() => { jest.useFakeTimers(); builder.mockReset(); });
afterEach(() => {
    jest.clearAllTimers(); jest.useRealTimers();
    for (const directory of fixtureDirectories) fs.rmSync(directory, { recursive: true, force: true });
    fixtureDirectories.clear();
});

test('a confirmed venue switch interrupts a slow intro and publishes only the new scene', async () => {
    const conv = fixture();
    let oldSignal!: AbortSignal;
    const scenes: string[] = [];
    builder.mockImplementation((c: any, signal: AbortSignal) => {
        scenes.push(c.gameData.scene);
        if (scenes.length === 1) {
            oldSignal = signal;
            return new Promise((_resolve, reject) => signal.addEventListener('abort',
                () => reject(new DOMException('Superseded', 'AbortError')), { once: true }));
        }
        return Promise.resolve('The open desert stretches beyond the sandstone settlement.');
    });
    const intro = conv.generateSceneDescription(true);
    await flush();
    expect(scenes).toEqual(['titan_farraki_court']);
    conv.pendingPlayerRequest = true;
    move(conv, 'titan_region_tanaris_white_gold_dune_country');
    expect(oldSignal.aborted).toBe(true);
    await intro;
    expect(scenes).toEqual(['titan_farraki_court', 'titan_region_tanaris_white_gold_dune_country']);
    expect(conv.messages.map((m: any) => m.content)).toEqual([
        'The open desert stretches beyond the sandstone settlement.'
    ]);
    expect(conv.gameData.location).toBe("Zul'Farrak");
    const updates = conv.chatWindow.window.webContents.send.mock.calls.filter((c: any[]) => c[0] === 'scene-context-update');
    expect(updates[0][1].scene).toBe('titan_region_tanaris_white_gold_dune_country');
    expect(conv.generateAIsMessages).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(conv.generateAIsMessages).toHaveBeenCalledTimes(1);
    expect(conv.isGeneratingScene).toBe(false);
});

test('rapid confirmed changes coalesce to the latest venue rather than generating every intermediate scene', async () => {
    const conv = fixture(); const scenes: string[] = [];
    builder.mockImplementation((c: any, signal: AbortSignal) => {
        scenes.push(c.gameData.scene);
        return scenes.length === 1 ? new Promise((_resolve, reject) => signal.addEventListener('abort',
            () => reject(new DOMException('Superseded', 'AbortError')), { once: true })) : Promise.resolve('Latest court description.');
    });
    const intro = conv.generateSceneDescription(true); await flush();
    move(conv, 'titan_region_tanaris_white_gold_dune_country'); move(conv, 'titan_farraki_court');
    await intro;
    expect(scenes).toEqual(['titan_farraki_court', 'titan_farraki_court']);
    expect(conv.messages).toHaveLength(1);
});

test('user cancellation stops narration without retrying or starting a new model job', async () => {
    const conv = fixture();
    builder.mockImplementation((_c: any, signal: AbortSignal) => new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })));
    const intro = conv.generateSceneDescription(true); await flush();
    conv.cancelGeneration(); await intro; jest.runOnlyPendingTimers();
    expect(builder).toHaveBeenCalledTimes(1); expect(conv.messages).toEqual([]);
    expect(conv.isGeneratingScene).toBe(false);
});

test('a refresh waits for an active dialogue to release its own generation lock', async () => {
    const conv = fixture(); conv.isGenerating = true; conv.abortController = new AbortController();
    const dialogueSignal = conv.abortController.signal;
    move(conv, 'titan_region_tanaris_white_gold_dune_country');
    expect(dialogueSignal.aborted).toBe(true);
    expect(conv.isGenerating).toBe(true);
    expect(conv.sceneRefreshPending).toBe(true);
    expect(builder).not.toHaveBeenCalled();
    // The dialogue finally releases these fields before dispatching the pending refresh.
    conv.isGenerating = false; conv.abortController = null;
    builder.mockResolvedValue('Fresh desert narration.'); await conv.generateSceneDescription();
    expect(builder).toHaveBeenCalledTimes(1); expect(conv.messages[0].content).toBe('Fresh desert narration.');
});
