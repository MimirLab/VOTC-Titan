import path from 'path';
import { createHash } from 'crypto';
import { GameData } from '../../src/shared/gameData/GameData';
import { character } from '../culture/fixtures';
import { LanguageConversation } from '../../src/main/language/languageConversation';
import { loadLanguageEngine } from '../../src/main/language/languageEngine';
import { ConversationLedger } from '../../src/main/language/conversationLedger';
import type { Message } from '../../src/main/ts/conversation_interfaces';
import { DisclosureSessions } from '../../src/main/lorebook/lorebookDisclosure';
import { captureSpokenLoreExposure, assertSpokenLoreExposure, bindSpokenLoreAccounts,
    literalSpokenLoreCoverage, lexicalSpokenLoreTopics, SpokenLoreContext, SpokenLoreProgress } from '../../src/main/lorebook/lorebookSpokenExposure';

const engine = loadLanguageEngine(path.resolve('public/languages'));
const body = 'A fee of three silver coins applies only if the apprentice agrees.';
function fixture(content = '**She waits.** ""' + body + '"" ~~She remembers "PRIVATE_ORCHID".~~') {
    const game = new GameData(['1', 'Player', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Player', '0']);
    for (const [id, tongue] of [[1, 'language_low_common'], [2, 'language_common'], [3, 'language_orcish'], [4, 'language_common']] as const) {
        const actor = character(id, 'Actor' + id); actor.languageSnapshot = { version: 1, complete: true,
            nativeLanguageId: tongue, knownLanguageIds: [tongue] }; game.characters.set(id, actor);
    }
    const session = new LanguageConversation(game, engine.renderer), ledger = new ConversationLedger(game.playerID);
    const message: Message = { id: 'actual-publication', role: 'assistant', characterId: 2, name: 'Actor2', content, proseEncoding: 'controls-v1' };
    session.record(message); ledger.append(message, game.characters.values());
    let current = true;
    const context = (recipientId = 4): SpokenLoreContext => ({ scope: ledger, channel: 'chat', epoch: 'epoch1',
        binding: 'campaign/timeline/edition/actor-owner', recipientId, playerId: 1, messages: () => ledger.messages, isCurrent: () => current });
    const input = { original: [{ role: 'system' as const, content: 'Qualified account\n' + body }], actorId: 2,
        isCurrent: () => current, result: { actor_id: '2', context_fingerprint: 'reader-context', passages: [{ node_id: 'chapter', subject_id: 'root', heading: 'Qualified account', text: body }],
            state: { version: 'titan-progressive-lore-v2', context: 'reader-context', root: 'root', focus: 'chapter', shown: ['chapter'] },
            trace: [{ status: 'accepted', node_id: 'chapter', resolved_body_sha256: createHash('sha256').update(body).digest('hex') }] } };
    const accounts = bindSpokenLoreAccounts(input);
    return { game, session, ledger, message, context, accounts, input, revoke: () => { current = false; } };
}
test('actual CLEAR listener gets exact spoken report and full qualified body, not private or written words', () => {
    const f = fixture('**She points to the written "SIGN_IRIS".** ""' + body + '"" ~~She recalls "PRIVATE_ORCHID".~~'), c = f.context(), v = captureSpokenLoreExposure(c);
    expect(v.complete).toBe(true); expect(v.reports.map(r => r.text)).toEqual([body]);
    expect(JSON.stringify(v)).not.toMatch(/SIGN_IRIS|PRIVATE_ORCHID|utterance|languageRecord|variants|hearings/);
    const coverage = literalSpokenLoreCoverage(v, c, f.accounts); expect(coverage).toHaveLength(1);
    expect(coverage[0]).toMatchObject({ nodeId: 'chapter', speakerId: 2, recipientId: 4, interpretation: 'attributed_report_only', grantsKnowledge: false });
    const heard = f.session.forRecipient(f.message, 4).content;
    expect(heard.slice(coverage[0].range.start, coverage[0].range.end)).toBe(body);
});
test('own inner narration remains private even though actual author projection retains it', () => {
    const f = fixture('~~' + body + '~~ **She waits.**'), c = f.context(2), v = captureSpokenLoreExposure(c);
    expect(f.session.forRecipient(f.message, 2).content).toContain(body);
    expect(v.reports).toEqual([]); expect(literalSpokenLoreCoverage(v, c, f.accounts)).toEqual([]);
});
test('offered account and retained nonverbal publication reproduce the old cursor gap without spoken coverage', () => {
    const f = fixture('**She folds the cloth.** ~~' + body + '~~'), scope = {}, turn = { id: 'question', content: 'Tell me more.' };
    const sessions = new DisclosureSessions();
    sessions.prepare({ scope, channel: 'chat', turns: [turn] }, 2, 'b').commit(true, { focus: 'chapter' }, () => f.ledger.messages.includes(f.message));
    expect(sessions.prepare({ scope, channel: 'chat', turns: [turn, { id: 'next', content: 'Go on.' }] }, 2, 'b').previous).toEqual({ focus: 'chapter' });
    const c = f.context(), v = captureSpokenLoreExposure(c); expect(literalSpokenLoreCoverage(v, c, f.accounts)).toEqual([]);
});
test('actual FAR hearing cannot recover the admitted source from the canonical message or later fluency', () => {
    const f = fixture(), c = f.context(3), v = captureSpokenLoreExposure(c);
    expect(v.reports).toEqual([]); expect(v.gaps.some(g => g.reason === 'unintelligible_speech')).toBe(true);
    expect(literalSpokenLoreCoverage(v, c, f.accounts)).toEqual([]);
    f.game.characters.get(3)!.languageSnapshot!.knownLanguageIds.push('language_common');
    expect(captureSpokenLoreExposure(f.context(3)).reports).toEqual([]);
});
test('actual CLOSE delivered fragments remain uncertain and cannot certify a complete source', () => {
    const f = fixture(), c = f.context(1), v = captureSpokenLoreExposure(c);
    expect(v.complete).toBe(false); expect(v.gaps.some(g => g.reason === 'partial_speech')).toBe(true);
    expect(v.reports.every(r => r.understanding === 'partial')).toBe(true);
    expect(literalSpokenLoreCoverage(v, c, f.accounts)).toEqual([]);
    for (const report of v.reports) expect(f.session.forRecipient(f.message, 1).content.slice(report.range.start, report.range.end)).toBe(report.text);
});

test('a short natural paraphrase routes a topic without certifying the whole account', () => {
    const f = fixture('**She lowers her cup.** ""The apprentice must agree before any silver changes hands.""'), c = f.context(), v = captureSpokenLoreExposure(c);
    expect(literalSpokenLoreCoverage(v, c, f.accounts)).toEqual([]);
    expect(new SpokenLoreProgress().propose(v, c, f.accounts)).toBeUndefined();
    expect(lexicalSpokenLoreTopics(v, c, f.accounts)).toEqual([expect.objectContaining({ nodeId: 'chapter',
        interpretation: 'topic_routing_only', wholeAccountDisclosed: false, grantsKnowledge: false })]);
    const progress = new SpokenLoreProgress('topic');
    expect(progress.record(v, c, f.accounts)).toBe(true);
    expect(progress.previous(c, 2)).toMatchObject({ focus: 'chapter', shown: ['chapter'], focus_origin: 'dialogue', cursor_basis: 'spoken_topic_route' });
});
test('separate clear spoken ranges can engage a topic while complete literal coverage stays absent', () => {
    const f = fixture('""The apprentice decides."" **She sets down her cup.** ""Silver is involved, so let us ask first.""'), c = f.context(), v = captureSpokenLoreExposure(c);
    expect(v.reports).toHaveLength(2); expect(literalSpokenLoreCoverage(v, c, f.accounts)).toEqual([]);
    expect(lexicalSpokenLoreTopics(v, c, f.accounts)[0].matchedTerms).toEqual(expect.arrayContaining(['apprentice', 'silver']));
    expect(new SpokenLoreProgress('topic').propose(v, c, f.accounts)).toMatchObject({ focus: 'chapter' });
});
test('quiet, deferred, refused, unrelated, partial, private and header-only words cannot establish a new dialogue topic', () => {
    const controls = ['**She waits.**', '""I am here.""', '""Qualified account.""',
        '""The silver and the apprentice can wait. I am here.""',
        '""We can discuss the apprentice and silver tomorrow. Stay beside me.""',
        '""I will not discuss the apprentice or silver.""',
        '""I won’t discuss the apprentice or silver.""',
        '""A shawl rests on the bench."" ~~The apprentice must agree before any silver changes hands.~~'];
    for (const content of controls) {
        const f = fixture(content), c = f.context(), v = captureSpokenLoreExposure(c);
        expect(lexicalSpokenLoreTopics(v, c, f.accounts)).toEqual([]);
        expect(new SpokenLoreProgress('topic').propose(v, c, f.accounts)).toBeUndefined();
    }
    const f = fixture('""The apprentice must agree before any silver changes hands.""');
    for (const recipient of [1, 3]) {
        const c = f.context(recipient), v = captureSpokenLoreExposure(c);
        expect(lexicalSpokenLoreTopics(v, c, f.accounts)).toEqual([]);
        expect(new SpokenLoreProgress('topic').propose(v, c, f.accounts)).toBeUndefined();
    }
});
test('topic routing preserves substantive negation but is explicitly not a factuality or qualifier check', () => {
    for (const speech of ['The apprentice cannot be forced to pay silver.', 'The apprentice must pay silver whether she agrees or not.']) {
        const f = fixture('""' + speech + '""'), c = f.context(), v = captureSpokenLoreExposure(c);
        expect(literalSpokenLoreCoverage(v, c, f.accounts)).toEqual([]);
        expect(lexicalSpokenLoreTopics(v, c, f.accounts)[0]).toMatchObject({ wholeAccountDisclosed: false, grantsKnowledge: false });
        expect(new SpokenLoreProgress('topic').propose(v, c, f.accounts)).toMatchObject({ focus: 'chapter' });
    }
});
test('a dialogue topic cannot import another offered but unspoken account or an unadmitted chapter', () => {
    const f = fixture('""The apprentice must agree before any silver changes hands.""'), c = f.context(), v = captureSpokenLoreExposure(c);
    const other = 'The coral memorial records favors and inherited obligations.';
    f.input.original.push({ role: 'system', content: 'Other account\n' + other });
    f.input.result.passages.push({ node_id: 'unspoken', subject_id: 'root', heading: 'Other account', text: other });
    f.input.result.trace.push({ status: 'accepted', node_id: 'unspoken', resolved_body_sha256: createHash('sha256').update(other).digest('hex') });
    f.input.result.state.shown = ['unspoken', 'chapter'];
    const accounts = bindSpokenLoreAccounts(f.input), progress = new SpokenLoreProgress('topic');
    expect(progress.propose(v, c, accounts)).toMatchObject({ shown: ['chapter'], focus: 'chapter' });
    f.input.result.state.shown.push('not-admitted');
    expect(() => progress.propose(v, c, bindSpokenLoreAccounts(f.input))).toThrow('chapters not heard');
});
test('topic evidence retains canonical publication and bound-source ownership checks', () => {
    const f = fixture('""The apprentice must agree before any silver changes hands.""'), c = f.context(), v = captureSpokenLoreExposure(c);
    expect(() => lexicalSpokenLoreTopics(v, c, JSON.parse(JSON.stringify(f.accounts)))).toThrow();
    expect(() => lexicalSpokenLoreTopics(JSON.parse(JSON.stringify(v)), c, f.accounts)).toThrow();
    f.message.content += ' changed';
    expect(() => new SpokenLoreProgress('topic').propose(v, c, f.accounts)).toThrow();
});
test('a bystander can hear while explicit targets cannot make an absent actor hear', () => {
    const f = fixture(); (f.message as any).targetCharacterIds = [1];
    expect(captureSpokenLoreExposure(f.context(4)).reports).toHaveLength(1);
    f.message.observedByCharacterIds = [1, 2, 3];
    (f.message as any).targetCharacterIds = [4]; const c = f.context(4), v = captureSpokenLoreExposure(c);
    expect(v.reports).toEqual([]); expect(literalSpokenLoreCoverage(v, c, f.accounts)).toEqual([]);
});
test('projected literary or knowledge copies cannot stand in for canonical publication', () => {
    for (const purpose of ['reader', 'knowledge'] as const) {
        const f = fixture(), c = f.context(1), copies = [f.session.forRecipient(f.message, 1, purpose)]; c.messages = () => copies;
        const v = captureSpokenLoreExposure(c); expect(v.reports).toEqual([]);
        expect(v.gaps.some(g => g.reason === 'projected_or_literary_input')).toBe(true);
    }
});
test('missing attendance, hearing or boundaries remain explicit gaps rather than inferred disclosure', () => {
    for (const change of ['attendance', 'hearing', 'legacy']) {
        const f = fixture(), c = f.context();
        if (change === 'attendance') delete f.message.observedByCharacterIds;
        if (change === 'hearing') delete f.message.languageRecord!.hearings['4'];
        if (change === 'legacy') {
            const legacy: Message[] = [{ id: 'legacy', role: 'assistant', characterId: 2, content: '"' + body + '"', observedByCharacterIds: [4] }];
            c.messages = () => legacy;
        }
        const v = captureSpokenLoreExposure(c); expect(v.complete).toBe(false); expect(v.reports).toEqual([]);
    }
});
test('unchanged bytes in a replacement object, edited/removed publications and audience changes invalidate old views', () => {
    for (const change of ['replace', 'edit', 'remove', 'audience', 'hearing']) {
        const f = fixture(), c = f.context(), v = captureSpokenLoreExposure(c);
        if (change === 'replace') (f.ledger.messages as Message[])[0] = structuredClone(f.message);
        if (change === 'edit') f.message.content += ' ';
        if (change === 'remove') f.ledger.remove([f.message.id!]);
        if (change === 'audience') f.message.observedByCharacterIds = f.message.observedByCharacterIds!.filter(id => id !== 4);
        if (change === 'hearing') f.message.languageRecord!.hearings['4'].mode = 'FAR';
        expect(() => assertSpokenLoreExposure(v, c)).toThrow();
    }
});
test('scope, epoch, recipient, channel, source binding and currentness cannot be relabeled on a captured view', () => {
    for (const change of ['scope', 'epoch', 'recipient', 'channel', 'binding', 'current', 'callback']) {
        const f = fixture(), c = f.context(), v = captureSpokenLoreExposure(c);
        if (change === 'scope') c.scope = {};
        if (change === 'epoch') c.epoch = 'epoch2';
        if (change === 'recipient') c.recipientId = 3;
        if (change === 'channel') c.channel = 'letter';
        if (change === 'binding') c.binding = 'other-campaign';
        if (change === 'current') f.revoke();
        if (change === 'callback') c.isCurrent = () => true;
        expect(() => assertSpokenLoreExposure(v, c)).toThrow();
    }
    const f = fixture(), c = f.context(), v = captureSpokenLoreExposure(c);
    expect(() => assertSpokenLoreExposure(JSON.parse(JSON.stringify(v)), c)).toThrow();
    const letter = { ...c, channel: 'letter' as const }, lv = captureSpokenLoreExposure(letter);
    expect(lv.complete).toBe(false); expect(lv.reports).toEqual([]); expect(lv.gaps[0].reason).toBe('letter_read_receipt_unavailable');
});
test('whole qualifiers and actual speaker identity are necessary for literal account coverage', () => {
    for (const text of ['A fee of three silver coins applies.', 'Only if the apprentice agrees, a fee of three silver coins applies.']) {
        const f = fixture('""' + text + '""'), c = f.context(), v = captureSpokenLoreExposure(c);
        expect(v.reports[0].text).toBe(text); expect(literalSpokenLoreCoverage(v, c, f.accounts)).toEqual([]);
    }
    const f = fixture(), c = f.context(), v = captureSpokenLoreExposure(c);
    f.input.actorId = 3; f.input.result.actor_id = '3';
    const another = bindSpokenLoreAccounts(f.input); expect(literalSpokenLoreCoverage(v, c, another)).toEqual([]);
});
test('private source handles cannot be reconstructed or mutated into new admitted bodies', () => {
    for (const change of ['body', 'original', 'actor', 'trace']) {
        const f = fixture(), c = f.context(), v = captureSpokenLoreExposure(c);
        if (change === 'body') f.input.result.passages[0].text += ' extra';
        if (change === 'original') f.input.original[0].content = 'other';
        if (change === 'actor') f.input.actorId = 3;
        if (change === 'trace') f.input.result.trace[0].resolved_body_sha256 = 'bad';
        expect(() => literalSpokenLoreCoverage(v, c, f.accounts)).toThrow();
        expect(() => bindSpokenLoreAccounts(f.input)).toThrow();
    }
    const f = fixture(), c = f.context(), v = captureSpokenLoreExposure(c);
    expect(() => literalSpokenLoreCoverage(v, c, JSON.parse(JSON.stringify(f.accounts)))).toThrow();
});
test('captured reports do not certify false surrounding claims even when an exact account is heard', () => {
    const f = fixture('""Every master follows this rule: ' + body + '""'), c = f.context(), v = captureSpokenLoreExposure(c);
    expect(literalSpokenLoreCoverage(v, c, f.accounts)).toHaveLength(1);
    expect(v.grantsKnowledge).toBe(false); expect(v.reports[0].interpretation).toBe('attributed_speech');
});
test('history and speech budgets declare omissions while preserving whole delivered ranges', () => {
    const f = fixture(), c = f.context();
    const many = Array.from({ length: 130 }, (_, index) => ({ id: String(index), role: 'system' as const, content: 'event' }));
    c.messages = () => many;
    const v = captureSpokenLoreExposure(c); expect(v.earlierTurnsOmitted).toBe(2); expect(v.complete).toBe(false);
    const huge = f.context(); huge.messages = () => [{ ...f.message, content: 'a'.repeat(2_000_001) }];
    expect(() => captureSpokenLoreExposure(huge)).toThrow('budget');
});
test('append-only history retains past receipts; actual removal or replacement withdraws them through the same getter', () => {
    const f = fixture(), c = f.context(), v = captureSpokenLoreExposure(c);
    f.ledger.append({ id: 'next', role: 'user', characterId: 1, content: 'More?' }, f.game.characters.values());
    expect(() => assertSpokenLoreExposure(v, c)).not.toThrow();
    expect(v.capturedThroughMessageCount).toBe(1); expect(c.messages()).toHaveLength(2);
    f.ledger.remove([f.message.id!]); expect(() => assertSpokenLoreExposure(v, c)).toThrow();
});
test('recipient progress needs heard whole-source coverage and survives later turns without granting knowledge', () => {
    const f = fixture(), c = f.context(), v = captureSpokenLoreExposure(c), progress = new SpokenLoreProgress();
    expect(progress.record(v, c, f.accounts)).toBe(true);
    f.ledger.append({ id: 'next', role: 'user', characterId: 4, content: 'Tell me more.' }, f.game.characters.values());
    const next = f.context(); expect(progress.previous(next, 2)).toEqual(f.input.result.state);
    const copy = progress.previous(next, 2) as any; copy.shown.push('forged');
    expect(progress.previous(next, 2)).toEqual(f.input.result.state);
    expect(progress.previous(f.context(3), 2)).toBeUndefined(); expect(progress.previous(next, 3)).toBeUndefined();
    for (const altered of [{ ...next, epoch: 'epoch2' }, { ...next, binding: 'other' }, { ...next, channel: 'letter' as const }, { ...next, scope: {} }])
        expect(progress.previous(altered, 2)).toBeUndefined();
    f.ledger.remove([f.message.id!]); expect(progress.previous(next, 2)).toBeUndefined();
});
test('silent and private-only replies do not commit spoken progress, and another listeners cursor cannot be laundered', () => {
    const f = fixture('**She waits.** ~~' + body + '~~'), c = f.context(), v = captureSpokenLoreExposure(c), progress = new SpokenLoreProgress();
    expect(progress.record(v, c, f.accounts)).toBe(false); expect(progress.previous(c, 2)).toBeUndefined();
    const g = fixture(), gc = g.context(), gv = captureSpokenLoreExposure(gc);
    g.input.result.state.shown.push('another-listeners-secret');
    const forged = bindSpokenLoreAccounts(g.input);
    expect(() => progress.record(gv, gc, forged)).toThrow('not heard');
});
test('another listeners literary/perception edit does not invalidate an unchanged actual hearing', () => {
    const f = fixture(), c = f.context(4), v = captureSpokenLoreExposure(c), before = f.session.forRecipient(f.message, 4);
    const playerReader = f.session.forRecipient(f.message, 1, 'reader');
    f.session.editForRecipient(f.message, 1, playerReader.editableContent!.replace('PRIVATE_ORCHID', 'PRIVATE_LILY'), 'reader');
    expect(f.session.forRecipient(f.message, 4)).toEqual(before);
    expect(() => assertSpokenLoreExposure(v, c)).not.toThrow();
});
test('invalid private/opaque overlap and duplicate publication IDs cannot supply speech evidence', () => {
    const f = fixture(), hearing = f.message.languageRecord!.hearings['2'];
    const spans = f.message.languageRecord!.variantSpans![hearing.variant], privateSpan = spans.proseSpans.find(s => s.kind === 'private')!;
    (spans as any).speechSpans = [{ start: privateSpan.start + 1, end: privateSpan.end - 1 }];
    const own = captureSpokenLoreExposure(f.context(2)); expect(own.reports).toEqual([]);
    expect(own.gaps.some(g => g.reason === 'invalid_recorded_speech_boundaries')).toBe(true);
    const g = fixture(), h = g.message.languageRecord!.hearings['4'];
    g.message.languageRecord!.variantOpaqueSpeech = { [h.variant]: [{ start: 0, end: 1 }] };
    const opaque = captureSpokenLoreExposure(g.context(4)); expect(opaque.reports).toEqual([]);
    expect(opaque.gaps.some(gap => gap.reason === 'invalid_recorded_speech_boundaries')).toBe(true);
    const duplicate = fixture(), c = duplicate.context(), copies = [duplicate.message, structuredClone(duplicate.message)]; c.messages = () => copies;
    const v = captureSpokenLoreExposure(c); expect(v.reports).toEqual([]); expect(v.gaps.every(gap => gap.reason === 'missing_or_duplicate_publication_id')).toBe(true);
});
test('long delivered speech is omitted as a whole with an explicit budget gap rather than clipping qualifiers', () => {
    const f = fixture('""' + 'x'.repeat(64_001) + '""'), v = captureSpokenLoreExposure(f.context());
    expect(v.reports).toEqual([]); expect(v.complete).toBe(false); expect(v.gaps.some(g => g.reason === 'delivered_speech_budget')).toBe(true);
});
test('Unicode offsets retain actual heard bytes and complete non-English source qualifiers', () => {
    const text = 'Trois pièces d’argent, uniquement avec son accord.', f = fixture('**Elle attend.** ""😀 ' + text + '""'), c = f.context();
    f.input.result.passages[0].text = text; f.input.original[0].content = 'Qualified account\n' + text;
    f.input.result.trace[0].resolved_body_sha256 = createHash('sha256').update(text).digest('hex');
    const accounts = bindSpokenLoreAccounts(f.input), v = captureSpokenLoreExposure(c), coverage = literalSpokenLoreCoverage(v, c, accounts);
    expect(coverage).toHaveLength(1); const range = coverage[0].range;
    expect(f.session.forRecipient(f.message, 4).content.slice(range.start, range.end)).toBe(text);
});
test('split speech and natural paraphrases stay heard reports without claiming full chapter completion', () => {
    const f = fixture('""A fee of three silver coins applies"" **She pauses.** ""only if the apprentice agrees.""'), c = f.context(), v = captureSpokenLoreExposure(c);
    expect(v.reports).toHaveLength(2); expect(v.reports[1].text).toContain('only if');
    expect(literalSpokenLoreCoverage(v, c, f.accounts)).toEqual([]);
    expect(new SpokenLoreProgress().record(v, c, f.accounts)).toBe(false);
});
