import { Conversation } from './Conversation';
import { recipientMessages, recipientSummary, perceivedMemoryTranscript } from '../language';
import { collectPrivateNarration, privateMemoryNarration } from '../language/privateMemory';
import { validCompactedMemoryScope } from '../language/compactedMemoryScope';
import { CompactedMemory, CompactedMemoryScope, CompactionConfig, CompactionMetrics, KnowledgeGraph, EntityReference, Relationship, KnowledgeEdge, NarrativeThread } from '../../shared/compactionTypes';
import { Message } from '../../main/ts/conversation_interfaces';
import { compactedMemoryStore } from '../compactedMemoryStore';
import { randomUUID, createHash } from 'crypto';
import { CompactionMetrics as CompactionMetricsTracker } from './CompactionMetrics';
import { CompactionLocalizationValidator } from './CompactionLocalizationValidator';

/**
 * MemoryCompactor - Orchestrates two-phase memory compaction for long-running conversations.
 * Phase 1: Summarizes recent message blocks into structured CompactedMemory entries.
 * Phase 2: Consolidates multiple Phase-1 summaries into a long-term KnowledgeGraph.
 */
export class MemoryCompactor {
    private phase1Compactor: Phase1Compactor;
    private phase2Compactor: Phase2Compactor;
    private scheduler: CompactionScheduler;
    private accuracyValidator: ContextAccuracyValidator;
    private compactedMemories: Map<string, CompactedMemory[]> = new Map();
    private metricsTracker: CompactionMetricsTracker;
    private localizationValidator: CompactionLocalizationValidator;
    private config: CompactionConfig;

    /**
     * Promise-based lock to serialize compaction operations.
     * When non-null, a compaction is in progress. Concurrent callers receive
     * the same promise, ensuring only one compaction runs at a time.
     */
    private _compactionLock: Promise<CompactionResult> | null = null;

    constructor(config: CompactionConfig) {
        this.config = config;
        this.phase1Compactor = new Phase1Compactor(config);
        this.phase2Compactor = new Phase2Compactor(config);
        this.scheduler = new CompactionScheduler(config);
        this.accuracyValidator = new ContextAccuracyValidator();
        this.metricsTracker = new CompactionMetricsTracker();
        this.localizationValidator = new CompactionLocalizationValidator();
    }

    /**
        this.metricsTracker = new CompactionMetricsTracker();
        this.localizationValidator = new CompactionLocalizationValidator();
    }

    /**
     * Main compaction entry point. Checks scheduler thresholds and runs appropriate phase.
     */
    /**
     * Returns true if a compaction is currently in progress.
     */
    public get isCompacting(): boolean {
        return this._compactionLock !== null;
    }

    /**
     * Checks if Phase 1 compaction should be triggered based on context usage.
     */
    public shouldTriggerCompaction(messages: Message[], tokenCount: number, contextSize: number): boolean {
        return this.scheduler.shouldRunPhase1(messages, tokenCount, contextSize);
    }

    /**
     * Main compaction entry point. Serialized via promise-based locking to prevent
     * race conditions. If a compaction is already in progress, concurrent callers
     * receive the same promise and wait for the ongoing operation to complete.
     */
    public async compact(conv: Conversation, options: { preservePendingInput?: boolean } = {}): Promise<CompactionResult> {
        // If a compaction is already in progress, return the existing promise.
        // This serializes all compaction calls: concurrent triggers wait for the
        // ongoing compaction to finish rather than starting a parallel one.
        if (this._compactionLock) {
            console.log('[MemoryCompactor] Compaction already in progress. Waiting for existing operation to complete.');
            return this._compactionLock;
        }

        // Create the lock promise and store it so concurrent callers can await it.
        const sourceRevision = conv.getEncounterRevision?.();
        const beforeMessages = [...conv.messages];
        const before = new Map([...this.compactedMemories].map(([id, memories]) => [id, [...memories]]));
        this._compactionLock = this._executeCompaction(conv, options).catch(error => {
            if (sourceRevision === conv.getEncounterRevision?.()) {
                this.compactedMemories = before;
                conv.messages = beforeMessages;
            } else {
                // Edits may already have invalidated earlier memories. Keep those changes,
                // while removing every new result of the failed operation.
                const previousIds = new Set([...before.values()].flatMap(memories => memories.map(memory => memory.id)));
                for (const [owner, memories] of this.compactedMemories)
                    this.compactedMemories.set(owner, memories.filter(memory => previousIds.has(memory.id)));
            }
            throw error;
        });

        try {
            const result = await this._compactionLock;
            return result;
        } finally {
            // Always clear the lock, even if compaction throws.
            this._compactionLock = null;
        }
    }

