import { dialogueCatalogue } from '../../src/main/dialogue/dialogueCatalog';
import { resolveDialogueSteering, DIALOGUE_WRITER_CORE } from '../../src/main/dialogue/dialogueSteering';
import { DialogueCaptureCatalog, DialogueLogReader, dialogueCaptureBody, DialogueIdentity } from '../../src/main/dialogue/dialogueCapture';
import { parseCk3Script } from '../../src/main/culture/ck3Script';

const data = dialogueCatalogue();
const identity = (cultureId?: string, faithId?: string, cultureRoots: string[] = []): DialogueIdentity => ({ version: 1, complete: true, cultureId, faithId, cultureRoots });
const options = { culture: true, faith: true, locale: 'en' };
test.each(Object.keys(data.cultures))('selects exactly the authored %s register, independent of body and social names', culture => {
    const result = resolveDialogueSteering(identity(culture), [], options);
    expect(result.cultureKey).toBe(culture); expect(result.text).toContain(data.cultures[culture].instruction);
    expect(result.text).toContain(DIALOGUE_WRITER_CORE);
    expect(result.text).not.toMatch(/CULTURE [a-z_]+|sourceSha256|Original dialogue examples|Breeze receives|titan_audio|\bJSON\b/);
});
test('native coverage and curated counter-trait choices retain strong expressive direction', () => {
    expect(Object.keys(data.cultures)).toHaveLength(166); expect(Object.keys(data.faiths)).toHaveLength(35); expect(Object.keys(data.roles)).toHaveLength(12);
    expect(new Set(Object.values(data.faiths).flatMap(v => v.faithIds)).size).toBe(42);
    expect(data.cultures.darkspear.instruction).toContain('Jamaican English'); expect(data.cultures.darkspear.instruction).toContain('yuh');
    expect(data.cultures.goblin.instruction).toContain('fast-talking'); expect(data.cultures.gnome.instruction).toContain('exuberant');
    expect(data.cultures.laughing_skull.instruction).toContain('gallows humor'); expect(data.cultures.naga.instruction).toContain('imperious');
    expect(data.cultures.goblin.instruction).not.toContain('greedy venture-capitalist');
    expect(data.cultures.sayaadi.instruction).not.toContain('every attractive kindness');
    expect(data.cultures.blood_elf.instruction).not.toContain('vain and ambitious');
    for (const record of Object.values(data.cultures)) expect(record.instruction).not.toContain(' Common');
});
test.each(Object.entries(data.faiths))('resolves %s only from its exact observed faith IDs', (key, record) => {
    for (const faith of record.faithIds) {
        const result = resolveDialogueSteering(identity(undefined, faith), [], options);
        expect(result.faithKey).toBe(key); expect(result.text).toContain(record.instruction);
        expect(result.text).toContain('current teachings and stated beliefs');
        expect(resolveDialogueSteering(identity(undefined, faith + '_reformed'), [], options).faithKey).toBeUndefined();
    }
});
test('unknown/custom faiths retain the existing background path; toggles and locale do not invent registers', () => {
    expect(resolveDialogueSteering(identity(undefined, 'new_faith'), [], options).text).toBe('');
    expect(resolveDialogueSteering(identity('goblin', 'holy_light'), [], { ...options, culture: false, faith: false }).text).toBe('');
    expect(resolveDialogueSteering(identity('goblin'), [], { ...options, locale: 'fr' }).text).toBe('');
});
test('exact identity wins ancestry; only an unambiguous inherited register is continued without inventing a blend', () => {
    expect(resolveDialogueSteering(identity('gilnean', undefined, ['tauren', 'goblin']), [], options).cultureKey).toBe('gilnean');
    expect(resolveDialogueSteering(identity(undefined, undefined, ['goblin']), [], options).cultureKey).toBe('goblin');
    expect(resolveDialogueSteering(identity(undefined, undefined, ['goblin', 'gilnean']), [], options).cultureKey).toBeUndefined();
});
test.each(Object.entries(data.roles))('training %s requires an actual recorded provider, never just a class name', (key, role) => {
    expect(resolveDialogueSteering(undefined, [], options).roleKeys).not.toContain(key);
    if (role.traitIds.length) {
        const result = resolveDialogueSteering(undefined, [role.traitIds[0]], options);
        expect(result.roleKeys).toContain(key); expect(result.text).toContain(role.instruction);
    } else expect(role.requiresConfirmedRole).toBe(true);
});
test('Fallen controller never inherits the captive hunter profession or faith while retaining the final identity policy', () => {
    const result = resolveDialogueSteering(identity('darkspear', 'holy_light'), ['demon_hunter', 'fallen_demon_hunter'], options);
    expect(result.faithKey).toBeUndefined(); expect(result.roleKeys).not.toContain('demon_hunter_selected_attention');
    expect(result.text).toContain('former host'); expect(result.text).toContain('controlling-identity policy');
    expect(resolveDialogueSteering(undefined, ['spectral_sight'], options).roleKeys).not.toContain('demon_hunter_selected_attention');
});
test('letters and suggestions constrain their actual consumer without introducing a new prose format', () => {
    expect(resolveDialogueSteering(identity('goblin'), [], { ...options, mode: 'letter' }).text).toContain('written correspondence');
    expect(resolveDialogueSteering(identity('goblin'), [], { ...options, mode: 'suggestion' }).text).toContain('possible replies');
});

