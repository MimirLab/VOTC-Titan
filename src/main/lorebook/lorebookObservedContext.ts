import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { createHash } from 'crypto';
import type { GameData } from '../../shared/gameData/GameData';
import type { Config } from '../../shared/Config';
import { CultureFact, validateCultureSnapshot } from '../../shared/gameData/CultureSnapshot';
import type { Character } from '../../shared/gameData/Character';
import { getCultureBackground } from '../culture/cultureRuntime';
import { getVerifiedGoaSnapshot } from '../goa/goaRuntime';
import { resolveGoaLore } from '../goa/goaResolver';
import { canonicalJsonStringify } from '../promptWorkbench/canonicalJson';
import { encounterLoreIdentity } from './lorebookContext';

export interface ObservedLoreContext {
    origin: 'verified_current_culture';
    campaign_id: string;
    timeline_id: string;
    actor_id: string;
    as_of: string;
    setting_sha256: string;
    culture_heritage: unknown;
    /** Source-bound native current/parent culture observations, not names. */
    culture_lineage?: unknown[];
}
export interface ObservedLoreTicket { context: ObservedLoreContext; isCurrent: () => boolean }

/** Familiarity with inherited/adopted customs, never a fabricated history report.
 * The ready getter authenticates the current Character's live observation. A
 * saved snapshot, display label or biological trait alone cannot grant access.
 */
export function prepareObservedLoreContext(game: GameData, actorId: number, config: Config, setting: string): ObservedLoreTicket | undefined {
    if (config.cultureRoleplayEnabled === false || config.goaLoreEnabled === false || config.lorebookEnabled === false || !/^[a-f0-9]{64}$/u.test(setting)) return;
    const actor = game.characters.get(actorId);
    if (!actor) return;
    // Initial common-familiarity adapter covers older speakers only. It does
    // not infer training or racial maturity, and never transfers the original
    // person's culture to a replacement controlling intelligence.
    const age = actor.age;
    if (!Number.isFinite(age) || age < 16 || !getVerifiedGoaSnapshot(actor)) return;
    if (resolveGoaLore(actor.fullName, getVerifiedGoaSnapshot(actor)!).identityPolicy !== 'ordinary') return;
    const paragraph = getCultureBackground(actor);
    if (!paragraph || !actor.cultureSnapshot) return;
    const snapshot = validateCultureSnapshot(actor.cultureSnapshot);
    const heritage = snapshot.facts.filter(f => f.kind === 'pillar' && f.category === 'heritage');
    if (heritage.length !== 1) return;
    const file = path.join(app.getAppPath(), 'tools/lorebook-observed-bindings.json');
    const policyBytes = fs.readFileSync(file, 'utf8'), policy = JSON.parse(policyBytes);
    if (policy.version !== 1 || !Array.isArray(policy.bindings)) throw new Error('Invalid observed lore policy');
    const matches = policy.bindings.filter((binding: any) => canonicalJsonStringify(binding.heritageFact) === canonicalJsonStringify(heritage[0]));
    if (matches.length > 1) throw new Error('Ambiguous observed heritage policy');
    const lineage = (actor as Character & { cultureLineage?: CultureFact[] }).cultureLineage ?? [];
    if (!Array.isArray(lineage) || lineage.some(f => f.kind !== 'lineage')) return;
    // Reuse the normal versioned fact validator before handing any source
    // binding to the worker, even though these facts remain live-only.
    validateCultureSnapshot({ ...snapshot, facts: [...snapshot.facts, ...lineage] });
    const inherited = (policy.lineageBindings ?? []).filter((binding: any) =>
        lineage.some(f => canonicalJsonStringify(binding.lineageFact) === canonicalJsonStringify(f)));
    if ((!matches.length || !matches[0].observedCultureDefinitions?.length) && !inherited.length) return;
    const identity = encounterLoreIdentity(game, actorId), snapshotBinding = canonicalJsonStringify(snapshot);
    const lineageBinding = canonicalJsonStringify(lineage);
    const bodyBinding = canonicalJsonStringify(getVerifiedGoaSnapshot(actor));
    const context: ObservedLoreContext = { origin: 'verified_current_culture', campaign_id: identity.campaign,
        timeline_id: identity.timeline, actor_id: identity.actor, as_of: identity.date, setting_sha256: setting,
        culture_heritage: { ...heritage[0] }, culture_lineage: lineage.map(f => ({ ...f })) };
    const contextBinding = canonicalJsonStringify(context), policyHash = createHash('sha256').update(policyBytes).digest('hex');
    return { context, isCurrent: () => {
        try {
            return config.cultureRoleplayEnabled !== false && config.goaLoreEnabled !== false && config.lorebookEnabled !== false &&
                game.characters.get(actorId) === actor && getCultureBackground(actor) === paragraph &&
                actor.age === age &&
                canonicalJsonStringify(actor.cultureSnapshot) === snapshotBinding &&
                canonicalJsonStringify((actor as Character & { cultureLineage?: CultureFact[] }).cultureLineage ?? []) === lineageBinding &&
                canonicalJsonStringify(getVerifiedGoaSnapshot(actor)) === bodyBinding &&
                canonicalJsonStringify(encounterLoreIdentity(game, actorId)) === canonicalJsonStringify(identity) &&
                canonicalJsonStringify(context) === contextBinding && createHash('sha256').update(fs.readFileSync(file)).digest('hex') === policyHash;
        } catch { return false; }
    } };
}
