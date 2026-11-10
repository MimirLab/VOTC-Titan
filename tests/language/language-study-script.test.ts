import { languageStudyEffects, languageStudyOnActions, studyVariable } from '../../src/main/language/languageStudyScript';
import { parseCk3Script, ScriptEntry } from '../../src/main/culture/ck3Script';

// Execute the generated remember-effect's small Clausewitz subset independently of its authoring code.
// This checks saved-state transitions; actual CK3 dispatch/scopes still need engine acceptance.
const effects = parseCk3Script(languageStudyEffects(['language_common', 'language_orcish', 'language_darnassian']));
const remember = effects.find(entry => entry.key === 'votc_titan_remember_language_study_effect')!.value as ScriptEntry[];
const actions = parseCk3Script(languageStudyOnActions());
type Actor = { ai: boolean; variables: Record<string, number> };
function run(actor: Actor, language: string, progress: number, entries = remember) {
    const resolve = (value: string) => value === '$PROGRESS$' ? progress : value.startsWith('var:')
        ? actor.variables[value.slice(4)] : Number(value);
    const condition = (entries: ScriptEntry[]): boolean => entries.every(entry => {
        if (entry.key === 'NOT') return !condition(entry.value as ScriptEntry[]);
        if (entry.key === '$TARGET$.culture') return (entry.value as ScriptEntry[]).every(child => child.key === 'has_cultural_pillar' && child.value === language);
        if (entry.key === 'has_variable') return Object.prototype.hasOwnProperty.call(actor.variables, entry.value as string);
        if (entry.key?.startsWith('var:')) {
            const left = resolve(entry.key), right = resolve(entry.value as string);
            if (!Number.isFinite(left)) throw new Error('Unguarded missing variable');
            if (entry.operator === '<') return left < right;
        }
        throw new Error('Unsupported generated condition: ' + entry.key);
    });
    const execute = (entries: ScriptEntry[]) => {
        let previousMatched = false;
        for (const entry of entries) {
            if (entry.key === 'if' || entry.key === 'else_if') {
                const body = entry.value as ScriptEntry[];
                if (entry.key === 'else_if' && previousMatched) continue;
                previousMatched = condition(body.find(child => child.key === 'limit')!.value as ScriptEntry[]);
                if (previousMatched) execute(body.filter(child => child.key !== 'limit'));
            } else if (entry.key === 'set_variable') {
                const body = entry.value as ScriptEntry[];
                const name = body.find(child => child.key === 'name')!.value as string;
                if (!name.startsWith('votc_titan_study_')) throw new Error('Non-study write');
                actor.variables[name] = resolve(body.find(child => child.key === 'value')!.value as string);
            } else throw new Error('Unexpected game mutation: ' + entry.key);
        }
    };
    execute(entries);
}
function complete(actor: Actor, language: string) {
    const relay = actions.find(entry => entry.key === 'votc_titan_study_player_completion')!.value as ScriptEntry[];
    const trigger = relay.find(entry => entry.key === 'trigger')!.value as ScriptEntry[];
    if (trigger.some(entry => entry.key === 'is_ai' && entry.value === 'no') && actor.ai) return;
    const effect = relay.find(entry => entry.key === 'effect')!.value as ScriptEntry[];
    const call = effect.find(entry => entry.key === 'votc_titan_remember_language_study_effect')!.value as ScriptEntry[];
    run(actor, language, Number(call.find(entry => entry.key === 'PROGRESS')!.value));
}

test('generated save writes retain the maximum, never add retries or transfer to unrelated tongues', () => {
    const actor: Actor = { ai: false, variables: {} };
    run(actor, 'language_common', .6); run(actor, 'language_common', .1); run(actor, 'language_common', 0);
    expect(actor.variables).toEqual({ [studyVariable('language_common')]: .6 });
    run(actor, 'language_common', .8); run(actor, 'language_darnassian', .25);
    expect(actor.variables).toEqual({ [studyVariable('language_common')]: .8, [studyVariable('language_darnassian')]: .25 });
    run(actor, 'language_unknown', 1); expect(Object.keys(actor.variables)).toHaveLength(2);
});

test.each(['learn_language_success', 'learn_language_failure'])('%s preserves a completed study interval for the player, without granting game fluency', action => {
    const root = actions.find(entry => entry.key === action)!.value as ScriptEntry[];
    expect((root[0].value as ScriptEntry[])[0].value).toBe('votc_titan_study_player_completion');
    const actor: Actor = { ai: false, variables: {} }; complete(actor, 'language_orcish');
    expect(actor.variables).toEqual({ [studyVariable('language_orcish')]: 1 });
    run(actor, 'language_orcish', .1); expect(actor.variables[studyVariable('language_orcish')]).toBe(1);
});

test('NPCs receive no ongoing/outcome tracking; explicit chat observation can retain a sparse NPC peak', () => {
    const npc: Actor = { ai: true, variables: {} }; complete(npc, 'language_orcish'); expect(npc.variables).toEqual({});
    run(npc, 'language_orcish', .35); run(npc, 'language_orcish', .1);
    expect(npc.variables).toEqual({ [studyVariable('language_orcish')]: .35 });
    const pulse = actions.find(entry => entry.key === 'votc_titan_study_player_pulse')!.value as ScriptEntry[];
    expect(pulse.find(entry => entry.key === 'trigger')!.value).toContainEqual({ key: 'is_ai', operator: '=', value: 'no' });
});

test('independent character save snapshots naturally restore older and separate-campaign peaks', () => {
    const actor: Actor = { ai: false, variables: {} }; run(actor, 'language_common', .2);
    const saved = JSON.stringify(actor); run(actor, 'language_common', .9);
    const restored: Actor = JSON.parse(saved); run(restored, 'language_common', .1);
    expect(restored.variables[studyVariable('language_common')]).toBe(.2);
    expect(actor.variables[studyVariable('language_common')]).toBe(.9);
    const fresh: Actor = { ai: false, variables: {} }; run(fresh, 'language_common', .1);
    expect(fresh.variables[studyVariable('language_common')]).toBe(.1);
});
