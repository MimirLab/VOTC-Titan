import { normalizeAudio } from '../../src/shared/audio';
import { projectAudioUtterances } from '../../src/main/audio/audioProjection';
import { phraseAudioText } from '../../src/main/audio/audioPhrasing';
import type { Message } from '../../src/main/ts/conversation_interfaces';

const settings = normalizeAudio();
const view = (editableContent: string): Message => ({ role: 'assistant', editableContent,
    content: 'Do not use this fallback.', languageRecord: { source: 'Hidden translation and private canonical text.' } as any });

test('muted narration reconnects an interrupted sentence into one literal character performance', () => {
    expect(projectAudioUtterances(view('""If you,"" **she says quietly,** ""return before winter, I will be waiting.""'), settings))
        .toEqual([{ kind: 'speech', text: 'If you, return before winter, I will be waiting.', passage: 0 }]);
});
test('narration enabled preserves exact literary order and both voice owners around an interruption', () => {
    expect(projectAudioUtterances(view('""If you,"" **she says quietly,** ""return before winter, I will be waiting.""'),
        normalizeAudio({ narrator: true })).map(s => [s.kind, s.text]))
        .toEqual([['speech', 'If you,'], ['narration', 'she says quietly,'], ['speech', 'return before winter, I will be waiting.']]);
});
test('adjacent narrator clauses and their normalized connectors form one narration performance', () => {
    expect(projectAudioUtterances(view('**She lays down the letter** **and** **looks up.** ""Why?""'),
        normalizeAudio({ narrator: true })).map(s => [s.kind, s.text]))
        .toEqual([['narration', 'She lays down the letter and looks up.'], ['speech', 'Why?']]);
});
test('visible thoughts remain separate whispers, and muted thoughts still preserve a delivery boundary', () => {
    const v = view('""Yes."" ~~Stay calm.~~ ""Come in.""');
    expect(projectAudioUtterances(v, settings).map(s => s.kind)).toEqual(['speech', 'thought', 'speech']);
    expect(projectAudioUtterances(v, normalizeAudio({ thoughts: false }))).toEqual([
        { kind: 'speech', text: 'Yes.', passage: 0 }, { kind: 'speech', text: 'Come in.', passage: 2 }]);
});
test('a paragraph boundary survives muted narration and keeps separate performances', () => {
    for (const v of [view('""Stay here.""\n\n**She turns away.** ""Come tomorrow.""'),
        view('""Stay here."" **She turns away.\n\nA moment passes.** ""Come tomorrow.""')])
        expect(projectAudioUtterances(v, settings).map(s => s.text)).toEqual(['Stay here.', 'Come tomorrow.']);
});
test('compatible global or indexed cues allow joining, but distinct indexed delivery is preserved', () => {
    const v = view('""Are you sure?"" **She waits.** ""Very well.""');
    expect(projectAudioUtterances(v, settings, [{ direction: 'calm, measured' }])).toHaveLength(1);
    expect(projectAudioUtterances(v, settings, [{ passage: 0, direction: 'warm' }, { passage: 1, direction: 'warm' }])).toHaveLength(1);
    expect(projectAudioUtterances(v, settings, [{ passage: 0, direction: 'questioning' }, { passage: 1, direction: 'firm' }]))
        .toEqual([{ kind: 'speech', text: 'Are you sure?', passage: 0 }, { kind: 'speech', text: 'Very well.', passage: 1 }]);
});
test('only delivered opaque sounds survive planning; narrator settings never expose canonical translations', () => {
    const v = view('**She nods.** ""Grog maen."" **She waits.** ""Thal dor.""');
    expect(projectAudioUtterances(v, settings)).toEqual([{ kind: 'speech', text: 'Grog maen. Thal dor.', passage: 0 }]);
    expect(JSON.stringify(projectAudioUtterances(v, normalizeAudio({ narrator: true })))).not.toMatch(/Hidden|translation|fallback/);
});
test('legacy dialogue can reconnect across muted actions without inferring private thoughts', () => {
    expect(projectAudioUtterances({ role: 'assistant', content: '"If you," *she says,* "return, I will wait."' }, settings))
        .toEqual([{ kind: 'speech', text: 'If you, return, I will wait.', passage: 0 }]);
    expect(projectAudioUtterances({ role: 'user', content: '*waves* Hello. [be gentle]' }, settings).map(s => s.text)).toEqual(['Hello.']);
});
test('long turns split only at complete sentences and retain every original word and punctuation mark', () => {
    const first = 'We will walk through the gate together, ' + 'past the old stone houses, '.repeat(22) + 'before the rain begins.';
    const second = 'Will you come? ' + 'I will wait by the door. '.repeat(12);
    const text = first + ' ' + second;
    const result = phraseAudioText(text);
    expect(result.length).toBeGreaterThan(1);
    expect(result[0]).toBe(first);
    expect(result.every(p => /[.!?]$/.test(p))).toBe(true);
    expect(result.join(' ').replace(/\s+/g, ' ').trim()).toBe(text.replace(/\s+/g, ' ').trim());
});
test('a long single sentence stays whole instead of being cut at a comma or a word budget', () => {
    const text = 'If you return, ' + 'and if the road is clear, '.repeat(30) + 'I will be waiting.';
    expect(text.length).toBeGreaterThan(600);
    expect(phraseAudioText(text)).toEqual([text]);
});
test('sentence segmentation preserves abbreviations, decimals, quotations and unfinished clauses', () => {
    const text = 'Dr. Mira paid 3.50 for it. “Really?” she asked. If you,';
    expect(phraseAudioText(text)).toEqual([text]);
    const first = 'We waited by the entrance. '.repeat(21);
    const units = phraseAudioText(first + 'Dr. Mira will return.');
    expect(units.every(unit => !unit.endsWith('Dr.'))).toBe(true);
    expect(units.join(' ')).toBe((first + 'Dr. Mira will return.').trim());
});
test('an extreme unpunctuated sentence reports a repairable error rather than silently cutting words', () => {
    expect(() => phraseAudioText('word '.repeat(400))).toThrow('safe sentence boundary');
    expect(phraseAudioText('')).toEqual([]);
});

test('opening narration releases one complete first sentence while later paragraphs keep ordinary grouping', () => {
    const v = view('**The wind falls still. The old door opens slowly. A figure steps inside.** ""Come in.""');
    expect(projectAudioUtterances(v, normalizeAudio({narrator:true})).map(s=>s.text)).toEqual([
        'The wind falls still.', 'The old door opens slowly. A figure steps inside.', 'Come in.'
    ]);
});
