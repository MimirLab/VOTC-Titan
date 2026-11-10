import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { TextDecoder } from 'util';
import { AudioSegment, VoiceProfile } from '../../shared/audio';
import { DemonFamily, WHISPER_DIRECTION } from './demonVoices';
import { boundedDirection } from './audioDirections';
import { CloneAgeBand, cloneAgeInstruction } from './cloneAge';
import { UndeadPerformance, undeadDirection } from './undeadVoice';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const policy = { identity: 'reference', automatic_casting: false, tone: true, whisper: true };
const idPattern = /^(?=.{1,80}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const fail = (): never => { throw new Error('Invalid or changed clone bank. Import an intact prepared character voice package.'); };
export interface CloneBank { key: string; id: string; revision: number; name: string; seed: number;
    manifestHash: string; audioHash: string; transcriptHash: string; text: string; wav: Buffer }
export interface CloneIdentity { origin: 'clone-bank-v1'; key: string; manifestHash: string; audioHash: string; transcriptHash: string }
/** File reads reject links, special files and oversized references before allocation. */
function read(file: string, limit: number): Buffer {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.size > limit) fail();
        const data = fs.readFileSync(fd); if (data.length > limit) fail(); return data;
    } finally { fs.closeSync(fd); }
}
function directory(folder: string): void { const stat = fs.lstatSync(folder); if (!stat.isDirectory() || stat.isSymbolicLink()) fail(); }
function decoded(bytes: Buffer): string { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
function literal(text: string): void { if (!text.trim() || /<ins_(?:bos|eos)>|\[S\d+\]|\x00/i.test(text)) fail(); }
export function readCloneBank(folder: string): CloneBank {
    directory(folder);
    const raw = read(path.join(folder, 'voice.json'), 65536), m = JSON.parse(decoded(raw));
    if (m.schema_version !== 1 || typeof m.id !== 'string' || !idPattern.test(m.id) || !Number.isInteger(m.revision) || m.revision < 1 || m.revision > 9999 ||
        typeof m.name !== 'string' || !m.name.trim() || m.name.length > 120 || m.role !== 'character' ||
        !Number.isInteger(m.seed) || m.seed < 1 || m.seed > 2147483646 ||
        Object.keys(m.delivery ?? {}).length !== 4 || Object.entries(policy).some(([key, value]) => m.delivery?.[key] !== value) ||
        !['prepared', 'reviewed'].includes(m.quality?.state) || m.reference?.audio !== 'reference.wav' || m.reference?.transcript !== 'transcript.txt') fail();
    const wav = read(path.join(folder, 'reference.wav'), 2 * 1024 * 1024), transcript = read(path.join(folder, 'transcript.txt'), 16384);
    const audioHash = hash(wav), transcriptHash = hash(transcript), text = decoded(transcript);
    if (audioHash !== m.reference.audio_sha256 || transcriptHash !== m.reference.transcript_sha256 || text.length > 4000) fail();
    literal(text);
    // Parse PCM chunks rather than assuming a 44-byte header. Reject truncated/ambiguous WAVs.
    if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE' || wav.readUInt32LE(4) + 8 !== wav.length) fail();
    let fmt = false, samples: Buffer | undefined;
    for (let pos = 12; pos < wav.length;) {
        if (pos + 8 > wav.length) fail();
        const tag = wav.toString('ascii', pos, pos + 4), length = wav.readUInt32LE(pos + 4), start = pos + 8;
        if (start + length > wav.length) fail();
        if (tag === 'fmt ') {
            if (fmt || length < 16 || wav.readUInt16LE(start) !== 1 || wav.readUInt16LE(start + 2) !== 1 ||
                wav.readUInt32LE(start + 4) !== 24000 || wav.readUInt32LE(start + 8) !== 48000 ||
                wav.readUInt16LE(start + 12) !== 2 || wav.readUInt16LE(start + 14) !== 16) fail();
            fmt = true;
        }
        if (tag === 'data') { if (samples) fail(); samples = wav.subarray(start, start + length); }
        pos = start + length + (length % 2); if (pos > wav.length) fail();
    }
    if (!fmt || !samples || samples.length % 2 || samples.length < 48000 || samples.length > 1440000) return fail();
    let peak = 0; for (let i = 0; i < samples.length; i += 2) peak = Math.max(peak, Math.abs(samples.readInt16LE(i)));
    const info = m.reference.audio_info;
    if (!peak || info?.sample_rate !== 24000 || info.channels !== 1 || info.sample_bits !== 16 || info.frames !== samples.length / 2) fail();
    if (m.quality.state === 'reviewed' && (m.quality.review?.audio_sha256 !== audioHash || m.quality.review?.transcript_sha256 !== transcriptHash)) fail();
    return { key: `${m.id}/v${String(m.revision).padStart(4, '0')}`, id: m.id, revision: m.revision,
        name: m.name, seed: m.seed, manifestHash: hash(raw), audioHash, transcriptHash, text, wav };
}
/** Imported copies are immutable and independent of the author's repository/drive. */
export class CloneBanks {
    constructor(readonly root: string, private bundledRoot?: string) {}
    load(key: string): CloneBank {
        if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}\/v[0-9]{4}$/.test(key)) return fail();
        if (!fs.existsSync(path.join(this.root, key)) && this.bundledRoot) return new CloneBanks(this.bundledRoot).load(key);
        directory(this.root); directory(path.join(this.root, key.split('/')[0]));
        const bank = readCloneBank(path.join(this.root, key)); if (bank.key !== key) fail(); return bank;
    }
    list(): { key: string; name: string; revision: number }[] {
        const bundled = this.bundledRoot ? new CloneBanks(this.bundledRoot).list() : [];
        if (!fs.existsSync(this.root)) return bundled;
        directory(this.root); const found: { key: string; name: string; revision: number }[] = [];
        for (const id of fs.readdirSync(this.root).sort().filter(id => idPattern.test(id))) {
            try { directory(path.join(this.root, id)); } catch { continue; }
            for (const revision of fs.readdirSync(path.join(this.root, id)).sort().filter(v => /^v[0-9]{4}$/.test(v))) {
                try { const b = this.load(`${id}/${revision}`); found.push({ key: b.key, name: b.name, revision: b.revision }); }
                catch { /* Invalid entries are never offered; an existing binding still fails explicitly. */ }
            }
        } return [...found, ...bundled.filter(b => !found.some(p => p.key === b.key))];
    }
    import(manifest: string): CloneBank {
        if (path.basename(manifest) !== 'voice.json') return fail();
        const folder = path.dirname(manifest), bank = readCloneBank(folder);
        fs.mkdirSync(this.root, { recursive: true, mode: 0o700 }); directory(this.root);
        const parent = path.join(this.root, bank.id), target = path.join(this.root, bank.key);
        fs.mkdirSync(parent, { recursive: true, mode: 0o700 }); directory(parent);
        if (fs.existsSync(target)) { const old = this.load(bank.key); if (old.manifestHash !== bank.manifestHash) fail(); return old; }
        const temporary = path.join(parent, '.import-' + randomUUID()); fs.mkdirSync(temporary, { mode: 0o700 });
        try {
            fs.writeFileSync(path.join(temporary, 'voice.json'), read(path.join(folder, 'voice.json'), 65536), { flag: 'wx', mode: 0o600 });
            fs.writeFileSync(path.join(temporary, 'reference.wav'), bank.wav, { flag: 'wx', mode: 0o600 });
            fs.writeFileSync(path.join(temporary, 'transcript.txt'), Buffer.from(bank.text), { flag: 'wx', mode: 0o600 });
            if (readCloneBank(temporary).manifestHash !== bank.manifestHash) fail();
            fs.renameSync(temporary, target); return this.load(bank.key);
        } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
    }
}
export function cloneIdentity(profile: VoiceProfile): CloneIdentity | undefined {
    try { const value = JSON.parse(profile.provenance); return value.origin === 'clone-bank-v1' ? value : undefined; } catch { return; }
}
export function verifyCloneProfile(profile: VoiceProfile): void {
    const c = cloneIdentity(profile); if (!c) return;
    if (!profile.referenceFile || !profile.referenceText || hash(read(profile.referenceFile, 2 * 1024 * 1024)) !== c.audioHash ||
        hash(Buffer.from(profile.referenceText)) !== c.transcriptHash) fail();
}
/** The original recording supplies physical texture; only agreed delivery modifiers remain. */
export function cloneDelivery(segment: AudioSegment, tone: string, _family?: DemonFamily, age?: CloneAgeBand, undead?: UndeadPerformance) {
    const direction = segment.kind === 'thought' ? WHISPER_DIRECTION : '';
    return { renderText: segment.text, instruction: [boundedDirection(tone), cloneAgeInstruction(age), undeadDirection(undead,segment.kind==='thought'), direction].filter(Boolean).join(' ') };
}
