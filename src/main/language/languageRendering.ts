import { mapSpeechSpans, quotedSpeechSpans, SpeechSpan } from '../../shared/language/speechSpans';
import { CloseEncoder } from './closeEncoder';
import { CharacterLanguageKnowledge, ComprehensionMode, knownLanguages, resolveMode, selectSpokenLanguage } from './languageRouting';
import { controlledProseView, parseControlledProse, ProseView } from '../../shared/language/controlledProse';
import { tokenizeSpeech, SpeechToken } from '../../shared/language/tokenizer';
import { comprehensionPlan, ComprehensionPlan, maskPercent, validateComprehensionPlan } from './comprehension';
import { SpeechEcho, sourceSpeechSpans, validateSpeechEchoes } from './speechEchoes';

/** Central/sender record. Never send this source object alongside a recipient's rendered text. */
export interface SpokenUtterance {
    readonly spokenLanguageId: string;
    readonly originalText: string;
    readonly speechSpans?: readonly SpeechSpan[];
    readonly proseEncoding?: 'controls-v1';
    readonly echoes?: readonly SpeechEcho[];
}
export interface RecipientRendering {
    readonly spokenLanguageId: string;
    readonly mode: ComprehensionMode;
    readonly content: string;
    readonly spans?: Omit<ProseView, 'content'>;
    readonly plan?: ComprehensionPlan;
    readonly opaqueSpeechSpans?: readonly SpeechSpan[];
    readonly mixedSpeech?: true;
}
export interface FarUtteranceEncoder {
    render(text: string, language: string, spans: readonly SpeechSpan[]): string;
    word?(text: string, language: string): string;
}

export function recordUtterance(text: string, speaker: CharacterLanguageKnowledge,
    recipient?: CharacterLanguageKnowledge, explicitChoice?: string, speechSpans?: readonly SpeechSpan[]): SpokenUtterance {
    return Object.freeze({ spokenLanguageId: selectSpokenLanguage(speaker, recipient, explicitChoice), originalText: text,
        ...(speechSpans ? { speechSpans: Object.freeze(speechSpans.map(span => Object.freeze({ ...span }))) } : {}) });
}

export class LanguageRenderer {
    private readonly recordedProfiles = new Map<string, LanguageRenderer>();
    private cachedUtterance?: SpokenUtterance;
    private readonly prepared = new Map<string, readonly SpeechToken[]>();
    private readonly wordEncodings = new Map<string, string>();
    constructor(readonly close: CloseEncoder, private readonly far: FarUtteranceEncoder,
        readonly fingerprint = 'fixture') {}

    /** Only shipped, validated voice revisions are registered by the asset loader. */
    registerRecordedProfile(renderer: LanguageRenderer): void {
        if (renderer.fingerprint === this.fingerprint) return;
        if (this.recordedProfiles.has(renderer.fingerprint)) throw new Error('Duplicate recorded sound profile');
        this.recordedProfiles.set(renderer.fingerprint, renderer);
    }

    recordedProfile(fingerprint: string): LanguageRenderer | undefined {
        return fingerprint === this.fingerprint ? this : this.recordedProfiles.get(fingerprint);
    }

    forListener(utterance: SpokenUtterance, listener: CharacterLanguageKnowledge, locale = 'en', keepPrivate = false,
        context?: { speaker: CharacterLanguageKnowledge; addressed: boolean }): RecipientRendering {
        if (context) return this.forPlan(utterance, comprehensionPlan(utterance.spokenLanguageId, listener,
            this.close.profiles.routing, context.speaker, context.addressed), locale, keepPrivate, Number(listener.characterId));
        const mode = resolveMode(utterance.spokenLanguageId, knownLanguages(listener), this.close.profiles, listener);
        return this.forMode(utterance, mode, locale, keepPrivate, Number(listener.characterId));
    }

