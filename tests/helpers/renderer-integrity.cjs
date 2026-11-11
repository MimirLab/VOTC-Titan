const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('typescript'),assert=require('assert/strict');
const {JSDOM}=require('jsdom');
const root=path.resolve((require.main===module&&process.argv[2])||path.join(__dirname,'../..'));
function source(file){const text=fs.readFileSync(path.join(root,file),'utf8');return ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);}
function context(html,extra={}){const dom=new JSDOM(html);const w=dom.window;w.LocalizationManager={getNestedTranslation:(_k,f)=>typeof f==='string'?f:'Text',getTranslation:(_k,f)=>f||'Text'};
 const c=vm.createContext({console:{log(){},error(){},warn(){}},window:w,document:w.document,Event:w.Event,HTMLElement:w.HTMLElement,setTimeout(){},...extra});return c;}
function run(c,text){return vm.runInContext(ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,c);}
function functions(c,file,names){const sf=source(file);for(const name of names){const node=sf.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(node,'Missing function '+name);run(c,node.getText(sf));}}
function callback(c,file,channel){const sf=source(file);let found;function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(sf)==='ipcRenderer.on'&&n.arguments[0]?.text===channel)found=n.arguments[1];ts.forEachChild(n,visit);}visit(sf);assert(found,'Missing IPC '+channel);return run(c,'('+found.getText(sf)+')');}
const chat='src/chatWindow/chatRenderer.ts',summary='src/configWindow/summarizationRenderer.ts',prompts='src/configWindow/promptsRenderer.ts';
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
let passed=[];
async function test(name,fn){if(process.env.TITAN_RENDERER_CASE&&!name.includes(process.env.TITAN_RENDERER_CASE))return;await fn();passed.push(name);}
module.exports=async function runRendererChecks(){
await test('target checkbox updates both submitted IDs and visible caption, also after reopening',async()=>{
 const c=context('<div id="character-target-wrapper"><div id="character-target-value"></div><div id="character-target-options"></div><input id="character-target-hidden-input"></div>');
 functions(c,chat,['setupCharacterTargeting']);const game={playerID:1,characters:new Map([[1,{id:1,shortName:'Player'}],[2,{id:2,shortName:'A'}],[3,{id:3,shortName:'B'}]])};
 for(let n=0;n<2;n++){c.setupCharacterTargeting(game);const box=c.document.getElementById('target-char-3');box.checked=true;box.dispatchEvent(new c.window.Event('change',{bubbles:true}));assert.equal(c.document.getElementById('character-target-hidden-input').value,'3');assert.equal(c.document.getElementById('character-target-value').textContent,'B');}
});
await test('late chat history and config cannot republish a retired player',async()=>{
 const a=deferred(),b=deferred(),configA=deferred();let configCalls=0;
 const c=context('<div class="chat-box"></div><div id="messages"></div><input id="input">',{chatSessionGeneration:0,chatSessionLoading:false,chatReadyReceived:true,
 displayedMessageIds:new Set(),currentConversationMessageDivs:[],basePromptTokens:0,availableActions:[],playerName:'',aiName:'',currentGameData:null,messageHistory:[],historyIndex:0,
 characterColorMap:new Map(),nextColorIndex:0,initialWindowState:{width:'1'},contextLimit:0,showTokenizerDisplay:false,clearHistoryButton:null,
 removeLoadingDots(){},updateLauncherSceneGallery(){},updateLauncherSceneArt(){},setupCharacterTargeting(g){c.targetPlayer=g.playerID;},initChat(){c.chatMessages.innerHTML='';},updateSuggestionsContainerStyle(){},currentConversationHeader:()=>'',
 GameData:{fromPlainObject:v=>v},ipcRenderer:{invoke(channel,id){if(channel==='get-prompt-history')return id==='1'?a.promise:b.promise;if(channel==='get-config')return ++configCalls===1?configA.promise:Promise.resolve({});return Promise.resolve(8000);}}});
 c.chatMessages=c.document.getElementById('messages');c.chatInput=c.document.getElementById('input');const start=callback(c,chat,'chat-start');
 const payload=id=>({gameData:{playerID:id,playerName:'Player'+id,characters:new Map()},historicalMetadata:[],messages:[],actions:[],narratives:[]});
 const first=start(null,payload(1));a.resolve(['HISTORY_A']);await tick();const second=start(null,payload(2));b.resolve(['HISTORY_B']);await second;configA.resolve({});await first;
 assert.equal(c.currentGameData.playerID,2);assert.equal(c.targetPlayer,2);assert.deepEqual(Array.from(c.messageHistory),['HISTORY_B']);
});
await test('suggested replies use the same ID, selected audience, and player history as typed replies',async()=>{
 const sent=[];const c=context('<div id="character-target-wrapper" style="display:flex"><input id="character-target-hidden-input" value="2,3"></div>',{
 currentGameData:{playerID:1},chatInput:{disabled:false,value:'suggestion'},chatSessionGeneration:1,chatSessionLoading:false,playerName:'Player',messageHistory:[],historyIndex:0,currentConversationMessageDivs:[],randomUUID:()=> 'fixture-id',
 displayMessage:async()=>undefined,showLoadingDots(){},ipcRenderer:{send(...args){sent.push(args);}}});
 functions(c,chat,['submitPlayerMessage']);await c.submitPlayerMessage('A suggestion.');const payload=sent.find(a=>a[0]==='message-send')[1];assert.equal(payload.id,'fixture-id');assert.deepEqual(Array.from(payload.targetCharacterIds),[2,3]);assert.deepEqual(Array.from(sent.find(a=>a[0]==='save-prompt-history')[1].history),['A suggestion.']);
 // Exercise the actual suggestion callback, with the shared submit helper above.
 functions(c,chat,['displaySuggestions']);c.autoSendSuggestion=true;c.suggestionsList=c.document.createElement('div');c.suggestionsContainer=c.document.createElement('div');c.displaySuggestions(['2. Suggested words.']);c.suggestionsList.firstElementChild.click();await tick();assert.equal(sent.filter(a=>a[0]==='message-send').length,2);
});
await test('summary loads publish one complete selected-player dataset',async()=>{
 const delayed=deferred();const c=context('<select id="p"><option value="1">A</option><option value="2">B</option></select>',{
 summaryLoadGeneration:0,loadedPlayerId:'',selectedPlayerId:'',selectedCharacterId:'all',editRevisions:{},allSummaries:[],allLetters:[],allDiaries:[],hasUnsavedChanges:false,characterMap:{},
 summaryLoader:{style:{}},summaryList:{innerHTML:''},saveBtn:{disabled:false},characterSelect:{options:[],value:'all'},showStatusMessage(){},populateCharacterSelect(){},filterCurrentTabData(){},updateSaveButtonState(){},
 ipcRenderer:{async invoke(channel,id,kind){if(channel==='get-character-map')return{success:true,map:{}};if(id==='1'&&(['read-summary-edit-snapshot','read-summary-file'].includes(channel)))await delayed.promise;
 if(channel==='read-summary-edit-snapshot')return{data:[{characterId:'2',content:'PLAYER_'+id}],revision:id+kind};return[{characterId:'2',content:'PLAYER_'+id}];}}});c.playerIdSelect=c.document.getElementById('p');
 functions(c,summary,['loadAllDataForPlayer']);const first=c.loadAllDataForPlayer();await tick();c.playerIdSelect.value='2';await c.loadAllDataForPlayer();delayed.resolve();await first;
 assert.equal(c.selectedPlayerId,'2');assert.equal(c.allSummaries[0].content,'PLAYER_2');assert.equal(c.allLetters[0].content,'PLAYER_2');
});
for(const tab of ['conversations','letters','diaries'])await test('failed '+tab+' save retains dirty edits and reports error',async()=>{
 const status=[];const c=context('',{activeTab:tab,loadedPlayerId:'1',selectedPlayerId:'1',playerIdSelect:{value:'1'},summaryLoadGeneration:1,editRevisions:{[tab]:'receipt'},allSummaries:[],allLetters:[],allDiaries:[],hasUnsavedChanges:true,refreshBtn:{},saveBtn:{},showStatusMessage:(...a)=>status.push(a),updateSaveButtonState(){},ipcRenderer:{invoke:async()=>({success:false,error:'fixture denied'})}});
 functions(c,summary,['saveCurrentTabData']);await c.saveCurrentTabData();assert.equal(c.hasUnsavedChanges,true);assert.equal(status.at(-1)[1],'error');assert.match(status.at(-1)[0],/fixture denied/);
});
await test('browsing presets never activates or writes a preset',async()=>{
 const sends=[],invokes=[];const c=context('<select id="presets"></select>',{promptPresets:{global:{Chosen:{mainPrompt:'Custom'}}},characterFilterSelect:{value:'global'},defaultPrompts:{prompts:{mainPrompt:'Default'},mod_prompt_sets:{}},promptKeys:['mainPrompt'],promptTextareas:{mainPrompt:{textarea:{dispatchEvent(){}}}},promptPresetNameInput:{},suffixPromptCheckbox:{checkbox:{}},suffixPromptTextarea:{textarea:{}},deletePromptPresetBtn:{style:{}},togglePrompt(){},setSaveButtonState(){},updateTokenCount(){},ipcRenderer:{send:(...a)=>sends.push(a),invoke:async(channel)=>{invokes.push(channel);return{activePromptPreset:'Chosen',language:'en'};}}});c.promptPresetSelect=c.document.getElementById('presets');functions(c,prompts,['populatePresetSelector','handlePresetChange']);await c.populatePresetSelector();assert.equal(c.promptPresetSelect.value,'Chosen');assert.equal(c.promptTextareas.mainPrompt.textarea.value,'Custom');assert.equal(sends.length,0);assert(!invokes.includes('save-prompt-presets'));
});
await test('rejected preset write keeps the draft and dirty state',async()=>{
 const status=[];let dirty=false;const c=context('',{promptPresetNameInput:{value:'New',focus(){}},characterFilterSelect:{value:'global'},defaultPrompts:{prompts:{},mod_prompt_sets:{}},promptPresets:{global:{}},promptKeys:['mainPrompt'],promptTextareas:{mainPrompt:{textarea:{value:'Draft'}}},showStatusMessage:(...a)=>status.push(a),setSaveButtonState:v=>dirty=v,populatePresetSelector:async()=>{},ipcRenderer:{invoke:async channel=>channel==='get-config'?{}:{success:false,error:'fixture denied'}}});functions(c,prompts,['saveCurrentPreset']);await c.saveCurrentPreset();assert.equal(dirty,true);assert.equal(status.at(-1)[1],'error');assert.equal(c.promptTextareas.mainPrompt.textarea.value,'Draft');assert(!c.promptPresets.global.New);
});
return {passed:true,checks:passed.length,scenarios:passed};
};
if(require.main===module)module.exports().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;});
