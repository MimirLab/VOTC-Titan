// Actual X11 input/focus checks with a synthetic CK3 target and the production ChatWindow.
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),cp=require('child_process'),crypto=require('crypto');
const stage=path.resolve(process.argv[2]);const reportPath=path.resolve(process.argv[3]);
const probeData=process.env.VOTC_TITAN_PROBE_ROOT||'/tmp/votc-titan-overlay-probe-'+process.pid;
fs.mkdirSync(probeData,{recursive:true});app.setPath('userData',probeData);app.setPath('sessionData',probeData);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const regionModule=JSON.stringify(path.join(stage,'resources/app/dist/chatWindow/nativeInputRegion.js'));
const html=`<title>Titan synthetic input probe</title><body style="margin:0"><div class="chat-box" style="width:470px;height:100px;background:#18211b;color:white"><button id="leave" style="margin:20px;width:140px;height:40px">Leave probe</button><input id="input" style="width:240px;height:40px"></div><script>const ipc=require('electron').ipcRenderer;document.querySelector('#leave').onclick=()=>ipc.send('chat-stop');ipc.on('chat-hide',()=>document.body.style.display='none');ipc.on('chat-show',()=>document.body.style.display='block');require(${regionModule}).installNativeInputRegions();</script></body>`;
function command(args){const r=cp.spawnSync('xdotool',args,{encoding:'utf8',timeout:3000});assert.equal(r.status,0,r.stderr);}
let chat,target;
async function makeTarget(){const w=new BrowserWindow({title:'Crusader Kings III',width:900,height:700});await w.loadURL('data:text/html,<title>Crusader Kings III</title><body>Synthetic CK3 target<button id="game-control" style="position:absolute;left:700px;top:400px;width:180px;height:60px" onclick="this.dataset.clicks=Number(this.dataset.clicks||0)+1">Underlying game control</button></body>');w.setFullScreen(true);w.focus();await pause(650);return w;}
async function typeProbe(marker){
 target.focus();await pause(350);assert.equal(target.isFocused(),true,'Restoring mouse input must preserve game keyboard focus');
 const rect=await chat.window.webContents.executeJavaScript('(()=>{const r=document.querySelector("#input").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
 const wid=String(chat.window.getNativeWindowHandle().readUInt32LE());
 command(['mousemove','--sync','--window',wid,String(Math.round(rect.x)),String(Math.round(rect.y))]);
 await pause(150);command(['click','1']);
 await pause(300);assert.equal(chat.window.isFocused(),true,'Clicking an open chat must focus its window');
 // Let the desktop finish focusing before clicking the control itself.
 command(['mousemove','--sync','--window',wid,String(Math.round(rect.x)),String(Math.round(rect.y))]);
 await pause(150);command(['click','1']);await pause(150);
 const active=await chat.window.webContents.executeJavaScript('document.activeElement.id');
 assert.equal(active,'input','Actual mouse click must select the input');
 command(['type','--clearmodifiers',marker]);await pause(200);
 const value=await chat.window.webContents.executeJavaScript('document.querySelector("#input").value');assert.equal(value,marker,'Actual X11 click and keystrokes must reach chat');
}
app.whenReady().then(async()=>{
 process.chdir(stage+'/resources/app');
 const source=path.join(stage,'resources/app/dist/main/windows/ChatWindow.js');
 const {ChatWindow}=require(source);chat=new ChatWindow();chat.window.webContents.closeDevTools();
 await chat.window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
 target=await makeTarget();assert.equal(chat.overlayMode,'overlay');chat.show();await pause(350);
 await typeProbe('FIRST_NATIVE_INPUT');
 const targetId=String(target.getNativeWindowHandle().readUInt32LE());
 command(['mousemove','--sync','--window',targetId,'780','430']);await pause(150);command(['click','1']);await pause(300);
 assert.equal(await target.webContents.executeJavaScript('document.querySelector("#game-control").dataset.clicks'),'1','Transparent chat space must pass clicks to CK3');
 assert.equal(target.isFocused(),true);assert.equal(chat.isShown,true,'Click-through must keep the conversation open');
 await chat.window.webContents.executeJavaScript('document.querySelector(".chat-box").style.marginLeft="100px";document.querySelector("#input").value=""');await pause(250);
 await typeProbe('MOVED_NATIVE_INPUT');
 await chat.window.webContents.executeJavaScript('document.querySelector(".chat-box").style.marginLeft="0px"');await pause(250);
 const chatId=String(chat.window.getNativeWindowHandle().readUInt32LE());
 const taskbarState=cp.spawnSync('xprop',['-id',chatId,'_NET_WM_STATE'],{encoding:'utf8',timeout:3000});
 assert.equal(taskbarState.status,0);assert.match(taskbarState.stdout,/_NET_WM_STATE_SKIP_TASKBAR/,'Chat overlay must not create a lingering desktop task');
 const wid=String(chat.window.getNativeWindowHandle().readUInt32LE());command(['mousemove','--sync','--window',wid,'85','40','click','1']);await pause(400);
 assert.equal(chat.isShown,false);assert.equal(chat.window.isVisible(),false);assert.equal(target.isFocused(),true);
 let targetClosedNotices=0;chat.onTargetClosed=()=>{targetClosedNotices++;};
 chat.show();await pause(300);target.close();await pause(400);
 assert(targetClosedNotices>0,'A lost game target must notify the encounter owner');
 assert.equal(chat.isShown,false);assert.equal(chat.window.isVisible(),false);assert.equal(chat.overlayMode,'pending');
 target=await makeTarget();assert.equal(chat.overlayMode,'overlay');assert.equal(chat.window.isVisible(),false,'Game restart must not revive the old chat');
 chat.show();await pause(300);await chat.window.webContents.executeJavaScript('document.querySelector("#input").value=""');await typeProbe('RESTART_NATIVE_INPUT');
 chat.hide();await pause(300);assert.equal(target.isFocused(),true);
 const report={observedAt:new Date().toISOString(),platform:process.platform,electron:process.versions.electron,sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),realMouseAndKeyboard:true,gameKeyboardFocusPreserved:true,transparentAreaClicksReachGame:true,movedChatAcceptsInput:true,chatExcludedFromTaskbar:true,leaveClickHidesChat:true,gameExitHidesChat:true,targetClosureNotifiesOwner:targetClosedNotices>0,gameRestartDoesNotReviveChat:true,reopenedChatAcceptsInput:true,passed:true};
 fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}).catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 if(target&&!target.isDestroyed())target.close();
 await pause(500);
 if(chat&&!chat.window.isDestroyed())chat.window.removeAllListeners('close');
 app.exit(process.exitCode||0);
});
