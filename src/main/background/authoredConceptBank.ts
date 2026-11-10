import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CultureFact, CultureSnapshot, validateCultureSnapshot } from '../../shared/gameData/CultureSnapshot';
import { FaithFact, FaithSnapshot, validateFaithSnapshot } from '../../shared/gameData/FaithSnapshot';
import { canonicalJsonStringify, sha256Hex } from '../promptWorkbench/canonicalJson';

export type ConceptDomain = 'culture' | 'faith';
export type ConceptStatus = 'authored' | 'excluded' | 'needs_review';
export interface AuthoredConceptEntry {
    domain: ConceptDomain;
    key: string;
    definitionHash: string;
    status: ConceptStatus;
    label: string;
    description: string;
    tags: readonly string[];
    /** Editorial evidence only. Never exposed by project() or generatorConcepts(). */
    rationale: string;
}
export interface ConditionalConceptReading {
    id: string;
    domain: ConceptDomain;
    conceptKey: string;
    definitionHash: string;
    label: string;
    description: string;
    requires: {
        concept: string;
        otherConceptsAllOf?: readonly string[];
        heritageAnyOf?: readonly string[];
        /** Dormant until authoritative domain-local evidence has a reviewed adapter. */
        currentInterpretationContextAllOf?: readonly string[];
    };
    contributorDefinitionHashes: Readonly<Record<string, string>>;
    /** A heritage key alone cannot establish an unchanged interpretation in an overhaul. */
    heritageDefinitionHashes?: Readonly<Record<string, string>>;
    replaces: 'this_concept_reading_only';
    guard: string;
    handbookEntries: readonly number[];
    evidenceBasis: string;
}
/** Internal selection identity for source-bound compression; not a provider payload. */
export interface ResolvedAuthoredConcept {
    key: string;
    definitionHash: string;
    /** Null identifies the portable reading, without reserving a possible variant ID. */
    readingId: string | null;
    label: string;
    description: string;
}
type Fact = CultureFact | FaithFact;
type Snapshot = CultureSnapshot | FaithSnapshot;
/** Explicit opt-in for a reviewed domain-local evidence adapter; no bundled default. */
export type InterpretationContextResolver = (domain: ConceptDomain, snapshot: Snapshot) => readonly string[];
// Provenance stays in memory, never in model prose or canonical source rules.
// Recheck bytes so mutating a projected fact cannot retain trusted authorship.
const authoredViews = new WeakMap<Fact, string>();
export function isAuthoredConceptReading(fact: Fact): boolean {
    return authoredViews.get(fact) === canonicalJsonStringify(fact);
}
export interface ConceptIssue {
    key: string;
    reason: 'missing' | 'definition_mismatch' | 'needs_review' | 'faith_excluded' | 'conditional_conflict';
}
export class AuthoredConceptUnavailable extends Error {
    constructor(public readonly domain: ConceptDomain, public readonly issues: readonly ConceptIssue[]) {
        super('Authored ' + domain + ' concepts unavailable: ' + issues.map(i => i.key + ' (' + i.reason + ')').join(', '));
        this.name = 'AuthoredConceptUnavailable';
    }
}

/** Fingerprints retain original names, descriptions and every parsed rule. */
export function conceptDefinitionHash(domain: ConceptDomain, fact: Fact): string {
    let rules: unknown = fact.rules;
    try { rules = JSON.parse(fact.rules); } catch { /* Opaque source remains part of identity. */ }
    return sha256Hex(canonicalJsonStringify({ domain, kind: fact.kind, key: fact.key,
        category: 'category' in fact ? fact.category : '', name: fact.name,
        description: fact.description, rules }));
}

/** Tenet membership must not depend on a readable original localization. */
function isConcept(domain: ConceptDomain, fact: Fact): boolean {
    if (domain === 'culture') return fact.kind === 'tradition';
    if (fact.kind !== 'doctrine') return false;
    // An unclassified tenet-like key must be held rather than leaking its prose
    // as an ordinary doctrine. Captured group metadata identifies custom keys.
    if (fact.key.startsWith('tenet_')) return true;
    let rules: any;
    try { rules = JSON.parse(fact.rules); } catch { return false; }
    return Array.isArray(rules.definitions) && rules.definitions.some((d: any) =>
        d.key === 'group_rules' && Array.isArray(d.value) &&
        d.value.some((r: any) => r.key === 'category' && r.value === 'core_tenets'));
}

