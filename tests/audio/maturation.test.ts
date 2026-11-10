import { childhoodDirection, maturationCaptureBody, MATURATION_DIGEST, MaturationLogReader, maturityFromAge, recordedChildhood } from '../../src/main/audio/maturation';
import { cloneAgeBand } from '../../src/main/audio/cloneAge';
import { encounterScript } from '../../src/main/background/EncounterCapture';
test.each([[0,'young-child'],[5,'young-child'],[6,'child'],[12,'child'],[13,'adolescent'],[15,'adolescent'],[16,'youthful-adult'],[17,'youthful-adult'],[18,'youthful-adult'],[19,'youthful-adult'],[20,'adult'],[80,'adult'],[NaN,undefined],[-1,undefined]])('offline age %s has stage %s', (age,stage)=>{
    expect(maturityFromAge(age as number)).toBe(stage);
});
test('native stage is independent of chronological estimates and lifespan exemptions',()=>{
    for(const facts of [undefined,{ageless:true,longLived:false},{ageless:false,longLived:true}]){
        expect(cloneAgeBand(1000,facts,'child')).toBe('child');
        expect(cloneAgeBand(NaN,facts,'adolescent')).toBe('adolescent');
        expect(cloneAgeBand(8,facts,'adult')).toBeUndefined();
    }
    for(const s of ['young-child','child','adolescent'] as const) expect(recordedChildhood(childhoodDirection(s))).toBe(s);
    expect(recordedChildhood('A child, with a natural child\'s voice.')).toBeUndefined();
});
function frame(r:MaturationLogReader,id=2,stage='child',digest=MATURATION_DIGEST){
    r.observe(`VOTC:MATURITY/;/begin/;/${digest}/;/${id}`);r.observe(`VOTC:MATURITY/;/stage/;/${stage}`);r.observe(`VOTC:MATURITY/;/end/;/${digest}/;/${id}`);
}
test('native capture uses education and adulthood in only the exported scope, without adding RP capture',()=>{
    const body=maturationCaptureBody();expect(body).toContain('is_adult = yes');expect(body).toContain('age >= childhood_education_start_age');
    expect(body).not.toMatch(/every_(?:living_)?character\s*=|set_variable|create_character/);
    const script=encounterScript({maturation:true},[{characterId:2,position:1}],'a'.repeat(24));expect(script).toContain(body);
    expect(script).not.toMatch(/VOTC:GOA|VOTC:CULTURE|VOTC:CLONE|VOTC:LANGUAGE/);
});
test('maturity frames are complete, consumed once and cannot reuse wrong, duplicate or prior-campaign stages',()=>{
    const r=new MaturationLogReader();frame(r);expect(r.take(2)).toBe('child');expect(r.take(2)).toBeUndefined();
    frame(r,2,'adult','b'.repeat(64));expect(r.take(2)).toBeUndefined();
    frame(r,2,'female old goblin');expect(r.take(2)).toBeUndefined();
    r.observe(`VOTC:MATURITY/;/begin/;/${MATURATION_DIGEST}/;/2`);r.observe('VOTC:MATURITY/;/stage/;/child');r.observe('VOTC:MATURITY/;/stage/;/adult');r.observe(`VOTC:MATURITY/;/end/;/${MATURATION_DIGEST}/;/2`);expect(r.take(2)).toBeUndefined();
    frame(r,3,'adult');expect(r.take(2)).toBeUndefined();expect(r.take(3)).toBe('adult');
    frame(r);r.observe('VOTC:CAMPAIGN/;/loaded/;/new');expect(r.take(2)).toBeUndefined();
});
