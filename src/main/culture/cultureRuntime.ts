import { configureLauncherScenes, launcherScenesEnabled, observeLauncherSceneLine, clearLauncherScenes, bindLauncherScene } from '../scenes/launcherSceneRuntime';
import { initializeGoaRuntime, refreshGoaCapture } from '../goa/goaRuntime';
import { configureDevelopmentCapture, developmentCaptureEnabled, observeDevelopmentLine, clearDevelopmentObservations, invalidateDevelopment, bindDevelopment } from '../development/developmentRuntime';
import { configureCastingCapture, observeCastingLine, clearCastingObservations } from '../audio/castingRuntime';
import { configureDialogueCapture, currentDialogueCaptureCatalog, observeDialogueLine, clearDialogueObservations, getDialogueIdentity } from '../dialogue/dialogueRuntime';
import { backgroundQueue } from '../background/BackgroundQueue';
import { BACKGROUND_BODY_BOUNDARY, BACKGROUND_DISPOSITION_BOUNDARY } from '../background/backgroundBodyBoundary';
import { initializeFaithRuntime, refreshFaithCapture, beginFaithForeground, closeFaithRuntime } from '../faith/faithRuntime';
import path from 'path';
import { Tiktoken } from 'js-tiktoken';
import { Config } from '../../shared/Config';
import { Character } from '../../shared/gameData/Character';
import { ApiConnection } from '../../shared/apiConnection';
import { CultureLibrary } from './CultureLibrary';
import { CultureService } from './CultureService';
import { CultureLogReader } from './cultureLog';
import { buildCultureCatalog, CultureCatalog } from './cultureCatalog';
import { generateCultureProfile } from './cultureGeneration';
import { EncounterCapture, encounterTargets } from '../background/EncounterCapture';
import { validateCk3GameDate } from '../../shared/gameData/gameDate';
import type { GameData } from '../../shared/gameData/GameData';
import { ProfileState, waitForProfiles, ReadinessResult } from '../background/profileReadiness';
import { currentFaithCatalog, prepareFaithProfile } from '../faith/faithRuntime';
import { currentGoaCatalog, getVerifiedGoaSnapshot } from '../goa/goaRuntime';
import { currentLoreMutationCatalog } from '../lorebook/loreMutationRuntime';
import { configureLoreGameStateCapture, currentLoreGameStateCatalog, observeLoreGameStateLine, clearLoreGameState, bindLoreGameStateClock } from '../lorebook/loreGameStateRuntime';
import { configureLanguageCapture, currentLanguageCaptureCatalog, bindLanguageSnapshot, observeLanguageLine, clearLanguageObservations } from '../language';

let service: CultureService | undefined;
let catalog: CultureCatalog | undefined;
let encounter: EncounterCapture | undefined;
let captureEpoch = 0;
let reader: CultureLogReader | undefined;
let captureStatus = 'Select the CK3 installation and prepare cultural background in System settings.';
let configuration: Config;
let root: string;
let refreshLog: (() => void) | undefined;

export function initializeCultureRuntime(config: Config, votcDataPath: string, encoder: Tiktoken | null, foregroundBusy: () => boolean, flushLog?: () => void): void {
    configuration = config;
    refreshLog = flushLog;
    encounter = new EncounterCapture(() => ({ culture: catalog, faith: currentFaithCatalog(), goa: currentGoaCatalog(), languages: currentLanguageCaptureCatalog(), dialogue: currentDialogueCaptureCatalog(), development: developmentCaptureEnabled(), loreMutation: currentLoreMutationCatalog(), loreGameState: currentLoreGameStateCatalog(), scenes: launcherScenesEnabled(), clock: true }), flushLog);
    encounter.recover(config.userFolderPath);
    root = path.join(votcDataPath, 'culture');
    initializeGoaRuntime(config, flushLog);
    initializeFaithRuntime(config, votcDataPath, encoder, foregroundBusy, flushLog);
    try {
        const library = new CultureLibrary(path.join(root, 'cultures.sqlite'));
        service = new CultureService(library, async (input, signal) => {
            const provider = configuration.textGenerationApiConnectionConfig;
            const api = new ApiConnection(provider.connection, provider.parameters, encoder, 'background');
            return generateCultureProfile(api, input, signal);
        }, { enabled: () => !!configuration.cultureRoleplayEnabled, language: () => configuration.language || 'en', foregroundBusy }, backgroundQueue);
        refreshCultureCapture();
        service.start();
    } catch {
        captureStatus = 'The cultural background library could not be opened. Existing roleplay remains available.';
    }
}

