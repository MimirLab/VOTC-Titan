import { resolveGoaLore } from '../../src/main/goa/goaResolver';
import { GoaSnapshot } from '../../src/shared/gameData/GoaSnapshot';

const packet = (traitIds: string[], extra: Partial<GoaSnapshot> = {}) => resolveGoaLore('Aren', {
    version: 1, digest: 'a'.repeat(64), characterId: 2, sex: 'female', traitIds, facts: {}, ...extra,
});

test.each(['male', 'female', undefined] as const)('soul-bound prison overrides physical forms while retaining nature, mantle and %s grammar', sex => {
    for (const currentBody of [undefined, 'creature_orc', 'cat_form']) {
        const p = packet(['creature_orc', 'being_undead', 'lich_king', 'in_ice_prison', 'dire', 'cat_form', 'metamorphosis'], { sex, currentBody });
        expect(p.body).toBe('in_ice_prison');
        expect(p.identityPolicy).toBe('ordinary');
        expect(p.selectedKeys).toEqual(expect.arrayContaining(['orc_nature', 'undead_identity', 'lich_king', 'ice_prison']));
        for (const key of ['race_orc_body', 'dire_body', 'cat_form', 'metamorphosis', 'undead_flesh_senses']) expect(p.selectedKeys).not.toContain(key);
        expect(p.pronouns).toBe(sex === 'male' ? 'he/him' : sex === 'female' ? 'she/her' : 'name only');
    }
});

test.each(['ice_block', 'hibernation'])('%s incapacity preserves the actual body', condition => {
    const p = packet(['creature_orc', condition]);
    expect(p.body).toBe('creature_orc');
    expect(p.selectedKeys).toContain('race_orc_body');
});

test.each([
    ['creature_lich', 'race_lich', 'lich_necromantic_perspective'],
    ['creature_wickerman', 'race_wickerman', undefined],
    ['creature_wicker_golem', 'race_wicker_golem', undefined],
    ['creature_eredruin', 'race_eredruin', 'eredruin_destructive_appetite'],
])('%s anatomy follows the current body without erasing independent nature', (id, key, nature) => {
    expect(packet([id!]).selectedKeys).toContain(key);
    const transformed = packet([id!, 'cat_form']);
    expect(transformed.body).toBe('cat_form');
    expect(transformed.selectedKeys).toContain('cat_form');
    expect(transformed.selectedKeys).not.toContain(key);
    if (nature) expect(transformed.selectedKeys).toContain(nature);
    const captive = packet([id!, 'in_ice_prison']);
    expect(captive.selectedKeys).toContain('ice_prison');
    expect(captive.selectedKeys).not.toContain(key);
});

test('removing the actual prison state restores ordinary anatomy and invalidates the cached packet', () => {
    const captive = packet(['creature_orc', 'being_undead', 'lich_king', 'in_ice_prison']);
    const released = packet(['creature_orc', 'being_undead', 'lich_king']);
    expect(released.body).toBe('creature_orc');
    expect(released.selectedKeys).toContain('race_orc_body');
    expect(released.selectedKeys).not.toContain('ice_prison');
    expect(released.hash).not.toBe(captive.hash);
});

test('Metamorphosis requires the resolved form while its hunter retains an independent mind', () => {
    const ids = ['creature_orc', 'demon_hunter', 'metamorphosis'];
    expect(packet(ids).selectedKeys).toContain('metamorphosis');
    const otherBody = packet(ids, { currentBody: 'cat_form' });
    expect(otherBody.body).toBe('cat_form');
    expect(otherBody.selectedKeys).not.toContain('metamorphosis');
    expect(otherBody.selectedKeys).toContain('demon_hunter');
});

test('a soul-bound Fallen demon retains its acting identity and owner-only captivity', () => {
    const ids = ['creature_orc', 'demon_hunter', 'metamorphosis', 'fallen_demon_hunter', 'in_ice_prison'];
    const owner = packet(ids);
    expect(owner.identityPolicy).toBe('fallen_controller');
    expect(owner.identityInstruction).toContain('controlling demon');
    expect(owner.selectedKeys).toContain('ice_prison');
    expect(owner.selectedKeys).not.toContain('orc_nature');
    expect(owner.selectedKeys).not.toContain('metamorphosis');
    const observer = resolveGoaLore('Aren', {
        version: 1, digest: 'a'.repeat(64), characterId: 2, sex: 'female', traitIds: ids, facts: {},
    }, { knownRuleKeys: ['ice_prison'] }, 'observer');
    expect(observer.selectedKeys).toContain('ice_prison');
    expect(observer.selectedKeys).not.toContain('fallen_demon_hunter');
    expect(observer.text).not.toContain('conscious captive');
});
