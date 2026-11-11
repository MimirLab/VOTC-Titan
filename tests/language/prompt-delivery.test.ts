import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import { Config } from '../../src/shared/Config';
import { GameData } from '../../src/shared/gameData/GameData';
import { character } from '../culture/fixtures';
import { Conversation } from '../../src/main/conversation/Conversation';
import { buildChatPrompt, buildSummarizeChatPrompt, buildResummarizeChatPrompt, convertMessagesToString } from '../../src/main/conversation/promptBuilder';
import { checkActions } from '../../src/main/conversation/checkActions';
import { buildSuggestionPrompt } from '../../src/main/conversation/suggestionBuilder';
import { generateNarrative } from '../../src/main/conversation/generateNarrative';
import { DiaryGenerator } from '../../src/main/diary/DiaryGenerator';
import { Message } from '../../src/main/ts/conversation_interfaces';
import { loadLedgerHistory } from '../../src/main/language/ledgerStorage';
import { recipientMessages, promptPerceptionMessages, perceivedMemoryTranscript, SPEECH_WRITER_INSTRUCTION } from '../../src/main/language/conversationView';
import { CONTROLLED_WRITER_INSTRUCTION } from '../../src/main/language/controlledWriter';
import { EmbeddingProvider } from '../../src/shared/apiConnection';
import { defaultLanguageEngine } from '../../src/main/language/languageRuntime';
import { parseControlledProse } from '../../src/shared/language/controlledProse';
import { ProviderLane } from '../../src/shared/providerActivity';

jest.mock('../../src/main/culture/cultureRuntime', () => ({ getCultureBackground: jest.fn(), formatCultureBackground: jest.fn(),
    captureRoleplayEncounter: jest.fn(), prepareRoleplayBackground: jest.fn() }));
jest.mock('../../src/main/faith/faithRuntime', () => ({ getFaithBackground: jest.fn(), getFaithLiveContext: jest.fn(), getFaithZealous: jest.fn() }));
jest.mock('../../src/main/letter/LetterManager', () => ({ LetterManager: { getInstance: () => ({ getLetterSummaries: () => [] }) } }));
jest.mock('../../src/main/diaryManager', () => ({ readDiarySummaries: async () => [], saveDiaryFile: jest.fn(), saveDiarySummaries: jest.fn() }));
jest.mock('../../src/main/summaryManager', () => ({ readSummaryFile: async () => [], saveSummaryFile: jest.fn() }));

