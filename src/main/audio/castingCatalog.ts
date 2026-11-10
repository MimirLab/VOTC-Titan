import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export interface CastingCatalogue {
    version: string; sourceSha256: string;
    anatomy: Record<string, { label: string; male: string | null; female: string | null }>;
    races: Record<string, { label: string; options: string[]; default: string }>;
    cultures: Record<string, string>;
    faithDelivery: Record<string, { faithIds: string[]; instruction: string }>;
}
let cached: CastingCatalogue | undefined;
let cachedPath = '';
/** Authored casting material. Labels/provenance never become biography or canonical accent facts. */
export function castingCatalogue(): CastingCatalogue {
    const file = path.join(app.getAppPath(), 'public/audio/goa-casting.json');
    if (cached && file === cachedPath) return cached;
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as CastingCatalogue;
    if (data.version !== 'goa2-acoustic-r3.1' || !/^[a-f0-9]{64}$/.test(data.sourceSha256) ||
        Object.keys(data.anatomy).length !== 115 || Object.keys(data.races).length !== 92 ||
        Object.keys(data.cultures).length !== 166 || Object.keys(data.faithDelivery).length !== 35 || 'wc_dummy' in data.cultures)
        throw new Error('Invalid acoustic casting catalogue.');
    cachedPath = file; return cached = data;
}
