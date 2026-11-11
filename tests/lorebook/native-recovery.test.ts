import { Conversation } from '../../src/main/conversation/Conversation';
import { ApiConnection } from '../../src/shared/apiConnection';

const reply = '**He lowers the cup.** ""I can stay a while.""';
const response = (content: string, finish_reason: string) => ({ choices: [{ message: { content }, finish_reason }] });
function fixture() {
    const create = jest.fn();
    const api = Object.assign(Object.create(ApiConnection.prototype), {
        type: 'custom', model: 'mimir-bigbrain', forceInstruct: false, parameters: { temperature: .8 },
        context: 262144, work: 'foreground', isChat: () => true, calculateTokensFromText: () => 100,
        config: { baseUrl: 'https://synthetic.invalid/v1' },
        client: { baseURL: 'https://synthetic.invalid/v1', chat: { completions: { create } } }
    });
    const actor = { id: 2, fullName: 'Speaker', shortName: 'Speaker' };
    const original = [{ role: 'system', content: 'Entire character, scene and persona. Audio delivery metadata:' },
        { role: 'user', name: 'Visitor', content: 'Stay with me.' }];
    const conv: any = Object.assign(Object.create(Conversation.prototype), {
        config: { maxTokens: 5000, language: 'en', cleanMessages: false }, messages: [], isOpen: true,
        textGenApiConnection: api, chatWindow: { window: { webContents: { send: jest.fn() } } }
    });
    const finishes: jest.Mock[] = [];
    const rebuild = jest.fn(async () => {
        const finishPreparation = jest.fn(); finishes.push(finishPreparation);
        return { actor, original, isCurrent: () => true,
            delivery: { scope: {}, channel: 'chat', turns: [], preparing: true, required: true,
                isCurrent: () => true, finishPreparation, requestMore: jest.fn(), accounts: [], accountWords: 0,
                knowledge: { access: 'not_requested' } } };
    });
    const deliver = jest.fn((message: any) => { conv.messages.push(message); return message; });
    const run = async () => conv.completeControlledMessage(original, actor, 'language_common', deliver,
        { max_tokens: 5000, thinking_token_budget: -1 }, [], actor.fullName, await rebuild(), rebuild);
    return { create, conv, original, rebuild, finishes, deliver, run };
}
beforeEach(() => {
    for (const key of ['debug', 'log', 'warn', 'error'] as const) jest.spyOn(console, key).mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test.each(['length', 'stop'])('native %s whitespace receives one fresh recovery and publishes only the completed reply', async reason => {
    const f = fixture();
    f.create.mockResolvedValueOnce(response(' \n ', reason)).mockResolvedValueOnce(response(reply, 'stop'));
    const result = await f.run();
    expect(result.content).toBe(reply);
    expect(f.create).toHaveBeenCalledTimes(2);
    expect(f.rebuild).toHaveBeenCalledTimes(2);
    for (const [request] of f.create.mock.calls) {
        expect(request).toMatchObject({ max_tokens: 5000, thinking_token_budget: -1 });
        expect(request.messages.slice(0, 2)).toEqual(f.original);
    }
    const recovery = f.create.mock.calls[1][0].messages.at(-1).content;
    expect(recovery).toContain('established speaker, addressee, full persona');
    if (reason === 'length') expect(recovery).toContain('reached its response limit');
    expect(f.finishes[0]).toHaveBeenCalledWith(false, { initialFocusOnly: true });
    expect(f.finishes[1]).toHaveBeenCalledWith(false, { initialFocusOnly: true, retainedPublication: expect.any(Function) });
    expect(f.finishes[1].mock.calls[0][1].retainedPublication()).toBe(true);
    expect(f.deliver).toHaveBeenCalledTimes(1);
    expect(f.conv.messages).toEqual([result]);
});

test('two reasoning-only completions leave the turn unpublished without a third provider request', async () => {
    const f = fixture(); f.create.mockResolvedValue(response(' \n ', 'length'));
    expect(await f.run()).toBeNull();
    expect(f.create).toHaveBeenCalledTimes(2);
    expect(f.deliver).not.toHaveBeenCalled();
    expect(f.conv.messages).toEqual([]);
    expect(f.conv.chatWindow.window.webContents.send).toHaveBeenCalledWith('error-message', expect.stringContaining('Please retry'));
});
