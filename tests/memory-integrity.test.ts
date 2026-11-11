import fs from 'fs';
import os from 'os';
import path from 'path';
import {MemoryManager,Memory} from '../src/main/memoryManager';
let root:string,store:MemoryManager;
const row=(id:string,player='1',vector=[1,0]):Memory=>({id,characterId:'2',playerId:player,text:'from-player-'+player+' '+id,vector,timestamp:1000,emotion:'neutral',decay:0,accessCount:0,lastAccessed:1000});
const indexed=()=>((store as any).db.prepare('SELECT count(*) n FROM memory_vectors').get()as any).n;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'titan-memory-integrity-'));store=new MemoryManager(root,2);expect(store.isVecAvailable()).toBe(true);jest.spyOn(console,'log').mockImplementation(()=>{});jest.spyOn(console,'warn').mockImplementation(()=>{});});
afterEach(()=>{store.close();jest.restoreAllMocks();fs.rmSync(root,{recursive:true,force:true});});
test('a wrong-length rebuild leaves the old vector index and base embeddings usable',async()=>{
 store.insertMemory(row('one'));const before=store.getMemoriesByCharacter('2')[0];
 await expect(store.reindexMemories(async()=>[1,0],3)).resolves.toMatchObject({embedded:0,failed:1});
 expect(indexed()).toBe(1);expect([...store.getMemoriesByCharacter('2')[0].vector]).toEqual([...before.vector]);
 expect(store.searchSimilar('2',[1,0])[0].id).toBe('one');
});
test('successful reindex changes the live dimension for immediate search and insert',async()=>{
 store.insertMemory(row('one'));await store.reindexMemories(async()=>[1,0,0],3);
 expect(store.searchSimilar('2',[1,0,0])[0].id).toBe('one');store.insertMemory(row('two','1',[0,1,0]));
 expect(indexed()).toBe(2);expect(store.searchSimilar('2',[0,1,0])[0].id).toBe('two');
 expect(store.getStoredEmbeddingDimensions()).toEqual([3]);
});
test('a differently configured observer cannot destroy the existing index',()=>{
 store.insertMemory(row('one'));const observer=new MemoryManager(root,3);
 try{expect(observer.dimensionMismatchDetected).toBe(true);expect(indexed()).toBe(1);}finally{observer.close();}
});
test('failed and cancelled rebuilds keep every old searchable row',async()=>{
 store.insertMemory(row('one'));store.insertMemory(row('two'));
 const result=await store.reindexMemories(async text=>{if(text.includes('two'))throw Error('provider failed');return[1,0,0];},3);
 expect(result.embedded).toBe(0);expect(indexed()).toBe(2);
 await expect(store.reindexMemories(async()=>{throw Object.assign(Error('cancelled'),{name:'AbortError'});},3)).rejects.toMatchObject({name:'AbortError'});
 expect(indexed()).toBe(2);
});
test('upkeep keeps the same NPC memories independent for different players',()=>{
 store.insertMemory(row('one','1'));store.insertMemory(row('nine','9'));
 (store as any).consolidateMemories('2',.85,'1');
 expect(store.getMemoriesByCharacter('2',100,'1').map(m=>m.id)).toEqual(['one']);
 expect(store.getMemoriesByCharacter('2',100,'9').map(m=>m.id)).toEqual(['nine']);
 (store as any).consolidateMemories('2'); // Legacy unscoped callers must still never merge owners.
 expect(store.getMemoriesByCharacter('2')).toHaveLength(2);expect(indexed()).toBe(2);
});
test('decay is idempotent at a fixed clock and removes its vector with the base row',()=>{
 const day=86400000;store.insertMemory(row('one'));const now=jest.spyOn(Date,'now').mockReturnValue(1000+10*day);
 for(let n=0;n<11;n++)(store as any).applyDecay('2',.01,1,'1');
 expect(store.getMemoriesByCharacter('2')[0].decay).toBeCloseTo(.1);expect(indexed()).toBe(1);
 now.mockReturnValue(1000+110*day);(store as any).applyDecay('2',.01,1,'1');
 expect(store.getMemoriesByCharacter('2')).toEqual([]);expect(indexed()).toBe(0);
});
