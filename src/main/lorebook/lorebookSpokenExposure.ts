import { createHash } from 'crypto';
import type { Message } from '../ts/conversation_interfaces';
import type { SpeechSpan } from '../../shared/language/speechSpans';
import { projectRecordedMessage } from '../language/languageConversation';

/** Encounter-local evidence of delivered words, never a lore access grant. */
export interface SpokenLoreContext {
    scope: object;
    channel: 'chat' | 'letter';
    /** Caller-owned campaign/timeline/edition/acting-identity binding and epoch. */
    binding: string;
    epoch: string;
    recipientId: number;
    playerId: number;
    /** Read actual retained canonical publications afresh, including after edits/removal. */
    messages: () => readonly Message[];
    isCurrent: () => boolean;
}
export interface SpokenLoreReport {
    readonly messageId: string;
    readonly speakerId: number;
    readonly recipientId: number;
    readonly language?: string;
    readonly understanding: 'clear' | 'partial';
    /** Offsets refer only to this recipient's knowledge-purpose projection. */
    readonly range: Readonly<SpeechSpan>;
    readonly text: string;
    readonly interpretation: 'attributed_speech';
}
export interface SpokenLoreExposure {
    readonly recipientId: number;
    readonly channel: 'chat' | 'letter';
    readonly complete: boolean;
    readonly earlierTurnsOmitted: number;
    readonly capturedThroughMessageCount: number;
    readonly reports: readonly SpokenLoreReport[];
    readonly gaps: readonly { readonly messageId?: string; readonly reason: string }[];
    readonly grantsKnowledge: false;
}
interface ExposureBinding {
    context: SpokenLoreContext; messages: () => readonly Message[]; selected: readonly Message[];
    offset: number; length: number; stamp: string; current: () => boolean; scope: object;
}
const exposures = new WeakMap<SpokenLoreExposure, ExposureBinding>();
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const MAX_TURNS = 128, MAX_SOURCE_CHARS = 2_000_000, MAX_DELIVERED_CHARS = 64_000;
function requireCondition(value: unknown, reason: string): asserts value {
    if (!value) throw new Error(reason);
}
function fingerprint(context: SpokenLoreContext, selected: readonly Message[]): string {
    const publications = selected.map(message => {
        const stamp = { id: message.id, role: message.role, type: message.type, name: message.name, speaker: message.characterId,
            projected: message.perceivedByCharacterId, purpose: message.perceptionPurpose,
            attended: message.observedByCharacterIds?.includes(context.recipientId),
            sourceMatches: !message.utterance || message.utterance.originalText === message.content };
        if (!stamp.attended || !stamp.sourceMatches || stamp.projected !== undefined || stamp.purpose) return stamp;
        try {
            const view = projectRecordedMessage(message, context.recipientId, context.playerId, 'knowledge');
            return { ...stamp, hearing: view && { content: view.content, language: view.spokenLanguageId,
                mode: view.comprehensionMode, comprehension: view.speechComprehension, primary: view.primarySpeechComprehension,
                speech: view.perceivedSpeechSpans, private: view.perceivedPrivateSpans, opaque: view.perceivedOpaqueSpeechSpans } };
        } catch { return { ...stamp, projectionUnavailable: true }; }
    });
    // Another listener's literary/hearing edit is not a change to this
    // recipient's delivered speech. Canonical object identity is checked below.
    return digest([context.channel, context.binding, context.epoch, context.recipientId, context.playerId, publications]);
}
function orderedRanges(ranges: readonly SpeechSpan[], length: number): boolean {
    return ranges.every((range, index) => Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) &&
        range.start >= (index ? ranges[index - 1].end : 0) && range.end > range.start && range.end <= length);
}
const overlaps = (a: SpeechSpan, b: SpeechSpan): boolean => a.start < b.end && b.start < a.end;

/** Only actual recorded hearings supply speech boundaries. Missing metadata is
 * an explicit gap; neither quoted literary text nor targets fill it in. */
