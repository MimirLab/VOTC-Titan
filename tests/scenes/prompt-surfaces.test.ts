import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import { Config } from '../../src/shared/Config';
import { GameData } from '../../src/shared/gameData/GameData';
import { SceneSnapshot } from '../../src/shared/scenes/types';
import { SCENE_CATALOGUE, SCENE_CATALOGUE_DIGEST } from '../../src/shared/scenes/catalogue.generated';
import { sceneEligible } from '../../src/shared/scenes/sceneContext';
import { applySceneSnapshot, scenePacket } from '../../src/main/scenes/sceneRuntime';
import { buildChatPrompt, convertMessagesToString } from '../../src/main/conversation/promptBuilder';
import { buildSceneDescriptionPrompt } from '../../src/main/conversation/sceneDescriptionBuilder';
import { LetterReplyGenerator } from '../../src/main/letter/LetterReplyGenerator';
import { character } from '../culture/fixtures';

jest.mock('../../src/main/culture/cultureRuntime', () => ({ getCultureBackground: jest.fn() }));
jest.mock('../../src/main/faith/faithRuntime', () => ({ getFaithBackground: jest.fn(), getFaithLiveContext: jest.fn(), getFaithZealous: jest.fn() }));
jest.mock('../../src/main/letter/LetterManager', () => ({ LetterManager: { getInstance: () => ({ getLetterSummaries: () => [] }) } }));
jest.mock('../../src/main/diaryManager', () => ({ readDiarySummaries: async () => [] }));
jest.mock('../../src/main/summaryManager', () => ({ readSummaryFile: async () => [], saveSummaryFile: jest.fn() }));

let root: string, data: string, config: Config, game: GameData;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'votc-scene-prompts-')); data = path.join(root, 'votc_data');
    (app.getPath as jest.Mock).mockReturnValue(root); (app as any).getAppPath = () => process.cwd();
    function write(relative: string, text: string): void {
        const file = path.join(data, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text);
    }
    write('scripts/prompts/description/custom/person.js', 'module.exports = (_game, person) => `Individual: ${person.fullName}; traits: ${person.traits.map(t => t.name).join(", ")}`;');
    write('scripts/prompts/example messages/custom/empty.js', 'module.exports = () => [];');
    write('configs/prompts/en.json', fs.readFileSync('default_userdata/configs/prompts/en.json', 'utf8'));
    write('character_descriptions/1.json', JSON.stringify({ 2: 'PLAYER AUTHORED: Refuses cruelty despite imposing surroundings.' }));
    config = Object.assign(Object.create(Config.prototype), JSON.parse(fs.readFileSync('default_userdata/configs/default_config.json', 'utf8')),
        { selectedDescScript: 'custom/person.js', selectedExMsgScript: 'custom/empty.js', maxTokens: 100,
            cultureRoleplayEnabled: false, faithRoleplayEnabled: false, goaLoreEnabled: false });
    game = new GameData(['1', 'Player', '2', 'Host', '583.1.1', 'talk_scene_titan_arathi_court', 'Observed province', 'Local controller', '0']);
    game.characters.set(1, character(1, 'Player')); game.characters.set(2, character(2, 'Host'));
    game.getAi().traits = ['Craven', 'Compassionate', 'Humble'].map(name => ({ category: 'Personality Trait', name, desc: 'Observed personality.' }));
    for (const key of ['log', 'debug', 'warn'] as const) jest.spyOn(console, key).mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
