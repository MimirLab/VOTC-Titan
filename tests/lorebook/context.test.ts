import { encounterLoreIdentity, projectLoreReport, LoreReport } from '../../src/main/lorebook/lorebookContext';
import { unitVector, fuseCandidates, embeddingBinding } from '../../src/main/lorebook/lorebookVectors';

function game(): any {
    return { playerID: 1, votcCheckpointEpoch: 1, gameDate: { year: 583, month: 2, day: 2, totalDays: 200000, display: '583.2.2' },
        characters: new Map([[2, { id: 2 }], [3, { id: 3 }]]),
        timelineSnapshotResult: { status: 'valid', snapshot: { source: 'init', playerId: '1', epoch: 1,
            nodeA: 9, nodeB: 10, parentA: 1, parentB: 1, protocol: { protocolSchema: 2, campaignSchema: 1,
                campaignIdA: 1, campaignIdB: 2, campaignIdC: 3, campaignIdD: 4, campaignBootstrapKind: 1, playerTimelineSchema: 1 } } } };
}
function report(): LoreReport {
    return { origin: 'user_reported', campaign_id: '1-2-3-4', timeline_id: '9-10', start_date: '0583-01-01', as_of: '0583-02-01', mod_version: '0.6.5', choices: [],
        lore_knowledge: { actor_id: '2', as_of: '0583-02-01', setting_sha256: 'edition', known_subjects: [] } };
}
test('captured numeric date and v2 identities bind the reader without display-date guesses', () => {
    const g = game(); g.date = 'not a numeric date';
    expect(encounterLoreIdentity(g, 2)).toEqual({ campaign: '1-2-3-4', timeline: '9-10', actor: '2', date: '0583-02-02' });
    const original = report(), projected = projectLoreReport(original, g, 2, 'edition');
    expect(projected.as_of).toBe('0583-02-02'); expect(projected.lore_knowledge.as_of).toBe(projected.as_of);
    expect(original.as_of).toBe('0583-02-01'); expect(projected.start_date).toBe(original.start_date);
});
test.each(['actor', 'campaign', 'timeline', 'edition', 'backwards', 'future-choice', 'synthetic', 'clock', 'legacy'])('rejects unsafe context: %s', kind => {
    const g = game(), r = report();
    if (kind === 'actor') r.lore_knowledge.actor_id = '3';
    if (kind === 'campaign') r.campaign_id = '9-9-9-9';
    if (kind === 'timeline') r.timeline_id = '9-11';
    if (kind === 'edition') r.lore_knowledge.setting_sha256 = 'stale';
    if (kind === 'backwards') { r.as_of = '0583-02-03'; r.lore_knowledge.as_of = r.as_of; }
    if (kind === 'future-choice') r.choices = [{ occurred_at: '0603-01-01' }];
    if (kind === 'synthetic') (r as any).origin = 'synthetic_test';
    if (kind === 'clock') g.gameDate.month = 13;
    if (kind === 'legacy') delete g.timelineSnapshotResult;
    expect(() => projectLoreReport(r, g, 2, 'edition')).toThrow();
});
test('vector spaces and candidate fusion remain separate from access permission', () => {
    const config: any = { embeddingApiConnectionConfig: { connection: { type: 'custom', baseUrl: 'https://embedding.invalid', model: 'one', overwriteDimension: true, customDimension: 2 } } };
    const before = embeddingBinding(config, 'edition'); config.embeddingApiConnectionConfig.connection.model = 'two';
    expect(embeddingBinding(config, 'edition')).not.toBe(before);
    expect(embeddingBinding(config, 'next-edition')).not.toBe(embeddingBinding(config, 'edition'));
    expect(Array.from(unitVector([3, 4], 2))).toEqual([expect.closeTo(0.6), expect.closeTo(0.8)]);
    expect(() => unitVector([NaN, 1], 2)).toThrow(); expect(() => unitVector([0, 0], 2)).toThrow();
    expect(() => unitVector([1], 2)).toThrow();
    expect(fuseCandidates(['a', 'b'], ['c', 'b'])).toEqual(['b', 'a', 'c']);
});
