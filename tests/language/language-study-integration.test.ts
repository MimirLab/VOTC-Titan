import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { GameData } from '../../src/shared/gameData/GameData';
import { configureLanguageCapture, currentLanguageCaptureCatalog, observeLanguageLine, bindLanguageSnapshot } from '../../src/main/language/languageRuntime';
import { defaultLanguageEngine } from '../../src/main/language/languageRuntime';
import { LanguageConversation, characterLanguages } from '../../src/main/language/languageConversation';
import { encounterScript } from '../../src/main/background/EncounterCapture';
import { parseCk3Script } from '../../src/main/culture/ck3Script';
import { character, catalog, fact } from '../culture/fixtures';
import { Message } from '../../src/main/ts/conversation_interfaces';

function publish(id: number, progress: number) {
    const inventory = currentLanguageCaptureCatalog()!;
    const native = id === 1 ? 'language_common' : 'language_goblin';
    const rows = [`VOTC:LANGUAGE/;/begin/;/${id}/;/${inventory.digest}`, `VOTC:LANGUAGE/;/native/;/${native}`, 'VOTC:LANGUAGE/;/learning/;/10',
        ...inventory.languageIds.map(language => `VOTC:LANGUAGE/;/known/;/${language}/;/${language === native ? 1 : 0}`),
        ...inventory.cultureRules!.map(rule => `VOTC:LANGUAGE/;/contact/;/${rule.id}/;/0`),
        ...inventory.practiceRules!.map(rule => `VOTC:LANGUAGE/;/practice/;/${rule.id}/;/0`),
        'VOTC:LANGUAGE/;/study_begin/;/language_goblin',
        ...Array.from({ length: 5 }, (_, n) => `VOTC:LANGUAGE/;/study_digit/;/${n}/;/${Math.floor(Math.round(progress * 10000) / 10 ** n) % 10}`),
        'VOTC:LANGUAGE/;/study_end', 'VOTC:LANGUAGE/;/study_complete', 'VOTC:LANGUAGE/;/end'];
    rows.forEach(observeLanguageLine);
}
beforeEach(() => {
    (app as any).getAppPath = () => path.resolve('.');
    const engine = defaultLanguageEngine();
    configureLanguageCapture({ ...catalog(), facts: engine.relations.languageIds().map(id => fact('pillar', id, 'language')) });
});
afterEach(() => { configureLanguageCapture(undefined, true); });

test('a loaded save supplies its own study peaks; companion restart/reload does not merge in a future value', () => {
    const learner = character(1, 'Learner'); publish(1, .6); expect(bindLanguageSnapshot(learner)).toBe(true);
    expect(characterLanguages(learner).studyProgress).toEqual({ language_goblin: .6 });
    observeLanguageLine('VOTC:CAMPAIGN/;/loaded/;/1'); publish(1, .2);
    expect(bindLanguageSnapshot(learner)).toBe(true);
    expect(characterLanguages(learner).studyProgress).toEqual({ language_goblin: .2 });
    const restarted = character(1, 'Learner'); expect(bindLanguageSnapshot(restarted)).toBe(true);
    expect(characterLanguages(restarted).studyProgress).toEqual({ language_goblin: .2 });
});

test('new hearings use loaded peaks while already-delivered speech remains frozen across a reset and new save observation', () => {
    const game = new GameData(['1', 'Learner', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Player', '0']);
    const learner = character(1, 'Learner'), speaker = character(2, 'Speaker');
    publish(1, .6); publish(2, 0); bindLanguageSnapshot(learner); bindLanguageSnapshot(speaker);
    game.characters.set(1, learner); game.characters.set(2, speaker);
    const session = new LanguageConversation(game, defaultLanguageEngine().renderer, 'en', true);
    const first: Message = { id: 'first', role: 'assistant', characterId: 2, content: '"Bring water before dawn."' };
    session.record(first); const frozen = JSON.stringify(first.languageRecord);
    observeLanguageLine('VOTC:CAMPAIGN/;/loaded/;/1'); publish(1, .2); publish(2, 0); bindLanguageSnapshot(learner); bindLanguageSnapshot(speaker);
    const next: Message = { ...first, id: 'next', utterance: undefined, languageRecord: undefined, observedByCharacterIds: undefined };
    session.record(next); expect(next.languageRecord!.hearings['1'].plan!.cutoff).toBe(20);
    expect(JSON.stringify(first.languageRecord)).toBe(frozen);
});

test('the actual RP probe inlines read-only study observation without an installed game component', () => {
    const inventory=currentLanguageCaptureCatalog()!;
    expect(inventory.captureStudy).toBe(true);
    const script=encounterScript({languages:inventory,clock:true},[
        {characterId:1,scope:'root'},{characterId:2,position:0}
    ],'0123456789abcdef01234567');
    expect(()=>parseCk3Script(script)).not.toThrow();
    expect(script).toContain('type = learn_language');
    expect(script).toContain('VOTC:LANGUAGE/;/study_digit/;/');
    expect(script).toContain('VOTC:ENCOUNTER/;/clock/;/');
    expect(script).not.toMatch(/\b(?:set_variable|set_global_variable|on_actions|trigger_event)\s*=/);
    expect(script).not.toMatch(/votc_titan_(?:observe|log)_language_study_effect\s*=/);
});
