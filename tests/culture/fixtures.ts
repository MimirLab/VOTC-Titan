import '../helpers/background-ingredient-fixture';
import { CultureFact, CultureSnapshot } from '../../src/shared/gameData/CultureSnapshot';
import { Character } from '../../src/shared/gameData/Character';
import { CultureCatalog } from '../../src/main/culture/cultureCatalog';
import { passagePlan } from '../../src/main/background/sourceReference';
import { cultureInput, validateCultureResult, CultureGenerationResult } from '../../src/main/culture/cultureIdentity';
import { logicalRequestHash } from '../../src/main/promptWorkbench/canonicalJson';
import { ingredientView } from '../../src/main/background/backgroundIngredients';

export const legacyParagraph = 'Public duty and patient craft carry social prestige, while communal obligations temper praise for personal glory. Hospitality offers a familiar way to build trust, but differing expectations of courage can create tension. Individuals may honor these customs warmly, use them for advantage, or resist them according to their own character and circumstances.';

export function fact(kind: CultureFact['kind'], key: string, category = ''): CultureFact {
    return { kind, key, category, name: key.replace(/_/g, ' '), description: `The custom ${key} is part of the cultural environment.`, rules: '' };
}
export function snapshot(): CultureSnapshot {
    return { version: 2, complete: true, facts: [
        ...['ethos', 'heritage', 'language', 'martial_custom', 'head_determination'].map(c => fact('pillar', `test_${c}`, c)),
        fact('tradition', 'tradition_custom_hospitality'), fact('tradition', 'tradition_custom_craft'),
        fact('naming', 'name_list_custom'), fact('era', 'custom_era'), fact('innovation', 'innovation_custom_sails')
    ] };
}
export function catalog(): CultureCatalog {
    const input = snapshot();
    const content = { version: 2 as const, facts: input.facts.filter(f => f.kind !== 'era'), eras: input.facts.filter(f => f.kind === 'era'),
        courts: [], traitValuations: [], pillarCategories: input.facts.filter(f => f.kind === 'pillar').map(f => f.category).sort() };
    return { ...content, digest: logicalRequestHash(content) };
}
export function captureLines(characterId = 10, cultureId = 100): string[] {
    const input = catalog();
    return [
        `VOTC:CULTURE/;/begin/;/2/;/${input.digest}/;/${characterId}/;/${cultureId}/;/2/;/1`,
        ...input.facts.map(f => `VOTC:CULTURE/;/fact/;/${f.kind}/;/${f.key}`),
        'VOTC:CULTURE/;/support/;/era/;/custom era',
        'VOTC:CULTURE/;/support/;/naming_order/;/Custom naming style',
        'VOTC:CULTURE/;/support/;/primary_naming/;/Custom names',
        `VOTC:CULTURE/;/end/;/${input.digest}/;/${characterId}/;/${cultureId}`
    ];
}
export function character(id: number, name: string): Character {
    const data = Array<string>(27).fill('');
    data[0] = String(id); data[1] = name; data[2] = name; data[3] = 'Count'; data[4] = 'he';
    data[5] = '30'; data[6] = '100'; data[7] = '15'; data[8] = 'Heterosexual'; data[9] = 'Diplomat';
    data[10] = '0'; data[14] = 'Renamable culture'; data[15] = 'Personal faith'; data[18] = name;
    data[20] = 'No liege'; data[21] = '10'; data[26] = 'Count';
    const result = new Character(data);
    result.traits.push({ category: 'personality', name: 'Compassionate', desc: 'Concern for others.' });
    return result;
}

export function result(input = cultureInput(snapshot(), 'en')): CultureGenerationResult {
    const selections = passagePlan('culture', ingredientView('culture', input.snapshot)).passages
        .filter(p => !p.required && p.kind === 'adopted custom').slice(0, 2).map(p => p.id);
    return validateCultureResult({ selections }, input);
}
export const paragraph = result().paragraph;
