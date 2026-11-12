import { createHash } from 'crypto';

/** One normalization for legacy diary readers and the editor's source mapping. */
export function normalizeDiarySummaries(data: any, characterId: string, preserveInvalid = false): any[] {
    const array = Array.isArray(data);
    return (array ? data : [data]).flatMap((row: any, index: number) => {
        if (!row || typeof row !== 'object' || !row.summary || (array && row.date === undefined)) return preserveInvalid ? [row] : [];
        const id = row.id || 'legacy-' + createHash('sha256').update(characterId + '\0' + index + '\0' + JSON.stringify(row)).digest('hex');
        return [{ ...row, id, diaryEntryId: row.diaryEntryId || '', date: row.date || '', characterId }];
    });
}
export function conversationSummaryIdentity(summary: any, characterId: string): string {
    return [characterId, typeof summary?.votcCampaignId === 'string' ? summary.votcCampaignId : '', summary?.date ?? '', typeof summary?.votcTimelineNodeId === 'string' ? summary.votcTimelineNodeId : '', summary?.content ?? ''].join('\u001f');
}
