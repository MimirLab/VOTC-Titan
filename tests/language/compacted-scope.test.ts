import { CompactedMemory, CompactedMemoryScope } from '../../src/shared/compactionTypes';
import { TimelineRegistry } from '../../src/main/timelineManager';
import { compactedMemoryDateVisible, compactedMemoryVisible, validCompactedMemoryScope, visibleCompactedMemories } from '../../src/main/language/compactedMemoryScope';

const encounterId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', campaignId = '11-12-13-14';
const scope: CompactedMemoryScope = { version: 1, encounterId, campaignId, checkpointEpoch: 1, timelineNodeId: '2-2' };
const memory = (id: string, override = {}): CompactedMemory => ({ id, date: '2026-10-13', gameDate: '1066.9.15',
    content: 'An owned event.', characterIds: [2], recipientPerspectiveId: 2, relevanceScore: 1, entityReferences: [],
    compactionLevel: 1, sourceMessageIds: [id], creationTimestamp: 1, scope, ...override });
const registry = new TimelineRegistry('1', { version: 1, playerId: '1', nodes: {
    '1-1': { parentId: null, epoch: 0, source: 'root', eventKey: 'root', createdAt: '2026-10-13' },
    '2-2': { parentId: '1-1', epoch: 1, source: 'conversation', eventKey: 'left', createdAt: '2026-10-13' },
    '3-3': { parentId: '1-1', epoch: 1, source: 'conversation', eventKey: 'right', createdAt: '2026-10-13' },
    '4-4': { parentId: '2-2', epoch: 2, source: 'conversation', eventKey: 'next', createdAt: '2026-10-13' }
} });
test('a scoped event follows its branch and ancestors, rather than a repeated checkpoint number', () => {
    const record = memory('secret');
    const context = { campaignId, registry, checkpointEpoch: 2, gameDate: '1066.10.1' };
    expect(compactedMemoryVisible(record, { ...context, currentNodeId: '4-4' })).toBe(true);
    expect(compactedMemoryVisible(record, { ...context, currentNodeId: '3-3' })).toBe(false);
    expect(compactedMemoryVisible(record, { ...context, currentNodeId: '1-1', checkpointEpoch: 0 })).toBe(false);
    expect(compactedMemoryVisible(record, { ...context, currentNodeId: '4-4', campaignId: '21-22-23-24' })).toBe(false);
    expect(compactedMemoryVisible(record, { ...context, currentNodeId: '4-4', registry: undefined })).toBe(false);
});
test('provisional memory is available only to its current encounter and never falls back to a parent node', () => {
    const record = memory('pending', { scope: { version: 1, encounterId, campaignId } });
    expect(compactedMemoryVisible(record, { campaignId, encounterId })).toBe(true);
    expect(compactedMemoryVisible(record, { campaignId })).toBe(false);
    expect(compactedMemoryVisible(record, { campaignId: '21-22-23-24', encounterId })).toBe(false);
    expect(compactedMemoryVisible(record, { encounterId })).toBe(false);
});
test.each([
    ['1066.9.30', '1066.10.1', true], ['1066.10.1', '1066.9.30', false],
    ['1066.9.9', '1066.9.10', true], ['1066.9.10', '1066.9.9', false],
    ['82.12.1', '83.1.1', true], ['1066年10月1日', '1066年9月30日', false]
])('numeric chronology handles %s compared with %s', (past, current, expected) => {
    expect(compactedMemoryDateVisible(past, current)).toBe(expected);
});
test('legacy rows keep their old visibility and invalid scope metadata cannot supply a bypass', () => {
    expect(compactedMemoryVisible(memory('legacy', { scope: undefined }), {})).toBe(true);
    expect(validCompactedMemoryScope(scope)).toBe(true);
    for (const invalid of [{ ...scope, version: 2 }, { ...scope, campaignId: '011-12-13-14' }, { ...scope, encounterId: 'unknown' },
        { ...scope, timelineNodeId: '0-0' }, { ...scope, checkpointEpoch: undefined }, { ...scope, timelineNodeId: undefined }]) {
        expect(validCompactedMemoryScope(invalid)).toBe(false);
        expect(compactedMemoryVisible(memory('invalid', { scope: invalid }), { campaignId, encounterId })).toBe(false);
    }
});
test('private references cannot resolve through an invisible campaign source, and filtering retains the input bytes', () => {
    const hidden = memory('private-source', { scope: { ...scope, campaignId: '21-22-23-24' },
        retainedPrivateNarration: [{ sourceMessageId: 'private-source', content: 'The concealed ruby.' }] });
    const thread = memory('thread', { compactionLevel: 2, sourceMessageIds: ['private-source'], retainedPrivateSourceIds: ['private-source'] });
    const rows = [hidden, thread], before = JSON.stringify(rows);
    expect(visibleCompactedMemories(rows, { campaignId, registry, currentNodeId: '2-2', checkpointEpoch: 1 })).toEqual([]);
    expect(JSON.stringify(rows)).toBe(before);
});
