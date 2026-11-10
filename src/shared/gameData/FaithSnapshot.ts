/** Anonymous religious composition. Runtime/account/character identity lives outside it. */
export type FaithFactKind = 'religion' | 'family' | 'doctrine' | 'virtue' | 'sin' | 'description' | 'worship' | 'holy_site';
export interface FaithFact {
    kind: FaithFactKind;
    key: string;
    name: string;
    description: string;
    /** Source rules retain their subjects, conditions, numeric values and unresolved variants. */
    rules: string;
}
export interface FaithSnapshot { version: 1; complete: true; facts: FaithFact[] }
export interface FaithLiveContext {
    fervor?: number;
    religiousHead?: string;
    holySiteControl?: { site: string; heldByFaith: boolean }[];
}
export function validateFaithSnapshot(value: unknown): FaithSnapshot {
    const input = value as FaithSnapshot;
    if (!input || input.version !== 1 || input.complete !== true || !Array.isArray(input.facts) ||
        !input.facts.length || input.facts.length > 4096) throw new Error('Invalid faith snapshot');
    const seen = new Set<string>();
    let size = 0;
    const facts = input.facts.map(f => {
        if (!f || !['religion', 'family', 'doctrine', 'virtue', 'sin', 'description', 'worship', 'holy_site'].includes(f.kind))
            throw new Error('Invalid faith fact');
        const result = { kind: f.kind } as FaithFact;
        for (const field of ['key', 'name', 'description', 'rules'] as const) {
            if (typeof f[field] !== 'string' || f[field].length > (field === 'rules' ? 262144 : 65536))
                throw new Error('Invalid faith evidence');
            result[field] = f[field]; size += f[field].length;
        }
        const id = f.kind + ':' + f.key;
        if (!f.key || seen.has(id)) throw new Error('Duplicate faith evidence');
        seen.add(id);
        return result;
    });
    if (size > 2_000_000 || facts.filter(f => f.kind === 'religion').length !== 1 ||
        facts.filter(f => f.kind === 'family').length !== 1 || !facts.some(f => f.kind === 'doctrine') ||
        !seen.has('description:faith') || !seen.has('description:religion')) throw new Error('Incomplete faith evidence');
    return { version: 1, complete: true, facts };
}
export function validateFaithLiveContext(value: unknown): FaithLiveContext {
    const input = value as FaithLiveContext;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid faith context');
    const result: FaithLiveContext = {};
    if (input.fervor !== undefined) {
        if (!Number.isFinite(input.fervor) || input.fervor < 0 || input.fervor > 100) throw new Error('Invalid fervor');
        result.fervor = input.fervor;
    }
    if (input.religiousHead !== undefined) {
        if (typeof input.religiousHead !== 'string' || input.religiousHead.length > 1024) throw new Error('Invalid religious head');
        result.religiousHead = input.religiousHead;
    }
    if (input.holySiteControl !== undefined) {
        if (!Array.isArray(input.holySiteControl) || input.holySiteControl.length > 4096) throw new Error('Invalid sacred locations');
        result.holySiteControl = input.holySiteControl.map(v => {
            if (!v || typeof v.site !== 'string' || v.site.length > 1024 || typeof v.heldByFaith !== 'boolean')
                throw new Error('Invalid sacred location');
            return { site: v.site, heldByFaith: v.heldByFaith };
        });
    }
    return result;
}
