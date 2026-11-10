import fs from 'fs';
import os from 'os';
import path from 'path';
import { Config } from '../../src/shared/Config';
import { ApiConnection } from '../../src/shared/apiConnection';
import { buildCultureCatalog } from '../../src/main/culture/cultureCatalog';
import { initializeCultureRuntime, prepareCultureCapture, observeCultureLine, getCultureBackground, clearCultureObservations,
    closeCultureRuntime, cultureRuntimeStatus } from '../../src/main/culture/cultureRuntime';
import { character } from './fixtures';
import * as ingredients from '../../src/main/background/backgroundIngredients';
import { conceptDefinitionHash } from '../../src/main/background/authoredConceptBank';
import { sha256Hex } from '../../src/main/promptWorkbench/canonicalJson';

jest.mock('../../src/shared/apiConnection', () => ({ ApiConnection: jest.fn() }));

test('the production runtime needs no addon, generates once, and reuses it after an account change', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'votc-runtime-test-'));
    const game = path.join(root, 'game'); const user = path.join(root, 'user'); const appData = path.join(root, 'app');
    const write = (relative: string, content: string) => {
        const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
    };
    write('game/common/culture/pillars/test.txt', ['ethos', 'heritage', 'language', 'martial_custom'].map(type => `custom_${type} = { type = ${type} }`).join('\n'));
    write('game/common/culture/traditions/test.txt', 'custom_tradition = { parameters = { patient_trait_more_common = yes } }');
    write('game/common/culture/name_lists/test.txt', 'custom_names = { always_use_patronym = yes }');
    write('game/localization/english/test.yml', 'l_english:\n custom_ethos_desc:0 "Patient craftsmanship is admired."\n custom_martial_custom_desc:0 "Women and men may serve as warriors."\n custom_tradition_desc:0 "Hospitality welcomes travelers."');
    write('user/dlc_load.json', JSON.stringify({ enabled_mods: [] }));
    const config = Object.assign(Object.create(Config.prototype), JSON.parse(fs.readFileSync('default_userdata/configs/default_config.json', 'utf8')));
    config.cultureGameInstallPath = game; config.userFolderPath = user;
    const complete = jest.fn().mockImplementation(async (messages) => {
        const data = JSON.parse(messages[1].content.split('\n')[1]);
        return JSON.stringify({ selections: data.candidates.slice(0, 2).map((p: { id: string }) => p.id) });
    });
    (ApiConnection as jest.Mock).mockImplementation(() => ({ context: 8192, calculateTokensFromText: (s: string) => Math.ceil(s.length / 4), complete }));
    let person = character(10, 'Synthetic speaker');
    try {
        initializeCultureRuntime(config, appData, null, () => false);
        const initialPlayset = fs.readFileSync(path.join(user, 'dlc_load.json'), 'utf8');
        expect(prepareCultureCapture()).toContain('no additional game addon');
        expect(fs.existsSync(path.join(user, 'mod'))).toBe(false);
        expect(fs.readFileSync(path.join(user, 'dlc_load.json'), 'utf8')).toBe(initialPlayset);
        const catalog = buildCultureCatalog(game, user);
        const observed = catalog.facts.find(f => f.kind === 'tradition')!;
        const meaning = 'Guests are met with courtesy; patient craftsmanship earns respect.';
        const entry = {domain:'culture',key:observed.key,definitionHash:conceptDefinitionHash('culture',observed),
            status:'authored',label:'Reviewed Household Courtesy',description:meaning,tags:[],rationale:'Synthetic runtime concept.'};
        const bank = new ingredients.BackgroundIngredientBank({authored:{version:1,entries:[entry]},
            essential:{version:1,entries:[{domain:'culture',key:entry.key,definitionHash:entry.definitionHash,readingId:null,
                richDescriptionHash:sha256Hex(meaning),text:meaning,rationale:'Synthetic compact meaning.'}]},
            compositions:{version:1,compositions:[]},relationships:{version:1,accounts:[],roots:[]}});
        jest.spyOn(ingredients,'ingredientRevision').mockImplementation((d,s)=>bank.revision(d,s));
        jest.spyOn(ingredients,'ingredientView').mockImplementation(((d:any,s:any)=>bank.project(d,s)) as any);
        jest.spyOn(ingredients,'ingredientInterpretations').mockImplementation((d,s)=>bank.authored.generatorConcepts(d,s));
        jest.spyOn(ingredients,'combineIngredientPassages').mockImplementation((d,s,p)=>bank.combine(d,s,p));
        const capture = () => {
            observeCultureLine(`VOTC:CULTURE/;/begin/;/2/;/${catalog.digest}/;/10/;/999/;/1/;/0`);
            catalog.facts.forEach(f => observeCultureLine(`VOTC:CULTURE/;/fact/;/${f.kind}/;/${f.key}`));
            observeCultureLine('VOTC:CULTURE/;/support/;/era/;/Custom era');
            observeCultureLine('VOTC:CULTURE/;/support/;/naming_order/;/Custom style');
            observeCultureLine('VOTC:CULTURE/;/support/;/primary_naming/;/Custom names');
            observeCultureLine(`VOTC:CULTURE/;/end/;/${catalog.digest}/;/10/;/999`);
        };
        capture(); expect(getCultureBackground(person)).toBeUndefined();
        const deadline = Date.now() + 3000;
        while (!getCultureBackground(person) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        expect(getCultureBackground(person)).toContain('Patient craftsmanship is admired.');
        const args = complete.mock.calls[0];
        expect(args[0][0].role).toBe('system');
        expect(args[0][1].content).toContain(meaning);
        expect(args[0][1].content).not.toContain('Hospitality welcomes travelers.');
        expect(args[2].max_tokens).toBeGreaterThanOrEqual(1024);
        expect(args[4]).toBeInstanceOf(AbortSignal);
        config.textGenerationApiConnectionConfig.connection.key = 'different-synthetic-account';
        config.textGenerationApiConnectionConfig.connection.model = 'different-synthetic-model';
        clearCultureObservations(); person = character(10, 'New game speaker');
        person.faith = 'Different personal faith';
        capture(); expect(getCultureBackground(person)).toContain('Patient craftsmanship is admired.');
        expect(complete).toHaveBeenCalledTimes(1);
        expect(cultureRuntimeStatus()).toContain('1 ready');
        // A partial new capture immediately invalidates the prior character association.
        observeCultureLine(`VOTC:CULTURE/;/begin/;/2/;/${catalog.digest}/;/10/;/999/;/2/;/0`);
        expect(getCultureBackground(person)).toBeUndefined();
    } finally { await closeCultureRuntime(); fs.rmSync(root, { recursive: true, force: true }); }
});
