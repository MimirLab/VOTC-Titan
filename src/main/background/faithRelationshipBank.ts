/** Reviewed current-account relationships. No faith names, starting templates or personal state select these. */
import { FaithSnapshot, validateFaithSnapshot } from '../../shared/gameData/FaithSnapshot';
import { canonicalJsonStringify, sha256Hex } from '../promptWorkbench/canonicalJson';

export interface FaithVocabularyRoleReading {
    key: string;
    value: string;
    label: string;
    /** Reviewed aspects available only while this independent role is observed. */
    teachingContext?: readonly string[];
}
export interface FaithRelationshipReading {
    accountHash: string;
    rootHash: string;
    worship: Record<string, string>;
    text: string;
    vocabulary: 'named' | 'force' | 'ancestral' | 'account' | 'secular' | 'hold';
    /** Reviewed teaching evidence only; neither body nor personal abilities. */
    teachingContext?: readonly string[];
    /** Exact current getter value within a separately matched reviewed account. */
    vocabularyRoles?: readonly FaithVocabularyRoleReading[];
}
export interface FaithRootRelationshipReading { accountHash: string; text: string; hold?: boolean }
export interface FaithRelationshipAsset {
    version: 1;
    accounts: FaithRelationshipReading[];
    roots: FaithRootRelationshipReading[];
}
export interface ResolvedFaithRelationship {
    account?: FaithRelationshipReading;
    root?: FaithRootRelationshipReading;
    parent?: FaithRelationshipReading;
    vocabularyRoles?: readonly FaithVocabularyRoleReading[];
    revision: string;
}
const projected = new WeakMap<FaithSnapshot, { value: ResolvedFaithRelationship; fingerprint: string }>();
const digest = /^[a-f0-9]{64}$/u;
const modes = new Set(['named', 'force', 'ancestral', 'account', 'secular', 'hold']);
const cleanText = (v: unknown): v is string => typeof v === 'string' && !!v.trim() &&
    v.length <= 8192 && !/[\x00-\x1f]/u.test(v);
const validContext = (v: unknown): v is readonly string[] => Array.isArray(v) &&
    v.length <= 64 && new Set(v).size === v.length &&
    v.every(value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,199}$/u.test(value));
const copyRole = (role: FaithVocabularyRoleReading): FaithVocabularyRoleReading => ({ ...role,
    ...(role.teachingContext && { teachingContext: [...role.teachingContext] }) });
export function projectedFaithRelationship(snapshot: FaithSnapshot): ResolvedFaithRelationship | undefined {
    const selected = projected.get(snapshot);
    return selected && selected.fingerprint === sha256Hex(canonicalJsonStringify(snapshot)) ?
        structuredClone(selected.value) : undefined;
}
export class FaithRelationshipUnavailable extends Error {}

