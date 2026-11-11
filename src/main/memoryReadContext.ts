import { app } from 'electron';
import { parseGameDate } from '../shared/dateUtils';
import { GameData } from '../shared/gameData/GameData';
import { resolveCampaignIdentity } from './campaignIdentityResolver';
import { loadCampaignStore } from './campaignBusiness';
import { buildContextFromGameData, isRecordVisibleForContext, loadRegistryForContext, TimelineRegistry } from './timelineManager';

export interface MemoryRecordStamp {
    votcCampaignId?: string;
    votcCheckpointEpoch?: number;
    votcTimelineNodeId?: string;
    date: string;
}

/** A read never migrates a store or advances the game's timeline. */
export function memoryReadContext(game: GameData, userDataDir = app.getPath('userData')) {
    const identity = resolveCampaignIdentity(game);
    let registry: TimelineRegistry | undefined;
    let currentNodeId: string | undefined;
    try {
        const context = buildContextFromGameData(game);
        currentNodeId = context.timelineNodeId;
        if (identity.status === 'ok') {
            const loaded = loadCampaignStore(userDataDir, identity.identity);
            registry = loaded.status === 'found' ? loaded.store : new TimelineRegistry(String(game.playerID));
        } else if (identity.status === 'legacy-mod' && currentNodeId) {
            registry = loadRegistryForContext(userDataDir, context);
        }
    } catch (error) {
        console.warn('Timeline unavailable for memory read; stamped records remain hidden:', error);
    }
    return { registry, currentNodeId, identity: identity.status === 'ok' ? identity.identity : undefined };
}

/** Unstamped legacy records retain date visibility; never invent ancestry for them. */
export function filterMemoryRecordsForGame<T extends MemoryRecordStamp>(records: readonly T[], game: GameData,
    context = memoryReadContext(game)): T[] {
    const now = parseGameDate(game.date);
    return records.filter(record => {
        const date = parseGameDate(record.date);
        return (!date || !now || date <= now) &&
            (!record.votcCampaignId || record.votcCampaignId === context.identity?.campaignId) &&
            isRecordVisibleForContext(context.registry, context.currentNodeId, record, game.votcCheckpointEpoch);
    });
}
