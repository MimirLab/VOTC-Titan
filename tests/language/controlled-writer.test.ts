import path from 'path';
import { CONTROLLED_WRITER_INSTRUCTION, controlledTraitExamples, repairControlledPrivateClauses, validateControlledSourceSpeech, validateControlledSpeechLabels } from '../../src/main/language/controlledWriter';
import { parseControlledProse, controlledProseView } from '../../src/shared/language/controlledProse';
import { GameData } from '../../src/shared/gameData/GameData';
import { character } from '../culture/fixtures';

test('the actual stock trait examples adopt the exact controls without dropping authored personality prose', () => {
    const game = new GameData(['1', 'Player', '2', 'Speaker', '1066.9.15', 'court', 'County', 'Player', '0']);
    const player = character(1, 'Player'), owner = character(2, 'Speaker');
    owner.traits = ['Ambitious', 'Generous', 'Deceitful'].map(name => ({ name, category: 'personality', desc: name }));
    game.characters.set(1, player); game.characters.set(2, owner);
    const script = require(path.resolve('default_userdata/scripts/prompts/example messages/standard/aliChat.js'));
    const original = script(game), before = JSON.stringify(original), typed = controlledTraitExamples(original);
    for (const [index, message] of typed.filter((m: any) => m.role === 'assistant').entries()) {
        const parsed = parseControlledProse(message.content), view = controlledProseView(parsed, true);
        expect(view.content).toContain(owner.traits[index].name);
        const tail = original.filter((m: any) => m.role === 'assistant')[index].content.split(owner.traits[index].name + ', ')[1];
        expect(view.content).toContain(tail);
    }
    expect(JSON.stringify(original)).toBe(before);
    expect(typed.filter((m: any) => m.role === 'user')).toEqual(original.filter((m: any) => m.role === 'user'));
});
test('unrecognised custom examples retain their original authored content', () => {
    const custom = [{ role: 'assistant' as const, name: 'Speaker', content: '*I wait.* "We have time."' }];
    expect(controlledTraitExamples(custom)).toBe(custom);
});

test('the formatting cue supplies no plot objects from the witnessed example-contamination reply', () => {
    expect(CONTROLLED_WRITER_INSTRUCTION).not.toMatch(/forged seal|astrolabe|hidden token|greeting sounds warmer/);
    expect(CONTROLLED_WRITER_INSTRUCTION).not.toContain('Go on');
    expect(CONTROLLED_WRITER_INSTRUCTION).toContain('full literary prose, emotional depth and natural paragraph flow');
    expect(CONTROLLED_WRITER_INSTRUCTION).toContain('concealed details');
});
test('the witnessed mixed gesture and concealed-object clauses keep visible movement while protecting the private explanation', () => {
    const raw = '**She reaches up, her fingers brushing the blue astrolabe at her throat, feeling the hard outline of the opal token hidden beneath.**\n\n**Beneath the hem of her coat, the forged wax seal presses against her instep,** ""Welcome.""';
    const repaired = repairControlledPrivateClauses(raw), parsed = parseControlledProse(repaired);
    const full = controlledProseView(parsed, true), publicOnly = controlledProseView(parsed, false);
    expect(publicOnly.content).toContain('fingers brushing the blue astrolabe');
    expect(publicOnly.content).not.toMatch(/opal|forged wax seal|instep/);
    expect(full.content).toContain('opal token hidden beneath'); expect(full.content).toContain('forged wax seal');
    expect(full.content).toContain('\n\n');
    expect(full.content.replace(/\*/g, '')).toBe(controlledProseView(parseControlledProse(raw), true).content.replace(/\*/g, ''));
});
test('the narrow guard leaves deliberate speech and explicit physical disclosures available to others', () => {
    const raw = '**She reveals the hidden opal from her coat.** ""I forged that seal.""';
    expect(repairControlledPrivateClauses(raw)).toBe(raw);
    expect(repairControlledPrivateClauses('**She rests her hand on the forged iron railing.**')).toBe('**She rests her hand on the forged iron railing.**');
});
test('an already-visible hidden venue stays public while a concealed object before a feeling clause stays private', () => {
    const venue = '**She kneels beside the spring in the hidden shrine.**';
    expect(repairControlledPrivateClauses(venue)).toBe(venue);
    const object = repairControlledPrivateClauses('**She fingers the hidden opal, feeling its coolness.**');
    expect(controlledProseView(parseControlledProse(object), false).content).not.toContain('opal');
    expect(controlledProseView(parseControlledProse(object), true).content).toContain('She fingers the hidden opal');
});

test('the witnessed all-syllable speech triggers bounded recovery without rejecting names, short utterances or English commands', () => {
    const copied = '**She nods.** ""Grog maen durkhaal,"" **she says.** ""Thok grog maen veil dur,"" ""Maen grokha rir thok dur.""';
    expect(() => validateControlledSourceSpeech(copied)).toThrow('source-English');
    expect(() => validateControlledSourceSpeech('""Wait. Listen. Leave. Return. Drink. Rest. Eat. Sleep. Walk. Ride. Remember. Stop.""')).not.toThrow();
    expect(() => validateControlledSourceSpeech('""Lok’tar ogar!""')).not.toThrow();
    expect(() => validateControlledSourceSpeech('""Azshara Elune Eluneth Vashj Tyrande Illidan Malfurion Jaina Thrall Grom Durotan Medivh.""')).not.toThrow();
    expect(() => validateControlledSourceSpeech(copied, 'fr')).not.toThrow();
});

test('a mixed reply cannot disguise its copied foreign utterance with a later English speech span', () => {
    const mixed = '""Fe staelei dela lereid maerfar revo disgi ras braret feima nabit."" **She nods.** ""A quiet room and a clear table await us.""';
    expect(() => validateControlledSourceSpeech(mixed)).toThrow('source-English');
});

test('a visible touch remains public while its tucked-object and pressure explanation becomes unspoken', () => {
    const raw = '**Her fingers brush the blue astrolabe resting against her chest, a habitual motion that presses the opal token tucked beneath it a little firmer against her skin.**';
    const parsed = parseControlledProse(repairControlledPrivateClauses(raw));
    expect(controlledProseView(parsed, false).content).toContain('fingers brush the blue astrolabe');
    expect(controlledProseView(parsed, false).content).not.toMatch(/opal|token|presses|skin/);
    expect(controlledProseView(parsed, true).content).toContain('opal token tucked beneath');
    const hair = '**She tilts her head, a curl tucked behind her ear.**';
    expect(repairControlledPrivateClauses(hair)).toBe(hair);
});

test.each([
    '**"Eight silver coins," she says, testing the offer.**',
    "**She asks, 'Will you bring the wagon?'**",
    '**Eight silver coins, she repeats, testing the words as if they were a promise to be weighed.**'
])('explicit attributed words in actions trigger recovery: %s', source => {
    expect(() => validateControlledSpeechLabels(source)).toThrow('spoken words');
});

test.each([
    '**She says nothing and raises a hand.**',
    '**I will bring the wagon to the gate.**',
    '**She repeats the movement, then examines the written words.**',
    "**She points at the chalked 'Welcome' on the gate.**",
    '**She shapes a reply but stays silent.** ~~I could tell him everything.~~',
    '**Her voice turns low.** ""Eight silver coins,"" **she says.**',
    "~~She remembers hearing 'Leave,' he said.~~"
])('legitimate narration, silence and properly separated speech remain valid: %s', source => {
    expect(() => validateControlledSpeechLabels(source)).not.toThrow();
});
