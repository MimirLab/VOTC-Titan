import fs from 'fs';
import path from 'path';
import { GameData } from '../../src/shared/gameData/GameData';
import { Config } from '../../src/shared/Config';
import { configureLauncherScenes, observeLauncherSceneLine, bindLauncherScene, setLauncherScenePublisher } from '../../src/main/scenes/launcherSceneRuntime';
import { actionForScene, runActionWithScenePolicy, selectLauncherVenue, waitForSceneSelection } from '../../src/main/scenes/sceneRuntime';
import { EncounterCapture } from '../../src/main/background/EncounterCapture';
import { Action } from '../../src/main/ts/conversation_interfaces';
jest.mock('../../src/main/scenes/launcherSceneSources', () => ({ validateLauncherSceneSources: () => true }));

// Actual read-only CE/GoA response, captured in a paused disposable 583 campaign.
const raw = fs.readFileSync(path.join(__dirname,'fixtures/stock-ce-scene-response.log'),'utf8');
const nonce = 'a91d565614462b7238eb57e6';
const observe = () => raw.split('\n').forEach(observeLauncherSceneLine);
function game(scene: string): GameData {
    return Object.assign(Object.create(GameData.prototype), { playerID:31575,aiID:40001,scene,
        characters:new Map([[40001,{id:40001}],[31575,{id:31575}]]),
        votcCampaignIdA:338796323,votcCampaignIdB:362203402,votcCampaignIdC:532409363,votcCampaignIdD:273258104 });
}
beforeEach(() => configureLauncherScenes({userFolderPath:'synthetic'} as Config));
afterEach(() => jest.restoreAllMocks());
test('a CE bedchamber remains the RP venue while eligible Titan choices become available', () => {
    const data=game('bedchamber'),publish=jest.fn();setLauncherScenePublisher(publish);observe();
    const census=bindLauncherScene(data,nonce)!;
    expect(census.eligible.length).toBeGreaterThan(0);
    expect(data.scene).toBe('bedchamber');expect(data.sceneSnapshot).toBeUndefined();
    expect(data.resolvedSceneContext).toBeUndefined();expect(data.launcherSceneObservation).toBe(census);
    expect(publish).toHaveBeenCalledWith(data,census,'capture');
});
test('a stock throne room gets its physically eligible custom equivalent', () => {
    const data=game('throne_room');observe();bindLauncherScene(data,nonce);
    expect(data.scene).toBe('titan_city_stormwind_the_lion_throne_hall');
    expect(data.resolvedSceneContext?.packet).toContain('Stormwind');
    expect(data.sceneSnapshot?.ceScene).toBe('throne_room');
});
test('explicit launcher choice waits for a fresh acknowledged query and publishes once without game helper effects', async () => {
    const data=game('bedchamber');observe();const census=bindLauncherScene(data,nonce)!;
    const choice=census.eligible.find(id=>id.includes('pig_and_whistle'))!;expect(choice).toBeTruthy();
    const publish=jest.fn();setLauncherScenePublisher(publish);
    const capture=jest.spyOn(EncounterCapture.prototype,'capture').mockImplementation(async function(this: EncounterCapture) {
        observe();this.lastAcknowledgedNonce=nonce;return true;
    });
    const action={signature:'changeLocation',args:[{name:'location',type:'enum',options:[]}],run:jest.fn()} as unknown as Action;
    const argument = actionForScene(action,data).args[0] as unknown as { type: string; options: unknown[] };
    expect(argument.type).toBe('enum');
    if (argument.type !== 'enum') throw new Error('Expected enum venue choices');
    expect(argument.options.length).toBe(census.eligible.length);
    const emit=jest.fn();runActionWithScenePolicy(action,data,emit,[choice],31575,40001);
    expect(data.scene).toBe('bedchamber');await waitForSceneSelection(data);
    expect(capture).toHaveBeenCalledTimes(1);expect(data.scene).toBe(choice);
    expect(publish).toHaveBeenCalledTimes(1);expect(publish.mock.calls[0][2]).toBe('action');
    expect(emit).not.toHaveBeenCalled();expect(action.run).not.toHaveBeenCalled();
});
test('an unrelated actor or unacknowledged nonce cannot bind the retained fixture', () => {
    const data=game('bedchamber');observe();expect(bindLauncherScene(data,'ffffffffffffffffffffffff')).toBeUndefined();
    data.playerID=99;expect(bindLauncherScene(data,nonce)).toBeUndefined();expect(data.sceneSnapshot).toBeUndefined();
});

