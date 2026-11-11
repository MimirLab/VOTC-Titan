import fs from 'fs';
import {createHash} from 'crypto';
import os from 'os';
import path from 'path';
import { app } from 'electron';
import { AudioRuntime, DEFAULT_NARRATOR_BANK, DEFAULT_NARRATOR_NAME } from '../../src/main/audio/AudioRuntime';
import { BreezeProvider } from '../../src/main/audio/BreezeProvider';
import { designCharacterVoice } from '../../src/main/audio/voiceDesign';
import { normalizeAudio } from '../../src/shared/audio';
import { pcmToWav } from '../../src/main/audio/pcm';
import type { Message } from '../../src/main/ts/conversation_interfaces';
import type { Conversation } from '../../src/main/conversation/Conversation';
import * as cloneRuntime from '../../src/main/audio/cloneRuntime';
import * as cloneCapture from '../../src/main/audio/cloneCapture';
import { cloneIdentity, readCloneBank } from '../../src/main/audio/CloneBanks';
import { cloneFixture } from './clone-fixture';
import { cloneAgeInstruction } from '../../src/main/audio/cloneAge';
import * as maturationRuntime from '../../src/main/audio/maturationRuntime';
import { childhoodDirection, MaturityStage } from '../../src/main/audio/maturation';
import * as personalityStyle from '../../src/main/audio/personalityStyle';
jest.mock('../../src/main/audio/voiceDesign', () => ({ prepareVoiceDesign: () => ({ prompt: [], provider: {}, encoder: null }),
    refreshPreparedVoiceBody: (prepared: any, _conv: any, _actor: any, casting: any, individual: any) => ({ ...prepared, casting, individual }),
    updatePreparedVoiceDesign: (prepared: any, casting: any, individual: any, development: any) => ({ ...prepared, casting, individual, development }),
    designCharacterVoice: jest.fn().mockResolvedValue({ instruction: 'A clear, warm, resonant voice with precise natural articulation.', provenance: 'synthetic' }) }));
