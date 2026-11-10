import { SCENE_CATALOGUE as catalogue, SCENE_CATALOGUE_DIGEST as digest } from '../../src/shared/scenes/catalogue.generated';
import { SceneSnapshot } from '../../src/shared/scenes/types';
import { sceneEligible, resolveScene } from '../../src/shared/scenes/sceneContext';
import { SceneLogReader } from '../../src/shared/scenes/sceneLog';

const scenes = catalogue.scenes.filter(s => s.oddityScene);
const venue = (name: string) => scenes.find(s => s.id === 'titan_oddity_' + name)!;
function snapshot(name: string, changes: Partial<SceneSnapshot> = {}): SceneSnapshot {
    const scene = venue(name), province = scene.conditions.provinceIds![0];
    const s: SceneSnapshot = { schema: 1, catalogue: digest, mode: 'goa', anchorId: 1,
        selected: scene.id, provinceId: province, location: 'Observed meeting province', controller: 'Current ruler',
        terrain: 'plains', style: scene.conditions.styles?.[0] ?? 'unknown', culture: 'unknown',
        settled: true, camp: false, coastal: false, riverside: false,
        regions: [catalogue.regions.find(r => r.provinces?.includes(province))!.id],
        worldStates: scene.conditions.worldStates ?? [], eligible: [], ...changes };
    s.worldStates = catalogue.worldStates.filter(w => s.worldStates.includes(w.id)).map(w => w.id);
    s.eligible = catalogue.scenes.filter(v => sceneEligible(v, s)).map(v => v.id);
    return s;
}
function records(s: SceneSnapshot): string[] {
    const p = 'VOTC:TITAN_SCENE/;/';
    return [p + `begin/;/1/;/${digest}/;/goa/;/1/;/talk_scene_${s.selected}/;/\x15ONCLICK:PROVINCE,${s.provinceId} \x15L;${s.location}\x15!/;/${s.controller}`,
        ...['terrain', 'style', 'culture', 'settled', 'camp', 'coastal', 'riverside'].map(k => {
            const v = (s as any)[k]; return p + 'fact/;/' + k + '/;/' + (typeof v === 'boolean' ? v ? 'yes' : 'no' : v);
        }), ...catalogue.worldStates.map(w => p + `fact/;/world_state/;/${w.id}=${s.worldStates.includes(w.id) ? 'yes' : 'no'}`),
        ...s.regions.map(r => p + 'fact/;/region/;/' + r), ...s.eligible.map(v => p + 'fact/;/eligible/;/' + v), p + 'end/;/' + digest];
}
function read(lines: string[]) {
    const reader = new SceneLogReader(); return lines.map(l => reader.observeLine(l)).filter(Boolean);
}

test('every curated oddity has an exact local witness and survives a complete capture round trip', () => {
    expect(scenes).toHaveLength(42);
    for (const scene of scenes) {
        const s = snapshot(scene.id.replace('titan_oddity_', ''));
        expect(resolveScene(s)?.label).toBe(scene.label);
        expect(read(records(s))).toEqual([s]);
        expect(resolveScene({ ...s, provinceId: 1 === s.provinceId ? 2 : 1 })).toBeUndefined();
        expect(resolveScene({ ...s, mode: 'core' })).toBeUndefined();
        for (const state of scene.conditions.worldStates ?? []) {
            expect(resolveScene({ ...s, worldStates: s.worldStates.filter(w => w !== state) })).toBeUndefined();
        }
    }
});
test('visitors cannot create local trogg, gnoll, ogre or furbolg vernacular', () => {
    for (const name of ['stonesplinter_burrow', 'winterfall_brew_shelter', 'woodpaw_map_common', 'dunemaul_chitin_cookyard']) {
        const s = snapshot(name, { style: 'human', worldStates: [] });
        (s as any).visitorCulture = 'matching_native_people';
        expect(resolveScene(s)).toBeUndefined();
    }
});
test('authored camp commons remain available in camps but maintenance rooms require settlement', () => {
    expect(resolveScene(snapshot('woodpaw_map_common', { settled: false, camp: true }))).toBeDefined();
    expect(resolveScene(snapshot('woodpaw_map_common', { settled: false, camp: false }))).toBeUndefined();
    expect(resolveScene(snapshot('deathknell_stitching_room', { settled: false, camp: true }))).toBeUndefined();
});
test('retained ruins do not infer cleansing, military occupation or visitor faith', () => {
    for (const name of ['sargeron_broken_moon', 'ordilaran_heartswood', 'forgotten_crypt_well']) {
        expect(resolveScene(snapshot(name, { settled: false, camp: false, style: 'new_saved_hybrid', worldStates: [] }))).toBeDefined();
    }
    expect(resolveScene(snapshot('banethil_rooted_junction', { worldStates: [] }))).toBeUndefined();
    expect(resolveScene(snapshot('nazzivian_glyph_monument', { worldStates: [] }))).toBeUndefined();
});
test('the Scarlet chamber preserves actual custody without imposing a procedure or faith', () => {
    const s = snapshot('scarlet_atonement_chamber');
    expect(resolveScene(s)!.packet).toContain('currently imprisoned by a present participant');
    expect(resolveScene(s)!.packet).toContain('conversion, religious agreement, intended sacrifice');
    expect(resolveScene(snapshot('scarlet_atonement_chamber', { worldStates: [...s.worldStates, 'community_faith_members'] }))!.packet).not.toContain('Observed access:');
    expect(resolveScene(snapshot('scarlet_atonement_chamber', { worldStates: s.worldStates.filter(w => w !== 'community_faith_access') }))).toBeUndefined();
});
test('omitted new observations and omitted secondary choices reject the complete frame', () => {
    const s = snapshot('baradin_ration_gallery'), full = records(s);
    expect(read(full.filter(l => !l.includes('world_state/;/oddity_baradin_prison=')))).toEqual([]);
    const secondary = s.eligible.find(v => v !== s.selected)!;
    expect(secondary).toBeDefined();
    expect(read(full.filter(l => !l.endsWith('eligible/;/' + secondary)))).toEqual([]);
});
