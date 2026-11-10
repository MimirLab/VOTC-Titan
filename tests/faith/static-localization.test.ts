import { faithCatalogFromFiles } from '../../src/main/faith/faithCatalog';
import { catalogFromFiles } from '../../src/main/culture/cultureCatalog';
import { staticLocalizationText } from '../../src/main/culture/staticLocalization';
import { faithHash, faithInput } from '../../src/main/faith/faithIdentity';
import { snapshot } from './fixtures';

function sources(description: string) {
    return new Map([
        ['common/religion/religion_types/test.txt', 'root = { family = rf_custom faiths = { custom = {} } }'],
        ['common/traits/test.txt', 'patient = { personality = yes }'],
        ['common/religion/doctrine_types/test.txt', 'custom_doctrine = { name = custom_name }'],
        ['common/culture/pillars/test.txt', 'custom_ethos = { type = ethos desc = shared_description }'],
        ['common/culture/traditions/test.txt', 'custom_tradition = { desc = shared_description }'],
        ['localization/english/test_l_english.yml',
            `l_english:\n custom_desc:0 "${description}"\n shared_description:0 "${description}"`]
    ]);
}
test('literal glossary lore survives in faith and cultural source evidence', () => {
    const files = sources("Their compact with the [Glossary( 'Titans', 'TITAN_GLOSS' )] shapes their sacred mission.");
    expect(faithCatalogFromFiles(files).templates[0].description).toBe('Their compact with the Titans shapes their sacred mission.');
    expect(catalogFromFiles(files).facts[0].description).toBe('Their compact with the Titans shapes their sacred mission.');
});
test('concept links retain the displayed words rather than the internal concept key', () => {
    const files = sources("They guard [Concept('causal_order', 'the order of time')|E].");
    expect(faithCatalogFromFiles(files).templates[0].description).toBe('They guard the order of time.');
});
test('character-dependent arguments remain unknown without selecting a default', () => {
    for (const expression of ["Glossary(GetPlayer.GetName, 'TITLE')", "Concept('gender', Select_CString(IsFemale, 'women', 'men'))",
        "Select_CString(IsFemale, Glossary('women', 'GENDER'), 'men')"])
        expect(staticLocalizationText(expression)).toBeUndefined();
    expect(faithCatalogFromFiles(sources("They revere [Glossary(GetPlayer.GetName, 'TITLE')].")).templates[0].description)
        .toBe('They revere (context-dependent wording).');
});
test('literal Unicode text and escaped apostrophes remain intact', () => {
    expect(staticLocalizationText('Glossary("女神", "DEITY")')).toBe('女神');
    expect(staticLocalizationText("Concept('title', 'Keeper\\'s covenant')")).toBe("Keeper's covenant");
});
test('a changed displayed lore term changes the anonymous snapshot identity', () => {
    const a = faithCatalogFromFiles(sources("They revere [Glossary('Titans', 'TITLE')]."));
    const b = faithCatalogFromFiles(sources("They revere [Glossary('Old Gods', 'TITLE')]."));
    const sa = snapshot(), sb = snapshot();
    sa.facts.find(f => f.kind === 'description' && f.key === 'faith')!.description = a.templates[0].description;
    sb.facts.find(f => f.kind === 'description' && f.key === 'faith')!.description = b.templates[0].description;
    expect(a.digest).not.toBe(b.digest);
    expect(faithHash(faithInput(sa, 'en'))).not.toBe(faithHash(faithInput(sb, 'en')));
});
