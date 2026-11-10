import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { Config } from '../../shared/Config';
import { EmbeddingProvider, EmbeddingProviderType, getEffectiveEmbeddingDimension } from '../../shared/apiConnection';
import { LorebookClient, ChronicleStatus } from './lorebookClient';
export const LORE_EMBEDDING_RECIPE = 'chronicle-breadcrumbs-v2';
export const LORE_QUALIFIED_EMBEDDING_RECIPE = 'chronicle-qualified-breadcrumbs-v1';
export const LORE_SEMANTIC_QUERY_TIMEOUT_MS = 500;
export interface LoreSemanticMatch {id:string;score:number}

export function embeddingBinding(config: Config, edition: string, recipe=LORE_EMBEDDING_RECIPE): string {
    const c = config.embeddingApiConnectionConfig.connection;
    return createHash('sha256').update(JSON.stringify({ edition, recipe, type: c.type, model: c.model,
        baseUrl: c.baseUrl, dimensions: getEffectiveEmbeddingDimension(c), inputType: c.embeddingInputType })).digest('hex');
}
export function unitVector(values: number[], dimensions: number): Float32Array {
    if (values.length !== dimensions || values.some(x => !Number.isFinite(x))) throw new Error('Invalid lore embedding dimensions or values.');
    const norm = Math.sqrt(values.reduce((n, x) => n + x * x, 0));
    if (!norm) throw new Error('Empty lore embedding.');
    return Float32Array.from(values, x => x / norm);
}
export function fuseCandidates(lexical: string[], semantic: string[], limit = 60): string[] {
    const scores = new Map<string, number>();
    for (const list of [lexical, semantic]) list.forEach((id, rank) => scores.set(id, (scores.get(id) || 0) + 1 / (60 + rank)));
    const lexicalRank = (id: string) => lexical.includes(id) ? lexical.indexOf(id) : Number.MAX_SAFE_INTEGER;
    return [...scores].sort((a, b) => b[1] - a[1] || lexicalRank(a[0]) - lexicalRank(b[0]) || a[0].localeCompare(b[0]))
        .slice(0, limit).map(x => x[0]);
}

