/// <reference lib="es2022.intl" />

// A soft target, never a character/word cut. The larger single-sentence ceiling
// allows long literary sentences without asking Breeze for a multi-minute turn.
export const AUDIO_PHRASE_TARGET = 600;
export const AUDIO_SENTENCE_LIMIT = 1500;
const sentenceEnd = /[.!?。！？…]["'”’»）)\]]*\s*$/u;
const abbreviation = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\b[A-Z])\.\s*$/u;
const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

/** Preserve literal words/punctuation. Only whitespace at request boundaries is omitted. */
export function phraseAudioText(text: string, firstSentence = false): string[] {
    const complete: string[] = [];
    let sentence = '';
    for (const part of sentences.segment(text)) {
        sentence += part.segment;
        if (sentenceEnd.test(sentence) && !abbreviation.test(sentence)) { complete.push(sentence); sentence = ''; }
    }
    if (sentence) complete.push(sentence);
    const phrases: string[] = []; let phrase = '';
    for (const next of complete) {
        if (next.trim().length > AUDIO_SENTENCE_LIMIT)
            throw new Error('This voice passage has more than 1,500 characters without a safe sentence boundary. Add sentence punctuation in the reply editor, then replay.');
        if (phrase && phrase.length + next.length > AUDIO_PHRASE_TARGET) { phrases.push(phrase.trim()); phrase = ''; }
        if (firstSentence && !phrases.length && !phrase && next.trim()) { phrases.push(next.trim()); firstSentence = false; }
        else phrase += next;
    }
    if (phrase.trim()) phrases.push(phrase.trim());
    return phrases;
}
