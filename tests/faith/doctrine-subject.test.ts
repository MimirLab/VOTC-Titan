import { faithCatalogFromFiles } from '../../src/main/faith/faithCatalog';
import { faithHash, faithInput } from '../../src/main/faith/faithIdentity';
import { snapshot } from './fixtures';

function files(localization: string, group = 'custom_power') {
    return new Map([
        ['common/religion/religion_types/religion.txt', 'custom_religion = { family = rf_custom }'],
        ['common/traits/traits.txt', 'patient = { personality = yes }'],
        ['common/religion/doctrine_group_types/groups.txt', `${group} = { doctrine_types = { accepted } }`],
        ['common/religion/doctrine_types/options.txt', 'accepted = { name = accepted_name desc = accepted_desc parameters = { use_allowed = yes } }'],
        ['localization/english/subjects_l_english.yml', 'l_english:\n accepted_name:0 "Accepted"\n accepted_desc:0 "Its practitioners are honored."\n'+localization]
    ]);
}
test('a generic option retains its localized group subject and description in anonymous evidence', () => {
    const c=faithCatalogFromFiles(files(' custom_power_name:0 "Arcane Magic"\n custom_power_desc:0 "Views about arcane practice."'));
    const f=c.doctrines[0], r=JSON.parse(f.rules);
    expect(f.name).toBe('Accepted'); expect(f.description).toBe('Its practitioners are honored.');
    expect(r.meanings.custom_power_name).toBe('Arcane Magic');
    expect(r.meanings.custom_power_desc).toBe('Views about arcane practice.');
    expect(r.definitions).toContainEqual({key:'doctrine_group',value:'custom_power'});
});
test('overhaul group labels resolve localization references without a built-in magic dictionary', () => {
    const c=faithCatalogFromFiles(files(' novel_group_name:0 "$custom_subject$"\n custom_subject:0 "Dream Weaving"','novel_group'));
    expect(JSON.parse(c.doctrines[0].rules).meanings.novel_group_name).toBe('Dream Weaving');
});
test('missing localization stays absent rather than inventing a human meaning from the key', () => {
    const c=faithCatalogFromFiles(files(''));
    expect(JSON.parse(c.doctrines[0].rules).meanings).not.toHaveProperty('custom_power_name');
});
test('changed group meaning affects catalog and snapshot identity despite an unchanged option name', () => {
    const a=faithCatalogFromFiles(files(' custom_power_name:0 "Arcane Magic"'));
    const b=faithCatalogFromFiles(files(' custom_power_name:0 "Witchcraft"'));
    expect(a.digest).not.toBe(b.digest);
    const inputA=snapshot(), inputB=snapshot();
    inputA.facts.push(a.doctrines[0]); inputB.facts.push(b.doctrines[0]);
    expect(faithHash(faithInput(inputA,'en'))).not.toBe(faithHash(faithInput(inputB,'en')));
});
test('same subject under a direct localization key also remains available', () => {
    const c=faithCatalogFromFiles(files(' custom_power:0 "Shadow Magic"'));
    expect(JSON.parse(c.doctrines[0].rules).meanings.custom_power).toBe('Shadow Magic');
});
