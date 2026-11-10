import { SCENE_CATALOGUE, SCENE_CATALOGUE_DIGEST } from './catalogue.generated';
import { SceneConditions, SceneDefinition, SceneSnapshot, ResolvedSceneContext } from './types';

export function conditionsEligible(c: SceneConditions, snapshot: SceneSnapshot): boolean {
    // Match the compiler's core-only distribution: GoA-specific observations
    // and assets do not become available merely because a core flag is true.
    if (snapshot.mode === 'core' && (c.styles || c.regions || c.cultures || c.excludedCultures ||
        c.provinceIds || c.worldStates || c.citySites)) return false;
    return (!c.citySites || c.citySites.some(id => {
        const site = SCENE_CATALOGUE.citySites?.find(site => site.id === id);
        return site && conditionsEligible(site.conditions, snapshot);
    })) && (!c.styles || c.styles.includes(snapshot.style)) &&
        (!c.cultures || c.cultures.includes(snapshot.culture ?? 'unknown')) &&
        (!c.excludedCultures || (!(snapshot.presentation === 'launcher' && snapshot.culture === 'unknown') && !c.excludedCultures.includes(snapshot.culture ?? 'unknown'))) &&
        (!c.regions || c.regions.some(r => snapshot.regions.includes(r) &&
            (!SCENE_CATALOGUE.regions.find(region => region.id === r)?.provinces ||
                SCENE_CATALOGUE.regions.find(region => region.id === r)!.provinces!.includes(snapshot.provinceId!)))) &&
        (!c.terrains || c.terrains.includes(snapshot.terrain)) &&
        (c.settled === undefined || c.settled === snapshot.settled) &&
        (c.settledOrCamp === undefined || c.settledOrCamp === (snapshot.settled || snapshot.camp === true)) &&
        (c.coastal === undefined || c.coastal === snapshot.coastal) &&
        (c.riverside === undefined || c.riverside === snapshot.riverside) &&
        (!c.provinceIds || c.provinceIds.includes(snapshot.provinceId!)) &&
        (!c.worldStates || c.worldStates.every(s => (!snapshot.observedWorldStates || snapshot.observedWorldStates.includes(s)) && snapshot.worldStates.includes(s))) &&
        (!c.excludedWorldStates || c.excludedWorldStates.every(s => (!snapshot.observedWorldStates || snapshot.observedWorldStates.includes(s)) && !snapshot.worldStates.includes(s))) &&
        (c.regionalFallback !== true || !SCENE_CATALOGUE.scenes.some(other => other.regionalEnvironment && sceneEligible(other, snapshot)));
}

function baseEligible(scene: SceneDefinition, snapshot: SceneSnapshot): boolean {
    return !(snapshot.mode === 'core' && scene.source === 'goa') && conditionsEligible(scene.conditions, snapshot);
}

export function sceneEligible(scene: SceneDefinition, snapshot: SceneSnapshot): boolean {
    return baseEligible(scene, snapshot) && !SCENE_CATALOGUE.scenes.some(other =>
        other.replaces?.includes(scene.id) && baseEligible(other, snapshot));
}

export function eligibleScenes(snapshot: SceneSnapshot): SceneDefinition[] {
    if (snapshot.catalogue !== SCENE_CATALOGUE_DIGEST) return [];
    // Intersection is intentional: the engine's complete export and local catalogue must agree.
    return SCENE_CATALOGUE.scenes.filter(s => snapshot.eligible.includes(s.id) && sceneEligible(s, snapshot));
}

export function resolveScene(snapshot?: SceneSnapshot): ResolvedSceneContext | undefined {
    if (!snapshot) return undefined;
    const scene = eligibleScenes(snapshot).find(s => s.id === snapshot.selected);
    if (!scene) return undefined;
    const regional = SCENE_CATALOGUE.regions.filter(r => snapshot.regions.includes(r.id)).map(r => r.facts);
    const packet = [
        'Current meeting environment:',
        `Observed location: ${snapshot.location}. Terrain: ${snapshot.terrain.replace(/_/g, ' ')}.`,
        snapshot.controller ? `Local controller: ${snapshot.controller}.` : '',
        `Selected venue: ${scene.label}.`,
        regional.length ? `Regional setting: ${regional.join(' ')}` : '',
        `Visible surroundings in the selected backdrop: ${scene.facts}`,
        scene.socialContext ? `Customary use of this venue: ${scene.socialContext}` : scene.purpose,
        scene.conditions.worldStates?.includes('community_faith_access') &&
            !snapshot.worldStates.includes('community_faith_members')
            ? 'Observed access: Every participant is physically present. Each person outside the local faith is currently imprisoned by a present participant who shares that faith. This access check records existing custody; it supplies no motive for capture, treatment, willing participation, conversion, religious agreement, intended sacrifice or punishment. Retain each person\'s own beliefs and reactions. Use supplied relationships to identify a particular jailer; the aggregate access check does not name one.' : '',
        'Use a few relevant details naturally. Customary use offers possibilities; actual participants and circumstances determine what is happening. Character personality, beliefs and relationships determine conduct. Use only established character abilities and knowledge. Current surroundings supersede earlier scene prose. Do not invent additional crowds, rites, weather, travel or later historical events beyond these observations. Apply these instructions silently through the scene or roleplay.'
    ].filter(Boolean).join('\n');
    return { sceneId: scene.id, label: scene.label, asset: scene.asset, environment: scene.environment,
        packet, revision: JSON.stringify(snapshot) };
}
