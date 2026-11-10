// Separate Electron process for an X11 clipboard round trip. Never print existing clipboard contents.
const {app, clipboard}=require('electron');
const fs=require('fs');
const path=require('path'),os=require('os');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'votc-titan-clipboard-peer-'));
app.setPath('userData',data);
app.setPath('sessionData',data);
app.on('quit',()=>fs.rmSync(data,{recursive:true,force:true}));
app.whenReady().then(()=>{
 const initial=clipboard.readText()==='TITAN_NATIVE_CLIPBOARD_PROBE';
 clipboard.writeText('VOTC:SUMMARY_MANAGER');
 setTimeout(()=>{
  const restored=clipboard.readText()==='TITAN_NATIVE_CLIPBOARD_PROBE';
  fs.writeFileSync(process.argv[2],JSON.stringify({mainToPeer:initial,peerCommandRestored:restored})+'\n');
  app.quit();
 },700);
});
