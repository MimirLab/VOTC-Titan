import { CloneLogReader, cloneCaptureBody, buildCloneCapture, CLONE_FORM_TRAITS, selectCloneKey } from '../../src/main/audio/cloneCapture';
import { encounterScript, encounterTargets } from '../../src/main/background/EncounterCapture';
import { loadActiveCultureFiles } from '../../src/main/culture/cultureCatalog';
import { bundledCloneCatalog } from '../../src/main/audio/cloneCapture';
import { createHash } from 'crypto';
jest.mock('../../src/main/culture/cultureCatalog', () => ({ loadActiveCultureFiles: jest.fn() }));
const digest = 'a'.repeat(64);
const catalog = { digest, ids: ['60003', 'garrosh'], voices: { version: 1 as const, profiles: {}, identities: {}, history: {} } };
const frame = (r: CloneLogReader, id = 90210, matches: string[] = ['garrosh']) => {
    r.observe(`VOTC:CLONE/;/begin/;/${digest}/;/${id}`);
    for (const m of matches) r.observe(`VOTC:CLONE/;/match/;/${m}`);
    for (const trait of CLONE_FORM_TRAITS) r.observe(`VOTC:CLONE/;/form/;/${trait}/;/0`);
    r.observe(`VOTC:CLONE/;/end/;/${digest}/;/${id}`);
};
test('participant equality never treats an exported number or a display name as a history key', () => {
    const targets = encounterTargets({ characters: new Map([[90210, {}]]) as any, playerID: 1, aiID: 90210 }, [90210]);
    const script = encounterScript({ clones: catalog }, targets, '1'.repeat(24));
    expect(script).toContain('position = 0'); expect(script).toContain('exists = character:garrosh this = character:garrosh');
    expect(script).not.toContain('character:90210'); expect(script).not.toMatch(/every_.*character|random_.*character|create_character|set_variable/);
});
test('complete positive and negative frames bind only their exact exported participant', () => {
    const r = new CloneLogReader(catalog); frame(r); expect(r.snapshot(90210)?.id).toBe('garrosh'); expect(r.snapshot(60003)).toBeUndefined();
    frame(r, 90211, []); expect(r.snapshot(90211)).toMatchObject({ id: undefined });
});
test.each([['garrosh','garrosh'], ['garrosh','60003'], ['unknown']])('ambiguous, duplicated and unknown matches are unusable: %j', (...matches) => {
    const r = new CloneLogReader(catalog); frame(r, 90210, matches); expect(r.snapshot(90210)).toBeUndefined();
});
test('new incomplete or mismatched frames invalidate previously verified observations immediately', () => {
    const r = new CloneLogReader(catalog); frame(r);
    const rev = r.revisions.get(90210); r.observe(`VOTC:CLONE/;/begin/;/${digest}/;/90210`);
    expect(r.revisions.get(90210)).not.toBe(rev); expect(r.snapshot(90210)).toBeUndefined();
    r.observe(`VOTC:CLONE/;/end/;/${digest}/;/1`); expect(r.snapshot(90210)).toBeUndefined();
    frame(r); r.observe(`VOTC:CLONE/;/begin/;/${'b'.repeat(64)}/;/90210`); expect(r.snapshot(90210)).toBeUndefined();
});
test('game reload, expiration and bounded storage prevent carrying identities across sessions', () => {
    let now = 0; const r = new CloneLogReader(catalog, () => now); frame(r); now = 15001; expect(r.snapshot(90210)).toBeUndefined();
    frame(r); r.observe('VOTC:CAMPAIGN/;/loaded/;/new'); expect(r.epoch).toBe(1); expect(r.snapshot(90210)).toBeUndefined();
    for (let n = 0; n < 70; n++) frame(r, n); expect(r.revisions.size).toBe(64); expect(r.snapshot(0)).toBeUndefined();
});
test('unsafe catalog IDs cannot inject commands', () => {
    expect(() => cloneCaptureBody({ ...catalog, ids: ['garrosh } debug_log = x'] })).toThrow();
});
test('all bundled identities are supported by exact installed history hashes; every covered identity has an explicit default', () => {
    const c = bundledCloneCatalog()!; expect(Object.keys(c.profiles)).toHaveLength(419); expect(Object.keys(c.identities)).toHaveLength(407);
    expect(Object.values(c.identities).filter(v => v.defaultKey)).toHaveLength(407);
    expect(c.identities['60003'].defaultKey).toBe('goa2-60003-wc3-arthas/v0001'); expect(c.identities['60003'].keys).toHaveLength(3);
});
test('changed effective history or a new overriding definition disables automatic matching', () => {
    const c = bundledCloneCatalog()!, mock = loadActiveCultureFiles as jest.Mock;
    mock.mockReturnValue(new Map()); expect(buildCloneCapture('game', 'user')).toBeUndefined();
    // Use actual bundled hash structure while avoiding a giant game fixture.
    const fs = require('fs'), spy = jest.spyOn(fs, 'readFileSync');
    const source = 'garrosh = { name = Garrosh }', history = { 'history/characters/test.txt': createHash('sha256').update(source).digest('hex') };
    spy.mockImplementation((file: any, ...args: any[]) => String(file).endsWith('clone-banks/catalog.json') ? JSON.stringify({ ...c, history }) : jest.requireActual('fs').readFileSync(file, ...args));
    try {
        mock.mockReturnValue(new Map(Object.entries({ 'history/characters/test.txt': source })));
        expect(buildCloneCapture('game', 'user')?.ids).toHaveLength(407);
        mock.mockReturnValue(new Map(Object.entries({ 'history/characters/test.txt': source, 'history/characters/override.txt': source })));
        expect(buildCloneCapture('game', 'user')).toBeUndefined();
    } finally { spy.mockRestore(); }
});

test.each([
    ['340009', [], 'goa2-340009-hots-illidan/v0001'],
    ['340009', ['being_demon','demon_hunter'], 'goa2-340009-hots-illidan/v0001'],
    ['340009', ['metamorphosis'], 'goa2-340009-wc3-illidanmorphed/v0001'],
    ['60003', [], 'goa2-60003-wc3-arthas/v0001'],
    ['60003', ['being_undead'], 'goa2-60003-wc3-arthas2/v0001'],
    ['60003', ['being_undead','lich_king'], 'goa2-60003-hots-lichking/v0001'],
    ['42076', [], 'goa2-42076-wc3-sylvanas/v0001'],
    ['42076', ['being_undead'], 'goa2-42076-hots-sylvanasbase/v0001'],
])('verified current form chooses a recording for %s, traits %j', (id, traits, key) => {
    expect(selectCloneKey(bundledCloneCatalog()!, id as string, traits as string[])).toBe(key);
});
test('all 407 covered identities route to an included recording rather than generated casting', () => {
    const c = bundledCloneCatalog()!;
    for (const [id, entry] of Object.entries(c.identities)) {
        const key = selectCloneKey(c,id); expect(key).toBeTruthy(); expect(entry.keys).toContain(key); expect(c.profiles[key!]).toBeDefined();
    }
});
test('an incomplete or duplicate form frame cannot select the wrong historical variant', () => {
    const r = new CloneLogReader(catalog);
    r.observe(`VOTC:CLONE/;/begin/;/${digest}/;/90210`); r.observe('VOTC:CLONE/;/match/;/60003');
    r.observe('VOTC:CLONE/;/form/;/being_undead/;/1');r.observe(`VOTC:CLONE/;/end/;/${digest}/;/90210`);
    expect(r.snapshot(90210)).toBeUndefined();
});