    /** No source vocabulary or mask ownership leaves the canonical backend record. */
    forPlan(utterance: SpokenUtterance, supplied: ComprehensionPlan, locale = 'en', keepPrivate = true, recipientId?: number): RecipientRendering {
        const plan = validateComprehensionPlan(supplied);
        if (utterance.echoes?.length) {
            const effective = !['clear', 'far'].includes(plan.belt) && locale.toLowerCase().split(/[-_]/)[0] !== this.close.profiles.sourceLocale
                ? { version: plan.version, mode: plan.mode, belt: 'far' as const, cutoff: 0 } : plan;
            return this.withEchoes(utterance, effective.mode, locale, keepPrivate, recipientId, effective);
        }
        if (plan.belt === 'clear' || plan.belt === 'far') {
            const rendered = this.forMode(utterance, plan.belt === 'clear' ? 'CLEAR' : 'FAR', locale, keepPrivate);
            return { ...rendered, mode: plan.mode, plan };
        }
        if (locale.toLowerCase().split(/[-_]/)[0] !== this.close.profiles.sourceLocale)
            return { ...this.forMode(utterance, 'FAR', locale, keepPrivate), mode: plan.mode,
                plan: { version: plan.version, mode: plan.mode, belt: 'far', cutoff: 0 } };
        if (this.cachedUtterance !== utterance) {
            this.cachedUtterance = utterance; this.prepared.clear(); this.wordEncodings.clear();
        }
        const prepared = this.prepared, wordEncodings = this.wordEncodings;
        const encode = (text: string): { content: string; opaque: SpeechSpan[] } => {
            let tokens = prepared!.get(text);
            if (!tokens) { tokens = [...tokenizeSpeech(text)]; prepared!.set(text, tokens); }
            let content = ''; const opaque: SpeechSpan[] = [];
            const selected = new Map<string, boolean>();
            for (const token of tokens) {
                if (!token.word) { content += token.text; continue; }
                let close = selected.get(token.text);
                if (close === undefined) {
                    close = maskPercent(plan.owner, plan.language!, token.text) < plan.cutoff || !!(plan.assistance &&
                        maskPercent(plan.assistance.owner, plan.assistance.language, token.text) < plan.assistance.cutoff);
                    selected.set(token.text, close);
                }
                const start = content.length;
                const key = JSON.stringify([close, utterance.spokenLanguageId, token.text]);
                let encodedWord = wordEncodings!.get(key);
                if (encodedWord === undefined) { encodedWord = close ? this.close.word(token.text, utterance.spokenLanguageId)
                    : this.far.word ? this.far.word(token.text, utterance.spokenLanguageId)
                    : this.far.render(token.text, utterance.spokenLanguageId, [{ start: 0, end: token.text.length }]);
                    wordEncodings!.set(key, encodedWord);
                }
                content += encodedWord;
                if (!close) opaque.push({ start, end: content.length });
            }
            return { content, opaque };
        };
        const opaqueSpeechSpans: SpeechSpan[] = [];
        if (utterance.proseEncoding) {
            const encodings: ReturnType<typeof encode>[] = [];
            const { content, ...spans } = controlledProseView(parseControlledProse(utterance.originalText), keepPrivate, text => {
                const encoded = encode(text); encodings.push(encoded); return encoded.content;
            });
            spans.speechSpans.forEach((span, index) => encodings[index].opaque.forEach(range =>
                opaqueSpeechSpans.push({ start: span.start + range.start, end: span.start + range.end })));
            return { spokenLanguageId: utterance.spokenLanguageId, mode: plan.mode, plan, content, spans, opaqueSpeechSpans };
        }
        const source = utterance.originalText, ranges = utterance.speechSpans ?? quotedSpeechSpans(source);
        // Validate source offsets before constructing any delivered view.
        mapSpeechSpans(source, ranges, text => text);
        let content = '', cursor = 0; const speechSpans: SpeechSpan[] = [];
        for (const range of ranges) {
            content += source.slice(cursor, range.start);
            const start = content.length, encoded = encode(source.slice(range.start, range.end));
            content += encoded.content; speechSpans.push({ start, end: content.length });
            encoded.opaque.forEach(span => opaqueSpeechSpans.push({ start: start + span.start, end: start + span.end }));
            cursor = range.end;
        }
        content += source.slice(cursor);
        return { spokenLanguageId: utterance.spokenLanguageId, mode: plan.mode, plan, content,
            spans: { speechSpans, proseSpans: [] }, opaqueSpeechSpans };
    }

    /** Historical hearing is fixed at delivery; never consult a listener's later knowledge. */
    forMode(utterance: SpokenUtterance, mode: ComprehensionMode, locale = 'en', keepPrivate = true, recipientId?: number): RecipientRendering {
        if (utterance.echoes?.length) return this.withEchoes(utterance, mode, locale, keepPrivate, recipientId);
        if (utterance.proseEncoding) {
            if (utterance.proseEncoding !== 'controls-v1') throw new Error('Unsupported source prose encoding');
            const encode = mode === 'CLEAR' ? (text: string) => text : mode === 'CLOSE'
                ? (text: string) => this.close.speech(text, utterance.spokenLanguageId, locale)
                : (text: string) => this.far.render(text, utterance.spokenLanguageId, [{ start: 0, end: text.length }]);
            const { content, ...spans } = controlledProseView(parseControlledProse(utterance.originalText), keepPrivate, encode);
            return { spokenLanguageId: utterance.spokenLanguageId, mode, content, spans };
        }
        if (mode === 'CLEAR') return { spokenLanguageId: utterance.spokenLanguageId, mode, content: utterance.originalText };
        const spans = utterance.speechSpans ?? quotedSpeechSpans(utterance.originalText);
        const content = mode === 'CLOSE'
            ? mapSpeechSpans(utterance.originalText, spans, text => this.close.speech(text, utterance.spokenLanguageId, locale))
            : this.far.render(utterance.originalText, utterance.spokenLanguageId, spans);
        return { spokenLanguageId: utterance.spokenLanguageId, mode, content };
    }

