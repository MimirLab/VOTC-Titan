import fs from 'fs';
import path from 'path';
import { GameData } from '../../src/shared/gameData/GameData';
import { character, catalog, fact } from '../culture/fixtures';
import { CloseProfiles } from '../../src/main/language/closeProfiles';
import { CloseEncoder } from '../../src/main/language/closeEncoder';
import { FarEncoder } from '../../src/main/language/farEncoder';
import { LanguageRenderer } from '../../src/main/language/languageRendering';
import { LanguageConversation } from '../../src/main/language/languageConversation';
import { languageCaptureCatalog, languageCaptureBody, LanguageLogReader } from '../../src/main/language/languageCapture';
import { Message } from '../../src/main/ts/conversation_interfaces';
import { playerSpeechSpans } from '../../src/shared/language/playerSpeech';
import { mapSpeechSpans } from '../../src/shared/language/speechSpans';
import { recipientHistory, readRecipientHistory } from '../../src/main/language/languageHistory';
import { encounterScript, encounterTargets } from '../../src/main/background/EncounterCapture';
import { parseCk3Script } from '../../src/main/culture/ck3Script';

const data = (name: string) => JSON.parse(fs.readFileSync(path.resolve('public/languages', name), 'utf8'));
const renderer = new LanguageRenderer(new CloseEncoder(new CloseProfiles(data('close-profiles.json'), data('routing.json'))),
    new FarEncoder(data('far-profiles.json'), 'titan-demo', data('unicode-casefold.json').fold));
