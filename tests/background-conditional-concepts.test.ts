import { AuthoredConceptBank, AuthoredConceptEntry, conceptDefinitionHash, ConditionalConceptReading } from
    '../src/main/background/authoredConceptBank';
import { snapshot as cultureFixture } from './culture/fixtures';
import { snapshot as faithFixture } from './faith/fixtures';
import { CultureSnapshot } from '../src/shared/gameData/CultureSnapshot';
import { FaithSnapshot } from '../src/shared/gameData/FaithSnapshot';

function fixture(domain: 'culture' | 'faith') {
    const snapshot: CultureSnapshot | FaithSnapshot = domain === 'culture' ? cultureFixture() : faithFixture();
    snapshot.facts = snapshot.facts.filter(f => f.kind !== 'tradition' && !f.key.startsWith('tenet_')) as any;
    const facts = ['primary', 'contributor'].map(key => ({ kind: domain === 'culture' ? 'tradition' : 'doctrine',
        ...(domain === 'culture' ? { category: 'societal' } : {}), key: domain === 'culture' ? key : 'tenet_' + key,
        name: 'ORIGINAL ' + key, description: 'RAW SOURCE ' + key, rules: '{}' }));
    (snapshot.facts as any[]).push(...facts);
    const entries: AuthoredConceptEntry[] = facts.map(f => ({ domain, key: f.key,
        definitionHash: conceptDefinitionHash(domain, f as any), status: 'authored', label: 'Reviewed ' + f.key,
        description: 'Portable reviewed meaning of ' + f.key + '.', tags: [], rationale: 'Private editorial note.' }));
    const reading: ConditionalConceptReading = { id: 'reviewed_interaction', domain,
        conceptKey: entries[0].key, definitionHash: entries[0].definitionHash,
        label: 'Tailored meaning', description: 'Both adopted values coexist without forcing personal compliance.',
        requires: { concept: entries[0].key, otherConceptsAllOf: [entries[1].key] },
        contributorDefinitionHashes: { [entries[1].key]: entries[1].definitionHash },
        replaces: 'this_concept_reading_only', guard: 'PRIVATE GUARD', handbookEntries: [], evidenceBasis: 'PRIVATE EVIDENCE' };
    const asset = { version: 1, entries, conditionalReadingsVersion: 1, conditionalReadings: [reading] };
    return { snapshot, facts, entries, reading, asset };
}

test.each(['culture', 'faith'] as const)('a current %s combination replaces only its primary reading and washes original prose', domain => {
    const { snapshot, entries, reading, asset } = fixture(domain), original = JSON.stringify(snapshot);
    const bank = new AuthoredConceptBank(asset), cards = bank.generatorConcepts(domain, snapshot);
    expect(cards.find(c => c.key === entries[0].key)?.description).toBe(reading.description);
    expect(cards.find(c => c.key === entries[1].key)?.description).toBe(entries[1].description);
    const view = bank.project(domain as any, snapshot as any);
    expect(view.facts.find(f => f.key === entries[0].key)?.description).toBe(reading.description);
    expect(JSON.stringify(view)).not.toMatch(/RAW SOURCE|ORIGINAL |PRIVATE GUARD|PRIVATE EVIDENCE/u);
    expect(JSON.stringify(snapshot)).toBe(original);
    expect(bank.generatorConcepts(domain, { ...snapshot, facts: [...snapshot.facts].reverse() } as any)).toEqual(cards);
});

test.each(['culture', 'faith'] as const)('removal of the %s contributor restores the exact portable reading and cache revision', domain => {
    const { snapshot, entries, asset } = fixture(domain), bank = new AuthoredConceptBank(asset);
    const generic = new AuthoredConceptBank({ version: 1, entries });
    const removed = { ...snapshot, facts: snapshot.facts.filter(f => f.key !== entries[1].key) } as any;
    expect(bank.generatorConcepts(domain, removed)[0].description).toBe(entries[0].description);
    expect(bank.revision(domain, removed)).toBe(generic.revision(domain, removed));
    expect(bank.revision(domain, snapshot)).not.toBe(generic.revision(domain, snapshot));
    const reformed = structuredClone(removed); reformed.facts.push(structuredClone(snapshot.facts.find(f => f.key === entries[1].key)!));
    expect(bank.revision(domain, reformed)).toBe(bank.revision(domain, snapshot));
});

