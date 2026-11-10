import fs from 'fs';
import os from 'os';
import path from 'path';
import { Config } from '../../src/shared/Config';
import { character } from '../culture/fixtures';
import { initializeCultureRuntime, closeCultureRuntime, captureCurrentLanguages, captureRoleplayEncounter, observeEncounterLine } from '../../src/main/culture/cultureRuntime';
import { currentDevelopment } from '../../src/main/development/developmentRuntime';
import { DEVELOPMENT_DIGEST } from '../../src/main/development/developmentCapture';

let root: string, age: string, frames: boolean, probes: string[];
const player = character(1, 'Player'), writer = character(2, 'Writer');
const game = { playerID: 1, aiID: 2, characters: new Map([[1, player], [2, writer]]) } as any;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-development-')); age = '7'; frames = true; probes = [];
    const config = Object.assign(Object.create(Config.prototype), JSON.parse(fs.readFileSync('default_userdata/configs/default_config.json', 'utf8')),
        { userFolderPath: root, cultureGameInstallPath: '', cultureRoleplayEnabled: false, faithRoleplayEnabled: false, goaLoreEnabled: false, languageRoutingEnabled: false, audio: { enabled: false } });
    initializeCultureRuntime(config, path.join(root, 'data'), null, () => false, () => {
        for (const file of ['votc.txt', 'votc_letter_actions.txt']) {
            const p = path.join(root, 'run', file); if (!fs.existsSync(p)) continue;
            const script = fs.readFileSync(p, 'utf8'), nonce = script.match(/VOTC:TITAN:PROBE\/;\/([a-f0-9]{24})/); if (!nonce) continue;
            probes.push(script);
            if (frames) for (const id of [1, 2]) for (const row of [`begin/;/${DEVELOPMENT_DIGEST}/;/${id}`, `age/;/${age}`, `adult/;/${age === '7' ? '0' : '1'}`, `end/;/${DEVELOPMENT_DIGEST}/;/${id}`]) observeEncounterLine('VOTC:DEVELOPMENT/;/' + row);
            observeEncounterLine('VOTC:ENCOUNTER/;/ack/;/' + nonce[1]);
        }
    });
});
afterEach(async () => { await closeCultureRuntime(); fs.rmSync(root, { recursive: true, force: true }); });
test('actual shared refresh works without Audio, languages, culture or GoA, updates the same encounter and preserves letter scope direction', async () => {
    const original = JSON.stringify(writer), signal = new AbortController().signal;
    for (const next of ['7', '16', '19', '20+', '7']) {
        age = next; expect(await captureCurrentLanguages([player, writer], signal, game)).toBe(true);
        expect(currentDevelopment(writer)?.age).toBe(next === '20+' ? next : Number(next));
    }
    expect(probes).toHaveLength(5); expect(JSON.stringify(writer)).toBe(original);
    expect(probes[0]).toContain('root = {'); expect(probes[0]).toContain('position = 1');
    expect(probes[0]).not.toMatch(/VOTC:(MATURITY|CLONE|LANGUAGE|SPEECH|GOA)|every_(?:living_)?character\s*=|set_variable/);
    expect(await captureRoleplayEncounter([player, writer], signal, game, 'letter_2')).toBe(true);
    expect(probes[5]).toContain('global_var:message_second_scope_letter_2'); expect(probes[5]).not.toContain('position =');
});
test('ACK without a complete frame invalidates the prior binding and reports a repairable failure', async () => {
    await captureCurrentLanguages([writer], new AbortController().signal, game); expect(currentDevelopment(writer)).toBeDefined();
    frames = false;
    await expect(captureCurrentLanguages([writer], new AbortController().signal, game)).rejects.toThrow('Current character age capture');
    expect(currentDevelopment(writer)).toBeUndefined();
});
test('cancellation preserves an existing gameplay command and writes no development probe over it', async () => {
    fs.mkdirSync(path.join(root, 'run'), { recursive: true }); const file = path.join(root, 'run/votc.txt'); fs.writeFileSync(file, 'GAMEPLAY OWNED');
    await expect(captureCurrentLanguages([writer], AbortSignal.timeout(20), game)).rejects.toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('GAMEPLAY OWNED'); expect(probes).toHaveLength(0);
});
