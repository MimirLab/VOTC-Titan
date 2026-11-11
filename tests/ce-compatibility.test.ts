import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clipboard } from 'electron';
import { ClipboardListener } from '../src/main/ClipboardListener';
import { CeCompatibility } from '../src/main/ceCompatibility';
import { ceFrames, readCeRequest } from '../src/main/ceRequestLog';
import { Config } from '../src/shared/Config';
import { parseLog } from '../src/shared/gameData/parseLog';

jest.mock('electron', () => ({
    ...jest.requireActual('../__mocks__/electron.js'),
    clipboard: { readText: jest.fn(), writeText: jest.fn() },
}));
const sep = '/;/';
const campaign = ['11', '22', '33', '44'];
const record = (...fields: string[]) => fields.join(sep);
const init = (sender: string, scene: string, effect = 'log_gamedata') =>
    '[15:00:00][D][jomini_effect_impl.cpp:450]: file: common/scripted_effects/fixture.txt line: 30 (' + effect + '): ' +
    record('VOTC:IN', 'init', '100', 'Player', sender, 'Sender ' + sender, '21 Feb 583', scene,
        'Stormwind', 'Player', '0', '0', '0', '0', '0', '0', '0', '2', '1', ...campaign, '1', '0');
const memory = (sender: string, text: string) =>
    record('VOTC:IN', 'memory', sender, 'memory', '20 Feb 583', text, '1', '212822');

function incoming(slot: number, sender = String(200 + slot)) {
    const type = slot === 8 ? 'poetry_letter' : 'courtier_petition';
    const payload = [`incoming_letter_${slot}`, type, '0', '100', '2', '1', ...campaign, '1', '0'];
    return {
        payload,
        lines: [
            init(sender, '-', 'votc_log_incoming_letter_gamedata_effect'),
            memory('100', 'private player memory'),
            memory(sender, 'sent a poem'),
            record('VOTC:INCOMING_LETTER', 'context', ...payload.slice(0, 2), '21 Feb 583', sender, '0', 'sender_location=Stormwind'),
            record('VOTC:INCOMING_LETTER', 'clipboard', ...payload),
        ],
    };
}

let root: string;
let config: Config;
let log: string;
const run = (name: string) => path.join(root, 'run', name);
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-ce-lanes-'));
    const mod = path.join(root, 'ce');
    fs.mkdirSync(path.join(mod, 'gui'), { recursive: true });
    fs.mkdirSync(path.join(root, 'mod'));
    fs.mkdirSync(path.join(root, 'logs'));
    fs.mkdirSync(path.join(root, 'run'));
    log = path.join(root, 'logs/debug.log');
    fs.writeFileSync(path.join(root, 'dlc_load.json'), JSON.stringify({ enabled_mods: ['mod/ce.mod'] }));
    fs.writeFileSync(path.join(root, 'mod/ce.mod'), `remote_file_id="3654567139"\npath="${mod}"`);
    const files = ['votc_ce_whisper.txt', 'votc_ce_npcltr.txt', 'votc_ce_letters.txt', 'battle_report3.txt',
        ...Array.from({length: 8}, (_, i) => `votc_ce_incomingletter_v2_${i + 1}.txt`)];
    fs.writeFileSync(path.join(mod, 'gui/runners.gui'),
        files.map(file => `on_finish = "[ExecuteConsoleCommand('run ${file}')]"\n`).join(''));
    config = {
        userFolderPath: root,
        language: 'en',
        textGenerationApiConnectionConfig: { connection: { type: 'custom', baseURL: 'http://127.0.0.1:1/v1', model: 'fixture' }, parameters: {} },
    } as unknown as Config;
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test.each(['WHISPER', 'INCOMING_LETTER', 'BATTLE_REPORT', 'IN', 'LETTER', 'LETTER_ACCEPTED'])('routes %s and restores the clipboard', command => {
    const read = jest.mocked(clipboard.readText);
    const write = jest.mocked(clipboard.writeText);
    read.mockReturnValue('previous');
    const listener = new ClipboardListener();
    const receive = jest.fn();
    listener.on('VOTC:' + command, receive);
    read.mockReturnValue(`VOTC:${command}/;/request`);
    listener.readClipboard();
    expect(receive).toHaveBeenCalledTimes(1);
    if (['WHISPER', 'INCOMING_LETTER', 'BATTLE_REPORT'].includes(command)) expect(receive).toHaveBeenCalledWith(['request']);
    expect(write).toHaveBeenLastCalledWith('previous');
});

