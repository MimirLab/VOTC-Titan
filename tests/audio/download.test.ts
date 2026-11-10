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
