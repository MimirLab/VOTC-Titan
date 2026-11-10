import { faithInput, faithHash, validateFaithResult } from '../src/main/faith/faithIdentity';
import { generateFaithProfile } from '../src/main/faith/faithGeneration';
import { passagePlan } from '../src/main/background/sourceReference';
import { snapshot } from './faith/fixtures';

function socialSnapshot() {
    const data = snapshot();
    data.facts.push({ kind: 'doctrine', key: 'changing_leadership', name: 'Shared stewardship',
        description: 'Qualified people of every sex may lead the community; no one is required to seek office.',
        rules: JSON.stringify({ definitions: [{ key: 'doctrine_group', value: 'doctrine_gender' }],
            meanings: { doctrine_gender_name: 'View on gender' } }) });
    data.facts.push({ kind: 'doctrine', key: 'office_eligibility', name: 'Women only', description: '',
        rules: JSON.stringify({ definitions: [{ key: 'doctrine_group', value: 'doctrine_clerical_gender' },
            { key: 'parameters', value: [{ key: 'female_clergy', value: 'yes' }] }],
            meanings: { doctrine_parameter_female_clergy: 'Only women may hold religious office.' } }) });
    data.facts.push({ kind: 'doctrine', key: 'hospitality', name: 'Bounded hospitality',
        description: 'Guests may receive freely offered shelter; hosts need not surrender their own safety.',
        rules: JSON.stringify({ definitions: [{ key: 'doctrine_group', value: 'hospitality_group' }],
            meanings: { hospitality_group_name: 'Hospitality' } }) });
    return data;
}

test('current gender teaching is protected separately from narrow clergy eligibility', () => {
    const input = faithInput(socialSnapshot(), 'en'), value = validateFaithResult({ selections: [] }, input);
    expect(value.paragraph).toContain('Religious office eligibility: "Only women may hold religious office."');
    expect(value.paragraph).toContain('Teaching on View on gender / Shared stewardship:');
    expect(value.paragraph).toContain('no one is required to seek office.');
    const social = value.notes.find(n => n.sources.includes('doctrine:changing_leadership'))!;
    expect(social.sources).toEqual(['doctrine:office_eligibility', 'doctrine:changing_leadership']);
    expect(passagePlan('faith', input.snapshot).passages.filter(p => !p.required)
        .some(p => p.source === 'doctrine:changing_leadership')).toBe(false);
    expect(value.paragraph).not.toContain('Men are stronger');
});

test('merged social cache rejects removal or rewriting of either source', () => {
    const input = faithInput(socialSnapshot(), 'en'), value = validateFaithResult({ selections: [] }, input);
    expect(validateFaithResult({ notes: value.notes }, input)).toEqual(value);
    const social = value.notes.find(n => n.sources.includes('doctrine:changing_leadership'))!;
    expect(() => validateFaithResult({ notes: value.notes.filter(n => n !== social) }, input)).toThrow();
    expect(() => validateFaithResult({ notes: value.notes.map(n => n === social ? { ...n, sources: n.sources.slice(1) } : n) }, input)).toThrow();
    expect(() => validateFaithResult({ notes: value.notes.map(n => n === social ? { ...n, text: n.text.replace('no one is required', 'everyone is required') } : n) }, input)).toThrow();
});

test('changed mod gender prose changes the shared hash and exact guidance; reversion reuses it', () => {
    const before = socialSnapshot(), after = socialSnapshot();
    after.facts.find(f => f.key === 'changing_leadership')!.description = 'Women are esteemed as community leaders; this does not decide who inherits.';
    const a = faithInput(before, 'en'), b = faithInput(after, 'en');
    expect(faithHash(a)).not.toBe(faithHash(b));
    expect(validateFaithResult({ selections: [] }, b).paragraph).toContain('this does not decide who inherits.');
    expect(validateFaithResult({ selections: [] }, b).paragraph).not.toContain('Qualified people of every sex');
    expect(faithHash(faithInput({ ...before, facts: [...before.facts].reverse() }, 'en'))).toBe(faithHash(a));
});

test.each(['missing heading', 'ambiguous group', 'opaque body'])('a %s cannot manufacture a wider gender teaching', mode => {
    const data = socialSnapshot(), f = data.facts.find(f => f.key === 'changing_leadership')!, rules = JSON.parse(f.rules);
    if (mode === 'missing heading') rules.meanings = {};
    if (mode === 'ambiguous group') rules.definitions.push({ key: 'doctrine_group', value: 'unknown_subject' });
    if (mode === 'opaque body') f.description = '[GetCurrentLeadership]';
    f.rules = JSON.stringify(rules);
    const plan = passagePlan('faith', data);
    expect(plan.passages.some(p => p.kind === 'protected social teachings')).toBe(false);
    expect(plan.passages.some(p => p.kind === 'religious office eligibility' && p.required)).toBe(true);
});

test('gender teaching remains protected when no readable clergy rule was captured', () => {
    const data = socialSnapshot(); data.facts = data.facts.filter(f => f.key !== 'office_eligibility');
    const value = validateFaithResult({ selections: [] }, faithInput(data, 'en'));
    expect(value.notes.find(n => n.sources.includes('doctrine:changing_leadership'))!.sources).toEqual(['doctrine:changing_leadership']);
    expect(value.paragraph).not.toContain('Religious office eligibility:');
});

test('generation skips an over-budget optional passage and keeps the next fitting source without losing required text', async () => {
    const input = faithInput(socialSnapshot(), 'en'), required = validateFaithResult({ selections: [] }, input);
    const options = passagePlan('faith', input.snapshot).passages.filter(p => !p.required);
    expect(options.length).toBeGreaterThanOrEqual(2);
    const countTokens = (text: string) => text.includes(options[0].text) ? 501 : 300;
    let parameters: any;
    const api = { config: { baseUrl: 'synthetic-gender-budget', key: '', overwriteContext: true }, model: 'synthetic', context: 32768, type: 'test',
        calculateTokensFromText: countTokens,
        complete: async (_messages: unknown, _stream: unknown, supplied: unknown) => { parameters = supplied; return { selections: options.slice(0, 2).map(p => p.id) }; } } as any;
    const value = await generateFaithProfile(api, input, new AbortController().signal);
    expect(value.paragraph).not.toContain(options[0].text);
    expect(value.paragraph).toContain(options[1].text);
    for (const note of required.notes) expect(value.notes).toContainEqual(note);
    expect(parameters.max_tokens).toBe(8192);
    expect(() => validateFaithResult({ selections: [] }, input,
        { maximumTokens: 500, countTokens: () => 501 })).toThrow('token budget');
});