    /**
     * Internal implementation of the compaction logic. Separated from compact()
     * so the lock management (set/clear) is cleanly isolated from the work.
     */
    private async _executeCompaction(conv: Conversation, options: { preservePendingInput?: boolean }): Promise<CompactionResult> {
        const ledgerRevision = conv.getEncounterRevision?.();
        const verifyRevision = () => {
            if (ledgerRevision !== undefined && ledgerRevision !== conv.getEncounterRevision?.())
                throw new Error('Conversation changed during compaction; stale memories were discarded');
        };
        const startTimestamp = Date.now();
        const scope = conv.getCompactedMemoryScope?.();
        const visible = (memories: CompactedMemory[]) => conv.filterCompactedMemoriesForRead?.(memories) ?? memories;
        const memoryBeforeBytes = process.memoryUsage().heapUsed;
        let serializationTimeMs = 0;
        let diskWriteTimeMs = 0;
        let diskReadTimeMs = 0;
        let phase1DurationMs = 0;
        let phase2DurationMs = 0;

        const result: CompactionResult = { phase1Run: false, phase2Run: false, memoriesCreated: 0 };
        const newlyCompactedMemories: CompactedMemory[] = [];
        let compactedMessageIds: string[] = [];
        const ownersToPersist = new Set<string>();
        const plannedMemories = new Map([...this.compactedMemories].map(([owner, memories]) => [owner, [...memories]]));

        if (!this.config.enableMemoryCompaction) {
            return result;
        }

        const tokenCount = await conv.calculateBasePromptTokens();
        const contextSize = conv.textGenApiConnection.context || 8192;

        // Phase 1: Check if we need to compact recent messages
        if (this.scheduler.shouldRunPhase1(conv.messages, tokenCount, contextSize)) {
            const messagesToCompact = this.selectMessagesForCompaction(conv, tokenCount, contextSize, options.preservePendingInput);
            if (messagesToCompact.length > 0) {
                const phase1Start = Date.now();
                const phase1Results = await this.phase1Compactor.compact(
                    messagesToCompact,
                    conv.currentSummary || '',
                    conv
                );
                if (scope) phase1Results.forEach(memory => { memory.scope = { ...scope }; });
                verifyRevision();
                phase1DurationMs = Date.now() - phase1Start;

                // Validate accuracy
                const accuracyScore = phase1Results.some(memory => memory.recipientPerspectiveId !== undefined)
                    ? phase1Results.reduce((score, memory) => score + this.accuracyValidator.validate(
                        recipientMessages(conv, memory.recipientPerspectiveId!, messagesToCompact), [memory]), 0) / phase1Results.length
                    : this.accuracyValidator.validate(messagesToCompact, phase1Results);
                console.log(`Phase 1 compaction accuracy: ${(accuracyScore * 100).toFixed(1)}%`);

                // Track which message IDs were compacted so we can remove them from conv.messages
                compactedMessageIds = messagesToCompact.filter(m => m.id).map(m => m.id!);

                // Store results per character in memory
                for (const memory of phase1Results) {
                    for (const charId of memory.characterIds) {
                        const key = String(charId);
                        const existing = plannedMemories.get(key) || [];
                        existing.push(memory);
                        plannedMemories.set(key, existing);
                    }
                }

                // Persist compacted memories to disk for each character
                const playerId = String((conv as any).gameData?.playerID || 'default');
                const charGroups = new Map<string, CompactedMemory[]>();
                for (const memory of phase1Results) {
                    for (const charId of memory.characterIds) {
                        const key = String(charId);
                        if (!charGroups.has(key)) charGroups.set(key, []);
                        charGroups.get(key)!.push(memory);
                    }
                }
                for (const [charId, memories] of charGroups) {
                    if (phase1Results.some(memory => memory.recipientPerspectiveId !== undefined)) {
                        ownersToPersist.add(charId);
                        continue;
                    }
                    try {
                        verifyRevision();
                        const storeResult = await this.persistPlannedMemories(playerId, plannedMemories, [charId]);
                        serializationTimeMs += storeResult.serializationTimeMs;
                        diskWriteTimeMs += storeResult.diskWriteTimeMs;
                    } catch (err) {
                        console.error(`Failed to persist compacted memory for character ${charId}:`, err);
                        if (phase1Results.some(memory => memory.recipientPerspectiveId !== undefined)) throw err;
                    }
                }

                verifyRevision();
                // Remove compacted messages from conv.messages to shrink context
                const compactedIdSet = new Set(compactedMessageIds);
                if (!phase1Results.some(memory => memory.recipientPerspectiveId !== undefined))
                    conv.messages = conv.messages.filter(m => !m.id || !compactedIdSet.has(m.id));
                if (!ownersToPersist.size) console.log(`Removed ${compactedMessageIds.length} compacted messages from conversation. Remaining: ${conv.messages.length}`);

                newlyCompactedMemories.push(...phase1Results);
                result.phase1Run = true;
                result.memoriesCreated += phase1Results.length;
                result.accuracyScore = accuracyScore;
            }
        }

        // Phase 2: Check if we need to consolidate Phase-1 summaries
        const allPhase1Memories = visible([...plannedMemories.values()].flat()).filter(
            m => m.compactionLevel === 1
        );
        if (this.scheduler.shouldRunPhase2(allPhase1Memories)) {
            const phase2Start = Date.now();
            const phase2Memories: CompactedMemory[] = [];
            if (allPhase1Memories.some(memory => memory.recipientPerspectiveId !== undefined)) {
                const owners = this.collectSourceCharacterIds(allPhase1Memories);
                for (const owner of owners) {
                    const unique = new Map(allPhase1Memories.filter(memory => memory.characterIds.includes(owner))
                        .map(memory => [memory.id, memory]));
                    const source = [...unique.values()];
                    const fingerprint = this.consolidationFingerprint(source);
                    if (this.hasCompleteConsolidation(visible(plannedMemories.get(String(owner)) ?? []), fingerprint)) continue;
                    const graph = await this.phase2Compactor.compact(source, conv);
                    const consolidation = { fingerprint, threadCount: graph.narrativeThreads.length, groupId: randomUUID() };
                    phase2Memories.push(...this.knowledgeGraphToCompactedMemories(graph, conv, source)
                        .map(memory => ({ ...memory, characterIds: [owner], recipientPerspectiveId: owner,
                            consolidation })));
                }
            } else {
                const fingerprint = this.consolidationFingerprint(allPhase1Memories);
                if (!this.hasCompleteConsolidation(visible([...plannedMemories.values()].flat()), fingerprint)) {
                    const graph = await this.phase2Compactor.compact(allPhase1Memories, conv);
                    const consolidation = { fingerprint, threadCount: graph.narrativeThreads.length, groupId: randomUUID() };
                    phase2Memories.push(...this.knowledgeGraphToCompactedMemories(graph, conv, allPhase1Memories)
                        .map(memory => ({ ...memory, consolidation })));
                }
            }
            if (scope) phase2Memories.forEach(memory => { memory.scope = { ...scope }; });
            verifyRevision();
            phase2DurationMs = Date.now() - phase2Start;

            // Store Phase-2 results in memory
            for (const memory of phase2Memories) {
                for (const charId of memory.characterIds) {
                    const key = String(charId);
                    const existing = plannedMemories.get(key) || [];
                    existing.push(memory);
                    plannedMemories.set(key, existing);
                }
            }

            // Persist Phase-2 memories to disk
            const playerId = String((conv as any).gameData?.playerID || 'default');
            const charGroups = new Map<string, CompactedMemory[]>();
            for (const memory of phase2Memories) {
                for (const charId of memory.characterIds) {
                    const key = String(charId);
                    if (!charGroups.has(key)) charGroups.set(key, []);
                    charGroups.get(key)!.push(memory);
                }
            }
            for (const [charId, memories] of charGroups) {
                if (phase2Memories.some(memory => memory.recipientPerspectiveId !== undefined)) {
                    ownersToPersist.add(charId);
                    continue;
                }
                try {
                    verifyRevision();
                    const storeResult = await this.persistPlannedMemories(playerId, plannedMemories, [charId]);
                    serializationTimeMs += storeResult.serializationTimeMs;
                    diskWriteTimeMs += storeResult.diskWriteTimeMs;
                } catch (err) {
                    console.error(`Failed to save Phase-2 compacted memory for character ${charId}:`, err);
                    if (phase2Memories.some(memory => memory.recipientPerspectiveId !== undefined)) throw err;
                }
            }

            newlyCompactedMemories.push(...phase2Memories);
            result.phase2Run = phase2Memories.length > 0;
            result.memoriesCreated += phase2Memories.length;
        }

        if (ownersToPersist.size) {
            verifyRevision();
            const saved = await this.persistPlannedMemories(String(conv.gameData.playerID), plannedMemories, ownersToPersist);
            serializationTimeMs += saved.serializationTimeMs;
            diskWriteTimeMs += saved.diskWriteTimeMs;
            verifyRevision();
            const removed = new Set(compactedMessageIds);
            conv.messages = conv.messages.filter(message => !message.id || !removed.has(message.id));
            console.log(`Committed owned memories and removed ${compactedMessageIds.length} working-context messages.`);
        }
        verifyRevision();
        this.compactedMemories = plannedMemories;
        const totalDurationMs = Date.now() - startTimestamp;
        if (result.phase1Run) this.scheduler.recordPhase1Completion();
        const memoryAfterBytes = process.memoryUsage().heapUsed;

        result.metrics = {
            memoryBeforeBytes,
            memoryAfterBytes,
            totalDurationMs,
            phase1DurationMs,
            phase2DurationMs,
            serializationTimeMs,
            diskWriteTimeMs,
            diskReadTimeMs,
            accuracyScore: result.accuracyScore ?? 0,
            messagesCompacted: result.phase1Run ? compactedMessageIds.length : 0,
            phase1SummariesConsolidated: result.phase2Run ? allPhase1Memories.length : 0,
            startTimestamp,
            endTimestamp: Date.now(),
        };

        result.newlyCompactedMemories = newlyCompactedMemories;
        return result;
    }

