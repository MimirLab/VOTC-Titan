// Actual Electron canvas/IPC, with a declared two-person stock-CE response fixture.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {CDP}=require('./titan-ui-smoke.cjs');
const [rendererPort,mainPort,output]=process.argv.slice(2);
(async()=>{
 fs.mkdirSync(output,{recursive:true});
 const targets=await(await fetch('http://127.0.0.1:'+mainPort+'/json')).json();
 const main=await CDP.connect(targets[0].webSocketDebuggerUrl);
 let renderer;
 try{
  const fixture=fs.readFileSync(path.resolve('tests/scenes/fixtures/stock-ce-scene-response.log'),'utf8');
  const setup=await main.eval(`(async()=>{
   const e=process.mainModule.require('electron'),p=process.mainModule.require('path'),root=e.app.getAppPath();
   const load=r=>process.mainModule.require(p.join(root,r));
   const reader=new(load('dist/main/scenes/launcherSceneCapture.js').LauncherSceneReader)();
   for(const line of ${JSON.stringify(fixture)}.split('\\n'))reader.observe(line);
   const snapshot=reader.consume('a91d565614462b7238eb57e6',31575,[40001,31575],'338796323:362203402:532409363:273258104');
   if(!snapshot)throw Error('Native fixture rejected');
   snapshot.selected=load('dist/main/scenes/launcherSceneCapture.js').preferredSceneForCe(snapshot,'throne_room');
   e.ipcMain.handle('titan-verify-scene-art',(_event,id)=>load('dist/main/scenes/launcherSceneArt.js').readLauncherSceneArt(snapshot,id));
   const window=e.BrowserWindow.getAllWindows().find(w=>w.getTitle().endsWith(' - Chat'));
   if(!window)throw Error('Registered production chat window is missing');
   global.titanSceneArtWindow=window;
   await window.webContents.executeJavaScript("document.title='Titan Scene Verification'");
   window.webContents.setBackgroundThrottling(false);if(global.titanChatFixture)global.titanChatFixture.show();else {window.webContents.send('chat-show');window.show();}
   return {snapshot,root};
  })()`);
  await new Promise(resolve=>setTimeout(resolve,150));
  const pages=await(await fetch('http://127.0.0.1:'+rendererPort+'/json')).json();
  const target=pages.find(p=>p.title==='Titan Scene Verification');assert(target);
  renderer=await CDP.connect(target.webSocketDebuggerUrl);await renderer.call('Runtime.enable');
  const report={fixtureIPC:true,productionArtReader:true,productionRenderer:true,viewportEmulation:true,modelRequests:0,sizes:[]};
  for(const width of [900,500]){
   await renderer.call('Emulation.setDeviceMetricsOverride',{width,height:720,deviceScaleFactor:1,mobile:false});
   const result=await renderer.eval(`(async()=>{
    const ipc=require('electron').ipcRenderer,original=ipc.invoke.bind(ipc);
    ipc.invoke=(name,...args)=>original(name==='get-launcher-scene-art'?'titan-verify-scene-art':name,...args);
    try{await require(${JSON.stringify(path.join(setup.root,'dist/chatWindow/launcherSceneArt.js'))}).updateLauncherSceneArt({sceneSnapshot:${JSON.stringify(setup.snapshot)}})}
    finally{ipc.invoke=original}
    const panel=document.querySelector('.launcher-scene-art'),canvas=panel.querySelector('canvas'),rect=canvas.getBoundingClientRect();
    const bytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let colored=0;for(let i=0;i<bytes.length;i+=97)colored+=bytes[i];
    return {visible:!panel.hidden,label:panel.querySelector('summary').textContent,width:canvas.width,height:canvas.height,displayWidth:rect.width,displayHeight:rect.height,colored,bodyWidth:document.body.scrollWidth,viewport:innerWidth};
   })()`);
   assert(result.visible);assert.equal(result.width,1592);assert.equal(result.height,848);assert(result.colored>0);assert(result.displayWidth<=result.viewport);assert(result.displayHeight>0);
   report.sizes.push({requestedViewportWidth:width,...result});
   const file=path.resolve(output,'scene-'+width+'.png');
   const captured=await renderer.call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
   fs.writeFileSync(file,Buffer.from(captured.data,'base64'));
   assert(fs.statSync(file).size>1000);
  }
  const rejection=await renderer.eval(`(async()=>{const ipc=require('electron').ipcRenderer;return (await ipc.invoke('titan-verify-scene-art','../private.json'))===undefined})()`);
  assert(rejection);report.arbitraryPathRejected=true;report.rendererExceptions=renderer.errors;assert.equal(renderer.errors.length,0);
  report.passed=true;fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{
  if(renderer)await renderer.call('Emulation.clearDeviceMetricsOverride').catch(()=>{});
  renderer?.close();
  await main.eval(`(()=>{process.mainModule.require('electron').ipcMain.removeHandler('titan-verify-scene-art');if(global.titanSceneArtWindow&&!global.titanSceneArtWindow.isDestroyed()){global.titanSceneArtWindow.webContents.send('chat-hide');global.titanSceneArtWindow.hide();}return true})()`).catch(()=>{});
  main.close();
 }
})().catch(error=>{console.error(error.stack);process.exitCode=1});
