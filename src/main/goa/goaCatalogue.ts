import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

export interface GoaCard {
    key: string; ids: string[]; trigger: string; block: string; kind: string;
    requires_fields?: string[]; optional_override_fields?: string[];
    subject?: string; suppress_if_selected?: string[]; replaces?: string[];
}
export interface GoaCatalogue {
    catalogue_revision: string; source_revision: string; entries: GoaCard[];
    traits: Record<string, { name: string; name_aliases?: string[]; flags?: string[]; [key: string]: unknown }>;
    coverage: { ids: string[]; entry_keys: string[]; decision: string }[];
    core_coverage: { ids: string[]; entry_keys: string[]; decision: string }[];
    ancestry_labels: Record<string, { name?: string; label?: string; base_race_id?: string; [key: string]: unknown }>;
    rank_labels: Record<string, string>; family_display_names: Record<string, string>;
    element_capability_glosses: Record<string, string>;
    derived_providers: Record<string, unknown>;
    formula_provenance: { file: string; sha256: string }[];
}
const file = path.resolve(__dirname, '../../../public/goaLore/catalog.json');
const bytes = fs.readFileSync(file);
const imported = JSON.parse(bytes.toString('utf8')) as GoaCatalogue;
if (imported.entries.length !== 297 || new Set(imported.entries.map(e => e.key)).size !== 297)
    throw new Error('The GoA catalogue is incomplete or has duplicate rule keys.');
// Preserve the supplied catalogue byte-for-byte. Separately authored racial guidance
// joins its deterministic rules; it supplies no extra capture or model-routing lane.
const extensionBytes = fs.readFileSync(path.resolve(__dirname, '../../../public/goaLore/racial-extension.json'));
const extension = JSON.parse(extensionBytes.toString('utf8')) as { schemaVersion: number; entries: GoaCard[] };
if (extension.schemaVersion !== 1 || !Array.isArray(extension.entries)) throw new Error('Invalid racial guidance extension.');
export const goaCatalogue: GoaCatalogue = { ...imported, entries: [...imported.entries, ...extension.entries] };
export const GOA_CATALOGUE_HASH = createHash('sha256').update(bytes).update(extensionBytes).digest('hex');
export const GOA_RESOLVER_VERSION = '10';
