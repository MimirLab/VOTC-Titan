import { Ck3GameDate, validateCk3GameDate } from '../../shared/gameData/gameDate';

export interface LoreMutationPoint {
    token: string;
    branch_id: string;
    path: string;
    definition: string;
    definition_sha256: string;
    accepted_definition_sha256: string;
    option_index: number | null;
    marker_line: number | null;
    account_kind: string;
    title: string;
    memory_type: string;
    owner_scope: string;
    actual_callback_alias: boolean;
    phase: 'executable_body_completed' | 'duel_callback_completed';
    source_origin?: 'goa' | 'base_game';
    entry_ids?: string[];
    node_sha256?: Record<string, string>;
    node_headings?: Record<string, string>;
    subject_headings?: Record<string, string>;
}
export interface LoreMutationCatalog {
    version: 1;
    digest: string;
    mod_version: string;
    supplement_sha256: string;
    source_pins: Record<string, string>;
    base_source_pins?: Record<string, string>;
    patch_pins: Record<string, string>;
    memory_owner_policies: ('ordinary' | 'fallen')[];
    points: LoreMutationPoint[];
    auxiliary_definitions?: { definition: string; path: string; source_origin: 'goa' | 'base_game' | 'titan' }[];
}
export interface LoreMutationMemory {
    actorId: number;
    token: string;
    owner: 'ordinary' | 'fallen';
    date: Ck3GameDate;
    ordinal: number;
}
export interface LoreMutationSnapshot {
    version: 1;
    digest: string;
    characterId: number;
    date: Ck3GameDate;
    /** Missing is an observation of absence, never proof an event was averted. */
    world: Record<string, number | null>;
    memories: LoreMutationMemory[];
}

/** Dependencies concern accounts this actor can actually read. An unrelated
 * turning must not interrupt ordinary RP or reset a deepening lore chapter.
 * Explicit reported-history readers retain the conservative whole-world bound.
 */
export function mutationDependencyTokens(catalog: LoreMutationCatalog, memories: readonly LoreMutationMemory[], allWorld = false): Set<string> {
    const own = new Set(memories.map(m => m.token));
    const entries = new Set(catalog.points.filter(p => own.has(p.token)).flatMap(p => p.entry_ids ?? []));
    return new Set(catalog.points.filter(p => allWorld || own.has(p.token) ||
        (!['attempt', 'declaration_only'].includes(p.account_kind) && p.entry_ids?.some(entry => entries.has(entry)))).map(p => p.token));
}

function integer(value: string | undefined): number | undefined {
    if (!value || !/^\d+$/.test(value)) return;
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : undefined;
}
function dateFields(fields: string[]): Ck3GameDate | undefined {
    if (fields.length !== 4) return;
    const numbers = fields.map(integer);
    if (numbers.some(n => n === undefined)) return;
    const [totalDays, year, month, day] = numbers as number[];
    const date = { totalDays, year, month, day, display: `${year}.${month}.${day}` };
    return validateCk3GameDate(date).valid ? date : undefined;
}

/** Complete, edition-bound snapshots only. New frames immediately withdraw old
 * observations. Persistent memories come from the current save, not a host log
 * archive; loading an older save therefore cannot carry future knowledge back.
 */