jest.mock('../../src/main/goa/goaRuntime', () => ({ getVerifiedGoaSnapshot: () => undefined, currentGoaCatalog: () => undefined }));
jest.mock('../../src/main/audio/BreezeProvider');

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function until(condition: () => boolean): Promise<void> { for (let n = 0; n < 40 && !condition(); n++) await tick(); expect(condition()).toBe(true); }
function fixture(root: string, enabled = true) {
    const settings = normalizeAudio({ enabled, hosting: 'external' });
    const actor = { id: 2, fullName: 'Speaker', shortName: 'Speaker', age: 35 };
    const seen: any[][] = []; let runtime: AudioRuntime;
    runtime = new AudioRuntime(root, () => settings, (channel, ...args) => seen.push([channel, ...args]));
    const source: Message = { id: 'first', role: 'assistant', characterId: 2, proseEncoding: 'controls-v1', content: 'Hidden canonical translation' };
    const view: Message = { ...source, content: '"Grog maen."', editableContent: '""Grog maen.""' };
    const conv = { config: { audio: settings }, campaignIdentity: { campaignId: 'campaign-a' }, isOpen: true,
        gameData: { characters: new Map([[2, actor]]), playerID: 1 }, messages: [source], messageForPlayer: () => view,
        getHistory: () => [view], getEncounterCharacter: () => actor, historicalConversations: [] } as unknown as Conversation;
    const speech = jest.fn(async (_text: string, _instruction: string, _profile: any, signal: AbortSignal, onPCM?: (b: Buffer) => Promise<void>, _options?: any) => {
        signal.throwIfAborted(); if (onPCM) { await onPCM(Buffer.alloc(960)); return Buffer.alloc(0); } return pcmToWav(Buffer.alloc(960));
    });
    (BreezeProvider as jest.Mock).mockImplementation(() => ({ speech, health: async () => ({ ready: true }) }));
    return { runtime, settings, actor, seen, conv, source, view, speech };
}
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-audio-runtime-')); jest.clearAllMocks(); (app as any).getAppPath = () => path.resolve('.'); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
test('an empty narrator library previews the exact bundled Medivh without generating an identity', async () => {
    const f = fixture(root), bank = readCloneBank(path.join(cloneCapture.BUNDLED_CLONES, DEFAULT_NARRATOR_BANK));
    try {
        expect(f.runtime.list()).toEqual([]);
        await f.runtime.previewVoice(undefined, undefined, 'The last light slipped from the ridge.');
        expect(f.speech).toHaveBeenCalledTimes(1);
        const [text, direction, profile] = f.speech.mock.calls[0];
        expect(text).toBe('The last light slipped from the ridge.'); expect(direction).toBe('');
        expect(profile).toMatchObject({ characterId: '__narrator__', campaign: '__global__', label: DEFAULT_NARRATOR_NAME, seed: 17, referenceText: bank.text });
        expect(fs.readFileSync(profile.referenceFile!)).toEqual(bank.wav);
        expect(cloneIdentity(profile)).toMatchObject({ key: DEFAULT_NARRATOR_BANK, audioHash: bank.audioHash, manifestHash: bank.manifestHash });
        expect(designCharacterVoice).not.toHaveBeenCalled();
    } finally { f.runtime.shutdown(); }
});
test('narrator overrides persist and restoring Medivh reuses one reference without deleting saved choices', async () => {
    const f = fixture(root);
    try {
        const custom = f.runtime.saveNarrator('My storyteller', 'A bright, clear storyteller.');
        await f.runtime.previewVoice(); expect(f.speech.mock.calls.at(-1)![2].id).toBe(custom.id);
        const medivh = f.runtime.useDefaultNarrator(); f.runtime.selectVoice(custom.id);
        await f.runtime.previewVoice(); expect(f.speech.mock.calls.at(-1)![2].id).toBe(custom.id);
        expect(f.runtime.useDefaultNarrator().id).toBe(medivh.id); expect(f.runtime.useDefaultNarrator().id).toBe(medivh.id);
        f.runtime.selectVoice(custom.id); f.runtime.selectVoice(medivh.id);
        expect(f.runtime.list()).toHaveLength(2); expect(f.runtime.list().find(v => v.active)?.id).toBe(medivh.id);
        f.runtime.deleteVoice(medivh.id); expect(f.runtime.list()).toHaveLength(1);
        expect(f.runtime.list()[0]).toMatchObject({ id: custom.id, active: true });
    } finally { f.runtime.shutdown(); }
});
test('encounter narration uses Medivh without inheriting the character age and historical replay retains that narrator', async () => {
    const f = fixture(root); f.settings.narrator = true; f.actor.age = 80;
    f.view.editableContent = '**The last light slipped from the ridge.**';
    try {
        f.runtime.enqueue(f.conv, f.source); await until(() => f.seen.some(e => e[0] === 'audio-end'));
        expect(f.speech).toHaveBeenCalledTimes(1);
        const first = f.speech.mock.calls[0];
        expect(first[1]).toBe(''); expect(first[2].label).toBe(DEFAULT_NARRATOR_NAME);
        expect(first[5]).toMatchObject({ deliveryKind: 'narration', cloneAge: undefined, maturity: undefined, demonFamily: undefined });
        expect(designCharacterVoice).not.toHaveBeenCalled();
        f.runtime.stop(); await until(() => !(f.runtime as any).draining); f.seen.length = 0;
        const custom = f.runtime.saveNarrator('Override', 'A gentle storyteller.'); f.speech.mockClear();
        f.runtime.replay(f.conv, f.source.id!); await until(() => f.seen.some(e => e[0] === 'audio-end'));
        expect(f.speech.mock.calls[0][2].id).toBe(first[2].id); expect(f.speech.mock.calls[0][2].id).not.toBe(custom.id);
    } finally { f.runtime.shutdown(); }
});
test('disabled audio performs no voice design, storage, model loading or output', async () => {
    const f = fixture(root, false); f.runtime.enqueue(f.conv, f.source); await tick();
    expect(designCharacterVoice).not.toHaveBeenCalled(); expect(f.speech).not.toHaveBeenCalled();
    expect(fs.readdirSync(root)).toEqual([]); expect(f.seen).toEqual([]); f.runtime.shutdown();
});
test.each([false,true])('a newly encountered child matures through native stages with one reused reference, clone=%s',async cloned=>{
    const f=fixture(root);f.actor.age=2;
    let stage:MaturityStage='young-child';
    const capture=jest.spyOn(maturationRuntime,'captureMaturityForAudio').mockImplementation(async()=>stage);
    let firstView:any,firstSource:any;
    try {
        if(cloned){const bank=f.runtime.importCloneBank(cloneFixture(path.join(root,'source')).file);f.runtime.bindClone(f.conv,2,bank.key)}
        const identities:string[]=[],references:string[]=[];
        for(const [index,value] of (['young-child','child','adolescent','adult'] as const).entries()){
            stage=value;f.view.id='maturity-'+index;f.view.editableContent='""The gate is shut."" ~~They must not hear my doubts.~~';
            const source={...f.source,id:f.view.id};if(index===0){firstView={...f.view};firstSource=source}
            const mark=f.speech.mock.calls.length;f.runtime.enqueue(f.conv,source);await until(()=>f.seen.some(e=>e[0]==='audio-end'));
            const calls=f.speech.mock.calls.slice(mark).filter(c=>c[4]);expect(calls).toHaveLength(2);
            for(const c of calls){expect(c[5].maturity).toBe(value);if(value!=='adult')expect(c[1]).toContain(childhoodDirection(value));else expect(c[1]).not.toContain('as a child')}
            identities.push(calls[0][2].id);references.push(calls[0][2].referenceFile!);
            expect(calls[0][2].id).toBe(calls[1][2].id);f.runtime.stop();await until(()=>!(f.runtime as any).draining);f.seen.length=0;
        }
        expect(capture).toHaveBeenCalledTimes(4);expect(new Set(identities).size).toBe(1);expect(new Set(references).size).toBe(1);
        expect(f.runtime.list()).toHaveLength(1);expect(designCharacterVoice).toHaveBeenCalledTimes(cloned?0:1);
        Object.assign(f.view,firstView);f.speech.mockClear();f.runtime.replay(f.conv,firstSource.id);await until(()=>f.seen.some(e=>e[0]==='audio-end'));
        expect(capture).toHaveBeenCalledTimes(4);expect(f.speech.mock.calls[0][5].maturity).toBe('young-child');expect(f.speech.mock.calls[0][2].id).toBe(identities[0]);
        expect(f.actor.age).toBe(2); // The live native stage wins over this stale encounter age.
    } finally {f.runtime.shutdown();capture.mockRestore()}
});
test('a failed forced maturity check stops before voice design, GPU loading or speech',async()=>{
    const f=fixture(root);f.settings.hosting='managed';
    const capture=jest.spyOn(maturationRuntime,'captureMaturityForAudio').mockRejectedValue(new Error('Current character maturity capture is not ready.'));
    const start=jest.spyOn(f.runtime.managed,'start').mockResolvedValue(undefined);
    try{f.runtime.enqueue(f.conv,f.source);await until(()=>f.seen.some(e=>e[0]==='audio-status'&&e[1].state==='error'));expect(f.speech).not.toHaveBeenCalled();expect(start).not.toHaveBeenCalled();expect(designCharacterVoice).not.toHaveBeenCalled()}
    finally{f.runtime.shutdown();capture.mockRestore()}
});
test('traits change delivery without recasting, adulthood finalizes once, and youthful delivery ends at twenty',async()=>{
    const f=fixture(root);f.actor.age=2;let stage:MaturityStage='child',traits:any[]=[];
    const capture=jest.spyOn(maturationRuntime,'captureMaturityForAudio').mockImplementation(async()=>stage);
    const observed=jest.spyOn(maturationRuntime,'currentVoiceTraits').mockImplementation(()=>traits);
    const style=jest.spyOn(personalityStyle,'designPersonalityStyle').mockResolvedValueOnce('Use impulsive emphasis.').mockResolvedValue('Use assured, measured phrasing.');
    const provenance=(phase:string)=>JSON.stringify({version:2,model:'configured',inputHash:'a'.repeat(64),individual:'A clear voice with a light dry grain and precise rounded consonants.',development:{version:1,phase,traits:[...traits],...(phase==='adult'?{originalVoiceId:f.runtime.list()[0].id}:{})}});
    (designCharacterVoice as jest.Mock).mockImplementationOnce(async()=>({instruction:'A clear provisional voice.',provenance:provenance('provisional')}))
        .mockImplementationOnce(async()=>({instruction:'A clear adult voice.',provenance:provenance('adult')}));
    async function play(id:string,value:MaturityStage,next:any[]){
        stage=value;traits=next;f.view.id=id;f.view.editableContent='""The gate is shut."" ~~They must not hear my doubts.~~';
        const mark=f.speech.mock.calls.length;f.runtime.enqueue(f.conv,{...f.source,id});await until(()=>f.seen.some(e=>e[0]==='audio-end'));
        const calls=f.speech.mock.calls.slice(mark);f.runtime.stop();await until(()=>!(f.runtime as any).draining);f.seen.length=0;return calls;
    }
    try{
        const first=await play('child-empty','child',[]),original=first.find(c=>c[4])![2],originalBytes=fs.readFileSync(original.referenceFile!);
        const rowdy=[{category:'childhood',name:'Rowdy'}],brave=[...rowdy,{category:'personality',name:'Brave'}];
        const changed=await play('child-rowdy','child',rowdy);expect(changed).toHaveLength(2);expect(changed.every(c=>c[1].includes('impulsive emphasis'))).toBe(true);
        await play('child-rowdy-again','child',rowdy);expect(style).toHaveBeenCalledTimes(1);
        await play('teen-brave','adolescent',brave);expect(style).toHaveBeenCalledTimes(2);expect(f.runtime.list()).toHaveLength(1);
        const adult=await play('adult-sixteen','youthful-adult',brave),adultSpeech=adult.find(c=>c[4])!;
        expect(adult.filter(c=>!c[4])).toHaveLength(1);expect(adult.find(c=>!c[4])![2].referenceFile).toBe(original.referenceFile);
        expect(adultSpeech[2].id).not.toBe(original.id);expect(adultSpeech[2].seed).toBe(original.seed);expect(adultSpeech[1]).toContain('sounding youthful');
        expect(designCharacterVoice).toHaveBeenCalledTimes(2);expect(f.runtime.list()).toHaveLength(2);expect(fs.readFileSync(original.referenceFile!)).toEqual(originalBytes);
        const nineteen=await play('adult-nineteen','youthful-adult',brave);expect(nineteen).toHaveLength(2);expect(nineteen[0][2].id).toBe(adultSpeech[2].id);expect(nineteen[0][1]).toContain('sounding youthful');
        const twenty=await play('adult-twenty','adult',brave);expect(twenty).toHaveLength(2);expect(twenty[0][2].id).toBe(adultSpeech[2].id);expect(twenty[0][1]).not.toContain('sounding youthful');expect(designCharacterVoice).toHaveBeenCalledTimes(2);
        const probes=capture.mock.calls.length;f.view.id='child-rowdy';f.runtime.replay(f.conv,f.view.id);await until(()=>f.seen.some(e=>e[0]==='audio-end'));
        const replay=f.speech.mock.calls.at(-1)!;expect(replay[2].id).toBe(original.id);expect(replay[1]).toContain('impulsive emphasis');expect(capture).toHaveBeenCalledTimes(probes);expect(style).toHaveBeenCalledTimes(2);
    }finally{f.runtime.shutdown();capture.mockRestore();observed.mockRestore();style.mockRestore();}
});
test('a first child preview prepares the identity reference then delivers the default words at the current maturity',async()=>{
    const f=fixture(root);f.actor.age=2;
    const capture=jest.spyOn(maturationRuntime,'captureMaturityForAudio').mockResolvedValue('child');
    try {
        const profile=(f.runtime as any).store().save('campaign-a','2','Saved voice','A clear neutral voice.','legacy fixture');
        f.runtime.bindClone(f.conv,2);
        await f.runtime.previewCharacter(f.conv,2);
        expect(f.speech).toHaveBeenCalledTimes(2);
        const [reference,delivery]=f.speech.mock.calls;
        expect(reference[2].referenceFile).toBeUndefined();expect(reference[1]).toContain('mature adult');
        expect(delivery[2].referenceFile).toBeTruthy();expect(delivery[2].id).toBe(profile.id);
        expect(delivery[0]).toBe(reference[0]);expect(delivery[1]).toContain(childhoodDirection('child'));
        expect(delivery[5].maturity).toBe('child');expect(designCharacterVoice).not.toHaveBeenCalled();
    }finally{f.runtime.shutdown();capture.mockRestore()}
});
test('failed adult synthesis preserves the provisional reference and the current play button retries finalization',async()=>{
    const f=fixture(root),capture=jest.spyOn(maturationRuntime,'captureMaturityForAudio').mockResolvedValue('youthful-adult');
    const original=(f.runtime as any).store().save('campaign-a','2','Speaker','A clear original voice.',JSON.stringify({version:2,model:'configured',inputHash:'a'.repeat(64),individual:'Clear dry grain.',development:{version:1,phase:'provisional',traits:[]}}));
    (f.runtime as any).store().reference(original,pcmToWav(Buffer.alloc(100)), 'Original reference words.');
    const adult={instruction:'A clear adult voice.',provenance:JSON.stringify({version:2,model:'configured',inputHash:'b'.repeat(64),individual:'Clear dry grain.',development:{version:1,phase:'adult',traits:[],originalVoiceId:original.id}})};
    (designCharacterVoice as jest.Mock).mockResolvedValueOnce(adult).mockResolvedValueOnce(adult);
    const speech=f.speech.getMockImplementation()!;let fail=true;
    f.speech.mockImplementation(async(...args)=>{if(!args[4]&&args[5]?.maturity==='adult'&&fail){fail=false;throw new Error('Synthetic adult synthesis failure')}return speech(...args)});
    try{
        f.runtime.enqueue(f.conv,f.source);await until(()=>f.seen.some(e=>e[0]==='audio-status'&&e[1].state==='error'));
        expect(f.runtime.list()).toHaveLength(1);expect(f.runtime.list()[0].id).toBe(original.id);expect((f.runtime as any).store().development(original).adultVoiceId).toBeUndefined();
        expect((f.runtime as any).store().plan('campaign-a','1','first').pending).toBe(true);
        await until(()=>!(f.runtime as any).draining);f.seen.length=0;f.runtime.replay(f.conv,'first');await until(()=>f.seen.some(e=>e[0]==='audio-end'));
        expect(capture).toHaveBeenCalledTimes(2);expect(designCharacterVoice).toHaveBeenCalledTimes(2);expect(f.runtime.list()).toHaveLength(2);
        expect((f.runtime as any).store().plan('campaign-a','1','first').pending).toBe(false);
    }finally{f.runtime.shutdown();capture.mockRestore();}
});
test('only explicitly bound characters bypass design and retain tone/whispers through enqueue and frozen replay', async () => {
    const f = fixture(root); const source = cloneFixture(path.join(root, 'source'));
    try {
        const bank = f.runtime.importCloneBank(source.file); f.runtime.bindClone(f.conv, 2, bank.key);
        f.view.editableContent = '""The gate is shut."" ~~I should wait.~~';
        f.runtime.enqueue(f.conv, f.source); await until(() => f.seen.some(e => e[0] === 'audio-end'));
        expect(designCharacterVoice).not.toHaveBeenCalled();
        const deliveries = f.speech.mock.calls.filter(c => c[4]); expect(deliveries).toHaveLength(2);
        expect(deliveries.map(c => c[0])).toEqual(['The gate is shut.', 'I should wait.']);
        expect(deliveries[1][1]).toContain("reference speaker's vocal texture and accent"); expect(deliveries[1][1]).not.toMatch(/adult|maturity|male|female|goblin|culture/i);
        expect(deliveries[0][5]).toMatchObject({ singleUtterance: true, deliveryKind: 'speech' });
        expect(deliveries[1][5]).toMatchObject({ singleUtterance: true, deliveryKind: 'thought' });
        expect(deliveries[0][2].id).toBe(deliveries[1][2].id);
        expect(deliveries[0][2].seed).toBe(17); expect(deliveries[0][2].referenceText).toBe(source.text);
        expect(f.speech.mock.calls.every(c => c[2].referenceFile)).toBe(true);
        const originalId = deliveries[0][2].id;
        f.runtime.stop(); await until(() => (f.runtime as any).draining === false);
        f.runtime.bindClone(f.conv, 2); f.speech.mockClear(); f.seen.length = 0;
        f.runtime.replay(f.conv, 'first'); await until(() => f.seen.some(e => e[0] === 'audio-end'));
        expect(f.speech.mock.calls[0][2].id).toBe(originalId); expect(designCharacterVoice).not.toHaveBeenCalled();
        f.runtime.stop(); await until(() => (f.runtime as any).draining === false); f.speech.mockClear(); f.seen.length = 0;
        f.runtime.enqueue(f.conv, { ...f.source, id: 'unbound-new' }); await until(() => f.seen.some(e => e[0] === 'audio-end'));
        expect(designCharacterVoice).toHaveBeenCalledTimes(1);
        expect(f.speech.mock.calls[0][2].id).not.toBe(originalId);
    } finally { f.runtime.shutdown(); }
});
test('missing assigned bank fails before the GPU or voice designer and does not affect another campaign', async () => {
    const f = fixture(root), source = cloneFixture(path.join(root, 'source')), bank = f.runtime.importCloneBank(source.file);
    try {
        f.runtime.bindClone(f.conv, 2, bank.key); f.settings.hosting = 'managed';
        const start = jest.spyOn(f.runtime.managed, 'start').mockResolvedValue(undefined);
        fs.rmSync(path.join(root, 'clone-banks', bank.key), { recursive: true });
        expect(() => f.runtime.enqueue(f.conv, f.source)).toThrow(); expect(start).not.toHaveBeenCalled(); expect(designCharacterVoice).not.toHaveBeenCalled();
        expect(() => f.runtime.bindClone(f.conv, 999, bank.key)).toThrow('current encounter');
        (f.conv as any).campaignIdentity.campaignId = 'campaign-b'; f.settings.hosting = 'external';
        f.runtime.enqueue(f.conv, f.source); await until(() => f.seen.some(e => e[0] === 'audio-end'));
        expect(designCharacterVoice).toHaveBeenCalledTimes(1);
    } finally { f.runtime.shutdown(); }
});
test('clone preview bypasses age and faith and prevents accidental casting redesign', async () => {
    const f = fixture(root), source = cloneFixture(path.join(root, 'source')), bank = f.runtime.importCloneBank(source.file);
    try {
        f.runtime.bindClone(f.conv, 2, bank.key);
        await f.runtime.previewCharacter(f.conv, 2, 'Exact audition words.', 'irrelevant');
        expect(f.speech.mock.calls).toHaveLength(1); expect(f.speech.mock.calls[0][0]).toBe('Exact audition words.'); expect(f.speech.mock.calls[0][1]).toBe('');
        expect(designCharacterVoice).not.toHaveBeenCalled();
        await expect(f.runtime.redesign(f.conv, 2)).rejects.toThrow('clone bank');
        expect(() => f.runtime.saveVoice(f.runtime.list()[0].id, 'A different voice')).toThrow('recording');
    } finally { f.runtime.shutdown(); }
});
test('older mortal clone delivery freezes age for replay while new immortality suppresses it without recasting', async () => {
    const f=fixture(root),source=cloneFixture(path.join(root,'source')),bank=f.runtime.importCloneBank(source.file);
    const catalog=jest.spyOn(cloneCapture,'bundledCloneCatalog').mockReturnValue({version:1,profiles:{[bank.key]:{name:bank.name,manifestHash:readCloneBank(source.folder).manifestHash,referenceAge:'adult'}},identities:{},history:{}});
    let aging={ageless:false,longLived:false};
    const capture=jest.spyOn(cloneRuntime,'captureCloneForAudio').mockImplementation(async()=>({ambiguous:false,aging}));
    try {
        f.runtime.bindClone(f.conv,2,bank.key);f.actor.age=75;
        f.view.editableContent='""The gate is shut."" ~~They must not hear my doubts.~~';
        f.runtime.enqueue(f.conv,f.source);await until(()=>f.seen.some(e=>e[0]==='audio-end'));
        const calls=f.speech.mock.calls.filter(c=>c[4]);expect(calls).toHaveLength(2);
        const id=calls[0][2].id;expect(calls[1][2].id).toBe(id);
        for(const c of calls){expect(c[1]).toContain(cloneAgeInstruction('elderly'));expect(c[5].cloneAge).toBe('elderly')}
        expect(capture).toHaveBeenCalledTimes(1);expect(capture.mock.calls[0][3]).toEqual({refreshAging:true});
        f.runtime.stop();await until(()=>!(f.runtime as any).draining);f.speech.mockClear();f.seen.length=0;
        f.actor.age=1500;aging={ageless:true,longLived:false};
        f.runtime.replay(f.conv,'first');await until(()=>f.seen.some(e=>e[0]==='audio-end'));
        expect(capture).toHaveBeenCalledTimes(1);expect(f.speech.mock.calls[0][5].cloneAge).toBe('elderly');
        f.runtime.stop();await until(()=>!(f.runtime as any).draining);f.speech.mockClear();f.seen.length=0;
        f.view.id='immortal-new';f.runtime.enqueue(f.conv,{...f.source,id:f.view.id});await until(()=>f.seen.some(e=>e[0]==='audio-end'));
        expect(capture).toHaveBeenCalledTimes(2);expect(f.speech.mock.calls[0][2].id).toBe(id);
        expect(f.speech.mock.calls[0][5].cloneAge).toBeUndefined();expect(f.speech.mock.calls[0][1]).not.toContain('elderly');
        expect(designCharacterVoice).not.toHaveBeenCalled();expect(f.runtime.list()).toHaveLength(1);
    } finally {f.runtime.shutdown();capture.mockRestore();catalog.mockRestore()}
});
test('encounter character preview ages a mortal reference; a context-free library preview retains the bank voice',async()=>{
    const f=fixture(root),source=cloneFixture(path.join(root,'source')),bank=f.runtime.importCloneBank(source.file);
    const catalog=jest.spyOn(cloneCapture,'bundledCloneCatalog').mockReturnValue({version:1,profiles:{[bank.key]:{name:bank.name,manifestHash:readCloneBank(source.folder).manifestHash,referenceAge:'adult'}},identities:{},history:{}});
    const facts={ambiguous:false,aging:{ageless:false,longLived:false}};
    const capture=jest.spyOn(cloneRuntime,'captureCloneForAudio').mockResolvedValue(facts),observed=jest.spyOn(cloneRuntime,'cloneObservation').mockReturnValue(facts);
    try {
        f.runtime.bindClone(f.conv,2,bank.key);f.actor.age=60;await f.runtime.previewCharacter(f.conv,2,'Exact preview words.');
        expect(f.speech.mock.calls[0][5].cloneAge).toBe('older');expect(f.speech.mock.calls[0][1]).toContain(cloneAgeInstruction('older'));
        const id=f.speech.mock.calls[0][2].id;await f.runtime.previewVoice(id,undefined,'Exact preview words.');
        expect(f.speech.mock.calls[1][5].cloneAge).toBeUndefined();expect(f.speech.mock.calls[1][2].id).toBe(id);expect(capture).toHaveBeenCalledTimes(1);
    } finally {f.runtime.shutdown();capture.mockRestore();observed.mockRestore();catalog.mockRestore()}
});
test('assigning a bank preserves an old normal replay; deleting a frozen clone never substitutes another voice', async () => {
    const f = fixture(root), source = cloneFixture(path.join(root, 'source')), bank = f.runtime.importCloneBank(source.file);
    try {
        f.runtime.enqueue(f.conv, f.source); await until(() => f.seen.some(e => e[0] === 'audio-end'));
        const normal = f.speech.mock.calls.at(-1)![2].id;
        f.runtime.stop(); await until(() => (f.runtime as any).draining === false); f.speech.mockClear(); f.seen.length = 0;
        f.runtime.bindClone(f.conv, 2, bank.key); f.runtime.replay(f.conv, 'first');
        await until(() => f.seen.some(e => e[0] === 'audio-end')); expect(f.speech.mock.calls[0][2].id).toBe(normal);
        f.runtime.stop(); await until(() => (f.runtime as any).draining === false); f.speech.mockClear(); f.seen.length = 0;
        f.runtime.enqueue(f.conv, f.source); await until(() => f.seen.some(e => e[0] === 'audio-end'));
        const cloned = f.speech.mock.calls[0][2].id; expect(cloned).not.toBe(normal);
        f.runtime.deleteVoice(cloned); await until(() => (f.runtime as any).draining === false);
        expect(() => f.runtime.replay(f.conv, 'first')).toThrow('deleted');
    } finally { f.runtime.shutdown(); }
});
test('local hearing receipts identify the delivered view without logging canonical or heard words', async () => {
    const f = fixture(root), info = jest.spyOn(console, 'info').mockImplementation(() => {});
    f.view.spokenLanguageId = 'language_orcish'; f.view.comprehensionMode = 'FAR'; f.view.speechComprehension = 'unintelligible';
    try {
        f.runtime.enqueue(f.conv, f.source);
        const row = info.mock.calls.find(([value]) => String(value).startsWith('[Audio hearing receipt] '));
        const receipt = JSON.parse(String(row![0]).slice('[Audio hearing receipt] '.length));
        expect(receipt).toMatchObject({ messageId: 'first', speakerId: 2, listenerId: 1, replay: false,
            spokenLanguageId: 'language_orcish', comprehensionMode: 'FAR', speechComprehension: 'unintelligible' });
        expect(receipt.heardDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(receipt)).not.toMatch(/Grog maen|Hidden canonical/);
    } finally { f.runtime.shutdown(); info.mockRestore(); }
});
test('player-frozen speech is queued sequentially and requires playback completion before the next reply', async () => {
    const f = fixture(root);
    try {
        f.runtime.enqueue(f.conv, f.source); f.runtime.enqueue(f.conv, { ...f.source, id: 'second' });
        await until(() => f.seen.some(e => e[0] === 'audio-end'));
        expect(f.seen.filter(e => e[0] === 'audio-start')).toHaveLength(1);
        expect(f.seen.find(e => e[0] === 'audio-start')![1].bufferAll).toBe(true);
        expect(f.seen.find(e => e[0] === 'audio-start')![1].pauseBeforeMs).toBe(300);
        expect(f.speech.mock.calls.find(call => call[4])![0]).toBe('Grog maen.');
        expect(JSON.stringify(f.speech.mock.calls)).not.toContain('Hidden canonical translation');
        f.runtime.completed(f.seen.find(e => e[0] === 'audio-start')![1].id);
        await until(() => f.seen.filter(e => e[0] === 'audio-start').length === 2);
        expect(f.seen.filter(e => e[0] === 'audio-start')[1][1].pauseBeforeMs).toBe(300);
        expect(designCharacterVoice).toHaveBeenCalledTimes(1);
        f.runtime.completed(f.seen.filter(e => e[0] === 'audio-start')[1][1].id); await tick();
    } finally { f.runtime.shutdown(); }
});
test('narrator-off replay sends the entire reconnected utterance once and forwards PCM for buffering while synthesis is unfinished', async () => {
    const f = fixture(root);
    f.view.editableContent = '""If you,"" **she says quietly,** ""return before winter, I will be waiting.""';
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const ordinary = f.speech.getMockImplementation()!;
    f.speech.mockImplementation(async (text, instruction, profile, signal, onPCM) => {
        if (!onPCM) return ordinary(text, instruction, profile, signal, onPCM);
        await onPCM(Buffer.alloc(960)); await gate; signal.throwIfAborted(); await onPCM(Buffer.alloc(960)); return Buffer.alloc(0);
    });
    try {
        f.runtime.replay(f.conv, 'first');
        await until(() => f.seen.some(e => e[0] === 'audio-chunk'));
        const deliveries = f.speech.mock.calls.filter(c => c[4]);
        expect(deliveries.map(c => c[0])).toEqual(['If you, return before winter, I will be waiting.']);
        expect(deliveries[0][2].characterId).toBe('2');
        expect(f.seen.some(e => e[0] === 'audio-end')).toBe(false);
        expect(JSON.stringify(deliveries)).not.toContain('Hidden canonical');
        release(); await until(() => f.seen.some(e => e[0] === 'audio-end'));
        f.runtime.completed(f.seen.find(e => e[0] === 'audio-start')![1].id);
        await until(() => f.runtime.status.state === 'idle');
    } finally { release(); f.runtime.shutdown(); }
});
test('narration hands off to the character, whispers and back without losing the character passages', async () => {
    const f = fixture(root); f.settings.narrator = true;
    delete f.view.proseEncoding; // Actual language reader views omit the backend encoding flag.
    f.view.editableContent = '**She nods.** ""Grog maen."" ~~Stay calm.~~ **She waits.** ""Come in.""';
    const expected = ['She nods.', 'Grog maen.', 'Stay calm.', 'She waits.', 'Come in.'];
    try {
        f.runtime.replay(f.conv, 'first');
        for (let index = 0; index < expected.length; index++) {
            await until(() => f.seen.filter(e => e[0] === 'audio-end').length === index + 1);
            const deliveries = f.speech.mock.calls.filter(call => call[4]);
            expect(deliveries.map(call => call[0])).toEqual(expected);
            expect(f.seen.filter(e => e[0] === 'audio-start')).toHaveLength(index + 1);
            const narrator = index === 0 || index === 3;
            expect(deliveries[index][2].characterId).toBe(narrator ? '__narrator__' : '2');
            if (index === 2) expect(deliveries[index][1]).toContain('Whisper');
            const start = f.seen.filter(e => e[0] === 'audio-start')[index][1];
            expect(start.kind).toBe(narrator ? 'narration' : index === 2 ? 'thought' : 'speech');
            f.runtime.completed(start.id);
        }
        await until(() => f.runtime.status.state === 'idle');
        expect(designCharacterVoice).toHaveBeenCalledTimes(1);
        const streamed = f.speech.mock.calls.filter(call => call[4]);
        expect(streamed[1][2].id).toBe(streamed[2][2].id);
        expect(streamed[2][1]).not.toContain(streamed[1][2].instruction);
        expect(streamed[2][1]).toContain("reference speaker's vocal texture and accent");
        expect(streamed[1][2].id).toBe(streamed[4][2].id);
        expect(streamed[0][2].id).toBe(streamed[3][2].id);
        expect(JSON.stringify(streamed)).not.toContain('Hidden canonical translation');
    } finally { f.runtime.shutdown(); }
});
test('starts with narrator preparation and keeps synthesis busy while narration plays without starting later playback', async () => {
    const f = fixture(root); f.settings.narrator = true;
    f.runtime.saveNarrator('Custom storyteller', 'A clear, measured storyteller.');
    f.view.editableContent = '**She nods.** ""Welcome."" **She smiles.** ""Come in.""';
    try {
        f.runtime.replay(f.conv, 'first');
        await until(() => f.speech.mock.calls.filter(call => call[4]).length === 4);
        const reference = f.speech.mock.calls.find(call => !call[4])!;
        expect(reference[2].characterId).toBe('__narrator__');
        expect(f.speech.mock.calls.filter(call => call[4]).map(call => call[0])).toEqual(['She nods.', 'Welcome.', 'She smiles.', 'Come in.']);
        expect(f.seen.filter(e => e[0] === 'audio-start')).toHaveLength(1);
        expect(f.seen.filter(e => e[0] === 'audio-chunk')).toHaveLength(1);
        f.runtime.pause(); await tick();
        expect(f.runtime.status.state).toBe('paused');
        expect(f.runtime.status.message).toContain('3 upcoming passages ready');
        expect(f.speech.mock.calls.filter(call => call[4])).toHaveLength(4);
        f.runtime.pause();
        const first = f.seen.find(e => e[0] === 'audio-start')![1].id;
        f.runtime.completed(first);
        await until(() => f.seen.filter(e => e[0] === 'audio-end').length === 2);
        expect(f.speech.mock.calls.filter(call => call[4])).toHaveLength(4);
        expect(f.seen.filter(e => e[0] === 'audio-start')[1][1].kind).toBe('speech');
    } finally { f.runtime.shutdown(); }
});
test('unfinished lookahead hands buffered bytes to playback and streams remaining bytes exactly once', async () => {
    const f = fixture(root); f.settings.narrator = true; f.view.editableContent = '**She nods.** ""Welcome.""';
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const ordinary = f.speech.getMockImplementation()!;
    f.speech.mockImplementation(async (text, instruction, profile, signal, onPCM) => {
        if (text !== 'Welcome.' || !onPCM) return ordinary(text, instruction, profile, signal, onPCM);
        await onPCM(Buffer.from([1])); await gate; signal.throwIfAborted(); await onPCM(Buffer.from([2, 3, 4])); return Buffer.alloc(0);
    });
    try {
        f.runtime.replay(f.conv, 'first');
        await until(() => f.speech.mock.calls.some(call => call[0] === 'Welcome.'));
        const first = f.seen.find(e => e[0] === 'audio-start')![1].id;
        expect(f.seen.filter(e => e[0] === 'audio-start')).toHaveLength(1);
        f.runtime.completed(first);
        await until(() => f.seen.filter(e => e[0] === 'audio-start').length === 2);
        const second = f.seen.filter(e => e[0] === 'audio-start')[1][1].id;
        expect(f.seen.filter(e => e[0] === 'audio-end')).toHaveLength(1);
        expect(Buffer.concat(f.seen.filter(e => e[0] === 'audio-chunk' && e[1] === second).map(e => e[2]))).toEqual(Buffer.from([1]));
        release(); await until(() => f.seen.filter(e => e[0] === 'audio-end').length === 2);
        expect(Buffer.concat(f.seen.filter(e => e[0] === 'audio-chunk' && e[1] === second).map(e => e[2]))).toEqual(Buffer.from([1, 2, 3, 4]));
        f.runtime.completed(second); await until(() => f.runtime.status.state === 'idle');
    } finally { release(); f.runtime.shutdown(); }
});
test('stop aborts the active future generation and never delivers its buffered bytes', async () => {
    const f = fixture(root); f.settings.narrator = true; f.view.editableContent = '**She nods.** ""Welcome.""';
    let prefetchedSignal: AbortSignal | undefined;
    const ordinary = f.speech.getMockImplementation()!;
    f.speech.mockImplementation(async (text, instruction, profile, signal, onPCM) => {
        if (text !== 'Welcome.' || !onPCM) return ordinary(text, instruction, profile, signal, onPCM);
        prefetchedSignal = signal; await onPCM(Buffer.from([1, 2]));
        await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Synthetic abort')), { once: true }));
        return Buffer.alloc(0);
    });
    try {
        f.runtime.replay(f.conv, 'first'); await until(() => !!prefetchedSignal);
        f.runtime.stop(); await tick(); await tick();
        expect(prefetchedSignal!.aborted).toBe(true);
        expect(f.seen.filter(e => e[0] === 'audio-start')).toHaveLength(1);
        expect(f.seen.filter(e => e[0] === 'audio-chunk')).toHaveLength(1);
        expect(f.runtime.status.state).toBe('idle');
    } finally { f.runtime.shutdown(); }
});
test('a failed lookahead lets the current narration finish then reports the error without speaking later text', async () => {
    const f = fixture(root); f.settings.narrator = true; f.view.editableContent = '**She nods.** ""Welcome."" **Later narration.**';
    const ordinary = f.speech.getMockImplementation()!;
    f.speech.mockImplementation(async (text, instruction, profile, signal, onPCM) => {
        if (text === 'Welcome.' && onPCM) throw new Error('Synthetic next-passage failure');
        return ordinary(text, instruction, profile, signal, onPCM);
    });
    try {
        f.runtime.replay(f.conv, 'first');
        await until(() => f.speech.mock.calls.some(call => call[0] === 'Welcome.')); await tick();
        expect(f.runtime.status.state).not.toBe('error');
        expect(f.seen.some(e => e[0] === 'audio-stop')).toBe(true); // Replay's initial reset only.
        const stops = f.seen.filter(e => e[0] === 'audio-stop').length;
        f.runtime.completed(f.seen.find(e => e[0] === 'audio-start')![1].id);
        await until(() => f.runtime.status.state === 'error');
        expect(f.runtime.status.message).toBe('Synthetic next-passage failure');
        expect(f.seen.filter(e => e[0] === 'audio-stop')).toHaveLength(stops + 1);
        expect(f.speech.mock.calls.some(call => call[0] === 'Later narration.')).toBe(false);
    } finally { f.runtime.shutdown(); }
});
test('stop invalidates pending replies and aborts the current stream; a new replay can reuse its saved identity', async () => {
    const f = fixture(root);
    try {
        f.runtime.enqueue(f.conv, f.source); f.runtime.enqueue(f.conv, { ...f.source, id: 'second' });
        await until(() => f.seen.some(e => e[0] === 'audio-start'));
        const active = f.speech.mock.calls.find(call => call[4])![3]; f.runtime.stop(); await tick();
        expect(active.aborted).toBe(true); expect(f.seen.filter(e => e[0] === 'audio-start')).toHaveLength(1);
        f.runtime.replay(f.conv, 'first'); await until(() => f.seen.filter(e => e[0] === 'audio-start').length === 2);
        expect(designCharacterVoice).toHaveBeenCalledTimes(1);
    } finally { f.runtime.shutdown(); }
});
test('a saved historical delivery retains its earlier age and voice revision after the character grows and is redesigned', async () => {
    const f = fixture(root);
    try {
        f.runtime.enqueue(f.conv, f.source); await until(() => f.seen.some(e => e[0] === 'audio-end'));
        const originalVoice = f.runtime.list().find(v => v.characterId === '2')!;
        f.runtime.completed(f.seen.find(e => e[0] === 'audio-start')![1].id); await tick();
        f.runtime.saveVoice(originalVoice.id, 'A different bright voice with graceful, flowing natural articulation.');
        f.actor.age = 80;
        f.runtime.replay(f.conv, 'first'); await until(() => f.seen.filter(e => e[0] === 'audio-end').length === 2);
        const last = f.speech.mock.calls.filter(call => call[4]).at(-1)!;
        expect(last[1]).toContain('mature adult'); expect(last[1]).not.toContain('elderly'); expect(last[2].id).toBe(originalVoice.id);
    } finally { f.runtime.shutdown(); }
});
test('editing delivered words keeps the original maturity while discarding stale delivery cues', async () => {
    const f = fixture(root); f.actor.age = 8;
    try {
        f.runtime.enqueue(f.conv, f.source); await until(() => f.seen.some(e => e[0] === 'audio-end'));
        f.runtime.completed(f.seen.find(e => e[0] === 'audio-start')![1].id); await tick();
        f.actor.age = 70; f.view.content = '"New heard sounds."'; f.view.editableContent = '""New heard sounds.""';
        f.runtime.replay(f.conv, 'first'); await until(() => f.seen.filter(e => e[0] === 'audio-end').length === 2);
        const last = f.speech.mock.calls.filter(call => call[4]).at(-1)!;
        expect(last[0]).toBe('New heard sounds.'); expect(last[1]).toContain('child'); expect(last[1]).not.toContain('elderly');
    } finally { f.runtime.shutdown(); }
});

