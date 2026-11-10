// Readable supporting cultural meanings. The full snapshot remains in identity.
// These readings do not establish an individual's traits, choices or abilities.
import { cleanMeaning } from './sourceMeanings';
import type { CultureFact } from '../../shared/gameData/CultureSnapshot';

const opaque = /context-dependent wording|unresolved|Get[A-Z]|\w_\w|\x15/u;
// Localization may concatenate a colored label and its following technical noun.
// Reject the whole mechanical reading rather than inventing a custom from its remainder.
const mechanical = /\b(?:traits?|bonuses?|modifiers?|\w*interactions?|\w*decisions?|\w*councillor|cooldowns?|education|fascination progress|levies|men at arms|buildings?|holdings?|epidemics?|lifestyle|prowess|county opinion|positive opinion|public esteem (?:bonus|gain|cost|points|levels))\b|\b(?:strong|weak) hooks?\b|\bincreasing skills\b|\bguardians.*more effective\b|\d\s*%/iu;
const readableLabel = (text: string) => /^[\p{L}][\p{L}\s'-]*$/u.test(text) && !opaque.test(text) && text !== 'Characters';

/** Preserve literal conditions and direction; no invented enactment or moral worth. */
export function culturalCue(text: string): string | undefined {
    text = cleanMeaning(text).replace(/\bMedievalera\b/gu, 'Medieval era').replace(/[.]+$/u, '');
    if (!text || opaque.test(text)) return;
    const esteem = /^The (.+?) trait is (more valued|less valued)$/iu.exec(text);
    if (esteem && readableLabel(esteem[1])) return 'The disposition ' + JSON.stringify(esteem[1]) + ' is ' + esteem[2] + '.';
    if (mechanical.test(text)) return;
    return text + '.';
}

export function socialEsteemCue(name: string, readings: string[]): string | undefined {
    if (!readableLabel(cleanMeaning(name))) return;
    const text = readings.map(cleanMeaning).join(' ');
    return text && !opaque.test(text) && !mechanical.test(text) ? text : undefined;
}

/** Read the captured combat convention without turning its rhetoric into biology.
 * Require the complete known declaration and both supplied descriptions, not a
 * culture name, starting template or familiar pillar key.
 */
export function culturalMartialCue(fact: Pick<CultureFact, 'kind' | 'category' | 'description' | 'rules'>): string | undefined {
    if (fact.kind !== 'pillar' || fact.category !== 'martial_custom') return;
    let rules: any;
    try { rules = JSON.parse(fact.rules); } catch { return; }
    const declarations = rules?.definitions;
    if (!Array.isArray(declarations) || declarations.length !== 1 || declarations[0]?.key !== 'parameters' ||
        declarations[0]?.operator !== '=' || !Array.isArray(declarations[0]?.value) || declarations[0].value.length !== 1 ||
        Object.keys(rules.conditionalDescriptions ?? {}).length || (rules.modifierEvidence?.length ?? 0)) return;
    const parameter = declarations[0].value[0];
    if (parameter?.operator !== '=' || parameter?.value !== 'yes') return;
    for (const sex of ['men', 'women'] as const) {
        const key = 'martial_custom_' + (sex === 'men' ? 'male' : 'female') + '_only_combatant';
        if (parameter.key === key && fact.description === `This culture considers only ${sex} to be physically strong and tough enough to fight in battle.` &&
            rules.parameterDescriptions?.[key] === `Only ${sex} can be commanders and (context-dependent wording)`)
            return `Military service and command are customarily ${sex}'s roles in this culture. Other adopted customs and established character facts may qualify exceptions. Governing, teaching and civilian craft follow their own customs; this convention assigns no individual strength, occupation or bodily features.`;
    }
    const key = 'martial_custom_equal_combatant';
    if (parameter.key === key && fact.description === 'In this culture, any able-bodied person in the household may take up arms for their liege when called on.' &&
        rules.parameterDescriptions?.[key] === 'Both men and women can be commanders and (context-dependent wording)')
        return 'Able-bodied household members of either sex may take up arms for their liege when called on, and both men and women are eligible for military command. This convention assigns no individual strength, occupation or bodily features.';
}

/** Interpret captured court ideals as social esteem, never a present court or personal conduct.
 * Match the supplied prose, not a court ID/name: changed mod meanings cannot inherit defaults.
 */
export function culturalCourtCue(text: string): string | undefined {
    text = cleanMeaning(text).replace(/\s+Courtiers gain [^.]*traits\.?\s*$/u, '').trim();
    if (!text || opaque.test(text)) return;
    const readings = new Map([
        ['A Court is all about attracting cultivated minds and people of exceptional skill.',
            'This culture esteems cultivated minds and people of exceptional skill.'],
        ['Only an efficient and well-maintained court will make our realm prosper.',
            'This culture sees efficient, careful administration as essential to prosperity.'],
        ['A show of force is the only way to command awe and respect! Our knights and soldiers are famous for their prowess.',
            'This culture prizes displays of strength as the way to earn awe and respect, and esteems martial prowess.'],
        ['Diplomacy is key to garnering the respect of our peers and keeping the realm at peace. A pleased vassal is a loyal vassal.',
            'This culture values diplomacy, respect among peers and peace, and associates contented vassals with loyalty.'],
        ['To leave the people at court unchecked is dangerous, and we must ensure that no one can be up to no good without us knowing.',
            'This culture values vigilance, close oversight and awareness of concealed wrongdoing.']
    ]);
    const known = readings.get(text);
    if (known) return known;
    // An unfamiliar mod can supply its own clearly stated ideal without a name-based template.
    if (mechanical.test(text)) return;
    return text.replace(/^(?:The|This|A) court (values|prizes|esteems|reveres|admires|honou?rs)\b/iu,
        'This culture $1');
}
