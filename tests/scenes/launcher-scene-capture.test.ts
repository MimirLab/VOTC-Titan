import { LauncherSceneReader, launcherSceneCaptureBody, sceneStatePredicate, preferredSceneForCe } from '../../src/main/scenes/launcherSceneCapture';
import { SCENE_CATALOGUE as C, SCENE_CATALOGUE_DIGEST as D } from '../../src/shared/scenes/catalogue.generated';
import { sceneEligible } from '../../src/shared/scenes/sceneContext';
import { parseCk3Script } from '../../src/main/culture/ck3Script';

const N = '0123456789abcdef01234567';
const M = 'VOTC:LAUNCHER_SCENE/;/';
function frame(reader: LauncherSceneReader, options: { missing?: string; duplicate?: string; party?: number[]; faith?: boolean; custody?: boolean; province?: string; day?: number; seed?: number } = {}) {
    const lines = [
        'begin/;/' + N + '/;/' + D + '/;/1/;/' + (options.province ?? 'ONCLICK:PROVINCE,10 L; Goldshire') + '/;/King/;/225205/;/617/;/1/;/1',
        ...Object.entries({ terrain: 'plains', style: 'human', culture: 'unknown',
            settled: '1', camp: '0', coastal: '0', riverside: '0', aftermath_seen: '0' }).map(([k,v]) => k + '/;/' + v),
        ...C.worldStates.filter(s => sceneStatePredicate(s)).map(s => 'state/;/' + s.id + '/;/0'),
    ];
    for (const [key, n, count] of [['script_day', options.day ?? 225204, 7], ['seed', options.seed ?? 100000, 7], ['campaign', 12, 3]] as const)
        for (let i = 0; i < count; i++) lines.push('digit/;/' + key + '/;/' + i + '/;/' + Math.floor(n / 10 ** i) % 10);
    for (const actor of options.party ?? [1, 2]) lines.push('party/;/' + actor, 'party_local/;/1',
        'party_faith/;/' + (options.faith === false ? 0 : 1), 'party_culture/;/1', 'party_access/;/' + (options.custody === false ? 0 : 1));
    for (const line of lines) if (!options.missing || !line.startsWith(options.missing)) reader.observe(M + line);
    if (options.duplicate) reader.observe(M + lines.find(l => l.startsWith(options.duplicate!)));
    reader.observe(M + 'end/;/' + N + '/;/' + D);
}
test('one bounded native query uses no installed helper, world scan, random roll or saved writes', () => {
    const script = launcherSceneCaptureBody(N);
    expect(script.length).toBeLessThan(250_000);
    expect(script).not.toMatch(/\b(?:set_variable|set_global_variable|remove_variable|change_variable|random|every_living_character|titan_\w+_(?:effect|trigger))\s*=/);
    expect(parseCk3Script('root = {\n' + script + '\n}')).toHaveLength(1);
    expect(script).toContain('every_in_global_list = { variable = mcc_characters_list_v2');
    expect(script).not.toContain('any_pinned_character');
    expect(() => launcherSceneCaptureBody('injected }')).toThrow();
});
test('ordinary stock CE observations derive local scenes and retain explicit unknown states', () => {
    const reader = new LauncherSceneReader(); frame(reader);
    const p = reader.consume(N, 1, [1, 2], 'a:b:c:d')!;
    expect(p.presentation).toBe('launcher');
    expect(p.location).toContain('Goldshire');
    expect(p.provinceId).toBe(10);
    expect(p.eligible).toContain(p.selected);
    expect(p.worldStates).toContain('community_faith_access');
    expect(p.observedWorldStates).not.toContain('canon_teldrassil_burned');
    expect(reader.consume(N, 1, [1,2], 'a:b:c:d')).toBeUndefined();
});
test.each([{ missing: 'terrain' }, { missing: 'state/;/winter/' }, { duplicate: 'state/;/winter/' },
    { province: 'ONCLICK:PROVINCE,10 ONCLICK:PROVINCE,20 L; Wrong' }])('partial, duplicate or ambiguous state fails closed: %j', options => {
    const reader = new LauncherSceneReader(); frame(reader, options);
    expect(reader.consume(N, 1, [1,2], 'a')).toBeUndefined();
});
test('wrong nonce, wrong anchor and reset cannot supply an observation', () => {
    const reader = new LauncherSceneReader(); frame(reader);
    expect(reader.consume('ffffffffffffffffffffffff', 1, [1,2], 'a')).toBeUndefined();
    expect(reader.consume(N, 9, [1,2], 'a')).toBeUndefined();
    frame(reader); reader.clear();
    expect(reader.consume(N, 1, [1,2], 'a')).toBeUndefined();
});
test('an unobserved party member never inherits private local admission', () => {
    const reader = new LauncherSceneReader(); frame(reader, { party: [1,2] });
    const p = reader.consume(N, 1, [1,2,3], 'a')!;
    expect(p.observedWorldStates).not.toContain('community_faith_access');
    expect(p.worldStates).not.toContain('community_faith_members');
});
test('current custody may allow access without attributing shared faith', () => {
    const reader = new LauncherSceneReader(); frame(reader, { faith: false });
    const p = reader.consume(N, 1, [1,2], 'a')!;
    expect(p.worldStates).toContain('community_faith_access');
    expect(p.worldStates).not.toContain('community_faith_members');
});
test('unknown exclusions and date-only plot windows cannot unlock a venue', () => {
    const reader = new LauncherSceneReader(); frame(reader);
    const p = reader.consume(N, 1, [1,2], 'a')!;
    const base = { id: 'synthetic', label: '', asset: '', environment: '', facts: '', purpose: '', priority: 0, source: 'generated' };
    expect(sceneEligible({ ...base, conditions: { worldStates: ['canon_teldrassil_burned'] } }, p)).toBe(false);
    expect(sceneEligible({ ...base, conditions: { excludedWorldStates: ['canon_teldrassil_burned'] } }, p)).toBe(false);
    expect(sceneEligible({ ...base, conditions: { excludedWorldStates: ['winter'] } }, p)).toBe(true);
});
test('an unavailable requested scene is never substituted as a successful choice', () => {
    const reader = new LauncherSceneReader(); frame(reader);
    const p = reader.consume(N, 1, [1,2], 'a', 'titan_missing')!;
    expect(p.selected).not.toBe('titan_missing');
});
test('ambient results are repeatable within the same game day and campaign', () => {
    const a = new LauncherSceneReader(), b = new LauncherSceneReader(); frame(a); frame(b);
    expect(a.consume(N, 1, [1,2], 'a')).toEqual(b.consume(N, 1, [1,2], 'a'));
});

test('CE venue intent is preserved unless a clear equivalent exists or the player explicitly chooses Titan art', () => {
    const reader = new LauncherSceneReader(); frame(reader);
    const p = reader.consume(N, 1, [1,2], 'a')!;
    expect(preferredSceneForCe(p, 'bedchamber')).toBeUndefined();
    expect(preferredSceneForCe(p, 'dungeon')).toBeUndefined();
    expect(preferredSceneForCe(p, 'throne_room')).toBeTruthy();
    expect(p.observedWorldStates).toContain('canon_teldrassil_burned_here');
    expect(p.worldStates).not.toContain('canon_teldrassil_burned_here');
});
