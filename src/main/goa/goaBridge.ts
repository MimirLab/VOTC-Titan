import { GOA_TEMPLATE_HASH } from './goaResolver';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { loadActiveCultureFiles, nativeGamePath } from '../culture/cultureCatalog';
import { parseCk3Script, scriptString, scriptStrings } from '../culture/ck3Script';
import { GOA_CATALOGUE_HASH, GOA_RESOLVER_VERSION, goaCatalogue } from './goaCatalogue';

export interface GoaCaptureCatalog {
    version: 1; digest: string; pack: 'GoA2'; packIdentifiers: string[];
    traitIds: string[]; missingProviderIds: string[];
    formulaMatches: Record<string, boolean>; defenceValues: Record<string, string>;
    longLivedIds: string[];
    /** Unconditional race/Blood learning modifiers resolved from effective installed definitions. */
    traitAptitudes?: Record<string, Record<string, number>>;
}
export function buildGoaCaptureCatalog(installation: string, userFolderInput: string): GoaCaptureCatalog | undefined {
    const userFolder = nativeGamePath(userFolderInput);
    const mods: string[] = JSON.parse(fs.readFileSync(path.join(userFolder, 'dlc_load.json'), 'utf8')).enabled_mods;
    const packIdentifiers: string[] = [];
    for (const descriptor of mods) {
        const entries = parseCk3Script(fs.readFileSync(path.resolve(userFolder, nativeGamePath(descriptor)), 'utf8'));
        const id = scriptString(entries, 'remote_file_id');
        // Confirmed GoA Workshop identity. Names, culture names and prompt presets are not provenance.
        if (id === '2949767945') packIdentifiers.push(id);
    }
    if (!packIdentifiers.length) return;
    const files = loadActiveCultureFiles(installation, userFolder, ['common/traits', 'common/script_values'], true);
    const definitions = new Map<string, ReturnType<typeof parseCk3Script>>();
    const values = new Set<string>();
    const constants = new Map<string, string>();
    for (const [file, source] of files) for (const e of parseCk3Script(source)) {
        if (!e.key || !/^[A-Za-z0-9_]+$/.test(e.key)) continue;
        if (file.startsWith('common/traits/') && Array.isArray(e.value)) definitions.set(e.key, e.value);
        if (file.startsWith('common/script_values/')) {
            values.add(e.key);
            if (typeof e.value === 'string') constants.set(e.key, e.value);
        }
    }
    if (!definitions.has('creature_orc') || !definitions.has('being_demon'))
        throw new Error('The active GoA definitions are missing; lore capture was not prepared.');
    const traitIds = [...definitions.keys()].sort();
    const providerIds = [...new Set(goaCatalogue.entries.flatMap(e => e.ids))].sort();
    const missingProviderIds = providerIds.filter(id => !definitions.has(id));
    const formulaMatches = Object.fromEntries(goaCatalogue.formula_provenance.map(p => {
        const source = files.get('common/script_values/' + p.file);
        return [p.file, !!source && createHash('sha256').update(source).digest('hex') === p.sha256];
    }));
    const defenceValues: Record<string, string> = {};
    for (const school of ['light', 'order', 'death', 'disorder', 'life', 'shadow', 'elemental_fire', 'elemental_air', 'elemental_water', 'elemental_earth']) {
        const name = `wc_${school === 'order' ? 'Order' : school}_magic_resistance_value`;
        if (values.has(name)) defenceValues[school] = name;
    }
    const longLivedIds = traitIds.filter(id => Number(scriptString(definitions.get(id)!, 'life_expectancy')) >= 100);
    const traitAptitudes: Record<string, Record<string, number>> = {};
    const scalar = (text: string, visited = new Set<string>()): number | undefined => {
        if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
        if (visited.has(text) || !constants.has(text)) return;
        visited.add(text); return scalar(constants.get(text)!, visited);
    };
    for (const id of traitIds.filter(id => id.startsWith('creature_') || id.startsWith('blood_'))) {
        for (const e of definitions.get(id)!) {
            const match = /^monthly_((?:elemental_)?(?:fire|air|water|earth|light|shadow|order|disorder|life|death))_magic_lifestyle_xp_gain_mult$/.exec(e.key ?? '');
            if (!match || typeof e.value !== 'string') continue;
            const value = scalar(e.value);
            if (value !== undefined && value !== 0) (traitAptitudes[id] ??= {})[match[1]] = value;
        }
    }
    const digest = createHash('sha256').update(JSON.stringify({ packIdentifiers,
        files: [...files].sort(([a], [b]) => a.localeCompare(b)), catalogue: GOA_CATALOGUE_HASH, templates: GOA_TEMPLATE_HASH, resolver: GOA_RESOLVER_VERSION })).digest('hex');
    return { version: 1, digest, pack: 'GoA2', packIdentifiers, traitIds, missingProviderIds, formulaMatches, defenceValues, longLivedIds, traitAptitudes };
}

