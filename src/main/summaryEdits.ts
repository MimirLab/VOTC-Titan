import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { conversationSummaryIdentity, normalizeDiarySummaries } from './summaryRecords';
export type SummaryKind = 'conversations' | 'letters' | 'diaries';
const folders = { conversations: 'conversation_summaries', letters: 'letter_summaries', diaries: 'diary_summaries' };
const key = (row: any) => JSON.stringify(Object.entries(row).filter(([name]) => !['characterName','_editorId'].includes(name)).sort(([a], [b]) => a.localeCompare(b)));
type Location = { file: string; index: number; row: any };
type Receipt = { dir: string; dirs: string[]; hash: string; groups: Map<string, Location[]> };
/** Receipts bind displayed records to their actual source files, including duplicate copies. */
export class SummaryEdits {
    private receipts = new Map<string, Receipt>();
    constructor(private root: string) {}
    private directory(player: string, kind: SummaryKind): string {
        if (!/^\d+$/.test(player) || !folders[kind]) throw new Error('Invalid summary owner.');
        return path.join(this.root, folders[kind], player);
    }
    private files(dirs: string[]): string[] {
        return dirs.flatMap(dir => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f)).sort().map(f => path.join(dir,f)) : []);
    }
    private hash(dirs: string[]): string {
        const digest = createHash('sha256');
        for (const dir of dirs) digest.update(dir).update('\0');
        for (const file of this.files(dirs)) digest.update(file).update('\0').update(fs.readFileSync(file)).update('\0');
        return digest.digest('hex');
    }
    private rows(file: string, kind: SummaryKind): any[] {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (kind === 'diaries') return normalizeDiarySummaries(value, path.basename(file,'.json'), true);
        if (!Array.isArray(value)) throw new Error('Invalid summary file.');
        return value;
    }
    async read(player: string, kind: SummaryKind, load: () => Promise<any[]>, sources?: string[]): Promise<{ data: any[]; revision: string }> {
        const dir = this.directory(player, kind), dirs = [...new Set(sources ?? [dir])], before = this.hash(dirs);
        const loaded = await load();
        if (!Array.isArray(loaded) || this.hash(dirs) !== before) throw new Error('Summaries changed while loading. Refresh and try again.');
        const locations = this.files(dirs).flatMap(file => this.rows(file, kind).map((row,index) => ({file,index,row:{...row,characterId:path.basename(file,'.json')}})));
        const identity = (row: any) => kind === 'conversations' ? conversationSummaryIdentity(row,String(row.characterId)) : key(row);
        const groups = new Map<string,Location[]>();
        const data = loaded.map(row => {
            const id = randomUUID(), matches = locations.filter(loc => identity(loc.row) === identity(row));
            if (!matches.length) throw new Error('A displayed summary has no source record. Refresh before editing.');
            groups.set(id,matches); return {...row,_editorId:id};
        });
        const revision = randomUUID(); this.receipts.set(revision,{dir,dirs,hash:before,groups});
        if (this.receipts.size > 100) this.receipts.delete(this.receipts.keys().next().value!);
        return {data,revision};
    }
    save(player: string, kind: SummaryKind, data: any[], revision: string): { success: true; data: any[] } {
        const dir = this.directory(player, kind), receipt = this.receipts.get(revision);
        if (!receipt || receipt.dir !== dir || receipt.hash !== this.hash(receipt.dirs))
            throw new Error('Summaries changed since this editor loaded. Refresh before saving; your edits have been retained.');
        if (!Array.isArray(data)) throw new Error('Invalid summaries.');
        const updates = new Map<string,any>(), additions: any[] = [], ids = new Set<string>();
        const result = data.map(input => {
            if (!/^\d+$/.test(String(input.characterId))) throw new Error('Invalid summary character.');
            const id = input._editorId || randomUUID();
            if (ids.has(id)) throw new Error('Duplicate summary editor identity.'); ids.add(id);
            const locations = receipt.groups.get(id);
            if (input._editorId && !locations) throw new Error('Unknown summary editor identity.');
            if (locations && String(input.characterId) !== String(locations[0].row.characterId)) throw new Error('Summary character changed.');
            const row = {...input,_editorId:id};
            if (locations) updates.set(id,row); else additions.push(row);
            return row;
        });
        const owned = new Map<string,string>();
        for (const [id,locations] of receipt.groups) for (const loc of locations) owned.set(loc.file+'\0'+loc.index,id);
        const planned = new Map<string,any[]>(), nextGroups = new Map<string,Location[]>();
        const append = (file: string, row: any, id?: string) => {
            const rows = planned.get(file) ?? []; planned.set(file,rows);
            const {characterId,characterName,_editorId,...record} = row;
            const index = rows.length; rows.push(record);
            if (id) nextGroups.set(id,[...(nextGroups.get(id)??[]),{file,index,row:{...record,characterId:path.basename(file,'.json')}}]);
        };
        for (const file of this.files(receipt.dirs)) {
            planned.set(file,[]);
            this.rows(file,kind).forEach((original,index) => {
                const id = owned.get(file+'\0'+index);
                if (!id) { append(file,original); return; } // Hidden branch record.
                const update = updates.get(id); if (!update) return; // Explicit deletion, including duplicate copies.
                // Identity, lineage and all other hidden metadata come from the source.
                const row = {...original};
                for (const name of ['content','summary','date']) if (name in update) row[name]=update[name];
                append(file,row,id);
            });
        }
        for (const row of additions) append(path.join(receipt.dirs[0],row.characterId+'.json'),row,row._editorId);
        // Prepare every file before publishing any change. Restore prior bytes on a failed commit.
        const originals = new Map<string,Buffer|undefined>(), temporary: string[] = [];
        try {
            for (const [file,rows] of planned) {
                originals.set(file,fs.existsSync(file)?fs.readFileSync(file):undefined);
                fs.mkdirSync(path.dirname(file),{recursive:true});
                const temp=file+'.editor-'+randomUUID(); temporary.push(temp);
                fs.writeFileSync(temp,JSON.stringify(rows,null,'\t'),'utf8');
            }
            let index=0; for (const file of planned.keys()) fs.renameSync(temporary[index++],file);
        } catch (error) {
            for (const [file,bytes] of originals) {
                if (bytes !== undefined) fs.writeFileSync(file,bytes); else fs.rmSync(file,{force:true});
            }
            throw error;
        } finally { for (const temp of temporary) fs.rmSync(temp,{force:true}); }
        receipt.hash=this.hash(receipt.dirs); receipt.groups=nextGroups;
        return {success:true,data:result};
    }
}
