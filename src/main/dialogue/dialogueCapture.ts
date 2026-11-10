import { createHash } from 'crypto';
import { loadActiveCultureFiles } from '../culture/cultureCatalog';
import { parseCk3Script, ScriptEntry } from '../culture/ck3Script';
import { dialogueCatalogue } from './dialogueCatalog';

export interface DialogueCaptureCatalog { digest: string; cultureIds: string[]; faithIds: string[] }
export interface DialogueIdentity {
    version: 1; complete: true; cultureId?: string; faithId?: string; cultureRoots: readonly string[];
}

/** Definitions only, once per ordinary refresh. Never enumerate characters or change a background hash. */
export function buildDialogueCaptureCatalog(installation: string, userFolder: string): DialogueCaptureCatalog {
    const data = dialogueCatalogue();
    const files = loadActiveCultureFiles(installation, userFolder, ['common/culture/cultures', 'common/religion/religion_types'], true);
    const cultures = new Set<string>(), faiths = new Set<string>();
    const faithKeys = (entries: ScriptEntry[]) => {
        for (const entry of entries) if (Array.isArray(entry.value)) {
            if (entry.key === 'faiths') for (const faith of entry.value) {
                if (faith.key && /^[a-zA-Z0-9_]+$/.test(faith.key) && Array.isArray(faith.value)) faiths.add(faith.key);
            } else faithKeys(entry.value);
        }
    };
    for (const [file, source] of files) {
        const entries = parseCk3Script(source);
        if (file.startsWith('common/culture/cultures/')) for (const entry of entries)
            if (entry.key && data.cultures[entry.key] && Array.isArray(entry.value)) cultures.add(entry.key);
        if (file.startsWith('common/religion/religion_types/')) faithKeys(entries);
    }
    const cultureIds = [...cultures].sort(), faithIds = [...faiths].sort();
    if (!cultureIds.length || !faithIds.length || cultureIds.length > 4096 || faithIds.length > 4096)
        throw new Error('No supported native dialogue identities');
    return { cultureIds, faithIds, digest: createHash('sha256').update(JSON.stringify({
        version: data.version, source: data.sourceSha256, files: [...files].sort(([a], [b]) => a.localeCompare(b)), cultureIds, faithIds
    })).digest('hex') };
}

export function dialogueCaptureBody(catalog: DialogueCaptureCatalog): string {
    return `debug_log = "VOTC:SPEECH/;/begin/;/${catalog.digest}/;/[THIS.Char.GetID]"\n` +
        'culture = {\n' + catalog.cultureIds.map(id =>
            `if = { limit = { this = culture:${id} } debug_log = "VOTC:SPEECH/;/culture/;/${id}/;/1" }\n` +
            `else = { debug_log = "VOTC:SPEECH/;/culture/;/${id}/;/0" }\n` +
            `if = { limit = { is_culture_or_parent_culture_trigger = { CULTURE = culture:${id} } } debug_log = "VOTC:SPEECH/;/root/;/${id}/;/1" }\n` +
            `else = { debug_log = "VOTC:SPEECH/;/root/;/${id}/;/0" }`).join('\n') + '\n}\n' +
        'faith = {\n' + catalog.faithIds.map(id =>
            `if = { limit = { this = faith:${id} } debug_log = "VOTC:SPEECH/;/faith/;/${id}/;/1" }\n` +
            `else = { debug_log = "VOTC:SPEECH/;/faith/;/${id}/;/0" }`).join('\n') + '\n}\n' +
        `debug_log = "VOTC:SPEECH/;/end/;/${catalog.digest}/;/[THIS.Char.GetID]"\n`;
}

/** Separate ephemeral identity: no character/culture/faith names in anonymous profile libraries. */
export class DialogueLogReader {
    private pending?: { id: number; cultures: Map<string, boolean>; faiths: Map<string, boolean>; roots: Map<string, boolean>; invalid: boolean };
    private observations = new Map<number, { identity: DialogueIdentity; at: number }>();
    readonly revisions = new Map<number, number>();
    epoch = 0;
    private sequence = 0;
    constructor(readonly catalog: DialogueCaptureCatalog, private now = () => Date.now()) {}
    clear(): void { this.pending = undefined; this.observations.clear(); this.revisions.clear(); this.epoch++; }
    forget(ids: readonly number[]): void { for (const id of ids) { this.observations.delete(id); this.revisions.delete(id); } }
    observe(line: string): void {
        if (line.includes('VOTC:CAMPAIGN/;/loaded/;/')) { this.clear(); return; }
        const marker = line.indexOf('VOTC:SPEECH/;/'); if (marker < 0) return;
        const [kind, ...args] = line.slice(marker + 'VOTC:SPEECH/;/'.length).trim().split('/;/');
        if (kind === 'begin') {
            const id = Number(args[1]); this.pending = undefined;
            if (!/^\d+$/.test(args[1] ?? '') || !Number.isSafeInteger(id)) return;
            this.observations.delete(id); this.revisions.delete(id); this.revisions.set(id, ++this.sequence);
            while (this.revisions.size > 64) { const oldest = this.revisions.keys().next().value!; this.revisions.delete(oldest); this.observations.delete(oldest); }
            if (args.length === 2 && args[0] === this.catalog.digest) this.pending = { id, cultures: new Map(), faiths: new Map(), roots: new Map(), invalid: false };
            return;
        }
        const p = this.pending; if (!p) return;
        if (kind === 'culture' || kind === 'faith' || kind === 'root') {
            const permitted = kind === 'faith' ? this.catalog.faithIds : this.catalog.cultureIds;
            const map = kind === 'culture' ? p.cultures : kind === 'faith' ? p.faiths : p.roots;
            if (args.length !== 2 || !permitted.includes(args[0]) || !['0', '1'].includes(args[1]) || map.has(args[0])) { p.invalid = true; return; }
            map.set(args[0], args[1] === '1');
        } else if (kind === 'end') {
            const matches = (map: Map<string, boolean>) => [...map].filter(([, yes]) => yes).map(([id]) => id);
            const cultures = matches(p.cultures), faiths = matches(p.faiths);
            if (!p.invalid && cultures.length <= 1 && faiths.length <= 1 && p.cultures.size === this.catalog.cultureIds.length &&
                p.roots.size === this.catalog.cultureIds.length && p.faiths.size === this.catalog.faithIds.length &&
                args.length === 2 && args[0] === this.catalog.digest && args[1] === String(p.id))
                this.observations.set(p.id, { at: this.now(), identity: Object.freeze({ version: 1, complete: true,
                    ...(cultures[0] ? { cultureId: cultures[0] } : {}), ...(faiths[0] ? { faithId: faiths[0] } : {}),
                    cultureRoots: Object.freeze(matches(p.roots).sort()) }) });
            this.pending = undefined;
        } else p.invalid = true;
    }
    snapshot(id: number): DialogueIdentity | undefined {
        const found = this.observations.get(id); const age = found ? this.now() - found.at : Infinity;
        return age >= 0 && age <= 15000 ? found?.identity : undefined;
    }
}
