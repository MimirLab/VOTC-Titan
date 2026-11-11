import fs from 'fs';import os from 'os';import path from 'path';
import { executeSlashAction } from '../src/main/conversation/executeSlashAction';
import { RunFileManager } from '../src/main/RunFileManager';
import { GameData } from '../src/shared/gameData/GameData';
import { character } from './culture/fixtures';
let root:string, conv:any;
const gold=require('../default_userdata/scripts/actions/standard/giveGold.js');
const leave=require('../default_userdata/scripts/actions/standard/leaveConversation.js');
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'titan-slash-'));const game=new GameData(['1','Player','2','NPC','583.1.1','court','Place','Player','0']);game.characters.set(1,character(1,'Player'));game.characters.set(2,character(2,'NPC'));game.characters.set(3,character(3,'Other'));game.characters.get(1)!.gold=100;game.characters.get(2)!.gold=100;
 conv={isOpen:true,gameData:game,config:{language:'en'},runFileManager:new RunFileManager(root),actionInvolvedCharacterIds:new Set(),chatWindow:{window:{webContents:{send:jest.fn()}},hide:jest.fn()},saveHistoryAndTriggerSummarization:jest.fn(),removeCharacter:jest.fn(),generateSceneDescription:jest.fn()};for(const name of ['log','warn','error']as const)jest.spyOn(console,name).mockImplementation(()=>{});});
afterEach(()=>{jest.restoreAllMocks();fs.rmSync(root,{recursive:true,force:true});});
const script=()=>fs.readFileSync(path.join(root,'run/votc.txt'),'utf8');
test('an NPC asking the player to leave keeps real player ownership and closes the chat',async()=>{
 await executeSlashAction(conv,leave,[2,1]); expect(conv.gameData.playerID).toBe(1);expect(conv.removeCharacter).not.toHaveBeenCalled();expect(conv.saveHistoryAndTriggerSummarization).toHaveBeenCalledTimes(1);
 expect(script()).toMatch(/votcce_action_target\s*\n?\s*value = root/);
});
test('NPC departure removes that NPC and keeps the player chat open',async()=>{
 await executeSlashAction(conv,leave,[1,2]); expect(conv.removeCharacter).toHaveBeenCalledWith(2);expect(conv.saveHistoryAndTriggerSummarization).not.toHaveBeenCalled();
});
test('insufficient gold fails before script, local balances, or a success notice',async()=>{
 conv.gameData.getPlayer().gold=2;await expect(executeSlashAction(conv,gold,[1,2,20])).rejects.toThrow('not have enough gold');expect(conv.gameData.getPlayer().gold).toBe(2);expect(fs.existsSync(path.join(root,'run/votc.txt'))).toBe(false);expect(conv.actionInvolvedCharacterIds.size).toBe(0);
});
test('a second slash command is rejected before debit and preserves the first complete command',async()=>{
 const first=await executeSlashAction(conv,gold,[1,2,20]);const bytes=script();expect(first?.chatMessage).toContain('20');
 await expect(executeSlashAction(conv,gold,[1,2,10])).rejects.toThrow(/processing another command/);
 expect(script()).toBe(bytes);expect(conv.gameData.getPlayer().gold).toBe(80);expect(bytes.match(/trigger_event/g)).toHaveLength(1);
});
test('an action without a game effect cannot show a success notice',async()=>{
 await expect(executeSlashAction(conv,{...gold,run:()=>{}},[1,2,20])).rejects.toThrow(/no game effect/);
});
