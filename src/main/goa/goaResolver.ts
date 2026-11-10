import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { GoaSnapshot, validateGoaSnapshot } from '../../shared/gameData/GoaSnapshot';
import { GoaCatalogue, goaCatalogue, GOA_CATALOGUE_HASH, GOA_RESOLVER_VERSION } from './goaCatalogue';
import { GoaEncounter, GoaRuleContext } from './goaRuleContext';
import { GOA_RULES } from './goaRules';

const templateBytes = fs.readFileSync(path.resolve(__dirname, '../../../public/goaLore/templates.json'));
const compositionBytes = fs.readFileSync(path.resolve(__dirname, '../../../public/goaLore/compositions.json'));
export const GOA_TEMPLATE_HASH = createHash('sha256').update(templateBytes).update(compositionBytes).digest('hex');
type Variants = Record<'male' | 'female' | 'neutral' | 'named', string>;
const templates = JSON.parse(templateBytes.toString('utf8')) as Record<string, Variants & { observer?: Variants }>;
const compositions = (JSON.parse(compositionBytes.toString('utf8')) as {
    schemaVersion: 1; compositions: { key: string; keys: string[]; variants: Variants }[];
}).compositions;
const mindRuleKeys = new Set(['race_gnome_ingenuity', 'race_leper_gnome', 'bronze_temporal', 'infinite_temporal']);
const mindKinds = new Set(['drive', 'heritage', 'retained_background', 'background', 'learned_knowledge', 'racial_context', 'lore', 'cognition', 'conditional_pressure']);
export type GoaPurpose = 'roleplay' | 'observer' | 'action';
export interface GoaPacket {
    text: string; hash: string; selectedKeys: string[]; dormantKeys: string[]; body?: string; pronouns: string;
    purpose: GoaPurpose; identityPolicy: 'ordinary' | 'fallen_controller'; identityInstruction?: string; exampleInstruction?: string; compositionKeys: string[];
}
function join(values: string[]): string { return values.length < 2 ? values[0] ?? '' : values.slice(0, -1).join(', ') + ' and ' + values[values.length - 1]; }
function valuesFor(key: string, c: GoaRuleContext): Record<string, string> {
    const values: Record<string, string> = { ancestry_names: join(c.ancestry), controller_name: c.text('controller_name') ?? '',
        binding_limits: c.text('binding_limits') ?? '', resolved_magic_aptitudes: c.text('resolved_magic_aptitudes') ?? '',
        resolved_magic_defences: c.magicDefences ?? '' };
    if (key.startsWith('practice_')) {
        const school = key === 'practice_life_corrupted' ? 'life' : key.slice('practice_'.length);
        values.rank = goaCatalogue.rank_labels[String(c.rank(school + '_magic'))] ?? '';
    }
    if (key.startsWith('elemental_')) {
        const method = key === 'elemental_spirit' ? '_spirit' : key === 'elemental_decay' ? '_decay' : '';
        const elements = ['fire', 'water', 'air', 'earth'].map(element => ({ element, rank: c.rank(`elemental_${element}${method}_magic`) })).filter(e => e.rank);
        values.ranked_elements = join(elements.map(e => `${goaCatalogue.rank_labels[String(e.rank)]} ${e.element}`));
        values.elemental_powers = join(elements.map(e => goaCatalogue.element_capability_glosses[e.element[0].toUpperCase() + e.element.slice(1)]));
    }
    return values;
}
export function validateGoaCatalogue(catalogue: GoaCatalogue = goaCatalogue): void {
    const keys = new Set(catalogue.entries.map(e => e.key));
    if (keys.size !== catalogue.entries.length || Object.keys(GOA_RULES).length !== keys.size || Object.keys(templates).length !== keys.size)
        throw new Error('Incomplete GoA rule/template coverage.');
    for (const e of catalogue.entries) {
        if (!GOA_RULES[e.key] || !templates[e.key]) throw new Error('Missing GoA predicate/template: ' + e.key);
        for (const k of [...(e.suppress_if_selected ?? []), ...(e.replaces ?? [])]) if (!keys.has(k)) throw new Error('Invalid GoA replacement: ' + k);
        for (const variant of ['male', 'female', 'neutral', 'named'] as const) if (!templates[e.key][variant]) throw new Error('Missing GoA subject variant.');
    }
    for (const row of [...catalogue.coverage, ...catalogue.core_coverage]) for (const key of row.entry_keys) if (!keys.has(key))
        throw new Error('Invalid GoA coverage reference: ' + key);
    const combinationKeys = new Set<string>();
    for (const composition of compositions) {
        if (combinationKeys.has(composition.key) || composition.keys.length < 2 || new Set(composition.keys).size !== composition.keys.length ||
            composition.keys.some(key => !keys.has(key))) throw new Error('Invalid GoA composition: ' + composition.key);
        combinationKeys.add(composition.key);
        for (const variant of ['male', 'female', 'neutral', 'named'] as const)
            if (!composition.variants[variant]) throw new Error('Missing GoA composition variant.');
    }
}
validateGoaCatalogue();

