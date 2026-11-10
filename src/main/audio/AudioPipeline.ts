interface Passage {
    chunks: Buffer[]; bytes: number; forward?: (bytes: Buffer) => void;
    done: Promise<void>; resolve: () => void; reject: (error: unknown) => void;
}
/** One synthesis lane runs freely while playback drains a bounded queue of PCM. */
export class AudioPipeline {
    private passages: Passage[] = [];
    private buffered = 0;
    private wake?: () => void;
    private generating: number | null = null;
    private completed = 0;
    private waiting = false;
    readonly finished: Promise<void>;
    constructor(count: number, render: (index: number, receive: (bytes: Buffer) => Promise<void>) => Promise<void>,
        private signal: AbortSignal, private changed: () => void = () => {}, private limit = 8 * 1024 * 1024) {
        if (!Number.isInteger(count) || count < 1 || !Number.isInteger(limit) || limit < 1) throw new Error('Invalid audio pipeline size.');
        this.passages = Array.from({ length: count }, () => {
            let resolve!: () => void, reject!: (error: unknown) => void;
            const done = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
            void done.catch(() => {});
            return { chunks: [], bytes: 0, done, resolve, reject };
        });
        const abort = () => this.release();
        signal.addEventListener('abort', abort, { once: true });
        this.finished = (async () => {
            try {
                for (let index = 0; index < count; index++) {
                    signal.throwIfAborted(); this.generating = index;
                    await this.room(this.passages[index], 1);
                    this.changed();
                    await render(index, bytes => this.receive(this.passages[index], bytes));
                    this.passages[index].resolve(); this.completed = index + 1; this.changed();
                }
            } catch (error) {
                for (let index = this.completed; index < count; index++) this.passages[index].reject(error);
            } finally {
                this.generating = null; this.waiting = false;
                signal.removeEventListener('abort', abort); this.release(); this.changed();
            }
        })();
        void this.finished.catch(() => {});
    }
    state() { return { generating: this.generating, completed: this.completed, bufferedBytes: this.buffered, waiting: this.waiting }; }
    passage(index: number): Pick<Passage, 'bytes' | 'done'> { return this.passages[index]; }
    connect(index: number, sink: (bytes: Buffer) => void): void {
        const passage = this.passages[index]; passage.forward = sink;
        for (const bytes of passage.chunks.splice(0)) { this.buffered -= bytes.length; sink(bytes); }
        this.release();
    }
    private release(): void { const wake = this.wake; this.wake = undefined; wake?.(); }
    private async room(passage: Passage, bytes: number): Promise<void> {
        while (!passage.forward && this.buffered + bytes > this.limit) {
            this.signal.throwIfAborted(); this.waiting = true; this.changed();
            await new Promise<void>(resolve => { this.wake = resolve; if (this.signal.aborted) this.release(); });
        }
        this.signal.throwIfAborted(); const resumed = this.waiting; this.waiting = false; if (resumed) this.changed();
    }
    private async receive(passage: Passage, bytes: Buffer): Promise<void> {
        this.signal.throwIfAborted(); passage.bytes += bytes.length;
        if (passage.bytes > 48_000 * 600) throw new Error('Speech exceeded the ten-minute audio limit.');
        for (let offset = 0; offset < bytes.length;) {
            if (passage.forward) { passage.forward(bytes.subarray(offset)); return; }
            const size = Math.min(64 * 1024, this.limit, bytes.length - offset);
            await this.room(passage, size);
            if (passage.forward) continue;
            passage.chunks.push(Buffer.from(bytes.subarray(offset, offset + size))); this.buffered += size; offset += size;
        }
    }
}
