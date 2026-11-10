import { passagePlan, extractionEvidence, extractionFormat, renderExtraction } from '../src/main/background/sourceReference';
import { culturalCue, culturalCourtCue } from '../src/main/background/culturalCues';
import { cultureInput, validateCultureResult } from '../src/main/culture/cultureIdentity';
import { snapshot, fact } from './culture/fixtures';
import { cultureSourceId } from '../src/main/culture/cultureEvidence';

function familySnapshot(enabled = true) {
    const data = snapshot(), family = fact('tradition', 'current_family_custom');
    family.description = '';
    family.rules = JSON.stringify({ definitions: [{ key: 'parameters', value: [
        { key: 'landing_house_members', value: enabled ? 'yes' : 'no' },
        { key: 'revoking_house_titles', value: enabled ? 'yes' : 'no' },
        { key: 'loyal_valued', value: enabled ? 'yes' : 'no' }
    ] }], parameterDescriptions: {
        landing_house_members: 'Gain prestige when granting titles to house members',
        revoking_house_titles: 'Lose prestige when revoking titles from house members',
        loyal_valued: 'The Loyal trait is more valued'
    } });
    data.facts.push(family);
    return data;
}

test('description-poor customs retain related observed social incentives in one selectable passage', () => {
    const data = familySnapshot(), customs = passagePlan('culture', data).passages.filter(p => p.kind === 'social custom');
    expect(customs).toHaveLength(1);
    expect(customs[0].text).toBe('Gain public esteem when granting titles to house members. Lose public esteem when revoking titles from house members. The disposition "Loyal" is more valued.');
    // This is source evidence for authoring; an unknown tradition cannot enter generation.
    expect(() => validateCultureResult({ selections: [customs[0].id] }, cultureInput(data, 'en'))).toThrow('current_family_custom (missing)');
});

test('disabled declarations do not become an active custom or approval of the opposite', () => {
    const plan = passagePlan('culture', familySnapshot(false));
    expect(plan.passages.some(p => p.kind === 'social custom')).toBe(false);
    expect(plan.passages.some(p => /outsiders|disloyalty/u.test(p.text))).toBe(false);
});

test.each([
    'The Grant Pardoninteraction gives much more positive opinion and a strong hook',
    'rulers will seldom use the Promote Culturecouncillor task',
    'Characters tell each other stories, increasing skills',
    'guardians of this culture are more effective'
])('mechanical supporting prose is excluded without treating its remainder as a custom: %s', text => {
    expect(culturalCue(text)).toBeUndefined();
    const data = familySnapshot(), family = data.facts.at(-1)!;
    const rules = JSON.parse(family.rules);
    rules.definitions[0].value.push({ key: 'mechanical_declaration', value: 'yes' });
    rules.parameterDescriptions.mechanical_declaration = text;
    family.rules = JSON.stringify(rules);
    expect(passagePlan('culture', data).passages.some(p => p.text.includes(text))).toBe(false);
});

test('custom eligibility qualifications survive selection without asserting present enactment', () => {
    const text = 'rulers may raise runestones to commemorate certain major life events, earning public esteem (Before the High Medievalera)';
    const cue = culturalCue(text)!;
    expect(cue).toContain('rulers may');
    expect(cue).toContain('(Before the High Medieval era)');
    expect(cue).not.toContain('must');
});

test('readable current trait esteem retains direction; unresolved labels and conditional effects do not enter the pool', () => {
    const data = snapshot();
    for (const [name, value, conditional] of [['Loyal', '-1', false], ['physique_good_1', '1', false], ['Characters', '1', false], ['Brave', '1', true]] as const) {
        const item = fact('trait_valuation', 'valuation_' + name);
        item.name = name;
        const effect = { key: 'monthly_prestige', label: 'public esteem', value };
        item.rules = JSON.stringify({ effects: conditional ? [{ condition: 'limit', rules: [effect] }] : [effect] });
        data.facts.push(item);
    }
    const readings = passagePlan('culture', data).passages.filter(p => p.kind === 'social esteem');
    expect(readings.map(p => p.text)).toEqual(['Loyal carries less public esteem.']);
    expect(readings[0].text).not.toMatch(/disloyal|sin|guilt/iu);
});

