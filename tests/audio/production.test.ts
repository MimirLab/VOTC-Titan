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
import { ApiConnection, EmbeddingProvider } from '../../src/shared/apiConnection';
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


import { normalizeAudio } from '../../src/shared/audio';
import { audioCuesFor } from '../../src/main/audio/audioDirections';
import { designCharacterVoice, prepareVoiceDesign, voiceDesignPrompt, updatePreparedVoiceDesign } from '../../src/main/audio/voiceDesign';
import { resolveVoiceCasting } from '../../src/main/audio/acousticCasting';

test('audio off preserves complete production prompt bytes; audio on adds only delivery metadata instructions', async () => {
    const conv = conversation(); delete (config as any).audio;
    const original = JSON.stringify(await buildChatPrompt(conv, game.getAi()));
    config.audio = normalizeAudio();
    expect(JSON.stringify(await buildChatPrompt(conv, game.getAi()))).toBe(original);
    config.audio.enabled = true;
    const enabled = JSON.stringify(await buildChatPrompt(conv, game.getAi()));
    expect(enabled).toContain('Audio delivery metadata:');
    expect(original).not.toContain('titan_audio');
});
test.each(['{"direction":"restrained, reassuring"}', '{broken'])('controlled writer commits prose in one request while extracting optional cues: %s', metadata => {
    return (async () => {
        const conv = conversation(); config.audio = normalizeAudio({ enabled: true });
        const raw = '**She rests her hand on the table.** ""The water is ready by the gate, and I will bring the bread before dawn."" ~~I hope he will wait.~~';
        conv.textGenApiConnection.complete = jest.fn().mockResolvedValue(raw + '<titan_audio>' + metadata + '</titan_audio>');
        const message = await conv.generateNewAIMessage(game.getAi(), false);
        expect(message).toBeTruthy(); expect(message.content).toBe(raw); expect(conv.textGenApiConnection.complete).toHaveBeenCalledTimes(1);
        expect(audioCuesFor(message)).toEqual(metadata === '{broken' ? [] : [{ direction: 'restrained, reassuring' }]);
        conv.pushMessage(message);
        expect(JSON.stringify(conv.getHistory())).not.toMatch(/titan_audio|restrained, reassuring/);
        expect(JSON.stringify(buildSummarizeChatPrompt(conv, game.getAi()))).not.toMatch(/titan_audio|restrained, reassuring/);
    })();
});
test('voice design uses the selected persona, authored portrayal and ready backgrounds for the actual owner', () => {
    const conv = conversation();
    write('character_descriptions/1.json', JSON.stringify({ '2': 'Speaker refuses all cruelty and has a naturally breathy voice.' }));
    require('../../src/main/culture/cultureRuntime').getCultureBackground.mockReturnValue('Travelers are welcomed with practical hospitality.');
    require('../../src/main/culture/cultureRuntime').formatCultureBackground.mockReturnValue('Travelers are welcomed with practical hospitality.');
    require('../../src/main/faith/faithRuntime').getFaithBackground.mockReturnValue('Protection of the helpless is esteemed.');
    const prompt = JSON.stringify(voiceDesignPrompt(conv, game.getAi()));
    expect(prompt).toContain('A quiet room with a table.'); expect(prompt).toContain('refuses all cruelty');
    expect(prompt).toContain('Travelers are welcomed'); expect(prompt).toContain('Protection of the helpless');
    expect(prompt).toContain('age-neutral'); expect(prompt).not.toContain('Voice design for Mimir');
});
test('heritage roleplay context reaches dialogue without changing individual voice design input', async () => {
    const conv = conversation(), actor = game.getAi(), culture = require('../../src/main/culture/cultureRuntime');
    culture.getCultureBackground.mockImplementation((_person: unknown, includeRoots?: boolean) =>
        'Existing cultural guidance.' + (includeRoots === false ? '' : ' Inherited gryphon context.'));
    culture.formatCultureBackground.mockImplementation((_person: unknown, text: string) => text);
    require('../../src/main/faith/faithRuntime').getFaithBackground.mockReturnValue(undefined);
    const voice = JSON.stringify(voiceDesignPrompt(conv, actor));
    expect(voice).toContain('Existing cultural guidance.');
    expect(voice).not.toContain('Inherited gryphon context.');
    expect(culture.getCultureBackground).toHaveBeenCalledWith(actor, false);
    expect(JSON.stringify(await buildChatPrompt(conv, actor))).toContain('Inherited gryphon context.');
});
test('the questioning writer names the actual interlocutor and keeps role labels out of private thoughts', async () => {
    const conv = conversation(); game.getPlayer().fullName = "Matron Cassia 'the Slitherqueen'";
    game.getAi().fullName = 'Tide Lord Rapja';
    const prompt = await conv.buildQuestioningPrompt(game.getAi(), undefined, 'controls-v1');
    const direction = prompt.at(-1).content;
    expect(direction).toContain("the last statement made by Matron Cassia 'the Slitherqueen'");
    expect(direction).toContain('dialogue, observable narration and private thoughts');
    expect(direction).toContain('in-world names, titles or appropriate pronouns');
    expect(direction).not.toContain("the player's last statement");
    expect(JSON.stringify(prompt)).toContain('Tide Lord Rapja');
    expect(conv.textGenApiConnection.complete).not.toHaveBeenCalled();
});
test('delayed development retains captured persona, culture, faith and portrayal while replacing current traits', () => {
    const conv = conversation(), actor = game.getAi();
    write('character_descriptions/1.json', JSON.stringify({ '2': 'Original player portrayal.' }));
    require('../../src/main/culture/cultureRuntime').getCultureBackground.mockReturnValue('Original cultural paragraph.');
    require('../../src/main/culture/cultureRuntime').formatCultureBackground.mockReturnValue('Original cultural paragraph.');
    require('../../src/main/faith/faithRuntime').getFaithBackground.mockReturnValue('Original religious paragraph.');
    const prepared = prepareVoiceDesign(conv, actor, undefined, undefined,
        { phase: 'provisional', traits: [{ category: 'childhood', name: 'Curious' }] });
    const original = JSON.stringify(prepared);
    write('scripts/prompts/description/person.js', 'module.exports = () => "A different later persona.";');
    write('character_descriptions/1.json', JSON.stringify({ '2': 'Changed later portrayal.' }));
    require('../../src/main/culture/cultureRuntime').getCultureBackground.mockReturnValue(undefined);
    require('../../src/main/faith/faithRuntime').getFaithBackground.mockReturnValue(undefined);
    const next = updatePreparedVoiceDesign(prepared, undefined, 'The established dry grain.',
        { phase: 'adult', traits: [{ category: 'personality', name: 'Brave' }] });
    const prompt = JSON.stringify(next.prompt);
    for (const text of ['A quiet room with a table.', 'Original cultural paragraph.', 'Original religious paragraph.',
        'Original player portrayal.', 'The established dry grain.', 'Brave']) expect(prompt).toContain(text);
    for (const text of ['A different later persona.', 'Changed later portrayal.', 'Curious']) expect(prompt).not.toContain(text);
    expect(JSON.stringify(prepared)).toBe(original); expect(next.provider).toBe(prepared.provider);
});
test('adult voice finalization has its own authoritative current-trait prompt and preserves ordinary RP bytes',async()=>{
    const conv=conversation(),actor=game.getAi(),before=JSON.stringify(await buildChatPrompt(conv,actor));
    const traits=[{category:'personality' as const,name:'Brave'}],development={phase:'adult' as const,traits,originalVoiceId:'original-child-voice'};
    const prepared=prepareVoiceDesign(conv,actor,undefined,'A clear dry grain with careful consonants.',development);
    const request=JSON.stringify(prepared.prompt);expect(request).toContain('Current captured traits below override any stale');expect(request).toContain('Brave');expect(request).toContain('recognizable continuation');
    const complete=jest.spyOn(ApiConnection.prototype,'complete').mockResolvedValue('{"voiceDescription":"A clear dry grain accompanies careful, rounded consonants and measured natural phrasing, with gently assured emphasis."}');
    const designed=await designCharacterVoice(conv,actor,new AbortController().signal,prepared);
    expect(JSON.parse(designed.provenance).development).toEqual({version:1,...development});expect(complete).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await buildChatPrompt(conv,actor))).toBe(before);
});
test('the actual voice-design provider request excludes casting paragraphs and leaves the RP request unchanged', async () => {
    const conv = conversation(); config.audio = normalizeAudio({ enabled: true });
    const before = JSON.stringify(await buildChatPrompt(conv, game.getAi()));
    const casting = resolveVoiceCasting(game.getAi(), { anatomyId: '014', presentation: 'male', cultureId: 'gilnean' });
    const individual = 'A slight dry grain softens carefully rounded consonants, with short deliberate phrases and an easy unhurried rhythm.';
    const complete = jest.spyOn(ApiConnection.prototype, 'complete').mockResolvedValue(JSON.stringify({ voiceDescription: individual }));
    const designed = await designCharacterVoice(conv, game.getAi(), new AbortController().signal, prepareVoiceDesign(conv, game.getAi(), casting));
    const request = JSON.stringify(complete.mock.calls[0][0]);
    expect(request).not.toContain(casting.anatomyCore); expect(request).not.toContain(casting.cultureCore);
    expect(request).not.toContain('Cockney accent'); expect(request).not.toContain('faith_delivery');
    expect(designed.instruction).toContain(casting.anatomyCore); expect(designed.instruction).toContain(casting.cultureCore);
    expect(designed.instruction).toContain(individual); expect(complete).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await buildChatPrompt(conv, game.getAi()))).toBe(before);
    expect(conv.textGenApiConnection.complete).not.toHaveBeenCalled();
});
test('audio with routing disabled retains clear speech/thought boundaries without exposing thoughts to characters', async () => {
    const conv = conversation(); config.audio = normalizeAudio({ enabled: true }); config.languageRoutingEnabled = false;
    conv.messages = [];
    const raw = '**She nods.** ""The water is by the gate, and I will bring more before dawn."" ~~I hope he stays.~~';
    conv.textGenApiConnection.complete = jest.fn().mockResolvedValue(raw + '<titan_audio>{"direction":"warm"}</titan_audio>');
    const message = await conv.generateNewAIMessage(game.getAi(), false); conv.pushMessage(message);
    expect(message.languageRoutingBypassed).toBe(true);
    expect(conv.messageForPlayer(message).editableContent).toContain('~~I hope he stays.~~');
    expect(conv.getMessagesForRecipient(1)[0].content).not.toContain('I hope he stays');
    expect(conv.textGenApiConnection.complete).toHaveBeenCalledTimes(1);
});
test('a response limit inside optional audio metadata cannot cause another prose request', async () => {
    const conv = conversation(); config.audio = normalizeAudio({ enabled: true });
    const raw = '**She nods.** ""The water is by the gate, and I will bring more before dawn.""';
    conv.textGenApiConnection.complete = jest.fn().mockImplementation(async (...args: any[]) => {
        args[7]?.({ finishReason: 'length' }); return raw + '<titan_audio>{"direction":"';
    });
    const message = await conv.generateNewAIMessage(game.getAi(), false);
    expect(message.content).toBe(raw); expect(audioCuesFor(message)).toEqual([]);
    expect(conv.textGenApiConnection.complete).toHaveBeenCalledTimes(1);
});

