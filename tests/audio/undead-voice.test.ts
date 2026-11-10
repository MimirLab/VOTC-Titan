import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { castingUndeadCoverage, savedUndeadCoverage, decideUndeadPerformance, undeadDirection,
    undeadCaptureCatalog, undeadCaptureBody, UndeadLogReader, undeadNeutralIndividual, UNDEAD_THROAT_DIRECTION } from '../../src/main/audio/undeadVoice';
import { resolveUndeadVoiceCasting, resolveVoiceCasting } from '../../src/main/audio/acousticCasting';
import { acousticDelivery } from '../../src/main/audio/acousticDelivery';
import { cloneDelivery } from '../../src/main/audio/CloneBanks';
import { bundledCloneCatalog } from '../../src/main/audio/cloneCapture';
import { castingCatalogue } from '../../src/main/audio/castingCatalog';
const profile=(provenance:object={undead:{version:1,reference:'uncolored'}})=>({id:'reference-1',characterId:'2',instruction:'A clear voice.',provenance:JSON.stringify(provenance)} as any);
const catalog=undeadCaptureCatalog({digest:'a'.repeat(64),traitIds:['being_undead','creature_lich','being_demon']})!;
beforeEach(()=>{(app as any).getAppPath=()=>path.resolve('.')});
function frame(reader:UndeadLogReader,inside:string[],id=2,digest=catalog.digest){
    reader.observe(`VOTC:UNDEAD/;/begin/;/${digest}/;/${id}`);
    for(const line of inside)reader.observe(`VOTC:UNDEAD/;/${line}`);
    reader.observe(`VOTC:UNDEAD/;/end/;/${digest}/;/${id}`);
}
test('native physical capture ignores culture, faith, geography, magic aptitude and shared immortality flags',()=>{
    expect(undeadCaptureCatalog()).toBeUndefined();expect(undeadCaptureCatalog({digest:'a',traitIds:['being_demon','immortal']})).toBeUndefined();
    const body=undeadCaptureBody(catalog);
    expect(body).toContain('has_trait = being_undead');expect(body).toContain('has_trait = creature_lich');
    expect(body).not.toMatch(/has_(?:culture|faith)|heritage_|northrend|death_magic|no_aging_penalties|every_.*character|add_trait|set_variable/);
    expect(body).not.toContain('creature_banshee'); // absent native definitions never become predicates
});
test('a complete current frame can gain and lose undeath on the same participant, and save load clears it',()=>{
    const r=new UndeadLogReader(catalog);
    for(const dead of [false,true,false]){frame(r,[`fact/;/undead/;/${dead?1:0}`,'fact/;/specialized/;/0']);expect(r.take(2)).toEqual({undead:dead,specialized:false});expect(r.take(2)).toBeUndefined();}
    frame(r,['fact/;/undead/;/1','fact/;/specialized/;/1']);r.observe('VOTC:CAMPAIGN/;/loaded/;/save');expect(r.take(2)).toBeUndefined();
});
test.each([
    ['fact/;/undead/;/1'],['fact/;/undead/;/1','fact/;/undead/;/0','fact/;/specialized/;/0'],
    ['fact/;/undead/;/true','fact/;/specialized/;/0'],['fact/;/undead/;/1','fact/;/specialized/;/0','other/;/1'],
    ['fact/;/undead/;/1/;/extra','fact/;/specialized/;/0']
].map(inside=>({inside})))('incomplete, duplicate and malformed physical facts cannot authorize a modifier: $inside',({inside})=>{
    const r=new UndeadLogReader(catalog);frame(r,inside);expect(r.take(2)).toBeUndefined();
});
test('wrong digest and mismatched scope never use an older positive frame',()=>{
    const r=new UndeadLogReader(catalog);frame(r,['fact/;/undead/;/1','fact/;/specialized/;/0']);
    frame(r,['fact/;/undead/;/0','fact/;/specialized/;/0'],2,'b'.repeat(64));expect(r.take(2)).toBeUndefined();
    r.observe(`VOTC:UNDEAD/;/begin/;/${catalog.digest}/;/2`);r.observe('VOTC:UNDEAD/;/fact/;/undead/;/1');r.observe('VOTC:UNDEAD/;/fact/;/specialized/;/0');r.observe(`VOTC:UNDEAD/;/end/;/${catalog.digest}/;/3`);expect(r.take(2)).toBeUndefined();
});
test('reviewed anatomy protects already undead references without confusing living grain and accents with necrotic treatment',()=>{
    const c=castingCatalogue();
    for(const id of ['022','081','095','096','099','100','162','177','194'])expect(castingUndeadCoverage({anatomyId:id})).toBe('covered');
    for(const id of ['001','002','015','017','018','021','036','196'])expect(castingUndeadCoverage({anatomyId:id})).toBe('uncolored');
    expect(castingUndeadCoverage({anatomyId:'085'})).toBe('specialized');
    const casting={anatomyId:'022',anatomyCore:c.anatomy['022'].male};
    expect(savedUndeadCoverage({...profile({casting}),instruction:casting.anatomyCore+' Individual grain.'})).toBe('covered');
    expect(savedUndeadCoverage({...profile({casting,origin:'player'}),instruction:'A clear voice.'})).toBe('unknown');
    expect(savedUndeadCoverage(profile({casting:{anatomyId:'015'},individual:'Dry, hollow, grave sounding.'}))).toBe('unknown');
});
test.each(['creature_human','creature_troll','creature_orc','creature_dwarf','creature_night_elf','creature_high_elf','creature_gnome'])('trait-only undeath preserves the established %s reference casting and save rewind restores ordinary casting',body=>{
    const actor={id:2,sex:'male'} as any;
    const snapshot={traitIds:[body],sex:'male',currentBody:body,facts:{}} as any;
    const living=resolveVoiceCasting(actor,{cultureId:''},undefined,snapshot);
    const before=JSON.stringify(snapshot);
    const dead=resolveUndeadVoiceCasting(actor,{cultureId:''},living,snapshot,{undead:true,specialized:false});
    expect(dead.formKey).toBe(living.formKey);expect(dead).toBe(living);expect(JSON.stringify(snapshot)).toBe(before);
    const staleDead={...snapshot,traitIds:[body,'being_undead']};
    expect(resolveUndeadVoiceCasting(actor,{cultureId:''},living,staleDead,{undead:false,specialized:false}).formKey).toBe(living.formKey);
});
test('new undead human anatomy, true lich transformations and explicit Race changes retain their existing casting routes',()=>{
    const actor={id:2,sex:'male'} as any,s={traitIds:['creature_human'],sex:'male',currentBody:'creature_human',facts:{}} as any;
    const living=resolveVoiceCasting(actor,{cultureId:''},undefined,s);
    expect(resolveUndeadVoiceCasting(actor,{cultureId:''},undefined,s,{undead:true,specialized:false}).anatomyId).toBe('022');
    expect(resolveUndeadVoiceCasting(actor,{anatomyId:'010',cultureId:''},living,s,{undead:true,specialized:false}).anatomyId).toBe('010');
    expect(resolveUndeadVoiceCasting(actor,{cultureId:''},living,{...s,traitIds:['creature_lich','being_undead'],currentBody:'creature_lich'},{undead:true,specialized:true}).anatomyId).toBe('100');
});
test('undeath is additive only to a documented uncolored reference; unknowns, specialized bodies and the narrator keep their performance',()=>{
    const p=profile(),facts={undead:true,specialized:false};
    expect(decideUndeadPerformance(p,facts,'uncolored').treatment).toBe('damaged-throat');
    for(const coverage of ['covered','unknown','specialized'] as const)expect(decideUndeadPerformance(p,facts,coverage).treatment).toBe('preserve');
    expect(decideUndeadPerformance(p,{...facts,specialized:true},'uncolored').treatment).toBe('preserve');
    expect(decideUndeadPerformance(p,{...facts,undead:false},'uncolored').treatment).toBe('preserve');
    expect(decideUndeadPerformance({...p,characterId:'__narrator__'},facts,'uncolored').treatment).toBe('preserve');
    expect(decideUndeadPerformance(p,undefined,'uncolored').treatment).toBe('preserve');
});
test('the whisper keeps the same identity, literal words, tone and age without a spoken design paragraph or a second effect',()=>{
    const p=decideUndeadPerformance(profile(),{undead:true,specialized:false},'uncolored');
    expect(undeadDirection(p)).toBe('Speak through a damaged throat with a coarse, scraping rasp.');
    expect(undeadDirection(p,true)).toBe(UNDEAD_THROAT_DIRECTION);
    for(const kind of ['speech','thought'] as const){
        const segment={kind,text:'Grog maen.',passage:0};
        const generated=acousticDelivery(segment,'An older adult.',{undead:p,direction:'Cautious, measured.',voice:{sex:'male',anatomyId:'015'}});
        const cloned=cloneDelivery(segment,'Cautious, measured.',undefined,'older',p);
        for(const delivery of [generated,cloned]){expect(delivery.renderText).toBe(segment.text);expect(delivery.instruction).toContain(undeadDirection(p,kind==='thought'));expect(delivery.instruction).toContain('Cautious');if(kind==='thought')expect(delivery.instruction).toContain('Whisper throughout');}
    }
    expect(acousticDelivery({kind:'narration',text:'The gate opens.',passage:0},'',{undead:p}).instruction).not.toContain('undeath');
    expect(undeadNeutralIndividual('A hollow low voice with natural gravel and a dry rasp.')).toBe(true);
    expect(undeadNeutralIndividual('A grave-worn undead rasp.')).toBe(false);
});
test('every reviewed recording keeps its sealed manifest, while uncertain editions remain unclassified',()=>{
    const c=bundledCloneCatalog()!,review=JSON.parse(fs.readFileSync(path.resolve('docs/audio-undead-reference-review.json'),'utf8'));
    for(const r of review.reviewedReferences){expect(c.profiles[r.key].manifestHash).toBe(r.manifestSha256);expect(c.profiles[r.key].undeadCoverage).toBe(r.coverage);}
    expect(review.reviewedReferences).toHaveLength(419);expect(Object.keys(c.profiles)).toHaveLength(419);
    expect(c.profiles['goa2-10021-hots-thrallbase/v0001'].undeadCoverage).toBe('uncolored');
    expect(c.profiles['goa2-59100-hots-kelthuzadbase/v0001'].undeadCoverage).toBe('covered');
    expect(c.profiles['goa2-60001-wow-selected-5f140c78f6/v0001'].undeadCoverage).toBe('unknown');
});
