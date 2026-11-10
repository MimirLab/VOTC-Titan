import fs from 'fs';
import path from 'path';
import { CloseEncoder } from '../../src/main/language/closeEncoder';
import { CloseProfileData, CloseProfiles } from '../../src/main/language/closeProfiles';
import { knownLanguages, resolveMode, selectSpokenLanguage } from '../../src/main/language/languageRouting';
import { LanguageRenderer, recordUtterance } from '../../src/main/language/languageRendering';
import { FarEncoder } from '../../src/main/language/farEncoder';
import { mapQuoted, quotedSpeechSpans } from '../../src/shared/language/speechSpans';
import { tokenizeSpeech } from '../../src/shared/language/tokenizer';

const root = path.resolve(__dirname, '../..');
const starter: CloseProfileData = JSON.parse(fs.readFileSync(path.join(root, 'public/languages/close-profiles.json'), 'utf8'));
const routing = JSON.parse(fs.readFileSync(path.join(root, 'public/languages/routing.json'), 'utf8'));
const profiles = new CloseProfiles(starter, routing), close = new CloseEncoder(profiles);
const knowledge = (nativeLanguageId: string, learnedLanguageIds: string[] = []) => ({ nativeLanguageId, learnedLanguageIds });

describe('CLOSE lexical transformations', () => {
    test('matches the authored Common example', () => {
        expect(close.speech('Bring water to the gate before dawn.', 'language_common'))
            .toBe('Bring waeter to dhe gaete befoire dawn.');
    });
    test('is independent of context and retries', () => {
        expect(close.speech('water water\nwater', 'language_common')).toBe('waeter waeter\nwaeter');
        expect(close.word('water', 'language_common')).toBe('waeter');
    });
    test('preserves capitalization, names, digits, apostrophes and layout', () => {
        expect(close.speech('THRALL’s brother brings 42 silver coins.\r\nNara waits.', 'language_common'))
            .toBe('DHRALL’s brodher brings 42 silveur coins.\r\nNaera waits.');
    });
    test('applies one rewrite below eight letters and two above', () => {
        expect(close.word('brother', 'language_common')).toBe('brodher');
        expect(close.word('thunderer', 'language_common')).toBe('dhundereur');
        expect(close.word('THUNDERER', 'language_common')).toBe('DHUNDEREUR');
    });
    test('digits and apostrophes do not inflate the allowance', () => {
        const data = JSON.parse(JSON.stringify(starter));
        data.profiles.language_common.rules = [['th', 'dh'], ['er', 'ar']];
        const encoder = new CloseEncoder(new CloseProfiles(data, routing));
        expect(encoder.word('brother123', 'language_common')).toBe('brodher123');
        expect(encoder.word("bro'ther", 'language_common')).toBe("bro'dher");
    });
    test('never searches rewritten output and skips identity changes', () => {
        const data = JSON.parse(JSON.stringify(starter));
        data.profiles.language_common.rules = [['th', 'aw'], ['aw', 'ou']];
        const encoder = new CloseEncoder(new CloseProfiles(data, routing));
        expect(encoder.word('thaw', 'language_common')).toBe('awaw');
        data.profiles.language_common.rules = [['th', 'th'], ['e$', 'a']];
        expect(new CloseEncoder(new CloseProfiles(data, routing)).word('the', 'language_common')).toBe('tha');
    });
    test('uses original Unicode offsets and preserves unmatched characters', () => {
        expect(close.word('İbrother', 'language_common')).toBe('İbrodher');
        expect(close.speech('𐐀the ☀️ e\u0301 中文 Straße 123', 'language_common')).toBe('𐐀dhe ☀️ e\u0301 中文 Straße 123');
    });
    test('has small daughter-language distinctions', () => {
        expect(close.speech('the water', 'language_low_common')).toBe('de watur');
        expect(close.speech('the water', 'language_gutterspeak')).toBe('zhe waterh');
    });
    test('does not apply English endings under another display locale', () => {
        expect(() => close.speech('water', 'language_common', 'fr')).toThrow('English');
        expect(close.speech('water', 'language_common', 'en-US')).toBe('waeter');
    });
    test('tokenization preserves Unicode marks and emoji punctuation', () => {
        const source = "e\u0301 can’t ☀️ 𐐀42.";
        const tokens = Array.from(tokenizeSpeech(source));
        expect(tokens.map(token => token.text).join('')).toBe(source);
        expect(tokens.filter(token => token.word).map(token => token.text)).toEqual(['e\u0301', 'can’t', '𐐀42']);
    });
});

