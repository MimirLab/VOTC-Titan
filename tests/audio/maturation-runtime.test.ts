import fs from 'fs';
import path from 'path';
import os from 'os';
import { configureMaturationCapture, captureMaturityForAudio, observeMaturationLine, currentUndeadFacts } from '../../src/main/audio/maturationRuntime';
import { MATURATION_DIGEST, MaturityStage } from '../../src/main/audio/maturation';
import * as goa from '../../src/main/goa/goaRuntime';
let root:string;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'titan-maturity-'));fs.mkdirSync(path.join(root,'run'))});
afterEach(()=>{configureMaturationCapture({audio:{enabled:false}} as any);jest.restoreAllMocks();fs.rmSync(root,{recursive:true,force:true})});
test('base-game newly encountered children mature in one encounter with a fresh scope probe each time, without a GoA catalog',async()=>{
    const actor={id:99991,age:2} as any,game={playerID:1,characters:new Map([[99991,actor]])} as any;
    let stage:MaturityStage='young-child',calls=0;
    configureMaturationCapture({audio:{enabled:true},userFolderPath:root} as any,()=>{
        const f=path.join(root,'run/votc.txt');if(!fs.existsSync(f))return;
        const s=fs.readFileSync(f,'utf8'),nonce=s.match(/VOTC:TITAN:PROBE\/;\/([a-f0-9]{24})/);if(!nonce)return;
        calls++;expect(s).toContain('ordered_in_global_list');expect(s).not.toMatch(/VOTC:GOA|VOTC:CLONE|every_(?:living_)?character\s*=/);
        observeMaturationLine(`VOTC:MATURITY/;/begin/;/${MATURATION_DIGEST}/;/99991`);observeMaturationLine(`VOTC:MATURITY/;/stage/;/${stage}`);for(const category of ['personality','childhood']){observeMaturationLine(`VOTC:MATURITY/;/traits_begin/;/${category}`);observeMaturationLine(`VOTC:MATURITY/;/traits_end/;/${category}`)}observeMaturationLine(`VOTC:MATURITY/;/end/;/${MATURATION_DIGEST}/;/99991`);observeMaturationLine(`VOTC:ENCOUNTER/;/ack/;/${nonce[1]}`);
    });
    for(const s of ['young-child','child','adolescent','adult','adult'] as const){stage=s;expect(await captureMaturityForAudio(actor,game,new AbortController().signal)).toBe(s)}
    expect(calls).toBe(5);expect(actor.age).toBe(2);
});
test('disabled audio writes no probe and aborted work cannot start capture',async()=>{
    configureMaturationCapture({audio:{enabled:false},userFolderPath:root} as any);
    expect(await captureMaturityForAudio({id:2} as any,{} as any,new AbortController().signal)).toBeUndefined();expect(fs.readdirSync(path.join(root,'run'))).toEqual([]);
    const c=new AbortController();c.abort();await expect(captureMaturityForAudio({id:2} as any,{} as any,c.signal)).rejects.toThrow();
});
test('fresh undead facts share one maturity probe, reverse in one encounter, and missing frames cannot reuse the last state',async()=>{
    jest.spyOn(goa,'currentGoaCatalog').mockReturnValue({digest:'c'.repeat(64),traitIds:['being_undead','creature_lich']} as any);
    const actor={id:22,goaSnapshot:{traitIds:['creature_troll']}} as any,game={playerID:1,characters:new Map([[22,actor]])} as any;
    const before=JSON.stringify(actor);let dead=false,omit=false,calls=0;
    configureMaturationCapture({audio:{enabled:true,provider:'breeze'},userFolderPath:root} as any,()=>{
        const file=path.join(root,'run/votc.txt');if(!fs.existsSync(file))return;
        const s=fs.readFileSync(file,'utf8'),nonce=s.match(/VOTC:TITAN:PROBE\/;\/([a-f0-9]{24})/);if(!nonce)return;
        calls++;expect(s).not.toMatch(/VOTC:GOA|VOTC:DEVELOPMENT|has_culture|has_faith|every_living_character/);
        observeMaturationLine(`VOTC:MATURITY/;/begin/;/${MATURATION_DIGEST}/;/22`);observeMaturationLine('VOTC:MATURITY/;/stage/;/adult');
        for(const c of ['personality','childhood']){observeMaturationLine(`VOTC:MATURITY/;/traits_begin/;/${c}`);observeMaturationLine(`VOTC:MATURITY/;/traits_end/;/${c}`)}
        observeMaturationLine(`VOTC:MATURITY/;/end/;/${MATURATION_DIGEST}/;/22`);
        const digest=s.match(/VOTC:UNDEAD\/;\/begin\/;\/([a-f0-9]{64})/)![1];
        if(!omit){observeMaturationLine(`VOTC:UNDEAD/;/begin/;/${digest}/;/22`);observeMaturationLine(`VOTC:UNDEAD/;/fact/;/undead/;/${dead?1:0}`);observeMaturationLine('VOTC:UNDEAD/;/fact/;/specialized/;/0');observeMaturationLine(`VOTC:UNDEAD/;/end/;/${digest}/;/22`)}
        observeMaturationLine(`VOTC:ENCOUNTER/;/ack/;/${nonce[1]}`);
    });
    for(const v of [false,true,false]){dead=v;await captureMaturityForAudio(actor,game,new AbortController().signal);expect(currentUndeadFacts(actor)).toEqual({undead:v,specialized:false})}
    omit=true;await expect(captureMaturityForAudio(actor,game,new AbortController().signal)).rejects.toThrow('undead voice state');
    expect(currentUndeadFacts(actor)).toBeUndefined();expect(calls).toBe(4);expect(JSON.stringify(actor)).toBe(before);
});
