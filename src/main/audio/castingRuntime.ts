import { configureCloneCapture, observeCloneLine, clearCloneObservations } from './cloneRuntime';
import { configureMaturationCapture, observeMaturationLine, clearMaturationObservations } from './maturationRuntime';
import type { Character } from '../../shared/gameData/Character';
import type { Config } from '../../shared/Config';
import { currentGoaCatalog } from '../goa/goaRuntime';
import { AcousticCulture, buildCastingCapture, CastingCaptureCatalog, CastingLogReader } from './castingCapture';
import { EncounterCapture, encounterTargets } from '../background/EncounterCapture';
import type { GameData } from '../../shared/gameData/GameData';
import { getVerifiedGoaSnapshot } from '../goa/goaRuntime';

let config: Config | undefined, flush: (() => void) | undefined;
let catalogue: CastingCaptureCatalog | undefined, reader: CastingLogReader | undefined;
let wasEnabled = false;
let capture: EncounterCapture | undefined;
let requestedBody = false, requestedCulture = false;
const bindings = new WeakMap<Character, { reader: CastingLogReader; epoch: number; revision: number; value: AcousticCulture }>();
export function configureCastingCapture(configuration: Config, flushLog?: () => void): void {
    configureCloneCapture(configuration, flushLog);
    configureMaturationCapture(configuration, flushLog);
    config = configuration; flush = flushLog; catalogue = undefined; reader = undefined; wasEnabled = false;
    capture?.clear();
    capture = new EncounterCapture(() => ({ acoustic: requestedCulture ? currentCastingCapture() : undefined,
        goa: requestedBody ? currentGoaCatalog() : undefined }), flushLog);
}
export function currentCastingCapture(): CastingCaptureCatalog | undefined {
    const enabled = config?.audio?.enabled === true;
    if (enabled !== wasEnabled) {
        catalogue = undefined; reader = undefined; wasEnabled = enabled;
        if (enabled && currentGoaCatalog() && config?.cultureGameInstallPath && config.userFolderPath) {
            try { catalogue = buildCastingCapture(config.cultureGameInstallPath, config.userFolderPath); reader = new CastingLogReader(catalogue); }
            catch { /* Unknown packs remain eligible for explicit player casting, not inferred accents. */ }
        }
    }
    return enabled ? catalogue : undefined;
}
export function observeCastingLine(line: string): void {
    observeMaturationLine(line);
    observeCloneLine(line); capture?.observe(line); if (config?.audio?.enabled) reader?.observe(line);
}
export function clearCastingObservations(): void { clearMaturationObservations(); clearCloneObservations(); capture?.clear(); reader?.clear(); }
/** Audio owns this read after committed text; ordinary writer/language routing never requests it. */
export async function captureForAudio(actor: Character, game: GameData, signal: AbortSignal,
    needs: { body?: boolean; culture?: boolean } = {}): Promise<void> {
    if (!currentCastingCapture()) return;
    signal.throwIfAborted();
    const body = needs.body !== false && !getVerifiedGoaSnapshot(actor);
    const culture = needs.culture !== false && !getAcousticCulture(actor);
    if (!body && !culture) return;
    requestedBody = body; requestedCulture = culture;
    const complete = await capture?.capture(config!.userFolderPath, encounterTargets(game, [actor.id]), signal) ?? false;
    signal.throwIfAborted();
    if (!complete || culture && !getAcousticCulture(actor) || body && !getVerifiedGoaSnapshot(actor))
        throw new Error('Current body and culture capture is not ready for this voice. Reopen the encounter or retry its voice in Audio.');
}
export function getAcousticCulture(character: Character): AcousticCulture | undefined {
    if (!currentCastingCapture() || !reader) return;
    flush?.(); const revision = reader.revisions.get(character.id), observed = reader.snapshot(character.id), old = bindings.get(character);
    const value = observed ?? (old?.reader === reader && old.epoch === reader.epoch && old.revision === revision ? old.value : undefined);
    if (!value || revision === undefined) return;
    bindings.set(character, { reader, epoch: reader.epoch, revision, value }); return value;
}
