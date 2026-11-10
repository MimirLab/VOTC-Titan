import type { Character } from '../../shared/gameData/Character';
import type { GameData } from '../../shared/gameData/GameData';
import type { Config } from '../../shared/Config';
import { EncounterCapture, encounterTargets } from '../background/EncounterCapture';
import { buildCloneCapture, CloneCaptureCatalog, CloneLogReader, selectCloneKey, CLONE_FORM_TRAITS, withCloneAging } from './cloneCapture';
import { currentGoaCatalog } from '../goa/goaRuntime';
import type { CloneAgingFacts } from './cloneAge';

let config: Config | undefined, flush: (() => void) | undefined;
let catalog: CloneCaptureCatalog | undefined, reader: CloneLogReader | undefined, capture: EncounterCapture | undefined;
let attempted = false;
let requestedIdentity: string | undefined;
const bindings = new WeakMap<Character, { reader: CloneLogReader; epoch: number; revision: number; id?: string; traits: string[]; aging?: CloneAgingFacts }>();
export function configureCloneCapture(configuration: Config, flushLog?: () => void): void {
    capture?.clear(); requestedIdentity = undefined; config = configuration; flush = flushLog; attempted = false; catalog = undefined; reader = undefined;
    capture = new EncounterCapture(() => {
        const current = currentCloneCapture();
        return { clones: current && requestedIdentity ? { ...current, ids: [requestedIdentity] } : current };
    }, flushLog);
}
export function currentCloneCapture(): CloneCaptureCatalog | undefined {
    if (!config?.audio?.enabled) { if (attempted) { capture?.clear(); attempted = false; catalog = undefined; reader = undefined; } return; }
    if (!attempted) {
        attempted = true;
        try {
            if (config.cultureGameInstallPath && config.userFolderPath) {
                catalog = buildCloneCapture(config.cultureGameInstallPath, config.userFolderPath);
                if (catalog) { catalog = withCloneAging(catalog, currentGoaCatalog()); reader = new CloneLogReader(catalog); }
            }
        } catch { /* Unsupported effective histories retain ordinary casting and manual banks. */ }
    }
    return catalog;
}
export function observeCloneLine(line: string): void {
    capture?.observe(line);
    if (config?.audio?.enabled) reader?.observe(line);
}
export function clearCloneObservations(): void { capture?.clear(); reader?.clear(); }
export function cloneObservation(actor: Character): { id?: string; key?: string; ambiguous: boolean; traits?: readonly string[]; aging?: CloneAgingFacts } | undefined {
    const c = currentCloneCapture(); if (!c || !reader) return;
    flush?.();
    const observed = reader.snapshot(actor.id), old = bindings.get(actor);
    if (observed) bindings.set(actor, { reader, epoch: reader.epoch, revision: observed.sequence, id: observed.id, traits: observed.traits, aging: observed.aging });
    const value = observed ?? (old?.reader === reader && old.epoch === reader.epoch && old.revision === reader.revisions.get(actor.id) ? old : undefined);
    if (!value) return;
    const identity = value.id ? c.voices.identities[value.id] : undefined;
    // These booleans belong to this identity frame; an older general body snapshot
    // must never override a newly observed transformation or reversal.
    const traits = value.traits.filter(t => (CLONE_FORM_TRAITS as readonly string[]).includes(t));
    return { id: value.id, key: selectCloneKey(c.voices, value.id, traits), traits, aging: value.aging, ambiguous: !!identity && !identity.defaultKey };
}
export async function captureCloneForAudio(actor: Character, game: GameData, signal: AbortSignal, options: { refreshAging?: boolean } = {}): Promise<ReturnType<typeof cloneObservation>> {
    signal.throwIfAborted();
    const current = currentCloneCapture(); if (!current) return;
    const cached = cloneObservation(actor);
    if (cached && !(options.refreshAging && current.agingTraitIds !== undefined) && (!cached.id || !current.voices.identities[cached.id]?.forms?.length)) return cached;
    // Identity stays stable. Refresh only the current participant's supported form
    // predicates for each new performance, including transformations in one encounter.
    requestedIdentity = cached?.id;
    let complete = false;
    try { complete = await capture?.capture(config!.userFolderPath, encounterTargets(game, [actor.id]), signal) ?? false; }
    finally { requestedIdentity = undefined; }
    signal.throwIfAborted();
    const result = cloneObservation(actor);
    if (!complete || !result) throw new Error('Character voice identity capture is not ready. Reopen the encounter or retry playback. You can also assign its clone bank in Audio.');
    return result;
}