test('a redefined contributor is held rather than satisfying the old interaction or leaking its raw text', () => {
    const { snapshot, entries, asset } = fixture('faith'), bank = new AuthoredConceptBank(asset);
    snapshot.facts.find(f => f.key === entries[1].key)!.description = 'A changed teaching.';
    expect(() => bank.generatorConcepts('faith', snapshot)).toThrow('definition_mismatch');
    expect(() => bank.project('faith', snapshot as FaithSnapshot)).toThrow('definition_mismatch');
});

test('uncaptured interpretation context stays dormant even when names and graphics suggest it', () => {
    const { snapshot, entries, reading, asset } = fixture('culture');
    reading.requires.currentInterpretationContextAllOf = ['wildhammer_gryphon_falconry'];
    snapshot.facts.find(f => f.kind === 'pillar' && f.category === 'heritage')!.name = 'Wildhammer';
    (snapshot.facts as any[]).push({ kind: 'aesthetic', key: 'coa_gfx:wildhammer_coa_gfx', category: 'coa_gfx',
        name: 'wildhammer_gryphon_falconry', description: '', rules: '{}' });
    const bank = new AuthoredConceptBank(asset), generic = new AuthoredConceptBank({ version: 1, entries });
    expect(bank.generatorConcepts('culture', snapshot)).toEqual(generic.generatorConcepts('culture', snapshot));
    expect(bank.revision('culture', snapshot)).toBe(generic.revision('culture', snapshot));
});

test('heritage predicates use the current cultural pillar rather than a visitor or display name', () => {
    const { snapshot, entries, reading, asset } = fixture('culture');
    const heritage = snapshot.facts.find(f => f.kind === 'pillar' && f.category === 'heritage')!;
    reading.requires.heritageAnyOf = [heritage.key];
    // A newly authored heritage proposal is dormant until main reviews its exact pillar.
    expect(new AuthoredConceptBank(asset).generatorConcepts('culture', snapshot)
        .find(c => c.key === entries[0].key)!.description).toBe(entries[0].description);
    reading.heritageDefinitionHashes = { [heritage.key]: conceptDefinitionHash('culture', heritage) };
    const bank = new AuthoredConceptBank(asset);
    expect(bank.generatorConcepts('culture', snapshot).find(c => c.key === entries[0].key)!.description).toBe(reading.description);
    const changed = structuredClone(snapshot);
    changed.facts.find(f => f.kind === 'pillar' && f.category === 'heritage')!.description += ' Redefined by an overhaul.';
    expect(bank.generatorConcepts('culture', changed).find(c => c.key === entries[0].key)!.description).toBe(entries[0].description);
    heritage.key = 'heritage_different'; heritage.name = reading.requires.heritageAnyOf[0];
    expect(bank.generatorConcepts('culture', snapshot).find(c => c.key === entries[0].key)!.description).toBe(entries[0].description);
});

test('competing matches are an explicit hold independent of authoring file order', () => {
    const { snapshot, reading, asset } = fixture('culture');
    asset.conditionalReadings.push({ ...reading, id: 'competing_interaction', description: 'A different interpretation.' });
    for (const conditionalReadings of [asset.conditionalReadings, [...asset.conditionalReadings].reverse()]) {
        const bank = new AuthoredConceptBank({ ...asset, conditionalReadings });
        expect(() => bank.generatorConcepts('culture', snapshot)).toThrow('conditional_conflict');
    }
});

