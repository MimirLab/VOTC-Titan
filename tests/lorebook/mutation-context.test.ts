import { prepareMutationLoreContext } from '../../src/main/lorebook/loreMutationContext';
import { getVerifiedGoaSnapshot } from '../../src/main/goa/goaRuntime';
import { resolveGoaLore } from '../../src/main/goa/goaResolver';
import { currentLoreMutationCatalog, getVerifiedLoreMutationSnapshot, bindLoreMutationDependencies } from '../../src/main/lorebook/loreMutationRuntime';

jest.mock('../../src/main/goa/goaRuntime', () => ({ getVerifiedGoaSnapshot: jest.fn() }));
jest.mock('../../src/main/goa/goaResolver', () => ({ resolveGoaLore: jest.fn() }));
jest.mock('../../src/main/lorebook/loreMutationRuntime', () => ({ currentLoreMutationCatalog: jest.fn(), getVerifiedLoreMutationSnapshot: jest.fn(), bindLoreMutationDependencies: jest.fn() }));

const a = 'tlm_' + 'a'.repeat(24), b = 'tlm_' + 'b'.repeat(24);
function fixture() {
    const actor = { id: 2, fullName: 'Synthetic actor' };
    const date = { year: 583, month: 2, day: 2, totalDays: 200000, display: '583.2.2' };
    const game: any = { playerID: 1, votcCheckpointEpoch: 1, gameDate: date,
        characters: new Map([[2, actor], [3, { id: 3, fullName: 'Other actor' }]]),
        timelineSnapshotResult: { status: 'valid', snapshot: { source: 'init', playerId: '1', epoch: 1,
            nodeA: 9, nodeB: 10, parentA: 1, parentB: 1, protocol: { protocolSchema: 2, campaignSchema: 1,
                campaignIdA: 1, campaignIdB: 2, campaignIdC: 3, campaignIdD: 4, campaignBootstrapKind: 1, playerTimelineSchema: 1 } } } };
    const config: any = { goaLoreEnabled: true, lorebookEnabled: true };
    const catalogue: any = { digest: 'd'.repeat(64), points: [
        { token: a, entry_ids: ['subject-one'], account_kind: 'coded_choice' },
        { token: b, entry_ids: ['subject-two'], account_kind: 'coded_choice' }] };
    let current: any = { version: 1, digest: catalogue.digest, characterId: 2, date, world: { [a]: 199999, [b]: null },
        memories: [{ actorId: 2, token: a, owner: 'ordinary', date, ordinal: 0 },
            { actorId: 2, token: a, owner: 'fallen', date, ordinal: 1 }] };
    let body: any = { traits: [], verified: 'synthetic-goa-body' };
    (currentLoreMutationCatalog as jest.Mock).mockImplementation(() => catalogue);
    (getVerifiedLoreMutationSnapshot as jest.Mock).mockImplementation(character => character.id === 2 ? current : undefined);
    (getVerifiedGoaSnapshot as jest.Mock).mockImplementation(() => body);
    (resolveGoaLore as jest.Mock).mockReturnValue({ identityPolicy: 'ordinary' });
    return { actor, game, config, catalogue, current: () => current, setCurrent: (value: any) => { current = value; },
        setBody: (value: any) => { body = value; }, prepare: () => prepareMutationLoreContext(game, 2, config, 'edition')! };
}
beforeEach(() => jest.clearAllMocks());

test('the host binds actual save/fork/actor/clock and projects only the acting mind’s memories', () => {
    const f = fixture(), ticket = f.prepare();
    expect(ticket.context).toMatchObject({ origin: 'verified_campaign_mutations', campaign_id: '1-2-3-4', timeline_id: '9-10', actor_id: '2', as_of: '0583-02-02' });
    expect(ticket.context.memories).toHaveLength(1);
    expect(ticket.context.memories[0].owner).toBe('ordinary');
    expect(ticket.context.reported_context).toBeUndefined();
    expect(ticket.isCurrent()).toBe(true);
    expect(bindLoreMutationDependencies).toHaveBeenCalledWith(f.actor, f.current(), new Set([a]));
});

test('a fallen controller receives its own memories without inheriting the host’s', () => {
    const f = fixture(); (resolveGoaLore as jest.Mock).mockReturnValue({ identityPolicy: 'fallen_controller' });
    expect(f.prepare().context.memories.map(memory => memory.owner)).toEqual(['fallen']);
});

test('unrelated world progression keeps the same account session current', () => {
    const f = fixture(), ticket = f.prepare();
    f.setCurrent({ ...f.current(), world: { ...f.current().world, [b]: 200000 } });
    expect(ticket.isCurrent()).toBe(true);
    expect(f.prepare().binding).toBe(ticket.binding);
});

test.each(['related world', 'new owned memory', 'source edition', 'body identity', 'actor replacement', 'fork', 'rewind', 'reload', 'disabled', 'context edit'])
('a changed %s withdraws an already prepared turn', kind => {
    const f = fixture(), ticket = f.prepare();
    if (kind === 'related world') f.setCurrent({ ...f.current(), world: { ...f.current().world, [a]: 200000 } });
    if (kind === 'new owned memory') f.setCurrent({ ...f.current(), memories: [...f.current().memories, { ...f.current().memories[0], ordinal: 2 }] });
    if (kind === 'source edition') f.catalogue.digest = 'f'.repeat(64);
    if (kind === 'body identity') f.setBody({ traits: ['different_controller'] });
    if (kind === 'actor replacement') f.game.characters.set(2, { ...f.actor });
    if (kind === 'fork') f.game.timelineSnapshotResult.snapshot.nodeA++;
    if (kind === 'rewind') f.game.gameDate = { ...f.game.gameDate, totalDays: 199999, day: 1 };
    if (kind === 'reload') f.setCurrent(undefined);
    if (kind === 'disabled') f.config.lorebookEnabled = false;
    if (kind === 'context edit') ticket.context.memories[0].owner = 'fallen';
    expect(ticket.isCurrent()).toBe(false);
});

test('another actor or a capture whose character ID differs is unavailable', () => {
    const f = fixture();
    expect(prepareMutationLoreContext(f.game, 3, f.config, 'edition')).toBeUndefined();
    f.setCurrent({ ...f.current(), characterId: 3 });
    expect(f.prepare()).toBeUndefined();
});

test('a mutation record without current body or matching clock cannot establish knowledge', () => {
    const f = fixture(); f.setBody(undefined);
    expect(f.prepare()).toBeUndefined();
    f.setBody({ traits: [] }); f.setCurrent({ ...f.current(), date: { ...f.current().date, day: 1 } });
    expect(f.prepare()).toBeUndefined();
});
