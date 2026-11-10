import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { randomUUID, randomInt } from 'crypto';
import { VoiceProfile } from '../../shared/audio';
import type { CastingChoices } from './acousticCasting';
import { CloneBank, verifyCloneProfile } from './CloneBanks';
import { VoiceDevelopment, validVoiceStyle } from './voiceDevelopment';
import { recordedChildhood } from './maturation';

export class AudioLibrary {
    private db: Database.Database;
    constructor(readonly root: string) {
        fs.mkdirSync(root, { recursive: true, mode: 0o700 });
        this.db = new Database(path.join(root, 'voices.sqlite'));
        this.db.pragma('journal_mode = WAL');
        this.db.exec(`CREATE TABLE IF NOT EXISTS voices (
            id TEXT PRIMARY KEY, campaign TEXT NOT NULL, character_id TEXT NOT NULL, revision INTEGER NOT NULL,
            label TEXT NOT NULL, instruction TEXT NOT NULL, seed INTEGER NOT NULL, reference_file TEXT,
            reference_text TEXT, provenance TEXT NOT NULL, created_at TEXT NOT NULL,
            UNIQUE(campaign, character_id, revision));
            CREATE TABLE IF NOT EXISTS codec_bindings (voice_id TEXT NOT NULL, revision INTEGER NOT NULL,
            runtime TEXT NOT NULL, model TEXT NOT NULL, remote_id TEXT NOT NULL,
            PRIMARY KEY(voice_id, revision, runtime, model));`);
        this.db.exec(`CREATE TABLE IF NOT EXISTS delivery_plans (campaign TEXT NOT NULL, player_id TEXT NOT NULL,
            message_id TEXT NOT NULL, digest TEXT NOT NULL, plan TEXT NOT NULL,
            PRIMARY KEY(campaign, player_id, message_id));`);
        this.db.exec(`CREATE TABLE IF NOT EXISTS casting_choices (campaign TEXT NOT NULL, character_id TEXT NOT NULL, choices TEXT NOT NULL,
            PRIMARY KEY(campaign, character_id));
            CREATE TABLE IF NOT EXISTS voice_forms (campaign TEXT NOT NULL, character_id TEXT NOT NULL, form_key TEXT NOT NULL, voice_id TEXT NOT NULL,
            PRIMARY KEY(campaign, character_id, form_key));
            CREATE TABLE IF NOT EXISTS reference_metadata (voice_id TEXT PRIMARY KEY, metadata TEXT NOT NULL);`);
        this.db.exec('CREATE TABLE IF NOT EXISTS active_voices (campaign TEXT NOT NULL, character_id TEXT NOT NULL, voice_id TEXT NOT NULL, PRIMARY KEY(campaign, character_id));');
        this.db.exec('CREATE TABLE IF NOT EXISTS clone_banks (campaign TEXT NOT NULL, character_id TEXT NOT NULL, bank_key TEXT NOT NULL, manifest_hash TEXT NOT NULL, PRIMARY KEY(campaign, character_id));');
        this.db.exec(`CREATE TABLE IF NOT EXISTS voice_revisions (campaign TEXT NOT NULL, character_id TEXT NOT NULL, revision INTEGER NOT NULL,
            PRIMARY KEY(campaign, character_id));
            INSERT OR IGNORE INTO voice_revisions SELECT campaign,character_id,MAX(revision) FROM voices GROUP BY campaign,character_id;`);
        this.db.exec('CREATE TABLE IF NOT EXISTS clone_preferences (campaign TEXT NOT NULL, character_id TEXT NOT NULL, mode TEXT NOT NULL, PRIMARY KEY(campaign, character_id));');
        this.db.exec('CREATE TABLE IF NOT EXISTS voice_development (voice_id TEXT PRIMARY KEY, state TEXT NOT NULL);');
        fs.chmodSync(path.join(root, 'voices.sqlite'), 0o600);
    }
    get(campaign: string, characterId: string): VoiceProfile | undefined {
        const active = this.db.prepare('SELECT voice_id FROM active_voices WHERE campaign=? AND character_id=?').get(campaign, characterId) as any;
        if (active) { const profile = this.byId(active.voice_id); if (profile) return profile; }
        return this.map(this.db.prepare('SELECT * FROM voices WHERE campaign=? AND character_id=? ORDER BY revision DESC LIMIT 1').get(campaign, characterId));
    }
    activate(profile: VoiceProfile): void {
        this.db.prepare('INSERT OR REPLACE INTO active_voices VALUES (?,?,?)').run(profile.campaign, profile.characterId, profile.id);
    }
    list(campaign?: string): VoiceProfile[] {
        const rows = campaign === undefined ? this.db.prepare('SELECT * FROM voices ORDER BY created_at DESC').all()
            : this.db.prepare('SELECT * FROM voices WHERE campaign=? ORDER BY created_at DESC').all(campaign);
        return rows.map(row => this.map(row)!);
    }
    byId(id: string): VoiceProfile | undefined { return this.map(this.db.prepare('SELECT * FROM voices WHERE id=?').get(id)); }
    rename(id: string, label: string): void {
        if (typeof label !== 'string' || !label.trim() || label.trim().length > 100) throw new Error('Enter a voice name between 1 and 100 characters.');
        if (!this.byId(id)) throw new Error('This voice was deleted. Refresh Audio.');
        this.db.prepare('UPDATE voices SET label=? WHERE id=?').run(label.trim(), id);
    }
    delete(id: string): void {
        const profile = this.byId(id); if (!profile) throw new Error('This voice was deleted. Refresh Audio.');
        this.db.transaction(() => {
            const forms = this.db.prepare('SELECT form_key FROM voice_forms WHERE voice_id=?').all(id) as { form_key: string }[];
            this.db.prepare('DELETE FROM codec_bindings WHERE voice_id=?').run(id);
            this.db.prepare('DELETE FROM reference_metadata WHERE voice_id=?').run(id);
            this.db.prepare('DELETE FROM voice_development WHERE voice_id=?').run(id);
            this.db.prepare('DELETE FROM voice_forms WHERE voice_id=?').run(id);
            this.db.prepare('DELETE FROM active_voices WHERE voice_id=?').run(id);
            this.db.prepare('DELETE FROM voices WHERE id=?').run(id);
            const fallback = this.get(profile.campaign, profile.characterId); if (fallback) this.activate(fallback);
            for (const form of forms) {
                const earlier = this.list(profile.campaign).find(voice => {
                    if (voice.characterId !== profile.characterId) return false;
                    try { return JSON.parse(voice.provenance).casting?.formKey === form.form_key; } catch { return false; }
                });
                if (earlier) this.bindForm(earlier, form.form_key);
            }
            // Keep receipt IDs: deleted historical voices must never silently become another person.
            if (profile.referenceFile) fs.rmSync(profile.referenceFile, { force: true });
        })();
    }
    castingChoice(campaign: string, character: string): CastingChoices {
        const row = this.db.prepare('SELECT choices FROM casting_choices WHERE campaign=? AND character_id=?').get(campaign, character) as any;
        return row ? JSON.parse(row.choices) : {};
    }
    saveCastingChoice(campaign: string, character: string, choices: CastingChoices): void {
        this.db.prepare('INSERT OR REPLACE INTO casting_choices VALUES (?,?,?)').run(campaign, character, JSON.stringify(choices));
    }
    form(campaign: string, character: string, key: string): VoiceProfile | undefined {
        const row = this.db.prepare('SELECT voice_id FROM voice_forms WHERE campaign=? AND character_id=? AND form_key=?').get(campaign, character, key) as any;
        return row ? this.byId(row.voice_id) : undefined;
    }
    bindForm(profile: VoiceProfile, key: string): void {
        this.db.prepare('INSERT OR REPLACE INTO voice_forms VALUES (?,?,?,?)').run(profile.campaign, profile.characterId, key, profile.id);
    }
    savePlan(campaign: string, player: string, message: string, digest: string, plan: object): void {
        this.db.prepare('INSERT OR REPLACE INTO delivery_plans VALUES (?,?,?,?,?)').run(campaign, player, message, digest, JSON.stringify(plan));
    }
    plan(campaign: string, player: string, message: string, digest?: string): any | undefined {
        const row = (digest === undefined ? this.db.prepare('SELECT plan FROM delivery_plans WHERE campaign=? AND player_id=? AND message_id=?').get(campaign, player, message)
            : this.db.prepare('SELECT plan FROM delivery_plans WHERE campaign=? AND player_id=? AND message_id=? AND digest=?').get(campaign, player, message, digest)) as any;
        return row ? JSON.parse(row.plan) : undefined;
    }
    development(profile:VoiceProfile):VoiceDevelopment|undefined {
        const row=this.db.prepare('SELECT state FROM voice_development WHERE voice_id=?').get(profile.id) as any;
        return row?JSON.parse(row.state):undefined;
    }
    heardAsChild(profile:VoiceProfile):boolean {
        const rows=this.db.prepare("SELECT plan FROM delivery_plans WHERE campaign=? AND json_extract(plan,'$.characterVoiceId')=?").all(profile.campaign,profile.id) as {plan:string}[];
        return rows.some(row=>!!recordedChildhood(JSON.parse(row.plan).age??''));
    }
    saveDevelopment(profile:VoiceProfile,state:VoiceDevelopment):void {
        if(!this.byId(profile.id)||!['provisional','adult'].includes(state.phase)||!/^[a-f0-9]{64}$/.test(state.personalityHash)||!validVoiceStyle(state.style))throw new Error('Invalid saved voice development.');
        this.db.prepare('INSERT OR REPLACE INTO voice_development VALUES (?,?)').run(profile.id,JSON.stringify(state));
    }
    /** Publish only a complete adult reference. Failure leaves the provisional identity active and reusable. */
    finalizeAdult(source:VoiceProfile,instruction:string,provenance:string,wav:Buffer,text:string,
        metadata:VoiceProfile['referenceMetadata'],personalityHash:string,formKey?:string):VoiceProfile {
        const state=this.development(source);
        const existing=state?.adultVoiceId?this.byId(state.adultVoiceId):undefined;
        if(existing){this.activate(existing);if(formKey)this.bindForm(existing,formKey);return existing;}
        let created:VoiceProfile|undefined;
        try{return this.db.transaction(()=>{
            created=this.save(source.campaign,source.characterId,source.label,instruction,provenance,false,source.seed);
            created=this.reference(created,wav,text,metadata);
            this.saveDevelopment(created,{phase:'adult',personalityHash,style:''});
            this.saveDevelopment(source,{phase:'provisional',personalityHash:state?.personalityHash??personalityHash,style:state?.style??'',adultVoiceId:created.id});
            if(formKey)this.bindForm(created,formKey);
            return created;
        })();}catch(error){if(created)fs.rmSync(path.join(this.root,created.id+'.wav'),{force:true});throw error;}
    }
    save(campaign: string, characterId: string, label: string, instruction: string, provenance: string, freshSeed = false, seed?: number): VoiceProfile {
        if (!campaign || !characterId || !instruction.trim() || instruction.length > 2400) throw new Error('Invalid voice profile');
        if (seed !== undefined && (!Number.isInteger(seed) || seed < 1 || seed > 2147483646)) throw new Error('Invalid voice seed');
        return this.db.transaction(() => {
            const previous = this.get(campaign, characterId);
            const highest = (this.db.prepare('SELECT revision FROM voice_revisions WHERE campaign=? AND character_id=?').get(campaign, characterId) as any)?.revision ?? 0;
            const profile: VoiceProfile = { id: previous?.id ?? randomUUID(), campaign, characterId, label,
                revision: highest + 1, instruction: instruction.trim(), seed: seed ?? (!freshSeed && previous ? previous.seed : randomInt(1, 2147483647)),
                provenance, createdAt: new Date().toISOString() };
            // Revisions keep their own stable record ids while the seed remains the character's identity seed.
            if (previous) profile.id = randomUUID();
            this.db.prepare('INSERT INTO voices VALUES (@id,@campaign,@characterId,@revision,@label,@instruction,@seed,NULL,NULL,@provenance,@createdAt)').run(profile);
            this.db.prepare('INSERT OR REPLACE INTO voice_revisions VALUES (?,?,?)').run(campaign, characterId, profile.revision);
            this.activate(profile);
            return profile;
        })();
    }
    importNarrator(profile: VoiceProfile, label: string): VoiceProfile {
        if (profile.characterId !== '__narrator__' || !profile.referenceFile || !profile.referenceText)
            throw new Error('Preview this narrator before saving it.');
        const wav = fs.readFileSync(profile.referenceFile);
        let created: VoiceProfile | undefined;
        try {
            return this.db.transaction(() => {
                created = this.save('__global__', '__narrator__', label, profile.instruction, 'Player-authored narrator v2', true, profile.seed);
                return this.reference(created, wav, profile.referenceText!, profile.referenceMetadata);
            })();
        } catch (error) {
            if (created) fs.rmSync(path.join(this.root, created.id + '.wav'), { force: true });
            throw error;
        }
    }
    cloneMode(campaign: string, characterId: string): 'auto' | 'normal' {
        return (this.db.prepare('SELECT mode FROM clone_preferences WHERE campaign=? AND character_id=?').get(campaign, characterId) as any)?.mode === 'normal' ? 'normal' : 'auto';
    }
    setCloneMode(campaign: string, characterId: string, mode: 'auto' | 'normal'): void {
        this.db.prepare('INSERT OR REPLACE INTO clone_preferences VALUES (?,?,?)').run(campaign, characterId, mode);
    }
    cloneBinding(campaign: string, characterId: string): { key: string; manifestHash: string } | undefined {
        const row = this.db.prepare('SELECT bank_key,manifest_hash FROM clone_banks WHERE campaign=? AND character_id=?').get(campaign, characterId) as any;
        return row ? { key: row.bank_key, manifestHash: row.manifest_hash } : undefined;
    }
    bindClone(campaign: string, characterId: string, bank?: CloneBank): void {
        if (bank) this.db.prepare('INSERT OR REPLACE INTO clone_banks VALUES (?,?,?,?)').run(campaign, characterId, bank.key, bank.manifestHash);
        else this.db.prepare('DELETE FROM clone_banks WHERE campaign=? AND character_id=?').run(campaign, characterId);
    }
    importClone(campaign: string, characterId: string, bank: CloneBank): VoiceProfile {
        const provenance = JSON.stringify({ origin: 'clone-bank-v1', key: bank.key, manifestHash: bank.manifestHash,
            audioHash: bank.audioHash, transcriptHash: bank.transcriptHash });
        const previous = this.list(campaign).find(p => p.characterId === characterId && p.provenance === provenance);
        if (previous) { verifyCloneProfile(previous); this.activate(previous); return previous; }
        let created: VoiceProfile | undefined;
        try {
            return this.db.transaction(() => {
                created = this.save(campaign, characterId, bank.name, 'Reference clone: ' + bank.name, provenance, true, bank.seed);
                return this.reference(created, bank.wav, bank.text);
            })();
        } catch (error) { if (created) fs.rmSync(path.join(this.root, created.id + '.wav'), { force: true }); throw error; }
    }
    /** Import a selected family reference atomically, retaining every preceding revision. */
    importFamilyReference(campaign:string,characterId:string,label:string,instruction:string,provenance:string,
        seed:number,wav:Buffer,text:string,formKey:string):VoiceProfile {
        let created:VoiceProfile|undefined;
        try{return this.db.transaction(()=>{
            created=this.save(campaign,characterId,label,instruction,provenance,false,seed);
            const result=this.reference(created,wav,text);this.bindForm(result,formKey);return result;
        })();}catch(error){if(created)fs.rmSync(path.join(this.root,created.id+'.wav'),{force:true});throw error;}
    }
    reference(profile: VoiceProfile, wav: Buffer, text: string, metadata?: VoiceProfile['referenceMetadata']): VoiceProfile {
        if (!wav.length || !text.trim()) throw new Error('Empty voice reference');
        const file = path.join(this.root, `${profile.id}.wav`);
        fs.writeFileSync(file, wav, { mode: 0o600 });
        this.db.prepare('UPDATE voices SET reference_file=?,reference_text=? WHERE id=?').run(`${profile.id}.wav`, text, profile.id);
        if (metadata) this.db.prepare('INSERT OR REPLACE INTO reference_metadata VALUES (?,?)').run(profile.id, JSON.stringify(metadata));
        return { ...profile, referenceFile: file, referenceText: text, ...(metadata ? { referenceMetadata: metadata } : {}) };
    }
    codec(profile: VoiceProfile, runtime: string, model: string): string | undefined {
        return (this.db.prepare('SELECT remote_id FROM codec_bindings WHERE voice_id=? AND revision=? AND runtime=? AND model=?')
            .get(profile.id, profile.revision, runtime, model) as any)?.remote_id;
    }
    bindCodec(profile: VoiceProfile, runtime: string, model: string, remoteId: string): void {
        this.db.prepare('INSERT OR REPLACE INTO codec_bindings VALUES (?,?,?,?,?)').run(profile.id, profile.revision, runtime, model, remoteId);
    }
    close(): void { this.db.close(); }
    private map(row: any): VoiceProfile | undefined {
        const metadata = row ? this.db.prepare('SELECT metadata FROM reference_metadata WHERE voice_id=?').get(row.id) as any : undefined;
        return row ? { id: row.id, campaign: row.campaign, characterId: row.character_id, label: row.label,
            revision: row.revision, instruction: row.instruction, seed: row.seed,
            referenceFile: row.reference_file ? path.join(this.root, path.basename(row.reference_file)) : undefined,
            referenceText: row.reference_text ?? undefined, ...(metadata ? { referenceMetadata: JSON.parse(metadata.metadata) } : {}),
            provenance: row.provenance, createdAt: row.created_at } : undefined;
    }
}
