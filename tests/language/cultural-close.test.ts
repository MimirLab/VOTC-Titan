import fs from 'fs';
import { CloseProfiles } from '../../src/main/language/closeProfiles';
import { CloseEncoder } from '../../src/main/language/closeEncoder';
import { LanguageRelations } from '../../src/main/language/languageRelations';
import { languageCaptureBody, languageCaptureCatalog, LanguageLogReader } from '../../src/main/language/languageCapture';
import { LanguageRenderer, recordUtterance } from '../../src/main/language/languageRendering';
import { FarEncoder } from '../../src/main/language/farEncoder';
import { LanguageConversation } from '../../src/main/language/languageConversation';
import { GameData } from '../../src/shared/gameData/GameData';
import { validateLanguageSnapshot } from '../../src/shared/gameData/LanguageSnapshot';
import { parseCk3Script } from '../../src/main/culture/ck3Script';
import { catalog, character, fact } from '../culture/fixtures';
import { Message } from '../../src/main/ts/conversation_interfaces';
const json = (name: string) => JSON.parse(fs.readFileSync('public/languages/' + name + '.json', 'utf8'));
const routing = json('routing'), voices = json('close-profiles');
const relations = new LanguageRelations(routing), profiles = new CloseProfiles(voices, relations), encoder = new CloseEncoder(profiles);
const native = (language: string, matchedRuleIds: string[] = []) => ({ version: 1 as const, complete: true as const,
    nativeLanguageId: language, knownLanguageIds: [language], cultureFamiliarity: { version: 1 as const,
        complete: true as const, routingVersion: relations.version, matchedRuleIds } });

