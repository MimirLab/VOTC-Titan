import { FaithRelationshipBank, FaithRelationshipUnavailable, projectedFaithRelationship } from
    '../src/main/background/faithRelationshipBank';
import { canonicalJsonStringify, sha256Hex } from '../src/main/promptWorkbench/canonicalJson';
import { snapshot as faithFixture } from './faith/fixtures';

function fixture() {
    const snapshot = faithFixture();
    const account = snapshot.facts.find(f => f.kind === 'description' && f.key === 'faith')!;
    const root = snapshot.facts.find(f => f.kind === 'description' && f.key === 'religion')!;
    const entry = { accountHash: sha256Hex(account.description), rootHash: sha256Hex(root.description),
        worship: { HighGodName: 'Shadow' } as Record<string, string>, text: 'A sacred force is approached through balance, with corruption a danger.',
        vocabulary: 'force' as const };
    const roots = [{ accountHash: sha256Hex(root.description), text: 'Inherited roots connect Light and Shadow.' }];
    return { snapshot, account, root, entry, asset: { version: 1 as const, accounts: [entry], roots } };
}

test('exact current account/root/vocabulary selects a reading without altering anonymous identity or adopted facts', () => {
    const { snapshot, asset, entry } = fixture(), bank = new FaithRelationshipBank(asset);
    const before = canonicalJsonStringify(snapshot), view = bank.project(snapshot);
    expect(canonicalJsonStringify(snapshot)).toBe(before);
    expect(view.facts.find(f => f.key === 'faith')!.description).toBe(entry.text);
    expect(view.facts.filter(f => f.kind !== 'description')).toEqual(snapshot.facts.filter(f => f.kind !== 'description'));
    expect(projectedFaithRelationship(view)?.account).toEqual(entry);
    expect(projectedFaithRelationship(structuredClone(view))).toBeUndefined();
});

test('reviewed roles require both the current account and their own exact observed getter', () => {
    const { snapshot, entry, asset } = fixture();
    const role = { key: 'WarGodName', value: 'A named patron', label: 'War-associated patron' };
    snapshot.facts.push({ kind: 'worship', key: role.key, name: role.key, description: role.value, rules: '' });
    const bank = new FaithRelationshipBank({ ...asset, accounts: [{ ...entry, vocabularyRoles: [role] }] });
    expect(bank.resolve(snapshot).vocabularyRoles).toEqual([role]);
    const before = bank.resolve(snapshot).revision;
    snapshot.facts.find(f => f.key === role.key)!.description = 'A newly adopted patron';
    expect(bank.resolve(snapshot).vocabularyRoles).toBeUndefined();
    expect(bank.resolve(snapshot).account!.text).toBe(entry.text);
    expect(bank.resolve(snapshot).revision).not.toBe(before);
    snapshot.facts.find(f => f.key === role.key)!.description = role.value;
    snapshot.facts.find(f => f.key === 'faith')!.description = 'A different actual account.';
    expect(bank.resolve(snapshot).vocabularyRoles).toBeUndefined();
});

test('unobserved role edits do not churn selected content or assign a familiar name', () => {
    const { snapshot, entry, asset } = fixture();
    const role = { key: 'WarGodName', value: 'Shared patron', label: 'War-associated patron' };
    snapshot.facts.push({ kind: 'worship', key: 'GoodGodNames', name: 'Familiar names', description: role.value, rules: '' });
    const plain = new FaithRelationshipBank(asset).resolve(snapshot).revision;
    const bank = new FaithRelationshipBank({ ...asset, accounts: [{ ...entry, vocabularyRoles: [role] }] });
    expect(bank.resolve(snapshot).vocabularyRoles).toBeUndefined();
    expect(bank.resolve(snapshot).revision).toBe(plain);
    role.label = 'Changed unobserved editorial role';
    expect(new FaithRelationshipBank({ ...asset, accounts: [{ ...entry, vocabularyRoles: [role] }] }).resolve(snapshot).revision).toBe(plain);
});

