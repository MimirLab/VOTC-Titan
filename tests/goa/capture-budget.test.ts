import { GoaLogReader } from '../../src/main/goa/goaLog';
import { goaTraitCapture, extendGoaExporter, GoaCaptureCatalog } from '../../src/main/goa/goaBridge';
import { parseCk3Script } from '../../src/main/culture/ck3Script';
import { trimGoaPrompt } from '../../src/main/goa/goaPromptBudget';
import { Message } from '../../src/main/ts/conversation_interfaces';
const digest = 'a'.repeat(64);
const catalog: GoaCaptureCatalog = { version: 1, digest, pack: 'GoA2', packIdentifiers: ['2949767945'],
    traitIds: ['creature_dryad', 'being_void'], missingProviderIds: [], formulaMatches: {}, defenceValues: { shadow: 'wc_shadow_magic_resistance_value' }, longLivedIds: [] };
const begin = `VOTC:GOA/;/begin/;/1/;/${digest}/;/2`;
const end = `VOTC:GOA/;/end/;/${digest}/;/2`;
test('capture uses literal IDs, game sex and game-calculated net values; the copied exporter remains parseable', () => {
    const source = goaTraitCapture(catalog);
    expect(() => parseCk3Script(source)).not.toThrow();
    expect(source).toContain('has_trait = creature_dryad'); expect(source).toContain('is_female = yes');
    expect(source).toContain("THIS.Char.MakeScope.ScriptValue('wc_shadow_magic_resistance_value')");
    expect(source).not.toContain('GetKey'); expect(source).not.toMatch(/\blog\s*=/);
    const exporter = 'log_character_v2 = { log_personality_traits = yes untouched_effect = yes }';
    const extended = extendGoaExporter(exporter, catalog);
    expect(extended).toContain('untouched_effect = yes'); expect(extended).toContain('mimir_log_canonical_traits = yes');
    expect(() => parseCk3Script(extended)).not.toThrow();
    expect(() => extendGoaExporter('log_character_v2 = {}', catalog)).toThrow('Unsupported');
});
test('only complete matching captures become usable; incomplete replacements invalidate old observations', () => {
    const r = new GoaLogReader(digest);
    for (const line of [begin, 'VOTC:GOA/;/count/;/1', 'VOTC:GOA/;/sex/;/female', 'VOTC:GOA/;/trait/;/creature_dryad', 'VOTC:GOA/;/defence/;/shadow/;/-5', end]) r.observeLine(line);
    expect(r.observations.get(2)?.magicDefences).toEqual({ shadow: -5 });
    expect(r.observations.get(2)?.sex).toBe('female');
    r.observeLine(begin); expect(r.observations.has(2)).toBe(false);
    r.observeLine('VOTC:GOA/;/sex/;/male'); r.observeLine(end.replace(digest, 'b'.repeat(64)));
    expect(r.observations.has(2)).toBe(false);
});
test('failed numeric expressions do not create zero defense and campaign changes discard old records', () => {
    const r = new GoaLogReader(digest);
    for (const line of [begin, 'VOTC:GOA/;/count/;/0', 'VOTC:GOA/;/sex/;/male', "VOTC:GOA/;/defence/;/shadow/;/[invalid expression]", end]) r.observeLine(line);
    expect(r.observations.get(2)?.magicDefences).toBeUndefined();
    r.observeLine('VOTC:CAMPAIGN/;/loaded/;/new'); expect(r.observations.size).toBe(0);
});
test('portable census requires four unique decimal digits and exactly that many canonical traits', () => {
    const digits = [0, 1, 2, 3].map(position => `VOTC:GOA/;/count_digit/;/${position}/;/${position === 0 ? 2 : 0}`);
    const body = ['VOTC:GOA/;/sex/;/female', 'VOTC:GOA/;/trait/;/creature_dryad', 'VOTC:GOA/;/trait/;/being_void'];
    const reader = new GoaLogReader(digest, catalog.traitIds);
    for (const line of [begin, ...[...digits].reverse(), ...body, end]) reader.observeLine(line);
    expect(reader.observations.get(2)?.traitIds).toEqual(['being_void', 'creature_dryad']);
    const malformed = [digits.slice(1), [...digits, digits[0]], [...digits, 'VOTC:GOA/;/count/;/2'],
        digits.map(line => line.replace('count_digit/;/3/;/0', 'count_digit/;/3/;/9')),
        digits.map(line => line.replace('count_digit/;/0/;/2', 'count_digit/;/0/;/3'))];
    for (const census of malformed) {
        for (const line of [begin, ...census, ...body, end]) reader.observeLine(line);
        expect(reader.observations.has(2)).toBe(false);
    }
    reader.observeLine(begin); reader.observeLine(digits[0]); reader.clear();
    for (const line of [begin, ...digits.slice(1), ...body, end]) reader.observeLine(line);
    expect(reader.observations.has(2)).toBe(false);
});
test('budget trimming protects persona, lore and the current turn; insufficient mandatory budget is explicit', () => {
    const persona: Message = { role: 'system', content: 'Persona and complete Warcraft packet.' };
    const older: Message = { role: 'user', content: 'Old dialogue '.repeat(20) };
    const current: Message = { role: 'user', content: 'Current question.' };
    const count = (p: Message[]) => p.reduce((n, m) => n + m.content.length, 0);
    const trimmed = trimGoaPrompt([persona, older, current], [older, current], count, 100, 10);
    expect(trimmed).toEqual([persona, current]);
    expect(() => trimGoaPrompt([persona, current], [current], count, 30, 10)).toThrow('exceed');
});
