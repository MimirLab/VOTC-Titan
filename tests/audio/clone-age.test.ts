import { ageBeyondReference, cloneAgeBand, cloneAgeInstruction, recordedCloneAge } from '../../src/main/audio/cloneAge';
import { cloneDelivery } from '../../src/main/audio/CloneBanks';
import { CloneLogReader, CLONE_FORM_TRAITS, cloneCaptureBody, withCloneAging } from '../../src/main/audio/cloneCapture';
const mortal={ageless:false,longLived:false};
test.each([[54,undefined],[55,'older'],[69,'older'],[70,'elderly'],[110,'elderly'],[NaN,undefined],[-1,undefined]])('mortal clone age %s uses %s without a new identity', (years,band)=>{
    expect(cloneAgeBand(years as number,mortal,undefined,'adult')).toBe(band);
});
test.each([undefined,{ageless:true,longLived:false},{ageless:false,longLived:true},{ageless:true,longLived:true}])('unverified, immortal and slow-aging bodies suppress chronological clone aging: %j', facts=>{
    expect(cloneAgeBand(1500,facts)).toBeUndefined();
});
test('only explicit new age performances are recognized on replay, never previously ignored age text',()=>{
    for(const band of ['older','elderly'] as const) {
        expect(recordedCloneAge(cloneAgeInstruction(band))).toBe(band);
        const s={kind:'thought' as const,text:'They must not hear my doubts.',passage:0};
        const d=cloneDelivery(s,'calm','dreadlord',band);expect(d.renderText).toBe(s.text);
        expect(d.instruction).toContain(cloneAgeInstruction(band));expect(d.instruction).toContain('Whisper throughout');
    }
    for(const old of ['An elderly voice, naturally aged, without caricature.','A mature adult voice.','', 'old female goblin British'])expect(recordedCloneAge(old)).toBeUndefined();
});
const base={digest:'a'.repeat(64),ids:['10021'],voices:{version:1 as const,profiles:{},identities:{},history:{}}};
test('aging uses a digest-bound effective lifespan list and read-only native participant predicates',()=>{
    const c=withCloneAging(base,{digest:'b'.repeat(64),longLivedIds:['creature_elf','blood_long_life']});
    expect(c.digest).not.toBe(base.digest);expect(withCloneAging(base)).toBe(base);
    expect(withCloneAging(base,{digest:'c'.repeat(64),longLivedIds:[]}).digest).not.toBe(c.digest);
    const script=cloneCaptureBody(c);expect(script).toContain('has_trait = immortal');expect(script).toContain('has_trait_with_flag = no_aging_penalties');
    expect(script).toContain('has_trait = blood_long_life');expect(script).not.toMatch(/every_.*character|set_variable|create_character/);
    expect(()=>cloneCaptureBody({...c,agingTraitIds:['bad }']})).toThrow();
});
function frame(r:CloneLogReader,c:typeof base,flags?:[string,string][],actor=2){
    r.observe(`VOTC:CLONE/;/begin/;/${c.digest}/;/${actor}`);r.observe('VOTC:CLONE/;/match/;/10021');
    for(const t of CLONE_FORM_TRAITS)r.observe(`VOTC:CLONE/;/form/;/${t}/;/0`);
    for(const [k,v] of flags??[])r.observe(`VOTC:CLONE/;/aging/;/${k}/;/${v}`);
    r.observe(`VOTC:CLONE/;/end/;/${c.digest}/;/${actor}`);
}
test('complete false lifespan facts authorize aging; partial, duplicate, invalid and stale frames cannot',()=>{
    const c=withCloneAging(base,{digest:'b'.repeat(64),longLivedIds:[]}),r=new CloneLogReader(c);
    frame(r,c,[['ageless','0'],['longLived','0']]);expect(r.snapshot(2)?.aging).toEqual(mortal);
    for(const flags of [[['ageless','0']],[['ageless','0'],['longLived','0'],['longLived','1']],[['ageless','maybe'],['longLived','0']]]){
        frame(r,c,flags as [string,string][]);expect(r.snapshot(2)).toBeUndefined();
    }
    frame(r,c,[['ageless','1'],['longLived','0']]);expect(cloneAgeBand(70,r.snapshot(2)?.aging)).toBeUndefined();
    frame(r,c,[['ageless','0'],['longLived','1']]);expect(cloneAgeBand(70,r.snapshot(2)?.aging)).toBeUndefined();
    frame(r,c,[['ageless','0'],['longLived','0']],3);expect(r.snapshot(3)?.aging).toEqual(mortal);
    r.observe('VOTC:CAMPAIGN/;/loaded/;/new');expect(r.snapshot(3)).toBeUndefined();
});

test('age delivery is relative to the recorded portrayal, with uncertain sources preserved',()=>{
    expect(cloneAgeBand(70,mortal,'adult')).toBeUndefined();
    expect(cloneAgeBand(55,mortal,'adult','adult')).toBe('older');
    expect(cloneAgeBand(55,mortal,'adult','older')).toBeUndefined();
    expect(cloneAgeBand(70,mortal,'adult','elderly')).toBeUndefined();
    expect(cloneAgeBand(70,mortal,'adult','older')).toBe('elderly');
    expect(ageBeyondReference('older',undefined)).toBeUndefined();
    expect(ageBeyondReference('elderly','elderly')).toBeUndefined();
    expect(ageBeyondReference('child',undefined)).toBe('child');
    expect(ageBeyondReference('youthful-adult',undefined)).toBe('youthful-adult');
});
