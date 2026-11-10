import fs from 'fs';
import { selectedFamilyPreset } from './familyPerformance';
import { applyFamilyEffects, FAMILY_PCM_LIMIT } from './familyEffects';
import { createHash } from 'crypto';
import { AudioSettings, VoiceProfile, AudioSegment } from '../../shared/audio';
import { DemonFamily, isDemonFamily } from './demonVoices';
import { cloneIdentity } from './CloneBanks';
import { AudioLibrary } from './AudioLibrary';
import { pcmToWav, requirePCM } from './pcm';
import { AUDIO_SENTENCE_LIMIT } from './audioPhrasing';
import { CloneAgeBand } from './cloneAge';
import { isMaturityStage, isAdultMaturity, MaturityStage } from './maturation';

export class BreezeProvider {
    private protocol?: 'hoppou' | 'standalone';
    private verifiedVoices = new Set<string>();
    constructor(readonly settings: AudioSettings, private library: AudioLibrary) {}
    private url(route: string): string {
        const url = new URL(this.settings.endpoint);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS speech endpoint without embedded credentials.');
        return this.settings.endpoint.replace(/\/$/, '') + route;
    }
    private headers(json = false): Record<string, string> {
        return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(this.settings.apiKey ? { Authorization: 'Bearer ' + this.settings.apiKey } : {}) };
    }
    private async post(route: string, body: FormData, signal: AbortSignal): Promise<Response> {
        for (let attempt = 0; ; attempt++) {
            signal.throwIfAborted();
            const response = await fetch(this.url(route), { method: 'POST', headers: this.headers(), body, signal });
            if (response.status !== 409 || attempt >= 12) return response;
            await response.body?.cancel(); await new Promise(resolve => setTimeout(resolve, 250));
        }
    }
    async health(signal: AbortSignal): Promise<any> {
        const response = await fetch(this.url('/health'), { headers: this.headers(), signal });
        if (!response.ok) throw new Error(`Breeze health check failed (${response.status}).`);
        const info = await response.json() as any;
        if (info.ready === false) throw new Error('Breeze is connected but its model is not loaded.');
        if (info.sample_rate !== undefined && info.sample_rate !== 24000) throw new Error('This Breeze connection must return mono audio at 24 kHz.');
        this.protocol = info.model_id === 'breeze-tts-2' || 'hybrid_quantized' in info ? 'standalone' : 'hoppou';
        return info;
    }
    async speech(text: string, instruction: string, profile: VoiceProfile, signal: AbortSignal,
        onPCM?: (chunk: Buffer) => Promise<void>, options: { familyKey?: string; singleUtterance?: boolean; deliveryKind?: AudioSegment['kind']; demonFamily?: DemonFamily; cloneAge?: CloneAgeBand; maturity?: MaturityStage; undead?: boolean } = {}): Promise<Buffer> {
        if (options.singleUtterance && text.length > AUDIO_SENTENCE_LIMIT)
            throw new Error('The planned voice utterance exceeds its safe sentence limit.');
        if (!this.protocol) await this.health(signal);
        // Ordinary cloned speech keeps reference guidance. Only explicit age,
        // undeath and whisper delivery may raise clone guidance; Race never does.
        if (options.demonFamily !== undefined && !isDemonFamily(options.demonFamily)) throw new Error('Unknown demonic voice performance.');
        if (options.cloneAge !== undefined && !['young-child','child','adolescent','youthful-adult','older','elderly'].includes(options.cloneAge)) throw new Error('Unknown cloned voice age performance.');
        if (options.maturity !== undefined && !isMaturityStage(options.maturity)) throw new Error('Unknown character maturity.');
        if(options.undead!==undefined&&typeof options.undead!=='boolean')throw new Error('Unknown undead voice performance.');
        const child = options.maturity && !isAdultMaturity(options.maturity) || options.cloneAge && ['young-child','child','adolescent'].includes(options.cloneAge);
        const familyPreset = selectedFamilyPreset(profile, options.familyKey);
        const clone = cloneIdentity(profile), cfgScale = child || options.undead ? 2 : clone
            ? options.deliveryKind === 'thought' ? 2 : options.cloneAge ? 1.5 : 1
            : options.deliveryKind === 'thought' && familyPreset?.mode === 'reference' ? 2 : familyPreset?.cfgScale ?? this.settings.cfgScale;
        console.info('[Audio synthesis receipt] ' + JSON.stringify({ voiceId: profile.id, cloneBank: clone?.key ?? null,
            cfgScale, familyKey:familyPreset?.key??null, effect:familyPreset?.effectAlgorithm??null, deliveryKind: options.deliveryKind ?? null, demonFamily: options.demonFamily ?? null, cloneAge: options.cloneAge ?? null, maturity: options.maturity ?? null, undead:options.undead??false, textDigest: createHash('sha256').update(text).digest('hex'), textCharacters: text.length,
            referenceHash: clone?.audioHash ?? null, instructionDigest: createHash('sha256').update(instruction).digest('hex') }));
        const form = new FormData();
        form.set('text', text); form.set('instruction', instruction); form.set('cfg_scale', String(cfgScale));
        form.set('seed', String(profile.seed)); form.set('response_format', 'pcm');
        if (options.singleUtterance && this.protocol === 'hoppou') {
            // The audio planner already chose safe complete units. Do not allow
            // a server's configured character splitter to fragment them again.
            form.set('split_chars', '0');
            form.set('max_new_tokens', String(Math.max(750, Math.ceil(text.length * 1.5))));
        }
        if (this.protocol === 'standalone') { form.set('guidance_scale', String(cfgScale)); form.set('response_format', 'pcm'); form.set('stream', 'true'); }
        if (profile.referenceFile && profile.referenceText) {
            // Saved codes are an optimization; original WAV and transcript remain the durable identity.
            const voiceId = 'titan-' + profile.id + '-' + createHash('sha256').update(this.settings.model).digest('hex').slice(0, 8);
            const registration = new FormData();
            registration.set('name', voiceId);
            if (this.protocol === 'standalone') registration.set('overwrite', 'true');
            registration.set(this.protocol === 'standalone' ? 'voice_file' : 'ref_audio', new Blob([new Uint8Array(fs.readFileSync(profile.referenceFile))], { type: 'audio/wav' }), 'reference.wav');
            registration.set('ref_text', profile.referenceText);
            let registered = this.verifiedVoices.has(voiceId);
            if (!registered && this.library.codec(profile, this.settings.endpoint, this.settings.model)) {
                const response = await fetch(this.url(this.protocol === 'standalone' ? '/v1/audio/voices' : '/v1/voices'), { headers: this.headers(), signal });
                if (response.ok) {
                    const data = await response.json() as any; const voices = Array.isArray(data) ? data : data.voices ?? data.data ?? [];
                    registered = voices.some((voice: any) => voice.id === voiceId || voice.voice_id === 'clone:' + voiceId || voice.voice_id === voiceId);
                }
            }
            if (!registered) {
                const saved = await this.post(this.protocol === 'standalone' ? '/v1/upload_voice' : '/v1/voices', registration, signal);
                if (!saved.ok) throw new Error(`Breeze could not register the saved voice (${saved.status}).`);
                this.library.bindCodec(profile, this.settings.endpoint, this.settings.model, voiceId);
            }
            this.verifiedVoices.add(voiceId);
            if (this.protocol === 'standalone') form.set('voice', 'clone:' + voiceId); else form.set('voice_id', voiceId);
        }
        const response = await this.post('/v1/audio/speech', form, signal);
        if (!response.ok || !response.body) throw new Error(`Breeze speech request failed (${response.status}).`);
        requirePCM(response);
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of response.body as any) {
            signal.throwIfAborted(); const bytes = Buffer.from(chunk); size += bytes.length;
            if (size > 48_000 * 600) throw new Error('Speech exceeded the ten-minute audio limit.');
            if (familyPreset?.effect && size > FAMILY_PCM_LIMIT) throw new Error('Demon voice processing exceeded its utterance limit.');
            if (onPCM && !familyPreset?.effect) await onPCM(bytes); else chunks.push(bytes);
        }
        if (!size || size % 2) throw new Error('Breeze returned an incomplete PCM stream.');
        if (familyPreset?.effect) {
            const processed = await applyFamilyEffects(Buffer.concat(chunks), familyPreset, signal);
            if (onPCM) { await onPCM(processed); return Buffer.alloc(0); }
            return pcmToWav(processed);
        }
        return onPCM ? Buffer.alloc(0) : pcmToWav(Buffer.concat(chunks));
    }
}
