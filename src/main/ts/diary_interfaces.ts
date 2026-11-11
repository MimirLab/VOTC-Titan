export interface DiaryTimelineStamp {
    votcCampaignId?: string;
    votcCheckpointEpoch?: number;
    votcTimelineNodeId?: string;
}

export interface DiaryEntry extends DiaryTimelineStamp {
    id: string;
    date: string;
    location: string;
    scene: string;
    participants: string[];
    content: string;
    character_traits: { [key: string]: string };
    creationTimestamp?: Date;
}

export interface DiarySummary extends DiaryTimelineStamp {
    id: string;
    diaryEntryId: string;
    date: string;
    summary: string;
    characterId?: string;
}
