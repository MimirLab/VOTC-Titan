import fs from 'fs';
import os from 'os';
import path from 'path';
import { ProviderLane } from '../src/shared/providerActivity';
import { waitForProfiles } from '../src/main/background/profileReadiness';
import { EncounterCapture, encounterScript, encounterTargets } from '../src/main/background/EncounterCapture';
import { CultureService } from '../src/main/culture/CultureService';
import { CultureLibrary } from '../src/main/culture/CultureLibrary';
import { FaithService } from '../src/main/faith/FaithService';
import { FaithLibrary } from '../src/main/faith/FaithLibrary';
import { BackgroundQueue } from '../src/main/background/BackgroundQueue';
import { parseCk3Script } from '../src/main/culture/ck3Script';
import { catalog, character, result, snapshot } from './culture/fixtures';
import { catalog as faithCatalog, snapshot as faithSnapshot, result as faithResult } from './faith/fixtures';

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const options = { enabled: () => true, language: () => 'en', foregroundBusy: () => false };

test('a foreground request cancels a background request, waits for its transport cleanup, and serializes other calls', async () => {
    const lane = new ProviderLane(); const order: string[] = [];
    let releaseTransport!: () => void;
    const background = lane.run('background', signal => new Promise<void>(resolve => {
        order.push('background');
        signal.addEventListener('abort', () => { order.push('abort'); releaseTransport = resolve; });
    })).catch(error => { expect(error.name).toBe('AbortError'); expect(error.reason).toBe('foreground'); });
    await settle();
    const first = lane.run('foreground', async () => { order.push('intro'); });
    const second = lane.run('foreground', async () => { order.push('reply'); });
    await settle();
    expect(lane.foregroundBusy).toBe(true); expect(order).toEqual(['background', 'abort']);
    releaseTransport(); await Promise.all([background, first, second]);
    expect(order).toEqual(['background', 'abort', 'intro', 'reply']); expect(lane.foregroundBusy).toBe(false);
});

test('cancelling a queued request removes it without releasing a different active request', async () => {
    const lane = new ProviderLane(); let release!: () => void; const cancelled = new AbortController();
    const active = lane.run('foreground', () => new Promise<void>(resolve => { release = resolve; }));
    await settle(); const operation = jest.fn(async () => {});
    const waiting = lane.run('foreground', operation, cancelled.signal);
    cancelled.abort(); await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(operation).not.toHaveBeenCalled(); expect(lane.foregroundBusy).toBe(true);
    release(); await active; expect(lane.foregroundBusy).toBe(false);
});

test('a first encounter waits for both profiles on one lane; ready profiles and new campaigns reuse the same entries', async () => {
    const queue = new BackgroundQueue(); const cg = jest.fn(async () => result()); const fg = jest.fn(async () => faithResult());
    const culture = new CultureService(new CultureLibrary(':memory:'), cg, options, queue);
    const faith = new FaithService(new FaithLibrary(':memory:'), fg, options, queue);
    const person = character(2, 'Synthetic speaker'); const onWaiting = jest.fn();
    try {
        culture.observe({ characterId: 2, cultureId: 1, snapshot: snapshot() });
        faith.observe({ characterId: 2, faithId: 2, snapshot: faithSnapshot(), liveContext: {}, characterZealous: true });
        const state = () => [culture.prepare(person), faith.prepare(person)];
        const ready = waitForProfiles(state, new AbortController().signal, onWaiting);
        expect(state()).toEqual(['pending', 'pending']);
        await culture.tick(); await faith.tick();
        await expect(ready).resolves.toBe('ready'); expect(onWaiting).toHaveBeenCalledTimes(1);
        expect(culture.backgroundFor(person)).toBe(result().paragraph); expect(faith.backgroundFor(person)).toBe(faithResult().paragraph);
        expect(faith.zealousFor(person)).toBe(true);
        await expect(waitForProfiles(state, new AbortController().signal, onWaiting)).resolves.toBe('ready');
        expect(onWaiting).toHaveBeenCalledTimes(1);
        culture.clearObservations(); faith.clearObservations();
        expect(state()).toEqual(['unobserved', 'unobserved']);
        const next = character(2, 'Another game');
        culture.observe({ characterId: 2, cultureId: 99, snapshot: snapshot() });
        faith.observe({ characterId: 2, faithId: 99, snapshot: faithSnapshot(), liveContext: {} });
        await expect(waitForProfiles(() => [culture.prepare(next), faith.prepare(next)], new AbortController().signal)).resolves.toBe('ready');
        await culture.tick(); await faith.tick(); expect(cg).toHaveBeenCalledTimes(1); expect(fg).toHaveBeenCalledTimes(1);
    } finally { await culture.close(); await faith.close(); }
});