describe('routing uses actual language knowledge', () => {
    test('learned knowledge enables CLOSE and exact knowledge always wins', () => {
        expect(resolveMode('language_common', knownLanguages(knowledge('language_goblin', ['language_low_common'])), profiles)).toBe('CLOSE');
        expect(resolveMode('language_common', ['language_low_common', 'language_common'], profiles)).toBe('CLEAR');
        expect(resolveMode('language_common', ['language_orcish'], profiles)).toBe('FAR');
    });
    test('unlisted IDs are unique and exact equality remains CLEAR', () => {
        expect(resolveMode('custom_a', ['custom_b'], profiles)).toBe('FAR');
        expect(resolveMode('custom_a', ['custom_a'], profiles)).toBe('CLEAR');
        expect(profiles.family('custom_a')).toEqual(['unassigned_language', 'custom_a']);
    });
    test('geography, inheritance and racial origin do not create families', () => {
        for (const [a, b] of [['language_dwarven', 'language_gnomish'], ['language_orcish', 'language_ogre'],
            ['language_titanic', 'language_giant'], ['language_eredun', 'language_nathrezim']])
            expect(resolveMode(a, [b], profiles)).toBe('FAR');
    });
    test('shared languages are selected before the native fallback', () => {
        const speaker = knowledge('language_orcish', ['language_common']);
        expect(selectSpokenLanguage(speaker, knowledge('language_goblin', ['language_common']))).toBe('language_common');
        expect(selectSpokenLanguage(speaker, knowledge('language_goblin'))).toBe('language_orcish');
        expect(selectSpokenLanguage(speaker, knowledge('language_common'), 'language_orcish')).toBe('language_orcish');
        expect(() => selectSpokenLanguage(speaker, undefined, 'language_dwarven')).toThrow('does not know');
    });
    test('a recorded broadcast has one language and three listener views', () => {
        const far = { render: jest.fn((text: string, language: string, spans: readonly { start: number; end: number }[]) => {
            const original = text.slice(spans[0].start, spans[0].end);
            expect(original).toBe('Bring water to the gate before dawn.');
            expect(language).toBe('language_common');
            return '*He points.* "FAR-TEST"';
        }) };
        const renderer = new LanguageRenderer(close, far);
        const text = '*He points.* "Bring water to the gate before dawn."';
        const utterance = recordUtterance(text, knowledge('language_common'), knowledge('language_low_common'));
        expect(renderer.forListener(utterance, knowledge('language_common')).content).toBe(text);
        expect(renderer.forListener(utterance, knowledge('language_low_common')).content)
            .toBe('*He points.* "Bring waeter to dhe gaete befoire dawn."');
        expect(renderer.forListener(utterance, knowledge('language_orcish')).content).toBe('*He points.* "FAR-TEST"');
        expect(utterance.spokenLanguageId).toBe('language_common');
        expect(utterance.originalText).toBe(text);
        expect(far.render).toHaveBeenCalledTimes(1);
    });
    test('CLEAR is byte exact even without profile metadata or valid quote pairs', () => {
        const renderer = new LanguageRenderer(close, { render: () => { throw new Error('Must not encode CLEAR'); } });
        const text = '*gesture* “unclosed\r\ntext';
        expect(renderer.forListener(recordUtterance(text, knowledge('custom_a')), knowledge('custom_a')).content).toBe(text);
    });
    test('explicit unshared speech cannot be reassigned by an overhearer', () => {
        const far = new FarEncoder(JSON.parse(fs.readFileSync(path.join(root, 'public/languages/far-profiles.json'), 'utf8')));
        const renderer = new LanguageRenderer(close, far);
        const utterance = recordUtterance('"Bring water."', knowledge('language_orcish', ['language_common']),
            knowledge('language_common'), 'language_orcish');
        expect(renderer.forListener(utterance, knowledge('language_common')).mode).toBe('FAR');
        expect(renderer.forListener(utterance, knowledge('language_orcish')).mode).toBe('CLEAR');
        expect(utterance.spokenLanguageId).toBe('language_orcish');
    });
});

describe('shared selection and metadata validation', () => {
    test('curly and escaped quotes preserve unquoted actions', () => {
        expect(mapQuoted('*He nods.* “the water” and "the \\"water\\"".', span => close.speech(span, 'language_common')))
            .toBe('*He nods.* “dhe waeter” and "dhe \\"waeter\\"".');
        expect(quotedSpeechSpans('*She only nods.*')).toEqual([]);
    });
    test.each(['"unclosed', '”orphan', '“mixed"'])('retains malformed-pair errors: %s', text => {
        expect(() => quotedSpeechSpans(text)).toThrow();
    });
    test('rejects missing or broken banks and unsafe or empty replacements', () => {
        for (const mutate of [
            (data: CloseProfileData) => { delete data.profiles.language_orcish; },
            (data: CloseProfileData) => { data.profiles.language_common.rules = []; },
            (data: CloseProfileData) => { data.profiles.language_common.rules = [['(?=a)', 'x']]; },
            (data: CloseProfileData) => { data.profiles.language_common.rules = [['(?=zz)', 'x']]; },
            (data: CloseProfileData) => { data.profiles.language_common.rules = [['a|(?=zz)', 'x']]; },
            (data: CloseProfileData) => { data.profiles.language_common.rules = [['z{0,3}', 'x']]; },
            (data: CloseProfileData) => { data.profiles.language_common.rules = [['a', '']]; },
            (data: CloseProfileData) => { data.profiles.language_common.rules = [['(', 'a']]; },
        ]) {
            const data = JSON.parse(JSON.stringify(starter)); mutate(data); expect(() => new CloseProfiles(data, routing)).toThrow();
        }
    });
});
