import { ProfileState } from '../background/profileReadiness';
import path from 'path';
import { Tiktoken } from 'js-tiktoken';
import { Config } from '../../shared/Config';
import { Character } from '../../shared/gameData/Character';
import { ApiConnection } from '../../shared/apiConnection';
import { FaithLiveContext } from '../../shared/gameData/FaithSnapshot';
import { FaithLibrary } from './FaithLibrary';
import { FaithService } from './FaithService';
import { FaithLogReader } from './faithLog';
import { buildFaithCatalog, FaithCatalog } from './faithCatalog';
import { generateFaithProfile } from './faithGeneration';
import { backgroundQueue } from '../background/BackgroundQueue';

let service: FaithService | undefined;
let reader: FaithLogReader | undefined;
let catalog: FaithCatalog | undefined;
let configuration: Config;
let refreshLog: (() => void) | undefined;
let status = 'Prepare religious background for the current CK3 playset in System settings.';
export function initializeFaithRuntime(config: Config, dataPath: string, encoder: Tiktoken | null,
    foregroundBusy: () => boolean, flushLog?: () => void): void {
    configuration = config; refreshLog = flushLog;
    try {
        service = new FaithService(new FaithLibrary(path.join(dataPath, 'religion', 'faiths.sqlite')), (input, signal) => {
            const provider = configuration.textGenerationApiConnectionConfig;
            return generateFaithProfile(new ApiConnection(provider.connection, provider.parameters, encoder, 'background'), input, signal);
        }, { enabled: () => !!configuration.faithRoleplayEnabled, language: () => configuration.language || 'en', foregroundBusy }, backgroundQueue);
        refreshFaithCapture(); service.start();
    } catch { status = 'The religious library could not be opened. Existing roleplay remains available.'; }
}
export function refreshFaithCapture(): void {
    reader = undefined; catalog = undefined; service?.clearObservations();
    if (!configuration?.cultureGameInstallPath || !configuration.userFolderPath) return;
    try {
        const current = buildFaithCatalog(configuration.cultureGameInstallPath, configuration.userFolderPath);
        catalog = current;
        reader = new FaithLogReader(current, Date.now, id => id === undefined ? service?.clearObservations() : service?.forgetCharacter(id));
        status = 'Capture prepared. Religious background will become available after a complete game encounter.';
    } catch { status = 'Refresh definitions for this CK3 playset to enable religious capture.'; }
}
export function observeFaithLine(line: string): void {
    if (!reader || !service) return;
    try {
        const observation = reader.read(line);
        if (observation) { service.observe(observation); status = 'Live religious capture is active.'; }
    } catch { reader.reset(); }
}
export function clearFaithObservations(): void { reader?.reset(); service?.clearObservations(); }
export async function clearFaithLibrary(): Promise<number> {
    if (!service) throw new Error('The faith library is unavailable');
    return service.clearProfiles();
}
export function faithRuntimeStatus(): string {
    const counts = service?.stats();
    return status + (counts ? ' Library: ' + counts.ready + ' ready, ' + counts.pending + ' pending, ' + counts.failed + ' awaiting retry.' : '');
}
export function getFaithBackground(character: Character): string | undefined {
    try { refreshLog?.(); return service?.backgroundFor(character); } catch { return; }
}
export function getFaithLiveContext(character: Character): FaithLiveContext | undefined {
    try {
        const context = service?.contextFor(character);
        if (context) character.faithLiveContext = context;
        else delete character.faithLiveContext;
        return context;
    } catch { return; }
}
export function getFaithZealous(character: Character): boolean | undefined {
    try { return service?.zealousFor(character); } catch { return; }
}
export function beginFaithForeground(): () => void { return service?.beginForeground() ?? (() => {}); }
export async function closeFaithRuntime(): Promise<void> { await service?.close(); service = undefined; reader = undefined; }

export function currentFaithCatalog(): FaithCatalog | undefined { return catalog; }
export function prepareFaithProfile(character: Character, priority = false): ProfileState { return service?.prepare(character, priority) ?? 'disabled'; }
