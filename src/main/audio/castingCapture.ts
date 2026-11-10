import { createHash } from 'crypto';
import { loadActiveCultureFiles } from '../culture/cultureCatalog';
import { parseCk3Script } from '../culture/ck3Script';
import { castingCatalogue } from './castingCatalog';

export interface CastingCaptureCatalog { digest: string; cultureIds: readonly string[] }
export interface AcousticCulture { version: 1; complete: true; cultureId?: string }
/** Read definitions, never characters. Only exact current native culture keys select the default accent. */
export function buildCastingCapture(installation: string, userFolder: string): CastingCaptureCatalog {
    const catalogue = castingCatalogue();
    const files = loadActiveCultureFiles(installation, userFolder, ['common/culture/cultures'], true);
    const cultureIds = [...new Set([...files.values()].flatMap(source => parseCk3Script(source)
        .filter(entry => entry.key && /^[a-zA-Z0-9_]+$/.test(entry.key) && catalogue.cultures[entry.key] && Array.isArray(entry.value))
        .map(entry => entry.key!)))].sort();
    if (!cultureIds.length || cultureIds.length > 166) throw new Error('No supported native acoustic cultures.');
    return { cultureIds, digest: createHash('sha256').update(JSON.stringify({ source: catalogue.sourceSha256,
        files: [...files].sort(([a], [b]) => a.localeCompare(b)), cultureIds })).digest('hex') };
}
export function castingCaptureBody(catalogue: CastingCaptureCatalog): string {
    return `debug_log = "VOTC:ACOUSTIC/;/begin/;/${catalogue.digest}/;/[THIS.Char.GetID]"\n` +
        'culture = {\n' + catalogue.cultureIds.map(id =>
            `if = { limit = { this = culture:${id} } debug_log = "VOTC:ACOUSTIC/;/culture/;/${id}/;/1" }\n` +
            `else = { debug_log = "VOTC:ACOUSTIC/;/culture/;/${id}/;/0" }`).join('\n') + '\n}\n' +
        `debug_log = "VOTC:ACOUSTIC/;/end/;/${catalogue.digest}/;/[THIS.Char.GetID]"\n`;
}
/** Short-lived complete participant frames. New/incomplete frames invalidate the old binding immediately. */
export class CastingLogReader {
    private pending?: { id: number; keys: Map<string, boolean>; invalid: boolean };
    private observations = new Map<number, { value: AcousticCulture; at: number }>();
    readonly revisions = new Map<number, number>();
    epoch = 0; private sequence = 0;
    constructor(readonly catalogue: CastingCaptureCatalog, private now = () => Date.now()) {}
    clear(): void { this.pending = undefined; this.observations.clear(); this.revisions.clear(); this.epoch++; }
    observe(line: string): void {
        if (line.includes('VOTC:CAMPAIGN/;/loaded/;/')) { this.clear(); return; }
        const marker = line.indexOf('VOTC:ACOUSTIC/;/'); if (marker < 0) return;
        const [kind, ...args] = line.slice(marker + 'VOTC:ACOUSTIC/;/'.length).trim().split('/;/');
        if (kind === 'begin') {
            this.pending = undefined;
            if (!/^\d+$/.test(args[1] ?? '') || !Number.isSafeInteger(Number(args[1]))) return;
            const id = Number(args[1]); this.observations.delete(id); this.revisions.delete(id); this.revisions.set(id, ++this.sequence);
            while (this.revisions.size > 64) { const oldest = this.revisions.keys().next().value!; this.revisions.delete(oldest); this.observations.delete(oldest); }
            if (args.length === 2 && args[0] === this.catalogue.digest) this.pending = { id, keys: new Map(), invalid: false };
            return;
        }
        const p = this.pending; if (!p) return;
        if (kind === 'culture') {
            if (args.length !== 2 || !this.catalogue.cultureIds.includes(args[0]) || !['0', '1'].includes(args[1]) || p.keys.has(args[0])) { p.invalid = true; return; }
            p.keys.set(args[0], args[1] === '1');
        } else if (kind === 'end') {
            const keys = [...p.keys].filter(([, yes]) => yes).map(([key]) => key);
            if (!p.invalid && keys.length <= 1 && p.keys.size === this.catalogue.cultureIds.length && args.length === 2 &&
                args[0] === this.catalogue.digest && args[1] === String(p.id)) this.observations.set(p.id, { at: this.now(),
                    value: Object.freeze({ version: 1, complete: true, ...(keys[0] ? { cultureId: keys[0] } : {}) }) });
            this.pending = undefined;
        } else p.invalid = true;
    }
    snapshot(id: number): AcousticCulture | undefined {
        const item = this.observations.get(id), age = item ? this.now() - item.at : Infinity;
        return age >= 0 && age <= 15_000 ? item?.value : undefined;
    }
}
