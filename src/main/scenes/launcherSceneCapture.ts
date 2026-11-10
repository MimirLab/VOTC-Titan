import { createHash } from 'crypto';
import { SCENE_CATALOGUE as C, SCENE_CATALOGUE_DIGEST as DIGEST } from '../../shared/scenes/catalogue.generated';
import { conditionsEligible, sceneEligible } from '../../shared/scenes/sceneContext';
import { SceneSnapshot } from '../../shared/scenes/types';
import { removeTooltip } from '../../shared/gameData/gameText';
import { validateCk3GameDate, Ck3GameDate } from '../../shared/gameData/gameDate';

const M = 'VOTC:LAUNCHER_SCENE/;/';
const settled = 'location = { OR = { has_holding_type = castle_holding has_holding_type = city_holding has_holding_type = church_holding has_holding_type = temple_citadel_holding } }';
const camp = 'location = { OR = { has_holding_type = nomad_holding has_holding_type = herder_holding } }';
const any = (parts: string[]): string => 'OR = { ' + parts.join(' ') + ' }';
type State = typeof C.worldStates[number];

/** Native, read-only facts. Historical plot windows deliberately have no calendar predicate. */
export function sceneStatePredicate(s: State): string | undefined {
    const keys = s.keys;
    if (![s.id, ...keys].every(k => /^[a-z][a-z0-9_]*$/.test(k))) throw new Error('Invalid scene predicate');
    const or = (key: string) => any(keys.map(k => key + ' = ' + k));
    switch (s.kind) {
        case 'provinceModifier': return 'location = { ' + or('has_province_modifier') + ' }';
        case 'countyModifier': return 'location.county = { ' + or('has_county_modifier') + ' }';
        case 'building': return 'location = { ' + or('has_building_or_higher') + ' }';
        case 'buildingExact': return 'location = { ' + or('has_building') + ' }';
        case 'buildingAtSite':
            if (!Number.isSafeInteger(s.provinceId) || s.provinceId! <= 0) throw new Error('Invalid site');
            return 'province:' + s.provinceId + ' = { ' + or('has_building') + ' }';
        case 'provinceHolding': return 'location = { ' + or('has_holding_type') + ' }';
        case 'countyDoctrine': return 'location.county.faith = { ' + or('has_doctrine') + ' }';
        case 'countyFaith': return 'location.county.faith = { ' + any(keys.map(k => 'this = faith:' + k)) + ' }';
        case 'countyReligion': return 'location.county.faith = { ' + any(keys.map(k => 'religion = religion:' + k)) + ' }';
        case 'provinceTradition': return 'location.culture = { ' + or('has_cultural_tradition') + ' }';
        case 'provinceCultureLineage': {
            const matches = any(keys.map(k => 'this = culture:' + k));
            return 'location.culture = { OR = { ' + matches + ' any_parent_culture_or_above = { ' + matches + ' } } }';
        }
        case 'countyDevelopment':
            if (!Number.isSafeInteger(s.minimum) || s.minimum! < 0) throw new Error('Invalid development');
            return 'location.county = { development_level >= ' + s.minimum + ' }';
        case 'provinceArmy': return 'location = { any_army_in_location = { count >= 1 } }';
        case 'campOrActivity': return 'OR = { ' + camp + ' AND = { exists = involved_activity involved_activity = { has_activity_type = activity_hunt activity_location = prev.location } } }';
        // Derived below from the actual party, current native facts or stable host episodes.
        case 'encounterLocalFaith': case 'encounterLocalCulture': case 'encounterFaithCustody':
        case 'ambientEpisode': case 'historicalWindow': case 'encounteredAftermath': return;
        default: throw new Error('Unsupported scene predicate');
    }
}
function log(key: string, value: string): string { return 'debug_log = "' + M + key + '/;/' + value + '"'; }
function check(key: string, expression: string): string {
    return 'if = { limit = { ' + expression + ' } ' + log(key, '1') + ' } else = { ' + log(key, '0') + ' }';
}
/** Script values cannot be interpolated by debug_log; use the proven literal digit protocol. */
function digits(key: string, value: string, count: number): string {
    return Array.from({ length: count }, (_, position) =>
        'save_temporary_scope_value_as = { name = titan_scene_digit value = { value = ' + value + ' divide = ' + 10 ** position + ' floor = yes modulo = 10 } }\n' +
        Array.from({ length: 10 }, (_, digit) => (digit ? 'else_if' : 'if') +
            ' = { limit = { scope:titan_scene_digit = ' + digit + ' } ' + log('digit', key + '/;/' + position + '/;/' + digit) + ' }').join('\n')).join('\n');
}

