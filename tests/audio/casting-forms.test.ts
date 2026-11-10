import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import { AudioRuntime } from '../../src/main/audio/AudioRuntime';
import { AudioLibrary } from '../../src/main/audio/AudioLibrary';
import { BreezeProvider } from '../../src/main/audio/BreezeProvider';
import { designCharacterVoice } from '../../src/main/audio/voiceDesign';
import { normalizeAudio } from '../../src/shared/audio';
import { pcmToWav } from '../../src/main/audio/pcm';
import { GoaSnapshot } from '../../src/shared/gameData/GoaSnapshot';
import type { Conversation } from '../../src/main/conversation/Conversation';
import * as castingRuntime from '../../src/main/audio/castingRuntime';
let snapshot: GoaSnapshot | undefined;
jest.mock('../../src/main/goa/goaRuntime', () => ({ getVerifiedGoaSnapshot: () => snapshot, currentGoaCatalog: () => undefined }));
jest.mock('../../src/main/audio/voiceDesign', () => ({
    prepareVoiceDesign: (_conv: unknown, _actor: unknown, casting: any, individual?: string) => ({ casting, individual }),
    refreshPreparedVoiceBody: (prepared: any, _conv: any, _actor: any, casting: any, individual: any) => ({ ...prepared, casting, individual }),
    updatePreparedVoiceDesign: (prepared: any, casting: any, individual: any, development: any) => ({ ...prepared, casting, individual, development }),
    designCharacterVoice: jest.fn(async (_conv, _actor, _signal, prepared) => ({
        instruction: prepared.casting.anatomyCore + ' ' + prepared.casting.cultureCore + ' A slight dry grain with gently rounded consonants.',
        provenance: JSON.stringify({ version: 2, casting: prepared.casting, individual: 'A slight dry grain with gently rounded consonants.' })
    }))
}));
jest.mock('../../src/main/audio/BreezeProvider');
let root: string;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function until(condition: () => boolean): Promise<void> { for (let n = 0; n < 80 && !condition(); n++) await tick(); expect(condition()).toBe(true); }
beforeEach(() => { (app as any).getAppPath = () => path.resolve('.'); root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-audio-form-')); snapshot = undefined; jest.clearAllMocks(); });
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
test('body transformation prepares a paired reference once, retains cultural accent, and returning form/older age reuse the original reference', async () => {
    const actor = { id: 2, sex: 'male', age: 35, fullName: 'Synthetic Dragon', shortName: 'Dragon' };
    const settings = normalizeAudio({ enabled: true, hosting: 'external', model: 'synthetic-q8-identity' });
    let count = 0; const requests: any[] = []; const events: any[] = [];
    let runtime: AudioRuntime;
    runtime = new AudioRuntime(root, () => settings, (channel, ...args) => {
        events.push([channel, ...args]); if (channel === 'audio-end') runtime.completed(args[0]);
    });
    (BreezeProvider as jest.Mock).mockImplementation(() => ({ speech: async (text: string, direction: string, profile: any, signal: AbortSignal, onPCM?: (chunk: Buffer) => Promise<void>) => {
        signal.throwIfAborted(); requests.push({ text, direction, voice: profile.id, reference: profile.referenceFile });
        if (onPCM) { await onPCM(Buffer.alloc(960)); return Buffer.alloc(0); } count++; return pcmToWav(Buffer.alloc(960, count));
    } }));
    const conv = { config: { audio: settings }, campaignIdentity: { campaignId: 'campaign-a' }, isOpen: true,
        gameData: { characters: new Map([[2, actor]]), playerID: 1 }, messageForPlayer: (message: any) => ({ ...message,
            content: '"Grog maen."', editableContent: '""Grog maen.""', proseEncoding: 'controls-v1' }) } as unknown as Conversation;
    const store = new AudioLibrary(path.join(root, 'library')); store.saveCastingChoice('campaign-a', '2', { cultureId: 'gilnean' }); store.close();
    const emit = async (id: string) => {
        const previous = events.filter(event => event[0] === 'audio-end').length;
        runtime.enqueue(conv, { id, role: 'assistant', characterId: 2, content: 'Hidden canonical source' });
        await until(() => events.filter(event => event[0] === 'audio-end').length === previous + 1); await tick();
    };
    try {
        snapshot = { version: 1, digest: 'a'.repeat(64), characterId: 2, sex: 'male', traitIds: ['creature_black_dragon'], facts: {} };
        await emit('dragon'); const original = requests.at(-1).voice;
        snapshot = { ...snapshot, currentBody: 'creature_human' }; await emit('human'); const human = requests.at(-1).voice;
        expect(human).not.toBe(original); expect(designCharacterVoice).toHaveBeenCalledTimes(2);
        const designs = runtime.list(); expect(designs.every(voice => voice.instruction.includes('Cockney accent'))).toBe(true);
        expect(designs.some(voice => voice.instruction.includes('dragon form'))).toBe(true); expect(designs.some(voice => voice.instruction.includes('balanced chest resonance'))).toBe(true);
        snapshot = { ...snapshot, currentBody: undefined }; actor.age = 80; await emit('older-dragon');
        expect(requests.at(-1).voice).toBe(original); expect(requests.at(-1).direction).toContain('elderly');
        expect(designCharacterVoice).toHaveBeenCalledTimes(2); expect(count).toBe(2);
        expect(requests.filter(request => request.reference).every(request => request.text === 'Grog maen.')).toBe(true);
        expect(JSON.stringify(requests)).not.toContain('Hidden canonical source');
        expect(designs.every(voice => voice.referenceMetadata?.model === 'synthetic-q8-identity')).toBe(true);
        expect((designCharacterVoice as jest.Mock).mock.calls[1][3].individual).toContain('dry grain');
    } finally { runtime.shutdown(); }
});
test('opening the upgraded library preserves an existing narrator and original WAV without inventing old reference provenance', () => {
    const library = new AudioLibrary(root);
    let narrator = library.save('__global__', '__narrator__', 'Narrator', 'A warm, clear storyteller with a smooth resonant midrange.', 'Titan narrator default v1');
    const wav = pcmToWav(Buffer.alloc(960)); narrator = library.reference(narrator, wav, 'The exact reference transcript.'); library.close();
    const reopened = new AudioLibrary(root);
    try {
        expect(reopened.get('__global__', '__narrator__')!.id).toBe(narrator.id);
        expect(fs.readFileSync(reopened.get('__global__', '__narrator__')!.referenceFile!)).toEqual(wav);
        expect(reopened.get('__global__', '__narrator__')!.referenceMetadata).toBeUndefined(); expect(reopened.list()).toHaveLength(1);
    } finally { reopened.close(); }
});
test('a failed audio-owned capture leaves committed player text available and makes no voice-model request', async () => {
    const actor = { id: 2, sex: 'male', age: 35, fullName: 'Synthetic Speaker', shortName: 'Speaker' };
    const settings = normalizeAudio({ enabled: true, hosting: 'external' });
    const capture = jest.spyOn(castingRuntime, 'captureForAudio').mockRejectedValue(new Error('Synthetic incomplete culture capture.'));
    const committed = { id: 'committed', role: 'assistant', characterId: 2, content: '"The gate is open."',
        editableContent: '""The gate is open.""', proseEncoding: 'controls-v1' };
    const before = JSON.stringify(committed);
    const conv = { config: { audio: settings }, campaignIdentity: { campaignId: 'campaign' }, isOpen: true,
        gameData: { characters: new Map([[2, actor]]), playerID: 1 }, messageForPlayer: () => committed } as unknown as Conversation;
    const runtime = new AudioRuntime(root, () => settings, () => {});
    try {
        runtime.enqueue(conv, committed as any); await until(() => runtime.status.state === 'error');
        expect(capture).toHaveBeenCalledTimes(1); expect(runtime.status.message).toContain('incomplete culture');
        expect(JSON.stringify(committed)).toBe(before); expect(designCharacterVoice).not.toHaveBeenCalled();
        expect(BreezeProvider).not.toHaveBeenCalled(); expect(runtime.list()).toHaveLength(0);
    } finally { runtime.shutdown(); }
});
test('audition selection reuses the original recording and later redesign cannot collide with archived higher revision numbers', () => {
    const library = new AudioLibrary(root);
    try {
        const first = library.reference(library.save('campaign', '2', 'Actor', 'A low resonant voice with rounded clear natural articulation.', 'synthetic'), pcmToWav(Buffer.alloc(960)), 'Exact original words.');
        const second = library.save('campaign', '2', 'Actor', 'A bright resonant voice with rounded clear natural articulation.', 'synthetic');
        library.activate(first); expect(library.get('campaign', '2')!.id).toBe(first.id);
        expect(fs.readFileSync(library.get('campaign', '2')!.referenceFile!)).toEqual(pcmToWav(Buffer.alloc(960)));
        const third = library.save('campaign', '2', 'Actor', 'A husky resonant voice with rounded clear natural articulation.', 'synthetic');
        expect(third.revision).toBe(second.revision + 1); expect(third.seed).toBe(first.seed);
    } finally { library.close(); }
});
test.each(['observed', 'saved overrides'])('first replay uses %s casting, prepares one reference and freezes it for later replay', async mode => {
    const actor = { id: 2, sex: 'male', age: 35, fullName: 'Synthetic Speaker', shortName: 'Speaker' };
    const settings = normalizeAudio({ enabled: true, hosting: 'external' });
    snapshot = { version: 1, digest: 'a'.repeat(64), characterId: 2, sex: 'male', traitIds: ['creature_tauren'], facts: {} };
    let observed = false;
    const capture = jest.spyOn(castingRuntime, 'captureForAudio').mockImplementation(async () => { observed = true; });
    jest.spyOn(castingRuntime, 'currentCastingCapture').mockReturnValue({ digest: 'synthetic', cultureIds: ['gilnean'] });
    jest.spyOn(castingRuntime, 'getAcousticCulture').mockImplementation(() => observed ? { version: 1, complete: true, cultureId: 'gilnean' } : undefined);
    const requests: any[] = []; let ends = 0; let runtime: AudioRuntime;
    (BreezeProvider as jest.Mock).mockImplementation(() => ({ speech: async (text: string, instruction: string, profile: any,
        signal: AbortSignal, onPCM?: (bytes: Buffer) => Promise<void>) => {
        signal.throwIfAborted(); requests.push({ text, instruction, voice: profile.id, reference: !!profile.referenceFile });
        if (onPCM) { await onPCM(Buffer.alloc(960)); return Buffer.alloc(0); } return pcmToWav(Buffer.alloc(960));
    } }));
    runtime = new AudioRuntime(root, () => settings, (channel, id) => { if (channel === 'audio-end') { ends++; runtime.completed(id); } });
    const view = { id: 'existing-reply', role: 'assistant', characterId: 2, content: '"Grog maen."',
        editableContent: '""Grog maen.""', proseEncoding: 'controls-v1' };
    const conv = { config: { audio: settings }, campaignIdentity: { campaignId: 'campaign' }, isOpen: true,
        gameData: { playerID: 1, characters: new Map([[2, actor]]) }, getEncounterCharacter: () => actor,
        getHistory: () => [view], historicalConversations: [] } as unknown as Conversation;
    if (mode === 'saved overrides') {
        const library = new AudioLibrary(path.join(root, 'library'));
        library.saveCastingChoice('campaign', '2', { anatomyId: '012', presentation: 'female', cultureId: 'shadowmoon' }); library.close();
    }
    try {
        runtime.replay(conv, view.id); await until(() => ends === 1); await tick();
        expect(capture).toHaveBeenCalledTimes(1); expect(designCharacterVoice).toHaveBeenCalledTimes(1);
        const first = runtime.list()[0]; expect(first.referenceFile).toBeTruthy();
        expect(JSON.parse(first.provenance).casting).toMatchObject(mode === 'observed'
            ? { anatomyId: '014', cultureId: 'gilnean' } : { anatomyId: '012', presentation: 'female', cultureId: 'shadowmoon' });
        actor.age = 80; snapshot = { ...snapshot, currentBody: 'creature_human' };
        runtime.replay(conv, view.id); await until(() => ends === 2); await tick();
        expect(capture).toHaveBeenCalledTimes(1); expect(designCharacterVoice).toHaveBeenCalledTimes(1);
        expect(requests.filter(request => request.reference)).toHaveLength(2);
        expect(requests.at(-1)).toMatchObject({ voice: first.id, text: 'Grog maen.' });
        expect(requests.at(-1).instruction).toContain('mature adult'); expect(requests.at(-1).instruction).not.toContain('elderly');
        if (mode === 'observed') {
            view.id = 'new-unvoiced-reply'; runtime.replay(conv, view.id); await until(() => ends === 3); await tick();
            expect(requests.at(-1).voice).not.toBe(first.id); expect(designCharacterVoice).toHaveBeenCalledTimes(2);
            expect(JSON.parse(runtime.list()[0].provenance).casting.anatomyId).not.toBe('014');
        }
    } finally { runtime.shutdown(); }
});
test('first replay capture failure surfaces before any individual design or Breeze call', async () => {
    const actor = { id: 2, age: 35, sex: 'male', fullName: 'Synthetic Speaker', shortName: 'Speaker' };
    const settings = normalizeAudio({ enabled: true, hosting: 'external' });
    jest.spyOn(castingRuntime, 'captureForAudio').mockRejectedValue(new Error('Synthetic first-replay capture error.'));
    const view = { id: 'first', role: 'assistant', characterId: 2, content: '"Grog maen."', editableContent: '""Grog maen.""', proseEncoding: 'controls-v1' };
    const before = JSON.stringify(view);
    const conv = { config: { audio: settings }, campaignIdentity: { campaignId: 'campaign' }, isOpen: true,
        gameData: { playerID: 1, characters: new Map([[2, actor]]) }, getEncounterCharacter: () => actor,
        getHistory: () => [view], historicalConversations: [] } as unknown as Conversation;
    const runtime = new AudioRuntime(root, () => settings, () => {});
    try {
        runtime.replay(conv, view.id); await until(() => runtime.status.state === 'error');
        expect(runtime.status.message).toBe('Synthetic first-replay capture error.');
        expect(designCharacterVoice).not.toHaveBeenCalled(); expect(BreezeProvider).not.toHaveBeenCalled(); expect(JSON.stringify(view)).toBe(before);
    } finally { runtime.shutdown(); }
});
