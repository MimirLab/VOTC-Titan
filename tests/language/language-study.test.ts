import fs from 'fs';
import path from 'path';
import { loadLanguageEngine } from '../../src/main/language/languageEngine';
import { comprehensionPlan, comprehensionPercent, languageStudyFraction, learningCurve, maskPercent, validateComprehensionPlan } from '../../src/main/language/comprehension';
import { CharacterLanguageKnowledge, selectSpokenLanguage } from '../../src/main/language/languageRouting';
import { languageCaptureBody, languageCaptureCatalog, LanguageLogReader } from '../../src/main/language/languageCapture';
import { LanguageConversation, characterLanguages } from '../../src/main/language/languageConversation';
import { ConversationLedger } from '../../src/main/language/conversationLedger';
import { validateLedger, readRecipientHistory } from '../../src/main/language/languageHistory';
import { languageStudyEffects, languageStudyOnActions, studyVariable } from '../../src/main/language/languageStudyScript';
import { studyGain, validateStudyProgress } from '../../src/shared/gameData/LanguageStudy';
import { parseCk3Script } from '../../src/main/culture/ck3Script';
import { GameData } from '../../src/shared/gameData/GameData';
import { Message } from '../../src/main/ts/conversation_interfaces';
import { character, catalog, fact } from '../culture/fixtures';

const engine = loadLanguageEngine(path.resolve('public/languages'));
const actor = (id: number, native: string, extra: Partial<CharacterLanguageKnowledge> = {}): CharacterLanguageKnowledge =>
    ({ characterId: id, nativeLanguageId: native, learnedLanguageIds: [], learning: 10, ...extra });
const source = actor(2, 'language_goblin'), learner = actor(1, 'language_common');
const plan = (progress: number) => comprehensionPlan('language_goblin',
    { ...learner, studyProgress: { language_goblin: progress } }, engine.relations, source, true);

test('gap filling preserves the base and reaches full CLOSE', () => {
    expect(studyGain(40, .5)).toBe(70); expect(studyGain(40, 0)).toBe(40); expect(studyGain(40, 1)).toBe(100);
    for (const bad of [null, [], { goblin: .5 }, { language_goblin: NaN }, { language_goblin: -.1 }, { language_goblin: 1.01 }])
        expect(() => validateStudyProgress(bad)).toThrow();
});

test('zero study is exactly unchanged; FAR grows without granting fluency or changing intrinsic relationships', () => {
    expect(plan(0)).toEqual(comprehensionPlan('language_goblin', learner, engine.relations, source, true));
    expect(plan(.5)).toMatchObject({ mode: 'CLOSE', belt: 'study', cutoff: 50, owner: '1', language: 'language_goblin' });
    expect(plan(1)).toMatchObject({ mode: 'CLOSE', cutoff: 100 });
    expect(engine.route('language_goblin', learner).mode).toBe('FAR');
    expect(comprehensionPlan('language_goblin', { ...learner, learnedLanguageIds: ['language_goblin'], studyProgress: { language_goblin: .5 } }, engine.relations).belt).toBe('clear');
    expect(() => selectSpokenLanguage({ ...learner, studyProgress: { language_goblin: 1 } }, source, 'language_goblin')).toThrow();
});

test('half the strongest related study applies within the accepted family, with no stacking or contact propagation', () => {
    const elf = actor(1, 'language_common', { studyProgress: { language_thalassian: .6, language_darnassian: .4 } });
    expect(languageStudyFraction(elf, 'language_thalassian', engine.relations)).toBe(.6);
    expect(languageStudyFraction(elf, 'language_darnassian', engine.relations)).toBe(.4);
    expect(languageStudyFraction(elf, 'language_nazja', engine.relations)).toBe(.3);
    expect(languageStudyFraction(elf, 'language_orcish', engine.relations)).toBe(0);
    expect(languageStudyFraction(actor(1, 'language_common', { studyProgress: { language_goblin: 1 } }), 'language_orcish', engine.relations)).toBe(0);
    expect(comprehensionPlan('language_nazja', elf, engine.relations).cutoff).toBe(30);
});

