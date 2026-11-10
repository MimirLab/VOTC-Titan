import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { CUDA_MODELS, CUDA_RUNTIME, CUDA_SIDECARS, CUDA_UV } from './cudaModelCatalog';
const run = promisify(execFile);
type CudaModel = keyof typeof CUDA_MODELS;
type Download = (file: string, url: string, hash: string, bytes: number, signal: AbortSignal, progress: (done: number, total: number) => void) => Promise<void>;
type Verify = (file: string, hash: string, bytes: number) => Promise<boolean>;

/** Everything, including Python, wheels and caches, stays inside Titan's audio model directory. */
export class CudaBreezePackage {
    constructor(private root: string, private download: Download, private verify: Verify, private report: (message: string) => void) {}
    private python(): string { return path.join(this.root, 'cuda-env', 'bin', 'python'); }
    installed(model: CudaModel): boolean {
        return fs.existsSync(this.python()) && fs.existsSync(path.join(this.root, CUDA_MODELS[model].file)) &&
            fs.existsSync(path.join(this.root, model + '.receipt.json'));
    }
    async hardware(model: CudaModel, loading: boolean): Promise<string> {
        let stdout: string;
        try { stdout = (await run('nvidia-smi', ['--query-gpu=index,memory.total,memory.free', '--format=csv,noheader,nounits'], { timeout: 5000 })).stdout; }
        catch { throw new Error('This package requires an NVIDIA CUDA GPU and driver. Use Vulkan Breeze or an external CUDA host on this machine.'); }
        const candidates = stdout.trim().split('\n').map(line => line.split(',').map(value => Number(value.trim())));
        const required = CUDA_MODELS[model].minimumFreeVRAM / 1024 ** 2;
        const selected = candidates.filter(row => row.length === 3 && row.every(Number.isFinite) && row[loading ? 2 : 1] >= required)
            .sort((a, b) => b[2] - a[2])[0];
        if (!selected) throw new Error('There is too little available CUDA GPU memory for this hosting recipe. Choose a smaller model or close other GPU workloads.');
        return String(selected[0]);
    }
    private async unpack(archive: string, prefix: string, signal: AbortSignal): Promise<void> {
        const listing = await run('tar', ['-tzf', archive], { signal, maxBuffer: 4 * 1024 ** 2 });
        if (listing.stdout.split('\n').filter(Boolean).some(name => name.startsWith('/') || name.split('/').includes('..') || !name.startsWith(prefix + '/')))
            throw new Error('Unsafe paths in the CUDA runtime archive.');
        const types = await run('tar', ['-tvzf', archive], { signal, maxBuffer: 4 * 1024 ** 2 });
        if (types.stdout.split('\n').filter(Boolean).some(line => !['-', 'd'].includes(line[0]))) throw new Error('Unsupported CUDA archive link or device.');
        await run('tar', ['-xzf', archive, '-C', this.root, '--no-same-owner'], { signal });
    }
    async install(model: CudaModel, signal: AbortSignal): Promise<void> {
        const device = await this.hardware(model, false); fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
        if (fs.statfsSync(this.root).bavail * fs.statfsSync(this.root).bsize < CUDA_MODELS[model].bytes + 12 * 1024 ** 3)
            throw new Error('CUDA hosting needs space for its model, isolated Python and CUDA dependencies. Free at least 20 GB before downloading.');
        let last = 0;
        const progress = (name: string) => (done: number, total: number) => {
            if (Date.now() - last > 500 || done === total) { last = Date.now(); this.report(`${name}: ${(done / total * 100).toFixed(1)}%`); }
        };
        for (const [name, spec] of [['cuda-runtime', CUDA_RUNTIME], ['cuda-python-bootstrap', CUDA_UV]] as const) {
            const archive = path.join(this.root, name + '.tar.gz');
            await this.download(archive, spec.url, spec.sha256, spec.bytes, signal, progress(name)); await this.unpack(archive, spec.directory, signal);
        }
        const env = { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(this.root, 'python'), UV_CACHE_DIR: path.join(this.root, 'uv-cache'),
            PIP_CACHE_DIR: path.join(this.root, 'pip-cache'), CUDA_VISIBLE_DEVICES: device };
        const uv = path.join(this.root, CUDA_UV.directory, 'uv');
        this.report('Preparing the isolated CUDA Python environment…');
        try {
            if (!fs.existsSync(this.python())) await run(uv, ['venv', '--python', '3.12', '--managed-python', path.join(this.root, 'cuda-env')], { env, signal, maxBuffer: 8 * 1024 ** 2 });
            await run(uv, ['pip', 'install', '--python', this.python(), '-r', path.join(this.root, CUDA_RUNTIME.directory, 'requirements.txt')],
                { env, signal, maxBuffer: 8 * 1024 ** 2 });
            await run(this.python(), ['-c', 'import torch,torchaudio; from breeze_infer.int8_convrot import validate_cuda_backend; assert torch.cuda.is_available(); validate_cuda_backend()'],
                { cwd: path.join(this.root, CUDA_RUNTIME.directory), env, signal, maxBuffer: 1024 ** 2 });
        } catch { signal.throwIfAborted(); throw new Error('The isolated CUDA environment could not be prepared. Its model files remain resumable; check CUDA driver compatibility and retry.'); }
        const folder = path.join(this.root, model);
        for (const spec of CUDA_SIDECARS) await this.download(path.join(folder, spec.file), spec.url, spec.sha256, spec.bytes, signal, progress(spec.file));
        const weights = CUDA_MODELS[model];
        await this.download(path.join(this.root, weights.file), weights.url, weights.sha256, weights.weightsBytes, signal, progress(weights.label));
        const packages = await run(uv, ['pip', 'freeze', '--python', this.python()], { env, signal });
        fs.writeFileSync(path.join(this.root, 'cuda-environment.lock.txt'), packages.stdout, { mode: 0o600 });
        fs.writeFileSync(path.join(this.root, model + '.receipt.json'), JSON.stringify({ runtime: CUDA_RUNTIME, model: weights,
            assets: CUDA_SIDECARS, python: '3.12', cudaKernelPreflight: true, voiceQualityBenchmark: 'pending on this hardware' }, null, 2), { mode: 0o600 });
        this.report('CUDA Breeze is installed. Its voice quality and concurrent-game workload still need listening on this hardware.');
    }
    async command(model: CudaModel, signal: AbortSignal): Promise<{ command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }> {
        const device = await this.hardware(model, true), weights = CUDA_MODELS[model];
        if (!await this.verify(path.join(this.root, weights.file), weights.sha256, weights.weightsBytes)) throw new Error('CUDA model checksum failed. Resume its download in Audio.');
        for (const spec of CUDA_SIDECARS) if (!await this.verify(path.join(this.root, model, spec.file), spec.sha256, spec.bytes))
            throw new Error('CUDA model configuration or codec checksum failed. Resume its download in Audio.');
        signal.throwIfAborted();
        return { command: this.python(), cwd: path.join(this.root, CUDA_RUNTIME.directory),
            args: ['-m', 'breeze_infer.api', path.join(this.root, model), ...(model === 'cuda-hybrid' ? ['--weights', path.join(this.root, weights.file)] : []),
                '--host', '127.0.0.1', '--port', '18891', '--voice-dir', path.join(this.root, 'codec-' + model + '-' + weights.sha256.slice(0, 16)), '--hybrid-scale-mode', 'bf16_compat', '--no-fast-all'],
            env: { ...process.env, CUDA_VISIBLE_DEVICES: device, HF_HOME: path.join(this.root, 'hf-cache'), TORCH_HOME: path.join(this.root, 'torch-cache'),
                TRITON_CACHE_DIR: path.join(this.root, 'triton-cache'), TORCHINDUCTOR_CACHE_DIR: path.join(this.root, 'inductor-cache') } };
    }
}