test('all eight slots bind to their own sender and accept CE zero-valued delivery IDs', async () => {
    const letters = Array.from({length: 8}, (_, i) => incoming(i + 1));
    fs.writeFileSync(log, letters.flatMap(letter => letter.lines).join('\n') + '\n');
    fs.writeFileSync(run('votc_ce_letters.txt'), 'existing ordinary letter');
    const model = jest.fn(async (prompt: string) => {
        expect(prompt).not.toContain('private player memory');
        return 'Greetings [GetPlayer.GetID] "$test$"';
    });
    const bridge = new CeCompatibility(model);
    await Promise.all(letters.map(letter => bridge.dispatch('VOTC:INCOMING_LETTER', letter.payload, config, root)));
    expect(model).toHaveBeenCalledTimes(8);
    for (let i = 1; i <= 8; i++) {
        const name = `votc_ce_incomingletter_v2_${i}.txt`;
        const probe = fs.readFileSync(run(name), 'utf8');
        expect(probe).not.toContain('create_artifact');
        const receipt = probe.match(/VOTC:CE_COMPAT\/;\/ready\/;\/[^/]+\/;\/([a-f\d-]+)/)![1];
        bridge.observeLog(record('VOTC:CE_COMPAT', 'ready', name, receipt));
        const script = fs.readFileSync(run(name), 'utf8');
        expect(script).toContain(`exists = global_var:votc_incoming_letter_sender_${i}`);
        expect(script).toContain(`var:votc_incoming_letter_${i}_delivery_id = 0`);
        expect(script).toContain(`NOT = { has_variable = votc_incoming_letter_${i}_timer }`);
        expect(script).toContain('［GetPlayer.GetID］ ”＄test＄”');
        bridge.observeLog(record('VOTC:CE_COMPAT', 'applied', name, 'unrelated'));
        expect(fs.readFileSync(run(name), 'utf8')).toBe(script);
        bridge.observeLog(record('VOTC:CE_COMPAT', 'applied', name, receipt));
        expect(fs.readFileSync(run(name), 'utf8').trim()).toBe('');
    }
    expect(fs.readFileSync(run('votc_ce_letters.txt'), 'utf8')).toBe('existing ordinary letter');
    await bridge.dispatch('VOTC:INCOMING_LETTER', letters[0].payload, config, root);
    expect(model).toHaveBeenCalledTimes(8);
});

test('rejects old, crossed-campaign or overwritten incoming requests', () => {
    const letter = incoming(8);
    const frames = ceFrames(letter.lines.join('\n'));
    expect(readCeRequest(frames, 'VOTC:INCOMING_LETTER', letter.payload)).toMatchObject({ sender: '208', sentDay: 212846 });
    const wrongCampaign = letter.payload.map((value, i) => i === 6 ? '12' : value);
    expect(readCeRequest(frames, 'VOTC:INCOMING_LETTER', wrongCampaign)).toBeUndefined();
    expect(readCeRequest(ceFrames([...letter.lines, 'VOTC:CAMPAIGN/;/loaded/;/new'].join('\n')),
        'VOTC:INCOMING_LETTER', letter.payload)).toBeUndefined();
    expect(readCeRequest(ceFrames([...letter.lines, record('VOTC:INCOMING_LETTER', 'clipboard', ...wrongCampaign)].join('\n')),
        'VOTC:INCOMING_LETTER', letter.payload)).toBeUndefined();
});

test('Whisper reads only its section and abandons generation on campaign change', async () => {
    const character = (id: string, role: string) => {
        const row = Array(29).fill('');
        [row[0], row[1], row[2], row[4], row[27]] = ['VOTC:IN', 'character', id, 'Witness ' + id, role];
        return row.join(sep);
    };
    fs.writeFileSync(log, [
        init('100', 'flag:whisper_ledger'),
        character('200', 'whisper_foreign'), character('201', 'whisper_court'),
        memory('200', 'Trade envoys arrived'), memory('201', 'private court memory'),
        record('VOTC:WHISPER', '6|WORLD', '212821', '4', ''),
    ].join('\n') + '\n');
    let complete!: (value: string) => void;
    let started!: () => void;
    const modelStarted = new Promise<void>(resolve => { started = resolve; });
    const model = jest.fn((prompt: string) => {
        expect(prompt).toContain('Trade envoys arrived');
        expect(prompt).not.toContain('private court memory');
        started();
        return new Promise<string>(resolve => { complete = resolve; });
    });
    const bridge = new CeCompatibility(model);
    const task = bridge.dispatch('VOTC:WHISPER', [], config, root);
    await modelStarted;
    bridge.reset();
    complete('Stale reply');
    await task;
    expect(fs.existsSync(run('votc_ce_whisper.txt'))).toBe(false);

    const ready = new CeCompatibility(async () => 'Verified dispatch.');
    await ready.dispatch('VOTC:WHISPER', [], config, root);
    const script = fs.readFileSync(run('votc_ce_whisper.txt'), 'utf8');
    expect(script).toContain('global_var:votc_whisper_req_id = 4');
    expect(script).toContain('trigger_event = votc_whisper.30');
    expect(script).not.toContain('votc_latest_letter');
});

