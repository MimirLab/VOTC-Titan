/** Private chat transport types; these are never persisted RP messages. */
export interface NativeFunctionCall {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}
export interface NativeChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    name?: string;
    tool_calls?: readonly NativeFunctionCall[];
    tool_call_id?: string;
}
export interface CompletionMetadata { finishReason?: string | null; toolCalls?: NativeFunctionCall[] }
export interface NativeChatResult { content: string; finishReason?: string | null; toolCalls?: NativeFunctionCall[] }

/** Copy only standard function-call fields. Arguments remain exact opaque text. */
export function nativeFunctionCalls(value: unknown): NativeFunctionCall[] {
    if (!Array.isArray(value) || value.length > 16) throw new Error('Invalid native tool calls.');
    const ids = new Set<string>();
    return value.map(call => {
        if (!call || call.type !== 'function' || typeof call.id !== 'string' || !call.id.trim() || call.id.length > 256 ||
            ids.has(call.id) || !call.function || typeof call.function.name !== 'string' ||
            !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u.test(call.function.name) ||
            typeof call.function.arguments !== 'string' || call.function.arguments.length > 8192)
            throw new Error('Invalid native function call.');
        ids.add(call.id);
        return { id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } };
    });
}

/** Tool results must answer preceding calls, never introduce an unbound result.
 * RP fields (IDs, raw words, actor/perception state) never reach the SDK body.
 */
export function nativeChatMessages(input: readonly NativeChatMessage[]): NativeChatMessage[] {
    if (!Array.isArray(input) || !input.length) throw new Error('Native chat needs messages.');
    const pending = new Set<string>(), seen = new Set<string>();
    const result = input.map(message => {
        if (!message || !['system','user','assistant','tool'].includes(message.role)) throw new Error('Invalid native chat role.');
        if (pending.size && message.role !== 'tool') throw new Error('Native tool results are missing.');
        const clean: NativeChatMessage = { role: message.role, content: message.content };
        if (message.role === 'tool') {
            if (typeof message.content !== 'string' || typeof message.tool_call_id !== 'string' || !pending.delete(message.tool_call_id))
                throw new Error('Native tool result has no pending call.');
            clean.tool_call_id = message.tool_call_id;
        } else {
            const calls = message.role === 'assistant' && message.tool_calls !== undefined ? nativeFunctionCalls(message.tool_calls) : [];
            if (typeof message.content !== 'string' && !(message.role === 'assistant' && calls.length && message.content === null))
                throw new Error('Invalid native chat content.');
            if (typeof message.name === 'string' && message.name.trim()) clean.name = message.name;
            if (calls.length) {
                for (const call of calls) {
                    if (seen.has(call.id)) throw new Error('Native call ID reused.');
                    seen.add(call.id); pending.add(call.id);
                }
                clean.tool_calls = calls;
            }
        }
        return clean;
    });
    if (pending.size) throw new Error('Native tool results are missing.');
    return result;
}
