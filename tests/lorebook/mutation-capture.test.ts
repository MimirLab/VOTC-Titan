import { LoreMutationCatalog, LoreMutationLogReader, loreMutationCaptureBody } from '../../src/main/lorebook/loreMutationCapture';

const a = 'tlm_' + 'a'.repeat(24), b = 'tlm_' + 'b'.repeat(24);
const digest = 'c'.repeat(64);
function catalog(): LoreMutationCatalog {
    return { version: 1, digest, mod_version: '0.6.5', supplement_sha256: 'd'.repeat(64),
        source_pins: {}, patch_pins: {}, memory_owner_policies: ['ordinary', 'fallen'],
        points: [a, b].map((token, index) => ({ token, branch_id: `goa:branch:sample.${index}:0`, path: 'events/sample.txt',
            definition: `sample.${index}`, definition_sha256: 'e'.repeat(64), accepted_definition_sha256: 'e'.repeat(64),
            option_index: 0, marker_line: null, account_kind: 'coded_choice', title: 'A choice', memory_type: token,
            owner_scope: 'root', actual_callback_alias: false, phase: 'executable_body_completed', entry_ids: ['entry-' + index] })) };
}
function emit(reader: LoreMutationLogReader, ...lines: string[]): void {
    lines.forEach(line => reader.observeLine('VOTC:LORE_MUTATION/;/' + line));
}
function begin(actor = 2, day = 102): string { return `begin/;/1/;/${digest}/;/${actor}/;/${day}/;/603/;/1/;/3`; }
function world(): string[] { return [`world/;/${a}/;/100`, `world/;/${b}/;/missing`]; }
function memory(actor = 2, token = a, owner = 'ordinary', day = 100): string {
    return `memory/;/${actor}/;/${token}_${owner}/;/${day}/;/603/;/1/;/1`;
}
function end(actor = 2): string { return `end/;/${digest}/;/${actor}`; }

test('a complete current-save frame retains an owned turning and distinguishes unobserved world state', () => {
    const reader = new LoreMutationLogReader(catalog());
    emit(reader, begin(), ...world(), memory(), end());
    const value = reader.observations.get(2)!;
    expect(value.memories).toHaveLength(1);
    expect(value.memories[0].date).toEqual({ totalDays: 100, year: 603, month: 1, day: 1, display: '603.1.1' });
    expect(value.world[b]).toBeNull();
});

test('literal digit transport assembles the stored game day without locale or epoch conversion', () => {
    const reader = new LoreMutationLogReader(catalog());
    const digits = ['0', '0', '1', '0', '0', '0', '0'].map((digit, position) => `world_digit/;/${a}/;/${position}/;/${digit}`);
    emit(reader, begin(), ...digits, world()[1], memory(), end());
    expect(reader.observations.get(2)!.world[a]).toBe(100);
});

function compactWorld(): string[] {
    return [`world_start/;/${a}`,
        ...['0', '0', '1', '0', '0', '0', '0'].map((digit, position) => `world_digit/;/${position}/;/${digit}`),
        `world_end/;/${a}`];
}

test('the loaded helper protocol binds literal digits to one sealed world token', () => {
    const reader = new LoreMutationLogReader(catalog());
    emit(reader, begin(), ...compactWorld(), world()[1], memory(), end());
    expect(reader.observations.get(2)!.world[a]).toBe(100);
});

test.each(['unsealed', 'wrong seal', 'nested start', 'missing digit', 'duplicate digit', 'unbound digit'])
('an incomplete or mixed helper frame (%s) cannot publish a snapshot', fault => {
    const lines = compactWorld();
    if (fault === 'unsealed') lines.pop();
    if (fault === 'wrong seal') lines[lines.length - 1] = `world_end/;/${b}`;
    if (fault === 'nested start') lines.splice(2, 0, `world_start/;/${b}`);
    if (fault === 'missing digit') lines.splice(2, 1);
    if (fault === 'duplicate digit') lines.splice(2, 0, lines[1]);
    if (fault === 'unbound digit') lines.shift();
    const reader = new LoreMutationLogReader(catalog());
    emit(reader, begin(), ...lines, world()[1], memory(), end());
    expect(reader.observations.size).toBe(0);
});

test.each(['missing', 'duplicate', 'outside'])('an invalid digit census (%s) withdraws the frame', fault => {
    const reader = new LoreMutationLogReader(catalog());
    const digits = ['0', '0', '1', '0', '0', '0', '0'].map((digit, position) => `world_digit/;/${a}/;/${position}/;/${digit}`);
    if (fault === 'missing') digits.pop();
    if (fault === 'duplicate') digits.splice(3, 0, digits[1]);
    if (fault === 'outside') digits[6] = `world_digit/;/${a}/;/7/;/0`;
    emit(reader, begin(), ...digits, world()[1], memory(), end());
    expect(reader.observations.size).toBe(0);
});

test('a global event without a personal memory grants no character knowledge', () => {
    const reader = new LoreMutationLogReader(catalog());
    emit(reader, begin(), ...world(), end());
    expect(reader.observations.get(2)!.world[a]).toBe(100);
    expect(reader.observations.get(2)!.memories).toEqual([]);
});

test('actual CK3 script dates are not equated with the memory datamodel day origin', () => {
    const reader = new LoreMutationLogReader(catalog());
    emit(reader, begin(), `world/;/${a}/;/99`, world()[1], memory(), end());
    expect(reader.observations.get(2)!.memories[0].date.totalDays).toBe(100);
    expect(reader.observations.get(2)!.world[a]).toBe(99);
});

