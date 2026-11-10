import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { canonicalJsonStringify } from '../../src/main/promptWorkbench/canonicalJson';
import { loadLoreMutationCatalog } from '../../src/main/lorebook/loreMutationRuntime';

const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
let root: string;
const put = (relative: string, text: string): string => {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file;
};
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-mutation-catalogue-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function fixture() {
    const original = 'sample.1 = { option = { add_gold = 1 } }';
    const patched = 'sample.1 = { option = { add_gold = 1 record_source = yes } }';
    const callback = 'base.1 = { immediate = { add_prestige = 1 } }';
    const patchedCallback = 'base.1 = { immediate = { add_prestige = 1 record_callback = yes } }';
    put('goa/descriptor.mod', 'version = "0.6.5"');
    put('goa/events/sample.txt', original);
    put('goa/common/scripted_effects/support.txt', 'support_effect = { add_gold = 1 }');
    put('titan/events/sample.txt', patched);
    put('game/events/base.txt', callback); put('titan/events/base.txt', patchedCallback);
    fs.mkdirSync(path.join(root, 'game/common/culture'), { recursive: true });
    put('user/mod/goa.mod', `path = "${path.join(root, 'goa')}" remote_file_id = "2949767945" version = "0.6.5"`);
    put('user/mod/titan.mod', `path = "${path.join(root, 'titan')}"`);
    put('user/mod/later.mod', `path = "${path.join(root, 'later')}"`);
    fs.mkdirSync(path.join(root, 'later'), { recursive: true });
    put('user/dlc_load.json', JSON.stringify({ enabled_mods: ['mod/goa.mod', 'mod/titan.mod', 'mod/later.mod'] }));
    const book = put('book.sqlite3', 'fixture book bytes; file binding only, not a reader fixture');
    const policy: any = { version: 1, mod_version: '0.6.5', supplement_sha256: hash(fs.readFileSync(book)),
        source_pins: { 'descriptor.mod': hash('version = "0.6.5"'), 'events/sample.txt': hash(original),
            'common/scripted_effects/support.txt': hash('support_effect = { add_gold = 1 }') },
        base_source_pins: { 'events/base.txt': hash(callback) },
        patch_pins: { 'events/sample.txt': hash(patched), 'events/base.txt': hash(patchedCallback) },
        memory_owner_policies: ['ordinary'], points: [{ token: 'tlm_' + 'a'.repeat(24), definition: 'sample.1', path: 'events/sample.txt', source_origin: 'goa' }],
        auxiliary_definitions: [{ definition: 'base.1', path: 'events/base.txt', source_origin: 'base_game' },
            { definition: 'support_effect', path: 'common/scripted_effects/support.txt', source_origin: 'goa' }] };
    const file = put('policy.json', '{}');
    const seal = () => { delete policy.digest; policy.digest = hash(canonicalJsonStringify(policy)); fs.writeFileSync(file, JSON.stringify(policy)); };
    seal();
    const load = () => loadLoreMutationCatalog(path.join(root, 'user'), file, book, path.join(root, 'game'));
    return { policy, seal, file, book, load };
}

test('the exact source, base callback, effective patch and book bind one active catalogue', () => {
    const f = fixture(); expect(f.load()!.digest).toBe(f.policy.digest);
});
test('an upstream Workshop edit withdraws access even while the old patch is still installed', () => {
    const f = fixture(); put('goa/events/sample.txt', 'sample.1 = { option = { add_gold = 2 } }');
    expect(f.load).toThrow('GoA mutation source changed');
});
test('an updated base-game callback cannot be shadowed by a stale observer', () => {
    const f = fixture(); put('game/events/base.txt', 'base.1 = { immediate = { add_prestige = 2 } }');
    expect(f.load).toThrow('Base-game lore callback changed');
});
test('a missing active patch cannot be mistaken for an installed hook', () => {
    const f = fixture(); fs.unlinkSync(path.join(root, 'titan/events/sample.txt'));
    expect(f.load).toThrow('active GoA lore mutation patch differs');
});
test('a later same-ID definition in a different file is an override too', () => {
    const f = fixture(); put('later/events/another.txt', 'sample.1 = { option = { add_gold = 999 } }');
    expect(f.load).toThrow('overrides a lore mutation definition');
});
test('a mod between GoA and Titan must not have its same-path story changes silently shadowed', () => {
    const f = fixture(); put('later/events/sample.txt', 'sample.1 = { option = { add_gold = 999 } }');
    put('user/dlc_load.json', JSON.stringify({ enabled_mods: ['mod/goa.mod', 'mod/later.mod', 'mod/titan.mod'] }));
    expect(f.load).toThrow('changes a copied GoA story file');
});
test('a supporting helper override cannot silently change the observed outcome', () => {
    const f = fixture(); put('later/common/scripted_effects/support.txt', 'support_effect = { add_gold = 999 }');
    expect(f.load).toThrow('supporting GoA mutation definition changed');
});
test('a pre-GoA mod changing a base callback must be preserved, not overwritten unnoticed', () => {
    const f = fixture(); put('earlier/events/base.txt', 'base.1 = { immediate = { add_prestige = 999 } }');
    put('user/mod/earlier.mod', `path = "${path.join(root, 'earlier')}"`);
    put('user/dlc_load.json', JSON.stringify({ enabled_mods: ['mod/earlier.mod', 'mod/goa.mod', 'mod/titan.mod'] }));
    expect(f.load).toThrow('active mod changes the required base-game callback');
});
test('a different book or edited policy cannot reuse the old provenance', () => {
    const f = fixture(); fs.writeFileSync(f.book, 'another book'); expect(f.load).toThrow('book edition');
});
test('a source path escape is rejected even in a newly sealed policy', () => {
    const f = fixture(); f.policy.source_pins['../foreign'] = hash('x'); f.seal();
    expect(f.load).toThrow('Invalid lore mutation source path');
});
test('base callback verification requires the actual selected game installation', () => {
    const f = fixture();
    expect(() => loadLoreMutationCatalog(path.join(root, 'user'), f.file, f.book)).toThrow('current game source');
});
