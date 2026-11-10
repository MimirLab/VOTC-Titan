import fs from 'fs';
import { FarEncoder } from '../../src/main/language/farEncoder';

const json = (path: string) => JSON.parse(fs.readFileSync(path, 'utf8'));
const profiles = json('public/languages/far-profiles.json');
const fold = json('public/languages/unicode-casefold.json').fold;
const reference = json('tests/language/far-reference.json') as { version: string; cases: {
    language: string; seed: string; text: string; speech: string; quoted: string;
}[] };

test('FAR keeps the handed-off version and all 53 language profiles', () => {
    expect(profiles.version).toBe(reference.version);
    expect(Object.keys(profiles.profiles)).toHaveLength(53);
});
test.each(reference.cases)('matches the independent Python reference: $language / $seed / $text', c => {
    const engine = new FarEncoder(profiles, c.seed, fold);
    expect(engine.speech(c.text, c.language)).toBe(c.speech);
    expect(engine.quoted(c.text, c.language)).toBe(c.quoted);
});
