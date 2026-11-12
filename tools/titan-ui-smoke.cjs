// Exercise actual native/Wine renderers through local, temporary debugging ports.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const [rendererPort, mainPort, resultDir] = process.argv.slice(2);
const liveConnections = new Set();
class CDP {
  constructor(ws) { liveConnections.add(this); this.ws = ws; this.id = 0; this.pending = new Map(); this.errors=[];
    ws.addEventListener('message', event => { const m=JSON.parse(event.data);
      if(m.method==='Runtime.exceptionThrown')this.errors.push(m.params.exceptionDetails.text + ': ' + (m.params.exceptionDetails.exception?.description||''));
      if(!m.id)return;const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);
    });
  }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});return new CDP(ws); }
  call(method,params={}) { const id=++this.id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Timeout: '+method))},12000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));}); }
  async eval(expression) { const r=await this.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value; }
  close(){liveConnections.delete(this);this.ws.close();}
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
if (require.main === module) (async()=>{
 fs.mkdirSync(resultDir,{recursive:true});
 const pages=await (await fetch(`http://127.0.0.1:${rendererPort}/json`)).json();
 const config=pages.find(p=>/configWindow\/\w+.html$/.test(p.url));assert(config);
 let m;
 if(mainPort && mainPort!=='-'){const targets=await(await fetch(`http://127.0.0.1:${mainPort}/json`)).json();m=await CDP.connect(targets[0].webSocketDebuggerUrl);await m.eval(`process.mainModule.require('electron').BrowserWindow.getAllWindows().forEach(w=>{w.webContents.setBackgroundThrottling(false);})`);}
 const c=await CDP.connect(config.webSocketDebuggerUrl);await c.call('Runtime.enable');
 const root=config.url.replace(/public\/configWindow\/\w+.html$/,''); const original=root+'public/configWindow/connection.html';
 await c.eval(`localStorage.setItem('selectedTheme','west');localStorage.setItem('titan-preservation-probe','keep')`);
 const report={pages:[],errors:[],root};
 for(const name of ['connection','actions','summarization','memories','prompts','letters','diaries','settings','audio','system']){
  await c.call('Page.navigate',{url:original.replace('connection.html',name+'.html')});await pause(650);
  const r=await c.eval(`(()=>{const roots=[document,...[...document.querySelectorAll('*')].map(x=>x.shadowRoot).filter(Boolean)];const inputs=roots.flatMap(r=>[...r.querySelectorAll('input,textarea,select')]);return {name:${JSON.stringify(name)},title:document.title,theme:localStorage.getItem('selectedTheme'),preserved:localStorage.getItem('titan-preservation-probe'),bodyTheme:document.body.className,background:getComputedStyle(document.documentElement).backgroundColor,image:getComputedStyle(document.documentElement).backgroundImage,brand:document.querySelector('.app-brand')?.textContent.trim(),brandIcon:document.querySelector('.app-brand img')?.naturalWidth,themeSelector:!!document.querySelector('#theme-selector'),inputs:inputs.length,controlSamples:inputs.slice(0,4).map(x=>({bg:getComputedStyle(x).backgroundColor,text:getComputedStyle(x).color})),socialLinks:document.querySelectorAll('.social-links-li').length}})()`);
  assert.equal(r.theme,'titan');assert.equal(r.preserved,'keep');assert.equal(r.brand,'VOTC Titan Edition');assert(r.brandIcon>0);assert.equal(r.themeSelector,false);assert.equal(r.socialLinks,0);assert.equal(r.image,'none');assert(r.inputs>0||name==='diaries');report.pages.push(r);
  if(name==='memories'){
   const banner=()=>c.eval(`(()=>{const n=document.getElementById('embedding-dimension-warning');return {visible:getComputedStyle(n).display!=='none',text:n.textContent}})()`);
   const setDimension=async(value,enabled=true)=>{
    await c.eval(`(()=>{const s=document.getElementById('api-selector').shadowRoot;const enabled=s.getElementById('embedding-dimension-enabled');enabled.checked=${enabled};enabled.dispatchEvent(new Event('change',{bubbles:true}));const input=s.getElementById('embedding-dimension-input');input.value=${JSON.stringify(String(value))};input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await pause(200);
   };
   assert.equal((await banner()).visible,false,'Empty store has no dimension warning');
   const originalConfig=await c.eval(`require('electron').ipcRenderer.invoke('get-embedding-config')`);
   const added=await c.eval(`require('electron').ipcRenderer.invoke('add-memory',{characterId:'synthetic-dimension-check',text:'Synthetic memory for dimension notice',vector:Array.from({length:1536},(_,i)=>i===0?1:0)})`);
   assert(added.success);
   const dimensions=await c.eval(`require('electron').ipcRenderer.invoke('get-memory-embedding-dimensions')`);
   assert.deepEqual(dimensions.storedDimensions,[1536]);
   await setDimension(1536);assert.equal((await banner()).visible,false,'Matching stored vectors have no red warning');
   await setDimension(1024);const mismatch=await banner();assert(mismatch.visible);assert(mismatch.text.includes('1536')&&mismatch.text.includes('1024'));
   await setDimension(1536);assert.equal((await banner()).visible,false,'Correcting the override clears the existing warning');
   await setDimension(1024,false);assert.equal((await banner()).visible,false,'Disabled override uses the effective 1536 default');
   await setDimension(1024);assert.equal((await banner()).visible,true);
   await c.eval(`(async()=>{await require('electron').ipcRenderer.invoke('delete-memory',${JSON.stringify(added.id)});document.dispatchEvent(new Event('embedding-config-changed'));})()`);await pause(200);
   assert.equal((await banner()).visible,false,'Warning clears when no vectors remain');
   await c.eval(`require('electron').ipcRenderer.invoke('save-embedding-config',${JSON.stringify(originalConfig)})`);
   await c.eval(`document.dispatchEvent(new Event('embedding-config-changed'))`);await pause(200);
   // Deliver an older mismatch after a newer matching response to exercise refresh races.
   await c.eval(`(async()=>{const ipc=require('electron').ipcRenderer;const original=ipc.invoke;let calls=0;ipc.invoke=function(channel,...args){if(channel!=='get-memory-embedding-dimensions')return original.call(this,channel,...args);const old=++calls===1;return new Promise(resolve=>setTimeout(()=>resolve({success:true,storedDimensions:[1024],configuredDimension:old?1042:1024}),old?150:0));};try{document.dispatchEvent(new Event('embedding-config-changed'));document.dispatchEvent(new Event('embedding-config-changed'));await new Promise(r=>setTimeout(r,250));}finally{ipc.invoke=original;}})()`);
   assert.equal((await banner()).visible,false,'Late outdated mismatch cannot restore the warning');
   report.embeddingDimensionWarning={emptyStoreHidden:true,matchingHidden:true,mismatchVisible:true,clearsAfterCorrection:true,disabledOverrideUsesDefault:true,clearsAfterDeletion:true,outdatedResponseIgnored:true,syntheticOnly:true};
  }
  if(name==='audio')report.narratorDefault=await require('./narrator-default-ui-smoke.cjs').probeNarratorDefault(c);
  if(name==='system' && m && await c.eval(`!!document.querySelector('config-checkbox[confid="languageRoutingEnabled"]')`))report.roleplayLanguages=await require('./language-ui-smoke.cjs').probeLanguages(c,m);
  if(name==='system' && m && await c.eval(`!!document.querySelector('#clear-culture-library')`))report.backgroundPurge=await require('./background-purge-ui-smoke.cjs').probeBackgroundPurge(c,m);
  if(['connection','memories','system'].includes(name)){const shot=await c.call('Page.captureScreenshot');fs.writeFileSync(path.join(resultDir,name+'.png'),Buffer.from(shot.data,'base64'));}
 }
 report.errors.push(...c.errors);c.close();
 for(const view of ['readmeWindow/readme','historyWindow/conversationHistory','summaryManagerWindow/summaryManager','letterWindow/letter']){
  const target=pages.find(p=>/\/(readmeWindow|historyWindow|summaryManagerWindow|letterWindow)\//.test(p.url));assert(target);const w=await CDP.connect(target.webSocketDebuggerUrl);await w.call('Runtime.enable');await w.call('Page.navigate',{url:root+'public/'+view+'.html'});await pause(650);
  if(m)await m.eval(`process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith(${JSON.stringify(view+'.html')}))?.show()`);
  if(view.startsWith('readme')){await w.eval(`document.querySelector('[data-tab="about"]').click()`);await pause(400);assert(await w.eval(`document.querySelector('#about').classList.contains('active')`),'About tab must respond');}
  const r=await w.eval(`({name:${JSON.stringify(view)},theme:localStorage.getItem('selectedTheme'),bodyTheme:document.body.className,background:getComputedStyle(document.body).backgroundColor,image:getComputedStyle(document.body).backgroundImage,banner:document.querySelector('.logo')?{width:document.querySelector('.logo').clientWidth,height:document.querySelector('.logo').clientHeight,natural:document.querySelector('.logo').naturalWidth}:null})`);
  assert.equal(r.theme,'titan');assert.equal(r.image,'none');if(r.banner)assert(Math.abs(r.banner.width/r.banner.height-3)<.05);report.pages.push(r);const shot=await w.call('Page.captureScreenshot');fs.writeFileSync(path.join(resultDir,view.split('/')[1]+'.png'),Buffer.from(shot.data,'base64'));report.errors.push(...w.errors);w.close();
 }
 const chat=pages.find(p=>p.url.endsWith('chatWindow/chat.html'));assert(chat);const ch=await CDP.connect(chat.webSocketDebuggerUrl);await ch.call('Runtime.enable');
 await ch.eval(`document.body.style.display='';document.querySelector('.chat-input').disabled=false`);
 report.chat=await ch.eval(`(()=>{const box=document.querySelector('.chat-box');return {theme:localStorage.getItem('selectedTheme'),outer:getComputedStyle(document.documentElement).backgroundColor,body:getComputedStyle(document.body).backgroundColor,panel:getComputedStyle(box).backgroundColor,resize:getComputedStyle(box).resize,image:getComputedStyle(box).backgroundImage,buttons:[...document.querySelectorAll('.button-container button')].map(b=>({id:b.id,width:b.offsetWidth,height:b.offsetHeight,text:b.textContent.trim()}))}})()`);
 assert.equal(report.chat.outer,'rgba(0, 0, 0, 0)');assert.equal(report.chat.body,'rgba(0, 0, 0, 0)');assert.equal(report.chat.resize,'both');assert.equal(report.chat.image,'none');assert(report.chat.buttons.some(b=>b.width>0&&b.height>0),'Chat controls must be visible');
 await ch.eval(`document.querySelector('.messages').innerHTML='<div class="message"><strong>Character</strong><p>A synthetic dialogue sample for checking readable Titan styling.</p></div>';document.querySelector('.chat-input').value='A synthetic test message.'`);
 if(m)await m.eval(`process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('chatWindow/chat.html')).show()`);
 if(m)report.sceneMenu=await require('./scene-menu-smoke.cjs').probeSceneMenu(ch,m);
 if(m)report.sceneRefresh=await require('./scene-menu-smoke.cjs').probeSceneRefresh(m);
 const shot=await ch.call('Page.captureScreenshot');fs.writeFileSync(path.join(resultDir,'chat.png'),Buffer.from(shot.data,'base64'));report.errors.push(...ch.errors);ch.close();
 if(mainPort && mainPort!=='-'){

  report.runtime=await m.eval(`(()=>{const e=process.mainModule.require('electron');return {platform:process.platform,electron:process.versions.electron,abi:process.versions.modules,userData:e.app.getPath('userData'),windows:e.BrowserWindow.getAllWindows().map(w=>({id:w.id,title:w.getTitle(),visible:w.isVisible()}))}})()`);
  m.close();
 }
 assert.deepEqual(report.errors,[],'Renderer exceptions');report.passed=true;fs.writeFileSync(path.join(resultDir,'ui-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,pages:report.pages.length,chat:report.chat,runtime:report.runtime}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{
 for(const c of [...liveConnections])c.close();
 // This CLI has awaited every check and written its final report. Newer Node
 // WebSocket close handshakes can retain inspector sockets after completion.
 // Finish with the actual assertion exit status, after flushing diagnostics.
 process.stdout.write('',()=>process.exit(process.exitCode||0));
});
module.exports={CDP};
