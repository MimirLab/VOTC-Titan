import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
export type SummaryKind = 'conversations' | 'letters' | 'diaries';
const folders = { conversations: 'conversation_summaries', letters: 'letter_summaries', diaries: 'diary_summaries' };
const key = (row: any) => JSON.stringify(Object.entries(row).filter(([name]) => name !== 'characterName').sort(([a], [b]) => a.localeCompare(b)));
/** Editor receipts authorize only the records displayed by that particular load. */
export class SummaryEdits {
    private receipts = new Map<string, { dir: string; hash: string; visible: Set<string> }>();
    constructor(private root: string) {}
    private directory(player: string, kind: SummaryKind): string {
        if (!/^\d+$/.test(player) || !folders[kind]) throw new Error('Invalid summary owner.');
        return path.join(this.root, folders[kind], player);
    }
    private files(dir: string): string[] {
        return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== '_character_map.json').sort() : [];
    }
    private hash(dir: string): string {
        const digest = createHash('sha256');
        for (const name of this.files(dir)) digest.update(name).update('\0').update(fs.readFileSync(path.join(dir, name))).update('\0');
        return digest.digest('hex');
    }
    async read(player: string, kind: SummaryKind, load: () => Promise<any[]>): Promise<{ data: any[]; revision: string }> {
        const dir = this.directory(player, kind), before = this.hash(dir);
        const data = await load();
        if (!Array.isArray(data) || this.hash(dir) !== before) throw new Error('Summaries changed while loading. Refresh and try again.');
        const revision = randomUUID();
        this.receipts.set(revision, { dir, hash: before, visible: new Set(data.map(key)) });
        // Bound abandoned editor sessions; an expired editor can refresh safely.
        if (this.receipts.size > 100) this.receipts.delete(this.receipts.keys().next().value!);
        return { data, revision };
    }
    save(player: string, kind: SummaryKind, data: any[], revision: string): { success: true } {
        const dir = this.directory(player, kind), receipt = this.receipts.get(revision);
        if (!receipt || receipt.dir !== dir || receipt.hash !== this.hash(dir))
            throw new Error('Summaries changed since this editor loaded. Refresh before saving; your edits have been retained.');
        if (!Array.isArray(data)) throw new Error('Invalid summaries.');
        // Keep records omitted by timeline filtering. Only displayed records can be edited/deleted.
        const preserved: any[] = [];
        for (const name of this.files(dir)) {
            const rows = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
            if (!Array.isArray(rows)) throw new Error('Invalid summary file.');
            for (const row of rows) {
                const full = { ...row, characterId: path.basename(name, '.json') };
                if (!receipt.visible.has(key(full))) preserved.push(full);
            }
        }
        const groups = new Map<string, any[]>();
        for (const row of [...data, ...preserved]) {
            const { characterId, characterName, ...record } = row;
            if (!/^\d+$/.test(String(characterId))) throw new Error('Invalid summary character.');
            if (!groups.has(String(characterId))) groups.set(String(characterId), []);
            groups.get(String(characterId))!.push(record);
        }
        fs.mkdirSync(dir, { recursive: true });
        for (const [id, rows] of groups) {
            const file = path.join(dir, id + '.json'), temp = file + '.editor-tmp';
            fs.writeFileSync(temp, JSON.stringify(rows, null, '\t'), 'utf8');
            fs.renameSync(temp, file);
        }
        for (const name of this.files(dir)) if (!groups.has(path.basename(name, '.json'))) fs.unlinkSync(path.join(dir, name));
        receipt.hash = this.hash(dir); receipt.visible = new Set(data.map(key));
        return { success: true };
    }
}
