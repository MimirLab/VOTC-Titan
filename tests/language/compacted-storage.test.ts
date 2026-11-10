import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { CompactedMemory } from '../../src/shared/compactionTypes';

let root: string, directory: string, store: typeof import('../../src/main/compactedMemoryStore').compactedMemoryStore;
const memory = (id: string, owner: number): CompactedMemory => ({ id, date: '1066.9.15', gameDate: '1066.9.15',
    content: `Private owned memory ${id}.`, characterIds: [owner], recipientPerspectiveId: owner, relevanceScore: 1,
    entityReferences: [], compactionLevel: 1, sourceMessageIds: ['source'], creationTimestamp: 1 });
beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-compaction-storage-'));
    require('electron').app.getPath.mockReturnValue(root);
    store = require('../../src/main/compactedMemoryStore').compactedMemoryStore;
    directory = path.join(root, 'votc_data/memories_compacted/1');
});
beforeEach(() => fs.rmSync(path.join(root, 'votc_data'), { recursive: true, force: true }));
afterEach(() => jest.restoreAllMocks());
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const bytes = (owner: number) => fs.readFileSync(path.join(directory, owner + '.json'));

test('batch persistence retains the existing encrypted format and distinct owner files', async () => {
    const first = memory('first', 2), second = memory('second', 3);
    await store.saveCompactedMemoryBatch('1', new Map([['2', [first]], ['3', [second]]]));
    expect((await store.readCompactedMemory('1', '2')).memories).toEqual([first]);
    expect((await store.readCompactedMemory('1', '3')).memories).toEqual([second]);
    expect(bytes(2).toString()).toMatch(/^[a-f0-9]{32}:[a-f0-9]+$/);
    expect(bytes(2).toString()).not.toContain(first.content);
    expect(fs.statSync(path.join(directory, '2.json')).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(directory).sort()).toEqual(['2.json', '3.json']);
});
test('a late encounter update reads the fresh encrypted records and preserves a newer appended encounter', async () => {
    const first = memory('first', 2), later = memory('later', 2);
    await store.saveCompactedMemory('1', '2', [first]);
    const stale = (await store.readCompactedMemory('1', '2')).memories;
    await store.saveCompactedMemory('1', '2', [first, later]);
    const updated = await store.updateCompactedMemoryBatch('1', new Map([['2', current => current.map(record =>
        record.id === stale[0].id ? { ...record, content: 'Only the first encounter was updated.' } : record)]]));
    expect(updated.memories.get('2')).toEqual([{ ...first, content: 'Only the first encounter was updated.' }, later]);
    expect((await store.readCompactedMemory('1', '2')).memories).toEqual(updated.memories.get('2'));
});
test('a corrupt owner file cannot be mistaken for an empty file during an update', async () => {
    await store.saveCompactedMemory('1', '2', [memory('old', 2)]);
    fs.writeFileSync(path.join(directory, '2.json'), 'corrupt');
    await expect(store.updateCompactedMemoryBatch('1', new Map([['2', () => [memory('new', 2)]]]))).rejects.toThrow();
    expect(fs.readFileSync(path.join(directory, '2.json'), 'utf8')).toBe('corrupt');
});

test('failure staging a later owner publishes none of the updates', async () => {
    await store.saveCompactedMemoryBatch('1', new Map([['2', [memory('old-two', 2)]], ['3', [memory('old-three', 3)]]]));
    const first = bytes(2), second = bytes(3), open = fs.openSync;
    jest.spyOn(fs, 'openSync').mockImplementation(((file: any, flags: any, mode: any) => {
        if (String(file).endsWith('-3.stage')) throw new Error('Disk full');
        return open(file, flags, mode);
    }) as any);
    await expect(store.saveCompactedMemoryBatch('1', new Map([['2', [memory('new-two', 2)]], ['3', [memory('new-three', 3)]]]))).rejects.toThrow('Disk full');
    expect(bytes(2)).toEqual(first); expect(bytes(3)).toEqual(second);
    expect(fs.readdirSync(directory).sort()).toEqual(['2.json', '3.json']);
});

test('failure publishing a later owner restores every earlier owner byte for byte', async () => {
    await store.saveCompactedMemoryBatch('1', new Map([['2', [memory('old-two', 2)]], ['3', [memory('old-three', 3)]]]));
    const first = bytes(2), second = bytes(3), rename = fs.renameSync;
    let failed = false;
    jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if (!failed && String(from).endsWith('-3.stage')) { failed = true; throw new Error('Commit failed'); }
        return rename(from, to);
    });
    await expect(store.saveCompactedMemoryBatch('1', new Map([['2', [memory('new-two', 2)]], ['3', [memory('new-three', 3)]]]))).rejects.toThrow('Commit failed');
    expect(bytes(2)).toEqual(first); expect(bytes(3)).toEqual(second);
    expect(fs.readdirSync(directory).sort()).toEqual(['2.json', '3.json']);
});

test('an interrupted rollback recovers on the next read, including removal of a newly created owner', async () => {
    const old = memory('old-two', 2); await store.saveCompactedMemory('1', '2', [old]);
    const original = bytes(2), rename = fs.renameSync;
    const blocked = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if (String(from).endsWith('-4.stage') || String(from).endsWith('.backup')) throw new Error('Storage temporarily blocked');
        return rename(from, to);
    });
    await expect(store.saveCompactedMemoryBatch('1', new Map([['2', [memory('new-two', 2)]], ['3', [memory('new-three', 3)]], ['4', [memory('new-four', 4)]]])))
        .rejects.toThrow('recovery is pending');
    expect(fs.existsSync(path.join(directory, '.compaction-transaction'))).toBe(true);
    await expect(store.readCompactedMemory('1', '2')).rejects.toThrow('temporarily blocked');
    blocked.mockRestore();
    expect((await store.readCompactedMemory('1', '2')).memories).toEqual([old]);
    expect((await store.readCompactedMemory('1', '3')).memories).toEqual([]);
    expect(bytes(2)).toEqual(original);
    expect(fs.readdirSync(directory)).toEqual(['2.json']);
});

test('failure publishing the complete journal leaves old data intact and no partial journal', async () => {
    await store.saveCompactedMemory('1', '2', [memory('old', 2)]);
    const original = bytes(2), rename = fs.renameSync;
    jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if (String(from).endsWith('.journal')) throw new Error('Journal unavailable');
        return rename(from, to);
    });
    await expect(store.saveCompactedMemory('1', '2', [memory('new', 2)])).rejects.toThrow('Journal unavailable');
    expect(bytes(2)).toEqual(original); expect(fs.readdirSync(directory)).toEqual(['2.json']);
});

test('all recovery entries are validated before touching any owner file', async () => {
    await store.saveCompactedMemory('1', '2', [memory('old', 2)]);
    const original = bytes(2), hash = crypto.createHash('sha256').update(original).digest('hex');
    const backup = '.compaction-aaa-2.backup'; fs.writeFileSync(path.join(directory, backup), original);
    fs.writeFileSync(path.join(directory, '.compaction-transaction'), JSON.stringify({ version: 1, entries: [
        { owner: '2', stage: '.compaction-aaa-2.stage', backup, originalHash: hash, newHash: hash },
        { owner: '../escape', stage: '.compaction-bbb-3.stage', backup: '.compaction-bbb-3.backup', newHash: hash }
    ] }));
    await expect(store.readCompactedMemory('1', '2')).rejects.toThrow('Invalid compacted-memory owner');
    expect(bytes(2)).toEqual(original); expect(fs.existsSync(path.join(directory, backup))).toBe(true);
});
