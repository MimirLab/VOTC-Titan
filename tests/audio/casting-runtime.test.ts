import type { Character } from '../../src/shared/gameData/Character';
import type { GameData } from '../../src/shared/gameData/GameData';
import type { Config } from '../../src/shared/Config';
import type { GoaSnapshot } from '../../src/shared/gameData/GoaSnapshot';
import { EncounterCapture } from '../../src/main/background/EncounterCapture';
import { buildCastingCapture } from '../../src/main/audio/castingCapture';
import { captureForAudio, configureCastingCapture, currentCastingCapture, observeCastingLine } from '../../src/main/audio/castingRuntime';

const digest = 'b'.repeat(64);
let snapshot: GoaSnapshot | undefined;
jest.mock('../../src/main/goa/goaRuntime', () => ({ currentGoaCatalog: () => ({ digest: 'synthetic-goa' }), getVerifiedGoaSnapshot: () => snapshot }));
jest.mock('../../src/main/audio/castingCapture', () => {
    const actual = jest.requireActual('../../src/main/audio/castingCapture');
    return { ...actual, buildCastingCapture: jest.fn(() => ({ digest: 'b'.repeat(64), cultureIds: ['gilnean', 'darkspear'] })) };
});
const actor = { id: 2 } as Character;
const game = { playerID: 1, characters: new Map<number, Partial<Character>>([[1, { id: 1 }], [2, actor], [3, { id: 3 }]]) } as GameData;
const signal = () => new AbortController().signal;
function configure(enabled = true): void {
    configureCastingCapture({ audio: { enabled }, cultureGameInstallPath: 'synthetic-game', userFolderPath: 'synthetic-user' } as Config);
}
function cultureFrame(): void {
    for (const line of [`begin/;/${digest}/;/2`, 'culture/;/gilnean/;/1', 'culture/;/darkspear/;/0', `end/;/${digest}/;/2`])
        observeCastingLine('VOTC:ACOUSTIC/;/' + line);
}
beforeEach(() => { jest.clearAllMocks(); snapshot = undefined; });
afterEach(() => { configure(false); jest.restoreAllMocks(); });

test('disabled audio loads no casting definitions and requests no game capture', async () => {
    configure(false); const capture = jest.spyOn(EncounterCapture.prototype, 'capture');
    expect(currentCastingCapture()).toBeUndefined(); await captureForAudio(actor, game, signal());
    expect(buildCastingCapture).not.toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled();
});
test('an established accent and frozen body require no additional command bridge read', async () => {
    configure(); const capture = jest.spyOn(EncounterCapture.prototype, 'capture');
    await captureForAudio(actor, game, signal(), { body: false, culture: false });
    expect(capture).not.toHaveBeenCalled();
});
test('first accent capture targets only the speaker and excludes the ordinary RP/body catalogues when body is known', async () => {
    configure(); const capture = jest.spyOn(EncounterCapture.prototype, 'capture').mockImplementation(async function(this: any, _folder, targets) {
        const catalogs = this.catalogs();
        expect(catalogs.acoustic.cultureIds).toEqual(['gilnean', 'darkspear']); expect(catalogs.goa).toBeUndefined();
        expect(catalogs.culture).toBeUndefined(); expect(catalogs.faith).toBeUndefined(); expect(catalogs.languages).toBeUndefined();
        expect(targets).toEqual([{ characterId: 2, position: 1 }]); cultureFrame(); return true;
    });
    await captureForAudio(actor, game, signal(), { body: false });
    await captureForAudio(actor, game, signal(), { body: false });
    expect(capture).toHaveBeenCalledTimes(1);
});
test('an acknowledged capture without the required complete data fails rather than inventing a voice', async () => {
    configure(); jest.spyOn(EncounterCapture.prototype, 'capture').mockResolvedValue(true);
    await expect(captureForAudio(actor, game, signal())).rejects.toThrow('capture is not ready');
});
