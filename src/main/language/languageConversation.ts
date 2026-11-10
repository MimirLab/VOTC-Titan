import { createHash, randomUUID } from 'crypto';
import { Character } from '../../shared/gameData/Character';
import { GameData } from '../../shared/gameData/GameData';
import { validateLanguageSnapshot } from '../../shared/gameData/LanguageSnapshot';
import { Message } from '../ts/conversation_interfaces';
import { CharacterLanguageKnowledge, ComprehensionMode, selectSpokenLanguage, knownLanguages } from './languageRouting';
import { LanguageRenderer, recordUtterance } from './languageRendering';
import { playerSpeechSpans } from '../../shared/language/playerSpeech';
import { controlledProseEditText, controlledProseView, parseControlledProse, ProseView, ControlledProseError } from '../../shared/language/controlledProse';
import type { RecipientRendering } from './languageRendering';
import type { ComprehensionPlan } from './comprehension';
import { quotedSpeechSpans } from '../../shared/language/speechSpans';
import { tokenizeSpeech } from '../../shared/language/tokenizer';
import { EchoHearing, SpeechEchoResolver, relocatedEchoes, validateSpeechEchoes, quotedEchoFragments } from './speechEchoes';

export type PerceptionPurpose = 'knowledge' | 'reader';
export interface DeliveredHearing { mode: ComprehensionMode; variant: string; plan?: ComprehensionPlan; mixedSpeech?: true }

