import fs from 'fs';
import path from 'path';
import { LanguageEngine, LanguageEngineData, loadLanguageEngine, TITAN_FAR_VOCABULARY_SEED } from '../../src/main/language/languageEngine';

const root = path.resolve('public/languages');
const json = (name: string) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const data = (): LanguageEngineData => ({ routing: json('routing.json'), close: json('close-profiles.json'),
    far: json('far-profiles.json'), casefold: json('unicode-casefold.json').fold });
const knows = (nativeLanguageId: string, learnedLanguageIds: string[] = []) => ({ nativeLanguageId, learnedLanguageIds });

test('one engine loads every voice and uses the preserved FAR seed and versions', () => {
    const engine = loadLanguageEngine(root);
    expect(engine.relations.languageIds()).toHaveLength(53);
    expect(engine.versions).toEqual({ routing: 'titan-current-familiarity-r4', close: 'titan-close-essence-3.0',
        far: 'titan-essence-0.2', sourceLocale: 'en' });
    expect(TITAN_FAR_VOCABULARY_SEED).toBe('titan-demo');
    for (const id of engine.relations.languageIds()) {
        expect(engine.renderer.close.speech('Bring water.', id)).toBeTruthy();
        const utterance = engine.record('"Bring water."', knows(id));
        const unrelated = knows('language_unassigned');
        expect(engine.forListener(utterance, unrelated).mode).toBe('FAR');
        expect(engine.forListener(utterance, unrelated)).toEqual(engine.forListener(utterance, unrelated));
    }
});

test('one pinned utterance produces separate known, related and foreign listener views', () => {
    const engine = loadLanguageEngine(root);
    const source = '*Her hands tremble.* "Bring water."\n\n*She waits.*';
    const utterance = engine.record(source, knows('language_darnassian'));
    const clear = knows('language_darnassian'), close = knows('language_thalassian'), far = knows('language_orcish');
    expect(engine.route(utterance.spokenLanguageId, close)).toEqual({ mode: 'CLOSE', reason: 'language_family',
        anchor: 'language_thalassian' });
    expect(engine.forListener(utterance, clear)).toEqual({ spokenLanguageId: 'language_darnassian', mode: 'CLEAR', content: source });
    expect(engine.forListener(utterance, close).content).toBe('*Her hands tremble.* "Bringa watera."\n\n*She waits.*');
    expect(engine.forListener(utterance, far).content).toBe('*Her hands tremble.* "Thena neshia."\n\n*She waits.*');
    expect(engine.route('language_darnassian', knows('language_orcish', ['language_darnassian'])).mode).toBe('CLEAR');
    expect(utterance.originalText).toBe(source);
    expect(Object.isFrozen(utterance)).toBe(true);
});

test('the module refuses mismatched or invalid voice assets before recipient rendering', () => {
    const missing = data(); delete missing.far.profiles.language_orcish;
    expect(() => new LanguageEngine(missing)).toThrow('FAR profiles must cover');
    const extra = data(); extra.far.profiles.language_extra = { ...extra.far.profiles.language_orcish };
    expect(() => new LanguageEngine(extra)).toThrow('FAR profiles must cover');
    const badProfile = data(); badProfile.far.profiles.language_orcish.shapes = ['INVALID'];
    expect(() => new LanguageEngine(badProfile)).toThrow('Invalid FAR syllable shapes');
    const badFold = data(); badFold.casefold = { A: 12 as any };
    expect(() => new LanguageEngine(badFold)).toThrow('Invalid language case-fold table');
});
