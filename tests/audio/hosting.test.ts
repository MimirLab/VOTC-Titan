import { EventEmitter } from 'events';
import { chooseHosting, hostingPlan, hostingPressure } from '../../src/main/audio/hostingPolicy';
import { audioHardware, AudioHardware } from '../../src/main/audio/hardware';
import { ManagedBreeze } from '../../src/main/audio/ManagedBreeze';
import { normalizeAudio } from '../../src/shared/audio';
jest.mock('../../src/main/audio/hardware', () => ({ audioHardware: jest.fn() }));
const GiB = 1024 ** 3;
const hardware = (ram = 3.8, vram = 8.9): AudioHardware => ({ ramBytes: 16 * GiB, availableRAMBytes: ram * GiB,
    gpus: [{ vendor: 'AMD', totalBytes: 16 * GiB, freeBytes: vram * GiB }] });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('the reported 16GB GPU case admits Q8 at 3.8GiB RAM with a separate device budget', () => {
    expect(hostingPlan('hoppou-q8', hardware())).toMatchObject({ ready: true, requiredRAM: 2 * GiB, requiredVRAM: 6 * GiB });
    expect(hostingPlan('hoppou-q8', hardware(1.9)).ready).toBe(false);
    expect(hostingPlan('hoppou-q8', hardware(4, 5.9)).ready).toBe(false);
    expect(hostingPlan('hoppou-q8', hardware(1.5)).reason).toContain('1.5 GiB available / 2.0 GiB needed');
});
test('unknown, shared and ambiguous GPU setups retain the conservative host-RAM budget', () => {
    expect(hostingPlan('hoppou-q8', { ...hardware(), gpus: [] })).toMatchObject({ ready: false, requiredRAM: 5 * GiB });
    expect(hostingPlan('hoppou-q8', { ...hardware(), gpus: [...hardware().gpus, ...hardware().gpus] }).requiredRAM).toBe(5 * GiB);
});
test('F16 falls back to already installed Q8 without requiring a download or changing the preferred setting', () => {
    const selected = normalizeAudio({ managedModel: 'hoppou-f16' });
    expect(chooseHosting(selected.managedModel, () => true, hardware())?.model).toBe('hoppou-q8');
    expect(chooseHosting(selected.managedModel, () => true, hardware(3.8, 10))?.model).toBe('hoppou-f16');
    expect(chooseHosting(selected.managedModel, id => id === 'hoppou-f16', hardware())).toBeUndefined();
    expect(selected.managedModel).toBe('hoppou-f16');
});
test('unsupported CUDA falls back to installed Vulkan while conservative CUDA RAM remains intact', () => {
    expect(chooseHosting('cuda-hybrid', () => true, hardware(10, 12))?.model).toBe('hoppou-q8');
    const nvidia = { ...hardware(10, 14), gpus: [{ ...hardware().gpus[0], vendor: 'NVIDIA' }] };
    expect(chooseHosting('cuda-hybrid', () => true, nvidia)?.model).toBe('cuda-hybrid');
    expect(hostingPlan('cuda-hybrid', nvidia).requiredRAM).toBe(8 * GiB);
});
test('critical resource checks distinguish ordinary headroom from sustained-danger samples', () => {
    expect(hostingPressure(hardware())).toBeUndefined();
    expect(hostingPressure(hardware(.9))).toContain('system RAM');
    expect(hostingPressure(hardware(3, .2))).toContain('GPU memory');
});

