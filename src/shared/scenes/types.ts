export interface SceneConditions {
    /** Physical city fabric; current occupants do not replace inherited architecture. */
    citySites?: string[];
    styles?: string[];
    cultures?: string[];
    excludedCultures?: string[];
    regions?: string[];
    terrains?: string[];
    settled?: boolean;
    settledOrCamp?: boolean;
    coastal?: boolean;
    riverside?: boolean;
    provinceIds?: number[];
    worldStates?: string[];
    excludedWorldStates?: string[];
    /** Stock terrain art is offered only when no curated regional environment fits. */
    regionalFallback?: boolean;
}

export interface SceneDefinition {
    id: string;
    label: string;
    conditions: SceneConditions;
    asset: string;
    environment: string;
    facts: string;
    purpose: string;
    /** Curated customary use and interaction possibilities of this selected venue. */
    socialContext?: string;
    priority: number;
    source: string;
    regional?: boolean;
    /** Regional landscape coverage, distinct from a constructed local venue. */
    regionalEnvironment?: boolean;
    /** Replace only these matching backgrounds while this scene is eligible. */
    replaces?: string[];
    worldScene?: boolean;
    /** Named-place authoring within the shared, matched scene collection. */
    landmarkScene?: boolean;
    /** Holy-site and portable community-place authoring chapter. */
    communityScene?: boolean;
    /** Curated world-oddity and hidden-place authoring chapter. */
    oddityScene?: boolean;
    /** Curated material settings inspired by the trait-conditioned packet. */
    traitScene?: boolean;
    /** Exact reviewed original reused without copying or changing its texture. */
    reusesArtFrom?: string;
}

export interface SceneCitySite {
    id: string;
    label: string;
    conditions: SceneConditions;
}

export interface SceneEpisode {
    id: string;
    periodDays: number;
    activeDays: number;
    chance: number;
    salt: number;
    conditions: SceneConditions;
    calendar?: Array<{ month: number; fromDay: number; toDay: number }>;
}

/** Complete game observation at the same player-location anchor as the background. */
export interface SceneSnapshot {
    schema: 1;
    catalogue: string;
    mode: 'core' | 'goa';
    anchorId: number;
    selected: string;
    location: string;
    controller: string;
    terrain: string;
    style: string;
    /** Canonical observed local culture, only for explicitly authored visual variants. */
    culture?: string;
    /** Numeric physical ID from CK3's own clickable province name export. */
    provinceId?: number;
    regions: string[];
    settled: boolean;
    /** Observed nomad/herder holding, distinct from a built settlement. */
    camp?: boolean;
    coastal: boolean;
    riverside?: boolean;
    worldStates: string[];
    eligible: string[];
    /** Launcher observation: absence from this census means unknown, not false. */
    observedWorldStates?: string[];
    presentation?: 'launcher';
    /** Stock CE venue selected at conversation start; retain it until an explicit launcher choice. */
    ceScene?: string;
}

export interface ResolvedSceneContext {
    sceneId: string;
    label: string;
    asset: string;
    environment: string;
    packet: string;
    revision: string;
}
