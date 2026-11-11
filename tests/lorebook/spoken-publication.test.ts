import path from 'path';
import { createHash } from 'crypto';
import { GameData } from '../../src/shared/gameData/GameData';
import { character } from '../culture/fixtures';
import { LanguageConversation } from '../../src/main/language/languageConversation';
import { loadLanguageEngine } from '../../src/main/language/languageEngine';
import { ConversationLedger } from '../../src/main/language/conversationLedger';
import { SpokenPublicationSessions, spokenLoreAudience } from '../../src/main/lorebook/lorebookSpokenPublication';
import type { LoreDelivery } from '../../src/main/lorebook/lorebookDisclosure';
import type { Message } from '../../src/main/ts/conversation_interfaces';
const engine = loadLanguageEngine(path.resolve('public/languages'));
const body = 'A fee of three silver coins applies only if the apprentice agrees.';
beforeEach(() => { process.env.VOTC_LORE_SPOKEN_EXPOSURE_STUDY = '1'; });
afterEach(() => { delete process.env.VOTC_LORE_SPOKEN_EXPOSURE_STUDY; });
function fixture() {
    const game = new GameData(['1', 'Visitor', '2', 'Mara', '1066.9.15', 'court', 'County', 'Visitor', '0']);
    for (const [id, language] of [[1, 'language_common'], [2, 'language_common'], [3, 'language_orcish'], [4, 'language_common']] as const) {
        const actor = character(id, 'Actor' + id); actor.languageSnapshot = { version: 1, complete: true, nativeLanguageId: language, knownLanguageIds: [language] };
        game.characters.set(id, actor);
    }
    const ledger = new ConversationLedger(1), conv: any = { gameData: game, isOpen: true,
        get messages() { return this.working ?? ledger.messages; }, getCanonicalEncounterMessagesForLore: () => ledger.messages };
    const actor = game.characters.get(2)!, language = new LanguageConversation(game, engine.renderer), bridge = new SpokenPublicationSessions();
    let sourceCurrent = true;
    const result = () => ({ actor_id: '2', context_fingerprint: 'reader', passages: [{ node_id: 'chapter', subject_id: 'root', heading: 'Qualified account', text: body }],
        state: { version: 'titan-progressive-lore-v2', context: 'reader', root: 'root', focus: 'chapter', shown: ['chapter'] },
        trace: [{ status: 'accepted', node_id: 'chapter', resolved_body_sha256: createHash('sha256').update(body).digest('hex') }] });
    const start = (recipientId = 1, preview = false) => {
        const delivery: LoreDelivery = { scope: conv, channel: 'chat', turns: ledger.messages, preparing: !preview, preview,
            spokenAudience: spokenLoreAudience(conv, actor, recipientId) };
        const session = bridge.prepare(delivery, actor.id, 'binding')!;
        delivery.isCurrent = () => session.isCurrent() && sourceCurrent;
        if (!preview) bridge.bind(delivery, actor.id, result(), delivery.isCurrent);
        return { delivery, session };
    };
    const accept = (started: ReturnType<typeof start>, content = '""' + body + '""', id = 'published') => {
        const message: Message = { id, role: 'assistant', characterId: 2, name: actor.fullName, content, proseEncoding: 'controls-v1', ...(id === 'legacy' ? { proseEncoding: undefined } : {}) };
        language.record(message); // Actual generated delivery precedes acceptance/queue insertion.
        const expected = JSON.stringify([message.content, message.proseEncoding, message.spokenLanguageId, (message as any).targetCharacterIds]);
        const retained = () => conv.isOpen && ledger.messages.includes(message) &&
            expected === JSON.stringify([message.content, message.proseEncoding, message.spokenLanguageId, (message as any).targetCharacterIds]);
        started.session.commit(true, result().state, retained);
        bridge.queue(started.delivery, [{ role: 'system', content: 'Qualified account\n' + body }], message, retained);
        return message;
    };
    const publish = (message: Message) => ledger.append(message, game.characters.values());
    return { game, actor, conv, ledger, bridge, start, accept, publish, revoke: () => { sourceCurrent = false; } };
}
test('queued actual publication settles before a new reader ticket replaces the source ticket', () => {
    const f = fixture(), first = f.start(), message = f.accept(first); expect(first.session.isCurrent()).toBe(true);
    f.publish(message); const next = f.start();
    expect(next.session.previous).toMatchObject({ focus: 'chapter', shown: ['chapter'] });
    expect(first.session.isCurrent()).toBe(false); expect(f.bridge.diagnostics(next.delivery)?.committed).toBe(3);
});
test('actual queued paraphrase advances retrieval while the listener retains only those delivered words', () => {
    const f = fixture(), first = f.start(), speech = 'The apprentice must agree before any silver changes hands.';
    const message = f.accept(first, '""' + speech + '""'); f.publish(message);
    const next = f.start(); expect(next.session.previous).toMatchObject({ focus: 'chapter', shown: ['chapter'], cursor_basis: 'spoken_topic_route' });
    expect(f.ledger.messages[0].content).toBe('""' + speech + '""');
    expect(f.start(3).session.previous).toBeUndefined();
});
test('publication settlement does not inspect captured actors who did not attend', () => {
    const f = fixture(), first = f.start(), message = f.accept(first); f.publish(message);
    let inspectedAbsent = 0;
    (first.delivery.spokenAudience!.listeners as { id: number; isCurrent: () => boolean }[]).push(...Array.from({ length: 1000 }, (_, i) => ({
        id: i + 100, isCurrent: () => { inspectedAbsent++; return true; }
    })));
    expect(f.start().session.previous).toMatchObject({ focus: 'chapter' });
    expect(inspectedAbsent).toBe(0);
    expect(f.bridge.diagnostics(first.delivery)).toMatchObject({ committed: 0 });
});
test('missing recipient ownership preserves a current reader but never an offered-only cursor', () => {
    const f = fixture(), delivery: LoreDelivery = { scope: f.conv, channel: 'chat', turns: f.ledger.messages };
    const first = f.bridge.prepare(delivery, 2, 'binding')!;
    expect(first.isCurrent()).toBe(true); first.commit(true, { focus: 'offered' }, () => true);
    expect(f.bridge.prepare(delivery, 2, 'binding')!.previous).toBeUndefined();
});
test('preview neither consumes pending publication nor supersedes the old ticket or commits a cursor', () => {
    const f = fixture(), first = f.start(), message = f.accept(first);
    expect(f.start(1, true).session.previous).toBeUndefined(); expect(first.session.isCurrent()).toBe(true);
    f.publish(message); const preview = f.start(1, true);
    expect(preview.session.previous).toMatchObject({ focus: 'chapter' }); expect(first.session.isCurrent()).toBe(true);
    expect(f.bridge.diagnostics(preview.delivery)?.committed).toBe(0);
    preview.session.forget(); preview.session.commit(true, { focus: 'forged' }); f.bridge.clear(preview.delivery, 2);
    const next = f.start(); expect(next.session.previous).toMatchObject({ focus: 'chapter' });
    expect(f.bridge.diagnostics(next.delivery)?.committed).toBe(3);
});
test('unretained generation, private-only text and missing legacy ranges do not consume a public chapter', () => {
    for (const mode of ['unretained', 'private', 'legacy']) {
        const f = fixture(), first = f.start(), content = mode === 'private' ? '**She waits.** ~~' + body + '~~' : mode === 'legacy' ? '"' + body + '"' : '""' + body + '""';
        const message = f.accept(first, content, mode === 'legacy' ? 'legacy' : 'published'); if (mode !== 'unretained') f.publish(message);
        expect(f.start().session.previous).toBeUndefined();
    }
});
test('real clear bystander receives its own progress, FAR and a newly arrived listener do not inherit it', () => {
    const f = fixture(), first = f.start(), message = f.accept(first); f.publish(message); f.start();
    expect(f.start(4).session.previous).toMatchObject({ focus: 'chapter' });
    expect(f.start(3).session.previous).toBeUndefined();
    const newcomer = character(5, 'Newcomer'); f.game.characters.set(5, newcomer);
    expect(f.start(5).session.previous).toBeUndefined();
});
test('same body in an earlier message cannot certify a newly private-only publication', () => {
    const f = fixture(), old = f.accept(f.start(), '""' + body + '""', 'old'); f.publish(old); f.start();
    const later = f.start(), silent = f.accept(later, '~~' + body + '~~ **She waits.**', 'new'); f.publish(silent);
    const next = f.start(); expect(next.session.previous).toMatchObject({ focus: 'chapter' });
    expect(f.bridge.diagnostics(next.delivery)?.committed).toBe(0);
});
test('removal, replacement, changed hearing, source revocation and epoch replacement withdraw pending/retained state', () => {
    for (const change of ['remove', 'replace', 'hearing', 'source', 'epoch']) {
        const f = fixture(), first = f.start(), message = f.accept(first); f.publish(message);
        if (change === 'remove') f.ledger.remove([message.id!]);
        if (change === 'replace') (f.ledger.messages as Message[])[0] = structuredClone(message);
        if (change === 'hearing') message.languageRecord!.hearings['1'].mode = 'FAR';
        if (change === 'source') f.revoke();
        if (change === 'epoch') f.game.votcCheckpointEpoch++;
        if (change === 'source') expect(() => f.start()).toThrow('different current actor');
        else expect(f.start().session.previous).toBeUndefined();
    }
    const f = fixture(), message = f.accept(f.start()); f.publish(message); f.start();
    f.ledger.remove([message.id!]); expect(f.start().session.previous).toBeUndefined();
});
test('ordinary offered-state commit cannot substitute for queueing an actual actor publication', () => {
    const f = fixture(), first = f.start(); first.session.commit(true, { focus: 'offered-only' }, () => true);
    expect(f.start().session.previous).toBeUndefined();
});
test('another listeners literary edit preserves an unchanged clear hearing and a forged original cannot bind a pending source', () => {
    const f = fixture(), message = f.accept(f.start()); f.publish(message); f.start();
    const first = f.start();
    expect(() => f.bridge.queue(first.delivery, [{ role: 'system', content: 'No actual admitted source here.' }], message, () => true)).toThrow('Whole admitted body');
    const h = message.languageRecord!.hearings['3']; message.languageRecord!.variants[h.variant] += ' (different sound)';
    expect(f.start(1).session.previous).toMatchObject({ focus: 'chapter' });
});
test('feature OFF delegates to original sessions and audience helper refuses replaced actor/recipient ownership', () => {
    const f = fixture(); delete process.env.VOTC_LORE_SPOKEN_EXPOSURE_STUDY;
    expect(spokenLoreAudience(f.conv, f.actor)).toBeUndefined();
    expect(f.bridge.prepare({ scope: f.conv, channel: 'chat', turns: [] }, 2, 'binding')).toBeUndefined();
    process.env.VOTC_LORE_SPOKEN_EXPOSURE_STUDY = '1'; const audience = spokenLoreAudience(f.conv, f.actor)!;
    f.game.characters.set(1, { ...f.game.characters.get(1)! } as any); expect(audience.isCurrent()).toBe(false);
    expect(spokenLoreAudience(f.conv, { ...f.actor } as any)).toBeUndefined();
});
test('working-context compaction preserves a canonical publication and working-only drafts cannot establish it', () => {
    const f = fixture(), message = f.accept(f.start()); f.publish(message); f.conv.working = [];
    expect(f.start().session.previous).toMatchObject({ focus: 'chapter' });
    const g = fixture(), draft = g.accept(g.start()); g.conv.working = [draft];
    expect(g.start().session.previous).toBeUndefined();
});

