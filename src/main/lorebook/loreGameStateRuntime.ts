import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import type { Config } from '../../shared/Config';
import type { Character } from '../../shared/gameData/Character';
import type { GameData } from '../../shared/gameData/GameData';
import { nativeGamePath } from '../culture/cultureCatalog';
import { parseCk3Script, scriptString, scriptStrings } from '../culture/ck3Script';
import { canonicalJsonStringify } from '../promptWorkbench/canonicalJson';
import { LoreGameStateCatalog, LoreGameStateReader, LoreGameStateSnapshot } from './loreGameStateCapture';

const policyFile = path.resolve(__dirname, '../../../tools/lorebook-game-state-catalogue.json');
const bookFile = path.resolve(__dirname, '../../../public/lorebook/bundle/goa.sqlite3');
const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

export function loadLoreGameStateCatalog(userFolderInput: string, file = policyFile, book = bookFile): LoreGameStateCatalog | undefined {
    if (!fs.existsSync(file)) return;
    const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { digest, ...body } = policy;
    new LoreGameStateReader(policy);
    if (sha(canonicalJsonStringify(body)) !== digest || sha(fs.readFileSync(book)) !== policy.supplement_sha256)
        throw new Error('Current-state policy or accepted book edition changed.');
    const user = nativeGamePath(userFolderInput);
    const enabled = JSON.parse(fs.readFileSync(path.join(user, 'dlc_load.json'), 'utf8')).enabled_mods;
    if (!Array.isArray(enabled) || enabled.some(v => typeof v !== 'string')) throw new Error('Invalid active playset.');
    const mods = enabled.map((relative: string) => {
        const entries = parseCk3Script(fs.readFileSync(path.resolve(user, nativeGamePath(relative)), 'utf8'));
        const root = scriptString(entries, 'path');
        if (!root) throw new Error('A current-state source mod is not readable.');
        return { root: path.resolve(user, nativeGamePath(root)), id: scriptString(entries, 'remote_file_id'),
            version: scriptString(entries, 'version'), replacements: scriptStrings(entries, 'replace_path') };
    });
    const index = mods.findIndex(mod => mod.id === '2949767945');
    if (index < 0) return;
    if (mods[index].version !== policy.mod_version) throw new Error('This GoA edition needs a read-only state adapter.');
    for (const [relative, expected] of Object.entries(policy.source_pins)) {
        if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => !p || p === '..'))
            throw new Error('Invalid current-state source path.');
        if (sha(fs.readFileSync(path.join(mods[index].root, relative))) !== expected)
            throw new Error('Current-state GoA source differs.');
        // descriptor.mod belongs to each pack independently. It is not a
        // globally overridden gameplay path like events/common script files.
        for (const mod of relative === 'descriptor.mod' ? [] : mods.slice(index + 1)) {
            if (mod.replacements.some(prefix => relative === prefix || relative.startsWith(prefix.replace(/\/+$/, '') + '/')))
                throw new Error('A later mod replaces an inspected current-state source directory.');
            const override = path.join(mod.root, relative);
            if (fs.existsSync(override) && sha(fs.readFileSync(override)) !== expected)
                throw new Error('A later mod overrides an inspected current-state source.');
        }
    }
    return policy;
}

let reader: LoreGameStateReader | undefined;
let config: Config | undefined;
let flush: (() => void) | undefined;
let checkedAt = 0;
let binding = '';
const key = (value: Config) => JSON.stringify([value.userFolderPath, value.goaLoreEnabled, value.lorebookEnabled]);
const bound = new WeakMap<Character, { reader: LoreGameStateReader; snapshot: LoreGameStateSnapshot }>();

export function configureLoreGameStateCapture(value: Config, flushLog?: () => void): void {
    config = value; flush = flushLog; reader = undefined; checkedAt = Date.now(); binding = key(value);
    if (!value.userFolderPath || value.goaLoreEnabled === false || value.lorebookEnabled === false) return;
    try {
        const catalog = loadLoreGameStateCatalog(value.userFolderPath);
        if (catalog) reader = new LoreGameStateReader(catalog);
    } catch { /* Unsupported state leaves lore facts unknown; ordinary RP stays available. */ }
}
export function currentLoreGameStateCatalog(): LoreGameStateCatalog | undefined {
    return config && binding === key(config) ? reader?.catalog : undefined;
}
export function observeLoreGameStateLine(line: string): void { reader?.observe(line); }
export function clearLoreGameState(): void { reader?.clear(); }
export function getLoreGameState(character: Character): LoreGameStateSnapshot | undefined {
    if (!reader || !config || binding !== key(config)) return;
    if (Date.now() - checkedAt > 5000) {
        checkedAt = Date.now();
        try {
            if (loadLoreGameStateCatalog(config.userFolderPath)?.digest !== reader.catalog.digest) {
                configureLoreGameStateCapture(config, flush); return;
            }
        } catch { configureLoreGameStateCapture(config, flush); return; }
    }
    flush?.();
    const current = reader.snapshots.get(character.id), previous = bound.get(character);
    if (!current) return;
    if (Date.now() - (reader.seenAt.get(character.id) ?? 0) > 15000 &&
        (previous?.reader !== reader || previous.snapshot !== current)) return;
    bound.set(character, { reader, snapshot: current });
    return current;
}

/** Stock CE exports a localized display date. Read the numeric clock through
 * the same RP probe; never parse that display string or change CE's exporter.
 */
export function bindLoreGameStateClock(game: GameData, characters: Character[]): boolean {
    const snapshots = characters.map(getLoreGameState);
    if (!snapshots.length || snapshots.some(s => !s)) return false;
    const date = snapshots[0]!.date;
    if (snapshots.some(s => canonicalJsonStringify(s!.date) !== canonicalJsonStringify(date))) return false;
    game.gameDate = { ...date };
    return true;
}
