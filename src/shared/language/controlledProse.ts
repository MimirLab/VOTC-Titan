import { SpeechSpan } from './speechSpans';

export class ControlledProseError extends Error {
    constructor(message: string, readonly reason: 'format' | 'length' | 'empty' | 'source' | 'speech-label' | 'echo' = 'format') {
        super(message); this.name = 'ControlledProseError';
    }
}

export type ProseKind = 'action' | 'speech' | 'private' | 'gap';
export interface ProseSegment {
    readonly kind: ProseKind;
    readonly text: string;
    readonly start: number;
    readonly end: number;
}
/** Backend source only. Never attach these segments to a recipient/provider payload. */
export interface ControlledProse {
    readonly version: 1;
    readonly source: string;
    readonly segments: readonly ProseSegment[];
}
export interface ProseView {
    readonly content: string;
    /** Offsets into this cleaned view, excluding its ordinary surrounding quotation marks. */
    readonly speechSpans: readonly SpeechSpan[];
    readonly proseSpans: readonly (SpeechSpan & { readonly kind: ProseKind })[];
}

/** Shared scanner. Only formatting repair may inspect gaps containing unlabelled words. */
function scanControlledProse(source: string, allowUnlabelledGaps: boolean): ControlledProse {
    const tokens: Record<string, ProseKind> = { '**': 'action', '""': 'speech', '~~': 'private' };
    const segments: ProseSegment[] = [];
    let cursor = 0;
    let opening: { kind: ProseKind; start: number } | undefined;
    const gap = (start: number, end: number): void => {
        const text = source.slice(start, end);
        if (!allowUnlabelledGaps && /[\p{L}\p{N}]/u.test(text)) throw new ControlledProseError('Unlabelled controlled prose');
        segments.push({ kind: 'gap', text, start, end });
    };
    for (let index = 0; index < source.length; index++) {
        const kind = tokens[source.slice(index, index + 2)];
        if (!kind) continue;
        let back = index - 1;
        while (back >= 0 && source[back] === '\\') back--;
        if ((index - back - 1) % 2) { index++; continue; }
        if (!opening) {
            gap(cursor, index);
            opening = { kind, start: index }; index++;
        } else {
            if (kind !== opening.kind) throw new ControlledProseError('Crossed or nested prose controls');
            const text = source.slice(opening.start + 2, index);
            if (!text.trim()) throw new ControlledProseError('Empty controlled prose span');
            segments.push({ kind, text, start: opening.start, end: index + 2 });
            opening = undefined; cursor = index + 2; index++;
        }
    }
    if (opening) throw new ControlledProseError('Unclosed prose control');
    gap(cursor, source.length);
    return Object.freeze({ version: 1, source, segments: Object.freeze(segments.map(segment => Object.freeze(segment))) });
}

/** Distinct writer controls: **observable narration**, ""speech"", ~~private narration~~. */
export function parseControlledProse(source: string): ControlledProse { return scanControlledProse(source, false); }

/** Repair delimiter spelling only. Stored/delivered prose must still pass the strict parser and all other guards. */
export function normalizeControlledProseFormatting(source: string, proseLanguage = 'en'): string {
    const quotedGap = (text: string): string => {
        // JSON/array wrappers are not dialogue. Leave them for normal bounded recovery.
        if (/[{\[]\s*["“]/u.test(text)) return text;
        const escaped = (index: number): boolean => {
            let count = 0;
            for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor--) count++;
            return count % 2 === 1;
        };
        let result = '', cursor = 0;
        for (let opening = 0; opening < text.length; opening++) {
            if (!['"', '“'].includes(text[opening]) || escaped(opening)) continue;
            const closing = text[opening] === '“' ? '”' : '"';
            let end = opening + 1;
            while (end < text.length && (text[end] !== closing || escaped(end))) end++;
            if (end === text.length) break;
            if (!text.slice(opening + 1, end).trim()) { opening = end; continue; }
            result += text.slice(cursor, opening) + '""' + text.slice(opening + 1, end) + '""';
            cursor = end + 1; opening = end;
        }
        return result + text.slice(cursor);
    };
    const quoted = scanControlledProse(source, true).segments.map(segment => segment.kind === 'gap'
        ? quotedGap(segment.text) : source.slice(segment.start, segment.end)).join('');
    if (proseLanguage.toLowerCase().split(/[-_]/)[0] !== 'en') return quoted;
    const segments = scanControlledProse(quoted, true).segments;
    const connector = /^\s*[,;:]?\s*(?:and|or|but|nor|yet|so|as|while|when|where|before|after|then|to show)\s*$/i;
    return segments.map((segment, index) => {
        const previous = segments[index - 1], next = segments[index + 1];
        if (segment.kind !== 'gap' || !previous || !next || previous.kind !== next.kind ||
            !['action', 'private'].includes(previous.kind) || !connector.test(segment.text) ||
            /\r?\n[\t ]*\r?\n/.test(segment.text)) return quoted.slice(segment.start, segment.end);
        // Keep clause boundaries: later privacy repair may reclassify one neighbour independently.
        const control = previous.kind === 'action' ? '**' : '~~';
        return segment.text.replace(/[a-z]+(?:[\t ]+[a-z]+)*/i, words => control + words + control);
    }).join('');
}

/** Explicit consumer policy, never a global current perspective. Model labels remain a separate concern. */
export function controlledProseView(prose: ControlledProse, keepPrivate: boolean, encodeSpeech: (speech: string, sourceStart: number) => string = text => text): ProseView {
    let content = '';
    const speechSpans: SpeechSpan[] = [];
    const proseSpans: (SpeechSpan & { kind: ProseKind })[] = [];
    for (const segment of prose.segments) {
        if (segment.kind === 'private' && !keepPrivate) continue;
        const wrapper = segment.kind === 'speech' ? '"' : segment.kind === 'gap' ? '' : '*';
        const start = content.length;
        content += wrapper + (segment.kind === 'speech' ? encodeSpeech(segment.text, segment.start + 2) : segment.text) + wrapper;
        proseSpans.push(Object.freeze({ kind: segment.kind, start, end: content.length }));
        if (segment.kind === 'speech') speechSpans.push(Object.freeze({ start: start + 1, end: content.length - 1 }));
    }
    return Object.freeze({ content, speechSpans: Object.freeze(speechSpans), proseSpans: Object.freeze(proseSpans) });
}

/** An editor receives only this already-heard text, including its existing private/public boundaries. */
export function controlledProseEditText(view: ProseView): string {
    return view.proseSpans.map(span => {
        const text = view.content.slice(span.start, span.end);
        if (span.kind === 'gap') return text;
        const token = span.kind === 'action' ? '**' : span.kind === 'speech' ? '""' : '~~';
        return token + text.slice(1, -1) + token;
    }).join('');
}