test('an exact combined refinement supersedes its broader matches regardless of file order', () => {
    const { snapshot, reading, entries, asset } = fixture('culture');
    const heritage = snapshot.facts.find(f => f.kind === 'pillar' && f.category === 'heritage')!;
    const hashes = { [heritage.key]: conceptDefinitionHash('culture', heritage) };
    const heritageOnly = { ...reading, id: 'heritage_reading', description: 'Heritage-specific meaning.',
        requires: { concept: entries[0].key, heritageAnyOf: [heritage.key] },
        heritageDefinitionHashes: hashes, contributorDefinitionHashes: {} };
    const combined = { ...reading, id: 'full_combination', description: 'The exact current combination is interpreted together.',
        requires: { ...reading.requires, heritageAnyOf: [heritage.key] }, heritageDefinitionHashes: hashes };
    for (const conditionalReadings of [[reading, heritageOnly, combined], [combined, heritageOnly, reading]]) {
        const bank = new AuthoredConceptBank({ ...asset, conditionalReadings });
        expect(bank.generatorConcepts('culture', snapshot).find(c => c.key === entries[0].key)!.description).toBe(combined.description);
    }
});

test('incomparable heritage and adopted-concept matches remain a hold until a composition is authored', () => {
    const { snapshot, reading, entries, asset } = fixture('culture');
    const heritage = snapshot.facts.find(f => f.kind === 'pillar' && f.category === 'heritage')!;
    const heritageOnly = { ...reading, id: 'heritage_reading', description: 'An incomparable meaning.',
        requires: { concept: entries[0].key, heritageAnyOf: [heritage.key] }, contributorDefinitionHashes: {},
        heritageDefinitionHashes: { [heritage.key]: conceptDefinitionHash('culture', heritage) } };
    expect(() => new AuthoredConceptBank({ ...asset, conditionalReadings: [reading, heritageOnly] })
        .generatorConcepts('culture', snapshot)).toThrow('conditional_conflict');
});

test('selected variant content affects revision while editorial or dormant-variant edits do not', () => {
    const { snapshot, reading, asset } = fixture('culture'), bank = new AuthoredConceptBank(asset);
    const revision = bank.revision('culture', snapshot);
    reading.guard += ' New evidence.'; reading.evidenceBasis += ' New editorial research.';
    asset.conditionalReadings.push({ ...reading, id: 'dormant_other_reading',
        requires: { ...reading.requires, currentInterpretationContextAllOf: ['uncaptured_teaching'] },
        description: 'Dormant specificity.' });
    expect(new AuthoredConceptBank(asset).revision('culture', snapshot)).toBe(revision);
    reading.description += ' A reviewed additional meaning.';
    expect(new AuthoredConceptBank(asset).revision('culture', snapshot)).not.toBe(revision);
    // Mutation of caller-owned nested requirements cannot change an already loaded bank.
    (reading.requires.otherConceptsAllOf as string[]).splice(0);
    reading.contributorDefinitionHashes = {};
    expect(bank.revision('culture', snapshot)).toBe(revision);
});

test('conditional schema rejects incomplete contributors, cross-domain references and unsupported predicates', () => {
    const { reading, asset } = fixture('culture');
    const invalid = [
        { ...reading, unless: 'An unsupported negative condition must never be ignored.' },
        { ...reading, requires: { ...reading.requires, executablePredicate: 'anything' } },
        { ...reading, contributorDefinitionHashes: {} },
        { ...reading, contributorDefinitionHashes: { contributor: '0'.repeat(64) } },
        { ...reading, replaces: 'all_culture' },
        { ...reading, requires: { concept: reading.conceptKey }, contributorDefinitionHashes: {} },
        { ...reading, requires: { ...reading.requires, otherConceptsAllOf: ['tenet_primary'] },
            contributorDefinitionHashes: { tenet_primary: '0'.repeat(64) } }
    ];
    for (const bad of invalid) expect(() => new AuthoredConceptBank({ ...asset, conditionalReadings: [bad] })).toThrow();
    expect(() => new AuthoredConceptBank({ ...asset, conditionalReadingsVersion: 2 })).toThrow();
    expect(() => new AuthoredConceptBank({ ...asset, conditionalReadings: [reading, reading] })).toThrow();
});