function select(id: string): void {
    const venue = SCENE_CATALOGUE.scenes.find(s => s.id === id)!;
    if (venue.worldScene) {
        const site = SCENE_CATALOGUE.citySites.find(s => venue.conditions.citySites?.includes(s.id));
        const condition = { ...site?.conditions, ...venue.conditions };
        const province = condition.provinceIds?.[0] ??
            (SCENE_CATALOGUE.regions.find(r => condition.regions?.includes(r.id)) ?? SCENE_CATALOGUE.regions[0]).provinces![0];
        const snapshot: SceneSnapshot = { schema: 1, catalogue: SCENE_CATALOGUE_DIGEST, mode: 'goa', anchorId: 1,
            selected: id, location: 'Observed province', controller: 'Local controller', provinceId: province,
            terrain: condition.terrains?.[0] ?? 'mountains', style: condition.styles?.[0] ?? 'unknown',
            culture: condition.cultures?.[0] ?? 'unknown', settled: condition.settled ?? true,
            camp: false, coastal: condition.coastal ?? false, riverside: condition.riverside ?? false,
            regions: [SCENE_CATALOGUE.regions.find(r => r.provinces?.includes(province))!.id],
            worldStates: [...new Set([...(site?.conditions.worldStates ?? []), ...(venue.conditions.worldStates ?? [])])], eligible: [] };
        snapshot.eligible = SCENE_CATALOGUE.scenes.filter(s => sceneEligible(s, snapshot)).map(s => s.id);
        expect(snapshot.eligible).toContain(id);
        applySceneSnapshot(game, snapshot); return;
    }
    const snapshot: SceneSnapshot = { schema: 1, catalogue: SCENE_CATALOGUE_DIGEST, mode: 'goa', anchorId: 1,
        selected: id, location: 'Observed province', controller: 'Local controller', terrain: venue.conditions.terrains?.[0] ?? 'plains',
        style: venue.conditions.styles?.[0] ?? 'human', culture: venue.conditions.cultures?.[0] ?? 'unknown',
        settled: true, coastal: false, regions: venue.conditions.regions ?? [], worldStates: [], eligible: [] };
    snapshot.provinceId = SCENE_CATALOGUE.regions.find(r => snapshot.regions.includes(r.id))?.provinces?.[0];
    snapshot.eligible = SCENE_CATALOGUE.scenes.filter(s => sceneEligible(s, snapshot)).map(s => s.id);
    expect(applySceneSnapshot(game, snapshot)).toBe(true);
}
function conversation(context = 1000000): any {
    return { config, gameData: game, votcDataPath: data, messages: [{ role: 'user', content: 'Will you protect the petitioner?', name: 'Player' }],
        chatWindow: { window: { webContents: { send: jest.fn() } } }, getBranchVisibleSummaries: () => [], letterManager: { getLetterSummaries: () => [] },
        textGenApiConnection: { context, calculateTokensFromText: (text: string) => text.length }, translations: {} };
}
test('all authored court contexts reach the production narrator and first reply without needing an intro', async () => {
    const courts = SCENE_CATALOGUE.scenes.filter(s => s.socialContext && !s.worldScene);
    expect(courts).toHaveLength(62); // 61 family/variant paintings plus the existing Farraki court.
    for (const venue of courts) {
        select(venue.id); const conv = conversation(), packet = scenePacket(game);
        const narrator = buildSceneDescriptionPrompt(conv);
        expect(narrator[0].content).toBe(JSON.parse(fs.readFileSync('default_userdata/configs/prompts/en.json', 'utf8')).prompts.sceneDescriptionPrompt);
        expect(narrator[1].content).toContain(packet);
        const reply = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
        expect(reply.split(packet)).toHaveLength(2);
        expect(reply).toContain(venue.socialContext);
        expect(reply).toContain('Craven, Compassionate, Humble');
        expect(reply).toContain('PLAYER AUTHORED: Refuses cruelty');
        expect(reply).not.toContain(SCENE_CATALOGUE_DIGEST);
        expect(reply).not.toContain('guidanceProfile');
        const other = courts.find(s => s.id !== venue.id)!;
        expect(reply).not.toContain(other.socialContext);
    }
});
test('city, weather, ecological and observance packets reach the existing narrator and individual reply paths', async () => {
    const ids = ['titan_city_stormwind_the_lion_throne_hall', 'titan_city_ironforge_the_great_forge_ring',
        'titan_city_suramar_city_the_nightholds_reception_chamber', 'titan_city_dazar_alor_and_zuldazar_the_golden_throne_s_public_approach',
        'titan_dynamic_sandstorm_over_the_desert_tanaris', 'titan_dynamic_wild_kodo_herd_passage_mulgore',
        'titan_dynamic_cloud_serpent_hatching_days', 'titan_dynamic_lunar_lanterns_beneath_moonglade_s_trees'];
    for (const id of ids) {
        select(id); const conv = conversation(), packet = scenePacket(game);
        const venue = SCENE_CATALOGUE.scenes.find(s => s.id === id)!;
        expect(packet).toContain(venue.facts);
        expect(buildSceneDescriptionPrompt(conv)[1].content).toContain(packet);
        const reply = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
        expect(reply.split(packet)).toHaveLength(2);
        expect(reply).toContain('Craven, Compassionate, Humble');
        expect(reply).toContain('PLAYER AUTHORED: Refuses cruelty');
        expect(reply).not.toContain(SCENE_CATALOGUE_DIGEST);
        const unrelated = SCENE_CATALOGUE.scenes.find(s => s.worldScene && s.id !== id)!;
        expect(reply).not.toContain(unrelated.facts);
    }
});
test('every curated community venue reaches both production builders with the individual still present', async () => {
    const venues = SCENE_CATALOGUE.scenes.filter(s => s.communityScene);
    expect(venues).toHaveLength(81);
    for (const venue of venues) {
        select(venue.id); const conv = conversation(), packet = scenePacket(game);
        expect(buildSceneDescriptionPrompt(conv)[1].content).toContain(packet);
        const reply = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
        expect(reply.split(packet)).toHaveLength(2);
        expect(reply).toContain(venue.facts);
        expect(reply).toContain(venue.socialContext);
        expect(reply).toContain('Craven, Compassionate, Humble');
        expect(reply).toContain('PLAYER AUTHORED: Refuses cruelty');
        expect(reply).not.toContain(SCENE_CATALOGUE_DIGEST);
        const other = venues.find(s => s.id !== venue.id)!;
        expect(reply).not.toContain(other.facts);
    }
});