export function captureSpokenLoreExposure(context: SpokenLoreContext, publication?: Message): SpokenLoreExposure {
    requireCondition(context.scope && typeof context.scope === 'object' && typeof context.binding === 'string' && context.binding &&
        typeof context.epoch === 'string' && context.epoch &&
        Number.isSafeInteger(context.recipientId) && context.recipientId > 0 &&
        Number.isSafeInteger(context.playerId) && context.playerId > 0 &&
        ['chat', 'letter'].includes(context.channel) && typeof context.messages === 'function' && Array.isArray(context.messages()) &&
        typeof context.isCurrent === 'function' && context.isCurrent() === true, 'Invalid or stale spoken lore context.');
    const readMessages = context.messages, messages = readMessages(), offset = Math.max(0, messages.length - MAX_TURNS), selected = messages.slice(offset);
    const encoded = JSON.stringify(selected);
    requireCondition(encoded.length <= MAX_SOURCE_CHARS, 'Spoken lore source budget exceeded.');
    const stamp = fingerprint(context, selected), current = context.isCurrent, scope = context.scope;
    const reports: SpokenLoreReport[] = [], gaps: { messageId?: string; reason: string }[] = [];
    let deliveredChars = 0;
    if (context.channel === 'letter') gaps.push({ reason: 'letter_read_receipt_unavailable' });
    else for (const message of selected) {
        if (publication && message !== publication) continue;
        const messageId = message.id, gap = (reason: string): void => { gaps.push({ ...(messageId ? { messageId } : {}), reason }); };
        if (message.role === 'system' || message.name === 'Narrator' ||
            ['scene', 'narrative', 'action', 'placeholder'].includes(message.type ?? '')) continue;
        if (!messageId || selected.filter(other => other.id === messageId).length !== 1) { gap('missing_or_duplicate_publication_id'); continue; }
        if (message.perceivedByCharacterId !== undefined || message.perceptionPurpose || message.editableContent !== undefined) {
            gap('projected_or_literary_input'); continue;
        }
        if (!message.observedByCharacterIds) { gap('attendance_unavailable'); continue; }
        if (!message.observedByCharacterIds.includes(context.recipientId)) continue;
        if (!Number.isSafeInteger(message.characterId) || message.characterId! <= 0) { gap('speaker_unavailable'); continue; }
        if (message.utterance && message.utterance.originalText !== message.content) { gap('canonical_source_changed'); continue; }
        let view: Message | undefined;
        try { view = projectRecordedMessage(message, context.recipientId, context.playerId, 'knowledge'); }
        catch { gap('hearing_projection_unavailable'); continue; }
        if (!view) continue;
        const speech = view.perceivedSpeechSpans;
        // Legacy records without retained ranges cannot establish which quoted
        // words were spoken rather than narration. Keep ordinary RP unchanged.
        if (!speech) { gap('recorded_speech_boundaries_unavailable'); continue; }
        const privateRanges = view.perceivedPrivateSpans ?? [], opaque = view.perceivedOpaqueSpeechSpans ?? [];
        if (!orderedRanges(speech, view.content.length) || !orderedRanges(privateRanges, view.content.length) ||
            !orderedRanges(opaque, view.content.length) || speech.some(span => privateRanges.some(p => overlaps(span, p))) ||
            opaque.some(span => !speech.some(s => s.start <= span.start && s.end >= span.end))) {
            gap('invalid_recorded_speech_boundaries'); continue;
        }
        const primary = view.primarySpeechComprehension ?? view.speechComprehension ??
            (view.comprehensionMode === 'FAR' ? 'unintelligible' : view.comprehensionMode === 'CLOSE' ? 'partial' : 'clear');
        if (primary === 'unintelligible' && view.speechComprehension !== 'partial') {
            if (speech.length) gap('unintelligible_speech'); continue;
        }
        if (primary !== 'clear' && speech.length) gap('partial_speech');
        if (opaque.length) gap('opaque_speech_ranges');
        for (const span of speech) {
            const pieces: SpeechSpan[] = []; let start = span.start;
            for (const hidden of opaque.filter(part => overlaps(span, part))) {
                if (start < hidden.start) pieces.push({ start, end: hidden.start });
                start = hidden.end;
            }
            if (start < span.end) pieces.push({ start, end: span.end });
            for (const range of pieces) {
                const text = view.content.slice(range.start, range.end);
                if (!text.trim()) continue;
                if (deliveredChars + text.length > MAX_DELIVERED_CHARS) { gap('delivered_speech_budget'); continue; }
                deliveredChars += text.length;
                reports.push(Object.freeze({ messageId, speakerId: message.characterId!, recipientId: context.recipientId,
                    ...(view.spokenLanguageId ? { language: view.spokenLanguageId } : {}),
                    understanding: primary === 'clear' ? 'clear' as const : 'partial' as const,
                    range: Object.freeze(range), text, interpretation: 'attributed_speech' as const }));
            }
        }
    }
    const view: SpokenLoreExposure = Object.freeze({ recipientId: context.recipientId, channel: context.channel,
        complete: offset === 0 && gaps.length === 0, earlierTurnsOmitted: offset, capturedThroughMessageCount: messages.length,
        reports: Object.freeze(reports), gaps: Object.freeze(gaps.map(gap => Object.freeze(gap))), grantsKnowledge: false as const });
    exposures.set(view, { context, messages: readMessages, selected, offset, length: messages.length, stamp, current, scope });
    assertSpokenLoreExposure(view, context); return view;
}
export function assertSpokenLoreExposure(view: SpokenLoreExposure, context: SpokenLoreContext): void {
    const bound = exposures.get(view), messages = context.messages();
    requireCondition(bound && bound.context === context && bound.scope === context.scope &&
        bound.current === context.isCurrent && context.isCurrent() === true && context.messages === bound.messages &&
        messages.length >= bound.length && bound.selected.every((message, index) => messages[bound.offset + index] === message) &&
        fingerprint(context, bound.selected) === bound.stamp, 'Unbound or stale spoken lore exposure.');
}