test.each([
    ['missing world census', () => [begin(), world()[0], memory(), end()]],
    ['duplicated world token', () => [begin(), ...world(), world()[0], end()]],
    ['another actor memory', () => [begin(), ...world(), memory(3), end()]],
    ['unknown receipt', () => [begin(), ...world(), memory(2, 'tlm_' + 'f'.repeat(24)), end()]],
    ['future memory numeric date', () => [begin(), ...world(), memory(2, a, 'ordinary', 103), end()]],
    ['future world date', () => [begin(), `world/;/${a}/;/104`, world()[1], end()]],
    ['memory whose world occurrence is absent', () => [begin(), ...world(), memory(2, b), end()]],
    ['unsupported mind owner', () => [begin(), ...world(), memory(2, a, 'replacement'), end()]],
    ['different seal actor', () => [begin(), ...world(), memory(), end(3)]],
])('%s remains unavailable', (_, lines) => {
    const reader = new LoreMutationLogReader(catalog());
    emit(reader, ...lines());
    expect(reader.observations.size).toBe(0);
});

test('starting an incomplete replacement immediately withdraws the old snapshot', () => {
    const reader = new LoreMutationLogReader(catalog());
    emit(reader, begin(), ...world(), memory(), end());
    expect(reader.observations.has(2)).toBe(true);
    emit(reader, begin());
    expect(reader.observations.has(2)).toBe(false);
});

test('a stale producer edition cannot retain earlier observations', () => {
    const reader = new LoreMutationLogReader(catalog());
    emit(reader, begin(), ...world(), memory(), end());
    emit(reader, begin().replace(digest, 'f'.repeat(64)), ...world(), memory(), end());
    expect(reader.observations.size).toBe(0);
});

test('a save reload and rewind rebuild awareness from the loaded save alone', () => {
    const reader = new LoreMutationLogReader(catalog());
    emit(reader, begin(), ...world(), memory(), end());
    reader.observeLine('VOTC:CAMPAIGN/;/loaded/;/a different checkpoint');
    expect(reader.observations.size).toBe(0);
    emit(reader, begin(2, 99), `world/;/${a}/;/missing`, world()[1], end());
    expect(reader.observations.get(2)!.memories).toEqual([]);
    expect(reader.observations.get(2)!.world[a]).toBeNull();
});

test('a fallen-controller memory retains its owner instead of relabeling the host', () => {
    const reader = new LoreMutationLogReader(catalog());
    emit(reader, begin(), ...world(), memory(2, a, 'fallen'), end());
    expect(reader.observations.get(2)!.memories[0].owner).toBe('fallen');
});

test('a new live turning invalidates an already prepared historical view immediately', () => {
    const reader = new LoreMutationLogReader(catalog());
    emit(reader, begin(), ...world(), memory(), end());
    const before = reader.epoch;
    emit(reader, 'changed');
    expect(reader.observations.size).toBe(0);
    expect(reader.epoch).toBeGreaterThan(before);
});

test('an unrelated global turning does not interrupt RP or withdraw the owned chapter', () => {
    const reader = new LoreMutationLogReader(catalog());
    emit(reader, begin(), ...world(), memory(), end());
    const snapshot = reader.observations.get(2);
    emit(reader, `changed/;/${b}/;/world`);
    expect(reader.observations.get(2)).toBe(snapshot);
});

test('a related world turning withdraws stale accounts without making its outcome known', () => {
    const c = catalog(); c.points[1].entry_ids = c.points[0].entry_ids;
    const reader = new LoreMutationLogReader(c);
    emit(reader, begin(), ...world(), memory(), end());
    emit(reader, `changed/;/${b}/;/world`);
    expect(reader.observations.size).toBe(0);
});

test('new personal knowledge invalidates its recipient even for an unrelated subject', () => {
    const reader = new LoreMutationLogReader(catalog());
    emit(reader, begin(), ...world(), memory(), end());
    emit(reader, `changed/;/${b}/;/2`);
    expect(reader.observations.size).toBe(0);
});

test('explicit report dependencies retain the conservative whole-world binding', () => {
    const reader = new LoreMutationLogReader(catalog());
    emit(reader, begin(), ...world(), memory(), end());
    reader.setDependencies(2, new Set([a, b]));
    emit(reader, `changed/;/${b}/;/world`);
    expect(reader.observations.size).toBe(0);
});

test('a private attempted plot elsewhere does not interrupt the character merely because its subject overlaps', () => {
    const c = catalog(); c.points[1].entry_ids = c.points[0].entry_ids; c.points[1].account_kind = 'attempt';
    const reader = new LoreMutationLogReader(c);
    emit(reader, begin(), ...world(), memory(), end());
    const before = reader.observations.get(2);
    emit(reader, `changed/;/${b}/;/world`);
    expect(reader.observations.get(2)).toBe(before);
});

test('capture uses owned numeric memory dates and no separate asynchronous request', () => {
    const body = loreMutationCaptureBody(catalog());
    expect(body).toContain('CharacterMemory.GetCreationDate.GetYear');
    expect(body).toContain('has_memory_category = titan_lore');
    expect(body).toContain(`world/;/${a}/;/missing`);
    expect(body).not.toContain('create_character_memory');
    expect(body).not.toContain('set_global_variable');
    expect(body).not.toContain('trigger_event');
});

test('malformed capture identifiers cannot inject script commands', () => {
    const value = catalog(); value.points[0].token = 'x } death = yes';
    expect(() => loreMutationCaptureBody(value)).toThrow('Invalid lore mutation catalogue');
});
