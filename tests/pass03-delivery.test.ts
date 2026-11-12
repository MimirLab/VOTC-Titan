jest.mock('electron', () => ({ ...jest.requireActual('../__mocks__/electron.js'), BrowserWindow: { getAllWindows: () => [] } }));
import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { RunFileManager } from '../src/main/RunFileManager';
import { LetterReplyGenerator } from '../src/main/letter/LetterReplyGenerator';
import { LetterManager } from '../src/main/letter/LetterManager';
import { parseActionResponse } from '../src/main/conversation/actionResponse';
import { GameData } from '../src/shared/gameData/GameData';
import { character } from './culture/fixtures';
import * as promptBuilder from '../src/main/conversation/promptBuilder';
import { Conversation } from '../src/main/conversation/Conversation';

let root: string;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'titan-pass03-delivery-')); for(const key of ['log','warn','error'] as const) jest.spyOn(console,key).mockImplementation(()=>{});});
afterEach(()=>{jest.restoreAllMocks();fs.rmSync(root,{recursive:true,force:true});});
const main = ts.createSourceFile('main.ts',fs.readFileSync(path.resolve(process.env.TITAN_DEFECT_BASELINE || '.', 'src/main/main.ts'),'utf8'),ts.ScriptTarget.Latest,true);
function handler(receiver: string, channel: string): string {
    let source=''; const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(main)===receiver&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text===channel) source=node.arguments[1].getText(main);ts.forEachChild(node,visit);};visit(main);
    if(!source) throw Error('Missing handler '+channel);return ts.transpileModule('('+source+')',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
const tick = async()=>{for(let i=0;i<20;i++)await Promise.resolve();};

test.each([0, 1100000])('close preserves an accepted action until its own receipt, including a %i-byte log burst',async burst=>{
    const manager=new RunFileManager(root);fs.mkdirSync(path.join(root,'logs'));const log=path.join(root,'logs/debug.log');fs.writeFileSync(log,'');
    manager.writeActionWhenIdle('add_gold = 7\nroot = { trigger_event = mcc_event_v2.9003 }');
    const file=path.join(root,'run/votc.txt'),accepted=fs.readFileSync(file,'utf8');
    const closing=manager.writeAfterPending('CHECKPOINT_CLOSE',()=>true,1000,1);
    await tick();expect(fs.readFileSync(file,'utf8')).toBe(accepted);
    fs.appendFileSync(log,'VOTC:TITAN_ACTION/;/wrong\n');await tick();expect(fs.readFileSync(file,'utf8')).toBe(accepted);
    const marker=accepted.match(/debug_log = "([^"]+)"/)![1];fs.appendFileSync(log,'x'.repeat(burst)+'\n[engine] '+marker+'\n');
    expect(await closing).toBe(true);expect(fs.readFileSync(file,'utf8')).toBe('\uFEFFCHECKPOINT_CLOSE');
});
test.each(['lease','replacement','timeout'])('a pending close cannot touch a replacement encounter/save (%s)',async mode=>{
    const manager=new RunFileManager(root);manager.writeActionWhenIdle('ACCEPTED_ACTION');const file=path.join(root,'run/votc.txt');let allowed=true;
    const closing=manager.writeAfterPending('STALE_CLOSE',()=>allowed,10,1);
    if(mode==='lease')allowed=false;if(mode==='replacement')fs.writeFileSync(file,'NEW_ENCOUNTER');
    expect(await closing).toBe(false);expect(fs.readFileSync(file,'utf8')).not.toContain('STALE_CLOSE');
    if(mode==='replacement')expect(fs.readFileSync(file,'utf8')).toBe('NEW_ENCOUNTER');
});
test('the real close path waits for action consumption before stamping or writing its checkpoint',async()=>{
    const manager=new RunFileManager(root);manager.writeActionWhenIdle('ACCEPTED_ACTION');
    const conv:any=Object.assign(Object.create(Conversation.prototype),{gameData:{votcCheckpointEpoch:0},config:{userFolderPath:root},runFileManager:manager,
        closingWorkCount:0,cancelBackgroundPreparation:jest.fn(),cancelGeneration:jest.fn(),clearCloseRequestKey:jest.fn(),_saveHistoryToFile:jest.fn(),
        _generateSummariesAndDiariesInBackground:jest.fn(async()=>{}),releaseCompactorAfterClose:jest.fn()});
    const close=conv.saveHistoryAndTriggerSummarization();await tick();expect(fs.readFileSync(path.join(root,'run/votc.txt'),'utf8')).toContain('ACCEPTED_ACTION');
    expect(conv._saveHistoryToFile).not.toHaveBeenCalled();manager.clear();await close;
    expect(fs.readFileSync(path.join(root,'run/votc.txt'),'utf8')).toContain('9002');expect(conv._saveHistoryToFile).toHaveBeenCalledTimes(1);
    // Retire before the legacy cleanup timer; it must not clear another writer.
    conv.closeEffectAllowed=()=>false;fs.writeFileSync(path.join(root,'run/votc.txt'),'NEXT');
});