test('new narrator descriptions reach unreferenced design, then exact custom preview words use that new reference', async () => {
    const f = fixture(root);
    try {
        const a = f.runtime.saveNarrator('First', 'A youthful male tenor with crisp American pronunciation and quick, lively articulation.');
        await f.runtime.previewVoice(a.id);
        const b = f.runtime.saveNarrator('Second', 'A low male baritone with dry grain, American pronunciation and slow deliberate articulation.');
        expect(b.id).not.toBe(a.id); expect(b.referenceFile).toBeUndefined();
        await f.runtime.previewVoice(b.id, undefined, 'My silly sentence should be spoken exactly.');
        const design = f.speech.mock.calls.at(-2)!; expect(design[1]).toContain(b.instruction); expect(design[2].referenceFile).toBeUndefined();
        const delivery = f.speech.mock.calls.at(-1)!; expect(delivery[0]).toBe('My silly sentence should be spoken exactly.');
        expect(delivery[2].id).toBe(b.id); expect(delivery[2].referenceFile).toBeTruthy();
        expect(f.runtime.list().find(v => v.id === b.id)?.active).toBe(true);
        expect(f.runtime.list().find(v => v.id === a.id)?.active).toBe(false);
        f.runtime.selectVoice(a.id); expect(f.runtime.list().find(v => v.id === a.id)?.active).toBe(true);
    } finally { f.runtime.shutdown(); }
});