/** Preserve trait metadata while supplying literal canonical IDs, without guessing a Trait.GetKey API. */
export function goaTraitCapture(catalog: GoaCaptureCatalog): string {
    const lines = ['mimir_log_canonical_traits = {'];
    for (const id of catalog.traitIds) lines.push(`\tif = { limit = { has_trait = ${id} } debug_log = "VOTC:IN/;/trait/;/[THIS.Char.GetID]/;/[GetTrait('${id}').GetTraitCategoryLabel]/;/[GetTrait('${id}').GetNameNoTooltip(THIS.Char)]/;/[GetTrait('${id}').GetDescription(THIS.Char)]/;/${id}" }`);
    lines.push('}', 'mimir_capture_goa_effect = {',
        `\tdebug_log = "VOTC:GOA/;/begin/;/1/;/${catalog.digest}/;/[THIS.Char.GetID]"`,
        '\tdebug_log = "VOTC:GOA/;/count/;/[THIS.Char.MakeScope.ScriptValue(\'mimir_goa_trait_count_value\')|0]"',
        '\tif = { limit = { is_female = yes } debug_log = "VOTC:GOA/;/sex/;/female" }',
        '\telse = { debug_log = "VOTC:GOA/;/sex/;/male" }');
    for (const id of catalog.traitIds) lines.push(`\tif = { limit = { has_trait = ${id} } debug_log = "VOTC:GOA/;/trait/;/${id}" }`);
    for (const [fact, flag] of Object.entries({ ordinary_disease_immunity: 'can_not_get_sick', ageless: 'no_aging_penalties',
        can_fly: 'can_fly', breath_underwater: 'breath_underwater', cannot_use_light: 'can_not_use_light' }))
        lines.push(`\tif = { limit = { has_trait_with_flag = ${flag} } debug_log = "VOTC:GOA/;/fact/;/${fact}/;/yes" }`);
    lines.push('\tif = { limit = { has_trait = immortal } debug_log = "VOTC:GOA/;/fact/;/ageless/;/yes" }');
    if (catalog.longLivedIds.length) lines.push(`\tif = { limit = { OR = { ${catalog.longLivedIds.map(id => `has_trait = ${id}`).join(' ')} } } debug_log = "VOTC:GOA/;/fact/;/long_lived/;/yes" }`);
    for (const [school, value] of Object.entries(catalog.defenceValues))
        lines.push(`\tdebug_log = "VOTC:GOA/;/defence/;/${school}/;/[THIS.Char.MakeScope.ScriptValue('${value}')]"`);
    lines.push(`\tdebug_log = "VOTC:GOA/;/end/;/${catalog.digest}/;/[THIS.Char.GetID]"`, '}', '');
    return lines.join('\n');
}
export function extendGoaExporter(source: string, catalog: GoaCaptureCatalog): string {
    if (!/\blog_personality_traits\s*=\s*yes\b/.test(source)) throw new Error('Unsupported VOTC trait exporter; GoA capture cannot be installed safely.');
    // The upstream effect is still retained for other callers. Only the copied character exporter uses the ID export.
    return source.replace(/\blog_personality_traits\s*=\s*yes\b/, 'mimir_log_canonical_traits = yes\n\tmimir_capture_goa_effect = yes');
}
export function writeGoaCapture(catalog: GoaCaptureCatalog, destination: string): void {
    fs.mkdirSync(path.join(destination, 'common/scripted_effects'), { recursive: true });
    fs.mkdirSync(path.join(destination, 'common/script_values'), { recursive: true });
    fs.writeFileSync(path.join(destination, 'common/scripted_effects/mimir_capture_goa.txt'), goaTraitCapture(catalog));
    // A game-calculated census catches missing positive records without emitting hundreds of
    // negative trait records or changing any character variable/save state.
    fs.writeFileSync(path.join(destination, 'common/script_values/mimir_goa_capture.txt'),
        'mimir_goa_trait_count_value = {\n\tvalue = 0\n' + catalog.traitIds.map(id =>
            `\tif = { limit = { has_trait = ${id} } add = 1 }`).join('\n') + '\n}\n');
    fs.writeFileSync(path.join(destination, 'goa-catalog.json'), JSON.stringify(catalog, null, 2));
}
