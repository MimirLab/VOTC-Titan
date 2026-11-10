import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeCheckpointReceiptEffect, matchesCloseCheckpointReceipt, ownsCloseCommand, waitForCloseCheckpoint } from '../../src/main/conversation/closeCheckpoint';

const expected = { nonce: '01234567-89ab-cdef-0123-456789abcdef', playerId: 1, epoch: 2, nodeId: '3-4' };
const receipt = (values = '1/;/2/;/3/;/4', nonce = expected.nonce) =>
    `[12:00:00][D][jomini_effect_impl.cpp:450]: file: run/votc.txt line: 12: VOTC:TITAN_CLOSE/;/applied/;/${nonce}/;/${values}\n`;
let directory: string, log: string, run: string;
beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-close-checkpoint-'));
    log = path.join(directory, 'debug.log'); run = path.join(directory, 'votc.txt');
    fs.writeFileSync(log, ''); fs.writeFileSync(run, '\uFEFFclose command');
});
afterEach(() => { jest.useRealTimers(); fs.rmSync(directory, { recursive: true, force: true }); });
const options = () => ({ gameLogPath: log, runFilePath: run, command: 'close command', expected,
    offset: 0, allowed: () => true, timeoutMs: 2000, pollMs: 100 });

test('a matching receipt proves the actual player, epoch and both node components', () => {
    expect(matchesCloseCheckpointReceipt(receipt(), expected)).toBe(true);
    expect(matchesCloseCheckpointReceipt('VOTC:CHECKPOINT/;/set/;/1/;/2/;/3/;/4\n', expected)).toBe(false);
});
test.each(['9/;/2/;/3/;/4', '1/;/0/;/0/;/0', '1/;/2/;/3/;/8', '4294967295/;/2/;/3/;/4',
    '1/;/2/;/3/;/4/;/extra', '1/;/2/;/3/;/4garbage'])('incorrect applied fields are rejected: %s', fields => {
    expect(matchesCloseCheckpointReceipt(receipt(fields), expected)).toBe(false);
});
test('another nonce cannot acknowledge this close', () => {
    expect(matchesCloseCheckpointReceipt(receipt(undefined, 'ffffffff-ffff-ffff-ffff-ffffffffffff'), expected)).toBe(false);
});
test('a game receipt arriving after the former half-second cutoff is still accepted', async () => {
    jest.useFakeTimers(); let settled = false;
    const result = waitForCloseCheckpoint(options()).then(value => { settled = true; return value; });
    await jest.advanceTimersByTimeAsync(700);
    expect(settled).toBe(false); expect(ownsCloseCommand(run, 'close command', () => true)).toBe(true);
    fs.appendFileSync(log, receipt()); await jest.advanceTimersByTimeAsync(100);
    expect(await result).toBe('confirmed');
});
test('old matching log content before the write cannot acknowledge a fresh publication', async () => {
    jest.useFakeTimers(); fs.writeFileSync(log, receipt());
    const result = waitForCloseCheckpoint({ ...options(), offset: fs.statSync(log).size, timeoutMs: 300 });
    await jest.advanceTimersByTimeAsync(400); expect(await result).toBe('timeout');
});
test('partial appended lines and rotated logs preserve receipt boundaries', async () => {
    jest.useFakeTimers(); fs.writeFileSync(log, 'old log'.repeat(100));
    const result = waitForCloseCheckpoint({ ...options(), offset: fs.statSync(log).size });
    const row = receipt(); fs.writeFileSync(log, row.slice(0, 60)); await jest.advanceTimersByTimeAsync(100);
    fs.appendFileSync(log, row.slice(60)); await jest.advanceTimersByTimeAsync(100);
    expect(await result).toBe('confirmed');
});
test('a replaced command or expired encounter stops the old watcher', async () => {
    fs.writeFileSync(run, '\uFEFFnew capture command');
    expect(await waitForCloseCheckpoint(options())).toBe('superseded');
    expect(ownsCloseCommand(run, 'close command', () => true)).toBe(false);
    fs.writeFileSync(run, '\uFEFFclose command');
    expect(await waitForCloseCheckpoint({ ...options(), allowed: () => false })).toBe('superseded');
    // Exact command identity still permits retracting that stale command safely.
    expect(ownsCloseCommand(run, 'close command', () => true)).toBe(true);
});
test('unreadable logs cannot produce a positive acknowledgement', async () => {
    fs.unlinkSync(log); expect(await waitForCloseCheckpoint(options())).toBe('unavailable');
});
test('the emitted evidence reads live player variables, rather than intended checkpoint constants', () => {
    const command = closeCheckpointReceiptEffect(expected.nonce);
    for (const variable of ['votc_checkpoint_epoch', 'votc_timeline_node_a', 'votc_timeline_node_b'])
        expect(command).toContain(`GetPlayer.MakeScope.Var('${variable}').GetValue|0`);
    expect(command).toContain('[GetPlayer.GetID]');
    expect(() => closeCheckpointReceiptEffect('bad"\ntrigger_event = surprise')).toThrow();
});