/** Respect the player's stock CE venue. Only clear visual equivalents auto-select art. */
export function preferredSceneForCe(snapshot: SceneSnapshot, ceScene: string): string | undefined {
    const scenes = C.scenes.filter(s => snapshot.eligible.includes(s.id));
    const equivalents = scenes.filter(s => {
        if (ceScene === 'throne_room') return s.id.endsWith('_court') || s.id.includes('_throne_') || s.id.endsWith('_high_seat');
        if (ceScene === 'tavern' || ceScene === 'crossroads_inn') return s.environment === 'environment_event_tavern';
        if (ceScene === 'terrain_travel') return s.regionalEnvironment === true;
        if (ceScene === 'ocean') return s.id === 'titan_sea';
        if (ceScene === 'coast') return s.id === 'titan_coast' || s.regionalEnvironment && s.conditions.coastal === true;
        return false;
    });
    return equivalents.sort((a, b) => b.priority - a.priority)[0]?.id;
}
export function launcherSceneCaptureBody(nonce: string): string {
    if (!/^[a-f0-9]{24}$/.test(nonce)) throw new Error('Invalid scene probe nonce');
    const lines = [
        'save_scope_as = titan_scene_anchor',
        log('begin', nonce + '/;/' + DIGEST + '/;/[THIS.Char.GetID]/;/[THIS.Char.GetCurrentLocation.GetName]/;/[THIS.Char.GetCurrentLocation.GetController.GetFullNameNicknamedNoTooltipRegnal]/;/[GetCurrentDate.GetDateAsTotalDays]/;/[GetCurrentDate.GetYear]/;/[GetCurrentDate.GetMonthOfYear]/;/[GetCurrentDate.GetDayOfMonth]'),
    ];
    const choice = (key: string, values: string[], expression: (v: string) => string) => {
        lines.push(values.map((v, i) => (i ? 'else_if' : 'if') + ' = { limit = { ' + expression(v) + ' } ' + log(key, v) + ' }').join('\n') +
            '\nelse = { ' + log(key, 'unknown') + ' }');
    };
    choice('terrain', C.terrains, v => 'location = { terrain = ' + v + ' }');
    choice('style', C.styles.map(s => s.id), v => 'location.culture = { ' + any(C.styles.find(s => s.id === v)!.heritages.map(h => 'has_cultural_pillar = ' + h)) + ' }');
    choice('culture', C.cultures, v => 'location.culture = { this = culture:' + v + ' }');
    for (const [key, expression] of Object.entries({ settled, camp, coastal: 'location = { is_coastal = yes }', riverside: 'location = { is_riverside_province = yes }' }))
        lines.push(check(key, expression));
    for (const state of C.worldStates) {
        const expression = sceneStatePredicate(state);
        if (expression) lines.push(check('state/;/' + state.id, expression));
    }
    lines.push(check('aftermath_seen', 'location = { has_variable = titan_scene_contamination_observed }'));
    lines.push(digits('script_day', 'current_date', 7));
    lines.push('if = { limit = { location = { has_variable = titan_scene_local_seed } } ' + digits('seed', 'location.var:titan_scene_local_seed', 7) + ' }');
    lines.push('if = { limit = { has_global_variable = votc_campaign_id_a } ' +
        'save_temporary_scope_value_as = { name = titan_scene_campaign value = { value = global_var:votc_campaign_id_a modulo = 997 } } ' + digits('campaign', 'scope:titan_scene_campaign', 3) + ' }');
    // Inspect only CE's actual participant list and the player. No pins, invitations or global ruler scan.
    const member = 'faith = scope:titan_scene_anchor.location.county.faith is_at_same_location = scope:titan_scene_anchor';
    const captor = member + ' scope:titan_scene_subject = { is_imprisoned_by = prev }';
    const admission = 'OR = { faith = scope:titan_scene_anchor.location.county.faith scope:titan_scene_anchor = { ' + captor + ' } any_in_global_list = { variable = mcc_characters_list_v2 ' + captor + ' } }';
    const party = [
        'save_scope_as = titan_scene_subject', log('party', '[THIS.Char.GetID]'),
        check('party_local', 'is_at_same_location = scope:titan_scene_anchor'),
        check('party_faith', 'faith = scope:titan_scene_anchor.location.county.faith'),
        check('party_culture', 'culture = scope:titan_scene_anchor.location.culture'),
        check('party_access', 'is_at_same_location = scope:titan_scene_anchor ' + admission)
    ].join('\n');
    lines.push(party, 'if = { limit = { has_global_variable_list = mcc_characters_list_v2 } every_in_global_list = { variable = mcc_characters_list_v2 limit = { NOT = { this = scope:titan_scene_anchor } }\n' + party + '\n} }');
    lines.push(log('end', nonce + '/;/' + DIGEST));
    return lines.join('\n');
}

