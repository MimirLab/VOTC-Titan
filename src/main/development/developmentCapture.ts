import { createHash } from 'crypto';

/** Text-writer facts only. Audio owns a different maturity protocol. */
export const DEVELOPMENT_DIGEST = createHash('sha256').update('votc-rp-development-v1:exact-age-0-19;20+;is_adult').digest('hex');
export interface DevelopmentFrame { readonly age: number | '20+'; readonly adult: boolean }

/** Literal integers avoid localized GetAge formatting. Only the current participant is read. */
export function developmentCaptureBody(): string {
    return `debug_log = "VOTC:DEVELOPMENT/;/begin/;/${DEVELOPMENT_DIGEST}/;/[THIS.Char.GetID]"\n` +
        `if = { limit = { age >= 20 } debug_log = "VOTC:DEVELOPMENT/;/age/;/20+" }\n` +
        Array.from({ length: 20 }, (_, age) =>
            `else_if = { limit = { age = ${age} } debug_log = "VOTC:DEVELOPMENT/;/age/;/${age}" }`).join('\n') + '\n' +
        `if = { limit = { is_adult = yes } debug_log = "VOTC:DEVELOPMENT/;/adult/;/1" }\n` +
        `else = { debug_log = "VOTC:DEVELOPMENT/;/adult/;/0" }\n` +
        `debug_log = "VOTC:DEVELOPMENT/;/end/;/${DEVELOPMENT_DIGEST}/;/[THIS.Char.GetID]"\n`;
}

export class DevelopmentLogReader {
    private pending?: { id: number; age?: DevelopmentFrame['age']; adult?: boolean; invalid: boolean };
    private frames = new Map<number, DevelopmentFrame>();
    clear(): void { this.pending = undefined; this.frames.clear(); }
    forget(ids: readonly number[]): void { for (const id of ids) this.frames.delete(id); }
    take(id: number): DevelopmentFrame | undefined {
        const frame = this.frames.get(id); this.frames.delete(id); return frame;
    }
    observe(line: string): void {
        if (line.includes('VOTC:CAMPAIGN/;/loaded/;/')) { this.clear(); return; }
        const marker = line.indexOf('VOTC:DEVELOPMENT/;/'); if (marker < 0) return;
        const [kind, ...args] = line.slice(marker + 'VOTC:DEVELOPMENT/;/'.length).trim().split('/;/');
        if (kind === 'begin') {
            this.pending = undefined;
            if (!/^\d+$/.test(args[1] ?? '') || !Number.isSafeInteger(Number(args[1]))) return;
            const id = Number(args[1]); this.frames.delete(id);
            if (args.length === 2 && args[0] === DEVELOPMENT_DIGEST) this.pending = { id, invalid: false };
            return;
        }
        const p = this.pending; if (!p) return;
        if (kind === 'age') {
            if (args.length !== 1 || p.age !== undefined || !/^(?:[0-9]|1[0-9]|20\+)$/.test(args[0])) p.invalid = true;
            else p.age = args[0] === '20+' ? '20+' : Number(args[0]);
        } else if (kind === 'adult') {
            if (args.length !== 1 || p.adult !== undefined || !/^[01]$/.test(args[0])) p.invalid = true;
            else p.adult = args[0] === '1';
        } else if (kind === 'end') {
            if (!p.invalid && p.age !== undefined && p.adult !== undefined && args.length === 2 &&
                args[0] === DEVELOPMENT_DIGEST && args[1] === String(p.id)) {
                this.frames.set(p.id, Object.freeze({ age: p.age, adult: p.adult }));
                while (this.frames.size > 64) this.frames.delete(this.frames.keys().next().value!);
            }
            this.pending = undefined;
        } else p.invalid = true;
    }
}
