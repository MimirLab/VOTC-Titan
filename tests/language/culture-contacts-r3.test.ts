import fs from 'fs';
import { LanguageEngine, loadLanguageEngine } from '../../src/main/language/languageEngine';
import { languageCaptureBody, languageCaptureCatalog, LanguageLogReader } from '../../src/main/language/languageCapture';
import { LanguageConversation } from '../../src/main/language/languageConversation';
import { GameData } from '../../src/shared/gameData/GameData';
import { parseCk3Script } from '../../src/main/culture/ck3Script';
import { catalog, character, fact } from '../culture/fixtures';

const json = (name: string) => JSON.parse(fs.readFileSync(`public/languages/${name}.json`, 'utf8'));
const routing = json('routing'), engine = loadLanguageEngine('public/languages');
const native: Record<string, string> = {
    tirassian: 'common', theramore: 'common', pirate_culture: 'common', northsea: 'common',
    gilnean: 'common', goblin: 'goblin', blackwater: 'goblin', gilblin: 'goblin',
    vulpera: 'vulpera', tortollan: 'tortollan', tuskarr: 'tuskarr', grummle: 'mogu', zandalari: 'zandali'
};
function listener(culture: string, learnedLanguageIds: string[] = []) {
    return { nativeLanguageId: `language_${native[culture]}`, learnedLanguageIds,
        currentCultureId: culture, parentCultureIds: routing.static_culture_parent_ids[culture] ?? [] };
}

test.each([
    ['tirassian', 'goblin'], ['theramore', 'goblin'],
    ['pirate_culture', 'goblin'], ['pirate_culture', 'zandali'],
    ['northsea', 'goblin'], ['northsea', 'zandali'],
    ['goblin', 'common'], ['goblin', 'orcish'], ['goblin', 'zandali'],
    ['blackwater', 'common'], ['blackwater', 'orcish'], ['blackwater', 'zandali'],
    ['vulpera', 'zandali'], ['vulpera', 'sethrak'],
    ['tortollan', 'common'], ['tortollan', 'zandali'], ['tuskarr', 'common']
])('%s has direct CLOSE familiarity with %s', (culture, spoken) => {
    expect(engine.route(`language_${spoken}`, listener(culture))).toMatchObject({ mode: 'CLOSE', reason: 'cultural_contact' });
    expect(engine.route(`language_${spoken}`, listener(culture, [`language_${spoken}`])).mode).toBe('CLEAR');
});

test.each([
    ['pirate_culture', 'orcish'], ['northsea', 'orcish'],
    ['tirassian', 'zandali'], ['theramore', 'zandali'], ['gilnean', 'goblin'],
    ['tuskarr', 'goblin'], ['tuskarr', 'zandali'], ['tuskarr', 'orcish'],
    ['vulpera', 'common'], ['vulpera', 'orcish'], ['tortollan', 'goblin'], ['tortollan', 'orcish'],
    ['grummle', 'common'], ['grummle', 'zandali'],
    ['gilblin', 'common'], ['gilblin', 'orcish'], ['gilblin', 'zandali'], ['zandalari', 'vulpera']
])('%s receives no unapproved or reciprocal familiarity with %s', (culture, spoken) => {
    expect(engine.route(`language_${spoken}`, listener(culture))).toMatchObject({ mode: 'FAR', reason: 'no_relationship' });
});

test('Common remains known to the human ports and Mogu remains known to Grummle', () => {
    for (const culture of ['tirassian', 'theramore', 'pirate_culture', 'northsea'])
        expect(engine.route('language_common', listener(culture)).mode).toBe('CLEAR');
    expect(engine.route('language_mogu', listener('grummle')).mode).toBe('CLEAR');
});

test('new roots inherit through current ancestry without broadening every human or maritime culture', () => {
    expect(engine.route('language_goblin', { ...listener('tirassian'), currentCultureId: 'new_hybrid', parentCultureIds: ['tirassian'] }).mode).toBe('CLOSE');
    expect(engine.route('language_zandali', { ...listener('northsea'), currentCultureId: 'new_hybrid', parentCultureIds: ['northsea', 'tirassian'] }).mode).toBe('CLOSE');
    expect(engine.route('language_zandali', { ...listener('tirassian'), currentCultureId: 'new_hybrid', parentCultureIds: ['tirassian'] }).mode).toBe('FAR');
});

