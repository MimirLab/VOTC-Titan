import fs from 'fs';
import os from 'os';
import path from 'path';
import { Conversation } from '../../src/main/conversation/Conversation';
import { GameData } from '../../src/shared/gameData/GameData';
import { character } from '../culture/fixtures';
import { MemoryCompactor } from '../../src/main/conversation/MemoryCompactor';
import { compactedMemoryStore } from '../../src/main/compactedMemoryStore';
import { CompactionConfig, CompactedMemory } from '../../src/shared/compactionTypes';
import { CloseProfiles } from '../../src/main/language/closeProfiles';
import { CloseEncoder } from '../../src/main/language/closeEncoder';
import { FarEncoder } from '../../src/main/language/farEncoder';
import { LanguageRenderer } from '../../src/main/language/languageRendering';
import { LanguageConversation } from '../../src/main/language/languageConversation';
import { Message } from '../../src/main/ts/conversation_interfaces';

jest.mock('../../src/main/compactedMemoryStore', () => ({ compactedMemoryStore: {
    saveCompactedMemory: jest.fn(async () => ({ serializationTimeMs: 0, diskWriteTimeMs: 0 })),
    saveCompactedMemoryBatch: jest.fn(async () => ({ serializationTimeMs: 0, diskWriteTimeMs: 0 })),
    updateCompactedMemoryBatch: jest.fn(async (id: string, callbacks: Map<string, (rows: CompactedMemory[]) => CompactedMemory[]>) => {
        const memories = new Map([...callbacks].map(([owner, callback]) => [owner, callback([])]));
        const result = await jest.requireMock('../../src/main/compactedMemoryStore').compactedMemoryStore.saveCompactedMemoryBatch(id, memories);
        return { ...result, memories };
    }),
    getAllCompactedMemories: jest.fn()
} }));
const json = (name: string) => JSON.parse(fs.readFileSync('public/languages/' + name, 'utf8'));
const renderer = new LanguageRenderer(new CloseEncoder(new CloseProfiles(json('close-profiles.json'), json('routing.json'))),
    new FarEncoder(json('far-profiles.json'), 'titan-demo', json('unicode-casefold.json').fold));
const config: CompactionConfig = {
    enableMemoryCompaction: true, compactionPhase1Threshold: 40, compactionPhase2Threshold: 1,
    compactionTokenBudget: { phase1: 10, phase2: 10 }, compactionCooldownMinutes: 0,
    compactionPriorityElements: [], compactionEntityExtractionMode: 'regex',
    compactionRelationshipsDirectional: false, compactionApiConnectionConfig: {}
};
const fixtureDirectories = new Set<string>();
function setup() {
    const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-memory-ownership-'));
    fixtureDirectories.add(fixtureDirectory);
    fs.mkdirSync(path.join(fixtureDirectory, 'configs'));
    fs.cpSync(path.resolve('default_userdata/configs/prompts'), path.join(fixtureDirectory, 'configs/prompts'), { recursive: true });
    const game = new GameData(['1', 'Player', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Player', '0']);
    for (const [id, name, native] of [[1, 'Player', 'language_low_common'], [2, 'Speaker', 'language_common'],
        [3, 'Outsider', 'language_orcish']] as const) {
        const c = character(id, name); c.languageSnapshot = { version: 1, complete: true, nativeLanguageId: native, knownLanguageIds: [native] };
        game.characters.set(id, c);
    }
    const session = new LanguageConversation(game, renderer);
    const messages: Message[] = [{ id: 'source', role: 'assistant', name: 'Speaker', characterId: 2,
        content: '*She sets down the cup.* "Bring water to the gate before dawn."' }];
    session.record(messages[0]);
    const complete = jest.fn(async (prompt: Message[]) => {
        const input = prompt.map(message => message.content).join('\n');
        return 'She sets down the cup. ' + (input.includes('Bring water') ? 'Bring water to the gate before dawn.' : 'The speech remains uncertain.');
    });
    const conv: any = Object.assign(Object.create(Conversation.prototype), { config, gameData: game, messages, currentSummary: '',
        votcDataPath: fixtureDirectory, hasLanguageMessages: () => true,
        getEncounterCharacter: (id: number) => game.characters.get(id),
        getEncounterParticipantsForRecipient: () => [...game.characters.values()],
        calculateBasePromptTokens: async () => 900,
        textGenApiConnection: { context: 1000, calculateTokensFromMessage: () => 1000 },
        summarizationApiConnection: { complete, isChat: () => true }, getCurrentSummaryForRecipient: () => '',
        getMessagesForRecipient: (id: number, input = messages) => session.messagesForRecipient(input, id) });
    return { conv, complete };
}
beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    jest.restoreAllMocks();
    for (const directory of fixtureDirectories) fs.rmSync(directory, { recursive: true, force: true });
    fixtureDirectories.clear();
});
test('both compaction phases preserve recipient ownership and never merge a translation into FAR memory', async () => {
    const { conv, complete } = setup(); const compactor = new MemoryCompactor(config);
    const result = await compactor.compact(conv);
    expect(result.phase1Run).toBe(true); expect(result.phase2Run).toBe(true); expect(complete).toHaveBeenCalledTimes(3);
    const farMemories = compactor.getCompactedMemories('3');
    expect(farMemories.some(memory => memory.compactionLevel === 1)).toBe(true);
    expect(farMemories.some(memory => memory.compactionLevel === 2)).toBe(true);
    for (const memory of farMemories) {
        expect(memory.characterIds).toEqual([3]); expect(memory.recipientPerspectiveId).toBe(3);
        expect(memory.content).not.toContain('Bring water'); expect(memory.content).not.toContain('Bring waeter');
        expect(memory.content).toContain('She sets down the cup');
    }
    expect(compactor.getCompactedMemories('2').some(memory => memory.content.includes('Bring water'))).toBe(true);
    expect(conv.messages).toEqual([]);
    expect(compactedMemoryStore.saveCompactedMemoryBatch).toHaveBeenCalledTimes(1);
    for (const [playerId, owners] of (compactedMemoryStore.saveCompactedMemoryBatch as jest.Mock).mock.calls)
        for (const [owner, rows] of owners) for (const row of rows) expect(row.characterIds).toEqual([Number(owner)]);
});
test('disk replay restores each scoped memory only to its recorded owner', async () => {
    const memory: CompactedMemory = { id: 'stored', date: '1066.9.15', content: 'Unfamiliar sounds and an offered cup.',
        characterIds: [3], recipientPerspectiveId: 3, relevanceScore: 1, entityReferences: [],
        compactionLevel: 1, sourceMessageIds: ['source'], creationTimestamp: 1, gameDate: '1066.9.15' };
    (compactedMemoryStore.getAllCompactedMemories as jest.Mock).mockResolvedValue({ memories: [memory] });
    const compactor = new MemoryCompactor(config); await compactor.loadFromDisk('1');
    expect(compactor.getCompactedMemories('3')).toEqual([memory]); expect(compactor.getCompactedMemories('2')).toEqual([]);
});
