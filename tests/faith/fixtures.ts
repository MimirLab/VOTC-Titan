import { faithCatalogFromFiles } from '../../src/main/faith/faithCatalog';
import { FaithCapture, sealFaithSnapshot } from '../../src/main/faith/faithLog';
import { passagePlan } from '../../src/main/background/sourceReference';
import { validateFaithResult, faithInput } from '../../src/main/faith/faithIdentity';
export function catalog() {
    return faithCatalogFromFiles(new Map([
        ['common/religion/religion_family_types/test.txt', 'rf_custom = { graphical_faith = custom_gfx hostile_within_group = no }'],
        ['common/religion/religion_types/test.txt', 'custom_religion = { family = rf_custom traits = { virtues = { patient } sins = { compassionate } } localization = { HighGodName = god_names } faiths = { old_name = { doctrine = custom_doctrine holy_site = shrine } } }'],
        ['common/religion/doctrine_group_types/test.txt', 'modded_magic_group = { category = magic number_of_picks = 2 doctrine_types = { custom_doctrine changed_doctrine } }'],
        ['common/religion/doctrine_types/test.txt', 'custom_doctrine = { parameters = { shadow_magic_approved = no permits_female_clergy = yes } traits = { sins = { compassionate } } } changed_doctrine = { parameters = { shadow_magic_crime = yes } }'],
        ['common/religion/holy_site_types/test.txt', 'shrine = { county = c_custom barony = b_custom character_modifier = { monthly_piety = 1 } }'],
        ['common/traits/test.txt', 'patient = { personality = yes } compassionate = { personality = yes } zealous = { category = personality }'],
        ['localization/english/test.yml', 'l_english:\n modded_magic_group_name:0 "Shadow magic"\n custom_doctrine_name:0 "Balance"\n custom_doctrine_desc:0 "Shadow teachings value restraint."\n custom_religion_desc:0 "A wider tradition of Light and Shadow."\n god_names:0 "Shadow"\n rf_custom_desc:0 "A family of related beliefs."\n patient:0 "Patient"\n compassionate:0 "Compassionate"\n holy_site_shrine_name:0 "The Shrine"\n doctrine_parameter_shadow_magic_approved:0 "Shadow magic is approved."\n']
    ]));
}
export function capture(): FaithCapture {
    return { religion: 'custom_religion', doctrines: ['custom_doctrine'], virtues: ['patient'], sins: ['compassionate'],
        holySites: ['shrine'], texts: { faith_description: 'Balance guides this faith.', religion_description: 'A wider tradition of Light and Shadow.', 'worship:HighGodName': 'Shadow' } };
}
export function snapshot() { return sealFaithSnapshot(catalog(), capture()); }
export function result(input = faithInput(snapshot(), 'en')) {
    const selections = passagePlan('faith', input.snapshot).passages
        .filter(p => !p.required).slice(0, 2).map(p => p.id);
    return validateFaithResult({ selections }, input);
}
export function records(characterId = 2, faithId = 123, data = capture()): string[] {
    const c = catalog(), prefix = 'VOTC:FAITH/;/';
    const lines = [prefix + 'begin/;/1/;/' + c.digest + '/;/' + characterId + '/;/' + faithId,
        prefix + 'parent_state/;/absent',
        prefix + 'fact/;/religion/;/' + data.religion];
    for (const [kind, keys] of [['doctrine', data.doctrines], ['virtue', data.virtues], ['sin', data.sins], ['holy_site', data.holySites]] as const)
        keys.forEach(key => lines.push(prefix + 'fact/;/' + kind + '/;/' + key));
    for (const [kind, count] of Object.entries({ religion: c.religions.length, doctrine: c.doctrines.length,
        virtue: c.traits.length, sin: c.traits.length, holy_site: c.holySites.length })) lines.push(prefix + 'census/;/' + kind + '/;/' + count);
    for (const [key, value] of Object.entries(data.texts)) lines.push(prefix + 'text_begin/;/' + key, prefix + 'text/;/' + value,
        prefix + 'text_end/;/' + c.digest + '/;/' + characterId + '/;/' + faithId + '/;/' + key);
    lines.push(prefix + 'live/;/fervor/;/65', prefix + 'live/;/head/;/Synthetic Leader',
        prefix + 'live/;/site/;/shrine/;/yes',
        prefix + 'end/;/' + c.digest + '/;/' + characterId + '/;/' + faithId);
    return lines;
}
