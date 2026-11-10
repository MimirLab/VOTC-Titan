import { faithInput, faithHash, validateFaithResult } from '../src/main/faith/faithIdentity';
import { faithCore } from '../src/main/background/faithCore';
import { passagePlan } from '../src/main/background/sourceReference';
import { generateFaithProfile } from '../src/main/faith/faithGeneration';
import { generateBackgroundProfile } from '../src/main/culture/cultureGeneration';
import { snapshot } from './faith/fixtures';
import { FaithFact } from '../src/shared/gameData/FaithSnapshot';
import { BackgroundIngredientBank } from '../src/main/background/backgroundIngredients';
import { conceptDefinitionHash } from '../src/main/background/authoredConceptBank';
import { sha256Hex } from '../src/main/promptWorkbench/canonicalJson';
import { installFixtureIngredients } from './helpers/background-ingredient-fixture';

const reviewed: Record<string,string> = {
    repair: 'Repayment must be proportionate; public humiliation does not repair a wrong.',
    water: 'Offer peaceful travelers water without surrendering every possession.',
    promise: 'Only freely given vows bind; threats do not create sacred obligations.'
};

function tenet(key: string, description: string, category = 'core_tenets'): FaithFact {
    return { kind: 'doctrine', key, name: 'Current ' + key, description,
        rules: JSON.stringify({ definitions: [
            { key: 'doctrine_group', value: 'unfamiliar_tenets' },
            { key: 'group_rules', value: [{ key: 'category', value: category }] }
        ], meanings: {} }) };
}

function currentFaith() {
    const data = snapshot();
    data.facts.push(
        tenet('repair', 'Repayment must be proportionate; public humiliation does not repair a wrong.'),
        tenet('water', 'Offer peaceful travelers water without surrendering every possession.'),
        tenet('promise', 'Only freely given vows bind; threats do not create sacred obligations.'),
        { kind: 'worship', key: 'CreatorName', name: '', description: 'the Unmade Shore', rules: '' }
    );
    // Native fixture prose is deliberately different from the authored bank.
    const facts=data.facts.filter(f=>f.key in reviewed);
    for(const f of facts)f.description='NATIVE_SOURCE_'+f.key;
    const entries=facts.map(f=>({domain:'faith',key:f.key,definitionHash:conceptDefinitionHash('faith',f),status:'authored',
        label:'Reviewed '+f.key,description:reviewed[f.key],tags:[],rationale:'Synthetic authored tenet.'}));
    installFixtureIngredients(new BackgroundIngredientBank({authored:{version:1,entries},
        essential:{version:1,entries:entries.map(e=>({domain:'faith',key:e.key,definitionHash:e.definitionHash,readingId:null,
            richDescriptionHash:sha256Hex(e.description),text:e.description,rationale:'Synthetic compact tenet.'}))},
        compositions:{version:1,compositions:[]},relationships:{version:1,accounts:[],roots:[]}}));
    return data;
}

test('unfamiliar core-tenet headings retain complete supplied teachings and their qualifications without AI selection', () => {
    const data = currentFaith(), input = faithInput(data, 'en');
    const result = validateFaithResult({ selections: [] }, input);
    for (const f of data.facts.filter(f => f.kind === 'doctrine' && ['repair', 'water', 'promise'].includes(f.key))) {
        expect(result.paragraph).toContain(reviewed[f.key]);
        expect(result.paragraph).not.toContain(f.description);
        expect(result.notes.some(n => n.sources.includes('doctrine:' + f.key))).toBe(true);
    }
    expect(result.paragraph).toContain('Reviewed repair');
    expect(passagePlan('faith', input.snapshot).passages.filter(p => !p.required)
        .some(p => ['doctrine:repair', 'doctrine:water', 'doctrine:promise'].includes(p.source))).toBe(false);
});

test('known category supplies only the tenet subject; unrelated or ambiguous missing subjects remain omitted', () => {
    const data = currentFaith();
    data.facts.push(tenet('secret', 'Only women may enter this teaching room.', 'unfamiliar_category'));
    const plan = passagePlan('faith', data);
    expect(plan.passages.some(p => p.text.includes('Only women may enter this teaching room.'))).toBe(false);
    expect(plan.omitted.some(p => p.source === 'doctrine:secret' && p.reason.includes('Missing localized doctrine subject'))).toBe(true);
    const ambiguous = data.facts.find(f => f.key === 'repair')!;
    const rules = JSON.parse(ambiguous.rules);
    rules.definitions.push({ key: 'doctrine_group', value: 'second_unknown_subject' });
    ambiguous.rules = JSON.stringify(rules);
    expect(passagePlan('faith', data).passages.some(p => p.text.includes(ambiguous.description))).toBe(false);
});