test('new complete culture observations reach listener rendering without adding learned languages', () => {
    const inventory = languageCaptureCatalog({ ...catalog(), facts: engine.relations.languageIds().map(id => fact('pillar', id, 'language')) }, engine.relations)!;
    const script = languageCaptureBody(inventory);
    expect(() => parseCk3Script(script)).not.toThrow();
    expect(script).toContain('culture:pirate_culture');
    expect(inventory.cultureRules).toHaveLength(31);
    const frame = [`VOTC:LANGUAGE/;/begin/;/1/;/${inventory.digest}`, 'VOTC:LANGUAGE/;/native/;/language_vulpera',
        'VOTC:LANGUAGE/;/learning/;/1',
        ...inventory.languageIds.map(id => `VOTC:LANGUAGE/;/known/;/${id}/;/${Number(id === 'language_vulpera')}`),
        ...inventory.cultureRules!.map(rule => `VOTC:LANGUAGE/;/contact/;/${rule.id}/;/${Number(rule.id === 'vulpera_voldun_caravan_contacts')}`), ...inventory.practiceRules!.map(rule => `VOTC:LANGUAGE/;/practice/;/${rule.id}/;/0`), 'VOTC:LANGUAGE/;/study_complete', 'VOTC:LANGUAGE/;/end'];
    const reader = new LanguageLogReader(inventory); frame.forEach(line => reader.observe(line));
    const snapshot = reader.snapshot(1)!;
    expect(snapshot.knownLanguageIds).toEqual(['language_vulpera']);
    const game = new GameData(['1', 'Listener', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Listener', '0']);
    const heard = character(1, 'Listener'); heard.languageSnapshot = snapshot;
    const speaker = character(2, 'Speaker'); speaker.languageSnapshot = { version: 1, complete: true, nativeLanguageId: 'language_zandali', knownLanguageIds: ['language_zandali'] };
    game.characters.set(1, heard); game.characters.set(2, speaker);
    const session = new LanguageConversation(game, engine.renderer);
    const message = { role: 'assistant' as const, characterId: 2, content: '**She points to the cup.** ""Bring water before dawn.""', proseEncoding: 'controls-v1' as const };
    expect(session.forRecipient(message, 1).comprehensionMode).toBe('CLOSE');
    expect(session.forRecipient(message, 1).content).toContain('She points to the cup.');
    expect(snapshot.knownLanguageIds).toEqual(['language_vulpera']);
});

test('a new cultural grant does not reinterpret a previously delivered FAR hearing', () => {
    const previousIds = new Set(['khaz_modan_neighbors', 'eastern_kingdoms_common_contacts', 'draenor_orc_ogre_contacts',
        'durotar_community_contacts', 'forest_troll_orc_contacts', 'goblin_merchant_contacts', 'legion_eredun_familiarity']);
    const previous = new LanguageEngine({ routing: { ...routing, routing_version: 'titan-stateless-close-r2',
        culture_rules: routing.culture_rules.filter((rule: { id: string }) => previousIds.has(rule.id)) },
        close: json('close-profiles'), far: json('far-profiles'), casefold: json('unicode-casefold').fold });
    const game = new GameData(['1', 'Listener', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Listener', '0']);
    const heard = character(1, 'Listener'); heard.languageSnapshot = { version: 1, complete: true,
        nativeLanguageId: 'language_vulpera', knownLanguageIds: ['language_vulpera'], cultureFamiliarity: {
            version: 1, complete: true, routingVersion: previous.relations.version, matchedRuleIds: [] } };
    const speaker = character(2, 'Speaker'); speaker.languageSnapshot = { version: 1, complete: true, nativeLanguageId: 'language_zandali', knownLanguageIds: ['language_zandali'] };
    game.characters.set(1, heard); game.characters.set(2, speaker);
    const oldSession = new LanguageConversation(game, previous.renderer);
    const message = { role: 'assistant' as const, characterId: 2, content: '"Bring water before dawn."' };
    const before = oldSession.forRecipient(message, 1); expect(before.comprehensionMode).toBe('FAR');
    heard.languageSnapshot.cultureFamiliarity = { version: 1, complete: true, routingVersion: engine.relations.version, matchedRuleIds: ['vulpera_voldun_caravan_contacts'] };
    const newSession = new LanguageConversation(game, engine.renderer);
    expect(newSession.forRecipient(message, 1)).toEqual(before);
    expect(newSession.forRecipient({ role: 'assistant', characterId: 2, content: message.content }, 1).comprehensionMode).toBe('CLOSE');
});
