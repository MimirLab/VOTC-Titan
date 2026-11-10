import { CultureFact, CultureSnapshot, validateCultureSnapshot } from '../../shared/gameData/CultureSnapshot';
import { CultureCatalog } from './cultureCatalog';
import { ScriptEntry } from './ck3Script';
import { sha256Hex } from '../promptWorkbench/canonicalJson';

interface Effect { key?: string; label?: string; value?: string; condition?: string; operator?: string; rules?: Effect[] }
interface Rules {
    definitions?: ScriptEntry[];
    parameterDescriptions?: Record<string, string>;
    modifierEvidence?: { scope: string; conditions?: ScriptEntry[]; effects: Effect[] }[];
    conditionalDescriptions?: Record<string, string>;
    constants?: Record<string, unknown>;
    referencedMeanings?: Record<string, unknown>;
    effects?: Effect[];
    trait?: string;
}
export function factRules(fact: CultureFact): Rules {
    return fact.rules ? JSON.parse(fact.rules) : {};
}
// Opaque IDs avoid reintroducing excluded religious lore through raw identifiers.
export const cultureSourceId = (fact: CultureFact): string => `${fact.kind}:${sha256Hex(fact.key).slice(0, 24)}`;

/** Innovation parameters are NOT cultural parameters. Boolean cultural triggers use any 'yes'. */
function culturalParameters(facts: CultureFact[]): Set<string> {
    const enabled = new Set<string>();
    for (const f of facts.filter(f => f.kind === 'pillar' || f.kind === 'tradition'))
        for (const block of factRules(f).definitions ?? []) if (block.key === 'parameters' && Array.isArray(block.value))
            for (const p of block.value) if (p.key && p.value === 'yes') enabled.add(p.key);
    return enabled;
}

interface Match { value: boolean | null; positive: boolean }
/** Partial evaluation preserves unknown character conditions and requires an affirmative cultural branch. */
function courtMatch(entries: ScriptEntry[], facts: CultureFact[], enabled: Set<string>, inCulture = false): Match {
    const all = (matches: Match[]): Match => ({
        value: matches.some(m => m.value === false) ? false : matches.every(m => m.value === true) ? true : null,
        positive: !matches.some(m => m.value === false) && matches.some(m => m.positive)
    });
    const any = (matches: Match[]): Match => {
        const trueMatches = matches.filter(m => m.value === true);
        const viable = trueMatches.length ? trueMatches : matches.filter(m => m.value === null);
        return { value: trueMatches.length ? true : viable.length ? null : false, positive: viable.some(m => m.positive) };
    };
    return all(entries.map(e => {
        if (Array.isArray(e.value)) {
            const children = e.value.map(v => courtMatch([v], facts, enabled, inCulture));
            if (e.key === 'AND') return all(children);
            if (e.key === 'OR') return any(children);
            if (['NOT', 'NOR', 'NAND'].includes(e.key ?? '')) {
                const result = e.key === 'NOR' ? any(children) : all(children);
                return { value: result.value === null ? null : !result.value, positive: false };
            }
            if (e.key === 'culture') return courtMatch(e.value, facts, enabled, true);
        } else if (inCulture && ['has_cultural_pillar', 'has_cultural_tradition', 'has_innovation', 'has_cultural_parameter', 'has_innovation_parameter'].includes(e.key ?? '')) {
            let present: boolean;
            if (e.key === 'has_cultural_parameter') present = enabled.has(e.value);
            else if (e.key === 'has_innovation_parameter') present = facts.some(f => f.kind === 'innovation' &&
                factRules(f).definitions?.some(b => b.key === 'parameters' && Array.isArray(b.value) && b.value.some(p => p.key === e.value && p.value === 'yes')));
            else {
                const kind = e.key === 'has_cultural_pillar' ? 'pillar' : e.key === 'has_cultural_tradition' ? 'tradition' : 'innovation';
                present = facts.some(f => f.kind === kind && f.key === e.value);
            }
            if (e.operator && !['=', '!='].includes(e.operator)) return { value: null, positive: false };
            return { value: e.operator === '!=' ? !present : present, positive: e.operator !== '!=' && present };
        }
        return { value: null, positive: false };
    }));
}

/** Seal dependencies once, at capture completion. Normalization and queue claims are catalogue-independent. */
export function sealCultureSnapshot(catalog: CultureCatalog, captured: CultureFact[]): CultureSnapshot {
    const enabled = culturalParameters(captured);
    const courts = catalog.courts.filter(f => {
        const gate = factRules(f).definitions?.find(e => e.key === 'is_valid')?.value;
        if (!Array.isArray(gate)) return false;
        const match = courtMatch(gate, captured, enabled);
        return match.value !== false && match.positive;
    });
    const traits = catalog.traitValuations.filter(f => enabled.has(f.category));
    return validateCultureSnapshot({ version: 2, complete: true, facts: [...captured, ...courts, ...traits] });
}

