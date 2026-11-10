import { resolveGoaLore, validateGoaCatalogue } from '../../src/main/goa/goaResolver';
import { goaCatalogue } from '../../src/main/goa/goaCatalogue';
import { GoaSnapshot } from '../../src/shared/gameData/GoaSnapshot';
import { character } from '../culture/fixtures';
import { characterToSnapshot } from '../../src/main/promptWorkbench/GameDataSnapshotCodec';
import { validateCharacterSnapshotV1 } from '../../src/main/promptWorkbench/promptWorkbenchSchemas';
const digest = 'a'.repeat(64);
export function snap(ids: string[], extra: Partial<GoaSnapshot> = {}): GoaSnapshot {
    return { version: 1, digest, characterId: 2, sex: 'female', traitIds: ids, facts: {}, ...extra };
}
const packet = (ids: string[], extra: Partial<GoaSnapshot> = {}) => resolveGoaLore('Asha', snap(ids, extra));

test('the full authored catalogue, coverage references and every subject variant validate', () => {
    expect(validateGoaCatalogue).not.toThrow();
    expect(goaCatalogue.entries).toHaveLength(311);
    expect(goaCatalogue.coverage).toHaveLength(345);
    expect(goaCatalogue.core_coverage).toHaveLength(294);
});
test('female Succubus and Dryad, male Incubus and Keeper use game sex; a pure energy body remains neutral', () => {
    const female = packet(['creature_sayaadi']);
    expect(female.text).toContain('She is a succubus, a demon of seduction'); expect(female.text).toContain('She takes intense pleasure');
    expect(female.text).not.toContain('She is demons');
    const male = packet(['creature_sayaadi'], { sex: 'male' });
    expect(male.text).toContain('He is an incubus, a demon'); expect(male.text).toMatch(/\b[Hh]is\b/);
    expect(packet(['creature_dryad']).selectedKeys).toContain('dryad_playfulness');
    expect(packet(['creature_dryad']).selectedKeys).not.toContain('keeper_antlers');
    const keeper = packet(['creature_dryad'], { sex: 'male' });
    expect(keeper.selectedKeys).toContain('keeper_watchfulness'); expect(keeper.selectedKeys).toContain('keeper_antlers');
    const energy = packet(['creature_voidwalker'], { sex: 'male' });
    expect(energy.pronouns).toBe('they/them'); expect(energy.text).toContain('They are a sexless, hovering, shapeless creature');
    expect(packet(['creature_flamewaker'], { sex: 'female' }).pronouns).toBe('she/her');
    expect(packet(['creature_nathrezim'], { sex: 'male' }).pronouns).toBe('he/him');
    expect(packet(['creature_sayaadi'], { sexlessBody: true, currentBody: 'creature_sayaadi' }).pronouns).toBe('she/her');
});
test('unknown sex is not inferred from localized names; sex-dependent branches stay dormant', () => {
    const p = packet(['creature_dryad'], { sex: undefined });
    expect(p.pronouns).toBe('name only'); expect(p.text).toContain('Asha has');
    expect(p.selectedKeys).not.toContain('dryad_playfulness'); expect(p.selectedKeys).not.toContain('keeper_watchfulness');
});
test('physical facts stay brief and identity lives in prose without a universal body or pronoun announcement', () => {
    for (const ids of [['creature_sayaadi'], ['creature_dryad'], ['creature_voidwalker'], ['creature_satyr', 'cat_form']]) {
        const p = packet(ids);
        expect(p.text).not.toContain('Current body:'); expect(p.text).not.toContain('(she/her;');
        expect(p.text).not.toMatch(/headwear|doorways|seating|ordinary humanoid gestures/);
    }
    expect(packet(['creature_dryad']).text).toContain('a dryad and child of Cenarius');
    expect(packet(['creature_dryad'], { sex: 'male' }).text).toContain('a Keeper of the Grove and child of Cenarius');
    expect(packet(['creature_satyr', 'cat_form']).text).toContain('She is shapeshifted into a cat, with paws and claws.');
    expect(packet(['creature_nathrezim'], { sex: 'male' }).text).not.toContain('sexless');
});
test('non-owner plural and object references retain their meaning', () => {
    const spirit = packet(['user_of_elemental_fire_spirit_magic_3']);
    expect(spirit.text).toContain('wills of their own'); expect(spirit.text).toContain('To her');
    expect(packet(['creature_mantid']).text).toContain('judgments of their own');
    expect(packet(['creature_dwarf']).text).toContain('stories behind them');
    // The curated Harpy paragraph uses species-level wording; restraint still
    // competes with native malice without assigning other people's motives.
    expect(packet(['creature_harpy']).text).toContain('Real attachment or adopted ethics contends with that malice');
});
test('Fel Orc and exact hybrid predicates win without treating provider IDs as an OR list', () => {
    expect(packet(['blood_ogre']).selectedKeys).not.toContain('race_moknathal');
    const hybrid = packet(['creature_orc', 'blood_ogre']);
    expect(hybrid.selectedKeys).toContain('race_moknathal'); expect(hybrid.selectedKeys).toContain('moknathal_nature');
    expect(hybrid.selectedKeys).not.toContain('orc_nature');
    const fel = packet(['creature_orc', 'blood_ogre', 'being_demon']);
    expect(fel.selectedKeys).toContain('race_fel_orc'); expect(fel.selectedKeys).not.toContain('demon_temptations');
    expect(fel.selectedKeys).not.toContain('moknathal_nature');
});
test('temporary forms replace anatomy but retain persistent appetite and hybrid nature', () => {
    const satyr = packet(['creature_satyr', 'cat_form']);
    expect(satyr.selectedKeys).toContain('race_satyr'); expect(satyr.selectedKeys).toContain('cat_form');
    expect(satyr.selectedKeys).not.toContain('race_satyr_body');
    const hybrid = packet(['creature_orc', 'blood_ogre', 'bear_form']);
    expect(hybrid.selectedKeys).toContain('moknathal_nature'); expect(hybrid.selectedKeys).not.toContain('orc_nature');
    expect(hybrid.selectedKeys).not.toContain('race_moknathal');
    expect(packet(['creature_satyr', 'polymorph', 'cat_form']).selectedKeys).not.toContain('cat_form');
    const ambiguous = packet(['creature_satyr', 'cat_form', 'bear_form']);
    expect(ambiguous.body).toBeUndefined(); expect(ambiguous.selectedKeys).not.toContain('bear_form');
});
test('elven aliases, infusion combinations and actual overrides remain distinct', () => {
    expect(packet(['blood_high_elf']).selectedKeys).not.toContain('elf_magic_dependency');
    expect(packet(['creature_high_elf']).selectedKeys).toContain('elf_magic_dependency');
    const withdrawal = packet(['creature_high_elf', 'wretched']);
    expect(withdrawal.selectedKeys).toContain('wretched'); expect(withdrawal.selectedKeys).not.toContain('elf_magic_dependency');
    const undead = packet(['creature_high_elf', 'being_undead', 'being_light']);
    expect(undead.selectedKeys).toContain('race_darkfallen'); expect(undead.selectedKeys).toContain('light_identity');
    expect(undead.selectedKeys).not.toContain('undead_flesh_light_pain');
    expect(packet(['creature_broken'], { facts: { light_access_restored: true } }).selectedKeys).not.toContain('broken_lost_light_limitation');
    expect(packet(['creature_lost_one'], { facts: { restored_cognition: true } }).selectedKeys).not.toContain('race_lost_one');
});
test('higher injury ranks and mantles suppress exactly their own family', () => {
    const wounds = packet(['burned_1', 'burned_2', 'burned_3', 'frostbite_1']);
    expect(wounds.selectedKeys).toContain('burned_3'); expect(wounds.selectedKeys).not.toContain('burned_1');
    expect(wounds.selectedKeys).toContain('frostbite_1');
    const mantle = packet(['creature_red_dragon', 'aspect_of_life']);
    expect(mantle.selectedKeys).toContain('aspect_life'); expect(mantle.selectedKeys).toContain('red_dragon_life_fire_aspect');
    expect(mantle.selectedKeys).not.toContain('race_red_dragon');
    const time = packet(['creature_bronze_dragon', 'aspect_of_time', 'aspect_of_infinity']);
    expect(time.selectedKeys).toContain('aspect_infinity'); expect(time.selectedKeys).not.toContain('aspect_time');
});
test('Fallen replacement and corruption do not attach former habits or erase actual training', () => {
    const fallen = packet(['creature_gnome', 'demon_hunter', 'metamorphosis', 'fallen_demon_hunter', 'being_demon']);
    expect(fallen.selectedKeys).toContain('fallen_demon_hunter'); expect(fallen.selectedKeys).not.toContain('demon_hunter');
    expect(fallen.selectedKeys).not.toContain('metamorphosis'); expect(fallen.selectedKeys).not.toContain('race_gnome_ingenuity');
    const corrupted = packet(['creature_dryad', 'user_of_life_magic_4', 'wc_druid_of_the_fang']);
    expect(corrupted.selectedKeys).toContain('practice_life_corrupted'); expect(corrupted.text).toContain('Expert Nature');
    expect(corrupted.selectedKeys).not.toContain('nature_bond'); expect(corrupted.selectedKeys).not.toContain('druid_of_the_fang');
});
test('independent magic methods coexist, highest ranks resolve, and flags never invent positive resistance', () => {
    const p = packet(['creature_human', 'user_of_elemental_fire_spirit_magic_2', 'user_of_elemental_fire_spirit_magic_4',
        'user_of_elemental_water_decay_magic_3', 'user_of_elemental_air_magic_1', 'void_sickness'], { magicDefences: { elemental_fire: -5, shadow: -2 } });
    expect(p.selectedKeys).toEqual(expect.arrayContaining(['elemental_spirit', 'elemental_decay', 'elemental_studied']));
    expect(p.text).toContain('Expert fire'); expect(p.text).not.toContain('Journeyman fire');
    expect(p.text).toContain('sentient spirits'); expect(p.text).toContain('seize and subjugate');
    expect(p.text).toContain('Fire: net vulnerability'); expect(p.text).not.toContain('Shadow:');
    expect(packet(['void_sickness', 'being_void']).selectedKeys).not.toContain('blood_magic_defences');
    expect(p.text).not.toMatch(/\{[A-Za-z_]+\}|user_of_|creature_|source_revision|requires_fields/);
});
test('advanced memories, controllers, literacy, phylactery and hidden marks require positive state', () => {
    expect(packet(['creature_lich']).selectedKeys).not.toContain('lich_soul_anchor');
    expect(packet(['creature_lich'], { facts: { soul_anchor_exists: true, soul_anchor_intact: true } }).selectedKeys).toContain('lich_soul_anchor');
    expect(packet(['creature_nightborne']).selectedKeys).not.toContain('suramar_isolation_heritage');
    expect(packet(['creature_mantid']).selectedKeys).not.toContain('mantid_immature_empress_voice');
    const mark = snap(['creature_human', 'scarlet_mark'], { facts: { knows_scarlet_mark: true } });
    expect(resolveGoaLore('Asha', mark).selectedKeys).toContain('scarlet_mark');
    expect(resolveGoaLore('Asha', mark, {}, true).text).toBe('');
    expect(resolveGoaLore('Asha', mark, { knownRuleKeys: ['scarlet_mark'] }, true).selectedKeys).toEqual(['scarlet_mark']);
});
test('canonical core IDs stay separate from race IDs; caches include sex and state and replace old packets', () => {
    expect(packet(['creature_dwarf']).selectedKeys).not.toContain('core_dwarfism');
    expect(packet(['dwarf']).selectedKeys).not.toContain('race_dwarf_body');
    expect(packet(['creature_gnome']).hash).not.toBe(packet(['creature_gnome'], { sex: 'male' }).hash);
    expect(packet(['creature_gnome', 'irradiated']).selectedKeys).not.toContain('race_gnome_ingenuity');
    expect(packet(['creature_gnome']).selectedKeys).not.toContain('race_leper_gnome');
});
test('trait IDs, canonical sex and optional observations survive snapshot validation; legacy remains valid', () => {
    const person = character(2, 'Asha');
    expect(validateCharacterSnapshotV1(characterToSnapshot(person)).goaSnapshot).toBeUndefined();
    person.sex = 'female'; person.goaSnapshot = snap(['creature_dryad']);
    person.traits.push({ id: 'creature_dryad', name: 'Localized dryad', category: 'Race', desc: 'Original description.' });
    const encoded = validateCharacterSnapshotV1(characterToSnapshot(person));
    expect(encoded.sex).toBe('female'); expect(encoded.goaSnapshot).toEqual(person.goaSnapshot);
    expect(encoded.traits.at(-1)?.id).toBe('creature_dryad');
});
test('real cognition restoration replaces Leper pressure while physical irradiation remains', () => {
    const restored = packet(['creature_gnome', 'irradiated'], { facts: { restored_cognition: true } });
    expect(restored.selectedKeys).toContain('race_gnome_ingenuity');
    expect(restored.selectedKeys).not.toContain('race_leper_gnome');
    expect(restored.selectedKeys).toContain('irradiated');
    const impaired = packet(['creature_gnome', 'irradiated']);
    expect(impaired.text).toContain('Radiation weakens'); expect(impaired.text).toContain('confusion and hostile misidentification');
});
test('elemental mastery merges into the matching method without assigning an unsupported rank', () => {
    const p = packet(['master_pyromancer', 'user_of_elemental_fire_spirit_magic_3']);
    expect(p.text).toContain('Adept fire'); expect(p.text).not.toContain('Master fire');
    const method = p.text.split('\n\n').find(part => part.includes('elemental communion'))!;
    expect(method).toContain('exceptional mastery of destructive fire');
    expect(packet(['master_pyromancer']).selectedKeys).toEqual(['master_pyromancer']);
});

