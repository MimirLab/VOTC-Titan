import fs from 'fs';
import path from 'path';
import { GameData } from '../../src/shared/gameData/GameData';
import { Config } from '../../src/shared/Config';
import { configureLauncherScenes, observeLauncherSceneLine, bindLauncherScene, setLauncherScenePublisher } from '../../src/main/scenes/launcherSceneRuntime';
import { actionForScene, runActionWithScenePolicy, waitForSceneSelection } from '../../src/main/scenes/sceneRuntime';
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