/** A resumable optional index, separate from character memories and settings. */
export class LorebookVectors {
    private job?: { key: string; stop: boolean; done: number; state: string };
    constructor(private client: LorebookClient) {}
    status(): { state: string; done?: number } { return this.job ? { state: this.job.state, done: this.job.done } : { state: 'Lexical search ready. Semantic indexing has not been started.' }; }
    cancel(): void { if (this.job) this.job.stop = true; }
    private file(data: string, key: string): string { return path.join(data, 'lorebook', 'vectors', key + '.sqlite3'); }
    private provider(config: Config, query = false, qualified=false): EmbeddingProvider {
        const c = config.embeddingApiConnectionConfig.connection;
        return new EmbeddingProvider(c.type as EmbeddingProviderType, c.model, c.baseUrl, c.key,
            getEffectiveEmbeddingDimension(c), query && (qualified||c.embeddingInputType) ? 'query' : c.embeddingInputType??(qualified?'document':undefined));
    }
    async build(config: Config, data: string, edition: ChronicleStatus, qualified=false): Promise<void> {
        if (this.job?.state === 'Building semantic index') throw new Error('Lore indexing is already running.');
        // Freeze the shared connection for this job; changing it never mixes spaces.
        const frozen: Config = JSON.parse(JSON.stringify(config));
        const key = embeddingBinding(frozen, edition.manifest_sha256,qualified?LORE_QUALIFIED_EMBEDDING_RECIPE:undefined);
        const job = this.job = { key, stop: false, done: 0, state: 'Building semantic index' };
        const file = this.file(data, key); fs.mkdirSync(path.dirname(file), { recursive: true });
        const db = new Database(file);
        db.exec('CREATE TABLE IF NOT EXISTS vectors(id TEXT PRIMARY KEY,body_sha256 TEXT NOT NULL,vector BLOB NOT NULL); CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
        const put = db.prepare('INSERT OR REPLACE INTO vectors VALUES(?,?,?)');
        const exists = db.prepare('SELECT body_sha256 FROM vectors WHERE id=?');
        const provider = this.provider(frozen,false,qualified);
        const dimensions = getEffectiveEmbeddingDimension(frozen.embeddingApiConnectionConfig.connection);
        try {
            let after = '';
            for (;;) {
                if (job.stop) break;
                const docs = await this.client.request<any[]>({ op: qualified?'qualified-documents':'documents', after });
                if (!docs.length) {
                    if(qualified){
                        const count=(db.prepare('SELECT count(*) n FROM vectors').get() as any).n;
                        if(count!==edition.authored_qualified)throw new Error('Qualified lore index does not match its edition.');
                        db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('kind','qualified_authored');
                        db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('documents',String(count));
                    }
                    db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('complete', key);
                    job.state = 'Semantic index ready'; break;
                }
                for (const doc of docs) {
                    if (job.stop) break;
                    if ((exists.get(doc.id) as any)?.body_sha256 !== doc.body_sha256) {
                        const vector = unitVector(await provider.embed(doc.embedding_text || doc.title + '\n' + doc.text), dimensions);
                        if (job.stop) break;
                        put.run(doc.id, doc.body_sha256, Buffer.from(vector.buffer));
                    }
                    job.done++; after = doc.id;
                }
            }
            if (job.stop) job.state = 'Index paused; Build semantic index resumes it';
        } catch (error) { job.state = 'Index paused after a provider error; lexical search remains available'; throw error; }
        finally { db.close(); }
    }
    async search(config: Config, data: string, edition: ChronicleStatus, query: string): Promise<string[]> {
        if (!config.embeddingApiConnectionConfig?.connection) return [];
        const key = embeddingBinding(config, edition.manifest_sha256), file = this.file(data, key);
        if (!fs.existsSync(file)) return [];
        const db = new Database(file, { readonly: true });
        try {
            if ((db.prepare('SELECT value FROM metadata WHERE key=?').get('complete') as any)?.value !== key) return [];
            const dim = getEffectiveEmbeddingDimension(config.embeddingApiConnectionConfig.connection);
            const queryVector = unitVector(await this.provider(config, true).embed(query), dim);
            const best: { id: string; score: number }[] = [];
            for (const row of db.prepare('SELECT id,vector FROM vectors').iterate() as Iterable<any>) {
                if (row.vector.length !== dim * 4) throw new Error('The lore index has incompatible vectors.');
                let score = 0;
                for (let i = 0; i < dim; i++) score += queryVector[i] * row.vector.readFloatLE(i * 4);
                if (best.length < 40 || score > best[best.length - 1].score) {
                    best.push({ id: row.id, score }); best.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
                    if (best.length > 40) best.pop();
                }
            }
            return best.map(x => x.id);
        } finally { db.close(); }
    }
    /** Relevance only. The actor-bound resolver still admits every returned body. */
    async rankQualified(config:Config,data:string,edition:ChronicleStatus,query:string):Promise<LoreSemanticMatch[]>{
        if(!query.trim()||!config.embeddingApiConnectionConfig?.connection)return[];
        const frozen:Config=JSON.parse(JSON.stringify(config));
        const key=embeddingBinding(frozen,edition.manifest_sha256,LORE_QUALIFIED_EMBEDDING_RECIPE),file=this.file(data,key);
        if(!fs.existsSync(file))return[];
        const db=new Database(file,{readonly:true});
        try{
            const meta=(name:string)=>(db.prepare('SELECT value FROM metadata WHERE key=?').get(name) as any)?.value;
            if(meta('complete')!==key||meta('kind')!=='qualified_authored'||Number(meta('documents'))!==edition.authored_qualified)return[];
            const records=db.prepare('SELECT id,vector FROM vectors ORDER BY id').all() as any[];
            if(records.length!==edition.authored_qualified)throw new Error('Qualified lore index row count changed.');
            const dim=getEffectiveEmbeddingDimension(frozen.embeddingApiConnectionConfig.connection);
            const vector=unitVector(await this.provider(frozen,true,true).embedOnce(query,AbortSignal.timeout(LORE_SEMANTIC_QUERY_TIMEOUT_MS)),dim);
            if(embeddingBinding(config,edition.manifest_sha256,LORE_QUALIFIED_EMBEDDING_RECIPE)!==key||config.embeddingApiConnectionConfig.connection.key!==frozen.embeddingApiConnectionConfig.connection.key)
                throw new Error('Qualified lore embedding provider changed.');
            const best:LoreSemanticMatch[]=[];
            for(const row of records){
                if(row.vector.length!==dim*4)throw new Error('Qualified lore vectors have incompatible dimensions.');
                let score=0,norm=0;
                for(let i=0;i<dim;i++){
                    const value=row.vector.readFloatLE(i*4);
                    if(!Number.isFinite(value))throw new Error('Qualified lore vector is not finite.');
                    score+=vector[i]*value;norm+=value*value;
                }
                if(Math.abs(norm-1)>.001)throw new Error('Qualified lore vector is not normalized.');
                best.push({id:row.id,score:Math.max(-1,Math.min(1,score))});
            }
            if(best.length>64)throw new Error('Qualified semantic score coverage exceeds its bounded protocol.');
            return best.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
        }finally{db.close();}
    }
    async recall(config:Config,data:string,edition:ChronicleStatus,query:string,qualified=false):Promise<{ids:string[];matches:LoreSemanticMatch[]}>{
        if(qualified){const matches=await this.rankQualified(config,data,edition,query);return{ids:matches.map(row=>row.id),matches};}
        return{ids:await this.search(config,data,edition,query),matches:[]};
    }
}
