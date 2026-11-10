import { SCENE_CATALOGUE } from './catalogue.generated';

/** Display labels only; saved scene identifiers and effect arguments remain canonical. */
export function sceneDisplayName(scene: string): string {
    const id = scene.replace(/^talk_scene_/, '');
    const known = SCENE_CATALOGUE.scenes.find(s => s.id === id);
    if (known) return known.label;
    return id.replace(/^titan_/, '').replace(/_/g, ' ');
}
