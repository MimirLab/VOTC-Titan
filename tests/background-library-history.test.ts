import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { canonicalJsonStringify } from '../src/main/promptWorkbench/canonicalJson';
import { CultureLibrary } from '../src/main/culture/CultureLibrary';
import { FaithLibrary } from '../src/main/faith/FaithLibrary';
import { cultureInput, cultureHash } from '../src/main/culture/cultureIdentity';
import { faithInput, faithHash } from '../src/main/faith/faithIdentity';
import { snapshot as cultureSnapshot, result as cultureResult } from './culture/fixtures';
import { snapshot as faithSnapshot, result as faithResult } from './faith/fixtures';

// Real SQLite rows, not mocked readers: recipe changes must leave archives intact.
const domains = [
    { name: 'culture', table: 'culture_profiles', open: (file: string) => new CultureLibrary(file),
        input: () => cultureInput(cultureSnapshot(), 'en'), hash: (input: any) => cultureHash(input), result: cultureResult },
    { name: 'faith', table: 'faith_profiles', open: (file: string) => new FaithLibrary(file),
        input: () => faithInput(faithSnapshot(), 'en'), hash: (input: any) => faithHash(input), result: faithResult }
];

describe.each(domains)('$name recipe history', domain => {
    let root: string;
    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'votc-recipe-history-')); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    test.each(['legacy shape', 'previous ingredient revision'])('%s ready rows remain intact across ingredient integration', kind => {
        const file = path.join(root, 'library.sqlite'), current = domain.input(), library = domain.open(file);
        const old: any = { ...current };
        if (kind === 'legacy shape') { old.promptVersion -= 1; delete old.ingredientRevision; }
        else old.ingredientRevision = 'a'.repeat(64);
        const hash = domain.hash(old), db = new Database(file);
        try {
            db.prepare(`INSERT INTO ${domain.table} (hash,input_json,status,paragraph,notes_json,created_at,updated_at)
                VALUES (?,?,'ready','preserved historical text','{"notes":[]}',1,1)`)
                .run(hash, canonicalJsonStringify(old));
            const before = db.prepare(`SELECT * FROM ${domain.table} WHERE hash=?`).get(hash);
            expect(library.ready(hash)).toBeUndefined();
            expect(library.claim(hash, 999999)).toBeUndefined();
            expect(db.prepare(`SELECT * FROM ${domain.table} WHERE hash=?`).get(hash)).toEqual(before);
            expect(library.encounter(current as any, 2)).not.toBe(hash);
        } finally { library.close(); db.close(); }
    });

    test.each(['older', 'newer'] as const)('%s ready recipes survive reads, new encounters and reopen', direction => {
        const file = path.join(root, 'library.sqlite'), input = domain.input();
        let library = domain.open(file);
        const currentHash = library.encounter(input as any, 0);
        library.finish(library.claim(currentHash, 0)! as any, domain.result() as any, 1);
        const archived = { ...input, promptVersion: input.promptVersion + (direction === 'older' ? -1 : 1) };
        const archivedHash = domain.hash(archived), db = new Database(file);
        try {
            db.prepare(`UPDATE ${domain.table} SET hash = ?, input_json = ? WHERE hash = ?`)
                .run(archivedHash, canonicalJsonStringify(archived), currentHash);
            const before = db.prepare(`SELECT * FROM ${domain.table} WHERE hash = ?`).get(archivedHash);
            expect(library.ready(archivedHash)).toBeUndefined(); // Never serve an incompatible recipe.
            expect(library.claim(archivedHash, 999_999_999)).toBeUndefined();
            expect(db.prepare(`SELECT * FROM ${domain.table} WHERE hash = ?`).get(archivedHash)).toEqual(before);
            expect(library.encounter(input as any, 2)).toBe(currentHash);
            expect(currentHash).not.toBe(archivedHash);
            library.finish(library.claim(currentHash, 2)! as any, domain.result() as any, 3);
            expect(library.ready(currentHash)).toBe(domain.result().paragraph);
            expect(db.prepare(`SELECT * FROM ${domain.table} WHERE hash = ?`).get(archivedHash)).toEqual(before);
            library.close(); library = domain.open(file);
            expect(library.ready(archivedHash)).toBeUndefined();
            expect(library.ready(currentHash)).toBe(domain.result().paragraph);
            expect(db.prepare(`SELECT * FROM ${domain.table} WHERE hash = ?`).get(archivedHash)).toEqual(before);
        } finally { library.close(); db.close(); }
    });

    test.each(['pending', 'failed', 'generating'] as const)('old %s recipes are not leased, retried or rewritten', status => {
        const file = path.join(root, 'library.sqlite'), input = domain.input(), library = domain.open(file);
        const archived = { ...input, promptVersion: input.promptVersion - 1 }, archivedHash = domain.hash(archived);
        const db = new Database(file);
        try {
            db.prepare(`INSERT INTO ${domain.table}
                (hash, input_json, status, attempts, retry_at, lease_until, error_code, created_at, updated_at)
                VALUES (?, ?, ?, 3, 5, 200, 'historical_failure', 0, 4)`)
                .run(archivedHash, canonicalJsonStringify(archived), status);
            const before = db.prepare(`SELECT * FROM ${domain.table} WHERE hash = ?`).get(archivedHash);
            expect(library.claim(archivedHash, 999_999_999)).toBeUndefined();
            expect(library.ready(archivedHash)).toBeUndefined();
            expect(db.prepare(`SELECT * FROM ${domain.table} WHERE hash = ?`).get(archivedHash)).toEqual(before);
            expect(library.encounter(input as any, 10)).not.toBe(archivedHash);
            expect(db.prepare(`SELECT * FROM ${domain.table} WHERE hash = ?`).get(archivedHash)).toEqual(before);
        } finally { library.close(); db.close(); }
    });

    test.each(['ready', 'pending'] as const)('a tampered %s input cannot masquerade as historical', status => {
        const file = path.join(root, 'library.sqlite'), input = domain.input(), library = domain.open(file);
        const hash = library.encounter(input as any, 0), db = new Database(file);
        try {
            if (status === 'ready') library.finish(library.claim(hash, 0)! as any, domain.result() as any, 1);
            // Keep the current hash: a recipe edit without rehashing is corruption, not an archive.
            db.prepare(`UPDATE ${domain.table} SET input_json = ? WHERE hash = ?`)
                .run(canonicalJsonStringify({ ...input, promptVersion: input.promptVersion - 1 }), hash);
            if (status === 'ready') expect(library.ready(hash)).toBeUndefined();
            else expect(library.claim(hash, 10)).toBeUndefined();
            expect(library.state(hash)).toBe('failed');
            const row = db.prepare(`SELECT paragraph, error_code FROM ${domain.table} WHERE hash = ?`).get(hash) as any;
            expect(row.paragraph).toBeNull();
            expect(row.error_code).toBe(status === 'ready' ? 'invalid_result' : 'invalid_input');
        } finally { library.close(); db.close(); }
    });

    test.each(['ready', 'pending'] as const)('self-consistent hashes do not exempt incomplete %s historical captures', status => {
        const file = path.join(root, 'library.sqlite'), input = domain.input(), library = domain.open(file);
        const originalHash = library.encounter(input as any, 0), db = new Database(file);
        try {
            if (status === 'ready') library.finish(library.claim(originalHash, 0)! as any, domain.result() as any, 1);
            const invalid = { ...input, promptVersion: input.promptVersion - 1,
                snapshot: { ...input.snapshot, complete: false } };
            const hash = domain.hash(invalid);
            db.prepare(`UPDATE ${domain.table} SET hash = ?, input_json = ? WHERE hash = ?`)
                .run(hash, canonicalJsonStringify(invalid), originalHash);
            if (status === 'ready') expect(library.ready(hash)).toBeUndefined();
            else expect(library.claim(hash, 10)).toBeUndefined();
            expect(library.state(hash)).toBe('failed');
        } finally { library.close(); db.close(); }
    });
});
