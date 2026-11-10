import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { pcmToWav } from '../../src/main/audio/pcm';
export function cloneFixture(root: string, id = 'test-speaker') {
    const folder = path.join(root, id, 'v0001'); fs.mkdirSync(folder, { recursive: true });
    const pcm = Buffer.alloc(48000); for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 12) * 5000), i * 2);
    const wav = pcmToWav(pcm), text = 'The road is quiet.\r\nI will wait here.\r\n';
    const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
    const manifest = { schema_version: 1, id, revision: 1, name: 'Synthetic reference', role: 'character', language: 'en', seed: 17,
        source: { kind: 'synthetic', description: 'Disposable signal fixture; not a character recording.' },
        delivery: { identity: 'reference', automatic_casting: false, tone: true, whisper: true },
        reference: { audio: 'reference.wav', transcript: 'transcript.txt', audio_sha256: hash(wav), transcript_sha256: hash(text),
            audio_info: { sample_rate: 24000, channels: 1, sample_bits: 16, frames: 24000, seconds: 1, peak: .152588, rms_dbfs: -19.34, clipped_samples: 0 } },
        quality: { state: 'prepared', review: null } };
    fs.writeFileSync(path.join(folder, 'voice.json'), JSON.stringify(manifest)); fs.writeFileSync(path.join(folder, 'reference.wav'), wav); fs.writeFileSync(path.join(folder, 'transcript.txt'), text);
    return { folder, manifest, wav, text, file: path.join(folder, 'voice.json'), write: () => fs.writeFileSync(path.join(folder, 'voice.json'), JSON.stringify(manifest)) };
}
