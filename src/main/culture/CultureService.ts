import { ProfileState } from '../background/profileReadiness';
import { BackgroundQueue } from '../background/BackgroundQueue';
import { CultureSnapshot } from '../../shared/gameData/CultureSnapshot';
import { Character } from '../../shared/gameData/Character';
import { CultureInput, CultureGenerationResult, cultureInput } from './cultureIdentity';
import { CultureLibrary } from './CultureLibrary';
import { CultureObservation } from './cultureLog';

export type CultureGenerator = (input: CultureInput, signal: AbortSignal) => Promise<CultureGenerationResult>;

export class CultureService {
    private observations = new Map<number, { snapshot: CultureSnapshot; seenAt: number }>();
    private bindings = new WeakMap<Character, { snapshot: CultureSnapshot; epoch: number; revision: number }>();
    private revisions = new Map<number, number>();
    private epoch = 0;
    private pending = new Set<string>();
    private controller?: AbortController;
    private activeHash?: string;
    private running?: Promise<void>;
    private timer?: ReturnType<typeof setInterval>;
    private foreground = 0;
    private stopped = false;
    private purging?: Promise<number>;
    private queueKey = Symbol('culture');
    constructor(
        private library: CultureLibrary,
        private generate: CultureGenerator,
        private options: { enabled: () => boolean; language: () => string; foregroundBusy: () => boolean; now?: () => number },
        private queue: BackgroundQueue = new BackgroundQueue()
    ) {}

    private now(): number { return this.options.now?.() ?? Date.now(); }
    start(): void {
        if (!this.timer && !this.stopped) {
            this.timer = setInterval(() => { void this.tick().catch(() => {}); }, 500);
            this.timer.unref();
        }
    }
    /** Observation itself remains nonblocking; dialogue can explicitly await prepare(). */
    observe(observation: CultureObservation): void {
        if (!this.options.enabled() || this.stopped || this.purging) return;
        const input = cultureInput(observation.snapshot, this.options.language());
        const hash = this.library.encounter(input, this.now());
        this.observations.set(observation.characterId, { snapshot: input.snapshot, seenAt: this.now() });
        if (!this.library.ready(hash)) this.enqueue(hash);
    }
    clearObservations(): void {
        this.queue.withdraw(this.queueKey);
        this.epoch++;
        this.observations.clear(); this.pending.clear(); this.revisions.clear();
    }
    forgetCharacter(characterId: number): void {
        this.observations.delete(characterId);
        this.revisions.set(characterId, (this.revisions.get(characterId) ?? 0) + 1);
    }

    backgroundFor(character: Character): string | undefined {
        if (!this.options.enabled() || this.stopped || this.purging) return;
        // Bind facts to the Character snapshot used by this conversation. This keeps a long
        // conversation consistent with its own game facts, without trusting stale numeric ids
        // when a new Character object (or campaign) is encountered.
        const bound = this.bindings.get(character);
        if (bound && bound.epoch !== this.epoch) { delete character.cultureSnapshot; return; }
        const observation = this.observations.get(character.id);
        const revision = this.revisions.get(character.id) ?? 0;
        let snapshot: CultureSnapshot | undefined;
        if (observation && this.now() - observation.seenAt <= 15_000) {
            snapshot = observation.snapshot;
            this.bindings.set(character, { snapshot, epoch: this.epoch, revision });
        } else if (bound && bound.revision === revision) snapshot = bound.snapshot;
        if (!snapshot) {
            delete character.cultureSnapshot;
            return;
        }
        const input = cultureInput(snapshot, this.options.language());
        character.cultureSnapshot = input.snapshot;
        const hash = this.library.encounter(input, this.now());
        const paragraph = this.library.ready(hash);
        if (!paragraph) this.enqueue(hash);
        return paragraph;
    }

    private enqueue(hash: string): void {
        if (this.pending.has(hash)) return;
        // Only bounded recent encounters are scheduled; every accepted row remains durable.
        if (this.pending.size >= 64) this.pending.delete(this.pending.values().next().value!);
        this.pending.add(hash);
    }

