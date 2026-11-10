import fs from 'fs';
import { LanguageRelations } from '../../src/main/language/languageRelations';
import { FamiliarityPredicate, familiarityPredicateBody, validateFamiliarityPredicate } from '../../src/main/language/familiarityRules';
import { parseCk3Script, ScriptEntry } from '../../src/main/culture/ck3Script';
import { languageCaptureCatalog, languageCaptureBody, LanguageLogReader } from '../../src/main/language/languageCapture';
import { catalog, fact } from '../culture/fixtures';
import { character } from '../culture/fixtures';
import { GameData } from '../../src/shared/gameData/GameData';
import { LanguageConversation } from '../../src/main/language/languageConversation';
import { loadLanguageEngine } from '../../src/main/language/languageEngine';
import { selectSpokenLanguage } from '../../src/main/language/languageRouting';
import { speakingLanguageInstruction } from '../../src/main/language/conversationView';

const data = JSON.parse(fs.readFileSync('public/languages/routing.json', 'utf8'));
const relations = new LanguageRelations(data);
interface Faith { id: string; doctrines: string[]; head?: Faith }
interface Culture { id: string; parents: string[]; traditions: string[] }
interface State { faith: Faith; culture: Culture; traits: string[]; assigned: Record<string, number>; spells: string[]; spirit: string[]; secrets: string[] }
const state = (culture = 'gnome', faith = 'rationalism'): State => ({ faith: { id: faith, doctrines: [] },
    culture: { id: culture, parents: [], traditions: [] }, traits: [], assigned: {}, spells: [], spirit: [], secrets: [] });

/** Independent fixture interpreter for the emitted CK3 conditions, not the authored JSON AST. */
function nativeLimit(entries: ScriptEntry[], current: State | Culture | Faith, actor: State): boolean {
    return entries.every(entry => {
        const body = Array.isArray(entry.value) ? entry.value : undefined;
        const scalar = typeof entry.value === 'string' ? entry.value : '';
        if (entry.key === 'always') return scalar === 'yes';
        if (entry.key === 'OR') return body!.some(child => nativeLimit([child], current, actor));
        if (entry.key === 'AND') return nativeLimit(body!, current, actor);
        if (entry.key === 'NOT') return !nativeLimit(body!, current, actor);
        if (entry.key === 'culture') return nativeLimit(body!, actor.culture, actor);
        if (entry.key === 'faith') return nativeLimit(body!, actor.faith, actor);
        if (entry.key === 'religious_head.faith') return !!actor.faith.head && nativeLimit(body!, actor.faith.head, actor);
        if (entry.key === 'exists') { expect(scalar).toBe('religious_head'); return !!actor.faith.head; }
        if (entry.key === 'this') return (current as Culture | Faith).id === scalar.split(':')[1];
        if (entry.key === 'has_trait') return actor.traits.includes(scalar);
        if (entry.key === 'has_doctrine') return (current as Faith).doctrines.includes(scalar);
        if (entry.key === 'has_cultural_tradition') return (current as Culture).traditions.includes(scalar);
        if (entry.key === 'is_culture_or_parent_culture_trigger') {
            const id = body!.find(field => field.key === 'CULTURE')!.value as string;
            return actor.culture.id === id.split(':')[1] || actor.culture.parents.includes(id.split(':')[1]);
        }
        if (entry.key === 'is_known_spell_trigger') {
            const spell = body!.find(field => field.key === 'SPELL')!.value as string;
            return actor.spells.includes(spell.split(':')[1]);
        }
        if (entry.key === 'wc_ELEMENT_favour_TENSE_disposition_is_spirit_trigger') {
            expect(body!.find(field => field.key === 'TENSE')!.value).toBe('current');
            return actor.spirit.includes(body!.find(field => field.key === 'ELEMENT')!.value as string);
        }
        if (entry.key?.endsWith('_magic_lifestyle_perks')) {
            expect(entry.operator).toBe('>'); expect(scalar).toBe('0');
            return (actor.assigned[entry.key.slice(0, -'_magic_lifestyle_perks'.length)] ?? 0) > 0;
        }
        throw new Error('Unsupported fixture native condition: ' + entry.key);
    });
}
function matches(predicate: FamiliarityPredicate, current: State): boolean {
    return nativeLimit(parseCk3Script(familiarityPredicateBody(predicate)), current, current);
}
function knowledge(current: State) {
    return { currentCultureId: current.culture.id, parentCultureIds: current.culture.parents,
        practiceFamiliarity: { version: 1 as const, complete: true as const, routingVersion: relations.version,
            matchedRuleIds: relations.practiceRules.filter(rule => matches(rule.predicate, current)).map(rule => rule.id) } };
}
const mode = (tongue: string, current: State, known = ['language_gnomish']) =>
    relations.route('language_' + tongue, known, knowledge(current)).mode;

