import fs from 'fs';
import os from 'os';
import path from 'path';
import { LoreGameStateCatalog, LoreGameStateReader, loreGameStateCaptureBody } from '../../src/main/lorebook/loreGameStateCapture';
import { EncounterCapture } from '../../src/main/background/EncounterCapture';

const catalog: LoreGameStateCatalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../../tools/lorebook-game-state-catalogue.json'), 'utf8'));
function frame(actor = 7, values: Record<string, string> = {}): string[] {
    return [`VOTC:LORE_STATE/;/begin/;/1/;/${catalog.digest}/;/${actor}/;/212796/;/583/;/1/;/1`,
        ...catalog.rules.map(rule => `VOTC:LORE_STATE/;/value/;/${rule.id}/;/${values[rule.id] ?? 'unknown'}`),
        `VOTC:LORE_STATE/;/end/;/${catalog.digest}/;/${actor}`];
}
test('current world state is separate from character-owned account traces', () => {
    const reader = new LoreGameStateReader(catalog);
    frame(7, { horde_invasion_started: '1', refugee_course_northrend: '1' }).forEach(line => reader.observe(line));
    expect(reader.snapshots.get(7)?.values).toMatchObject({ horde_invasion_started: true, refugee_course_northrend: true, suramar_open: null });
    expect(catalog.rules.filter(rule => rule.account)).toHaveLength(9);
    expect(catalog.rules.filter(rule => rule.account).every(rule => rule.predicate.kind.startsWith('actor_'))).toBe(true);
});
test.each(['missing end', 'missing value', 'duplicate', 'unknown key', 'wrong edition', 'wrong actor', 'future-looking invalid date'])
('a %s frame cannot authorize state', kind => {
    const reader = new LoreGameStateReader(catalog), lines = frame();
    if (kind === 'missing end') lines.pop();
    if (kind === 'missing value') lines.splice(2, 1);
    if (kind === 'duplicate') lines.splice(2, 0, lines[1]);
    if (kind === 'unknown key') lines[1] = 'VOTC:LORE_STATE/;/value/;/invented/;/1';
    if (kind === 'wrong edition') lines[0] = lines[0].replace(catalog.digest, 'f'.repeat(64));
    if (kind === 'wrong actor') lines[lines.length - 1] = lines[lines.length - 1].replace('/;/7', '/;/8');
    if (kind === 'future-looking invalid date') lines[0] = lines[0].replace('/;/1/;/1', '/;/13/;/40');
    lines.forEach(line => reader.observe(line));
    expect(reader.snapshots.size).toBe(0);
});
test('a new incomplete read withdraws prior state; missing and absent do not confirm a past alternative', () => {
    const reader = new LoreGameStateReader(catalog);
    frame(7, { refugee_course_northrend: '0' }).forEach(line => reader.observe(line));
    expect(reader.snapshots.get(7)?.values.refugee_course_northrend).toBe(false);
    expect(reader.snapshots.get(7)?.values.refugee_course_pandaria).toBeNull();
    reader.observe(frame()[0]);
    expect(reader.snapshots.has(7)).toBe(false);
});
test('read-only probes need no installed Titan helper or event definition', () => {
    const body = loreGameStateCaptureBody(catalog);
    expect(body).not.toMatch(/(?:create_character_memory|set_global_variable|set_variable|add_character_flag|trigger_event|titan_log|titan_record|on_action)\s*=/);
    expect(body).toContain('has_character_flag = refused_destroy_dark_portal_flag');
    expect(body).toContain('has_variable = my_destination_1');
    expect(body).toContain('/;/unknown');
    expect(body).toContain('else_if = { limit = { global_var:suramar_barrier_lowered_variable = no }');
});
test('a world-state predicate cannot acquire private branch knowledge', () => {
    const changed = structuredClone(catalog), rule = changed.rules.find(rule => rule.account)!;
    rule.predicate = { kind: 'global_exists', name: 'world_flag' };
    expect(() => new LoreGameStateReader(changed)).toThrow('cannot grant private');
});
test('mutually exclusive saved destinations cannot both authorize accounts', () => {
    const reader = new LoreGameStateReader(catalog);
    frame(7, { refugee_course_northrend: '1', refugee_course_pandaria: '1' }).forEach(line => reader.observe(line));
    expect(reader.snapshots.has(7)).toBe(false);
});
test('the existing per-reply probe carries state through stock CE without game-file writes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-ce-state-'));
    try {
        const mod = path.join(root, 'CE');
        fs.mkdirSync(path.join(root, 'mod'), { recursive: true });
        fs.mkdirSync(path.join(mod, 'gui/custom_gui'), { recursive: true });
        fs.writeFileSync(path.join(root, 'mod/ce.mod'), `remote_file_id="3654567139"\npath="${mod}"`);
        fs.writeFileSync(path.join(root, 'dlc_load.json'), JSON.stringify({ enabled_mods: ['mod/ce.mod'] }));
        const gui = path.join(mod, 'gui/custom_gui/talk_window_v2.gui');
        fs.writeFileSync(gui, `on_finish = "[ExecuteConsoleCommand('run votc_ce.txt')]"`);
        const before = fs.readFileSync(gui), reader = new LoreGameStateReader(catalog);
        let sent = '', capture: EncounterCapture;
        capture = new EncounterCapture(() => ({ loreGameState: catalog }), () => {
            const file = path.join(root, 'run/votc_ce.txt');
            if (!fs.existsSync(file)) return;
            const body = fs.readFileSync(file, 'utf8');
            const nonce = /VOTC:ENCOUNTER\/;\/ack\/;\/([a-f0-9]{24})/.exec(body)?.[1];
            if (!nonce) return;
            sent = body;
            frame(7, { refugee_course_northrend: '1' }).forEach(line => reader.observe(line));
            capture.observe('VOTC:ENCOUNTER/;/ack/;/' + nonce);
        });
        expect(await capture.capture(root, [{ characterId: 7, scope: 'root' }], new AbortController().signal,
            'votc.txt', 1000, { languagesOnly: true })).toBe(true);
        expect(sent).toContain('VOTC:LORE_STATE/;/begin');
        expect(reader.snapshots.get(7)?.values.refugee_course_northrend).toBe(true);
        expect(fs.readFileSync(gui)).toEqual(before);
        expect(fs.existsSync(path.join(root, 'run/votc.txt'))).toBe(false);
        expect(fs.readFileSync(path.join(root, 'run/votc_ce.txt'), 'utf8')).toBe('');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
