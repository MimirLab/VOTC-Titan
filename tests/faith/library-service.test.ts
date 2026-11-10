import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { FaithLibrary } from '../../src/main/faith/FaithLibrary';
import { FaithService } from '../../src/main/faith/FaithService';
import { CultureLibrary } from '../../src/main/culture/CultureLibrary';
import { CultureService } from '../../src/main/culture/CultureService';
import { BackgroundQueue } from '../../src/main/background/BackgroundQueue';
import { faithInput, faithHash, validateFaithResult } from '../../src/main/faith/faithIdentity';
import { sealFaithSnapshot } from '../../src/main/faith/faithLog';
import { character, snapshot as cultureSnapshot, result as cultureResult } from '../culture/fixtures';
import { snapshot, result, capture, catalog } from './fixtures';
const options = { enabled: () => true, language: () => 'en', foregroundBusy: () => false };
const observation = () => ({ characterId: 2, faithId: 123, snapshot: snapshot(), liveContext: { fervor: 65 } });

test('persistent cache reopens, rejects stale leases, and keeps the first accepted text across accounts/games', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faith-library-'));
    try {
        const file = path.join(root, 'faiths.sqlite'); let library = new FaithLibrary(file);
        const hash = library.encounter(faithInput(snapshot(), 'en'), 0);
        const crashed = library.claim(hash, 0)!;
        expect(library.claim(hash, 1)).toBeUndefined();
        const recovered = library.claim(hash, 180001)!;
        library.finish(crashed, result(), 180002); expect(library.ready(hash)).toBeUndefined();
        library.finish(recovered, result(), 180003); library.close();
        library = new FaithLibrary(file);
        expect(library.encounter(faithInput(snapshot(), 'en'), 200000)).toBe(hash);
        expect(library.ready(hash)).toBe(result().paragraph); expect(library.claim(hash, 200000)).toBeUndefined(); library.close();
        const db = new Database(file);
        expect(JSON.stringify(db.prepare('SELECT * FROM faith_profiles').get())).not.toMatch(/characterId|faithId|fervor|api.key/);
        db.close();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('conversion/incomplete capture invalidates bindings; transient context expires without changing the hash', async () => {
    let now = 0; const service = new FaithService(new FaithLibrary(':memory:'), async () => result(), { ...options, now: () => now });
    try {
        const person = character(2, 'Believer'); service.observe(observation()); await service.tick();
        expect(service.backgroundFor(person)).toBe(result().paragraph);
        const original = faithHash(faithInput(person.faithSnapshot!, 'en'));
        service.observe({ ...observation(), liveContext: { fervor: 99 } });
        expect(service.contextFor(person)?.fervor).toBe(99);
        expect(faithHash(faithInput(person.faithSnapshot!, 'en'))).toBe(original);
        now = 15001; expect(service.contextFor(person)).toBeUndefined();
        service.forgetCharacter(2); expect(service.backgroundFor(person)).toBeUndefined();
        expect(person.faithSnapshot).toBeUndefined();
        service.clearObservations(); service.observe(observation());
        expect(service.backgroundFor(person)).toBeUndefined();
        expect(service.contextFor(person)).toBeUndefined();
        expect(service.backgroundFor(character(2, 'New game'))).toBe(result().paragraph);
    } finally { await service.close(); }
});

test('waiting domains alternate, and withdrawing a disabled domain cannot block the queue', () => {
    const queue = new BackgroundQueue(), culture = Symbol('culture'), faith = Symbol('faith');
    const release = queue.acquire(new AbortController(), culture)!;
    expect(queue.acquire(new AbortController(), faith)).toBeUndefined();
    release();
    expect(queue.acquire(new AbortController(), culture)).toBeUndefined();
    const next = queue.acquire(new AbortController(), faith)!; expect(next).toBeDefined(); next();
    const third = queue.acquire(new AbortController(), culture)!; expect(third).toBeDefined();
    expect(queue.acquire(new AbortController(), faith)).toBeUndefined(); third();
    expect(queue.acquire(new AbortController(), culture)).toBeUndefined();
    queue.withdraw(faith);
    expect(queue.acquire(new AbortController(), culture)).toBeDefined();
});
test('culture and religion share one provider lane, and foreground preempts either domain', async () => {
    const queue = new BackgroundQueue();
    const cultureGenerate = jest.fn((_input, signal: AbortSignal) => new Promise<any>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })));
    const faithGenerate = jest.fn(async () => result());
    const culture = new CultureService(new CultureLibrary(':memory:'), cultureGenerate, options, queue);
    const faith = new FaithService(new FaithLibrary(':memory:'), faithGenerate, options, queue);
    try {
        culture.observe({ characterId: 2, cultureId: 123, snapshot: cultureSnapshot() }); faith.observe(observation());
        const running = culture.tick(); await Promise.resolve();
        await faith.tick(); expect(faithGenerate).not.toHaveBeenCalled();
        const release = faith.beginForeground(); await running;
        await faith.tick(); expect(faithGenerate).not.toHaveBeenCalled();
        release(); await faith.tick(); expect(faithGenerate).toHaveBeenCalledTimes(1);
        expect(faith.stats().ready).toBe(1); expect(culture.stats().pending).toBe(1);
    } finally { await culture.close(); await faith.close(); }
});
test('failure retries without persisting provider errors or leaking a ready profile', async () => {
    let now = 0; const generate = jest.fn().mockRejectedValueOnce(new Error('private-secret')).mockResolvedValue(result());
    const service = new FaithService(new FaithLibrary(':memory:'), generate, { ...options, now: () => now });
    try {
        service.observe(observation()); await service.tick(); expect(service.stats().failed).toBe(1);
        now = 60001; await service.tick(); expect(service.stats().ready).toBe(1);
    } finally { await service.close(); }
});