test('Candlism converts gain community familiarity and lose only that current-practice route', () => {
    const current = state('gnome', 'cult_of_the_candle');
    expect(mode('low_common', current)).toBe('CLOSE');
    expect(mode('gutterspeak', current)).toBe('FAR');
    expect(mode('common', current)).toBe('CLOSE');
    current.faith.id = 'rationalism';
    expect(mode('low_common', current)).toBe('FAR');
    expect(mode('common', current)).toBe('CLOSE');
    expect(mode('low_common', current, ['language_gnomish', 'language_common'])).toBe('CLOSE');
    expect(mode('low_common', current, ['language_gnomish', 'language_low_common'])).toBe('CLEAR');
});

test('conversion preserves independent cultural and actual learned Shathyar knowledge', () => {
    const ordinary = state('gnome', 'cthunism'), cultural = state('twilights_hammer', 'cthunism');
    expect(mode('shathyar', ordinary)).toBe('CLOSE'); expect(mode('shathyar', cultural)).toBe('CLOSE');
    ordinary.faith.id = cultural.faith.id = 'holy_light';
    expect(mode('shathyar', ordinary)).toBe('FAR'); expect(mode('shathyar', cultural)).toBe('CLOSE');
    expect(mode('shathyar', ordinary, ['language_gnomish', 'language_shathyar'])).toBe('CLEAR');
});

test('ritual/community banks are direct, preserve explicit unions, and do not supply family anchors', () => {
    expect(mode('ravenspeech', state('gnome', 'anzuism'))).toBe('CLOSE');
    expect(mode('apexis', state('gnome', 'anzuism'))).toBe('FAR');
    const suntouched = state('gnome', 'suntouched');
    expect(mode('titanic', suntouched)).toBe('CLOSE'); expect(mode('tolvir', suntouched)).toBe('CLOSE');
    expect(mode('giant', suntouched)).toBe('FAR');
    const azshara = state('gnome', 'azshara_worship');
    expect(mode('nazja', azshara)).toBe('CLOSE'); expect(mode('shathyar', azshara)).toBe('CLOSE');
    expect(mode('darnassian', azshara)).toBe('FAR');
    expect(mode('draenei', state('gnome', 'burning_legion_religion'))).toBe('FAR');
});

test('Rite uses one current shared institution bank, not the head’s personal languages or recursive Rite links', () => {
    const current = state('gnome', 'custom_rite'); current.faith.doctrines = ['tenet_rite'];
    expect(mode('low_common', current)).toBe('FAR');
    current.faith.head = { id: 'cult_of_the_candle', doctrines: [] };
    expect(mode('low_common', current)).toBe('CLOSE'); expect(mode('gutterspeak', current)).toBe('FAR');
    current.faith.head = { id: 'custom_middle', doctrines: ['tenet_rite'], head: { id: 'cult_of_the_candle', doctrines: [] } };
    expect(mode('low_common', current)).toBe('FAR');
    current.faith.head = { id: 'suntouched', doctrines: [] };
    expect(mode('titanic', current)).toBe('CLOSE'); expect(mode('tolvir', current)).toBe('CLOSE');
    current.faith.doctrines = []; expect(mode('tolvir', current)).toBe('FAR');
});

