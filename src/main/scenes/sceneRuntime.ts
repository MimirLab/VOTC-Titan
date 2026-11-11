import { GameData } from '../../shared/gameData/GameData';
import { eligibleScenes, resolveScene } from '../../shared/scenes/sceneContext';
import { SceneLogReader } from '../../shared/scenes/sceneLog';
import { SceneSnapshot } from '../../shared/scenes/types';
import { Action } from '../ts/conversation_interfaces';

let reader = new SceneLogReader();
interface Transition { expected: string; promise: Promise<boolean>; finish: (success: boolean) => void; timer: ReturnType<typeof setTimeout>; }
const pending = new WeakMap<GameData, Transition>();
let launcherSelector: ((data: GameData, selected: string) => Promise<SceneSnapshot | undefined>) | undefined;
let launcherChanged: ((data: GameData, snapshot: SceneSnapshot) => void) | undefined;
export function setLauncherSceneSelector(selector: typeof launcherSelector, changed?: typeof launcherChanged): void { launcherSelector = selector; launcherChanged = changed; }

export function scenePacket(data: GameData): string {
    const context = resolveScene(data.sceneSnapshot);
    if (data.scene?.startsWith('titan_') && !context)
        throw new Error('The current scene observation is missing or outdated. Reopen the conversation to refresh it.');
    return context?.packet ?? '';
}

export function observeSceneLine(line: string): SceneSnapshot | undefined { return reader.observeLine(line); }
export function resetSceneReader(): void { reader = new SceneLogReader(); }

export function applySceneSnapshot(data: GameData, snapshot: SceneSnapshot): boolean {
    if (snapshot.anchorId !== data.playerID || !resolveScene(snapshot)) return false;
    data.sceneSnapshot = snapshot;
    if (snapshot.presentation === 'launcher') data.launcherSceneObservation = snapshot;
    if (snapshot.presentation === 'native') delete data.launcherSceneObservation;
    data.resolvedSceneContext = resolveScene(snapshot);
    data.scene = snapshot.selected;
    data.location = snapshot.location;
    data.locationController = snapshot.controller;
    const transition = pending.get(data);
    if (transition && snapshot.presentation !== 'launcher') {
        clearTimeout(transition.timer);
        transition.finish(transition.expected === snapshot.selected);
        // Keep the resolved result until the waiting generators have consumed it.
    }
    return true;
}

export async function waitForSceneSelection(data: GameData): Promise<void> {
    const transition = pending.get(data);
    if (!transition) return;
    const ok = await transition.promise;
    if (pending.get(data) === transition) pending.delete(data);
    if (!ok) throw new Error('The game did not confirm this scene change. Reopen the conversation to refresh its location.');
}

export async function selectLauncherVenue(data: GameData, choice: unknown, emitNative?: (effect: string) => void): Promise<void> {
    const census = data.launcherSceneObservation ?? data.sceneSnapshot;
    if (census?.presentation !== 'launcher' && !(census?.presentation === 'native' && emitNative))
        throw new Error('The current encounter has no verified Titan venues.');
    if (typeof choice !== 'string') throw new Error('Choose a venue from the scene gallery.');
    beginSceneSelection(data, census, [choice], emitNative ?? (() => {}));
    await waitForSceneSelection(data);
}

export function actionForScene(action: Action, data: GameData): Action {
    if (action.signature !== 'changeLocation') return action;
    const census = data.launcherSceneObservation ?? data.sceneSnapshot;
    if (!census) return data.scene?.startsWith('titan_') ? { ...action, check: () => false,
        args: action.args.map(arg => ({ ...arg, options: [] })) } : action;
    return { ...action, args: action.args.map((arg, i) => i ? arg :
        ({ ...arg, options: eligibleScenes(census).map(s => ({ value: s.id, display: { en: s.label } })) })) };
}

export function sceneUiState(data: GameData, actions: Action[]) {
    return { scene: data.scene, location: data.location, locationController: data.locationController,
        sceneSnapshot: data.sceneSnapshot, launcherSceneObservation: data.launcherSceneObservation,
        actions: actions.filter(a => a?.signature).map(action => ({
            signature: action.signature, args: actionForScene(action, data).args,
            description: action.description, creator: action.creator,
            usesSource: (action as any).usesSource, usesTarget: (action as any).usesTarget
        })) };
}

/** Enforce the same scene policy on automatic, approved and slash-command paths.
 * Saved/custom scripts are never overwritten. In Titan sessions the core owns changeLocation.
 */
export function runActionWithScenePolicy(action: Action, data: GameData, emit: (effect: string) => void,
    args: string[], source: number, target: number): void {
    if (action.signature === 'changeLocation' && data.scene?.startsWith('titan_') && !data.sceneSnapshot)
        throw new Error('A complete matching Titan scene capture is required before changing venues.');
    const census = data.launcherSceneObservation ?? data.sceneSnapshot;
    if (action.signature !== 'changeLocation' || !census) {
        const location = data.location;
        action.run(data, emit, args, source, target);
        if (action.signature === 'changeLocation') data.location = location;
        return;
    }
    beginSceneSelection(data, census, args, emit);
}

function beginSceneSelection(data: GameData, census: SceneSnapshot, args: string[], emit: (effect: string) => void): void {
    if (pending.has(data)) throw new Error('Wait for the current scene change to be confirmed by CK3.');
    const choice = args[0]?.toLowerCase().trim();
    if (args.length !== 1 || !eligibleScenes(census).some(s => s.id === choice))
        throw new Error('This venue is unavailable at the current meeting location.');
    let finish!: (success: boolean) => void;
    const promise = new Promise<boolean>(resolve => { finish = resolve; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; finish(false); }, 15000);
    pending.set(data, { expected: choice, promise, finish, timer });
    // No optimistic update: new context is attached only after the engine's complete receipt.
    try {
        if (census.presentation === 'launcher') {
            if (!launcherSelector) throw new Error('The launcher scene bridge is unavailable.');
            void launcherSelector(data, choice).then(snapshot => {
                if (!timedOut && snapshot?.selected === choice && pending.get(data)?.promise === promise && applySceneSnapshot(data, snapshot)) {
                    clearTimeout(timer);
                    finish(true);
                    launcherChanged?.(data, snapshot);
                }
                else { clearTimeout(timer); finish(false); }
            }).catch(() => { clearTimeout(timer); finish(false); });
        } else emit(`root = { titan_select_${choice}_effect = yes }`);
    }
    catch (error) { clearTimeout(timer); pending.delete(data); finish(false); throw error; }
}
