import path from 'path';
import { playerSpeechSpans } from '../../src/shared/language/playerSpeech';
import { mapSpeechSpans } from '../../src/shared/language/speechSpans';
import { loadLanguageEngine } from '../../src/main/language/languageEngine';
import { LanguageConversation } from '../../src/main/language/languageConversation';
import { ConversationLedger } from '../../src/main/language/conversationLedger';
import { validateLedger, readRecipientHistory } from '../../src/main/language/languageHistory';
import { GameData } from '../../src/shared/gameData/GameData';
import { Message } from '../../src/main/ts/conversation_interfaces';
import { character } from '../culture/fixtures';

const engine = loadLanguageEngine(path.resolve('public/languages'));
const selected = (text: string) => playerSpeechSpans(text).map(span => text.slice(span.start, span.end));
test.each(['Bring water before dawn.', 'yes', '🙂 Bring water.\r\n\r\nWait by the gate.', "Don't worry; I'm here."])(
    'casual unformatted input is entirely audible: %s', text => {
        expect(selected(text).join('')).toBe(text);
    });
test.each([
    ['He nods. "Bring water." His hands tremble.', ['Bring water.']],
    ['*I nod.* “Bring water.”\n\n*I wait.*', ['Bring water.']],
    ['He leans in. "Bring water."\n\nHe points to the gate. "Before dawn."', ['Bring water.', 'Before dawn.']],
    ['*He points at the sign "Home".* Bring water.', [' Bring water.']],
    ['[OOC: say "nothing"] Bring water.', [' Bring water.']],
    ['*I nod.* Bring water. *I wait.*', [' Bring water. ']],
    ['He waits. "Bring **water** now."', ['Bring ', 'water', ' now.']],
    ['🙂 He nods. "Bring\r\nwater."\n\nHe waits.', ['Bring\r\nwater.']],
    ['I need a 6" cup.', ['I need a 6" cup.']],
    ['*I nod.* "Bring water', [' "Bring water']],
    ['He waits. ""', []],
    ['*He points at "Home".*', []]
])('player formatting defines the audible ranges: %s', (text, expected) => {
    expect(selected(text)).toEqual(expected);
    expect(mapSpeechSpans(text, playerSpeechSpans(text), speech => speech)).toBe(text);
});

function fixture() {
    const game = new GameData(['1', 'Player', '2', 'Close', '1066.9.15', 'court', 'County', 'Player', '0']);
    for (const [id, language] of [[1, 'language_common'], [2, 'language_low_common'], [3, 'language_orcish'], [4, 'language_common']] as const) {
        const actor = character(id, 'Actor' + id); actor.languageSnapshot = { version: 1, complete: true,
            nativeLanguageId: language, knownLanguageIds: [language] }; game.characters.set(id, actor);
    }
    return { game, session: new LanguageConversation(game, engine.renderer), ledger: new ConversationLedger(game.playerID) };
}
test.each(['Bring water before dawn.', 'He nods. "Bring water before dawn."\n\n*His hands tremble.*'])(
    'the production ledger delivers player speech before prompts/history and freezes earlier hearings: %s', text => {
        const { game, session, ledger } = fixture();
        const message: Message = { role: 'user', content: text }; session.record(message); ledger.append(message, game.characters.values());
        const close = session.forRecipient(message, 2), far = session.forRecipient(message, 3), clear = session.forRecipient(message, 4);
        expect(clear.content).toBe(text); expect(close.comprehensionMode).toBe('CLOSE'); expect(far.comprehensionMode).toBe('FAR');
        expect(far.content).not.toContain('Bring water before dawn.');
        if (text.includes('He nods.')) {
            for (const view of [close, far]) { expect(view.content).toContain('He nods.'); expect(view.content).toContain('*His hands tremble.*'); }
        }
        game.characters.get(3)!.languageSnapshot!.knownLanguageIds.push('language_common');
        expect(session.forRecipient(message, 3).content).toBe(far.content);
        const saved = validateLedger(JSON.parse(JSON.stringify(ledger.snapshot('1066.9.15', 1))));
        expect(readRecipientHistory(saved, 3)[0].content).toBe(far.content);
        expect(JSON.stringify(far)).not.toContain('originalText');
    });
