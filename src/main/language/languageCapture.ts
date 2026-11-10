import { createHash } from 'crypto';
import { CultureCatalog } from '../culture/cultureCatalog';
import { LanguageSnapshot, validateLanguageSnapshot } from '../../shared/gameData/LanguageSnapshot';
import { CultureContactRule, LanguageRelations } from './languageRelations';
import { PracticeContactRule, familiarityPredicateBody } from './familiarityRules';
import { inlineLanguageStudyCapture } from './languageStudyScript';

export interface LanguageCaptureCatalog {
    digest: string; languageIds: string[];
    captureLearning?: true;
    captureStudy?: true;
    routingVersion?: string; cultureRules?: readonly CultureContactRule[]; matchParents?: boolean;
    practiceRules?: readonly PracticeContactRule[];
    /** Effective native trait definitions; unavailable imported selectors remain dormant. */
    availableTraitIds?: readonly string[];
}
export function languageCaptureCatalog(culture: CultureCatalog, routing?: LanguageRelations,
    availableTraitIds?: readonly string[]): LanguageCaptureCatalog | undefined {
    if (availableTraitIds && (availableTraitIds.length > 4096 ||
        availableTraitIds.some(id => !/^[a-zA-Z0-9_]+$/.test(id)) || new Set(availableTraitIds).size !== availableTraitIds.length))
        throw new Error('Invalid effective trait catalogue');
    const languageIds = [...new Set(culture.facts.filter(fact => fact.kind === 'pillar' && fact.category === 'language').map(fact => fact.key))].sort();
    if (!languageIds.includes('language_common') || !languageIds.includes('language_orcish')) return;
    if (languageIds.length > 4096 || languageIds.some(id => !/^[a-zA-Z0-9_.:-]+$/.test(id)))
        throw new Error('Invalid effective language catalogue');
    const contact = routing ? { routingVersion: routing.version, cultureRules: routing.cultureRules,
        matchParents: routing.matchParents, practiceRules: routing.practiceRules,
        ...(availableTraitIds ? { availableTraitIds: [...availableTraitIds].sort() } : {}) } : {};
    return { languageIds, captureLearning: true, captureStudy: true, ...contact,
        digest: createHash('sha256').update(JSON.stringify({ languageIds, captureLearning: true, captureStudy: true, ...contact })).digest('hex') };
}

/** Observe only this participant, then emit saved peaks with literal digits rather than TopScope localization. */
function studyCaptureBody(catalog: LanguageCaptureCatalog): string {
    if (!catalog.captureStudy) return '';
    return inlineLanguageStudyCapture(catalog.languageIds);
}

/** Native GoA ancestry is queried now; no static parent table or race-name inference. */
function culturalContactBody(catalog: LanguageCaptureCatalog): string {
    const ancestry = (id: string) => `is_culture_or_parent_culture_trigger = { CULTURE = culture:${id} }`;
    return (catalog.cultureRules ?? []).map(rule =>
        `culture = {\nif = { limit = { OR = { ${rule.culture_roots.map(id =>
            (rule.match_parents ?? catalog.matchParents) ? ancestry(id) : `this = culture:${id}`).join(' ')} }` +
        (rule.exclude_cultures.length ? ` NOT = { OR = { ${rule.exclude_cultures.map(ancestry).join(' ')} } }` : '') +
        ` } debug_log = "VOTC:LANGUAGE/;/contact/;/${rule.id}/;/1" }\n` +
        `else = { debug_log = "VOTC:LANGUAGE/;/contact/;/${rule.id}/;/0" }\n}`).join('\n');
}

