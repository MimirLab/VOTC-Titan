import { culturalMartialCue } from '../src/main/background/culturalCues';
import { CultureFact } from '../src/shared/gameData/CultureSnapshot';

function fact(sex: 'male' | 'female' | 'equal'): CultureFact {
    const key = 'martial_custom_' + (sex === 'equal' ? 'equal' : sex + '_only') + '_combatant';
    const people = sex === 'male' ? 'men' : 'women';
    return { kind: 'pillar', category: 'martial_custom', key: 'unfamiliar_mod_key', name: 'Unfamiliar name',
        description: sex === 'equal' ? 'In this culture, any able-bodied person in the household may take up arms for their liege when called on.' :
            `This culture considers only ${people} to be physically strong and tough enough to fight in battle.`,
        rules: JSON.stringify({ definitions: [{ key: 'parameters', operator: '=', value: [{ key, operator: '=', value: 'yes' }] }],
            parameterDescriptions: { [key]: sex === 'equal' ? 'Both men and women can be commanders and (context-dependent wording)' : `Only ${people} can be commanders and (context-dependent wording)` },
            conditionalDescriptions: {}, modifierEvidence: [] }) };
}

test.each(['male','female','equal'] as const)('current %s combat convention retains eligibility without body or civilian authority claims', sex => {
    const input = fact(sex), before = JSON.stringify(input), text = culturalMartialCue(input)!;
    expect(text).toContain(sex === 'equal' ? 'both men and women' : "customarily " + (sex === 'male' ? 'men' : 'women') + "'s roles");
    expect(text).toContain('command'); expect(text).toContain('no individual strength');
    expect(text).not.toContain('physically strong'); expect(JSON.stringify(input)).toBe(before);
    if (sex !== 'equal') {
        expect(text).toContain('Governing, teaching and civilian craft follow their own customs');
        expect(text).toContain('Other adopted customs and established character facts may qualify exceptions');
        expect(text).not.toContain('Only');
    }
    else expect(text).toContain('when called on');
});

test.each(['description','parameterDescription','declaration','extraDeclaration','conditional','modifier','missingRules','otherCategory'])('changed or incomplete %s cannot inherit a familiar combat reading', change => {
    const input = fact('male'), rules = JSON.parse(input.rules);
    if (change === 'description') input.description = 'All people may fight if they meet a different condition.';
    if (change === 'parameterDescription') rules.parameterDescriptions.martial_custom_male_only_combatant = 'Only men may govern.';
    if (change === 'declaration') rules.definitions[0].value[0].value = 'no';
    if (change === 'extraDeclaration') rules.definitions[0].value.push({ key: 'different_restriction', operator: '=', value: 'yes' });
    if (change === 'conditional') rules.conditionalDescriptions.change = 'Only under another condition.';
    if (change === 'modifier') rules.modifierEvidence.push({ scope: 'different' });
    input.rules = change === 'missingRules' ? '' : JSON.stringify(rules);
    if (change === 'otherCategory') input.category = 'heritage';
    expect(culturalMartialCue(input)).toBeUndefined();
});
