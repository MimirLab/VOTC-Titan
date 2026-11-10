import type { Conversation } from '../conversation/Conversation';
import type { Character } from '../../shared/gameData/Character';
import type { Message } from '../ts/conversation_interfaces';
import { DisclosureSessions, LoreDelivery } from './lorebookDisclosure';
import { bindSpokenLoreAccounts, captureSpokenLoreExposure, SpokenLoreContext, SpokenLoreProgress } from './lorebookSpokenExposure';

export interface SpokenLoreAudience {
    recipientId: number; playerId: number; epoch: string;
    messages: () => readonly Message[];
    listeners: readonly { id: number; isCurrent: () => boolean }[];
    isCurrent: () => boolean;
}
export function spokenLoreAudience(conv: Conversation, actor: Character, targetId?: number): SpokenLoreAudience | undefined {
    if (process.env.VOTC_LORE_SPOKEN_EXPOSURE_STUDY !== '1') return;
    const game = conv.gameData, epoch = game.votcCheckpointEpoch;
    const recipientId = targetId ?? game.playerID, recipient = game.characters.get(recipientId);
    if (!recipient || !Number.isSafeInteger(epoch) || epoch < 0 || game.characters.get(actor.id) !== actor) return;
    const current = () => process.env.VOTC_LORE_SPOKEN_EXPOSURE_STUDY === '1' && conv.isOpen !== false &&
        conv.gameData === game && game.votcCheckpointEpoch === epoch && game.characters.get(actor.id) === actor;
    return { recipientId, playerId: game.playerID, epoch: String(epoch),
        messages: () => typeof conv.getCanonicalEncounterMessagesForLore === 'function' ? conv.getCanonicalEncounterMessagesForLore() : conv.messages,
        isCurrent: () => current() && game.characters.get(recipientId) === recipient,
        listeners: [...game.characters.values()].map(listener => ({ id: listener.id,
            isCurrent: () => current() && game.characters.get(listener.id) === listener })) };
}
interface Registration {
    actorId: number; binding: string; context: SpokenLoreContext; audience: SpokenLoreAudience;
    result?: any; sourceCurrent?: () => boolean;
}
interface Pending { registration: Registration; original: readonly Message[]; message: Message; retained: () => boolean }
interface ScopeState { tickets: Map<string, object>; pending: Map<number, Pending>; contexts: Map<string, SpokenLoreContext> }
export class SpokenPublicationSessions {
    // Retrieval progress is separate from the exposure reports. A paraphrase
    // may establish a topic without disclosing every sentence of its source.
    private progress = new SpokenLoreProgress('topic');
    private tickets = new DisclosureSessions();
    private scopes = new WeakMap<object, ScopeState>();
    private registrations = new WeakMap<LoreDelivery, Registration>();
    private debug = new WeakMap<LoreDelivery, { settled: number; committed: number; unavailable: number }>();
    private scope(scope: object): ScopeState {
        let state = this.scopes.get(scope);
        if (!state) { state = { tickets: new Map(), pending: new Map(), contexts: new Map() }; this.scopes.set(scope, state); }
        return state;
    }
    prepare(delivery: LoreDelivery | undefined, actorId: number, binding: string) {
        const audience = delivery?.spokenAudience;
        if (!delivery || delivery.channel !== 'chat' || process.env.VOTC_LORE_SPOKEN_EXPOSURE_STUDY !== '1') return;
        if (!audience) {
            // Missing recipient ownership must not silently restore the old
            // offered-only progression. Keep reader liveness, never a cursor.
            const ticket = this.tickets.prepare(delivery, actorId, binding);
            return { ...ticket, previous: undefined,
                commit: (included: boolean, _state: unknown, retained?: () => boolean) => ticket.commit(included, undefined, retained) };
        }
        if (!audience.isCurrent()) throw new Error('Spoken lore audience changed before preparation.');
        const state = this.scope(delivery.scope), context: SpokenLoreContext = { scope: delivery.scope, channel: delivery.channel,
            binding, epoch: audience.epoch, recipientId: audience.recipientId, playerId: audience.playerId,
            messages: audience.messages, isCurrent: audience.isCurrent };
        const diagnostics = { settled: 0, committed: 0, unavailable: 0 };
        let pendingPrevious: unknown;
        const pending = state.pending.get(actorId);
        if (pending) {
            const old = pending.registration;
            // The old reader remains current here. A new ticket below would
            // supersede it, so publication must be inspected first.
            try {
                if (old.binding === binding && old.audience.epoch === audience.epoch && pending.retained() && old.sourceCurrent?.()) {
                    const accounts = bindSpokenLoreAccounts({ original: pending.original, actorId, result: old.result, isCurrent: old.sourceCurrent });
                    const attended = new Set(pending.message.observedByCharacterIds ?? []);
                    for (const listener of old.audience.listeners) {
                        // A captured game object is not evidence of attendance.
                        // Avoid projecting/hash-checking history for absent actors.
                        if (!attended.has(listener.id)) continue;
                        const heard: SpokenLoreContext = { ...old.context, recipientId: listener.id, isCurrent: listener.isCurrent };
                        if (!listener.isCurrent()) continue;
                        try {
                            // Match only this publication; earlier accounts in
                            // history cannot certify that it was spoken now.
                            const all = heard.messages();
                            if (!all.includes(pending.message)) continue;
                            const view = captureSpokenLoreExposure(heard, pending.message);
                            const proposed = this.progress.propose(view, heard, accounts);
                            if (!proposed) continue;
                            if (delivery.preview) {
                                if (listener.id === audience.recipientId) pendingPrevious = proposed;
                            } else if (this.progress.record(view, heard, accounts)) {
                                state.contexts.set(`${actorId}:${listener.id}`, heard); diagnostics.committed++;
                            }
                        } catch { diagnostics.unavailable++; }
                    }
                    diagnostics.settled++;
                }
            } catch { diagnostics.unavailable++; }
            if (!delivery.preview) state.pending.delete(actorId);
        }
        this.debug.set(delivery, diagnostics);
        const key = `${actorId}:${audience.recipientId}`;
        let ticketScope = state.tickets.get(key);
        if (!ticketScope) { ticketScope = {}; if (!delivery.preview) state.tickets.set(key, ticketScope); }
        const ticket = this.tickets.prepare({ ...delivery, scope: ticketScope }, actorId, binding + ':' + audience.epoch);
        const previous = pendingPrevious ?? this.progress.previous(context, actorId);
        if (!delivery.preview) this.registrations.set(delivery, { actorId, binding, context, audience });
        return { previous, isCurrent: () => audience.isCurrent() && ticket.isCurrent(),
            forget: () => { if (!delivery.preview) this.progress.forget(context, actorId); ticket.forget(); },
            // This ticket retains reader liveness only. Offered state is NEVER
            // used as the public spoken cursor; that comes from progress above.
            commit: (included: boolean, _state: unknown, retained?: () => boolean) => ticket.commit(included, undefined, retained) };
    }
    bind(delivery: LoreDelivery | undefined, actorId: number, result: any, current: () => boolean): void {
        const registration = delivery && this.registrations.get(delivery);
        if (!registration) return;
        if (registration.actorId !== actorId || result.actor_id !== String(actorId) || !current()) throw new Error('Spoken source belongs to a different current actor.');
        registration.result = result; registration.sourceCurrent = current;
    }
    queue(delivery: LoreDelivery, original: readonly Message[], message: Message, retained: () => boolean): void {
        const registration = this.registrations.get(delivery);
        if (!registration?.result?.passages?.length || delivery.preview) return;
        if (message.characterId !== registration.actorId || message.role !== 'assistant') throw new Error('Spoken publication is not the acting character message.');
        bindSpokenLoreAccounts({ original, actorId: registration.actorId, result: registration.result, isCurrent: registration.sourceCurrent! });
        this.scope(delivery.scope).pending.set(registration.actorId, { registration, original, message, retained });
    }
    clear(delivery: LoreDelivery | undefined, actorId: number): void {
        if (!delivery || delivery.preview) return;
        const state = this.scopes.get(delivery.scope);
        if (!state) return;
        state.pending.delete(actorId);
        for (const [key, context] of state.contexts) if (key.startsWith(actorId + ':')) {
            this.progress.forget(context, actorId); state.contexts.delete(key);
        }
        for (const [key, scope] of state.tickets) if (key.startsWith(actorId + ':')) {
            this.tickets.clear({ ...delivery, scope }, actorId); state.tickets.delete(key);
        }
    }
    diagnostics(delivery: LoreDelivery) { return this.debug.get(delivery); }
}
export const spokenPublicationSessions = new SpokenPublicationSessions();
