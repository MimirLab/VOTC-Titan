import { createHash } from 'crypto';
import type { GameStateLoreContext } from './loreGameStateContext';
import type { LoreGameStateCatalog } from './loreGameStateCapture';

export interface CurrentStateAccountContext { account: string; branchId: string; title: string; observedAt: string }
export function bindCurrentStateAccounts(passages: readonly any[], context: GameStateLoreContext,
    catalog: LoreGameStateCatalog): CurrentStateAccountContext[] {
    if (context.current_state_digest !== catalog.digest) throw new Error('Current-state edition changed.');
    return passages.flatMap(p => {
        const value = p.observed_turning;
        if (!value) return [];
        const rule = catalog.rules.find(rule => rule.id === value.rule_id), account = rule?.account;
        const prefix = account && p.subject_id !== account.branch_id ? account.subject_headings[p.subject_id] : undefined;
        const heading = account?.node_headings[p.node_id];
        const expectedHeading = prefix && heading ? prefix + ' — ' + heading : heading;
        const digest = createHash('sha256').update(p.text).digest('hex');
        if (!account || context.acting_owner !== 'ordinary' || context.values[rule!.id] !== true ||
            value.kind !== 'verified_current_state_trace' || value.actor_id !== context.actor_id ||
            value.observed_at !== context.as_of || value.occurred_at !== null || value.node_id !== p.node_id ||
            value.branch_id !== account.branch_id || value.accepted_definition_sha256 !== account.accepted_definition_sha256 ||
            account.node_sha256[p.node_id] !== digest || value.body_sha256 !== digest ||
            (p.subject_id !== account.branch_id && !prefix) || p.heading !== expectedHeading)
            throw new Error('Current-state account differs from its actor, trace or accepted book body.');
        return [{ account: p.heading + '\n' + p.text, branchId: account.branch_id, title: account.title, observedAt: context.as_of }];
    });
}

export function currentStateAccountNotes(contexts: readonly CurrentStateAccountContext[]): string {
    if (!contexts.length) return '';
    const unique = [...new Map(contexts.map(c => [c.branchId, c])).values()];
    return '[Current-save traces belonging to this individual: ' + unique.map(c =>
        `${JSON.stringify(c.title)}, observed on ${c.observedAt}.`).join(' ') +
        ' The game retains the indicated choice or trace, not its occurrence date. Do not invent a dated memory, later completion, successful outcome or another person’s knowledge. Preserve the accounts’ conditions and uncertainty. Keep this applicability context private.]';
}

/** Current engine facts constrain the writer without granting the NPC new
 * memories. Attach only the small subset relevant to the supplied lore/topic.
 */
export function currentWorldStateNotes(context: GameStateLoreContext, topic: string): string {
    const groups: [RegExp, [string, string, string][]][] = [
        [/suramar|nightborne|shalassian/i, [['suramar_open', 'Suramar is marked open by the game’s isolation state.', 'Suramar is marked closed by the game’s isolation state.']]],
        [/pandaria|pandaren|mists/i, [['pandaria_open', 'Pandaria’s mists are marked parted.', 'Pandaria’s mists are marked unparted.']]],
        [/uldum|origination|protocol/i, [['uldum_open', 'Uldum is marked open.', 'Uldum is marked closed.'],
            ['origination_active', 'The origination protocol is currently enabled.', 'The origination protocol is currently disabled.']]],
        [/nordrassil|world tree|kaldorei|night el/i, [
            ['nordrassil_was_sacrificed_to_kill_archimonde', 'The save retains the Nordrassil sacrifice marker; this alone does not establish its present condition or date.', ''],
            ['nordrassil_was_destroyed_by_a_demon', 'The save retains the demon-destruction marker for Nordrassil; this alone does not establish its present condition or date.', '']]],
        [/theramore|refugee|exile/i, [['theramore_departure_started', 'The refugee-departure marker is present; departure is distinct from arrival or founding.', ''],
            ['theramore_founded', 'A refuge-founding marker is present; this does not establish its city, founder or date.', ''],
            ['theramore_kingdom_created', 'The refugee-kingdom marker is present; this does not identify its ruler or date.', '']]],
        [/horde|blackhand|doomhammer|gul.dan|first war|dark portal/i, [
            ['horde_invasion_started', 'The Horde invasion has a start marker; this does not prove a particular result.', ''],
            ['horde_story_ended', 'The Horde story has an ending marker; this does not establish which outcome occurred.', '']]],
    ];
    const facts = groups.filter(([pattern]) => pattern.test(topic)).flatMap(([, rows]) => rows.flatMap(([key, yes, no]) =>
        context.values[key] === true ? [yes] : context.values[key] === false && no ? [no] : [])).filter(Boolean).slice(0, 3);
    return facts.length ? '[Private world-state constraints observed on ' + context.as_of + ': ' + facts.join(' ') +
        ' Use these only to keep the scene consistent. They do not grant this character awareness, memories, training or hearsay. Do not announce hidden facts or invent causes.]' : '';
}
