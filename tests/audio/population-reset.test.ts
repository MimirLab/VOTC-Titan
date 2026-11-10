import fs from 'fs';
import os from 'os';
import path from 'path';
import {app} from 'electron';
import {AudioLibrary} from '../../src/main/audio/AudioLibrary';
import {AudioRuntime,REFERENCE_TEXT} from '../../src/main/audio/AudioRuntime';
import {raceSelections,retiredPopulationReference} from '../../src/main/audio/raceSelections';
import {familyPreset,familyReference,performancePreset} from '../../src/main/audio/familyPerformance';
import {acousticDelivery} from '../../src/main/audio/acousticDelivery';
import {composeVoiceDesign} from '../../src/main/audio/acousticCasting';
import {TUSKARR_DIRECTION} from '../../src/main/audio/tuskarrVoice';
import {pcmToWav} from '../../src/main/audio/pcm';
import {designCharacterVoice} from '../../src/main/audio/voiceDesign';
jest.mock('../../src/main/audio/voiceDesign',()=>({...jest.requireActual('../../src/main/audio/voiceDesign'),designCharacterVoice:jest.fn()}));
let root:string,library:AudioLibrary,runtime:any;
const c=(id:string,sex='male',culture='azerothian')=>({version:'fixture',sourceSha256:'fixture',anatomyId:id,presentation:sex,cultureId:culture,formKey:[id,sex,culture].join('-'),anatomyCore:'Physical voice.',cultureCore:'Learned accent.',explicit:false} as any);
beforeEach(()=>{(app as any).getAppPath=()=>path.resolve('.');root=fs.mkdtempSync(path.join(os.tmpdir(),'titan-population-reset-'));library=new AudioLibrary(root);runtime=Object.create(AudioRuntime.prototype);runtime.store=()=>library;runtime.update=jest.fn();jest.clearAllMocks()});
afterEach(()=>{library.close();fs.rmSync(root,{recursive:true,force:true});jest.restoreAllMocks()});
function retired(id='001',sex='male',culture='azerothian',actor='2'){
    const casting=c(id,sex,culture),p=raceSelections().find(p=>p.anatomyId===id&&p.sex===sex&&p.retirementReason==='population-individual-reset')!,ref=familyReference(p);
    return library.importFamilyReference('world',actor,'Actor',p.speech,JSON.stringify({origin:'race-family-reference-v1',familyVersion:p.reviewVersion,familyKey:p.key,casting}),ref.seed,ref.wav,ref.text,casting.formKey);
}
function individual(casting=c('001'),actor='2'){
    const p=library.save('world',actor,'Actor','An individual voice.',JSON.stringify({version:2,model:'attached',inputHash:'fixture',individual:'A personal vocal grain.',casting}));
    library.bindForm(p,casting.formKey);return library.reference(p,pcmToWav(Buffer.alloc(100)),'Earlier individual words.');
}
test('ordinary humanoid populations have no active shared race reference; historical editions remain addressable',()=>{
    for(const id of ['001','002','003','004','005','006','007','008','012','014','015','029','035','173','190','202'])
        for(const sex of ['male','female'])expect(familyPreset(c(id,sex,id==='012'?'durotaric':id==='015'?'darkspear':'azerothian'))?.mode).not.toBe('reference');
    for(const p of raceSelections().filter(p=>p.retirementReason==='population-individual-reset')){
        expect(performancePreset(p.key,c(p.anatomyId,p.sex,p.cultureId))?.key).toBe(p.key);
        expect(familyReference(p).wav.length).toBeGreaterThan(44);
    }
});
test('all active reference exceptions preserve exact Race, Culture and Sex binding',()=>{
    const allowed=new Set(['013','041','047','159','176','053','177','181','030','036','037','188','193','049']);
    for(const p of raceSelections().filter(p=>p.active!==false&&p.mode==='reference')){
        expect(allowed.has(p.anatomyId)).toBe(true);
        expect(familyPreset(c(p.anatomyId,p.sex,p.cultureId))?.key).toBe(p.key);
        if(p.anatomyId!=='013')expect(familyPreset(c(p.anatomyId,p.sex,'different-culture'))?.key).not.toBe(p.key);
    }
    for(const [id,sex] of [['177','female'],['036','female'],['047','male'],['176','female'],['037','female'],['159','female']])
        expect(familyPreset(c(id,sex))?.mode).not.toBe('reference');
});
test('a retired shared voice restores the same character and form individual once, preserving old plans and WAVs',()=>{
    const original=individual(),shared=retired(),bytes=fs.readFileSync(shared.referenceFile!);
    library.savePlan('world','1','old','digest',{characterVoiceId:shared.id,familyKey:JSON.parse(shared.provenance).familyKey});
    const restored=runtime.familyVoice('world','2','Actor',c('001'),shared);
    expect(restored.id).toBe(original.id);expect(library.get('world','2')?.id).toBe(original.id);expect(library.form('world','2',c('001').formKey)?.id).toBe(original.id);
    expect(runtime.familyVoice('world','2','Actor',c('001'),restored).id).toBe(original.id);
    expect(library.list()).toHaveLength(2);expect(fs.readFileSync(shared.referenceFile!)).toEqual(bytes);
    expect(library.plan('world','1','old')?.characterVoiceId).toBe(shared.id);
});
test('restoration never borrows another character, body, culture or player voice',()=>{
    individual(c('001'),'3');individual(c('012'));individual(c('001','male','gilnean'));
    const custom=library.save('world','2','Custom','Player voice.',JSON.stringify({origin:'player',casting:c('001')}));
    const shared=retired();expect(runtime.familyVoice('world','2','Actor',c('001'),shared)).toBeUndefined();
    expect(runtime.familyVoice('world','2','Actor',c('001'),custom)).toBe(custom);
    expect(retiredPopulationReference({...shared,provenance:JSON.stringify({...JSON.parse(shared.provenance),familyVersion:'unknown'})})).toBeUndefined();
});
test('a new delivery casts one individual with a fresh seed when no earlier identity exists, then persists it',async()=>{
    const shared=retired(),casting=c('001');
    (designCharacterVoice as jest.Mock).mockResolvedValue({instruction:'The new individual voice.',provenance:JSON.stringify({version:2,model:'attached',inputHash:'fixture',individual:'Personal grain.',casting})});
    const speech=jest.fn(async()=>pcmToWav(Buffer.alloc(100))),provider={speech};
    runtime.settings=()=>({});runtime.managed={activeModel:undefined};
    const actor={id:2,fullName:'Actor',shortName:'Actor'};
    const conv={campaignIdentity:{campaignId:'world'},gameData:{playerID:1},config:{userFolderPath:'/fixture'}};
    const job:any={conv,actor,casting,settings:{provider:'breeze',hosting:'external',cfgScale:4},design:{input:{fixture:true}}};
    const p=await runtime.voice(job,false,provider,new AbortController().signal);
    expect(p.id).not.toBe(shared.id);expect(p.seed).not.toBe(shared.seed);expect(p.referenceText).toBe(REFERENCE_TEXT);
    const next=await runtime.voice({...job,characterVoiceId:undefined},false,provider,new AbortController().signal);
    expect(next.id).toBe(p.id);expect(designCharacterVoice).toHaveBeenCalledTimes(1);expect(speech).toHaveBeenCalledTimes(1);
    const historic=await runtime.voice({...job,replay:true,prepareCasting:false,characterVoiceId:shared.id},false,provider,new AbortController().signal);
    expect(historic.id).toBe(shared.id);expect(designCharacterVoice).toHaveBeenCalledTimes(1);
});
test('tuskarr physical resonance is supplied to casting and delivery without touching literal words or narration',()=>{
    const casting={...c('029','female','tuskarr'),body:'creature_tuskarr'},text='Warm yourself beside the fire.';
    expect(composeVoiceDesign(casting,'A gentle personal cadence.')).toContain(TUSKARR_DIRECTION);
    for(const kind of ['speech','thought'] as const){
        const d=acousticDelivery({kind,text,passage:0},'A young adult voice.',{voice:{anatomyId:'029',sex:'female',cultureId:'tuskarr'}});
        expect(d.renderText).toBe(text);expect(d.instruction).toContain(TUSKARR_DIRECTION);
        if(kind==='thought')expect(d.instruction).toContain('Whisper throughout');
    }
    expect(acousticDelivery({kind:'speech',text,passage:0},'',{voice:{anatomyId:'001',body:'creature_tuskarr'}}).instruction).not.toContain(TUSKARR_DIRECTION);
    expect(acousticDelivery({kind:'narration',text,passage:0},'',{voice:{anatomyId:'029'}}).instruction).not.toContain(TUSKARR_DIRECTION);
});
