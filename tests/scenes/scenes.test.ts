import fs from 'fs';
import path from 'path';
import { GameData } from '../../src/shared/gameData/GameData';
import { SCENE_CATALOGUE, SCENE_CATALOGUE_DIGEST as digest } from '../../src/shared/scenes/catalogue.generated';
import { SceneSnapshot } from '../../src/shared/scenes/types';
import { eligibleScenes, sceneEligible, resolveScene } from '../../src/shared/scenes/sceneContext';
import { SceneLogReader } from '../../src/shared/scenes/sceneLog';
import { applySceneSnapshot, runActionWithScenePolicy, waitForSceneSelection, actionForScene } from '../../src/main/scenes/sceneRuntime';
import { Action } from '../../src/main/ts/conversation_interfaces';
import { parseCk3Script } from '../../src/main/culture/ck3Script';
import { trimGoaPrompt } from '../../src/main/goa/goaPromptBudget';
import { sceneDisplayName } from '../../src/shared/scenes/sceneDisplay';

function snapshot(change: Partial<SceneSnapshot> = {}): SceneSnapshot {
    const s: SceneSnapshot = { schema: 1, catalogue: digest, mode: 'goa', anchorId: 1,
        selected: 'titan_farraki_court', location: "Zul'Farrak", controller: 'Test ruler',
        terrain: 'desert', style: 'zulian', culture: 'unknown', regions: ['tanaris'], settled: true, camp: false, coastal: false,
        worldStates: [], eligible: [], ...change };
    s.provinceId ??= SCENE_CATALOGUE.regions.find(r => s.regions.includes(r.id))?.provinces?.[0];
    s.riverside ??= false;
    s.eligible = SCENE_CATALOGUE.scenes.filter(scene => sceneEligible(scene, s)).map(scene => scene.id);
    return s;
}
function records(s: SceneSnapshot): string[] {
    const m = 'VOTC:TITAN_SCENE/;/';
    const location = s.provinceId && !s.location.includes('PROVINCE,') ? `\x15ONCLICK:PROVINCE,${s.provinceId} \x15L;${s.location}\x15!` : s.location;
    return [m + `begin/;/1/;/${s.catalogue}/;/${s.mode}/;/${s.anchorId}/;/talk_scene_${s.selected}/;/${location}/;/${s.controller}`,
        ...['terrain', 'style', 'culture', 'settled', 'camp', 'coastal', 'riverside'].map(k => m + 'fact/;/' + k + '/;/' + (typeof (s as any)[k] === 'boolean' ? ((s as any)[k] ? 'yes' : 'no') : (s as any)[k])),
        ...SCENE_CATALOGUE.worldStates.map(state => m + 'fact/;/world_state/;/' + state.id + '=' + (s.worldStates.includes(state.id) ? 'yes' : 'no')),
        ...s.regions.map(r => m + 'fact/;/region/;/' + r),
        ...s.eligible.map(r => m + 'fact/;/eligible/;/' + r), m + 'end/;/' + s.catalogue];
}
function data(s = snapshot()): GameData {
    const d = new GameData(['1', 'Player', '2', 'Visitor', '600.1.1', 'talk_scene_' + s.selected, 'old location', 'old controller', '0']);
    applySceneSnapshot(d, s); return d;
}
const action = { signature: 'changeLocation', args: [{ name: 'location', type: 'enum', desc: '' }],
    run: jest.fn(), check: () => true, description: '', chatMessage: () => ({}), chatMessageClass: '' } as Action;

test('display names keep canonical identifiers out of scene labels without changing saved IDs', () => {
    expect(sceneDisplayName('titan_farraki_court')).toBe('Sandstone Audience Court');
    expect(sceneDisplayName('talk_scene_titan_desert')).toBe('Open Desert');
    expect(sceneDisplayName('council_chamber')).toBe('council chamber');
    expect(sceneDisplayName('An archived custom room')).toBe('An archived custom room');
});

test('local culture and venue purposes differ; a visitor does not change local architecture', () => {
    const farraki = snapshot();
    expect(eligibleScenes(farraki).map(s => s.id)).toContain('titan_farraki_court');
    expect(eligibleScenes(farraki).map(s => s.id)).not.toContain('titan_human_inn');
    const jungle = snapshot({ terrain: 'jungle', regions: [], selected: 'titan_jungle' });
    expect(eligibleScenes(jungle).map(s => s.id)).not.toContain('titan_farraki_court');
    const dwarf = snapshot({ style: 'dwarven', regions: [], selected: 'titan_dwarven_ale_hall' });
    const human = snapshot({ style: 'human', regions: [], selected: 'titan_human_inn' });
    expect(resolveScene(dwarf)?.packet).toContain('copper brewing vessels');
    expect(resolveScene(human)?.packet).toContain('timber-and-stone inn');
    const d = data(); (d as any).visitor = { traits: ['undead'], culture: 'Undead' };
    expect(resolveScene(d.sceneSnapshot)?.asset).toBe('titan_scenes/farraki_court.dds');
});