/** Existing participant bridge. Study updates only its sparse Titan save metadata; no CK3/GoA files change. */
export function languageCaptureBody(catalog: LanguageCaptureCatalog): string {
    const traits = catalog.availableTraitIds ? new Set(catalog.availableTraitIds) : undefined;
    return `debug_log = "VOTC:LANGUAGE/;/begin/;/[THIS.Char.GetID]/;/${catalog.digest}"\n` +
        (catalog.captureLearning ? `debug_log = "VOTC:LANGUAGE/;/learning/;/[THIS.Char.GetSkill('learning')|0]"\n` : '') +
        'culture = {\n' + catalog.languageIds.map(id =>
            `if = { limit = { has_cultural_pillar = ${id} } debug_log = "VOTC:LANGUAGE/;/native/;/${id}" }`).join('\n') + '\n}\n' +
        catalog.languageIds.map(id => `if = { limit = { knows_language = ${id} } debug_log = "VOTC:LANGUAGE/;/known/;/${id}/;/1" }\n` +
            `else = { debug_log = "VOTC:LANGUAGE/;/known/;/${id}/;/0" }`).join('\n') + '\n' + studyCaptureBody(catalog) +
        '\n' + culturalContactBody(catalog) + '\n' + (catalog.practiceRules ?? []).map(rule =>
            `if = { limit = { ${familiarityPredicateBody(rule.predicate, traits)} } debug_log = "VOTC:LANGUAGE/;/practice/;/${rule.id}/;/1" }\n` +
            `else = { debug_log = "VOTC:LANGUAGE/;/practice/;/${rule.id}/;/0" }`).join('\n') + '\ndebug_log = "VOTC:LANGUAGE/;/end"\n';
}

