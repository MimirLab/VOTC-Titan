import { Lexer } from 'marked';
import { quotedSpeechSpans, SpeechSpan } from './speechSpans';

/** Bare text is speech; explicit quotations select speech, excluding actions and [OOC]. */
export function playerSpeechSpans(text: string): SpeechSpan[] {
    const spans: SpeechSpan[] = [];
    const collect = (tokens: ReturnType<typeof Lexer.lexInline>, offset: number): number => {
        let cursor = offset;
        for (const token of tokens) {
            const start = cursor; cursor += token.raw.length;
            if (['em', 'codespan', 'html', 'br', 'link', 'image'].includes(token.type)) continue;
            if (token.type === 'strong') {
                if (!Array.isArray(token.tokens)) throw new Error('Missing player speech markup tokens');
                const innerEnd = collect(token.tokens, start + 2);
                if (innerEnd !== cursor - 2) throw new Error('Player speech markup did not preserve source offsets');
                continue;
            }
            let position = start;
            const raw = text.slice(start, cursor);
            const directives = /\[[^\]]*\]/g;
            let match: RegExpExecArray | null;
            while ((match = directives.exec(raw)) !== null) {
                const end = start + match.index;
                if (text.slice(position, end).trim()) spans.push({ start: position, end });
                position = end + match[0].length;
            }
            if (text.slice(position, cursor).trim()) spans.push({ start: position, end: cursor });
        }
        return cursor;
    };
    if (collect(Lexer.lexInline(text), 0) !== text.length) throw new Error('Player speech markup did not preserve source offsets');
    // Quotes inside actions, code, links or directives do not select a speech mode.
    // Retain UTF-16 offsets and escapes for the shared quotation parser.
    const quotedSource = text.split('');
    let cursor = 0;
    for (const span of spans) {
        for (; cursor < span.start; cursor++) if (/["“”]/.test(quotedSource[cursor])) quotedSource[cursor] = ' ';
        cursor = span.end;
    }
    for (; cursor < text.length; cursor++) if (/["“”]/.test(quotedSource[cursor])) quotedSource[cursor] = ' ';
    let quoted: SpeechSpan[];
    try { quoted = quotedSpeechSpans(quotedSource.join('')); }
    catch { return spans; } // A stray or unfinished quote in casual input retains bare-speech behavior.
    if (!quoted.length) return spans;
    return quoted.flatMap(quote => spans.flatMap(span => {
        const start = Math.max(quote.start, span.start), end = Math.min(quote.end, span.end);
        return end > start && text.slice(start, end).trim() ? [{ start, end }] : [];
    }));
}
