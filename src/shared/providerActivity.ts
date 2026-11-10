export type ProviderWork = 'foreground' | 'background' | 'background-resumable';

/** Internal identity distinguishes lane preemption from a caller/provider abort. */
class ForegroundPreemption extends Error {
    readonly reason = 'foreground';
    constructor() { super('Provider request preempted'); this.name = 'AbortError'; }
}

/** App-local text request lane. Embeddings use their existing independent connection. */
export class ProviderLane {
    private active?: { work: ProviderWork; controller: AbortController };
    private foreground = 0;
    private waiting: { work: ProviderWork; start: () => void }[] = [];

    get foregroundBusy(): boolean { return this.foreground > 0; }

    async run<T>(work: ProviderWork, operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
        signal?.throwIfAborted();
        if (work === 'background-resumable') {
            for (;;) {
                try { return await this.run('background', operation, signal); }
                catch (error) {
                    if (error instanceof ForegroundPreemption && !signal?.aborted) continue;
                    throw error;
                }
            }
        }
        if (work === 'foreground') {
            this.foreground++;
            if (this.active?.work === 'background') this.active.controller.abort('foreground');
        }
        const controller = new AbortController();
        const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        try {
            await new Promise<void>((resolve, reject) => {
                const entry = { work, start: () => { cleanup(); this.active = { work, controller }; resolve(); } };
                const aborted = () => {
                    this.waiting = this.waiting.filter(item => item !== entry);
                    cleanup(); reject(Object.assign(new Error('Provider request cancelled'), { name: 'AbortError' }));
                };
                const cleanup = () => combined.removeEventListener('abort', aborted);
                this.waiting.push(entry);
                combined.addEventListener('abort', aborted, { once: true });
                this.dispatch();
            });
            combined.throwIfAborted();
            return await operation(combined);
        } catch (error) {
            if (work === 'background' && controller.signal.aborted && controller.signal.reason === 'foreground' && !signal?.aborted)
                throw new ForegroundPreemption();
            if (combined.aborted) throw Object.assign(new Error('Provider request cancelled'), {
                name: 'AbortError', reason: combined.reason
            });
            throw error;
        } finally {
            if (work === 'foreground') this.foreground--;
            if (this.active?.controller === controller) this.active = undefined;
            this.dispatch();
        }
    }

    private dispatch(): void {
        if (this.active || !this.waiting.length) return;
        const foreground = this.waiting.findIndex(item => item.work === 'foreground');
        const [next] = this.waiting.splice(foreground < 0 ? 0 : foreground, 1);
        next.start();
    }
}

export const textProviderLane = new ProviderLane();