test.each([
    ['A Court is all about attracting cultivated minds and people of exceptional skill.', 'cultivated minds'],
    ['Only an efficient and well-maintained court will make our realm prosper.', 'administration'],
    ['A show of force is the only way to command awe and respect! Our knights and soldiers are famous for their prowess.', 'martial prowess'],
    ['Diplomacy is key to garnering the respect of our peers and keeping the realm at peace. A pleased vassal is a loyal vassal.', 'contented vassals'],
    ['To leave the people at court unchecked is dangerous, and we must ensure that no one can be up to no good without us knowing.', 'vigilance']
])('court-derived esteem describes the wider culture without assigning a present venue: %s', (description, value) => {
    const data = snapshot(), item = fact('court_ideal', 'unfamiliar_mod_court');
    item.description = description + ' Courtiers gain the scholarly court 1 traits.';
    data.facts.push(item);
    const court = passagePlan('culture', data).passages.find(p => p.source === cultureSourceId(item))!;
    expect(court.text).toContain('This culture');
    expect(court.text).toContain(value);
    expect(court.text).not.toMatch(/\bcourt\b|courtiers|must obey|all people/iu);
    const result = validateCultureResult({ selections: [court.id] }, cultureInput(data, 'en'));
    expect(result.paragraph).toContain(court.text);
    expect(result.notes.some(n => n.sources.includes(cultureSourceId(item)))).toBe(true);
});

test('changed court meanings come from current prose rather than the familiar court key', () => {
    const data = snapshot(), item = fact('court_ideal', 'court_scholarly');
    item.description = 'This court reveres careful recordkeeping during times of peace.';
    data.facts.push(item);
    const court = passagePlan('culture', data).passages.find(p => p.source === cultureSourceId(item))!;
    expect(court.text).toBe('This culture reveres careful recordkeeping during times of peace.');
    expect(court.text).not.toContain('cultivated minds');
    expect(culturalCourtCue('This court values [GetUnresolved]')).toBeUndefined();
    expect(culturalCourtCue('This court values monthly prestige modifiers of 20%')).toBeUndefined();
});

test('required court choice is separate from complementary customs in the actual generator contract', () => {
    const data = familySnapshot(), court = fact('court_ideal', 'unfamiliar_mod_court');
    court.description = 'This court esteems careful scholarship.';
    data.facts.push(court);
    const evidence = extractionEvidence('culture', data);
    expect(evidence.courtIdeals).toHaveLength(1);
    expect(evidence.candidates.some(p => p.kind === 'associated court ideal')).toBe(false);
    const schema = (extractionFormat('culture', data) as any).json_schema.schema;
    expect(schema.required).toEqual(['court', 'selections']);
    expect(schema.properties.court.enum).toEqual([evidence.courtIdeals![0].id]);
    expect(schema.properties.selections.items.enum).not.toContain(evidence.courtIdeals![0].id);
    const custom = evidence.candidates.find(p => p.kind === 'social custom')!;
    const selected = { court: evidence.courtIdeals![0].id, selections: [custom.id] };
    const result = renderExtraction('culture', data, selected);
    expect(result.paragraph).toContain('This culture esteems careful scholarship.');
    expect(result.paragraph).toContain('granting titles');
    expect(renderExtraction('culture', data, { notes: result.notes })).toEqual(result);
    expect(renderExtraction('culture', data, { selections: [selected.court, custom.id] })).toEqual(result);
    expect(() => renderExtraction('culture', data, { selections: [custom.id] })).toThrow('Missing associated court');
    expect(() => renderExtraction('culture', data, { court: custom.id, selections: [] })).toThrow('Invalid court');
    expect(() => renderExtraction('culture', data, { court: selected.court, selections: [selected.court] })).toThrow('Invalid passage');
});

test('sparse cultural evidence never gets an invented court-choice field', () => {
    const data = snapshot();
    expect(extractionEvidence('culture', data).courtIdeals).toBeUndefined();
    const schema = (extractionFormat('culture', data) as any).json_schema.schema;
    expect(schema.required).toEqual(['selections']);
    expect(schema.properties.court).toBeUndefined();
    expect(() => validateCultureResult({ court: 'none', selections: [] }, cultureInput(data, 'en'))).toThrow('Invalid court');
});

test('separate court accepts five ranked custom candidates while rendering at most two', () => {
    const data = snapshot(), court = fact('court_ideal', 'current_court');
    court.description = 'This court values good craftsmanship.';
    data.facts.push(court);
    for (const [index, description] of [
        'Neighbors esteem careful lending.', 'Neighbors esteem shelter for travelers.',
        'Neighbors esteem well-kept promises.', 'Neighbors esteem care for elders.', 'Neighbors esteem patient craft.'
    ].entries()) {
        const item = fact('tradition', 'current_custom_' + index); item.description = description;
        data.facts.push(item);
    }
    const evidence = extractionEvidence('culture', data), customs = evidence.candidates.filter(p => p.text.startsWith('Neighbors esteem'));
    expect(customs).toHaveLength(5);
    const result = renderExtraction('culture', data, { court: evidence.courtIdeals![0].id, selections: customs.map(p => p.id) });
    expect(result.notes.filter(n => n.text.startsWith('Neighbors esteem'))).toHaveLength(2);
    expect(result.paragraph).toContain('good craftsmanship');
});
