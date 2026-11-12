/** Shared, versioned cultural facts. Contains no character, campaign or account identity. */
export type CultureFactKind = 'pillar' | 'tradition' | 'innovation' | 'naming' | 'aesthetic' | 'era' | 'court_ideal' | 'trait_valuation' | 'practice' | 'lineage';

export interface CultureFact {
    kind: CultureFactKind;
    key: string;
    category: string;
    name: string;
    description: string;
    /** Normalized cultural rules, including conditions; never asserted as individual traits. */
    rules: string;
}

export interface CultureSnapshot {
    /** Version 1 remains readable in archives; only version 2 schedules new generation. */
    version: 1 | 2;
    complete: true;
    facts: CultureFact[];
}

const kinds: CultureFactKind[] = ['pillar', 'tradition', 'innovation', 'naming', 'aesthetic', 'era', 'court_ideal', 'trait_valuation', 'practice', 'lineage'];

/** Also used when reading archives and the persistent library: fail closed on malformed facts. */
export function validateCultureSnapshot(value: unknown): CultureSnapshot {
    if (!value || typeof value !== 'object') throw new Error('Invalid culture snapshot');
    const input = value as Record<string, unknown>;
    if (![1, 2].includes(input.version as number) || input.complete !== true || !Array.isArray(input.facts) ||
        input.facts.length === 0 || input.facts.length > 4096) throw new Error('Invalid culture snapshot');
    let bytes = 0;
    const seen = new Set<string>();
    const facts = input.facts.map((value: unknown): CultureFact => {
        if (!value || typeof value !== 'object') throw new Error('Invalid culture fact');
        const fact = value as Record<string, unknown>;
        if (!kinds.includes(fact.kind as CultureFactKind)) throw new Error('Invalid culture fact kind');
        if (input.version === 1 && ['court_ideal', 'trait_valuation', 'practice', 'lineage'].includes(fact.kind as string))
            throw new Error('Unsupported legacy culture fact');
        const result = {} as CultureFact;
        result.kind = fact.kind as CultureFactKind;
        for (const field of ['key', 'category', 'name', 'description', 'rules'] as const) {
            const limit = field === 'rules' && input.version === 2 ? 262144 : 65536;
            if (typeof fact[field] !== 'string' || (fact[field] as string).length > limit)
                throw new Error('Invalid culture fact field');
            result[field] = fact[field] as string;
            bytes += result[field].length;
        }
        if (!result.key || seen.has(`${result.kind}:${result.key}`)) throw new Error('Duplicate culture fact');
        seen.add(`${result.kind}:${result.key}`);
        return result;
    });
    if (bytes > 2_000_000) throw new Error('Culture snapshot too large');
    for (const category of ['ethos', 'heritage', 'language', 'martial_custom']) {
        if (facts.filter(f => f.kind === 'pillar' && f.category === category).length !== 1)
            throw new Error('Incomplete cultural pillars');
    }
    return { version: input.version as 1 | 2, complete: true, facts };
}