    /**
     * Selects messages that should be compacted based on token budget.
     */
    private selectMessagesForCompaction(
        conv: Conversation,
        tokenCount: number,
        contextSize: number,
        preservePendingInput = false
    ): Message[] {
        const threshold = contextSize * (this.config.compactionPhase1Threshold / 100);
        const excessTokens = tokenCount - threshold;
        if (excessTokens <= 0) return [];

        const messagesToCompact: Message[] = [];
        let accumulatedTokens = 0;

        // The final user input has not been targeted or checked for actions yet.
        // Keep that exact input (including consecutive user turns) in working context.
        let pendingStart = conv.messages.length;
        while (preservePendingInput && pendingStart > 0 && conv.messages[pendingStart - 1].role === 'user') pendingStart--;
        // Take oldest completed messages first until we've covered the excess.
        for (const msg of conv.messages.slice(0, pendingStart)) {
            if (accumulatedTokens >= excessTokens) break;
            const msgTokens = conv.textGenApiConnection.calculateTokensFromMessage(msg);
            messagesToCompact.push(msg);
            accumulatedTokens += msgTokens;
        }

        return messagesToCompact;
    }

    /**
     * Converts a KnowledgeGraph into CompactedMemory entries for storage.
     */
    private knowledgeGraphToCompactedMemories(graph: KnowledgeGraph, conv: Conversation, sourceMemories: CompactedMemory[] = []): CompactedMemory[] {
        const memories: CompactedMemory[] = [];
        const now = Date.now();
        const dateStr = new Date().toISOString().split('T')[0];

        // Carry character IDs forward from the Phase-1 summaries being consolidated.
        // Entity names can't be parsed as numeric IDs, so without this the Phase-2
        // memories would be stored under no character and never reach a prompt.
        const characterIds = this.collectSourceCharacterIds(sourceMemories);
        const privateNotes = sourceMemories.flatMap(memory => privateMemoryNarration(memory, memory.recipientPerspectiveId!));
        const uniquePrivateNotes = [...new Map(privateNotes.map(note => [JSON.stringify([note.sourceMessageId, note.content, note.sourceGameDate]), note])).values()];

        // Create one memory per narrative thread
        for (const thread of graph.narrativeThreads) {
            const memory: CompactedMemory = {
                id: randomUUID(),
                date: dateStr,
                content: `[${thread.topic}] ${thread.summary}`,
                characterIds,
                relevanceScore: 0.8, // Phase-2 memories are highly relevant
                entityReferences: graph.entities,
                compactionLevel: 2,
                sourceMessageIds: [...new Set(sourceMemories.flatMap(memory => memory.sourceMessageIds))],
                ...(uniquePrivateNotes.length ? { retainedPrivateSourceIds: [...new Set(uniquePrivateNotes.map(note => note.sourceMessageId))] } : {}),
                creationTimestamp: now,
                gameDate: conv.gameData.date,
            };
            memories.push(memory);
        }

        return memories;
    }