test.each(['<rationale>Wait.</rationale><actions>noop()<actions>','unstructured','<rationale>x<rationale></rationale><actions>noop()</actions>'])('malformed action output is safely rejected: %s',response=>{expect(parseActionResponse(response)).toBeNull();});
test('valid noop and action output retain their distinct instructions',()=>{
    expect(parseActionResponse('<rationale>Wait.</rationale><actions>noop()</actions>')?.actions).toBe('noop()');
    expect(parseActionResponse('<rationale>Pay.</rationale><actions>giveGold(1,2,7)</actions>')?.actions).toBe('giveGold(1,2,7)');
});
test.each(['reject','malformed','noop','action','abort'])('valid letter prose survives classifier %s, retaining cancellation policy',async mode=>{
    const game=new GameData(['1','Player','2','NPC','583.1.1','court','Place','Player','0']);game.characters.set(1,character(1,'Player'));game.characters.set(2,character(2,'NPC'));
    const original:any={id:'original',sender:game.getPlayer(),recipient:game.getAi(),subject:'legacy synthetic letter',content:'Question',totalDays:1,delay:9};
    const reply:any={id:'reply',triggeredActions:[],sender:game.getAi(),recipient:game.getPlayer()};
    fs.mkdirSync(path.join(root,'scripts/actions/standard'),{recursive:true});
    fs.copyFileSync(path.resolve('default_userdata/scripts/actions/standard/giveGold.js'),path.join(root,'scripts/actions/standard/giveGold.js'));
    jest.spyOn(promptBuilder,'getEffectivePrompts').mockReturnValue({actionPrompt:'Choose.'} as any);
    const classifier = async () => {
        if (mode === 'reject') throw Error('classifier offline');
        if (mode === 'abort') throw Object.assign(Error('cancelled'),{name:'AbortError'});
        return mode === 'malformed' ? '<rationale>Wait.</rationale><actions>noop()<actions>' :
            '<rationale>Wait.</rationale><actions>' + (mode==='action'?'giveGold(1,2,7)':'noop()') + '</actions>';
    };
    const generator:any=Object.assign(Object.create(LetterReplyGenerator.prototype),{votcDataPath:root,config:{language:'en',manualLetterActionApproval:true,maxTokens:100,textGenerationApiConnectionConfig:{parameters:{}}},
        apiConnection:{complete:jest.fn(async()=> 'Usable reply prose.')},buildLetterPrompt:jest.fn(async()=> 'Prompt'),
        actionsApiConnection:{isChat:()=>true,complete:jest.fn(classifier)},
        saveLetterHistory:jest.fn(async()=>reply),generateAndSaveLetterSummary:jest.fn(async()=>{}),deliverFallbackRunBlockToGame:jest.fn(async()=>{})});
    jest.spyOn(LetterManager,'getInstance').mockReturnValue({updateLetterStatus:jest.fn(),updateLetterActions:jest.fn()} as any);
    const result=await generator.generateLetterReply(game,original);
    if(mode==='abort'){expect(result).toBeNull();expect(generator.saveLetterHistory).not.toHaveBeenCalled();}
    else{if (!result) throw Error((console.error as jest.Mock).mock.calls.map(call=>call.join(' ')).join('\n'));expect(result).toBe(reply);expect(generator.saveLetterHistory).toHaveBeenCalledWith('1','2',original,'Usable reply prose.',game,expect.any(String),undefined,[]);}
});

