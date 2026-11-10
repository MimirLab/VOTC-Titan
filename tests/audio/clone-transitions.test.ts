import fs from 'fs';
import os from 'os';
import path from 'path';
import * as catalogModule from '../../src/main/audio/cloneCapture';
import { configureCloneCapture, currentCloneCapture, observeCloneLine, captureCloneForAudio } from '../../src/main/audio/cloneRuntime';
import { AudioLibrary } from '../../src/main/audio/AudioLibrary';
import * as goaRuntime from '../../src/main/goa/goaRuntime';
import { CloneBanks } from '../../src/main/audio/CloneBanks';

let root: string;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'titan-clone-transition-'))});
afterEach(()=>{configureCloneCapture({audio:{enabled:false}} as any);jest.restoreAllMocks();fs.rmSync(root,{recursive:true,force:true})});
function setup(identity: string, agingEnabled=false) {
    const voices=catalogModule.bundledCloneCatalog()!, catalog={voices,ids:Object.keys(voices.identities),digest:'a'.repeat(64)};
    jest.spyOn(catalogModule,'buildCloneCapture').mockReturnValue(catalog);
    if(agingEnabled)jest.spyOn(goaRuntime,'currentGoaCatalog').mockReturnValue({digest:'b'.repeat(64),longLivedIds:['creature_elf']} as any);
    let aging={ageless:false,longLived:false};
    let traits: string[]=[];const scripts: string[]=[];
    fs.mkdirSync(path.join(root,'run'));
    configureCloneCapture({audio:{enabled:true},userFolderPath:root,cultureGameInstallPath:'fixture'} as any,()=>{
        const file=path.join(root,'run/votc.txt');if(!fs.existsSync(file))return;
        const script=fs.readFileSync(file,'utf8'),nonce=script.match(/VOTC:TITAN:PROBE\/;\/([a-f0-9]{24})/);if(!nonce)return;
        const digest=currentCloneCapture()!.digest;scripts.push(script);observeCloneLine(`VOTC:CLONE/;/begin/;/${digest}/;/1229`);
        observeCloneLine(`VOTC:CLONE/;/match/;/${identity}`);
        for(const t of catalogModule.CLONE_FORM_TRAITS)observeCloneLine(`VOTC:CLONE/;/form/;/${t}/;/${traits.includes(t)?1:0}`);
        if(agingEnabled)for(const [k,v]of Object.entries(aging))observeCloneLine(`VOTC:CLONE/;/aging/;/${k}/;/${v?1:0}`);
        observeCloneLine(`VOTC:CLONE/;/end/;/${digest}/;/1229`);observeCloneLine(`VOTC:ENCOUNTER/;/ack/;/${nonce[1]}`);
    });
    const actor={id:1229,goaSnapshot:{traitIds:['being_undead','lich_king']}} as any;
    const game={playerID:1229,aiID:1229,characters:new Map([[1229,actor]])} as any;
    return {actor,scripts,setAging(v:typeof aging){aging=v},async read(next: string[],refreshAging=false){traits=next;return captureCloneForAudio(actor,game,new AbortController().signal,{refreshAging})}};
}
test('one encountered Illidan follows metamorphosis and reversal, reusing the original recorded profile',async()=>{
    const f=setup('340009'),banks=new CloneBanks(catalogModule.BUNDLED_CLONES),library=new AudioLibrary(path.join(root,'voices'));
    try {
        const first=await f.read([]),base=library.importClone('campaign','1229',banks.load(first!.key!));
        const changed=await f.read(['metamorphosis']),morph=library.importClone('campaign','1229',banks.load(changed!.key!));
        const back=await f.read([]),again=library.importClone('campaign','1229',banks.load(back!.key!));
        expect(base.id).not.toBe(morph.id);expect(again.id).toBe(base.id);expect(library.list()).toHaveLength(2);
        expect(f.scripts).toHaveLength(3);expect(f.scripts[0]).toContain('character:60003');
        for(const script of f.scripts.slice(1)){expect(script).toContain('this = character:340009');expect(script).not.toContain('character:60003');expect(script).toContain('root = {')}
    }finally{library.close()}
});
test('current traits override a stale general snapshot and follow living, undead, Lich King and living again',async()=>{
    const f=setup('60003');
    expect((await f.read([]))!.key).toBe('goa2-60003-wc3-arthas/v0001');
    expect((await f.read(['being_undead']))!.key).toBe('goa2-60003-wc3-arthas2/v0001');
    expect((await f.read(['being_undead','lich_king']))!.key).toBe('goa2-60003-hots-lichking/v0001');
    expect((await f.read([]))!.key).toBe('goa2-60003-wc3-arthas/v0001');expect(f.scripts).toHaveLength(4);
});
test('a stable identity without form variants reuses its observation without another game probe',async()=>{
    const f=setup('10021');expect((await f.read([]))!.key).toBe('goa2-10021-hots-thrallbase/v0001');
    await f.read([]);expect(f.scripts).toHaveLength(1);expect(currentCloneCapture()!.ids).toHaveLength(407);
});

test('older stable Thrall refreshes only his participant flags on each new performance, including immortality gained and lost',async()=>{
    const f=setup('10021',true);expect((await f.read([],true))!.aging).toEqual({ageless:false,longLived:false});
    f.setAging({ageless:true,longLived:false});expect((await f.read([],true))!.aging!.ageless).toBe(true);
    f.setAging({ageless:false,longLived:true});expect((await f.read([],true))!.aging!.longLived).toBe(true);
    f.setAging({ageless:false,longLived:false});expect((await f.read([],true))!.aging).toEqual({ageless:false,longLived:false});
    expect(f.scripts).toHaveLength(4);for(const script of f.scripts.slice(1)){expect(script).toContain('character:10021');expect(script).not.toContain('character:60003');expect(script).toContain('no_aging_penalties')}
});