// Independent accepted-document expectations, including overlapping ritual/community banks.
const acceptedFaithBanks: [string, string][] = [
    ['kaldorei_religion', 'elunic'],
    ['twilights_hammer_cult cthunism yoggsaronism nzothism yshaarjism ghuunism xavist', 'shathyar'],
    ['azshara_worship', 'nazja shathyar'],
    ['burning_legion_religion orcish_fel vindicatory black_harvest', 'eredun'],
    ['death_god ebon', 'cursed'], ['ragnarism ordonism', 'ignan'], ['neptulism', 'aquan'], ['al_akirism', 'auran'],
    ['therazanism theradrasism', 'terran'], ['mystery_of_the_makers', 'titanic'], ['suntouched', 'titanic tolvir'],
    ['zandism gurubism drakkism amism farrism rushism cult_of_hakkar', 'zandali'],
    ['holy_light scarletism argent kirin_torian', 'common'], ['velenism lightbound', 'draenei'],
    ['cult_of_sethraliss faithless', 'sethrak'], ['cult_of_ariwo', 'vulpera'], ['cult_of_torga', 'tortollan'],
    ['cult_of_the_candle', 'low_common'], ['wildhammer_shamanism khazic', 'dwarven'],
    ['earth_mother_worship taunka_religion', 'taurahe'], ['tuskarr_religion', 'tuskarr'], ['drogbar_religion', 'drogbar'],
    ['spider_philosophy moonweaver_religion', 'nerubian'], ['monkey_king_worship', 'hozen'],
    ['anzuism setheism rukhmarism', 'ravenspeech'], ['august_celestials waterspeaker saurok_religion thunder_king', 'mogu'],
    ['cult_of_sunwell', 'thalassian'], ['cult_of_nightwell', 'shalassian'], ['arcane_religion', 'darnassian high_darnassian'],
    ['ursine', 'furbolg'], ['agamaggan_worship', 'quilboar'], ['gorgog_worship', 'ogre'], ['glowbound', 'gnomish'],
    ['odyn helya', 'vrykul'], ['throsic', 'drust'], ['gorloc_oracle', 'nerglish']
];
test.each(acceptedFaithBanks)('complete direct and one-hop Rite bank for %s contains exactly %s', (faiths, tongues) => {
    const expected = tongues.split(' ').map(tongue => 'language_' + tongue).sort();
    for (const faith of faiths.split(' ')) {
        const direct = state('unaffiliated_fixture', faith);
        const rite = state('unaffiliated_fixture', 'custom_rite');
        rite.faith.doctrines = ['tenet_rite']; rite.faith.head = { id: faith, doctrines: [] };
        for (const listener of [direct, rite]) {
            const facts = knowledge(listener);
            const recognized = relations.languageIds().filter(id =>
                relations.route(id, ['language_orcish'], facts).mode === 'CLOSE').sort();
            expect(recognized).toEqual(expected);
        }
    }
});

