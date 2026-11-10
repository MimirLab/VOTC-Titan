import fs from 'fs';
import os from 'os';
import path from 'path';
import { CloneBanks, cloneDelivery, verifyCloneProfile } from '../../src/main/audio/CloneBanks';
import { AudioLibrary } from '../../src/main/audio/AudioLibrary';
import { cloneFixture } from './clone-fixture';
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-clone-banks-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
test('import freezes exact reference/transcript independently of the source and is idempotent', () => {
    const source = cloneFixture(path.join(root, 'source')), banks = new CloneBanks(path.join(root, 'banks'));
    const b = banks.import(source.file); expect(b.text).toBe(source.text); expect(b.wav).toEqual(source.wav);
    expect(banks.import(source.file)).toEqual(b); expect(banks.list()).toEqual([{ key: b.key, name: b.name, revision: 1 }]);
    fs.rmSync(source.folder, { recursive: true }); expect(banks.load(b.key)).toEqual(b);
});
test.each(['../test/v0001', 'test/v0000/..', '/tmp/test', 'test/v00001', '__proto__/v0001'])('untrusted key %s cannot escape the bank root', key => {
    expect(() => new CloneBanks(root).load(key)).toThrow();
});
test.each(['hash', 'transcript', 'policy', 'draft', 'stereo', 'symlink', 'truncated', 'silent', 'control'])('invalid %s references fail before activation', kind => {
    const s = cloneFixture(path.join(root, 'source'));
    if (kind === 'hash') s.manifest.reference.audio_sha256 = '0'.repeat(64);
    if (kind === 'transcript') fs.appendFileSync(path.join(s.folder, 'transcript.txt'), 'changed');
    if (kind === 'policy') s.manifest.delivery.automatic_casting = true;
    if (kind === 'draft') s.manifest.quality.state = 'draft';
    if (kind === 'stereo') s.manifest.reference.audio_info.channels = 2;
    if (kind === 'symlink') { fs.renameSync(path.join(s.folder, 'reference.wav'), path.join(root, 'elsewhere.wav')); fs.symlinkSync(path.join(root, 'elsewhere.wav'), path.join(s.folder, 'reference.wav')); }
    if (kind === 'truncated') fs.writeFileSync(path.join(s.folder, 'reference.wav'), s.wav.subarray(0, 40));
    if (kind === 'silent') fs.writeFileSync(path.join(s.folder, 'reference.wav'), Buffer.alloc(s.wav.length));
    if (kind === 'control') fs.writeFileSync(path.join(s.folder, 'transcript.txt'), '[S0]');
    s.write(); const banks = new CloneBanks(path.join(root, 'banks')); expect(() => banks.import(s.file)).toThrow(); expect(banks.list()).toEqual([]);
});
test('prepared identity revisions cannot be overwritten and corrupt assigned banks are never substituted', () => {
    const s = cloneFixture(path.join(root, 'source')), banks = new CloneBanks(path.join(root, 'banks')), b = banks.import(s.file);
    s.manifest.name = 'Changed'; s.write(); expect(() => banks.import(s.file)).toThrow();
    fs.appendFileSync(path.join(banks.root, b.key, 'reference.wav'), 'corruption');
    expect(banks.list()).toEqual([]); expect(() => banks.load(b.key)).toThrow();
});
test('bindings are exact campaign/character pairs, imported profiles reuse identity and receipts survive unbinding', () => {
    const s = cloneFixture(path.join(root, 'source')), bank = new CloneBanks(path.join(root, 'banks')).import(s.file), library = new AudioLibrary(path.join(root, 'library'));
    try {
        library.bindClone('a', '2', bank); expect(library.cloneBinding('a', '2')?.key).toBe(bank.key);
        expect(library.cloneBinding('b', '2')).toBeUndefined(); expect(library.cloneBinding('a', '3')).toBeUndefined();
        const p = library.importClone('a', '2', bank); expect(library.importClone('a', '2', bank).id).toBe(p.id);
        expect(p.seed).toBe(17); expect(p.referenceText).toBe(s.text); verifyCloneProfile(p);
        library.bindClone('a', '2'); expect(library.byId(p.id)).toEqual(p); expect(library.cloneBinding('a', '2')).toBeUndefined();
        fs.appendFileSync(p.referenceFile!, 'corruption'); expect(() => library.importClone('a', '2', bank)).toThrow();
    } finally { library.close(); }
});
test('clone delivery keeps only bounded tone and same-reference whispers with literal speech untouched', () => {
    const segment = { kind: 'thought' as const, text: 'The copper lantern is safe.', passage: 0 };
    expect(cloneDelivery(segment, 'calm, measured')).toEqual({ renderText: segment.text,
        instruction: "calm, measured Whisper throughout with unvoiced breath and quiet, crisp consonants. Keep the reference speaker's vocal texture and accent; do not use a normal speaking voice." });
    expect(cloneDelivery({ ...segment, kind: 'speech' }, 'old female goblin British')).toEqual({ renderText: segment.text, instruction: '' });
});

test('automatic opt-out survives reopening and stays scoped to the campaign and participant', () => {
    const folder = path.join(root, 'library'); let library = new AudioLibrary(folder);
    library.setCloneMode('a', '2', 'normal'); library.close(); library = new AudioLibrary(folder);
    try {
        expect(library.cloneMode('a', '2')).toBe('normal'); expect(library.cloneMode('b', '2')).toBe('auto'); expect(library.cloneMode('a', '3')).toBe('auto');
        library.setCloneMode('a', '2', 'auto'); expect(library.cloneMode('a', '2')).toBe('auto');
    } finally { library.close(); }
});
