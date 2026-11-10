import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { readLauncherSceneArt } from '../../src/main/scenes/launcherSceneArt';
import { LauncherSceneReader, sceneStatePredicate } from '../../src/main/scenes/launcherSceneCapture';
import { SCENE_CATALOGUE as C, SCENE_CATALOGUE_DIGEST as D } from '../../src/shared/scenes/catalogue.generated';
import { sceneEligible } from '../../src/shared/scenes/sceneContext';
import { SceneSnapshot } from '../../src/shared/scenes/types';
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-scene-art-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function fixture(): SceneSnapshot {
    const snapshot: SceneSnapshot = { schema: 1, catalogue: D, mode: 'goa', anchorId: 1, selected: '',
        location: 'Goldshire', controller: 'King', terrain: 'plains', style: 'human', culture: 'unknown',
        provinceId: 10, regions: [], settled: true, camp: false, coastal: false, riverside: false,
        worldStates: [], observedWorldStates: C.worldStates.map(s => s.id), eligible: [], presentation: 'launcher' };
    snapshot.eligible = C.scenes.filter(s => sceneEligible(s, snapshot)).map(s => s.id);
    const scene = C.scenes.find(s => s.source === 'generated' && snapshot.eligible.includes(s.id))!;
    snapshot.selected = scene.id;
    const file = path.join(root, scene.asset); fs.mkdirSync(path.dirname(file), { recursive: true });
    const bytes = Buffer.from('retained synthetic texture bytes');
    fs.writeFileSync(file, bytes);
    fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ catalogue: D, files: {
        [scene.asset]: createHash('sha256').update(bytes).digest('hex')
    } }));
    return snapshot;
}
test('only the current eligible owned painting is readable, with exact hash preservation', () => {
    const snapshot = fixture();
    expect(readLauncherSceneArt(snapshot, snapshot.selected, root)?.toString()).toBe('retained synthetic texture bytes');
    expect(readLauncherSceneArt(snapshot, '../private/player.json', root)).toBeUndefined();
    expect(readLauncherSceneArt(snapshot, 'unselected_scene', root)).toBeUndefined();
    expect(readLauncherSceneArt({ ...snapshot, presentation: undefined }, snapshot.selected, root)).toBeUndefined();
    expect(readLauncherSceneArt(undefined, snapshot.selected, root)).toBeUndefined();
});
test('a changed or escaping painting is rejected', () => {
    const snapshot = fixture(), scene = C.scenes.find(s => s.id === snapshot.selected)!;
    fs.writeFileSync(path.join(root, scene.asset), 'changed');
    expect(() => readLauncherSceneArt(snapshot, snapshot.selected, root)).toThrow('changed');
    fs.unlinkSync(path.join(root, scene.asset));
    fs.symlinkSync('/etc/hostname', path.join(root, scene.asset));
    expect(() => readLauncherSceneArt(snapshot, snapshot.selected, root)).toThrow('path');
});