function ordinaryFixture(mode:string){
    const player=character(1,'Player'),npc=character(2,'NPC');
    const original:any={id:'original',sender:player,recipient:npc,subject:'letter_1',content:'Question',totalDays:100,delay:9};
    const reply:any={id:'reply',replyToId:'original',sender:npc,recipient:player,totalDays:105,status:'pending',delivered:false,content:'Reply',triggeredActions:[]};
    const manager={clearLettersFile:jest.fn(),importLettersFromLog:jest.fn(async()=>{}),getAllLetters:()=>mode==='archived'?[original,reply]:[original],getLatestLetter:()=>original,updateLetterStatus:jest.fn()};
    const generate=jest.fn(async()=>mode==='null'?null:reply),diary=jest.fn(async()=>{if(mode==='provider')throw Error('diary provider offline');if(mode==='stall')return new Promise(()=>{});return{content:'Diary'};});
    const c:any=vm.createContext({console,Map,Math:{random:()=>0},path,randomUUID:()=> 'fixture-id',conversationGeneration:7,sleep:async()=>{},
        ceCompatibility:{dispatch:async()=>false},lastLetterSentToGame:null,LetterManager:{getInstance:()=>manager},
        parseLog:async()=>({playerID:1,aiID:2,date:'583.1.1',characters:new Map([[1,player],[2,npc]]),getCharacter:(id:number)=>id===1?player:npc}),
        currentTotalDays:110,totalDaysToDateString:()=> '583.1.1',config:{userFolderPath:root,diaryGenerationChance:100,manualLetterActionApproval:true},
        votcDataPath:root,tiktokenEncoder:null,readCharacterMap:async()=>new Map(),saveCharacterMap:async()=>{},letterThreadCount:0,letterThreadFullNotified:false,configWindow:null,
        updateCurrentDate:jest.fn(),LetterReplyGenerator:class{generateLetterReply=generate;},storedLetters:new Map(),
        diaryGenerator:{generateDiaryEntryForLetter:diary,summarizeDiaryEntry:jest.fn(async()=>{if(mode==='summary')throw Error('summary offline');return null;})},
        saveDiaryFile:jest.fn(async()=>{if(mode==='persist')throw Error('disk unavailable');}),readDiarySummaries:async()=>[],saveDiarySummaries:jest.fn(),checkAndDeliverLetters:jest.fn()});
    return{c,manager,generate,original,reply,run:vm.runInContext(handler('clipboardListener.on','VOTC:LETTER'),c)};
}
test.each(['provider','persist','summary','stall'])('ordinary reply queues and checks delivery before optional diary %s',async mode=>{
    const{c,run,generate}=ordinaryFixture(mode);await run();await tick();expect(generate).toHaveBeenCalledTimes(1);expect(c.storedLetters.size).toBe(1);expect(c.checkAndDeliverLetters).toHaveBeenCalledTimes(1);
});
test('redispatch recovers an archived pending reply without another prose call',async()=>{
    const{c,run,generate}=ordinaryFixture('archived');await run();await run();expect(generate).not.toHaveBeenCalled();expect(c.storedLetters.size).toBe(1);expect(c.checkAndDeliverLetters).toHaveBeenCalledTimes(1);
});
test('null prose changes the original from generating to failed',async()=>{
    const{manager,run,c}=ordinaryFixture('null');await run();expect(manager.updateLetterStatus.mock.calls.map(a=>a[3])).toEqual(['generating','failed']);expect(c.storedLetters.size).toBe(0);
});
test('a reply finishing after a save boundary cannot enter the current queue',async()=>{
    const{c,run,generate,reply}=ordinaryFixture('stall');let finish!:(value:any)=>void;generate.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=run();await tick();c.conversationGeneration++;finish(reply);await pending;expect(c.storedLetters.size).toBe(0);
});

test('authoritative edit IPC returns saved prose on rejection and refuses another encounter',()=>{
    let content='well';const editMessage=jest.fn((_id:string,next:string)=>{if(next.includes('UNRECORDED'))throw Error('Unrecorded phonetic marker');content=next;});
    const c:any=vm.createContext({conversationGeneration:7,conversation:{isOpen:true,editMessage,getHistory:()=>[{id:'one',content}]}});
    const edit=vm.runInContext(handler('ipcMain.handle','edit-message-authoritative'),c);
    expect(edit(null,{encounterId:'7',messageId:'one',newContent:'river UNRECORDED'})).toMatchObject({success:false,message:{content:'well'}});
    expect(edit(null,{encounterId:'6',messageId:'one',newContent:'old encounter'})).toMatchObject({success:false});expect(editMessage).toHaveBeenCalledTimes(1);
    expect(edit(null,{encounterId:'7',messageId:'one',newContent:'gate'})).toMatchObject({success:true,message:{content:'gate'}});
});

test.each([true,false])('CE action acknowledgement drains a detached close only while its lease is current (%s)',async allowed=>{
    const manager=new RunFileManager(root);manager.write('AUTOMATIC_ACTION');const file=path.join(root,'run/votc.txt');let lease=true;
    const pending=manager.writeAfterPending('CLOSE_AFTER_ACTION',()=>lease,20,1);
    lease=allowed;RunFileManager.acknowledgePendingCloses();
    expect(await pending).toBe(allowed);expect(fs.readFileSync(file,'utf8')).toContain(allowed?'CLOSE_AFTER_ACTION':'AUTOMATIC_ACTION');
});
