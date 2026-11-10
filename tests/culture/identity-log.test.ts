import { cultureHash, cultureInput, buildCultureGenerationPrompt, validateCultureParagraph } from '../../src/main/culture/cultureIdentity';
import { CultureLogReader, LogLineFramer } from '../../src/main/culture/cultureLog';
import { snapshot, catalog, captureLines, paragraph } from './fixtures';

describe('content-addressed cultural identity', () => {
    test('order, names, runtime ids, campaigns and accounts do not change a cultural identity', () => {
        const first = cultureInput(snapshot(), 'en');
        const reordered = { ...snapshot(), facts: snapshot().facts.reverse(), cultureName: 'New hybrid name',
            characterId: 77, cultureId: 6543, campaign: 'another game', account: 'another provider account' };
        const second = cultureInput(reordered, 'en');
        expect(cultureHash(first)).toBe(cultureHash(second));
        expect(buildCultureGenerationPrompt(first)).toBe(buildCultureGenerationPrompt(second));
    });
    test.each(['tradition', 'pillar', 'innovation', 'naming', 'era'] as const)('a changed %s changes the identity', kind => {
        const before = snapshot(); const after = snapshot();
        after.facts.find(f => f.kind === kind)!.description += ' An effective mod changed its meaning.';
        expect(cultureHash(cultureInput(after, 'en'))).not.toBe(cultureHash(cultureInput(before, 'en')));
    });
    test('reform or hybridization changes the set; reverting it reuses the original identity', () => {
        const original = snapshot(); const hybrid = snapshot();
        hybrid.facts = hybrid.facts.filter(f => f.key !== 'tradition_custom_craft');
        expect(cultureHash(cultureInput(hybrid, 'en'))).not.toBe(cultureHash(cultureInput(original, 'en')));
        expect(cultureHash(cultureInput(snapshot(), 'en'))).toBe(cultureHash(cultureInput(original, 'en')));
    });
    test('language and generation template version are separate cache identities', () => {
        const input = cultureInput(snapshot(), 'en');
        expect(cultureHash(cultureInput(snapshot(), 'fr'))).not.toBe(cultureHash(input));
        expect(cultureHash({ ...input, promptVersion: input.promptVersion + 1 })).not.toBe(cultureHash(input));
    });
    test('incomplete snapshots and unusable responses are rejected', () => {
        expect(() => cultureInput({ ...snapshot(), complete: false } as any, 'en')).toThrow();
        expect(() => cultureInput({ ...snapshot(), facts: snapshot().facts.filter(f => f.category !== 'language') }, 'en')).toThrow();
        for (const value of ['', 'Yes.', '<think>Hidden reasoning</think>', 'x '.repeat(121)])
            expect(() => validateCultureParagraph(value)).toThrow();
        expect(validateCultureParagraph(paragraph)).toBe(paragraph);
        expect(validateCultureParagraph(paragraph.replace('Hospitality', '\n\nHospitality'))).toBe(paragraph);
    });
});

describe('atomic live capture and stream framing', () => {
    test('accepts only a complete sealed capture, retaining all custom facts', () => {
        const reader = new CultureLogReader(catalog());
        const observations = captureLines().map(line => reader.read(`[log prefix] ${line}`)).filter(Boolean);
        expect(observations).toHaveLength(1);
        expect(observations[0]!.characterId).toBe(10);
        expect(observations[0]!.snapshot.facts).toHaveLength(snapshot().facts.length + 2);
    });
    test.each(['missing', 'duplicate', 'unknown', 'wrong-count', 'wrong-footer', 'wrong-catalog'])('rejects %s capture', fault => {
        const reader = new CultureLogReader(catalog());
        const lines = captureLines();
        if (fault === 'missing') lines.splice(2, 1);
        if (fault === 'duplicate') lines.splice(2, 0, lines[1]);
        if (fault === 'unknown') lines.splice(2, 0, 'VOTC:CULTURE/;/fact/;/tradition/;/unknown');
        if (fault === 'wrong-count') lines[0] = lines[0].replace('/;/2/;/1', '/;/3/;/1');
        if (fault === 'wrong-footer') lines[lines.length - 1] = lines[lines.length - 1].replace('/;/10/;/100', '/;/11/;/100');
        if (fault === 'wrong-catalog') lines[0] = lines[0].replace(catalog().digest, 'stale');
        expect(lines.map(l => reader.read(l)).filter(Boolean)).toHaveLength(0);
    });
    test('a new or expired capture cannot finish an old partial capture', () => {
        let now = 0;
        const onBegin = jest.fn();
        const reader = new CultureLogReader(catalog(), () => now, onBegin);
        const lines = captureLines();
        reader.read(lines[0]); now = 31_000;
        expect(lines.slice(1).map(l => reader.read(l)).filter(Boolean)).toHaveLength(0);
        expect(onBegin).toHaveBeenCalledWith(10);
        reader.read(lines[0]); reader.reset();
        expect(lines.slice(1).map(l => reader.read(l)).filter(Boolean)).toHaveLength(0);
    });
    test('UTF-8 and records survive one-byte file fragments; rotation discards partial records', () => {
        const framer = new LogLineFramer();
        const output: string[] = [];
        const bytes = Buffer.from('前缀 æ\r\nsecond\npartial');
        for (const byte of bytes) framer.push(Buffer.from([byte]), line => output.push(line));
        expect(output).toEqual(['前缀 æ', 'second']);
        framer.reset(); framer.push(Buffer.from('new\n'), line => output.push(line));
        expect(output).toEqual(['前缀 æ', 'second', 'new']);
    });
});
