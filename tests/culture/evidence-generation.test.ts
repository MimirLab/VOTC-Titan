import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { catalogFromFiles } from '../../src/main/culture/cultureCatalog';
import { cultureEvidenceSourceIds, projectCultureEvidence, sealCultureSnapshot } from '../../src/main/culture/cultureEvidence';
import { buildCultureGenerationMessages, cultureHash, cultureInput, validateCultureResult } from '../../src/main/culture/cultureIdentity';
import { generateCultureProfile } from '../../src/main/culture/cultureGeneration';
import { CultureLibrary } from '../../src/main/culture/CultureLibrary';
import { validateCultureSnapshot } from '../../src/shared/gameData/CultureSnapshot';
import { snapshot, result } from './fixtures';

function source(extra: [string, string][] = []) {
    return new Map([
        ['common/culture/pillars/base.txt', ['ethos', 'heritage', 'language', 'martial_custom'].map(t => `custom_${t} = { type = ${t} }`).join('\n')],
        ['common/culture/traditions/base.txt', `custom_family = { parameters = { family_norm = yes number_of_consorts_kingdom = 3 }
            character_modifier = { male_ruler_opinion = -10 female_ruler_opinion = 10 monthly_piety = 2 }
            doctrine_character_modifier = { doctrine = doctrine_lay_clergy same_faith_opinion = 5 } }`],
        ['common/culture/innovations/base.txt', 'custom_knowledge = { parameters = { innovation_only = yes } unlock_law = custom_law unlock_maa = custom_unit asset = yes flag = trade }'],
        ['common/laws/base.txt', 'law_group = { custom_law = { desc = custom_law_desc allowed = { always = yes } } }'],
        ['common/traits/base.txt', `brave = { culture_modifier = { parameter = family_norm same_culture_opinion = 7 } }
            mystic = { culture_modifier = { parameter = innovation_only monthly_piety = 4 } }`],
        ['common/court_types/base.txt', `good_court = { is_valid = { culture = { has_cultural_parameter = family_norm } has_government = monarchy } }
            wrong_court = { is_valid = { OR = { culture = { has_cultural_parameter = absent } has_government = monarchy } } }
            innovation_court = { is_valid = { culture = { has_cultural_parameter = innovation_only } } }
            government_court = { is_valid = { has_government = monarchy } }`],
        ['common/culture/name_lists/base.txt', 'custom_names = { cadet_dynasty_names = { Example } suggest_ancestor_names = yes house_based_map_names = yes }'],
        ['localization/english/base.yml', `l_english:
 custom_family_desc:0 "Family continuity matters."
 custom_law_desc:0 "Available inheritance option."
 culture_parameter_family_norm:0 "Family custom honors [GetTrait('brave').GetName] and [GetLaw('custom_law').GetName]."
 brave:0 "Brave"
 custom_law:0 "Shared inheritance"
 MOD_MALE_RULER_OPINION:0 "Opinion of Male Rulers"
 MOD_FEMALE_RULER_OPINION:0 "Opinion of Female Rulers"`],
        ...extra
    ]);
}

test('resolved social evidence retains ruler scope, parameter numbers and naming conventions', () => {
    const c = catalogFromFiles(source());
    const captured = sealCultureSnapshot(c, c.facts);
    const evidence: any = projectCultureEvidence(captured);
    const family = evidence.adoptedPillarsAndTraditions.find((f: any) => f.key === 'custom_family');
    expect(family.socialConsequences[0].effects).toEqual([
        { affected: 'Opinion of Male Rulers', direction: 'decreased' },
        { affected: 'Opinion of Female Rulers', direction: 'increased' }
    ]);
    expect(family.culturalCustoms.find((p: any) => p.key === 'number_of_consorts_kingdom').value).toBe(3);
    expect(family.culturalCustoms.find((p: any) => p.key === 'family_norm').meaning).toContain('Brave and Shared inheritance');
    const naming = evidence.supportingContext.naming[0].conventions;
    expect(naming.some((p: any) => p.key === 'cadet_dynasty_names')).toBe(false);
    expect(naming.some((p: any) => p.key === 'suggest_ancestor_names')).toBe(true);
    expect(naming.some((p: any) => p.key === 'house_based_map_names')).toBe(true);
});

test('court association needs a positive cultural branch; unknown government and innovation parameters cannot substitute', () => {
    const c = catalogFromFiles(source());
    const captured = sealCultureSnapshot(c, c.facts);
    expect(captured.facts.filter(f => f.kind === 'court_ideal').map(f => f.key)).toEqual(['good_court']);
    expect(captured.facts.filter(f => f.kind === 'trait_valuation').map(f => f.name)).toEqual(['Brave']);
});