export interface SpokenAccountInput {
    original: readonly Message[]; actorId: number; result: any; isCurrent: () => boolean;
}
/** Opaque source binding; importing a JSON copy never creates this handle. */
export interface SpokenLoreAccounts { readonly assurance: 'admitted_bodies_only' }
const accountBindings = new WeakMap<SpokenLoreAccounts, { input: SpokenAccountInput; stamp: string;
    bodies: readonly { nodeId: string; text: string; sha256: string }[]; current: () => boolean }>();
export function bindSpokenLoreAccounts(input: SpokenAccountInput): SpokenLoreAccounts {
    const { result, actorId, original } = input;
    requireCondition(Number.isSafeInteger(actorId) && actorId > 0 && Array.isArray(original) && typeof input.isCurrent === 'function' &&
        input.isCurrent() === true && result && result.actor_id === String(actorId) &&
        typeof result.context_fingerprint === 'string' && result.context_fingerprint &&
        Array.isArray(result.passages) && result.passages.length <= 3 && Array.isArray(result.trace), 'Invalid admitted spoken accounts.');
    const bodies = result.passages.map((passage: any) => {
        const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
        requireCondition(typeof passage.node_id === 'string' && passage.node_id && typeof passage.heading === 'string' &&
            typeof passage.text === 'string' && passage.text.trim() && passage.text.length <= 16_000 &&
            original.some(message => message.content.includes(passage.heading + '\n' + passage.text)) &&
            result.trace.some((trace: any) => trace.status === 'accepted' && trace.node_id === passage.node_id &&
                trace.resolved_body_sha256 === hash(passage.text)), 'Whole admitted body and retained original proof required.');
        return Object.freeze({ nodeId: passage.node_id as string, text: passage.text as string, sha256: hash(passage.text) });
    });
    const handle = Object.freeze({ assurance: 'admitted_bodies_only' as const });
    accountBindings.set(handle, { input, bodies, current: input.isCurrent, stamp: digest([actorId, original, result]) }); return handle;
}
export function literalSpokenLoreCoverage(view: SpokenLoreExposure, context: SpokenLoreContext, accounts: SpokenLoreAccounts): readonly {
    nodeId: string; bodySha256: string; messageId: string; speakerId: number; recipientId: number;
    range: SpeechSpan; interpretation: 'attributed_report_only'; grantsKnowledge: false;
}[] {
    assertSpokenLoreExposure(view, context);
    const bound = accountBindings.get(accounts);
    requireCondition(bound && bound.current === bound.input.isCurrent && bound.current() === true &&
        digest([bound.input.actorId, bound.input.original, bound.input.result]) === bound.stamp, 'Unbound or changed admitted spoken accounts.');
    const coverage = view.reports.flatMap(report => report.understanding !== 'clear' || report.speakerId !== bound.input.actorId ? [] :
        bound.bodies.flatMap(body => {
            const start = report.text.indexOf(body.text);
            return start < 0 ? [] : [{ nodeId: body.nodeId, bodySha256: body.sha256, messageId: report.messageId,
                speakerId: report.speakerId, recipientId: report.recipientId,
                range: { start: report.range.start + start, end: report.range.start + start + body.text.length },
                interpretation: 'attributed_report_only' as const, grantsKnowledge: false as const }];
        }));
    assertSpokenLoreExposure(view, context); return coverage;
}

