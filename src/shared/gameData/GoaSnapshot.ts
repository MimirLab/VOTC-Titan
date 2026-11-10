/** Read-only game observations. Optional facts are populated only by a qualified adapter. */
export interface GoaSnapshot {
    version: 1;
    digest: string;
    characterId: number;
    sex?: 'male' | 'female';
    traitIds: string[];
    /** Actual current body, when a transformation exports it. Not a guessed racial alias. */
    currentBody?: string;
    sexlessBody?: boolean;
    facts: Record<string, string | number | boolean>;
    magicDefences?: Record<string, number>;
}

export function validateGoaSnapshot(value: unknown): GoaSnapshot {
    const s = value as GoaSnapshot;
    if (!s || s.version !== 1 || !/^[a-f0-9]{64}$/.test(s.digest) || !Number.isSafeInteger(s.characterId) ||
        !Array.isArray(s.traitIds) || s.traitIds.length > 5000 || s.traitIds.some(id => !/^[A-Za-z0-9_]+$/.test(id)) ||
        (s.sex !== undefined && s.sex !== 'male' && s.sex !== 'female') ||
        (s.currentBody !== undefined && !/^[A-Za-z0-9_]+$/.test(s.currentBody)) ||
        (s.sexlessBody !== undefined && typeof s.sexlessBody !== 'boolean') ||
        !s.facts || typeof s.facts !== 'object' || Array.isArray(s.facts)) throw new Error('Invalid GoA character snapshot.');
    const facts: GoaSnapshot['facts'] = {};
    for (const [key, v] of Object.entries(s.facts)) {
        if (!/^[A-Za-z0-9_]+$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key) ||
            !['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v)))
            throw new Error('Invalid GoA observed fact.');
        facts[key] = v;
    }
    const magicDefences: Record<string, number> = {};
    for (const [key, v] of Object.entries(s.magicDefences ?? {})) {
        if (!/^(light|order|death|disorder|life|shadow|elemental_(fire|air|water|earth))$/.test(key) || !Number.isFinite(v))
            throw new Error('Invalid GoA magic observation.');
        magicDefences[key] = v;
    }
    return { version: 1, digest: s.digest, characterId: s.characterId, traitIds: [...new Set(s.traitIds)].sort(),
        ...(s.sex ? { sex: s.sex } : {}), ...(s.currentBody ? { currentBody: s.currentBody } : {}),
        ...(s.sexlessBody !== undefined ? { sexlessBody: s.sexlessBody } : {}), facts,
        ...(s.magicDefences ? { magicDefences } : {}) };
}
