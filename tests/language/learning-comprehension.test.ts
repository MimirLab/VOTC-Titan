import fs from 'fs';
import path from 'path';
import { loadLanguageEngine } from '../../src/main/language/languageEngine';
import { canonicalCharacterId, comprehensionPlan, learningCurve, maskPercent, MASK_VERSION, normalizeMaskWord } from '../../src/main/language/comprehension';
import { selectSpokenLanguage, CharacterLanguageKnowledge } from '../../src/main/language/languageRouting';
import { LanguageConversation } from '../../src/main/language/languageConversation';
import { ConversationLedger } from '../../src/main/language/conversationLedger';
import { readRecipientHistory } from '../../src/main/language/languageHistory';
import { perceivedMemoryTranscript, promptPerceptionMessages } from '../../src/main/language/conversationView';
import { languageCaptureCatalog, languageCaptureBody, LanguageLogReader } from '../../src/main/language/languageCapture';
import { GameData } from '../../src/shared/gameData/GameData';
import { tokenizeSpeech } from '../../src/shared/language/tokenizer';
import { character, catalog, fact } from '../culture/fixtures';
import { Message } from '../../src/main/ts/conversation_interfaces';
import { createHash } from 'crypto';

const engine = loadLanguageEngine(path.resolve('public/languages'));
const knowledge = (id: number, native: string, learning = 10, extra: Partial<CharacterLanguageKnowledge> = {}): CharacterLanguageKnowledge =>
    ({ characterId: id, nativeLanguageId: native, learnedLanguageIds: [], learning, ...extra });

test('smooth curves retain the approved floors, improve at every attainable point and cap above 100', () => {
    expect(learningCurve(0, 'mutual')).toBe(70); expect(learningCurve(0, 'recognition')).toBe(25);
    expect(learningCurve(0, 'production')).toBe(15);
    for (const belt of ['mutual', 'recognition', 'production'] as const) {
        for (let score = 0; score < 100; score++) {
            expect(learningCurve(score + .01, belt)).toBeGreaterThan(learningCurve(score, belt));
            expect(learningCurve(score + 1, belt)).toBeGreaterThan(learningCurve(score, belt));
        }
        expect(learningCurve(1000, belt)).toBe(learningCurve(100, belt));
    }
    expect(learningCurve(30, 'mutual')).toBeCloseTo(89.56656, 4);
    expect(learningCurve(10, 'recognition')).toBeCloseTo(39.83560, 4);
    for (let score = 0; score <= 100; score++)
        expect(learningCurve(score, 'production')).toBeLessThan(learningCurve(score, 'recognition'));
    expect(() => learningCurve(NaN, 'mutual')).toThrow();
});

const goldens: { owner: string; language: string; word: string; percent: number }[] =
    JSON.parse(fs.readFileSync(path.resolve('tests/language/mask-learning-v2.json'), 'utf8'));
test.each(goldens)
    ('independent Python SHA-256 golden: $owner / $language / $word', vector => {
        expect(maskPercent(vector.owner, vector.language, vector.word)).toBe(vector.percent);
    });
test('canonical IDs and mask normalization retain original contract, including valid zero and wide decimal strings', () => {
    expect(canonicalCharacterId(' 00042 ')).toBe('42'); expect(canonicalCharacterId(0)).toBe('0');
    expect(canonicalCharacterId('9007199254740993')).toBe('9007199254740993');
    for (const bad of [undefined, null, '', -1, 1.5, 9007199254740992, '1e3']) expect(() => canonicalCharacterId(bad)).toThrow();
    expect(normalizeMaskWord('ＡＢＣ Don‘t')).toBe("abc don't");
    expect(normalizeMaskWord('Straße')).toBe('straße'); // JS lowercasing, never full case folding.
});
test('higher cutoffs add words without reshuffling; repeated words and case use the same personal mask', () => {
    const values = Array.from({ length: 500 }, (_, n) => maskPercent(42, 'language_common', 'word' + n));
    for (const cutoff of [25, 40, 55, 75, 90])
        expect(values.filter(n => n < cutoff).every(n => n < cutoff + 5)).toBe(true);
    expect(maskPercent(42, 'language_common', 'Water')).toBe(maskPercent('00042', 'language_common', 'water'));
    expect(maskPercent(42, 'language_common', 'water')).not.toBe(maskPercent(43, 'language_common', 'water'));
});

