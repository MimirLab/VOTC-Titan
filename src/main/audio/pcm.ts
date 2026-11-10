/** Avoid treating an error page or compressed response as audible samples. */
export function requirePCM(response: Response): void {
    const type = response.headers.get('content-type')?.toLowerCase();
    if (type && !/^(?:application\/octet-stream|audio\/(?:pcm|x-pcm|raw))(?:;|$)/.test(type))
        throw new Error('Speech returned an unexpected format instead of the requested PCM stream.');
    const rate = type?.match(/(?:rate|samplerate|sample_rate)=([0-9]+)/)?.[1];
    if (rate && rate !== '24000') throw new Error('Speech must return mono PCM at 24 kHz.');
}
export function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
    if (pcm.length % 2) throw new Error('Incomplete PCM sample.');
    const header = Buffer.alloc(44); header.write('RIFF', 0); header.writeUInt32LE(pcm.length + 36, 4);
    header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40); return Buffer.concat([header, pcm]);
}
