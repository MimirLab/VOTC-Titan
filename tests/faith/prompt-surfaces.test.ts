import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import { Config } from '../../src/shared/Config';
import { GameData } from '../../src/shared/gameData/GameData';
import { buildChatPrompt, convertMessagesToString } from '../../src/main/conversation/promptBuilder';
import { LetterReplyGenerator } from '../../src/main/letter/LetterReplyGenerator';
import { getCultureBackground } from '../../src/main/culture/cultureRuntime';
import { getRoleplayBackgroundPlacement } from '../../src/main/background/backgroundPrompt';
import { BACKGROUND_BODY_BOUNDARY, BACKGROUND_DISPOSITION_BOUNDARY } from '../../src/main/background/backgroundBodyBoundary';
import { getFaithBackground, getFaithLiveContext, getFaithZealous } from '../../src/main/faith/faithRuntime';
import { snapshot as faithSnapshot, result as faithResult } from './fixtures';
import { character, paragraph, snapshot } from '../culture/fixtures';
import { characterToSnapshot } from '../../src/main/promptWorkbench/GameDataSnapshotCodec';
import { validateCharacterSnapshotV1 } from '../../src/main/promptWorkbench/promptWorkbenchSchemas';
import { SCENE_CATALOGUE_DIGEST } from '../../src/shared/scenes/catalogue.generated';
import { applySceneSnapshot, scenePacket } from '../../src/main/scenes/sceneRuntime';

jest.mock('../../src/main/culture/cultureRuntime', () => ({
    ...jest.requireActual('../../src/main/culture/cultureRuntime'), getCultureBackground: jest.fn(), beginCultureForeground: jest.fn(() => jest.fn())
}));
jest.mock('../../src/main/faith/faithRuntime', () => ({ getFaithBackground: jest.fn(), getFaithLiveContext: jest.fn(), getFaithZealous: jest.fn() }));
jest.mock('../../src/main/letter/LetterManager', () => ({ LetterManager: { getInstance: () => ({ getLetterSummaries: () => [] }) } }));
jest.mock('../../src/main/diaryManager', () => ({ readDiarySummaries: async () => [] }));
jest.mock('../../src/main/summaryManager', () => ({ readSummaryFile: async () => [], saveSummaryFile: jest.fn() }));

let root: string; let data: string; let config: Config; let game: GameData;
const faithLookup = getFaithBackground as jest.MockedFunction<typeof getFaithBackground>;
const zealLookup = getFaithZealous as jest.MockedFunction<typeof getFaithZealous>;
const liveLookup = getFaithLiveContext as jest.MockedFunction<typeof getFaithLiveContext>;
const culturalLookup = getCultureBackground as jest.MockedFunction<typeof getCultureBackground>;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'votc-prompts-test-')); data = path.join(root, 'votc_data');
    (app.getPath as jest.Mock).mockReturnValue(root);
    (app as any).getAppPath = () => process.cwd();
    const desc = path.join(data, 'scripts', 'prompts', 'description', 'custom'); fs.mkdirSync(desc, { recursive: true });
    fs.writeFileSync(path.join(desc, 'person.js'), 'module.exports = (_game, person) => `Individual: ${person.fullName}; traits: ${person.traits.map(t => t.name).join(", ")}`;');
    fs.mkdirSync(path.join(data, 'configs', 'prompts'), { recursive: true });
    fs.copyFileSync('default_userdata/configs/prompts/en.json', path.join(data, 'configs', 'prompts', 'en.json'));
    fs.mkdirSync(path.join(data, 'character_descriptions'), { recursive: true });
    fs.writeFileSync(path.join(data, 'character_descriptions', '1.json'), JSON.stringify({ 2: 'PLAYER AUTHORED: Merciful despite social pressure.' }));
    config = Object.assign(Object.create(Config.prototype), JSON.parse(fs.readFileSync('default_userdata/configs/default_config.json', 'utf8')));
    const examples = path.join(data, 'scripts', 'prompts', 'example messages', 'custom'); fs.mkdirSync(examples, { recursive: true });
    fs.writeFileSync(path.join(examples, 'empty.js'), 'module.exports = () => [];');
    config.selectedDescScript = 'custom/person.js'; config.selectedExMsgScript = 'empty.js'; config.maxTokens = 100; config.maxMemoryTokens = 100;
    game = new GameData(['1', 'Player', '2', 'Speaker', '1066.9.15', 'votc_scene_council', 'Synthetic county', 'Player', '0']);
    game.characters.set(1, character(1, 'Player')); game.characters.set(2, character(2, 'Speaker')); game.characters.set(3, character(3, 'Other speaker'));
    faithLookup.mockImplementation(person => faithResult().paragraph + ' ' + person.fullName + ' faith signal.');
    liveLookup.mockReturnValue(undefined); zealLookup.mockReset();
    culturalLookup.mockImplementation(person => `${paragraph} ${person.fullName} cultural signal.`);
    jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

