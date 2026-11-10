import { AuthoredConceptBank, AuthoredConceptEntry, ConditionalConceptReading, conceptDefinitionHash } from
    '../src/main/background/authoredConceptBank';
import { EssentialConceptBank, EssentialConceptEntry, EssentialConceptUnavailable } from
    '../src/main/background/essentialConceptBank';
import { sha256Hex } from '../src/main/promptWorkbench/canonicalJson';
import { snapshot as cultureFixture } from './culture/fixtures';
import { snapshot as faithFixture } from './faith/fixtures';
import { CultureSnapshot } from '../src/shared/gameData/CultureSnapshot';
import { FaithSnapshot } from '../src/shared/gameData/FaithSnapshot';
import { isAuthoredConceptReading } from '../src/main/background/authoredConceptBank';
import { passagePlan } from '../src/main/background/sourceReference';

// These fixtures test binding and cache behavior, not semantic or RP quality.
function fixture(domain: 'culture' | 'faith') {
    const snapshot: CultureSnapshot | FaithSnapshot = domain === 'culture' ? cultureFixture() : faithFixture();
    snapshot.facts = snapshot.facts.filter(f => f.kind !== 'tradition' && !f.key.startsWith('tenet_')) as any;
    const facts = ['primary', 'contributor'].map(key => ({ kind: domain === 'culture' ? 'tradition' : 'doctrine',
        ...(domain === 'culture' ? { category: 'societal' } : {}),
        key: domain === 'culture' ? key : 'tenet_' + key, name: 'RAW LABEL', description: 'RAW SOURCE PROSE', rules: '{}' }));
    (snapshot.facts as any[]).push(...facts);
    const entries: AuthoredConceptEntry[] = facts.map((f, index) => ({ domain, key: f.key,
        definitionHash: conceptDefinitionHash(domain, f as any), status: 'authored',
        label: index === 0 ? 'Authored primary meaning' : 'Authored companion meaning',
        description: 'Rich meaning of ' + f.key + ' with its permission and scope.',
        tags: [], rationale: 'EDITORIAL RICH EVIDENCE' }));
    const reading: ConditionalConceptReading = { id: 'reviewed_intersection', domain,
        conceptKey: entries[0].key, definitionHash: entries[0].definitionHash, label: 'Scoped intersection',
        description: 'Combined values have a different scoped meaning, with a protected exception.',
        requires: { concept: entries[0].key, otherConceptsAllOf: [entries[1].key] },
        contributorDefinitionHashes: { [entries[1].key]: entries[1].definitionHash },
        replaces: 'this_concept_reading_only', guard: 'EDITORIAL GUARD', handbookEntries: [], evidenceBasis: 'EDITORIAL EVIDENCE' };
    const richAsset = { version: 1, entries, conditionalReadingsVersion: 1, conditionalReadings: [reading] };
    const clauses: EssentialConceptEntry[] = entries.map(e => ({ domain, key: e.key, definitionHash: e.definitionHash,
        readingId: null, richDescriptionHash: sha256Hex(e.description), text: 'Essential ' + e.key + ' permission.',
        rationale: 'EDITORIAL CLAUSE REVIEW' }));
    clauses.push({ ...clauses[0], readingId: reading.id, richDescriptionHash: sha256Hex(reading.description),
        text: 'The intersection retains its scoped exception.' });
    return { snapshot, facts, entries, reading, richAsset, clauses };
}

test.each(['culture', 'faith'] as const)('the %s clause binds to the selected intersection and preserves rich upstream text', domain => {
    const { snapshot, richAsset, clauses, reading, entries } = fixture(domain), original = JSON.stringify(snapshot);
    const rich = new AuthoredConceptBank(richAsset), essential = new EssentialConceptBank({ version: 1, entries: clauses });
    const result = essential.resolve(domain, snapshot, rich);
    expect(result.find(r => r.key === reading.conceptKey)).toMatchObject({ readingId: reading.id,
        description: reading.description, essentialText: clauses[2].text });
    expect(result.find(r => r.key === entries[1].key)).toMatchObject({ readingId: null,
        description: entries[1].description, essentialText: clauses[1].text });
    expect(JSON.stringify(result)).not.toMatch(/RAW SOURCE|RAW LABEL|EDITORIAL/u);
    expect(JSON.stringify(snapshot)).toBe(original);
    expect(rich.generatorConcepts(domain, snapshot).find(c => c.key === reading.conceptKey)?.description).toBe(reading.description);
});

