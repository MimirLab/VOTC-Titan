import fs from 'node:fs';
import path from 'node:path';

jest.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }), { virtual: true });
jest.mock('../../src/main/culture/cultureRuntime', () => ({ getCultureBackground: (actor: any) => actor.background }));
jest.mock('../../src/main/goa/goaRuntime', () => ({ getVerifiedGoaSnapshot: (actor: any) => actor.goa }));
jest.mock('../../src/main/goa/goaResolver', () => ({ resolveGoaLore: () => ({ identityPolicy: 'ordinary' }) }));
jest.mock('../../src/main/lorebook/lorebookContext', () => ({ encounterLoreIdentity: (game: any, id: number) =>
    ({ campaign: game.campaign, timeline: game.timeline, actor: String(id), date: game.date }) }));

import { prepareObservedLoreContext } from '../../src/main/lorebook/lorebookObservedContext';

const policy = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tools/lorebook-observed-bindings.json'), 'utf8'));
const root = (key: string) => structuredClone(policy.lineageBindings.find((r: any) => r.lineageFact.key === key).lineageFact);
function fixture() {
    const pillars = ['ethos', 'heritage', 'language', 'martial_custom'].map(category => ({ kind: 'pillar', key: 'unknown_' + category,
        category, name: '', description: '', rules: '' }));
    const actor: any = { id: 2, age: 40, fullName: 'Synthetic hybrid', background: 'A current culture profile', goa: { complete: true },
        cultureSnapshot: { version: 2, complete: true, facts: pillars }, cultureLineage: [root('wildhammer'), root('bronzebeard')] };
    const game: any = { characters: new Map([[2, actor]]), campaign: 'a', timeline: 'b', date: '0583-01-01' };
    const config: any = { cultureRoleplayEnabled: true, goaLoreEnabled: true, lorebookEnabled: true };
    return { actor, game, config };
}
const edition = 'a'.repeat(64);

test('verified multiple parents enable lore familiarity when the current heritage is unmapped', () => {
    const f = fixture(), ticket = prepareObservedLoreContext(f.game, 2, f.config, edition)!;
    expect(ticket.context.culture_lineage).toEqual([root('wildhammer'), root('bronzebeard')]);
    expect(ticket.isCurrent()).toBe(true);
    f.actor.cultureLineage.pop();
    expect(ticket.isCurrent()).toBe(false);
});

test('unknown or changed roots cannot enable an unmapped culture context', () => {
    const f = fixture();
    f.actor.cultureLineage = [];
    expect(prepareObservedLoreContext(f.game, 2, f.config, edition)).toBeUndefined();
    const changed = root('wildhammer'); changed.rules += 'changed'; f.actor.cultureLineage.push(changed);
    expect(prepareObservedLoreContext(f.game, 2, f.config, edition)).toBeUndefined();
});

test('culture, identity and date changes revoke a prepared inherited-lore ticket', () => {
    const f = fixture(), ticket = prepareObservedLoreContext(f.game, 2, f.config, edition)!;
    f.game.date = '0583-01-02'; expect(ticket.isCurrent()).toBe(false);
    f.game.date = '0583-01-01'; f.config.cultureRoleplayEnabled = false; expect(ticket.isCurrent()).toBe(false);
});
