import { LanguageRelations, LanguageRoutingData, ComprehensionFamily } from './languageRelations';
export type CloseRule = readonly [pattern: string, replacement: string];
export interface CloseProfileData {
    close_version: string;
    source_locale: string;
    profiles: Record<string, { label: string; signature: string; rules: CloseRule[]; cadence_rules?: CloseRule[] }>;
}
export interface CompiledCloseRule { regex: RegExp; replacement: string; order: number; cadence?: true }

/** Minimum consumed width for the small authored regex grammar, including assertions.
 * Probing example strings alone misses zero-width rules such as (?=zz).
 */
function minimumWidth(pattern: string): number {
    let index = 0;
    const expression = (): number => {
        let width = 0, minimum = Infinity;
        while (index < pattern.length && pattern[index] !== ')') {
            if (pattern[index] === '|') { minimum = Math.min(minimum, width); width = 0; index++; continue; }
            let term = 1;
            const char = pattern[index++];
            if (char === '^' || char === '$') term = 0;
            else if (char === '\\') {
                const escaped = pattern[index++];
                if ('bB123456789'.includes(escaped)) term = 0;
                else if (escaped === 'x') index += 2;
                else if (escaped === 'u') index += 4;
            } else if (char === '[') {
                while (index < pattern.length && pattern[index] !== ']') {
                    if (pattern[index] === '\\') index++;
                    index++;
                }
                index++;
            } else if (char === '(') {
                let assertion = false;
                if (pattern[index] === '?') {
                    if (pattern.slice(index, index + 2) === '?:') index += 2;
                    else if (/^\?[=!]/.test(pattern.slice(index))) { index += 2; assertion = true; }
                    else if (/^\?<([=!])/.test(pattern.slice(index))) { index += 3; assertion = true; }
                    else throw new Error('Unsupported CLOSE regex group');
                }
                const child = expression();
                if (pattern[index++] !== ')') throw new Error('Invalid CLOSE regex group');
                term = assertion ? 0 : child;
            }
            const quantifier = pattern[index];
            if (quantifier === '*' || quantifier === '?') { term = 0; index++; }
            else if (quantifier === '+') index++;
            else if (quantifier === '{') {
                const match = /^\{(\d+)(?:,\d*)?\}/.exec(pattern.slice(index));
                if (!match) throw new Error('Unsupported CLOSE regex quantifier');
                term *= Number(match[1]); index += match[0].length;
            }
            if (pattern[index] === '?' && ['*', '?', '+', '{'].includes(quantifier)) index++;
            width += term;
        }
        return Math.min(minimum, width);
    };
    const result = expression();
    if (index !== pattern.length) throw new Error('Invalid CLOSE regex expression');
    return result;
}

function compile(value: unknown, order: number): CompiledCloseRule {
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' ||
        typeof value[1] !== 'string' || !value[0] || value[0].length > 128 || !/^[A-Za-z]{1,8}$/.test(value[1]))
        throw new Error('Invalid CLOSE pattern/replacement');
    const regex = new RegExp(value[0], 'gi');
    if (minimumWidth(value[0]) === 0) throw new Error('CLOSE rules must consume source letters');
    for (const probe of ['', 'a', 'the', 'abcdefghijklmnopqrstuvwxyz']) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(probe)) !== null) {
            if (!match[0].length) throw new Error('CLOSE rules must consume source letters');
        }
    }
    return { regex, replacement: value[1], order };
}

/** Every spoken tongue owns a readable bank, including singleton comprehension families. */
export class CloseProfiles {
    readonly version: string;
    readonly sourceLocale: string;
    readonly routing: LanguageRelations;
    private readonly resolved = new Map<string, readonly CompiledCloseRule[]>();

    constructor(data: CloseProfileData, routing: LanguageRoutingData | LanguageRelations) {
        if (!data || typeof data.close_version !== 'string' || !data.close_version || data.source_locale !== 'en' ||
            !data.profiles || typeof data.profiles !== 'object' || Array.isArray(data.profiles))
            throw new Error('Invalid CLOSE profile document');
        this.version = data.close_version; this.sourceLocale = data.source_locale;
        this.routing = routing instanceof LanguageRelations ? routing : new LanguageRelations(routing);
        for (const [language, profile] of Object.entries(data.profiles)) {
            if (!/^[a-zA-Z0-9_.:-]+$/.test(language) || !profile || typeof profile.label !== 'string' || !profile.label ||
                typeof profile.signature !== 'string' || !profile.signature || !Array.isArray(profile.rules) ||
                !profile.rules.length || profile.rules.length > 64) throw new Error('Invalid CLOSE voice profile');
            if (profile.cadence_rules !== undefined && (!Array.isArray(profile.cadence_rules) || profile.cadence_rules.length > 16))
                throw new Error('Invalid CLOSE cadence rules');
            const cadence = (profile.cadence_rules ?? []).map((rule, index) => ({ ...compile(rule, index), cadence: true as const }));
            this.resolved.set(language, [...cadence, ...profile.rules.map(compile)]);
        }
        const coverage = this.coverage(this.routing.languageIds());
        if (coverage.unlisted.length || coverage.unused.length) throw new Error('CLOSE profiles must cover every routed language exactly');
    }
    family(language: string): ComprehensionFamily { return this.routing.family(language); }
    rules(language: string): readonly CompiledCloseRule[] {
        const rules = this.resolved.get(language);
        if (!rules) throw new Error(`No CLOSE profile for ${language}`);
        return rules;
    }
    coverage(languageIds: Iterable<string>): { unlisted: string[]; unused: string[] } {
        const actual = new Set(languageIds);
        return { unlisted: [...actual].filter(id => !this.resolved.has(id)).sort(),
            unused: [...this.resolved.keys()].filter(id => !actual.has(id)).sort() };
    }
}