    private collectSourceCharacterIds(sourceMemories: CompactedMemory[]): number[] {
        const ids = new Set<number>();
        for (const memory of sourceMemories) {
            for (const id of memory.characterIds) {
                ids.add(id);
            }
        }
        return Array.from(ids);
    }

    private consolidationFingerprint(source: CompactedMemory[]): string {
        return createHash('sha256').update(JSON.stringify(source.map(memory => [memory.id, memory.content,
            memory.date, memory.gameDate, memory.characterIds, memory.recipientPerspectiveId,
            memory.sourceMessageIds, memory.entityReferences,
            ...(memory.retainedPrivateNarration ? [memory.retainedPrivateNarration] : [])]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))).digest('hex');
    }

    private hasCompleteConsolidation(memories: CompactedMemory[], fingerprint: string): boolean {
        const groups = new Map<string, Map<string, CompactedMemory>>();
        for (const memory of memories) {
            if (memory.compactionLevel !== 2 || memory.consolidation?.fingerprint !== fingerprint || !memory.consolidation.groupId) continue;
            const group = groups.get(memory.consolidation.groupId) ?? new Map<string, CompactedMemory>();
            group.set(memory.id, memory); groups.set(memory.consolidation.groupId, group);
        }
        return [...groups.values()].some(group => group.size > 0 &&
            [...group.values()].every(memory => memory.consolidation?.threadCount === group.size));
    }


    public getCompactedMemories(characterId: string): CompactedMemory[] {
        return this.compactedMemories.get(characterId) || [];
    }

    private async persistPlannedMemories(playerId: string, planned: Map<string, CompactedMemory[]>, owners: Iterable<string>) {
        const updates = new Map([...owners].map(owner => [owner, (current: CompactedMemory[]) => {
            // Fresh disk versions win for old IDs; another encounter may have stamped or appended since our load.
            return [...new Map([...(planned.get(owner) ?? []), ...current].map(memory => [memory.id, memory])).values()];
        }]));
        const result = await compactedMemoryStore.updateCompactedMemoryBatch(playerId, updates);
        for (const [owner, memories] of result.memories) planned.set(owner, memories);
        return result;
    }

    public getAllCompactedMemories(): CompactedMemory[] {
        const allMemories: CompactedMemory[] = [];
        for (const memories of this.compactedMemories.values()) {
            allMemories.push(...memories);
        }
        return allMemories;
    }

    public initialize(config: CompactionConfig): void {
        this.config = config;
        this.phase1Compactor = new Phase1Compactor(config);
        this.phase2Compactor = new Phase2Compactor(config);
        this.scheduler = new CompactionScheduler(config);
    }

    /** Returns the metrics tracker for external performance monitoring. */
    public getMetricsTracker(): CompactionMetricsTracker {
        return this.metricsTracker;
    }

    /** Returns the localization validator for external cross-language checks. */
    public getLocalizationValidator(): CompactionLocalizationValidator {
        return this.localizationValidator;
    }

