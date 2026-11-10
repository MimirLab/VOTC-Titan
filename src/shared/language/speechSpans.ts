export interface SpeechSpan { start: number; end: number }

/** Host adaptation of FAR 0.2 map_quoted's shared selection policy; offsets are UTF-16. */
export function quotedSpeechSpans(text: string): SpeechSpan[] {
    const spans: SpeechSpan[] = [];
    let opening: '"' | '“' | undefined;
    let start = 0;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (!['"', '“', '”'].includes(char)) continue;
        let back = index - 1;
        while (back >= 0 && text[back] === '\\') back--;
        if ((index - back - 1) % 2) continue;
        if (opening === undefined) {
            if (char === '”') throw new Error(`Closing quote without opener at character ${index}`);
            opening = char as '"' | '“'; start = index + 1;
        } else {
            const expected = opening === '"' ? '"' : '”';
            if (char !== expected) throw new Error(`Mismatched quote at character ${index}`);
            spans.push({ start, end: index }); opening = undefined;
        }
    }
    if (opening !== undefined) throw new Error(`Unclosed quotation beginning at character ${start - 1}`);
    return spans;
}

export function mapSpeechSpans(text: string, spans: readonly SpeechSpan[], encoder: (speech: string) => string): string {
    let cursor = 0;
    const output: string[] = [];
    for (const span of spans) {
        if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) ||
            span.start < cursor || span.end < span.start || span.end > text.length)
            throw new Error('Invalid or overlapping speech spans');
        output.push(text.slice(cursor, span.start), encoder(text.slice(span.start, span.end)));
        cursor = span.end;
    }
    output.push(text.slice(cursor));
    return output.join('');
}

export function mapQuoted(text: string, encoder: (speech: string) => string): string {
    return mapSpeechSpans(text, quotedSpeechSpans(text), encoder);
}
