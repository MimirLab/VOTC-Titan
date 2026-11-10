import { createHash } from 'crypto';
import { ApiConnection } from '../../shared/apiConnection';
import { Message } from '../ts/conversation_interfaces';

/** Reuse only identical actual requests, never summaries of another owner's different input. */
export class PerspectiveSummaries {
    private ready = new Map<string, string>();
    private pending = new Set<string>();
    private controller = new AbortController();
    clear(): void { this.controller.abort(); this.controller = new AbortController(); this.ready.clear(); this.pending.clear(); }
    async generate(api: ApiConnection, prompt: string | Message[], background = false, signal?: AbortSignal): Promise<string> {
        const key = createHash('sha256').update(JSON.stringify(prompt)).digest('hex');
        if (this.ready.has(key)) return this.ready.get(key)!;
        if (background && this.pending.has(key)) return '';
        const epoch = this.controller;
        this.pending.add(key);
        try {
            const combined = signal ? AbortSignal.any([signal, epoch.signal]) : epoch.signal;
            const result = await api.complete(prompt, false, {}, undefined, combined, 300_000, background ? 'background' : 'foreground');
            combined.throwIfAborted();
            const content = typeof result === 'string' ? result : result?.content ?? '';
            if (!content.trim() || /low balance|not enough credits|top up|api error|too many requests|rate limit/i.test(content))
                throw new Error('No valid perspective summary returned; history was retained');
            this.ready.set(key, content);
            // Bounded cache of precomputed requests; source ledger remains authoritative.
            if (this.ready.size > 64) this.ready.delete(this.ready.keys().next().value!);
            return content;
        } finally { if (epoch === this.controller) this.pending.delete(key); }
    }
}
