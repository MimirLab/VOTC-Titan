import fs from 'fs';
import os from 'os';
import path from 'path';
import { Conversation } from '../../src/main/conversation/Conversation';
import { Summary } from '../../src/main/ts/conversation_interfaces';
import { GameData } from '../../src/shared/gameData/GameData';
import { TimelineRegistry, buildContextFromGameData } from '../../src/main/timelineManager';
import { conversationSummaryIdentity } from '../../src/main/summaryRecords';
import { readSummaryFile } from '../../src/main/summaryManager';
import { SummaryEdits } from '../../src/main/summaryEdits';

let directory: string;
function game(last = 4): GameData {
    const value = new GameData(['1', 'Visitor', '2', 'Mara', '589.11.2', 'court', 'Inn', 'Visitor', '1']);
    value.timelineSnapshotResult = { status: 'valid', snapshot: { source: 'init', playerId: '1', epoch: 1, nodeA: 9, nodeB: 10,
        protocol: { protocolSchema: 2, campaignSchema: 1, campaignIdA: 1, campaignIdB: 2, campaignIdC: 3,
            campaignIdD: last, campaignBootstrapKind: 1, playerTimelineSchema: 1 } } } as any;
    return value;
}
const current = buildContextFromGameData(game()).identity!;
const foreign = buildContextFromGameData(game(5)).identity!;
const record: Summary = { date: '589.11.1', content: 'Visitor described a lever.', votcTimelineNodeId: '9-10', votcCheckpointEpoch: 1 };
function registry(): TimelineRegistry {
    return new TimelineRegistry('1', { version: 1, playerId: '1', nodes: {
        '1-2': { parentId: null, epoch: 0, source: 'conversation', eventKey: 'root', createdAt: '2026-01-01' },
        '9-10': { parentId: '1-2', epoch: 1, source: 'conversation', eventKey: 'current', createdAt: '2026-01-02' },
        '11-12': { parentId: '1-2', epoch: 1, source: 'conversation', eventKey: 'sibling', createdAt: '2026-01-03' }
    } });
}
function conversation(rows: Summary[], context = true, identity = true): Conversation {
    return Object.assign(Object.create(Conversation.prototype), { gameData: game(), campaignIdentity: identity ? current : undefined,
        summaries: new Map([[2, rows]]), branchFilterLogged: new Set(),
        timelineReadContext: context ? { registry: registry(), currentNodeId: '9-10' } : null });
}
beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-summary-campaign-'));
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });

test.each([true, false])('explicit campaign provenance is enforced even without a readable branch context (%s)', context => {
    const same = { ...record, votcCampaignId: current.campaignId }, wrong = { ...record, votcCampaignId: foreign.campaignId };
    const rows = [wrong, same, record], before = JSON.stringify(rows), conv = conversation(rows, context);
    expect(conv.getBranchVisibleSummaries(2)).toEqual([same, record]);
    expect(conv.getBranchVisibleSummaries(3)).toEqual([]);
    expect(JSON.stringify(rows)).toBe(before);
});

test.each([true, false])('a missing current campaign cannot claim explicit records; historical unstamped behavior remains (%s)', context => {
    expect(conversation([{ ...record, votcCampaignId: current.campaignId }, record], context, false)
        .getBranchVisibleSummaries(2)).toEqual([record]);
});

test('same-campaign provenance does not bypass sibling or future-checkpoint filtering', () => {
    const same = { ...record, votcCampaignId: current.campaignId };
    expect(conversation([same, { ...same, votcTimelineNodeId: '11-12' }, { ...same, votcCheckpointEpoch: 2 }])
        .getBranchVisibleSummaries(2)).toEqual([same]);
});

test('editor identities distinguish equal wording and reused node identifiers across campaigns', () => {
    const a = conversationSummaryIdentity({ ...record, votcCampaignId: current.campaignId }, '2');
    const b = conversationSummaryIdentity({ ...record, votcCampaignId: foreign.campaignId }, '2');
    const legacy = conversationSummaryIdentity(record, '2');
    expect(new Set([a, b, legacy]).size).toBe(3);
});

test('active-campaign manager reads hide explicit foreign records without losing the legacy row', async () => {
    const dir = path.join(directory, 'conversation_summaries/1'); fs.mkdirSync(dir, { recursive: true });
    const rows = [{ ...record, votcCampaignId: foreign.campaignId }, { ...record, votcCampaignId: current.campaignId }, record];
    const file = path.join(dir, '2.json'); fs.writeFileSync(file, JSON.stringify(rows)); const bytes = fs.readFileSync(file);
    const visible = await readSummaryFile(directory, '1', 1, registry(), '9-10', current);
    expect(visible).toHaveLength(2);
    expect(visible.some(row => row.votcCampaignId === foreign.campaignId)).toBe(false);
    expect(fs.readFileSync(file)).toEqual(bytes);
    // The archive manager can still distinguish all records without an active campaign.
    expect(await readSummaryFile(directory, '1')).toHaveLength(3);
});

test('editing one campaign preserves hidden campaign records and cannot change source provenance', async () => {
    const dir = path.join(directory, 'conversation_summaries/1'); fs.mkdirSync(dir, { recursive: true });
    const same = { ...record, votcCampaignId: current.campaignId }, wrong = { ...record, votcCampaignId: foreign.campaignId };
    const file = path.join(dir, '2.json'); fs.writeFileSync(file, JSON.stringify([same, wrong]));
    const edits = new SummaryEdits(directory), view = await edits.read('1', 'conversations', async () => [{ ...same, characterId: '2' }]);
    edits.save('1', 'conversations', [{ _editorId: view.data[0]._editorId, characterId: '2', date: same.date,
        content: 'Edited wording.', votcCampaignId: foreign.campaignId }], view.revision);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual([{ ...same, content: 'Edited wording.' }, wrong]);
});
