import { SCENE_CATALOGUE as catalogue, SCENE_CATALOGUE_DIGEST as digest } from '../../src/shared/scenes/catalogue.generated';
import { SceneSnapshot } from '../../src/shared/scenes/types';
import { sceneEligible, resolveScene } from '../../src/shared/scenes/sceneContext';
import { SceneLogReader } from '../../src/shared/scenes/sceneLog';

const venue = (name: string) => catalogue.scenes.find(s => s.id === 'titan_community_' + name)!;
function snapshot(name: string, changes: Partial<SceneSnapshot> = {}): SceneSnapshot {
    const scene = venue(name), site = catalogue.citySites.find(s => scene.conditions.citySites?.includes(s.id));
    const province = scene.conditions.provinceIds?.[0] ?? site?.conditions.provinceIds?.[0] ?? 1;
    const s: SceneSnapshot = { schema: 1, catalogue: digest, mode: 'goa', anchorId: 1,
        selected: scene.id, provinceId: province, location: 'Observed meeting province', controller: 'Current ruler',
        terrain: scene.conditions.terrains?.[0] ?? 'plains', style: scene.conditions.styles?.[0] ?? 'unknown',
        culture: 'unknown', settled: true, camp: false, coastal: scene.conditions.coastal ?? false,
        riverside: false, regions: [catalogue.regions.find(r => r.provinces?.includes(province))!.id],
        worldStates: [...new Set([...(scene.conditions.worldStates ?? []), ...(site?.conditions.worldStates ?? [])])],
        eligible: [], ...changes };
    s.worldStates = catalogue.worldStates.filter(w => s.worldStates.includes(w.id)).map(w => w.id);
    s.eligible = catalogue.scenes.filter(v => sceneEligible(v, s)).map(v => v.id); return s;
}
function records(s: SceneSnapshot): string[] {
    const p = 'VOTC:TITAN_SCENE/;/';
    return [p + `begin/;/1/;/${digest}/;/goa/;/1/;/talk_scene_${s.selected}/;/\x15ONCLICK:PROVINCE,${s.provinceId} \x15L;${s.location}\x15!/;/${s.controller}`,
        ...['terrain', 'style', 'culture', 'settled', 'camp', 'coastal', 'riverside'].map(k => {
            const v = (s as any)[k]; return p + 'fact/;/' + k + '/;/' + (typeof v === 'boolean' ? v ? 'yes' : 'no' : v);
        }),
        ...catalogue.worldStates.map(w => p + `fact/;/world_state/;/${w.id}=${s.worldStates.includes(w.id) ? 'yes' : 'no'}`),
        ...s.regions.map(r => p + 'fact/;/region/;/' + r), ...s.eligible.map(v => p + 'fact/;/eligible/;/' + v), p + 'end/;/' + digest];
}
const read = (lines: string[]) => { const reader = new SceneLogReader(); return lines.map(l => reader.observeLine(l)).filter(Boolean); };

