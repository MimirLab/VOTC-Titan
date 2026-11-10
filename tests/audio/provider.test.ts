import fs from 'fs';
import path from 'path';
import os from 'os';
import { BreezeProvider } from '../../src/main/audio/BreezeProvider';
import { AudioLibrary } from '../../src/main/audio/AudioLibrary';
import { normalizeAudio } from '../../src/shared/audio';
import { cloneFixture } from './clone-fixture';
import { readCloneBank } from '../../src/main/audio/CloneBanks';
import { pcmToWav } from '../../src/main/audio/pcm';
let root: string, library: AudioLibrary, original: typeof fetch;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-provider-')); library = new AudioLibrary(root); original = global.fetch; });
afterEach(() => { global.fetch = original; library.close(); fs.rmSync(root, { recursive: true, force: true }); });
const signal = () => new AbortController().signal;
const response = (value: object) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
test('the released Hoppou readiness shape is accepted and its headerless PCM becomes a real reference WAV', async () => {
    const profile = library.save('campaign', '2', 'Actor', 'A clear resonant voice with steady natural articulation.', 'synthetic');
    const pcm = Buffer.from([1, 2, 3, 4]);
    const requests: { url: string; body?: FormData }[] = [];
    global.fetch = jest.fn(async (url, options) => {
        requests.push({ url: String(url), body: options?.body as FormData });
        return String(url).endsWith('/health') ? response({ status: 'ok', sample_rate: 24000, ws_port: 0 }) : new Response(pcm);
    });
    const provider = new BreezeProvider(normalizeAudio({ endpoint: 'http://127.0.0.1:18892' }), library);
    const wav = await provider.speech('Grog maen.', 'A mature adult speaking neutrally.', profile, signal());
    expect(wav).toEqual(pcmToWav(pcm));
    expect(requests[1].body!.get('text')).toBe('Grog maen.'); expect(requests[1].body!.get('cfg_scale')).toBe('4');
    expect(requests[1].body!.get('seed')).toBe(String(profile.seed));
});
test('lost server caches are rebuilt from the durable original WAV without redesigning the voice', async () => {
    let profile = library.save('campaign', '2', 'Actor', 'A clear resonant voice with steady natural articulation.', 'synthetic');
    const wav = pcmToWav(Buffer.alloc(100)); profile = library.reference(profile, wav, 'The reference transcript.');
    const settings = normalizeAudio({ endpoint: 'http://127.0.0.1:18892', model: 'pinned-q8' });
    library.bindCodec(profile, settings.endpoint, settings.model, 'lost-remote-id');
    const requests: { url: string; options?: RequestInit }[] = [];
    global.fetch = jest.fn(async (url, options) => {
        requests.push({ url: String(url), options });
        if (String(url).endsWith('/health')) return response({ status: 'ok', sample_rate: 24000 });
        if (String(url).endsWith('/v1/voices')) return options?.method === 'POST' ? response({ id: 'saved' }) : response([]);
        return new Response(Buffer.alloc(100));
    });
    const provider = new BreezeProvider(settings, library);
    await provider.speech('Opaque heard syllables.', 'A young adult speaking naturally.', profile, signal(), async () => {});
    const upload = requests.find(r => r.url.endsWith('/v1/voices') && r.options?.method === 'POST')!.options!.body as FormData;
    expect(Buffer.from(await (upload.get('ref_audio') as Blob).arrayBuffer())).toEqual(wav);
    expect(upload.get('ref_text')).toBe('The reference transcript.');
    const speech = requests.find(r => r.url.endsWith('/v1/audio/speech'))!.options!.body as FormData;
    expect(speech.get('voice_id')).toBe(upload.get('name')); expect(speech.get('ref_audio')).toBeNull();
});
test('the standalone hybrid uses its own upload and direction fields', async () => {
    let profile = library.save('campaign', '2', 'Actor', 'A clear resonant voice with steady natural articulation.', 'synthetic');
    profile = library.reference(profile, pcmToWav(Buffer.alloc(100)), 'The reference transcript.');
    const requests: { url: string; options?: RequestInit }[] = [];
    global.fetch = jest.fn(async (url, options) => {
        requests.push({ url: String(url), options });
        if (String(url).endsWith('/health')) return response({ ready: true, model_id: 'breeze-tts-2', hybrid_quantized: true });
        if (String(url).endsWith('/v1/upload_voice')) return response({ profile_id: 'saved' });
        return new Response(Buffer.alloc(100));
    });
    await new BreezeProvider(normalizeAudio({ endpoint: 'http://127.0.0.1:18892' }), library)
        .speech('Visible thought.', 'Whisper softly and intimately.', profile, signal(), async () => {});
    const upload = requests.find(r => r.url.endsWith('/v1/upload_voice'))!.options!.body as FormData;
    const speech = requests.find(r => r.url.endsWith('/v1/audio/speech'))!.options!.body as FormData;
    expect(upload.get('voice_file')).toBeInstanceOf(Blob); expect(upload.get('ref_audio')).toBeNull();
    expect(speech.get('voice')).toBe('clone:' + upload.get('name')); expect(speech.get('guidance_scale')).toBe('4');
    expect(speech.get('stream')).toBe('true'); expect(speech.get('response_format')).toBe('pcm');
});
test('an incomplete PCM sample cannot become a saved reference', async () => {
    global.fetch = jest.fn(async url => String(url).endsWith('/health') ? response({ status: 'ok' }) : new Response(Buffer.alloc(3)));
    const profile = library.save('campaign', '2', 'Actor', 'A clear resonant voice with steady natural articulation.', 'synthetic');
    await expect(new BreezeProvider(normalizeAudio(), library).speech('Test.', 'Natural.', profile, signal())).rejects.toThrow('incomplete PCM');
    expect(library.get('campaign', '2')!.referenceFile).toBeUndefined();
});
test('a planned whole utterance disables Hoppou re-splitting while still streaming its first PCM before completion', async () => {
    const profile = library.save('campaign', '2', 'Actor', 'A clear resonant voice.', 'synthetic');
    let controller!: ReadableStreamDefaultController<Uint8Array>, form!: FormData;
    global.fetch = jest.fn(async (url, options) => {
        if (String(url).endsWith('/health')) return response({ status: 'ok', sample_rate: 24000 });
        form = options!.body as FormData;
        return new Response(new ReadableStream<Uint8Array>({ start(c) { controller = c; c.enqueue(new Uint8Array([1, 2])); } }));
    });
    let first!: () => void; const firstPCM = new Promise<void>(resolve => { first = resolve; }); const chunks: Buffer[] = [];
    let done = false;
    const pending = new BreezeProvider(normalizeAudio(), library).speech('If you, return before winter, I will wait.',
        'Speak naturally.', profile, signal(), async bytes => { chunks.push(bytes); first(); }, { singleUtterance: true }).then(() => { done = true; });
    await firstPCM;
    expect(done).toBe(false); expect(form.get('split_chars')).toBe('0'); expect(form.get('max_new_tokens')).toBe('750');
    expect(form.get('text')).toBe('If you, return before winter, I will wait.');
    controller.enqueue(new Uint8Array([3, 4])); controller.close(); await pending;
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3, 4]));
});
test('an unusually long intact sentence gets frame headroom and an unsafe planned request is refused before HTTP', async () => {
    const profile = library.save('campaign', '2', 'Actor', 'A clear resonant voice.', 'synthetic');
    let form!: FormData;
    global.fetch = jest.fn(async (url, options) => {
        if (String(url).endsWith('/health')) return response({ status: 'ok' });
        form = options!.body as FormData; return new Response(Buffer.alloc(100));
    });
    const provider = new BreezeProvider(normalizeAudio(), library);
    await provider.speech('a'.repeat(1000), 'Natural.', profile, signal(), undefined, { singleUtterance: true });
    expect(form.get('max_new_tokens')).toBe('1500'); expect(form.get('split_chars')).toBe('0');
    (global.fetch as jest.Mock).mockClear();
    await expect(provider.speech('a'.repeat(1501), 'Natural.', profile, signal(), undefined, { singleUtterance: true })).rejects.toThrow('safe sentence limit');
    expect(global.fetch).not.toHaveBeenCalled();
});
test.each(['text/html', 'application/json', 'audio/wav', 'audio/pcm;rate=48000'])('a successful HTTP response with %s never reaches playback', async type => {
    global.fetch = jest.fn(async url => String(url).endsWith('/health') ? response({ status: 'ok' }) :
        new Response(Buffer.alloc(100), { headers: { 'Content-Type': type } }));
    const profile = library.save('campaign', '2', 'Actor', 'A clear resonant voice with steady natural articulation.', 'synthetic');
    const playback = jest.fn();
    await expect(new BreezeProvider(normalizeAudio(), library).speech('Test.', 'Natural.', profile, signal(), playback)).rejects.toThrow(/PCM/);
    expect(playback).not.toHaveBeenCalled();
});

