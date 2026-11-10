import { ConceptDomain } from './authoredConceptBank';
import { ResolvedEssentialConcept } from './essentialConceptBank';
import { canonicalJsonStringify, sha256Hex } from '../promptWorkbench/canonicalJson';

export interface ConceptCompositionMember {
    key: string;
    definitionHash: string;
    readingId: string | null;
    richDescriptionHash: string;
    essentialTextHash: string;
}
export interface ConceptComposition {
    id: string;
    domain: ConceptDomain;
    members: readonly ConceptCompositionMember[];
    text: string;
    /** Editorial material stays outside the model reference. */
    rationale: string;
}

/** Optional authored unions. This module has no bundled/default runtime loader. */
export class ConceptCompositionBank {
    private readonly compositions: readonly Readonly<ConceptComposition>[];

    constructor(value: unknown) {
        const bank = value as { version?: number; compositions?: ConceptComposition[] };
        if (!bank || bank.version !== 1 || !Array.isArray(bank.compositions) || bank.compositions.length > 4096 ||
            Object.keys(bank).some(k => !['version', 'compositions'].includes(k))) throw new Error('Invalid concept compositions');
        const ids = new Set<string>(), identities = new Set<string>();
        const hash = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/u.test(s);
        this.compositions = Object.freeze(bank.compositions.map(row => {
            if (!row || Object.keys(row).sort().join() !== 'domain,id,members,rationale,text' ||
                typeof row.id !== 'string' || !/^[a-z0-9_]{1,200}$/u.test(row.id) || ids.has(row.id) || !['culture', 'faith'].includes(row.domain) ||
                !Array.isArray(row.members) || row.members.length < 2 || row.members.length > 64 ||
                typeof row.text !== 'string' || !row.text.trim() || row.text.length > 2500 ||
                typeof row.rationale !== 'string' || !row.rationale.trim() || row.rationale.length > 6000)
                throw new Error('Invalid concept composition');
            ids.add(row.id);
            const keys = new Set<string>();
            const members = row.members.map(member => {
                if (!member || Object.keys(member).sort().join() !== 'definitionHash,essentialTextHash,key,readingId,richDescriptionHash' ||
                    typeof member.key !== 'string' || !member.key.trim() || member.key.length > 512 || keys.has(member.key) ||
                    !hash(member.definitionHash) || !hash(member.richDescriptionHash) || !hash(member.essentialTextHash) ||
                    (member.readingId !== null && (typeof member.readingId !== 'string' || !/^[a-z0-9_]{1,200}$/u.test(member.readingId))))
                    throw new Error('Invalid concept composition member');
                keys.add(member.key);
                return Object.freeze({ ...member });
            }).sort((a, b) => a.key.localeCompare(b.key, 'en'));
            const identity = canonicalJsonStringify([row.domain, members]);
            if (identities.has(identity)) throw new Error('Duplicate concept composition bindings');
            identities.add(identity);
            return Object.freeze({ ...row, members: Object.freeze(members) });
        }));
    }

    /** An absent contributor disables a union; changed bound wording never silently joins. */
    resolve(domain: ConceptDomain, concepts: readonly ResolvedEssentialConcept[]): ConceptComposition[] {
        if (new Set(concepts.map(c => c.key)).size !== concepts.length) throw new Error('Duplicate resolved concepts');
        const selected: ConceptComposition[] = [], used = new Set<string>();
        for (const row of this.compositions.filter(c => c.domain === domain)) {
            const matched = row.members.map(member => concepts.find(c => c.key === member.key && c.readingId === member.readingId));
            if (matched.some(c => !c)) continue;
            for (const [i, concept] of matched.entries()) {
                const member = row.members[i];
                if (concept!.definitionHash !== member.definitionHash || sha256Hex(concept!.description) !== member.richDescriptionHash ||
                    sha256Hex(concept!.essentialText) !== member.essentialTextHash) throw new Error('Stale concept composition: ' + row.id);
                if (used.has(member.key)) throw new Error('Overlapping active concept compositions');
            }
            row.members.forEach(member => used.add(member.key));
            selected.push({ ...row, members: row.members.map(member => ({ ...member })) });
        }
        return selected.sort((a, b) => a.id.localeCompare(b.id, 'en'));
    }

    /** Selected text/bindings alone affect the anonymous domain recipe revision. */
    revision(domain: ConceptDomain, concepts: readonly ResolvedEssentialConcept[]): string {
        return sha256Hex(canonicalJsonStringify({ version: 1, domain,
            compositions: this.resolve(domain, concepts).map(({ id, members, text }) => ({ id, members, text })) }));
    }
}
