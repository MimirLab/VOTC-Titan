import { AudioSettings } from '../../shared/audio';
import { requirePCM } from './pcm';
/** Optional user-selected speech service. No automatic paid fallback or voice-design request. */
export async function sideSpeech(settings: AudioSettings, text: string, instruction: string, signal: AbortSignal,
    onPCM: (bytes: Buffer) => Promise<void>): Promise<void> {
    if (!settings.sideVoiceId) throw new Error('Choose a provider voice ID in Audio settings.');
    const base = settings.endpoint.replace(/\/$/, ''); const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid speech endpoint.');
    const eleven = settings.provider === 'elevenlabs';
    const route = eleven ? `/v1/text-to-speech/${encodeURIComponent(settings.sideVoiceId)}/stream?output_format=pcm_24000` : '/audio/speech';
    const response = await fetch(base + route, { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', ...(settings.apiKey ? { [eleven ? 'xi-api-key' : 'Authorization']: eleven ? settings.apiKey : 'Bearer ' + settings.apiKey } : {}) },
        body: JSON.stringify(eleven ? { text, model_id: settings.model } :
            { input: text, voice: settings.sideVoiceId, model: settings.model, instructions: instruction, response_format: 'pcm' }) });
    if (!response.ok || !response.body) throw new Error(`Speech connection failed (${response.status}).`);
    requirePCM(response);
    let size = 0;
    for await (const chunk of response.body as any) { signal.throwIfAborted(); const bytes = Buffer.from(chunk); size += bytes.length;
        if (size > 48_000 * 600) throw new Error('Speech exceeded the ten-minute audio limit.'); await onPCM(bytes); }
    if (!size || size % 2) throw new Error('Speech returned an incomplete PCM stream.');
}
