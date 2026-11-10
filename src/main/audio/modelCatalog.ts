/** Pinned, runtime-specific artifacts. Sizes describe downloads, not peak memory. */
import { CUDA_MODELS } from './cudaModelCatalog';
const hub = 'https://huggingface.co/HoppouAI/Breeze-TTS-2.cpp/resolve/81b22bad9f05b99970e30c5ee5e4bbc52fedf2f8/';
export const VULKAN_MODELS = {
    'hoppou-q8': { label: 'Breeze Q8 · Vulkan', file: 'breeze-tts-2-q8_0.gguf', bytes: 3568844480,
        sha256: 'a02bcc4b69b0601032727f8040c4942149b1b73aa0f69022fe5aaa6a8f0ef879',
        url: hub + 'breeze-tts-2-q8_0.gguf', minimumFreeRAM: 5 * 1024 ** 3,
        note: 'Compact Vulkan candidate for AMD, NVIDIA and Intel. Quality must be checked against F16 on your hardware.' },
    'hoppou-f16': { label: 'Breeze F16 · Vulkan', file: 'breeze-tts-2-f16.gguf', bytes: 6279630784,
        sha256: 'db740cd464d75f2635a891586f083c5b466fd63542bebd957fe7890324b04c35',
        url: hub + 'breeze-tts-2-f16.gguf', minimumFreeRAM: 8 * 1024 ** 3,
        note: 'Vulkan reference precision. More memory and disk space; download size does not establish peak VRAM.' }
} as const;
export const BREEZE_MODELS = { ...VULKAN_MODELS, ...CUDA_MODELS } as const;
export const BREEZE_RUNTIME = {
    url: 'https://github.com/HoppouAI/Breeze-TTS-2.cpp/releases/download/v0.1.0/breeze-tts-2-v0.1.0-linux-x64-vulkan.tar.gz',
    sha256: '41f309bea160cdeb3c01721f97ea66125b4047a5726b01fd5559f1abb608b2a0', bytes: 72195854,
    directory: 'breeze-tts-2-v0.1.0-linux-x64-vulkan'
};
