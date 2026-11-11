import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { lorebookClient } from '../../src/main/lorebook/lorebookClient';
import { lorebookPrompt, lorebookVectors } from '../../src/main/lorebook/lorebookRuntime';
import { currentGoaCatalog, getVerifiedGoaSnapshot } from '../../src/main/goa/goaRuntime';

jest.mock('../../src/main/goa/goaRuntime', () => ({
    getVerifiedGoaSnapshot: jest.fn(() => ({ version: 1, digest: 'a'.repeat(64), characterId: 2, traitIds: [], facts: {} })), currentGoaCatalog: jest.fn(() => ({ digest: 'capture' }))
}));
test.each(['report', 'clock', 'capture', 'body', 'actor-replaced', 'disabled', 'after-resolution'])('rechecks %s after an external embedding wait before exposing lore', async change => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-lore-binding-'));
    let release!: (ids: string[]) => void;
    const pause = new Promise<string[]>(resolve => { release = resolve; });
    const game: any = { playerID: 1, votcCheckpointEpoch: 1, characters: new Map([[2, { id: 2 }]]),
        gameDate: { year: 583, month: 2, day: 2, totalDays: 200000, display: '583.2.2' },
        timelineSnapshotResult: { status: 'valid', snapshot: { source: 'init', playerId: '1', epoch: 1, nodeA: 9, nodeB: 10,
            protocol: { protocolSchema: 2, campaignSchema: 1, campaignIdA: 1, campaignIdB: 2, campaignIdC: 3, campaignIdD: 4, campaignBootstrapKind: 1, playerTimelineSchema: 1 } } } };
    const config: any = { userFolderPath: path.join(root, 'user'), lorebookEnabled: true, goaLoreEnabled: true,
        embeddingApiConnectionConfig: { connection: { type: 'custom', model: 'fixture', baseUrl: 'https://embedding.invalid' } } };
    const report: any = { origin: 'user_reported', campaign_id: '1-2-3-4', timeline_id: '9-10', start_date: '0583-01-01', as_of: '0583-02-01', mod_version: '0.6.5', choices: [],
        lore_knowledge: { actor_id: '2', as_of: '0583-02-01', setting_sha256: 'setting', known_subjects: ['fixture-knowledge'] } };
    const key = createHash('sha256').update(JSON.stringify(['1-2-3-4', '9-10', '2'])).digest('hex');
    const file = path.join(root, 'lorebook/reports', key + '.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ report, capture_digest: 'capture', total_days: 199999 }));
    fs.mkdirSync(config.userFolderPath, { recursive: true });
    fs.writeFileSync(path.join(config.userFolderPath, 'dlc_load.json'), JSON.stringify({ enabled_mods: ['goa.mod'] }));
    fs.writeFileSync(path.join(config.userFolderPath, 'goa.mod'), 'remote_file_id="2949767945"\nversion="0.6.5"');
    const request = jest.spyOn(lorebookClient, 'request').mockImplementation(async (body: any) => {
        if (body.op === 'status') return { manifest_sha256: 'edition', setting_sha256: 'setting' } as any;
        if (body.op === 'candidates') return { ids: ['leaf'] } as any;
        if (body.op === 'disclose' && change === 'after-resolution') {
            game.gameDate.totalDays++;
            return { actor_id: '2', passages: [{ heading: 'Fixture', text: 'Must be withheld.' }], state: {} } as any;
        }
        throw new Error('A revoked request reached disclosure');
    });
    const search = jest.spyOn(lorebookVectors, 'search').mockReturnValue(pause);
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        const result = lorebookPrompt(game, 2, config, root, 'A fixture question.');
        for (let i=0; i<100 && !search.mock.calls.length; i++) await new Promise(resolve => setImmediate(resolve));
        expect(search).toHaveBeenCalled();
        if (change === 'report') { report.lore_knowledge.known_subjects = []; fs.writeFileSync(file, JSON.stringify({ report, capture_digest: 'capture', total_days: 199999 })); }
        if (change === 'clock') game.gameDate.totalDays++;
        if (change === 'capture') jest.mocked(currentGoaCatalog).mockReturnValue({ digest: 'changed' } as any);
        if (change === 'body') jest.mocked(getVerifiedGoaSnapshot).mockReturnValue({ traitIds: ['changed-body'] } as any);
        if (change === 'actor-replaced') game.characters.set(2, { id: 2 });
        if (change === 'disabled') config.lorebookEnabled = false;
        release(['semantic-leaf']);
        expect(await result).toBe('');
        expect(request.mock.calls.some(([body]) => body.op === 'disclose')).toBe(change === 'after-resolution');
    } finally { request.mockRestore(); search.mockRestore(); warning.mockRestore(); jest.mocked(currentGoaCatalog).mockReturnValue({ digest: 'capture' } as any); jest.mocked(getVerifiedGoaSnapshot).mockReturnValue({ version: 1, digest: 'a'.repeat(64), characterId: 2, traitIds: [], facts: {} } as any); fs.rmSync(root, { recursive: true, force: true }); }
});

