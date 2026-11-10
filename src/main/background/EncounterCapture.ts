import { createHash, randomBytes } from 'crypto';
import { ceCommandFile } from '../ceBridge';
import { CloneCaptureCatalog, cloneCaptureBody } from '../audio/cloneCapture';
import { maturationCaptureBody } from '../audio/maturation';
import { UndeadCaptureCatalog, undeadCaptureBody } from '../audio/undeadVoice';
import { developmentCaptureBody } from '../development/developmentCapture';
import { CastingCaptureCatalog, castingCaptureBody } from '../audio/castingCapture';
import { DialogueCaptureCatalog, dialogueCaptureBody } from '../dialogue/dialogueCapture';
import fs from 'fs';
import path from 'path';
import { abortableDelay } from './profileReadiness';
import { CultureCatalog } from '../culture/cultureCatalog';
import { cultureCaptureEffect } from '../culture/cultureBridge';
import { FaithCatalog } from '../faith/faithCatalog';
import { faithCaptureEffect } from '../faith/faithBridge';
import { GoaCaptureCatalog, goaTraitCapture } from '../goa/goaBridge';
import { parseCk3Script } from '../culture/ck3Script';
import type { GameData } from '../../shared/gameData/GameData';
import { LanguageCaptureCatalog, languageCaptureBody } from '../language';
import { LoreMutationCatalog, loreMutationCaptureBody } from '../lorebook/loreMutationCapture';
import { LoreGameStateCatalog, loreGameStateCaptureBody } from '../lorebook/loreGameStateCapture';
import { launcherSceneCaptureBody } from '../scenes/launcherSceneCapture';
import { Ck3GameDate, validateCk3GameDate } from '../../shared/gameData/gameDate';

export interface EncounterCatalogs { culture?: CultureCatalog; faith?: FaithCatalog; goa?: GoaCaptureCatalog; languages?: LanguageCaptureCatalog; dialogue?: DialogueCaptureCatalog; acoustic?: CastingCaptureCatalog; clones?: CloneCaptureCatalog; maturation?: boolean; development?: boolean; undeadVoice?: UndeadCaptureCatalog; loreMutation?: LoreMutationCatalog; loreGameState?: LoreGameStateCatalog; scenes?: boolean; clock?: boolean }
export type EncounterTarget = { characterId: number } & ({ position: number } | { scope: string });

/** Exported GetID values are not CK3's historical character:<key> references. */
export function encounterTargets(game: Pick<GameData, 'characters' | 'playerID' | 'aiID'>,
    ids: number[], letterSlot?: string): EncounterTarget[] {
    if (letterSlot !== undefined && !/^letter_[1-9]$/.test(letterSlot)) throw new Error('Unsupported letter scope');
    const orderedIds = Array.from(game.characters.keys());
    return [...new Set(ids)].map(characterId => {
        if (letterSlot) {
            if (characterId === game.playerID) return { characterId, scope: 'global_var:message_first_scope' };
            if (characterId !== game.aiID) throw new Error('Unrelated letter participant');
            return { characterId, scope: 'global_var:message_second_scope_' + letterSlot };
        }
        if (characterId === game.playerID) return { characterId, scope: 'root' };
        const position = orderedIds.indexOf(characterId);
        if (position < 0) throw new Error('Unexported conversation participant');
        return { characterId, position };
    });
}

/** Extract a generated effect's body without damaging quoted braces or localization. */
function effectBody(source: string, name: string): string {
    const entries = parseCk3Script(source);
    if (!entries.some(entry => entry.key === name && Array.isArray(entry.value))) throw new Error('Missing capture body');
    const prefix = name + ' = {';
    const start = source.indexOf(prefix) + prefix.length;
    let depth = 1, quoted = false, escaped = false;
    for (let i = start; i < source.length; i++) {
        const c = source[i];
        if (quoted) {
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') quoted = false;
        } else if (c === '"') quoted = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) return source.slice(start, i);
    }
    throw new Error('Incomplete capture body');
}

