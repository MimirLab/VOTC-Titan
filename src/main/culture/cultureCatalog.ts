import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { CultureFact, CultureFactKind } from '../../shared/gameData/CultureSnapshot';
import { canonicalJsonStringify, logicalRequestHash, sha256Hex } from '../promptWorkbench/canonicalJson';
import { parseCk3Script, ScriptEntry, scriptString, scriptStrings } from './ck3Script';
import { staticLocalizationText } from './staticLocalization';
import { getCulturePracticeBank } from '../background/culturePracticeBank';

export interface CultureCatalog {
    version: 2;
    digest: string;
    facts: CultureFact[];
    pillarCategories: string[];
    eras: CultureFact[];
    courts: CultureFact[];
    traitValuations: CultureFact[];
    /** Effective VOTC exporter, copied only into the generated local addon. */
    exporter?: { relative: string; source: string };
}

const directories = ['common/culture', 'common/script_values', 'common/court_types', 'common/traits',
    'common/laws', 'common/men_at_arms_types', 'common/buildings', 'common/casus_belli_types',
    'localization/english', 'common/scripted_effects'];
const safeKey = /^[a-zA-Z0-9_.:-]+$/;

/** CK3 launcher descriptors may contain native Linux paths when the companion runs in Wine. */
export function nativeGamePath(input: string): string {
    if (process.platform === 'win32' && input.startsWith('/')) return `Z:${input.replace(/\//g, '\\')}`;
    if (process.platform !== 'win32' && /^z:[\\/]/i.test(input)) return input.slice(2).replace(/\\/g, '/');
    return input.replace(process.platform === 'win32' ? /\//g : /\\/g, path.sep);
}

export function ck3GameDirectory(installation: string): string {
    const directory = nativeGamePath(installation);
    if (fs.existsSync(path.join(directory, 'common', 'culture'))) return directory;
    if (fs.existsSync(path.join(directory, 'game', 'common', 'culture'))) return path.join(directory, 'game');
    throw new Error('Select the CK3 installation folder containing game/common/culture.');
}

function directoryFiles(root: string, prefix: string, output: Map<string, string>, includeUnderscore = false): void {
    const folder = path.join(root, prefix);
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
        const relative = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) directoryFiles(root, relative, output, includeUnderscore);
        else if (entry.isFile() && /\.(txt|yml)$/i.test(entry.name) && (includeUnderscore || !entry.name.startsWith('_')) &&
            (!prefix.startsWith('common/scripted_effects') || entry.name === 'log_character_v2_effect.txt')) {
            const file = path.join(root, relative);
            if (fs.statSync(file).size > 16_000_000) throw new Error('A culture definition file is too large.');
            output.set(relative, fs.readFileSync(file, 'utf8'));
        }
    }
}

function layerFiles(root: string, archive = false, selectedDirectories = directories, includeUnderscore = false): Map<string, string> {
    const result = new Map<string, string>();
    if (!archive) {
        for (const prefix of selectedDirectories) directoryFiles(root, prefix, result, includeUnderscore);
    } else {
        const zip = new AdmZip(root);
        for (const entry of zip.getEntries()) {
            const relative = entry.entryName.replace(/\\/g, '/');
            if (!entry.isDirectory && selectedDirectories.some(p => relative.startsWith(`${p}/`)) &&
                (!relative.startsWith('common/scripted_effects/') || path.posix.basename(relative) === 'log_character_v2_effect.txt') &&
                /\.(txt|yml)$/i.test(relative) && (includeUnderscore || !path.posix.basename(relative).startsWith('_'))) {
                if (entry.header.size > 16_000_000) throw new Error('A culture definition file is too large.');
                result.set(relative, entry.getData().toString('utf8'));
            }
        }
    }
    return result;
}

