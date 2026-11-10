import type { Character } from '../../shared/gameData/Character';
import type { Config } from '../../shared/Config';
import { getVerifiedGoaSnapshot } from '../goa/goaRuntime';
import { currentDevelopment, developmentCaptureEnabled } from './developmentRuntime';

const bands = [
    'Use mostly gestures, immediate feelings and appropriately limited speech; do not give a very young child sustained adult exposition.',
    'Favor concrete understanding, immediate concerns, familiar people and simple connections; vocabulary can reflect what this child has actually learned.',
    'Show growing but uneven understanding, shaped by curiosity, fairness, rules and personal experience. Distinguish rehearsed adult phrases from independent understanding.',
    'Allow growing abstract thought and independence, with identity, pride, belonging and uncertainty where fitting. Judgment and emotional confidence can be uneven.',
    'Preserve adult responsibilities and actual competence. Let youthful perspective, developing identity and less practiced judgment appear where the situation and traits support them.'
];

/** Goes only to the current roleplay writer, never to summaries, actions or voice design. */
export function developmentalSteeringFor(character: Character, config: Config): string {
    const frame = currentDevelopment(character);
    if (!frame && developmentCaptureEnabled()) throw new Error('Current character age capture is not ready. Reopen the encounter or retry the reply.');
    if (!frame) return '';
    if (frame.age === '20+') return Number.isSafeInteger(character.age) && character.age >= 0 && character.age < 20
        ? `Current development for ${character.fullName}: the current game capture confirms age twenty or older. Any earlier child or teenage age in persona or history is outdated. Use ordinary adult portrayal based on verified traits and experience, without a forced youthful manner or an assumption of instant wisdom. Preserve the authoritative acting identity.` : '';
    const age = frame.age;
    const snapshot = config.goaLoreEnabled === false ? undefined : getVerifiedGoaSnapshot(character);
    const replacedMind = snapshot?.facts.mind_replaced === true || snapshot?.traitIds.includes('fallen_demon_hunter');
    const header = `Current development for ${character.fullName}: current game age ${age}; the game currently treats this character as ${frame.adult ? 'an adult' : 'a minor'}. This current value takes precedence over older age descriptions in persona or history.`;
    if (replacedMind) return header + ' The acting mind is replaced. Host age does not establish the controller\'s developmental age. Portray the verified controller\'s own history, understanding, traits and experience; do not infantilize that mind or assign it the host\'s childhood. Do not invent an age or memories for the controller. Follow the authoritative acting-identity instructions.';
    return header + '\n' +
        'Portray understanding, emotional responses, private thoughts, speech and choices consistently with this age, upbringing, observed traits and demonstrated experience. ' +
        bands[age < 3 ? 0 : age < 6 ? 1 : age < 13 ? 2 : age < 16 ? 3 : 4] + ' ' +
        'Preserve verified intelligence, skills, training, memories, relationships, convictions, titles and authority, including a child ruler\'s position or a prodigy\'s expertise. Separate learned information from practiced judgment and emotional confidence. ' +
        'Adapt broad cultural or racial descriptions that assume adult personal experience to this individual\'s actual development. Preserve established instincts, magical or corruptive pressures and the real cost of resisting them. ' +
        'Let traits shape youth: patience need not become impulsiveness, and a thoughtful child need not act rowdy. Express youth through perspective and behavior without constant childishness, forced slang or exaggerated incompetence. ' +
        'Long-lived or immortal ancestry alone grants no extra years of personal experience; do not invent racial age multipliers. If verified history establishes an older acting mind in a young or transformed body, follow that mind\'s development instead of physical appearance. ' +
        'Apply these directions silently while writing only the requested character response in its required format; do not recite the guidance.';
}