export function encounterScript(catalogs: EncounterCatalogs, targets: EncounterTarget[], nonce: string): string {
    if (!/^[a-f0-9]{24}$/.test(nonce) || !targets.length || targets.length > 16 ||
        targets.some(target => !Number.isSafeInteger(target.characterId) || target.characterId < 0 ||
            ('position' in target ? !Number.isSafeInteger(target.position) || target.position < 0 :
                !/^(root|global_var:message_first_scope|global_var:message_second_scope_letter_[1-9])$/.test(target.scope))))
        throw new Error('Invalid encounter');
    const bodies: string[] = [];
    if (catalogs.loreGameState) bodies.push(loreGameStateCaptureBody(catalogs.loreGameState));
    if (catalogs.loreMutation) bodies.push(loreMutationCaptureBody(catalogs.loreMutation));
    if (catalogs.development) bodies.push(developmentCaptureBody());
    if (catalogs.maturation) bodies.push(maturationCaptureBody());
    if (catalogs.undeadVoice) bodies.push(undeadCaptureBody(catalogs.undeadVoice));
    if (catalogs.clones) bodies.push(cloneCaptureBody(catalogs.clones));
    if (catalogs.acoustic) bodies.push(castingCaptureBody(catalogs.acoustic));
    if (catalogs.languages) bodies.push(languageCaptureBody(catalogs.languages));
    if (catalogs.dialogue) bodies.push(dialogueCaptureBody(catalogs.dialogue));
    if (catalogs.culture) bodies.push(effectBody(cultureCaptureEffect(catalogs.culture), 'mimir_capture_culture_effect'));
    if (catalogs.faith) bodies.push(effectBody(faithCaptureEffect(catalogs.faith), 'mimir_capture_faith_effect'));
    if (catalogs.goa) {
        const goa = catalogs.goa;
        // The console runner retains temporary script values, but debug_log localization's
        // TopScope cannot read them. Log four script-validated literal decimal digits instead.
        // This keeps a complete game-calculated census without save variables or extra mods.
        const census = 'save_temporary_scope_value_as = { name = mimir_goa_trait_count value = { value = 0\n' +
            goa.traitIds.map(id => `if = { limit = { has_trait = ${id} } add = 1 }`).join('\n') + '\n} }\n';
        const digits = Array.from({ length: 4 }, (_, position) =>
            `save_temporary_scope_value_as = { name = mimir_goa_count_digit value = { value = scope:mimir_goa_trait_count divide = ${10 ** position} floor = yes modulo = 10 } }\n` +
            Array.from({ length: 10 }, (_, digit) =>
                `${digit ? 'else_if' : 'if'} = { limit = { scope:mimir_goa_count_digit = ${digit} } debug_log = "VOTC:GOA/;/count_digit/;/${position}/;/${digit}" }`).join('\n')).join('\n');
        bodies.push(census + effectBody(goaTraitCapture(goa), 'mimir_capture_goa_effect').replace(
            '\tdebug_log = "VOTC:GOA/;/count/;/[THIS.Char.MakeScope.ScriptValue(\'mimir_goa_trait_count_value\')|0]"', digits));
    }
    const sceneBody = catalogs.scenes && targets.some(t => 'scope' in t && t.scope === 'root') ?
        'root = {\n' + launcherSceneCaptureBody(nonce) + '\n}\n' : '';
    if (!bodies.length && !sceneBody && !catalogs.clock) throw new Error('No capture catalogs');
    const clock = catalogs.clock ? `debug_log = "VOTC:ENCOUNTER/;/clock/;/${nonce}/;/[GetPlayer.GetID]/;/[GetCurrentDate.GetDateAsTotalDays]/;/[GetCurrentDate.GetYear]/;/[GetCurrentDate.GetMonthOfYear]/;/[GetCurrentDate.GetDayOfMonth]"\n` : '';
    return clock + sceneBody + targets.filter((target, index) => targets.findIndex(t => t.characterId === target.characterId) === index)
        .map(target => 'position' in target
            ? `ordered_in_global_list = { variable = mcc_characters_list_v2 position = ${target.position}\n${bodies.join('\n')}\n}`
            : `if = { limit = { exists = ${target.scope} } ${target.scope} = {\n${bodies.join('\n')}\n} }`).join('\n') +
        `\ndebug_log = "VOTC:ENCOUNTER/;/ack/;/${nonce}"\n`;
}

/** Own only a probe written into an empty standard CE command file. Never erase actions. */
export class EncounterCapture {
    private epoch = 0;
    lastAcknowledgedNonce?: string;
    lastGameDate?: Ck3GameDate;
    private pending?: { nonce: string; script: string; file: string; acknowledged: boolean; anchor?: number; date?: Ck3GameDate; clockSeen?: boolean; clockInvalid?: boolean };
    constructor(private catalogs: () => EncounterCatalogs, private flush?: () => void) {}

    /** A crash can leave a read-only probe behind. Recover only its exact sealed bytes. */
    recover(userFolder: string): void {
        if (!userFolder) return;
        for (const filename of ['votc.txt', 'votc_ce.txt', 'votc_letter_actions.txt', 'votc_ce_letter_actions.txt']) {
            const file = path.join(userFolder, 'run', filename);
            try {
                const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
                const match = /^# VOTC:TITAN:PROBE\/;\/([a-f0-9]{24})\/;\/([a-f0-9]{64})\n/.exec(text);
                if (!match) continue;
                const body = text.slice(match[0].length);
                if (body.endsWith(`debug_log = "VOTC:ENCOUNTER/;/ack/;/${match[1]}"\n`) &&
                    createHash('sha256').update(body).digest('hex') === match[2]) fs.writeFileSync(file, '', 'utf8');
            } catch { /* Missing, edited, or gameplay-owned files remain untouched. */ }
        }
    }

