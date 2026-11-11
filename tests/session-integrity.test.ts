import fs from 'fs';import os from 'os';import path from 'path';import vm from 'vm';import ts from 'typescript';
import { readLastLogLineContaining, parseCampaignLoadedLine } from '../src/shared/gameData/parseLog';
import { CeCompatibility } from '../src/main/ceCompatibility';
import { Conversation } from '../src/main/conversation/Conversation';
import { RunFileManager } from '../src/main/RunFileManager';
import { normalizePromptPresets } from '../src/shared/promptPresets';
import { Config } from '../src/shared/Config';
let root:string;
function functionSource(file:string,name:string){const sf=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);let node:ts.FunctionDeclaration|undefined;function visit(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)node=n;ts.forEachChild(n,visit);}visit(sf);if(!node)throw Error(name);return ts.transpileModule(node.getText(sf),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;}
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'titan-session-integrity-'));for(const name of ['log','warn','error']as const)jest.spyOn(console,name).mockImplementation(()=>{});});
afterEach(()=>{jest.restoreAllMocks();fs.rmSync(root,{recursive:true,force:true});});
const boundary='VOTC:CAMPAIGN/;/loaded/;/1/;/1/;/11/;/12/;/13/;/14/;/1/;/2/;/3/;/4';
test('a cross-chunk campaign record retains its complete epoch and node fields',async()=>{
 const file=path.join(root,'debug.log'); const line=boundary+'/'+'a'.repeat(100); const suffix='x'.repeat(512*1024-60);
 fs.writeFileSync(file,'older\n'+line+'\n'+suffix);
 const found=await readLastLogLineContaining(file,'VOTC:CAMPAIGN/;/loaded/;/');expect(found).toBe(line);expect(parseCampaignLoadedLine(found!)).toEqual(parseCampaignLoadedLine(line));
});
test.each([['VOTC:DATE/;/400\nVOTC:DATE/;/200\n',200],['VOTC:DATE/;/400\n'+boundary+'\n',0],[boundary+'\nVOTC:DATE/;/250\n',250]])('startup clock respects latest log order and load boundaries',async(log,expected)=>{
 fs.mkdirSync(path.join(root,'logs'));fs.writeFileSync(path.join(root,'logs/debug.log'),log);
 const context=vm.createContext({fs,path,Buffer,console,config:{userFolderPath:root},currentTotalDays:999,parseCampaignLoadedLine});vm.runInContext(functionSource('src/main/main.ts','initCurrentDateFromLog'),context);await context.initCurrentDateFromLog();expect(context.currentTotalDays).toBe(expected);
});
test('an ordinary three-field CE receipt does not abort the remaining log batch',()=>{
 const relay=new CeCompatibility();expect(()=>{relay.observeLog('VOTC:CE_COMPAT/;/ordinary_letter/;/123');relay.observeLog('VOTC:CE_COMPAT/;/delivered/;/missing.txt/;/123');}).not.toThrow();relay.reset();
});
test('a valid save boundary revokes even a detached close lease and pending setup',()=>{
 const retired={retireWithoutGame:jest.fn()},remove=jest.fn();const c=vm.createContext({console,conversationGeneration:7,conversation:retired,pendingChatSetup:()=>{},isConversationReady:true,pendingMessages:['old'],ipcMain:{removeListener:remove},chatWindow:{conversation:retired},setLogPollInterval:jest.fn()});
 vm.runInContext(functionSource('src/main/main.ts','retireConversationWithoutGame'),c);const oldLease=()=>c.conversationGeneration===7;
 c.conversation=null; // chat-stop detached it while its asynchronous close is still running.
 c.retireConversationWithoutGame();expect(oldLease()).toBe(false);expect(remove).toHaveBeenCalledTimes(1);expect(c.pendingMessages).toHaveLength(0);expect(c.pendingChatSetup).toBeUndefined();
 // Verify the real log callback routes a valid load through that revocation.
 Object.assign(c,{clipboardListener:null,ceCompatibility:{reset:jest.fn()},parseCampaignLoadedLine,revokeEncounterOnSaveBoundary:c.retireConversationWithoutGame,currentTotalDays:400,observeCampaignLoadLine:jest.fn(),observeCultureLine:jest.fn(),observeFaithLine:jest.fn(),observeGoaLine:jest.fn(),observeEncounterLine:jest.fn(),observeSceneLine:()=>undefined,cancelConversationBackgrounds:jest.fn(),clearCultureObservations:jest.fn(),clearFaithObservations:jest.fn(),clearGoaObservations:jest.fn(),resetSceneReader:jest.fn()});
 vm.runInContext(functionSource('src/main/main.ts','processLogLine'),c);c.processLogLine(boundary);expect(c.conversationGeneration).toBe(9);expect(c.currentTotalDays).toBe(0);
});
test('live config update reloads once and preserves the pending game command byte for byte',()=>{
 const config=new Config(path.resolve('default_userdata/configs/default_config.json'));config.userFolderPath=root;
 const manager=new RunFileManager(root);manager.writeWhenIdle('FIXTURE_PENDING_COMMAND');const before=fs.readFileSync(path.join(root,'run/votc.txt'));
 const conv:any=Object.assign(Object.create(Conversation.prototype),{config,encoder:undefined,loadActions:jest.fn(),memoryCompactor:{initialize:jest.fn()}});
 const load=jest.spyOn(conv,'loadConfig');conv.updateConfig(config);expect(load).toHaveBeenCalledTimes(1);expect(fs.readFileSync(path.join(root,'run/votc.txt'))).toEqual(before);
});
test('loading an archive during generation retains the exact shared archive collection',async()=>{
 const archive=[{id:'recent'},{id:'old'}];const conv:any=Object.assign(Object.create(Conversation.prototype),{historicalConversations:archive,config:{maxHistoricalConversations:1}});
 await conv.withLimitedHistory(async()=>{conv.historicalConversations.push({id:'loaded-during-generation'});});
 expect(conv.historicalConversations).toBe(archive);expect(conv.historicalConversations.map((r:any)=>r.id)).toContain('loaded-during-generation');
});
test('legacy flat presets and current scoped presets retain their exact authored fields',()=>{
 expect(normalizePromptPresets({MyPreset:{mainPrompt:'AUTHORED',rolePrompt:'ROLE'}})).toEqual({global:{MyPreset:{mainPrompt:'AUTHORED',rolePrompt:'ROLE'}}});
 expect(normalizePromptPresets({global:{A:{mainPrompt:'GLOBAL'}},'1':{B:{mainPrompt:'PLAYER'}}})).toEqual({global:{A:{mainPrompt:'GLOBAL'}},'1':{B:{mainPrompt:'PLAYER'}}});
});

