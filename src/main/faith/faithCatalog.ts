import { FaithFact } from '../../shared/gameData/FaithSnapshot';
import { loadActiveCultureFiles, localizations } from '../culture/cultureCatalog';
import { parseCk3Script, ScriptEntry, scriptString, scriptStrings } from '../culture/ck3Script';
import { canonicalJsonStringify, logicalRequestHash } from '../promptWorkbench/canonicalJson';
import { staticLocalizationText } from '../culture/staticLocalization';

export interface FaithReligion { key: string; family: string; description: string; fact: FaithFact; worship: Record<string, string[][]> }
export interface FaithHolySite { key: string; county: string; barony?: string; fact: FaithFact }
/** Templates support source-backed tests only; live capture never selects a faith by its name/template. */
export interface FaithTemplate { key: string; religion: string; doctrines: string[]; holySites: string[]; description: string; worship: Record<string, string[]> }
export interface FaithCatalog {
    version: 1; digest: string;
    religions: FaithReligion[]; families: FaithFact[]; doctrines: FaithFact[]; traits: FaithFact[];
    holySites: FaithHolySite[]; worshipKeys: string[]; templates: FaithTemplate[];
}
const safeKey = /^[A-Za-z0-9_.-]+$/;
const directories = ['common/religion', 'common/traits', 'common/script_values', 'localization/english'];
const children = (entries: ScriptEntry[], key: string): ScriptEntry[] => entries.filter(e => e.key === key)
    .flatMap(e => Array.isArray(e.value) ? e.value : []);