test('reforming a faith creates a new entry, while reversion and a new campaign reuse accepted entries', async () => {
    const library = new FaithLibrary(':memory:');
    const original = observation(), data = capture();
    data.doctrines.push('changed_doctrine');
    data.texts.faith_description = 'The reformed teachings retain balance but now forbid shadow workings.';
    const reformed = { ...original, snapshot: sealFaithSnapshot(catalog(), data) };
    const generate = jest.fn(async input => result(input));
    const service = new FaithService(library, generate, options);
    try {
        const person = character(2, 'One person');
        service.observe(original); await service.tick();
        const before = service.backgroundFor(person);
        service.forgetCharacter(2); service.observe(reformed);
        expect(service.backgroundFor(person)).toBeUndefined();
        await service.tick(); const after = service.backgroundFor(person);
        expect(after).not.toBe(before); expect(service.stats().ready).toBe(2);
        service.observe(original); expect(service.backgroundFor(person)).toBe(before);
        service.clearObservations(); service.observe(reformed);
        expect(service.backgroundFor(character(2, 'Another campaign'))).toBe(after);
        await service.tick(); expect(generate).toHaveBeenCalledTimes(2);
    } finally { await service.close(); }
});

test('corrupted cached input versions are rejected rather than supplying guidance', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faith-cache-version-'));
    const file = path.join(root, 'faiths.sqlite');
    try {
        const library = new FaithLibrary(file), input = faithInput(snapshot(), 'en');
        const hash = library.encounter(input, 0);
        library.finish(library.claim(hash, 0)!, result(), 1);
        const db = new Database(file);
        db.prepare('UPDATE faith_profiles SET input_json=? WHERE hash=?').run(JSON.stringify({ ...input, version: 999 }), hash);
        db.close(); expect(library.ready(hash)).toBeUndefined(); library.close();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('personal zeal binds to the current character, survives transient expiry and reuses one faith profile', async () => {
    let now = 0;
    const generate = jest.fn(async () => result());
    const service = new FaithService(new FaithLibrary(':memory:'), generate, { ...options, now: () => now });
    try {
        const person = character(2, 'Localized believer');
        service.observe({ ...observation(), characterZealous: true }); await service.tick();
        expect(service.backgroundFor(person)).toBe(result().paragraph);
        expect(service.zealousFor(person)).toBe(true);
        now = 15001;
        expect(service.contextFor(person)).toBeUndefined();
        expect(service.backgroundFor(person)).toBe(result().paragraph);
        expect(service.zealousFor(person)).toBe(true);
        const other = character(2, 'Another object');
        expect(service.backgroundFor(other)).toBeUndefined(); expect(service.zealousFor(other)).toBeUndefined();
        service.forgetCharacter(2); expect(service.zealousFor(person)).toBeUndefined();
        service.observe({ ...observation(), characterZealous: false });
        expect(service.backgroundFor(person)).toBe(result().paragraph);
        expect(service.zealousFor(person)).toBe(false);
        await service.tick(); expect(generate).toHaveBeenCalledTimes(1);
        service.clearObservations(); expect(service.zealousFor(person)).toBeUndefined();
    } finally { await service.close(); }
});
