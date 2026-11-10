import { PracticeContactRule, validateFamiliarityPredicate } from './familiarityRules';

export interface CultureContactRule {
    id: string;
    culture_roots: string[];
    exclude_cultures: string[];
    targets: string[];
    reason: string;
    grounding: string;
    /** An authored exact selector overrides the default inheritance policy. */
    match_parents?: boolean;
}
export interface LanguageRoutingData {
    routing_version: string;
    families: Record<string, string>;
    culture_parent_match: boolean;
    culture_rules: CultureContactRule[];
    practice_rules?: PracticeContactRule[];
}
export interface CultureFamiliarityFacts {
    currentCultureId?: string;
    parentCultureIds?: readonly string[];
    /** Complete current native-predicate results, never a remembered exposure list. */
    cultureFamiliarity?: { version: 1; complete: true; routingVersion: string; matchedRuleIds: string[] };
    /** Private current eligibility. It never augments known languages or leaves backend context. */
    practiceFamiliarity?: { version: 1; complete: true; routingVersion: string; matchedRuleIds: string[] };
}
export type ComprehensionFamily = readonly ['shared_family' | 'singleton_language' | 'unassigned_language', string];
export interface LanguageRoute {
    mode: 'CLEAR' | 'CLOSE' | 'FAR';
    reason: 'known_language' | 'language_family' | 'cultural_contact' | 'current_practice' | 'no_relationship';
    anchor?: string;
}
const safeId = /^[a-zA-Z0-9_.:-]+$/;
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 4096 &&
    value.every(id => typeof id === 'string' && safeId.test(id)) && new Set(value).size === value.length;

/** Sound palettes never establish comprehension. All contact links are direct and directional. */
export class LanguageRelations {
    readonly version: string;
    readonly cultureRules: readonly CultureContactRule[];
    readonly practiceRules: readonly PracticeContactRule[];
    readonly matchParents: boolean;
    private families = new Map<string, ComprehensionFamily>();
    private contacts = new Map<string, readonly CultureContactRule[]>();

    constructor(data: LanguageRoutingData) {
        if (!data || typeof data.routing_version !== 'string' || !safeId.test(data.routing_version) ||
            typeof data.culture_parent_match !== 'boolean' || !data.families || typeof data.families !== 'object' ||
            Array.isArray(data.families) || !Array.isArray(data.culture_rules) || data.culture_rules.length > 256)
            throw new Error('Invalid language routing document');
        this.version = data.routing_version; this.matchParents = data.culture_parent_match;
        const counts = new Map<string, number>();
        for (const [id, family] of Object.entries(data.families)) {
            if (!safeId.test(id) || typeof family !== 'string' || !safeId.test(family)) throw new Error('Invalid language family');
            counts.set(family, (counts.get(family) ?? 0) + 1);
        }
        for (const [id, family] of Object.entries(data.families))
            this.families.set(id, counts.get(family)! > 1 ? ['shared_family', family] : ['singleton_language', id]);
        if (!this.families.size || this.families.size > 4096) throw new Error('Invalid language family coverage');
        const seen = new Set<string>();
        this.cultureRules = Object.freeze(data.culture_rules.map(rule => {
            if (!rule || typeof rule.id !== 'string' || !safeId.test(rule.id) || seen.has(rule.id) ||
                !ids(rule.culture_roots) || !rule.culture_roots.length || !ids(rule.exclude_cultures) ||
                !ids(rule.targets) || !rule.targets.length || rule.targets.some(id => !this.families.has(id)) ||
                (rule.match_parents !== undefined && typeof rule.match_parents !== 'boolean') ||
                typeof rule.reason !== 'string' || !rule.reason || rule.grounding !== 'authored_gameplay_inference')
                throw new Error('Invalid cultural contact rule');
            seen.add(rule.id);
            return Object.freeze({ ...rule, culture_roots: [...rule.culture_roots],
                exclude_cultures: [...rule.exclude_cultures], targets: [...rule.targets] });
        }));
        if (data.practice_rules !== undefined && (!Array.isArray(data.practice_rules) || data.practice_rules.length > 256))
            throw new Error('Invalid practice familiarity rules');
        this.practiceRules = Object.freeze((data.practice_rules ?? []).map(rule => {
            if (!rule || typeof rule.id !== 'string' || !safeId.test(rule.id) || seen.has(rule.id) || !ids(rule.targets) || !rule.targets.length ||
                rule.targets.some(id => !this.families.has(id)) || typeof rule.reason !== 'string' || !rule.reason ||
                !['faith_ritual', 'faith_community', 'tradition', 'doctrine', 'training', 'institution', 'spell'].includes(rule.category) ||
                rule.grounding !== 'authored_gameplay_inference') throw new Error('Invalid practice familiarity rule');
            seen.add(rule.id);
            return Object.freeze({ ...rule, targets: [...rule.targets], predicate: validateFamiliarityPredicate(rule.predicate) });
        }));
        for (const language of this.families.keys())
            this.contacts.set(language, this.cultureRules.filter(rule => rule.targets.includes(language)));
    }