    /**
     * Loads compacted memories from disk for a given player and merges them into the in-memory map.
     * Should be called during conversation initialization to restore persisted state.
     */
    public async loadFromDisk(playerId: string, currentGameDate?: string): Promise<void> {
        try {
            const diskReadStart = Date.now();
            // Keep invisible branches/future records in the persistence set. Every model read filters separately.
            const result = await compactedMemoryStore.getAllCompactedMemories(playerId);
            const diskReadTimeMs = Date.now() - diskReadStart;
            console.log(`Loaded ${result.memories.length} compacted memories from disk for player ${playerId} in ${diskReadTimeMs}ms`);

            // Merge disk memories into in-memory map, grouped by character
            for (const memory of result.memories) {
                if (memory.recipientPerspectiveId !== undefined && (memory.characterIds.length !== 1 ||
                    memory.characterIds[0] !== memory.recipientPerspectiveId)) continue;
                try { privateMemoryNarration(memory, memory.recipientPerspectiveId!, result.memories); } catch { continue; }
                for (const charId of memory.characterIds) {
                    const key = String(charId);
                    const existing = this.compactedMemories.get(key) || [];
                    // Avoid duplicates by checking IDs
                    if (!existing.some(m => m.id === memory.id)) {
                        existing.push(memory);
                        this.compactedMemories.set(key, existing);
                    }
                }
            }
        } catch (err) {
            console.error(`Failed to load compacted memories from disk for player ${playerId}:`, err);
        }
    }
    /** Bind this encounter's provisional records to the same close coordinates as its transcript. */
    public async finalizeEncounterScope(playerId: string, scope: CompactedMemoryScope,
        stamp: { checkpointEpoch: number; timelineNodeId: string }): Promise<void> {
        if (!validCompactedMemoryScope({ ...scope, ...stamp })) throw new Error('Invalid compacted-memory close coordinates');
        if (this._compactionLock) await this._compactionLock;
        const planned = new Map(this.compactedMemories), updates = new Map<string, (current: CompactedMemory[]) => CompactedMemory[]>();
        for (const [owner, memories] of this.compactedMemories) {
            if (!memories.some(memory => memory.scope?.campaignId === scope.campaignId && memory.scope.encounterId === scope.encounterId)) continue;
            updates.set(owner, current => current.map(memory => {
                if (memory.scope?.campaignId !== scope.campaignId || memory.scope.encounterId !== scope.encounterId) return memory;
                if (memory.scope.timelineNodeId !== undefined && (memory.scope.timelineNodeId !== stamp.timelineNodeId ||
                    memory.scope.checkpointEpoch !== stamp.checkpointEpoch)) throw new Error('Encounter memory was already stamped elsewhere');
                if (memory.scope.timelineNodeId === stamp.timelineNodeId && memory.scope.checkpointEpoch === stamp.checkpointEpoch) return memory;
                return { ...memory, scope: { ...memory.scope, ...stamp } };
            }));
        }
        if (!updates.size) return;
        const saved = await compactedMemoryStore.updateCompactedMemoryBatch(playerId, updates);
        for (const [owner, memories] of saved.memories) planned.set(owner, memories);
        this.compactedMemories = planned;
    }
    /** Retractions/edits invalidate derived memories from this encounter, including Phase 2. */
    public invalidateSourceMessages(ids: readonly string[], playerId: string, removeVector: (id: string) => void): void {
        const sources = new Set(ids);
        for (const [owner, memories] of this.compactedMemories) {
            const removed = memories.filter(memory => memory.sourceMessageIds.some(id => sources.has(id)));
            if (!removed.length) continue;
            const retained = memories.filter(memory => !removed.includes(memory));
            this.compactedMemories.set(owner, retained);
            removed.forEach(memory => removeVector(memory.id));
            void compactedMemoryStore.saveCompactedMemory(playerId, owner, retained).catch(error =>
                console.error('Failed to persist invalidated conversation memories:', error));
        }
    }

    public cleanup(): void {
        // Clear the lock to unblock any waiters. The lock promise will
        // eventually resolve/reject on its own; clearing the reference
        // allows new compaction calls to proceed after cleanup.
        this._compactionLock = null;
        this.compactedMemories.clear();
    }

    /**
     * Gathers and returns the current status of the memory compactor.
     * @param tokenCount The current token count of the conversation.
     * @param contextSize The context size of the current model.
     * @returns An object containing detailed compaction status.
     */
    public getCompactionStatus(tokenCount: number, contextSize: number): any {
        const phase1Summaries = this.getAllCompactedMemories().filter(m => m.compactionLevel === 1);
        const schedulerStats = this.scheduler.getCompactionStats();

        return {
            contextUsagePct: contextSize > 0 ? Math.round((tokenCount / contextSize) * 100) : 0,
            phase1ThresholdPct: this.config.compactionPhase1Threshold,
            tokenCount: tokenCount,
            contextSize: contextSize,
            isCompacting: this.isCompacting,
            enableCompaction: this.config.enableMemoryCompaction,
            cooldownRemaining: schedulerStats.cooldownRemaining,
            phase1SummaryCount: phase1Summaries.length,
            phase2Threshold: this.config.compactionPhase2Threshold,
        };
    }
}

/**
 * Phase1Compactor - Short-term compaction.
 * Summarizes recent message blocks into concise narrative summaries,
 * preserving character names, key events, and emotional arcs.
 */
class Phase1Compactor {
    private config: CompactionConfig;

    constructor(config: CompactionConfig) {
        this.config = config;
    }