test('editing an old narrator revision never clones its old WAV; an existing preview keeps its original transcript', async () => {
    const f = fixture(root);
    try {
        const old = f.runtime.saveNarrator('Old', 'A clear gentle female voice with light breath and rounded natural articulation.');
        await f.runtime.previewVoice(old.id);
        const oldReference = f.runtime.list().find(v => v.id === old.id)!; const bytes = fs.readFileSync(oldReference.referenceFile!);
        const edited = f.runtime.saveVoice(old.id, 'A deep rough male bass voice with short, clipped phrases and American pronunciation.');
        await f.runtime.previewVoice(edited.id, undefined, 'Different spoken words.');
        expect(f.speech.mock.calls.at(-2)![2]).toMatchObject({ id: edited.id, instruction: edited.instruction });
        expect(f.speech.mock.calls.at(-2)![2].referenceFile).toBeUndefined();
        expect(f.speech.mock.calls.at(-1)![0]).toBe('Different spoken words.');
        expect(fs.readFileSync(oldReference.referenceFile!)).toEqual(bytes);
        expect(f.runtime.list().find(v => v.id === edited.id)?.referenceText).toBe(oldReference.referenceText);
        await expect(f.runtime.previewVoice(edited.id, undefined, '')).rejects.toThrow('preview words');
    } finally { f.runtime.shutdown(); }
});

