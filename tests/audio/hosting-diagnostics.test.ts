import { audioHostingIssue, breezeStartupIssue } from '../../src/main/audio/hostingDiagnostics';

test.each([
    ['driver: VK_ERROR_OUT_OF_DEVICE_MEMORY PRIVATE-PATH', 'gpu_memory_exhausted'],
    ['CUDA out of memory PRIVATE', 'gpu_memory_exhausted'],
    ['vkAllocateMemory failed: VK_ERROR_OUT_OF_HOST_MEMORY', 'host_memory_exhausted'],
    ['terminate: std::bad_alloc PRIVATE', 'host_memory_exhausted'],
    ['VK_ERROR_DEVICE_LOST PRIVATE', 'gpu_device_lost']
])('startup category keeps only a fixed reason for %s', (input, reason) => {
    expect(breezeStartupIssue(input)).toBe(reason);
    expect(breezeStartupIssue(input)).not.toContain('PRIVATE');
});
test('unrecognized startup output and memory mentions do not become a claimed OOM', () => {
    expect(breezeStartupIssue('Using 8GB memory on Vulkan, loading model PRIVATE')).toBeUndefined();
    expect(breezeStartupIssue('Failed to start PRIVATE')).toBeUndefined();
});
test('hosting status preserves GPU/RAM guard distinctions without emitting its arbitrary suffix', () => {
    expect(audioHostingIssue('Breeze exceeded its GPU-hosting RAM budget PRIVATE')).toBe('startup_ram_guard');
    expect(audioHostingIssue('Breeze needs a usable Vulkan GPU PRIVATE')).toBe('vulkan_unavailable');
    expect(audioHostingIssue('Voice hosting is waiting for more memory. PRIVATE')).toBe('memory_wait');
    expect(audioHostingIssue('The voice PRIVATE was prepared')).toBeUndefined();
});