    /** Only a few protected echo fragments vary inside the otherwise unchanged primary-language plan. */
    private withEchoes(utterance: SpokenUtterance, mode: ComprehensionMode, locale: string, keepPrivate: boolean,
        recipientId?: number, plan?: ComprehensionPlan): RecipientRendering {
        validateSpeechEchoes(utterance);
        if (!Number.isSafeInteger(recipientId)) throw new Error('Echo rendering requires its recorded recipient');
        const encodings: { content: string; opaque: SpeechSpan[] }[] = [];
        let differentComprehension = false;
        const primary = plan?.belt === 'far' || (!plan && mode === 'FAR') ? 'unintelligible'
            : plan?.belt === 'clear' || (!plan && mode === 'CLEAR') ? 'clear' : 'partial';
        const encode = (text: string, sourceStart: number): string => {
            let content = '', cursor = 0;
            const opaque: SpeechSpan[] = [];
            const ordinary = (part: string): void => {
                if (!part) return;
                const original = { spokenLanguageId: utterance.spokenLanguageId, originalText: part, speechSpans: [{ start: 0, end: part.length }] };
                const rendered = plan ? this.forPlan(original, plan, locale) : this.forMode(original, mode, locale);
                const ranges = rendered.opaqueSpeechSpans ?? (primary === 'unintelligible' && /[\p{L}\p{N}]/u.test(part)
                    ? [{ start: 0, end: rendered.content.length }] : []);
                ranges.forEach(range => opaque.push({ start: content.length + range.start, end: content.length + range.end }));
                content += rendered.content;
            };
            for (const echo of utterance.echoes!) {
                if (echo.start < sourceStart || echo.end > sourceStart + text.length) continue;
                ordinary(text.slice(cursor, echo.start - sourceStart - (echo.marker ? 2 : 0)));
                const hearing = echo.hearings[String(recipientId)];
                if (!hearing) throw new Error('Missing frozen echo hearing for recipient');
                if (hearing.comprehension !== primary) differentComprehension = true;
                const alreadyQuoted = echo.marker && ['\'', '‘'].includes(text[echo.start - sourceStart - 3]) &&
                    ['\'', '’'].includes(text[echo.end - sourceStart + 2]);
                if (echo.marker && !alreadyQuoted) content += "'";
                hearing.opaque.forEach(range => opaque.push({ start: content.length + range.start, end: content.length + range.end }));
                content += hearing.content;
                if (echo.marker && !alreadyQuoted) content += "'";
                cursor = echo.end - sourceStart + (echo.marker ? 2 : 0);
            }
            ordinary(text.slice(cursor)); encodings.push({ content, opaque }); return content;
        };
        let content: string, spans: Omit<ProseView, 'content'>;
        if (utterance.proseEncoding) {
            const view = controlledProseView(parseControlledProse(utterance.originalText), keepPrivate, encode);
            content = view.content; spans = { speechSpans: view.speechSpans, proseSpans: view.proseSpans };
        } else {
            const source = utterance.originalText, ranges = sourceSpeechSpans(utterance);
            mapSpeechSpans(source, ranges, text => text);
            const speechSpans: SpeechSpan[] = [];
            content = ''; let cursor = 0;
            for (const range of ranges) {
                content += source.slice(cursor, range.start); const start = content.length;
                content += encode(source.slice(range.start, range.end), range.start);
                speechSpans.push({ start, end: content.length }); cursor = range.end;
            }
            content += source.slice(cursor); spans = { speechSpans, proseSpans: [] };
        }
        const opaqueSpeechSpans = spans.speechSpans.flatMap((span, index) => encodings[index].opaque
            .map(range => ({ start: span.start + range.start, end: span.start + range.end })));
        return { spokenLanguageId: utterance.spokenLanguageId, mode, ...(plan ? { plan } : {}), content, spans, opaqueSpeechSpans,
            ...(differentComprehension ? { mixedSpeech: true as const } : {}) };
    }
}