test('all 53 voices are independently defined, including singleton banks, with separate FAR and routing versions', () => {
    expect(profiles.coverage(Object.keys(json('far-profiles').profiles))).toEqual({ unlisted: [], unused: [] });
    expect(Object.keys(voices.profiles)).toHaveLength(53);
    expect(new Set(Object.values(voices.profiles).map((p: any) => JSON.stringify(p.rules))).size).toBe(53);
    for (const id of Object.keys(voices.profiles)) expect(encoder.speech('the water, shining silver and stone', id)).not.toBe('the water, shining silver and stone');
    expect(json('far-profiles').version).toBe('titan-essence-0.2');
    expect(profiles.version).not.toBe(relations.version);
});
test('every actual learned tongue is an anchor, with exact knowledge checked before family proximity', () => {
    expect(relations.route('language_shalassian', ['language_common', 'language_thalassian']).mode).toBe('CLOSE');
    expect(relations.route('language_shalassian', ['language_common', 'language_thalassian', 'language_shalassian']).mode).toBe('CLEAR');
    expect(relations.route('language_orcish', ['language_common', 'language_thalassian']).mode).toBe('FAR');
});
test('direct cultural contact adds CLOSE but never becomes actual knowledge or a transitive anchor', () => {
    const known = ['language_gnomish'];
    expect(relations.route('language_dwarven', known, { currentCultureId: 'gnome' })).toEqual({ mode: 'CLOSE', reason: 'cultural_contact', anchor: 'eastern_kingdoms_common_contacts' });
    expect(relations.route('language_dwarven', known, { currentCultureId: 'mogu' }).mode).toBe('FAR');
    expect(relations.route('language_low_common', known, { currentCultureId: 'gnome' }).mode).toBe('FAR');
    expect(known).toEqual(['language_gnomish']);
    expect(relations.route('language_eredun', ['language_nathrezim'], { currentCultureId: 'nathrezim' }).mode).toBe('CLOSE');
    expect(relations.route('language_nathrezim', ['language_eredun'], { currentCultureId: 'eredar' }).mode).toBe('FAR');
});
test.each(['mechagonian', 'mechagnome'])('authored isolation excludes %s and its actual descendants', exclusion => {
    expect(relations.route('language_dwarven', ['language_gnomish'], { currentCultureId: exclusion, parentCultureIds: ['gnome'] }).mode).toBe('FAR');
    expect(relations.route('language_dwarven', ['language_gnomish'], { currentCultureId: 'synthetic_hybrid', parentCultureIds: ['gnome', exclusion] }).mode).toBe('FAR');
});
test('native ancestor selectors support a current hybrid and can explicitly be disabled', () => {
    const facts = { currentCultureId: 'synthetic_hybrid', parentCultureIds: ['bronzebeard'] };
    expect(relations.route('language_gnomish', ['language_dwarven'], facts).mode).toBe('CLOSE');
    expect(new LanguageRelations({ ...routing, culture_parent_match: false,
        culture_rules: routing.culture_rules.map((rule: object) => ({ ...rule, match_parents: false })) })
        .route('language_gnomish', ['language_dwarven'], facts).mode).toBe('FAR');
});
test('learning a tongue does not copy another culture contact network or change the selected utterance', () => {
    const listener = { nativeLanguageId: 'language_mogu', learnedLanguageIds: ['language_gnomish'], currentCultureId: 'mogu' };
    expect(relations.route('language_dwarven', ['language_mogu', 'language_gnomish'], listener).mode).toBe('FAR');
    const record = recordUtterance('"Bring water."', { nativeLanguageId: 'language_orcish', learnedLanguageIds: ['language_common'] },
        { nativeLanguageId: 'language_common', learnedLanguageIds: [] }, 'language_orcish');
    expect(record.spokenLanguageId).toBe('language_orcish');
});
test('marriage, location, realm and political changes cannot grant familiarity', () => {
    const extra = { currentCultureId: 'highmountain', spouseCulture: 'durotaric', hordeMember: true, currentLocation: 'durotar', formerCultures: ['tauren'] };
    expect(relations.route('language_orcish', ['language_taurahe'], extra).mode).toBe('FAR');
    expect(relations.route('language_orcish', ['language_taurahe'], { currentCultureId: 'tauren' }).mode).toBe('CLOSE');
});
test('unknown IDs remain unique; actual exact knowledge wins even with unavailable routing metadata', () => {
    expect(relations.route('unknown_a', ['unknown_b']).mode).toBe('FAR');
    expect(relations.route('unknown_a', ['unknown_a']).mode).toBe('CLEAR');
    expect(relations.route('language_dwarven', ['language_dwarven'], { cultureFamiliarity: { ...native('language_common').cultureFamiliarity, routingVersion: 'old' } }).mode).toBe('CLEAR');
    expect(() => relations.route('language_dwarven', ['language_gnomish'], { cultureFamiliarity: { ...native('language_common').cultureFamiliarity, routingVersion: 'old' } })).toThrow('stale');
});
test('profile rules cannot rewrite punctuation, apostrophes, digits or non-ASCII letters even with broad matching', () => {
    const data = JSON.parse(JSON.stringify(voices)); data.profiles.language_common.rules = [['.', 'x']];
    const guarded = new CloseEncoder(new CloseProfiles(data, routing));
    expect(guarded.speech("42 İ’🙂é", 'language_common')).toBe("42 İ’🙂é");
    expect(guarded.word('aaaééééééé', 'language_common')).toBe('xaaééééééé');
});
test('one family route and two culture routes hear the same spoken voice', () => {
    const renderer = new LanguageRenderer(encoder, new FarEncoder(json('far-profiles'), 'titan-demo', json('unicode-casefold').fold));
    const utterance = recordUtterance('*She waits.* "Bring water."', { nativeLanguageId: 'language_common', learnedLanguageIds: [] });
    const family = renderer.forListener(utterance, { nativeLanguageId: 'language_low_common', learnedLanguageIds: [] });
    for (const currentCultureId of ['gnome', 'bronzebeard']) {
        const contact = renderer.forListener(utterance, { nativeLanguageId: 'language_gnomish', learnedLanguageIds: [], currentCultureId });
        expect(contact.mode).toBe('CLOSE'); expect(contact.content).toBe(family.content);
    }
});
test('native culture predicate results feed recipient history, stay frozen, and never export parallel translation', () => {
    const renderer = new LanguageRenderer(encoder, new FarEncoder(json('far-profiles'), 'titan-demo', json('unicode-casefold').fold));
    const game = new GameData(['1','Player','2','Speaker','1066.9.15','court','County','Player','0']);
    const listener = character(1,'Player'); listener.languageSnapshot = native('language_gnomish',['eastern_kingdoms_common_contacts']);
    const speaker = character(2,'Speaker'); speaker.languageSnapshot = native('language_dwarven');
    game.characters.set(1, listener); game.characters.set(2, speaker);
    const session = new LanguageConversation(game,renderer); const message: Message = { role:'assistant',characterId:2,content:'*Her hands tremble.* "I will not leave you alone."' };
    const heard = session.forRecipient(message,1);
    expect(heard.comprehensionMode).toBe('CLOSE'); expect(heard.content).toContain('Her hands tremble');
    expect(JSON.stringify(heard)).not.toContain('originalText'); expect(heard.content).not.toContain('leave you alone');
    listener.languageSnapshot = native('language_gnomish'); expect(session.forRecipient(message,1)).toEqual(heard);
    const fresh: Message = { role:'assistant',characterId:2,content:message.content }; expect(session.forRecipient(fresh,1).comprehensionMode).toBe('FAR');
});
const inventory = languageCaptureCatalog({ ...catalog(), facts: relations.languageIds().map(id => fact('pillar',id,'language')) }, relations)!;
function frame(characterId = 7): string[] {
    return [`VOTC:LANGUAGE/;/begin/;/${characterId}/;/${inventory.digest}`, 'VOTC:LANGUAGE/;/native/;/language_gnomish',
        'VOTC:LANGUAGE/;/learning/;/1',
        ...inventory.languageIds.map(id => `VOTC:LANGUAGE/;/known/;/${id}/;/${id==='language_gnomish'?'1':'0'}`),
        ...relations.cultureRules.map(rule => `VOTC:LANGUAGE/;/contact/;/${rule.id}/;/${rule.id==='eastern_kingdoms_common_contacts'?'1':'0'}`), ...relations.practiceRules.map(rule => `VOTC:LANGUAGE/;/practice/;/${rule.id}/;/0`), 'VOTC:LANGUAGE/;/study_complete', 'VOTC:LANGUAGE/;/end'];
}
test('same encounter capture evaluates native parent roots and exclusions, with complete stamped booleans', () => {
    const script = languageCaptureBody(inventory);
    expect(() => parseCk3Script(script)).not.toThrow();
    expect(script).toContain('is_culture_or_parent_culture_trigger = { CULTURE = culture:gnome }');
    expect(script).toContain('NOT = { OR = { is_culture_or_parent_culture_trigger = { CULTURE = culture:mechagonian }');
    expect(script).not.toContain('add_character'); expect(script).not.toContain('every_living_character');
    const reader = new LanguageLogReader(inventory); frame().forEach(line=>reader.observe(line));
    expect(reader.snapshot(7)?.cultureFamiliarity).toEqual(native('language_gnomish',['eastern_kingdoms_common_contacts']).cultureFamiliarity);
    expect(reader.snapshot(7)?.knownLanguageIds).toEqual(['language_gnomish']);
});
test.each(['omit', 'duplicate', 'unknown', 'malformed', 'old-digest'])('rejects %s culture frames rather than reusing earlier familiarity', defect => {
    const reader = new LanguageLogReader(inventory); frame().forEach(line=>reader.observe(line)); expect(reader.snapshot(7)).toBeDefined();
    const lines = frame(); const i = lines.findIndex(line=>line.includes('/;/contact/;/'));
    if(defect==='omit') lines.splice(i,1);
    if(defect==='duplicate') lines.splice(i,0,lines[i]);
    if(defect==='unknown') lines[i]='VOTC:LANGUAGE/;/contact/;/unknown/;/1';
    if(defect==='malformed') lines[i]=lines[i].replace('/;/1','/;/yes');
    if(defect==='old-digest') lines[0]=lines[0].replace(inventory.digest,'old');
    lines.forEach(line=>reader.observe(line)); expect(reader.snapshot(7)).toBeUndefined();
});
test('snapshot validation clones contact arrays and rejects incomplete or duplicate knowledge', () => {
    const original=native('language_gnomish',['eastern_kingdoms_common_contacts']); const copy=validateLanguageSnapshot(original);
    original.cultureFamiliarity.matchedRuleIds.length=0; expect(copy.cultureFamiliarity?.matchedRuleIds).toHaveLength(1);
    expect(()=>validateLanguageSnapshot({...copy,cultureFamiliarity:{...copy.cultureFamiliarity,complete:false}})).toThrow();
    expect(()=>validateLanguageSnapshot({...copy,cultureFamiliarity:{...copy.cultureFamiliarity,matchedRuleIds:['x','x']}})).toThrow();
});
