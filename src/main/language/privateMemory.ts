import type { CompactedMemory, RetainedPrivateNarration } from '../../shared/compactionTypes';
import type { Message } from '../ts/conversation_interfaces';
import { promptPerceptionMessages } from './conversationView';

/** Keep already-owned source context even when a semantic summary omits it. No inference or model call. */
export function collectPrivateNarration(messages: readonly Message[], ownerId: number, sourceGameDate?: string): RetainedPrivateNarration[] {
    promptPerceptionMessages(messages, ownerId); // Validate ownership and delivered boundaries without mutating source copies.
    return messages.flatMap(message => (message.perceivedPrivateSpans ?? []).map(span => {
        if (!message.id) throw new Error('Private memory context requires a source turn ID');
        const date = message.gameDate ?? sourceGameDate;
        return { sourceMessageId: message.id, content: message.content.slice(span.start + 1, span.end - 1),
            ...(date ? { sourceGameDate: date } : {}) };
    }));
}

export function privateMemoryNarration(memory: CompactedMemory, ownerId: number,
    sourceMemories: readonly CompactedMemory[] = []): RetainedPrivateNarration[] {
    if (memory.retainedPrivateNarration === undefined && memory.retainedPrivateSourceIds === undefined) return [];
    if ((memory.retainedPrivateNarration !== undefined && !Array.isArray(memory.retainedPrivateNarration)) || memory.recipientPerspectiveId !== ownerId ||
        memory.characterIds.length !== 1 || memory.characterIds[0] !== ownerId)
        throw new Error('Retained private memory context belongs only to its owner');
    const notes = memory.retainedPrivateNarration ?? [];
    for (const note of notes) {
        if (!note || typeof note.sourceMessageId !== 'string' || !memory.sourceMessageIds.includes(note.sourceMessageId) ||
            typeof note.content !== 'string' || !note.content.trim() ||
            (note.sourceGameDate !== undefined && (typeof note.sourceGameDate !== 'string' || !note.sourceGameDate.trim())))
            throw new Error('Invalid retained private memory source');
    }
    const resolved = notes.map(note => ({ ...note }));
    if (memory.retainedPrivateSourceIds !== undefined) {
        if (memory.compactionLevel !== 2 || !Array.isArray(memory.retainedPrivateSourceIds) ||
            memory.retainedPrivateSourceIds.some(id => typeof id !== 'string' || !memory.sourceMessageIds.includes(id)))
            throw new Error('Invalid retained private memory reference');
        const sources = sourceMemories.filter(source => source.compactionLevel === 1 && source.recipientPerspectiveId === ownerId)
            .flatMap(source => privateMemoryNarration(source, ownerId));
        for (const id of memory.retainedPrivateSourceIds) {
            const matching = sources.filter(note => note.sourceMessageId === id);
            if (!matching.length) throw new Error('Retained private memory reference is missing its owned source');
            resolved.push(...matching);
        }
    }
    return [...new Map(resolved.map(note => [JSON.stringify([note.sourceMessageId, note.content, note.sourceGameDate]), note])).values()];
}

export function appendPrivateNarration(content: string, notes: readonly RetainedPrivateNarration[], seen = new Set<string>()): string {
    const unique = notes.filter(note => {
        const key = JSON.stringify([note.sourceMessageId, note.content, note.sourceGameDate]);
        if (seen.has(key)) return false; seen.add(key); return true;
    });
    return unique.length ? content + '\n\n[Unspoken recollections retained from this owner\'s source narration; preserve their stated timing and wording.]\n' +
        unique.map(note => (note.sourceGameDate ? '[Source game date: ' + note.sourceGameDate + '] ' : '') +
            '[Private inner narration, unspoken: ' + note.content + ']').join('\n') : content;
}

export function compactedMemoryText(memory: CompactedMemory, ownerId: number, seen?: Set<string>,
    sourceMemories?: readonly CompactedMemory[]): string {
    return appendPrivateNarration(memory.content, privateMemoryNarration(memory, ownerId, sourceMemories), seen);
}
