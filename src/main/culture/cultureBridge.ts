import { GoaCaptureCatalog, extendGoaExporter, writeGoaCapture } from '../goa/goaBridge';
import fs from 'fs';
import path from 'path';
import { CultureCatalog } from './cultureCatalog';
import { FaithCatalog } from '../faith/faithCatalog';
import { writeFaithCapture } from '../faith/faithBridge';
import { getCulturePracticeBank } from '../background/culturePracticeBank';

export const CULTURE_ADDON_NAME = 'VOTC Titan Edition Backgrounds';

/** Additive observer. No replacement of character_window or the installed VOTC mod. */
export function cultureCaptureEffect(catalog: CultureCatalog): string {
    const lines = [
        'mimir_capture_culture_effect = {',
        '\tif = {',
        '\t\tlimit = { exists = culture }',
        `\t\tdebug_log = "VOTC:CULTURE/;/begin/;/2/;/${catalog.digest}/;/[THIS.Char.GetID]/;/[THIS.Char.GetCulture.GetID]/;/[GetDataModelSize(THIS.Char.GetCulture.GetTraditions)]/;/[THIS.Char.GetCulture.GetNumberOfDiscoveredInnovations]"`
    ];
    for (const fact of catalog.facts) {
        if (fact.kind === 'lineage') {
            // Both the current source culture and any native ancestor count;
            // log false as well so an incomplete census cannot impersonate one.
            const predicate = `OR = { this = culture:${fact.key} any_parent_culture_or_above = { this = culture:${fact.key} } }`;
            lines.push(`\t\tif = { limit = { culture = { ${predicate} } } debug_log = "VOTC:CULTURE/;/ancestor/;/${fact.key}/;/1" } else = { debug_log = "VOTC:CULTURE/;/ancestor/;/${fact.key}/;/0" }`);
            continue;
        }
        if (fact.kind === 'practice') {
            const predicate = getCulturePracticeBank().capturePredicate(fact);
            lines.push(`\t\tif = { limit = { culture = { ${predicate} } } debug_log = "VOTC:CULTURE/;/practice/;/${fact.key}/;/1" } else = { debug_log = "VOTC:CULTURE/;/practice/;/${fact.key}/;/0" }`);
            continue;
        }
        let trigger: string;
        let identifier = fact.key;
        switch (fact.kind) {
            case 'pillar': trigger = 'has_cultural_pillar'; break;
            case 'tradition': trigger = 'has_cultural_tradition'; break;
            case 'innovation': trigger = 'has_innovation'; break;
            case 'naming': trigger = 'has_name_list'; break;
            case 'aesthetic':
                trigger = `has_${fact.category}`;
                identifier = fact.key.slice(fact.category.length + 1);
                break;
            default: continue;
        }
        // Raw keys are validated by the catalogue builder, never interpolated from a log or save.
        lines.push(`\t\tif = { limit = { culture = { ${trigger} = ${identifier} } } debug_log = "VOTC:CULTURE/;/fact/;/${fact.kind}/;/${fact.key}" }`);
    }
    lines.push(
        '\t\tdebug_log = "VOTC:CULTURE/;/support/;/era/;/[THIS.Char.GetCulture.GetCultureEra.GetType.GetName]"',
        '\t\tdebug_log = "VOTC:CULTURE/;/support/;/naming_order/;/[THIS.Char.GetCulture.GetNamingAestheticName]"',
        '\t\tdebug_log = "VOTC:CULTURE/;/support/;/primary_naming/;/[THIS.Char.GetCulture.GetNamingListName]"',
        `\t\tdebug_log = "VOTC:CULTURE/;/end/;/${catalog.digest}/;/[THIS.Char.GetID]/;/[THIS.Char.GetCulture.GetID]"`,
        '\t}',
        '}', ''
    );
    return lines.join('\n');
}

export function cultureCaptureScript(includeFaith = false, includeGoa = false): string {
    return 'mimir_capture_culture = {\n\tscope = character\n\tis_shown = { always = yes }\n\tis_valid = { OR = { exists = culture exists = faith } }\n\teffect = { mimir_capture_culture_effect = yes ' +
        (includeFaith ? 'mimir_capture_faith_effect = yes ' : '') + (includeGoa ? 'mimir_capture_goa_effect = yes ' : '') + '}\n}\n';
}

