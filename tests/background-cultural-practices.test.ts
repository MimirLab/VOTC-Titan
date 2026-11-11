import fs from 'node:fs';
import path from 'node:path';
import { BackgroundIngredientBank, getBackgroundIngredients } from '../src/main/background/backgroundIngredients';
import { CulturePracticeBank, getCulturePracticeBank } from '../src/main/background/culturePracticeBank';
import { CultureSnapshot, CultureFact } from '../src/shared/gameData/CultureSnapshot';
import { CultureCatalog } from '../src/main/culture/cultureCatalog';
import { CultureLogReader } from '../src/main/culture/cultureLog';
import { cultureCaptureEffect } from '../src/main/culture/cultureBridge';
import { parseCk3Script, ScriptEntry } from '../src/main/culture/ck3Script';
import { logicalRequestHash } from '../src/main/promptWorkbench/canonicalJson';
import { passagePlan, renderExtraction } from '../src/main/background/sourceReference';

const read = (p: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), p), 'utf8'));
const fixture = read('tests/culture/practice-sources.json');
const rules = read('public/backgroundConcepts/recipe/practices.json');
const bank = getBackgroundIngredients(), practices = getCulturePracticeBank();
const sourceFiles = new Map<string, string>(Object.entries(fixture.files));
const practiceFacts = practices.catalogueFacts(sourceFiles, fixture.cultureFacts);
const unique = (facts: CultureFact[]) => [...new Map(facts.map(f => [f.kind + ':' + f.key, f])).values()];
const basis: CultureFact[] = fixture.basis.facts.filter((f: CultureFact) => ['pillar', 'naming'].includes(f.kind) && !f.key.startsWith('live:'));
const content = { version: 2 as const, facts: unique([...basis, ...fixture.cultureFacts, ...practiceFacts]),
    eras: fixture.basis.facts.filter((f: CultureFact) => f.kind === 'era'), courts: [], traitValuations: [],
    pillarCategories: [...new Set(basis.filter(f => f.kind === 'pillar').map(f => f.category))].sort() };
const catalog: CultureCatalog = { ...content, digest: logicalRequestHash(content) };

interface NativeState { id: string; parents: string[]; traditions: string[] }
// Finite interpreter for the emitted read-only native predicate. This is not CK3 acceptance.
function evaluate(entries: ScriptEntry[], state: NativeState): boolean {
    return entries.every(e => {
        if (e.key === 'OR' && Array.isArray(e.value)) return e.value.some(v => evaluate([v], state));
        if (e.key === 'any_parent_culture_or_above' && Array.isArray(e.value))
            return state.parents.some(id => evaluate(e.value as ScriptEntry[], { ...state, id, parents: [] }));
        if (e.key === 'this' && typeof e.value === 'string') return e.value === 'culture:' + state.id;
        if (e.key === 'has_cultural_tradition' && typeof e.value === 'string') return state.traditions.includes(e.value);
        throw new Error('Unexpected predicate primitive: ' + e.key);
    });
}
function frame(key: string, options: { traditions?: string[]; parents?: string[]; nativeId?: string; heritage?: string } = {}) {
    const seed = fixture.cultures.find((c: any) => c.key === key);
    const traditions: string[] = options.traditions ?? seed.traditions;
    const state: NativeState = { id: options.nativeId ?? key, parents: options.parents ?? [], traditions };
    const facts = [...basis.filter(f => f.kind !== 'pillar' || f.category !== 'heritage'),
        fixture.cultureFacts.find((f: CultureFact) => f.kind === 'pillar' && f.key === (options.heritage ?? seed.heritage)),
        ...traditions.map(k => fixture.cultureFacts.find((f: CultureFact) => f.kind === 'tradition' && f.key === k))] as CultureFact[];
    const lines = [`VOTC:CULTURE/;/begin/;/2/;/${catalog.digest}/;/10/;/20/;/${traditions.length}/;/0`,
        ...facts.map(f => `VOTC:CULTURE/;/fact/;/${f.kind}/;/${f.key}`),
        ...practiceFacts.map(f => `VOTC:CULTURE/;/practice/;/${f.key}/;/${evaluate(parseCk3Script(practices.capturePredicate(f)), state) ? '1' : '0'}`),
        'VOTC:CULTURE/;/support/;/era/;/fixture era',
        'VOTC:CULTURE/;/support/;/naming_order/;/fixture order',
        'VOTC:CULTURE/;/support/;/primary_naming/;/fixture names',
        `VOTC:CULTURE/;/end/;/${catalog.digest}/;/10/;/20`];
    return lines;
}
function capture(lines: string[]) {
    const reader = new CultureLogReader(catalog);
    let result;
    for (const line of lines) result = reader.read(line) ?? result;
    return result?.snapshot;
}
function snapshot(key: string, options: Parameters<typeof frame>[1] = {}): CultureSnapshot {
    const result = capture(frame(key, options));
    expect(result).toBeDefined();
    return result!;
}
const output = (s: CultureSnapshot) => renderExtraction('culture', bank.project('culture', s), { selections: [] });

