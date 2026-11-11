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

import * as chronicle from '../../src/main/lorebook/lorebookRuntime';

test('resolved Chronicle accounts reach the actual chat builder with the current actor, while persona stays complete', async () => {
    const spy = jest.spyOn(chronicle, 'lorebookPrompt').mockResolvedValue('SYNTHETIC CHRONICLE ACCOUNT. Guild contracts matter.');
    const prompt = await buildChatPrompt(conversation(), game.getAi());
    const text = convertMessagesToString(prompt, '', '');
    expect(spy.mock.calls[0][1]).toBe(2);
    expect(text).toContain('SYNTHETIC CHRONICLE ACCOUNT');
    expect(text).toContain('PLAYER AUTHORED: Keeps compassion');
    expect(text).toContain('Warcraft context for Asha');
    expect(text).toContain('Speak with me.');
    await buildChatPrompt(conversation(), game.characters.get(3)!, [], game.getAi());
    expect(spy.mock.calls[1][1]).toBe(3);
});
test('optional Chronicle yields before existing facts or current dialogue under context pressure', async () => {
    jest.spyOn(chronicle, 'lorebookPrompt').mockResolvedValue('');
    const conv = conversation();
    const baseline = await buildChatPrompt(conv, game.getAi());
    conv.textGenApiConnection.context = convertMessagesToString(baseline, '', '').length + config.maxTokens + 5;
    jest.mocked(chronicle.lorebookPrompt).mockResolvedValue('SYNTHETIC LARGE CHRONICLE. '.repeat(100));
    const prompt = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
    expect(prompt).not.toContain('SYNTHETIC LARGE CHRONICLE');
    expect(prompt).toContain('PLAYER AUTHORED: Keeps compassion');
    expect(prompt).toContain('Speak with me.');
});
test('the actual letter builder retrieves for the writer and fits optional lore within its existing budget', async () => {
    const spy = jest.spyOn(chronicle, 'lorebookPrompt').mockResolvedValue('SYNTHETIC LETTER CHRONICLE.');
    const generator = Object.assign(Object.create(LetterReplyGenerator.prototype), {
        config, votcDataPath: data, apiConnection: { context: 20000, calculateTokensFromText: (text: string) => text.length }
    });
    const letter = { sender: game.getPlayer(), recipient: game.getAi(), content: 'A question about guilds.' };
    const prompt = await generator.buildLetterPrompt(game, letter);
    expect(spy.mock.calls[0][1]).toBe(2);
    expect(prompt).toContain('SYNTHETIC LETTER CHRONICLE');
    expect(prompt).toContain('PLAYER AUTHORED: Keeps compassion');
    generator.apiConnection.context = prompt.length + config.maxTokens - 1;
    const tight = await generator.buildLetterPrompt(game, letter);
    expect(tight).not.toContain('SYNTHETIC LETTER CHRONICLE');
    expect(tight).toContain('Warcraft context for Asha');
});

test('the actual provider request preserves resolved Chronicle prose and persona without retrieval metadata', async () => {
    jest.spyOn(chronicle, 'lorebookPrompt').mockResolvedValue('SYNTHETIC RESOLVED CHRONICLE. A guild apprenticeship binds a pupil to a master.');
    const prompt = await buildChatPrompt(conversation(), game.getAi());
    const { ApiConnection } = await import('../../src/shared/apiConnection');
    const api = new ApiConnection({ ...config.textGenerationApiConnectionConfig.connection,
        type: 'custom', model: 'fixture-model', key: 'synthetic-only', baseUrl: 'https://provider.invalid/v1', forceInstruct: false }, {}, null);
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: 'Synthetic transport reply.' }, finish_reason: 'stop' }] });
    (api as any).client = { chat: { completions: { create } } };
    await api.complete(prompt, false, { max_tokens: 100 });
    expect(create).toHaveBeenCalledTimes(1);
    const outbound = JSON.stringify(create.mock.calls[0][0]);
    expect(outbound).toContain('SYNTHETIC RESOLVED CHRONICLE');
    expect(outbound).toContain('PLAYER AUTHORED: Keeps compassion');
    expect(outbound).toContain('Warcraft context for Asha');
    expect(outbound).not.toContain('candidate_ids'); expect(outbound).not.toContain('context_fingerprint');
});

test('chat commits disclosure only when the actual prompt retains its lore message', async () => {
    const spy = jest.spyOn(chronicle, 'lorebookPrompt').mockResolvedValue('');
    const conv = conversation(50000);
    const baseline = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '').length;
    const commit = jest.fn();
    spy.mockImplementation(async (...args) => {
        args[6]!.commit = commit;
        return 'SYNTHETIC PROGRESSIVE ACCOUNT. '.repeat(100);
    });
    const roomy = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
    expect(roomy).toContain('SYNTHETIC PROGRESSIVE ACCOUNT'); expect(commit).toHaveBeenLastCalledWith(true);
    conv.textGenApiConnection.context = baseline + config.maxTokens + 5;
    const tight = convertMessagesToString(await buildChatPrompt(conv, game.getAi()), '', '');
    expect(tight).not.toContain('SYNTHETIC PROGRESSIVE ACCOUNT'); expect(commit).toHaveBeenLastCalledWith(false);
    expect(tight).toContain('PLAYER AUTHORED: Keeps compassion');
});

test('an identity-changing trait is recaptured during the existing per-turn probe before the next prompt',async()=>{
    const {EncounterCapture}=require('../../src/main/background/EncounterCapture');
    const catalog=buildGoaCaptureCatalog(config.cultureGameInstallPath,config.userFolderPath)!;
    catalog.traitIds.push('demon_hunter');
    // The real catalogue already contains fallen_demon_hunter; use its accepted frame format.
    const actor=game.getAi();capture(2,'creature_sayaadi','female').forEach(observeGoaLine);
    getVerifiedGoaSnapshot(actor); // Pin the pre-action body as a normal open encounter does.
    const action=require('../../default_userdata/scripts/actions/standard/addTrait.js'),effects:string[]=[];
    action.run(game,(effect:string)=>effects.push(effect),['fallen_demon_hunter'],1,2);
    expect(effects.join('\n')).toContain('fallen_demon_hunter');
    const file=path.join(config.userFolderPath,'run/votc.txt');fs.mkdirSync(path.dirname(file),{recursive:true});
    let bridge:any;
    bridge=new EncounterCapture(()=>({goa:catalog}),()=>{
        if(!fs.existsSync(file))return;const script=fs.readFileSync(file,'utf8');const nonce=script.match(/ack\/;\/([a-f0-9]{24})/)?.[1];
        if(!nonce)return;
        if(script.includes('has_trait = fallen_demon_hunter'))capture(2,'fallen_demon_hunter','female').forEach(observeGoaLine);
        bridge.observe('VOTC:ENCOUNTER/;/ack/;/'+nonce);
    });
    expect(await bridge.capture(config.userFolderPath,[{characterId:2,position:1}],new AbortController().signal,'votc.txt',6000,{languagesOnly:true})).toBe(true);
    const prompt=convertMessagesToString(await buildChatPrompt(conversation(),actor),'','');
    expect(prompt).toContain('controlling demon');
    const {composeGoaContext,finishGoaContext}=require('../../src/main/goa/goaRuntime');
    const context=composeGoaContext('',actor,config,game,'action');expect(finishGoaContext(context.description,context)).toContain('demon');
});