function conversation(context = 10000): any {
    return { config, gameData: game, votcDataPath: data, messages: [{ role: 'user', content: 'Speak with me.', name: 'Player' }],
        chatWindow: { window: { webContents: { send: jest.fn() } } }, getBranchVisibleSummaries: () => [], letterManager: { getLetterSummaries: () => [] },
        textGenApiConnection: { context, calculateTokensFromText: (text: string) => text.length }, translations: {} };
}

test('dialogue includes exactly the current speaker culture alongside traits and the player description', async () => {
    const prompt = await buildChatPrompt(conversation(), game.getAi());
    const text = convertMessagesToString(prompt, '', '');
    expect(culturalLookup).toHaveBeenCalledWith(game.getAi());
    expect(text.match(/secondary context/g)).toHaveLength(1);
    expect(text).toContain('Speaker faith signal.'); expect(text).not.toContain('Player faith signal.');
    expect(text).toContain('Speaker cultural signal.'); expect(text).not.toContain('Player cultural signal.');
    expect(text).toContain('Compassionate'); expect(text).toContain('PLAYER AUTHORED: Merciful');
    expect(text).toContain('accept, reinterpret, ignore or oppose');
});

test('AI-to-AI uses the actual speaker and removes culture before individual material when context is tight', async () => {
    const actual = game.characters.get(3)!;
    const roomy = await buildChatPrompt(conversation(), actual, [], game.getAi());
    expect(convertMessagesToString(roomy, '', '')).toContain('Other speaker cultural signal.');
    expect(convertMessagesToString(roomy, '', '')).not.toContain('Speaker cultural signal.');
    faithLookup.mockReturnValue(undefined);
    culturalLookup.mockReturnValue(undefined);
    const core = await buildChatPrompt(conversation(), game.getAi());
    const size = convertMessagesToString(core, '', '').length;
    faithLookup.mockReturnValue(faithResult().paragraph);
    culturalLookup.mockReturnValue(paragraph);
    const tight = await buildChatPrompt(conversation(size + config.maxTokens + 1), game.getAi());
    expect(convertMessagesToString(tight, '', '')).not.toContain('secondary context');
    expect(convertMessagesToString(tight, '', '')).toContain('Compassionate');
    expect(convertMessagesToString(tight, '', '')).toContain('PLAYER AUTHORED: Merciful');
});

test('letters use the recipient writing the reply and omit the optional culture on context pressure', async () => {
    const generator = Object.create(LetterReplyGenerator.prototype) as any;
    generator.config = config; generator.votcDataPath = data;
    generator.apiConnection = { context: 10000, calculateTokensFromText: (text: string) => text.length };
    const letter = { sender: game.getPlayer(), recipient: game.getAi(), content: 'Synthetic letter body.' };
    const prompt = await generator.buildLetterPrompt(game, letter);
    expect(culturalLookup).toHaveBeenCalledWith(letter.recipient);
    expect(prompt.match(/secondary context/g)).toHaveLength(1);
    expect(prompt).toContain('Speaker cultural signal.'); expect(prompt).not.toContain('Player cultural signal.');
    expect(prompt).toContain('PLAYER AUTHORED: Merciful');
    faithLookup.mockReturnValue(undefined);
    culturalLookup.mockReturnValue(undefined);
    const core = await generator.buildLetterPrompt(game, letter);
    generator.apiConnection.context = core.length + config.maxTokens + 1;
    faithLookup.mockReturnValue(faithResult().paragraph);
    culturalLookup.mockReturnValue(paragraph);
    const tight = await generator.buildLetterPrompt(game, letter);
    expect(tight).toBe(core);
});