test.each(['culture', 'faith'] as const)('a missing selected %s variant holds even when the portable clause is available', domain => {
    const { snapshot, richAsset, clauses } = fixture(domain);
    const rich = new AuthoredConceptBank(richAsset);
    const essential = new EssentialConceptBank({ version: 1, entries: clauses.slice(0, 2) });
    expect(() => essential.resolve(domain, snapshot, rich)).toThrow(EssentialConceptUnavailable);
    expect(() => essential.resolve(domain, snapshot, rich)).toThrow('reviewed_intersection: missing');
});

test.each(['culture', 'faith'] as const)('the %s essential projection retains selected bytes and independent contributor meaning', domain => {
    const { snapshot, richAsset, clauses, reading, entries } = fixture(domain);
    // Ordinary vocabulary previously changed when a projected fact was mutated.
    clauses[2].text = 'Patient prestige and education retain the scoped exception.';
    const rich = new AuthoredConceptBank(richAsset), essential = new EssentialConceptBank({ version: 1, entries: clauses });
    const original = JSON.stringify(snapshot), richBefore = rich.generatorConcepts(domain, snapshot);
    const projected = domain === 'culture' ? essential.project(domain, snapshot as CultureSnapshot, rich) :
        essential.project(domain, snapshot as FaithSnapshot, rich);
    const primary = projected.facts.find(f => f.key === reading.conceptKey)!;
    expect(primary.description).toBe(clauses[2].text);
    expect(isAuthoredConceptReading(primary)).toBe(true);
    expect(projected.facts.find(f => f.key === entries[1].key)!.description).toBe(clauses[1].text);
    const plan = passagePlan(domain, projected);
    expect(plan.passages.some(p => p.text.includes(clauses[2].text))).toBe(true);
    expect(plan.passages.some(p => p.text.includes(clauses[1].text))).toBe(true);
    expect(JSON.stringify(projected)).not.toMatch(/RAW SOURCE|RAW LABEL|EDITORIAL|readingId|richDescriptionHash/u);
    expect(JSON.stringify(snapshot)).toBe(original);
    expect(rich.generatorConcepts(domain, snapshot)).toEqual(richBefore);
    expect(isAuthoredConceptReading(structuredClone(primary))).toBe(false);
    primary.description += ' An external edit.';
    expect(isAuthoredConceptReading(primary)).toBe(false);
});

test('essential projection removes only explicit cultural exclusions after validating the whole original composition', () => {
    const { snapshot, entries, richAsset, clauses } = fixture('culture');
    entries[1].status = 'excluded'; entries[1].description = '';
    const rich = new AuthoredConceptBank({ ...richAsset, conditionalReadings: [] });
    const essential = new EssentialConceptBank({ version: 1, entries: [clauses[0]] });
    const projected = essential.project('culture', snapshot as CultureSnapshot, rich);
    expect(projected.facts.some(f => f.key === entries[1].key)).toBe(false);
    expect(projected.facts.find(f => f.key === entries[0].key)!.description).toBe(clauses[0].text);
    const unknown = structuredClone(snapshot); unknown.facts.push({ ...unknown.facts.find(f => f.kind === 'tradition')!, key: 'unknown_custom' } as any);
    expect(() => essential.project('culture', unknown as CultureSnapshot, rich)).toThrow('missing');
});

