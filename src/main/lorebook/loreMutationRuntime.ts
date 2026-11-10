import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import type { Config } from '../../shared/Config';
import type { Character } from '../../shared/gameData/Character';
import { nativeGamePath, ck3GameDirectory } from '../culture/cultureCatalog';
import { parseCk3Script, scriptString, scriptStrings } from '../culture/ck3Script';
import { canonicalJsonStringify } from '../promptWorkbench/canonicalJson';
import { LoreMutationCatalog, LoreMutationLogReader, LoreMutationSnapshot } from './loreMutationCapture';

const policyPath = path.resolve(__dirname, '../../../tools/lorebook-mutation-catalogue.json');
const bundlePath = path.resolve(__dirname, '../../../public/lorebook/bundle/goa.sqlite3');
const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
function relativeFile(root: string, relative: string): string {
    if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..' || !part))
        throw new Error('Invalid lore mutation source path.');
    return path.join(root, relative);
}

/** Verify both the original GoA sources and the effective installed patch.
 * A manifest alone, a display name, or a raw memory token grants no access.
 */
export function loadLoreMutationCatalog(userFolderInput: string, file = policyPath, book = bundlePath, installation?: string): LoreMutationCatalog | undefined {
    if (!fs.existsSync(file)) return;
    const source = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { digest, ...body } = source;
    if (source.version !== 1 || source.mod_version !== '0.6.5' || !Array.isArray(source.points) ||
        source.points.length > 512 || hash(canonicalJsonStringify(body)) !== digest ||
        hash(fs.readFileSync(book)) !== source.supplement_sha256 ||
        !Array.isArray(source.memory_owner_policies) || source.memory_owner_policies.some((p: string) => !['ordinary', 'fallen'].includes(p)))
        throw new Error('Changed lore mutation catalogue or book edition.');
    new LoreMutationLogReader(source);
    const user = nativeGamePath(userFolderInput);
    const enabled = JSON.parse(fs.readFileSync(path.join(user, 'dlc_load.json'), 'utf8')).enabled_mods;
    if (!Array.isArray(enabled) || enabled.some(item => typeof item !== 'string')) throw new Error('Invalid lore mutation playset.');
    const mods = enabled.map((descriptor: string) => {
        const entries = parseCk3Script(fs.readFileSync(path.resolve(user, nativeGamePath(descriptor)), 'utf8'));
        const folder = scriptString(entries, 'path');
        if (!folder || scriptString(entries, 'archive')) throw new Error('Lore mutation capture requires readable active mod folders.');
        return { root: path.resolve(user, nativeGamePath(folder)), id: scriptString(entries, 'remote_file_id'),
            version: scriptString(entries, 'version'), replaced: scriptStrings(entries, 'replace_path') };
    });
    const matches = mods.map((m, index) => m.id === '2949767945' ? index : -1).filter(index => index >= 0);
    if (matches.length !== 1 || mods[matches[0]].version !== source.mod_version) throw new Error('Unverified GoA mutation source version.');
    const index = matches[0], goa = mods[index];
    for (const [relative, expected] of Object.entries(source.source_pins as Record<string, string>)) {
        if (hash(fs.readFileSync(relativeFile(goa.root, relative))) !== expected) throw new Error('GoA mutation source changed.');
        if (relative !== 'descriptor.mod' && !source.patch_pins[relative]) {
            let effective: string | undefined = relativeFile(goa.root, relative);
            for (const mod of mods.slice(index + 1)) {
                if (mod.replaced.some(prefix => relative === prefix || relative.startsWith(prefix.replace(/\/$/, '') + '/'))) effective = undefined;
                const candidate = relativeFile(mod.root, relative);
                if (fs.existsSync(candidate)) effective = candidate;
            }
            if (!effective || hash(fs.readFileSync(effective)) !== expected) throw new Error('A supporting GoA mutation definition changed.');
        }
    }
    const basePins = source.base_source_pins as Record<string, string> | undefined;
    if (basePins && Object.keys(basePins).length) {
        if (!installation) throw new Error('The current game source is required for lore duel callbacks.');
        const game = ck3GameDirectory(installation);
        for (const [relative, expected] of Object.entries(basePins)) {
            if (hash(fs.readFileSync(relativeFile(game, relative))) !== expected) throw new Error('Base-game lore callback changed.');
            for (const mod of mods) {
                const candidate = relativeFile(mod.root, relative);
                if (fs.existsSync(candidate)) {
                    const actual = hash(fs.readFileSync(candidate));
                    if (actual !== expected && actual !== source.patch_pins[relative])
                        throw new Error('An active mod changes the required base-game callback.');
                }
            }
        }
    }
    for (const [relative, expected] of Object.entries(source.patch_pins as Record<string, string>)) {
        let effective: string | undefined;
        for (const mod of mods.slice(index)) {
            if (mod.replaced.some(prefix => relative === prefix || relative.startsWith(prefix.replace(/\/$/, '') + '/'))) effective = undefined;
            const candidate = relativeFile(mod.root, relative);
            if (fs.existsSync(candidate)) {
                const original = source.source_pins[relative];
                const actual = hash(fs.readFileSync(candidate));
                if (original && actual !== original && actual !== expected)
                    throw new Error('Another active mod changes a copied GoA story file.');
                effective = candidate;
            }
        }
        if (!effective || hash(fs.readFileSync(effective)) !== expected) throw new Error('The active GoA lore mutation patch differs.');
    }
    // A same-ID definition in a different file is also an override; exact
    // selected-file hashes alone would miss that form of later modification.
    const allDefinitions = [...source.points, ...(source.auxiliary_definitions ?? [])];
    const definitions = new Map<string, string>(allDefinitions.map((p: any) => [p.definition, p.path]));
    const baseDefinitions = new Map<string, string>(allDefinitions.filter((p: any) => p.source_origin === 'base_game').map((p: any) => [p.definition, p.path]));
    const expressions = new Map<Map<string, string>, RegExp>();
    for (const expected of [definitions, baseDefinitions]) if (expected.size)
        expressions.set(expected, new RegExp('^\\s*(?:scripted_effect\\s+)?(?:' + [...expected.keys()].map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\s*=\\s*\\{', 'm'));
    const scan = (root: string, prefix: string, expected: Map<string, string>): void => {
        const directory = path.join(root, prefix);
        if (!fs.existsSync(directory)) return;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const relative = prefix + '/' + entry.name;
            if (entry.isDirectory()) scan(root, relative, expected);
            else if (entry.isFile() && entry.name.endsWith('.txt')) {
                const content = fs.readFileSync(path.join(root, relative), 'utf8');
                if (!expressions.get(expected)?.test(content)) continue;
                for (const node of parseCk3Script(content))
                    if (node.key && expected.has(node.key) && expected.get(node.key) !== relative)
                        throw new Error('A later mod overrides a lore mutation definition.');
            }
        }
    };
    for (let layer = 0; layer < mods.length; layer++) {
        if (layer === index) continue;
        const expected = layer > index ? definitions : baseDefinitions;
        if (!expected.size) continue;
        for (const prefix of ['events', 'common/decisions', 'common/scripted_effects']) scan(mods[layer].root, prefix, expected);
    }
    return source;
}

let config: Config | undefined;
let flush: (() => void) | undefined;
let reader: LoreMutationLogReader | undefined;
let checkedAt = 0;
let configurationBinding = '';
const configurationKey = (value: Config): string => JSON.stringify([
    value.userFolderPath, value.cultureGameInstallPath, value.goaLoreEnabled, value.lorebookEnabled,
]);
const bindings = new WeakMap<Character, { reader: LoreMutationLogReader; epoch: number; revision: number; value: LoreMutationSnapshot }>();

export function configureLoreMutationCapture(configuration: Config, flushLog?: () => void): void {
    config = configuration; flush = flushLog; reader = undefined; checkedAt = Date.now();
    configurationBinding = configurationKey(configuration);
    if (!configuration.userFolderPath || configuration.goaLoreEnabled === false || configuration.lorebookEnabled === false) return;
    try {
        const catalogue = loadLoreMutationCatalog(configuration.userFolderPath, policyPath, bundlePath, configuration.cultureGameInstallPath);
        if (catalogue) reader = new LoreMutationLogReader(catalogue);
    } catch { /* Stale/unsupported patches withdraw automatic access. Ordinary RP remains available. */ }
}
export function currentLoreMutationCatalog(): LoreMutationCatalog | undefined {
    return config && configurationKey(config) === configurationBinding ? reader?.catalog : undefined;
}
export function observeLoreMutationLine(line: string): void { reader?.observeLine(line); }
export function clearLoreMutationObservations(): void { reader?.clear(); }
export function bindLoreMutationDependencies(character: Character, value: LoreMutationSnapshot, tokens: Set<string>): void {
    if (reader?.observations.get(character.id) === value) reader.setDependencies(character.id, tokens);
}
export function getVerifiedLoreMutationSnapshot(character: Character): LoreMutationSnapshot | undefined {
    if (!reader || !config || config.goaLoreEnabled === false || config.lorebookEnabled === false) return;
    if (configurationKey(config) !== configurationBinding) { configureLoreMutationCapture(config, flush); return; }
    if (Date.now() - checkedAt > 5000) {
        checkedAt = Date.now();
        try {
            if (loadLoreMutationCatalog(config.userFolderPath, policyPath, bundlePath, config.cultureGameInstallPath)?.digest !== reader.catalog.digest) {
                configureLoreMutationCapture(config, flush); return;
            }
        } catch { configureLoreMutationCapture(config, flush); return; }
    }
    flush?.();
    const current = reader.observations.get(character.id);
    const revision = reader.revisions.get(character.id) ?? 0, previous = bindings.get(character);
    const value = current && Date.now() - (reader.seenAt.get(character.id) ?? 0) <= 15000 ? current :
        previous?.reader === reader && previous.epoch === reader.epoch && previous.revision === revision ? previous.value : undefined;
    if (!value) return;
    bindings.set(character, { reader, epoch: reader.epoch, revision, value });
    return value;
}
