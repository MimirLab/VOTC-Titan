import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { catalogFromFiles, buildCultureCatalog } from '../../src/main/culture/cultureCatalog';
import { parseCk3Script } from '../../src/main/culture/ck3Script';
import { cultureCaptureEffect, cultureObserverGui, extendCharacterExporter, writeCultureAddon } from '../../src/main/culture/cultureBridge';
import { cultureHash, cultureInput } from '../../src/main/culture/cultureIdentity';
import { catalog, snapshot } from './fixtures';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'votc-catalog-test-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
function write(relative: string, content: string): void {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
}
function base(): void {
    write('game/common/culture/pillars/base.txt', 'custom_ethos = { type = ethos }');
    write('game/common/culture/traditions/base.txt', 'custom_tradition = { parameters = { peculiar_custom = yes } }');
    write('game/localization/english/custom_l_english.yml', 'l_english:\n custom_tradition_name:0 "Original custom"\n custom_tradition_desc:0 "A belief in patient cooperation."\n culture_parameter_peculiar_custom:0 "$other_rule$"\n other_rule:0 "Respects [patient|E] people."');
    write('user/dlc_load.json', JSON.stringify({ enabled_mods: [] }));
}

test('script lexer handles comments, quoted hashes/braces, duplicates, conditions and lists', () => {
    const parsed = parseCk3Script('key = { desc = "a # { quoted \\\"word\\\"" # comment\n flag = yes flag = no values = { one two } test >= 3 }');
    const entries = parsed[0].value as any[];
    expect(entries[0].value).toBe('a # { quoted "word"');
    expect(entries.filter(e => e.key === 'flag')).toHaveLength(2);
    expect(entries.find(e => e.key === 'test').operator).toBe('>=');
    expect(() => parseCk3Script('broken = { a = yes')).toThrow();
});

test('arbitrary mod definitions, localization references and conditions supply meanings', () => {
    base();
    const c = buildCultureCatalog(path.join(root, 'game'), path.join(root, 'user'));
    const custom = c.facts.find(f => f.kind === 'tradition')!;
    expect(custom.name).toBe('Original custom'); expect(custom.description).toContain('patient cooperation');
    expect(custom.rules).toContain('Respects patient people');
    expect(c.facts.some(f => f.key === 'custom_ethos')).toBe(true);
});

test('launcher order, file overrides, localization replace and replace_path take effect', () => {
    base();
    write('first/common/culture/traditions/base.txt', 'first_custom = { parameters = { first_rule = yes } }');
    write('second/common/culture/traditions/second.txt', 'second_custom = { character_modifier = { ai_boldness = 12 } }');
    write('second/localization/english/replace/override.yml', 'l_english:\n second_custom_name:0 "Overhaul custom"\n second_custom_desc:0 "Honors audacity."');
    write('user/mod/first.mod', `path="${path.join(root, 'first')}"`);
    write('user/mod/second.mod', `path="${path.join(root, 'second')}"\nreplace_path="common/culture/traditions"`);
    write('user/dlc_load.json', JSON.stringify({ enabled_mods: ['mod/first.mod', 'mod/second.mod'] }));
    const c = buildCultureCatalog(path.join(root, 'game'), path.join(root, 'user'));
    expect(c.facts.filter(f => f.kind === 'tradition').map(f => f.key)).toEqual(['second_custom']);
    expect(c.facts.find(f => f.key === 'second_custom')!.description).toBe('Honors audacity.');
});

test('archive mods work, and missing active mods fail closed rather than quietly using vanilla', () => {
    base();
    const zip = new AdmZip(); zip.addFile('common/culture/traditions/base.txt', Buffer.from('archive_custom = { parameters = { custom_rule = yes } }'));
    zip.writeZip(path.join(root, 'mod.zip'));
    write('user/mod/archive.mod', `archive="${path.join(root, 'mod.zip')}"`);
    write('user/dlc_load.json', JSON.stringify({ enabled_mods: ['mod/archive.mod'] }));
    expect(buildCultureCatalog(path.join(root, 'game'), path.join(root, 'user')).facts.some(f => f.key === 'archive_custom')).toBe(true);
    write('user/dlc_load.json', JSON.stringify({ enabled_mods: ['mod/missing.mod'] }));
    expect(() => buildCultureCatalog(path.join(root, 'game'), path.join(root, 'user'))).toThrow('missing');
});

test('unrelated new traditions alter the capture catalogue without invalidating existing cultural content', () => {
    const files = new Map([['common/culture/pillars/custom.txt', 'custom_ethos = { type = ethos }'],
        ['common/culture/traditions/custom.txt', 'custom_tradition = { parameters = { value = yes } }']]);
    const before = catalogFromFiles(files);
    files.set('common/culture/traditions/unrelated.txt', 'unrelated_tradition = { parameters = { other = yes } }');
    const after = catalogFromFiles(files);
    expect(before.digest).not.toBe(after.digest);
    const selected = snapshot();
    selected.facts.push(before.facts.find(f => f.key === 'custom_tradition')!);
    const original = cultureHash(cultureInput(selected, 'en'));
    selected.facts[selected.facts.length - 1] = after.facts.find(f => f.key === 'custom_tradition')!;
    expect(cultureHash(cultureInput(selected, 'en'))).toBe(original);
});

test('the generated observer uses live checks and preserves the original exporter verbatim', () => {
    const c = catalog(); const source = '\uFEFFlog_character_v2 = {\n log = "{quoted}" # } comment\n nested = { original = yes }\n}\nother_effect = { keep = yes }\n';
    c.exporter = { relative: 'common/scripted_effects/log_character_v2_effect.txt', source };
    const extended = extendCharacterExporter(source);
    expect(extended.replace(/\n\t# MIMIR CULTURE CAPTURE BEGIN\n[\s\S]*?# MIMIR CULTURE CAPTURE END\n/, '')).toBe(source);
    const effect = cultureCaptureEffect(c);
    expect(effect).toContain('has_cultural_tradition = tradition_custom_craft');
    expect(effect).toContain('has_cultural_pillar = test_language');
    expect(effect).toContain('has_name_list = name_list_custom');
    expect(effect).not.toContain('culture = norse');
    // The companion tails CK3 debug.log; every transport record must use that effect.
    const emitted = Array.from(effect.matchAll(/(\w+)\s*=\s*"VOTC:CULTURE\/;\/[^"\n]*"/g));
    expect(emitted.length).toBeGreaterThan(0);
    expect(new Set(emitted.map(record => record[1]))).toEqual(new Set(['debug_log']));
    expect(() => parseCk3Script(effect)).not.toThrow();
    expect(() => parseCk3Script(cultureObserverGui())).not.toThrow();
    writeCultureAddon(c, path.join(root, 'addon'));
    expect(fs.readFileSync(path.join(root, 'addon', c.exporter.relative), 'utf8')).toBe(extended);
});
