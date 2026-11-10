import type { Character } from '../../shared/gameData/Character';
import type { Config } from '../../shared/Config';
import { DevelopmentFrame, DevelopmentLogReader } from './developmentCapture';

const reader = new DevelopmentLogReader();
let enabled = false;
let bindings = new WeakMap<Character, DevelopmentFrame>();
export function configureDevelopmentCapture(config: Config): void {
    enabled = !!config?.userFolderPath; clearDevelopmentObservations();
}
export function developmentCaptureEnabled(): boolean { return enabled; }
export function clearDevelopmentObservations(): void { reader.clear(); bindings = new WeakMap(); }
export function observeDevelopmentLine(line: string): void {
    if (line.includes('VOTC:CAMPAIGN/;/loaded/;/')) clearDevelopmentObservations();
    if (enabled) reader.observe(line);
}
export function invalidateDevelopment(characters: readonly Character[]): void {
    reader.forget(characters.map(c => c.id)); for (const character of characters) bindings.delete(character);
}
export function bindDevelopment(character: Character): boolean {
    const frame = reader.take(character.id);
    if (frame) bindings.set(character, frame);
    return bindings.has(character);
}
/** Never fall back to an old encounter age after a live refresh failed. No actor mutation. */
export function currentDevelopment(character: Character): DevelopmentFrame | undefined {
    if (enabled) return bindings.get(character);
    const age = character.age;
    if (!Number.isSafeInteger(age) || age < 0) return;
    return { age: age >= 20 ? '20+' : age, adult: age >= 16 };
}