test('a noncanonical tenet key identified by captured group metadata is still replaced', () => {
    const { snapshot, facts, entries, richAsset, clauses } = fixture('faith');
    facts[0].key = 'mod_custom_reverence';
    facts[0].rules = JSON.stringify({ definitions: [{ key: 'group_rules', value: [{ key: 'category', value: 'core_tenets' }] }] });
    entries[0].key = facts[0].key; entries[0].definitionHash = conceptDefinitionHash('faith', facts[0] as any);
    clauses[0].key = entries[0].key; clauses[0].definitionHash = entries[0].definitionHash;
    const rich = new AuthoredConceptBank({ ...richAsset, conditionalReadings: [] });
    const essential = new EssentialConceptBank({ version: 1, entries: clauses.slice(0, 2) });
    const projected = essential.project('faith', snapshot as FaithSnapshot, rich);
    expect(projected.facts.find(f => f.key === facts[0].key)!.description).toBe(clauses[0].text);
    expect(JSON.stringify(projected)).not.toMatch(/RAW SOURCE|RAW LABEL/u);
});

test.each(['culture', 'faith'] as const)('removing a %s contributor restores its independently bound portable clause', domain => {
    const { snapshot, entries, richAsset, clauses } = fixture(domain);
    const rich = new AuthoredConceptBank(richAsset), essential = new EssentialConceptBank({ version: 1, entries: clauses });
    const removed = { ...snapshot, facts: snapshot.facts.filter(f => f.key !== entries[1].key) } as any;
    expect(essential.resolve(domain, removed, rich)).toHaveLength(1);
    expect(essential.resolve(domain, removed, rich)[0]).toMatchObject({ readingId: null, essentialText: clauses[0].text });
    expect(essential.revision(domain, removed, rich)).not.toBe(essential.revision(domain, snapshot, rich));
    const restored = structuredClone(removed); restored.facts.push(snapshot.facts.find(f => f.key === entries[1].key)!);
    expect(essential.revision(domain, restored, rich)).toBe(essential.revision(domain, snapshot, rich));
});

test('changed rich meaning cannot reuse an old compact clause even when its definition and variant ID match', () => {
    const { snapshot, reading, richAsset, clauses } = fixture('faith');
    const essential = new EssentialConceptBank({ version: 1, entries: clauses });
    reading.description += ' Newly reviewed obligation.';
    const rich = new AuthoredConceptBank(richAsset);
    expect(() => essential.resolve('faith', snapshot, rich)).toThrow('stale_description');
    const updated = clauses.map(c => c.readingId === reading.id ? { ...c, richDescriptionHash: sha256Hex(reading.description),
        text: c.text + ' Preserve the new obligation.' } : c);
    expect(new EssentialConceptBank({ version: 1, entries: updated }).resolve('faith', snapshot, rich)
        .find(c => c.key === reading.conceptKey)!.essentialText)
        .toContain('new obligation');
});

test('all selected meanings are required; one available clause cannot disguise a missing second ingredient', () => {
    const { snapshot, richAsset, clauses, entries } = fixture('culture');
    const essential = new EssentialConceptBank({ version: 1, entries: [clauses[2]] });
    try { essential.resolve('culture', snapshot, new AuthoredConceptBank(richAsset)); throw new Error('Expected a missing-meaning hold'); }
    catch (e) { expect((e as EssentialConceptUnavailable).issues).toEqual([{ key: entries[1].key, readingId: null, reason: 'missing' }]); }
});

test('redefined and unknown game concepts retain the rich-bank hold without any source-text fallback', () => {
    const { snapshot, facts, richAsset, clauses } = fixture('culture');
    const essential = new EssentialConceptBank({ version: 1, entries: clauses }), rich = new AuthoredConceptBank(richAsset);
    facts[0].description += ' A different definition.';
    expect(() => essential.resolve('culture', snapshot, rich)).toThrow('definition_mismatch');
    facts[0].key = 'new_unreviewed_concept';
    expect(() => essential.resolve('culture', snapshot, rich)).toThrow('missing');
});

test('an excluded cultural concept needs no invented compact substitute', () => {
    const { snapshot, entries, richAsset } = fixture('culture');
    entries.forEach(e => { e.status = 'excluded'; e.description = ''; });
    const rich = new AuthoredConceptBank({ ...richAsset, conditionalReadings: [] });
    expect(new EssentialConceptBank({ version: 1, entries: [] }).resolve('culture', snapshot, rich)).toEqual([]);
});