    /**
     * Compacts a set of messages into structured CompactedMemory entries.
     * Uses LLM-based summarization with regex fallback for entity extraction.
     */
    public async compact(
        messages: Message[],
        currentSummary: string,
        conv: Conversation,
        ownerPerspective?: number
    ): Promise<CompactedMemory[]> {
        if (ownerPerspective === undefined && (messages.some(message => message.utterance) || conv.hasLanguageMessages?.())) {
            const memories: CompactedMemory[] = [];
            const owners = new Set(messages.flatMap(message => message.observedByCharacterIds ?? [...conv.gameData.characters.keys()]));
            for (const owner of owners) {
                const projected = recipientMessages(conv, owner, messages);
                if (!projected.length) continue;
                const result = await this.compact(projected, recipientSummary(conv, owner), conv, owner);
                memories.push(...result.map(memory => ({ ...memory, characterIds: [owner], recipientPerspectiveId: owner })));
            }
            return memories;
        }
        const now = Date.now();
        const dateStr = new Date().toISOString().split('T')[0];

        // Build the conversation text for summarization
        const conversationText = ownerPerspective === undefined ? this.messagesToText(messages) : perceivedMemoryTranscript(messages, ownerPerspective);

        // Try LLM-based extraction first, fall back to regex
        let entities: EntityReference[] = [];
        let summaryContent = '';

        if (ownerPerspective !== undefined) {
            // Entity mode is independent of the semantic owner summary. A heuristic cannot
            // distinguish a narrator's private thoughts from a disclosure to this owner.
            // Provider failures leave the full working history and previous memories intact.
            summaryContent = await conv.summarizeForCompaction(messages, ownerPerspective, currentSummary);
            if (!summaryContent.trim()) throw new Error('Empty owned compaction summary; history retained');
            entities = this.extractEntitiesRegex(summaryContent);
        } else if (this.config.compactionEntityExtractionMode !== 'regex') {
            try {
                const llmResult = await this.llmSummarize(conversationText, currentSummary, conv);
                summaryContent = llmResult.summary;
                entities = llmResult.entities;
            } catch (error) {
                console.warn('LLM summarization failed, falling back to regex:', error);
                summaryContent = this.heuristicSummarize(conversationText, currentSummary);
                entities = this.extractEntitiesRegex(conversationText);
            }
        } else {
            summaryContent = this.heuristicSummarize(conversationText, currentSummary);
            entities = this.extractEntitiesRegex(conversationText);
        }

        // Calculate relevance score based on priority elements
        const relevanceScore = this.calculateRelevance(summaryContent);

        // Extract character IDs from the messages
        const characterIds = this.extractCharacterIds(messages);
        const privateNotes = ownerPerspective === undefined ? [] : collectPrivateNarration(messages, ownerPerspective, conv.gameData.date);

        const compactedMemory: CompactedMemory = {
            id: randomUUID(),
            date: dateStr,
            content: summaryContent,
            characterIds,
            relevanceScore,
            entityReferences: entities,
            compactionLevel: 1,
            sourceMessageIds: messages.filter(m => m.id).map(m => m.id!),
            ...(privateNotes.length ? { retainedPrivateNarration: privateNotes } : {}),
            creationTimestamp: now,
            gameDate: conv.gameData.date,
        };

        return [compactedMemory];
    }

    /**
     * Converts messages to a plain text format for summarization.
     */
    private messagesToText(messages: Message[]): string {
        return messages
            .map(m => `${m.name || m.role}: ${m.content}`)
            .join('\n');
    }

    /**
     * LLM-based summarization. Returns structured summary and entities.
     * NOTE: This is a stub that uses heuristic fallback until LLM integration is wired.
     */
    private async llmSummarize(
        conversationText: string,
        currentSummary: string,
        conv: Conversation
    ): Promise<{ summary: string; entities: EntityReference[] }> {
        const { summarizationApiConnection } = conv;
        // Rest of the method
		throw new Error('LLM summarization not yet wired');
    }

    /**
     * Heuristic/regex-based summarization as fallback.
     */
    private heuristicSummarize(
        conversationText: string,
        currentSummary: string
    ): string {
        const lines = conversationText.split('\n').filter(l => l.trim());
        if (lines.length === 0) return '';

        // Extract key sentences: first line, lines with emotional/action markers, last line
        const keyLines: string[] = [];
        const emotionPattern = /\*[^*]+\*|\b(angry|happy|sad|furious|joyful|worried|excited|afraid|grateful)\b/i;
        const actionPattern = /\b(decided|agreed|refused|promised|threatened|confessed|revealed|planned)\b/i;

        for (const line of lines) {
            if (emotionPattern.test(line) || actionPattern.test(line)) {
                keyLines.push(line);
            }
        }

        // Always include first and last substantive lines
        const firstLine = lines[0];
        const lastLine = lines[lines.length - 1];

        const summaryParts: string[] = [];
        if (currentSummary) {
            summaryParts.push(`[Previous: ${currentSummary.substring(0, 100)}]`);
        }
        summaryParts.push(firstLine);
        if (keyLines.length > 0) {
            summaryParts.push(...keyLines.slice(0, 3)); // Max 3 key lines
        }
        if (lastLine !== firstLine) {
            summaryParts.push(lastLine);
        }

        return summaryParts.join(' | ');
    }

    /**
     * Regex-based entity extraction from conversation text.
     */
    private extractEntitiesRegex(text: string): EntityReference[] {
        const entities: EntityReference[] = [];

        // Extract character names (capitalized words that appear as speakers)
        const speakerPattern = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*):/gm;
        const speakerNames = new Set<string>();
        let match;
        while ((match = speakerPattern.exec(text)) !== null) {
            speakerNames.add(match[1]);
        }

        for (const name of speakerNames) {
            entities.push({
                name,
                type: 'character',
                relationships: [],
                firstMentionedDate: new Date().toISOString().split('T')[0],
                lastMentionedDate: new Date().toISOString().split('T')[0],
                mentionCount: (text.match(new RegExp(name, 'g')) || []).length,
            });
        }

