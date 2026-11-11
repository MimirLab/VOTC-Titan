import fs from 'fs';
import os from 'os';
import path from 'path';
import { GameData } from '../../src/shared/gameData/GameData';
import { character } from '../culture/fixtures';
import { MemoryCompactor } from '../../src/main/conversation/MemoryCompactor';
import { compactedMemoryStore } from '../../src/main/compactedMemoryStore';
import { loadLanguageEngine } from '../../src/main/language/languageEngine';
import { LanguageConversation } from '../../src/main/language/languageConversation';
import { ConversationLedger } from '../../src/main/language/conversationLedger';
import { Message } from '../../src/main/ts/conversation_interfaces';
import { Conversation } from '../../src/main/conversation/Conversation';
import { createCompactedMemoryString } from '../../src/main/conversation/promptBuilder';
import { compactedMemoryText, privateMemoryNarration } from '../../src/main/language/privateMemory';
import { buildIdentityFromParts } from '../../src/shared/gameData/CampaignIdentity';
import { CompactedMemory } from '../../src/shared/compactionTypes';
import { TimelineRegistry } from '../../src/main/timelineManager';
jest.mock('../../src/main/compactedMemoryStore', () => ({ compactedMemoryStore: {
    saveCompactedMemory: jest.fn().mockResolvedValue({ serializationTimeMs: 0, diskWriteTimeMs: 0 }),
    saveCompactedMemoryBatch: jest.fn().mockResolvedValue({ serializationTimeMs: 0, diskWriteTimeMs: 0 }),
    updateCompactedMemoryBatch: jest.fn(async (id: string, callbacks: Map<string, (rows: CompactedMemory[]) => CompactedMemory[]>) => {
        const memories = new Map([...callbacks].map(([owner, callback]) => [owner, callback(mockStoredOwners.get(owner) ?? [])]));
        const result = await jest.requireMock('../../src/main/compactedMemoryStore').compactedMemoryStore.saveCompactedMemoryBatch(id, memories);
        for (const [owner, rows] of memories) mockStoredOwners.set(owner, rows);
        return { ...result, memories };
    }),
    getAllCompactedMemories: jest.fn()
} }));
const mockStoredOwners = new Map<string, CompactedMemory[]>();
const engine = loadLanguageEngine(path.resolve('public/languages'));
const fixtureDirectories = new Set<string>();
function fixture(cooldown = 0, controlled = false) {
    const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-compaction-ledger-'));
    fixtureDirectories.add(fixtureDirectory);
    fs.mkdirSync(path.join(fixtureDirectory, 'configs'));
    fs.cpSync(path.resolve('default_userdata/configs/prompts'), path.join(fixtureDirectory, 'configs/prompts'), { recursive: true });
    const config = { ...JSON.parse(fs.readFileSync('default_userdata/configs/default_config.json', 'utf8')),
        enableMemoryCompaction: true, compactionPhase1Threshold: 1, compactionPhase2Threshold: 100,
        compactionCooldownMinutes: cooldown, compactionEntityExtractionMode: 'regex', compactionPriorityElements: [] };
    const game = new GameData(['1', 'Player', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Player', '0']);
    for (const [id, native] of [[1, 'language_low_common'], [2, 'language_common'], [3, 'language_orcish']] as const) {
        const actor = character(id, 'Actor' + id); actor.languageSnapshot = { version: 1, complete: true, nativeLanguageId: native, knownLanguageIds: [native] };
        game.characters.set(id, actor);
    }
    const session = new LanguageConversation(game, engine.renderer), ledger = new ConversationLedger();
    const message: Message = { id: 'source', role: 'assistant', characterId: 2, name: 'Actor2',
        content: controlled ? '**Her hands tremble.** ~~She plans to hide a ruby beneath the northern bench tonight.~~ ""Bring water before dawn.""'
            : '*Her hands tremble.* "Bring water before dawn."', ...(controlled ? { proseEncoding: 'controls-v1' } : {}) };
    session.record(message); ledger.append(message, game.characters.values());
    const conv: any = Object.assign(Object.create(Conversation.prototype), { config, gameData: game, messages: [message], currentSummary: '', calculateBasePromptTokens: async () => 100,
        votcDataPath: fixtureDirectory,
        getEncounterCharacter: (id: number) => game.characters.get(id),
        getEncounterParticipantsForRecipient: () => [...game.characters.values()],
        summarizationApiConnection: { isChat: () => true, complete: jest.fn(async (prompt: Message[]) => {
            const input = prompt.map(message => message.content).join('\n');
            return 'Her hands tremble. ' + (input.includes('Bring water') ? 'Bring water before dawn.' : 'The spoken meaning remains uncertain.');
        }) },
        textGenApiConnection: { context: 1000, calculateTokensFromMessage: () => 100 },
        hasLanguageMessages: () => true, getEncounterRevision: () => ledger.revision,
        getMessagesForRecipient: (id: number, messages: Message[]) => session.messagesForRecipient(messages, id),
        getCurrentSummaryForRecipient: () => '' });
    return { conv, ledger, compactor: new MemoryCompactor(config) };
}
beforeEach(() => {
    mockStoredOwners.clear();
    (compactedMemoryStore.saveCompactedMemory as jest.Mock).mockReset().mockResolvedValue({ serializationTimeMs: 0, diskWriteTimeMs: 0 });
    (compactedMemoryStore.saveCompactedMemoryBatch as jest.Mock).mockReset().mockResolvedValue({ serializationTimeMs: 0, diskWriteTimeMs: 0 });
    (compactedMemoryStore.getAllCompactedMemories as jest.Mock).mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    jest.restoreAllMocks();
    for (const directory of fixtureDirectories) fs.rmSync(directory, { recursive: true, force: true });
    fixtureDirectories.clear();
});
test('actual phase 1 stores owned perceptions and trims only working context', async () => {
    const { conv, ledger, compactor } = fixture(); await compactor.compact(conv);
    expect(conv.messages).toHaveLength(0); expect(ledger.messages).toHaveLength(1);
    expect(compactor.getCompactedMemories('2')[0].content).toContain('Bring water');
    expect(compactor.getCompactedMemories('3')[0].content).not.toContain('Bring water');
    expect(compactor.getCompactedMemories('3')[0].content).toContain('Her hands tremble');
    expect(compactedMemoryStore.saveCompactedMemoryBatch).toHaveBeenCalledTimes(1);
    expect([...((compactedMemoryStore.saveCompactedMemoryBatch as jest.Mock).mock.calls[0][1] as Map<string, unknown>).keys()]).toEqual(['1', '2', '3']);
    expect(conv.summarizationApiConnection.complete).toHaveBeenCalledTimes(3);
    const prompts = conv.summarizationApiConnection.complete.mock.calls.map((call: [Message[]]) => call[0].map(message => message.content).join('\n'));
    expect(prompts[2]).toContain('[Unintelligible Common speech.]');
    expect(prompts[2]).toContain('are private narration, not disclosures');
    for (const memory of compactor.getAllCompactedMemories()) expect(memory.characterIds).toEqual([memory.recipientPerspectiveId]);
});

test('both compaction phases and existing embedding inputs preserve a native echo without leaking its origin to other owners', async () => {
    const { conv, compactor } = fixture();
    const game: GameData = conv.gameData;
    for (const [id, language] of [[1, 'language_common'], [2, 'language_goblin'], [3, 'language_common']] as const)
        game.characters.get(id)!.languageSnapshot = { version: 1, complete: true, learning: 12,
            nativeLanguageId: language, knownLanguageIds: [language] };
    const arrival = character(4, 'Arrival'); arrival.languageSnapshot = { version: 1, complete: true, learning: 12,
        nativeLanguageId: 'language_goblin', knownLanguageIds: ['language_goblin'] }; game.characters.set(4, arrival);
    const ledger = new ConversationLedger(1), session = new LanguageConversation(game, engine.renderer, 'en', true, () => true, () => ledger.messages);
    const source: Message = { id: 'foreign-source', role: 'assistant', characterId: 2, name: 'Actor2',
        proseEncoding: 'controls-v1', observedByCharacterIds: [1, 2], content: '**He points at the gate.** ""My brother is missing."" ~~PRIVATE_ORCHID.~~' };
    session.record(source); ledger.append(source, game.characters.values());
    const sound = engine.renderer.forMode({ spokenLanguageId: 'language_goblin', originalText: 'brother', speechSpans: [{ start: 0, end: 7 }] }, 'FAR').content;
    const echo: Message = { id: 'foreign-echo', role: 'user', characterId: 1, name: 'Actor1', proseEncoding: 'controls-v1',
        content: `**She points at the road.** ""What does <<${sound}>> mean?"" ~~PRIVATE_ASTER.~~` };
    session.record(echo); ledger.append(echo, game.characters.values());
    const knowledge = JSON.stringify([...game.characters.values()].map(actor => actor.languageSnapshot));
    Object.assign(conv, { encounterLedger: ledger, messages: [source, echo], memoryCompactor: compactor,
        calculateBasePromptTokens: async () => 300,
        getMessagesForRecipient: (id: number, messages = conv.messages) => session.messagesForRecipient(messages, id),
        getEncounterRevision: () => ledger.revision });
    const requests: string[] = [];
    conv.summarizationApiConnection.complete.mockImplementation(async (prompt: Message[]) => {
        const input = prompt.map(message => message.content).join('\n'); requests.push(input);
        return input.includes('brother') ? 'An alliance was discussed; I recognized brother amid foreign speech.' : 'An uncertain exchange and visible gestures.';
    });
    (compactor as any).scheduler.shouldRunPhase2 = () => true;
    const result = await compactor.compact(conv);
    expect(result.phase1Run).toBe(true); expect(result.phase2Run).toBe(true);
    expect(conv.messages).toHaveLength(0); expect(ledger.messages).toHaveLength(2);
    expect(requests).toHaveLength(4);
    expect(requests[3]).toContain('brother'); expect(requests[3]).not.toMatch(/is missing|PRIVATE_ORCHID|PRIVATE_ASTER|"origin"\s*:/);
    for (const id of [1, 3]) expect(requests[id === 1 ? 0 : 2]).not.toMatch(/\bbrother\b/);
    for (const id of [1, 3, 4]) {
        const memories = compactor.getCompactedMemories(String(id));
        expect(memories.some(memory => memory.compactionLevel === 2)).toBe(true);
        for (const memory of memories) {
            expect(memory.characterIds).toEqual([id]); expect(memory.recipientPerspectiveId).toBe(id);
            const text = compactedMemoryText(memory, id, undefined, memories);
            expect(text).not.toContain('PRIVATE_ORCHID');
            if (id === 4) expect(text).toContain('brother');
            else expect(text).not.toMatch(/\bbrother\b/);
            if (id !== 1) expect(text).not.toContain('PRIVATE_ASTER');
        }
    }
    conv.embedAndInsertMemories = jest.fn().mockResolvedValue(1);
    await conv.vectorizeCompactedMemories(compactor.getAllCompactedMemories());
    const items = conv.embedAndInsertMemories.mock.calls[0][0];
    for (const item of items) {
        if (item.characterId === '4') expect(item.text).toContain('brother');
        if (item.characterId === '1' || item.characterId === '3') expect(item.text).not.toMatch(/\bbrother\b/);
        if (item.characterId !== '2') expect(item.text).not.toContain('PRIVATE_ORCHID');
        if (item.characterId !== '1') expect(item.text).not.toContain('PRIVATE_ASTER');
    }
    expect(JSON.stringify([...game.characters.values()].map(actor => actor.languageSnapshot))).toBe(knowledge);
});

test('both compaction phases retain exact owned private context even when every semantic summary omits it', async () => {
    const { conv, compactor } = fixture(0, true); conv.memoryCompactor = compactor;
    (compactor as any).scheduler.shouldRunPhase2 = () => true;
    await compactor.compact(conv);
    const owned = compactor.getCompactedMemories('2');
    for (const memory of owned) {
        expect(memory.content).not.toContain('ruby');
        const expected = [{ sourceMessageId: 'source', content: 'She plans to hide a ruby beneath the northern bench tonight.', sourceGameDate: conv.gameData.date }];
        expect(privateMemoryNarration(memory, 2, owned)).toEqual(expected);
        if (memory.compactionLevel === 2) { expect(memory.retainedPrivateNarration).toBeUndefined(); expect(memory.retainedPrivateSourceIds).toEqual(['source']); }
        expect(compactedMemoryText(memory, 2, undefined, owned)).toContain('[Private inner narration, unspoken: She plans');
    }
    expect(owned.some((memory: any) => memory.compactionLevel === 2)).toBe(true);
    for (const id of ['1', '3']) expect(compactor.getCompactedMemories(id).every(memory => !memory.retainedPrivateNarration)).toBe(true);
    conv.memoryCompactor = compactor;
    const prompt = createCompactedMemoryString(conv, {}, conv.gameData.characters.get(2));
    expect(prompt.match(/ruby/g)).toHaveLength(1);
    const disk = JSON.parse(JSON.stringify(compactor.getAllCompactedMemories()));
    (compactedMemoryStore.getAllCompactedMemories as jest.Mock).mockResolvedValue({ memories: disk, cumulativeDiskReadMs: 0 });
    const restored = new MemoryCompactor(conv.config); await restored.loadFromDisk('1');
    const restoredOwner = restored.getCompactedMemories('2');
    expect(restoredOwner.every(memory => privateMemoryNarration(memory, 2, restoredOwner)[0].content.includes('tonight'))).toBe(true);
    const thread = restoredOwner.find(memory => memory.compactionLevel === 2)!;
    expect(() => compactedMemoryText(thread, 2)).toThrow('missing its owned source');
    expect(() => compactedMemoryText({ ...owned[0], recipientPerspectiveId: 3, characterIds: [3] }, 2)).toThrow('only to its owner');
    compactor.invalidateSourceMessages(['source'], '1', jest.fn());
    expect(compactor.getAllCompactedMemories()).toEqual([]);
});

test('consolidation on a later day preserves the original date of an unspoken future intention', async () => {
    const { conv, compactor } = fixture(0, true);
    const originalDate = conv.gameData.date;
    await compactor.compact(conv);
    conv.gameData.date = '1066.9.16';
    (compactor as any).scheduler.shouldRunPhase2 = () => true;
    await compactor.compact(conv);
    const memory = compactor.getCompactedMemories('2').find(memory => memory.compactionLevel === 2)!;
    expect(memory.gameDate).toBe('1066.9.16');
    const sourceMemories = compactor.getCompactedMemories('2');
    expect(privateMemoryNarration(memory, 2, sourceMemories)[0].sourceGameDate).toBe(originalDate);
    expect(compactedMemoryText(memory, 2, undefined, sourceMemories)).toContain('[Source game date: ' + originalDate + ']');
});
test('new campaign-owned compaction records retain their source encounter and campaign', async () => {
    const { conv, ledger, compactor } = fixture(0, true);
    conv.encounterLedger = ledger;
    conv.campaignIdentity = buildIdentityFromParts({ a: 11, b: 12, c: 13, d: 14 }, '1');
    await compactor.compact(conv);
    for (const memory of compactor.getAllCompactedMemories())
        expect((memory as any).scope).toEqual({ version: 1, campaignId: '11-12-13-14', encounterId: ledger.id });
});
test('another campaign with the same player and actor IDs cannot consume newly retained private memory', async () => {
    const first = fixture(0, true);
    first.conv.encounterLedger = first.ledger;
    first.conv.campaignIdentity = buildIdentityFromParts({ a: 11, b: 12, c: 13, d: 14 }, '1');
    await first.compactor.compact(first.conv);
    const saved = JSON.parse(JSON.stringify(first.compactor.getAllCompactedMemories()));
    const second = fixture(0, true);
    second.conv.encounterLedger = second.ledger;
    second.conv.campaignIdentity = buildIdentityFromParts({ a: 21, b: 22, c: 23, d: 24 }, '1');
    second.conv.memoryCompactor = second.compactor;
    (compactedMemoryStore.getAllCompactedMemories as jest.Mock).mockResolvedValue({ memories: saved });
    await second.compactor.loadFromDisk('1', second.conv.gameData.date);
    expect(createCompactedMemoryString(second.conv, {}, second.conv.gameData.characters.get(2))).toBe('');
    expect(second.compactor.getAllCompactedMemories()).toEqual(saved);
});
test('close stamps both phases atomically, preserving a newer encounter and hiding sibling-branch context', async () => {
    const { conv, ledger, compactor } = fixture(0, true);
    conv.encounterLedger = ledger; conv.memoryCompactor = compactor;
    conv.campaignIdentity = buildIdentityFromParts({ a: 11, b: 12, c: 13, d: 14 }, '1');
    (compactor as any).scheduler.shouldRunPhase2 = () => true;
    await compactor.compact(conv);
    const newer = { ...compactor.getCompactedMemories('2')[0], id: 'newer-encounter',
        scope: { version: 1 as const, campaignId: '11-12-13-14', encounterId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } };
    mockStoredOwners.get('2')!.push(newer);
    await compactor.finalizeEncounterScope('1', conv.getCompactedMemoryScope(), { checkpointEpoch: 1, timelineNodeId: '2-2' });
    for (const memory of compactor.getAllCompactedMemories().filter(memory => memory.id !== newer.id))
        expect(memory.scope).toEqual({ version: 1, campaignId: '11-12-13-14', encounterId: ledger.id, checkpointEpoch: 1, timelineNodeId: '2-2' });
    expect(compactor.getCompactedMemories('2')).toContainEqual(newer);
    const registry = new TimelineRegistry('1', { version: 1, playerId: '1', nodes: {
        '1-1': { parentId: null, epoch: 0, source: 'root', eventKey: 'root', createdAt: '2026-10-13' },
        '2-2': { parentId: '1-1', epoch: 1, source: 'conversation', eventKey: 'left', createdAt: '2026-10-13' },
        '3-3': { parentId: '1-1', epoch: 1, source: 'conversation', eventKey: 'right', createdAt: '2026-10-13' }
    } });
    conv.encounterLedger = new ConversationLedger(); conv.gameData.votcCheckpointEpoch = 1;
    conv.timelineReadContext = { registry, currentNodeId: '3-3' };
    expect(createCompactedMemoryString(conv, {}, conv.gameData.characters.get(2))).toBe('');
    conv.timelineReadContext.currentNodeId = '2-2';
    expect(createCompactedMemoryString(conv, {}, conv.gameData.characters.get(2))).toContain('ruby');
    expect(compactor.getCompactedMemories('2')).toContainEqual(newer);
});
test('a failed close stamp leaves every provisional record unchanged and cannot expose it in another encounter', async () => {
    const { conv, ledger, compactor } = fixture(0, true);
    conv.encounterLedger = ledger; conv.memoryCompactor = compactor;
    conv.campaignIdentity = buildIdentityFromParts({ a: 11, b: 12, c: 13, d: 14 }, '1');
    await compactor.compact(conv);
    const before = JSON.stringify(compactor.getAllCompactedMemories());
    (compactedMemoryStore.saveCompactedMemoryBatch as jest.Mock).mockRejectedValue(new Error('Disk full'));
    await expect(compactor.finalizeEncounterScope('1', conv.getCompactedMemoryScope(), { checkpointEpoch: 1, timelineNodeId: '2-2' })).rejects.toThrow('Disk full');
    expect(JSON.stringify(compactor.getAllCompactedMemories())).toBe(before);
    conv.encounterLedger = new ConversationLedger();
    expect(createCompactedMemoryString(conv, {}, conv.gameData.characters.get(2))).toBe('');
});
test('hidden and later memories survive a load, append and close instead of disappearing from rewritten files', async () => {
    const { conv, ledger, compactor } = fixture(0, true);
    conv.encounterLedger = ledger; conv.memoryCompactor = compactor;
    conv.campaignIdentity = buildIdentityFromParts({ a: 11, b: 12, c: 13, d: 14 }, '1');
    await compactor.compact(conv);
    const hidden = { ...compactor.getCompactedMemories('2')[0], id: 'hidden-memory', gameDate: '1067.1.1',
        scope: { version: 1 as const, campaignId: '21-22-23-24', encounterId: ledger.id, checkpointEpoch: 1, timelineNodeId: '2-2' } };
    (compactedMemoryStore.getAllCompactedMemories as jest.Mock).mockResolvedValue({ memories: [hidden] });
    const restored = new MemoryCompactor(conv.config); await restored.loadFromDisk('1', conv.gameData.date);
    expect(compactedMemoryStore.getAllCompactedMemories).toHaveBeenLastCalledWith('1');
    conv.memoryCompactor = restored;
    expect(createCompactedMemoryString(conv, {}, conv.gameData.characters.get(2))).toBe('');
    const message: Message = { id: 'new-message', role: 'assistant', characterId: 2, name: 'Actor2', content: '"Wait here."', observedByCharacterIds: [1, 2] };
    conv.messages.push(message); ledger.append(message, conv.gameData.characters.values());
    await restored.compact(conv);
    expect(restored.getCompactedMemories('2')).toContainEqual(hidden);
    expect(mockStoredOwners.get('2')).toContainEqual(hidden);
});
test('the real close entry point retains compaction context after immediate main-style cleanup until its background work ends', async () => {
    const { conv, compactor } = fixture(0, true);
    conv.memoryCompactor = compactor;
    await compactor.compact(conv);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    conv.closingWorkCount = 0; conv.compactorReleaseRequested = false;
    conv.cancelBackgroundPreparation = jest.fn(); conv.cancelGeneration = jest.fn();
    conv.runFileManager = { write: jest.fn(), clear: jest.fn() };
    conv._saveHistoryToFile = jest.fn();
    conv._generateSummariesAndDiariesInBackground = jest.fn(async () => {
        await pending;
        expect(createCompactedMemoryString(conv, {}, conv.gameData.characters.get(2))).toContain('ruby');
    });
    const cleanup = jest.spyOn(compactor, 'cleanup');
    jest.useFakeTimers();
    try {
        const closing = conv.saveHistoryAndTriggerSummarization();
        conv.cleanup(); // main.ts does this immediately, without awaiting close.
        await closing;
        expect(cleanup).not.toHaveBeenCalled();
        release();
        await pending;
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(compactor.getAllCompactedMemories()).toEqual([]);
    } finally { jest.useRealTimers(); }
});
test.each([false, true])('a superseded close cannot write or later clear another encounter game file (initially allowed=%s)', async allowedInitially => {
    const { conv } = fixture();
    let allowed = allowedInitially;
    conv.closeEffectAllowed = () => allowed;
    conv.closingWorkCount = 0; conv.compactorReleaseRequested = false;
    conv.cancelBackgroundPreparation = jest.fn(); conv.cancelGeneration = jest.fn();
    conv.runFileManager = { write: jest.fn(), clear: jest.fn() };
    conv._saveHistoryToFile = jest.fn(); conv._generateSummariesAndDiariesInBackground = jest.fn(async () => {});
    jest.useFakeTimers();
    try {
        await conv.saveHistoryAndTriggerSummarization();
        expect(conv.runFileManager.write).toHaveBeenCalledTimes(allowedInitially ? 1 : 0);
        allowed = false; // Replacement can happen after the close wrote, before its old cleanup timer fires.
        jest.runOnlyPendingTimers();
        expect(conv.runFileManager.clear).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
});
test('owned semantic compaction failure keeps history and never substitutes a narrator heuristic', async () => {
    const { conv, ledger, compactor } = fixture();
    conv.summarizationApiConnection.complete.mockRejectedValue(new Error('Provider unavailable'));
    await expect(compactor.compact(conv)).rejects.toThrow('Provider unavailable');
    expect(conv.messages).toHaveLength(1); expect(ledger.messages).toHaveLength(1);
    expect(compactor.getAllCompactedMemories()).toEqual([]);
    expect(compactedMemoryStore.saveCompactedMemoryBatch).not.toHaveBeenCalled();
});
test('the proactive threshold check does not consume the cooldown before actual compaction', async () => {
    const { conv, compactor } = fixture(5);
    expect(compactor.shouldTriggerCompaction(conv.messages, 100, 1000)).toBe(true);
    const result = await compactor.compact(conv);
    expect(result.phase1Run).toBe(true);
    expect(conv.summarizationApiConnection.complete).toHaveBeenCalledTimes(3);
    expect(compactor.shouldTriggerCompaction(conv.messages, 100, 1000)).toBe(false);
});
test('a failed compaction attempt leaves the next retry eligible', async () => {
    const { conv, compactor } = fixture(5);
    expect(compactor.shouldTriggerCompaction(conv.messages, 100, 1000)).toBe(true);
    conv.summarizationApiConnection.complete.mockRejectedValue(new Error('Provider unavailable'));
    await expect(compactor.compact(conv)).rejects.toThrow('Provider unavailable');
    expect(compactor.shouldTriggerCompaction(conv.messages, 100, 1000)).toBe(true);
});
test('phase 2 keeps perspectives separate and preserves retraction provenance', async () => {
    const { conv, compactor } = fixture(); await compactor.compact(conv);
    (compactor as any).scheduler.shouldRunPhase2 = () => true;
    await compactor.compact(conv);
    const owner = compactor.getCompactedMemories('3').filter(m => m.compactionLevel === 2);
    expect(owner.length).toBeGreaterThan(0); expect(owner[0].content).not.toContain('Bring water');
    expect(owner[0].sourceMessageIds).toContain('source'); expect(owner[0].characterIds).toEqual([3]);
    const removed = jest.fn(); compactor.invalidateSourceMessages(['source'], '1', removed);
    expect(compactor.getAllCompactedMemories()).toEqual([]); expect(removed).toHaveBeenCalled();
});
test('unchanged source memories are not appended again as duplicate long-term threads', async () => {
    const { conv, compactor } = fixture();
    (compactor as any).scheduler.shouldRunPhase2 = () => true;
    await compactor.compact(conv);
    const before = compactor.getAllCompactedMemories().map(memory => memory.id);
    const second = await compactor.compact(conv);
    expect(second.phase2Run).toBe(false);
    expect(compactor.getAllCompactedMemories().map(memory => memory.id)).toEqual(before);
});
test('complete consolidation fingerprints survive disk replay and prevent duplicate regeneration after reopening', async () => {
    const { conv, compactor } = fixture();
    (compactor as any).scheduler.shouldRunPhase2 = () => true;
    await compactor.compact(conv);
    const saved = JSON.parse(JSON.stringify(compactor.getAllCompactedMemories()));
    (compactedMemoryStore.getAllCompactedMemories as jest.Mock).mockResolvedValue({ memories: saved, cumulativeDiskReadMs: 0 });
    const reopened = new MemoryCompactor(conv.config);
    await reopened.loadFromDisk('1');
    (reopened as any).scheduler.shouldRunPhase2 = () => true;
    const result = await reopened.compact(conv);
    expect(result.phase2Run).toBe(false);
    expect(reopened.getAllCompactedMemories().map(memory => memory.id)).toEqual(saved.map((memory: any) => memory.id));
});
test('consolidation reuses unchanged departed-owner records and repeats only incomplete thread groups', async () => {
    const { conv, compactor } = fixture();
    (compactor as any).scheduler.shouldRunPhase2 = () => true;
    await compactor.compact(conv);
    const outsider = compactor.getCompactedMemories('3').filter(memory => memory.compactionLevel === 2)[0];
    conv.gameData.characters.delete(3);
    conv.messages.push({ id: 'new-source', role: 'assistant', characterId: 2, name: 'Actor2', content: '"I will wait."', observedByCharacterIds: [1, 2] });
    await compactor.compact(conv);
    expect(compactor.getCompactedMemories('3').filter(memory => memory.compactionLevel === 2).map(memory => memory.id)).toEqual([outsider.id]);
    outsider.consolidation!.threadCount = 2; // Simulate a missing thread from a previously complete group.
    const restored = await compactor.compact(conv);
    expect(restored.phase2Run).toBe(true);
    expect(compactor.getCompactedMemories('3').filter(memory => memory.compactionLevel === 2)).toHaveLength(2);
    const repairedIds = compactor.getAllCompactedMemories().map(memory => memory.id);
    expect((await compactor.compact(conv)).phase2Run).toBe(false);
    expect(compactor.getAllCompactedMemories().map(memory => memory.id)).toEqual(repairedIds);
});
test('persistence failure holds all source turns and leaves no partial in-memory compaction', async () => {
    const { conv, ledger, compactor } = fixture();
    (compactedMemoryStore.saveCompactedMemoryBatch as jest.Mock).mockRejectedValue(new Error('Disk unavailable'));
    await expect(compactor.compact(conv)).rejects.toThrow('Disk unavailable');
    expect(conv.messages).toHaveLength(1); expect(ledger.messages).toHaveLength(1); expect(compactor.getAllCompactedMemories()).toEqual([]);
});
test('pending memories and source trimming stay invisible until the complete owner batch is saved', async () => {
    const { conv, compactor } = fixture();
    (compactedMemoryStore.saveCompactedMemoryBatch as jest.Mock).mockImplementation(async () => {
        expect(compactor.getAllCompactedMemories()).toEqual([]);
        expect(conv.messages).toHaveLength(1);
        return { serializationTimeMs: 0, diskWriteTimeMs: 0 };
    });
    await compactor.compact(conv);
    expect(compactor.getAllCompactedMemories()).toHaveLength(3); expect(conv.messages).toHaveLength(0);
});
test('an edit during phase 2 cannot publish pending phase 1 memories or restore invalidated memories', async () => {
    const { conv, ledger, compactor } = fixture();
    const previous = { id: 'older-memory', content: 'An earlier exchange.', characterIds: [3], recipientPerspectiveId: 3,
        compactionLevel: 1, sourceMessageIds: ['earlier'], entityReferences: [] };
    (compactor as any).compactedMemories.set('3', [previous]);
    (compactor as any).scheduler.shouldRunPhase2 = () => true;
    const original = (compactor as any).phase2Compactor.compact.bind((compactor as any).phase2Compactor);
    let edited = false;
    (compactor as any).phase2Compactor.compact = async (...args: any[]) => {
        if (!edited) {
            expect(compactor.getAllCompactedMemories()).toEqual([previous]);
            compactor.invalidateSourceMessages(['earlier'], '1', jest.fn()); ledger.changed(); edited = true;
        }
        return original(...args);
    };
    await expect(compactor.compact(conv)).rejects.toThrow('changed');
    expect(compactor.getAllCompactedMemories()).toEqual([]); expect(conv.messages).toHaveLength(1);
    expect(compactedMemoryStore.saveCompactedMemoryBatch).not.toHaveBeenCalled();
});
test('edits while compaction awaits its algorithm invalidate the pending result', async () => {
    const { conv, ledger, compactor } = fixture();
    const original = (compactor as any).phase1Compactor.compact.bind((compactor as any).phase1Compactor);
    (compactor as any).phase1Compactor.compact = async (...args: any[]) => { const result = await original(...args); ledger.changed(); return result; };
    await expect(compactor.compact(conv)).rejects.toThrow('changed');
    expect(conv.messages).toHaveLength(1); expect(compactor.getAllCompactedMemories()).toEqual([]);
    expect(compactedMemoryStore.saveCompactedMemoryBatch).not.toHaveBeenCalled();
});

test('preemptive compaction preserves the exact pending target and action input', async () => {
    const { conv, compactor } = fixture();
    const pending: Message = { id: 'pending-player', role: 'user', characterId: 1,
        content: '[I offer my hand.] Actor3, will you stay?', targetCharacterIds: [3] } as Message;
    conv.messages = [pending]; conv.config.compactionPhase1Threshold=70;
    (compactor as any).config.compactionPhase1Threshold=70;conv.calculateBasePromptTokens=async()=>900;
    conv.npcQueue = [conv.gameData.characters.get(2), conv.gameData.characters.get(3)];
    expect((await conv.determineTargetedCharacters()).map((actor: any) => actor.id)).toEqual([3]);
    await compactor.compact(conv, { preservePendingInput: true });
    expect(conv.messages.at(-1)).toBe(pending);
    expect((await conv.determineTargetedCharacters()).map((actor: any) => actor.id)).toEqual([3]);
    expect(conv.messages.at(-1).content).toContain('[I offer my hand.]');
});

test('a departed observer compacts their own observed turn without reading the lead private memory', async () => {
    const { conv, compactor } = fixture();
    const retained = new Map(conv.gameData.characters);
    conv.getEncounterCharacter = (id: number) => retained.get(id);
    conv.messages[0].observedByCharacterIds = [1, 2, 3];
    conv.gameData.characters.delete(3); conv.memoryCompactor = compactor;
    (compactor as any).compactedMemories.set('2', [{ id: 'lead-private', content: 'LEAD_PRIVATE_MARKER I hid the stolen opal.',
        characterIds: [2], compactionLevel: 1, sourceMessageIds: ['earlier'], date: '', gameDate: '', creationTimestamp: 0 }]);
    const lookup = jest.spyOn(compactor, 'getCompactedMemories');
    await compactor.compact(conv);
    const requests = conv.summarizationApiConnection.complete.mock.calls.map((call: [Message[]]) => call[0].map(m => m.content).join('\n'));
    const departed = requests.find((text: string) => text.includes("This is Actor3's record"));
    expect(departed).toBeDefined(); expect(departed).not.toContain('LEAD_PRIVATE_MARKER');
    expect(departed).toContain('Her hands tremble'); expect(lookup).toHaveBeenCalledWith('3');
    expect(createCompactedMemoryString(conv, {}, 999)).toBe('');
});

test('growing consolidation groups render early facts once while retaining their source records for retraction', async () => {
    const { conv, compactor } = fixture();
    conv.summarizationApiConnection.complete.mockImplementation(async (prompt: Message[]) => {
        const input = prompt.map(m => m.content).join(' ');
        return input.includes('later-words-1') ? 'Agreement SECOND_PACT' : input.includes('later-words-') ? 'Another agreement.' : 'Agreement FIRST_PACT';
    });
    (compactor as any).scheduler.shouldRunPhase2 = () => true;
    for (let index = 0; index < 4; index++) {
        if (index) conv.messages.push({ id: 'later-' + index, role: 'assistant', characterId: 2, name: 'Actor2',
            content: '"later-words-' + index + '"', observedByCharacterIds: [1, 2, 3] });
        await compactor.compact(conv);
    }
    expect(compactor.getCompactedMemories('2').filter(m => m.compactionLevel === 2).length).toBeGreaterThan(1);
    conv.memoryCompactor = compactor;
    const prompt = createCompactedMemoryString(conv, {}, conv.gameData.characters.get(2));
    expect(prompt.match(/FIRST_PACT/g)).toHaveLength(1); expect(prompt.match(/SECOND_PACT/g)).toHaveLength(1);
    await compactor.invalidateSourceMessages(['source'], '1', jest.fn());
    expect(createCompactedMemoryString(conv, {}, conv.gameData.characters.get(2))).not.toContain('Key Narrative Threads');
});
