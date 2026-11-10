import fs from 'fs';
import path from 'path';
import os from 'os';
import {app} from 'electron';
import {createHash} from 'crypto';
import {AudioRuntime} from '../../src/main/audio/AudioRuntime';
import {AudioLibrary} from '../../src/main/audio/AudioLibrary';
import {BreezeProvider} from '../../src/main/audio/BreezeProvider';
import {normalizeAudio} from '../../src/shared/audio';
import {familyPresets,familyPreset,familyReference,eligibleFamilyProfile,familyDelivery,selectedFamilyPreset} from '../../src/main/audio/familyPerformance';
import {applyFamilyEffects} from '../../src/main/audio/familyEffects';
import {pcmToWav} from '../../src/main/audio/pcm';
import {readCloneBank} from '../../src/main/audio/CloneBanks';
import {cloneFixture} from './clone-fixture';
import {YOUTHFUL_DIRECTION} from '../../src/main/audio/maturation';
const study=(file:string)=>path.resolve(process.env.TITAN_RECOVERY_STUDIES_ROOT??'.',file);
// Original listening studies remain private archival evidence. Production checks below always run.
const archivedTest=fs.existsSync(study('out/demon-steering-approved-20261016/approved-selections.json'))?test:test.skip;
let root:string,library:AudioLibrary;
beforeEach(()=>{(app as any).getAppPath=()=>path.resolve('.');root=fs.mkdtempSync(path.join(os.tmpdir(),'titan-family-'));library=new AudioLibrary(root);});
afterEach(()=>{library.close();fs.rmSync(root,{recursive:true,force:true});jest.restoreAllMocks();});
const casting=(anatomyId:string,presentation='male')=>({version:'test',formKey:anatomyId+presentation,anatomyId,presentation,anatomyCore:'',cultureCore:''} as any);
function automatic(c:any){return library.save('campaign','2','Actor','Original individual voice.',JSON.stringify({version:2,model:'test',inputHash:'input',individual:'Individual grain.',casting:c}));}
function pcm(file:string){const b=fs.readFileSync(study(file));let i=12;while(i+8<=b.length){const size=b.readUInt32LE(i+4);if(b.toString('ascii',i,i+4)==='data')return b.subarray(i+8,i+8+size);i+=8+size+(size%2);}throw Error('No WAV samples');}
archivedTest('all nineteen approvals retain their hashes; only the explicitly chosen six family references are bundled',()=>{
    const approved=JSON.parse(fs.readFileSync(study('out/demon-steering-approved-20261016/approved-selections.json'),'utf8'));
    for(const p of familyPresets()){
        const a=approved.find((x:any)=>x.family===p.family&&x.sex===p.sex),s=a.selected;
        expect(p.selectedSha256).toBe(s.audio_sha256??s.sha256);
        expect(createHash('sha256').update(fs.readFileSync(study(s.file))).digest('hex')).toBe(p.selectedSha256);
        if(p.mode==='reference')expect(createHash('sha256').update(familyReference(p).wav).digest('hex')).toBe(p.referenceSha256);
    }
    expect(familyPresets().filter(p=>p.mode==='reference').map(p=>p.key).sort()).toEqual(['felorc-female','felorc-male','imp-shared','observer-shared','pitlord-shared','voidwalker-shared']);
});
test.each(['male','female'])('existing generated imps get an approved revision, keeping the original reference and historical plan, Sex=%s',async sex=>{
    const c=casting('091',sex);let old=automatic(c);old=library.reference(old,pcmToWav(Buffer.alloc(960)),'Old reference.');
    const original=fs.readFileSync(old.referenceFile!);library.savePlan('campaign','1','old','digest',{characterVoiceId:old.id});
    const runtime:any=Object.create(AudioRuntime.prototype);runtime.store=()=>library;
    const next=runtime.familyVoice('campaign','2','Actor',c,old);
    expect(next.id).not.toBe(old.id);expect(next.seed).toBe(75041);
    expect(fs.readFileSync(next.referenceFile)).toEqual(familyReference(familyPreset(c)!).wav);
    expect(fs.readFileSync(old.referenceFile!)).toEqual(original);expect(library.plan('campaign','1','old').characterVoiceId).toBe(old.id);
    expect(runtime.familyVoice('campaign','2','Actor',c,next).id).toBe(next.id);
    const job:any={conv:{campaignIdentity:{campaignId:'campaign'}},actor:{id:2,fullName:'Actor'},casting:c,settings:normalizeAudio()};
    runtime.update=()=>{};
    const provider={speech:jest.fn()};const voice=await runtime.voice(job,false,provider,new AbortController().signal);
    expect(voice.id).toBe(next.id);expect(job.familyKey).toBe('imp-shared');expect(provider.speech).not.toHaveBeenCalled();
});
test('canonical clones and player-authored voices bypass shared references and effects even when casting resembles a demon',()=>{
    const runtime:any=Object.create(AudioRuntime.prototype);runtime.store=()=>library;
    const bank=readCloneBank(cloneFixture(path.join(root,'source')).folder),clone=library.importClone('campaign','2',bank);
    expect(runtime.familyVoice('campaign','2','Actor',casting('091'),clone)).toEqual(clone);
    expect(selectedFamilyPreset(clone,'imp-shared')).toBeUndefined();
    const manual=library.save('campaign','3','Manual','Player voice.',JSON.stringify({version:2,origin:'player',casting:casting('091')}));
    expect(eligibleFamilyProfile(manual)).toBe(false);expect(runtime.familyVoice('campaign','3','Manual',casting('091'),manual)).toEqual(manual);
});
test('shared imp speech has no distortion, sex or accent recasting; thoughts and children retain their authorized delivery',()=>{
    const p=familyPreset(casting('091','female'))!;
    expect(familyDelivery(p,{kind:'speech',text:'Exact words.',passage:0},'An elderly voice, naturally aged.').instruction).toBe('Speak aloud naturally.');
    expect(familyDelivery(p,{kind:'thought',text:'Exact words.',passage:0},'Adult.').instruction).toContain('Whisper throughout');
    expect(familyDelivery(p,{kind:'speech',text:'Exact words.',passage:0},YOUTHFUL_DIRECTION).instruction).toContain(YOUTHFUL_DIRECTION);
    expect(p.effect).toBeNull();expect(familyPreset(casting('084','female'))?.key).toBe('doomguard-shared');
});
test.each(['imp-shared','observer-shared','voidwalker-shared','doomguard-shared'])('provider sends the approved guidance and unchanged words for %s',async key=>{
    const p=familyPresets().find(p=>p.key===key)!,c=casting(({imp:'091',observer:'185',voidwalker:'093',doomguard:'084'} as any)[p.family]);
    let profile=automatic(c);profile=library.reference(profile,pcmToWav(Buffer.alloc(960)),'Exact reference.');
    const forms:FormData[]=[];jest.spyOn(global,'fetch').mockImplementation(async(url,options)=>{
        if(String(url).endsWith('/health'))return new Response(JSON.stringify({ready:true,model_id:'breeze-tts-2'}));
        forms.push(options?.body as FormData);return new Response(String(url).endsWith('/speech')?Buffer.alloc(960):'{}');
    });
    await new BreezeProvider(normalizeAudio(),library).speech('Exact words.',p.speech,profile,new AbortController().signal,undefined,{familyKey:key,deliveryKind:'speech'});
    const request=forms.find(f=>f.has('text'))!;expect(request.get('text')).toBe('Exact words.');expect(request.get('guidance_scale')).toBe(String(p.cfgScale));
});
archivedTest.each(['eredar-male','satyr-female','shivarra-female','felblood-male','pitlord-shared','dreadlord-female','metamorphosis-female'])('production DSP reproduces the actual approved output to one PCM unit: %s',async key=>{
    const p=familyPresets().find(p=>p.key===key)!;
    const approvals=JSON.parse(fs.readFileSync(study('out/demon-steering-approved-20261016/approved-selections.json'),'utf8'));
    const a=approvals.find((a:any)=>a.family===p.family&&a.sex===p.sex),s=a.selected;
    let source=s.sourceFile;
    if(p.family==='pitlord')source=a.synthesisRecipe.unprocessedSource.file;
    if(!source){const presets=JSON.parse(fs.readFileSync(study('out/race-text-voice-sampler-r2-20261016/approved-presets.json'),'utf8')).presets;source=presets.find((x:any)=>x.key===key||x.family===p.family&&x.sex===p.sex).originalRaw.file;}
    if(!path.isAbsolute(source)){
        // Original raw receipts use a basename under their audition directory.
        source=path.join('out/demon-steering-pass2-20261016/auditions/generated',path.basename(source));
    }
    const actual=await applyFamilyEffects(pcm(source),p,new AbortController().signal),expected=pcm(s.file);
    expect(actual.length).toBe(expected.length);let difference=0;for(let i=0;i<actual.length;i+=2)difference=Math.max(difference,Math.abs(actual.readInt16LE(i)-expected.readInt16LE(i)));
    expect(difference).toBeLessThanOrEqual(1);
},20000);

test('the shipped nineteen recipes and six reference families retain every production asset hash',()=>{
    const presets=familyPresets();expect(presets).toHaveLength(19);
    const references=presets.filter(p=>p.mode==='reference');
    expect(references.map(p=>p.key).sort()).toEqual(['felorc-female','felorc-male','imp-shared','observer-shared','pitlord-shared','voidwalker-shared']);
    for(const p of references)expect(createHash('sha256').update(familyReference(p).wav).digest('hex')).toBe(p.referenceSha256);
});