test('shared actual knowledge remains CLEAR at zero Learning and supplies no family/contact fluency', () => {
    const listener = knowledge(1, 'language_common', 0);
    expect(comprehensionPlan('language_common', listener, engine.relations).belt).toBe('clear');
    expect(listener.learnedLanguageIds).toEqual([]);
});
test('mutual family familiarity and one-way cultural recognition use distinct curves', () => {
    const elf = knowledge(1, 'language_darnassian', 20), other = knowledge(2, 'language_thalassian', 5);
    const mutual = comprehensionPlan('language_thalassian', elf, engine.relations, other);
    expect(mutual).toMatchObject({ belt: 'mutual', owner: '1', language: 'language_thalassian', cutoff: learningCurve(20, 'mutual') });
    const goblin = knowledge(3, 'language_goblin', 20, { currentCultureId: 'goblin' });
    const one = comprehensionPlan('language_common', goblin, engine.relations, knowledge(4, 'language_common'));
    expect(one).toMatchObject({ belt: 'recognition', cutoff: learningCurve(20, 'recognition') });
});
test('productive assistance uses the speaker and a real known bridge; overhearers and fluent bridges cannot create it', () => {
    const goblin = knowledge(2, 'language_goblin', 30, { currentCultureId: 'goblin' });
    const human = knowledge(1, 'language_common', 50);
    const plan = comprehensionPlan('language_goblin', human, engine.relations, goblin, true);
    expect(plan).toMatchObject({ mode: 'FAR', belt: 'assisted', owner: '2', language: 'language_common', cutoff: learningCurve(30, 'production') });
    expect(plan.cutoff).toBeLessThan(learningCurve(30, 'recognition'));
    expect(comprehensionPlan('language_goblin', human, engine.relations, goblin, false).belt).toBe('far');
    expect(comprehensionPlan('language_goblin', human, engine.relations, { ...goblin, learnedLanguageIds: ['language_common'] }, true).belt).toBe('far');
    expect(comprehensionPlan('language_goblin', { ...human, learning: 0 }, engine.relations, goblin, true).cutoff).toBe(25);
    expect(comprehensionPlan('language_goblin', human, engine.relations, { ...goblin, learning: undefined }, true).belt).toBe('far');
    expect(comprehensionPlan('language_thalassian', { ...human, nativeLanguageId: 'language_darnassian', characterId: undefined }, engine.relations, goblin).belt).toBe('far');
});
test('selection compares every actually known tongue, preserves shared fluency and respects explicit choice', () => {
    const source = knowledge(1, 'language_common', 30, { learnedLanguageIds: ['language_orcish'] });
    const target = knowledge(2, 'language_zandali', 10, { currentCultureId: 'darkspear' });
    expect(selectSpokenLanguage(source, target, undefined, [], engine.relations)).toBe('language_orcish');
    expect(selectSpokenLanguage(source, target, 'language_common', [], engine.relations)).toBe('language_common');
    expect(selectSpokenLanguage(source, { ...target, learnedLanguageIds: ['language_common'] }, undefined, [], engine.relations)).toBe('language_common');
    expect(() => selectSpokenLanguage(source, target, 'language_zandali', [], engine.relations)).toThrow('does not know');
});

