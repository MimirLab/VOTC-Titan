import fs from 'fs';
import path from 'path';
import { FaithCatalog } from './faithCatalog';

export function faithCaptureEffect(catalog: FaithCatalog): string {
    const lines = ['mimir_capture_faith_effect = {', '\tif = {', '\t\tlimit = { exists = faith }',
        '\t\tsave_temporary_scope_as = mimir_faith_character',
        '\t\tfaith = { save_temporary_scope_as = mimir_faith }',
        '\t\tdebug_log = "VOTC:FAITH/;/begin/;/1/;/' + catalog.digest + '/;/[THIS.Char.GetID]/;/[THIS.Char.GetFaith.GetID]"'];
    const log = (record: string) => 'debug_log = "VOTC:FAITH/;/' + record + '"';
    // GoA records the original source faith when a faith is created. Only
    // compare the engine's actual reference against safely keyed source
    // templates; an absent or non-template parent is never guessed by name.
    lines.push('\t\tif = { limit = { faith = { has_variable = parent_faith } }',
        '\t\t\t' + log('parent_state/;/present'));
    for (const t of catalog.templates) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(t.key)) throw new Error('Unsafe source faith identifier');
        lines.push('\t\t\tif = { limit = { faith = { var:parent_faith = faith:' + t.key + ' } } ' + log('ancestor/;/' + t.key + '/;/1') + ' }',
            '\t\t\telse = { ' + log('ancestor/;/' + t.key + '/;/0') + ' }');
    }
    lines.push('\t\t}', '\t\telse = { ' + log('parent_state/;/absent') + ' }');
    // Personal disposition travels alongside the encounter, never inside the shared faith snapshot.
    if (catalog.traits.some(t => t.key === 'zealous'))
        lines.push('\t\tif = { limit = { has_trait = zealous } ' + log('personal/;/zealous/;/yes') + ' }',
            '\t\telse = { ' + log('personal/;/zealous/;/no') + ' }');
    const probe = (kind: string, key: string, trigger: string) =>
        lines.push('\t\tif = { limit = { faith = { ' + trigger + ' } } ' + log('fact/;/' + kind + '/;/' + key) + ' }');
    for (const r of catalog.religions) probe('religion', r.key, 'religion = religion:' + r.key);
    lines.push('\t\t' + log('census/;/religion/;/' + catalog.religions.length));
    for (const d of catalog.doctrines) probe('doctrine', d.key, 'has_doctrine = ' + d.key);
    lines.push('\t\t' + log('census/;/doctrine/;/' + catalog.doctrines.length));
    for (const kind of ['virtue', 'sin']) {
        for (const t of catalog.traits) probe(kind, t.key, 'trait_is_' + kind + ' = ' + t.key);
        lines.push('\t\t' + log('census/;/' + kind + '/;/' + catalog.traits.length));
    }
    for (const s of catalog.holySites) {
        const location = 'title:' + (s.barony ?? s.county + '.title_province.barony');
        lines.push('\t\tif = { limit = { exists = ' + location + ' ' + location + ' = { is_holy_site_of = scope:mimir_faith } }',
            '\t\t\t' + log('fact/;/holy_site/;/' + s.key),
            '\t\t\tif = { limit = { ' + location + '.holder.faith = scope:mimir_faith } ' + log('live/;/site/;/' + s.key + '/;/yes') + ' }',
            '\t\t\telse = { ' + log('live/;/site/;/' + s.key + '/;/no') + ' }', '\t\t}');
    }
    lines.push('\t\t' + log('census/;/holy_site/;/' + catalog.holySites.length));
    const text = (key: string, getter: string) => lines.push('\t\t' + log('text_begin/;/' + key),
        '\t\t' + log('text/;/' + getter),
        '\t\t' + log('text_end/;/' + catalog.digest + '/;/[THIS.Char.GetID]/;/[THIS.Char.GetFaith.GetID]/;/' + key));
    text('faith_description', '[THIS.Char.GetFaith.GetFlavorDesc]');
    text('religion_description', '[THIS.Char.GetFaith.GetReligion.GetFlavorDesc]');
    for (const key of catalog.worshipKeys) text('worship:' + key, "[THIS.Char.GetFaith.Custom('" + key + "')]");
    lines.push('\t\t' + log('live/;/fervor/;/[THIS.Char.GetFaith.GetFervor]'),
        '\t\tif = { limit = { exists = faith.religious_head } ' + log('live/;/head/;/[THIS.Char.GetFaith.GetReligiousHead.GetName]') + ' }',
        '\t\t' + log('end/;/' + catalog.digest + '/;/[THIS.Char.GetID]/;/[THIS.Char.GetFaith.GetID]'), '\t}', '}', '');
    return lines.join('\n');
}
export function writeFaithCapture(catalog: FaithCatalog, destination: string): void {
    const file = path.join(destination, 'common/scripted_effects/mimir_capture_faith.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, faithCaptureEffect(catalog));
    fs.writeFileSync(path.join(destination, 'faith-catalog.json'), JSON.stringify(catalog));
}