/** Effective files in launcher order: replace_path first, then file overrides, then key overrides. */
export function loadActiveCultureFiles(installation: string, userFolder: string, selectedDirectories = directories, includeUnderscore = false): Map<string, string> {
    const files = layerFiles(ck3GameDirectory(installation), false, selectedDirectories, includeUnderscore);
    const loadPath = path.join(userFolder, 'dlc_load.json');
    if (!fs.existsSync(loadPath)) throw new Error('The CK3 user folder has no dlc_load.json. Launch the selected playset once first.');
    const load = JSON.parse(fs.readFileSync(loadPath, 'utf8')) as { enabled_mods?: unknown };
    if (!Array.isArray(load.enabled_mods) || load.enabled_mods.some(m => typeof m !== 'string'))
        throw new Error('Invalid CK3 active mod list.');
    for (const descriptor of load.enabled_mods as string[]) {
        // Our generated exporter must not hide later updates to the original VOTC exporter.
        if (descriptor.replace(/\\/g, '/').toLowerCase() === 'mod/votc_mimir_culture.mod') continue;
        const descriptorPath = path.resolve(userFolder, nativeGamePath(descriptor));
        if (!fs.existsSync(descriptorPath)) throw new Error('An active mod descriptor is missing.');
        const entries = parseCk3Script(fs.readFileSync(descriptorPath, 'utf8'));
        const archive = scriptString(entries, 'archive');
        const location = archive ?? scriptString(entries, 'path');
        if (!location) throw new Error('An active mod has no readable folder or archive.');
        const root = path.resolve(userFolder, nativeGamePath(location));
        if (!fs.existsSync(root)) throw new Error('An active mod folder or archive is missing.');
        for (const replaced of scriptStrings(entries, 'replace_path')) {
            const prefix = replaced.replace(/\\/g, '/').replace(/\/+$/, '');
            for (const key of files.keys()) if (key === prefix || key.startsWith(`${prefix}/`)) files.delete(key);
        }
        for (const [relative, content] of layerFiles(root, !!archive, selectedDirectories, includeUnderscore)) files.set(relative, content);
    }
    return files;
}