const socialEffect = (key = '') => /opinion|prestige|stress|legitimacy|renown|dynasty|tyranny/.test(key);
const numeric = /^-?\d+(?:\.\d+)?$/;
function effectsForModel(effects: Effect[], social: boolean): unknown[] {
    return effects.flatMap<unknown>(e => {
        if (e.rules) {
            if (['limit', 'trigger'].includes(e.condition ?? '')) return [{ ...e }];
            const rules = effectsForModel(e.rules, social);
            return rules.length ? [{ condition: e.condition, operator: e.operator, rules }] : [];
        }
        if (socialEffect(e.key) !== social || social && /cost|^ai_|war_chance|cooldown|xp|progress|gain_mult/.test(e.key ?? '')) return [];
        return [social && e.value && numeric.test(e.value)
            ? { affected: e.label ?? e.key, direction: Number(e.value) < 0 ? 'decreased' : Number(e.value) > 0 ? 'increased' : 'unchanged' }
            : { ...e }];
    });
}
function factForModel(fact: CultureFact) {
    const r = factRules(fact);
    const customs: unknown[] = [], options: unknown[] = [];
    for (const block of r.definitions ?? []) if (block.key === 'parameters' && Array.isArray(block.value)) {
        for (const p of block.value) {
            if (!p.key || typeof p.value !== 'string') continue;
            const meaning = r.parameterDescriptions?.[p.key] ?? p.key.replace(/_/g, ' ');
            const kind = /\b(?:prestige|renown|opinion|piety|disinherit|inherit|spouse|consort|marri|revok|crime|punish|valued|looked down|respect)/i.test(meaning)
                && !/cost|bonus|learning|prowess|martial|building|conversion/i.test(meaning) ? 'social_custom'
                : /more common|less common|more likely|less likely|chance/i.test(meaning) ? 'frequency'
                : /bonus|prowess|martial|learning|building|tax|development|cost|inspiration/i.test(meaning) ? 'capability'
                : /^(can|may|gain a decision|unlock)\b/i.test(meaning) ? 'permission'
                : /^(cannot|only|must)\b/i.test(meaning) ? 'restriction' : 'custom';
            const value = p.value === 'yes' ? true : p.value === 'no' ? false : numeric.test(p.value) ? Number(p.value) : p.value;
            const entry = { key: p.key, value, meaning, kind,
                ...(p.value === 'no' ? { interpretation: 'Disabled declaration; does not imply approval of the opposite behavior.' } : {}) };
            (['social_custom', 'restriction', 'custom'].includes(kind) ? customs : options).push(entry);
        }
    }
    const consequenceBlocks = (social: boolean) => (r.modifierEvidence ?? []).map(b => ({
        scope: b.scope, conditions: b.conditions, effects: effectsForModel(b.effects, social)
    })).filter(b => b.effects.length);
    return { source: cultureSourceId(fact), key: fact.key, category: fact.category, name: fact.name, description: fact.description,
        culturalCustoms: customs, socialConsequences: consequenceBlocks(true), availableOptions: options, otherCapabilities: consequenceBlocks(false),
        ...(Object.keys(r.conditionalDescriptions ?? {}).length ? { conditionalDescriptions: r.conditionalDescriptions,
            wordingConditions: r.definitions?.filter(e => ['name', 'desc'].includes(e.key ?? '') && Array.isArray(e.value)) } : {}),
        ...(Object.keys(r.constants ?? {}).length ? { constants: r.constants } : {}),
        ...(Object.keys(r.referencedMeanings ?? {}).length ? { referencedMeanings: r.referencedMeanings } : {}) };
}

/** Change readable currency wording only; preserve identifiers, values and the complete hash input. */
function socialWording(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(socialWording);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, value]) => [key,
        ['description', 'meaning', 'affected', 'interpretation', 'scope'].includes(key) && typeof value === 'string'
            ? value.replace(/\b(?:monthly\s+)?dynasty prestige\b/gi, 'family renown')
                .replace(/\b(?:monthly\s+)?prestige\b/gi, 'public esteem').replace(/\b(?:monthly\s+)?piety\b/gi, 'religious standing')
            : socialWording(value)]));
    return node;
}

