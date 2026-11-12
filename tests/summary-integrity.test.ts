import fs from 'fs';
import os from 'os';
import path from 'path';
import { SummaryEdits, SummaryKind } from '../src/main/summaryEdits';
let root: string, edits: SummaryEdits;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'titan-summary-edits-')); edits=new SummaryEdits(root);});
afterEach(()=>{jest.restoreAllMocks(); fs.rmSync(root,{recursive:true,force:true});});
const folders={conversations:'conversation_summaries',letters:'letter_summaries',diaries:'diary_summaries'};
function write(kind:SummaryKind,id:string,rows:any[]){const file=path.join(root,folders[kind],'1',id+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(rows));return file;}
test.each<SummaryKind>(['conversations','letters','diaries'])('%s stale editor cannot overwrite later records or delete another character',async kind=>{
 const file=write(kind,'2',[{content:'old',date:'583.1.1'}]); const original=JSON.parse(fs.readFileSync(file,'utf8')).map((v:any)=>({...v,characterId:'2'}));
 const view=await edits.read('1',kind,async()=>original);
 write(kind,'2',[{content:'NEW',date:'583.1.2'},...original]);const other=write(kind,'3',[{content:'OTHER'}]);const bytes=fs.readFileSync(file);
 expect(()=>edits.save('1',kind,[{...original[0],content:'edit'}],view.revision)).toThrow(/changed/);
 expect(fs.readFileSync(file)).toEqual(bytes);expect(fs.existsSync(other)).toBe(true);
});
test('a fresh edit changes only visible records, preserves hidden branch records, and supports subsequent edits',async()=>{
 const file=write('conversations','2',[{content:'visible'},{content:'hidden',votcTimelineNodeId:'9-9'}]);
 const snapshot=await edits.read('1','conversations',async()=>[{content:'visible',characterId:'2',characterName:'Actor'}]);
 edits.save('1','conversations',[{...snapshot.data[0],content:'edited'}],snapshot.revision);
 expect(JSON.parse(fs.readFileSync(file,'utf8')).map((r:any)=>r.content)).toEqual(['edited','hidden']);
 edits.save('1','conversations',[],snapshot.revision);
 expect(JSON.parse(fs.readFileSync(file,'utf8')).map((r:any)=>r.content)).toEqual(['hidden']);
});
test('an editor receipt belongs to exactly one player and store',async()=>{
 const snapshot=await edits.read('1','letters',async()=>[]);
 expect(()=>edits.save('2','letters',[],snapshot.revision)).toThrow();expect(()=>edits.save('1','diaries',[],snapshot.revision)).toThrow();
});
test('a concurrent write during asynchronous loading cannot issue a valid editing receipt',async()=>{
 await expect(edits.read('1','diaries',async()=>{write('diaries','2',[{content:'later'}]);return[];})).rejects.toThrow(/changed/);
});
test('failed writes propagate to the IPC result and leave the prior file readable',async()=>{
 const file=write('letters','2',[{content:'old'}]), view=await edits.read('1','letters',async()=>[{characterId:'2',content:'old'}]);
 jest.spyOn(fs,'renameSync').mockImplementation(()=>{throw Error('fixture permission denied');});
 expect(()=>edits.save('1','letters',[{characterId:'2',content:'edit'}],view.revision)).toThrow('fixture permission denied');
 expect(JSON.parse(fs.readFileSync(file,'utf8'))).toEqual([{content:'old'}]);
});