test('ordinary writers retain their admitted topic under the shipped spoken-exposure flag',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'titan-ordinary-lore-'));
    const previous=process.env.VOTC_LORE_SPOKEN_EXPOSURE_STUDY;process.env.VOTC_LORE_SPOKEN_EXPOSURE_STUDY='1';
    const game:any={playerID:1,votcCheckpointEpoch:1,characters:new Map([[2,{id:2}]]),gameDate:{year:583,month:2,day:2,totalDays:200000,display:'583.2.2'},
        timelineSnapshotResult:{status:'valid',snapshot:{source:'init',playerId:'1',epoch:1,nodeA:9,nodeB:10,protocol:{protocolSchema:2,campaignSchema:1,campaignIdA:1,campaignIdB:2,campaignIdC:3,campaignIdD:4,campaignBootstrapKind:1,playerTimelineSchema:1}}}};
    const config:any={userFolderPath:path.join(root,'user'),lorebookEnabled:true,goaLoreEnabled:true};
    const report={origin:'user_reported',campaign_id:'1-2-3-4',timeline_id:'9-10',start_date:'0583-01-01',as_of:'0583-02-01',mod_version:'0.6.5',choices:[],lore_knowledge:{actor_id:'2',as_of:'0583-02-01',setting_sha256:'setting',known_subjects:['guild']}};
    const key=createHash('sha256').update(JSON.stringify(['1-2-3-4','9-10','2'])).digest('hex'),file=path.join(root,'lorebook/reports',key+'.json');
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({report,capture_digest:'capture',total_days:199999}));
    fs.mkdirSync(config.userFolderPath,{recursive:true});fs.writeFileSync(path.join(config.userFolderPath,'dlc_load.json'),JSON.stringify({enabled_mods:['goa.mod']}));
    fs.writeFileSync(path.join(config.userFolderPath,'goa.mod'),'remote_file_id="2949767945"\nversion="0.6.5"');
    const state={version:'titan-progressive-lore-v2',context:'reader',root:'guild',focus:'fees',focus_title:'Apprenticeship Fees',shown:['fees']};
    const request=jest.spyOn(lorebookClient,'request').mockImplementation(async(input:any)=>{
        if(input.op==='status')return{manifest_sha256:'edition',setting_sha256:'setting'}as any;
        if(input.op==='candidates')return{ids:['fees'],query:input.previous?input.query+' '+input.previous.focus_title:input.query}as any;
        return{actor_id:'2',context_fingerprint:'reader',passages:[{node_id:'fees',subject_id:'guild',heading:'Apprenticeship Fees',text:'Apprentices must agree to fees.'}],words:8,state,trace:[],disclosure:{mode:'focused',access:'provided'}}as any;
    });
    const scope={},turns:any[]=[{id:'one',role:'user',content:'How do apprenticeship fees work?'}];
    const first:import('../../src/main/lorebook/lorebookDisclosure').LoreDelivery={scope,channel:'chat',turns:[...turns]};
    try{
        expect(await lorebookPrompt(game,2,config,root,turns[0].content,'',first)).toContain('Apprenticeship Fees');first.commit!(true);
        turns.push({id:'two',role:'user',content:'Tell me more.'});
        await lorebookPrompt(game,2,config,root,'Tell me more.','',{scope,channel:'chat',turns});
        const candidates=request.mock.calls.filter(([input])=>input.op==='candidates');
        expect(candidates.at(-1)![0]).toMatchObject({query:'Tell me more.',previous:state});
    }finally{request.mockRestore();if(previous===undefined)delete process.env.VOTC_LORE_SPOKEN_EXPOSURE_STUDY;else process.env.VOTC_LORE_SPOKEN_EXPOSURE_STUDY=previous;fs.rmSync(root,{recursive:true,force:true});}
});
