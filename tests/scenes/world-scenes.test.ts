import { SCENE_CATALOGUE as catalogue, SCENE_CATALOGUE_DIGEST as digest } from '../../src/shared/scenes/catalogue.generated';
import { SceneSnapshot } from '../../src/shared/scenes/types';
import { sceneEligible, resolveScene } from '../../src/shared/scenes/sceneContext';

const find = (id: string) => {
    const scene = catalogue.scenes.find(s => s.id === id);
    if (!scene) throw Error('Missing world scene ' + id);
    return scene;
};
function snapshot(province: number, changes: Partial<SceneSnapshot> = {}): SceneSnapshot {
    const region = catalogue.regions.find(r => r.provinces?.includes(province))!;
    const s: SceneSnapshot = { schema: 1, catalogue: digest, mode: 'goa', anchorId: 1,
        selected: '', location: 'Synthetic physical site', controller: 'Current ruler',
        provinceId: province, terrain: 'mountains', style: 'unknown', culture: 'unknown',
        regions: [region.id], settled: true, coastal: false, riverside: false,
        worldStates: [], eligible: [], ...changes };
    s.eligible = catalogue.scenes.filter(scene => sceneEligible(scene, s)).map(scene => scene.id);
    return s;
}

test('capital architecture follows physical retained fabric across conversion, with no regional or visitor fallthrough', () => {
    const hall = find('titan_city_stormwind_the_lion_throne_hall');
    const local = snapshot(1, { worldStates: ['city_fabric_stormwind'] });
    for (const style of ['human', 'goblin', 'undead', 'unknown']) {
        expect(sceneEligible(hall, { ...local, style })).toBe(true);
    }
    expect(sceneEligible(hall, { ...local, provinceId: 31 })).toBe(false);
    expect(sceneEligible(hall, { ...local, worldStates: [] })).toBe(false);
    expect(sceneEligible(hall, { ...local, settled: false })).toBe(false);
    expect(sceneEligible(hall, { ...local, mode: 'core' })).toBe(false);
    const coast = find('titan_city_stormwind_harbor_customs_gallery');
    expect(sceneEligible(coast, snapshot(31, { worldStates: ['stormwind_harbor'] }))).toBe(true);
    expect(sceneEligible(coast, snapshot(1, { worldStates: ['stormwind_harbor'] }))).toBe(false);
});

test('Lordaeron palace, physical ruin and developed Undercity are independent current states', () => {
    const palace = find('titan_city_lordaeron_city_undercity_lordaerons_imperial_audience_chamber');
    const ruin = find('titan_city_lordaeron_city_undercity_the_ruined_imperial_chamber');
    const city = find('titan_city_lordaeron_city_undercity_undercitys_central_trade_ring');
    const early = snapshot(269, { worldStates: ['lordaeron_intact'], style: 'undead' });
    expect(sceneEligible(palace, early)).toBe(true);
    expect(sceneEligible(ruin, early)).toBe(false);
    expect(sceneEligible(city, early)).toBe(false);
    const broken = snapshot(269, { worldStates: ['lordaeron_ruin'] });
    expect(sceneEligible(ruin, broken)).toBe(true);
    expect(sceneEligible(palace, broken)).toBe(false);
    expect(sceneEligible(city, broken)).toBe(false);
    expect(sceneEligible(city, snapshot(269, { worldStates: ['lordaeron_ruin','undercity_developed'] }))).toBe(true);
});

test('arrived ship and operative tram require actual separate site observations', () => {
    const ship = find('titan_city_the_exodar_the_exodars_grounded_entrance');
    const empty = snapshot(1977, { style: 'argussian' });
    expect(sceneEligible(ship, empty)).toBe(false);
    expect(sceneEligible(ship, { ...empty, worldStates: ['city_fabric_the_exodar'] })).toBe(true);
    expect(sceneEligible(ship, { ...empty, provinceId: 1978, worldStates: ['city_fabric_the_exodar'] })).toBe(false);
    const tram = find('titan_city_ironforge_ironforges_deeprun_station');
    expect(sceneEligible(tram, snapshot(102, { worldStates: ['ironforge_tram'] }))).toBe(false);
    expect(sceneEligible(tram, snapshot(2525, { worldStates: ['ironforge_tram'] }))).toBe(true);
});

test('an eligible local episode replaces only matching ordinary terrain and returns the bases after expiry', () => {
    const sand = find('titan_dynamic_sandstorm_over_the_desert_tanaris');
    const dune = find('titan_region_tanaris_white_gold_dune_country');
    const coast = find('titan_region_tanaris_turquoise_desert_coast');
    const plain = snapshot(1591, { terrain: 'desert', settled: false, coastal: true });
    expect(sceneEligible(sand, plain)).toBe(false);
    expect(sceneEligible(dune, plain)).toBe(true);
    const storm = { ...plain, worldStates: ['ambient_sandstorm_over_the_desert'] };
    expect(sceneEligible(sand, storm)).toBe(true);
    expect(sceneEligible(dune, storm)).toBe(false);
    expect(sceneEligible(coast, storm)).toBe(true);
    expect(sceneEligible(dune, { ...storm, worldStates: [] })).toBe(true);
    expect(sceneEligible(dune, { ...storm, provinceId: 1 })).toBe(false);
    expect(sceneEligible(sand, { ...storm, worldStates: ['ambient_sandstorm_over_the_desert','fel_corruption'] })).toBe(false);
});

test('a staged snowstorm cannot bypass present snow cover, and local religion gates only its own observance', () => {
    const snow = find('titan_dynamic_high_country_snow_whiteout');
    const ridge = snapshot(102, { worldStates: ['ambient_high_country_snow_whiteout'] });
    expect(sceneEligible(snow, ridge)).toBe(false);
    expect(sceneEligible(snow, { ...ridge, worldStates: [...ridge.worldStates,'winter'] })).toBe(true);
    const lunar = find('titan_dynamic_lunar_lanterns_beneath_moonglade_s_trees');
    const p = catalogue.regions.find(r => r.id === 'moonglade')!.provinces![0];
    const grove = snapshot(p, { terrain: 'forest', style: 'kaldorei', worldStates: ['ambient_lunar_lanterns_beneath_moonglade_s_trees'] });
    expect(sceneEligible(lunar, grove)).toBe(false);
    expect(sceneEligible(lunar, { ...grove, worldStates: [...grove.worldStates,'dynamic_lunar_custom'] })).toBe(true);
});

test('only the selected compact environment reaches the packet, with personality priority and no held world event', () => {
    const s = snapshot(1, { selected: 'titan_city_stormwind_the_lion_throne_hall', worldStates: ['city_fabric_stormwind'] });
    const packet = resolveScene(s)!.packet;
    expect(packet).toContain('The throne stands above a broad blue runner');
    expect(packet).toContain('Character personality, beliefs and relationships determine conduct');
    expect(packet).not.toContain('Molten streams');
    expect(packet).not.toContain('Pale squid');
    expect(catalogue.scenes.some(s => /infernal_rain|mantid_swarming_sky|ash_drifting_from_active_volcanic/.test(s.id))).toBe(false);
    expect(catalogue.citySites.some(s => /mechagon_city|azjol_nerub|valiance_keep|warsong_hold/.test(s.id))).toBe(false);
});
