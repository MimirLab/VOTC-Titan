import fs from 'fs';
import os from 'os';
import path from 'path';
import { AudioLibrary } from '../../src/main/audio/AudioLibrary';
import { personalityHash, observedVoiceTraits, automaticIndividual } from '../../src/main/audio/voiceDevelopment';
import { MaturationLogReader, MATURATION_DIGEST, maturityFromAge, childhoodDirection, YOUTHFUL_DIRECTION } from '../../src/main/audio/maturation';
import { cloneAgeBand, cloneAgeInstruction } from '../../src/main/audio/cloneAge';
import { pcmToWav } from '../../src/main/audio/pcm';
test('youthful adult delivery continues through nineteen and never creates a new child stage',()=>{
    for(const age of [16,17,18,19]){
        expect(maturityFromAge(age)).toBe('youthful-adult');
        expect(cloneAgeInstruction(cloneAgeBand(age,undefined,'youthful-adult'))).toBe(YOUTHFUL_DIRECTION);
    }
    expect(maturityFromAge(20)).toBe('adult');expect(cloneAgeBand(20,undefined,'adult')).toBeUndefined();
});
test('only observed childhood/personality traits change the speaking-habits signature',()=>{
    const traits=[{category:'Childhood Trait',name:'Curious'},{category:'Personality Trait',name:'Brave'},{category:'Health Trait',name:'Wounded'}];
    const a=observedVoiceTraits({traits} as any);expect(a.map(t=>t.name)).toEqual(['Curious','Brave']);
    expect(personalityHash(a)).toBe(personalityHash([...a].reverse()));expect(personalityHash(a)).toBe(personalityHash([...a,...a]));
    expect(personalityHash(a)).not.toBe(personalityHash([{category:'childhood',name:'Rowdy'}]));
});
function frame(r:MaturationLogReader,traits=true){
    r.observe(`VOTC:MATURITY/;/begin/;/${MATURATION_DIGEST}/;/2`);r.observe('VOTC:MATURITY/;/stage/;/youthful-adult');
    if(traits)for(const category of ['personality','childhood']){
        r.observe(`VOTC:MATURITY/;/traits_begin/;/${category}`);
        if(category==='personality')r.observe('VOTC:MATURITY/;/trait/;/personality/;/Brave');
        r.observe(`VOTC:MATURITY/;/traits_end/;/${category}`);
    }
    r.observe(`VOTC:MATURITY/;/end/;/${MATURATION_DIGEST}/;/2`);
}
test('a complete native frame supplies current personality independently of stale encounter traits',()=>{
    const r=new MaturationLogReader(true);frame(r,false);expect(r.takeFrame(2)).toBeUndefined();frame(r);
    expect(r.takeFrame(2)).toEqual({stage:'youthful-adult',traits:[{category:'personality',name:'Brave'}]});expect(r.takeFrame(2)).toBeUndefined();
    r.observe(`VOTC:MATURITY/;/begin/;/${MATURATION_DIGEST}/;/2`);r.observe('VOTC:MATURITY/;/stage/;/child');r.observe('VOTC:MATURITY/;/traits_begin/;/childhood');r.observe('VOTC:MATURITY/;/trait/;/personality/;/Brave');r.observe('VOTC:MATURITY/;/traits_end/;/childhood');r.observe(`VOTC:MATURITY/;/end/;/${MATURATION_DIGEST}/;/2`);expect(r.takeFrame(2)).toBeUndefined();
});
test('adult publication is atomic, preserves the original reference/seed and is reused after restart',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'titan-development-'));let db=new AudioLibrary(root);
    try{
        let source=db.save('campaign','2','Speaker','An individual fixture voice.','synthetic');source=db.reference(source,pcmToWav(Buffer.alloc(100)),'Original words.');
        expect(db.heardAsChild(source)).toBe(false);db.savePlan('campaign','1','old-child','digest',{characterVoiceId:source.id,age:childhoodDirection('child')});expect(db.heardAsChild(source)).toBe(true);
        const bytes=fs.readFileSync(source.referenceFile!),hash=personalityHash([]);db.saveDevelopment(source,{phase:'provisional',personalityHash:hash,style:'Speak with exploratory phrasing.'});
        expect(()=>db.finalizeAdult(source,'Adult fixture.','synthetic',Buffer.alloc(0),'Adult words.',undefined,hash)).toThrow();expect(db.list()).toHaveLength(1);expect(db.get('campaign','2')!.id).toBe(source.id);expect(db.development(source)!.adultVoiceId).toBeUndefined();
        const adult=db.finalizeAdult(source,'Adult fixture.','synthetic',pcmToWav(Buffer.alloc(200)),'Adult words.',undefined,hash,'form');
        expect(adult.id).not.toBe(source.id);expect(adult.seed).toBe(source.seed);expect(fs.readFileSync(source.referenceFile!)).toEqual(bytes);expect(db.form('campaign','2','form')!.id).toBe(adult.id);
        db.close();db=new AudioLibrary(root);expect(db.development(source)!.adultVoiceId).toBe(adult.id);
        expect(db.finalizeAdult(source,'Unused.','synthetic',pcmToWav(Buffer.alloc(300)),'Unused.',undefined,hash).id).toBe(adult.id);expect(db.list()).toHaveLength(2);
        db.delete(source.id);expect(db.byId(adult.id)).toBeTruthy();expect(db.development(source)).toBeUndefined();
    }finally{db.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('explicit player voices, narrator and reference clones cannot enter automatic redesign',()=>{
    for(const provenance of ['Player-authored voice instruction v1',JSON.stringify({version:2,origin:'player',individual:'saved'}),JSON.stringify({origin:'clone-bank-v1'})])expect(automaticIndividual({provenance} as any)).toBe(false);
    expect(automaticIndividual({provenance:JSON.stringify({version:2,model:'attached',inputHash:'a',individual:'grain'})} as any)).toBe(true);
});