/** Pure deterministic selection. The caller qualifies pack/capture provenance, never the model. */
export function resolveGoaLore(name: string, rawSnapshot: GoaSnapshot, encounter: GoaEncounter = {}, purposeOrObserver: GoaPurpose | boolean = 'roleplay'): GoaPacket {
    const purpose: GoaPurpose = typeof purposeOrObserver === 'boolean' ? (purposeOrObserver ? 'observer' : 'roleplay') : purposeOrObserver;
    const observer = purpose === 'observer';
    const snapshot = validateGoaSnapshot(rawSnapshot);
    const c = new GoaRuleContext(snapshot, encounter);
    // An explicitly sexless current body is a narrow adapter exception. A shapeless Void-energy
    // body is authored as such; this does not classify all demons, elementals, constructs or undead.
    const neutral = c.sexlessBody;
    const variant = neutral ? 'neutral' : snapshot.sex ?? 'named';
    const selected = goaCatalogue.entries.filter(e => {
        if (!GOA_RULES[e.key](c)) return false;
        if (c.mindReplaced && (mindKinds.has(e.kind) || mindRuleKeys.has(e.key) || e.subject === 'current_controlling_identity') && !c.fact('controller_retains_' + e.key)) return false;
        // Other participants' internal state is never public just because it was exported.
        if (observer && !encounter.knownRuleKeys?.includes(e.key) && !c.fact('public_' + e.key)) return false;
        return true;
    });
    const keys = new Set(selected.map(e => e.key));
    const replaced = new Set(selected.flatMap(e => e.replaces ?? []));
    const applicable = selected.filter(e => !replaced.has(e.key) && !(e.suppress_if_selected ?? []).some(key => keys.has(key)));
    const selectedKeys: string[] = [], paragraphs: string[] = [];
    const renderedKeys: string[] = [];
    for (const e of applicable) {
        const values = { ...valuesFor(e.key, c), name };
        let valid = true;
        const prose = observer && templates[e.key].observer ? templates[e.key].observer![variant] : templates[e.key][variant];
        const rendered = prose.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, key: string) => {
            const value = values[key as keyof typeof values];
            if (!value) valid = false;
            return value ?? '';
        });
        if (valid) {
            selectedKeys.push(e.key);
            if (!paragraphs.includes(rendered)) { paragraphs.push(rendered); renderedKeys.push(e.key); }
        }
    }
    // Exceptional elemental mastery belongs with its actual method, without
    // fabricating a Spirit/Decay rank when the standalone trait is all we know.
    for (const [mastery, school] of [['master_pyromancer', 'fire'], ['master_cryomancer', 'water']]) {
        const source = renderedKeys.indexOf(mastery);
        const target = renderedKeys.findIndex(key => ['elemental_studied', 'elemental_spirit', 'elemental_decay'].includes(key) &&
            c.rank(`elemental_${school}${key === 'elemental_spirit' ? '_spirit' : key === 'elemental_decay' ? '_decay' : ''}_magic`) > 0);
        if (source >= 0 && target >= 0) { paragraphs[target] += ' ' + paragraphs[source]; paragraphs.splice(source, 1); renderedKeys.splice(source, 1); }
    }
    const leper = renderedKeys.indexOf('race_leper_gnome'), radiation = renderedKeys.indexOf('irradiated');
    if (leper >= 0 && radiation >= 0) { paragraphs[radiation] += ' ' + paragraphs[leper]; paragraphs.splice(leper, 1); renderedKeys.splice(leper, 1); }
    // Only authored complete combinations replace prose; rule diagnostics remain intact.
    // Observer knowledge must qualify every contributing card independently.
    const compositionKeys: string[] = [];
    for (const composition of compositions) {
        const indices = composition.keys.map(key => renderedKeys.indexOf(key));
        if (indices.some(index => index < 0)) continue;
        const values: Record<string, string> = Object.assign({ name }, ...composition.keys.map(key => valuesFor(key, c)));
        let complete = true;
        const rendered = composition.variants[variant].replace(/\{([A-Za-z0-9_]+)\}/g, (_m, key: string) => {
            if (!values[key]) complete = false;
            return values[key] ?? '';
        });
        if (!complete) continue;
        const first = Math.min(...indices);
        for (const index of [...indices].sort((a, b) => b - a)) { paragraphs.splice(index, 1); renderedKeys.splice(index, 1); }
        paragraphs.splice(first, 0, rendered); renderedKeys.splice(first, 0, '@' + composition.key);
        compositionKeys.push(composition.key);
    }
    const pronouns = neutral ? 'they/them' : snapshot.sex === 'female' ? 'she/her' : snapshot.sex === 'male' ? 'he/him' : 'name only';
    const instruction = purpose === 'observer' ? 'Describe only established knowledge. Private experience and intentions are not visible facts.' :
        purpose === 'action' ? 'Use these facts to interpret actions expressed in the dialogue. Capabilities, urges and private intentions alone do not establish that an action occurred.' :
        'Express these facts through attention, voice and choices at their stated intensity. Let personality shape the expression and cost of an impulse without erasing a strong appetite. Keep ordinary conversation natural rather than reciting traits. Draw personal memories, expertise and belongings from the established character and scene. Bodily limits and established control changes remain real. Private knowledge stays private.';
    const identityPolicy = !observer && c.has('fallen_demon_hunter') ? 'fallen_controller' : 'ordinary';
    const exampleInstruction = identityPolicy === 'fallen_controller' && purpose === 'roleplay' ?
        `These examples portray ${name} before the takeover. Their moral claims belong to the captive hunter; formatting may be reused, but they do not define the acting demon’s conscience, loyalties or intentions.` : undefined;
    const identityInstruction = identityPolicy !== 'fallen_controller' ? undefined : purpose === 'action' ?
        `Acting identity for ${name}: The acting character is the controlling demon; the hunter is a conscious captive with no independent control. ` +
        'The hunter’s former traits and attachments do not establish the controller’s actions. Identify only actions supported by the exchange; private motives alone do not prove an action occurred.' :
        `Acting identity for ${name}: Inhabit the controlling demon, with the hunter a conscious captive. ` +
        'Read the hunter’s listed moral traits, personality tendencies, descriptions and memories as the defeated host’s record, not the demon’s ethics or loyalties. ' +
        'Its motive is to make that captive suffer through established attachments and ideals. Apparent kindness can gain access or leverage for betrayal; the hunter’s affection is not a reason for the demon’s mercy. ' +
        'Faithfully preserving the hunter’s old vows or loved ones is not itself this torment: intended harm, corruption or betrayal must give any apparent care its purpose. ' +
        'Choose intentions that serve this personal torment, using only established people, rivalries and ideals. Do not invent a former life. Continue the demon’s own subsequent choices and alliances rather than reversing them. ' +
        'The captive has no independent control; speak and act as the demon alone.';
    // Normal identity and anatomy live in their selected prose, without a repeated
    // body/pronoun announcement. Rare unresolved or explicit sexless adapters
    // still need one factual clarification alongside the applicable clauses.
    const clarification = observer ? '' : !c.body && c.transformed ? 'An active transformation is recorded, but its shape is uncertain.' :
        neutral && c.body !== 'creature_voidwalker' ? 'Their present embodiment is sexless.' : '';
    const text = paragraphs.length ? `Warcraft context for ${name}${observer ? ' (established observer knowledge)' : ''}:\n${clarification}${clarification ? '\n\n' : ''}${paragraphs.join('\n\n')}\n\n${instruction}` : '';
    const hash = createHash('sha256').update(JSON.stringify({ catalogue: GOA_CATALOGUE_HASH, templates: GOA_TEMPLATE_HASH, version: GOA_RESOLVER_VERSION,
        name, snapshot, encounter, selectedKeys, purpose })).digest('hex');
    const dormantKeys = goaCatalogue.entries.filter(e => (e.requires_fields?.length || e.ids.length === 0) && !keys.has(e.key) &&
        (e.ids.length === 0 || e.ids.some(id => c.has(id)))).map(e => e.key);
    return { text, hash, selectedKeys, dormantKeys, body: c.body, pronouns, purpose, identityPolicy, identityInstruction, exampleInstruction, compositionKeys };
}