export class FaithRelationshipBank {
    private accounts: FaithRelationshipReading[];
    private roots: Map<string, FaithRootRelationshipReading>;
    constructor(value: unknown) {
        const asset = value as FaithRelationshipAsset;
        if (!asset || Object.keys(asset).sort().join() !== 'accounts,roots,version' || asset.version !== 1 ||
            !Array.isArray(asset.accounts) || !Array.isArray(asset.roots) ||
            asset.accounts.length > 4096 || asset.roots.length > 4096) throw new Error('Invalid faith relationship asset');
        const seen = new Set<string>();
        this.accounts = asset.accounts.map(entry => {
            if (!entry || Object.keys(entry).some(key => !['accountHash', 'rootHash', 'text', 'vocabulary', 'worship', 'teachingContext', 'vocabularyRoles'].includes(key)) ||
                !digest.test(entry.accountHash) || !digest.test(entry.rootHash) || !modes.has(entry.vocabulary) ||
                !entry.worship || typeof entry.worship !== 'object' || Array.isArray(entry.worship) ||
                (entry.vocabulary !== 'hold' && !cleanText(entry.text)) ||
                (entry.vocabulary === 'hold' && entry.text !== '')) throw new Error('Invalid faith relationship reading');
            for (const [key, text] of Object.entries(entry.worship))
                if (!/^[A-Za-z][A-Za-z0-9_]{0,127}$/u.test(key) || !cleanText(text))
                    throw new Error('Invalid faith relationship worship binding');
            if (entry.teachingContext !== undefined && (!Array.isArray(entry.teachingContext) ||
                entry.teachingContext.length > 64 || new Set(entry.teachingContext).size !== entry.teachingContext.length ||
                entry.teachingContext.some(value => typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,199}$/u.test(value))))
                throw new Error('Invalid faith teaching context');
            if (entry.vocabularyRoles !== undefined && (!Array.isArray(entry.vocabularyRoles) ||
                entry.vocabularyRoles.length > 64 || entry.vocabularyRoles.some(role => !role ||
                    Object.keys(role).some(key => !['key', 'label', 'value', 'teachingContext'].includes(key)) ||
                    typeof role.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,127}$/u.test(role.key) || !cleanText(role.value) ||
                    !cleanText(role.label) || role.label.length > 300 ||
                    (role.teachingContext !== undefined && !validContext(role.teachingContext))) ||
                new Set(entry.vocabularyRoles.map(role => canonicalJsonStringify([role.key, role.value]))).size !== entry.vocabularyRoles.length))
                throw new Error('Invalid reviewed faith vocabulary roles');
            const identity = canonicalJsonStringify([entry.accountHash, entry.rootHash, entry.worship]);
            if (seen.has(identity)) throw new Error('Duplicate faith relationship reading');
            seen.add(identity);
            // Defensive copies prevent external editorial mutations from changing an accepted revision.
            return { ...entry, worship: { ...entry.worship },
                ...(entry.teachingContext && { teachingContext: [...entry.teachingContext] }),
                ...(entry.vocabularyRoles && { vocabularyRoles: entry.vocabularyRoles.map(copyRole) }) };
        });
        this.roots = new Map();
        for (const entry of asset.roots) {
            if (!entry || Object.keys(entry).some(key => !['accountHash', 'text', 'hold'].includes(key)) ||
                !digest.test(entry.accountHash) || (entry.hold !== undefined && typeof entry.hold !== 'boolean') ||
                (!entry.hold && !cleanText(entry.text)) || (entry.hold && entry.text !== '') ||
                this.roots.has(entry.accountHash)) throw new Error('Invalid faith root relationship reading');
            this.roots.set(entry.accountHash, { ...entry });
        }
    }
    resolve(snapshot: FaithSnapshot): ResolvedFaithRelationship {
        validateFaithSnapshot(snapshot);
        const account = snapshot.facts.find(f => f.kind === 'description' && f.key === 'faith')!;
        const root = snapshot.facts.find(f => f.kind === 'description' && f.key === 'religion')!;
        const accountHash = sha256Hex(account.description), rootHash = sha256Hex(root.description);
        const observed = new Map(snapshot.facts.filter(f => f.kind === 'worship').map(f => [f.key, f.description]));
        const matches = this.accounts.filter(entry => entry.accountHash === accountHash && entry.rootHash === rootHash &&
            Object.entries(entry.worship).every(([key, value]) => observed.get(key) === value));
        if (matches.length > 1) throw new FaithRelationshipUnavailable('Ambiguous current faith relationship');
        const selected = matches[0], inherited = this.roots.get(rootHash);
        if (selected?.vocabulary === 'hold' || inherited?.hold)
            throw new FaithRelationshipUnavailable('Observed faith relationship is a source placeholder');
        // The engine records an originating source faith, not its current
        // doctrines. Match the original account against its own source religion
        // and vocabulary, never against the descendant's current vocabulary.
        const parentFact = snapshot.facts.find(f => f.kind === 'description' && f.key === 'parent_faith');
        let parent: FaithRelationshipReading | undefined;
        if (parentFact?.description && sha256Hex(parentFact.description) !== accountHash) {
            try {
                const evidence = JSON.parse(parentFact.rules);
                if (evidence.version === 1 && digest.test(evidence.sourceReligionHash) &&
                    evidence.sourceWorship && typeof evidence.sourceWorship === 'object' && !Array.isArray(evidence.sourceWorship)) {
                    const candidates = this.accounts.filter(entry => entry.accountHash === sha256Hex(parentFact.description) &&
                        entry.rootHash === evidence.sourceReligionHash && entry.vocabulary !== 'hold' &&
                        Object.entries(entry.worship).every(([key, value]) => evidence.sourceWorship[key] === value));
                    if (candidates.length === 1) parent = candidates[0];
                }
            } catch { /* An unreadable origin supplies no inherited account. */ }
        }
        // Teaching facets select separately hashed authored clauses. Unused adapter
        // metadata does not change this account's rendered relationship wording.
        const vocabularyRoles = selected?.vocabularyRoles?.filter(role => observed.get(role.key) === role.value)
            .map(copyRole).sort((a, b) => a.key.localeCompare(b.key, 'en')) ?? [];
        let accountMeaning: Omit<FaithRelationshipReading, 'teachingContext' | 'vocabularyRoles'> | null = null;
        if (selected) { const { teachingContext, vocabularyRoles, ...meaning } = selected; accountMeaning = meaning; }
        const result = { ...(selected ? { account: structuredClone(selected) } : {}),
            ...(inherited ? { root: { ...inherited } } : {}),
            ...(parent ? { parent: structuredClone(parent) } : {}),
            ...(vocabularyRoles.length ? { vocabularyRoles } : {}),
            revision: sha256Hex(canonicalJsonStringify({ version: 1, account: accountMeaning, root: inherited || null,
                ...(parent ? { parent: { accountHash: parent.accountHash, rootHash: parent.rootHash, text: parent.text } } : {}),
                ...(vocabularyRoles.length ? { vocabularyRoles: vocabularyRoles.map(role => {
                    const { teachingContext, ...meaning } = role; return meaning;
                }) } : {}) })) };
        return result;
    }
    /** Only a fully matched current account/root/primary vocabulary affirms these teachings. */
    teachingContext(snapshot: FaithSnapshot): readonly string[] {
        const selected = this.resolve(snapshot);
        const context = [...new Set([...(selected.account?.teachingContext ?? []),
            ...(selected.vocabularyRoles ?? []).flatMap(role => role.teachingContext ?? [])])];
        if (context.length > 64) throw new FaithRelationshipUnavailable('Too many reviewed faith teaching facets');
        return context;
    }
    /** Origin facets describe an inherited perspective, never current teaching. */
    parentTeachingContext(snapshot: FaithSnapshot): readonly string[] {
        const parent = this.resolve(snapshot).parent;
        const fact = snapshot.facts.find(f => f.kind === 'description' && f.key === 'parent_faith');
        if (!parent || !fact) return [];
        let observed: Record<string, string>;
        try { observed = JSON.parse(fact.rules).sourceWorship; } catch { return []; }
        const roles = (parent.vocabularyRoles ?? []).filter(role => observed?.[role.key] === role.value);
        const context = [...new Set([...(parent.teachingContext ?? []),
            ...roles.flatMap(role => role.teachingContext ?? [])])];
        if (context.length > 64) throw new FaithRelationshipUnavailable('Too many inherited faith facets');
        return context;
    }
    /** Preserve raw identity and every adopted doctrine; reinterpret only exact matched descriptive accounts. */
    project(snapshot: FaithSnapshot): FaithSnapshot {
        const selected = this.resolve(snapshot);
        const result = { ...snapshot, facts: snapshot.facts.map(f => {
            if (f.kind !== 'description') return f;
            const text = f.key === 'faith' ? selected.account?.text : f.key === 'religion' ? selected.root?.text :
                f.key === 'parent_faith' ? selected.parent?.text : undefined;
            return text === undefined ? f : { ...f, description: text };
        }) };
        projected.set(result, { value: selected, fingerprint: sha256Hex(canonicalJsonStringify(result)) });
        return result;
    }
}
