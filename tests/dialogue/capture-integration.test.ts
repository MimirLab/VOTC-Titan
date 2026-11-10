import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildDialogueCaptureCatalog, dialogueCaptureBody, DialogueLogReader } from '../../src/main/dialogue/dialogueCapture';
import { EncounterCapture, encounterScript, encounterTargets } from '../../src/main/background/EncounterCapture';
import { parseCk3Script } from '../../src/main/culture/ck3Script';
import { catalog as cultureCatalog } from '../culture/fixtures';
import { catalog as faithCatalog } from '../faith/fixtures';

let root: string;
const write = (relative: string, content: string) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-speech-capture-'));
    write('game/common/culture/placeholder.txt', '');
    write('pack/common/culture/cultures/styles.txt', 'goblin = {} naga = {} wc_dummy = {}');
    // Actual CK3 directory, independently pinned by the native-definition audit.
    write('pack/common/religion/religion_types/light.txt', 'light = { faiths = { holy_light = {} custom_light = {} } }');
    write('user/mod/goa.mod', `remote_file_id="2949767945"\npath="${path.join(root, 'pack')}"`);
    write('user/dlc_load.json', '{"enabled_mods":["mod/goa.mod"]}');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

test('effective native definitions supply exact culture and faith IDs, excluding the dummy cultural route', () => {
    const catalog = buildDialogueCaptureCatalog(path.join(root, 'game'), path.join(root, 'user'));
    expect(catalog.cultureIds).toEqual(['goblin', 'naga']); expect(catalog.faithIds).toEqual(['custom_light', 'holy_light']);
    const script = dialogueCaptureBody(catalog); expect(() => parseCk3Script(script)).not.toThrow();
    expect(script).toContain('this = culture:goblin'); expect(script).toContain('this = faith:custom_light');
    write('pack/common/culture/cultures/styles.txt', 'goblin = { ethos = changed_current_definition } naga = {}');
    expect(buildDialogueCaptureCatalog(path.join(root, 'game'), path.join(root, 'user')).digest).not.toBe(catalog.digest);
});

test('current-participant refresh uses the same owned command, ordered positions and nonce receipt without domain regeneration', async () => {
    const dialogue = buildDialogueCaptureCatalog(path.join(root, 'game'), path.join(root, 'user'));
    const file = path.join(root, 'user/run/votc.txt'); const reader = new DialogueLogReader(dialogue); let payload = '';
    const bridge = new EncounterCapture(() => ({ culture: cultureCatalog(), faith: faithCatalog(), dialogue }), () => {
        payload = fs.readFileSync(file, 'utf8');
        const nonce = /^\uFEFF# VOTC:TITAN:PROBE\/;\/([a-f0-9]{24})/.exec(payload)![1];
        // Simulated protocol receipt, not a claim that CK3 executed these predicates.
        [`VOTC:SPEECH/;/begin/;/${dialogue.digest}/;/1`,
            ...dialogue.cultureIds.flatMap(id => [`VOTC:SPEECH/;/culture/;/${id}/;/${+(id === 'goblin')}`, `VOTC:SPEECH/;/root/;/${id}/;/${+(id === 'goblin')}`]),
            ...dialogue.faithIds.map(id => `VOTC:SPEECH/;/faith/;/${id}/;/${+(id === 'holy_light')}`),
            `VOTC:SPEECH/;/end/;/${dialogue.digest}/;/1`].forEach(line => reader.observe(line));
        bridge.observe('VOTC:ENCOUNTER/;/ack/;/' + nonce);
    });
    const targets = [{ characterId: 1, scope: 'root' }];
    await expect(bridge.capture(path.join(root, 'user'), targets, new AbortController().signal, 'votc.txt', 1000, { languagesOnly: true })).resolves.toBe(true);
    expect(reader.snapshot(1)).toMatchObject({ cultureId: 'goblin', faithId: 'holy_light' });
    expect(payload).toContain('VOTC:SPEECH'); expect(payload).not.toMatch(/VOTC:CULTURE|VOTC:FAITH|VOTC:GOA/);
    expect(payload).not.toMatch(/every_living_character|every_character|set_variable|start_scheme|learn_language_of_culture/);
    expect(fs.readFileSync(file, 'utf8')).toBe('');
    const group = { playerID: 1, aiID: 2, characters: new Map([[1, {}], [2, {}], [3, {}]]) } as any;
    const script = encounterScript({ dialogue }, encounterTargets(group, [1, 2, 3]), 'a'.repeat(24));
    expect(script).toContain('position = 1'); expect(script).toContain('position = 2');
    const letter = encounterScript({ dialogue }, encounterTargets(group, [1, 2], 'letter_1'), 'b'.repeat(24));
    expect(letter).toContain('global_var:message_first_scope'); expect(letter).toContain('global_var:message_second_scope_letter_1');
});

test('capture never overwrites an occupied game-action channel and cancellation releases only its own bytes', async () => {
    const dialogue = buildDialogueCaptureCatalog(path.join(root, 'game'), path.join(root, 'user'));
    write('user/run/votc.txt', 'PLAYER_OWNED_ACTION');
    const bridge = new EncounterCapture(() => ({ dialogue })); const controller = new AbortController(); controller.abort();
    await expect(bridge.capture(path.join(root, 'user'), [{ characterId: 1, scope: 'root' }], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fs.readFileSync(path.join(root, 'user/run/votc.txt'), 'utf8')).toBe('PLAYER_OWNED_ACTION');
});