test('deleting a voice bound to a recorded reply blocks replay rather than substituting the current character', async () => {
    const f = fixture(root);
    try {
        f.runtime.enqueue(f.conv, f.source); await until(() => f.seen.some(e => e[0] === 'audio-end'));
        const old = f.runtime.list().find(v => v.characterId === '2')!;
        f.runtime.completed(f.seen.find(e => e[0] === 'audio-start')![1].id); await tick();
        f.runtime.saveVoice(old.id, 'A bright contrasting voice with rapid flowing natural articulation.');
        f.runtime.deleteVoice(old.id);
        expect(() => f.runtime.replay(f.conv, 'first')).toThrow('saved voice for this replay was deleted');
    } finally { f.runtime.shutdown(); }
});

test('character preview uses that character’s reference even when a different narrator is active', async () => {
    const f = fixture(root);
    try {
        f.runtime.enqueue(f.conv, f.source); await until(() => f.seen.some(e => e[0] === 'audio-end'));
        const character = f.runtime.list().find(v => v.characterId === '2')!;
        f.runtime.completed(f.seen.find(e => e[0] === 'audio-start')![1].id); await tick();
        const narrator = f.runtime.saveNarrator('Narrator', 'A quiet female voice with soft breath and slow, rounded natural articulation.');
        await f.runtime.previewVoice(narrator.id);
        await f.runtime.previewCharacter(f.conv, 2, 'The character says these words.');
        expect(f.speech.mock.calls.at(-1)![0]).toBe('The character says these words.');
        expect(f.speech.mock.calls.at(-1)![2].id).toBe(character.id);
    } finally { f.runtime.shutdown(); }
});