test('exact effective source definitions qualify seventeen native practice/anchor facts', () => {
    expect(practiceFacts).toHaveLength(17);
    const script = cultureCaptureEffect(catalog);
    expect(() => parseCk3Script(script)).not.toThrow();
    for (const fact of practiceFacts) {
        expect(script).toContain('practice/;/' + fact.key + '/;/1');
        expect(script).toContain('practice/;/' + fact.key + '/;/0');
    }
    expect(script).toContain('any_parent_culture_or_above');
    expect(script).not.toMatch(/set_variable|set_flag|save_scope|add_cultural_tradition/);
});

test.each(['wildhammer', 'frostwolf', 'dark_iron', 'moknathal', 'nerubian', 'kobold'])('%s current source customs reach distinctive meanings once', key => {
    const s = snapshot(key), before = JSON.stringify(s), result = output(s);
    const rule = rules.rules.find((r: any) => r.cultureDefinitions[key]);
    const selected = bank.authored.resolvedConcepts('culture', s);
    const covered = rule.coveredReadingIds.some((id: string) => selected.some(r => r.readingId === id));
    if (covered) expect(result.paragraph).not.toContain(rule.text);
    else expect(result.paragraph.split(rule.text)).toHaveLength(2);
    expect(JSON.stringify(s)).toBe(before);
    expect(result.paragraph).not.toMatch(/adopted_custom_interpretation|sourceDefinitions|cultureDefinitions/);
});

test('Wildhammer current Hunters/Shared Kinship communicate clan gryphon care without Falconry', () => {
    const s = snapshot('wildhammer');
    expect(s.facts.some(f => f.key === 'tradition_ep2_avid_falconers')).toBe(false);
    expect(output(s).paragraph).toContain('Shared roost work teaches companionship before command');
    expect(output(s).paragraph).toContain('even when its members do not ride');
});

test('actual later Falconry adoption selects the approved replacement and does not repeat roost care', () => {
    const seed = fixture.cultures.find((c: any) => c.key === 'wildhammer');
    const s = snapshot('wildhammer', { traditions: [...seed.traditions, 'tradition_ep2_avid_falconers'] });
    expect(bank.authored.resolvedConcepts('culture', s).find(r => r.key === 'tradition_ep2_avid_falconers')?.readingId)
        .toBe('falconry_wildhammer_gryphon');
    const text = output(s).paragraph;
    expect(text).toContain('raising, caring for and riding gryphons');
    expect(text).toContain('horse-flesh appetite');
    expect(text).toContain('Shared roost work and provisioning nesting gryphons');
    expect(text).not.toContain('Shared roost work teaches companionship before command');
});

test('retained relevant custom survives unrelated reforms, renaming, and a hybrid with changed heritage', () => {
    const a = snapshot('wildhammer', { traditions: ['tradition_hunters'] });
    const b = snapshot('wildhammer', { traditions: ['tradition_tribe_unity'], nativeId: 'renamed_hybrid_20', parents: ['wildhammer'], heritage: 'heritage_orcish' });
    const text = rules.rules.find((r: any) => r.id === 'wildhammer_gryphon_falconry').text;
    expect(output(a).paragraph).toContain(text);
    expect(output(b).paragraph).toContain(text);
    expect(bank.revision('culture', a)).not.toBe(bank.revision('culture', b));
});

test('same heritage, names, art and a visiting body cannot create a lineage-qualified practice', () => {
    const s = snapshot('wildhammer', { nativeId: 'unrelated_dwarves' });
    expect(s.facts.some(f => f.kind === 'practice')).toBe(false);
    s.facts.find(f => f.kind === 'pillar' && f.category === 'heritage')!.name = 'Wildhammer gryphon riders';
    expect(output(s).paragraph).not.toContain('gryphon');
});

test('removing every relevant adopted custom removes the practice rather than changing unrelated concepts', () => {
    const s = snapshot('wildhammer', { traditions: ['tradition_brewery'] });
    expect(s.facts.some(f => f.kind === 'practice')).toBe(false);
    expect(output(s).paragraph).not.toContain('gryphon');
});

test('adopting legalism does not erase Nerubian attribution and civic memory', () => {
    const seed = fixture.cultures.find((c: any) => c.key === 'nerubian');
    const s = snapshot('nerubian', { traditions: [...seed.traditions, 'tradition_legalistic'] });
    const clause = rules.rules.find((r: any) => r.id === 'retained_nerubian_civic_practice').text;
    expect(output(s).paragraph.split(clause)).toHaveLength(2);
    expect(bank.authored.resolvedConcepts('culture', s).find(r => r.key === 'tradition_legalistic')?.readingId)
        .toBe('nerubian_law_exact_agreement_survives_appetite');
});

