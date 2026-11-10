/** Audio is opt-in. No model download, generation or process starts from these defaults. */
export interface AudioSettings {
    enabled: boolean;
    provider: 'breeze' | 'openai-speech' | 'elevenlabs';
    hosting: 'managed' | 'external';
    endpoint: string;
    apiKey: string;
    model: string;
    sideVoiceId: string;
    thoughts: boolean;
    narrator: boolean;
    playerSpeech: boolean;
    volume: number;
    cfgScale: number;
    cueMode: 'whole' | 'passage';
    managedModel: 'hoppou-f16' | 'hoppou-q8' | 'cuda-hybrid' | 'cuda-bf16';
    idleMinutes: number;
}
export const DEFAULT_AUDIO: Readonly<AudioSettings> = Object.freeze({
    enabled: false, provider: 'breeze', hosting: 'managed', endpoint: 'http://127.0.0.1:18891',
    apiKey: '', model: 'breeze', sideVoiceId: '', thoughts: true, narrator: false,
    playerSpeech: false, volume: 0.8, cfgScale: 4, cueMode: 'whole', managedModel: 'hoppou-q8', idleMinutes: 10
});
export function normalizeAudio(input?: Partial<AudioSettings>): AudioSettings {
    const result = { ...DEFAULT_AUDIO, ...input };
    for (const key of ['enabled', 'thoughts', 'narrator', 'playerSpeech'] as const) result[key] = result[key] === true;
    if (!['breeze', 'openai-speech', 'elevenlabs'].includes(result.provider)) result.provider = 'breeze';
    if (!['managed', 'external'].includes(result.hosting)) result.hosting = 'managed';
    result.cueMode = result.cueMode === 'passage' ? 'passage' : 'whole';
    if (!['hoppou-f16', 'hoppou-q8', 'cuda-hybrid', 'cuda-bf16'].includes(result.managedModel)) result.managedModel = 'hoppou-q8';
    for (const key of ['endpoint', 'apiKey', 'model', 'sideVoiceId'] as const) result[key] = typeof result[key] === 'string' ? result[key].trim() : DEFAULT_AUDIO[key];
    const clamp = (value: number, lo: number, hi: number, fallback: number) => Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : fallback;
    result.volume = clamp(result.volume, 0, 1, 0.8);
    result.cfgScale = clamp(result.cfgScale, 1, 8, 4);
    result.idleMinutes = clamp(result.idleMinutes, 1, 60, 10);
    return result;
}
export interface DeliveryCue { passage?: number; direction: string }
export interface VoiceProfile {
    id: string; campaign: string; characterId: string; label: string; revision: number;
    instruction: string; seed: number; referenceFile?: string; referenceText?: string;
    provenance: string; createdAt: string;
    referenceMetadata?: { model: string; runtime: string; cfgScale: number; sampleRate: number; seed: number; instruction: string };
}
export interface AudioSegment { kind: 'speech' | 'thought' | 'narration'; text: string; passage: number }
export interface AudioStatus { state: 'disabled' | 'idle' | 'preparing' | 'speaking' | 'paused' | 'error'; message: string; enabled?: boolean }