test('disabled or unavailable culture keeps the existing prompt; snapshot archives remain optional', async () => {
    config.cultureRoleplayEnabled = false; config.faithRoleplayEnabled = false;
    const prompt = await buildChatPrompt(conversation(), game.getAi());
    expect(culturalLookup).not.toHaveBeenCalled();
    expect(convertMessagesToString(prompt, '', '')).not.toContain('secondary context');
    expect(faithLookup).not.toHaveBeenCalled();
    const person = game.getAi(); const legacy = characterToSnapshot(person);
    expect(validateCharacterSnapshotV1(legacy).cultureSnapshot).toBeUndefined();
    person.faithSnapshot = faithSnapshot(); person.faithLiveContext = { fervor: 65 };
    expect(validateCharacterSnapshotV1(characterToSnapshot(person)).faithSnapshot).toEqual(faithSnapshot());
    expect(validateCharacterSnapshotV1(characterToSnapshot(person)).faithLiveContext).toEqual({ fervor: 65 });
    person.cultureSnapshot = snapshot();
    expect(validateCharacterSnapshotV1(characterToSnapshot(person)).cultureSnapshot).toEqual(snapshot());
});


test.each([[true, false], [false, true], [true, true], [false, false]])('culture/faith toggles remain independent (%s, %s)', async (culture, faith) => {
    config.cultureRoleplayEnabled = culture; config.faithRoleplayEnabled = faith;
    const text = convertMessagesToString(await buildChatPrompt(conversation(), game.getAi()), '', '');
    expect(text.includes('Speaker cultural signal.')).toBe(culture);
    expect(text.includes('Speaker faith signal.')).toBe(faith);
    expect(text).toContain('Compassionate');
});

test.each([[true, false], [false, true], [true, true], [false, false]])('cultural body boundary reaches dialogue and letters only with culture (%s, %s)', async (culture, faith) => {
    config.cultureRoleplayEnabled = culture; config.faithRoleplayEnabled = faith;
    const actor = game.getAi();
    actor.traits.push({ id: 'creature_human', category: 'Racial', name: 'Human', desc: 'Known body.' });
    const chat = convertMessagesToString(await buildChatPrompt(conversation(20000), actor), '', '');
    const generator = Object.assign(Object.create(LetterReplyGenerator.prototype), {
        config, votcDataPath: data, apiConnection: { context: 20000, calculateTokensFromText: (text: string) => text.length }
    });
    const letter = await generator.buildLetterPrompt(game, { sender: game.getPlayer(), recipient: actor, content: 'Please share a meal.' });
    for (const text of [chat, letter]) {
        expect(text.split(BACKGROUND_BODY_BOUNDARY).length - 1).toBe(culture ? 1 : 0);
        if (culture && !faith) expect(text).toContain(BACKGROUND_DISPOSITION_BOUNDARY);
        expect(text).toContain('Human');
        expect(text).toContain('PLAYER AUTHORED: Merciful');
    }
});

test('fresh faith circumstances can accompany roleplay while a new profile is still pending', async () => {
    faithLookup.mockReturnValue(undefined); liveLookup.mockReturnValue({ fervor: 20, religiousHead: 'Observed leader' });
    const text = convertMessagesToString(await buildChatPrompt(conversation(), game.getAi()), '', '');
    expect(text).toContain('Observed current faith circumstances'); expect(text).toContain('Observed leader');
    expect(text).toContain('do not determine personal conviction');
});

test.each([[undefined, 'Zealous', true], [true, 'Fanatique', true], [false, 'Zealous', false], [undefined, 'Patient', false]])(
    'Zealous emphasis uses the actual speaker and canonical observation (%s, %s)', async (observed, name, emphasized) => {
        const speaker = game.getAi(); speaker.traits.push({ category: 'personality', name, desc: name });
        zealLookup.mockImplementation(person => person === speaker ? observed : false);
        const text = convertMessagesToString(await buildChatPrompt(conversation(), speaker), '', '');
        expect(text.includes('Faith emphasis for this Zealous character:')).toBe(emphasized);
        expect(text).toContain('Speaker faith signal.'); expect(text).toContain('Compassionate');
        expect(text).toContain('PLAYER AUTHORED: Merciful');
        expect(text).toContain('does not grant the person magical abilities');
        const other = game.characters.get(3)!;
        const aiToAi = convertMessagesToString(await buildChatPrompt(conversation(), other, [], speaker), '', '');
        expect(aiToAi).not.toContain('Faith emphasis for this Zealous character:');
        const writer = Object.assign(Object.create(LetterReplyGenerator.prototype), {
            config, votcDataPath: data, apiConnection: { context: 10000, calculateTokensFromText: (s: string) => s.length }
        });
        const letter = await writer.buildLetterPrompt(game, { sender: game.getPlayer(), recipient: speaker, content: 'A question of belief.' });
        expect(letter.includes('Faith emphasis for this Zealous character:')).toBe(emphasized);
    }
);

