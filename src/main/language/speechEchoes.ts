import { createHash } from 'crypto';
import { parseControlledProse } from '../../shared/language/controlledProse';
import { quotedSpeechSpans, SpeechSpan } from '../../shared/language/speechSpans';
import { tokenizeSpeech } from '../../shared/language/tokenizer';
import type { Message } from '../ts/conversation_interfaces';
import type { LanguageRenderer, SpokenUtterance } from './languageRendering';

export interface EchoHearing {
    readonly content: string;
    readonly comprehension: 'clear' | 'partial' | 'unintelligible';
    readonly opaque: readonly SpeechSpan[];
}
/** Backend-only evidence. Recipient copies contain rendered words and audible offsets only. */
export interface SpeechEcho extends SpeechSpan {
    readonly sound: string;
    readonly marker?: 'phonetic-v1';
    readonly soundLanguageId?: string;
    readonly origin?: { readonly languageId: string; readonly meaning: string; readonly messageId: string; readonly revision: number };
    readonly hearings: Readonly<Record<string, EchoHearing>>;
}
export interface HeardSource { readonly message: Message; readonly heard: Message }

export function sourceSpeechSpans(utterance: SpokenUtterance): readonly SpeechSpan[] {
    return utterance.proseEncoding ? parseControlledProse(utterance.originalText).segments
        .filter(segment => segment.kind === 'speech').map(segment => ({ start: segment.start + 2, end: segment.end - 2 }))
        : utterance.speechSpans ?? quotedSpeechSpans(utterance.originalText);
}

/** Ordinary apostrophes in contractions are not quotation controls. Offsets remain UTF-16. */
export function quotedEchoFragments(utterance: SpokenUtterance, includeOrdinaryQuotes = false): (SpeechSpan & { sound: string; marker?: 'phonetic-v1' })[] {
    const fragments: (SpeechSpan & { sound: string; marker?: 'phonetic-v1' })[] = [];
    for (const span of sourceSpeechSpans(utterance)) {
        const speech = utterance.originalText.slice(span.start, span.end);
        const markers = /<<([^<>\n]{1,240})>>/gu;
        let marked: RegExpExecArray | null;
        while ((marked = markers.exec(speech))) fragments.push({ start: span.start + marked.index + 2,
            end: span.start + marked.index + 2 + marked[1].length, sound: marked[1], marker: 'phonetic-v1' });
        // Quoting a familiar word for emphasis is not a phonetic imitation. Explicit hearing/meaning cues disambiguate legacy quotes.
        const citation = /\b(?:hear|heard|sound|sounds|syllable|syllables|pronounce|pronounced|repeat|repeated|repeating|echo|echoed|echoing|mean|means|meaning|say|says|said|saying)\b/i.test(speech);
        if (!includeOrdinaryQuotes && !citation && !/^\s*['‘][\s\S]+['’]\s*\?\s*$/.test(speech) && !/\bwhat\s+(?:is|was|are|were)\s+['‘][\s\S]+['’]\s*\?/i.test(speech)) continue;
        for (let opening = 0; opening < speech.length; opening++) {
            if (!['\'', '‘'].includes(speech[opening]) || (opening && !/[\s([{]/u.test(speech[opening - 1]))) continue;
            const closing = speech[opening] === '‘' ? '’' : '\'';
            for (let end = opening + 1; end < Math.min(speech.length, opening + 242); end++) {
                if (speech[end] === '\n') break;
                if (speech[end] !== closing || (end + 1 < speech.length && !/[\s.,!?:;)\]}]/u.test(speech[end + 1]))) continue;
                const inside = speech.slice(opening + 1, end), padding = inside.match(/^[\s,.;:!?]*/)![0].length;
                const sound = inside.slice(padding).replace(/[\s,.;:!?]+$/, '');
                if (!sound || !/[\p{L}\p{N}]/u.test(sound)) continue;
                const start = span.start + opening + 1 + padding;
                if (!fragments.some(fragment => fragment.marker && start >= fragment.start && start + sound.length <= fragment.end))
                    fragments.push({ start, end: start + sound.length, sound });
            }
        }
    }
    return fragments.sort((a, b) => a.start - b.start || a.end - b.end);
}

