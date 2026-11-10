import fs from 'fs';
import os from 'os';
import path from 'path';
import {app} from 'electron';
import {createHash} from 'crypto';
import {raceSelections,raceReferencePreset} from '../../src/main/audio/raceSelections';
import {familyPreset,familyReference,familyDelivery,selectedFamilyPreset} from '../../src/main/audio/familyPerformance';
import {acousticDelivery} from '../../src/main/audio/acousticDelivery';
import {AudioRuntime} from '../../src/main/audio/AudioRuntime';
import {AudioLibrary} from '../../src/main/audio/AudioLibrary';
import {readCloneBank} from '../../src/main/audio/CloneBanks';
import {cloneFixture} from './clone-fixture';
import {pcmToWav} from '../../src/main/audio/pcm';
let root:string,library:AudioLibrary;
beforeEach(()=>{(app as any).getAppPath=()=>path.resolve('.');root=fs.mkdtempSync(path.join(os.tmpdir(),'titan-race-choice-'));library=new AudioLibrary(root)});
afterEach(()=>{library.close();fs.rmSync(root,{recursive:true,force:true});jest.restoreAllMocks()});
const casting=(id:string,sex:string,cultureId:string)=>({version:'fixture',formKey:[id,sex,cultureId].join('-'),anatomyId:id,presentation:sex,cultureId,anatomyCore:'Physical identity.',cultureCore:'Learned accent.'} as any);
test('reviewed references and inactive historical editions remain durable production assets',()=>{
    expect(raceSelections().filter(p=>p.mode==='reference'&&p.active!==false)).toHaveLength(20);
    expect(raceSelections().filter(p=>p.mode==='reference'&&p.active===false)).toHaveLength(7);
    for(const p of raceSelections().filter(p=>p.mode==='reference')){
        expect(createHash('sha256').update(familyReference(p).wav).digest('hex')).toBe(p.referenceSha256);
        expect(familyReference(p).text).toBe(p.referenceText);
    }
    for(const p of raceSelections().filter(p=>p.mode==='individual'))expect(raceReferencePreset(casting(p.anatomyId,p.sex,p.cultureId))).toBeUndefined();
});
test('reviewed Race, Culture and Sex all match; hybrid or unreviewed groups retain ordinary casting',()=>{
    expect(familyPreset(casting('041','male','gnoll'))?.reviewVersion).toBeDefined();
    expect(familyPreset(casting('012','male','durotaric'))).toBeUndefined();
    expect(familyPreset(casting('012','male','darkspear'))).toBeUndefined();
    expect(familyPreset(casting('001','female','azerothian'))).toBeUndefined();
    expect(familyPreset(casting('031','male','murloc'))).toBeUndefined();
    expect(familyPreset({...casting('012','male','durotaric'),cultureId:undefined})).toBeUndefined();
});
test('a reference revision is atomic and preserves previous identity files and saved plans',()=>{
    const c=casting('041','male','gnoll');let old=library.save('world','2','Actor','Old voice.',JSON.stringify({version:2,model:'fixture',inputHash:'hash',individual:'Grain.',casting:c}));
    old=library.reference(old,pcmToWav(Buffer.alloc(960)),'Earlier words.');const bytes=fs.readFileSync(old.referenceFile!);
    library.savePlan('world','1','earlier','digest',{characterVoiceId:old.id});
    const runtime:any=Object.create(AudioRuntime.prototype);runtime.store=()=>library;
    const selected=runtime.familyVoice('world','2','Actor',c,old);
    expect(selected.id).not.toBe(old.id);expect(fs.readFileSync(selected.referenceFile)).toEqual(familyReference(familyPreset(c)!).wav);
    expect(fs.readFileSync(old.referenceFile!)).toEqual(bytes);expect(library.plan('world','1','earlier')?.characterVoiceId).toBe(old.id);
    expect(runtime.familyVoice('world','2','Actor',c,selected).id).toBe(selected.id);
});
test('canonical clones and player-authored voices keep priority over generic Race choices',()=>{
    const c=casting('041','male','gnoll'),runtime:any=Object.create(AudioRuntime.prototype);runtime.store=()=>library;
    const bank=readCloneBank(cloneFixture(path.join(root,'source')).folder),clone=library.importClone('world','2',bank);
    expect(runtime.familyVoice('world','2','Actor',c,clone)).toEqual(clone);
    expect(selectedFamilyPreset(clone,familyPreset(c)!.key)).toBeUndefined();
    const custom=library.save('world','3','Custom','Personal voice.',JSON.stringify({origin:'player',version:2,casting:c}));
    expect(runtime.familyVoice('world','3','Custom',c,custom)).toEqual(custom);
});
test('selected reference speech and whispers retain identity without generic race, accent or sex recasting',()=>{
    const p=familyPreset(casting('041','female','gnoll'))!,text='Stay by the fire.';
    const speech=familyDelivery(p,{kind:'speech',text,passage:0},'An elderly voice, naturally aged.');
    expect(speech).toEqual({renderText:text,instruction:'Speak aloud naturally.'});
    const thought=familyDelivery(p,{kind:'thought',text,passage:0},'', 'worried');
    expect(thought.instruction).toContain('Whisper throughout');expect(thought.instruction).toContain('worried');
    expect(thought.instruction).not.toMatch(/demonic|speaker is female/);
    const delivery=acousticDelivery({kind:'speech',text,passage:0},'',{familyKey:p.key,voice:{anatomyId:'041',cultureId:'gnoll',sex:'female'}});
    expect(delivery.renderText).toBe(text);expect(delivery.instruction).toBe('Speak aloud naturally.');
    expect(()=>acousticDelivery({kind:'speech',text,passage:0},'',{familyKey:p.key,voice:{anatomyId:'041',cultureId:'azerothian',sex:'female'}})).toThrow();
});
