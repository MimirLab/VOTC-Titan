/** Shared playback processing. Original identity WAVs and provider PCM stay untouched. */
export function createVoiceOutput(context: BaseAudioContext) {
    const input = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12; compressor.knee.value = 6; compressor.ratio.value = 4;
    compressor.attack.value = 0.003; compressor.release.value = 0.15;
    const limiter = context.createWaveShaper();
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) {
        const x = i * 2 / (curve.length - 1) - 1, a = Math.abs(x);
        curve[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.17 * Math.tanh((a - 0.8) / 0.17));
    }
    limiter.curve = curve; limiter.oversample = '2x';
    const volume = context.createGain();
    input.connect(compressor); compressor.connect(limiter); limiter.connect(volume); volume.connect(context.destination);
    return { input, setLevel(value: number, thought = false) {
        // Up to 12 dB of useful headroom; compression contains peaks, then a soft ceiling
        // stays below full scale. Thoughts retain softer delivery and a further 3 dB reduction.
        input.gain.value = thought ? 2.8 : 4;
        volume.gain.value = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.8;
    } };
}