test('one changed role retains other independently observed roles and defensive copies', () => {
    const { snapshot, entry, asset } = fixture();
    const roles = [{ key: 'WaterGodName', value: 'Sea patron', label: 'Sea-associated patron' },
        { key: 'WarGodName', value: 'War patron', label: 'War-associated patron' }];
    for (const role of roles) snapshot.facts.push({ kind: 'worship', key: role.key, name: role.key, description: role.value, rules: '' });
    const bank = new FaithRelationshipBank({ ...asset, accounts: [{ ...entry, vocabularyRoles: roles }] });
    roles[0].label = 'External mutation';
    snapshot.facts.find(f => f.key === 'WarGodName')!.description = 'New war-associated term';
    expect(bank.resolve(snapshot).vocabularyRoles).toEqual([{ key: 'WaterGodName', value: 'Sea patron', label: 'Sea-associated patron' }]);
    const returned = bank.resolve(snapshot).vocabularyRoles!;
    returned[0].label = 'Returned mutation';
    expect(bank.resolve(snapshot).vocabularyRoles![0].label).toBe('Sea-associated patron');
    expect(projectedFaithRelationship(bank.project(snapshot))?.vocabularyRoles).toEqual([
        { key: 'WaterGodName', value: 'Sea patron', label: 'Sea-associated patron' }]);
});

test.each(['duplicate', 'invalid-key', 'extra-property', 'control-character'])('malformed %s reviewed roles hold at asset construction', variant => {
    const { entry, asset } = fixture();
    const role = { key: 'WaterGodName', value: 'Sea patron', label: 'Sea-associated patron' };
    const roles: any[] = [role];
    if (variant === 'duplicate') roles.push({ ...role });
    if (variant === 'invalid-key') role.key = 'worship:WaterGodName';
    if (variant === 'extra-property') Object.assign(role, { body: 'unobserved' });
    if (variant === 'control-character') role.label = 'bad\nrole';
    expect(() => new FaithRelationshipBank({ ...asset, accounts: [{ ...entry, vocabularyRoles: roles }] })).toThrow();
});

test.each(['account', 'root', 'worship', 'missing-worship'])('changed %s evidence cannot restore a starting account interpretation', facet => {
    const { snapshot, asset, account, root } = fixture(), bank = new FaithRelationshipBank(asset);
    if (facet === 'account') account.description = 'A reformed community rejects the former balance.';
    if (facet === 'root') root.description = 'A new syncretic heritage.';
    if (facet === 'worship') snapshot.facts.find(f => f.kind === 'worship')!.description = 'New patron';
    if (facet === 'missing-worship') snapshot.facts = snapshot.facts.filter(f => f.kind !== 'worship');
    const resolved = bank.resolve(snapshot), view = bank.project(snapshot);
    expect(resolved.account).toBeUndefined();
    expect(view.facts.find(f => f.key === 'faith')!.description).toBe(account.description);
});

test('renaming source labels cannot assign or remove a belief; current doctrine and morality changes remain intact', () => {
    const { snapshot, asset } = fixture(), bank = new FaithRelationshipBank(asset);
    const original = bank.resolve(snapshot).revision;
    for (const f of snapshot.facts.filter(f => ['religion', 'family'].includes(f.kind))) {
        f.name = 'Unfamiliar renamed community'; f.key += '_renamed';
    }
    snapshot.facts.find(f => f.kind === 'doctrine')!.description = 'Current reform rejects older practices.';
    snapshot.facts = snapshot.facts.filter(f => f.kind !== 'sin');
    const view = bank.project(snapshot);
    expect(bank.resolve(snapshot).revision).toBe(original);
    expect(view.facts.find(f => f.kind === 'doctrine')!.description).toContain('Current reform');
    expect(view.facts.some(f => f.kind === 'sin')).toBe(false);
});

test('editing only unrelated readings does not churn this composition, while its own wording does', () => {
    const { snapshot, asset, entry } = fixture();
    const before = new FaithRelationshipBank(asset).resolve(snapshot).revision;
    asset.accounts.push({ ...entry, accountHash: sha256Hex('different supplied account'), text: 'Unselected interpretation.' });
    expect(new FaithRelationshipBank(asset).resolve(snapshot).revision).toBe(before);
    asset.accounts[0].text += ' The relationship is reciprocal.';
    expect(new FaithRelationshipBank(asset).resolve(snapshot).revision).not.toBe(before);
});

