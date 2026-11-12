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

interface NativeState { id: string; parents: string[]; traditions: string[]; innovations: string[] }
// Finite interpreter for the emitted read-only native predicate. This is not CK3 acceptance.
function evaluate(entries: ScriptEntry[], state: NativeState): boolean {
    return entries.every(e => {
        if (e.key === 'OR' && Array.isArray(e.value)) return e.value.some(v => evaluate([v], state));
        if (e.key === 'any_parent_culture_or_above' && Array.isArray(e.value))
            return state.parents.some(id => evaluate(e.value as ScriptEntry[], { ...state, id, parents: [] }));
        if (e.key === 'this' && typeof e.value === 'string') return e.value === 'culture:' + state.id;
        if (e.key === 'has_cultural_tradition' && typeof e.value === 'string') return state.traditions.includes(e.value);
        if (e.key === 'has_innovation' && typeof e.value === 'string') return state.innovations.includes(e.value);
        throw new Error('Unexpected predicate primitive: ' + e.key);
    });
}
function frame(key: string, options: { traditions?: string[]; innovations?: string[]; parents?: string[]; nativeId?: string; heritage?: string } = {}) {
    const seed = fixture.cultures.find((c: any) => c.key === key);
    const traditions: string[] = options.traditions ?? seed.traditions;
    const innovations = options.innovations ?? [];
    const state: NativeState = { id: options.nativeId ?? key, parents: options.parents ?? [], traditions, innovations };
    const facts = [...basis.filter(f => f.kind !== 'pillar' || f.category !== 'heritage'),
        fixture.cultureFacts.find((f: CultureFact) => f.kind === 'pillar' && f.key === (options.heritage ?? seed.heritage)),
        ...traditions.map(k => fixture.cultureFacts.find((f: CultureFact) => f.kind === 'tradition' && f.key === k)),
        ...innovations.map(k => fixture.cultureFacts.find((f: CultureFact) => f.kind === 'innovation' && f.key === k))] as CultureFact[];
    const lines = [`VOTC:CULTURE/;/begin/;/2/;/${catalog.digest}/;/10/;/20/;/${traditions.length}/;/${innovations.length}`,
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

test('exact effective source definitions qualify thirty-three native practice/anchor facts', () => {
    expect(practiceFacts).toHaveLength(33);
    const script = cultureCaptureEffect(catalog);
    expect(() => parseCk3Script(script)).not.toThrow();
    for (const fact of practiceFacts) {
        expect(script).toContain('practice/;/' + fact.key + '/;/1');
        expect(script).toContain('practice/;/' + fact.key + '/;/0');
    }
    expect(script).toContain('any_parent_culture_or_above');
    expect(script).not.toMatch(/set_variable|set_flag|save_scope|add_cultural_tradition/);
});

test('Mantid Sacred Groves describes the kypari and amber that sustain communities', () => {
    const s = snapshot('mantid'), text = output(s).paragraph;
    expect(text).toContain('Woodland is valued as a living whole');
    expect(text).toContain('Kypari trees have sustained whole communities');
    expect(text).toContain('sap worked into amber for structures and preservation');
    expect(text).toContain('Tending their roots');
    expect(text).not.toMatch(/you are an amber|your kypari|you worship|you are a mantid/iu);
});

test('kypari care requires retained Mantid lineage and adopted Sacred Groves, including after hybridization', () => {
    const clause = rules.rules.find((r: any) => r.id === 'retained_mantid_kypari_care').text;
    const mixed = snapshot('mantid', { nativeId: 'mixed_mantid', parents: ['mantid'],
        heritage: 'heritage_orcish', traditions: ['tradition_sacred_groves'] });
    expect(output(mixed).paragraph.split(clause)).toHaveLength(2);
    expect(output(snapshot('mantid', { traditions: ['tradition_hard_working'] })).paragraph).not.toContain(clause);
    const unrelated = snapshot('nerubian', { traditions: ['tradition_sacred_groves'] });
    expect(output(unrelated).paragraph).not.toContain(clause);
    expect(output(unrelated).paragraph).toContain('Woodland is valued as a living whole');
    expect(output(snapshot('mantid', { nativeId: 'unrelated', traditions: ['tradition_sacred_groves'] })).paragraph).not.toContain(clause);
});

test('Lost One Hit and Run carries distinctive marsh scouting without supplying a present scene', () => {
    const s = snapshot('lost_one'), text = output(s).paragraph;
    expect(text).toContain('Marsh scouts attend to displaced reeds');
    expect(text).toContain('routes divided among guides');
    expect(practices.context(s)).not.toContain('retained_lost_one_craft_memory');
    expect(text).not.toMatch(/you are a scout|your refuge|you were captured/iu);
});

test('Lost One craft memory follows actual adoption, survives a hybrid, and combines inherited craft with diaspora once', () => {
    const artisan = snapshot('lost_one', { traditions: ['tradition_artisans'] });
    expect(bank.authored.resolvedConcepts('culture', artisan).find(r => r.key === 'tradition_artisans')?.readingId)
        .toBe('lost_one_artisans_remembered_skill_new_materials');
    expect(output(artisan).paragraph).not.toContain('Old techniques can be taught');
    const combined = snapshot('lost_one', { traditions: ['tradition_artisans', 'tradition_diasporic'] });
    const text = output(combined).paragraph;
    expect(text.split('A valued homeland’s loss')).toHaveLength(2);
    expect(text).toContain('Family craft adapts old methods');
    expect(text).toContain('younger makers');
    expect(text).not.toContain('Old techniques can be taught');
    const mixed = snapshot('lost_one', { nativeId: 'mixed_lost', parents: ['lost_one'], heritage: 'heritage_orcish', traditions: ['tradition_artisans'] });
    expect(output(mixed).paragraph).toContain('Old techniques can be taught');
    expect(output(snapshot('lost_one', { nativeId: 'unrelated', traditions: ['tradition_artisans'] })).paragraph).not.toContain('Old techniques can be taught');
});

test('Blue stewardship values mistakes and independent inquiry under its current customs', () => {
    const s = snapshot('blue_dragon'), text = output(s).paragraph;
    expect(s.facts.some(f => f.key === 'tradition_scholar_officials')).toBe(false);
    expect(text).toContain('Careful inquiry preserves mistakes as well as successes');
    expect(text).toContain('Independent questions deserve a hearing');
    expect(text).not.toMatch(/must worship|personal magic|is a dragon/iu);
});

test('Blue stewardship follows retained lineage and does not duplicate the complete scholar reading', () => {
    const clause = rules.rules.find((r: any) => r.id === 'retained_blue_stewardship_practice').text;
    const mixed = snapshot('blue_dragon', { nativeId: 'mixed_blue', parents: ['blue_dragon'], heritage: 'heritage_orcish', traditions: ['tradition_philosopher_culture'] });
    expect(output(mixed).paragraph.split(clause)).toHaveLength(2);
    expect(output(snapshot('blue_dragon', { nativeId: 'unrelated', traditions: ['tradition_philosopher_culture'] })).paragraph).not.toContain(clause);
    expect(output(snapshot('blue_dragon', { traditions: ['tradition_legalistic'] })).paragraph).not.toContain(clause);
    const scholar = snapshot('blue_dragon', { traditions: ['tradition_scholar_officials', 'tradition_philosopher_culture'] });
    expect(bank.authored.resolvedConcepts('culture', scholar).find(r => r.key === 'tradition_scholar_officials')?.readingId)
        .toBe('blue_stewardship_scholars_record_the_failed_attempt');
    expect(output(scholar).paragraph).not.toContain(clause);
    expect(output(scholar).paragraph).toContain('records failures for future learners');
});

test('Centaur Horse Lords gives collective mobility its local meaning while retaining horse handling', () => {
    const s = snapshot('centaur'), text = output(s).paragraph;
    expect(bank.authored.resolvedConcepts('culture', s).find(r => r.key === 'tradition_horse_lords')?.readingId)
        .toBe('centaur_mobile_warfare_and_horsecraft');
    expect(text).toContain('Centaur tribes prize swift movement in war');
    expect(text).toContain('Care of legs and hooves');
    expect(text).toContain('Horse handling is also esteemed');
    expect(text).toContain("neither a person's body nor a present mount or personal skill");
});

test('Centaur mobility follows an adopted custom and retained lineage, never a name or body', () => {
    const mixed = snapshot('centaur', { nativeId: 'mixed_centaur', parents: ['centaur'], heritage: 'heritage_orcish', traditions: ['tradition_horse_lords'] });
    expect(output(mixed).paragraph).toContain('Centaur tribes prize swift movement in war');
    expect(output(snapshot('centaur', { traditions: ['tradition_warrior_culture'] })).paragraph).not.toContain('Care of legs and hooves');
    const unrelated = output(snapshot('centaur', { nativeId: 'unrelated', traditions: ['tradition_horse_lords'] })).paragraph;
    expect(unrelated).toContain('Horse riding and mounted warfare');
    expect(unrelated).not.toContain('Centaur tribes');
});

test('Warsong martial tradition retains wolf-rider partnership without inventing wolf breeding', () => {
    const s = snapshot('warsong'), text = output(s).paragraph;
    expect(text).toContain('Warsong wolf riders are remembered for swift strikes and withdrawals');
    expect(text).toContain('A wolf is a partner');
    expect(text).toContain('Patient horse breeding');
    expect(text).not.toMatch(/breed(?:ing)? (?:war ?)?wolves|wolves? (?:are|were) bred/iu);
});

test('a mixed Frostwolf and Warsong culture retains both household care and distinctive wolf-rider tactics once', () => {
    const s = snapshot('warsong', { nativeId: 'mixed_wolves', parents: ['warsong', 'frostwolf'],
        traditions: ['tradition_warrior_culture', 'tradition_pastoralists'] });
    const text = output(s).paragraph;
    expect(text.split('Wolf tending belongs to the household')).toHaveLength(2);
    expect(text.split('Warsong wolf riders are remembered')).toHaveLength(2);
    expect(output(snapshot('warsong', { traditions: ['tradition_pastoralists'] })).paragraph).not.toContain('Warsong wolf riders');
    expect(output(snapshot('warsong', { nativeId: 'unrelated', traditions: ['tradition_warrior_culture'] })).paragraph).not.toContain('Warsong wolf riders');
});

test('Harpy Warrior Queens carries nest standing without requiring a different inheritance tradition', () => {
    const s = snapshot('harpy'), text = output(s).paragraph;
    expect(s.facts.some(f => f.key === 'tradition_female_only_inheritance')).toBe(false);
    expect(text).toContain("a matriarch's share of food and ornaments");
    expect(text).toContain("a rival's display");
    expect(text).not.toMatch(/personal wings|has a captive|must fly/iu);
});

test('Harpy nest standing follows retained lineage and an adopted authority custom', () => {
    const clause = rules.rules.find((r: any) => r.id === 'retained_harpy_nest_standing').text;
    const mixed = snapshot('harpy', { nativeId: 'mixed_harpy', parents: ['harpy'], heritage: 'heritage_orcish', traditions: ['tradition_nubian_warrior_queens'] });
    expect(output(mixed).paragraph.split(clause)).toHaveLength(2);
    expect(output(snapshot('harpy', { nativeId: 'unrelated', traditions: ['tradition_nubian_warrior_queens'] })).paragraph).not.toContain(clause);
    expect(output(snapshot('harpy', { traditions: ['tradition_hunters'] })).paragraph).not.toContain(clause);
});

test('a full nest reading prevents repetition while a partial appearance reading retains the missing nest detail', () => {
    const clause = rules.rules.find((r: any) => r.id === 'retained_harpy_nest_standing').text;
    const full = snapshot('harpy', { traditions: ['tradition_female_only_inheritance', 'tradition_nubian_warrior_queens'] });
    expect(output(full).paragraph).not.toContain(clause);
    expect(output(full).paragraph).toContain('spoils, ornaments and boasts');
    const partial = snapshot('harpy', { traditions: ['tradition_female_only_inheritance', 'tradition_nubian_warrior_queens', 'tradition_lookism'] });
    expect(output(partial).paragraph.split(clause)).toHaveLength(2);
    expect(output(partial).paragraph).toContain('Appearance overrides status');
});

test.each(['draenei', 'lightforged_draenei', 'broken'])('%s great-beast tradition communicates elekk husbandry once', key => {
    const s = snapshot(key), text = output(s).paragraph;
    expect(bank.authored.resolvedConcepts('culture', s).find(r => r.key === 'tradition_lords_of_the_elephant')?.readingId)
        .toBe('argussian_elekk_patient_husbandry');
    expect(text.split('Mighty elekk carry the royal prestige')).toHaveLength(2);
    expect(text).not.toContain('Elephants carry royal prestige');
    expect(text).not.toMatch(/Exodar|O'ros|lifelong bond/);
});

test('elekk husbandry follows retained native lineage and actual adoption through changed hybrid heritage', () => {
    const s = snapshot('draenei', { nativeId: 'mixed_20', parents: ['draenei'], heritage: 'heritage_orcish' });
    expect(output(s).paragraph).toContain('Mighty elekk');
    expect(output(snapshot('draenei', { traditions: ['tradition_philosopher_culture'] })).paragraph).not.toContain('elekk');
    const unrelated = output(snapshot('draenei', { nativeId: 'unrelated', traditions: ['tradition_lords_of_the_elephant'] })).paragraph;
    expect(unrelated).toContain('Elephants carry royal prestige');
    expect(unrelated).not.toContain('elekk');
});

test('Jinyu watercraft requires discovered Watersmithing alongside an adopted craft', () => {
    expect(output(snapshot('jinyu')).paragraph).not.toContain('water-shaped');
    const s = snapshot('jinyu', { innovations: ['innovation_watersmithing'] });
    const selected = bank.authored.resolvedConcepts('culture', s);
    expect(selected.find(r => r.key === 'tradition_sorcerous_metallurgy')?.readingId)
        .toBe('jinyu_sorcerous_metallurgy_the_discipline_of_moving_water');
    const text = output(s).paragraph;
    expect(text).toContain('shapes rock and stone');
    expect(text).toContain('steel-hard arms');
    expect(text).not.toMatch(/shapes metal|shape metal|creates gold/);
    expect(s.facts.some(f => f.kind === 'practice' && f.key.startsWith('retained_jinyu'))).toBe(true);
    const noCustom = snapshot('jinyu', { traditions: ['tradition_loyal_soldiers'], innovations: ['innovation_watersmithing'] });
    expect(practices.context(noCustom)).not.toContain('retained_jinyu_water_forging_practice');
});

test('two Jinyu crafts retain their distinct meanings with watercraft combined once', () => {
    const s = snapshot('jinyu', { traditions: ['tradition_sorcerous_metallurgy', 'tradition_metal_craftsmanship'], innovations: ['innovation_watersmithing'] });
    const text = output(s).paragraph;
    expect(text.split('Discovered Watersmithing adds')).toHaveLength(2);
    expect(text).toContain('Generations of ironworking');
    expect(text).toContain('attempts to turn metal to gold');
    expect(text).toContain('Stone is not thereby metal');
    expect(text).not.toContain('Water-shaped stonework prizes');
});

test('Ankoan and renamed hybrid descendants can retain discovered watercraft without a body or current faith condition', () => {
    const a = snapshot('ankoan', { traditions: ['tradition_artisans'], innovations: ['innovation_watersmithing'] });
    const b = snapshot('jinyu', { traditions: ['tradition_artisans', 'tradition_metal_craftsmanship'], innovations: ['innovation_watersmithing'],
        nativeId: 'mixed_21', parents: ['jinyu'], heritage: 'heritage_orcish' });
    for (const s of [a, b]) expect(output(s).paragraph.split('Water-shaped stonework prizes')).toHaveLength(2);
});

test('changed or missing innovation evidence cannot preserve a captured watercraft interpretation', () => {
    const s = snapshot('jinyu', { innovations: ['innovation_watersmithing'] });
    for (const mode of ['missing', 'changed']) {
        const changed = structuredClone(s);
        if (mode === 'missing') changed.facts = changed.facts.filter(f => f.key !== 'innovation_watersmithing');
        else changed.facts.find(f => f.key === 'innovation_watersmithing')!.description += ' Revised.';
        expect(() => practices.context(changed)).toThrow('lost its discovered capability');
    }
    const revised = fixture.cultureFacts.map((f: CultureFact) => f.key === 'innovation_watersmithing' ? { ...f, description: f.description + ' Revised.' } : f);
    expect(practices.catalogueFacts(sourceFiles, revised).filter(f => f.key.startsWith('retained_jinyu'))).toHaveLength(0);
});

test('a combined RP reference keeps strong customs once without character probabilities or UI bonuses', () => {
    const s = snapshot('wildhammer', { nativeId: 'unrelated_50', heritage: 'heritage_orcish', traditions: [
        'tradition_storytellers', 'tradition_welcoming', 'tradition_culinary_art', 'tradition_festivities',
        'tradition_lookism', 'tradition_isolationist'
    ] });
    const text = output(s).paragraph;
    expect(text.split('Social etiquette is valued above all else')).toHaveLength(2);
    expect(text).toContain('Appearance is the overriding status measure');
    expect(text).toMatch(/heroes/iu);
    expect(text).toContain('legends');
    expect(text).toContain('personal memory');
    expect(text).toContain('Marriage across cultures meets reluctance');
    expect(text).not.toMatch(/Charming|county approval|Food Tasters|listed impairments|reduced secrecy|Guardians aid|schemes gain effectiveness|recur sooner/);
});

test.each([
    ['august_celestials', 'tenet_inner_journey', 'chi_inner_journey_feeling_and_attention'],
    ['forgotten_shadow', 'tenet_monasticism', 'forgotten_shadow_monasticism_will_without_luxury'],
    ['mystery_of_the_makers', 'tenet_progressivism', 'titan_progress_the_makers_work_meets_new_lives']
])('reviewed current %s teaching selects its adopted %s reading', (key, concept, reading) => {
    const s = fixture.faithSnapshots[key], before = JSON.stringify(s);
    expect(bank.authored.resolvedConcepts('faith', s).find(r => r.key === concept)?.readingId).toBe(reading);
    const text = renderExtraction('faith', bank.project('faith', s), { selections: [] }).paragraph;
    expect(text).not.toMatch(/affirmed_|accountHash/);
    expect(JSON.stringify(s)).toBe(before);
});

test.each([
    ['frghlaith', 'tenet_adaptive', 'deep_mother_adaptation_enduring_water'],
    ['ragnarism', 'tenet_communion', 'firelord_communion_awe_and_participation']
])('%s future interpretation still requires actual %s adoption', (key, concept, reading) => {
    const s = fixture.faithSnapshots[key];
    expect(bank.authored.resolvedConcepts('faith', s).some(r => r.readingId === reading)).toBe(false);
    const reformed = structuredClone(s);
    const donor = Object.values(fixture.faithSnapshots).flatMap((s: any) => s.facts).find((f: any) => f.key === concept) as any;
    expect(donor).toBeDefined();
    const index = reformed.facts.findIndex((f: any) => f.key.startsWith('tenet_'));
    reformed.facts.splice(index, 1, donor);
    expect(bank.authored.resolvedConcepts('faith', reformed).find(r => r.key === concept)?.readingId).toBe(reading);
});

test.each([
    ['agamaggan_worship', 'tenet_sacrificial_ceremonies', 'agamaggan_sacrifice_cost_of_protection', 'affirmed_agamaggan_teaching'],
    ['malygosism', 'tenet_pursuit_of_knowledge', 'blue_knowledge_hierarchy_must_hear_the_new_question', 'affirmed_blue_stewardship_teaching'],
    ['nozdormism', 'tenet_struggle_submission', 'bronze_submission_vigilance_beyond_the_easy_command', 'affirmed_temporal_charge_teaching'],
    ['alexstraszism', 'tenet_preservation', 'red_life_preservation_protection_must_allow_a_future', 'affirmed_red_life_charge_teaching'],
    ['yserism', 'tenet_inner_journey', 'dream_inner_journey_the_waking_neighbor_still_matters', 'affirmed_emerald_dream_teaching']
])('%s teaching refines a later %s adoption without altering its present profile', (key, concept, reading, tag) => {
    const original = fixture.faithSnapshots[key], assets = Object.fromEntries(['authored', 'essential', 'compositions', 'relationships', 'practices']
        .map(n => [n, read('public/backgroundConcepts/recipe/' + n + '.json')])) as any;
    for (const account of assets.relationships.accounts) if (account.teachingContext?.includes(tag))
        account.teachingContext = account.teachingContext.filter((v: string) => v !== tag);
    const before = new BackgroundIngredientBank(assets);
    expect(bank.authored.resolvedConcepts('faith', original).some(r => r.readingId === reading)).toBe(false);
    expect(bank.revision('faith', original)).toBe(before.revision('faith', original));
    const reformed = structuredClone(original), doctrine = fixture.additionalFaithFacts.find((f: any) => f.key === concept);
    const index = reformed.facts.findIndex((f: any) => f.kind === 'doctrine' && f.key.startsWith('tenet_'));
    expect(index).toBeGreaterThanOrEqual(0);
    reformed.facts.splice(index, 1, doctrine);
    expect(bank.authored.resolvedConcepts('faith', reformed).find(r => r.key === concept)?.readingId).toBe(reading);
    const changedAccount = structuredClone(reformed);
    changedAccount.facts.find((f: any) => f.kind === 'description' && f.key === 'faith').description += ' Unreviewed change.';
    expect(bank.authored.resolvedConcepts('faith', changedAccount).find(r => r.key === concept)?.readingId).not.toBe(reading);
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
    expect(output(s).paragraph).toContain('Hunting parties share good meat with nesting gryphons');
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

test('a hybrid adopting Falconry inherits the Wildhammer gryphon philosophy from its parent', () => {
    const s = snapshot('wildhammer', { nativeId: 'hybrid_falconer', parents: ['wildhammer'],
        heritage: 'heritage_orcish', traditions: ['tradition_ep2_avid_falconers'] });
    const reading = bank.authored.resolvedConcepts('culture', s).find(r => r.key === 'tradition_ep2_avid_falconers');
    const text = output(s).paragraph;
    expect(reading?.readingId).toBe('falconry_wildhammer_gryphon');
    expect(text).toContain('raising, caring for and riding gryphons');
    expect(text).toContain('horse-flesh appetite');
    expect(text).not.toMatch(/you own a gryphon|you are a dwarf/iu);
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