test('a bound pending profile survives observation expiry, but a new character object cannot inherit it', async () => {
    let now = 0;
    const service = new CultureService(new CultureLibrary(':memory:'), async () => result(), { ...options, now: () => now });
    try {
        const person = character(2, 'Bound'); service.observe({ characterId: 2, cultureId: 1, snapshot: snapshot() });
        expect(service.prepare(person)).toBe('pending'); now = 30_000;
        await service.tick(); expect(service.prepare(person)).toBe('ready');
        expect(service.prepare(character(2, 'Unbound'))).toBe('unobserved');
    } finally { await service.close(); }
});

test('failed, unavailable, timed out and cancelled preparation have bounded distinct outcomes', async () => {
    const signal = new AbortController();
    await expect(waitForProfiles(() => ['unobserved'], signal.signal)).resolves.toBe('unavailable');
    await expect(waitForProfiles(() => ['failed'], signal.signal)).resolves.toBe('failed');
    await expect(waitForProfiles(() => ['pending'], signal.signal, undefined, 0)).resolves.toBe('timeout');
    const wait = waitForProfiles(() => ['pending'], signal.signal); signal.abort();
    await expect(wait).rejects.toMatchObject({ name: 'AbortError' });
});

test('an unavailable domain does not prevent preparing the other domain for the first reply', async () => {
    let ready = false;
    const wait = waitForProfiles(() => [ready ? 'ready' : 'pending', 'unobserved'], new AbortController().signal);
    ready = true;
    await expect(wait).resolves.toBe('unavailable');
});

test('the current speaker preempts an unrelated profile while ordinary warming does not', async () => {
    const generation = jest.fn().mockImplementationOnce(() => new Promise(() => {})).mockImplementation(async input => result(input));
    const service = new CultureService(new CultureLibrary(':memory:'), generation, options);
    try {
        const other = snapshot(); other.facts[0] = { ...other.facts[0], description: 'A changed expectation.' };
        service.observe({ characterId: 1, cultureId: 1, snapshot: snapshot() });
        service.observe({ characterId: 2, cultureId: 2, snapshot: other });
        const first = service.tick(); await settle();
        expect(service.prepare(character(2, 'Warming'), false)).toBe('pending');
        expect(service.stats().pending).toBe(2);
        const speaker = character(2, 'Actual speaker'); expect(service.prepare(speaker)).toBe('pending');
        await first; await service.tick();
        expect(service.prepare(speaker)).toBe('ready'); expect(generation).toHaveBeenCalledTimes(2);
    } finally { await service.close(); }
});

