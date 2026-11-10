import fs from 'fs';
import { CloseEncoder } from '../../src/main/language/closeEncoder';
import { CloseProfiles } from '../../src/main/language/closeProfiles';
const json = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));
const reference = json('tests/language/close-reference.json') as {
    cases: { language: string; text: string; expected: string }[];
};
// Keep the independent historical vectors: new voices must not change old hearings.
const historical = json('public/languages/voice-revisions.json').engines[0].data;
const encoder = new CloseEncoder(new CloseProfiles(historical.close, historical.routing));
test.each(reference.cases)('matches independent r2 Python for $language: $text', sample => {
    expect(encoder.speech(sample.text, sample.language)).toBe(sample.expected);
});
test('ordinary sitting and shutting preserve tone across all 53 authored voices', () => {
    const current = json('public/languages/close-profiles.json');
    const next = new CloseEncoder(new CloseProfiles(current, json('public/languages/routing.json')));
    for (const id of Object.keys(current.profiles)) {
        const heard = next.speech('Sit beside me. Shut the door. Bring silver coins.', id).toLowerCase();
        expect(heard.split(/\W+/)).not.toContain('shit'); expect(heard.split(/\W+/)).not.toContain('coons');
    }
});
const texture = json('tests/language/close-texture-reference.json') as {
    version: string; cases: { language: string; text: string; expected: string }[];
};
const current = json('public/languages/close-profiles.json');
const revised = new CloseEncoder(new CloseProfiles(current, json('public/languages/routing.json')));
test('independent texture vectors cover the entire current bank', () => {
    expect(texture.version).toBe(current.close_version);
    expect(new Set(texture.cases.map(sample => sample.language))).toEqual(new Set(Object.keys(current.profiles)));
});
test.each(texture.cases)('matches independent 3.0 Python for $language: $text', sample => {
    expect(revised.speech(sample.text, sample.language)).toBe(sample.expected);
});