test('hybrid practices combine once without throwing competing primary-interpretation errors', () => {
    const s = snapshot('wildhammer', { traditions: ['tradition_hunters', 'tradition_tribe_unity'], nativeId: 'hybrid_42',
        parents: ['wildhammer', 'frostwolf', 'moknathal'], heritage: 'heritage_orcish' });
    const text = output(s).paragraph;
    expect(text).toContain('gryphon');
    expect(bank.authored.resolvedConcepts('culture', s).find(r => r.key === 'tradition_hunters')?.readingId)
        .toBe('moknathal_frostwolf_hunting_two_inheritances_of_trust');
    expect(text.split(rules.rules.find((r: any) => r.id === 'wildhammer_gryphon_falconry').text)).toHaveLength(2);
});

test.each(['missing', 'duplicate', 'invalid_boolean', 'sparse_fact'])('a %s practice status cannot seal a partial or contradictory capture', fault => {
    const lines = frame('wildhammer'), index = lines.findIndex(l => l.includes('/;/practice/;/'));
    if (fault === 'missing') lines.splice(index, 1);
    if (fault === 'duplicate') lines.splice(index, 0, lines[index]);
    if (fault === 'invalid_boolean') lines[index] += 'bad';
    if (fault === 'sparse_fact') lines[index] = 'VOTC:CULTURE/;/fact/;/practice/;/' + practiceFacts[0].key;
    expect(capture(lines)).toBeUndefined();
});

test('stale contributors, forged proof and changed native source definitions do not inherit the practice', () => {
    const s = snapshot('wildhammer');
    const changed = structuredClone(s);
    changed.facts.find(f => f.kind === 'practice')!.description = 'An invented practice';
    expect(() => output(changed)).toThrow('Changed cultural practice evidence');
    const stale = structuredClone(s);
    stale.facts.find(f => f.key === 'tradition_hunters')!.description += ' Changed definition.';
    expect(() => practices.context(stale)).toThrow('lost its adopted contributor');
    const files = new Map(sourceFiles);
    const filename = [...files.keys()].find(k => k.includes('dwarven'))!;
    files.set(filename, files.get(filename)!.replace('wildhammer = {', 'wildhammer_redefined = {'));
    expect(practices.catalogueFacts(files, fixture.cultureFacts).some(f => f.key.startsWith('wildhammer_'))).toBe(false);
});

test('practice wording revisions affect only snapshots selecting that added meaning', () => {
    const assets = Object.fromEntries(['authored', 'essential', 'compositions', 'relationships', 'practices'].map(n => [n, read('public/backgroundConcepts/recipe/' + n + '.json')])) as any;
    const s = snapshot('wildhammer'), plain = snapshot('wildhammer', { nativeId: 'unrelated_dwarves' });
    const old = new BackgroundIngredientBank(assets);
    assets.practices.rules[0].rationale += ' Editorial update.';
    expect(new BackgroundIngredientBank(assets).revision('culture', s)).toBe(old.revision('culture', s));
    assets.practices.rules[0].text += ' Care remains shared.';
    const edited = new BackgroundIngredientBank(assets);
    expect(edited.revision('culture', s)).not.toBe(old.revision('culture', s));
    expect(edited.revision('culture', plain)).toBe(old.revision('culture', plain));
});

test.each([
    ['kaldorei_religion', 'tenet_moon_worship', 'elune_lunar_shelter'],
    ['orcish_shamanism', 'tenet_ancestor_worship', 'ancestral_duties_unfinished_by_death'],
    ...['amism', 'drakkism', 'farrism', 'gurubism', 'rushism', 'zandism'].map(k => [k, 'tenet_adorcism', 'loa_adorcism_favor_care_and_danger'])
])('exact current %s teaching refines %s without changing its source', (key, concept, reading) => {
    const s = fixture.faithSnapshots[key], original = JSON.stringify(s);
    expect(bank.authored.resolvedConcepts('faith', s).find(r => r.key === concept)?.readingId).toBe(reading);
    const view = bank.project('faith', s), plan = passagePlan('faith', view);
    expect(plan.passages.filter(p => p.required).some(p => p.text.includes(bank.essential.resolve('faith', s, bank.authored).find(r => r.key === concept)!.essentialText))).toBe(true);
    expect(JSON.stringify(s)).toBe(original);
});

test('other lunar faiths retain their own worship; renamed or converted labels do not grant Elune', () => {
    const s = structuredClone(fixture.faithSnapshots.moonweaver_religion);
    expect(bank.authored.resolvedConcepts('faith', s).find(r => r.key === 'tenet_moon_worship')?.readingId).toBeNull();
    s.facts.find((f: any) => f.key === 'faith' && f.kind === 'description').name = 'Kaldorei Elune faith';
    expect(bank.relationships.teachingContext(s)).not.toContain('affirmed_elune_teaching');
});

test('all ninety-three real source accounts still resolve; the placeholder stays held', () => {
    for (const [key, value] of Object.entries(fixture.faithSnapshots)) {
        if (key === 'wc_dummy') expect(() => bank.project('faith', value as any)).toThrow('source placeholder');
        else expect(() => bank.project('faith', value as any)).not.toThrow();
    }
});
