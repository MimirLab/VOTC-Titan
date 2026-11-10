/** English variables for authored action text, never a rewrite of arbitrary prose. */
export function characterPronounVariables(
    prefix: 'character1' | 'character2', sheHe: string | undefined,
    canonicalSex?: 'male' | 'female', sexless = false
): Record<string, string> {
    const legacy = sheHe?.trim().toLowerCase();
    const sex = canonicalSex ?? (legacy === 'she' ? 'female' : legacy === 'he' ? 'male' : undefined);
    const forms = !sexless && sex === 'female' ? { Subject: 'she', Object: 'her', Possessive: 'her', Reflexive: 'herself' } :
        !sexless && sex === 'male' ? { Subject: 'he', Object: 'him', Possessive: 'his', Reflexive: 'himself' } :
            { Subject: 'they', Object: 'them', Possessive: 'their', Reflexive: 'themselves' };
    return Object.fromEntries(Object.entries(forms).map(([form, value]) => [prefix + form, value]));
}
