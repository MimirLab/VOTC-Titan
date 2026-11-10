import fs from 'fs';
import { SCENE_CATALOGUE, SCENE_CATALOGUE_DIGEST as digest } from '../../src/shared/scenes/catalogue.generated';
import { SceneSnapshot } from '../../src/shared/scenes/types';
import { eligibleScenes, resolveScene, sceneEligible } from '../../src/shared/scenes/sceneContext';
import { SceneLogReader } from '../../src/shared/scenes/sceneLog';

const scene = (suffix: string) => {
    const row = SCENE_CATALOGUE.scenes.find(s => s.id.endsWith(suffix));
    if (!row) throw Error('Missing authored scene: ' + suffix);
    return row;
};
function observation(region: string, changes: Partial<SceneSnapshot> = {}): SceneSnapshot {
    const s: SceneSnapshot = { schema: 1, catalogue: digest, mode: 'goa', anchorId: 1,
        selected: '', location: 'Synthetic meeting location', controller: 'Local ruler',
        provinceId: SCENE_CATALOGUE.regions.find(r => r.id === region)!.provinces![0],
        terrain: 'forest', style: 'unknown', culture: 'unknown', regions: [region],
        settled: false, camp: false, coastal: false, riverside: false, worldStates: [], eligible: [], ...changes };
    s.eligible = SCENE_CATALOGUE.scenes.filter(row => sceneEligible(row, s)).map(row => row.id);
    return s;
}
function capture(s: SceneSnapshot): string[] {
    const m = 'VOTC:TITAN_SCENE/;/';
    return [m + `begin/;/1/;/${digest}/;/goa/;/1/;/talk_scene_${s.selected}/;/\x15ONCLICK:PROVINCE,${s.provinceId} \x15TOOLTIP:PROVINCE,${s.provinceId} \x15L;${s.location}\x15!\x15!\x15!/;/${s.controller}`,
        ...['terrain', 'style', 'culture', 'settled', 'camp', 'coastal', 'riverside'].map(k => {
            const value = s[k as keyof SceneSnapshot];
            return m + 'fact/;/' + k + '/;/' + (typeof value === 'boolean' ? value ? 'yes' : 'no' : value);
        }),
        ...SCENE_CATALOGUE.worldStates.map(state => m + 'fact/;/world_state/;/' + state.id + '=' + (s.worldStates.includes(state.id) ? 'yes' : 'no')),
        ...s.regions.map(r => m + 'fact/;/region/;/' + r),
        ...s.eligible.map(id => m + 'fact/;/eligible/;/' + id), m + 'end/;/' + digest];
}
function read(lines: string[]): SceneSnapshot | undefined {
    const reader = new SceneLogReader();
    return lines.map(line => reader.observeLine(line)).find(Boolean);
}

test('the physical partition covers the independently imported 6,115 provinces once, with all 103 regions painted', () => {
    const inventory = JSON.parse(fs.readFileSync('game_mod/scenes/regional-proposals.json', 'utf8'));
    expect(inventory.proposals).toHaveLength(1013);
    expect(SCENE_CATALOGUE.regions).toHaveLength(103);
    const members = SCENE_CATALOGUE.regions.flatMap(r => r.provinces!);
    expect(members).toHaveLength(6115);
    expect(new Set(members).size).toBe(6115);
    for (const r of inventory.regions) {
        expect(SCENE_CATALOGUE.regions.find(row => row.id === r.id)!.provinces).toEqual(r.provinces);
        expect(SCENE_CATALOGUE.scenes.some(s => s.regionalEnvironment && s.conditions.regions?.includes(r.id))).toBe(true);
    }
});

test('region claims cannot move a physical province, and local venue style does not follow a visitor', () => {
    const woods = scene('ashenvale_emerald_trunk_woodland');
    const home = observation('ashenvale', { style: 'dwarven' });
    expect(sceneEligible(woods, home)).toBe(true);
    expect(sceneEligible(woods, { ...home, provinceId: observation('westfall').provinceId })).toBe(false);
    expect(sceneEligible(woods, { ...home, provinceId: undefined })).toBe(false);
    const forge = scene('durotar_redstone_forge_room');
    const local = observation('durotar', { style: 'orcish', terrain: 'drylands', settled: true, worldStates: ['smithy'] });
    expect(sceneEligible(forge, local)).toBe(true);
    expect(sceneEligible(forge, { ...local, style: 'dwarven' })).toBe(false);
    expect(sceneEligible(forge, { ...local, worldStates: [] })).toBe(false);
    expect(sceneEligible(forge, { ...local, settled: false })).toBe(false);
});