// This is a deliberately small lexical routing signal, not an entailment or
// knowledge test. Only words in the admitted body participate: chapter names
// and navigation metadata cannot make an unrelated reply count as engagement.
const TOPIC_STOP = new Set(('a an the i you we they he she it my your our his her their and or of to in is are was were be been being do does did can could would should will shall have has had for with that this what when where how why which tell about me please say explain describe teach discuss give know both them those these more further details detail continue also then go on next so if am as at by but not no yes who may might must than until while now here there only very still just some any all each every other another something anything nothing someone anyone everyone one two three four five six seven eight nine ten first second').split(' '));
function topicWords(text: string): Set<string> {
    return new Set((text.normalize('NFKC').toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? [])
        .filter(word => word.length >= 4 && !TOPIC_STOP.has(word))
        .map(word => word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word));
}
function activeTopicSpeech(text: string): string {
    // Preserve ordinary negation ("a noble cannot erase a contract") but do
    // not count an explicitly postponed/refused discussion as an explanation.
    return text.replace(/[\u2018\u2019]/gu, "'").split(/(?<=[.!?;])\s+|\s+but\s+/iu).filter(clause => !(
        /\b(?:can|could|will)\s+wait\b/iu.test(clause) ||
        /\b(?:talk|discuss|explain|teach|tell|speak|hear|learn)\b[^.!?;]{0,160}\b(?:later|tomorrow|another time|another day)\b/iu.test(clause) ||
        /\b(?:will not|won't|cannot|can't|refuse to|not going to|do not want to|don't want to)\s+(?:talk|discuss|explain|teach|tell|speak)\b/iu.test(clause)
    )).join(' ');
}
export interface SpokenLoreTopic {
    readonly nodeId: string; readonly bodySha256: string; readonly messageIds: readonly string[];
    readonly matchedTerms: readonly string[]; readonly interpretation: 'topic_routing_only';
    readonly wholeAccountDisclosed: false; readonly grantsKnowledge: false;
}
/** Link clear delivered dialogue to an already admitted topic without claiming
 * a full quotation, factual fidelity, or access to any additional chapter. Split
 * speech ranges may contribute, but private/opaque/partial words never do. */
export function lexicalSpokenLoreTopics(view: SpokenLoreExposure, context: SpokenLoreContext, accounts: SpokenLoreAccounts): readonly SpokenLoreTopic[] {
    assertSpokenLoreExposure(view, context);
    const bound = accountBindings.get(accounts);
    requireCondition(bound && bound.current === bound.input.isCurrent && bound.current() === true &&
        digest([bound.input.actorId, bound.input.original, bound.input.result]) === bound.stamp, 'Unbound or changed admitted spoken accounts.');
    const reports = view.reports.filter(report => report.understanding === 'clear' && report.speakerId === bound.input.actorId);
    const active = reports.map(report => ({ report, words: topicWords(activeTopicSpeech(report.text)) }));
    const topics = bound.bodies.flatMap(body => {
        const bodyWords = topicWords(body.text), words = new Set(active.flatMap(row => [...row.words]));
        const matchedTerms = [...bodyWords].filter(word => words.has(word));
        if (matchedTerms.length < 2 || !matchedTerms.some(word => word.length >= 6)) return [];
        return [Object.freeze({ nodeId: body.nodeId, bodySha256: body.sha256,
            messageIds: Object.freeze([...new Set(active.filter(row => matchedTerms.some(term => row.words.has(term))).map(row => row.report.messageId))]),
            matchedTerms: Object.freeze(matchedTerms), interpretation: 'topic_routing_only' as const,
            wholeAccountDisclosed: false as const, grantsKnowledge: false as const })];
    });
    assertSpokenLoreExposure(view, context); return Object.freeze(topics);
}

/** Encounter-local routing cursor. Literal mode proves an attributed complete
 * quotation only. Topic mode can route from a short paraphrase and explicitly
 * makes no claim that the listener received the complete account. */
export class SpokenLoreProgress {
    constructor(private readonly routing: 'literal' | 'topic' = 'literal') {}
    private scopes = new WeakMap<object, Map<string, { binding: string; epoch: string; state: any;
        view: SpokenLoreExposure; context: SpokenLoreContext }>>();
    private key(context: SpokenLoreContext, speakerId: number): string {
        requireCondition(Number.isSafeInteger(speakerId) && speakerId > 0, 'Invalid spoken progress speaker.');
        return `${context.channel}:${speakerId}:${context.recipientId}`;
    }
    previous(context: SpokenLoreContext, speakerId: number): unknown {
        const row = this.scopes.get(context.scope)?.get(this.key(context, speakerId));
        if (!row || row.binding !== context.binding || row.epoch !== context.epoch || context.isCurrent() !== true) return;
        try { assertSpokenLoreExposure(row.view, row.context); }
        catch { return; }
        return JSON.parse(JSON.stringify(row.state));
    }
    /** Read-only candidate for token/preview builds; no cursor is consumed. */
    propose(view: SpokenLoreExposure, context: SpokenLoreContext, accounts: SpokenLoreAccounts): unknown {
        const coverage = literalSpokenLoreCoverage(view, context, accounts), bound = accountBindings.get(accounts)!;
        const topics = this.routing === 'topic' ? lexicalSpokenLoreTopics(view, context, accounts) : [];
        const actorId = bound.input.actorId, result = bound.input.result, state = result.state;
        const linked = new Set([...coverage, ...topics].map(row => row.nodeId));
        if (context.channel !== 'chat' || !bound.bodies.length || (this.routing === 'literal'
            ? bound.bodies.some(body => !linked.has(body.nodeId)) : !linked.has(state?.focus))) return;
        requireCondition(state && state.version === 'titan-progressive-lore-v2' && state.context === result.context_fingerprint &&
            typeof state.root === 'string' && state.root && typeof state.focus === 'string' &&
            bound.bodies.some(body => body.nodeId === state.focus) && Array.isArray(state.shown) && state.shown.length <= 32 &&
            state.shown.every((id: unknown) => typeof id === 'string' && id) &&
            bound.bodies.every(body => state.shown.includes(body.nodeId)) &&
            result.passages.every((passage: any) => passage.subject_id === state.root), 'Spoken progress requires the exact admitted chapter cursor.');
        const previous = this.previous(context, actorId) as any;
        const allowed = new Set([...(previous?.shown ?? []), ...bound.bodies.map(body => body.nodeId)]);
        requireCondition(state.shown.every((id: string) => allowed.has(id)), 'Spoken cursor contains chapters not heard by this recipient.');
        if (this.routing === 'literal') return JSON.parse(JSON.stringify(state));
        const routed = new Set([...(previous?.shown ?? []), ...linked]);
        return JSON.parse(JSON.stringify({ ...state, shown: state.shown.filter((id: string) => routed.has(id)),
            focus_origin: 'dialogue', cursor_basis: 'spoken_topic_route' }));
    }
    record(view: SpokenLoreExposure, context: SpokenLoreContext, accounts: SpokenLoreAccounts): boolean {
        const state = this.propose(view, context, accounts);
        if (!state) return false;
        const actorId = accountBindings.get(accounts)!.input.actorId;
        let entries = this.scopes.get(context.scope);
        if (!entries) { entries = new Map(); this.scopes.set(context.scope, entries); }
        entries.set(this.key(context, actorId), { binding: context.binding, epoch: context.epoch,
            state: JSON.parse(JSON.stringify(state)), view, context });
        while (entries.size > 16) entries.delete(entries.keys().next().value!);
        return true;
    }
    forget(context: SpokenLoreContext, speakerId: number): void {
        this.scopes.get(context.scope)?.delete(this.key(context, speakerId));
    }
}
