import fs from 'fs';
import os from 'os';
import path from 'path';
import {app} from 'electron';
import {AudioRuntime} from '../../src/main/audio/AudioRuntime';
import {AudioLibrary} from '../../src/main/audio/AudioLibrary';
import {CloneBanks} from '../../src/main/audio/CloneBanks';
import {BUNDLED_CLONES,bundledCloneCatalog} from '../../src/main/audio/cloneCapture';
import {familyPreset} from '../../src/main/audio/familyPerformance';
import {reviewedRaceReferenceCoverage,raceSelections} from '../../src/main/audio/raceSelections';
import {acousticDelivery} from '../../src/main/audio/acousticDelivery';
import {UNDEAD_THROAT_DIRECTION} from '../../src/main/audio/undeadVoice';

let temporary:string,library:AudioLibrary,runtime:any;
const c=(anatomyId:string,presentation:string,cultureId:string)=>({version:'fixture',formKey:[anatomyId,presentation,cultureId].join('-'),anatomyId,presentation,cultureId,anatomyCore:'Physical identity.',cultureCore:'Learned accent.'} as any);
beforeEach(()=>{
    (app as any).getAppPath=()=>path.resolve('.');
    temporary=fs.mkdtempSync(path.join(os.tmpdir(),'titan-reference-coverage-'));
    library=new AudioLibrary(temporary);runtime=Object.create(AudioRuntime.prototype);runtime.store=()=>library;
});
afterEach(()=>{library.close();fs.rmSync(temporary,{recursive:true,force:true});jest.restoreAllMocks()});
function selected(id:string,sex:string,culture:string){
    const casting=c(id,sex,culture),preset=raceSelections().find(p=>p.anatomyId===id&&p.sex===sex&&p.cultureId===culture&&p.mode==='reference')!;
    // Exact r27 editions remain valid historical references after route retirement.
    const wav=fs.readFileSync(path.join(process.cwd(),'public/audio/race-selections',preset.referenceFile!));
    return library.importFamilyReference('fixture',id+sex,'Synthetic actor',preset.speech,JSON.stringify({origin:'race-family-reference-v1',familyVersion:preset.reviewVersion,familyKey:preset.key,casting}),preset.seed!,wav,preset.referenceText!,casting.formKey);
}

test.each([['001','male','azerothian'],['012','female','durotaric']])('reviewed living source %s retains transformation eligibility in a generic shared reference', (id,sex,culture)=>{
    const p=selected(id,sex,culture);
    expect(reviewedRaceReferenceCoverage(p)).toBe('uncolored');
    expect(runtime.undeadPerformance(p,{undead:true,specialized:false})).toMatchObject({treatment:'damaged-throat',reason:'uncolored-reference'});
    expect(runtime.undeadPerformance(p,{undead:false,specialized:false})).toMatchObject({treatment:'preserve',reason:'currently-living'});
    expect(runtime.referenceAge(p)).toBeUndefined();
});

test('the inherited exception adds the exact approved rasp once and preserves the same-source whisper path',()=>{
    const p=selected('001','male','azerothian'),casting=JSON.parse(p.provenance).casting,preset=raceSelections().find(s=>s.key===JSON.parse(p.provenance).familyKey)!;
    const undead=runtime.undeadPerformance(p,{undead:true,specialized:false});
    for(const kind of ['speech','thought'] as const){
        const d=acousticDelivery({kind,text:'Stay beside the fire.',passage:0},'An elderly voice, naturally aged.',{familyKey:preset.key,undead,voice:{anatomyId:'001',cultureId:'azerothian',sex:'male'}});
        expect(d.instruction.split(UNDEAD_THROAT_DIRECTION)).toHaveLength(2);
        expect(d.instruction).not.toContain('elderly');expect(d.renderText).toBe('Stay beside the fire.');
        if(kind==='thought')expect(d.instruction).toContain('Whisper throughout');
    }
});

test.each([['012','male','durotaric'],['035','male','ogre'],['015','female','darkspear'],['041','male','gnoll'],['041','female','gnoll']])('uncertain source %s/%s remains unchanged', (id,sex,culture)=>{
    const p=selected(id,sex,culture);expect(reviewedRaceReferenceCoverage(p)).toBe('unknown');
    expect(runtime.undeadPerformance(p,{undead:true,specialized:false})).toMatchObject({treatment:'preserve',reason:'reference-treatment-unknown'});
});

test('a source-key collision or edited private reference never inherits reviewed treatment',()=>{
    const p=selected('001','male','azerothian');const body=JSON.parse(p.provenance);
    expect(reviewedRaceReferenceCoverage({...p,provenance:JSON.stringify({...body,origin:'player'})})).toBe('unknown');
    expect(reviewedRaceReferenceCoverage({...p,referenceText:'Different reference words.'})).toBe('unknown');
    expect(reviewedRaceReferenceCoverage({...p,provenance:JSON.stringify({...body,familyVersion:'different-edition'})})).toBe('unknown');
    const bytes=fs.readFileSync(p.referenceFile!);bytes[bytes.length-1]^=1;fs.writeFileSync(p.referenceFile!,bytes);
    expect(reviewedRaceReferenceCoverage(p)).toBe('unknown');
});

test('a covered original edition remains protected even for a generic body with no corpse description',()=>{
    const key='goa2-59100-hots-kelthuzadbase/v0001',bank=new CloneBanks(BUNDLED_CLONES).load(key);
    const casting=c('001','male','azerothian'),entry={...raceSelections().find(p=>p.anatomyId==='001'&&p.mode==='reference')!,
        key:'race-review-covered-fixture',reviewVersion:'covered-fixture',sourceBank:{key,manifestHash:bundledCloneCatalog()!.profiles[key].manifestHash},referenceSha256:bank.audioHash};
    const folder=path.join(temporary,'application/public/audio/race-selections');fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({version:1,canonicalClonesExcluded:true,entries:[entry]}));
    (app as any).getAppPath=()=>path.join(temporary,'application');
    let p=library.save('fixture','covered','Synthetic actor','Speak aloud naturally.',JSON.stringify({origin:'race-family-reference-v1',familyVersion:entry.reviewVersion,familyKey:entry.key,casting}));
    p=library.reference(p,bank.wav,bank.text.trim());expect(reviewedRaceReferenceCoverage(p)).toBe('covered');
    expect(runtime.undeadPerformance(p,{undead:true,specialized:false})).toMatchObject({treatment:'preserve',reason:'reference-already-undead'});
    entry.sourceBank.manifestHash='0'.repeat(64);fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({version:1,canonicalClonesExcluded:true,entries:[entry]}));
    expect(reviewedRaceReferenceCoverage(p)).toBe('unknown');
});