test('NPC initiative and ordinary letters are distinguished despite the shared clipboard token', async () => {
    const npc = [
        init('200', 'flag:talk_letter', 'votc_ce_initiative_letter'),
        record('VOTC:IN', 'letter_payload', 'friend'),
        ...incoming(1).lines,
    ];
    fs.writeFileSync(log, npc.join('\n') + '\n');
    const model = jest.fn(async () => 'Greetings, friend.');
    const bridge = new CeCompatibility(model);
    expect(await bridge.dispatch('VOTC:LETTER', [], config, root)).toBe(true);
    expect(fs.readFileSync(run('votc_ce_npcltr.txt'), 'utf8')).toContain('trigger_event = votc_ce_initiative.152');
    fs.appendFileSync(log, init('199', 'flag:talk_letter') + '\n' + record('VOTC:LETTER', 'A request', 'letter_1', '212821') + '\n');
    expect(await bridge.dispatch('VOTC:LETTER', [], config, root)).toBe(false);
    expect(model).toHaveBeenCalledTimes(1);
});

test('battle reports use the matching numbered runner, without a model call', async () => {
    fs.writeFileSync(log, [
        init('200', 'flag:castle'),
        record('VOTC:BATTLE_REPORT', 'init', '100', '21 Feb 583', '15', 'battle_report_3'),
        record('VOTC:BATTLE_REPORT', 'init_location', 'Elwynn'),
        record('VOTC:BATTLE_REPORT', 'init_winner', '100', 'Stormwind'),
        record('VOTC:BATTLE_REPORT', 'init_loser', '200', 'Defeated host'),
        record('VOTC:BATTLE_REPORT', 'result', 'victory'),
    ].join('\n') + '\n');
    const model = jest.fn();
    const bridge = new CeCompatibility(model);
    await bridge.dispatch('VOTC:BATTLE_REPORT', [], config, root);
    const script = fs.readFileSync(run('battle_report3.txt'), 'utf8');
    expect(script).toContain('var:votc_battle_report_3_sent_day = 212846');
    expect(script).toContain('at Elwynn, Stormwind defeated Defeated host');
    expect(model).not.toHaveBeenCalled();
});

test('conversation parsing skips CE background snapshots in later log chunks', async () => {
    fs.writeFileSync(log, [
        init('199', 'flag:castle'), 'x'.repeat(525_000), init('100', 'flag:whisper_ledger'),
        ...incoming(1).lines, init('203', 'flag:talk_letter', 'votc_ce_initiative_letter'),
    ].join('\n') + '\n');
    expect((await parseLog(log))?.aiID).toBe(199);
});


test('an in-transit letter parks the response and resumes it without another model call', async () => {
    const letter = incoming(8);
    fs.writeFileSync(log, letter.lines.join('\n') + '\n');
    const model = jest.fn(async () => 'The original letter body.');
    const beforeRestart = new CeCompatibility(model);
    await beforeRestart.dispatch('VOTC:INCOMING_LETTER', letter.payload, config, root);
    const name = 'votc_ce_incomingletter_v2_8.txt';
    const probe = fs.readFileSync(run(name), 'utf8');
    const receipt = probe.match(/VOTC:CE_COMPAT\/;\/ready\/;\/[^/]+\/;\/([a-f\d-]+)/)![1];
    jest.useFakeTimers();
    try {
        beforeRestart.observeLog(record('VOTC:CE_COMPAT', 'waiting', name, receipt));
        expect(fs.readFileSync(run(name), 'utf8').trim().split('\n')).toHaveLength(1);
        const afterRestart = new CeCompatibility(model);
        afterRestart.resume(root);
        expect(fs.readFileSync(run(name), 'utf8')).toBe(probe);
        afterRestart.observeLog(record('VOTC:CE_COMPAT', 'ready', name, receipt));
        expect(fs.readFileSync(run(name), 'utf8')).toContain('The original letter body.');
        afterRestart.observeLog(record('VOTC:CE_COMPAT', 'applied', name, receipt));
        jest.advanceTimersByTime(10_001);
        expect(fs.readFileSync(run(name), 'utf8').trim()).toBe('');
        expect(model).toHaveBeenCalledTimes(1);
    } finally {
        jest.useRealTimers();
    }
});
