import { createHash } from 'crypto';
import type { CharacterLanguageKnowledge, ComprehensionMode } from './languageRouting';
import { LanguageRelations } from './languageRelations';
import { studyGain, validateStudyProgress } from '../../shared/gameData/LanguageStudy';

/** Versioned separately from sound banks. Old delivered hearings never change. */
export const MASK_VERSION = 'votc-mask-learning-v2';
export const COMPREHENSION_CURVES = Object.freeze({ scale: 25,
    mutual: Object.freeze({ floor: 70, width: 28 }), recognition: Object.freeze({ floor: 25, width: 45 }),
    production: Object.freeze({ floor: 15, width: 35 }) });
export type ComprehensionBelt = 'clear' | 'mutual' | 'recognition' | 'assisted' | 'far' | 'study';
export interface ComprehensionPlan {
    version: typeof MASK_VERSION;
    mode: ComprehensionMode;
    belt: ComprehensionBelt;
    cutoff: number;
    owner?: string;
    language?: string;
    /** Frozen study contribution; never consulted again after delivery. */
    studyProgress?: number;
    /** An independent, already available speaker-owned vocabulary must survive listener study. */
    assistance?: { owner: string; language: string; cutoff: number };
}

export function canonicalCharacterId(value: unknown): string {
    const raw = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? String(value) : typeof value === 'bigint' && value >= BigInt(0) ? String(value)
        : typeof value === 'string' ? value.trim() : '';
    if (!/^\d+$/.test(raw)) throw new Error('Missing or unsafe comprehension owner');
    return raw.replace(/^0+(?=\d)/, '');
}
export function normalizeMaskWord(word: string): string {
    return word.normalize('NFKC').toLowerCase().replace(/[‘’]/g, "'");
}
/** Full 32-bit resolution permits fractional cutoffs; no locale or partner in the key. */
export function maskPercent(owner: unknown, language: string, word: string): number {
    if (!/^language_[a-zA-Z0-9_]+$/.test(language)) throw new Error('Invalid familiarity language');
    return createHash('sha256').update(JSON.stringify([MASK_VERSION, canonicalCharacterId(owner), language,
        normalizeMaskWord(word)]), 'utf8').digest().readUInt32BE(0) / 4294967296 * 100;
}
export function learningCurve(learning: number, belt: 'mutual' | 'recognition' | 'production'): number {
    if (!Number.isFinite(learning) || learning < 0) throw new Error('Missing current Learning');
    const gain = -Math.expm1(-Math.min(100, learning) / COMPREHENSION_CURVES.scale), curve = COMPREHENSION_CURVES[belt];
    return curve.floor + curve.width * gain;
}
const known = (actor: CharacterLanguageKnowledge): string[] =>
    [...new Set([actor.nativeLanguageId, ...actor.learnedLanguageIds])].sort();
const route = (language: string, actor: CharacterLanguageKnowledge, relations: LanguageRelations) =>
    relations.route(language, known(actor), actor).mode;

/** Intrinsic relations are evaluated once. Assistance never becomes knowledge or an anchor. */
function baseComprehensionPlan(spoken: string, listener: CharacterLanguageKnowledge, relations: LanguageRelations,
    speaker?: CharacterLanguageKnowledge, addressed = false): ComprehensionPlan {
    const mode = route(spoken, listener, relations);
    if (mode === 'CLEAR') return { version: MASK_VERSION, mode, belt: 'clear', cutoff: 100 };
    const far: ComprehensionPlan = { version: MASK_VERSION, mode, belt: 'far', cutoff: 0 };
    try {
        const listenerLearning = learningCurve(listener.learning!, 'recognition');
        if (mode === 'CLOSE') {
            const mutual = !!speaker && known(listener).some(language => route(language, speaker, relations) === 'CLOSE');
            return { version: MASK_VERSION, mode, belt: mutual ? 'mutual' : 'recognition',
                cutoff: mutual ? learningCurve(listener.learning!, 'mutual') : listenerLearning,
                owner: canonicalCharacterId(listener.characterId), language: spoken };
        }
        if (!speaker || !addressed) return far;
        // Keep any established productive vocabulary before considering a new study-only bridge.
        // Otherwise beginning an alphabetically earlier tongue could remove words already understood.
        const listenerLanguages = known(listener);
        const bridge = listenerLanguages.find(language => route(language, speaker, relations) === 'CLOSE') ??
            listenerLanguages.find(language => route(language, speaker, relations) === 'FAR' &&
                languageStudyFraction(speaker, language, relations) > 0);
        if (!bridge) return far;
        const production = learningCurve(speaker.learning!, 'production');
        // Productive fragments are a subset of the accommodating speaker's receptive vocabulary.
        // Listener aptitude can use only what this speaker can actually offer.
        return { version: MASK_VERSION, mode, belt: 'assisted',
            cutoff: Math.min(studyGain(route(bridge, speaker, relations) === 'CLOSE'
                ? production : 0, languageStudyFraction(speaker, bridge, relations)), listenerLearning),
            owner: canonicalCharacterId(speaker.characterId), language: bridge };
    } catch { return far; } // No invented character, language or Learning value.
}

