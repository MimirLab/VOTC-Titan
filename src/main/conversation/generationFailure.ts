/** Fixed user messages and diagnostic codes; never expose provider bodies,
 * request prompts, credentials or arbitrary exception text to the renderer. */
export interface GenerationFailure {
    code: 'service_unavailable' | 'service_busy' | 'access_refused' | 'request_rejected' |
        'connection_failed' | 'timeout' | 'capture_not_ready' | 'unfinished_reply' | 'unknown';
    status?: number;
    message: string;
}
export function generationFailure(error: unknown): GenerationFailure {
    let status: number | undefined, name = '', message = '';
    try {
        if (error && typeof error === 'object') {
            const record = error as { status?: unknown; name?: unknown; message?: unknown };
            if (typeof record.status === 'number' && Number.isInteger(record.status) && record.status >= 400 && record.status <= 599) status = record.status;
            if (typeof record.name === 'string') name = record.name;
            if (typeof record.message === 'string') message = record.message.slice(0, 512);
        }
    } catch { /* A broken exception object must not withhold the error notice. */ }
    if (status && status >= 500) return { code: 'service_unavailable', status,
        message: `The text service is temporarily unavailable (HTTP ${status}). Please try again.` };
    if (status === 429) return { code: 'service_busy', status,
        message: 'The text service is busy (HTTP 429). Please retry shortly.' };
    if (status === 401 || status === 403) return { code: 'access_refused', status,
        message: `The text service refused access (HTTP ${status}). Check the connection credentials.` };
    if (status) return { code: 'request_rejected', status,
        message: `The text service rejected the request (HTTP ${status}). Check the text connection settings.` };
    if (name === 'APIConnectionTimeoutError' || name === 'TimeoutError') return { code: 'timeout',
        message: 'The text service did not reply in time. Please try again.' };
    if (name === 'APIConnectionError') return { code: 'connection_failed',
        message: 'The text service could not be reached. Check the connection and try again.' };
    if (message.startsWith('Current character age capture is not ready.')) return { code: 'capture_not_ready',
        message: 'The current character details are not ready. Reopen the encounter or retry the reply.' };
    if (message === 'Incomplete native RP reply.') return { code: 'unfinished_reply',
        message: 'The text service returned an empty or unfinished reply. Please try again.' };
    return { code: 'unknown', message: 'An unexpected error occurred during generation.' };
}
