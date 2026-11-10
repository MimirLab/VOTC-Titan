import path from 'path';
import { GameData } from '../../src/shared/gameData/GameData';
import { character } from '../culture/fixtures';
import { LanguageConversation } from '../../src/main/language/languageConversation';
import { loadLanguageEngine } from '../../src/main/language/languageEngine';
import { ConversationLedger } from '../../src/main/language/conversationLedger';
import { readRecipientHistory, validateLedger } from '../../src/main/language/languageHistory';
import { perceivedMemoryTranscript, promptPerceptionMessages } from '../../src/main/language/conversationView';
import { Message } from '../../src/main/ts/conversation_interfaces';
import { parseControlledProse, controlledProseView } from '../../src/shared/language/controlledProse';

const engine = loadLanguageEngine(path.resolve('public/languages'));
const source = '**She points to the sign "Home",** ~~remembering the hidden opal and "old words".~~ ""Bring water before dawn.""\n\n**Her hands tremble.**';
test('the generic listener API defaults to a public view even when the listener understands every word', () => {
    const rendered = engine.forListener({ originalText: source, spokenLanguageId: 'language_common', proseEncoding: 'controls-v1' },
        { nativeLanguageId: 'language_common', learnedLanguageIds: [] });
    expect(rendered.content).toContain('Bring water'); expect(rendered.content).not.toContain('hidden opal');
});
function fixture(native = 'language_low_common') {
    const game = new GameData(['1', 'Player', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Player', '0']);
    for (const [id, tongue] of [[1, native], [2, 'language_common'], [3, 'language_orcish'], [4, 'language_common'], [5, 'language_orcish']] as const) {
        const actor = character(id, 'Actor' + id); actor.languageSnapshot = { version: 1, complete: true, nativeLanguageId: tongue, knownLanguageIds: [tongue] };
        game.characters.set(id, actor);
    }
    const session = new LanguageConversation(game, engine.renderer), ledger = new ConversationLedger(game.playerID);
    const message: Message = { id: 'controlled', role: 'assistant', characterId: 2, name: 'Actor2', content: source, proseEncoding: 'controls-v1' };
    session.record(message); ledger.append(message, game.characters.values());
    return { game, session, ledger, message };
}
test('one source supports owned thoughts, human prose and three language comprehension modes without knowledge leakage', () => {
    const { session, message, ledger } = fixture();
    const reader = session.forRecipient(message, 1, 'reader'), player = session.forRecipient(message, 1);
    expect(reader.content).toContain('hidden opal'); expect(reader.content).toContain('Bring waeter');
    expect(reader.editableContent).toContain('~~remembering'); expect(reader.editableContent).toContain('""Bring waeter');
    expect(reader.editableContent).not.toContain('Bring water');
    expect(player.content).not.toMatch(/opal|old words/); expect(player.editableContent).toBeUndefined();
    expect(session.forRecipient(message, 2).content).toContain('hidden opal');
    expect(session.forRecipient(message, 4).content).toContain('Bring water'); expect(session.forRecipient(message, 4).content).not.toContain('opal');
    expect(session.forRecipient(message, 3).content).not.toMatch(/Bring water|opal|old words/);
    expect(message.languageRecord!.hearings['3'].variant).toBe(message.languageRecord!.hearings['5'].variant);
    expect(Object.keys(message.languageRecord!.variants)).toHaveLength(5);
    expect(message.content).toBe(source); expect(ledger.messages).toHaveLength(1);
    expect(JSON.stringify(player)).not.toMatch(/originalText|proseEncoding|variantSpans|hearings|~~/);
});
test('memory placeholders use recorded audible offsets, preserving quoted written signs and owned quoted memories', () => {
    const { session, message } = fixture();
    const far = session.forRecipient(message, 3), before = JSON.stringify(far);
    const memory = perceivedMemoryTranscript([far], 3);
    expect(memory).toContain('sign "Home"'); expect(memory).toContain('[Unintelligible Common speech.]');
    expect(memory).not.toContain('opal'); expect(memory).not.toContain('Bring water');
    const noted = promptPerceptionMessages([far], 3)[0];
    expect(noted.content.slice(noted.perceivedSpeechSpans![0].start, noted.perceivedSpeechSpans![0].end)).toBe(
        far.content.slice(far.perceivedSpeechSpans![0].start, far.perceivedSpeechSpans![0].end));
    expect(JSON.stringify(far)).toBe(before);
    expect(perceivedMemoryTranscript([session.forRecipient(message, 2)], 2)).toContain('"old words"');
    expect(() => perceivedMemoryTranscript([session.forRecipient(message, 1, 'reader')], 1)).toThrow('Literary reader');
    expect(() => session.messagesForRecipient([session.forRecipient(message, 1, 'reader')], 1)).toThrow('literary view');
});

test('owned inner prose stays explicitly unspoken at writer and memory boundaries while exact audible offsets survive', () => {
    const { session, message } = fixture();
    const owner = session.forRecipient(message, 2), before = JSON.stringify(owner);
    const framed = promptPerceptionMessages([owner], 2)[0];
    expect(framed.content).toContain('[Private inner narration, unspoken: remembering the hidden opal and "old words".]');
    expect(framed.content.slice(framed.perceivedSpeechSpans![0].start, framed.perceivedSpeechSpans![0].end)).toBe('Bring water before dawn.');
    expect(framed.perceivedPrivateSpans).toBeUndefined();
    expect(perceivedMemoryTranscript([owner], 2)).toContain('[Private inner narration, unspoken:');
    expect(promptPerceptionMessages([framed], 2)[0]).toEqual(framed);
    expect(JSON.stringify(owner)).toBe(before);
    expect(session.forRecipient(message, 1).perceivedPrivateSpans).toBeUndefined();
    expect(session.forRecipient(message, 1, 'reader').perceivedPrivateSpans).toBeUndefined();
    expect(() => promptPerceptionMessages([{ ...owner, characterId: 1 }], 2)).toThrow('only to their author');
});
test('saved replay preserves separate knowledge/reader policies and refuses missing or corrupt boundaries', () => {
    const { ledger, message } = fixture(); const raw = JSON.stringify(ledger.snapshot('date', 1));
    const stored = validateLedger(JSON.parse(raw));
    expect(readRecipientHistory(stored, 1, 'reader')[0].content).toContain('opal');
    expect(readRecipientHistory(stored, 1)[0].content).not.toContain('opal');
    expect(() => readRecipientHistory(stored, 3, 'reader')).toThrow('encountered player');
    const bad = JSON.parse(raw); delete bad.messages[0].languageRecord.variantSpans;
    expect(() => validateLedger(bad)).toThrow('controlled source');
    const corrupt = JSON.parse(raw); corrupt.messages[0].languageRecord.hearings['3'] = message.languageRecord!.hearings['2'];
    expect(() => validateLedger(corrupt)).toThrow('boundaries');
    expect(JSON.stringify(ledger.snapshot('date', 1))).toBe(raw);
});
test('source edits preserve thought categories, original language/audience and historical comprehension', () => {
    const { game, session, ledger, message } = fixture('language_common');
    const reader = session.forRecipient(message, 1, 'reader');
    game.characters.get(3)!.languageSnapshot!.knownLanguageIds.push('language_common');
    session.editForRecipient(message, 1, reader.editableContent!.replace('hidden opal', 'hidden amber').replace('Bring water', 'Bring bread'), 'reader');
    ledger.changed(); validateLedger(ledger.snapshot('date', 1));
    expect(session.forRecipient(message, 2).content).toContain('hidden amber');
    expect(session.forRecipient(message, 4).content).toContain('Bring bread');
    expect(session.forRecipient(message, 4).content).not.toContain('amber');
    expect(session.forRecipient(message, 3).comprehensionMode).toBe('FAR');
    const before = JSON.stringify(message);
    expect(() => session.editForRecipient(message, 1, 'She now says ordinary untyped words.', 'reader')).toThrow('Unlabelled');
    expect(JSON.stringify(message)).toBe(before);
});
test('foreign reader edits change only that reader and player knowledge, retaining private narration and source', () => {
    const { session, ledger, message } = fixture(); const other = session.forRecipient(message, 4).content;
    const reader = session.forRecipient(message, 1, 'reader');
    session.editForRecipient(message, 1, reader.editableContent!.replace('Bring waeter', 'My heard spelling').replace('hidden opal', 'hidden amber'), 'reader');
    ledger.changed(); validateLedger(ledger.snapshot('date', 1));
    expect(session.forRecipient(message, 1, 'reader').content).toContain('hidden amber');
    expect(session.forRecipient(message, 1).content).toContain('My heard spelling');
    expect(session.forRecipient(message, 1).content).not.toContain('amber');
    expect(session.forRecipient(message, 2).content).toContain('hidden opal');
    expect(session.forRecipient(message, 4).content).toBe(other); expect(message.content).toBe(source);
});
test('malformed controlled generation commits no hearing, and departed speakers keep already delivered views', () => {
    const { session, message, game } = fixture(); const before = session.forRecipient(message, 1, 'reader').content;
    const bad: Message = { role: 'assistant', characterId: 2, content: '**A gesture ~~crossed.**~~', proseEncoding: 'controls-v1' };
    expect(() => session.record(bad)).toThrow('Crossed'); expect(bad.utterance).toBeUndefined(); expect(bad.languageRecord).toBeUndefined();
    game.characters.delete(2); game.characters.get(1)!.languageSnapshot!.knownLanguageIds.push('language_common');
    expect(session.forRecipient(message, 1, 'reader').content).toBe(before);
});
test.each(engine.relations.languageIds())('controlled %s speech reuses the exact original CLEAR/CLOSE/FAR vocabulary', language => {
    const raw = '**She waits.** ~~Her hidden memory contains "old words".~~ ""Bring water before dawn.""\n\n""Can I sit by you?""';
    const clean = controlledProseView(parseControlledProse(raw), true);
    for (const mode of ['CLEAR', 'CLOSE', 'FAR'] as const) {
        const controlled = engine.renderer.forMode({ originalText: raw, spokenLanguageId: language, proseEncoding: 'controls-v1' }, mode);
        const legacy = engine.renderer.forMode({ originalText: clean.content, spokenLanguageId: language, speechSpans: clean.speechSpans }, mode);
        expect(controlled.content).toBe(legacy.content);
        expect(controlled.spans!.speechSpans).toHaveLength(2);
    }
});