const clean = (text: string): string => text.replace(/#(?:[A-Za-z_][A-Za-z_0-9]*|!)\s?/g, '')
    .replace(/@[^!\s]+!/g, '').replace(/\s+/gu, ' ').trim();

export function faithCatalogFromFiles(files: Map<string, string>): FaithCatalog {
    const loc = localizations(files);
    const expand = (key: string, depth = 0): string => {
        const text = loc.get(key) ?? key;
        return depth > 8 ? text : text.replace(/\$([^$|]+)(?:\|[^$]+)?\$/g, (_m, child) => expand(child, depth + 1));
    };
    const label = (key: string, depth = 0): string => clean(expand(key).replace(/\[([^\[\]]+)\]/g, (_m, expression: string) => {
        const staticText = staticLocalizationText(expression);
        if (staticText !== undefined) return staticText;
        const literal = /Get(?:Trait|ReligionByKey|ReligionFamily)\(\s*'([^']+)'/.exec(expression);
        if (literal && depth < 8) {
            const child = expression.includes('GetDesc') ? literal[1] + '_desc' : literal[1];
            return label(child, depth + 1);
        }
        if (/^[\w -]+\|[A-Za-z]+$/.test(expression)) return expression.split('|')[0].replace(/_/g, ' ');
        return '(context-dependent wording)';
    }));
    const raw = new Map<string, ScriptEntry[]>();
    const constants = new Map<string, string | ScriptEntry[]>();
    for (const file of [...files.keys()].filter(f => f.startsWith('common/')).sort()) {
        const entries = parseCk3Script(files.get(file)!);
        const variables = new Map(entries.filter(e => e.key?.startsWith('@') && typeof e.value === 'string')
            .map(e => [e.key!, e.value as string]));
        const substitute = (values: ScriptEntry[]): void => {
            for (const e of values) {
                if (Array.isArray(e.value)) substitute(e.value);
                else if (variables.has(e.value)) e.value = variables.get(e.value)!;
            }
        };
        substitute(entries);
        const group = file.startsWith('common/religion/') ? file.split('/')[2] : file.split('/')[1];
        for (const e of entries) {
            if (!e.key || e.key.startsWith('@')) continue;
            if (group === 'script_values') constants.set(e.key, e.value);
            else if (Array.isArray(e.value)) {
                if (!safeKey.test(e.key)) throw new Error('Unsafe religious definition key');
                raw.set(group + ':' + e.key, e.value);
            }
        }
    }
    const evidence = (values: ScriptEntry[]): string => {
        const meanings: Record<string, string> = {};
        const references = new Set<string>();
        const visit = (entries: ScriptEntry[]): void => {
            for (const e of entries) {
                if (e.key) {
                    for (const prefix of ['doctrine_parameter_', 'holy_site_parameter_', 'MOD_']) {
                        const k = prefix + (prefix === 'MOD_' ? e.key.toUpperCase() : e.key);
                        if (loc.has(k)) meanings[k] = label(k);
                    }
                    if (e.value === 'no' && loc.has('doctrine_parameter_' + e.key + '_disabled'))
                        meanings['doctrine_parameter_' + e.key + '_disabled'] = label('doctrine_parameter_' + e.key + '_disabled');
                    if (typeof e.value === 'string' && loc.has('doctrine_parameter_' + e.key + '_' + e.value))
                        meanings['doctrine_parameter_' + e.key + '_' + e.value] = label('doctrine_parameter_' + e.key + '_' + e.value);
                }
                if (Array.isArray(e.value)) visit(e.value);
                else {
                    if (loc.has(e.value)) meanings[e.value] = label(e.value);
                    // Generic doctrine options (e.g. "Accepted") need their actual
                    // UI subject. Keep it in captured/hashable evidence, rather than
                    // consulting a different installed catalog during generation.
                    if (e.key === 'doctrine_group') {
                        for (const suffix of ['_name', '_desc'])
                            if (loc.has(e.value + suffix)) meanings[e.value + suffix] = label(e.value + suffix);
                    }
                    if (constants.has(e.value) && !references.has(e.value)) {
                        references.add(e.value);
                        const v = constants.get(e.value)!;
                        visit(Array.isArray(v) ? v : [{ value: v }]);
                    }
                }
            }
        };
        visit(values);
        return canonicalJsonStringify({ definitions: values, meanings,
            constants: Object.fromEntries([...references].sort().map(k => [k, constants.get(k)])),
            interpretation: 'Conditions and scope remain binding. Parameter existence can matter even when its value is no. Source defaults do not override observed current membership.' });
    };
    const fact = (kind: FaithFact['kind'], key: string, entries: ScriptEntry[], name = key, description = key + '_desc'): FaithFact => ({
        kind, key, name: label(loc.has(name) ? name : loc.has(key + '_name') ? key + '_name' : key),
        description: loc.has(description) ? label(description) : '', rules: evidence(entries)
    });
    const content: Omit<FaithCatalog, 'digest'> = {
        version: 1, religions: [], families: [], doctrines: [], traits: [], holySites: [], worshipKeys: [], templates: []
    };
    const worship = (entries: ScriptEntry[]): Record<string, string[]> => Object.fromEntries(children(entries, 'localization')
        .filter(e => e.key && safeKey.test(e.key)).map(e => [e.key!, (typeof e.value === 'string' ? [e.value] :
            e.value.filter(v => typeof v.value === 'string').map(v => v.value as string)).map(label).sort()]));
    for (const [id, entries] of raw) {
        const [group, key] = id.split(':');
        if (group === 'religion_family_types') {
            const f = fact('family', key, entries.filter(e => !['graphical_faith', 'piety_icon_group', 'doctrine_background_icon', 'color', 'icon'].includes(e.key ?? ''))); f.name = '';
            content.families.push(f);
        } else if (group === 'religion_types') {
            const family = scriptString(entries, 'family');
            if (!family || !safeKey.test(family)) throw new Error('Religion lacks an identifiable family');
            const selected = entries.filter(e => !['faiths', 'localization', 'doctrine', 'doctrine_selection_pair', 'custom_faith_icons',
                'piety_icon_group', 'doctrine_background_icon', 'graphical_faith', 'color', 'icon'].includes(e.key ?? ''));
            const f = fact('religion', key, selected); f.name = ''; f.description = '';
            const baseWorship = worship(entries);
            const variants: Record<string, string[][]> = Object.fromEntries(Object.entries(baseWorship).map(([k, v]) => [k, [v]]));
            for (const child of children(entries, 'faiths')) {
                if (!child.key || !Array.isArray(child.value)) continue;
                const faithWorship = { ...baseWorship, ...worship(child.value) };
                for (const [k, v] of Object.entries(faithWorship)) {
                    if (!variants[k]) variants[k] = [];
                    if (!variants[k].some(old => canonicalJsonStringify(old) === canonicalJsonStringify(v))) variants[k].push(v);
                }
                content.templates.push({ key: child.key, religion: key,
                    doctrines: [...scriptStrings(entries, 'doctrine'), ...scriptStrings(child.value, 'doctrine')],
                    holySites: scriptStrings(child.value, 'holy_site'),
                    description: loc.has(child.key + '_desc') ? label(child.key + '_desc') : '', worship: faithWorship });
            }
            content.religions.push({ key, family, description: loc.has(key + '_desc') ? label(key + '_desc') : '', fact: f, worship: variants });
        } else if (group === 'doctrine_types') {
            const groups = [...raw].filter(([id, values]) => id.startsWith('doctrine_group_types:') &&
                children(values, 'doctrine_types').some(e => e.value === key));
            const selected = entries.filter(e => !['icon', 'piety_cost', 'visible', 'is_shown', 'is_available_on_create', 'can_pick', 'can_change'].includes(e.key ?? ''));
            content.doctrines.push(fact('doctrine', key, [
                ...groups.flatMap(([id, values]): ScriptEntry[] => [{ key: 'doctrine_group', value: id.split(':')[1] },
                    { key: 'group_rules', value: values.filter(e => e.key !== 'doctrine_types') }]), ...selected],
                scriptString(entries, 'name') ?? key + '_name', scriptString(entries, 'desc') ?? key + '_desc'));
        } else if (group === 'traits') {
            // A generic '<key>_name' fallback can be an unrelated UI heading
            // (strong_name belongs to the ledger). Resolve this collision in
            // the trait namespace, retaining other existing evidence readings.
            const scoped = !loc.has(key) && loc.has(key + '_name') && loc.has('trait_' + key);
            const name = scoped ? 'trait_' + key : key;
            const description = scoped && loc.has('trait_' + key + '_desc') ? 'trait_' + key + '_desc' : key + '_desc';
            content.traits.push(fact('virtue', key, entries.filter(e => e.key === 'group'), name, description));
        } else if (group === 'holy_site_types') {
            const county = scriptString(entries, 'county'), barony = scriptString(entries, 'barony');
            if (!county || !safeKey.test(county) || (barony && !safeKey.test(barony))) throw new Error('Unsafe sacred location');
            content.holySites.push({ key, county, ...(barony ? { barony } : {}),
                fact: fact('holy_site', key, entries, 'holy_site_' + key + '_name', 'holy_site_' + key + '_effects') });
        }
    }
    content.worshipKeys = [...new Set(content.religions.flatMap(r => Object.keys(r.worship)))].sort();
    for (const array of [content.religions, content.families, content.doctrines, content.traits, content.holySites, content.templates])
        array.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    if (!content.religions.length || !content.doctrines.length || !content.traits.length) throw new Error('No usable faith definitions');
    return { ...content, digest: logicalRequestHash(content) };
}
export function buildFaithCatalog(installation: string, userFolder: string): FaithCatalog {
    return faithCatalogFromFiles(loadActiveCultureFiles(installation, userFolder, directories, true));
}