export function localizations(files: Map<string, string>): Map<string, string> {
    const values = new Map<string, string>();
    // CK3's replace localization is loaded after ordinary localization.
    const paths = [...files.keys()].filter(f => f.startsWith('localization/english/'));
    paths.sort((a, b) => Number(a.includes('/replace/')) - Number(b.includes('/replace/')) || (a < b ? -1 : 1));
    for (const file of paths) for (const line of files.get(file)!.split(/\r?\n/)) {
        const match = /^\s*([^\s:#]+):\d*\s*"(.*)"\s*(?:#.*)?$/.exec(line);
        if (match) values.set(match[1], match[2].replace(/\\n/g, ' ').replace(/\\"/g, '"'));
    }
    return values;
}

function readable(value: string, literal: (key: string, description: boolean) => string): string {
    return value.replace(/#(?:[A-Za-z_][A-Za-z_0-9]*|!)\s?/g, '')
        .replace(/\[([^\[\]]+)\]/g, (_whole, inner: string) => {
            const staticText = staticLocalizationText(inner);
            if (staticText !== undefined) return staticText;
            if (/^[a-zA-Z0-9_ -]+\|[A-Za-z]+$/.test(inner)) return inner.split('|')[0].replace(/_/g, ' ');
            if (/^[\w]+_i$/i.test(inner)) return '';
            const reference = /Get(?:Trait|Law|CourtType|CourtPositionType|MenAtArmsType|Innovation|CultureTradition|CulturePillar)\(\s*'([^']+)'/.exec(inner);
            return reference ? literal(reference[1], /\.GetDesc\b/.test(inner)) : '(context-dependent wording)';
        }).replace(/@[^!\s]+!/g, '').replace(/\s+/g, ' ').trim();
}

export function catalogFromFiles(files: Map<string, string>): CultureCatalog {
    const loc = localizations(files);
    const resolve = (key: string, depth = 0): string => {
        const text = loc.get(key) ?? key;
        return depth > 6 ? text : text.replace(/\$([^$|]+)(?:\|[^$]+)?\$/g, (_m, child: string) => resolve(child, depth + 1));
    };
    const label = (key: string, depth = 0): string => depth > 6 ? key.replace(/_/g, ' ') : readable(resolve(key), (child, description) => {
        const candidates = description ? [`${child}_desc`] : [child, `${child}_name`];
        const selected = candidates.find(k => loc.has(k));
        return selected ? label(selected, depth + 1) : child.replace(/_/g, ' ');
    });
    const definitions = new Map<string, { group: string; entries: ScriptEntry[] }>();
    // Keep the same raw source binding used by authored practice rules, before
    // resolving local script variables for the rest of the catalogue.
    const lineageDefinitions = new Map<string, string>();
    const constants = new Map<string, string | ScriptEntry[]>();
    const graphics = new Map<string, Set<string>>();
    const exporterPath = 'common/scripted_effects/log_character_v2_effect.txt';
    const originalExporter = files.get(exporterPath)?.replace(/\n[ \t]*# MIMIR CULTURE CAPTURE BEGIN\n[\s\S]*?# MIMIR CULTURE CAPTURE END\n/g, '\n');
    const exporter = originalExporter ? { relative: exporterPath, source: originalExporter } : undefined;
    for (const file of [...files.keys()].filter(f => f.startsWith('common/') && !f.startsWith('common/scripted_effects/')).sort()) {
        const entries = parseCk3Script(files.get(file)!);
        if (file.startsWith('common/culture/cultures/')) for (const entry of entries) {
            if (!entry.key || entry.key.startsWith('@') || !Array.isArray(entry.value)) continue;
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(entry.key)) throw new Error('An unsafe culture lineage identifier was found.');
            lineageDefinitions.set(entry.key, sha256Hex(canonicalJsonStringify({ key: entry.key, definition: entry.value })));
        }
        const variables = new Map(entries.filter(e => e.key?.startsWith('@') && typeof e.value === 'string')
            .map(e => [e.key!, e.value as string]));
        const substitute = (values: ScriptEntry[]): void => {
            for (const e of values) {
                if (Array.isArray(e.value)) substitute(e.value);
                else if (variables.has(e.value)) e.value = variables.get(e.value)!;
            }
        };
        entries.filter(e => Array.isArray(e.value)).forEach(e => substitute(e.value as ScriptEntry[]));
        for (const entry of entries) {
            if (file.startsWith('common/script_values/')) {
                if (entry.key && !entry.key.startsWith('@')) constants.set(entry.key, entry.value);
            } else if (entry.key && !entry.key.startsWith('@') && Array.isArray(entry.value)) {
                const group = file.startsWith('common/culture/') ? file.split('/')[2] : file.split('/')[1];
                definitions.set(`${group}:${entry.key}`, { group, entries: entry.value });
                // Laws are nested under law groups, unlike cultural traits.
                if (group === 'laws') for (const child of entry.value)
                    if (child.key && Array.isArray(child.value)) definitions.set(`${group}:${child.key}`, { group, entries: child.value });
                if (group === 'cultures' || group === 'aesthetics_bundles') {
                    for (const type of ['building_gfx', 'clothing_gfx', 'unit_gfx', 'coa_gfx']) {
                        const values = entry.value.filter(e => e.key === type).flatMap(e =>
                            typeof e.value === 'string' ? [e.value] : e.value.map(v => v.value).filter((v): v is string => typeof v === 'string'));
                        if (!graphics.has(type)) graphics.set(type, new Set());
                        const variables = new Map(entries.filter(e => e.key?.startsWith('@') && typeof e.value === 'string')
                            .map(e => [e.key!, e.value as string]));
                        values.forEach(v => graphics.get(type)!.add(variables.get(v) ?? v));
                    }
                }
            }
        }
    }
    const facts: CultureFact[] = [];
    const eras: CultureFact[] = [];
    const courts: CultureFact[] = [];
    const traitValuations: CultureFact[] = [];
    const modifierEvidence = (entries: ScriptEntry[]): unknown[] => entries.map(e => Array.isArray(e.value)
        ? { condition: e.key, operator: e.operator, rules: modifierEvidence(e.value) }
        : { key: e.key, operator: e.operator, value: e.value,
            label: e.key ? (loc.has(`MOD_${e.key.toUpperCase()}`) ? label(`MOD_${e.key.toUpperCase()}`) : e.key.replace(/_/g, ' ')) : undefined });
    const meaningRules = (selected: ScriptEntry[]): string => {
        const references = new Set<string>();
        const parameterDescriptions: Record<string, string> = {};
        const referencedMeanings: Record<string, unknown> = {};
        const collect = (values: ScriptEntry[]): void => {
            for (const e of values) {
                if (Array.isArray(e.value)) collect(e.value);
                else {
                    if (constants.has(e.value) && !references.has(e.value)) {
                        references.add(e.value);
                        const nested = constants.get(e.value)!;
                        if (Array.isArray(nested)) collect(nested);
                        else if (constants.has(nested)) collect([{ value: nested }]);
                    }
                    if (e.key && loc.has(`culture_parameter_${e.key}`)) parameterDescriptions[e.key] = label(`culture_parameter_${e.key}`);
                    if (e.key === 'custom' && loc.has(e.value)) referencedMeanings[e.value] = label(e.value);
                    if (e.key && /^(?:patronym_|dynasty_of_location)/.test(e.key) && loc.has(e.value))
                        referencedMeanings[e.value] = label(e.value);
                    const group = ({ unlock_law: 'laws', unlock_maa: 'men_at_arms_types',
                        unlock_building: 'buildings', unlock_casus_belli: 'casus_belli_types' } as Record<string, string>)[e.key ?? ''];
                    const dependency = group ? definitions.get(`${group}:${e.value}`) : undefined;
                    if (group) referencedMeanings[`${group}:${e.value}`] = {
                        name: label(loc.has(`${e.value}_name`) ? `${e.value}_name` : e.value),
                        description: loc.has(`${e.value}_desc`) ? label(`${e.value}_desc`) : '',
                        // Supporting unlocks carry their actual rules, without implying they are enacted.
                        definitions: dependency?.entries
                    };
                }
            }
        };
        collect(selected);
        const conditionalDescriptions: Record<string, string> = {};
        const dynamicKeys = (values: ScriptEntry[]): void => {
            for (const e of values) {
                if (Array.isArray(e.value)) dynamicKeys(e.value);
                else if (loc.has(e.value)) conditionalDescriptions[e.value] = label(e.value);
            }
        };
        selected.filter(e => ['name', 'desc'].includes(e.key ?? '') && Array.isArray(e.value))
            .forEach(e => dynamicKeys(e.value as ScriptEntry[]));
        return canonicalJsonStringify({ definitions: selected, parameterDescriptions, referencedMeanings,
            constants: Object.fromEntries([...references].sort().map(r => [r, constants.get(r)])), conditionalDescriptions,
            modifierEvidence: selected.filter(e => e.key?.includes('modifier') && Array.isArray(e.value))
                .map(e => ({ scope: e.key,
                    conditions: (e.value as ScriptEntry[]).filter(v => ['doctrine', 'trigger', 'limit'].includes(v.key ?? '')),
                    effects: modifierEvidence(e.value as ScriptEntry[]) })) });
    };
    for (const [id, definition] of definitions) {
        const key = id.slice(id.indexOf(':') + 1);
        if (!safeKey.test(key)) throw new Error('A culture identifier cannot safely be used in the capture script.');
        const { group, entries } = definition;
        if (group === 'traits') {
            entries.filter(e => e.key === 'culture_modifier' && Array.isArray(e.value)).forEach((e, index) => {
                const values = e.value as ScriptEntry[];
                const parameter = scriptString(values, 'parameter');
                if (!parameter) return;
                traitValuations.push({ kind: 'trait_valuation', key: `${key}:${parameter}:${index}`, category: parameter,
                    name: label(key), description: 'Consequences of possessing this trait under the active cultural parameter; not a trait assigned to everyone.',
                    rules: canonicalJsonStringify({ trait: key, parameter, definitions: values,
                        effects: modifierEvidence(values.filter(v => v.key !== 'parameter')),
                        resolvedRules: JSON.parse(meaningRules([{ key: 'culture_modifier', value: values }])) }) });
            });
            continue;
        }
        const kind = ({ pillars: 'pillar', traditions: 'tradition', innovations: 'innovation', name_lists: 'naming', eras: 'era', court_types: 'court_ideal' } as Record<string, CultureFactKind | undefined>)[group];
        if (!kind) continue;
        const category = scriptString(entries, 'type') ?? scriptString(entries, 'category') ?? '';
        const selected = entries.filter(e => {
            if (kind === 'naming') return !!e.key && !(Array.isArray(e.value) && /_names$/i.test(e.key));
            if (kind === 'innovation' || kind === 'era' || kind === 'court_ideal')
                return !!e.key && !['icon', 'illustration', 'texture'].includes(e.key);
            return !!e.key && (e.key === 'parameters' || e.key.includes('modifier') || e.key === 'custom' ||
                e.key === 'culture_era' || e.key === 'name' || e.key === 'desc' || e.key === 'doctrine_character_modifier');
        });
        const nameKey = scriptString(entries, 'name') ?? (loc.has(`${key}_name`) ? `${key}_name` : key);
        const descKey = scriptString(entries, 'desc') ?? `${key}_desc`;
        let description = loc.has(descKey) ? label(descKey) : '';
        if (!description && category && loc.has(`${category}_generic_label_desc`)) description = label(`${category}_generic_label_desc`);
        const fact: CultureFact = { kind, key, category, name: label(nameKey), description,
            rules: meaningRules(selected) };
        (kind === 'era' ? eras : kind === 'court_ideal' ? courts : facts).push(fact);
    }
    for (const [category, keys] of graphics) for (const key of keys) {
        if (!safeKey.test(key)) throw new Error('An aesthetic identifier cannot safely be captured.');
        facts.push({ kind: 'aesthetic', key: `${category}:${key}`, category, name: key.replace(/_/g, ' '), description: '', rules: '' });
    }
    facts.push(...[...lineageDefinitions].map(([key, sourceDefinitionHash]): CultureFact => ({
        kind: 'lineage', key, category: 'source_culture', name: '', description: '',
        rules: canonicalJsonStringify({ version: 1, sourceDefinitionHash })
    })));
    facts.push(...getCulturePracticeBank().catalogueFacts(files, facts));
    facts.sort((a, b) => `${a.kind}:${a.key}` < `${b.kind}:${b.key}` ? -1 : 1);
    eras.sort((a, b) => a.key < b.key ? -1 : 1);
    if (!facts.some(f => f.kind === 'tradition') || !facts.some(f => f.kind === 'pillar'))
        throw new Error('No readable cultural pillars or traditions were found.');
    const pillarCategories = [...new Set(facts.filter(f => f.kind === 'pillar').map(f => f.category))].sort();
    courts.sort((a, b) => a.key < b.key ? -1 : 1);
    traitValuations.sort((a, b) => a.key < b.key ? -1 : 1);
    const content = { version: 2 as const, facts, pillarCategories, eras, courts, traitValuations, exporter };
    return { ...content, digest: logicalRequestHash(content) };
}

export function buildCultureCatalog(installation: string, userFolder: string): CultureCatalog {
    return catalogFromFiles(loadActiveCultureFiles(installation, userFolder));
}
