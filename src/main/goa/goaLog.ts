import { GoaSnapshot, validateGoaSnapshot } from '../../shared/gameData/GoaSnapshot';

/** Complete frames only; a new/incomplete observation immediately invalidates the former body. */
export class GoaLogReader {
    private pending?: GoaSnapshot;
    private invalid = false;
    private count?: number;
    private countDigits = new Map<number, number>();
    readonly observations = new Map<number, GoaSnapshot>();
    readonly seenAt = new Map<number, number>();
    readonly revisions = new Map<number, number>();
    epoch = 0;
    constructor(private readonly digest?: string, private readonly allowedIds?: readonly string[]) {}
    clear(): void { this.pending = undefined; this.observations.clear(); this.seenAt.clear(); this.revisions.clear(); this.invalid = false; this.count = undefined; this.countDigits.clear(); this.epoch++; }
    observeLine(line: string): void {
        if (line.includes('VOTC:CAMPAIGN/;/loaded/;/')) { this.clear(); return; }
        const marker = line.indexOf('VOTC:GOA/;/');
        if (marker < 0) return;
        const [kind, ...args] = line.slice(marker + 'VOTC:GOA/;/'.length).trim().split('/;/');
        if (kind === 'begin') {
            const id = Number(args[2]);
            this.observations.delete(id);
            this.seenAt.delete(id); this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
            this.pending = undefined; this.invalid = false; this.count = undefined; this.countDigits.clear();
            if (args[0] !== '1' || !/^[a-f0-9]{64}$/.test(args[1]) || (this.digest && args[1] !== this.digest) || !Number.isSafeInteger(id)) return;
            this.pending = { version: 1, digest: args[1], characterId: id, traitIds: [], facts: {} };
            return;
        }
        const s = this.pending;
        if (!s) return;
        if (kind === 'count') {
            if (!this.countDigits.size && this.count === undefined && /^\d+$/.test(args[0]) && Number(args[0]) <= 5000)
                this.count = Number(args[0]); else this.invalid = true;
        } else if (kind === 'count_digit') {
            if (this.count === undefined && args.length === 2 && /^[0-3]$/.test(args[0]) && /^[0-9]$/.test(args[1]) &&
                !this.countDigits.has(Number(args[0]))) this.countDigits.set(Number(args[0]), Number(args[1]));
            else this.invalid = true;
        } else if (kind === 'sex') {
            if (args[0] === 'male' || args[0] === 'female') s.sex = args[0]; else this.invalid = true;
        } else if (kind === 'trait') {
            if (/^[A-Za-z0-9_]+$/.test(args[0]) && (!this.allowedIds || this.allowedIds.includes(args[0]))) s.traitIds.push(args[0]); else this.invalid = true;
        } else if (kind === 'fact') {
            if (/^[A-Za-z0-9_]+$/.test(args[0]) && ['yes', 'no'].includes(args[1])) s.facts[args[0]] = args[1] === 'yes';
            else this.invalid = true;
        } else if (kind === 'defence') {
            // Failed localization expressions must never become a zero resistance assertion.
            if (/^-?\d+(?:\.\d+)?$/.test(args[1] ?? '')) (s.magicDefences ??= {})[args[0]] = Number(args[1]);
        } else if (kind === 'end') {
            const count = this.count ?? (this.countDigits.size === 4
                ? [...this.countDigits].reduce((total, [position, digit]) => total + digit * 10 ** position, 0) : undefined);
            if (!this.invalid && s.sex && count !== undefined && count <= 5000 && count === s.traitIds.length && new Set(s.traitIds).size === count &&
                args[0] === s.digest && Number(args[1]) === s.characterId) {
                try { this.observations.set(s.characterId, validateGoaSnapshot(s)); this.seenAt.set(s.characterId, Date.now()); } catch { /* invalid frames remain unavailable */ }
            }
            this.pending = undefined;
        } else this.invalid = true;
    }
}
