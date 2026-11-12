import { snapshotActionCache } from './actionCache';
import type { Conversation } from './Conversation';
import type { Action, ActionResponse } from '../ts/conversation_interfaces';
import { ActionEffectWriter } from './ActionEffectWriter';
import { formatActionNotice } from './actionNotice';
import { runActionWithScenePolicy, waitForSceneSelection } from '../scenes/sceneRuntime';

/** A synchronous admission/write section prevents slash commands replacing unconsumed effects. */
export async function executeSlashAction(conv: Conversation, action: Action, values: unknown[]): Promise<ActionResponse | undefined> {
    if (!conv.isOpen) throw new Error('The conversation has ended.');
    const parseId = (value: unknown): number | null => {
        if (value === null || value === undefined || value === '') return null;
        const id = Number(value);
        if (!Number.isSafeInteger(id) || !conv.gameData.characters.has(id)) throw new Error('Invalid action participant.');
        return id;
    };
    const sourceId = parseId(values[0]);
    const targetId = parseId(values[1]);
    const args = values.slice(2).map(String);
    if (args.length !== action.args.length || action.args.some((arg, i) => arg.type === 'number' && !Number.isFinite(Number(args[i]))))
        throw new Error('Invalid action arguments.');
    const eligibility: any = action.check(conv.gameData, sourceId!, targetId!);
    if (!eligibility || (typeof eligibility === 'object' && (eligibility.canExecute === false ||
        (eligibility.validTargetCharacterIds && !eligibility.validTargetCharacterIds.includes(targetId)))))
        throw new Error('This action is unavailable for the selected participants.');
    const preCheck = action.preCheck?.(conv.gameData, args, sourceId!, targetId!);
    if (preCheck && !preCheck.success) throw new Error(preCheck.message || 'This action cannot be executed.');
    conv.runFileManager.assertIdle();
    const chatMessage = action.chatMessageClass != null
        ? formatActionNotice(action, args, conv.gameData, sourceId, targetId, conv.config.language) : '';
    const rollback = snapshotActionCache(conv.gameData);
    try {
        let body = '';
        runActionWithScenePolicy(action, conv.gameData, text => { body += text; }, args, sourceId!, targetId!);
        if (!body.trim()) {
            if (action.signature.toLowerCase() === 'noop') { rollback(); return undefined; }
            throw new Error('The action produced no game effect.');
        }
        conv.runFileManager.writeActionWhenIdle(ActionEffectWriter.composeFullEffect(conv.gameData, sourceId, targetId, body)
            + '\nroot = { trigger_event = mcc_event_v2.9003 }');
    } catch (error) { rollback(); throw error; }
    if (sourceId !== null) conv.actionInvolvedCharacterIds.add(sourceId);
    if (targetId !== null) conv.actionInvolvedCharacterIds.add(targetId);
    await waitForSceneSelection(conv.gameData);
    if (!conv.isOpen) return undefined;
    if ((action.signature === 'leaveConversation' || action.signature === 'killCharacter') && targetId !== null) {
        if (targetId === conv.gameData.playerID) {
            conv.chatWindow.window.webContents.send('chat-hide');
            conv.chatWindow.hide();
            conv.saveHistoryAndTriggerSummarization();
        } else conv.removeCharacter(targetId);
    }
    if (action.signature === 'changeLocation' && !conv.gameData.sceneSnapshot) void conv.generateSceneDescription();
    return chatMessage ? { actionName: action.signature, chatMessage, chatMessageClass: action.chatMessageClass } : undefined;
}