test('study boosts existing recognition and mutual curves without a sudden reciprocity upgrade', () => {
    const goblin = actor(2, 'language_goblin', { currentCultureId: 'goblin', studyProgress: { language_common: .5 } });
    const heard = comprehensionPlan('language_common', goblin, engine.relations, learner);
    expect(heard.belt).toBe('recognition'); expect(heard.cutoff).toBe(studyGain(learningCurve(10, 'recognition'), .5));
    const barelyStudying = { ...learner, studyProgress: { language_goblin: .01 } };
    expect(comprehensionPlan('language_common', goblin, engine.relations, barelyStudying).belt).toBe('recognition');
    const elf = actor(3, 'language_darnassian', { studyProgress: { language_thalassian: .5 } });
    expect(comprehensionPlan('language_thalassian', elf, engine.relations, actor(4, 'language_thalassian')))
        .toMatchObject({ belt: 'mutual', cutoff: studyGain(learningCurve(10, 'mutual'), .5) });
});

test('productive study creates addressed assistance while overhearers remain FAR', () => {
    const studying = { ...source, studyProgress: { language_common: .5 } };
    const assisted = comprehensionPlan('language_goblin', learner, engine.relations, studying, true);
    expect(assisted).toMatchObject({ belt: 'assisted', owner: '2', language: 'language_common', cutoff: learningCurve(10, 'recognition') });
    expect(comprehensionPlan('language_goblin', learner, engine.relations, studying, false).belt).toBe('far');
    expect(comprehensionPlan('language_goblin', learner, engine.relations, { ...studying, learning: undefined }, true).belt).toBe('far');
    const studyingElf = { ...source, studyProgress: { language_thalassian: .6 } };
    expect(comprehensionPlan('language_goblin', actor(1, 'language_darnassian'), engine.relations, studyingElf, true))
        .toMatchObject({ belt: 'assisted', language: 'language_darnassian', cutoff: 30 });
});

test('starting a new study never displaces an existing productive bridge to another known listener language', () => {
    const listener = actor(1, 'language_darnassian', { learnedLanguageIds: ['language_orcish'] });
    const helper = { ...source, currentCultureId: 'goblin' };
    const before = comprehensionPlan('language_goblin', listener, engine.relations, helper, true);
    expect(before).toMatchObject({ belt: 'assisted', language: 'language_orcish' });
    const after = comprehensionPlan('language_goblin', listener, engine.relations,
        { ...helper, studyProgress: { language_darnassian: .01 } }, true);
    expect(after).toEqual(before);
});

test('listener study preserves independent assisted words and unlocks consistent additional vocabulary', () => {
    const helping = { ...source, currentCultureId: 'goblin' };
    const before = comprehensionPlan('language_goblin', learner, engine.relations, helping, true);
    const after = comprehensionPlan('language_goblin', { ...learner, studyProgress: { language_goblin: .5 } }, engine.relations, helping, true);
    expect(after.assistance).toEqual({ owner: before.owner, language: before.language, cutoff: before.cutoff });
    expect(comprehensionPercent(after)).toBe(studyGain(before.cutoff, .5));
    let added = 0, preserved = 0;
    for (let n = 0; n < 100; n++) {
        const text = 'word' + n, utterance = { spokenLanguageId: 'language_goblin', originalText: text, speechSpans: [{ start: 0, end: text.length }] };
        const old = engine.renderer.forPlan(utterance, before), next = engine.renderer.forPlan(utterance, after);
        if (!old.opaqueSpeechSpans?.length) { expect(next.opaqueSpeechSpans).toEqual([]); expect(next.content).toBe(old.content); preserved++; }
        else if (!next.opaqueSpeechSpans?.length) added++;
    }
    expect(preserved).toBeGreaterThan(0); expect(added).toBeGreaterThan(0);
    for (const word of ['water', 'Water', 'WATER']) expect(maskPercent(1, 'language_goblin', word)).toBe(maskPercent(1, 'language_goblin', 'water'));
});

