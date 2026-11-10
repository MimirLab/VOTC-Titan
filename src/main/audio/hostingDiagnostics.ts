/** Startup stderr is classified locally; arbitrary process output is never logged. */
export function breezeStartupIssue(text: string): 'gpu_memory_exhausted' | 'gpu_device_lost' | 'host_memory_exhausted' | undefined {
    if (/VK_ERROR_OUT_OF_DEVICE_MEMORY|CUDA out of memory|hipErrorOutOfMemory/iu.test(text)) return 'gpu_memory_exhausted';
    if (/VK_ERROR_DEVICE_LOST|CUDA_ERROR_DEVICE_LOST/iu.test(text)) return 'gpu_device_lost';
    if (/std::bad_alloc|VK_ERROR_OUT_OF_HOST_MEMORY|Cannot allocate memory/iu.test(text)) return 'host_memory_exhausted';
}
export function audioHostingIssue(message: string): string | undefined {
    const known: readonly [string, string][] = [
        ['Voice hosting is waiting for more memory.', 'memory_wait'],
        ['Available memory changed before loading Breeze.', 'memory_changed'],
        ['Breeze exceeded its GPU-hosting RAM budget', 'startup_ram_guard'],
        ['Breeze needs a usable Vulkan GPU', 'vulkan_unavailable'],
        ['The local Breeze port is already in use.', 'port_busy'],
        ['Breeze could not start.', 'start_failed'],
        ['Breeze did not become ready within three minutes.', 'start_timeout'],
        ['Breeze is connected but its model is not loaded.', 'model_not_loaded'],
        ['Voice hosting released its model because', 'pressure_release'],
    ];
    return known.find(([literal]) => message.startsWith(literal))?.[1];
}