export class LoreMutationLogReader {
    private pending?: LoreMutationSnapshot;
    private invalid = false;
    private worldDigits = new Map<string, Map<number, number>>();
    private currentWorld?: string;
    readonly observations = new Map<number, LoreMutationSnapshot>();
    readonly revisions = new Map<number, number>();
    readonly seenAt = new Map<number, number>();
    epoch = 0;
    private readonly tokens: Set<string>;
    private dependencies = new Map<number, Set<string>>();
    constructor(readonly catalog: LoreMutationCatalog) {
        this.tokens = new Set(catalog.points.map(p => p.token));
        if (!/^[a-f0-9]{64}$/.test(catalog.digest) || this.tokens.size !== catalog.points.length ||
            [...this.tokens].some(token => !/^tlm_[a-f0-9]{24}$/.test(token))) throw new Error('Invalid lore mutation catalogue.');
    }
    clear(): void {
        this.pending = undefined; this.invalid = false; this.worldDigits.clear(); this.currentWorld = undefined;
        this.observations.clear(); this.revisions.clear(); this.seenAt.clear(); this.dependencies.clear(); this.epoch++;
    }
    setDependencies(actor: number, tokens: Set<string>): void { this.dependencies.set(actor, new Set(tokens)); }
    private withdraw(actor: number): void {
        this.observations.delete(actor); this.seenAt.delete(actor); this.dependencies.delete(actor);
        this.revisions.set(actor, (this.revisions.get(actor) ?? 0) + 1);
    }
    observeLine(line: string): void {
        if (line.includes('VOTC:CAMPAIGN/;/loaded/;/')) { this.clear(); return; }
        const marker = line.indexOf('VOTC:LORE_MUTATION/;/');
        if (marker < 0) return;
        const [kind, ...args] = line.slice(marker + 'VOTC:LORE_MUTATION/;/'.length).trim().split('/;/');
        // A live turning withdraws old snapshots immediately. It grants no
        // facts; the next ordinary encounter must read the persistent state.
        if (kind === 'changed') {
            this.pending = undefined; this.worldDigits.clear(); this.currentWorld = undefined;
            const [token, recipient] = args;
            if (args.length !== 2 || !this.tokens.has(token)) { this.clear(); return; }
            if (recipient === 'world') {
                for (const [actor, value] of this.observations) {
                    const dependencies = this.dependencies.get(actor) ?? mutationDependencyTokens(this.catalog, value.memories);
                    if (dependencies.has(token)) this.withdraw(actor);
                }
            } else {
                const actor = integer(recipient);
                if (actor === undefined) this.clear(); else this.withdraw(actor);
            }
            return;
        }
        if (kind === 'begin') {
            this.pending = undefined; this.invalid = false; this.worldDigits.clear(); this.currentWorld = undefined;
            const actor = integer(args[2]);
            if (actor !== undefined) {
                this.withdraw(actor);
            }
            const date = dateFields(args.slice(3));
            if (args.length !== 7 || args[0] !== '1' || args[1] !== this.catalog.digest || actor === undefined || !date) return;
            this.pending = { version: 1, digest: args[1], characterId: actor, date, world: {}, memories: [] };
            return;
        }
        const value = this.pending;
        if (!value) return;
        if (kind === 'world') {
            const [token, time] = args;
            const day = time === 'missing' ? null : integer(time);
            if (this.currentWorld || args.length !== 2 || !this.tokens.has(token) || this.worldDigits.has(token) || Object.prototype.hasOwnProperty.call(value.world, token) ||
                day === undefined || (day !== null && (day <= 0 || day > value.date.totalDays))) this.invalid = true;
            else value.world[token] = day;
        } else if (kind === 'world_start') {
            const token = args[0];
            if (args.length !== 1 || this.currentWorld || !this.tokens.has(token) || this.worldDigits.has(token) ||
                Object.prototype.hasOwnProperty.call(value.world, token)) this.invalid = true;
            else this.currentWorld = token;
        } else if (kind === 'world_end') {
            if (args.length !== 1 || args[0] !== this.currentWorld || this.worldDigits.get(args[0])?.size !== 7) this.invalid = true;
            this.currentWorld = undefined;
        } else if (kind === 'world_digit') {
            const [token, position, digit] = args.length === 2 ? [this.currentWorld, ...args] : args;
            if ((args.length !== 2 && args.length !== 3) || !token || !this.tokens.has(token) || !/^[0-6]$/.test(position ?? '') || !/^[0-9]$/.test(digit ?? '') ||
                Object.prototype.hasOwnProperty.call(value.world, token)) this.invalid = true;
            else {
                const digits = this.worldDigits.get(token) ?? new Map<number, number>();
                if (digits.has(Number(position))) this.invalid = true;
                else digits.set(Number(position), Number(digit));
                this.worldDigits.set(token, digits);
                if (digits.size === 7) {
                    const day = [...digits].reduce((total, [position, digit]) => total + digit * 10 ** position, 0);
                    if (day <= 0 || day > value.date.totalDays) this.invalid = true;
                    else value.world[token] = day;
                }
            }
        } else if (kind === 'memory') {
            const [actor, receipt, ...fields] = args;
            const match = /^(tlm_[a-f0-9]{24})_(ordinary|fallen)$/.exec(receipt ?? '');
            const date = dateFields(fields);
            if (integer(actor) !== value.characterId || args.length !== 6 || !match || !this.tokens.has(match[1]) ||
                !this.catalog.memory_owner_policies.includes(match[2] as 'ordinary' | 'fallen') || !date ||
                date.totalDays > value.date.totalDays ||
                `${date.year.toString().padStart(4, '0')}-${date.month.toString().padStart(2, '0')}-${date.day.toString().padStart(2, '0')}` >
                `${value.date.year.toString().padStart(4, '0')}-${value.date.month.toString().padStart(2, '0')}-${value.date.day.toString().padStart(2, '0')}` ||
                value.memories.length >= 4096) this.invalid = true;
            else value.memories.push({ actorId: value.characterId, token: match[1], owner: match[2] as 'ordinary' | 'fallen', date, ordinal: value.memories.length });
        } else if (kind === 'end') {
            if (!this.invalid && !this.currentWorld && args.length === 2 && args[0] === value.digest && integer(args[1]) === value.characterId &&
                Object.keys(value.world).length === this.tokens.size &&
                // Script current_date and CharacterMemory.GetCreationDate's
                // GetDateAsTotalDays use different day origins in CK3. Do not
                // compare them or invent an epoch conversion. The persistent
                // world receipt must exist; the memory's own numeric/calendar
                // date independently bounds character knowledge to this save.
                value.memories.every(m => typeof value.world[m.token] === 'number')) {
                this.observations.set(value.characterId, value); this.seenAt.set(value.characterId, Date.now());
            }
            this.pending = undefined;
        } else this.invalid = true;
    }
}

