import path from 'path';
import { parseControlledProse, controlledProseView } from '../../src/shared/language/controlledProse';
import { loadLanguageEngine } from '../../src/main/language/languageEngine';

const engine = loadLanguageEngine(path.resolve('public/languages'));
const source = '**She gestures toward the empty cup,** ~~remembering the hidden opal and "old words".~~ ""Bring water before dawn.""\n\n**Her hands tremble.**';
test('literary and character projections preserve paragraphs and have their own exact audible offsets', () => {
    const parsed = parseControlledProse(source), full = controlledProseView(parsed, true), publicOnly = controlledProseView(parsed, false);
    expect(full.content).toContain('hidden opal'); expect(publicOnly.content).not.toMatch(/opal|old words/);
    expect(full.content).toContain('\n\n'); expect(publicOnly.content).toContain('\n\n');
    for (const view of [full, publicOnly]) {
        expect(view.speechSpans).toHaveLength(1);
        expect(view.content.slice(view.speechSpans[0].start, view.speechSpans[0].end)).toBe('Bring water before dawn.');
    }
    expect(controlledProseView(parsed, true)).toEqual(full);
    expect(parsed.source).toBe(source); expect(Object.isFrozen(parsed.segments[0])).toBe(true);
});
test.each(['CLEAR', 'CLOSE', 'FAR'] as const)('existing %s rendering encodes only audible words while keeping the selected privacy policy', mode => {
    const parsed = parseControlledProse(source);
    for (const keepPrivate of [true, false]) {
        const view = controlledProseView(parsed, keepPrivate);
        const rendered = engine.renderer.forMode({ spokenLanguageId: 'language_common', originalText: view.content, speechSpans: view.speechSpans }, mode);
        expect(rendered.content.includes('hidden opal')).toBe(keepPrivate);
        expect(rendered.content.includes('"old words"')).toBe(keepPrivate);
        expect(rendered.content).toContain('Her hands tremble'); expect(rendered.content).toContain('\n\n');
        if (mode === 'CLEAR') expect(rendered.content).toContain('Bring water');
        if (mode === 'CLOSE') expect(rendered.content).toContain('Bring waeter');
        if (mode === 'FAR') expect(rendered.content).not.toContain('Bring water');
    }
});
test.each(['**She nods.** She privately remembers.', '~~unfinished', '**A ~~memory**~~', '~~~~'])('malformed source holds before any projection: %s', text => {
    expect(() => parseControlledProse(text)).toThrow();
});
test('written quotation marks are observable text and escaped control symbols stay literal', () => {
    const view = controlledProseView(parseControlledProse('**She reads "Home" and traces \\** on the slate.**'), false);
    expect(view.speechSpans).toEqual([]); expect(view.content).toContain('"Home"'); expect(view.content).toContain('\\**');
});
