import { Message } from '../ts/conversation_interfaces';
import { LedgerSnapshot } from './conversationLedger';
import { projectRecordedMessage, PerceptionPurpose } from './languageConversation';
import { parseControlledProse } from '../../shared/language/controlledProse';
import { validateComprehensionPlan } from './comprehension';
import { validateSpeechEchoes } from './speechEchoes';

export interface RecipientHistory {
    version: 1;
    date: string;
    recipients: Record<string, Message[]>;
}

/** A sidecar has listener copies only. A reader explicitly selects one recipient. */
export function recipientHistory(date: string, views: Record<string, Message[]>): RecipientHistory {
    for (const [id, messages] of Object.entries(views)) {
        if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('Invalid history recipient');
        for (const message of messages) {
            if (message.utterance || message.languageRecord || message.recipientRenderings || message.speechSpans ||
                (message.perceivedByCharacterId !== undefined && message.perceivedByCharacterId !== Number(id)))
                throw new Error('History must contain this recipient\'s projected messages only');
        }
    }
    return { version: 1, date, recipients: views };
}

export function readRecipientHistory(value: unknown, characterId: number, purpose: PerceptionPurpose = 'knowledge'): Message[] {
    if ((value as LedgerSnapshot)?.version === 2) {
        const ledger = validateLedger(value);
        return ledger.messages.flatMap(message => {
            const view = projectRecordedMessage(message, characterId, ledger.playerId, purpose); return view ? [view] : [];
        });
    }
    const history = value as RecipientHistory;
    if (!history || history.version !== 1 || typeof history.date !== 'string' ||
        !history.recipients || !Array.isArray(history.recipients[String(characterId)]))
        throw new Error('Missing recipient history');
    recipientHistory(history.date, { [String(characterId)]: history.recipients[String(characterId)] });
    return history.recipients[String(characterId)].map(message => {
        if (purpose === 'knowledge' && message.perceptionPurpose === 'reader') throw new Error('Legacy reader history cannot supply character knowledge');
        return { ...message, ...(message.perceivedByCharacterId !== undefined ? { perceptionPurpose: purpose } : {}) };
    });
}

