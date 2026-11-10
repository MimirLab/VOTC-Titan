import fs from 'fs';
import path from 'path';
import os from 'os';
import { AudioLibrary } from '../../src/main/audio/AudioLibrary';

test('campaign and character IDs own voice reuse independently of names, revisions and codec runtimes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-audio-'));
    let library = new AudioLibrary(root);
    try {
        const original = library.save('campaign-a', '42', 'Same Name', 'A warm resonant voice with precise articulation.', 'synthetic');
        const other = library.save('campaign-b', '42', 'Same Name', 'A dry husky voice with clipped articulation.', 'synthetic');
        expect(original.id).not.toBe(other.id);
        library.reference(original, Buffer.from('test fixture'), 'Reference transcript.');
        library.bindCodec(original, 'host-a', 'q8', 'remote-voice');
        expect(library.codec(original, 'host-a', 'f16')).toBeUndefined();
        library.close(); library = new AudioLibrary(root);
        expect(library.get('campaign-a', '42')).toMatchObject({ id: original.id, seed: original.seed, referenceText: 'Reference transcript.' });
        expect(library.codec(original, 'host-a', 'q8')).toBe('remote-voice');
        const revised = library.save('campaign-a', '42', 'New Name', 'A bright clear voice with graceful phrasing.', 'redesigned');
        expect(revised.revision).toBe(2); expect(revised.seed).toBe(original.seed);
        expect(revised.referenceFile).toBeUndefined(); expect(library.codec(revised, 'host-a', 'q8')).toBeUndefined();
        expect(library.list()).toHaveLength(3);
    } finally { library.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('rename preserves the reference, seed, codec and recorded delivery; deletion removes only its owned revision and falls back', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-audio-manage-'));
    const library = new AudioLibrary(root);
    try {
        const old = library.save('__global__', '__narrator__', 'Old', 'A rich male voice with relaxed natural articulation.', 'synthetic');
        const current = library.reference(library.save('__global__', '__narrator__', 'New', 'A light female voice with crisp natural articulation.', 'synthetic'), Buffer.from('owned wave'), 'Reference words.');
        const other = library.reference(library.save('another-campaign', '2', 'Other', 'A gentle mellow voice with slow natural articulation.', 'synthetic'), Buffer.from('unrelated wave'), 'Other reference.');
        library.bindCodec(current, 'host', 'q8', 'remote'); library.bindForm(current, 'test-form');
        library.savePlan('campaign', 'player', 'message', 'digest', { narratorVoiceId: current.id });
        library.rename(current.id, '  My narrator  ');
        expect(library.byId(current.id)).toMatchObject({ id: current.id, label: 'My narrator', seed: current.seed, revision: current.revision, referenceFile: current.referenceFile });
        expect(library.codec(current, 'host', 'q8')).toBe('remote'); expect(fs.readFileSync(current.referenceFile!)).toEqual(Buffer.from('owned wave'));
        library.delete(current.id);
        expect(library.byId(current.id)).toBeUndefined(); expect(fs.existsSync(current.referenceFile!)).toBe(false);
        expect(library.codec(current, 'host', 'q8')).toBeUndefined(); expect(library.form('__global__', '__narrator__', 'test-form')).toBeUndefined();
        expect(library.get('__global__', '__narrator__')?.id).toBe(old.id);
        expect(library.plan('campaign', 'player', 'message', 'digest')).toEqual({ narratorVoiceId: current.id });
        expect(library.get('another-campaign', '2')?.id).toBe(other.id); expect(fs.readFileSync(other.referenceFile!)).toEqual(Buffer.from('unrelated wave'));
        const next = library.save('__global__', '__narrator__', 'Next', 'A clear tenor voice with flowing natural articulation.', 'synthetic');
        expect(next.revision).toBe(3);
        expect(() => library.rename(next.id, ' ')).toThrow('voice name'); expect(() => library.rename(next.id, 'x'.repeat(101))).toThrow('voice name');
    } finally { library.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('deleting the final voice and reopening retains monotonic revision numbers', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-audio-revisions-')); let library = new AudioLibrary(root);
    try {
        const voice = library.save('campaign', '2', 'Name', 'A clear warm voice with unhurried natural articulation.', 'synthetic');
        library.delete(voice.id); expect(library.get('campaign', '2')).toBeUndefined(); library.close(); library = new AudioLibrary(root);
        expect(library.save('campaign', '2', 'Name', 'A clear warm voice with unhurried natural articulation.', 'synthetic').revision).toBe(2);
    } finally { library.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('deleting the current form revision reuses a surviving reference of that same form', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-audio-form-delete-')); const library = new AudioLibrary(root);
    try {
        const provenance = JSON.stringify({ version: 2, casting: { formKey: 'adult-form' } });
        const old = library.save('campaign', '2', 'Old', 'A clear warm voice with flowing natural articulation.', provenance);
        library.bindForm(old, 'adult-form');
        const current = library.save('campaign', '2', 'New', 'A dry low voice with clipped natural articulation.', provenance);
        library.bindForm(current, 'adult-form'); library.delete(current.id);
        expect(library.form('campaign', '2', 'adult-form')?.id).toBe(old.id);
    } finally { library.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
