import { cultureInput, cultureHash, buildCultureGenerationMessages, validateCultureResult } from '../src/main/culture/cultureIdentity';
import { faithInput, faithHash, buildFaithGenerationMessages, validateFaithResult } from '../src/main/faith/faithIdentity';
import { passagePlan } from '../src/main/background/sourceReference';
import { snapshot as cultureSnapshot, result as cultureResult, fact } from './culture/fixtures';
import { snapshot as faithSnapshot, result as faithResult } from './faith/fixtures';

test('English selector instructions do not depend on provider origin or silently change the language identity', () => {
    for (const language of ['en', 'zh']) {
        const culture = cultureInput(cultureSnapshot(), language), faith = faithInput(faithSnapshot(), language);
        for (const messages of [buildCultureGenerationMessages(culture), buildFaithGenerationMessages(faith)]) {
            expect(messages[0].content).toContain('Never write or paraphrase a passage');
            expect(messages[0].content).toContain('explicit dissenters');
            expect(messages[0].content).toContain('Preserve the supplied source language');
            expect(messages[0].content).not.toMatch(/[\u4e00-\u9fff]/u);
        }
        expect(culture.language).toBe(language); expect(faith.language).toBe(language);
    }
});

test('the full anonymous composition remains hashed even when an opaque meaning cannot be sent as guidance', () => {
    const before = cultureSnapshot(), after = cultureSnapshot();
    after.facts.find(f => f.kind === 'innovation')!.description = 'Opaque technological revision.';
    const a = cultureInput(before, 'en'), b = cultureInput(after, 'en');
    expect(buildCultureGenerationMessages(a)).toEqual(buildCultureGenerationMessages(b));
    expect(cultureHash(a)).not.toBe(cultureHash(b));
    expect(cultureHash(cultureInput(before, 'en'))).toBe(cultureHash(a));
});

test.each(['ethos', 'martial_custom'])('optional selection cannot erase the current %s meaning', category => {
    const snapshot = cultureSnapshot(); snapshot.facts.find(f => f.category === category)!.description =
        category === 'martial_custom' ? 'Only women are recognized as warriors.' : 'Craftsmanship is esteemed above personal glory.';
    const input = cultureInput(snapshot, 'en'), result = validateCultureResult({ selections: [] }, input);
    expect(result.paragraph).toContain(snapshot.facts.find(f => f.category === category)!.description);
    const source = passagePlan('culture', snapshot).passages.find(p => p.kind === (category === 'ethos' ? 'social ideal' : 'martial expectation'))!.source;
    expect(() => validateCultureResult({ notes: result.notes.filter(n => !n.sources.includes(source)) }, input)).toThrow('Missing protected');
});

test('an inheritance permission remains useful without a description and never becomes an enacted law', () => {
    const snapshot = cultureSnapshot(), inheritance = fact('tradition', 'custom_inheritance');
    inheritance.description = '';
    inheritance.rules = JSON.stringify({ definitions: [{ key: 'parameters', value: [{ key: 'equal_inheritance', value: 'yes' }] }],
        parameterDescriptions: { equal_inheritance: 'Can enact the Equal gender law' } });
    snapshot.facts.push(inheritance);
    const permission = passagePlan('culture', snapshot).passages.find(p => p.kind === 'inheritance permission');
    expect(permission?.text).toBe('Can enact the Equal gender law.');
    // A readable parameter is useful authoring evidence, not permission to bypass the bank.
    expect(() => validateCultureResult({ selections: [] }, cultureInput(snapshot, 'en'))).toThrow('custom_inheritance (missing)');
});

test('an associated court contributes an ideal without establishing an occupied court or venue', () => {
    const snapshot = cultureSnapshot(); snapshot.facts.push({ ...fact('court_ideal', 'scholarly_court'), description: 'Learning and discovery are esteemed.' });
    const input = cultureInput(snapshot, 'en'), court = passagePlan('culture', snapshot).passages.find(p => p.kind === 'associated court ideal')!;
    expect(() => validateCultureResult({ selections: [] }, input)).toThrow('Missing associated court');
    expect(validateCultureResult({ selections: [court.id] }, input).paragraph).toContain('Learning and discovery are esteemed.');
    expect(buildCultureGenerationMessages(input)[0].content).toContain('not a present court or setting');
});

test('unknown conditional prose and religious customs cannot silently become unconditional culture', () => {
    const snapshot = cultureSnapshot();
    snapshot.facts.push({ ...fact('tradition', 'conditional_custom'), description: 'All households use magic.',
        rules: JSON.stringify({ conditionalDescriptions: { branch: 'A conditional practice.' } }) });
    snapshot.facts.push({ ...fact('tradition', 'religious_custom'), description: 'Priests worship sacred spirits.' });
    expect(() => buildCultureGenerationMessages(cultureInput(snapshot, 'en'))).toThrow('concepts unavailable');
    expect(passagePlan('culture', snapshot).omitted.some(o => o.reason.includes('conditional'))).toBe(true);
});

