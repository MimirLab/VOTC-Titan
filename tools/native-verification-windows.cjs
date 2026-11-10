// Prepare synthetic renderer windows, or gracefully stop this verification process.
const {CDP}=require('./titan-ui-smoke.cjs');
const [port,mode]=process.argv.slice(2);
(async()=>{
 const targets=await(await fetch(`http://127.0.0.1:${port}/json`)).json();
 const c=await CDP.connect(targets[0].webSocketDebuggerUrl);
 try{
  if(mode==='quit'){
   await c.eval(`(()=>{const e=process.mainModule.require('electron');if(global.titanTarget&&!global.titanTarget.isDestroyed())global.titanTarget.close();setTimeout(()=>e.app.quit(),600);return true})()`);
  }else{
   await c.eval(`(async()=>{const e=process.mainModule.require('electron');const path=process.mainModule.require('path');const root=e.app.getAppPath();new (process.mainModule.require(path.join(root,'dist/main/windows/ConversationHistoryWindow.js')).ConversationHistoryWindow)();new (process.mainModule.require(path.join(root,'dist/main/windows/SummaryManagerWindow.js')).SummaryManagerWindow)();const letter=new e.BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,preload:path.join(root,'dist/main/preload.js')}});await letter.loadFile(path.join(root,'public/letterWindow/letter.html'));for(const w of e.BrowserWindow.getAllWindows()){w.webContents.closeDevTools();w.webContents.setBackgroundThrottling(false);}return true})()`);
  }
 }finally{c.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
