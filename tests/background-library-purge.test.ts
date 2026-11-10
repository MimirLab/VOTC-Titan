import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { BackgroundQueue } from '../src/main/background/BackgroundQueue';
import { requestBackgroundLibraryPurge } from '../src/main/background/backgroundLibraryPurge';
import { CultureLibrary } from '../src/main/culture/CultureLibrary';
import { CultureService } from '../src/main/culture/CultureService';
import { cultureInput } from '../src/main/culture/cultureIdentity';
import { FaithLibrary } from '../src/main/faith/FaithLibrary';
import { FaithService } from '../src/main/faith/FaithService';
import { faithInput } from '../src/main/faith/faithIdentity';
import { snapshot as cultureSnapshot, result as cultureResult, character } from './culture/fixtures';
import { snapshot as faithSnapshot, result as faithResult } from './faith/fixtures';

const options = { enabled: () => true, language: () => 'en', foregroundBusy: () => false, now: () => 0 };
const domains = [
    { name: 'culture', table: 'culture_profiles', open: (file: string) => new CultureLibrary(file),
        input: () => cultureInput(cultureSnapshot(), 'en'), result: cultureResult,
        service: (library: any, generate: any, queue?: BackgroundQueue) => new CultureService(library, generate, options, queue),
        observe: (service: any) => service.observe({ characterId: 2, cultureId: 123, snapshot: cultureSnapshot() }) },
    { name: 'faith', table: 'faith_profiles', open: (file: string) => new FaithLibrary(file),
        input: () => faithInput(faithSnapshot(), 'en'), result: faithResult,
        service: (library: any, generate: any, queue?: BackgroundQueue) => new FaithService(library, generate, options, queue),
        observe: (service: any) => service.observe({ characterId: 2, faithId: 123, snapshot: faithSnapshot(),
            liveContext: { fervor: 65 }, characterZealous: true }) }
];

describe.each(domains)('$name library purge', domain => {
    test('removes every status and historical recipe durably, retaining unrelated tables', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'votc-purge-'));
        const file = path.join(root, 'library.sqlite');
        let library = domain.open(file);
        const db = new Database(file);
        try {
            for (const status of ['ready', 'pending', 'failed', 'generating'])
                db.prepare(`INSERT INTO ${domain.table} (hash, input_json, status, paragraph, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 0, 0)`).run(status, JSON.stringify({ promptVersion: 1 }), status, 'archived text');
            db.exec("CREATE TABLE untouched (value TEXT); INSERT INTO untouched VALUES ('keep');");
            expect(library.clearProfiles()).toBe(4);
            expect(library.stats()).toEqual({ ready: 0, pending: 0, failed: 0 });
            expect(db.prepare('SELECT value FROM untouched').get()).toEqual({ value: 'keep' });
            library.close(); library = domain.open(file);
            expect(library.clearProfiles()).toBe(0);
            const hash = library.encounter(domain.input() as any, 1);
            library.finish(library.claim(hash, 1)! as any, domain.result() as any, 2);
            expect(library.ready(hash)).toBe(domain.result().paragraph);
        } finally { library.close(); db.close(); fs.rmSync(root, { recursive: true, force: true }); }
    });

    test('clears pending work without an automatic sweep; next needed profile reuses the same hash', async () => {
        const library = domain.open(':memory:');
        const generate = jest.fn(async () => domain.result());
        const service = domain.service(library, generate);
        const person = character(2, 'Speaker');
        try {
            domain.observe(service);
            service.backgroundFor(person);
            const hash = library.encounter(domain.input() as any, 0);
            expect(await service.clearProfiles()).toBe(1);
            await service.tick();
            expect(generate).not.toHaveBeenCalled();
            expect(service.stats()).toEqual({ ready: 0, pending: 0, failed: 0 });
            expect(service.backgroundFor(person)).toBeUndefined();
            expect(library.state(hash)).toBe('pending');
            await service.tick();
            expect(generate).toHaveBeenCalledTimes(1);
            expect(service.backgroundFor(person)).toBe(domain.result().paragraph);
            if (domain.name === 'faith') expect((service as FaithService).zealousFor(person)).toBe(true);
        } finally { await service.close(); }
    });

    test('aborts even an uncooperative worker, blocks requeue during purge, and ignores late results', async () => {
        const library = domain.open(':memory:');
        let late!: (value: any) => void;
        let next!: (value: any) => void;
        let signal!: AbortSignal;
        const generate = jest.fn((_input, captured: AbortSignal) => {
            signal = captured;
            return new Promise<any>(resolve => { late = resolve; });
        }).mockImplementationOnce((_input, captured) => {
            signal = captured;
            return new Promise<any>(resolve => { late = resolve; });
        }).mockImplementationOnce(() => new Promise<any>(resolve => { next = resolve; }));
        const service = domain.service(library, generate);
        const clear = jest.spyOn(library, 'clearProfiles');
        try {
            domain.observe(service);
            const worker = service.tick(); await Promise.resolve();
            expect(generate).toHaveBeenCalledTimes(1);
            const purge = service.clearProfiles();
            const duplicate = service.clearProfiles();
            domain.observe(service);
            expect(service.prepare(character(2, 'Speaker'))).toBe('disabled');
            await service.tick();
            expect(await purge).toBe(1); expect(await duplicate).toBe(1);
            await worker;
            expect(signal.aborted).toBe(true);
            expect(clear).toHaveBeenCalledTimes(1);
            await service.tick();
            expect(generate).toHaveBeenCalledTimes(1);
            domain.observe(service);
            const newWorker = service.tick(); await Promise.resolve();
            late(domain.result()); await Promise.resolve(); await Promise.resolve();
            expect(service.stats()).toEqual({ ready: 0, pending: 1, failed: 0 });
            next(domain.result()); await newWorker;
            expect(service.stats()).toEqual({ ready: 1, pending: 0, failed: 0 });
        } finally { await service.close(); }
    });
});

test('purging one domain releases its provider lane and preserves the other library', async () => {
    const queue = new BackgroundQueue();
    const culture = domains[0].service(domains[0].open(':memory:'), () => new Promise(() => {}), queue);
    const faithGenerate = jest.fn(async () => faithResult());
    const faith = domains[1].service(domains[1].open(':memory:'), faithGenerate, queue);
    try {
        domains[0].observe(culture); domains[1].observe(faith);
        const worker = culture.tick(); await Promise.resolve();
        await faith.tick(); expect(faithGenerate).not.toHaveBeenCalled();
        await culture.clearProfiles(); await worker;
        expect(faith.stats().pending).toBe(1);
        await faith.tick(); expect(faith.stats().ready).toBe(1);
    } finally { await culture.close(); await faith.close(); }
});

test('invalid selection and cancel never purge; confirmation clears only the selected domain', async () => {
    const clear = { culture: jest.fn(async () => 2), faith: jest.fn(async () => 1) };
    const confirm = jest.fn(async () => false);
    expect((await requestBackgroundLibraryPurge('../memories', confirm, clear)).success).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect((await requestBackgroundLibraryPurge('culture', confirm, clear)).canceled).toBe(true);
    expect(clear.culture).not.toHaveBeenCalled(); expect(clear.faith).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    expect((await requestBackgroundLibraryPurge('faith', confirm, clear)).message).toContain('1 saved faith profile.');
    expect(clear.faith).toHaveBeenCalledTimes(1); expect(clear.culture).not.toHaveBeenCalled();
    clear.culture.mockRejectedValueOnce(new Error('private provider key'));
    const failure = await requestBackgroundLibraryPurge('culture', confirm, clear);
    expect(failure.success).toBe(false); expect(failure.message).not.toContain('private');
});