const catalog: DialogueCaptureCatalog = { digest: 'a'.repeat(64), cultureIds: ['darkspear', 'goblin'], faithIds: ['holy_light', 'cult_of_shadows'] };
function frame(id = 1, culture = 'goblin', faith = 'holy_light'): string[] {
    return [`VOTC:SPEECH/;/begin/;/${catalog.digest}/;/${id}`,
        ...catalog.cultureIds.flatMap(key => [`VOTC:SPEECH/;/culture/;/${key}/;/${+(key === culture)}`, `VOTC:SPEECH/;/root/;/${key}/;/${+(key === culture)}`]),
        ...catalog.faithIds.map(key => `VOTC:SPEECH/;/faith/;/${key}/;/${+(key === faith)}`), `VOTC:SPEECH/;/end/;/${catalog.digest}/;/${id}`];
}
test('generated participant capture parses, uses exact native predicates and has no state mutation or world scan', () => {
    const script = dialogueCaptureBody(catalog); expect(() => parseCk3Script(script)).not.toThrow();
    expect(script).toContain('this = culture:goblin'); expect(script).toContain('this = faith:holy_light');
    expect(script).not.toMatch(/every_|set_variable|trigger_event|GetKey|GetName|knows_language|learn_language/);
});
test.each(['missing culture', 'missing root', 'missing faith', 'duplicate', 'two cultures', 'unknown ID', 'bad end', 'bad digest', 'bad bit'])('identity rejects %s and immediately invalidates an old observation', defect => {
    const reader = new DialogueLogReader(catalog); frame().forEach(line => reader.observe(line)); expect(reader.snapshot(1)?.cultureId).toBe('goblin');
    const lines = frame();
    if (defect.startsWith('missing ')) lines.splice(lines.findIndex(line => line.includes('/;/' + defect.slice(8) + '/;/')), 1);
    if (defect === 'duplicate') lines.splice(2, 0, lines[1]);
    if (defect === 'two cultures') lines[1] = lines[1].replace('/;/0', '/;/1');
    if (defect === 'unknown ID') lines[1] = lines[1].replace('darkspear', 'fake_darkspear');
    if (defect === 'bad end') lines[lines.length - 1] = lines[lines.length - 1].replace(/1$/, '2');
    if (defect === 'bad digest') lines[0] = lines[0].replace(catalog.digest, 'b'.repeat(64));
    if (defect === 'bad bit') lines[1] = lines[1].replace('/;/0', '/;/yes');
    lines.forEach(line => reader.observe(line)); expect(reader.snapshot(1)).toBeUndefined();
});
test('new observations replace faith/culture, saved reload clears them, and the encountered identity cache stays bounded', () => {
    let time = 100; const reader = new DialogueLogReader(catalog, () => time);
    frame().forEach(line => reader.observe(line)); frame(1, 'darkspear', 'cult_of_shadows').forEach(line => reader.observe(line));
    expect(reader.snapshot(1)).toMatchObject({ cultureId: 'darkspear', faithId: 'cult_of_shadows' });
    time += 15001; expect(reader.snapshot(1)).toBeUndefined();
    for (let id = 1; id < 100; id++) frame(id).forEach(line => reader.observe(line)); expect(reader.revisions.size).toBe(64);
    reader.observe('VOTC:CAMPAIGN/;/loaded/;/new'); expect(reader.snapshot(99)).toBeUndefined(); expect(reader.revisions.size).toBe(0);
});


test('corrupted Life training retains the actual distortion instead of receiving an uncorrupted stewardship command', () => {
    const result = resolveDialogueSteering(identity('night_elf'), ['user_of_life_magic_2'], { ...options, corruptedNature: true });
    expect(result.roleKeys).toContain('druid_ecological_attention');
    expect(result.text).toContain('distorted ideal'); expect(result.text).toContain('does not cleanse');
    expect(result.text).not.toContain(data.roles.druid_ecological_attention.instruction);
});
