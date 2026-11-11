import { generationFailure } from '../../src/main/conversation/generationFailure';

test.each([502, 503, 504])('HTTP %s gets an actionable service notice without provider data', status => {
    const failure = generationFailure({ status, name: 'InternalServerError', message: 'PRIVATE-PROMPT-AND-KEY' });
    expect(failure).toMatchObject({ code: 'service_unavailable', status });
    expect(failure.message).toContain('Please try again');
    expect(JSON.stringify(failure)).not.toContain('PRIVATE');
});
test.each([[429, 'service_busy'], [401, 'access_refused'], [403, 'access_refused'], [400, 'request_rejected']])('status %s has a fixed safe notice', (status, code) => {
    expect(generationFailure({ status, message: 'PRIVATE' })).toMatchObject({ code, status });
});
test('connection and timeout errors are distinguished without showing arbitrary server text', () => {
    expect(generationFailure({ name: 'APIConnectionError', message: 'PRIVATE-URL' }).code).toBe('connection_failed');
    expect(generationFailure({ name: 'APIConnectionTimeoutError' }).code).toBe('timeout');
});
test('verified capture and unfinished native reply notices retain their real boundary', () => {
    expect(generationFailure(new Error('Current character age capture is not ready. Reopen the encounter or retry the reply.')).code).toBe('capture_not_ready');
    expect(generationFailure(new Error('Incomplete native RP reply.')).code).toBe('unfinished_reply');
});
test('unknown, primitive and broken exception objects cannot leak data or suppress the notice', () => {
    for (const error of [null, undefined, 'PRIVATE', { status: '502', message: 'PRIVATE' },
        Object.defineProperty({}, 'status', { get() { throw new Error('PRIVATE'); } })]) {
        expect(generationFailure(error)).toEqual({ code: 'unknown', message: 'An unexpected error occurred during generation.' });
    }
});

test('changed character sources receive an actionable context notice',()=>{
    for(const message of ['Character sources changed during the native lore turn.',
        'Character knowledge changed during deeper lore lookup.']){
        expect(generationFailure(new Error(message)).code).toBe('context_changed');
    }
});
