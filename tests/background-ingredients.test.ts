import { BackgroundIngredientBank, getBackgroundIngredients } from '../src/main/background/backgroundIngredients';
import * as combine from '../src/main/background/backgroundIngredients';
import { conceptDefinitionHash } from '../src/main/background/authoredConceptBank';
import { sha256Hex } from '../src/main/promptWorkbench/canonicalJson';
import { CultureSnapshot } from '../src/shared/gameData/CultureSnapshot';
import { FaithSnapshot } from '../src/shared/gameData/FaithSnapshot';
import { passagePlan, renderExtraction } from '../src/main/background/sourceReference';
import { cultureSourceId } from '../src/main/culture/cultureEvidence';

function fixture(domain: 'culture' | 'faith', grouped = true) {
    const concepts = ['primary', 'partner'].map(key => ({kind: domain === 'culture' ? 'tradition' : 'doctrine',
        ...(domain === 'culture' ? {category: 'societal'} : {}), key: domain === 'culture' ? key : 'tenet_' + key,
        name: 'NATIVE_LABEL_' + key, description: 'NATIVE_REAL_WORLD_PROSE_' + key,
        rules: domain === 'culture' || !grouped ? '{}' : JSON.stringify({definitions: [{key: 'group_rules', value: [{key: 'category', value: 'core_tenets'}]}]})}));
    const plain = (kind: string, key: string, description = '') => ({kind, key, name: key, description, rules: ''});
    const snapshot = (domain === 'culture' ? {version: 2, complete: true, facts: [
        ...['ethos','heritage','language','martial_custom','head_determination'].map(category => ({...plain('pillar', category), category})),
        {...plain('naming','names'),category:''}, {...plain('era','era'),category:''}, ...concepts
    ]} : {version: 1, complete: true, facts: [plain('religion','religion'),plain('family','family'),
        plain('description','faith','The community values careful service.'),plain('description','religion','Inherited accounts favor patient counsel.'),...concepts]}) as CultureSnapshot | FaithSnapshot;
    const descriptions = ['Careful public service earns recognition without assigning an office.',
        'Learned counsel can guide public decisions without establishing personal training.'];
    const entries = concepts.map((fact, i) => ({domain, key: fact.key, definitionHash: conceptDefinitionHash(domain, fact as any),
        status:'authored', label: i ? 'Learned Counsel' : 'Public Service', description: descriptions[i], tags: [], rationale:'Reviewed synthetic concept.'}));
    const essentials = entries.map(e => ({domain, key:e.key, definitionHash:e.definitionHash, readingId:null,
        richDescriptionHash:sha256Hex(e.description),text:e.description,rationale:'Reviewed synthetic compact meaning.'}));
    const composition = {id:'service_and_counsel',domain,members:essentials.map(e => ({key:e.key,definitionHash:e.definitionHash,
        readingId:null,richDescriptionHash:e.richDescriptionHash,essentialTextHash:sha256Hex(e.text)})),
        text:'Careful public service and learned counsel have distinct claims to recognition; neither assigns this member an office or training.',rationale:'Complete two-contributor union.'};
    const assets={authored:{version:1,entries},essential:{version:1,entries:essentials},
        compositions:{version:1,compositions:[composition]},relationships:{version:1,accounts:[],roots:[]}};
    return {snapshot,concepts,assets,composition,bank:new BackgroundIngredientBank(assets)};
}

test.each(['culture','faith'] as const)('%s projection washes all native concept prose and preserves a complete union', domain => {
    const f=fixture(domain),before=JSON.stringify(f.snapshot);
    const view=domain==='culture'?f.bank.project(domain,f.snapshot as CultureSnapshot):f.bank.project(domain,f.snapshot as FaithSnapshot);
    expect(JSON.stringify(view)).not.toMatch(/NATIVE_LABEL|NATIVE_REAL_WORLD_PROSE/);
    const spy=jest.spyOn(combine,'combineIngredientPassages').mockImplementation((d,s,p)=>f.bank.combine(d,s,p));
    try {
        const plan=passagePlan(domain,view),result=renderExtraction(domain,view,{selections:[]});
        expect(result.paragraph).toContain(f.composition.text);
        for(const fact of f.concepts) {
            const source=domain==='culture'?cultureSourceId(fact as any):'doctrine:'+fact.key;
            expect(result.notes.some(n=>n.sources.includes(source))).toBe(true);
        }
        expect(plan.passages.filter(p=>p.text.includes(f.composition.text))).toHaveLength(1);
        expect(JSON.stringify(f.snapshot)).toBe(before);
        view.facts[0].description+=' Changed outside projection.';
        expect(()=>passagePlan(domain,view)).toThrow('Changed ingredient projection');
    } finally {spy.mockRestore();}
});