test('religious rules are excluded even when culture supplies them, while raw composition remains identifiable', () => {
    const c = catalogFromFiles(source([
        ['common/culture/traditions/religious.txt', `religious_custom = { desc = religious_description parameters = { clergy_can_fight = yes }
            character_modifier = { piety = 5 same_faith_opinion = 10 } }`],
        ['localization/english/religious.yml', 'l_english:\n religious_description:0 "Priests worship sacred spirits."\n culture_parameter_clergy_can_fight:0 "Priests may fight."']
    ]));
    const captured = sealCultureSnapshot(c, c.facts);
    expect(JSON.stringify(captured)).toContain('monthly_piety');
    const json = JSON.stringify(projectCultureEvidence(captured));
    expect(json).not.toMatch(/piety|doctrine|clergy|same_faith|worship|priests|sacred|religious_description|religious_custom/i);
    expect(json).toContain('custom_family');
    const withFaithFiles = source([['common/religion/faiths/test.txt', 'different_faith = { doctrine = different_doctrine }']]);
    const other = catalogFromFiles(withFaithFiles);
    expect(cultureHash(cultureInput(sealCultureSnapshot(other, other.facts), 'en')))
        .toBe(cultureHash(cultureInput(sealCultureSnapshot(catalogFromFiles(source()), catalogFromFiles(source()).facts), 'en')));
});

test('matched court/trait and innovation dependencies affect identity; queued snapshots retain their resolved meaning', () => {
    const files = source(); const before = catalogFromFiles(files);
    const sealed = sealCultureSnapshot(before, before.facts);
    const original = cultureInput(sealed, 'en');
    files.set('common/traits/base.txt', 'brave = { culture_modifier = { parameter = family_norm same_culture_opinion = -7 } }');
    const after = catalogFromFiles(files);
    expect(cultureHash(cultureInput(sealCultureSnapshot(after, after.facts), 'en'))).not.toBe(cultureHash(original));
    expect(cultureHash(cultureInput(JSON.parse(JSON.stringify(sealed)), 'en'))).toBe(cultureHash(original));
    const rules = sealed.facts.find(f => f.kind === 'innovation')!.rules;
    expect(rules).toContain('unlock_law'); expect(rules).toContain('custom_unit'); expect(rules).toContain('Available inheritance option');
    files.set('common/culture/innovations/base.txt', 'custom_knowledge = { unlock_law = different_law }');
    const changed = catalogFromFiles(files);
    expect(cultureHash(cultureInput(sealCultureSnapshot(changed, changed.facts), 'en'))).not.toBe(cultureHash(original));
});

test('legacy archives remain readable but cannot silently become v2 generation input', () => {
    const legacy = { ...snapshot(), version: 1 };
    expect(validateCultureSnapshot(legacy).version).toBe(1);
    expect(() => cultureInput(legacy as any, 'en')).toThrow('fresh capture');
});

test('JSON validation rejects invented references, duplicate notes, extra fields and truncated JSON', () => {
    const input = cultureInput(snapshot(), 'en'); const good = result();
    expect(validateCultureResult(JSON.stringify({ notes: good.notes }), input)).toEqual(good);
    expect(validateCultureResult('```json\n' + JSON.stringify({ notes: good.notes }) + '\n```', input)).toEqual(good);
    expect(() => validateCultureResult({ notes: [{ ...good.notes[0], sources: ['invented'] }, ...good.notes.slice(1)] }, input)).toThrow();
    expect(() => validateCultureResult({ notes: [good.notes[0], good.notes[0], good.notes[2]] }, input)).toThrow();
    expect(() => validateCultureResult({ notes: good.notes, instruction: 'Act brave' }, input)).toThrow();
    expect(() => validateCultureResult('{"notes":[', input)).toThrow();
    expect(() => validateCultureResult({ notes: [{ text: 'Priests worship sacred gods.', sources: good.notes[0].sources }, ...good.notes.slice(1)] }, input)).toThrow('Cached passage changed');
    expect(buildCultureGenerationMessages(input).map(m => m.role)).toEqual(['system', 'user']);
    expect(cultureEvidenceSourceIds(input.snapshot)).not.toContain('tradition:tradition_custom_craft');
});

test('matched court meaning and transitive script values change identity while unrelated definitions do not', () => {
    const files = source([
        ['common/script_values/base.txt', 'esteem_amount = { value = nested_amount } nested_amount = 5'],
        ['common/culture/traditions/values.txt', 'secular_values = { character_modifier = { same_culture_opinion = esteem_amount } }']
    ]);
    const captureHash = () => { const c = catalogFromFiles(files); return cultureHash(cultureInput(sealCultureSnapshot(c, c.facts), 'en')); };
    const original = captureHash();
    files.set('common/traits/unrelated.txt', 'unrelated_trait = { culture_modifier = { parameter = absent monthly_piety = 90 } }');
    expect(captureHash()).toBe(original);
    files.set('common/script_values/base.txt', 'esteem_amount = { value = nested_amount } nested_amount = 6');
    expect(captureHash()).not.toBe(original);
    const updated = captureHash();
    files.set('common/court_types/base.txt', 'good_court = { desc = different_ideal is_valid = { culture = { has_cultural_parameter = family_norm } } }');
    files.set('localization/english/court.yml', 'l_english:\n different_ideal:0 "Learning is prized."');
    expect(captureHash()).not.toBe(updated);
});