test('a verified tool-only account advances only the listeners who actually understood its publication', () => {
    const f=fixture(), first=f.start();
    const result={actor_id:'2',context_fingerprint:'reader',passages:[{node_id:'tool-chapter',subject_id:'root',heading:'Apprenticeship fees',text:body}],
        state:{version:'titan-progressive-lore-v2',context:'reader',root:'root',focus:'tool-chapter',shown:['tool-chapter']},
        trace:[{status:'accepted',node_id:'tool-chapter',resolved_body_sha256:createHash('sha256').update(body).digest('hex')}]};
    f.bridge.bind(first.delivery,2,{...result,passages:[],trace:[]},first.delivery.isCurrent!);
    (f.bridge as any).addToolResult?.(first.delivery,2,result);
    const message=f.accept(first); f.publish(message);
    expect(f.start().session.previous).toMatchObject({focus:'tool-chapter'});
    expect(f.start(3).session.previous).toBeUndefined();
});
test('merely returning a verified tool account grants no listener progress', () => {
    const f=fixture(), first=f.start();
    const text='A fee of three silver coins applies only if the apprentice agrees.';
    const next={actor_id:'2',context_fingerprint:'reader',passages:[{node_id:'new-tool',subject_id:'root',heading:'Tool account',text}],
        trace:[{status:'accepted',node_id:'new-tool',resolved_body_sha256:createHash('sha256').update(text).digest('hex')}]};
    f.bridge.addToolResult(first.delivery,2,next);
    expect(f.start().session.previous).toBeUndefined();
});