test('late native body refresh keeps the original culture, faith, portrayal and provider snapshot',()=>{
    const conv=conversation(),actor=game.getAi();
    write('character_descriptions/1.json',JSON.stringify({'2':'Original portrayal.'}));
    require('../../src/main/culture/cultureRuntime').getCultureBackground.mockReturnValue('Captured culture.');
    require('../../src/main/culture/cultureRuntime').formatCultureBackground.mockReturnValue('Captured culture.');
    require('../../src/main/faith/faithRuntime').getFaithBackground.mockReturnValue('Captured faith.');
    const prepared=prepareVoiceDesign(conv,actor),before=JSON.stringify(prepared);
    write('scripts/prompts/description/late-body.js','module.exports=()=>"Fresh late body persona.";');
    config.selectedDescScript='late-body.js';
    write('character_descriptions/1.json',JSON.stringify({'2':'Later portrayal.'}));
    require('../../src/main/culture/cultureRuntime').getCultureBackground.mockReturnValue(undefined);
    require('../../src/main/faith/faithRuntime').getFaithBackground.mockReturnValue(undefined);
    const casting=resolveVoiceCasting(actor,{anatomyId:'014',cultureId:'gilnean',presentation:'male'});
    jest.spyOn(require('../../src/main/goa/goaRuntime'),'composeGoaContext').mockImplementation((...args:any[])=>({description:args[0]+' Fresh verified late body.'}));
    const next=require('../../src/main/audio/voiceDesign').refreshPreparedVoiceBody(prepared,conv,actor,casting);
    const prompt=JSON.stringify(next.prompt);
    for(const text of ['Fresh verified late body.','A quiet room with a table.','Captured culture.','Captured faith.','Original portrayal.'])expect(prompt).toContain(text);
    expect(prompt).not.toContain('Fresh late body persona.');expect(prompt).not.toContain('Later portrayal.');expect(next.provider).toBe(prepared.provider);
    expect(next.encoder).toBe(prepared.encoder);expect(JSON.stringify(prepared)).toBe(before);
});
