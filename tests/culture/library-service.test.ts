import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { CultureLibrary } from '../../src/main/culture/CultureLibrary';
import { CultureService } from '../../src/main/culture/CultureService';
import { CultureGenerationResult, cultureInput } from '../../src/main/culture/cultureIdentity';
import { snapshot, paragraph, character, result } from './fixtures';

let temporary: string;
beforeEach(() => { temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'votc-culture-test-')); });
afterEach(() => { fs.rmSync(temporary, { recursive: true, force: true }); });

test('ready guidance survives closing/reopening and reuses the same composition under another account/game', () => {
    const filename = path.join(temporary, 'cultures.sqlite');
    let library = new CultureLibrary(filename);
    const hash = library.encounter(cultureInput(snapshot(), 'en'), 0);
    const job = library.claim(hash, 0)!;
    library.finish(job, result(), 1); library.close();
    library = new CultureLibrary(filename);
    expect(library.encounter(cultureInput({ ...snapshot(), facts: snapshot().facts.reverse() }, 'en'), 2)).toBe(hash);
    expect(library.ready(hash)).toBe(paragraph);
    expect(library.claim(hash, 2)).toBeUndefined();
    expect(library.stats()).toEqual({ ready: 1, pending: 0, failed: 0 });
    library.close();
});

test('only one lease can claim a hash and an expired crashed lease is recoverable', () => {
    const filename = path.join(temporary, 'cultures.sqlite');
    const first = new CultureLibrary(filename); const second = new CultureLibrary(filename);
    const hash = first.encounter(cultureInput(snapshot(), 'en'), 0);
    const crashed = first.claim(hash, 0)!;
    expect(second.claim(hash, 1)).toBeUndefined();
    const recovered = second.claim(hash, 180_001)!;
    expect(recovered.attempts).toBe(2);
    first.finish(crashed, result(), 180_002);
    expect(first.ready(hash)).toBeUndefined();
    second.finish(recovered, result(), 180_003);
    expect(first.ready(hash)).toBe(paragraph);
    first.close(); second.close();
});

test('failed output retries with backoff and never becomes a ready profile', () => {
    const library = new CultureLibrary(':memory:');
    const hash = library.encounter(cultureInput(snapshot(), 'en'), 0); const job = library.claim(hash, 0)!;
    expect(() => library.finish(job, {} as any, 1)).toThrow();
    library.fail(job, 1);
    expect(library.ready(hash)).toBeUndefined();
    expect(library.claim(hash, 60_000)).toBeUndefined();
    const retry = library.claim(hash, 60_001)!;
    library.finish(retry, result(), 60_002);
    expect(library.ready(hash)).toBe(paragraph);
    library.close();
});

test('generation failure stores no provider secrets and recovers after an account/provider change', async () => {
    const filename = path.join(temporary, 'cultures.sqlite');
    const library = new CultureLibrary(filename);
    let now = 0;
    const generate = jest.fn().mockRejectedValueOnce(new Error('secret-api-key')).mockResolvedValue(result());
    const service = new CultureService(library, generate, { enabled: () => true, language: () => 'en', foregroundBusy: () => false, now: () => now });
    service.observe({ characterId: 10, cultureId: 100, snapshot: snapshot() });
    await service.tick();
    expect(service.stats().failed).toBe(1);
    now = 60_001; await service.tick();
    expect(service.stats().ready).toBe(1);
    await service.close();
    const db = new Database(filename);
    const row = db.prepare('SELECT * FROM culture_profiles').get();
    expect(JSON.stringify(row)).not.toMatch(/secret-api-key|characterId|cultureId|provider|campaign|account/);
    db.close();
});

test('duplicate encounters deduplicate; dialogue/letter priority stops new work and preempts a running job', async () => {
    const library = new CultureLibrary(':memory:');
    let busy = true; let now = 0;
    const generate = jest.fn((_input, signal: AbortSignal) => new Promise<CultureGenerationResult>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('preempted')), { once: true });
    }));
    const service = new CultureService(library, generate, { enabled: () => true, language: () => 'en', foregroundBusy: () => busy, now: () => now });
    for (let id = 1; id < 5; id++) service.observe({ characterId: id, cultureId: id + 90, snapshot: snapshot() });
    await service.tick(); expect(generate).not.toHaveBeenCalled();
    busy = false;
    const release = service.beginForeground(); await service.tick(); expect(generate).not.toHaveBeenCalled(); release(); release();
    const running = service.tick(); await service.tick(); expect(generate).toHaveBeenCalledTimes(1);
    busy = true; await service.tick(); await running;
    expect(service.stats()).toEqual({ ready: 0, pending: 1, failed: 0 });
    busy = false; now = 1001; generate.mockResolvedValueOnce(result());
    await service.tick(); expect(service.stats().ready).toBe(1);
    await service.close();
});

test('only fresh captures in this game can supply character guidance; incomplete or unseen cultures queue nothing', async () => {
    const library = new CultureLibrary(':memory:'); let now = 0;
    const service = new CultureService(library, async () => result(), { enabled: () => true, language: () => 'en', foregroundBusy: () => false, now: () => now });
    const person = character(10, 'Synthetic speaker');
    expect(service.backgroundFor(person)).toBeUndefined(); expect(service.stats().pending).toBe(0);
    expect(() => service.observe({ characterId: 10, cultureId: 100, snapshot: { ...snapshot(), complete: false } as any })).toThrow();
    service.observe({ characterId: 10, cultureId: 100, snapshot: snapshot() });
    expect(service.backgroundFor(person)).toBeUndefined(); // No wait on first generation.
    await service.tick(); expect(service.backgroundFor(person)).toBe(paragraph);
    expect(person.cultureSnapshot).toBeDefined();
    now = 15_001;
    expect(service.backgroundFor(person)).toBe(paragraph); // Bound to this conversation's actual Character snapshot.
    expect(service.backgroundFor(character(10, 'New character object'))).toBeUndefined();
    service.observe({ characterId: 10, cultureId: 999, snapshot: snapshot() });
    expect(service.backgroundFor(person)).toBe(paragraph);
    service.forgetCharacter(10); expect(service.backgroundFor(person)).toBeUndefined();
    service.clearObservations(); expect(service.backgroundFor(person)).toBeUndefined();
    service.observe({ characterId: 10, cultureId: 100, snapshot: snapshot() });
    expect(service.backgroundFor(person)).toBeUndefined(); // Old object cannot be rebound across a save load.
    expect(service.backgroundFor(character(10, 'New game character'))).toBe(paragraph);
    await service.close();
});

test('the deadline releases a worker even when the provider never returns or honors its abort signal', async () => {
    jest.useFakeTimers(); jest.setSystemTime(0);
    const library = new CultureLibrary(':memory:');
    const service = new CultureService(library, () => new Promise<CultureGenerationResult>(() => {}), {
        enabled: () => true, language: () => 'en', foregroundBusy: () => false
    });
    try {
        service.observe({ characterId: 10, cultureId: 100, snapshot: snapshot() });
        const running = service.tick();
        await jest.advanceTimersByTimeAsync(120_000);
        await running;
        expect(service.stats()).toEqual({ ready: 0, pending: 0, failed: 1 });
        await service.close();
    } finally { jest.useRealTimers(); }
});
