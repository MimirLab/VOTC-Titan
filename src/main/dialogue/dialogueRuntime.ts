import type { Character } from '../../shared/gameData/Character';
import type { Config } from '../../shared/Config';
import { currentGoaCatalog } from '../goa/goaRuntime';
import { buildDialogueCaptureCatalog, DialogueCaptureCatalog, DialogueIdentity, DialogueLogReader } from './dialogueCapture';

let catalog: DialogueCaptureCatalog | undefined;
let reader: DialogueLogReader | undefined;
let flush: (() => void) | undefined;
let configuration: Config | undefined;
const bindings = new WeakMap<Character, { reader: DialogueLogReader; epoch: number; revision: number; identity: DialogueIdentity }>();

export function configureDialogueCapture(config: Config, flushLog?: () => void): void {
    catalog = undefined; reader = undefined; flush = flushLog; configuration = config;
    if (!currentGoaCatalog() || !config.cultureGameInstallPath || !config.userFolderPath) return;
    try { catalog = buildDialogueCaptureCatalog(config.cultureGameInstallPath, config.userFolderPath); reader = new DialogueLogReader(catalog); }
    catch { /* Unknown native definitions keep existing persona/lore/background behavior. */ }
}
export function currentDialogueCaptureCatalog(): DialogueCaptureCatalog | undefined {
    return configuration?.goaLoreEnabled !== false && (configuration?.cultureRoleplayEnabled || configuration?.faithRoleplayEnabled) ? catalog : undefined;
}
export function observeDialogueLine(line: string): void { reader?.observe(line); }
export function clearDialogueObservations(): void { reader?.clear(); }
export function invalidateDialogueIdentities(ids: readonly number[]): void { reader?.forget(ids); }

/** Canonical current identity for either upstream writer or a separate acoustic selector; no writing instructions here. */
export function getDialogueIdentity(character: Character): DialogueIdentity | undefined {
    if (!reader || !currentDialogueCaptureCatalog()) return;
    flush?.();
    const revision = reader.revisions.get(character.id);
    const observed = reader.snapshot(character.id), bound = bindings.get(character);
    const identity = observed ?? (bound?.reader === reader && bound.epoch === reader.epoch && bound.revision === revision ? bound.identity : undefined);
    if (!identity || revision === undefined) return;
    bindings.set(character, { reader, epoch: reader.epoch, revision, identity }); return identity;
}
