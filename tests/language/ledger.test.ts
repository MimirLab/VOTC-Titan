import fs from 'fs';
import os from 'os';
import path from 'path';
import { GameData } from '../../src/shared/gameData/GameData';
import { character } from '../culture/fixtures';
import { loadLanguageEngine } from '../../src/main/language/languageEngine';
import { LanguageConversation } from '../../src/main/language/languageConversation';
import { ConversationLedger } from '../../src/main/language/conversationLedger';
import { validateLedger, readRecipientHistory } from '../../src/main/language/languageHistory';
import { loadLedgerHistory, saveLedgerHistory } from '../../src/main/language/ledgerStorage';
import { PerspectiveSummaries } from '../../src/main/language/perspectiveSummaries';
import { Message } from '../../src/main/ts/conversation_interfaces';
import { perceivedMemoryTranscript, summaryPerspectiveInstruction } from '../../src/main/language/conversationView';
import { CultureService } from '../../src/main/culture/CultureService';
import { FaithService } from '../../src/main/faith/FaithService';
import { snapshot as cultureSnapshot } from '../culture/fixtures';
import { snapshot as faithSnapshot } from '../faith/fixtures';

const engine = loadLanguageEngine(path.resolve('public/languages'));
const prose = '*Her hands tremble.* "Bring water before dawn."\n\n*She waits.*';
function fixture() {
    const game = new GameData(['1', 'Player', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Player', '0']);
    for (const [id, native] of [[1, 'language_low_common'], [2, 'language_common'], [3, 'language_orcish'], [4, 'language_orcish']] as const) {
        const actor = character(id, 'Actor' + id);
        actor.languageSnapshot = { version: 1, complete: true, nativeLanguageId: native, knownLanguageIds: [native] };
        game.characters.set(id, actor);
    }
    const session = new LanguageConversation(game, engine.renderer);
    const ledger = new ConversationLedger();
    const message: Message = { id: 'one', role: 'assistant', characterId: 2, name: 'Actor2', content: prose };
    session.record(message); ledger.append(message, game.characters.values());
    return { game, session, ledger, message };
}
test('four listeners share exactly three variants; projected objects carry no hidden translation', () => {
    const { ledger, message } = fixture();
    expect(Object.keys(message.languageRecord!.variants)).toHaveLength(3);
    expect(message.languageRecord!.hearings['3'].variant).toBe(message.languageRecord!.hearings['4'].variant);
    const clear = ledger.read(2), close = ledger.read(1), far = ledger.read(3);
    expect(clear[0].content).toBe(prose); expect(close[0].content).toContain('waeter');
    expect(far[0].content).not.toContain('Bring water'); expect(far[0].content).toContain('Her hands tremble');
    for (const view of [clear, close, far]) expect(JSON.stringify(view)).not.toMatch(/originalText|languageRecord|variants|hearings|recipientRenderings/);
});
test('new player speech retains its actual author without treating explicitly identified NPC turns as player speech', () => {
    const { session, ledger, game } = fixture();
    const player: Message = { id: 'player', role: 'user', name: 'Player', content: '"I will leave at dawn."' };
    session.record(player); ledger.append(player, game.characters.values());
    expect(player.characterId).toBe(1);
    const npc: Message = { id: 'npc', role: 'user', name: 'Speaker', characterId: 2, content: '"Wait here."' };
    session.record(npc); ledger.append(npc, game.characters.values());
    expect(npc.characterId).toBe(2);
    const views = ledger.read(1);
    expect(summaryPerspectiveInstruction('Player', views, 1)).toContain('The owner authored 1 of these turns');
    expect(perceivedMemoryTranscript(views, 1).match(/the owner authored this turn/g)).toHaveLength(1);
});
test('old canonical player turns recover authorship on read without changing source bytes or hearing hashes', () => {
    const { game, session } = fixture();
    const ledger = new ConversationLedger(1);
    const player: Message = { id: 'legacy-player', role: 'user', name: 'Player', content: '"I leave at dawn."' };
    session.record(player); delete player.characterId; ledger.append(player, game.characters.values());
    ledger.append({ id: 'scene', role: 'user', type: 'scene', name: 'Narrator', content: 'A quiet room.' }, game.characters.values());
    const before = JSON.stringify(ledger.snapshot('date', 1));
    const live = ledger.read(1), replay = readRecipientHistory(JSON.parse(before), 1);
    for (const views of [live, replay]) {
        expect(views[0].characterId).toBe(1); expect(views[1].characterId).toBeUndefined();
        expect(summaryPerspectiveInstruction('Player', views, 1)).toContain('The owner authored 1 of these turns');
    }
    expect(readRecipientHistory(JSON.parse(before), 3)[0].characterId).toBe(1);
    expect(JSON.stringify(ledger.snapshot('date', 1))).toBe(before);
});
test('future learning and departed speaker do not reinterpret a delivered turn', () => {
    const { game, session, ledger, message } = fixture(); const before = ledger.read(3)[0].content;
    game.characters.get(3)!.languageSnapshot!.knownLanguageIds.push('language_common'); game.characters.delete(2);
    expect(session.forRecipient(message, 3).content).toBe(before); expect(ledger.read(2)[0].content).toBe(prose);
});
test('the departed participant keeps verified culture and faith bindings after transient observations expire', () => {
    let now = 100;
    const options = { enabled: () => true, language: () => 'en', foregroundBusy: () => true, now: () => now };
    const library = { encounter: () => 'ready-hash', ready: () => 'A verified background.' } as any;
    const neverGenerate = jest.fn();
    const culture = new CultureService(library, neverGenerate, options), faith = new FaithService(library, neverGenerate, options);
    const owner = character(2, 'Speaker');
    culture.observe({ characterId: 2, cultureId: 10, snapshot: cultureSnapshot(), seenAt: now } as any);
    faith.observe({ characterId: 2, faithId: 20, snapshot: faithSnapshot(), liveContext: {}, seenAt: now, characterZealous: true } as any);
    expect(culture.backgroundFor(owner)).toBe('A verified background.');
    expect(faith.backgroundFor(owner)).toBe('A verified background.');
    const ledger = new ConversationLedger(); ledger.append({ role: 'user', content: 'A greeting.' }, [owner]);
    now += 20_000;
    const archived = ledger.characters[0];
    expect(culture.backgroundFor(archived)).toBe('A verified background.');
    expect(faith.backgroundFor(archived)).toBe('A verified background.');
    expect(faith.zealousFor(archived)).toBe(true);
    expect(neverGenerate).not.toHaveBeenCalled();
});
test('attendance retains the latest observed character object without changing past hearings', () => {
    const { game, ledger } = fixture(), before = ledger.read(3)[0].content;
    const updated = character(3, 'Actor3');
    updated.languageSnapshot = { version: 1, complete: true, nativeLanguageId: 'language_orcish', knownLanguageIds: ['language_orcish', 'language_common'] };
    game.characters.set(3, updated);
    ledger.append({ id: 'later-event', role: 'system', type: 'action', content: 'The door opens.' }, game.characters.values());
    expect(ledger.characters.find(actor => actor.id === 3)).toBe(updated);
    game.characters.delete(3);
    expect(ledger.characters.find(actor => actor.id === 3)).toBe(updated);
    expect(ledger.read(3)[0].content).toBe(before);
});
test('new arrivals see subsequent turns, not events they missed; returning participants retain their earlier views', () => {
    const { game, session, ledger, message } = fixture(); game.characters.delete(3);
    const newcomer = character(5, 'Late'); newcomer.languageSnapshot = game.getPlayer().languageSnapshot;
    game.characters.set(5, newcomer);
    const next: Message = { id: 'two', role: 'assistant', characterId: 2, content: '"I waited."' };
    session.record(next); ledger.append(next, game.characters.values());
    expect(session.messagesForRecipient([message, next], 5)).toHaveLength(1);
    expect(ledger.read(3)).toHaveLength(1); expect(ledger.read(5)).toHaveLength(1);
    expect(ledger.read(5)[0].id).toBe('two');
});
test('concurrent reads use explicit owners and reject a stale revision', async () => {
    const { ledger } = fixture(); const rev = ledger.revision;
    const views = await Promise.all([2, 3, 1, 4].map(async id => ledger.read(id, ['one'], rev)));
    expect(views[0][0].content).toBe(prose); expect(views[1][0].content).toBe(views[3][0].content);
    ledger.changed(); expect(() => ledger.read(1, undefined, rev)).toThrow('changed');
});
test('source edits retain historical modes despite subsequent language learning', () => {
    const { game, session, ledger, message } = fixture(); game.characters.get(3)!.languageSnapshot!.knownLanguageIds.push('language_common');
    session.editForRecipient(message, 2, '*She smiles.* "Water at noon."'); ledger.changed();
    expect(ledger.read(2)[0].content).toContain('Water at noon'); expect(ledger.read(3)[0].content).not.toContain('Water at noon');
    expect(ledger.read(3)[0].content).toContain('She smiles'); expect(message.languageRecord!.hearings['3'].mode).toBe('FAR');
});
test('perception edit creates one sparse variant without changing another listener or the source', () => {
    const { session, ledger, message } = fixture(); const other = ledger.read(4)[0].content;
    session.editForRecipient(message, 3, '*She waits.* "A hiss I remember."'); ledger.changed();
    expect(ledger.read(3)[0].content).toContain('A hiss'); expect(ledger.read(4)[0].content).toBe(other);
    expect(ledger.read(2)[0].content).toBe(prose); expect(Object.keys(message.languageRecord!.variants)).toHaveLength(4);
});
test('source changes outside the edit path and incomplete snapshots fail without a clear-text fallback', () => {
    const { session, message, ledger } = fixture(); message.content = '"Changed."';
    expect(() => session.forRecipient(message, 3)).toThrow('edit path');
    expect(() => validateLedger(ledger.snapshot('date', 1))).toThrow('hearing');
});
test('complete ledger survives arbitrary working-context trimming and JSON replay', () => {
    const { ledger, game } = fixture(); const working = [...ledger.messages]; working.splice(0);
    const action: Message = { id: 'action', role: 'system', type: 'action', content: 'The door opens.' };
    ledger.append(action, game.characters.values());
    const stored = validateLedger(JSON.parse(JSON.stringify(ledger.snapshot('date', 1))));
    expect(stored.messages).toHaveLength(2); expect(working).toHaveLength(0);
    expect(readRecipientHistory(stored, 3)[0].content).not.toContain('Bring water');
    expect(readRecipientHistory(stored, 3)[1].content).toBe('The door opens.');
});
test('one canonical record serves two history indexes; missing/corrupt delivery never falls back to text', () => {
    const { ledger } = fixture(); const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-store-'));
    try {
        const canonical = path.join(temp, 'legacy'), campaign = path.join(temp, 'campaign');
        const snapshot = ledger.snapshot('date', 1);
        saveLedgerHistory(canonical, 'entry', snapshot); saveLedgerHistory(campaign, 'entry', snapshot, canonical);
        expect(fs.readdirSync(path.join(canonical, '.language-ledgers'))).toHaveLength(1);
        expect(fs.existsSync(path.join(campaign, '.language-ledgers'))).toBe(false);
        expect(loadLedgerHistory(campaign, 'entry', 3, canonical)!.messages[0].content).not.toContain('Bring water');
        const file = path.join(canonical, '.language-ledgers', ledger.id + '.json');
        const bad = JSON.parse(fs.readFileSync(file, 'utf8')); delete bad.messages[0].languageRecord.variants;
        fs.writeFileSync(file, JSON.stringify(bad)); expect(() => loadLedgerHistory(canonical, 'entry', 3)).toThrow();
        fs.unlinkSync(file); expect(() => loadLedgerHistory(canonical, 'entry', 3)).toThrow();
        expect(() => loadLedgerHistory(canonical, '../entry', 3)).toThrow('name');
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test('identical actual summary requests reuse full prose; different perspectives require different requests', async () => {
    const cache = new PerspectiveSummaries(); const api = { complete: jest.fn().mockResolvedValue('A full, ordinary summary.') } as any;
    const clear: Message[] = [{ role: 'system', content: 'Bring water.' }], far: Message[] = [{ role: 'system', content: 'Krag voth.' }];
    expect(await cache.generate(api, clear)).toBe('A full, ordinary summary.'); await cache.generate(api, clear); await cache.generate(api, far);
    expect(api.complete).toHaveBeenCalledTimes(2); cache.clear(); await cache.generate(api, clear); expect(api.complete).toHaveBeenCalledTimes(3);
});
test('retractions remove canonical turns and their perceptions together', () => {
    const { ledger } = fixture(); ledger.remove(['one']); expect(ledger.read(2)).toEqual([]); expect(ledger.read(3)).toEqual([]);
});
