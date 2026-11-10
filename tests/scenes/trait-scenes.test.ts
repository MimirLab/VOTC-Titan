import { SCENE_CATALOGUE as c, SCENE_CATALOGUE_DIGEST as digest } from '../../src/shared/scenes/catalogue.generated';
import { SceneSnapshot } from '../../src/shared/scenes/types';
import { resolveScene, sceneEligible } from '../../src/shared/scenes/sceneContext';
import { SceneLogReader } from '../../src/shared/scenes/sceneLog';

function snapshot(key: string, changes: Partial<SceneSnapshot> = {}): SceneSnapshot {
    const provinceId = changes.provinceId ?? 1591;
    const s: SceneSnapshot = { schema: 1, catalogue: digest, mode: 'goa', anchorId: 1,
        selected: 'titan_trait_' + key, location: 'Observed province', controller: 'Local ruler',
        provinceId, regions: [c.regions.find(r => r.provinces?.includes(provinceId))!.id],
        terrain: 'desert', style: 'zulian', culture: 'unknown', settled: true, camp: false,
        coastal: false, riverside: false, worldStates: ['trait_ice_structure'], eligible: [], ...changes };
    s.worldStates = c.worldStates.filter(w => s.worldStates.includes(w.id)).map(w => w.id);
    s.eligible = c.scenes.filter(v => sceneEligible(v, s)).map(v => v.id);
    return s;
}
function records(s: SceneSnapshot): string[] {
    const p = 'VOTC:TITAN_SCENE/;/';
    return [p + `begin/;/1/;/${digest}/;/goa/;/1/;/talk_scene_${s.selected}/;/\x15ONCLICK:PROVINCE,${s.provinceId} \x15L;${s.location}\x15!/;/${s.controller}`,
        ...['terrain', 'style', 'culture', 'settled', 'camp', 'coastal', 'riverside'].map(k => {
            const v = (s as any)[k]; return p + 'fact/;/' + k + '/;/' + (typeof v === 'boolean' ? v ? 'yes' : 'no' : v);
        }), ...c.worldStates.map(w => p + `fact/;/world_state/;/${w.id}=${s.worldStates.includes(w.id) ? 'yes' : 'no'}`),
        ...s.regions.map(r => p + 'fact/;/region/;/' + r), ...s.eligible.map(v => p + 'fact/;/eligible/;/' + v), p + 'end/;/' + digest];
}
function read(lines: string[]) { const r = new SceneLogReader(); return lines.map(l => r.observeLine(l)).filter(Boolean); }

test('a current ice fortification can be met in warm terrain without importing winter', () => {
    const s = snapshot('ice_structure_recess');
    const packet = resolveScene(s)!.packet;
    expect(packet).toContain('Terrain: desert');
    expect(packet).toContain('regional winter or snowfall outside');
    expect(packet).toContain('appoint nobody as keeper or caster');
    expect(resolveScene(snapshot('ice_structure_recess', { settled: false, camp: false }))).toBeDefined();
    expect(resolveScene(snapshot('ice_structure_recess', { style: 'unknown', culture: 'unknown' }))).toBeDefined();
});
test('expired effects, winter alone and a visitor caster cannot establish the ice structure', () => {
    for (const states of [[], ['winter']]) {
        const s = snapshot('ice_structure_recess', { worldStates: states });
        (s as any).visitorTrait = 'user_of_elemental_water_spirit_magic_5';
        expect(resolveScene(s)).toBeUndefined();
    }
    expect(resolveScene(snapshot('ice_structure_recess', { terrain: 'sea' }))).toBeUndefined();
    expect(resolveScene(snapshot('ice_structure_recess', { mode: 'core' }))).toBeUndefined();
});
test('burrow architecture follows the fortified local Orcish community and admits ordinary visitors', () => {
    const good = snapshot('orc_burrow_stores', { style: 'orcish', worldStates: ['oddity_castle_here'] });
    expect(resolveScene(good)).toBeDefined();
    expect(resolveScene(good)!.packet).toContain('Guests keep their own culture and body');
    expect(resolveScene({ ...good, style: 'human' })).toBeUndefined();
    expect(resolveScene({ ...good, worldStates: [] })).toBeUndefined();
    expect(resolveScene({ ...good, settled: false, camp: true })).toBeUndefined();
    expect(resolveScene({ ...good, worldStates: [...good.worldStates, 'canon_teldrassil_burned_here'] })).toBeUndefined();
});
test('new complete capture rejects missing physical observations and omitted secondary choices', () => {
    const s = snapshot('ice_structure_recess'), full = records(s);
    expect(read(full)).toEqual([s]);
    expect(read(full.filter(l => !l.includes('world_state/;/trait_ice_structure=')))).toEqual([]);
    const other = s.eligible.find(v => v !== s.selected)!;
    expect(other).toBeDefined();
    expect(read(full.filter(l => !l.endsWith('eligible/;/' + other)))).toEqual([]);
});
test('a changed observation invalidates old art and a fresh selected venue supersedes it', () => {
    const old = snapshot('ice_structure_recess');
    expect(resolveScene(old)).toBeDefined();
    expect(resolveScene({ ...old, worldStates: [] })).toBeUndefined();
    const fresh = snapshot('orc_burrow_stores', { style: 'orcish', worldStates: ['oddity_castle_here'] });
    expect(resolveScene(fresh)!.packet).not.toContain('Visible surroundings in the selected backdrop: Towering blue-white ice');
    expect(read(records(fresh))).toEqual([fresh]);
});