test('the gallery rejects out-of-area venues and can retry an unacknowledged choice', async () => {
    const data = game('bedchamber');
    observe();
    const census = bindLauncherScene(data, nonce)!;
    const venue = census.eligible.find(id => id.includes('pig_and_whistle'))!;
    const capture = jest.spyOn(EncounterCapture.prototype, 'capture').mockResolvedValueOnce(false)
        .mockImplementationOnce(async function(this: EncounterCapture) {
            observe();
            this.lastAcknowledgedNonce = nonce;
            return true;
        });
    const publish = jest.fn();
    setLauncherScenePublisher(publish);

    await expect(selectLauncherVenue(data, 'titan_farraki_court')).rejects.toThrow('unavailable');
    expect(capture).not.toHaveBeenCalled();
    await expect(selectLauncherVenue(data, venue)).rejects.toThrow('did not confirm');
    expect(data.scene).toBe('bedchamber');
    expect(publish).not.toHaveBeenCalled();
    await selectLauncherVenue(data, venue);
    expect(data.scene).toBe(venue);
    expect(publish).toHaveBeenCalledTimes(1);
});

test.each([false,true])('automatic/approved scene actions record success only after a confirmed selection (approval=%s)',async approval=>{
    const {Conversation}=require('../../src/main/conversation/Conversation');
    const {checkActions}=require('../../src/main/conversation/checkActions');
    const data=game('throne_room');observe();const census=bindLauncherScene(data,nonce)!;
    const venue=census.eligible.find(id=>id.includes('pig_and_whistle'))!;
    let confirm!:(snapshot:any)=>void;
    const {setLauncherSceneSelector}=require('../../src/main/scenes/sceneRuntime');
    setLauncherSceneSelector(()=>new Promise(resolve=>{confirm=resolve;}));
    const action=require('../../default_userdata/scripts/actions/standard/changeLocation.js');
    const send=jest.fn(),conv:any=Object.assign(Object.create(Conversation.prototype),{gameData:data,
        config:{language:'en',selectedDescScript:'missing.js',manualActionApproval:approval},votcDataPath:'synthetic',actions:[action],
        messages:[{id:'reply',role:'assistant',content:'A synthetic reply.'}],actionsApiConnection:{isChat:()=>true,complete:async()=>`<rationale>Choose the venue.</rationale><actions>changeLocation(31575,40001,${venue})</actions>`},
        currentTurnTriggeredActions:new Set(),pendingActions:new Map(),executedActions:new Map(),runFileManager:{append:jest.fn()},chatWindow:{window:{webContents:{send}}}});
    if(approval){await checkActions(conv,31575,40001);}
    let settled=false;
    const waiting=(approval?conv.executeApprovedAction('reply','changeLocation'):checkActions(conv,31575,40001)).then((result:any)=>{settled=true;return result;});
    for(let n=0;n<6&&!confirm;n++)await Promise.resolve();
    await new Promise(resolve=>setImmediate(resolve));
    expect(confirm).toBeDefined();expect(settled).toBe(false);expect(conv.executedActions.size).toBe(0);
    expect(send.mock.calls.filter(([name]:any[])=>name==='actions-receive')).toHaveLength(0);
    confirm({...census,selected:venue});const result=await waiting;
    if(approval)expect(conv.executedActions.get('reply')).toHaveLength(1);else expect(result).toHaveLength(1);
});

test.each([[false,'rejected'],[true,'rejected'],[false,'timeout'],[true,'timeout']] as const)('scene %s approval with %s never records or announces success',async(approval,outcome)=>{
    jest.useFakeTimers();
    const {Conversation}=require('../../src/main/conversation/Conversation'),{checkActions}=require('../../src/main/conversation/checkActions');
    const {setLauncherSceneSelector}=require('../../src/main/scenes/sceneRuntime');
    const data=game('throne_room');observe();const census=bindLauncherScene(data,nonce)!;
    const venue=outcome==='rejected'?'titan_farraki_court':census.eligible.find(id=>id.includes('pig_and_whistle'))!;
    setLauncherSceneSelector(()=>new Promise(()=>{}));
    const send=jest.fn(),conv:any=Object.assign(Object.create(Conversation.prototype),{gameData:data,
        config:{language:'en',selectedDescScript:'missing.js',manualActionApproval:approval},votcDataPath:'synthetic',
        actions:[require('../../default_userdata/scripts/actions/standard/changeLocation.js')],messages:[{id:'reply',role:'assistant',content:'A synthetic reply.'}],
        actionsApiConnection:{isChat:()=>true,complete:async()=>`<rationale>Venue request.</rationale><actions>changeLocation(31575,40001,${venue})</actions>`},
        currentTurnTriggeredActions:new Set(),pendingActions:new Map(),executedActions:new Map(),runFileManager:{append:jest.fn()},chatWindow:{window:{webContents:{send}}}});
    const initial=data.scene;
    try{
        if(approval)await checkActions(conv,31575,40001);
        const waiting=approval?conv.executeApprovedAction('reply','changeLocation'):checkActions(conv,31575,40001);
        await jest.advanceTimersByTimeAsync(15001);const result=await waiting;
        if(!approval)expect(result).toEqual([]);
        expect(data.scene).toBe(initial);expect(conv.executedActions.size).toBe(0);
        expect(send.mock.calls.some(([name]:any[])=>name==='actions-receive')).toBe(false);
    }finally{jest.useRealTimers();}
});
