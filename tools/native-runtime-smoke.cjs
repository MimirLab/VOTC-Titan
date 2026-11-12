const {CDP}=require('./titan-ui-smoke.cjs');
const fs=require('fs');const assert=require('assert/strict');
const [rendererPort,mainPort,resultPath,electronPath,expectedRoot,expectedGame,storageReport]=process.argv.slice(2);
const path=require('path');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const targets=await(await fetch(`http://127.0.0.1:${mainPort}/json`)).json();const m=await CDP.connect(targets[0].webSocketDebuggerUrl);
 const pages=await(await fetch(`http://127.0.0.1:${rendererPort}/json`)).json();const p=pages.find(p=>/configWindow\/\w+.html$/.test(p.url));assert(p);const r=await CDP.connect(p.webSocketDebuggerUrl);
 const report={};
 try{
  await m.eval(`(()=>{const e=process.mainModule.require('electron');global.titanTest={overlay:[]};const o=process.mainModule.require('electron-overlay-window').OverlayController;for(const event of ['attach','focus','blur'])o.events.on(event,()=>global.titanTest.overlay.push(event));for(const w of e.BrowserWindow.getAllWindows().filter(w=>w.getTitle()==='Crusader Kings III'))w.close();global.titanTarget=new e.BrowserWindow({title:'Crusader Kings III',width:900,height:700,webPreferences:{nodeIntegration:true,contextIsolation:false}});global.titanTarget.loadURL('data:text/html,<title>Crusader Kings III</title><body>Synthetic CK3 target window</body>');return true})()`);await pause(600);
  report.paths=await r.eval(`(async()=>{const ipc=require('electron').ipcRenderer;const c=await ipc.invoke('get-config');return {root:await ipc.invoke('get-userdata-path'),game:c.userFolderPath}})()`);
  assert.equal(report.paths.root,expectedRoot);assert.equal(report.paths.game,expectedGame);
  console.log('Native runtime check: paths');
  fs.appendFileSync(report.paths.game+'/logs/debug.log','VOTC:DATE/;/184802\n');await pause(100);
  for(let deadline=Date.now()+5000;Date.now()<deadline;){report.logDay=await r.eval(`require('electron').ipcRenderer.invoke('get-current-game-day')`);if(report.logDay===184802)break;await pause(200)}assert.equal(report.logDay,184802);
  const file=report.paths.game+'/run/votc.txt';const script='\uFEFFdebug_log = "Titan synthetic runfile probe"\n';fs.writeFileSync(file,script);assert.equal(fs.readFileSync(file,'utf8'),script);
  assert(fs.readFileSync(report.paths.game+'/run/letters.txt','utf8').includes('talk_event.9999'));report.runfileAndLetterPaths=true;
  console.log('Native runtime check: log and run files');
  await r.eval(`(()=>{require('electron').ipcRenderer.send('config-change','stream',true);return true})()`);await pause(300);
  assert.equal(JSON.parse(fs.readFileSync(report.paths.root+'/configs/config.json')).stream,true);report.settingsPersist=true;
  console.log('Native runtime check: settings');
  await m.eval(`(()=>{const e=process.mainModule.require('electron');if(typeof global.titanSavedClipboard!=='string')global.titanSavedClipboard=e.clipboard.readText();e.clipboard.writeText('TITAN_NATIVE_CLIPBOARD_PROBE');return true})()`);await pause(250);
  const peerReport=path.join(path.dirname(resultPath),'clipboard-peer-report.json');
  const peerEnv={...process.env};delete peerEnv.ELECTRON_RUN_AS_NODE;
  const child=require('child_process').spawnSync(electronPath,[path.resolve('tools/clipboard-peer.cjs'),peerReport,'--no-sandbox','--disable-gpu'],{timeout:10000,stdio:'ignore',env:peerEnv});assert.equal(child.status,0);await pause(200);
  const peer=JSON.parse(fs.readFileSync(peerReport)); assert.equal(peer.mainToPeer,true);assert.equal(peer.peerCommandRestored,true);report.clipboard=peer;
  console.log('Native runtime check: clipboard');
  report.actionNotices=await m.eval(`(async()=>{
   const e=process.mainModule.require('electron'),root=e.app.getAppPath(),load=p=>process.mainModule.require(root+'/'+p);
   const {GameData}=load('dist/shared/gameData/GameData.js'),{Character}=load('dist/shared/gameData/Character.js');
   const {formatActionNotice}=load('dist/main/conversation/actionNotice.js');
   const game=new GameData(['1','Arthas','2','Aegwynn','1066.9.15','votc_scene_council','Synthetic county','Arthas','0']);
   for(const [id,name,pronoun] of [[1,'Arthas','he'],[2,'Aegwynn','she']]){const row=Array(27).fill('');row[0]=String(id);row[1]=row[2]=name;row[4]=pronoun;game.characters.set(id,new Character(row))}
   const actions=[['changeStress',['soothe_minor'],1,2],['inviteToCourt',[],2,1],['addDread',['reassure_minor'],1,2]].map(([name,args,source,target])=>{
    const action=load('default_userdata/scripts/actions/standard/'+name+'.js');return {actionName:name,chatMessage:formatActionNotice(action,args,game,source,target,'en'),chatMessageClass:action.chatMessageClass}
   });
   const w=e.BrowserWindow.getAllWindows().find(w=>w.getTitle().endsWith(' - Chat'));
   w.webContents.send('message-receive',{id:'notice-probe',role:'assistant',name:'Aegwynn',content:'Synthetic notice check.'},false);
   await new Promise(r=>setTimeout(r,150));
   w.webContents.send('actions-receive',actions,null);
   const approval=load('default_userdata/scripts/actions/standard/changeStress.js');
   w.webContents.send('action-approval-request','notice-probe',[{actionName:'changeStress',chatMessage:formatActionNotice(approval,['soothe_minor'],game,2,1,'en')}]);
   await new Promise(r=>setTimeout(r,150));
   const rendered=await w.webContents.executeJavaScript("[...document.querySelectorAll('.action-feedback,.action-prompt')].map(n=>n.innerText).join(' | ')");
   return {messages:actions.map(a=>a.chatMessage),rendered,sharedVariablesUntouched:game.character1Name===''&&game.character2Name===''}
  })()`);
  assert.deepEqual(report.actionNotices.messages,['Arthas soothed Aegwynn, easing her stress.','Aegwynn invited Arthas to her court.','Arthas reassured Aegwynn, reducing his dread.']);
  for(const message of [...report.actionNotices.messages,'Aegwynn soothed Arthas, easing his stress.'])assert(report.actionNotices.rendered.includes(message));
  assert(!report.actionNotices.rendered.includes('{{'));assert(report.actionNotices.sharedVariablesUntouched);
  console.log('Native runtime check: action notices and approval rendering');
  report.encounterUiOwnership=await m.eval(`(async()=>{
   const e=process.mainModule.require('electron'),root=e.app.getAppPath(),load=p=>process.mainModule.require(root+'/'+p);
   const {bindEncounterChatWindow}=load('dist/main/conversation/encounterUi.js');
   const window=e.BrowserWindow.getAllWindows().find(w=>w.getTitle().endsWith(' - Chat'));
   await window.webContents.executeJavaScript("(()=>{global.nativeEncounterMessages=[];global.nativeEncounterListener=(_event,value)=>global.nativeEncounterMessages.push(value);require('electron').ipcRenderer.on('native-encounter-ui-probe',global.nativeEncounterListener);return true})()");
   let active=true,hidden=false;const scoped=bindEncounterChatWindow({window,hide(){hidden=true;}},()=>active);
   const bounds=scoped.window.getBounds();scoped.window.webContents.send('native-encounter-ui-probe','current');active=false;
   scoped.window.webContents.send('native-encounter-ui-probe','retired');scoped.hide();await new Promise(resolve=>setTimeout(resolve,150));
   const received=await window.webContents.executeJavaScript("(()=>{const values=global.nativeEncounterMessages;require('electron').ipcRenderer.removeListener('native-encounter-ui-probe',global.nativeEncounterListener);delete global.nativeEncounterMessages;delete global.nativeEncounterListener;return values})()");
   return {currentDelivered:received.length===1&&received[0]==='current',retiredSuppressed:!received.includes('retired'),retiredHideSuppressed:!hidden,nativeWindowReceiverWorks:Number.isFinite(bounds.x),modelRequests:0};
  })()`);
  for(const [key,value]of Object.entries(report.encounterUiOwnership))if(key!=='modelRequests')assert.equal(value,true,key);
  assert.equal(report.encounterUiOwnership.modelRequests,0);
  console.log('Native runtime check: scoped shared-window sends and native method binding');
  report.controlledLanguageEditor=await m.eval(`(async()=>{
   const e=process.mainModule.require('electron'),root=e.app.getAppPath(),load=p=>process.mainModule.require(root+'/'+p);
   const {GameData}=load('dist/shared/gameData/GameData.js'),{Character}=load('dist/shared/gameData/Character.js');
   const {loadLanguageEngine}=load('dist/main/language/languageEngine.js'),{LanguageConversation}=load('dist/main/language/languageConversation.js');
   const game=new GameData(['1','Reader','2','Speaker','1066.9.15','court','Synthetic room','Reader','0']);
   for(const [id,name,tongue]of [[1,'Reader','language_low_common'],[2,'Speaker','language_common'],[3,'Observer','language_orcish']]){
    const data=Array(27).fill('');data[0]=String(id);data[1]=data[2]=name;const actor=new Character(data);
    actor.languageSnapshot={version:1,complete:true,nativeLanguageId:tongue,knownLanguageIds:[tongue]};game.characters.set(id,actor);
   }
   const session=new LanguageConversation(game,loadLanguageEngine(root+'/public/languages').renderer);
   const message={id:'controlled-editor-probe',role:'assistant',name:'Speaker',characterId:2,proseEncoding:'controls-v1',content:'**She offers the cup.** ~~She remembers the hidden opal.~~ ""Bring water before dawn.""'+String.fromCharCode(10,10)+'**She waits by the door.** ""I will stay here.""'};
   session.record(message);const before=message.content,reader=session.forRecipient(message,1,'reader');
   const w=e.BrowserWindow.getAllWindows().find(w=>w.getTitle().endsWith(' - Chat'));const received=[];
   const handler=(event,payload)=>{if(payload.messageId!==message.id)throw Error('Wrong synthetic edit owner');received.push(payload);
    try{session.editForRecipient(message,1,payload.newContent,'reader');return {success:true,message:session.forRecipient(message,1,'reader')};}
    catch(error){return {success:false,error:error.message,message:session.forRecipient(message,1,'reader')};}};
   e.ipcMain.handle('native-controlled-editor-edit',handler);
   await w.webContents.executeJavaScript("(()=>{const ipc=require('electron').ipcRenderer;global.nativeEditorInvoke=ipc.invoke;ipc.invoke=function(channel,...args){if(channel==='edit-message-authoritative'&&args[0]?.messageId==='controlled-editor-probe')return global.nativeEditorInvoke.call(this,'native-controlled-editor-edit',...args);return global.nativeEditorInvoke.call(this,channel,...args);};return true})()");
   try{
    w.webContents.send('message-receive',reader,false);await new Promise(r=>setTimeout(r,150));
    const displayed=await w.webContents.executeJavaScript("document.querySelector('#message-controlled-editor-probe .message-content').innerText");
    const paragraphDisplay=await w.webContents.executeJavaScript("(()=>{const node=document.querySelector('#message-controlled-editor-probe .message-content');const current=getComputedStyle(node).whiteSpace;node.style.whiteSpace='normal';const collapsed=node.innerText;node.style.removeProperty('white-space');return {whiteSpace:current,oldStyleCollapsesParagraphs:!collapsed.includes(String.fromCharCode(10,10)),restoredText:node.innerText}})()");
    await w.webContents.executeJavaScript("(()=>{const node=document.querySelector('#message-controlled-editor-probe .message-content');node.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return true})()");
    const editing=await w.webContents.executeJavaScript("document.querySelector('#message-controlled-editor-probe .message-content').innerText");
    await w.webContents.executeJavaScript("(()=>{const node=document.querySelector('#message-controlled-editor-probe .message-content');node.innerText=node.innerText.replace('Bring waeter','My heard spelling');node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return true})()");
    await new Promise(r=>setTimeout(r,200));
    const cleaned=await w.webContents.executeJavaScript("document.querySelector('#message-controlled-editor-probe .message-content').innerText");
    return {displayed,paragraphDisplay,editing,cleaned,editsReceived:received.length,sourceUnchanged:before===message.content,
     readerKeepsThought:session.forRecipient(message,1,'reader').content.includes('hidden opal'),
     playerKnowledgeExcludesThought:!session.forRecipient(message,1).content.includes('opal'),
     observerUnchanged:!session.forRecipient(message,3).content.includes('My heard spelling'),
     ipcBridge:'Isolated acknowledged edit IPC; actual renderer/parser and backend language edit, no live Conversation or model request.'};
   }finally{e.ipcMain.removeHandler('native-controlled-editor-edit');await w.webContents.executeJavaScript("(()=>{require('electron').ipcRenderer.invoke=global.nativeEditorInvoke;delete global.nativeEditorInvoke;document.getElementById('message-controlled-editor-probe')?.remove();return true})()");}
  })()`);
  assert(report.controlledLanguageEditor.displayed.includes('hidden opal'));assert(!report.controlledLanguageEditor.displayed.includes('~~'));
  assert(report.controlledLanguageEditor.displayed.includes('\n\n'));assert(report.controlledLanguageEditor.editing.includes('\n\n'));assert(report.controlledLanguageEditor.cleaned.includes('\n\n'));
  assert.equal(report.controlledLanguageEditor.paragraphDisplay.whiteSpace,'pre-wrap');assert(report.controlledLanguageEditor.paragraphDisplay.oldStyleCollapsesParagraphs);assert.equal(report.controlledLanguageEditor.paragraphDisplay.restoredText,report.controlledLanguageEditor.displayed);
  assert(report.controlledLanguageEditor.editing.includes('~~She remembers'));assert(!report.controlledLanguageEditor.editing.includes('Bring water'));
  assert(report.controlledLanguageEditor.cleaned.includes('My heard spelling'));assert(!report.controlledLanguageEditor.cleaned.includes('~~'));
  assert.equal(report.controlledLanguageEditor.editsReceived,1);assert(report.controlledLanguageEditor.sourceUnchanged);
  assert(report.controlledLanguageEditor.readerKeepsThought&&report.controlledLanguageEditor.playerKnowledgeExcludesThought&&report.controlledLanguageEditor.observerUnchanged);
  console.log('Native runtime check: controlled prose reading, editing and owner knowledge');
  report.controlledFormatReading=await m.eval(`(async()=>{
   const e=process.mainModule.require('electron'),root=e.app.getAppPath(),load=p=>process.mainModule.require(root+'/'+p);
   const {normalizeControlledProseFormatting,parseControlledProse,controlledProseView}=load('dist/shared/language/controlledProse.js');
   const raw='**She sets the cloth down** and **rests her hand.** "Wait here."'+String.fromCharCode(10,10)+'~~She remembers "a private word".~~ "We have time."';
   const repaired=normalizeControlledProseFormatting(raw),view=controlledProseView(parseControlledProse(repaired),true);
   const w=e.BrowserWindow.getAllWindows().find(w=>w.getTitle().endsWith(' - Chat'));
   if(!w)throw new Error('Synthetic chat window missing from formatting probe');
   try{
    w.webContents.send('message-receive',{id:'controlled-format-reading-probe',role:'assistant',name:'Speaker',content:view.content},false);
    await new Promise(r=>setTimeout(r,150));
    return await w.webContents.executeJavaScript("(()=>{const node=document.querySelector('#message-controlled-format-reading-probe .message-content');return {text:node.innerText,whiteSpace:getComputedStyle(node).whiteSpace,blockChildren:node.querySelectorAll('p,div').length,emphasisSpans:node.querySelectorAll('em').length}})()");
   }finally{await w.webContents.executeJavaScript("document.getElementById('message-controlled-format-reading-probe')?.remove()");}
  })()`);
  assert.equal(report.controlledFormatReading.text,'She sets the cloth down and rests her hand. "Wait here."\n\nShe remembers "a private word". "We have time."');
  assert.equal(report.controlledFormatReading.whiteSpace,'pre-wrap');assert.equal(report.controlledFormatReading.blockChildren,0);assert(report.controlledFormatReading.emphasisSpans>=3);
  console.log('Native runtime check: local delimiter cleanup keeps woven inline prose and paragraphs');
  report.controlledPrivateMemory=await m.eval(`(async()=>{
   const e=process.mainModule.require('electron'),root=e.app.getAppPath(),load=p=>process.mainModule.require(root+'/'+p);
   const {GameData}=load('dist/shared/gameData/GameData.js'),{Character}=load('dist/shared/gameData/Character.js');
   const {Conversation}=load('dist/main/conversation/Conversation.js'),{ConversationLedger}=load('dist/main/language/conversationLedger.js');
   const {LanguageConversation}=load('dist/main/language/languageConversation.js'),{loadLanguageEngine}=load('dist/main/language/languageEngine.js');
   const {MemoryCompactor}=load('dist/main/conversation/MemoryCompactor.js'),{compactedMemoryStore}=load('dist/main/compactedMemoryStore.js');
   const {createCompactedMemoryString}=load('dist/main/conversation/promptBuilder.js');const {privateMemoryNarration}=load('dist/main/language/privateMemory.js');
   const config=Object.assign({},load('default_userdata/configs/default_config.json'),{enableMemoryCompaction:true,compactionPhase1Threshold:1,compactionPhase2Threshold:1,compactionCooldownMinutes:0});
   const game=new GameData(['1','Player','2','Speaker','1066.9.15','court','Guest room','Player','0']);
   for(const [id,name,tongue]of [[1,'Player','language_low_common'],[2,'Speaker','language_common'],[3,'Observer','language_orcish']]){
    const data=Array(27).fill('');data[0]=String(id);data[1]=data[2]=name;const actor=new Character(data);actor.languageSnapshot={version:1,complete:true,nativeLanguageId:tongue,knownLanguageIds:[tongue]};game.characters.set(id,actor);
   }
   const session=new LanguageConversation(game,loadLanguageEngine(root+'/public/languages').renderer),ledger=new ConversationLedger(game.playerID);
   const message={id:'native-private-memory-source',role:'assistant',characterId:2,name:'Speaker',proseEncoding:'controls-v1',content:'**She offers the cup.** ~~She plans to hide a ruby beneath the northern bench tonight.~~ ""Bring water before dawn.""'};
   session.record(message);ledger.append(message,game.characters.values());const compactor=new MemoryCompactor(config);
   const conv=Object.assign(Object.create(Conversation.prototype),{config,gameData:game,votcDataPath:${JSON.stringify(expectedRoot)},messages:[message],encounterLedger:ledger,currentSummary:'',recipientCurrentSummaries:new Map(),memoryCompactor:compactor,
    calculateBasePromptTokens:async()=>100,textGenApiConnection:{context:1000,calculateTokensFromMessage:()=>100},
    summarizationApiConnection:{isChat:()=>true,complete:async()=> 'The speaker offered a cup and spoke.'},
    getMessagesForRecipient:(id,messages)=>session.messagesForRecipient(messages,id),getCurrentSummaryForRecipient:()=>''});
   const result=await compactor.compact(conv),disk=await compactedMemoryStore.getAllCompactedMemories('1');
   const restored=new MemoryCompactor(config);await restored.loadFromDisk('1');
   const ownerText=createCompactedMemoryString({...conv,memoryCompactor:restored},{},game.characters.get(2));
   const otherText=createCompactedMemoryString({...conv,memoryCompactor:restored},{},game.characters.get(3));
   const before=restored.getAllCompactedMemories().map(memory=>memory.id);const repeated=await restored.compact({...conv,memoryCompactor:restored});
   return {phase1:result.phase1Run,phase2:result.phase2Run,canonicalRetained:ledger.messages.length===1,workingTrimmed:conv.messages.length===0,
    providerSummaryOmittedPrivate:restored.getCompactedMemories('2').every(memory=>!memory.content.includes('ruby')),
    exactPrivateSourcePersisted:restored.getCompactedMemories('2').every(memory=>privateMemoryNarration(memory,2,restored.getCompactedMemories('2'))[0].content==='She plans to hide a ruby beneath the northern bench tonight.'),
    sourceDatePersisted:restored.getCompactedMemories('2').every(memory=>privateMemoryNarration(memory,2,restored.getCompactedMemories('2'))[0].sourceGameDate===game.date),
    ownerPromptHasUnspokenContext:ownerText.includes('[Private inner narration, unspoken: She plans'),otherPromptHasNoSecret:!otherText.includes('ruby'),
    encryptedDiskOwnerReplay:disk.memories.length===restored.getAllCompactedMemories().length,
    repeatedConsolidationSkipped:!repeated.phase2Run&&JSON.stringify(before)===JSON.stringify(restored.getAllCompactedMemories().map(memory=>memory.id)),modelRequests:0};
  })()`);
  for(const [key,value]of Object.entries(report.controlledPrivateMemory))if(key!=='modelRequests')assert.equal(value,true,key);
  assert.equal(report.controlledPrivateMemory.modelRequests,0);
  console.log('Native runtime check: private source retention through encrypted compaction, owner prompts and disk replay');
  report.controlledMemoryScope=await m.eval(`(async()=>{
   const e=process.mainModule.require('electron'),root=e.app.getAppPath(),load=p=>process.mainModule.require(root+'/'+p);
   const {GameData}=load('dist/shared/gameData/GameData.js'),{Character}=load('dist/shared/gameData/Character.js');
   const {Conversation}=load('dist/main/conversation/Conversation.js'),{ConversationLedger}=load('dist/main/language/conversationLedger.js');
   const {LanguageConversation}=load('dist/main/language/languageConversation.js'),{loadLanguageEngine}=load('dist/main/language/languageEngine.js');
   const {MemoryCompactor}=load('dist/main/conversation/MemoryCompactor.js'),{compactedMemoryStore}=load('dist/main/compactedMemoryStore.js');
   const {createCompactedMemoryString}=load('dist/main/conversation/promptBuilder.js'),{buildIdentityFromParts}=load('dist/shared/gameData/CampaignIdentity.js');
   const {TimelineRegistry}=load('dist/main/timelineManager.js');
   const config=Object.assign({},load('default_userdata/configs/default_config.json'),{enableMemoryCompaction:true,compactionPhase1Threshold:1,compactionPhase2Threshold:1,compactionCooldownMinutes:0});
   const game=new GameData(['99','Player','98','Speaker','1066.9.15','court','Guest room','Player','0']);
   for(const [id,name]of [[99,'Player'],[98,'Speaker']]){const data=Array(27).fill('');data[0]=String(id);data[1]=data[2]=name;const actor=new Character(data);actor.languageSnapshot={version:1,complete:true,nativeLanguageId:'language_common',knownLanguageIds:['language_common']};game.characters.set(id,actor);}
   const session=new LanguageConversation(game,loadLanguageEngine(root+'/public/languages').renderer),ledger=new ConversationLedger(game.playerID),compactor=new MemoryCompactor(config);
   const message={id:'native-scoped-memory-source',role:'assistant',characterId:98,name:'Speaker',proseEncoding:'controls-v1',content:'**She offers a cup.** ~~She intends to conceal the emerald tonight.~~ ""Take some water.""'};
   session.record(message);ledger.append(message,game.characters.values());
   const conv=Object.assign(Object.create(Conversation.prototype),{config,gameData:game,votcDataPath:${JSON.stringify(expectedRoot)},messages:[message],encounterLedger:ledger,currentSummary:'',memoryCompactor:compactor,campaignIdentity:buildIdentityFromParts({a:11,b:12,c:13,d:14},'99'),
    calculateBasePromptTokens:async()=>100,textGenApiConnection:{context:1000,calculateTokensFromMessage:()=>100},summarizationApiConnection:{isChat:()=>true,complete:async()=> 'The speaker offered water.'},getMessagesForRecipient:(id,messages)=>session.messagesForRecipient(messages,id),getCurrentSummaryForRecipient:()=>''});
   await compactor.compact(conv);const sourceScope=conv.getCompactedMemoryScope(),pendingOwn=createCompactedMemoryString(conv,{},game.characters.get(98)).includes('emerald');
   const newer={...compactor.getCompactedMemories('98')[0],id:'native-later-scoped-memory',scope:{version:1,campaignId:'11-12-13-14',encounterId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}};
   await compactedMemoryStore.updateCompactedMemoryBatch('99',new Map([['98',records=>[...records,newer]]]));
   await compactor.finalizeEncounterScope('99',sourceScope,{checkpointEpoch:1,timelineNodeId:'2-2'});
   const restored=new MemoryCompactor(config);await restored.loadFromDisk('99',game.date);conv.memoryCompactor=restored;conv.encounterLedger=new ConversationLedger(game.playerID);game.votcCheckpointEpoch=1;
   const registry=new TimelineRegistry('99',{version:1,playerId:'99',nodes:{'1-1':{parentId:null,epoch:0,source:'root',eventKey:'root',createdAt:'2026-10-13'},'2-2':{parentId:'1-1',epoch:1,source:'conversation',eventKey:'left',createdAt:'2026-10-13'},'3-3':{parentId:'1-1',epoch:1,source:'conversation',eventKey:'right',createdAt:'2026-10-13'}}});
   conv.timelineReadContext={registry,currentNodeId:'3-3'};const siblingHidden=!createCompactedMemoryString(conv,{},game.characters.get(98)).includes('emerald');
   conv.timelineReadContext.currentNodeId='2-2';const originalBranchHasPrivate=createCompactedMemoryString(conv,{},game.characters.get(98)).includes('emerald');
   conv.campaignIdentity=buildIdentityFromParts({a:21,b:22,c:23,d:24},'99');const differentCampaignHidden=createCompactedMemoryString(conv,{},game.characters.get(98))==='';conv.campaignIdentity=buildIdentityFromParts({a:11,b:12,c:13,d:14},'99');
   let release;const pending=new Promise(resolve=>{release=resolve;});let contextAtBackgroundEnd=false;
   conv.closingWorkCount=0;conv.compactorReleaseRequested=false;conv.cancelGeneration=()=>{};conv.cancelBackgroundPreparation=()=>{};conv.runFileManager={writeAfterPending:async()=>true,clear:()=>{}};conv._saveHistoryToFile=()=>{};
   conv._generateSummariesAndDiariesInBackground=async()=>{await pending;contextAtBackgroundEnd=createCompactedMemoryString(conv,{},game.characters.get(98)).includes('emerald');};
   const closing=conv.saveHistoryAndTriggerSummarization();conv.cleanup();await closing;const retainedUntilBackgroundDone=restored.getAllCompactedMemories().length>0;
   release();await pending;await Promise.resolve();await Promise.resolve();await Promise.resolve();
   return {pendingOwn,siblingHidden,originalBranchHasPrivate,differentCampaignHidden,newerEncounterPreserved:restored.getAllCompactedMemories().length===0&&compactor.getCompactedMemories('98').some(memory=>memory.id===newer.id),retainedUntilBackgroundDone,contextAtBackgroundEnd,cleanupAfterBackground:restored.getAllCompactedMemories().length===0,modelRequests:0};
  })()`);
  for(const [key,value]of Object.entries(report.controlledMemoryScope))if(key!=='modelRequests')assert.equal(value,true,key);
  assert.equal(report.controlledMemoryScope.modelRequests,0);
  console.log('Native runtime check: campaign/branch memory, late close preservation and deferred cleanup');
  report.backgroundReadiness=await m.eval(`(async()=>{
   const e=process.mainModule.require('electron'),root=e.app.getAppPath(),load=p=>process.mainModule.require(root+'/'+p);
   const {ProviderLane}=load('dist/shared/providerActivity.js');const lane=new ProviderLane();const order=[];
   await Promise.all([lane.run('foreground',async()=>{order.push('intro')}),lane.run('foreground',async()=>{order.push('reply')})]);
   const {waitForProfiles}=load('dist/main/background/profileReadiness.js');
   const ready=await waitForProfiles(()=>['ready','ready'],new AbortController().signal);
   const {EncounterCapture}=load('dist/main/background/EncounterCapture.js');
   const {catalogFromFiles}=load('dist/main/culture/cultureCatalog.js');
   const catalog=catalogFromFiles(new Map([['common/culture/pillars/probe.txt','probe_ethos = { type = ethos }'],['common/culture/traditions/probe.txt','probe_tradition = { parameters = { patient_trait_more_common = yes } }']]));
   const fs=process.mainModule.require('fs'),file=${JSON.stringify(file)};fs.writeFileSync(file,'');
   const capture=new EncounterCapture(()=>({culture:catalog}));const work=capture.capture(${JSON.stringify(expectedGame)},[{characterId:2,position:0}],new AbortController().signal);
   const bytes=fs.readFileSync(file,'utf8'),nonce=bytes.split('ack/;/')[1].slice(0,24);
   capture.observe('VOTC:ENCOUNTER/;/ack/;/'+nonce);const acknowledged=await work;
   const ownedCleared=fs.readFileSync(file,'utf8')==='';
   const w=e.BrowserWindow.getAllWindows().find(w=>w.getTitle().endsWith(' - Chat'));
   w.webContents.send('status-update','chat.status_preparing_background');await new Promise(r=>setTimeout(r,150));
   const status=await w.webContents.executeJavaScript("document.querySelector('.queue-status').innerText");w.webContents.send('status-update','');
   return {order,ready,acknowledged,ownedCleared,status,foregroundIdle:!lane.foregroundBusy}
  })()`);
  assert.deepEqual(report.backgroundReadiness.order,['intro','reply']);assert.equal(report.backgroundReadiness.ready,'ready');
  assert(report.backgroundReadiness.acknowledged&&report.backgroundReadiness.ownedCleared&&report.backgroundReadiness.foregroundIdle);
  assert(report.backgroundReadiness.status.includes('Preparing culture and faith context'));
  console.log('Native runtime check: serialized requests, readiness, capture ownership and preparation status');

  const libraryPath=JSON.stringify(p.url.replace(/^file:\/\//,'').replace(/public\/configWindow\/\w+.html$/,'')+'dist/main/windows/ChatWindow.js');
  await m.eval(`(()=>{const e=process.mainModule.require('electron');const w=e.BrowserWindow.getAllWindows().find(w=>w.getTitle().endsWith(' - Chat'));const Klass=process.mainModule.require(${libraryPath}).ChatWindow;global.titanChatFixture=Object.create(Klass.prototype);Object.assign(global.titanChatFixture,{window:w,overlayMode:'overlay',rendererLoaded:true,showPending:false,windowWatchId:0});global.titanChatFixture.show();return true})()`);
  await pause(500);
  report.overlayFocus=await m.eval(`(()=>{const e=process.mainModule.require('electron');return {events:global.titanTest.overlay,focused:e.BrowserWindow.getFocusedWindow()?.getTitle(),visible:global.titanChatFixture.window.isVisible()}})()`);
  assert.equal(report.overlayFocus.focused,'VOTC Titan Edition - Chat');assert(report.overlayFocus.events.includes('attach'));
  await m.eval(`(()=>{global.titanChatFixture.hide();return true})()`);await pause(400);
  report.returnFocus=await m.eval(`global.titanTarget.isFocused()`);assert.equal(report.returnFocus,true);
  report.activeWindowExcluded=await m.eval(`!Object.keys(process.mainModule.constructor._cache).some(p=>p.includes('@paymoapp/active-window'))`);assert.equal(report.activeWindowExcluded,true);
  const storage=JSON.parse(fs.readFileSync(storageReport));assert(storage.passed);report.storage=storage;report.passed=true;
  fs.writeFileSync(resultPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{
  try{await m.eval(`(()=>{const e=process.mainModule.require('electron');if(typeof global.titanSavedClipboard==='string')e.clipboard.writeText(global.titanSavedClipboard);return true})()`)}
  finally{r.close();m.close()}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