interface Frame {
    nonce: string; snapshot: SceneSnapshot; date: Ck3GameDate; fields: Map<string, string>;
    digits: Map<string, Map<number, number>>; party: Map<number, Record<string, boolean>>; subject?: number;
}
/** One complete nonce-bound observation only. Partial or duplicate data cannot supply a negative fact. */
export class LauncherSceneReader {
    private frame?: Frame;
    private invalid = false;
    private results = new Map<string, Frame>();
    clear(): void { this.frame = undefined; this.results.clear(); this.invalid = false; }
    observe(line: string): void {
        if (line.includes('VOTC:CAMPAIGN/;/loaded/;/')) { this.clear(); return; }
        const index = line.indexOf(M); if (index < 0) return;
        const [kind, ...v] = line.slice(index + M.length).trim().split('/;/');
        if (kind === 'begin') {
            this.frame = undefined; this.invalid = false;
            const [nonce, digest, actor, rawLocation, rawController, ...clock] = v;
            const provinceIds = new Set([...(rawLocation?.matchAll(/(?:ONCLICK|TOOLTIP):PROVINCE,(\d+)\b/g) ?? [])].map(m => Number(m[1])));
            const [totalDays, year, month, day] = clock.map(Number);
            const date = { totalDays, year, month, day, display: year + '.' + month + '.' + day };
            const location = removeTooltip(rawLocation), controller = removeTooltip(rawController);
            if (v.length !== 9 || !/^[a-f0-9]{24}$/.test(nonce) || digest !== DIGEST || !/^\d+$/.test(actor) ||
                !Number.isSafeInteger(Number(actor)) || provinceIds.size !== 1 || [...provinceIds].some(n => !Number.isSafeInteger(n) || n <= 0) ||
                !location || location.length > 300 || controller.length > 300 || /[\[\]\r\n]/.test(location + controller) || !validateCk3GameDate(date).valid) return;
            this.results.delete(nonce);
            this.frame = { nonce, date, fields: new Map(), digits: new Map(), party: new Map(),
                snapshot: { schema: 1, catalogue: DIGEST, mode: 'goa', anchorId: Number(actor), selected: '', location, controller,
                    provinceId: [...provinceIds][0], terrain: '', style: '', culture: 'unknown', regions: [], settled: false, camp: false,
                    coastal: false, riverside: false, worldStates: [], observedWorldStates: [], eligible: [], presentation: 'launcher' } };
            return;
        }
        const f = this.frame; if (!f) return;
        if (kind === 'end') {
            const required = ['terrain', 'style', 'culture', 'settled', 'camp', 'coastal', 'riverside', 'aftermath_seen',
                ...C.worldStates.filter(s => sceneStatePredicate(s)).map(s => 'state:' + s.id)];
            if (v.length !== 2 || v[0] !== f.nonce || v[1] !== DIGEST || required.some(k => !f.fields.has(k)) ||
                !C.terrains.includes(f.fields.get('terrain')!) || (f.fields.get('style') !== 'unknown' && !C.styles.some(s => s.id === f.fields.get('style'))) ||
                (f.fields.get('culture') !== 'unknown' && !C.cultures.includes(f.fields.get('culture')!))) this.invalid = true;
            if (!this.invalid) { this.results.set(f.nonce, f); if (this.results.size > 4) this.results.delete(this.results.keys().next().value!); }
            this.frame = undefined; return;
        }
        if (kind === 'party') {
            const actor = Number(v[0]);
            if (v.length !== 1 || !/^\d+$/.test(v[0]) || !Number.isSafeInteger(actor) || f.party.size >= 17 || f.party.has(actor)) this.invalid = true;
            else { f.subject = actor; f.party.set(actor, {}); }
            return;
        }
        if (kind.startsWith('party_')) {
            const p = f.party.get(f.subject!);
            if (!p || v.length !== 1 || !['local', 'faith', 'culture', 'access'].includes(kind.slice(6)) || kind in p || !['0','1'].includes(v[0])) this.invalid = true;
            else p[kind] = v[0] === '1';
            return;
        }
        if (kind === 'digit') {
            const [key, position, digit] = v;
            const count = key === 'campaign' ? 3 : ['script_day', 'seed'].includes(key) ? 7 : 0;
            const map = f.digits.get(key) ?? new Map<number, number>();
            if (v.length !== 3 || !/^\d$/.test(position) || !/^\d$/.test(digit) || Number(position) >= count || map.has(Number(position))) this.invalid = true;
            else { map.set(Number(position), Number(digit)); f.digits.set(key, map); }
            return;
        }
        const key = kind === 'state' ? 'state:' + v.shift() : kind;
        if (v.length !== 1 || f.fields.has(key) || (!['terrain', 'style', 'culture'].includes(key) && !['0', '1'].includes(v[0])) ||
            (!['terrain','style','culture','settled','camp','coastal','riverside','aftermath_seen'].includes(key) &&
                !C.worldStates.some(s => key === 'state:' + s.id && sceneStatePredicate(s)))) this.invalid = true;
        else f.fields.set(key, v[0]);
    }
    consume(nonce: string, anchor: number, participantIds: number[], campaignKey: string, selected?: string): SceneSnapshot | undefined {
        const f = this.results.get(nonce); this.results.delete(nonce);
        if (!f || f.snapshot.anchorId !== anchor) return;
        const p = f.snapshot;
        p.terrain = f.fields.get('terrain')!; p.style = f.fields.get('style')!; p.culture = f.fields.get('culture')!;
        for (const key of ['settled', 'camp', 'coastal', 'riverside'] as const) p[key] = f.fields.get(key) === '1';
        p.regions = C.regions.filter(r => r.provinces?.includes(p.provinceId!)).map(r => r.id);
        const set = (id: string, value: boolean) => { p.observedWorldStates!.push(id); if (value) p.worldStates.push(id); };
        for (const state of C.worldStates) if (sceneStatePredicate(state)) set(state.id, f.fields.get('state:' + state.id) === '1');
        // A location outside an explicitly bounded area cannot be "burned here".
        // This is geography, not a calendar-based claim that the plot did or did not occur.
        for (const state of C.worldStates) if (state.kind === 'historicalWindow' && state.provinceIds && !state.provinceIds.includes(p.provinceId!)) set(state.id, false);
        const partyIds = new Set([anchor, ...participantIds]);
        const completeParty = partyIds.size >= 2 && f.party.size === partyIds.size && [...partyIds].every(id => {
            const member = f.party.get(id);
            return member && ['party_local', 'party_faith', 'party_culture', 'party_access'].every(k => k in member);
        });
        for (const [id, predicate] of [
            ['community_faith_members', 'party_faith'], ['community_culture_members', 'party_culture'], ['community_faith_access', 'party_access']]) {
            if (completeParty) set(id, [...f.party.values()].every(member => member.party_local && member[predicate]));
        }
        if (f.fields.get('aftermath_seen') === '1') set('uncertain_aftermath', !['fel_corruption','death_corruption','shadow_corruption'].some(id => p.worldStates.includes(id)));
        const number = (key: string, count: number): number | undefined => {
            const map = f.digits.get(key);
            if (map?.size !== count) return;
            return [...map].reduce((total, [position, digit]) => total + digit * 10 ** position, 0);
        };
        const day = number('script_day', 7), campaign = number('campaign', 3), legacySeed = number('seed', 7);
        // Stable campaign/province fallback lives only in the launcher, never in the save.
        const seed = legacySeed !== undefined && legacySeed >= 65536 && legacySeed <= 131071 ? legacySeed :
            65536 + createHash('sha256').update(campaignKey + ':' + p.provinceId).digest().readUInt16LE(0);
        if (day !== undefined && campaign !== undefined && campaignKey) for (const episode of C.episodes) {
            const cycle = Math.floor((day + seed % episode.periodDays) / episode.periodDays);
            const phase = (day + seed % episode.periodDays) % episode.periodDays;
            const ticket = (seed % 997 * 37 + campaign * 17 + cycle % 997 * 53 + episode.salt) % 100;
            if ([...(episode.conditions.worldStates ?? []), ...(episode.conditions.excludedWorldStates ?? [])].some(id => !p.observedWorldStates!.includes(id))) continue;
            const calendar = !episode.calendar || episode.calendar.some(w => w.month === f.date.month && f.date.day >= w.fromDay && f.date.day <= w.toDay);
            set(episode.id, calendar && phase < episode.activeDays && ticket < episode.chance && conditionsEligible(episode.conditions, p));
        }
        // Date-only plot alterations stay unknown. Current building facts already unlock their physical counterparts.
        p.eligible = C.scenes.filter(s => sceneEligible(s, p)).map(s => s.id);
        p.selected = selected && p.eligible.includes(selected) ? selected :
            [...C.scenes].filter(s => p.eligible.includes(s.id)).sort((a, b) => b.priority - a.priority)[0]?.id ?? '';
        return p.selected ? p : undefined;
    }
}
