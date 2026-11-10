import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { SCENE_CATALOGUE, SCENE_CATALOGUE_DIGEST } from '../../shared/scenes/catalogue.generated';
import { resolveScene } from '../../shared/scenes/sceneContext';
import { SceneSnapshot } from '../../shared/scenes/types';

const root = path.resolve(__dirname, '../../../public/scene-art');
/** Only the currently observed, eligible scene can supply an owned painting. */
export function readLauncherSceneArt(snapshot?: SceneSnapshot, requested?: unknown, artRoot = root): Buffer | undefined {
    if (!snapshot || snapshot.presentation !== 'launcher' || typeof requested !== 'string' || snapshot.selected !== requested) return;
    const scene = resolveScene(snapshot);
    const definition = SCENE_CATALOGUE.scenes.find(s => s.id === requested);
    if (!scene || definition?.source !== 'generated' || !/^(?:titan_scenes\/)?[a-z0-9_]+\.dds$/.test(scene.asset)) return;
    const manifest = JSON.parse(fs.readFileSync(path.join(artRoot, 'manifest.json'), 'utf8'));
    const expected = manifest.files[scene.asset];
    if (manifest.catalogue !== SCENE_CATALOGUE_DIGEST || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Scene art edition changed');
    const file = path.join(artRoot, scene.asset);
    const actualRoot = fs.realpathSync(artRoot);
    if (!fs.realpathSync(file).startsWith(actualRoot + path.sep) || fs.statSync(file).size > 16_000_000) throw new Error('Invalid scene art path');
    const bytes = fs.readFileSync(file);
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Scene art changed');
    return bytes;
}
