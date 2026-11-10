import path from 'path';
import fs from 'fs';
import os from 'os';
import { app } from 'electron';
import { Conversation } from '../../src/main/conversation/Conversation';
import { GameData } from '../../src/shared/gameData/GameData';
import { captureCurrentLanguages, prepareRoleplayBackground } from '../../src/main/culture/cultureRuntime';
import { configureLanguageCapture, currentLanguageCaptureCatalog, observeLanguageLine, bindLanguageSnapshot, setLanguageRoutingEnabled } from '../../src/main/language/languageRuntime';
import { defaultLanguageEngine } from '../../src/main/language/languageRuntime';
import { LanguageConversation } from '../../src/main/language/languageConversation';
import { character, catalog, fact } from '../culture/fixtures';
import { Message } from '../../src/main/ts/conversation_interfaces';
import { EncounterCapture } from '../../src/main/background/EncounterCapture';
import { catalog as faithCatalog } from '../faith/fixtures';

jest.mock('../../src/main/culture/cultureRuntime', () => ({ captureRoleplayEncounter: jest.fn(), captureCurrentLanguages: jest.fn(), prepareRoleplayBackground: jest.fn() }));
jest.mock('../../src/main/letter/LetterManager', () => ({ LetterManager: { getInstance: () => ({}) } }));
let converted: boolean;
function fixture() {
    (app as any).getAppPath = () => path.resolve('.');
    configureLanguageCapture({ ...catalog(), facts: [fact('pillar', 'language_common', 'language'), fact('pillar', 'language_orcish', 'language'),
        fact('pillar', 'language_gnomish', 'language'), fact('pillar', 'language_shathyar', 'language')] });
    const game = new GameData(['1', 'Player', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Player', '0']);
    game.characters.set(1, character(1, 'Listener')); game.characters.set(2, character(2, 'Speaker'));
    const controller = new AbortController();
    const conv: any = Object.assign(Object.create(Conversation.prototype), { config: { languageRoutingEnabled: true }, gameData: game,
        encounterLifetime: controller, encounterCapture: Promise.resolve(true), capturedParticipants: new Set([1, 2]),
        chatWindow: { window: { webContents: { send: jest.fn() } } } });
    return { conv, game, controller };
}
function publish(game: GameData) {
    const inventory = currentLanguageCaptureCatalog()!;
    for (const actor of game.characters.values()) {
        const native = actor.id === 1 ? 'language_gnomish' : 'language_shathyar';
        const rows = [`VOTC:LANGUAGE/;/begin/;/${actor.id}/;/${inventory.digest}`, `VOTC:LANGUAGE/;/native/;/${native}`,
        'VOTC:LANGUAGE/;/learning/;/1',
            ...inventory.languageIds.map(id => `VOTC:LANGUAGE/;/known/;/${id}/;/${id === native ? 1 : 0}`),
            ...inventory.cultureRules!.map(rule => `VOTC:LANGUAGE/;/contact/;/${rule.id}/;/0`),
            ...inventory.practiceRules!.map(rule => `VOTC:LANGUAGE/;/practice/;/${rule.id}/;/${actor.id === 1 && !converted && rule.id === 'R02' ? 1 : 0}`),
            'VOTC:LANGUAGE/;/study_complete', 'VOTC:LANGUAGE/;/end'];
        rows.forEach(observeLanguageLine); expect(bindLanguageSnapshot(actor)).toBe(true);
    }
}
beforeEach(() => { converted = false; (prepareRoleplayBackground as jest.Mock).mockResolvedValue('ready'); });
afterEach(() => { configureLanguageCapture(undefined, true); jest.restoreAllMocks(); });

test('new ingress reads current practice even when bound; conversion changes future speech while retaining old hearings', async () => {
    const { conv, game } = fixture(); publish(game);
    (captureCurrentLanguages as jest.Mock).mockImplementation(async () => { publish(game); return true; });
    const session = new LanguageConversation(game, defaultLanguageEngine().renderer);
    const message = (id: string): Message => ({ id, role: 'assistant', characterId: 2, name: 'Speaker', content: '"Bring water before dawn."' });
    const before = message('before'); session.record(before);
    expect(before.languageRecord?.hearings['1'].mode).toBe('CLOSE');
    converted = true; await conv.prepareMessageIngress();
    expect(captureCurrentLanguages).toHaveBeenCalledTimes(1);
    expect(game.characters.get(1)!.languageSnapshot!.knownLanguageIds).toEqual(['language_gnomish']);
    const after = message('after'); session.record(after);
    expect(after.languageRecord?.hearings['1'].mode).toBe('FAR');
    expect(before.languageRecord?.hearings['1'].mode).toBe('CLOSE');
    await conv.ensureBackgroundReady(game.characters.get(2));
    expect(captureCurrentLanguages).toHaveBeenCalledTimes(2);
    expect(prepareRoleplayBackground).toHaveBeenCalledTimes(1);
});

test('concurrent readiness and ingress share one owned native capture', async () => {
    const { conv, game } = fixture(); publish(game);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    (captureCurrentLanguages as jest.Mock).mockImplementation(async () => { await gate; publish(game); return true; });
    const ingress = conv.prepareMessageIngress(), readiness = conv.ensureBackgroundReady(game.characters.get(2));
    await Promise.resolve(); await Promise.resolve();
    expect(captureCurrentLanguages).toHaveBeenCalledTimes(1);
    release(); await Promise.all([ingress, readiness]);
    expect(captureCurrentLanguages).toHaveBeenCalledTimes(1);
});

test('missing receipts never reuse stale practice and a failed attempt can retry', async () => {
    const { conv, game } = fixture(); publish(game);
    (captureCurrentLanguages as jest.Mock).mockResolvedValue(false);
    await expect(conv.prepareMessageIngress()).rejects.toThrow('Current language and familiarity capture');
    expect(game.characters.get(1)!.languageSnapshot).toBeUndefined();
    converted = true;
    (captureCurrentLanguages as jest.Mock).mockImplementation(async () => { publish(game); return true; });
    await expect(conv.prepareMessageIngress()).resolves.toBeUndefined();
    expect(game.characters.get(1)!.languageSnapshot!.practiceFamiliarity!.matchedRuleIds).toEqual([]);
});

test('leaving cancels capture and stops delivery; master off skips native practice work', async () => {
    const { conv, game, controller } = fixture(); publish(game);
    (captureCurrentLanguages as jest.Mock).mockImplementation(async () => { controller.abort(); return true; });
    await expect(conv.prepareMessageIngress()).rejects.toMatchObject({ name: 'AbortError' });
    expect(game.characters.get(1)!.languageSnapshot).toBeUndefined();
    conv.config.languageRoutingEnabled = false;
    await expect(conv.prepareMessageIngress()).resolves.toBeUndefined();
    expect(captureCurrentLanguages).toHaveBeenCalledTimes(1);
});

test('turning RP Language off while a native refresh is pending releases ingress without stale familiarity', async () => {
    const { conv, game } = fixture(); publish(game);
    (captureCurrentLanguages as jest.Mock).mockImplementation(async () => {
        conv.config.languageRoutingEnabled = false; setLanguageRoutingEnabled(false); return false;
    });
    await expect(conv.prepareMessageIngress()).resolves.toBeUndefined();
    expect(game.characters.get(1)!.languageSnapshot).toBeUndefined();
    expect(captureCurrentLanguages).toHaveBeenCalledTimes(1);
});

test('language-only refresh retains the existing receipt/ownership bridge and omits culture, faith and trait recapture', async () => {
    fixture();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'votc-current-language-'));
    const file = path.join(directory, 'run', 'votc.txt');
    const emitted: string[] = [];
    const bridge = new EncounterCapture(() => ({ culture: catalog(), faith: faithCatalog(), languages: currentLanguageCaptureCatalog() }), () => {
        const script = fs.readFileSync(file, 'utf8'); emitted.push(script);
        const nonce = /# VOTC:TITAN:PROBE\/;\/([a-f0-9]{24})/.exec(script)![1];
        bridge.observe('VOTC:ENCOUNTER/;/ack/;/' + nonce);
    });
    try {
        const targets = [{ characterId: 1, scope: 'root' }];
        await expect(bridge.capture(directory, targets, new AbortController().signal, 'votc.txt', 1000, { languagesOnly: true })).resolves.toBe(true);
        expect(emitted[0]).toContain('VOTC:LANGUAGE/;/practice/;/CT01');
        for (const prefix of ['VOTC:CULTURE', 'VOTC:FAITH', 'VOTC:GOA']) expect(emitted[0]).not.toContain(prefix);
        expect(fs.readFileSync(file, 'utf8')).toBe('');
        await expect(bridge.capture(directory, targets, new AbortController().signal)).resolves.toBe(true);
        expect(emitted[1]).toContain('VOTC:CULTURE'); expect(emitted[1]).toContain('VOTC:FAITH');
        expect(fs.readFileSync(file, 'utf8')).toBe('');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
