import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { canonicalJsonStringify } from '../promptWorkbench/canonicalJson';
import { CULTURE_PROMPT_VERSION, CultureInput, CultureGenerationResult, cultureHash, cultureInput, validateCultureParagraph, validateCultureResult } from './cultureIdentity';

export interface CultureJob { hash: string; input: CultureInput; attempts: number }
interface Row { hash: string; input_json: string; paragraph: string | null; notes_json: string | null; attempts: number }
interface ValidatedParagraph {
    inputJson: string;
    notesJson: string | null;
    paragraph: string;
    currentInput: string;
}

/** Provider/account/campaign-independent library. Only cultural definitions and generated guidance are stored. */
export class CultureLibrary {
    private db: Database.Database;
    private validatedParagraphs = new Map<string, ValidatedParagraph>();
    constructor(filename: string) {
        if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
        this.db = new Database(filename);
        this.db.pragma('busy_timeout = 5000');
        this.db.pragma('journal_mode = WAL');
        const version = this.db.pragma('user_version', { simple: true });
        if (typeof version === 'number' && version > 2) { this.db.close(); throw new Error('Unsupported culture library version'); }
        this.db.exec(`CREATE TABLE IF NOT EXISTS culture_profiles (
            hash TEXT PRIMARY KEY,
            input_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending', 'generating', 'ready', 'failed')),
            paragraph TEXT,
            notes_json TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            retry_at INTEGER NOT NULL DEFAULT 0,
            lease_until INTEGER NOT NULL DEFAULT 0,
            error_code TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );`);
        this.db.transaction(() => {
            const columns = this.db.pragma('table_info(culture_profiles)') as { name: string }[];
            if (!columns.some(c => c.name === 'notes_json')) this.db.exec('ALTER TABLE culture_profiles ADD COLUMN notes_json TEXT');
            this.db.pragma('user_version = 2');
        })();
    }

    encounter(input: CultureInput, now: number): string {
        const normalized = cultureInput(input.snapshot, input.language);
        const hash = cultureHash(normalized);
        this.db.prepare(`INSERT OR IGNORE INTO culture_profiles (hash, input_json, status, created_at, updated_at)
            VALUES (?, ?, 'pending', ?, ?)`).run(hash, canonicalJsonStringify(normalized), now, now);
        return hash;
    }

    ready(hash: string): string | undefined {
        const row = this.db.prepare("SELECT input_json, paragraph, notes_json FROM culture_profiles WHERE hash = ? AND status = 'ready'").get(hash) as Pick<Row, 'input_json' | 'paragraph' | 'notes_json'> | undefined;
        if (!row) { this.validatedParagraphs.delete(hash); return; }
        try {
            const raw = JSON.parse(row.input_json) as CultureInput;
            // Existing v1 rows remain readable by exact hash; new encounters never select those hashes.
            if (raw.version !== 2) { this.validatedParagraphs.delete(hash); return validateCultureParagraph(row.paragraph); }
            if (this.isArchivedRecipe(raw, hash)) { this.validatedParagraphs.delete(hash); return; }
            const input = cultureInput(raw.snapshot, raw.language);
            if (raw.promptVersion !== input.promptVersion || cultureHash(input) !== hash) throw new Error('Invalid cached input');
            // Mutable storage and current recipe identity are checked on every
            // call; only identical deterministic note validation is reused.
            const currentInput = canonicalJsonStringify(input);
            const previous = this.validatedParagraphs.get(hash);
            if (previous && previous.inputJson === row.input_json && previous.notesJson === row.notes_json &&
                previous.paragraph === row.paragraph && previous.currentInput === currentInput) return previous.paragraph;
            const result = validateCultureResult(JSON.parse(row.notes_json ?? 'null'), input);
            if (result.paragraph !== row.paragraph) throw new Error('Cached notes differ from guidance');
            try {
                this.validatedParagraphs.set(hash, { inputJson: row.input_json, notesJson: row.notes_json,
                    paragraph: result.paragraph, currentInput });
                if (this.validatedParagraphs.size > 64) this.validatedParagraphs.delete(this.validatedParagraphs.keys().next().value!);
            } catch { this.validatedParagraphs.delete(hash); }
            return result.paragraph;
        }
        catch {
            this.validatedParagraphs.delete(hash);
            this.db.prepare("UPDATE culture_profiles SET status = 'failed', paragraph = NULL, retry_at = 0, error_code = 'invalid_result' WHERE hash = ?").run(hash);
            return;
        }
    }

    state(hash: string): 'pending' | 'generating' | 'ready' | 'failed' | undefined {
        return (this.db.prepare('SELECT status FROM culture_profiles WHERE hash = ?').get(hash) as { status: 'pending' | 'generating' | 'ready' | 'failed' } | undefined)?.status;
    }

