import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AuthoredConceptBank, AuthoredConceptEntry, AuthoredConceptUnavailable, conceptDefinitionHash, isAuthoredConceptReading,
    getBundledAuthoredConceptBank } from '../src/main/background/authoredConceptBank';
import { snapshot as culturalSnapshot } from './culture/fixtures';
import { snapshot as religiousSnapshot } from './faith/fixtures';
import { CultureFact } from '../src/shared/gameData/CultureSnapshot';
import { FaithFact } from '../src/shared/gameData/FaithSnapshot';
import { passagePlan } from '../src/main/background/sourceReference';
import { cultureSourceId } from '../src/main/culture/cultureEvidence';

function source(domain: 'culture' | 'faith', key = domain === 'culture' ? 'test_craft' : 'tenet_test_inquiry'): CultureFact | FaithFact {
    return { kind: domain === 'culture' ? 'tradition' : 'doctrine', key,
        ...(domain === 'culture' ? { category: 'societal' } : {}),
        name: 'Borrowed Greek source label', description: 'ORIGINAL SOURCE PROSE WITH UNRELATED GEOGRAPHY',
        rules: JSON.stringify({ definitions: [{ key: 'group_rules', value: [{ key: 'category', value: 'core_tenets' }] },
            { key: 'hidden_literal', value: 'SOURCE PROSE HIDDEN IN A SCRIPT NODE' }],
            meanings: { copied: 'SOURCE PROSE HIDDEN IN A MEANING DICTIONARY' } }) } as CultureFact | FaithFact;
}
function entry(domain: 'culture' | 'faith', fact: CultureFact | FaithFact): AuthoredConceptEntry {
    return { domain, key: fact.key, definitionHash: conceptDefinitionHash(domain, fact), status: 'authored',
        label: 'Shared Practical Learning', description: 'Patient teaching and practical inquiry receive public esteem.',
        tags: ['learning'], rationale: 'EDITORIAL METADATA MUST NOT REACH THE GENERATOR' };
}
function fixture(domain: 'culture' | 'faith') {
    const snapshot = domain === 'culture' ? culturalSnapshot() : religiousSnapshot();
    // Keep the real validated snapshot shape while isolating one selected concept.
    snapshot.facts = snapshot.facts.filter(f => f.kind !== 'tradition' && !f.key.startsWith('tenet_')) as any;
    const fact = source(domain);
    (snapshot.facts as any[]).push(fact);
    return { snapshot, fact, card: entry(domain, fact) };
}

test.each(['culture', 'faith'] as const)('the %s generator view replaces original labels and all rule prose without mutating identity', domain => {
    const { snapshot, fact, card } = fixture(domain), original = JSON.stringify(snapshot);
    const bank = new AuthoredConceptBank({ version: 1, entries: [card] });
    const view = domain === 'culture' ? bank.project(domain, snapshot as any) : bank.project(domain, snapshot as any);
    const projected = view.facts.find(f => f.key === fact.key)!;
    expect(projected.name).toBe(card.label);
    expect(projected.description).toBe(card.description);
    expect(JSON.stringify(view)).not.toMatch(/ORIGINAL SOURCE|SOURCE PROSE HIDDEN|Borrowed Greek|EDITORIAL METADATA/u);
    expect(JSON.stringify(snapshot)).toBe(original);
    expect(bank.generatorConcepts(domain, snapshot)).toEqual([{ key: fact.key, label: card.label, description: card.description }]);
});

test.each(['culture', 'faith'] as const)('missing and redefined %s concepts are held explicitly with no raw fallback', domain => {
    const { snapshot, fact, card } = fixture(domain);
    const empty = new AuthoredConceptBank({ version: 1, entries: [] });
    expect(() => empty.generatorConcepts(domain, snapshot)).toThrow(AuthoredConceptUnavailable);
    try { empty.generatorConcepts(domain, snapshot); } catch (e) {
        expect((e as AuthoredConceptUnavailable).issues).toEqual([{ key: fact.key, reason: 'missing' }]);
    }
    const bank = new AuthoredConceptBank({ version: 1, entries: [card] }), before = bank.revision(domain, snapshot);
    fact.description = 'A mod redefines the familiar key as something else.';
    expect(bank.revision(domain, snapshot)).not.toBe(before);
    expect(() => bank.generatorConcepts(domain, snapshot)).toThrow('definition_mismatch');
});

test('a known excluded culture decision stays in identity but supplies no invented secular substitute', () => {
    const { snapshot, fact, card } = fixture('culture'), original = JSON.stringify(snapshot);
    card.status = 'excluded'; card.description = ''; card.rationale = 'This concept belongs to faith.';
    const bank = new AuthoredConceptBank({ version: 1, entries: [card] });
    expect(bank.generatorConcepts('culture', snapshot)).toEqual([]);
    expect(bank.project('culture', snapshot as any).facts.some(f => f.key === fact.key)).toBe(false);
    expect(JSON.stringify(snapshot)).toBe(original);
    const redefined = structuredClone(snapshot); redefined.facts.find(f => f.key === fact.key)!.description += ' Changed.';
    expect(() => bank.generatorConcepts('culture', redefined)).toThrow('definition_mismatch');
});

test('held entries and excluded faith tenets cannot silently masquerade as complete interpretations', () => {
    const { snapshot, card } = fixture('faith');
    for (const status of ['needs_review', 'excluded'] as const) {
        const bank = new AuthoredConceptBank({ version: 1, entries: [{ ...card, status, description: '' }] });
        expect(() => bank.generatorConcepts('faith', snapshot)).toThrow(status === 'excluded' ? 'faith_excluded' : 'needs_review');
    }
});

