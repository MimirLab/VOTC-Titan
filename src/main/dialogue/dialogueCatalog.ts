import fs from 'fs';
import path from 'path';

export interface DialogueCatalogue {
    version: string; sourceLocale: string; sourceSha256: string;
    cultures: Record<string, { instruction: string }>;
    faiths: Record<string, { faithIds: string[]; instruction: string }>;
    roles: Record<string, { label: string; traitIds: string[]; instruction: string; requiresConfirmedRole: boolean }>;
}
let catalogue: DialogueCatalogue | undefined;
export function dialogueCatalogue(): DialogueCatalogue {
    if (catalogue) return catalogue;
    const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../public/dialogue-steering/registers.json'), 'utf8')) as DialogueCatalogue;
    const key = (s: string) => /^[a-zA-Z0-9_]+$/.test(s);
    const text = (s: string) => typeof s === 'string' && s.length > 20 && s.length < 6000 && !/[<>]/.test(s);
    if (data.version !== 'titan-dialogue-registers-r1' || data.sourceLocale !== 'en' || !/^[a-f0-9]{64}$/.test(data.sourceSha256) ||
        !data.cultures || !data.faiths || !data.roles ||
        Object.entries(data.cultures).some(([id, v]) => !key(id) || !text(v.instruction)) ||
        Object.entries(data.faiths).some(([id, v]) => !key(id) || !text(v.instruction) || !Array.isArray(v.faithIds) || v.faithIds.some(id => !key(id))) ||
        Object.entries(data.roles).some(([id, v]) => !key(id) || !text(v.instruction) || !Array.isArray(v.traitIds) || v.traitIds.some(id => !key(id))))
        throw new Error('Invalid authored dialogue registers');
    catalogue = data; return data;
}