test('player narrator prompts accept short descriptions and reject blank descriptions', () => {
    const f = fixture(root);
    try {
        expect(f.runtime.saveNarrator('Short prompt', 'Young male, American.').instruction).toBe('Young male, American.');
        expect(() => f.runtime.saveNarrator('Blank', ' ')).toThrow('voice description');
    } finally { f.runtime.shutdown(); }
});

test('narrator auditions never populate the saved library, reuse their reference and commit its exact recording and seed once', async () => {
    const f = fixture(root);
    try {
        const prompt = 'A deep dry male voice with careful American articulation.';
        const first = await f.runtime.previewNarratorDraft(prompt);
        expect(f.runtime.list()).toEqual([]);
        const second = await f.runtime.previewNarratorDraft(prompt, 'Different test words.');
        expect(second.draftId).toBe(first.draftId);
        expect(f.runtime.list()).toEqual([]);
        const reference = f.speech.mock.calls.at(-1)![2];
        const original = fs.readFileSync(reference.referenceFile!);
        expect(f.speech.mock.calls.filter(c => !c[2].referenceFile)).toHaveLength(1);
        const saved = f.runtime.saveNarratorDraft(second.draftId, '  My narrator  ');
        expect(saved.label).toBe('My narrator'); expect(saved.id).not.toBe(second.draftId);
        expect(saved.seed).toBe(reference.seed); expect(saved.referenceText).toBe(reference.referenceText);
        expect(saved.referenceMetadata).toEqual(reference.referenceMetadata);
        expect(fs.readFileSync(saved.referenceFile!)).toEqual(original);
        const speechCalls = f.speech.mock.calls.length;
        expect(f.runtime.saveNarratorDraft(second.draftId, 'Renamed').id).toBe(saved.id);
        expect(f.runtime.list()).toHaveLength(1); expect(f.speech).toHaveBeenCalledTimes(speechCalls);
        f.runtime.discardNarratorDraft(); expect(fs.existsSync(reference.referenceFile!)).toBe(false);
        expect(fs.readFileSync(saved.referenceFile!)).toEqual(original);
    } finally { f.runtime.shutdown(); }
});
test('changing an audition replaces only its disposable reference and leaves saved narrators untouched', async () => {
    const f = fixture(root);
    try {
        const saved = f.runtime.saveNarrator('Keep me', 'A warm male voice.'); await f.runtime.previewVoice(saved.id);
        const old = f.runtime.list()[0], wav = fs.readFileSync(old.referenceFile!);
        const a = await f.runtime.previewNarratorDraft('A bright female voice.', 'First words.');
        const temporary = f.speech.mock.calls.at(-1)![2].referenceFile!;
        const b = await f.runtime.previewNarratorDraft('A rough male voice.', 'Second words.');
        expect(a.draftId).not.toBe(b.draftId); expect(fs.existsSync(temporary)).toBe(false);
        expect(f.runtime.list()).toHaveLength(1); expect(f.runtime.list()[0]).toMatchObject({ id: old.id, active: true });
        expect(fs.readFileSync(old.referenceFile!)).toEqual(wav);
        expect(() => f.runtime.saveNarratorDraft(a.draftId, 'Stale')).toThrow('Preview this narrator again');
    } finally { f.runtime.shutdown(); }
});
test('cancelled narrator auditions cannot write a late reference or add a saved narrator', async () => {
    const f = fixture(root); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.speech.mockImplementation(async () => { await gate; return pcmToWav(Buffer.alloc(960)); });
    const pending = f.runtime.previewNarratorDraft('A soft young adult male voice.');
    void pending.catch(() => {});
    try {
        await until(() => f.speech.mock.calls.length === 1);
        f.runtime.discardNarratorDraft(); release(); await expect(pending).rejects.toThrow();
        expect(f.runtime.list()).toEqual([]);
    } finally { release(); f.runtime.shutdown(); }
});
test('failed auditions and invalid commit names cannot create saved voices', async () => {
    const f = fixture(root);
    try {
        f.speech.mockRejectedValueOnce(new Error('Synthetic synthesis failure'));
        await expect(f.runtime.previewNarratorDraft('A clear adult voice.')).rejects.toThrow('Synthetic synthesis failure');
        expect(f.runtime.list()).toEqual([]);
        const draft = await f.runtime.previewNarratorDraft('A clear adult voice.');
        expect(() => f.runtime.saveNarratorDraft(draft.draftId, ' ')).toThrow('voice name');
        expect(f.runtime.list()).toEqual([]);
        f.runtime.changed(); expect(() => f.runtime.saveNarratorDraft(draft.draftId, 'Stale')).toThrow('Preview this narrator again');
    } finally { f.runtime.shutdown(); }
});
test('draft disposal on shutdown removes the temporary recording without deleting a committed narrator', async () => {
    const f = fixture(root);
    await f.runtime.previewNarratorDraft('A clear adult voice.', 'Test words.');
    const profile = f.speech.mock.calls.at(-1)![2];
    const saved = f.runtime.saveNarratorDraft(profile.id, 'Saved');
    f.runtime.shutdown(); expect(fs.existsSync(profile.referenceFile!)).toBe(false);
    expect(fs.existsSync(saved.referenceFile!)).toBe(true);
});