test('a hybrid retaining lineage and practice qualifies; lost practice or visitor identity supplies no substitute', () => {
    const s = snapshot('shadowmoon_star_table');
    expect(resolveScene(s)).toBeDefined();
    expect(sceneEligible(venue('shadowmoon_star_table'), { ...s, culture: 'new_saved_hybrid' })).toBe(true);
    for (const state of venue('shadowmoon_star_table').conditions.worldStates!) {
        const lost = snapshot('shadowmoon_star_table', { worldStates: s.worldStates.filter(x => x !== state) });
        (lost as any).visitorCulture = 'shadowmoon';
        expect(resolveScene(lost)).toBeUndefined();
    }
});
test('county conversion removes its devotional venue independently of the visitors and heritage', () => {
    const s = snapshot('tide_voyage_chapel'); expect(resolveScene(s)).toBeDefined();
    const converted = snapshot('tide_voyage_chapel', { style: 'kultiran', worldStates: [] });
    (converted as any).visitorFaith = 'tidemother'; expect(resolveScene(converted)).toBeUndefined();
});
test('reviewed dark faith rooms require member-or-captive admission as well as local practice', () => {
    for (const name of ['hakkar_inner_altar', 'scarlet_inner_chapel', 'death_rune_engraving', 'legion_submission',
        'cthun_aniconic_rings', 'ghuun_offering', 'thros_preparation']) {
        const s = snapshot(name), membership = 'community_faith_access';
        expect(s.worldStates).toContain(membership); expect(resolveScene(s)).toBeDefined();
        expect(resolveScene(snapshot(name, { worldStates: s.worldStates.filter(x => x !== membership) }))).toBeUndefined();
    }
    expect(resolveScene(snapshot('elune_receiving'))).toBeDefined();
    expect(venue('sayaadi_guest_salon').conditions.worldStates).not.toContain('community_culture_members');
});
test('custody context preserves outsider beliefs; ordinary adherent admission adds no captive claim', () => {
    const captive = snapshot('hakkar_inner_altar');
    const packet = resolveScene(captive)!.packet;
    expect(packet).toContain('currently imprisoned by a present participant');
    expect(packet).toContain('conversion, religious agreement, intended sacrifice');
    expect(packet).toContain('no motive for capture, treatment, willing participation');
    expect(resolveScene(snapshot('hakkar_inner_altar', {
        worldStates: [...captive.worldStates, 'community_faith_members']
    }))!.packet).not.toContain('Observed access:');
    expect(resolveScene(snapshot('elune_receiving'))!.packet).not.toContain('Observed access:');
});
test('a cultural outsider can use the Nerubian receiving gallery without creating its local practice', () => {
    const s = snapshot('nerubian_argument');
    expect(s.worldStates).not.toContain('community_culture_members');
    expect(resolveScene(s)!.label).toBe('Silken Argument Gallery');
    for (const state of venue('nerubian_argument').conditions.worldStates!) {
        expect(resolveScene(snapshot('nerubian_argument', { worldStates: s.worldStates.filter(x => x !== state) }))).toBeUndefined();
    }
});
test('only authored camp venues permit an observed unbuilt camp; coastal catch commons still need a coast', () => {
    expect(resolveScene(snapshot('grummle_pack_exchange', { settled: false, camp: true }))).toBeDefined();
    expect(resolveScene(snapshot('grummle_pack_exchange', { settled: false, camp: false }))).toBeUndefined();
    expect(resolveScene(snapshot('gnomish_prototypes', { settled: false, camp: true }))).toBeUndefined();
    expect(resolveScene(snapshot('murloc_catch_common', { settled: false, camp: true, coastal: false }))).toBeUndefined();
});
test('named sacred fabric stays at its exact cell and requires its current retained building', () => {
    for (const name of ['pearlfin_listening_pool', 'grookin_guardian_entrance', 'niuzao_fifth_burden',
        'shatterspear_moonmask', 'thok_rib_offerings', 'zulkunda_mask_bay']) {
        const s = snapshot(name); expect(resolveScene(s)).toBeDefined();
        expect(resolveScene(snapshot(name, { provinceId: 1 }))).toBeUndefined();
        expect(resolveScene(snapshot(name, { worldStates: [] }))).toBeUndefined();
    }
    expect(resolveScene(snapshot('rashi_oasis_vows', { terrain: 'desert' }))).toBeUndefined();
});
test('complete exported evidence is accepted; absent admission facts or omitted eligible choices reject the frame', () => {
    const s = snapshot('hakkar_inner_altar'), full = records(s);
    expect(read(full)).toEqual([s]);
    expect(read(full.filter(l => !l.includes('world_state/;/community_faith_members=')))).toEqual([]);
    expect(read(full.filter(l => !l.includes('world_state/;/community_faith_access=')))).toEqual([]);
    const secondary = s.eligible.find(v => v !== s.selected)!; expect(secondary).toBeDefined();
    expect(read(full.filter(l => !l.endsWith('eligible/;/' + secondary)))).toEqual([]);
    expect(read(full.map(l => l.replace('community_faith_access=yes', 'community_faith_access=unknown')))).toEqual([]);
});
test('canonically burned local fabric and non-GoA modes cannot expose community choices', () => {
    const s = snapshot('goblin_repair_counter');
    expect(resolveScene(snapshot('goblin_repair_counter', { worldStates: [...s.worldStates, 'canon_teldrassil_burned_here'] }))).toBeUndefined();
    expect(resolveScene(snapshot('goblin_repair_counter', { mode: 'core' }))).toBeUndefined();
});
