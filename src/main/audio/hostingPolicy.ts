import type { AudioHardware } from './hardware';
import { BREEZE_MODELS } from './modelCatalog';
import type { AudioSettings } from '../../shared/audio';

export type ManagedModel = AudioSettings['managedModel'];
const GiB = 1024 ** 3;
export const gib = (bytes: number) => (bytes / GiB).toFixed(1) + ' GiB';
export interface HostingPlan { model: ManagedModel; ready: boolean; requiredRAM: number; requiredVRAM?: number; reason: string }

/** The lower host-RAM budget applies only to a known discrete Vulkan device.
 * Process-cold RX6800XT load/design/clone measurements are retained in the audio guide.
 * Unknown/unified/multiple-device setups retain conservative host-RAM requirements.
 */
export function hostingPlan(model: ManagedModel, hardware: AudioHardware): HostingPlan {
    const cuda = model.startsWith('cuda-');
    const gpu = hardware.gpus.length === 1 ? hardware.gpus[0] : undefined;
    const discreteVulkan = !cuda && !!gpu && gpu.totalBytes > 0;
    const requiredRAM = discreteVulkan ? 2 * GiB : BREEZE_MODELS[model].minimumFreeRAM;
    const requiredVRAM = cuda ? undefined : model === 'hoppou-f16' ? 9 * GiB : 6 * GiB;
    const gpuBlocked = requiredVRAM !== undefined && hardware.gpus.some(device => device.freeBytes < requiredVRAM);
    const incompatibleCUDA = cuda && hardware.gpus.length > 0 && hardware.gpus.every(device => device.vendor !== 'NVIDIA');
    const available = `System RAM ${gib(hardware.availableRAMBytes)} available / ${gib(requiredRAM)} needed` +
        (gpu && requiredVRAM !== undefined ? `; GPU memory ${gib(gpu.freeBytes)} free / ${gib(requiredVRAM)} needed` : '');
    return { model, ready: hardware.availableRAMBytes >= requiredRAM && !gpuBlocked && !incompatibleCUDA,
        requiredRAM, requiredVRAM, reason: incompatibleCUDA ? 'The selected CUDA package needs an NVIDIA GPU. ' + available : available };
}

/** Prefer the player's selection. Fall back only to already installed compact Vulkan Q8. */
export function chooseHosting(preferred: ManagedModel, installed: (model: ManagedModel) => boolean, hardware: AudioHardware): HostingPlan | undefined {
    if (installed(preferred)) {
        const selected = hostingPlan(preferred, hardware); if (selected.ready) return selected;
    }
    if (preferred !== 'hoppou-q8' && installed('hoppou-q8')) {
        const compact = hostingPlan('hoppou-q8', hardware); if (compact.ready) return compact;
    }
    return;
}

/** Swap occupancy alone is not pressure: use current reclaimable RAM and device headroom. */
export function hostingPressure(hardware: AudioHardware): string | undefined {
    if (hardware.availableRAMBytes < GiB) return `available system RAM fell to ${gib(hardware.availableRAMBytes)}`;
    if (hardware.gpus.length === 1 && hardware.gpus[0].freeBytes < 384 * 1024 ** 2)
        return `free GPU memory fell to ${gib(hardware.gpus[0].freeBytes)}`;
    return;
}
