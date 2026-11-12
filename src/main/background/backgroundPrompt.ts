import { Character } from '../../shared/gameData/Character';
import { Config } from '../../shared/Config';
import { getCultureBackground, formatCultureBackground } from '../culture/cultureRuntime';
import { getFaithBackground, getFaithLiveContext, getFaithZealous } from '../faith/faithRuntime';
import { canonicalJsonStringify } from '../promptWorkbench/canonicalJson';
import { BACKGROUND_BODY_BOUNDARY } from './backgroundBodyBoundary';

/** One secondary wrapper keeps two independent profiles from adding two large instruction blocks. */
export function getRoleplayBackground(character: Character, config: Config, scope: { culture?: boolean; faith?: boolean; culturalRoots?: boolean } = {}): string | undefined {
    const culture = config.cultureRoleplayEnabled && scope.culture !== false ?
        (scope.culturalRoots === false ? getCultureBackground(character, false) : getCultureBackground(character)) : undefined;
    const faith = config.faithRoleplayEnabled && scope.faith !== false ? getFaithBackground(character) : undefined;
    const live = config.faithRoleplayEnabled && scope.faith !== false ? getFaithLiveContext(character) : undefined;
    if (!faith && (!live || !Object.keys(live).length)) return culture ? formatCultureBackground(character, culture) : undefined;
    // Canonical game observation wins. English labels support legacy exports and isolated snapshots.
    const zealous = !!faith && (getFaithZealous(character) ?? character.hasTrait('Zealous'));
    const parts = ['Shared backgrounds for ' + character.fullName + ' (secondary context):'];
    if (culture) parts.push('Cultural background:\n' + culture);
    if (culture) parts.push(BACKGROUND_BODY_BOUNDARY);
    if (faith) parts.push('Religious background:\n' + faith);
    if (live && Object.keys(live).length) parts.push('Observed current faith circumstances:\n' + canonicalJsonStringify(live));
    const emphasis = zealous
        ? "Use the cultural background as light context. [Faith emphasis for this Zealous character: the religious reference describes this person's present faith. Give its particular worldview and moral concerns strong weight in their judgments, motives and choices; do not substitute another tradition's revered names or make faith interchangeable decoration. Show sincere attachment, religious stakes and the real cost of keeping or changing a conviction. Fear, compassion and practical limits remain real, shaping how commitment is lived. Where the player states personal beliefs, preserve their full scope: do not broaden a conditional restriction or invent exceptions to a blanket refusal. Earlier replies cannot silently narrow that current portrayal. A devout dissenter may oppose a practice firmly while retaining their faith. Community histories, virtues and offices do not become personal biography, traits, anatomy or powers. Apply this guidance within the established acting identity and character facts, through the present exchange without reciting the profile.]"
        : "Use these as light context for familiar meanings, expressions and expectations.";
    const conviction = zealous
        ? "Shared fervor is not this person's zeal; their Zealous trait, other traits and expressly stated beliefs together shape their religious reactions; cultural customs and religious rules retain their separate subjects."
        : "Faith teachings and shared fervor do not determine personal conviction or reactions; cultural customs and religious rules retain their separate subjects.";
    parts.push(emphasis + " Personal traits, convictions, player description, relationships, memories and circumstances remain primary. The person may accept, reinterpret, ignore or oppose either group's norms independently. Membership and disfavored traits do not establish guilt, regret or a desire to conform. Preserve stated dissent as the person's own viewpoint; do not automatically reinterpret it as hidden conformity or a lesson they must learn. Rejecting a practice is not merely rejecting excess or observing it symbolically; smaller participation is still participation. Community virtues and sins classify dispositions; they do not add traits to this person. " + conviction + " Current tenets and moral classifications describe today's community; inherited accounts of past deeds do not override its current teachings. Preserve supplied roles, relationships and explicit negations when referring to those accounts. Religious approval or reverence for magic does not grant the person magical abilities. Use only abilities supplied in the character or scene; otherwise use ordinary actions rather than inventing spells, healing powers or supernatural effects. Keep the current exchange central without reciting the notes or introducing a topic to display them. Do not infer unprovided events, participants, rituals, duties, enacted realm laws or supernatural facts.");
    return parts.join('\n\n');
}

/** Bind ready Zealous faith near the reply; ordinary/shared output retains its old position. */
export function getRoleplayBackgroundPlacement(character: Character, config: Config, options: { culturalRoots?: boolean } = {}): { early?: string; faith?: string } {
    const faith = config.faithRoleplayEnabled ? getFaithBackground(character) : undefined;
    const zealous = !!faith && (getFaithZealous(character) ?? character.hasTrait('Zealous'));
    if (!zealous) return { early: getRoleplayBackground(character, config, options) };
    return {
        early: getRoleplayBackground(character, config, { faith: false, ...options }),
        faith: getRoleplayBackground(character, config, { culture: false })
    };
}