function normalizedHeritage(domain: ConceptDomain, snapshot: Snapshot, keys?: readonly string[]): string[] {
    if (domain !== 'culture' || !keys?.length) return [];
    return snapshot.facts.filter(f => f.kind === 'pillar' && 'category' in f && f.category === 'heritage' &&
        keys.includes(f.key)).map(f => f.key).sort();
}

/** Logical refinement, not predicate count or authoring file order. */
function refines(a: ConditionalConceptReading, b: ConditionalConceptReading): boolean {
    const includes = (all: readonly string[] = [], required: readonly string[] = []) => required.every(k => all.includes(k));
    if (!includes(a.requires.otherConceptsAllOf, b.requires.otherConceptsAllOf) ||
        !includes(a.requires.currentInterpretationContextAllOf, b.requires.currentInterpretationContextAllOf)) return false;
    if (Object.entries(b.contributorDefinitionHashes).some(([key, hash]) => a.contributorDefinitionHashes[key] !== hash)) return false;
    const aHeritage = a.requires.heritageAnyOf ?? [], bHeritage = b.requires.heritageAnyOf ?? [];
    if (bHeritage.length && (!aHeritage.length || !aHeritage.every(k => bHeritage.includes(k) &&
        a.heritageDefinitionHashes?.[k] === b.heritageDefinitionHashes?.[k]))) return false;
    return true;
}

/** Pure, versioned content resolver; no campaigns, accounts, providers or model calls. */
export class AuthoredConceptBank {
    private readonly entries = new Map<string, Readonly<AuthoredConceptEntry>>();
    private readonly knownKeys = new Set<string>();
    private readonly readings: readonly Readonly<ConditionalConceptReading>[];