    /** A persisted expiring lease supports crash recovery and concurrent readers. */
    claim(hash: string, now: number): CultureJob | undefined {
        return this.db.transaction(() => {
            const previous = this.db.prepare('SELECT input_json FROM culture_profiles WHERE hash = ?').get(hash) as Pick<Row, 'input_json'> | undefined;
            if (!previous) return;
            try {
                if (this.isArchivedRecipe(JSON.parse(previous.input_json), hash)) return;
            } catch { /* Invalid inputs follow the existing failure path below. */ }
            const changed = this.db.prepare(`UPDATE culture_profiles SET status = 'generating', attempts = attempts + 1,
                lease_until = ?, updated_at = ? WHERE hash = ? AND
                ((status IN ('pending', 'failed') AND retry_at <= ?) OR (status = 'generating' AND lease_until <= ?))`)
                .run(now + 180_000, now, hash, now, now);
            if (!changed.changes) return;
            const row = this.db.prepare('SELECT hash, input_json, paragraph, attempts FROM culture_profiles WHERE hash = ?').get(hash) as Row;
            try {
                const raw = JSON.parse(row.input_json) as CultureInput;
                const input = cultureInput(raw.snapshot, raw.language);
                if (raw.version !== input.version || raw.promptVersion !== input.promptVersion || cultureHash(input) !== hash)
                    throw new Error('Invalid cached cultural input');
                return { hash, input, attempts: row.attempts };
            } catch {
                this.db.prepare("UPDATE culture_profiles SET status = 'failed', lease_until = 0, retry_at = ?, error_code = 'invalid_input' WHERE hash = ?")
                    .run(now + 86_400_000, hash);
                return;
            }
        })();
    }

    /** Another recipe is an archive, not corruption. Never serve or lease it with this recipe. */
    private isArchivedRecipe(raw: CultureInput, hash: string): boolean {
        if (!raw || raw.version !== 2 || typeof raw.language !== 'string' ||
            !Number.isSafeInteger(raw.promptVersion) || raw.promptVersion <= 0 ||
            Object.keys(raw).some(key => !['version', 'promptVersion', 'language', 'snapshot', 'ingredientRevision'].includes(key)) ||
            raw.ingredientRevision !== undefined && !/^[a-f0-9]{64}$/u.test(raw.ingredientRevision)) return false;
        const current = cultureInput(raw.snapshot, raw.language);
        if (raw.promptVersion === current.promptVersion && raw.ingredientRevision === current.ingredientRevision) return false;
        // Self-consistent old recipe/ingredient revisions are history, never corruption.
        // Normalization still rejects malformed snapshots and non-anonymous extra fields.
        return cultureHash(raw) === hash && canonicalJsonStringify(raw.snapshot) === canonicalJsonStringify(current.snapshot);
    }

    finish(job: CultureJob, result: CultureGenerationResult, now: number): void {
        const validated = validateCultureResult({ notes: result.notes }, job.input);
        if (validated.paragraph !== result.paragraph) throw new Error('Cultural result differs from its notes');
        this.db.prepare(`UPDATE culture_profiles SET status = 'ready', paragraph = ?, notes_json = ?, lease_until = 0,
            error_code = NULL, updated_at = ? WHERE hash = ? AND status = 'generating' AND attempts = ?`)
            .run(validated.paragraph, canonicalJsonStringify({ notes: validated.notes }), now, job.hash, job.attempts);
    }

    fail(job: CultureJob, now: number, interrupted = false): void {
        const delay = interrupted ? 1000 : Math.min(3_600_000, 60_000 * 2 ** Math.min(job.attempts - 1, 6));
        this.db.prepare(`UPDATE culture_profiles SET status = ?, paragraph = NULL, lease_until = 0,
            retry_at = ?, error_code = ?, updated_at = ? WHERE hash = ? AND status = 'generating' AND attempts = ?`)
            .run(interrupted ? 'pending' : 'failed', now + delay, interrupted ? 'interrupted' : 'generation_failed', now, job.hash, job.attempts);
    }

    stats(): { ready: number; pending: number; failed: number } {
        const rows = this.db.prepare('SELECT status, COUNT(*) AS count FROM culture_profiles GROUP BY status').all() as { status: string; count: number }[];
        const output = { ready: 0, pending: 0, failed: 0 };
        for (const row of rows) {
            if (row.status === 'ready') output.ready += row.count;
            else if (row.status === 'failed') output.failed += row.count;
            else output.pending += row.count;
        }
        return output;
    }
    /** Remove every generated recipe version without replacing the open database. */
    clearProfiles(): number {
        const changes = this.db.prepare('DELETE FROM culture_profiles').run().changes;
        this.validatedParagraphs.clear();
        return changes;
    }
    close(): void { this.validatedParagraphs.clear(); this.db.close(); }
}
