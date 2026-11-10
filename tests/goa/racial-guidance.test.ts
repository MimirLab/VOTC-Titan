import { resolveGoaLore } from '../../src/main/goa/goaResolver';
import { GoaRuleContext } from '../../src/main/goa/goaRuleContext';
import { GoaSnapshot } from '../../src/shared/gameData/GoaSnapshot';

const snapshot = (traitIds: string[], extra: Partial<GoaSnapshot> = {}): GoaSnapshot => ({
    version: 1, digest: 'a'.repeat(64), characterId: 2, sex: 'female', traitIds, facts: {}, ...extra
});
const profiles = [
    ['creature_black_dragon', 'black_dragon_dominance'], ['creature_flamewaker', 'flamewaker_authority'],
    ['creature_nerubian', 'nerubian_deliberation'], ['creature_qiraji', 'qiraji_command_manner'],
    ['creature_faldorei', 'faldorei_predatory_patience'], ['creature_kvaldir', 'kvaldir_grievance'],
    ['creature_makrura', 'makrura_boundary_manner'], ['creature_sethrak', 'sethrak_composure'],
    ['creature_tolvir', 'tolvir_guardian_manner'], ['creature_sea_giant', 'sea_giant_territoriality'],
    ['creature_frostnymph', 'frostnymph_playfulness'], ['creature_voidwalker', 'voidwalker_alien_manner'],
    ['worgen', 'worgen_curse_pressure'], ['mindless_worgen', 'worgen_mindless_state']
];

test.each(profiles)('%s guidance requires the actual character and remains private', (trait, key) => {
    const actor = snapshot([trait]);
    expect(resolveGoaLore('Asha', actor).selectedKeys).toContain(key);
    expect(resolveGoaLore('Asha', snapshot(['blood_' + trait.replace('creature_', '')])).selectedKeys).not.toContain(key);
    expect(resolveGoaLore('Asha', actor, {}, 'observer').selectedKeys).not.toContain(key);
    expect(resolveGoaLore('Asha', actor, { knownRuleKeys: [key] }, 'observer').selectedKeys).toEqual([key]);
    const captive = snapshot([trait, 'fallen_demon_hunter', 'being_demon']);
    expect(resolveGoaLore('Asha', captive).selectedKeys).not.toContain(key);
});

test('the curse, current form and explicit loss of reason remain different facts', () => {
    const ordinary = resolveGoaLore('Asha', snapshot(['creature_human', 'worgen', 'compassionate']));
    expect(ordinary.body).toBe('creature_human');
    expect(ordinary.identityPolicy).toBe('ordinary');
    expect(ordinary.selectedKeys).toContain('worgen_curse_pressure');
    expect(ordinary.selectedKeys).not.toContain('worgen_mindless_state');
    expect(ordinary.text).toContain('intelligence, affection and chosen ethics remain meaningful');
    const feral = resolveGoaLore('Asha', snapshot(['creature_human', 'worgen', 'mindless_worgen']));
    expect(feral.selectedKeys).toContain('worgen_mindless_state');
    expect(feral.selectedKeys).not.toContain('worgen_curse_pressure');
    expect(feral.identityPolicy).toBe('ordinary');
    const restored = resolveGoaLore('Asha', snapshot(['worgen', 'mindless_worgen'], { facts: { restored_cognition: true } }));
    expect(restored.selectedKeys).toContain('worgen_curse_pressure');
    expect(restored.selectedKeys).not.toContain('worgen_mindless_state');
});

test('underlying mental manner survives changed anatomy without lending its body to the form', () => {
    const packet = resolveGoaLore('Asha', snapshot(['creature_faldorei', 'cat_form']));
    expect(packet.body).toBe('cat_form');
    expect(packet.selectedKeys).toContain('faldorei_predatory_patience');
    expect(packet.selectedKeys).not.toContain('body_faldorei');
    expect(packet.text).not.toMatch(/elevated position|legs settle|pincers|spinnerets/);
});

test('corrupted nature does not retain the newly supplied healthy Frost Nymph disposition', () => {
    for (const extra of [{ facts: { nightmare_corruption: true } }, { traitIds: ['creature_frostnymph', 'being_void'] }]) {
        expect(resolveGoaLore('Asha', snapshot(['creature_frostnymph'], extra)).selectedKeys).not.toContain('frostnymph_playfulness');
    }
});

test('new prose preserves sex grammar and the narrow Voidwalker current-body exception', () => {
    for (const sex of ['male', 'female', undefined] as const) {
        const packet = resolveGoaLore('Asha', snapshot(['creature_frostnymph'], { sex }));
        expect(packet.text).not.toMatch(/\[[A-Za-z]+\]|\{[A-Za-z_]+\}/);
        expect(packet.pronouns).toBe(sex === 'male' ? 'he/him' : sex === 'female' ? 'she/her' : 'name only');
    }
    expect(resolveGoaLore('Umbra', snapshot(['creature_voidwalker'])).pronouns).toBe('they/them');
    expect(resolveGoaLore('Umbra', snapshot(['creature_voidwalker', 'cat_form'], { sex: 'male' })).pronouns).toBe('he/him');
});

test('Kvaldir spirits do not acquire living-mortal corruption pressures from another race label', () => {
    const spirit = snapshot(['creature_kvaldir', 'creature_human', 'being_void']);
    expect(new GoaRuleContext(spirit).living).toBe(false);
    expect(resolveGoaLore('Asha', spirit).selectedKeys).not.toContain('void_mortal_pressure');
});