    family(language: string): ComprehensionFamily {
        return this.families.get(language) ?? ['unassigned_language', language];
    }
    languageIds(): string[] { return [...this.families.keys()]; }

    route(spoken: string, knownLanguages: Iterable<string>, facts: CultureFamiliarityFacts = {}): LanguageRoute {
        if (typeof knownLanguages === 'string') throw new Error('Language knowledge must be a collection');
        const known = new Set(knownLanguages);
        if (known.has(spoken)) return { mode: 'CLEAR', reason: 'known_language', anchor: spoken };
        const family = this.family(spoken);
        if (family[0] === 'shared_family') {
            for (const anchor of [...known].sort()) {
                const other = this.family(anchor);
                if (other[0] === family[0] && other[1] === family[1])
                    return { mode: 'CLOSE', reason: 'language_family', anchor };
            }
        }
        const observed = facts.cultureFamiliarity;
        if (observed && (observed.complete !== true || observed.version !== 1 || observed.routingVersion !== this.version ||
            !ids(observed.matchedRuleIds) || observed.matchedRuleIds.some(id => !this.cultureRules.some(rule => rule.id === id))))
            throw new Error('Incomplete or stale cultural familiarity');
        if (facts.parentCultureIds !== undefined && !ids(facts.parentCultureIds)) throw new Error('Invalid current culture ancestry');
        if (facts.currentCultureId !== undefined && !safeId.test(facts.currentCultureId)) throw new Error('Invalid current culture ID');
        const ancestry = new Set(facts.parentCultureIds ?? []);
        if (facts.currentCultureId) ancestry.add(facts.currentCultureId);
        for (const rule of this.contacts.get(spoken) ?? []) {
            const roots = (rule.match_parents ?? this.matchParents) ? ancestry
                : new Set(facts.currentCultureId ? [facts.currentCultureId] : []);
            const enabled = observed ? observed.matchedRuleIds.includes(rule.id)
                : rule.culture_roots.some(id => roots.has(id)) && !rule.exclude_cultures.some(id => ancestry.has(id));
            if (enabled) return { mode: 'CLOSE', reason: 'cultural_contact', anchor: rule.id };
        }
        const practice = facts.practiceFamiliarity;
        if (practice && (practice.complete !== true || practice.version !== 1 || practice.routingVersion !== this.version ||
            !ids(practice.matchedRuleIds) || practice.matchedRuleIds.some(id => !this.practiceRules.some(rule => rule.id === id))))
            throw new Error('Incomplete or stale practice familiarity');
        for (const rule of this.practiceRules)
            if (rule.targets.includes(spoken) && practice?.matchedRuleIds.includes(rule.id))
                return { mode: 'CLOSE', reason: 'current_practice', anchor: rule.id };
        return { mode: 'FAR', reason: 'no_relationship' };
    }
}
