import { Character } from '../../src/shared/gameData/Character';
import { Config } from '../../src/shared/Config';
import { DevelopmentLogReader, DEVELOPMENT_DIGEST as digest, developmentCaptureBody } from '../../src/main/development/developmentCapture';
import { developmentalSteeringFor } from '../../src/main/development/developmentSteering';
import { configureDevelopmentCapture, observeDevelopmentLine, bindDevelopment, currentDevelopment, invalidateDevelopment } from '../../src/main/development/developmentRuntime';
import { encounterScript } from '../../src/main/background/EncounterCapture';
import { parseCk3Script } from '../../src/main/culture/ck3Script';
import { getVerifiedGoaSnapshot } from '../../src/main/goa/goaRuntime';
jest.mock('../../src/main/goa/goaRuntime', () => ({ getVerifiedGoaSnapshot: jest.fn() }));
const config = { goaLoreEnabled: true } as Config;
const actor = (age: number) => ({ id: 42, age, fullName: 'Young Regent', traits: [{ name: 'Patient' }] } as Character);
const lines = (age = '7', adult = '0', id = 42) => [
    `VOTC:DEVELOPMENT/;/begin/;/${digest}/;/${id}`, `VOTC:DEVELOPMENT/;/age/;/${age}`,
    `VOTC:DEVELOPMENT/;/adult/;/${adult}`, `VOTC:DEVELOPMENT/;/end/;/${digest}/;/${id}`
];
beforeEach(() => { configureDevelopmentCapture({ userFolderPath: '' } as Config); jest.mocked(getVerifiedGoaSnapshot).mockReturnValue(undefined); });
test.each([[0, 'mostly gestures'], [2, 'mostly gestures'], [3, 'concrete understanding'], [5, 'concrete understanding'], [6, 'fairness'], [12, 'fairness'], [13, 'abstract thought'], [15, 'abstract thought'], [16, 'adult responsibilities'], [19, 'adult responsibilities']] as const)('age %s has its writing band and preserves hard facts', (age, band) => {
    const text = developmentalSteeringFor(actor(age), config);
    for (const expected of [`current game age ${age};`, band, 'private thoughts, speech and choices', 'prodigy', 'child ruler', 'patience need not become impulsiveness', 'Long-lived or immortal ancestry alone grants no extra years']) expect(text).toContain(expected);
});
test.each([20, 21, 55, 700, -1, NaN, Infinity, 5.5])('age %s leaves adult/invalid prompts unchanged', age => expect(developmentalSteeringFor(actor(age), config)).toBe(''));
test.each(['20+', ...Array.from({ length: 20 }, (_, i) => String(i))])('complete native frame supports %s without localized numbers', age => {
    const reader = new DevelopmentLogReader(); lines(age).forEach(l => reader.observe('[debug] ' + l));
    expect(reader.take(42)).toEqual({ age: age === '20+' ? age : Number(age), adult: false }); expect(reader.take(42)).toBeUndefined();
});
test.each(['-1', '20', '21', '4.5', '01', 'NaN', '٧'])('rejects invalid native age %s', age => {
    const reader = new DevelopmentLogReader(); lines(age).forEach(l => reader.observe(l)); expect(reader.take(42)).toBeUndefined();
});
test.each(['duplicate-age', 'duplicate-adult', 'missing-age', 'missing-adult', 'wrong-id', 'wrong-digest', 'unknown-field', 'invalid-adult', 'no-end', 'campaign-load'])('rejects %s rather than accepting partial facts', kind => {
    const reader = new DevelopmentLogReader(); const rows = lines('0');
    if (kind === 'duplicate-age') rows.splice(2, 0, rows[1]);
    if (kind === 'duplicate-adult') rows.splice(3, 0, rows[2]);
    if (kind === 'missing-age') rows.splice(1, 1);
    if (kind === 'missing-adult') rows.splice(2, 1);
    if (kind === 'wrong-id') rows[3] = rows[3].replace('/;/42', '/;/43');
    if (kind === 'wrong-digest') rows[0] = rows[0].replace(digest, '0'.repeat(64));
    if (kind === 'unknown-field') rows.splice(2, 0, 'VOTC:DEVELOPMENT/;/invented/;/7');
    if (kind === 'invalid-adult') rows[2] = 'VOTC:DEVELOPMENT/;/adult/;/yes';
    if (kind === 'no-end') rows.pop();
    if (kind === 'campaign-load') rows.splice(2, 0, 'VOTC:CAMPAIGN/;/loaded/;/old-save');
    rows.forEach(l => reader.observe(l)); expect(reader.take(42)).toBeUndefined();
});
test('native refresh follows years and save rewind without mutating actors or reusing failed/cross-object/campaign bindings', () => {
    configureDevelopmentCapture({ userFolderPath: '/synthetic' } as Config); const child = actor(7), before = JSON.stringify(child);
    for (const [age, adult] of [['16', '1'], ['19', '1'], ['20+', '1'], ['7', '0']]) {
        invalidateDevelopment([child]); lines(age, adult).forEach(observeDevelopmentLine); expect(bindDevelopment(child)).toBe(true);
        const text = developmentalSteeringFor(child, config); expect(age === '20+' ? text.includes('ordinary adult portrayal') : text.includes(`current game age ${age};`)).toBe(true);
        expect(currentDevelopment(actor(7))).toBeUndefined();
    }
    expect(JSON.stringify(child)).toBe(before); invalidateDevelopment([child]);
    expect(() => developmentalSteeringFor(child, config)).toThrow('Current character age capture');
    lines().forEach(observeDevelopmentLine); bindDevelopment(child); observeDevelopmentLine('VOTC:CAMPAIGN/;/loaded/;/older'); expect(currentDevelopment(child)).toBeUndefined();
});
test('native adulthood is distinct from writing bands and replaced minds are not infantilized by host age', () => {
    configureDevelopmentCapture({ userFolderPath: '/synthetic' } as Config); const child = actor(7);
    lines('7', '1').forEach(observeDevelopmentLine); bindDevelopment(child); expect(developmentalSteeringFor(child, config)).toContain('treats this character as an adult');
    jest.mocked(getVerifiedGoaSnapshot).mockReturnValue({ version: 1, digest, characterId: 42, traitIds: ['fallen_demon_hunter'], facts: {} });
    const text = developmentalSteeringFor(child, config); expect(text).toContain('Host age does not establish'); expect(text).not.toContain('fairness'); expect(text).toContain('do not infantilize');
});
test('base game works with Audio off; capture is read-only, bounded and opt-in', () => {
    expect(developmentalSteeringFor(actor(13), { goaLoreEnabled: false, audio: { enabled: false } } as Config)).toContain('abstract thought');
    const body = developmentCaptureBody(); expect(parseCk3Script(body).length).toBeGreaterThan(20);
    expect(body).not.toMatch(/every_.*character|set_variable|character:|Breeze|MATURITY|SPEECH/);
    const script = encounterScript({ development: true }, [{ characterId: 42, position: 1 }], 'a'.repeat(24));
    expect(script).toContain('position = 1'); expect(script).toContain(body); expect(script).not.toContain('VOTC:MATURITY');
    expect(() => encounterScript({}, [{ characterId: 42, position: 1 }], 'a'.repeat(24))).toThrow('No capture catalogs');
});