test('specific faith account retains subjects and negation alongside the broader account', () => {
    const snapshot = faithSnapshot(); snapshot.facts.find(f => f.kind === 'description' && f.key === 'faith')!.description =
        'Gorgog consumed the gronn to prove they were no gods, not to gain divinity from them.';
    const input = faithInput(snapshot, 'en'), result = validateFaithResult({ selections: [] }, input);
    expect(result.paragraph).toContain('prove they were no gods, not to gain divinity from them.');
    expect(result.paragraph).toContain('Religious roots: "A wider tradition of Light and Shadow."');
    expect(() => validateFaithResult({ notes: result.notes.map(n => ({ ...n, text: n.text.replace('no gods', 'mortal gods') })) }, input)).toThrow('Cached passage changed');
});

test('current moral changes affect guidance and identity without restoring inherited classifications', () => {
    const before = faithSnapshot(), after = faithSnapshot(); after.facts.find(f => f.kind === 'sin')!.kind = 'virtue';
    const a = faithInput(before, 'en'), b = faithInput(after, 'en');
    expect(faithHash(a)).not.toBe(faithHash(b));
    expect(faithResult(a).paragraph).toContain('Condemned dispositions include Compassionate.');
    expect(faithResult(b).paragraph).toContain('Admired dispositions include Compassionate, Patient.');
    expect(faithResult(b).paragraph).not.toContain('Condemned dispositions include Compassionate');
});

test('opaque moral labels are retained in identity without invented meanings or inferred neutrality', () => {
    const snapshot = faithSnapshot(); snapshot.facts.find(f => f.kind === 'sin')!.name = 'custom_unlocalized_disposition';
    const input = faithInput(snapshot, 'en'), plan = passagePlan('faith', snapshot);
    expect(input.snapshot.facts.some(f => f.name === 'custom_unlocalized_disposition')).toBe(true);
    expect(plan.omitted.some(o => o.reason.includes('Unlocalized disposition'))).toBe(true);
    expect(validateFaithResult({ selections: [] }, input).paragraph).not.toContain('custom unlocalized');
});

test('generic doctrine rhetoric stays bound to its actual magic subject', () => {
    const input = faithInput(faithSnapshot(), 'en');
    const doctrine = passagePlan('faith', input.snapshot).passages.find(p => p.kind === 'current teaching')!;
    const result = validateFaithResult({ selections: [doctrine.id] }, input);
    expect(result.paragraph).toContain('Teaching on Shadow magic / Balance:');
    expect(() => validateFaithResult({ notes: result.notes.map(n => ({ ...n, text: n.text.replace('Shadow magic', 'all magic') })) }, input)).toThrow();
});

test('clergy eligibility does not become a statement about all genders in society', () => {
    const snapshot = faithSnapshot(), doctrine = snapshot.facts.find(f => f.kind === 'doctrine')!;
    doctrine.rules = JSON.stringify({ definitions: [{ key: 'doctrine_group', value: 'doctrine_clerical_gender' },
        { key: 'parameters', value: [{ key: 'female_clergy', value: 'yes' }] }],
        meanings: { doctrine_parameter_female_clergy: 'Only women may serve as court chaplains.' } });
    const result = validateFaithResult({ selections: [] }, faithInput(snapshot, 'en'));
    expect(result.paragraph).toContain('Religious office eligibility: "Only women may serve as court chaplains."');
    expect(result.paragraph).not.toContain('Women rule');
});

test('captured worship vocabulary is a limited role and not an invented origin myth', () => {
    const snapshot = faithSnapshot(); snapshot.facts.find(f => f.kind === 'worship')!.description = 'Gorgog';
    const input = faithInput(snapshot, 'en');
    const result = validateFaithResult({ selections: [] }, input);
    expect(result.paragraph).toContain('High-god term: Gorgog');
    expect(result.notes.some(n => n.sources.includes('worship:HighGodName'))).toBe(true);
    expect(buildFaithGenerationMessages(input)[0].content).toContain('does not establish cosmic truth');
});

test.each(['culture', 'faith'] as const)('%s cache rejects invented quotations, removed core and forged evidence', domain => {
    const input = domain === 'culture' ? cultureInput(cultureSnapshot(), 'en') : faithInput(faithSnapshot(), 'en');
    const validate = (value: unknown) => domain === 'culture' ? validateCultureResult(value, input as ReturnType<typeof cultureInput>) : validateFaithResult(value, input as ReturnType<typeof faithInput>);
    const result = domain === 'culture' ? cultureResult() : faithResult();
    expect(validate({ notes: result.notes })).toEqual(result);
    expect(() => validate({ notes: result.notes.slice(1) })).toThrow();
    expect(() => validate({ notes: [{ ...result.notes[0], text: result.notes[0].text + ' Everyone must obey.' }, ...result.notes.slice(1)] })).toThrow();
    expect(() => validate({ notes: [{ ...result.notes[0], sources: ['description:invented'] }, ...result.notes.slice(1)] })).toThrow();
    expect(() => validate({ selections: ['invented'] })).toThrow();
});

test('overlong protected descriptions fail explicitly instead of silently dropping their qualification', () => {
    const snapshot = faithSnapshot(); snapshot.facts.find(f => f.kind === 'description' && f.key === 'faith')!.description =
        'An extended account ' + 'remembers '.repeat(400) + 'but denies divine status.';
    expect(() => validateFaithResult({ selections: [] }, faithInput(snapshot, 'en'))).toThrow('Oversized');
});