test('Zealous emphasis cannot strengthen culture alone or displace individual context under budget pressure', async () => {
    const speaker = game.getAi(); speaker.traits.push({ category: 'personality', name: 'Zealous', desc: 'Zealous' });
    zealLookup.mockReturnValue(true);
    config.faithRoleplayEnabled = false;
    expect(convertMessagesToString(await buildChatPrompt(conversation(), speaker), '', '')).not.toContain('Faith emphasis');
    config.faithRoleplayEnabled = true;
    faithLookup.mockReturnValue(undefined); culturalLookup.mockReturnValue(undefined);
    const core = convertMessagesToString(await buildChatPrompt(conversation(), speaker), '', '');
    faithLookup.mockReturnValue(faithResult().paragraph); culturalLookup.mockReturnValue(paragraph);
    const tight = convertMessagesToString(await buildChatPrompt(conversation(core.length + config.maxTokens + 1), speaker), '', '');
    expect(tight).not.toContain('Faith emphasis'); expect(tight).toContain('Zealous'); expect(tight).toContain('PLAYER AUTHORED: Merciful');
});

test('court context coexists with both backgrounds and the actual speaker’s Zealous emphasis', async () => {
    zealLookup.mockImplementation(person => person === game.getAi());
    expect(applySceneSnapshot(game, { schema: 1, catalogue: SCENE_CATALOGUE_DIGEST, mode: 'goa', anchorId: 1,
        selected: 'titan_mogu_court', location: 'Observed province', controller: 'Observed controller',
        terrain: 'plains', style: 'mogu', culture: 'unknown', settled: true, coastal: false,
        regions: [], worldStates: [], eligible: ['titan_mogu_court'] })).toBe(true);
    const text = convertMessagesToString(await buildChatPrompt(conversation(20000), game.getAi()), '', '');
    expect(text).toContain(scenePacket(game));
    expect(text).toContain('Speaker cultural signal.'); expect(text).toContain('Speaker faith signal.');
    expect(text).toContain('Faith emphasis for this Zealous character:');
    expect(text).toContain('secondary context'); expect(text).toContain('Compassionate');
    expect(text).toContain('PLAYER AUTHORED: Merciful');
    expect(text).not.toContain('Player faith signal.');
});

test('ready Zealous faith follows the current exchange while culture stays before history', async () => {
    zealLookup.mockReturnValue(true);
    const conv = conversation(30000);
    conv.messages.unshift({ role: 'assistant', name: 'Speaker', content: 'Earlier personal conviction remains.' });
    const prompt = await buildChatPrompt(conv, game.getAi());
    const text = convertMessagesToString(prompt, '', '');
    expect(text.indexOf('Speaker cultural signal.')).toBeLessThan(text.indexOf('Earlier personal conviction remains.'));
    expect(text.indexOf('Speaker faith signal.')).toBeGreaterThan(text.indexOf('Speak with me.'));
    expect(text.match(/Speaker faith signal\./g)).toHaveLength(1);
    expect(prompt[prompt.length - 1].role).toBe('system');
    expect(text).toContain('PLAYER AUTHORED: Merciful');
    expect(text).toContain(BACKGROUND_BODY_BOUNDARY);
    expect(conv.messages[0].content).toBe('Earlier personal conviction remains.');
});

test('shared fervor and a false canonical flag cannot move legacy English zeal late', () => {
    const speaker = game.getAi(); speaker.traits.push({ category: 'personality', name: 'Zealous', desc: '' });
    liveLookup.mockReturnValue({ fervor: 100 }); zealLookup.mockReturnValue(false);
    const placement = getRoleplayBackgroundPlacement(speaker, config);
    expect(placement.faith).toBeUndefined();
    expect(placement.early).toContain('Speaker faith signal.');
    zealLookup.mockReturnValue(true); faithLookup.mockReturnValue(undefined);
    expect(getRoleplayBackgroundPlacement(speaker, config).faith).toBeUndefined();
    config.faithRoleplayEnabled = false;
    expect(getRoleplayBackgroundPlacement(speaker, config).faith).toBeUndefined();
});

