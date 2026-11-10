import { app } from 'electron';
import path from 'path';
import { Character } from '../../shared/gameData/Character';
import { CultureCatalog } from '../culture/cultureCatalog';
import { LanguageRenderer } from './languageRendering';
import { languageCaptureCatalog, LanguageCaptureCatalog, LanguageLogReader } from './languageCapture';
import { LanguageEngine, loadLanguageEngine } from './languageEngine';

let engine: LanguageEngine | undefined;
let reader: LanguageLogReader | undefined;
let catalog: LanguageCaptureCatalog | undefined;
let effectiveCulture: CultureCatalog | undefined;
let effectiveTraits: readonly string[] | undefined;
let routingEnabled = true;
let captureEpoch = 0;
const bound = new WeakMap<Character, number>();
export function defaultLanguageEngine(): LanguageEngine {
    return engine ??= loadLanguageEngine(path.join(app.getAppPath(), 'public', 'languages'));
}
/** Compatibility adapter for existing encounter consumers and retained test harnesses. */
export function defaultLanguageRenderer(): LanguageRenderer { return defaultLanguageEngine().renderer; }

export function configureLanguageCapture(culture?: CultureCatalog, enabled = routingEnabled, availableTraitIds?: readonly string[]): void {
    captureEpoch++;
    effectiveCulture = culture; effectiveTraits = availableTraitIds; routingEnabled = enabled;
    // Read Warcraft routing only after the effective language inventory enables this feature.
    catalog = enabled && culture && languageCaptureCatalog(culture)
        ? languageCaptureCatalog(culture, defaultLanguageEngine().relations, effectiveTraits) : undefined;
    reader = catalog ? new LanguageLogReader(catalog) : undefined;
}
export function setLanguageRoutingEnabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new Error('Language routing setting must be a boolean');
    if (enabled !== routingEnabled) configureLanguageCapture(effectiveCulture, enabled, effectiveTraits);
}
export function currentLanguageCaptureCatalog(): LanguageCaptureCatalog | undefined { return catalog; }
export function languageCaptureEnabled(): boolean { return !!catalog; }
export function observeLanguageLine(line: string): void {
    if (line.includes('VOTC:CAMPAIGN/;/loaded/;/')) clearLanguageObservations();
    else reader?.observe(line);
}
export function clearLanguageObservations(): void { captureEpoch++; reader?.clear(); }
export function bindLanguageSnapshot(character: Character): boolean {
    if (bound.has(character) && bound.get(character) !== captureEpoch) {
        delete character.languageSnapshot;
        delete character.learning;
        bound.delete(character);
    }
    if (!routingEnabled) return false;
    if (character.languageSnapshot) return true;
    const snapshot = reader?.snapshot(character.id);
    if (!snapshot) return false;
    character.languageSnapshot = snapshot; character.learning = snapshot.learning;
    bound.set(character, captureEpoch); return true;
}