test('full CLOSE retains phonetics, narration, paragraphs and private ownership', () => {
    const utterance = { spokenLanguageId: 'language_goblin', originalText: '**He nods.** ""Bring water before dawn.""\n\n~~Keep my secret.~~', proseEncoding: 'controls-v1' as const };
    expect(engine.renderer.forPlan(utterance, plan(1), 'en', false).content).toBe(engine.renderer.forMode(utterance, 'CLOSE', 'en', false).content);
    expect(engine.renderer.forPlan(utterance, plan(1), 'en', false).content).not.toContain('Keep my secret');
    expect(engine.renderer.forPlan(utterance, plan(.5), 'fr', false).plan?.belt).toBe('far');
});

const inventory = languageCaptureCatalog({ ...catalog(), facts: engine.relations.languageIds().map(id => fact('pillar', id, 'language')) }, engine.relations)!;
const studyRows = (language: string, fraction: number): string[] => [`VOTC:LANGUAGE/;/study_begin/;/${language}`,
    ...Array.from({ length: 5 }, (_, position) => `VOTC:LANGUAGE/;/study_digit/;/${position}/;/${Math.floor(Math.round(fraction * 10000) / 10 ** position) % 10}`), 'VOTC:LANGUAGE/;/study_end'];
const frame = (rows: string[] = []) => [`VOTC:LANGUAGE/;/begin/;/1/;/${inventory.digest}`, 'VOTC:LANGUAGE/;/native/;/language_common', 'VOTC:LANGUAGE/;/learning/;/10',
    ...inventory.languageIds.map(id => `VOTC:LANGUAGE/;/known/;/${id}/;/${Number(id === 'language_common')}`),
    ...inventory.cultureRules!.map(rule => `VOTC:LANGUAGE/;/contact/;/${rule.id}/;/0`),
    ...inventory.practiceRules!.map(rule => `VOTC:LANGUAGE/;/practice/;/${rule.id}/;/0`), ...rows,
    'VOTC:LANGUAGE/;/study_complete', 'VOTC:LANGUAGE/;/end'];

