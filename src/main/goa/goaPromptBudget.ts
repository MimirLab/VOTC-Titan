import { Message } from '../ts/conversation_interfaces';

/** Remove older dialogue only. Persona, lore and final instructions are mandatory. */
export function trimGoaPrompt(prompt: Message[], history: readonly Message[], count: (p: Message[]) => number,
    contextLimit: number, replyBudget: number): Message[] {
    const budget = contextLimit - Math.max(0, replyBudget);
    const currentTurn = history[history.length - 1];
    const removable = new Set(history.filter(m => m !== currentTurn));
    while (count(prompt) > budget) {
        const index = prompt.findIndex(m => removable.has(m));
        if (index < 0) throw new Error('The current character context, Warcraft lore and reply budget exceed the model context setting. Increase its context size or reduce optional prompt content.');
        removable.delete(prompt[index]); prompt.splice(index, 1);
    }
    return prompt;
}
