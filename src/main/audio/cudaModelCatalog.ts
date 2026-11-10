/** Pinned CUDA recipes; these files are incompatible with the Vulkan engine. */
export const CUDA_RUNTIME = {
    "url": "https://codeload.github.com/remominor/breeze-tts-api/tar.gz/22ab8c6586b8b9891d52c5bb724888e9669dbe64",
    "bytes": 287836,
    "sha256": "568a674388efdd7828aad46b9af6fee4bb9eefdff7db2321a2e2c70f8493b323",
    "directory": "breeze-tts-api-22ab8c6586b8b9891d52c5bb724888e9669dbe64"
} as const;
export const CUDA_UV = {
    "url": "https://github.com/astral-sh/uv/releases/download/0.9.9/uv-x86_64-unknown-linux-gnu.tar.gz",
    "bytes": 21323902,
    "sha256": "9ec303873e00deed44d1b2b52b85ab7aa55d849588d7242298748390eaea07ef",
    "directory": "uv-x86_64-unknown-linux-gnu"
} as const;
export const CUDA_SIDECARS = [
    {
        "file": "config.json",
        "bytes": 10161,
        "sha256": "57849eb756ca1602efe89afcc5c70379dd127f8deeb9f655204d4340190ea929",
        "url": "https://huggingface.co/drbaph/Breeze-TTS-2-comfyui/resolve/a6bfd9d0d4e8b3b61c3a5ed3ecf55468c8ab88e4/config.json"
    },
    {
        "file": "generation_config.json",
        "bytes": 251,
        "sha256": "2ef3f2c0ab8d9ad241059138a795433c5410fd9954efb9625674ecd2a9529434",
        "url": "https://huggingface.co/drbaph/Breeze-TTS-2-comfyui/resolve/a6bfd9d0d4e8b3b61c3a5ed3ecf55468c8ab88e4/generation_config.json"
    },
    {
        "file": "tokenizer_config.json",
        "bytes": 1157960,
        "sha256": "2c084fd6725c2284e8aa6da095a8d036d48fe79665595bfcd50371821b620e44",
        "url": "https://huggingface.co/drbaph/Breeze-TTS-2-comfyui/resolve/a6bfd9d0d4e8b3b61c3a5ed3ecf55468c8ab88e4/tokenizer_config.json"
    },
    {
        "file": "audio_tokenizer/config.json",
        "bytes": 2336,
        "sha256": "ee65bb901c876664ab8707c487157aa1a6ee57c65969b28fb5ec9dc211e68167",
        "url": "https://huggingface.co/drbaph/Breeze-TTS-2-comfyui/resolve/a6bfd9d0d4e8b3b61c3a5ed3ecf55468c8ab88e4/audio_tokenizer/config.json"
    },
    {
        "file": "audio_tokenizer/configuration.json",
        "bytes": 76,
        "sha256": "6bc26d64eb5024b4d1dab5a52371958b429256d6c9d59787f1f5294a54e0cebd",
        "url": "https://huggingface.co/drbaph/Breeze-TTS-2-comfyui/resolve/a6bfd9d0d4e8b3b61c3a5ed3ecf55468c8ab88e4/audio_tokenizer/configuration.json"
    },
    {
        "file": "audio_tokenizer/preprocessor_config.json",
        "bytes": 234,
        "sha256": "fcb3805e597e786d4067706e602f6688524640f8d3396790e2e09b5942fcbdfb",
        "url": "https://huggingface.co/drbaph/Breeze-TTS-2-comfyui/resolve/a6bfd9d0d4e8b3b61c3a5ed3ecf55468c8ab88e4/audio_tokenizer/preprocessor_config.json"
    },
    {
        "file": "special_tokens_map.json",
        "bytes": 886,
        "sha256": "194f265bb588d142a16f27d9576104eb3dab3d7ba9961541d2d6e3d5e77e6470",
        "url": "https://huggingface.co/drbaph/Breeze-TTS-2-comfyui/resolve/a6bfd9d0d4e8b3b61c3a5ed3ecf55468c8ab88e4/special_tokens_map.json"
    },
    {
        "file": "tokenizer.json",
        "bytes": 33386945,
        "sha256": "d3ec9ac3eb2392389b9f5112e85d8b43316494addb587ba7b7a9d61eac23af96",
        "url": "https://huggingface.co/drbaph/Breeze-TTS-2-comfyui/resolve/a6bfd9d0d4e8b3b61c3a5ed3ecf55468c8ab88e4/tokenizer.json"
    },
    {
        "file": "audio_tokenizer/model.safetensors",
        "bytes": 682293092,
        "sha256": "836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258",
        "url": "https://huggingface.co/drbaph/Breeze-TTS-2-comfyui/resolve/a6bfd9d0d4e8b3b61c3a5ed3ecf55468c8ab88e4/audio_tokenizer/model.safetensors"
    }
] as const;
export const CUDA_MODELS = {
    "cuda-hybrid": {
        "label": "Breeze selective ConvRot hybrid \u00b7 CUDA",
        "file": "cuda-hybrid/Breeze-TTS-2-int8-hybrid.safetensors",
        "url": "https://huggingface.co/drbaph/Breeze-TTS-2-comfyui/resolve/a6bfd9d0d4e8b3b61c3a5ed3ecf55468c8ab88e4/Breeze-TTS-2-int8-hybrid.safetensors",
        "sha256": "e9f80ab9976caa3b5905e3d87e71d053aad8fae6b0e75caecbca9efdcf1cb2c8",
        "weightsBytes": 4863779632,
        "bytes": 5580631573,
        "minimumFreeRAM": 8589934592,
        "minimumFreeVRAM": 10737418240,
        "runtime": "cuda",
        "note": "NVIDIA CUDA candidate: backbone and encoder use selective INT8 ConvRot; depth decoder stays BF16. Not benchmarked on this AMD machine."
    },
    "cuda-bf16": {
        "label": "Breeze BF16 reference \u00b7 CUDA",
        "file": "cuda-bf16/model.safetensors",
        "url": "https://huggingface.co/drbaph/Breeze-TTS-2-comfyui/resolve/a6bfd9d0d4e8b3b61c3a5ed3ecf55468c8ab88e4/Breeze-TTS-2-bf16.safetensors",
        "sha256": "86fb2aba30c63e826393dba09168ebd6ef52278f0c0b57fb8dde4448e323300a",
        "weightsBytes": 6966557274,
        "bytes": 7683409215,
        "minimumFreeRAM": 8589934592,
        "minimumFreeVRAM": 13958643712,
        "runtime": "cuda",
        "note": "NVIDIA CUDA reference candidate. Requires a compatible CUDA GPU and an isolated Python runtime. Not benchmarked here."
    }
} as const;