test('complete authored combinations retain facts and rank without asserting missing conditions', () => {
    const druid = packet(['creature_dryad', 'user_of_life_magic_3']);
    expect(druid.compositionKeys).toContain('nature_druid');
    expect(druid.selectedKeys).toEqual(expect.arrayContaining(['nature_bond', 'practice_life']));
    expect(druid.text).toContain('Adept druidic practice'); expect(druid.text).toContain('predation, decay and renewal');
    expect(druid.text).not.toContain('{rank}');
    expect(packet(['creature_dryad']).compositionKeys).not.toContain('nature_druid');
    const undead = packet(['being_undead'], { facts: { ageless: true } });
    expect(undead.compositionKeys).toContain('undead_ageless_parenthood');
    expect(undead.compositionKeys).not.toContain('undead_parenthood');
    expect(undead.text).toContain('adoption remains possible');
    expect(packet(['being_undead']).text).not.toContain('age-related decline');
    const demon = packet(['being_demon']);
    expect(demon.compositionKeys).toContain('demon_nether');
    expect(demon.text).toContain('outside that realm');
    expect(packet(['being_demon', 'in_twisting_nether']).compositionKeys).not.toContain('demon_nether');
});

test('an observer must know all contributors, and never receives Fallen captivity or sabotage intent', () => {
    const s = snap(['creature_dryad', 'user_of_life_magic_3']);
    const partial = resolveGoaLore('Asha', s, { knownRuleKeys: ['nature_bond'] }, 'observer');
    expect(partial.compositionKeys).toEqual([]); expect(partial.text).not.toContain('druidic practice');
    const full = resolveGoaLore('Asha', s, { knownRuleKeys: ['nature_bond', 'practice_life'] }, 'observer');
    expect(full.compositionKeys).toContain('nature_druid');
    const fallen = resolveGoaLore('Asha', snap(['fallen_demon_hunter']), { knownRuleKeys: ['fallen_demon_hunter'] }, 'observer');
    expect(fallen.text).toContain('taken control'); expect(fallen.identityInstruction).toBeUndefined();
    expect(fallen.text).not.toMatch(/remains conscious|forced to witness|relishes|sabotage|cherished people/);
});