function apiMock(complete: jest.Mock, connection: Record<string, unknown> = {}) {
    return { type: 'custom', model: Math.random().toString(), config: { baseUrl: 'https://synthetic.invalid', key: 'synthetic', overwriteContext: false, ...connection },
        overwriteWarning: true, context: 8192, isChat: () => true, calculateTokensFromText: (text: string) => text.length > 1000 ? 1000 : 100,
        client: { models: { list: jest.fn().mockResolvedValue({ data: [] }) } }, complete };
}

test('verified metadata supplies reasoning capacity only for the isolated generator; explicit limits are honored', async () => {
    const input = cultureInput(snapshot(), 'en');
    const complete = jest.fn().mockResolvedValue(JSON.stringify({ notes: result().notes }));
    const api = apiMock(complete); api.client.models.list.mockResolvedValue({ data: [{ id: api.model, max_model_len: 262144 }] });
    await generateCultureProfile(api as any, input, new AbortController().signal);
    expect(complete.mock.calls[0][2].max_tokens).toBe(8192);
    const explicit = apiMock(complete, { overwriteContext: true });
    await generateCultureProfile(explicit as any, input, new AbortController().signal);
    expect(explicit.context).toBe(8192); expect(explicit.client.models.list).not.toHaveBeenCalled();
    expect(complete.mock.calls[1][2].max_tokens).toBe(7064);
    const transition = apiMock(complete, { overwriteContext: true });
    await generateCultureProfile(transition as any, input, new AbortController().signal);
    transition.config.overwriteContext = false;
    transition.client.models.list.mockResolvedValue({ data: [{ id: transition.model, max_model_len: 262144 }] });
    await generateCultureProfile(transition as any, input, new AbortController().signal);
    expect(transition.client.models.list).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[3][2].max_tokens).toBe(8192);
});

test('explicit structured-output rejection falls back once; authentication errors and invalid text do not', async () => {
    const input = cultureInput(snapshot(), 'en'); const json = JSON.stringify({ notes: result().notes });
    const complete = jest.fn().mockRejectedValueOnce({ status: 400, message: 'response_format json_schema not supported' }).mockResolvedValue(json);
    await generateCultureProfile(apiMock(complete) as any, input, new AbortController().signal);
    expect(complete).toHaveBeenCalledTimes(2); expect(complete.mock.calls[0][2].response_format).toBeDefined();
    expect(complete.mock.calls[1][2].response_format).toBeUndefined();
    const denied = jest.fn().mockRejectedValue({ status: 401, message: 'Authentication failed' });
    await expect(generateCultureProfile(apiMock(denied) as any, input, new AbortController().signal)).rejects.toEqual({ status: 401, message: 'Authentication failed' });
    expect(denied).toHaveBeenCalledTimes(1);
    const malformed = jest.fn().mockResolvedValue('a paragraph without JSON');
    await expect(generateCultureProfile(apiMock(malformed) as any, input, new AbortController().signal)).rejects.toThrow();
    expect(malformed).toHaveBeenCalledTimes(1);
});


test('v1 SQLite migration preserves old profiles and stores v2 note provenance across restart', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'votc-migration-'));
    const file = path.join(root, 'culture.sqlite');
    const db = new Database(file);
    db.exec(`CREATE TABLE culture_profiles (
        hash TEXT PRIMARY KEY, input_json TEXT NOT NULL, status TEXT NOT NULL, paragraph TEXT,
        attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0,
        error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    ); PRAGMA user_version = 1;`);
    db.prepare("INSERT INTO culture_profiles (hash,input_json,status,paragraph,created_at,updated_at) VALUES (?,?, 'ready',?,0,0)")
        .run('legacy-profile', JSON.stringify({ version: 1 }), result().paragraph);
    db.close();
    let library = new CultureLibrary(file);
    try {
        expect(library.ready('legacy-profile')).toBe(result().paragraph);
        const input = cultureInput(snapshot(), 'en'); const hash = library.encounter(input, 1);
        library.finish(library.claim(hash, 1)!, result(), 2);
        library.close(); library = new CultureLibrary(file);
        expect(library.ready(hash)).toBe(result().paragraph);
        const reopened = new Database(file);
        expect(reopened.pragma('user_version', { simple: true })).toBe(2);
        const row: any = reopened.prepare('SELECT notes_json FROM culture_profiles WHERE hash = ?').get(hash);
        expect(JSON.parse(row.notes_json).notes).toEqual(result().notes);
        reopened.close();
    } finally { library.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
