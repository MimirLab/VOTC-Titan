import { Ck3GameDate, validateCk3GameDate } from '../../shared/gameData/gameDate';

export interface StatePredicate {
    kind: 'global_exists' | 'global_value' | 'global_list' | 'actor_exists' | 'actor_value' | 'actor_flag';
    name: string;
    value?: string;
}
export interface LoreGameStateRule {
    id: string;
    predicate: StatePredicate;
    available?: StatePredicate;
    subjects: string[];
    exclusive_group?: string;
    account?: {
        branch_id: string; title: string; entry_ids: string[]; subject_headings: Record<string, string>;
        node_sha256: Record<string, string>; node_headings: Record<string, string>;
        accepted_definition_sha256: string; account_kind: string; path: string; definition: string;
        awareness: 'same_actor_persistent_trace'; occurred_at_known: false;
    };
}
export interface LoreGameStateCatalog {
    format: 'titan_lore_game_state_v1'; digest: string; mod_version: string;
    supplement_sha256: string; source_pins: Record<string, string>; rules: LoreGameStateRule[];
}
export interface LoreGameStateSnapshot {
    digest: string; characterId: number; date: Ck3GameDate;
    values: Record<string, boolean | null>;
}

/** A deliberately small predicate language. No effect, script helper, file
 * installation, global write, memory creation or persistent listener is emitted.
 */
export function statePredicate(predicate: StatePredicate): string {
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(predicate.name) ||
        predicate.value !== undefined && !/^[A-Za-z_][A-Za-z_0-9]*$/.test(predicate.value))
        throw new Error('Invalid current-state identifier.');
    const { name, value } = predicate;
    switch (predicate.kind) {
        case 'global_exists': return `has_global_variable = ${name}`;
        case 'global_value':
            if (!['yes', 'no'].includes(value ?? '')) throw new Error('Invalid global boolean.');
            return `global_var:${name} = ${value}`;
        case 'global_list':
            if (!value) throw new Error('Missing global-list member.');
            return `is_target_in_global_variable_list = { name = ${name} target = flag:${value} }`;
        case 'actor_exists': return `has_variable = ${name}`;
        case 'actor_value':
            if (!value) throw new Error('Missing actor value.');
            return `var:${name} = flag:${value}`;
        case 'actor_flag': return `has_character_flag = ${name}`;
        default: throw new Error('Unsupported read-only state predicate.');
    }
}

export function loreGameStateCaptureBody(catalog: LoreGameStateCatalog): string {
    new LoreGameStateReader(catalog);
    const marker = 'VOTC:LORE_STATE/;/';
    const clock = '[GetCurrentDate.GetDateAsTotalDays]/;/[GetCurrentDate.GetYear]/;/[GetCurrentDate.GetMonthOfYear]/;/[GetCurrentDate.GetDayOfMonth]';
    const lines = [`debug_log = "${marker}begin/;/1/;/${catalog.digest}/;/[THIS.Char.GetID]/;/${clock}"`];
    for (const rule of catalog.rules) {
        const negative = rule.predicate.kind === 'global_value' ?
            `else_if = { limit = { ${statePredicate({ ...rule.predicate, value: rule.predicate.value === 'yes' ? 'no' : 'yes' })} } debug_log = "${marker}value/;/${rule.id}/;/0" }\n` +
            `else = { debug_log = "${marker}value/;/${rule.id}/;/unknown" }` :
            `else = { debug_log = "${marker}value/;/${rule.id}/;/0" }`;
        const observation = `if = { limit = { ${statePredicate(rule.predicate)} } debug_log = "${marker}value/;/${rule.id}/;/1" }\n` + negative;
        lines.push(rule.available ? `if = { limit = { ${statePredicate(rule.available)} }\n${observation}\n}\n` +
            `else = { debug_log = "${marker}value/;/${rule.id}/;/unknown" }` : observation);
    }
    lines.push(`debug_log = "${marker}end/;/${catalog.digest}/;/[THIS.Char.GetID]"`);
    return lines.join('\n');
}

/** Consume only responses to ordinary RP probes on CE's existing log channel.
 * There is no game-event subscription or between-turn background polling.
 */
export class LoreGameStateReader {
    private pending?: LoreGameStateSnapshot;
    private invalid = false;
    private keys: Set<string>;
    readonly snapshots = new Map<number, LoreGameStateSnapshot>();
    readonly seenAt = new Map<number, number>();
    constructor(readonly catalog: LoreGameStateCatalog) {
        this.keys = new Set(catalog.rules.map(rule => rule.id));
        if (catalog.format !== 'titan_lore_game_state_v1' || !/^[a-f0-9]{64}$/.test(catalog.digest) ||
            !this.keys.size || this.keys.size > 256 || this.keys.size !== catalog.rules.length ||
            [...this.keys].some(k => !/^[a-z][a-z0-9_]{0,79}$/.test(k))) throw new Error('Invalid current-state catalogue.');
        for (const rule of catalog.rules) {
            statePredicate(rule.predicate);
            if (rule.available) statePredicate(rule.available);
            if (rule.account && (rule.account.awareness !== 'same_actor_persistent_trace' || rule.account.occurred_at_known !== false ||
                !rule.predicate.kind.startsWith('actor_'))) throw new Error('World state cannot grant private knowledge.');
        }
    }
    clear(): void { this.pending = undefined; this.invalid = false; this.snapshots.clear(); this.seenAt.clear(); }
    observe(line: string): void {
        if (line.includes('VOTC:CAMPAIGN/;/loaded/;/')) { this.clear(); return; }
        const index = line.indexOf('VOTC:LORE_STATE/;/');
        if (index < 0) return;
        const [kind, ...args] = line.slice(index + 'VOTC:LORE_STATE/;/'.length).trim().split('/;/');
        if (kind === 'begin') {
            this.pending = undefined; this.invalid = false;
            const numbers = args.slice(2).map(s => /^\d+$/.test(s) ? Number(s) : NaN);
            const [actor, totalDays, year, month, day] = numbers;
            if (Number.isSafeInteger(actor) && actor >= 0) { this.snapshots.delete(actor); this.seenAt.delete(actor); }
            const date = { totalDays, year, month, day, display: `${year}.${month}.${day}` };
            if (args.length !== 7 || args[0] !== '1' || args[1] !== this.catalog.digest ||
                numbers.some(n => !Number.isSafeInteger(n)) || actor < 0 || !validateCk3GameDate(date).valid) return;
            this.pending = { digest: args[1], characterId: actor, date, values: {} };
            return;
        }
        const frame = this.pending;
        if (!frame) return;
        if (kind === 'value') {
            const [key, value] = args;
            if (args.length !== 2 || !this.keys.has(key) || key in frame.values || !['0', '1', 'unknown'].includes(value)) this.invalid = true;
            else frame.values[key] = value === 'unknown' ? null : value === '1';
        } else if (kind === 'end') {
            const groups = new Map<string, number>();
            for (const rule of this.catalog.rules) if (rule.exclusive_group && frame.values[rule.id] === true)
                groups.set(rule.exclusive_group, (groups.get(rule.exclusive_group) ?? 0) + 1);
            if (!this.invalid && args.length === 2 && args[0] === frame.digest && args[1] === String(frame.characterId) &&
                Object.keys(frame.values).length === this.keys.size && [...groups.values()].every(n => n <= 1)) {
                this.snapshots.set(frame.characterId, frame); this.seenAt.set(frame.characterId, Date.now());
            }
            this.pending = undefined;
        } else this.invalid = true;
    }
}