test('an automatic hosting fallback records the actual model while preserving the player’s selected setting', async () => {
    const f = fixture(root); f.settings.hosting = 'managed'; f.settings.managedModel = 'hoppou-f16';
    jest.spyOn(f.runtime.managed, 'start').mockImplementation(async () => { f.runtime.managed.activeModel = 'hoppou-q8'; });
    try {
        const voice = f.runtime.saveNarrator('Fallback', 'Young male, American.'); await f.runtime.previewVoice(voice.id);
        const saved = f.runtime.list().find(v => v.id === voice.id)!;
        expect(saved.referenceMetadata?.runtime).toBe('hoppou-q8'); expect(saved.referenceMetadata?.model).toContain('hoppou-q8:');
        expect(f.settings.managedModel).toBe('hoppou-f16');
    } finally { f.runtime.shutdown(); }
});

test('automatic verified reference bypasses ordinary design, remains frozen on replay, and can be opted out', async () => {
    const f = fixture(root), source = cloneFixture(path.join(root, 'source')), bank = readCloneBank(source.folder);
    f.runtime.importCloneBank(source.file);
    const capture = jest.spyOn(cloneRuntime, 'captureCloneForAudio').mockResolvedValue({ id: 'garrosh', key: bank.key, ambiguous: false });
    const catalog = jest.spyOn(cloneCapture, 'bundledCloneCatalog').mockReturnValue({ profiles: { [bank.key]: { name: bank.name, manifestHash: readCloneBank(source.folder).manifestHash } } } as any);
    try {
        f.runtime.enqueue(f.conv, f.source); await until(() => f.seen.some(e => e[0] === 'audio-end'));
        expect(capture).toHaveBeenCalledTimes(1); expect(designCharacterVoice).not.toHaveBeenCalled();
        expect(f.speech.mock.calls[0][2].referenceText).toBe(source.text);
        expect(f.speech.mock.calls[0][1]).not.toMatch(/age|culture|Race|Sex|goblin/);
        for (const e of f.seen.filter(e => e[0] === 'audio-end')) f.runtime.completed(e[1]);
        await tick(); f.seen.length = 0; capture.mockClear();
        f.runtime.bindClone(f.conv, 2); f.runtime.replay(f.conv, 'first');
        await until(() => f.seen.some(e => e[0] === 'audio-end'));
        expect(capture).not.toHaveBeenCalled(); expect(designCharacterVoice).not.toHaveBeenCalled();
        f.runtime.stop(); f.seen.length = 0; f.runtime.enqueue(f.conv, { ...f.source, id: 'second' });
        await until(() => f.seen.some(e => e[0] === 'audio-end'));
        expect(capture).not.toHaveBeenCalled(); expect(designCharacterVoice).toHaveBeenCalledTimes(1);
        f.runtime.bindClone(f.conv, 2, '__auto__'); expect(f.runtime.cloneMode(f.conv, 2)).toBe('auto');
    } finally { f.runtime.shutdown(); capture.mockRestore(); catalog.mockRestore(); }
});
test('ambiguous forms and uncovered participants retain ordinary casting', async () => {
    const f = fixture(root), capture = jest.spyOn(cloneRuntime, 'captureCloneForAudio').mockResolvedValue({ id: '60003', ambiguous: true });
    try { f.runtime.enqueue(f.conv, f.source); await until(() => f.seen.some(e => e[0] === 'audio-end')); expect(designCharacterVoice).toHaveBeenCalledTimes(1); }
    finally { f.runtime.shutdown(); capture.mockRestore(); }
});
test('disabled Audio and explicit bindings never request automatic identity capture', async () => {
    const f = fixture(root, false), capture = jest.spyOn(cloneRuntime, 'captureCloneForAudio');
    try {
        f.runtime.enqueue(f.conv, f.source); await tick(); expect(capture).not.toHaveBeenCalled();
        f.settings.enabled = true; const source = cloneFixture(path.join(root, 'source')), bank = f.runtime.importCloneBank(source.file); f.runtime.bindClone(f.conv, 2, bank.key);
        f.runtime.enqueue(f.conv, f.source); await until(() => f.seen.some(e => e[0] === 'audio-end')); expect(capture).not.toHaveBeenCalled();
    } finally { f.runtime.shutdown(); capture.mockRestore(); }
});
test('automatic identity capture failure stops before managed GPU loading or generated fallback', async () => {
    const f = fixture(root), capture = jest.spyOn(cloneRuntime, 'captureCloneForAudio').mockRejectedValue(new Error('capture not ready'));
    f.settings.hosting = 'managed'; const start = jest.spyOn(f.runtime.managed, 'start');
    try { f.runtime.enqueue(f.conv, f.source); await until(() => f.runtime.status.state === 'error'); expect(start).not.toHaveBeenCalled(); expect(designCharacterVoice).not.toHaveBeenCalled(); }
    finally { f.runtime.shutdown(); capture.mockRestore(); start.mockRestore(); }
});

