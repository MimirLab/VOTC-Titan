import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import { Config } from '../../src/shared/Config';
import { GameData } from '../../src/shared/gameData/GameData';
import { buildChatPrompt, convertMessagesToString } from '../../src/main/conversation/promptBuilder';
import { LetterReplyGenerator } from '../../src/main/letter/LetterReplyGenerator';
import { getCultureBackground } from '../../src/main/culture/cultureRuntime';
import { character, paragraph, snapshot } from './fixtures';
import { characterToSnapshot } from '../../src/main/promptWorkbench/GameDataSnapshotCodec';
import { validateCharacterSnapshotV1 } from '../../src/main/promptWorkbench/promptWorkbenchSchemas';

jest.mock('../../src/main/culture/cultureRuntime', () => ({
    ...jest.requireActual('../../src/main/culture/cultureRuntime'), getCultureBackground: jest.fn(), beginCultureForeground: jest.fn(() => jest.fn())
}));
jest.mock('../../src/main/letter/LetterManager', () => ({ LetterManager: { getInstance: () => ({ getLetterSummaries: () => [] }) } }));
jest.mock('../../src/main/diaryManager', () => ({ readDiarySummaries: async () => [] }));
jest.mock('../../src/main/summaryManager', () => ({ readSummaryFile: async () => [], saveSummaryFile: jest.fn() }));

let root: string; let data: string; let config: Config; let game: GameData;
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
    expect(text).toContain('Speaker cultural signal.'); expect(text).not.toContain('Player cultural signal.');
    expect(text).toContain('Compassionate'); expect(text).toContain('PLAYER AUTHORED: Merciful');
    expect(text).toContain('accept, reinterpret, ignore or oppose');
});

test('AI-to-AI uses the actual speaker and removes culture before individual material when context is tight', async () => {
    const actual = game.characters.get(3)!;
    const roomy = await buildChatPrompt(conversation(), actual, [], game.getAi());
    expect(convertMessagesToString(roomy, '', '')).toContain('Other speaker cultural signal.');
    expect(convertMessagesToString(roomy, '', '')).not.toContain('Speaker cultural signal.');
    culturalLookup.mockReturnValue(undefined);
    const core = await buildChatPrompt(conversation(), game.getAi());
    const size = convertMessagesToString(core, '', '').length;
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
    culturalLookup.mockReturnValue(undefined);
    const core = await generator.buildLetterPrompt(game, letter);
    generator.apiConnection.context = core.length + config.maxTokens + 1;
    culturalLookup.mockReturnValue(paragraph);
    const tight = await generator.buildLetterPrompt(game, letter);
    expect(tight).toBe(core);
});

test('disabled or unavailable culture keeps the existing prompt; snapshot archives remain optional', async () => {
    config.cultureRoleplayEnabled = false;
    const prompt = await buildChatPrompt(conversation(), game.getAi());
    expect(culturalLookup).not.toHaveBeenCalled();
    expect(convertMessagesToString(prompt, '', '')).not.toContain('secondary context');
    const person = game.getAi(); const legacy = characterToSnapshot(person);
    expect(validateCharacterSnapshotV1(legacy).cultureSnapshot).toBeUndefined();
    person.cultureSnapshot = snapshot();
    expect(validateCharacterSnapshotV1(characterToSnapshot(person)).cultureSnapshot).toEqual(snapshot());
});
