import type { GameData } from '../../shared/gameData/GameData';
import { characterPronounVariables } from '../../shared/characterPronouns';
import type { Action } from '../ts/conversation_interfaces';
import { getVerifiedGoaSnapshot } from '../goa/goaRuntime';
import { GoaRuleContext } from '../goa/goaRuleContext';
import { parseVariables } from '../parseVariables';
import { sceneDisplayName } from '../../shared/scenes/sceneDisplay';

/** Render fixed action text from its actual participants, without changing shared prompt variables. */
export function formatActionNotice(
    action: Pick<Action, 'chatMessage'> & Partial<Pick<Action, 'signature'>>, args: string[], gameData: GameData,
    sourceId: number | null, targetId: number | null, language: string
): string {
    let template = action.chatMessage(args);
    if (template && typeof template === 'object') {
        template = template[language] || template.en || Object.values(template)[0];
    }
    if (typeof template !== 'string') return '';
    if (action.signature === 'changeLocation' && args[0]?.startsWith('titan_')) {
        // Keep canonical arguments for custom templates; replace only their rendered scene text.
        const label = sceneDisplayName(args[0]);
        for (const raw of new Set([args[0], args[0].replace(/_/g, ' ')])) {
            template = template.split(raw).join(label);
        }
    }
    const source = sourceId === null ? undefined : gameData.getCharacterById(sourceId);
    const target = targetId === null ? undefined : gameData.getCharacterById(targetId);
    const context = Object.create(gameData) as GameData & Record<string, string>;
    context.character1Name = source?.shortName ?? 'someone';
    context.character2Name = target?.shortName ?? 'someone';
    for (const [prefix, character] of [['character1', source], ['character2', target]] as const) {
        const snapshot = character ? getVerifiedGoaSnapshot(character) : undefined;
        // Stored snapshots alone do not qualify current-body exceptions.
        const sexless = snapshot ? new GoaRuleContext(snapshot).sexlessBody : false;
        Object.assign(context, characterPronounVariables(prefix, character?.sheHe, snapshot?.sex, sexless));
    }
    return parseVariables(template, context);
}