test('Fallen control, costly urges and uncertain Possessed episodes have different agency', () => {
    const fallen = packet(['fallen_demon_hunter']);
    expect(fallen.identityPolicy).toBe('fallen_controller');
    expect(fallen.text).toContain('hunter remains conscious');
    expect(fallen.identityInstruction).toContain('demon alone');
    expect(fallen.identityInstruction).toContain('subsequent choices and alliances');
    for (const ids of [['possessed_1'], ['creature_high_elf', 'wretched'], ['creature_orc', 'being_demon']]) {
        expect(packet(ids).identityPolicy).toBe('ordinary'); expect(packet(ids).identityInstruction).toBeUndefined();
    }
    expect(packet(['possessed_1']).text).toContain('possible supernatural interference');
    expect(packet(['possessed_1']).text).not.toContain('epilepsy');
    const action = resolveGoaLore('Asha', snap(['fallen_demon_hunter']), {}, 'action');
    expect(action.text).toContain('do not establish that an action occurred');
    expect(action.identityInstruction).toContain('only actions supported');
    expect(action.identityInstruction).not.toContain('speak and act');
    expect(action.identityInstruction).not.toContain('Choose intentions');
});

test('Troll limb regeneration is natural recovery, with pain and death still meaningful', () => {
    const troll = packet(['creature_troll']);
    expect(troll.text).toContain('regrow lost limbs');
    expect(troll.text).toContain('without requiring a special blessing');
    expect(troll.text).toContain('death remain real risks');
    expect(troll.text).toContain('neither instant nor effortless');
});

test.each(['male', 'female', undefined] as const)('compositions retain the actual subject variant %s', sex => {
    const p = packet(['being_demon', 'creature_sayaadi'], { sex });
    expect(p.text).not.toMatch(/\{[A-Za-z_]+\}/);
    expect(p.text).toContain(sex === 'female' ? 'Fel has made her a demon' : sex === 'male' ? 'Fel has made him a demon' : 'Fel has made Asha a demon');
});


test('an explicitly sexless embodiment uses the neutral composition without reclassifying known sexed races', () => {
    const p = packet(['being_demon', 'creature_nathrezim'], { sexlessBody: true, currentBody: 'creature_nathrezim' });
    expect(p.pronouns).toBe('they/them'); expect(p.text).toContain('Fel has made them a demon');
    const known = packet(['being_demon', 'creature_sayaadi'], { sexlessBody: true, currentBody: 'creature_sayaadi' });
    expect(known.pronouns).toBe('she/her'); expect(known.text).toContain('Fel has made her a demon');
});
