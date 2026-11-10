import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { Character } from '../../src/shared/gameData/Character';
import { GoaSnapshot } from '../../src/shared/gameData/GoaSnapshot';
import { castingCatalogue } from '../../src/main/audio/castingCatalog';
import { resolveVoiceCasting, normalizeCastingChoices, composeVoiceDesign } from '../../src/main/audio/acousticCasting';
import { acousticDelivery, literalDigest } from '../../src/main/audio/acousticDelivery';
import { getVerifiedGoaSnapshot } from '../../src/main/goa/goaRuntime';
import { currentCastingCapture, getAcousticCulture } from '../../src/main/audio/castingRuntime';
import { CastingLogReader, castingCaptureBody } from '../../src/main/audio/castingCapture';
jest.mock('../../src/main/goa/goaRuntime', () => ({ getVerifiedGoaSnapshot: jest.fn(), currentGoaCatalog: () => undefined }));
jest.mock('../../src/main/audio/castingRuntime', () => ({ currentCastingCapture: jest.fn(), getAcousticCulture: jest.fn() }));
let actor: Character;
beforeEach(() => {
    (app as any).getAppPath = () => path.resolve('.'); jest.clearAllMocks();
    actor = { id: 2, age: 35, sex: 'male' } as Character;
    (currentCastingCapture as jest.Mock).mockReturnValue(undefined);
});
function body(traitIds: string[], sex: 'male' | 'female' = 'male', currentBody?: string): void {
    (getVerifiedGoaSnapshot as jest.Mock).mockReturnValue({ version: 1, characterId: 2, digest: 'a'.repeat(64), traitIds, sex, currentBody, facts: {} } satisfies GoaSnapshot);
}
test('the exact authored catalogue retains all profiles, routes, accents, faith aliases and intentional nulls', () => {
    const c = castingCatalogue();
    expect(Object.keys(c.anatomy)).toHaveLength(115); expect(Object.keys(c.races)).toHaveLength(92);
    expect(Object.keys(c.cultures)).toHaveLength(166); expect(Object.keys(c.faithDelivery)).toHaveLength(35);
    expect(c.anatomy['096'].male).toBeNull(); expect(c.anatomy['052'].male).toBeNull(); expect(c.anatomy['053'].female).toBeNull();
    expect(c.cultures.wc_dummy).toBeUndefined(); expect(c.faithDelivery.lunar_devotional_arc.faithIds).toEqual(['kaldorei_religion', 'rushism']);
    const source = fs.readFileSync('tests/audio/fixtures/goa-casting-source-r3.1.txt', 'utf8');
    for (const item of Object.values(c.anatomy)) for (const sex of ['male', 'female'] as const) if (item[sex]) expect(source).toContain(item[sex]);
    for (const paragraph of Object.values(c.cultures)) expect(source).toContain(paragraph);
    for (const item of Object.values(c.faithDelivery)) expect(source).toContain(item.instruction);
});
test('every native route selects its own ordinary anatomy, independently of a different culture', () => {
    const c = castingCatalogue();
    for (const [key, route] of Object.entries(c.races)) for (const sex of ['male', 'female'] as const) {
        body([key], sex); const id = key === 'creature_dryad' && sex === 'male' ? '053' : route.default;
        if (c.anatomy[id][sex] === null) { expect(() => resolveVoiceCasting(actor, { cultureId: 'gilnean' })).toThrow('no voice profile'); continue; }
        const result = resolveVoiceCasting(actor, { cultureId: 'gilnean' });
        expect(result.anatomyId).toBe(id); expect(result.anatomyCore).toBe(c.anatomy[id][id === '084' ? 'male' : sex]); expect(result.cultureCore).toBe(c.cultures.gilnean);
    }
});
test('tauren resonance and Gilnean Cockney cadence are composed directly without averaging or changing the script', () => {
    body(['creature_tauren']); const casting = resolveVoiceCasting(actor, { cultureId: 'gilnean' });
    const brief = composeVoiceDesign(casting, 'A slight dry grain and precise gently rounded consonants distinguish this individual.');
    expect(brief).toContain('cavernous bovine throat'); expect(brief).toContain('Cockney accent'); expect(brief).not.toContain('human throat');
    const line = 'The agreed price is twelve silver pieces.';
    expect(acousticDelivery({ kind: 'speech', text: line, passage: 0 }, 'A young adult voice.').renderText).toBe(line);
});
test('naga presentations remain different under the identical Nazja culture; dryad/keeper and banshee restrictions stay distinct', () => {
    body(['creature_naga'], 'male'); const male = resolveVoiceCasting(actor, { cultureId: 'naga' });
    body(['creature_naga'], 'female'); const female = resolveVoiceCasting(actor, { cultureId: 'naga' });
    expect(male.anatomyCore).toContain('reptilian bass'); expect(female.anatomyCore).toContain('ringing elven resonance'); expect(male.cultureCore).toBe(female.cultureCore);
    body(['creature_dryad'], 'male'); expect(resolveVoiceCasting(actor, { cultureId: 'dryad' }).anatomyId).toBe('053');
    body(['creature_banshee'], 'male'); expect(() => resolveVoiceCasting(actor, { cultureId: '' })).toThrow('no voice profile');
    expect(resolveVoiceCasting(actor, { anatomyId: '096', presentation: 'female', cultureId: '' }).explicit).toBe(true);
});
test('a dragon in a human current form keeps its learned accent while its reference key changes; years never change the key', () => {
    body(['creature_black_dragon']); const dragon = resolveVoiceCasting(actor, { cultureId: 'black_dragon' });
    body(['creature_black_dragon'], 'male', 'creature_human'); const human = resolveVoiceCasting(actor, {}, dragon);
    expect(human.anatomyId).toBe('001'); expect(human.cultureCore).toBe(dragon.cultureCore); expect(human.formKey).not.toBe(dragon.formKey);
    actor.age = 600; expect(resolveVoiceCasting(actor, {}, human).formKey).toBe(human.formKey);
});
test('missing or ambiguous bodies and localized culture names never invent a racial throat or an exact culture key', () => {
    body(['creature_human', 'creature_tauren']); actor.culture = 'Gilnean';
    expect(resolveVoiceCasting(actor).anatomyId).toBeUndefined(); expect(resolveVoiceCasting(actor).cultureId).toBeUndefined();
    expect(() => normalizeCastingChoices({ cultureId: 'wc_dummy' })).toThrow('Unknown culture');
    expect(() => normalizeCastingChoices({ anatomyId: '999' })).toThrow('Unknown Race');
    (currentCastingCapture as jest.Mock).mockReturnValue({}); (getAcousticCulture as jest.Mock).mockReturnValue(undefined);
    expect(() => resolveVoiceCasting(actor)).toThrow('not ready');
    (getAcousticCulture as jest.Mock).mockReturnValue({ version: 1, complete: true, cultureId: 'darkspear' });
    expect(resolveVoiceCasting(actor).cultureCore).toContain('strong Jamaican accent');
});
test('faith affiliation and race/culture lookups cannot insert words, prices, repetitions or events into a literal line', () => {
    const text = 'I will meet you by the river.';
    const plain = acousticDelivery({ kind: 'speech', text, passage: 0 }, 'A mature adult voice.');
    const selected = acousticDelivery({ kind: 'speech', text, passage: 0 }, 'A mature adult voice.', { faithDeliveryId: 'holy_light_benediction' });
    expect(plain.renderText).toBe(text); expect(selected.renderText).toBe(text);
    expect(plain.instruction).not.toContain(castingCatalogue().faithDelivery.holy_light_benediction.instruction);
    expect(selected.instruction).toContain(castingCatalogue().faithDelivery.holy_light_benediction.instruction);
    expect(acousticDelivery({ kind: 'thought', text, passage: 0 }, 'A child voice.').instruction).toContain('Whisper throughout with unvoiced breath');
});
test.each(['male', 'female'] as const)('whispering retains the reference %s speaker and current maturity without resending the design paragraph', sex => {
    const voice = { instruction: 'A dry, raspy goblin voice with clipped consonants and a nasal resonance.', sex };
    const segment = { kind: 'thought' as const, text: 'I should keep this to myself.', passage: 0 };
    const delivery = acousticDelivery(segment, 'A young adult voice.', { direction: 'restrained', voice });
    expect(delivery.renderText).toBe(segment.text); expect(delivery.literalText).toBe(segment.text);
    expect(delivery.instruction).not.toContain(voice.instruction);
    expect(delivery.instruction).toContain(`reference speaker is ${sex}`);
    expect(delivery.instruction).toContain('A young adult voice.');
    expect(delivery.instruction).toContain('Whisper throughout with unvoiced breath');
    expect(delivery.instruction).toContain("reference speaker's vocal texture and accent");
    for (const kind of ['speech', 'narration'] as const) {
        expect(acousticDelivery({ ...segment, kind }, 'Adult.', { voice }).instruction)
            .toBe(acousticDelivery({ ...segment, kind }, 'Adult.').instruction);
    }
});
test.each(['speech', 'thought'] as const)('verified goblin %s receives stronger nasal placement while other races and narrator stay unchanged', kind => {
    const goblin = castingCatalogue().races.creature_goblin.default;
    const segment = { kind, text: 'Keep that lantern by the door.', passage: 0 };
    const voice = { instruction: 'The saved individual voice.', sex: 'male' as const, anatomyId: goblin };
    const delivery = acousticDelivery(segment, 'A mature adult voice.', { voice });
    expect(delivery.instruction).toContain('pronounced goblin nasal honk');
    expect(delivery.instruction).toContain('pitch range'); expect(delivery.renderText).toBe(segment.text);
    expect(acousticDelivery(segment, 'Adult.', { voice: { ...voice, anatomyId: '001', body: 'creature_goblin' } }).instruction)
        .not.toContain('nasal honk'); // The player's selected Race overrides the observed body.
    expect(acousticDelivery({ ...segment, kind: 'narration' }, 'Adult.', { voice }).instruction)
        .toBe(acousticDelivery({ ...segment, kind: 'narration' }, 'Adult.').instruction);
});
test('only digest-anchored explicit upstream events/emphasis/pause positions alter the acoustic rendering', () => {
    const text = 'That was your plan? Then we should try the other door.';
    const delivery = acousticDelivery({ kind: 'speech', text, passage: 0 }, 'A mature adult voice.', {
        literalDigest: literalDigest(text), emphasis: [{ start: 14, end: 18 }], pauses: [{ offset: 19, length: 'brief' }], events: [{ offset: 19, event: 'laugh' }]
    });
    expect(delivery.literalText).toBe(text); expect(delivery.renderText).toBe('That was your plan? (laugh)  Then we should try the other door.');
    expect(delivery.instruction).toContain('"plan"'); expect(delivery.instruction).toContain('brief pause');
    expect(() => acousticDelivery({ kind: 'speech', text: 'Grog maen.', passage: 0 }, 'Adult.', { literalDigest: literalDigest(text), emphasis: [{ start: 14, end: 18 }] })).toThrow('different literary reading');
    expect(() => acousticDelivery({ kind: 'speech', text, passage: 0 }, 'Adult.', { literalDigest: literalDigest(text), events: [{ offset: 15, event: 'laugh' }] })).toThrow('position');
});
test('culture capture accepts only complete exact-key frames and invalidates stale bindings before an incomplete replacement', () => {
    const catalogue = { digest: 'b'.repeat(64), cultureIds: ['gilnean', 'tauren'] };
    let now = 10; const reader = new CastingLogReader(catalogue, () => now);
    const begin = `VOTC:ACOUSTIC/;/begin/;/${catalogue.digest}/;/2`, end = `VOTC:ACOUSTIC/;/end/;/${catalogue.digest}/;/2`;
    reader.observe(begin); reader.observe('VOTC:ACOUSTIC/;/culture/;/gilnean/;/1'); reader.observe('VOTC:ACOUSTIC/;/culture/;/tauren/;/0'); reader.observe(end);
    expect(reader.snapshot(2)?.cultureId).toBe('gilnean');
    reader.observe(begin); expect(reader.snapshot(2)).toBeUndefined(); reader.observe('VOTC:ACOUSTIC/;/culture/;/gilnean/;/1'); reader.observe(end); expect(reader.snapshot(2)).toBeUndefined();
    reader.observe(begin); reader.observe('VOTC:ACOUSTIC/;/culture/;/gilnean/;/1'); reader.observe('VOTC:ACOUSTIC/;/culture/;/tauren/;/1'); reader.observe(end); expect(reader.snapshot(2)).toBeUndefined();
    reader.observe(begin); reader.observe('VOTC:ACOUSTIC/;/culture/;/gilnean/;/0'); reader.observe('VOTC:ACOUSTIC/;/culture/;/tauren/;/0'); reader.observe(end); expect(reader.snapshot(2)?.cultureId).toBeUndefined();
    now += 15001; expect(reader.snapshot(2)).toBeUndefined();
    const script = castingCaptureBody(catalogue); expect(script).toContain('this = culture:gilnean'); expect(script).not.toMatch(/parent|every_character|set_variable/);
});