test('syncretism requires the exact current Idolised instruction combinations', () => {
    const fel = state('gnome', 'custom_faith');
    fel.faith.doctrines = ['tenet_disorder_syncretism', 'doctrine_disorder_magic_accepted'];
    expect(mode('eredun', fel)).toBe('FAR');
    fel.faith.doctrines[1] = 'doctrine_disorder_magic_approved'; expect(mode('eredun', fel)).toBe('CLOSE');
    expect(mode('draenei', fel)).toBe('FAR');
    const elemental = state('gnome', 'custom_faith');
    elemental.faith.doctrines = ['fire', 'water', 'air', 'earth'].map(branch => `doctrine_elemental_${branch}_spirit_magic_approved`);
    expect(mode('kalimag', elemental)).toBe('FAR'); expect(mode('ignan', elemental)).toBe('FAR');
    elemental.faith.doctrines.push('tenet_elemental_syncretism');
    for (const tongue of ['ignan', 'aquan', 'auran', 'terran', 'kalimag']) expect(mode(tongue, elemental)).toBe('CLOSE');
    elemental.faith.doctrines = elemental.faith.doctrines.filter(id => !id.includes('_fire_'));
    expect(mode('ignan', elemental)).toBe('FAR'); expect(mode('kalimag', elemental)).toBe('FAR');
    for (const tongue of ['aquan', 'auran', 'terran']) expect(mode(tongue, elemental)).toBe('CLOSE');
});

test.each([1, 2, 3, 4, 5])('Warlock rank %i grants partial Eredun without fluent production', rank => {
    const current = state(); current.traits = [`user_of_disorder_magic_${rank}`];
    expect(mode('eredun', current)).toBe('CLOSE'); expect(mode('draenei', current)).toBe('FAR');
    expect(mode('eredun', current, ['language_gnomish', 'language_eredun'])).toBe('CLEAR');
});

test('actual hidden training qualifies while secret flags, affinity and unrelated schools do not', () => {
    const current = state(); current.secrets = ['secret_disorder_magic_user']; current.traits = ['wc_lifestyle_disorder_magic'];
    expect(mode('eredun', current)).toBe('FAR');
    current.assigned.disorder = 1; expect(mode('eredun', current)).toBe('CLOSE');
    expect(knowledge(current).practiceFamiliarity.matchedRuleIds).toContain('CT01');
    current.assigned = { order: 18 }; expect(mode('eredun', current)).toBe('FAR');
    current.assigned = { shadow: 1 }; expect(mode('shathyar', current)).toBe('CLOSE');
});

test.each(['', '_spirit', '_decay'])('all Fire training subtypes retain the branch grant: %s', subtype => {
    for (const rank of [1, 2, 3, 4, 5]) {
        const current = state(); current.traits = [`user_of_elemental_fire${subtype}_magic_${rank}`];
        expect(mode('ignan', current)).toBe('CLOSE'); expect(mode('aquan', current)).toBe('FAR');
        expect(mode('kalimag', current)).toBe(subtype === '_spirit' ? 'CLOSE' : 'FAR');
    }
});

test('hidden Spirit disposition needs actual branch training, and the four-branch union is deliberate', () => {
    const current = state(); current.spirit = ['elemental_fire'];
    expect(mode('kalimag', current)).toBe('FAR');
    current.assigned.elemental_fire = 1; expect(mode('ignan', current)).toBe('CLOSE'); expect(mode('kalimag', current)).toBe('CLOSE');
    current.spirit = []; expect(mode('kalimag', current)).toBe('FAR');
    current.assigned = { elemental_fire: 1, elemental_water: 1, elemental_air: 1, elemental_earth: 1 };
    for (const tongue of ['ignan', 'aquan', 'auran', 'terran', 'kalimag']) expect(mode(tongue, current)).toBe('CLOSE');
});

test('actually known spells work independently of class, summon presence and mana; Spell Hack alone does not', () => {
    const mage = state(); mage.traits = ['user_of_order_magic_5']; mage.spells = ['spell_hack'];
    expect(mode('eredun', mage)).toBe('FAR');
    mage.spells.push('summon_demon'); expect(mode('eredun', mage)).toBe('CLOSE'); expect(mode('draenei', mage)).toBe('FAR');
    mage.spells = ['summon_water_elemental'];
    expect(mode('aquan', mage)).toBe('CLOSE'); expect(mode('kalimag', mage)).toBe('CLOSE'); expect(mode('auran', mage)).toBe('FAR');
    mage.spells = ['summon_air_elemental']; expect(mode('auran', mage)).toBe('FAR');
});

