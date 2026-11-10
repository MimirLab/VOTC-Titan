import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { CompactedMemory } from '../shared/compactionTypes';
import { app } from 'electron';

// IMPORTANT: Key must be 32 bytes for AES-256
const ENCRYPTION_KEY = process.env.COMPACTION_ENCRYPTION_KEY || 'a_default_32_byte_encryption_key';
const IV_LENGTH = 16;
const DATA_DIR = path.join(app.getPath('userData'), 'votc_data', 'memories_compacted');

interface MemoryTransaction {
    version: 1;
    entries: { owner: string; stage: string; backup: string; originalHash?: string; newHash: string }[];
}
const digest = (data: string | Buffer): string => crypto.createHash('sha256').update(data).digest('hex');
const safeId = (id: string): string => {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid compacted-memory owner');
    return id;
};

class CompactedMemoryStore {
    public migrateDataDirectory(): void {
        const oldDataDir = path.join(app.getPath('userData'), 'votc_data', 'compacted_memory');
        if (fs.existsSync(oldDataDir) && !fs.existsSync(DATA_DIR)) {
            try {
                fs.renameSync(oldDataDir, DATA_DIR);
                console.log(`Migrated memory directory from 'compacted_memory' to 'memories_compacted'.`);
            } catch (error) {
                console.error('Failed to migrate compacted memory directory:', error);
            }
        }
    }