    constructor(value: unknown, private readonly interpretationContext?: InterpretationContextResolver) {
        const bank = value as { version?: number; entries?: unknown[];
            conditionalReadingsVersion?: number; conditionalReadings?: unknown[] };
        if (!bank || bank.version !== 1 || !Array.isArray(bank.entries) || bank.entries.length > 4096)
            throw new Error('Invalid authored concept bank');
        for (const value of bank.entries) {
            const entry = value as AuthoredConceptEntry;
            if (!entry || !['culture', 'faith'].includes(entry.domain) || typeof entry.key !== 'string' ||
                !entry.key || entry.key.length > 512 || typeof entry.definitionHash !== 'string' ||
                !/^[a-f0-9]{64}$/u.test(entry.definitionHash) || !['authored', 'excluded', 'needs_review'].includes(entry.status) ||
                typeof entry.label !== 'string' || entry.label.length > 200 ||
                typeof entry.description !== 'string' || entry.description.length > 2500 ||
                typeof entry.rationale !== 'string' || !entry.rationale.trim() || entry.rationale.length > 6000 ||
                !Array.isArray(entry.tags) || entry.tags.length > 64 || new Set(entry.tags).size !== entry.tags.length ||
                entry.tags.some(t => typeof t !== 'string' || !t || t.length > 128))
                throw new Error('Invalid authored concept entry');
            if (entry.status === 'authored' ? !entry.label.trim() || !entry.description.trim() : entry.description !== '')
                throw new Error('Invalid authored concept prose status');
            const key = entry.domain + ':' + entry.key + ':' + entry.definitionHash;
            if (this.entries.has(key)) throw new Error('Duplicate authored concept definition');
            const copy = { ...entry, tags: Object.freeze([...entry.tags]) };
            this.entries.set(key, Object.freeze(copy));
            this.knownKeys.add(entry.domain + ':' + entry.key);
        }
        const hasReadings = bank.conditionalReadingsVersion !== undefined || bank.conditionalReadings !== undefined;
        if (hasReadings && (bank.conditionalReadingsVersion !== 1 || !Array.isArray(bank.conditionalReadings) ||
            bank.conditionalReadings.length > 4096)) throw new Error('Invalid conditional concept bank');
        const ids = new Set<string>();
        const stringList = (list: unknown): list is string[] => Array.isArray(list) && list.length <= 64 &&
            new Set(list).size === list.length && list.every(s => typeof s === 'string' && s.trim() && s.length <= 512);
        this.readings = Object.freeze((bank.conditionalReadings ?? []).map(value => {
            const reading = value as ConditionalConceptReading;
            const requires = reading?.requires;
            if (!reading || typeof reading.id !== 'string' || !/^[a-z0-9_]{1,200}$/u.test(reading.id) ||
                Object.keys(reading).some(k => !['id', 'domain', 'conceptKey', 'definitionHash', 'label', 'description',
                    'requires', 'contributorDefinitionHashes', 'heritageDefinitionHashes', 'replaces', 'guard', 'handbookEntries', 'evidenceBasis'].includes(k)) ||
                ids.has(reading.id) || !['culture', 'faith'].includes(reading.domain) ||
                typeof reading.conceptKey !== 'string' || !reading.conceptKey || reading.conceptKey.length > 512 ||
                typeof reading.definitionHash !== 'string' || !/^[a-f0-9]{64}$/u.test(reading.definitionHash) ||
                typeof reading.label !== 'string' || !reading.label.trim() || reading.label.length > 200 ||
                typeof reading.description !== 'string' || !reading.description.trim() || reading.description.length > 2500 ||
                reading.replaces !== 'this_concept_reading_only' || !requires || requires.concept !== reading.conceptKey ||
                Object.keys(requires).some(k => !['concept', 'otherConceptsAllOf', 'heritageAnyOf', 'currentInterpretationContextAllOf'].includes(k)) ||
                (requires.otherConceptsAllOf !== undefined && !stringList(requires.otherConceptsAllOf)) ||
                (requires.heritageAnyOf !== undefined && (!stringList(requires.heritageAnyOf) || reading.domain !== 'culture')) ||
                (requires.currentInterpretationContextAllOf !== undefined && !stringList(requires.currentInterpretationContextAllOf)) ||
                !(requires.otherConceptsAllOf?.length || requires.heritageAnyOf?.length || requires.currentInterpretationContextAllOf?.length) ||
                requires.otherConceptsAllOf?.includes(reading.conceptKey) ||
                !reading.contributorDefinitionHashes || Array.isArray(reading.contributorDefinitionHashes) ||
                typeof reading.contributorDefinitionHashes !== 'object' ||
                Object.keys(reading.contributorDefinitionHashes).sort().join('\0') !== [...(requires.otherConceptsAllOf ?? [])].sort().join('\0') ||
                typeof reading.guard !== 'string' || !reading.guard.trim() || reading.guard.length > 6000 ||
                typeof reading.evidenceBasis !== 'string' || !reading.evidenceBasis.trim() || reading.evidenceBasis.length > 2000 ||
                !Array.isArray(reading.handbookEntries) || reading.handbookEntries.length > 153 ||
                new Set(reading.handbookEntries).size !== reading.handbookEntries.length ||
                reading.handbookEntries.some(n => !Number.isInteger(n) || n < 1 || n > 153))
                throw new Error('Invalid conditional concept reading');
            const primary = this.entries.get(reading.domain + ':' + reading.conceptKey + ':' + reading.definitionHash);
            if (primary?.status !== 'authored') throw new Error('Conditional reading requires an authored primary definition');
            const heritageHashes = reading.heritageDefinitionHashes ?? {};
            if (reading.heritageDefinitionHashes !== undefined && (!heritageHashes || typeof heritageHashes !== 'object' || Array.isArray(heritageHashes) ||
                Object.keys(heritageHashes).sort().join('\0') !== [...(requires.heritageAnyOf ?? [])].sort().join('\0') ||
                Object.values(heritageHashes).some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/u.test(hash))))
                throw new Error('Conditional heritage requires exact definition fingerprints');
            for (const [key, hash] of Object.entries(reading.contributorDefinitionHashes)) {
                if (!/^[a-f0-9]{64}$/u.test(hash) || this.entries.get(reading.domain + ':' + key + ':' + hash)?.status !== 'authored')
                    throw new Error('Conditional reading requires authored same-domain contributors');
            }
            ids.add(reading.id);
            return Object.freeze({ ...reading, requires: Object.freeze({ ...requires,
                ...(requires.otherConceptsAllOf && { otherConceptsAllOf: Object.freeze([...requires.otherConceptsAllOf]) }),
                ...(requires.heritageAnyOf && { heritageAnyOf: Object.freeze([...requires.heritageAnyOf]) }),
                ...(requires.currentInterpretationContextAllOf && {
                    currentInterpretationContextAllOf: Object.freeze([...requires.currentInterpretationContextAllOf]) }) }),
                contributorDefinitionHashes: Object.freeze({ ...reading.contributorDefinitionHashes }),
                ...(reading.heritageDefinitionHashes && { heritageDefinitionHashes: Object.freeze({ ...heritageHashes }) }),
                handbookEntries: Object.freeze([...reading.handbookEntries]) });
        }));
    }

    lookup(domain: ConceptDomain, fact: Fact): Readonly<AuthoredConceptEntry> | undefined {
        return this.entries.get(domain + ':' + fact.key + ':' + conceptDefinitionHash(domain, fact));
    }

    private select(domain: ConceptDomain, snapshot: Snapshot) {
        const normalized: Snapshot = domain === 'culture' ? validateCultureSnapshot(snapshot) : validateFaithSnapshot(snapshot);
        const context = this.interpretationContext?.(domain, structuredClone(normalized)) ?? [];
        if (!Array.isArray(context) || context.length > 64 || new Set(context).size !== context.length ||
            context.some(value => typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,199}$/u.test(value)))
            throw new Error('Invalid reviewed interpretation context');
        const facts = normalized.facts.filter(f => isConcept(domain, f)).sort((a, b) =>
            a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
        const selected = facts.map(fact => ({ fact, entry: this.lookup(domain, fact), reading: undefined as
            Readonly<ConditionalConceptReading> | undefined }));
        const issues: ConceptIssue[] = [];
        for (const { fact, entry } of selected) {
            if (!entry) issues.push({ key: fact.key,
                reason: this.knownKeys.has(domain + ':' + fact.key) ? 'definition_mismatch' : 'missing' });
            else if (entry.status === 'needs_review') issues.push({ key: fact.key, reason: 'needs_review' });
            else if (domain === 'faith' && entry.status === 'excluded') issues.push({ key: fact.key, reason: 'faith_excluded' });
        }
        const byKey = new Map(selected.map(s => [s.fact.key, s]));
        for (const selection of selected) {
            if (selection.entry?.status !== 'authored') continue;
            const matches = this.readings.filter(r => r.domain === domain && r.conceptKey === selection.fact.key &&
                r.definitionHash === selection.entry!.definitionHash &&
                // Without an explicitly supplied evidence adapter these stay dormant.
                // A name, race, graphic or starting template cannot satisfy one.
                (!r.requires.currentInterpretationContextAllOf?.length ||
                    r.requires.currentInterpretationContextAllOf.every(key => context.includes(key))) &&
                (!r.requires.heritageAnyOf?.length || normalized.facts.some(f => f.kind === 'pillar' &&
                    'category' in f && f.category === 'heritage' && r.requires.heritageAnyOf!.includes(f.key) &&
                    conceptDefinitionHash('culture', f) === r.heritageDefinitionHashes?.[f.key])) &&
                Object.entries(r.contributorDefinitionHashes).every(([key, hash]) =>
                    byKey.get(key)?.entry?.status === 'authored' && byKey.get(key)!.entry!.definitionHash === hash));
            const mostSpecific = matches.filter(r => !matches.some(other => other !== r &&
                refines(other, r) && !refines(r, other)));
            if (mostSpecific.length > 1) issues.push({ key: selection.fact.key, reason: 'conditional_conflict' });
            else selection.reading = mostSpecific[0];
        }
        return { normalized, selected, issues };
    }

    /** Hash only selected interpretation content. Editorial notes/unrelated cards do not invalidate caches. */
    revision(domain: ConceptDomain, snapshot: Snapshot): string {
        const { selected, issues } = this.select(domain, snapshot);
        return sha256Hex(canonicalJsonStringify({ version: 1, domain, issues,
            decisions: selected.map(({ fact, entry, reading }) => entry ? {
                key: fact.key, definitionHash: entry.definitionHash, status: entry.status,
                label: reading?.label ?? entry.label, description: reading?.description ?? entry.description,
                tags: [...entry.tags].sort(), ...(reading && { conditional: {
                    id: reading.id, contributors: reading.contributorDefinitionHashes,
                    heritage: normalizedHeritage(domain, snapshot, reading.requires.heritageAnyOf)
                } })
            } : { key: fact.key, definitionHash: conceptDefinitionHash(domain, fact), status: 'unavailable' }) }));
    }

    /** Resolve once by the same current-composition predicates used for projection. */
    resolvedConcepts(domain: ConceptDomain, snapshot: Snapshot): ResolvedAuthoredConcept[] {
        const { selected, issues } = this.select(domain, snapshot);
        if (issues.length) throw new AuthoredConceptUnavailable(domain, issues);
        return selected.filter(s => s.entry!.status === 'authored').map(({ fact, entry, reading }) => ({
            key: fact.key, definitionHash: entry!.definitionHash, readingId: reading?.id ?? null,
            label: reading?.label ?? entry!.label, description: reading?.description ?? entry!.description
        }));
    }

    /** Only reviewed labels/meanings cross the generator boundary; no source prose or rationale. */
    generatorConcepts(domain: ConceptDomain, snapshot: Snapshot) {
        return this.resolvedConcepts(domain, snapshot).map(({ key, label, description }) => ({ key, label, description }));
    }

    /** Preserve full originals elsewhere; this separate view contains no concept rule dictionaries. */
    project(domain: 'culture', snapshot: CultureSnapshot): CultureSnapshot;
    project(domain: 'faith', snapshot: FaithSnapshot): FaithSnapshot;
    project(domain: ConceptDomain, snapshot: Snapshot): Snapshot {
        const { normalized, selected, issues } = this.select(domain, snapshot);
        if (issues.length) throw new AuthoredConceptUnavailable(domain, issues);
        const byKey = new Map(selected.map(s => [s.fact.key, s]));
        const facts = normalized.facts.filter(f => !isConcept(domain, f) || byKey.get(f.key)!.entry!.status !== 'excluded');
        for (const fact of facts) {
            if (!isConcept(domain, fact)) continue;
            const { entry, reading } = byKey.get(fact.key)!;
            fact.name = reading?.label ?? entry!.label;
            fact.description = reading?.description ?? entry!.description;
            // Do not keep script nodes that could hide a source description.
            // The faith category is the only structural fact downstream needs
            // to distinguish tenets from ordinary observed doctrines.
            fact.rules = canonicalJsonStringify(domain === 'culture' ? { definitions: [] } : {
                definitions: [{ key: 'group_rules', value: [{ key: 'category', value: 'core_tenets' }] }]
            });
            authoredViews.set(fact, canonicalJsonStringify(fact));
        }
        // Filtering never changes a fact's domain; the overload retains that
        // relationship for callers without widening the original snapshot.
        return { ...normalized, facts } as Snapshot;
    }
}

let bundledBank: AuthoredConceptBank | undefined;
/** Lazy loading keeps the new bank isolated until a reviewed recipe opts into it. */
export function getBundledAuthoredConceptBank(): AuthoredConceptBank {
    return bundledBank ??= new AuthoredConceptBank(JSON.parse(readFileSync(
        path.join(__dirname, '../../../public/backgroundConcepts/recipe/authored.json'), 'utf8')));
}
