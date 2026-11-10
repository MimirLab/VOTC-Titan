import { CudaBreezePackage } from '../../src/main/audio/CudaBreezePackage';
import { CUDA_MODELS, CUDA_SIDECARS } from '../../src/main/audio/cudaModelCatalog';
import { BREEZE_MODELS } from '../../src/main/audio/modelCatalog';
import fs from 'fs';
import os from 'os';
import path from 'path';
test('an unsupported CUDA host rejects before creating environments or downloading weights', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-cuda-')); const download = jest.fn();
    const cuda = new CudaBreezePackage(root, download, jest.fn(), () => {});
    jest.spyOn(cuda, 'hardware').mockRejectedValue(new Error('No compatible CUDA GPU'));
    try {
        await expect(cuda.install('cuda-hybrid', new AbortController().signal)).rejects.toThrow('CUDA GPU');
        expect(download).not.toHaveBeenCalled(); expect(fs.readdirSync(root)).toEqual([]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('complete CUDA download sizes include the independent codec and tokenizer; runtime formats remain distinct', () => {
    const sidecars = CUDA_SIDECARS.reduce((sum, artifact) => sum + artifact.bytes, 0);
    for (const model of Object.values(CUDA_MODELS)) {
        expect(model.bytes).toBe(model.weightsBytes + sidecars); expect(model.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(model.file).toMatch(/safetensors$/);
    }
    expect(BREEZE_MODELS['hoppou-q8'].file).toMatch(/gguf$/);
    expect(CUDA_SIDECARS.some(file => file.file === 'audio_tokenizer/model.safetensors')).toBe(true);
});
