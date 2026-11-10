import { CultureSnapshot } from '../../shared/gameData/CultureSnapshot';
import { FaithSnapshot } from '../../shared/gameData/FaithSnapshot';
import { canonicalJsonStringify, sha256Hex } from '../promptWorkbench/canonicalJson';
import { AuthoredConceptBank, ConceptDomain, ResolvedAuthoredConcept } from './authoredConceptBank';

/** Separately authored compression. Rich descriptions stay in the upstream bank. */
export interface EssentialConceptEntry {
    domain: ConceptDomain;
    key: string;
    definitionHash: string;
    readingId: string | null;
    richDescriptionHash: string;
    text: string;
    /** Editorial explanation only; never returned to the generator. */
    rationale: string;
}
export interface EssentialConceptIssue {
    key: string;
    readingId: string | null;
    reason: 'missing' | 'stale_description';
}
export class EssentialConceptUnavailable extends Error {
    constructor(public readonly domain: ConceptDomain, public readonly issues: readonly EssentialConceptIssue[]) {
        super('Essential ' + domain + ' meanings unavailable: ' + issues.map(i =>
            i.key + ' (' + (i.readingId ?? 'portable') + ': ' + i.reason + ')').join(', '));
        this.name = 'EssentialConceptUnavailable';
    }
}
export interface ResolvedEssentialConcept extends ResolvedAuthoredConcept {
    essentialText: string;
}
type Snapshot = CultureSnapshot | FaithSnapshot;
function identity(domain: ConceptDomain, key: string, definitionHash: string, readingId: string | null): string {
    return canonicalJsonStringify([domain, key, definitionHash, readingId]);
}

/** Pure staging support. No bundled loader, runtime hookup, model call or library write. */
export class EssentialConceptBank {
    private readonly entries = new Map<string, Readonly<EssentialConceptEntry>>();

    constructor(value: unknown) {
        const asset = value as { version?: number; entries?: unknown[] };
        if (!asset || asset.version !== 1 || !Array.isArray(asset.entries) || asset.entries.length > 8192 ||
            Object.keys(asset).some(k => !['version', 'entries'].includes(k)))
            throw new Error('Invalid essential concept bank');
        for (const value of asset.entries) {
            const entry = value as EssentialConceptEntry;
            if (!entry || Object.keys(entry).some(k => !['domain', 'key', 'definitionHash', 'readingId',
                'richDescriptionHash', 'text', 'rationale'].includes(k)) ||
                !['culture', 'faith'].includes(entry.domain) || typeof entry.key !== 'string' ||
                !entry.key.trim() || entry.key.length > 512 ||
                typeof entry.definitionHash !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.definitionHash) ||
                (entry.readingId !== null && (typeof entry.readingId !== 'string' ||
                    !/^[a-z0-9_]{1,200}$/u.test(entry.readingId))) ||
                typeof entry.richDescriptionHash !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.richDescriptionHash) ||
                typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 2500 ||
                typeof entry.rationale !== 'string' || !entry.rationale.trim() || entry.rationale.length > 6000)
                throw new Error('Invalid essential concept entry');
            const key = identity(entry.domain, entry.key, entry.definitionHash, entry.readingId);
            // Different rich-description bindings for the same slot cannot compete silently.
            if (this.entries.has(key)) throw new Error('Duplicate essential concept reading');
            this.entries.set(key, Object.freeze({ ...entry }));
        }
    }

    /** Missing/stale selected variants hold; a portable clause cannot replace them. */
    resolve(domain: ConceptDomain, snapshot: Snapshot, richBank: AuthoredConceptBank): ResolvedEssentialConcept[] {
        const concepts = richBank.resolvedConcepts(domain, snapshot);
        const issues: EssentialConceptIssue[] = [];
        const resolved: ResolvedEssentialConcept[] = [];
        for (const concept of concepts) {
            const entry = this.entries.get(identity(domain, concept.key, concept.definitionHash, concept.readingId));
            if (!entry) issues.push({ key: concept.key, readingId: concept.readingId, reason: 'missing' });
            else if (entry.richDescriptionHash !== sha256Hex(concept.description))
                issues.push({ key: concept.key, readingId: concept.readingId, reason: 'stale_description' });
            else resolved.push({ ...concept, essentialText: entry.text });
        }
        if (issues.length) throw new EssentialConceptUnavailable(domain, issues);
        return resolved;
    }

    /**
     * A separate authored view preserves provenance through the evidence filters.
     * Never edit a rich projected fact: changing its bytes loses that provenance.
     * Rich selection validates every original concept before any exclusion here.
     */
    project(domain: 'culture', snapshot: CultureSnapshot, richBank: AuthoredConceptBank): CultureSnapshot;
    project(domain: 'faith', snapshot: FaithSnapshot, richBank: AuthoredConceptBank): FaithSnapshot;
    project(domain: ConceptDomain, snapshot: Snapshot, richBank: AuthoredConceptBank): Snapshot {
        const selected = this.resolve(domain, snapshot, richBank);
        const projectionBank = new AuthoredConceptBank({ version: 1, entries: selected.map(concept => ({
            domain, key: concept.key, definitionHash: concept.definitionHash, status: 'authored',
            label: concept.label, description: concept.essentialText, tags: [],
            rationale: 'Exact selected rich reading and separately bound essential clause.'
        })) });
        if (domain === 'culture') {
            const retained = new Set(selected.map(concept => concept.key));
            const source = snapshot as CultureSnapshot;
            // Only the rich bank's explicit cultural exclusions can be absent.
            // Missing, redefined and conflicting readings already threw above.
            return projectionBank.project('culture', { ...source,
                facts: source.facts.filter(fact => fact.kind !== 'tradition' || retained.has(fact.key)) });
        }
        // The rich bank forbids excluded faith tenets; all must remain present.
        return projectionBank.project('faith', snapshot as FaithSnapshot);
    }

    /** Domain-local, selected-content revision. Editorial and unselected edits do not churn caches. */
    revision(domain: ConceptDomain, snapshot: Snapshot, richBank: AuthoredConceptBank): string {
        const concepts = this.resolve(domain, snapshot, richBank);
        return sha256Hex(canonicalJsonStringify({ version: 1, domain,
            richRevision: richBank.revision(domain, snapshot),
            concepts: concepts.map(({ key, definitionHash, readingId, description, essentialText }) => ({
                key, definitionHash, readingId, richDescriptionHash: sha256Hex(description), text: essentialText
            })) }));
    }
}