test('external asset and returned-context mutations cannot silently rewrite approved readings', () => {
    const { snapshot, asset, entry } = fixture(), bank = new FaithRelationshipBank(asset), before = entry.text;
    entry.text = 'Editorial mutation after construction';
    const view = bank.project(snapshot), exposed = projectedFaithRelationship(view)!;
    exposed.account!.vocabulary = 'secular'; exposed.account!.text = 'Changed returned context';
    expect(projectedFaithRelationship(view)?.account?.vocabulary).toBe('force');
    expect(view.facts.find(f => f.key === 'faith')!.description).toBe(before);
    view.facts.find(f => f.key === 'faith')!.description = 'Changed projected account';
    expect(projectedFaithRelationship(view)).toBeUndefined();
});

test('overlapping matching interpretations hold instead of selecting the convenient first one', () => {
    const { snapshot, asset, entry } = fixture();
    asset.accounts.push({ ...entry, worship: {}, text: 'A broader conflicting interpretation.' });
    expect(() => new FaithRelationshipBank(asset).resolve(snapshot)).toThrow(FaithRelationshipUnavailable);
});

test.each(['account', 'root'])('a recognized source-placeholder %s holds rather than inventing a religion', facet => {
    const { snapshot, asset } = fixture();
    if (facet === 'account') Object.assign(asset.accounts[0], { vocabulary: 'hold', text: '' });
    else Object.assign(asset.roots[0], { hold: true, text: '' });
    expect(() => new FaithRelationshipBank(asset).project(snapshot)).toThrow(FaithRelationshipUnavailable);
});

test('unknown overhaul descriptions remain source evidence and have no guessed custom relationship', () => {
    const { snapshot } = fixture(), bank = new FaithRelationshipBank({ version: 1, accounts: [], roots: [] });
    const view = bank.project(snapshot);
    expect(view).toEqual(snapshot);
    expect(projectedFaithRelationship(view)?.account).toBeUndefined();
    expect(projectedFaithRelationship(view)?.root).toBeUndefined();
});

test('teaching facets require matched accounts and primary roles, never a shared familiar name', () => {
    const { snapshot, entry, asset } = fixture();
    const reading = { ...entry, teachingContext: ['affirmed_elemental_subjugation_teaching'] };
    const bank = new FaithRelationshipBank({ ...asset, accounts: [reading] });
    expect(bank.teachingContext(snapshot)).toEqual(reading.teachingContext);
    const changed = structuredClone(snapshot);
    changed.facts.find(f => f.key === 'faith')!.description = 'An unrelated current teaching.';
    changed.facts.push({ kind: 'worship', key: 'GoodGodNames', name: 'Familiar names',
        description: 'Shadow', rules: JSON.stringify({ alternatives: ['Shadow', 'Ancestors'] }) });
    expect(bank.teachingContext(changed)).toEqual([]);
    changed.facts.find(f => f.key === 'faith')!.description = snapshot.facts.find(f => f.key === 'faith')!.description;
    changed.facts.find(f => f.key === 'HighGodName')!.description = 'A newly adopted sacred focus';
    expect(bank.teachingContext(changed)).toEqual([]);
});

test('caller mutation cannot grant another teaching or churn an unused relationship revision', () => {
    const { snapshot, entry, asset } = fixture();
    const teachingContext = ['affirmed_elemental_subjugation_teaching'];
    const plain = new FaithRelationshipBank(asset);
    const bank = new FaithRelationshipBank({ ...asset, accounts: [{ ...entry, teachingContext }] });
    teachingContext.push('affirmed_loa_patronage_teaching');
    const returned = bank.teachingContext(snapshot) as string[];
    returned.push('affirmed_hakkar_teaching');
    expect(bank.teachingContext(snapshot)).toEqual(['affirmed_elemental_subjugation_teaching']);
    expect(bank.resolve(snapshot).revision).toBe(plain.resolve(snapshot).revision);
});

