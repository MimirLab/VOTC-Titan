import { CulturalRootBank, getCulturalRootBank } from '../../src/main/background/culturalRootBank';
import { CultureLibrary } from '../../src/main/culture/CultureLibrary';
import { CultureService } from '../../src/main/culture/CultureService';
import { cultureInput } from '../../src/main/culture/cultureIdentity';
import { canonicalJsonStringify } from '../../src/main/promptWorkbench/canonicalJson';
import { character, paragraph, result, snapshot } from './fixtures';

const wildhammer = { kind:'lineage' as const, key:'wildhammer', category:'source_culture', name:'', description:'',
    rules:canonicalJsonStringify({version:1,sourceDefinitionHash:'fa232830a155b0e6f8bd90a5e41bd9d35c03727d5abd3ea1c223d98187335fe0'}) };
const frostwolf = { kind:'lineage' as const, key:'frostwolf', category:'source_culture', name:'', description:'',
    rules:canonicalJsonStringify({version:1,sourceDefinitionHash:'35cf17b5a7aa1059c7e4d5b4f8f6adb9bd6bb9576ef08659a13870ccd425d03f'}) };

test('both exact observed parents supply distinct outlooks without an adopted custom', () => {
    const inherited = snapshot(); inherited.facts.push(wildhammer, frostwolf);
    const bank = getCulturalRootBank(), found = bank.resolve(inherited);
    expect(found.map(r => r.id)).toEqual(expect.arrayContaining(['wildhammer_outlook','frostwolf_outlook']));
    expect(found.find(r => r.id === 'wildhammer_outlook')!.text).toMatch(/gryphon.*shared care/i);
    expect(found.find(r => r.id === 'frostwolf_outlook')!.text).toMatch(/wolves as companions/i);
    expect(bank.resolve(inherited, ['wildhammer_gryphon_falconry']).map(r => r.id)).toEqual(['frostwolf_outlook']);
});

test('names, changed source definitions and malformed evidence cannot impersonate a root', () => {
    const input = snapshot();
    input.facts.push({ ...wildhammer, rules:canonicalJsonStringify({version:1,sourceDefinitionHash:'a'.repeat(64)}) });
    expect(getCulturalRootBank().resolve(input)).toEqual([]);
    input.facts[input.facts.length-1] = { ...wildhammer, name:'Wildhammer' };
    expect(getCulturalRootBank().resolve(input)).toEqual([]);
    expect(() => new CulturalRootBank({version:1,roots:[{id:'bad',cultureDefinitions:{wildhammer:'no'},
        coveredPracticeId:'missing',text:'A root',evidence:[]}]})).toThrow();
});

test('additional inherited outlooks survive absent customs and yield to their matching practice', () => {
    const input = snapshot();
    const sources = [
        ['harpy', 'b9f164cd6e5b0100a831361aa871c4da78ffa6e014565b0d90f70e999f202b41', 'harpy_outlook', 'retained_harpy_nest_standing'],
        ['centaur', '82355c390fe293f19d0c56c1b4cbd672614f81f75edce404dc7ef5e2acb92eba', 'centaur_outlook', 'retained_centaur_mobile_warfare'],
        ['lost_one', '3eb8b1f469b12909b41c2332cb1672315db65ed3bf67caf533210c3baf28f216', 'lost_one_craft_outlook', 'retained_lost_one_craft_memory'],
    ];
    for (const [key, hash] of sources) input.facts.push({ kind:'lineage', key, category:'source_culture', name:'', description:'',
        rules:canonicalJsonStringify({version:1,sourceDefinitionHash:hash}) });
    const bank = getCulturalRootBank();
    expect(bank.resolve(input).map(r => r.id)).toEqual(sources.map(row => row[2]));
    for (const [, , id, practice] of sources) {
        expect(bank.resolve(input, [practice]).map(r => r.id)).toEqual(sources.map(row => row[2]).filter(other => other !== id));
    }
});

test('live roots follow the bound observation while the same ready profile is reused', async () => {
    const library = new CultureLibrary(':memory:');
    const base = snapshot(), hash = library.encounter(cultureInput(base,'en'),0), job = library.claim(hash,0)!;
    library.finish(job,result(),1);
    const generate = jest.fn().mockResolvedValue(result());
    const service = new CultureService(library,generate,{enabled:()=>true,language:()=> 'en',foregroundBusy:()=>false,now:()=>2});
    const person = character(10,'Hybrid');
    const inherited = snapshot(); inherited.facts.push(wildhammer,frostwolf);
    expect(cultureInput(inherited,'en')).toEqual(cultureInput(base,'en'));
    service.observe({characterId:10,cultureId:100,snapshot:inherited});
    const first = service.backgroundFor(person)!;
    expect(first.startsWith(paragraph)).toBe(true);
    expect(first).toMatch(/gryphon companionship/i);
    expect(first).toMatch(/wolves as companions/i);
    expect(service.backgroundFor(person,false)).toBe(paragraph);
    expect(person.cultureSnapshot!.facts.some(f => f.kind==='lineage')).toBe(false);
    expect(JSON.stringify(person)).not.toContain('wildhammer_outlook');
    service.observe({characterId:10,cultureId:101,snapshot:base});
    expect(service.backgroundFor(person)).toBe(paragraph);
    expect(library.stats()).toEqual({ready:1,pending:0,failed:0});
    await service.tick(); expect(generate).not.toHaveBeenCalled();
    service.forgetCharacter(10); expect(service.backgroundFor(person)).toBeUndefined();
    await service.close();
});