    prepare(character: Character, priority = true): ProfileState {
        if (!this.options.enabled() || this.stopped || this.purging) return 'disabled';
        this.backgroundFor(character); // Bind before the transient numeric-ID observation expires.
        if (!character.cultureSnapshot) return 'unobserved';
        const hash = this.library.encounter(cultureInput(character.cultureSnapshot, this.options.language()), this.now());
        const state = this.library.state(hash) ?? 'unobserved';
        if (priority && state !== 'ready') {
            if (this.activeHash && this.activeHash !== hash) this.controller?.abort('priority');
            this.pending.delete(hash);
            this.pending = new Set([hash, ...this.pending]);
        }
        return state;
    }

    beginForeground(): () => void {
        this.foreground++;
        this.queue.interrupt();
        this.controller?.abort('foreground');
        let released = false;
        return () => { if (!released) { this.foreground--; released = true; } };
    }

    /** Exposed for deterministic scheduler tests; at most one generation may be in flight. */
    async tick(): Promise<void> {
        if (this.stopped || this.purging) { this.queue.withdraw(this.queueKey); return; }
        for (const [id, observation] of this.observations)
            if (this.now() - observation.seenAt > 15_000) this.observations.delete(id);
        if (!this.options.enabled() || this.foreground > 0 || this.options.foregroundBusy()) {
            this.queue.withdraw(this.queueKey);
            this.controller?.abort('foreground');
            return;
        }
        if (this.running) return;
        for (const hash of this.pending) {
            if (this.library.ready(hash)) { this.pending.delete(hash); continue; }
            const controller = new AbortController();
            const releaseQueue = this.queue.acquire(controller, this.queueKey);
            if (!releaseQueue) return;
            let job;
            try { job = this.library.claim(hash, this.now()); }
            catch { releaseQueue(); continue; }
            if (!job) { releaseQueue(); continue; }
            this.controller = controller; this.activeHash = hash;
            const deadline = setTimeout(() => controller.abort('deadline'), 120_000);
            deadline.unref();
            let onAbort = () => {};
            const cancelled = new Promise<never>((_resolve, reject) => {
                onAbort = () => reject(new Error('Interrupted cultural generation'));
                controller.signal.addEventListener('abort', onAbort, { once: true });
            });
            this.running = (async () => {
                try {
                    // Bound the worker even when a provider's authentication/request ignores cancellation.
                    const generation = Promise.resolve().then(() => {
                        if (controller.signal.aborted) throw new Error('Interrupted cultural generation');
                        return this.generate(job.input, controller.signal);
                    });
                    const response = await Promise.race([generation, cancelled]);
                    if (controller.signal.aborted) throw new Error('Interrupted culture generation');
                    this.library.finish(job, response, this.now());
                    this.pending.delete(hash);
                } catch (error) {
                    // Persist a bounded reason code, never provider errors (which may include credentials).
                    const preempted = (controller.signal.aborted && controller.signal.reason !== 'deadline') ||
                        (error as { reason?: unknown })?.reason === 'foreground';
                    this.library.fail(job, this.now(), preempted);
                } finally {
                    clearTimeout(deadline);
                    controller.signal.removeEventListener('abort', onAbort);
                    this.controller = undefined; this.activeHash = undefined;
                    releaseQueue();
                }
            })();
            try { await this.running; } finally { this.running = undefined; }
            return;
        }
        this.queue.withdraw(this.queueKey);
    }
    stats(): { ready: number; pending: number; failed: number } { return this.library.stats(); }
    /** Keep captured character facts, but never let an old worker resurrect cleared text.
     * No work is requeued until a subsequent encounter or prompt requests it. */
    async clearProfiles(): Promise<number> {
        if (this.purging) return this.purging;
        if (this.stopped) throw new Error('Background library is closed');
        this.purging = (async () => {
            this.pending.clear();
            this.queue.withdraw(this.queueKey);
            this.controller?.abort('purge');
            await this.running;
            return this.library.clearProfiles();
        })();
        try { return await this.purging; }
        finally { this.purging = undefined; }
    }
    async close(): Promise<void> {
        this.stopped = true;
        this.queue.withdraw(this.queueKey);
        if (this.timer) clearInterval(this.timer);
        this.controller?.abort('shutdown');
        await this.running;
        await this.purging;
        this.library.close();
    }
}
