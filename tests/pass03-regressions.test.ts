import fs from 'fs';
import os from 'os';
import path from 'path';
import { executeSlashAction } from '../src/main/conversation/executeSlashAction';
import { RunFileManager } from '../src/main/RunFileManager';
import { SummaryEdits } from '../src/main/summaryEdits';
import { GameData } from '../src/shared/gameData/GameData';
import { character } from './culture/fixtures';
import { MemoryManager, Memory } from '../src/main/memoryManager';
import { readDiarySummaries } from '../src/main/diaryManager';
import { app } from 'electron';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-pass03-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); jest.restoreAllMocks(); });
const memory = (id: string, vector: number[]): Memory => ({ id, vector, characterId: '2', playerId: '1', text: id, timestamp: 1, emotion: 'neutral', decay: 0, accessCount: 0, lastAccessed: 1 });

test('a failed slash publication retains cached balances and a retry changes them once', async () => {
    const data = new GameData(['1','Player','2','NPC','583.1.1','court','Place','Player','0']);
    data.characters.set(1, character(1, 'Player')); data.characters.set(2, character(2, 'NPC'));
    data.getPlayer().gold = 50; data.getCharacter(2)!.gold = 50;
    const conv: any = { isOpen: true, gameData: data, config: { language: 'en' }, runFileManager: new RunFileManager(root), actionInvolvedCharacterIds: new Set() };
    const gold = require('../default_userdata/scripts/actions/standard/giveGold.js');
    fs.rmdirSync(path.join(root, 'run'));
    await expect(executeSlashAction(conv, gold, [1,2,7])).rejects.toThrow(/ENOENT/);
    expect([data.getPlayer().gold, data.getCharacter(2)!.gold]).toEqual([50,50]);
    fs.mkdirSync(path.join(root, 'run'));
    await executeSlashAction(conv, gold, [1,2,7]);
    expect([data.getPlayer().gold, data.getCharacter(2)!.gold]).toEqual([43,57]);
});

test('reopening repairs compatible base-only vector rows without discarding the index', () => {
    let store = new MemoryManager(root, 2);
    store.insertMemory(memory('missing', [1,0]));
    (store as any).db.prepare('DELETE FROM memory_vectors WHERE memory_id=?').run('missing'); store.close();
    store = new MemoryManager(root, 2);
    try { expect(store.hasIndexedMemory('missing')).toBe(true); } finally { store.close(); }
});

test('campaign edits and deletes update their actual store and its duplicate without touching hidden siblings', async () => {
    const edits = new SummaryEdits(root), legacy = path.join(root, 'conversation_summaries/1'), campaign = path.join(root, 'campaign');
    fs.mkdirSync(legacy, { recursive: true }); fs.mkdirSync(campaign);
    const visible = { content: 'ORIGINAL', date: '583.1.1', votcTimelineNodeId: '1-1' }, hidden = { ...visible, votcTimelineNodeId: '2-2' };
    for (const dir of [legacy, campaign]) fs.writeFileSync(path.join(dir, '2.json'), JSON.stringify([visible,hidden]));
    const snapshot = await edits.read('1', 'conversations', async () => [{ ...visible, characterId: '2' }], [campaign,legacy]);
    edits.save('1', 'conversations', [{ ...snapshot.data[0], content: 'EDITED' }], snapshot.revision);
    for (const dir of [legacy,campaign]) expect(JSON.parse(fs.readFileSync(path.join(dir,'2.json'),'utf8')).map((r:any)=>r.content)).toEqual(['EDITED','ORIGINAL']);
    edits.save('1', 'conversations', [], snapshot.revision);
    for (const dir of [legacy,campaign]) expect(JSON.parse(fs.readFileSync(path.join(dir,'2.json'),'utf8'))).toEqual([hidden]);
});

