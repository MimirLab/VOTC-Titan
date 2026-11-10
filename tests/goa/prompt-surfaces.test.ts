import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import { Config } from '../../src/shared/Config';
import { GameData } from '../../src/shared/gameData/GameData';
import { parseLog } from '../../src/shared/gameData/parseLog';
import { buildChatPrompt, convertMessagesToString } from '../../src/main/conversation/promptBuilder';
import { LetterReplyGenerator } from '../../src/main/letter/LetterReplyGenerator';
import { checkActions } from '../../src/main/conversation/checkActions';
import { buildSuggestionPrompt } from '../../src/main/conversation/suggestionBuilder';
import { buildSceneDescriptionPrompt } from '../../src/main/conversation/sceneDescriptionBuilder';
import { DiaryGenerator } from '../../src/main/diary/DiaryGenerator';
import { buildGoaCaptureCatalog } from '../../src/main/goa/goaBridge';
import { initializeGoaRuntime, observeGoaLine, clearGoaObservations, appendGoaContext, getVerifiedGoaSnapshot } from '../../src/main/goa/goaRuntime';
import { character } from '../culture/fixtures';
import { SCENE_CATALOGUE_DIGEST } from '../../src/shared/scenes/catalogue.generated';
import { applySceneSnapshot, scenePacket } from '../../src/main/scenes/sceneRuntime';
import { AudioRuntime } from '../../src/main/audio/AudioRuntime';
import { prepareVoiceDesign, updatePreparedVoiceDesign } from '../../src/main/audio/voiceDesign';
import { normalizeAudio } from '../../src/shared/audio';