function fixture() {
    (audioHardware as jest.Mock).mockReturnValue(hardware());
    const report = jest.fn(), pressure = jest.fn(); const manager = new ManagedBreeze('/tmp/titan-mocked-hosting', report, pressure);
    jest.spyOn(manager, 'installed').mockReturnValue(true);
    return { manager, report, pressure, settings: normalizeAudio({ enabled: true, hosting: 'managed' }) };
}
test('cancelling one waiting line does not cancel the shared cold start needed by another', async () => {
    const f = fixture(); let done!: () => void;
    const launch = jest.spyOn(f.manager as any, 'launchModel').mockImplementation(() => new Promise<void>(resolve => { done = resolve; }));
    const a = new AbortController(), b = new AbortController();
    const first = f.manager.start(f.settings, a.signal); const second = f.manager.start(f.settings, b.signal);
    a.abort(new Error('old line stopped')); await expect(first).rejects.toThrow('old line stopped');
    expect(launch).toHaveBeenCalledTimes(1); done(); await second; f.manager.stop();
});
test('a spawned child is not considered ready until the cold-start promise has completed', async () => {
    const f = fixture(); let done!: () => void;
    jest.spyOn(f.manager as any, 'launchModel').mockImplementation(() => new Promise<void>(resolve => { done = resolve; }));
    const first = f.manager.start(f.settings, new AbortController().signal);
    (f.manager as any).process = { exitCode: null }; // Spawned, but not yet healthy.
    let secondReady = false;
    const second = f.manager.start(f.settings, new AbortController().signal).then(() => { secondReady = true; });
    await tick(); expect(secondReady).toBe(false); done(); await Promise.all([first, second]);
    (f.manager as any).process = undefined; f.manager.stop();
});
test('a failed larger-package launch gets one bounded installed-Q8 retry', async () => {
    const f = fixture(); (audioHardware as jest.Mock).mockReturnValue(hardware(6, 12));
    const launch = jest.spyOn(f.manager as any, 'launchModel').mockRejectedValueOnce(new Error('Allocation failed')).mockResolvedValueOnce(undefined);
    await f.manager.start({ ...f.settings, managedModel: 'hoppou-f16' }, new AbortController().signal);
    expect(launch.mock.calls.map(call => (call[0] as any).managedModel)).toEqual(['hoppou-f16', 'hoppou-q8']); f.manager.stop();
});
test('temporary pressure waits then starts automatically when memory returns', async () => {
    jest.useFakeTimers(); const f = fixture(); (audioHardware as jest.Mock).mockReturnValue(hardware(1.5));
    const launch = jest.spyOn(f.manager as any, 'launchModel').mockResolvedValue(undefined);
    const result = f.manager.start(f.settings, new AbortController().signal);
    expect(launch).not.toHaveBeenCalled(); expect(f.report).toHaveBeenCalledWith(expect.stringContaining('Waiting'));
    (audioHardware as jest.Mock).mockReturnValue(hardware()); await jest.advanceTimersByTimeAsync(2000); await result;
    expect(launch).toHaveBeenCalledTimes(1); f.manager.stop();
});
test('explicit unload cancels the memory wait before it can spawn a late server', async () => {
    jest.useFakeTimers(); const f = fixture(); (audioHardware as jest.Mock).mockReturnValue(hardware(1.5));
    const launch = jest.spyOn(f.manager as any, 'launchModel').mockResolvedValue(undefined);
    const result = f.manager.start(f.settings, new AbortController().signal);
    const rejected = expect(result).rejects.toThrow('hosting stopped'); f.manager.stop(); await rejected;
    await jest.advanceTimersByTimeAsync(20_000); expect(launch).not.toHaveBeenCalled();
});
test('pressure monitor tolerates a transient dip then unloads only its owned child after two critical samples', async () => {
    jest.useFakeTimers(); const f = fixture(); const child = Object.assign(new EventEmitter(), { exitCode: null as number | null,
        kill: jest.fn(() => { child.exitCode = 0; child.emit('exit', 0); return true; }) });
    (f.manager as any).process = child; (f.manager as any).ready = true; f.manager.activeModel = 'hoppou-q8'; (f.manager as any).watchPressure();
    (audioHardware as jest.Mock).mockReturnValue(hardware(.8)); await jest.advanceTimersByTimeAsync(1500); expect(child.kill).not.toHaveBeenCalled();
    (audioHardware as jest.Mock).mockReturnValue(hardware()); await jest.advanceTimersByTimeAsync(1500);
    (audioHardware as jest.Mock).mockReturnValue(hardware(.8)); await jest.advanceTimersByTimeAsync(3000);
    expect(child.kill).toHaveBeenCalledTimes(1); expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(f.pressure).toHaveBeenCalledWith(expect.stringContaining('saved voices are retained'));
    expect(f.manager.running).toBe(false); expect(f.manager.activeModel).toBeUndefined(); f.manager.stop();
});