export interface HearingRecord {
    version: 2;
    revision: number;
    fingerprint: string;
    locale: string;
    hearings: Record<string, DeliveredHearing>;
    variants: Record<string, string>;
    /** Only the encountered player has a literary reading view; backend work uses hearings. */
    reader?: { characterId: number; hearing: DeliveredHearing };
    variantSpans?: Record<string, Omit<ProseView, 'content'>>;
    variantOpaqueSpeech?: Record<string, readonly import('../../shared/language/speechSpans').SpeechSpan[]>;
}
export function markLanguageRoutingBypassed(message: Message): void {
    if (!message.utterance && !message.languageRecord && !message.recipientRenderings && message.perceivedByCharacterId === undefined &&
        message.role !== 'system' && message.name !== 'Narrator' &&
        !['scene', 'narrative', 'action', 'placeholder'].includes(message.type ?? '')) {
        message.languageRoutingBypassed = true;
        delete message.speechSpans;
    }
}
export function characterLanguages(character: Character): CharacterLanguageKnowledge {
    const snapshot = validateLanguageSnapshot(character.languageSnapshot);
    return { characterId: character.id, nativeLanguageId: snapshot.nativeLanguageId,
        ...(snapshot.learning !== undefined ? { learning: snapshot.learning } : {}),
        ...(snapshot.studyProgress ? { studyProgress: snapshot.studyProgress } : {}),
        learnedLanguageIds: snapshot.knownLanguageIds.filter(id => id !== snapshot.nativeLanguageId),
        ...(snapshot.cultureFamiliarity ? { cultureFamiliarity: snapshot.cultureFamiliarity } : {}),
        ...(snapshot.practiceFamiliarity ? { practiceFamiliarity: snapshot.practiceFamiliarity } : {}) };
}
function variantKey(message: Message, record: HearingRecord, mode: ComprehensionMode, override?: string, keepPrivate = true): string {
    return createHash('sha256').update(JSON.stringify([message.id, record.revision, message.utterance,
        mode, record.fingerprint, record.locale, override,
        ...(message.utterance?.proseEncoding ? [keepPrivate] : [])])).digest('hex');
}
function storeRendering(message: Message, record: HearingRecord, rendered: RecipientRendering,
    keepPrivate: boolean, override?: string): DeliveredHearing {
    const variant = rendered.plan ? createHash('sha256').update(JSON.stringify([message.id, record.revision,
        rendered.mode, rendered.content, rendered.spans, rendered.opaqueSpeechSpans, keepPrivate,
        ...(rendered.mixedSpeech ? [rendered.mixedSpeech] : [])])).digest('hex')
        : variantKey(message, record, rendered.mode, override, keepPrivate);
    record.variants[variant] = rendered.content;
    if (rendered.spans) (record.variantSpans ??= {})[variant] = rendered.spans;
    if (rendered.opaqueSpeechSpans) (record.variantOpaqueSpeech ??= {})[variant] = rendered.opaqueSpeechSpans;
    return { mode: rendered.mode, variant, ...(rendered.plan ? { plan: { ...rendered.plan } } : {}),
        ...(rendered.mixedSpeech ? { mixedSpeech: true } : {}) };
}
/** Copies contain only what this owner perceived. Even CLEAR copies drop all source metadata. */
export function projectRecordedMessage(message: Message, characterId: number, playerId?: number,
    purpose: PerceptionPurpose = 'knowledge'): Message | undefined {
    if (purpose === 'reader' && characterId !== playerId) throw new Error('Literary read requires the encountered player');
    // Older canonical ledgers omitted the player's author ID. Recover it only from
    // the authoritative encounter owner, on a copy; prompt roles never override an explicit author.
    if (message.characterId === undefined && playerId !== undefined && message.role === 'user' &&
        message.name !== 'Narrator' && !['scene', 'narrative', 'action', 'placeholder'].includes(message.type ?? ''))
        message = { ...message, characterId: playerId };
    if (message.perceivedByCharacterId !== undefined) {
        if (message.perceivedByCharacterId !== characterId) throw new Error("Cannot reuse another listener's rendered history");
        if ((message.perceptionPurpose ?? 'knowledge') !== purpose) throw new Error('Cannot reuse a literary view as character knowledge or the reverse');
        return { ...message };
    }
    if (message.observedByCharacterIds && !message.observedByCharacterIds.includes(characterId)) return;
    const { utterance, recipientRenderings, languageRecord, speechSpans, observedByCharacterIds,
        proseEncoding, editableContent, perceivedSpeechSpans, perceivedPrivateSpans, perceivedOpaqueSpeechSpans,
        speechComprehension, primarySpeechComprehension, languageAccommodation, perceptionPurpose, ...safe } = message;
    if (!utterance) {
        // New audio-enabled replies may use host prose controls with routing explicitly bypassed.
        // This is a clear literary projection; it creates no language knowledge or hearing plan.
        if (proseEncoding === 'controls-v1' && message.languageRoutingBypassed) {
            const view = controlledProseView(parseControlledProse(message.content), purpose === 'reader' || message.characterId === characterId);
            return { ...safe, content: view.content, proseEncoding, perceivedByCharacterId: characterId, perceptionPurpose: purpose,
                perceivedSpeechSpans: view.speechSpans,
                ...(purpose === 'reader' ? { editableContent: controlledProseEditText(view) } :
                    message.characterId === characterId ? { perceivedPrivateSpans: view.proseSpans.filter(span => span.kind === 'private') } : {}) };
        }
        if (languageRecord || recipientRenderings || proseEncoding) throw new Error('Hearing record is missing its source');
        return { ...safe, ...(message.actions ? { actions: message.actions.map(action => ({ ...action })) } : {}) };
    }
    const hearing = purpose === 'reader' && utterance.proseEncoding
        ? languageRecord?.reader?.characterId === characterId ? languageRecord.reader.hearing : undefined
        : languageRecord?.hearings[String(characterId)];
    const legacy = recipientRenderings?.[String(characterId)];
    const content = hearing ? languageRecord!.variants[hearing.variant] : legacy?.content;
    if (typeof content !== 'string') throw new Error('No recorded rendering for this conversation recipient');
    const spans = hearing && languageRecord?.variantSpans?.[hearing.variant];
    if (utterance.proseEncoding && !spans) throw new Error('Controlled hearing is missing its boundaries');
    if (purpose === 'knowledge' && characterId !== message.characterId && spans?.proseSpans.some(span => span.kind === 'private'))
        throw new Error('Another character\'s private narration cannot enter character knowledge');
    const deliveredContent = utterance.proseEncoding && purpose === 'knowledge' && !content.trim()
        ? '[No spoken words or public action is described in this turn.]' : content;
    return { ...safe, content: deliveredContent, perceivedByCharacterId: characterId, perceptionPurpose: purpose,
        comprehensionMode: hearing?.mode ?? legacy!.mode,
        ...(hearing?.mixedSpeech ? { speechComprehension: 'partial' as const,
            primarySpeechComprehension: hearing.plan?.belt === 'clear' || (!hearing.plan && hearing.mode === 'CLEAR') ? 'clear' as const
                : hearing.plan?.belt === 'far' || (!hearing.plan && hearing.mode === 'FAR') ? 'unintelligible' as const : 'partial' as const }
            : hearing?.plan ? { speechComprehension: hearing.plan.belt === 'clear' ? 'clear' as const
            : hearing.plan.belt === 'far' ? 'unintelligible' as const : 'partial' as const } : {}),
        ...(hearing && languageRecord?.variantOpaqueSpeech?.[hearing.variant] ? {
            perceivedOpaqueSpeechSpans: languageRecord.variantOpaqueSpeech[hearing.variant].map(span => ({ ...span })) } : {}),
        ...(spans ? { perceivedSpeechSpans: spans.speechSpans.map(span => ({ ...span })),
            ...(purpose === 'knowledge' && characterId === message.characterId ? {
                perceivedPrivateSpans: spans.proseSpans.filter(span => span.kind === 'private')
                    .map(({ start, end }) => ({ start, end })) } : {}),
            ...(purpose === 'reader' && utterance.proseEncoding ? { editableContent: controlledProseEditText({ content, ...spans }) } : {}) } : {}) };
}
/** One source event, shared renderings by language mode and private visibility. */
export class LanguageConversation {
    private readonly echoResolver: SpeechEchoResolver;
    constructor(readonly game: GameData, private readonly renderer: LanguageRenderer, private readonly locale = 'en',
        private readonly requireVerifiedKnowledge = false, private readonly enabled: () => boolean = () => true,
        private readonly history: () => readonly Message[] = () => []) { this.echoResolver = new SpeechEchoResolver(renderer); }
    get available(): boolean { return [...this.game.characters.values()].some(character => !!character.languageSnapshot); }
    record(message: Message, recipientId?: number): void {
        // Frozen views survive departed speakers, new arrivals, toggle changes and profile revisions.
        if (message.languageRecord || message.recipientRenderings) {
            if (message.utterance?.originalText !== message.content) throw new Error('Canonical source changed outside the ledger edit path');
            return;
        }
        if (message.role === 'system' || message.name === 'Narrator' ||
            ['scene', 'narrative', 'action', 'placeholder'].includes(message.type ?? '') ||
            message.perceivedByCharacterId !== undefined || message.languageRoutingBypassed) return;
        if (!this.enabled()) { markLanguageRoutingBypassed(message); return; }
        const speakerId = message.characterId ?? (message.role === 'user' ? this.game.playerID : undefined);
        const speaker = speakerId === undefined ? undefined : this.game.characters.get(speakerId);
        if (!speaker) {
            if (message.utterance || this.requireVerifiedKnowledge) throw new Error('Recorded utterance has no observed speaker');
            return;
        }
        if (!this.available) {
            if (this.requireVerifiedKnowledge || message.proseEncoding) throw new Error('Character language knowledge has not been captured');
            return;
        }
        const targets = (message as Message & { targetCharacterIds?: number[] }).targetCharacterIds;
        const target = this.game.characters.get(recipientId ?? (targets?.length === 1 ? targets[0]
            : speaker.id === this.game.playerID ? this.game.aiID : this.game.playerID));
        if (message.proseEncoding) parseControlledProse(message.content); // Reject before committing any recipient.
        const spans = message.proseEncoding ? undefined : message.speechSpans ?? (message.role === 'user' ? playerSpeechSpans(message.content) : undefined);
        const speakerKnowledge = characterLanguages(speaker), targetKnowledge = target ? characterLanguages(target) : undefined;
        // Pure voice-preview/legacy fixtures retain the old full-CLOSE API. Production always supplies current capture.
        const adaptive = this.requireVerifiedKnowledge || speakerKnowledge.learning !== undefined;
        const spoken = message.spokenLanguageId ?? selectSpokenLanguage(speakerKnowledge, targetKnowledge, undefined, [],
            adaptive ? this.renderer.close.profiles.routing : undefined);
        let utterance: import('./languageRendering').SpokenUtterance = Object.freeze({ ...recordUtterance(message.content, speakerKnowledge, targetKnowledge,
            spoken, spans), ...(message.proseEncoding ? { proseEncoding: message.proseEncoding } : {}) });
        if (targets && (new Set(targets).size !== targets.length || targets.some(id =>
            !Number.isSafeInteger(id) || !this.game.characters.has(id)))) throw new Error('Invalid addressed participants');
        const addressed = new Set(recipientId !== undefined ? [recipientId] : targets ?? (target ? [target.id] : []));
        const audience = [...this.game.characters.values()].filter(character =>
            !message.observedByCharacterIds || message.observedByCharacterIds.includes(character.id));
        const heardHistory = quotedEchoFragments(utterance).length ? this.history().flatMap(previous => {
            const heard = projectRecordedMessage(previous, speaker.id, this.game.playerID);
            return heard ? [{ message: previous, heard }] : [];
        }) : [];
        const echoes = this.echoResolver.resolve(utterance, heardHistory, (sound, origin, heardOpaque, soundLanguageId) => {
            const hearings: Record<string, EchoHearing> = {};
            for (const character of audience) {
                const knowledge = characterLanguages(character);
                if (!origin) {
                    const tokens = [...tokenizeSpeech(sound)];
                    let offset = 0;
                    const opaqueSound = tokens.every(token => { const start = offset; offset += token.text.length;
                        return !token.word || heardOpaque.some(range => range.start <= start && range.end >= offset); });
                    const unresolved = character.id === speaker.id || opaqueSound ? sound : this.renderer.forMode({
                        spokenLanguageId: soundLanguageId ?? utterance.spokenLanguageId, originalText: sound,
                        speechSpans: [{ start: 0, end: sound.length }] }, 'FAR', this.locale).content;
                    hearings[String(character.id)] = { content: unresolved, comprehension: 'unintelligible', opaque: [{ start: 0, end: unresolved.length }] };
                    continue;
                }
                if (character.id === speaker.id && !knownLanguages(knowledge).includes(origin.languageId)) {
                    hearings[String(character.id)] = { content: sound, comprehension: heardOpaque.length ? 'unintelligible' : 'partial', opaque: heardOpaque };
                    continue;
                }
                const semantic = { spokenLanguageId: origin.languageId, originalText: origin.meaning,
                    speechSpans: [{ start: 0, end: origin.meaning.length }] };
                // Copying a sound cannot productively accommodate a meaning the quoter never knew.
                const rendered = this.renderer.forListener(semantic, knowledge, this.locale, true,
                    adaptive ? { speaker: speakerKnowledge, addressed: false } : undefined);
                const comprehension = rendered.plan?.belt === 'far' || (!rendered.plan && rendered.mode === 'FAR') ? 'unintelligible'
                    : rendered.mode === 'CLEAR' ? 'clear' : 'partial';
                hearings[String(character.id)] = comprehension === 'unintelligible'
                    ? { content: rendered.content, comprehension, opaque: [{ start: 0, end: rendered.content.length }] }
                    : { content: rendered.content, comprehension, opaque: rendered.opaqueSpeechSpans ?? [] };
            }
            return hearings;
        });
        if (echoes.length) utterance = Object.freeze({ ...utterance, echoes });
        const markerPositions = [...utterance.originalText.matchAll(/<<|>>/g)].map(match => match.index!);
        const acceptedMarkers = echoes.filter(echo => echo.marker).flatMap(echo => [echo.start - 2, echo.end]);
        if (markerPositions.some(position => !acceptedMarkers.includes(position)))
            throw new ControlledProseError('The marked sound was not recorded as audible to this character', 'echo');
        validateSpeechEchoes(utterance, audience.map(character => character.id));
        message.id ??= randomUUID();
        const record: HearingRecord = { version: 2, revision: 1, fingerprint: this.renderer.fingerprint,
            locale: this.locale, hearings: {}, variants: {} };
        const candidate: Message = { ...message, utterance, languageRecord: record };
        for (const character of this.game.characters.values()) {
            if (message.observedByCharacterIds && !message.observedByCharacterIds.includes(character.id)) continue;
            const rendered = character.id === speakerId ? this.renderer.forMode(utterance, 'CLEAR', this.locale, true, character.id)
                : this.renderer.forListener(utterance, characterLanguages(character), this.locale, false,
                    adaptive ? { speaker: speakerKnowledge,
                        addressed: addressed.has(character.id) && message.languageAccommodation !== 'none' } : undefined);
            record.hearings[String(character.id)] = storeRendering(candidate, record, rendered, character.id === speakerId);
        }
        const playerHearing = record.hearings[String(this.game.playerID)];
        if (utterance.proseEncoding && playerHearing) record.reader = { characterId: this.game.playerID,
            hearing: storeRendering(candidate, record, playerHearing.plan
                ? this.renderer.forPlan(utterance, playerHearing.plan, this.locale, true, this.game.playerID)
                : this.renderer.forMode(utterance, playerHearing.mode, this.locale, true, this.game.playerID), true) };
        // Commit only after all recipients and quote boundaries validate.
        message.characterId = speakerId;
        message.utterance = utterance; message.spokenLanguageId = utterance.spokenLanguageId; message.languageRecord = record;
        message.observedByCharacterIds ??= [...this.game.characters.keys()];
    }
    forRecipient(message: Message, characterId: number, purpose: PerceptionPurpose = 'knowledge'): Message {
        this.record(message);
        const view = projectRecordedMessage(message, characterId, this.game.playerID, purpose);
        if (!view) throw new Error('Recipient was not present for this turn');
        return view;
    }
    editForRecipient(message: Message, characterId: number, content: string, purpose: PerceptionPurpose = 'knowledge'): void {
        this.record(message);
        const view = this.forRecipient(message, characterId, purpose);
        const previous = message.languageRecord;
        if (!previous) { message.content = content; return; }
        const controlled = !!message.utterance?.proseEncoding;
        const edited = controlled ? parseControlledProse(content) : undefined;
        if (view.comprehensionMode !== 'CLEAR' || (controlled && purpose === 'knowledge' && characterId !== message.characterId)) {
            if (controlled) {
                const record: HearingRecord = { ...previous, hearings: { ...previous.hearings }, variants: { ...previous.variants },
                    variantSpans: { ...previous.variantSpans }, variantOpaqueSpeech: { ...previous.variantOpaqueSpeech } };
                const mode = view.comprehensionMode!;
                const keepPrivate = characterId === message.characterId;
                const { content: heard, ...spans } = controlledProseView(edited!, keepPrivate);
                record.hearings[String(characterId)] = storeRendering(message, record,
                    { mode, spokenLanguageId: message.spokenLanguageId!, content: heard, spans,
                        ...(previous.hearings[String(characterId)].plan ? { opaqueSpeechSpans: [] } : {}) }, keepPrivate, content);
                // A manual perception edit replaces only this delivered view; its own plan remains pinned.
                record.hearings[String(characterId)].plan = previous.hearings[String(characterId)].plan;
                if (purpose === 'reader') {
                    const { content: read, ...readerSpans } = controlledProseView(edited!, true);
                    record.reader = { characterId, hearing: storeRendering(message, record,
                        { mode, spokenLanguageId: message.spokenLanguageId!, content: read, spans: readerSpans,
                            ...(previous.reader?.hearing.plan ? { opaqueSpeechSpans: [] } : {}) }, true, content) };
                    record.reader.hearing.plan = previous.reader?.hearing.plan;
                }
                message.languageRecord = record;
                return;
            }
            const hearing = previous.hearings[String(characterId)];
            const key = variantKey(message, previous, hearing.mode, content);
            message.languageRecord = { ...previous, hearings: { ...previous.hearings,
                [String(characterId)]: { ...hearing, variant: key } }, variants: { ...previous.variants, [key]: content } };
            if (hearing.plan) {
                message.languageRecord.variantSpans = { ...previous.variantSpans,
                    [key]: { speechSpans: message.role === 'user' ? playerSpeechSpans(content) : quotedSpeechSpans(content), proseSpans: [] } };
                message.languageRecord.variantOpaqueSpeech = { ...previous.variantOpaqueSpeech, [key]: [] };
            }
        } else {
            // Source edits keep the original tongue, attendance and each listener's historical comprehension.
            // An explicitly shipped older revision keeps its original voice and plan.
            // Unknown revisions still cannot be silently replaced by current sounds.
            const renderer = this.renderer.recordedProfile(previous.fingerprint);
            if (!renderer) throw new Error('Source edit requires the recorded sound profile');
            const replacement = { ...message.utterance!, originalText: content,
                speechSpans: !controlled && message.role === 'user' ? playerSpeechSpans(content) : undefined };
            const utterance = Object.freeze({ ...replacement, echoes: relocatedEchoes(message.utterance!, replacement) });
            if (!/<<|>>/.test(message.utterance!.originalText) || message.utterance!.echoes?.some(echo => echo.marker)) {
                const accepted = utterance.echoes?.filter(echo => echo.marker).flatMap(echo => [echo.start - 2, echo.end]) ?? [];
                if ([...content.matchAll(/<<|>>/g)].some(match => !accepted.includes(match.index!)))
                    throw new ControlledProseError('A source edit cannot introduce an unrecorded phonetic fragment', 'echo');
            }
            const record: HearingRecord = { ...previous, revision: previous.revision + 1, hearings: {}, variants: {},
                variantOpaqueSpeech: {}, ...(controlled ? { variantSpans: {}, reader: undefined } : {}) };
            const candidate = { ...message, content, utterance };
            for (const [id, hearing] of Object.entries(previous.hearings)) {
                const keepPrivate = Number(id) === message.characterId;
                const rendered = hearing.plan ? renderer.forPlan(utterance, hearing.plan, previous.locale, keepPrivate, Number(id))
                    : renderer.forMode(utterance, hearing.mode, previous.locale, keepPrivate, Number(id));
                record.hearings[id] = storeRendering(candidate, record, rendered, keepPrivate);
            }
            if (controlled && previous.reader) record.reader = { characterId: previous.reader.characterId,
                hearing: storeRendering(candidate, record, previous.reader.hearing.plan
                    ? renderer.forPlan(utterance, previous.reader.hearing.plan, previous.locale, true, previous.reader.characterId)
                    : renderer.forMode(utterance, previous.reader.hearing.mode, previous.locale, true, previous.reader.characterId), true) };
            message.content = content; message.utterance = utterance; message.languageRecord = record;
        }
    }
    messagesForRecipient(messages: readonly Message[], characterId: number, purpose: PerceptionPurpose = 'knowledge'): Message[] {
        const views: Message[] = [];
        for (const message of messages) { this.record(message); const view = projectRecordedMessage(message, characterId, this.game.playerID, purpose); if (view) views.push(view); }
        return views;
    }
    /** Legacy export adapter only. New persistence writes a single canonical ledger. */
    historyRecords(messages: readonly Message[]): Record<string, Message[]> {
        const ids = new Set(messages.flatMap(message => message.observedByCharacterIds ?? [...this.game.characters.keys()]));
        return Object.fromEntries([...ids].map(id => [String(id), this.messagesForRecipient(messages, id)]));
    }
}