jest.mock('../../src/main/culture/cultureRuntime', () => ({ getCultureBackground: jest.fn(), formatCultureBackground: jest.fn() }));
jest.mock('../../src/main/faith/faithRuntime', () => ({ getFaithBackground: jest.fn(), getFaithLiveContext: jest.fn(), getFaithZealous: jest.fn() }));
jest.mock('../../src/main/letter/LetterManager', () => ({ LetterManager: { getInstance: () => ({ getLetterSummaries: () => [] }) } }));
jest.mock('../../src/main/diaryManager', () => ({ readDiarySummaries: async () => [] }));
jest.mock('../../src/main/summaryManager', () => ({ readSummaryFile: async () => [], saveSummaryFile: jest.fn() }));
let root: string, data: string, config: Config, game: GameData, digest: string;
function write(relative: string, contents: string): void { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents); }
function capture(id: number, trait: string, sex: string): string[] {
    return [`VOTC:GOA/;/begin/;/1/;/${digest}/;/${id}`, 'VOTC:GOA/;/count/;/1', `VOTC:GOA/;/sex/;/${sex}`,
        `VOTC:GOA/;/trait/;/${trait}`, `VOTC:GOA/;/end/;/${digest}/;/${id}`];
}
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'votc-goa-prompts-')); data = path.join(root, 'votc_data');
    (app.getPath as jest.Mock).mockReturnValue(root); (app as any).getAppPath = () => process.cwd();
    write('game/common/culture/placeholder.txt', '');
    write('pack/common/traits/races.txt', 'creature_orc = {} being_demon = {} creature_dryad = {} creature_sayaadi = {} creature_voidwalker = {} fallen_demon_hunter = {}');
    write('user/mod/goa.mod', `remote_file_id="2949767945"\npath="${path.join(root, 'pack')}"`);
    write('user/dlc_load.json', JSON.stringify({ enabled_mods: ['mod/goa.mod'] }));
    const catalog = buildGoaCaptureCatalog(path.join(root, 'game'), path.join(root, 'user'))!; digest = catalog.digest;
    write('user/mod/votc_mimir_culture/goa-catalog.json', JSON.stringify(catalog));
    write('votc_data/scripts/prompts/description/custom/person.js', 'module.exports = (_game, person) => `Individual: ${person.fullName}; traits: ${person.traits.map(t => t.name).join(", ")}`;');
    write('votc_data/scripts/prompts/example messages/custom/empty.js', 'module.exports = () => [];');
    write('votc_data/configs/prompts/en.json', fs.readFileSync('default_userdata/configs/prompts/en.json', 'utf8'));
    write('votc_data/character_descriptions/1.json', JSON.stringify({ 2: 'PLAYER AUTHORED: Keeps compassion and independent convictions.' }));
    config = Object.assign(Object.create(Config.prototype), JSON.parse(fs.readFileSync('default_userdata/configs/default_config.json', 'utf8')),
        { selectedDescScript: 'custom/person.js', selectedExMsgScript: 'empty.js', maxTokens: 100,
            cultureGameInstallPath: path.join(root, 'game'), userFolderPath: path.join(root, 'user') });
    initializeGoaRuntime(config);
    for (const line of [...capture(2, 'creature_sayaadi', 'female'), ...capture(3, 'creature_dryad', 'male')]) observeGoaLine(line);
    game = new GameData(['1', 'Player', '2', 'Asha', '1066.9.15', 'votc_scene_council', 'Synthetic county', 'Player', '0']);
    game.characters.set(1, character(1, 'Player')); game.characters.set(2, character(2, 'Asha')); game.characters.set(3, character(3, 'Keeper'));
    jest.spyOn(console, 'debug').mockImplementation(() => {}); jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { clearGoaObservations(); jest.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
function conversation(context = 20000): any {
    return { config, gameData: game, votcDataPath: data, messages: [{ role: 'user', content: 'Speak with me.', name: 'Player' }],
        chatWindow: { window: { webContents: { send: jest.fn() } } }, getBranchVisibleSummaries: () => [], letterManager: { getLetterSummaries: () => [] },
        textGenApiConnection: { context, calculateTokensFromText: (text: string) => text.length }, translations: {} };
}
test('production chat and group builders attach the actual actor’s sex and lore alongside the existing persona', async () => {
    const first = convertMessagesToString(await buildChatPrompt(conversation(), game.getAi()), '', '');
    expect(first).toContain('Warcraft context for Asha:'); expect(first).toContain('Compassionate');
    expect(first).toContain('PLAYER AUTHORED: Keeps compassion'); expect(first).not.toContain('Keeper of the Grove');
    const keeper = game.characters.get(3)!;
    const group = convertMessagesToString(await buildChatPrompt(conversation(), keeper, [], game.getAi()), '', '');
    expect(group).toContain('Warcraft context for Keeper:'); expect(group).not.toContain('Warcraft context for Asha');
    expect(group).toContain('He has branching antlers'); expect(game.aiID).toBe(2); expect(game.playerID).toBe(1);
});
test('letters use the writer and reject an insufficient budget without dropping lore', async () => {
    const generator = Object.assign(Object.create(LetterReplyGenerator.prototype), {
        config, votcDataPath: data, apiConnection: { context: 20000, calculateTokensFromText: (text: string) => text.length }
    });
    const letter = { sender: game.getPlayer(), recipient: game.getAi(), content: 'Please tell me your answer.' };
    const prompt = await generator.buildLetterPrompt(game, letter);
    expect(prompt).toContain('Warcraft context for Asha:'); expect(prompt).not.toContain('Warcraft context for Player');
    generator.apiConnection.context = 100;
    await expect(generator.buildLetterPrompt(game, letter)).rejects.toThrow('exceed');
});
test('dialogue trims older history while preserving the current actor, complete lore and player description', async () => {
    const conv = conversation();
    const old = { role: 'assistant', content: 'Old unrelated exchange. '.repeat(100), name: 'Asha' };
    conv.messages.unshift(old);
    const roomy = await buildChatPrompt(conv, game.getAi());
    const size = convertMessagesToString(roomy, '', '').length;
    conv.textGenApiConnection.context = size - old.content.length + config.maxTokens + 20;
    const tight = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
    expect(tight).not.toContain('Old unrelated exchange'); expect(tight).toContain('Warcraft context for Asha');
    expect(tight).toContain('PLAYER AUTHORED: Keeps compassion'); expect(tight).toContain('Speak with me.');
});
test('disabled, unknown packs, and invalidated captures retain the old prompt exactly', async () => {
    config.goaLoreEnabled = false;
    const disabled = await buildChatPrompt(conversation(), game.getAi());
    config.goaLoreEnabled = true; clearGoaObservations();
    expect(await buildChatPrompt(conversation(), game.getAi())).toEqual(disabled);
    expect(appendGoaContext('Original', game.getAi(), config, game)).toBe('Original');
    write('user/dlc_load.json', '{"enabled_mods":[]}'); initializeGoaRuntime(config);
    expect(await buildChatPrompt(conversation(), game.getAi())).toEqual(disabled);
});
test('raw export retains canonical trait ID, original localized metadata and the binary sex observation', async () => {
    const fields = Array(27).fill(''); Object.assign(fields, { 0: '2', 1: 'Asha', 2: 'Asha', 4: 'she', 5: '35' });
    const log = ['VOTC:IN/;/init/;/1/;/Player/;/2/;/Asha/;/1066.9.15/;/votc_scene_council/;/Synthetic county/;/Player/;/0',
        'VOTC:IN/;/character/;/' + fields.join('/;/'), 'VOTC:IN/;/trait/;/2/;/Racial/;/Localized Succubus/;/Original description./;/creature_sayaadi',
        ...capture(2, 'creature_sayaadi', 'female')].join('\n') + '\n';
    write('capture.log', log);
    const parsed = await parseLog(path.join(root, 'capture.log'));
    expect(parsed?.characters.get(2)?.traits[0]).toEqual({ id: 'creature_sayaadi', category: 'Racial', name: 'Localized Succubus', desc: 'Original description.' });
    expect(parsed?.characters.get(2)?.sex).toBe('female');
    expect(parsed?.characters.get(2)?.goaSnapshot?.traitIds).toEqual(['creature_sayaadi']);
});
test('freshness binds only the captured character object and invalidates on incomplete capture or campaign change', () => {
    const original = game.getAi();
    expect(getVerifiedGoaSnapshot(original)?.sex).toBe('female');
    const now = Date.now(); jest.spyOn(Date, 'now').mockReturnValue(now + 16000);
    expect(getVerifiedGoaSnapshot(original)?.sex).toBe('female');
    expect(getVerifiedGoaSnapshot(character(2, 'Different encounter'))).toBeUndefined();
    observeGoaLine(capture(2, 'creature_sayaadi', 'female')[0]);
    expect(getVerifiedGoaSnapshot(original)).toBeUndefined();
    capture(2, 'creature_dryad', 'male').forEach(observeGoaLine);
    expect(getVerifiedGoaSnapshot(original)?.sex).toBe('male');
    clearGoaObservations(); expect(getVerifiedGoaSnapshot(original)).toBeUndefined();
});
test.each(['enqueue', 'replay'] as const)('%s preserves Warcraft context when a queued voice design waits twenty seconds', mode => {
    const settings = normalizeAudio({ enabled: true, hosting: 'external' }); config.audio = settings;
    const message: any = { id: 'delayed-voice', role: 'assistant', characterId: 2, content: '"The gate is shut."', editableContent: '""The gate is shut.""' };
    const conv = { ...conversation(), isOpen: true, campaignIdentity: { campaignId: 'delayed-fixture' },
        messageForPlayer: (m: any) => m, getHistory: () => [message], historicalConversations: [],
        getEncounterCharacter: (id: number) => game.characters.get(id) };
    const runtime = new AudioRuntime(path.join(root, 'owned-audio'), () => settings, () => {});
    // Inspect the actual queue without loading Breeze or calling either model.
    jest.spyOn(runtime as any, 'drain').mockResolvedValue(undefined);
    try {
        if (mode === 'enqueue') runtime.enqueue(conv as any, message); else runtime.replay(conv as any, message.id);
        const queued = (runtime as any).queue[0]; expect(queued.actor).not.toBe(game.getAi());
        const at = Date.now(); jest.spyOn(Date, 'now').mockReturnValue(at + 20_000);
        // The detached actor remains untrusted. Only the input captured from
        // the original verified participant survives the queue delay.
        expect(getVerifiedGoaSnapshot(queued.actor)).toBeUndefined();
        const prompt = JSON.stringify(updatePreparedVoiceDesign(queued.design, undefined, undefined, { phase: 'adult', traits: [] }).prompt);
        expect(prompt).toContain('Warcraft context for Asha:');
        expect(prompt).toContain('Authoritative current personality/childhood traits');
        expect(prompt).not.toContain('Warcraft context for Keeper:');
    } finally { runtime.shutdown(); }
});
test('letters render the actual writer in a group and preserve context with a custom template', async () => {
    write('votc_data/configs/prompts/en.json', JSON.stringify({ prompts: { letterPrompt: 'Reply as {{aiName}} to {{playerName}}: {{letterContent}}' } }));
    const generator = Object.assign(Object.create(LetterReplyGenerator.prototype), {
        config, votcDataPath: data, apiConnection: { context: 20000, calculateTokensFromText: (text: string) => text.length }
    });
    const prompt = await generator.buildLetterPrompt(game, { sender: game.getPlayer(), recipient: game.characters.get(3), content: 'Hello.' });
    expect(prompt).toContain('Warcraft context for Keeper:');
    expect(prompt).not.toContain('Warcraft context for Asha'); expect(prompt).toContain('Keeper');
    expect(game.aiID).toBe(2); expect(game.playerID).toBe(1);
});
test('action generation uses the source actor rather than the player’s body', async () => {
    const conv = conversation();
    conv.actions = [{ signature: 'testAction', args: [], description: 'Synthetic action', check: () => true }];
    conv.actionsApiConnection = { isChat: () => true, complete: jest.fn().mockResolvedValue('<rationale>Nothing occurred.</rationale><actions>noop()</actions>') };
    await checkActions(conv, 3, 2);
    const submitted = convertMessagesToString(conv.actionsApiConnection.complete.mock.calls[0][0], '', '');
    expect(submitted).toContain('Warcraft context for Keeper:'); expect(submitted).not.toContain('Warcraft context for Player');
});

function fallen(id = 2): void { capture(id, 'fallen_demon_hunter', 'female').forEach(observeGoaLine); }
function expectIdentityLast(text: string, prior: string): void {
    expect(text.match(/Acting identity for /g)).toHaveLength(1);
    expect(text.indexOf('Acting identity for ')).toBeGreaterThan(text.indexOf(prior));
    expect(text).toContain('demon alone');
}
test('Fallen identity follows persona and old/current history without mutating either', async () => {
    fallen(); const conv = conversation();
    conv.messages.unshift({ role: 'assistant', content: 'The demon’s new alliance continues.', name: 'Asha' });
    const before = JSON.stringify(conv.messages);
    const text = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
    expectIdentityLast(text, 'PLAYER AUTHORED');
    expectIdentityLast(text, 'The demon’s new alliance');
    expect(JSON.stringify(conv.messages)).toBe(before);
    expect(fs.readFileSync(path.join(data, 'character_descriptions/1.json'), 'utf8')).toContain('Keeps compassion');
});
test('Fallen examples keep their content and format but are explicitly former-hunter dialogue', async () => {
    fallen();
    write('votc_data/scripts/prompts/example messages/custom/empty.js', 'module.exports = () => [{role:"assistant", content:"I am warmhearted and merciful."}];');
    const text = convertMessagesToString(await buildChatPrompt(conversation(), game.getAi()), '', '');
    expect(text).toContain('I am warmhearted and merciful.');
    expect(text.match(/These examples portray Asha before the takeover/g)).toHaveLength(1);
    expect(text.indexOf('before the takeover')).toBeLessThan(text.indexOf('I am warmhearted'));
    expectIdentityLast(text, 'I am warmhearted');
    capture(2, 'creature_sayaadi', 'female').forEach(observeGoaLine);
    expect(convertMessagesToString(await buildChatPrompt(conversation(), game.getAi()), '', '')).not.toContain('before the takeover');
});
test('qualified lore survives a failing description renderer on dialogue, suggestions and action extraction', async () => {
    fallen(); fallen(1);
    write('votc_data/scripts/prompts/description/custom/person.js', 'module.exports = () => { throw new Error("Synthetic renderer failure"); };');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const conv = conversation();
    const chat = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
    expect(chat).toContain('Warcraft context for Asha:'); expectIdentityLast(chat, 'PLAYER AUTHORED');
    const suggestion = convertMessagesToString(buildSuggestionPrompt(conv), '', '');
    expect(suggestion).toContain('Warcraft context for Player:'); expectIdentityLast(suggestion, 'Speak with me.');
    conv.actions = [{ signature: 'testAction', args: [], description: 'Synthetic action', check: () => true }];
    conv.actionsApiConnection = { isChat: () => true, complete: jest.fn().mockResolvedValue('<rationale>No action.</rationale><actions>noop()</actions>') };
    await checkActions(conv, 2, 1);
    const action = convertMessagesToString(conv.actionsApiConnection.complete.mock.calls[0][0], '', '');
    expect(action).toContain('Warcraft context for Asha:'); expect(action).toContain('only actions supported');
    expect(action).not.toContain('speak and act');
});
test('Fallen letter and both diary surfaces put the writer’s identity after supplied history', async () => {
    fallen();
    const api = { context: 20000, calculateTokensFromText: (text: string) => text.length, complete: jest.fn().mockResolvedValue('Synthetic diary.') };
    const letter = Object.assign(Object.create(LetterReplyGenerator.prototype), { config, votcDataPath: data, apiConnection: api });
    expectIdentityLast(await letter.buildLetterPrompt(game, { sender: game.getPlayer(), recipient: game.getAi(), content: 'Former history reminder.' }), 'Former history reminder.');
    const diary = Object.assign(Object.create(DiaryGenerator.prototype), { config, votcDataPath: data, apiConnection: api });
    await diary.generateDiaryEntry(game, { getHistory: () => [{ name: 'Player', content: 'Former history reminder.' }] } as any, '2');
    expectIdentityLast(api.complete.mock.calls[0][0][0].content, 'Former history reminder.');
    api.complete.mockClear();
    await diary.generateDiaryEntryForLetter(game, game.getAi(), 'Former letter reminder.', 'received');
    expectIdentityLast(api.complete.mock.calls[0][0][0].content, 'Former letter reminder.');
});
test('scene descriptions do not receive a private controller’s captivity, motives or identity command', () => {
    fallen(1);
    const text = convertMessagesToString(buildSceneDescriptionPrompt(conversation()), '', '');
    expect(text).not.toMatch(/conscious captive|relishes|Acting identity|sabotage|forced to witness/);
});

test('a tight dialogue budget preserves the complete Fallen identity instruction after dropping older history', async () => {
    fallen(); const conv = conversation();
    const old = { role: 'assistant', name: 'Asha', content: 'Old unrelated history. '.repeat(100) };
    conv.messages.unshift(old);
    const roomy = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
    conv.textGenApiConnection.context = roomy.length - old.content.length + config.maxTokens + 20;
    const tight = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
    expect(tight).not.toContain('Old unrelated history');
    expect(tight).toContain('Warcraft context for Asha:');
    expectIdentityLast(tight, 'PLAYER AUTHORED');
    expect(tight).toContain('Continue the demon’s own subsequent choices and alliances');
});

test('a selected court preserves owner-only Fallen control and keeps its private facts out of narration', async () => {
    fallen(); fallen(1);
    expect(applySceneSnapshot(game, { schema: 1, catalogue: SCENE_CATALOGUE_DIGEST, mode: 'goa', anchorId: 1,
        selected: 'titan_demonic_court', location: 'Observed province', controller: 'Observed controller',
        terrain: 'plains', style: 'demonic', culture: 'unknown', settled: true, coastal: false,
        regions: [], worldStates: [], eligible: ['titan_demonic_court'] })).toBe(true);
    const packet = scenePacket(game), conv = conversation();
    const chat = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
    expect(chat).toContain(packet); expect(chat).toContain('Warcraft context for Asha:');
    expectIdentityLast(chat, 'PLAYER AUTHORED');
    expect(chat).toContain('Continue the demon’s own subsequent choices and alliances');
    const narrator = convertMessagesToString(buildSceneDescriptionPrompt(conv), '', '');
    expect(narrator).toContain(packet);
    expect(narrator).not.toMatch(/conscious captive|relishes|Acting identity|forced to witness/);
});