export function refreshCultureCapture(): void {
    configureLoreGameStateCapture(configuration, refreshLog);
    configureLauncherScenes(configuration, refreshLog);
    refreshFaithCapture();
    refreshGoaCapture();
    configureCastingCapture(configuration, refreshLog);
    configureDialogueCapture(configuration, refreshLog);
    configureDevelopmentCapture(configuration);
    captureEpoch++; encounter?.clear();
    reader = undefined; catalog = undefined;
    configureLanguageCapture(undefined, configuration.languageRoutingEnabled !== false);
    service?.clearObservations();
    if (!configuration.cultureGameInstallPath || !configuration.userFolderPath) return;
    try {
        const current = buildCultureCatalog(configuration.cultureGameInstallPath, configuration.userFolderPath);
        catalog = current;
        configureLanguageCapture(current, configuration.languageRoutingEnabled !== false, currentGoaCatalog()?.traitIds ?? []);
        reader = new CultureLogReader(current, Date.now, id => {
            if (id === undefined) service?.clearObservations();
            else service?.forgetCharacter(id);
        });
        captureStatus = 'Capture ready through the standard VOTC bridge. New profiles prepare during conversations.';
    } catch {
        captureStatus = 'Select the current CK3 installation and refresh background definitions in System settings.';
    }
}

export function prepareCultureCapture(): string {
    if (!configuration.cultureGameInstallPath || !configuration.userFolderPath)
        throw new Error('Select the CK3 installation and CK3 user folder first.');
    refreshCultureCapture();
    if (!catalog) throw new Error('The current cultural definitions could not be read.');
    return 'Definitions refreshed. Standard VOTC captures current conversation participants; no additional game addon or restart is required.';
}

export function observeCultureLine(line: string): void {
    if (!reader || !service) return;
    try {
        const observation = reader.read(line);
        if (observation) { service.observe(observation); captureStatus = 'Live cultural capture is active.'; }
    } catch { reader.reset(); }
}
export function clearCultureObservations(): void { captureEpoch++; encounter?.clear(); reader?.reset(); service?.clearObservations(); clearLanguageObservations(); clearDialogueObservations(); clearCastingObservations(); clearDevelopmentObservations(); clearLoreGameState(); clearLauncherScenes(); }
export async function clearCultureLibrary(): Promise<number> {
    if (!service) throw new Error('The culture library is unavailable');
    return service.clearProfiles();
}
export function cultureRuntimeStatus(): string {
    const counts = service?.stats();
    return captureStatus + (counts ? ` Library: ${counts.ready} ready, ${counts.pending} pending, ${counts.failed} awaiting retry.` : '');
}
export function beginCultureForeground(): () => void {
    const culture = service?.beginForeground() ?? (() => {});
    const faith = beginFaithForeground();
    return () => { culture(); faith(); };
}
export function getCultureBackground(character: Character, includeCulturalRoots = true): string | undefined {
    try { refreshLog?.(); return service?.backgroundFor(character, includeCulturalRoots); } catch { return; }
}
/** Also observes the probe receipt on the same authoritative debug-log tail. */
export function observeEncounterLine(line: string): void { encounter?.observe(line); observeLanguageLine(line); observeDialogueLine(line); observeCastingLine(line); observeDevelopmentLine(line); observeLoreGameStateLine(line); observeLauncherSceneLine(line); }

function profileStates(character: Character, priority = false): ProfileState[] {
    try { refreshLog?.(); } catch { /* Log remains unavailable rather than inferred. */ }
    return [service?.prepare(character, priority) ?? 'disabled', prepareFaithProfile(character, priority)];
}

export async function captureRoleplayEncounter(characters: Character[], signal: AbortSignal,
    game: GameData, letterSlot?: string): Promise<boolean> {
    signal.throwIfAborted();
    const epoch = captureEpoch;
    const states = characters.map(character => profileStates(character));
    const needsGoa = !!currentGoaCatalog() && configuration?.goaLoreEnabled !== false && characters.some(c => !getVerifiedGoaSnapshot(c));
    const needsLanguages = !!currentLanguageCaptureCatalog() && characters.some(c => !bindLanguageSnapshot(c));
    const needsDialogue = !!currentDialogueCaptureCatalog() && characters.some(c => !getDialogueIdentity(c));
    // Refresh world/owned memories on the same probe as the ordinary encounter.
    // Earlier observations cannot substitute for the current save's state.
    const needsLoreMutation = !!currentLoreMutationCatalog() || !!currentLoreGameStateCatalog();
    // Letters and opening encounters get current writer facts even without culture, GoA or Audio.
    const needsDevelopment = developmentCaptureEnabled();
    if (needsDevelopment) invalidateDevelopment(characters);
    signal.throwIfAborted();
    if (states.every(domain => domain.every(state => state !== 'unobserved')) && !needsGoa && !needsLanguages && !needsDialogue && !needsDevelopment && !needsLoreMutation && (!launcherScenesEnabled() || !!letterSlot) && validateCk3GameDate(game.gameDate).valid) return true;
    const targets = encounterTargets(game, characters.map(c => c.id), letterSlot);
    const captured = await encounter?.capture(configuration?.userFolderPath, targets, signal,
        letterSlot ? 'votc_letter_actions.txt' : 'votc.txt') ?? false;
    signal.throwIfAborted();
    if (epoch !== captureEpoch) throw Object.assign(new Error('Game encounter changed'), { name: 'AbortError' });
    if (!captured) return false;
    if (encounter?.lastGameDate) game.gameDate = { ...encounter.lastGameDate };
    if (!letterSlot) bindLauncherScene(game, encounter?.lastAcknowledgedNonce);
    if (currentLoreGameStateCatalog() && !bindLoreGameStateClock(game, characters)) return false;
    // Bind all actual participants immediately, before a slow provider can outlive freshness.
    const complete = characters.map(character => {
        const domains = profileStates(character);
        const goa = getVerifiedGoaSnapshot(character);
        const development = !needsDevelopment || bindDevelopment(character);
        return domains.every(state => state !== 'unobserved') &&
            development &&
            (!currentLanguageCaptureCatalog() || bindLanguageSnapshot(character)) &&
            (!currentGoaCatalog() || configuration?.goaLoreEnabled === false || !!goa);
    });
    return complete.every(Boolean);
}