test('ready anonymous library entries survive a process restart without any provider or account identifier', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-restart-'));
    const filename = path.join(directory, 'cultures.sqlite'); const cg = jest.fn(async () => result());
    let service = new CultureService(new CultureLibrary(filename), cg, options);
    try {
        service.observe({ characterId: 2, cultureId: 1, snapshot: snapshot() }); await service.tick(); await service.close();
        service = new CultureService(new CultureLibrary(filename), cg, options);
        const other = character(101, 'Unrelated account character');
        service.observe({ characterId: 101, cultureId: 99, snapshot: snapshot() });
        expect(service.prepare(other)).toBe('ready'); await service.tick(); expect(cg).toHaveBeenCalledTimes(1);
    } finally { await service.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('capture uses CE participant positions and established letter scopes, never exported IDs as historical references', () => {
    const game = { playerID: 30879, aiID: 31151, characters: new Map([
        [31151, character(31151, 'Speaker')], [30879, character(30879, 'Player')], [41111, character(41111, 'Guest')]
    ]) };
    const targets = encounterTargets(game, [41111, 30879, 31151]);
    expect(targets).toEqual([{ characterId: 41111, position: 2 }, { characterId: 30879, scope: 'root' },
        { characterId: 31151, position: 0 }]);
    const script = encounterScript({ culture: catalog() }, targets, 'a'.repeat(24));
    expect(script).not.toContain('character:');
    expect(script).toContain('position = 2'); expect(script).toContain('root = {');
    expect(encounterTargets(game, [31151, 30879], 'letter_7')).toEqual([
        { characterId: 31151, scope: 'global_var:message_second_scope_letter_7' },
        { characterId: 30879, scope: 'global_var:message_first_scope' }
    ]);
    expect(() => encounterTargets(game, [91111])).toThrow();
    expect(() => encounterTargets(game, [41111], 'letter_7')).toThrow();
    expect(() => encounterTargets(game, [31151], 'letter_7\nadd_gold = 100')).toThrow();
    expect(() => encounterScript({ culture: catalog() }, [{ characterId: 31151, scope: 'character:31151' }],
        'a'.repeat(24))).toThrow();
});

test('inline capture preserves full culture/faith probes and canonical GoA sex, traits, flags and defences without installed effects', () => {
    const script = encounterScript({ culture: catalog(), faith: faithCatalog(), goa: {
        version: 1, digest: 'a'.repeat(64), pack: 'GoA2', packIdentifiers: ['2949767945'],
        traitIds: ['creature_dryad', 'being_demon'], missingProviderIds: [], formulaMatches: {}, longLivedIds: [],
        defenceValues: { order: 'wc_Order_magic_resistance_value' }
    } }, [{ characterId: 2, position: 0 }], 'a'.repeat(24));
    expect(() => parseCk3Script(script)).not.toThrow();
    expect(script).toContain('variable = mcc_characters_list_v2 position = 0'); expect(script).not.toContain('character:2'); expect(script).toContain('has_cultural_tradition');
    expect(script).toContain('trait_is_virtue'); expect(script).toContain('trait_is_sin');
    expect(script).toContain('GetFaith.GetFlavorDesc'); expect(script).toContain('GetReligion.GetFlavorDesc');
    expect(script).toContain('has_trait = zealous'); expect(script).toContain('is_female = yes');
    expect(script).toContain('VOTC:GOA/;/count_digit/;/3/;/9');
    expect(script).toContain('value = scope:mimir_goa_trait_count');
    expect(script).not.toContain('TopScope.GetValue');
    expect(script).toContain("ScriptValue('wc_Order_magic_resistance_value')");
    expect(script).not.toContain('mimir_goa_trait_count_value'); expect(script).not.toMatch(/mimir_capture_\w+_effect = yes/);
    expect(script).not.toMatch(/(?<!local_)set_variable\s*=/); expect(script).not.toMatch(/\blog\s*=/);
    expect(() => encounterScript({ culture: catalog() }, [{ characterId: NaN, position: 0 }], 'a'.repeat(24))).toThrow();
});

describe('capture command ownership', () => {
    let directory: string; let file: string;
    beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-capture-')); fs.mkdirSync(path.join(directory, 'run')); file = path.join(directory, 'run/votc.txt'); });
    afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

    test('a receipt clears only this probe; a stale receipt cannot clear another writer or finish a later encounter', async () => {
        const capture = new EncounterCapture(() => ({ culture: catalog() }));
        const request = capture.capture(directory, [{ characterId: 2, position: 0 }], new AbortController().signal);
        const script = fs.readFileSync(file, 'utf8'); const nonce = script.match(/ack\/;\/([a-f0-9]{24})/)![1];
        capture.observe('VOTC:ENCOUNTER/;/ack/;/' + 'b'.repeat(24)); expect(fs.readFileSync(file, 'utf8')).toBe(script);
        fs.writeFileSync(file, 'pending_game_action = yes');
        capture.observe('VOTC:ENCOUNTER/;/ack/;/' + nonce); await expect(request).resolves.toBe(true);
        expect(fs.readFileSync(file, 'utf8')).toBe('pending_game_action = yes');
    });

    test('an unacknowledged gameplay command is preserved on capture timeout', async () => {
        fs.writeFileSync(file, 'unacknowledged_action = yes');
        const capture = new EncounterCapture(() => ({ culture: catalog() }));
        await expect(capture.capture(directory, [{ characterId: 2, position: 0 }], new AbortController().signal, 'votc.txt', 1)).resolves.toBe(false);
        expect(fs.readFileSync(file, 'utf8')).toBe('unacknowledged_action = yes');
        expect(fs.existsSync(path.join(directory, 'mod'))).toBe(false);
    });

    test('cancellation and campaign reset remove an owned probe without finishing the encounter', async () => {
        const capture = new EncounterCapture(() => ({ culture: catalog() })); const cancel = new AbortController();
        const request = capture.capture(directory, [{ characterId: 2, position: 0 }], cancel.signal); cancel.abort();
        await expect(request).rejects.toMatchObject({ name: 'AbortError' }); expect(fs.readFileSync(file, 'utf8')).toBe('');
        const next = capture.capture(directory, [{ characterId: 2, position: 0 }], new AbortController().signal); capture.clear();
        await expect(next).resolves.toBe(false); expect(fs.readFileSync(file, 'utf8')).toBe('');
    });

    test('startup recovers an exact abandoned probe but preserves one amended by a gameplay writer', async () => {
        const capture = new EncounterCapture(() => ({ culture: catalog() })); const cancelled = new AbortController();
        const request = capture.capture(directory, [{ characterId: 2, position: 0 }], cancelled.signal); const bytes = fs.readFileSync(file, 'utf8');
        cancelled.abort(); await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        fs.writeFileSync(file, bytes); capture.recover(directory); expect(fs.readFileSync(file, 'utf8')).toBe('');
        fs.writeFileSync(file, bytes + '\npending_game_action = yes'); capture.recover(directory);
        expect(fs.readFileSync(file, 'utf8')).toBe(bytes + '\npending_game_action = yes');
    });
});