test('character design cannot delay the first complete opening narration', async () => {
    const f = fixture(root); f.settings.narrator = true;
    f.view.editableContent = '**The wind falls still. The door opens slowly.** ""Welcome.""';
    let release!: () => void; const blocked = new Promise<void>(resolve => {release=resolve});
    (designCharacterVoice as jest.Mock).mockImplementationOnce(async()=>{await blocked;return {instruction:'A clear adult fixture voice.',provenance:'synthetic'}});
    try {
        f.runtime.enqueue(f.conv,f.source);
        await until(()=>f.seen.some(e=>e[0]==='audio-end'));
        expect(f.speech.mock.calls.filter(call=>call[4]).map(call=>call[0])).toEqual(['The wind falls still.','The door opens slowly.']);
        expect(f.seen.find(e=>e[0]==='audio-start')![1].kind).toBe('narration');
        expect(f.speech.mock.calls.some(call=>call[2].characterId==='2')).toBe(false);
        release();await until(()=>f.speech.mock.calls.some(call=>call[4]&&call[2].characterId==='2'));
    } finally { release();f.runtime.shutdown(); }
});
test.each([false,true])('current undeath changes only delivery, reuses the exact reference, and freezes replay; older unknown=%s',async legacy=>{
    const f=fixture(root);let dead=false;
    const capture=jest.spyOn(maturationRuntime,'captureMaturityForAudio').mockResolvedValue('adult');
    const facts=jest.spyOn(maturationRuntime,'currentUndeadFacts').mockImplementation(()=>({undead:dead,specialized:false}));
    (designCharacterVoice as jest.Mock).mockResolvedValueOnce({instruction:'A clear, warm individual voice.',provenance:legacy?'legacy saved voice':JSON.stringify({undead:{version:1,reference:'uncolored'}})});
    const identities:string[]=[],references:Buffer[]=[],plans:any[]=[];
    async function play(id:string){
        f.view.id=id;f.view.editableContent='""The gate is shut."" ~~I should wait.~~';f.seen.length=0;
        const mark=f.speech.mock.calls.length;f.runtime.enqueue(f.conv,{...f.source,id});await until(()=>f.speech.mock.calls.slice(mark).filter(c=>c[4]).length===2);
        const calls=f.speech.mock.calls.slice(mark).filter(c=>c[4]);
        for(const c of calls){expect(c[5].undead).toBe(dead&&!legacy);expect(c[1].includes('Speak through a damaged throat with a coarse, scraping rasp.')).toBe(dead&&!legacy);}
        expect(calls[1][1]).toContain('Whisper throughout');expect(calls.map(c=>c[0])).toEqual(['The gate is shut.','I should wait.']);
        identities.push(calls[0][2].id);references.push(fs.readFileSync(calls[0][2].referenceFile!));plans.push((f.runtime as any).store().plan('campaign-a','1',id));
        f.runtime.stop();await until(()=>!(f.runtime as any).draining);
    }
    try{
        await play('alive');dead=true;await play('dead');dead=false;await play('alive-again');
        expect(new Set(identities).size).toBe(1);expect(references[1]).toEqual(references[0]);expect(references[2]).toEqual(references[0]);
        expect(plans[1].undead.treatment).toBe(legacy?'preserve':'damaged-throat');expect(plans[2].undead.reason).toBe('currently-living');
        expect(designCharacterVoice).toHaveBeenCalledTimes(1);expect(f.runtime.list()).toHaveLength(1);
        f.speech.mockClear();f.seen.length=0;f.view.id='dead';f.runtime.replay(f.conv,'dead');await until(()=>f.speech.mock.calls.filter(c=>c[4]).length===2);
        expect(capture).toHaveBeenCalledTimes(3);expect(f.speech.mock.calls[0][5].undead).toBe(!legacy);expect(f.speech.mock.calls[0][2].id).toBe(identities[0]);
    }finally{f.runtime.shutdown();capture.mockRestore();facts.mockRestore()}
});

test.each(['unknown','older','elderly','mismatched'] as const)('current old age cannot re-age a %s reference baseline',async baseline=>{
    const f=fixture(root),source=cloneFixture(path.join(root,'source')),bank=f.runtime.importCloneBank(source.file);
    const catalog=jest.spyOn(cloneCapture,'bundledCloneCatalog').mockReturnValue({version:1,profiles:{[bank.key]:{name:bank.name,manifestHash:baseline==='mismatched'?'0'.repeat(64):readCloneBank(source.folder).manifestHash,...(baseline==='unknown'?{}:{referenceAge:baseline==='mismatched'?'adult':baseline})}},identities:{},history:{}});
    const facts={ambiguous:false,aging:{ageless:false,longLived:false}};
    const capture=jest.spyOn(cloneRuntime,'captureCloneForAudio').mockResolvedValue(facts),observed=jest.spyOn(cloneRuntime,'cloneObservation').mockReturnValue(facts);
    try{
        f.runtime.bindClone(f.conv,2,bank.key);f.actor.age=baseline==='older'?60:75;
        await f.runtime.previewCharacter(f.conv,2,'Exact old voice words.');
        expect(f.speech.mock.calls[0][5].cloneAge).toBeUndefined();expect(f.speech.mock.calls[0][1]).not.toMatch(/sounding old/);
        // An old saved delivery request cannot bypass source qualification on a fresh preview.
        await f.runtime.previewVoice(f.speech.mock.calls[0][2].id,undefined,'Exact old voice words.','older');
        expect(f.speech.mock.calls[1][5].cloneAge).toBeUndefined();
    }finally{f.runtime.shutdown();capture.mockRestore();observed.mockRestore();catalog.mockRestore()}
});

test.each(['openai-speech','elevenlabs'] as const)('completed %s playback persists a replayable receipt across restart',async provider=>{
    const f=fixture(root);f.settings.provider=provider;f.settings.sideVoiceId='fixture-voice';f.settings.endpoint='https://fixture.invalid';
    const original=global.fetch;global.fetch=jest.fn(async()=>new Response(Buffer.alloc(960),{headers:{'content-type':'audio/pcm'}}));
    try {
        f.runtime.enqueue(f.conv,f.source);await until(()=>f.seen.some(e=>e[0]==='audio-end'));
        f.runtime.completed(f.seen.find(e=>e[0]==='audio-start')![1].id);await until(()=>!(f.runtime as any).draining);
        const library=(f.runtime as any).store(),saved=library.plan('campaign-a','1','first');expect(saved).toMatchObject({pending:false,audioState:'completed',provider});
        // Preview builds persisted pending:true even after successful optional playback.
        const preview={...saved,pending:true};delete preview.provider;delete preview.audioState;
        library.savePlan('campaign-a','1','first',createHash('sha256').update(JSON.stringify([f.view.content,f.view.editableContent])).digest('hex'),preview);
        f.runtime.shutdown();const second=fixture(root);second.settings.provider=provider;second.settings.sideVoiceId='fixture-voice';second.settings.endpoint='https://fixture.invalid';
        second.conv.getHistory=()=>[];second.conv.getEncounterCharacter=()=>undefined;second.conv.historicalConversations=[{messages:[second.view]}] as any;
        try {expect(()=>second.runtime.replay(second.conv,'first')).not.toThrow();await until(()=>second.seen.some(e=>e[0]==='audio-end'));}
        finally {second.runtime.shutdown();}
    } finally {global.fetch=original;f.runtime.shutdown();}
});
test('muted narration and preview pending narration receipts can use the storyteller later',async()=>{
    const f=fixture(root);f.settings.narrator=false;f.view.editableContent='**The room falls quiet.**';
    try {
        f.runtime.enqueue(f.conv,f.source);await until(()=>!(f.runtime as any).draining);
        const library=(f.runtime as any).store(),saved=library.plan('campaign-a','1','first');expect(saved).toMatchObject({pending:false,audioState:'muted'});
        // Preview receipts lacked the explicit muted/completed distinction.
        library.savePlan('campaign-a','1','first',createHash('sha256').update(JSON.stringify([f.view.content,f.view.editableContent])).digest('hex'),{...saved,pending:true});
        f.settings.narrator=true;f.conv.getHistory=()=>[];f.conv.historicalConversations=[{messages:[f.view]}] as any;
        expect(()=>f.runtime.replay(f.conv,'first')).not.toThrow();await until(()=>f.seen.some(e=>e[0]==='audio-end'));
    } finally {f.runtime.shutdown();}
});

test.each(['openai-speech','elevenlabs'] as const)('optional %s character preview uses the selected speech service without designing a Breeze voice',async provider=>{
    const f=fixture(root);f.settings.provider=provider;
    const design=designCharacterVoice as jest.Mock;design.mockClear();
    const side=jest.spyOn(require('../../src/main/audio/SideSpeechProvider'),'sideSpeech').mockImplementation(async(...args:any[])=>{await args[4](Buffer.alloc(80));});
    try{
        const before=f.runtime.list();const result=await f.runtime.previewCharacter(f.conv,2,'Exact optional preview.');
        expect(result.subarray(0,4).toString()).toBe('RIFF');expect(side).toHaveBeenCalledTimes(1);expect(side.mock.calls[0][1]).toBe('Exact optional preview.');
        expect(design).not.toHaveBeenCalled();expect(f.runtime.list()).toEqual(before);
    } finally {side.mockRestore();f.runtime.shutdown();}
});