test('Kaldorei architecture and ancient regional biome require both regional and live cultural evidence', () => {
    const s = snapshot({ style: 'kaldorei', terrain: 'forest', regions: ['ashenvale'], selected: 'titan_kaldorei_lodge' });
    expect(resolveScene(s)?.packet).toContain('twilight');
    expect(resolveScene(s)?.packet).toContain('sweeping curved timber');
    expect(resolveScene(snapshot({ ...s, regions: ['tanaris'] }))).toBeUndefined();
    expect(resolveScene(snapshot({ ...s, settled: false }))).toBeUndefined();
    expect(resolveScene(snapshot({ ...s, style: 'unknown' }))).toBeUndefined();
});

test('unknown/hybrid composition falls back to observed terrain; coast and buildings require evidence', () => {
    const s = snapshot({ style: 'unknown', selected: 'titan_region_tanaris_white_gold_dune_country', settled: false });
    expect(eligibleScenes(s).map(s => s.id)).toEqual(['titan_region_tanaris_white_gold_dune_country']);
    expect(eligibleScenes(snapshot({ coastal: true })).map(s => s.id)).toContain('titan_region_tanaris_turquoise_desert_coast');
    expect(eligibleScenes(snapshot({ settled: false })).map(s => s.id)).not.toContain('titan_farraki_court');
    const future = { ...SCENE_CATALOGUE.scenes[0], conditions: { worldStates: ['rebuilt_landmark'] } };
    expect(sceneEligible(future, s)).toBe(false);
    expect(sceneEligible(future, { ...s, worldStates: ['rebuilt_landmark'] })).toBe(true);
});

test('complete debug-log transactions resolve; interrupted, malformed and version-mismatched captures do not', () => {
    const s = snapshot(); const r = new SceneLogReader();
    let found: SceneSnapshot | undefined;
    for (const line of records(s)) found = r.observeLine('[debug] ' + line) ?? found;
    expect(found).toEqual(s);
    const broken = [records(s).slice(1), records(s).filter(l => !l.includes('fact/;/terrain')), records(s).filter(l => !l.includes('fact/;/camp')),
        records(s).map(l => l.replace('coastal/;/no', 'coastal/;/maybe')),
        records(s).map(l => l.replace(digest, 'b'.repeat(64))),
        [...records(s).slice(0, -1), records(s)[1], records(s).slice(-1)[0]]];
    for (const lines of broken) {
        r.reset(); expect(lines.map(l => r.observeLine(l)).filter(Boolean)).toEqual([]);
    }
});

test('actual CK3 clickable province markup becomes a clean location in scene/UI/model context', () => {
    const raw = "\x15ONCLICK:PROVINCE,1591 \x15TOOLTIP:PROVINCE,1591 \x15L; Zul'Farrak\x15!\x15!\x15!";
    const s = snapshot({ location: raw, provinceId: 1591 });
    const reader = new SceneLogReader();
    const captured = records(s).map(line => reader.observeLine(line)).find(Boolean)!;
    expect(captured.location).toBe("Zul'Farrak");
    const game = data(captured);
    expect(game.location).toBe("Zul'Farrak");
    expect(resolveScene(captured)?.packet).toContain("Observed location: Zul'Farrak. Terrain: desert.");
    expect(resolveScene(captured)?.packet).not.toMatch(/ONCLICK|TOOLTIP|\x15/);
});

test('scene actions wait for engine receipt, preserve province, and revalidate approved/slash arguments', async () => {
    const d = data(); const emitted: string[] = [];
    runActionWithScenePolicy(action, d, s => emitted.push(s), ['titan_region_tanaris_white_gold_dune_country'], 1, 2);
    expect(d.scene).toBe('titan_farraki_court'); expect(d.location).toBe("Zul'Farrak");
    const ready = waitForSceneSelection(d);
    applySceneSnapshot(d, snapshot({ selected: 'titan_region_tanaris_white_gold_dune_country' })); await ready;
    expect(d.scene).toBe('titan_region_tanaris_white_gold_dune_country'); expect(d.location).toBe("Zul'Farrak");
    expect(emitted).toEqual(['root = { titan_select_titan_region_tanaris_white_gold_dune_country_effect = yes }']);
    expect(action.run).not.toHaveBeenCalled();
    expect(() => runActionWithScenePolicy(action, d, () => {}, ['titan_human_inn'], 1, 2)).toThrow('unavailable');
    expect((actionForScene(action, d).args[0] as any).options.map((o: any) => o.value)).toEqual([
        'titan_farraki_court', 'titan_zulian_court', 'titan_region_tanaris_white_gold_dune_country',
        'titan_community_troll_carving_common']);
});