/** Preserve the active exporter verbatim, appending a read-only capture inside its outer effect. */
export function extendCharacterExporter(source: string, includeFaith = false): string {
    const match = /\blog_character_v2\s*=\s*\{/.exec(source);
    if (!match) throw new Error('The active VOTC character exporter is unsupported.');
    const start = match.index + match[0].length;
    let depth = 1;
    let quoted = false;
    let comment = false;
    let escaped = false;
    for (let index = start; index < source.length; index++) {
        const char = source[index];
        if (comment) { if (char === '\n') comment = false; continue; }
        if (quoted) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') quoted = false;
            continue;
        }
        if (char === '#') comment = true;
        else if (char === '"') quoted = true;
        else if (char === '{') depth++;
        else if (char === '}' && --depth === 0) {
            return source.slice(0, index) + '\n\t# MIMIR CULTURE CAPTURE BEGIN\n\tmimir_capture_culture_effect = yes\n\t# MIMIR CULTURE CAPTURE END\n' +
                (includeFaith ? '\t# MIMIR FAITH CAPTURE BEGIN\n\tmimir_capture_faith_effect = yes\n\t# MIMIR FAITH CAPTURE END\n' : '') + source.slice(index);
        }
    }
    throw new Error('The active VOTC character exporter is incomplete.');
}

export function cultureObserverGui(): string {
    return `window = {
    name = "mimir_culture_observer"
    size = { 0 0 }
    layer = bottom_bottom
    hbox = {
        name = "mimir_culture_counter"
        size = { 0 0 }
        state = {
            name = culture_selected
            trigger_when = "[And(IsGameViewOpen('character_window'), Not(GetVariableSystem.HasValue('mimir_culture_seen', UIntToString(CharacterWindow.GetCharacter.GetID))))]"
            on_start = "[GetScriptedGui('mimir_capture_culture').Execute(GuiScope.SetRoot(CharacterWindow.GetCharacter.MakeScope).End)]"
            on_start = "[GetVariableSystem.Set('mimir_culture_seen', UIntToString(CharacterWindow.GetCharacter.GetID))]"
        }
        state = {
            name = culture_closed
            trigger_when = "[Not(IsGameViewOpen('character_window'))]"
            on_start = "[GetVariableSystem.Clear('mimir_culture_seen')]"
        }
        state = {
            name = culture_poll
            trigger_on_create = yes
            duration = 5
            on_finish = "[GetVariableSystem.Clear('mimir_culture_seen')]"
            on_finish = "[ExecuteConsoleCommand('gui.createwidget gui/mimir_culture_observer.gui mimir_culture_counter')]"
        }
    }
}
`;
}

/** Writes an independent generated addon; the caller decides whether to register it with the launcher. */
export function writeCultureAddon(catalog: CultureCatalog, destination: string, faithCatalog?: FaithCatalog, goaCatalog?: GoaCaptureCatalog): void {
    const write = (relative: string, contents: string) => {
        const file = path.join(destination, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, contents, 'utf8');
    };
    write('descriptor.mod', `name="${CULTURE_ADDON_NAME}"\nversion="1.1"\ntags={ "Utilities" }\n`);
    write('common/scripted_guis/mimir_capture_culture.txt', cultureCaptureScript(!!faithCatalog, !!goaCatalog));
    write('common/scripted_effects/mimir_capture_culture.txt', cultureCaptureEffect(catalog));
    if (catalog.exporter) {
        const source = extendCharacterExporter(catalog.exporter.source, !!faithCatalog);
        write(catalog.exporter.relative, goaCatalog ? extendGoaExporter(source, goaCatalog) : source);
    }
    if (goaCatalog) writeGoaCapture(goaCatalog, destination);
    else for (const file of ['goa-catalog.json', 'common/scripted_effects/mimir_capture_goa.txt', 'common/script_values/mimir_goa_capture.txt']) fs.rmSync(path.join(destination, file), { force: true });
    write('gui/mimir_culture_observer.gui', cultureObserverGui());
    write('gui/scripted_widgets/mimir_culture_observer.txt', 'gui/mimir_culture_observer.gui = mimir_culture_observer\n');
    write('culture-catalog.json', JSON.stringify(catalog));
    if (faithCatalog) writeFaithCapture(faithCatalog, destination);
    else {
        // Preparing a culture-only catalogue must not leave a previous faith hook/catalogue pretending readiness.
        for (const relative of ['faith-catalog.json', 'common/scripted_effects/mimir_capture_faith.txt'])
            fs.rmSync(path.join(destination, relative), { force: true });
    }
}

export function registerCultureAddon(destination: string, userFolder: string): void {
    const folder = path.join(userFolder, 'mod');
    fs.mkdirSync(folder, { recursive: true });
    let gamePath = path.resolve(destination).replace(/\\/g, '/');
    if (/^z:\//i.test(gamePath)) gamePath = gamePath.slice(2);
    if (/["\r\n]/.test(gamePath)) throw new Error('Unsupported addon folder path.');
    fs.writeFileSync(path.join(folder, 'votc_mimir_culture.mod'),
        `name="${CULTURE_ADDON_NAME}"\npath="${gamePath}"\nversion="1.1"\ntags={ "Utilities" }\n`, 'utf8');
    // Never edit dlc_load.json or silently change the user's playset.
}
