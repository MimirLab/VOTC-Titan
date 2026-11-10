import { ConceptCompositionBank, ConceptComposition } from '../src/main/background/conceptCompositionBank';
import { ResolvedEssentialConcept } from '../src/main/background/essentialConceptBank';
import { sha256Hex } from '../src/main/promptWorkbench/canonicalJson';

const concepts: ResolvedEssentialConcept[] = ['craft', 'authority', 'appearance'].map(key => ({
    key, definitionHash: sha256Hex('definition:' + key), readingId: key + '_combined', label: key,
    description: 'Full ' + key + ' meaning.', essentialText: 'Compact ' + key + ' meaning.'
}));
const row = (id = 'combined', selected = concepts): ConceptComposition => ({ id, domain: 'culture',
    members: selected.map(c => ({ key: c.key, definitionHash: c.definitionHash, readingId: c.readingId,
        richDescriptionHash: sha256Hex(c.description), essentialTextHash: sha256Hex(c.essentialText) })),
    text: 'All three current meanings are authored together, retaining their distinct subjects.', rationale: 'Reviewed complete union.' });
const bank = () => new ConceptCompositionBank({ version: 1, compositions: [row()] });

test('exact complete contributors join; removing any one or selecting a different current reading disables the union', () => {
    expect(bank().resolve('culture', concepts)).toHaveLength(1);
    for (const missing of concepts) expect(bank().resolve('culture', concepts.filter(c => c !== missing))).toEqual([]);
    expect(bank().resolve('culture', concepts.map(c => ({ ...c, readingId: null })))).toEqual([]);
    expect(bank().resolve('faith', concepts)).toEqual([]);
});

test.each(['definitionHash', 'description', 'essentialText'] as const)('a changed selected %s holds instead of reusing a stale union', field => {
    const changed = concepts.map(c => ({ ...c }));
    changed[0][field] = field === 'definitionHash' ? sha256Hex('changed') : 'Changed meaning.';
    expect(() => bank().resolve('culture', changed)).toThrow('Stale concept composition');
});

test('asset order, editorial changes, other-domain and unselected additions do not churn; selected text does', () => {
    const asset = row(), original = new ConceptCompositionBank({ version: 1, compositions: [asset] }).revision('culture', concepts);
    const changed = { ...asset, rationale: 'Changed editorial explanation.', members: [...asset.members].reverse() };
    const other = { ...row('faith_union'), domain: 'faith' };
    const absent = row('absent', concepts.map(c => ({ ...c, key: 'other_' + c.key })));
    expect(new ConceptCompositionBank({ version: 1, compositions: [absent, other, changed] }).revision('culture', [...concepts].reverse())).toBe(original);
    expect(new ConceptCompositionBank({ version: 1, compositions: [{ ...asset, text: 'Changed union meaning.' }] }).revision('culture', concepts)).not.toBe(original);
});

test('no ordering silently chooses between overlapping current unions or duplicate bindings', () => {
    const a = row(), b = row('subset', concepts.slice(0, 2));
    for (const rows of [[a, b], [b, a]]) expect(() => new ConceptCompositionBank({ version: 1, compositions: rows }).resolve('culture', concepts)).toThrow('Overlapping');
    expect(() => new ConceptCompositionBank({ version: 1, compositions: [a, { ...a, id: 'duplicate' }] })).toThrow('Duplicate');
});

test('asset and returned-value mutations cannot change retained meaning or bindings', () => {
    const asset = row(), b = new ConceptCompositionBank({ version: 1, compositions: [asset] });
    const original = b.revision('culture', concepts);
    asset.text = 'Mutated'; asset.members[0].key = 'mutated';
    const result = b.resolve('culture', concepts); result[0].text = 'Mutated result'; result[0].members[0].key = 'mutated';
    expect(b.revision('culture', concepts)).toBe(original);
});

test.each([
    { ...row(), members: [] }, { ...row(), members: [row().members[0]] },
    { ...row(), members: [row().members[0], row().members[0]] },
    { ...row(), members: [{ ...row().members[0], readingId: 'invalid reading' }, row().members[1]] },
    { ...row(), members: [{ ...row().members[0], essentialTextHash: 'missing' }, row().members[1]] },
    { ...row(), text: '' }, { ...row(), domain: 'body' }, { ...row(), characterId: 42 },
    { ...row(), id: 123 }, { ...row(), id: null }
])('malformed or character-specific composition metadata rejects', value => {
    expect(() => new ConceptCompositionBank({ version: 1, compositions: [value] })).toThrow();
});