/** Add to the already-owned encounter probe: no new model or console round trip. */
export function loreMutationCaptureBody(catalog: LoreMutationCatalog): string {
    new LoreMutationLogReader(catalog); // Validate every interpolated identifier.
    const clock = '[GetCurrentDate.GetDateAsTotalDays]/;/[GetCurrentDate.GetYear]/;/[GetCurrentDate.GetMonthOfYear]/;/[GetCurrentDate.GetDayOfMonth]';
    const lines = [`debug_log = "VOTC:LORE_MUTATION/;/begin/;/1/;/${catalog.digest}/;/[THIS.Char.GetID]/;/${clock}"`];
    for (const point of catalog.points) {
        const variable = 'titan_world_' + point.token;
        // Match the existing encounter's literal-digit transport. The stored
        // day never depends on localized floating-point number formatting.
        lines.push(`if = { limit = { has_global_variable = ${variable} }\ndebug_log = "VOTC:LORE_MUTATION/;/world_start/;/${point.token}"\ntitan_log_lore_world_day = { VARIABLE = ${variable} }\ndebug_log = "VOTC:LORE_MUTATION/;/world_end/;/${point.token}"\n}`,
            `else = { debug_log = "VOTC:LORE_MUTATION/;/world/;/${point.token}/;/missing" }`);
    }
    lines.push('every_memory = { limit = { has_memory_category = titan_lore has_variable = titan_lore_receipt }',
        'debug_log = "VOTC:LORE_MUTATION/;/memory/;/[THIS.CharacterMemory.GetOwner.GetID]/;/[THIS.Var(\'titan_lore_receipt\').GetFlagName]/;/[THIS.CharacterMemory.GetCreationDate.GetDateAsTotalDays]/;/[THIS.CharacterMemory.GetCreationDate.GetYear]/;/[THIS.CharacterMemory.GetCreationDate.GetMonthOfYear]/;/[THIS.CharacterMemory.GetCreationDate.GetDayOfMonth]"',
        '}', `debug_log = "VOTC:LORE_MUTATION/;/end/;/${catalog.digest}/;/[THIS.Char.GetID]"`);
    return lines.join('\n');
}
