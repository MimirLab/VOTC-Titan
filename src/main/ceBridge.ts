import fs from 'fs';
import path from 'path';
import { nativeGamePath } from './culture/cultureCatalog';
import { parseCk3Script, scriptString } from './culture/ck3Script';

export function stockCeRoot(userFolder: string): string | undefined {
    const load = path.join(userFolder, 'dlc_load.json');
    if (!fs.existsSync(load)) return;
    const enabled = JSON.parse(fs.readFileSync(load, 'utf8')).enabled_mods;
    if (!Array.isArray(enabled)) throw new Error('The active CK3 playset is unavailable.');
    for (const relative of [...enabled].reverse()) {
        if (typeof relative !== 'string') throw new Error('Invalid active CK3 descriptor.');
        const entries = parseCk3Script(fs.readFileSync(path.resolve(userFolder, nativeGamePath(relative)), 'utf8'));
        if (scriptString(entries, 'remote_file_id') !== '3654567139') continue;
        const root = scriptString(entries, 'path');
        if (!root) throw new Error('The subscribed CE game component must be readable.');
        return path.resolve(userFolder, nativeGamePath(root));
    }
}

export function ceRunnerFiles(userFolder: string): string[] {
    const root = stockCeRoot(userFolder);
    if (!root) return ['votc.txt', 'letters.txt', 'votc_letter_actions.txt'];
    const names = new Set<string>();
    let bytes = 0;
    const walk = (folder: string): void => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const file = path.join(folder, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (entry.isFile() && entry.name.endsWith('.gui')) {
                bytes += fs.statSync(file).size;
                if (bytes > 16_000_000) throw new Error('CE command declarations exceed the supported size.');
                for (const match of fs.readFileSync(file, 'utf8').matchAll(/ExecuteConsoleCommand\('run ([A-Za-z0-9_]+\.txt)'\)/g))
                    names.add(match[1]);
            }
        }
    };
    walk(path.join(root, 'gui'));
    if (names.size > 64) throw new Error('CE declares too many command channels.');
    return [...names].sort();
}

/** Normal CE command inputs only; never change a queued action or mod file. */
export function initializeCeCommandFiles(userFolder: string): void {
    if (!userFolder) return;
    const run = path.join(userFolder, 'run');
    fs.mkdirSync(run, { recursive: true });
    for (const name of ceRunnerFiles(userFolder)) {
        const file = path.join(run, name);
        if (!fs.existsSync(file)) fs.writeFileSync(file, '\uFEFF', { flag: 'wx' });
    }
}

/** Discover the subscribed CE runner instead of changing its GUI or files.
 * CE 2.5 renamed the conversation channel to votc_ce.txt. Older supported
 * editions use votc.txt. Only the two ordinary command filenames are allowed.
 */
export function conversationCommandFile(userFolder: string): 'votc.txt' | 'votc_ce.txt' {
    const root = stockCeRoot(userFolder);
    if (root) {
        const gui = fs.readFileSync(path.join(root, 'gui/custom_gui/talk_window_v2.gui'), 'utf8');
        const channels = [...gui.matchAll(/ExecuteConsoleCommand\('run (votc(?:_ce)?\.txt)'\)/g)].map(m => m[1]);
        const unique = [...new Set(channels)];
        if (unique.length !== 1) throw new Error('This CE edition has no supported conversation command channel.');
        return unique[0] as 'votc.txt' | 'votc_ce.txt';
    }
    // Preserved legacy workspaces remain readable during migration. This does
    // not install or enable a game component; fresh installation requires CE.
    return 'votc.txt';
}

export function ceCommandFile(userFolder: string, requested: string): string {
    if (requested === 'votc.txt') return conversationCommandFile(userFolder);
    const modern: Record<string, string> = { 'letters.txt': 'votc_ce_letters.txt', 'votc_letter_actions.txt': 'votc_ce_letter_actions.txt' };
    if (modern[requested]) {
        const files = ceRunnerFiles(userFolder);
        if (files.includes(requested)) return requested;
        if (files.includes(modern[requested])) return modern[requested];
    }
    return requested;
}