test('a patron aspect follows its own observed role while general teaching survives its loss', () => {
    const { snapshot, entry, asset } = fixture();
    const general = 'affirmed_coastal_guardian_pantheon_teaching', aspect = 'affirmed_issliruk_courage_patron_role';
    const role = { key: 'WarGodName', value: 'Issliruk', label: 'Patron of war and courage', teachingContext: [aspect] };
    snapshot.facts.push({ kind: 'worship', key: role.key, name: role.key, description: role.value, rules: '' });
    const bank = new FaithRelationshipBank({ ...asset, accounts: [{ ...entry, teachingContext: [general], vocabularyRoles: [role] }] });
    expect(bank.teachingContext(snapshot)).toEqual([general, aspect]);
    const changed = structuredClone(snapshot);
    changed.facts.find(f => f.key === role.key)!.description = 'Another patron';
    changed.facts.push({ kind: 'worship', key: 'GoodGodNames', name: '', description: role.value, rules: '' });
    expect(bank.teachingContext(changed)).toEqual([general]);
    changed.facts = changed.facts.filter(f => f.key !== role.key);
    expect(bank.teachingContext(changed)).toEqual([general]);
    changed.facts.find(f => f.key === 'religion' && f.kind === 'description')!.description = 'A newly adopted religious root';
    expect(bank.teachingContext(changed)).toEqual([]);
});

test('role facet metadata cannot rewrite relationship wording or mutate through caller references', () => {
    const { snapshot, entry, asset } = fixture();
    const role = { key: 'WarGodName', value: 'Issliruk', label: 'Patron of war and courage' };
    snapshot.facts.push({ kind: 'worship', key: role.key, name: role.key, description: role.value, rules: '' });
    const plain = new FaithRelationshipBank({ ...asset, accounts: [{ ...entry, vocabularyRoles: [role] }] });
    const teachingContext = ['affirmed_issliruk_courage_patron_role'];
    const bank = new FaithRelationshipBank({ ...asset, accounts: [{ ...entry, vocabularyRoles: [{ ...role, teachingContext }] }] });
    const revision = bank.resolve(snapshot).revision;
    expect(revision).toBe(plain.resolve(snapshot).revision);
    teachingContext.push('affirmed_other_role');
    (bank.resolve(snapshot).vocabularyRoles![0].teachingContext as string[]).push('affirmed_returned_mutation');
    (bank.teachingContext(snapshot) as string[]).push('affirmed_context_mutation');
    expect(bank.teachingContext(snapshot)).toEqual(['affirmed_issliruk_courage_patron_role']);
    expect(bank.resolve(snapshot).revision).toBe(revision);
});

test('combined role facets are bounded without silently discarding a teaching', () => {
    const { snapshot, entry, asset } = fixture();
    const teachingContext = Array.from({ length: 64 }, (_, i) => 'affirmed_teaching_' + i);
    const role = { key: 'WarGodName', value: 'Issliruk', label: 'Patron of war and courage',
        teachingContext: ['affirmed_role_aspect'] };
    snapshot.facts.push({ kind: 'worship', key: role.key, name: role.key, description: role.value, rules: '' });
    const bank = new FaithRelationshipBank({ ...asset, accounts: [{ ...entry, teachingContext, vocabularyRoles: [role] }] });
    expect(() => bank.teachingContext(snapshot)).toThrow(FaithRelationshipUnavailable);
    snapshot.facts.find(f => f.key === role.key)!.description = 'A new current role';
    expect(bank.teachingContext(snapshot)).toEqual(teachingContext);
});

test.each([['bad context'], ['affirmed_role', 'affirmed_role'], [14]])('invalid role teaching facets hold: %p', (...teachingContext) => {
    const { entry, asset } = fixture();
    const role = { key: 'WarGodName', value: 'Issliruk', label: 'Patron of war and courage', teachingContext };
    expect(() => new FaithRelationshipBank({ ...asset, accounts: [{ ...entry, vocabularyRoles: [role] }] })).toThrow();
});

test.each([['bad context'], ['affirmed_teaching', 'affirmed_teaching'], [14]])('invalid teaching facets fail closed: %p', (...teachingContext) => {
    const { entry, asset } = fixture();
    expect(() => new FaithRelationshipBank({ ...asset, accounts: [{ ...entry, teachingContext }] })).toThrow();
});
