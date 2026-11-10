import fs from 'fs';
import os from 'os';
import path from 'path';
import { EncounterCapture } from '../../src/main/background/EncounterCapture';

test('the existing per-reply lightweight probe carries lore even when other domains are disabled', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-lore-refresh-'));
    const file = path.join(directory, 'run/votc.txt');
    const policy: any = { version: 1, digest: 'd'.repeat(64), memory_owner_policies: ['ordinary'],
        points: [{ token: 'tlm_' + 'a'.repeat(24) }] };
    let probes = 0;
    const capture = new EncounterCapture(() => ({ loreMutation: policy }), () => {
        probes++;
        const script = fs.readFileSync(file, 'utf8');
        expect(script).toContain('VOTC:LORE_MUTATION/;/begin');
        expect(script).toContain('every_memory');
        const nonce = script.match(/VOTC:ENCOUNTER\/;\/ack\/;\/([a-f0-9]{24})/)![1];
        capture.observe('VOTC:ENCOUNTER/;/ack/;/' + nonce);
    });
    try {
        await expect(capture.capture(directory, [{ characterId: 2, position: 0 }], new AbortController().signal,
            'votc.txt', 6000, { languagesOnly: true })).resolves.toBe(true);
        expect(probes).toBe(1);
        expect(fs.readFileSync(file, 'utf8')).toBe('');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