test('creator/high-god roles and whole alternatives survive without replacing the faith account', () => {
    const data = currentFaith();
    data.facts.find(f => f.kind === 'description' && f.key === 'faith')!.description =
        'The Witness guards agreements, not the creation of the world.';
    data.facts.find(f => f.kind === 'worship' && f.key === 'HighGodName')!.description = 'the Still Witness / the Quiet Witness';
    const result = validateFaithResult({ selections: [] }, faithInput(data, 'en'));
    expect(result.paragraph).toContain('The Witness guards agreements, not the creation of the world.');
    expect(result.paragraph).toContain('Creator term: the Unmade Shore');
    expect(result.paragraph).toContain('High-god term: the Still Witness / the Quiet Witness');
});

test('cached merged notes cannot silently discard a contributing source or rewrite a qualification', () => {
    const input = faithInput(currentFaith(), 'en'), result = validateFaithResult({ selections: [] }, input);
    expect(validateFaithResult({ notes: result.notes }, input)).toEqual(result);
    const merged = result.notes.find(n => n.sources.includes('doctrine:promise'))!;
    expect(() => validateFaithResult({ notes: result.notes.map(n => n === merged ? { ...n, sources: n.sources.filter(s => s !== 'doctrine:promise') } : n) }, input)).toThrow();
    expect(() => validateFaithResult({ notes: result.notes.map(n => n === merged ? { ...n, text: n.text.replace('threats do not', 'threats do') } : n) }, input)).toThrow();
});

test('unreadable worship stays in identity without inventing a meaning, while reordered snapshots reuse identity', () => {
    const original = currentFaith(), a = faithInput(original, 'en');
    expect(faithHash(faithInput({ ...original, facts: [...original.facts].reverse() }, 'en'))).toBe(faithHash(a));
    const changed = currentFaith();
    changed.facts.find(f => f.kind === 'worship' && f.key === 'HighGodName')!.description = '[GetUnresolved]';
    expect(faithHash(faithInput(changed, 'en'))).not.toBe(faithHash(a));
    expect(faithCore(changed).worship.some(w => w.source === 'worship:HighGodName')).toBe(false);
    expect(validateFaithResult({ selections: [] }, faithInput(changed, 'en')).paragraph).not.toContain('GetUnresolved');
});

test('oversized protected accounts reject instead of dropping their ending qualification', () => {
    const data = currentFaith();
    data.facts.find(f => f.kind === 'description' && f.key === 'faith')!.description =
        'A complete ordinary sentence describing the community. '.repeat(75) + 'This never grants supernatural powers.';
    expect(() => validateFaithResult({ selections: [] }, faithInput(data, 'en'))).toThrow('Oversized');
});

test('faith receives the larger cached guidance budget without changing culture or provider response budget', async () => {
    const input = faithInput(currentFaith(), 'en');
    const paragraph = validateFaithResult({ selections: [] }, input).paragraph;
    const calls: object[] = [];
    let guidanceTokens = 450;
    const api = { config: { baseUrl: 'synthetic-test', key: '', overwriteContext: true }, model: 'synthetic', context: 32768, type: 'test',
        calculateTokensFromText: (text: string) => text === paragraph ? guidanceTokens : 10,
        complete: async (_messages: unknown, _stream: unknown, parameters: object) => { calls.push(parameters); return { selections: [] }; } } as any;
    const signal = new AbortController().signal;
    await expect(generateFaithProfile(api, input, signal)).resolves.toMatchObject({ paragraph });
    await expect(generateBackgroundProfile(api, [], {}, signal, () => ({ paragraph }))).rejects.toThrow('guidance is too long');
    guidanceTokens = 501;
    await expect(generateFaithProfile(api, input, signal)).rejects.toThrow('token budget');
    expect(calls).toEqual([{ max_tokens: 8192 }, { max_tokens: 8192 }, { max_tokens: 8192 }]);
});
