import type { Character } from '../../shared/gameData/Character';
import type { Config } from '../../shared/Config';
import { getVerifiedGoaSnapshot } from '../goa/goaRuntime';
import { GoaRuleContext } from '../goa/goaRuleContext';
import { dialogueCatalogue, DialogueCatalogue } from './dialogueCatalog';
import type { DialogueIdentity } from './dialogueCapture';
import { getDialogueIdentity } from './dialogueRuntime';

export const DIALOGUE_WRITER_CORE = 'Make this Warcraft individual recognizable in the actual words: diction, sentence rhythm, forms of address, humor and conversational tactics. ' +
    'Pursue the character\'s present aim through that voice. Personal traits, explicit convictions and limits, relationships, memories and current circumstances determine motives and choices. ' +
    'A person can oppose a cultural custom while retaining distinctive speech. Preserve the selected racial pressures at their established intensity and the real cost of restraint. ' +
    'Current cultural and religious backgrounds govern actual customs and teachings; the register supplies expression, never extra biography, possessions, abilities, authority or language knowledge. ' +
    'Keep fear, tenderness, rivalry, solemnity, anger and absurd humor available when the character and moment support them. Vary phrasing rather than repeating a catchphrase. ' +
    'Preserve full emotional depth and natural paragraphs with speech and action woven together in the existing output grammar. ' +
    'The source dialogue represents the host-selected spoken tongue; comprehension and any CLOSE/FAR transformation remain the host\'s job. ' +
    'Choose a laugh, sigh or other meaningful visible gesture in the existing narration only when the person actually performs it. Do not invent TTS commands or an audio event schema.';

export interface ResolvedDialogueSteering { text: string; cultureKey?: string; faithKey?: string; roleKeys: string[] }

export function resolveDialogueSteering(identity: DialogueIdentity | undefined, traitIds: readonly string[],
    options: { culture: boolean; faith: boolean; mode?: 'dialogue' | 'letter' | 'suggestion'; locale?: string; corruptedNature?: boolean },
    data: DialogueCatalogue = dialogueCatalogue()): ResolvedDialogueSteering {
    const result: ResolvedDialogueSteering = { text: '', roleKeys: [] };
    if (options.locale && options.locale !== data.sourceLocale) return result;
    const parts: string[] = [];
    if (options.culture && identity?.complete) {
        const roots = [...new Set(identity.cultureRoots)].filter(id => data.cultures[id]);
        // Exact native culture wins. A sole inherited register can continue; competing roots are not invented mixtures.
        const culture = identity.cultureId && data.cultures[identity.cultureId] ? identity.cultureId : roots.length === 1 ? roots[0] : undefined;
        if (culture) { result.cultureKey = culture; parts.push('Current cultural speech register:\n' + data.cultures[culture].instruction); }
    }
    const fallen = traitIds.includes('fallen_demon_hunter');
    if (options.faith && !fallen && identity?.faithId) {
        const found = Object.entries(data.faiths).find(([, v]) => v.faithIds.includes(identity.faithId!));
        if (found) {
            result.faithKey = found[0]; parts.push('When this person expresses religious conviction, use the following devotional register only in agreement with their current teachings and stated beliefs. ' +
                'Retain established dissent and the existing stronger Zealous emphasis; a borrowed idiom does not create belief or a ritual.\n' + found[1].instruction);
        }
    }
    for (const [key, role] of Object.entries(data.roles)) {
        if (role.requiresConfirmedRole || !role.traitIds.some(id => traitIds.includes(id)) ||
            (fallen && key === 'demon_hunter_selected_attention')) continue;
        result.roleKeys.push(key);
        if (key === 'druid_ecological_attention' && options.corruptedNature) {
            parts.push('In relevant Life-magic practice, use root, season, hunger, wound, regrowth and interdependence as forceful imagery. ' +
                'The supplied corruption governs the actual urge and cost: let its distorted ideal press upon the person even under benevolent intent. ' +
                'Preserve the established rank, personal choice and real consequences. Conversation, affection or a protective phrase does not cleanse that condition.');
            continue;
        }
        parts.push('For relevant use of established ' + role.label.toLowerCase() + ', let actual proficiency set depth. ' +
            'Training does not confer a professional office, an organization, a pact or an unrecorded spell.\n' + role.instruction);
    }
    if (!parts.length) return result;
    if (fallen) parts.push('These cultural mannerisms are available to the acting controller; the former host\'s faith, conscience and attachments do not become its convictions. Preserve the final controlling-identity policy.');
    if (options.mode === 'letter') parts.push('Express this register through the letter\'s wording and address. This is written correspondence; do not stage an audible performance or add physical events to demonstrate the voice.');
    if (options.mode === 'suggestion') parts.push('These are possible replies for the player character, not declarations that the character has already chosen or performed them.');
    result.text = 'Character dialogue direction:\n' + DIALOGUE_WRITER_CORE + '\n\n' + parts.join('\n\n');
    return result;
}

/** Writer-only hook. Never called by voice design, TTS, summaries, action inference or observer narration. */
export function dialogueSteeringFor(actor: Character, config: Config, mode: 'dialogue' | 'letter' | 'suggestion' = 'dialogue'): string {
    if (config.goaLoreEnabled === false) return '';
    const goa = getVerifiedGoaSnapshot(actor);
    if (!goa) return '';
    return resolveDialogueSteering(getDialogueIdentity(actor), goa.traitIds, {
        culture: !!config.cultureRoleplayEnabled, faith: !!config.faithRoleplayEnabled, mode, locale: config.language || 'en',
        corruptedNature: new GoaRuleContext(goa).corruptedNature
    }).text;
}
