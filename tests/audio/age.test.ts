import { ageDirection } from '../../src/main/audio/ageDirection';
import { getVerifiedGoaSnapshot } from '../../src/main/goa/goaRuntime';
import type { Character } from '../../src/shared/gameData/Character';
import type { GameData } from '../../src/shared/gameData/GameData';
jest.mock('../../src/main/goa/goaRuntime', () => ({ getVerifiedGoaSnapshot: jest.fn() }));
test('maturity advances deterministically without regenerating identity', () => {
    (getVerifiedGoaSnapshot as jest.Mock).mockReturnValue(undefined);
    const actor = { age: 8 } as Character;
    expect(ageDirection(actor)).toContain('child'); actor.age = 15; expect(ageDirection(actor)).toContain('adolescent'); actor.age=16; expect(ageDirection(actor)).toContain('sounding youthful');
    actor.age = 32; expect(ageDirection(actor)).toContain('mature adult'); actor.age = 76; expect(ageDirection(actor)).toContain('elderly');
});
test('a child grows during a long encounter using observed birth/date data', () => {
    (getVerifiedGoaSnapshot as jest.Mock).mockReturnValue(undefined);
    const actor = { age: 8, birthTotalDays: 100 } as Character;
    expect(ageDirection(actor, { totalDays: 100 + 20 * 365.25 } as GameData)).toContain('young adult');
    delete actor.birthTotalDays;
    expect(ageDirection(actor, { totalDays: 100 + 12 * 365.25, gameDate: { totalDays: 100 } } as GameData)).toContain('young adult');
});
test('verified slow and ageless adult bodies avoid human chronological ageing, while children still mature', () => {
    (getVerifiedGoaSnapshot as jest.Mock).mockReturnValue({ facts: { ageless: true } });
    expect(ageDirection({ age: 500 } as Character)).toContain('ageless adult');
    expect(ageDirection({ age: 8 } as Character)).toContain('child');
    (getVerifiedGoaSnapshot as jest.Mock).mockReturnValue({ facts: { long_lived: true } });
    expect(ageDirection({ age: 500 } as Character)).toContain('age slowly');
});