test.each(['hoppou','standalone'])('clones retain one reference while bounded guidance distinguishes speech, thoughts and agreed age/state modifiers on %s', async protocol => {
    const fixture = cloneFixture(path.join(root,'source')), bank = readCloneBank(fixture.folder), profile = library.importClone('campaign','thrall',bank), forms: FormData[] = [];
    global.fetch = jest.fn(async(url, init) => {
        if(String(url).endsWith('/health')) return response(protocol === 'standalone' ? {model_id:'breeze-tts-2'} : {status:'ok'});
        if(String(url).endsWith('/v1/voices') || String(url).endsWith('/v1/upload_voice')) return response({id:'ok'});
        forms.push(init!.body as FormData);return new Response(Buffer.alloc(100),{headers:{'Content-Type':'audio/pcm'}});
    });
    const provider = new BreezeProvider(normalizeAudio({cfgScale:4}),library);
    await provider.speech('I speak aloud.','calm',profile,signal(),undefined,{deliveryKind:'speech'});
    await provider.speech('I keep this thought.','Whisper throughout.',profile,signal(),undefined,{deliveryKind:'thought'});
    await provider.speech('The gate is shut.','Hollow resonance.',profile,signal(),undefined,{deliveryKind:'speech',demonFamily:'dreadlord'});
    await provider.speech('They must not hear.','Whisper throughout.',profile,signal(),undefined,{deliveryKind:'thought',demonFamily:'dreadlord'});
    await provider.speech('I remember the old road.','Naturally aged.',profile,signal(),undefined,{deliveryKind:'speech',cloneAge:'elderly'});
    await provider.speech('They must not hear.','Naturally aged whisper.',profile,signal(),undefined,{deliveryKind:'thought',cloneAge:'elderly'});
    await provider.speech('The road is quiet.','Speak through a damaged throat with a coarse, scraping rasp.',profile,signal(),undefined,{deliveryKind:'speech',undead:true});
    await provider.speech('I should wait.','Undead whisper.',profile,signal(),undefined,{deliveryKind:'thought',undead:true});
    await provider.speech('The road is quiet.','Normal.',profile,signal(),undefined,{deliveryKind:'speech',undead:false});
    expect(forms.map(f=>f.get('cfg_scale'))).toEqual(['1','2','1','2','1.5','2','2','2','1']);
    if(protocol==='standalone')expect(forms.map(f=>f.get('guidance_scale'))).toEqual(['1','2','1','2','1.5','2','2','2','1']);
    expect(new Set(forms.map(f=>f.get(protocol==='standalone'?'voice':'voice_id'))).size).toBe(1);
    expect(forms.every(f=>f.get('seed')===String(profile.seed))).toBe(true);
    expect(forms.map(f=>f.get('text'))).toEqual(['I speak aloud.','I keep this thought.','The gate is shut.','They must not hear.','I remember the old road.','They must not hear.','The road is quiet.','I should wait.','The road is quiet.']);
    expect(fs.readFileSync(profile.referenceFile!)).toEqual(fs.readFileSync(path.join(fixture.folder,'reference.wav')));
});

