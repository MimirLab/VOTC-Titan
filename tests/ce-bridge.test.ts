import fs from 'fs';
import os from 'os';
import path from 'path';
import { conversationCommandFile, ceCommandFile, initializeCeCommandFiles } from '../src/main/ceBridge';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-stock-ce-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function fixture(channel: string): string {
    const mod = path.join(root, 'stock CE');
    fs.mkdirSync(path.join(root, 'mod'), { recursive: true });
    fs.mkdirSync(path.join(mod, 'gui/custom_gui'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dlc_load.json'), JSON.stringify({ enabled_mods: ['mod/ce.mod'] }));
    fs.writeFileSync(path.join(root, 'mod/ce.mod'), `remote_file_id="3654567139"\npath="${mod}"`);
    const gui = path.join(mod, 'gui/custom_gui/talk_window_v2.gui');
    fs.writeFileSync(gui, `on_finish = "[ExecuteConsoleCommand('run ${channel}')]"`);
    return gui;
}
test.each(['votc.txt', 'votc_ce.txt'])('reads the actual stock CE %s runner without changing it', channel => {
    const gui = fixture(channel), before = fs.readFileSync(gui);
    expect(conversationCommandFile(root)).toBe(channel);
    expect(ceCommandFile(root, 'votc.txt')).toBe(channel);
    expect(ceCommandFile(root, 'votc_letter_actions.txt')).toBe('votc_letter_actions.txt');
    expect(fs.readFileSync(gui)).toEqual(before);
});
test('a changed upstream runner is discovered without a stale version-name table', () => {
    const gui = fixture('votc.txt');
    expect(conversationCommandFile(root)).toBe('votc.txt');
    fs.writeFileSync(gui, `on_finish = "[ExecuteConsoleCommand('run votc_ce.txt')]"`);
    expect(conversationCommandFile(root)).toBe('votc_ce.txt');
});
test.each(['../mods/override.txt', 'unknown.txt'])('refuses an unsupported command channel %s', channel => {
    fixture(channel);
    expect(() => conversationCommandFile(root)).toThrow('no supported');
});
test('legacy fixtures without a playset retain the existing command bridge', () => {
    expect(conversationCommandFile(root)).toBe('votc.txt');
});
test('letter channels follow CE declarations and startup preserves queued commands', () => {
    const gui = fixture('votc_ce.txt');
    fs.appendFileSync(gui, "\na = \"[ExecuteConsoleCommand('run votc_ce_letters.txt')]\"\nb = \"[ExecuteConsoleCommand('run votc_ce_letter_actions.txt')]\"\nc = \"[ExecuteConsoleCommand('run votc_ce_whisper.txt')]\"");
    fs.mkdirSync(path.join(root, 'run'));
    fs.writeFileSync(path.join(root, 'run/votc_ce.txt'), 'queued original action');
    const before = fs.readFileSync(gui);
    initializeCeCommandFiles(root);
    expect(ceCommandFile(root, 'letters.txt')).toBe('votc_ce_letters.txt');
    expect(ceCommandFile(root, 'votc_letter_actions.txt')).toBe('votc_ce_letter_actions.txt');
    expect(fs.readFileSync(path.join(root, 'run/votc_ce.txt'), 'utf8')).toBe('queued original action');
    expect(fs.existsSync(path.join(root, 'run/votc_ce_whisper.txt'))).toBe(true);
    expect(fs.readFileSync(gui)).toEqual(before);
    expect(fs.existsSync(path.join(root, 'mod/votc_titan'))).toBe(false);
});
