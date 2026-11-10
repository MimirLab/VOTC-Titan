import fs from 'fs';
import path from 'path';
import os from 'os';
import { CloseEncoder } from '../../src/main/language/closeEncoder';
import { CloseProfileData, CloseProfiles } from '../../src/main/language/closeProfiles';
import { LanguageEngine, loadLanguageEngine } from '../../src/main/language/languageEngine';
import { LanguageConversation } from '../../src/main/language/languageConversation';
import { GameData } from '../../src/shared/gameData/GameData';
import { character } from '../culture/fixtures';
import { Message } from '../../src/main/ts/conversation_interfaces';

const json = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const data = (): CloseProfileData => json('public/languages/close-profiles.json');
const routing = json('public/languages/routing.json');
function probe(cadence: [string, string][], ordinary: [string, string][] = [['th', 'dh'], ['a', 'o'], ['er$', 'ur']]) {
    const profiles = data();
    profiles.profiles.language_common = { label: 'Probe', signature: 'Synthetic cadence test', rules: ordinary, cadence_rules: cadence };
    return new CloseEncoder(new CloseProfiles(profiles, routing));
}

test('one preferred ending shares the existing rewrite budget with original-root changes', () => {
    const encoder = probe([['r$', 'ra']]);
    expect(encoder.word('water', 'language_common')).toBe('watera');
    expect(encoder.word('thunderer', 'language_common')).toBe('dhunderera');
    expect(encoder.word('THUNDERER', 'language_common')).toBe('DHUNDERERA');
    expect(encoder.speech('Water, water! 42\r\n𐐀water İwater', 'language_common'))
        .toBe('Watera, watera! 42\r\n𐐀watera İwatera');
});
test('cadence rules do not cascade or displace letters using rewritten offsets', () => {
    const encoder = probe([['r$', 'ra']], [['ra', 'zo'], ['th', 'dh']]);
    expect(encoder.word('water', 'language_common')).toBe('watera');
    expect(encoder.word('thunderer', 'language_common')).toBe('dhunderera');
    expect(probe([['e', 'ae']]).word('thunderer', 'language_common')).toBe('dhundaerer');
    expect(probe([['r$', 'r']]).word('thunderer', 'language_common')).toBe('dhunderur');
});
test('missing optional cadence keeps the original left-to-right selection', () => {
    const encoder = probe([], [['th', 'dh'], ['a', 'o'], ['er$', 'ur']]);
    expect(encoder.word('water', 'language_common')).toBe('woter');
    expect(encoder.word('thunderer', 'language_common')).toBe('dhunderur');
});
test('malformed, unbounded and zero-width cadence banks are rejected', () => {
    for (const cadence of [null, [['(?=z)', 'a']], [['r$', '']], Array(17).fill(['r$', 'ra'])]) {
        const profiles = data();
        profiles.profiles.language_common.cadence_rules = cadence as any;
        expect(() => new CloseProfiles(profiles, routing)).toThrow();
    }
});

const archive = json('public/languages/voice-revisions.json').engines[0];
function revisions() {
    const old = new LanguageEngine(archive.data);
    const revised = structuredClone(archive.data);
    revised.close.close_version = 'cadence-fixture';
    revised.close.profiles.language_darnassian.cadence_rules = [['(?<=[a-z]{3})r$', 'ra']];
    const next = new LanguageEngine(revised);
    next.renderer.registerRecordedProfile(old.renderer);
    return { old, next };
}
test.each([false, true])('source edits retain the archived voice and historical plan (partial=%s)', partial => {
    const { old, next } = revisions();
    const game = new GameData(['1', 'Listener', '2', 'Speaker', '1066.9.15', 'court', 'Room', 'Listener', '0']);
    for (const [id, native] of [[1, 'language_thalassian'], [2, 'language_darnassian'], [3, 'language_orcish']] as const) {
        const actor = character(id, 'Synthetic' + id);
        actor.languageSnapshot = { version: 1, complete: true, nativeLanguageId: native, knownLanguageIds: [native],
            ...(partial ? { learning: 12 } : {}) };
        game.characters.set(id, actor);
    }
    const previous = new LanguageConversation(game, old.renderer, 'en', partial);
    const message: Message = { id: 'archive', role: 'assistant', characterId: 2, name: 'Synthetic2',
        content: '*He points.* "Bring water before dawn."' };
    previous.record(message);
    const record = structuredClone(message.languageRecord!);
    const delivered = previous.forRecipient(message, 1).content;
    const current = new LanguageConversation(game, next.renderer, 'en', partial);
    expect(current.forRecipient(message, 1).content).toBe(delivered);
    game.characters.get(1)!.languageSnapshot!.knownLanguageIds.push('language_darnassian');
    if (partial) game.characters.get(1)!.languageSnapshot!.learning = 100;
    current.editForRecipient(message, 2, '*He points.* "Bring water to the gate before dawn."');
    expect(message.languageRecord!.fingerprint).toBe(record.fingerprint);
    for (const [id, hearing] of Object.entries(record.hearings)) {
        const expected = hearing.plan
            ? old.renderer.forPlan(message.utterance!, hearing.plan, record.locale, Number(id) === 2)
            : old.renderer.forMode(message.utterance!, hearing.mode, record.locale, Number(id) === 2);
        expect(current.forRecipient(message, Number(id)).content).toBe(expected.content);
        expect(message.languageRecord!.hearings[id].plan).toEqual(hearing.plan);
    }
});
test('a corrupt archived fingerprint is rejected before an old voice can be used', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'close-archive-'));
    try {
        for (const file of ['routing.json', 'close-profiles.json', 'far-profiles.json', 'unicode-casefold.json'])
            fs.copyFileSync(path.join('public/languages', file), path.join(folder, file));
        fs.writeFileSync(path.join(folder, 'voice-revisions.json'), JSON.stringify({ version: 1,
            engines: [{ fingerprint: '0'.repeat(64), data: archive.data }] }));
        expect(() => loadLanguageEngine(folder)).toThrow('fingerprint mismatch');
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
