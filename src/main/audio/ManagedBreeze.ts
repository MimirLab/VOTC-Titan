import fs from 'fs';
import path from 'path';
import { breezeStartupIssue } from './hostingDiagnostics';
import net from 'net';
import { createHash } from 'crypto';
import { execFile, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { BREEZE_MODELS, BREEZE_RUNTIME } from './modelCatalog';
import { AudioSettings } from '../../shared/audio';
import { CudaBreezePackage } from './CudaBreezePackage';
import { audioHardware } from './hardware';
import { chooseHosting, hostingPlan, hostingPressure, ManagedModel } from './hostingPolicy';
const isCuda = (model: AudioSettings['managedModel']): model is 'cuda-hybrid' | 'cuda-bf16' => model === 'cuda-hybrid' || model === 'cuda-bf16';

const run = promisify(execFile);
export async function verifyArtifact(file: string, sha256: string, bytes: number): Promise<boolean> {
    if (!fs.existsSync(file) || fs.statSync(file).size !== bytes) return false;
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
    return hash.digest('hex') === sha256;
}
export async function downloadArtifact(file: string, url: string, sha256: string, bytes: number,
    signal: AbortSignal, progress: (done: number, total: number) => void): Promise<void> {
    signal.throwIfAborted();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (await verifyArtifact(file, sha256, bytes)) { progress(bytes, bytes); return; }
    const partial = file + '.partial';
    let done = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
    if (done === bytes) {
        const valid = await verifyArtifact(partial, sha256, bytes);
        signal.throwIfAborted();
        if (valid) { fs.renameSync(partial, file); progress(bytes, bytes); return; }
        fs.unlinkSync(partial); done = 0;
    }
    if (done > bytes) { fs.unlinkSync(partial); done = 0; }
    const response = await fetch(url, { signal, headers: done ? { Range: `bytes=${done}-` } : {} });
    if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status}).`);
    if (done && response.status === 206) {
        if (!response.headers.get('content-range')?.startsWith(`bytes ${done}-`)) throw new Error('Invalid resumed download range.');
    } else done = 0;
    const fd = fs.openSync(partial, done ? 'a' : 'w', 0o600);
    try {
        for await (const chunk of response.body as any) {
            signal.throwIfAborted(); const data = Buffer.from(chunk);
            if (done + data.length > bytes) throw new Error('Download exceeded pinned artifact size.');
            fs.writeSync(fd, data); done += data.length; progress(done, bytes);
        }
    } finally { fs.closeSync(fd); }
    if (!await verifyArtifact(partial, sha256, bytes)) {
        fs.unlinkSync(partial); throw new Error('Download checksum did not match the pinned artifact. Please retry.');
    }
    signal.throwIfAborted(); fs.renameSync(partial, file);
}
/** Bytes still to write; extraction/dependency reserves are budgeted separately. */
export function remainingArtifactBytes(file: string, bytes: number): number {
    if (fs.existsSync(file) && fs.statSync(file).size === bytes) return 0;
    const partial = file + '.partial';
    const size = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
    return size > 0 && size <= bytes ? bytes - size : bytes;
}
export class ManagedBreeze {
    private cuda: CudaBreezePackage;
    private process?: ChildProcess;
    private installController?: AbortController;
    private starting?: Promise<void>;
    private idleTimer?: ReturnType<typeof setTimeout>;
    private pressureTimer?: ReturnType<typeof setInterval>;
    private startupController?: AbortController;
    private stopping?: Promise<void>;
    private ready = false;
    activeModel?: ManagedModel;
    activeBackend?: string;
    constructor(readonly root: string, private report: (message: string) => void, private onPressure: (message: string) => void = report) {
        this.cuda = new CudaBreezePackage(root, downloadArtifact, verifyArtifact, report);
    }
    get running(): boolean { return this.ready && !!this.process && this.process.exitCode === null; }
    installed(model: AudioSettings['managedModel']): boolean {
        if (isCuda(model)) return this.cuda.installed(model);
        return fs.existsSync(path.join(this.root, BREEZE_RUNTIME.directory, 'breeze-server')) &&
            fs.existsSync(path.join(this.root, BREEZE_MODELS[model].file));
    }
    async install(model: AudioSettings['managedModel']): Promise<void> {
        if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Managed Vulkan hosting currently requires Linux x64. Use an external Breeze endpoint on this platform.');
        if (this.installController) throw new Error('A Breeze download is already running.');
        this.installController = new AbortController(); const signal = this.installController.signal;
        try {
            if (isCuda(model)) { await this.cuda.install(model, signal); return; }
            fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
            const spec = BREEZE_MODELS[model];
            const archive = path.join(this.root, 'runtime-v0.1.0.tar.gz');
            const remaining = remainingArtifactBytes(path.join(this.root, spec.file), spec.bytes) +
                remainingArtifactBytes(archive, BREEZE_RUNTIME.bytes);
            // Preserve the existing extraction margin; retained download bytes need no new space.
            if (fs.statfsSync(this.root).bavail * fs.statfsSync(this.root).bsize < remaining + 500_000_000)
                throw new Error('There is not enough free disk space for the remaining Breeze download and runtime extraction.');
            let last = 0;
            const progress = (label: string) => (done: number, total: number) => {
                if (Date.now() - last > 500 || done === total) { last = Date.now(); this.report(`${label}: ${(done / total * 100).toFixed(1)}%`); }
            };
            await downloadArtifact(archive, BREEZE_RUNTIME.url, BREEZE_RUNTIME.sha256, BREEZE_RUNTIME.bytes, signal, progress('Runtime'));
            const listing = await run('tar', ['-tzf', archive], { maxBuffer: 4 * 1024 ** 2 });
            if (listing.stdout.split('\n').filter(Boolean).some(entry => entry.startsWith('/') || entry.split('/').includes('..') || !entry.startsWith(BREEZE_RUNTIME.directory)))
                throw new Error('Unsafe paths in the runtime archive.');
            const types = await run('tar', ['-tvzf', archive], { maxBuffer: 4 * 1024 ** 2 });
            if (types.stdout.split('\n').filter(Boolean).some(entry => !['-', 'd'].includes(entry[0]))) throw new Error('Unsupported archive link or device.');
            signal.throwIfAborted();
            await run('tar', ['-xzf', archive, '-C', this.root, '--no-same-owner']);
            await downloadArtifact(path.join(this.root, spec.file), spec.url, spec.sha256, spec.bytes, signal, progress(spec.label));
            fs.writeFileSync(path.join(this.root, model + '.receipt.json'), JSON.stringify({ runtime: BREEZE_RUNTIME, model: spec }, null, 2), { mode: 0o600 });
            this.report('Breeze is installed. Start or test it when you are ready.');
        } finally { this.installController = undefined; }
    }
    cancelInstall(): void { this.installController?.abort(); }
    async start(settings: AudioSettings, signal: AbortSignal): Promise<void> {
        clearTimeout(this.idleTimer); signal.throwIfAborted();
        if (this.running) return;
        if (this.starting && this.startupController?.signal.aborted) {
            await this.starting.catch(() => {}); signal.throwIfAborted();
        }
        if (!this.starting) {
            const controller = new AbortController(); this.startupController = controller;
            this.starting = this.launch(settings, controller.signal).finally(() => {
                this.starting = undefined;
                if (this.startupController === controller) this.startupController = undefined;
            });
        }
        // Stopping a line must not cancel a shared model load needed by the next line.
        await new Promise<void>((resolve, reject) => {
            const aborted = () => reject(signal.reason ?? new Error('Voice preparation cancelled.'));
            signal.addEventListener('abort', aborted, { once: true });
            this.starting!.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
            if (signal.aborted) aborted();
        });
    }
    private async launch(settings: AudioSettings, signal: AbortSignal): Promise<void> {
        if (this.stopping) await this.stopping;
        signal.throwIfAborted();
        const preferred = settings.managedModel;
        if (!this.installed(preferred) && !this.installed('hoppou-q8')) throw new Error('Install a Breeze model in Audio before starting local hosting.');
        let plan = chooseHosting(preferred, model => this.installed(model), audioHardware());
        for (let attempt = 0; !plan && attempt < 6; attempt++) {
            this.report('Waiting for voice-hosting memory. ' + hostingPlan(preferred, audioHardware()).reason);
            await new Promise<void>((resolve, reject) => {
                const aborted = () => { clearTimeout(timer); reject(signal.reason); };
                const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, 2000);
                signal.addEventListener('abort', aborted, { once: true });
                if (signal.aborted) aborted();
            });
            signal.throwIfAborted(); plan = chooseHosting(preferred, model => this.installed(model), audioHardware());
        }
        if (!plan) throw new Error('Voice hosting is waiting for more memory. ' + hostingPlan(preferred, audioHardware()).reason + '. Free resources, then play again; Titan will retry automatically.');
        if (plan.model !== preferred) this.report(`Using installed Breeze Q8 because the selected package cannot currently fit. ${plan.reason}`);
        else this.report(`Starting ${BREEZE_MODELS[plan.model].label}. ${plan.reason}`);
        try { await this.launchModel({ ...settings, managedModel: plan.model }, signal); }
        catch (error) {
            signal.throwIfAborted();
            if (plan.model === 'hoppou-q8' || !this.installed('hoppou-q8') || !hostingPlan('hoppou-q8', audioHardware()).ready) throw error;
            this.report('The selected package could not start. Retrying with installed Breeze Q8…');
            await this.launchModel({ ...settings, managedModel: 'hoppou-q8' }, signal);
        }
    }
    private async launchModel(settings: AudioSettings, signal: AbortSignal): Promise<void> {
        if (this.stopping) await this.stopping;
        signal.throwIfAborted();
        const spec = BREEZE_MODELS[settings.managedModel];
        this.report('Verifying ' + spec.label + '…');
        if (!isCuda(settings.managedModel) && !await verifyArtifact(path.join(this.root, spec.file), spec.sha256, spec.bytes)) throw new Error('The installed Breeze model failed its checksum. Verify or resume its download in Audio.');
        signal.throwIfAborted();
        let hardware = audioHardware();
        if (!isCuda(settings.managedModel)) {
            try {
                // Confirm the actual Vulkan backend before granting the lower GPU-offload RAM budget.
                // DRM may still show a card when its Vulkan driver is unavailable.
                const probe = path.join(__dirname, '../../../public/audio/vulkan_probe.py');
                const output = await run('python3', [probe], { signal, timeout: 10_000, maxBuffer: 64 * 1024 });
                const device = JSON.parse(output.stdout);
                if (device.gpu !== true) throw new Error('No usable discrete Vulkan GPU');
                hardware = audioHardware();
                if (!device.gpu || hardware.gpus.length !== 1 || hardware.gpus[0].vendor !== device.vendor)
                    hardware = { ...hardware, gpus: [] };
            } catch {
                signal.throwIfAborted();
                throw new Error('Breeze needs a usable Vulkan GPU for local hosting. GPU initialization failed; CPU fallback is disabled. Check the graphics driver or use a GPU speech server.');
            }
        }
        const budget = hostingPlan(settings.managedModel, hardware);
        if (!budget.ready) throw new Error('Available memory changed before loading Breeze. ' + budget.reason + '. Play again to retry.');
        await new Promise<void>((resolve, reject) => {
            // A bind probe can reject a recently closed connection in TIME_WAIT.
            // Check for a live listener instead; the owned child still must report its backend and become healthy.
            const probe = net.createConnection({ host: '127.0.0.1', port: 18891 });
            probe.once('connect', () => { probe.destroy(); reject(new Error('The local Breeze port is already in use. Connect to that server as an external host or close it first.')); });
            probe.once('error', (error: NodeJS.ErrnoException) => {
                probe.destroy(); if (error.code === 'ECONNREFUSED') resolve();
                else reject(new Error('The local speech port could not be checked. Retry local hosting.'));
            });
            probe.setTimeout(1500, () => { probe.destroy(); reject(new Error('The local speech port did not respond. Retry local hosting.')); });
        });
        signal.throwIfAborted();
        const runtimeRoot = path.join(this.root, BREEZE_RUNTIME.directory);
        const launch = isCuda(settings.managedModel) ? await this.cuda.command(settings.managedModel, signal) : {
            command: 'stdbuf', args: ['-oL', '-eL', path.join(runtimeRoot, 'breeze-server'), path.join(this.root, BREEZE_MODELS[settings.managedModel].file),
            '--host', '127.0.0.1', '--port', '18891', '--ws-port', '-1', '--voices-dir', path.join(this.root, 'codec-' + settings.managedModel + '-' + spec.sha256.slice(0, 16))],
            cwd: runtimeRoot, env: { ...process.env } };
        const child = spawn(launch.command, launch.args, { cwd: launch.cwd, stdio: ['ignore', 'pipe', 'pipe'], env: launch.env });
        this.process = child; this.activeModel = settings.managedModel;
        let launchError: Error | undefined;
        let backend = isCuda(settings.managedModel) ? 'CUDA' : undefined, startupText = '';
        let startupStderr = '', reportedStartupIssue: string | undefined;
        child.stderr?.on('data', (bytes: Buffer) => {
            if (this.ready) return;
            startupStderr = (startupStderr + bytes.toString('utf8')).slice(-8192);
            const code = breezeStartupIssue(startupStderr);
            if (code && code !== reportedStartupIssue) {
                reportedStartupIssue = code;
                console.info('[Audio hosting diagnostic] ' + JSON.stringify({ phase: 'startup', code }));
            }
        });
        child.stdout?.on('data', (bytes: Buffer) => {
            if (this.ready || isCuda(settings.managedModel)) return;
            startupText = (startupText + bytes.toString('utf8')).slice(-4096);
            backend = /backend:\s*([^\s,]+)/.exec(startupText)?.[1];
            if (backend && !backend.startsWith('Vulkan')) {
                launchError = new Error('Breeze selected a CPU backend. Hosting was stopped; CPU fallback is disabled. Check the Vulkan driver or use a GPU speech server.');
                child.kill('SIGTERM');
            }
        });
        child.once('error', error => { launchError = error; });
        child.once('exit', () => { if (this.process === child) { this.process = undefined; this.activeModel = undefined; this.activeBackend = undefined; this.ready = false; clearInterval(this.pressureTimer); } });
        const startupGuard = setInterval(() => {
            const available = audioHardware().availableRAMBytes;
            let rss = 0;
            try { rss = Number(fs.readFileSync(`/proc/${child.pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+) kB/m)?.[1] ?? 0) * 1024; } catch { /* Child may have exited. */ }
            if (available < 1024 ** 3 || budget.requiredRAM === 2 * 1024 ** 3 && rss > 1.5 * 1024 ** 3) {
                launchError = new Error('Breeze exceeded its GPU-hosting RAM budget during startup. Its model was released; play again when memory is available.');
                child.kill('SIGTERM');
            }
        }, 250); startupGuard.unref?.();
        const start = Date.now();
        try {
            while (Date.now() - start < 180_000) {
                signal.throwIfAborted();
                if (launchError) throw launchError;
                if (child.exitCode !== null) throw new Error('Breeze could not start. Check your Vulkan driver and runtime requirements.');
                try {
                    const response = await fetch('http://127.0.0.1:18891/health', { signal: AbortSignal.timeout(1500) });
                    if (response.ok) {
                        const health = await response.json() as any;
                        if (backend && (health.ready === true || health.ready === undefined && health.status === 'ok' && health.sample_rate === 24000)) {
                            if (launchError) throw launchError;
                            this.ready = true; this.activeBackend = backend; this.watchPressure(); return;
                        }
                    }
                } catch { /* Poll this owned process until ready. */ }
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            throw new Error('Breeze did not become ready within three minutes.');
        } catch (error) { this.stopProcess(); throw error; }
        finally { clearInterval(startupGuard); }
    }
    idle(minutes: number): void { clearTimeout(this.idleTimer); this.idleTimer = setTimeout(() => this.stop(), minutes * 60_000); this.idleTimer.unref?.(); }
    private watchPressure(): void {
        clearInterval(this.pressureTimer); let low = 0;
        this.pressureTimer = setInterval(() => {
            if (!this.running) return;
            const reason = hostingPressure(audioHardware()); low = reason ? low + 1 : 0;
            if (low >= 2) {
                this.stop();
                this.onPressure(`Voice hosting released its model because ${reason}. Play again when memory is available; saved voices are retained.`);
            }
        }, 1500); this.pressureTimer.unref?.();
    }
    private stopProcess(): void {
        clearTimeout(this.idleTimer); clearInterval(this.pressureTimer);
        const child = this.process; this.process = undefined; this.activeModel = undefined; this.activeBackend = undefined; this.ready = false;
        if (child && child.exitCode === null) {
            this.stopping = new Promise<void>(resolve => {
                const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 3000); timer.unref?.();
                child.once('exit', () => { clearTimeout(timer); resolve(); });
                child.once('error', () => { clearTimeout(timer); resolve(); });
                child.kill('SIGTERM');
            }).finally(() => { this.stopping = undefined; });
        }
    }
    stop(): void { this.startupController?.abort(new Error('Local voice hosting stopped.')); this.stopProcess(); }
}
