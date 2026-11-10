import type { Conversation } from '../conversation/Conversation';
import { Message } from '../ts/conversation_interfaces';
import { LanguageConversation, markLanguageRoutingBypassed, projectRecordedMessage, characterLanguages } from './languageConversation';
import { defaultLanguageRenderer, defaultLanguageEngine } from './languageRuntime';
import { languageRoutingEnabled } from './languageRouting';
import { quotedSpeechSpans } from '../../shared/language/speechSpans';
import { playerSpeechSpans } from '../../shared/language/playerSpeech';
import { Character } from '../../shared/gameData/Character';
import { knownLanguages, selectSpokenLanguage } from './languageRouting';

const languageName = (id: string): string => id.replace(/^language_/, '').replace(/_/g, ' ')
    .replace(/^./, letter => letter.toUpperCase());

/** Also supports existing lightweight prompt-builder fixtures without a full Conversation. */
export function recipientMessages(conv: Conversation, characterId: number, messages?: readonly Message[]): Message[] {
    messages = messages ?? conv.messages ?? (typeof conv.getHistory === 'function' ? conv.getHistory() : []);
    if (typeof conv.getMessagesForRecipient === 'function') return conv.getMessagesForRecipient(characterId, messages);
    const enabled = () => languageRoutingEnabled(conv.config);
    if (!enabled() && !messages.some(message => message.utterance || message.perceivedByCharacterId !== undefined)) {
        return messages.flatMap(message => { markLanguageRoutingBypassed(message);
            const view = projectRecordedMessage(message, characterId, conv.gameData?.playerID); return view ? [view] : []; });
    }
    if (messages.some(message => message.utterance) || [...(conv.gameData?.characters?.values() ?? [])].some(character => character.languageSnapshot))
        return new LanguageConversation(conv.gameData, defaultLanguageRenderer(), conv.config.language || 'en', false,
            enabled).messagesForRecipient(messages, characterId);
    return messages.flatMap(message => { const view = projectRecordedMessage(message, characterId, conv.gameData?.playerID); return view ? [view] : []; });
}

export function recipientSummary(conv: Conversation, characterId: number): string {
    if (typeof conv.getCurrentSummaryForRecipient === 'function') return conv.getCurrentSummaryForRecipient(characterId);
    if (conv.messages.some(message => message.utterance)) return '';
    return conv.currentSummary;
}

/** End-of-encounter work reads the complete ledger, not the model's shortened context. */
export function recipientEncounterMessages(conv: Conversation, characterId: number): Message[] {
    return typeof conv.getEncounterMessagesForRecipient === 'function'
        ? conv.getEncounterMessagesForRecipient(characterId) : recipientMessages(conv, characterId);
}