        // Extract relationship keywords
        const relationshipPatterns: { regex: RegExp; type: Relationship['type'] }[] = [
            { regex: /\b(rival|enemy|hates|despises)\b/gi, type: 'rival' },
            { regex: /\b(friend|ally|companion|trusts)\b/gi, type: 'friend' },
            { regex: /\b(lover|love|romance|affair)\b/gi, type: 'lover' },
            { regex: /\b(family|brother|sister|mother|father|son|daughter|cousin|uncle|aunt)\b/gi, type: 'family' },
        ];

        for (const { regex, type } of relationshipPatterns) {
            let relMatch;
            while ((relMatch = regex.exec(text)) !== null) {
                entities.push({
                    name: relMatch[1],
                    type: 'relationship',
                    relationships: [],
                    firstMentionedDate: new Date().toISOString().split('T')[0],
                    lastMentionedDate: new Date().toISOString().split('T')[0],
                    mentionCount: 1,
                });
            }
        }

        return entities;
    }

    /**
     * Calculates relevance score based on presence of priority elements.
     */
    private calculateRelevance(summary: string): number {
        const priorityElements = this.config.compactionPriorityElements;
        if (!priorityElements || priorityElements.length === 0) return 0.5;

        let matchCount = 0;
        const lowerSummary = summary.toLowerCase();

        for (const element of priorityElements) {
            if (lowerSummary.includes(element.toLowerCase())) {
                matchCount++;
            }
        }

        return Math.min(1.0, matchCount / priorityElements.length);
    }

    /**
     * Extracts unique character IDs from messages.
     */
    private extractCharacterIds(messages: Message[]): number[] {
        const ids = new Set<number>();
        for (const msg of messages) {
            if ((msg as any).characterId && typeof (msg as any).characterId === 'number') {
                ids.add((msg as any).characterId);
            }
        }
        return Array.from(ids);
    }
}

/**
 * Phase2Compactor - Long-term compaction.
 * Extracts structured entities (relationships, plot points, character development)
 * from multiple Phase-1 summaries into a compact knowledge graph representation.
 */
class Phase2Compactor {
    private config: CompactionConfig;

    constructor(config: CompactionConfig) {
        this.config = config;
    }

    /**
     * Consolidates multiple Phase-1 summaries into a KnowledgeGraph.
     */
    public async compact(phase1Summaries: CompactedMemory[], conv: Conversation): Promise<KnowledgeGraph> {
        if (phase1Summaries.length === 0) {
            return { entities: [], edges: [], narrativeThreads: [], version: 1 };
        }

        // Collect all entities from Phase-1 summaries
        const allEntities = this.collectEntities(phase1Summaries);

        // Deduplicate entities
        const deduplicatedEntities = this.deduplicateEntities(allEntities);

        // Build edges from entity relationships
        const edges = this.buildEdges(deduplicatedEntities);

        // Extract narrative threads from summary content
        const narrativeThreads = this.extractNarrativeThreads(phase1Summaries);

        return {
            entities: deduplicatedEntities,
            edges,
            narrativeThreads,
            version: 1,
        };
    }

    /**
     * Collects all entity references from Phase-1 summaries.
     */
    private collectEntities(summaries: CompactedMemory[]): EntityReference[] {
        const entities: EntityReference[] = [];
        for (const summary of summaries) {
            if (summary.entityReferences) {
                entities.push(...summary.entityReferences);
            }
        }
        return entities;
    }

    /**
     * Deduplicates entities by name, merging their relationships and updating mention counts.
     */
    private deduplicateEntities(entities: EntityReference[]): EntityReference[] {
        const entityMap = new Map<string, EntityReference>();

        for (const entity of entities) {
            const key = `${entity.type}:${entity.name.toLowerCase()}`;
            const existing = entityMap.get(key);

            if (existing) {
                // Merge: update mention count, extend date range, merge relationships
                existing.mentionCount += entity.mentionCount;

                if (entity.firstMentionedDate < existing.firstMentionedDate) {
                    existing.firstMentionedDate = entity.firstMentionedDate;
                }
                if (entity.lastMentionedDate > existing.lastMentionedDate) {
                    existing.lastMentionedDate = entity.lastMentionedDate;
                }

                // Merge relationships, deduplicating by target+type
                const relMap = new Map<string, Relationship>();
                for (const rel of [...existing.relationships, ...entity.relationships]) {
                    const relKey = `${rel.targetEntityName}:${rel.type}`;
                    if (!relMap.has(relKey)) {
                        relMap.set(relKey, rel);
                    }
                }
                existing.relationships = Array.from(relMap.values());
            } else {
                entityMap.set(key, { ...entity });
            }
        }

        return Array.from(entityMap.values());
    }

    /**
     * Builds knowledge graph edges from entity relationships.
     */
    private buildEdges(entities: EntityReference[]): KnowledgeEdge[] {
        const edges: KnowledgeEdge[] = [];
        const edgeSet = new Set<string>();

        for (const entity of entities) {
            for (const rel of entity.relationships) {
                const edgeKey = `${entity.name}:${rel.targetEntityName}:${rel.type}`;
                if (!edgeSet.has(edgeKey)) {
                    edgeSet.add(edgeKey);
                    edges.push({
                        source: entity.name,
                        target: rel.targetEntityName,
                        label: rel.type,
                    });
                }
            }
        }

        return edges;
    }