const fold = (text: string): string => text.toLowerCase().replace(/[‘’]/g, "'");
/** Models sometimes put ordinary quote punctuation inside the phonetic controls. It is not part of the sound. */
function audibleFragment(fragment: { sound: string; marker?: 'phonetic-v1' }): string {
    const sound = fragment.sound;
    return fragment.marker && ((sound.startsWith("'") && sound.endsWith("'")) ||
        (sound.startsWith('‘') && sound.endsWith('’'))) && sound.length > 2 ? sound.slice(1, -1) : sound;
}
function audibleMatch(heard: Message, sound: string): { found: boolean; opaque: SpeechSpan[] } {
    const ranges = heard.perceivedSpeechSpans ?? quotedSpeechSpans(heard.content);
    const escaped = sound.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['‘’]/g, "['‘’]");
    const pattern = new RegExp(escaped, 'giu');
    let found = false;
    const opaque: SpeechSpan[] = [];
    for (const range of ranges) {
        const speech = heard.content.slice(range.start, range.end);
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(speech))) {
            const before = speech.slice(0, match.index).match(/[\s\S]$/u)?.[0];
            const after = speech.slice(match.index + match[0].length).match(/^[\s\S]/u)?.[0];
            const beforeQuote = speech.slice(0, match.index - 1).match(/[\s\S]$/u)?.[0];
            const afterQuote = speech.slice(match.index + match[0].length + 1).match(/^[\s\S]/u)?.[0];
            const word = /[\p{L}\p{N}\p{M}]/u;
            if ((before && (word.test(before) || (/['‘’]/u.test(before) && beforeQuote && word.test(beforeQuote)))) ||
                (after && (word.test(after) || (/['‘’]/u.test(after) && afterQuote && word.test(afterQuote))))) continue;
            found = true;
            const start = range.start + match.index, end = start + match[0].length;
            const unknown = heard.perceivedOpaqueSpeechSpans ?? (heard.speechComprehension === 'unintelligible' ||
                (heard.comprehensionMode === 'FAR' && heard.speechComprehension !== 'partial') ? [range] : []);
            for (const part of unknown) {
                const overlap = { start: Math.max(start, part.start) - start, end: Math.min(end, part.end) - start };
                if (overlap.end > overlap.start) opaque.push(overlap);
            }
        }
    }
    return { found, opaque };
}

type Origin = NonNullable<SpeechEcho['origin']>;
/** Targeted reverse matching of this actor's delivered audio, never a world vocabulary or translation model. */
export class SpeechEchoResolver {
    private readonly inverse = new Map<string, readonly Origin[]>();
    constructor(private readonly renderer: LanguageRenderer) {}

    private origins(message: Message, heard: Message, sound: string, encodings: Map<string, string>, allowClear: boolean): readonly Origin[] {
        const utterance = message.utterance!, record = message.languageRecord!;
        const hearing = record.hearings[String(heard.perceivedByCharacterId)];
        const registered = (this.renderer as LanguageRenderer & {
            recordedProfile?: (fingerprint: string) => LanguageRenderer | undefined
        }).recordedProfile?.(record.fingerprint);
        const voice = registered?.fingerprint === record.fingerprint ? registered
            : record.fingerprint === this.renderer.fingerprint ? this.renderer : undefined;
        const key = createHash('sha256').update(JSON.stringify([message.id, record.revision, hearing?.variant,
            record.fingerprint, this.renderer.fingerprint, voice?.fingerprint, sound, allowClear])).digest('hex');
        const cached = this.inverse.get(key);
        if (cached) return cached;
        const origins: Origin[] = [];
        // Repeated echoes retain their original provenance. A decoded ordinary word is not a new foreign sound.
        for (const echo of utterance.echoes ?? []) {
            const echoHearing = echo.hearings[String(heard.perceivedByCharacterId)];
            if (echo.origin && (echoHearing?.comprehension !== 'clear' || allowClear) && fold(echoHearing?.content ?? '') === fold(sound))
                origins.push(echo.origin);
        }
        if (hearing && (voice || hearing.mode === 'CLEAR') && (hearing.mode !== 'CLEAR' || allowClear)) {
            const maxWords = [...tokenizeSpeech(sound)].filter(token => token.word).length * 2;
            const encode = (text: string): string => {
                const key = JSON.stringify([record.fingerprint, utterance.spokenLanguageId, record.locale, hearing.plan ?? hearing.mode, text]);
                const cached = encodings.get(key);
                if (cached !== undefined) return cached;
                const part = { spokenLanguageId: utterance.spokenLanguageId, originalText: text, speechSpans: [{ start: 0, end: text.length }] };
                const content = hearing.mode === 'CLEAR' ? text : (hearing.plan ? voice!.forPlan(part, hearing.plan, record.locale)
                    : voice!.forMode(part, hearing.mode, record.locale)).content;
                if (encodings.size < 10000) encodings.set(key, content);
                return content;
            };
            for (const span of sourceSpeechSpans(utterance)) {
                let cursor = span.start;
                const words: SpeechSpan[] = [];
                for (const token of tokenizeSpeech(utterance.originalText.slice(span.start, span.end))) {
                    if (token.word) words.push({ start: cursor, end: cursor + token.text.length });
                    cursor += token.text.length;
                }
                for (let first = 0; first < words.length; first++) {
                    const firstWord = utterance.originalText.slice(words[first].start, words[first].end);
                    if (!fold(sound).startsWith(fold(encode(firstWord)))) continue;
                    for (let count = 1; count <= maxWords && first + count <= words.length; count++) {
                        const range = { start: words[first].start, end: words[first + count - 1].end };
                        if (utterance.echoes?.some(echo => echo.start < range.end && echo.end > range.start)) continue;
                        const meaning = utterance.originalText.slice(range.start, range.end);
                        const encoded = fold(encode(meaning));
                        if (encoded === fold(sound)) origins.push({ languageId: utterance.spokenLanguageId,
                            meaning, messageId: message.id!, revision: record.revision });
                        if (!fold(sound).startsWith(encoded)) break;
                    }
                }
            }
        }
        this.inverse.set(key, origins);
        if (this.inverse.size > 128) this.inverse.delete(this.inverse.keys().next().value!);
        return origins;
    }

    resolve(utterance: SpokenUtterance, history: readonly HeardSource[],
        hearings: (sound: string, origin: Origin | undefined, heardOpaque: readonly SpeechSpan[], soundLanguageId?: string) => Record<string, EchoHearing>): readonly SpeechEcho[] {
        const resolved: SpeechEcho[] = [];
        // Transient, bounded work reuse across the actor's history; no persistent word database.
        const encodings = new Map<string, string>();
        for (const fragment of quotedEchoFragments(utterance)) {
            if (resolved.length && fragment.start < resolved[resolved.length - 1].end) continue;
            const sound = audibleFragment(fragment);
            let found = false;
            const origins = new Map<string, Origin>(), opaque: SpeechSpan[] = [], languages = new Set<string>();
            for (const { message, heard } of history) {
                if (!message.utterance || !message.languageRecord || message.id === undefined ||
                    heard.perceptionPurpose === 'reader' || heard.perceivedByCharacterId === undefined) continue;
                // CLEAR ordinary dialogue is semantic speech in the reply's chosen tongue, not a phonetic exception.
                if (heard.comprehensionMode === 'CLEAR' && !message.utterance.echoes?.length && !fragment.marker) continue;
                const audible = audibleMatch(heard, sound);
                if (!audible.found) continue;
                found = true; opaque.push(...audible.opaque);
                languages.add(message.utterance.spokenLanguageId);
                for (const origin of this.origins(message, heard, sound, encodings, !!fragment.marker))
                    origins.set(JSON.stringify([origin.languageId, fold(origin.meaning)]), origin);
            }
            if (!found) continue;
            const origin = origins.size === 1 ? [...origins.values()][0] : undefined;
            const soundLanguageId = origin?.languageId ?? (languages.size === 1 ? [...languages][0] : undefined);
            const sorted = opaque.sort((a, b) => a.start - b.start || a.end - b.end), merged: SpeechSpan[] = [];
            for (const range of sorted) {
                const last = merged[merged.length - 1];
                if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
                else merged.push({ ...range });
            }
            resolved.push(Object.freeze({ ...fragment, ...(origin ? { origin: Object.freeze({ ...origin }) } : {}),
                ...(soundLanguageId ? { soundLanguageId } : {}),
                hearings: Object.freeze(Object.fromEntries(Object.entries(hearings(sound, origin, merged, soundLanguageId))
                    .map(([id, hearing]) => [id, Object.freeze({ ...hearing, opaque: Object.freeze(hearing.opaque.map(range => Object.freeze({ ...range }))) })]))) }));
        }
        return Object.freeze(resolved);
    }
}

/** Source edits may move an unchanged quote, but cannot re-open its frozen meaning or audience. */
export function relocatedEchoes(previous: SpokenUtterance, replacement: SpokenUtterance): readonly SpeechEcho[] | undefined {
    if (!previous.echoes?.length) return undefined;
    const quotes = quotedEchoFragments(replacement, true), result: SpeechEcho[] = [];
    for (const echo of previous.echoes) {
        const matches = quotes.filter(quote => audibleFragment(quote) === audibleFragment(echo));
        if (matches.length === 1 && !result.some(prior => prior.start === matches[0].start))
            result.push(Object.freeze({ ...echo, start: matches[0].start, end: matches[0].end, sound: matches[0].sound, marker: matches[0].marker }));
    }
    return Object.freeze(result.sort((a, b) => a.start - b.start));
}

export function validateSpeechEchoes(utterance: SpokenUtterance, audience?: readonly number[]): void {
    if (utterance.echoes === undefined) return;
    if (!Array.isArray(utterance.echoes)) throw new Error('Invalid speech echoes');
    const speech = sourceSpeechSpans(utterance);
    let cursor = 0;
    for (const echo of utterance.echoes) {
        if (!echo || !Number.isSafeInteger(echo.start) || !Number.isSafeInteger(echo.end) || echo.start < cursor || echo.end <= echo.start ||
            typeof echo.sound !== 'string' || echo.sound.length > 240 || utterance.originalText.slice(echo.start, echo.end) !== echo.sound ||
            !speech.some(span => echo.start >= span.start && echo.end <= span.end) || !echo.hearings || typeof echo.hearings !== 'object')
            throw new Error('Invalid audible echo evidence');
        cursor = echo.end;
        if (echo.soundLanguageId !== undefined && !/^language_[a-zA-Z0-9_]+$/.test(echo.soundLanguageId)) throw new Error('Invalid echo sound language');
        if (echo.marker !== undefined && (echo.marker !== 'phonetic-v1' || utterance.originalText.slice(echo.start - 2, echo.start) !== '<<' ||
            utterance.originalText.slice(echo.end, echo.end + 2) !== '>>')) throw new Error('Invalid phonetic echo marker');
        if (echo.origin && (!/^language_[a-zA-Z0-9_]+$/.test(echo.origin.languageId) || !echo.origin.meaning ||
            typeof echo.origin.meaning !== 'string' || echo.origin.meaning.length > 4096 || !echo.origin.messageId ||
            typeof echo.origin.messageId !== 'string' || !Number.isSafeInteger(echo.origin.revision) || echo.origin.revision < 1))
            throw new Error('Invalid echo origin');
        if (audience && (Object.keys(echo.hearings).length !== new Set(audience).size || audience.some(id => !echo.hearings[String(id)])))
            throw new Error('Missing frozen echo hearing');
        for (const [id, hearing] of Object.entries(echo.hearings as Record<string, EchoHearing>)) {
            if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || !hearing || typeof hearing.content !== 'string' ||
                !hearing.content || !['clear', 'partial', 'unintelligible'].includes(hearing.comprehension) || !Array.isArray(hearing.opaque) ||
                (!echo.origin && hearing.comprehension !== 'unintelligible'))
                throw new Error('Invalid frozen echo hearing');
            let last = 0;
            for (const range of hearing.opaque) {
                if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < last ||
                    range.end <= range.start || range.end > hearing.content.length) throw new Error('Invalid echo opacity');
                last = range.end;
            }
        }
    }
}
