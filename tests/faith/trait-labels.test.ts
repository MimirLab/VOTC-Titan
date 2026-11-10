import { faithCatalogFromFiles } from '../../src/main/faith/faithCatalog';

function catalogue(localization: string) {
    return faithCatalogFromFiles(new Map([
        ['common/religion/religion_types/test.txt', 'root = { family = rf_custom faiths = { custom = {} } }'],
        ['common/religion/doctrine_types/test.txt', 'custom_doctrine = {}'],
        ['common/traits/test.txt', 'strong = { physical = yes } adventurer = { fame = yes } custom = {}'],
        ['localization/english/test_l_english.yml', 'l_english:\n' + localization],
    ]));
}

test('a ledger heading cannot replace the physical Strong trait in faith morals', () => {
    const catalog = catalogue(' characters_name:0 "Characters"\n strong_name:0 "$characters_name$"\n trait_strong:0 "Strong"\n trait_strong_desc:0 "A powerful physique."');
    const fact = catalog.traits.find(row => row.key === 'strong')!;
    expect(fact).toMatchObject({ kind: 'virtue', key: 'strong', name: 'Strong', description: 'A powerful physique.' });
    expect(fact.rules).not.toContain('Characters');
});

test('legacy Adventurer morals use the trait rather than the unrelated camp heading', () => {
    const fact = catalogue(' adventurer_name:0 "Adventure Camp"\n trait_adventurer:0 "Veteran Adventurer"\n trait_adventurer_desc:0 "Experience gained on the road."')
        .traits.find(row => row.key === 'adventurer')!;
    expect(fact).toMatchObject({ key: 'adventurer', name: 'Veteran Adventurer', description: 'Experience gained on the road.' });
});

test('an actual raw trait localization retains priority over namespaced alternatives', () => {
    const fact = catalogue(' strong:0 "Mighty"\n strong_desc:0 "Current mod meaning."\n strong_name:0 "Characters"\n trait_strong:0 "Strong"\n trait_strong_desc:0 "Base meaning."')
        .traits.find(row => row.key === 'strong')!;
    expect(fact).toMatchObject({ name: 'Mighty', description: 'Current mod meaning.' });
});

test('a missing namespaced description retains supplied compatible prose', () => {
    const fact = catalogue(' strong_name:0 "Characters"\n trait_strong:0 "Strong"\n strong_desc:0 "Mod body meaning."')
        .traits.find(row => row.key === 'strong')!;
    expect(fact).toMatchObject({ name: 'Strong', description: 'Mod body meaning.' });
});

test('unknown labels and unambiguous custom names keep their existing meaning', () => {
    const catalog = catalogue(' custom_name:0 "Current custom virtue"');
    expect(catalog.traits.find(row => row.key === 'custom')!).toMatchObject({ name: 'Current custom virtue', description: '' });
    expect(catalog.traits.find(row => row.key === 'strong')!).toMatchObject({ name: 'strong', description: '' });
});