export function projectCultureEvidence(snapshot: CultureSnapshot): unknown {
    const facts = snapshot.facts;
    const primary = facts.filter(f => f.kind === 'pillar' || f.kind === 'tradition');
    return excludeReligiousSteering(socialWording({
        adoptedPillarsAndTraditions: primary.filter(f => !['heritage', 'language', 'head_determination'].includes(f.category))
            .map(factForModel).map(({ availableOptions, otherCapabilities, ...f }) => f),
        socialTraitConsequences: facts.filter(f => f.kind === 'trait_valuation').map(f => ({
            source: cultureSourceId(f), trait: factRules(f).trait, name: f.name, parameter: f.category,
            effects: effectsForModel(factRules(f).effects ?? [], true), scope: f.description
        })).filter(f => f.effects.length),
        courtIdeals: facts.filter(f => f.kind === 'court_ideal').map(f => ({ source: cultureSourceId(f), key: f.key, name: f.name, description: f.description,
            scope: 'Social ideals associated through cultural prerequisites; court-owner eligibility and actual choices are separate.',
            conditions: factRules(f).definitions?.filter(e => e.key === 'is_valid') })),
        supportingContext: {
            culturalAffiliations: primary.filter(f => ['heritage', 'language'].includes(f.category)).map(factForModel),
            culturalRepresentation: primary.filter(f => f.category === 'head_determination').map(f => ({ ...factForModel(f),
                scope: 'Selection of the culture representative only; does not determine realm rule, inheritance or leadership generally.' })),
            culturalOptions: primary.map(factForModel).map(f => ({ source: f.source, options: f.availableOptions, capabilities: f.otherCapabilities })),
            optionsScope: 'Effects and permissions describe possibilities, not obligations, approval or present institutions. Parameter values are declarations, not an assumed combined total. Cultural spouse/consort limits concern rulers; non-rulers are restricted to one spouse and no consorts. Retain tier conditions.',
            naming: facts.filter(f => f.kind === 'naming').map(f => ({ source: cultureSourceId(f), key: f.key, name: f.name, conventions: factRules(f).definitions ?? [], description: f.description })),
            aesthetics: facts.filter(f => f.kind === 'aesthetic').map(f => ({ source: cultureSourceId(f), category: f.category, name: f.name })),
            eras: facts.filter(f => f.kind === 'era').map(f => ({ source: cultureSourceId(f), name: f.name, description: f.description })),
            availableKnowledge: facts.filter(f => f.kind === 'innovation').map(f => ({ source: cultureSourceId(f), key: f.key, availableCapability: f.name,
                description: f.description, rules: factRules(f).definitions,
                referencedMeanings: Object.fromEntries(Object.entries(factRules(f).referencedMeanings ?? {}).map(([key, value]) => [key,
                    typeof value === 'object' && value ? { name: (value as any).name, description: (value as any).description } : value])) })),
            knowledgeScope: 'Available capabilities only, not established social norms, current institutions, enacted laws or personal equipment. These may enrich an already-established cultural theme.'
        }
    }));
}

/** The user excludes religious steering even where a cultural definition contains it.
 * Complete definitions remain in identity/provenance; only secular evidence reaches generation.
 * Conservatively omit mixed descriptive strings instead of asking the model to untangle them.
 */
const religiousWording = /\b(?:faiths?|religio\w*|piety|doctrines?|clerg\w*|priests?|priesthood|theolog\w*|mystic\w*|spiritual\w*|holy|holiness|worship\w*|deit\w*|gods?|godly|devout|devotion|virtues?|sins?|sinful|sinners?|monastic\w*|monaster\w*|monks?|nuns?|pilgrim\w*|temples?|shrines?|shaman\w*|saints?|sacred|divine|heathen\w*|infidel\w*|conversion|convert\w*|excommunicat\w*)\b/i;
export function containsReligiousSteering(value: string): boolean {
    // Cultural conversion is its own cultural process; it must not be mistaken for faith conversion.
    return religiousWording.test(value.replace(/_/g, ' ').replace(/\b(?:cultural|culture)\s+(?:conversion|convert\w*)\b/gi, ''));
}
function religious(value: unknown): boolean {
    return typeof value === 'string' && containsReligiousSteering(value);
}
function excludeReligiousSteering(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(excludeReligiousSteering).filter(v => v !== undefined);
    if (!node || typeof node !== 'object') return node;
    const data = node as Record<string, unknown>;
    if (religious(data.affected) || religious(data.label) || religious(data.trait) || religious(data.parameter) ||
        ('value' in data && (religious(data.key) || religious(data.meaning) || religious(data.value))) ||
        religious(data.condition) || religious(data.scope)) return undefined;
    return Object.fromEntries(Object.entries(data).flatMap(([key, value]) => {
        if (key === 'source') return [[key, value]];
        if (religious(key) || typeof value === 'string' && religious(value)) return [];
        const filtered = excludeReligiousSteering(value);
        return filtered === undefined ? [] : [[key, filtered]];
    }));
}
/** Only evidence actually supplied to the model may be cited. */
export function cultureEvidenceSourceIds(snapshot: CultureSnapshot): string[] {
    const ids = new Set<string>();
    const visit = (node: unknown): void => {
        if (Array.isArray(node)) node.forEach(visit);
        else if (node && typeof node === 'object') for (const [key, value] of Object.entries(node)) {
            if (key === 'source' && typeof value === 'string') ids.add(value);
            else visit(value);
        }
    };
    visit(projectCultureEvidence(snapshot));
    return [...ids].sort();
}
