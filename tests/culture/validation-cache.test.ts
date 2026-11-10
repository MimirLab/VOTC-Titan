import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { CultureLibrary } from '../../src/main/culture/CultureLibrary';
import * as identity from '../../src/main/culture/cultureIdentity';
import { result, snapshot } from './fixtures';

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'culture-validation-'));
    const file = path.join(root, 'cultures.sqlite'), library = new CultureLibrary(file), db = new Database(file);
    const input = identity.cultureInput(snapshot(), 'en'), hash = library.encounter(input, 0), accepted = result(input);
    library.finish(library.claim(hash, 0)!, accepted, 1);
    return { library, db, input, hash, accepted, close() {
        jest.restoreAllMocks(); db.close(); library.close(); fs.rmSync(root, { recursive: true, force: true });
    } };
}

test('unchanged ready rows reuse note validation while current input is recomputed', () => {
    const f = fixture(), validate = jest.spyOn(identity, 'validateCultureResult'), current = jest.spyOn(identity, 'cultureInput');
    try {
        expect(f.library.ready(f.hash)).toBe(f.accepted.paragraph);
        const checks = current.mock.calls.length;
        for (let i = 0; i < 4; i++) expect(f.library.ready(f.hash)).toBe(f.accepted.paragraph);
        expect(validate).toHaveBeenCalledTimes(1);
        expect(current.mock.calls.length).toBeGreaterThan(checks);
    } finally { f.close(); }
});

test.each(['paragraph', 'notes_json', 'input_json'])('warm validation refuses changed corrupt %s bytes', column => {
    const f = fixture();
    try {
        expect(f.library.ready(f.hash)).toBe(f.accepted.paragraph);
        const value = column === 'paragraph' ? 'An invented replacement.' : column === 'notes_json' ? '{}' : JSON.stringify({ ...f.input, promptVersion: 999, unexpected: 'invalid' });
        f.db.prepare(`UPDATE culture_profiles SET ${column}=? WHERE hash=?`).run(value, f.hash);
        expect(f.library.ready(f.hash)).toBeUndefined();
        expect(f.library.state(f.hash)).toBe('failed');
    } finally { f.close(); }
});

test.each(['pending', 'generating', 'failed', 'deleted'])('warm validation never serves a %s row', status => {
    const f = fixture();
    try {
        expect(f.library.ready(f.hash)).toBe(f.accepted.paragraph);
        if (status === 'deleted') f.db.prepare('DELETE FROM culture_profiles WHERE hash=?').run(f.hash);
        else f.db.prepare('UPDATE culture_profiles SET status=? WHERE hash=?').run(status, f.hash);
        expect(f.library.ready(f.hash)).toBeUndefined();
        expect(f.library.state(f.hash)).toBe(status === 'deleted' ? undefined : status);
    } finally { f.close(); }
});

test('a current recipe change withdraws a warm paragraph without corrupting its archive', () => {
    const f = fixture(), original = identity.cultureInput;
    try {
        expect(f.library.ready(f.hash)).toBe(f.accepted.paragraph);
        const before = f.db.prepare('SELECT * FROM culture_profiles WHERE hash=?').get(f.hash);
        const changed = jest.spyOn(identity, 'cultureInput').mockImplementation((...args) => {
            const input = original(...args); return { ...input, promptVersion: input.promptVersion + 1 };
        });
        expect(f.library.ready(f.hash)).toBeUndefined();
        expect(f.db.prepare('SELECT * FROM culture_profiles WHERE hash=?').get(f.hash)).toEqual(before);
        changed.mockRestore();
        const validate = jest.spyOn(identity, 'validateCultureResult');
        expect(f.library.ready(f.hash)).toBe(f.accepted.paragraph);
        expect(validate).toHaveBeenCalledTimes(1);
    } finally { f.close(); }
});

test('different valid stored bytes are revalidated before reuse', () => {
    const f = fixture(), validate = jest.spyOn(identity, 'validateCultureResult');
    try {
        expect(f.library.ready(f.hash)).toBe(f.accepted.paragraph);
        // The same value in a new serialization is still a changed database row.
        f.db.prepare('UPDATE culture_profiles SET notes_json=? WHERE hash=?').run(JSON.stringify({ notes: f.accepted.notes }, null, 2), f.hash);
        expect(f.library.ready(f.hash)).toBe(f.accepted.paragraph);
        expect(validate).toHaveBeenCalledTimes(2);
    } finally { f.close(); }
});

test('an optional cache insertion failure preserves valid guidance and ready state', () => {
    const f = fixture();
    try {
        jest.spyOn((f.library as any).validatedParagraphs, 'set').mockImplementation(() => { throw new Error('cache fixture'); });
        expect(f.library.ready(f.hash)).toBe(f.accepted.paragraph);
        expect(f.library.ready(f.hash)).toBe(f.accepted.paragraph);
        expect(f.library.state(f.hash)).toBe('ready');
    } finally { f.close(); }
});

test('purge removes warm data and later regeneration validates again', () => {
    const f = fixture(), validate = jest.spyOn(identity, 'validateCultureResult');
    try {
        expect(f.library.ready(f.hash)).toBe(f.accepted.paragraph);
        expect(f.library.clearProfiles()).toBe(1);
        expect(f.library.ready(f.hash)).toBeUndefined();
        f.library.encounter(f.input, 2); f.library.finish(f.library.claim(f.hash, 2)!, f.accepted, 3);
        validate.mockClear();
        expect(f.library.ready(f.hash)).toBe(f.accepted.paragraph);
        expect(validate).toHaveBeenCalledTimes(1);
    } finally { f.close(); }
});