function encounter() {
    const game = new GameData(['1', 'Player', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Player', '0']);
    const contact = engine.relations.cultureRules.find(rule => rule.culture_roots.includes('goblin') && rule.targets.includes('language_common'))!;
    for (const [id, native, learning] of [[1, 'language_common', 30], [2, 'language_goblin', 50],
        [3, 'language_common', 0], [4, 'language_common', 50]] as const) {
        const actor = character(id, 'Actor' + id);
        actor.languageSnapshot = { version: 1, complete: true, learning, nativeLanguageId: native, knownLanguageIds: [native],
            cultureFamiliarity: { version: 1, complete: true, routingVersion: engine.relations.version,
                matchedRuleIds: id === 2 ? [contact.id] : [] } };
        game.characters.set(id, actor);
    }
    const session = new LanguageConversation(game, engine.renderer, 'en', true), ledger = new ConversationLedger(1);
    const message: Message & { targetCharacterIds: number[] } = { id: 'adaptive', role: 'assistant', characterId: 2, name: 'Actor2',
        targetCharacterIds: [1, 3], proseEncoding: 'controls-v1',
        content: '**He holds out an empty cup.** ""Bring water to the gate before dawn. Keep your weapons lowered. I came to negotiate, not to surrender. If you release my brother, we can speak of peace.""\n\n~~SECRET private intention.~~ **He waits.**' };
    session.record(message); ledger.append(message, game.characters.values());
    return { game, session, ledger, message };
}
test('a group has one utterance, different Learning hearings, separate assistance and no private/source leakage', () => {
    const { session, message } = encounter();
    expect(message.languageRecord!.hearings['1'].plan!.belt).toBe('assisted');
    expect(message.languageRecord!.hearings['3'].plan!.cutoff).toBe(25);
    expect(message.languageRecord!.hearings['4'].plan!.belt).toBe('far');
    expect(session.forRecipient(message, 1).content).not.toBe(session.forRecipient(message, 3).content);
    const reader = session.forRecipient(message, 1, 'reader'), heard = session.forRecipient(message, 1);
    expect(reader.content).toContain('SECRET'); expect(heard.content).not.toContain('SECRET');
    expect(reader.perceivedSpeechSpans!.map(span => reader.content.slice(span.start, span.end)))
        .toEqual(heard.perceivedSpeechSpans!.map(span => heard.content.slice(span.start, span.end)));
    expect(JSON.stringify(heard)).not.toMatch(/originalText|languageRecord|"plan"|"owner"|"cutoff"|matchedRuleIds/);
    expect(heard.content).toContain('He holds out an empty cup.'); expect(heard.content).toContain('\n\n');
});
test('two CLOSE recipients retain separate personal vocabularies without overwriting their shared-mode views', () => {
    const { game, message } = encounter();
    for (const id of [1, 3]) game.characters.get(id)!.languageSnapshot = {
        version: 1, complete: true, learning: 10, nativeLanguageId: 'language_low_common', knownLanguageIds: ['language_low_common'] };
    game.characters.get(2)!.languageSnapshot = { version: 1, complete: true, learning: 20,
        nativeLanguageId: 'language_common', knownLanguageIds: ['language_common'] };
    const fresh: Message = { role: 'assistant', characterId: 2, content: message.content, proseEncoding: 'controls-v1' };
    const session = new LanguageConversation(game, engine.renderer, 'en', true); session.record(fresh);
    expect(fresh.languageRecord!.hearings['1'].mode).toBe('CLOSE');
    expect(fresh.languageRecord!.hearings['3'].mode).toBe('CLOSE');
    expect(fresh.languageRecord!.hearings['1'].variant).not.toBe(fresh.languageRecord!.hearings['3'].variant);
    expect(session.forRecipient(fresh, 1).content).not.toBe(session.forRecipient(fresh, 3).content);
});
test('identical delivered text shares one variant while each hearing retains its own plan', () => {
    const { game, message } = encounter(); game.characters.get(3)!.languageSnapshot!.learning = 100;
    const fresh: Message & { targetCharacterIds: number[] } = { role: 'assistant', characterId: 2, content: message.content,
        proseEncoding: 'controls-v1', targetCharacterIds: [1, 3] };
    new LanguageConversation(game, engine.renderer, 'en', true).record(fresh);
    expect(fresh.languageRecord!.hearings['1'].variant).toBe(fresh.languageRecord!.hearings['3'].variant);
    expect(fresh.languageRecord!.hearings['1'].plan).not.toBe(fresh.languageRecord!.hearings['3'].plan);
});
test('prompts and memories preserve recognizable assisted fragments and permit mistaken interpretations', () => {
    const { session, message } = encounter(), heard = session.forRecipient(message, 1);
    const framed = promptPerceptionMessages([heard], 1)[0], memory = perceivedMemoryTranscript([heard], 1);
    expect(framed.content).toContain('may be mistaken'); expect(framed.content).not.toContain('meaning is unknown; do not translate');
    expect(memory).toContain('[unrecognized speech]'); expect(memory).not.toContain('SECRET');
    for (const span of heard.perceivedOpaqueSpeechSpans!) expect(memory).not.toContain(heard.content.slice(span.start, span.end));
    const firstSpeech = heard.perceivedSpeechSpans![0];
    const visibleTokens = [...tokenizeSpeech(heard.content.slice(firstSpeech.start, firstSpeech.end))].filter(token => token.word).map(token => token.text);
    expect(visibleTokens.some(word => memory.includes(word))).toBe(true);
    expect(perceivedMemoryTranscript([session.forRecipient(message, 4)], 4)).toContain('[Unintelligible Goblin speech.]');
});
test('explicit unaccommodated speech disables assistance without reducing intrinsic recognition', () => {
    const { session } = encounter();
    const message: Message & { targetCharacterIds: number[] } = { id: 'private-tongue', role: 'assistant', characterId: 2,
        content: '"Bring water."', targetCharacterIds: [1], spokenLanguageId: 'language_goblin', languageAccommodation: 'none' };
    session.record(message);
    expect(message.languageRecord!.hearings['1'].plan!.belt).toBe('far');
    expect(session.forRecipient(message, 1).languageAccommodation).toBeUndefined();
});
test('a non-English source safely uses FAR instead of exposing unfiltered words through English CLOSE rules', () => {
    const utterance = { spokenLanguageId: 'language_common', originalText: '"Bonjour mon ami."' };
    const rendered = engine.renderer.forPlan(utterance, { version: MASK_VERSION, mode: 'CLOSE', belt: 'recognition',
        cutoff: 60, owner: '1', language: 'language_common' }, 'fr');
    expect(rendered.plan!.belt).toBe('far'); expect(rendered.content).not.toContain('Bonjour');
});
test('JSON replay, source edits, future Learning, culture changes and language acquisition retain frozen hearing plans', () => {
    const { game, session, ledger, message } = encounter();
    const before = session.forRecipient(message, 1).content, plan = { ...message.languageRecord!.hearings['1'].plan! };
    const snapshot = JSON.parse(JSON.stringify(ledger.snapshot('date', 1)));
    expect(readRecipientHistory(snapshot, 1)[0].content).toBe(before);
    game.characters.get(1)!.languageSnapshot!.learning = 100;
    game.characters.get(1)!.languageSnapshot!.knownLanguageIds.push('language_goblin');
    game.characters.get(2)!.languageSnapshot!.cultureFamiliarity!.matchedRuleIds = [];
    expect(session.forRecipient(message, 1).content).toBe(before);
    session.editForRecipient(message, 2, '**He gestures.** ""Water will arrive tomorrow, after the gate opens."" ~~SECRET new intention.~~');
    expect(message.languageRecord!.hearings['1'].plan).toEqual(plan);
    expect(session.forRecipient(message, 1).content).not.toContain('SECRET');
    expect(() => readRecipientHistory(JSON.parse(JSON.stringify(ledger.snapshot('date', 1))), 1)).not.toThrow();
});
test('the installed-parent sound fingerprint and old full-CLOSE source editing survive the new mask engine', () => {
    const json = (name: string) => JSON.parse(fs.readFileSync(path.resolve('public/languages', name), 'utf8'));
    const previous = createHash('sha256').update(JSON.stringify([{ routing: json('routing.json'), close: json('close-profiles.json'),
        far: json('far-profiles.json'), casefold: json('unicode-casefold.json').fold }, 'titan-demo'])).digest('hex');
    expect(engine.renderer.fingerprint).toBe(previous);
    const { game } = encounter();
    game.characters.get(1)!.languageSnapshot = { version: 1, complete: true, nativeLanguageId: 'language_low_common', knownLanguageIds: ['language_low_common'] };
    game.characters.get(2)!.languageSnapshot = { version: 1, complete: true, nativeLanguageId: 'language_common', knownLanguageIds: ['language_common'] };
    const legacy = new LanguageConversation(game, engine.renderer), message: Message = {
        role: 'assistant', characterId: 2, content: '"Bring water."' };
    legacy.record(message); message.languageRecord!.fingerprint = previous;
    expect(message.languageRecord!.hearings['1'].plan).toBeUndefined();
    game.characters.get(1)!.languageSnapshot!.learning = 100;
    legacy.editForRecipient(message, 2, '"Water before dawn."');
    expect(legacy.forRecipient(message, 1).content).toBe('"Waeter befoire dawn."');
    expect(message.languageRecord!.hearings['1'].plan).toBeUndefined();
});
test.each(['owner', 'cutoff', 'opaque', 'reader'])('corrupt %s metadata fails closed on persisted replay', defect => {
    const { ledger } = encounter(); const value = JSON.parse(JSON.stringify(ledger.snapshot('date', 1)));
    const record = value.messages[0].languageRecord, hearing = record.hearings['1'];
    if (defect === 'owner') hearing.plan.owner = '999';
    if (defect === 'cutoff') hearing.plan.cutoff = 101;
    if (defect === 'opaque') record.variantOpaqueSpeech[hearing.variant][0].start = -1;
    if (defect === 'reader') record.reader.hearing.plan.cutoff = 1;
    expect(() => readRecipientHistory(value, 1)).toThrow();
});

test.each(engine.relations.languageIds())('mixed %s preserves exact word encoders and full FAR/CLEAR compatibility', language => {
    const source = '**He nods.** ""Bring WATER, water—before dawn!"" ~~Private.~~';
    const utterance = { spokenLanguageId: language, originalText: source, proseEncoding: 'controls-v1' as const };
    const plan = { version: MASK_VERSION, mode: 'CLOSE' as const, belt: 'recognition' as const, cutoff: 45.25, owner: '12', language } as const;
    const rendered = engine.renderer.forPlan(utterance, plan, 'en', false);
    const expected = [...tokenizeSpeech('Bring WATER, water—before dawn!')].map(token => !token.word ? token.text
        : maskPercent('12', language, token.text) < plan.cutoff ? engine.renderer.close.word(token.text, language)
        : (engine.renderer as any).far.word(token.text, language)).join('');
    const span = rendered.spans!.speechSpans[0]; expect(rendered.content.slice(span.start, span.end)).toBe(expected);
    expect(rendered.content).toContain('*He nods.*'); expect(rendered.content).not.toContain('Private');
    expect(engine.renderer.forPlan(utterance, { version: MASK_VERSION, mode: 'FAR', belt: 'far', cutoff: 0 }, 'en', false).content)
        .toBe(engine.renderer.forMode(utterance, 'FAR', 'en', false).content);
    expect(engine.renderer.forPlan(utterance, { version: MASK_VERSION, mode: 'CLEAR', belt: 'clear', cutoff: 100 }, 'en', false).content)
        .toBe(engine.renderer.forMode(utterance, 'CLEAR', 'en', false).content);
});

test('Learning is emitted through the existing bridge and required exactly once in complete current frames', () => {
    const inventory = languageCaptureCatalog({ ...catalog(), facts: engine.relations.languageIds().map(id => fact('pillar', id, 'language')) }, engine.relations)!;
    expect(languageCaptureBody(inventory)).toContain("[THIS.Char.GetSkill('learning')|0]");
    const frame = [`VOTC:LANGUAGE/;/begin/;/1/;/${inventory.digest}`, 'VOTC:LANGUAGE/;/native/;/language_common',
        'VOTC:LANGUAGE/;/learning/;/150', ...inventory.languageIds.map(id => `VOTC:LANGUAGE/;/known/;/${id}/;/${Number(id === 'language_common')}`),
        ...inventory.cultureRules!.map(rule => `VOTC:LANGUAGE/;/contact/;/${rule.id}/;/0`),
        ...inventory.practiceRules!.map(rule => `VOTC:LANGUAGE/;/practice/;/${rule.id}/;/0`), 'VOTC:LANGUAGE/;/study_complete', 'VOTC:LANGUAGE/;/end'];
    const reader = new LanguageLogReader(inventory); frame.forEach(line => reader.observe(line));
    expect(reader.snapshot(1)?.learning).toBe(150);
    for (const defect of ['missing', 'duplicate', 'negative', 'decimal', 'unsafe']) {
        const bad = [...frame];
        if (defect === 'missing') bad.splice(2, 1);
        else if (defect === 'duplicate') bad.splice(2, 0, bad[2]);
        else bad[2] = 'VOTC:LANGUAGE/;/learning/;/' + ({ negative: '-1', decimal: '1.5', unsafe: '9007199254740992' } as any)[defect];
        bad.forEach(line => reader.observe(line)); expect(reader.snapshot(1)).toBeUndefined();
    }
});