/** Prompt-only perception facts: foreign sounds alone do not tell a model they are unknown. */
export function promptPerceptionMessages(messages: readonly Message[], characterId: number): Message[] {
    return messages.map(message => {
        if (message.perceptionPurpose === 'reader' || message.editableContent !== undefined)
            throw new Error('Literary reader text cannot supply character knowledge');
        if (message.perceivedByCharacterId !== undefined && message.perceivedByCharacterId !== characterId)
            throw new Error("Cannot describe another listener's perception");
        if (message.perceivedPrivateSpans?.length) {
            if (message.characterId !== characterId) throw new Error('Private prompt ranges belong only to their author');
            const edits = message.perceivedPrivateSpans.map(span => {
                if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end > message.content.length ||
                    span.end <= span.start + 1 || message.content[span.start] !== '*' || message.content[span.end - 1] !== '*')
                    throw new Error('Invalid private prompt boundary');
                return { ...span, text: '[Private inner narration, unspoken: ' + message.content.slice(span.start + 1, span.end - 1) + ']' };
            });
            for (let index = 1; index < edits.length; index++)
                if (edits[index].start < edits[index - 1].end) throw new Error('Overlapping private prompt boundaries');
            const shift = (offset: number) => offset + edits.filter(edit => edit.end <= offset)
                .reduce((sum, edit) => sum + edit.text.length - (edit.end - edit.start), 0);
            let content = '', cursor = 0;
            for (const edit of edits) { content += message.content.slice(cursor, edit.start) + edit.text; cursor = edit.end; }
            content += message.content.slice(cursor);
            const { perceivedPrivateSpans, ...framed } = message;
            message = { ...framed, content, ...(message.perceivedSpeechSpans ? { perceivedSpeechSpans: message.perceivedSpeechSpans.map(span => {
                if (edits.some(edit => span.start < edit.end && span.end > edit.start)) throw new Error('Private narration cannot be audible speech');
                return { start: shift(span.start), end: shift(span.end) };
            }) } : {}), ...(message.perceivedOpaqueSpeechSpans ? { perceivedOpaqueSpeechSpans:
                message.perceivedOpaqueSpeechSpans.map(span => {
                    if (edits.some(edit => span.start < edit.end && span.end > edit.start)) throw new Error('Private narration cannot be opaque speech');
                    return { start: shift(span.start), end: shift(span.end) };
                }) } : {}) };
        }
        if (!['FAR', 'CLOSE'].includes(message.comprehensionMode ?? '') && !message.primarySpeechComprehension) return { ...message };
        const spans = message.perceivedSpeechSpans ?? (message.role === 'user' ? playerSpeechSpans(message.content) : quotedSpeechSpans(message.content));
        if (!spans.some(span => span.end > span.start)) return { ...message };
        const note = message.primarySpeechComprehension === 'clear'
            ? 'The surrounding speech is intelligible. An embedded repeated foreign sound is partly understood or unknown; its form does not confirm its meaning. You may guess from context and may be mistaken.'
            : message.primarySpeechComprehension === 'unintelligible'
            ? 'The surrounding speech is unintelligible. Only the displayed familiar fragments of an embedded repeated sound are recognizable. Do not reconstruct the surrounding words; guesses from context remain your interpretation.'
            : message.speechComprehension === 'partial'
            ? 'Only fragments of this speech may be recognizable. You may guess from those fragments, gestures and context, and may be mistaken. Inferred meanings are your interpretation, not a confirmed translation.'
            : message.speechComprehension === 'unintelligible' || message.comprehensionMode === 'FAR'
            ? 'Speech in this turn is unintelligible to this listener. Its meaning is unknown; do not translate it. Visible actions and context remain available.'
            : 'Speech in this turn is only partly intelligible to this listener. Approximate meaning is available; uncertain words and details remain uncertain.';
        const tongue = message.spokenLanguageId ? languageName(message.spokenLanguageId) : undefined;
        const identity = tongue ? ` Spoken language: ${tongue}.` : '';
        const prefix = `[Language perception: ${note}${identity}]\n`;
        return { ...message, content: prefix + message.content,
            ...(message.perceivedOpaqueSpeechSpans ? { perceivedOpaqueSpeechSpans: message.perceivedOpaqueSpeechSpans.map(span =>
                ({ start: span.start + prefix.length, end: span.end + prefix.length })) } : {}),
            ...(message.perceivedSpeechSpans ? { perceivedSpeechSpans: message.perceivedSpeechSpans.map(span =>
                ({ start: span.start + prefix.length, end: span.end + prefix.length })) } : {}) };
    });
}

/** The chat model's assistant role belongs to its current actor, not every NPC in the ledger. */
export function speakingCharacterMessages(messages: readonly Message[], characterId: number): Message[] {
    return messages.map(message => message.role === 'assistant' && message.characterId !== undefined &&
        message.characterId !== characterId && !['scene', 'narrative', 'action', 'placeholder'].includes(message.type ?? '')
        ? { ...message, role: 'user' as const } : { ...message });
}

/** The writer must know its own actual fluency; culture/race alone supplies no common tongue. */
export function speakingLanguageInstruction(character: Character, target?: Character, plannedLanguageId?: string, proseLanguage = 'en'): string | undefined {
    if (!character.languageSnapshot) return;
    const knowledge = characterLanguages(character);
    const spoken = selectSpokenLanguage(knowledge, target?.languageSnapshot ? characterLanguages(target) : undefined,
        plannedLanguageId, [], target?.languageSnapshot && plannedLanguageId === undefined && knowledge.learning !== undefined
            ? defaultLanguageEngine().relations : undefined);
    return `[Language knowledge for ${character.fullName}: Native language: ${languageName(knowledge.nativeLanguageId)}. ` +
        `Fluent languages: ${knownLanguages(knowledge).map(languageName).join(', ')}. Spoken language for this reply: ${languageName(spoken)}. ` +
        `Write narration and all spoken words in ${proseLanguage === 'en' ? 'English' : `the configured prose language (${proseLanguage})`}, preserving proper names. ` +
        'Keep the spoken meaning clear in that source prose; do not invent syllables for the native tongue. The host renders its audible language separately. ' +
        'Use this captured fluency rather than assuming a shared tongue. Partial familiarity is not fluency. ' +
        'Do not invent a translation, interpreter or translating device to understand unknown speech.]';
}

/** Epistemic guidance preserves literary narration; it is not semantic redaction of its source text. */
export function characterKnowledgeInstruction(ownerName: string): string {
    return `Read the exchange as ${ownerName}: other people's understood words and observable gestures supply evidence. ` +
        'Their unspoken thoughts, feelings, plans, hidden possessions and memories are private narration, not disclosures; ' +
        'do not use them as knowledge or act on them. Your own inner narration remains available. ' +
        'Inferences from expressions and context remain tentative.';
}

