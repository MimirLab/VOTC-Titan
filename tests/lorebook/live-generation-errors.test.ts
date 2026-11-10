import { Conversation } from '../../src/main/conversation/Conversation';
import { buildChatPrompt, convertMessagesToString } from '../../src/main/conversation/promptBuilder';
import { checkActions } from '../../src/main/conversation/checkActions';
import { currentDevelopment, developmentCaptureEnabled } from '../../src/main/development/developmentRuntime';

jest.mock('../../src/main/conversation/promptBuilder', () => ({
    buildChatPrompt: jest.fn(async () => [{ role: 'system', content: 'Complete original.' }]),
    convertMessagesToString: jest.fn(() => 'Complete original.')
}));
jest.mock('../../src/main/conversation/checkActions', () => ({ checkActions: jest.fn() }));
jest.mock('../../src/main/development/developmentRuntime', () => ({
    currentDevelopment: jest.fn(), developmentCaptureEnabled: jest.fn()
}));

beforeEach(() => {
    (developmentCaptureEnabled as jest.Mock).mockReturnValue(false);
    (currentDevelopment as jest.Mock).mockReturnValue(undefined);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

function fixture() {
    const actor = { id: 2 }, send = jest.fn();
    const conv: any = { config: {}, gameData: { aiID: 2, playerID: 1, getCharacter: () => actor },
        messages: [{ role: 'user', id: 'actual-user-message', content: 'PRIVATE-PLAYER-TEXT' }],
        encounterCapture: Promise.resolve(true), encounterLifetime: new AbortController(),
        fillNpcQueue: jest.fn(), determineTargetedCharacters: jest.fn(async () => [actor]),
        processCharacterList: jest.fn(), chatWindow: { window: { webContents: { send } } },
        withLimitedHistory: async (callback: () => Promise<number>) => callback(),
        plannedLanguage: () => undefined, plannedProseEncoding: () => 'legacy',
        textGenApiConnection: { calculateTokensFromText: jest.fn(() => 42) },
        calculateBasePromptTokens: jest.fn(async () => 0), sceneRefreshPending: false, pendingPlayerRequest: false };
    return { conv, actor, send };
}
test('action-check service failure cannot publish RP or bypass actions and always releases input', async () => {
    const { conv, send } = fixture();
    (checkActions as jest.Mock).mockRejectedValue({ status: 502, message: 'PRIVATE-PROVIDER-BODY' });
    await Conversation.prototype.generateAIsMessages.call(conv);
    expect(conv.processCharacterList).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('error-message', 'The text service is temporarily unavailable (HTTP 502). Please try again.');
    expect(send).toHaveBeenCalledWith('generation-finished', true);
    expect(JSON.stringify(send.mock.calls)).not.toMatch(/PRIVATE/);
    expect(conv.isGenerating).toBe(false); expect(conv.abortController).toBeNull();
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"phase":"action_check"'));
});
test('target selection failure is attributed to targeting with no action or RP requests', async () => {
    const { conv } = fixture(); conv.determineTargetedCharacters.mockRejectedValue({ status: 503 });
    await Conversation.prototype.generateAIsMessages.call(conv);
    expect(checkActions).not.toHaveBeenCalled(); expect(conv.processCharacterList).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"phase":"targeting"'));
});
test('pending age capture skips token preview without initiating capture, building prompts or accepting a fake age', async () => {
    const { conv } = fixture(); (developmentCaptureEnabled as jest.Mock).mockReturnValue(true);
    const count = await Conversation.prototype.calculateBasePromptTokens.call(conv);
    expect(count).toBe(0); expect(buildChatPrompt).not.toHaveBeenCalled();
    expect(conv.processCharacterList).not.toHaveBeenCalled(); expect(console.error).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('"code":"capture_pending"'));
});
test('a ready token estimate uses the actual builder with preview=true and preparing=false', async () => {
    const { conv, actor } = fixture(); (developmentCaptureEnabled as jest.Mock).mockReturnValue(true);
    (currentDevelopment as jest.Mock).mockReturnValue({ age: '20+', adult: true });
    expect(await Conversation.prototype.calculateBasePromptTokens.call(conv)).toBe(42);
    expect(buildChatPrompt).toHaveBeenCalledWith(conv, actor, conv.messages, undefined, false, undefined, 'legacy', { preview: true });
    expect(convertMessagesToString).toHaveBeenCalled();
});