test.each(['hoppou','standalone'])('childhood guidance applies to generated and cloned references on %s and restores normal adult settings',async protocol=>{
    const fixture=cloneFixture(path.join(root,'child-source')),clone=library.importClone('campaign','child',readCloneBank(fixture.folder));
    let normal=library.save('campaign','newborn','Encountered child','An age-neutral individual voice.','synthetic');normal=library.reference(normal,fixture.wav,fixture.text);
    const forms:FormData[]=[];
    global.fetch=jest.fn(async(url,init)=>{
        if(String(url).endsWith('/health'))return response(protocol==='standalone'?{model_id:'breeze-tts-2'}:{status:'ok'});
        if(String(url).endsWith('/v1/voices')||String(url).endsWith('/v1/upload_voice'))return response({id:'ok'});
        forms.push(init!.body as FormData);return new Response(Buffer.alloc(100),{headers:{'Content-Type':'audio/pcm'}});
    });
    const provider=new BreezeProvider(normalizeAudio({cfgScale:4}),library);
    for(const profile of [normal,clone])for(const maturity of ['young-child','child','adolescent','youthful-adult','adult'] as const)
        await provider.speech('The lantern is safe.','Clear supplied words.',profile,signal(),undefined,{deliveryKind:'speech',maturity,...(profile===clone&&maturity==='youthful-adult'?{cloneAge:'youthful-adult' as const}:{})});
    expect(forms.map(f=>f.get('cfg_scale'))).toEqual(['2','2','2','4','4','2','2','2','1.5','1']);
    expect(forms.every(f=>f.get('text')==='The lantern is safe.')).toBe(true);
    for(const offset of [0,5])expect(new Set(forms.slice(offset,offset+5).map(f=>f.get(protocol==='standalone'?'voice':'voice_id'))).size).toBe(1);
});