test('chat drops optional culture before ready Zealous faith and then keeps the complete reply directive', async () => {
    zealLookup.mockReturnValue(true);
    config.cultureRoleplayEnabled = false;
    const faithOnly = await buildChatPrompt(conversation(30000), game.getAi());
    const faithSize = convertMessagesToString(faithOnly, '', '').length;
    config.cultureRoleplayEnabled = true;
    const reduced = convertMessagesToString(await buildChatPrompt(conversation(faithSize + config.maxTokens + 1), game.getAi()), '', '');
    expect(reduced).toContain('Speaker faith signal.'); expect(reduced).not.toContain('Speaker cultural signal.');
    faithLookup.mockReturnValue(undefined); culturalLookup.mockReturnValue(undefined);
    const core = convertMessagesToString(await buildChatPrompt(conversation(30000), game.getAi()), '', '');
    faithLookup.mockReturnValue(faithResult().paragraph + ' Speaker faith signal.'); culturalLookup.mockReturnValue(paragraph);
    const tight = convertMessagesToString(await buildChatPrompt(conversation(core.length + config.maxTokens + 30), game.getAi()), '', '');
    expect(tight).not.toContain('Speaker faith signal.'); expect(tight).not.toContain('Faith emphasis');
    expect(tight).toContain('Speak with me.'); expect(tight).toContain('PLAYER AUTHORED: Merciful');
    expect(tight).toContain('System instruction: You are Speaker.');
    expect(tight).toContain('Write a reply for your character only.');
});

test('letters place ready Zealous faith after the incoming letter and prefer it over optional culture', async () => {
    zealLookup.mockReturnValue(true);
    const generator = Object.assign(Object.create(LetterReplyGenerator.prototype), {
        config, votcDataPath: data, apiConnection: { context: 30000, calculateTokensFromText: (text: string) => text.length }
    });
    const letter = { sender: game.getPlayer(), recipient: game.getAi(), content: 'Incoming question about a costly conviction.' };
    config.cultureRoleplayEnabled = false;
    const faithOnly = await generator.buildLetterPrompt(game, letter);
    expect(faithOnly.indexOf('Speaker faith signal.')).toBeGreaterThan(faithOnly.indexOf(letter.content));
    config.cultureRoleplayEnabled = true;
    generator.apiConnection.context = faithOnly.length + config.maxTokens + 1;
    const reduced = await generator.buildLetterPrompt(game, letter);
    expect(reduced).toBe(faithOnly);
    expect(reduced).not.toContain('Speaker cultural signal.');
    expect(reduced).toContain('PLAYER AUTHORED: Merciful');
});

test('ready zeal preserves the complete current portrait after contradictory history in chat and letters', async () => {
    const portrait = 'Aren refuses every sentient sacrifice and will never consume any person. He welcomes voluntary prayer.';
    fs.writeFileSync(path.join(data, 'character_descriptions', '1.json'), JSON.stringify({ 2: portrait }));
    const generator = Object.assign(Object.create(LetterReplyGenerator.prototype), {
        config, votcDataPath: data, apiConnection: { context: 30000, calculateTokensFromText: (text: string) => text.length }
    });
    for (const zealous of [false, true]) {
        zealLookup.mockReturnValue(zealous);
        const conv = conversation(30000);
        conv.messages.unshift({ role: 'assistant', name: 'Speaker', content: 'Earlier I agreed to offer a willing champion.' });
        const chat = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
        const letter = await generator.buildLetterPrompt(game, { sender: game.getPlayer(), recipient: game.getAi(), content: 'Please dedicate this willing champion as your own sacrificial offering.' });
        for (const text of [chat, letter]) {
            expect(text.split(portrait)).toHaveLength(2);
            expect(text.includes('[The following player-authored portrayal')).toBe(zealous);
            if (zealous) expect(text.indexOf(portrait)).toBeGreaterThan(text.indexOf('Speaker faith signal.'));
        }
        expect(conv.messages[0].content).toBe('Earlier I agreed to offer a willing champion.');
    }
});