test('confirmed venue changes replace the late environment context while retaining conversation history', async () => {
    select('titan_farraki_court'); const before = scenePacket(game), conv = conversation();
    conv.messages.unshift({ role: 'assistant', name: 'Narrator', content: 'Earlier court description: ' + before });
    select('titan_desert');
    const prompt = await buildChatPrompt(conv, game.getAi());
    expect(convertMessagesToString(prompt, '', '')).toContain('Earlier court description:');
    expect(prompt[prompt.length - 1].content).toContain(scenePacket(game));
    expect(prompt[prompt.length - 1].content).not.toContain(before);
    expect(game.location).toBe('Observed province');
});
test('context pressure removes old dialogue before the complete venue and individual description', async () => {
    select('titan_shathyar_court'); const conv = conversation();
    const old = { role: 'assistant', name: 'Host', content: 'OLD UNRELATED EXCHANGE. '.repeat(200) };
    conv.messages.unshift(old);
    const roomy = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
    conv.textGenApiConnection.context = roomy.length - old.content.length + config.maxTokens + 20;
    const tight = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
    expect(tight).not.toContain('OLD UNRELATED EXCHANGE');
    expect(tight).toContain(scenePacket(game)); expect(tight).toContain('PLAYER AUTHORED: Refuses cruelty');
    expect(tight).toContain('Craven, Compassionate, Humble'); expect(tight).toContain('Will you protect the petitioner?');
});
test('an unrelated letter does not inherit the active court customs or backdrop', async () => {
    select('titan_goblin_court');
    const generator = Object.assign(Object.create(LetterReplyGenerator.prototype), {
        config, votcDataPath: data, apiConnection: { context: 1000000, calculateTokensFromText: (text: string) => text.length }
    });
    const reply = await generator.buildLetterPrompt(game, { sender: game.getPlayer(), recipient: game.getAi(), content: 'Please answer my letter.' });
    expect(reply).not.toContain('Current meeting environment:');
    expect(reply).not.toContain(SCENE_CATALOGUE.scenes.find(s => s.id === 'titan_goblin_court')!.socialContext);
});