test('freshwater, coastline and snow cover require their distinct observations', () => {
    const bank = scene('ashenvale_bluegreen_forest_water');
    const woods = observation('ashenvale');
    expect(sceneEligible(bank, woods)).toBe(false);
    expect(sceneEligible(bank, { ...woods, coastal: true })).toBe(false);
    expect(sceneEligible(bank, { ...woods, riverside: true })).toBe(true);
    const coast = scene('tanaris_turquoise_desert_coast');
    const desert = observation('tanaris', { terrain: 'desert' });
    expect(sceneEligible(coast, desert)).toBe(false);
    expect(sceneEligible(coast, { ...desert, coastal: true })).toBe(true);
    const snow = scene('alterac_mountains_alterac_upper_snowfields');
    const mountain = observation('alterac_mountains', { terrain: 'mountains' });
    expect(sceneEligible(snow, mountain)).toBe(false);
    expect(sceneEligible(snow, { ...mountain, worldStates: ['winter'] })).toBe(true);
});

test('a building chain does not supply other required facilities or riverside geography', () => {
    const barn = scene('westfall_barn_assembly');
    const farm = observation('westfall', { terrain: 'farmlands', style: 'human', settled: true, worldStates: ['agriculture'] });
    expect(sceneEligible(barn, farm)).toBe(false);
    expect(sceneEligible(barn, { ...farm, worldStates: ['agriculture', 'windmill'] })).toBe(true);
    const mill = scene('stormsong_valley_stream_grainmill');
    const valley = observation('stormsong_valley', { terrain: 'farmlands', style: 'southern', settled: true, worldStates: ['watermill'] });
    expect(sceneEligible(mill, valley)).toBe(false);
    expect(sceneEligible(mill, { ...valley, riverside: true })).toBe(true);
});

test('ordinary homes need no invented permission flag; richer and temporary spaces use reachable observed gates', () => {
    const hearth = scene('ashenvale_forest_household_hearth');
    const home = observation('ashenvale', { style: 'kaldorei', settled: true });
    expect(sceneEligible(hearth, home)).toBe(true);
    const tauren = scene('mulgore_household_hearth_pantry');
    expect(sceneEligible(tauren, observation('mulgore', { terrain: 'plains', style: 'tauren', camp: true }))).toBe(true);
    const salon = scene('suramar_aristocratic_inner_salon');
    const town = observation('suramar', { style: 'highborne', settled: true,
        provinceId: salon.conditions.provinceIds![0], terrain: salon.conditions.terrains![0] });
    expect(sceneEligible(salon, town)).toBe(false);
    expect(sceneEligible(salon, { ...town, worldStates: ['developed_settlement'] })).toBe(true);
    expect(SCENE_CATALOGUE.worldStates.find(s => s.id === 'developed_settlement')!.minimum).toBe(10);
    const hunt = scene('barrens_barrens_hunting_supply_camp');
    const plain = observation('barrens', { terrain: hunt.conditions.terrains![0] });
    expect(sceneEligible(hunt, plain)).toBe(false);
    expect(sceneEligible(hunt, { ...plain, worldStates: ['camp_or_hunt'] })).toBe(true);
    const military = scene('military_reception_awning');
    expect(sceneEligible(military, plain)).toBe(false);
    expect(sceneEligible(military, { ...plain, worldStates: ['local_army'] })).toBe(true);
    expect(sceneEligible(military, { ...plain, worldStates: ['at_war'] })).toBe(false);
    expect(sceneEligible(military, { ...plain, terrain: 'coastal_sea', worldStates: ['local_army'] })).toBe(false);
});

test('narrow natural sites require exact physical membership, not a broad region name', () => {
    const basin = scene('coldarra_crystal_ice_basin');
    const region = basin.conditions.regions![0];
    const inside = observation(region, { terrain: basin.conditions.terrains![0], provinceId: basin.conditions.provinceIds![0] });
    expect(sceneEligible(basin, inside)).toBe(true);
    const outside = SCENE_CATALOGUE.regions.find(r => r.id === region)!.provinces!.find(n => !basin.conditions.provinceIds!.includes(n));
    expect(outside).toBeDefined();
    expect(sceneEligible(basin, { ...inside, provinceId: outside })).toBe(false);
});

