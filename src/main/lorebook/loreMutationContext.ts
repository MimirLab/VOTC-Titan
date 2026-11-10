import type { Config } from '../../shared/Config';
import type { GameData } from '../../shared/gameData/GameData';
import { canonicalJsonStringify } from '../promptWorkbench/canonicalJson';
import { getVerifiedGoaSnapshot } from '../goa/goaRuntime';
import { resolveGoaLore } from '../goa/goaResolver';
import { encounterLoreIdentity, LoreReport } from './lorebookContext';
import { ObservedLoreTicket } from './lorebookObservedContext';
import { currentLoreMutationCatalog, getVerifiedLoreMutationSnapshot, bindLoreMutationDependencies } from './loreMutationRuntime';
import { LoreMutationMemory, mutationDependencyTokens } from './loreMutationCapture';

export interface MutationLoreContext {
    origin: 'verified_campaign_mutations';
    campaign_id: string;
    timeline_id: string;
    actor_id: string;
    as_of: string;
    setting_sha256: string;
    mutation_digest: string;
    acting_owner: 'ordinary' | 'fallen';
    clock: { totalDays: number; year: number; month: number; day: number };
    world: Record<string, number | null>;
    memories: LoreMutationMemory[];
    common_context?: ObservedLoreTicket['context'];
    reported_context?: LoreReport;
}
export interface MutationLoreTicket { context: MutationLoreContext; binding: string; isCurrent: () => boolean }

/** Actual current-save observations stay distinct from explicit user reports.
 * Neither a global event nor an inherited culture grants a private event memory.
 */
export function prepareMutationLoreContext(game: GameData, actorId: number, config: Config, setting: string,
    common?: ObservedLoreTicket, reported?: LoreReport): MutationLoreTicket | undefined {
    if (config.goaLoreEnabled === false || config.lorebookEnabled === false) return;
    const actor = game.characters.get(actorId), catalogue = currentLoreMutationCatalog();
    const snapshot = actor && getVerifiedLoreMutationSnapshot(actor), body = actor && getVerifiedGoaSnapshot(actor);
    if (!actor || !snapshot || snapshot.characterId !== actorId || !catalogue || !body || !game.gameDate) return;
    const catalogueDigest = catalogue.digest;
    const identity = encounterLoreIdentity(game, actorId);
    const clock = { totalDays: game.gameDate.totalDays, year: game.gameDate.year, month: game.gameDate.month, day: game.gameDate.day };
    if (snapshot.digest !== catalogue.digest || ['totalDays', 'year', 'month', 'day'].some(key =>
        snapshot.date[key as keyof typeof clock] !== clock[key as keyof typeof clock])) return;
    const owner = resolveGoaLore(actor.fullName, body).identityPolicy === 'fallen_controller' ? 'fallen' : 'ordinary';
    if (common && (!common.isCurrent() || common.context.actor_id !== identity.actor ||
        common.context.campaign_id !== identity.campaign || common.context.timeline_id !== identity.timeline ||
        common.context.as_of !== identity.date || common.context.setting_sha256 !== setting)) throw new Error('Cultural knowledge differs from the mutation capture.');
    if (reported && (reported.origin !== 'user_reported' || reported.campaign_id !== identity.campaign ||
        reported.timeline_id !== identity.timeline || reported.as_of !== identity.date ||
        reported.lore_knowledge.actor_id !== identity.actor || reported.lore_knowledge.setting_sha256 !== setting))
        throw new Error('Reported knowledge differs from the mutation capture.');
    const context: MutationLoreContext = { origin: 'verified_campaign_mutations', campaign_id: identity.campaign,
        timeline_id: identity.timeline, actor_id: identity.actor, as_of: identity.date, setting_sha256: setting,
        mutation_digest: catalogue.digest, acting_owner: owner, clock, world: { ...snapshot.world },
        memories: snapshot.memories.filter(memory => memory.owner === owner).map(memory => ({ ...memory, date: { ...memory.date } })),
        ...(common ? { common_context: common.context } : {}), ...(reported ? { reported_context: reported } : {}) };
    const dependencies = mutationDependencyTokens(catalogue, context.memories, !!reported);
    bindLoreMutationDependencies(actor, snapshot, dependencies);
    const relevantWorld = (world: Record<string, number | null>) => Object.fromEntries([...dependencies].sort().map(token => [token, world[token]]));
    const snapshotFingerprint = (value: typeof snapshot) => canonicalJsonStringify({ ...value, world: relevantWorld(value.world),
        memories: value.memories.filter(memory => memory.owner === owner) });
    const binding = canonicalJsonStringify({ ...context, world: relevantWorld(context.world) });
    const contextBinding = canonicalJsonStringify(context), snapshotBinding = snapshotFingerprint(snapshot), bodyBinding = canonicalJsonStringify(body);
    return { context, binding, isCurrent: () => {
        try {
            const current = getVerifiedLoreMutationSnapshot(actor);
            return config.goaLoreEnabled !== false && config.lorebookEnabled !== false &&
                game.characters.get(actorId) === actor && currentLoreMutationCatalog()?.digest === catalogueDigest &&
                !!current && snapshotFingerprint(current) === snapshotBinding &&
                canonicalJsonStringify(getVerifiedGoaSnapshot(actor)) === bodyBinding &&
                canonicalJsonStringify(encounterLoreIdentity(game, actorId)) === canonicalJsonStringify(identity) &&
                canonicalJsonStringify(context) === contextBinding && (!common || common.isCurrent());
        } catch { return false; }
    } };
}
