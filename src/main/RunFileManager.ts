import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { ceCommandFile } from './ceBridge';

// CK3 requires run files to be in UTF-8 BOM encoding, otherwise the script
// lexer may fail to parse effects that contain non-ASCII (e.g. Chinese)
// characters, resulting in actions never being executed.
const UTF8_BOM = '\uFEFF';

export class RunFileManager {
    private static pendingCloses = new Set<() => void>();
    /** CE's ordinary action receipt still drains the owning command after chat detaches. */
    static acknowledgePendingCloses(): void {
        for (const acknowledge of this.pendingCloses) acknowledge();
    }
    private path: string;
    private pendingAction?: { command: string; marker: string; logPath: string; offset: number };

    constructor(userFolderPath: string, filename: string = 'votc.txt') {
        if (!userFolderPath) {
            console.error("RunFileManager error: userFolderPath is not provided. Run file operations will be disabled.");
            this.path = '';
            return;
        }
        this.path = path.join(userFolderPath, "run", ceCommandFile(userFolderPath, filename));
        console.log(`RunFileManager initialized. File path: ${this.path}`);
        this.createRunFolder(userFolderPath);
    }

    // Reads the current content of the run file, stripping any leading BOM.
    private readCurrent(): string {
        if (!fs.existsSync(this.path)) {
            return '';
        }
        let text = fs.readFileSync(this.path, 'utf-8');
        if (text.charCodeAt(0) === 0xFEFF) {
            text = text.substring(1);
        }
        return text;
    }

    // Always writes content as UTF-8 with a BOM prefix (single BOM at the start).
    private writeUtf8Bom(content: string): void {
        fs.writeFileSync(this.path, UTF8_BOM + content, 'utf-8');
    }

    assertIdle(): void {
        if (!this.path || this.readCurrent().trim()) {
            throw new Error('CK3 is processing another command. Try again after it finishes.');
        }
    }

    writeWhenIdle(text: string): void {
        this.assertIdle();
        this.writeUtf8Bom(text);
    }

    /** Keep an execution receipt so close can drain an accepted action after UI detachment. */
    writeActionWhenIdle(text: string): void {
        const marker = 'VOTC:TITAN_ACTION/;/' + randomUUID();
        const logPath = path.join(path.dirname(path.dirname(this.path)), 'logs', 'debug.log');
        let offset = 0;
        try { offset = fs.statSync(logPath).size; } catch { /* No log yet. */ }
        const command = text + '\ndebug_log = "' + marker + '"';
        this.writeWhenIdle(command);
        this.pendingAction = { command, marker, logPath, offset };
    }

    /** Never replace an unconsumed action or a command belonging to another encounter. */
    async writeAfterPending(text: string, allowed: () => boolean, timeoutMs = 30000, pollMs = 50): Promise<boolean> {
        const pending = this.readCurrent(), action = this.pendingAction;
        const deadline = Date.now() + timeoutMs;
        let logOffset = action?.offset ?? 0, trailing = '';
        const acknowledge = () => {
            if (allowed() && pending.trim() && this.readCurrent() === pending) this.clear();
        };
        RunFileManager.pendingCloses.add(acknowledge);
        try {
        while (allowed()) {
            const current = this.readCurrent();
            if (!current.trim()) { this.writeWhenIdle(text); this.pendingAction = undefined; return true; }
            if (current !== pending) return false;
            if (action?.command === current) {
                try {
                    const size = fs.statSync(action.logPath).size;
                    if (size < logOffset) return false; // A truncated/replaced log is not a receipt.
                    const fd = fs.openSync(action.logPath, 'r');
                    const bytes = Buffer.alloc(Math.min(size-logOffset, 1024*1024));
                    let read = 0;
                    try { read = fs.readSync(fd,bytes,0,bytes.length,logOffset); logOffset += read; } finally { fs.closeSync(fd); }
                    const chunk = trailing + bytes.subarray(0,read).toString('utf8'), end = chunk.lastIndexOf('\n');
                    const complete = end < 0 ? '' : chunk.slice(0,end);
                    trailing = (end < 0 ? chunk : chunk.slice(end+1)).slice(-4096);
                    if (complete.split(/\r?\n/).some(line => line.trimEnd().endsWith(action.marker))) {
                        // No asynchronous gap between the ownership check and replacement.
                        if (!allowed() || this.readCurrent() !== pending) return false;
                        this.writeUtf8Bom(text); this.pendingAction = undefined; return true;
                    }
                } catch { /* Wait for a complete game receipt or the ordinary clear. */ }
            }
            if (Date.now() >= deadline) return false;
            await new Promise<void>(resolve => setTimeout(resolve,pollMs));
        }
        return false;
        } finally { RunFileManager.pendingCloses.delete(acknowledge); }
    }

    write(text: string): void {
        if (!this.path) {
            console.warn('RunFileManager: Cannot write - path is not configured.');
            return;
        }
        try {
            this.writeUtf8Bom(text);
            console.log(`RunFileManager: Wrote to run file: ${text}`);
        } catch (error) {
            console.error(`RunFileManager: Failed to write to file ${this.path}:`, error);
        }
    }

    append(text: string): void {
        if (!this.path) {
            console.warn('RunFileManager: Cannot append - path is not configured.');
            return;
        }
        try {
            const currentText = this.readCurrent();
            const separator = currentText.trim() === '' ? '' : '\n';
            this.writeUtf8Bom(`${currentText}${separator}${text}`);
            console.log(`RunFileManager: Appended to run file ${this.path}: ${text}`);
        } catch (error) {
            console.error(`RunFileManager: Failed to append to file ${this.path}:`, error);
        }
    }

    clear(): void {
        if (!this.path) {
            console.warn('RunFileManager: Cannot clear - path is not configured.');
            return;
        }
        try {
            fs.writeFileSync(this.path, "", 'utf-8');
            console.log("RunFileManager: Run file cleared.");
        } catch (error) {
            console.error(`RunFileManager: Failed to clear file ${this.path}:`, error);
        }
    }

    private createRunFolder(userFolderPath: string): void {
        const runFolderPath = path.join(userFolderPath, "run");
        if (!fs.existsSync(runFolderPath)) {
            try {
                fs.mkdirSync(runFolderPath, { recursive: true });
                console.log(`Created run folder at: ${runFolderPath}`);
            } catch (err) {
                console.error("RunFileManager error creating run folder: " + err);
            }
        }
    }
}