test('ambiguous rich variants hold before clause selection regardless of available compact entries', () => {
    const { snapshot, richAsset, reading, clauses } = fixture('culture');
    richAsset.conditionalReadings.push({ ...reading, id: 'competing_intersection' });
    const essential = new EssentialConceptBank({ version: 1, entries: clauses });
    expect(() => essential.resolve('culture', snapshot, new AuthoredConceptBank(richAsset))).toThrow('conditional_conflict');
});

test('an uncaptured practice context never activates its clause through display names', () => {
    const { snapshot, richAsset, reading, clauses } = fixture('culture');
    reading.requires.currentInterpretationContextAllOf = ['unobserved_custom'];
    snapshot.facts.find(f => f.kind === 'pillar')!.name = 'unobserved_custom';
    expect(new EssentialConceptBank({ version: 1, entries: clauses }).resolve('culture', snapshot,
        new AuthoredConceptBank(richAsset))[0].readingId).toBeNull();
});

test('domain-local selected-content revisions ignore editorials, ordering and unrelated faith cards', () => {
    const c = fixture('culture'), f = fixture('faith');
    f.reading.id = 'faith_intersection'; f.clauses[2].readingId = f.reading.id;
    const richAsset = { version: 1, entries: [...c.entries, ...f.entries], conditionalReadingsVersion: 1,
        conditionalReadings: [c.reading, f.reading] };
    const asset = { version: 1, entries: [...c.clauses, ...f.clauses] };
    const revision = new EssentialConceptBank(asset).revision('culture', c.snapshot, new AuthoredConceptBank(richAsset));
    asset.entries.forEach(e => e.rationale += ' Added evidence.');
    f.clauses.forEach(e => e.text += ' An unrelated faith change.');
    c.clauses[0].text += ' An unselected portable change.';
    const essential = new EssentialConceptBank({ ...asset, entries: [...asset.entries].reverse() });
    expect(essential.revision('culture', { ...c.snapshot, facts: [...c.snapshot.facts].reverse() } as any,
        new AuthoredConceptBank(richAsset))).toBe(revision);
    c.clauses[2].text += ' A selected change.';
    expect(new EssentialConceptBank(asset).revision('culture', c.snapshot, new AuthoredConceptBank(richAsset))).not.toBe(revision);
});

test('same snapshot and reviewed contents yield the same revision across separate bank instances', () => {
    const { snapshot, clauses, richAsset } = fixture('faith');
    const calculate = () => new EssentialConceptBank({ version: 1, entries: structuredClone(clauses) })
        .revision('faith', structuredClone(snapshot), new AuthoredConceptBank(structuredClone(richAsset)));
    expect(calculate()).toBe(calculate());
});

test('caller mutations cannot alter a loaded clause or its selected revision', () => {
    const { snapshot, clauses, richAsset } = fixture('culture'), rich = new AuthoredConceptBank(richAsset);
    const essential = new EssentialConceptBank({ version: 1, entries: clauses }), revision = essential.revision('culture', snapshot, rich);
    clauses[2].text = 'An external mutation.';
    const result = essential.resolve('culture', snapshot, rich); result[0].essentialText = 'Another mutation.';
    expect(essential.revision('culture', snapshot, rich)).toBe(revision);
    expect(essential.resolve('culture', snapshot, rich)[0].essentialText).not.toMatch(/mutation/u);
});

test('malformed clauses and competing bindings fail at load rather than being ignored', () => {
    const { clauses } = fixture('culture'), e = clauses[0];
    const invalid = [{ ...e, readingId: undefined }, { ...e, richDescriptionHash: 'invalid' },
        { ...e, text: ' ' }, { ...e, rationale: '' }, { ...e, silentlyIgnoredCondition: 'anything' },
        { ...e, readingId: 'bad:id' }, { ...e, domain: 'race' }];
    for (const bad of invalid) expect(() => new EssentialConceptBank({ version: 1, entries: [bad] })).toThrow('entry');
    expect(() => new EssentialConceptBank({ version: 1, entries: [e, { ...e, richDescriptionHash: '0'.repeat(64) }] }))
        .toThrow('Duplicate');
    expect(() => new EssentialConceptBank({ version: 1, entries: [], unsupportedDefault: 'raw prose' })).toThrow('bank');
});
