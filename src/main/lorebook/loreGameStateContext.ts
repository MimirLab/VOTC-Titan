import type { Config } from '../../shared/Config';
import type { GameData } from '../../shared/gameData/GameData';
import { canonicalJsonStringify } from '../promptWorkbench/canonicalJson';
import { getVerifiedGoaSnapshot } from '../goa/goaRuntime';
import { resolveGoaLore } from '../goa/goaResolver';
import { encounterLoreIdentity, LoreReport } from './lorebookContext';
import { ObservedLoreTicket } from './lorebookObservedContext';
import { currentLoreGameStateCatalog, getLoreGameState } from './loreGameStateRuntime';

export interface GameStateLoreContext {
    origin: 'verified_current_game_state'; campaign_id: string; timeline_id: string; actor_id: string;
    as_of: string; setting_sha256: string; current_state_digest: string; acting_owner: 'ordinary' | 'fallen'; observed_actor_id: string;
    clock: { totalDays: number; year: number; month: number; day: number };
    values: Record<string, boolean | null>;
    common_context?: ObservedLoreTicket['context']; reported_context?: LoreReport;
}

export function prepareGameStateLoreContext(game: GameData, actorId: number, config: Config, setting: string,
    common?: ObservedLoreTicket, reported?: LoreReport) {
    if (config.goaLoreEnabled === false || config.lorebookEnabled === false) return;
    const actor = game.characters.get(actorId), catalog = currentLoreGameStateCatalog();
    const snapshot = actor && getLoreGameState(actor), body = actor && getVerifiedGoaSnapshot(actor);
    if (!actor || !catalog || !snapshot || !body || !game.gameDate) return;
    const identity = encounterLoreIdentity(game, actorId), catalogDigest = catalog.digest;
    const clock = { totalDays: game.gameDate.totalDays, year: game.gameDate.year, month: game.gameDate.month, day: game.gameDate.day };
    if (snapshot.characterId !== actorId || snapshot.digest !== catalogDigest ||
        Object.entries(clock).some(([key, value]) => snapshot.date[key as keyof typeof clock] !== value)) return;
    for (const nested of [common?.context, reported].filter(Boolean)) {
        const value = nested as any;
        if (value.campaign_id !== identity.campaign || value.timeline_id !== identity.timeline || value.as_of !== identity.date ||
            (value.actor_id ?? value.lore_knowledge?.actor_id) !== identity.actor ||
            (value.setting_sha256 ?? value.lore_knowledge?.setting_sha256) !== setting)
            throw new Error('Current-state and character knowledge contexts differ.');
    }
    const owner = resolveGoaLore(actor.fullName, body).identityPolicy === 'fallen_controller' ? 'fallen' : 'ordinary';
    const context: GameStateLoreContext = { origin: 'verified_current_game_state', campaign_id: identity.campaign,
        timeline_id: identity.timeline, actor_id: identity.actor, as_of: identity.date, setting_sha256: setting,
        current_state_digest: catalogDigest, acting_owner: owner, observed_actor_id: String(snapshot.characterId), clock, values: { ...snapshot.values },
        ...(common ? { common_context: common.context } : {}), ...(reported ? { reported_context: reported } : {}) };
    const binding = canonicalJsonStringify(context), bodyBinding = canonicalJsonStringify(body);
    return { context, binding, isCurrent: () => {
        try {
            return config.goaLoreEnabled !== false && config.lorebookEnabled !== false &&
                game.characters.get(actorId) === actor && currentLoreGameStateCatalog()?.digest === catalogDigest &&
                getLoreGameState(actor) === snapshot && canonicalJsonStringify(context) === binding &&
                canonicalJsonStringify(getVerifiedGoaSnapshot(actor)) === bodyBinding &&
                canonicalJsonStringify(encounterLoreIdentity(game, actorId)) === canonicalJsonStringify(identity) && (!common || common.isCurrent());
        } catch { return false; }
    } };
}

