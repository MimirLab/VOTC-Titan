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
import { configureDialogueCapture, currentDialogueCaptureCatalog, observeDialogueLine, clearDialogueObservations } from '../../src/main/dialogue/dialogueRuntime';
import { dialogueCatalogue } from '../../src/main/dialogue/dialogueCatalog';
import { Conversation } from '../../src/main/conversation/Conversation';
import { captureCurrentLanguages, prepareRoleplayBackground } from '../../src/main/culture/cultureRuntime';
import { getDialogueIdentity } from '../../src/main/dialogue/dialogueRuntime';
import { configureLanguageCapture, setLanguageRoutingEnabled } from '../../src/main/language/languageRuntime';
import { voiceDesignPrompt } from '../../src/main/audio/voiceDesign';
import { buildSummarizeChatPrompt } from '../../src/main/conversation/promptBuilder';
import { SCENE_CATALOGUE_DIGEST } from '../../src/shared/scenes/catalogue.generated';
import { applySceneSnapshot, scenePacket } from '../../src/main/scenes/sceneRuntime';
import { configureDevelopmentCapture, observeDevelopmentLine, bindDevelopment } from '../../src/main/development/developmentRuntime';
import { DEVELOPMENT_DIGEST } from '../../src/main/development/developmentCapture';

jest.mock('../../src/main/culture/cultureRuntime', () => ({ getCultureBackground: jest.fn(), formatCultureBackground: jest.fn(), captureCurrentLanguages: jest.fn(), prepareRoleplayBackground: jest.fn() }));
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
    configureDevelopmentCapture({ userFolderPath: '' } as Config);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'votc-goa-prompts-')); data = path.join(root, 'votc_data');
    (app.getPath as jest.Mock).mockReturnValue(root); (app as any).getAppPath = () => process.cwd();
    write('game/common/culture/placeholder.txt', '');
    write('pack/common/traits/races.txt', 'creature_orc = {} being_demon = {} creature_dryad = {} creature_sayaadi = {} creature_voidwalker = {} fallen_demon_hunter = {}');
    write('pack/common/culture/cultures/styles.txt', Object.keys(dialogueCatalogue().cultures).map(id => id + ' = {}').join('\n'));
    write('pack/common/religion/religion_types/styles.txt', 'light_religion = { faiths = { ' + [...new Set(Object.values(dialogueCatalogue().faiths).flatMap(v => v.faithIds))].map(id => id + ' = {}').join(' ') + ' } }');
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
    initializeGoaRuntime(config); configureDialogueCapture(config);
    for (const line of [...capture(1, 'creature_orc', 'male'), ...capture(2, 'creature_sayaadi', 'female'), ...capture(3, 'creature_dryad', 'male')]) observeGoaLine(line);
    game = new GameData(['1', 'Player', '2', 'Asha', '1066.9.15', 'votc_scene_council', 'Synthetic county', 'Player', '0']);
    game.characters.set(1, character(1, 'Player')); game.characters.set(2, character(2, 'Asha')); game.characters.set(3, character(3, 'Keeper'));
    publish(1, 'darkspear'); publish(2, 'goblin'); publish(3, 'naga');
    jest.spyOn(console, 'debug').mockImplementation(() => {}); jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { clearDialogueObservations(); clearGoaObservations(); jest.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
function conversation(context = 20000): any {
    return { config, gameData: game, votcDataPath: data, messages: [{ role: 'user', content: 'Speak with me.', name: 'Player' }],
        chatWindow: { window: { webContents: { send: jest.fn() } } }, getBranchVisibleSummaries: () => [], letterManager: { getLetterSummaries: () => [] },
        textGenApiConnection: { context, calculateTokensFromText: (text: string) => text.length }, translations: {} };
}

function publish(id: number, culture: string, faith = 'holy_light'): void {
    const catalog = currentDialogueCaptureCatalog()!;
    const rows = [`VOTC:SPEECH/;/begin/;/${catalog.digest}/;/${id}`,
        ...catalog.cultureIds.flatMap(key => [`VOTC:SPEECH/;/culture/;/${key}/;/${+(key === culture)}`, `VOTC:SPEECH/;/root/;/${key}/;/${+(key === culture)}`]),
        ...catalog.faithIds.map(key => `VOTC:SPEECH/;/faith/;/${key}/;/${+(key === faith)}`),
        `VOTC:SPEECH/;/end/;/${catalog.digest}/;/${id}`];
    rows.forEach(observeDialogueLine);
}

test.each(Object.keys(dialogueCatalogue().cultures))('actual writer gets the selected %s block with complete persona and private source boundaries', async culture => {
    publish(2, culture);
    const conv = conversation(50000);
    const prompt = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
    expect(prompt).toContain(dialogueCatalogue().cultures[culture].instruction);
    expect(prompt).toContain('PLAYER AUTHORED: Keeps compassion and independent convictions.');
    expect(prompt).toContain('Warcraft context for Asha');
    expect(prompt).not.toContain('sourceSha256'); expect(prompt).not.toContain('Original dialogue examples');
    expect(prompt).not.toContain('VOTC:SPEECH'); expect(prompt).not.toContain('cultureRoots');
});

test('group actor switch, letters and player suggestions each use their own register', async () => {
    const conv = conversation(50000);
    const keeper = game.characters.get(3)!;
    const group = convertMessagesToString(await buildChatPrompt(conv, keeper, [], game.getAi()), '', '');
    expect(group).toContain(dialogueCatalogue().cultures.naga.instruction);
    expect(group).not.toContain(dialogueCatalogue().cultures.goblin.instruction);
    const generator = Object.assign(Object.create(LetterReplyGenerator.prototype), {
        config, votcDataPath: data, apiConnection: { context: 50000, calculateTokensFromText: (text: string) => text.length }
    });
    const letter = await generator.buildLetterPrompt(game, { sender: game.getPlayer(), recipient: game.getAi(), content: 'Please answer.' });
    expect(letter).toContain(dialogueCatalogue().cultures.goblin.instruction); expect(letter).toContain('written correspondence');
    const suggested = JSON.stringify(buildSuggestionPrompt(conv));
    expect(suggested).toContain(dialogueCatalogue().cultures.darkspear.instruction);
    expect(suggested).not.toContain(dialogueCatalogue().cultures.goblin.instruction);
});

test('latest capture changes future writer register while old messages and saved voice design inputs remain untouched', async () => {
    const conv = conversation(50000), originalMessages = JSON.stringify(conv.messages);
    const voiceBefore = voiceDesignPrompt(conv, game.getAi());
    publish(2, 'gilnean');
    const writer = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
    expect(writer).toContain(dialogueCatalogue().cultures.gilnean.instruction);
    expect(writer).not.toContain(dialogueCatalogue().cultures.goblin.instruction);
    expect(JSON.stringify(conv.messages)).toBe(originalMessages);
    expect(voiceDesignPrompt(conv, game.getAi())).toEqual(voiceBefore);
    expect(JSON.stringify(voiceBefore)).not.toContain('Character dialogue direction');
});

test('observer scenery, action inference and summaries do not acquire writer-only commands or catalogue examples', async () => {
    const conv = conversation(50000);
    const scene = JSON.stringify(buildSceneDescriptionPrompt(conv)); expect(scene).not.toContain('Character dialogue direction');
    const summary = JSON.stringify(buildSummarizeChatPrompt(conv, game.getAi())); expect(summary).not.toContain('Character dialogue direction');
    conv.actions = [{ signature: 'noop', description: 'Wait.', check: () => true, args: [], run: () => '' }];
    conv.actionsApiConnection = { isChat: () => true, complete: jest.fn().mockResolvedValue('<rationale>Wait.</rationale><actions>noop()</actions>') };
    await checkActions(conv, 2, 1);
    expect(JSON.stringify(conv.actionsApiConnection.complete.mock.calls[0][0])).not.toContain('Character dialogue direction');
});

test('GoA and domain switches preserve their authority; a displayed culture label does not select a register', async () => {
    const conv = conversation(50000);
    config.cultureRoleplayEnabled = false; config.faithRoleplayEnabled = false;
    expect(JSON.stringify(await buildChatPrompt(conv, game.getAi()))).not.toContain('Character dialogue direction');
    config.cultureRoleplayEnabled = true;
    clearDialogueObservations(); game.getAi().culture = 'Darkspear';
    expect(JSON.stringify(await buildChatPrompt(conv, game.getAi()))).not.toContain('Character dialogue direction');
    publish(2, 'goblin'); config.goaLoreEnabled = false;
    expect(JSON.stringify(await buildChatPrompt(conv, game.getAi()))).not.toContain('Character dialogue direction');
});

test('tight context yields optional direction while preserving the established persona and history policy', async () => {
    const conv = conversation(50000); const old = { role: 'assistant', content: 'Old unrelated exchange. '.repeat(200), name: 'Asha' };
    conv.messages.unshift(old);
    const roomy = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
    conv.textGenApiConnection.context = roomy.length - old.content.length + config.maxTokens + 20;
    const prompt = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
    expect(prompt).not.toContain(old.content);
    expect(prompt).not.toContain('Character dialogue direction');
    expect(prompt).toContain('PLAYER AUTHORED: Keeps compassion');
});


test('writer ingress refreshes current identity even with RP Language off; an unavailable refresh drops stale style without blocking prose', async () => {
    configureLanguageCapture(undefined, false); setLanguageRoutingEnabled(false);
    config.languageRoutingEnabled = false;
    expect(getDialogueIdentity(game.getAi())?.cultureId).toBe('goblin');
    const conv: any = Object.assign(Object.create(Conversation.prototype), {
        config, gameData: game, encounterLifetime: new AbortController(), encounterCapture: Promise.resolve(true),
        capturedParticipants: new Set([1, 2, 3]), chatWindow: { window: { webContents: { send: jest.fn() } } }
    });
    (captureCurrentLanguages as jest.Mock).mockImplementation(async () => { publish(1, 'darkspear'); publish(2, 'gilnean'); publish(3, 'naga'); return true; });
    await conv.prepareMessageIngress();
    expect(captureCurrentLanguages).toHaveBeenCalledTimes(1);
    expect(getDialogueIdentity(game.getAi())?.cultureId).toBe('gilnean');
    (captureCurrentLanguages as jest.Mock).mockResolvedValue(false);
    await expect(conv.prepareMessageIngress()).resolves.toBeUndefined();
    expect(getDialogueIdentity(game.getAi())).toBeUndefined();
    configureLanguageCapture(undefined, true);
});

test('bound identity survives only on its actual character object and is invalidated by campaign load', () => {
    const actor = game.getAi(); expect(getDialogueIdentity(actor)?.cultureId).toBe('goblin');
    const now = Date.now(); jest.spyOn(Date, 'now').mockReturnValue(now + 16000);
    expect(getDialogueIdentity(actor)?.cultureId).toBe('goblin');
    expect(getDialogueIdentity(character(2, 'Unbound reused ID'))).toBeUndefined();
    observeDialogueLine('VOTC:CAMPAIGN/;/loaded/;/older-save');
    expect(getDialogueIdentity(actor)).toBeUndefined();
});


test('live domain and GoA switches suspend and resume identity work without a startup generation or audio job', () => {
    expect(currentDialogueCaptureCatalog()).toBeDefined();
    config.goaLoreEnabled = false; expect(currentDialogueCaptureCatalog()).toBeUndefined();
    config.goaLoreEnabled = true; expect(currentDialogueCaptureCatalog()).toBeDefined();
    config.cultureRoleplayEnabled = false; config.faithRoleplayEnabled = false; expect(currentDialogueCaptureCatalog()).toBeUndefined();
    config.faithRoleplayEnabled = true; expect(currentDialogueCaptureCatalog()).toBeDefined();
    config.goaLoreEnabled = false; configureDialogueCapture(config);
    expect(currentDialogueCaptureCatalog()).toBeUndefined();
    config.goaLoreEnabled = true; expect(currentDialogueCaptureCatalog()).toBeDefined();
});


test('added direction cannot crowd a previously fitting letter persona or user portrayal out of its existing budget', async () => {
    const generator = Object.assign(Object.create(LetterReplyGenerator.prototype), {
        config, votcDataPath: data, apiConnection: { context: 50000, calculateTokensFromText: (text: string) => text.length }
    });
    const letter = { sender: game.getPlayer(), recipient: game.getAi(), content: 'Please answer.' };
    config.cultureRoleplayEnabled = false; config.faithRoleplayEnabled = false;
    const original = await generator.buildLetterPrompt(game, letter);
    generator.apiConnection.context = original.length + config.maxTokens + 5;
    config.cultureRoleplayEnabled = true;
    const fitted = await generator.buildLetterPrompt(game, letter);
    expect(fitted).toBe(original); expect(fitted).not.toContain('Character dialogue direction');
});

test('young writer guidance follows the actual actor in chat, group, self-talk, suggestions and letters with Audio off', async () => {
    config.audio = { enabled: false } as any; config.goaLoreEnabled = false;
    game.getPlayer().age = 13; game.getAi().age = 7; game.characters.get(3)!.age = 17;
    const conv = conversation(50000);
    const normal = JSON.stringify(await buildChatPrompt(conv, game.getAi()));
    expect(normal).toContain('Current development for Asha: current game age 7;');
    expect(normal).not.toContain('Current development for Player');
    const group = JSON.stringify(await buildChatPrompt(conv, game.characters.get(3)!, [], game.getAi()));
    expect(group).toContain('Current development for Keeper: current game age 17;');
    expect(group).not.toContain('Current development for Asha');
    expect(JSON.stringify(buildSuggestionPrompt(conv))).toContain('Current development for Player: current game age 13;');
    const generator = Object.assign(Object.create(LetterReplyGenerator.prototype), { config, votcDataPath: data,
        apiConnection: { context: 50000, calculateTokensFromText: (text: string) => text.length } });
    const letter = await generator.buildLetterPrompt(game, { sender: game.getPlayer(), recipient: game.getAi(), content: 'Please answer.' });
    expect(letter).toContain('Current development for Asha: current game age 7;');
    expect(letter).not.toContain('Current development for Player');
    game.characters.delete(2); game.characters.delete(3);
    expect(JSON.stringify(await buildChatPrompt(conv, game.getPlayer()))).toContain('Current development for Player: current game age 13;');
});

test('development stays in the writer through context trimming but never enters summaries, actions, scenes or voice design', async () => {
    config.audio = { enabled: false } as any; config.goaLoreEnabled = false; game.getAi().age = 6;
    const conv = conversation(50000), voice = voiceDesignPrompt(conv, game.getAi());
    const old = { role: 'assistant', name: 'Asha', content: 'Old exchange. '.repeat(800) }; conv.messages.unshift(old);
    const roomy = JSON.stringify(await buildChatPrompt(conv, game.getAi()));
    conv.textGenApiConnection.context = roomy.length - old.content.length + 200;
    const trimmed = JSON.stringify(await buildChatPrompt(conv, game.getAi()));
    expect(trimmed).toContain('current game age 6;'); expect(trimmed).not.toContain(old.content);
    expect(voiceDesignPrompt(conv, game.getAi())).toEqual(voice);
    expect(JSON.stringify(buildSummarizeChatPrompt(conv, game.getAi()))).not.toContain('Current development');
    expect(JSON.stringify(buildSceneDescriptionPrompt(conv))).not.toContain('Current development');
    conv.actions = [{ signature: 'noop', description: 'Wait.', check: () => true, args: [], run: () => '' }];
    conv.actionsApiConnection = { isChat: () => true, complete: jest.fn().mockResolvedValue('<rationale>Wait.</rationale><actions>noop()</actions>') };
    await checkActions(conv, 2, 1); expect(JSON.stringify(conv.actionsApiConnection.complete.mock.calls[0][0])).not.toContain('Current development');
    conv.textGenApiConnection.context = 100;
    await expect(buildChatPrompt(conv, game.getAi())).rejects.toThrow('context');
});

test('current native age wins over the same encounter persona and drops young directions at twenty', async () => {
    const conv = conversation(50000); config.audio = { enabled: false } as any; game.getAi().age = 7;
    configureDevelopmentCapture({ userFolderPath: '/synthetic' } as Config);
    for (const age of ['16', '19', '20+']) {
        for (const line of [`begin/;/${DEVELOPMENT_DIGEST}/;/2`, `age/;/${age}`, 'adult/;/1', `end/;/${DEVELOPMENT_DIGEST}/;/2`]) observeDevelopmentLine('VOTC:DEVELOPMENT/;/' + line);
        expect(bindDevelopment(game.getAi())).toBe(true);
        const text = JSON.stringify(await buildChatPrompt(conv, game.getAi()));
        if (age === '20+') { expect(text).toContain('ordinary adult portrayal'); expect(text).not.toContain('growing abstract thought'); }
        else expect(text).toContain(`current game age ${age};`);
    }
    expect(game.getAi().age).toBe(7);
    configureDevelopmentCapture({ userFolderPath: '' } as Config);
});

test('a young host never overrides the final verified controller policy', async () => {
    game.getAi().age = 7;
    for (const line of capture(2, 'fallen_demon_hunter', 'female')) observeGoaLine(line);
    const prompt = JSON.stringify(await buildChatPrompt(conversation(50000), game.getAi()));
    expect(prompt).toContain('Host age does not establish');
    expect(prompt).not.toContain('shaped by curiosity, fairness');
    const controller = appendGoaContext('', game.getAi(), config, game);
    expect(controller).toContain('controll');
    const last = (await buildChatPrompt(conversation(50000), game.getAi())).at(-1)!.content;
    expect(last.indexOf('Host age does not establish')).toBeLessThan(last.lastIndexOf('controll'));
});
