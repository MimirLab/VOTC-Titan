/** Sparse observed scheme progress, normalized to the fraction 0..1. Never fluent knowledge. */
export type LanguageStudyProgress = Record<string, number>;

export function validateStudyProgress(value: unknown): LanguageStudyProgress {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Invalid language study progress');
    const entries = Object.entries(value);
    if (entries.length > 4096 || entries.some(([language, progress]) => !/^language_[a-zA-Z0-9_]+$/.test(language) ||
        typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 1))
        throw new Error('Invalid language study progress');
    return Object.fromEntries(entries);
}

export function studyGain(base: number, progress: number): number {
    if (!Number.isFinite(base) || base < 0 || base > 100 || !Number.isFinite(progress) || progress < 0 || progress > 1)
        throw new Error('Invalid study gain');
    return base + (100 - base) * progress;
}
