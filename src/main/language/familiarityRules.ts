/** Finite authored eligibility, evaluated by CK3 for the current dialogue participants. */
export type FamiliarityPredicate =
    | { kind: 'any' | 'all'; conditions: FamiliarityPredicate[] }
    | { kind: 'culture'; ids: string[]; inherit: boolean; exclude: string[] }
    | { kind: 'faith' | 'doctrine' | 'tradition' | 'trait'; ids: string[] }
    | { kind: 'trained_school' | 'spirit_school'; school: string }
    | { kind: 'known_spell'; spell: string }
    | { kind: 'rite_institution'; faithIds: string[] };

export interface PracticeContactRule {
    id: string;
    category: 'faith_ritual' | 'faith_community' | 'tradition' | 'doctrine' | 'training' | 'institution' | 'spell';
    targets: string[];
    predicate: FamiliarityPredicate;
    reason: string;
    grounding: 'authored_gameplay_inference';
}

const idPattern = /^[a-zA-Z0-9_]+$/;
const schools = ['disorder', 'shadow', 'elemental_fire', 'elemental_water', 'elemental_air', 'elemental_earth'];
function identifiers(value: unknown): value is string[] {
    return Array.isArray(value) && value.length <= 128 && value.every(id => typeof id === 'string' && idPattern.test(id)) &&
        new Set(value).size === value.length;
}
function fields(value: object, allowed: string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }

/** Reject executable text, malformed scopes and unbounded expressions before publishing a command. */
export function validateFamiliarityPredicate(value: unknown, depth = 0): FamiliarityPredicate {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 8) throw new Error('Invalid familiarity predicate');
    const p = value as FamiliarityPredicate;
    if (p.kind === 'any' || p.kind === 'all') {
        if (!fields(p, ['kind', 'conditions']) || !Array.isArray(p.conditions) || !p.conditions.length || p.conditions.length > 128)
            throw new Error('Invalid familiarity combination');
        return { kind: p.kind, conditions: p.conditions.map(child => validateFamiliarityPredicate(child, depth + 1)) };
    }
    if (p.kind === 'culture') {
        if (!fields(p, ['kind', 'ids', 'inherit', 'exclude']) || !identifiers(p.ids) || !p.ids.length ||
            typeof p.inherit !== 'boolean' || !identifiers(p.exclude)) throw new Error('Invalid familiarity culture selector');
        return { kind: p.kind, ids: [...p.ids], inherit: p.inherit, exclude: [...p.exclude] };
    }
    if (['faith', 'doctrine', 'tradition', 'trait'].includes(p.kind)) {
        const selector = p as Extract<FamiliarityPredicate, { ids: string[] }>;
        if (!fields(selector, ['kind', 'ids']) || !identifiers(selector.ids) || !selector.ids.length)
            throw new Error('Invalid familiarity state selector');
        return { kind: selector.kind as 'faith' | 'doctrine' | 'tradition' | 'trait', ids: [...selector.ids] };
    }
    if (p.kind === 'trained_school' || p.kind === 'spirit_school') {
        if (!fields(p, ['kind', 'school']) || !schools.includes(p.school) ||
            (p.kind === 'spirit_school' && !p.school.startsWith('elemental_'))) throw new Error('Invalid familiarity school');
        return { kind: p.kind, school: p.school };
    }
    if (p.kind === 'known_spell') {
        if (!fields(p, ['kind', 'spell']) || typeof p.spell !== 'string' || !idPattern.test(p.spell))
            throw new Error('Invalid familiarity spell');
        return { kind: p.kind, spell: p.spell };
    }
    if (p.kind === 'rite_institution') {
        if (!fields(p, ['kind', 'faithIds']) || !identifiers(p.faithIds) || !p.faithIds.length)
            throw new Error('Invalid Rite institution selector');
        return { kind: p.kind, faithIds: [...p.faithIds] };
    }
    throw new Error('Unsupported familiarity predicate');
}

/** Called in character scope. No state mutation, private source export or recursive institution lookup. */
export function familiarityPredicateBody(predicate: FamiliarityPredicate, availableTraits?: ReadonlySet<string>): string {
    const p = validateFamiliarityPredicate(predicate);
    const any = (entries: string[]) => `OR = { ${entries.join(' ')} }`;
    if (p.kind === 'any' || p.kind === 'all')
        return `${p.kind === 'any' ? 'OR' : 'AND'} = { ${p.conditions.map(child => familiarityPredicateBody(child, availableTraits)).join(' ')} }`;
    if (p.kind === 'culture') {
        const inherited = (id: string) => `is_culture_or_parent_culture_trigger = { CULTURE = culture:${id} }`;
        return `culture = { ${any(p.ids.map(id => p.inherit ? inherited(id) : `this = culture:${id}`))}` +
            (p.exclude.length ? ` NOT = { ${any(p.exclude.map(inherited))} }` : '') + ' }';
    }
    if (p.kind === 'faith') return `faith = { ${any(p.ids.map(id => `this = faith:${id}`))} }`;
    if (p.kind === 'doctrine') return `faith = { ${any(p.ids.map(id => `has_doctrine = ${id}`))} }`;
    if (p.kind === 'tradition') return `culture = { ${any(p.ids.map(id => `has_cultural_tradition = ${id}`))} }`;
    const trait = (id: string) => availableTraits && !availableTraits.has(id) ? 'always = no' : `has_trait = ${id}`;
    if (p.kind === 'trait') return any(p.ids.map(trait));
    if (p.kind === 'trained_school') {
        const branches = p.school.startsWith('elemental_') ? ['', '_spirit', '_decay'] : [''];
        return any([`${p.school}_magic_lifestyle_perks > 0`, ...branches.flatMap(branch =>
            [1, 2, 3, 4, 5].map(rank => trait(`user_of_${p.school}${branch}_magic_${rank}`)))]);
    }
    if (p.kind === 'spirit_school') return any([
        ...[1, 2, 3, 4, 5].map(rank => trait(`user_of_${p.school}_spirit_magic_${rank}`)),
        `AND = { ${p.school}_magic_lifestyle_perks > 0 wc_ELEMENT_favour_TENSE_disposition_is_spirit_trigger = { ELEMENT = ${p.school} TENSE = current } }`
    ]);
    if (p.kind === 'known_spell') return `is_known_spell_trigger = { SPELL = flag:${p.spell} }`;
    if (p.kind === 'rite_institution') return `faith = { has_doctrine = tenet_rite exists = religious_head ` +
        `religious_head.faith = { ${any(p.faithIds.map(id => `this = faith:${id}`))} } }`;
    throw new Error('Unsupported familiarity predicate');
}
