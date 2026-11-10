import { inlineLanguageStudyCapture } from '../../src/main/language/languageStudyScript';
import { parseCk3Script } from '../../src/main/culture/ck3Script';

test('stock CE can execute study capture without installed Titan helper definitions', () => {
    const text = inlineLanguageStudyCapture(['language_common', 'language_orcish']);
    expect(() => parseCk3Script(text)).not.toThrow();
    expect(text).not.toMatch(/\$[A-Z]+\$|votc_titan_(?:remember|observe|log)_language_study_effect\s*=/);
    expect(text).toContain('scheme_progress divide = scheme_phase_duration');
    expect(text).toContain('has_variable = votc_titan_study_language_common');
    expect(text).not.toMatch(/\bset_variable\b|\bset_global_variable\b|\badd_character_flag\b/);
    expect(text).toContain('VOTC:LANGUAGE/;/study_begin/;/language_orcish');
    expect(text).toContain('VOTC:LANGUAGE/;/study_complete');
    expect(text).not.toMatch(/learn_language_(?:ongoing|success|failure)\s*=/);
});
test('inline capture cannot inject arbitrary language keys into CE commands', () => {
    expect(() => inlineLanguageStudyCapture(['language_common } death = yes'])).toThrow();
});
