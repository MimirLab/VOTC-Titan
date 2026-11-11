import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { downloadArtifact, verifyArtifact } from '../../src/main/audio/ManagedBreeze';
test('resumed downloads require the exact range and checksum, then become an atomic verified artifact', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-download-')); const file = path.join(root, 'model');
    const bytes = Buffer.from('known pinned artifact'); const hash = createHash('sha256').update(bytes).digest('hex');
    const original = global.fetch;
    try {
        fs.writeFileSync(file + '.partial', bytes.subarray(0, 6));
        global.fetch = jest.fn().mockResolvedValue(new Response(bytes.subarray(6), { status: 206, headers: { 'content-range': `bytes 6-${bytes.length - 1}/${bytes.length}` } }));
        await downloadArtifact(file, 'https://example.test/model', hash, bytes.length, new AbortController().signal, () => {});
        expect((global.fetch as jest.Mock).mock.calls[0][1].headers.Range).toBe('bytes=6-');
        expect(await verifyArtifact(file, hash, bytes.length)).toBe(true); expect(fs.existsSync(file + '.partial')).toBe(false);
        await downloadArtifact(file, 'https://example.test/model', hash, bytes.length, new AbortController().signal, () => {});
        expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally { global.fetch = original; fs.rmSync(root, { recursive: true, force: true }); }
});
test('wrong hashes and wrong resume offsets cannot install a model', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-download-')); const file = path.join(root, 'model'); const original = global.fetch;
    try {
        global.fetch = jest.fn().mockResolvedValue(new Response(Buffer.from('bad')));
        await expect(downloadArtifact(file, 'https://example.test/model', '0'.repeat(64), 3, new AbortController().signal, () => {})).rejects.toThrow('checksum');
        expect(fs.existsSync(file)).toBe(false); expect(fs.existsSync(file + '.partial')).toBe(false);
        fs.writeFileSync(file + '.partial', 'x');
        global.fetch = jest.fn().mockResolvedValue(new Response(Buffer.from('yy'), { status: 206, headers: { 'content-range': 'bytes 0-1/3' } }));
        await expect(downloadArtifact(file, 'https://example.test/model', '0'.repeat(64), 3, new AbortController().signal, () => {})).rejects.toThrow('range');
        expect(fs.existsSync(file)).toBe(false);
    } finally { global.fetch = original; fs.rmSync(root, { recursive: true, force: true }); }
});

test('cancel at the last byte remains locally resumable without a Range request past EOF', async () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'titan-download-eof-')),file=path.join(root,'model');
    const bytes=Buffer.from('pinned complete artifact'),hash=createHash('sha256').update(bytes).digest('hex'),original=global.fetch;
    try {
        const controller=new AbortController(); global.fetch=jest.fn().mockResolvedValue(new Response(bytes));
        await expect(downloadArtifact(file,'https://fixture.invalid/model',hash,bytes.length,controller.signal,(done,total)=>{if(done===total)controller.abort();})).rejects.toThrow();
        expect(fs.readFileSync(file+'.partial')).toEqual(bytes);
        (global.fetch as jest.Mock).mockClear().mockResolvedValue(new Response(null,{status:416}));
        await downloadArtifact(file,'https://fixture.invalid/model',hash,bytes.length,new AbortController().signal,()=>{});
        await downloadArtifact(file,'https://fixture.invalid/model',hash,bytes.length,new AbortController().signal,()=>{});
        expect(global.fetch).not.toHaveBeenCalled();expect(await verifyArtifact(file,hash,bytes.length)).toBe(true);
    } finally {global.fetch=original;fs.rmSync(root,{recursive:true,force:true});}
});
test('a corrupt complete partial restarts without an invalid range',async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'titan-download-corrupt-')),file=path.join(root,'model'),original=global.fetch;
    const bytes=Buffer.from('correct'),hash=createHash('sha256').update(bytes).digest('hex');
    try {
        fs.writeFileSync(file+'.partial','corrupt');global.fetch=jest.fn().mockResolvedValue(new Response(bytes));
        await downloadArtifact(file,'https://fixture.invalid/model',hash,bytes.length,new AbortController().signal,()=>{});
        expect((global.fetch as jest.Mock).mock.calls[0][1].headers).toEqual({});expect(fs.readFileSync(file)).toEqual(bytes);
    } finally {global.fetch=original;fs.rmSync(root,{recursive:true,force:true});}
});

test('Vulkan resume budgets remaining bytes plus the extraction margin before any network work',async()=>{
    const {ManagedBreeze}=require('../../src/main/audio/ManagedBreeze'),{BREEZE_MODELS,BREEZE_RUNTIME}=require('../../src/main/audio/modelCatalog');
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'titan-resume-space-')),original=global.fetch;
    try{
        const spec=BREEZE_MODELS['hoppou-q8'],remaining=8*1024**2,partial=path.join(root,spec.file+'.partial');
        fs.writeFileSync(partial,'');fs.truncateSync(partial,spec.bytes-remaining);
        const available=remaining+BREEZE_RUNTIME.bytes+500_000_001;
        jest.spyOn(fs,'statfsSync').mockReturnValue({bavail:available,bsize:1}as any);
        global.fetch=jest.fn().mockRejectedValue(new Error('Synthetic transport reached'));
        const manager=new ManagedBreeze(root,()=>{});
        await expect(manager.install('hoppou-q8')).rejects.toThrow('Synthetic transport reached');
        expect(global.fetch).toHaveBeenCalledTimes(1);expect(fs.statSync(partial).size).toBe(spec.bytes-remaining);
    }finally{jest.restoreAllMocks();global.fetch=original;fs.rmSync(root,{recursive:true,force:true});}
});
