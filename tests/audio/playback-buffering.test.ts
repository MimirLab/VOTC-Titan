import { ipcRenderer } from 'electron';

jest.mock('electron', () => ({ ipcRenderer: { on: jest.fn(), send: jest.fn(), invoke: jest.fn().mockResolvedValue({ enabled: true, state: 'idle', message: 'Audio is ready.' }) } }));
jest.mock('../../src/shared/voiceOutput', () => ({ createVoiceOutput: () => ({ input: {}, setLevel: jest.fn() }) }));

function player() {
    const handlers = new Map<string, (...args: any[]) => void>();
    (ipcRenderer.on as jest.Mock).mockImplementation((name, handler) => handlers.set(name, handler));
    const elements: any[] = [], contexts: any[] = [];
    const savedDocument = globalThis.document, savedContext = globalThis.AudioContext;
    (globalThis as any).document = { readyState: 'complete', querySelectorAll: () => [], querySelector: () => ({ appendChild() {} }),
        createElement: () => { const node = { style: {}, textContent: '', setAttribute() {}, append() {} }; elements.push(node); return node; } };
    (globalThis as any).AudioContext = class {
        currentTime = 0; state = 'running'; sources: any[] = [];
        constructor() { contexts.push(this); }
        resume = jest.fn(async () => { this.state = 'running'; });
        suspend = jest.fn(async () => { this.state = 'suspended'; });
        createBuffer(_channels: number, size: number, rate: number) {
            const data = new Float32Array(size);
            return { duration: size / rate, getChannelData: () => data, copyToChannel: (input: Float32Array, _channel: number, offset = 0) => data.set(input, offset) };
        }
        createBufferSource() {
            const source = { buffer: null as any, onended: null as any, connect: jest.fn(), disconnect: jest.fn(), start: jest.fn(), stop: jest.fn() };
            this.sources.push(source); return source;
        }
    };
    jest.isolateModules(() => require('../../src/chatWindow/audioPlayback'));
    const emit = (name: string, ...args: any[]) => handlers.get(name)!(undefined, ...args);
    return { emit, contexts, status: elements[0], cleanup: () => { emit('audio-stop'); (globalThis as any).document = savedDocument; (globalThis as any).AudioContext = savedContext; } };
}

beforeEach(() => jest.clearAllMocks());

test('slow packet arrival waits for the complete passage and plays one exact continuous buffer', () => {
    const p = player();
    try {
        p.emit('audio-start', { id: 'opening', volume: .8, bufferAll: true });
        const context = p.contexts[0];
        p.emit('audio-chunk', 'opening', Buffer.from([0, 64]));
        context.currentTime = 3; p.emit('audio-chunk', 'opening', Buffer.from([0]));
        context.currentTime = 6; p.emit('audio-chunk', 'opening', Buffer.from([128, 255, 127]));
        expect(context.sources).toHaveLength(0);
        expect(ipcRenderer.send).not.toHaveBeenCalledWith('audio-completed', 'opening');
        p.emit('audio-end', 'opening');
        expect(context.sources).toHaveLength(1);
        expect([...context.sources[0].buffer.getChannelData(0)]).toEqual([.5, -1, 32767 / 32768]);
        expect(context.sources[0].start).toHaveBeenCalledWith(6.04);
        context.sources[0].onended();
        expect(ipcRenderer.send).toHaveBeenCalledWith('audio-completed', 'opening');
        expect((ipcRenderer.send as jest.Mock).mock.calls.filter(([name]) => name === 'audio-completed')).toHaveLength(1);
    } finally { p.cleanup(); }
});