test('capture identifies the target language and carries sparse study observation through stock CE', () => {
    const script = languageCaptureBody(inventory);
    expect(() => parseCk3Script(script)).not.toThrow();
    expect(script).not.toMatch(/votc_titan_(?:observe|remember|log)_language_study_effect\s*=/);
    expect(script).toContain('value = var:' + studyVariable('language_orcish'));
    const effects = languageStudyEffects(inventory.languageIds);
    expect(() => parseCk3Script(effects)).not.toThrow();
    expect(effects).toContain('value = scheme_progress divide = scheme_phase_duration');
    expect(effects).toContain('scheme_target_character = { save_scope_as = votc_titan_study_target }');
    expect(script).not.toMatch(/\bset_variable\b|\bstart_scheme\b|\bevery_living_character\b|\btrigger_event\b|\bset_global_variable\b/);
    expect((script.match(/VOTC:LANGUAGE\/;\/study_digit\/;\//g) ?? []).length).toBe(100);
    const reader = new LanguageLogReader(inventory);
    frame([...studyRows('language_orcish', .6123), ...studyRows('language_goblin', 1), ...studyRows('language_orcish', .2)]).forEach(row => reader.observe(row));
    expect(reader.snapshot(1)?.studyProgress).toEqual({ language_orcish: .6123, language_goblin: 1 });
    frame().forEach(row => reader.observe(row)); expect(reader.snapshot(1)?.studyProgress).toEqual({});
});

test('generated CK3 arithmetic clamps at the correct boundaries instead of forcing every scheme to completion', () => {
    // Interpret the generated arithmetic independently, using CK3's documented min=floor/max=ceiling semantics.
    const all = parseCk3Script(languageStudyEffects(inventory.languageIds));
    const find = (entries: ReturnType<typeof parseCk3Script>): any => {
        for (const entry of entries) if (Array.isArray(entry.value)) {
            if (entry.key === 'save_temporary_scope_value_as' && entry.value.some(child => child.key === 'name' && child.value === 'votc_titan_study_fraction'))
                return entry.value.find(child => child.key === 'value')!.value;
            const found = find(entry.value); if (found) return found;
        }
    };
    const operations = find(all); expect(operations).toBeDefined();
    const evaluate = (progress: number, goal: number) => {
        let value = 0;
        for (const op of operations) {
            const operand = op.value === 'scheme_progress' ? progress : op.value === 'scheme_phase_duration' ? goal : Number(op.value);
            if (op.key === 'value') value = operand;
            else if (op.key === 'divide') value /= operand;
            else if (op.key === 'multiply') value *= operand;
            else if (op.key === 'min') value = Math.max(value, operand);
            else if (op.key === 'max') value = Math.min(value, operand);
            else if (op.key === 'floor') value = Math.floor(value);
            else throw new Error('Unexpected arithmetic');
        }
        return Math.floor(value * 10000);
    };
    expect(evaluate(0, 730)).toBe(0); expect(evaluate(365, 730)).toBe(5000);
    expect(evaluate(730, 730)).toBe(10000); expect(evaluate(900, 730)).toBe(10000);
    expect(evaluate(-10, 730)).toBe(0);
});

test.each(['missing complete', 'duplicate complete', 'missing digit', 'duplicate digit', 'unknown language', 'overflow', 'missing end', 'invalid goal'])('study capture rejects %s without reusing the previous snapshot', defect => {
    const reader = new LanguageLogReader(inventory); frame().forEach(row => reader.observe(row)); expect(reader.snapshot(1)).toBeDefined();
    let rows = studyRows('language_orcish', .5), all: string[];
    if (defect === 'missing digit') rows.splice(2, 1);
    if (defect === 'duplicate digit') rows.splice(2, 0, rows[1]);
    if (defect === 'unknown language') rows[0] = 'VOTC:LANGUAGE/;/study_begin/;/language_missing';
    if (defect === 'overflow') rows = studyRows('language_orcish', 1.1);
    if (defect === 'missing end') rows.pop();
    if (defect === 'invalid goal') rows = ['VOTC:LANGUAGE/;/study_invalid'];
    all = frame(rows);
    if (defect === 'missing complete') all = all.filter(row => !row.includes('study_complete'));
    if (defect === 'duplicate complete') all.splice(-1, 0, 'VOTC:LANGUAGE/;/study_complete');
    all.forEach(row => reader.observe(row)); expect(reader.snapshot(1)).toBeUndefined();
});

function observed(progress: number) {
    const c = character(1, 'Learner'); c.languageSnapshot = { version: 1, complete: true, nativeLanguageId: 'language_common', knownLanguageIds: ['language_common'], learning: 10, studyProgress: { language_goblin: progress } };
    return c;
}

test('later study and fluency cannot rewrite a delivered hearing or leak study metadata into recipient views', () => {
    const game = new GameData(['1', 'Learner', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Player', '0']);
    const c = observed(.25), speaker = observed(0); speaker.id = 2; speaker.languageSnapshot = { ...speaker.languageSnapshot!, nativeLanguageId: 'language_goblin', knownLanguageIds: ['language_goblin'] };
    game.characters.set(1, c); game.characters.set(2, speaker);
    const session = new LanguageConversation(game, engine.renderer, 'en', true);
    const message: Message = { id: 'old', role: 'assistant', characterId: 2, content: '"Bring water before dawn."' }; session.record(message);
    const frozen = JSON.stringify(message.languageRecord);
    c.languageSnapshot!.studyProgress = { language_goblin: 1 }; c.languageSnapshot!.knownLanguageIds.push('language_goblin');
    session.record(message); expect(JSON.stringify(message.languageRecord)).toBe(frozen);
    const ledger = new ConversationLedger(1); ledger.append(message, game.characters.values());
    const view = readRecipientHistory(ledger.snapshot('1066.9.15', 1), 1);
    expect(JSON.stringify(view)).not.toMatch(/studyProgress|observations|assistance|mask-learning|originalText/);
    expect(view[0].speechComprehension).toBe('partial');
});

test('frozen plans reject inconsistent study cutoffs and invalid progress', () => {
    expect(() => validateComprehensionPlan({ ...plan(.5), cutoff: 51 })).toThrow();
    expect(() => validateComprehensionPlan({ ...plan(.5), studyProgress: 2 })).toThrow();
});
