import { catalogFromFiles } from '../../src/main/culture/cultureCatalog';
import { cultureCaptureEffect } from '../../src/main/culture/cultureBridge';
import { CultureLogReader } from '../../src/main/culture/cultureLog';
import { logicalRequestHash } from '../../src/main/promptWorkbench/canonicalJson';
import { catalog, captureLines } from './fixtures';

function sourceCatalog(source = 'wildhammer = { heritage = dwarven } frostwolf = { heritage = orcish }') {
    const parsed = catalogFromFiles(new Map([
        ['common/culture/cultures/example.txt', source],
        ['common/culture/pillars/example.txt', 'base_ethos = { type = ethos }'],
        ['common/culture/traditions/example.txt', 'custom_tradition = { parameters = { example = yes } }']
    ]));
    const base = catalog(), facts = [...base.facts, ...parsed.facts.filter(f => f.kind === 'lineage')];
    const { digest: _old, ...rest } = base;
    const body = { ...rest, facts };
    return { ...body, digest: logicalRequestHash(body) };
}

function lines(c: ReturnType<typeof sourceCatalog>, records = ['wildhammer/;/1', 'frostwolf/;/1']) {
    const base = catalog();
    return captureLines().map(line => line.replace(base.digest, c.digest)).flatMap(line =>
        line.includes('/;/end/;/') ? [...records.map(r => 'VOTC:CULTURE/;/ancestor/;/' + r), line] : [line]);
}

test('source-bound lineage census preserves both observed parents independently of the adopted customs', () => {
    const c = sourceCatalog(), reader = new CultureLogReader(c);
    const effect = cultureCaptureEffect(c);
    expect(effect).toContain('this = culture:wildhammer any_parent_culture_or_above = { this = culture:wildhammer }');
    expect(effect).toContain('VOTC:CULTURE/;/ancestor/;/frostwolf/;/0');
    const observations = lines(c).map(line => reader.read(line)).filter(Boolean);
    expect(observations).toHaveLength(1);
    const found = observations[0]!.snapshot.facts.filter(f => f.kind === 'lineage');
    expect(found.map(f => f.key).sort()).toEqual(['frostwolf', 'wildhammer']);
    expect(found.every(f => /^[a-f0-9]{64}$/.test(JSON.parse(f.rules).sourceDefinitionHash))).toBe(true);
    expect(observations[0]!.snapshot.facts.some(f => f.key === 'tradition_ep2_avid_falconers')).toBe(false);
});

test.each([
    ['missing status', ['wildhammer/;/1']],
    ['duplicate status', ['wildhammer/;/1', 'wildhammer/;/0', 'frostwolf/;/1']],
    ['unknown source', ['wildhammer/;/1', 'frostwolf/;/1', 'impostor/;/1']],
    ['invalid status', ['wildhammer/;/yes', 'frostwolf/;/1']]
])('an incomplete or inconsistent lineage census is rejected: %s', (_name, records) => {
    const c = sourceCatalog(), reader = new CultureLogReader(c);
    expect(lines(c, records).map(line => reader.read(line)).filter(Boolean)).toEqual([]);
});

test('a changed source definition changes the root binding and catalogue digest', () => {
    const before = sourceCatalog(), after = sourceCatalog('wildhammer = { heritage = changed } frostwolf = { heritage = orcish }');
    expect(after.digest).not.toBe(before.digest);
    expect(after.facts.find(f => f.kind === 'lineage' && f.key === 'wildhammer')!.rules)
        .not.toBe(before.facts.find(f => f.kind === 'lineage' && f.key === 'wildhammer')!.rules);
    expect(after.facts.find(f => f.kind === 'lineage' && f.key === 'frostwolf')!.rules)
        .toBe(before.facts.find(f => f.kind === 'lineage' && f.key === 'frostwolf')!.rules);
});