export function languageStudyFraction(actor: CharacterLanguageKnowledge, language: string, relations: LanguageRelations): number {
    const progress = actor.studyProgress ? validateStudyProgress(actor.studyProgress) : {};
    let best = progress[language] ?? 0;
    const family = relations.family(language);
    if (family[0] === 'shared_family') for (const [studied, peak] of Object.entries(progress)) {
        const other = relations.family(studied);
        if (studied !== language && other[0] === 'shared_family' && other[1] === family[1]) best = Math.max(best, peak / 2);
    }
    return best;
}

export function comprehensionPlan(spoken: string, listener: CharacterLanguageKnowledge, relations: LanguageRelations,
    speaker?: CharacterLanguageKnowledge, addressed = false): ComprehensionPlan {
    const base = baseComprehensionPlan(spoken, listener, relations, speaker, addressed);
    if (base.belt === 'clear') return base;
    const progress = languageStudyFraction(listener, spoken, relations);
    if (!progress) return base;
    // Require the same complete current Learning/owner facts as every other partial hearing.
    if (!Number.isFinite(listener.learning) || listener.learning! < 0) return base;
    const owner = canonicalCharacterId(listener.characterId);
    if (base.belt === 'mutual' || base.belt === 'recognition')
        return { ...base, cutoff: studyGain(base.cutoff, progress), studyProgress: progress };
    return { version: MASK_VERSION, mode: 'CLOSE', belt: 'study', owner, language: spoken,
        cutoff: studyGain(0, progress), studyProgress: progress,
        ...(base.belt === 'assisted' ? { assistance: { owner: base.owner!, language: base.language!, cutoff: base.cutoff } } : {}) };
}

/** Expected encoder fraction for selection, never a promise about sentence readability. */
export function comprehensionPercent(plan: ComprehensionPlan): number {
    return plan.assistance ? studyGain(plan.cutoff, plan.assistance.cutoff / 100) : plan.cutoff;
}

export function validateComprehensionPlan(value: unknown): ComprehensionPlan {
    const p = value as ComprehensionPlan;
    if (!p || p.version !== MASK_VERSION || !['CLEAR', 'CLOSE', 'FAR'].includes(p.mode) ||
        !['clear', 'mutual', 'recognition', 'assisted', 'far', 'study'].includes(p.belt) ||
        !Number.isFinite(p.cutoff) || p.cutoff < 0 || p.cutoff > 100 ||
        (p.belt === 'clear' && (p.mode !== 'CLEAR' || p.cutoff !== 100)) ||
        (p.belt === 'far' && (p.mode === 'CLEAR' || p.cutoff !== 0)) ||
        (['mutual', 'recognition', 'study'].includes(p.belt) && p.mode !== 'CLOSE') ||
        (p.belt === 'assisted' && p.mode !== 'FAR')) throw new Error('Invalid frozen comprehension plan');
    if (!['clear', 'far'].includes(p.belt) &&
        (canonicalCharacterId(p.owner) !== p.owner || typeof p.language !== 'string' || !/^language_[a-zA-Z0-9_]+$/.test(p.language)))
        throw new Error('Invalid frozen comprehension vocabulary');
    if ((p.belt === 'study' && p.studyProgress === undefined) ||
        (p.studyProgress !== undefined && (!['mutual', 'recognition', 'study'].includes(p.belt) ||
            !Number.isFinite(p.studyProgress) || p.studyProgress <= 0 || p.studyProgress > 1)) ||
        (p.belt === 'study' && p.cutoff !== studyGain(0, p.studyProgress!)))
        throw new Error('Invalid frozen study progress');
    if (p.assistance && (p.belt !== 'study' || canonicalCharacterId(p.assistance.owner) !== p.assistance.owner ||
        typeof p.assistance.language !== 'string' || !/^language_[a-zA-Z0-9_]+$/.test(p.assistance.language) ||
        !Number.isFinite(p.assistance.cutoff) || p.assistance.cutoff <= 0 || p.assistance.cutoff > 100))
        throw new Error('Invalid frozen study assistance');
    return p;
}