function setup() {
    const game = new GameData(['1', 'Player', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Player', '0']);
    for (const [id, name, native] of [[1, 'Player', 'language_low_common'], [2, 'Speaker', 'language_common'],
        [3, 'Outsider', 'language_orcish']] as const) {
        const c = character(id, name); c.languageSnapshot = { version: 1, complete: true, nativeLanguageId: native, knownLanguageIds: [native] };
        game.characters.set(id, c);
    }
    return { game, session: new LanguageConversation(game, renderer) };
}
const source = '*She sets down the cup.* "Bring water to the gate before dawn."\n\n*Her hands tremble.*';

test('one recorded utterance supplies CLEAR, CLOSE and FAR views with identical action paragraphs', () => {
    const { session } = setup(); const message: Message = { role: 'assistant', characterId: 2, name: 'Speaker', content: source };
    session.record(message);
    expect(message.utterance?.spokenLanguageId).toBe('language_common');
    expect(session.forRecipient(message, 2).content).toBe(source);
    expect(session.forRecipient(message, 1).content).toContain('"Bring waeter to dhe gaete befoire dawn."');
    const far = session.forRecipient(message, 3);
    expect(far.content).not.toContain('Bring water');
    expect(far.content).toMatch(/^\*She sets down the cup\.\* ".*"\n\n\*Her hands tremble\.\*$/);
    expect(far.utterance).toBeUndefined(); expect(far.recipientRenderings).toBeUndefined();
});
test('spoken language stays pinned when listener knowledge changes, and projected history never encodes twice', () => {
    const { game, session } = setup(); const message: Message = { role: 'assistant', characterId: 2, content: source };
    session.record(message); const before = session.forRecipient(message, 1);
    game.getPlayer().languageSnapshot!.knownLanguageIds.push('language_common');
    expect(session.forRecipient(message, 1).content).toBe(before.content);
    expect(session.forRecipient(before, 1)).toEqual(before);
    expect(() => session.forRecipient(before, 3)).toThrow('another listener');
});
test('an edit rerenders original words and preserves the pinned spoken language', () => {
    const { session } = setup(); const message: Message = { role: 'assistant', characterId: 2, content: source };
    session.record(message); session.editForRecipient(message, 2, '*She waits.* "Water before dawn."');
    expect(session.forRecipient(message, 1).content).toBe('*She waits.* "Waeter befoire dawn."');
    expect(message.utterance?.spokenLanguageId).toBe('language_common');
});
test('bare player speech is rendered while italic actions and OOC instructions keep their exact bytes', () => {
    const text = '*I nod.* Bring water. [OOC: wait] *I wave.*';
    expect(mapSpeechSpans(text, playerSpeechSpans(text), s => renderer.close.speech(s, 'language_common')))
        .toBe('*I nod.* Bring waeter. [OOC: wait] *I wave.*');
    const { session } = setup(); const message: Message = { role: 'user', content: text };
    session.record(message); expect(session.forRecipient(message, 3).content).not.toContain('Bring water');
    expect(session.forRecipient(message, 3).content).toContain('[OOC: wait] *I wave.*');
});
test('player span offsets retain CRLF, escaped stars, Unicode and natural paragraphs', () => {
    for (const text of ['Bring\r\nwater.\n\n*I nod.*', '\\*Bring water.\\*', '🙂 *I nod.* "Bring water."']) {
        const output = mapSpeechSpans(text, playerSpeechSpans(text), s => s);
        expect(output).toBe(text);
    }
});
test('nested italic actions stay outside speech even inside bold emphasis', () => {
    const text = '**Bring *I nod* water.**';
    expect(mapSpeechSpans(text, playerSpeechSpans(text), s => renderer.close.speech(s, 'language_common')))
        .toBe('**Bring *I nod* waeter.**');
});
test('explicit actor knowledge selects once for an AI target, including an overhearing outsider', () => {
    const { game, session } = setup(); game.characters.get(2)!.languageSnapshot!.knownLanguageIds.push('language_orcish');
    const message: Message & { targetCharacterIds: number[] } = {
        role: 'assistant', characterId: 2, content: source, targetCharacterIds: [3] };
    session.record(message); expect(message.spokenLanguageId).toBe('language_orcish');
    expect(session.forRecipient(message, 3).content).toBe(source);
    expect(session.forRecipient(message, 1).content).not.toContain('Bring water');
});
test('missing complete knowledge blocks language-enabled dialogue', () => {
    const { game, session } = setup(); delete game.characters.get(3)!.languageSnapshot;
    expect(() => session.record({ role: 'assistant', characterId: 2, content: source })).toThrow('snapshot');
});
test('placeholders, narrator, scenes and action notices are never encoded', () => {
    const { session } = setup();
    for (const type of ['placeholder', 'scene', 'action', 'narrative']) {
        const message: Message = { role: 'assistant', type, characterId: 2, content: '"Bring water."' };
        expect(session.forRecipient(message, 3)).toEqual(message);
    }
});
test('persisted views survive JSON replay without source fields or accidental translation', () => {
    const { session } = setup(); const message: Message = { role: 'assistant', characterId: 2, content: source };
    const stored = recipientHistory('1066.9.15', session.historyRecords([message]));
    const json = JSON.stringify(stored); expect(json).not.toContain('originalText'); expect(json).not.toContain('recipientRenderings');
    const replayed = readRecipientHistory(JSON.parse(json), 3);
    expect(replayed[0].content).not.toContain('Bring water'); expect(session.forRecipient(replayed[0], 3)).toEqual(replayed[0]);
    expect(() => readRecipientHistory(JSON.parse(json), 99)).toThrow('Missing');
    expect(() => recipientHistory('date', { 3: [message] })).toThrow('projected');
});

describe('native and learned language capture', () => {
    const culture = { ...catalog(), facts: [fact('pillar', 'language_common', 'language'), fact('pillar', 'language_orcish', 'language'),
        fact('pillar', 'language_low_common', 'language')] };
    const capture = languageCaptureCatalog(culture)!;
    const lines = (id = 2, native = 'language_common') => [
        `VOTC:LANGUAGE/;/begin/;/${id}/;/${capture.digest}`, `VOTC:LANGUAGE/;/native/;/${native}`,
        'VOTC:LANGUAGE/;/learning/;/1',
        ...capture.languageIds.map(language => `VOTC:LANGUAGE/;/known/;/${language}/;/${language === 'language_orcish' ? 0 : 1}`),
        'VOTC:LANGUAGE/;/study_complete', 'VOTC:LANGUAGE/;/end'];
    test('requires GoA IDs and a complete inventory, preserving culture data', () => {
        expect(languageCaptureCatalog(catalog())).toBeUndefined();
        const before = JSON.stringify(culture); languageCaptureCatalog(culture); expect(JSON.stringify(culture)).toBe(before);
        const reader = new LanguageLogReader(capture); lines().forEach(s => reader.observe('[debug] ' + s));
        expect(reader.snapshot(2)?.knownLanguageIds.sort()).toEqual(['language_common', 'language_low_common']);
    });
    test('native knowledge is observed from the cultural pillar even when it is absent from learned-language results', () => {
        const reader = new LanguageLogReader(capture);
        lines().map(s => s.replace('known/;/language_common/;/1', 'known/;/language_common/;/0')).forEach(s => reader.observe(s));
        expect(reader.snapshot(2)?.knownLanguageIds).toContain('language_common');
    });
    test.each(['missing', 'duplicate', 'foreign', 'bad value', 'extra field', 'two natives', 'wrong digest', 'unsafe id'])('%s frame cannot establish comprehension', kind => {
        let frame = lines();
        if (kind === 'missing') frame.splice(2, 1);
        if (kind === 'duplicate') frame.splice(3, 0, frame[2]);
        if (kind === 'foreign') frame.splice(3, 0, 'VOTC:LANGUAGE/;/known/;/language_unknown/;/1');
        if (kind === 'bad value') frame[2] = frame[2].replace(/1$/, 'yes');
        if (kind === 'extra field') frame[2] += '/;/extra';
        if (kind === 'two natives') frame.splice(2, 0, frame[1]);
        if (kind === 'wrong digest') frame[0] = frame[0].replace(capture.digest, 'bad');
        if (kind === 'unsafe id') frame[0] = frame[0].replace('/;/2/;/', '/;/9007199254740992/;/');
        const reader = new LanguageLogReader(capture); frame.forEach(s => reader.observe(s)); expect(reader.snapshot(2)).toBeUndefined();
    });
    test('new incomplete frames, stale observations and campaign reloads invalidate old knowledge', () => {
        let now = 100; const reader = new LanguageLogReader(capture, () => now); lines().forEach(s => reader.observe(s));
        reader.observe(lines()[0]); expect(reader.snapshot(2)).toBeUndefined();
        lines().forEach(s => reader.observe(s)); now += 15001; expect(reader.snapshot(2)).toBeUndefined();
        lines().forEach(s => reader.observe(s)); reader.observe('VOTC:CAMPAIGN/;/loaded/;/42'); expect(reader.snapshot(2)).toBeUndefined();
    });
    test('production capture remains a parseable read-only effect in the existing participant scopes', () => {
        const { game } = setup(); const script = encounterScript({ languages: capture }, encounterTargets(game, [1, 2]), 'a'.repeat(24));
        expect(() => parseCk3Script(script)).not.toThrow(); expect(script).toContain('knows_language = language_orcish');
        expect(script).toContain('position = 1'); expect(script).toContain('exists = root');
        expect(languageCaptureBody(capture)).not.toContain('set_');
    });
});

test('a plural explicit audience uses their shared fluent tongue and preserves an explicit player choice',()=>{
    const {game,session}=setup();
    game.characters.get(1)!.languageSnapshot!.knownLanguageIds.push('language_orcish');
    game.characters.get(2)!.languageSnapshot!.knownLanguageIds.push('language_orcish');
    const message:Message & {targetCharacterIds:number[]}={role:'user',content:'Bring water.',targetCharacterIds:[2,3]};
    session.record(message);expect(message.spokenLanguageId).toBe('language_orcish');
    const explicit:Message & {targetCharacterIds:number[]}={role:'user',content:'Bring water.',targetCharacterIds:[2,3],spokenLanguageId:'language_low_common'};
    session.record(explicit);expect(explicit.spokenLanguageId).toBe('language_low_common');
});
