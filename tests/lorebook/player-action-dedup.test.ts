import { Conversation } from '../../src/main/conversation/Conversation';
import { checkActions } from '../../src/main/conversation/checkActions';

jest.mock('../../src/main/conversation/checkActions', () => ({ checkActions: jest.fn() }));

beforeEach(() => {
    (checkActions as jest.Mock).mockReset().mockResolvedValue([]);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

function fixture(content: string, later = false) {
    const actor = { id: 2, shortName: 'Synthetic NPC' };
    const player = { id: 1 };
    const message = { id: 'current-player-message', role: 'user', content };
    const send = jest.fn();
    const conv: any = {
        config: { actionsEnableAll: true, maxConsecutiveActions: 4, nonTargetedCharacterResponseChance: 0 },
        gameData: { aiID: 2, playerID: 1, characters: new Map([[1, player], [2, actor]]) },
        messages: later ? [{ id: 'old-player-message', role: 'user', content: 'Earlier greeting.' }, message] : [message],
        encounterCapture: Promise.resolve(), encounterLifetime: new AbortController(),
        fillNpcQueue: jest.fn(), npcQueue: [actor],
        determineTargetedCharacters: jest.fn(async () => [actor]),
        processCharacterList: jest.fn(async () => ({ messages: [], actions: [] })),
        consecutiveActionsCount: 0, executedActions: new Map(), actionInvolvedCharacterIds: new Set(),
        chatWindow: { window: { webContents: { send } } },
        handleAiToAiConversation: jest.fn(async () => {}), calculateBasePromptTokens: jest.fn(async () => 0),
        sceneRefreshPending: false, pendingPlayerRequest: false
    };
    return { conv, actor, send };
}

test.each([
    ['*I offer my hand.*', false],
    ['*I offer my hand.*', true],
    ['[I place the sealed letter on the table.]', true],
    ['A first greeting without action syntax.', false]
])('one successful player check before RP: %s (later=%s)', async (content, later) => {
    const { conv, actor } = fixture(content, later);
    await Conversation.prototype.generateAIsMessages.call(conv);
    expect(checkActions).toHaveBeenCalledTimes(1);
    expect(checkActions).toHaveBeenCalledWith(conv, 1, 2);
    expect(conv.processCharacterList).toHaveBeenCalledWith([actor], false, true);
    expect((checkActions as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(conv.processCharacterList.mock.invocationCallOrder[0]);
});

test('ordinary later dialogue does not acquire an extra pre-reply action request', async () => {
    const { conv, actor } = fixture('Tell me what you think.', true);
    await Conversation.prototype.generateAIsMessages.call(conv);
    expect(checkActions).not.toHaveBeenCalled();
    expect(conv.processCharacterList).toHaveBeenCalledWith([actor], false, false);
});

test('a manual proposal is retained once while the NPC can still reply', async () => {
    const { conv, actor } = fixture('*I offer help.*', true);
    const pending = new Map();
    (checkActions as jest.Mock).mockImplementation(async () => {
        expect(pending.has('current-player-message')).toBe(false);
        pending.set('current-player-message', ['proposal awaiting player choice']);
        return [];
    });
    await Conversation.prototype.generateAIsMessages.call(conv);
    expect(checkActions).toHaveBeenCalledTimes(1);
    expect(pending.get('current-player-message')).toHaveLength(1);
    expect(conv.processCharacterList).toHaveBeenCalledWith([actor], false, true);
});

test('already executed immediate actions retain their existing early completion', async () => {
    const { conv, send } = fixture('*I act.*', true);
    const action = { id: 'synthetic-executed-action' };
    (checkActions as jest.Mock).mockResolvedValue([action]);
    await Conversation.prototype.generateAIsMessages.call(conv);
    expect(checkActions).toHaveBeenCalledTimes(1);
    expect(conv.processCharacterList).not.toHaveBeenCalled();
    expect(conv.executedActions.get('current-player-message')).toEqual([action]);
    expect(send).toHaveBeenCalledWith('actions-receive', [action], null, false);
    expect(conv.consecutiveActionsCount).toBe(1);
});

test('failed first check never falls through to a retry or an NPC response', async () => {
    const { conv, send } = fixture('*I offer my hand.*', true);
    (checkActions as jest.Mock).mockRejectedValue({ status: 502 });
    await Conversation.prototype.generateAIsMessages.call(conv);
    expect(checkActions).toHaveBeenCalledTimes(1);
    expect(conv.processCharacterList).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('generation-finished', true);
    expect(conv.isGenerating).toBe(false);
});

test('a new turn with the same words gets its own check', async () => {
    const { conv } = fixture('*I offer my hand.*', true);
    await Conversation.prototype.generateAIsMessages.call(conv);
    conv.messages.push({ id: 'new-player-message', role: 'user', content: '*I offer my hand.*' });
    await Conversation.prototype.generateAIsMessages.call(conv);
    expect(checkActions).toHaveBeenCalledTimes(2);
    expect(conv.processCharacterList).toHaveBeenCalledTimes(2);
});

test.each(['replacement', 'edit'])('a player message changed during the wait still gets checked (%s)', async change => {
    const { conv } = fixture('*I offer my hand.*', true);
    (checkActions as jest.Mock).mockImplementationOnce(async () => {
        if (change === 'replacement') conv.messages.push({ id: 'new-player-message', role: 'user', content: '*I set down a letter.*' });
        else conv.messages[conv.messages.length - 1].content = '*I set down a letter.*';
        return [];
    });
    await Conversation.prototype.generateAIsMessages.call(conv);
    expect(checkActions).toHaveBeenCalledTimes(2);
    expect(conv.processCharacterList).toHaveBeenCalledTimes(1);
});
