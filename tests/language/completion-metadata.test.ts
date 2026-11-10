import { ApiConnection } from '../../src/shared/apiConnection';
import { Message } from '../../src/main/ts/conversation_interfaces';

function api(content: string, reason: string): any {
    return Object.assign(Object.create(ApiConnection.prototype), { type: 'custom', model: 'synthetic', parameters: { temperature: .8 },
        isChat: () => true, client: { chat: { completions: { create: jest.fn().mockResolvedValue({ choices: [
            { message: { content }, finish_reason: reason }
        ] }) } } } });
}
const prompt: Message[] = [{ role: 'user', name: 'Nela', content: 'Hello.', characterId: 1 }];
beforeEach(() => { jest.spyOn(console, 'debug').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());
test('optional completion observation preserves the exact ordinary transport body and string return', async () => {
    const plain = api('A complete reply.', 'stop'), observed = api('A complete reply.', 'stop'), metadata = jest.fn();
    expect(await plain.complete(prompt, false, { max_tokens: 5000 })).toBe('A complete reply.');
    expect(await observed.complete(prompt, false, { max_tokens: 5000 }, undefined, undefined, undefined, undefined, metadata)).toBe('A complete reply.');
    expect(observed.client.chat.completions.create.mock.calls[0][0]).toEqual(plain.client.chat.completions.create.mock.calls[0][0]);
    expect(metadata).toHaveBeenCalledWith({ finishReason: 'stop' });
    expect(observed.client.chat.completions.create.mock.calls[0][0]).not.toHaveProperty('completionObserver');
});
test('an observed empty token-limited reply reaches the bounded writer recovery without five transport retries', async () => {
    const connection = api('', 'length'), metadata = jest.fn();
    expect(await connection.complete(prompt, false, { max_tokens: 5000 }, undefined, undefined, undefined, undefined, metadata)).toBe('');
    expect(connection.client.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(metadata).toHaveBeenCalledWith({ finishReason: 'length' });
});
