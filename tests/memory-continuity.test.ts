import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { app } from 'electron';
import { exportPlayerData, importPlayerData, readSummaryFile } from '../src/main/summaryManager';
import { saveCampaignStore, loadCampaignStore } from '../src/main/campaignBusiness';
import { TimelineRegistry } from '../src/main/timelineManager';
import { buildIdentityFromParts } from '../src/shared/gameData/CampaignIdentity';
import { GameData } from '../src/shared/gameData/GameData';
import { character } from './culture/fixtures';
import { LetterReplyGenerator } from '../src/main/letter/LetterReplyGenerator';
import { filterMemoryRecordsForGame } from '../src/main/memoryReadContext';
import { readDiarySummaries, saveDiarySummaries } from '../src/main/diaryManager';
jest.mock('../src/main/letter/LetterManager', () => ({ LetterManager: { getInstance: () => ({ getLetterSummaries: () => [] }) } }));
let root: string;
const identity = buildIdentityFromParts({ a: 11, b: 12, c: 13, d: 14 }, '1');
const node = (parentId: string | null, epoch: number) => ({ parentId, epoch, source: 'conversation', eventKey: String(epoch), createdAt: new Date(0).toISOString() });
const registry = () => new TimelineRegistry('1', { version: 1, playerId: '1', nodes: {
    '1-1': node(null, 1), '2-2': node('1-1', 2), '3-3': node('1-1', 2), '4-4': node('2-2', 3)
} });
function write(relative: string, data: any) { const file = path.join(root, 'votc_data', relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); }
function memoryStoreFor(directory: string) {
    let store: typeof import('../src/main/compactedMemoryStore').compactedMemoryStore;
    const previous=process.env.COMPACTION_ENCRYPTION_KEY;
    process.env.COMPACTION_ENCRYPTION_KEY='12345678901234567890123456789012';
    try { jest.isolateModules(()=>{(require('electron').app.getPath as jest.Mock).mockReturnValue(directory);store=require('../src/main/compactedMemoryStore').compactedMemoryStore;}); }
    finally {if(previous===undefined)delete process.env.COMPACTION_ENCRYPTION_KEY;else process.env.COMPACTION_ENCRYPTION_KEY=previous;}
    return store!;
}
function game() {
    const game = new GameData(['1', 'Player', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Player', '0']);
    game.characters.set(1, character(1, 'Player')); game.characters.set(2, character(2, 'Speaker'));
    game.timelineSnapshotResult = undefined; game.votcCheckpointEpoch = 2; game.votcTimelineNodeA = 2; game.votcTimelineNodeB = 2;
    return game;
}
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-memory-continuity-')); (app.getPath as jest.Mock).mockReturnValue(root);
    for (const name of ['log','warn','error'] as const) jest.spyOn(console,name).mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

test('export/import retains compacted bytes, branch summaries, and the real campaign registry used to read them', async () => {
    const savedRegistry=registry(); savedRegistry.getOrCreateChild(null,'conversation','fixture-extra',0,new Date(0).toISOString());
    saveCampaignStore(root, identity, savedRegistry);
    const memory={id:'owned-memory',date:'1066.9.01',content:'ANCESTOR_PRIVATE_MEMORY',characterIds:[2],recipientPerspectiveId:2,
        relevanceScore:1,entityReferences:[],compactionLevel:1 as const,sourceMessageIds:['source-turn'],creationTimestamp:1,gameDate:'1066.9.01',
        scope:{version:1 as const,campaignId:identity.campaignId,encounterId:'encounter',timelineNodeId:'1-1',checkpointEpoch:1}};
    await memoryStoreFor(root).saveCompactedMemory('1','2',[memory]);
    const encrypted=fs.readFileSync(path.join(root,'votc_data/memories_compacted/1/2.json'));
    write('conversation_summaries/1/2.json', [{ date: '1066.9.1', content: 'ANCESTOR', votcTimelineNodeId: '1-1' },
        { date: '1066.9.15', content: 'SIBLING', votcTimelineNodeId: '3-3' }]);
    const archive = path.join(root, 'player.zip'); await exportPlayerData(path.join(root,'votc_data'), archive);
    const restored = path.join(root,'restored'); (app.getPath as jest.Mock).mockReturnValue(restored);
    await importPlayerData(path.join(restored,'votc_data'), archive);
    expect(fs.readFileSync(path.join(restored,'votc_data/memories_compacted/1/2.json'))).toEqual(encrypted);
    expect((await memoryStoreFor(restored).getAllCompactedMemories('1')).memories).toEqual([memory]);
    const loaded = loadCampaignStore(restored, identity); expect(loaded.status).toBe('found');
    if (loaded.status !== 'found') throw new Error('Missing restored registry');
    const visible = await readSummaryFile(path.join(restored,'votc_data'), '1', 2, loaded.store, '2-2', identity);
    expect(visible.map(summary => summary.content)).toEqual(['ANCESTOR']);
});
test('older compacted_memory ZIP imports keep their compatibility migration', async () => {
    const archive = path.join(root,'legacy.zip'), zip = new AdmZip(); zip.addFile('compacted_memory/1/2.json', Buffer.from('old bytes')); zip.writeZip(archive);
    await importPlayerData(path.join(root,'votc_data'), archive);
    expect(fs.readFileSync(path.join(root,'votc_data/memories_compacted/1/2.json'),'utf8')).toBe('old bytes');
});
test('ordinary letter prompt includes an ancestor but neither a future nor a same-day sibling', async () => {
    const g = game();
    // Legacy timeline evidence remains usable even without a v2 campaign id.
    write('timeline_registry/player_1.json',registry().snapshot());
    write('conversation_summaries/1/2.json', [{ date:'1066.9.01',content:'ANCESTOR_LETTER',votcTimelineNodeId:'1-1'},
        {date:'1066.9.15',content:'SIBLING_LETTER',votcTimelineNodeId:'3-3'},
        {date:'1066.10.01',content:'FUTURE_LETTER',votcTimelineNodeId:'4-4'}]);
    write('configs/prompts/en.json', fs.readFileSync('default_userdata/configs/prompts/en.json','utf8'));
    const config = { ...JSON.parse(fs.readFileSync('default_userdata/configs/default_config.json','utf8')), goaLoreEnabled:false, lorebookEnabled:false };
    const generator = Object.assign(Object.create(LetterReplyGenerator.prototype), { config, votcDataPath:path.join(root,'votc_data'), apiConnection:{ calculateTokensFromText:()=>100,context:8192 } });
    const prompt = await generator.buildLetterPrompt(g,{sender:g.getPlayer(),recipient:g.getAi(),content:'Please write back.'});
    expect(prompt).toContain('ANCESTOR_LETTER'); expect(prompt).not.toContain('SIBLING_LETTER'); expect(prompt).not.toContain('FUTURE_LETTER');
    delete g.votcTimelineNodeA; delete g.votcTimelineNodeB;
    write('conversation_summaries/1/2.json',[{date:'1066.9.01',content:'LEGACY_LETTER'}]);
    expect(await generator.buildLetterPrompt(g,{sender:g.getPlayer(),recipient:g.getAi(),content:'Hello.'})).toContain('LEGACY_LETTER');
});
test('diary reads preserve stamps and filter future dates, sibling nodes and foreign campaigns', async () => {
    // diaryManager's module constants point at the mocked default userData (/tmp).
    // Reload with this test's temporary root so no other profile can be touched.
    jest.resetModules(); (require('electron').app.getPath as jest.Mock).mockReturnValue(root); const diary: typeof import('../src/main/diaryManager') = require('../src/main/diaryManager');
    const g = game(); const rows = [
        {id:'past',diaryEntryId:'a',date:'1066.9.01',summary:'PAST',votcTimelineNodeId:'1-1',votcCampaignId:identity.campaignId},
        {id:'sibling',diaryEntryId:'b',date:'1066.9.15',summary:'SIBLING',votcTimelineNodeId:'3-3',votcCampaignId:identity.campaignId},
        {id:'future',diaryEntryId:'c',date:'1066.10.01',summary:'FUTURE'},
        {id:'legacy',diaryEntryId:'d',date:'1066.9.1',summary:'LEGACY'},
        {id:'foreign',diaryEntryId:'e',date:'1066.9.1',summary:'FOREIGN',votcCampaignId:'other-campaign'}];
    await diary.saveDiarySummaries('1','2',rows); const stored=await diary.readDiarySummaries('1','2');
    expect(stored[0].votcTimelineNodeId).toBe('1-1');
    expect(filterMemoryRecordsForGame(stored,g,{registry:registry(),currentNodeId:'2-2',identity}).map(row=>row.summary)).toEqual(['PAST','LEGACY']);
});
