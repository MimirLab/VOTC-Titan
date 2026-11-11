import fs from 'fs';
import os from 'os';
import path from 'path';
import { GameData } from '../../src/shared/gameData/GameData';
import { character } from '../culture/fixtures';
import { loadLanguageEngine } from '../../src/main/language/languageEngine';
import { LanguageRenderer } from '../../src/main/language/languageRendering';
import { LanguageConversation, characterLanguages } from '../../src/main/language/languageConversation';
import { ConversationLedger } from '../../src/main/language/conversationLedger';
import { readRecipientHistory, validateLedger } from '../../src/main/language/languageHistory';
import { perceivedMemoryTranscript, promptPerceptionMessages } from '../../src/main/language/conversationView';
import { sourceSpeechSpans } from '../../src/main/language/speechEchoes';
import { mapSpeechSpans } from '../../src/shared/language/speechSpans';
import { tokenizeSpeech } from '../../src/shared/language/tokenizer';
import { maskPercent, learningCurve } from '../../src/main/language/comprehension';
import { Message } from '../../src/main/ts/conversation_interfaces';
import { saveLedgerHistory, loadLedgerHistory } from '../../src/main/language/ledgerStorage';
import { repairControlledPhoneticGaps } from '../../src/main/language/controlledWriter';

const engine = loadLanguageEngine(path.resolve('public/languages'));
function fixture(language = 'language_zandali', renderer: LanguageRenderer = engine.renderer) {
    const native = ['language_common', 'language_orcish', 'language_eredun'].find(id => engine.relations.route(language, [id]).mode === 'FAR')!;
    const game = new GameData(['1', 'Player', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Player', '0']);
    for (const [id, tongue] of [[1, native], [2, language], [3, native], [4, language]] as const) {
        const actor = character(id, 'Actor' + id);
        actor.languageSnapshot = { version: 1, complete: true, learning: 12, nativeLanguageId: tongue, knownLanguageIds: [tongue] };
        game.characters.set(id, actor);
    }
    const ledger = new ConversationLedger(1);
    const session = new LanguageConversation(game, renderer, 'en', true, () => true, () => ledger.messages);
    const record = (content: string, id = 2, observed?: number[]): Message => {
        const message: Message = { role: id === 1 ? 'user' : 'assistant', name: 'Actor' + id, characterId: id,
            proseEncoding: 'controls-v1', content, ...(observed ? { observedByCharacterIds: observed } : {}) };
        session.record(message); ledger.append(message, game.characters.values()); return message;
    };
    const sound = (meaning: string) => renderer.forMode({ originalText: meaning, spokenLanguageId: language,
        speechSpans: [{ start: 0, end: meaning.length }] }, 'FAR').content;
    return { game, ledger, session, record, sound, native };
}

test('a native listener recognizes an echoed foreign word without its hidden meaning reaching the quoter', () => {
    const { record, sound, session, game, ledger } = fixture();
    record('**He waits beside the gate.** ""My brother is missing."" ~~PRIVATE_ORCHID.~~');
    const heardSound = sound('brother');
    const reply = record(`**She points at the empty road.** ""Does '${heardSound}' mean grain?"" ~~PRIVATE_ASTER.~~`, 1);
    expect(reply.utterance!.echoes).toHaveLength(1);
    expect(reply.utterance!.echoes![0].origin!.meaning).toBe('brother');
    const quoter = session.forRecipient(reply, 1), native = session.forRecipient(reply, 2), passive = session.forRecipient(reply, 3);
    expect(quoter.content).toContain(heardSound); expect(quoter.content).not.toContain('brother');
    expect(native.content).toContain("'brother'"); expect(native.content).not.toContain('grain');
    expect(passive.content).toContain(heardSound); expect(passive.content).not.toContain('brother');
    expect(native.speechComprehension).toBe('partial');
    expect(promptPerceptionMessages([native], 2)[0].content).toContain('The surrounding speech is unintelligible.');
    expect(promptPerceptionMessages([quoter], 1)[0].content).toContain('The surrounding speech is intelligible.');
    expect(perceivedMemoryTranscript([native], 2)).toContain('brother');
    expect(perceivedMemoryTranscript([native], 2)).not.toContain('grain');
    expect(perceivedMemoryTranscript([quoter], 1)).not.toContain(heardSound);
    expect(game.characters.get(1)!.languageSnapshot!.knownLanguageIds).toEqual(['language_common']);
    for (const view of [quoter, native, passive]) expect(JSON.stringify(view)).not.toMatch(/"origin"|"echoes"|"meaning"|"hearings"/);
    expect(readRecipientHistory(validateLedger(JSON.parse(JSON.stringify(ledger.snapshot('date', 1)))), 2).at(-1)).toEqual(native);
});

test.each(engine.relations.languageIds())('word and phrase echoes survive %s sounds, including internal apostrophes and joins', language => {
    for (const meaning of ['brother', 'to me', "can't", 'Éloïse']) {
        const { record, sound, session } = fixture(language);
        record(`""${meaning}""`);
        const audible = sound(meaning), reply = record(`""You said '${audible}'; what is that?""`, 1);
        expect(reply.utterance!.echoes).toHaveLength(1);
        expect(reply.utterance!.echoes![0].origin?.meaning.toLowerCase()).toBe(meaning.toLowerCase());
        expect(session.forRecipient(reply, 1).content).toContain(audible);
        expect(session.forRecipient(reply, 2).content).toContain(`'${meaning}'`);
    }
});

test('unquoted foreign strings and quotes only in private/action prose retain the ordinary primary-language path', () => {
    const { record, sound, session } = fixture(); record('""brother""');
    const audible = sound('brother');
    for (const content of [`""Does ${audible} mean grain?""`, `**She traces '${audible}' in chalk.**`, `~~She recalls '${audible}'.~~`]) {
        const reply = record(content, 1);
        expect(reply.utterance!.echoes).toBeUndefined();
        const mode = reply.languageRecord!.hearings['2'].mode;
        expect(session.forRecipient(reply, 2).content).toBe(engine.renderer.forMode(reply.utterance!, mode, 'en', false).content || '[No spoken words or public action is described in this turn.]');
    }
});

test('an unheard or private-only sound cannot create an echo exception', () => {
    const { record, sound } = fixture(); const audible = sound('brother');
    record(`~~He recalls '${audible}'.~~ ""Farewell.""`);
    const privateReply = record(`""What is '${audible}'?""`, 1);
    expect(privateReply.utterance!.echoes).toBeUndefined();
    const absent = fixture(); absent.record('""brother""', 2, [2, 3, 4]);
    const absentReply = absent.record(`""What is '${absent.sound('brother')}'?""`, 1);
    expect(absentReply.utterance!.echoes).toBeUndefined();
});

test('colliding foreign sounds preserve the sound without selecting an invented meaning', () => {
    const renderer = new LanguageRenderer(engine.renderer.close, { word: () => 'krr', render: (text, _language, spans) =>
        mapSpeechSpans(text, spans, speech => [...tokenizeSpeech(speech)].map(token => token.word ? 'krr' : token.text).join('')) }, 'echo-collision');
    const { record, session } = fixture('language_zandali', renderer);
    record('""brother sister""'); const reply = record('""What is \'krr\'?""', 1);
    expect(reply.utterance!.echoes).toHaveLength(1); expect(reply.utterance!.echoes![0].origin).toBeUndefined();
    expect(session.forRecipient(reply, 2).content).not.toMatch(/brother|sister/);
    expect(session.forRecipient(reply, 2).content).toContain("'krr'");
});

test('delivery, reload and source edits pin echo ownership despite later fluency and Learning changes', () => {
    const { record, sound, session, ledger, game } = fixture(); record('""brother""');
    const reply = record(`**😀 She pauses.** ""Does '${sound('brother')}' mean a title?"" ~~PRIVATE_IRIS.~~`, 1);
    const before = session.forRecipient(reply, 3), saved = JSON.stringify(ledger.snapshot('date', 1));
    for (const actor of game.characters.values()) { actor.languageSnapshot!.knownLanguageIds.push('language_zandali'); actor.languageSnapshot!.learning = 100; }
    expect(session.forRecipient(reply, 3)).toEqual(before);
    expect(readRecipientHistory(JSON.parse(saved), 3).at(-1)).toEqual(before);
    session.editForRecipient(reply, 1, reply.content.replace('She pauses.', 'She gestures toward the gate.'));
    expect(session.forRecipient(reply, 3).content).toContain(sound('brother'));
    expect(session.forRecipient(reply, 3).content).not.toContain('brother');
    expect(reply.utterance!.echoes).toHaveLength(1);
    expect(() => validateLedger(JSON.parse(JSON.stringify(ledger.snapshot('date', 1))))).not.toThrow();
    session.editForRecipient(reply, 1, reply.content.replace(`'${sound('brother')}'`, "'something else'"));
    expect(reply.utterance!.echoes).toEqual([]);
});

test('source fragments and opaque offsets stay audible and UTF-16 correct; corrupt echo records reject', () => {
    const { record, sound, ledger, session } = fixture(); record('""brother""');
    const reply = record(`~~😀 Private thought.~~ **She tilts her head.** ""'${sound('brother')},' did you say?""`, 1);
    expect(reply.utterance!.echoes).toHaveLength(1);
    for (const id of [1, 2, 3, 4]) {
        const view = session.forRecipient(reply, id);
        for (const range of view.perceivedOpaqueSpeechSpans ?? []) expect(view.perceivedSpeechSpans!.some(span => range.start >= span.start && range.end <= span.end)).toBe(true);
    }
    const good = JSON.parse(JSON.stringify(ledger.snapshot('date', 1)));
    const corrupt = (edit: (value: any) => void) => { const bad = structuredClone(good); edit(bad.messages.at(-1).utterance.echoes[0]); expect(() => validateLedger(bad)).toThrow(); };
    corrupt(echo => { echo.start = 0; }); corrupt(echo => { delete echo.hearings['2']; });
    corrupt(echo => { echo.hearings['2'].opaque = [{ start: 0, end: 9999 }]; });
    corrupt(echo => { echo.origin.revision = -1; });
    expect(sourceSpeechSpans(reply.utterance!)).toHaveLength(1);
});

test('casual unformatted player replies use the same echo path and remain editable as ordinary prose', () => {
    const { record, sound, session, ledger, game } = fixture(); record('""brother""');
    const reply: Message = { role: 'user', characterId: 1, content: `Does '${sound('brother')}' mean grain?` };
    session.record(reply); ledger.append(reply, game.characters.values());
    expect(reply.utterance!.echoes).toHaveLength(1);
    expect(session.forRecipient(reply, 2).content).toContain("'brother'");
    expect(session.forRecipient(reply, 1, 'reader').editableContent).toBeUndefined();
    expect(() => validateLedger(JSON.parse(JSON.stringify(ledger.snapshot('date', 1))))).not.toThrow();
});

test('a related-language listener gets its own secondary-language hearing, while unknown meaning gains no productive bridge', () => {
    const f = fixture('language_common');
    const relative = character(5, 'Relative'); relative.languageSnapshot = { version: 1, complete: true, learning: 12,
        nativeLanguageId: 'language_low_common', knownLanguageIds: ['language_low_common'] }; f.game.characters.set(5, relative);
    f.record('""brother""'); const reply = f.record(`""What is '${f.sound('brother')}'?""`, 1);
    const originalWord = { spokenLanguageId: 'language_common', originalText: 'brother', speechSpans: [{ start: 0, end: 7 }] };
    const expected = engine.renderer.forListener(originalWord, characterLanguages(relative), 'en', true,
        { speaker: characterLanguages(f.game.characters.get(1)!), addressed: false });
    expect(reply.utterance!.echoes![0].hearings['5'].content).toBe(expected.content);
    expect(reply.utterance!.echoes![0].hearings['5'].comprehension).toBe('partial');
});

test('another observer can repeat a heard echo and a new fluent arrival can recognize it without seeing the original event', () => {
    const { record, sound, game, session } = fixture(); record('""brother""', 2, [1, 2, 4]);
    record(`""What is '${sound('brother')}'?""`, 1);
    const newcomer = character(6, 'Arrival'); newcomer.languageSnapshot = { version: 1, complete: true, learning: 10,
        nativeLanguageId: 'language_zandali', knownLanguageIds: ['language_zandali'] }; game.characters.set(6, newcomer);
    const reply = record(`""I heard '${sound('brother')}' too.""`, 3);
    expect(reply.utterance!.echoes![0].origin!.meaning).toBe('brother');
    expect(session.forRecipient(reply, 6).content).toContain("'brother'");
    expect(session.forRecipient(reply, 3).content).toContain(sound('brother'));
});

test('an ordinary emphasized English word stays in the primary tongue rather than becoming a foreign echo', () => {
    const { record, game } = fixture('language_goblin');
    const contact = engine.relations.cultureRules.find(rule => rule.culture_roots.includes('tirassian') && rule.targets.includes('language_goblin'))!;
    game.characters.get(1)!.languageSnapshot!.cultureFamiliarity = { version: 1, complete: true,
        routingVersion: engine.relations.version, matchedRuleIds: [contact.id] };
    record('""water""'); const reply = record('""I want \'water\', not wine.""', 1);
    expect(reply.utterance!.echoes).toBeUndefined();
});

test('the explicit phonetic marker cleans to ordinary quotes, and fabricated or private markers cannot bypass routing', () => {
    const { record, sound, session } = fixture(); record('""brother""');
    const reply = record(`""Does <<${sound('brother')}>> mean grain?""`, 1);
    expect(reply.utterance!.echoes![0].marker).toBe('phonetic-v1');
    expect(session.forRecipient(reply, 1).content).toContain(`'${sound('brother')}'`);
    expect(session.forRecipient(reply, 2).content).toContain("'brother'");
    expect(session.forRecipient(reply, 1).content).not.toMatch(/<<|>>/);
    expect(() => record('""<<UNHEARD_SECRET_X>>""', 1)).toThrow('not recorded as audible');
    expect(() => record(`~~<<${sound('brother')}>>~~`, 1)).toThrow('not recorded as audible');
});

test('an explicit marker can quote a previously understood language when the primary reply tongue differs', () => {
    const { record, game, session } = fixture('language_zandali');
    game.characters.get(1)!.languageSnapshot!.knownLanguageIds.push('language_zandali');
    record('""brother""'); const reply: Message = { role: 'user', characterId: 1, spokenLanguageId: 'language_common',
        content: '""Does <<brother>> mean kin?""', proseEncoding: 'controls-v1' }; session.record(reply);
    expect(reply.utterance!.spokenLanguageId).toBe('language_common');
    expect(reply.utterance!.echoes![0].origin!.languageId).toBe('language_zandali');
});

test('phonetic markers inside ordinary quotes clean once, while unmatched and nonverbal markers reject', () => {
    const { record, sound, session } = fixture(); record('""brother""');
    const reply = record(`""Did you say '<<${sound('brother')}>>'?""`, 1);
    expect(session.forRecipient(reply, 1).content).toContain(`'${sound('brother')}'`);
    expect(session.forRecipient(reply, 1).content).not.toContain("''");
    expect(session.forRecipient(reply, 2).content).toContain("'brother'");
    for (const text of [`""<<${sound('brother')}""`, `""${sound('brother')}>>""`, `**<<${sound('brother')}>>**`,
        `""<<<<${sound('brother')}>>>>""`]) expect(() => record(text, 1)).toThrow();
});

test('redundant ordinary quotes inside a phonetic marker retain the recognized sound and survive clean editing', () => {
    const { record, sound, session } = fixture(); record('""brother""');
    const first = record(`""What is <<${sound('brother')}>>?""`, 1);
    expect(session.forRecipient(first, 2).content).toContain("'brother'");
    const reply = record('**He nods.** ""You called him <<\'brother\'>>.""', 2);
    expect(reply.utterance!.echoes![0].origin!.meaning).toBe('brother');
    expect(session.forRecipient(reply, 2).content).toContain("'brother'");
    expect(session.forRecipient(reply, 2).content).not.toContain("''brother''");
    const editor = reply.content.replace("<<'brother'>>", "'brother'").replace('He nods.', 'He bows.');
    session.editForRecipient(reply, 2, editor);
    expect(reply.utterance!.echoes).toHaveLength(1);
    expect(reply.utterance!.echoes![0].sound).toBe('brother');
    expect(reply.utterance!.echoes![0].marker).toBeUndefined();
    expect(session.forRecipient(reply, 2).content).toContain("'brother'");
});

test('only a standalone explicit sound control can be locally labelled as speech; action, thoughts and prose stay guarded', () => {
    const { record, sound, session } = fixture(); record('""brother""');
    const standalone = `**She waits.** <<${sound('brother')}>> ""What does that mean?""`;
    const repaired = repairControlledPhoneticGaps(standalone);
    expect(repaired).toBe(`**She waits.** ""<<${sound('brother')}>>"" ""What does that mean?""`);
    expect(session.forRecipient(record(repaired, 1), 2).content).toContain("'brother'");
    for (const control of ['**', '~~']) {
        const privateOrAction = `${control}<<${sound('brother')}>>${control}`;
        expect(repairControlledPhoneticGaps(privateOrAction)).toBe(privateOrAction);
        expect(() => record(repairControlledPhoneticGaps(privateOrAction), 1)).toThrow();
    }
    expect(() => repairControlledPhoneticGaps(`Unlabelled secret prose <<${sound('brother')}>>`)).toThrow('Unlabelled');
    expect(() => record(repairControlledPhoneticGaps('<<UNHEARD_WORD>>'), 1)).toThrow('not recorded as audible');
});

test('an unresolved old CLOSE echo cannot pass its quoter readable fragments to an unrelated bystander', () => {
    const f = fixture('language_goblin');
    const contact = engine.relations.cultureRules.find(rule => rule.culture_roots.includes('tirassian') && rule.targets.includes('language_goblin'))!;
    f.game.characters.get(1)!.languageSnapshot!.cultureFamiliarity = { version: 1, complete: true,
        routingVersion: engine.relations.version, matchedRuleIds: [contact.id] };
    const word = ['brother', 'sister', 'water', 'gate', 'bread', 'merchant', 'north', 'agreement'].find(text =>
        maskPercent(1, 'language_goblin', text) < learningCurve(12, 'recognition'))!;
    const source = f.record(`""${word}""`), hearing = f.session.forRecipient(source, 1);
    const heard = hearing.content.slice(hearing.perceivedSpeechSpans![0].start, hearing.perceivedSpeechSpans![0].end);
    const current = new LanguageRenderer(engine.renderer.close, { render: (text, language, spans) => engine.renderer.forMode(
        { spokenLanguageId: language, originalText: text, speechSpans: spans }, 'FAR').content }, 'unavailable-old-profile');
    const session = new LanguageConversation(f.game, current, 'en', true, () => true, () => [source]);
    const reply: Message = { role: 'user', characterId: 1, content: `""What is '${heard}'?""`, proseEncoding: 'controls-v1' };
    session.record(reply);
    const echo = reply.utterance!.echoes![0]; expect(echo.origin).toBeUndefined();
    expect(echo.hearings['1'].content).toBe(heard);
    const far = current.forMode({ spokenLanguageId: 'language_goblin', originalText: heard,
        speechSpans: [{ start: 0, end: heard.length }] }, 'FAR').content;
    expect(echo.hearings['3'].content).toBe(far); expect(echo.hearings['3'].content).not.toBe(heard);
});

test('clean player editor text can move a marked echo without changing its old meaning or exposing wire markers', () => {
    const { record, sound, session, game } = fixture(); record('""brother""');
    const reply = record(`**She waits.** ""Does <<${sound('brother')}>> mean kin?""`, 1);
    const editor = session.forRecipient(reply, 1, 'reader').editableContent!;
    expect(editor).not.toMatch(/<<|>>/);
    for (const actor of game.characters.values()) actor.languageSnapshot!.knownLanguageIds.push('language_zandali');
    session.editForRecipient(reply, 1, editor.replace('She waits.', 'She points toward the gate.'), 'reader');
    expect(reply.utterance!.echoes).toHaveLength(1);
    expect(session.forRecipient(reply, 2).content).toContain("'brother'");
    expect(session.forRecipient(reply, 3).content).not.toContain("'brother'");
    expect(() => session.editForRecipient(reply, 1, reply.content + ' ""<<UNRECORDED>>""')).toThrow('unrecorded');
});

test('a bystander does not inherit the quoter cultural CLOSE fragments through an echo', () => {
    const { record, game, session } = fixture('language_goblin');
    const contact = engine.relations.cultureRules.find(rule => rule.culture_roots.includes('tirassian') && rule.targets.includes('language_goblin'))!;
    game.characters.get(1)!.languageSnapshot!.cultureFamiliarity = { version: 1, complete: true,
        routingVersion: engine.relations.version, matchedRuleIds: [contact.id] };
    const word = ['brother', 'sister', 'water', 'gate', 'bread', 'merchant', 'north', 'agreement'].find(text =>
        maskPercent(1, 'language_goblin', text) < learningCurve(12, 'recognition'))!;
    expect(word).toBeDefined(); const source = record(`""${word}""`);
    const closeSound = session.forRecipient(source, 1).content.slice(1, -1);
    const reply = record(`""What is '${closeSound}'?""`, 1);
    expect(reply.utterance!.echoes).toHaveLength(1);
    const echo = reply.utterance!.echoes![0];
    expect(echo.hearings['1'].content).toBe(closeSound);
    const expectedFar = engine.renderer.forMode({ spokenLanguageId: 'language_goblin', originalText: word,
        speechSpans: [{ start: 0, end: word.length }] }, 'FAR').content;
    expect(echo.hearings['3'].content).toBe(expectedFar);
    expect(echo.hearings['3'].comprehension).toBe('unintelligible');
});

test('a longer explicitly quoted heard phrase is preserved without an arbitrary word-count cutoff', () => {
    const { record, sound, session } = fixture();
    const meaning = 'to me for us on to the old gate by the road';
    record(`""${meaning}""`);
    const audible = sound(meaning); expect(audible.length).toBeLessThan(240);
    const reply = record(`""What did '${audible}' mean?""`, 1);
    expect(reply.utterance!.echoes).toHaveLength(1);
    expect(reply.utterance!.echoes![0].origin!.meaning).toBe(meaning);
    expect(session.forRecipient(reply, 2).content).toContain(`'${meaning}'`);
});

test('smart quotation typography preserves internal click apostrophes', () => {
    const cases = engine.relations.languageIds().flatMap(language => ['brother', 'sister', 'temple', 'mother'].map(meaning => {
        const f = fixture(language); return { ...f, language, meaning, audible: f.sound(meaning) };
    }));
    const found = cases.find(value => value.audible.includes("'"))!;
    expect(found).toBeDefined(); found.record(`""${found.meaning}""`);
    const typographic = found.audible.replace(/'/g, '’');
    const reply = found.record(`""What is ‘${typographic}’?""`, 1);
    expect(reply.utterance!.echoes).toHaveLength(1);
    expect(reply.utterance!.echoes![0].origin!.meaning).toBe(found.meaning);
    expect(found.session.forRecipient(reply, 2).content).toContain(found.meaning);
});

test('campaign and compatibility history indexes reload one canonical echo ledger without exposing its origin', () => {
    const { record, sound, ledger, session } = fixture(); record('""brother""');
    const reply = record(`""What is '${sound('brother')}'?""`, 1);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-echo-history-'));
    try {
        const canonical = path.join(temp, 'canonical'), campaign = path.join(temp, 'campaign');
        const snapshot = ledger.snapshot('date', 1);
        saveLedgerHistory(canonical, 'entry', snapshot); saveLedgerHistory(campaign, 'entry', snapshot, canonical);
        expect(fs.readdirSync(path.join(canonical, '.language-ledgers'))).toHaveLength(1);
        expect(fs.existsSync(path.join(campaign, '.language-ledgers'))).toBe(false);
        for (const id of [1, 2, 3, 4]) {
            const loaded = loadLedgerHistory(campaign, 'entry', id, canonical)!.messages.at(-1)!;
            expect(loaded).toEqual(session.forRecipient(reply, id));
            expect(JSON.stringify(loaded)).not.toMatch(/"origin"|"echoes"|"meaning"|"hearings"/);
        }
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('registered historical sound profiles can resolve old echoes, while unknown revisions preserve sound without inventing meaning', () => {
    const old = new LanguageRenderer(engine.renderer.close, { word: () => 'oldkr', render: (text, _language, spans) =>
        mapSpeechSpans(text, spans, speech => [...tokenizeSpeech(speech)].map(token => token.word ? 'oldkr' : token.text).join('')) }, 'historical-echo');
    const f = fixture('language_zandali', old); const source = f.record('""brother""');
    const make = (registered: boolean) => {
        const current = new LanguageRenderer(engine.renderer.close, { render: (text, language, spans) => engine.renderer.forMode(
            { spokenLanguageId: language, originalText: text, speechSpans: spans }, 'FAR').content }, 'current-echo');
        if (registered) Object.assign(current, { recordedProfile: (fingerprint: string) => fingerprint === old.fingerprint ? old : undefined });
        const session = new LanguageConversation(f.game, current, 'en', true, () => true, () => [source]);
        const reply: Message = { role: 'user', characterId: 1, content: '""What is \'oldkr\'?""', proseEncoding: 'controls-v1' };
        session.record(reply); return reply;
    };
    expect(make(false).utterance!.echoes![0].origin).toBeUndefined();
    expect(make(true).utterance!.echoes![0].origin!.meaning).toBe('brother');
});

test('the shipped historical CLOSE archive recognizes a sound delivered before the current voice revision', () => {
    const archive = JSON.parse(fs.readFileSync('public/languages/voice-revisions.json', 'utf8')).engines[0];
    const old = engine.renderer.recordedProfile(archive.fingerprint)!;
    expect(old).toBeDefined();
    const f = fixture('language_goblin', old);
    const contact = engine.relations.cultureRules.find(rule => rule.culture_roots.includes('tirassian') && rule.targets.includes('language_goblin'))!;
    f.game.characters.get(1)!.languageSnapshot!.cultureFamiliarity = { version: 1, complete: true,
        routingVersion: engine.relations.version, matchedRuleIds: [contact.id] };
    const word = ['brother', 'sister', 'water', 'gate', 'bread', 'merchant', 'north', 'agreement'].find(text =>
        maskPercent(1, 'language_goblin', text) < learningCurve(12, 'recognition'))!;
    const source = f.record(`""${word}""`), heard = f.session.forRecipient(source, 1);
    const range = heard.perceivedSpeechSpans![0], sound = heard.content.slice(range.start, range.end);
    const current = new LanguageConversation(f.game, engine.renderer, 'en', true, () => true, () => [source]);
    const reply: Message = { role: 'user', characterId: 1, proseEncoding: 'controls-v1', content: `""What does <<${sound}>> mean?""` };
    current.record(reply);
    expect(reply.utterance!.echoes![0].origin!.meaning).toBe(word);
    expect(current.forRecipient(reply, 2).content).toContain(`'${word}'`);
    expect(current.forRecipient(reply, 1).content).toContain(`'${sound}'`);
});

test('narration-only editing by a bilingual reader preserves the opaque echoed source for monolingual listeners', () => {
    const { record, sound, session, game, ledger } = fixture();
    game.characters.get(1)!.languageSnapshot!.knownLanguageIds.push('language_zandali');
    record('""brother""');
    const reply = record(`**He gestures.** ""Does '${sound('brother')}' mean grain?""`, 3);
    const editor = session.forRecipient(reply, 1, 'reader').editableContent!;
    expect(editor).toContain("'brother'");
    const before = session.forRecipient(reply, 3).content;
    session.editForRecipient(reply, 1, editor.replace('He gestures.', 'He nods.'), 'reader');
    expect(session.forRecipient(reply, 3).content).toBe(before.replace('He gestures.', 'He nods.'));
    expect(session.forRecipient(reply, 3).content).not.toContain('brother');
    expect(reply.utterance!.originalText).toContain(sound('brother'));
    expect(() => validateLedger(JSON.parse(JSON.stringify(ledger.snapshot('date', 1))))).not.toThrow();
});
