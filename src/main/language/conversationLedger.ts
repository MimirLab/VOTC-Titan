import { randomUUID } from 'crypto';
import { Character } from '../../shared/gameData/Character';
import { Message } from '../ts/conversation_interfaces';
import { projectRecordedMessage, PerceptionPurpose } from './languageConversation';

export interface LedgerSnapshot {
    version: 2;
    id: string;
    revision: number;
    date: string;
    playerId: number;
    scene?: string;
    location?: string;
    messages: Message[];
}
/** Durable encounter history is independent of the model's trimmed working context. */
export class ConversationLedger {
    constructor(private readonly playerId?: number) {}
    readonly id = randomUUID();
    revision = 0;
    private turns: Message[] = [];
    private participants = new Map<number, Character>();
    append(message: Message, characters: Iterable<Character>): void {
        if (message.type === 'placeholder') return;
        message.id ??= randomUUID();
        if (this.turns.some(turn => turn.id === message.id)) return;
        const present = [...characters];
        // Verified lore/background bindings belong to the actual Character object. Retain
        // the last observed object after departure; delivered hearings are frozen separately.
        for (const character of present) this.participants.set(character.id, character);
        message.observedByCharacterIds ??= present.map(character => character.id);
        this.turns.push(message); this.revision++;
    }
    get messages(): readonly Message[] { return this.turns; }
    get characters(): Character[] { return [...this.participants.values()]; }
    read(characterId: number, range?: readonly string[], expectedRevision = this.revision, purpose: PerceptionPurpose = 'knowledge'): Message[] {
        if (expectedRevision !== this.revision) throw new Error('Conversation ledger changed during read');
        const ids = range ? new Set(range) : undefined;
        return this.turns.filter(turn => !ids || ids.has(turn.id!)).flatMap(turn => {
            const view = projectRecordedMessage(turn, characterId, this.playerId, purpose); return view ? [view] : [];
        });
    }
    changed(): void { this.revision++; }
    remove(ids: readonly string[]): void {
        const removed = new Set(ids); this.turns = this.turns.filter(turn => !removed.has(turn.id!)); this.changed();
    }
    clear(): void { this.turns = []; this.participants.clear(); this.changed(); }
    snapshot(date: string, playerId: number, context?: { scene?: string; location?: string }): LedgerSnapshot {
        return JSON.parse(JSON.stringify({ version: 2, id: this.id, revision: this.revision, date, playerId, ...context, messages: this.turns }));
    }
}
