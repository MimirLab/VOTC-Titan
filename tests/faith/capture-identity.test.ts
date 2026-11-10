import { FaithLogReader } from '../../src/main/faith/faithLog';
import { faithInput, faithHash, buildFaithGenerationMessages, validateFaithResult } from '../../src/main/faith/faithIdentity';
import { validateFaithSnapshot, validateFaithLiveContext } from '../../src/shared/gameData/FaithSnapshot';
import { faithCaptureEffect } from '../../src/main/faith/faithBridge';
import { extendCharacterExporter, cultureCaptureScript } from '../../src/main/culture/cultureBridge';
import { canonicalJsonStringify } from '../../src/main/promptWorkbench/canonicalJson';
import { LogLineFramer } from '../../src/main/culture/cultureLog';
import { catalog, capture, snapshot, result, records } from './fixtures';

test('modern flat doctrine definitions use discovered groups and preserve mod parameters, conditions and descriptions', () => {
    const c = catalog();
    expect(c.doctrines.map(f => f.key)).toEqual(['changed_doctrine', 'custom_doctrine']);
    const evidence = c.doctrines.find(f => f.key === 'custom_doctrine')!;
    expect(evidence.rules).toContain('modded_magic_group');
    expect(evidence.rules).toContain('"value":"no"');
    expect(evidence.rules).toContain('Shadow magic is approved.');
    const input = faithInput(snapshot(), 'en'), messages = buildFaithGenerationMessages(input);
    expect(messages[1].content).toContain('A wider tradition of Light and Shadow');
    expect(messages[1].content).toContain('Balance guides this faith');
    expect(input.snapshot.facts.some(f => f.description.includes('A family of related beliefs'))).toBe(true);
    expect(messages[0].content).toContain('Current observed doctrines');
    expect(messages[0].content).toContain('explicit dissenters');
});
test('identity is order/character/faith-ID independent, while changes to beliefs or either description create new hashes', () => {
    const c = catalog();
    const read = (lines: string[]) => { const r = new FaithLogReader(c); return lines.map(l => r.read(l)).find(Boolean)!; };
    const first = read(records()), second = read(records(99, 999));
    const hash = faithHash(faithInput(first.snapshot, 'en'));
    expect(faithHash(faithInput(second.snapshot, 'en'))).toBe(hash);
    expect(faithHash(faithInput({ ...snapshot(), facts: snapshot().facts.reverse() }, 'en'))).toBe(hash);
    for (const key of ['faith', 'religion']) {
        const changed = snapshot(); changed.facts.find(f => f.kind === 'description' && f.key === key)!.description += ' Changed.';
        expect(faithHash(faithInput(changed, 'en'))).not.toBe(hash);
    }
    expect(faithHash(faithInput(snapshot(), 'de'))).not.toBe(hash);
    expect(canonicalJsonStringify(first.snapshot)).not.toMatch(/characterId|faithId|fervor|Synthetic Leader/);
});
test('multiline descriptions preserve delimiters and Unicode across fragmented UTF-8 reads', () => {
    const input = capture(); input.texts.faith_description = 'Ancestors /;/ memory\n第二行 with nuance';
    const r = new FaithLogReader(catalog()), framer = new LogLineFramer(); const observations: any[] = [];
    const bytes = Buffer.from(records(2, 123, input).join('\n') + '\n');
    for (let offset = 0; offset < bytes.length; offset += 3)
        framer.push(bytes.subarray(offset, offset + 3), line => { const o = r.read(line); if (o) observations.push(o); });
    expect(observations).toHaveLength(1);
    expect(observations[0].snapshot.facts.find((f: any) => f.key === 'faith').description).toBe('Ancestors /;/ memory 第二行 with nuance');
    expect(observations[0].liveContext.fervor).toBe(65);
});
test.each(['missing-census', 'bad-digest', 'unknown-doctrine', 'duplicate', 'truncated-text'])('incomplete capture is rejected: %s', kind => {
    let lines = records();
    if (kind === 'missing-census') lines = lines.filter(l => !l.includes('census/;/sin'));
    if (kind === 'bad-digest') lines[0] = lines[0].replace(catalog().digest, 'bad');
    if (kind === 'unknown-doctrine') lines.splice(1, 0, 'VOTC:FAITH/;/fact/;/doctrine/;/missing');
    if (kind === 'duplicate') lines.splice(2, 0, lines[1]);
    if (kind === 'truncated-text') lines = lines.filter(l => !l.includes('text_end') || !l.endsWith('faith_description'));
    const r = new FaithLogReader(catalog()); expect(lines.map(l => r.read(l)).filter(Boolean)).toHaveLength(0);
});
test('expired captures, malformed snapshots/context and invalid references fail closed', () => {
    let now = 0; const r = new FaithLogReader(catalog(), () => now);
    r.read(records()[0]); now = 30001;
    expect(records().slice(1).map(l => r.read(l)).filter(Boolean)).toHaveLength(0);
    expect(() => validateFaithSnapshot({ ...snapshot(), facts: [] })).toThrow();
    expect(() => validateFaithLiveContext({ fervor: 101 })).toThrow();
    const bad = result(); bad.notes[0].sources = ['not-supplied'];
    expect(() => validateFaithResult({ notes: bad.notes }, faithInput(snapshot(), 'en'))).toThrow();
});
test('one exporter and observer carry both streams without changing the original exporter body', () => {
    const source = 'log_character_v2 = { log = "original" }';
    const extended = extendCharacterExporter(source, true);
    expect(extended).toContain('log = "original"');
    expect(extended.match(/mimir_capture_culture_effect = yes/g)).toHaveLength(1);
    expect(extended.match(/mimir_capture_faith_effect = yes/g)).toHaveLength(1);
    expect(cultureCaptureScript(true)).toContain('mimir_capture_faith_effect = yes');
    const effect = faithCaptureEffect(catalog());
    expect(effect).toContain('trait_is_sin = compassionate');
    expect(effect).toContain('GetFaith.GetFlavorDesc');
    expect(effect).toContain('GetReligion.GetFlavorDesc');
    expect(effect).not.toMatch(/change_fervor|set_faith|add_trait/);
    // Covers descriptions, censuses, live fields and personal flags as well as facts.
    const emitted = Array.from(effect.matchAll(/(\w+)\s*=\s*"VOTC:FAITH\/;\/[^"\n]*"/g));
    expect(emitted.length).toBeGreaterThan(0);
    expect(new Set(emitted.map(record => record[1]))).toEqual(new Set(['debug_log']));
});

test('broad source labels cannot replace supplied descriptions and the observed moral census', () => {
    const input = faithInput(snapshot(), 'en');
    const noDescription = result(); noDescription.notes[0].sources = ['religion:custom_religion'];
    expect(() => validateFaithResult({ notes: noDescription.notes }, input)).toThrow('Cached passage changed');
    const noMoral = result(); noMoral.notes[1].sources = ['doctrine:custom_doctrine'];
    expect(() => validateFaithResult({ notes: noMoral.notes }, input)).toThrow('Cached passage changed');
});

test('canonical personal Zealous observations do not change shared faith evidence or generation input', () => {
    const read = (value?: string) => {
        const lines = records();
        if (value !== undefined) lines.splice(1, 0, 'VOTC:FAITH/;/personal/;/zealous/;/' + value);
        const reader = new FaithLogReader(catalog());
        return lines.map(line => reader.read(line)).find(Boolean)!;
    };
    const yes = read('yes'), no = read('no'), legacy = read();
    expect(yes.characterZealous).toBe(true); expect(no.characterZealous).toBe(false);
    expect(legacy.characterZealous).toBeUndefined();
    expect(yes.snapshot).toEqual(no.snapshot); expect(yes.snapshot).toEqual(legacy.snapshot);
    expect(faithHash(faithInput(yes.snapshot, 'en'))).toBe(faithHash(faithInput(no.snapshot, 'en')));
    expect(buildFaithGenerationMessages(faithInput(yes.snapshot, 'en'))).toEqual(buildFaithGenerationMessages(faithInput(no.snapshot, 'en')));
    expect(faithCaptureEffect(catalog())).toContain('has_trait = zealous');
});

test.each(['invalid-value', 'duplicate', 'unknown-trait'])('invalid personal trait records reject the transaction: %s', kind => {
    const lines = records();
    lines.splice(1, 0, 'VOTC:FAITH/;/personal/;/zealous/;/' + (kind === 'invalid-value' ? 'maybe' : 'yes'));
    if (kind === 'duplicate') lines.splice(2, 0, lines[1]);
    if (kind === 'unknown-trait') lines[1] = lines[1].replace('zealous', 'other_trait');
    const reader = new FaithLogReader(catalog());
    expect(lines.map(line => reader.read(line)).filter(Boolean)).toHaveLength(0);
});
