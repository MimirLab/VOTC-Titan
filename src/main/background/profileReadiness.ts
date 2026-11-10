export type ProfileState = 'disabled' | 'unobserved' | 'pending' | 'generating' | 'ready' | 'failed';
export type ReadinessResult = 'ready' | 'unavailable' | 'failed' | 'timeout';

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); };
        const aborted = () => { cleanup(); reject(Object.assign(new Error('Preparation cancelled'), { name: 'AbortError' })); };
        const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
        signal.addEventListener('abort', aborted, { once: true });
    });
}

/** Wait only for this encounter's two composition hashes, never for the entire library. */
export async function waitForProfiles(states: () => ProfileState[], signal: AbortSignal,
    onWaiting?: () => void, timeoutMs = 250_000): Promise<ReadinessResult> {
    const deadline = Date.now() + timeoutMs;
    let announced = false;
    while (true) {
        signal.throwIfAborted();
        const current = states();
        if (current.every(state => state === 'ready' || state === 'disabled')) return 'ready';
        if (!current.some(state => state === 'pending' || state === 'generating'))
            return current.some(state => state === 'failed') ? 'failed' : 'unavailable';
        if (Date.now() >= deadline) return 'timeout';
        if (!announced) { announced = true; onWaiting?.(); }
        await abortableDelay(Math.min(100, deadline - Date.now()), signal);
    }
}