test('an opted-in domain adapter activates a faith reading without erasing its adopted contributor', () => {
    const { snapshot, entries, reading, asset } = fixture('faith');
    reading.requires.currentInterpretationContextAllOf = ['affirmed_elemental_subjugation_teaching'];
    const adapter = (domain: string) => domain === 'faith' ? ['affirmed_elemental_subjugation_teaching'] : [];
    const plain = new AuthoredConceptBank(asset), bank = new AuthoredConceptBank(asset, adapter);
    expect(plain.generatorConcepts('faith', snapshot)).toEqual(new AuthoredConceptBank({ version: 1, entries }).generatorConcepts('faith', snapshot));
    expect(bank.generatorConcepts('faith', snapshot).find(c => c.key === entries[0].key)!.description).toBe(reading.description);
    expect(bank.generatorConcepts('faith', snapshot).find(c => c.key === entries[1].key)!.description).toBe(entries[1].description);
    expect(bank.revision('faith', snapshot)).not.toBe(plain.revision('faith', snapshot));
    const removed = { ...snapshot, facts: snapshot.facts.filter(f => f.key !== entries[1].key) } as FaithSnapshot;
    expect(bank.generatorConcepts('faith', removed)[0].description).toBe(entries[0].description);
    expect(bank.revision('faith', removed)).toBe(plain.revision('faith', removed));
    const changed = structuredClone(snapshot);
    changed.facts.find(f => f.key === entries[1].key)!.description = 'Current redefined doctrine';
    expect(() => bank.generatorConcepts('faith', changed)).toThrow('definition_mismatch');
});

test('a partial context cannot select a combined teaching and domain-local evidence stays local', () => {
    const { snapshot, entries, reading, asset } = fixture('faith');
    reading.requires.currentInterpretationContextAllOf = ['affirmed_loa_patronage_teaching', 'affirmed_earth_mother_teaching'];
    const bank = new AuthoredConceptBank(asset, domain => domain === 'faith' ? ['affirmed_loa_patronage_teaching'] : []);
    expect(bank.generatorConcepts('faith', snapshot).find(c => c.key === entries[0].key)!.description).toBe(entries[0].description);
    const culture = fixture('culture');
    culture.reading.requires.currentInterpretationContextAllOf = ['affirmed_loa_patronage_teaching'];
    const cultureBank = new AuthoredConceptBank(culture.asset, domain => domain === 'faith' ? ['affirmed_loa_patronage_teaching'] : []);
    expect(cultureBank.generatorConcepts('culture', culture.snapshot).find(c => c.key === culture.entries[0].key)!.description).toBe(culture.entries[0].description);
});

test('adapter mutation cannot rewrite raw evidence or create an adopted contributor', () => {
    const { snapshot, entries, reading, asset } = fixture('faith'), before = JSON.stringify(snapshot);
    reading.requires.currentInterpretationContextAllOf = ['affirmed_teaching'];
    const bank = new AuthoredConceptBank(asset, (domain, evidence) => {
        evidence.facts.find(f => f.key === entries[1].key)!.description = 'Forged contributor';
        return ['affirmed_teaching'];
    });
    expect(bank.generatorConcepts('faith', snapshot).find(c => c.key === entries[0].key)!.description).toBe(reading.description);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(JSON.stringify(bank.project('faith', snapshot as FaithSnapshot))).not.toMatch(/affirmed_teaching|PRIVATE GUARD|RAW SOURCE/u);
});

test.each([['bad context'], ['duplicate', 'duplicate'], [12]])('invalid adapter context fails before projection: %p', (...context) => {
    const { snapshot, asset } = fixture('faith');
    const bank = new AuthoredConceptBank(asset, () => context as string[]);
    expect(() => bank.generatorConcepts('faith', snapshot)).toThrow('Invalid reviewed interpretation context');
});