    /**
     * Extracts narrative threads from Phase-1 summary content.
     */
    private extractNarrativeThreads(summaries: CompactedMemory[]): NarrativeThread[] {
        const threads: NarrativeThread[] = [];

        // Group summaries by topic keywords
        const topicKeywords: { topic: string; keywords: string[] }[] = [
            { topic: 'Conflict', keywords: ['war', 'battle', 'fight', 'attack', 'defend', 'rival', 'enemy'] },
            { topic: 'Alliance', keywords: ['alliance', 'ally', 'treaty', 'pact', 'marriage', 'betrothal'] },
            { topic: 'Intrigue', keywords: ['secret', 'plot', 'scheme', 'conspiracy', 'betray', 'murder'] },
            { topic: 'Development', keywords: ['born', 'died', 'inherited', 'title', 'crowned', 'usurp'] },
        ];

        for (const { topic, keywords } of topicKeywords) {
            const relevantSummaries = summaries.filter(s =>
                keywords.some(kw => s.content.toLowerCase().includes(kw))
            );

            if (relevantSummaries.length > 0) {
                const combinedSummary = relevantSummaries
                    .map(s => s.content)
                    .join('; ');

                threads.push({
                    id: randomUUID(),
                    topic,
                    summary: combinedSummary.substring(0, 500), // Truncate to reasonable length
                });
            }
        }

        // If no topic threads found, create a general thread
        if (threads.length === 0 && summaries.length > 0) {
            threads.push({
                id: randomUUID(),
                topic: 'General',
                summary: summaries.map(s => s.content).join('; ').substring(0, 500),
            });
        }

        return threads;
    }
}

/**
 * CompactionScheduler - Monitors conversation state and determines when compaction should run.
 */
class CompactionScheduler {
    private config: CompactionConfig;
    private lastCompactionTime: number = 0;

    constructor(config: CompactionConfig) {
        this.config = config;
    }

    /**
     * Determines if Phase 1 compaction should run based on token count vs threshold.
     */
    public shouldRunPhase1(messages: Message[], tokenCount: number, contextSize: number): boolean {
        if (!this.config.enableMemoryCompaction) {
            return false;
        }

        const now = Date.now();
        if (now - this.lastCompactionTime < this.config.compactionCooldownMinutes * 60 * 1000) {
            return false;
        }

        const threshold = contextSize * (this.config.compactionPhase1Threshold / 100);
        const shouldRun = tokenCount > threshold;

        return shouldRun;
    }

    /** Eligibility checks must not consume the cooldown before the operation starts. */
    public recordPhase1Completion(): void { this.lastCompactionTime = Date.now(); }

    /**
     * Determines if Phase 2 compaction should run based on Phase-1 summary count.
     */
    public shouldRunPhase2(phase1Summaries: CompactedMemory[]): boolean {
        if (!this.config.enableMemoryCompaction) {
            return false;
        }

        return phase1Summaries.length > this.config.compactionPhase2Threshold;
    }

    /**
     * Returns the next scheduled compaction time in ms from now.
     */
    public scheduleNextCompaction(): number {
        return this.config.compactionCooldownMinutes * 60 * 1000;
    }

    /**
     * Returns current compaction statistics.
     */
    public getCompactionStats(): CompactionStats {
        return {
            lastCompactionTime: this.lastCompactionTime,
            cooldownRemaining: Math.max(
                0,
                this.lastCompactionTime +
                    this.config.compactionCooldownMinutes * 60 * 1000 -
                    Date.now()
            ),
        };
    }
}

/**
 * ContextAccuracyValidator - Validates that compacted content preserves key narrative elements.
 */
class ContextAccuracyValidator {
    /**
     * Validates compaction accuracy by comparing original messages to compacted output.
     * Returns a score between 0 and 1, where 1 means perfect preservation.
     */
    public validate(
        originalMessages: Message[],
        compactedMemories: CompactedMemory[]
    ): number {
        if (originalMessages.length === 0 || compactedMemories.length === 0) {
            return 0;
        }

        // Extract key entities from original messages
        const originalEntities = this.extractKeyEntities(originalMessages);

        // Check how many original entities are preserved in compacted output
        const compactedText = compactedMemories.map(m => m.content).join(' ');
        const compactedTextLower = compactedText.toLowerCase();

        let preservedCount = 0;
        for (const entity of originalEntities) {
            if (compactedTextLower.includes(entity.toLowerCase())) {
                preservedCount++;
            }
        }

        return originalEntities.length > 0
            ? preservedCount / originalEntities.length
            : 0;
    }

    /**
     * Extracts key entities (names, significant terms) from messages.
     */
    private extractKeyEntities(messages: Message[]): string[] {
        const entities = new Set<string>();

        for (const msg of messages) {
            // Extract speaker names
            if (msg.name) {
                entities.add(msg.name);
            }

            // Extract capitalized proper nouns (potential character/place names)
            const properNouns = msg.content.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*\b/g);
            if (properNouns) {
                for (const noun of properNouns) {
                    if (noun.length > 3) {
                        entities.add(noun);
                    }
                }
            }
        }

        return Array.from(entities);
    }
}

/** Result of a compaction operation. */
export interface CompactionResult {
    phase1Run: boolean;
    phase2Run: boolean;
    memoriesCreated: number;
    accuracyScore?: number;
    metrics?: CompactionMetrics;
    newlyCompactedMemories?: CompactedMemory[];
}

/** Statistics about the compaction scheduler state. */
export interface CompactionStats {
    lastCompactionTime: number;
    cooldownRemaining: number;
}