test('engine rejection and wrong meeting anchor cannot create optimistic context', async () => {
    const d = data();
    runActionWithScenePolicy(action, d, () => {}, ['titan_region_tanaris_white_gold_dune_country'], 1, 2);
    expect(applySceneSnapshot(d, snapshot({ anchorId: 9, selected: 'titan_region_tanaris_white_gold_dune_country' }))).toBe(false);
    const ready = waitForSceneSelection(d);
    applySceneSnapshot(d, snapshot()); await expect(ready).rejects.toThrow('did not confirm');
    expect(d.scene).toBe('titan_farraki_court');
});

test('legacy saved changeLocation scripts retain the province without overwriting user scripts', () => {
    const d = data(); delete d.sceneSnapshot; d.scene = 'throne_room';
    const script = { ...action, run: (d: GameData) => { d.location = 'tavern'; d.scene = 'tavern'; } };
    runActionWithScenePolicy(script, d, () => {}, ['tavern'], 1, 2);
    expect(d.location).toBe("Zul'Farrak"); expect(d.scene).toBe('tavern');
});

test('scene facts are protected alongside persona and lore during trimming', () => {
    const mandatory = { role: 'system' as const, content: resolveScene(snapshot())!.packet + '\nPersona and lore.' };
    const old = { role: 'assistant' as const, content: 'Old jungle scene. '.repeat(100) };
    const now = { role: 'user' as const, content: 'Current question.' };
    const count = (p: typeof mandatory[]) => p.reduce((n, m) => n + m.content.length, 0);
    const kept = trimGoaPrompt([mandatory, old, now], [old, now], count as any, mandatory.content.length + 80, 20);
    expect(kept).toEqual([mandatory, now]);
});

(fs.existsSync(path.resolve('out/titan-game-mod')) ? test : test.skip)('staged game scripts parse and selector, portraits and capture share the same catalogue', () => {
    const root = path.resolve('out/titan-game-mod');
    expect(fs.existsSync(root)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'titan-scene-manifest.json'), 'utf8'));
    expect(manifest.catalogue).toBe(digest);
    for (const rel of ['common/scripted_effects/titan_scene_effects.txt', 'common/scripted_triggers/titan_scene_triggers.txt',
        'common/scripted_guis/votc_select_talk_scene.txt', 'events/mcc_events_v2.txt',
        'common/scripted_effects/log_backgrounds.txt', 'common/scripted_effects/log_gamedata_v3_effect.txt', 'common/scripted_effects/log_gamedata_v3s_effect.txt',
        'common/scripted_effects/log_gamedata_v3l_effect.txt', 'gfx/interface/illustrations/scripted_illustrations/scene_background.txt']) {
        expect(() => parseCk3Script(fs.readFileSync(path.join(root, rel), 'utf8'))).not.toThrow();
    }
    const effect = fs.readFileSync(path.join(root, 'common/scripted_effects/titan_scene_effects.txt'), 'utf8');
    expect(effect).toContain('debug_log = "VOTC:TITAN_SCENE');
    expect(effect).not.toMatch(/\blog\s*=/);
    const preparation = effect.slice(effect.indexOf('titan_prepare_scenes_effect = {'));
    expect(preparation.indexOf('titan_prepare_scene_admission_effect = yes')).toBeGreaterThanOrEqual(0);
    expect(preparation.indexOf('titan_prepare_scene_admission_effect = yes')).toBeLessThan(preparation.indexOf('_eligible = yes'));
    const labels = fs.readFileSync(path.join(root, 'localization/english/titan_scenes_l_english.yml'), 'utf8');
    expect(labels.startsWith('\uFEFF')).toBe(true);
    expect(labels).not.toMatch(/\\u[0-9a-f]{4}/i); // CK3 does not decode JSON's Unicode escapes.
    for (const scene of SCENE_CATALOGUE.scenes) expect(labels).toContain(JSON.stringify(scene.label));
    for (const rel of ['common/scripted_triggers/titan_scene_triggers.txt', 'common/scripted_effects/titan_scene_effects.txt',
        'common/script_values/titan_scene_episode_values.txt', 'common/scripted_guis/votc_select_talk_scene.txt']) {
        expect(fs.readFileSync(path.join(root, rel), 'utf8').startsWith('\uFEFF')).toBe(true);
    }
    const selector = fs.readFileSync(path.join(root, 'common/scripted_guis/votc_select_talk_scene.txt'), 'utf8');
    for (const scene of manifest.scenes) expect(selector).toContain('titan_' + scene + '_eligible = yes');
    const portraits = fs.readFileSync(path.join(root, 'gui/shared/conversation_portraits.gui'), 'utf8');
    expect(portraits).not.toContain('Illustration.GetEnvironment(Character.Self)');
    const fields = (folder: string) => (parseCk3Script(fs.readFileSync(path.join(folder, 'events/mcc_events_v2.txt'), 'utf8'))
        .find(e => e.key === 'mcc_event_v2.1002')!.value as import('../../src/main/culture/ck3Script').ScriptEntry[])
        .filter(e => e.key !== 'immediate');
    // Updating eligibility must retain the original picker widget and every event option.
    expect(fields(root)).toEqual(fields(path.resolve('game_mod/upstream')));
});
