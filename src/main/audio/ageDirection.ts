import type { Character } from '../../shared/gameData/Character';
import { getVerifiedGoaSnapshot } from '../goa/goaRuntime';
import type { GameData } from '../../shared/gameData/GameData';
import { maturityDirection, maturityFromAge, MaturityStage } from './maturation';

/** Qualitative current delivery, independent of the saved age-neutral identity. No invented race multipliers. */
export function characterAgeYears(character: Character, game?: GameData): number {
    const now = game?.totalDays ?? game?.gameDate?.totalDays;
    const capturedAt = game?.gameDate?.totalDays;
    // Prefer an actual birth date. Otherwise advance the captured integer age conservatively by complete years.
    return Number.isFinite(now) && Number.isFinite(character.birthTotalDays) && now! >= character.birthTotalDays!
        ? Math.floor((now! - character.birthTotalDays!) / 365.25)
        : character.age + (Number.isFinite(now) && Number.isFinite(capturedAt) ? Math.floor(Math.max(0, now! - capturedAt!) / 365.25) : 0);
}
export function ageDirection(character: Character, game?: GameData, maturity?: MaturityStage): string {
    const age = characterAgeYears(character, game), facts = getVerifiedGoaSnapshot(character)?.facts;
    const childhood = maturityDirection(maturity ?? maturityFromAge(age));
    if (childhood) return childhood;
    if (!Number.isFinite(age) || age < 0) return 'Use the established natural voice.';
    if (facts?.ageless === true) return 'An ageless adult; retain the established adult voice without chronological elderly ageing.';
    if (facts?.long_lived === true) return 'An adult of a naturally long-lived people who age slowly; retain the established adult voice.';
    if (age < 30) return 'A young adult voice.';
    if (age < 55) return 'A mature adult voice.';
    if (age < 70) return 'An older adult voice, naturally aged.';
    return 'An elderly voice, naturally aged, without caricature.';
}