let root: string, data: string, config: Config, game: GameData;
const source = '*She sets down the cup.* "Bring water to the gate before dawn."\n\n*Her hands tremble.*';
const controlledSource = '**She sets down the cup.** ""Bring water to the gate before dawn.""\n\n**Her hands tremble.**';
function write(relative: string, content: string): void {
    const file = path.join(data, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
}
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'votc-language-delivery-')); data = path.join(root, 'votc_data');
    (app.getPath as jest.Mock).mockReturnValue(root); (app as any).getAppPath = () => path.resolve('.');
    write('configs/prompts/en.json', fs.readFileSync('default_userdata/configs/prompts/en.json', 'utf8'));
    write('scripts/prompts/description/person.js', 'module.exports = () => "A quiet room with a table.";');
    write('scripts/prompts/example messages/standard/empty.js', 'module.exports = () => [];');
    config = Object.assign(Object.create(Config.prototype), JSON.parse(fs.readFileSync('default_userdata/configs/default_config.json', 'utf8')),
        { selectedDescScript: 'person.js', selectedExMsgScript: 'empty.js', maxTokens: 100, stream: false,
            goaLoreEnabled: false, questionPlayerActionsChance: 0 });
    game = new GameData(['1', 'Player', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Player', '0']);
    for (const [id, name, native] of [[1, 'Player', 'language_low_common'], [2, 'Speaker', 'language_common'],
        [3, 'Outsider', 'language_orcish']] as const) {
        const c = character(id, name); c.languageSnapshot = { version: 1, complete: true, nativeLanguageId: native, knownLanguageIds: [native] };
        game.characters.set(id, c);
    }
    jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
function conversation(): any {
    return Object.assign(Object.create(Conversation.prototype), { config, gameData: game, votcDataPath: data,
        messages: [{ id: 'source', role: 'assistant', name: 'Speaker', characterId: 2, content: source }],
        currentSummary: '', recipientCurrentSummaries: new Map(), historicalConversations: [], translations: {},
        getBranchVisibleSummaries: () => [], letterManager: { getLetterSummaries: () => [] },
        textGenApiConnection: { context: 30000, isChat: () => true, calculateTokensFromText: (s: string) => s.length / 4,
            calculateTokensFromChat: (m: unknown) => JSON.stringify(m).length / 4,
            calculateTokensFromMessage: () => 1000, complete: jest.fn(async (prompt: Message[] | string) =>
                (typeof prompt === 'string' ? prompt : prompt.map(message => message.content).join('\n'))
                    .includes(CONTROLLED_WRITER_INSTRUCTION) ? controlledSource : source) },
        chatWindow: { window: { webContents: { send: jest.fn() } } },
        memoryCompactor: { getCompactedMemories: () => [] }, executedActions: new Map(),
        currentTurnTriggeredActions: new Set(), calculateQuestioningChance: () => 0,
        ensureBackgroundReady: async () => {}, notSpokenYetText: 'Has not spoken yet' });
}

test.each([false, true])('closing memory resumes its interrupted provider operation after a new chat (diary enabled: %s)', async diaries => {
    const conv = conversation(), lane = new ProviderLane();
    conv.messages.unshift({ id: 'opening', role: 'user', name: 'Player', characterId: 1, content: 'Hello.' });
    config.diaryGenerationChance = diaries ? 100 : 0;
    config.embeddingApiConnectionConfig = undefined as any;
    conv.actionInvolvedCharacterIds = new Set(); conv.summaries = new Map();
    conv.summaryFileWatcher = { pauseWatcher: jest.fn(), resumeWatcher: jest.fn() };
    write('conversation_summaries/1/_character_map.json', '{}');
    const sent: string[] = [], completed: string[] = [];
    let started!: () => void;
    let firstAborted = false, releaseBlockedLegacyDiary!: () => void;
    const firstStarted = new Promise<void>(resolve => { started = resolve; });
    const complete = jest.fn(async (prompt: Message[], _stream: boolean, _args: object, _relay: unknown,
        signal: AbortSignal | undefined, _timeout: unknown, work: any = 'foreground') => lane.run(work, requestSignal => {
        sent.push(JSON.stringify(prompt));
        if (sent.length === 1) {
            started();
            return new Promise<string>((_resolve, reject) => {
                releaseBlockedLegacyDiary = () => reject(Object.assign(new Error('Legacy diary blocked foreground'), { name: 'AbortError' }));
                requestSignal.addEventListener('abort', () => {
                    firstAborted = true;
                    reject(Object.assign(new Error('Synthetic preemption'), { name: 'AbortError' }));
                }, { once: true });
            });
        }
        completed.push(JSON.stringify(prompt));
        return Promise.resolve('A brief exchange of observable gestures.');
    }, signal));
    const api = { complete, isChat: () => true, context: 30000, calculateTokensFromChat: () => 100 };
    conv.summarizationApiConnection = api;
    conv.diaryGenerator = Object.assign(Object.create(DiaryGenerator.prototype), { config, votcDataPath: data, apiConnection: api });
    const originalId = game.aiID;
    const closing = conv._generateSummariesAndDiariesInBackground();
    await firstStarted;
    const foreground = lane.run('foreground', async () => {
        expect(lane.foregroundBusy).toBe(true);
        // Learning now cannot rewrite this already-delivered utterance.
        game.characters.get(3)!.languageSnapshot!.knownLanguageIds.push('language_common');
    });
    for (let tick = 0; tick < 8; tick++) await Promise.resolve();
    if (!firstAborted) releaseBlockedLegacyDiary();
    await Promise.all([closing, foreground]);
    expect(sent[1]).toBe(sent[0]);
    expect(complete.mock.calls.every(call => call[6] === 'background-resumable')).toBe(true);
    expect(completed).toHaveLength(diaries ? 9 : 3);
    for (const characterId of [1, 2, 3]) {
        const rows = JSON.parse(fs.readFileSync(path.join(data, 'conversation_summaries/1', characterId + '.json'), 'utf8'));
        expect(rows).toHaveLength(1); expect(rows[0].content).toBe('A brief exchange of observable gestures.');
    }
    expect(conv.summaryFileWatcher.pauseWatcher).toHaveBeenCalledTimes(3);
    expect(conv.summaryFileWatcher.resumeWatcher).toHaveBeenCalledTimes(3);
    expect(lane.foregroundBusy).toBe(false); expect(game.aiID).toBe(originalId);
});

function echoConversation(): { conv: any; echo: Message } {
    const conv = conversation();
    for (const [id, language] of [[1, 'language_common'], [2, 'language_goblin'], [3, 'language_common']] as const) {
        game.characters.get(id)!.languageSnapshot = { version: 1, complete: true, learning: 12,
            nativeLanguageId: language, knownLanguageIds: [language] };
    }
    const arrival = character(4, 'Arrival');
    arrival.languageSnapshot = { version: 1, complete: true, learning: 12,
        nativeLanguageId: 'language_goblin', knownLanguageIds: ['language_goblin'] };
    game.characters.set(4, arrival);
    const sound = defaultLanguageEngine().renderer.forMode({ originalText: 'brother', spokenLanguageId: 'language_goblin',
        speechSpans: [{ start: 0, end: 7 }] }, 'FAR').content;
    const source: Message = { id: 'foreign-source', role: 'assistant', name: 'Speaker', characterId: 2,
        content: '**He points at the gate.** ""My brother is missing."" ~~PRIVATE_ORCHID.~~',
        proseEncoding: 'controls-v1', observedByCharacterIds: [1, 2] };
    const echo: Message = { id: 'foreign-echo', role: 'user', name: 'Player', characterId: 1,
        content: `**She points at the road.** ""What does <<${sound}>> mean?"" ~~PRIVATE_ASTER.~~`, proseEncoding: 'controls-v1' };
    conv.messages = [source, echo];
    return { conv, echo };
}

test.each([
    ['**She nods.** "Wait here." ~~She remembers "a secret".~~', ['Wait here.']],
    ['**She sets down the cloth** and **waits** before **raising her eyes**. “We have time.”', ['We have time.']]
])('ordinary quote/connector cleanup delivers the original reply with one writer request: %s', async (raw, expectedSpeech) => {
    const conv = conversation(); conv.textGenApiConnection.complete.mockResolvedValueOnce(raw);
    const message = await conv.generateNewAIMessage(game.getAi(), false);
    expect(message).toBeTruthy(); expect(conv.textGenApiConnection.complete).toHaveBeenCalledTimes(1);
    expect(parseControlledProse(message.content).segments.filter(segment => segment.kind === 'speech').map(segment => segment.text)).toEqual(expectedSpeech);
    const privateBefore = raw.match(/~~(.*?)~~/)?.[1];
    if (privateBefore) {
        expect(message.content).toContain(privateBefore);
        expect(conv.getMessagesForRecipient(3, [message])[0].content).not.toContain('secret');
    }
    expect(message.content.match(/\n/g)).toEqual(raw.match(/\n/g));
});

test.each([
    '**She points.** "What does <<UNHEARD_BETA>> mean?"',
    '{"reply":"Hello.","thought":"UNHEARD_BETA"}',
    '**She waits.** and ~~She remembers UNHEARD_BETA.~~'
])('format cleanup retains bounded recovery for unheard markers, JSON and ambiguous private joins: %s', async raw => {
    const conv = conversation(); conv.textGenApiConnection.complete.mockResolvedValueOnce(raw).mockResolvedValueOnce('**She stays silent.**');
    const message = await conv.generateNewAIMessage(game.getAi(), false);
    expect(message).toBeTruthy(); expect(conv.textGenApiConnection.complete).toHaveBeenCalledTimes(2);
    expect(message.content).not.toContain('UNHEARD_BETA'); expect(message.content).not.toContain('Hello.');
    expect(conv.getHistory().every((entry: Message) => !entry.content.includes('UNHEARD_BETA'))).toBe(true);
});

test('lazy canonical history resolves a raw imported echo without recursively rebuilding itself', () => {
    const { conv, echo } = echoConversation();
    expect(() => conv.getHistory()).not.toThrow();
    expect(echo.utterance!.echoes![0].origin!.meaning).toBe('brother');
    expect(conv.getEncounterMessagesForRecipient(4)).toHaveLength(1);
    expect(conv.getEncounterMessagesForRecipient(4)[0].content).toContain("'brother'");
});

test('a first direct recipient read materializes the earlier audible context before resolving an echo', () => {
    const { conv } = echoConversation();
    const heard = conv.getMessagesForRecipient(4);
    expect(heard).toHaveLength(1); expect(heard[0].content).toContain("'brother'");
    expect(conv.getHistory()).toHaveLength(2);
});

test('pushing an echo after raw legacy context materializes the preceding turn before recording it', () => {
    const { conv, echo } = echoConversation(); conv.messages.pop();
    conv.pushMessage(echo);
    expect(echo.utterance!.echoes![0].origin!.meaning).toBe('brother');
    expect(conv.getEncounterMessagesForRecipient(4)).toHaveLength(1);
});

test('mixed echoes reach actual writer, action, diary and summary requests with only the owner knowledge', async () => {
    const { conv } = echoConversation(); conv.getHistory();
    for (const id of [1, 3, 4]) {
        const owner = game.characters.get(id)!;
        const requests = [text(await buildChatPrompt(conv, owner)), text(buildSummarizeChatPrompt(conv, owner)),
            text(buildResummarizeChatPrompt(conv, conv.messages, id))];
        const diary = Object.assign(Object.create(DiaryGenerator.prototype), { config, votcDataPath: data,
            apiConnection: { complete: jest.fn().mockResolvedValue('An uncertain exchange.') } });
        await diary.generateDiaryEntry(game, conv, String(id));
        requests.push(JSON.stringify(diary.apiConnection.complete.mock.calls[0][0]));
        conv.actions = [{ signature: 'noop', description: 'Wait without acting.', check: () => true, args: [], run: () => '' }];
        conv.actionsApiConnection = { isChat: () => true, complete: jest.fn().mockResolvedValue('<rationale>Wait.</rationale><actions>noop()</actions>') };
        await checkActions(conv, id, 2); requests.push(JSON.stringify(conv.actionsApiConnection.complete.mock.calls[0][0]));
        for (const request of requests) {
            expect(request).not.toMatch(/PRIVATE_ORCHID|"origin"\s*:|"echoes"\s*:/);
            if (id === 4) { expect(request).toContain('brother'); expect(request).not.toContain('is missing'); }
            else expect(request).not.toMatch(/\bbrother\b/);
            if (id !== 1) expect(request).not.toContain('PRIVATE_ASTER');
        }
    }
    expect(text(buildSuggestionPrompt(conv))).not.toMatch(/brother|PRIVATE_ORCHID/);
});
test('closing a CE2 group writes the checkpoint to the player root before close events', () => {
    const conv = conversation();
    const nonce = '01234567-89ab-cdef-0123-456789abcdef';
    const command = conv.buildCloseConversationEffect(3, {
        nodeId: '17-18', parentId: '11-12', context: { checkpointToken: 23 }
    }, nonce);
    expect(command).toMatch(/^root = \{/);
    expect(command).not.toContain('talk_first_scope');
    for (const [name, value] of Object.entries({ votc_checkpoint_epoch: 3, votc_checkpoint_token: 23,
        votc_timeline_node_a: 17, votc_timeline_node_b: 18, votc_timeline_parent_a: 11, votc_timeline_parent_b: 12 }))
        expect(command).toContain(`set_variable = { name = ${name} value = ${value} }`);
    expect(command).toContain('remove_variable ?= votc_checkpoint_pending_token');
    expect(command).toContain(`VOTC:TITAN_CLOSE/;/applied/;/${nonce}`);
    expect(command.indexOf('VOTC:TITAN_CLOSE')).toBeGreaterThan(command.indexOf('votc_timeline_parent_b'));
    expect(command.indexOf('trigger_event = mcc_event_v2.9002')).toBeGreaterThan(command.indexOf('VOTC:TITAN_CLOSE'));
    expect(command).toContain('trigger_event = mcc_event_v2.9003');
});
const text = (messages: Message[]) => convertMessagesToString(messages, '', '');
test('embedding batches report actual inserts when one provider request fails', async () => {
    const conv = conversation();
    config.embeddingApiConnectionConfig = { connection: { type: 'custom', model: 'test', baseUrl: 'http://127.0.0.1', key: '' } } as any;
    conv.memoryManager = { batchInsertMemories: jest.fn(), applyDecay: jest.fn(), consolidateMemories: jest.fn() };
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const embed = jest.spyOn(EmbeddingProvider.prototype, 'embed')
        .mockResolvedValueOnce([1, 0]).mockRejectedValueOnce(new Error('Transient test failure')).mockResolvedValueOnce([0, 1]);
    const inserted = await conv.embedAndInsertMemories([
        { id: 'a', characterId: '2', text: 'First synthetic memory.' },
        { id: 'b', characterId: '2', text: 'Failed synthetic memory.' },
        { id: 'c', characterId: '3', text: 'Third synthetic memory.' }
    ]);
    expect(inserted).toBe(2); expect(embed).toHaveBeenCalledTimes(3);
    expect(conv.memoryManager.batchInsertMemories.mock.calls[0][0].map((m: any) => m.id)).toEqual(['a', 'c']);
    expect(conv.memoryManager.applyDecay.mock.calls).toEqual([['2', .01, 1, '1'], ['3', .01, 1, '1']]);
    expect(conv.memoryManager.consolidateMemories.mock.calls).toEqual([['2', .85, '1'], ['3', .85, '1']]);
});
test('empty and disabled embedding batches report zero inserts', async () => {
    const conv = conversation(); config.embeddingApiConnectionConfig = undefined as any;
    expect(await conv.embedAndInsertMemories([])).toBe(0);
    expect(await conv.embedAndInsertMemories([{ characterId: '2', text: 'Synthetic memory.' }])).toBe(0);
});
test('controlled prose reaches writer, summary, diary, actions and suggestions as knowledge while the human keeps the complete prose', async () => {
    const conv = conversation();
    conv.messages[0] = { ...conv.messages[0], proseEncoding: 'controls-v1',
        content: '**She sets down the cup,** ~~remembering the hidden opal and "old words".~~ ""Bring water to the gate before dawn.""\n\n**Her hands tremble.**' };
    expect(conv.getHistory()[0].content).toContain('hidden opal');
    expect(conv.messageForPlayer(conv.messages[0]).editableContent).toContain('~~remembering');
    expect(text(await buildChatPrompt(conv, game.characters.get(3)!))).not.toMatch(/hidden opal|old words/);
    expect(text(await buildChatPrompt(conv, game.characters.get(2)!))).toContain('hidden opal');
    expect(text(buildSummarizeChatPrompt(conv, game.getPlayer()))).not.toMatch(/hidden opal|old words/);
    expect(text(buildSummarizeChatPrompt(conv, game.characters.get(2)!))).toContain('hidden opal');
    expect(text(buildSuggestionPrompt(conv))).not.toMatch(/hidden opal|old words/);
    conv.actions = [{ signature: 'noop', description: 'Wait without acting.', check: () => true, args: [], run: () => '' }];
    conv.actionsApiConnection = { isChat: () => true, complete: jest.fn().mockResolvedValue('<rationale>Wait.</rationale><actions>noop()</actions>') };
    await checkActions(conv, 3, 2);
    expect(JSON.stringify(conv.actionsApiConnection.complete.mock.calls[0][0])).not.toMatch(/hidden opal|old words/);
    const diary = Object.assign(Object.create(DiaryGenerator.prototype), { config, votcDataPath: data,
        apiConnection: { complete: jest.fn().mockResolvedValue('I saw her trembling hands and heard unfamiliar words.') } });
    await diary.generateDiaryEntry(game, conv, '3');
    expect(JSON.stringify(diary.apiConnection.complete.mock.calls[0][0])).not.toMatch(/hidden opal|old words/);
    await diary.generateDiaryEntry(game, conv, '2');
    expect(JSON.stringify(diary.apiConnection.complete.mock.calls[1][0])).toContain('hidden opal');
});

test('rolling and closing summaries retain owned unspoken source context when the provider omits it', async () => {
    const conv = conversation(); config.enableMemoryCompaction = false;
    conv.messages[0] = { ...conv.messages[0], proseEncoding: 'controls-v1',
        content: '**She sets down the cup.** ~~She plans to hide a ruby beneath the northern bench tonight.~~ ""Bring water before dawn.""' };
    conv.summarizationApiConnection = { context: 30000, isChat: () => true, calculateTokensFromChat: () => 10,
        complete: jest.fn().mockResolvedValue('A cup was set down and words were exchanged.') };
    const closed = await conv.generateEncounterSummary(game.characters.get(2), buildSummarizeChatPrompt(conv, game.characters.get(2)!));
    expect(closed).toContain('[Private inner narration, unspoken: She plans');
    expect(closed).toContain('tonight');
    const outsider = await conv.generateEncounterSummary(game.characters.get(3), buildSummarizeChatPrompt(conv, game.characters.get(3)!));
    expect(outsider).not.toContain('ruby');
    await conv.resummarize();
    expect(conv.messages).toHaveLength(0);
    expect(conv.getCurrentSummaryForRecipient(2)).toContain('ruby beneath the northern bench tonight');
    expect(conv.getCurrentSummaryForRecipient(1)).not.toContain('ruby');
    expect(conv.getCurrentSummaryForRecipient(3)).not.toContain('ruby');
});

test('existing compacted-memory embedding input includes owned source context with its retractable identity', async () => {
    const conv = conversation(); conv.embedAndInsertMemories = jest.fn().mockResolvedValue(undefined);
    await conv.vectorizeCompactedMemories([{ id: 'owned-memory', characterIds: [2], recipientPerspectiveId: 2,
        content: 'A cup was set down.', creationTimestamp: 1, gameDate: 'date', sourceMessageIds: ['source'],
        retainedPrivateNarration: [{ sourceMessageId: 'source', content: 'She plans to hide the ruby tonight.' }] }]);
    const item = conv.embedAndInsertMemories.mock.calls[0][0][0];
    expect(item).toMatchObject({ id: 'owned-memory', characterId: '2', perspectiveOwned: true });
    expect(item.text).toContain('[Private inner narration, unspoken: She plans');
});
test('actual chat and summary builders see only their recipient view, with the same woven prose instruction', async () => {
    const conv = conversation();
    const clear = text(await buildChatPrompt(conv, game.characters.get(2)!));
    const close = text(await buildChatPrompt(conv, game.getPlayer()));
    const far = text(await buildChatPrompt(conv, game.characters.get(3)!));
    expect(clear).toContain('Bring water'); expect(close).toContain('Bring waeter');
    expect(far).not.toContain('Bring water'); expect(far).not.toContain('Bring waeter');
    expect(far).toContain('Her hands tremble'); expect(far).toContain('full emotional depth and natural paragraphs');
    expect(JSON.stringify(await buildChatPrompt(conv, game.characters.get(3)!))).not.toContain('originalText');
    expect(text(buildSummarizeChatPrompt(conv, game.characters.get(3)!))).not.toContain('Bring water');
    expect(text(buildSummarizeChatPrompt(conv, game.characters.get(2)!))).toContain('Bring water');
    game.aiID = 3; expect(text(buildResummarizeChatPrompt(conv, conv.messages))).not.toContain('Bring water');
});
test('actual action inference and diaries use the acting character view', async () => {
    const conv = conversation();
    conv.actions = [{ signature: 'noop', description: 'Wait without acting.', check: () => true, args: [], run: () => '' }];
    conv.actionsApiConnection = { isChat: () => true, complete: jest.fn().mockResolvedValue('<rationale>Wait.</rationale><actions>noop()</actions>') };
    await checkActions(conv, 3, 2);
    const actionPrompt = JSON.stringify(conv.actionsApiConnection.complete.mock.calls[0][0]);
    expect(actionPrompt).not.toContain('Bring water'); expect(actionPrompt).toContain('Her hands tremble');
    const diary = Object.assign(Object.create(DiaryGenerator.prototype), { config, votcDataPath: data,
        apiConnection: { complete: jest.fn().mockResolvedValue('I heard unfamiliar words and saw her hands tremble.') } });
    await diary.generateDiaryEntry(game, conv, '3');
    expect(JSON.stringify(diary.apiConnection.complete.mock.calls[0][0])).not.toContain('Bring water');
});

test('group writer roles belong to the current actor while AI-to-AI targeting keeps the actual last speaker', async () => {
    const conv = conversation();
    conv.messages.push({ id: 'other-npc', role: 'assistant', name: 'Outsider', characterId: 3,
        content: '*Outsider sets down a cup.* "I am still here."' });
    const original = JSON.stringify(conv.messages);
    const reply = await buildChatPrompt(conv, game.getAi());
    expect(reply.find(message => message.id === 'source')?.role).toBe('assistant');
    expect(reply.find(message => message.id === 'other-npc')?.role).toBe('user');
    expect(reply.find(message => message.id === 'other-npc')?.name).toBe('Outsider');
    expect(text(reply)).toContain('Write a reply to Outsider');
    // Recording hearings is permitted; provider role adaptation never changes canonical authorship.
    expect(conv.messages.map((message: Message) => message.role)).toEqual(['assistant', 'assistant']);
    const recorded = JSON.stringify(conv.messages);
    const other = await buildChatPrompt(conv, game.characters.get(3)!);
    expect(other.find(message => message.id === 'source')?.role).toBe('user');
    expect(other.find(message => message.id === 'other-npc')?.role).toBe('assistant');
    expect(JSON.stringify(conv.messages)).toBe(recorded);
    expect(original).toContain('"characterId":3');
});
test('trait-example scripts receive the actual speaker and target instead of the lead NPC', async () => {
    const conv = conversation(), owner = game.characters.get(3)!;
    write('scripts/prompts/example messages/standard/actor.js', 'module.exports = game => [{role:"user",name:game.getPlayer().shortName,content:"Tell me about yourself."},{role:"assistant",name:game.getAi().shortName,content:`Priming ${game.getAi().fullName}: ${game.getAi().traits.map(t=>t.name).join(", ")}.`}];');
    config.selectedExMsgScript = 'actor.js'; owner.traits = [{ category: 'personality', name: 'Patient', desc: 'Waits calmly.' }];
    game.getAi().traits = [{ category: 'personality', name: 'Wrathful', desc: 'Quick anger.' }];
    const original = { aiID: game.aiID, playerID: game.playerID, aiName: game.aiName, playerName: game.playerName };
    const prompt = await buildChatPrompt(conv, owner, undefined, game.getAi());
    expect(prompt.find(message => message.content.startsWith('Priming'))).toMatchObject({ name: 'Outsider', content: 'Priming Outsider: Patient.' });
    expect(prompt.find(message => message.content === 'Tell me about yourself.')).toMatchObject({ name: 'Speaker' });
    expect(text(prompt)).not.toContain('Priming Speaker: Wrathful');
    expect({ aiID: game.aiID, playerID: game.playerID, aiName: game.aiName, playerName: game.playerName }).toEqual(original);
});

test('foreign perception is explicit in writer, diary, summary and action requests without changing the heard ledger', async () => {
    const conv = conversation();
    const heard = conv.getMessagesForRecipient(3);
    const before = JSON.stringify(conv.getEncounterMessagesForRecipient(3));
    const writer = text(await buildChatPrompt(conv, game.characters.get(3)!));
    expect(writer).toContain('Speech in this turn is unintelligible to this listener');
    expect(writer).toContain('Its meaning is unknown; do not translate it');
    expect(writer).toContain('Spoken language: Common.');
    const close = text(await buildChatPrompt(conv, game.getPlayer()));
    expect(close).toContain('only partly intelligible');
    expect(text(await buildChatPrompt(conv, game.getAi()))).not.toContain('[Language perception:');
    expect(text(buildSummarizeChatPrompt(conv, game.characters.get(3)!))).toContain('unintelligible to this listener');
    const diary = Object.assign(Object.create(DiaryGenerator.prototype), { config, votcDataPath: data,
        apiConnection: { complete: jest.fn().mockResolvedValue('Her words remained unknown to me.') } });
    await diary.generateDiaryEntry(game, conv, '3');
    const diaryRequest = JSON.stringify(diary.apiConnection.complete.mock.calls[0][0]);
    expect(diaryRequest).toContain('unintelligible to this listener');
    expect(diaryRequest).toContain("This is Outsider's record of the exchange");
    expect(JSON.stringify(conv.getEncounterMessagesForRecipient(3))).toBe(before);
    expect(heard[0].content).not.toContain('[Language perception:');
    conv.actions = [{ signature: 'noop', description: 'Wait without acting.', check: () => true, args: [], run: () => '' }];
    conv.actionsApiConnection = { isChat: () => true, complete: jest.fn().mockResolvedValue('<rationale>Wait.</rationale><actions>noop()</actions>') };
    await checkActions(conv, 3, 2);
    expect(JSON.stringify(conv.actionsApiConnection.complete.mock.calls[0][0])).toContain('unintelligible to this listener');
});

test('perception notes bind to their recorded listener and preserve understood turns and silent actions', () => {
    const conv = conversation();
    const foreign = conv.getMessagesForRecipient(3)[0];
    expect(() => promptPerceptionMessages([foreign], 1)).toThrow("another listener's perception");
    const clear = conv.getMessagesForRecipient(2)[0];
    expect(promptPerceptionMessages([clear], 2)[0]).toEqual(clear);
    const silent: Message = { ...foreign, content: '*She points toward the gate and waits.*' };
    expect(promptPerceptionMessages([silent], 3)[0]).toEqual(silent);
    const plainPlayer: Message = { ...foreign, role: 'user', content: 'Rak grog rurgrun groth grartoth' };
    expect(promptPerceptionMessages([plainPlayer], 3)[0].content).toContain('unintelligible to this listener');
});

test('the actual writer sees complete fluency and its frozen speaking choice without inventing a common tongue', async () => {
    const conv = conversation(), actor = game.characters.get(3)!;
    actor.languageSnapshot!.knownLanguageIds = ['language_orcish', 'language_eredun'];
    game.getPlayer().languageSnapshot!.knownLanguageIds = ['language_low_common', 'language_eredun'];
    conv.messages.push({ id: 'latest-player', role: 'user', name: 'Player', content: '"Please answer me."' });
    const shared = text(await buildChatPrompt(conv, actor));
    expect(shared).toContain('Native language: Orcish. Fluent languages: Orcish, Eredun.');
    expect(shared).toContain('Spoken language for this reply: Eredun.');
    expect(shared).toContain('Do not invent a translation, interpreter or translating device');
    expect(shared).toContain('Write narration and all spoken words in English, preserving proper names');
    expect(shared).toContain('do not invent syllables for the native tongue');
    // A toggle change while the already-planned turn awaits its prompt cannot change that turn's instruction.
    config.languageRoutingEnabled = false;
    const frozen = text(await buildChatPrompt(conv, actor, undefined, game.getPlayer(), false, 'language_orcish'));
    expect(frozen).toContain('Spoken language for this reply: Orcish.');
    const disabled = text(await buildChatPrompt(conv, actor));
    expect(disabled).not.toContain('[Language knowledge for');
    await expect(buildChatPrompt(conv, actor, undefined, undefined, false, 'language_common')).rejects.toThrow('does not know');
});

test('memory transcript labels chronology and represents unknown speech without decoding it or changing any ledger view', () => {
    const conv = conversation(), foreign = conv.getMessagesForRecipient(3);
    const before = JSON.stringify(conv.getEncounterMessagesForRecipient(3));
    const memory = perceivedMemoryTranscript(foreign, 3);
    expect(memory).toContain('[Turn 1; speaker: Speaker]');
    expect(memory).toContain('another participant authored this turn');
    expect(memory).toContain('[Unintelligible Common speech.]');
    expect(memory).toContain('Her hands tremble');
    expect(memory).not.toContain(foreign[0].content.slice(foreign[0].content.indexOf('"')));
    expect(memory).not.toContain('Bring water');
    expect(perceivedMemoryTranscript(conv.getMessagesForRecipient(2), 2)).toContain('Bring water');
    expect(perceivedMemoryTranscript(conv.getMessagesForRecipient(2), 2)).toContain('the owner authored this turn');
    expect(perceivedMemoryTranscript(conv.getMessagesForRecipient(1), 1)).toContain('Bring waeter');
    expect(JSON.stringify(conv.getEncounterMessagesForRecipient(3))).toBe(before);
    expect(() => perceivedMemoryTranscript(foreign, 1)).toThrow("another listener's perception");
});

test('summary and diary guidance retain owned interior narration but exclude other people\'s undisclosed inner states', async () => {
    const conv = conversation();
    const summary = text(buildSummarizeChatPrompt(conv, game.characters.get(3)!));
    expect(summary).toContain('The owner authored no turns in this record');
    expect(summary).toContain('The owner may record their own inner narration');
    expect(summary).toContain('A private intention is not an action already taken');
    expect(summary).toContain('are private narration, not disclosures');
    expect(summary).toContain('preserving the beginning and ending');
    const diary = Object.assign(Object.create(DiaryGenerator.prototype), { config, votcDataPath: data,
        apiConnection: { complete: jest.fn().mockResolvedValue('I heard unknown words and saw her trembling hands.') } });
    await diary.generateDiaryEntry(game, conv, '3');
    const request = JSON.stringify(diary.apiConnection.complete.mock.calls[0][0]);
    expect(request).toContain('[Unintelligible Common speech.]');
    expect(request).toContain('are private narration, not disclosures');
    expect(request).toContain("Reflect in the owner's own voice");
    expect(request).not.toContain('leave unstated reactions undecided');
});

test('validation recovery keeps the full roleplay builder, cached backgrounds and player portrayal', async () => {
    const conv = conversation();
    const culture = jest.requireMock('../../src/main/culture/cultureRuntime');
    const faith = jest.requireMock('../../src/main/faith/faithRuntime');
    culture.getCultureBackground.mockReturnValue('Cached cultural reference: careful craft and shared hospitality.');
    culture.formatCultureBackground.mockImplementation((_actor: unknown, paragraph: string) => 'Cultural background:\n' + paragraph);
    faith.getFaithBackground.mockReturnValue('Cached religious reference: mercy and a duty to protect the helpless.');
    faith.getFaithZealous.mockReturnValue(true);
    write('character_descriptions/1.json', JSON.stringify({ '3': 'I refuse needless cruelty even when my community approves it.' }));
    try {
        const result = await conv.generateMessageWithValidationPrompt(game.characters.get(3)!);
        expect(result).toBeTruthy();
        const request = text(conv.textGenApiConnection.complete.mock.calls[0][0]);
        expect(request).toContain('A quiet room with a table.');
        expect(request).toContain('Cached cultural reference: careful craft and shared hospitality.');
        expect(request).toContain('Cached religious reference: mercy and a duty to protect the helpless.');
        expect(request).toContain('Faith emphasis for this Zealous character');
        expect(request).toContain('I refuse needless cruelty even when my community approves it.');
        expect(request).toContain('Its meaning is unknown; do not translate it');
        expect(request).toContain('Fluent languages: Orcish.');
        expect(request).not.toContain('Bring water');
    } finally {
        culture.getCultureBackground.mockReset(); culture.formatCultureBackground.mockReset();
        faith.getFaithBackground.mockReset(); faith.getFaithZealous.mockReset();
    }
});

test('diary and letter diary retain the actual owner persona, cached backgrounds and scoped player portrayal', async () => {
    const conv = conversation(), owner = game.characters.get(3)!;
    const culture = jest.requireMock('../../src/main/culture/cultureRuntime');
    const faith = jest.requireMock('../../src/main/faith/faithRuntime');
    culture.getCultureBackground.mockImplementation((actor: any) => `Culture for ${actor.fullName}.`);
    culture.formatCultureBackground.mockImplementation((_actor: unknown, paragraph: string) => paragraph);
    faith.getFaithBackground.mockImplementation((actor: any) => `Faith for ${actor.fullName}.`);
    faith.getFaithZealous.mockReturnValue(true);
    write('scripts/prompts/description/person.js', 'module.exports = (game, person) => `Selected persona for ${game.getAi().fullName}; explicit owner ${person.fullName}.`;');
    write('character_descriptions/1.json', JSON.stringify({ '2': 'Another person description.', '3': 'I refuse needless cruelty.' }));
    const diary = Object.assign(Object.create(DiaryGenerator.prototype), { config, votcDataPath: data,
        apiConnection: { complete: jest.fn().mockResolvedValue('I heard unfamiliar speech.') } });
    const original = { aiID: game.aiID, aiName: game.aiName, playerID: game.playerID, characters: game.characters };
    try {
        await diary.generateDiaryEntry(game, conv, '3');
        await diary.generateDiaryEntryForLetter(game, owner, 'A letter I received.', 'received');
        for (const [prompt] of diary.apiConnection.complete.mock.calls) {
            const request = text(prompt);
            expect(request).toContain('Selected persona for Outsider; explicit owner Outsider.');
            expect(request).toContain('Culture for Outsider.'); expect(request).toContain('Faith for Outsider.');
            expect(request).toContain('Faith emphasis for this Zealous character');
            expect(request).toContain('I refuse needless cruelty.'); expect(request).not.toContain('Another person description.');
            expect(request.indexOf('I refuse needless cruelty.')).toBeGreaterThan(request.indexOf('Faith emphasis'));
        }
        expect({ aiID: game.aiID, aiName: game.aiName, playerID: game.playerID, characters: game.characters }).toEqual(original);
        expect(game.characters).toBe(original.characters);
        diary.apiConnection.complete.mockClear(); config.cultureRoleplayEnabled = false; config.faithRoleplayEnabled = false;
        await diary.generateDiaryEntry(game, conv, '3');
        const disabled = text(diary.apiConnection.complete.mock.calls[0][0]);
        expect(disabled).not.toContain('Culture for'); expect(disabled).not.toContain('Faith for');
        expect(disabled).toContain('Selected persona for Outsider'); expect(disabled).toContain('I refuse needless cruelty.');
    } finally {
        culture.getCultureBackground.mockReset(); culture.formatCultureBackground.mockReset();
        faith.getFaithBackground.mockReset(); faith.getFaithZealous.mockReset();
    }
});

test('action inference scopes the selected persona and knowledge to the actual acting NPC without changing live IDs', async () => {
    const conv = conversation();
    write('scripts/prompts/description/person.js', 'module.exports = (game, person) => `Selected persona for ${game.getAi().fullName}; explicit owner ${person.fullName}.`;');
    conv.actions = [{ signature: 'noop', description: 'Wait without acting.', check: () => true, args: [], run: () => '' }];
    conv.actionsApiConnection = { isChat: () => true, complete: jest.fn().mockResolvedValue('<rationale>Wait.</rationale><actions>noop()</actions>') };
    const original = { aiID: game.aiID, aiName: game.aiName, playerID: game.playerID };
    await checkActions(conv, 3, 2);
    const request = text(conv.actionsApiConnection.complete.mock.calls[0][0]);
    expect(request).toContain('Selected persona for Outsider; explicit owner Outsider.');
    expect(request).not.toContain('Selected persona for Speaker');
    expect(request).toContain('Read the exchange as Outsider');
    expect(request).toContain('not disclosures');
    expect({ aiID: game.aiID, aiName: game.aiName, playerID: game.playerID }).toEqual(original);
});

test('group summary templates cover the complete observed party without changing game identity or authored style', () => {
    const conv = conversation();
    const original = { aiName: game.aiName, aiID: game.aiID, playerID: game.playerID };
    for (const owner of [1, 2, 3]) {
        const final = text(buildSummarizeChatPrompt(conv, game.characters.get(owner)!));
        expect(final).toContain('between Speaker and Outsider (the assistant) and Player (the user)');
        expect(final).toContain('single paragraph');
    }
    const rolling = text(buildResummarizeChatPrompt(conv, conv.messages, 3));
    expect(rolling).toContain('between Speaker and Outsider (the assistant) and Player (the user)');
    expect({ aiName: game.aiName, aiID: game.aiID, playerID: game.playerID }).toEqual(original);
});

test('summary participant scope includes observed departures but excludes people a late arrival never met', () => {
    const conv = conversation();conv.messages[0].observedByCharacterIds = [1, 2];conv.getHistory();
    game.characters.delete(2);
    const arrival = character(4, 'Later');arrival.languageSnapshot = game.getPlayer().languageSnapshot;game.characters.set(4, arrival);
    conv.pushMessage({ id: 'later', role: 'user', name: 'Player', content: '"I am here."', observedByCharacterIds: [1, 4] });
    expect(conv.getEncounterParticipantsForRecipient(1).map((c: { id: number }) => c.id)).toEqual([1, 2, 4]);
    expect(conv.getEncounterParticipantsForRecipient(4).map((c: { id: number }) => c.id)).toEqual([1, 4]);
    const oldOwner = text(buildSummarizeChatPrompt(conv, game.getPlayer()));
    expect(oldOwner).toContain('between Speaker and Later (the assistant) and Player (the user)');
    const newOwner = text(buildSummarizeChatPrompt(conv, arrival));
    expect(newOwner).toContain('between Later (the assistant) and Player (the user)');
    expect(newOwner).not.toContain('Speaker');
    expect(newOwner).not.toContain('Outsider');
});
test('diary attendance records only participants encountered by its owner, including departures', async () => {
    const conv = conversation(); conv.messages[0].observedByCharacterIds = [1, 2]; conv.getHistory();
    const departed = game.getAi(); game.characters.delete(2);
    const arrival = character(4, 'Later'); arrival.languageSnapshot = game.getPlayer().languageSnapshot; game.characters.set(4, arrival);
    conv.pushMessage({ id: 'later', role: 'user', name: 'Player', content: '"I am here."', observedByCharacterIds: [1, 4] });
    const diary = Object.assign(Object.create(DiaryGenerator.prototype), { config, votcDataPath: data,
        apiConnection: { complete: jest.fn().mockResolvedValue('A personal reflection.') } });
    write('scripts/prompts/description/person.js', 'module.exports = game => `Observed people: ${[...game.characters.values()].map(c=>c.fullName).join(", ")}.`;');
    const oldEntry = await diary.generateDiaryEntry(game, conv, String(departed.id));
    const newEntry = await diary.generateDiaryEntry(game, conv, '4');
    expect(oldEntry.participants.sort()).toEqual(['1', '2']);
    expect(newEntry.participants.sort()).toEqual(['1', '4']);
    const request = text(diary.apiConnection.complete.mock.calls[1][0]);
    expect(request).not.toContain('Bring water'); expect(request).not.toContain('Speaker');
    expect(request).not.toContain('Outsider'); expect(request).toContain('Observed people: Player, Later.');
});
test('player suggestions and narrative cannot recover a translation from NPC summaries or memories', async () => {
    const conv = conversation(); game.getPlayer().languageSnapshot = game.characters.get(3)!.languageSnapshot;
    game.getAi().memories = [{ creationDate: '1066.9.15', desc: 'Bring water to the gate before dawn.', relevanceWeight: 10 }] as any;
    conv.getBranchVisibleSummaries = (id: number) => id === 2 ? [{ date: '1066.9.15', content: 'Bring water to the gate before dawn.' }] : [];
    const suggestions = text(buildSuggestionPrompt(conv)); expect(suggestions).not.toContain('Bring water');
    conv.actionsApiConnection = { isChat: () => true, complete: jest.fn().mockResolvedValue('She waits.') };
    await generateNarrative(conv, [{ actionName: 'wait()', chatMessage: 'She waits.', chatMessageClass: 'neutral' }]);
    expect(JSON.stringify(conv.actionsApiConnection.complete.mock.calls[0][0])).not.toContain('Bring water');
});
test('foreign speech never streams readable source chunks to the overlay', async () => {
    const conv = conversation(); conv.messages = []; config.stream = true;
    game.getPlayer().languageSnapshot = game.characters.get(3)!.languageSnapshot;
    await conv.generateNewAIMessage(game.getAi());
    expect(conv.textGenApiConnection.complete.mock.calls[0][1]).toBe(false);
    const calls = conv.chatWindow.window.webContents.send.mock.calls;
    expect(calls.some((c: unknown[]) => c[0] === 'stream-start' || c[0] === 'stream-message')).toBe(false);
    const delivered = calls.find((c: unknown[]) => c[0] === 'message-receive')[1];
    expect(delivered.content).not.toContain('Bring water'); expect(delivered.utterance).toBeUndefined();
});
test('CLEAR controlled generation retains one writer call and delivers only cleaned complete prose', async () => {
    const conv = conversation(); conv.messages = []; config.stream = true;
    game.getPlayer().languageSnapshot = game.getAi().languageSnapshot;
    await conv.generateNewAIMessage(game.getAi());
    expect(conv.textGenApiConnection.complete.mock.calls[0][1]).toBe(false);
    expect(conv.textGenApiConnection.complete).toHaveBeenCalledTimes(1);
    const final = conv.chatWindow.window.webContents.send.mock.calls.find((c: unknown[]) => c[0] === 'message-receive')[1];
    expect(final.content).toContain('Bring water');
    expect(final.content).not.toContain('""'); expect(final.proseEncoding).toBeUndefined();
});
test('the actual writer chooses the closest known tongue and pins its addressee with one ordinary provider call', async () => {
    const conv = conversation(); conv.messages = [];
    const relations = defaultLanguageEngine().relations;
    const contact = relations.cultureRules.find(rule => rule.culture_roots.includes('darkspear') && rule.targets.includes('language_orcish'))!;
    game.getPlayer().languageSnapshot = { version: 1, complete: true, learning: 20,
        nativeLanguageId: 'language_zandali', knownLanguageIds: ['language_zandali'],
        cultureFamiliarity: { version: 1, complete: true, routingVersion: relations.version, matchedRuleIds: [contact.id] } };
    game.getAi().languageSnapshot = { version: 1, complete: true, learning: 30,
        nativeLanguageId: 'language_common', knownLanguageIds: ['language_common', 'language_orcish'] };
    game.characters.get(3)!.languageSnapshot!.learning = 10;
    const message = await conv.generateNewAIMessage(game.getAi(), false);
    expect(conv.textGenApiConnection.complete).toHaveBeenCalledTimes(1);
    expect(message.spokenLanguageId).toBe('language_orcish'); expect(message.targetCharacterIds).toEqual([1]);
    expect(text(conv.textGenApiConnection.complete.mock.calls[0][0])).toContain('Spoken language for this reply: Orcish.');
    expect(message.languageRecord.hearings['1'].plan.belt).toBe('recognition');
    expect(conv.getMessagesForRecipient(2, [message])[0].content).toBe(source);
});
test('malformed, token-limited and wholly coded-looking source replies get one full-context recovery and only the complete turn is stored', async () => {
    for (const failure of ['syntax', 'length', 'source-language']) {
        const conv = conversation(); conv.messages = [];
        game.getPlayer().languageSnapshot!.learning = 20;
        game.getAi().languageSnapshot!.learning = 20;
        conv.textGenApiConnection.complete.mockImplementation(async (...args: any[]) => {
            const first = conv.textGenApiConnection.complete.mock.calls.length === 1;
            args[7]?.({ finishReason: first && failure === 'length' ? 'length' : 'stop' });
            if (first && failure === 'source-language') return '""Grog maen durkhaal. Thok grog maen veil dur. Maen grokha rir thok dur.""';
            return first && failure === 'syntax' ? '**An incomplete action' : controlledSource;
        });
        const message = await conv.generateNewAIMessage(game.getAi(), false); conv.pushMessage(message);
        expect(conv.textGenApiConnection.complete).toHaveBeenCalledTimes(2);
        const repair = text(conv.textGenApiConnection.complete.mock.calls[1][0]);
        expect(repair).toContain('A quiet room with a table.'); expect(repair).toContain(CONTROLLED_WRITER_INSTRUCTION);
        expect(repair).toContain('established speaker, addressee, full persona');
        if (failure === 'length') expect(repair).toContain('reached its response limit');
        if (failure === 'source-language') expect(repair).toContain('copied foreign sound tokens');
        expect(conv.getHistory()).toHaveLength(1);
        expect(conv.getHistory()[0].content).toContain('She sets down the cup.');
        expect(conv.getHistory()[0].comprehensionMode).toBe('CLOSE');
        expect(conv.getMessagesForRecipient(2)[0].content).toBe(source);
        expect(JSON.stringify(conv.getHistory())).not.toContain('An incomplete action');
    }
});
test('two failed controlled replies hold without publishing a fragment or starting a third request', async () => {
    const conv = conversation(); conv.messages = []; conv.textGenApiConnection.complete.mockResolvedValue('~~unfinished');
    expect(await conv.generateNewAIMessage(game.getAi())).toBeNull();
    expect(conv.textGenApiConnection.complete).toHaveBeenCalledTimes(2); expect(conv.getHistory()).toEqual([]);
    expect(conv.chatWindow.window.webContents.send.mock.calls.some((c: unknown[]) => ['message-receive', 'stream-message'].includes(c[0] as string))).toBe(false);
});
test('recovery retains reserved hearing after a toggle and fluency change during the failed attempt', async () => {
    const conv = conversation(); conv.messages = [];
    game.getPlayer().languageSnapshot = game.characters.get(3)!.languageSnapshot;
    conv.textGenApiConnection.complete.mockImplementation(async () => {
        if (conv.textGenApiConnection.complete.mock.calls.length === 1) {
            config.languageRoutingEnabled = false; game.getPlayer().languageSnapshot!.knownLanguageIds.push('language_common');
            return '**unfinished';
        }
        return controlledSource;
    });
    const message = await conv.generateNewAIMessage(game.getAi(), false);
    expect(message.languageRecord.hearings['1'].mode).toBe('FAR');
    expect(conv.messageForPlayer(message).content).not.toContain('Bring water');
    expect(text(conv.textGenApiConnection.complete.mock.calls[1][0])).toContain(CONTROLLED_WRITER_INSTRUCTION);
});
test('a late controlled completion cannot publish to a closed encounter', async () => {
    const conv = conversation(); conv.messages = [];
    conv.textGenApiConnection.complete.mockImplementation(async () => { conv.isOpen = false; return controlledSource; });
    expect(await conv.generateNewAIMessage(game.getAi())).toBeNull();
    expect(conv.chatWindow.window.webContents.send.mock.calls.some((c: unknown[]) => c[0] === 'message-receive')).toBe(false);
});
test('retiring a replaced encounter retains its canonical checkpoint and invalidates pending work without a game effect', () => {
    const conv = conversation(); conv.isOpen = true;
    conv.cancelBackgroundPreparation = jest.fn();
    conv.runFileManager = { write: jest.fn(), append: jest.fn() };
    conv.memoryCompactor = { cleanup: jest.fn(), getCompactedMemories: () => [] };
    const revision = conv.getEncounterRevision(), before = conv.getHistory()[0].content;
    conv.retireWithoutGame();
    expect(conv.isOpen).toBe(false); expect(conv.getEncounterRevision()).toBeGreaterThan(revision);
    expect(conv.getHistory()[0].content).toBe(before);
    expect(conv.cancelBackgroundPreparation).toHaveBeenCalledTimes(1);
    expect(conv.memoryCompactor.cleanup).toHaveBeenCalledTimes(1);
    expect(conv.runFileManager.write).not.toHaveBeenCalled(); expect(conv.runFileManager.append).not.toHaveBeenCalled();
    const files = fs.readdirSync(path.join(data, 'conversation_history', String(game.playerID), '.language-ledgers'));
    expect(files.some(name => name.endsWith('.json'))).toBe(true);
});
test('explicit player controls preserve inner prose and silence without sharing a secret or producing empty model input', () => {
    const conv = conversation(); conv.messages = [];
    conv.pushMessage({ role: 'user', name: 'Player', content: '~~I hide my fear of the hidden ruby.~~' });
    expect(conv.getHistory()[0].content).toContain('hidden ruby');
    const knowledge = conv.getMessagesForRecipient(2)[0];
    expect(knowledge.content).not.toContain('ruby'); expect(knowledge.content).toContain('No spoken words');
    expect(conv.getMessagesForRecipient(1)[0].content).toContain('hidden ruby');
});
test.each(['Bring water before dawn.', 'He nods. "Bring water before dawn."\n\n*His hands tremble.*'])(
    'actual player ingress and outgoing prompts respect casual/formatted speech: %s', async content => {
        const conv = conversation(); conv.messages = [];
        conv.pushMessage({ role: 'user', name: 'Player', content });
        expect(conv.getHistory()[0].content).toBe(content);
        const far = conv.getMessagesForRecipient(3)[0];
        expect(far.content).not.toContain('Bring water before dawn.');
        if (content.includes('He nods.')) {
            expect(far.content).toContain('He nods.'); expect(far.content).toContain('*His hands tremble.*');
        }
        const prompt = await buildChatPrompt(conv, game.characters.get(3)!);
        expect(text(prompt)).not.toContain('Bring water before dawn.');
        if (content.includes('He nods.')) expect(text(prompt)).toContain('He nods.');
        const directory = path.join(data, 'conversation_history', '1', '.language-ledgers');
        const stored = JSON.parse(fs.readFileSync(path.join(directory, fs.readdirSync(directory)[0]), 'utf8'));
        const hearing = stored.messages[0].languageRecord.hearings['3'];
        expect(stored.messages[0].languageRecord.variants[hearing.variant]).toBe(far.content);
    });
test('AI-to-AI generation pins its explicit target language before broadcast rendering', async () => {
    const conv = conversation(); game.getAi().languageSnapshot!.knownLanguageIds.push('language_orcish');
    const generated = await conv.generateAiToAiMessage(game.getAi(), game.characters.get(3)!);
    expect(generated.characterId).toBe(2); expect(generated.spokenLanguageId).toBe('language_orcish');
    conv.pushMessage(generated);
    expect(conv.getMessagesForRecipient(3).at(-1).content).toContain('Bring water');
    expect(conv.messageForPlayer(generated).content).not.toContain('Bring water');
});
test('actual history writer stores one canonical record and perspective indexes', () => {
    const conv = conversation(); game.getPlayer().languageSnapshot = game.characters.get(3)!.languageSnapshot;
    conv._saveHistoryToFile({ timelineNodeId: 'node-test' });
    const directory = path.join(data, 'conversation_history', '1');
    const name = fs.readdirSync(directory).find(name => name.endsWith('.txt'))!;
    expect(name).toContain('_tl_node-test_'); expect(fs.readFileSync(path.join(directory, name), 'utf8')).not.toContain('Bring water');
    const sidecar = JSON.parse(fs.readFileSync(path.join(directory, '.recipient-views', name.replace(/\.txt$/, '.json')), 'utf8'));
    expect(loadLedgerHistory(directory, name.replace(/\.txt$/, ''), 1)!.messages[0].content).not.toContain('Bring water');
    expect(loadLedgerHistory(directory, name.replace(/\.txt$/, ''), 2)!.messages[0].content).toContain('Bring water');
    expect(JSON.stringify(sidecar)).not.toContain('originalText');
});
test('rolling resummarization preserves full provider summaries for every distinct hearing perspective', async () => {
    const conv = conversation(); conv.getMessagesForRecipient(3);
    config.enableMemoryCompaction = false; config.percentOfContextToSummarize = 1;
    conv.summarizationApiConnection = { isChat: () => true, complete: jest.fn().mockImplementation(async (prompt) => JSON.stringify(prompt).includes('Bring water') ? 'Speaker asked for water at the gate before dawn.' : JSON.stringify(prompt).includes('Bring waeter') ? 'I heard familiar-sounding words and saw her hands tremble.' : 'I heard foreign speech and saw her hands tremble.') };
    await conv.resummarize();
    expect(conv.summarizationApiConnection.complete).toHaveBeenCalledTimes(3);
    expect(conv.getCurrentSummaryForRecipient(2)).toContain('asked for water');
    expect(conv.getCurrentSummaryForRecipient(3)).not.toContain('asked for water');
    expect(conv.getCurrentSummaryForRecipient(3)).toContain('her hands tremble');
    expect(conv.getHistory()).toHaveLength(1);
    expect(conv.messages).toHaveLength(0);
});
test('editing a heard CLOSE view changes only that perception and never reencodes it as source speech', () => {
    const conv = conversation(); conv.getHistory();
    conv.editMessage('source', '*I noticed a different gesture.* "Edited heard spelling."');
    expect(conv.getHistory()[0].content).toContain('Edited heard spelling');
    expect(conv.getMessagesForRecipient(2)[0].content).toBe(source);
    expect(conv.getMessagesForRecipient(3)[0].content).not.toContain('Edited heard spelling');
    expect(conv.messages[0].utterance.originalText).toBe(source);
});
test('editing CLEAR source speech rerenders other listeners from the revised source', () => {
    const conv = conversation(); game.getPlayer().languageSnapshot = game.getAi().languageSnapshot;
    conv.getHistory(); conv.editMessage('source', '*She waits.* "Water before dawn."');
    expect(conv.getHistory()[0].content).toBe('*She waits.* "Water before dawn."');
    expect(conv.getMessagesForRecipient(3)[0].content).not.toContain('Water before dawn');
    expect(conv.messages[0].utterance.spokenLanguageId).toBe('language_common');
});

test('cultural-only CLOSE reaches actual recipient prompt and summary before any model call', async () => {
    const conv = conversation();
    game.getAi().languageSnapshot = { version:1,complete:true,nativeLanguageId:'language_dwarven',knownLanguageIds:['language_dwarven'] };
    game.getPlayer().languageSnapshot = { version:1,complete:true,nativeLanguageId:'language_gnomish',knownLanguageIds:['language_gnomish'],
        cultureFamiliarity:{version:1,complete:true,routingVersion:'titan-current-familiarity-r4',matchedRuleIds:['eastern_kingdoms_common_contacts']} };
    const prompt = JSON.stringify(await buildChatPrompt(conv, game.getPlayer()));
    expect(prompt).toContain('Brung waterum'); expect(prompt).not.toContain('Bring water');
    expect(prompt).not.toContain('eastern_kingdoms_common_contacts'); expect(prompt).not.toContain('originalText');
    expect(text(buildSummarizeChatPrompt(conv,game.getPlayer()))).toContain('Brung waterum');
    expect(conv.textGenApiConnection.complete).not.toHaveBeenCalled();
});

test.each([.5, 1])('studied speech reaches writer/action/diary/summary inputs without private source or study metadata (progress %s)', async progress => {
    const conv = conversation(), owner = game.characters.get(3)!;
    for (const c of game.characters.values()) c.languageSnapshot!.learning = 10;
    owner.languageSnapshot!.studyProgress = { language_common: progress };
    conv.messages[0] = { ...conv.messages[0], content: controlledSource + ' ~~PRIVATE_STUDY_IRIS.~~', proseEncoding: 'controls-v1' };
    const heard = conv.getMessagesForRecipient(3)[0];
    expect(heard.comprehensionMode).toBe('CLOSE'); expect(heard.speechComprehension).toBe('partial');
    const requests = [text(await buildChatPrompt(conv, owner)), text(buildSummarizeChatPrompt(conv, owner)),
        text(buildResummarizeChatPrompt(conv, conv.messages, 3))];
    const diary = Object.assign(Object.create(DiaryGenerator.prototype), { config, votcDataPath: data,
        apiConnection: { complete: jest.fn().mockResolvedValue('An uncertain exchange.') } });
    await diary.generateDiaryEntry(game, conv, '3'); requests.push(JSON.stringify(diary.apiConnection.complete.mock.calls[0][0]));
    conv.actions = [{ signature: 'noop', description: 'Wait without acting.', check: () => true, args: [], run: () => '' }];
    conv.actionsApiConnection = { isChat: () => true, complete: jest.fn().mockResolvedValue('<rationale>Wait.</rationale><actions>noop()</actions>') };
    await checkActions(conv, 3, 2); requests.push(JSON.stringify(conv.actionsApiConnection.complete.mock.calls[0][0]));
    for (const request of requests) {
        expect(request).not.toMatch(/PRIVATE_STUDY_IRIS|originalText|studyProgress|"observations"\s*:|mask-learning|"assistance"\s*:/);
        expect(request).not.toContain('Bring water to the gate before dawn.');
    }
    expect(requests[0]).toContain(heard.content);
});

test('switching off restores unfiltered prompts and streaming even with existing captured language knowledge', async () => {
    config.languageRoutingEnabled = false; config.stream = true;
    const conv = conversation();
    const prompt = text(await buildChatPrompt(conv, game.characters.get(3)!));
    expect(prompt).toContain('Bring water'); expect(prompt).not.toContain(SPEECH_WRITER_INSTRUCTION);
    expect(conv.messages[0].utterance).toBeUndefined();
    expect(conv.messages[0].languageRoutingBypassed).toBe(true);
    conv.messages = [];
    await conv.generateNewAIMessage(game.getAi());
    expect(conv.textGenApiConnection.complete.mock.calls[0][1]).toBe(true);
    expect(conv.textGenApiConnection.complete).toHaveBeenCalledTimes(1);
    const sent = conv.chatWindow.window.webContents.send.mock.calls.find((c: unknown[]) => c[0] === 'stream-message')[1];
    expect(sent.content).toContain('Bring water'); expect(sent.utterance).toBeUndefined();
    expect(conv.messages[0].utterance).toBeUndefined();
});

test('on-off-on transitions freeze previously heard speech and keep disabled turns clear in prompts and saved history', async () => {
    const conv = conversation();
    const earlier = conv.getMessagesForRecipient(3)[0].content;
    expect(earlier).not.toContain('Bring water');
    config.languageRoutingEnabled = false;
    conv.pushMessage({ id: 'disabled', role: 'assistant', name: 'Speaker', characterId: 2, content: source,
        speechSpans: [{ start: source.indexOf('Bring'), end: source.indexOf('dawn.') + 5 }] });
    const disabled = conv.messages[1];
    expect(disabled.languageRoutingBypassed).toBe(true); expect(disabled.utterance).toBeUndefined();
    expect(disabled.speechSpans).toBeUndefined();
    expect(conv.getMessagesForRecipient(3).map((m: Message) => m.content)).toEqual([earlier, source]);
    config.languageRoutingEnabled = true;
    conv.pushMessage({ id: 'reenabled', role: 'assistant', name: 'Speaker', characterId: 2, content: source });
    const heard = conv.getMessagesForRecipient(3);
    expect(heard.map((m: Message) => m.content)).toEqual([earlier, source, earlier]);
    expect(JSON.stringify(heard)).not.toContain('originalText');
    const prompt = text(await buildChatPrompt(conv, game.characters.get(3)!));
    expect(prompt).toContain(SPEECH_WRITER_INSTRUCTION);
    expect(prompt.split('Bring water').length - 1).toBe(1);
    conv._saveHistoryToFile({ timelineNodeId: 'node-test' });
    const directory = path.join(data, 'conversation_history', '1', '.recipient-views');
    const saved = JSON.parse(fs.readFileSync(path.join(directory, fs.readdirSync(directory)[0]), 'utf8'));
    expect(loadLedgerHistory(path.dirname(directory), fs.readdirSync(directory)[0].replace(/\.json$/, ''), 3)!.messages.map(message => message.content)).toEqual([earlier, source, earlier]);
});

test('lightweight prompt fixtures respect off and retain the bypass after re-enable', () => {
    config.languageRoutingEnabled = false;
    const messages: Message[] = [{ role: 'assistant', name: 'Speaker', characterId: 2, content: source }];
    const conv = { config, gameData: game, messages } as any;
    expect(recipientMessages(conv, 3)[0].content).toBe(source);
    config.languageRoutingEnabled = true;
    expect(recipientMessages(conv, 3)[0].content).toBe(source);
    expect(messages[0].utterance).toBeUndefined();
});

test('the language setting defaults on for old settings and persists an explicit off value', () => {
    const directory = path.join(data, 'configs'); fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'config.json');
    fs.writeFileSync(file, JSON.stringify({ userFolderPath: '' }));
    const legacy = new Config(file); expect(legacy.languageRoutingEnabled).toBe(true);
    legacy.languageRoutingEnabled = false; legacy.export();
    expect(new Config(file).languageRoutingEnabled).toBe(false);
});

test('compaction cannot shorten the archive, diary input, or end-of-encounter summary input', () => {
    const conv = conversation(); const heard = conv.getHistory()[0].content;
    conv.pushMessage({ id: 'second', role: 'assistant', name: 'Speaker', characterId: 2, content: '*She nods.* "I waited."' });
    conv.messages.splice(0, 1);
    expect(conv.getEncounterMessagesForRecipient(1).map((m: Message) => m.id)).toEqual(['source', 'second']);
    expect(text(buildSummarizeChatPrompt(conv, game.getPlayer()))).toContain(heard);
    conv._saveHistoryToFile();
    const directory = path.join(data, 'conversation_history', '1');
    const name = fs.readdirSync(directory).find(name => name.endsWith('.txt'))!;
    expect(loadLedgerHistory(directory, name.replace(/\.txt$/, ''), 1)!.messages.map(m => m.id)).toEqual(['source', 'second']);
});
test('failed full summarization retains the working context and every earlier owner summary', async () => {
    const conv = conversation(); config.enableMemoryCompaction = false; config.percentOfContextToSummarize = 1;
    conv.getHistory(); conv.recipientCurrentSummaries.set(2, 'Earlier owned summary.');
    conv.summarizationApiConnection = { isChat: () => true, complete: jest.fn().mockRejectedValue(new Error('offline')) };
    await expect(conv.resummarize()).rejects.toThrow('offline');
    expect(conv.messages).toHaveLength(1); expect(conv.getEncounterMessagesForRecipient(3)).toHaveLength(1);
    expect(conv.getCurrentSummaryForRecipient(2)).toBe('Earlier owned summary.');
});
test('undo finds a compacted final player turn in the full ledger and removes the entire exchange', () => {
    const conv = conversation(); conv.pendingActions = new Map();
    conv.pushMessage({ id: 'player', role: 'user', characterId: 1, name: 'Player', content: 'I waited.' });
    conv.pushMessage({ id: 'reply', role: 'assistant', characterId: 2, name: 'Speaker', content: '"Thank you."' });
    conv.messages = [conv.messages.at(-1)]; conv.undo();
    expect(conv.getHistory().map((m: Message) => m.id)).toEqual(['source']);
    expect(conv.messages.map((m: Message) => m.id)).toEqual(['source']);
});
test('editing an archived turn after compaction rebuilds the owner context and clears stale summaries', () => {
    const conv = conversation(); conv.getHistory(); conv.messages = [];
    conv.recipientCurrentSummaries.set(1, 'Stale perception.');
    conv.editMessage('source', '*She waits.* "A revised perception."');
    expect(conv.messages).toHaveLength(1); expect(conv.getHistory()[0].content).toContain('revised perception');
    expect(conv.getCurrentSummaryForRecipient(1)).toBe('');
    expect(conv.getMessagesForRecipient(2)[0].content).toBe(source);
});

test('AI-to-AI continuations retain the acting listener dataset without revealing foreign source words', async () => {
    const conv = conversation();
    await conv.generateAiToAiMessage(game.characters.get(3)!, game.getAi());
    const request = JSON.stringify(conv.textGenApiConnection.complete.mock.calls[0][0]);
    expect(request).toContain('Her hands tremble'); expect(request).not.toContain('Bring water');
    expect(request).not.toContain('originalText');
});

(fs.existsSync(path.resolve('out/language-ledger-20261012/parent-src')) ? test : test.skip)('disabled routing preserves the exact installed-parent model messages for ordinary and AI-to-AI replies', async () => {
    const parentRoot = path.resolve('out/language-ledger-20261012/parent-src');
    if (!fs.existsSync(parentRoot)) throw new Error('Freeze the actual installed parent source before this comparison');
    jest.doMock(path.join(parentRoot, 'main/culture/cultureRuntime.ts'), () => ({ getCultureBackground: jest.fn(), formatCultureBackground: jest.fn() }));
    jest.doMock(path.join(parentRoot, 'main/faith/faithRuntime.ts'), () => ({ getFaithBackground: jest.fn(), getFaithLiveContext: jest.fn(), getFaithZealous: jest.fn() }));
    const parentBuilder = require(path.join(parentRoot, 'main/conversation/promptBuilder.ts'));
    config.languageRoutingEnabled = false;
    const sanitize = (messages: Message[]) => messages.map(message => ({ role: message.role, content: message.content,
        ...(message.name?.trim() ? { name: message.name } : {}) }));
    for (const id of [2, 3]) {
        for (const target of [undefined, game.getPlayer()]) {
            const oldConv = conversation(), newConv = conversation();
            oldConv.currentSummary = newConv.currentSummary = 'An earlier ordinary exchange.';
            const baseline = await parentBuilder.buildChatPrompt(oldConv, game.characters.get(id)!, undefined, target);
            const candidate = await buildChatPrompt(newConv, game.characters.get(id)!, undefined, target);
            expect(sanitize(candidate)).toEqual(sanitize(baseline));
        }
    }
});

test('a compaction failure falls back to full owner summaries while retaining the complete encounter', async () => {
    const conv = conversation(); config.enableMemoryCompaction = true; config.percentOfContextToSummarize = 1;
    conv.memoryCompactor.compact = jest.fn().mockRejectedValue(new Error('Synthetic persistence failure'));
    conv.summarizationApiConnection = { isChat: () => true, complete: jest.fn().mockResolvedValue('An owned summary.') };
    await conv.resummarize();
    expect(conv.summarizationApiConnection.complete).toHaveBeenCalledTimes(3);
    expect(conv.getHistory()).toHaveLength(1); expect(conv.messages).toHaveLength(0);
});

test('a pending disabled reply remains clear when the switch is enabled before completion', async () => {
    const conv = conversation(); config.languageRoutingEnabled = false;
    conv.textGenApiConnection.complete.mockImplementation(async () => { config.languageRoutingEnabled = true; return source; });
    const message = await conv.generateNewAIMessage(game.getAi(), false); conv.pushMessage(message);
    expect(message.languageRoutingBypassed).toBe(true);
    expect(conv.messageForPlayer(message).content).toBe(source); expect(conv.getMessagesForRecipient(3).at(-1).content).toBe(source);
});
test('a pending routed reply keeps its original hearing when the switch is disabled before completion', async () => {
    const conv = conversation();
    conv.textGenApiConnection.complete.mockImplementation(async () => { config.languageRoutingEnabled = false; return controlledSource; });
    const message = await conv.generateNewAIMessage(game.getAi(), false); conv.pushMessage(message);
    expect(message.utterance).toBeDefined(); expect(conv.getMessagesForRecipient(3).at(-1).content).not.toContain('Bring water');
});

test('a late callback cannot mutate a closed encounter or corrupt its archived index', () => {
    const conv = conversation(); conv.getHistory(); conv.isOpen = false; conv._saveHistoryToFile();
    conv.pushMessage({ id: 'late', role: 'assistant', name: 'Speaker', characterId: 2, content: '"A late reply."' });
    const directory = path.join(data, 'conversation_history', '1');
    const name = fs.readdirSync(directory).find(name => name.endsWith('.txt'))!;
    expect(loadLedgerHistory(directory, name.replace(/\.txt$/, ''), 1)!.messages.map(m => m.id)).toEqual(['source']);
    expect(conv.getHistory().map((m: Message) => m.id)).toEqual(['source']);
});

test('the actual chat prompt excludes a future legacy diary summary after a rewind',async()=>{
    const diary=require('../../src/main/diaryManager');
    jest.spyOn(diary,'readDiarySummaries').mockResolvedValue([
        {id:'future',diaryEntryId:'future',date:'1066.10.01',summary:'FUTURE_DIARY_FIRE'},
        {id:'past',diaryEntryId:'past',date:'1066.9.01',summary:'PAST_DIARY_WATER'}]);
    const conv=conversation(),prompt=JSON.stringify(await buildChatPrompt(conv,game.getAi()));
    expect(prompt).toContain('PAST_DIARY_WATER');expect(prompt).not.toContain('FUTURE_DIARY_FIRE');
});

test('ordinary prompt admission reserves the requested output tokens even without optional lore or scenes',async()=>{
    const conv=conversation();conv.messages=[];conv.historicalConversations=[];config.lorebookEnabled=false;config.goaLoreEnabled=false;
    conv.textGenApiConnection.calculateTokensFromText=()=>100;
    config.textGenerationApiConnectionConfig.connection.overwriteContext=false;
    config.maxTokens=50;conv.textGenApiConnection.context=149;
    await expect(buildChatPrompt(conv,game.characters.get(2)!)).rejects.toThrow(/exceed|budget/i);
});

test('clearing summaries while a close summary is pending neither resurrects old cache nor loses the new summary',async()=>{
    const conv=conversation();config.diaryGenerationChance=0;config.enableMemoryCompaction=false;
    conv.actionInvolvedCharacterIds=new Set();conv.summaryFileWatcher={pauseWatcher:jest.fn(),resumeWatcher:jest.fn(),unwatchAll:jest.fn()};
    conv.summaries=new Map([[2,[{date:'1066.9.1',content:'CLEARED_OLD_CACHE'}]]]);config.embeddingApiConnectionConfig=undefined as any;conv.generateEncounterSummary=jest.fn(async()=> 'ONLY_NEW_SUMMARY').mockImplementationOnce(async()=>{
        const directory=path.join(data,'conversation_summaries','1');fs.rmSync(directory,{recursive:true,force:true});conv.clearCachedSummaries();return 'ONLY_NEW_SUMMARY';
    });
    conv.messages=[{id:'player',role:'user',characterId:1,content:'Hello.'},{id:'npc',role:'assistant',characterId:2,content:'Good morning.'}];
    await conv._generateSummariesAndDiariesInBackground();
    const stored=fs.readFileSync(path.join(data,'conversation_summaries/1/2.json'),'utf8');expect(stored).toContain('ONLY_NEW_SUMMARY');expect(stored).not.toContain('CLEARED_OLD_CACHE');
});