test('broad death magic, body state, fractional ancestry and markings grant no unsupported language', () => {
    const current = state(); current.assigned.death = 18;
    current.traits = ['user_of_death_magic_5', 'being_undead', 'being_demon', 'being_void', 'blood_green_dragon', 'scarlet_mark', 'wc_druid_of_the_fang'];
    current.spells = ['raise_dead', 'supreme_raise_dead'];
    for (const tongue of ['cursed', 'eredun', 'shathyar', 'darnassian']) expect(mode(tongue, current)).toBe('FAR');
    current.traits.push('creature_lich'); expect(mode('cursed', current)).toBe('CLOSE');
    current.traits.push('creature_green_dragon'); expect(mode('darnassian', current)).toBe('CLOSE');
    expect(mode('draconic', state('night_elf'), ['language_darnassian'])).toBe('FAR');
});

test('unavailable imported Champion selector stays dormant while the actual Lich King route still works', () => {
    const rule = relations.practiceRules.find(row => row.id === 'CT11')!;
    const body = familiarityPredicateBody(rule.predicate, new Set(['lich_king']));
    expect(body).not.toContain('champion_of_the_scourge'); expect(body).toContain('has_trait = lich_king');
    const current = state(); current.traits = ['champion_of_the_scourge'];
    expect(nativeLimit(parseCk3Script(body), current, current)).toBe(false);
    current.traits = ['lich_king']; expect(nativeLimit(parseCk3Script(body), current, current)).toBe(true);
});

test('contact traditions require their own current community bank and do not veto independent culture grants', () => {
    const unknown = state('synthetic_merchant'); unknown.culture.traditions = ['tradition_caravaneers', 'tradition_maritime_mercantilism', 'tradition_practiced_pirates'];
    for (const tongue of ['goblin', 'zandali', 'sethrak', 'hozen']) expect(mode(tongue, unknown)).toBe('FAR');
    const vulpera = state('vulpera'); expect(mode('sethrak', vulpera, ['language_vulpera'])).toBe('CLOSE');
    expect(knowledge(vulpera).practiceFamiliarity.matchedRuleIds).not.toContain('TT04_vulpera');
    vulpera.culture.traditions = ['tradition_caravaneers']; expect(knowledge(vulpera).practiceFamiliarity.matchedRuleIds).toContain('TT04_vulpera');
    const excluded = state('wastewander'); excluded.culture.parents = ['pirate_culture']; excluded.culture.traditions = ['tradition_practiced_pirates'];
    expect(mode('goblin', excluded, ['language_common'])).toBe('FAR');
});

test('exact culture decisions override descendant defaults', () => {
    const descendant = state('synthetic_child'); descendant.culture.parents = ['mogu', 'green_dragon', 'faldorei'];
    for (const tongue of ['zandali', 'darnassian', 'shalassian']) expect(mode(tongue, descendant, ['language_cursed'])).toBe('FAR');
});