test('buffering is visible and stop discards partial audio without playing or acknowledging it', () => {
    const p = player();
    try {
        p.emit('audio-start', { id: 'opening', volume: .8, bufferAll: true });
        p.emit('audio-status', { enabled: true, state: 'playing', message: 'Narrator · 1 of 2' });
        p.emit('audio-chunk', 'opening', Buffer.alloc(96_000));
        expect(p.status.textContent).toContain('Buffering');
        expect(p.status.textContent).toContain('Narrator');
        p.emit('audio-stop'); p.emit('audio-end', 'opening'); p.emit('audio-chunk', 'opening', Buffer.alloc(2));
        expect(p.contexts[0].sources).toHaveLength(0);
        expect(ipcRenderer.send).not.toHaveBeenCalledWith('audio-completed', 'opening');
    } finally { p.cleanup(); }
});

test('pausing during buffering keeps the complete passage suspended and replacement stops its scheduled audio', () => {
    const p = player();
    try {
        p.emit('audio-start', { id: 'opening', volume: .8, bufferAll: true });
        p.emit('audio-pause', true);
        p.emit('audio-chunk', 'opening', Buffer.from([0, 64])); p.emit('audio-end', 'opening');
        const context = p.contexts[0], old = context.sources[0];
        expect(context.state).toBe('suspended');
        expect(ipcRenderer.send).not.toHaveBeenCalledWith('audio-completed', 'opening');
        p.emit('audio-pause', false); expect(context.state).toBe('running');
        p.emit('audio-start', { id: 'replacement', volume: .8, bufferAll: true });
        expect(old.stop).toHaveBeenCalledTimes(1); expect(old.onended).toBeNull();
        p.emit('audio-chunk', 'opening', Buffer.from([0, 64])); p.emit('audio-end', 'opening');
        expect(context.sources).toHaveLength(1);
    } finally { p.cleanup(); }
});

test('ready passages have one short breath between performances without adding a delay after slow generation', () => {
    const p = player();
    try {
        p.emit('audio-start', { id: 'first', volume: .8, bufferAll: true });
        p.emit('audio-chunk', 'first', Buffer.alloc(48_000)); p.emit('audio-end', 'first');
        const context = p.contexts[0];
        context.currentTime = 1.04; context.sources[0].onended();
        p.emit('audio-start', { id: 'second', volume: .8, bufferAll: true, pauseBeforeMs: 300 });
        p.emit('audio-chunk', 'second', Buffer.alloc(48_000)); p.emit('audio-end', 'second');
        expect(context.sources[1].start).toHaveBeenCalledWith(1.34);
        context.currentTime = 2.34; context.sources[1].onended();
        p.emit('audio-start', { id: 'third', volume: .8, bufferAll: true, pauseBeforeMs: 300 });
        context.currentTime = 5;
        p.emit('audio-chunk', 'third', Buffer.alloc(48_000)); p.emit('audio-end', 'third');
        expect(context.sources[2].start).toHaveBeenCalledWith(5.04);
    } finally { p.cleanup(); }
});

test('stop cancels a scheduled breath handoff and a new reply starts without an inherited breath timer', () => {
    const p = player();
    try {
        p.emit('audio-start', { id: 'first', volume: .8, bufferAll: true });
        p.emit('audio-chunk', 'first', Buffer.alloc(48_000)); p.emit('audio-end', 'first');
        const context = p.contexts[0]; context.currentTime = 1.04; context.sources[0].onended();
        p.emit('audio-start', { id: 'next', volume: .8, bufferAll: true, pauseBeforeMs: 300 });
        p.emit('audio-chunk', 'next', Buffer.alloc(48_000)); p.emit('audio-end', 'next');
        expect(context.sources[1].start).toHaveBeenCalledWith(1.34);
        p.emit('audio-stop');
        expect(context.sources[1].stop).toHaveBeenCalledTimes(1);
        expect(ipcRenderer.send).not.toHaveBeenCalledWith('audio-completed', 'next');
        p.emit('audio-start', { id: 'new-reply', volume: .8, bufferAll: true });
        p.emit('audio-chunk', 'new-reply', Buffer.alloc(48_000)); p.emit('audio-end', 'new-reply');
        expect(context.sources[2].start).toHaveBeenCalledWith(1.08);
    } finally { p.cleanup(); }
});