export class LanguageLogReader {
    private frame?: { characterId: number; learning?: number; native: string[]; known: Map<string, boolean>;
        contacts: Map<string, boolean>; practices: Map<string, boolean>; study: Record<string, number>;
        studyComplete?: true; pendingStudy?: { language: string; digits: Map<number, number> } };
    private observations = new Map<number, { snapshot: LanguageSnapshot; receivedAt: number }>();
    constructor(readonly catalog: LanguageCaptureCatalog, private readonly now = () => Date.now()) {}
    clear(): void { this.frame = undefined; this.observations.clear(); }
    observe(line: string): void {
        if (line.includes('VOTC:CAMPAIGN/;/loaded/;/')) { this.clear(); return; }
        const marker = line.indexOf('VOTC:LANGUAGE/;/'); if (marker < 0) return;
        const parts = line.slice(marker).trim().split('/;/');
        if (parts[1] === 'begin') {
            const id = Number(parts[2]);
            const validId = /^\d+$/.test(parts[2] ?? '') && Number.isSafeInteger(id) && id >= 0;
            if (validId) this.observations.delete(id);
            this.frame = validId && parts.length === 4 && parts[3] === this.catalog.digest
                ? { characterId: id, native: [], known: new Map(), contacts: new Map(), practices: new Map(), study: {} } : undefined;
            return;
        }
        const frame = this.frame; if (!frame) return;
        if (parts[1] === 'learning') {
            if (!this.catalog.captureLearning || parts.length !== 3 || frame.learning !== undefined ||
                !/^\d+$/.test(parts[2]) || !Number.isSafeInteger(Number(parts[2]))) { this.frame = undefined; return; }
            frame.learning = Number(parts[2]);
        } else if (parts[1] === 'native') {
            if (parts.length !== 3 || !this.catalog.languageIds.includes(parts[2])) { this.frame = undefined; return; }
            frame.native.push(parts[2]);
        } else if (parts[1] === 'known') {
            if (parts.length !== 4 || !this.catalog.languageIds.includes(parts[2]) || frame.known.has(parts[2]) || !['0', '1'].includes(parts[3])) {
                this.frame = undefined; return;
            }
            frame.known.set(parts[2], parts[3] === '1');
        } else if (parts[1] === 'contact') {
            if (parts.length !== 4 || !(this.catalog.cultureRules ?? []).some(rule => rule.id === parts[2]) ||
                frame.contacts.has(parts[2]) || !['0', '1'].includes(parts[3])) { this.frame = undefined; return; }
            frame.contacts.set(parts[2], parts[3] === '1');
        } else if (parts[1] === 'practice') {
            if (parts.length !== 4 || !(this.catalog.practiceRules ?? []).some(rule => rule.id === parts[2]) ||
                frame.practices.has(parts[2]) || !['0', '1'].includes(parts[3])) { this.frame = undefined; return; }
            frame.practices.set(parts[2], parts[3] === '1');
        } else if (parts[1] === 'study_begin') {
            if (!this.catalog.captureStudy || parts.length !== 3 || !this.catalog.languageIds.includes(parts[2]) ||
                frame.studyComplete || frame.pendingStudy) { this.frame = undefined; return; }
            frame.pendingStudy = { language: parts[2], digits: new Map() };
        } else if (parts[1] === 'study_digit') {
            const study = frame.pendingStudy;
            if (parts.length !== 4 || !study || !/^[0-4]$/.test(parts[2]) || !/^[0-9]$/.test(parts[3]) ||
                study.digits.has(Number(parts[2]))) { this.frame = undefined; return; }
            study.digits.set(Number(parts[2]), Number(parts[3]));
        } else if (parts[1] === 'study_end') {
            const study = frame.pendingStudy;
            if (parts.length !== 2 || !study || study.digits.size !== 5) { this.frame = undefined; return; }
            const progress = [...study.digits].reduce((sum, [position, digit]) => sum + digit * 10 ** position, 0) / 10000;
            if (progress > 1) { this.frame = undefined; return; }
            frame.study[study.language] = Math.max(frame.study[study.language] ?? 0, progress);
            delete frame.pendingStudy;
        } else if (parts[1] === 'study_complete') {
            if (!this.catalog.captureStudy || parts.length !== 2 || frame.studyComplete || frame.pendingStudy) {
                this.frame = undefined; return;
            }
            frame.studyComplete = true;
        } else if (parts[1] === 'end') {
            this.frame = undefined;
            if (parts.length !== 2 || frame.native.length !== 1 || frame.known.size !== this.catalog.languageIds.length ||
                (this.catalog.captureLearning && frame.learning === undefined) ||
                (this.catalog.captureStudy && !frame.studyComplete) || frame.pendingStudy ||
                frame.contacts.size !== (this.catalog.cultureRules?.length ?? 0) ||
                frame.practices.size !== (this.catalog.practiceRules?.length ?? 0)) return;
            try {
                const snapshot = validateLanguageSnapshot({ version: 1, complete: true, nativeLanguageId: frame.native[0],
                    ...(frame.learning !== undefined ? { learning: frame.learning } : {}),
                    ...(this.catalog.captureStudy ? { studyProgress: frame.study } : {}),
                    knownLanguageIds: [...new Set([frame.native[0], ...[...frame.known].filter(([, known]) => known).map(([id]) => id)])],
                    ...(this.catalog.routingVersion ? { cultureFamiliarity: { version: 1, complete: true,
                        routingVersion: this.catalog.routingVersion,
                        matchedRuleIds: [...frame.contacts].filter(([, matches]) => matches).map(([id]) => id) },
                        ...(this.catalog.practiceRules?.length ? { practiceFamiliarity: { version: 1, complete: true,
                            routingVersion: this.catalog.routingVersion,
                            matchedRuleIds: [...frame.practices].filter(([, matches]) => matches).map(([id]) => id) } } : {}) } : {}) });
                this.observations.set(frame.characterId, { snapshot, receivedAt: this.now() });
            } catch { /* Incomplete/contradictory observations never establish comprehension. */ }
        } else this.frame = undefined;
    }
    snapshot(characterId: number): LanguageSnapshot | undefined {
        const entry = this.observations.get(characterId);
        const age = entry ? this.now() - entry.receivedAt : Infinity;
        return entry && age >= 0 && age <= 15000 ? entry.snapshot : undefined;
    }
}
