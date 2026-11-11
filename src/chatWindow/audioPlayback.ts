import { ipcRenderer } from 'electron';
import type { AudioStatus } from '../shared/audio';
import { createVoiceOutput } from '../shared/voiceOutput';

/** Main supplies only player-visible PCM. One queue owns the AudioContext and completion acknowledgements. */
let context: AudioContext | undefined;
let output: ReturnType<typeof createVoiceOutput> | undefined;
let active = '';
let paused = false;
let queued: Float32Array[] = [];
let pendingByte: number | undefined;
let nextTime = 0;
let earliestStart = 0;
let lastCompletedAt: number | undefined;
let started = false;
let ended = false;
let minimumSamples = 30_000;
let bufferAll = false;
let sources = new Set<AudioBufferSourceNode>();
let playbackMessage = '';
const status = document.createElement('span'); status.setAttribute('role', 'status'); status.style.margin = '0 8px';
const toolbar = document.createElement('div'); toolbar.style.display = 'none'; toolbar.className = 'audio-controls';
const pause = document.createElement('button'); pause.textContent = 'Pause voice';
const stop = document.createElement('button'); stop.textContent = 'Stop voice';
pause.onclick = () => ipcRenderer.send('audio-control', 'pause'); stop.onclick = () => ipcRenderer.send('audio-control', 'stop');
toolbar.append(pause, stop, status);
const mount = () => document.querySelector('.activity-panel')?.appendChild(toolbar);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
function renderStatus(): void {
    status.textContent = active && !started ? `Buffering voice… ${playbackMessage}` : playbackMessage;
}
function reset(): void {
    active = ''; queued = []; pendingByte = undefined; nextTime = 0; earliestStart = 0; lastCompletedAt = undefined; started = false; ended = false;
    pause.textContent = paused ? 'Resume voice' : 'Pause voice';
    for (const source of sources) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); }
    sources.clear();
    renderStatus();
}
function acknowledge(): void {
    if (active && ended && !queued.length && !sources.size) { const id = active; lastCompletedAt = nextTime; active = ''; ipcRenderer.send('audio-completed', id); }
}
function schedule(): void {
    if (!context || !output || !active) return;
    const count = queued.reduce((sum, samples) => sum + samples.length, 0);
    if (!ended && (bufferAll || !started && count < minimumSamples)) return;
    started = true;
    if (count) {
        // Transport packets have no audible boundaries. Schedule the complete buffered
        // passage as one source so packet size and renderer timing cannot insert gaps.
        const buffer = context.createBuffer(1, count, 24000);
        let offset = 0;
        for (const samples of queued.splice(0)) {
            buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0, offset); offset += samples.length;
        }
        const source = context.createBufferSource(); source.buffer = buffer; source.connect(output.input);
        nextTime = Math.max(nextTime, earliestStart, context.currentTime + 0.04); source.start(nextTime); nextTime += buffer.duration;
        sources.add(source); source.onended = () => { sources.delete(source); source.disconnect(); acknowledge(); };
    }
    renderStatus();
    acknowledge();
}
let enabled = false;
function displayStatus(value: AudioStatus): void {
    enabled = value.enabled ?? value.state !== 'disabled'; toolbar.style.display = enabled ? '' : 'none'; playbackMessage = value.message; renderStatus();
    document.querySelectorAll<HTMLElement>('.audio-replay').forEach(button => { button.style.display = enabled ? '' : 'none'; });
}
ipcRenderer.on('audio-status', (_event, value: AudioStatus) => displayStatus(value));
void ipcRenderer.invoke('audio-playback-status').then(displayStatus).catch(() => {});
ipcRenderer.on('audio-start', (_event, info: { id: string; volume: number; kind?: string; bufferSeconds?: number; bufferAll?: boolean; pauseBeforeMs?: number }) => {
    const previousEnd = lastCompletedAt;
    reset(); active = info.id;
    // Use the audio clock: a generation gap already provides the requested breath.
    // This schedules only the next performance, never a pause between PCM packets.
    if (previousEnd !== undefined && Number.isFinite(info.pauseBeforeMs) && info.pauseBeforeMs! > 0)
        earliestStart = previousEnd + Math.min(500, info.pauseBeforeMs!) / 1000;
    bufferAll = info.bufferAll === true;
    minimumSamples = Math.max(30_000, Math.min(480_000, (info.bufferSeconds ?? 1.25) * 24_000));
    context ??= new AudioContext({ sampleRate: 24000 });
    output ??= createVoiceOutput(context);
    output.setLevel(info.volume, info.kind === 'thought');
    void (paused ? context.suspend() : context.resume());
    renderStatus();
});
ipcRenderer.on('audio-chunk', (_event, id: string, bytes: Uint8Array) => {
    if (id !== active) return;
    const raw = new Uint8Array(bytes); const input = pendingByte === undefined ? raw : new Uint8Array([pendingByte, ...raw]);
    pendingByte = input.length % 2 ? input[input.length - 1] : undefined;
    const samples = new Float32Array(Math.floor(input.length / 2));
    const data = new DataView(input.buffer, input.byteOffset, input.byteLength);
    for (let i = 0; i < samples.length; i++) samples[i] = data.getInt16(i * 2, true) / 32768;
    if (samples.length) queued.push(samples); schedule();
});
ipcRenderer.on('audio-end', (_event, id: string) => { if (id === active) { ended = true; schedule(); } });
ipcRenderer.on('audio-stop', () => { paused = false; reset(); });
ipcRenderer.on('audio-pause', (_event, value: boolean) => { paused = value; pause.textContent = value ? 'Resume voice' : 'Pause voice'; if (context) void (value ? context.suspend() : context.resume()); });
export function addAudioReplay(element: HTMLElement, messageId?: string): void {
    if (!messageId) return;
    const button = document.createElement('button'); button.textContent = '▶'; button.title = 'Replay voice'; button.className = 'audio-replay';
    button.style.display = enabled ? '' : 'none';
    button.onclick = async () => { try { await ipcRenderer.invoke('audio-replay', messageId); } catch (error) { status.textContent = (error as Error).message; } };
    element.appendChild(button);
}