test('complete current practice frames are mandatory, private, and stamped separately from fluent knowledge', () => {
    const inventory = languageCaptureCatalog({ ...catalog(), facts: relations.languageIds().map(id => fact('pillar', id, 'language')) }, relations)!;
    expect(() => parseCk3Script(languageCaptureBody(inventory))).not.toThrow();
    const frame = [`VOTC:LANGUAGE/;/begin/;/1/;/${inventory.digest}`, 'VOTC:LANGUAGE/;/native/;/language_gnomish',
        'VOTC:LANGUAGE/;/learning/;/1',
        ...inventory.languageIds.map(id => `VOTC:LANGUAGE/;/known/;/${id}/;/${Number(id === 'language_gnomish')}`),
        ...relations.cultureRules.map(rule => `VOTC:LANGUAGE/;/contact/;/${rule.id}/;/0`),
        ...relations.practiceRules.map(rule => `VOTC:LANGUAGE/;/practice/;/${rule.id}/;/${Number(rule.id === 'CT01')}`), 'VOTC:LANGUAGE/;/study_complete', 'VOTC:LANGUAGE/;/end'];
    const reader = new LanguageLogReader(inventory); frame.forEach(line => reader.observe(line));
    expect(reader.snapshot(1)?.knownLanguageIds).toEqual(['language_gnomish']);
    expect(reader.snapshot(1)?.practiceFamiliarity?.matchedRuleIds).toEqual(['CT01']);
    for (const defect of ['missing', 'duplicate', 'foreign', 'stale']) {
        const bad = [...frame], index = bad.findIndex(line => line.includes('/;/practice/;/'));
        if (defect === 'missing') bad.splice(index, 1);
        if (defect === 'duplicate') bad.splice(index, 0, bad[index]);
        if (defect === 'foreign') bad[index] = 'VOTC:LANGUAGE/;/practice/;/invented/;/1';
        if (defect === 'stale') bad[0] = bad[0].replace(inventory.digest, 'old');
        bad.forEach(line => reader.observe(line)); expect(reader.snapshot(1)).toBeUndefined();
    }
});

test('hidden practice changes only the hearing and never grants production or exposes its reason to recipients', () => {
    const game = new GameData(['1', 'Listener', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Listener', '0']);
    const hidden = character(1, 'Listener'); hidden.languageSnapshot = { version: 1, complete: true,
        nativeLanguageId: 'language_gnomish', knownLanguageIds: ['language_gnomish'], practiceFamiliarity: {
            version: 1, complete: true, routingVersion: relations.version, matchedRuleIds: ['CT01'] } };
    const speaker = character(2, 'Speaker'); speaker.languageSnapshot = { version: 1, complete: true, nativeLanguageId: 'language_eredun', knownLanguageIds: ['language_eredun'] };
    const outsider = character(3, 'Observer'); outsider.languageSnapshot = { version: 1, complete: true, nativeLanguageId: 'language_common', knownLanguageIds: ['language_common'] };
    for (const actor of [hidden, speaker, outsider]) game.characters.set(actor.id, actor);
    const session = new LanguageConversation(game, loadLanguageEngine('public/languages').renderer);
    const message = { role: 'assistant' as const, characterId: 2, content: '**He offers the key.** ""Bring water before dawn.""', proseEncoding: 'controls-v1' as const };
    const heard = session.forRecipient(message, 1), foreign = session.forRecipient(message, 3);
    expect(heard.comprehensionMode).toBe('CLOSE'); expect(foreign.comprehensionMode).toBe('FAR');
    for (const view of [heard, foreign]) {
        const serialized = JSON.stringify(view);
        for (const secret of ['CT01', 'practiceFamiliarity', 'disorder', 'Warlock']) expect(serialized).not.toContain(secret);
        expect(view.content).toContain('He offers the key.');
    }
    const instruction = speakingLanguageInstruction(hidden)!;
    expect(instruction).toContain('Fluent languages: Gnomish.'); expect(instruction).not.toContain('Eredun');
    expect(() => selectSpokenLanguage({ nativeLanguageId: 'language_gnomish', learnedLanguageIds: [],
        practiceFamiliarity: hidden.languageSnapshot!.practiceFamiliarity }, undefined, 'language_eredun')).toThrow('does not know');
});

test.each([
    { kind: 'known_spell', spell: 'summon_demon } set_variable = {' },
    { kind: 'trained_school', school: 'death' }, { kind: 'spirit_school', school: 'shadow' },
    { kind: 'faith', ids: [] }, { kind: 'rite_institution', faithIds: [] },
    { kind: 'any', conditions: [] }, { kind: 'trait', ids: ['demon_hunter'], injected: true }
])('malformed eligibility cannot create an executable capture predicate: %j', predicate => {
    expect(() => validateFamiliarityPredicate(predicate)).toThrow();
});