/** Refresh only current comprehension facts through the existing owned bridge; background profiles retain their own lane. */
export async function captureCurrentLanguages(characters: Character[], signal: AbortSignal, game: GameData): Promise<boolean> {
    signal.throwIfAborted();
    const epoch = captureEpoch;
    const languages = currentLanguageCaptureCatalog();
    const dialogue = currentDialogueCaptureCatalog();
    const development = developmentCaptureEnabled();
    if (!currentGoaCatalog() && !languages && !dialogue && !development && !currentLoreMutationCatalog() && !currentLoreGameStateCatalog() && !launcherScenesEnabled()) return false;
    if (development) invalidateDevelopment(characters);
    const captured = await encounter?.capture(configuration?.userFolderPath, encounterTargets(game, characters.map(c => c.id)),
        signal, 'votc.txt', 6000, { languagesOnly: true }) ?? false;
    signal.throwIfAborted();
    if (epoch !== captureEpoch) throw Object.assign(new Error('Game encounter changed'), { name: 'AbortError' });
    if (currentGoaCatalog() && configuration?.goaLoreEnabled !== false &&
        (!captured || characters.some(character => !getVerifiedGoaSnapshot(character))))
        throw new Error('Current Warcraft identity capture is not ready. Retry the reply.');
    if (captured && encounter?.lastGameDate) game.gameDate = { ...encounter.lastGameDate };
    if (captured) bindLauncherScene(game, encounter?.lastAcknowledgedNonce);
    if (captured && currentLoreGameStateCatalog() && !bindLoreGameStateClock(game, characters)) return false;
    if (development && (!captured || !characters.map(bindDevelopment).every(Boolean)))
        throw new Error('Current character age capture is not ready. Reopen the encounter or retry the reply.');
    // A missing optional style identity omits the new register; it cannot block otherwise valid RP/language capture.
    return captured && (!languages || (currentLanguageCaptureCatalog()?.digest === languages.digest && characters.every(bindLanguageSnapshot)));
}

export async function prepareRoleplayBackground(character: Character, signal: AbortSignal,
    onWaiting?: () => void, priority = true): Promise<ReadinessResult> {
    const epoch = captureEpoch;
    return waitForProfiles(() => {
        if (epoch !== captureEpoch) throw Object.assign(new Error('Game encounter changed'), { name: 'AbortError' });
        return profileStates(character, priority);
    }, signal, onWaiting);
}

export function formatCultureBackground(character: Pick<Character, 'fullName'>, paragraph: string): string {
    return `Cultural background for ${character.fullName} (secondary context):\n${paragraph}\n` +
        `Use this as light background about this culture's current social expectations. The character's traits, faith, personal description, ` +
        `relationships, memories and circumstances remain primary. Culture may colour familiar language, references and assumptions about others; ` +
        `the person may accept, reinterpret, ignore or oppose its norms. Keep the current exchange central, without reciting the notes or ` +
        `creating a new topic to display them. Shared norms do not establish current participants, events, enacted laws, religious rules, ` +
        `or causal links between separate customs. Religious interpretation belongs to the character's own faith context. ` +
        BACKGROUND_DISPOSITION_BOUNDARY + ' ' + BACKGROUND_BODY_BOUNDARY;
}
export async function closeCultureRuntime(): Promise<void> { encounter?.clear(); clearDevelopmentObservations(); await service?.close(); await closeFaithRuntime(); service = undefined; reader = undefined; }
