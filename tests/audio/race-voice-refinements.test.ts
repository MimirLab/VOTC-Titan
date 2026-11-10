import fs from 'fs';
import os from 'os';
import path from 'path';
import {app} from 'electron';
import {REVIEWED_RACE_REFINEMENTS,reviewedRaceDirection} from '../../src/main/audio/raceVoiceRefinements';
import {acousticDelivery} from '../../src/main/audio/acousticDelivery';
import {castingCatalogue} from '../../src/main/audio/castingCatalog';
import {AudioLibrary} from '../../src/main/audio/AudioLibrary';
import {AudioRuntime} from '../../src/main/audio/AudioRuntime';
import {BreezeProvider} from '../../src/main/audio/BreezeProvider';
import {pcmToWav} from '../../src/main/audio/pcm';
import {normalizeAudio} from '../../src/shared/audio';

beforeEach(()=>{(app as any).getAppPath=()=>path.resolve('.')});
afterEach(()=>jest.restoreAllMocks());
const casting=(r:typeof REVIEWED_RACE_REFINEMENTS[number],cultureId='azerothian')=>({version:'goa2-acoustic-r3.1',sourceSha256:'fixture',anatomyId:r.anatomyId,presentation:r.sex,anatomyCore:r.anatomyCore,cultureCore:'Keep this learned accent.',cultureId,formKey:'fixture'} as any);
const profile=(c:any,origin?:string)=>({id:'individual',campaign:'world',characterId:'2',label:'A person',revision:1,instruction:'Personal casting.',seed:17,createdAt:'fixture',provenance:JSON.stringify({version:2,model:'attached',inputHash:'fixture',individual:'An individual grain.',casting:c,...(origin?{origin}: {})})});

test.each(REVIEWED_RACE_REFINEMENTS)('$anatomyId $sex reviewed direction belongs only to its exact newly cast physical reference',r=>{
    const c=casting(r),p=profile(c),original=JSON.stringify(p);
    expect(castingCatalogue().anatomy[r.anatomyId][r.sex]).toBe(r.anatomyCore);
    expect(reviewedRaceDirection(p,c)).toBe(r.delivery);
    expect(reviewedRaceDirection(p,{...c,cultureId:'a-different-upbringing'})).toBe(r.delivery);
    expect(JSON.stringify(p)).toBe(original);
    const old={...c,anatomyCore:'The older physical core.'};
    expect(reviewedRaceDirection(profile(old),c)).toBeUndefined();
    expect(reviewedRaceDirection(p,old)).toBeUndefined();
});
test('only the five approved Race/Sex directions are promoted; male Dwarf and qualified Furbolg remain untouched',()=>{
    expect(REVIEWED_RACE_REFINEMENTS.map(r=>r.anatomyId+'/'+r.sex).sort()).toEqual(['002/female','035/female','035/male','040/female','040/male']);
    for(const [anatomyId,presentation] of [['002','male'],['027','male'],['027','female'],['028','male'],['031','female']]){
        const c={...casting(REVIEWED_RACE_REFINEMENTS[0]),anatomyId,presentation};expect(reviewedRaceDirection(profile(c),c)).toBeUndefined();
    }
});
test('player-authored voices, narrator, clones and ambiguous provenance receive no new racial direction',()=>{
    const c=casting(REVIEWED_RACE_REFINEMENTS[0]),p=profile(c);
    expect(reviewedRaceDirection(profile(c,'player'),c)).toBeUndefined();
    expect(reviewedRaceDirection({...p,characterId:'__narrator__'},c)).toBeUndefined();
    for(const provenance of ['Player-authored voice instruction v1','{',JSON.stringify({origin:'clone-bank-v1',casting:c}),JSON.stringify({version:2,casting:c})])
        expect(reviewedRaceDirection({...p,provenance},c)).toBeUndefined();
    expect(reviewedRaceDirection(undefined,c)).toBeUndefined();
});
test.each(['speech','thought'] as const)('%s retains literal words, current age, undeath and whisper behavior alongside physical direction',kind=>{
    const r=REVIEWED_RACE_REFINEMENTS[0],c=casting(r),text='There is room beside the fire.';
    const d=acousticDelivery({kind,text,passage:0},'A youthful adult voice.',{voice:{anatomyId:c.anatomyId,sex:c.presentation},reviewedRaceDirection:reviewedRaceDirection(profile(c),c),undead:{version:1,voiceId:'individual',treatment:'damaged-throat',reason:'newly-undead'} as any});
    expect(d.renderText).toBe(text);expect(d.instruction).toContain('A youthful adult voice.');expect(d.instruction).toContain(r.delivery);expect(d.instruction).toContain('damaged throat');
    if(kind==='thought')expect(d.instruction).toContain('Whisper throughout');
});
test('narration ignores racial refinement metadata',()=>{
    const r=REVIEWED_RACE_REFINEMENTS[0];expect(acousticDelivery({kind:'narration',text:'The fire fades.',passage:0},'',{reviewedRaceDirection:r.delivery}).instruction).not.toContain(r.delivery);
});
test('actual Audio preview reuses the personal reference and delivers the approved concise direction',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'titan-refined-race-')),lib=new AudioLibrary(path.join(root,'library'));
    const settings=normalizeAudio({enabled:true,hosting:'external',endpoint:'http://127.0.0.1:9',narrator:false,thoughts:true});
    const runtime:any=new AudioRuntime(root,()=>settings,()=>{});runtime.store=()=>lib;
    try{
        const r=REVIEWED_RACE_REFINEMENTS.find(r=>r.anatomyId==='035'&&r.sex==='male')!,c=casting(r),p=profile(c);
        let saved=lib.save('world','2','Person',p.instruction,p.provenance,false,17);saved=lib.reference(saved,pcmToWav(Buffer.alloc(200)),'Saved personal identity.');
        const bytes=fs.readFileSync(saved.referenceFile!),speech=jest.spyOn(BreezeProvider.prototype,'speech').mockResolvedValue(pcmToWav(Buffer.alloc(200)));
        await runtime.previewVoice(saved.id,undefined,'Put the meat by the fire.');
        expect(speech).toHaveBeenCalledTimes(1);expect(speech.mock.calls[0][0]).toBe('Put the meat by the fire.');expect(speech.mock.calls[0][1]).toContain(r.delivery);
        expect(speech.mock.calls[0][2].id).toBe(saved.id);expect(fs.readFileSync(saved.referenceFile!)).toEqual(bytes);expect(lib.list()).toHaveLength(1);
    }finally{runtime.shutdown();lib.close();fs.rmSync(root,{recursive:true,force:true})}
});