    observe(line: string): void {
        if (line.includes('VOTC:CAMPAIGN/;/loaded/;/')) { this.clear(); return; }
        const marker = 'VOTC:ENCOUNTER/;/clock/;/', index = line.indexOf(marker);
        if (index >= 0 && this.pending) {
            const values = line.slice(index + marker.length).trim().split('/;/');
            const [nonce, actor, total, year, month, day] = values;
            if (nonce === this.pending.nonce && this.pending.clockSeen) { this.pending.clockInvalid = true; this.pending.date = undefined; }
            if (nonce === this.pending.nonce) this.pending.clockSeen = true;
            const date = { totalDays: Number(total), year: Number(year), month: Number(month), day: Number(day), display: `${year}.${month}.${day}` };
            if (!this.pending.clockInvalid && values.length === 6 && nonce === this.pending.nonce && /^\d+$/.test(actor) && Number(actor) === this.pending.anchor &&
                values.slice(2).every(v => /^\d+$/.test(v) && Number.isSafeInteger(Number(v))) && validateCk3GameDate(date).valid) this.pending.date = date;
        }
        if (this.pending && line.trim().endsWith('VOTC:ENCOUNTER/;/ack/;/' + this.pending.nonce)) {
            this.pending.acknowledged = true;
            this.removeOwned();
        }
    }

    clear(): void { this.epoch++; this.removeOwned(); this.pending = undefined; this.lastAcknowledgedNonce = undefined; this.lastGameDate = undefined; }
    private removeOwned(): void {
        const pending = this.pending;
        if (!pending) return;
        try {
            if (fs.readFileSync(pending.file, 'utf8').replace(/^\uFEFF/, '') === pending.script)
                fs.writeFileSync(pending.file, '', 'utf8');
        } catch { /* Capture failures must not affect game operations. */ }
    }

    async capture(userFolder: string, targets: EncounterTarget[], signal: AbortSignal, filename = 'votc.txt', timeoutMs = 6000,
        options: { languagesOnly?: boolean } = {}): Promise<boolean> {
        signal.throwIfAborted();
        this.lastAcknowledgedNonce = undefined;
        this.lastGameDate = undefined;
        filename = ceCommandFile(userFolder, filename);
        if (!['votc.txt', 'votc_ce.txt', 'votc_letter_actions.txt', 'votc_ce_letter_actions.txt'].includes(filename)) throw new Error('Unsupported capture channel');
        if (this.pending || !userFolder) return false;
        let script: string;
        const nonce = randomBytes(12).toString('hex');
        try {
            const catalogs = this.catalogs();
            const body = encounterScript(options.languagesOnly ? { languages: catalogs.languages, dialogue: catalogs.dialogue,
                development: catalogs.development, loreMutation: catalogs.loreMutation, loreGameState: catalogs.loreGameState, scenes: catalogs.scenes, clock: catalogs.clock } : catalogs, targets, nonce);
            script = `# VOTC:TITAN:PROBE/;/${nonce}/;/${createHash('sha256').update(body).digest('hex')}\n` + body;
        } catch { return false; }
        const file = path.join(userFolder, 'run', filename);
        const epoch = this.epoch;
        const deadline = Date.now() + timeoutMs;
        // Allow an existing gameplay operation to be acknowledged; never append a probe to it.
        while (true) {
            signal.throwIfAborted();
            if (epoch !== this.epoch || this.pending || Date.now() >= deadline) return false;
            try {
                const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim() : '';
                if (!current) break;
            } catch { return false; }
            this.flush?.();
            await abortableDelay(100, signal);
        }
        const pending: NonNullable<EncounterCapture['pending']> = { nonce, script, file, acknowledged: false,
            anchor: targets.find(t => 'scope' in t && ['root', 'global_var:message_first_scope'].includes(t.scope))?.characterId };
        this.pending = pending;
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, '\uFEFF' + script, 'utf8');
            while (Date.now() < deadline && epoch === this.epoch) {
                signal.throwIfAborted();
                this.flush?.();
                if (pending.acknowledged) { this.lastAcknowledgedNonce = nonce; this.lastGameDate = pending.date; return true; }
                await abortableDelay(100, signal);
            }
            // A busy event loop can resume after the deadline even though CK3
            // already wrote this probe's receipt. Read it once before timing out.
            // The nonce, cancellation and encounter ownership checks still apply.
            signal.throwIfAborted();
            if (epoch === this.epoch) {
                this.flush?.();
                signal.throwIfAborted();
                if (epoch === this.epoch && pending.acknowledged) { this.lastAcknowledgedNonce = nonce; this.lastGameDate = pending.date; return true; }
            }
            return false;
        } finally {
            if (this.pending === pending) { this.removeOwned(); this.pending = undefined; }
        }
    }
}
