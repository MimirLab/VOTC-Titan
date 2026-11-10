import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import fs from 'fs';
import readline from 'readline';

export interface ChronicleStatus {
    ready: boolean; manifest_sha256: string; setting_sha256: string;
    counts: { passages: Record<string, number>; aliases: number; edges: number };
    authored_qualified: number;
}

/** One owned, offline reader process; accepted data is opened read only. */
export class LorebookClient {
    private child?: ChildProcessWithoutNullStreams;
    private starting?: Promise<void>;
    private serial = 0;
    private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
    readonly bundle: string;
    constructor(readonly root = path.resolve(__dirname, '../../..')) {
        this.bundle = path.join(root, 'public/lorebook/bundle');
    }
    get installed(): boolean { return fs.existsSync(path.join(this.bundle, 'titan-vendor.json')); }
    private start(): Promise<void> {
        if (this.starting) return this.starting;
        if (!this.installed) return Promise.reject(new Error('The Chronicle has not been bundled with this application.'));
        this.starting = new Promise<void>((resolve, reject) => {
            let ready = false;
            const timer = setTimeout(() => { reject(new Error('Chronicle startup timed out.')); this.close(); }, 20000);
            const child = spawn(path.join(this.bundle, 'python/bin/python3'),
                ['-I', '-B', '-S', path.join(this.root, 'tools/lorebook-worker.py'), this.bundle], {
                    cwd: this.bundle, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8',
                        LD_LIBRARY_PATH: path.join(this.bundle, 'python/lib') }, stdio: ['pipe', 'pipe', 'pipe']
                });
            this.child = child;
            child.stderr.on('data', () => {}); // never export request bodies or Python tracebacks
            const failure = () => {
                clearTimeout(timer);
                if (!ready) reject(new Error('The bundled Chronicle reader could not start.'));
                if (this.child !== child) return;
                this.child = undefined; this.starting = undefined;
                for (const value of this.pending.values()) { clearTimeout(value.timer); value.reject(new Error('The Chronicle reader stopped.')); }
                this.pending.clear();
            };
            child.once('error', failure); child.once('exit', failure);
            readline.createInterface({ input: child.stdout }).on('line', line => {
                try {
                    const response = JSON.parse(line);
                    if (response.event === 'ready') { ready = true; clearTimeout(timer); resolve(); return; }
                    const value = this.pending.get(response.id);
                    if (!value) return;
                    clearTimeout(value.timer); this.pending.delete(response.id);
                    if (response.error) value.reject(new Error(String(response.error)));
                    else value.resolve(response.result);
                } catch { this.close(); }
            });
        });
        return this.starting;
    }
    async request<T = any>(body: Record<string, unknown>): Promise<T> {
        await this.start();
        const id = ++this.serial;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => { this.close(); reject(new Error('Chronicle request timed out.')); }, 20000);
            this.pending.set(id, { resolve, reject, timer });
            this.child!.stdin.write(JSON.stringify({ id, body }) + '\n', error => {
                if (error) this.close();
            });
        });
    }
    close(): void {
        const child = this.child; this.child = undefined; this.starting = undefined;
        for (const value of this.pending.values()) { clearTimeout(value.timer); value.reject(new Error('Chronicle request cancelled.')); }
        this.pending.clear();
        child?.stdin.end(); child?.kill();
    }
}

export const lorebookClient = new LorebookClient();
