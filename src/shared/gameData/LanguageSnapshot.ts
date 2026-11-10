import { LanguageStudyProgress, validateStudyProgress } from './LanguageStudy';

/** A complete observed native/learned set. Culture/race names do not establish knowledge. */
export interface LanguageSnapshot {
    version: 1;
    complete: true;
    nativeLanguageId: string;
    knownLanguageIds: string[];
    /** Current effective CK3 skill, captured in the same owned frame. */
    learning?: number;
    /** Sparse current/saved study peaks, observed from the character in this loaded save. */
    studyProgress?: LanguageStudyProgress;
    /** Current culture/parent predicates evaluated by CK3 in this same encounter frame. */
    cultureFamiliarity?: { version: 1; complete: true; routingVersion: string; matchedRuleIds: string[] };
    /** Current faith/practice eligibility; never a fluent-language or publicly readable fact. */
    practiceFamiliarity?: { version: 1; complete: true; routingVersion: string; matchedRuleIds: string[] };
}

export function validateLanguageSnapshot(value: unknown): LanguageSnapshot {
    const data = value as Partial<LanguageSnapshot> | undefined;
    if (!data || data.version !== 1 || data.complete !== true || typeof data.nativeLanguageId !== 'string' ||
        !data.nativeLanguageId || !Array.isArray(data.knownLanguageIds) || data.knownLanguageIds.length > 4096 ||
        data.knownLanguageIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_.:-]+$/.test(id)) ||
        new Set(data.knownLanguageIds).size !== data.knownLanguageIds.length ||
        !data.knownLanguageIds.includes(data.nativeLanguageId) ||
        (data.learning !== undefined && (!Number.isSafeInteger(data.learning) || data.learning < 0)))
        throw new Error('Incomplete character language snapshot');
    for (const familiarity of [data.cultureFamiliarity, data.practiceFamiliarity]) {
        if (familiarity && (familiarity.version !== 1 || familiarity.complete !== true ||
            typeof familiarity.routingVersion !== 'string' || !/^[a-zA-Z0-9_.:-]+$/.test(familiarity.routingVersion) ||
            !Array.isArray(familiarity.matchedRuleIds) || familiarity.matchedRuleIds.length > 256 ||
            familiarity.matchedRuleIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_.:-]+$/.test(id)) ||
            new Set(familiarity.matchedRuleIds).size !== familiarity.matchedRuleIds.length))
            throw new Error('Incomplete current familiarity snapshot');
    }
    return { version: 1, complete: true, nativeLanguageId: data.nativeLanguageId, knownLanguageIds: [...data.knownLanguageIds],
        ...(data.learning !== undefined ? { learning: data.learning } : {}),
        ...(data.studyProgress !== undefined ? { studyProgress: validateStudyProgress(data.studyProgress) } : {}),
        ...(data.cultureFamiliarity ? { cultureFamiliarity: { ...data.cultureFamiliarity, matchedRuleIds: [...data.cultureFamiliarity.matchedRuleIds] } } : {}),
        ...(data.practiceFamiliarity ? { practiceFamiliarity: { ...data.practiceFamiliarity, matchedRuleIds: [...data.practiceFamiliarity.matchedRuleIds] } } : {}) };
}
