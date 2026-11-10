import { createHash } from 'crypto';
import type { LoreMutationCatalog } from './loreMutationCapture';
import type { MutationLoreContext } from './loreMutationContext';

export interface LoreTurningContext {
    account: string;
    nodeId: string;
    branchId: string;
    title: string;
    occurredAt: string;
    stage: 'choice' | 'attempt' | 'declaration' | 'outcome' | 'existing_state';
}
const stages: Record<string, LoreTurningContext['stage']> = {
    coded_choice: 'choice', conditional_actor_choice: 'choice', attempt: 'attempt',
    declaration_only: 'declaration', coded_resolution: 'outcome', conditional_existing_state: 'existing_state',
};
export function bindObservedTurningContexts(passages: readonly any[], context: MutationLoreContext,
    catalogue: LoreMutationCatalog): LoreTurningContext[] {
    if (context.mutation_digest !== catalogue.digest) throw new Error('Observed turning catalogue changed.');
    return passages.flatMap(p => {
        const value = p.observed_turning;
        if (!value) return [];
        const point = catalogue.points.find(point => point.token === value.token);
        const bodyHash = createHash('sha256').update(p.text).digest('hex');
        const prefix = p.subject_id !== point?.branch_id ? point?.subject_headings?.[p.subject_id] : undefined;
        const heading = point?.node_headings?.[p.node_id];
        const expectedHeading = prefix && heading ? prefix + ' — ' + heading : heading;
        const memories = context.memories.filter(memory => memory.actorId.toString() === context.actor_id &&
            memory.owner === context.acting_owner && memory.token === value.token &&
            `${String(memory.date.year).padStart(4, '0')}-${String(memory.date.month).padStart(2, '0')}-${String(memory.date.day).padStart(2, '0')}` === value.occurred_at);
        if (!point || !memories.length || value.kind !== 'verified_character_turning' || value.actor_id !== context.actor_id ||
            value.owner !== context.acting_owner || value.node_id !== p.node_id || value.branch_id !== point.branch_id ||
            (p.node_id !== point.branch_id && !p.node_id.startsWith(point.branch_id + ':')) ||
            value.phase !== point.phase || value.account_kind !== point.account_kind || !stages[point.account_kind] ||
            value.accepted_definition_sha256 !== point.accepted_definition_sha256 || value.execution_definition_sha256 !== point.definition_sha256 ||
            (p.subject_id !== point.branch_id && !prefix) || value.body_sha256 !== bodyHash ||
            point.node_sha256?.[p.node_id] !== bodyHash || expectedHeading !== p.heading)
            throw new Error('Observed turning differs from its admitted account, character or source.');
        return [{ account: p.heading + '\n' + p.text, nodeId: p.node_id, branchId: point.branch_id,
            title: point.title, occurredAt: value.occurred_at, stage: stages[point.account_kind] }];
    });
}

/** Applicability accompanies the exact book body; it never rewrites that body
 * or converts an attempted act into success. This is private writer context.
 */
export function rememberedTurningNotes(contexts: readonly LoreTurningContext[]): string {
    if (!contexts.length) return '';
    const unique = [...new Map(contexts.map(context => [context.branchId + ':' + context.occurredAt, context])).values()];
    return '[Character knowledge of campaign turnings: ' + unique.map(context =>
        `${JSON.stringify(context.title)}: ${context.stage.replace('_', ' ')} recorded on ${context.occurredAt}.`).join(' ') +
        ' These are turnings known to this individual. Preserve each account’s conditions and limits; attempts, declarations and selected choices do not prove their later success. ' +
        'These are dated records, so current circumstances and subsequent established events may differ. Keep this context private.]';
}
