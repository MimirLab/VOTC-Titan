import { CloseProfiles } from './closeProfiles';
import { CultureFamiliarityFacts, LanguageRelations } from './languageRelations';
import { comprehensionPlan, comprehensionPercent } from './comprehension';
import type { LanguageStudyProgress } from '../../shared/gameData/LanguageStudy';

export type ComprehensionMode = 'CLEAR' | 'CLOSE' | 'FAR';
/** Missing settings keep the existing default; only an explicit off switch bypasses new speech. */
export function languageRoutingEnabled(config?: { languageRoutingEnabled?: boolean }): boolean {
    return config?.languageRoutingEnabled !== false;
}
export interface CharacterLanguageKnowledge extends CultureFamiliarityFacts {
    characterId?: number | string;
    learning?: number;
    studyProgress?: LanguageStudyProgress;
    nativeLanguageId: string;
    learnedLanguageIds: readonly string[];
    selectedLanguageId?: string;
}

export function knownLanguages(character: CharacterLanguageKnowledge): string[] {
    if (!character.nativeLanguageId || !Array.isArray(character.learnedLanguageIds) ||
        character.learnedLanguageIds.some(id => typeof id !== 'string' || !id))
        throw new Error('Complete native and learned language knowledge is required');
    return [...new Set([character.nativeLanguageId, ...character.learnedLanguageIds])];
}

export function selectSpokenLanguage(speaker: CharacterLanguageKnowledge, recipient?: CharacterLanguageKnowledge,
    explicitChoice?: string, preference: readonly string[] = [], relations?: LanguageRelations): string {
    const available = knownLanguages(speaker);
    if (explicitChoice !== undefined) {
        if (!available.includes(explicitChoice)) throw new Error('Speaker does not know the explicitly selected language');
        return explicitChoice;
    }
    if (speaker.selectedLanguageId !== undefined && !available.includes(speaker.selectedLanguageId))
        throw new Error('Speaker does not know the selected default language');
    if (recipient) {
        const understood = new Set(knownLanguages(recipient));
        const order = [...new Set([...preference, speaker.nativeLanguageId, ...available.slice().sort()])];
        const shared = order.find(id => available.includes(id) && understood.has(id));
        if (shared) return shared;
        if (relations) {
            const ranked = order.filter(id => available.includes(id)).map(id => ({ id,
                plan: comprehensionPlan(id, recipient, relations, speaker, true) }));
            ranked.sort((a, b) => {
                const rank = (mode: ComprehensionMode) => mode === 'CLEAR' ? 2 : mode === 'CLOSE' ? 1 : 0;
                return rank(b.plan.mode) - rank(a.plan.mode) || comprehensionPercent(b.plan) - comprehensionPercent(a.plan);
            });
            if (ranked.length && (ranked[0].plan.mode !== 'FAR' || ranked[0].plan.cutoff > 0)) return ranked[0].id;
        }
    }
    return speaker.selectedLanguageId ?? speaker.nativeLanguageId;
}

export function resolveMode(spokenLanguage: string, listenerKnownLanguages: Iterable<string>, profiles: CloseProfiles,
    facts: CultureFamiliarityFacts = {}): ComprehensionMode {
    return profiles.routing.route(spokenLanguage, listenerKnownLanguages, facts).mode;
}
