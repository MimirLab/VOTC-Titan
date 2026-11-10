import { catalog, fact, character } from '../culture/fixtures';
import { app } from 'electron';
import path from 'path';
import { bindLanguageSnapshot, clearLanguageObservations, configureLanguageCapture,
    currentLanguageCaptureCatalog, observeLanguageLine, languageCaptureEnabled, setLanguageRoutingEnabled,
    defaultLanguageEngine, defaultLanguageRenderer } from '../../src/main/language/languageRuntime';

afterEach(() => configureLanguageCapture(undefined, true));
test('binding retains complete encounter observations through slow model requests and invalidates on refresh/load', () => {
    (app.getAppPath as unknown) = jest.fn(() => path.resolve('.'));
    configureLanguageCapture({ ...catalog(), facts: [fact('pillar', 'language_common', 'language'), fact('pillar', 'language_orcish', 'language')] });
    expect(languageCaptureEnabled()).toBe(true);
    const inventory = currentLanguageCaptureCatalog()!;
    const lines = [`VOTC:LANGUAGE/;/begin/;/2/;/${inventory.digest}`, 'VOTC:LANGUAGE/;/native/;/language_common',
        'VOTC:LANGUAGE/;/learning/;/1',
        'VOTC:LANGUAGE/;/known/;/language_common/;/1', 'VOTC:LANGUAGE/;/known/;/language_orcish/;/1', ...inventory.cultureRules!.map(rule => 'VOTC:LANGUAGE/;/contact/;/' + rule.id + '/;/0'), ...inventory.practiceRules!.map(rule => 'VOTC:LANGUAGE/;/practice/;/' + rule.id + '/;/0'), 'VOTC:LANGUAGE/;/study_complete', 'VOTC:LANGUAGE/;/end'];
    const actor = character(2, 'Speaker'); lines.forEach(observeLanguageLine);
    expect(bindLanguageSnapshot(actor)).toBe(true); expect(actor.languageSnapshot?.knownLanguageIds).toContain('language_orcish');
    expect(actor.learning).toBe(1);
    const now = Date.now(); jest.spyOn(Date, 'now').mockReturnValue(now + 16000);
    expect(bindLanguageSnapshot(actor)).toBe(true);
    expect(bindLanguageSnapshot(character(2, 'New encounter'))).toBe(false);
    jest.restoreAllMocks(); clearLanguageObservations();
    expect(bindLanguageSnapshot(actor)).toBe(false); expect(actor.languageSnapshot).toBeUndefined(); expect(actor.learning).toBeUndefined();
    lines.forEach(observeLanguageLine); expect(bindLanguageSnapshot(actor)).toBe(true);
    observeLanguageLine('VOTC:CAMPAIGN/;/loaded/;/42'); expect(bindLanguageSnapshot(actor)).toBe(false);
    lines.forEach(observeLanguageLine); expect(bindLanguageSnapshot(actor)).toBe(true);
    configureLanguageCapture(); expect(bindLanguageSnapshot(actor)).toBe(false);
});

test('the master switch stops capture, invalidates owned knowledge and requires a fresh frame on re-enable', () => {
    (app.getAppPath as unknown) = jest.fn(() => path.resolve('.'));
    configureLanguageCapture({ ...catalog(), facts: [fact('pillar', 'language_common', 'language'), fact('pillar', 'language_orcish', 'language')] });
    const inventory = currentLanguageCaptureCatalog()!;
    const frame = [`VOTC:LANGUAGE/;/begin/;/2/;/${inventory.digest}`, 'VOTC:LANGUAGE/;/native/;/language_common',
        'VOTC:LANGUAGE/;/learning/;/1',
        ...inventory.languageIds.map(id => `VOTC:LANGUAGE/;/known/;/${id}/;/1`),
        ...inventory.cultureRules!.map(rule => `VOTC:LANGUAGE/;/contact/;/${rule.id}/;/0`), ...inventory.practiceRules!.map(rule => `VOTC:LANGUAGE/;/practice/;/${rule.id}/;/0`), 'VOTC:LANGUAGE/;/study_complete', 'VOTC:LANGUAGE/;/end'];
    const actor = character(2, 'Speaker'); frame.forEach(observeLanguageLine);
    expect(bindLanguageSnapshot(actor)).toBe(true);
    const engine = defaultLanguageEngine(); expect(defaultLanguageRenderer()).toBe(engine.renderer);
    setLanguageRoutingEnabled(false);
    expect(languageCaptureEnabled()).toBe(false); expect(currentLanguageCaptureCatalog()).toBeUndefined();
    expect(bindLanguageSnapshot(actor)).toBe(false); expect(actor.languageSnapshot).toBeUndefined();
    frame.forEach(observeLanguageLine);
    expect(bindLanguageSnapshot(character(2, 'Disabled encounter'))).toBe(false);
    setLanguageRoutingEnabled(true);
    expect(currentLanguageCaptureCatalog()!.digest).toBe(inventory.digest);
    expect(bindLanguageSnapshot(actor)).toBe(false);
    frame.forEach(observeLanguageLine); expect(bindLanguageSnapshot(actor)).toBe(true);
    expect(defaultLanguageEngine()).toBe(engine);
});