    public initializeStorage(): void {
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
                console.log(`Created compacted memory directory at: ${DATA_DIR}`);
            }
        } catch (error) {
            console.error('Failed to create compacted memory directory:', error);
        }
    }

    /**
     * Saves compacted memory to disk with encryption.
     * Returns timing metrics for serialization and disk write.
     */
    public async saveCompactedMemory(
        playerId: string,
        characterId: string,
        memories: CompactedMemory[]
    ): Promise<{ serializationTimeMs: number; diskWriteTimeMs: number }> {
        return this.saveCompactedMemoryBatch(playerId, new Map([[characterId, memories]]));
    }

    /** Read, transform and publish without an event-loop yield so overlapping encounters preserve one another's records. */
    public async updateCompactedMemoryBatch(playerId: string,
        owners: ReadonlyMap<string, (current: CompactedMemory[]) => CompactedMemory[]>):
        Promise<{ serializationTimeMs: number; diskWriteTimeMs: number; memories: Map<string, CompactedMemory[]> }> {
        const playerDir = path.join(DATA_DIR, safeId(playerId));
        this.recover(playerDir);
        const memories = new Map<string, CompactedMemory[]>();
        for (const [owner, transform] of owners) {
            const file = path.join(playerDir, safeId(owner) + '.json');
            const current = fs.existsSync(file) ? JSON.parse(this.decrypt(fs.readFileSync(file, 'utf8'))) : [];
            if (!Array.isArray(current)) throw new Error('Invalid compacted-memory owner file');
            memories.set(owner, transform(current));
        }
        // saveCompactedMemoryBatch is synchronous through its atomic commit; awaiting happens only afterward.
        const result = await this.saveCompactedMemoryBatch(playerId, memories);
        return { ...result, memories };
    }

    /** Stage every owner's encrypted file before publishing any of them; recover interrupted commits on read. */
    public async saveCompactedMemoryBatch(playerId: string, owners: ReadonlyMap<string, CompactedMemory[]>):
        Promise<{ serializationTimeMs: number; diskWriteTimeMs: number }> {
        const playerDir = path.join(DATA_DIR, safeId(playerId));
        fs.mkdirSync(playerDir, { recursive: true, mode: 0o700 });
        this.recover(playerDir);
        const started = Date.now();
        const encrypted = [...owners].map(([owner, memories]) => ({ owner: safeId(owner), data: this.encrypt(JSON.stringify(memories, null, 2)) }));
        const serializationTimeMs = Date.now() - started;
        if (!encrypted.length) return { serializationTimeMs, diskWriteTimeMs: 0 };
        const writeStart = Date.now(), token = crypto.randomUUID(), created: string[] = [];
        const transaction: MemoryTransaction = { version: 1, entries: [] };
        const journal = path.join(playerDir, '.compaction-transaction');
        const writeNew = (name: string, data: string | Buffer) => {
            const file = path.join(playerDir, name), fd = fs.openSync(file, 'wx', 0o600);
            created.push(file);
            try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        };
        try {
            for (const { owner, data } of encrypted) {
                const stage = `.compaction-${token}-${owner}.stage`, backup = `.compaction-${token}-${owner}.backup`;
                const target = path.join(playerDir, owner + '.json');
                const original = fs.existsSync(target) ? fs.readFileSync(target) : undefined;
                writeNew(stage, data);
                if (original !== undefined) writeNew(backup, original);
                transaction.entries.push({ owner, stage, backup, originalHash: original === undefined ? undefined : digest(original), newHash: digest(data) });
            }
            const stagedJournal = `.compaction-${token}.journal`;
            writeNew(stagedJournal, JSON.stringify(transaction));
            fs.renameSync(path.join(playerDir, stagedJournal), journal);
            this.syncDirectory(playerDir);
            for (const entry of transaction.entries) fs.renameSync(path.join(playerDir, entry.stage), path.join(playerDir, entry.owner + '.json'));
            this.syncDirectory(playerDir);
            fs.unlinkSync(journal); // Commit point; all published files are complete.
        } catch (error) {
            if (fs.existsSync(journal)) {
                try { this.recover(playerDir); }
                catch (recovery) { throw Object.assign(new Error('Compacted-memory recovery is pending; history retained'), { errors: [error, recovery] }); }
            }
            for (const file of created) if (fs.existsSync(file)) fs.unlinkSync(file);
            throw error;
        }
        // Cleanup cannot turn a complete commit into a reported failed operation.
        for (const file of created) {
            try { if (fs.existsSync(file)) fs.unlinkSync(file); }
            catch { console.warn('A completed compacted-memory transaction retained a temporary backup.'); }
        }
        try { this.syncDirectory(playerDir); } catch { /* Complete files and canonical history remain available. */ }
        return { serializationTimeMs, diskWriteTimeMs: Date.now() - writeStart };
    }

    private syncDirectory(directory: string): void {
        const fd = fs.openSync(directory, 'r');
        try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }

    /** The journal contains filenames/hashes only; backups remain encrypted in the existing format. */
    private recover(playerDir: string): void {
        const journal = path.join(playerDir, '.compaction-transaction');
        if (!fs.existsSync(journal)) return;
        const transaction: MemoryTransaction = JSON.parse(fs.readFileSync(journal, 'utf8'));
        if (transaction.version !== 1 || !Array.isArray(transaction.entries) || !transaction.entries.length)
            throw new Error('Invalid compacted-memory transaction');
        // Validate all filenames before touching any owner's data.
        for (const entry of transaction.entries) {
            safeId(entry.owner);
            if (!/^\.compaction-[a-f0-9-]+-[A-Za-z0-9_-]+\.stage$/.test(entry.stage) ||
                !/^\.compaction-[a-f0-9-]+-[A-Za-z0-9_-]+\.backup$/.test(entry.backup) ||
                entry.stage.replace(/\.stage$/, '.backup') !== entry.backup ||
                !entry.stage.endsWith(`-${entry.owner}.stage`) || !/^[a-f0-9]{64}$/.test(entry.newHash) ||
                (entry.originalHash !== undefined && !/^[a-f0-9]{64}$/.test(entry.originalHash)))
                throw new Error('Invalid compacted-memory transaction entry');
        }
        for (const entry of transaction.entries) {
            const target = path.join(playerDir, entry.owner + '.json'), backup = path.join(playerDir, entry.backup);
            const currentHash = fs.existsSync(target) ? digest(fs.readFileSync(target)) : undefined;
            if (currentHash !== undefined && currentHash !== entry.newHash && currentHash !== entry.originalHash)
                throw new Error('Compacted-memory file changed outside the pending transaction');
            if (entry.originalHash !== undefined) {
                if (fs.existsSync(backup)) {
                    if (digest(fs.readFileSync(backup)) !== entry.originalHash) throw new Error('Compacted-memory backup changed');
                    fs.renameSync(backup, target);
                } else if (currentHash !== entry.originalHash) throw new Error('Compacted-memory backup is unavailable');
            } else if (fs.existsSync(target)) fs.unlinkSync(target);
        }
        this.syncDirectory(playerDir);
        fs.unlinkSync(journal);
        for (const entry of transaction.entries) for (const name of [entry.stage, entry.backup]) {
            const file = path.join(playerDir, name);
            if (fs.existsSync(file)) fs.unlinkSync(file);
        }
        this.syncDirectory(playerDir);
    }

    /**
     * Reads compacted memory from disk with decryption.
     * Returns both the memories and disk read timing metrics.
     */
    public async readCompactedMemory(
        playerId: string,
        characterId: string,
        currentGameDate?: string
    ): Promise<{ memories: CompactedMemory[]; diskReadTimeMs: number }> {
        const playerDir = path.join(DATA_DIR, safeId(playerId));
        this.recover(playerDir);
        const filePath = path.join(playerDir, `${safeId(characterId)}.json`);

        if (!fs.existsSync(filePath)) {
            return { memories: [], diskReadTimeMs: 0 };
        }

        try {
            const readStart = Date.now();
            const encryptedContent = fs.readFileSync(filePath, 'utf8');
            const diskReadTimeMs = Date.now() - readStart;

            if (!encryptedContent) {
                return { memories: [], diskReadTimeMs };
            }
            const decryptedContent = this.decrypt(encryptedContent);
            let memories = JSON.parse(decryptedContent) as CompactedMemory[];

            if (currentGameDate) {
                memories = memories.filter(memory => !memory.gameDate || memory.gameDate <= currentGameDate);
            }

            return { memories, diskReadTimeMs };
        } catch (error) {
            console.error(`Failed to read or decrypt compacted memory for character ${characterId}:`, error);
            return { memories: [], diskReadTimeMs: 0 };
        }
    }

    /**
     * Gets all compacted memories across characters for a player.
     * Returns both the aggregated memories and cumulative disk read timing.
     */
    public async getAllCompactedMemories(
        playerId: string,
        currentGameDate?: string
    ): Promise<{ memories: CompactedMemory[]; cumulativeDiskReadMs: number }> {
        const playerDir = path.join(DATA_DIR, safeId(playerId));
        this.recover(playerDir);

        if (!fs.existsSync(playerDir)) {
            return { memories: [], cumulativeDiskReadMs: 0 };
        }

        try {
            const allMemories: CompactedMemory[] = [];
            let cumulativeDiskReadMs = 0;
            const files = fs.readdirSync(playerDir);

            for (const file of files) {
                if (path.extname(file) === '.json') {
                    const characterId = path.basename(file, '.json');
                    const result = await this.readCompactedMemory(playerId, characterId, currentGameDate);
                    allMemories.push(...result.memories);
                    cumulativeDiskReadMs += result.diskReadTimeMs;
                }
            }
            return { memories: allMemories, cumulativeDiskReadMs };
        } catch (error) {
            console.error(`Failed to get all compacted memories for player ${playerId}:`, error);
            return { memories: [], cumulativeDiskReadMs: 0 };
        }
    }

    private encrypt(text: string): string {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    }

    private decrypt(text: string): string {
        try {
            const textParts = text.split(':');
            if (textParts.length !== 2) throw new Error('Invalid encrypted text format');
            const iv = Buffer.from(textParts.shift()!, 'hex');
            const encryptedText = Buffer.from(textParts.join(':'), 'hex');
            const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
            let decrypted = decipher.update(encryptedText);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            return decrypted.toString();
        } catch (error) {
            console.error('Decryption failed:', error);
            return '';
        }
    }
}

export const compactedMemoryStore = new CompactedMemoryStore();
