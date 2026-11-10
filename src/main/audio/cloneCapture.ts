import fs from 'fs';
import { DemonFamily, isDemonFamily } from './demonVoices';
import path from 'path';
import { createHash } from 'crypto';
import { loadActiveCultureFiles } from '../culture/cultureCatalog';
import { parseCk3Script } from '../culture/ck3Script';
import type { CloneAgingFacts, CloneReferenceAge } from './cloneAge';
import type { UndeadCoverage } from './undeadVoice';

export const BUNDLED_CLONES = path.resolve(__dirname, '../../../public/audio/clone-banks');
export interface CloneCatalog {
    version: 1;
    profiles: Record<string, { name: string; manifestHash: string; performanceFamily?: DemonFamily; undeadCoverage?:UndeadCoverage; referenceAge?:CloneReferenceAge }>;
    identities: Record<string, { keys: string[]; defaultKey: string | null; forms?: { anyTraits: string[]; key: string }[] }>;
    history: Record<string, string>;
}
export const CLONE_FORM_TRAITS = ['being_undead', 'lich_king', 'metamorphosis', 'fallen_demon_hunter', 'creature_banshee'] as const;
export function selectCloneKey(c: CloneCatalog, id: string | undefined, traits: readonly string[] = []): string | undefined {
    const identity = id ? c.identities[id] : undefined;
    return identity?.forms?.find(rule => rule.anyTraits.some(t => traits.includes(t)))?.key ?? identity?.defaultKey ?? undefined;
}
export interface CloneCaptureCatalog { digest: string; ids: string[]; voices: CloneCatalog; agingTraitIds?: string[] }
export function withCloneAging(catalog: CloneCaptureCatalog, goa?: { digest: string; longLivedIds: string[] }): CloneCaptureCatalog {
    if (!goa) return catalog;
    if (!/^[a-f0-9]{64}$/.test(goa.digest) || goa.longLivedIds.some(id => !/^[A-Za-z0-9_]+$/.test(id))) throw new Error('Invalid voice aging catalogue.');
    const agingTraitIds = [...new Set(goa.longLivedIds)].sort();
    return { ...catalog, agingTraitIds, digest: createHash('sha256').update(JSON.stringify([catalog.digest, goa.digest, agingTraitIds, 'clone-aging-v1'])).digest('hex') };
}
export function bundledCloneCatalog(): CloneCatalog | undefined {
    const file = path.join(BUNDLED_CLONES, 'catalog.json');
    if (!fs.existsSync(file)) return;
    const c: CloneCatalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    const key = /^[a-z0-9][a-z0-9-]{0,79}\/v[0-9]{4}$/;
    if (c.version !== 1 || !c.history || Object.keys(c.identities).length > 1000 ||
        Object.entries(c.profiles).some(([k, p]) => !key.test(k) || !/^[a-f0-9]{64}$/.test(p.manifestHash) || p.performanceFamily !== undefined && !isDemonFamily(p.performanceFamily) ||
            p.undeadCoverage!==undefined&&!['covered','uncolored','specialized','unknown'].includes(p.undeadCoverage) ||
            p.referenceAge!==undefined&&!['adult','older','elderly'].includes(p.referenceAge)) ||
        Object.entries(c.identities).some(([id, v]) => !/^[a-zA-Z0-9_]+$/.test(id) || !v.keys.length ||
            v.keys.some(k => !Object.prototype.hasOwnProperty.call(c.profiles, k)) || v.defaultKey !== null && !v.keys.includes(v.defaultKey) ||
            v.forms?.some(rule => !v.keys.includes(rule.key) || !rule.anyTraits.length || rule.anyTraits.some(t => !(CLONE_FORM_TRAITS as readonly string[]).includes(t)))))
        throw new Error('The bundled character voice catalog is invalid.');
    return c;
}
/** Validate effective definitions, including later overrides. Never read a save or enumerate living NPCs. */
export function buildCloneCapture(installation: string, userFolder: string): CloneCaptureCatalog | undefined {
    const voices = bundledCloneCatalog(); if (!voices) return;
    const files = loadActiveCultureFiles(installation, userFolder, ['history/characters'], true);
    for (const [file, expected] of Object.entries(voices.history)) {
        const content = files.get(file);
        if (content === undefined || createHash('sha256').update(content).digest('hex') !== expected) return;
    }
    for (const [file, content] of files) if (!Object.prototype.hasOwnProperty.call(voices.history, file) &&
        parseCk3Script(content).some(e => e.key && Object.prototype.hasOwnProperty.call(voices.identities, e.key))) return;
    return { voices, ids: Object.keys(voices.identities).sort(),
        digest: createHash('sha256').update(JSON.stringify(voices)).digest('hex') };
}
/** Comparisons run in the already exported participant scope, not character:<GetID>. */
export function cloneCaptureBody(c: CloneCaptureCatalog): string {
    if (!/^[a-f0-9]{64}$/.test(c.digest) || c.ids.some(id => !/^[a-zA-Z0-9_]+$/.test(id)) || c.agingTraitIds?.some(id => !/^[A-Za-z0-9_]+$/.test(id))) throw new Error('Invalid clone identity capture.');
    return `debug_log = "VOTC:CLONE/;/begin/;/${c.digest}/;/[THIS.Char.GetID]"\n` + c.ids.map(id =>
        `if = { limit = { exists = character:${id} this = character:${id} } debug_log = "VOTC:CLONE/;/match/;/${id}" }`).join('\n') +
        '\n' + CLONE_FORM_TRAITS.map(trait =>
            `if = { limit = { has_trait = ${trait} } debug_log = "VOTC:CLONE/;/form/;/${trait}/;/1" }\n` +
            `else = { debug_log = "VOTC:CLONE/;/form/;/${trait}/;/0" }`).join('\n') +
        (c.agingTraitIds === undefined ? '' : '\n' + [
            ['ageless', 'OR = { has_trait = immortal has_trait_with_flag = no_aging_penalties }'],
            ['longLived', c.agingTraitIds.length ? `OR = { ${c.agingTraitIds.map(id => `has_trait = ${id}`).join(' ')} }` : 'always = no']
        ].map(([fact,condition]) => `if = { limit = { ${condition} } debug_log = "VOTC:CLONE/;/aging/;/${fact}/;/1" }\nelse = { debug_log = "VOTC:CLONE/;/aging/;/${fact}/;/0" }`).join('\n')) +
        `\ndebug_log = "VOTC:CLONE/;/end/;/${c.digest}/;/[THIS.Char.GetID]"\n`;
}
export class CloneLogReader {
    epoch = 0;
    private pending?: { id: number; matches: string[]; forms: Map<string, boolean>; aging: Map<string, boolean>; invalid: boolean };
    private observations = new Map<number, { id?: string; traits: string[]; aging?: CloneAgingFacts; at: number; sequence: number }>();
    private sequence = 0;
    readonly revisions = new Map<number, number>();
    constructor(readonly catalog: CloneCaptureCatalog, private now = () => Date.now()) {}
    clear(): void { this.pending = undefined; this.observations.clear(); this.revisions.clear(); this.epoch++; }
    observe(line: string): void {
        if (line.includes('VOTC:CAMPAIGN/;/loaded/;/')) { this.clear(); return; }
        const marker = line.indexOf('VOTC:CLONE/;/'); if (marker < 0) return;
        const [kind, ...args] = line.slice(marker + 'VOTC:CLONE/;/'.length).trim().split('/;/');
        if (kind === 'begin') {
            this.pending = undefined;
            if (!/^\d+$/.test(args[1] ?? '') || !Number.isSafeInteger(Number(args[1]))) return;
            const id = Number(args[1]); this.observations.delete(id); this.revisions.set(id, ++this.sequence);
            while (this.revisions.size > 64) { const first = this.revisions.keys().next().value!; this.revisions.delete(first); this.observations.delete(first); }
            if (args.length === 2 && args[0] === this.catalog.digest) this.pending = { id, matches: [], forms: new Map(), aging: new Map(), invalid: false };
            return;
        }
        const p = this.pending; if (!p) return;
        if (kind === 'match') {
            if (args.length !== 1 || !this.catalog.ids.includes(args[0]) || p.matches.length) p.invalid = true;
            else p.matches.push(args[0]);
        } else if (kind === 'form') {
            if (args.length !== 2 || !(CLONE_FORM_TRAITS as readonly string[]).includes(args[0]) || !['0', '1'].includes(args[1]) || p.forms.has(args[0])) p.invalid = true;
            else p.forms.set(args[0], args[1] === '1');
        } else if (kind === 'aging') {
            if (this.catalog.agingTraitIds === undefined || args.length !== 2 || !['ageless','longLived'].includes(args[0]) || !['0','1'].includes(args[1]) || p.aging.has(args[0])) p.invalid = true;
            else p.aging.set(args[0], args[1] === '1');
        } else if (kind === 'end') {
            if (!p.invalid && p.forms.size === CLONE_FORM_TRAITS.length && (this.catalog.agingTraitIds === undefined || p.aging.size === 2) && args.length === 2 && args[0] === this.catalog.digest && args[1] === String(p.id)) {
                this.observations.set(p.id, { id: p.matches[0], traits: [...p.forms].filter(([, yes]) => yes).map(([t]) => t),
                    ...(p.aging.size === 2 ? { aging: { ageless: p.aging.get('ageless')!, longLived: p.aging.get('longLived')! } } : {}), at: this.now(), sequence: this.sequence });
                while (this.observations.size > 64) this.observations.delete(this.observations.keys().next().value!);
            }
            this.pending = undefined;
        } else p.invalid = true;
    }
    snapshot(id: number) {
        const v = this.observations.get(id), age = v ? this.now() - v.at : Infinity;
        return age >= 0 && age <= 15000 ? v : undefined;
    }
}
