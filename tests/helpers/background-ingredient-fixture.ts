import { BackgroundIngredientBank } from '../../src/main/background/backgroundIngredients';
import * as ingredients from '../../src/main/background/backgroundIngredients';
import { conceptDefinitionHash } from '../../src/main/background/authoredConceptBank';
import { sha256Hex } from '../../src/main/promptWorkbench/canonicalJson';

// Protocol/library fixtures have authored synthetic concepts, never production fallbacks.
// Tests of the real bundled bank do not import this helper.
const facts = ['tradition_custom_hospitality', 'tradition_custom_craft'].map(key => ({
    kind: 'tradition' as const, key, category: '', name: key.replace(/_/g, ' '),
    description: `The custom ${key} is part of the cultural environment.`, rules: ''
}));
const meanings = ['Small courtesies and fair dealings are familiar ways to welcome people.',
    'Inherited methods and careful work give household craft its reputation.'];
const entries = facts.map((fact, i) => ({ domain: 'culture' as const, key: fact.key,
    definitionHash: conceptDefinitionHash('culture', fact), status: 'authored' as const,
    label: i ? 'Household Craft' : 'Everyday Courtesy', description: meanings[i], tags: [], rationale: 'Synthetic reviewed test meaning.' }));
const bank = new BackgroundIngredientBank({ authored: { version: 1, entries },
    essential: { version: 1, entries: entries.map(e => ({ domain: e.domain, key: e.key, definitionHash: e.definitionHash,
        readingId: null, richDescriptionHash: sha256Hex(e.description), text: e.description, rationale: 'Synthetic compact meaning.' })) },
    compositions: { version: 1, compositions: [] }, relationships: { version: 1, accounts: [], roots: [] } });

export function installFixtureIngredients(selected: BackgroundIngredientBank) {
    jest.spyOn(ingredients, 'ingredientRevision').mockImplementation((domain, snapshot) => selected.revision(domain, snapshot));
    jest.spyOn(ingredients, 'ingredientView').mockImplementation(((domain: any, snapshot: any) => selected.project(domain, snapshot)) as any);
    jest.spyOn(ingredients, 'ingredientInterpretations').mockImplementation((domain, snapshot) => selected.authored.generatorConcepts(domain, snapshot));
    jest.spyOn(ingredients, 'combineIngredientPassages').mockImplementation((domain, snapshot, passages) => selected.combine(domain, snapshot, passages));
}
function install() { installFixtureIngredients(bank); }
install();
beforeEach(install);
