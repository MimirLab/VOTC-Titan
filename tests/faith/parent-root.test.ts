import { FaithLogReader, sealFaithSnapshot } from '../../src/main/faith/faithLog';
import { FaithRelationshipBank } from '../../src/main/background/faithRelationshipBank';
import { passagePlan } from '../../src/main/background/sourceReference';
import { sha256Hex } from '../../src/main/promptWorkbench/canonicalJson';
import { catalog, capture, records } from './fixtures';

function sourceCatalog() {
    const c = catalog();
    c.templates[0].description = 'Ancestral guardians watch over their kin.';
    return c;
}
function read(lines: string[]) {
    const reader = new FaithLogReader(sourceCatalog());
    return lines.map(line => reader.read(line)).find(Boolean);
}
const state = (lines: string[], replacement: string[]) => lines.flatMap(line =>
    line.endsWith('parent_state/;/absent') ? replacement.map(s => 'VOTC:FAITH/;/' + s) : [line]);

test('the complete native census distinguishes a known root, an unknown root and absent evidence', () => {
    expect(read(records())?.snapshot.facts.some(f => f.key === 'parent_faith')).toBe(false);
    const unknown = state(records(), ['parent_state/;/present', 'ancestor/;/old_name/;/0']);
    expect(read(unknown)?.snapshot.facts.some(f => f.key === 'parent_faith')).toBe(false);
    const known = state(records(), ['parent_state/;/present', 'ancestor/;/old_name/;/1']);
    const parent = read(known)?.snapshot.facts.find(f => f.key === 'parent_faith');
    expect(parent?.description).toBe('Ancestral guardians watch over their kin.');
    expect(JSON.parse(parent!.rules)).toMatchObject({ sourceFaithKey: 'old_name',
        sourceReligionHash: sha256Hex(sourceCatalog().religions[0].description) });
});

test('incomplete, duplicate and contradictory root reports cannot seal a capture', () => {
    for (const fragments of [
        ['parent_state/;/present'],
        ['parent_state/;/absent', 'ancestor/;/old_name/;/1'],
        ['parent_state/;/present', 'ancestor/;/old_name/;/1', 'ancestor/;/old_name/;/0'],
        ['parent_state/;/present', 'ancestor/;/unknown/;/1'],
        ['parent_state/;/present', 'parent_state/;/absent'],
    ]) expect(read(state(records(), fragments))).toBeUndefined();
    const c = sourceCatalog();
    c.templates.push({ ...c.templates[0], key: 'other_origin' });
    const conflicting = state(records(), ['parent_state/;/present', 'ancestor/;/old_name/;/1', 'ancestor/;/other_origin/;/1']);
    const reader = new FaithLogReader(c);
    expect(conflicting.map(line => reader.read(line)).find(Boolean)).toBeUndefined();
});

test('a reviewed parent account supplies context without inheriting its teaching facets', () => {
    const c = sourceCatalog();
    const input = sealFaithSnapshot(c, { ...capture(), parentFaith: 'old_name' });
    const account = { accountHash: sha256Hex(c.templates[0].description),
        rootHash: sha256Hex(c.religions[0].description), worship: { HighGodName: 'Shadow' },
        text: 'Kin maintain a bond with ancestral guardians.', vocabulary: 'ancestral',
        teachingContext: ['parent_only_teaching'] };
    const bank = new FaithRelationshipBank({ version: 1, accounts: [account], roots: [] });
    expect(bank.teachingContext(input)).not.toContain('parent_only_teaching');
    const view = bank.project(input);
    const plan = passagePlan('faith', view);
    const roots = plan.passages.find(p => p.kind === 'broader religious heritage');
    expect(roots?.text).toContain(account.text);
    expect(roots?.text).toContain('Current teachings take precedence.');
    expect(roots?.contributors).toContain('description:parent_faith');
    expect(view.facts.find(f => f.kind === 'doctrine')?.key).toBe('custom_doctrine');
    const same = sealFaithSnapshot(c, { ...capture(), parentFaith: 'old_name',
        texts: { ...capture().texts, faith_description: c.templates[0].description } });
    expect(bank.resolve(same).parent).toBeUndefined();
    const mismatched = new FaithRelationshipBank({ version: 1,
        accounts: [{ ...account, worship: { HighGodName: 'Different' } }], roots: [] });
    expect(mismatched.resolve(input).parent).toBeUndefined();
});