test('a campaign-store write invalidates the editor receipt', async () => {
    const edits = new SummaryEdits(root), campaign = path.join(root,'campaign'); fs.mkdirSync(campaign);
    const file = path.join(campaign,'2.json'); fs.writeFileSync(file, '[]');
    const view = await edits.read('1','conversations',async()=>[],[campaign]);
    fs.writeFileSync(file, '[{"content":"NEW"}]');
    expect(()=>edits.save('1','conversations',[],view.revision)).toThrow(/changed/);
});

test.each([{shape:{ summary: 'OLD' }}, {shape:[{ summary: 'OLD', date: '583.1.1' }]}])('legacy diary edits and deletions use the reader identity: %j', async ({shape}) => {
    // The real compatibility reader uses Electron userData; keep this fixture disposable.
    const diaryRoot = path.join(app.getPath('userData'), 'votc_data');
    const player = String(900000000 + Math.floor(Math.random()*10000000)), dir = path.join(diaryRoot,'diary_summaries',player);
    fs.mkdirSync(dir, { recursive:true }); const file = path.join(dir,'2.json'); fs.writeFileSync(file,JSON.stringify(shape));
    try {
        const edits = new SummaryEdits(diaryRoot), load = () => readDiarySummaries(player,'2');
        const a = await load(), b = await load(); expect(a[0].id).toBe(b[0].id);
        const view = await edits.read(player,'diaries',load);
        edits.save(player,'diaries',[{...view.data[0],summary:'EDITED'}],view.revision);
        expect((await load()).map(r=>r.summary)).toEqual(['EDITED']);
        edits.save(player,'diaries',[],view.revision); expect(await load()).toEqual([]);
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('a concurrent insert aborts reindex while preserving old vectors; a cancelled retry also preserves them', async () => {
    const store = new MemoryManager(root,2); store.insertMemory(memory('old',[1,0]));
    try {
        await expect(store.reindexMemories(async()=>{store.insertMemory(memory('concurrent',[0,1]));return[1,0,0];},3)).rejects.toThrow(/changed/);
        expect(store.hasIndexedMemory('old')).toBe(true);expect(store.hasIndexedMemory('concurrent')).toBe(true);
        await expect(store.reindexMemories(async()=>{throw Object.assign(Error('cancelled'),{name:'AbortError'});},3)).rejects.toMatchObject({name:'AbortError'});
        expect(store.getStoredEmbeddingDimensions()).toEqual([2]);
    } finally {store.close();}
});
test('an open encounter using the injected manager inserts and retrieves full vectors after reindex and reload', async () => {
    let store = new MemoryManager(root,2); store.insertMemory(memory('old',[1,0]));
    const encounter:any = {memoryManager:store};
    await store.reindexMemories(async()=>[1,0,0],3);
    encounter.memoryManager.insertMemory(memory('new',[0,1,0]));
    expect(store.hasIndexedMemory('new',3)).toBe(true);expect([...store.getMemoriesByCharacter('2').find(r=>r.id==='new')!.vector]).toHaveLength(3);
    store.close();store = new MemoryManager(root,3);
    try {expect(store.searchSimilar('2',[0,1,0])[0].id).toBe('new');} finally {store.close();}
});
test('incompatible historical base rows remain intact until an explicit successful reindex', async () => {
    let store = new MemoryManager(root,2); store.insertMemory(memory('old',[1,0]));
    (store as any).db.prepare('DELETE FROM memory_vectors WHERE memory_id=?').run('old');
    (store as any).db.prepare('UPDATE memories SET embedding=? WHERE id=?').run(Buffer.from(new Float32Array([1]).buffer),'old');store.close();
    store=new MemoryManager(root,2);
    try {expect(store.hasIndexedMemory('old')).toBe(false);expect(store.getStoredEmbeddingDimensions()).toEqual([1]);await store.reindexMemories(async()=>[1,0],2);expect(store.hasIndexedMemory('old')).toBe(true);} finally {store.close();}
});