test('editing custom embedding connection preserves dimension and input type through both real IPC callbacks',()=>{
 const file='src/main/main.ts',sf=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 const c=vm.createContext({console,config:{embeddingApiConnectionConfig:{connection:{type:'custom',model:'old',key:'fixture',baseUrl:'https://fixture.invalid',useCustomEmbeddingDimension:true,embeddingDimension:3072,embeddingInputType:'search_document',apiKeys:{}}},export:jest.fn()},chatWindow:{isShown:false},DiaryGenerator:class{},votcDataPath:root,tiktokenEncoder:null,diaryGenerator:null});
 const callback=(channel:string)=>{let found:ts.Node|undefined;function visit(n:ts.Node){if(ts.isCallExpression(n)&&n.expression.getText(sf)==='ipcMain.on'&&(n.arguments[0]as ts.StringLiteral).text===channel)found=n.arguments[1];ts.forEachChild(n,visit);}visit(sf);if(!found)throw Error(channel);return vm.runInContext(ts.transpileModule('('+found.getText(sf)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,c);};
 callback('config-change-nested')(null,'embeddingApiConnectionConfig','connection',{type:'custom',model:'new',key:'fixture',baseUrl:'https://fixture.invalid'});
 callback('api-config-change')(null,'embeddingApiConnectionConfig','custom',{model:'new',key:'fixture',baseUrl:'https://fixture.invalid'});
 expect(c.config.embeddingApiConnectionConfig.connection).toMatchObject({model:'new',useCustomEmbeddingDimension:true,embeddingDimension:3072,embeddingInputType:'search_document'});
});

test('Chronicle report lookup chooses the nearest ancestor and cannot read a sibling report',()=>{
 const {TimelineRegistry}=require('../src/main/timelineManager');const node=(parentId:string|null,epoch:number)=>({parentId,epoch,source:'conversation',eventKey:String(epoch),createdAt:new Date(0).toISOString()});
 const registry=new TimelineRegistry('1',{version:1,playerId:'1',nodes:{'1-1':node(null,1),'2-2':node('1-1',2),'3-3':node('1-1',2),'4-4':node('2-2',3)}});
 let actual={campaign:'11-12-13-14',timeline:'4-4',actor:'2'};
 const c=vm.createContext({fs,path,createHash:require('crypto').createHash,encounterLoreIdentity:()=>actual,loadCampaignStore:()=>({status:'found',store:registry}),requireCampaignIdentity:()=>({campaignId:actual.campaign,playerId:'1'}),buildContextFromGameData:()=>({checkpointEpoch:3})});
 for(const name of ['reportPath','reportLocation'])vm.runInContext(functionSource('src/main/lorebook/lorebookRuntime.ts',name),c);
 const parent=c.reportPath(root,actual.campaign,'2-2','2'),sibling=c.reportPath(root,actual.campaign,'3-3','2');fs.mkdirSync(path.dirname(parent),{recursive:true});fs.writeFileSync(parent,'parent');fs.writeFileSync(sibling,'sibling');
 expect(c.reportLocation(root,{},2).file).toBe(parent);
 actual={...actual,timeline:'1-1'};expect(c.reportLocation(root,{},2).file).not.toBe(parent);expect(c.reportLocation(root,{},2).file).not.toBe(sibling);
 actual={...actual,timeline:'4-4'};const exact=c.reportPath(root,actual.campaign,actual.timeline,'2');fs.writeFileSync(exact,'child');expect(c.reportLocation(root,{},2).file).toBe(exact);
});
