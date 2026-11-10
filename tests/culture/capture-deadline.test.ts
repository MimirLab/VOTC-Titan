import fs from 'fs';
import os from 'os';
import path from 'path';
import { EncounterCapture } from '../../src/main/background/EncounterCapture';
import * as readiness from '../../src/main/background/profileReadiness';
import { catalog } from './fixtures';

let directory: string, file: string, now: number;
beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-delayed-capture-'));
    fs.mkdirSync(path.join(directory, 'run')); file = path.join(directory, 'run/votc.txt'); now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.spyOn(readiness, 'abortableDelay').mockImplementation(async () => { now = 15001; });
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });

test('a delayed event-loop wake reads the matching game receipt before declaring capture timed out', async () => {
    let flushes = 0;
    const bridge = new EncounterCapture(() => ({ culture: catalog() }), () => {
        flushes++;
        if (now < 15000) return;
        const nonce = fs.readFileSync(file, 'utf8').match(/ack\/;\/([a-f0-9]{24})/)![1];
        bridge.observe('VOTC:ENCOUNTER/;/ack/;/' + nonce);
    });
    await expect(bridge.capture(directory, [{ characterId: 2, position: 0 }], new AbortController().signal)).resolves.toBe(true);
    expect(flushes).toBe(2); expect(fs.readFileSync(file, 'utf8')).toBe('');
});

test('the final read still rejects a stale receipt and preserves gameplay bytes', async () => {
    const bridge = new EncounterCapture(() => ({ culture: catalog() }), () => {
        if (now < 15000) return;
        fs.writeFileSync(file, 'PLAYER_ACTION');
        bridge.observe('VOTC:ENCOUNTER/;/ack/;/' + 'b'.repeat(24));
    });
    await expect(bridge.capture(directory, [{ characterId: 2, position: 0 }], new AbortController().signal)).resolves.toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('PLAYER_ACTION');
});

test('cancellation during the final read cannot complete a late capture', async () => {
    const controller = new AbortController();
    const bridge = new EncounterCapture(() => ({ culture: catalog() }), () => { if (now >= 15000) controller.abort(); });
    await expect(bridge.capture(directory, [{ characterId: 2, position: 0 }], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fs.readFileSync(file, 'utf8')).toBe('');
});

test.each(['valid', 'wrong actor', 'wrong nonce', 'duplicate'])('numeric clock works with lore disabled and rejects %s cross-binding', mode => {
    let emitted = false;
    const bridge = new EncounterCapture(() => ({ clock: true }), () => {
        if (emitted || !fs.existsSync(file)) return;
        const text = fs.readFileSync(file, 'utf8');
        const match = text.match(/ack\/;\/([a-f0-9]{24})/);
        if (!match) return;
        emitted = true;
        const nonce = match[1];
        const clock = 'VOTC:ENCOUNTER/;/clock/;/' + (mode === 'wrong nonce' ? 'b'.repeat(24) : nonce) + '/;/' +
            (mode === 'wrong actor' ? '9' : '1') + '/;/212796/;/583/;/1/;/1';
        bridge.observe(clock);
        if (mode === 'duplicate') bridge.observe(clock);
        bridge.observe('VOTC:ENCOUNTER/;/ack/;/' + nonce);
    });
    return bridge.capture(directory, [{ characterId: 1, scope: 'root' }], new AbortController().signal).then(ok => {
        expect(ok).toBe(true);
        if (mode === 'valid') expect(bridge.lastGameDate).toEqual({ totalDays: 212796, year: 583, month: 1, day: 1, display: '583.1.1' });
        else expect(bridge.lastGameDate).toBeUndefined();
        expect(fs.readFileSync(file,'utf8')).toBe('');
    });
});
