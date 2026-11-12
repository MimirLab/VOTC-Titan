import { normalizeControlledProseFormatting, parseControlledProse, controlledProseView } from '../../src/shared/language/controlledProse';
import { repairControlledPhoneticGaps, repairControlledPrivateClauses, validateControlledSpeechLabels, validateControlledSourceSpeech } from '../../src/main/language/controlledWriter';
import path from 'path';
import { loadLanguageEngine } from '../../src/main/language/languageEngine';

test.each(['she says,', 'they asked;', 'She answered.'])('bare speech attribution keeps the original words and existing audible/private boundaries: %s', attribution => {
    const source = `**Mara nods.** ""I will stay."" ${attribution} **her voice gentle.** ~~The hidden opal stays under my sleeve.~~`;
    const words = attribution.replace(/[,;.]$/, '');
    const expected = source.replace(attribution, '**' + words + '**' + attribution.slice(words.length));
    const repaired = normalizeControlledProseFormatting(source);
    expect(repaired).toBe(expected); expect(normalizeControlledProseFormatting(repaired)).toBe(repaired);
    validateControlledSpeechLabels(repaired); validateControlledSourceSpeech(repairControlledPrivateClauses(repaired));
    const engine = loadLanguageEngine(path.resolve('public/languages'));
    for (const keepPrivate of [false, true]) {
        const actual = controlledProseView(parseControlledProse(repaired), keepPrivate);
        const explicit = controlledProseView(parseControlledProse(expected), keepPrivate);
        expect(actual).toEqual(explicit); expect(actual.content.includes('hidden opal')).toBe(keepPrivate);
        expect(actual.speechSpans.map(span => actual.content.slice(span.start, span.end))).toEqual(['I will stay.']);
        for (const mode of ['CLEAR', 'CLOSE', 'FAR'] as const) {
            const render = (view: typeof actual) => engine.renderer.forMode({ spokenLanguageId: 'language_common', originalText: view.content, speechSpans: view.speechSpans }, mode);
            expect(render(actual)).toEqual(render(explicit));
        }
    }
});

test.each([
    '""Wait."" she remembers, **her eyes close.**',
    '""Wait."" she says, remembering the hidden opal, **her eyes close.**',
    '""Wait."" she says in her mind, **her eyes close.**',
    '""Wait."" she lies, **her eyes close.**',
    '""Wait.""\n\nshe says, **her eyes close.**',
    '""Wait."" she says,',
    '~~I should wait.~~ she says, **her eyes close.**'
])('bare-attribution repair leaves private, ambiguous and unbound clauses for bounded recovery: %s', source => {
    expect(() => parseControlledProse(normalizeControlledProseFormatting(source))).toThrow();
});

test('attribution repair leaves non-English and existing written/private quotations untouched', () => {
    const raw = '""Wait."" she says, **her eyes close.**';
    expect(normalizeControlledProseFormatting(raw, 'fr')).toBe(raw);
    for (const source of ['~~"Wait," she says in her mind.~~', '**She points at the written "Home".**'])
        expect(normalizeControlledProseFormatting(source)).toBe(source);
});

test.each([
    ['**She nods.** "I heard you." ~~She doubts it.~~', '**She nods.** ""I heard you."" ~~She doubts it.~~'],
    ['“I heard you.” **She nods.**', '""I heard you."" **She nods.**'],
    ['"Éloïse, wait. 😀"\n\n~~She recalls "private words".~~', '""Éloïse, wait. 😀""\n\n~~She recalls "private words".~~'],
    ['"He called it \\"home\\"."', '""He called it \\"home\\".""']
])('ordinary dialogue quotes repair without changing words or paragraphs: %s', (source, expected) => {
    const repaired = normalizeControlledProseFormatting(source);
    expect(repaired).toBe(expected); expect(() => parseControlledProse(repaired)).not.toThrow();
    expect(normalizeControlledProseFormatting(repaired)).toBe(repaired);
    expect(repaired.match(/\n/g)).toEqual(source.match(/\n/g));
});

test('private and written quotations keep their original nonverbal boundary', () => {
    const source = '**She points at the chalked "Welcome".** ~~She remembers "the hidden opal".~~ "Wait."';
    const repaired = normalizeControlledProseFormatting(source), parsed = parseControlledProse(repaired);
    expect(parsed.segments.filter(segment => segment.kind === 'speech').map(segment => segment.text)).toEqual(['Wait.']);
    expect(controlledProseView(parsed, false).content).not.toContain('opal');
    expect(parsed.segments.find(segment => segment.kind === 'private')!.text).toBe('She remembers "the hidden opal".');
});

