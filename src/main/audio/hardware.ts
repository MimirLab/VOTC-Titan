import fs from 'fs';
import os from 'os';
import path from 'path';
export interface AudioHardware { ramBytes: number; availableRAMBytes: number; gpus: { vendor: string; totalBytes: number; freeBytes: number }[] }
export function audioHardware(): AudioHardware {
    const result: AudioHardware = { ramBytes: os.totalmem(), availableRAMBytes: os.freemem(), gpus: [] };
    if (process.platform !== 'linux') return result;
    try {
        const available = fs.readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB/m);
        if (available) result.availableRAMBytes = Number(available[1]) * 1024;
        for (const card of fs.readdirSync('/sys/class/drm').filter(name => /^card\d+$/.test(name))) {
            const device = path.join('/sys/class/drm', card, 'device');
            try {
                const vendor = fs.readFileSync(path.join(device, 'vendor'), 'utf8').trim();
                const total = Number(fs.readFileSync(path.join(device, 'mem_info_vram_total'), 'utf8').trim());
                const used = Number(fs.readFileSync(path.join(device, 'mem_info_vram_used'), 'utf8').trim());
                if (total > 0 && Number.isFinite(used)) result.gpus.push({ vendor: vendor === '0x1002' ? 'AMD' : vendor === '0x10de' ? 'NVIDIA' : 'GPU', totalBytes: total, freeBytes: Math.max(0, total - used) });
            } catch { /* Unified-memory/other drivers may not export discrete VRAM. */ }
        }
    } catch { /* Keep the platform's memory reading if optional discovery is unavailable. */ }
    return result;
}
