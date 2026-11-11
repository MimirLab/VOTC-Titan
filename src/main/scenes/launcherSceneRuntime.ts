import { Config } from '../../shared/Config';
import { GameData } from '../../shared/gameData/GameData';
import { SceneSnapshot } from '../../shared/scenes/types';
import { EncounterCapture, encounterTargets } from '../background/EncounterCapture';
import { LauncherSceneReader, preferredSceneForCe } from './launcherSceneCapture';
import { applySceneSnapshot, setLauncherSceneSelector } from './sceneRuntime';
import { validateLauncherSceneSources } from './launcherSceneSources';

let enabled = false;
let config: Config | undefined;
let reader = new LauncherSceneReader();
let probe: EncounterCapture | undefined;
let epoch = 0;
const selections = new Map<string, string>();
let publish: ((game: GameData, snapshot: SceneSnapshot, kind: 'capture' | 'action') => void) | undefined;
const campaignKey = (game: GameData): string => {
    const ids = [game.votcCampaignIdA, game.votcCampaignIdB, game.votcCampaignIdC, game.votcCampaignIdD];
    return ids.every(n => Number.isSafeInteger(n) && n! > 0) ? ids.join(':') : '';
};
export function setLauncherScenePublisher(callback: (game: GameData, snapshot: SceneSnapshot, kind: 'capture' | 'action') => void): void { publish = callback; }
export function configureLauncherScenes(value: Config, flush?: () => void): void {
    config = value; clearLauncherScenes(); enabled = false;
    try { enabled = !!value.userFolderPath && validateLauncherSceneSources(value.userFolderPath); } catch { /* Optional scene context remains unavailable. */ }
    probe = new EncounterCapture(() => ({ scenes: enabled }), flush);
    setLauncherSceneSelector(async (game, selected) => {
        if (!enabled || !config || !probe) return;
        const generation = epoch;
        const captured = await probe.capture(config.userFolderPath, encounterTargets(game, [game.playerID]), new AbortController().signal);
        if (!captured || generation !== epoch) return;
        const snapshot = bindLauncherScene(game, probe.lastAcknowledgedNonce, selected, false);
        if (snapshot && snapshot.selected === selected) {
            selections.set(campaignKey(game) + ':' + snapshot.provinceId, selected);
            if (selections.size > 512) selections.delete(selections.keys().next().value!);
            return snapshot;
        }
    }, (game, snapshot) => publish?.(game, snapshot, 'action'));
}
export function launcherScenesEnabled(): boolean { return enabled; }
export function observeLauncherSceneLine(line: string): void { reader.observe(line); probe?.observe(line); }
export function clearLauncherScenes(): void { epoch++; reader.clear(); probe?.clear(); selections.clear(); }
export function bindLauncherScene(game: GameData, nonce?: string, selected?: string, apply = true): SceneSnapshot | undefined {
    if (!enabled || !nonce || game.sceneSnapshot?.presentation === 'native') return;
    // Consume an exact acknowledged probe. Never attach a last-known scene from another turn/save.
    const snapshot = reader.consume(nonce, game.playerID, [...game.characters.keys()], campaignKey(game), selected);
    if (!snapshot) return;
    const previous = game.sceneSnapshot;
    const previousRevision = game.resolvedSceneContext?.revision;
    const choice = selected ?? selections.get(campaignKey(game) + ':' + snapshot.provinceId) ??
        (previous && previous.provinceId === snapshot.provinceId ? previous.selected : undefined);
    snapshot.ceScene = game.launcherSceneObservation?.ceScene ?? game.scene;
    if (choice && snapshot.eligible.includes(choice)) snapshot.selected = choice;
    else snapshot.selected = preferredSceneForCe(snapshot, snapshot.ceScene) ?? '';
    if (selected && snapshot.selected !== selected) return;
    if (apply) {
        game.launcherSceneObservation = snapshot;
        if (snapshot.selected) applySceneSnapshot(game, snapshot);
        else {
            delete game.sceneSnapshot; delete game.resolvedSceneContext;
            game.scene = snapshot.ceScene;
            game.location = snapshot.location; game.locationController = snapshot.controller;
        }
        if (previousRevision !== game.resolvedSceneContext?.revision || !game.resolvedSceneContext) publish?.(game, snapshot, 'capture');
    }
    return snapshot;
}
