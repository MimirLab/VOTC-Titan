import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { canonicalJsonStringify } from '../../src/main/promptWorkbench/canonicalJson';
import { loadLoreGameStateCatalog } from '../../src/main/lorebook/loreGameStateRuntime';

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-readonly-lore-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function put(relative: string, text: string) {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file;
}
function fixture() {
    const book = put('book.sqlite3', 'fixture accepted edition');
    const rules = [{ id: 'owned_choice', predicate: { kind: 'actor_flag', name: 'choice_recorded' }, subjects: [] }];
    const body = { format: 'titan_lore_game_state_v1', mod_version: '0.6.5', supplement_sha256: sha('fixture accepted edition'),
        source_pins: { 'events/story.txt': sha('original unchanged GoA') }, rules };
    const policy = put('policy.json', JSON.stringify({ ...body, digest: sha(canonicalJsonStringify(body)) }));
    put('mod/goa.mod', `remote_file_id="2949767945"\nversion="0.6.5"\npath="${path.join(root, 'GoA')}"`);
    put('mod/ce.mod', `remote_file_id="3654567139"\nversion="2.5.0"\npath="${path.join(root, 'CE')}"`);
    put('GoA/events/story.txt', 'original unchanged GoA');
    put('CE/gui/unchanged.gui', 'original CE');
    const load = put('dlc_load.json', JSON.stringify({ enabled_mods: ['mod/goa.mod', 'mod/ce.mod'] }));
    return { book, policy, load, read: () => loadLoreGameStateCatalog(root, policy, book) };
}
test('unchanged subscribed sources work without a Titan game mod or patched source file', () => {
    const f = fixture(), before = fs.readFileSync(path.join(root, 'GoA/events/story.txt'));
    expect(f.read()?.format).toBe('titan_lore_game_state_v1');
    expect(fs.readFileSync(path.join(root, 'GoA/events/story.txt'))).toEqual(before);
    expect(fs.existsSync(path.join(root, 'mod/votc_titan'))).toBe(false);
});
test.each(['source', 'later override', 'replace path', 'book', 'version'])('%s drift refuses stale state instead of installing overrides', kind => {
    const f = fixture();
    if (kind === 'source') put('GoA/events/story.txt', 'updated original GoA');
    if (kind === 'later override') put('CE/events/story.txt', 'different effective source');
    if (kind === 'replace path') put('mod/ce.mod', `remote_file_id="3654567139"\nreplace_path="events"\npath="${path.join(root, 'CE')}"`);
    if (kind === 'book') put('book.sqlite3', 'changed book');
    if (kind === 'version') put('mod/goa.mod', `remote_file_id="2949767945"\nversion="0.6.6"\npath="${path.join(root, 'GoA')}"`);
    expect(() => f.read()).toThrow();
    expect(fs.existsSync(path.join(root, 'mod/votc_titan'))).toBe(false);
});
test('a playset without GoA leaves this Warcraft-only adapter unavailable', () => {
    const f = fixture(); put('dlc_load.json', JSON.stringify({ enabled_mods: ['mod/ce.mod'] }));
    expect(f.read()).toBeUndefined();
});
test('other packs own their own descriptor.mod and do not override GoA metadata', () => {
    const f = fixture(), policy = JSON.parse(fs.readFileSync(f.policy, 'utf8'));
    put('GoA/descriptor.mod', 'original GoA descriptor');
    put('CE/descriptor.mod', 'independent CE descriptor');
    policy.source_pins['descriptor.mod'] = sha('original GoA descriptor');
    delete policy.digest;
    policy.digest = sha(canonicalJsonStringify(policy));
    fs.writeFileSync(f.policy, JSON.stringify(policy));
    expect(f.read()?.format).toBe('titan_lore_game_state_v1');
});
