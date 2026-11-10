/** Single background provider lane shared by culture and faith. Foreground always wins. */
export class BackgroundQueue {
    private owner?: AbortController;
    private waiting = new Set<symbol>();
    private last?: symbol;
    acquire(controller: AbortController, key: symbol): (() => void) | undefined {
        if (this.owner || (this.last === key && [...this.waiting].some(other => other !== key))) {
            this.waiting.add(key); return;
        }
        this.waiting.delete(key);
        this.owner = controller;
        return () => { if (this.owner === controller) { this.owner = undefined; this.last = key; } };
    }
    withdraw(key: symbol): void { this.waiting.delete(key); }
    interrupt(): void { this.owner?.abort('foreground'); }
}
export const backgroundQueue = new BackgroundQueue();
