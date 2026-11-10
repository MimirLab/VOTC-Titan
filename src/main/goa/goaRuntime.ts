import { Config } from '../../shared/Config';
import { Character } from '../../shared/gameData/Character';
import { GameData } from '../../shared/gameData/GameData';
import { GoaSnapshot } from '../../shared/gameData/GoaSnapshot';
import { buildGoaCaptureCatalog, GoaCaptureCatalog } from './goaBridge';
import { GoaLogReader } from './goaLog';
import { GoaPacket, GoaPurpose, resolveGoaLore } from './goaResolver';
import { configureLoreMutationCapture, observeLoreMutationLine, clearLoreMutationObservations } from '../lorebook/loreMutationRuntime';

let configuration: Config | undefined;
let capture: GoaCaptureCatalog | undefined;
let reader: GoaLogReader | undefined;
let flush: (() => void) | undefined;
let checkedAt = 0;
let status = 'Prepare backgrounds for the current GoA playset to enable Warcraft lore.';
const bindings = new WeakMap<Character, { reader: GoaLogReader; epoch: number; revision: number; snapshot: GoaSnapshot }>();

export function initializeGoaRuntime(config: Config, flushLog?: () => void): void {
    configuration = config; flush = flushLog; refreshGoaCapture();
}
export function refreshGoaCapture(): void {
    reader = undefined; capture = undefined; checkedAt = Date.now();
    if (configuration) configureLoreMutationCapture(configuration, flush);
    if (!configuration?.cultureGameInstallPath || !configuration.userFolderPath) return;
    try {
        const current = buildGoaCaptureCatalog(configuration.cultureGameInstallPath, configuration.userFolderPath);
        if (!current) { status = 'Warcraft lore is inactive: GoA is not enabled in this playset.'; return; }
        capture = current; reader = new GoaLogReader(current.digest, current.traitIds);
        status = `Warcraft lore capture prepared; awaiting a complete character capture. ${current.missingProviderIds.length} catalogue provider IDs are absent in this pack and remain inactive.`;
    } catch { status = 'Refresh definitions for this GoA playset to enable Warcraft lore.'; }
}
export function observeGoaLine(line: string): void { reader?.observeLine(line); observeLoreMutationLine(line); }
export function clearGoaObservations(): void { reader?.clear(); clearLoreMutationObservations(); }
export function goaRuntimeStatus(): string {
    if (configuration?.goaLoreEnabled === false) return 'Warcraft lore is disabled in settings.';
    const count = reader?.observations.size ?? 0;
    return count ? `Warcraft lore active: ${count} verified character captures; ${capture!.missingProviderIds.length} absent provider IDs remain inactive.` : status;
}
export function getVerifiedGoaSnapshot(character: Character): GoaSnapshot | undefined {
    if (!configuration || !capture || !reader) return;
    // Recheck effective content, including Workshop updates that leave the launcher list unchanged.
    if (Date.now() - checkedAt > 5000) {
        checkedAt = Date.now();
        try {
            const current = buildGoaCaptureCatalog(configuration.cultureGameInstallPath, configuration.userFolderPath);
            if (current?.digest !== capture.digest) { refreshGoaCapture(); return; }
        } catch { refreshGoaCapture(); return; }
    }
    flush?.();
    const revision = reader.revisions.get(character.id) ?? 0;
    const observed = reader.observations.get(character.id);
    const bound = bindings.get(character);
    let s = observed && Date.now() - (reader.seenAt.get(character.id) ?? 0) <= 15_000 ? observed : undefined;
    if (!s && bound?.reader === reader && bound.epoch === reader.epoch && bound.revision === revision) s = bound.snapshot;
    if (!s) return;
    const aptitudes: Record<string, number> = {};
    for (const id of s.traitIds) for (const [school, value] of Object.entries(capture.traitAptitudes?.[id] ?? {}))
        aptitudes[school] = (aptitudes[school] ?? 0) + value;
    const aptitudeText = Object.entries(aptitudes).filter(([, value]) => value !== 0).sort(([a], [b]) => a.localeCompare(b))
        .map(([school, value]) => `${value > 0 ? 'faster' : 'slower'} ${school.replace('elemental_', '')} magical learning`).join('; ');
    if (aptitudeText) s = { ...s, facts: { ...s.facts, resolved_magic_aptitudes: aptitudeText } };
    bindings.set(character, { reader, epoch: reader.epoch, revision, snapshot: s });
    character.sex = s.sex; character.goaSnapshot = s;
    return s;
}

export interface GoaPromptContext { description: string; packet?: GoaPacket }

/** Qualifies once and returns explicit context; never edits saved prose or game facts. */
export function composeGoaContext(description: string, actor: Character | undefined, config: Config, gameData?: GameData, purpose: GoaPurpose = 'roleplay'): GoaPromptContext {
    if (!actor || config.goaLoreEnabled === false) return { description };
    const snapshot = getVerifiedGoaSnapshot(actor);
    if (!snapshot) return { description };
    const participants = gameData ? [...gameData.characters.values()].map(c => getVerifiedGoaSnapshot(c)).filter((s): s is GoaSnapshot => !!s) : [];
    const packet = resolveGoaLore(actor.fullName, snapshot, { participants }, purpose);
    return packet.text ? { description: description + (description ? '\n\n' : '') + packet.text, packet } : { description };
}

/** Apply identity precedence after all persona/history/template layers, exactly once. */
export function finishGoaContext(text: string, context: GoaPromptContext): string {
    return context.packet?.identityInstruction ? text + '\n\n' + context.packet.identityInstruction : text;
}

/** Compatibility for callers which still need a single complete description string. */
export function appendGoaContext(description: string, actor: Character | undefined, config: Config, gameData?: GameData, observer = false): string {
    const context = composeGoaContext(description, actor, config, gameData, observer ? 'observer' : 'roleplay');
    return finishGoaContext(context.description, context);
}

export function currentGoaCatalog(): GoaCaptureCatalog | undefined { return capture; }