test('core-tenet membership survives opaque localized names and custom canonical keys', () => {
    const { snapshot, fact } = fixture('faith');
    fact.key = 'custom_spiritual_practice'; fact.name = 'unresolved_name_identifier';
    const card = entry('faith', fact), bank = new AuthoredConceptBank({ version: 1, entries: [card] });
    expect(bank.generatorConcepts('faith', snapshot)).toHaveLength(1);
    const view = bank.project('faith', snapshot as any);
    expect(view.facts.find(f => f.key === fact.key)!.name).toBe(card.label);
});

test('an unclassified tenet-like key cannot leak through the ordinary-doctrine lane', () => {
    const { snapshot, fact } = fixture('faith'); fact.rules = '{}';
    const bank = new AuthoredConceptBank({ version: 1, entries: [] });
    expect(() => bank.generatorConcepts('faith', snapshot)).toThrow('missing');
});

test('full definition fingerprints ignore rule serialization order but detect name, prose and effect changes', () => {
    const fact = source('culture') as CultureFact, hash = conceptDefinitionHash('culture', fact);
    const rules = JSON.parse(fact.rules);
    expect(conceptDefinitionHash('culture', { ...fact, rules: JSON.stringify({ meanings: rules.meanings, definitions: rules.definitions }, null, 2) })).toBe(hash);
    for (const field of ['name', 'description', 'category'] as const)
        expect(conceptDefinitionHash('culture', { ...fact, [field]: fact[field] + ' altered' })).not.toBe(hash);
    expect(conceptDefinitionHash('culture', { ...fact, rules: JSON.stringify({ ...rules, changed_effect: 1 }) })).not.toBe(hash);
});

test('only selected interpretation changes invalidate a domain revision; editorial edits and unrelated domains do not', () => {
    const { snapshot, card } = fixture('culture'), other = entry('faith', source('faith'));
    const revision = new AuthoredConceptBank({ version: 1, entries: [card, other] }).revision('culture', snapshot);
    expect(new AuthoredConceptBank({ version: 1, entries: [{ ...card, rationale: 'New editorial evidence.' }, { ...other,
        label: 'Unrelated faith edit', description: 'An unrelated faith teaching changes.' }] }).revision('culture', snapshot)).toBe(revision);
    expect(new AuthoredConceptBank({ version: 1, entries: [{ ...card, description: 'Craft reputation is now valued chiefly for wealth.' }, other] })
        .revision('culture', snapshot)).not.toBe(revision);
    expect(new AuthoredConceptBank({ version: 1, entries: [card, other] }).revision('culture', {
        ...snapshot, facts: [...snapshot.facts].reverse() } as any)).toBe(revision);
});

test('caller mutations cannot silently change a loaded bank or its cache revision', () => {
    const { snapshot, card } = fixture('culture');
    const bank = new AuthoredConceptBank({ version: 1, entries: [card] }), revision = bank.revision('culture', snapshot);
    card.description = 'Accidental external mutation'; (card.tags as string[]).push('mutated');
    expect(bank.revision('culture', snapshot)).toBe(revision);
    expect(bank.generatorConcepts('culture', snapshot)[0].description).not.toContain('mutation');
});

test.each(['culture', 'faith'] as const)('reviewed %s readings survive incidental education/decision words without trusting raw or mutated facts', domain => {
    const { snapshot, fact, card } = fixture(domain);
    card.description = 'Education and a considered decision receive public esteem.';
    const bank = new AuthoredConceptBank({ version: 1, entries: [card] });
    const view = bank.project(domain as any, snapshot as any), projected = view.facts.find(f => f.key === fact.key)!;
    const sourceId = domain === 'culture' ? cultureSourceId(fact as CultureFact) : fact.kind + ':' + fact.key;
    expect(isAuthoredConceptReading(fact)).toBe(false);
    expect(isAuthoredConceptReading(projected)).toBe(true);
    expect(passagePlan(domain, view).passages.find(p => p.source === sourceId || p.contributors?.includes(sourceId))?.text).toContain(card.description);
    expect(isAuthoredConceptReading(structuredClone(projected))).toBe(false);
    projected.description = 'SOURCE PROSE INSERTED AFTER PROJECTION';
    expect(isAuthoredConceptReading(projected)).toBe(false);
});

test('reviewed social wording is preserved literally without currency substitutions', () => {
    const { snapshot, fact, card } = fixture('culture');
    card.description = 'Careful breeding can earn prestige through patient knowledge.';
    const bank = new AuthoredConceptBank({ version: 1, entries: [card] });
    const view = bank.project('culture', snapshot as any);
    expect(passagePlan('culture', view).passages.find(p => p.source === cultureSourceId(fact as CultureFact))?.text).toBe(card.description);
});

test('malformed banks reject prose on excluded entries and duplicate exact definitions', () => {
    const card = entry('culture', source('culture'));
    expect(() => new AuthoredConceptBank({ version: 1, entries: [card, card] })).toThrow('Duplicate');
    expect(() => new AuthoredConceptBank({ version: 1, entries: [{ ...card, status: 'excluded' }] })).toThrow('prose status');
    expect(() => new AuthoredConceptBank({ version: 1, entries: [{ ...card, definitionHash: 'invalid' }] })).toThrow('entry');
});

test('bundled asset loads every declared definition decision; review metadata is separate from generator prose', () => {
    const asset = JSON.parse(readFileSync(path.join(__dirname, '../public/backgroundConcepts/recipe/authored.json'), 'utf8'));
    expect(asset.entries).toHaveLength(270);
    expect(asset.entries.filter((e: AuthoredConceptEntry) => e.status === 'authored')).toHaveLength(256);
    expect(asset.entries.filter((e: AuthoredConceptEntry) => e.status === 'excluded')).toHaveLength(14);
    expect(getBundledAuthoredConceptBank()).toBeInstanceOf(AuthoredConceptBank);
});
