import fs from 'fs';
import { SCENE_CATALOGUE, SCENE_CATALOGUE_DIGEST } from '../../src/shared/scenes/catalogue.generated';
import { SceneSnapshot } from '../../src/shared/scenes/types';
import { sceneEligible, resolveScene } from '../../src/shared/scenes/sceneContext';
import { SceneLogReader } from '../../src/shared/scenes/sceneLog';

const briefs = JSON.parse(fs.readFileSync('game_mod/scenes/heritage-courts.json', 'utf8')).courts;
const captions: { id: string; label: string }[] = JSON.parse(fs.readFileSync('game_mod/scenes/scene-titles.json', 'utf8')).titles;
const base = briefs.filter((b: any) => !b.cultures);
function observation(style: string, culture = 'unknown'): SceneSnapshot {
    return { schema: 1, catalogue: SCENE_CATALOGUE_DIGEST, mode: 'goa', anchorId: 1,
        selected: '', location: 'Observed province', controller: 'Observed controller',
        terrain: 'plains', style, culture, settled: true, coastal: false,
        regions: [], worldStates: [], eligible: [] };
}

test('all 57 declared heritage families have one portable base audience venue', () => {
    expect(base).toHaveLength(57);
    expect(new Set(base.map((b: any) => b.heritage)).size).toBe(57);
    for (const b of base) {
        const s = observation(b.style);
        const courts = SCENE_CATALOGUE.scenes.filter(c => base.some((b: any) => b.id === c.id) && sceneEligible(c, s));
        expect(courts.map(c => c.id)).toEqual([b.id]);
        expect(sceneEligible(courts[0], { ...s, settled: false })).toBe(false);
        expect(sceneEligible(courts[0], { ...s, style: 'unknown' })).toBe(false);
        s.selected = b.id; s.eligible = [b.id];
        const packet = resolveScene(s)!.packet;
        expect(packet).toContain(b.facts);
        const caption = captions.find(row => row.id === b.id)!;
        expect(packet).toContain(caption.label);
        expect(packet).not.toContain('heritage_');
    }
});

test.each([
    ['undead', 'forsaken', 'titan_forsaken_court', 'titan_undead_court'],
    ['uldamanic', 'drogbar', 'titan_drogbar_court', 'titan_uldamanic_court'],
    ['aqir', 'nerubian', 'titan_nerubian_court', 'titan_aqir_court'],
    ['aqir', 'mantid', 'titan_mantid_court', 'titan_aqir_court']
])('local %s/%s selects its distinct architecture without a visitor override', (style, culture, variant, fallback) => {
    const v = SCENE_CATALOGUE.scenes.find(c => c.id === variant)!;
    const b = SCENE_CATALOGUE.scenes.find(c => c.id === fallback)!;
    expect(sceneEligible(v, observation(style, culture))).toBe(true);
    expect(sceneEligible(b, observation(style, culture))).toBe(false);
    expect(sceneEligible(v, observation('human', culture))).toBe(false);
    expect(sceneEligible(v, observation(style))).toBe(false);
    expect(sceneEligible(b, observation(style))).toBe(true);
});

test('known local culture fact must be complete and unique before variant context is accepted', () => {
    const s = observation('aqir', 'mantid');
    const start = `VOTC:TITAN_SCENE/;/begin/;/1/;/${s.catalogue}/;/goa/;/1/;/talk_scene_titan_mantid_court/;/Province/;/Ruler`;
    const facts = ['terrain/;/plains', 'style/;/aqir', 'culture/;/mantid', 'settled/;/yes', 'camp/;/no', 'coastal/;/no', 'riverside/;/no',
        ...SCENE_CATALOGUE.worldStates.map(state => 'world_state/;/' + state.id + '=no'),
        ...SCENE_CATALOGUE.scenes.filter(scene => sceneEligible(scene, s)).map(scene => 'eligible/;/' + scene.id)];
    const read = (rows: string[]) => {
        const r = new SceneLogReader();
        return [start, ...rows.map(f => 'VOTC:TITAN_SCENE/;/fact/;/' + f), 'VOTC:TITAN_SCENE/;/end/;/' + s.catalogue].map(l => r.observeLine(l)).filter(Boolean);
    };
    expect(read(facts)[0]?.culture).toBe('mantid');
    expect(read(facts.filter(f => !f.startsWith('culture/')))).toEqual([]);
    expect(read([...facts, 'culture/;/unknown'])).toEqual([]);
    expect(read(facts.map(f => f.replace('culture/;/mantid', 'culture/;/unverified_key')))).toEqual([]);
});

test('Farraki architecture requires Tanaris as well as local Troll heritage and suitable terrain', () => {
    const f = SCENE_CATALOGUE.scenes.find(c => c.id === 'titan_farraki_court')!;
    const s = { ...observation('zulian'), terrain: 'desert', provinceId: 1591 };
    expect(sceneEligible(f, s)).toBe(false);
    expect(sceneEligible(f, { ...s, regions: ['tanaris'] })).toBe(true);
    expect(sceneEligible(f, { ...s, regions: ['tanaris'], style: 'dwarven' })).toBe(false);
});

test('portable courts work at observed camps without unlocking inns, masonry halls or empty ground', () => {
    const portable = briefs.filter((b: any) => b.allowsCamp);
    expect(portable.map((b: any) => b.id).sort()).toEqual([
        'titan_amphibian_court', 'titan_southern_court', 'titan_vulpine_court', 'titan_yaungolic_court', 'titan_zaetaric_court'
    ]);
    for (const b of portable) {
        const venue = SCENE_CATALOGUE.scenes.find(s => s.id === b.id)!;
        const camp = { ...observation(b.style), settled: false, camp: true };
        expect(sceneEligible(venue, camp)).toBe(true);
        expect(sceneEligible(venue, { ...camp, camp: false })).toBe(false);
        expect(sceneEligible(venue, { ...camp, style: 'unknown' })).toBe(false);
    }
    const southern = { ...observation('southern'), settled: false, camp: true };
    expect(sceneEligible(SCENE_CATALOGUE.scenes.find(s => s.id === 'titan_human_inn')!, southern)).toBe(false);
    expect(sceneEligible(SCENE_CATALOGUE.scenes.find(s => s.id === 'titan_mogu_court')!, { ...southern, style: 'mogu' })).toBe(false);
});
