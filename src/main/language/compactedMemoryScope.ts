import type { CompactedMemory, CompactedMemoryScope } from '../../shared/compactionTypes';
import { normalizeCampaignId, parseCampaignId } from '../../shared/gameData/CampaignIdentity';
import { compareCk3GameDate, parseLegacyCk3DisplayDate } from '../../shared/gameData/gameDate';
import { MAX_NODE_COMPONENT } from '../../shared/gameData/timelineProtocol';
import { isRecordVisibleForContext, TimelineRegistry } from '../timelineManager';
import { privateMemoryNarration } from './privateMemory';

export interface CompactedMemoryReadContext {
    campaignId?: string;
    encounterId?: string;
    gameDate?: string;
    registry?: TimelineRegistry;
    currentNodeId?: string;
    checkpointEpoch?: number;
}

export function validCompactedMemoryScope(value: unknown): value is CompactedMemoryScope {
    if (!value || typeof value !== 'object') return false;
    const scope = value as CompactedMemoryScope;
    if (scope.version !== 1 || typeof scope.campaignId !== 'string' ||
        typeof scope.encounterId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(scope.encounterId)) return false;
    try { if (normalizeCampaignId(parseCampaignId(scope.campaignId)) !== scope.campaignId) return false; } catch { return false; }
    if (scope.checkpointEpoch === undefined && scope.timelineNodeId === undefined) return true;
    return Number.isSafeInteger(scope.checkpointEpoch) && scope.checkpointEpoch! >= 0 &&
        typeof scope.timelineNodeId === 'string' && /^\d+-\d+$/.test(scope.timelineNodeId) &&
        scope.timelineNodeId.split('-').every(part => Number(part) > 0 && Number(part) <= MAX_NODE_COMPONENT && String(Number(part)) === part);
}

/** Parse actual CK3 numeric dates instead of sorting unpadded months/days as text. Unknown legacy forms retain the old comparison. */
export function compactedMemoryDateVisible(memoryDate?: string, currentDate?: string): boolean {
    if (!memoryDate || !currentDate) return true;
    const past = parseLegacyCk3DisplayDate(memoryDate), current = parseLegacyCk3DisplayDate(currentDate);
    return past && current ? compareCk3GameDate(past, current) <= 0 : memoryDate <= currentDate;
}

export function compactedMemoryVisible(memory: CompactedMemory, context: CompactedMemoryReadContext): boolean {
    if (!compactedMemoryDateVisible(memory.gameDate, context.gameDate)) return false;
    if (memory.scope === undefined) return true;
    const scope = memory.scope;
    if (!validCompactedMemoryScope(scope) || scope.campaignId !== context.campaignId) return false;
    // A current encounter may use its own pending context, including during close-time summarization.
    if (scope.encounterId === context.encounterId) return true;
    // Interrupted/failed closes do not turn provisional notes into shared history on every branch.
    if (scope.timelineNodeId === undefined) return false;
    if (context.checkpointEpoch !== undefined && scope.checkpointEpoch! > context.checkpointEpoch) return false;
    return isRecordVisibleForContext(context.registry, context.currentNodeId,
        { votcTimelineNodeId: scope.timelineNodeId, votcCheckpointEpoch: scope.checkpointEpoch }, context.checkpointEpoch);
}

/** Read filtering never mutates the complete persistence set. References resolve only within the visible owner dataset. */
export function visibleCompactedMemories(memories: readonly CompactedMemory[], context: CompactedMemoryReadContext): CompactedMemory[] {
    const visible = memories.filter(memory => compactedMemoryVisible(memory, context));
    return visible.filter(memory => {
        try { privateMemoryNarration(memory, memory.recipientPerspectiveId!, visible); return true; } catch { return false; }
    });
}