test('reviewed tenet keys without group metadata retain every required contributor', () => {
    const f = fixture('faith', false), view = f.bank.project('faith', f.snapshot as FaithSnapshot);
    const spy = jest.spyOn(combine, 'combineIngredientPassages').mockImplementation((d,s,p) => f.bank.combine(d,s,p));
    try {
        const plan = passagePlan('faith', view), result = renderExtraction('faith', view, {selections: []});
        expect(result.paragraph).toContain(f.composition.text);
        for (const fact of f.concepts) {
            const source = 'doctrine:' + fact.key;
            expect(plan.passages.some(p => p.required && (p.source === source || p.contributors?.includes(source)))).toBe(true);
            expect(result.notes.some(n => n.sources.includes(source))).toBe(true);
        }
        expect(result.paragraph).not.toContain('NATIVE_REAL_WORLD_PROSE');
    } finally { spy.mockRestore(); }
});

test.each(['culture','faith'] as const)('%s unknown or redefined concepts hold instead of restoring native prose',domain=>{
    const f=fixture(domain),missing=structuredClone(f.snapshot),changed=structuredClone(f.snapshot);
    missing.facts.push({...f.concepts[0],key:domain==='culture'?'unknown':'tenet_unknown'} as any);
    changed.facts.find(x=>x.key===f.concepts[0].key)!.description+=' Changed native definition.';
    for(const s of [missing,changed]) {
        expect(f.bank.revision(domain,s)).toMatch(/^[a-f0-9]{64}$/);
        expect(()=>domain==='culture'?f.bank.project(domain,s as CultureSnapshot):f.bank.project(domain,s as FaithSnapshot)).toThrow();
    }
});

test.each(['culture','faith'] as const)('%s selected meaning changes revise identity; unrelated/editorial changes do not',domain=>{
    const f=fixture(domain),original=f.bank.revision(domain,f.snapshot),edited=structuredClone(f.assets);
    edited.authored.entries[0].rationale+=' Editorial note.';
    edited.compositions.compositions[0].rationale+=' Editorial note.';
    expect(new BackgroundIngredientBank(edited).revision(domain,f.snapshot)).toBe(original);
    edited.compositions.compositions[0].text+=' This shared value remains secondary.';
    expect(new BackgroundIngredientBank(edited).revision(domain,f.snapshot)).not.toBe(original);
    const removed=structuredClone(f.snapshot);removed.facts=removed.facts.filter(x=>x.key!==f.concepts[1].key) as any;
    const view=domain==='culture'?f.bank.project(domain,removed as CultureSnapshot):f.bank.project(domain,removed as FaithSnapshot);
    expect(f.bank.combine(domain,view,[])).toEqual([]);
    expect(f.bank.revision(domain,removed)).not.toBe(original);
});

test('the actual bundled production ingredient assets load without test fixture substitution',()=>{
    const bank=getBackgroundIngredients();
    expect(bank).toBeInstanceOf(BackgroundIngredientBank);
    const fs=require('node:fs'),path=require('node:path');
    const root=path.join(process.cwd(),'public/backgroundConcepts/recipe');
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
    for(const [name,hash] of Object.entries(manifest.files))expect(sha256Hex(fs.readFileSync(path.join(root,name)))).toBe(hash);
    expect(manifest.richConditionals).toBe(365);expect(manifest.essentialReadings).toBe(621);
    expect(manifest.baseEntries).toBe(270);
    expect(manifest.compositions).toBe(31);
});
