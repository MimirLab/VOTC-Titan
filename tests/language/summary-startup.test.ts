import fs from 'fs';
import os from 'os';
import path from 'path';
import { getPlayerId } from '../../src/main/summaryManager';

let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-summary-startup-')); });
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });

test('a missing or empty summary store is ordinary first-run state', async () => {
    const log = jest.spyOn(console, 'error');
    expect(await getPlayerId(directory)).toBeUndefined();
    fs.mkdirSync(path.join(directory, 'conversation_summaries'));
    expect(await getPlayerId(directory)).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
});

test('legacy lookup retains the most recently observed numeric player directory', async () => {
    const summary = path.join(directory, 'conversation_summaries');
    for (const [name, seconds] of [['11', 10], ['22', 20], ['notes', 30]] as const) {
        const folder = path.join(summary, name); fs.mkdirSync(folder, { recursive: true });
        fs.utimesSync(folder, seconds, seconds);
    }
    fs.writeFileSync(path.join(summary, '33'), 'not a player directory');
    expect(await getPlayerId(directory)).toEqual({ playerId: '22' });
});

test('real filesystem failures remain actionable instead of becoming an empty store', async () => {
    const error = Object.assign(new Error('Read denied'), { code: 'EACCES' });
    jest.spyOn(fs, 'readdirSync').mockImplementation(() => { throw error; });
    await expect(getPlayerId(directory)).rejects.toBe(error);
});