test('narrative connectors join only adjacent spans of the same nonverbal kind', () => {
    const source = '**She sets the cloth flat** and **draws a pebble closer** before **catching it**. ~~She fears the cost~~ but ~~she keeps her doubts to herself.~~';
    const repaired = normalizeControlledProseFormatting(source), parsed = parseControlledProse(repaired);
    expect(controlledProseView(parsed, true).content.replace(/\*/g, '')).toBe('She sets the cloth flat and draws a pebble closer before catching it. She fears the cost but she keeps her doubts to herself.');
    expect(parsed.segments.filter(segment => segment.kind === 'speech')).toHaveLength(0);
    expect(controlledProseView(parsed, false).content).not.toContain('cost');
});

test('connector repair retains clause boundaries needed to protect a hidden explanation without losing the visible gesture', () => {
    const source = '**She raises her hand** and **she remembers the hidden opal**.';
    const repaired = repairControlledPrivateClauses(normalizeControlledProseFormatting(source));
    const visible = controlledProseView(parseControlledProse(repaired), false).content;
    expect(visible).toContain('She raises her hand'); expect(visible).not.toContain('opal');
    expect(controlledProseView(parseControlledProse(repaired), true).content).toContain('hidden opal');
});

test.each([
    '**She waits.** and ~~She fears the hidden opal.~~',
    '""Wait."" and ""Listen.""',
    '**She waits** and secretly **she remembers the opal**',
    '**She waits**\n\nand **she listens**',
    '{"reply":"Wait.","thought":"Keep the opal."}',
    '**She waits.** ["Wait.","Keep the opal."]',
    '**She waits.** "Unclosed speech.',
    '**She waits. ~~Her secret remains.~~**',
    '**She waits.** She hopes he will leave.'
])('ambiguous/unlabelled/private/crossed content still rejects: %s', source => {
    expect(() => parseControlledProse(normalizeControlledProseFormatting(source))).toThrow();
});

test('valid controls, silence and paragraph-separated actions remain unchanged', () => {
    for (const source of ['**She waits.**\n\n**She listens.**', '**She stays silent.** ~~No answer yet.~~',
        '""I heard \'a sound\'.""', '**She touches the cloth.** ""Wait."" ~~She fears the cost.~~'])
        expect(normalizeControlledProseFormatting(source)).toBe(source);
});

test('ordinary quotes around an explicit phonetic marker retain its independent audible-history validation', () => {
    const source = '**She points.** "What does <<krak>> mean?"';
    const repaired = repairControlledPhoneticGaps(normalizeControlledProseFormatting(source));
    expect(parseControlledProse(repaired).segments.filter(segment => segment.kind === 'speech')[0].text).toBe('What does <<krak>> mean?');
});

test('repair never turns attributed speech in actions into an accepted public narration', () => {
    const source = '**She says, "Leave now."**';
    expect(normalizeControlledProseFormatting(source)).toBe(source);
    expect(() => validateControlledSpeechLabels(normalizeControlledProseFormatting(source))).toThrow();
});

test('an attribution in the next action span still prevents spoken words from bypassing routing', () => {
    expect(() => validateControlledSpeechLabels('**"Wait here."** **she says.**')).toThrow('split across');
    expect(() => validateControlledSpeechLabels('**“Wait here.”** **Della asks, watching the gate.**')).toThrow('split across');
    for (const source of ['**She points at the chalked \'Welcome\'.** **She stays silent.**',
        '**"Welcome"** **she says nothing and points.**', '~~"Wait here."~~ **she says nothing.**'])
        expect(() => validateControlledSpeechLabels(source)).not.toThrow();
});

test('source-language and locale guards survive quote repair', () => {
    const source = '"Grog maen durkhaal thok grog maen veil dur maen grokha rir thok dur."';
    expect(() => validateControlledSourceSpeech(normalizeControlledProseFormatting(source))).toThrow('source-English');
    expect(() => parseControlledProse(normalizeControlledProseFormatting('**Elle attend** and **elle écoute**', 'fr'))).toThrow();
    expect(normalizeControlledProseFormatting('“Attendez.”', 'fr')).toBe('""Attendez.""');
});