test('current contamination and uncertain aftermath never portray a healthy woodland or shore', () => {
    for (const state of ['fel_corruption', 'death_corruption', 'shadow_corruption', 'uncertain_aftermath']) {
        const s = observation('ashenvale', { coastal: true, riverside: true, worldStates: [state] });
        const ids = eligibleScenes(s).map(row => row.id);
        expect(ids).toContain(state === 'uncertain_aftermath' ? 'titan_region_uncertain_aftermath_verge' : 'titan_region_' + state.split('_')[0] + '_verge');
        expect(ids).not.toContain('titan_region_ashenvale_emerald_trunk_woodland');
        expect(ids).not.toContain('titan_forest');
        expect(ids.filter(id => SCENE_CATALOGUE.scenes.find(row => row.id === id)!.regionalEnvironment)).toHaveLength(1);
    }
    expect(SCENE_CATALOGUE.worldStates.some(s => /^(sha_|nightmare|cataclysm|restor|plague)/.test(s.id))).toBe(false);
});

test('stock landscapes remain fallbacks; a building alone cannot suppress an otherwise needed landscape', () => {
    const healthy = observation('tanaris', { terrain: 'desert' });
    expect(eligibleScenes(healthy).map(s => s.id)).toContain('titan_region_tanaris_white_gold_dune_country');
    expect(eligibleScenes(healthy).map(s => s.id)).not.toContain('titan_desert');
    const unsupported = observation('elwynn_forest', { terrain: 'steppe', style: 'human', settled: true, worldStates: ['orchard', 'agriculture'] });
    expect(eligibleScenes(unsupported).map(s => s.id)).toContain('titan_steppe');
});

test('partial or misleading physical/state frames never become usable scene packets', () => {
    const s = observation('ashenvale', { selected: 'titan_region_ashenvale_emerald_trunk_woodland' });
    const lines = capture(s);
    expect(read(lines)?.provinceId).toBe(s.provinceId);
    for (const broken of [
        lines.filter(l => !l.includes('fact/;/riverside')),
        lines.filter(l => !l.includes('world_state/;/death_corruption=')),
        lines.filter(l => !l.includes('fact/;/region/;/ashenvale')),
        lines.map(l => l.replace('region/;/ashenvale', 'region/;/westfall')),
        lines.map(l => l.replace('death_corruption=no', 'death_corruption=maybe')),
        lines.map(l => l.replace('death_corruption=no', 'unobserved_plague=no')),
        lines.filter(l => !l.includes('eligible/;/titan_region_ashenvale_emerald_trunk_woodland')),
        lines.map(l => l.replace(`TOOLTIP:PROVINCE,${s.provinceId}`, 'TOOLTIP:PROVINCE,1591')),
        [...lines.slice(0, -1), lines.find(l => l.includes('world_state/;/winter='))!, lines.at(-1)!]
    ]) expect(read(broken)).toBeUndefined();
});

test('an omitted secondary option is an incomplete export, and core builds never gain GoA-only venues', () => {
    const s = observation('ashenvale', { selected: 'titan_region_ashenvale_emerald_trunk_woodland', riverside: true });
    const lines = capture(s);
    expect(read(lines)).toBeDefined();
    expect(read(lines.filter(l => !l.includes('eligible/;/titan_region_ashenvale_bluegreen_forest_water')))).toBeUndefined();
    const core = { ...s, mode: 'core' as const, worldStates: ['local_army'], regions: [], style: 'unknown' };
    expect(sceneEligible(scene('military_reception_awning'), core)).toBe(false);
    expect(sceneEligible(scene('titan_forest'), core)).toBe(true);
});

test('a resolved region emits only the selected compact environment, retaining character choice', () => {
    const s = observation('ashenvale', { selected: 'titan_region_ashenvale_emerald_trunk_woodland', riverside: true });
    const packet = resolveScene(s)!.packet;
    expect(packet).toContain('Ancient trunks');
    expect(packet).toContain('Character personality, beliefs and relationships determine conduct');
    expect(packet).not.toContain(scene('ashenvale_bluegreen_forest_water').facts);
    expect(packet).not.toMatch(/titan_region_|regional_|worldStates|1592|catalogue|GetPlayer|sha256/);
    expect(packet.length).toBeLessThan(2000);
});
