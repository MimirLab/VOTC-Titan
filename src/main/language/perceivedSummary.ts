import { Message } from '../ts/conversation_interfaces';

/** Local extractive fallback for a different listener view; never asks an AI to translate. */
export function perceivedSummary(messages: readonly Message[], previous = '', maxCharacters = 2400): string {
    const lines = messages.map(message => `${message.name || message.role}: ${message.content}`)
        .join('\n').split('\n').filter(line => line.trim());
    if (!lines.length) return previous;
    const meaningful = /\*[^*]+\*|\b(angry|happy|sad|furious|worried|afraid|grateful|decided|agreed|refused|promised|threatened|confessed|revealed|planned)\b/i;
    const selected = [...new Set([lines[0], ...lines.filter(line => meaningful.test(line)).slice(0, 3), lines[lines.length - 1]])];
    const text = [previous ? `[Previous: ${previous.slice(0, 100)}]` : '', ...selected].filter(Boolean).join(' | ');
    return text.length <= maxCharacters ? text : text.slice(0, maxCharacters);
}