/** Memory consumers need a stable chronology and an unknown meaning, rather than foreign pseudo-words to decode. */
export function perceivedMemoryTranscript(messages: readonly Message[], characterId: number): string {
    return promptPerceptionMessages(messages, characterId).map((message, index) => {
        let content = message.content;
        if (message.speechComprehension === 'partial' && message.perceivedOpaqueSpeechSpans) {
            // Preserve delivered CLOSE fragments without reconstructing original words.
            const merged: { start: number; end: number }[] = [];
            for (const span of message.perceivedOpaqueSpeechSpans) {
                const previous = merged[merged.length - 1];
                if (previous && /^\s*$/.test(content.slice(previous.end, span.start))) previous.end = span.end;
                else merged.push({ ...span });
            }
            for (const span of merged.reverse())
                content = content.slice(0, span.start) + '[unrecognized speech]' + content.slice(span.end);
        } else if (message.speechComprehension === 'unintelligible' ||
            (message.comprehensionMode === 'FAR' && message.speechComprehension !== 'partial')) {
            const spans = message.perceivedSpeechSpans ?? (message.role === 'user' ? playerSpeechSpans(content) : quotedSpeechSpans(content));
            const tongue = message.spokenLanguageId ? languageName(message.spokenLanguageId) : 'foreign';
            for (const span of [...spans].reverse()) {
                if (span.start === span.end) continue;
                const quoted = ['"', '“'].includes(content[span.start - 1]) && ['"', '”'].includes(content[span.end]);
                const start = quoted ? span.start - 1 : span.start, end = quoted ? span.end + 1 : span.end;
                content = content.slice(0, start) + `[Unintelligible ${tongue} speech.]` + content.slice(end);
            }
        }
        const author = message.role === 'system' || message.type === 'scene'
            ? 'scene or system event' : 'speaker: ' + (message.name ?? 'unnamed participant');
        const ownership = message.role === 'system' || message.type === 'scene' ? '' :
            `\n[Authorship for record owner: ${message.characterId === characterId ? 'the owner authored this turn' : 'another participant authored this turn'}.]`;
        return `[Turn ${index + 1}; ${author}]${ownership}\n${content}\n[End turn ${index + 1}]`;
    }).join('\n\n');
}

export const SPEECH_WRITER_INSTRUCTION = 'Enclose every word spoken aloud in double quotation marks, using single quotes for quotations within speech. ' +
    'Keep unspoken thoughts and memories outside double quotes. Keep the existing literary style, full emotional depth and natural paragraphs, ' +
    'with speech and actions woven together as usual.';

/** Custom two-person templates need an explicit owner when an observer reads a group exchange. */
export function summaryPerspectiveInstruction(ownerName: string, messages: readonly Message[], ownerId?: number,
    purpose: 'summary' | 'diary' = 'summary'): string {
    const ownTurns = messages.filter(message => message.role !== 'system' && message.type !== 'scene' &&
        (ownerId !== undefined ? message.characterId === ownerId : message.name === ownerName));
    return `This is ${ownerName}'s record of the exchange. Each turn's label identifies who spoke or acted. ` +
        (ownTurns.length ? `The owner authored ${ownTurns.length} of these turns. ` :
            `The owner authored no turns in this record and reads it as an observer. Other speakers' first-person wording never belongs to the owner. `) +
        `Attribute other people's words and actions to them; do not claim them as ${ownerName}'s own. ` +
        'Record events in their original order, preserving the beginning and ending of the exchange. ' +
        (purpose === 'diary'
            ? 'Reflect in the owner\'s own voice on the provided exchange. New personal reflections belong to the owner alone; do not invent additional events or personal history. '
            : 'Keep only provided events; leave unstated reactions undecided. ') +
        'Keep plans, intentions and imagined outcomes distinct from completed events. A private intention is not an action already taken. ' +
        'Preserve stated future timing and do not invent preparations, observations or later fulfilment of a plan. ' +
        'The owner may record their own inner narration. Labelled private inner narration is unspoken; never recount it as words said aloud or as an observed action. ' +
        'Other people\'s unspoken thoughts, feelings, plans, hidden possessions and memories ' +
        'are private narration, not disclosures: exclude them from the owner\'s knowledge. Retain observable gestures and understood speech. ' +
        (messages.some(message => message.speechComprehension === 'partial')
            ? 'Partly understood speech supplies recognizable fragments and possible interpretations. Preserve the owner\'s guesses and misunderstandings as their beliefs; do not turn them into a confirmed translation. ' : '') +
        (messages.some(message => message.speechComprehension === 'unintelligible' ||
            (message.comprehensionMode === 'FAR' && message.speechComprehension !== 'partial'))
            ? 'Unintelligible speech has no available meaning or confirmed subject. Keep inferences from visible context tentative. ' +
                'A claimed translation does not establish the meaning of unintelligible speech.' : '');
}