/** Corrupt or incomplete new records never fall back to an omniscient/plain-text transcript. */
export function validateLedger(value: unknown): LedgerSnapshot {
    const ledger = value as LedgerSnapshot;
    if (!ledger || ledger.version !== 2 || typeof ledger.id !== 'string' || !ledger.id ||
        !Number.isSafeInteger(ledger.revision) || ledger.revision < 0 || typeof ledger.date !== 'string' ||
        !Number.isSafeInteger(ledger.playerId) || !Array.isArray(ledger.messages)) throw new Error('Invalid conversation ledger');
    const ids = new Set<string>();
    for (const message of ledger.messages) {
        if (!message || typeof message.id !== 'string' || ids.has(message.id) || typeof message.content !== 'string' ||
            !['user', 'assistant', 'system'].includes(message.role) || message.perceivedByCharacterId !== undefined ||
            message.recipientRenderings || !Array.isArray(message.observedByCharacterIds) ||
            message.observedByCharacterIds.some(id => !Number.isSafeInteger(id))) throw new Error('Invalid canonical turn');
        ids.add(message.id);
        const record = message.languageRecord;
        if (message.utterance) {
            if (!record || record.version !== 2 || !Number.isSafeInteger(record.revision) || record.revision < 1 ||
                typeof record.fingerprint !== 'string' || typeof record.locale !== 'string' || !record.hearings || !record.variants ||
                message.utterance.originalText !== message.content || typeof message.utterance.spokenLanguageId !== 'string' ||
                Object.keys(record.hearings).length !== new Set(message.observedByCharacterIds).size)
                throw new Error('Invalid hearing record');
            validateSpeechEchoes(message.utterance, message.observedByCharacterIds);
            for (const id of message.observedByCharacterIds) {
                const hearing = record.hearings[String(id)];
                if (!hearing || !['CLEAR', 'CLOSE', 'FAR'].includes(hearing.mode) ||
                    typeof hearing.variant !== 'string' || typeof record.variants[hearing.variant] !== 'string')
                    throw new Error('Missing delivered rendering');
                if (hearing.mixedSpeech !== undefined && (hearing.mixedSpeech !== true || !message.utterance.echoes?.length ||
                    !Array.isArray(record.variantOpaqueSpeech?.[hearing.variant]))) throw new Error('Invalid mixed echo hearing');
                if (hearing.plan) {
                    const plan = validateComprehensionPlan(hearing.plan);
                    if (plan.mode !== hearing.mode ||
                        (['mutual', 'recognition', 'study'].includes(plan.belt) &&
                            (plan.owner !== String(id) || plan.language !== message.spokenLanguageId)) ||
                        (plan.belt === 'assisted' && plan.owner !== String(message.characterId)) ||
                        (plan.assistance && plan.assistance.owner !== String(message.characterId)))
                        throw new Error('Invalid hearing vocabulary owner');
                    if (['mutual', 'recognition', 'assisted', 'study'].includes(plan.belt) &&
                        !Array.isArray(record.variantOpaqueSpeech?.[hearing.variant]))
                        throw new Error('Missing opaque speech boundaries');
                }
            }
            for (const [variant, ranges] of Object.entries(record.variantOpaqueSpeech ?? {})) {
                const content = record.variants[variant], speech = record.variantSpans?.[variant]?.speechSpans;
                if (typeof content !== 'string' || !Array.isArray(ranges) || !speech) throw new Error('Invalid opaque speech variant');
                let cursor = 0;
                for (const span of ranges) {
                    if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < cursor ||
                        span.end <= span.start || span.end > content.length ||
                        !speech.some(range => span.start >= range.start && span.end <= range.end))
                        throw new Error('Invalid opaque speech boundaries');
                    cursor = span.end;
                }
            }
            if (message.proseEncoding || message.utterance.proseEncoding) {
                if (message.proseEncoding !== 'controls-v1' || message.utterance.proseEncoding !== 'controls-v1' ||
                    !Number.isSafeInteger(message.characterId) || !message.observedByCharacterIds.includes(message.characterId!) ||
                    !record.variantSpans) throw new Error('Invalid controlled source');
                parseControlledProse(message.content);
                const check = (hearing: import('./languageConversation').DeliveredHearing, own: boolean): void => {
                    const content = record.variants[hearing.variant], spans = record.variantSpans![hearing.variant];
                    if (typeof content !== 'string' || !spans || !Array.isArray(spans.proseSpans) || !Array.isArray(spans.speechSpans))
                        throw new Error('Missing controlled hearing boundaries');
                    let cursor = 0;
                    for (const span of spans.proseSpans) {
                        if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start !== cursor ||
                            span.end < span.start || span.end > content.length || !['gap', 'action', 'speech', 'private'].includes(span.kind) ||
                            (!own && span.kind === 'private')) throw new Error('Invalid controlled hearing boundaries');
                        cursor = span.end;
                    }
                    if (cursor !== content.length || JSON.stringify(spans.speechSpans) !== JSON.stringify(
                        spans.proseSpans.filter(span => span.kind === 'speech').map(span => ({ start: span.start + 1, end: span.end - 1 }))))
                        throw new Error('Invalid delivered speech boundaries');
                };
                for (const id of message.observedByCharacterIds) check(record.hearings[String(id)], id === message.characterId);
                if (message.observedByCharacterIds.includes(ledger.playerId)) {
                    if (record.reader?.characterId !== ledger.playerId || !['CLEAR', 'CLOSE', 'FAR'].includes(record.reader.hearing.mode))
                        throw new Error('Missing controlled literary hearing');
                    if (record.reader.hearing.mode !== record.hearings[String(ledger.playerId)].mode)
                        throw new Error('Literary hearing changed language comprehension');
                    if (JSON.stringify(record.reader.hearing.plan) !== JSON.stringify(record.hearings[String(ledger.playerId)].plan))
                        throw new Error('Literary hearing changed comprehension plan');
                    if (record.reader.hearing.mixedSpeech !== record.hearings[String(ledger.playerId)].mixedSpeech)
                        throw new Error('Literary hearing changed embedded comprehension');
                    check(record.reader.hearing, true);
                } else if (record.reader) throw new Error('Literary reader was absent');
            }
        } else if (record || message.proseEncoding) {
            if (!record && message.proseEncoding === 'controls-v1' && message.languageRoutingBypassed)
                parseControlledProse(message.content);
            else throw new Error('Hearing record is missing its source');
        }
    }
    return ledger;
}
