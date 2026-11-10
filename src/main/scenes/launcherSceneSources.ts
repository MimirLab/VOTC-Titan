import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { SCENE_CATALOGUE_DIGEST } from '../../shared/scenes/catalogue.generated';
import { nativeGamePath } from '../culture/cultureCatalog';
import { parseCk3Script, scriptString, scriptStrings } from '../culture/ck3Script';
import { canonicalJsonStringify } from '../promptWorkbench/canonicalJson';
import { stockCeRoot } from '../ceBridge';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const policyFile = path.resolve(__dirname, '../../../tools/launcher-scene-policy.json');
export function validateLauncherSceneSources(userInput: string, file = policyFile): boolean {
    const user = nativeGamePath(userInput);
    if (!stockCeRoot(user)) return false;
    const { digest, ...policy } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (policy.format !== 'titan_launcher_scenes_v1' || policy.historical_calendar_grants !== false || policy.catalogue_sha256 !== SCENE_CATALOGUE_DIGEST ||
        sha(canonicalJsonStringify(policy)) !== digest) throw new Error('Invalid launcher scene policy');
    const enabled = JSON.parse(fs.readFileSync(path.join(user, 'dlc_load.json'), 'utf8')).enabled_mods;
    if (!Array.isArray(enabled) || enabled.some(m => typeof m !== 'string')) throw new Error('Invalid scene playset');
    const mods = enabled.map((relative: string) => {
        const entries = parseCk3Script(fs.readFileSync(path.resolve(user, nativeGamePath(relative)), 'utf8'));
        const root = scriptString(entries, 'path');
        if (!root) throw new Error('Unreadable scene source');
        return { root: path.resolve(user, nativeGamePath(root)), version: scriptString(entries, 'version'),
            id: scriptString(entries, 'remote_file_id'), replacements: scriptStrings(entries, 'replace_path') };
    });
    const index = mods.findIndex(m => m.id === '2949767945');
    if (index < 0 || mods[index].version !== policy.mod_version) return false;
    for (const [relative, expected] of Object.entries(policy.source_pins as Record<string, string>)) {
        if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => !p || p === '..')) throw new Error('Invalid scene source path');
        if (sha(fs.readFileSync(path.join(mods[index].root, relative))) !== expected) throw new Error('Scene source changed');
        for (const mod of mods.slice(index + 1)) {
            if (mod.replacements.some(prefix => relative === prefix || relative.startsWith(prefix.replace(/\/+$/, '') + '/'))) throw new Error('Scene source replaced');
            const override = path.join(mod.root, relative);
            if (fs.existsSync(override) && sha(fs.readFileSync(override)) !== expected) throw new Error('Scene source overridden');
        }
    }
    return true;
}
